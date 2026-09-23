import { describe, expect, it } from "vitest";
import {
  COPY,
  DESC_LIMIT,
  HEADINGS,
  LINE_LIMIT,
  NUMBER_LIMITS,
  PROPERTY_LIST_EMPTY,
  RULES_PLACEHOLDER,
  descParts,
  toolStatus,
} from "../src/core/settings-copy";
import type { SettingCopy } from "../src/core/settings-copy";
import { parseRules } from "../src/core/rules";
import { isEditable } from "../src/core/editable";

const entries = Object.entries(COPY) as Array<[string, SettingCopy]>;

// Words that keep their capitals mid-name: products, services and acronyms.
const PROPER = new Set(["Goko", "YouTube", "AI", "API", "ID", "MB"]);

function sentenceCase(text: string): boolean {
  const [first, ...rest] = text.split(" ");
  if (!/^[A-Z]/.test(first)) return false;
  return rest
    .map((word) => word.replace(/^\(|\)$/g, ""))
    .every((word) => PROPER.has(word) || word === word.toLowerCase());
}

describe("settings copy", () => {
  it("names every row and heading in sentence case", () => {
    for (const heading of Object.values(HEADINGS)) expect(sentenceCase(heading), heading).toBe(true);
    for (const [key, entry] of entries) expect(sentenceCase(entry.name), key).toBe(true);
  });

  it("labels each button with a short verb in sentence case", () => {
    const labelled = entries.filter(([, entry]) => entry.button !== undefined);
    expect(labelled.map(([key]) => key)).toEqual(expect.arrayContaining(["rescan", "applyRules", "openGuide"]));
    for (const [key, entry] of labelled) {
      const label = entry.button ?? "";
      expect(sentenceCase(label), key).toBe(true);
      expect(label.split(" ").length, key).toBeLessThanOrEqual(2);
      expect(label.toLowerCase(), key).not.toBe(entry.name.toLowerCase());
    }
  });

  it("describes every row", () => {
    for (const [key, entry] of entries) expect(descParts(entry).length, key).toBeGreaterThan(0);
  });

  it("keeps descriptions and their lines short", () => {
    for (const [key, entry] of entries) {
      const desc = entry.desc ?? "";
      expect(desc.length, `${key}: ${desc.length} characters`).toBeLessThanOrEqual(DESC_LIMIT);
      for (const line of entry.lines ?? []) {
        expect(line.text.length, `${key}: ${line.text}`).toBeLessThanOrEqual(LINE_LIMIT);
      }
    }
  });

  it("writes whole sentences", () => {
    const texts = [
      ...entries.flatMap(([, entry]) => [
        ...(entry.desc ? [entry.desc] : []),
        ...(entry.lines ?? []).map((line) => line.text),
      ]),
      ...Object.values(PROPERTY_LIST_EMPTY),
    ];
    for (const text of texts) {
      expect(text, text).toMatch(/^[A-Z0-9*]/);
      expect(text, text).toMatch(/\.$/);
    }
  });

  it("gives what a state or a choice does a labelled line, not a clause", () => {
    // "Off: …" inside a sentence is what the lines replaced: it put what a
    // switch does and what it costs in one run of text.
    for (const [key, entry] of entries) {
      expect(entry.desc ?? "", key).not.toMatch(/\b(On|Off|When on|When off):/);
    }
  });

  it("gives a switch both of its states", () => {
    for (const [key, entry] of entries) {
      const labels = (entry.lines ?? []).map((line) => line.label);
      expect(labels.includes("When on"), key).toBe(labels.includes("When off"));
      if (labels.includes("When on")) expect(labels, key).toEqual(["When on", "When off"]);
    }
  });

  it("labels each line in a word or two, in sentence case", () => {
    for (const [key, entry] of entries) {
      for (const line of entry.lines ?? []) {
        expect(sentenceCase(line.label), `${key}: ${line.label}`).toBe(true);
        expect(line.label.split(" ").length, `${key}: ${line.label}`).toBeLessThanOrEqual(3);
      }
    }
  });

  it("names no hotkey and no command", () => {
    const banned = /⌘|\bctrl\b|\bcmd\b|command|hotkey|shortcut|→/i;
    for (const [key, entry] of entries) {
      expect(entry.name, key).not.toMatch(banned);
      for (const part of descParts(entry)) expect(part, key).not.toMatch(banned);
    }
  });

  it("uses the same word for a thing everywhere", () => {
    // A clipping is not a clip, a bookmark or a pin; the wall is not a board
    // or a canvas; the panel on the right is the details panel.
    const offWords = /\b(clips|bookmarks?|pins?|board|canvas|pane|detail pane|detail panel)\b/i;
    for (const [key, entry] of entries) {
      expect(entry.name, key).not.toMatch(offWords);
      for (const part of descParts(entry)) expect(part, key).not.toMatch(offWords);
    }
  });

  it("gives every row words to be found by besides its name", () => {
    for (const [key, entry] of entries) {
      expect(entry.aliases.length, key).toBeGreaterThan(0);
      for (const alias of entry.aliases) {
        expect(entry.name.toLowerCase(), `${key}: "${alias}" repeats the name`).not.toBe(alias);
        expect(alias, key).toBe(alias.toLowerCase());
      }
    }
  });

  it("lets a search for what a person would type find the row", () => {
    const finds = (query: string): string[] =>
      entries
        .filter(([, entry]) =>
          [entry.name, ...entry.aliases].some((word) => word.toLowerCase().includes(query))
        )
        .map(([key]) => key);

    expect(finds("yt-dlp")).toEqual(expect.arrayContaining(["ytdlpPath"]));
    expect(finds("ytdlp")).toEqual(expect.arrayContaining(["ytdlpPath"]));
    expect(finds("ffmpeg")).toEqual(expect.arrayContaining(["ffmpegPath"]));
    expect(finds("video")).toEqual(
      expect.arrayContaining(["autoplayVideo", "youtubeVideoMinutes", "ytdlpPath", "ffmpegPath"])
    );
    expect(finds("instagram")).toEqual(["useResolvers"]);
    expect(finds("twitter")).toEqual(["useResolvers"]);
    expect(finds("rules")).toEqual(expect.arrayContaining(["domainRules", "applyRules"]));
    expect(finds("tags")).toEqual(
      expect.arrayContaining(["tileProperty", "allowEditingTags", "tagProperty"])
    );
    expect(finds("card")).toEqual(expect.arrayContaining(["tileProperty", "cardProperties"]));
    expect(finds("share sheet")).toEqual(["sharedClipTarget"]);
    expect(finds("privacy")).toEqual(expect.arrayContaining(["privacy", "useResolvers"]));
  });
});

describe("rules placeholder", () => {
  it("is an example that works as written", () => {
    const { rules, errors } = parseRules(RULES_PLACEHOLDER);
    expect(errors).toEqual([]);
    expect(rules.map((rule) => rule.pattern)).toEqual(["dribbble.com", "*.behance.net", "github.com"]);
    expect(rules[1].annotation).toEqual({ categories: ["portfolio", "branding"] });
  });

  it("writes only keys a rule is allowed to write", () => {
    const keys = parseRules(RULES_PLACEHOLDER).rules.flatMap((rule) => Object.keys(rule.annotation));
    for (const key of keys) expect(isEditable(key), key).toBe(true);
  });
});

describe("number limits", () => {
  it("keeps the checks the fields have always had", () => {
    expect(NUMBER_LIMITS.maxSizeMb.ok(25)).toBe(true);
    expect(NUMBER_LIMITS.maxSizeMb.ok(0.5)).toBe(true);
    expect(NUMBER_LIMITS.maxSizeMb.ok(0)).toBe(false);
    expect(NUMBER_LIMITS.maxSizeMb.ok(-1)).toBe(false);
    expect(NUMBER_LIMITS.maxSizeMb.ok(Number.NaN)).toBe(false);

    expect(NUMBER_LIMITS.youtubeVideoMinutes.ok(0)).toBe(true);
    expect(NUMBER_LIMITS.youtubeVideoMinutes.ok(12)).toBe(true);
    expect(NUMBER_LIMITS.youtubeVideoMinutes.ok(-1)).toBe(false);
    expect(NUMBER_LIMITS.youtubeVideoMinutes.ok(Number.POSITIVE_INFINITY)).toBe(false);

    expect(NUMBER_LIMITS.thumbnailWidth.ok(100)).toBe(true);
    expect(NUMBER_LIMITS.thumbnailWidth.ok(99)).toBe(false);
    expect(NUMBER_LIMITS.thumbnailWidth.ok(Number.NaN)).toBe(false);
  });

  it("says what a refused value should have been", () => {
    for (const limit of Object.values(NUMBER_LIMITS)) {
      expect(limit.message).toMatch(/^Enter .+\.$/);
    }
  });
});

describe("toolStatus", () => {
  it("says where a tool it found is", () => {
    expect(toolStatus("yt-dlp", "macos", "", "/opt/homebrew/bin/yt-dlp")).toEqual({
      found: true,
      text: "Found at /opt/homebrew/bin/yt-dlp.",
    });
  });

  it("treats a typed path that exists as the one in use", () => {
    expect(toolStatus("ffmpeg", "linux", " /srv/tools/ffmpeg ", "/srv/tools/ffmpeg")).toEqual({
      found: true,
      text: "Found at /srv/tools/ffmpeg.",
    });
  });

  it("says so when a typed path is wrong but the tool is elsewhere", () => {
    const status = toolStatus("yt-dlp", "macos", "/nowhere/yt-dlp", "/usr/local/bin/yt-dlp");
    expect(status.found).toBe(true);
    expect(status.text).toBe("Nothing at /nowhere/yt-dlp, so Goko uses /usr/local/bin/yt-dlp.");
    expect(status.install).toBeUndefined();
  });

  it("says what is lost without a tool and how to get it, for each system", () => {
    const mac = toolStatus("yt-dlp", "macos", "", null);
    expect(mac.found).toBe(false);
    expect(mac.text).toMatch(/^Not found\. Without it, /);
    expect(mac.install).toBe("brew install yt-dlp");

    expect(toolStatus("yt-dlp", "windows", "", null).install).toBe("winget install yt-dlp.yt-dlp");
    expect(toolStatus("yt-dlp", "linux", "", null).install).toBe("sudo apt install yt-dlp");
    expect(toolStatus("ffmpeg", "macos", "", null).install).toBe("brew install ffmpeg");
    expect(toolStatus("ffmpeg", "windows", "", null).install).toBe("winget install Gyan.FFmpeg");
    expect(toolStatus("ffmpeg", "linux", "", null).install).toBe("sudo apt install ffmpeg");
  });

  it("names the typed path when neither it nor the usual places have the tool", () => {
    const status = toolStatus("ffmpeg", "windows", "D:\\tools\\ffmpeg.exe", null);
    expect(status.found).toBe(false);
    expect(status.text).toMatch(/^Not found at D:\\tools\\ffmpeg\.exe or in the usual places\. /);
  });

  it("keeps each tool's own consequence", () => {
    const ytdlp = toolStatus("yt-dlp", "macos", "", null).text;
    const ffmpeg = toolStatus("ffmpeg", "macos", "", null).text;
    expect(ytdlp).toContain("cover image");
    expect(ffmpeg).toContain("can't play");
    expect(ytdlp).not.toBe(ffmpeg);
  });
});
