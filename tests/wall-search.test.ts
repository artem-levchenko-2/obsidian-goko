import { describe, expect, it } from "vitest";
import { scanClipping } from "../src/core/scan";
import type { ClippingRecord } from "../src/core/scan";
import {
  matchesSearch,
  narrowToHits,
  searchHits,
  searchTerms,
  searchTier,
  searchTiles,
} from "../src/core/wall-search";

/** A clipping as the index would read it, from its frontmatter and body. */
function clip(name: string, frontmatter: Record<string, unknown>, body = ""): ClippingRecord {
  return scanClipping(`Library/${name}.md`, { title: name, ...frontmatter }, body);
}

const words = (query: string): string[] => searchTerms(query).map((term) => term.text);
const finds = (query: string, record: ClippingRecord): boolean =>
  matchesSearch(record, searchTerms(query));

describe("searchTerms", () => {
  it("lowers the case and splits on any run of space", () => {
    expect(words("Red  Boots")).toEqual(["red", "boots"]);
    expect(words("red\tboots\u00a0laces")).toEqual(["red", "boots", "laces"]);
    expect(words("ЧОБОТИ")).toEqual(["чоботи"]);
  });

  it("reads a hash, a hyphen and a comma as a space", () => {
    expect(words("#boots")).toEqual(["boots"]);
    expect(words("#")).toEqual([]);
    expect(words("##xy")).toEqual(["xy"]);
    expect(words("t-shirt, jeans")).toEqual(["shirt", "jeans"]);
  });

  it("drops a single letter, which is only the start of a word being typed", () => {
    expect(words("a")).toEqual([]);
    expect(words("b boots")).toEqual(["boots"]);
    expect(words("##x")).toEqual([]);
  });

  it("keeps a single character of a script that does not space its words", () => {
    expect(searchTerms("猫")).toEqual([{ text: "猫", atWordStart: false }]);
  });

  it("keeps each word once, where it was first typed", () => {
    expect(words("boots red Boots")).toEqual(["boots", "red"]);
  });

  it("asks a word of four letters or fewer to start a word, and a longer one not", () => {
    expect(searchTerms("cat ring boots 4k")).toEqual([
      { text: "cat", atWordStart: true },
      { text: "ring", atWordStart: true },
      { text: "boots", atWordStart: false },
      { text: "4k", atWordStart: true },
    ]);
  });
});

describe("matchesSearch", () => {
  it("wants every word", () => {
    const boots = clip("Red boots", {});
    expect(finds("red boots", boots)).toBe(true);
    expect(finds("red shoes", boots)).toBe(false);
  });

  it("finds a short word at the start of a word, after anything that is not a letter", () => {
    for (const description of ["a cat", "(cat)", "#cat", "cats on a wall"]) {
      expect(finds("cat", clip("Card", { description })), description).toBe(true);
    }
  });

  it("does not find a short word inside a longer one", () => {
    for (const description of ["modification", "scattered", "dedicated"]) {
      expect(finds("cat", clip("Card", { description })), description).toBe(false);
    }
    expect(finds("ring", clip("Card", { description: "wearing a coat" }))).toBe(false);
    expect(finds("кот", clip("Card", { description: "скотина" }))).toBe(false);
    expect(finds("4k", clip("Card", { description: "24k gold" }))).toBe(false);
  });

  it("goes on past a hit inside a word to one that starts a word", () => {
    expect(finds("cat", clip("Card", { description: "scattered cat" }))).toBe(true);
    expect(finds("кот", clip("Card", { description: "скотина і кот" }))).toBe(true);
    expect(finds("4k", clip("Card", { description: "24k gold, 4k video" }))).toBe(true);
  });

  it("finds a longer word inside another, as a hashtag or a compound holds it", () => {
    expect(finds("tattoo", clip("Card", { description: "#darktattoo" }))).toBe(true);
    expect(finds("boots", clip("Card", { description: "ankleboots" }))).toBe(true);
    expect(finds("rings", clip("Card", { description: "silver earrings" }))).toBe(true);
  });

  it("counts a combining mark as part of the word it follows", () => {
    expect(finds("cat", clip("Card", { description: "o\u0308cat" }))).toBe(false);
  });

  it("finds a word of a script with no spaces anywhere in the text", () => {
    expect(finds("猫", clip("黒い猫", {}))).toBe(true);
  });

  it("looks through the body of the note as well as its properties", () => {
    const article = clip("Field notes", {}, "Waxing leather twice a year keeps it supple.");
    expect(finds("leather", article)).toBe(true);
    expect(finds("supple", article)).toBe(true);
  });

  it("never matches the names of the grid and folder a clipping is filed in", () => {
    const filed = scanClipping("Library/Tattoo/Flash sheets/Rose.md", { title: "Rose" }, "petals");
    expect(finds("tattoo", filed)).toBe(false);
    expect(finds("flash", filed)).toBe(false);
    expect(finds("rose", filed)).toBe(true);
  });
});

describe("searchTier", () => {
  const tier = (query: string, record: ClippingRecord): number =>
    searchTier(record, searchTerms(query));

  it("puts the title and the tags first", () => {
    expect(tier("boots", clip("Boots", {}))).toBe(0);
    expect(tier("boots", clip("BOOTS", {}))).toBe(0);
    expect(tier("boots", clip("Card", { categories: ["boots"] }))).toBe(0);
  });

  it("puts what was written about the clipping second", () => {
    expect(tier("boots", clip("Card", { description: "field boots" }))).toBe(1);
    expect(tier("boots", clip("Card", { note: "for the boots project" }))).toBe(1);
    expect(tier("boots", clip("Card", { note: ["first", "second boots"] }))).toBe(1);
    expect(tier("boots", clip("Card", { summary: "A pair of boots" }))).toBe(1);
    expect(tier("boots", clip("Card", { source: "https://www.fieldboots.example/p/1" }))).toBe(1);
  });

  it("puts the text of the clipping last", () => {
    expect(tier("boots", clip("Card", {}, "Resoling boots by hand."))).toBe(2);
  });

  it("holds each field to the start-of-word rule on its own", () => {
    expect(tier("cat", clip("Modification", {}, "a cat asleep"))).toBe(2);
  });

  it("rates several words by the weakest of them", () => {
    const card = clip("Red boots", {}, "Oiled leather.");
    expect(tier("red boots", card)).toBe(0);
    expect(tier("red leather", card)).toBe(2);
  });
});

describe("searchTiles", () => {
  const tile = (record: ClippingRecord): { id: string; record: ClippingRecord } => ({
    id: record.path,
    record,
  });
  const a = tile(clip("A", {}, "boots in the body"));
  const b = tile(clip("B boots", {}));
  const c = tile(clip("C", { description: "boots described" }));
  const d = tile(clip("D boots", {}));
  const e = tile(clip("E", {}, "nothing here"));
  const ids = (tiles: Array<{ id: string }>): string[] => tiles.map((t) => t.id);

  it("drops what does not match and puts the best matches first", () => {
    const found = searchTiles([a, b, c, d, e], searchTerms("boots"));
    expect(ids(found)).toEqual(ids([b, d, c, a]));
  });

  it("keeps the order it was given within a tier", () => {
    expect(ids(searchTiles([d, b], searchTerms("boots")))).toEqual(ids([d, b]));
  });

  it("leaves the list it was given as it was", () => {
    const given = [a, b, c, d, e];
    searchTiles(given, searchTerms("boots"));
    expect(ids(given)).toEqual(ids([a, b, c, d, e]));
  });

  it("returns everything for a query with no words in it", () => {
    expect(ids(searchTiles([a, e], searchTerms("  # ")))).toEqual(ids([a, e]));
  });

  it("keeps each hit's tier by path, for a wall to narrow its own tiles by", () => {
    const hits = searchHits([a.record, b.record, e.record], searchTerms("boots"));
    expect([...hits.entries()]).toEqual([
      [a.id, 2],
      [b.id, 0],
    ]);
    expect(ids(narrowToHits([e, a, b], hits))).toEqual(ids([b, a]));
  });

  it("can find more with a letter added, so a result is never narrowed from the last", () => {
    const earrings = tile(clip("Card", { description: "silver earrings" }));
    expect(searchTiles([earrings], searchTerms("ring"))).toHaveLength(0);
    expect(searchTiles([earrings], searchTerms("rings"))).toHaveLength(1);
  });
});
