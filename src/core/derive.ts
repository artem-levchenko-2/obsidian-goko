import { previewSize } from "./preview-route";

function replaceExtension(path: string, suffix: string): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  return dot > slash ? path.slice(0, dot) + suffix : path + suffix;
}

export function thumbPath(originalPath: string): string {
  return replaceExtension(originalPath, ".thumb.webp");
}

export function posterPath(originalPath: string): string {
  return replaceExtension(originalPath, ".poster.webp");
}

export function previewPath(originalPath: string): string {
  return replaceExtension(originalPath, ".preview.png");
}

export function scaledSize(
  width: number,
  height: number,
  targetWidth: number
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: targetWidth, height: targetWidth };
  if (width <= targetWidth) return { width, height };
  return { width: targetWidth, height: Math.round((height / width) * targetWidth) };
}

export interface Rendered {
  data: ArrayBuffer;
  width: number;
  height: number;
}

async function encode(
  canvas: HTMLCanvasElement,
  type = "image/webp"
): Promise<ArrayBuffer | null> {
  try {
    const blob = await new Promise<Blob | null>((resolve) => {
      try {
        canvas.toBlob(resolve, type, 0.8);
      } catch {
        // Tainted canvas. Callers pass blob: URLs precisely to avoid this,
        // but never let a render failure lose the archived original.
        resolve(null);
      }
    });
    return blob ? await blob.arrayBuffer() : null;
  } catch {
    return null;
  }
}

function draw(
  source: CanvasImageSource,
  size: { width: number; height: number }
): HTMLCanvasElement | null {
  const canvas = createEl("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(source, 0, 0, size.width, size.height);
  return canvas;
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  const image = new Image();
  const loaded = new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
  });
  image.src = url;
  if (!(await loaded)) return null;
  return image.naturalWidth > 0 ? image : null;
}

/**
 * Downscales an archived image for the grid. Decoding a 1920x1080 JPEG to
 * paint a 300px tile is most of the cost of a naive grid; this is the single
 * largest performance win in the plugin.
 */
export async function renderThumbnail(
  sourceUrl: string,
  targetWidth: number
): Promise<Rendered | null> {
  const image = await loadImage(sourceUrl);
  if (!image) return null;

  const canvas = draw(image, scaledSize(image.naturalWidth, image.naturalHeight, targetWidth));
  if (!canvas) return null;
  const data = await encode(canvas);
  if (!data) return null;
  return { data, width: image.naturalWidth, height: image.naturalHeight };
}

/** The spec's HAVE_CURRENT_DATA: a frame at the current position is decoded. */
const HAVE_CURRENT_DATA = 2;

/**
 * The first of `events` the video fires, "error" if it fails first, or
 * "timeout" if neither happens within `ms`.
 */
function nextEvent(video: HTMLVideoElement, events: string[], ms: number): Promise<string> {
  return new Promise((resolve) => {
    const names = [...events, "error"];
    const finish = (outcome: string): void => {
      window.clearTimeout(timer);
      for (const name of names) video.removeEventListener(name, listeners[name]);
      resolve(outcome);
    };
    const listeners: Record<string, () => void> = {};
    for (const name of names) listeners[name] = () => finish(name);
    for (const name of names) video.addEventListener(name, listeners[name]);
    const timer = window.setTimeout(() => finish("timeout"), ms);
  });
}

/** Moves to a frame just past the start, as a poster has always been taken. */
async function seekFrame(video: HTMLVideoElement): Promise<boolean> {
  const seeked = nextEvent(video, ["seeked"], 5000);
  video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
  return (await seeked) === "seeked";
}

/**
 * Plays the clip, muted and inline, until it has shown a frame. A refusal to
 * play ends the wait at once rather than when the clock runs out.
 */
async function playFrame(video: HTMLVideoElement): Promise<boolean> {
  const shown = nextEvent(video, ["timeupdate"], 5000);
  const refused = video.play().then(
    () => new Promise<string>(() => {}),
    () => "refused"
  );
  const outcome = await Promise.race([shown, refused]);
  video.pause();
  return outcome === "timeupdate" && video.readyState >= HAVE_CURRENT_DATA;
}

/**
 * Captures one frame so a video tile can paint instantly while still holding
 * preload="none". Also the webview's only source of a video's intrinsic
 * dimensions, since no container header parser runs over mp4.
 *
 * WebKit, the engine under Obsidian on an iPhone, decides the shape of this.
 * It holds a video that is only preloading at its metadata, with no frame to
 * draw: for preload="metadata" on any device, and on an iPhone for any
 * preload at all. So the frame is asked for with preload="auto", which is
 * all Chromium needs, and where none has arrived shortly after the metadata
 * the clip is played until one does, muted and inline, as the wall's own
 * autoplay plays it without a tap. Without playsInline, playing on an iPhone
 * means going full screen.
 */
export async function renderPoster(
  sourceUrl: string,
  targetWidth: number
): Promise<Rendered | null> {
  const video = createEl("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = sourceUrl;

  try {
    if ((await nextEvent(video, ["loadedmetadata"], 10000)) !== "loadedmetadata") return null;
    if (video.videoWidth === 0) return null;

    if (video.readyState < HAVE_CURRENT_DATA) {
      if ((await nextEvent(video, ["loadeddata"], 2000)) === "error") return null;
    }
    const framed =
      video.readyState >= HAVE_CURRENT_DATA ? await seekFrame(video) : await playFrame(video);
    if (!framed) return null;

    const canvas = draw(video, scaledSize(video.videoWidth, video.videoHeight, targetWidth));
    if (!canvas) return null;
    const data = await encode(canvas);
    if (!data) return null;
    return { data, width: video.videoWidth, height: video.videoHeight };
  } finally {
    // Let go of the decoder now rather than whenever the element is
    // collected: a phone has only a few, and the wall's own tiles need them.
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/**
 * The picture decoded by the webview itself, turned the way it was taken,
 * or null when this webview cannot read the format.
 *
 * createImageBitmap first: it decodes with the system's own image code and
 * is told outright to honour the orientation the camera recorded. An engine
 * that predates "from-image" rejects the option rather than the file, which
 * is a TypeError, and is asked again without it. An <img> last, which every
 * webview has and which applies orientation of its own accord.
 */
async function decode(blob: Blob): Promise<Decoded | null> {
  const bitmap = await decodeBitmap(blob);
  if (bitmap) {
    const release = (): void => bitmap.close();
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release };
  }

  const url = URL.createObjectURL(blob);
  const image = await loadImage(url);
  URL.revokeObjectURL(url);
  if (!image) return null;
  return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => {} };
}

async function decodeBitmap(blob: Blob): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch (error) {
    if (!(error instanceof TypeError)) return null;
  }
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/**
 * The picture's RGBA bytes at no more than `maxWidth` wide, or null when
 * this webview cannot decode it. Drawn onto an empty canvas, so what the
 * picture leaves see-through stays see-through in the bytes.
 */
export async function readPixels(
  blob: Blob,
  maxWidth: number
): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  const decoded = await decode(blob);
  if (!decoded) return null;
  try {
    const canvas = draw(decoded.source, scaledSize(decoded.width, decoded.height, maxWidth));
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return null;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    return { data, width: canvas.width, height: canvas.height };
  } catch {
    return null;
  } finally {
    decoded.release();
  }
}

/**
 * A preview made by the webview, for a format the wall cannot paint as it
 * stands but this webview can decode: HEIC on an iPhone.
 *
 * A PNG, like the one sips writes to the same path, so either device adopts
 * the other's. At the picture's own size where the canvas allows it, since a
 * preview is also what the detail stage shows full screen; see previewSize
 * for where it does not. Returns the size of the PNG, as the tool route does
 * by reading its file back.
 */
export async function renderStill(blob: Blob): Promise<Rendered | null> {
  const decoded = await decode(blob);
  if (!decoded) return null;
  try {
    const canvas = draw(decoded.source, previewSize(decoded.width, decoded.height));
    if (!canvas) return null;
    const data = await encode(canvas, "image/png");
    if (!data) return null;
    return { data, width: canvas.width, height: canvas.height };
  } finally {
    decoded.release();
  }
}
