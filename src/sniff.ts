import { Platform } from "obsidian";
import { pickSniffedVideo, pickThreadsImages } from "./core/resolve";

/**
 * Finds a post's video URL by actually loading the page, for hosts that
 * hide it from every server-side route. Threads publishes no og:video, no
 * inline JSON, and has no yt-dlp extractor: the video URL exists only after
 * the page's own scripts fetch it. A hidden webview is a real browser
 * visit — the same load a person makes before clicking "Copy video
 * address" — with no impersonation and no third party in the path.
 *
 * Desktop only: the webview tag is Electron's, and the mobile app archives
 * the poster now and adopts the video the desktop later syncs back.
 */

/** The slice of Electron's webview element this module touches. */
interface WebviewLike extends HTMLElement {
  executeJavaScript(script: string): Promise<unknown>;
}

/**
 * Runs inside the loaded page. Nudges the player, because the video URL
 * only hits the network once playback is attempted, then reports the
 * <video> source and every URL the page has requested so far — resource
 * timing sees the media fetch even when the element hides behind a blob.
 */
const PROBE = `(() => {
  const v = document.querySelector("video");
  if (v) {
    try {
      v.muted = true;
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  }
  const res = performance.getEntriesByType("resource").map((e) => e.name);
  return JSON.stringify({ src: v ? v.currentSrc || v.src || "" : "", res });
})();`;

const POLL_MS = 600;

export async function sniffVideoUrl(pageUrl: string, timeoutMs = 20000): Promise<string | null> {
  if (!Platform.isDesktopApp) return null;

  const view = createEl("webview" as keyof HTMLElementTagNameMap) as WebviewLike;
  view.setAttribute("src", pageUrl);
  // Rendered but out of sight (see .pg-sniff-frame): display:none or a
  // zero-size frame may never lay the player out, and a player that never
  // mounts never fetches.
  view.classList.add("pg-sniff-frame");
  // The main window: a popout closing mid-sniff would take this with it.
  window.document.body.appendChild(view);

  try {
    return await new Promise<string | null>((resolve) => {
      let done = false;
      let poll = 0;
      const finish = (value: string | null): void => {
        if (done) return;
        done = true;
        window.clearInterval(poll);
        window.clearTimeout(timer);
        resolve(value);
      };
      // The timeout is the only guaranteed exit: a page that never loads,
      // a disabled webview tag, or a login wall all end here, never hang.
      const timer = window.setTimeout(() => finish(null), timeoutMs);

      view.addEventListener("dom-ready", () => {
        poll = window.setInterval(() => {
          void (async () => {
            try {
              const raw = await view.executeJavaScript(PROBE);
              const report = JSON.parse(String(raw)) as { src: string; res: string[] };
              const url = pickSniffedVideo([report.src, ...report.res]);
              if (url) finish(url);
            } catch {
              // Probe landed between navigations; the next tick retries.
            }
          })();
        }, POLL_MS);
      });
      view.addEventListener("did-fail-load", () => finish(null));
    });
  } finally {
    view.remove();
  }
}


/**
 * Runs inside the page. Finds the one post that was asked for and reports the
 * pictures inside it, and only those.
 *
 * A Threads post page also draws the author's other threads and a column of
 * related ones, all with pictures of their own, so "every large image on the
 * page" answered with somebody else's post. The post is found two ways: by
 * the link to its own permalink, which every rendered post carries as its
 * timestamp, and failing that by its text. From the anchor the walk goes up
 * to the nearest thing shaped like a post, then out to its images. Pictures
 * are read by src, not by whether they have decoded yet: a carousel lazy-loads
 * its frames, and a frame not yet decoded is still a frame.
 */
function imageProbe(code: string, text: string): string {
  return `(() => {
    const code = ${JSON.stringify(code)};
    const text = ${JSON.stringify(text)};
    const POST = '[data-pressable-container], article, [role="article"]';
    const hasPicture = (el) => Array.from(el.querySelectorAll("img")).some((img) => /-15\\//.test(img.currentSrc || img.src || ""));
    const climb = (el) => {
      let node = el;
      for (let i = 0; node && i < 12; i++) {
        if (node.matches && node.matches(POST) && hasPicture(node)) return node;
        node = node.parentElement;
      }
      node = el;
      for (let i = 0; node && i < 12; i++) {
        if (hasPicture(node)) return node;
        node = node.parentElement;
      }
      return null;
    };
    let root = null;
    if (code) {
      for (const a of document.querySelectorAll('a[href*="/post/' + code + '"]')) {
        root = climb(a);
        if (root) break;
      }
    }
    if (!root && text) {
      const wanted = text.replace(/\\s+/g, " ").trim();
      for (const el of document.querySelectorAll("span, div, p")) {
        if (el.children.length === 0 && (el.textContent || "").replace(/\\s+/g, " ").trim() === wanted) {
          root = climb(el);
          if (root) break;
        }
      }
    }
    if (!root) return JSON.stringify({ scoped: false, urls: [] });
    const out = [];
    for (const img of root.querySelectorAll("img")) {
      const r = img.getBoundingClientRect();
      if (r.width < 96 && r.height < 96) continue;
      const src = img.currentSrc || img.src || "";
      if (src) out.push(src);
    }
    return JSON.stringify({ scoped: true, urls: out });
  })();`;
}

/** How long the count of pictures must hold before the carousel is taken as fully drawn. */
const SETTLE_POLLS = 3;

/**
 * Every picture of one Threads post, by loading its page and reading what it
 * drew inside that post alone.
 *
 * Threads publishes an avatar or a rendered card as og:image and keeps the
 * post's own pictures for the page's scripts, so the page is loaded the way a
 * visit loads it and asked. Scoped to the post (see imageProbe); a page where
 * the post could not be found answers with nothing rather than with a
 * neighbour's pictures, which is what an unscoped read did. Empty on a phone,
 * where there is no webview.
 *
 * @param code the post's permalink code, the surest anchor.
 * @param text the post's words, the fallback anchor.
 */
export async function sniffThreadsImages(
  pageUrl: string,
  code: string,
  text: string,
  timeoutMs = 12000
): Promise<string[]> {
  if (!Platform.isDesktopApp) return [];

  const view = createEl("webview" as keyof HTMLElementTagNameMap) as WebviewLike;
  view.setAttribute("src", pageUrl);
  view.classList.add("pg-sniff-frame");
  // The main window: a popout closing mid-sniff would take this with it.
  window.document.body.appendChild(view);
  const probe = imageProbe(code, text);

  try {
    return await new Promise<string[]>((resolve) => {
      let done = false;
      let poll = 0;
      let last: string[] = [];
      let stable = 0;
      const finish = (value: string[]): void => {
        if (done) return;
        done = true;
        window.clearInterval(poll);
        window.clearTimeout(timer);
        resolve(value);
      };
      const timer = window.setTimeout(() => finish(last), timeoutMs);

      view.addEventListener("dom-ready", () => {
        poll = window.setInterval(() => {
          void (async () => {
            try {
              const raw = await view.executeJavaScript(probe);
              const report = JSON.parse(String(raw)) as { scoped: boolean; urls: string[] };
              if (!report.scoped) return;
              const found = pickThreadsImages(report.urls);
              if (found.length > 0 && found.length === last.length) stable++;
              else stable = 0;
              last = found;
              if (stable >= SETTLE_POLLS) finish(last);
            } catch {
              // Probe landed between navigations; the next tick retries.
            }
          })();
        }, POLL_MS);
      });
      view.addEventListener("did-fail-load", () => finish(last));
    });
  } finally {
    view.remove();
  }
}
