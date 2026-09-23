import { describe, expect, it } from "vitest";
import { isThreadsAvatar, parseThreadsEmbed, threadsEmbedUrl } from "../src/core/threads";

/**
 * Pages shaped like the one Threads serves at /@<handle>/post/<code>/embed,
 * cut down to the markup around the media. The wrapping is kept as it
 * arrives — double-quoted attributes, every `&` of a signed address written
 * as `&amp;`, the photo of a linked post drawn as a CSS background — because
 * that is what the parser has to read through. Every id is invented.
 */
const CDN = "https://scontent.cdninstagram.com";
const SIGNED = "_nc_cat=100&amp;ccb=7-5&amp;_nc_sid=aaaaaa&amp;oh=00_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&amp;oe=6A000000";

const avatar = `${CDN}/v/t51.82787-19/100000009_10000000000000009_1000000000000000009_n.jpg?stp=dst-jpg_s100x100_tt6&amp;${SIGNED}`;
const oldAvatar = `${CDN}/v/t51.2885-19/100000008_100000000000008_1000000000000000008_n.jpg?stp=dst-jpg_s100x100_tt6&amp;${SIGNED}`;
const photo = (n: number, size = "e35"): string =>
  `${CDN}/v/t51.82787-15/10000000${n}_1000000000000000${n}_100000000000000000${n}_n.jpg?stp=dst-jpg_${size}_tt6&amp;${SIGNED}`;
const decoded = (url: string): string => url.replace(/&amp;/g, "&");

const header = (): string =>
  `<div class="Embed"><div class="HeaderContainer"><div class="AvatarContainer">` +
  `<img class="img" src="${avatar}" alt="someone" height="36" width="36" /></div>` +
  `<img class="img" src="https://static.cdninstagram.com/rsrc.php/yA/r/AAAAAAAAAAA.webp" alt="" width="24" height="24" /></div>`;

const CAROUSEL_EMBED =
  `<!DOCTYPE html><html><head><script src="https://static.cdninstagram.com/rsrc.php/v4/yA/r/AAAAAAAAAAA.js"></script></head><body>` +
  header() +
  `<div class="BodyContainerNoThreadLine"><span class="BodyTextContainer"><span>Four frames</span></span>` +
  `<div class="MediaContainer"><div class="MediaScrollContainer">` +
  [1, 2, 3, 4]
    .map((n) => `<div class="MediaScrollImageContainer"><img class="img" src="${photo(n)}" height="300" draggable="false" alt="" /></div>`)
    .join("") +
  // The first frame again at another size, as a lazy or responsive
  // rendition would ask for it: the same picture, not a fifth one.
  `<img class="img" src="${photo(1, "s640x640")}" alt="" />` +
  `</div></div>` +
  // A reply's author, drawn with the older avatar path.
  `<img class="img" src="${oldAvatar}" alt="someone_else" height="24" width="24" />` +
  `</div></div></body></html>`;

const LINKED_PHOTO_EMBED =
  `<!DOCTYPE html><html><body>` +
  header() +
  `<div class="LinkAttachmentOuterContainer LinkAttachmentOuterContainerWithImage">` +
  `<div class="LinkAttachmentImage" style="background-image: url(${photo(5)}&amp;dl=1)"></div>` +
  `</div></div></body></html>`;

const video = `${CDN}/o1/v/t16/f2/m84/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.mp4?${SIGNED}&amp;vs=10000000000000001_100000001`;

const VIDEO_EMBED =
  `<!DOCTYPE html><html><body>` +
  header() +
  `<div class="SoloMediaContainer"><div class="SingleInnerMediaContainerVideo SingleInnerMediaContainer">` +
  `<video controls="1" loop="1" class=""><source src="${video}" /></video>` +
  `<div class="VideoPlayOverlay"></div></div></div></div></body></html>`;

/** What a removed or private post comes back as: the frame, the avatar, nothing of the post. */
const EMPTY_EMBED = `<!DOCTYPE html><html><body>${header()}</div></body></html>`;

describe("parseThreadsEmbed", () => {
  it("keeps the post's photos, in order, and drops avatars and the duplicate size", () => {
    expect(parseThreadsEmbed(CAROUSEL_EMBED)).toEqual({
      images: [1, 2, 3, 4].map((n) => decoded(photo(n))),
      video: null,
    });
  });

  it("resolves &amp; in the addresses, since a signature with it left in is refused", () => {
    const [first] = parseThreadsEmbed(CAROUSEL_EMBED)?.images ?? [];
    expect(first).toContain("&_nc_cat=100&ccb=7-5");
    expect(first).not.toContain("&amp;");
  });

  it("reads the photo of a linked post out of its CSS background", () => {
    expect(parseThreadsEmbed(LINKED_PHOTO_EMBED)?.images).toEqual([`${decoded(photo(5))}&dl=1`]);
  });

  it("reads a quoted url() and a single-quoted attribute the same way", () => {
    const html = `<div style='background-image: url(&quot;${photo(6)}&quot;)'></div>`;
    expect(parseThreadsEmbed(html)?.images).toEqual([decoded(photo(6))]);
  });

  it("hands over a video post's file and no picture", () => {
    expect(parseThreadsEmbed(VIDEO_EMBED)).toEqual({ images: [], video: decoded(video) });
  });

  it("answers null for a page with nothing of the post on it", () => {
    expect(parseThreadsEmbed(EMPTY_EMBED)).toBeNull();
    expect(parseThreadsEmbed("")).toBeNull();
  });

  it("does not take a data-src or an attribute value mentioning src for a picture", () => {
    const html = `<img data-src="${photo(7)}" alt="src=&quot;${photo(8)}&quot;" />`;
    expect(parseThreadsEmbed(html)).toBeNull();
  });
});

describe("threadsEmbedUrl", () => {
  it("builds the embed from a permalink on either host", () => {
    expect(threadsEmbedUrl("https://www.threads.com/@someone/post/AAAAAAAAAAA")).toBe(
      "https://www.threads.com/@someone/post/AAAAAAAAAAA/embed"
    );
    expect(threadsEmbedUrl("https://www.threads.net/@some.one_2/post/B-b_BBBBBBB")).toBe(
      "https://www.threads.net/@some.one_2/post/B-b_BBBBBBB/embed"
    );
    expect(threadsEmbedUrl("https://threads.com/@someone/post/AAAAAAAAAAA")).toBe(
      "https://threads.com/@someone/post/AAAAAAAAAAA/embed"
    );
  });

  it("ignores a trailing slash, a query and a fragment", () => {
    const want = "https://www.threads.com/@someone/post/AAAAAAAAAAA/embed";
    expect(threadsEmbedUrl("https://www.threads.com/@someone/post/AAAAAAAAAAA/")).toBe(want);
    expect(threadsEmbedUrl("https://www.threads.com/@someone/post/AAAAAAAAAAA?xmt=AAAA-aaaa_0")).toBe(want);
    expect(threadsEmbedUrl("https://www.threads.com/@someone/post/AAAAAAAAAAA/?xmt=AAAA#top")).toBe(want);
  });

  it("accepts the @ escaped, as a copied link sometimes carries it", () => {
    expect(threadsEmbedUrl("https://www.threads.com/%40someone/post/AAAAAAAAAAA")).toBe(
      "https://www.threads.com/@someone/post/AAAAAAAAAAA/embed"
    );
  });

  it("answers null for a share link, a profile, another site and junk", () => {
    expect(threadsEmbedUrl("https://www.threads.com/share/AAAAAAAAA/")).toBeNull();
    expect(threadsEmbedUrl("https://www.threads.com/@someone")).toBeNull();
    expect(threadsEmbedUrl("https://www.instagram.com/@someone/post/AAAAAAAAAAA")).toBeNull();
    expect(threadsEmbedUrl("not a url")).toBeNull();
  });
});

describe("isThreadsAvatar", () => {
  it("tells a profile picture from post media by the CDN path", () => {
    expect(isThreadsAvatar(decoded(avatar))).toBe(true);
    expect(isThreadsAvatar(decoded(oldAvatar))).toBe(true);
    expect(isThreadsAvatar(decoded(photo(1)))).toBe(false);
    expect(isThreadsAvatar("not a url")).toBe(false);
  });
});
