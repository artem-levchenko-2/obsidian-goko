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

  it("plays a video on the wall only while it is hovered", () => {
    expect(DEFAULT_SETTINGS.autoplayVideo).toBe(false);
  });

  it("opens a video without sound", () => {
    expect(DEFAULT_SETTINGS.openVideosMuted).toBe(true);
  });

  it("lets the tags be edited, which are the reader's own labels", () => {
    expect(DEFAULT_SETTINGS.allowEditingTags).toBe(true);
  });

  it("starts with no AI provider, and so no model", () => {
    expect(DEFAULT_SETTINGS.aiProvider).toBe("");
    expect(DEFAULT_SETTINGS.aiModel).toBe("");
  });
});
