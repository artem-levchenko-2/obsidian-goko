import { describe, expect, it } from "vitest";
import {
  chipLabel,
  parseQuery,
  suggestNarrow,
  tokenFor,
  withinNarrow,
} from "../src/core/palette-query";
import type { NarrowTarget } from "../src/core/palette-query";
import type { ClippingRecord } from "../src/core/scan";

function record(over: Partial<ClippingRecord> = {}): ClippingRecord {
  return {
    path: "Library/a.md",
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

const WORLD = {
  homeGrid: "Inbox",
  registered: new Set(["Payments", "Posters"]),
  tagProperties: ["categories", "tags"],
};

describe("parseQuery", () => {
  it("is the text itself when nothing is tokenised", () => {
    expect(parseQuery("dark checkout")).toEqual({
      terms: "dark checkout",
      narrow: [],
      typing: null,
    });
  });

  it("takes a settled token out of the terms and makes it a chip", () => {
    expect(parseQuery("@Payments checkout")).toEqual({
      terms: "checkout",
      narrow: [{ kind: "grid", value: "Payments" }],
      typing: null,
    });
  });

  it("reads a slash as a folder on a grid", () => {
    const { narrow } = parseQuery("@Payments/Checkout form");
    expect(narrow).toEqual([{ kind: "folder", grid: "Payments", value: "Checkout" }]);
  });

  it("reads a hash as a tag", () => {
    const { narrow, terms } = parseQuery("#typography posters");
    expect(narrow).toEqual([{ kind: "tag", value: "typography" }]);
    expect(terms).toBe("posters");
  });

  it("keeps several chips, in the order they were written", () => {
    const { narrow, terms } = parseQuery("@Payments #dark form");
    expect(narrow.map((c) => c.value)).toEqual(["Payments", "dark"]);
    expect(terms).toBe("form");
  });

  it("treats a token at the end of the field as one still being typed", () => {
    expect(parseQuery("form @Pay")).toEqual({
      terms: "form",
      narrow: [],
      typing: { sigil: "@", prefix: "Pay" },
    });
    expect(parseQuery("@")).toEqual({ terms: "", narrow: [], typing: { sigil: "@", prefix: "" } });
  });

  it("settles a token once a space follows it", () => {
    expect(parseQuery("@Pay ").narrow).toEqual([{ kind: "grid", value: "Pay" }]);
    expect(parseQuery("@Pay ").typing).toBeNull();
  });

  it("leaves a sigil inside a word alone, so an address is not a grid", () => {
    expect(parseQuery("name@example.com").narrow).toEqual([]);
    expect(parseQuery("name@example.com").terms).toBe("name@example.com");
    expect(parseQuery("colour #1a2b3c").typing).toEqual({ sigil: "#", prefix: "1a2b3c" });
  });

  it("tidies the whitespace a removed token leaves behind", () => {
    expect(parseQuery("dark  @Payments   form").terms).toBe("dark form");
  });
});

describe("tokenFor and chipLabel", () => {
  it("writes a chip back into text that parses to the same chip", () => {
    for (const chip of [
      { kind: "grid" as const, value: "Payments" },
      { kind: "tag" as const, value: "dark" },
      { kind: "folder" as const, grid: "Payments", value: "Checkout" },
    ]) {
      expect(parseQuery(`${tokenFor(chip)} x`).narrow[0]).toEqual(chip);
    }
  });

  it("reads a folder chip as its grid and its name", () => {
    expect(chipLabel({ kind: "folder", grid: "Payments", value: "Checkout" })).toBe(
      "Payments / Checkout"
    );
    expect(chipLabel({ kind: "grid", value: "Payments" })).toBe("Payments");
  });
});

describe("suggestNarrow", () => {
  const targets: NarrowTarget[] = [
    { kind: "grid", value: "Payments", label: "Payments" },
    { kind: "grid", value: "Pattern library", label: "Pattern library" },
    { kind: "folder", value: "Checkout", grid: "Payments", label: "Payments / Checkout" },
    { kind: "grid", value: "Posters", label: "Posters" },
  ];

  it("offers everything for a bare sigil", () => {
    expect(suggestNarrow("", targets)).toHaveLength(4);
  });

  it("puts a prefix before a mere contains", () => {
    const out = suggestNarrow("pa", targets).map((t) => t.value);
    expect(out.slice(0, 2)).toEqual(["Payments", "Pattern library"]);
  });

  it("prefers the shorter name when both start the same", () => {
    const out = suggestNarrow("p", targets).map((t) => t.value);
    expect(out[0]).toBe("Posters");
  });

  it("ignores case, because nobody capitalises a search", () => {
    expect(suggestNarrow("CHECK", targets).map((t) => t.value)).toEqual(["Checkout"]);
  });

  it("caps the list", () => {
    expect(suggestNarrow("", targets, 2)).toHaveLength(2);
  });
});

describe("withinNarrow", () => {
  it("is true for a clipping with no chips to answer to", () => {
    expect(withinNarrow(record(), [], WORLD)).toBe(true);
  });

  it("matches a grid chip against where the card actually resolves", () => {
    expect(withinNarrow(record({ grid: "Payments" }), [{ kind: "grid", value: "Payments" }], WORLD)).toBe(true);
    expect(withinNarrow(record(), [{ kind: "grid", value: "Inbox" }], WORLD)).toBe(true);
  });

  it("does not let a card fall back into a chip's grid", () => {
    // Its key names a grid that no longer exists, so the wall shows it at
    // home — and a chip naming that grid should find nothing.
    expect(withinNarrow(record({ grid: "Deleted" }), [{ kind: "grid", value: "Deleted" }], WORLD)).toBe(
      false
    );
  });

  it("matches a folder chip, and the grid it names when it names one", () => {
    const card = record({ grid: "Payments", folder: "Checkout" });
    expect(withinNarrow(card, [{ kind: "folder", value: "Checkout" }], WORLD)).toBe(true);
    expect(
      withinNarrow(card, [{ kind: "folder", grid: "Payments", value: "Checkout" }], WORLD)
    ).toBe(true);
    expect(
      withinNarrow(card, [{ kind: "folder", grid: "Posters", value: "Checkout" }], WORLD)
    ).toBe(false);
  });

  it("matches a tag in any of the properties tags live in", () => {
    const card = record({ properties: { categories: ["dark"], tags: ["clippings"] } });
    expect(withinNarrow(card, [{ kind: "tag", value: "dark" }], WORLD)).toBe(true);
    expect(withinNarrow(card, [{ kind: "tag", value: "clippings" }], WORLD)).toBe(true);
    expect(withinNarrow(card, [{ kind: "tag", value: "light" }], WORLD)).toBe(false);
  });

  it("requires every chip, since two chips are two conditions", () => {
    const card = record({ grid: "Payments", properties: { categories: ["dark"] } });
    expect(
      withinNarrow(
        card,
        [
          { kind: "grid", value: "Payments" },
          { kind: "tag", value: "dark" },
        ],
        WORLD
      )
    ).toBe(true);
    expect(
      withinNarrow(
        card,
        [
          { kind: "grid", value: "Posters" },
          { kind: "tag", value: "dark" },
        ],
        WORLD
      )
    ).toBe(false);
  });
});
