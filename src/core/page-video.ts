import { looksLikeMedia, sourceVideoCandidates } from "./archive";
import { extensionForMime, extensionOf, kindForMime } from "./formats";

/** What came back from fetching the address a page gave for its video. */
export interface PageVideoResponse {
  status: number;
  contentType?: string;
  data: ArrayBuffer;
}

/**
 * Where a post's own video goes in the vault, when the page handed over its
 * address — or why it goes nowhere.
 *
 * The answer is always one of sourceVideoCandidates for the post's key: the
 * very file a local yt-dlp writes for the same post. That is the whole
 * point. downloadSourceVideoFor looks there before it considers yt-dlp, on
 * every device the vault syncs to, so a video that arrived this way is one
 * nothing ever fetches again, and the note is the same shape whichever route
 * brought it. A format the slot has no name for is refused rather than
 * written somewhere nothing would look.
 *
 * The content type is checked because the address is signed and expires,
 * and an expired one need not answer with an error status: a page saying so
 * would otherwise be saved as the video. A server that names no type, or
 * only a generic one, is judged by the bytes instead.
 */
export function placePageVideo(
  response: PageVideoResponse,
  url: string,
  key: string,
  folder: string,
  maxBytes: number
): { path: string } | { failed: string } {
  if (response.status < 200 || response.status >= 300) {
    return { failed: `HTTP ${response.status}` };
  }
  const bytes = response.data.byteLength;
  if (bytes === 0) return { failed: "empty response" };
  if (bytes > maxBytes) return { failed: `too large (${bytes} bytes)` };

  const type = (response.contentType ?? "").split(";")[0].trim().toLowerCase();
  const kind = type ? kindForMime(type) : null;
  if (kind !== "video" && (kind !== null || !looksLikeMedia(response.data))) {
    return { failed: `unexpected content type ${type || "(none)"}` };
  }

  const extension = kind === "video" ? extensionForMime(type) : extensionOf(url) || "mp4";
  const path = sourceVideoCandidates(key, folder).find((candidate) =>
    candidate.endsWith(`-video.${extension}`)
  );
  return path ? { path } : { failed: `unsupported video format ${extension}` };
}

/**
 * Whether a resolved link hands the archiver anything to fetch.
 *
 * The address of the post's own video counts as much as a picture does. A
 * Threads video post has no picture of its own once its avatar is set aside,
 * so its media is empty and the video is all there is; read as a link with
 * nothing in it, it would be scanned or saved bare and the video would never
 * be asked for.
 */
export function hasMediaToArchive(link: {
  media: readonly unknown[];
  sourceVideoUrl?: string;
}): boolean {
  return link.media.length > 0 || Boolean(link.sourceVideoUrl);
}

/**
 * Whether a clip is worth the notice that the source refused its picture:
 * every picture it named was refused, and no video of the post's own took
 * their place.
 *
 * A video that landed leads the note and becomes its cover, so the card is
 * not the sheet of words the notice warns about. A link that named no
 * picture had none refused, which matters now that a link can reach the
 * archiver with its video alone.
 */
export function pictureRefused(refused: readonly boolean[], sourceVideo: string | null): boolean {
  return !sourceVideo && refused.length > 0 && refused.every(Boolean);
}
