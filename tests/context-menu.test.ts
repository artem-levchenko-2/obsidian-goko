import { describe, expect, it } from "vitest";
import { placeAbove, placeMenu } from "../src/core/layout";

const viewport = { width: 1000, height: 800 };
const menu = { width: 260, height: 300 };

describe("placeMenu", () => {
  it("opens down and right from the cursor when there is room", () => {
    expect(placeMenu({ x: 100, y: 100 }, menu, viewport)).toEqual({ x: 100, y: 100 });
  });

  it("flips left rather than running off the right edge", () => {
    expect(placeMenu({ x: 900, y: 100 }, menu, viewport).x).toBe(640);
  });

  it("flips up rather than running off the bottom", () => {
    expect(placeMenu({ x: 100, y: 700 }, menu, viewport).y).toBe(400);
  });

  it("flips both ways in the far corner", () => {
    expect(placeMenu({ x: 980, y: 780 }, menu, viewport)).toEqual({ x: 720, y: 480 });
  });

  it("never leaves the margin, even when flipping would go negative", () => {
    const out = placeMenu({ x: 20, y: 20 }, { width: 900, height: 700 }, viewport);
    expect(out.x).toBeGreaterThanOrEqual(8);
    expect(out.y).toBeGreaterThanOrEqual(8);
  });

  it("stays on screen for a menu taller than the viewport", () => {
    const out = placeMenu({ x: 500, y: 400 }, { width: 200, height: 2000 }, viewport);
    expect(out.y).toBe(8);
  });
});

describe("placeAbove", () => {
  const panel = { width: 320, height: 120 };

  it("centres over the point and rests on it", () => {
    expect(placeAbove({ x: 500, y: 700 }, panel, viewport)).toEqual({ x: 340, y: 580 });
  });

  it("slides back by the overflow at the right edge, not by its width", () => {
    expect(placeAbove({ x: 900, y: 700 }, panel, viewport).x).toBe(672);
  });

  it("slides the other way at the left edge", () => {
    expect(placeAbove({ x: 60, y: 700 }, panel, viewport).x).toBe(8);
  });

  it("stays under the top margin when there is no room above", () => {
    expect(placeAbove({ x: 500, y: 60 }, panel, viewport).y).toBe(8);
  });
});
