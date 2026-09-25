import { readPixels } from "./derive";

/**
 * Whether a picture is see-through anywhere, asked of the file itself.
 *
 * A format that can carry transparency does not mean a picture that uses
 * it. Of 133 PNGs saved from Pinterest, 86 carried an alpha channel and 3
 * had see-through areas of any size. So the header is asked first, since it
 * can rule a file out without decoding it, and the pixels only when it
 * cannot.
 */

function ascii(bytes: Uint8Array, from: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(from, from + length));
}

/**
 * False when the header proves the picture has no transparency, true when
 * it may have some, and true for anything that is not a PNG or a WebP,
 * since only those two are read here.
 *
 * - PNG: a colour type with an alpha channel (4, 6), or a tRNS chunk, which
 *   is how a palette or a single colour is made see-through. The chunk has
 *   to come before the image data, so the walk stops at the first IDAT.
 * - WebP: the simple lossy form has no alpha at all; the lossless form
 *   carries an alpha-is-used bit; the extended form an alpha flag.
 */
export function mayBeSeeThrough(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  try {
    if (bytes.length >= 26 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") {
      const colourType = bytes[25];
      if (colourType === 4 || colourType === 6) return true;
      for (let at = 8; at + 8 <= bytes.length; ) {
        const type = ascii(bytes, at + 4, 4);
        if (type === "tRNS") return true;
        if (type === "IDAT" || type === "IEND") return false;
        at += 12 + view.getUint32(at);
      }
      // Cut short before the image data: nothing was ruled out.
      return true;
    }
    if (bytes.length >= 21 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
      const chunk = ascii(bytes, 12, 4);
      if (chunk === "VP8 ") return false;
      if (chunk === "VP8L") return bytes.length >= 25 && ((view.getUint32(21, true) >>> 28) & 1) === 1;
      if (chunk === "VP8X") return (bytes[20] & 0x10) !== 0;
    }
  } catch {
    // A header cut short: say nothing it cannot back up.
    return true;
  }
  return true;
}

/**
 * Whether any pixel inside the frame of an RGBA image is less than fully
 * opaque.
 *
 * The outermost row and column are left out. Scaling a picture down to read
 * it can blend its edge with the empty canvas beyond, which would make every
 * opaque picture look see-through at the border. A cut-out's transparency
 * is never one pixel wide at the scale this is read at.
 */
export function hasSeeThroughPixel(rgba: ArrayLike<number>, width: number, height: number): boolean {
  if (width < 3 || height < 3) {
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) return true;
    return false;
  }
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (rgba[(y * width + x) * 4 + 3] < 255) return true;
    }
  }
  return false;
}

/** How wide a picture is read at. Enough for any cut-out to show. */
const SAMPLE_WIDTH = 512;

function typeOf(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  return "";
}

/**
 * Whether a downloaded picture is fully opaque, so a JPEG of it loses
 * nothing. A picture this webview cannot decode counts as see-through:
 * keeping an original that did not need keeping costs space, and giving
 * one up that did costs the picture.
 */
export async function isOpaque(buffer: ArrayBuffer): Promise<boolean> {
  if (!mayBeSeeThrough(buffer)) return true;
  const type = typeOf(new Uint8Array(buffer));
  const pixels = await readPixels(new Blob([buffer], type ? { type } : {}), SAMPLE_WIDTH);
  if (!pixels) return false;
  return !hasSeeThroughPixel(pixels.data, pixels.width, pixels.height);
}
