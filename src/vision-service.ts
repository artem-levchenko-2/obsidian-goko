import { App, Notice, Platform, TFile, arrayBufferToBase64, normalizePath, requestUrl } from "obsidian";
import type { AnnotateService } from "./annotate-service";
import type { ArchiveService } from "./archive-service";
import { claudePath, runClaude } from "./claude-cli";
import { vaultRoot } from "./convert";
import type { ClippingIndex } from "./index-store";
import type { ClippingRecord } from "./core/scan";
import { splitFrontmatter } from "./core/scan";
import type { GokoSettings } from "./core/settings";
import { buildTiles } from "./core/tile";
import {
  articleText,
  buildCliArgs,
  buildCliPrompt,
  buildPrompt,
  buildRequest,
  describeCliFailure,
  describeFailure,
  extractText,
  imageMime,
  isDescribed,
  parseCliResult,
  parseResponse,
  pickImage,
  toAnnotation,
  vocabularyOf,
} from "./core/vision";
import type { VisionImage, VisionSettings } from "./core/vision";

/**
 * Sends a clipping's picture, or an article's opening, to a model and writes
 * back what it saw.
 *
 * Everything that can be reasoned about without a network is in core/vision.ts.
 * This is the part that reads bytes off the disk, carries them to a provider
 * — over HTTP with a key, or to Claude Code on this machine — and hands the
 * answer to the one door that writes frontmatter. One request at a time,
 * always: a provider rate-limits, a sync client falls over under a hundred
 * file writes, and a queue that runs in order is a queue whose progress
 * means something.
 */

/** The picture going with a request, once it is known to exist and be readable. */
interface Cover {
  path: string;
  file: TFile;
  mime: string;
}

/** A model's text, or the reason there is none. */
type Reply = { text: string } | { failed: string };

/**
 * From this many at once, a Claude Code batch is told what it costs. A
 * subscription's window is finite, and "describe all" on a big wall is the
 * way to find that out the hard way.
 */
const QUOTA_WARNING_AT = 20;

export class VisionService {
  private queue: string[] = [];
  private queued = new Set<string>();
  private running = false;

  /** Progress for the wall's bar, when it is open to show one. */
  onProgress: ((done: number, total: number) => void) | null = null;

  constructor(
    private app: App,
    private settings: () => GokoSettings,
    private index: ClippingIndex,
    private archiver: ArchiveService,
    private annotator: AnnotateService
  ) {}

  private vision(): VisionSettings {
    const s = this.settings();
    return {
      provider: s.aiProvider,
      apiKey: (s.aiKeySecret ? this.app.secretStorage.getSecret(s.aiKeySecret) : null)?.trim() ?? "",
      model: s.aiModel.trim(),
      tagProperty: s.aiTagProperty.trim() || "categories",
      effort: s.aiEffort,
      cliPath: s.aiCliPath.trim(),
    };
  }

  /**
   * Whether there is something to call with: a key for an HTTP provider, a
   * desktop for Claude Code. The commands ask before queueing.
   */
  get ready(): boolean {
    const v = this.vision();
    if (!v.model) return false;
    return v.provider === "claude-cli" ? Platform.isDesktopApp : v.apiKey.length > 0;
  }

  /**
   * Queues clippings for description and starts the queue if it is idle.
   *
   * @param force describe even those that already have a summary. The bulk
   * command leaves them alone; a person pointing at one card means it.
   * @param quiet say nothing when there is nothing to do. For the automatic
   * path, where "already described" is not news to anyone.
   */
  describe(paths: readonly string[], force = false, quiet = false): void {
    const v = this.vision();
    if (!this.ready) {
      if (quiet) return;
      new Notice(
        v.provider === "claude-cli"
          ? Platform.isDesktopApp
            ? "Goko: pick a model under Settings → Goko → AI descriptions first"
            : "Goko: Claude Code runs on the desktop only — pick a provider with an API key here"
          : "Goko: add an API key and a model under Settings → Goko → AI descriptions first"
      );
      return;
    }
    // One check for the whole batch, so a missing program is one message
    // and not one per picture.
    if (v.provider === "claude-cli" && !claudePath(v.cliPath ?? "")) {
      if (!quiet) new Notice("Goko: Claude Code was not found — install it, or set its path under Settings → Goko → AI descriptions");
      return;
    }

    let added = 0;
    for (const path of paths) {
      if (this.queued.has(path)) continue;
      const record = this.index.get(path);
      if (!record) continue;
      if (!force && isDescribed(record)) continue;
      this.queue.push(path);
      this.queued.add(path);
      added++;
    }

    if (added === 0) {
      if (!quiet) new Notice(force ? "Goko: nothing to describe" : "Goko: everything selected is already described");
      return;
    }
    if (v.provider === "claude-cli" && added >= QUOTA_WARNING_AT) {
      new Notice(`Goko: ${added} clippings queued — each one counts against your Claude subscription`);
    }
    void this.run();
  }

  /** Everything on the wall without a summary yet. */
  describeUndescribed(): void {
    const paths = this.index.records().filter((r) => !isDescribed(r)).map((r) => r.path);
    if (paths.length === 0) {
      new Notice("Goko: every clipping already has a summary");
      return;
    }
    this.describe(paths, false);
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const total = this.queue.length;
    let done = 0;
    let written = 0;
    let failed = 0;
    let lastFailure = "";

    try {
      while (this.queue.length > 0) {
        const path = this.queue.shift()!;
        this.queued.delete(path);
        const record = this.index.get(path);
        if (record) {
          const result = await this.describeOne(record);
          if (result === true) written++;
          else if (result) {
            failed++;
            lastFailure = result;
          }
        }
        done++;
        this.onProgress?.(done, Math.max(total, done + this.queue.length));
      }
    } finally {
      this.running = false;
      this.onProgress?.(0, 0);
    }

    const notes = written === 1 ? "1 clipping" : `${written} clippings`;
    if (failed === 0) new Notice(`Goko: described ${notes}`);
    else new Notice(`Goko: described ${notes}, ${failed} failed (${lastFailure})`);
  }

  /**
   * One clipping, start to finish. Returns true when something was written,
   * a reason when it failed, or false when there was nothing to do — a card
   * with no local picture and no prose, say — which is not a failure worth
   * counting.
   *
   * A clipping is sent as a picture, as an article, or as both: an article
   * with a cover gets its text and its cover, an article whose cover is
   * remote or unreadable gets its text alone, and a picture with a caption
   * gets the picture. A cover in a format no model takes is a failure for a
   * picture and nothing at all for an article, whose cover it only was.
   */
  private async describeOne(record: ClippingRecord): Promise<true | false | string> {
    const [tile] = buildTiles([record], this.archiver.cache);
    const imagePath = tile
      ? pickImage(tile, (file) => this.archiver.cache.byFile(file)?.thumb || undefined)
      : null;
    const article = await this.articleOf(record);

    let cover: Cover | null = null;
    if (imagePath) {
      const mime = imageMime(imagePath);
      const file = this.app.vault.getAbstractFileByPath(normalizePath(imagePath));
      if (mime && file instanceof TFile) cover = { path: imagePath, file, mime };
      else if (!article) {
        return mime ? false : `${imagePath.slice(imagePath.lastIndexOf(".") + 1)} is not a format the model takes`;
      }
    }
    if (!cover && !article) return false;

    const settings = this.vision();
    const vocabulary = vocabularyOf(this.index.records(), settings.tagProperty);
    const prompt = buildPrompt(record, vocabulary, article);

    const reply =
      settings.provider === "claude-cli"
        ? await this.askClaudeCode(settings, prompt, cover?.path ?? null)
        : await this.askProvider(settings, prompt, cover);
    if ("failed" in reply) return reply.failed;

    const answer = parseResponse(reply.text);
    if (!answer) return "the model's answer was not the JSON asked for";

    const outcome = await this.annotator.annotate(record.path, toAnnotation(answer, settings.tagProperty));
    if (!outcome) return false;
    if (outcome.refused.length > 0 && outcome.written.length === 0) {
      return `${outcome.refused.join(", ")} is not editable — see Settings → Goko → Properties`;
    }
    return outcome.changed;
  }

  /** The note's prose when there is enough of it to be an article, else "". */
  private async articleOf(record: ClippingRecord): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(record.path));
    if (!(file instanceof TFile)) return "";
    try {
      const body = await this.app.vault.cachedRead(file);
      return articleText(splitFrontmatter(body).rest);
    } catch {
      return "";
    }
  }

  /** Over HTTP, with the picture's bytes in the request when there is one. */
  private async askProvider(settings: VisionSettings, prompt: string, cover: Cover | null): Promise<Reply> {
    let image: VisionImage | null = null;
    if (cover) {
      try {
        image = { base64: arrayBufferToBase64(await this.app.vault.readBinary(cover.file)), mime: cover.mime };
      } catch (error) {
        return { failed: `could not read ${cover.file.name} (${String(error)})` };
      }
    }

    const request = buildRequest(settings, prompt, image);
    let status = 0;
    let payload: unknown;
    try {
      const response = await requestUrl({
        url: request.url,
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
        throw: false,
      });
      status = response.status;
      payload = response.json;
    } catch (error) {
      return { failed: `network error (${String(error)})` };
    }

    if (status < 200 || status >= 300) return { failed: describeFailure(status, payload) };
    const text = extractText(settings.provider, payload);
    return text ? { text } : { failed: "the model sent back nothing readable" };
  }

  /**
   * Through Claude Code on this machine. The picture stays on disk: the
   * prompt says where it is, and the program reads it itself from the vault,
   * which is its working directory.
   */
  private async askClaudeCode(settings: VisionSettings, prompt: string, picture: string | null): Promise<Reply> {
    const binary = claudePath(settings.cliPath ?? "");
    if (!binary) {
      return { failed: describeCliFailure({ stdout: "", stderr: "", code: null, timedOut: false, missing: true }, null) };
    }
    const root = vaultRoot(this.app.vault);
    if (!root) return { failed: "the vault is not on a disk Claude Code can read" };

    const run = await runClaude(binary, buildCliArgs(settings, buildCliPrompt(prompt, picture)), root);
    const { text, error } = parseCliResult(run.stdout);
    return text ? { text } : { failed: describeCliFailure(run, error) };
  }
}
