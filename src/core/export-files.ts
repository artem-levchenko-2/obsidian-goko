import { dedupeMedia, sourceVideoKeyFor } from "./normalize";
import type { MediaRef } from "./scan";

/**
 * Every archived file that stands for a clipping when it leaves the vault,
 * originals only, in the order they should go.
 *
 * A video pulled from the post is the clipping's media outright. Whatever
 * the page itself embeds for a post like that is a poster, a still of the
 * same video, which stays on disk as the tile's cover but is not a second
 * thing to hand over; exporting a reel used to leave the video and its
 * poster side by side in Downloads.
 *
 * @param archivedFile the cache's answer for a key: a local file, or
 * undefined. Passed as a function so this stays free of Obsidian imports.
 */
export function exportFiles(
  record: { source: string; media: MediaRef[] },
  archivedFile: (key: string) => string | undefined
): string[] {
  if (record.source) {
    const video = archivedFile(sourceVideoKeyFor(record.source));
    if (video) return [video];
  }

  const paths: string[] = [];
  // Looked up through the same dedupe the archiver used, so the keys
  // match; comparing a raw URL against a normalized key would not.
  for (const media of dedupeMedia(record.media)) {
    // An embedded vault file is its own archive.
    if (!/^https?:\/\//i.test(media.url)) {
      paths.push(media.url);
      continue;
    }
    const file = archivedFile(media.key);
    if (file) paths.push(file);
  }
  return [...new Set(paths)];
}
