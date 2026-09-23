import { NEEDS_FFMPEG } from "./archive";
import { classifyYoutube } from "./youtube";

/**
 * What yt-dlp is asked for when it fetches a post's own video, and what its
 * answer meant.
 *
 * Both halves are here rather than in convert.ts so a test can see them: the
 * arguments decide whether the file has sound and whether a long video is
 * downloaded at all, and the reading of its output decides what the cache
 * remembers about a post that produced nothing. Neither needs a process.
 */

/** The limits a download is held to, from settings and from the caller. */
export interface YtdlpLimits {
  /** The attachment size cap; nothing larger is downloaded. */
  maxBytes: number;
  /** A duration cap in seconds. Absent, zero or negative means none. */
  maxSeconds?: number;
}

export interface YtdlpRequest extends YtdlpLimits {
  url: string;
  /** A fresh directory that only this download writes into. */
  dir: string;
  /** Where ffmpeg is, or null on a device without it. */
  ffmpeg: string | null;
}

/** How a finished process went, in the shape execFile reports it. */
export interface ProcessExit {
  /** The exit status, or null when the process never ran or was killed. */
  code: number | null;
  /** Whether it was stopped for running past its timeout. */
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export type YtdlpOutcome = { file: string } | { failed: string };

export const TIMED_OUT = "yt-dlp timed out";
export const NO_VIDEO = "yt-dlp found no video";
export const NO_FORMAT = "yt-dlp found no suitable format";

/** The tallest picture worth keeping: a vertical 720p, a landscape 1080p. */
const MAX_HEIGHT = 1280;

/**
 * The formats to ask for, best first.
 *
 * A bare `mp4` used to lead, and it means the best file in an mp4 container
 * whether or not it has sound: on a YouTube Short that is a silent AV1
 * stream, and the clip landed mute. Every choice now carries audio, and
 * H.264, which every platform Obsidian runs on decodes, is preferred.
 *
 * The strict filters exclude a format whose codecs are unknown, and some
 * extractors never say: Instagram's progressive files carry sound and name
 * no codec. The `?` forms admit those after everything that is known to be
 * right, while still refusing a stream yt-dlp knows is silent.
 *
 * A pair of streams is only asked for when ffmpeg is here to join them;
 * without it yt-dlp would download the two halves side by side and hand back
 * a silent video. The plain `best` at the end takes a silent video only from
 * a post that has no sound at all, which is then the video itself.
 *
 * A YouTube Short asks for the pair first. The one file YouTube serves with
 * sound already in it is 360p, when it serves one at all, so a Short posted
 * at 720×1280 landed at a third of that. Only a Short, though: an ordinary
 * video's best pair under the height cap is 1080p, past the size cap for
 * anything longer than a minute or two, and the size filter then refuses
 * the video outright rather than falling back to a smaller format. The
 * 360p file is what fits, so an ordinary video keeps asking for it first.
 */
export function formatSelector(canMerge: boolean, youtubeShort = false): string {
  const h = MAX_HEIGHT;
  const pair = canMerge ? [`bv*[ext=mp4][vcodec^=avc1][height<=${h}]+ba[ext=m4a]`] : [];
  return [
    ...(youtubeShort ? pair : []),
    `best[ext=mp4][acodec!=none][vcodec^=avc1][height<=${h}]`,
    `best[ext=mp4][acodec!=none][height<=${h}]`,
    ...(youtubeShort ? [] : pair),
    `best[ext=mp4][acodec!=?none][height<=?${h}]`,
    "best",
  ].join("/");
}

function durationCap(maxSeconds: number | undefined): number | null {
  return maxSeconds !== undefined && Number.isFinite(maxSeconds) && maxSeconds > 0
    ? maxSeconds
    : null;
}

/**
 * The command line for one download.
 *
 * `--max-filesize` alone does not keep a long video off the wire: yt-dlp
 * checks it against each response's length, and YouTube is fetched in 10 MB
 * ranges, so it had pulled two of them before it noticed. The match filter
 * refuses on the size the site already reported, before any of the file is
 * fetched, and `--max-filesize` stays for the sites that report none.
 *
 * The duration cap goes through the breaking variant of the filter only so
 * the refusal says which limit it was. yt-dlp's message quotes the filter
 * that failed, and one combined filter would quote both. For a single post
 * there is nothing further for "stop here" to stop.
 *
 * `--print` quietens everything else, which would also silence the lines
 * that say why nothing was downloaded, so `--no-quiet` turns them back on.
 */
export function ytdlpArgs(request: YtdlpRequest): string[] {
  const maxBytes = Math.floor(request.maxBytes);
  const maxSeconds = durationCap(request.maxSeconds);
  return [
    "--no-warnings",
    "--no-playlist",
    "--no-progress",
    "--no-quiet",
    "-f",
    formatSelector(request.ffmpeg !== null, classifyYoutube(request.url)?.kind === "short"),
    // Electron's PATH usually lacks the directory ffmpeg was installed to,
    // and yt-dlp would look for it there.
    ...(request.ffmpeg ? ["--ffmpeg-location", request.ffmpeg] : []),
    "--max-filesize",
    String(maxBytes),
    "--match-filters",
    `filesize <=? ${maxBytes} & filesize_approx <=? ${maxBytes}`,
    ...(maxSeconds !== null ? ["--break-match-filters", `duration <=? ${maxSeconds}`] : []),
    "-o",
    `${request.dir}/media.%(ext)s`,
    "--no-simulate",
    "--print",
    "after_move:filepath",
    request.url,
  ];
}

/** Slashes one way, so a Windows path compares with the prefix it was built from. */
function unslashed(path: string): string {
  return path.replace(/\\/g, "/");
}

/** The last path yt-dlp printed inside the download's own directory. */
function printedFile(stdout: string, dir: string): string | null {
  const prefix = `${unslashed(dir).replace(/\/$/, "")}/`;
  const lines = stdout.split(/\r?\n/).map((line) => line.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    if (unslashed(lines[i]).startsWith(prefix)) return lines[i];
  }
  return null;
}

/** yt-dlp's last complaint, without its prefixes and cut to a readable length. */
function lastError(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const error = [...lines].reverse().find((line) => line.startsWith("ERROR:"));
  const message = (error ?? lines[lines.length - 1] ?? "")
    .replace(/^ERROR:\s*/, "")
    .replace(/^\[[^\]]+\]\s*[^\s:]+:\s*/, "");
  return message.length > 160 ? `${message.slice(0, 159)}…` : message;
}

/**
 * The wording extractors use for a post that has no video in it, as opposed
 * to one they could not read: Instagram's "There is no video in this post",
 * X's and Bluesky's "No video could be found", Reddit's "No media found",
 * and yt-dlp's own "No video formats found".
 */
const NO_VIDEO_MESSAGE = /\bno (?:video|media)\b|\bis not a video\b/i;

/**
 * What one run of yt-dlp came to: the file it wrote, or why there is none.
 *
 * "yt-dlp found no video" was written for every failure, and it was the
 * wrong thing to tell someone whose two-hour video was refused for its size
 * or cut off by the timeout. Each reason now says what happened, and the
 * cache keeps it, so the card's diagnosis names it too.
 */
export function classifyYtdlp(exit: ProcessExit, request: YtdlpRequest): YtdlpOutcome {
  if (exit.timedOut) return { failed: TIMED_OUT };

  // A post with several videos can refuse one and still deliver another,
  // and a delivered file is the answer whatever else went wrong.
  const file = printedFile(exit.stdout, request.dir);
  if (file) return { file };

  const refused = /does not pass filter \((.*)\), skipping/.exec(exit.stdout);
  if (refused) {
    const maxSeconds = durationCap(request.maxSeconds);
    return refused[1].includes("duration") && maxSeconds !== null
      ? { failed: `too long (over ${maxSeconds} seconds)` }
      : { failed: `too large (over ${Math.floor(request.maxBytes)} bytes)` };
  }

  const aborted = /File is larger than max-filesize \((\d+) bytes/.exec(exit.stdout);
  if (aborted) return { failed: `too large (${aborted[1]} bytes)` };

  // Finished cleanly with nothing to show: the post held nothing to download.
  if (exit.code === 0) return { failed: NO_VIDEO };

  const message = lastError(exit.stderr);
  if (/Requested format is not available/i.test(message)) {
    // Every format with sound came as separate streams, and only ffmpeg can
    // join them. On a device without it that is a fact about the device.
    return { failed: request.ffmpeg ? NO_FORMAT : NEEDS_FFMPEG };
  }
  if (NO_VIDEO_MESSAGE.test(message)) return { failed: NO_VIDEO };
  if (message) return { failed: `yt-dlp: ${message}` };
  return {
    failed: exit.code === null ? "yt-dlp did not run" : `yt-dlp exited with code ${exit.code}`,
  };
}
