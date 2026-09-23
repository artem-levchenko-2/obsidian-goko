/**
 * A file copied in Finder, read off the clipboard.
 *
 * ⌘C on a file puts a `file://` URL on the pasteboard, not the picture's
 * bytes, so the web clipboard API sees nothing it can use and the plugin used
 * to answer "nothing to clip" to the most natural gesture there is. Electron's
 * own clipboard can read that URL on macOS, and the file is right there on
 * disk. This is the pure half: turning what the pasteboard holds into a path
 * and a type. main.ts does the reading.
 */

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
};

/** The MIME type for a path by its extension, or null for one the wall cannot take. */
export function mimeForPath(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return null;
  return MIME_BY_EXT[path.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * The local path a `file://` URL names, or null when the text is not one.
 *
 * Only the first URL: a multi-file copy puts several on the pasteboard
 * separated by newlines, and clipping one card per gesture is the promise the
 * rest of the plugin makes. Percent-escapes are undone so a name with a space
 * reaches the disk as a space.
 */
export function pathFromFileUrl(text: string): string | null {
  const first = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!first || !/^file:\/\//i.test(first)) return null;
  try {
    const url = new URL(first);
    if (url.protocol !== "file:") return null;
    // On macOS the host is empty or "localhost"; anything else is a network
    // share, which this does not read.
    if (url.hostname && url.hostname !== "localhost") return null;
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}

/** The last segment of a path, without its extension, for a clipping's title. */
export function titleFromPath(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * The vault-relative path of a file on disk, or null when it is not inside
 * the vault. Separators are compared as forward slashes, so a Windows path
 * and a vault root read off the same machine agree.
 */
export function pathInsideVault(root: string, absolute: string): string | null {
  const plain = (path: string): string => path.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = plain(root);
  const full = plain(absolute);
  if (!base || !full.startsWith(`${base}/`)) return null;
  return full.slice(base.length + 1);
}
