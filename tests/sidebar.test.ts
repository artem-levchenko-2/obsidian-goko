import { describe, expect, it } from "vitest";
import {
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  clampSidebarWidth,
  sidebarModel,
  sidebarVisible,
} from "../src/core/sidebar";
import type { FacetDef } from "../src/core/filter";
import type { FolderSpace } from "../src/core/folders";
import type { ClippingRecord } from "../src/core/scan";
import type { GridSpace } from "../src/core/spaces";
import type { TileModel } from "../src/core/tile";

const HOME: GridSpace = { name: "Inbox", icon: "layout-grid" };

function record(over: Partial<ClippingRecord> = {}): ClippingRecord {
  return {
    path: `Library/${over.title ?? "a"}.md`,
    title: "a",
    source: "",
    description: "",
    categories: [],
    created: "",
    cover: "",
    grid: "",
    folder: "",
    media: [],
    excerpt: "",
    haystack: "",
    properties: {},
    ...over,
  };
}

function folder(name: string, grid: string): FolderSpace {
  return { name, grid, icon: "folder", width: 1 };
}

describe("sidebarModel", () => {
  it("counts home as everything filed nowhere", () => {
    const model = sidebarModel({
      records: [record(), record(), record({ grid: "Payments" })],
      grids: [{ name: "Payments", icon: "credit-card" }],
      folders: [],
      home: HOME,
    });
    expect(model.home.count).toBe(2);
    expect(model.grids[0].count).toBe(1);
  });

  it("counts a card whose grid no longer exists at home, as the wall paints it", () => {
    const model = sidebarModel({
      records: [record({ grid: "Deleted" })],
      grids: [{ name: "Payments", icon: "credit-card" }],
      folders: [],
      home: HOME,
    });
    expect(model.home.count).toBe(1);
    expect(model.grids[0].count).toBe(0);
  });

  it("lists a grid's folders under it, counted", () => {
    const model = sidebarModel({
      records: [
        record({ grid: "Payments", folder: "Checkout" }),
        record({ grid: "Payments", folder: "Checkout" }),
        record({ grid: "Payments" }),
      ],
      grids: [{ name: "Payments", icon: "credit-card" }],
      folders: [folder("Checkout", "Payments"), folder("Wallets", "Payments")],
      home: HOME,
    });
    expect(model.grids[0].count).toBe(3);
    expect(model.grids[0].folders.map((f) => [f.folder.name, f.count])).toEqual([
      ["Checkout", 2],
      ["Wallets", 0],
    ]);
  });

  it("reads a folder on home by the empty key the notes carry", () => {
    const model = sidebarModel({
      records: [record({ folder: "Later" })],
      grids: [],
      folders: [folder("Later", "")],
      home: HOME,
    });
    expect(model.home.folders).toEqual([{ folder: folder("Later", ""), count: 1 }]);
  });

  it("keeps views apart from grids, and gives them no folders", () => {
    const model = sidebarModel({
      records: [record()],
      grids: [
        { name: "Payments", icon: "credit-card" },
        { name: "Unread", icon: "eye", rules: { status: ["unread"] } },
      ],
      folders: [folder("Checkout", "Unread")],
      home: HOME,
    });
    expect(model.grids.map((g) => g.grid.name)).toEqual(["Payments"]);
    expect(model.views.map((g) => g.grid.name)).toEqual(["Unread"]);
    expect(model.views[0].smart).toBe(true);
    expect(model.views[0].folders).toEqual([]);
  });

  it("counts a view by running its rules over the tiles it is given", () => {
    const defs: FacetDef[] = [
      {
        id: "status",
        label: "Status",
        icon: "circle",
        keywords: "",
        source: "property",
        key: "status",
      },
    ];
    const tile = (status: string): TileModel =>
      ({ record: record({ properties: { status: [status] } }) }) as TileModel;
    const model = sidebarModel({
      records: [],
      grids: [{ name: "Unread", icon: "eye", rules: { status: ["unread"] } }],
      folders: [],
      home: HOME,
      tiles: [tile("unread"), tile("unread"), tile("read")],
      defs,
    });
    expect(model.views[0].count).toBe(2);
  });

  it("leaves a view's count at zero rather than guessing when given no tiles", () => {
    const model = sidebarModel({
      records: [record()],
      grids: [{ name: "Unread", icon: "eye", rules: { status: ["unread"] } }],
      folders: [],
      home: HOME,
    });
    expect(model.views[0].count).toBe(0);
  });
});

describe("sidebarModel: the library row", () => {
  it("counts every clipping, filed or not", () => {
    const model = sidebarModel({
      records: [record(), record({ grid: "Payments" }), record({ grid: "Deleted" })],
      grids: [{ name: "Payments", icon: "credit-card" }],
      folders: [],
      home: HOME,
    });
    expect(model.all.count).toBe(3);
    // The inbox is the unfiled ones, which is now a different question.
    expect(model.home.count).toBe(2);
  });
});

describe("clampSidebarWidth", () => {
  it("keeps a width inside the range", () => {
    expect(clampSidebarWidth(240)).toBe(240);
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_MIN);
    expect(clampSidebarWidth(9000)).toBe(SIDEBAR_MAX);
  });

  it("falls back for a width that is not a number", () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_DEFAULT);
  });

  it("rounds, since half a pixel of rail is a seam", () => {
    expect(clampSidebarWidth(240.6)).toBe(241);
  });
});

describe("sidebarVisible", () => {
  it("stands aside on a narrow pane however the setting reads", () => {
    expect(sidebarVisible(1200, false)).toBe(true);
    expect(sidebarVisible(1200, true)).toBe(false);
    expect(sidebarVisible(500, false)).toBe(false);
  });
});
