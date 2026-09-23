import type { GokoSettings } from "./settings";
import { COPY, HEADINGS } from "./settings-copy";
import type { SharedClipTarget } from "./spaces";

/**
 * The note a new vault is handed on its first launch, and the one Open guide
 * brings back.
 *
 * At the root of the vault rather than in the clippings folder: anything in
 * there is a card on the wall, and a guide that turned up as the first
 * clipping would be the first thing to explain.
 */
export const GUIDE_PATH = "Goko — start here.md";

/** The settings the guide reads, so it names the folders this vault uses. */
export type GuideSettings = Pick<
  GokoSettings,
  "clippingsFolder" | "attachmentFolder" | "sharedClipTarget" | "homeGridName"
>;

/**
 * Whether this launch owes the vault the guide, from data.json as it was read,
 * before the defaults were laid over it.
 *
 * Nothing saved is a vault Goko has never run in. Saved settings with no
 * `guideShown` in them are a vault that ran a version from before the guide
 * existed, and someone already clipping does not need to be told how after an
 * update. Once this version has saved, the key is always there and says for
 * itself.
 */
export function guideOwed(saved: unknown): boolean {
  if (saved === null || typeof saved !== "object") return true;
  const data = saved as Record<string, unknown>;
  if ("guideShown" in data) return data.guideShown !== true;
  return Object.keys(data).length === 0;
}

export type GuideStep = "create" | "open" | "none";

/**
 * What a launch does about the guide. A note already at that path is opened
 * and never written over: it may be one the person has made notes in, or one
 * a sync brought from another device.
 */
export function guideStep(owed: boolean, noteExists: boolean): GuideStep {
  if (!owed) return "none";
  return noteExists ? "open" : "create";
}

function folder(path: string): string {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `\`${trimmed}\`` : "the root of the vault";
}

function sharedTarget(target: SharedClipTarget, home: string): string {
  switch (target) {
    case "home":
      return `${home}, the home grid`;
    case "ask":
      return "whichever grid you pick each time";
    default:
      return "the grid you last had open";
  }
}

/**
 * The banner the README opens with, line for line. The O is an eye, which is
 * what the name means.
 */
export const GUIDE_BANNER = [
  " ██████     ██████    ██   ██   ██████",
  "██        ██  ██  ██  ██  ██   ██    ██",
  "██  ███  ██  ████  ██ █████    ██    ██",
  "██   ██   ██  ██  ██  ██  ██   ██    ██",
  " ██████     ██████    ██   ██   ██████",
];

/**
 * The guide itself, as markdown.
 *
 * Folder names and the shared-clip target come from the settings as they are
 * when the note is written, so it describes this vault rather than the
 * defaults. It is a note, not a live view: change a folder afterwards and the
 * note says what it said, until it is deleted and Open guide writes it again.
 *
 * Anything it tells you to press or change is named exactly as it is
 * labelled, so what the note says is what the eye finds on screen.
 */
export function guideMarkdown(settings: GuideSettings): string {
  // No heading of its own: Obsidian already shows the file's name as the
  // note's title, and a second one under it reads as a mistake. The banner
  // is a code block because nothing else keeps its columns lined up.
  return [
    "```",
    ...GUIDE_BANNER,
    "```",
    "",
    "Goko is a wall for everything you clip from the web. The pictures and video come along too, saved into this vault, so they are still here long after the page is gone.",
    "",
    "👀 *Goko* is *око*, “eye”, in a Ukrainian dialect. Hence the O.",
    "",
    "Open the wall from the Goko icon in the ribbon, or run **Open the wall** from the command palette.",
    "",
    "---",
    "",
    "## 🖥️ Clip on a desktop",
    "",
    "- **Paste** a link anywhere on the wall.",
    "- **Drop** a link, a picture, a video or a PDF onto it.",
    "- Or **copy** one, then press **+** at the foot of the wall and choose **Clip**. It takes whatever is on the clipboard.",
    "",
    "## 📱 Clip from a phone",
    "",
    "Goko takes links at `obsidian://goko?url=`. Set up an iOS Shortcut once:",
    "",
    "1. Turn on **Show in Share Sheet** and let it receive URLs.",
    "2. Add **Get URLs from Input**.",
    "3. Add **URL Encode** on the result.",
    "4. Add **Open URLs** with `obsidian://goko?url=` followed by the encoded text.",
    "",
    "Now share from any app and pick the shortcut. A caption around the link is fine.",
    "",
    `Links you share this way go to ${sharedTarget(settings.sharedClipTarget, settings.homeGridName)}. **${COPY.sharedClipTarget.name}** in Goko's settings changes that.`,
    "",
    "## 🗂️ Where the files go",
    "",
    `- Notes go to ${folder(settings.clippingsFolder)}.`,
    `- Pictures and video go to ${folder(settings.attachmentFolder)}.`,
    "",
    `Both are yours to choose: **${COPY.clippingsFolder.name}** and **${COPY.attachmentFolder.name}** in Goko's settings.`,
    "",
    "## 🎬 Video from Instagram, X and YouTube",
    "",
    "Out of the box, a clip keeps the video's poster. Give Goko two free tools on a desktop and it keeps the video itself.",
    "",
    "> [!tip] yt-dlp and ffmpeg",
    `> The quickest way is **${COPY.installTools.button}** under **${HEADINGS.tools}** in Goko's settings, which runs Homebrew on a Mac or winget on Windows for you. In a terminal instead:`,
    "> - macOS: `brew install yt-dlp ffmpeg`",
    "> - Windows: `winget install yt-dlp.yt-dlp` and `winget install Gyan.FFmpeg`",
    "> - Linux: `sudo apt install yt-dlp ffmpeg`",
    ">",
    `> Goko looks for them on its own; if yours live somewhere unusual, point **${COPY.ytdlpPath.name}** and **${COPY.ffmpegPath.name}** in Goko's settings at them.`,
    "",
    "## 🧭 Finding your way",
    "",
    "- **Grids** are boards. The rail down the left lists them; make one from **+** → **New grid**.",
    "- **Folders** are piles inside a grid. Make one from **+** → **New folder**, then drag cards onto its row in the rail to file them.",
    "- **Filters** narrow the wall by a property: the funnel at the foot of the wall.",
    `- **Domain rules** give every clip from a site the same properties, such as \`example.com categories: design\`. Write them under **${COPY.domainRules.name}** in Goko's settings.`,
    "",
    "> [!note] Privacy",
    `> Goko only talks to the sites you clip, and to \`api.fxtwitter.com\` for video on X. You can turn that off with **${COPY.useResolvers.name}** in Goko's settings.`,
    "",
    "---",
    "",
    `You can delete this note — **${COPY.openGuide.button}** brings it back. It is in the command palette, in Goko's settings under **${HEADINGS.help}**, and on the wall whenever the wall is empty.`,
    "",
  ].join("\n");
}
