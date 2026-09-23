import type { FolderSpace } from "./folders";
import type { ClippingRecord } from "./scan";
import type { GridSpace } from "./spaces";
import { HOME_TINT, effectiveGrid, gridTint } from "./spaces";

/**
 * Where a clipping lives, said in one chip.
 *
 * What the chip says depends on where you are standing. In the library a card
 * could be anywhere, so it names the whole path — board and folder. On a
 * board's own wall the board is the heading, and repeating it on every card
 * would be a hundred copies of a word already on screen; what is not implied
 * there is the folder, so that is all the chip says, and a card filed loose
 * gets no chip at all.
 *
 * The same shape and the same corner as the inbox's suggestion, deliberately.
 * The inbox says where a card *could* go and the library says where it *is*;
 * they never appear together, and reading one teaches you the other.
 *
 * Pure, no DOM and no Obsidian: grid.ts draws what this returns.
 */

export interface PlaceChip {
  /** "Payments", or "Payments / Checkout" when it is in a folder. */
  label: string;
  /** The folder's icon when it is in one, otherwise the grid's. */
  icon: string;
  /** The grid's colour as a CSS var: see gridTint, and HOME_TINT for the inbox. */
  color: string;
  /** Whether this card is filed anywhere at all. */
  filed: boolean;
}

/**
 * Which question the chip is answering.
 *
 * "library" — where is this, of everywhere it could be.
 * "grid" — which folder of this board, and nothing when it is in none.
 */
export type PlaceScope = "library" | "grid";

/** The chip for one clipping, or null when there is nothing worth saying. */
export function placeOf(
  record: ClippingRecord,
  grids: readonly GridSpace[],
  folders: readonly FolderSpace[],
  home: GridSpace,
  scope: PlaceScope = "library"
): PlaceChip | null {
  const registered = new Set(grids.map((grid) => grid.name));
  // A card naming a grid that has since been deleted reads as unfiled, which
  // is where the wall itself puts it; the chip must not claim otherwise.
  const name = effectiveGrid(record, home.name, registered);
  const space = name === home.name ? home : grids.find((grid) => grid.name === name);
  const filed = name !== home.name;
  // Drawn plain at home, as the rail draws the inbox: see HOME_TINT.
  const color = filed ? gridTint(space ?? { name }) : HOME_TINT;

  const folder = record.folder.trim();
  const held = folder
    ? folders.find((entry) => entry.name === folder && entry.grid === (filed ? name : ""))
    : undefined;

  if (held) {
    return {
      label: scope === "grid" ? held.name : `${name} / ${held.name}`,
      icon: held.icon || "folder",
      color,
      filed: true,
    };
  }

  // On a board's own wall a card in no folder has nothing the wall does not
  // already say.
  if (scope === "grid") return null;

  return {
    label: name,
    icon: space?.icon || "layout-grid",
    color,
    filed,
  };
}

/** The chip for every clipping that has one, keyed by note path. */
export function placesFor(
  records: readonly ClippingRecord[],
  grids: readonly GridSpace[],
  folders: readonly FolderSpace[],
  home: GridSpace,
  scope: PlaceScope = "library"
): Map<string, PlaceChip> {
  const places = new Map<string, PlaceChip>();
  for (const record of records) {
    const chip = placeOf(record, grids, folders, home, scope);
    if (chip) places.set(record.path, chip);
  }
  return places;
}
