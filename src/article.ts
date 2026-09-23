/**
 * The text of an article, pulled out of the page it was clipped from.
 *
 * Goko clips a link: a picture, a title, an address. That is the right
 * shape for a wall of references and the wrong one for the times a link is
 * a piece of writing — then the clipping is a thumbnail of something you
 * cannot search, cannot read offline, and cannot ask a model about.
 * Obsidian's Web Clipper does this better and is already installed, but it
 * is a browser extension: nothing it does reaches a clip made from inside
 * Goko, or from a phone's share sheet.
 *
 * Both tools it needs are already in Obsidian. Readability is what its own
 * reader mode runs, at /lib/readability.js; Turndown is loaded eagerly by
 * the app and stands on window. So this costs no dependency and no webview:
 * the HTML has already been fetched by the time anything here is called,
 * and the work is a parse and a walk. That is also why it works on a phone,
 * where the card that asked for this assumed it could not.
 *
 * Not pure: DOMParser, and two of the app's own globals. What goes in the
 * note is core/resolve.ts's business, and that part tests.
 */

import { Notice } from "obsidian";
import { libraryNotices } from "./core/lib-notice";

/**
 * Obsidian's own copy, which its reader mode injects into a webview.
 *
 * Not API: a file inside the app, at the path it has today, which an update
 * may move or rename without a word. Borrowed rather than bundled so that
 * the plugin carries no copy of its own to keep current, and so that an
 * article is cut out of its page the way Obsidian's own reader cuts it.
 *
 * If it will not load, readability() says so once a session, and clippings
 * keep their picture and title but go without the article's text. After a
 * major Obsidian update, clip a long article and check the note has its
 * body; if not, look for readability.js in the app's lib folder, and check
 * that it still defines `window.Readability`. Turndown is the other half and
 * just as unpromised, though it is found on window rather than loaded from a
 * path; if `window.TurndownService` is gone, markdownWriter() says so once a
 * session in the same way, and clippings go without their text all the same.
 */
const READABILITY = "/lib/readability.js";

/**
 * How much text a page must yield before it counts as an article.
 *
 * Readability answers for anything with prose in it, a shop's returns
 * policy included, and a clipping whose body is a page's navigation read
 * aloud is worse than one with no body at all. Twelve hundred characters is
 * two or three paragraphs: past the point where a page is furniture.
 */
const MIN_LENGTH = 1200;

/** Past this the page is not an article, it is an archive index. */
const MAX_MARKDOWN = 60000;

/** Enormous HTML is a feed or a dump, and parsing it costs seconds. */
const MAX_HTML = 4 * 1024 * 1024;

interface Parsed {
  title: string;
  content: string;
  textContent: string;
  length: number;
  byline: string;
  siteName: string;
}

type ReadabilityCtor = new (
  doc: Document,
  options?: Record<string, unknown>
) => { parse(): Parsed | null };

interface Turndown {
  turndown(html: string): string;
  addRule(key: string, rule: Record<string, unknown>): unknown;
}

type TurndownCtor = new (options?: Record<string, unknown>) => Turndown;

let loading: Promise<ReadabilityCtor | null> | null = null;

function readabilityNow(): ReadabilityCtor | null {
  const held = (window as unknown as { Readability?: ReadabilityCtor }).Readability;
  return typeof held === "function" ? held : null;
}

/**
 * Readability, loading it if nothing has needed it yet.
 *
 * A classic script rather than a module, because that is what the file is:
 * one top-level `function Readability`, which becomes a global the moment it
 * is evaluated. Once per session whatever the answer — a build without the
 * file will not grow one between two clippings. A no is said out loud the
 * first time it is heard, since without that the feature would simply stop.
 */
async function readability(): Promise<ReadabilityCtor | null> {
  const ready = readabilityNow();
  if (ready) return ready;

  loading ??= new Promise<ReadabilityCtor | null>((resolve) => {
    const script = createEl("script");
    script.src = READABILITY;
    script.addEventListener("load", () => resolve(readabilityNow()), { once: true });
    script.addEventListener("error", () => resolve(null), { once: true });
    // The main window's document on purpose: the library defines itself as
    // a global on that window, which is the one this code reads. Loaded into
    // a popout it would be invisible here and would go when the popout did.
    window.document.head.appendChild(script);
  });

  const Reader = await loading;
  if (!Reader) {
    // Asked on every page clipped, so every caller after the first hears
    // the same no, and a notice each would come back with every link.
    const notice = libraryNotices.failed("readability");
    if (notice) new Notice(notice, 8000);
  }
  return Reader;
}

/**
 * Turndown, configured the way Obsidian configures its own.
 *
 * Deliberately the same settings: a note written here and a note written by
 * the app's Copy as Markdown should not be two dialects of markdown in one
 * vault.
 *
 * Found rather than loaded, since the app has loaded it already, and so
 * there is nothing to try again: a session without it stays without it. A
 * no is said out loud the first time it is heard, for the same reason
 * readability() says its own.
 */
function markdownWriter(): Turndown | null {
  const Service = (window as unknown as { TurndownService?: TurndownCtor }).TurndownService;
  if (typeof Service !== "function") {
    // Asked on every page clipped, like Readability, and a notice each
    // would come back with every link.
    const notice = libraryNotices.failed("turndown");
    if (notice) new Notice(notice, 8000);
    return null;
  }

  const writer = new Service({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    fence: "```",
    linkStyle: "inlined",
  });

  // Pictures are dropped, which is a decision rather than an oversight. The
  // card on the wall takes its picture from the page's own cover; an article
  // carries thirty more, and embedding them would have the archiver fetch
  // every one of them and could hand the card a diagram instead of a cover.
  // The alt text stays, because that is words, and words are what this is
  // for — and so does everything around a picture, captions included, which
  // is why the rule is on the image and not on the figure holding it.
  writer.addRule("plain-images", {
    filter: "img",
    replacement: (_content: string, node: Node) => {
      const alt = (node as HTMLElement).getAttribute?.("alt")?.trim() ?? "";
      return alt ? ` ${alt} ` : "";
    },
  });

  return writer;
}

export interface Article {
  title: string;
  byline: string;
  /** The article as markdown, ready to be put in a note. */
  markdown: string;
}

/**
 * The article in a page, or null when the page is not one.
 *
 * Given the HTML that has already been fetched for the page's metadata, so
 * this costs no request. A `<base>` goes in first: the document comes from
 * DOMParser and has no address of its own, and without one Readability
 * rewrites every relative link against Obsidian itself.
 */
export async function readArticle(html: string, url: string): Promise<Article | null> {
  if (!html || html.length > MAX_HTML) return null;

  const Reader = await readability();
  const writer = markdownWriter();
  if (!Reader || !writer) return null;

  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const head = doc.head ?? doc.documentElement;
    if (head && !doc.querySelector("base")) {
      // Adopted, not borrowed: createEl builds in the app's document, and
      // the one DOMParser just returned has no window of its own, so the
      // node is moved across rather than inserted from somewhere else.
      const base = doc.adoptNode(createEl("base"));
      base.setAttribute("href", url);
      head.insertBefore(base, head.firstChild);
    }

    // Readability's own options are left alone. charThreshold is not the
    // question asked here — it is how hard Readability tries before giving
    // up, and turning it up makes it grab more of the page, not less. What
    // counts as an article is decided below, on the answer.
    const parsed = new Reader(doc).parse();
    if (!parsed || parsed.length < MIN_LENGTH) return null;

    const markdown = writer.turndown(parsed.content).trim();
    if (markdown.length < MIN_LENGTH / 2) return null;

    return {
      title: parsed.title ?? "",
      byline: parsed.byline ?? "",
      markdown: markdown.length > MAX_MARKDOWN ? `${markdown.slice(0, MAX_MARKDOWN)}…` : markdown,
    };
  } catch {
    // A page that will not parse is a page with no article in it, as far as
    // anything downstream is concerned.
    return null;
  }
}
