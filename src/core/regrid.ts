/**
 * A folder made into a grid of its own, and a grid made into a folder on
 * another: the two ways a board's shape changes once there is more on it,
 * or less, than it was made for.
 *
 * Pure: which moves are allowed, what the new definition looks like and
 * where it goes in the list. view.ts moves the clippings and records the
 * step for undo.
 */

import type { FolderSpace } from "./folders";
import { PLAIN_FOLDER_ICON, PLAIN_GRID_ICON } from "./shared-config";
import { isSmartGrid } from "./spaces";
import type { GridSpace } from "./spaces";

/**
 * Why a folder cannot become a grid, or null when it can: a grid has to
 * have a name that no other grid, and not the inbox, already answers to.
 */
export function promotionRefusal(
  folder: FolderSpace,
  grids: readonly GridSpace[],
  homeName: string
): string | null {
  const name = folder.name.trim().toLowerCase();
  if (name === homeName.trim().toLowerCase() || grids.some((g) => g.name.trim().toLowerCase() === name)) {
    return `there is already a grid called ${folder.name}`;
  }
  return null;
}

/**
 * The grid a folder becomes.
 *
 * It keeps looking like the board it came off: the folder was drawn in that
 * grid's colour, and a folder's icon is almost always the plain folder, which
 * would say nothing on a grid, so it takes the grid's icon too. An icon the
 * folder was given on purpose is its own and goes with it.
 */
export function promotedGrid(folder: FolderSpace, from: GridSpace | undefined): GridSpace {
  const icon = folder.icon !== PLAIN_FOLDER_ICON ? folder.icon : (from?.icon ?? PLAIN_GRID_ICON);
  const grid: GridSpace = { name: folder.name, icon };
  if (from?.color) grid.color = from.color;
  return grid;
}

/**
 * Why a grid cannot become a folder on `into`, or null when it can.
 *
 * A folder holds clippings and nothing else, so the grid must be a place
 * rather than a rule, and must not have folders of its own: Goko reads two
 * levels, a grid and a folder on it, and a folder inside a folder would have
 * its clippings shown as the outer one's with nothing to say they were apart.
 * The inbox is never a target: it is not in the registry the caller looks
 * `into` up in, and a folder on it would be a directory beside the grids in
 * a vault whose folders are the grids.
 */
export function demotionRefusal(
  grid: GridSpace,
  into: GridSpace | undefined,
  folders: readonly FolderSpace[]
): string | null {
  if (isSmartGrid(grid)) return `${grid.name} is a view, and a view cannot be a folder`;
  if (!into) return "pick a grid to put it on";
  if (into.name === grid.name) return `${grid.name} cannot be a folder on itself`;
  if (isSmartGrid(into)) return `${into.name} is a view, and nothing is filed on a view`;
  const own = folders.filter((folder) => folder.grid === grid.name);
  if (own.length > 0) {
    const names = own.map((folder) => folder.name).join(", ");
    return `${grid.name} has folders of its own (${names}). Move them out or remove them first`;
  }
  const name = grid.name.trim().toLowerCase();
  if (folders.some((folder) => folder.grid === into.name && folder.name.trim().toLowerCase() === name)) {
    return `${into.name} already has a folder called ${grid.name}`;
  }
  return null;
}

/**
 * The folder a grid becomes. Its icon goes with it when it has one of its
 * own; its colour, description and look do not, since a folder is drawn in
 * the colour of the grid it is on and has neither of the others.
 */
export function demotedFolder(grid: GridSpace, into: string): FolderSpace {
  return {
    name: grid.name,
    icon: grid.icon !== PLAIN_GRID_ICON ? grid.icon : PLAIN_FOLDER_ICON,
    grid: into,
    width: 1,
  };
}

/**
 * `list` with `item` put just before or after the entry `at` picks out, or
 * at the end when it picks nothing out.
 */
export function insertBeside<T>(
  list: readonly T[],
  item: T,
  at: (entry: T) => boolean,
  after: boolean
): T[] {
  const out = [...list];
  const index = out.findIndex(at);
  if (index < 0) out.push(item);
  else out.splice(index + (after ? 1 : 0), 0, item);
  return out;
}
