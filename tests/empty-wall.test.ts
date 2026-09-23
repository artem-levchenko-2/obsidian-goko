import { describe, expect, it } from "vitest";
import { EMPTY_WALL_EYES_PATH, EMPTY_WALL_EYES_VIEWBOX, emptyWallCopy } from "../src/core/empty-wall";

describe("emptyWallCopy", () => {
  it("says the same first line on every device", () => {
    expect(emptyWallCopy(false).title).toBe("Nothing here yet");
    expect(emptyWallCopy(true).title).toBe("Nothing here yet");
  });

  it("names paste and drop on a desktop", () => {
    expect(emptyWallCopy(false).hint).toBe("Paste a link or drop a file to clip it");
  });

  it("names the share sheet on a phone, where there is nothing to paste into", () => {
    expect(emptyWallCopy(true).hint).toBe("Share a link from another app to clip it");
  });

  it("writes each line as a label rather than a sentence", () => {
    for (const mobile of [false, true]) {
      const { title, hint } = emptyWallCopy(mobile);
      expect(title.endsWith(".")).toBe(false);
      expect(hint.endsWith(".")).toBe(false);
    }
  });
});

describe("the empty wall's eyes", () => {
  it("are one path on the design file's 60 square", () => {
    expect(EMPTY_WALL_EYES_VIEWBOX).toBe("0 0 60 60");
    // Three shapes: an outline for both eyes, and a pupil in each.
    expect(EMPTY_WALL_EYES_PATH.match(/M/g)).toHaveLength(3);
    expect(EMPTY_WALL_EYES_PATH.endsWith("Z")).toBe(true);
  });

  it("stay inside the square they are drawn on", () => {
    const numbers = (EMPTY_WALL_EYES_PATH.match(/\d+(\.\d+)?/g) ?? []).map(Number);
    expect(numbers.length).toBeGreaterThan(0);
    for (const n of numbers) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(60);
    }
  });
});
