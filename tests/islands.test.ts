import { describe, expect, it } from "vitest";
import { ISLAND_GAP, computeIslands, islandAt } from "../src/core/islands";
import { computeLayout } from "../src/core/layout";
import type { LayoutItem } from "../src/core/layout";

const GAP = 10;
const HEADER = 40;
const WIDTH = 410; // two columns of 200 with the gap between them

function items(n: number, prefix: string): LayoutItem[] {
  return Array.from({ length: n }, (_, index) => ({
    id: `${prefix}${index}`,
    width: 200,
    height: 200,
  }));
}

describe("computeIslands", () => {
  it("puts a heading above each island and every card below it", () => {
    const out = computeIslands(
      [
        { key: "Payments", items: items(2, "p") },
        { key: "Typography", items: items(1, "t") },
      ],
      WIDTH,
      2,
      GAP,
      HEADER
    );
    expect(out.headers.map((h) => h.key)).toEqual(["Payments", "Typography"]);
    expect(out.headers[0].y).toBe(0);
    for (const position of out.positions) {
      const header = out.headers.filter((h) => h.y <= position.y).pop();
      expect(header).toBeDefined();
      expect(position.y).toBeGreaterThanOrEqual(header!.y + HEADER);
    }
  });

  it("lays each island out exactly as the flat wall would, only lower", () => {
    const group = items(3, "p");
    const flat = computeLayout(group, WIDTH, 2, GAP);
    const out = computeIslands([{ key: "Payments", items: group }], WIDTH, 2, GAP, HEADER);
    expect(out.positions.map((p) => ({ ...p, y: p.y - HEADER }))).toEqual(flat.positions);
  });

  it("counts what is in each island, for the heading to say", () => {
    const out = computeIslands(
      [
        { key: "", items: items(5, "u") },
        { key: "Payments", items: items(2, "p") },
      ],
      WIDTH,
      2,
      GAP,
      HEADER
    );
    expect(out.headers.map((h) => h.count)).toEqual([5, 2]);
  });

  it("ends each island at its lowest card, so a band can be drawn behind it", () => {
    const out = computeIslands([{ key: "a", items: items(3, "a") }], WIDTH, 2, GAP, HEADER);
    const lowest = Math.max(...out.positions.map((p) => p.y + p.h));
    expect(out.headers[0].bottom).toBe(lowest);
  });

  it("keeps cards off the band's edge by the inset, and pads the bottom by it", () => {
    const inset = 14;
    const out = computeIslands([{ key: "a", items: items(2, "a") }], WIDTH, 2, GAP, HEADER, inset);
    expect(Math.min(...out.positions.map((p) => p.x))).toBe(inset);
    expect(Math.max(...out.positions.map((p) => p.x + p.w))).toBeLessThanOrEqual(WIDTH - inset);
    const lowest = Math.max(...out.positions.map((p) => p.y + p.h));
    expect(out.headers[0].bottom).toBe(lowest + inset);
  });

  it("offers a folded island with nothing in it as a heading alone", () => {
    const out = computeIslands(
      [{ key: "Payments", items: [], collapsed: true }],
      WIDTH,
      2,
      GAP,
      HEADER
    );
    expect(out.headers).toHaveLength(1);
    expect(out.headers[0]).toMatchObject({ key: "Payments", count: 0, collapsed: true });
    expect(out.positions).toEqual([]);
  });

  it("skips an empty island rather than heading bare wall", () => {
    const out = computeIslands(
      [
        { key: "Payments", items: [] },
        { key: "Typography", items: items(1, "t") },
      ],
      WIDTH,
      2,
      GAP,
      HEADER
    );
    expect(out.headers.map((h) => h.key)).toEqual(["Typography"]);
    expect(out.headers[0].y).toBe(0);
  });

  it("folds a collapsed island to its heading, cards counted but not placed", () => {
    const out = computeIslands(
      [
        { key: "Payments", items: items(4, "p"), collapsed: true },
        { key: "Typography", items: items(1, "t") },
      ],
      WIDTH,
      2,
      GAP,
      HEADER
    );
    expect(out.headers[0]).toMatchObject({ key: "Payments", count: 4, collapsed: true, bottom: HEADER });
    expect(out.positions.map((p) => p.id)).toEqual(["t0"]);
    expect(out.headers[1].y).toBe(HEADER + GAP * ISLAND_GAP);
  });

  it("leaves room between islands, and none after the last one", () => {
    const one = computeIslands([{ key: "a", items: items(1, "a") }], WIDTH, 2, GAP, HEADER);
    // One header, one square card the width of a column.
    expect(one.totalHeight).toBe(HEADER + one.positions[0].h);

    const two = computeIslands(
      [
        { key: "a", items: items(1, "a") },
        { key: "b", items: items(1, "b") },
      ],
      WIDTH,
      2,
      GAP,
      HEADER
    );
    expect(two.totalHeight).toBe(one.totalHeight * 2 + GAP * ISLAND_GAP);
  });

  it("gives nothing back for no groups at all", () => {
    expect(computeIslands([], WIDTH, 2, GAP, HEADER)).toEqual({
      positions: [],
      headers: [],
      totalHeight: 0,
    });
  });
});

describe("computeIslands: pockets", () => {
  const inset = 10;
  const out = computeIslands(
    [
      {
        key: "Design",
        items: items(1, "d"),
        pockets: [
          { key: "Portfolios", items: items(2, "p") },
          { key: "Empty", items: [] },
        ],
      },
    ],
    WIDTH,
    2,
    GAP,
    HEADER,
    inset,
    30
  );

  it("lays a pocket out under the loose cards, one inset further in", () => {
    const loose = out.positions.find((p) => p.id === "d0")!;
    const pocketed = out.positions.filter((p) => p.id.startsWith("p"));
    expect(loose.x).toBe(inset);
    expect(Math.min(...pocketed.map((p) => p.x))).toBe(inset * 2);
    for (const p of pocketed) expect(p.y).toBeGreaterThan(loose.y + loose.h);
  });

  it("gives the pocket a heading of its own and counts it into the island", () => {
    const [island] = out.headers;
    expect(island.count).toBe(3);
    expect(island.pockets.map((p) => [p.key, p.count, p.height])).toEqual([["Portfolios", 2, 30]]);
    const pocket = island.pockets[0];
    for (const p of out.positions.filter((p) => p.id.startsWith("p"))) {
      expect(p.y).toBeGreaterThanOrEqual(pocket.y + pocket.height);
      expect(p.y + p.h).toBeLessThanOrEqual(pocket.bottom);
    }
    expect(island.bottom).toBe(pocket.bottom + inset);
  });

  it("shows an island that is all pockets, and skips one that is all empty pockets", () => {
    const full = computeIslands(
      [{ key: "a", items: [], pockets: [{ key: "f", items: items(1, "f") }] }],
      WIDTH,
      2,
      GAP,
      HEADER
    );
    expect(full.headers).toHaveLength(1);
    const none = computeIslands(
      [{ key: "a", items: [], pockets: [{ key: "f", items: [] }] }],
      WIDTH,
      2,
      GAP,
      HEADER
    );
    expect(none.headers).toHaveLength(0);
  });

  it("resolves a point in a pocket to the pocket, and beside it to the island", () => {
    const [island] = out.headers;
    const pocket = island.pockets[0];
    expect(islandAt(out.headers, pocket.y + 5, 0)).toEqual({ island, pocket });
    expect(islandAt(out.headers, island.y + HEADER + 5, 0)).toEqual({ island, pocket: null });
  });
});

describe("islandAt", () => {
  const out = computeIslands(
    [
      { key: "a", items: items(1, "a") },
      { key: "b", items: items(1, "b") },
    ],
    WIDTH,
    2,
    GAP,
    HEADER
  );
  const [a, b] = out.headers;

  it("finds the island whose heading or cards are under the point", () => {
    expect(islandAt(out.headers, a.y + 5, 0)?.island.key).toBe("a");
    expect(islandAt(out.headers, a.y + HEADER + 50, 0)?.island.key).toBe("a");
    expect(islandAt(out.headers, b.y + 5, 0)?.island.key).toBe("b");
  });

  it("gives the gap under an island to that island, so a drop just below the last row lands", () => {
    expect(islandAt(out.headers, a.bottom + 10, 0)?.island.key).toBe("a");
  });

  it("answers null past the end and above the start, beyond the slack", () => {
    expect(islandAt(out.headers, b.bottom + 200, 40)).toBeNull();
    expect(islandAt(out.headers, b.bottom + 20, 40)?.island.key).toBe("b");
    expect(islandAt(out.headers, -100, 40)).toBeNull();
    expect(islandAt(out.headers, -10, 40)?.island.key).toBe("a");
  });

  it("finds nothing on a wall with no islands", () => {
    expect(islandAt([], 10, 40)).toBeNull();
  });
});
