import { describe, expect, it } from "vitest";
import { hasMediaToArchive, pictureRefused } from "../src/core/page-video";

const PICTURE = { url: "https://cdn.example.com/v/t51.29350-15/1111_2222_n.jpg", kind: "image" as const };
const VIDEO_URL = "https://cdn.example.com/o1/v/t16/f2/m69/AbCdEfGhIjKl.mp4?efg=eyJ4IjoxfQ&oh=00_AbC&oe=6AB3D2F7";
const SLOT = "Goko/attachments/0f1e2d3c4b5a6978-video.mp4";

describe("hasMediaToArchive", () => {
  it("is true for a link with a picture", () => {
    expect(hasMediaToArchive({ media: [PICTURE] })).toBe(true);
  });

  it("is true for a link whose only media is the address of the post's video", () => {
    // A Threads video post once its avatar is set aside: nothing in media,
    // and the video is still there to fetch.
    expect(hasMediaToArchive({ media: [], sourceVideoUrl: VIDEO_URL })).toBe(true);
  });

  it("is false for a link with neither", () => {
    expect(hasMediaToArchive({ media: [] })).toBe(false);
  });

  it("does not count an empty address as a video", () => {
    expect(hasMediaToArchive({ media: [], sourceVideoUrl: "" })).toBe(false);
  });
});

describe("pictureRefused", () => {
  it("is true when every picture was refused and no video landed", () => {
    expect(pictureRefused([true, true], null)).toBe(true);
  });

  it("is false when a picture got through", () => {
    expect(pictureRefused([true, false], null)).toBe(false);
  });

  it("is false when the post's own video landed, since it becomes the cover", () => {
    expect(pictureRefused([true], SLOT)).toBe(false);
  });

  it("is false for a link that named no picture and whose video landed", () => {
    // every() over nothing is true, which is what made the notice fire for
    // a clip that had nothing but its video and got it.
    expect(pictureRefused([], SLOT)).toBe(false);
  });

  it("is false for a link that named no picture at all", () => {
    expect(pictureRefused([], null)).toBe(false);
  });
});
