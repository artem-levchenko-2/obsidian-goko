import { readDimensions } from "./dimensions";
import { defaultExtension, kindForMime } from "./formats";
import { hashUrl } from "./hash";
import type { CanonicalMedia } from "./normalize";

export interface FetchResult {
  status: number;
  arrayBuffer: ArrayBuffer;
  contentType?: string;
}

export type Fetcher = (
  url: string,
  headers: Record<string, string>
) => Promise<FetchResult>;

export interface ArchiveDeps {
  fetch: Fetcher;
  exists: (path: string) => Promise<boolean>;
  write: (path: string, data: ArrayBuffer) => Promise<void>;
  folder: string;
  maxBytes: number;
  /**
   * A lighter copy of the same picture, or "": the JPEG a CDN renders of an
   * original that is kept only because it might be see-through. Tried when
   * the original is refused, and taken in its place when `opaque` says the
   * original did not need keeping.
   */
  standIn?: (url: string) => string;
  /** Whether a downloaded picture has no see-through pixels at all. */
  opaque?: (data: ArrayBuffer) => Promise<boolean>;
}

export interface ArchiveOutcome {
  key: string;
  kind: "image" | "video";
  file?: string;
  width?: number;
  height?: number;
  bytes?: number;
  failed?: string;
  /**
   * Nothing landed, and nothing is worth writing down about it: the attempt
   * failed for a reason that was about this moment rather than about this
   * file. The cache leaves such a key alone, so the next pass tries again as
   * though it had never been asked.
   */
  transient?: true;
}

/**
 * Extensions a source-video download can land under, mp4 first because that
 * is what yt-dlp is asked for. Ordered, so the first existing candidate wins.
 */
const SOURCE_VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "m4v", "mkv"];

/**
 * Every path a source video for this key could live at.
 *
 * Looked for by name rather than trusted to the cache, so a device that
 * cannot run yt-dlp still adopts the file another device downloaded. The
 * cache travels with the vault too — see isDeviceLimit — but a file that is
 * simply there is the better answer either way.
 */
export function sourceVideoCandidates(key: string, folder: string): string[] {
  const hash = hashUrl(key);
  return SOURCE_VIDEO_EXTENSIONS.map((ext) => `${folder}/${hash}-video.${ext}`);
}

/** Statuses that hotlink protection returns and that a Referer may fix. */
const RETRYABLE = new Set([401, 403, 429]);

/** Chromium's transport errors, which is the shape Electron's net throws. */
const TRANSPORT_ERROR = /\bERR_[A-Z_]+/;

/**
 * Whether a failure was about this moment rather than about this file.
 *
 * A server that answers 404, or 403 from behind a challenge page, will
 * answer the same tomorrow, and writing that down is what stops the
 * archiver paying for it on every pass. A tunnel that came up, a wifi that
 * dropped, a gateway that was briefly busy — none of those say anything
 * about the file. Recording one as though it did leaves the card without
 * its picture for good, until somebody runs a full re-archive by hand and
 * knows that is the thing to do.
 *
 * The one that prompted this was net::ERR_BLOCKED_BY_CLIENT: a VPN's own ad
 * blocker cut two requests, and the two clippings kept a sheet of words
 * where their pictures should have been long after it was switched off.
 */
export function isTransient(reason: string): boolean {
  if (TRANSPORT_ERROR.test(reason)) return true;

  const status = /^HTTP (\d{3})$/.exec(reason);
  if (!status) return false;
  const code = Number(status[1]);
  // A timeout, a queue that was full, too many requests, and everything the
  // server blames on itself.
  return code === 408 || code === 425 || code === 429 || code >= 500;
}

/**
 * The failures that are facts about a device rather than about a post.
 *
 * Named here rather than written at the places they are recorded, so the
 * guard that has to recognise them cannot drift from the strings it is
 * matching.
 */
export const NO_YTDLP = "yt-dlp not available";
export const NEEDS_DESKTOP = "video needs the desktop app";
/** The post's sound comes as a separate stream, and this device cannot join it. */
export const NEEDS_FFMPEG = "video needs ffmpeg";

/**
 * Whether a recorded failure is about the device that recorded it.
 *
 * The cache was built on the assumption that it does not travel: "the
 * attachment folder syncs but the cache does not" is written into the
 * archiver. That is untrue of a vault synced whole. cache.json sits in
 * .obsidian/plugins/goko/, and iCloud, Obsidian Sync and Dropbox all carry
 * it along with everything else.
 *
 * So a phone, which can run neither yt-dlp nor a webview, wrote "yt-dlp not
 * available" against every reel it clipped, and the desktop — which has both
 * — read that back as a settled fact about the post and never tried. Four
 * reels in this vault sat with no video for that reason, and nothing about
 * them looked broken: the note had its poster, the card had its picture.
 *
 * This is the same mistake as recording a dropped connection as a permanent
 * failure, one layer up: a fact about here and now, written down as a fact
 * about the thing. Both are still recorded, because a missing tool should be
 * diagnosable from the cache; neither is believed by a device the limit does
 * not apply to.
 */
export function isDeviceLimit(reason: string): boolean {
  return reason === NO_YTDLP || reason === NEEDS_DESKTOP || reason === NEEDS_FFMPEG;
}
const UNSAFE_CHARS = /[^a-zA-Z0-9._-]/g;
const MAX_BASENAME = 80;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `<12 hex of the normalized url>-<original basename>`. The hash comes from
 * the normalized key, so every size variant of one asset maps to one file,
 * and render-time repair can find that file from any variant's URL alone.
 */
export function archiveFilename(media: CanonicalMedia): string {
  let base = "";
  try {
    base = decodeURIComponent(new URL(media.url).pathname.split("/").pop() ?? "");
  } catch {
    base = "";
  }
  base = base.replace(UNSAFE_CHARS, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!base) base = "media";

  if (!/\.[a-z0-9]{2,5}$/i.test(base)) {
    base += `.${defaultExtension(media.kind)}`;
  }
  if (base.length > MAX_BASENAME) {
    const dot = base.lastIndexOf(".");
    base = base.slice(0, 60) + base.slice(dot);
  }
  return `${hashUrl(media.key)}-${base}`;
}

/** Downloads and validates one URL. Returns a reason string on failure. */
async function attempt(
  url: string,
  referer: string,
  deps: ArchiveDeps
): Promise<FetchResult | string> {
  let response: FetchResult;
  try {
    response = await deps.fetch(url, {});
  } catch (error) {
    return errorMessage(error);
  }
  if (RETRYABLE.has(response.status) && referer) {
    try {
      response = await deps.fetch(url, { Referer: referer });
    } catch {
      // The server has already answered. A retry cut short on this side, a
      // blocker refusing the Referer being the one met, says nothing new
      // about the file, and reporting it instead would make a refusal read
      // as a moment's trouble: never written down, so the tile kept a dead
      // picture rather than falling back to the page's own.
    }
  }

  if (response.status < 200 || response.status >= 300) return `HTTP ${response.status}`;

  const bytes = response.arrayBuffer.byteLength;
  if (bytes === 0) return "empty response";
  if (bytes > deps.maxBytes) return `too large (${bytes} bytes)`;

  // A clipping can point markdown image syntax at a web page. Trust the
  // server's content type over the markup that referenced it — unless the
  // server declined to name one. A CDN that serves every object as
  // binary/octet-stream (Stripe's docs images, for one) is not saying "this
  // is not a picture", it is saying nothing; the bytes say what they are.
  // No type at all is the same silence and is judged the same way. Let
  // through unread, it was how a phone that could not see the header saved
  // a video host's player page as the video.
  // Asked of formats.ts rather than matched here, so there is one answer to
  // "does the wall take this?" whichever way the file arrives — downloaded,
  // dropped from Finder, or pasted. A PDF is the reason it is a question
  // rather than a prefix: its type is neither image/ nor video/.
  const contentType = response.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!kindForMime(contentType)) {
    const silent = !contentType || isGenericType(contentType);
    if (!silent || !looksLikeMedia(response.arrayBuffer)) {
      return `unexpected content type ${contentType || "(none)"}`;
    }
  }

  return response;
}

/** Content types that describe a container, not a kind: the server did not commit. */
function isGenericType(contentType: string): boolean {
  return (
    contentType === "application/octet-stream" ||
    contentType === "binary/octet-stream" ||
    contentType === "application/binary" ||
    contentType === "application/unknown" ||
    contentType === "unknown/unknown"
  );
}

/**
 * Whether the first bytes carry a signature something the wall can show
 * starts with: PNG, JPEG, GIF, WebP and AVIF/HEIC (ISO media boxes, which
 * also open MP4/MOV), WebM/MKV's EBML header, and PDF.
 */
export function looksLikeMedia(buffer: ArrayBuffer): boolean {
  const b = new Uint8Array(buffer);
  if (b.length < 12) return false;
  const ascii = (from: number, length: number): string =>
    String.fromCharCode(...b.subarray(from, from + length));
  if (b[0] === 0x89 && ascii(1, 3) === "PNG") return true;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  if (ascii(0, 3) === "GIF") return true;
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return true;
  // ISO base media: a size then "ftyp" — AVIF, HEIC, MP4, MOV, M4V.
  if (ascii(4, 4) === "ftyp") return true;
  // EBML: WebM and Matroska.
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return true;
  // A PDF, which the wall shows as its first page.
  if (ascii(0, 5) === "%PDF-") return true;
  return false;
}

export async function archiveOne(
  media: CanonicalMedia,
  referer: string,
  deps: ArchiveDeps
): Promise<ArchiveOutcome> {
  const base: ArchiveOutcome = { key: media.key, kind: media.kind };
  const standIn = media.kind === "image" ? (deps.standIn?.(media.url) ?? "") : "";
  const candidates = [media.url, ...(media.fallbacks ?? [])];
  if (standIn && !candidates.includes(standIn)) candidates.push(standIn);

  const pathFor = (url: string): string =>
    `${deps.folder}/${archiveFilename({ ...media, url })}`;

  for (const url of candidates) {
    const path = pathFor(url);
    if (await deps.exists(path)) return { ...base, file: path };
  }

  let lastFailure = "no source url";

  for (const candidate of candidates) {
    let url = candidate;
    let result = await attempt(url, referer, deps);
    if (typeof result === "string") {
      lastFailure = result;
      continue;
    }

    // An original kept for its transparency that turns out to have none is
    // the stand-in's picture at many times the size. The stand-in is saved
    // instead, and the original stays if the stand-in will not come.
    if (url === media.url && standIn && deps.opaque && (await deps.opaque(result.arrayBuffer))) {
      const lighter = await attempt(standIn, referer, deps);
      if (typeof lighter !== "string") {
        url = standIn;
        result = lighter;
      }
    }

    const path = pathFor(url);
    try {
      await deps.write(path, result.arrayBuffer);
    } catch (error) {
      return { ...base, failed: errorMessage(error) };
    }

    const dimensions = media.kind === "image" ? readDimensions(result.arrayBuffer) : null;
    return {
      ...base,
      file: path,
      bytes: result.arrayBuffer.byteLength,
      width: dimensions?.width,
      height: dimensions?.height,
    };
  }

  return isTransient(lastFailure) ? { ...base, transient: true } : { ...base, failed: lastFailure };
}

export async function archiveAll(
  list: CanonicalMedia[],
  referer: string,
  deps: ArchiveDeps,
  concurrency = 4,
  onItemDone?: (completed: number, total: number) => void
): Promise<ArchiveOutcome[]> {
  const results = new Array<ArchiveOutcome>(list.length);
  let cursor = 0;
  let completed = 0;

  const worker = async (): Promise<void> => {
    while (cursor < list.length) {
      const index = cursor++;
      results[index] = await archiveOne(list[index], referer, deps);
      completed++;
      onItemDone?.(completed, list.length);
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, list.length) }, worker);
  await Promise.all(workers);
  return results;
}
