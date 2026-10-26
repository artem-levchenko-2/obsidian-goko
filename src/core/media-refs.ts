import type { CacheEntry } from "./cache";
import { posterPath, previewPath, stillPath } from "./derive";
import { extensionOf, isRenderable } from "./formats";
import { dedupeMedia, normalizeUrl, sourceVideoKeyFor } from "./normalize";
import type { ClippingRecord } from "./scan";

/**
 * Which archived files are still spoken for, and which are debris.
 *
 * Archived filenames come from a hash of the normalized source URL, so two
 * clippings that embed the same image share one file on disk. That is what
 * makes deleting media a question of reference counting rather than of
 * following one clipping's own list: take a clipping away and its files only
 * become rubbish if nothing that survives it points at them too.
 *
 * Pure, and told what is on disk rather than looking: the same computation
 * answers "what does deleting these three take with them" and "what is
 * lying around unreferenced", and neither needs a vault to be tested.
 */

export interface LiveRefs {
  /** Cache keys, which resolve through the cache to a file and a thumbnail. */
  keys: Set<string>;
  /** Vault paths referenced directly, as a pasted image's cover is. */
  paths: Set<string>;
}

/** Twelve hex characters and a dash: an archived file's name. */
const ARCHIVED = /^[0-9a-f]{12}-/;
/** A clipboard capture or a page scan, named for the day it was made. */
const PASTED = /^(pasted|scan)-\d{4}-\d{2}-\d{2}/;

function isRemote(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * True for a file this plugin created, by its naming alone.
 *
 * The sweep is limited to these because the attachment folder is a setting:
 * point it at a folder shared with the rest of the vault and "everything
 * nothing references" would mean somebody's holiday photos.
 */
export function isPluginOwned(name: string): boolean {
  return ARCHIVED.test(name) || PASTED.test(name);
}

/**
 * The clippings to read again because a file has just appeared in the vault
 * or moved, by note path.
 *
 * An embed is recorded as the path its link led to when the note was read.
 * A link that names a file alone still leads to it after it moves, so
 * Obsidian has no reason to touch the note, and the recorded path would go
 * on pointing where the file was: the card lost its picture or its video
 * until the next launch. Read again are a note whose embed led to the old
 * path, one whose embed names the new path outright, and one whose embed
 * led nowhere and names a file of this name. Nothing else: every file Goko
 * downloads arrives this way too, hundreds to a pass.
 */
export function notesToReread(
  records: readonly ClippingRecord[],
  file: { path: string; name: string },
  oldPath: string | null,
  exists: (path: string) => boolean
): string[] {
  const name = file.name.toLowerCase();
  const names = (url: string): boolean =>
    url === oldPath ||
    url === file.path ||
    (basename(url).toLowerCase() === name && !exists(url));
  return records
    .filter((record) => record.media.some((media) => !isRemote(media.url) && names(media.url)))
    .map((record) => record.path);
}

/**
 * Whether a pulled video can actually be shown, which is the same question
 * tile.ts asks: the file itself if the browser will play that container,
 * otherwise the frame extracted from it, and nothing if there is neither.
 */
function videoCovers(entry: CacheEntry | undefined): boolean {
  if (!entry?.file) return false;
  return isRenderable(extensionOf(entry.file)) || Boolean(entry.thumb);
}

/**
 * Every cache key and vault path the given clippings still need.
 *
 * @param cache lets one redundancy be spotted: a post whose video was pulled
 * never shows the still the page publishes, because tile.ts prefers the
 * video, so that download is spare. Without a cache the page cover is always
 * counted live, which is the safe answer rather than the tidy one.
 */
export function liveRefs(
  records: readonly ClippingRecord[],
  cache: readonly CacheEntry[] = []
): LiveRefs {
  const keys = new Set<string>();
  const paths = new Set<string>();
  const byKey = new Map(cache.map((entry) => [entry.key, entry]));

  for (const record of records) {
    if (record.source) {
      const videoKey = sourceVideoKeyFor(record.source);
      keys.add(videoKey);
      // The page's own preview image, needed only while nothing better has
      // been archived for the same post.
      if (!videoCovers(byKey.get(videoKey))) keys.add(normalizeUrl(record.source));
    }

    // Deduped through the same path the archiver used, so the keys match.
    for (const media of dedupeMedia(record.media)) keys.add(media.key);

    // A pasted image is a vault path from the start. A HEIC one is also in
    // the cache, keyed by that same path, because that is where its preview
    // is recorded; counting the key is what keeps the preview with it.
    if (record.cover && !isRemote(record.cover)) {
      paths.add(record.cover);
      keys.add(normalizeUrl(record.cover));
    }
    for (const media of record.media) {
      if (!isRemote(media.url)) paths.add(media.url);
    }
  }

  return { keys, paths };
}

/**
 * The files a set of refs resolves to: archived originals, the thumbnails
 * generated from them, and any vault path referenced outright. Deduped, so
 * media two clippings share is named once.
 *
 * Distinct from the view's own filesFor, which is about exporting and so
 * deliberately lists originals only. Here a generated poster is as much a
 * file on disk as the video it came from.
 */
export function filesForRefs(live: LiveRefs, cache: readonly CacheEntry[]): string[] {
  const files = new Set<string>();

  for (const entry of cache) {
    if (!live.keys.has(entry.key)) continue;
    if (entry.file) files.add(entry.file);
    if (entry.thumb) files.add(entry.thumb);
  }
  for (const path of live.paths) files.add(path);

  return [...files];
}

export interface OrphanQuery {
  /** What the surviving clippings reference. */
  live: LiveRefs;
  cache: readonly CacheEntry[];
  /** Vault paths of everything in the attachment folder. */
  onDisk: readonly string[];
}

/**
 * Files on disk that nothing references any more, in the order given.
 *
 * A thumbnail is not referenced by anything on its own; it belongs to the
 * file it was generated from and lives and dies with it.
 */
export function orphanFiles({ live, cache, onDisk }: OrphanQuery): string[] {
  const spoken = new Set(filesForRefs(live, cache));
  return onDisk.filter((path) => !spoken.has(path) && isPluginOwned(basename(path)));
}

/**
 * Cache entries whose file has just been removed, so they can be dropped.
 *
 * Left in place they would tell the archiver a URL is already local, and the
 * tile would point at a file in the trash. Dropping them means clipping that
 * URL again downloads it again, which is the honest answer.
 */
export function deadKeys(cache: readonly CacheEntry[], removed: readonly string[]): string[] {
  const gone = new Set(removed);
  return cache
    .filter((entry) => Boolean(entry.file) && gone.has(entry.file))
    .map((entry) => entry.key);
}

/** What one deleted file in the vault takes with it. */
export interface DeletionPlan {
  /** Cache keys of the entries that described the file. */
  drop: string[];
  /** Surviving entries whose derived still was the file, so they forget it. */
  unthumb: string[];
  /** Derived stills that go to the trash with the file. */
  trash: string[];
  /** Clippings that embed the file, to be read again. */
  reread: string[];
}

/** The endings of a file Goko draws from an original: see derive.ts. */
const DERIVED = [".poster.webp", ".still.webp", ".thumb.webp", ".preview.png"];

function isDerived(path: string): boolean {
  const lower = path.toLowerCase();
  return DERIVED.some((ending) => lower.endsWith(ending));
}

/**
 * What follows from a file, other than a note, having left the vault.
 *
 * The cache entries that name it are dropped, so the card stops standing on
 * a file that is gone. Its still goes with it: the still is part of what
 * the person deleted, as it moves with the file when that is moved, and
 * restoring the original from the trash makes it again. Only a still no
 * surviving entry uses, and only one told by its name to be derived, so an
 * original that another entry holds is never taken. Where just a still was
 * deleted, the entry that named it forgets it and the next pass draws it
 * again.
 *
 * Told what is in the vault rather than looking, like the rest of this file;
 * `exists` is asked about other paths and answers for the deleted one itself.
 */
export function planFileDeletion(
  cache: readonly CacheEntry[],
  records: readonly ClippingRecord[],
  file: { path: string; name: string },
  exists: (path: string) => boolean
): DeletionPlan {
  const drop = deadKeys(cache, [file.path]);
  const dropped = new Set(drop);
  const surviving = cache.filter((entry) => !dropped.has(entry.key));
  const used = new Set<string>();
  for (const entry of surviving) {
    if (entry.file) used.add(entry.file);
    if (entry.thumb) used.add(entry.thumb);
  }

  const trash = new Set<string>();
  for (const entry of cache) {
    if (!dropped.has(entry.key)) continue;
    const { thumb } = entry;
    if (thumb && thumb !== file.path && isDerived(thumb) && !used.has(thumb)) trash.add(thumb);
  }

  return {
    drop,
    unthumb: surviving.filter((entry) => entry.thumb === file.path).map((entry) => entry.key),
    trash: [...trash],
    reread: notesToReread(records, file, null, (path) => path !== file.path && exists(path)),
  };
}

/** What one moved file in the vault takes along. */
export interface MovePlan {
  /** Entries to write at their new place; `from` is the key they had. */
  entries: Array<{ from: string; entry: CacheEntry; stillFrom: string | null }>;
  /** Derived stills to rename beside the file, `from` the old path. */
  renames: Array<{ from: string; to: string }>;
}

/**
 * What follows from a file, other than a note, having moved in the vault.
 *
 * The entry that holds it follows: its file is the new path, and so is its
 * key where the key was the vault path, as for a file a note embeds. A file
 * Goko downloaded is keyed by its source URL, which does not move. Its
 * still follows it to the path derived from the new location, so nothing
 * has to be drawn again.
 *
 * Moving a folder announces every file in it, stills included, in no order
 * we control, so the still is looked for where it is: already at its new
 * place, it only has to be written down; gone from both places, it is
 * forgotten and drawn again; and when the new place is taken by something
 * else, both files are left alone and the entry keeps the still that
 * exists. A still named otherwise than by derive.ts is not moved.
 *
 * Told what is in the vault rather than looking, like the rest of this file.
 */
export function planFileMove(
  cache: readonly CacheEntry[],
  oldPath: string,
  newPath: string,
  exists: (path: string) => boolean
): MovePlan {
  const plan: MovePlan = { entries: [], renames: [] };
  const taken = new Set(cache.map((entry) => entry.key));
  for (const entry of cache) {
    if (entry.file !== oldPath) continue;
    const key = entry.key === normalizeUrl(oldPath) ? normalizeUrl(newPath) : entry.key;
    // Another entry already stands at the new place: not ours to overwrite.
    if (key !== entry.key && taken.has(key)) continue;

    let thumb = entry.thumb;
    let stillFrom: string | null = null;
    const derive = [posterPath, stillPath, previewPath].find((fn) => fn(oldPath) === entry.thumb);
    if (derive) {
      const target = derive(newPath);
      if (!exists(entry.thumb) && exists(target)) {
        thumb = target;
      } else if (!exists(entry.thumb)) {
        thumb = "";
      } else if (!exists(target)) {
        thumb = target;
        stillFrom = entry.thumb;
        plan.renames.push({ from: entry.thumb, to: target });
      }
    }
    const next: CacheEntry = { ...entry, key, file: newPath, thumb };
    if (thumb === "" && entry.thumb !== "") delete next.thumbFailed;
    plan.entries.push({ from: entry.key, entry: next, stillFrom });
  }
  return plan;
}

/** A set of files considered together, with what they weigh. */
export interface Sweepable {
  paths: string[];
  bytes: number;
}

const UNITS = ["KB", "MB", "GB"];

/** A byte count as a person reads it. Shared with the inspector, which
    reports the weight of one file rather than of a sweep. */
export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }

  // One decimal until the number is big enough to carry itself.
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${UNITS[unit]}`;
}

/**
 * How a set of files is described before anything is deleted. Size is the
 * number that decides whether this is worth doing, so it is never left out.
 */
export function describeFiles({ paths, bytes }: Sweepable): string {
  return `${paths.length} file${paths.length === 1 ? "" : "s"} (${humanBytes(bytes)})`;
}
