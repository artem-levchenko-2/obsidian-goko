import { describe, expect, it } from "vitest";
import { dropZone, moveBeside, offersInto, railDrop } from "../src/core/sidebar";
import type { RailItem } from "../src/core/sidebar";

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

describe("railDrop", () => {
  const craft: RailItem = { kind: "grid", grid: "Craft" };
  const tabletop: RailItem = { kind: "grid", grid: "Tabletop" };
  const leather: RailItem = { kind: "folder", grid: "Craft", folder: "Leather" };
  const wood: RailItem = { kind: "folder", grid: "Craft", folder: "Wood" };
  const maps: RailItem = { kind: "folder", grid: "Tabletop", folder: "Maps" };
  const recent: RailItem = { kind: "view", grid: "Recent" };
  const videos: RailItem = { kind: "view", grid: "Videos" };

  it("reorders a grid among grids and a view among views on the edges", () => {
    expect(railDrop(craft, tabletop, "after")).toEqual({ kind: "grid-order", grid: "Craft", beside: "Tabletop", after: true });
    expect(railDrop(recent, videos, "before")).toEqual({ kind: "grid-order", grid: "Recent", beside: "Videos", after: false });
  });

  it("reorders a folder among its own grid's folders", () => {
    expect(railDrop(leather, wood, "before")).toEqual({
      kind: "folder-order",
      grid: "Craft",
      folder: "Leather",
      beside: "Wood",
      after: false,
    });
  });

  it("makes a grid dropped on another grid's middle a folder on it", () => {
    expect(railDrop(tabletop, craft, "into")).toEqual({ kind: "demote", grid: "Tabletop", into: "Craft", beside: null, after: true });
  });

  it("makes a grid dropped between another grid's folders a folder there", () => {
    expect(railDrop(tabletop, leather, "after")).toEqual({ kind: "demote", grid: "Tabletop", into: "Craft", beside: "Leather", after: true });
  });

  it("makes a folder dropped between grids a grid there", () => {
    expect(railDrop(leather, tabletop, "before")).toEqual({
      kind: "promote",
      grid: "Craft",
      folder: "Leather",
      beside: "Tabletop",
      after: false,
    });
    expect(railDrop(leather, craft, "after")?.kind).toBe("promote");
  });

  it("moves a folder dropped on another grid's middle to that grid", () => {
    expect(railDrop(leather, tabletop, "into")).toEqual({ kind: "folder-move", grid: "Craft", folder: "Leather", into: "Tabletop" });
    expect(railDrop(leather, craft, "into")).toBeNull();
  });

  it("does nothing across views, onto itself, or between two grids' folders", () => {
    expect(railDrop(craft, videos, "after")).toBeNull();
    expect(railDrop(recent, craft, "into")).toBeNull();
    expect(railDrop(craft, craft, "into")).toBeNull();
    expect(railDrop(craft, leather, "after")).toBeNull();
    expect(railDrop(leather, leather, "after")).toBeNull();
    expect(railDrop(leather, maps, "after")).toBeNull();
  });
});

describe("dropZone", () => {
  it("splits a row in halves when only its edges take a drop", () => {
    expect(dropZone(5, 40, false)).toBe("before");
    expect(dropZone(25, 40, false)).toBe("after");
  });

  it("gives the middle half to the row itself when it can take one", () => {
    expect(dropZone(5, 40, true)).toBe("before");
    expect(dropZone(20, 40, true)).toBe("into");
    expect(dropZone(35, 40, true)).toBe("after");
  });

  it("offers the middle only on another grid's row, and never to a view", () => {
    expect(offersInto({ kind: "grid", grid: "A" }, { kind: "grid", grid: "B" })).toBe(true);
    expect(offersInto({ kind: "folder", grid: "A", folder: "F" }, { kind: "grid", grid: "B" })).toBe(true);
    expect(offersInto({ kind: "folder", grid: "A", folder: "F" }, { kind: "grid", grid: "A" })).toBe(false);
    expect(offersInto({ kind: "view", grid: "V" }, { kind: "grid", grid: "B" })).toBe(false);
    expect(offersInto({ kind: "grid", grid: "A" }, { kind: "folder", grid: "B", folder: "F" })).toBe(false);
  });
});
