import { describe, expect, it } from "vitest";
import {
  configHash,
  defaultShared,
  descendsFrom,
  extractShared,
  isDefaultShared,
  lineageOf,
  nextLineage,
  parseShared,
  publishesShared,
  rebaseShared,
  serializeShared,
  sharedOf,
  withShared,
} from "../src/core/shared-config";
import type { SharedConfig } from "../src/core/shared-config";
import { DEFAULT_SETTINGS } from "../src/core/settings";

const fallback = {
  grids: [{ name: "Manga", icon: "archive" }],
  folders: [],
  homeGridName: "Clippings",
  homeGridIcon: "archive",
  filterProperties: ["categories", "status"],
};

describe("sharedOf and withShared", () => {
  it("carries the vault's half and nothing else", () => {
    const settings = { ...DEFAULT_SETTINGS, grids: fallback.grids, tileSize: "s" as const };
    const shared = sharedOf(settings);
    expect(shared.grids).toEqual(fallback.grids);
    expect(Object.keys(shared).sort()).toEqual([
      "filterProperties",
      "folders",
      "grids",
      "homeGridIcon",
      "homeGridLook",
      "homeGridName",
    ]);
  });

  it("carries a grid's look, so a wall looks the same on the phone", () => {
    const grids = [{ name: "Manga", icon: "book", look: { tileProperty: "author" } }];
    const settings = {
      ...DEFAULT_SETTINGS,
      grids,
      homeGridLook: { tileProperty: "author" },
      // Device-local, both of them: a phone keeps its own.
      tileSize: "s" as const,
      gridTileSizes: { Manga: "xl" as const },
      gridLookScope: "grid" as const,
    };
    const shared = sharedOf(settings);

    expect(shared.grids[0].look).toEqual({ tileProperty: "author" });
    expect(shared.homeGridLook).toEqual({ tileProperty: "author" });
    expect(shared).not.toHaveProperty("gridTileSizes");
    expect(shared).not.toHaveProperty("gridLookScope");
  });

  it("keeps a look through the file and drops one edited into nonsense", () => {
    const round = parseShared(
      JSON.parse(
        JSON.stringify({
          grids: [
            { name: "Manga", icon: "book", look: { tileProperty: "author" } },
            { name: "Broken", icon: "book", look: "nonsense" },
          ],
          folders: [],
          homeGridName: "Clippings",
          homeGridIcon: "layout-grid",
          homeGridLook: { tileProperty: "author" },
          filterProperties: ["categories"],
        })
      ),
      fallback
    );

    expect(round.grids[0].look).toEqual({ tileProperty: "author" });
    // The grid survives; only the unreadable look goes.
    expect(round.grids[1].name).toBe("Broken");
    expect(round.grids[1].look).toBeUndefined();
    expect(round.homeGridLook).toEqual({ tileProperty: "author" });
  });

  it("leaves the device's half alone when merging", () => {
    // The whole point of the split: a phone keeps its own density and its own
    // open grid even as the desktop's grids arrive.
    const local = { ...DEFAULT_SETTINGS, tileSize: "s" as const, autoplayVideo: false, activeGrid: "Manga" };
    const merged = withShared(local, fallback);
    expect(merged.grids).toEqual(fallback.grids);
    expect(merged.tileSize).toBe("s");
    expect(merged.autoplayVideo).toBe(false);
    expect(merged.activeGrid).toBe("Manga");
  });
});

describe("parseShared", () => {
  it("reads a well-formed file", () => {
    const raw = {
      grids: [{ name: "Sites", icon: "bookmark" }],
      homeGridName: "Home",
      homeGridIcon: "layout-grid",
      filterProperties: ["categories"],
    };
    expect(parseShared(raw, fallback)).toEqual({ ...raw, folders: [] });
  });

  it("keeps smart grid rules", () => {
    const rules = { kind: ["image"], categories: ["ios"] };
    const parsed = parseShared({ grids: [{ name: "Shots", icon: "image", rules }] }, fallback);
    expect(parsed.grids[0].rules).toEqual(rules);
  });

  it("falls back on anything that is not an object", () => {
    for (const raw of [null, undefined, 7, "grids", []]) {
      expect(parseShared(raw, fallback)).toEqual(fallback);
    }
  });

  it("keeps the fields it can read and falls back per field", () => {
    // A file synced half-written must not cost the grids beside the bad key.
    const parsed = parseShared(
      { grids: [{ name: "Sites", icon: "bookmark" }], homeGridName: 42 },
      fallback
    );
    expect(parsed.grids).toEqual([{ name: "Sites", icon: "bookmark" }]);
    expect(parsed.homeGridName).toBe(fallback.homeGridName);
  });

  it("drops individual grids that are not grids, keeping the rest", () => {
    const parsed = parseShared(
      { grids: [{ name: "Sites", icon: "bookmark" }, null, { icon: "no-name" }, { name: "", icon: "x" }] },
      fallback
    );
    expect(parsed.grids).toEqual([{ name: "Sites", icon: "bookmark" }]);
  });

  it("turns a grid with unusable rules manual rather than losing it", () => {
    const parsed = parseShared({ grids: [{ name: "Odd", icon: "star", rules: "everything" }] }, fallback);
    expect(parsed.grids).toEqual([]);
  });

  it("refuses a filter property list with a non-string in it", () => {
    const parsed = parseShared({ filterProperties: ["categories", 3] }, fallback);
    expect(parsed.filterProperties).toEqual(fallback.filterProperties);
  });

  it("refuses an empty home grid name, which would leave it unnameable", () => {
    expect(parseShared({ homeGridName: "" }, fallback).homeGridName).toBe(fallback.homeGridName);
  });

});

describe("parseShared folders", () => {
  it("reads folders, keeping only well-formed ones", () => {
    const parsed = parseShared(
      {
        folders: [
          { name: "Kitchen", icon: "folder", grid: "", width: 2 },
          { name: "Bad", icon: "folder", grid: "", width: 7 },
          { name: "", icon: "folder", grid: "", width: 1 },
          null,
        ],
      },
      fallback
    );
    expect(parsed.folders).toEqual([{ name: "Kitchen", icon: "folder", grid: "", width: 2 }]);
  });

  it("reads the retired full width as three columns", () => {
    const parsed = parseShared(
      { folders: [{ name: "Wide", icon: "folder", grid: "", width: "full" }] },
      fallback
    );
    expect(parsed.folders).toEqual([{ name: "Wide", icon: "folder", grid: "", width: 3 }]);
  });

  it("reads an older file without folders as having none", () => {
    expect(parseShared({ grids: [] }, fallback).folders).toEqual([]);
  });

  it("round-trips folders through serialise and extract", () => {
    const shared = {
      ...defaultShared(),
      folders: [{ name: "Film", icon: "clapperboard", grid: "Design", width: 3 as const }],
    };
    expect(parseShared(extractShared(serializeShared(shared)), fallback).folders).toEqual(
      shared.folders
    );
  });

  it("counts a vault with folders as configured", () => {
    expect(
      isDefaultShared({
        ...defaultShared(),
        folders: [{ name: "Film", icon: "folder", grid: "", width: 1 }],
      })
    ).toBe(false);
  });
});

describe("isDefaultShared", () => {
  // Whoever writes the file first wins it: every other device reads that file
  // and adopts it. A phone upgraded before the desktop it was configured on
  // must not publish an empty list and take the desktop's grids with it.
  it("is true for a device holding nothing but the defaults", () => {
    expect(isDefaultShared(defaultShared())).toBe(true);
  });

  it("is false as soon as there is a grid to publish", () => {
    expect(isDefaultShared({ ...defaultShared(), grids: fallback.grids })).toBe(false);
  });

  it("is false for a renamed or re-iconed home grid", () => {
    expect(isDefaultShared({ ...defaultShared(), homeGridName: "Shelf" })).toBe(false);
    expect(isDefaultShared({ ...defaultShared(), homeGridIcon: "star" })).toBe(false);
  });

  it("is false for a changed list of filter properties, which is a real choice", () => {
    const base = defaultShared();
    expect(isDefaultShared({ ...base, filterProperties: [...base.filterProperties, "project"] })).toBe(false);
    expect(isDefaultShared({ ...base, filterProperties: ["project", ...base.filterProperties] })).toBe(false);
  });
});

describe("sharedOf copies", () => {
  it("does not hand out the array inside the defaults", () => {
    const shared = sharedOf(DEFAULT_SETTINGS);
    shared.grids.push({ name: "Scratch", icon: "star" });
    expect(DEFAULT_SETTINGS.grids).toHaveLength(0);
  });
});

describe("extractShared", () => {
  const shared = {
    ...fallback,
    grids: [{ name: "Shots", icon: "image", rules: { kind: ["image"] } }],
  };

  it("round-trips through the markdown it is written as", () => {
    const written = serializeShared(shared);
    expect(parseShared(extractShared(written), defaultShared())).toEqual(shared);
  });

  it("writes a note, not a blob, so every sync carries it", () => {
    const written = serializeShared(shared);
    expect(written.startsWith("# Goko")).toBe(true);
    expect(written).toContain("```json");
  });

  it("reads the bare JSON of the file this replaced", () => {
    expect(extractShared(JSON.stringify(shared))).toEqual(shared);
  });

  it("ignores prose around the block", () => {
    const written = `# Goko\n\nSome note someone added.\n\n\`\`\`json\n${JSON.stringify(shared)}\n\`\`\`\n\nAnd more after it.\n`;
    expect(extractShared(written)).toEqual(shared);
  });

  it("is null for a file with no configuration in it", () => {
    expect(extractShared("# Goko\n\nnothing here\n")).toBeNull();
    expect(extractShared("")).toBeNull();
  });

  it("is null for a block that is not valid JSON, rather than throwing", () => {
    expect(extractShared("```json\n{ nope\n```")).toBeNull();
  });
});

describe("publishesShared", () => {
  // The rule this encodes has been got wrong twice: once by living only in
  // the load path, and once by being absent from the save path, which is how
  // a brand-new vault ended up with a note full of defaults in its clippings
  // folder before its owner had said anything.
  const withGrid = { ...defaultShared(), grids: [{ name: "Manga", icon: "book" }] };

  it("stays quiet on a fresh vault that has nothing to say", () => {
    expect(publishesShared("", defaultShared())).toBe(false);
  });

  it("publishes as soon as there is a grid, on a vault with no file yet", () => {
    expect(publishesShared("", withGrid)).toBe(true);
  });

  it("keeps writing once the file exists, even back down to the defaults", () => {
    // A vault that had grids and no longer does is making a statement. The
    // silence is only for a device that has never said anything at all.
    expect(publishesShared("# Goko\n\n```json\n{}\n```", defaultShared())).toBe(true);
  });

  it("keeps writing once the file exists and there is still something in it", () => {
    expect(publishesShared("# Goko\n\n```json\n{}\n```", withGrid)).toBe(true);
  });

  it("counts a renamed home grid as something to say", () => {
    expect(publishesShared("", { ...defaultShared(), homeGridName: "Shelf" })).toBe(true);
  });

  it("counts a folder as something to say, with no grids at all", () => {
    const folders = [{ name: "Film", icon: "folder", grid: "", width: 1 as const }];
    expect(publishesShared("", { ...defaultShared(), folders })).toBe(true);
  });
});

describe("configHash", () => {
  const shared: SharedConfig = {
    ...defaultShared(),
    grids: [{ name: "Tools", icon: "hammer", color: "orange" }],
  };

  it("is the same for the same config, whatever order its keys are in", () => {
    const reordered = { ...shared, grids: [{ color: "orange" as const, icon: "hammer", name: "Tools" }] };
    expect(configHash(reordered)).toBe(configHash(shared));
  });

  it("changes with any look", () => {
    const plain = { ...shared, grids: [{ name: "Tools", icon: "layout-grid" }] };
    expect(configHash(plain)).not.toBe(configHash(shared));
  });

  it("survives a round trip through the file", () => {
    const back = parseShared(extractShared(serializeShared(shared, ["abc"])), defaultShared());
    expect(configHash(back)).toBe(configHash(shared));
  });
});

describe("lineage", () => {
  it("is read from the file, and empty for a file from before it", () => {
    expect(lineageOf(extractShared(serializeShared(defaultShared(), ["b", "a"])))).toEqual(["b", "a"]);
    expect(lineageOf(extractShared(serializeShared(defaultShared())))).toEqual([]);
    expect(lineageOf({ lineage: "b" })).toEqual([]);
    expect(lineageOf(null)).toEqual([]);
  });

  it("stays out of the config a device takes into its settings", () => {
    const raw = extractShared(serializeShared(defaultShared(), ["b"]));
    expect(Object.keys(parseShared(raw, defaultShared()))).not.toContain("lineage");
  });

  it("puts what was held first, then its ancestry, without repeats", () => {
    expect(nextLineage("c", ["b", "a"], ["x", "a"])).toEqual(["c", "b", "a", "x"]);
    expect(nextLineage("", [])).toEqual([]);
  });

  it("keeps a bounded number of ancestors", () => {
    const long = Array.from({ length: 60 }, (_, i) => `h${i}`);
    expect(nextLineage("top", long)).toHaveLength(32);
  });
});

describe("descendsFrom", () => {
  const held: SharedConfig = {
    ...defaultShared(),
    grids: [
      { name: "Tools", icon: "hammer", color: "orange" },
      { name: "Posters", icon: "image" },
    ],
  };
  const plain: SharedConfig = {
    ...defaultShared(),
    grids: [
      { name: "Posters", icon: "layout-grid" },
      { name: "Tools", icon: "layout-grid" },
    ],
  };

  it("takes a config written on top of the one held", () => {
    expect(descendsFrom(plain, [configHash(held)], held)).toBe(true);
    expect(descendsFrom(plain, ["newer", configHash(held), "older"], held)).toBe(true);
  });

  it("refuses one from a device that had not seen it, however it counts", () => {
    expect(descendsFrom(plain, [], held)).toBe(false);
    expect(descendsFrom(plain, ["someone-else"], held)).toBe(false);
  });

  it("takes the same config back whatever its lineage", () => {
    expect(descendsFrom({ ...held }, [], held)).toBe(true);
  });
});

describe("rebaseShared", () => {
  it("keeps the base's order and looks, and adds only what the other found", () => {
    const base: SharedConfig = {
      ...defaultShared(),
      grids: [
        { name: "Tools", icon: "hammer", color: "orange" },
        { name: "Posters", icon: "image" },
      ],
      folders: [{ name: "Brass", icon: "folder", grid: "Tools", width: 1 }],
    };
    const extra: SharedConfig = {
      ...defaultShared(),
      homeGridIcon: "archive",
      grids: [
        { name: "Posters", icon: "layout-grid" },
        { name: "Maps", icon: "layout-grid" },
        { name: "Tools", icon: "layout-grid" },
      ],
      folders: [
        { name: "Brass", icon: "folder", grid: "Tools", width: 1 },
        { name: "Leather", icon: "folder", grid: "Tools", width: 1 },
      ],
    };
    const out = rebaseShared(extra, base);
    expect(out.grids).toEqual([
      { name: "Tools", icon: "hammer", color: "orange" },
      { name: "Posters", icon: "image" },
      { name: "Maps", icon: "layout-grid" },
    ]);
    expect(out.folders.map((f) => f.name)).toEqual(["Brass", "Leather"]);
    expect(out.homeGridIcon).toBe(base.homeGridIcon);
  });
});
