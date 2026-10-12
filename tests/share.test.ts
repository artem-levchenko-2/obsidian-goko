import { describe, expect, it, vi } from "vitest";
import { canShareFiles, shareFiles, shareNotice, shareType } from "../src/core/share";
import type { ShareHost } from "../src/core/share";

const picture = new File([new Uint8Array([1, 2, 3])], "desk-lamp.jpg", { type: "image/jpeg" });
const video = new File([new Uint8Array([4, 5])], "desk-lamp.mp4", { type: "video/mp4" });

function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

/** A host that takes every set of files and answers share() as told. */
function host(share: () => Promise<void> = () => Promise.resolve()): ShareHost & {
  share: ReturnType<typeof vi.fn>;
  canShare: ReturnType<typeof vi.fn>;
} {
  return { canShare: vi.fn(() => true), share: vi.fn(share) };
}

describe("canShareFiles", () => {
  it("needs both halves of Web Share", () => {
    expect(canShareFiles(host())).toBe(true);
    expect(canShareFiles({ share: () => Promise.resolve() })).toBe(false);
    expect(canShareFiles({})).toBe(false);
    expect(canShareFiles(undefined)).toBe(false);
  });
});

describe("shareFiles", () => {
  it("offers every file in one sheet", async () => {
    const sheet = host();
    expect(await shareFiles(sheet, [picture, video])).toBe("shared");
    expect(sheet.share).toHaveBeenCalledTimes(1);
    expect(sheet.share).toHaveBeenCalledWith({ files: [picture, video] });
  });

  it("asks before offering, with the files themselves", async () => {
    const sheet = host();
    sheet.canShare.mockReturnValue(false);
    expect(await shareFiles(sheet, [video])).toBe("unsupported");
    expect(sheet.canShare).toHaveBeenCalledWith({ files: [video] });
    expect(sheet.share).not.toHaveBeenCalled();
  });

  it("calls share before its first pause, so the tap still counts", () => {
    const sheet = host(() => new Promise(() => {}));
    void shareFiles(sheet, [picture]);
    expect(sheet.share).toHaveBeenCalledTimes(1);
  });

  it("has nothing to say about an empty clipping but that", async () => {
    const sheet = host();
    expect(await shareFiles(sheet, [])).toBe("empty");
    expect(sheet.canShare).not.toHaveBeenCalled();
  });

  it("does not offer files on a host without them", async () => {
    expect(await shareFiles({ share: () => Promise.resolve() }, [picture])).toBe("unsupported");
    expect(await shareFiles(undefined, [picture])).toBe("unsupported");
  });

  it("reads a dismissed sheet as a choice, not a failure", async () => {
    expect(await shareFiles(host(() => Promise.reject(domError("AbortError"))), [picture])).toBe("cancelled");
  });

  it("reads a refusal to count the tap as blocked", async () => {
    expect(await shareFiles(host(() => Promise.reject(domError("NotAllowedError"))), [picture])).toBe("blocked");
  });

  it("reads anything else as failed", async () => {
    expect(await shareFiles(host(() => Promise.reject(domError("DataError"))), [picture])).toBe("failed");
    expect(await shareFiles(host(() => Promise.reject(new Error("boom"))), [picture])).toBe("failed");
  });

  it("knows the DOMException a browser throws by its name", async () => {
    const thrown = new DOMException("Share canceled", "AbortError");
    expect(await shareFiles(host(() => Promise.reject(thrown)), [picture])).toBe("cancelled");
  });
});

describe("shareNotice", () => {
  it("stays quiet when the sheet spoke for itself", () => {
    expect(shareNotice("shared")).toBeNull();
    expect(shareNotice("cancelled")).toBeNull();
  });

  it("asks for a second tap when the files are ready", () => {
    expect(shareNotice("blocked")).toBe("Goko: the files are ready, tap Save a copy again");
  });

  it("says something for every other outcome", () => {
    for (const outcome of ["empty", "unsupported", "failed"] as const) {
      expect(shareNotice(outcome)).toMatch(/^Goko: /);
    }
  });
});

describe("shareType", () => {
  it("names pictures, videos and PDFs, so the sheet offers to save them", () => {
    expect(shareType("desk-lamp.JPG")).toBe("image/jpeg");
    expect(shareType("desk-lamp.mp4")).toBe("video/mp4");
    expect(shareType("manual.pdf")).toBe("application/pdf");
  });

  it("falls back to plain bytes for anything else", () => {
    expect(shareType("notes.txt")).toBe("application/octet-stream");
    expect(shareType("no-extension")).toBe("application/octet-stream");
  });
});
