import { describe, expect, it } from "vitest";
import { byUpdated } from "../src/core/order";
import type { ClippingRecord } from "../src/core/scan";

function record(title: string, updated: string, created = ""): ClippingRecord {
  return {
    path: `Library/${title}.md`,
    title,
    source: "",
    description: "",
    categories: [],
    created,
    cover: "",
    grid: "",
    folder: "",
    media: [],
    excerpt: "",
    haystack: "",
    properties: updated ? { updated: [updated] } : {},
  };
}

describe("byUpdated", () => {
  it("puts the most recently touched first", () => {
    const out = byUpdated([
      record("old", "2026-09-01"),
      record("new", "2026-09-10"),
      record("mid", "2026-09-05"),
    ]);
    expect(out.map((r) => r.title)).toEqual(["new", "mid", "old"]);
  });

  it("sends a card nothing has ever written to the end", () => {
    // An empty string sorting above real dates would put the whole untouched
    // library in front of the three notes actually being worked on.
    const out = byUpdated([record("untouched", ""), record("touched", "2026-09-01")]);
    expect(out.map((r) => r.title)).toEqual(["touched", "untouched"]);
  });

  it("falls back to created, then to the title, so the order is total", () => {
    const same = "2026-09-10";
    const out = byUpdated([
      record("b", same, "2026-01-01"),
      record("a", same, "2026-01-01"),
      record("c", same, "2026-06-01"),
    ]);
    expect(out.map((r) => r.title)).toEqual(["c", "a", "b"]);
  });

  it("gives the same answer twice, so a repaint does not reorder the wall", () => {
    const records = [record("a", ""), record("b", ""), record("c", "2026-09-01")];
    expect(byUpdated(records).map((r) => r.title)).toEqual(
      byUpdated(records).map((r) => r.title)
    );
  });

  it("does not hand back the array it was given", () => {
    const records = [record("a", "2026-09-01")];
    expect(byUpdated(records)).not.toBe(records);
  });

  it("ignores whitespace around a date, which a hand-edited note can carry", () => {
    const out = byUpdated([record("padded", " 2026-09-10 "), record("plain", "2026-09-01")]);
    expect(out.map((r) => r.title)).toEqual(["padded", "plain"]);
  });
});
