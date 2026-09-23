import { describe, expect, it } from "vitest";
import { placeOf, placesFor } from "../src/core/places";
import { HOME_TINT } from "../src/core/spaces";
import type { FolderSpace } from "../src/core/folders";
import type { ClippingRecord } from "../src/core/scan";
import type { GridSpace } from "../src/core/spaces";

const HOME: GridSpace = { name: "Inbox", icon: "inbox" };
const PAYMENTS: GridSpace = { name: "Payments", icon: "credit-card", color: "orange" };
const GRIDS = [PAYMENTS];

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

function folder(name: string, grid: string, icon = "folder"): FolderSpace {
  return { name, grid, icon, width: 1 };
}

/** The library scope always has something to say, so its tests may assume it. */
function must<T>(chip: T | null): T {
  if (!chip) throw new Error("expected a chip");
  return chip;
}

describe("placeOf, in the library", () => {
  it("names the board, with its own icon and colour", () => {
    expect(must(placeOf(record({ grid: "Payments" }), GRIDS, [], HOME))).toEqual({
      label: "Payments",
      icon: "credit-card",
      color: "var(--color-orange)",
      filed: true,
    });
  });

  it("names the folder under the board, and takes the folder's icon", () => {
    const place = must(
      placeOf(
        record({ grid: "Payments", folder: "Checkout" }),
        GRIDS,
        [folder("Checkout", "Payments", "wallet")],
        HOME
      )
    );
    expect(place.label).toBe("Payments / Checkout");
    expect(place.icon).toBe("wallet");
    // The colour stays the board's: a folder has none of its own.
    expect(place.color).toBe("var(--color-orange)");
  });

  it("reads an unfiled card as home, and says it is loose", () => {
    const place = must(placeOf(record(), GRIDS, [], HOME));
    expect(place.label).toBe("Inbox");
    expect(place.filed).toBe(false);
  });

  it("reads a card naming a deleted board as home, where the wall puts it", () => {
    const place = must(placeOf(record({ grid: "Gone" }), GRIDS, [], HOME));
    expect(place.label).toBe("Inbox");
    expect(place.filed).toBe(false);
  });

  it("finds a folder that sits on home, whose grid is the empty string", () => {
    const place = must(placeOf(record({ folder: "Career" }), GRIDS, [folder("Career", "")], HOME));
    expect(place.label).toBe("Inbox / Career");
    expect(place.filed).toBe(true);
  });

  it("ignores a folder of the same name on another board", () => {
    const place = must(
      placeOf(record({ grid: "Payments", folder: "Career" }), GRIDS, [folder("Career", "")], HOME)
    );
    expect(place.label).toBe("Payments");
  });

  it("gives a board with no colour of its own a stable one from its name", () => {
    const bare = { name: "Bare", icon: "layout-grid" };
    const once = must(placeOf(record({ grid: "Bare" }), [bare], [], HOME));
    const again = must(placeOf(record({ grid: "Bare" }), [bare], [], HOME));
    expect(once.color).toMatch(/^var\(--color-[a-z]+\)$/);
    expect(again.color).toBe(once.color);
  });

  it("lets a colour chosen by hand win over the derived one", () => {
    expect(must(placeOf(record({ grid: "Payments" }), GRIDS, [], HOME)).color).toBe(
      "var(--color-orange)"
    );
  });
});

describe("placeOf, on a board's own wall", () => {
  it("names the folder alone: the board is the heading already", () => {
    const place = must(
      placeOf(
        record({ grid: "Payments", folder: "Checkout" }),
        GRIDS,
        [folder("Checkout", "Payments", "wallet")],
        HOME,
        "grid"
      )
    );
    expect(place.label).toBe("Checkout");
    expect(place.icon).toBe("wallet");
    expect(place.color).toBe("var(--color-orange)");
  });

  it("says nothing about a card filed loose on the board", () => {
    // The wall already says which board this is; that it is in no folder of
    // it is not worth a chip on every card.
    expect(placeOf(record({ grid: "Payments" }), GRIDS, [], HOME, "grid")).toBeNull();
  });

  it("says nothing when the folder belongs to another board", () => {
    expect(
      placeOf(record({ grid: "Payments", folder: "Career" }), GRIDS, [folder("Career", "")], HOME, "grid")
    ).toBeNull();
  });
});

describe("placesFor", () => {
  it("keys every card by its note path", () => {
    const places = placesFor(
      [record({ path: "Library/a.md", grid: "Payments" }), record({ path: "Library/b.md" })],
      GRIDS,
      [],
      HOME
    );
    expect(places.get("Library/a.md")?.label).toBe("Payments");
    expect(places.get("Library/b.md")?.filed).toBe(false);
    expect(places.size).toBe(2);
  });

  it("leaves out the cards a board's wall has nothing to say about", () => {
    const places = placesFor(
      [
        record({ path: "Library/a.md", grid: "Payments", folder: "Checkout" }),
        record({ path: "Library/b.md", grid: "Payments" }),
      ],
      GRIDS,
      [folder("Checkout", "Payments")],
      HOME,
      "grid"
    );
    expect(places.get("Library/a.md")?.label).toBe("Checkout");
    expect(places.has("Library/b.md")).toBe(false);
  });
});

describe("the inbox's colour", () => {
  it("is plain rather than a hue, as the rail draws it", () => {
    expect(must(placeOf(record(), GRIDS, [], HOME)).color).toBe(HOME_TINT);
    expect(must(placeOf(record({ grid: "Payments" }), GRIDS, [], HOME)).color).toBe("var(--color-orange)");
  });
});
