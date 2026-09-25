import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  amazonOriginal,
  amazonProduct,
  bareLink,
  buildScanNote,
  cleanUrl,
  directMediaKind,
  directMediaLink,
  firstHttpUrl,
  fxApiUrl,
  instagramEmbedUrl,
  instagramPost,
  isHttpUrl,
  isThreadsUrl,
  noteNameFor,
  parseAmazonPage,
  parseFxTweet,
  parseInstagramEmbed,
  parsePageMeta,
  pickSniffedVideo,
  pickThreadsImages,
  refineThreadsLink,
  sharedHttpUrl,
  supportsSourceDownload,
  threadsPostCode,
  xStatus,
} from "../src/core/resolve";
import {
  INSTAGRAM_BROKEN_EMBED,
  INSTAGRAM_CAROUSEL_EMBED,
  INSTAGRAM_REEL_EMBED,
} from "./fixtures/instagram";

describe("cleanUrl", () => {
  it("strips the share parameter you get from a copy button", () => {
    expect(cleanUrl("https://x.com/a/status/123?s=20")).toBe("https://x.com/a/status/123");
  });

  it("strips utm parameters", () => {
    expect(cleanUrl("https://e.com/a?utm_source=x&utm_medium=y")).toBe("https://e.com/a");
  });

  it("keeps parameters that identify content", () => {
    expect(cleanUrl("https://youtube.com/watch?v=abc&s=20")).toBe(
      "https://youtube.com/watch?v=abc"
    );
  });

  it("trims surrounding whitespace from a paste", () => {
    expect(cleanUrl("  https://e.com/a  ")).toBe("https://e.com/a");
  });

  it("returns unparseable input unchanged", () => {
    expect(cleanUrl("not a url")).toBe("not a url");
  });
});

describe("isHttpUrl", () => {
  it("accepts http and https", () => {
    expect(isHttpUrl("https://e.com")).toBe(true);
    expect(isHttpUrl("http://e.com")).toBe(true);
  });

  it("rejects other schemes and plain text", () => {
    expect(isHttpUrl("obsidian://open")).toBe(false);
    expect(isHttpUrl("file:///tmp/a")).toBe(false);
    expect(isHttpUrl("just some copied text")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});

describe("xStatus", () => {
  it("recognises an x.com status", () => {
    expect(xStatus("https://x.com/someone/status/1234567890123456789")).toEqual({
      user: "someone",
      id: "1234567890123456789",
    });
  });

  it("recognises twitter.com and mobile hosts", () => {
    expect(xStatus("https://twitter.com/a/status/123456")?.user).toBe("a");
    expect(xStatus("https://mobile.x.com/a/status/123456")?.user).toBe("a");
  });

  it("ignores query parameters", () => {
    expect(xStatus("https://x.com/a/status/123456?s=20")?.id).toBe("123456");
  });

  it("returns null for a profile url", () => {
    expect(xStatus("https://x.com/someone")).toBeNull();
  });

  it("returns null for another host", () => {
    expect(xStatus("https://www.threads.com/@a/post/B")).toBeNull();
  });

  it("builds the resolver endpoint", () => {
    expect(fxApiUrl({ user: "a", id: "123" })).toBe("https://api.fxtwitter.com/a/status/123");
  });
});

describe("parseFxTweet", () => {
  const payload = {
    tweet: {
      url: "https://x.com/someone/status/1234567890123456789",
      text: "What if you could just slide away the input when you want to read?\nSecond line",
      created_at: "Mon Aug 11 09:00:00 +0000 2026",
      author: { name: "Eduard" },
      media: {
        videos: [{ type: "video", url: "https://video.twimg.com/a/38KA2aK29RyqEM5a.mp4?tag=29" }],
        all: [{ type: "video", url: "https://video.twimg.com/a/38KA2aK29RyqEM5a.mp4?tag=29" }],
      },
    },
  };

  it("pulls the video url out", () => {
    const out = parseFxTweet(payload, "https://x.com/x/status/1")!;
    expect(out.media).toHaveLength(1);
    expect(out.media[0].kind).toBe("video");
    expect(out.media[0].url).toContain(".mp4");
  });

  it("does not repeat media listed under several keys", () => {
    expect(parseFxTweet(payload, "")!.media).toHaveLength(1);
  });

  it("uses the author and first line of text as the title", () => {
    const out = parseFxTweet(payload, "")!;
    expect(out.title).toContain("Eduard");
    expect(out.title).toContain("slide away the input");
    expect(out.title).not.toContain("Second line");
  });

  it("keeps the full text as the description", () => {
    expect(parseFxTweet(payload, "")!.description).toContain("Second line");
  });

  it("caps the title length", () => {
    const long = {
      tweet: { ...payload.tweet, text: "x".repeat(400), media: {} },
    };
    expect(parseFxTweet(long, "")!.title.length).toBeLessThanOrEqual(120);
  });

  it("classifies photos as images", () => {
    const photos = {
      tweet: { ...payload.tweet, media: { photos: [{ type: "photo", url: "https://p/1.jpg" }] } },
    };
    expect(parseFxTweet(photos, "")!.media[0].kind).toBe("image");
  });

  it("returns a link with no media when the post has none", () => {
    const bare = { tweet: { ...payload.tweet, media: {} } };
    expect(parseFxTweet(bare, "")!.media).toEqual([]);
  });

  it("returns null for a malformed payload", () => {
    expect(parseFxTweet(null, "")).toBeNull();
    expect(parseFxTweet({}, "")).toBeNull();
    expect(parseFxTweet({ tweet: "nope" }, "")).toBeNull();
  });

  it("falls back to the source url when the payload has none", () => {
    const noUrl = { tweet: { ...payload.tweet, url: undefined } };
    expect(parseFxTweet(noUrl, "https://fallback")!.url).toBe("https://fallback");
  });
});

describe("parsePageMeta", () => {
  const base = "https://www.threads.com/@a/post/B";

  it("reads title, description and image", () => {
    const html =
      '<meta property="og:title" content="A post">' +
      '<meta property="og:description" content="Some words">' +
      '<meta property="og:image" content="https://cdn/a.jpg">';
    const out = parsePageMeta(html, base);
    expect(out.title).toBe("A post");
    expect(out.description).toBe("Some words");
    expect(out.media).toEqual([{ url: "https://cdn/a.jpg", kind: "image" }]);
  });

  it("puts video ahead of the poster image", () => {
    const html =
      '<meta property="og:image" content="https://cdn/a.jpg">' +
      '<meta property="og:video" content="https://cdn/a.mp4">';
    const out = parsePageMeta(html, base);
    expect(out.media[0].kind).toBe("video");
    expect(out.media[1].kind).toBe("image");
  });

  it("prefers the secure video url", () => {
    const html =
      '<meta property="og:video" content="http://cdn/a.mp4">' +
      '<meta property="og:video:secure_url" content="https://cdn/a.mp4">';
    expect(parsePageMeta(html, base).media[0].url).toBe("https://cdn/a.mp4");
  });

  it("resolves relative urls against the page", () => {
    expect(parsePageMeta('<meta property="og:image" content="/a.jpg">', base).media[0].url).toBe(
      "https://www.threads.com/a.jpg"
    );
  });

  it("does not repeat an image declared twice", () => {
    const html =
      '<meta property="og:image" content="https://cdn/a.jpg">' +
      '<meta name="twitter:image" content="https://cdn/a.jpg">';
    expect(parsePageMeta(html, base).media).toHaveLength(1);
  });

  it("returns empty media for a page with no tags", () => {
    expect(parsePageMeta("<html></html>", base).media).toEqual([]);
  });
});

describe("bareLink", () => {
  it("is a clipping made of nothing but its address", () => {
    expect(bareLink("https://medium.com/@a/b")).toEqual({
      url: "https://medium.com/@a/b",
      title: "",
      description: "",
      author: "",
      published: "",
      media: [],
    });
  });

  it("leaves the title empty, so the name falls back to the host and path", () => {
    // A guess dressed up as a title is worse than the address itself.
    const link = bareLink("https://dribbble.com/shots/26034556");
    expect(noteNameFor(link.title, link.url)).toBe("dribbble.com shots 26034556");
  });
});

describe("noteNameFor", () => {
  it("uses the title", () => {
    expect(noteNameFor("A good post", "https://e.com/a")).toBe("A good post");
  });

  it("strips characters that break vault paths", () => {
    expect(noteNameFor('a/b:c*d?"e<f>g|h#i^j[k]', "https://e.com")).not.toMatch(
      /[\\/:*?"<>|#^[\]]/
    );
  });

  it("collapses whitespace", () => {
    expect(noteNameFor("a    b", "https://e.com")).toBe("a b");
  });

  it("caps the length", () => {
    expect(noteNameFor("x".repeat(300), "https://e.com").length).toBeLessThanOrEqual(100);
  });

  it("falls back to the url when there is no title", () => {
    expect(noteNameFor("", "https://x.com/a/status/123")).toBe("x.com a status 123");
  });

  it("never returns an empty name", () => {
    expect(noteNameFor("", "not a url")).toBe("Untitled clipping");
    expect(noteNameFor("///", "not a url")).toBe("Untitled clipping");
  });

  it("never starts with a dot, which hides the note from Obsidian", () => {
    expect(noteNameFor(". walking home.", "https://e.com")).toBe("walking home");
    expect(noteNameFor(".Nightshift", "https://e.com")).toBe("Nightshift");
  });

  it("never starts with an underscore, which the index skips", () => {
    expect(noteNameFor("________Moodboard", "https://e.com")).toBe("Moodboard");
    expect(noteNameFor("_ draft", "https://e.com")).toBe("draft");
  });

  it("never ends with a dot, which Windows refuses", () => {
    expect(noteNameFor("Copper Lamp ..", "https://e.com")).toBe("Copper Lamp");
    expect(noteNameFor("x".repeat(99) + " .", "https://e.com")).toBe("x".repeat(99));
  });

  it("keeps the dots and underscores inside a name", () => {
    expect(noteNameFor("v1.2 release_notes", "https://e.com")).toBe("v1.2 release_notes");
  });

  it("falls back to the url when the title is only dots", () => {
    expect(noteNameFor(".", "https://e.com/a")).toBe("e.com a");
    expect(noteNameFor("...", "not a url")).toBe("Untitled clipping");
  });
});

describe("directMediaKind", () => {
  it("recognises a video url", () => {
    expect(directMediaKind("https://cdn/a.mp4")).toBe("video");
    expect(directMediaKind("https://cdn/a.webm")).toBe("video");
  });

  it("recognises an image url", () => {
    expect(directMediaKind("https://cdn/a.jpg")).toBe("image");
    expect(directMediaKind("https://cdn/a.PNG")).toBe("image");
  });

  it("sees through a long signed query string", () => {
    const fbcdn =
      "https://instagram.fymq2-1.fna.fbcdn.net/o1/v/t16/f2/m84/AQMh5iLz.mp4?_nc_cat=104&oe=6A8576AC";
    expect(directMediaKind(fbcdn)).toBe("video");
  });

  it("returns null for a page url", () => {
    expect(directMediaKind("https://www.threads.com/@a/post/B")).toBeNull();
    expect(directMediaKind("https://x.com/a/status/123")).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(directMediaKind("not a url")).toBeNull();
  });
});

describe("directMediaLink", () => {
  it("uses the filename in the title", () => {
    expect(directMediaLink("https://cdn/clip.mp4", "video").title).toBe("Video: clip.mp4");
  });

  it("falls back to the host when there is no filename", () => {
    expect(directMediaLink("https://cdn.example.com/", "image").title).toBe(
      "Image from cdn.example.com"
    );
  });

  it("carries exactly one media item of the given kind", () => {
    const out = directMediaLink("https://cdn/a.mp4", "video");
    expect(out.media).toEqual([{ url: "https://cdn/a.mp4", kind: "video" }]);
  });
});

describe("instagramPost", () => {
  it("recognises a reel", () => {
    expect(instagramPost("https://www.instagram.com/reel/DaX4yElxg7_/")).toEqual({
      kind: "reel",
      code: "DaX4yElxg7_",
    });
  });

  it("normalises the plural reels path", () => {
    expect(instagramPost("https://www.instagram.com/reels/DaX4yElxg7_/")?.kind).toBe("reel");
  });

  it("recognises a post and a tv url", () => {
    expect(instagramPost("https://instagram.com/p/ABC12345/")?.kind).toBe("p");
    expect(instagramPost("https://instagram.com/tv/ABC12345/")?.kind).toBe("tv");
  });

  it("ignores query parameters", () => {
    expect(instagramPost("https://www.instagram.com/reel/DaX4yElxg7_/?igsh=x")?.code).toBe(
      "DaX4yElxg7_"
    );
  });

  it("returns null for a profile or another host", () => {
    expect(instagramPost("https://www.instagram.com/someuser/")).toBeNull();
    expect(instagramPost("https://www.threads.com/@a/post/B")).toBeNull();
    expect(instagramPost("not a url")).toBeNull();
  });

  it("marks instagram and x as downloadable by a local yt-dlp", () => {
    expect(supportsSourceDownload("https://www.instagram.com/reel/ABC/")).toBe(true);
    expect(supportsSourceDownload("https://x.com/a/status/1")).toBe(true);
  });

  it("does not spend a subprocess on an ordinary article", () => {
    expect(supportsSourceDownload("https://www.polygon.com/article")).toBe(false);
    expect(supportsSourceDownload("not a url")).toBe(false);
  });


});

describe("amazonProduct", () => {
  it("recognises a product page on any Amazon storefront", () => {
    expect(amazonProduct("https://www.amazon.ca/Putting-Out-Your-Mind-Rotella/dp/0743212134")).toEqual(
      { asin: "0743212134" }
    );
    expect(amazonProduct("https://www.amazon.co.uk/gp/product/B08N5WRWNW?th=1")).toEqual({
      asin: "B08N5WRWNW",
    });
    expect(amazonProduct("https://amazon.com/dp/B08N5WRWNW/ref=sr_1_1")).toEqual({
      asin: "B08N5WRWNW",
    });
  });

  it("ignores the rest of Amazon, and the rest of the web", () => {
    expect(amazonProduct("https://www.amazon.ca/s?k=golf")).toBeNull();
    expect(amazonProduct("https://www.amazonaws.com/dp/B08N5WRWNW")).toBeNull();
    expect(amazonProduct("https://example.com/dp/B08N5WRWNW")).toBeNull();
    expect(amazonProduct("not a url")).toBeNull();
  });
});

describe("amazonOriginal", () => {
  it("strips the size modifier so the CDN serves the original", () => {
    expect(amazonOriginal("https://m.media-amazon.com/images/I/61f8IVzjEDL._SL1000_.jpg")).toBe(
      "https://m.media-amazon.com/images/I/61f8IVzjEDL.jpg"
    );
    expect(
      amazonOriginal("https://m.media-amazon.com/images/I/41LnLW+QvpL._SX38_SY50_CR,0,0,38,50_.jpg")
    ).toBe("https://m.media-amazon.com/images/I/41LnLW+QvpL.jpg");
  });

  it("leaves an image that has no modifier, or is not Amazon's, alone", () => {
    expect(amazonOriginal("https://m.media-amazon.com/images/I/61f8IVzjEDL.jpg")).toBe(
      "https://m.media-amazon.com/images/I/61f8IVzjEDL.jpg"
    );
    expect(amazonOriginal("https://example.com/a._SL1000_.jpg")).toBe("https://example.com/a._SL1000_.jpg");
  });
});

describe("parseAmazonPage", () => {
  const html = readFileSync(new URL("./fixtures/amazon-product.html", import.meta.url), "utf8");
  const url = "https://www.amazon.ca/Putting-Out-Your-Mind-Rotella/dp/0743212134";

  it("takes the hi-res cover at its original size", () => {
    const link = parseAmazonPage(html, url);
    expect(link.media).toEqual([
      { url: "https://m.media-amazon.com/images/I/61f8IVzjEDL.jpg", kind: "image" },
    ]);
  });

  it("titles the clipping by the product, not the storefront", () => {
    expect(parseAmazonPage(html, url).title).toBe("Putting Out of Your Mind");
  });

  it("falls back to the hiRes entry, then the page title, when the landing image is missing", () => {
    const stripped = html.replace(/data-old-hires="[^"]*"/, "").replace(/<span id="productTitle"[\s\S]*?<\/span>/, "");
    const link = parseAmazonPage(stripped, url);
    expect(link.media[0]?.url).toBe("https://m.media-amazon.com/images/I/61f8IVzjEDL.jpg");
    expect(link.title).toBe("Putting Out of Your Mind: Rotella, Dr. Bob: 9780743212137: Books");
  });

  it("gives up cleanly on a page with no cover", () => {
    expect(parseAmazonPage("<html><title>x</title></html>", url).media).toEqual([]);
  });
});

describe("parsePageMeta title fallback", () => {
  it("uses the document title when a page declares no og:title", () => {
    const link = parsePageMeta("<html><head><title>Plain &amp; simple</title></head></html>", "https://example.com/");
    expect(link.title).toBe("Plain & simple");
  });
});

describe("firstHttpUrl", () => {
  it("returns a bare URL as itself", () => {
    expect(firstHttpUrl("https://www.instagram.com/reel/abc/")).toBe(
      "https://www.instagram.com/reel/abc/"
    );
  });

  it("pulls the URL out of share-sheet prose", () => {
    expect(firstHttpUrl("Check this out! https://x.com/user/status/123 so good")).toBe(
      "https://x.com/user/status/123"
    );
  });

  it("takes the first URL when there are several", () => {
    expect(firstHttpUrl("https://a.com/1 and https://b.com/2")).toBe("https://a.com/1");
  });

  it("drops sentence punctuation stuck to the end", () => {
    expect(firstHttpUrl("look: https://a.com/post.")).toBe("https://a.com/post");
    expect(firstHttpUrl("(see https://a.com/post)")).toBe("https://a.com/post");
  });

  it("keeps query strings and fragments intact", () => {
    expect(firstHttpUrl("https://a.com/watch?v=x&t=1#top here")).toBe(
      "https://a.com/watch?v=x&t=1#top"
    );
  });

  it("returns null when there is no link at all", () => {
    expect(firstHttpUrl("just some words")).toBeNull();
    expect(firstHttpUrl("")).toBeNull();
  });

  it("ignores non-web schemes", () => {
    expect(firstHttpUrl("mailto:a@b.com ftp://x")).toBeNull();
  });
});

describe("sharedHttpUrl", () => {
  it("passes a clean URL or prose straight through firstHttpUrl", () => {
    expect(sharedHttpUrl("https://a.com/x")).toBe("https://a.com/x");
    expect(sharedHttpUrl("look https://a.com/x now")).toBe("https://a.com/x");
  });

  it("recovers a URL that arrived percent-encoded", () => {
    // iOS Shortcuts' Open URL action can re-encode an already-encoded
    // value, so the handler may receive the encoding instead of the URL.
    expect(sharedHttpUrl("https%3A%2F%2Fa.com%2Freel%2Fx%2F")).toBe("https://a.com/reel/x/");
  });

  it("recovers a URL that arrived encoded twice", () => {
    expect(sharedHttpUrl("https%253A%252F%252Fa.com%252Fx")).toBe("https://a.com/x");
  });

  it("keeps the recovered URL's own query intact", () => {
    expect(sharedHttpUrl("https%3A%2F%2Fa.com%2Freel%3Figsh%3Dabc")).toBe(
      "https://a.com/reel?igsh=abc"
    );
  });

  it("returns null for text with no URL under any decoding", () => {
    expect(sharedHttpUrl("just words")).toBeNull();
    expect(sharedHttpUrl("")).toBeNull();
    // A lone percent sign makes decodeURIComponent throw; that must not escape.
    expect(sharedHttpUrl("100% organic")).toBeNull();
  });
});

describe("isThreadsUrl", () => {
  it("matches threads.com and threads.net posts, www or bare", () => {
    expect(isThreadsUrl("https://www.threads.com/@someone/post/DAAAAAAAAAA")).toBe(true);
    expect(isThreadsUrl("https://threads.net/@a/post/x")).toBe(true);
    expect(isThreadsUrl("https://www.threads.com/share/BAVz6_-9G3/")).toBe(true);
  });

  it("rejects other hosts and junk", () => {
    expect(isThreadsUrl("https://www.instagram.com/reel/x/")).toBe(false);
    expect(isThreadsUrl("not a url")).toBe(false);
  });
});

describe("pickSniffedVideo", () => {
  it("picks the first fetchable mp4 and strips byte-range windowing", () => {
    expect(
      pickSniffedVideo([
        "https://static.cdninstagram.com/rsrc.php/app.js",
        "https://scontent.cdninstagram.com/o1/v/t16/f2/m86/clip.mp4?efg=abc&bytestart=0&byteend=131071",
      ])
    ).toBe("https://scontent.cdninstagram.com/o1/v/t16/f2/m86/clip.mp4?efg=abc");
  });

  it("prefers the video element's own source when it is a real URL", () => {
    expect(
      pickSniffedVideo(["https://cdn.example.com/v/clip.mp4?sig=1", "https://cdn.example.com/other.mp4"])
    ).toBe("https://cdn.example.com/v/clip.mp4?sig=1");
  });

  it("ignores blob and data sources, which cannot be fetched", () => {
    expect(pickSniffedVideo(["blob:app://obsidian.md/uuid", "data:video/mp4;base64,AAAA"])).toBeNull();
  });

  it("ignores DASH segments and posters", () => {
    expect(
      pickSniffedVideo([
        "https://cdn.example.com/v/init.m4s",
        "https://cdn.example.com/v/poster.jpg",
      ])
    ).toBeNull();
  });

  it("returns null with nothing to pick", () => {
    expect(pickSniffedVideo([])).toBeNull();
    expect(pickSniffedVideo([""])).toBeNull();
  });
});

describe("buildScanNote", () => {
  it("shapes a scan like a link clipping, with the scan as its cover", () => {
    const note = buildScanNote(
      "Weblate",
      "https://hosted.weblate.org/",
      "Attachments/Clippings/scan-2026-08-31 120000.png",
      "2026-08-31"
    );
    expect(note).toContain('title: "Weblate"');
    expect(note).toContain('source: "https://hosted.weblate.org/"');
    expect(note).toContain('  - "clippings"');
    expect(note).toContain('cover: "Attachments/Clippings/scan-2026-08-31 120000.png"');
    expect(note).toContain("![[Attachments/Clippings/scan-2026-08-31 120000.png]]");
    expect(note).toContain("[https://hosted.weblate.org/](https://hosted.weblate.org/)");
    expect(note).not.toContain("grid:");
  });

  it("stamps the grid only when the capture is going somewhere other than home", () => {
    const note = buildScanNote("T", "https://a.example/", "a.png", "2026-08-31", "Reading");
    expect(note).toContain('grid: "Reading"');
  });
});

describe("refineThreadsLink", () => {
  const base = {
    url: "https://www.threads.com/share/PAAAAAAAA/",
    title: "쿄포유 (@someone) у додатку Threads",
    description: "섹쉬한 건캐논과 건담",
    author: "",
    published: "",
    media: [],
  };

  it("makes the post's text the title and the handle the author", () => {
    const out = refineThreadsLink(base);
    expect(out.title).toBe("섹쉬한 건캐논과 건담");
    expect(out.author).toBe("@someone");
    expect(out.description).toBe("섹쉬한 건캐논과 건담");
  });

  it("names the author when the post has no text", () => {
    expect(refineThreadsLink({ ...base, description: "" }).title).toBe("@someone on Threads");
  });

  it("cuts a long post at a word and marks the cut", () => {
    const long = "word ".repeat(40).trim();
    const out = refineThreadsLink({ ...base, description: long });
    expect(out.title.length).toBeLessThanOrEqual(91);
    expect(out.title.endsWith("…")).toBe(true);
    expect(out.title).not.toMatch(/ …$/);
  });

  it("keeps an author the page already named", () => {
    expect(refineThreadsLink({ ...base, author: "Someone" }).author).toBe("Someone");
  });

  it("falls back to the page title when neither text nor handle can be read", () => {
    expect(refineThreadsLink({ ...base, title: "Threads", description: "" }).title).toBe("Threads");
  });

  it("composes with parsePageMeta the way capture applies it", () => {
    const html = [
      '<meta property="og:title" content="&#xac00; (&#064;someone) &#x443; &#x434;&#x43e;&#x434;&#x430;&#x442;&#x43a;&#x443; Threads">',
      '<meta property="og:description" content="&#xc139;&#xc26c;&#xd55c;">',
      '<meta property="og:image" content="https://scontent.cdninstagram.com/v/t51.82787-15/a.jpg">',
    ].join("");
    const out = refineThreadsLink(parsePageMeta(html, "https://www.threads.com/@someone/post/x"));
    expect(out.title).toBe("섹쉬한");
    expect(out.author).toBe("@someone");
  });
});

describe("pickThreadsImages", () => {
  it("keeps post media and drops avatars, by the CDN path", () => {
    const urls = [
      "https://scontent.cdninstagram.com/v/t51.2885-19/avatar.jpg?x=1",
      "https://scontent.cdninstagram.com/v/t51.82787-15/one.jpg?x=1",
      "https://scontent.cdninstagram.com/v/t51.71878-15/two.jpg?x=2",
    ];
    expect(pickThreadsImages(urls)).toEqual([urls[1], urls[2]]);
  });

  it("dedupes renditions of one picture on the path, keeping the first", () => {
    const urls = [
      "https://scontent.cdninstagram.com/v/t51.82787-15/one.jpg?w=640",
      "https://scontent.cdninstagram.com/v/t51.82787-15/one.jpg?w=1080",
    ];
    expect(pickThreadsImages(urls)).toEqual([urls[0]]);
  });

  it("ignores other hosts, other formats, and junk", () => {
    expect(
      pickThreadsImages([
        "https://static.threads.com/logo.png",
        "https://scontent.cdninstagram.com/v/t51.82787-15/a.svg",
        "not a url",
      ])
    ).toEqual([]);
  });

  it("keeps page order", () => {
    const urls = [
      "https://scontent.cdninstagram.com/v/t51.82787-15/c.jpg",
      "https://scontent.cdninstagram.com/v/t51.82787-15/a.jpg",
    ];
    expect(pickThreadsImages(urls)).toEqual(urls);
  });
});

describe("threadsPostCode", () => {
  it("reads the code out of a permalink", () => {
    expect(threadsPostCode("https://www.threads.com/@someone/post/DPh6tHOE8Uj?xmt=abc")).toBe("DPh6tHOE8Uj");
  });

  it("is empty for a share link, which has no code to anchor on", () => {
    expect(threadsPostCode("https://www.threads.com/share/P7fRdL5e6/")).toBe("");
  });
});

describe("parsePageMeta canonical", () => {
  it("carries og:url so a share link can be traded for the permalink", () => {
    const html = '<meta property="og:url" content="https://www.threads.com/&#064;someone/post/DPh6tHOE8Uj">';
    expect(parsePageMeta(html, "https://www.threads.com/share/x/").canonical).toBe(
      "https://www.threads.com/@someone/post/DPh6tHOE8Uj"
    );
  });

  it("leaves canonical unset when the page names none", () => {
    expect(parsePageMeta("<html></html>", "https://example.com/").canonical).toBeUndefined();
  });
});

describe("instagramEmbedUrl", () => {
  it("always asks for /p/, whichever way the link was written", () => {
    // Instagram treats /p/, /reel/ and /tv/ as one address and the embed
    // answers for all three; verified against a real reel.
    expect(instagramEmbedUrl("AAAAAAAAAAA")).toBe(
      "https://www.instagram.com/p/AAAAAAAAAAA/embed/captioned/"
    );
  });
});

describe("parseInstagramEmbed", () => {
  it("finds every picture of a carousel, in order", () => {
    const post = parseInstagramEmbed(INSTAGRAM_CAROUSEL_EMBED);
    expect(post?.media).toHaveLength(3);
    expect(post?.media.every((m) => m.kind === "image")).toBe(true);
    expect(post?.media.map((m) => m.url.split("/").pop()?.split("?")[0])).toEqual([
      "100000001_100000000000000001_1000000000000000001_n.jpg",
      "100000002_100000000000000002_1000000000000000002_n.jpg",
      "100000003_100000000000000003_1000000000000000003_n.jpg",
    ]);
  });

  it("takes the uncropped address, not the square one the og: tag carries", () => {
    // The og: image is signed for stp=c282.0.847.847a…_s640x640 — a square
    // crop at 640, and the crop cannot be edited out because it is part of
    // what the signature covers. These are signed without it.
    const post = parseInstagramEmbed(INSTAGRAM_CAROUSEL_EMBED);
    for (const media of post?.media ?? []) {
      expect(media.url).toContain("stp=dst-jpg_e35");
      expect(media.url).not.toMatch(/s\d+x\d+/);
      expect(media.url).not.toMatch(/stp=c\d/);
    }
  });

  it("reads the account that posted it, which the page never says", () => {
    expect(parseInstagramEmbed(INSTAGRAM_CAROUSEL_EMBED)?.author).toBe("someone");
  });

  it("takes the post itself when there are no children", () => {
    // A single picture and a video are the same object without children;
    // a video's display_url is its poster, which is what a wall shows and
    // is a real poster rather than the square the og: tag would have given.
    const post = parseInstagramEmbed(INSTAGRAM_REEL_EMBED);
    expect(post?.media).toHaveLength(1);
    expect(post?.media[0]).toMatchObject({ kind: "image" });
    expect(post?.media[0].url).toContain("100000001");
  });

  it("answers nothing for a page with no post in it, so the og: tags stand", () => {
    expect(parseInstagramEmbed("<html><body>nothing here</body></html>")).toBeNull();
    expect(parseInstagramEmbed('<html>gql_data but no json</html>')).toBeNull();
    expect(parseInstagramEmbed('<script>{"x":"gql_data"}</script>')).toBeNull();
  });

  it("answers nothing rather than throwing on a blob it cannot read", () => {
    // How a shape change arrives: the anchor is still there and what is
    // under it is not what it was. The clipping then keeps its og: tags.
    expect(() => parseInstagramEmbed(INSTAGRAM_BROKEN_EMBED)).not.toThrow();
    expect(parseInstagramEmbed(INSTAGRAM_BROKEN_EMBED)).toBeNull();
  });
});
