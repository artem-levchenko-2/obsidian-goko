import { describe, expect, it } from "vitest";
import { LibraryNotices } from "../src/core/lib-notice";

describe("LibraryNotices", () => {
  it("has a notice for the first failure", () => {
    const notices = new LibraryNotices();
    expect(notices.failed("pdfjs")).toBe(
      "Goko: could not load Obsidian's built-in PDF reader, so PDF covers and text will not be read"
    );
  });

  it("stays quiet for every failure after the first, however many there are", () => {
    const notices = new LibraryNotices();
    const said = Array.from({ length: 50 }, () => notices.failed("pdfjs")).filter(Boolean);
    expect(said).toHaveLength(1);
  });

  it("keeps each library to itself, so one going missing does not silence the other", () => {
    const notices = new LibraryNotices();
    expect(notices.failed("pdfjs")).not.toBeNull();
    expect(notices.failed("pdfjs")).toBeNull();
    expect(notices.failed("readability")).toContain("article reader");
    expect(notices.failed("readability")).toBeNull();
    expect(notices.failed("pdfjs")).toBeNull();
  });

  it("says once per library across interleaved failures, as a batch of PDFs and clips would", () => {
    const notices = new LibraryNotices();
    const order = ["pdfjs", "readability", "pdfjs", "pdfjs", "readability", "pdfjs"] as const;
    const said = order.map((library) => notices.failed(library)).filter((notice) => notice !== null);
    expect(said).toHaveLength(2);
    expect(said[0]).toContain("PDF reader");
    expect(said[1]).toContain("article reader");
  });

  it("starts over in a new session", () => {
    const first = new LibraryNotices();
    first.failed("readability");
    expect(new LibraryNotices().failed("readability")).not.toBeNull();
  });

  it("words every notice the way the plugin's others are worded", () => {
    const notices = new LibraryNotices();
    for (const library of ["pdfjs", "readability"] as const) {
      const notice = notices.failed(library) ?? "";
      expect(notice.startsWith("Goko: ")).toBe(true);
      // Sentence case: after the prefix, nothing is capitalised but the
      // names that are always capitalised.
      const words = notice.slice("Goko: ".length).split(" ");
      const capitalised = words.filter((word) => /^[A-Z]/.test(word));
      expect(capitalised.every((word) => /^(Obsidian's|PDF)$/.test(word))).toBe(true);
    }
  });
});
