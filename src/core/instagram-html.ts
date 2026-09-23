import { decodeEntities } from "./page-cover";
import type { InstagramPost, ResolvedMedia } from "./resolve";

/** Every <img> tag on a page. */
const IMG_TAG = /<img\b[^>]*>/gi;

/** One attribute of a tag, however it is quoted. */
const ATTRIBUTE = /\s([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/** The name the embed's header writes out, the account that posted. */
const USERNAME_TEXT = /<span\b[^>]*\bclass\s*=\s*["']UsernameText["'][^>]*>([^<]*)<\/span>/i;

/** The handle at the end of the picture's alt text, "… shared by @handle". */
const ALT_HANDLE = /@([A-Za-z0-9._]+)\s*$/;

/** What Instagram allows in a username, which is what `author:` will say. */
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;

/**
 * A rendition cropped out of the picture rather than scaled from it: the
 * CDN spells a crop into `stp` as `c<x>.<y>.<w>.<h>a`, and the square ones
 * the srcset lists beside the real renditions are exactly what this exists
 * to get away from.
 */
const CROP = /(?:^|_)c\d+\.\d+\.\d+\.\d+a(?:_|$)/;

interface Candidate {
  url: string;
  width: number;
}

function attributes(tag: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of tag.matchAll(ATTRIBUTE)) {
    const name = match[1].toLowerCase();
    if (!found.has(name)) found.set(name, decodeEntities(match[2] ?? match[3] ?? "").trim());
  }
  return found;
}

function isHttps(url: string): boolean {
  return /^https:\/\/\S+$/i.test(url);
}

function isCropped(url: string): boolean {
  try {
    return CROP.test(new URL(url).searchParams.get("stp") ?? "");
  } catch {
    return false;
  }
}

/**
 * The renditions a srcset names, each with the width it declares.
 *
 * Split on every comma, which is not how a browser reads a srcset — a URL
 * may carry a comma of its own — but the CDN percent-encodes its query, and
 * a candidate that did carry one would split into two pieces neither of
 * which is an https address with a width, so it is dropped rather than
 * misread.
 */
function srcsetCandidates(srcset: string): Candidate[] {
  const found: Candidate[] = [];
  for (const piece of srcset.split(",")) {
    const match = /^(\S+)\s+(\d+)w$/.exec(piece.trim());
    if (!match || !isHttps(match[1])) continue;
    found.push({ url: match[1], width: Number(match[2]) });
  }
  return found;
}

/**
 * The best one address a picture offers: the widest rendition in its
 * srcset, or its src when the srcset names none.
 *
 * The srcset holds the picture at its own proportions from the original
 * width down, and after those the same sizes again cropped square. The
 * widest is the original, and a crop is only taken when nothing else is
 * listed at all. Every address is signed by the CDN for the rendition it
 * names, so each is used exactly as written.
 */
function bestRendition(tag: Map<string, string>): string | null {
  const candidates = srcsetCandidates(tag.get("srcset") ?? "");
  const whole = candidates.filter((candidate) => !isCropped(candidate.url));
  let best: Candidate | null = null;
  for (const candidate of whole.length > 0 ? whole : candidates) {
    // Strictly wider only, so of two at one width the first listed stands.
    if (!best || candidate.width > best.width) best = candidate;
  }
  if (best) return best.url;

  const src = tag.get("src") ?? "";
  return isHttps(src) ? src : null;
}

function readAuthor(html: string, alts: string[]): string {
  const named = decodeEntities(USERNAME_TEXT.exec(html)?.[1] ?? "").trim();
  if (HANDLE.test(named)) return named;
  for (const alt of alts) {
    const handle = ALT_HANDLE.exec(alt)?.[1] ?? "";
    if (HANDLE.test(handle)) return handle;
  }
  return "";
}

/**
 * The pictures and the author of a post, from the markup of its embed page.
 *
 * For some posts the embed sends no data at all — `contextJSON` is null and
 * there is no `gql_data` — and draws the post on the server instead. What it
 * draws is an <img class="EmbeddedMediaImage"> whose srcset lists the
 * picture at its own proportions, the original among them, which is worth
 * far more than the og: tag's square crop at 640.
 *
 * Only that class is read. The embed also draws the author's avatar and a
 * strip of their other posts, larger renditions included, and none of those
 * are this post. A carousel is drawn with its first picture only, the rest
 * being loaded by the embed's scripts out of the data this page did not
 * send, so a carousel comes back as one picture; each EmbeddedMediaImage is
 * still taken in order, in case one day the markup holds more. A video is
 * drawn as its poster, and the markup carries no address for the file, so
 * this never names one.
 *
 * The author is the name the embed's header writes out, or failing that the
 * handle its alt text ends with; empty when neither is there.
 *
 * Null when the page draws no picture, which is also how a removed post, a
 * private one or a changed page arrives.
 */
export function parseInstagramHtmlEmbed(html: string): InstagramPost | null {
  const media: ResolvedMedia[] = [];
  const alts: string[] = [];
  for (const match of html.matchAll(IMG_TAG)) {
    const tag = attributes(match[0]);
    if (!(tag.get("class") ?? "").split(/\s+/).includes("EmbeddedMediaImage")) continue;
    alts.push(tag.get("alt") ?? "");
    const url = bestRendition(tag);
    if (url && !media.some((known) => known.url === url)) media.push({ url, kind: "image" });
  }
  if (media.length === 0) return null;
  return { media, author: readAuthor(html, alts) };
}
