import type { DesktopOs, VideoTool } from "./settings-copy";

/**
 * How the Install button in Video tools gets the missing tools onto this
 * computer, if it can.
 *
 * Only through the package manager a person on that system most likely has,
 * run on their click and never on its own: Homebrew on a Mac, winget on
 * Windows. Linux is left to the terminal, because every distribution's
 * package manager wants a password for this, and a plugin has no business
 * asking for one. Where the manager is missing, or on Linux, there is no
 * button, and the status line's own install command is the way.
 */

export type PackageManager = "Homebrew" | "winget";

export interface InstallStep {
  /** Arguments to the manager, one run each. */
  args: string[];
}

export interface InstallPlan {
  manager: PackageManager;
  /** The manager's own executable, as found on this computer. */
  command: string;
  steps: InstallStep[];
  /** What is being installed, in the order the steps install it. */
  tools: VideoTool[];
}

/** Each tool's package, by manager. The ids match the status line's commands. */
const PACKAGES: Record<PackageManager, Record<VideoTool, string>> = {
  Homebrew: { "yt-dlp": "yt-dlp", ffmpeg: "ffmpeg" },
  winget: { "yt-dlp": "yt-dlp.yt-dlp", ffmpeg: "Gyan.FFmpeg" },
};

/**
 * The plan for installing what is missing, or null when nothing is missing
 * or there is no manager to run. Tools are always installed in the same
 * order, yt-dlp first, whatever order they were reported missing in.
 */
export function installPlan(
  os: DesktopOs,
  missing: readonly VideoTool[],
  managers: { brew: string | null; winget: string | null }
): InstallPlan | null {
  const tools = (["yt-dlp", "ffmpeg"] as const).filter((tool) => missing.includes(tool));
  if (tools.length === 0) return null;

  if (os === "macos" && managers.brew) {
    // One run for both: Homebrew resolves them together, and a second run
    // would only repeat its own update check.
    const packages = tools.map((tool) => PACKAGES.Homebrew[tool]);
    return { manager: "Homebrew", command: managers.brew, steps: [{ args: ["install", ...packages] }], tools };
  }

  if (os === "windows" && managers.winget) {
    // winget takes one package per run. The agreement flags are what lets it
    // run without a prompt nobody could answer from here; the person agreed
    // by pressing Install.
    const steps = tools.map((tool) => ({
      args: [
        "install",
        "--id",
        PACKAGES.winget[tool],
        "--exact",
        "--silent",
        "--accept-source-agreements",
        "--accept-package-agreements",
      ],
    }));
    return { manager: "winget", command: managers.winget, steps, tools };
  }

  return null;
}

/** The tools, as a person reads them in a sentence: "yt-dlp and ffmpeg". */
export function toolList(tools: readonly VideoTool[]): string {
  return tools.join(" and ");
}
