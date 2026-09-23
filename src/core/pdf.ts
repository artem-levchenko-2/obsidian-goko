/**
 * Which clippings are PDFs, and where the file is.
 *
 * A PDF is shown on the wall as a picture of its first page, which is the
 * right answer for a wall and the wrong one for a click: what you want when
 * you click a brand book is the brand book, and Obsidian has a reader for it
 * already. So the wall needs to be able to ask "is this card a document?"
 * without knowing anything about how it got here.
 *
 * Pure: no Obsidian, no DOM. Where an archived file lives is the caller's to
 * answer, because a PDF that arrived as a link is on disk under a name only
 * the media cache knows.
 */

import { extensionOf } from "./formats";
import { dedupeMedia } from "./normalize";
import type { ClippingRecord } from "./scan";

function isRemote(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function isPdf(path: string): boolean {
  return extensionOf(path) === "pdf";
}

/**
 * The PDF a clipping is, as a vault path, or "" when it is not one.
 *
 * A hand-set cover leads, as it does everywhere else: pointing `cover:` at a
 * document is saying this clipping is that document. Then the media, in the
 * order the note lists it, so a post with a picture and a PDF beside it
 * opens as the post rather than as its attachment — the first ref is the one
 * the wall is showing.
 *
 * Only files that are in the vault. A PDF still sitting on someone's server
 * is a link, and a link belongs in a browser, which is the row above.
 *
 * @param archived the file archived for a media key, or "" for none.
 */
export function pdfPathOf(record: ClippingRecord, archived: (key: string) => string): string {
  if (record.cover && !isRemote(record.cover) && isPdf(record.cover)) return record.cover;

  // The first ref only, because it is the one the wall is showing. A post
  // whose picture comes first is a post with a PDF attached to it, and
  // clicking that card should open the post, not the attachment.
  for (const media of dedupeMedia(record.media)) {
    const file = isRemote(media.url) ? archived(media.key) : media.url;
    return file && isPdf(file) ? file : "";
  }

  return "";
}

/**
 * The line that opens the extracted text, and the way the note remembers it
 * has been read. A callout rather than a plain heading: what is under it is
 * the document's own words, not yours, and a collapsed callout says that
 * before anyone reads a line of it.
 */
const TEXT_HEADING = "> [!quote]- Text from the PDF";

/** What a PDF with no text layer gets, so it is not read again every pass. */
const NO_TEXT = "No text layer: this PDF is pictures of pages.";

/**
 * How much of the text is kept.
 *
 * Comfortably inside the twenty thousand characters scan.ts feeds to the
 * search index, so every word kept is a word findable — the earlier
 * twelve-over-ten reading of that had it backwards, and the tail of a long
 * PDF was in the note and out of the index. Still far short of a whole book:
 * a clipping whose note is forty pages of somebody else's prose is no longer
 * a clipping about the picture on it.
 */
const TEXT_LIMIT = 12000;

/** Whether this note has already been read, whatever came of it. */
export function hasPdfText(body: string): boolean {
  return body.includes(TEXT_HEADING);
}

/**
 * The text as a block to put in a note.
 *
 * Empty text is written down as such, on purpose. A scanned PDF has no words
 * to find and never will have; saying so once is what stops every later pass
 * opening a two-hundred-page document to learn the same thing again.
 */
export function pdfTextBlock(text: string): string {
  const prose = tidy(text);
  const lines = (prose || NO_TEXT).split("\n").map((line) => `> ${line}`.trimEnd());
  return [TEXT_HEADING, ...lines].join("\n");
}

/**
 * The note's body with the text added, or unchanged if it is already there.
 *
 * Appended rather than woven in: the body above it is the clipping — the
 * picture, and whatever you wrote about it — and this is a reference copy
 * underneath, which is where a reference copy belongs.
 */
export function withPdfText(body: string, text: string): string {
  if (hasPdfText(body)) return body;
  return `${body.replace(/\s+$/, "")}\n\n${pdfTextBlock(text)}\n`;
}

/**
 * What came of asking pdf.js for a PDF's words.
 *
 * Two answers that look alike and are opposites. A document with no text
 * layer has been read, and "" is what is in it: writing that down is what
 * stops every later pass opening it again. A reader that would not load has
 * read nothing, so nothing is known about the file, and the same line
 * written for it would be wrong and permanent, since every later pass takes
 * the heading as the PDF having been read.
 */
export type PdfText = { ok: true; text: string } | { ok: false; reason: string };

/**
 * What reading one clipping's PDF came to. "skipped" is a note with nothing
 * to read, because its text is there already or it has no PDF; "waiting" is
 * one whose PDF could not be opened because the reader was missing, and
 * which is left for a session that has one.
 */
export type PdfRead = "read" | "skipped" | "waiting";

/** A clipping's note and its PDF, as reading one into the other needs them. */
export interface PdfNote {
  /** The note's body as it is now. */
  body(): Promise<string>;
  /** The PDF's words, asked for only once the note is known to need them. */
  text(): Promise<PdfText>;
  /** Rewrites the note, handing `edit` the body as it is at the moment of writing. */
  write(edit: (body: string) => string): Promise<void>;
}

/**
 * Reads a clipping's PDF into its note, unless there is nothing to do.
 *
 * The note is read before the document is opened: opening one to find the
 * note already has its text is the cost that check exists to avoid. And a
 * note whose PDF could not be read is not written to at all, not even with
 * a line saying so — the next pass that has a reader is the one to read it.
 */
export async function readPdfIntoNote(note: PdfNote): Promise<PdfRead> {
  if (hasPdfText(await note.body())) return "skipped";
  const reading = await note.text();
  if (!reading.ok) return "waiting";
  await note.write((body) => withPdfText(body, reading.text));
  return "read";
}

/** How a pass over every PDF in the library went. */
export interface PdfTally {
  read: number;
  waiting: number;
  total: number;
}

/**
 * What "Read the text out of every PDF" says when it is done.
 *
 * A PDF left waiting is neither read nor one of "the rest were read
 * already", and a pass that could open nothing must not come back saying it
 * read them all or that there was nothing left to read. It says how many
 * are left and why, so that the command is worth running again once the
 * reader is back.
 */
export function pdfReadReport({ read, waiting, total }: PdfTally): string {
  if (total === 0) return "Goko: no PDFs in the library";
  const already = total - read - waiting;
  if (waiting === 0) {
    return `Goko: read ${read} of ${total} PDFs${already > 0 ? " (the rest were read already)" : ""}`;
  }
  const done = already > 0 ? ` (${already} read already)` : "";
  const left = waiting === 1 ? "1 is" : `${waiting} are`;
  return (
    `Goko: read ${read} of ${total} PDFs${done}; ${left} left for a later run, ` +
    "because Obsidian's built-in PDF reader would not load"
  );
}

/**
 * The smallest document that is a whole PDF: one blank page, and a
 * cross-reference table with its offsets counted rather than typed, so that
 * a reader opens it as written instead of rebuilding it.
 *
 * It is what tells a reader that cannot open anything from a file that
 * cannot be opened. A PDF that fails to open looks the same either way, and
 * this one cannot be at fault: if it will not open, nothing will.
 */
export function blankPdf(): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  // Twenty bytes an entry, the space before the newline included: that is
  // what the format fixes, and what lets a reader seek straight to one.
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

/** Runs of space collapsed, runs of blank lines cut to one, and cut to length
    at a word boundary rather than mid-word. */
function tidy(text: string): string {
  const prose = text
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (prose.length <= TEXT_LIMIT) return prose;
  const cut = prose.slice(0, TEXT_LIMIT);
  const space = cut.lastIndexOf(" ");
  return `${space > TEXT_LIMIT / 2 ? cut.slice(0, space) : cut}…`;
}

/**
 * One run of glyphs as pdf.js reports it.
 *
 * `transform` is the run's matrix; its last two numbers are where the run
 * starts on the page. With `width` that is enough to tell one word ending
 * and another beginning from a word that a writer's software happened to
 * split in two.
 */
export interface TextRun {
  str?: string;
  hasEOL?: boolean;
  width?: number;
  height?: number;
  transform?: number[];
}

/**
 * How wide a gap between two runs counts as a space, as a fraction of the
 * type size. An eighth is well clear of the kerning inside a word and well
 * under the width of a real space.
 */
const SPACE_GAP = 0.125;

/** Type size for a run that does not report one, which is rare. */
const NOMINAL_TYPE = 10;

/**
 * The runs of one page, joined back into words.
 *
 * A PDF has no spaces in it. It has runs of glyphs at positions, and where a
 * space would be there is simply a gap — so joining the runs as they come
 * gives "highconversion" and "135+currenciesHosted", which is neither
 * readable nor findable. The gap is the space, and it is measurable: a run
 * starting further right than the last one ended, by an eighth of the type
 * size or more, had a space between them. Less than that is one word split
 * in two, and putting a space there would be the same mistake reversed.
 */
export function joinTextRuns(runs: readonly TextRun[]): string {
  const parts: string[] = [];
  let end: number | null = null;
  let line: number | null = null;

  for (const run of runs) {
    const text = run.str ?? "";
    if (text) {
      const x = run.transform?.[4] ?? 0;
      const y = run.transform?.[5] ?? 0;
      const size = run.height || NOMINAL_TYPE;
      const sameLine = line !== null && Math.abs(y - line) <= size * 0.5;
      const gap = end === null ? 0 : x - end;
      const last = parts[parts.length - 1] ?? "";
      const spaced = /\s$/.test(last) || /^\s/.test(text);
      if (last && !spaced && (!sameLine || gap > size * SPACE_GAP)) parts.push(" ");
      parts.push(text);
      end = x + (run.width ?? 0);
      line = y;
    }
    if (run.hasEOL) {
      parts.push("\n");
      end = null;
      line = null;
    }
  }

  return parts.join("");
}
