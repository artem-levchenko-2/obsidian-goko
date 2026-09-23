/**
 * The first page of a PDF, rendered to a PNG the wall can paint.
 *
 * A reference library that cannot take a PDF is missing the format half the
 * references live in: portfolios, brand books, type specimens, case studies.
 * The wall shows pictures, so what a PDF needs is a picture of itself, and
 * its first page is the picture it already has — a cover, in the literal
 * sense the word came from.
 *
 * Obsidian ships pdf.js: it is what its own PDF view renders with, bundled
 * at /lib/pdfjs together with its worker, its cmaps and its standard fonts.
 * That matters more than convenience. Every other format the plugin cannot
 * decode goes out to a separate program — sips for HEIC, ffmpeg for an AVI —
 * and those are macOS, desktop, and absent on a phone, where at most an
 * iPhone's own webview reads some of them. This one runs
 * wherever Obsidian runs, with nothing installed.
 *
 * Not pure, and cannot be: it needs a canvas and the app's own module. The
 * decisions worth testing live in core/formats.ts and core/pdf.ts, which are.
 */

import { Notice } from "obsidian";
import { libraryNotices } from "./core/lib-notice";
import { blankPdf, joinTextRuns } from "./core/pdf";
import type { PdfText, TextRun } from "./core/pdf";

/**
 * Where Obsidian keeps its copy. Its own PDF view loads exactly these.
 *
 * None of this is API. They are files inside the app, at the paths it keeps
 * them at today, and an update may move or rename any of them without a
 * word. They are borrowed anyway because the alternative is shipping pdf.js
 * in the bundle: about 1.6 MB, most of it the worker, to duplicate a copy
 * every person running the plugin already has.
 *
 * If the module will not load, or loads and will not open a blank page,
 * pdfjs() says so once a session, and nothing is written down about any
 * file in the meantime: covers are tried again on a later pass, and a note
 * is left without its text until "Read the text out of every PDF" runs in a
 * session that can read it. After a major Obsidian update, clip a PDF and
 * check it gets a cover, and run that command on one; if either fails, look
 * for these five paths in the app's lib folder, and check that the module
 * still defines `window.pdfjsLib`. The worker is the one that goes quietly:
 * the module loads without it, and only a document failing to open shows it
 * is gone, which is why pdfjs() opens one before it answers.
 */
const MODULE = "/lib/pdfjs/pdf.min.mjs";
const WORKER = "/lib/pdfjs/pdf.worker.min.mjs";
const CMAPS = "/lib/pdfjs/cmaps/";
const FONTS = "/lib/pdfjs/standard_fonts/";
const WASM = "/lib/pdfjs/wasm/";

/**
 * How wide the rendered page is, in pixels.
 *
 * Wide enough that the wall's largest stage shows type rather than grey
 * strokes, and small enough that a hundred of them are not a second library
 * on disk. A page is rendered once and kept; the tile scales it down.
 */
const COVER_WIDTH = 900;

/**
 * How long the blank page is given to open before pdf.js counts as missing.
 *
 * It opens in a fraction of a second, a phone's first worker included, and
 * a worker that is not there fails well inside that. This is for the one
 * that loads and never answers, which would otherwise hold every cover and
 * every text behind it for the rest of the session.
 */
const CHECK_TIMEOUT = 15000;

/** Why nothing could be read, for the caller's log. */
const MISSING = "Obsidian's pdf.js would not load";

/**
 * How many pages' worth of words are read for the search index.
 *
 * Not the whole document. A two-hundred-page book's full text in a note is
 * a clipping that is no longer about the picture on it, and the terms worth
 * finding — whose brand book this is, which typeface the specimen sets —
 * are on the pages at the front.
 */
const TEXT_PAGES = 12;

interface PdfViewport {
  width: number;
  height: number;
}

interface PdfPage {
  getViewport(options: { scale: number }): PdfViewport;
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): {
    promise: Promise<void>;
  };
  getTextContent(): Promise<{ items: TextRun[] }>;
}

interface PdfDocument {
  numPages: number;
  getPage(number: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
  /** Stops the load, and closes the document if it has opened. */
  destroy(): Promise<void>;
}

interface PdfjsLib {
  getDocument(options: Record<string, unknown>): PdfLoadingTask;
  GlobalWorkerOptions: { workerSrc: string };
}

/**
 * What came of asking for a PDF's first page.
 *
 * `retry` separates the two failures that look alike and are not: a build
 * whose pdf.js will not load or will not start its worker may have one that
 * does after the next update, so nothing about the file should be written
 * down; a page that threw while rendering will throw again every pass, and
 * recording that is what stops the archiver paying for it forever.
 */
export type PdfCover =
  | { ok: true; png: ArrayBuffer; width: number; height: number }
  | { ok: false; retry: boolean; reason: string };

let loading: Promise<PdfjsLib | null> | null = null;
let checking: Promise<boolean> | null = null;

function libNow(): PdfjsLib | null {
  const held = (window as unknown as { pdfjsLib?: PdfjsLib }).pdfjsLib;
  return held && typeof held.getDocument === "function" ? held : null;
}

/**
 * Loads Obsidian's pdf.js module, for a session in which the app has not
 * needed it yet.
 *
 * Asking for the same module by the same URL is what the app's own loader
 * does, and the browser serves the second request from the module map
 * rather than evaluating it twice, so the two callers cannot end up with
 * different copies.
 */
function loadModule(): Promise<PdfjsLib | null> {
  return new Promise<PdfjsLib | null>((resolve) => {
    const script = createEl("script");
    script.type = "module";
    script.src = MODULE;
    // A module script's load fires after it has been evaluated, which is
    // when the global it defines exists.
    script.addEventListener("load", () => resolve(libNow()), { once: true });
    script.addEventListener("error", () => resolve(null), { once: true });
    // The main window's document on purpose: the library defines itself as
    // a global on that window, which is the one this code reads. Loaded into
    // a popout it would be invisible here and would go when the popout did.
    window.document.head.appendChild(script);
  }).then((lib) => {
    // Obsidian's own loader sets this in an after-hook we are not going
    // through. Without it pdf.js has nowhere to put the parse and refuses.
    if (lib && !lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = WORKER;
    return lib;
  });
}

function openDocument(lib: PdfjsLib, data: Uint8Array): PdfLoadingTask {
  return lib.getDocument({
    data,
    cMapUrl: CMAPS,
    cMapPacked: true,
    standardFontDataUrl: FONTS,
    wasmUrl: WASM,
    // Nothing here is a document the reader is interacting with; it is a
    // file being read by a program, and a PDF is somebody else's code.
    isEvalSupported: false,
  });
}

/**
 * Whether pdf.js can open a document at all, found out by opening one that
 * cannot be broken.
 *
 * The module is not the whole of pdf.js. The parse happens in a worker,
 * fetched from its own path when the first document is opened, and when
 * that path is wrong pdf.js does not say so: every document fails exactly
 * as a broken file fails, and a cover or a note written off for it stays
 * written off. Checking the worker's file would miss the ways it can fail
 * that are not a missing file; a blank page sent through the same
 * getDocument, with the same options, as every real file tests what the
 * real files need, and in the terms the rest of this file relies on already.
 */
async function opensDocuments(lib: PdfjsLib): Promise<boolean> {
  let task: PdfLoadingTask | null = null;
  let timer = 0;
  try {
    task = openDocument(lib, blankPdf());
    const gaveUp = new Promise<null>((resolve) => {
      timer = window.setTimeout(() => resolve(null), CHECK_TIMEOUT);
    });
    const doc = await Promise.race([task.promise, gaveUp]);
    return doc?.numPages === 1;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
    // The task rather than the document, because on a timeout there is no
    // document yet, and the worker it started would otherwise stay.
    void task?.destroy();
  }
}

/**
 * pdf.js, ready to open documents, or null when it is not.
 *
 * Obsidian loads the module lazily — the first time a PDF view opens — so a
 * session that has never shown one has no `window.pdfjsLib`, and this loads
 * it. Then, once, it opens a blank page, because a module that loads is not
 * yet a reader that works (opensDocuments says why).
 *
 * Once per session, whatever the answer: a build with no pdf.js will not
 * grow one between two clippings, and retrying per file would put a failing
 * script tag in the document for each. A no is said out loud the first time
 * it is heard, since without that the feature would simply stop.
 */
async function pdfjs(): Promise<PdfjsLib | null> {
  const lib = libNow() ?? (await (loading ??= loadModule()));
  if (lib && (await (checking ??= opensDocuments(lib)))) return lib;

  // Every caller after the first hears the same no, and a notice each
  // would repeat itself once per PDF in the library.
  const notice = libraryNotices.failed("pdfjs");
  if (notice) new Notice(notice, 8000);
  return null;
}

function canvasPng(canvas: HTMLCanvasElement): Promise<ArrayBuffer | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) resolve(null);
      else void blob.arrayBuffer().then(resolve, () => resolve(null));
    }, "image/png");
  });
}

/**
 * Opens a document and hands it to `read`, closing it afterwards whatever
 * happens. Everything pdf.js does needs this, and a document left open holds
 * its worker and its bytes for the life of the session.
 */
async function withDocument<T>(
  lib: PdfjsLib,
  bytes: ArrayBuffer,
  fallback: T,
  read: (doc: PdfDocument) => Promise<T>
): Promise<T> {
  let doc: PdfDocument | null = null;
  try {
    doc = await openDocument(lib, new Uint8Array(bytes)).promise;
    return await read(doc);
  } catch {
    return fallback;
  } finally {
    void doc?.destroy();
  }
}

/**
 * The words on a PDF's first pages, as one run of prose.
 *
 * For the search index, not for reading: a PDF is otherwise findable only by
 * its file name, and a file name is exactly where "Untitled-3.pdf" goes to
 * hide. The brand is inside the brand book.
 *
 * "" for a PDF with no text layer, which is every scanned one — not a
 * failure, just a document made of pictures of words. Finding those by their
 * words is OCR's job, and a different card. "" too for a file that will not
 * open, since pdf.js is known by then to open others: the fault is the
 * file's, and it will not mend. Only a pdf.js that cannot open anything is
 * not an answer about the file, and comes back as one that is not ok.
 */
export async function readPdfText(bytes: ArrayBuffer): Promise<PdfText> {
  const lib = await pdfjs();
  if (!lib) return { ok: false, reason: MISSING };

  const text = await withDocument(lib, bytes, "", async (doc) => {
    const pages: string[] = [];
    for (let number = 1; number <= Math.min(TEXT_PAGES, doc.numPages); number++) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      pages.push(joinTextRuns(content.items));
    }
    // A page break reads as a paragraph break; without it the last word of
    // one page runs into the first of the next.
    return pages.join("\n");
  });
  return { ok: true, text };
}

/**
 * Renders page one of a PDF.
 *
 * @param bytes the file, which pdf.js hands to its worker and detaches, so
 * the caller must not expect its buffer back.
 */
export async function renderPdfCover(bytes: ArrayBuffer): Promise<PdfCover> {
  // Asked before the document is opened, so that everything withDocument
  // swallows below is a failure of this file rather than of the library:
  // one is worth writing down, the other is worth trying again after an
  // update, and they are indistinguishable once mixed.
  const lib = await pdfjs();
  if (!lib) return { ok: false, retry: true, reason: MISSING };

  const unreadable: PdfCover = { ok: false, retry: false, reason: "the page would not render" };
  return withDocument<PdfCover>(lib, bytes, unreadable, async (doc) => {
    const page = await doc.getPage(1);
    const unscaled = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: unscaled.width > 0 ? COVER_WIDTH / unscaled.width : 1,
    });

    const canvas = createEl("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext("2d");
    if (!context) return { ok: false, retry: true, reason: "no 2d context" };

    // A PDF page is transparent wherever nothing is drawn, and transparent
    // is whatever is behind it: on a dark theme, a black rectangle with
    // black type on it. Paper is white, so the page is laid on white.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;

    const png = await canvasPng(canvas);
    if (!png) return { ok: false, retry: false, reason: "the page would not encode" };

    return { ok: true, png, width: canvas.width, height: canvas.height };
  });
}
