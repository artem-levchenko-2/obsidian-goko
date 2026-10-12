import { DOWNLOAD_TIMEOUT_MS, TIMED_OUT } from "./ytdlp";

/**
 * Why a post's own video did not make it into the vault, worded for a toast.
 *
 * The cache keeps the reason for every failed download, but nobody reads the
 * cache, and most reasons are not worth a word anyway: a carousel of photos
 * has no video to find, and a phone has no yt-dlp. These three are
 * different, because each has something the person can do about it and each
 * otherwise looks exactly like a post with no video.
 */

export type VideoProblemKind = "refused" | "timed-out" | "too-large";

export interface VideoProblem {
  kind: VideoProblemKind;
  /** The page the video was fetched from. */
  source: string;
  /** The clipping's title, "" when no note exists yet. */
  title: string;
  /** How big the video is, for too-large, when anything said so. */
  bytes?: number;
}

/**
 * The problem a recorded failure is, or null when it is not one worth
 * telling. A 403 is the site turning yt-dlp away, which in practice means the
 * site changed and the installed yt-dlp has not caught up; only yt-dlp's own
 * 403 counts, since a CDN refusing a plain request is not fixed by updating
 * anything. A duration over the YouTube setting is not here either: keeping
 * the cover of a long video is what that setting asks for.
 */
export function videoProblem(failed: string): Pick<VideoProblem, "kind" | "bytes"> | null {
  if (failed === TIMED_OUT) return { kind: "timed-out" };
  if (failed.startsWith("yt-dlp:") && /HTTP Error 403\b/i.test(failed)) return { kind: "refused" };
  // "too large (N bytes)" knows the size; "too large (over N bytes)" was
  // refused on the site's own figure and quotes the limit instead.
  const size = /^too large \((over )?(\d+) bytes\)$/.exec(failed);
  if (size) return size[1] ? { kind: "too-large" } : { kind: "too-large", bytes: Number(size[2]) };
  return null;
}

const TITLE_LENGTH = 40;
const ARCHIVE_ALL = '"Download all clipping media" in Search';

/**
 * One message per kind of problem, so a pass over a whole library says each
 * thing once instead of stacking a toast per clipping.
 */
export function describeVideoProblems(problems: VideoProblem[], maxBytes: number): string[] {
  const messages: string[] = [];

  const refused = problems.filter((p) => p.kind === "refused");
  if (refused.length > 0) {
    // The site leads the sentence, so the subject never names it again.
    messages.push(
      `Goko: ${sitesOf(refused)} refused to let yt-dlp download ${subject(refused, false)}. ` +
        `yt-dlp is probably out of date: update it, then pick ${ARCHIVE_ALL}.`
    );
  }

  const timedOut = problems.filter((p) => p.kind === "timed-out");
  if (timedOut.length > 0) {
    messages.push(
      `Goko: gave up on ${subject(timedOut, true)}${pause(timedOut)} after ${duration(DOWNLOAD_TIMEOUT_MS)}. ` +
        `A long video can take longer than that to download, and ${ARCHIVE_ALL} tries again.`
    );
  }

  const tooLarge = problems.filter((p) => p.kind === "too-large");
  if (tooLarge.length > 0) {
    const several = tooLarge.length > 1;
    const bytes = tooLarge[0].bytes;
    const size = several ? "they're" : bytes !== undefined ? `at ${megabytes(bytes)} it's` : "it's";
    messages.push(
      `Goko: skipped ${subject(tooLarge, true)}${pause(tooLarge)} because ${size} over your ` +
        `${megabytes(maxBytes)} limit. To keep ${several ? "them" : "it"}, raise Maximum file size ` +
        `under Settings → Goko → Downloads, then pick ${ARCHIVE_ALL}.`
    );
  }

  return messages;
}

/** 'the video for "…"', or '2 videos, including "…"' when several share a message. */
function subject(problems: VideoProblem[], nameSite: boolean): string {
  const titled = problems.find((p) => p.title.trim());
  if (problems.length > 1) {
    return titled
      ? `${problems.length} videos, including ${quoted(titled.title)}`
      : `${problems.length} videos`;
  }
  if (titled) return `the video for ${quoted(titled.title)}`;
  const site = nameSite ? siteOf(problems[0].source) : "";
  return site ? `the video from ${site}` : "the video";
}

/** Closes the "including …" aside when a clause follows the subject. */
function pause(problems: VideoProblem[]): string {
  return problems.length > 1 && problems.some((p) => p.title.trim()) ? "," : "";
}

function quoted(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length <= TITLE_LENGTH) return `"${trimmed}"`;
  // Cut between words when there is a space to cut at, and trailing dots
  // go, so a title that already trails off does not end "..…".
  const cut = trimmed.slice(0, TITLE_LENGTH + 1);
  const space = cut.lastIndexOf(" ");
  const kept = space > 0 ? cut.slice(0, space) : cut.slice(0, TITLE_LENGTH);
  return `"${kept.replace(/[\s.…,;:]+$/, "")}…"`;
}

function siteOf(source: string): string {
  try {
    return new URL(source).hostname.replace(/^(www|m)\./, "");
  } catch {
    return "";
  }
}

function sitesOf(problems: VideoProblem[]): string {
  const sites = new Set(problems.map((p) => siteOf(p.source)));
  const [only] = sites;
  if (sites.size === 1) return only || "the site";
  return "the sites";
}

function megabytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1048576))} MB`;
}

function duration(ms: number): string {
  const minutes = ms / 60000;
  if (minutes >= 1 && Number.isInteger(minutes)) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${Math.round(ms / 1000)} seconds`;
}
