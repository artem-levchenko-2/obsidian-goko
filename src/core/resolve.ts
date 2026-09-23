import { extensionOf, kindForExtension, kindForMime } from "./formats";
import { parseInstagramHtmlEmbed } from "./instagram-html";
import { decodeEntities, readMetaTags } from "./page-cover";
import { AMAZON_IMAGE_HOST, AMAZON_IMAGE_MODIFIER } from "./normalize";
import { YOUTUBE_HOSTS, downloadsYoutubeVideo } from "./youtube";

export interface ResolvedMedia {
  url: string;
  kind: "image" | "video";
  /** Vault path once archived, so the note can embed the file itself. */
  localPath?: string;
}

export interface ResolvedLink {
  /** Canonical page URL, with tracking parameters stripped. */
  url: string;
  title: string;
  description: string;
  author: string;
  published: string;
  media: ResolvedMedia[];
  /** og:url, when the page named one: the address the page calls itself. */
  canonical?: string;
  /**
   * The page's own article, as markdown, when it turned out to have one.
   *
   * Read by article.ts out of the HTML already fetched for the metadata
   * above, so a clipping of a piece of writing carries the writing: it can
   * be searched, read on a plane, and handed to a model for a summary.
   * Absent for everything that is not an article, which is most links.
   */
  article?: string;
  /**
   * The post's own video, when the page handed over its address.
   *
   * Downloaded at clip time into the same slot a local yt-dlp would fill,
   * so the note comes out the same shape either way and no device goes
   * looking for the video again. Never part of `media` and never written
   * into the note: the address is signed and expires within days, and a
   * note that points at it is a note that stops playing.
   */
  sourceVideoUrl?: string;
  /**
   * Where the thing was first published, when the clipping is of a copy of
   * it: the post, recipe or shop a pin was saved from. `source` stays the
   * copy, which is what "already clipped" compares; this is written beside
   * it as `origin:`.
   */
  origin?: string;
}

/** Parameters that identify the sharer, not the content. */
const TRACKING_PARAMS = [
  "s",
  "t",
  "ref",
  "ref_src",
  "ref_url",
  "fbclid",
  "gclid",
  "igshid",
  "igsh",
  "si",
  "stkn",
  "taid",
];

export function cleanUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return raw.trim();
  }
  for (const name of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.includes(name.toLowerCase()) || name.toLowerCase().startsWith("utm_")) {
      parsed.searchParams.delete(name);
    }
  }
  let out = parsed.toString();
  if (out.endsWith("?")) out = out.slice(0, -1);
  return out;
}

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The first web URL in a piece of text, or null when there is none.
 *
 * Share sheets and copied captions wrap the link in prose — "Check this
 * out! https://…" — and a capture path that demands a bare URL refuses
 * exactly the text mobile apps hand over. Trailing sentence punctuation is
 * not part of a shared link in practice, so it is stripped.
 */
export function firstHttpUrl(text: string): string | null {
  const match = /https?:\/\/[^\s<>"']+/.exec(text);
  if (!match) return null;
  const url = match[0].replace(/[.,;:!?)\]}]+$/, "");
  return isHttpUrl(url) ? url : null;
}

/**
 * firstHttpUrl for text that travelled through a share pipeline.
 *
 * iOS Shortcuts' Open URL action can percent-encode an already-encoded
 * parameter, so what reaches the protocol handler is sometimes the encoding
 * of the link rather than the link. Decoding is tried a couple of times
 * before giving up, and a malformed escape (a bare % in ordinary prose)
 * merely ends the attempt rather than throwing.
 */
export function sharedHttpUrl(raw: string): string | null {
  let text = raw;
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = firstHttpUrl(text);
    if (url) return url;
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) return null;
      text = decoded;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * True when the pasted URL is the asset itself rather than a page about it.
 * Threads never exposes its video URL, so copying the video address and
 * pasting that is the only route to archiving it.
 */
export function directMediaKind(url: string): "image" | "video" | null {
  try {
    new URL(url);
  } catch {
    return null;
  }
  return kindForExtension(extensionOf(url));
}

/** Builds a link for a URL that points straight at a file the wall can show. */
export function directMediaLink(url: string, kind: "image" | "video"): ResolvedLink {
  let name = "";
  let host = "";
  try {
    const parsed = new URL(url);
    host = parsed.hostname.replace(/^www\./, "");
    name = decodeURIComponent(parsed.pathname.split("/").pop() ?? "");
  } catch {
    host = "link";
  }
  // `kind` says how the wall paints it, which is not always what it is: a
  // PDF is painted as a still and titling one "Image: guidelines.pdf" is a
  // clipping that lies about itself in the one line you read it by.
  const label =
    kind === "video" ? "Video" : extensionOf(url) === "pdf" ? "PDF" : "Image";
  return {
    url,
    title: name ? `${label}: ${name}` : `${label} from ${host}`,
    description: "",
    author: "",
    published: "",
    media: [{ url, kind }],
  };
}

const X_HOSTS = new Set(["x.com", "twitter.com", "mobile.x.com", "mobile.twitter.com"]);
const X_STATUS = /^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/;

/** Identifies an X post, whose media is only reachable through a resolver. */
export function xStatus(url: string): { user: string; id: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!X_HOSTS.has(parsed.hostname.replace(/^www\./, "").toLowerCase())) return null;
  const match = X_STATUS.exec(parsed.pathname);
  return match ? { user: match[1], id: match[2] } : null;
}

const INSTAGRAM_HOSTS = new Set(["instagram.com", "m.instagram.com", "instagr.am"]);
const INSTAGRAM_PATH = /^\/(reels?|p|tv)\/([A-Za-z0-9_-]{5,32})/;

/**
 * Identifies an Instagram post. Like Threads, Instagram publishes only a
 * poster image to crawlers and never the video URL, so the media is only
 * reachable through a mirror.
 */
export function instagramPost(url: string): { kind: string; code: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!INSTAGRAM_HOSTS.has(parsed.hostname.replace(/^www\./, "").toLowerCase())) return null;
  const match = INSTAGRAM_PATH.exec(parsed.pathname);
  if (!match) return null;
  // "reels" and "reel" address the same thing; the mirror expects "reel".
  return { kind: match[1] === "reels" ? "reel" : match[1], code: match[2] };
}

/**
 * The embed Instagram renders for other websites to put a post in a page.
 *
 * The post's own page is an empty shell: the server sends an app and the
 * post arrives later over a request the page makes for itself, so a plugin
 * fetching the URL sees nothing but the og: tags meant for crawlers — one
 * image, square-cropped to 640 by the CDN transform baked into that URL's
 * signature, whatever the post actually holds. The embed is the opposite:
 * rendered on the server, public, no login, and it carries the post's own
 * data as JSON, every picture of a carousel at full size.
 *
 * Always /p/, whatever the link said. Instagram treats /p/, /reel/ and /tv/
 * as the same address and the embed answers for all three.
 */
export function instagramEmbedUrl(code: string): string {
  return `https://www.instagram.com/p/${code}/embed/captioned/`;
}

/** What the embed knows that the og: tags do not. */
export interface InstagramPost {
  /**
   * Every picture in the post that the embed names, in order. A video
   * contributes its poster.
   */
  media: ResolvedMedia[];
  /** The account that posted it, for `author:`. */
  author: string;
  /** A single video's own file, when the embed carries its address. */
  sourceVideoUrl?: string;
}

/**
 * Reads one JSON string literal out of a larger text, starting at its
 * opening quote, and returns it with the escapes resolved.
 *
 * The blob below is JSON inside a JSON string inside HTML, so it cannot be
 * found by matching brackets — every brace and quote in it is escaped. What
 * can be found is where the string starts, and from there the only thing
 * that ends it is an unescaped quote.
 */
function jsonStringFrom(text: string, quote: number): string | null {
  for (let i = quote + 1; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] === '"') {
      try {
        return JSON.parse(text.slice(quote, i + 1)) as string;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * The pictures and the author of a post, from its embed page.
 *
 * Most embeds carry the post's data as JSON, which names every picture of a
 * carousel and sometimes a video's file; that is read first. Some carry none
 * and draw the post on the server instead, and then the markup is read for
 * what it shows — see core/instagram-html.ts. Either may come back empty
 * when Instagram changes its page, and the caller then keeps the og: tags,
 * so each step falls back to the one after it rather than failing the clip.
 */
export function parseInstagramEmbed(html: string): InstagramPost | null {
  return parseEmbeddedPostData(html) ?? parseInstagramHtmlEmbed(html);
}

/**
 * The pictures and the author of a post, from the JSON its embed carries.
 *
 * A carousel is a `GraphSidecar` whose children each carry their own
 * `display_url`; a single picture and a video are the same object without
 * children, and a video's `display_url` is its poster — which is the right
 * thing for a wall either way.
 *
 * A video sometimes carries `video_url` as well: a finished mp4, served to
 * the plugin's own User-Agent. Sometimes, not always — one reel in three
 * had it when this was written, and which one did not depend on who asked.
 * When it is there it is passed on as `sourceVideoUrl` for the archiver to
 * fetch, which is the only way a phone, with no yt-dlp, gets the video at
 * all; when it is not, the poster stands and yt-dlp remains the route.
 * Only for a post without children: a carousel's videos are its children's
 * business, and nothing here reads them.
 *
 * Every address here is signed by the CDN for the size it names, which is
 * why the crop cannot simply be edited out of the og: one: rewriting that
 * URL's transform invalidates its signature and answers 403. These are the
 * uncropped originals, signed as such.
 *
 * Returns null for anything it does not recognise, including a post that
 * has been removed or made private and an embed that sent no data.
 */
function parseEmbeddedPostData(html: string): InstagramPost | null {
  const at = html.indexOf("gql_data");
  if (at < 0) return null;
  // The whole blob is escaped, so a raw `:"` cannot occur inside it: the
  // last one before the key is the quote that opens the enclosing string.
  const opens = html.lastIndexOf(':"', at);
  if (opens < 0) return null;

  const literal = jsonStringFrom(html, opens + 1);
  if (!literal) return null;

  let media: unknown;
  try {
    media = (JSON.parse(literal) as { gql_data?: { shortcode_media?: unknown } }).gql_data
      ?.shortcode_media;
  } catch {
    return null;
  }
  if (!media || typeof media !== "object") return null;

  const post = media as {
    display_url?: unknown;
    video_url?: unknown;
    owner?: { username?: unknown };
    edge_sidecar_to_children?: { edges?: Array<{ node?: { display_url?: unknown } }> };
  };

  const children = post.edge_sidecar_to_children?.edges;
  const edges = Array.isArray(children) && children.length > 0 ? children : null;
  const nodes = edges ? edges.map((edge) => edge?.node) : [post];

  const pictures: ResolvedMedia[] = [];
  for (const node of nodes) {
    const url = node?.display_url;
    if (typeof url === "string" && /^https:\/\//i.test(url)) {
      pictures.push({ url, kind: "image" });
    }
  }
  if (pictures.length === 0) return null;

  const author = typeof post.owner?.username === "string" ? post.owner.username : "";
  const result: InstagramPost = { media: pictures, author };
  if (!edges && typeof post.video_url === "string" && /^https:\/\//i.test(post.video_url)) {
    result.sourceVideoUrl = post.video_url;
  }
  return result;
}

/**
 * Hosts whose media a local yt-dlp can fetch directly. Checked before
 * spending a subprocess, so ordinary article clippings never pay for it.
 */
const DOWNLOADABLE_HOSTS = new Set([
  "instagram.com",
  "m.instagram.com",
  "instagr.am",
  "x.com",
  "twitter.com",
  "mobile.x.com",
  "mobile.twitter.com",
  "tiktok.com",
  "vm.tiktok.com",
  // Read from the list the thumbnail lookup uses. Two copies had drifted:
  // m.youtube.com, the address mobile Safari shares, got a cover and never
  // a video.
  ...YOUTUBE_HOSTS,
  "vimeo.com",
  "reddit.com",
  "bsky.app",
  // Threads is not a yt-dlp host: its video URL is sniffed from a hidden
  // webview on desktop instead. Listed here so the source-video pass runs.
  "threads.com",
  "threads.net",
]);

export interface SourceDownloadOptions {
  /**
   * The longest ordinary YouTube video to download, in minutes, from
   * settings. Absent or 0 downloads none. Shorts are downloaded either way.
   */
  youtubeVideoMinutes?: number;
}

/**
 * Whether a post's own video is worth a local yt-dlp run.
 *
 * YouTube is decided by what the address is rather than by its host alone:
 * see core/youtube.ts. A YouTube page that names no video, a channel say, is
 * never downloaded — yt-dlp would take it for a playlist of everything on it.
 */
export function supportsSourceDownload(
  url: string,
  options: SourceDownloadOptions = {}
): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (!DOWNLOADABLE_HOSTS.has(host)) return false;
    if (!YOUTUBE_HOSTS.has(host)) return true;
    return downloadsYoutubeVideo(url, options.youtubeVideoMinutes ?? 0);
  } catch {
    return false;
  }
}

/** True for a Threads post or share link, the hosts the webview sniff owns. */
export function isThreadsUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return host === "threads.com" || host === "threads.net";
  } catch {
    return false;
  }
}

/**
 * The video URL worth downloading, out of everything a page load touched.
 *
 * Threads hides its video from every server-side route — no og:video, no
 * yt-dlp extractor — so the sniffer loads the post in a webview and reads
 * back the <video> source and the resource-timing log. Byte-range params
 * are windowing, not identity: stripped so the pick is the whole file, and
 * so ranged requests for one video collapse to one URL. blob: and data:
 * sources cannot be re-fetched, and DASH segments are not the video.
 */
export function pickSniffedVideo(candidates: string[]): string | null {
  for (const raw of candidates) {
    if (!raw || !/^https:\/\//i.test(raw)) continue;
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    if (!/\.(mp4|m4v|mov|webm)$/i.test(parsed.pathname)) continue;
    parsed.searchParams.delete("bytestart");
    parsed.searchParams.delete("byteend");
    let out = parsed.toString();
    if (out.endsWith("?")) out = out.slice(0, -1);
    return out;
  }
  return null;
}

export function fxApiUrl(status: { user: string; id: string }): string {
  return `https://api.fxtwitter.com/${status.user}/status/${status.id}`;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Turns an fxtwitter payload into a resolved link. Pure. */
export function parseFxTweet(payload: unknown, sourceUrl: string): ResolvedLink | null {
  if (!payload || typeof payload !== "object") return null;
  const tweet = (payload as { tweet?: unknown }).tweet;
  if (!tweet || typeof tweet !== "object") return null;

  const t = tweet as Record<string, unknown>;
  const author = (t.author ?? {}) as Record<string, unknown>;
  const mediaBlock = (t.media ?? {}) as Record<string, unknown>;

  const media: ResolvedMedia[] = [];
  const seen = new Set<string>();
  for (const key of ["videos", "photos", "all"]) {
    const list = mediaBlock[key];
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const url = asText(item.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      // X serves every GIF as a silent, looping MP4, and fxtwitter labels it
      // "gif" rather than "video". It is still a video file: filed as an
      // image, the tile points an <img> at an .mp4 and the card is dropped.
      const type = asText(item.type);
      media.push({ url, kind: type === "video" || type === "gif" ? "video" : "image" });
    }
  }

  const text = asText(t.text);
  const name = asText(author.name);

  return {
    url: asText(t.url) || sourceUrl,
    title: text ? `${name || "Post"}: ${text.split("\n")[0]}`.slice(0, 120) : name || "Post",
    description: text,
    author: name,
    published: asText(t.created_at),
    media,
  };
}

/** Builds a resolved link from a page's own Open Graph metadata. Pure. */
export function parsePageMeta(html: string, sourceUrl: string): ResolvedLink {
  const meta = readMetaTags(html);
  const media: ResolvedMedia[] = [];
  const seen = new Set<string>();

  const add = (raw: string | undefined, kind: ResolvedMedia["kind"]): void => {
    if (!raw) return;
    let absolute: string;
    try {
      absolute = new URL(raw, sourceUrl).toString();
    } catch {
      return;
    }
    if (seen.has(absolute)) return;
    seen.add(absolute);
    media.push({ url: absolute, kind });
  };

  // Video first: a page that has one wants it shown over its poster. Only
  // when the page says it is a video file, though, or says nothing: og:video
  // is as often a player as a file. YouTube names its embed page there, with
  // og:video:type text/html, and an archiver that trusted the address saved
  // that page as the clip's video on any device that could not read the
  // response's type. The page's type is the one thing that says so before
  // anything is fetched.
  const videoType = meta.get("og:video:type");
  if (!videoType || kindForMime(videoType) === "video") {
    add(meta.get("og:video:secure_url") ?? meta.get("og:video:url") ?? meta.get("og:video"), "video");
  }
  add(meta.get("og:image:secure_url") ?? meta.get("og:image:url") ?? meta.get("og:image"), "image");
  add(meta.get("twitter:image"), "image");

  // The document title is the fallback: a page that declares no og:title,
  // as shops and older sites do, still has a name at the top of the tab.
  const title = meta.get("og:title") ?? meta.get("twitter:title") ?? documentTitle(html);
  const description = meta.get("og:description") ?? meta.get("twitter:description") ?? "";

  const link: ResolvedLink = {
    url: sourceUrl,
    title: title.trim(),
    description: description.trim(),
    author: (meta.get("article:author") ?? meta.get("twitter:creator") ?? "").trim(),
    published: (meta.get("article:published_time") ?? "").trim(),
    media,
  };
  const canonical = meta.get("og:url")?.trim();
  if (canonical && isHttpUrl(canonical)) link.canonical = canonical;
  return link;
}

/** The post's code out of a Threads post URL, or "" for a share link or a profile. */
export function threadsPostCode(url: string): string {
  return /\/post\/([A-Za-z0-9_-]+)/.exec(url)?.[1] ?? "";
}

/** `Name (@handle) on Threads`, in whatever language the page was served in. */
const THREADS_TITLE = /^(.*?)\s*\(@([A-Za-z0-9._]+)\)/;

/** How much of a post to promote into its title before it stops being one. */
const THREADS_TITLE_MAX = 90;

/**
 * A Threads post's page metadata, read as a post rather than as a page.
 *
 * og:title is `Name (@handle) on Threads`, localised — "у додатку Threads"
 * when the page was fetched from Ukraine — and says nothing about the post.
 * The post's own words are in og:description. So: the text becomes the
 * title, the handle becomes the author, and the description is kept as it
 * was. A post with no text keeps a title that at least names who wrote it.
 */
export function refineThreadsLink(link: ResolvedLink): ResolvedLink {
  const match = THREADS_TITLE.exec(link.title);
  const handle = match?.[2] ?? "";
  const text = link.description.replace(/\s+/g, " ").trim();

  let title = text;
  if (title.length > THREADS_TITLE_MAX) {
    const cut = title.slice(0, THREADS_TITLE_MAX);
    const space = cut.lastIndexOf(" ");
    title = `${space > THREADS_TITLE_MAX / 2 ? cut.slice(0, space) : cut}\u2026`;
  }
  if (!title) title = handle ? `@${handle} on Threads` : link.title;

  return {
    ...link,
    title,
    author: link.author || (handle ? `@${handle}` : ""),
  };
}

/**
 * The post's own pictures out of every image URL a rendered Threads page
 * loads, in page order.
 *
 * Instagram's CDN encodes what a picture is in its path: `t51.…-15` is post
 * media, `t51.…-19` is a profile picture. Avatars — the author's, and every
 * commenter's — are dropped by that alone. Sizes are deduplicated on the
 * path, since the same picture is requested at several widths with different
 * query strings, and the first occurrence is kept, which is the carousel's
 * own order.
 */
export function pickThreadsImages(urls: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (!/cdninstagram\.com$|fbcdn\.net$/i.test(url.hostname)) continue;
    if (!/\/t51\.[0-9]+-15\//.test(url.pathname)) continue;
    if (!/\.(jpe?g|png|webp)$/i.test(url.pathname)) continue;
    const key = url.pathname;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

const TITLE_TAG = /<title[^>]*>([\s\S]*?)<\/title>/i;

function documentTitle(html: string): string {
  const raw = TITLE_TAG.exec(html)?.[1] ?? "";
  return decodeEntities(raw).replace(/\s+/g, " ").trim();
}

const AMAZON_HOST = /(^|\.)amazon\.[a-z.]+$/i;
const AMAZON_PRODUCT = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i;

/**
 * Identifies a product page on any Amazon storefront. Amazon publishes no
 * Open Graph tags at all, so the cover and the title have to be read off
 * the page itself; see parseAmazonPage.
 */
export function amazonProduct(url: string): { asin: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!AMAZON_HOST.test(parsed.hostname)) return null;
  const match = AMAZON_PRODUCT.exec(parsed.pathname);
  return match ? { asin: match[1].toUpperCase() } : null;
}

/**
 * The original behind an Amazon image rendition. The CDN sizes by a
 * modifier in the filename, 61f8IVzjEDL._SL1000_.jpg, and serves the
 * original when it is left off.
 */
export function amazonOriginal(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!AMAZON_IMAGE_HOST.test(parsed.hostname)) return url;
  parsed.pathname = parsed.pathname.replace(AMAZON_IMAGE_MODIFIER, "$1$2");
  return parsed.toString();
}

const AMAZON_HIRES_ATTR = /data-old-hires="([^"]+)"/;
const AMAZON_HIRES_JSON = /"hiRes"\s*:\s*"(https?:[^"]+)"/;
const AMAZON_DYNAMIC = /data-a-dynamic-image="([^"]+)"/;
const AMAZON_TITLE = /<span[^>]*id="productTitle"[^>]*>([\s\S]*?)<\/span>/;
/** The storefront's tail on the document title: ": Books - Amazon.ca". */
const AMAZON_TITLE_TAIL = /\s*[-:|]\s*Amazon(\.[a-z.]+)?\s*$/i;

/**
 * Reads a product page's cover and title. The cover is the landing image's
 * hi-res original, declared three ways on the page, tried in order of how
 * reliably they are there: the data-old-hires attribute, the hiRes entry in
 * the image block's data, and the largest rendition in the dynamic image
 * map. Whichever is found is reduced to the original. The title is the
 * product's own, or the document title with the storefront's tail removed.
 */
export function parseAmazonPage(html: string, sourceUrl: string): ResolvedLink {
  let cover = AMAZON_HIRES_ATTR.exec(html)?.[1] ?? AMAZON_HIRES_JSON.exec(html)?.[1] ?? "";
  if (!cover) {
    const dynamic = AMAZON_DYNAMIC.exec(html)?.[1];
    if (dynamic) {
      try {
        const map = JSON.parse(decodeEntities(dynamic)) as Record<string, [number, number]>;
        let best = 0;
        for (const [url, size] of Object.entries(map)) {
          const area = (size?.[0] ?? 0) * (size?.[1] ?? 0);
          if (area > best) {
            best = area;
            cover = url;
          }
        }
      } catch {
        cover = "";
      }
    }
  }

  const product = AMAZON_TITLE.exec(html)?.[1];
  const title = product
    ? decodeEntities(product).replace(/\s+/g, " ").trim()
    : documentTitle(html).replace(AMAZON_TITLE_TAIL, "").trim();

  return {
    url: sourceUrl,
    title,
    description: "",
    author: "",
    published: "",
    media: cover ? [{ url: amazonOriginal(decodeEntities(cover)), kind: "image" }] : [],
  };
}

/**
 * A clipping made of nothing but its address.
 *
 * For a page that could not be read at all — Medium answers 403 to anything
 * that is not a browser, Dribbble returns no bytes — and for one that was
 * read and simply has no picture in it. Saving the address is not much, but
 * it is the difference between a clipping you can find later and a notice
 * that vanished in three seconds.
 *
 * The title is left empty on purpose: noteNameFor falls back to the host and
 * the path, which is a better name than a guess dressed up as a title.
 */
export function bareLink(url: string): ResolvedLink {
  return { url, title: "", description: "", author: "", published: "", media: [] };
}

/** Vault-safe note name derived from a title, never empty. */
export function noteNameFor(title: string, url: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned) return cleaned.slice(0, 100).trim();

  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname}`
      .replace(/[\\/:*?"<>|#^[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100);
  } catch {
    return "Untitled clipping";
  }
}

/** A value quoted for a line of YAML frontmatter. */
export function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
}

function today(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Matches the Web Clipper's frontmatter contract, which the vault treats as fixed. */
/**
 * `grid` is written only when the capture is going somewhere other than home.
 * Home is the absence of the key, so stamping it would put a redundant line
 * in every note the plugin creates.
 */
export function buildNote(link: ResolvedLink, created = today(), grid = ""): string {
  const lines = [
    "---",
    `title: ${yamlString(link.title)}`,
    `source: ${yamlString(link.url)}`,
  ];
  if (link.origin) lines.push(`origin: ${yamlString(link.origin)}`);
  lines.push("author:");
  if (link.author) lines.push(`  - ${yamlString(link.author)}`);
  // No trailing space on an empty value; the Linter would strip it anyway.
  lines.push(link.published ? `published: ${yamlString(link.published)}` : "published:");
  lines.push(`created: ${created}`);
  lines.push(`description: ${yamlString(link.description)}`);
  lines.push("tags:", '  - "clippings"');
  if (grid) lines.push(`grid: ${yamlString(grid)}`);
  lines.push("---", "");

  if (link.description) lines.push(link.description, "");

  for (const item of link.media) {
    // Prefer the archived file: an embed of a local path keeps playing after
    // the signed CDN url in the original post has expired.
    if (item.localPath) {
      lines.push(`![[${item.localPath}]]`, "");
    } else if (item.kind === "video") {
      lines.push(`<video src="${item.url}" controls=""></video>`, "");
    } else {
      lines.push(`![](${item.url})`, "");
    }
  }

  lines.push(`[${link.url}](${link.url})`, "");

  // Under the address rather than over it, because the top of the note is
  // the clipping — the picture and where it came from — and this is the
  // page's own words kept underneath. A rule between them says as much.
  if (link.article) lines.push("---", "", link.article, "");

  return lines.join("\n");
}

/**
 * Note for a page scanned into one picture. Shaped like a link clipping,
 * with the page as its source, but with the scan declared as `cover:` the
 * way a pasted image is: the scanner reads cover, not embeds, and without
 * it the archiver would fetch the page's own social card and the tile would
 * show that instead of the scan.
 */
export function buildScanNote(
  title: string,
  url: string,
  attachmentPath: string,
  created: string,
  grid = "",
  article = ""
): string {
  return [
    "---",
    `title: ${yamlString(title)}`,
    `source: ${yamlString(url)}`,
    "author:",
    "published:",
    `created: ${created}`,
    "description:",
    "tags:",
    '  - "clippings"',
    `cover: ${yamlString(attachmentPath)}`,
    ...(grid ? [`grid: ${yamlString(grid)}`] : []),
    "---",
    "",
    `![[${attachmentPath}]]`,
    "",
    `[${url}](${url})`,
    "",
    // A scan is a picture of the page; the article is the page's words. A
    // clipping that has both is searchable by what it says as well as
    // findable by what it looks like.
    ...(article ? ["---", "", article, ""] : []),
  ].join("\n");
}

/**
 * Note body for an image pasted straight from the clipboard, which has no
 * source page to describe it. `media:` carries the vault path so the
 * scanner and the grid treat it like any other clipping.
 */
export function buildPastedImageNote(
  title: string,
  attachmentPath: string,
  created: string,
  grid = ""
): string {
  return [
    "---",
    `title: ${yamlString(title)}`,
    "source:",
    "author:",
    "published:",
    `created: ${created}`,
    "description:",
    "tags:",
    '  - "clippings"',
    // A plain string: the scanner reads cover with str(), so a list here
    // would parse as empty and the clipping would have no tile at all.
    `cover: ${yamlString(attachmentPath)}`,
    ...(grid ? [`grid: ${yamlString(grid)}`] : []),
    "---",
    "",
    `![[${attachmentPath}]]`,
    "",
  ].join("\n");
}
