import { describe, expect, it } from "vitest";
import { LibraryNotices } from "../src/core/lib-notice";
import { blankPdf, hasPdfText, pdfReadReport, readPdfIntoNote } from "../src/core/pdf";
import type { PdfNote, PdfText } from "../src/core/pdf";

/** A note held in memory, which records every time it is written to. */
function noteWith(body: string, reading: PdfText) {
  const state = { body, writes: 0, opened: 0 };
  const note: PdfNote = {
    body: () => Promise.resolve(state.body),
    text: () => {
      state.opened++;
      return Promise.resolve(reading);
    },
    write: (edit) => {
      state.writes++;
      state.body = edit(state.body);
      return Promise.resolve();
    },
  };
  return { note, state };
}

const clipping = "---\ntitle: Specimen\n---\n![[Attachments/Clippings/specimen.pdf]]\n";
const missing: PdfText = { ok: false, reason: "Obsidian's pdf.js would not load" };
const scanned: PdfText = { ok: true, text: "" };

describe("a PDF read without a reader", () => {
  it("leaves the note exactly as it was, and unwritten", async () => {
    const { note, state } = noteWith(clipping, missing);
    expect(await readPdfIntoNote(note)).toBe("waiting");
    expect(state.body).toBe(clipping);
    expect(state.writes).toBe(0);
    expect(hasPdfText(state.body)).toBe(false);
  });

  it("is read on the next pass that has one", async () => {
    const { note, state } = noteWith(clipping, missing);
    await readPdfIntoNote(note);
    const later = noteWith(state.body, { ok: true, text: "Grotesk specimen, second cut" });
    expect(await readPdfIntoNote(later.note)).toBe("read");
    expect(later.state.body).toContain("> Grotesk specimen, second cut");
  });

  it("is not the same answer as a PDF with no words in it", async () => {
    const without = noteWith(clipping, missing);
    const empty = noteWith(clipping, scanned);
    expect(await readPdfIntoNote(without.note)).toBe("waiting");
    expect(await readPdfIntoNote(empty.note)).toBe("read");
    // The scanned one is written down as read, so it is never opened again;
    // the other is not, so it will be.
    expect(empty.state.body).toContain("No text layer");
    expect(without.state.body).not.toContain("No text layer");
  });

  it("does not open the document for a note that has its text already", async () => {
    const read = noteWith(clipping, { ok: true, text: "words" });
    await readPdfIntoNote(read.note);
    const again = noteWith(read.state.body, missing);
    expect(await readPdfIntoNote(again.note)).toBe("skipped");
    expect(again.state.opened).toBe(0);
    expect(again.state.writes).toBe(0);
  });
});

describe("what reading every PDF reports", () => {
  it("does not claim a pass that could open nothing read them all", () => {
    const report = pdfReadReport({ read: 0, waiting: 3, total: 3 });
    expect(report).not.toContain("read 3 of 3");
    expect(report).not.toContain("the rest were read already");
    expect(report).toContain("read 0 of 3 PDFs");
    expect(report).toContain("3 are left for a later run");
    expect(report).toContain("PDF reader would not load");
  });

  it("counts the ones read already apart from the ones left waiting", () => {
    expect(pdfReadReport({ read: 2, waiting: 1, total: 5 })).toBe(
      "Goko: read 2 of 5 PDFs (2 read already); 1 is left for a later run, " +
        "because Obsidian's built-in PDF reader would not load"
    );
  });

  it("says what it said before when the reader is there", () => {
    expect(pdfReadReport({ read: 3, waiting: 0, total: 3 })).toBe("Goko: read 3 of 3 PDFs");
    expect(pdfReadReport({ read: 1, waiting: 0, total: 3 })).toBe(
      "Goko: read 1 of 3 PDFs (the rest were read already)"
    );
    expect(pdfReadReport({ read: 0, waiting: 0, total: 0 })).toBe("Goko: no PDFs in the library");
  });
});

describe("the blank page pdf.js is tried on", () => {
  const text = new TextDecoder().decode(blankPdf());

  it("is a PDF from its first byte to its last", () => {
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.endsWith("%%EOF\n")).toBe(true);
  });

  it("points its cross-reference table at the table itself", () => {
    const startxref = Number(/startxref\n(\d+)\n/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 5)).toBe("xref\n");
  });

  it("has every object where the table says it is", () => {
    const entries = [...text.matchAll(/^(\d{10}) 00000 n \n/gm)].map((match) => Number(match[1]));
    expect(entries).toHaveLength(3);
    entries.forEach((offset, index) => {
      expect(text.slice(offset).startsWith(`${index + 1} 0 obj\n`)).toBe(true);
    });
  });

  it("keeps every entry in the table twenty bytes long, as the format fixes", () => {
    const table = /xref\n0 4\n([\s\S]*?)trailer/.exec(text)?.[1] ?? "";
    expect(table.length).toBe(4 * 20);
  });

  it("is a page, not an empty file, so that opening it proves something", () => {
    expect(text).toContain("/Type /Page ");
    expect(text).toContain("/Count 1");
  });

  it("is made afresh each time, since pdf.js takes the bytes it is given", () => {
    expect(blankPdf()).not.toBe(blankPdf());
  });
});

describe("Turndown going missing", () => {
  it("has a notice of its own, in the words of the other two", () => {
    const notice = new LibraryNotices().failed("turndown") ?? "";
    expect(notice).toBe(
      "Goko: could not find Obsidian's built-in markdown converter, so clipped articles will be saved without their text"
    );
    const words = notice.slice("Goko: ".length).split(" ");
    expect(words.filter((word) => /^[A-Z]/.test(word))).toEqual(["Obsidian's"]);
  });

  it("is said once a session, however many pages are clipped", () => {
    const notices = new LibraryNotices();
    const said = Array.from({ length: 40 }, () => notices.failed("turndown")).filter(Boolean);
    expect(said).toHaveLength(1);
  });

  it("does not silence Readability, nor Readability it, though an article needs both", () => {
    const notices = new LibraryNotices();
    expect(notices.failed("turndown")).not.toBeNull();
    expect(notices.failed("readability")).not.toBeNull();
    expect(notices.failed("turndown")).toBeNull();
    expect(notices.failed("readability")).toBeNull();
    expect(notices.failed("pdfjs")).not.toBeNull();
  });
});
