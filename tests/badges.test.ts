import { describe, expect, it } from "vitest";
import { MAX_TILE_PILLS, tileBadges, tilePills } from "../src/core/badges";
import type { ClippingRecord } from "../src/core/scan";


function record(over: Partial<ClippingRecord> = {}): ClippingRecord {
  return {
    path: "Clippings/A.md",
    title: "A page",
    source: "https://www.example.com/post/1",
    description: "",
    categories: ["tools", "cli"],
    created: "2026-09-01",
    cover: "",
    grid: "",
    folder: "",
    media: [],
    excerpt: "",
    haystack: "",
    properties: {
      title: ["A page"],
      source: ["https://www.example.com/post/1"],
      categories: ["tools", "cli"],
      status: ["unread"],
      created: ["2026-09-01"],
      author: ["Someone"],
    },
    ...over,
  };
}

describe("tileBadges", () => {
  it("gives a pill per value of the chosen property", () => {
    expect(tileBadges(record(), { property: "categories" })).toEqual([
      { text: "tools \u00b7 cli", values: ["tools", "cli"] },
    ]);
  });

  it("renders source as its domain, a URL being unreadable at pill size", () => {
    expect(tileBadges(record(), { property: "source" })).toEqual([
      { text: "example.com", values: ["example.com"] },
    ]);
  });

  it("skips a property the clipping does not carry", () => {
    expect(tileBadges(record(), { property: "missing" })).toEqual([]);
  });

  it("returns nothing when nothing is chosen", () => {
    expect(tileBadges(record(), { property: "" })).toEqual([]);
  });
});

describe("tilePills", () => {
  it("shows every value when they fit the cap", () => {
    expect(tilePills(["a", "b", "c"])).toEqual({ shown: ["a", "b", "c"], more: 0 });
    expect(tilePills([])).toEqual({ shown: [], more: 0 });
  });

  it("folds the tail past the cap into a count, never a +1", () => {
    expect(tilePills(["a", "b", "c", "d", "e"])).toEqual({ shown: ["a", "b", "c"], more: 2 });
    expect(tilePills(["a", "b", "c", "d"])).toEqual({ shown: ["a", "b", "c", "d"], more: 0 });
    expect(MAX_TILE_PILLS).toBe(3);
  });

  it("does not hand out the array it was given", () => {
    const values = ["a"];
    expect(tilePills(values).shown).not.toBe(values);
  });
});
