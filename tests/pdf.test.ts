import { describe, expect, it } from "vitest";
import { hasPdfText, joinTextRuns, pdfTextBlock, pdfPathOf, withPdfText } from "../src/core/pdf";
import type { TextRun } from "../src/core/pdf";
import { bodyText } from "../src/core/scan";
import { scanClipping } from "../src/core/scan";

function clip(front: Record<string, unknown>, body = ""): ReturnType<typeof scanClipping> {
  return scanClipping("Clippings/C.md", { title: "C", ...front }, body);
}

const none = (): string => "";

describe("pdfPathOf", () => {
  it("finds a PDF embedded in the note", () => {
    const record = clip({}, "![[Attachments/Clippings/pasted-2026-09-15.pdf]]");
    expect(pdfPathOf(record, none)).toBe("Attachments/Clippings/pasted-2026-09-15.pdf");
  });

  it("prefers the cover, which is the clipping saying what it is", () => {
    const record = clip({ cover: "Attachments/book.pdf" }, "![[Attachments/a.png]]");
    expect(pdfPathOf(record, none)).toBe("Attachments/book.pdf");
  });

  it("finds the file a PDF link was archived to, which only the cache knows", () => {
    const record = clip({}, "![](https://acme.com/brand-guidelines.pdf)");
    const archived = (key: string): string =>
      key === "https://acme.com/brand-guidelines.pdf"
        ? "Attachments/Clippings/ab12cd34-brand-guidelines.pdf"
        : "";
    expect(pdfPathOf(record, archived)).toBe("Attachments/Clippings/ab12cd34-brand-guidelines.pdf");
  });

  it("says nothing for a PDF that is still only a link", () => {
    // A file on somebody's server is a link, and a link belongs in a
    // browser; the row above the menu's PDF row is the one for it.
    const record = clip({}, "![](https://acme.com/brand-guidelines.pdf)");
    expect(pdfPathOf(record, none)).toBe("");
  });

  it("says nothing for an ordinary clipping", () => {
    expect(pdfPathOf(clip({}, "![[Attachments/a.png]]"), none)).toBe("");
    expect(pdfPathOf(clip({ cover: "https://e.com/a.jpg" }), none)).toBe("");
    expect(pdfPathOf(clip({}), none)).toBe("");
  });

  it("does not read a remote cover as a file in the vault", () => {
    expect(pdfPathOf(clip({ cover: "https://acme.com/book.pdf" }), none)).toBe("");
  });

  it("reads the first ref only, since that is the one the wall is showing", () => {
    // A post whose picture comes first is a post with a PDF attached to it.
    // Clicking that card should open the post, not the attachment.
    const record = clip({}, "![[Attachments/a.png]]\n![[Attachments/notes.pdf]]");
    expect(pdfPathOf(record, none)).toBe("");
  });
});

describe("the text kept from a PDF", () => {
  const body = "![[Attachments/Clippings/book.pdf]]\n";

  it("reaches the search index, which is the whole point of keeping it", () => {
    const next = withPdfText(body, "Helvetica Neue specimen, Linotype 1983");
    expect(bodyText(next)).toContain("linotype");
  });

  it("leaves what was there, and adds under it", () => {
    const next = withPdfText(body, "words");
    expect(next.startsWith(body.trimEnd())).toBe(true);
    expect(next).toContain("> words");
  });

  it("is added once, however many times it is asked for", () => {
    const once = withPdfText(body, "words");
    expect(withPdfText(once, "other words")).toBe(once);
    expect(hasPdfText(once)).toBe(true);
    expect(hasPdfText(body)).toBe(false);
  });

  it("writes down that a scanned PDF has no words, so it is not reopened", () => {
    const next = withPdfText(body, "   \n  ");
    expect(hasPdfText(next)).toBe(true);
    expect(next).toContain("No text layer");
  });

  it("keeps every line inside the callout, blank ones included", () => {
    // A blank line with no > on it ends the callout, and the rest of the
    // text would spill into the note as if it had been written there.
    const block = pdfTextBlock("first\n\nsecond");
    for (const line of block.split("\n")) expect(line.startsWith(">")).toBe(true);
  });

  it("collapses the whitespace a PDF's text layer arrives full of", () => {
    expect(pdfTextBlock("a   b\n\n\n\nc")).toBe("> [!quote]- Text from the PDF\n> a b\n>\n> c");
  });

  it("stops well short of a whole book, at a word boundary", () => {
    const block = pdfTextBlock("word ".repeat(20000));
    expect(block.length).toBeLessThan(12200);
    expect(block).toContain("\u2026");
    expect(block).not.toContain("wor\u2026");
  });
});

describe("joinTextRuns", () => {
  /** A run of glyphs at x, on the line at y, in 12pt. */
  function run(str: string, x: number, y = 700, width = str.length * 6, hasEOL = false): TextRun {
    return { str, width, height: 12, transform: [12, 0, 0, 12, x, y], hasEOL };
  }

  it("puts back the space a PDF does not store", () => {
    // What a Google Docs export gives: two runs side by side with a gap
    // where the space is, and no space in either string.
    expect(joinTextRuns([run("135+", 100), run("currencies", 130)])).toBe("135+ currencies");
  });

  it("does not put one inside a word the writer's software split", () => {
    // Kerned tight against each other: one word, two runs.
    expect(joinTextRuns([run("con", 100, 700, 18), run("version", 118)])).toBe("conversion");
  });

  it("leaves a space that is already there alone", () => {
    expect(joinTextRuns([run("high ", 100), run("conversion", 140)])).toBe("high conversion");
  });

  it("breaks the line where the page does", () => {
    const first = { ...run("first", 100), hasEOL: true };
    expect(joinTextRuns([first, run("second", 100, 680)])).toBe("first\nsecond");
  });

  it("separates two lines even when the page did not mark the break", () => {
    // A run further down the page is a new line whatever the gap says, or
    // the last word of one line runs into the first of the next.
    expect(joinTextRuns([run("first", 300, 700), run("second", 100, 680)])).toBe("first second");
  });

  it("has nothing to say about nothing", () => {
    expect(joinTextRuns([])).toBe("");
    expect(joinTextRuns([run("", 100)])).toBe("");
  });
});
