import { describe, expect, it } from "vitest";
import { MediaCache } from "../src/core/cache";
import { knownHostThumbnail } from "../src/core/page-cover";
import { supportsSourceDownload } from "../src/core/resolve";
import { scanClipping } from "../src/core/scan";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import { buildTiles, showsPlayMark } from "../src/core/tile";
import {
  YOUTUBE_HOSTS,
  classifyYoutube,
  downloadsYoutubeVideo,
  watchedOnYoutube,
  youtubeDurationCap,
} from "../src/core/youtube";
import { formatSelector, ytdlpArgs } from "../src/core/ytdlp";

// Invented ids of the real shape: 11 characters of base64url.
const VIDEO = "Hn4pRs9W-Yc";
const SHORT = "Vt7kLm2Qx_a";

const WATCH = `https://www.youtube.com/watch?v=${VIDEO}`;
const SHORT_URL = `https://www.youtube.com/shorts/${SHORT}`;
const MUSIC = `https://music.youtube.com/watch?v=${VIDEO}&si=Tq8wErT5yUi0oP3a`;

describe("classifyYoutube", () => {
  it("reads every address an ordinary video is shared by as the same video", () => {
    const addresses = [
      WATCH,
      `https://youtube.com/watch?v=${VIDEO}`,
      `https://m.youtube.com/watch?v=${VIDEO}`,
      `https://www.youtube.com/watch?v=${VIDEO}&t=42s&list=PLa1b2c3d4`,
      `https://youtu.be/${VIDEO}`,
      `https://youtu.be/${VIDEO}?si=Tq8wErT5yUi0oP3a`,
      `https://youtu.be/${VIDEO}?t=97`,
      `https://www.youtube.com/live/${VIDEO}`,
      `https://www.youtube.com/live/${VIDEO}?si=Tq8wErT5yUi0oP3a`,
      `https://www.youtube.com/embed/${VIDEO}`,
      `https://www.youtube-nocookie.com/embed/${VIDEO}`,
      `https://www.youtube.com/v/${VIDEO}`,
    ];
    for (const address of addresses) {
      expect(classifyYoutube(address), address).toEqual({ kind: "video", id: VIDEO });
    }
  });

  it("tells a Short from a video, on the desktop host and the mobile one", () => {
    for (const address of [
      SHORT_URL,
      `https://youtube.com/shorts/${SHORT}`,
      `https://m.youtube.com/shorts/${SHORT}`,
      `https://www.youtube.com/shorts/${SHORT}?si=Tq8wErT5yUi0oP3a`,
      `https://www.youtube.com/shorts/${SHORT}/`,
    ]) {
      expect(classifyYoutube(address), address).toEqual({ kind: "short", id: SHORT });
    }
  });

  it("reads YouTube Music as music", () => {
    expect(classifyYoutube(MUSIC)).toEqual({ kind: "music", id: VIDEO });
  });

  it("says nothing of a YouTube page that names no video", () => {
    expect(classifyYoutube("https://www.youtube.com/feed/subscriptions")).toBeNull();
    expect(classifyYoutube("https://www.youtube.com/@somechannel")).toBeNull();
    expect(classifyYoutube("https://www.youtube.com/playlist?list=PLa1b2c3d4")).toBeNull();
    expect(classifyYoutube("https://youtu.be/")).toBeNull();
  });

  it("rejects an id of the wrong shape", () => {
    expect(classifyYoutube("https://youtu.be/toolongtobeavalidyoutubeid123")).toBeNull();
    expect(classifyYoutube("https://www.youtube.com/watch?v=short")).toBeNull();
  });

  it("says nothing of another host or of something that is not a URL", () => {
    expect(classifyYoutube(`https://vimeo.com/watch?v=${VIDEO}`)).toBeNull();
    expect(classifyYoutube(`https://notyoutube.com/shorts/${SHORT}`)).toBeNull();
    expect(classifyYoutube("not a url")).toBeNull();
  });

  it("keeps every host in the one list, the mobile site and the short links included", () => {
    for (const host of ["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "youtu.be"]) {
      expect(YOUTUBE_HOSTS.has(host), host).toBe(true);
    }
  });
});

describe("the cover of a YouTube link", () => {
  it("gives a Short its vertical cover, with the landscape sizes behind it", () => {
    expect(knownHostThumbnail(SHORT_URL)).toEqual({
      url: `https://img.youtube.com/vi/${SHORT}/oar2.jpg`,
      fallbacks: [
        `https://img.youtube.com/vi/${SHORT}/hq720.jpg`,
        `https://img.youtube.com/vi/${SHORT}/hqdefault.jpg`,
      ],
    });
    expect(knownHostThumbnail(`https://m.youtube.com/shorts/${SHORT}`)?.url).toBe(
      `https://img.youtube.com/vi/${SHORT}/oar2.jpg`
    );
  });

  it("gives an ordinary video the covers it always had, whatever the address", () => {
    const expected = {
      url: `https://img.youtube.com/vi/${VIDEO}/maxresdefault.jpg`,
      fallbacks: [
        `https://img.youtube.com/vi/${VIDEO}/hq720.jpg`,
        `https://img.youtube.com/vi/${VIDEO}/hqdefault.jpg`,
      ],
    };
    expect(knownHostThumbnail(WATCH)).toEqual(expected);
    expect(knownHostThumbnail(`https://m.youtube.com/watch?v=${VIDEO}`)).toEqual(expected);
    expect(knownHostThumbnail(`https://youtu.be/${VIDEO}?si=Tq8wErT5yUi0oP3a`)).toEqual(expected);
    expect(knownHostThumbnail(MUSIC)).toEqual(expected);
  });

  it("puts a Short on the wall as its vertical cover before anything is archived", () => {
    const record = scanClipping("Clippings/S.md", { title: "S", source: SHORT_URL }, "");
    const [tile] = buildTiles([record], new MediaCache());
    expect(tile.filePath).toBe(`https://img.youtube.com/vi/${SHORT}/oar2.jpg`);
  });
});

describe("whether a YouTube link's video is downloaded", () => {
  it("downloads a Short whatever the setting says", () => {
    expect(supportsSourceDownload(SHORT_URL)).toBe(true);
    expect(supportsSourceDownload(SHORT_URL, { youtubeVideoMinutes: 0 })).toBe(true);
    expect(supportsSourceDownload(SHORT_URL, { youtubeVideoMinutes: 5 })).toBe(true);
  });

  it("downloads a Short shared from the mobile site too", () => {
    expect(supportsSourceDownload(`https://m.youtube.com/shorts/${SHORT}`)).toBe(true);
  });

  it("keeps an ordinary video as its cover unless the setting asks for it", () => {
    for (const address of [
      WATCH,
      `https://m.youtube.com/watch?v=${VIDEO}`,
      `https://youtu.be/${VIDEO}?si=Tq8wErT5yUi0oP3a`,
      `https://www.youtube.com/live/${VIDEO}`,
    ]) {
      expect(supportsSourceDownload(address), address).toBe(false);
      expect(supportsSourceDownload(address, { youtubeVideoMinutes: 0 }), address).toBe(false);
      expect(supportsSourceDownload(address, { youtubeVideoMinutes: 5 }), address).toBe(true);
    }
  });

  it("never downloads YouTube Music", () => {
    expect(supportsSourceDownload(MUSIC)).toBe(false);
    expect(supportsSourceDownload(MUSIC, { youtubeVideoMinutes: 5 })).toBe(false);
  });

  it("never runs yt-dlp on a YouTube page that names no video", () => {
    expect(supportsSourceDownload("https://www.youtube.com/@somechannel", { youtubeVideoMinutes: 5 })).toBe(false);
  });

  it("leaves every other host as it was", () => {
    expect(supportsSourceDownload("https://www.instagram.com/reel/Cq1Wx2Ey3Rz/")).toBe(true);
    expect(supportsSourceDownload("https://www.polygon.com/article", { youtubeVideoMinutes: 5 })).toBe(false);
  });

  it("is off by default", () => {
    expect(DEFAULT_SETTINGS.youtubeVideoMinutes).toBe(0);
    expect(downloadsYoutubeVideo(WATCH, DEFAULT_SETTINGS.youtubeVideoMinutes)).toBe(false);
  });

  it("treats nonsense in the setting as off", () => {
    expect(downloadsYoutubeVideo(WATCH, -3)).toBe(false);
    expect(downloadsYoutubeVideo(WATCH, Number.NaN)).toBe(false);
  });
});

describe("youtubeDurationCap", () => {
  it("holds an ordinary video to the setting's length, in seconds", () => {
    expect(youtubeDurationCap(WATCH, 5)).toBe(300);
    expect(youtubeDurationCap(`https://youtu.be/${VIDEO}`, 2.5)).toBe(150);
  });

  it("puts no cap on a Short, on another host, or while the setting is off", () => {
    expect(youtubeDurationCap(SHORT_URL, 5)).toBeUndefined();
    expect(youtubeDurationCap("https://x.com/someone/status/1234567890123456789", 5)).toBeUndefined();
    expect(youtubeDurationCap(WATCH, 0)).toBeUndefined();
  });
});

describe("the yt-dlp format for a YouTube link", () => {
  const PAIR = "bv*[ext=mp4][vcodec^=avc1][height<=1280]+ba[ext=m4a]";

  function selector(url: string, ffmpeg: string | null = "/opt/homebrew/bin/ffmpeg"): string {
    const args = ytdlpArgs({ url, dir: "/tmp/goko-Rb5Nq8", maxBytes: 26214400, ffmpeg });
    return args[args.indexOf("-f") + 1];
  }

  it("asks a Short for the joined 720p pair before the 360p file", () => {
    const choices = selector(SHORT_URL).split("/");
    expect(choices[0]).toBe(PAIR);
    expect(choices[1]).toBe("best[ext=mp4][acodec!=none][vcodec^=avc1][height<=1280]");
    expect(choices.filter((choice) => choice === PAIR)).toHaveLength(1);
    expect(selector(`https://m.youtube.com/shorts/${SHORT}`).split("/")[0]).toBe(PAIR);
  });

  it("joins nothing for a Short on a device without ffmpeg", () => {
    expect(selector(SHORT_URL, null)).toBe(formatSelector(false));
    expect(selector(SHORT_URL, null)).not.toContain("+");
  });

  it("keeps the 360p file first for an ordinary video, which is what fits the size cap", () => {
    expect(selector(WATCH)).toBe(formatSelector(true));
    expect(selector(WATCH).split("/")[0]).not.toBe(PAIR);
  });

  it("leaves the other platforms' selector as it was", () => {
    for (const url of [
      "https://www.instagram.com/reel/Cq1Wx2Ey3Rz/",
      "https://x.com/someone/status/1234567890123456789",
      "https://www.tiktok.com/@someone/video/7234567890123456789",
    ]) {
      expect(selector(url), url).toBe(formatSelector(true));
    }
  });
});

describe("watchedOnYoutube and the play mark", () => {
  it("is true of a video or a song, not of a Short or another host", () => {
    expect(watchedOnYoutube(WATCH)).toBe(true);
    expect(watchedOnYoutube(`https://youtu.be/${VIDEO}?si=Tq8wErT5yUi0oP3a`)).toBe(true);
    expect(watchedOnYoutube(MUSIC)).toBe(true);
    expect(watchedOnYoutube(SHORT_URL)).toBe(false);
    expect(watchedOnYoutube("https://www.youtube.com/@somechannel")).toBe(false);
    expect(watchedOnYoutube("https://www.polygon.com/article")).toBe(false);
    expect(watchedOnYoutube("")).toBe(false);
  });

  const tileFor = (source: string, body = "") =>
    buildTiles([scanClipping("Clippings/T.md", { title: "T", source }, body)], new MediaCache())[0];

  it("marks the cover of an ordinary YouTube video as something that plays", () => {
    const tile = tileFor(WATCH);
    expect(tile.kind).toBe("image");
    expect(showsPlayMark(tile)).toBe(true);
  });

  it("marks a downloaded clip, as it always has", () => {
    const cache = new MediaCache();
    cache.set({
      key: `ytdlp:${SHORT_URL}`,
      file: "Attachments/Clippings/a1b2c3d4e5f6-video.mp4",
      thumb: "",
      kind: "video",
      width: 720,
      height: 1280,
      bytes: 1,
    });
    const record = scanClipping("Clippings/S.md", { title: "S", source: SHORT_URL }, "");
    const [tile] = buildTiles([record], cache);
    expect(tile.kind).toBe("video");
    expect(showsPlayMark(tile)).toBe(true);
  });

  it("leaves a Short's still, an ordinary picture and a card of words unmarked", () => {
    expect(showsPlayMark(tileFor(SHORT_URL))).toBe(false);
    expect(
      showsPlayMark(tileFor("https://www.polygon.com/article", "![](https://example.com/a.jpg)"))
    ).toBe(false);
    const note = tileFor("", "Just words.");
    expect(note.kind).toBe("note");
    expect(showsPlayMark(note)).toBe(false);
  });
});
