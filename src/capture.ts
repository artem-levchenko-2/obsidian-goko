import { App, Notice, Platform, TFile, normalizePath, requestUrl } from "obsidian";
import type { ArchiveService } from "./archive-service";
import { todayISO as today } from "./core/dates";
import { extensionForMime, extensionOf, kindForMime, needsPreview } from "./core/formats";
import { domainOf } from "./core/scan";
import { pdfPathOf, readPdfIntoNote } from "./core/pdf";
import type { PdfRead, PdfTally } from "./core/pdf";
import { readPdfText } from "./pdf-cover";
import { PreviewNotices } from "./core/preview-route";
import { readArticle } from "./article";
import { normalizeUrl } from "./core/normalize";
import { fileableGrid } from "./core/spaces";
import { withGridKey } from "./core/drop";
import { freePath, takenIgnoringCase } from "./core/placement";
import type { ClippingIndex } from "./index-store";
import {
  ResolvedLink,
  amazonProduct,
  bareLink,
  buildNote,
  buildPastedImageNote,
  buildScanNote,
  cleanUrl,
  directMediaKind,
  directMediaLink,
  fxApiUrl,
  isHttpUrl,
  noteNameFor,
  parseAmazonPage,
  parseFxTweet,
  instagramEmbedUrl,
  instagramPost,
  parseInstagramEmbed,
  parsePageMeta,
  xStatus,
  isThreadsUrl,
  refineThreadsLink,
  threadsPostCode,
} from "./core/resolve";
import { ThreadsEmbed, isThreadsAvatar, parseThreadsEmbed, threadsEmbedUrl } from "./core/threads";
import { hasMediaToArchive, pictureRefused } from "./core/page-video";
import { headerValue } from "./core/response-headers";
import {
  PIN_RESOURCE_HEADERS,
  canonicalPinUrl,
  isPinterestShortLink,
  parsePinPage,
  parsePinResource,
  pinIdFromPage,
  pinPermalink,
  pinResourceUrl,
  pinterestPinId,
} from "./core/pinterest";
import type { ProgressState } from "./core/progress";
import type { GokoSettings } from "./core/settings";
import { scanAvailable, scanPage } from "./page-scanner";
import { sniffThreadsImages } from "./sniff";

/**
 * Identifies the plugin honestly rather than impersonating a known crawler.
 * Enough for sites that gate Open Graph tags on a non-browser agent, such
 * as Threads; X withholds them from everything but named crawlers, which is
 * why X posts go through the resolver instead.
 */
export const USER_AGENT = "Mozilla/5.0 (compatible; Goko/0.1; Obsidian link preview)";

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Filename-safe stamp, unique to the second so two pastes cannot collide. */
function todayStamp(): string {
  const now = new Date();
  return (
    `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}` +
    ` ${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  );
}

export class CaptureService {
  /** Set by the grid view so capture can drive its progress bar. */
  onProgress: ((state: ProgressState | null) => void) | null = null;
  /**
   * Carries the note's path as well as its label: the grid flies to what you
   * just clipped, and a title is not enough to find a tile by.
   */
  onFinished: ((label: string, path: string) => void) | null = null;
  /** Keeps a batch of HEICs this device cannot show to one notice between them. */
  private previewNotices = new PreviewNotices();
  /**
   * Fires once a clipping's note exists and the index knows it, for work that
   * belongs to the plugin rather than to a view: onFinished is the wall's, set
   * and cleared as the wall opens and closes, and a rule that only ran while
   * the wall happened to be open would be a rule that only sometimes ran.
   */
  /**
   * A clipping landed. `quiet` says it was one of a batch, which is what
   * stops a five-hundred-file import quietly spending five hundred model
   * calls: the rules still run, because they are local and free and are the
   * point, and the model is left for the reader to ask for afterwards.
   */
  onCreated: ((path: string, quiet?: boolean) => void) | null = null;
  /**
   * Fires when a clip turns out to be one already in the library, before the
   * note opens. Set from the plugin for the same reason onCreated is: the
   * rules and the stamp belong to the library, not to whichever view happens
   * to be open. Awaited, so the note opens with its new keys already on it.
   */
  onDuplicate: ((path: string) => Promise<void>) | null = null;

  constructor(
    private app: App,
    private settings: () => GokoSettings,
    private archiver: ArchiveService,
    private index: ClippingIndex,
    /**
     * Which folder a clipping filed onto a grid is created in. The clippings
     * folder in frontmatter mode; the grid's own directory when grids follow
     * folders, so a clip lands where it belongs instead of arriving at home
     * and being moved a moment later.
     */
    private folderForGrid: (grid: string) => string = () => normalizePath(settings().clippingsFolder)
  ) {}

  async captureFromClipboard(): Promise<void> {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      new Notice("Goko: could not read the clipboard");
      return;
    }
    await this.capture(text);
  }

/**
   * Writes a picture or a video into the attachments folder and answers with
   * its vault path, or null when it could not be written.
   *
   * The half of captureMedia that is about the file rather than the clipping,
   * split out because setting a cover by hand needs exactly this and nothing
   * that follows it: the picture goes into the vault, and the path goes into
   * somebody else's `cover:`.
   *
   * The name always carries the pasted- prefix, whichever way the file
   * arrived. sweep.ts will only remove media it can prove the plugin made,
   * and that prefix is half of the proof; a differently named drop would be
   * orphaned in the attachments folder forever.
   */
  async saveAttachment(blob: Blob): Promise<string | null> {
    const folder = normalizePath(this.settings().attachmentFolder);
    if (!this.app.vault.getFolderByPath(folder)) {
      // The catch covers the race where the folder landed between the
      // lookup and the create; any real failure resurfaces on the write.
      await this.app.vault.createFolder(folder).catch(() => {});
    }

    const stamp = todayStamp();
    const ext = extensionForMime(blob.type);
    let attachment = normalizePath(`${folder}/pasted-${stamp}.${ext}`);
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(attachment)) {
      attachment = normalizePath(`${folder}/pasted-${stamp}-${n}.${ext}`);
      n++;
    }

    try {
      await this.app.vault.createBinary(attachment, await blob.arrayBuffer());
    } catch (error) {
      this.onProgress?.(null);
      new Notice(`Goko: could not save the image (${String(error)})`);
      return null;
    }
    return attachment;
  }

  /**
   * Saves a picture or a video straight into the vault as its own clipping,
   * whether it was pasted from the clipboard or dropped onto the wall.
   *
   * `label` is the title to give it. A drop passes the file's own name, which
   * is worth far more than the stamp a paste has to settle for; without one
   * the stamp is used, because a paste genuinely has nothing else to go on.
   */
  async captureMedia(blob: Blob, label = "", options: { quiet?: boolean } = {}): Promise<void> {
    const kind = kindForMime(blob.type);
    if (!kind) {
      if (!options.quiet) new Notice("Goko: that is not a picture or a video");
      return;
    }

    this.report(0.3, `Saving ${kind}…`);
    const attachment = await this.saveAttachment(blob);
    if (!attachment) return;

    this.report(0.7, "Creating clipping…");
    const stamp = todayStamp();

    // Guarded rather than || chained: noteNameFor answers "Untitled clipping"
    // for an empty title, never "", so a fallback behind it would never run and
    // every paste would come out untitled.
    const title = label.trim() ? noteNameFor(label, "") : `Pasted ${kind} ${stamp}`;
    const grid = this.targetGrid();
    const clippings = normalizePath(this.folderForGrid(grid));
    if (!this.app.vault.getFolderByPath(clippings)) {
      await this.app.vault.createFolder(clippings).catch(() => {});
    }

    const notePath = this.freeNotePath(clippings, title);

    try {
      const file = await this.app.vault.create(
        notePath,
        buildPastedImageNote(title, attachment, today(), grid)
      );
      // Same as the link path: ingest alone leaves the grid unaware.
      await this.index.handleModify(file);
    } catch (error) {
      this.onProgress?.(null);
      new Notice(`Goko: could not create the note (${String(error)})`);
      return;
    }

    // A PDF or a HEIC has nothing the wall can paint until a preview of it
    // is made. The background pass would do it within a few seconds, and a
    // card of words would stand there meanwhile — acceptable for a note
    // that arrived on its own, wrong for a file somebody just dropped. So
    // the preview is asked for now, for this one file. A device that cannot
    // make one says so, since otherwise the card of words is all there is
    // to go on.
    if (needsPreview(extensionOf(attachment))) {
      this.report(0.9, "Rendering preview\u2026");
      const outcome = await this.archiver.previewFile(attachment);
      const notice = this.previewNotices.after(attachment, outcome, options.quiet);
      if (notice) new Notice(notice, 8000);
      await this.readPdfInto(notePath);
    }
    this.onProgress?.(null);

    if (!options.quiet) this.onFinished?.(title, notePath);
    this.onCreated?.(notePath, options.quiet);
  }

  /**
   * Reads the words out of a clipping's PDF and keeps them in the note.
   *
   * Which is all it takes for search to find them: scan.ts builds its index
   * from the note's body, so words that are in the body are words you can
   * search for. Without this a PDF is findable by its file name alone, and a
   * file name is exactly where "Untitled-3.pdf" goes to hide.
   *
   * Here rather than in the archiver, which renders the cover: the archiver
   * writes attachments and its own cache and nothing else, and notes are
   * written through this one door. Idempotent, so the command that goes back
   * over the whole library can be run twice, and a PDF that could not be
   * opened for want of a reader is left unwritten, for that command to read
   * in a session that has one.
   *
   * @returns "read" when the note was written to.
   */
  async readPdfInto(notePath: string): Promise<PdfRead> {
    const note = this.app.vault.getAbstractFileByPath(normalizePath(notePath));
    if (!(note instanceof TFile)) return "skipped";

    const record = this.index.get(notePath);
    if (!record) return "skipped";
    const pdf = pdfPathOf(record, (key) => this.archiver.cache.get(key)?.file ?? "");
    if (!pdf) return "skipped";

    const file = this.app.vault.getAbstractFileByPath(normalizePath(pdf));
    if (!(file instanceof TFile)) return "skipped";

    const outcome = await readPdfIntoNote({
      body: () => this.app.vault.read(note),
      text: async () => readPdfText(await this.app.vault.readBinary(file)),
      write: async (edit) => {
        await this.app.vault.process(note, edit);
      },
    });
    if (outcome === "read") await this.index.handleModify(note);
    return outcome;
  }

  /**
   * The same over every clipping that is a PDF, for the library that was
   * there before any of this was.
   */
  async readEveryPdf(): Promise<PdfTally> {
    const tally: PdfTally = { read: 0, waiting: 0, total: 0 };
    for (const record of this.index.records()) {
      if (!pdfPathOf(record, (key) => this.archiver.cache.get(key)?.file ?? "")) continue;
      tally.total++;
      const outcome = await this.readPdfInto(record.path);
      if (outcome === "read") tally.read++;
      else if (outcome === "waiting") tally.waiting++;
    }
    return tally;
  }

  /**
   * Files a markdown note that already exists as a clipping.
   *
   * The cheapest capture there is, because a clipping IS a markdown note in
   * the clippings folder: bringing one in is copying it there. The one thing
   * added is the grid it was dropped on, which is what filing it means where
   * a grid is a key (see withGridKey); nothing else is rewritten — a note
   * dropped on the wall is somebody's writing, and the plugin's opinion about
   * frontmatter is not worth imposing on it. scanClipping falls back to the
   * file name for a title, so even a note with no frontmatter at all gets a
   * card that says what it is.
   *
   * Copied rather than moved: the file is somewhere the reader put it, and
   * an import that empties a folder is an import nobody trusts twice.
   */
  async captureNote(
    body: string,
    name: string,
    grid?: string,
    options: { quiet?: boolean } = {}
  ): Promise<void> {
    const title = noteNameFor(name.replace(/\.md$/i, ""), "");
    const target = this.targetGrid(grid);
    const folder = normalizePath(this.folderForGrid(target));
    if (!this.app.vault.getFolderByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => {});
    }

    const path = this.freeNotePath(folder, title);

    let file: TFile;
    try {
      file = await this.app.vault.create(path, withGridKey(body, target));
    } catch (error) {
      if (!options.quiet) new Notice(`Goko: could not add the note (${String(error)})`);
      return;
    }

    await this.index.handleModify(file);
    if (!options.quiet) this.onFinished?.(title.slice(0, 40), file.path);
    this.onCreated?.(file.path, options.quiet);
  }

  /**
   * The grid a new clipping carries, or "" when that is home: the open grid,
   * unless the caller already decided (a shared clip routed by the setting).
   */
  private targetGrid(explicit?: string): string {
    if (explicit !== undefined) return explicit;
    const settings = this.settings();
    return fileableGrid(settings.activeGrid, settings.homeGridName, settings.grids);
  }

  private report(fraction: number | null, label: string): void {
    this.onProgress?.({ fraction, label });
  }

/**
   * `grid` is where to file it, "" for home. Left out, the open grid is used,
   * which is what an in-app clip means.
   *
   * `quiet` is how a batch differs from a hand. A clip made by hand is one
   * thing happening and the app answers it: a notice, and the note brought
   * up if it was already saved. A clip made by a batch is one of a thousand,
   * and every one of those answers is wrong — a thousand notices, a thousand
   * tabs, a thousand frontmatter writes for things that changed nothing. Per
   * call rather than a flag on the service, because both go through here.
   */
  async capture(raw: string, grid?: string, options: { quiet?: boolean } = {}): Promise<void> {
    const url = cleanUrl(raw);
    if (!isHttpUrl(url)) {
      // Said plainly, because the common way here is a file copied in Finder:
      // that puts a path on the clipboard, not the picture, and "not a link"
      // sent people looking for a URL they never meant to paste.
      new Notice("Goko: nothing to clip. Copy a link or an image (not a file), or drop the file onto the wall.");
      return;
    }

    // A lookup rather than a walk: index.records() sorts the whole map, and
    // a backfill would pay for that once per clipping before writing a line.
    // A pin is kept under its permalink whichever host and slug it arrived
    // with, so that is looked up too; the address as pasted still comes
    // first, for a pin clipped before pins were kept that way.
    const pin = canonicalPinUrl(url);
    const existing = this.index.bySource(url) ?? (pin ? this.index.bySource(pin) : undefined);
    if (existing) {
      await this.answerDuplicate(existing.path, options.quiet);
      return;
    }

    this.report(0.1, "Reading link…");
    const link = await this.resolve(url);

    // Some addresses only say what they are once they have been read: a
    // pin.it link or a Threads share link resolves to the post's permalink,
    // and a clipping of that permalink may already be in the library.
    if (link && link.url !== url) {
      const resolved = this.index.bySource(link.url);
      if (resolved) {
        await this.answerDuplicate(resolved.path, options.quiet);
        return;
      }
    }

    if (!link || !hasMediaToArchive(link)) {
      await this.saveWithoutMedia(url, link, grid, options.quiet);
      return;
    }

    // Archive before writing the note, so the note can embed the files
    // themselves. These CDN urls are signed and expire within days; a note
    // that points at one is a note that stops working.
    this.report(0.3, "Downloading media…");
    const archived = await this.archiver.archiveResolved(
      link.url,
      link.media,
      (done, total) =>
        this.report(0.3 + (done / Math.max(1, total)) * 0.5, `Downloading ${done}/${total}…`),
      // The work after the downloads announces itself, so the bar can never
      // sit on "Downloading 1/1" while something else is what's running.
      (label) => this.report(0.8, label),
      // Fetched into the file, never written as an address: it is signed and
      // expires. If it cannot be fetched the note keeps the poster, when the
      // link has one.
      link.sourceVideoUrl
    );

    const media = link.media.map((item) => ({
      ...item,
      localPath: archived.byUrl.get(item.url),
    }));

    // A video pulled from the post itself leads, so it becomes the cover and
    // the first thing the note shows.
    if (archived.sourceVideo) {
      media.unshift({
        url: link.url,
        kind: "video" as const,
        localPath: archived.sourceVideo,
      });
    }

    // The post's video was all the link had, and it did not arrive. The
    // clip then goes the way it went before the video was known about, so
    // a refused or expired address leaves it no poorer than that.
    if (media.length === 0) {
      await this.saveWithoutMedia(url, link, grid, options.quiet);
      return;
    }

    this.report(0.85, "Creating clipping…");
    const file = await this.createNote({ ...link, media }, undefined, grid);
    if (!file) {
      this.onProgress?.(null);
      return;
    }

    // handleModify, not ingest: ingest updates the index silently, so the
    // grid was never told the clipping had landed.
    await this.index.handleModify(file);
    await this.readPdfInto(file.path);

    // The clipping is saved either way — the note, the address and whatever
    // the page said about itself. But if every picture it named was refused
    // at the source and no video of the post's own took their place, the
    // card is going to be a sheet of words, and being told why beats
    // wondering. Cloudflare's challenge page is the usual
    // reason, and nothing a plugin sends will get past one.
    if (
      !options.quiet &&
      pictureRefused(
        link.media.map((item) => Boolean(this.archiver.cache.get(normalizeUrl(item.url))?.failed)),
        archived.sourceVideo
      )
    ) {
      new Notice("Goko: saved, but the source refused to hand over the picture");
    }

    // The batch owns the bar and says how far through it is; a per-item
    // finish would fight it for the same few pixels five hundred times.
    if (!options.quiet) this.onFinished?.(link.title.slice(0, 40), file.path);
    this.onCreated?.(file.path, options.quiet);
  }

  /**
   * The clipping of a link that brought no media, or whose only media was a
   * video that did not arrive. `link` is null when the page could not be
   * read at all.
   */
  private async saveWithoutMedia(
    url: string,
    link: ResolvedLink | null,
    grid?: string,
    quiet = false
  ): Promise<void> {
    // A page that offers no media at all is still worth keeping: scan it
    // into one tall picture and let that be the tile. Only as a fallback —
    // a page's own picture always wins, which is what the reverted
    // scan-by-default got backwards.
    if (scanAvailable()) {
      const outcome = await this.scanAndSave(url, grid, link?.article);
      if (outcome.ok) return;
      console.warn(`Goko: scan of ${url} failed (${outcome.reason})`);
    }
    // And if even that is not on the table, the clipping is still made.
    // The scanner is desktop-only, so on a phone this was every link
    // without a picture, and a phone is where a link arrives through the
    // share sheet from someone who is not looking at the screen: they
    // shared it, saw a notice about nothing being created or saw nothing
    // at all, and believed they had saved it.
    await this.saveBare(link ?? bareLink(url), link !== null, grid, quiet);
  }

  /**
   * What a clip of something already in the library does instead of
   * clipping it again.
   *
   * A second encounter with the same thing is neither a mistake nor nothing
   * happening, and by hand it deserves the whole answer: the note is
   * stamped, the rules run over it again, and it opens. In a batch none of
   * that is true — the note is one of a thousand the reader never asked to
   * see, and stamping it would put a thousand identical writes on disk for
   * pins that changed nothing.
   */
  private async answerDuplicate(path: string, quiet = false): Promise<void> {
    this.onProgress?.(null);
    if (quiet) return;
    await this.onDuplicate?.(path);
    new Notice("Goko: already clipped — moved up");
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
  }

  /**
   * Writes a clipping with no media at all: the address, and whatever the
   * page managed to say about itself.
   *
   * @param read whether the page was fetched. A page that answered and has
   * no picture is a different thing from one that refused to be read, and
   * the notice says which — the second is worth knowing about, because the
   * clipping will carry only its address until you give it something.
   */
  private async saveBare(
    link: ResolvedLink,
    read: boolean,
    grid?: string,
    quiet = false
  ): Promise<void> {
    this.report(0.85, "Creating clipping…");
    const file = await this.createNote({ ...link, media: [] }, undefined, grid);
    this.onProgress?.(null);
    if (!file) return;

    await this.index.handleModify(file);
    if (!quiet) {
      new Notice(
        read
          ? "Goko: saved without a picture"
          : "Goko: saved as a link — the page could not be read"
      );
      this.onFinished?.((link.title || domainOf(link.url) || link.url).slice(0, 40), file.path);
    }
    this.onCreated?.(file.path, quiet);
  }

  private async resolve(url: string): Promise<ResolvedLink | null> {
    // A URL that already points at an asset needs no resolving. This is the
    // route for sites like Threads that never publish their video URL: copy
    // the video address and paste that.
    const direct = directMediaKind(url);
    if (direct) return directMediaLink(url, direct);

    const status = xStatus(url);
    if (status && this.settings().useResolvers) {
      const viaResolver = await this.resolveX(status, url);
      if (viaResolver && viaResolver.media.length > 0) return viaResolver;
    }

    const insta = instagramPost(url);
    if (insta) return this.resolveInstagram(insta, url);

    if (amazonProduct(url)) {
      const product = await this.resolveAmazon(url);
      if (product && product.media.length > 0) return product;
    }

    const pinId = pinterestPinId(url);
    if (pinId) return this.resolvePinterest(pinId);

    // A short link names no pin until it has been followed. One that lands
    // on a board or a profile rather than a pin is read like any other page.
    if (isPinterestShortLink(url)) {
      const landed = await this.fetchText(url);
      const id = landed ? pinIdFromPage(landed) : null;
      if (id && landed) return this.resolvePinterest(id, landed);
    }

    const raw = await this.resolvePage(url);
    if (!raw || !isThreadsUrl(url)) return raw;

    // Read as a post rather than a page: the text becomes the title and the
    // handle the author, since og:title only says "Name (@handle) on Threads".
    // And the post's own address rather than the share link it arrived as:
    // og:url names the permalink, which is what "already clipped" should
    // compare and what a reader wants to open later.
    const permalink = raw.canonical && isThreadsUrl(raw.canonical) ? raw.canonical : url;
    const page = refineThreadsLink({ ...raw, url: permalink });
    const videos = page.media.filter((item) => item.kind === "video");
    const withPictures = (pictures: string[]): ResolvedLink => ({
      ...page,
      media: [...videos, ...pictures.map((u) => ({ url: u, kind: "image" as const }))],
    });

    // Threads publishes an avatar or a rendered card as og:image, whatever
    // the post holds; the pictures themselves are drawn by the page's own
    // scripts. Its embed is drawn on the server and hands over the pictures
    // and the video, so it is asked first, on every platform: on a phone it
    // is the only way to them.
    this.report(0.2, "Reading the post…");
    const embed = await this.fetchThreadsEmbed(permalink);
    if (embed) {
      const link = embed.images.length > 0
        ? withPictures(embed.images)
        : {
            // A video post shows no picture of its own, so og:image is the
            // author's avatar or a frame of the video. The avatar is no
            // cover for it; the frame is, and without one the cover comes
            // from the video itself once it is downloaded.
            ...page,
            media: page.media.filter((item) => item.kind === "video" || !isThreadsAvatar(item.url)),
          };
      return embed.video ? { ...link, sourceVideoUrl: embed.video } : link;
    }

    // The embed answered nothing: a post removed, made private, or a page
    // whose shape has changed. On desktop the post's own page is loaded and
    // asked — for this one post, found by its permalink code and its text.
    // Nothing found leaves the og:image, which is at least honest about what
    // it is.
    if (Platform.isDesktopApp) {
      const pictures = await sniffThreadsImages(
        permalink,
        threadsPostCode(permalink),
        page.description
      );
      if (pictures.length > 0) return withPictures(pictures);
    }
    return page;
  }

  /**
   * The embed of a Threads post, read for its pictures and its video. Null
   * for a link that names no post, a refusal, or a page with neither, so the
   * caller keeps the route it had before the embed was asked.
   */
  private async fetchThreadsEmbed(permalink: string): Promise<ThreadsEmbed | null> {
    const embed = threadsEmbedUrl(permalink);
    if (!embed) return null;
    try {
      const response = await requestUrl({
        url: embed,
        method: "GET",
        headers: { "User-Agent": USER_AGENT },
        throw: false,
      });
      if (response.status < 200 || response.status >= 300) return null;
      return parseThreadsEmbed(response.text);
    } catch {
      return null;
    }
  }

  /**
   * Amazon serves its product pages to the plugin's own user agent but
   * publishes no Open Graph tags on them, so the cover is read off the page.
   */
  private async resolveAmazon(url: string): Promise<ResolvedLink | null> {
    try {
      const response = await requestUrl({
        url,
        method: "GET",
        headers: { "User-Agent": USER_AGENT },
        throw: false,
      });
      if (response.status < 200 || response.status >= 300) return null;
      return parseAmazonPage(response.text, url);
    } catch {
      return null;
    }
  }

  /**
   * A post's pictures, all of them, at the size they were posted at.
   *
   * The page itself is an empty shell — the post arrives over a request the
   * page makes for itself — so fetching it gives only the og: tags meant
   * for crawlers: one picture, square-cropped to 640 by a CDN transform
   * that is part of that URL's signature and therefore cannot be edited
   * out. A carousel of seventeen came out as one square thumbnail.
   *
   * The embed page is rendered on the server, needs no login, and carries
   * the post's own data. Two requests rather than one: the og: tags still
   * write the title and the description, which they do well, and the embed
   * is asked only for what they cannot say. If it answers nothing — a post
   * removed, made private, or a shape that has changed since — the clipping
   * is exactly what it was before, which is the point of leaving the first
   * request where it was.
   *
   * The video of a reel comes from the embed when the embed has it, as an
   * address the archiver fetches into the same file yt-dlp would have
   * written; that is the one route to a reel's video on a phone. When the
   * embed does not have it, the poster stands, and a local yt-dlp keyed off
   * the source URL fetches the video during archiving, as it always has.
   */
  private async resolveInstagram(
    post: { kind: string; code: string },
    url: string
  ): Promise<ResolvedLink | null> {
    const page = await this.resolvePage(url);
    const base: ResolvedLink = page ?? {
      url,
      title: `Instagram ${post.kind}`,
      description: "",
      author: "",
      published: "",
      media: [],
    };

    const embed = await this.fetchInstagramEmbed(post.code);
    if (!embed) return base;

    return {
      ...base,
      media: embed.media,
      author: base.author || embed.author,
      sourceVideoUrl: embed.sourceVideoUrl,
    };
  }

  /**
   * A pin as the pin it is — every page of an idea pin, every slot of a
   * carousel, a video pin's mp4 — rather than the one 736-wide og:image its
   * page publishes. See src/core/pinterest.ts.
   *
   * The resource is not an API. When it refuses or answers in a shape that
   * is not recognised, the pin's page is read instead, which is what a pin
   * was before this existed, at 1200 wide rather than 736. `page` is that
   * page when it is already in hand, as it is for a pin.it link.
   */
  private async resolvePinterest(id: string, page?: string): Promise<ResolvedLink | null> {
    this.report(0.2, "Reading the pin\u2026");
    const pin = parsePinResource(await this.fetchPinResource(id), id);
    if (pin) return pin;

    const html = page ?? (await this.fetchText(pinPermalink(id)));
    return html ? parsePinPage(html, id) : null;
  }

  private async fetchPinResource(id: string): Promise<unknown> {
    try {
      const response = await requestUrl({
        url: pinResourceUrl(id),
        method: "GET",
        headers: { "User-Agent": USER_AGENT, ...PIN_RESOURCE_HEADERS },
        throw: false,
      });
      if (response.status < 200 || response.status >= 300) return null;
      return response.json;
    } catch {
      return null;
    }
  }

  /** A page's HTML, or null when it would not be read. */
  private async fetchText(url: string): Promise<string | null> {
    try {
      const response = await requestUrl({
        url,
        method: "GET",
        headers: { "User-Agent": USER_AGENT },
        throw: false,
      });
      if (response.status < 200 || response.status >= 300) return null;
      return response.text;
    } catch {
      return null;
    }
  }

  private async fetchInstagramEmbed(code: string): Promise<ReturnType<typeof parseInstagramEmbed>> {
    try {
      const response = await requestUrl({
        url: instagramEmbedUrl(code),
        method: "GET",
        headers: { "User-Agent": USER_AGENT },
        throw: false,
      });
      if (response.status < 200 || response.status >= 300) return null;
      return parseInstagramEmbed(response.text);
    } catch {
      return null;
    }
  }

  private async resolveX(
    status: { user: string; id: string },
    url: string
  ): Promise<ResolvedLink | null> {
    try {
      const response = await requestUrl({
        url: fxApiUrl(status),
        method: "GET",
        headers: { "User-Agent": USER_AGENT },
        throw: false,
      });
      if (response.status < 200 || response.status >= 300) return null;
      return parseFxTweet(response.json, url);
    } catch {
      return null;
    }
  }

  private async resolvePage(url: string): Promise<ResolvedLink | null> {
    try {
      const response = await requestUrl({
        url,
        method: "GET",
        headers: { "User-Agent": USER_AGENT },
        throw: false,
      });
      if (response.status < 200 || response.status >= 300) return null;

      // Some CDN urls carry no file extension; trust what the server says.
      // kindForMime knows the one type here that is not a picture's: a link
      // to a PDF served without .pdf on the end is still a PDF.
      const type = (headerValue(response.headers, "content-type") ?? "").toLowerCase();
      const direct = kindForMime(type);
      if (direct) return directMediaLink(url, direct);

      const meta = parsePageMeta(response.text, url);
      // The same bytes, read a second way. A link to a piece of writing is
      // worth more than a thumbnail of it, and the page is already in hand,
      // so this costs a parse rather than a request.
      const article = await readArticle(response.text, url);
      return article ? { ...meta, article: article.markdown } : meta;
    } catch {
      return null;
    }
  }

  /**
   * Scans the page and files it as a clipping. Reports progress but shows
   * no notice itself: the caller decides whether a failure is the end of
   * the story or a fallback to something else.
   */
  private async scanAndSave(
    url: string,
    grid?: string,
    article = ""
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    this.report(null, "Loading page…");
    let scanned;
    try {
      scanned = await scanPage(url, (label) => this.report(null, label));
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }

    this.report(0.8, "Saving scan…");
    const folder = normalizePath(this.settings().attachmentFolder);
    if (!this.app.vault.getFolderByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => {});
    }
    // scan- rather than pasted-: both prefixes are what sweep.ts accepts as
    // proof the plugin made a file, and the name should say what it is.
    const stamp = todayStamp();
    let attachment = normalizePath(`${folder}/scan-${stamp}.${scanned.encoding.ext}`);
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(attachment)) {
      attachment = normalizePath(`${folder}/scan-${stamp}-${n}.${scanned.encoding.ext}`);
      n++;
    }
    try {
      await this.app.vault.createBinary(attachment, await scanned.blob.arrayBuffer());
    } catch (error) {
      return { ok: false, reason: `could not save the scan: ${String(error)}` };
    }

    this.report(0.9, "Creating clipping…");
    const link: ResolvedLink = {
      url,
      title: scanned.title,
      description: "",
      author: "",
      published: "",
      media: [],
    };
    const file = await this.createNote(
      link,
      (target) => buildScanNote(link.title, url, attachment, today(), target, article),
      grid
    );
    if (!file) return { ok: false, reason: "could not create the note" };
    await this.index.handleModify(file);
    this.onFinished?.(link.title.slice(0, 40), file.path);
    this.onCreated?.(file.path);
    return { ok: true };
  }

  /**
   * The path a new note of this name gets in a folder: the name itself, or
   * ` 2`, ` 3` after it. Compared without case, as the disk compares; see
   * takenIgnoringCase.
   */
  private freeNotePath(folder: string, name: string): string {
    const siblings = this.app.vault.getFolderByPath(folder)?.children ?? [];
    return freePath(
      normalizePath(`${folder}/${name}.md`),
      takenIgnoringCase(siblings.map((child) => child.path))
    );
  }

  private async createNote(
    link: ResolvedLink,
    content?: (grid: string) => string,
    explicitGrid?: string
  ): Promise<TFile | null> {
    const grid = this.targetGrid(explicitGrid);
    const folder = normalizePath(this.folderForGrid(grid));
    if (!this.app.vault.getFolderByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => {});
    }

    const path = this.freeNotePath(folder, noteNameFor(link.title, link.url));

    try {
      return await this.app.vault.create(path, content ? content(grid) : buildNote(link, today(), grid));
    } catch (error) {
      new Notice(`Goko: could not create the note (${String(error)})`);
      return null;
    }
  }
}
