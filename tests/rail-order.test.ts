import { describe, expect, it } from "vitest";
import { canDropBeside, moveBeside } from "../src/core/sidebar";

describe("moveBeside", () => {
  const list = ["a", "b", "c", "d"];

  it("drops before a row further down", () => {
    expect(moveBeside(list, 0, 2, false)).toEqual(["b", "a", "c", "d"]);
  });

  it("drops after a row further down", () => {
    expect(moveBeside(list, 0, 2, true)).toEqual(["b", "c", "a", "d"]);
  });

  it("drops before and after a row further up", () => {
    expect(moveBeside(list, 3, 1, false)).toEqual(["a", "d", "b", "c"]);
    expect(moveBeside(list, 3, 1, true)).toEqual(["a", "b", "d", "c"]);
  });

  it("goes to either end", () => {
    expect(moveBeside(list, 2, 0, false)).toEqual(["c", "a", "b", "d"]);
    expect(moveBeside(list, 1, 3, true)).toEqual(["a", "c", "d", "b"]);
  });

  it("leaves the order alone on itself or out of range", () => {
    expect(moveBeside(list, 1, 1, true)).toEqual(list);
    expect(moveBeside(list, -1, 2, true)).toEqual(list);
    expect(moveBeside(list, 0, 9, false)).toEqual(list);
  });

  it("reorders one grid's folders without disturbing another's", () => {
    const folders = [
      { grid: "Craft", name: "Leather" },
      { grid: "Tabletop", name: "Maps" },
      { grid: "Craft", name: "Wood" },
      { grid: "Craft", name: "Metal" },
    ];
    const next = moveBeside(folders, 3, 0, false);
    expect(next.filter((f) => f.grid === "Craft").map((f) => f.name)).toEqual(["Metal", "Leather", "Wood"]);
    expect(next.filter((f) => f.grid === "Tabletop").map((f) => f.name)).toEqual(["Maps"]);
  });
});

describe("canDropBeside", () => {
  it("moves a grid among grids and a view among views", () => {
    expect(canDropBeside({ kind: "grid", grid: "Craft" }, { kind: "grid", grid: "Tabletop" })).toBe(true);
    expect(canDropBeside({ kind: "view", grid: "Recent" }, { kind: "view", grid: "Videos" })).toBe(true);
    expect(canDropBeside({ kind: "grid", grid: "Craft" }, { kind: "view", grid: "Videos" })).toBe(false);
  });

  it("keeps a folder inside its own grid", () => {
    const leather = { kind: "folder" as const, grid: "Craft", folder: "Leather" };
    expect(canDropBeside(leather, { kind: "folder", grid: "Craft", folder: "Wood" })).toBe(true);
    expect(canDropBeside(leather, { kind: "folder", grid: "Tabletop", folder: "Maps" })).toBe(false);
    expect(canDropBeside(leather, { kind: "grid", grid: "Craft" })).toBe(false);
  });

  it("does nothing for a row dropped on itself", () => {
    expect(canDropBeside({ kind: "grid", grid: "Craft" }, { kind: "grid", grid: "Craft" })).toBe(false);
    const leather = { kind: "folder" as const, grid: "Craft", folder: "Leather" };
    expect(canDropBeside(leather, { ...leather })).toBe(false);
  });
});
