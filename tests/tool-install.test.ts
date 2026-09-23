import { describe, expect, it } from "vitest";
import { installPlan, toolList } from "../src/core/tool-install";

const BREW = "/opt/homebrew/bin/brew";
const WINGET = "C:\\Users\\sam\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe";

describe("installPlan", () => {
  it("installs both with one Homebrew run on a Mac", () => {
    expect(installPlan("macos", ["ffmpeg", "yt-dlp"], { brew: BREW, winget: null })).toEqual({
      manager: "Homebrew",
      command: BREW,
      steps: [{ args: ["install", "yt-dlp", "ffmpeg"] }],
      tools: ["yt-dlp", "ffmpeg"],
    });
  });

  it("installs only what is missing", () => {
    const plan = installPlan("macos", ["ffmpeg"], { brew: BREW, winget: null });
    expect(plan?.steps).toEqual([{ args: ["install", "ffmpeg"] }]);
    expect(plan?.tools).toEqual(["ffmpeg"]);
  });

  it("runs winget once per tool on Windows, without a prompt", () => {
    const plan = installPlan("windows", ["yt-dlp", "ffmpeg"], { brew: null, winget: WINGET });
    expect(plan?.manager).toBe("winget");
    expect(plan?.command).toBe(WINGET);
    expect(plan?.steps.map((step) => step.args[2])).toEqual(["yt-dlp.yt-dlp", "Gyan.FFmpeg"]);
    for (const step of plan?.steps ?? []) {
      expect(step.args).toEqual(
        expect.arrayContaining(["--exact", "--silent", "--accept-source-agreements", "--accept-package-agreements"])
      );
    }
  });

  it("offers nothing when nothing is missing", () => {
    expect(installPlan("macos", [], { brew: BREW, winget: null })).toBeNull();
  });

  it("offers nothing without the system's own package manager", () => {
    expect(installPlan("macos", ["yt-dlp"], { brew: null, winget: WINGET })).toBeNull();
    expect(installPlan("windows", ["yt-dlp"], { brew: BREW, winget: null })).toBeNull();
  });

  it("leaves Linux to the terminal, where installing asks for a password", () => {
    expect(installPlan("linux", ["yt-dlp", "ffmpeg"], { brew: BREW, winget: WINGET })).toBeNull();
  });
});

describe("toolList", () => {
  it("reads as a sentence", () => {
    expect(toolList(["yt-dlp"])).toBe("yt-dlp");
    expect(toolList(["yt-dlp", "ffmpeg"])).toBe("yt-dlp and ffmpeg");
  });
});
