import { DEFAULT_SETTINGS } from "./settings";
import type { GokoSettings } from "./settings";
import { readFolderWidth } from "./folders";
import type { FolderSpace } from "./folders";
import { MAX_GRID_DESCRIPTION, isGridColor } from "./spaces";
import type { GridSpace } from "./spaces";
import type { GridLook } from "./look";
import { hashUrl } from "./hash";

/**
 * The half of the settings that describes the vault, and therefore belongs
 * to the vault.
 *
 * Grids were kept with the rest of the settings, in the plugin's own
 * data.json, which is per-device and travels only if a sync happens to carry
 * `.obsidian`. So a grid made on a desktop did not exist on a phone, while
 * the clippings in it did: membership is a `grid:` key in frontmatter and had
 * been in the vault all along. Only the definition was stranded.
 *
 * What stays behind is what is true of a device rather than of a vault: how
 * densely the wall is packed, whether the panel is open, which grid was last
 * on screen. A phone has a smaller screen than a desktop and should be
 * allowed to disagree about all three.
 */
export interface SharedConfig {
  grids: GridSpace[];
  /** Absent in a file written before folders, which reads as none. */
  folders: FolderSpace[];
  homeGridName: string;
  homeGridIcon: string;
  /**
   * Home's own look. Here rather than left behind with the tile sizes,
   * because every other grid's look rides along inside `grids` and home
   * being the one wall that forgot itself on another device would read as a
   * bug. Absent means home has none, which is the file speaking for the
   * vault the way the folders list does.
   */
  homeGridLook?: GridLook;
  filterProperties: string[];
}

/*
 * Markdown, holding JSON in a fenced block, rather than a .json file.
 *
 * Not for reading pleasure: it is what every sync path carries without being
 * asked. Obsidian Sync syncs notes by default and treats .json as an
 * unsupported type that is off until someone finds the toggle, which is
 * exactly how the first version of this file failed to reach a phone. Every
 * other transport carries .md too, so this survives changing sync method
 * later.
 *
 * The leading underscore is the vault's own mark for a file in the clippings
 * folder that is not a clipping, and isInFolder already skips those, so the
 * index never sees it despite it now being a note.
 */
export const SHARED_FILE = "_Goko.md";
/**
 * Whether this device may write the shared file.
 *
 * Two callers reach the write — the read at load, which publishes when it
 * finds no file, and every save of settings — and both have to answer this
 * the same way, so it is answered here.
 *
 * `written` is what this device has already read or written this session,
 * empty until it has done either. So the only thing refused is the first
 * creation of a file whose whole content would be the defaults: a new vault
 * does not get a note in its clippings folder before its owner has said
 * anything. Once the file exists, every later write goes through, including
 * one that empties it — a vault that had grids and no longer does is making
 * a statement, not staying quiet.
 */
export function publishesShared(written: string, shared: SharedConfig): boolean {
  return written !== "" || !isDefaultShared(shared);
}

export function sharedOf(settings: GokoSettings): SharedConfig {
  // Copied, not referenced. The caller pushes grids onto this list, and
  // handing out the array inside DEFAULT_SETTINGS would let a vault with no
  // grids yet write real user data into a module-level constant.
  return {
    grids: [...settings.grids],
    folders: [...settings.folders],
    homeGridName: settings.homeGridName,
    homeGridIcon: settings.homeGridIcon,
    homeGridLook: settings.homeGridLook,
    filterProperties: [...settings.filterProperties],
  };
}

/**
 * Whether a device has anything of its own to say about the vault.
 *
 * This decides which device gets to write the file first, and it has to,
 * because whoever writes it wins: every other device reads that file and
 * adopts it. A vault upgraded on a phone before the desktop it was
 * configured on would otherwise publish an empty grid list, and the desktop
 * would come up, read it, and lose everything it had.
 *
 * So a device holding nothing but the defaults stays quiet and waits to be
 * told. The one with the grids publishes them, and if no device has any
 * there is nothing to lose by there being no file yet.
 */
export function isDefaultShared(shared: SharedConfig): boolean {
  const base = sharedOf(DEFAULT_SETTINGS);
  return (
    shared.grids.length === 0 &&
    shared.folders.length === 0 &&
    shared.homeGridName === base.homeGridName &&
    shared.homeGridIcon === base.homeGridIcon &&
    shared.homeGridLook === undefined &&
    shared.filterProperties.length === base.filterProperties.length &&
    shared.filterProperties.every((p, i) => p === base.filterProperties[i])
  );
}

export function withShared(
  settings: GokoSettings,
  shared: SharedConfig
): GokoSettings {
  return { ...settings, ...shared };
}

/** What a folder turned grid starts as, before anyone has said more. */
export const PLAIN_GRID_ICON = "layout-grid";
/** And what a folder on a grid starts as. */
export const PLAIN_FOLDER_ICON = "folder";

/**
 * `base`, with the grids and folders only `extra` knows about added after
 * its own, and everything else — order, looks, home, the filter menu — as
 * `base` has it.
 *
 * What a config from a device that had not seen `base` is folded into,
 * rather than allowed to overwrite it; see descendsFrom. All such a device
 * can add is what it found in its own folder tree. A grid it lacks is kept:
 * the folder tree is the judge of what exists, and the registry sync drops
 * a grid whose folder is gone.
 */
export function rebaseShared(extra: SharedConfig, base: SharedConfig): SharedConfig {
  const grids = [...base.grids];
  for (const grid of extra.grids) {
    if (!grids.some((known) => known.name === grid.name)) grids.push(grid);
  }
  const folders = [...base.folders];
  for (const folder of extra.folders) {
    const known = folders.some((f) => f.name === folder.name && f.grid === folder.grid);
    if (!known) folders.push(folder);
  }
  return { ...base, grids, folders };
}

function isGrid(value: unknown): value is GridSpace {
  if (typeof value !== "object" || value === null) return false;
  const grid = value as Partial<GridSpace>;
  if (typeof grid.name !== "string" || grid.name === "") return false;
  if (typeof grid.icon !== "string") return false;
  // Rules are the smart grid's membership. Absent is a manual grid; anything
  // that is not an object is a file someone has edited into nonsense, and
  // dropping the rules turns that grid manual rather than losing it.
  if (grid.rules !== undefined && (typeof grid.rules !== "object" || grid.rules === null)) {
    return false;
  }
  // A look edited into nonsense is dropped and the grid kept, the way a
  // broken width is: every key in a look is optional, so losing it puts the
  // grid back on the shared settings rather than losing the grid.
  grid.look = readLook(grid.look);
  return true;
}

/** A look as the file spells it, or undefined. Not field by field: every key
    is optional and resolveLook ignores one it does not recognise, so the
    object only has to be an object. */
function readLook(value: unknown): GridLook | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value;
}

/**
 * A grid with only the parts of its look this build understands.
 *
 * A colour name from a later version, or a description someone has edited
 * into an object, is dropped rather than carried: a grid painted with a
 * variable that does not exist is a grid with no colour at all, and this way
 * it says so. Everything else is left exactly as it was found, so a key this
 * build has never heard of survives a round trip through an older one.
 */
function readGrid(grid: GridSpace): GridSpace {
  const out: GridSpace = { ...grid };
  if (!isGridColor(out.color)) delete out.color;
  if (typeof out.description !== "string" || !out.description.trim()) delete out.description;
  else out.description = out.description.trim().slice(0, MAX_GRID_DESCRIPTION);
  return out;
}

/**
 * A folder as the file spells it, or null. A width the wall cannot lay out
 * is a folder it cannot show, and showing it at some guessed size would
 * then be written back as the truth; the retired "full" is the exception,
 * read as three.
 */
function readFolder(value: unknown): FolderSpace | null {
  if (typeof value !== "object" || value === null) return null;
  const folder = value as Partial<FolderSpace>;
  if (typeof folder.name !== "string" || folder.name === "") return null;
  if (typeof folder.icon !== "string") return null;
  if (typeof folder.grid !== "string") return null;
  const width = readFolderWidth(folder.width);
  if (width === null) return null;
  return { name: folder.name, icon: folder.icon, grid: folder.grid, width };
}

function strings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((v): v is string => typeof v === "string") ? [...value] : null;
}

/**
 * Reads what a shared file claims, field by field, keeping whatever this
 * device already had wherever the file does not say something usable.
 *
 * Per field rather than all or nothing on purpose. This file is synced, so
 * it can arrive half-written or merged badly by something that has never
 * heard of it, and one bad key should not throw away the grids next to it.
 */
export function parseShared(raw: unknown, fallback: SharedConfig): SharedConfig {
  if (typeof raw !== "object" || raw === null) return fallback;
  const from = raw as Record<string, unknown>;

  const grids = Array.isArray(from.grids) ? from.grids.filter(isGrid).map(readGrid) : null;
  // Missing is the pre-folders file, and that means no folders rather than
  // whatever this device last saw: the file is the truth for the vault.
  const folders = Array.isArray(from.folders)
    ? from.folders.map(readFolder).filter((f): f is FolderSpace => f !== null)
    : [];
  const properties = strings(from.filterProperties);

  return {
    grids: grids ?? fallback.grids,
    folders,
    homeGridName:
      typeof from.homeGridName === "string" && from.homeGridName !== ""
        ? from.homeGridName
        : fallback.homeGridName,
    homeGridIcon:
      typeof from.homeGridIcon === "string" && from.homeGridIcon !== ""
        ? from.homeGridIcon
        : fallback.homeGridIcon,
    homeGridLook: readLook(from.homeGridLook),
    filterProperties: properties ?? fallback.filterProperties,
  };
}

/**
 * A fingerprint of a config, the same on every device that holds the same
 * grids, folders and settings whatever order its objects' keys are in.
 */
export function configHash(shared: SharedConfig): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value).sort()) {
        const inner = (value as Record<string, unknown>)[key];
        if (inner !== undefined) out[key] = canonical(inner);
      }
      return out;
    }
    return value;
  };
  return hashUrl(JSON.stringify(canonical(shared)));
}

/** How many ancestors a file remembers. A device further behind than this
    is treated as having seen none of them, which only means it is merged. */
const LINEAGE = 32;

/**
 * The fingerprints of the configs a file was written on top of, newest
 * first: the one its writer held, then the ones that one descended from. An
 * empty list for a file from before lineage, or one from a device that had
 * not read the file at all.
 */
export function lineageOf(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null) return [];
  const lineage = (raw as Record<string, unknown>).lineage;
  return Array.isArray(lineage) ? lineage.filter((h): h is string => typeof h === "string").slice(0, LINEAGE) : [];
}

/**
 * The lineage a device writes: what it held, then that config's own
 * ancestry, and any other line it has folded in, without repeats.
 */
export function nextLineage(held: string, ...lines: ReadonlyArray<readonly string[]>): string[] {
  const out: string[] = [];
  for (const hash of [held, ...lines.flat()]) {
    if (hash && !out.includes(hash)) out.push(hash);
  }
  return out.slice(0, LINEAGE);
}

/**
 * Whether a config read from the file was written by a device that had
 * already seen `held`, and so may replace it.
 *
 * In folder mode a device can build its whole grid list from the folders
 * without ever reading this file, and everything it builds is plain. Such
 * a device, or one holding a copy days old, once published its list and
 * every other device took it as the truth: twenty grids lost their icons
 * and colours in one sync, and a guard on revision numbers did not stop it
 * a second time, because a device that has read nothing counts from zero
 * like everyone else. What does tell them apart is whether the writer had
 * seen this device's config. The file carries the fingerprints of what its
 * writer held, and a config this device's own fingerprint is not among is
 * merged into what it holds rather than taking its place.
 */
export function descendsFrom(read: SharedConfig, readLineage: readonly string[], held: SharedConfig): boolean {
  const mine = configHash(held);
  return configHash(read) === mine || readLineage.includes(mine);
}

/** What a device should start from when no file has been written yet. */
export function defaultShared(): SharedConfig {
  return sharedOf(DEFAULT_SETTINGS);
}

const FENCE = "```";

/** Serialised the way it is written, so a caller can tell its own write back
    from one that arrived by sync without re-reading the file. The lineage
    rides beside the config rather than in it: it is about the file, and a
    device's settings have no use for it. */
export function serializeShared(shared: SharedConfig, lineage: readonly string[] = []): string {
  const body = lineage.length === 0 ? shared : { ...shared, lineage };
  return [
    "# Goko",
    "",
    "The grids and folders in this vault, shared by every device that opens it. Written by the Goko plugin; change them in the app rather than here.",
    "",
    `${FENCE}json`,
    JSON.stringify(body, null, 2),
    FENCE,
    "",
  ].join("\n");
}

/**
 * Pulls the configuration out of a file, whichever of the two forms it is in.
 *
 * The fenced block is the current one. A file that is bare JSON is the .json
 * this replaced, read so that a vault which already published one is carried
 * over rather than starting again.
 */
export function extractShared(text: string): unknown {
  const fenced = new RegExp(`${FENCE}json\\s*\\n([\\s\\S]*?)${FENCE}`).exec(text);
  const body = fenced ? fenced[1] : text;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}
