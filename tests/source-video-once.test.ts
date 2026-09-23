import { describe, expect, it } from "vitest";
import { archiveFilename, sourceVideoCandidates } from "../src/core/archive";
import { MediaCache } from "../src/core/cache";
import { normalizeUrl, sourceVideoKeyFor } from "../src/core/normalize";
import { buildNote, parseFxTweet } from "../src/core/resolve";
import { scanClipping, splitFrontmatter } from "../src/core/scan";
import type { MediaRef } from "../src/core/scan";
import { ownVideo } from "../src/core/source-video";

const FOLDER = "Attachments/Goko";
const X_POST = "https://x.com/gk_fixture_02/status/1845678901234567890";
const REEL = "https://www.instagram.com/reel/Fx7kQ2mLp9Z/";

const X_VIDEO = {
  type: "video",
  url: "https://video.twimg.com/amplify_video/1845678901234567891/vid/avc1/720x1280/Wm3Zq8Tp2LxRk5Vn.mp4?tag=14",
  thumbnail_url:
    "https://pbs.twimg.com/amplify_video_thumb/1845678901234567891/img/Jd4nC7wYp2QfEu9s.jpg",
  width: 720,
  height: 1280,
  format: "video/mp4",
};

const X_PHOTO = {
  type: "photo",
  url: "https://pbs.twimg.com/media/Hx4kR8vQaZ3mLpT.jpg",
  width: 1200,
  height: 900,
};

function fxPayload(media: Record<string, unknown>): unknown {
  return {
    tweet: {
      url: X_POST,
      text: "A clip worth keeping",
      created_at: "Tue Sep 22 10:00:00 +0000 2026",
      author: { name: "Fixture Account" },
      media,
    },
  };
}

function lookup(cache: MediaCache): (key: string) => string | undefined {
  return (key) => cache.get(key)?.file || undefined;
}

function record(source: string, media: MediaRef[]): { source: string; media: MediaRef[] } {
  return { source, media };
}

const video = (url: string): MediaRef => ({ url, kind: "video", alt: "" });
const image = (url: string): MediaRef => ({ url, kind: "image", alt: "" });

describe("ownVideo after an X post is clipped", () => {
  it("finds the fxtwitter video the note embeds, so yt-dlp is not needed", () => {
    // What capture does: fxtwitter's mp4 is archived as ordinary media, and
    // the note embeds the file it landed in.
    const link = parseFxTweet(fxPayload({ videos: [X_VIDEO], all: [X_VIDEO] }), X_POST)!;
    expect(link.media).toEqual([{ url: X_VIDEO.url, kind: "video" }]);

    const cache = new MediaCache();
    const file = `${FOLDER}/${archiveFilename({ key: "", url: X_VIDEO.url, kind: "video", alt: "" })}`;
    cache.mergeOutcome({ key: normalizeUrl(X_VIDEO.url), kind: "video", file, bytes: 1024 });

    const note = buildNote({
      ...link,
      media: link.media.map((item) => ({ ...item, localPath: file })),
    });
    const clip = scanClipping("Clippings/post.md", { source: link.url }, splitFrontmatter(note).rest);

    expect(ownVideo(clip, lookup(cache))).toEqual({ key: file, file, embedded: true });
  });

  it("counts an embedded video the cache has never heard of", () => {
    // Clipped on another device, whose cache entry this one never saw.
    const file = `${FOLDER}/Wm3Zq8Tp2LxRk5Vn.mp4`;
    expect(ownVideo(record(X_POST, [video(file)]), lookup(new MediaCache()))).toEqual({
      key: file,
      file,
      embedded: true,
    });
  });

  it("counts a remote video once the cache holds its file", () => {
    const cache = new MediaCache();
    const file = `${FOLDER}/Wm3Zq8Tp2LxRk5Vn.mp4`;
    cache.mergeOutcome({ key: normalizeUrl(X_VIDEO.url), kind: "video", file });
    expect(ownVideo(record(X_POST, [video(X_VIDEO.url)]), lookup(cache))).toEqual({
      key: normalizeUrl(X_VIDEO.url),
      file,
      embedded: false,
    });
  });
});

describe("ownVideo leaves the post's video to be looked for", () => {
  it("when all the clipping holds is a poster image", () => {
    const cache = new MediaCache();
    cache.mergeOutcome({
      key: normalizeUrl(X_VIDEO.thumbnail_url),
      kind: "image",
      file: `${FOLDER}/Jd4nC7wYp2QfEu9s.jpg`,
    });
    const clip = record(X_POST, [
      image(X_VIDEO.thumbnail_url),
      image(`${FOLDER}/Jd4nC7wYp2QfEu9s.jpg`),
    ]);
    expect(ownVideo(clip, lookup(cache))).toBeNull();
  });

  it("when the video's download failed and left no file", () => {
    const cache = new MediaCache();
    cache.mergeOutcome({ key: normalizeUrl(X_VIDEO.url), kind: "video", failed: "HTTP 403" });
    expect(ownVideo(record(X_POST, [video(X_VIDEO.url)]), lookup(cache))).toBeNull();
  });

  it("when the video is only a remote address nothing has fetched", () => {
    expect(ownVideo(record(X_POST, [video(X_VIDEO.url)]), lookup(new MediaCache()))).toBeNull();
  });

  it("for an X post with no video at all", () => {
    const link = parseFxTweet(fxPayload({ photos: [X_PHOTO], all: [X_PHOTO] }), X_POST)!;
    const cache = new MediaCache();
    cache.mergeOutcome({
      key: normalizeUrl(X_PHOTO.url),
      kind: "image",
      file: `${FOLDER}/Hx4kR8vQaZ3mLpT.jpg`,
    });
    const note = buildNote({
      ...link,
      media: link.media.map((item) => ({ ...item, localPath: `${FOLDER}/Hx4kR8vQaZ3mLpT.jpg` })),
    });
    const clip = scanClipping("Clippings/post.md", { source: link.url }, splitFrontmatter(note).rest);
    expect(ownVideo(clip, lookup(cache))).toBeNull();
    expect(ownVideo(record(X_POST, []), lookup(cache))).toBeNull();
  });

  it("for a reel whose video already fills the yt-dlp slot", () => {
    // The page's own video lands in the slot and the note embeds it there.
    // Finding it stays the source-video route's job, exactly as before, so a
    // device whose cache lacks it still adopts it by name.
    const key = sourceVideoKeyFor(REEL);
    const [slot] = sourceVideoCandidates(key, FOLDER);
    const cache = new MediaCache();
    cache.mergeOutcome({ key, kind: "video", file: slot });
    const clip = record(REEL, [video(slot), image(`${FOLDER}/Kp2mQ9xWvL4tRz8.jpg`)]);

    expect(ownVideo(clip, lookup(cache))).toBeNull();
    expect(ownVideo(clip, lookup(new MediaCache()))).toBeNull();
  });

  it("for the slot however the note links to it", () => {
    const key = sourceVideoKeyFor(REEL);
    const name = sourceVideoCandidates(key, "").map((path) => path.slice(1));
    expect(ownVideo(record(REEL, [video(name[0])]), lookup(new MediaCache()))).toBeNull();
    expect(
      ownVideo(record(REEL, [video(`Old folder/${name[1]}`)]), lookup(new MediaCache()))
    ).toBeNull();
  });
});
