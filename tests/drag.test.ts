import { describe, expect, it } from "vitest";
import { DRAG_TYPE, dragPayload, dragSet } from "../src/core/drag";

describe("DRAG_TYPE", () => {
  it("is a type nothing else on the wall claims", () => {
    // The wall's own drop target reads text/plain as a URL to clip, so a drag
    // from the wall must not look like one.
    expect(DRAG_TYPE).not.toBe("text/plain");
    expect(DRAG_TYPE).toContain("goko");
  });
});

describe("dragPayload", () => {
  it("carries the paths a line each, which is how the drop reads them", () => {
    expect(dragPayload(["a.md", "b.md"]).split("\n")).toEqual(["a.md", "b.md"]);
    expect(dragPayload([])).toBe("");
  });
});

describe("dragSet", () => {
  it("drags the whole selection when the tile is part of it", () => {
    expect(dragSet("b", ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("drags one card alone when it is not selected, leaving the selection be", () => {
    expect(dragSet("d", ["a", "b"])).toEqual(["d"]);
  });

  it("copies rather than handing out the selection itself", () => {
    const selected = ["a"];
    expect(dragSet("a", selected)).not.toBe(selected);
  });
});
