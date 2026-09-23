/**
 * Every word the settings tab shows, and the one piece of logic behind its
 * words: what the video tools' status line says.
 *
 * Kept apart from the tab so the house style can be tested rather than
 * remembered. A name is short, in sentence case, and says what the setting
 * is or does, with any unit in brackets. A description is one or two
 * sentences, at most DESC_LIMIT characters. What a switch does on and off,
 * or what each choice of a dropdown does, is not folded into it: each gets
 * a labelled line of its own, so the difference can be read at a glance.
 * No text names a hotkey or a command: every action it could point at is a
 * row of its own on the same page.
 */

import type { ArrivalMode } from "./arrivals";

export const DESC_LIMIT = 140;

/** How long one labelled line may run. */
export const LINE_LIMIT = 110;

/** One labelled line of a description: a state or a choice, and what it does. */
export interface DescLine {
  label: string;
  text: string;
}

export interface SettingCopy {
  name: string;
  /** What the setting is or does, said before any labelled lines. */
  desc?: string;
  /**
   * What each state of a switch, or each choice of a dropdown, does, one to
   * a line. Kept apart from the sentence above so the difference between
   * them reads at a glance, and so what a setting does and what it costs are
   * never folded into one sentence.
   */
  lines?: readonly DescLine[];
  /** Other words a person would search the settings for. */
  aliases: string[];
  /**
   * What the button at the end of the row says, for a row that does
   * something rather than holds a value. A short verb, because the name
   * beside it already says what the button acts on.
   */
  button?: string;
}

/** Group headings, in the order the tab shows them. */
export const HEADINGS = {
  clippings: "Clippings",
  wall: "Wall",
  downloads: "Downloads",
  tools: "Video tools",
  properties: "Properties",
  rules: "Domain rules",
  ai: "AI descriptions",
  help: "Help",
} as const;

/** How the choices for clippings from other devices read in the dropdown. */
export const ARRIVAL_LABELS: Record<ArrivalMode, string> = {
  describe: "Describe automatically",
  notify: "Notify me",
  off: "Don't describe",
};

/** How the choices for where grid settings apply read in the dropdown. */
export const SCOPE_LABELS = {
  all: "All grids",
  grid: "Per grid",
} as const;

const copy = <T extends Record<string, SettingCopy>>(entries: T): T => entries;

/** A switch's two states, in the order the switch goes. */
const onOff = (on: string, off: string): DescLine[] => [
  { label: "When on", text: on },
  { label: "When off", text: off },
];

export const COPY = copy({
  // Clippings
  clippingsFolder: {
    name: "Clippings folder",
    desc: "Every note in this folder is a clipping on the wall.",
    aliases: ["location", "notes", "web clipper", "path"],
  },
  attachmentFolder: {
    name: "Attachment folder",
    desc: "Downloaded pictures and videos are saved here.",
    aliases: ["media", "images", "attachments", "downloads location"],
  },
  sharedClipTarget: {
    name: "Shared links go to",
    desc: "The grid that gets links you share from other apps. Clipping on the wall always adds to the grid you're on.",
    aliases: ["share", "share sheet", "phone", "inbox", "clip"],
  },
  watchClippings: {
    name: "Add new clippings automatically",
    lines: onOff(
      "New notes in the clippings folder appear on the wall as soon as they're saved.",
      "New notes appear after a restart or a rescan."
    ),
    aliases: ["watch", "live", "refresh", "sync"],
  },
  rescan: {
    name: "Rescan clippings folder",
    desc: "Reads the whole folder again. Use it when a clipping is missing from the wall.",
    aliases: ["refresh", "reload", "reindex", "missing"],
    button: "Rescan",
  },

  // Wall
  autoplayVideo: {
    name: "Autoplay videos",
    lines: onOff(
      "Videos play while they're visible on screen. A full wall may use more memory.",
      "Videos play only while you hover over them."
    ),
    aliases: ["video", "play", "motion", "memory"],
  },
  tileTitle: {
    name: "Title on hover",
    lines: onOff(
      "The clipping's title appears along the bottom of its tile when you hover over it.",
      "Only the tags are shown."
    ),
    aliases: ["name", "caption", "label", "card"],
  },
  tileProperty: {
    name: "Tile tags",
    desc: "The property a tile shows as tags when you hover over it. After three tags, the rest show as a count.",
    aliases: ["card tags", "badges", "pills", "labels", "hover"],
  },
  gridsFollowFolders: {
    name: "Grids follow folders",
    lines: onOff(
      "Each folder inside the clippings folder is a grid. Moving a card to another grid moves its note.",
      "Grids exist only in Goko. Moving a card doesn't move its note."
    ),
    aliases: ["folders", "structure", "mirror", "subfolders", "file explorer"],
  },
  migrate: {
    name: "Move clippings into grid folders",
    desc: 'Moves each clipping\'s note into its grid\'s folder. Turning on "Grids follow folders" doesn\'t do this by itself.',
    aliases: ["migrate", "organize", "sort", "move notes"],
    button: "Move",
  },
  gridLookScope: {
    name: "Grid settings apply to",
    lines: [
      { label: SCOPE_LABELS.all, text: "Every wall uses the settings on this page." },
      {
        label: SCOPE_LABELS.grid,
        text: 'Each grid can set its own tile size, tile tags, filters and autoplay in "Grid settings" on its wall.',
      },
    ],
    aliases: ["per grid", "scope", "shared", "look", "all grids"],
  },

  // Downloads
  archiveOnCreate: {
    name: "Download media automatically",
    desc: "Clipping in Goko always saves its pictures and videos. This is for notes from the Web Clipper or another device.",
    lines: onOff(
      "Their media is saved too, and anything missing is fetched each time Obsidian starts.",
      'Their pictures load from the web. To save them, pick "Download all clipping media" in Search.'
    ),
    aliases: ["archive", "offline", "save media", "copy", "web clipper"],
  },
  maxSizeMb: {
    name: "Maximum file size (MB)",
    desc: "Pictures and videos larger than this aren't downloaded.",
    aliases: ["size", "limit", "megabytes", "cap"],
  },
  youtubeVideoMinutes: {
    name: "Download YouTube videos up to (minutes)",
    desc: "Longer videos keep their cover and a link to YouTube. Shorts are always downloaded. Enter 0 for no other videos. Needs yt-dlp.",
    aliases: ["video length", "duration", "shorts"],
  },
  useResolvers: {
    name: "Use community media resolvers",
    desc: "X doesn't give out a post's video, so Goko asks api.fxtwitter.com, a community service. It gets only the post's handle and ID.",
    lines: onOff(
      "Videos in posts from X are downloaded.",
      "Posts from X keep their preview image. Instagram is always read from Instagram itself."
    ),
    aliases: ["fxtwitter", "twitter", "x.com", "instagram", "privacy", "mirror"],
  },

  // Video tools
  ytdlpPath: {
    name: "Path to yt-dlp",
    desc: "Downloads the videos in posts. Leave empty to look in the usual places.",
    aliases: ["ytdlp", "youtube-dl", "video download", "binary"],
  },
  ffmpegPath: {
    name: "Path to ffmpeg",
    desc: "Makes previews for videos Obsidian can't play, and joins a video to its sound. Leave empty to look in the usual places.",
    aliases: ["video", "preview", "convert", "binary"],
  },
  installTools: {
    name: "Install missing tools",
    desc: "Installs what is missing of the two with Homebrew on a Mac or winget on Windows. It can take a few minutes.",
    aliases: ["homebrew", "brew", "winget", "setup", "download tools"],
    button: "Install",
  },
  toolsElsewhere: {
    name: "Not on this device",
    desc: "Phones and tablets can't run yt-dlp or ffmpeg. A computer that has them downloads the videos, and syncing the vault brings them here.",
    aliases: ["yt-dlp", "ffmpeg", "phone", "mobile", "video"],
  },
  thumbnailWidth: {
    name: "Preview width (px)",
    desc: "The width of stills made from videos and GIFs. Wider is sharper but takes more space.",
    aliases: ["thumbnail", "still", "resolution", "gif"],
  },

  // Properties
  allowEditingTags: {
    name: "Let Goko edit tags",
    desc: "The Web Clipper writes tags, so Goko leaves them alone unless you allow it. Title, source, author, dates and description are never edited.",
    lines: onOff(
      "You can add and remove tags in the details panel and the property menus.",
      "Tags can be read and filtered by, but not changed."
    ),
    aliases: ["tags", "web clipper", "frontmatter", "read-only"],
  },
  filterProperties: {
    name: "Filter properties",
    desc: "The properties the filter menu offers, besides media type and source.",
    aliases: ["facets", "filter menu", "smart views"],
  },
  cardProperties: {
    name: "Card properties",
    desc: "The properties the details panel lists under the title and source. Summary and note always show.",
    aliases: ["details panel", "inspector", "fields"],
  },
  addProperty: {
    name: "Add a property",
    desc: "Suggestions come from your clippings. Any name works.",
    aliases: ["new property"],
  },

  // Domain rules
  domainRules: {
    name: "Properties by domain",
    desc: "Gives every clipping from a site the same properties. Rules run as each clipping is saved, and only ever add values.",
    lines: [
      { label: "Format", text: "One site per line: the domain, then its properties." },
      { label: "Subdomains", text: "*.example.com also covers example.com and blog.example.com." },
    ],
    aliases: ["rules", "site", "auto tag", "automatic", "category"],
  },
  applyRules: {
    name: "Apply to all clippings",
    desc: "Runs the rules above on every clipping you already have.",
    aliases: ["apply rules", "run rules", "domain rules", "update"],
    button: "Apply",
  },

  // AI descriptions
  provider: {
    name: "Provider",
    desc: "Who describes your clippings, with your own API key and account. Nothing is sent until a clipping is described.",
    aliases: ["ai", "vision", "openai", "anthropic", "claude", "gpt", "cli"],
  },
  providerCli: {
    name: "Provider",
    desc: "Claude Code on this computer describes your clippings, signed in as you. There's no API key; it uses your Claude subscription.",
    aliases: ["ai", "vision", "openai", "anthropic", "claude", "gpt", "cli"],
  },
  apiKey: {
    name: "API key",
    desc: "Kept in Obsidian's keychain on this device. It isn't saved in the vault, so it doesn't sync or end up in backups.",
    aliases: ["token", "secret", "password"],
  },
  model: {
    name: "Model",
    desc: "Any of your provider's models that can read images. A small one is enough for a summary and a few tags.",
    aliases: ["gpt", "claude", "vision model"],
  },
  cliModel: {
    name: "Model",
    desc: "Each name means its latest version.",
    lines: [
      { label: "Sonnet", text: "Enough for a summary and a few tags." },
      { label: "Haiku", text: "Faster, and uses less of your subscription." },
      { label: "Custom", text: "Enter a full model ID." },
    ],
    aliases: ["sonnet", "haiku", "opus", "claude"],
  },
  cliModelId: {
    name: "Model ID",
    desc: "The full ID of the model Claude Code should use.",
    aliases: ["custom model", "claude"],
  },
  effort: {
    name: "Effort",
    desc: "How hard Claude Code thinks about each clipping. Low is enough for most, and uses the least of your subscription.",
    aliases: ["thinking", "reasoning", "quality"],
  },
  cliPath: {
    name: "Path to claude",
    desc: "Where the claude program is. Leave empty to look in the usual places.",
    aliases: ["claude code", "binary", "executable"],
  },
  tagProperty: {
    name: "Write tags to",
    desc: 'The property the AI\'s tags go into. To write to tags itself, turn on "Let Goko edit tags" first.',
    aliases: ["tag property", "categories"],
  },
  autoDescribe: {
    name: "Describe new clippings automatically",
    lines: onOff(
      "Each clipping is described as it's saved. Each one is a paid request.",
      'Clippings are described only when you press "Describe with AI".'
    ),
    aliases: ["auto", "automatic", "summary"],
  },
  autoDescribeCli: {
    name: "Describe new clippings automatically",
    lines: onOff(
      "Each clipping is described as it's saved. Each one uses your Claude subscription.",
      'Clippings are described only when you press "Describe with AI".'
    ),
    aliases: ["auto", "automatic", "summary"],
  },
  arrivals: {
    name: "Clippings from other devices",
    desc: "For clippings that arrived from your phone or another computer while this one was closed.",
    lines: [
      { label: ARRIVAL_LABELS.describe, text: "They're described as soon as you open Obsidian. Each one is a paid request." },
      { label: ARRIVAL_LABELS.notify, text: "The bell on the wall says how many arrived, and you decide." },
      { label: ARRIVAL_LABELS.off, text: "They stay without a description until you describe them." },
    ],
    aliases: ["phone", "sync", "other computer", "away", "notifications", "bell"],
  },
  arrivalsCli: {
    name: "Clippings from other devices",
    desc: "For clippings that arrived from your phone or another computer while this one was closed.",
    lines: [
      {
        label: ARRIVAL_LABELS.describe,
        text: "They're described as soon as you open Obsidian, using your Claude subscription.",
      },
      { label: ARRIVAL_LABELS.notify, text: "The bell on the wall says how many arrived, and you decide." },
      { label: ARRIVAL_LABELS.off, text: "They stay without a description until you describe them." },
    ],
    aliases: ["phone", "sync", "other computer", "away", "notifications", "bell"],
  },

  // Help
  openGuide: {
    name: "Guide",
    desc: "A short note on clipping, grids and where the files go. It's written again if you deleted it.",
    aliases: ["open guide", "help", "start here", "onboarding", "tutorial"],
    button: "Open guide",
  },
  privacy: {
    name: "Privacy",
    desc: "Goko connects only to the sites you clip, the X service under Downloads, and an AI provider if you set one up. No analytics.",
    aliases: ["data", "tracking", "telemetry", "network"],
  },
});

/** Every sentence a row's description says, the lines as they read on screen. */
export function descParts(entry: SettingCopy): string[] {
  const parts = entry.desc ? [entry.desc] : [];
  for (const line of entry.lines ?? []) parts.push(`${line.label}: ${line.text}`);
  return parts;
}

/**
 * Shown in the rules box while it is empty: an example, not rules. Every line
 * writes `categories`, the one field the tile tags, the filter menu and the
 * card panel all read, so the example teaches a rule whose result shows up.
 * A second value is a second `categories:`, which is how the syntax adds one.
 */
export const RULES_PLACEHOLDER = [
  "# One site per line: a domain, then the properties it adds",
  "dribbble.com      categories: inspiration",
  "*.behance.net     categories: portfolio, categories: branding",
  "github.com        categories: code",
].join("\n");

/** What an empty list of properties says instead. */
export const PROPERTY_LIST_EMPTY = {
  filter: "None. The menu still offers media type and source.",
  card: "None. The details panel shows the title, source, summary and your note.",
} as const;

/**
 * The number fields' limits, with what the field says when a value breaks
 * one. The settings tab refuses to save such a value and shows the message
 * under the field, so the two can never disagree about what is allowed.
 */
export const NUMBER_LIMITS = {
  maxSizeMb: { ok: (n: number) => Number.isFinite(n) && n > 0, message: "Enter a size above 0." },
  youtubeVideoMinutes: {
    ok: (n: number) => Number.isFinite(n) && n >= 0,
    message: "Enter 0 or more minutes.",
  },
  thumbnailWidth: { ok: (n: number) => Number.isFinite(n) && n >= 100, message: "Enter 100 or more." },
} as const;

export type VideoTool = "yt-dlp" | "ffmpeg";
export type DesktopOs = "macos" | "windows" | "linux";

/** One line each, for the package manager a person on that system most likely has. */
const INSTALL: Record<VideoTool, Record<DesktopOs, string>> = {
  "yt-dlp": {
    macos: "brew install yt-dlp",
    windows: "winget install yt-dlp.yt-dlp",
    linux: "sudo apt install yt-dlp",
  },
  ffmpeg: {
    macos: "brew install ffmpeg",
    windows: "winget install Gyan.FFmpeg",
    linux: "sudo apt install ffmpeg",
  },
};

const WITHOUT: Record<VideoTool, string> = {
  "yt-dlp": "Without it, videos from YouTube, TikTok, Vimeo and Reddit stay a cover image.",
  ffmpeg: "Without it, videos Obsidian can't play get no picture, and posts with separate sound aren't downloaded.",
};

/** Put before the install command on a missing tool's status line. */
export const INSTALL_LABEL = "To install:";

export interface ToolStatus {
  found: boolean;
  /** What the status line says. */
  text: string;
  /** The command that installs it, when it is missing. */
  install?: string;
}

/**
 * What the status line under a tool's path says.
 *
 * `found` is where the tool was actually resolved, which is not always the
 * path typed into the field: a typed path that does not exist falls through
 * to the usual places, and a status that said "found" without saying where
 * would hide that the field is wrong. So a mismatch is spelled out.
 */
export function toolStatus(
  tool: VideoTool,
  os: DesktopOs,
  override: string,
  found: string | null
): ToolStatus {
  const typed = override.trim();
  if (found) {
    if (typed && found !== typed) {
      return { found: true, text: `Nothing at ${typed}, so Goko uses ${found}.` };
    }
    return { found: true, text: `Found at ${found}.` };
  }
  const where = typed ? `Not found at ${typed} or in the usual places.` : "Not found.";
  return { found: false, text: `${where} ${WITHOUT[tool]}`, install: INSTALL[tool][os] };
}
