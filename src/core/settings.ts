import type { DensityStage } from "./density";
import type { GridLook, LookScope } from "./look";
import type { FolderSpace } from "./folders";
import type { GridSpace, SharedClipTarget } from "./spaces";
import { INSPECTOR_DEFAULT } from "./inspector";
import { SIDEBAR_DEFAULT } from "./sidebar";
import type { Effort, VisionProvider } from "./vision";
import { DEFAULT_CONCURRENCY, DEFAULT_EFFORT, DEFAULT_MODELS } from "./vision";
import type { ArrivalMode } from "./arrivals";
import { DEFAULT_ARRIVAL_MODE } from "./arrivals";

/** Where a picked card's details are shown; see GokoSettings.detailStyle. */
export type DetailStyle = "panel" | "sheet";

export interface GokoSettings {
  clippingsFolder: string;
  attachmentFolder: string;
  /**
   * Whether the background pass downloads: the media of notes that arrive
   * from outside Goko, and at each launch whatever is still missing. Off,
   * that pass only makes previews of files already in the vault. A clip
   * made in Goko downloads as it is made either way.
   */
  archiveOnCreate: boolean;
  /** Add new files in the clippings folder to the wall as they appear. */
  watchClippings: boolean;
  autoplayVideo: boolean;
  maxBytes: number;
  /**
   * The longest ordinary YouTube video to download, in minutes; 0 downloads
   * none, which is the default. Such a video is otherwise kept as its cover
   * and a link back to YouTube: a copy of a music video at a size that fits
   * the attachment cap is not what saving the link was for. Shorts are
   * downloaded whatever this says.
   */
  youtubeVideoMinutes: number;
  thumbnailWidth: number;
  /**
   * Allow one community mirror, fxtwitter, to resolve the video address X
   * publishes to nothing but its own player. Sends that post's handle and id
   * to a service run by neither X nor us, which is why it is a setting and
   * not a detail. With this off, posts from X fall back to whatever poster
   * image the site gives its own crawlers. Instagram does not go through
   * this: its own embed carries the media.
   */
  useResolvers: boolean;

  /**
   * Frontmatter keys offered as filter facets, in the order they appear in the
   * menu. The default reproduces the four-facet menu this replaced.
   */
  filterProperties: string[];
  /**
   * Frontmatter keys the card's details panel lists, in order. Separate from
   * the filter list on purpose: a property worth narrowing the wall by
   * (status, the clipper's tags) is not always one worth reading on every
   * card. Summary and the reader's note are always shown and are not here.
   */
  cardProperties: string[];

  /**
   * The property a hovered tile draws its tags from; "" for none. See
   * badges.ts.
   */
  tileProperty: string;
  /**
   * The clipping's title along the bottom on hover, over a fade. An option
   * rather than a rule, and on by default: the badges above it say what the
   * clipping is tagged with, but a wall of pictures with no names on hover
   * was the first thing missed.
   */
  tileTitle: boolean;

  /**
   * Domain rules, as the text the settings pane shows: one rule per line, a
   * host pattern then the properties it adds. See core/rules.ts. Kept as text
   * so it can be edited in one box and cannot be half-saved.
   */
  domainRules: string;

  /**
   * The vision model that writes `summary` and tags. The key is a device's
   * own: a secret that syncs through the vault is a secret in every backup of
   * the vault, and these settings are a file in the vault's plugin folder.
   * So they hold only the name of a secret in Obsidian's keychain, which
   * stays on the device, and the key is read from there when it is needed.
   */
  aiProvider: VisionProvider;
  aiKeySecret: string;
  aiModel: string;
  /** Which property the model's tags go to. `tags` needs allowEditingTags. */
  aiTagProperty: string;
  /** Describe each clipping as it lands. Off by default: it costs money, or quota. */
  aiAutoDescribe: boolean;
  /**
   * What the start of a session does with clippings that arrived while this
   * computer was closed and have no summary: describe them, offer to behind
   * the wall's bell, or leave them. A device's own, like the toggle above: it is this computer's
   * provider that would be spent. See arrivals.ts.
   */
  aiArrivals: ArrivalMode;
  /**
   * Claude Code as the provider: where the program is ("" to find it), and
   * how hard it thinks. Both a device's own, like the key: the program lives
   * on this disk, and another device may not have it at all.
   */
  aiCliPath: string;
  aiEffort: Effort;
  /**
   * How many clippings are described at the same time, 1 to 10. Each is its
   * own request, or its own Claude Code run. A device's own: it is about how
   * much this machine and this subscription can take at once.
   */
  aiConcurrency: number;

  /**
   * Let the plugin write `tags`, which the Web Clipper owns by convention.
   * Off by default: a vault that treats the clipper's frontmatter as a
   * contract keeps that contract until it says otherwise.
   */
  allowEditingTags: boolean;

  /**
   * Grids the user created, in the order they appear in the rail, which is
   * also the order their hotkeys run in. Home is not stored here: it always
   * exists and is always first.
   */
  grids: GridSpace[];
  /** The folders on every grid, shared with the grids. See folders.ts. */
  folders: FolderSpace[];
  /**
   * Let the vault's folder tree be the grids: `Clippings/Payments` is the
   * Payments grid, `Clippings/Payments/Checkout` a folder on it, and the
   * clippings folder itself is home. Moving a card moves the file, and
   * moving the file moves the card.
   *
   * Off by default, which is the other model: a `grid:` key in frontmatter
   * and every note in one folder. Nothing migrates on its own — the command
   * does that, and the key keeps working while this is off.
   */
  gridsFollowFolders: boolean;
  /** Display name of the implicit grid. A clipping with no key belongs to it. */
  homeGridName: string;
  homeGridIcon: string;
  /** Name of the grid on screen, persisted so a restart reopens where you were. */
  activeGrid: string;
  /**
   * Where a clip arriving through the obsidian://goko URI is filed: the
   * share sheet on a phone, a terminal on a desktop. In-app clips always go
   * to the open grid; this exists because on a phone the open grid is
   * whatever was left up hours ago.
   */
  sharedClipTarget: SharedClipTarget;
  /**
   * How densely the wall is packed, as a named stage (see density.ts). The
   * shared answer, used by every grid while `gridLookScope` is "all" and by
   * any grid that has not set its own while it is "grid".
   */
  tileSize: DensityStage;
  /**
   * The size cards are while the inbox is grouped by suggestion.
   *
   * Not one of the five above, and deliberately not a per-grid override: it
   * answers a different question. A grid's look says what this wall is; this
   * says how you are looking at it. The grouped inbox is judged by the shape
   * of its islands, which means seeing all of them at once, so it packs down
   * whatever size the wall itself is set to.
   */
  groupedTileSize: DensityStage;
  /**
   * The rail of grids down the left of the wall: how wide, and whether it is
   * showing at all. A device's own, like the tile size: it is about how much
   * room this pane has, not about the vault.
   */
  sidebarWidth: number;
  sidebarHidden: boolean;
  /**
   * The panel down the right of the wall: how wide, and whether it is
   * showing at all. A device's own, for the reason the rail's are.
   */
  inspectorWidth: number;
  inspectorHidden: boolean;
  /**
   * How a picked card is shown on a desktop: described in the panel down the
   * right, opened full screen from its Open, or opened at once by the click
   * in a sheet that slides up over the wall. A device's own, like the panel.
   */
  detailStyle: DetailStyle;
  /** Whether the inbox is laid out in islands by suggested destination. */
  inboxGrouped: boolean;

  /**
   * Whether the four look settings answer once for every grid, or once per
   * grid. See look.ts, which owns what "the four" are and how a grid's own
   * value falls back to the shared one.
   */
  gridLookScope: LookScope;
  /** Home's own look. Home is not in `grids`, so it keeps its slot here,
      beside the name and icon it already keeps here for the same reason. */
  homeGridLook?: GridLook;
  /**
   * Per-grid tile size, by grid key ("" for home). Apart from the rest of a
   * grid's look and out of SharedConfig on purpose: a stage is a target
   * column width in pixels, so a grid set to Huge on a desktop would arrive
   * on a phone as one column per row. Keyed by name because it is not stored
   * with the grid, which is why renameGridDef has to move its key.
   */
  gridTileSizes: Record<string, DensityStage>;
  /**
   * The shared configuration this device last held, with its lineage, kept
   * in the device's own settings where the shared file cannot take it away.
   * It is what a launch starts from, so a file written while this device
   * was closed, by one that had never seen these grids, is folded into it
   * rather than replacing it; see descendsFrom. Read through parseShared,
   * so a copy edited into nonsense is simply no copy.
   */
  sharedBackup?: unknown;
  /** Full path to yt-dlp, "" to discover it on PATH and in common installs. */
  ytdlpPath: string;
  /** Full path to ffmpeg, "" to discover it on PATH and in common installs. */
  ffmpegPath: string;
  /**
   * Whether the start-here note has been handed to this vault. Written once,
   * on the first launch, so an update never hands it out again; see guide.ts
   * for how a vault from before the guide is told apart from a new one.
   */
  guideShown: boolean;
}

export const DEFAULT_SETTINGS: GokoSettings = {
  clippingsFolder: "Clippings",
  attachmentFolder: "Attachments/Clippings",
  archiveOnCreate: true,
  watchClippings: true,
  autoplayVideo: true,
  maxBytes: 26214400,
  youtubeVideoMinutes: 0,
  thumbnailWidth: 400,
  useResolvers: true,
  filterProperties: ["categories"],
  cardProperties: ["categories"],
  tileProperty: "categories",
  tileTitle: true,
  domainRules: "",
  aiProvider: "openai",
  aiKeySecret: "",
  aiModel: DEFAULT_MODELS.openai,
  aiTagProperty: "categories",
  aiAutoDescribe: false,
  aiArrivals: DEFAULT_ARRIVAL_MODE,
  aiCliPath: "",
  aiEffort: DEFAULT_EFFORT,
  aiConcurrency: DEFAULT_CONCURRENCY,
  allowEditingTags: false,
  grids: [],
  folders: [],
  gridsFollowFolders: false,
  homeGridName: "Inbox",
  homeGridIcon: "inbox",
  activeGrid: "Inbox",
  sharedClipTarget: "last-opened",
  tileSize: "m",
  groupedTileSize: "xs",
  sidebarWidth: SIDEBAR_DEFAULT,
  sidebarHidden: false,
  inspectorWidth: INSPECTOR_DEFAULT,
  inspectorHidden: false,
  detailStyle: "panel",
  inboxGrouped: false,
  gridLookScope: "all",
  gridTileSizes: {},
  ytdlpPath: "",
  ffmpegPath: "",
  guideShown: false,
};

/**
 * The keychain entry a key typed into an earlier version is moved to. Earlier
 * versions kept the key itself in these settings; see aiKeySecret.
 */
export const LEGACY_KEY_SECRET = "goko-api-key";
