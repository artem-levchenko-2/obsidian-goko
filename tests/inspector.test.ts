import { describe, expect, it } from "vitest";
import {
  INSPECTOR_DEFAULT,
  INSPECTOR_MAX,
  INSPECTOR_MIN,
  INSPECTOR_MIN_PANE,
  clampInspectorWidth,
  fileFacts,
  formatLabel,
  inspectorVisible,
  selectionLabel,
} from "../src/core/inspector";
import type { ClippingRecord } from "../src/core/scan";
import type { TileModel } from "../src/core/tile";

function record(over: Partial<ClippingRecord> = {}): ClippingRecord {
  return {
    path: "Library/a.md",
    title: "a",
    source: "",
    description: "",
    categories: [],
    created: "",
    cover: "",
    grid: "",
    folder: "",
    media: [],
    excerpt: "",
    haystack: "",
    properties: {},
    ...over,
  };
}

function tile(over: Partial<TileModel> = {}): TileModel {
  return {
    id: "Library/a.md",
    record: record(),
    posterPath: "",
    filePath: "Attachments/a.png",
    remote: false,
    kind: "image",
    animated: false,
    width: 1500,
    height: 2250,
    provisional: false,
    signature: "a",
    ...over,
  };
}

describe("clampInspectorWidth", () => {
  it("holds a dragged width inside the range", () => {
    expect(clampInspectorWidth(10)).toBe(INSPECTOR_MIN);
    expect(clampInspectorWidth(9000)).toBe(INSPECTOR_MAX);
    expect(clampInspectorWidth(312.4)).toBe(312);
  });

  it("falls back to the default for a width no number can be read from", () => {
    expect(clampInspectorWidth(Number.NaN)).toBe(INSPECTOR_DEFAULT);
  });
});

describe("inspectorVisible", () => {
  it("stands aside on a pane with no room for it", () => {
    expect(inspectorVisible(INSPECTOR_MIN_PANE - 1, false)).toBe(false);
    expect(inspectorVisible(INSPECTOR_MIN_PANE, false)).toBe(true);
  });

  it("stays away when it has been folded, however wide the pane", () => {
    expect(inspectorVisible(2000, true)).toBe(false);
  });

  it("gives up its room later than the rail does, being the only way to read a card", () => {
    // 720 is the rail's threshold. The panel is still up at that width.
    expect(INSPECTOR_MIN_PANE).toBeLessThan(720);
  });
});

describe("selectionLabel", () => {
  it("counts one card without pretending it is several", () => {
    expect(selectionLabel(1)).toBe("1 selected");
    expect(selectionLabel(4)).toBe("4 selected");
  });
});

describe("fileFacts", () => {
  it("reports what the file is, in the order the panel reads them", () => {
    const facts = fileFacts(tile({ record: record({ created: "2026-04-25" }) }), 2_914_089);
    expect(facts.map((fact) => fact.label)).toEqual([
      "Dimensions",
      "Size",
      "Type",
      "Saved",
    ]);
    expect(facts[0].value).toBe("1500×2250");
    expect(facts[1].value).toBe("2.8 MB");
    expect(facts[2].value).toBe("PNG");
  });

  it("leaves out a size nobody has measured, rather than printing zero", () => {
    const facts = fileFacts(tile(), 0);
    expect(facts.map((fact) => fact.label)).not.toContain("Size");
  });

  it("leaves out dimensions until the picture has been measured", () => {
    const facts = fileFacts(tile({ width: 0, height: 0 }), 100);
    expect(facts.map((fact) => fact.label)).not.toContain("Dimensions");
  });

  it("falls back to the source when nothing has been archived yet", () => {
    const held = tile({
      filePath: "",
      record: record({ source: "https://example.com/a/shot.jpeg" }),
    });
    const type = fileFacts(held, 0).find((fact) => fact.label === "Type");
    expect(type?.value).toBe("JPEG");
  });
});

describe("formatLabel", () => {
  it("names the format of the file the card is showing", () => {
    expect(formatLabel(tile())).toBe("PNG");
  });

  it("says nothing for a clipping with no file and no address to read", () => {
    expect(formatLabel(tile({ filePath: "" }))).toBe("");
  });
});
