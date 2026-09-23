import { describe, expect, it } from "vitest";
import {
  LOOSE,
  folderForPlacement,
  freePath,
  mergeByName,
  mergeFolders,
  pathForPlacement,
  placementOfPath,
  treeFromFolders,
  validatePathName,
} from "../src/core/placement";

const ROOT = "Library";

describe("placementOfPath", () => {
  it("reads a grid from the first folder and a folder from the second", () => {
    expect(placementOfPath("Library/Payments/a.md", ROOT)).toEqual({ grid: "Payments", folder: "" });
    expect(placementOfPath("Library/Payments/Checkout/a.md", ROOT)).toEqual({
      grid: "Payments",
      folder: "Checkout",
    });
  });

  it("is loose for a note in the clippings folder itself", () => {
    expect(placementOfPath("Library/a.md", ROOT)).toEqual(LOOSE);
  });

  it("stops at two levels, so deeper still belongs to the same folder", () => {
    expect(placementOfPath("Library/Payments/Checkout/2026/a.md", ROOT)).toEqual({
      grid: "Payments",
      folder: "Checkout",
    });
  });

  it("is loose rather than an error for a path outside the folder", () => {
    expect(placementOfPath("Notes/a.md", ROOT)).toEqual(LOOSE);
    expect(placementOfPath("Librarysomething/a.md", ROOT)).toEqual(LOOSE);
  });

  it("takes a trailing slash on the root", () => {
    expect(placementOfPath("Library/Payments/a.md", "Library/")).toEqual({
      grid: "Payments",
      folder: "",
    });
  });
});

describe("folderForPlacement", () => {
  it("joins what is set and skips what is not", () => {
    expect(folderForPlacement(ROOT, { grid: "Payments", folder: "Checkout" })).toBe(
      "Library/Payments/Checkout"
    );
    expect(folderForPlacement(ROOT, { grid: "Payments", folder: "" })).toBe("Library/Payments");
    expect(folderForPlacement(ROOT, LOOSE)).toBe("Library");
  });

  it("ignores a folder named without a grid, which has nowhere to be", () => {
    expect(folderForPlacement(ROOT, { grid: "", folder: "Checkout" })).toBe("Library/Checkout");
  });
});

describe("pathForPlacement", () => {
  it("keeps the file name and changes the folders", () => {
    expect(pathForPlacement("Library/a b.md", ROOT, { grid: "Payments", folder: "" })).toBe(
      "Library/Payments/a b.md"
    );
    expect(
      pathForPlacement("Library/Payments/Checkout/a.md", ROOT, { grid: "Typography", folder: "" })
    ).toBe("Library/Typography/a.md");
  });

  it("moves back to the clippings folder for a loose placement", () => {
    expect(pathForPlacement("Library/Payments/a.md", ROOT, LOOSE)).toBe("Library/a.md");
  });

  it("is null when the note is already where it is being sent", () => {
    expect(pathForPlacement("Library/a.md", ROOT, LOOSE)).toBeNull();
    expect(pathForPlacement("Library/Payments/a.md", ROOT, { grid: "Payments", folder: "" })).toBeNull();
  });
});

describe("freePath", () => {
  it("is the target when nothing holds it", () => {
    expect(freePath("Library/a.md", () => false)).toBe("Library/a.md");
  });

  it("counts up past what is taken, before the extension", () => {
    const taken = new Set(["Library/a.md", "Library/a 2.md"]);
    expect(freePath("Library/a.md", (p) => taken.has(p))).toBe("Library/a 3.md");
  });
});

describe("treeFromFolders", () => {
  it("reads grids from the first level and folders from the second", () => {
    const tree = treeFromFolders(
      [
        "Library",
        "Library/Payments",
        "Library/Payments/Checkout",
        "Library/Typography",
        "Attachments/Library",
      ],
      ROOT
    );
    expect(tree.grids).toEqual(["Payments", "Typography"]);
    expect(tree.folders).toEqual([{ name: "Checkout", grid: "Payments" }]);
  });

  it("names a grid once however many folders it holds", () => {
    const tree = treeFromFolders(
      ["Library/Payments/Checkout", "Library/Payments/Wallets", "Library/Payments"],
      ROOT
    );
    expect(tree.grids).toEqual(["Payments"]);
    expect(tree.folders.map((f) => f.name)).toEqual(["Checkout", "Wallets"]);
  });

  it("skips folders marked as not a clipping's home", () => {
    const tree = treeFromFolders(
      ["Library/_drafts", "Library/.trash", "Library/Payments/_notes", "Library/Payments"],
      ROOT
    );
    expect(tree.grids).toEqual(["Payments"]);
    expect(tree.folders).toEqual([]);
  });

  it("reads a deeper path for its first two levels only", () => {
    const tree = treeFromFolders(["Library/Payments/Checkout/2026/Q1"], ROOT);
    expect(tree.grids).toEqual(["Payments"]);
    expect(tree.folders).toEqual([{ name: "Checkout", grid: "Payments" }]);
  });
});

describe("mergeByName", () => {
  interface Grid {
    name: string;
    icon: string;
    rules?: Record<string, string[]>;
  }
  const make = (name: string): Grid => ({ name, icon: "layout-grid" });
  const smart = (entry: Grid): boolean => entry.rules !== undefined;

  it("keeps the stored order and the stored look", () => {
    const stored: Grid[] = [
      { name: "Typography", icon: "type" },
      { name: "Payments", icon: "credit-card" },
    ];
    const out = mergeByName(["Payments", "Typography"], stored, make, smart);
    expect(out).toEqual(stored);
  });

  it("adds a folder the config never heard of, at the end", () => {
    const stored: Grid[] = [{ name: "Payments", icon: "credit-card" }];
    const out = mergeByName(["Payments", "Posters"], stored, make, smart);
    expect(out.map((g) => g.name)).toEqual(["Payments", "Posters"]);
    expect(out[1].icon).toBe("layout-grid");
  });

  it("drops an entry whose folder is gone", () => {
    const stored: Grid[] = [
      { name: "Payments", icon: "credit-card" },
      { name: "Deleted", icon: "trash" },
    ];
    expect(mergeByName(["Payments"], stored, make, smart).map((g) => g.name)).toEqual(["Payments"]);
  });

  it("keeps smart views, which are rules rather than folders", () => {
    const stored: Grid[] = [
      { name: "Unread", icon: "eye", rules: { status: ["unread"] } },
      { name: "Payments", icon: "credit-card" },
    ];
    const out = mergeByName(["Payments"], stored, make, smart);
    expect(out.map((g) => g.name)).toEqual(["Unread", "Payments"]);
  });

  it("never lists a name twice", () => {
    const stored: Grid[] = [
      { name: "Payments", icon: "credit-card" },
      { name: "Payments", icon: "wallet" },
    ];
    const out = mergeByName(["Payments"], stored, make, smart);
    expect(out).toHaveLength(1);
    expect(out[0].icon).toBe("credit-card");
  });
});

describe("validatePathName", () => {
  it("accepts an ordinary name", () => {
    expect(validatePathName("Payments", [])).toBeNull();
    expect(validatePathName("UI & UX 2026", [])).toBeNull();
  });

  it("refuses what a folder cannot be", () => {
    expect(validatePathName("", [])).toContain("empty");
    expect(validatePathName("a/b", [])).toContain("cannot contain");
    expect(validatePathName("a:b", [])).toContain("cannot contain");
    expect(validatePathName(".hidden", [])).toContain("dot");
    expect(validatePathName("_Goko", [])).toContain("underscore");
    expect(validatePathName("trailing.", [])).toContain("end with a dot");
    expect(validatePathName("x".repeat(101), [])).toContain("too long");
  });

  it("refuses a name already taken, whatever the case", () => {
    expect(validatePathName("payments", ["Payments"])).toContain("already exists");
    expect(validatePathName(" Payments ", ["payments"])).toContain("already exists");
  });

  it("names the thing being named", () => {
    expect(validatePathName("", [], "grid name")).toBe("The grid name cannot be empty");
  });
});

describe("mergeFolders", () => {
  interface Folder {
    name: string;
    grid: string;
    icon: string;
    width: number;
  }
  const make = (entry: { name: string; grid: string }): Folder => ({
    ...entry,
    icon: "folder",
    width: 1,
  });

  it("identifies a folder by its grid and its name together", () => {
    const stored: Folder[] = [
      { name: "Drafts", grid: "Payments", icon: "pencil", width: 2 },
      { name: "Drafts", grid: "Posters", icon: "image", width: 1 },
    ];
    const out = mergeFolders(
      [
        { name: "Drafts", grid: "Payments" },
        { name: "Drafts", grid: "Posters" },
      ],
      stored,
      make
    );
    expect(out).toEqual(stored);
  });

  it("keeps the stored width and icon, and defaults a new one", () => {
    const stored: Folder[] = [{ name: "Drafts", grid: "Payments", icon: "pencil", width: 3 }];
    const out = mergeFolders(
      [
        { name: "Drafts", grid: "Payments" },
        { name: "Wallets", grid: "Payments" },
      ],
      stored,
      make
    );
    expect(out[0].width).toBe(3);
    expect(out[1]).toEqual({ name: "Wallets", grid: "Payments", icon: "folder", width: 1 });
  });

  it("drops a folder whose directory is gone, on that grid only", () => {
    const stored: Folder[] = [
      { name: "Drafts", grid: "Payments", icon: "pencil", width: 1 },
      { name: "Drafts", grid: "Posters", icon: "image", width: 1 },
    ];
    const out = mergeFolders([{ name: "Drafts", grid: "Posters" }], stored, make);
    expect(out).toEqual([stored[1]]);
  });
});
