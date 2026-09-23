import { dedupeMedia, sourceVideoKeyFor } from "./normalize";
import type { MediaRef } from "./scan";
import { classifyYoutube } from "./youtube";

export interface ThumbnailCandidate {
  url: string;
  /** Tried in order when `url` is unavailable. */
  fallbacks: string[];
}

/**
 * Resolves a video page URL to its thumbnail without any network request.
 *
 * Clippings routinely reference a video by its page URL, sometimes with
 * markdown image syntax. Fetching that URL returns HTML, so the archiver
 * rejects it; this turns it into a real cover instead.
 */
export function knownHostThumbnail(pageUrl: string): ThumbnailCandidate | null {
  const link = classifyYoutube(pageUrl);
  if (!link) return null;
  const base = `https://img.youtube.com/vi/${link.id}`;

  // A Short is vertical, and every size below is a landscape frame with the
  // picture pillarboxed inside it, which put a wide card on the wall for a
  // tall clip. oar2 is the vertical cover the Shorts player itself shows. It
  // is not documented, so the landscape sizes stay behind it: if it ever
  // goes, the card is wide again rather than blank.
  if (link.kind === "short") {
    return { url: `${base}/oar2.jpg`, fallbacks: [`${base}/hq720.jpg`, `${base}/hqdefault.jpg`] };
  }

  // maxres exists only for videos uploaded at that resolution, so the
  // archiver walks down to sizes YouTube always generates.
  return {
    url: `${base}/maxresdefault.jpg`,
    fallbacks: [`${base}/hq720.jpg`, `${base}/hqdefault.jpg`],
  };
}

const META_TAG = /<meta\b[^>]*>/gi;
const META_KEY = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i;
const META_CONTENT = /\bcontent\s*=\s*["']([^"']*)["']/i;

/** The named entities pages actually use in titles and descriptions. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: "\u00a0",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  laquo: "\u00ab",
  raquo: "\u00bb",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  bull: "\u2022",
  middot: "\u00b7",
  times: "\u00d7",
};

/**
 * Undoes HTML entity encoding in text read out of a page's markup.
 *
 * Numeric first, and in both bases: a Threads page spells its Korean title
 * as `&#xcf69;&#xd3ec;` and its @ as `&#064;`, and a recipe blog's curly
 * apostrophe arrives as `&#8217;`. Handling only six named entities, as this
 * did, wrote those codes into titles, file names and the wall.
 *
 * A numeric entity that arrives escaped a second time is unwrapped first.
 * Strictly, `&amp;#064;` *is* the five characters `&#064;` and a reader that
 * says so is right; that is what this did, deliberately. But no page has ever
 * meant to display those five characters in its title, and one page we clip
 * every week means `@`: Threads escapes its own og:title twice. The cost of
 * being right was not only ugly titles and file names. `refineThreadsLink`
 * looks for a literal `@` to pull the handle out of `Name (@handle) on
 * Threads`, so an `@` still spelled `&#064;` made that fail too, and the post
 * kept the useless generic title instead of its own text. An escape nobody
 * means, that breaks a parser downstream, is worth undoing.
 *
 * Only numeric, and only one layer. `&amp;lt;` keeps its meaning, so markup
 * cannot be smuggled through in named form, and `&amp;amp;#39;` unwraps once
 * to the literal `&amp;#39;` rather than all the way, because the rule below
 * matches `&amp;` followed by `#` and nothing else.
 */
export function decodeEntities(value: string): string {
  return value
    .replace(/&amp;(#(?:x[0-9a-f]+|\d+);)/gi, (_m, entity: string) => `&${entity}`)
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => codePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function codePoint(code: number): string {
  // Out-of-range or surrogate codes are left as the replacement character
  // rather than thrown: this runs over pages nobody controls.
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
    return "\ufffd";
  }
  return String.fromCodePoint(code);
}

/** Collects every og:/twitter: meta tag on a page, first declaration winning. */
export function readMetaTags(html: string): Map<string, string> {
  const found = new Map<string, string>();

  for (const tag of html.matchAll(META_TAG)) {
    const key = META_KEY.exec(tag[0])?.[1]?.toLowerCase();
    if (!key) continue;
    const content = META_CONTENT.exec(tag[0])?.[1];
    if (!content || !content.trim()) continue;
    // First declaration wins: pages repeat og:image for extra sizes.
    if (!found.has(key)) found.set(key, decodeEntities(content.trim()));
  }

  return found;
}

/**
 * Pulls the page's declared social preview image. Nearly every modern site
 * publishes one, which makes it the best single cover for a clipping whose
 * body carries no usable image of its own.
 */
export function extractPageImage(html: string, baseUrl: string): string | null {
  const found = readMetaTags(html);
  const raw = found.get("og:image") ?? found.get("og:image:url") ?? found.get("twitter:image");
  if (!raw) return null;

  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Whether a page cover is worth fetching for a clipping.
 *
 * The page cover is the last thing tile.ts reaches for, so it is only worth
 * a request while nothing ahead of it has been archived. Two things get
 * there first: an inline image from the clipping's own body, and a video
 * pulled from the post. The second is the one that used to be missed, and
 * on X it is the expensive miss, because the still a video post publishes
 * is a frame of the very video already on disk.
 *
 * @param archivedFile the cache's answer for a key: a local file, or
 * undefined. Passed as a function so this stays free of Obsidian imports.
 */
export function needsPageCover(
  record: { source: string; media: MediaRef[] },
  archivedFile: (key: string) => string | undefined
): boolean {
  if (!record.source) return false;
  // A file embedded from the vault is the clipping's own picture, and the
  // tile shows it ahead of anything fetched for the page.
  if (record.media.some((media) => !/^https?:\/\//i.test(media.url))) return false;
  if (archivedFile(sourceVideoKeyFor(record.source))) return false;
  return !dedupeMedia(record.media).some((media) => archivedFile(media.key));
}
