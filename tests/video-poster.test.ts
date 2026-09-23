import { describe, expect, it } from "vitest";
import { MediaCache } from "../src/core/cache";
import {
  FFMPEG_POSTER_FAILED,
  PHONE_POSTER_FAILED,
  WEBVIEW_POSTER_FAILED,
  posterFailure,
  posterRoutes,
  retriesPoster,
} from "../src/core/poster-route";
import type { PosterDevice, PosterRoute } from "../src/core/poster-route";

const PHONE: PosterDevice = { desktop: false, ffmpeg: false };
const BARE_DESKTOP: PosterDevice = { desktop: true, ffmpeg: false };
const MAC: PosterDevice = { desktop: true, ffmpeg: true };

const FILE = "Attachments/Goko/5c2e9a0b7d41-video.mp4";
const KEY = "ytdlp:https://www.instagram.com/reel/Qm8vT2kLp4Z/";

function cacheWithVideo(thumbFailed?: string): MediaCache {
  const cache = new MediaCache();
  cache.set({ key: KEY, file: FILE, thumb: "", kind: "video", width: 0, height: 0, bytes: 2048 });
  if (thumbFailed) cache.setThumbFailed(KEY, thumbFailed);
  return cache;
}

/** What the vault carries to the next device: the cache, through its JSON. */
function synced(cache: MediaCache): MediaCache {
  return MediaCache.fromJSON(JSON.parse(JSON.stringify(cache)));
}

/**
 * One background pass over the video, the way deriveAssets makes it: asked
 * about only when retriesPoster allows, every route this device has tried in
 * order, and whatever posterFailure says written down. Returns whether the
 * pass asked at all.
 */
function pass(
  cache: MediaCache,
  device: PosterDevice,
  reads: Partial<Record<PosterRoute, boolean>> = {}
): boolean {
  const entry = cache.get(KEY)!;
  if (entry.thumb) return false;
  if (entry.thumbFailed && !retriesPoster(entry.thumbFailed, device)) return false;

  const tried: PosterRoute[] = [];
  for (const route of posterRoutes(device)) {
    tried.push(route);
    if (reads[route]) {
      cache.setThumb(KEY, FILE.replace(/\.mp4$/, ".poster.webp"), 720, 1280);
      return true;
    }
  }
  const failure = posterFailure(tried, device);
  if (failure) cache.setThumbFailed(KEY, failure);
  return true;
}

describe("posterRoutes", () => {
  it("asks the webview first and ffmpeg behind it on a desktop that has ffmpeg", () => {
    expect(posterRoutes(MAC)).toEqual(["webview", "tool"]);
  });

  it("has only the webview on a phone, and on a desktop without ffmpeg", () => {
    expect(posterRoutes(PHONE)).toEqual(["webview"]);
    expect(posterRoutes(BARE_DESKTOP)).toEqual(["webview"]);
  });
});

describe("posterFailure", () => {
  it("writes a phone's failure under the phone's name, not as a verdict on the file", () => {
    const failure = posterFailure(["webview"], PHONE);
    expect(failure).toBe(PHONE_POSTER_FAILED);
    expect(retriesPoster(failure!, MAC)).toBe(true);
    expect(retriesPoster(failure!, BARE_DESKTOP)).toBe(true);
  });

  it("writes a desktop webview's failure without ffmpeg as one only ffmpeg looks at again", () => {
    const failure = posterFailure(["webview"], BARE_DESKTOP);
    expect(failure).toBe(WEBVIEW_POSTER_FAILED);
    expect(retriesPoster(failure!, MAC)).toBe(true);
    expect(retriesPoster(failure!, BARE_DESKTOP)).toBe(false);
    expect(retriesPoster(failure!, PHONE)).toBe(false);
  });

  it("writes a failure after ffmpeg ran as final, on every device", () => {
    const failure = posterFailure(["webview", "tool"], MAC);
    expect(failure).toBe(FFMPEG_POSTER_FAILED);
    for (const device of [PHONE, BARE_DESKTOP, MAC]) {
      expect(retriesPoster(failure!, device)).toBe(false);
    }
  });

  it("counts ffmpeg alone as having looked at the file", () => {
    expect(posterFailure(["tool"], MAC)).toBe(FFMPEG_POSTER_FAILED);
  });

  it("writes nothing when no route could run", () => {
    expect(posterFailure([], MAC)).toBeNull();
    expect(posterFailure([], PHONE)).toBeNull();
  });
});

describe("retriesPoster", () => {
  it("asks about a video with no failure on every device", () => {
    for (const device of [PHONE, BARE_DESKTOP, MAC]) {
      expect(retriesPoster(undefined, device)).toBe(true);
    }
  });

  it("does not have a phone repeat its own failure on every launch", () => {
    expect(retriesPoster(PHONE_POSTER_FAILED, PHONE)).toBe(false);
  });

  it("leaves a reason it does not know alone", () => {
    expect(retriesPoster("some reason from a later version", MAC)).toBe(false);
  });
});

describe("a poster failure a phone wrote, carried to a Mac", () => {
  it("is tried again on the Mac, which renders the poster and its size", () => {
    const phone = cacheWithVideo();
    expect(pass(phone, PHONE)).toBe(true);
    expect(phone.get(KEY)?.thumbFailed).toBe(PHONE_POSTER_FAILED);
    // The phone does not pay for it again on its next pass.
    expect(pass(phone, PHONE)).toBe(false);

    const mac = synced(phone);
    expect(pass(mac, MAC, { webview: true })).toBe(true);
    const entry = mac.get(KEY)!;
    expect(entry.thumb).toBe("Attachments/Goko/5c2e9a0b7d41-video.poster.webp");
    expect(entry.thumbFailed).toBeUndefined();
    expect([entry.width, entry.height]).toEqual([720, 1280]);
  });

  it("gets its poster from ffmpeg when the Mac's webview cannot read it either", () => {
    const mac = synced(cacheWithVideo(PHONE_POSTER_FAILED));
    expect(pass(mac, MAC, { webview: false, tool: true })).toBe(true);
    expect(mac.get(KEY)?.thumb).not.toBe("");
  });
});

describe("a render failure written before routes were told apart", () => {
  it("is read as a phone's, whatever wrote it", () => {
    expect(PHONE_POSTER_FAILED).toBe("render failed");
  });

  it("is tried once on a desktop with ffmpeg, not on every pass, when the file is truly broken", () => {
    const mac = synced(cacheWithVideo("render failed"));
    let asked = 0;
    for (let i = 0; i < 5; i++) if (pass(mac, MAC)) asked++;
    expect(asked).toBe(1);
    expect(mac.get(KEY)?.thumbFailed).toBe(FFMPEG_POSTER_FAILED);
  });

  it("is tried at most once by each kind of device on its way to a final answer", () => {
    let cache = cacheWithVideo("render failed");
    const asked: string[] = [];
    for (const [name, device] of [
      ["phone", PHONE],
      ["bare desktop", BARE_DESKTOP],
      ["bare desktop", BARE_DESKTOP],
      ["mac", MAC],
      ["mac", MAC],
      ["phone", PHONE],
    ] as const) {
      cache = synced(cache);
      if (pass(cache, device)) asked.push(name);
    }
    expect(asked).toEqual(["bare desktop", "mac"]);
    expect(cache.get(KEY)?.thumbFailed).toBe(FFMPEG_POSTER_FAILED);
  });

  it("is cleared with every other mark by the archive-everything command", () => {
    const cache = cacheWithVideo(FFMPEG_POSTER_FAILED);
    cache.clearThumbFailures();
    expect(pass(cache, MAC, { webview: true })).toBe(true);
    expect(cache.get(KEY)?.thumb).not.toBe("");
  });
});
