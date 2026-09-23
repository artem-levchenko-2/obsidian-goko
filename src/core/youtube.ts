/**
 * What a YouTube address points at, read off the address alone.
 *
 * A Short and an ordinary video are the same host to anything that only
 * checks hosts, and they want different things from the wall. A Short is a
 * vertical clip under a few minutes long, and it belongs on the wall as
 * itself, sound and all. An ordinary video runs from minutes to hours, and a
 * low-resolution copy of it in the vault is not what anyone meant by saving
 * the link: it is kept as its cover and a way back to YouTube. The cover, the
 * download and the panel's buttons each have to tell the two apart, so they
 * all ask here and cannot disagree about which one a link is.
 */

/**
 * Every host a YouTube video is addressed by, without `www.`. The one list:
 * the thumbnail lookup and the downloadable hosts both read it, so a host
 * added here is a host both of them know.
 */
export const YOUTUBE_HOSTS: ReadonlySet<string> = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
]);

/** YouTube ids are exactly 11 characters of base64url. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const ID_PATHS = /^\/(embed|shorts|v|live)\/([A-Za-z0-9_-]{11})/;

/**
 * - `short`: a `/shorts/` address, vertical and short enough to keep whole.
 * - `video`: everything else that names one video — a watch page, a
 *   `youtu.be` link, a live stream, an embed.
 * - `music`: YouTube Music, which is a song rather than a clip.
 */
export type YoutubeKind = "short" | "video" | "music";

export interface YoutubeLink {
  kind: YoutubeKind;
  id: string;
}

function hostOf(parsed: URL): string {
  return parsed.hostname.replace(/^www\./, "").toLowerCase();
}

/**
 * The video a YouTube address names and what kind it is, or null.
 *
 * Null for another host and for a YouTube page that names no single video:
 * a channel, a feed, a search. Those have no cover to look up and nothing a
 * download could fetch that anyone asked for.
 */
export function classifyYoutube(url: string): YoutubeLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = hostOf(parsed);
  if (!YOUTUBE_HOSTS.has(host)) return null;

  if (host === "youtu.be") {
    const id = parsed.pathname.slice(1).split("/")[0] ?? "";
    return YOUTUBE_ID.test(id) ? { kind: "video", id } : null;
  }

  const path = ID_PATHS.exec(parsed.pathname);
  const id = parsed.searchParams.get("v") ?? path?.[2] ?? "";
  if (!YOUTUBE_ID.test(id)) return null;

  if (host === "music.youtube.com") return { kind: "music", id };
  return { kind: path?.[1] === "shorts" ? "short" : "video", id };
}

/** The setting's minutes as a number worth using: 0 for off or for nonsense. */
function minutesOf(videoMinutes: number): number {
  return Number.isFinite(videoMinutes) && videoMinutes > 0 ? videoMinutes : 0;
}

/**
 * Whether a YouTube address's own video is downloaded into the vault.
 *
 * A Short always is. An ordinary video only when the setting asks for it,
 * and then under a duration cap (see youtubeDurationCap). YouTube Music never
 * is: the song is the point, and a video file of it is not the song.
 *
 * @param videoMinutes the longest ordinary video to download, from settings;
 * 0 downloads none.
 */
export function downloadsYoutubeVideo(url: string, videoMinutes: number): boolean {
  switch (classifyYoutube(url)?.kind) {
    case "short":
      return true;
    case "video":
      return minutesOf(videoMinutes) > 0;
    default:
      return false;
  }
}

/**
 * The duration cap, in seconds, for downloading this address, or undefined
 * for none. Only an ordinary YouTube video has one: it is the setting that
 * lets such a video be downloaded at all, and what it says is how long.
 */
export function youtubeDurationCap(url: string, videoMinutes: number): number | undefined {
  const minutes = minutesOf(videoMinutes);
  if (minutes === 0 || classifyYoutube(url)?.kind !== "video") return undefined;
  return Math.round(minutes * 60);
}

/**
 * Whether the clipping's video is watched on YouTube rather than on the wall:
 * an ordinary video or a song. What follows from it is a play mark on the
 * cover, so the card reads as a video and not a picture, and a way to open it
 * on YouTube. A Short is not one of these, since its video is downloaded.
 */
export function watchedOnYoutube(url: string): boolean {
  const kind = classifyYoutube(url)?.kind;
  return kind === "video" || kind === "music";
}
