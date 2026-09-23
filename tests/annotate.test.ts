import { describe, expect, it } from "vitest";
import { combineAnnotations, mergeAnnotation, valuesOf } from "../src/core/annotate";
import type { Frontmatter } from "../src/core/annotate";

describe("valuesOf", () => {
  it("reads a list, a string, a number, and nothing", () => {
    expect(valuesOf(["a", "b"])).toEqual(["a", "b"]);
    expect(valuesOf("a")).toEqual(["a"]);
    expect(valuesOf(3)).toEqual(["3"]);
    expect(valuesOf(undefined)).toEqual([]);
    expect(valuesOf(null)).toEqual([]);
    expect(valuesOf({ a: 1 })).toEqual([]);
  });

  it("drops blanks, which the scanner never writes either", () => {
    expect(valuesOf(["a", "", "  ", "b"])).toEqual(["a", "b"]);
    expect(valuesOf("   ")).toEqual([]);
  });
});

describe("mergeAnnotation", () => {
  it("adds a value to a key that had none, as a plain string", () => {
    const fm: Frontmatter = {};
    const out = mergeAnnotation(fm, { category: ["inspiration"] });
    expect(fm.category).toBe("inspiration");
    expect(out).toEqual({ changed: true, written: ["category"], refused: [] });
  });

  it("turns a string into a list when a second value arrives", () => {
    const fm: Frontmatter = { category: "inspiration" };
    mergeAnnotation(fm, { category: ["payments"] });
    expect(fm.category).toEqual(["inspiration", "payments"]);
  });

  it("does not write a value the note already holds", () => {
    const fm: Frontmatter = { category: ["design"] };
    const out = mergeAnnotation(fm, { category: ["design"] });
    expect(fm.category).toEqual(["design"]);
    expect(out.changed).toBe(false);
  });

  it("treats Design and design as the same tag", () => {
    const fm: Frontmatter = { category: ["design"] };
    const out = mergeAnnotation(fm, { category: ["Design", " DESIGN "] });
    expect(fm.category).toEqual(["design"]);
    expect(out.changed).toBe(false);
  });

  it("dedupes within the incoming values too", () => {
    const fm: Frontmatter = {};
    mergeAnnotation(fm, { category: ["ui", "UI", "ui "] });
    expect(fm.category).toBe("ui");
  });

  it("never removes anything", () => {
    const fm: Frontmatter = { category: ["design", "ios"] };
    mergeAnnotation(fm, { category: ["web"] });
    expect(fm.category).toEqual(["design", "ios", "web"]);
  });

  it("refuses the clipper's keys and says so", () => {
    const fm: Frontmatter = { title: "Original" };
    const out = mergeAnnotation(fm, { title: ["Rewritten"], source: ["x"], category: ["ok"] });
    expect(fm.title).toBe("Original");
    expect(fm.source).toBeUndefined();
    expect(fm.category).toBe("ok");
    expect(out.refused).toEqual(["title", "source"]);
    expect(out.written).toEqual(["category"]);
  });

  it("refuses tags unless the policy allows them", () => {
    const fm: Frontmatter = { tags: ["clippings"] };
    expect(mergeAnnotation(fm, { tags: ["ui"] }).refused).toEqual(["tags"]);
    expect(fm.tags).toEqual(["clippings"]);

    const out = mergeAnnotation(fm, { tags: ["ui"] }, { allowEditingTags: true });
    expect(out.written).toEqual(["tags"]);
    expect(fm.tags).toEqual(["clippings", "ui"]);
  });

  it("refuses the plugin's own keys, whatever the policy", () => {
    const fm: Frontmatter = { grid: "Stripe" };
    const out = mergeAnnotation(fm, { grid: ["Other"], cover: ["x.png"] }, { allowEditingTags: true });
    expect(fm.grid).toBe("Stripe");
    expect(out.refused).toEqual(["grid", "cover"]);
  });

  it("replaces prose for a scalar key rather than listing it", () => {
    const fm: Frontmatter = { summary: "An old summary." };
    const out = mergeAnnotation(fm, { summary: ["A new summary."] }, {}, new Set(["summary"]));
    expect(fm.summary).toBe("A new summary.");
    expect(out.written).toEqual(["summary"]);
  });

  it("leaves a scalar alone when the same prose comes again", () => {
    const fm: Frontmatter = { summary: "Same." };
    const out = mergeAnnotation(fm, { summary: ["Same."] }, {}, new Set(["summary"]));
    expect(out.changed).toBe(false);
  });

  it("skips empty values and empty keys without complaint", () => {
    const fm: Frontmatter = {};
    const out = mergeAnnotation(fm, { category: ["", "  "], "": ["x"] });
    expect(fm).toEqual({});
    expect(out.changed).toBe(false);
    expect(out.refused).toEqual([]);
  });

  it("reports changed only when something was written", () => {
    const fm: Frontmatter = { category: "a" };
    expect(mergeAnnotation(fm, { category: ["a"] }).changed).toBe(false);
    expect(mergeAnnotation(fm, { category: ["b"] }).changed).toBe(true);
  });
});

describe("combineAnnotations", () => {
  it("concatenates values for the same key in order", () => {
    expect(combineAnnotations({ a: ["1"] }, { a: ["2"], b: ["x"] })).toEqual({
      a: ["1", "2"],
      b: ["x"],
    });
  });

  it("is fine with nothing", () => {
    expect(combineAnnotations()).toEqual({});
  });
});
