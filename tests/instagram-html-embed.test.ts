import { describe, expect, it } from "vitest";
import { parseInstagramEmbed } from "../src/core/resolve";
import { INSTAGRAM_BROKEN_EMBED, INSTAGRAM_CAROUSEL_EMBED } from "./fixtures/instagram";

/**
 * Pages shaped like the one Instagram serves at /p/<code>/embed/captioned/
 * for a post whose embed sends no data: `contextJSON` is null and the post
 * is drawn on the server. Cut down to the markup around the pictures, with
 * the wrapping kept as it arrives — every `&` of a signed address written
 * as `&amp;`, the @ of the alt text as `&#064;`, a srcset whose candidates
 * are joined by a bare comma, the full renditions listed before the square
 * crops. Every code, id, path, signature and handle is invented.
 */
const CDN = "https://scontent-abc1-1.cdninstagram.com";
const POST = "100000001_10000000000000001_1000000000000000001_n.jpg";

/** One rendition as the markup writes it, each signed for itself. */
function rendition(stp: string, signature: string, file = POST): string {
  return (
    `${CDN}/v/t51.82787-15/${file}?stp=${stp}&amp;_nc_cat=100` +
    `&amp;ig_cache_key=MTAwMDAwMDAwMDAwMDAwMDAwMQ%3D%3D.3-ccb7-5&amp;ccb=7-5&amp;_nc_sid=aaaaaa` +
    `&amp;oh=00_AQ${signature.repeat(44)}&amp;oe=6A000000`
  );
}

const decoded = (url: string): string => url.replace(/&amp;/g, "&");

const FULL = rendition("dst-jpg_e35_tt6", "B");
const FIT_1080 = rendition("dst-jpg_e35_p1080x1080_sh2.08_tt6", "C");
const FIT_640 = rendition("dst-jpg_e35_p640x640_sh2.08_tt6", "D");
const CROP_1080 = rendition("c0.180.1440.1440a_dst-jpg_e35_s1080x1080_sh2.08_tt6", "E");
const CROP_640 = rendition("c0.180.1440.1440a_dst-jpg_e35_s640x640_sh2.08_tt6", "F");

/** A srcset as the embed writes one: `url width` pairs, a bare comma between. */
const srcset = (...pairs: Array<[string, number]>): string =>
  pairs.map(([url, width]) => `${url} ${width}w`).join(",");

const REAL_ORDER = srcset([FULL, 1440], [FIT_1080, 1080], [FIT_640, 640], [CROP_1080, 1080], [CROP_640, 640]);

const AVATAR = `${CDN}/v/t51.82787-19/100000009_10000000000000009_1000000000000000009_n.jpg?stp=dst-jpg_s150x150_tt6&amp;oh=00_AQ${"G".repeat(44)}&amp;oe=6A000000`;
const OTHER_POST = rendition("dst-jpg_e35_tt6", "H", "100000002_10000000000000002_1000000000000000002_n.jpg");

interface Drawn {
  media?: string;
  /** The <img> tags drawn inside the post's frame. */
  images?: string[];
  /** The header's name, or null for a header that writes none. */
  username?: string | null;
}

/** The <img> the embed draws a post's picture with. */
function embeddedImage(attrs: { src?: string; srcset?: string; alt?: string }): string {
  const alt = attrs.alt ?? "Instagram post shared by &#064;someone";
  const src = attrs.src === undefined ? "" : ` src="${attrs.src}"`;
  const set = attrs.srcset === undefined ? "" : ` srcset="${attrs.srcset}"`;
  return `<img class="EmbeddedMediaImage" alt="${alt}"${src}${set} />`;
}

function simpleEmbed({
  media = "GraphImage",
  images = [embeddedImage({ src: FULL, srcset: REAL_ORDER })],
  username = "someone",
}: Drawn = {}): string {
  const profile = "https://www.instagram.com/someone/?utm_source=ig_embed&amp;ig_rid=AAAAAAAAAAAAAAAAAAAAAAA";
  const permalink = "https://www.instagram.com/p/Bb0Cc1Dd2Ee/?utm_source=ig_embed&amp;ig_rid=AAAAAAAAAAAAAAAAAAAAAAA";
  const name = username === null ? "" : `<span class="UsernameText">${username}</span>`;
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /></head><body class="x1 Locale_en_US" dir="ltr">` +
    `<script nonce="aaaaaaaa">requireLazy(["TimeSliceImpl","ServerJS"],function(TimeSlice,ServerJS){var s=(new ServerJS());` +
    `s.handle({"require":[["PolarisEmbedSimple","init",[],[{"isRichEmbed":false,"isSidecar":${media === "GraphSidecar"},` +
    `"isGuideEmbed":false,"isProfileEmbed":false,"contextJSON":null}]]]});});</script>` +
    `<div class="Embed" data-permalink="${permalink}" data-media-type="${media}" data-media-id="1000000000000000001" data-owner-id="1000000001">` +
    `<div class="Header"><div class="AvatarContainer"><a class="Avatar" href="${profile}" target="_blank">` +
    `<img src="${AVATAR}" alt="someone" /></a></div><div class="HeaderText">` +
    `<a class="Username" href="${profile}" target="_blank">${name}</a></div></div>` +
    `<div class="Content EmbedFrame" style="padding-bottom: 125%;"><a class="EmbeddedMedia" href="${permalink}" target="_blank">` +
    images.join("") +
    `</a></div>` +
    // The author's other posts, larger than this one: not this post.
    `<div class="HoverCard"><a class="HoverCardRoot" href="${profile}"><div class="HoverCardProfile">` +
    `<img src="${AVATAR}" alt="someone" /><div class="HoverCardUser"><span class="Username">someone</span></div></div>` +
    `<div class="HoverCardPhotos"><img src="${OTHER_POST}" srcset="${srcset([OTHER_POST, 2048])}" /></div></a></div>` +
    `<div class="Caption"><a class="CaptionUsername" href="${profile}">someone</a><br /><br />A caption.</div>` +
    `</div></body></html>`
  );
}

describe("parseInstagramEmbed, an embed drawn without its data", () => {
  it("takes the widest rendition the picture's srcset lists", () => {
    const post = parseInstagramEmbed(simpleEmbed());
    expect(post?.media).toEqual([{ url: decoded(FULL), kind: "image" }]);
  });

  it("uses the address exactly as signed, with only its entities resolved", () => {
    const url = parseInstagramEmbed(simpleEmbed())?.media[0].url ?? "";
    expect(url).not.toContain("&amp;");
    expect(url).toContain(`&oh=00_AQ${"B".repeat(44)}&oe=6A000000`);
    expect(url).toContain("stp=dst-jpg_e35_tt6&");
  });

  it("reads the srcset in any order", () => {
    const shuffled = srcset([CROP_640, 640], [FIT_640, 640], [FULL, 1440], [FIT_1080, 1080]);
    const post = parseInstagramEmbed(simpleEmbed({ images: [embeddedImage({ src: FIT_640, srcset: shuffled })] }));
    expect(post?.media[0].url).toBe(decoded(FULL));
  });

  it("passes over the square crops listed beside the real renditions", () => {
    // A crop wider than anything else, which the page has never sent, would
    // still be the square this exists to get away from.
    const set = srcset([FIT_1080, 1080], [CROP_1080, 1440], [CROP_640, 640]);
    const post = parseInstagramEmbed(simpleEmbed({ images: [embeddedImage({ src: FIT_1080, srcset: set })] }));
    expect(post?.media[0].url).toBe(decoded(FIT_1080));
  });

  it("takes the first listed of two renditions at one width", () => {
    const set = srcset([FIT_1080, 1080], [CROP_1080, 1080]);
    const post = parseInstagramEmbed(simpleEmbed({ images: [embeddedImage({ srcset: set })] }));
    expect(post?.media[0].url).toBe(decoded(FIT_1080));
  });

  it("takes a crop only when the srcset lists nothing else", () => {
    const set = srcset([CROP_640, 640], [CROP_1080, 1080]);
    const post = parseInstagramEmbed(simpleEmbed({ images: [embeddedImage({ srcset: set })] }));
    expect(post?.media[0].url).toBe(decoded(CROP_1080));
  });

  it("falls back to src when there is no srcset", () => {
    const post = parseInstagramEmbed(simpleEmbed({ images: [embeddedImage({ src: FIT_1080 })] }));
    expect(post?.media).toEqual([{ url: decoded(FIT_1080), kind: "image" }]);
  });

  it("falls back to src when no candidate in the srcset can be read", () => {
    const unreadable = `${FULL} 2x,/v/relative.jpg 1440w,http://insecure.example/a.jpg 1080w`;
    const post = parseInstagramEmbed(simpleEmbed({ images: [embeddedImage({ src: FIT_640, srcset: unreadable })] }));
    expect(post?.media[0].url).toBe(decoded(FIT_640));
  });

  it("never takes the avatar or the author's other posts", () => {
    const urls = parseInstagramEmbed(simpleEmbed())?.media.map((m) => m.url) ?? [];
    expect(urls).toHaveLength(1);
    expect(urls.some((url) => url.includes("100000002_") || url.includes("-19/"))).toBe(false);
  });

  it("reads the author from the name the header writes out", () => {
    expect(parseInstagramEmbed(simpleEmbed())?.author).toBe("someone");
  });

  it("reads the author from the alt text when the header names nobody", () => {
    const images = [embeddedImage({ src: FULL, alt: "Instagram post shared by &#064;some.one_2" })];
    expect(parseInstagramEmbed(simpleEmbed({ username: null, images }))?.author).toBe("some.one_2");
  });

  it("leaves the author empty when the markup names nobody it can trust", () => {
    const images = [embeddedImage({ src: FULL, alt: "" })];
    expect(parseInstagramEmbed(simpleEmbed({ username: null, images }))?.author).toBe("");
    // Not a handle Instagram would allow, so not an author: likely a page
    // that has changed what it puts there.
    expect(parseInstagramEmbed(simpleEmbed({ username: "Some One", images }))?.author).toBe("");
  });

  it("gives a carousel the one picture its markup draws", () => {
    // The embed draws a carousel's first picture and leaves the rest to its
    // scripts, which read them out of the data this page did not send.
    const post = parseInstagramEmbed(simpleEmbed({ media: "GraphSidecar" }));
    expect(post?.media).toEqual([{ url: decoded(FULL), kind: "image" }]);
  });

  it("keeps every picture in order should the markup ever draw more", () => {
    const second = rendition("dst-jpg_e35_tt6", "J", "100000003_10000000000000003_1000000000000000003_n.jpg");
    const images = [
      embeddedImage({ src: FULL, srcset: REAL_ORDER }),
      embeddedImage({ src: second, srcset: srcset([second, 1440]) }),
      // The first again, as a responsive rendition would draw it.
      embeddedImage({ src: FULL }),
    ];
    const post = parseInstagramEmbed(simpleEmbed({ media: "GraphSidecar", images }));
    expect(post?.media.map((m) => m.url)).toEqual([decoded(FULL), decoded(second)]);
  });

  it("gives a video its poster and no address for the file", () => {
    // The markup has no <video> and names no mp4; the file stays yt-dlp's.
    const post = parseInstagramEmbed(simpleEmbed({ media: "GraphVideo" }));
    expect(post?.media).toEqual([{ url: decoded(FULL), kind: "image" }]);
    expect(post).not.toHaveProperty("sourceVideoUrl");
  });

  it("answers nothing when the markup draws no picture of the post", () => {
    expect(parseInstagramEmbed(simpleEmbed({ images: [] }))).toBeNull();
    expect(parseInstagramEmbed(simpleEmbed({ images: [embeddedImage({})] }))).toBeNull();
    const insecure = decoded(FULL).replace(/^https:/, "http:");
    expect(parseInstagramEmbed(simpleEmbed({ images: [embeddedImage({ src: insecure })] }))).toBeNull();
  });
});

describe("parseInstagramEmbed, the order it reads an embed in", () => {
  const markup = embeddedImage({ src: FULL, srcset: REAL_ORDER });

  it("reads the data first when the embed sends it", () => {
    // The data names every picture of a carousel; the markup only its first.
    const both = INSTAGRAM_CAROUSEL_EMBED.replace("</body>", `${markup}</body>`);
    expect(parseInstagramEmbed(both)).toEqual(parseInstagramEmbed(INSTAGRAM_CAROUSEL_EMBED));
    expect(parseInstagramEmbed(both)?.media).toHaveLength(3);
  });

  it("reads the markup when the data is there but cannot be read", () => {
    const both = INSTAGRAM_BROKEN_EMBED.replace("</body>", `${markup}</body>`);
    expect(parseInstagramEmbed(both)?.media).toEqual([{ url: decoded(FULL), kind: "image" }]);
  });

  it("answers nothing when neither is there, so the og: tags stand", () => {
    expect(parseInstagramEmbed(INSTAGRAM_BROKEN_EMBED)).toBeNull();
    expect(parseInstagramEmbed("<html><body><img src=\"https://example.com/a.jpg\" /></body></html>")).toBeNull();
  });
});
