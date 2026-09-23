import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GUIDE_BANNER, GUIDE_PATH, guideMarkdown, guideOwed, guideStep } from "../src/core/guide";
import type { GuideSettings } from "../src/core/guide";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import { parseRules } from "../src/core/rules";
import { COPY, HEADINGS } from "../src/core/settings-copy";

const defaults: GuideSettings = {
  clippingsFolder: DEFAULT_SETTINGS.clippingsFolder,
  attachmentFolder: DEFAULT_SETTINGS.attachmentFolder,
  sharedClipTarget: DEFAULT_SETTINGS.sharedClipTarget,
  homeGridName: DEFAULT_SETTINGS.homeGridName,
};

describe("guideOwed", () => {
  it("owes a vault Goko has never run in", () => {
    expect(guideOwed(null)).toBe(true);
    expect(guideOwed(undefined)).toBe(true);
    expect(guideOwed({})).toBe(true);
  });

  it("owes nothing to a vault that ran a version from before the guide", () => {
    expect(guideOwed({ clippingsFolder: "Library", tileSize: "s" })).toBe(false);
  });

  it("owes nothing once the guide has been shown", () => {
    expect(guideOwed({ clippingsFolder: "Library", guideShown: true })).toBe(false);
    expect(guideOwed({ guideShown: true })).toBe(false);
  });

  it("still owes it when this version saved before it had the chance to show it", () => {
    expect(guideOwed({ clippingsFolder: "Library", guideShown: false })).toBe(true);
  });

  it("does not read the defaults as a vault that has run before", () => {
    // What loadSettings hands on is data.json laid over the defaults, which
    // has every key; the decision has to be made from what was saved.
    expect(guideOwed({ ...DEFAULT_SETTINGS })).toBe(true);
    expect(guideOwed({ ...DEFAULT_SETTINGS, guideShown: true })).toBe(false);
  });
});

describe("guideStep", () => {
  it("writes the note in a fresh vault", () => {
    expect(guideStep(true, false)).toBe("create");
  });

  it("opens a note already there rather than writing over it", () => {
    expect(guideStep(true, true)).toBe("open");
  });

  it("does nothing on a launch that owes nothing, whether or not the note is there", () => {
    expect(guideStep(false, false)).toBe("none");
    expect(guideStep(false, true)).toBe("none");
  });

  it("does nothing on the launch after the first, however the vault was left", () => {
    const first = guideOwed(null);
    expect(guideStep(first, false)).toBe("create");
    const second = guideOwed({ ...DEFAULT_SETTINGS, guideShown: true });
    expect(guideStep(second, true)).toBe("none");
    expect(guideStep(second, false)).toBe("none");
  });
});

describe("GUIDE_PATH", () => {
  it("sits at the root of the vault, out of the clippings folder", () => {
    expect(GUIDE_PATH).toBe("Goko — start here.md");
    expect(GUIDE_PATH).not.toContain("/");
  });
});

describe("guideMarkdown", () => {
  it("names the folders the settings hold, not the defaults", () => {
    const text = guideMarkdown({
      ...defaults,
      clippingsFolder: "Reading/Saved",
      attachmentFolder: "Media/Saved",
    });
    expect(text).toContain("`Reading/Saved`");
    expect(text).toContain("`Media/Saved`");
    expect(text).not.toContain("`Clippings`");
    expect(text).not.toContain("`Attachments/Clippings`");
  });

  it("names the default folders in a vault that kept them", () => {
    const text = guideMarkdown(defaults);
    expect(text).toContain("`Clippings`");
    expect(text).toContain("`Attachments/Clippings`");
  });

  it("drops stray slashes, and says so plainly when a folder is the vault root", () => {
    const text = guideMarkdown({ ...defaults, clippingsFolder: "/Saved/", attachmentFolder: "" });
    expect(text).toContain("`Saved`");
    expect(text).toContain("Pictures and video go to the root of the vault.");
  });

  it("says where a shared clip lands under each setting", () => {
    expect(guideMarkdown({ ...defaults, sharedClipTarget: "last-opened" })).toContain(
      "Links you share this way go to the grid you last had open."
    );
    expect(guideMarkdown({ ...defaults, sharedClipTarget: "home", homeGridName: "Inbox" })).toContain(
      "Links you share this way go to Inbox, the home grid."
    );
    expect(guideMarkdown({ ...defaults, sharedClipTarget: "ask" })).toContain(
      "Links you share this way go to whichever grid you pick each time."
    );
  });

  it("opens on the banner, then says what Goko is, leaving the title to the file's name", () => {
    const text = guideMarkdown(defaults);
    expect(text.startsWith(["```", ...GUIDE_BANNER, "```", ""].join("\n"))).toBe(true);
    const prose = text.split("\n").slice(GUIDE_BANNER.length + 2).find((line) => line !== "");
    expect(prose?.startsWith("Goko is a wall")).toBe(true);
  });

  it("carries the banner exactly as the README draws it", () => {
    // The README's first fenced block is the banner; the guide's has to be
    // the same five lines, down to the leading spaces that line the O up.
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const fenced = /```\n([\s\S]*?)\n```/.exec(readme)?.[1] ?? "";
    expect(fenced.split("\n")).toEqual(GUIDE_BANNER);
  });

  it("says where the name comes from", () => {
    expect(guideMarkdown(defaults)).toContain("*око*, “eye”");
  });

  it("covers each part a first launch needs, in order", () => {
    const text = guideMarkdown(defaults);
    const headings = text
      .split("\n")
      .filter((line) => line.startsWith("#"))
      .map((line) => line.replace(/^#+ /, ""));
    expect(headings).toEqual([
      "🖥️ Clip on a desktop",
      "📱 Clip from a phone",
      "🗂️ Where the files go",
      "🎬 Video from Instagram, X and YouTube",
      "🧭 Finding your way",
    ]);
  });

  it("keeps to a handful of emoji", () => {
    const count = guideMarkdown(defaults).match(/\p{Extended_Pictographic}/gu)?.length ?? 0;
    expect(count).toBeGreaterThanOrEqual(4);
    expect(count).toBeLessThanOrEqual(6);
  });

  it("walks to the clip button the way the wall shows it", () => {
    const text = guideMarkdown(defaults);
    expect(text).toContain("press **+** at the foot of the wall and choose **Clip**");
    expect(text).not.toContain("press **Clip**");
  });

  it("names the guide's own button as the wall and the palette label it", () => {
    const text = guideMarkdown(defaults);
    expect(text).toContain("**Open guide**");
    expect(text).not.toContain("Open the guide");
  });

  it("names the settings it sends you to as they are labelled", () => {
    const text = guideMarkdown(defaults);
    // Read from the settings' own copy, so a row renamed there cannot leave
    // the guide sending people to a label that no longer exists.
    for (const name of [
      COPY.clippingsFolder.name,
      COPY.attachmentFolder.name,
      COPY.sharedClipTarget.name,
      COPY.ytdlpPath.name,
      COPY.ffmpegPath.name,
      COPY.domainRules.name,
      COPY.useResolvers.name,
      COPY.openGuide.button,
      HEADINGS.help,
    ]) {
      expect(text).toContain(`**${name}**`);
    }
  });

  it("puts the video tools in a tip and privacy in a note", () => {
    const lines = guideMarkdown(defaults).split("\n");
    const callout = (kind: string) => {
      const start = lines.findIndex((line) => line.startsWith(`> [!${kind}]`));
      const end = lines.findIndex((line, i) => i > start && !line.startsWith(">"));
      return start < 0 ? "" : lines.slice(start, end).join("\n");
    };
    expect(callout("tip")).toContain("`brew install yt-dlp ffmpeg`");
    expect(callout("note")).toContain("`api.fxtwitter.com`");
  });

  it("gives the phone its shortcut as numbered steps", () => {
    const steps = guideMarkdown(defaults)
      .split("\n")
      .filter((line) => /^\d+\. /.test(line));
    expect(steps.map((line) => line.slice(0, 3))).toEqual(["1. ", "2. ", "3. ", "4. "]);
    expect(steps.join("\n")).toContain("**Get URLs from Input**");
    expect(steps[steps.length - 1]).toContain("`obsidian://goko?url=`");
  });

  it("points the phone at the URI the plugin answers", () => {
    expect(guideMarkdown(defaults)).toContain("`obsidian://goko?url=`");
  });

  it("gives the macOS install line and what happens without the tools", () => {
    const text = guideMarkdown(defaults);
    expect(text).toContain("`brew install yt-dlp ffmpeg`");
    expect(text).toContain("poster");
  });

  it("names the one third party, and says it can be turned off", () => {
    const text = guideMarkdown(defaults);
    expect(text).toContain("`api.fxtwitter.com`");
    expect(text).toContain("turn that off");
  });

  it("gives a domain rule example that the rules parser accepts", () => {
    const line = guideMarkdown(defaults)
      .split("\n")
      .find((entry) => entry.includes("**Domain rules**")) ?? "";
    const example = /`([^`\n]+)`/.exec(line)?.[1] ?? "";
    expect(example).not.toBe("");
    const parsed = parseRules(example);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rules).toHaveLength(1);
  });

  it("ends on how to get the note back", () => {
    const text = guideMarkdown(defaults).trimEnd();
    const last = text.slice(text.lastIndexOf("\n") + 1);
    expect(last.startsWith("You can delete this note — **Open guide** brings it back.")).toBe(true);
  });

  it("stays short enough to read in a couple of scrolls", () => {
    expect(guideMarkdown(defaults).split("\n").length).toBeLessThan(70);
  });
});
