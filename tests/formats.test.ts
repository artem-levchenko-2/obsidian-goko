import { describe, expect, it } from "vitest";
import {
  defaultExtension,
  extensionForMime,
  extensionOf,
  isExcluded,
  isRenderable,
  isSupported,
  kindForExtension,
  kindForMime,
  needsPreview,
} from "../src/core/formats";

const IMAGES = [
  "png", "jpeg", "gif", "webp", "tiff", "bmp", "ico", "icns", "heic", "raw", "exr", "hdr",
];
const VIDEOS = ["mp4", "mov", "webm", "avi"];

describe("the requested format matrix", () => {
  it.each(IMAGES)("supports .%s as an image", (ext) => {
    expect(kindForExtension(ext)).toBe("image");
  });

  it.each(VIDEOS)("supports .%s as video", (ext) => {
    expect(kindForExtension(ext)).toBe("video");
  });

  it("treats gif and webp as images, since that is how they are painted", () => {
    expect(kindForExtension("gif")).toBe("image");
    expect(kindForExtension("webp")).toBe("image");
  });

  it("excludes svg", () => {
    expect(isExcluded("svg")).toBe(true);
    expect(kindForExtension("svg")).toBeNull();
    expect(isSupported("svg")).toBe(false);
  });

  it("covers the common raw vendor extensions", () => {
    for (const ext of ["dng", "cr2", "cr3", "nef", "arw", "raf", "orf", "rw2", "pef"]) {
      expect(kindForExtension(ext)).toBe("image");
    }
  });

  it("rejects something the wall could not show at all", () => {
    expect(kindForExtension("zip")).toBeNull();
    expect(kindForExtension("docx")).toBeNull();
    expect(kindForExtension("")).toBeNull();
  });

  it("takes a PDF, which is shown as its rendered first page", () => {
    expect(kindForExtension("pdf")).toBe("image");
  });
});

describe("renderable versus opaque", () => {
  it("knows what Chromium can paint directly", () => {
    for (const ext of ["png", "jpg", "gif", "webp", "bmp", "ico", "avif"]) {
      expect(isRenderable(ext)).toBe(true);
      expect(needsPreview(ext)).toBe(false);
    }
  });

  it("flags formats that need a generated preview", () => {
    for (const ext of ["tiff", "heic", "icns", "exr", "hdr", "dng", "cr2"]) {
      expect(isRenderable(ext)).toBe(false);
      expect(needsPreview(ext)).toBe(true);
    }
  });

  it("knows mp4 and webm play inline but avi does not", () => {
    expect(isRenderable("mp4")).toBe(true);
    expect(isRenderable("webm")).toBe(true);
    expect(isRenderable("avi")).toBe(false);
    expect(needsPreview("avi")).toBe(true);
  });

  it("never asks for a preview of an unsupported format", () => {
    expect(needsPreview("svg")).toBe(false);
    expect(needsPreview("zip")).toBe(false);
  });

  it("asks for one for a PDF, which Chromium will not paint in an <img>", () => {
    expect(isRenderable("pdf")).toBe(false);
    expect(needsPreview("pdf")).toBe(true);
  });

  it("is case insensitive", () => {
    expect(kindForExtension("PNG")).toBe("image");
    expect(isRenderable("JPG")).toBe(true);
    expect(needsPreview("HEIC")).toBe(true);
  });
});

describe("extensionOf", () => {
  it("reads a plain url", () => {
    expect(extensionOf("https://cdn/a.PNG")).toBe("png");
  });

  it("ignores query and fragment", () => {
    expect(extensionOf("https://cdn/a.mp4?tag=29#t=1")).toBe("mp4");
  });

  it("reads a bare path", () => {
    expect(extensionOf("Attachments/Clippings/a.heic")).toBe("heic");
  });

  it("returns empty when there is no extension", () => {
    expect(extensionOf("https://pbs.twimg.com/media/HP7q")).toBe("");
    expect(extensionOf("https://cdn/")).toBe("");
  });

  it("is not fooled by a dot in a folder name", () => {
    expect(extensionOf("My.Files/photo")).toBe("");
  });
});

describe("extensionForMime", () => {
  it("maps image types", () => {
    expect(extensionForMime("image/png")).toBe("png");
    expect(extensionForMime("image/heic")).toBe("heic");
    expect(extensionForMime("image/tiff")).toBe("tiff");
  });

  it("maps video types", () => {
    expect(extensionForMime("video/mp4")).toBe("mp4");
    expect(extensionForMime("video/quicktime")).toBe("mov");
    expect(extensionForMime("video/x-msvideo")).toBe("avi");
  });

  it("ignores parameters and case", () => {
    expect(extensionForMime("IMAGE/PNG; charset=binary")).toBe("png");
  });

  it("falls back by family for an unknown type", () => {
    expect(extensionForMime("video/x-weird")).toBe("mp4");
    expect(extensionForMime("image/x-weird")).toBe("png");
  });
});

describe("kindForMime", () => {
  it("answers by family, which is all a clipboard item gives you", () => {
    expect(kindForMime("image/png")).toBe("image");
    expect(kindForMime("image/x-never-heard-of-it")).toBe("image");
    expect(kindForMime("video/quicktime")).toBe("video");
  });

  it("ignores parameters and case, as the MIME spec allows either", () => {
    expect(kindForMime("IMAGE/PNG; charset=binary")).toBe("image");
  });

  it("knows the one type the wall takes that is not a picture's", () => {
    expect(kindForMime("application/pdf")).toBe("image");
  });

  it("says no to everything else, whatever it calls itself", () => {
    expect(kindForMime("text/plain")).toBeNull();
    expect(kindForMime("application/zip")).toBeNull();
    expect(kindForMime("")).toBeNull();
  });
});

describe("defaultExtension", () => {
  it("differs by kind", () => {
    expect(defaultExtension("image")).toBe("jpg");
    expect(defaultExtension("video")).toBe("mp4");
  });
});
