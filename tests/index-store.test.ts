import { describe, expect, it } from "vitest";
import { ClippingIndex, isInFolder, shuffleRecords, sortRecords } from "../src/index-store";
import type { ClippingRecord } from "../src/core/scan";

function rec(path: string, created: string, title: string): ClippingRecord {
  return {
    path,
    created,
    title,
    source: "",
    description: "",
    categories: [],
    cover: "",
    grid: "",
    folder: "",
    media: [],
    excerpt: "",
    haystack: title.toLowerCase(),
    properties: {},
  };
}

describe("isInFolder", () => {
  it("accepts markdown files directly inside the folder", () => {
    expect(isInFolder("Clippings/A.md", "Clippings")).toBe(true);
  });

  it("accepts nested markdown files", () => {
    expect(isInFolder("Clippings/sub/A.md", "Clippings")).toBe(true);
  });

  it("rejects other folders", () => {
    expect(isInFolder("Work/A.md", "Clippings")).toBe(false);
  });

  it("rejects files whose name starts with an underscore", () => {
    expect(isInFolder("Clippings/_Categories.md", "Clippings")).toBe(false);
  });

  it("rejects non-markdown files", () => {
    expect(isInFolder("Clippings/Clippings.base", "Clippings")).toBe(false);
  });

  it("is not fooled by a folder with a shared prefix", () => {
    expect(isInFolder("ClippingsOld/A.md", "Clippings")).toBe(false);
  });

  it("tolerates a folder setting with a trailing slash", () => {
    expect(isInFolder("Clippings/A.md", "Clippings/")).toBe(true);
  });
});

describe("sortRecords", () => {
  it("orders newest created first", () => {
    const sorted = sortRecords([
      rec("a.md", "2026-01-01", "A"),
      rec("b.md", "2026-08-01", "B"),
    ]);
    expect(sorted[0].path).toBe("b.md");
  });

  it("falls back to title when created dates match", () => {
    const sorted = sortRecords([
      rec("b.md", "2026-01-01", "Beta"),
      rec("a.md", "2026-01-01", "Alpha"),
    ]);
    expect(sorted[0].title).toBe("Alpha");
  });

  it("puts records with no created date last", () => {
    const sorted = sortRecords([rec("a.md", "", "A"), rec("b.md", "2026-01-01", "B")]);
    expect(sorted[0].path).toBe("b.md");
  });

  it("does not mutate its input", () => {
    const input = [rec("a.md", "2026-01-01", "A"), rec("b.md", "2026-08-01", "B")];
    sortRecords(input);
    expect(input[0].path).toBe("a.md");
  });
});

describe("shuffleRecords", () => {
  const records = Array.from({ length: 12 }, (_, i) => rec(`${i}.md`, `2026-01-${10 + i}`, `t${i}`));

  it("keeps every record, once", () => {
    const out = shuffleRecords(records, 7);
    expect(out.map((r) => r.path).sort()).toEqual(records.map((r) => r.path).sort());
  });

  it("is repeatable for a seed, so a repaint does not reorder the wall", () => {
    expect(shuffleRecords(records, 42).map((r) => r.path)).toEqual(
      shuffleRecords(records, 42).map((r) => r.path)
    );
  });

  it("gives a different order for a different seed", () => {
    const a = shuffleRecords(records, 1).map((r) => r.path);
    const b = shuffleRecords(records, 2).map((r) => r.path);
    expect(a).not.toEqual(b);
  });

  it("actually moves things, rather than returning the input order", () => {
    const out = shuffleRecords(records, 99).map((r) => r.path);
    expect(out).not.toEqual(records.map((r) => r.path));
  });

  it("does not touch the list it was given", () => {
    const before = records.map((r) => r.path);
    shuffleRecords(records, 5);
    expect(records.map((r) => r.path)).toEqual(before);
  });

  it("copes with the seed 0 that would stall a naive LCG", () => {
    expect(shuffleRecords(records, 0)).toHaveLength(12);
  });
});

/**
 * Enough of an App for the index: it reads bodies and asks the metadata
 * cache, and the cache is allowed to have nothing, which is the case that
 * matters for a note written a moment ago.
 */
function fakeApp(files: Map<string, string>): unknown {
  return {
    vault: {
      cachedRead: (file: { path: string }) => Promise.resolve(files.get(file.path) ?? ""),
      getMarkdownFiles: () => [...files.keys()].map((path) => ({ path })),
    },
    metadataCache: { getFileCache: () => undefined },
  };
}

/** A parser for the two keys these notes carry. Not YAML, and does not need to be. */
function tinyYaml(yaml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of yaml.split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

function note(title: string, source: string): string {
  return `---\ntitle: ${title}\nsource: ${source}\n---\n\nbody\n`;
}

function indexOver(files: Map<string, string>): ClippingIndex {
  return new ClippingIndex(
    fakeApp(files) as never,
    () => "Clippings",
    tinyYaml
  );
}

describe("the index by source", () => {
  it("answers which clipping came from an address", async () => {
    const files = new Map([["Clippings/a.md", note("A", "https://e.com/post")]]);
    const index = indexOver(files);
    await index.rebuild();
    expect(index.bySource("https://e.com/post")?.path).toBe("Clippings/a.md");
    expect(index.bySource("https://e.com/other")).toBeUndefined();
  });

  it("normalises the address the same way capture does", async () => {
    // cleanUrl strips the tracking parameters, so a link shared from a phone
    // and the same link copied from the address bar are one clipping.
    const files = new Map([["Clippings/a.md", note("A", "https://e.com/post")]]);
    const index = indexOver(files);
    await index.rebuild();
    expect(index.bySource("https://e.com/post?utm_source=newsletter")?.path).toBe("Clippings/a.md");
  });

  it("says nothing for a clipping with no source", async () => {
    // Two pasted pictures are not the same thing as each other, and an empty
    // key would make the first one answer for every one that followed.
    const files = new Map([
      ["Clippings/a.md", note("A", "")],
      ["Clippings/b.md", note("B", "")],
    ]);
    const index = indexOver(files);
    await index.rebuild();
    expect(index.bySource("")).toBeUndefined();
  });

  it("drops the old address when a note's source is edited", async () => {
    const files = new Map([["Clippings/a.md", note("A", "https://e.com/one")]]);
    const index = indexOver(files);
    await index.rebuild();

    files.set("Clippings/a.md", note("A", "https://e.com/two"));
    await index.ingest({ path: "Clippings/a.md" } as never);

    expect(index.bySource("https://e.com/two")?.path).toBe("Clippings/a.md");
    expect(index.bySource("https://e.com/one")).toBeUndefined();
  });

  it("forgets a deleted note, so its address can be clipped again", async () => {
    const files = new Map([["Clippings/a.md", note("A", "https://e.com/post")]]);
    const index = indexOver(files);
    await index.rebuild();
    index.handleDelete("Clippings/a.md");
    expect(index.bySource("https://e.com/post")).toBeUndefined();
  });

  it("follows a note that was renamed", async () => {
    const files = new Map([["Clippings/a.md", note("A", "https://e.com/post")]]);
    const index = indexOver(files);
    await index.rebuild();

    files.delete("Clippings/a.md");
    files.set("Clippings/b.md", note("A", "https://e.com/post"));
    await index.handleRename({ path: "Clippings/b.md" } as never, "Clippings/a.md");

    expect(index.bySource("https://e.com/post")?.path).toBe("Clippings/b.md");
  });
});
