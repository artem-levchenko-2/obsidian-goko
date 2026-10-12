import { describe, expect, it } from "vitest";
import {
  VECTOR_WIDTH,
  posterPath,
  previewPath,
  scaledSize,
  svgShape,
  thumbPath,
  vectorSize,
} from "../src/core/derive";

describe("thumbPath", () => {
  it("appends a thumb suffix before the extension", () => {
    expect(thumbPath("Attachments/Clippings/abc-a.jpg")).toBe(
      "Attachments/Clippings/abc-a.thumb.webp"
    );
  });

  it("handles files with no extension", () => {
    expect(thumbPath("Attachments/Clippings/abc")).toBe("Attachments/Clippings/abc.thumb.webp");
  });

  it("is not confused by a dot in a folder name", () => {
    expect(thumbPath("My.Files/abc")).toBe("My.Files/abc.thumb.webp");
  });
});

describe("posterPath", () => {
  it("appends a poster suffix before the extension", () => {
    expect(posterPath("Attachments/Clippings/abc-clip.mp4")).toBe(
      "Attachments/Clippings/abc-clip.poster.webp"
    );
  });

  it("differs from the thumb path for the same file", () => {
    expect(posterPath("a/b.mp4")).not.toBe(thumbPath("a/b.mp4"));
  });
});

describe("scaledSize", () => {
  it("scales down to the target width and preserves the ratio", () => {
    expect(scaledSize(1920, 1080, 400)).toEqual({ width: 400, height: 225 });
  });

  it("never upscales", () => {
    expect(scaledSize(200, 100, 400)).toEqual({ width: 200, height: 100 });
  });

  it("guards against zero dimensions", () => {
    expect(scaledSize(0, 0, 400)).toEqual({ width: 400, height: 400 });
  });

  it("rounds to whole pixels", () => {
    expect(Number.isInteger(scaledSize(1000, 333, 400).height)).toBe(true);
  });

  it("handles the real portrait video shape", () => {
    expect(scaledSize(886, 1920, 400)).toEqual({ width: 400, height: 867 });
  });
});

describe("previewPath", () => {
  it("appends a preview suffix before the extension", () => {
    expect(previewPath("Attachments/Clippings/abc-shot.heic")).toBe(
      "Attachments/Clippings/abc-shot.preview.png"
    );
  });

  it("handles files with no extension", () => {
    expect(previewPath("Attachments/Clippings/abc")).toBe(
      "Attachments/Clippings/abc.preview.png"
    );
  });
});

describe("svgShape", () => {
  it("reads absolute width and height", () => {
    expect(svgShape('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">')).toEqual({
      width: 1200,
      height: 630,
    });
    expect(svgShape("<svg width='64px' height='32px'></svg>")).toEqual({ width: 64, height: 32 });
  });

  it("falls back to the viewBox when the size is missing or relative", () => {
    expect(svgShape('<svg viewBox="0 0 400 100">')).toEqual({ width: 400, height: 100 });
    expect(svgShape('<svg width="100%" height="100%" viewBox="0,0,30,60">')).toEqual({ width: 30, height: 60 });
  });

  it("finds the root after a declaration and comments", () => {
    const markup = '<?xml version="1.0"?>\n<!-- drawn by hand -->\n<svg\n  viewBox="0 0 10 20"\n>';
    expect(svgShape(markup)).toEqual({ width: 10, height: 20 });
  });

  it("gives up on markup that declares no shape", () => {
    expect(svgShape("<svg>")).toBeNull();
    expect(svgShape('<svg viewBox="0 0 0 0">')).toBeNull();
    expect(svgShape("not svg at all")).toBeNull();
  });
});

describe("vectorSize", () => {
  it("draws at the full vector width whatever the declared size", () => {
    expect(vectorSize({ width: 1200, height: 630 })).toEqual({ width: VECTOR_WIDTH, height: 840 });
    expect(vectorSize({ width: 24, height: 24 })).toEqual({ width: VECTOR_WIDTH, height: VECTOR_WIDTH });
  });

  it("keeps a very tall one inside the canvas an iPhone will draw", () => {
    const size = vectorSize({ width: 10, height: 400 })!;
    expect(size.width * size.height).toBeLessThanOrEqual(4096 * 4096);
    expect(size.height / size.width).toBeCloseTo(40, 0);
  });

  it("gives up on a vector with no shape", () => {
    expect(vectorSize(null)).toBeNull();
    expect(vectorSize({ width: 0, height: 0 })).toBeNull();
  });
});
