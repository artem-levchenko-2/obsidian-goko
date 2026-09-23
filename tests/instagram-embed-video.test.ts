import { describe, expect, it } from "vitest";
import { sourceVideoCandidates } from "../src/core/archive";
import { hashUrl } from "../src/core/hash";
import { sourceVideoKeyFor } from "../src/core/normalize";
import { placePageVideo } from "../src/core/page-video";
import { buildNote, parseInstagramEmbed } from "../src/core/resolve";
import { INSTAGRAM_CAROUSEL_EMBED, INSTAGRAM_REEL_EMBED } from "./fixtures/instagram";

/**
 * A URL as the embed writes it. The post's data is JSON inside a JSON string
 * inside a script, and Instagram escapes a slash at both levels and a
 * percent sign at the inner one, so https:// arrives as https:\\\/\\\/ and
 * %3D as \\u00253D.
 */
function embedded(url: string): string {
  return url.replace(/%/g, String.raw`\\u0025`).replace(/\//g, String.raw`\\\/`);
}

const POSTER =
  "https://scontent-abc1-1.cdninstagram.com/v/t51.82787-15/" +
  "613804275_17392046182735501_4820193617502846273_n.jpg" +
  "?stp=dst-jpg_e15_tt6&_nc_cat=101" +
  "&ig_cache_key=iyGlFQlTtyfZpPX0dGDgZ8FWqHTrjk1hvqDMu1NkjqIG.3-ccb7-5&ccb=7-5&_nc_sid=58cdad" +
  "&efg=eyJ2ZW5jb2RlX3RhZyI6IkNMSVBTLnhwaWRzLjEyMTcuc2RyLnZpZGVvX2RlZmF1bHRfY292ZXJfZnJhbWUuQzIifQ%3D%3D" +
  "&_nc_ohc=BcoRFtrsfaNsdnlyWWeBZBi" +
  "&_nc_oc=UNAljPbzmCuKkVgj_i7Lio1eqRmxrHvCJc3Rd8I6PLXrep-B5AMdwmGH2ZiO2CwOVbGLj6" +
  "&_nc_zt=23&_nc_ht=scontent-abc1-1.cdninstagram.com&_nc_gid=q1qgcnlH8vzUpiWtKs3K7C&_nc_ss=7c60f" +
  "&oh=00_AQlOvAJTJaOqAS1752KAqpbg8bmlY2C2WF6azok4-InEdS&oe=6AB90C1E";

const VIDEO =
  "https://scontent-abc1-1.cdninstagram.com/o1/v/t2/f2/m86/" +
  "AQMwpzq5u9vDAOn0s8Ou0tAx8YsdlvtTZVOKdSMKN3SCjtm1BeaBRyEN8EwAv42NdSsw4QEDLUBZHp_FXTZGpRW1Wa1UdkUbUxBifJpzR.mp4" +
  "?_nc_cat=106&_nc_sid=5e9851&_nc_ht=scontent-abc1-1.cdninstagram.com&_nc_ohc=l54QbnwF7LpEYryGnMgAPok" +
  "&efg=eyJ2ZW5jb2RlX3RhZyI6Inhwdl9wcm9ncmVzc2l2ZS5JTlNUQUdSQU0uQ0xJUFMuQzIuNzIwLmRhc2hfYmFzZWxpbmVfMV92MSIsInhwdl9hc3NldF9pZCI6MTA3MzAyMTkwMTA0NjQ1NiwiYXNzZXRfYWdlX2RheXMiOjMsInZpX3VzZWNhc2VfaWQiOjEwMDk5LCJkdXJhdGlvbl9zIjo0MSwidXJsZ2VuX3NvdXJjZSI6Ind3dyJ9" +
  "&ccb=17-1&vs=dc45601a208cf957" +
  "&_nc_vs=FevTC5PVU4BJk_FYGczWjpxzHXmGN9do2b71hVAf8O_TBOl8Y6zU2QrTY-vHRDcGTM0dDmg7uZx1RjGeKz0jeXkbyJUGoGsYBCfuT64WLlZ75lWYBI5csECWU3Ho7cfBe_TwoSCloFqlAjfKFBaH4ih-2lxWkrcaU0mS-lwviz0uV657Hnie" +
  "&_nc_gid=q1qgcnlH8vzUpiWtKs3K7C&_nc_ss=7c60f&_nc_zt=28" +
  "&oh=00_AQ0iAqSoP76bPPekWYlWjsYUmcW5Qkbbvh6oR_rM18xcLs&oe=6AB3D2F7";

/**
 * The page Instagram serves at /p/<code>/embed/captioned/ for a reel, cut
 * down to the script that carries the post and to the fields of the post
 * worth having. The wrapping is as it arrives today — a ServerJS payload
 * whose contextJSON is a string of escaped JSON — and `video_url` sits last
 * in the post, where the live page puts it when it sends one at all.
 */
function reelEmbed(video: string | null): string {
  const videoField = video ? String.raw`,\"video_url\":\"${embedded(video)}\"` : "";
  const blocked = video ? "false" : "true";
  return String.raw`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /></head><body><div class="Embed"></div><script nonce="rnn9NOGJ">requireLazy(["TimeSliceImpl","ServerJS"],function(TimeSlice,ServerJS){var s=(new ServerJS());s.handle({"require":[["PolarisEmbedRich.react"],["PolarisEmbedSimple","init",[],[{"isRichEmbed":true,"isSidecar":false,"isGuideEmbed":false,"isProfileEmbed":false,"contextJSON":"{\"context\":{\"type\":\"GraphVideo\",\"shortcode\":\"A-xv565BSJp\",\"copyright_blocked\":${blocked}},\"gql_data\":{\"shortcode_media\":{\"__typename\":\"GraphVideo\",\"id\":\"3576011039986387105\",\"shortcode\":\"A-xv565BSJp\",\"is_video\":true,\"display_url\":\"${embedded(POSTER)}\",\"dimensions\":{\"height\":1920,\"width\":1080},\"video_duration\":41.2,\"edge_media_to_caption\":{\"edges\":[{\"node\":{\"text\":\"A caption.\\n\\n#one #two\"}}]},\"product_type\":\"clips\",\"owner\":{\"id\":\"429459984\",\"username\":\"someone\",\"is_verified\":false}${videoField}}}}"}]],["NavigationMetrics","setPage",[],[{"page":"XPolarisEmbedPostController","page_type":"normal","page_uri":"https:\/\/www.instagram.com\/p\/A-xv565BSJp\/embed\/captioned\/"}]]]});});</script></body></html>`;
}

describe("parseInstagramEmbed, a reel whose embed carries its video", () => {
  it("passes on the video's address", () => {
    expect(parseInstagramEmbed(reelEmbed(VIDEO))?.sourceVideoUrl).toBe(VIDEO);
  });

  it("keeps display_url as the picture, so the poster is still the cover", () => {
    const post = parseInstagramEmbed(reelEmbed(VIDEO));
    expect(post?.media).toEqual([{ url: POSTER, kind: "image" }]);
    expect(post?.author).toBe("someone");
  });

  it("answers exactly as before when the embed has no video_url", () => {
    // Two reels in three, when this was written: the poster is all there is,
    // and yt-dlp on a desktop remains the route to the video.
    expect(parseInstagramEmbed(reelEmbed(null))).toEqual({
      media: [{ url: POSTER, kind: "image" }],
      author: "someone",
    });
    expect(parseInstagramEmbed(INSTAGRAM_REEL_EMBED)).not.toHaveProperty("sourceVideoUrl");
  });

  it("leaves a carousel's children to themselves", () => {
    expect(parseInstagramEmbed(INSTAGRAM_CAROUSEL_EMBED)).not.toHaveProperty("sourceVideoUrl");
  });

  it("ignores an address that is not https", () => {
    const post = parseInstagramEmbed(reelEmbed(VIDEO.replace(/^https:/, "http:")));
    expect(post).not.toHaveProperty("sourceVideoUrl");
    expect(post?.media).toHaveLength(1);
  });
});

describe("buildNote with a page video", () => {
  it("never writes the signed address into the note", () => {
    const post = parseInstagramEmbed(reelEmbed(VIDEO));
    const note = buildNote({
      url: "https://www.instagram.com/reel/A-xv565BSJp/",
      title: "A reel",
      description: "",
      author: post?.author ?? "",
      published: "",
      media: post?.media ?? [],
      sourceVideoUrl: post?.sourceVideoUrl,
    });
    expect(note).not.toContain("AQMwpzq5u9");
    expect(note).not.toContain("<video");
    expect(note).toContain(`![](${POSTER})`);
  });
});

describe("placePageVideo", () => {
  const source = "https://www.instagram.com/reel/A-xv565BSJp/";
  const key = sourceVideoKeyFor(source);
  const folder = "Attachments";
  const maxBytes = 1024;

  /** The first bytes of an ISO media file: a box size, then ftyp. */
  const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0])
    .buffer;
  const html = new TextEncoder().encode("<!DOCTYPE html><html>expired</html>").buffer;

  it("fills the slot yt-dlp would, so yt-dlp is never asked for this post", () => {
    // downloadSourceVideoFor looks through sourceVideoCandidates before it
    // considers yt-dlp, on every device the vault syncs to. A page video
    // that lands at one of them is therefore the end of the matter.
    const placed = placePageVideo({ status: 200, contentType: "video/mp4", data: mp4 }, VIDEO, key, folder, maxBytes);
    expect(placed).toEqual({ path: `${folder}/${hashUrl(key)}-video.mp4` });
    expect(sourceVideoCandidates(key, folder)).toContain((placed as { path: string }).path);
  });

  it("names the file by the type the server gives", () => {
    const mov = placePageVideo({ status: 200, contentType: "video/quicktime", data: mp4 }, VIDEO, key, folder, maxBytes);
    const webm = placePageVideo({ status: 200, contentType: "video/webm; codecs=vp9", data: mp4 }, VIDEO, key, folder, maxBytes);
    expect(mov).toEqual({ path: `${folder}/${hashUrl(key)}-video.mov` });
    expect(webm).toEqual({ path: `${folder}/${hashUrl(key)}-video.webm` });
  });

  it("judges a server that names no type, or a generic one, by the bytes", () => {
    for (const contentType of [undefined, "application/octet-stream"]) {
      expect(placePageVideo({ status: 200, contentType, data: mp4 }, VIDEO, key, folder, maxBytes)).toEqual({
        path: `${folder}/${hashUrl(key)}-video.mp4`,
      });
    }
    expect(
      placePageVideo({ status: 200, contentType: "application/octet-stream", data: html }, VIDEO, key, folder, maxBytes)
    ).toHaveProperty("failed");
  });

  it("refuses a page answered in place of the video", () => {
    expect(
      placePageVideo({ status: 200, contentType: "text/html; charset=utf-8", data: html }, VIDEO, key, folder, maxBytes)
    ).toEqual({ failed: "unexpected content type text/html" });
    expect(
      placePageVideo({ status: 200, contentType: "image/jpeg", data: mp4 }, VIDEO, key, folder, maxBytes)
    ).toHaveProperty("failed");
  });

  it("refuses a refusal, an empty answer and a file over the limit", () => {
    expect(placePageVideo({ status: 403, contentType: "text/plain", data: html }, VIDEO, key, folder, maxBytes)).toEqual({
      failed: "HTTP 403",
    });
    expect(
      placePageVideo({ status: 200, contentType: "video/mp4", data: new ArrayBuffer(0) }, VIDEO, key, folder, maxBytes)
    ).toEqual({ failed: "empty response" });
    expect(placePageVideo({ status: 200, contentType: "video/mp4", data: mp4 }, VIDEO, key, folder, 8)).toEqual({
      failed: "too large (16 bytes)",
    });
  });

  it("refuses a format the slot has no name for, rather than hide it where nothing looks", () => {
    expect(placePageVideo({ status: 200, contentType: "video/ogg", data: mp4 }, VIDEO, key, folder, maxBytes)).toEqual({
      failed: "unsupported video format ogv",
    });
  });
});
