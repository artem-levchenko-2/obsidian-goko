import { describe, expect, it } from "vitest";
import { exportFiles } from "../src/core/export-files";
import { normalizeUrl, sourceVideoKeyFor } from "../src/core/normalize";
import type { MediaRef } from "../src/core/scan";

const FOLDER = "Attachments/Clippings";

function image(url: string): MediaRef {
  return { url, kind: "image", alt: "" };
}

/** A cache lookup over a plain map of key to archived file. */
function archive(files: Record<string, string>) {
  const byKey = new Map(Object.entries(files));
  return (key: string) => byKey.get(key);
}

describe("exportFiles", () => {
  it("hands over only the pulled video for a reel, not its poster as well", () => {
    const source = "https://social.example.com/reel/Qx7mP2kLr9A/";
    const poster = "https://cdn.example.com/v/t51/48213_poster.jpg";
    const record = { source, media: [image(poster)] };
    const lookup = archive({
      [sourceVideoKeyFor(source)]: `${FOLDER}/3f9a0c1d7e2b-reel.mp4`,
      [normalizeUrl(poster)]: `${FOLDER}/8b41e6d0a95c-reel-poster.jpg`,
    });

    expect(exportFiles(record, lookup)).toEqual([`${FOLDER}/3f9a0c1d7e2b-reel.mp4`]);
  });

  it("hands over every archived picture of an ordinary post, in order", () => {
    const urls = [
      "https://cdn.example.com/media/one.jpg",
      "https://cdn.example.com/media/two.png",
      "https://cdn.example.com/media/three.webp",
    ];
    const record = { source: "https://social.example.com/post/1", media: urls.map(image) };
    const lookup = archive({
      [normalizeUrl(urls[0])]: `${FOLDER}/a1b2c3d4e5f6-one.jpg`,
      [normalizeUrl(urls[1])]: `${FOLDER}/0f1e2d3c4b5a-two.png`,
      [normalizeUrl(urls[2])]: `${FOLDER}/9e8d7c6b5a40-three.webp`,
    });

    expect(exportFiles(record, lookup)).toEqual([
      `${FOLDER}/a1b2c3d4e5f6-one.jpg`,
      `${FOLDER}/0f1e2d3c4b5a-two.png`,
      `${FOLDER}/9e8d7c6b5a40-three.webp`,
    ]);
  });

  it("hands over an embedded vault file as it stands, beside archived ones", () => {
    const remote = "https://cdn.example.com/media/one.jpg";
    const embedded = `${FOLDER}/pasted-2026-08-18 215104.png`;
    const record = { source: "", media: [image(embedded), image(remote)] };
    const lookup = archive({ [normalizeUrl(remote)]: `${FOLDER}/a1b2c3d4e5f6-one.jpg` });

    expect(exportFiles(record, lookup)).toEqual([embedded, `${FOLDER}/a1b2c3d4e5f6-one.jpg`]);
  });

  it("falls back to the page's media when the video pull left no file", () => {
    const source = "https://social.example.com/reel/Qx7mP2kLr9A/";
    const poster = "https://cdn.example.com/v/t51/48213_poster.jpg";
    const record = { source, media: [image(poster)] };
    // A failed pull is still a cache entry, only one without a file.
    const lookup = archive({
      [sourceVideoKeyFor(source)]: "",
      [normalizeUrl(poster)]: `${FOLDER}/8b41e6d0a95c-reel-poster.jpg`,
    });

    expect(exportFiles(record, lookup)).toEqual([`${FOLDER}/8b41e6d0a95c-reel-poster.jpg`]);
  });

  it("leaves out media that has not been archived yet", () => {
    const record = { source: "", media: [image("https://cdn.example.com/media/one.jpg")] };
    expect(exportFiles(record, archive({}))).toEqual([]);
  });
});
