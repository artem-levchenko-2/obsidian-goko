/**
 * What to say when a library borrowed from inside Obsidian will not load.
 *
 * pdf.js, Readability and Turndown are not bundled: the plugin uses the
 * copies Obsidian ships, loaded from its own /lib folder or found on window
 * where the app has already loaded them (pdf-cover.ts and article.ts say
 * why). None of that is an API, and an update is free to move a file or
 * drop a global. The loaders already survive that, by answering null, but a
 * feature that stops without a word is worse than one that fails loudly: the
 * person goes on clipping PDFs and articles and finds out months later that
 * none of them were read.
 *
 * So the first failure is said out loud, and only the first. The library is
 * asked for on every PDF and every page clipped, and "Read the text out of
 * every PDF" asks once per document; a notice each time would bury the
 * screen under one sentence repeated a hundred times.
 *
 * Pure: the shell shows the notice, this decides whether there is one.
 */

export type BorrowedLibrary = "pdfjs" | "readability" | "turndown";

const NOTICES: Record<BorrowedLibrary, string> = {
  pdfjs: "Goko: could not load Obsidian's built-in PDF reader, so PDF covers and text will not be read",
  readability:
    "Goko: could not load Obsidian's built-in article reader, so clipped articles will be saved without their text",
  turndown:
    "Goko: could not find Obsidian's built-in markdown converter, so clipped articles will be saved without their text",
};

/**
 * Which borrowed libraries have been reported missing.
 *
 * Kept for as long as the plugin is loaded, which is also how long each
 * loader keeps its answer: the notice comes back only when the question is
 * asked afresh, after a reload or an update.
 */
export class LibraryNotices {
  private readonly shown = new Set<BorrowedLibrary>();

  /**
   * The notice to show now that `library` has failed to load, or null when
   * this session has shown it already.
   */
  failed(library: BorrowedLibrary): string | null {
    if (this.shown.has(library)) return null;
    this.shown.add(library);
    return NOTICES[library];
  }
}

/**
 * The one set the shell reports through. Shared by every loader so that the
 * rule is kept in one place, and separate per library so that one going
 * missing does not silence another — not even Readability and Turndown,
 * which a clipped article needs both of, since each is fixed in its own way.
 */
export const libraryNotices = new LibraryNotices();
