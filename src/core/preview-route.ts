import type { CacheEntry } from "./cache";
import { extensionOf, kindForExtension, needsPreview } from "./formats";
import type { MediaKind } from "./formats";
import { dedupeMedia, normalizeUrl } from "./normalize";
import type { ClippingRecord } from "./scan";

/**
 * How a file the wall cannot paint as it stands gets the picture it is
 * painted through, on whichever device happens to be asked.
 *
 * There are two ways to make one, and which of them a device has is the
 * whole question. A desktop can run a program: sips reads HEIC, TIFF and
 * every major RAW, ffmpeg pulls a frame out of an AVI. A phone cannot, but
 * an iPhone's webview decodes with the system's own image code, which since
 * Safari 17 includes HEIC — the format nearly every photo on that phone is
 * in. Chromium, on the desktop and on Android, decodes none of it.
 *
 * Both routes write the same PNG to the same previewPath, so a preview made
 * on the phone is adopted by the desktop when the vault syncs, and the other
 * way round. Pure: the shell runs the programs and draws the canvas, this
 * decides which of those to try and what to say about the result.
 */

export type PreviewRoute = "tool" | "webview";

export interface PreviewDevice {
  /**
   * The program for this kind is installed and can run here: sips for a
   * picture, ffmpeg for a video. False on every phone.
   */
  tool: boolean;
  /** Whether the webview is still worth asking about this extension. */
  webview: boolean;
}

/**
 * The routes to try for one file, in order; the first to produce a preview
 * wins.
 *
 * The tool first, because where it exists it reads more formats than any
 * webview and never fails for want of memory. The webview behind it, for
 * pictures only: no webview plays the containers that need a preview in the
 * first place, and a desktop whose sips could not read a file loses nothing
 * by asking Chromium, which answers at once.
 */
export function previewRoutes(kind: MediaKind, device: PreviewDevice): PreviewRoute[] {
  const routes: PreviewRoute[] = [];
  if (device.tool) routes.push("tool");
  if (kind === "image" && device.webview) routes.push("webview");
  return routes;
}

/**
 * Why a file should be written off as having no preview, after every route
 * tried has failed, or null when it should be asked about again.
 *
 * Only a tool that ran and failed says something about the file. A webview
 * that could not decode it says something about the webview, and the cache
 * travels with the vault: written down on a phone, "could not decode" would
 * stop the desktop sharing that vault from ever running sips on the file.
 */
export function previewFailure(tried: readonly PreviewRoute[]): string | null {
  return tried.includes("tool") ? "conversion failed" : null;
}

/**
 * Which extensions this session's webview has decoded, and which it has
 * refused.
 *
 * Asking costs a read of the whole file, and on Android the answer for HEIC
 * is always no: a library of five hundred photos would read every one of
 * them on every background pass to hear it. So the first refusal of an
 * extension stands for the rest of the session — unless one of its files
 * has decoded before, in which case the refusal is about that file and the
 * next one is still worth asking about. Kept in memory rather than in the
 * cache, because it is a fact about this device.
 */
export class WebviewDecodes {
  private readonly decoded = new Set<string>();
  private readonly refused = new Set<string>();

  worthTrying(ext: string): boolean {
    const e = ext.toLowerCase();
    return this.decoded.has(e) || !this.refused.has(e);
  }

  record(ext: string, ok: boolean): void {
    (ok ? this.decoded : this.refused).add(ext.toLowerCase());
  }
}

/**
 * The largest canvas, in pixels, that WebKit on iOS will draw into. Beyond
 * it the canvas is silently blank and toBlob hands back nothing. Twelve
 * megapixels fits; the twenty-four an iPhone shoots by default does not.
 */
export const MAX_CANVAS_PIXELS = 4096 * 4096;

/**
 * The size a webview preview is drawn at: the picture's own, as sips writes
 * it, unless that is more canvas than an iPhone will give, in which case the
 * largest size with the same shape that fits.
 */
export function previewSize(
  width: number,
  height: number,
  maxPixels = MAX_CANVAS_PIXELS
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  if (width * height <= maxPixels) return { width, height };
  const scale = Math.sqrt(maxPixels / (width * height));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

/**
 * The files in the vault a clipping points at that need a preview before the
 * wall can paint them, with the cache key each is recorded under.
 *
 * Its embeds, and its hand-set `cover:`. The cover is a vault path from the
 * start and was left out of this once, which is how a HEIC set as a cover
 * never had a preview on any device: tile.ts looks the cover up in the
 * cache, and nothing had ever put it there. The key is the path, as
 * dedupeMedia makes it for any local ref, and as liveRefs counts it.
 */
export function localPreviewRefs(
  record: ClippingRecord
): Array<{ key: string; path: string; kind: MediaKind }> {
  const refs = dedupeMedia(record.media)
    .filter((media) => !isRemote(media.url))
    .map((media) => ({ key: media.key, path: media.url, kind: media.kind }));

  const cover = record.cover;
  if (cover && !isRemote(cover)) {
    const key = normalizeUrl(cover);
    const kind = kindForExtension(extensionOf(cover));
    if (kind && !refs.some((ref) => ref.key === key)) refs.push({ key, path: cover, kind });
  }

  return refs.filter((ref) => needsPreview(extensionOf(ref.path)));
}

function isRemote(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * Where a file just saved into the vault stands with the wall:
 *
 * - `shown`: it paints, as itself or through a preview that now exists.
 * - `unsupported`: nothing on this device could make its preview.
 * - `failed`: a program that reads the format ran and could not read it.
 */
export type PreviewOutcome = "shown" | "unsupported" | "failed";

export function previewOutcome(
  file: string,
  entry: Pick<CacheEntry, "thumb" | "thumbFailed"> | undefined
): PreviewOutcome {
  if (!needsPreview(extensionOf(file))) return "shown";
  if (entry?.thumb) return "shown";
  return entry?.thumbFailed ? "failed" : "unsupported";
}

/**
 * What to say about a picture that was saved but will not show, or null when
 * the ordinary confirmation is the truth.
 *
 * Not for a PDF. Its preview comes from Obsidian's own pdf.js, which says so
 * itself when it is missing, and a page that would not render is not a
 * question of which device is asking.
 */
export function previewNotice(file: string, outcome: PreviewOutcome): string | null {
  const ext = extensionOf(file);
  if (outcome === "shown" || ext === "pdf") return null;

  const video = kindForExtension(ext) === "video";
  const what = video ? "the video" : "the picture";
  const format = ext.toUpperCase();
  if (outcome === "failed") return `Goko: saved ${what}, but this ${format} could not be converted to show it`;
  // Only sips converts a picture, and only macOS has sips; ffmpeg runs on
  // any desktop that has it installed.
  const converter = video ? "on a desktop with ffmpeg" : "on a Mac";
  return `Goko: saved ${what}, but this device can't show ${format} — it will appear once Goko ${converter} converts it`;
}

/**
 * The same notices, held to one per format for a batch.
 *
 * A single picture is told about every time. Forty dropped at once are told
 * about once: the notice is about what the device can do, and forty copies
 * of it would bury the one saying the import finished.
 */
export class PreviewNotices {
  private readonly said = new Set<string>();

  after(file: string, outcome: PreviewOutcome, batch = false): string | null {
    const notice = previewNotice(file, outcome);
    if (!notice || !batch) return notice;
    if (this.said.has(notice)) return null;
    this.said.add(notice);
    return notice;
  }
}
