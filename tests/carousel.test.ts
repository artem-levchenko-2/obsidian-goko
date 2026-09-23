import { describe, expect, it } from "vitest";
import {
  indexOfTile,
  reelLabel,
  segmentIndex,
  stepIndex,
  swipeDirection,
} from "../src/core/carousel";
import type { TileModel } from "../src/core/tile";

function tile(signature: string): TileModel {
  return {
    id: "Clippings/A.md",
    record: {} as TileModel["record"],
    posterPath: "",
    filePath: signature,
    remote: false,
    kind: "image",
    animated: false,
    width: 1,
    height: 1,
    provisional: false,
    signature,
  };
}

describe("stepIndex", () => {
  it("walks forward and back", () => {
    expect(stepIndex(0, 4, 1)).toBe(1);
    expect(stepIndex(2, 4, -1)).toBe(1);
  });

  it("wraps at both ends, so holding one arrow never dead-ends", () => {
    expect(stepIndex(3, 4, 1)).toBe(0);
    expect(stepIndex(0, 4, -1)).toBe(3);
  });

  it("keeps a lone picture where it is", () => {
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, 1, -1)).toBe(0);
  });

  it("survives an empty reel rather than returning -1", () => {
    expect(stepIndex(0, 0, 1)).toBe(0);
  });
});

describe("indexOfTile", () => {
  const reel = [tile("a"), tile("b"), tile("c")];

  it("opens on the picture the card was showing", () => {
    expect(indexOfTile(reel, tile("b"))).toBe(1);
  });

  it("opens at the start when the cover is not in the reel", () => {
    expect(indexOfTile(reel, tile("hand-set-cover"))).toBe(0);
  });

  it("opens at the start on an empty reel", () => {
    expect(indexOfTile([], tile("a"))).toBe(0);
  });
});

describe("swipeDirection", () => {
  it("turns the page when the drag is long and sideways", () => {
    expect(swipeDirection(-120, 4)).toBe(1);
    expect(swipeDirection(120, 4)).toBe(-1);
  });

  it("ignores a drag too short to be meant", () => {
    expect(swipeDirection(-20, 0)).toBeNull();
  });

  it("ignores a drag that is mostly vertical, which is a scroll", () => {
    expect(swipeDirection(-60, 200)).toBeNull();
  });

  it("ignores a diagonal, where the reader's intent is not clear", () => {
    expect(swipeDirection(-60, 60)).toBeNull();
  });
});

describe("reelLabel", () => {
  it("counts from one, the way a reader counts", () => {
    expect(reelLabel(0, 4)).toBe("1 / 4");
    expect(reelLabel(3, 4)).toBe("4 / 4");
  });

  it("says nothing when there is nothing to count", () => {
    expect(reelLabel(0, 1)).toBe("");
    expect(reelLabel(0, 0)).toBe("");
  });
});

describe("segmentIndex", () => {
  it("splits the card evenly, one segment per picture", () => {
    expect(segmentIndex(0, 400, 4)).toBe(0);
    expect(segmentIndex(120, 400, 4)).toBe(1);
    expect(segmentIndex(220, 400, 4)).toBe(2);
    expect(segmentIndex(320, 400, 4)).toBe(3);
  });

  it("lands on the last frame at the far edge rather than rolling over", () => {
    expect(segmentIndex(400, 400, 4)).toBe(3);
    expect(segmentIndex(10000, 400, 4)).toBe(3);
  });

  it("clamps a negative offset, which a stale rect can produce", () => {
    expect(segmentIndex(-50, 400, 4)).toBe(0);
  });

  it("stays put for a single picture", () => {
    expect(segmentIndex(380, 400, 1)).toBe(0);
  });

  it("survives a card with no measured width", () => {
    expect(segmentIndex(10, 0, 4)).toBe(0);
  });

  it("holds each frame for an equal share, so the sweep feels even", () => {
    const hits = new Map<number, number>();
    for (let x = 0; x < 400; x++) {
      const i = segmentIndex(x, 400, 4);
      hits.set(i, (hits.get(i) ?? 0) + 1);
    }
    expect([...hits.values()]).toEqual([100, 100, 100, 100]);
  });
});
