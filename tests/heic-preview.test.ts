import { describe, expect, it } from "vitest";
import type { CacheEntry } from "../src/core/cache";
import { previewPath } from "../src/core/derive";
import { filesForRefs, liveRefs, orphanFiles } from "../src/core/media-refs";
import {
  MAX_CANVAS_PIXELS,
  PreviewNotices,
  WebviewDecodes,
  localPreviewRefs,
  previewFailure,
  previewNotice,
  previewOutcome,
  previewRoutes,
  previewSize,
} from "../src/core/preview-route";
import type { ClippingRecord } from "../src/core/scan";

const FOLDER = "Attachments/Clippings";
const HEIC = `${FOLDER}/pasted-2031-04-07 081522.heic`;
const PREVIEW = previewPath(HEIC);

function clipping(over: Partial<ClippingRecord> = {}): ClippingRecord {
  return {
    path: "Clippings/Q.md",
    title: "Q",
    source: "",
    description: "",
    categories: [],
    created: "2031-04-07",
    cover: "",
    grid: "",
    folder: "",
    media: [],
    excerpt: "",
    haystack: "",
    properties: {},
    ...over,
  };
}

function entry(key: string, file: string, thumb = ""): CacheEntry {
  return { key, file, thumb, kind: "image", width: 0, height: 0, bytes: 0 };
}

describe("previewRoutes", () => {
  it("sends a picture on a Mac to sips first, and to the webview only behind it", () => {
    expect(previewRoutes("image", { tool: true, webview: true })).toEqual(["tool", "webview"]);
  });

  it("leaves the webview out once it has refused the format this session", () => {
    expect(previewRoutes("image", { tool: true, webview: false })).toEqual(["tool"]);
  });

  it("sends a picture on a phone to the webview, which is all a phone has", () => {
    expect(previewRoutes("image", { tool: false, webview: true })).toEqual(["webview"]);
  });

  it("has nothing to try on a device with neither", () => {
    expect(previewRoutes("image", { tool: false, webview: false })).toEqual([]);
  });

  it("never asks a webview to make a still of a container it cannot play", () => {
    expect(previewRoutes("video", { tool: true, webview: true })).toEqual(["tool"]);
    expect(previewRoutes("video", { tool: false, webview: true })).toEqual([]);
  });
});

describe("previewFailure", () => {
  it("writes a file off when a tool ran and could not read it", () => {
    expect(previewFailure(["tool"])).toBe("conversion failed");
    expect(previewFailure(["tool", "webview"])).toBe("conversion failed");
  });

  it("writes nothing down when only the webview was asked, since that is about the device", () => {
    expect(previewFailure(["webview"])).toBeNull();
  });

  it("writes nothing down when nothing could be tried", () => {
    expect(previewFailure([])).toBeNull();
  });
});

describe("WebviewDecodes", () => {
  it("asks about a format it has not heard of", () => {
    expect(new WebviewDecodes().worthTrying("heic")).toBe(true);
  });

  it("stops asking about a format the webview refused, as Chromium refuses HEIC", () => {
    const memo = new WebviewDecodes();
    memo.record("heic", false);
    expect(memo.worthTrying("heic")).toBe(false);
    expect(memo.worthTrying("HEIC")).toBe(false);
    expect(memo.worthTrying("tiff")).toBe(true);
  });

  it("keeps asking once a format has decoded, so one broken file does not stand for all", () => {
    const memo = new WebviewDecodes();
    memo.record("heic", true);
    memo.record("heic", false);
    expect(memo.worthTrying("heic")).toBe(true);
  });
});

describe("previewSize", () => {
  it("keeps a picture's own size when it fits, as sips does", () => {
    expect(previewSize(1631, 2045)).toEqual({ width: 1631, height: 2045 });
    expect(previewSize(4032, 3024)).toEqual({ width: 4032, height: 3024 });
  });

  it("brings a 24-megapixel photo inside the canvas an iPhone will draw", () => {
    const size = previewSize(5712, 4284);
    expect(size.width * size.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(size.width / size.height).toBeCloseTo(5712 / 4284, 2);
    expect(size.width).toBeGreaterThan(4000);
  });

  it("answers a picture with no size with one pixel rather than none", () => {
    expect(previewSize(0, 0)).toEqual({ width: 1, height: 1 });
  });
});

describe("localPreviewRefs", () => {
  it("includes a HEIC set as the cover, under its own path", () => {
    expect(localPreviewRefs(clipping({ cover: HEIC }))).toEqual([
      { key: HEIC, path: HEIC, kind: "image" },
    ]);
  });

  it("includes a HEIC embedded in the note", () => {
    const record = clipping({ media: [{ url: HEIC, kind: "image", alt: "" }] });
    expect(localPreviewRefs(record)).toEqual([{ key: HEIC, path: HEIC, kind: "image" }]);
  });

  it("names a file once when it is both the cover and an embed", () => {
    const record = clipping({ cover: HEIC, media: [{ url: HEIC, kind: "image", alt: "" }] });
    expect(localPreviewRefs(record)).toHaveLength(1);
  });

  it("leaves out a picture that paints itself, and one that is not in the vault", () => {
    const record = clipping({
      cover: `${FOLDER}/pasted-2031-04-07 081522.jpg`,
      media: [{ url: "https://cdn.example.com/photo.heic", kind: "image", alt: "" }],
    });
    expect(localPreviewRefs(record)).toEqual([]);
  });
});

describe("previewOutcome", () => {
  it("calls a picture that paints itself shown", () => {
    expect(previewOutcome(`${FOLDER}/a.jpg`, undefined)).toBe("shown");
  });

  it("calls a HEIC shown once its preview exists", () => {
    expect(previewOutcome(HEIC, { thumb: PREVIEW })).toBe("shown");
  });

  it("calls a HEIC nothing here could read unsupported", () => {
    expect(previewOutcome(HEIC, { thumb: "" })).toBe("unsupported");
    expect(previewOutcome(HEIC, undefined)).toBe("unsupported");
  });

  it("calls a HEIC sips could not read failed", () => {
    expect(previewOutcome(HEIC, { thumb: "", thumbFailed: "conversion failed" })).toBe("failed");
  });
});

describe("previewNotice", () => {
  it("says nothing extra when the picture shows, so the ordinary confirmation stands", () => {
    expect(previewNotice(HEIC, "shown")).toBeNull();
  });

  it("tells a phone that cannot show a HEIC where it will appear", () => {
    expect(previewNotice(HEIC, "unsupported")).toBe(
      "Goko: saved the picture, but this device can't show HEIC — it will appear once Goko on a Mac converts it"
    );
  });

  it("says when the file itself could not be read", () => {
    expect(previewNotice(HEIC, "failed")).toBe(
      "Goko: saved the picture, but this HEIC could not be converted to show it"
    );
  });

  it("points a video at ffmpeg rather than at a Mac", () => {
    expect(previewNotice(`${FOLDER}/pasted-2031-04-07 081522.avi`, "unsupported")).toBe(
      "Goko: saved the video, but this device can't show AVI — it will appear once Goko on a desktop with ffmpeg converts it"
    );
  });

  it("leaves a PDF to pdf.js, which says its own", () => {
    expect(previewNotice(`${FOLDER}/pasted-2031-04-07 081522.pdf`, "unsupported")).toBeNull();
  });
});

describe("PreviewNotices", () => {
  it("tells a single picture every time", () => {
    const notices = new PreviewNotices();
    expect(notices.after(HEIC, "unsupported")).not.toBeNull();
    expect(notices.after(HEIC, "unsupported")).not.toBeNull();
  });

  it("tells a batch once per format", () => {
    const notices = new PreviewNotices();
    const said = Array.from({ length: 40 }, (_, n) =>
      notices.after(`${FOLDER}/pasted-2031-04-07 0815${String(n).padStart(2, "0")}.heic`, "unsupported", true)
    ).filter(Boolean);
    expect(said).toHaveLength(1);
    expect(notices.after(`${FOLDER}/b.tiff`, "unsupported", true)).toContain("TIFF");
  });

  it("stays quiet in a batch about a picture that shows", () => {
    expect(new PreviewNotices().after(HEIC, "shown", true)).toBeNull();
  });
});

describe("a HEIC cover in the sweep", () => {
  const cache = [entry(HEIC, HEIC, PREVIEW)];
  const onDisk = [HEIC, PREVIEW];

  it("keeps the picture and its preview while the cover points at them", () => {
    const live = liveRefs([clipping({ cover: HEIC })], cache);
    expect(orphanFiles({ live, cache, onDisk })).toEqual([]);
  });

  it("offers both once the cover is cleared and nothing else points at the file", () => {
    const live = liveRefs([clipping({ cover: "" })], cache);
    expect(orphanFiles({ live, cache, onDisk })).toEqual([HEIC, PREVIEW]);
  });

  it("takes both with the clipping when it is deleted", () => {
    const going = liveRefs([clipping({ cover: HEIC })], cache);
    expect(filesForRefs(going, cache).sort()).toEqual([HEIC, PREVIEW].sort());
  });
});
