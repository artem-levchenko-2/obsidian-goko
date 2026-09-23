import { describe, expect, it } from "vitest";
import { parseFxTweet } from "../src/core/resolve";

// X converts every uploaded GIF to an MP4 and fxtwitter reports it as a video
// entry typed "gif", listed under both `videos` and `all`.
const GIF = {
  type: "gif",
  url: "https://video.twimg.com/tweet_video/Qm7vT2xWkLp9aZr.mp4",
  thumbnail_url: "https://pbs.twimg.com/tweet_video_thumb/Qm7vT2xWkLp9aZr.jpg",
  width: 480,
  height: 270,
  format: "video/mp4",
};

const tweet = {
  url: "https://x.com/gk_fixture_01/status/1834567012345678901",
  text: "A loop that never ends",
  created_at: "Tue Sep 22 10:00:00 +0000 2026",
  author: { name: "Fixture Account" },
};

describe("parseFxTweet with a GIF", () => {
  it("files a GIF listed only under all as a video", () => {
    const payload = { tweet: { ...tweet, media: { all: [GIF] } } };
    const out = parseFxTweet(payload, "")!;
    expect(out.media).toEqual([{ url: GIF.url, kind: "video" }]);
  });

  it("files a GIF listed under videos and all as one video", () => {
    const payload = { tweet: { ...tweet, media: { videos: [GIF], all: [GIF] } } };
    const out = parseFxTweet(payload, "")!;
    expect(out.media).toEqual([{ url: GIF.url, kind: "video" }]);
  });

  it("leaves photos and videos as they were", () => {
    const photo = {
      type: "photo",
      url: "https://pbs.twimg.com/media/Hx3kR9vQaZ2mLpT.jpg",
      width: 1200,
      height: 900,
    };
    const video = {
      type: "video",
      url: "https://video.twimg.com/amplify_video/1834567012345678902/vid/avc1/1280x720/Tq8Wm2Zp4LxRk7Vn.mp4?tag=16",
      thumbnail_url: "https://pbs.twimg.com/amplify_video_thumb/1834567012345678902/img/Jd5nC8wYp3QfEu1s.jpg",
      width: 1280,
      height: 720,
      format: "video/mp4",
    };
    const payload = {
      tweet: { ...tweet, media: { photos: [photo], videos: [video], all: [photo, video] } },
    };
    const out = parseFxTweet(payload, "")!;
    expect(out.media).toEqual([
      { url: video.url, kind: "video" },
      { url: photo.url, kind: "image" },
    ]);
  });
});
