import { describe, expect, it } from "vitest";
import {
  canonicalPinUrl,
  isPinterestShortLink,
  isPinterestUrl,
  parsePinPage,
  parsePinResource,
  pinIdFromPage,
  pinPermalink,
  pinResourceUrl,
  pinimgForClipping,
  pinimgStandIn,
  pinterestPinId,
} from "../src/core/pinterest";
import { buildNote } from "../src/core/resolve";
import type { ResolvedLink } from "../src/core/resolve";
import { isEditable } from "../src/core/editable";
import { surveyProperties } from "../src/core/facet-catalog";
import type { ClippingRecord } from "../src/core/scan";

// Synthetic throughout: the ids, hashes, codes and names below are invented,
// in the shape the live responses have.
const PIN_ID = "731246580913572846";
const OTHER_PIN_ID = "2468013579864209";
const HASH = "3fa1c07be29d4c8816f0a5e7b2c9d341";
// Pins whose id is letters and digits come in these two lengths.
const LETTERED_ID = "AQqp3E-YkHbLbREC6aoyG1PzDD2_5djlK6tKx62Ur3ZU-gepvfpTNB4";
const LONG_LETTERED_ID =
  "AKkLj4D8C-WO4wyLTgtU3gpDZEAq1o0zpRTgo2sQpvzCD1dCFuk_kpRe2UUJs69wnmOZkn1WSl28bHLudIgxTW0";
const VIDEO_HASH = "9c2e71d0b4a85f36e1d7c0a92b5f4e18";
const REEL = "https://www.instagram.com/reel/Qx7Lm2Np4Rt/";

const pinimg = (size: string, hash = HASH): string =>
  `https://i.pinimg.com/${size}/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash.slice(4, 6)}/${hash}.jpg`;

/** An `images` map as a pin carries it, keyed by size. */
function imagesFor(hash: string): Record<string, { url: string; width: number; height: number }> {
  return {
    "60x60": { url: pinimg("60x60", hash), width: 60, height: 60 },
    "236x": { url: pinimg("236x", hash), width: 236, height: 404 },
    "474x": { url: pinimg("474x", hash), width: 474, height: 812 },
    "736x": { url: pinimg("736x", hash), width: 736, height: 1261 },
    "600x315": { url: pinimg("600x315", hash), width: 600, height: 315 },
    orig: { url: pinimg("originals", hash), width: 828, height: 1419 },
  };
}

function resource(data: Record<string, unknown>): unknown {
  return {
    resource_response: {
      status: "success",
      code: 0,
      message: "ok",
      endpoint_name: "v3_get_pin",
      data: {
        id: PIN_ID,
        title: "",
        grid_title: "",
        description: "",
        closeup_unified_description: "",
        seo_title: "",
        created_at: "Tue, 22 Sep 2026 22:55:45 +0000",
        link: null,
        images: imagesFor(HASH),
        videos: null,
        story_pin_data: null,
        carousel_data: null,
        pinner: { username: "sample_board_keeper", full_name: "Sample Keeper" },
        native_creator: { username: "maple_and_moss", full_name: "Maple Moss" },
        ...data,
      },
    },
  };
}

const videoList = (hash: string): Record<string, unknown> => ({
  V_720P: {
    url: `https://v1.pinimg.com/videos/iht/expMp4/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash.slice(4, 6)}/${hash}_720w.mp4`,
    width: 720,
    height: 1280,
    thumbnail: `https://i.pinimg.com/videos/thumbnails/originals/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash.slice(4, 6)}/${hash}.0000000.jpg`,
  },
  V_HLSV4: {
    url: `https://v1.pinimg.com/videos/iht/hls/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash.slice(4, 6)}/${hash}.m3u8`,
    width: 720,
    height: 1280,
  },
});

/** An idea pin's page whose one block is a picture. */
const imagePage = (hash: string): Record<string, unknown> => ({
  type: "storypinpage",
  video: null,
  blocks: [
    {
      type: "story_pin_image_block",
      block_type: 2,
      image: {
        images: {
          originals: { url: pinimg("originals", hash), width: 1080, height: 1920 },
          "736x": { url: pinimg("736x", hash), width: 736, height: 1308 },
          "474x": { url: pinimg("474x", hash), width: 474, height: 842 },
        },
      },
    },
  ],
});

/**
 * An idea pin's page whose block is a video, named the way those pages name
 * it: numbered keys, the 720p file among smaller tiers that claim the same
 * size, and the HLS playlist beside them.
 */
const videoPage = (hash: string): Record<string, unknown> => {
  const dir = `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash.slice(4, 6)}`;
  return {
    type: "storypinpage",
    video: null,
    blocks: [
      {
        type: "story_pin_video_block",
        block_type: 3,
        video: {
          video_list: {
            V_EXP3: { url: `https://v1.pinimg.com/videos/mc/expMp4/${dir}/${hash}_t1.mp4`, width: 1080, height: 1920 },
            V_HLSV3_MOBILE: { url: `https://v1.pinimg.com/videos/mc/hls/${dir}/${hash}.m3u8`, width: 1080, height: 1920 },
            V_EXP7: { url: `https://v1.pinimg.com/videos/mc/720p/${dir}/${hash}.mp4`, width: 1080, height: 1920 },
          },
        },
      },
      { type: "story_pin_music_block", block_type: 5 },
    ],
  };
};

/** A video page with nothing but a playlist to play, as older idea pins have. */
const streamOnlyPage = (hash: string): Record<string, unknown> => {
  const dir = `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash.slice(4, 6)}`;
  return {
    type: "storypinpage",
    video: null,
    blocks: [
      {
        type: "story_pin_video_block",
        video: {
          video_list: {
            V_HLSV3_MOBILE: {
              url: `https://v1.pinimg.com/videos/iht/hls/v2/${dir}/${hash}.m3u8`,
              thumbnail: `https://i.pinimg.com/videos/thumbnails/originals/${dir}/${hash}.0000000.jpg`,
            },
          },
        },
      },
    ],
  };
};

describe("Pinterest addresses", () => {
  it("reads the pin's id with and without a slug", () => {
    expect(pinterestPinId(`https://www.pinterest.com/pin/${PIN_ID}/`)).toBe(PIN_ID);
    expect(pinterestPinId(`https://www.pinterest.com/pin/${PIN_ID}`)).toBe(PIN_ID);
    expect(pinterestPinId(`https://www.pinterest.com/pin/cozy-hallway-ideas--${PIN_ID}/`)).toBe(PIN_ID);
    expect(pinterestPinId(`https://www.pinterest.com/pin/${PIN_ID}/?mt=login`)).toBe(PIN_ID);
  });

  it("reads an id made of letters and digits", () => {
    expect(pinterestPinId(`https://www.pinterest.com/pin/${LETTERED_ID}/`)).toBe(LETTERED_ID);
    expect(pinterestPinId(`https://mx.pinterest.com/pin/${LONG_LETTERED_ID}`)).toBe(LONG_LETTERED_ID);
    expect(canonicalPinUrl(`https://pinterest.de/pin/${LETTERED_ID}/?mt=login`)).toBe(
      `https://www.pinterest.com/pin/${LETTERED_ID}/`
    );
  });

  it("does not take a slug of words for a lettered id", () => {
    expect(pinterestPinId("https://www.pinterest.com/pin/cozy-hallway-ideas-for-a-small-flat-in-autumn/")).toBeNull();
    expect(pinterestPinId("https://www.pinterest.com/pin/Cozy-Hallway-Ideas-For-A-Small-Flat-In-Autumn/")).toBeNull();
    expect(pinterestPinId(`https://www.pinterest.com/pin/${LETTERED_ID.slice(0, 20)}/`)).toBeNull();
  });

  it("knows the country subdomains and the regional storefronts", () => {
    for (const host of [
      "pinterest.com",
      "uk.pinterest.com",
      "de.pinterest.com",
      "br.pinterest.com",
      "pinterest.co.uk",
      "www.pinterest.co.uk",
      "pinterest.ca",
      "pinterest.de",
      "pinterest.fr",
      "pinterest.jp",
      "pinterest.com.au",
      "pinterest.es",
      "pinterest.it",
      "pinterest.com.mx",
      "pinterest.pt",
    ]) {
      expect(pinterestPinId(`https://${host}/pin/${PIN_ID}/`), host).toBe(PIN_ID);
      expect(isPinterestUrl(`https://${host}/`), host).toBe(true);
    }
  });

  it("is not fooled by a host that only contains the name", () => {
    expect(pinterestPinId(`https://pinterest.com.example.org/pin/${PIN_ID}/`)).toBeNull();
    expect(pinterestPinId(`https://notpinterest.com/pin/${PIN_ID}/`)).toBeNull();
    expect(isPinterestUrl("https://example.com/pinterest")).toBe(false);
  });

  it("is not a pin on a board, a profile or the search page", () => {
    expect(pinterestPinId("https://www.pinterest.com/maple_and_moss/cozy-hallway/")).toBeNull();
    expect(pinterestPinId("https://www.pinterest.com/maple_and_moss/")).toBeNull();
    expect(pinterestPinId("https://www.pinterest.com/search/pins/?q=hallway")).toBeNull();
  });

  it("recognises a pin.it link without claiming to know its pin", () => {
    const short = "https://pin.it/4kQz9TbWm";
    expect(isPinterestShortLink(short)).toBe(true);
    expect(isPinterestUrl(short)).toBe(true);
    expect(pinterestPinId(short)).toBeNull();
    expect(canonicalPinUrl(short)).toBeNull();
    expect(isPinterestShortLink(`https://www.pinterest.com/pin/${PIN_ID}/`)).toBe(false);
  });

  it("keeps every form of one pin under one permalink", () => {
    const permalink = `https://www.pinterest.com/pin/${PIN_ID}/`;
    expect(pinPermalink(PIN_ID)).toBe(permalink);
    for (const url of [
      `https://www.pinterest.com/pin/${PIN_ID}/`,
      `https://pinterest.com/pin/${PIN_ID}`,
      `https://uk.pinterest.com/pin/cozy-hallway-ideas--${PIN_ID}/`,
      `https://pinterest.co.uk/pin/${PIN_ID}/?invite_code=abc123&sender=987654321`,
      `https://www.pinterest.de/pin/${PIN_ID}/#details`,
    ]) {
      expect(canonicalPinUrl(url), url).toBe(permalink);
    }
    expect(canonicalPinUrl("https://example.com/pin/123456789/")).toBeNull();
  });

  it("asks the resource for the pin by id", () => {
    const url = new URL(pinResourceUrl(PIN_ID));
    expect(url.origin + url.pathname).toBe("https://www.pinterest.com/resource/PinResource/get/");
    expect(JSON.parse(url.searchParams.get("data") ?? "")).toEqual({
      options: { field_set_key: "unauth_react_main_pin", id: PIN_ID },
    });
  });
});

describe("pinimgForClipping", () => {
  const as = (size: string, ext: string): string => pinimg(size).replace(/\.jpg$/, `.${ext}`);

  it("asks for 1200 wide in place of whatever size the address named", () => {
    for (const size of ["736x", "236x", "474x", "564x", "originals", "60x60", "600x315"]) {
      expect(pinimgForClipping(pinimg(size)), size).toBe(pinimg("1200x"));
    }
  });

  it("keeps a PNG's or a WebP's original, the only copy that can be see-through", () => {
    expect(pinimgForClipping(as("originals", "png"))).toBe(as("originals", "png"));
    expect(pinimgForClipping(as("originals", "webp"))).toBe(as("originals", "webp"));
    expect(pinimgForClipping(as("736x", "png"))).toBe(as("originals", "png"));
  });

  it("takes a HEIC as the JPEG rendition, which the wall can paint", () => {
    expect(pinimgForClipping(as("originals", "heic"))).toBe(pinimg("1200x"));
    expect(pinimgForClipping(as("originals", "jpeg"))).toBe(pinimg("1200x"));
  });

  it("keeps a GIF's original, since its sized renditions do not move", () => {
    const gif = as("originals", "gif");
    expect(pinimgForClipping(gif)).toBe(gif);
  });

  it("leaves a video's thumbnail, another host and a non-URL alone", () => {
    const thumb = `https://i.pinimg.com/videos/thumbnails/originals/9c/2e/71/${VIDEO_HASH}.0000000.jpg`;
    expect(pinimgForClipping(thumb)).toBe(thumb);
    expect(pinimgForClipping("https://example.com/736x/a/b.jpg")).toBe("https://example.com/736x/a/b.jpg");
    expect(pinimgForClipping("not a url")).toBe("not a url");
  });
});

describe("pinimgStandIn", () => {
  it("is the 1200 wide JPEG for an original PNG or WebP", () => {
    expect(pinimgStandIn(pinimg("originals").replace(/\.jpg$/, ".png"))).toBe(pinimg("1200x"));
    expect(pinimgStandIn(pinimg("originals").replace(/\.jpg$/, ".webp"))).toBe(pinimg("1200x"));
  });

  it("is nothing for anything that is already the lighter copy or cannot be see-through", () => {
    expect(pinimgStandIn(pinimg("1200x"))).toBe("");
    expect(pinimgStandIn(pinimg("originals"))).toBe("");
    expect(pinimgStandIn(pinimg("originals").replace(/\.jpg$/, ".gif"))).toBe("");
    expect(pinimgStandIn("https://example.com/originals/a/b.png")).toBe("");
    expect(pinimgStandIn("not a url")).toBe("");
  });
});

describe("parsePinResource", () => {
  it("reads a picture pin as its picture at 1200 wide", () => {
    const pin = parsePinResource(
      resource({
        title: "Cozy hallway with paper ghosts",
        description: "#hallway",
        closeup_unified_description: "#hallway",
        // Most pins are stored as a one-page idea pin now; one page is not a carousel.
        story_pin_data: { page_count: 1, pages: [imagePage(HASH)] },
      }),
      PIN_ID
    );
    expect(pin).not.toBeNull();
    expect(pin?.url).toBe(`https://www.pinterest.com/pin/${PIN_ID}/`);
    expect(pin?.media).toEqual([{ url: pinimg("1200x"), kind: "image" }]);
    expect(pin?.title).toBe("Cozy hallway with paper ghosts");
    expect(pin?.description).toBe("#hallway");
    expect(pin?.author).toBe("Maple Moss");
    expect(pin?.published).toBe("Tue, 22 Sep 2026 22:55:45 +0000");
    expect(pin?.sourceVideoUrl).toBeUndefined();
    expect(pin?.origin).toBeUndefined();
  });

  it("reads the format off the original, which the sized entries do not carry", () => {
    // An upload no wider than 736: its original ties with the 736x entry and
    // is the only one of them that says it is a PNG.
    const png = pinimg("originals").replace(/\.jpg$/, ".png");
    const images = {
      "236x": { url: pinimg("236x"), width: 236, height: 236 },
      "736x": { url: pinimg("736x"), width: 736, height: 736 },
      orig: { url: png, width: 736, height: 736 },
    };
    const pin = parsePinResource(resource({ title: "Paper ghost cutout", images }), PIN_ID);
    expect(pin?.media).toEqual([{ url: png, kind: "image" }]);
  });

  it("reads a video pin as its poster, with the mp4 handed over for the archiver", () => {
    const pin = parsePinResource(
      resource({
        images: imagesFor(VIDEO_HASH),
        videos: { video_list: videoList(VIDEO_HASH) },
        link: `${REEL}?utm_source=pinterest&utm_medium=social`,
        description: "Hosting the holidays in a tiny kitchen #ad",
        closeup_unified_description: "Hosting the holidays in a tiny kitchen\n\n#ad",
      }),
      PIN_ID
    );
    expect(pin?.sourceVideoUrl).toBe(
      `https://v1.pinimg.com/videos/iht/expMp4/9c/2e/71/${VIDEO_HASH}_720w.mp4`
    );
    expect(pin?.media).toEqual([{ url: pinimg("1200x", VIDEO_HASH), kind: "image" }]);
    // The pin's link is where the video was first posted, with the tracking
    // Pinterest appends taken off.
    expect(pin?.origin).toBe(REEL);
    // No title of its own: the caption's first line stands in.
    expect(pin?.title).toBe("Hosting the holidays in a tiny kitchen");
    expect(pin?.description).toBe("Hosting the holidays in a tiny kitchen\n\n#ad");
  });

  it("reads a one-page idea pin whose page is a video as a video pin", () => {
    const pin = parsePinResource(
      resource({ story_pin_data: { page_count: 1, pages: [videoPage(VIDEO_HASH)] } }),
      PIN_ID
    );
    expect(pin?.sourceVideoUrl).toBe(`https://v1.pinimg.com/videos/mc/720p/9c/2e/71/${VIDEO_HASH}.mp4`);
    expect(pin?.media).toEqual([{ url: pinimg("1200x"), kind: "image" }]);
  });

  it("reads an idea pin as every page in order, pictures at 1200 wide and videos as files", () => {
    const second = "b81f0e4c7a2d95e3f6c0a1b2d3e4f5a6";
    const third = "0d4c8e2a6f1b5937c2e4a6b8d0f1e3c5";
    const pin = parsePinResource(
      resource({
        title: "Three-step carnation cake",
        link: "https://cooking.example.com/carnation-cake/",
        story_pin_data: {
          page_count: 3,
          pages: [videoPage(VIDEO_HASH), imagePage(second), streamOnlyPage(third)],
        },
      }),
      PIN_ID
    );
    expect(pin?.media).toEqual([
      { url: `https://v1.pinimg.com/videos/mc/720p/9c/2e/71/${VIDEO_HASH}.mp4`, kind: "video" },
      { url: pinimg("1200x", second), kind: "image" },
      // Only a playlist to play: the page stays in the carousel as its still.
      {
        url: `https://i.pinimg.com/videos/thumbnails/originals/0d/4c/8e/${third}.0000000.jpg`,
        kind: "image",
      },
    ]);
    expect(pin?.sourceVideoUrl).toBeUndefined();
    expect(pin?.origin).toBe("https://cooking.example.com/carnation-cake/");
  });

  it("reads a carousel as every slot in order at 1200 wide", () => {
    const hashes = [HASH, "5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b", "c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6"];
    const pin = parsePinResource(
      resource({
        link: "https://www.instagram.com/p/Rk3Wn8Vq2Lp/",
        carousel_data: {
          type: "pincarouseldata",
          carousel_slots: hashes.map((hash, index) => {
            // A slot names no original, only sized renditions.
            const images: Record<string, unknown> = { ...imagesFor(hash) };
            delete images.orig;
            return { id: `582037199461302${index}`, images, videos: null, title: null };
          }),
        },
      }),
      PIN_ID
    );
    expect(pin?.media).toEqual(hashes.map((hash) => ({ url: pinimg("1200x", hash), kind: "image" })));
    expect(pin?.origin).toBe("https://www.instagram.com/p/Rk3Wn8Vq2Lp/");
  });

  it("does not call a link back into Pinterest an origin", () => {
    for (const link of [
      "https://www.pinterest.com/maple_and_moss/cozy-hallway/",
      "https://pin.it/4kQz9TbWm",
      "javascript:void(0)",
      "",
    ]) {
      expect(parsePinResource(resource({ link }), PIN_ID)?.origin, link).toBeUndefined();
    }
  });

  it("falls back from a missing title to the search title's own part", () => {
    const pin = parsePinResource(
      resource({ seo_title: "Holiday table ideas [Video] | Christmas decor, Hosting" }),
      PIN_ID
    );
    expect(pin?.title).toBe("Holiday table ideas [Video]");
  });

  it("returns null for anything it does not recognise, so the page is read instead", () => {
    expect(parsePinResource(null, PIN_ID)).toBeNull();
    expect(parsePinResource("Invalid Resource Request", PIN_ID)).toBeNull();
    expect(parsePinResource({}, PIN_ID)).toBeNull();
    expect(
      parsePinResource({ resource_response: { status: "failure", data: null } }, PIN_ID)
    ).toBeNull();
    expect(parsePinResource(resource({ images: null }), PIN_ID)).toBeNull();
    expect(parsePinResource(resource({ images: { "736x": { url: "http://insecure/a.jpg" } } }), PIN_ID)).toBeNull();
  });
});

/** A pin's page, trimmed to the tags that matter here, attributes in Pinterest's order. */
function pinPage(options: { ogUrl?: string; appLink?: string; canonical?: string; source?: string; type?: string } = {}): string {
  const tags = [
    `<meta content="Pinterest" property="og:site_name"/>`,
    `<meta content="${pinimg("736x")}" data-app="true" name="og:image" property="og:image"/>`,
    `<meta content="${options.type ?? "pinterestapp:pin"}" data-app="true" name="og:type" property="og:type"/>`,
    `<meta content="Cozy hallway with paper ghosts | Ghost decor, Fall party ideas" data-app="true" name="og:title" property="og:title"/>`,
    `<meta content="Paper ghosts and candles on a hall table." data-app="true" name="og:description" property="og:description"/>`,
    `<meta content="${pinimg("736x")}" data-app="true" name="twitter:image:src" property="twitter:image:src"/>`,
  ];
  if (options.ogUrl) tags.push(`<meta content="${options.ogUrl}" data-app="true" name="og:url" property="og:url"/>`);
  if (options.source) {
    tags.push(`<meta content="${options.source}" data-app="true" name="pinterestapp:source" property="pinterestapp:source"/>`);
  }
  if (options.canonical) tags.push(`<link href="${options.canonical}" rel="canonical"/>`);
  if (options.appLink) {
    tags.push(`<link href="ios-app://518203746/pinterest/pin/${options.appLink}" rel="alternate"/>`);
    tags.push(`<link href="android-app://com.pinterest/pinterest/pin/${options.appLink}" rel="alternate"/>`);
  }
  return `<!DOCTYPE html><html><head>${tags.join("")}</head><body></body></html>`;
}

describe("parsePinPage", () => {
  it("keeps the page's og:image, at 1200 wide", () => {
    const pin = parsePinPage(pinPage(), PIN_ID);
    expect(pin.media).toEqual([{ url: pinimg("1200x"), kind: "image" }]);
    expect(pin.title).toBe("Cozy hallway with paper ghosts");
    expect(pin.description).toBe("Paper ghosts and candles on a hall table.");
  });

  it("keeps a caption the page used as its title to its first line", () => {
    const html = pinPage().replace(
      "Cozy hallway with paper ghosts | Ghost decor, Fall party ideas",
      "Morning or evening?\n\u00b7\n\u00b7\n#slowliving #homeideas"
    );
    expect(parsePinPage(html, PIN_ID).title).toBe("Morning or evening?");
  });

  it("stays at the permalink of the pin asked for, whatever og:url says", () => {
    const pin = parsePinPage(
      pinPage({ ogUrl: `https://uk.pinterest.com/pin/cozy-hallway--${OTHER_PIN_ID}/` }),
      PIN_ID
    );
    expect(pin.url).toBe(`https://www.pinterest.com/pin/${PIN_ID}/`);
    expect(pin.canonical).toBeUndefined();
  });

  it("reads the origin the page names", () => {
    expect(parsePinPage(pinPage({ source: REEL }), PIN_ID).origin).toBe(REEL);
    expect(parsePinPage(pinPage(), PIN_ID).origin).toBeUndefined();
  });

  it("keeps nothing of the front page Pinterest shows in place of a pin it will not show", () => {
    const html =
      `<!DOCTYPE html><html><head>` +
      `<meta content="Best ideas on Pinterest" property="og:title"/>` +
      `<meta content="Discover recipes, home ideas, style inspiration and more." property="og:description"/>` +
      `<title>Best ideas on Pinterest</title></head><body></body></html>`;
    const pin = parsePinPage(html, LETTERED_ID);
    expect(pin).toEqual({
      url: `https://www.pinterest.com/pin/${LETTERED_ID}/`,
      title: "Pinterest pin",
      description: "",
      author: "",
      published: "",
      media: [],
    });
  });
});

describe("pinIdFromPage", () => {
  it("believes the app links first, since og:url can name the pin this one was saved from", () => {
    const html = pinPage({
      appLink: PIN_ID,
      ogUrl: `https://uk.pinterest.com/pin/cozy-hallway--${OTHER_PIN_ID}/`,
      canonical: `https://uk.pinterest.com/pin/cozy-hallway--${OTHER_PIN_ID}/`,
    });
    expect(pinIdFromPage(html)).toBe(PIN_ID);
  });

  it("falls back to og:url, then to the canonical link", () => {
    expect(pinIdFromPage(pinPage({ ogUrl: `https://www.pinterest.com/pin/${PIN_ID}/` }))).toBe(PIN_ID);
    expect(pinIdFromPage(pinPage({ canonical: `https://www.pinterest.com/pin/slug--${PIN_ID}/` }))).toBe(
      PIN_ID
    );
  });

  it("reads an id out of the markup only on a page that calls itself a pin", () => {
    const body = `<a href="/pin/${PIN_ID}/">Open</a>`;
    expect(pinIdFromPage(pinPage().replace("<body>", `<body>${body}`))).toBe(PIN_ID);
    const board = pinPage({ type: "pinterestapp:pinboard" }).replace("<body>", `<body>${body}`);
    expect(pinIdFromPage(board)).toBeNull();
  });

  it("says nothing for a page that is not Pinterest's", () => {
    expect(pinIdFromPage("<html><head><title>Home</title></head></html>")).toBeNull();
  });
});

describe("buildNote and origin", () => {
  const link = (overrides: Partial<ResolvedLink> = {}): ResolvedLink => ({
    url: `https://www.pinterest.com/pin/${PIN_ID}/`,
    title: "Cozy hallway with paper ghosts",
    description: "",
    author: "Maple Moss",
    published: "",
    media: [{ url: pinimg("1200x"), kind: "image" }],
    ...overrides,
  });

  it("writes origin straight after source when the pin has one", () => {
    const lines = buildNote(link({ origin: REEL })).split("\n");
    const source = lines.indexOf(`source: "https://www.pinterest.com/pin/${PIN_ID}/"`);
    expect(source).toBeGreaterThan(0);
    expect(lines[source + 1]).toBe(`origin: "${REEL}"`);
    expect(lines[source + 2]).toBe("author:");
  });

  it("writes no origin line when there is none", () => {
    expect(buildNote(link())).not.toContain("origin:");
  });
});

describe("origin as a property", () => {
  const record = (properties: Record<string, string[]>): ClippingRecord => ({
    path: "a.md",
    title: "",
    source: "",
    description: "",
    categories: [],
    created: "",
    cover: "",
    grid: "",
    folder: "",
    media: [],
    excerpt: "",
    haystack: "",
    properties,
  });

  it("is not offered as a facet, however often pins come from the same places", () => {
    // Two places, four pins each: the spread that makes any other key a facet.
    const places = ["https://example.com/recipes/", REEL];
    const records = places.flatMap((place) =>
      Array.from({ length: 4 }, () => record({ origin: [place], medium: [place] }))
    );
    const suggested = (key: string) =>
      surveyProperties(records).find((stat) => stat.key === key)?.suggested;
    expect(suggested("medium")).toBe(true);
    expect(suggested("origin")).toBe(false);
  });

  it("is not editable, whatever the tags setting says", () => {
    expect(isEditable("origin")).toBe(false);
    expect(isEditable("origin", { allowEditingTags: true })).toBe(false);
    expect(isEditable("  Origin  ", { allowEditingTags: true })).toBe(false);
  });
});
