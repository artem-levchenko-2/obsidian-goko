/**
 * The wall in sections: a heading, the cards under it, then the next one.
 *
 * The wall is flat everywhere else, and deliberately: a reference library is
 * a surface you sweep your eye across, and headings cut it into pieces. This
 * is the one mode where they earn their room, because the heading is the
 * proposal — "these seven go to Payments" — and a proposal you cannot see
 * the boundary of is not one you can correct.
 *
 * An island can hold pockets: a folder on the grid is a place inside a place,
 * and cards proposed for one are shown in a nested band at the foot of the
 * island, under the folder's own small heading. The pocket is inset once more
 * than the island's loose cards, so the nesting is visible without a line
 * having to say it.
 *
 * Built on computeLayout rather than beside it: each island, and each pocket,
 * is a masonry of its own, shifted down by what came before, so a card is the
 * same size and in the same column it would be on the flat wall.
 *
 * Pure: grid.ts draws the positions, the headings and the bands under them.
 */

import { computeLayout } from "./layout";
import type { LayoutItem, Position } from "./layout";

/** A folder on the island's grid, with the cards proposed or marked for it. */
export interface IslandPocket {
  key: string;
  items: LayoutItem[];
}

export interface IslandGroup {
  /** The grid this island files into. "" is the island nothing spoke for. */
  key: string;
  /** Cards for the grid itself, in no folder. */
  items: LayoutItem[];
  /**
   * Folded to its heading alone. An island you have agreed to is finished
   * business, and finished business folds away so the wall shrinks to what
   * is still waiting for a decision.
   */
  collapsed?: boolean;
  pockets?: IslandPocket[];
}

export interface PocketHeader {
  key: string;
  y: number;
  height: number;
  count: number;
  /** The pocket's lowest edge: its last row plus the inner padding. */
  bottom: number;
}

export interface IslandHeader {
  key: string;
  /** Where the heading sits, in content units. */
  y: number;
  height: number;
  /** Every card in the island, loose and pocketed. */
  count: number;
  /** Where the island ends: the bottom edge of its lowest card or pocket, or
      of the heading when it is folded. The band behind an island runs to here. */
  bottom: number;
  collapsed: boolean;
  pockets: PocketHeader[];
}

export interface IslandsResult {
  positions: Position[];
  headers: IslandHeader[];
  totalHeight: number;
}

/**
 * Room between the last card of one island and the next island's heading,
 * in gaps.
 *
 * Larger than the gap between cards, and by enough to read as a boundary
 * rather than as a wider gutter: the whole job of this layout is to make the
 * groups obvious at a glance.
 */
export const ISLAND_GAP = 3;

function pocketCount(group: IslandGroup): number {
  return (group.pockets ?? []).reduce((sum, pocket) => sum + pocket.items.length, 0);
}

/**
 * Positions for every card and every heading, top to bottom in the order the
 * groups were given.
 *
 * An empty group is skipped rather than given a heading with nothing under
 * it: an island exists because cards are in it, and a heading over bare wall
 * reads as something having gone missing. A folded group is the exception —
 * its cards are there, just not shown — so it keeps its heading and its
 * count, and takes up no more than that. A folded group with nothing in it
 * is a heading alone: the caller's way of offering a place to drop cards.
 *
 * `inset` is the room between the cards and the band drawn behind them, on
 * the left, the right and the bottom. Cards that touched the band's edge read
 * as pressed against a wall. A pocket sits one inset further in.
 */
export function computeIslands(
  groups: readonly IslandGroup[],
  containerWidth: number,
  columns: number,
  gap: number,
  headerHeight: number,
  inset = 0,
  pocketHeaderHeight = headerHeight
): IslandsResult {
  const positions: Position[] = [];
  const headers: IslandHeader[] = [];
  let cursor = 0;

  for (const group of groups) {
    const total = group.items.length + pocketCount(group);
    if (total === 0 && !group.collapsed) continue;

    const y = cursor;
    cursor += headerHeight;

    if (group.collapsed) {
      headers.push({
        key: group.key,
        y,
        height: headerHeight,
        count: total,
        bottom: cursor,
        collapsed: true,
        pockets: [],
      });
      cursor += gap * ISLAND_GAP;
      continue;
    }

    if (group.items.length > 0) {
      const laid = computeLayout(group.items, containerWidth - inset * 2, columns, gap);
      for (const position of laid.positions) {
        positions.push({ ...position, x: position.x + inset, y: position.y + cursor });
      }
      cursor += laid.totalHeight + inset;
    }

    const pockets: PocketHeader[] = [];
    for (const pocket of group.pockets ?? []) {
      if (pocket.items.length === 0) continue;
      const py = cursor;
      cursor += pocketHeaderHeight;
      const laid = computeLayout(pocket.items, containerWidth - inset * 4, columns, gap);
      for (const position of laid.positions) {
        positions.push({ ...position, x: position.x + inset * 2, y: position.y + cursor });
      }
      cursor += laid.totalHeight + inset;
      pockets.push({
        key: pocket.key,
        y: py,
        height: pocketHeaderHeight,
        count: pocket.items.length,
        bottom: cursor,
      });
      // Room after the pocket, so its band stands clear of the island's edge
      // and of the next pocket's heading.
      cursor += inset;
    }

    headers.push({
      key: group.key,
      y,
      height: headerHeight,
      count: total,
      bottom: cursor,
      collapsed: false,
      pockets,
    });
    cursor += gap * ISLAND_GAP;
  }

  // The trailing island gap is not part of the wall: it would leave a screen
  // of nothing under the last card at full scroll.
  const totalHeight = headers.length > 0 ? Math.max(0, cursor - gap * ISLAND_GAP) : 0;
  return { positions, headers, totalHeight };
}

/** What a point on the wall is over: an island, and a pocket in it or not. */
export interface IslandHit {
  island: IslandHeader;
  pocket: PocketHeader | null;
}

/**
 * Which island a point on the wall is over, or null for none.
 *
 * An island claims everything from its heading down to the next heading,
 * gap included, so a card dropped just under the last row still lands. Past
 * the last island's own bottom edge and a little slack there is nothing to
 * drop on, and the answer says so rather than guessing the nearest. Within
 * an island a pocket claims its heading and its cards; the room around it
 * belongs to the island's loose cards.
 */
export function islandAt(
  headers: readonly IslandHeader[],
  y: number,
  slack: number
): IslandHit | null {
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    const next = headers[i + 1];
    if (y < header.y) {
      // Above this island: only the first one has slack above it, since the
      // room above any other belongs to the island before it.
      return i === 0 && y >= header.y - slack ? { island: header, pocket: null } : null;
    }
    const inside = next ? y < next.y : y <= header.bottom + slack;
    if (!inside) continue;
    const pocket = header.pockets.find((p) => y >= p.y && y < p.bottom) ?? null;
    return { island: header, pocket };
  }
  return null;
}
