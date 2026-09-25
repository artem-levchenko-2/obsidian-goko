import { describe, expect, it } from "vitest";
import { hasSeeThroughPixel, isOpaque, mayBeSeeThrough } from "../src/core/alpha";

function bytes(...parts: Array<string | number[]>): ArrayBuffer {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") for (const ch of part) out.push(ch.charCodeAt(0));
    else out.push(...part);
  }
  return new Uint8Array(out).buffer;
}

const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const CRC = [0, 0, 0, 0];

/** A PNG's signature, its IHDR with this colour type, and the chunks named before its image data. */
function png(colourType: number, before: string[] = []): ArrayBuffer {
  const ihdr = [...u32(64), ...u32(64), 8, colourType, 0, 0, 0];
  const chunks: Array<string | number[]> = [];
  for (const name of before) chunks.push(u32(3), name, [0, 0, 0], CRC);
  return bytes(
    [0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a],
    u32(13), "IHDR", ihdr, CRC,
    ...chunks,
    u32(0), "IDAT", CRC,
    u32(0), "IEND", CRC
  );
}

/** A WebP whose first chunk is `chunk`, followed by these payload bytes. */
function webp(chunk: string, payload: number[]): ArrayBuffer {
  return bytes("RIFF", [0, 0, 0, 0], "WEBP", chunk, [payload.length, 0, 0, 0], payload);
}

describe("mayBeSeeThrough", () => {
  it("rules out a PNG with no alpha channel and no tRNS", () => {
    expect(mayBeSeeThrough(png(2))).toBe(false);
    expect(mayBeSeeThrough(png(0))).toBe(false);
    expect(mayBeSeeThrough(png(3, ["PLTE"]))).toBe(false);
  });

  it("cannot rule out a PNG with an alpha channel", () => {
    expect(mayBeSeeThrough(png(6))).toBe(true);
    expect(mayBeSeeThrough(png(4))).toBe(true);
  });

  it("cannot rule out a PNG made see-through by a tRNS chunk", () => {
    expect(mayBeSeeThrough(png(3, ["PLTE", "tRNS"]))).toBe(true);
    expect(mayBeSeeThrough(png(2, ["tRNS"]))).toBe(true);
  });

  it("rules out a lossy WebP in its simple form", () => {
    expect(mayBeSeeThrough(webp("VP8 ", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
  });

  it("reads a lossless WebP's alpha-is-used bit", () => {
    expect(mayBeSeeThrough(webp("VP8L", [0x2f, 0, 0, 0, 0x10]))).toBe(true);
    expect(mayBeSeeThrough(webp("VP8L", [0x2f, 0, 0, 0, 0x00]))).toBe(false);
  });

  it("reads an extended WebP's alpha flag", () => {
    expect(mayBeSeeThrough(webp("VP8X", [0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(true);
    expect(mayBeSeeThrough(webp("VP8X", [0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
  });

  it("rules nothing out for another format or a header cut short", () => {
    expect(mayBeSeeThrough(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(mayBeSeeThrough(png(2).slice(0, 30))).toBe(true);
  });
});

describe("hasSeeThroughPixel", () => {
  const opaque = (width: number, height: number): Uint8Array => {
    const rgba = new Uint8Array(width * height * 4).fill(200);
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
    return rgba;
  };

  it("is false for a picture opaque everywhere", () => {
    expect(hasSeeThroughPixel(opaque(8, 6), 8, 6)).toBe(false);
  });

  it("finds one see-through pixel inside the frame", () => {
    const rgba = opaque(8, 6);
    rgba[(3 * 8 + 4) * 4 + 3] = 128;
    expect(hasSeeThroughPixel(rgba, 8, 6)).toBe(true);
  });

  it("ignores the outermost row and column, where scaling blends in the empty canvas", () => {
    const rgba = opaque(8, 6);
    rgba[3] = 0;
    rgba[(5 * 8 + 7) * 4 + 3] = 250;
    expect(hasSeeThroughPixel(rgba, 8, 6)).toBe(false);
  });

  it("reads every pixel of a picture too small to have a frame", () => {
    const rgba = opaque(2, 2);
    rgba[3] = 0;
    expect(hasSeeThroughPixel(rgba, 2, 2)).toBe(true);
  });
});

describe("isOpaque", () => {
  it("answers from the header alone when the header can", async () => {
    expect(await isOpaque(png(2))).toBe(true);
  });
});
