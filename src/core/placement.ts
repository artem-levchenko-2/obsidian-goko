/**
 * Where a clipping lives, read from and written as its path in the vault.
 *
 * One way is to file a clipping by writing `grid:` into its frontmatter and
 * leave the note wherever it landed. That works, and it is what this plugin
 * did first, but it means the folder tree in Obsidian's own explorer says
 * nothing about the wall: everything in one heap, and the boards exist only
 * inside the plugin.
 *
 * The other way round, a grid is a folder:
 *
 *     Library/                     the clippings folder — Inbox, unfiled
 *     Library/Payments/            a grid
 *     Library/Payments/Checkout/   a folder on that grid
 *
 * Then moving a card in Goko moves the file, dragging the file in the
 * explorer moves the card, and a folder made by hand is a grid. Obsidian
 * rewrites every link into a note it moves, so nothing breaks on the way.
 *
 * Deeper than two levels belongs to the same folder: a wall is two levels
 * deep by design, and a third would have nowhere to be shown.
 *
 * Pure. The service that renames files is placement-service.ts.
 */

/** Where a clipping is filed. `""` means Inbox, or loose on its grid. */
export interface Placement {
  grid: string;
  folder: string;
}

export const LOOSE: Placement = { grid: "", folder: "" };

/**
 * The segments of a path below the clippings folder, or null when the path
 * is not inside it. The file's own name is not one of them.
 */
function segmentsUnder(path: string, root: string): string[] | null {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  if (!path.startsWith(prefix)) return null;
  const parts = path.slice(prefix.length).split("/");
  parts.pop();
  return parts;
}

/**
 * The grid and folder a path puts a clipping in.
 *
 * A path outside the clippings folder reads as loose rather than throwing:
 * the index only ever asks about notes it has already decided are clippings,
 * and a caller who gets this wrong should see the same harmless answer an
 * unfiled note gives.
 */
export function placementOfPath(path: string, root: string): Placement {
  const parts = segmentsUnder(path, root);
  if (!parts || parts.length === 0) return LOOSE;
  return { grid: parts[0], folder: parts[1] ?? "" };
}

/** The folder a clipping should be in for a placement, without its file name. */
export function folderForPlacement(root: string, placement: Placement): string {
  const parts = [root, placement.grid.trim(), placement.folder.trim()].filter(Boolean);
  return parts.join("/");
}

/**
 * Where a note moves to for a placement, or null when it is already there.
 *
 * Null rather than the same path, so a caller can tell "nothing to do" from
 * "move it here" without comparing strings itself — which is how a no-op move
 * would otherwise end up in the undo history as a step that does nothing.
 */
export function pathForPlacement(path: string, root: string, placement: Placement): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const target = `${folderForPlacement(root, placement)}/${name}`;
  return target === path ? null : target;
}

/**
 * A free path for a note arriving in a folder that already holds that name.
 *
 * ` 2`, ` 3` and so on, the way Obsidian's own duplicate naming reads, and
 * the way capture already names a second clipping of the same title.
 */
export function freePath(target: string, taken: (path: string) => boolean): string {
  if (!taken(target)) return target;
  const dot = target.lastIndexOf(".");
  const stem = dot > 0 ? target.slice(0, dot) : target;
  const ext = dot > 0 ? target.slice(dot) : "";
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} ${n}${ext}`;
    if (!taken(candidate)) return candidate;
  }
  // A thousand notes of one name in one folder is not a case to design for,
  // but silently overwriting one of them is not an outcome either.
  return `${stem} ${Date.now()}${ext}`;
}

/** A grid and the folders on it, as the folder tree says. */
export interface FolderTree {
  grids: string[];
  folders: Array<{ name: string; grid: string }>;
}

/**
 * The grids and folders that exist as folders on disk.
 *
 * Takes every folder path under the clippings folder, at any depth, and reads
 * the registry off the first two levels. Sorted by name, since a folder tree
 * has no order of its own — the stored order in the shared config is what
 * decides how they are shown, and this only says what there is.
 */
export function treeFromFolders(folderPaths: readonly string[], root: string): FolderTree {
  const grids = new Set<string>();
  const folders = new Map<string, { name: string; grid: string }>();

  for (const path of folderPaths) {
    const prefix = root.endsWith("/") ? root : `${root}/`;
    if (!path.startsWith(prefix)) continue;
    const parts = path.slice(prefix.length).split("/").filter(Boolean);
    if (parts.length === 0) continue;
    // A folder whose name marks it as not a clipping's home — the shared
    // config's own `_Goko.md` lives beside them, and the index skips files
    // named that way for the same reason.
    if (parts.some((part) => part.startsWith("_") || part.startsWith("."))) continue;
    grids.add(parts[0]);
    if (parts.length >= 2) {
      folders.set(`${parts[0]}/${parts[1]}`, { name: parts[1], grid: parts[0] });
    }
  }

  return {
    grids: [...grids].sort((a, b) => a.localeCompare(b)),
    folders: [...folders.values()].sort(
      (a, b) => a.grid.localeCompare(b.grid) || a.name.localeCompare(b.name)
    ),
  };
}

/**
 * Merges what the folder tree holds with what the shared config remembers.
 *
 * The tree is the truth about what exists; the config is the truth about how
 * it looks and in what order. So: stored entries first, in their order, for
 * every name the tree still has, and folders the config never heard of after
 * them, with whatever default the caller supplies. An entry for a folder that
 * is gone is dropped — deleting a folder in the explorer is a way of deleting
 * a grid, and a registry that kept it would show an empty board forever.
 *
 * Smart views are not folders and never appear in the tree, so they are kept
 * from the stored list untouched — `isSmart` is what tells them apart.
 */
export function mergeByName<T extends { name: string }>(
  names: readonly string[],
  stored: readonly T[],
  make: (name: string) => T,
  isSmart: (entry: T) => boolean = () => false
): T[] {
  const wanted = new Set(names);
  const out: T[] = [];
  const seen = new Set<string>();

  for (const entry of stored) {
    if (isSmart(entry)) {
      out.push(entry);
      continue;
    }
    if (!wanted.has(entry.name) || seen.has(entry.name)) continue;
    out.push(entry);
    seen.add(entry.name);
  }
  for (const name of names) {
    if (!seen.has(name)) out.push(make(name));
  }
  return out;
}

/**
 * The same merge for folders, which are named per grid rather than globally.
 *
 * Two grids may each hold a folder called Drafts, so a folder is identified
 * by the pair. Stored order wins for what survives, and a folder the config
 * never heard of lands at the end, as with grids.
 */
export function mergeFolders<T extends { name: string; grid: string }>(
  tree: ReadonlyArray<{ name: string; grid: string }>,
  stored: readonly T[],
  make: (entry: { name: string; grid: string }) => T
): T[] {
  const key = (entry: { name: string; grid: string }): string => `${entry.grid}/${entry.name}`;
  const wanted = new Map(tree.map((entry) => [key(entry), entry]));
  const out: T[] = [];
  const seen = new Set<string>();

  for (const entry of stored) {
    const id = key(entry);
    if (!wanted.has(id) || seen.has(id)) continue;
    out.push(entry);
    seen.add(id);
  }
  for (const entry of tree) {
    if (!seen.has(key(entry))) out.push(make(entry));
  }
  return out;
}

/** Characters no folder may carry, on any of the three platforms. */
const ILLEGAL = /[\\/:*?"<>|]/;

/**
 * Why a name cannot be a folder, or null when it can.
 *
 * Stricter than the grid-name and folder-name checks in spaces.ts and
 * folders.ts, which only guard against a clash, because in this mode the
 * name becomes a directory: a slash would make two of them, a leading dot
 * would hide it from the explorer, and a leading underscore is the vault's
 * own mark for a file the index skips. Case-insensitive against the taken
 * list, since two folders differing only in case are one folder on macOS.
 */
export function validatePathName(
  name: string,
  taken: readonly string[],
  label = "name"
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return `The ${label} cannot be empty`;
  if (ILLEGAL.test(trimmed)) return `A ${label} cannot contain \\ / : * ? " < > |`;
  if (trimmed.startsWith(".")) return `A ${label} cannot start with a dot`;
  if (trimmed.startsWith("_")) return `A ${label} cannot start with an underscore`;
  if (trimmed.endsWith(".")) return `A ${label} cannot end with a dot`;
  if (trimmed.length > 100) return `That ${label} is too long`;
  const lower = trimmed.toLowerCase();
  if (taken.some((other) => other.trim().toLowerCase() === lower)) {
    return `A folder called ${trimmed} already exists`;
  }
  return null;
}
