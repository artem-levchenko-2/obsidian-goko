/**
 * How densely the wall is packed: a handful of named stages, each a target
 * column width the layout tries to fit. The smaller the column, the more of
 * the wall fits on screen at once, which is what a pane docked in a sidebar
 * needs.
 *
 * This is deliberately not the camera zoom. Zooming leaves the columns where
 * they are and scales the picture, so zooming out only reveals empty space
 * either side of the wall; a stage reflows it into more, narrower columns.
 *
 * A phone is the exception: there a stage is also a number of columns (see
 * stageColumns), because a width means too little on a screen that narrow.
 *
 * Pure: no Obsidian imports, so it tests.
 */

import { columnsForWidth } from "./layout";

export type DensityStage = "xs" | "s" | "m" | "l" | "xl";

/** Narrowest first. Order is what shrink and expand step along. */
export const STAGES: readonly DensityStage[] = ["xs", "s", "m", "l", "xl"];

/** The width the wall had before there were stages. */
export const DEFAULT_STAGE: DensityStage = "m";

const COLUMN_WIDTH: Record<DensityStage, number> = {
  xs: 120,
  s: 200,
  m: 300,
  l: 420,
  xl: 600,
};

/**
 * The fewest columns each stage lays a phone's wall out in.
 *
 * A phone held upright gives the wall 360 to 430 px, and against that the
 * widths above collapse: Small fits one 200 px column just as Medium does,
 * and Tiny two or three depending on the model, so five stages read as
 * three. Counting columns instead makes each of the narrow stages a wall of
 * its own on every phone.
 */
const PHONE_COLUMNS: Record<DensityStage, number> = {
  xs: 3,
  s: 2,
  m: 1,
  l: 1,
  xl: 1,
};

const LABEL: Record<DensityStage, string> = {
  xs: "Tiny",
  s: "Small",
  m: "Medium",
  l: "Large",
  xl: "Huge",
};

export function isStage(value: unknown): value is DensityStage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

/** Target column width in pixels. An unknown stage gets the default, so a
    stale or hand-edited setting degrades to today's wall rather than to
    nothing. */
export function columnWidthFor(stage: DensityStage): number {
  return COLUMN_WIDTH[stage] ?? COLUMN_WIDTH[DEFAULT_STAGE];
}

export interface StageColumns {
  /** How many columns the wall is laid out in. */
  columns: number;
  /**
   * The column width a folder card's height is measured off. It is the
   * stage's width rather than the measured column, because the measured
   * column stretches to fill the pane and a folder that followed it was half
   * again as tall in a narrow pane or on a phone as on a full screen.
   */
  unit: number;
}

/**
 * How a stage lays out a wall `wallWidth` across.
 *
 * Off a phone that is the stage's column width, fitted as many times as it
 * goes. On a phone the stage's count is a minimum, not an exact number: held
 * upright the width never fits more than the count, so the count is what
 * decides, but turned sideways the same count would stretch Medium into one
 * column as wide as the screen where the width fits two. Taking the larger
 * keeps a turned phone the wall it was before counts existed.
 *
 * A phone's folder unit is also capped at the column the card actually
 * gets. Upright, Large and Huge have one column well under their width, and
 * a folder measured off 420 or 600 px there came out about twice as tall as
 * the card is wide; Small's two columns, and Tiny's three on a narrow phone,
 * fall a few pixels short. Wherever the column is at least the stage's
 * width, as Medium's is upright and every stage's is sideways, the cap
 * changes nothing and the folder is the height it is on a desktop.
 */
export function stageColumns(
  stage: DensityStage,
  wallWidth: number,
  gap: number,
  phone: boolean
): StageColumns {
  const width = columnWidthFor(stage);
  const fitted = columnsForWidth(wallWidth, width, gap);
  if (!phone) return { columns: fitted, unit: width };
  const columns = Math.max(PHONE_COLUMNS[stage] ?? 1, fitted);
  const column = (wallWidth - gap * (columns - 1)) / columns;
  return { columns, unit: Math.min(width, column) };
}

export function stageLabel(stage: DensityStage): string {
  return LABEL[stage] ?? LABEL[DEFAULT_STAGE];
}

/** One stage narrower, or the same stage at the narrow end. */
export function shrinkStage(stage: DensityStage): DensityStage {
  const index = STAGES.indexOf(stage);
  return STAGES[Math.max(0, index - 1)] ?? DEFAULT_STAGE;
}

/** One stage wider, or the same stage at the wide end. */
export function expandStage(stage: DensityStage): DensityStage {
  const index = STAGES.indexOf(stage);
  return STAGES[Math.min(STAGES.length - 1, index + 1)] ?? DEFAULT_STAGE;
}
