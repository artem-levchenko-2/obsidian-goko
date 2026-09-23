import { describe, expect, it } from "vitest";
import { classifyDrop, describeSkipped, titleForDropped, wantsDrop, withGridKey } from "../src/core/drop";
import type { DroppedFile } from "../src/core/drop";

const file = (name: string, type = ""): DroppedFile => ({ name, type });

describe("wantsDrop", () => {
  it("takes an interest in files and in web links", () => {
    expect(wantsDrop(["Files"])).toBe(true);
    expect(wantsDrop(["text/uri-list", "text/plain"])).toBe(true);
  });

  it("stays out of the way of a drag carrying only text", () => {
    // Which is what dragging a note out of the file explorer looks like.
    expect(wantsDrop(["text/plain"])).toBe(false);
    expect(wantsDrop([])).toBe(false);
  });
});

describe("classifyDrop", () => {
  it("takes an image by its MIME", () => {
    const plan = classifyDrop([file("shot.png", "image/png")], "");
    expect(plan).toEqual({
      kind: "media",
      files: [file("shot.png", "image/png")],
      notes: [],
      skipped: [],
    });
  });

  it("takes a video, which is half of what this vault holds", () => {
    const plan = classifyDrop([file("clip.mp4", "video/mp4")], "");
    expect(plan.kind).toBe("media");
  });

  it("falls back to the extension when the source reported no MIME", () => {
    const plan = classifyDrop([file("shot.webp")], "");
    expect(plan.kind).toBe("media");
  });

  it("keeps what it can and reports what it could not", () => {
    const plan = classifyDrop(
      [file("a.png", "image/png"), file("notes.zip", "application/zip")],
      ""
    );
    expect(plan).toMatchObject({ kind: "media", skipped: ["notes.zip"] });
    expect(plan.kind === "media" && plan.files.map((f) => f.name)).toEqual(["a.png"]);
  });

  it("refuses a drop it can do nothing with, naming what was refused", () => {
    const plan = classifyDrop([file("notes.zip", "application/zip")], "");
    expect(plan).toEqual({ kind: "unsupported", skipped: ["notes.zip"] });
  });

  it("takes a PDF, by its type and by its name alone", () => {
    // A brand book or a type specimen is a reference like any other, and the
    // wall shows it as its first page. Both routes matter: Finder fills the
    // MIME in, an archive tool often does not.
    expect(classifyDrop([file("book.pdf", "application/pdf")], "").kind).toBe("media");
    expect(classifyDrop([file("book.pdf", "")], "").kind).toBe("media");
  });

  it("prefers files to the text beside them", () => {
    // Finder sends both, the text being the path of the very file it carries,
    // so reading text first would turn every file drop into a failed capture.
    const plan = classifyDrop([file("a.png", "image/png")], "/Users/me/a.png");
    expect(plan.kind).toBe("media");
  });

  it("takes a web link when there are no files", () => {
    expect(classifyDrop([], "https://example.com/post")).toEqual({
      kind: "url",
      url: "https://example.com/post",
    });
  });

  it("reads the first real line of a uri-list, comments and all", () => {
    const plan = classifyDrop([], "# a comment\r\nhttps://example.com/a\r\nhttps://example.com/b");
    expect(plan).toEqual({ kind: "url", url: "https://example.com/a" });
  });

  it("ignores a drag that is neither a file nor a web link", () => {
    // Obsidian's own drags land here, and answering them with a complaint
    // would mean picking a fight over every gesture that crossed the wall.
    expect(classifyDrop([], "Some Note.md").kind).toBe("ignore");
    expect(classifyDrop([], "obsidian://open?vault=Notes").kind).toBe("ignore");
    expect(classifyDrop([], "/Users/me/notes.txt").kind).toBe("ignore");
    expect(classifyDrop([], "").kind).toBe("ignore");
  });
});

describe("titleForDropped", () => {
  it("uses the file's own name, without the extension", () => {
    expect(titleForDropped("sunset over the bay.jpg")).toBe("sunset over the bay");
  });

  it("keeps every earlier dot", () => {
    expect(titleForDropped("shot.2026.final.png")).toBe("shot.2026.final");
  });

  it("leaves a name with no extension alone", () => {
    expect(titleForDropped("screenshot")).toBe("screenshot");
  });

  it("does not eat a leading dot, which is the whole name", () => {
    expect(titleForDropped(".hidden")).toBe(".hidden");
  });
});

describe("describeSkipped", () => {
  it("names the one file, because which one is the useful part", () => {
    expect(describeSkipped(["notes.zip"])).toBe("notes.zip is not a picture, a video or a note");
  });

  it("counts several rather than listing them", () => {
    expect(describeSkipped(["a.zip", "b.docx", "c.key"])).toBe(
      "3 files were not pictures, videos or notes"
    );
  });

  it("says nothing when nothing was skipped", () => {
    expect(describeSkipped([])).toBe("");
  });
});


describe("classifyDrop: notes", () => {
  it("takes a markdown file, which is already what a clipping is", () => {
    const plan = classifyDrop([file("thoughts.md", "text/markdown")], "");
    expect(plan).toMatchObject({ kind: "media", files: [], skipped: [] });
    expect(plan.kind === "media" && plan.notes.map((f) => f.name)).toEqual(["thoughts.md"]);
  });

  it("takes one whose type the source did not report", () => {
    // Obsidian's own exports and most archive tools send nothing at all.
    expect(classifyDrop([file("thoughts.md", "")], "").kind).toBe("media");
  });

  it("keeps notes and pictures apart in one drop", () => {
    const plan = classifyDrop(
      [file("a.png", "image/png"), file("b.md", ""), file("c.zip", "application/zip")],
      ""
    );
    expect(plan).toMatchObject({ kind: "media", skipped: ["c.zip"] });
    expect(plan.kind === "media" && plan.files.map((f) => f.name)).toEqual(["a.png"]);
    expect(plan.kind === "media" && plan.notes.map((f) => f.name)).toEqual(["b.md"]);
  });

  it("is not fooled by a name that merely mentions markdown", () => {
    expect(classifyDrop([file("md", "")], "")).toEqual({ kind: "unsupported", skipped: ["md"] });
    expect(classifyDrop([file("readme.mdx", "")], "")).toEqual({
      kind: "unsupported",
      skipped: ["readme.mdx"],
    });
  });
});

describe("withGridKey", () => {
  it("adds the grid to a note's frontmatter and leaves the rest as it was", () => {
    const note = '---\ntitle: "A page"\ntags:\n  - "clippings"\n---\nBody text.\n';
    expect(withGridKey(note, "Craft")).toBe(
      '---\ntitle: "A page"\ntags:\n  - "clippings"\ngrid: "Craft"\n---\nBody text.\n'
    );
  });

  it("replaces a grid the note brought, lists hung under it included", () => {
    expect(withGridKey('---\ngrid: "Old"\ntitle: x\n---\n', "New")).toBe('---\ntitle: x\ngrid: "New"\n---\n');
    expect(withGridKey("---\ngrid:\n  - Old\n- Older\ntitle: x\n---\n", "New")).toBe('---\ntitle: x\ngrid: "New"\n---\n');
  });

  it("gives a note with no frontmatter a block of its own", () => {
    expect(withGridKey("Just text.\n", "Craft")).toBe('---\ngrid: "Craft"\n---\nJust text.\n');
  });

  it("takes the key away at home, and leaves a note without one alone", () => {
    expect(withGridKey('---\ntitle: x\ngrid: "Old"\n---\nBody\n', "")).toBe("---\ntitle: x\n---\nBody\n");
    expect(withGridKey("Just text.\n", "")).toBe("Just text.\n");
  });

  it("keeps Windows line endings and a byte-order mark", () => {
    expect(withGridKey("﻿---\r\ntitle: x\r\n---\r\nBody\r\n", "Craft")).toBe(
      '﻿---\r\ntitle: x\r\ngrid: "Craft"\r\n---\r\nBody\r\n'
    );
  });

  it("does not mistake a key that only starts with grid for it", () => {
    expect(withGridKey("---\ngridlines: on\n---\n", "Craft")).toBe('---\ngridlines: on\ngrid: "Craft"\n---\n');
  });
});
