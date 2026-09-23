import { describe, expect, it, vi } from "vitest";
import { archiveOne } from "../src/core/archive";
import type { ArchiveDeps, Fetcher } from "../src/core/archive";
import type { CanonicalMedia } from "../src/core/normalize";
import { parsePageMeta } from "../src/core/resolve";
import { headerValue } from "../src/core/response-headers";

// An invented id of the real shape: 11 characters of base64url.
const VIDEO = "Qm3vXt8Lp_Z";
const WATCH = `https://www.youtube.com/watch?v=${VIDEO}`;
const EMBED = `https://www.youtube.com/embed/${VIDEO}`;
const POSTER = `https://i.ytimg.com/vi/${VIDEO}/maxresdefault.jpg`;

function bytesOf(...values: number[]): ArrayBuffer {
  const b = new Uint8Array(64);
  b.set(values, 0);
  return b.buffer;
}

function asciiBuffer(text: string): ArrayBuffer {
  const b = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) b[i] = text.charCodeAt(i);
  return b.buffer;
}

const PLAYER_PAGE = asciiBuffer(
  '<!DOCTYPE html><html lang="en" dir="ltr"><head><title>Player</title></head><body></body></html>'
);
const JPEG = bytesOf(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46);
// A size, then "ftyp" and the isom brand: how an MP4 opens.
const MP4 = bytesOf(0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d);

const videoMedia: CanonicalMedia = { key: EMBED, url: EMBED, kind: "video", alt: "" };
const imageMedia: CanonicalMedia = { key: POSTER, url: POSTER, kind: "image", alt: "" };

function deps(fetch: Fetcher): ArchiveDeps & { write: ReturnType<typeof vi.fn> } {
  return {
    fetch,
    exists: vi.fn(async () => false),
    write: vi.fn(async () => {}),
    folder: "Attachments/Clippings",
    maxBytes: 26214400,
  };
}

describe("headerValue", () => {
  it("finds a header whatever case its name arrived in", () => {
    for (const name of ["Content-Type", "content-type", "CONTENT-TYPE", "content-Type"]) {
      expect(headerValue({ [name]: "video/mp4" }, "content-type")).toBe("video/mp4");
    }
  });

  it("finds it whatever case it is asked for in", () => {
    expect(headerValue({ "content-type": "image/png" }, "Content-Type")).toBe("image/png");
  });

  it("answers undefined for a header the response does not carry", () => {
    expect(headerValue({ "Content-Length": "12" }, "content-type")).toBeUndefined();
    expect(headerValue({}, "content-type")).toBeUndefined();
    expect(headerValue(undefined, "content-type")).toBeUndefined();
    expect(headerValue(null, "content-type")).toBeUndefined();
  });

  it("keeps an empty value rather than reading it as absent", () => {
    expect(headerValue({ "Content-Type": "" }, "content-type")).toBe("");
  });
});

describe("parsePageMeta and a video host's player", () => {
  const playerHtml =
    `<meta property="og:image" content="${POSTER}">` +
    `<meta property="og:video:url" content="${EMBED}">` +
    `<meta property="og:video:secure_url" content="${EMBED}">` +
    '<meta property="og:video:type" content="text/html">';

  it("keeps only the poster when og:video names a page", () => {
    expect(parsePageMeta(playerHtml, WATCH).media).toEqual([{ url: POSTER, kind: "image" }]);
  });

  it("reads any declared type that is not a video's as a player", () => {
    const html = playerHtml.replace("text/html", "application/x-shockwave-flash");
    expect(parsePageMeta(html, WATCH).media).toEqual([{ url: POSTER, kind: "image" }]);
  });

  it("still takes a video file the page declares as one", () => {
    const html =
      '<meta property="og:image" content="https://cdn.example/a.jpg">' +
      '<meta property="og:video" content="https://cdn.example/a.mp4">' +
      '<meta property="og:video:type" content="video/mp4">';
    expect(parsePageMeta(html, "https://example.com/post").media).toEqual([
      { url: "https://cdn.example/a.mp4", kind: "video" },
      { url: "https://cdn.example/a.jpg", kind: "image" },
    ]);
  });

  it("still takes a video whose page declares no type", () => {
    const html =
      '<meta property="og:image" content="https://cdn.example/a.jpg">' +
      '<meta property="og:video" content="https://cdn.example/a.mp4">';
    expect(parsePageMeta(html, "https://example.com/post").media[0]).toEqual({
      url: "https://cdn.example/a.mp4",
      kind: "video",
    });
  });
});

describe("archiveOne and a response with no content type", () => {
  it("refuses markup that names no type", async () => {
    const d = deps(vi.fn(async () => ({ status: 200, arrayBuffer: PLAYER_PAGE })));
    const out = await archiveOne(videoMedia, "", d);
    expect(out.failed).toBe("unexpected content type (none)");
    expect(d.write).not.toHaveBeenCalled();
  });

  it("refuses it under an empty header too", async () => {
    const d = deps(vi.fn(async () => ({ status: 200, arrayBuffer: PLAYER_PAGE, contentType: "" })));
    expect((await archiveOne(videoMedia, "", d)).failed).toBe("unexpected content type (none)");
  });

  it("accepts a JPEG or an MP4 that names no type", async () => {
    for (const [media, arrayBuffer] of [
      [imageMedia, JPEG],
      [videoMedia, MP4],
    ] as const) {
      const d = deps(vi.fn(async () => ({ status: 200, arrayBuffer })));
      const out = await archiveOne(media, "", d);
      expect(out.failed).toBeUndefined();
      expect(d.write).toHaveBeenCalledOnce();
    }
  });

  it("refuses a player page whose header name is capitalised, as iOS gives it", async () => {
    // The shell's fetcher, in miniature: a response as requestUrl returns it
    // on a phone, read the way archive-service reads it.
    const response = {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" } as Record<string, string>,
      arrayBuffer: PLAYER_PAGE,
    };
    const fetch: Fetcher = async () => ({
      status: response.status,
      arrayBuffer: response.arrayBuffer,
      contentType: headerValue(response.headers, "content-type"),
    });
    const d = deps(fetch);
    const out = await archiveOne(videoMedia, "", d);
    expect(out.failed).toBe("unexpected content type text/html");
    expect(d.write).not.toHaveBeenCalled();
  });
});
