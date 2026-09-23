/**
 * The rail down the left of the wall: what is in it, and how much.
 *
 * Grids have lived in a menu behind a button in the corner, which is a fine
 * way to switch between two and a poor one for knowing what you have. A rail
 * says all of it at once — every board, how many cards are on it, which one
 * you are looking at — and gives a card somewhere to be dropped.
 *
 * Pure: sidebar.ts draws what this returns.
 */

import { matchesFilter } from "./filter";
import type { FacetDef } from "./filter";
import type { FolderSpace } from "./folders";
import type { ClippingRecord } from "./scan";
import { effectiveGrid, isSmartGrid } from "./spaces";
import type { GridSpace } from "./spaces";
import type { TileModel } from "./tile";

export interface SidebarFolder {
  folder: FolderSpace;
  count: number;
}

export interface SidebarGrid {
  grid: GridSpace;
  count: number;
  folders: SidebarFolder[];
  /** True for a grid whose membership is a rule: nothing is filed into one. */
  smart: boolean;
}

export interface SidebarModel {
  /** Home: everything not filed onto a grid. */
  home: SidebarGrid;
  /**
   * Every clipping in the vault, filed or not.
   *
   * Home used to be this, and stopped being it when a grid became a folder:
   * the clippings folder is now the inbox rather than the whole library, so
   * "show me everything" needs a row of its own. It is not a grid — nothing
   * is filed into it and it has no folder — which is why it sits above the
   * rule with the inbox rather than among them.
   */
  all: { count: number };
  grids: SidebarGrid[];
  views: SidebarGrid[];
}

export interface SidebarWorld {
  records: readonly ClippingRecord[];
  grids: readonly GridSpace[];
  folders: readonly FolderSpace[];
  home: GridSpace;
  /** For counting what a smart view would hold; empty skips those counts. */
  tiles?: readonly TileModel[];
  defs?: readonly FacetDef[];
}

/**
 * The rail, counted.
 *
 * Manual grids are counted by where their clippings actually resolve, so a
 * card whose key names a grid that no longer exists is counted at home rather
 * than nowhere — the same fallback the wall itself paints by. A smart view is
 * counted by running its rules, which needs tiles rather than records, and is
 * left at zero when the caller has none to give: a count that is sometimes
 * wrong is worse than a count that is honestly absent.
 */
export function sidebarModel(world: SidebarWorld): SidebarModel {
  const registered = new Set(world.grids.map((grid) => grid.name));
  const homeName = world.home.name;

  const byGrid = new Map<string, ClippingRecord[]>();
  for (const record of world.records) {
    const where = effectiveGrid(record, homeName, registered);
    const held = byGrid.get(where);
    if (held) held.push(record);
    else byGrid.set(where, [record]);
  }

  const foldersOf = (grid: string, members: readonly ClippingRecord[]): SidebarFolder[] => {
    // A folder stores "" for home, as `grid:` does.
    const key = grid === homeName ? "" : grid;
    return world.folders
      .filter((folder) => folder.grid === key)
      .map((folder) => ({
        folder,
        count: members.filter((record) => record.folder.trim() === folder.name).length,
      }));
  };

  const entry = (grid: GridSpace): SidebarGrid => {
    const smart = isSmartGrid(grid);
    if (smart) {
      const rules = grid.rules ?? {};
      const count =
        world.tiles && world.defs
          ? world.tiles.filter((tile) => matchesFilter(tile, rules, [...world.defs!])).length
          : 0;
      return { grid, count, folders: [], smart: true };
    }
    const members = byGrid.get(grid.name) ?? [];
    return { grid, count: members.length, folders: foldersOf(grid.name, members), smart: false };
  };

  return {
    home: entry(world.home),
    all: { count: world.records.length },
    grids: world.grids.filter((grid) => !isSmartGrid(grid)).map(entry),
    views: world.grids.filter(isSmartGrid).map(entry),
  };
}

/** The rail's width, kept between these so it cannot be dragged to nothing. */
export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 360;
export const SIDEBAR_DEFAULT = 232;

/** A dragged width, clamped. A stored width from a hand-edited file too. */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT;
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)));
}

/**
 * How wide the pane has to be before a rail is worth its room.
 *
 * Below this the wall is a column or two and the rail would be most of it,
 * so it stands aside and the grid menu in the dock does the work. Not a
 * phone check: a narrow pane on a desktop has the same problem.
 */
export const SIDEBAR_MIN_PANE = 720;

/** Whether the rail should be showing at all, given the pane and the setting. */
export function sidebarVisible(paneWidth: number, hidden: boolean): boolean {
  return !hidden && paneWidth >= SIDEBAR_MIN_PANE;
}

/**
 * A row being dragged to a new place in the rail. A grid moves among grids
 * and a view among views, because the rail lists the two apart; a folder
 * moves among its own grid's folders, because moving it to another grid
 * would refile every card in it, which is not what reordering says.
 */
export type RailItem =
  | { kind: "grid"; grid: string }
  | { kind: "view"; grid: string }
  | { kind: "folder"; grid: string; folder: string };

/** The data type a rail row carries while it is dragged. */
export const RAIL_TYPE = "application/x-goko-rail";

/** Whether `moving` can be dropped beside `target`, and is not `target` itself. */
export function canDropBeside(moving: RailItem, target: RailItem): boolean {
  if (moving.kind !== target.kind) return false;
  if (moving.kind === "folder" && target.kind === "folder") {
    return moving.grid === target.grid && moving.folder !== target.folder;
  }
  return moving.grid !== target.grid;
}

/**
 * A list with one item moved to just before or just after another, which is
 * what a drop on the top or the bottom half of a row means. The item keeps
 * its place relative to everything else, so the same call reorders one
 * grid's folders inside the flat list every folder is kept in. Out-of-range
 * indices and a drop on itself leave the order as it was.
 */
export function moveBeside<T>(list: readonly T[], from: number, to: number, after: boolean): T[] {
  const inRange = (i: number): boolean => i >= 0 && i < list.length;
  if (from === to || !inRange(from) || !inRange(to)) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(next.indexOf(list[to]) + (after ? 1 : 0), 0, moved);
  return next;
}
