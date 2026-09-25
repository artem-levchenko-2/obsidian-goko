import { describe, expect, it } from "vitest";
import { GRID_ICONS, ICON_GROUPS, iconIndex, iconsMatching, offeredIcons } from "../src/core/icon-choices";
import { PLAIN_GRID_ICON } from "../src/core/shared-config";

describe("ICON_GROUPS", () => {
  it("keeps every group at twelve, two full rows of six", () => {
    for (const group of ICON_GROUPS) expect(group.icons, group.title).toHaveLength(12);
  });

  it("offers each icon once", () => {
    expect(new Set(GRID_ICONS).size).toBe(GRID_ICONS.length);
  });

  it("starts on the icon a new grid gets", () => {
    expect(GRID_ICONS[0]).toBe(PLAIN_GRID_ICON);
  });
});

describe("offeredIcons", () => {
  it("captions each group on its first icon", () => {
    const offered = offeredIcons(PLAIN_GRID_ICON);
    expect(offered).toHaveLength(GRID_ICONS.length);
    expect(offered[0]).toEqual({ name: PLAIN_GRID_ICON, heading: ICON_GROUPS[0].title });
    expect(offered[1]).toEqual({ name: ICON_GROUPS[0].icons[1] });
    expect(offered[12]).toEqual({ name: ICON_GROUPS[1].icons[0], heading: ICON_GROUPS[1].title });
  });

  it("adds an icon the list does not have, last, so it can stay chosen", () => {
    const offered = offeredIcons("ferris-wheel");
    expect(offered.at(-1)).toEqual({ name: "ferris-wheel", heading: "Current" });
    expect(iconIndex("ferris-wheel")).toBe(offered.length - 1);
  });

  it("opens on a listed icon where it is listed", () => {
    expect(iconIndex("hammer")).toBe(GRID_ICONS.indexOf("hammer"));
    expect(offeredIcons("hammer")).toHaveLength(GRID_ICONS.length);
  });

  it("opens on the first icon when there is none", () => {
    expect(iconIndex("")).toBe(0);
    expect(offeredIcons("")).toHaveLength(GRID_ICONS.length);
  });
});

describe("iconsMatching", () => {
  it("finds icons by part of their name, words joined the way names are", () => {
    expect(iconsMatching("ham")).toEqual(["hammer"]);
    expect(iconsMatching("paint bucket")).toEqual(["paint-bucket"]);
  });

  it("is every icon for nothing typed, and none for nonsense", () => {
    expect(iconsMatching("  ")).toHaveLength(GRID_ICONS.length);
    expect(iconsMatching("zzzz")).toEqual([]);
  });
});
