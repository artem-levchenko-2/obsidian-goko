import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/core/settings";

describe("settings", () => {
  it("defaults to the Clippings folder", () => {
    expect(DEFAULT_SETTINGS.clippingsFolder).toBe("Clippings");
  });

  it("calls the grid for unfiled clippings Inbox, and opens on it", () => {
    expect(DEFAULT_SETTINGS.homeGridName).toBe("Inbox");
    expect(DEFAULT_SETTINGS.homeGridIcon).toBe("inbox");
    expect(DEFAULT_SETTINGS.activeGrid).toBe(DEFAULT_SETTINGS.homeGridName);
  });

  it("caps files at 25MB", () => {
    expect(DEFAULT_SETTINGS.maxBytes).toBe(25 * 1024 * 1024);
  });
});
