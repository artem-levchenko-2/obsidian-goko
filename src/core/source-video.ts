import { sourceVideoCandidates } from "./archive";
import { dedupeMedia, sourceVideoKeyFor } from "./normalize";
import type { MediaRef } from "./scan";

/** A video the clipping already holds, and whether the note embeds it. */
export interface OwnVideo {
  key: string;
  file: string;
  embedded: boolean;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * The video a clipping already holds under a name of its own, or null when
 * the post's video is still worth looking for.
 *
 * Capture asks the same question of what it has just downloaded: fxtwitter
 * hands over X's mp4 as ordinary media, and yt-dlp is not run for a post
 * whose video landed that way. A note read back from the vault carries the
 * same answer, as a video it embeds or one the cache holds a file for, and a
 * background pass that ignored it fetched the clip a second time into the
 * slot yt-dlp writes.
 *
 * An embed counts whether or not its file is there yet: sync can deliver the
 * note ahead of the video, and a pass that ran in between would download what
 * was already on its way. A remote video counts only once it is archived. A
 * failed download, or an address nothing has fetched, leaves the post without
 * its video, and yt-dlp is then the one way left to get it.
 *
 * The slot itself does not count. A reel's video fetched from its page is
 * written there and embedded by that name, and finding it stays the job of
 * the source-video route, which adopts the file into the cache on a device
 * that has never heard of it.
 *
 * @param archivedFile the cache's file for a key, or undefined. Passed as a
 * function so this stays free of Obsidian imports.
 */
export function ownVideo(
  record: { source: string; media: MediaRef[] },
  archivedFile: (key: string) => string | undefined
): OwnVideo | null {
  const slot = new Set(
    sourceVideoCandidates(sourceVideoKeyFor(record.source), "").map(basename)
  );
  for (const media of dedupeMedia(record.media)) {
    if (media.kind !== "video") continue;
    const embedded = !/^https?:\/\//i.test(media.url);
    const file = embedded ? media.url : archivedFile(media.key);
    if (!file || slot.has(basename(file))) continue;
    return { key: media.key, file, embedded };
  }
  return null;
}
