import { decodeEntities } from "./page-cover";
import { isThreadsUrl, pickSniffedVideo, pickThreadsImages, threadsPostCode } from "./resolve";

/** `/@handle/post/…`, with the @ as the page writes it or as a copied link escapes it. */
const THREADS_HANDLE = /^\/(?:@|%40)([A-Za-z0-9._]+)\/post\//i;

/**
 * The embed Threads renders for other websites to put a post in a page, for
 * the post a permalink names.
 *
 * The post's own page is drawn by its scripts, so fetching it gives only the
 * og: tags, and Threads fills og:image with the author's avatar or a rendered
 * card whatever the post holds. The embed is rendered on the server, needs no
 * login, and carries the post's pictures in its markup, which is what makes
 * it the one route to them on a phone, where there is no webview to load the
 * page in.
 *
 * On the same host the permalink named, so the request goes nowhere the page
 * fetch did not already go. Null for anything that is not a post's permalink
 * — a share link has to be resolved into one first, which its og:url does.
 */
export function threadsEmbedUrl(permalink: string): string | null {
  if (!isThreadsUrl(permalink)) return null;
  const parsed = new URL(permalink);
  const handle = THREADS_HANDLE.exec(parsed.pathname)?.[1];
  const code = threadsPostCode(parsed.pathname);
  if (!handle || !code) return null;
  return `${parsed.origin}/@${handle}/post/${code}/embed`;
}

/** What the embed shows of a post that its og: tags do not. */
export interface ThreadsEmbed {
  /** The post's own pictures, in the post's order, one address per picture. */
  images: string[];
  /**
   * The post's video, when it has one. Signed by the CDN and expiring within
   * days, so it is for downloading at clip time and never for a note.
   */
  video: string | null;
}

/** Every src and style attribute, in document order, however it is quoted. */
const ATTRIBUTE = /\s(src|style)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/** A CSS url(), bare or quoted, as a background-image declares one. */
const CSS_URL = /url\(\s*(["']?)(.*?)\1\s*\)/gi;

/**
 * The pictures and the video of a post, from its embed page.
 *
 * A carousel is a row of <img>; a picture a post links to rather than holds
 * is drawn as a CSS background of the link's preview; a video is a <video>
 * with its file in a <source>. So every src and every style url() on the
 * page is collected in order, with the entities of the attribute resolved —
 * the markup writes each `&` of a signed address as `&amp;`, and a signature
 * with those left in answers 403.
 *
 * Telling the post's pictures from everything else is pickThreadsImages's
 * job: the CDN's path says what a picture is, `-15` for post media and `-19`
 * for an avatar, and the same picture at two sizes is the same path.
 *
 * Null when the page holds neither, which is also how a removed post, a
 * private one or a changed page arrives. The caller then falls back to what
 * it had before this existed.
 */
export function parseThreadsEmbed(html: string): ThreadsEmbed | null {
  const urls: string[] = [];
  for (const match of html.matchAll(ATTRIBUTE)) {
    const value = decodeEntities(match[2] ?? match[3] ?? "");
    if (match[1].toLowerCase() === "src") {
      urls.push(value.trim());
      continue;
    }
    for (const css of value.matchAll(CSS_URL)) urls.push(css[2].trim());
  }

  const images = pickThreadsImages(urls);
  const video = pickSniffedVideo(urls);
  if (images.length === 0 && !video) return null;
  return { images, video };
}

/**
 * True for a profile picture on the CDN Threads shares with Instagram, whose
 * path marks one with `-19`. Threads puts the author's there as og:image of a
 * post that has no picture of its own, which makes it no cover for a video.
 */
export function isThreadsAvatar(url: string): boolean {
  try {
    return /\/t51\.[0-9]+-19\//.test(new URL(url).pathname);
  } catch {
    return false;
  }
}
