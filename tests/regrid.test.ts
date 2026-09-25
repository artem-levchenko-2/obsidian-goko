import { describe, expect, it } from "vitest";
import {
  demotedFolder,
  demotionRefusal,
  insertBeside,
  promotedGrid,
  promotionRefusal,
} from "../src/core/regrid";
import type { FolderSpace } from "../src/core/folders";
import type { GridSpace } from "../src/core/spaces";

const craft: GridSpace = { name: "Craft", icon: "hammer", color: "orange" };
const tabletop: GridSpace = { name: "Tabletop", icon: "layout-grid" };
const recent: GridSpace = { name: "Recent", icon: "clock", rules: { tags: ["new"] } };
const leather: FolderSpace = { name: "Leather", icon: "folder", grid: "Craft", width: 1 };

describe("promotionRefusal", () => {
  it("lets a folder become a grid under a name no grid has", () => {
    expect(promotionRefusal(leather, [craft, tabletop], "Inbox")).toBeNull();
  });

  it("refuses a name a grid or the inbox already answers to, whatever its case", () => {
    expect(promotionRefusal({ ...leather, name: "tabletop" }, [craft, tabletop], "Inbox")).toMatch(/already a grid/);
    expect(promotionRefusal({ ...leather, name: "Inbox" }, [craft], "Inbox")).toMatch(/already a grid/);
  });
});

describe("promotedGrid", () => {
  it("looks like the grid it came off, icon and colour", () => {
    expect(promotedGrid(leather, craft)).toEqual({ name: "Leather", icon: "hammer", color: "orange" });
  });

  it("keeps an icon the folder was given on purpose", () => {
    expect(promotedGrid({ ...leather, icon: "gem" }, craft)).toEqual({ name: "Leather", icon: "gem", color: "orange" });
  });

  it("is plain when the grid it came off was", () => {
    expect(promotedGrid({ ...leather, grid: "Tabletop" }, tabletop)).toEqual({ name: "Leather", icon: "layout-grid" });
    expect(promotedGrid({ ...leather, grid: "" }, undefined)).toEqual({ name: "Leather", icon: "layout-grid" });
  });
});

describe("demotionRefusal", () => {
  it("lets a grid with no folders become a folder on another grid", () => {
    expect(demotionRefusal(tabletop, craft, [leather])).toBeNull();
  });

  it("refuses a grid that has folders of its own, and says which", () => {
    const reason = demotionRefusal(craft, tabletop, [leather, { ...leather, name: "Metal" }]);
    expect(reason).toMatch(/Craft has folders of its own \(Leather, Metal\)/);
  });

  it("refuses views, either way round", () => {
    expect(demotionRefusal(recent, craft, [])).toMatch(/is a view/);
    expect(demotionRefusal(tabletop, recent, [])).toMatch(/is a view/);
  });

  it("refuses itself, no target, and a name the target's folders already use", () => {
    expect(demotionRefusal(tabletop, tabletop, [])).toMatch(/on itself/);
    expect(demotionRefusal(tabletop, undefined, [])).toMatch(/pick a grid/);
    expect(
      demotionRefusal(tabletop, craft, [{ ...leather, name: "TABLETOP" }])
    ).toMatch(/already has a folder called Tabletop/);
  });
});

describe("demotedFolder", () => {
  it("takes the grid's own icon, and a folder's when it had none", () => {
    expect(demotedFolder(craft, "Tabletop")).toEqual({ name: "Craft", icon: "hammer", grid: "Tabletop", width: 1 });
    expect(demotedFolder(tabletop, "Craft")).toEqual({ name: "Tabletop", icon: "folder", grid: "Craft", width: 1 });
  });
});

describe("insertBeside", () => {
  it("puts the item before or after the one picked out, or last", () => {
    expect(insertBeside(["a", "b", "c"], "x", (e) => e === "b", false)).toEqual(["a", "x", "b", "c"]);
    expect(insertBeside(["a", "b", "c"], "x", (e) => e === "b", true)).toEqual(["a", "b", "x", "c"]);
    expect(insertBeside(["a", "b"], "x", () => false, true)).toEqual(["a", "b", "x"]);
  });
});
