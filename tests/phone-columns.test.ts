import { describe, expect, it } from "vitest";
import { STAGES, columnWidthFor, stageColumns } from "../src/core/density";
import type { DensityStage } from "../src/core/density";
import { columnsForWidth } from "../src/core/layout";

// The gap the wall lays out with (GAP in grid.ts).
const GAP = 6;

const columnsAt = (width: number, phone: boolean) =>
  Object.fromEntries(
    STAGES.map((stage) => [stage, stageColumns(stage, width, GAP, phone).columns])
  ) as Record<DensityStage, number>;

describe("stageColumns on a phone held upright", () => {
  it.each([375, 393, 430])("lays a %i px wall out in 3, 2, 1, 1, 1 columns", (width) => {
    expect(columnsAt(width, true)).toEqual({ xs: 3, s: 2, m: 1, l: 1, xl: 1 });
  });

  it("gives Small two columns where its width alone fits one", () => {
    expect(columnsForWidth(393, columnWidthFor("s"), GAP)).toBe(1);
    expect(stageColumns("s", 393, GAP, true).columns).toBe(2);
  });
});

describe("stageColumns on a phone turned sideways", () => {
  it("treats the count as a minimum, so the wall is as wide as the width fits", () => {
    expect(columnsAt(852, true)).toEqual({ xs: 6, s: 4, m: 2, l: 2, xl: 1 });
    expect(columnsAt(852, true)).toEqual(columnsAt(852, false));
  });
});

describe("stageColumns off a phone", () => {
  it.each([800, 1440])("fits each stage's column width into %i px as before", (width) => {
    for (const stage of STAGES) {
      expect(stageColumns(stage, width, GAP, false)).toEqual({
        columns: columnsForWidth(width, columnWidthFor(stage), GAP),
        unit: columnWidthFor(stage),
      });
    }
  });

  it("keeps the stage's width as the folder unit in a pane narrower than one column", () => {
    expect(stageColumns("m", 250, GAP, false)).toEqual({ columns: 1, unit: 300 });
  });
});

describe("stageColumns folder unit on a phone", () => {
  it("caps the unit at the column a narrow wall leaves", () => {
    expect(stageColumns("l", 393, GAP, true).unit).toBe(393);
    expect(stageColumns("xl", 393, GAP, true).unit).toBe(393);
    expect(stageColumns("s", 393, GAP, true).unit).toBe((393 - GAP) / 2);
  });

  it("keeps the stage's width where the column is at least that wide", () => {
    expect(stageColumns("xs", 393, GAP, true).unit).toBe(120);
    expect(stageColumns("m", 393, GAP, true).unit).toBe(300);
    for (const stage of STAGES) {
      expect(stageColumns(stage, 852, GAP, true).unit).toBe(columnWidthFor(stage));
    }
  });

  it("falls back to the default stage's single column for an unknown stage", () => {
    expect(stageColumns("bogus" as never, 393, GAP, true)).toEqual({ columns: 1, unit: 300 });
  });
});
