import { describe, expect, it } from "vitest";
import {
  COVER_BAND_MIN,
  coverBand,
  coverDropTarget,
  isCoverType,
  offersCover,
} from "../src/core/cover-drop";
import { DRAG_TYPE } from "../src/core/drag";

// A card somewhere off the origin, so a test that forgot the offset fails.
const card = (height: number, width = 200) => ({ left: 40, top: 100, width, height });
const at = (x: number, y: number) => ({ x, y });

describe("coverBand", () => {
  it("is the lower third of a tall card", () => {
    expect(coverBand(card(300))).toEqual({ left: 40, top: 300, width: 200, height: 100 });
  });

  it("is a fingertip tall on a card whose third would be less", () => {
    const band = coverBand(card(90));
    expect(band.height).toBe(COVER_BAND_MIN);
    expect(band.top + band.height).toBe(190);
  });

  it("is exactly the minimum on the card whose third is the minimum", () => {
    expect(coverBand(card(COVER_BAND_MIN * 3)).height).toBe(COVER_BAND_MIN);
  });

  it("never grows past the card it sits on", () => {
    expect(coverBand(card(30))).toEqual({ left: 40, top: 100, width: 200, height: 30 });
  });
});

describe("coverDropTarget", () => {
  // 300 tall from y = 100, so the band runs from 300 to 400.
  const tall = card(300);

  it("sets the cover from a point on the band", () => {
    expect(coverDropTarget(tall, at(140, 350))).toBe("cover");
  });

  it("makes a new clipping from a point above the band", () => {
    expect(coverDropTarget(tall, at(140, 299))).toBe("clip");
    expect(coverDropTarget(tall, at(140, 120))).toBe("clip");
  });

  it("counts the band's own edges as the band", () => {
    expect(coverDropTarget(tall, at(140, 300))).toBe("cover");
    expect(coverDropTarget(tall, at(140, 400))).toBe("cover");
    expect(coverDropTarget(tall, at(40, 350))).toBe("cover");
    expect(coverDropTarget(tall, at(240, 350))).toBe("cover");
  });

  it("leaves a point beside or below the card to the wall", () => {
    expect(coverDropTarget(tall, at(39, 350))).toBe("clip");
    expect(coverDropTarget(tall, at(241, 350))).toBe("clip");
    expect(coverDropTarget(tall, at(140, 401))).toBe("clip");
  });

  it("gives a short card a band of the minimum height, not a third", () => {
    // 120 tall: a third would be 40, the band is 44, from 176 to 220.
    const short = card(120);
    expect(coverDropTarget(short, at(140, 178))).toBe("cover");
    expect(coverDropTarget(short, at(140, 176))).toBe("cover");
    expect(coverDropTarget(short, at(140, 175))).toBe("clip");
  });

  it("gives a card shorter than a fingertip over to the band entirely", () => {
    const tiny = card(30);
    expect(coverDropTarget(tiny, at(140, 100))).toBe("cover");
    expect(coverDropTarget(tiny, at(140, 130))).toBe("cover");
  });

  it("takes nothing on a card with no size, which is one not laid out yet", () => {
    expect(coverDropTarget(card(0), at(40, 100))).toBe("clip");
    expect(coverDropTarget(card(300, 0), at(40, 350))).toBe("clip");
  });
});

describe("isCoverType", () => {
  it("takes a picture or a video, whatever the case and parameters", () => {
    expect(isCoverType("image/png")).toBe(true);
    expect(isCoverType("video/mp4")).toBe(true);
    expect(isCoverType("IMAGE/JPEG; q=0.9")).toBe(true);
  });

  it("refuses a document, a note and a file of no stated type", () => {
    expect(isCoverType("application/pdf")).toBe(false);
    expect(isCoverType("text/markdown")).toBe(false);
    expect(isCoverType("")).toBe(false);
  });
});

describe("offersCover", () => {
  it("offers the band to a picture from outside", () => {
    expect(offersCover(["Files"], ["image/png"])).toBe(true);
  });

  it("offers no band to a file that could not be a cover", () => {
    expect(offersCover(["Files"], ["application/pdf"])).toBe(false);
    expect(offersCover(["Files"], ["application/zip", "text/markdown"])).toBe(false);
  });

  it("offers the band when one file among several could be a cover", () => {
    expect(offersCover(["Files"], ["application/pdf", "image/webp"])).toBe(true);
  });

  it("offers the band when the engine will not say what the files are yet", () => {
    expect(offersCover(["Files"], [])).toBe(true);
    expect(offersCover(["Files"], [""])).toBe(true);
  });

  it("stays out of a card dragged across the wall", () => {
    expect(offersCover(["Files", DRAG_TYPE], ["image/png"])).toBe(false);
    expect(offersCover([DRAG_TYPE], [])).toBe(false);
  });

  it("stays out of a drag with no files at all", () => {
    expect(offersCover(["text/uri-list", "text/plain"], [])).toBe(false);
  });
});
