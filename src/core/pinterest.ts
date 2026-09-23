import { readMetaTags } from "./page-cover";
import { ResolvedLink, ResolvedMedia, cleanUrl, isHttpUrl, parsePageMeta } from "./resolve";

/**
 * Pinterest, read as pins rather than as pages.
 *
 * A pin's page publishes one og:image, the 736-wide rendition, whatever the
 * pin holds: a video pin comes out as its poster, an idea pin or a carousel
 * as its first page. The pin resource the site's own pages load their data
 * from answers without a login and carries all of it — the video's mp4, the
 * pages of an idea pin, the slots of a carousel, and the link the pin was
 * saved from. It is not an API, so every step here has a way back to the
 * og:image, which is what a pin was before any of this existed.
 */

/**
 * pinterest.com with `www.`, `m.` or a country subdomain (`uk.`, `de.`,
 * `br.`), and the regional storefronts: pinterest.co.uk, pinterest.com.au,
 * pinterest.de, pinterest.jp. A pattern rather than a list, because a pin
 * shared from a storefront the list forgot would silently fall back to the
 * poster; the /pin/ path below is what actually says a URL is a pin.
 */
const PINTEREST_HOST = /^(?:(?:www|m|[a-z]{2})\.)?pinterest\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/i;

/** The short links the app's share sheet hands out. */
const SHORT_HOST = "pin.it";

/** `/pin/<id>/`, or `/pin/<slug>--<id>/` as the regional pages write it. */
const PIN_PATH = /^\/pin\/(?:[^/]*--)?(\d{5,25})(?:\/|$)/;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** True for any Pinterest address, short links included. */
export function isPinterestUrl(url: string): boolean {
  const host = hostOf(url);
  return host === SHORT_HOST || PINTEREST_HOST.test(host);
}

/**
 * True for a pin.it link. Which pin it names is only known once the
 * redirect has been followed, so this answers nothing about the pin.
 */
export function isPinterestShortLink(url: string): boolean {
  return hostOf(url) === SHORT_HOST;
}

/** The pin's id out of a pin URL on any Pinterest host, or null. */
export function pinterestPinId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!PINTEREST_HOST.test(parsed.hostname)) return null;
  return PIN_PATH.exec(parsed.pathname)?.[1] ?? null;
}

/**
 * The one address a pin is kept under.
 *
 * The same pin arrives as uk.pinterest.com/pin/some-slug--<id>/, as
 * pinterest.de/pin/<id>/ and as a pin.it link, and "already clipped" has to
 * recognise all three as the one clipping. This is also the way back to the
 * pin from the note, so it is the address that works from anywhere.
 */
export function pinPermalink(id: string): string {
  return `https://www.pinterest.com/pin/${id}/`;
}

/** The permalink for a pin URL, or null for anything that is not one. */
export function canonicalPinUrl(url: string): string | null {
  const id = pinterestPinId(url);
  return id ? pinPermalink(id) : null;
}

/** Where the site's own pin page loads the pin's data from. */
export function pinResourceUrl(id: string): string {
  const data = JSON.stringify({ options: { field_set_key: "unauth_react_main_pin", id } });
  return `https://www.pinterest.com/resource/PinResource/get/?data=${encodeURIComponent(data)}`;
}

/**
 * The resource names the page route it is answering for, and refuses with
 * 403 "Invalid Resource Request" to a request that does not say. It is a
 * routing parameter, not an identity: the request still goes out under the
 * plugin's own User-Agent.
 */
export const PIN_RESOURCE_HEADERS: Record<string, string> = {
  "X-Pinterest-PWS-Handler": "www/pin/[id].js",
};

/**
 * The sizes Pinterest's image CDN serves a picture at are a segment of its
 * path — /236x/, /736x/, /originals/ — and every size of one picture shares
 * the rest of it.
 */
const PINIMG_HOST = /(^|\.)pinimg\.com$/i;
const PINIMG_SIZE = /^\/(?:\d+x\d*|originals)\//;

/**
 * The same picture at 1200 wide, or at its own size when it is smaller.
 *
 * Not /originals/: it answers 403 for a pin uploaded as anything but JPEG,
 * and a clipping has one address per picture with nothing to fall back to
 * if that one is refused. 1200x answered for every pin tried.
 *
 * Every sized rendition is a JPEG, whatever was uploaded, so the name ends
 * in .jpg: an original's .png kept on a 1200x path is a 403. A GIF is left
 * as it is, since its sized renditions are stills and the original moves.
 *
 * Only the size segment is touched, and only on the picture CDN: a video's
 * thumbnail lives under /videos/ and is left alone.
 */
export function pinimgAtSize(url: string, size = "1200x"): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!PINIMG_HOST.test(parsed.hostname) || !PINIMG_SIZE.test(parsed.pathname)) return url;
  if (/\.gif$/i.test(parsed.pathname)) return url;
  parsed.pathname = parsed.pathname
    .replace(PINIMG_SIZE, `/${size}/`)
    .replace(/\.(?:png|webp|jpeg)$/i, ".jpg");
  return parsed.toString();
}

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function httpsUrl(value: unknown): string {
  const url = asText(value);
  return /^https:\/\//i.test(url) ? url : "";
}

/**
 * The biggest rendition in one of Pinterest's `images` maps, at 1200 wide.
 *
 * The maps are keyed by size and name different sizes in different places —
 * a pin has `orig`, an idea pin's page has `originals`, a carousel's slot has
 * neither — so the widest entry is taken rather than any key by name. Which
 * one hardly matters, since its size segment is rewritten anyway; the widest
 * is simply the one least likely to be a crop.
 */
function bestImage(images: unknown): string {
  const map = asObject(images);
  if (!map) return "";
  let best = "";
  let width = -1;
  for (const entry of Object.values(map)) {
    const item = asObject(entry);
    const url = httpsUrl(item?.url);
    if (!url) continue;
    const w = typeof item?.width === "number" ? item.width : 0;
    if (w > width) {
      best = url;
      width = w;
    }
  }
  return best ? pinimgAtSize(best) : "";
}

/**
 * The mp4 out of a `video_list`, or "" when there is none.
 *
 * A video pin names its file V_720P. An idea pin's page names the same file
 * under a numbered key, with /720p/ in its path, beside smaller tiers that
 * claim the same dimensions; the 720p is the one to keep. The HLS playlist
 * in the same list is not a file anyone can save.
 */
function bestVideo(videos: unknown): string {
  const list = asObject(asObject(videos)?.video_list);
  if (!list) return "";
  const mp4 = (value: unknown): string => {
    const url = httpsUrl(asObject(value)?.url);
    return /\.mp4(?:$|\?)/i.test(url) ? url : "";
  };

  const named = mp4(list.V_720P);
  if (named) return named;
  const files = Object.values(list).map(mp4).filter(Boolean);
  return files.find((url) => url.includes("/720p/")) ?? files[0] ?? "";
}

/** A video's still, for a page whose video has no file to save. */
function videoThumbnail(videos: unknown): string {
  const list = asObject(asObject(videos)?.video_list);
  if (!list) return "";
  for (const entry of Object.values(list)) {
    const url = httpsUrl(asObject(entry)?.thumbnail);
    if (url) return url;
  }
  return "";
}

/**
 * One page of an idea pin or one slot of a carousel, as one piece of media.
 *
 * A page draws its picture or its video in a block, and may add blocks of
 * text or music around it; the first block that is a picture or a video is
 * the page. A video with no mp4 stands as its still rather than dropping the
 * page, so the carousel keeps the length and the order the pin has.
 */
function frameMedia(frame: Json): ResolvedMedia | null {
  const blocks = Array.isArray(frame.blocks) ? frame.blocks.map(asObject) : [];
  for (const block of [...blocks, frame]) {
    if (!block) continue;
    const video = bestVideo(block.video ?? block.videos);
    if (video) return { url: video, kind: "video" };
    const image = bestImage(asObject(block.image)?.images ?? block.images);
    if (image) return { url: image, kind: "image" };
    const still = videoThumbnail(block.video ?? block.videos);
    if (still) return { url: still, kind: "image" };
  }
  return null;
}

function framesOf(list: unknown): ResolvedMedia[] {
  if (!Array.isArray(list)) return [];
  const out: ResolvedMedia[] = [];
  for (const entry of list) {
    const frame = asObject(entry);
    const media = frame ? frameMedia(frame) : null;
    if (media) out.push(media);
  }
  return out;
}

/** How much of a caption to promote into a title before it stops being one. */
const TITLE_MAX = 90;

function clipTitle(text: string): string {
  const line = text.split("\n").map((part) => part.trim()).find(Boolean) ?? "";
  if (line.length <= TITLE_MAX) return line;
  const cut = line.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(" ");
  return `${space > TITLE_MAX / 2 ? cut.slice(0, space) : cut}…`;
}

/**
 * Pinterest's search title is the pin's own title followed by the board's
 * keywords: "Hallway decor | Ghost decorations, Fall party ideas". The part
 * before the bar is the pin's.
 */
function seoHead(title: string): string {
  return title.split(" | ")[0].trim();
}

/**
 * The pin's outbound link, when it points somewhere other than Pinterest:
 * the post, the recipe or the shop the pin was saved from.
 */
function originOf(value: string): string {
  if (!value || !isHttpUrl(value) || isPinterestUrl(value)) return "";
  return cleanUrl(value);
}

function personName(value: unknown): string {
  const person = asObject(value);
  return asText(person?.full_name) || asText(person?.username);
}

/**
 * A pin, out of its resource's answer.
 *
 * - An idea pin with more than one page, or a carousel with more than one
 *   slot, becomes every page in order, each at 1200 wide; a video page is
 *   its mp4.
 * - A video pin is its poster, with the mp4 handed over as `sourceVideoUrl`
 *   for the archiver to fetch into the slot yt-dlp would fill. The note then
 *   has the shape a reel's has, video first.
 * - Anything else is its picture at 1200 wide.
 *
 * Returns null for any answer it does not recognise, including a refusal,
 * so the caller can go back to the page.
 */
export function parsePinResource(payload: unknown, id: string): ResolvedLink | null {
  const pin = asObject(asObject(asObject(payload)?.resource_response)?.data);
  if (!pin) return null;

  const pages = framesOf(asObject(pin.story_pin_data)?.pages);
  const slots = framesOf(asObject(pin.carousel_data)?.carousel_slots);
  const cover = bestImage(pin.images);

  let media: ResolvedMedia[] = [];
  let sourceVideoUrl = bestVideo(pin.videos);
  if (!sourceVideoUrl && pages.length > 1) {
    media = pages;
  } else if (!sourceVideoUrl && slots.length > 1) {
    media = slots;
  } else {
    // A single-page idea pin is how Pinterest stores most pins now, and one
    // whose page is a video is a video pin under another name.
    if (!sourceVideoUrl && pages.length === 1 && pages[0].kind === "video") {
      sourceVideoUrl = pages[0].url;
    }
    const picture = cover || pages.find((page) => page.kind === "image")?.url || "";
    if (picture) media = [{ url: picture, kind: "image" }];
  }
  if (media.length === 0 && !sourceVideoUrl) return null;

  const description =
    asText(pin.closeup_unified_description) || asText(pin.description);
  const title =
    asText(pin.title) ||
    asText(pin.grid_title) ||
    clipTitle(description) ||
    seoHead(asText(pin.seo_title)) ||
    "Pinterest pin";

  const link: ResolvedLink = {
    url: pinPermalink(id),
    title,
    description,
    author:
      personName(pin.native_creator) || personName(pin.origin_pinner) || personName(pin.pinner),
    published: asText(pin.created_at),
    media,
  };
  if (sourceVideoUrl) link.sourceVideoUrl = sourceVideoUrl;
  const origin = originOf(asText(pin.link));
  if (origin) link.origin = origin;
  return link;
}

/**
 * A pin, out of its page, for when the resource would not say.
 *
 * What a pin was before the resource was read — the page's og:image — with
 * the one improvement that needs nothing but the address: the same picture
 * at 1200 wide. The page's og:url is not kept, because for a pin saved from
 * another pin it names that other pin; the address stays the permalink of
 * the pin that was asked for.
 */
export function parsePinPage(html: string, id: string): ResolvedLink {
  const url = pinPermalink(id);
  const meta = readMetaTags(html);
  const page = parsePageMeta(html, url);

  const media: ResolvedMedia[] = [];
  const seen = new Set<string>();
  for (const item of page.media) {
    const sized = item.kind === "image" ? pinimgAtSize(item.url) : item.url;
    if (seen.has(sized)) continue;
    seen.add(sized);
    media.push({ url: sized, kind: item.kind });
  }

  const link: ResolvedLink = {
    url,
    title: clipTitle(seoHead(page.title)) || "Pinterest pin",
    description: page.description,
    author: page.author,
    published: page.published,
    media,
  };
  const origin = originOf(meta.get("pinterestapp:source") ?? meta.get("og:see_also") ?? "");
  if (origin) link.origin = origin;
  return link;
}

/** `android-app://com.pinterest/pinterest/pin/<id>`, and its iOS twin. */
const APP_LINK = /(?:android|ios)-app:\/\/[^"'\s]*?\/pinterest\/pin\/(\d{5,25})/;
const LINK_TAG = /<link\b[^>]*>/gi;
const MARKUP_PIN = /\/pin\/(?:[^/"'\s]*--)?(\d{5,25})(?:[/"'?]|$)/;

function canonicalHref(html: string): string {
  for (const tag of html.matchAll(LINK_TAG)) {
    if (!/\brel\s*=\s*["']canonical["']/i.test(tag[0])) continue;
    return /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag[0])?.[1] ?? "";
  }
  return "";
}

/**
 * Which pin a page is, for a pin.it link: requestUrl follows the redirect
 * but never says where it ended up, so the answer has to be read off the
 * page it ended on.
 *
 * The app links first, because they name the pin the page is showing. The
 * og:url and the canonical link come after them, since a pin saved from
 * another pin names that other pin there. A pin's id anywhere in the markup
 * is the last resort, and only on a page that calls itself a pin: a board's
 * page is full of other pins' ids, and picking one of them would clip the
 * wrong thing.
 */
export function pinIdFromPage(html: string): string | null {
  const app = APP_LINK.exec(html)?.[1];
  if (app) return app;

  const meta = readMetaTags(html);
  for (const candidate of [meta.get("og:url") ?? "", canonicalHref(html)]) {
    const id = pinterestPinId(candidate);
    if (id) return id;
  }

  if (meta.get("og:type") !== "pinterestapp:pin") return null;
  return MARKUP_PIN.exec(html)?.[1] ?? null;
}
