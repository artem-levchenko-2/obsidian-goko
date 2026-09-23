import type { App, TFile } from "obsidian";
import type { Placement } from "./core/placement";
import { ClippingRecord, scanClipping, splitFrontmatter } from "./core/scan";
import { cleanUrl } from "./core/resolve";

export function isInFolder(path: string, folder: string): boolean {
  if (!path.toLowerCase().endsWith(".md")) return false;
  const prefix = folder.endsWith("/") ? folder : folder + "/";
  if (!path.startsWith(prefix)) return false;
  const name = path.slice(path.lastIndexOf("/") + 1);
  return !name.startsWith("_");
}

export function sortRecords(records: ClippingRecord[]): ClippingRecord[] {
  return [...records].sort((a, b) => {
    if (a.created !== b.created) {
      if (!a.created) return 1;
      if (!b.created) return -1;
      return a.created < b.created ? 1 : -1;
    }
    return a.title.localeCompare(b.title);
  });
}

/**
 * The records in an order that has nothing to do with when they arrived.
 *
 * Seeded, so the wall does not reorder itself on every repaint: a shuffle is
 * something the reader asks for, and one they ask for again to get a new one.
 * Fisher–Yates over a copy, with a small LCG for the seed — quality of the
 * randomness is beside the point here, repeatability is the point.
 */
export function shuffleRecords(records: ClippingRecord[], seed: number): ClippingRecord[] {
  const out = [...records];
  let state = (seed >>> 0) || 1;
  const next = (): number => {
    // Numerical Recipes' LCG constants; period 2^32, fine for a wall.
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export class ClippingIndex {
  private byPath = new Map<string, ClippingRecord>();
  /**
   * Note path by the address it was clipped from, so "have I got this
   * already?" is a lookup.
   *
   * Capture asked that question by walking records(), which sorts the whole
   * map because every ingest drops the sort cache below. One clip made by
   * hand never noticed; a backfill of a thousand pins pays a thousand full
   * sorts of a growing map before it has written anything.
   *
   * Keyed on cleanUrl, the same normalisation capture compares with, so the
   * two cannot disagree about what counts as the same address. Clippings
   * with no source are left out: they are not the same thing as each other.
   */
  private pathBySource = new Map<string, string>();
  private listeners: Array<() => void> = [];
  /** sortRecords copies and sorts the whole map, and records() has several
      callers per repaint. Dropped on every mutation below. */
  private sorted: ClippingRecord[] | null = null;

  /**
   * parseYaml is injected rather than imported. A value import from obsidian
   * would stop vitest resolving this file at all, taking isInFolder and
   * sortRecords down with it; the type-only imports above are erased at build
   * time and cost nothing.
   */
  constructor(
    private app: App,
    private folder: () => string,
    private parseYaml: (yaml: string) => unknown,
    /**
     * Where the path says a clipping is filed, or null to believe the
     * frontmatter. Injected rather than read from settings, so this file
     * still loads under vitest and so there is exactly one place that
     * decides which model is in force (placement-service.ts).
     */
    private placementOf: ((path: string) => Placement | null) | null = null
  ) {}

  records(): ClippingRecord[] {
    if (!this.sorted) this.sorted = sortRecords([...this.byPath.values()]);
    return this.sorted;
  }

  get(path: string): ClippingRecord | undefined {
    return this.byPath.get(path);
  }

  /** The clipping already made from this address, or undefined for none. */
  bySource(url: string): ClippingRecord | undefined {
    const path = this.pathBySource.get(cleanUrl(url));
    return path ? this.byPath.get(path) : undefined;
  }

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  async rebuild(): Promise<void> {
    this.byPath.clear();
    this.pathBySource.clear();
    this.sorted = null;
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => isInFolder(f.path, this.folder()));
    for (const file of files) await this.ingest(file);
    this.emit();
  }

  async ingest(file: TFile): Promise<void> {
    if (!isInFolder(file.path, this.folder())) return;
    const body = await this.app.vault.cachedRead(file);
    const record = scanClipping(file.path, this.frontmatterOf(file, body), body);
    // In folder mode the path is the answer and the keys are ignored. Left in
    // the note rather than stripped: turning the mode off must give the vault
    // back exactly as it was, and a key nothing reads is harmless.
    const placement = this.placementOf?.(file.path);
    this.byPath.set(
      file.path,
      placement ? { ...record, grid: placement.grid, folder: placement.folder } : record
    );
    this.rememberSource(file.path, record.source);
    this.sorted = null;
  }

  /**
   * Files the note under its address, dropping the address it had before.
   *
   * A note's source can change — the frontmatter is editable — so the old
   * key has to go or a stale address would keep answering for it. Two notes
   * clipped from one address is a duplicate the wall tolerates; the last one
   * ingested wins the key, which is the same answer a scan of the folder
   * would have given.
   */
  private rememberSource(path: string, source: string): void {
    for (const [key, held] of this.pathBySource) {
      if (held === path) this.pathBySource.delete(key);
    }
    const key = cleanUrl(source);
    if (key) this.pathBySource.set(key, path);
  }

  /**
   * Frontmatter for a file, without waiting on the metadata cache.
   *
   * The cache resolves after the write, so a note just created by capture or
   * by the Web Clipper has none. That is not cosmetic here: every route
   * pickCover has to a cover runs through frontmatter, and a captured note
   * embeds its media as local wikilinks that the body scan does not collect,
   * so with no frontmatter there is no cover and the clipping cannot render
   * at all. Waiting for Obsidian to parse a note we just wrote ourselves is
   * what put the several second gap between the progress bar finishing and
   * the tile appearing. The body is already in hand, so read it from there.
   */
  private frontmatterOf(file: TFile, body: string): Record<string, unknown> {
    const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (cached && Object.keys(cached).length > 0) return cached;

    const { yaml } = splitFrontmatter(body);
    if (!yaml) return cached ?? {};

    try {
      const parsed: unknown = this.parseYaml(yaml);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : cached ?? {};
    } catch {
      // Half-written yaml is normal mid-clip; the cache will catch up.
      return cached ?? {};
    }
  }

  async handleModify(file: TFile): Promise<void> {
    if (!isInFolder(file.path, this.folder())) return;
    await this.ingest(file);
    this.emit();
  }

  handleDelete(path: string): void {
    if (!this.byPath.delete(path)) return;
    for (const [key, held] of this.pathBySource) {
      if (held === path) this.pathBySource.delete(key);
    }
    this.sorted = null;
    this.emit();
  }

  async handleRename(file: TFile, oldPath: string): Promise<void> {
    const had = this.byPath.delete(oldPath);
    for (const [key, held] of this.pathBySource) {
      if (held === oldPath) this.pathBySource.delete(key);
    }
    this.sorted = null;
    await this.ingest(file);
    if (had || this.byPath.has(file.path)) this.emit();
  }
}
