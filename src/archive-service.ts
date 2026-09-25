import { App, Notice, Platform, TFile, normalizePath, requestUrl } from "obsidian";
import {
  ArchiveDeps,
  ArchiveOutcome,
  NEEDS_DESKTOP,
  NEEDS_FFMPEG,
  NO_YTDLP,
  archiveAll,
  isDeviceLimit,
  sourceVideoCandidates,
} from "./core/archive";
import { MediaCache } from "./core/cache";
import { readDimensions } from "./core/dimensions";
import {
  absolutePath,
  conversionAvailable,
  convertImageToPng,
  downloadSourceVideo,
  extractVideoFrame,
  extractVideoFrameData,
  ffmpegPath,
  sipsPath,
  ytdlpPath,
} from "./convert";
import {
  posterPath,
  previewPath,
  renderPoster,
  renderStill,
  renderThumbnail,
  thumbPath,
} from "./core/derive";
import type { Rendered } from "./core/derive";
import { extensionOf, kindForExtension, needsPreview } from "./core/formats";
import { mimeForPath } from "./core/file-clip";
import {
  WebviewDecodes,
  localPreviewRefs,
  previewFailure,
  previewOutcome,
  previewRoutes,
} from "./core/preview-route";
import type { PreviewOutcome } from "./core/preview-route";
import { posterFailure, posterRoutes, retriesPoster } from "./core/poster-route";
import type { PosterDevice, PosterRoute } from "./core/poster-route";
import { renderPdfCover } from "./pdf-cover";
import { ClippingIndex } from "./index-store";
import { hashUrl } from "./core/hash";
import { dedupeMedia, normalizeUrl, sourceVideoKeyFor } from "./core/normalize";
import { pinimgStandIn } from "./core/pinterest";
import { isOpaque } from "./core/alpha";
import { isThreadsUrl, supportsSourceDownload } from "./core/resolve";
import { youtubeDurationCap } from "./core/youtube";
import { sniffVideoUrl } from "./sniff";
import { USER_AGENT } from "./capture";
import { placePageVideo } from "./core/page-video";
import { headerValue } from "./core/response-headers";
import type { CanonicalMedia } from "./core/normalize";
import { extractPageImage, knownHostThumbnail, needsPageCover } from "./core/page-cover";
import { ownVideo } from "./core/source-video";
import type { ClippingRecord } from "./core/scan";
import type { GokoSettings } from "./core/settings";

const CACHE_FILE = "cache.json";

export interface ArchiveSummary {
  ok: number;
  failed: number;
}

export class ArchiveService {
  cache = new MediaCache();
  private running = false;
  /** What this device's webview has shown it can decode, for this session. */
  private webview = new WebviewDecodes();
  private listeners: Array<() => void> = [];

  constructor(
    private app: App,
    private index: ClippingIndex,
    private settings: () => GokoSettings,
    private cacheDir: string
  ) {}

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  /** Whether a background pass is downloading right now. */
  get busy(): boolean {
    return this.running;
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  private cachePath(): string {
    return normalizePath(`${this.cacheDir}/${CACHE_FILE}`);
  }

  async loadCache(): Promise<void> {
    const path = this.cachePath();
    if (!(await this.app.vault.adapter.exists(path))) return;
    try {
      this.cache = MediaCache.fromJSON(JSON.parse(await this.app.vault.adapter.read(path)));
    } catch {
      this.cache = new MediaCache();
    }
  }

  async saveCache(): Promise<void> {
    // Another device may have written since this one read, a phone clipping
    // while the desktop is open. What it wrote is folded in before this
    // device's copy replaces the file, or it would be lost with it.
    await this.absorbFromDisk();
    await this.app.vault.adapter.write(this.cachePath(), JSON.stringify(this.cache.toJSON()));
  }

  /**
   * Reads cache.json as it is on disk now and keeps what this device does
   * not already know. Also run before a background pass, so a clip synced in
   * from a phone arrives with its posters and sizes instead of this device
   * working them out again. A file that will not parse, half-written by a
   * sync still in flight, is left for the next time.
   */
  private async absorbFromDisk(): Promise<void> {
    const path = this.cachePath();
    try {
      if (!(await this.app.vault.adapter.exists(path))) return;
      this.cache.absorb(MediaCache.fromJSON(JSON.parse(await this.app.vault.adapter.read(path))));
    } catch {
      // Unreadable just now: this device's copy is what gets written.
    }
  }

  private async ensureFolder(): Promise<void> {
    const folder = normalizePath(this.settings().attachmentFolder);
    if (!this.app.vault.getFolderByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => {});
    }
  }

  private deps(): ArchiveDeps {
    return {
      fetch: async (url, headers) => {
        const response = await requestUrl({ url, method: "GET", headers, throw: false });
        return {
          status: response.status,
          arrayBuffer: response.arrayBuffer,
          contentType: headerValue(response.headers, "content-type"),
        };
      },
      exists: (path) =>
        Promise.resolve(this.app.vault.getFileByPath(normalizePath(path)) !== null),
      write: async (path, data) => {
        await this.app.vault.createBinary(normalizePath(path), data);
      },
      folder: normalizePath(this.settings().attachmentFolder),
      maxBytes: this.settings().maxBytes,
      standIn: pinimgStandIn,
      opaque: isOpaque,
    };
  }

  private static mimeFor(path: string): string {
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    const map: Record<string, string> = {
      mp4: "video/mp4",
      webm: "video/webm",
      mov: "video/quicktime",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      avif: "image/avif",
      svg: "image/svg+xml",
    };
    return map[ext] ?? "application/octet-stream";
  }

  /**
   * Loads an archived file as a blob: URL rather than an app:// resource
   * URL. app:// is cross-origin to the page, which taints the canvas and
   * makes toBlob throw; blob: is same-origin and does not.
   */
  private async blobUrl(path: string): Promise<{ url: string; revoke: () => void } | null> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) return null;
    const data = await this.app.vault.readBinary(file);
    const url = URL.createObjectURL(new Blob([data], { type: ArchiveService.mimeFor(path) }));
    return { url, revoke: () => URL.revokeObjectURL(url) };
  }

  /**
   * Generates thumbnails and video posters for anything archived but not yet
   * derived. Separate from downloading so a failed render never loses the
   * original, and so it can be re-run cheaply.
   *
   * `keys` scopes the pass to just-archived entries, so capture is never
   * blocked behind the whole vault's backlog; the background pass runs
   * unscoped and works through everything.
   */
  async deriveAssets(keys?: ReadonlySet<string>): Promise<void> {
    const width = this.settings().thumbnailWidth;
    const device = this.posterDevice();
    let derived = 0;

    for (const entry of this.cache.entries()) {
      if (keys && !keys.has(entry.key)) continue;
      if (!entry.file || entry.thumb) continue;

      // A format Chromium cannot decode is unusable until it has a preview,
      // so that takes priority over the ordinary still. Tiles paint plain
      // images as originals, so a still is only worth generating for the two
      // things that need one: posting a video and freezing a GIF.
      const wantsPreview = needsPreview(extensionOf(entry.file));
      const target = wantsPreview
        ? previewPath(entry.file)
        : entry.kind === "video"
          ? posterPath(entry.file)
          : /\.gif$/i.test(entry.file)
            ? thumbPath(entry.file)
            : null;
      if (!target) continue;

      // Another device may already have rendered this, and the file itself
      // is the better evidence: adopting it skips the render and outranks
      // whatever the cache remembers about a past attempt.
      if (await this.adoptDerived(entry.key, target)) {
        derived++;
        continue;
      }

      if (entry.failed) continue;
      // A video's poster failure is looked at again by a device that can do
      // more than the one that wrote it; see core/poster-route.ts. Every
      // other failure stands until the archive-everything command clears it.
      const poster = !wantsPreview && entry.kind === "video";
      if (entry.thumbFailed && !(poster && retriesPoster(entry.thumbFailed, device))) continue;

      if (wantsPreview) {
        // A PDF goes through the app's own pdf.js, everything else through
        // a program or the webview. Each records its own failures, since
        // each is the one that can tell a file it will never read from a
        // device that cannot read it.
        const preview =
          extensionOf(entry.file) === "pdf"
            ? await this.renderPdfPreview(entry.key, entry.file)
            : await this.renderPreview(entry.key, entry.file, entry.kind);
        if (preview) {
          this.cache.setThumb(entry.key, preview.path, preview.width, preview.height);
          derived++;
        }
        continue;
      }

      if (poster) {
        const rendered = await this.renderVideoPoster(entry.key, entry.file, width, device);
        if (!rendered) continue;
        const path = normalizePath(target);
        try {
          if (!this.app.vault.getFileByPath(path)) {
            await this.app.vault.createBinary(path, rendered.data);
          }
        } catch (error) {
          // Almost always the file landing twice, another device or an earlier
          // pass having written it. adoptDerived picks it up next time round.
          console.warn(`Goko: could not write ${path} (${String(error)})`);
          continue;
        }
        this.cache.setThumb(entry.key, path, rendered.width, rendered.height);
        derived++;
        continue;
      }

      const source = await this.blobUrl(entry.file);
      if (!source) continue;

      try {
        const rendered = await renderThumbnail(source.url, width);
        if (!rendered) {
          // Recorded so a GIF this device cannot decode is not asked about on
          // every pass. The explicit archive-everything command clears these
          // marks, and adoption above outranks them.
          this.cache.setThumbFailed(entry.key, "render failed");
          continue;
        }

        if (!this.app.vault.getFileByPath(normalizePath(target))) {
          await this.app.vault.createBinary(normalizePath(target), rendered.data);
        }
        this.cache.setThumb(entry.key, target, rendered.width, rendered.height);
        derived++;
      } catch {
        this.cache.setThumbFailed(entry.key, "render failed");
        continue;
      } finally {
        source.revoke();
      }
    }

    if (derived > 0) this.emit();
  }

  /** What this device can bring to a video's poster. */
  private posterDevice(): PosterDevice {
    return {
      desktop: Platform.isDesktopApp,
      ffmpeg: conversionAvailable() && ffmpegPath() !== null,
    };
  }

  /**
   * A still for a video, by whichever route this device has, with the
   * video's own size; core/poster-route.ts decides which routes, in what
   * order, and what a failure is written down as. A route that could not
   * run at all has tried nothing and leaves nothing written.
   */
  private async renderVideoPoster(
    key: string,
    file: string,
    width: number,
    device: PosterDevice
  ): Promise<Rendered | null> {
    const tried: PosterRoute[] = [];
    for (const route of posterRoutes(device)) {
      const rendered =
        route === "tool"
          ? await this.toolPoster(file, width)
          : await this.webviewPoster(file, width);
      if (rendered === undefined) continue;
      tried.push(route);
      if (rendered) return rendered;
    }
    const failure = posterFailure(tried, device);
    if (failure) this.cache.setThumbFailed(key, failure);
    return null;
  }

  /** A frame the webview draws out of a <video>; undefined when the file cannot be read. */
  private async webviewPoster(file: string, width: number): Promise<Rendered | null | undefined> {
    const source = await this.blobUrl(file);
    if (!source) return undefined;
    try {
      return await renderPoster(source.url, width);
    } catch {
      return null;
    } finally {
      source.revoke();
    }
  }

  /**
   * A frame ffmpeg reads out of the file, scaled and encoded by the webview
   * into the same poster the webview route writes. Its size is the video's,
   * turned the way it plays, since ffmpeg applies the rotation a phone
   * records. Undefined when there is no file on disk to give ffmpeg: one not
   * yet in the vault's registry would otherwise read as ffmpeg failing on it.
   */
  private async toolPoster(file: string, width: number): Promise<Rendered | null | undefined> {
    const path = normalizePath(file);
    const from = this.app.vault.getFileByPath(path) ? absolutePath(this.app.vault, path) : null;
    if (!from) return undefined;
    const frame = await extractVideoFrameData(from);
    if (!frame) return null;
    const url = URL.createObjectURL(new Blob([frame], { type: "image/png" }));
    try {
      return await renderThumbnail(url, width);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Records an already-derived file that synced in from another device. The
   * derived file's dimensions are the scaled render, not the intrinsic size,
   * but they carry the same aspect ratio, which is all layout needs.
   */
  private async adoptDerived(key: string, target: string): Promise<boolean> {
    const path = normalizePath(target);
    const file = this.app.vault.getFileByPath(path);
    if (!file) return false;
    const dimensions = readDimensions(await this.app.vault.readBinary(file));
    this.cache.setThumb(key, path, dimensions?.width ?? 0, dimensions?.height ?? 0);
    return true;
  }

  /** Reports archive progress for a single record, for the capture bar. */
  onRecordProgress: ((completed: number, total: number) => void) | null = null;

  /**
   * @param retryFailed re-attempt refs that failed before. Off for the
   * background pass, so a page that returns HTML is not re-downloaded on
   * every launch; on for the explicit command, so a transient outage or a
   * network change can be recovered from.
   */
  /**
   * @param settle whether to derive and save at the end of this one record.
   * A pass over the library passes false and settles once when it is done:
   * deriveAssets with no keys walks the whole cache and saveCache rewrites
   * the whole file, so doing either per record is quadratic in the library.
   * At two thousand clippings that is millions of loop iterations and two
   * thousand full JSON writes for one import.
   */
  async archiveRecord(
    record: ClippingRecord,
    retryFailed = false,
    settle = true
  ): Promise<void> {
    this.adoptLocalMedia(record);
    const canonical = dedupeMedia(record.media).filter((m) => {
      // An embedded file in the vault is already archived by definition.
      if (!/^https?:\/\//i.test(m.url)) return false;
      const entry = this.cache.get(m.key);
      if (entry?.file) return false;
      return retryFailed || !entry?.failed;
    });
    let outcomes: ArchiveOutcome[] = [];
    if (canonical.length > 0) {
      await this.ensureFolder();
      outcomes = await archiveAll(canonical, record.source, this.deps(), 4, (done, total) =>
        this.onRecordProgress?.(done, total)
      );
      for (const outcome of outcomes) this.cache.mergeOutcome(outcome);
    }

    // After the inline media, so a video the note names and that has just
    // landed counts as the post's own and yt-dlp is not sent for it again.
    // Runs regardless of whether anything inline was outstanding: on a
    // re-archive every ref is already on disk, and the post's own video
    // would otherwise never be fetched.
    await this.archiveSourceVideo(record, retryFailed);

    // Nothing inline, or everything inline failed, so the page's own preview
    // image is the only thing left that could cover this tile.
    if (!outcomes.some((o) => o.file)) {
      await this.resolvePageCover(record, retryFailed);
    }

    if (settle) await this.settleRecord(record);
  }

  /**
   * Renders what this one record needs and writes the cache once.
   *
   * Scoped to the record's own keys, the way archiveResolved already scopes
   * its pass: a clipping's previews are its own business, and asking the
   * whole cache about them again is the cost that made a library-wide pass
   * quadratic.
   */
  private async settleRecord(record: ClippingRecord): Promise<void> {
    const keys = new Set(dedupeMedia(record.media).map((media) => media.key));
    for (const ref of localPreviewRefs(record)) keys.add(ref.key);
    if (record.source) {
      keys.add(normalizeUrl(record.source));
      keys.add(sourceVideoKeyFor(record.source));
    }
    await this.deriveAssets(keys);
    await this.saveCache();
    this.emit();
  }

  /**
   * Gives a cache entry to a file that is already in the vault but cannot be
   * painted as it stands.
   *
   * A file embedded in a note needs no downloading, which is why archiveRecord
   * skips it, and for a photograph that is the whole story. A PDF dropped
   * from Finder is not, nor is a HEIC set as a cover: it lives in the vault
   * and has nothing the wall can show until a preview of it has been made.
   * The cache is where a derived preview is recorded, so the file has to be
   * in the cache to get one.
   *
   * Only formats that need one. An ordinary picture paints itself, and
   * putting every pasted JPEG in the cache would double the bookkeeping for
   * nothing. The key is the vault path, which is what dedupeMedia already
   * uses for a local ref, so liveRefs counts it and the sweep leaves it and
   * its preview alone.
   */
  private adoptLocalMedia(record: ClippingRecord): void {
    for (const ref of localPreviewRefs(record)) this.adoptLocalFile(ref.key, ref.path, ref.kind);
  }

  private adoptLocalFile(key: string, path: string, kind: "image" | "video"): void {
    if (this.cache.byFile(path)) return;
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) return;
    this.cache.set({ key, file: path, thumb: "", kind, width: 0, height: 0, bytes: file.stat.size });
  }

  /**
   * Makes the preview for one file just saved into the vault, now rather
   * than on the next background pass, and says where that leaves it.
   *
   * The one door every way a picture arrives by hand goes through — pasted,
   * dropped, picked, or given to a card as its cover — so the preview is
   * made the same way for all of them, and the caller can tell the person
   * the truth when this device cannot make one.
   */
  async previewFile(path: string): Promise<PreviewOutcome> {
    const ext = extensionOf(path);
    if (!needsPreview(ext)) return "shown";

    this.adoptLocalFile(normalizeUrl(path), path, kindForExtension(ext) ?? "image");
    const entry = this.cache.byFile(path);
    if (entry) {
      await this.deriveAssets(new Set([entry.key]));
      await this.saveCache();
      this.emit();
    }
    return previewOutcome(path, this.cache.byFile(path));
  }

  /**
   * Pulls the video out of a post whose page never publishes it, using a
   * local yt-dlp. Instagram and X hide their media behind client-side
   * requests, so this is the only route that does not involve a third-party
   * mirror. Without yt-dlp installed the clipping simply keeps its poster.
   *
   * Not for a post whose video the clipping already holds: see ownVideo.
   */
  private async archiveSourceVideo(
    record: ClippingRecord,
    retryFailed: boolean
  ): Promise<void> {
    // A page this route would never fetch a video for has nothing to skip,
    // and its embeds are left exactly as they were.
    if (!record.source || !this.fetchesSourceVideo(record.source)) return;
    const own = ownVideo(record, (key) => this.cache.get(key)?.file || undefined);
    if (own) {
      // An embedded video paints only through its cache entry, which is
      // where its poster is recorded, and the entry can be missing: the
      // clip was made on another device, and this one's cache is what got
      // written back. The copy yt-dlp used to fetch was what covered the
      // tile then, so the embed is given an entry of its own instead, keyed
      // by its vault path as dedupeMedia keys it.
      if (own.embedded) this.adoptLocalFile(own.key, own.file, "video");
      return;
    }
    const limits = this.sourceVideoLimits(record.source);
    await this.downloadSourceVideoFor(record.source, retryFailed, limits);
  }

  /**
   * Whether a post's own video is fetched at all. A YouTube video that is not
   * a Short is kept as its cover unless the settings say otherwise.
   */
  private fetchesSourceVideo(source: string): boolean {
    return supportsSourceDownload(source, {
      youtubeVideoMinutes: this.settings().youtubeVideoMinutes,
    });
  }

  /**
   * The duration cap a post's own video is held to, from settings. Only an
   * ordinary YouTube video has one. Both routes to the video ask here: a
   * link clipped in Goko is fetched at capture, but a note the Web Clipper
   * wrote is only ever fetched by the background pass, and a cap that held
   * on one route alone would let the other download a video of any length.
   */
  private sourceVideoLimits(source: string): { maxSeconds?: number } {
    return { maxSeconds: youtubeDurationCap(source, this.settings().youtubeVideoMinutes) };
  }

  /**
   * Fetches a post's own video and returns its vault path. Takes a bare URL
   * rather than a record, so capture can archive before writing the note and
   * embed the local file instead of pointing at a URL that will expire.
   *
   * @param options.maxSeconds a duration cap for the yt-dlp route: a longer
   * video is refused before any of it is downloaded and recorded as too
   * long. Unset means no cap; the size cap from settings always applies.
   */
  async downloadSourceVideoFor(
    source: string,
    retryFailed: boolean,
    options: { maxSeconds?: number } = {}
  ): Promise<string | null> {
    if (!source || !this.fetchesSourceVideo(source)) return null;

    const key = sourceVideoKeyFor(source);
    const existing = this.cache.get(key);
    if (existing?.file) return existing.file;

    // A file that is simply there beats anything the cache remembers: a
    // device that cannot run yt-dlp adopts the video another device
    // downloaded. Checked before any recorded failure is believed, because
    // "yt-dlp not available" was a fact about a device, not about the post.
    const folder = normalizePath(this.settings().attachmentFolder);
    for (const candidate of sourceVideoCandidates(key, folder)) {
      const path = normalizePath(candidate);
      if (this.app.vault.getFileByPath(path)) {
        this.cache.mergeOutcome({ key, kind: "video", file: path });
        return path;
      }
    }

    // A failure the device that recorded it could not have avoided says
    // nothing about the post, and the cache travels with the vault: without
    // this, one clip from a phone is enough to convince every desktop that
    // shares the vault never to look for the video again.
    if (existing?.failed && !retryFailed && !isDeviceLimit(existing.failed)) return null;
    // A missing ffmpeg is still believed by a device that has none: asking
    // again would cost a full yt-dlp run per post on every pass, to learn the
    // same thing. A missing yt-dlp needs no such guard; noticing it is free.
    if (existing?.failed === NEEDS_FFMPEG && !retryFailed && !ffmpegPath()) return null;

    // Threads has no yt-dlp extractor and hides its video from every
    // server-side fetch, so its route is the webview sniff; everything
    // else goes through yt-dlp. Each route records its own failure.
    const result = isThreadsUrl(source)
      ? await this.sniffedVideo(source, key)
      : await this.ytdlpVideo(source, key, options.maxSeconds);
    if (!result) return null;

    // The yt-dlp route holds itself to the cap before downloading; this is
    // the sniffed route's only check, and a backstop for the other.
    if (result.data.byteLength > this.settings().maxBytes) {
      this.cache.mergeOutcome({
        key,
        kind: "video",
        failed: `too large (${result.data.byteLength} bytes)`,
      });
      return null;
    }

    await this.ensureFolder();
    const path = normalizePath(`${folder}/${hashUrl(key)}-video.${result.extension}`);

    if (!this.app.vault.getFileByPath(path)) {
      await this.app.vault.createBinary(path, result.data);
    }

    this.cache.mergeOutcome({
      key,
      kind: "video",
      file: path,
      bytes: result.data.byteLength,
    });
    return path;
  }

  /**
   * The yt-dlp route: a local tool the user installed, desktop only.
   *
   * Every failure is recorded under the reason core/ytdlp.ts gave it, and
   * none is transient, a timeout included. With the size cap in force, a
   * download that runs out the clock is either a stream yt-dlp could not
   * size or a link too slow for it. The first times out again on every pass,
   * each attempt spending the full timeout's worth of traffic, and nothing
   * here can tell it from the second. Calling it a device limit would buy
   * the same retries on every device instead. The explicit archive-everything
   * command and a fresh capture still try again.
   */
  private async ytdlpVideo(
    source: string,
    key: string,
    maxSeconds?: number
  ): Promise<{ data: ArrayBuffer; extension: string } | null> {
    if (!conversionAvailable() || !ytdlpPath()) {
      // Recorded rather than skipped silently, so a missing tool is
      // diagnosable from the cache instead of looking like nothing happened.
      this.cache.mergeOutcome({ key, kind: "video", failed: NO_YTDLP });
      return null;
    }

    const result = await downloadSourceVideo(source, {
      maxBytes: this.settings().maxBytes,
      maxSeconds,
    });
    if ("failed" in result) {
      this.cache.mergeOutcome({ key, kind: "video", failed: result.failed });
      return null;
    }
    return result;
  }

  /**
   * The webview route: loads the post so its own scripts reveal the video
   * URL, then fetches that URL like any other download. See sniff.ts.
   */
  private async sniffedVideo(
    source: string,
    key: string
  ): Promise<{ data: ArrayBuffer; extension: string } | null> {
    if (!Platform.isDesktopApp) {
      this.cache.mergeOutcome({ key, kind: "video", failed: NEEDS_DESKTOP });
      return null;
    }

    const url = await sniffVideoUrl(source);
    if (!url) {
      this.cache.mergeOutcome({ key, kind: "video", failed: "no video found on the page" });
      return null;
    }

    try {
      const response = await requestUrl({ url, method: "GET", throw: false });
      if (response.status < 200 || response.status >= 300) {
        this.cache.mergeOutcome({ key, kind: "video", failed: `HTTP ${response.status}` });
        return null;
      }
      // pickSniffedVideo only passes URLs whose path ends in a video
      // extension, so the slice below always finds one.
      const pathname = new URL(url).pathname;
      const extension = pathname.slice(pathname.lastIndexOf(".") + 1).toLowerCase();
      return { data: response.arrayBuffer, extension };
    } catch (error) {
      this.cache.mergeOutcome({ key, kind: "video", failed: String(error) });
      return null;
    }
  }

  /**
   * The post's own video, from the address its page handed over, written into
   * the slot a local yt-dlp would have filled for the same post.
   *
   * Same key, same file name, same cache entry. downloadSourceVideoFor finds
   * the file there and returns it before yt-dlp is ever considered, here and
   * on every device the vault syncs to, which is what gives a phone the video
   * at all and what stops a desktop fetching the same clip a second time.
   *
   * A failure is not written down. The address is signed and expires, so a
   * refusal is a fact about that address at that moment rather than about
   * the post — and a recorded failure that is not a device limit is one
   * downloadSourceVideoFor believes, which would stop every desktop sharing
   * the vault from ever asking yt-dlp. Left unwritten, the slot is exactly
   * as it was, and whichever route runs next records its own outcome.
   */
  private async downloadPageVideo(source: string, url: string): Promise<string | null> {
    if (!source) return null;

    const key = sourceVideoKeyFor(source);
    const existing = this.cache.get(key);
    if (existing?.file) return existing.file;

    // A file already in the slot wins, as it does on the yt-dlp route.
    const folder = normalizePath(this.settings().attachmentFolder);
    for (const candidate of sourceVideoCandidates(key, folder)) {
      const path = normalizePath(candidate);
      if (this.app.vault.getFileByPath(path)) {
        this.cache.mergeOutcome({ key, kind: "video", file: path });
        return path;
      }
    }

    try {
      const response = await requestUrl({
        url,
        method: "GET",
        headers: { "User-Agent": USER_AGENT },
        throw: false,
      });
      const data = response.arrayBuffer;
      const placed = placePageVideo(
        { status: response.status, contentType: headerValue(response.headers, "content-type"), data },
        url,
        key,
        folder,
        this.settings().maxBytes
      );
      if ("failed" in placed) {
        // The source rather than the address, which is signed and would
        // only be noise here once it has expired.
        console.warn(`Goko: the page's own video for ${source} was not saved (${placed.failed})`);
        return null;
      }

      await this.ensureFolder();
      const path = normalizePath(placed.path);
      if (!this.app.vault.getFileByPath(path)) {
        await this.app.vault.createBinary(path, data);
      }
      this.cache.mergeOutcome({ key, kind: "video", file: path, bytes: data.byteLength });
      return path;
    } catch (error) {
      console.warn(`Goko: the page's own video for ${source} was not saved (${String(error)})`);
      return null;
    }
  }

  /**
   * Archives a resolved link's media before any note exists, so the note can
   * be written with local embeds rather than URLs. Returns the vault path for
   * each URL that landed; anything missing simply stays remote in the note.
   */
  async archiveResolved(
    source: string,
    media: Array<{ url: string; kind: "image" | "video" }>,
    onProgress?: (done: number, total: number) => void,
    onStage?: (label: string) => void,
    sourceVideoUrl?: string
  ): Promise<{ byUrl: Map<string, string>; sourceVideo: string | null }> {
    const byUrl = new Map<string, string>();
    const canonical: CanonicalMedia[] = media.map((m) => ({
      key: normalizeUrl(m.url),
      url: m.url,
      kind: m.kind,
      alt: "",
    }));

    let haveVideo = false;

    if (canonical.length > 0) {
      await this.ensureFolder();
      const outcomes = await archiveAll(canonical, source, this.deps(), 4, onProgress);
      outcomes.forEach((outcome, index) => {
        this.cache.mergeOutcome(outcome);
        if (!outcome.file) return;
        byUrl.set(media[index].url, outcome.file);
        if (outcome.kind === "video") haveVideo = true;
      });
    }

    // Only reach for the post's own video when the resolver did not already
    // produce it. fxtwitter hands back X's mp4 directly, and fetching it
    // twice would archive the same clip under two names. The address the
    // page itself gave goes first: it is a plain request, so it works on a
    // phone, and it fills the slot yt-dlp would have, so nothing below and
    // no later pass on any device fetches the video again.
    let sourceVideo: string | null = null;
    if (!haveVideo && sourceVideoUrl) {
      onStage?.("Fetching video…");
      sourceVideo = await this.downloadPageVideo(source, sourceVideoUrl);
    }
    if (!haveVideo && !sourceVideo && this.fetchesSourceVideo(source)) {
      onStage?.("Fetching video…");
      sourceVideo = await this.downloadSourceVideoFor(source, true, this.sourceVideoLimits(source));
    }

    // Scoped to what was just archived: capture must never wait behind the
    // whole vault's derive backlog, which the background pass owns.
    onStage?.("Rendering previews…");
    const derivable = new Set(canonical.map((m) => m.key));
    if (source) derivable.add(sourceVideoKeyFor(source));
    await this.deriveAssets(derivable);
    await this.saveCache();
    this.emit();

    return { byUrl, sourceVideo };
  }

  /**
   * The first page of a PDF, written beside it as its preview.
   *
   * Not through renderPreview's routes: Obsidian ships pdf.js, so this works
   * on every phone, Android included, where sips and ffmpeg do not exist and
   * the webview has no idea what a PDF is.
   *
   * The two ways it can fail are not the same failure, and telling them
   * apart is the whole reason this records its own rather than letting the
   * caller do it. A build with no pdf.js in it may have one after the next
   * update, and writing the file off for that would leave it blank forever;
   * a page that threw while rendering will throw again every pass, and
   * saying so is what stops the archiver paying for it on each one.
   */
  private async renderPdfPreview(
    key: string,
    file: string
  ): Promise<{ path: string; width: number; height: number } | null> {
    const source = this.app.vault.getAbstractFileByPath(normalizePath(file));
    if (!(source instanceof TFile)) return null;

    const target = normalizePath(previewPath(file));
    const cover = await renderPdfCover(await this.app.vault.readBinary(source));
    if (!cover.ok) {
      if (!cover.retry) this.cache.setThumbFailed(key, cover.reason);
      return null;
    }

    try {
      await this.app.vault.createBinary(target, cover.png);
    } catch (error) {
      // Almost always the file landing twice, another device or an earlier
      // pass having written it. adoptDerived picks it up next time round.
      console.warn(`Goko: could not write ${target} (${String(error)})`);
      return null;
    }
    return { path: target, width: cover.width, height: cover.height };
  }

  /**
   * Produces a PNG the grid can actually paint for a format Chromium will
   * not decode, by whichever route this device has; core/preview-route.ts
   * decides which, and in what order.
   *
   * A missing tool is not a property of the file and is not written down,
   * nor is a webview that could not decode it. A tool that ran and failed
   * is, and retrying it every pass would buy nothing.
   */
  private async renderPreview(
    key: string,
    file: string,
    kind: "image" | "video"
  ): Promise<{ path: string; width: number; height: number } | null> {
    const ext = extensionOf(file);
    const tool =
      conversionAvailable() && (kind === "video" ? ffmpegPath() : sipsPath()) !== null;
    const routes = previewRoutes(kind, { tool, webview: this.webview.worthTrying(ext) });

    for (const route of routes) {
      const preview =
        route === "tool"
          ? await this.toolPreview(file, kind)
          : await this.webviewPreview(file);
      if (preview) return preview;
    }

    const failure = previewFailure(routes);
    if (failure) this.cache.setThumbFailed(key, failure);
    return null;
  }

  /**
   * The desktop route: sips for a picture, which reads HEIC, TIFF, EXR and
   * every major RAW, and ffmpeg for an unplayable container, which gives up
   * one frame. Either writes the PNG at the file's own resolution.
   */
  private async toolPreview(
    file: string,
    kind: "image" | "video"
  ): Promise<{ path: string; width: number; height: number } | null> {
    const normalizedTarget = normalizePath(previewPath(file));

    if (!this.app.vault.getFileByPath(normalizedTarget)) {
      const from = absolutePath(this.app.vault, normalizePath(file));
      const to = absolutePath(this.app.vault, normalizedTarget);
      if (!from || !to) return null;

      const ok =
        kind === "video"
          ? await extractVideoFrame(from, to)
          : await convertImageToPng(from, to);
      if (!ok) return null;
    }

    // Read the dimensions back off the PNG the tool just wrote.
    const written = this.app.vault.getAbstractFileByPath(normalizedTarget);
    if (!(written instanceof TFile)) return null;
    const dimensions = readDimensions(await this.app.vault.readBinary(written));

    return {
      path: normalizedTarget,
      width: dimensions?.width ?? 0,
      height: dimensions?.height ?? 0,
    };
  }

  /**
   * The phone's route: the webview decodes the file itself, which an iPhone's
   * does for HEIC, and the picture is drawn out to the PNG sips would have
   * written. Whether it could is remembered for the session, so a webview
   * that cannot is not handed every photo in the library to say so again.
   */
  private async webviewPreview(
    file: string
  ): Promise<{ path: string; width: number; height: number } | null> {
    const source = this.app.vault.getFileByPath(normalizePath(file));
    if (!source) return null;

    const data = await this.app.vault.readBinary(source);
    const still = await renderStill(new Blob([data], { type: mimeForPath(file) ?? "" }));
    this.webview.record(extensionOf(file), still !== null);
    if (!still) return null;

    const target = normalizePath(previewPath(file));
    try {
      await this.app.vault.createBinary(target, still.data);
    } catch (error) {
      // Almost always the file landing twice, another device or an earlier
      // pass having written it. adoptDerived picks it up next time round.
      console.warn(`Goko: could not write ${target} (${String(error)})`);
      return null;
    }
    return { path: target, width: still.width, height: still.height };
  }

  /**
   * Finds a cover for a clipping whose body has no usable image: a known
   * video host's thumbnail, resolved without a request, or the page's
   * declared og:image. Cached under the source URL so it is fetched once.
   */
  private async resolvePageCover(record: ClippingRecord, retryFailed: boolean): Promise<void> {
    if (!record.source) return;

    const key = normalizeUrl(record.source);
    const existing = this.cache.get(key);
    if (existing?.file) return;
    if (existing?.failed && !retryFailed) return;

    if (!needsPageCover(record, (k) => this.cache.get(k)?.file || undefined)) return;

    const known = knownHostThumbnail(record.source);
    let candidate: CanonicalMedia | null = known
      ? { key, url: known.url, kind: "image", alt: record.title, fallbacks: known.fallbacks }
      : null;

    if (!candidate) {
      const page = await this.fetchPageImage(record.source);
      if (page.image) candidate = { key, url: page.image, kind: "image", alt: record.title };
      // Unread is not the same as having nothing to show. Left unwritten, so
      // the next pass asks again rather than believing this one.
      else if (!page.read) return;
    }

    if (!candidate) {
      this.cache.mergeOutcome({ key, kind: "image", failed: "no preview image" });
      return;
    }

    await this.ensureFolder();
    const [outcome] = await archiveAll([candidate], record.source, this.deps(), 1);
    if (outcome) this.cache.mergeOutcome(outcome);
  }

  /**
   * The picture a page declares as its own, and whether the page was read at
   * all.
   *
   * The two are different answers and were one before: a page that answered
   * and has no og:image is a page that will never have one, while a page
   * that could not be reached says nothing about itself. Recording the
   * second as the first is how a clipping kept "no preview image" written
   * against it because a tunnel was up for a minute.
   */
  private async fetchPageImage(pageUrl: string): Promise<{ image: string; read: boolean }> {
    try {
      const response = await requestUrl({ url: pageUrl, method: "GET", throw: false });
      if (response.status >= 500 || response.status === 429) return { image: "", read: false };
      if (response.status < 200 || response.status >= 300) return { image: "", read: true };
      const type = headerValue(response.headers, "content-type") ?? "";
      if (type && !type.toLowerCase().includes("html")) return { image: "", read: true };
      return { image: extractPageImage(response.text, pageUrl) ?? "", read: true };
    } catch {
      // Thrown, not answered: no route, no DNS, a request cut on this side.
      return { image: "", read: false };
    }
  }

  /**
   * Background pass: fills in whatever is missing without blocking or
   * announcing itself. The grid shows remote covers meanwhile and swaps to
   * local ones as they land.
   *
   * With `download` off it does only what needs no network: files already
   * in the vault get their previews and posters, and nothing is fetched.
   * That is what turning off "Download media automatically" asks for, and
   * a clip made in Goko is not affected, having downloaded as it was made.
   */
  async archiveMissing(download = true): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.absorbFromDisk();
      for (const record of this.index.records()) {
        if (download) await this.archiveRecord(record, false, false);
        else this.adoptLocalMedia(record);
      }
      // Once, for the whole pass. Each record left its own outcomes in the
      // cache; this is where they are rendered and written down.
      await this.deriveAssets();
      await this.saveCache();
      this.emit();
    } catch {
      // Background work never interrupts the user; the next pass retries.
    } finally {
      this.running = false;
    }
  }

  async archiveEverything(): Promise<ArchiveSummary> {
    if (this.running) {
      new Notice("Goko: already archiving");
      return this.summary();
    }
    this.running = true;
    try {
      // The explicit command retries everything, hopeless renders included.
      this.cache.clearThumbFailures();
      for (const record of this.index.records()) {
        await this.archiveRecord(record, true, false);
      }
      // Catches anything downloaded on an earlier run that never got a
      // thumbnail, for instance because the view was closed at the time.
      await this.deriveAssets();
      await this.saveCache();
      this.emit();
    } finally {
      this.running = false;
    }
    return this.summary();
  }

  summary(): ArchiveSummary {
    let ok = 0;
    let failed = 0;
    for (const entry of this.cache.entries()) {
      if (entry.failed) failed++;
      else if (entry.file) ok++;
    }
    return { ok, failed };
  }

  notifyResult(result: ArchiveSummary): void {
    new Notice(
      `Goko: ${result.ok} media downloaded, ${result.failed} failed`
    );
  }
}
