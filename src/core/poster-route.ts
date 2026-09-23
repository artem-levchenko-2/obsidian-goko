/**
 * How a video gets the still its tile shows until it plays, and what a
 * failure to make one is allowed to say.
 *
 * Two routes, as for a preview. The webview draws a frame out of a <video>:
 * in process, a fraction of a second on a desktop, and the only route a
 * phone has. ffmpeg reads one out of the file itself, and runs only on a
 * desktop that has it installed.
 *
 * The cache travels with the vault, so a failure written down on one device
 * is believed on every other. A phone's webview that could not give a frame
 * says something about that webview, not about the file, and was once
 * enough to stop every desktop sharing the vault from ever trying. So each
 * failure is written under the name of what tried, and a device asks again
 * only about a failure something weaker than itself recorded. Every retry
 * ends in a poster or in a failure of its own, under a stronger name, so no
 * file is asked about forever. Pure: the shell draws the frame and runs
 * ffmpeg, this decides which of those to try and what the outcome means.
 */

export type PosterRoute = "webview" | "tool";

export interface PosterDevice {
  /** A desktop app, whose webview is Chromium rather than a phone's. */
  desktop: boolean;
  /** ffmpeg is installed and can run here. False on every phone. */
  ffmpeg: boolean;
}

/**
 * A phone's webview could not give a frame. Also every failed render from
 * before routes were told apart, which is mostly what a phone wrote: the
 * same words, so a vault that already holds them is read the same way.
 */
export const PHONE_POSTER_FAILED = "render failed";

/** A desktop's webview could not give a frame, and there was no ffmpeg to ask. */
export const WEBVIEW_POSTER_FAILED = "render failed on a desktop without ffmpeg";

/** ffmpeg ran and could not read a frame out of the file either. */
export const FFMPEG_POSTER_FAILED = "ffmpeg could not read a frame";

/**
 * The routes to try for one video, in order; the first to give a frame wins.
 *
 * The webview first, because on a desktop it answers at once and reads every
 * video a tile can play anyway. ffmpeg behind it, for what the webview could
 * not decode and for a phone's failure being looked at again.
 */
export function posterRoutes(device: PosterDevice): PosterRoute[] {
  return device.ffmpeg ? ["webview", "tool"] : ["webview"];
}

/**
 * What to write down once every route tried has failed: the name of the
 * strongest thing that tried, or null when nothing could run at all. Only
 * ffmpeg having run says anything about the file itself.
 */
export function posterFailure(
  tried: readonly PosterRoute[],
  device: PosterDevice
): string | null {
  if (tried.includes("tool")) return FFMPEG_POSTER_FAILED;
  if (!tried.includes("webview")) return null;
  return device.desktop ? WEBVIEW_POSTER_FAILED : PHONE_POSTER_FAILED;
}

/**
 * Whether this device tries again for a video whose poster failed before.
 *
 * A phone's failure is tried again by any desktop, whose webview reads what
 * a phone's could not; a desktop webview's only by a device with ffmpeg.
 * ffmpeg's own verdict stands, and so does a reason this version does not
 * know. The explicit archive-everything command clears all of them.
 */
export function retriesPoster(failure: string | undefined, device: PosterDevice): boolean {
  if (!failure) return true;
  if (failure === PHONE_POSTER_FAILED) return device.desktop;
  if (failure === WEBVIEW_POSTER_FAILED) return device.ffmpeg;
  return false;
}
