import { GOKO_ICON_ID } from "./core/icon";
import { EMPTY_WALL_EYES_PATH, EMPTY_WALL_EYES_VIEWBOX, emptyWallCopy } from "./core/empty-wall";
import { keyIs } from "./core/keys";
import {
  ItemView,
  Notice,
  Platform,
  TFile,
  WorkspaceLeaf,
  normalizePath,
  setIcon,
} from "obsidian";
import { absolutePath, droppedFilePath, vaultRoot } from "./convert";
import { exportFiles } from "./core/export-files";
import { copyToDownloads, revealInFinder, systemAvailable } from "./core/system";
import { ActionBar } from "./action-bar";
import { buildCommands, facetValueCommands } from "./core/commands";
import type { PaletteContext } from "./core/commands";
import { ConfirmDeleteModal } from "./confirm";
import { isDateToken, todayISO } from "./core/dates";
import { settled } from "./core/settle";
import { Sheet } from "./sheet";
import type { SheetRow } from "./sheet";
import { holdingAcross, isEditable, toggleAcross, withValue } from "./core/editable";
import type { EditablePolicy } from "./core/editable";
import { ContextMenu } from "./context-menu";
import {
  openDeleteGrid,
  openFolderEditor,
  openGridActions,
  openGridEditor,
  openGridsManager,
  openNewGrid,
  openNewSmartGrid,
  openRemoveFolders,
  openRemoveFolder,
} from "./grid-sheets";
import { DetailView } from "./detail";
import { Inspector } from "./inspector";
import { placesFor } from "./core/places";
import { classifyDrop, describeSkipped, titleForDropped, wantsDrop } from "./core/drop";
import { isCoverType } from "./core/cover-drop";
import { kindForMime } from "./core/formats";
import { pdfPathOf } from "./core/pdf";
import { previewNotice } from "./core/preview-route";
import type { MenuItem } from "./context-menu";
import type { FoldersController, GridsController } from "./grid-sheets";
import { FOLDER_WIDTHS, folderTileId, partitionWall, planFolderMove } from "./core/folders";
import { resolveLook } from "./core/look";
import { slotCandidates, surveyProperties } from "./core/facet-catalog";
import type { GridLook, ResolvedLook } from "./core/look";
import { History } from "./core/history";
import type { FolderSpace, FolderTileModel, FolderWidth } from "./core/folders";
import { GridRenderer } from "./grid";
import { groupedMenu } from "./core/layout";
import type GokoPlugin from "./main";
import { Palette } from "./palette";
import { resourceUrl } from "./convert";
import { PlaybackController } from "./core/playback";
import { isHttpUrl } from "./core/resolve";
import { ProgressBar } from "./core/progress";
import type { PropertyVocabulary } from "./core/filter";
import {
  activeCount,
  smartMembers,
  emptyFilter,
  facetDefs,
  facetLabel,
  facetsOf,
  heldFirst,
  isEmptyValue,
  isFilterEmpty,
  matchesFilter,
  propertyVocabulary,
  pruneFilter,
  toggleFacet,
  typedFacets,
  valueLabel,
  withHeldValues,
} from "./core/filter";
import type { FacetDef, FilterState } from "./core/filter";
import { PENDING_RETRY_MS, PendingSources } from "./core/pending";
import { SpaceBar } from "./space-bar";
import { Sidebar } from "./sidebar";
import { moveBeside, sidebarModel } from "./core/sidebar";
import type { RailDrop } from "./core/sidebar";
import { demotedFolder, demotionRefusal, insertBeside, promotedGrid, promotionRefusal } from "./core/regrid";
import type { NarrowTarget } from "./core/palette-query";
import { gridColorVar } from "./core/spaces";
import { STAGES, expandStage, shrinkStage, stageLabel } from "./core/density";
import type { DensityStage } from "./core/density";
import { describeFiles } from "./core/media-refs";
import { orphansAfterDeleting, removeMedia } from "./sweep";
import { pathInsideVault } from "./core/file-clip";
import {
  effectiveGrid,
  fileableGrid,
  filterByGrid,
  groupedGrids,
  hotkeyPosition,
  isSmartGrid,
  membersOf,
  orderedGrids,
} from "./core/spaces";
import type { GridSpace } from "./core/spaces";
import { buildTiles, previewOf, tilesForRecord } from "./core/tile";
import { shuffleRecords } from "./index-store";
import { byUpdated } from "./core/order";
import type { WallOrder } from "./core/order";
import { domainOf } from "./core/scan";
import type { ClippingRecord } from "./core/scan";
import { validatePathName } from "./core/placement";
import { RuleStrip } from "./rule-strip";
import type { MoveResult } from "./placement-service";
import {
  LATER_DAYS,
  REMIND_KEY,
  isSnoozed,
  laterDate,
  partitionSnoozed,
  remindOf,
} from "./core/remind";
import {
  STRONG,
  appendRule,
  folderProfile,
  gridProfile,
  learnableRule,
  proposeGrids,
  proposeNewGrid,
} from "./core/magnets";
import type { GridIdea, GridProfile } from "./core/magnets";
import { parseRules } from "./core/rules";
import type { Proposal } from "./core/magnets";
import type { IslandModel, IslandPocketModel, Suggestion } from "./grid";
import type { TileModel } from "./core/tile";

export const VIEW_TYPE_GRID = "goko";

/** Dash and gap for the drop frame, in pixels, before they are rounded to fit
    the perimeter. Small: the frame is the size of the pane, and dashes big
    enough to count read as a barber's pole rather than a border. */
const DASH = 5;
const GAP = 6;

/**
 * Most clippings the palette lists at once. A cap rather than a scroll to
 * the horizon: past a handful you are not reading the list any more, you are
 * typing more of the query, and leaving room below them is what keeps the
 * commands reachable without scrolling.
 */
/**
 * Where a `#tag` token looks. Both, because the vault has two: `categories`
 * is the library's own taxonomy and `tags` is what the Web Clipper writes,
 * and a person typing `#` means either.
 */
const TAG_PROPERTIES = ["categories", "tags"] as const;

const PALETTE_CLIPPINGS = 8;

/**
 * How long a just-clipped note stays worth flying to.
 *
 * The flight waits for the tile rather than firing on the spot, because a
 * fresh clipping often has no cover until the archiver resolves one. Some
 * never get a renderable cover at all, and without a deadline that clipping
 * would leave a reveal armed to go off on whatever unrelated repaint came
 * next, minutes later.
 */
const REVEAL_WINDOW_MS = 20000;
/** How long the pane has to hold still before the wall is laid out for it. */
const RESIZE_SETTLE_MS = 120;

export class GokoView extends ItemView {
  private grid: GridRenderer | null = null;
  private observer: ResizeObserver | null = null;
  private playback: PlaybackController | null = null;
  private progress: ProgressBar | null = null;
  private actionBar: ActionBar | null = null;
  private ruleStrip: RuleStrip | null = null;
  /** What a wall with nothing on it says, and its button to the guide. */
  private emptyWall: HTMLElement | null = null;
  /**
   * Where the grids say each inbox card belongs, worked out on every paint
   * of the inbox. A suggestion is a chip on the card and, grouped, an island
   * on the wall; both are agreed with by filing the card there, and nothing
   * is written until then.
   */
  private proposals = new Map<string, Proposal>();
  /** Suggestions you have waved away this session, by dropping the card on Undecided. */
  private dismissed = new Set<string>();
  /**
   * Where you have dragged a card in the grouped view, in place of what the
   * grids said. The islands are the plan and a drag edits the plan; nothing
   * is written until the island is accepted or the chip is tapped.
   */
  private overrides = new Map<string, { grid: string; folder: string }>();
  /** A grid the undecided pile is asking for, or null. Worked out with the proposals. */
  private gridIdea: GridIdea | null = null;
  /** Ideas already shown in the strip this session, so the flat inbox asks once. */
  private offeredIdeas = new Set<string>();
  /** Hosts already asked about this session, so one is never asked twice. */
  private askedRules = new Set<string>();
  /** Islands folded to their heading, by a click on it. */
  private folded = new Set<string>();
  /** Clippings waiting for a `remind` date, counted by the last paint. */
  private snoozedCount = 0;
  /** Whether the inbox is showing what it is holding back. */
  private showSnoozed = false;
  private menu: ContextMenu | null = null;
  private detail: DetailView | null = null;
  private spaceBar: SpaceBar | null = null;
  private sidebar: Sidebar | null = null;
  private inspector: Inspector | null = null;
  /**
   * The strip at the foot of the wall that holds both bars.
   *
   * One centred row rather than two bars placing themselves: the
   * selection bar arriving has to push the other one aside and leave the
   * pair centred, which neither of them can arrange alone.
   */
  private dock: HTMLElement | null = null;
  /** The title the header was last drawn with; see paintHeader. */
  private shownTitle = "";
  /**
   * Whether the wall is showing the whole library rather than one grid.
   *
   * Not a grid name in `activeGrid`: a sentinel there could collide with a
   * real folder, and this vault's clippings folder is called Library. A flag
   * beside it, per device, as the open grid already is — which of the two
   * you are looking at is a fact about this pane, not about the vault.
   *
   * On by default. A reference library is a thing you sweep your eye across,
   * and opening onto one board is opening onto a filing cabinet drawer: you
   * have to know what you are looking for before you can look. The library
   * shows everything there is, and every card says where it is filed, so the
   * boards are legible from it rather than instead of it.
   */
  private showAll = true;
  private palette: Palette | null = null;
  /** A clipping just made here, to fly to as soon as it has a tile. */
  private pendingReveal: { path: string; until: number } | null = null;
  private onGridKey: ((event: KeyboardEvent) => void) | null = null;
  private refreshFrame = 0;
  /** A refresh that arrived while a menu, sheet or selection was up. */
  private refreshHeld = false;
  /**
   * The narrowing on the grid now showing. Dropped on a switch and never
   * written to disk: a filter hides things, and one that outlives the grid it
   * was set on becomes a wall that looks emptier than it is for a reason
   * nobody remembers. Each grid opens whole.
   */
  private filter: FilterState = emptyFilter();
  /**
   * The folder open on the wall, or null for the grid whole. Session state
   * beside the filter: never saved, dropped on a grid switch.
   */
  private openFolder: string | null = null;
  /** The grid's folder tiles before filtering, beside `facets`. */
  private folderTiles: FolderTileModel[] = [];
  /**
   * Undo and redo for this wall's actions. Session state: an action from
   * an earlier session has nothing captured to restore.
   */
  private history = new History();
  /**
   * Shows or hides the wall's own drop frame. Built by installDropTarget,
   * which owns the dashes and the counting; a field rather than a local so a
   * card that has taken a drop as its cover can take the frame down.
   */
  private showDropFrame: (on: boolean) => void = () => {};
  /**
   * Stands the frame aside while the pointer is on a card's cover band, and
   * back up when it leaves. The frame promises a new clipping, and a drop on
   * the band would not be one.
   */
  private aimDropAtCover: (aimed: boolean) => void = () => {};
  /**
   * Covers that failed to load, keyed by note path and remembered by
   * signature. Recording the signature is what lets a clipping return once
   * archiving gives it a different, working cover.
   */
  private unloadable = new Map<string, string>();
  /**
   * How the wall is ordered: by date, or shuffled under a seed. Not persisted.
   * A shuffle is for coming across something forgotten, and a wall that came
   * back shuffled after a restart would just be a wall in the wrong order.
   */
  private order: WallOrder = "newest";
  private shuffleSeed = 1;
  /**
   * Covers waiting on a file the vault has not registered yet, kept apart
   * from `unloadable` because they are not failures: an attachment written a
   * moment ago resolves to nothing for a beat and then resolves fine.
   */
  private pending = new PendingSources();
  private sheet: Sheet | null = null;
  /**
   * Values set from the open menu, before the vault has confirmed them.
   *
   * The tick has to land on the click that caused it, and a write is a disk
   * round trip and a metadata event away. The menu therefore reads this first
   * and the note second. Dropped when a menu opens, and on a failed write, so
   * it can never disagree with the vault for longer than one menu.
   */
  private edited = new Map<string, string[]>();
  /**
   * One property's values, frozen for the life of an open menu.
   *
   * Recounting on every tick reordered the rows under the pointer, because
   * the list is ordered by how many clippings carry each value and ticking
   * one changes that. What a menu offers should not move while you are using
   * it.
   */
  private vocabularies = new Map<string, PropertyVocabulary>();

  constructor(leaf: WorkspaceLeaf, private plugin: GokoPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_GRID;
  }

  /**
   * Where the wall is: the grid, the folder inside it, or the library. The
   * view's header and its tab both say it, which is where a pane's name is
   * read, rather than a band laid over the top row of cards.
   */
  getDisplayText(): string {
    if (!this.plugin?.settings) return "Goko";
    if (this.showAll) return "Library";
    const grid = this.activeGrid().name;
    return this.openFolder ? `${grid} / ${this.openFolder}` : grid;
  }

  getIcon(): string {
    return GOKO_ICON_ID;
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("goko-view");

    this.progress = new ProgressBar(this.contentEl);
    this.plugin.capture.onProgress = (state) => this.progress?.set(state);
    this.plugin.capture.onFinished = (label, path) => {
      this.progress?.finish(`Clipped ${label}`);
      // Armed, not flown: the tile does not exist until the index change
      // this capture is about to cause has been painted.
      this.pendingReveal = { path, until: performance.now() + REVEAL_WINDOW_MS };
      this.reportCaptureHome(path);
      // Clipped while a folder was open: it goes into the folder, which is
      // where you were looking. The note is the plugin's own and a minute
      // old, so a second frontmatter write here is not a rewrite of anything
      // clipped.
      if (this.openFolder) void this.assign([path], this.activeGrid().name, this.openFolder);
    };

    this.grid = new GridRenderer(this.app, this.contentEl);
    this.grid.setDensity(this.stage());
    this.grid.setTileSlots(this.tileSlots());
    this.grid.setTileCaption(this.plugin.settings.tileTitle);
    this.grid.reelFor = (model) => tilesForRecord(model.record, this.plugin.archiver.cache);
    this.playback = new PlaybackController(this.grid.viewportEl, this.look().autoplayVideo);

    // Out of the pointer's way but for its buttons, so a drop, a pan or a
    // right-click on an empty wall still reaches the wall underneath.
    this.emptyWall = this.contentEl.createDiv({ cls: "pg-wall-empty" });
    const eyes = this.emptyWall.createSvg("svg", {
      cls: "pg-wall-empty-eyes",
      attr: { viewBox: EMPTY_WALL_EYES_VIEWBOX, "aria-hidden": "true" },
    });
    eyes.createSvg("path", { attr: { d: EMPTY_WALL_EYES_PATH, fill: "currentColor" } });
    const copy = emptyWallCopy(Platform.isMobile);
    const words = this.emptyWall.createDiv({ cls: "pg-wall-empty-words" });
    words.createDiv({ cls: "pg-wall-empty-title", text: copy.title });
    words.createDiv({ cls: "pg-wall-empty-hint", text: copy.hint });
    const actions = this.emptyWall.createDiv({ cls: "pg-wall-empty-actions" });
    // The same clip as the Clip row under the + at the foot of the wall,
    // offered where someone looking at a bare wall is already looking.
    const add = actions.createEl("button", { cls: "mod-cta pg-wall-empty-add" });
    setIcon(add.createSpan({ cls: "pg-wall-empty-glyph" }), "plus");
    add.createSpan({ text: "Add clip" });
    add.onclick = () => void this.plugin.clipFromClipboard();
    const guide = actions.createEl("button", { cls: "pg-wall-empty-guide", text: "Open guide" });
    guide.onclick = () => void this.plugin.openGuide();

    this.grid.onRendered = () => {
      this.playback?.prune();
      for (const media of this.grid?.mountedMedia() ?? []) {
        this.playback?.observe(media);
      }
    };

    // Hovering a card plays it even when autoplay is off, which is the only
    // way a video moves on such a wall.
    this.grid.onHoverMedia = (media) => this.playback?.hover(media);

    this.grid.onOpenNoteRequested = (id: string) => this.openNote(id);
    this.grid.onCoverDropped = (id: string, transfer: DataTransfer) => {
      // The same test the band was offered by, so a band that lit for a
      // picture takes that picture and not a document dragged along with it.
      const picture = Array.from(transfer.files).find((file) => isCoverType(file.type));
      if (!picture) return false;
      // Taken here, so the wall's own drop handler never runs to take its
      // frame down.
      this.showDropFrame(false);
      void this.setCoverFrom(id, picture);
      return true;
    };
    this.grid.onCoverAim = (aimed: boolean) => this.aimDropAtCover(aimed);
    this.grid.onDeleteRequested = (ids: string[]) => {
      const folders = this.selectedFolders();
      if (folders.length > 0) this.confirmRemoveFolders(folders);
      else this.confirmDelete(ids);
    };
    this.grid.onPropertiesRequested = (ids: string[]) => {
      const anchor = this.actionBar?.propertiesAnchor() ?? { x: 0, y: 0 };
      this.editProperties(ids, anchor.x, anchor.y);
    };

    this.dock = this.contentEl.createDiv({ cls: "pg-dock" });
    this.actionBar = new ActionBar(this.dock, {
      onProperties: (x, y) => this.editProperties(this.grid?.selectedIds() ?? [], x, y),
      onDelete: () => this.removeSelection(),
      // Both routed by what is picked: the bar keeps one pair of handlers
      // whichever it is, and the kind is what they mean.
      onMoveToGrid: (x, y) => {
        const folders = this.selectedFolders();
        const rows =
          folders.length > 0
            ? this.folderGridMoveRows(folders)
            : this.gridMoveRows(this.grid?.selectedIds() ?? []);
        this.menu?.open(rows, x, y);
      },
      onMoveToFolder: (x, y) =>
        this.menu?.open(this.folderMoveRows(this.grid?.selectedIds() ?? []), x, y),
      onDone: () => this.grid?.clearSelection(),
      onDescribe: () => this.plugin.vision.describe(this.grid?.selectedIds() ?? [], true),
      onFileSuggested: () => void this.fileSelectionAsSuggested(this.grid?.selectedIds() ?? []),
    });
    this.ruleStrip = new RuleStrip(this.contentEl);
    this.grid.onIslandAccepted = (key: string) => void this.acceptIsland(key);
    this.grid.onIslandFolded = (key: string) => this.foldIsland(key);
    this.grid.onIslandDropped = (ids: string[], key: string, folder: string) =>
      this.dropOnIsland(ids, key, folder);
    this.grid.onDragLifted = (lifted: boolean) => this.sidebar?.setDropHint(lifted);
    this.grid.onSuggestionTap = (id: string) => this.fileAsSuggested(id);
    this.grid.onSuggestionDismiss = (id: string) => this.dismissSuggestions([id]);
    this.grid.onIslandOffer = () => void this.createGridFromIdea();

    this.grid.onSelectionChanged = (ids: string[]) => {
      // The panel is what a plain click is for now, so it is told first.
      this.inspector?.show(this.grid?.selectedTiles() ?? []);
      this.actionBar?.setSelection(
        ids,
        this.grid?.selectionKind() === "folders" ? "folders" : "clippings"
      );
      this.actionBar?.setFolderable(this.canFile());
      this.actionBar?.setSuggestible(
        this.isInbox() ? ids.filter((id) => this.suggestionOf(id) !== null).length : 0
      );
      if (ids.length === 0) this.releaseRefresh();
      // The wall's own controls give up the bottom to the selection bar,
      // there being room for only one of them across a phone.
      if (Platform.isMobile) this.spaceBar?.setHidden(ids.length > 0);
      // And the selection bar gives the bottom up to the panel when there is
      // one card, which says everything the bar does and more.
      if (Platform.isMobile) this.actionBar?.setSuppressed(ids.length === 1);
    };

    this.menu = new ContextMenu(this.contentEl);
    this.sheet = new Sheet(this.contentEl);
    this.menu.onClosed = () => this.releaseRefresh();
    this.sheet.onClosed = () => this.releaseRefresh();
    // The same rows as the wall's plus button: right-clicking the wall is
    // the other way of asking what can be made here.
    this.grid.onSpaceContextRequested = (x, y) => this.openCreate(x, y);

    this.grid.onContextRequested = (ids, x, y) => {
      this.edited.clear();
      this.vocabularies.clear();
      // Rebuilt on each tick: the property rows are keepOpen, so without this
      // the menu would go on showing the values the clipping had when it
      // opened. Same reason the filter menu passes one.
      this.menu?.open(this.menuItems(ids), x, y, () => this.menuItems(ids));
    };

    // On the pane rather than in the dock: the dock is centred at the foot of
    // the wall and this belongs in the corner, where leaving a folder is the
    // same gesture as leaving a clipping.
    const back = this.contentEl.createEl("button", { cls: "pg-detail-back pg-folder-back" });

    this.spaceBar = new SpaceBar(this.dock, back, {
      onSearch: () => this.togglePalette(),
      onCreate: (x, y) => this.openCreate(x, y),
      onSettings: (x, y) => this.openSettings(x, y),
      onFilter: (x, y) => this.openFilter(x, y),
      onBack: () => this.leaveFolder(),
    }, { center: this.plugin.notifications, host: this.contentEl });
    // Built second but drawn first: the selection bar arrives to the right of
    // this one, and the dock lays them out in document order.
    this.dock.prepend(this.spaceBar.el);
    this.actionBar?.setPartner(this.spaceBar.el);
    this.spaceBar.setActive(this.activeGrid());

    this.sidebar = new Sidebar(
      this.contentEl,
      {
        onPick: (grid, folder) => {
          // Picking the grid you are already on, from inside one of its
          // folders, means "show me the grid whole" — activate() returns
          // early when the name has not changed, so the folder has to be
          // left here or the row does nothing at all.
          const staying = this.activeGrid().name === grid;
          this.showAll = false;
          this.activate(grid);
          if (folder) this.enterFolder(folder);
          else if (staying && this.openFolder) this.leaveFolder();
          else if (staying) this.refresh({ replace: true });
        },
        onPickAll: () => this.showLibrary(),
        onManage: (grid) => this.manageGrid(grid),
        onNewGrid: () => this.promptNewGrid(),
        onDrop: (ids, grid, folder) => void this.moveTo(ids, grid, folder),
        onRailDrop: (drop) => void this.onRailDrop(drop),
        onResize: (width) => {
          this.plugin.settings.sidebarWidth = width;
          void this.plugin.saveSettings();
        },
        // The wall is inset by the rail, so its columns are recomputed from
        // the width that is left rather than from the whole pane.
        onLayout: () => this.grid?.relayout(),
      },
      this.plugin.settings.sidebarWidth
    );
    this.sidebar.setHidden(this.plugin.settings.sidebarHidden);

    this.inspector = new Inspector(
      this.contentEl,
      {
        onOpen: (id) => this.grid?.openTile(id),
        onOpenNote: (id) => this.openNote(id),
        onReveal: (id) => this.revealFirstFile(id),
        onDelete: (ids) => this.confirmDelete(ids),
        onDescribe: (ids) => this.plugin.vision.describe(ids, true),
        onEditProperty: (ids, key, x, y) => this.editProperty(ids, key, x, y),
        onEditText: (id, key, value) => void this.setProperty(id, key, value ? [value] : []),
        onMoveToGrid: (ids, x, y) => this.menu?.open(this.gridMoveRows(ids), x, y),
        onMoveToFolder: (ids, x, y) => this.menu?.open(this.folderMoveRows(ids), x, y),
        onClear: () => this.grid?.clearSelection(),
        onResize: (width) => {
          this.plugin.settings.inspectorWidth = width;
          void this.plugin.saveSettings();
        },
        bytesOf: (model) => this.bytesOf(model),
        resource: (path) => resourceUrl(this.app.vault, path) || path,
        reelFor: (model) => tilesForRecord(model.record, this.plugin.archiver.cache),
        onSetCoverFrame: (id, frame) => void this.setCoverFrom(id, frame),
        properties: () => this.plugin.settings.cardProperties,
        editable: (key) => isEditable(key, this.editPolicy()),
      },
      this.plugin.settings.inspectorWidth
    );
    this.inspector.setHidden(this.plugin.settings.inspectorHidden);
    this.watchBottomInset();

    /*
     * Wakes up :active on the wall's chrome, on touch.
     *
     * WebKit applies :active to an element only when a touch handler is
     * attached to it or to something above it. The plugin's one touch
     * handler is on the viewport, and every floating control, the space bar,
     * the selection bar, the detail view's own buttons,
     * is a sibling of the viewport rather than a descendant. So none of them
     * were ever in the active state, their press transitions had nothing to
     * animate, and every tap landed with no feedback at all.
     *
     * This handler exists to be attached and does nothing else, which is the
     * documented way to ask for the behaviour. Passive, so it cannot affect
     * scrolling by even the appearance of intent.
     */
    this.registerDomEvent(this.contentEl, "touchstart", () => {}, { passive: true });

    // The phone's folded bar closes when a tap lands anywhere else, which is
    // what every menu on the platform does. Capture, so it still fires for a
    // tap the wall will go on to handle as its own.
    this.registerDomEvent(
      this.contentEl,
      "pointerdown",
      (event: PointerEvent) => {
        const target = event.target;
        if (target instanceof Element && target.closest(".pg-spacebar")) return;
        this.spaceBar?.collapse();
      },
      true
    );

    this.palette = new Palette(this.contentEl, {
      pools: () => {
        // One context for both, for the reason paletteContext builds its defs
        // once: reading the wall is the expensive half of a keystroke.
        const context = this.paletteContext();
        return { commands: buildCommands(context), values: facetValueCommands(context) };
      },
      // Every clipping in the vault, not just this wall's: the whole point
      // of searching is to find the one you cannot remember filing.
      clippings: () => this.plugin.index.records(),
      options: () => ({
        limit: PALETTE_CLIPPINGS,
        activeGrid: this.activeGrid().name,
        homeGrid: this.plugin.settings.homeGridName,
        registered: this.registered(),
      }),
      // Every grid, every folder on every grid, and every tag the vault
      // uses: an `@` or `#` token is about the library rather than about the
      // wall in front of you, for the same reason the clippings are.
      narrowTargets: () => this.narrowTargets(),
      narrowWorld: () => ({
        homeGrid: this.plugin.settings.homeGridName,
        registered: this.registered(),
        tagProperties: TAG_PROPERTIES,
      }),
      onClipping: (path) => this.revealClipping(path),
      preview: (path) => this.previewUrl(path),
    });

    this.onGridKey = (event: KeyboardEvent) => {
      if (this.app.workspace.getActiveViewOfType(GokoView) !== this) return;
      // The detail view registers in the capture phase too and owns its keys
      // while it is up.
      if (this.detail?.isOpen) return;

      // Suggestions, on the inbox: Enter agrees and X declines, for the
      // selection or else for the card under the pointer. A hand on the
      // keyboard clears an inbox in seconds; the buttons stay for the other
      // hand and for the phone.
      const quiet = !this.palette?.isOpen && !this.sheet?.isOpen && !this.menu?.isOpen;
      const typing = (event.target as HTMLElement | null)?.closest(
        "input, textarea, [contenteditable='true']"
      );
      if (
        quiet &&
        !typing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        (event.key === "Enter" || keyIs(event, "x")) &&
        this.isInbox()
      ) {
        const selected = this.grid?.selectedIds() ?? [];
        const hovered = this.grid?.hoveredTile;
        const targets = selected.length > 0 ? selected : hovered ? [hovered] : [];
        const suggested = targets.filter((id) => this.suggestionOf(id) !== null);
        if (suggested.length > 0) {
          event.preventDefault();
          if (event.key === "Enter") void this.fileSelectionAsSuggested(suggested);
          else this.dismissSuggestions(suggested);
          return;
        }
      }

      // Escape backs out of a folder once nothing else is up to close: the
      // palette, a sheet, a menu and the selection all take it first.
      if (
        event.key === "Escape" &&
        this.openFolder &&
        !this.palette?.isOpen &&
        !this.sheet?.isOpen &&
        !this.menu?.isOpen &&
        (this.grid?.selectedIds().length ?? 0) === 0
      ) {
        event.preventDefault();
        this.leaveFolder();
        return;
      }

      // Undo and redo, while the wall has the keyboard: a sheet, a menu or
      // a text field takes the chord for its own.
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        keyIs(event, "z") &&
        !this.palette?.isOpen &&
        !this.sheet?.isOpen &&
        !(event.target as HTMLElement | null)?.closest("input, textarea, [contenteditable='true']")
      ) {
        event.preventDefault();
        event.stopPropagation();
        void (event.shiftKey ? this.redo() : this.undo());
        return;
      }

      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;

      // ⌘K, handled here whether or not something upstream has already
      // claimed the event. Obsidian binds the chord to Insert link by default;
      // over the wall that command declines, but the keymap marks the event
      // handled all the same, and a guard on defaultPrevented here made the
      // wall's own search bail out in silence — the fourth report of "⌘K
      // does nothing", and the one with the grid hotkeys in this same handler
      // confirmed working, which is what placed it. If our command in main.ts
      // also fires for the same press, togglePalette folds the two into one.
      if (keyIs(event, "k")) {
        event.preventDefault();
        event.stopPropagation();
        this.togglePalette();
        return;
      }

      // The palette has the keyboard while it is up, grid hotkeys included:
      // switching walls out from under a search would leave it answering
      // about a wall that is no longer there.
      if (this.palette?.isOpen) return;

      const position = hotkeyPosition(event.key);
      if (position === null) return;
      const grid = this.allGrids()[position];
      if (!grid) return;

      // Obsidian binds these to tab switching, so this only wins while the
      // wall has focus, the same bargain the zoom keys already make.
      event.preventDefault();
      event.stopPropagation();
      this.activate(grid.name);
    };
    this.contentEl.doc.addEventListener("keydown", this.onGridKey, true);
    this.grid.onExportRequested = (ids) => void this.exportToDownloads(ids);
    this.grid.onOpenFolder = (name) => this.enterFolder(name);
    this.grid.onFolderContextRequested = (name, x, y) => this.openFolderMenu(name, x, y);
    this.grid.onFolderResized = (name, width) => void this.resizeFolder(name, width);

    this.detail = new DetailView(this.app, this.contentEl, {
      onExport: (id) => void this.exportToDownloads([id]),
      onReveal: (id) => this.revealFirstFile(id),
      onDelete: (id) => this.confirmDelete([id]),
      onOpenNote: (id) => this.openNote(id),
      onEditProperties: (id, x, y) => this.editProperties([id], x, y),
      onEditProperty: (id, key, x, y) => this.editProperty([id], key, x, y),
      onEditText: (id, key, value) => void this.setProperty(id, key, value ? [value] : []),
      onDescribe: (id) => this.plugin.vision.describe([id], true),
      onMakeCover: (id, media) => void this.setCover(id, media),
      isMenuOpen: () => this.menu?.isOpen ?? false,
    }, () => this.plugin.settings.cardProperties,
      (model) => tilesForRecord(model.record, this.plugin.archiver.cache),
      (key) => isEditable(key, this.editPolicy()));
    this.detail.onClosed = () => {
      this.grid?.focusTile(null);
      this.playback?.setEnabled(this.look().autoplayVideo);
    };
    this.grid.onOpenDetail = (model, origin) => {
      // A document opens as a document. The card is a picture of its first
      // page, which is what a wall needs; a lightbox around that picture is
      // not what anyone clicking a brand book wants, and Obsidian has a
      // reader for it two lines away.
      const pdf = this.pdfOf(model.record);
      if (pdf) {
        this.openVaultFile(pdf);
        return;
      }

      // Hidden when the stage appears, not on click: the media's true size
      // is resolved first, and hiding early leaves a hole in the meantime.
      const detail = this.detail;
      if (!detail) return;
      detail.onStageReady = () => {
        this.grid?.focusTile(model.id);
        // Nothing behind the backdrop is worth decoding. This mattered less
        // when only four tiles could play at once.
        this.playback?.setEnabled(false);
      };
      void detail.open(model, origin, () => this.grid?.tileRect(model.id) ?? null);
    };

    this.detail.onNavigate = (current, direction) => {
      const next = this.grid?.neighbor(current.id, direction);
      if (!next || !this.detail?.isOpen) return;
      // The wall follows behind the overlay, so the tile is mounted and the
      // eventual close flight has somewhere real to land.
      this.grid?.focusTile(next.id);
      this.grid?.reveal(next.id, { fit: false, select: false });
      void this.detail.show(next, () => this.grid?.tileRect(next.id) ?? null);
    };

    this.grid.onDropIntoFolder = (ids, folder) =>
      void this.moveTo(ids, this.activeGrid().name, folder);

    this.grid.onSourceFailed = (id: string, signature: string) => {
      if (this.unloadable.get(id) === signature) return;
      this.unloadable.set(id, signature);
      this.refresh();
      // A remote cover that will not load is usually a host refusing to be
      // hotlinked, and the archiver fetches without a referrer and gets it.
      // So rather than leaving the card gone until the background pass comes
      // round, that pass is asked for now, for this one. The archiver's own
      // change event brings the card back with the local file.
      // Not with downloads turned off: then nothing is fetched that was not
      // asked for, and the card waits for Download all clipping media.
      const record = this.plugin.index.get(id);
      if (record && this.plugin.settings.archiveOnCreate) void this.plugin.archiver.archiveRecord(record);
    };

    this.grid.onSourcePending = (id: string, signature: string) => {
      // Still worth waiting for: paint again shortly and see if the vault has
      // caught up. Only once its patience is spent does the cover count as
      // one that will never load.
      if (this.pending.wait(id, signature)) {
        window.setTimeout(() => {
          // The view can close inside the wait, and a repaint would then run
          // against a grid that is already gone.
          if (this.grid) this.refresh();
        }, PENDING_RETRY_MS);
        return;
      }
      if (this.unloadable.get(id) === signature) return;
      this.unloadable.set(id, signature);
      this.refresh();
    };

    this.plugin.index.onChange(() => this.refresh());
    this.plugin.archiver.onChange(() => this.refresh());

    // The stage is a fixed frame: the wall pans inside it, and nothing else
    // may move it. Overflow: hidden stops a user scrolling it but not the
    // browser doing so on someone's behalf, which focus, scrollIntoView and
    // an overscrolling child list all ask for. One rule, enforced here,
    // rather than a promise every new surface has to remember to keep.
    this.registerDomEvent(this.contentEl, "scroll", () => {
      if (this.contentEl.scrollTop !== 0) this.contentEl.scrollTop = 0;
      if (this.contentEl.scrollLeft !== 0) this.contentEl.scrollLeft = 0;
    });

    // The wall waits for the pane to stop moving. A sidebar toggle animates
    // its width over a couple of hundred milliseconds, and laying the wall
    // out on every frame of that rewrote every visible tile's size and
    // re-rasterized every video each time, which is what the toggle spent
    // its animation on. One layout at the end, restaged like a grid switch
    // rather than glided. The detail panel is a single element and keeps
    // following live.
    const relayoutSettled = settled(
      () => this.grid?.relayout({ restage: true }),
      RESIZE_SETTLE_MS,
      window
    );
    this.register(() => relayoutSettled.cancel());
    this.observer = new ResizeObserver(() => {
      // A pane narrowed past the rail's minimum puts it away and gives the
      // width back to the wall, which is the point of measuring here rather
      // than only when the setting changes.
      this.sidebar?.measure();
      this.inspector?.measure();
      relayoutSettled.call();
      this.detail?.relayout();
    });
    this.observer.observe(this.contentEl);

    // Paste a link anywhere in the grid to clip it, the way you would drop
    // a URL into a board app.
    this.registerDomEvent(this.contentEl.doc, "paste", (event: ClipboardEvent) => {
      if (this.app.workspace.getActiveViewOfType(GokoView) !== this) return;
      // Pasting into the palette's search box is typing, not clipping.
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      const data = event.clipboardData;
      if (!data) return;

      // Media data first: copying an image from a browser also puts its URL
      // on the clipboard, and the bytes in hand beat a link to fetch.
      const file = Array.from(data.files).find(
        (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
      );
      if (file) {
        event.preventDefault();
        // One card selected means the picture is for that card. Copying a
        // picture and pasting it onto a clipping that has none is the
        // shortest answer to "this one has no picture", and making a second
        // clipping out of it instead would be answering a question nobody
        // asked. Nothing selected, or several, and it is a clipping of its
        // own, as it has always been.
        const picked = this.grid?.selectionKind() === "clippings" ? this.grid.selectedIds() : [];
        if (picked.length === 1) void this.setCoverFrom(picked[0], file);
        else void this.plugin.capture.captureMedia(file);
        return;
      }

      const text = data.getData("text/plain")?.trim();
      if (!text) return;
      event.preventDefault();
      void this.plugin.capture.capture(text);
    });

    this.installDropTarget();

    this.refresh();
  }

  /**
   * Dropping pictures, videos or a web link onto the wall clips them, the same
   * three things a paste can carry.
   *
   * dragover has to cancel the event on every single move, not merely once on
   * entry: the drop event never fires otherwise, and Obsidian takes the file
   * instead and imports it as an attachment beside the note you last had open.
   */
  private installDropTarget(): void {
    const el = this.contentEl;

    // The frame's dashes, as a stroke rather than a border, because a CSS
    // border cannot have its dash offset animated and a stroke can. One rect,
    // so the dashes run continuously round the corners instead of four edges
    // meeting at seams. Made once and hidden by CSS until a drag arrives.
    const frame = el.createSvg("svg", { cls: "pg-drop-frame" });
    frame.setAttribute("aria-hidden", "true");
    const dashes = frame.createSvg("rect");

    // dragleave fires again every time the pointer crosses into a child, and
    // the wall is nothing but children. Counting entries against leaves is
    // what stops the target strobing the whole way across the grid.
    let depth = 0;
    /**
     * Fits the dash pattern to the frame it is going round.
     *
     * A dash pattern restarts at the path's start point, so unless the
     * perimeter divides evenly by one dash plus one gap, the last dash lands
     * on top of the first and the top left corner wears a join. Rounding the
     * period to whatever divides the actual perimeter costs a fraction of a
     * pixel each and leaves no seam at all.
     *
     * The perimeter is worked out from the box rather than asked of the path.
     * getTotalLength on a rect whose geometry comes from CSS depends on style
     * and layout having already run, and this is called in the same tick as
     * the class that reveals it, so it was reporting nothing and leaving the
     * seam it exists to remove. Arithmetic on a rounded rectangle needs
     * neither.
     */
    const fitDashes = (): void => {
      const box = el.getBoundingClientRect();
      // 11px a side: the overlay's 10px inset plus half the 2px stroke.
      const width = box.width - 22;
      const height = box.height - 22;
      if (width <= 0 || height <= 0) return;

      const radius = Math.min(
        parseFloat(window.getComputedStyle(dashes).rx) || 0,
        width / 2,
        height / 2
      );
      // Four straights shortened by a radius at each end, plus the four
      // quarter-circles of the corners, which together make one whole one.
      const length = 2 * (width + height) - 8 * radius + 2 * Math.PI * radius;
      if (!(length > 0)) return;

      const count = Math.max(1, Math.round(length / (DASH + GAP)));
      const period = length / count;
      const dash = period * (DASH / (DASH + GAP));
      dashes.style.strokeDasharray = `${dash} ${period - dash}`;
      // One whole period per cycle, so the loop closes on itself.
      el.style.setProperty("--pg-drop-period", `${period}px`);
    };

    // Kept apart from the depth rather than folded into it: the pointer on a
    // cover band is still inside the wall, and the count is what brings the
    // frame back the moment it moves off the band.
    let aimedAtCover = false;

    const paintFrame = (on: boolean): void => {
      // Named while it is up, because a drop does not always land where you
      // are looking: nothing is filed into a smart grid, so one on screen
      // sends the clipping home and the frame should say so before the drop
      // rather than a toast after it. Carried as a custom property, the label
      // being ::after content and there being no element to set text on.
      if (on) {
        const space = this.activeGrid();
        const target = isSmartGrid(space) ? this.plugin.settings.homeGridName : space.name;
        el.style.setProperty("--pg-drop-label", JSON.stringify(`Drop to add to ${target}`));
      }
      el.toggleClass("is-drop-target", on);
      // After the class, never before: the frame is display none until it is
      // there, and a hidden path has no length to measure.
      if (on) fitDashes();
    };

    this.showDropFrame = (on: boolean): void => {
      if (!on) {
        depth = 0;
        aimedAtCover = false;
      }
      paintFrame(on && !aimedAtCover);
    };

    this.aimDropAtCover = (aimed: boolean): void => {
      aimedAtCover = aimed;
      paintFrame(depth > 0 && !aimed);
    };

    this.registerDomEvent(el, "dragenter", (event: DragEvent) => {
      const types = Array.from(event.dataTransfer?.types ?? []);
      // Files are sealed until the drop, so the list of types is the whole of
      // what can be known while there is still time to show a target.
      if (!wantsDrop(types)) return;
      event.preventDefault();
      depth++;
      this.showDropFrame(true);
    });

    this.registerDomEvent(el, "dragover", (event: DragEvent) => {
      if (!wantsDrop(Array.from(event.dataTransfer?.types ?? []))) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });

    this.registerDomEvent(el, "dragleave", () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) this.showDropFrame(false);
    });

    this.registerDomEvent(el, "drop", (event: DragEvent) => {
      const data = event.dataTransfer;
      if (!data) return;

      const plan = classifyDrop(
        Array.from(data.files).map((file) => ({ name: file.name, type: file.type })),
        data.getData("text/uri-list") || data.getData("text/plain") || ""
      );
      // Left alone deliberately, so Obsidian's own drags still do what they
      // have always done rather than dying against a preventDefault.
      if (plan.kind === "ignore") return;

      event.preventDefault();
      this.showDropFrame(false);

      if (plan.kind === "unsupported") {
        new Notice(`Goko: ${describeSkipped(plan.skipped)}`);
        return;
      }

      if (plan.kind === "url") {
        void this.plugin.capture.capture(plan.url);
        return;
      }

      if (plan.skipped.length > 0) {
        new Notice(`Goko: ${describeSkipped(plan.skipped)}`);
      }
      void this.captureDropped(
        data.files,
        plan.files.map((file) => file.name),
        plan.notes.map((file) => file.name)
      );
    });

    // A drag that ends outside the window never sends a leave, so the target
    // would stay lit over a wall that is no longer expecting anything.
    this.registerDomEvent(window, "dragend", () => this.showDropFrame(false));
    this.registerDomEvent(window, "blur", () => this.showDropFrame(false));
  }

  /**
   * Saves dropped files one at a time.
   *
   * Sequential rather than in parallel: each capture writes an attachment and
   * a note and drives the one progress bar, and several racing each other
   * would fight over the bar and over the unique-name check that keeps two
   * files landing in the same second from overwriting one another.
   *
   * One file is a clip and answers like one. Several are a job: the bar
   * counts them, a Stop button ends it between files, and the model is not
   * started on any of them — that is offered once at the end, because
   * spending money on four hundred pictures is a decision a person makes,
   * not a loop.
   */
  /** The clipping a file dropped from the desktop already is, if it is one. */
  private ownClipping(file: File): string | null {
    const root = vaultRoot(this.app.vault);
    const path = root ? pathInsideVault(root, droppedFilePath(file)) : null;
    return path && this.plugin.index.get(path) ? path : null;
  }

  private async captureDropped(
    files: FileList,
    wanted: string[],
    notes: string[] = []
  ): Promise<void> {
    const taking = new Set(wanted);
    const asNotes = new Set(notes);
    const batch = Array.from(files).filter(
      (file) => taking.has(file.name) || asNotes.has(file.name)
    );
    if (batch.length === 0) return;

    // A markdown file is already a clipping in every way but where it lives,
    // so it is filed rather than archived. Which of the two a file is stays
    // core/drop.ts's decision; this only carries it out.
    const take = async (file: File, quiet: boolean): Promise<void> => {
      if (asNotes.has(file.name)) {
        // Dragged from Finder out of this vault's own clippings, the note is
        // already a clipping: filed where it was dropped, not copied beside
        // itself as a second card.
        const own = this.ownClipping(file);
        if (own) {
          const settings = this.plugin.settings;
          const grid = fileableGrid(settings.activeGrid, settings.homeGridName, settings.grids);
          await this.moveTo([own], grid || settings.homeGridName);
          return;
        }
        await this.plugin.capture.captureNote(await file.text(), file.name, undefined, { quiet });
        return;
      }
      await this.plugin.capture.captureMedia(file, titleForDropped(file.name), { quiet });
    };

    if (batch.length === 1) {
      await take(batch[0], false);
      return;
    }

    let stopped = false;
    let done = 0;
    const show = (label: string): void =>
      this.progress?.set({
        fraction: null,
        label,
        done,
        total: batch.length,
        onStop: () => {
          stopped = true;
        },
      });

    show("Importing\u2026");
    for (const file of batch) {
      if (stopped) break;
      await take(file, true);
      done++;
      show(titleForDropped(file.name));
    }

    this.progress?.finish(
      stopped ? `Stopped after ${done} of ${batch.length}` : `Imported ${done}`
    );
    this.offerToDescribe(done);
  }

  /**
   * Offers the model once, after a batch, instead of starting it per file.
   *
   * Only where it would do something: the setting is on, the provider is
   * ready, and something actually landed. A notice rather than a modal —
   * the work is finished either way, and this is an invitation, not a step.
   */
  private offerToDescribe(landed: number): void {
    if (landed === 0 || !this.plugin.settings.aiAutoDescribe || !this.plugin.vision.ready) return;
    const notice = new Notice(`Goko: ${landed} imported. Describe them with AI?`, 12000);
    const button = notice.messageEl.createEl("button", {
      cls: "pg-notice-action",
      text: "Describe",
    });
    button.onclick = () => {
      notice.hide();
      this.plugin.vision.describeUndescribed();
    };
  }

  /**
   * Public: the settings tab calls this when the property list changes, so an
   * open wall picks up a new facet without a reload. Filters left over from a
   * facet that has just been switched off are pruned by activeFilter on the
   * way through.
   */
  refreshFacets(): void {
    this.applyFilter({ replace: true });
  }

  /** Settings changed the tile's tag slot; the wall redraws its badges. */
  refreshTileProperties(): void {
    this.grid?.setTileSlots(this.tileSlots());
    this.grid?.setTileCaption(this.plugin.settings.tileTitle);
  }

  /**
   * Puts the four look settings onto the wall.
   *
   * Called on a grid switch, after an edit to a look, and after the settings
   * tab moves a shared value, since any of the three can change what is in
   * force here without a tile changing. Filter properties need no call: the
   * filter menu and the detail panel both read the accessor as they open.
   */
  applyLook(): void {
    const look = this.look();
    // stage(), not look.tileSize: the grouped inbox packs down over whatever
    // the wall itself resolves to.
    this.grid?.setDensity(this.stage());
    this.grid?.setTileSlots({ property: look.tileProperty });
    // The detail view restores playback on close, so obeying the setting
    // underneath it would set the wall playing behind the backdrop.
    if (!this.detail?.isOpen) this.playback?.setEnabled(look.autoplayVideo);
  }

  private tileSlots(): { property: string } {
    return { property: this.look().tileProperty };
  }

  /** Public: the ⌘K command in main.ts drives the palette through this. */
  /** When the palette last toggled, to fold two arrivals of one keystroke into one. */
  private paletteToggledAt = 0;

  togglePalette(): void {
    // ⌘K reaches here twice per press: once from the wall's own keydown
    // listener, which is on the document in the capture phase and so runs
    // first, and once from the command Obsidian dispatches for the same
    // chord. Two toggles is open-then-close, which on screen is nothing at
    // all — and was, for three rounds of "⌘K does nothing". The guard on
    // defaultPrevented cannot catch it: the command's preventDefault comes
    // after the listener has already acted. So the second arrival within a
    // keystroke's worth of time is the same press, and is ignored.
    const now = performance.now();
    if (now - this.paletteToggledAt < 120) return;
    this.paletteToggledAt = now;

    // Each way this can do nothing says so.
    if (this.detail?.isOpen) {
      new Notice("Goko: close the open clipping first");
      return;
    }
    if (!this.palette) {
      new Notice("Goko: the wall did not finish loading — close this tab and open the wall again", 8000);
      return;
    }
    try {
      this.palette.toggle();
    } catch (error) {
      // A palette that fails to build fails on a keystroke, where nothing on
      // screen would say so. Reported as text: "⌘K does nothing" is not a
      // report anyone can act on, the exception is.
      console.error("Goko: palette failed", error);
      new Notice(`Goko: the palette failed to open (${String(error)})`, 8000);
    }
  }

  /**
   * Keeps the wall's floating controls clear of Obsidian's mobile navbar.
   *
   * The navbar is a bar of its own laid over the view, not something the
   * view is sized above, so the space bar and the action bar sit underneath
   * it and the filter and create buttons cannot be reached.
   *
   * There is no height to read: Obsidian publishes --safe-area-inset-bottom
   * and --mobile-toolbar-height, but the latter is the editor's toolbar and
   * neither describes the navbar. So the overlap is measured, which is more
   * honest than a constant anyway: it answers with nothing at all when the
   * navbar is hidden, on a phone that has none, and on desktop.
   */
  private syncBottomInset(): void {
    const navbar = this.contentEl.doc.body.querySelector<HTMLElement>(".mobile-navbar");
    if (!navbar || !navbar.isShown()) {
      this.contentEl.style.removeProperty("--pg-bottom-inset");
      return;
    }

    const content = this.contentEl.getBoundingClientRect();
    // A view in a background tab is display:none and measures as all
    // zeros, which would pin the inset to 0px until the next resize.
    // Skipped instead: onResize re-measures the moment the tab is shown.
    if (content.width === 0 && content.height === 0) return;

    const bar = navbar.getBoundingClientRect();
    // How much of our own bottom edge the navbar covers, rather than how
    // tall it is: the two differ whenever the view does not run to the
    // bottom of the window.
    const overlap = Math.max(0, content.bottom - bar.top);
    this.contentEl.style.setProperty("--pg-bottom-inset", `${Math.round(overlap)}px`);
  }

  /**
   * Obsidian calls this when the leaf's size changes, which includes going
   * from a hidden background tab to the visible one. That transition fires
   * no workspace resize, so without this a wall opened behind another tab
   * kept a stale inset until it was closed and reopened.
   */
  onResize(): void {
    if (Platform.isMobile) this.syncBottomInset();
  }

  /**
   * The navbar comes and goes, with the keyboard and with rotation, so the
   * measurement is repeated rather than taken once at open.
   */
  private watchBottomInset(): void {
    if (!Platform.isMobile) return;
    this.syncBottomInset();
    this.registerEvent(this.app.workspace.on("resize", () => this.syncBottomInset()));
    this.registerDomEvent(window, "orientationchange", () => this.syncBottomInset());
    // Layout settling after open can move the navbar under us a frame late.
    this.app.workspace.onLayoutReady(() => this.syncBottomInset());
  }

  async onClose(): Promise<void> {
    this.cancelRefresh();
    if (this.onGridKey) this.contentEl.doc.removeEventListener("keydown", this.onGridKey, true);
    this.onGridKey = null;
    this.palette?.close();
    this.palette = null;
    this.spaceBar?.destroy();
    this.spaceBar = null;
    this.observer?.disconnect();
    this.observer = null;
    this.playback?.destroy();
    this.playback = null;
    this.plugin.capture.onProgress = null;
    this.plugin.capture.onFinished = null;
    this.progress?.destroy();
    this.progress = null;
    this.actionBar?.destroy();
    this.actionBar = null;
    this.inspector?.destroy();
    this.inspector = null;
    this.ruleStrip?.destroy();
    this.ruleStrip = null;
    this.menu?.close();
    this.menu = null;
    this.detail?.close(true);
    this.detail = null;
    this.grid?.destroy();
    this.grid = null;
  }

  /** The archived files a clipping leaves the vault as, originals only. */
  private filesFor(id: string): string[] {
    const record = this.plugin.index.get(id);
    if (!record) return [];
    return exportFiles(record, (key) => this.plugin.archiver.cache.get(key)?.file);
  }

  /**
   * The rows for editing every editable property of a selection.
   *
   * One clipping or many: each value row reads across the whole selection, a
   * tick where all hold it, a dash where some do, and a tap makes it
   * everywhere or nowhere (toggleAcross). Shared with the detail view's bar
   * and the action bar so every surface offers the same rows and reaches the
   * same single writer, one file at a time.
   */
  /** The write licence, read fresh: a setting changed mid-session takes effect
      on the next menu rather than on the next reload. */
  private editPolicy(): EditablePolicy {
    return { allowEditingTags: this.plugin.settings.allowEditingTags };
  }

  propertyRows(ids: string[]): MenuItem[] {
    const rows: MenuItem[] = [];
    const policy = this.editPolicy();
    for (const def of this.defs()) {
      if (def.source !== "property" || !def.key || !isEditable(def.key, policy)) continue;
      rows.push({
        icon: def.icon,
        label: def.label,
        submenu: this.propertyMenu(ids, def.key),
      });
    }
    return rows;
  }

  /**
   * Grouped by what a row acts on: reaching the clipping, describing it,
   * filing it, destroying it.
   *
   * Describing and filing are ruled apart because the code draws that line
   * too, and for the same reason: a property goes through setProperty behind
   * isEditable, while `grid` is excluded from it and has its own path in
   * assign. One is saying what a clipping is, the other is saying where it
   * lives.
   */
  private menuItems(ids: string[]): MenuItem[] {
    const n = ids.length;
    const count = n === 1 ? "1 selected" : `${n} selected`;

    const reach: MenuItem[] = [];
    const describe: MenuItem[] = this.propertyRows(ids);
    const file: MenuItem[] = [];
    const destroy: MenuItem[] = [];

    // With the properties, since that is what it writes into.
    describe.push({
      icon: "sparkles",
      label: n === 1 ? "Describe with AI" : `Describe ${n} with AI`,
      onSelect: () => this.plugin.vision.describe(ids, true),
    });

    describe.push(...this.coverRows(ids));

    if (n === 1) {
      // Touch has no modifier key, so this is the way into selecting more
      // than one thing. Only offered where that is true, and only for a
      // single card, since a menu opened on a selection is already in it.
      if (Platform.isMobile) {
        reach.push({
          icon: "check-circle",
          label: "Select",
          onSelect: () => this.grid?.beginTouchSelection(ids[0]),
        });
      }
      // Above the note, because it is what the card is: the note is the
      // record kept about it. Only when the file is actually in the vault,
      // which is what pdfOf answers.
      const pdf = this.pdfOf(this.plugin.index.get(ids[0]) ?? null);
      if (pdf) {
        reach.push({
          icon: "book-open",
          label: "Open PDF",
          onSelect: () => this.openVaultFile(pdf),
        });
      }
      reach.push({
        icon: "file-text",
        label: "Open note",
        onSelect: () => this.openNote(ids[0]),
      });
    }

    if (n === 1) {
      const source = this.plugin.index.get(ids[0])?.source ?? "";
      if (isHttpUrl(source)) {
        reach.push({
          icon: "globe",
          label: "Open in browser",
          onSelect: () => {
            window.open(source);
          },
        });
      }
    }

    // Where the note actually is, for pasting somewhere outside Obsidian. The
    // whole path from the root of the disk where there is one, and the vault's
    // own path on a phone, which has no such thing to give.
    reach.push({
      icon: "copy",
      label: n === 1 ? "Copy path" : "Copy paths",
      onSelect: () => void this.copyPaths(ids),
    });

    if (systemAvailable()) {
      reach.push({
        icon: "download",
        label: "Export to Downloads",
        detail: "⌘E",
        onSelect: () => void this.exportToDownloads(ids),
      });

      if (n === 1) {
        reach.push({
          icon: "folder",
          label: "Show in system explorer",
          onSelect: () => this.revealFirstFile(ids[0]),
        });
      }
    }

    if (this.canFile()) {
      file.push({
        icon: "folder",
        label: "Move to folder",
        submenu: this.folderMoveRows(ids),
      });
    }

    // No longer gated on there being a second grid: the submenu now ends in
    // New grid, so on a vault with one grid it is the row that makes the
    // second one rather than a list of nowhere to go.
    file.push({
      icon: "corner-up-right",
      label: "Move to grid",
      submenu: this.gridMoveRows(ids),
    });

    // Later without entering the sort mode: the reminder is a property like
    // any other, and wanting one card back next month is not a reason to
    // start a pass over the whole inbox.
    file.push({
      icon: "clock",
      label: "Remind me",
      detail: this.remindDetail(ids),
      submenu: this.remindRows(ids),
    });

    // The suggestion's own no. A drag to the undecided pile says the same,
    // but a phone cannot drag and the flat inbox has no pile to drag to.
    if (this.isInbox() && ids.some((id) => this.suggestionOf(id) !== null)) {
      file.push({
        icon: "eye-off",
        label: "Dismiss suggestion",
        onSelect: () => this.dismissSuggestions(ids),
      });
    }

    destroy.push({
      icon: "trash-2",
      label: "Delete",
      detail: count,
      destructive: true,
      onSelect: () => this.confirmDelete(ids),
    });

    return groupedMenu([reach, describe, file, destroy]);
  }

  /** The date already set, when every card in the selection shares one. */
  private remindDetail(ids: readonly string[]): string | undefined {
    const dates = new Set(ids.map((id) => remindOf(this.plugin.index.get(id) ?? { properties: {} })));
    const only = dates.size === 1 ? [...dates][0] : "";
    return only || undefined;
  }

  /**
   * When to bring these cards back.
   *
   * Presets rather than a date field: the answer is almost always "not this
   * week", and typing 2026-10-08 to say that is a worse way of saying it.
   * The date is still there in the note for anyone who wants an exact one.
   */
  private remindRows(ids: string[]): MenuItem[] {
    const set = (days: number): void => {
      const until = laterDate(days);
      for (const id of ids) void this.setProperty(id, REMIND_KEY, [until]);
      new Notice(
        ids.length === 1
          ? `Goko: back on ${until}`
          : `Goko: ${ids.length} clippings back on ${until}`
      );
    };

    const held = ids.some((id) => remindOf(this.plugin.index.get(id) ?? { properties: {} }));
    return [
      { icon: "clock", label: "Tomorrow", onSelect: () => set(1) },
      { icon: "clock", label: "In a week", onSelect: () => set(LATER_DAYS) },
      { icon: "clock", label: "In a month", onSelect: () => set(30) },
      {
        icon: "x",
        label: "Clear reminder",
        divider: true,
        disabled: !held,
        onSelect: () => {
          for (const id of ids) void this.setProperty(id, REMIND_KEY, []);
        },
      },
    ];
  }

  /** The grids a selection can be moved to, ending in New grid, which takes
      the selection with it. Folders offer the same, and a selection that has
      nowhere to go is the reason: the way out of a wall with one grid on it
      is to make the second one from here. */
  private gridMoveRows(ids: string[]): MenuItem[] {
    const grids = this.allGrids();
    return [
      ...grids.map((grid) => ({
        icon: grid.icon,
        label: grid.name,
        onSelect: () => void this.moveTo(ids, grid.name),
      })),
      {
        icon: "plus",
        label: "New grid\u2026",
        divider: true,
        // Moved rather than followed: the clippings leave this wall, and the
        // notice says where they went, which is how every other move reads.
        onSelect: () => this.promptNewGrid((saved) => void this.moveTo(ids, saved.name)),
      },
    ];
  }

  /** The folders here, ending in New folder, which takes the selection with it. */
  private folderMoveRows(ids: string[]): MenuItem[] {
    const folders = this.foldersHere();
    return [
      ...folders.map((folder) => ({
        icon: folder.icon,
        label: folder.name,
        onSelect: () => void this.moveToFolder(ids, folder.name),
      })),
      {
        icon: "folder-plus",
        label: "New folder…",
        divider: folders.length > 0,
        onSelect: () => this.promptNewFolder(ids),
      },
    ];
  }

  /**
   * Opens the property rows from the detail view's bar, anchored at the button
   * that asked for them.
   *
   * Elevated, because the detail overlay outranks a menu in the normal stack
   * and the panel would otherwise open behind it. Given a rebuild on the same
   * terms as the wall's menu: these rows keep the panel open so several can be
   * ticked in a row, which only reads correctly if each click repaints them
   * from the state it just wrote.
   */
  private editProperties(ids: string[], x: number, y: number): void {
    if (ids.length === 0) return;
    // The cover above the properties and ruled off from them: it is the one
    // row here that writes a file rather than a value, and it is the only
    // way to a cover a phone has — there is no right-click to reach the
    // wall's menu with, and a card with no picture opens its note rather
    // than the detail view whose bar carries the rest.
    const rows = (): MenuItem[] => groupedMenu([this.coverRows(ids), this.propertyRows(ids)]);
    const items = rows();
    if (items.length === 0) {
      new Notice("Goko: no editable properties are enabled in Settings");
      return;
    }
    this.menu?.open(items, x, y, rows, true);
  }

  /**
   * Giving one clipping a picture by hand.
   *
   * One clipping at a time: a cover is a particular picture for a particular
   * thing, and the same one on five cards is not something anyone means.
   */
  private coverRows(ids: string[]): MenuItem[] {
    if (ids.length !== 1) return [];
    const held = this.coverOf(ids[0]);
    const rows: MenuItem[] = [
      {
        icon: "image",
        label: held ? "Replace cover\u2026" : "Set cover\u2026",
        onSelect: () => this.chooseCover(ids[0]),
      },
    ];
    if (held) {
      rows.push({
        icon: "x",
        label: "Clear cover",
        onSelect: () => void this.setCover(ids[0], ""),
      });
    }
    return rows;
  }

  /**
   * One property's value picker, opened where it was asked for.
   *
   * Guarded here rather than trusted: the caller is the detail pane, which
   * decides what to draw as editable from the same predicate, but the licence
   * to write has to be checked where the write is arranged.
   */
  private editProperty(ids: string[], key: string, x: number, y: number): void {
    if (ids.length === 0) return;
    if (!isEditable(key, this.editPolicy())) return;
    const rows = (): MenuItem[] => this.propertyMenu(ids, key);
    this.menu?.open(rows(), x, y, rows, true);
  }

  private openNote(id: string): void {
    this.openVaultFile(id);
  }

  private openVaultFile(path: string): void {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
  }

  /** The PDF this clipping is, as a vault path, or "" when it is not one. */
  private pdfOf(record: ClippingRecord | null): string {
    if (!record) return "";
    return pdfPathOf(record, (key) => this.plugin.archiver.cache.get(key)?.file ?? "");
  }

  /**
   * Puts the notes' own paths on the clipboard, one per line.
   *
   * The absolute path where the vault is a folder on a disk, which is what
   * makes it useful outside Obsidian — a terminal, a file dialog, another
   * app's open box. A phone's vault has no such path, so the vault-relative
   * one goes instead and the notice says which it was, rather than quietly
   * copying something shorter than was asked for.
   */
  private async copyPaths(ids: string[]): Promise<void> {
    const paths: string[] = [];
    let absolute = true;
    for (const id of ids) {
      const record = this.plugin.index.get(id);
      if (!record) continue;
      const full = absolutePath(this.app.vault, normalizePath(record.path));
      if (!full) absolute = false;
      paths.push(full ?? record.path);
    }
    if (paths.length === 0) {
      new Notice("Goko: nothing to copy");
      return;
    }

    try {
      await navigator.clipboard.writeText(paths.join("\n"));
    } catch {
      // A clipboard write can be refused outright on a window without focus,
      // and a silent failure here looks exactly like a successful copy.
      new Notice("Goko: could not write to the clipboard");
      return;
    }

    const what = paths.length === 1 ? "path" : `${paths.length} paths`;
    new Notice(absolute ? `Goko: copied the ${what}` : `Goko: copied the vault ${what}`);
  }

  private revealFirstFile(id: string): void {
    const file = this.filesFor(id)[0];
    if (!file) {
      new Notice("Goko: nothing archived for this clipping yet");
      return;
    }
    const absolute = absolutePath(this.app.vault, normalizePath(file));
    if (!absolute || !revealInFinder(absolute)) {
      new Notice("Goko: could not reveal the file");
    }
  }

  async exportToDownloads(ids: string[]): Promise<void> {
    let copied = 0;
    for (const id of ids) {
      for (const file of this.filesFor(id)) {
        const absolute = absolutePath(this.app.vault, normalizePath(file));
        if (!absolute) continue;
        const name = file.slice(file.lastIndexOf("/") + 1);
        if (copyToDownloads(absolute, name)) copied++;
      }
    }
    new Notice(
      copied === 0
        ? "Goko: nothing archived to export yet"
        : `Goko: exported ${copied} file${copied === 1 ? "" : "s"} to Downloads`
    );
  }

  private confirmDelete(ids: string[]): void {
    const titles = ids.map((id) => this.plugin.index.get(id)?.title ?? id);
    const media = this.doomedMedia(ids);
    new ConfirmDeleteModal(
      this.app,
      titles,
      () => void this.deleteClippings(ids, media.paths),
      media.paths.length > 0 ? describeFiles(media) : undefined
    ).open();
  }

  /** The archived files these clippings would leave behind, and their size. */
  private doomedMedia(ids: string[]) {
    return orphansAfterDeleting(
      this.app,
      this.plugin.index.records(),
      ids,
      this.plugin.archiver.cache,
      this.plugin.settings.attachmentFolder
    );
  }

  /**
   * @param media archived files worked out *before* the notes went, since
   * afterwards the records they were derived from no longer exist. Already
   * reference counted, so nothing a surviving clipping uses is in here.
   */
  private async deleteClippings(ids: string[], media: string[] = []): Promise<void> {
    let removed = 0;
    for (const id of ids) {
      const file = this.app.vault.getAbstractFileByPath(id);
      if (!(file instanceof TFile)) continue;
      try {
        // Obsidian's trash, so this stays recoverable.
        await this.app.fileManager.trashFile(file);
        removed++;
      } catch (error) {
        new Notice(`Goko: could not delete ${file.basename} (${String(error)})`);
      }
    }

    // Only after the notes are gone: a failed trashFile leaves a clipping
    // pointing at media, and that media should still be there.
    const files = removed === ids.length ? media : [];
    const swept = await removeMedia(this.app, this.plugin.archiver.cache, files);
    if (swept > 0) await this.plugin.archiver.saveCache();

    this.grid?.clearSelection();
    const notes = removed === 1 ? "1 note" : `${removed} notes`;
    new Notice(
      swept > 0
        ? `Goko: ${notes} and ${swept} media file${swept === 1 ? "" : "s"} moved to trash`
        : `Goko: ${notes} moved to trash`
    );
  }

  /**
   * Coalesced to one repaint a frame.
   *
   * The archiver emits once per clipping it finishes, so a pass over a few
   * hundred used to run a few hundred full sorts, filters, tile builds and
   * relayouts, most of them landing in the same frame and all but the last
   * discarded. A switch is exempt: it is a direct answer to a click and has
   * to land now.
   */
  refresh(options: { replace?: boolean } = {}): void {
    if (options.replace) {
      this.cancelRefresh();
      this.paint(options);
      return;
    }
    // Held while a menu, a sheet or the selection bar is up. A repaint
    // re-runs the filter, and on a wall narrowed to "is empty" the clipping
    // being given its first category would vanish under the menu before the
    // second could be given. What was changed is on disk already; the wall
    // catches up when the surface comes down (releaseRefresh).
    if (this.holdingRefresh()) {
      this.refreshHeld = true;
      return;
    }
    if (this.refreshFrame) return;
    this.refreshFrame = window.requestAnimationFrame(() => {
      this.refreshFrame = 0;
      this.paint({});
    });
  }

  private cancelRefresh(): void {
    if (this.refreshFrame) window.cancelAnimationFrame(this.refreshFrame);
    this.refreshFrame = 0;
    this.refreshHeld = false;
  }

  private holdingRefresh(): boolean {
    return (
      (this.menu?.isOpen ?? false) ||
      (this.sheet?.isOpen ?? false) ||
      (this.grid?.selectedIds().length ?? 0) > 0
    );
  }

  /**
   * Runs a held refresh once nothing is holding it. A tick later rather than
   * now: the menu's New value row closes the menu and opens the sheet in the
   * same call, and the wall must not repaint in the gap between.
   */
  private releaseRefresh(): void {
    if (!this.refreshHeld) return;
    queueMicrotask(() => {
      if (!this.refreshHeld || this.holdingRefresh()) return;
      this.refreshHeld = false;
      this.refresh();
    });
  }

  /**
   * Settings the wall can adopt where it stands, pushed as they are saved.
   *
   * Only the ones that need nothing rebuilt: anything changing what a tile is
   * or which records are on screen is a refresh, not this. Autoplay qualifies
   * because the controller was always able to be told, and nothing was ever
   * telling it, so the toggle wrote a value the open wall went on ignoring
   * until the view was reopened.
   */
  /**
   * Takes on a grid list that changed outside this device, which is what a
   * sync delivering another device's configuration looks like from here.
   *
   * Re-activating rather than repainting, because the switcher, the hotkey
   * order and the wall all read the list: activeGrid already falls back to
   * home, so a grid deleted on the other device leaves this one on home
   * rather than staring at a wall that no longer has a name.
   */
  refreshGrids(): void {
    // Deliberately not activate(), which returns early when the name has not
    // changed, and after a sync it usually has not: the grid you are standing
    // in is still called what it was called. What changed is what is in it,
    // or its rules, or which other grids exist beside it, so the wall is
    // repainted outright.
    //
    // activeGrid falls back to home, so a grid deleted on the other device
    // leaves this one on home rather than staring at a wall with no name.
    const space = this.activeGrid();
    this.plugin.settings.activeGrid = space.name;
    this.spaceBar?.setActive(space);
    this.refresh({ replace: true });
  }

  /**
   * Called after every settings save, which is how an open wall hears about
   * one. Everything a wall is drawn with goes through the look, so there is
   * one thing to call and no way to add a setting that silently does not
   * take effect.
   */
  applyLiveSettings(): void {
    // Not while the detail view is up. It turns playback off deliberately and
    // restores it on close, so obeying the setting here would set the wall
    // playing behind the backdrop.
    if (this.detail?.isOpen) return;
    this.applyLook();
    this.grid?.setTileCaption(this.plugin.settings.tileTitle);
  }

  private paint(options: { replace?: boolean }): void {
    if (!this.grid) return;

    const space = this.activeGrid();
    const smart = isSmartGrid(space);

    // A smart grid's rules run over the whole vault rather than over one
    // wall's slice, because home stays everything: a clipping filed in Manga
    // is still eligible for a smart grid, and would be missing from it if the
    // rules only ever saw the grid it happened to be filed in.
    const shown =
      smart || this.showAll
        ? this.plugin.index.records()
        : filterByGrid(
            this.plugin.index.records(),
            space.name,
            this.plugin.settings.homeGridName,
            this.registered()
          );
    // The inbox holds back what is waiting for a date. Only the inbox: a
    // clipping filed on a grid is somewhere on purpose, and hiding it there
    // would make a reminder a way of losing things. The library shows
    // everything by definition, so it is exempt too.
    const inbox = this.isInbox();
    const holdBack = inbox && !this.showSnoozed;
    const parted = holdBack ? partitionSnoozed(shown, Date.now()) : null;
    this.snoozedCount = inbox
      ? (parted?.snoozed.length ?? shown.filter((r) => isSnoozed(r, Date.now())).length)
      : 0;
    const due = parted ? parted.shown : [...shown];

    // Suggestions are the inbox's: a card on a grid is where you put it.
    if (inbox) {
      this.propose(due);
      this.gridIdea = this.ideaFor(due);
      // The flat inbox has no pile heading to carry the offer, so it is put
      // once, in the strip, and then left alone: an idea repeated on every
      // repaint would be nagging.
      const idea = this.gridIdea;
      if (idea && !this.plugin.settings.inboxGrouped && !this.offeredIdeas.has(idea.tag)) {
        this.offeredIdeas.add(idea.tag);
        const n = idea.paths.length;
        this.ruleStrip?.offer({
          text: `${n} cards share \u201c${idea.tag}\u201d. Make a ${idea.name} grid for them?`,
          onYes: () => void this.createGridFromIdea(),
          onNo: () => undefined,
        });
      }
    } else {
      this.proposals = new Map();
      this.gridIdea = null;
    }

    const tiles = buildTiles(this.ordered(due), this.plugin.archiver.cache, this.unloadable);

    this.paintSidebar(tiles);
    this.paintHeader();
    // Applied here rather than only when something is toggled: grouping is
    // remembered between sessions, so the wall can arrive already grouped,
    // and the two views have different sizes. setDensity does nothing when
    // the size has not actually changed.
    this.grid?.setDensity(this.stage());
    // Grouping is for the inbox, and only while there is something in it.

    // The overlay shows one of these records too, and was painted from the
    // copy it had when it opened. A summary or a tag written since — by the
    // model, by a rule, by hand in the note — is on the wall behind it now;
    // hand the panel the fresh record so it says the same thing.
    if (this.detail?.isOpen) {
      const open = this.detail.currentId;
      const fresh = open ? tiles.find((tile) => tile.id === open) : undefined;
      if (fresh) this.detail.refreshMeta(fresh);
    }

    // Facets are counted from the whole grid, not from what survives the
    // filter: counting the result would make options disappear the moment
    // you used one, leaving no way back. For a smart grid the whole grid is
    // what its rules admitted, so its counts are counts within the rule.
    if (smart) {
      this.facets = space.rules ? smartMembers(tiles, space.rules, this.allDefs(tiles)) : tiles;
      this.folderTiles = [];
    } else {
      // A folder tile stands in for its members, so the wall is the loose
      // tiles plus the folders; inside a folder it is the members alone.
      const parts = partitionWall(tiles, this.plugin.settings.folders, this.folderGridKey());
      const open = this.openFolder
        ? parts.folders.find((f) => f.folder.name === this.openFolder)
        : undefined;
      if (this.openFolder && !open) {
        // Removed on another device, or renamed: the grid whole is the only
        // honest fallback, as home is for a grid that has gone.
        this.openFolder = null;
        this.spaceBar?.setFolder(null);
      }
      this.facets = open ? open.members : parts.loose;
      this.folderTiles = open ? [] : parts.folders;
    }
    this.applyFilter(options);
    this.flyToPending();
  }

  /**
   * Moves to a clipping made from this wall, once it has a tile to move to.
   *
   * Left until after the tiles are set, so the layout it needs is the one
   * just computed. A pending that finds no tile is kept rather than dropped:
   * the cover may still be resolving, and the next repaint is the one that
   * will have it.
   */
  /**
   * Says where a clipping went when it could not go where you were looking.
   *
   * Nothing is filed into a smart grid, so clipping while one is on screen
   * saves to home. Whether that is worth saying depends on what happens next:
   * a clipping the rules do admit turns up on this very wall and the detour is
   * invisible, which is why it is not mentioned. One they do not simply never
   * appears, and a clip that looks like it did nothing is the thing worth a
   * word.
   */
  private reportCaptureHome(path: string): void {
    const space = this.activeGrid();
    if (!isSmartGrid(space) || !space.rules) return;

    const home = this.plugin.settings.homeGridName;
    const record = this.plugin.index.records().find((entry) => entry.path === path);
    const [tile] = record ? buildTiles([record], this.plugin.archiver.cache) : [];

    // No tile yet means the cover is still resolving, so whether the rules
    // admit it cannot be judged. Where it went still can, and is the half of
    // the message that matters.
    if (!tile) {
      new Notice(`Goko: saved to ${home}`);
      return;
    }

    if (matchesFilter(tile, space.rules, this.allDefs(this.facets))) return;

    new Notice(
      `Goko: saved to ${home}. It does not match ${space.name}, so it is not on this wall.`
    );
  }

  private flyToPending(): void {
    const pending = this.pendingReveal;
    if (!pending) return;

    if (performance.now() > pending.until) {
      this.pendingReveal = null;
      return;
    }

    // A filter can hide what was just clipped. Nothing is cleared for it:
    // clipping something is not a request to undo the narrowing you set.
    if (!this.grid?.reveal(pending.path, { fit: false, select: false })) return;
    this.pendingReveal = null;
  }

  /**
   * The cheap half of a repaint: the grid's tiles are already built, so
   * narrowing them is a single pass.
   *
   * Toggling a filter changes nothing about the records, so re-sorting them,
   * re-filtering by grid and rebuilding every tile was three passes and a
   * heap of per-record allocation to answer a question that only concerned
   * which of the existing tiles to show.
   */
  private applyFilter(options: { replace?: boolean }): void {
    const filter = this.activeFilter();
    this.spaceBar?.setFilterCount(activeCount(filter));
    const defs = this.defs();
    const narrow = (tiles: TileModel[]): TileModel[] =>
      isFilterEmpty(filter) ? tiles : tiles.filter((tile) => matchesFilter(tile, filter, defs));
    const shown = narrow(this.facets);
    // A folder stays on a narrowed wall only while something in it matches,
    // and its collage shows the matches. An empty folder shows on a wall that
    // is not narrowed: it was just made, and has to be there to be filled.
    const folders = isFilterEmpty(filter)
      ? this.folderTiles
      : this.folderTiles
          .map((f) => ({ ...f, members: narrow(f.members) }))
          .filter((f) => f.members.length > 0);
    // No folder piles while grouped: the islands are the grouping, and a
    // pile standing in for five cards is five suggestions you cannot see.
    const grouped = this.isInbox() && this.plugin.settings.inboxGrouped;
    this.grid?.setFolders(grouped ? [] : folders);
    this.grid?.setTiles(shown, options);
    // Only a wall with nothing on it at all. One narrowed to nothing has a
    // filter to undo, and an inbox holding clippings back until their date
    // is not empty either; telling either to go and clip something would
    // be wrong about why it looks bare.
    this.emptyWall?.toggleClass(
      "is-showing",
      shown.length === 0 &&
        folders.length === 0 &&
        isFilterEmpty(filter) &&
        this.snoozedCount === 0
    );
    this.shownTiles = shown;
    this.grid?.setIslands(grouped ? this.islandModels(shown) : null);
    this.grid?.setSuggestions(this.isInbox() ? this.suggestionsFor(shown) : new Map());
    // Everywhere now, but not saying the same thing everywhere: the library
    // names the whole path, a board's own wall names only the folder, and on
    // that wall a card filed loose gets no chip at all.
    this.grid?.setPlaces(
      placesFor(
        shown.map((tile) => tile.record),
        this.plugin.settings.grids,
        this.plugin.settings.folders,
        this.homeGrid(),
        this.showAll ? "library" : "grid"
      )
    );

    // The panel is showing a copy of these records taken when the selection
    // was made, so it is handed the fresh ones for the reason the detail
    // overlay is: a summary or a tag written since — by the model, by a rule,
    // by hand in the note — is on the wall behind it now. After setTiles and
    // not before, or it would be given the wall as it was.
    this.inspector?.show(this.grid?.selectedTiles() ?? []);
    // The same list, so a filter narrows both and neither can drift.
  }

  /** The grid's tiles before filtering, which is what the facets count. */
  private facets: TileModel[] = [];
  /**
   * The tiles actually on the wall, after the filter.
   *
   * The islands are built from these rather than from the facets: a layout
   * that placed a card the filter had hidden would leave a hole in an island
   * where the wall has nothing to draw.
   */
  private shownTiles: TileModel[] = [];

  /**
   * The facets on offer, rebuilt from settings on each read. The list is four
   * or five items long, so caching it would cost more in staleness than it
   * saves; typedFacets samples the wall rather than reading all of it, so the
   * cost does not grow with the vault.
   *
   * Date.now() is read here rather than held, so a wall left open overnight
   * buckets against today when you next touch the filter.
   */
  private defs(): FacetDef[] {
    return typedFacets(
      facetDefs(this.look().filterProperties, this.gridRegistry()),
      this.facets,
      Date.now()
    );
  }

  /**
   * Defs for evaluating a smart grid's rules, typed against every tile rather
   * than against the grid's own.
   *
   * defs() samples this.facets, and for a smart grid this.facets is what the
   * rules produced, so using it here would ask the rules to be evaluated
   * against a typing that only exists once they have been. Circular, and it
   * fails quietly rather than loudly: a date property types as text, its
   * buckets stop matching, and the grid is subtly wrong instead of broken.
   */
  private allDefs(tiles: TileModel[]): FacetDef[] {
    return typedFacets(
      facetDefs(this.plugin.settings.filterProperties, this.gridRegistry()),
      tiles,
      Date.now()
    );
  }

  /** The session state the wall painted with, for the diagnostics command. */
  diagnosticState(): { grid: string; unloadable: Array<[string, string]>; filtered: boolean } {
    return {
      grid: this.activeGrid().name,
      unloadable: [...this.unloadable.entries()],
      filtered: !isFilterEmpty(this.activeFilter()),
    };
  }

  /** Pruned on the way out, so a property switched off in settings stops
      counting towards the badge instead of claiming a narrowing that
      matchesFilter is no longer applying. */
  private activeFilter(): FilterState {
    const pruned = pruneFilter(this.filter, this.defs());
    if (pruned !== this.filter) this.filter = pruned;
    return pruned;
  }

  private setFilter(next: FilterState): void {
    this.filter = next;
    // Straight to the narrowing pass; the tiles behind it have not changed.
    this.applyFilter({ replace: true });
    // Placed at the top, as a grid switch is. Left to relayout, the camera
    // kept the tile nearest the centre of the wall you were looking at and
    // followed it to wherever the new set put it, which after clearing a
    // filter meant somewhere far down the full wall. A narrowed or widened
    // wall is a different set of things, and it starts from the top.
    this.grid?.resetView(false);
  }

  private openFilter(x: number, y: number): void {
    const build = (): MenuItem[] => {
      const defs = this.defs();
      const available = facetsOf(this.facets, defs);
      const filter = this.activeFilter();

      const items: MenuItem[] = defs.map((def) => {
        const values = available[def.id] ?? [];
        const chosen = filter[def.id] ?? [];

        const row = (value: string, count: number): MenuItem => ({
          // No left icon at all, so the panel drops the gutter. A chosen value
          // marks itself where its count was: the count of a value you have
          // already picked is not what you are looking at the row for.
          icon: "",
          // A date facet's values are groups and comparisons rather than words
          // a clipping carries, so they are read back as words here. Any other
          // facet's value is already the word.
          label: valueLabel(def, value),
          // Absence is set apart from the values it is the absence of.
          divider: isEmptyValue(def, value),
          detail: String(count),
          detailIcon: chosen.includes(value) ? "check" : undefined,
          keepOpen: true,
          onSelect: () => this.setFilter(toggleFacet(this.activeFilter(), def.id, value)),
        });

        const submenu = values.map((entry) => row(entry.value, entry.count));

        if (def.shape === "date") {
          // A comparison is not a value any clipping reports, so it never
          // shows up in the tally and would have no row to switch it off with.
          for (const value of chosen) {
            if (!isDateToken(value) || values.some((entry) => entry.value === value)) continue;
            const hit = this.facets.filter((tile) =>
              matchesFilter(tile, { [def.id]: [value] }, defs)
            ).length;
            submenu.push(row(value, hit));
          }

          submenu.push({
            icon: "",
            label: "Custom…",
            alwaysShow: true,
            divider: true,
            onSelect: () => this.promptDateFilter(def),
          });
        }

        return {
          icon: def.icon,
          label: def.label,
          // Nothing to offer is still worth showing: an absent row reads as a
          // missing feature, a disabled one reads as an empty shelf.
          disabled: submenu.length === 0,
          detail: values.length === 0 ? "none" : chosen.length > 0 ? `${chosen.length}` : undefined,
          submenu,
        };
      });

      const active = activeCount(filter);
      items.push({
        icon: "circle-slash",
        label: "Clear filters",
        divider: true,
        disabled: active === 0,
        detail: active > 0 ? `${active} active` : undefined,
        keepOpen: true,
        onSelect: () => this.setFilter(emptyFilter()),
      });

      return items;
    };

    this.menu?.open(build(), x, y, build);
  }

  /**
   * A thumbnail for any clipping in the vault, tile or no tile.
   *
   * The palette searches every grid, so most results have no tile on this
   * wall to borrow from. Building one for the record is cheap: picking a
   * cover is a handful of map lookups, and it means the list shows the same
   * picture the wall would.
   */
  private previewUrl(path: string): string {
    const record = this.plugin.index.get(path);
    if (!record) return "";
    const [tile] = buildTiles([record], this.plugin.archiver.cache);
    const preview = tile ? previewOf(tile) : null;
    return preview ? resourceUrl(this.app.vault, preview.path, preview.remote) : "";
  }

  // ---- Palette -----------------------------------------------------------

  /**
   * The wall as the palette sees it, rebuilt on every keystroke so its rows
   * describe the selection, filter and grids as they stand rather than as
   * they were when it opened.
   */
  private paletteContext(): PaletteContext {
    const selection = this.grid?.selectedIds() ?? [];
    // Once, not twice: typing the facets walks a sample of the wall.
    const defs = this.defs();

    return {
      selection,
      grids: this.allGrids(),
      activeGrid: this.activeGrid().name,
      homeGrid: this.plugin.settings.homeGridName,
      folders: this.foldersHere(),
      canFile: this.canFile(),
      undoLabel: this.history.undoLabel,
      redoLabel: this.history.redoLabel,
      facetDefs: defs,
      facets: facetsOf(this.facets, defs),
      filter: this.activeFilter(),
      hasSystem: systemAvailable(),
      canGroup: this.isInbox(),
      grouped: this.plugin.settings.inboxGrouped,
      suggested: this.isInbox() ? selection.filter((id) => this.suggestionOf(id) !== null).length : 0,
      order: this.order,
      // Every row runs the method its context-menu equivalent runs. The two
      // surfaces list different things; neither reimplements the work.
      actions: {
        openNote: (id) => this.openNote(id),
        exportSelection: (ids) => void this.exportToDownloads(ids),
        reveal: (id) => this.revealFirstFile(id),
        move: (ids, grid) => void this.moveTo(ids, grid),
        remove: (ids) => this.confirmDelete(ids),
        switchGrid: (name) => this.activate(name),
        newGrid: () => this.promptNewGrid(),
        moveToFolder: (ids, folder) => void this.moveToFolder(ids, folder),
        newFolder: (seed) => this.promptNewFolder(seed),
        openFolder: (name) => this.enterFolder(name),
        undo: () => void this.undo(),
        redo: () => void this.redo(),
        editGrid: () => this.editActiveGrid(),
        deleteGrid: () => this.deleteActiveGrid(),
        manageGrids: () => this.manageGrids(),
        toggleFacet: (id, value) =>
          this.setFilter(toggleFacet(this.activeFilter(), id, value)),
        clearFilters: () => this.setFilter(emptyFilter()),
        clip: () => void this.plugin.clipFromClipboard(),
        archiveAll: () => this.plugin.archiveAllMedia(),
        selectAll: () => this.grid?.selectAll(),
        scrollToTop: () => this.grid?.resetView(),
        shuffle: () => this.shuffle(),
        newestFirst: () => this.setOrder("newest"),
        groupInbox: () => this.toggleGrouping(),
        fileSuggested: (ids) => void this.fileSelectionAsSuggested(ids),
        recentlyUpdated: () => this.setOrder("updated"),
        applyRules: () => void this.plugin.applyDomainRules(),
        describe: (ids) => this.plugin.vision.describe(ids, true),
        describeAll: () => this.plugin.vision.describeUndescribed(),
        readPdfs: () => void this.plugin.readEveryPdf(),
      },
    };
  }

  /**
   * The records in the order the wall is set to. Newest is what the index
   * already hands back, so it does no work of its own.
   */
  private ordered(records: ClippingRecord[]): ClippingRecord[] {
    if (this.order === "shuffled") return shuffleRecords(records, this.shuffleSeed);
    if (this.order === "updated") return byUpdated(records);
    return records;
  }

  /** A fresh order every time: asking to shuffle a shuffled wall means again. */
  private shuffle(): void {
    this.shuffleSeed = (Date.now() ^ (this.shuffleSeed * 2654435761)) >>> 0 || 1;
    this.setOrder("shuffled");
  }

  private setOrder(order: WallOrder): void {
    // Always repaint, even for shuffled → shuffled: the seed just changed.
    this.order = order;
    this.refresh({ replace: true });
  }

  /**
   * Lands on a clipping the palette found, wherever it lives: switch grid
   * first if it is on another wall, then centre and select the tile.
   *
   * A filter can hide the very thing that was just searched for. Dropping it
   * is the right answer there, because asking for a clipping by name is a
   * more specific instruction than the narrowing that was left on earlier.
   * With no tile at all (nothing renderable in the note) the note itself is
   * the only place left to go.
   */
  private revealClipping(path: string): void {
    const record = this.plugin.index.get(path);
    if (!record) return;

    const grid = effectiveGrid(record, this.plugin.settings.homeGridName, this.registered());
    this.activate(grid);
    if (this.grid?.reveal(path)) return;

    if (!isFilterEmpty(this.activeFilter())) {
      this.setFilter(emptyFilter());
      if (this.grid?.reveal(path)) {
        new Notice("Goko: filter cleared to show that clipping");
        return;
      }
    }

    new Notice("Goko: nothing to show on the wall, opening the note");
    this.openNote(path);
  }

  // ---- Grids -------------------------------------------------------------

  private homeGrid(): GridSpace {
    return {
      name: this.plugin.settings.homeGridName,
      icon: this.plugin.settings.homeGridIcon,
    };
  }

  /** What the grid facet needs to tell a filed card from an orphaned one. */
  private gridRegistry(): {
    grids: ReadonlySet<string>;
    home: string;
    folders: ReadonlySet<string>;
  } {
    return {
      grids: this.registered(),
      home: this.plugin.settings.homeGridName,
      // The folders of the grid on screen, since a folder belongs to one grid
      // and the facet is about what is in front of you.
      folders: new Set(this.foldersHere().map((folder) => folder.name)),
    };
  }

  private registered(): Set<string> {
    return new Set(this.plugin.settings.grids.map((grid) => grid.name));
  }

  private allGrids(): GridSpace[] {
    return orderedGrids(this.homeGrid(), this.plugin.settings.grids);
  }

  /** Falls back to home, so a stale saved name cannot leave the wall empty. */
  private activeGrid(): GridSpace {
    const name = this.plugin.settings.activeGrid;
    return this.allGrids().find((grid) => grid.name === name) ?? this.homeGrid();
  }

  private activate(name: string): void {
    this.showAll = false;
    if (this.plugin.settings.activeGrid === name) return;
    this.plugin.settings.activeGrid = name;

    // Selection, filter and camera all describe tiles that are about to be
    // replaced, so none of them carries over.
    this.grid?.clearSelection();
    this.filter = emptyFilter();
    this.openFolder = null;
    this.spaceBar?.setFolder(null);
    // Before the repaint, so the arriving wall is laid out to the grid's own
    // density rather than to the last one's and reflowed a frame later.
    this.applyLook();
    // replace, not add: departing tiles go straight back to the pool so the
    // arrivals can recycle them, and the camera is placed rather than tweened.
    // The arrivals still pop.
    this.refresh({ replace: true });
    this.grid?.resetView(false);
    this.spaceBar?.setActive(this.activeGrid());

    // Persisting which grid you are in is a disk write. Awaiting it before
    // repainting put a file system round trip in front of every switch, which
    // is most of what the first switch felt like.
    void this.plugin.saveSettings();
  }

  /**
   * The only place the plugin writes to a note it did not create, and it
   * writes exactly one key. processFrontMatter rewrites the frontmatter block
   * alone, so the clipped body is never touched.
   */
  /**
   * Writes one property of one clipping.
   *
   * Guarded by isEditable rather than trusted: the caller is UI, and the keys
   * the Web Clipper owns are a contract this plugin does not get to break.
   * Refusing here means a future caller cannot widen the licence by accident.
   *
   * `updated` is bumped alongside, because the vault's clipping rules list it among
   * the properties parsing maintains and every other tool there keeps it
   * current.
   */
  /**
   * One property across a selection, from what they held to what they hold
   * now, recorded so ⌘Z puts the old values back. Recorded before the writes
   * and the writes are not waited on, as the menus that call this expect.
   */
  private writeProperty(
    paths: string[],
    key: string,
    before: string[][],
    next: string[][],
    record = true
  ): void {
    paths.forEach((path, index) => {
      this.edited.set(this.editKey(path, key), next[index]);
      void this.setProperty(path, key, next[index]);
    });
    if (!record) return;
    const was = before.map((values) => [...values]);
    const now = next.map((values) => [...values]);
    this.history.push({
      label: `Edit ${key}`,
      undo: async () => this.writeProperty(paths, key, now, was, false),
      redo: async () => this.writeProperty(paths, key, was, now, false),
    });
  }

  /** The cover a clipping was given by hand, or "" for none. */
  private coverOf(path: string): string {
    return this.plugin.index.get(path)?.cover ?? "";
  }

  /**
   * The picture a clipping shows, chosen by hand.
   *
   * Its own door rather than writeProperty's, for the same reason `grid` has
   * one in assign: `cover` is a pointer at a file, not a value picked from a
   * list, and isEditable refuses it precisely so the property menus cannot
   * offer it as one. What arrives here is a vault path or a URL a caller has
   * already made or found.
   *
   * Into `cover:` rather than into the note's body, because `cover:` is the
   * first thing pickCover looks at: a picture chosen by hand beats anything
   * the page offered, and it cannot be lost later to an archiver that
   * re-fetches the page's own preview.
   *
   * The wall is not rebuilt from here; the vault's modify event reaches the
   * index by the path every other edit uses, and the tile repaints because
   * its signature changed.
   */
  private async setCover(path: string, value: string, record = true): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) return false;
    const before = this.coverOf(path);
    if (before === value) return true;

    try {
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        if (value) fm.cover = value;
        else delete fm.cover;
        fm.updated = todayISO();
      });
    } catch (error) {
      new Notice(`Goko: could not set the cover (${String(error)})`);
      return false;
    }

    if (record) {
      this.history.push({
        label: value ? "Set cover" : "Clear cover",
        undo: async () => void (await this.setCover(path, before, false)),
        redo: async () => void (await this.setCover(path, value, false)),
      });
    }

    // Read back at once rather than waiting for the vault's own modify
    // event: the repaint below needs the record to already carry the cover
    // that was just written, and that event arrives a tick later.
    await this.plugin.index.handleModify(file);

    // The wall is asked for this one card rather than left to that event's
    // refresh. The refresh does come, but it is held back while anything is
    // selected — and every way of setting a cover except the drop acts on a
    // selected card, so the picture appeared only once you clicked the wall
    // to deselect it.
    this.repaintTile(path);
    return true;
  }

  /**
   * Rebuilds one card from the record as it stands now and puts it on the
   * wall, leaving the filter, the order and the selection exactly as they
   * are. The index has the new frontmatter by the time this runs: the write
   * above went through the vault, and the record is re-read from it.
   */
  private repaintTile(path: string): void {
    const record = this.plugin.index.get(path);
    if (!record) return;
    const [model] = buildTiles([record], this.plugin.archiver.cache);
    if (model) this.grid?.replaceTile(path, model);
  }

  /**
   * A picture given to a clipping by hand: into the vault first, then
   * pointed at from the note.
   *
   * The same attachments folder and the same pasted- prefix every other
   * picture the plugin writes goes to, so sweep.ts can still prove it made
   * the file and clean it up when the clipping goes.
   *
   * A picture the wall paints only through a preview — a HEIC, which is
   * every photo an iPhone takes — has it made before the cover is written,
   * so the card repaints once, with the picture. When this device cannot
   * make one, "cover set" would be a card that did not change, and it is
   * told so instead.
   */
  private async setCoverFrom(path: string, blob: Blob): Promise<void> {
    if (!kindForMime(blob.type)) {
      new Notice("Goko: that is not a picture or a video");
      return;
    }
    const attachment = await this.plugin.capture.saveAttachment(blob);
    if (!attachment) return;
    const outcome = await this.plugin.archiver.previewFile(attachment);
    if (!(await this.setCover(path, attachment))) return;
    const unshown = previewNotice(attachment, outcome);
    if (unshown) new Notice(unshown, 8000);
    else new Notice("Goko: cover set");
  }

  /**
   * Asks the system for a file to use as the cover.
   *
   * The only one of the three ways in that a phone has: there is no
   * right-click to drag from and no second window to copy a picture out of,
   * so on a phone this row is the feature.
   *
   * The input is put in the document and taken out again: a detached one
   * opens the picker in Chromium but not reliably in a webview, and this
   * runs in both.
   */
  private chooseCover(path: string): void {
    const input = this.contentEl.createEl("input", { type: "file", cls: "pg-file-input" });
    input.accept = "image/*,video/*";
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0];
        input.remove();
        if (file) void this.setCoverFrom(path, file);
      },
      { once: true }
    );
    // A cancelled picker fires nothing in older engines, so the element is
    // also dropped when focus comes back to the window.
    window.addEventListener("focus", () => window.setTimeout(() => input.remove(), 2000), {
      once: true,
    });
    input.click();
  }

  private async setProperty(path: string, key: string, values: string[]): Promise<void> {
    if (!isEditable(key, this.editPolicy())) {
      new Notice(`Goko: ${key} belongs to the clipper and is not editable`);
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) return;

    try {
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        // An emptied property is removed rather than written as an empty
        // list, so the note reads the way one that never had the key reads.
        if (values.length === 0) delete fm[key];
        else if (values.length === 1 && !Array.isArray(fm[key])) fm[key] = values[0];
        else fm[key] = values;
        fm.updated = todayISO();
      });
      // The tile's pills say what the note says, so they are redrawn the
      // moment the note says something else. Here rather than in the caller,
      // so a key the gate above refused, or a write that threw, never paints
      // a value the note does not have. The tile id is the note's path.
      this.grid?.setRecordProperty(path, key, values);
    } catch (error) {
      new Notice(`Goko: could not update ${key} (${String(error)})`);
      // The menu is showing a value the note does not have. Drop it so the
      // next rebuild tells the truth.
      this.edited.delete(this.editKey(path, key));
    }
    // The wall is not rebuilt from here. The vault's own modify event reaches
    // the index and the wall by the path every other edit uses, and forcing
    // it rebuilt the whole grid on every tick. Redrawing the one tile's pills
    // above is not that: no filter re-runs and nothing moves.
  }

  /**
   * The rows for editing one property of one clipping.
   *
   * Values come from the wall rather than from a fixed vocabulary, so the
   * menu offers what the vault already uses and spelling stays consistent
   * without anything having to enforce it.
   */
  private editKey(path: string, key: string): string {
    return `${path}\u0000${key}`;
  }

  /** What the menu should show as set: this session's edit if there is one,
      otherwise what the note actually says. */
  private heldValues(path: string, key: string): string[] {
    return (
      this.edited.get(this.editKey(path, key)) ??
      this.plugin.index.get(path)?.properties[key] ??
      []
    );
  }

  private vocabularyFor(key: string, holdings: string[][]): PropertyVocabulary {
    const cached = this.vocabularies.get(key);
    if (cached) return cached;
    const wall = propertyVocabulary(this.facets, key);
    // Held-first, decided here and then frozen with the rest of the order.
    // Re-deciding it per rebuild would send a row to the top of the list the
    // instant you ticked it, which is the reordering under the pointer this
    // cache exists to prevent.
    const fresh = { ...wall, values: heldFirst(wall.values, holdings) };
    this.vocabularies.set(key, fresh);
    return fresh;
  }

  private propertyMenu(paths: string[], key: string): MenuItem[] {
    const holdings = paths.map((path) => this.heldValues(path, key));
    // Folded in on every build rather than into the cache, so a value created
    // one row up has a row of its own on the rebuild that follows. The cache
    // holds the wall's vocabulary, which cannot know about it yet: the note is
    // still being written, and the refresh that would rescan it is held down
    // while this menu is up.
    const { values, single } = withHeldValues(this.vocabularyFor(key, holdings), holdings);

    // Recorded before the writes, and the writes are not waited on. The menu
    // rebuilds from the record on the same tick as the click; the notes
    // catch up on their own, one processFrontMatter each.
    const write = (next: string[][]): void => this.writeProperty(paths, key, holdings, next);

    const rows: MenuItem[] = values.map((entry) => {
      const holding = holdingAcross(holdings, entry.value);
      return {
        icon: "",
        label: entry.value,
        detail: String(entry.count),
        // A dash for "some of these": not a tick, since it is not set
        // everywhere, and not blank, since it is not absent either.
        detailIcon: holding === "all" ? "check" : holding === "some" ? "minus" : undefined,
        keepOpen: true,
        onSelect: () => write(toggleAcross(holdings, entry.value, single)),
      };
    });

    // Never offered against a value that is already on the list: that row is
    // sitting one line up, and creating it again would create nothing. Matches
    // how the sheet's own Create row decides.
    const known = (typed: string): boolean =>
      values.some((entry) => entry.value === typed);

    rows.push({
      // No icon, or this one row would reserve the gutter for the whole
      // panel: the panel drops it only when nothing in it has one. The rule
      // above already separates this row from the values.
      icon: "",
      label: "New value…",
      // Names what was typed, so a search that found nothing reads as an offer
      // to make it rather than as a dead end beside the word "No matches".
      labelFor: (typed) => {
        const wanted = typed.trim();
        return wanted && !known(wanted) ? `Create “${wanted}”` : "New value…";
      },
      // Survives typing, so a search that finds nothing still offers to add
      // what was typed rather than leaving a dead end.
      alwaysShow: true,
      // Stays up like the value rows, so the tick it just set can be seen. The
      // branch that hands off to the sheet closes the menu itself.
      keepOpen: true,
      clearsQuery: true,
      divider: rows.length > 0,
      onSelect: (typed) => {
        const wanted = typed.trim();
        // Nothing typed, or typed something that already exists: there is no
        // value to create here, so the fuller prompt takes over.
        if (!wanted || known(wanted)) {
          this.menu?.close();
          this.promptPropertyValue(paths, key, single, holdings);
          return;
        }

        // A new value is held by nothing yet, so this is always an add.
        write(toggleAcross(holdings, wanted, single));
      },
    });

    return rows;
  }

  /** Picks an operator, then a date, and adds the comparison as a value. */
  private promptDateFilter(def: FacetDef): void {
    const sheet = this.sheet;
    if (!sheet) return;

    const askDate = (op: "before" | "since", label: string): void => {
      sheet.push({
        title: label,
        placeholder: "yyyy-mm-dd",
        value: todayISO(),
        filters: false,
        hints: [
          ["\u21b5", "apply"],
          ["esc", "back"],
        ],
        rows: () => [],
        onSubmit: (typed) => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(typed)) {
            new Notice("Goko: a date reads yyyy-mm-dd");
            return;
          }
          sheet.close();
          this.setFilter(toggleFacet(this.activeFilter(), def.id, `${op}:${typed}`));
        },
      });
    };

    sheet.open({
      title: def.label,
      placeholder: "Search…",
      filters: true,
      hints: [
        ["\u2191\u2193", "navigate"],
        ["\u21b5", "select"],
        ["esc", "close"],
      ],
      rows: () => [
        {
          label: "Before",
          icon: "chevron-left",
          onChoose: () => askDate("before", "Before"),
        },
        {
          label: "On or after",
          icon: "chevron-right",
          onChoose: () => askDate("since", "On or after"),
        },
      ],
    });
  }

  private promptPropertyValue(
    paths: string[],
    key: string,
    single: boolean,
    holdings: string[][]
  ): void {
    const options = heldFirst(propertyVocabulary(this.facets, key).values, holdings);

    const apply = (value: string): void => {
      this.sheet?.close();
      // Chosen from a list of what to add, so it is an add for every clipping
      // in the selection, including any that already hold it.
      const next = holdings.map((held) => (single ? [value] : withValue(held, value)));
      this.writeProperty(paths, key, holdings, next);
    };

    const mark = (value: string): string | undefined => {
      const holding = holdingAcross(holdings, value);
      return holding === "all" ? "check" : holding === "some" ? "minus" : undefined;
    };

    this.sheet?.open({
      title: facetLabel(key),
      placeholder: `Add to ${facetLabel(key).toLowerCase()}…`,
      filters: true,
      hints: [
        ["↑↓", "navigate"],
        ["↵", "select"],
        ["esc", "close"],
      ],
      rows: (query) => {
        const rows: SheetRow[] = options.map((entry) => ({
          label: entry.value,
          detail: String(entry.count),
          detailIcon: mark(entry.value),
          onChoose: () => apply(entry.value),
        }));

        // Offered only when it is not already there, so the list never shows
        // Create beside the very value it would duplicate.
        const typed = query.trim();
        if (typed && !options.some((entry) => entry.value === typed)) {
          rows.push({
            label: `Create “${typed}”`,
            icon: "plus",
            alwaysShow: true,
            onChoose: () => apply(typed),
          });
        }
        return rows;
      },
    });
  }

  /**
   * Files clippings onto a grid, and into a folder on it when one is named.
   *
   * The two keys are written in one call so they can never disagree after a
   * move: a folder belongs to one grid, and moving to a grid without naming
   * a folder takes the clipping out of whichever folder it was in.
   */
  private async assign(paths: string[], target: string, folder = ""): Promise<MoveResult> {
    return this.plugin.placement.move(paths, target, folder);
  }

  /** Whether the vault's folder tree is what says where a clipping is filed. */
  private get byFolders(): boolean {
    return this.plugin.placement.byFolders;
  }

  /**
   * The rail, redrawn for the wall as it now stands.
   *
   * Given the tiles the paint just built, so a smart view's count is the same
   * number the wall would show for it rather than a second reckoning of the
   * same rules.
   */
  private paintSidebar(tiles: TileModel[]): void {
    if (!this.sidebar) return;
    const model = sidebarModel({
      records: this.plugin.index.records(),
      grids: this.plugin.settings.grids,
      folders: this.plugin.settings.folders,
      home: this.homeGrid(),
      tiles,
      defs: this.allDefs(tiles),
    });
    this.sidebar.paint(model, this.activeGrid().name, this.openFolder, this.showAll);
  }

  /**
   * Has the tab and the view's header say getDisplayText again, when the
   * place it names has changed. Neither hook is in the API's typings:
   * updateHeader is how a leaf redraws its tab, and titleEl is the header's
   * own title, which that redraw leaves as it was. Where either is missing,
   * that title catches up the next time Obsidian draws it.
   */
  private paintHeader(): void {
    const title = this.getDisplayText();
    if (title === this.shownTitle) return;
    this.shownTitle = title;
    (this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.();
    (this as { titleEl?: HTMLElement }).titleEl?.setText(title);
  }

  /**
   * What an `@` or `#` token in the search field can name.
   *
   * Grids first, then the folders under them so a folder reads as belonging
   * to one, then every tag value the vault holds. Home is offered too: "the
   * things I have not filed" is as much a scope as any board.
   */
  private narrowTargets(): NarrowTarget[] {
    const settings = this.plugin.settings;
    const out: NarrowTarget[] = [
      {
        kind: "grid",
        value: settings.homeGridName,
        label: settings.homeGridName,
        icon: settings.homeGridIcon,
      },
    ];
    const foldersOf = (key: string, gridName: string, color?: string): void => {
      for (const folder of settings.folders) {
        if (folder.grid !== key) continue;
        out.push({
          kind: "folder",
          value: folder.name,
          grid: gridName,
          label: `${gridName} / ${folder.name}`,
          icon: folder.icon,
          color,
        });
      }
    };
    for (const grid of settings.grids) {
      out.push({
        kind: "grid",
        value: grid.name,
        label: grid.name,
        icon: grid.icon,
        color: gridColorVar(grid.color),
      });
      foldersOf(grid.name, grid.name, gridColorVar(grid.color));
    }
    // A folder on home carries the empty key, as `grid:` does.
    foldersOf("", settings.homeGridName);

    const tags = new Set<string>();
    for (const record of this.plugin.index.records()) {
      for (const key of TAG_PROPERTIES) {
        for (const value of record.properties[key] ?? []) {
          const clean = value.trim();
          if (clean) tags.add(clean);
        }
      }
    }
    for (const tag of [...tags].sort((a, b) => a.localeCompare(b))) {
      out.push({ kind: "tag", value: tag, label: tag });
    }
    return out;
  }

  /**
   * Every clipping in the vault, whichever grid it is filed on.
   *
   * Home was this until a grid became a folder, and then the clippings
   * folder became the inbox: "show me everything" needs its own way in.
   * Filing is off while it is showing — a card dropped here has nowhere to
   * land, since the wall is not a place.
   */
  private showLibrary(): void {
    if (this.showAll) return;
    this.showAll = true;
    this.grid?.clearSelection();
    this.filter = emptyFilter();
    this.openFolder = null;
    this.spaceBar?.setFolder(null);
    this.refresh({ replace: true });
    this.grid?.resetView(false);
  }

  private toggleSidebar(): void {
    if (!this.sidebar) return;
    const hidden = !this.sidebar.isHidden;
    this.sidebar.setHidden(hidden);
    this.plugin.settings.sidebarHidden = hidden;
    void this.plugin.saveSettings();
  }

  private toggleInspector(): void {
    if (!this.inspector) return;
    const hidden = !this.inspector.isHidden;
    this.inspector.setHidden(hidden);
    this.plugin.settings.inspectorHidden = hidden;
    void this.plugin.saveSettings();
  }

  /**
   * What a clipping's archived media weighs, or zero when it is still
   * someone else's URL. Keyed by file first: a note that names the file it
   * was archived to is the common case, and the URL key only answers for one
   * the archiver has not been round to yet.
   */
  private bytesOf(model: TileModel): number {
    const cache = this.plugin.archiver.cache;
    const entry = cache.byFile(model.filePath) ?? cache.get(model.filePath);
    return entry?.bytes ?? 0;
  }

  /**
   * A grid's own menu, from a right click on its row in the rail: name and
   * icon, colour, description, order, delete. The manager's list of actions
   * for that grid, opened where the grid is rather than in another corner.
   */
  private manageGrid(name: string): void {
    if (!this.sheet) return;
    const grid = this.plugin.settings.grids.find((entry) => entry.name === name);
    if (!grid) return;
    openGridActions(this.sheet, this.gridsController(), grid, () => this.refresh());
  }

  /**
   * Asks which grid a shared clip goes to, then files it there.
   *
   * Home and the manual grids only: a smart grid cannot be filed into
   * (fileableGrid), so offering it would be a row that lands somewhere else.
   * Dismissing the menu files to home rather than dropping the share: the
   * link was sent here to be kept, and a tap away is not a change of mind
   * about that.
   */
  pickGridAndClip(url: string): void {
    const home = this.plugin.settings.homeGridName;
    const { manual } = groupedGrids(this.allGrids());
    const items: MenuItem[] = manual.map((placed, index) => ({
      icon: placed.grid.icon,
      label: placed.grid.name,
      heading: index === 0 ? "Clip to" : undefined,
      onSelect: () => {
        const target = placed.grid.name === home ? "" : placed.grid.name;
        void this.plugin.capture.capture(url, target);
      },
    }));
    const anchor = this.spaceBar?.switcherAnchor() ?? { x: 0, y: 0 };
    this.menu?.open(items, anchor.x, anchor.y, undefined, false, () => {
      new Notice(`Goko: saved to ${home}`);
      void this.plugin.capture.capture(url, "");
    });
  }

  /** Where the active grid sits in settings.grids, or -1 for home. */
  private activeGridIndex(): number {
    const active = this.activeGrid().name;
    return this.plugin.settings.grids.findIndex((grid) => grid.name === active);
  }

  private editActiveGrid(): void {
    if (!this.sheet) return;
    const index = this.activeGridIndex();
    // Not closed first: openGridEditor opens the sheet itself when none is up,
    // and Sheet.open closes whatever was. Closing here left the editor pushing
    // onto a sheet that no longer existed, which push declines to do.
    openGridEditor(
      this.sheet,
      this.gridsController(),
      this.activeGrid(),
      index === -1 ? undefined : index,
      () => this.refresh()
    );
  }

  private deleteActiveGrid(): void {
    if (!this.sheet) return;
    const index = this.activeGridIndex();
    // Home is where an unknown grid falls back to, so it always has to exist.
    if (index === -1) return;
    // Straight to the question about this grid. It used to open the manager
    // and stop there, leaving you on a list of every grid with nothing chosen,
    // which is not what a row saying Delete grid promises.
    openDeleteGrid(this.sheet, this.gridsController(), this.activeGrid(), index, () =>
      this.refresh()
    );
  }

  private manageGrids(): void {
    if (!this.sheet) return;
    openGridsManager(this.sheet, this.gridsController(), () => this.refresh());
  }

  /**
   * Settings for the pane and the grid on screen, with the whole set one step
   * further in. Rebuilt on each tick because the tile size rows are keepOpen,
   * and the check has to move as you step through them.
   */
  private openSettings(x: number, y: number): void {
    this.menu?.open(this.settingsItems(), x, y, () => this.settingsItems());
  }

  private settingsItems(): MenuItem[] {
    const active = this.activeGrid();
    const isHome = this.activeGridIndex() === -1;
    const look = this.look();
    const perGrid = this.plugin.settings.gridLookScope === "grid";
    const own = perGrid ? this.lookOf(active) : undefined;
    const sizedHere = perGrid && this.plugin.settings.gridTileSizes[this.gridKey()] !== undefined;

    return [
      {
        icon: "layout-dashboard",
        label: "Tile size",
        // The grid's name captions the group, once, rather than every row
        // repeating whose settings these are.
        heading: perGrid ? active.name : undefined,
        detail: this.isGrouped()
          ? stageLabel(this.stage())
          : this.mark(stageLabel(look.tileSize), sizedHere),
        submenu: this.tileSizeItems(),
      },
      // Always, whatever the scope. These four were shown only while each
      // grid kept its own look, on the reasoning that otherwise they are not
      // about this grid — but they are about the wall in front of you either
      // way, and the button that opens this menu is the only one near it.
      // Hidden, the way to stop every video on the wall playing at once was
      // two levels into the plugin's settings, which is where it was looked
      // for and not found. setLookKey already writes to the right place.
      ...this.gridLookItems(look, own),
      {
        icon: "pencil",
        label: "Edit grid",
        divider: true,
        detail: active.name,
        onSelect: () => this.editActiveGrid(),
      },
      {
        icon: "folder-input",
        label: "Make it a folder",
        // Home and views cannot be folders; see demotionRefusal. Shown and
        // inert for them, as Delete grid is, so the menu keeps its shape.
        disabled: isHome || isSmartGrid(active) || this.demoteTargetRows(active.name).length === 0,
        submenu: isHome || isSmartGrid(active) ? undefined : this.demoteTargetRows(active.name),
      },
      {
        icon: "trash-2",
        label: "Delete grid",
        // Shown rather than hidden, so the row does not appear and vanish
        // depending on where you are.
        detail: isHome ? "Home grid" : undefined,
        disabled: isHome,
        destructive: !isHome,
        onSelect: () => this.deleteActiveGrid(),
      },
      {
        icon: "layers",
        label: "Manage grids",
        divider: true,
        detail: `${this.allGrids().length} grids`,
        onSelect: () => this.manageGrids(),
      },
      // What the pane shows. These were buttons on the bar until the bar
      // became two toolbars with four errands between them; they are settings
      // consulted now and then, not errands, and a menu is where those live.
      ...(this.isInbox() && this.shownTiles.length > 0
        ? [
            {
              icon: "list-checks",
              label: "Group by suggestion",
              heading: "View",
              detailIcon: this.plugin.settings.inboxGrouped ? "check" : undefined,
              onSelect: () => this.toggleGrouping(),
            } as MenuItem,
          ]
        : []),
      {
        icon: "panel-left",
        label: "Grids rail",
        heading: this.isInbox() && this.shownTiles.length > 0 ? undefined : "View",
        detailIcon: this.sidebar && !this.sidebar.isHidden ? "check" : undefined,
        onSelect: () => this.toggleSidebar(),
      },
      {
        icon: "panel-right",
        label: "Details panel",
        detailIcon: this.inspector && !this.inspector.isHidden ? "check" : undefined,
        onSelect: () => this.toggleInspector(),
      },
      // The wall as a whole. These lived only in the palette, which is to say
      // behind a chord; a button that opens this menu is on every device.
      {
        icon: "shuffle",
        label: this.order === "shuffled" ? "Shuffle again" : "Shuffle",
        // The caption is the separator: a rule as well would be two of them.
        heading: "Order",
        detailIcon: this.order === "shuffled" ? "check" : undefined,
        onSelect: () => this.shuffle(),
      },
      {
        icon: "history",
        label: "Recently updated",
        detailIcon: this.order === "updated" ? "check" : undefined,
        onSelect: () => this.setOrder("updated"),
      },
      {
        icon: "arrow-down-wide-narrow",
        label: "Newest first",
        detailIcon: this.order === "newest" ? "check" : undefined,
        // Not disabled when already newest: three rows that are one choice
        // read as a choice, and a greyed row in the middle of them reads as
        // an order that is unavailable rather than one you are already in.
        onSelect: () => this.setOrder("newest"),
      },
      // Only when there is something being held back. A row that says
      // "0 waiting" is a row that teaches you to ignore this menu.
      ...(this.snoozedCount > 0
        ? [
            {
              icon: "clock",
              label: "Show snoozed",
              heading: "Inbox" as const,
              detail: `${this.snoozedCount} waiting`,
              detailIcon: this.showSnoozed ? "check" : undefined,
              onSelect: () => {
                this.showSnoozed = !this.showSnoozed;
                this.refresh({ replace: true });
              },
            },
          ]
        : []),
      {
        icon: "wand-sparkles",
        label: "Apply domain rules to all",
        divider: true,
        onSelect: () => void this.plugin.applyDomainRules(),
      },
      {
        icon: "sparkles",
        label: "Describe all undescribed with AI",
        onSelect: () => this.plugin.vision.describeUndescribed(),
      },
    ];
  }

  /**
   * Two steppers, then the stages by name with the current one ticked. The
   * steppers are for a pane you are squeezing down a stage at a time while
   * watching it; the names are for going straight to the one you want. Every
   * row keeps the menu open, since one press is rarely the last.
   */
  /**
   * The rest of the look, shown only while each grid keeps its own.
   *
   * On All grids these stay in the settings tab: there is one answer there
   * and putting it on every wall's menu as well would be two doors onto one
   * value. Per grid the wall is where the answer belongs, because the answer
   * is about the wall you are looking at.
   */
  private gridLookItems(look: ResolvedLook, own: GridLook | undefined): MenuItem[] {
    return [
      {
        icon: "tag",
        // No longer a corner: the tags and the name are one block now, and
        // the corner this used to name belongs to the reel's dots.
        label: "Tile tags",
        detail: this.slotLabel(look.tileProperty, own?.tileProperty !== undefined),
        submenu: this.slotItems(
          "tileProperty",
          look.tileProperty,
          own?.tileProperty !== undefined
        ),
      },
      {
        icon: "sliders-horizontal",
        label: "Filter properties",
        detail: this.mark(String(look.filterProperties.length), own?.filterProperties !== undefined),
        submenu: this.filterPropertyItems(look, own),
      },
      {
        icon: "play",
        label: "Autoplay videos",
        // A submenu rather than a row that flips, so this one has the same
        // way back to All grids the other three have.
        detail: this.mark(look.autoplayVideo ? "On" : "Off", own?.autoplayVideo !== undefined),
        submenu: [
          {
            icon: "",
            label: "On",
            detailIcon: look.autoplayVideo ? "check" : undefined,
            onSelect: () => void this.setLookKey("autoplayVideo", true),
          },
          {
            icon: "",
            label: "Off",
            detailIcon: look.autoplayVideo ? undefined : "check",
            onSelect: () => void this.setLookKey("autoplayVideo", false),
          },
          ...this.inheritRow("autoplayVideo", own?.autoplayVideo !== undefined),
        ],
      },
    ];
  }

  private slotLabel(value: string, overridden: boolean): string {
    return this.mark(value ? facetLabel(value) : "None", overridden);
  }

  /**
   * Marks a value this grid set for itself, so the menu answers whose answer
   * it is showing without being opened. Nothing is marked while the switch
   * is on All grids: there is only one answer to show.
   */
  private mark(value: string, overridden: boolean): string {
    return overridden ? `${value} \u00b7 this grid` : value;
  }

  /** The properties a tile's tags can be drawn from, the one in force ticked,
      and the way back to the shared setting when this grid has set its own. */
  private slotItems(
    key: "tileProperty",
    current: string,
    overridden: boolean
  ): MenuItem[] {
    const keys = slotCandidates(this.plugin.index.records(), false, current);
    const rows: MenuItem[] = [
      {
        icon: "",
        label: "None",
        detailIcon: current === "" ? "check" : undefined,
        onSelect: () => void this.setLookKey(key, ""),
      },
      ...keys.map((candidate, i) => ({
        icon: "",
        label: facetLabel(candidate),
        detailIcon: candidate === current ? "check" : undefined,
        divider: i === 0,
        onSelect: () => void this.setLookKey(key, candidate),
      })),
    ];
    return [...rows, ...this.inheritRow(key, overridden)];
  }

  /** The filter facets this grid offers, each a toggle. */
  private filterPropertyItems(look: ResolvedLook, own: GridLook | undefined): MenuItem[] {
    const enabled = look.filterProperties;
    const candidates = [
      ...enabled,
      ...surveyProperties(this.plugin.index.records())
        .filter((stat) => stat.suggested && !enabled.includes(stat.key))
        .map((stat) => stat.key),
    ];

    return [
      ...candidates.map((key) => ({
        icon: "",
        label: facetLabel(key),
        detailIcon: enabled.includes(key) ? "check" : undefined,
        keepOpen: true,
        onSelect: () =>
          void this.setLookKey(
            "filterProperties",
            enabled.includes(key) ? enabled.filter((k) => k !== key) : [...enabled, key]
          ),
      })),
      ...this.inheritRow("filterProperties", own?.filterProperties !== undefined),
    ];
  }

  /**
   * The way back, on a submenu whose grid has set a value of its own. Named
   * for the switch's other setting, so the two read as the pair they are.
   * Shown and inert otherwise, so the row does not come and go as you touch
   * the thing above it.
   */
  private inheritRow(key: keyof GridLook, overridden: boolean): MenuItem[] {
    // There is nothing to fall back to while every grid shares one value, and
    // a row that can only ever be greyed out is furniture rather than a
    // choice.
    if (this.plugin.settings.gridLookScope !== "grid") return [];
    return [
      {
        icon: "undo-2",
        label: "Follow all grids",
        divider: true,
        disabled: !overridden,
        onSelect: () => void this.clearLookKey(key),
      },
    ];
  }

  /**
   * Writes one look value where the scope says it belongs: onto this grid
   * while each keeps its own, and onto the shared setting otherwise. One
   * function, because the menu rows are the same rows either way and only
   * the destination moves.
   */
  private async setLookKey<K extends keyof GridLook>(
    key: K,
    value: NonNullable<GridLook[K]>
  ): Promise<void> {
    const settings = this.plugin.settings;
    if (settings.gridLookScope !== "grid") {
      (settings as unknown as Record<string, unknown>)[key] = value;
    } else {
      this.writeLook(key, value);
    }
    await this.plugin.saveSettings();
    this.applyLook();
  }

  /** Drops this grid's own value for one setting, back onto the shared one. */
  private async clearLookKey(key: keyof GridLook): Promise<void> {
    this.writeLook(key, undefined);
    await this.plugin.saveSettings();
    this.applyLook();
  }

  /** Home keeps its look on settings; every other grid keeps it on itself. */
  private writeLook<K extends keyof GridLook>(key: K, value: GridLook[K]): void {
    const settings = this.plugin.settings;
    const active = this.activeGrid();
    let slot: GridLook | undefined;
    if (active.name === settings.homeGridName) {
      slot = settings.homeGridLook ??= {};
    } else {
      const grid = settings.grids.find((g) => g.name === active.name);
      if (grid) slot = grid.look ??= {};
    }
    if (!slot) return;
    if (value === undefined) delete slot[key];
    else slot[key] = value;
  }

  private tileSizeItems(): MenuItem[] {
    const current = this.stage();
    const first = STAGES[0];
    const last = STAGES[STAGES.length - 1];
    const stages: MenuItem[] = STAGES.map((stage, i) => ({
      icon: "",
      label: stageLabel(stage),
      detailIcon: stage === current ? "check" : undefined,
      divider: i === 0,
      keepOpen: true,
      onSelect: () => this.setTileSize(stage),
    }));
    return [
      {
        icon: "minimize-2",
        label: "Shrink",
        disabled: current === first,
        keepOpen: true,
        onSelect: () => this.setTileSize(shrinkStage(current)),
      },
      {
        icon: "maximize-2",
        label: "Expand",
        disabled: current === last,
        keepOpen: true,
        onSelect: () => this.setTileSize(expandStage(current)),
      },
      ...stages,
      // The way back, on the same terms as the rest of the look: shown and
      // inert unless this grid has set a size of its own.
      ...(this.plugin.settings.gridLookScope === "grid"
        ? [
            {
              icon: "undo-2",
              label: "Follow all grids",
              divider: true,
              disabled: this.plugin.settings.gridTileSizes[this.gridKey()] === undefined,
              onSelect: () => void this.clearTileSize(),
            },
          ]
        : []),
    ];
  }

  /**
   * Where a tile size lands: on the grouped inbox while that is what you are
   * looking at, on this grid while each keeps its own, and on the shared
   * setting otherwise. Neither of the first two is the grid's `look`, because
   * a stage is a pixel width and does not travel to a phone.
   */
  private setTileSize(stage: DensityStage): void {
    if (stage === this.stage()) return;
    const settings = this.plugin.settings;
    if (this.isGrouped()) settings.groupedTileSize = stage;
    else if (settings.gridLookScope === "grid") settings.gridTileSizes[this.gridKey()] = stage;
    else settings.tileSize = stage;
    void this.plugin.saveSettings();
    this.grid?.setDensity(stage);
  }

  /** Drops this grid's own tile size, back onto the shared one. */
  private async clearTileSize(): Promise<void> {
    delete this.plugin.settings.gridTileSizes[this.gridKey()];
    await this.plugin.saveSettings();
    this.applyLook();
  }

  private openCreate(x: number, y: number): void {
    this.menu?.open(
      [
        {
          icon: "clipboard-paste",
          label: "Clip",
          // Whatever is on the clipboard: a picture, a video, or a link.
          detail: "\u2318\u21e7V",
          onSelect: () => void this.plugin.clipFromClipboard(),
        },
        {
          icon: "layers",
          label: "New grid",
          divider: true,
          onSelect: () => this.promptNewGrid(),
        },
        {
          icon: "wand-2",
          label: "New smart view",
          onSelect: () => this.promptNewSmartGrid(),
        },
        {
          icon: "folder-plus",
          label: "New folder",
          divider: true,
          // Inert on a smart grid, so the row does not come and go by where
          // you are; a folder needs a grid that can be filed into.
          disabled: !this.canFile(),
          detail: this.canFile() ? undefined : "Smart view",
          onSelect: () => this.promptNewFolder([]),
        },
      ],
      x,
      y
    );
  }

  /**
   * Opens the editor for a new grid, and hands the finished grid to `then`.
   *
   * That is how the move rows file onto a grid that did not exist when the
   * menu was opened: clippings and folders each pass their own move, and
   * neither has to know the other exists.
   */
  private promptNewGrid(then?: (saved: GridSpace) => void): void {
    if (!this.sheet) return;
    openNewGrid(this.sheet, this.gridsController(), (saved) => {
      then?.(saved);
      this.refresh();
    });
  }

  /** Empty rules rather than none: it is what tells the editor which kind of
      grid it is making, before any of them have been chosen. */
  private promptNewSmartGrid(): void {
    if (!this.sheet) return;
    openNewSmartGrid(this.sheet, this.gridsController(), {}, () => this.refresh());
  }

  private async moveTo(ids: string[], target: string, folder = ""): Promise<void> {
    // Read before the move: the wall repaints as the notes leave.
    const fromInbox = this.isInbox();
    const before = this.placementOf(ids);
    const result = await this.assign(ids, target, folder);
    const moved = result.moved;
    // Where the notes are now. In folder mode a move is a rename, so the ids
    // this was called with stop naming anything the moment it returns, and
    // undo and redo have to follow the notes rather than the paths.
    let current = result.paths;
    this.grid?.clearSelection();
    // Named by where they landed, which for a drop onto a folder's row is the
    // folder rather than the grid it sits on.
    const where = folder || target;
    new Notice(
      moved === 1
        ? `Goko: 1 clipping moved to ${where}`
        : `Goko: ${moved} clippings moved to ${where}`
    );
    this.history.push({
      label: `Move to ${where}`,
      undo: async () => {
        current = await this.restorePlacement(before, current);
      },
      redo: async () => {
        current = (await this.assign(current, target, folder)).paths;
      },
    });
    // Filing from the inbox is the moment a rule can be learned: you have just
    // said where something from that site goes.
    if (fromInbox) this.offerRule(ids, target, folder);
  }

  /** Where each clipping sits now, raw, so a move can be taken back. */
  private placementOf(ids: string[]): Array<{ path: string; grid: string; folder: string }> {
    return ids.map((path) => {
      const record = this.plugin.index.get(path);
      return { path, grid: record?.grid ?? "", folder: record?.folder ?? "" };
    });
  }

  /**
   * Puts clippings back where placementOf found them, one write each.
   *
   * `current` is where each of them is now, in the same order: the paths in
   * `placement` are where they were, which in folder mode no longer names a
   * file. Returns where they are after this, for the redo that may follow.
   */
  private async restorePlacement(
    placement: Array<{ path: string; grid: string; folder: string }>,
    current: readonly string[]
  ): Promise<string[]> {
    const home = this.plugin.settings.homeGridName;
    const now = [...current];
    for (let i = 0; i < placement.length; i++) {
      const { grid, folder } = placement[i];
      const result = await this.assign([now[i]], grid.trim() || home, folder.trim());
      now[i] = result.paths[0] ?? now[i];
    }
    return now;
  }

  /** Whether the wall on screen is the inbox rather than a grid or a view. */
  private isHomeGrid(): boolean {
    return this.activeGrid().name === this.plugin.settings.homeGridName;
  }

  /** The inbox proper: home, whole, not the library. The one wall that suggests. */
  private isInbox(): boolean {
    return this.isHomeGrid() && !this.showAll && !this.openFolder && !isSmartGrid(this.activeGrid());
  }

  // ---- Suggestions -------------------------------------------------------

  /**
   * Where the grids say each inbox card belongs.
   *
   * Every grid that can be filed into is profiled from the cards already on
   * it, every folder on it likewise, and every card in the inbox is scored
   * against all of them. Nothing is written and nothing is decided.
   *
   * Recomputed on each paint of the inbox rather than cached, because the
   * inputs move under it: a tag the model has just written, a card just
   * filed on a grid, a grid just made. The cost is a few hundred string
   * comparisons. What you have waved away stays waved away for the session.
   */
  private propose(inbox: readonly ClippingRecord[]): void {
    const home = this.plugin.settings.homeGridName;
    const registered = this.registered();
    const records = this.plugin.index.records();

    // Every grid, and every folder on it as a place of its own: a folder is
    // a grid inside a grid, and its cards say what it is about the same way.
    const profiles: GridProfile[] = [];
    for (const grid of this.plugin.settings.grids) {
      if (isSmartGrid(grid)) continue;
      const members = records.filter((record) => effectiveGrid(record, home, registered) === grid.name);
      profiles.push(gridProfile(grid.name, members, TAG_PROPERTIES));
      for (const folder of this.plugin.settings.folders) {
        if (folder.grid !== grid.name) continue;
        profiles.push(
          folderProfile(
            grid.name,
            folder.name,
            members.filter((record) => record.folder.trim() === folder.name),
            TAG_PROPERTIES
          )
        );
      }
    }

    const { rules } = parseRules(this.plugin.settings.domainRules);
    this.proposals = proposeGrids(inbox, profiles, rules).placed;
  }

  /** The suggestion standing for a card: yours if you moved it, else the grids', or null once waved away. */
  private suggestionOf(path: string): Proposal | null {
    const override = this.overrides.get(path);
    // Score zero, so an island's heading keeps giving the grids' reason
    // rather than "moved here by you" for every island you touched.
    if (override) return { ...override, score: 0, why: "moved here by you" };
    if (this.dismissed.has(path)) return null;
    return this.proposals.get(path) ?? null;
  }

  /** Waves a card's suggestion away for the session, wherever it came from. */
  private dismissSuggestions(ids: readonly string[]): void {
    for (const id of ids) {
      this.dismissed.add(id);
      this.overrides.delete(id);
    }
    this.refresh({ replace: true });
  }

  /** The chips: one per card with a suggestion, naming where it would go. */
  private suggestionsFor(tiles: TileModel[]): Map<string, Suggestion> {
    const icons = new Map(this.allGrids().map((grid) => [grid.name, grid.icon]));
    const folders = this.plugin.settings.folders;
    const out = new Map<string, Suggestion>();
    for (const tile of tiles) {
      const proposal = this.suggestionOf(tile.id);
      if (!proposal) continue;
      const folder = proposal.folder
        ? folders.find((f) => f.grid === proposal.grid && f.name === proposal.folder)
        : undefined;
      out.set(tile.id, {
        label: folder ? `${proposal.grid} \u203a ${folder.name}` : proposal.grid,
        icon: folder?.icon ?? icons.get(proposal.grid) ?? "layout-grid",
        why: proposal.why,
        // What you dragged somewhere yourself is as sure as it gets.
        strength: proposal.score >= STRONG || this.overrides.has(tile.id) ? "strong" : "fair",
      });
    }
    return out;
  }

  /**
   * The wall in islands: the undecided pile first, then the proposals,
   * biggest first.
   *
   * The pile leads because it is the work. Every card in it needs a decision
   * from you, and the islands under it need one glance each; a wall that
   * opened on the glances and buried the work at the bottom had the order
   * of effort backwards. Within an island the cards keep the wall's order.
   */
  private islandModels(tiles: TileModel[]): IslandModel[] {
    const byKey = new Map<string, string[]>();
    for (const tile of tiles) {
      const key = this.suggestionOf(tile.id)?.grid ?? "";
      const held = byKey.get(key);
      if (held) held.push(tile.id);
      else byKey.set(key, [tile.id]);
    }

    const models: IslandModel[] = [];
    const undecided = byKey.get("") ?? [];
    // The pile is always there, empty or not: it is where a card is dropped
    // to say "not there", and a target that only exists while something is
    // already in it cannot be found the first time it is needed.
    const idea = this.gridIdea;
    models.push({
      key: "",
      label: "Undecided",
      icon: "inbox",
      collapsed: undecided.length === 0,
      ids: undecided,
      // What the pile has to say, in this order: what its cards share, if
      // anything; that the grids had nothing to say, when a wall of one pile
      // would otherwise look like nothing happened; else what it is for.
      why: idea
        ? `${idea.paths.length} cards share \u201c${idea.tag}\u201d`
        : this.proposals.size === 0
          ? "No suggestions yet. Grids learn from what you file on them."
          : "Drop a card here to dismiss its suggestion",
      pockets: [],
      offer: idea ? { label: `New grid ${idea.name}` } : undefined,
    });

    const folders = this.plugin.settings.folders;
    const icons = new Map(this.allGrids().map((grid) => [grid.name, grid.icon]));
    const grids = [...byKey.entries()]
      .filter(([key]) => key !== "")
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    for (const [key, ids] of grids) {
      // The grid's folders are pockets inside the island: a card going into
      // one is shown there, under the folder's name, rather than loose among
      // the cards going onto the grid itself.
      const loose: string[] = [];
      const byFolder = new Map<string, string[]>();
      for (const id of ids) {
        const folder = this.suggestionOf(id)?.folder ?? "";
        if (!folder) {
          loose.push(id);
          continue;
        }
        const held = byFolder.get(folder);
        if (held) held.push(id);
        else byFolder.set(folder, [id]);
      }
      const pockets: IslandPocketModel[] = [...byFolder.entries()].map(([name, held]) => ({
        key: name,
        label: name,
        icon: folders.find((f) => f.grid === key && f.name === name)?.icon ?? "folder",
        ids: held,
        why: this.whyFor(key, held, name),
      }));
      models.push({
        key,
        label: key,
        icon: icons.get(key) ?? "layout-grid",
        collapsed: this.folded.has(key),
        ids: loose,
        why: this.whyFor(key, loose),
        pockets,
      });
    }
    return models;
  }

  /** The reason the strongest proposal in an island or a pocket gives, or nothing. */
  private whyFor(key: string, ids: readonly string[], folder = ""): string {
    let best: Proposal | null = null;
    for (const id of ids) {
      const proposal = this.suggestionOf(id);
      if (!proposal || proposal.grid !== key || proposal.folder !== folder) continue;
      if (!best || proposal.score > best.score) best = proposal;
    }
    return best?.why ?? "";
  }

  /** Lays the inbox out by suggestion, or flat again. Remembered. */
  private toggleGrouping(): void {
    this.plugin.settings.inboxGrouped = !this.plugin.settings.inboxGrouped;
    void this.plugin.saveSettings();
    this.refresh({ replace: true });
  }

  /** Whether the wall on screen is the inbox, grouped into islands. */
  private isGrouped(): boolean {
    return this.isInbox() && this.plugin.settings.inboxGrouped;
  }

  /**
   * The size cards are on the wall as it now stands.
   *
   * The grouped view keeps a size of its own, small by default: it is read
   * by the shape of its islands rather than card by card, and that means
   * seeing all of them at once. Resting the cursor on a card there grows it
   * back to full size, so nothing is lost by packing them down.
   */
  private stage(): DensityStage {
    // The grouped inbox overrides whatever the wall itself resolves to,
    // whether that is the shared setting or this grid's own. It answers a
    // different question: a grid's look says what this wall is, and this
    // says how you are looking at it.
    if (this.isGrouped()) return this.plugin.settings.groupedTileSize;
    return this.look().tileSize;
  }

  /**
   * Accept an island: every card in it goes where the island says, the loose
   * ones onto the grid and each pocket's into its folder, as one step in the
   * history. The island is gone with them; that is what accepting looks like.
   */
  private async acceptIsland(key: string): Promise<void> {
    if (!key) return;
    const island = this.islandModels(this.shownTiles).find((model) => model.key === key);
    if (!island) return;
    const groups = [
      { paths: [...island.ids], grid: key, folder: "" },
      ...island.pockets.map((pocket) => ({ paths: [...pocket.ids], grid: key, folder: pocket.key })),
    ].filter((group) => group.paths.length > 0);
    const moved = await this.fileMany(groups, `File to ${key}`);
    this.folded.delete(key);
    new Notice(moved === 1 ? `Goko: 1 clipping filed to ${key}` : `Goko: ${moved} clippings filed to ${key}`);
    // A card you dragged into this island before accepting it was a
    // correction, and now it has been carried out: the moment to ask.
    for (const group of groups) {
      this.offerRule(group.paths, key, group.folder);
      for (const path of group.paths) {
        this.overrides.delete(path);
        this.dismissed.delete(path);
      }
    }
  }

  /**
   * Files several groups of clippings, each to its own place, as one entry
   * in the history: one undo brings the whole island back.
   */
  private async fileMany(
    groups: Array<{ paths: string[]; grid: string; folder: string }>,
    label: string
  ): Promise<number> {
    const all = groups.flatMap((group) => group.paths);
    if (all.length === 0) return 0;
    const before = this.placementOf(all);
    // Where each note is now, by the path it had. A move in folder mode
    // renames the note, so undo and redo have to look where the last pass
    // left it.
    const current = new Map(all.map((path) => [path, path]));
    const carryOut = async (): Promise<number> => {
      let moved = 0;
      for (const group of groups) {
        const from = group.paths.map((path) => current.get(path) ?? path);
        const result = await this.assign(from, group.grid, group.folder);
        group.paths.forEach((path, i) => current.set(path, result.paths[i] ?? from[i]));
        moved += result.moved;
      }
      return moved;
    };
    const moved = await carryOut();
    this.grid?.clearSelection();
    this.history.push({
      label,
      undo: async () => {
        const now = await this.restorePlacement(before, all.map((path) => current.get(path) ?? path));
        all.forEach((path, i) => current.set(path, now[i]));
      },
      redo: async () => void (await carryOut()),
    });
    return moved;
  }

  /** Fold an island to its heading, or open it again. */
  private foldIsland(key: string): void {
    if (!key) return;
    if (this.folded.has(key)) this.folded.delete(key);
    else this.folded.add(key);
    this.grid?.setIslands(this.islandModels(this.shownTiles));
  }

  /**
   * Cards dropped on an island or in one of its pockets move into it: the
   * islands are the plan, and a drag edits the plan. Nothing is written —
   * Accept does that, and the rail files directly for anyone who wants a
   * drop to be final. Dropped on the undecided pile, cards keep their place
   * and lose their suggestion, which is the way to say "no, not there"
   * without saying where instead. Dropped back where they already were,
   * nothing happens, as nothing should.
   */
  private dropOnIsland(ids: string[], key: string, folder: string): void {
    if (!key) {
      this.dismissSuggestions(ids);
      return;
    }
    let changed = false;
    for (const id of ids) {
      const current = this.suggestionOf(id);
      if (current && current.grid === key && current.folder === folder) continue;
      this.overrides.set(id, { grid: key, folder });
      this.dismissed.delete(id);
      changed = true;
    }
    if (changed) this.refresh({ replace: true });
  }

  /** The chip tapped: the card goes where it was suggested. */
  private fileAsSuggested(id: string): void {
    const proposal = this.suggestionOf(id);
    if (!proposal) return;
    void this.moveTo([id], proposal.grid, proposal.folder);
  }

  /**
   * Every one of these cards to its own suggested place, in one step.
   *
   * The one filing gesture the rail cannot make: a drag has one destination,
   * and a selection of eight cards bound for four grids is eight drags there
   * and one press here.
   */
  private async fileSelectionAsSuggested(ids: readonly string[]): Promise<void> {
    const groups = new Map<string, { paths: string[]; grid: string; folder: string }>();
    for (const id of ids) {
      const proposal = this.suggestionOf(id);
      if (!proposal) continue;
      const key = `${proposal.grid}/${proposal.folder}`;
      const held = groups.get(key);
      if (held) held.paths.push(id);
      else groups.set(key, { paths: [id], grid: proposal.grid, folder: proposal.folder });
    }
    if (groups.size === 0) return;
    const moved = await this.fileMany([...groups.values()], "File as suggested");
    new Notice(moved === 1 ? "Goko: 1 clipping filed as suggested" : `Goko: ${moved} clippings filed as suggested`);
    for (const group of groups.values()) {
      this.offerRule(group.paths, group.grid, group.folder);
      for (const path of group.paths) {
        this.overrides.delete(path);
        this.dismissed.delete(path);
      }
    }
  }

  /**
   * A grid the undecided cards are asking for.
   *
   * Only names that can be a folder are offered: in folder mode the grid is a
   * directory, and a tag with a slash in it is not one.
   */
  private ideaFor(inbox: readonly ClippingRecord[]): GridIdea | null {
    const undecided = inbox.filter((record) => this.suggestionOf(record.path) === null);
    const settings = this.plugin.settings;
    const taken = [
      settings.homeGridName,
      ...settings.grids.map((grid) => grid.name),
      ...settings.folders.map((folder) => folder.name),
    ];
    const idea = proposeNewGrid(undecided, this.plugin.index.records(), taken, TAG_PROPERTIES);
    if (!idea || validatePathName(idea.name, taken) !== null) return null;
    return idea;
  }

  /**
   * Makes the grid the pile asked for and files those cards on it: one
   * decision in place of one per card, and a piece of structure grown out
   * of what was actually saved rather than planned in advance.
   */
  private async createGridFromIdea(): Promise<void> {
    const idea = this.gridIdea;
    if (!idea) return;
    this.gridIdea = null;
    const space: GridSpace = { name: idea.name, icon: "layout-grid" };
    await this.createGridDef(space);
    const moved = await this.fileMany(
      [{ paths: [...idea.paths], grid: idea.name, folder: "" }],
      `File to ${idea.name}`
    );
    new Notice(`Goko: ${idea.name} made, ${moved} clipping${moved === 1 ? "" : "s"} filed on it`);
  }

  /**
   * Offers to remember where a card from some site was just filed, as a rule.
   *
   * Asked when the filing said something the grids did not already know: it
   * went against the suggestion, or there was none and the site turns up more
   * than once in the vault. Agreeing with a suggestion teaches nothing, and a
   * site seen once is not yet a habit. Once per host per session, and never
   * for a host that already has a rule, since the first match is the one
   * applyRules uses and a second would be dead text in the settings field.
   */
  private offerRule(paths: readonly string[], grid: string, folder = ""): void {
    if (!grid) return;
    const where = folder ? `${grid} \u203a ${folder}` : grid;
    for (const path of paths) {
      const record = this.plugin.index.get(path);
      if (!record) continue;
      const rule = learnableRule(record, grid, folder);
      if (!rule || this.askedRules.has(rule.host)) continue;
      const rules = this.plugin.settings.domainRules;
      if (appendRule(rules, rule.line) === rules) continue;

      const proposal = this.proposals.get(path);
      const against = proposal ? proposal.grid !== grid || proposal.folder !== folder : false;
      const recurring =
        this.plugin.index.records().filter((other) => domainOf(other.source) === rule.host).length > 1;
      if (!against && !recurring) continue;

      this.askedRules.add(rule.host);
      this.ruleStrip?.offer({
        text: `Always file ${rule.host} in ${where}?`,
        onYes: () => {
          this.plugin.settings.domainRules = appendRule(
            this.plugin.settings.domainRules,
            rule.line
          );
          void this.plugin.saveSettings();
          new Notice(`Goko: ${rule.host} will file in ${where} from now on`);
        },
        onNo: () => undefined,
      });
      return;
    }
  }

  // ---- Folders -----------------------------------------------------------

  /** A stored folder's grid key as a grid name: "" is home. */
  private gridNameFor(key: string): string {
    return key || this.plugin.settings.homeGridName;
  }

  /** The key the grid on screen is written as: "" for home, its name
      otherwise, which is how `grid:` and FolderSpace.grid both spell it. */
  private gridKey(): string {
    const active = this.activeGrid().name;
    return active === this.plugin.settings.homeGridName ? "" : active;
  }

  /** Kept for the folder code, which asks the same question of the same grid. */
  private folderGridKey(): string {
    return this.gridKey();
  }

  /** A grid's own look, wherever that grid keeps it. Home is not in `grids`,
      so its slot is on settings beside the name and icon it also keeps there. */
  private lookOf(grid: GridSpace): GridLook | undefined {
    return grid.name === this.plugin.settings.homeGridName
      ? this.plugin.settings.homeGridLook
      : this.plugin.settings.grids.find((g) => g.name === grid.name)?.look;
  }

  /**
   * The four look settings in force on the wall.
   *
   * The one place the scope is read. On "all" no override is passed and every
   * grid resolves to the shared settings; on "grid" the active grid's own are
   * handed over and anything it has not set still falls back. Every read of
   * the four goes through here so the two cannot drift.
   */
  private look(): ResolvedLook {
    const settings = this.plugin.settings;
    if (settings.gridLookScope !== "grid") return resolveLook(settings, undefined, undefined);
    return resolveLook(
      settings,
      this.lookOf(this.activeGrid()),
      settings.gridTileSizes[this.gridKey()]
    );
  }

  /** Whether the grid on screen can be filed into, and so can hold folders. */
  private canFile(): boolean {
    // Nor while the library is showing: it is every clipping there is, not a
    // place, so there is nothing for a card to be moved into.
    return !this.showAll && !isSmartGrid(this.activeGrid());
  }

  private foldersHere(): FolderSpace[] {
    if (!this.canFile()) return [];
    // A folder on home would be a directory beside the grids, which reads
    // back as a grid — the two cannot be told apart by a path. So in folder
    // mode home has no folders: grouping something is filing it.
    if (this.byFolders && this.activeGrid().name === this.plugin.settings.homeGridName) return [];
    const key = this.folderGridKey();
    return this.plugin.settings.folders.filter((folder) => folder.grid === key);
  }

  /** Paths of the clippings carrying this folder's name on the grid on screen. */
  private folderMembers(name: string): string[] {
    return filterByGrid(
      this.plugin.index.records(),
      this.activeGrid().name,
      this.plugin.settings.homeGridName,
      this.registered()
    )
      .filter((record) => record.folder.trim() === name)
      .map((record) => record.path);
  }

  private enterFolder(name: string): void {
    if (!this.foldersHere().some((folder) => folder.name === name)) return;
    if (this.openFolder === name) return;
    this.openFolder = name;
    this.grid?.clearSelection();
    this.refresh({ replace: true });
    this.grid?.resetView(false);
    this.spaceBar?.setFolder(name);
  }

  private leaveFolder(): void {
    if (this.openFolder === null) return;
    this.openFolder = null;
    this.grid?.clearSelection();
    this.refresh({ replace: true });
    this.grid?.resetView(false);
    this.spaceBar?.setFolder(null);
  }

  private async moveToFolder(ids: string[], name: string): Promise<void> {
    const folder = this.foldersHere().find((f) => f.name === name);
    if (!folder) return;
    // Already there is not a move, and not a write.
    const paths = ids.filter((id) => this.plugin.index.get(id)?.folder.trim() !== name);
    const before = this.placementOf(paths);
    const grid = this.activeGrid().name;
    const result = paths.length > 0 ? await this.assign(paths, grid, name) : null;
    const moved = result?.moved ?? 0;
    let current = result?.paths ?? [];
    this.grid?.clearSelection();
    new Notice(
      moved === 1
        ? `Goko: 1 clipping moved to ${name}`
        : `Goko: ${moved} clippings moved to ${name}`
    );
    if (paths.length === 0) return;
    this.history.push({
      label: `Move to ${name}`,
      undo: async () => {
        current = await this.restorePlacement(before, current);
      },
      redo: async () => {
        current = (await this.assign(current, grid, name)).paths;
      },
    });
  }

  /**
   * The folders the selection holds, in wall order, or none when it holds
   * clippings. Read from the wall's own list rather than from the ids, so a
   * folder that has since gone cannot come back through a stale selection.
   */
  private selectedFolders(): FolderSpace[] {
    if (this.grid?.selectionKind() !== "folders") return [];
    const picked = new Set(this.grid.selectedIds());
    return this.foldersHere().filter((folder) => picked.has(folderTileId(folder)));
  }

  /**
   * The grids a folder can move to, ending in New grid.
   *
   * Manual grids only. A smart view computes its membership and nothing is
   * filed into one, so a folder on it would hold clippings that no wall
   * reads: the same reason fileableGrid refuses. The grid it is already on
   * is shown and inert, so the set reads whole.
   */
  private folderGridMoveRows(folders: FolderSpace[]): MenuItem[] {
    const home = this.plugin.settings.homeGridName;
    const { manual } = groupedGrids(this.allGrids());
    const here = this.folderGridKey();

    return [
      ...manual.map(({ grid }) => ({
        icon: grid.icon,
        label: grid.name,
        disabled: (grid.name === home ? "" : grid.name) === here,
        onSelect: () => void this.moveFoldersTo(folders, grid.name),
      })),
      {
        icon: "plus",
        label: "New grid\u2026",
        divider: true,
        onSelect: () =>
          this.promptNewGrid((saved) => void this.moveFoldersTo(folders, saved.name)),
      },
    ];
  }

  /** The grids a grid can become a folder on: every other manual grid. */
  private demoteTargetRows(name: string): MenuItem[] {
    return this.plugin.settings.grids
      .filter((grid) => !isSmartGrid(grid) && grid.name !== name)
      .map((grid) => ({
        icon: grid.icon,
        label: grid.name,
        onSelect: () => void this.demoteGrid(name, grid.name),
      }));
  }

  /**
   * Moves folders to another grid, definitions and members together.
   *
   * Both halves have to move or the folder is left holding clippings that
   * are somewhere else: the definition's `grid` and each member's `grid:`
   * say the same thing, and assign writes `grid` and `folder` in one call so
   * they cannot come apart mid-move. A name the target already uses stays
   * where it is and the rest go, rather than the whole move failing over one
   * of them.
   */
  private async moveFoldersTo(folders: FolderSpace[], target: string): Promise<void> {
    const settings = this.plugin.settings;
    const key = target === settings.homeGridName ? "" : target;
    const { moved, blocked } = planFolderMove(folders, key, settings.folders);

    if (blocked.length > 0) {
      new Notice(
        blocked.length === 1
          ? `Goko: ${target} already has a folder called ${blocked[0]}`
          : `Goko: ${target} already has folders called ${blocked.join(", ")}`
      );
    }
    if (moved.length === 0) return;

    /*
     * Read before anything is written, afterwards the members answer to the
     * grid they have just been moved to. `origin` is copied out for the same
     * reason: a FolderSpace here is the registry's own object, so writing
     * the new key into it also rewrites what `folder.grid` says, and a redo
     * would then go looking on the grid it had already left.
     */
    const carried = moved.map((folder) => ({
      name: folder.name,
      origin: folder.grid,
      // By the folder's own grid rather than the one on screen: a folder
      // dropped on another grid in the rail can be from any of them.
      members: this.membersOfFolder(folder.grid, folder.name),
    }));
    const all = carried.flatMap((entry) => entry.members);
    const placement = this.placementOf(all);
    // Where each note is now, by the path it had when the move began. In
    // folder mode a move renames the note, so undo and redo have to look
    // where the last pass left it rather than where it started.
    const current = new Map(all.map((path) => [path, path]));

    const apply = async (): Promise<void> => {
      for (const { name, origin, members } of carried) {
        const entry = settings.folders.find((f) => f.grid === origin && f.name === name);
        if (entry) entry.grid = key;
        // In folder mode the directory goes whole. Moving its notes one by
        // one left it behind empty, and the registry, which reads the tree,
        // put the folder straight back on the grid it had just left.
        if (this.byFolders) {
          await this.plugin.placement.relocate(
            { grid: this.gridNameFor(origin), folder: name },
            { grid: target, folder: name }
          );
          continue;
        }
        if (members.length === 0) continue;
        const from = members.map((path) => current.get(path) ?? path);
        const result = await this.assign(from, target, name);
        members.forEach((path, i) => current.set(path, result.paths[i] ?? from[i]));
      }
      await this.plugin.saveSettings();
      this.refresh();
    };

    await apply();
    this.grid?.clearSelection();
    new Notice(
      moved.length === 1
        ? `Goko: ${moved[0].name} moved to ${target}`
        : `Goko: ${moved.length} folders moved to ${target}`
    );

    this.history.push({
      label: moved.length === 1 ? `Move ${moved[0].name}` : `Move ${moved.length} folders`,
      undo: async () => {
        for (const { name, origin } of carried) {
          const entry = settings.folders.find((f) => f.grid === key && f.name === name);
          if (entry) entry.grid = origin;
          if (this.byFolders) {
            await this.plugin.placement.relocate(
              { grid: target, folder: name },
              { grid: this.gridNameFor(origin), folder: name }
            );
          }
        }
        await this.plugin.saveSettings();
        if (this.byFolders) {
          this.refresh();
          return;
        }
        const now = await this.restorePlacement(
          placement,
          all.map((path) => current.get(path) ?? path)
        );
        all.forEach((path, i) => current.set(path, now[i]));
        this.refresh();
      },
      redo: apply,
    });
  }

  /** The bar's trash, which means two different things by what is picked. */
  private removeSelection(): void {
    const folders = this.selectedFolders();
    if (folders.length > 0) this.confirmRemoveFolders(folders);
    else this.confirmDelete(this.grid?.selectedIds() ?? []);
  }

  /**
   * Asks what removing folders should take with it.
   *
   * Removing a folder deletes a definition and nothing else, which is not
   * what everyone means by it, so the clippings inside are the question
   * rather than an assumption. Deleting goes through the same path a
   * clipping's own delete does, reference-counted media included.
   */
  private confirmRemoveFolders(folders: FolderSpace[]): void {
    if (!this.sheet) return;
    const members = folders.flatMap((folder) => this.folderMembers(folder.name));
    openRemoveFolders(this.sheet, folders, members.length, {
      onRemove: () => void this.removeFolderDefs(folders),
      onDelete: () => {
        const media = this.doomedMedia(members);
        void this.deleteClippings(members, media.paths).then(() =>
          this.removeFolderDefs(folders)
        );
      },
    });
  }

  /**
   * Takes several folder definitions out at once, as one step of history.
   *
   * Spliced back to front so the indices ahead of each one still hold, and
   * put back front to back on the way in. Members are never rewritten, the
   * same as removing one: they keep a key that reads as loose while the
   * folder is gone and as the folder again the moment it is back.
   */
  private async removeFolderDefs(folders: FolderSpace[], record = true): Promise<void> {
    const settings = this.plugin.settings;
    const removed = folders
      .map((folder) => ({
        folder,
        index: settings.folders.findIndex(
          (f) => f.grid === folder.grid && f.name === folder.name
        ),
      }))
      .filter((entry) => entry.index >= 0)
      .sort((a, b) => b.index - a.index);
    if (removed.length === 0) return;

    for (const { index } of removed) settings.folders.splice(index, 1);
    if (folders.some((folder) => folder.name === this.openFolder)) {
      this.openFolder = null;
      this.spaceBar?.setFolder(null);
    }
    await this.plugin.saveSettings();
    this.grid?.clearSelection();
    this.refresh();
    if (!record) return;

    this.history.push({
      label:
        removed.length === 1 ? `Remove ${removed[0].folder.name}` : `Remove ${removed.length} folders`,
      undo: async () => {
        for (const { folder, index } of [...removed].reverse()) {
          settings.folders.splice(Math.min(index, settings.folders.length), 0, folder);
        }
        await this.plugin.saveSettings();
        this.refresh();
      },
      redo: () => this.removeFolderDefs(folders, false),
    });
  }

  /** Opens the editor for a new folder; `seed` is moved in once it is made. */
  private promptNewFolder(seed: string[]): void {
    if (!this.sheet || !this.canFile()) return;
    openFolderEditor(
      this.sheet,
      this.foldersController(),
      { name: "", icon: "folder", grid: this.folderGridKey(), width: 1 },
      true,
      (saved) => {
        if (seed.length > 0) void this.moveToFolder(seed, saved.name);
        this.refresh();
        // Folders lead the wall, so a new one is at the top; go there, or
        // it was made somewhere you cannot see, and light it as it lands.
        // After the repaint, which is the frame after this one.
        this.grid?.spotlight(folderTileId(saved));
        window.requestAnimationFrame(() => this.grid?.resetView());
      }
    );
  }

  private editFolder(folder: FolderSpace): void {
    if (!this.sheet) return;
    openFolderEditor(this.sheet, this.foldersController(), folder, false, () => this.refresh());
  }

  private removeFolder(folder: FolderSpace): void {
    if (!this.sheet) return;
    openRemoveFolder(this.sheet, this.foldersController(), folder, () => this.refresh());
  }

  private async resizeFolder(name: string, width: FolderWidth, record = true): Promise<void> {
    const key = this.folderGridKey();
    const entry = this.plugin.settings.folders.find((f) => f.grid === key && f.name === name);
    if (!entry || entry.width === width) return;
    const was = entry.width;
    entry.width = width;
    await this.plugin.saveSettings();
    // The drag already laid the wall out at this width, so the repaint moves
    // nothing and the camera stays where the hand left it.
    this.refresh();
    if (!record) return;
    this.history.push({
      label: `Resize ${name}`,
      undo: () => this.resizeFolder(name, was, false),
      redo: () => this.resizeFolder(name, width, false),
    });
  }

  private async undo(): Promise<void> {
    try {
      const label = await this.history.undo();
      if (label) new Notice(`Goko: undid ${label}`);
    } catch (error) {
      new Notice(`Goko: could not undo (${String(error)})`);
    }
  }

  private async redo(): Promise<void> {
    try {
      const label = await this.history.redo();
      if (label) new Notice(`Goko: redid ${label}`);
    } catch (error) {
      new Notice(`Goko: could not redo (${String(error)})`);
    }
  }

  private openFolderMenu(name: string, x: number, y: number): void {
    const folder = this.foldersHere().find((f) => f.name === name);
    if (!folder) return;

    /*
     * What the menu acts on: the whole selection when this folder is part of
     * it, and this folder alone when it is not. The rows below that name one
     * folder stay on this one either way, because opening, editing and
     * resizing are things you do to a folder rather than to a pile of them.
     */
    const picked = this.selectedFolders();
    const batch = picked.some((f) => f.name === name) ? picked : [folder];
    const many = batch.length > 1;

    const labels: Record<string, string> = { 1: "Small", 2: "Wide", 3: "Extra wide" };
    const items: MenuItem[] = [
      { icon: "folder-open", label: "Open", onSelect: () => this.enterFolder(name) },
      {
        icon: "pencil",
        label: "Edit folder",
        divider: true,
        onSelect: () => this.editFolder(folder),
      },
      {
        icon: "corner-up-right",
        label: many ? `Move ${batch.length} folders to grid` : "Move to grid",
        submenu: this.folderGridMoveRows(batch),
      },
      {
        icon: "layout-grid",
        label: "Make it a grid",
        // One folder at a time: each becomes a grid of its own, and a batch
        // would be a dozen grids from one click that nobody asked to line up.
        disabled: many,
        onSelect: () => void this.promoteFolder(folder.grid, folder.name),
      },
      {
        icon: "move-horizontal",
        label: "Size",
        detail: labels[String(folder.width)],
        submenu: FOLDER_WIDTHS.map((width) => ({
          icon: "",
          label: labels[String(width)],
          detailIcon: width === folder.width ? "check" : undefined,
          onSelect: () => void this.resizeFolder(name, width),
        })),
      },
      {
        icon: "trash-2",
        label: many ? `Remove ${batch.length} folders` : "Remove folder",
        divider: true,
        destructive: true,
        // One folder keeps the plain confirmation it has always had; a batch
        // goes through the one that asks about the clippings inside.
        onSelect: () => (many ? this.confirmRemoveFolders(batch) : this.removeFolder(folder)),
      },
    ];
    this.menu?.open(items, x, y);
  }

  private foldersController(): FoldersController {
    return {
      folders: () => this.foldersHere(),
      byFolders: () => this.byFolders,
      memberCount: (name) => this.folderMembers(name).length,
      create: (folder) => this.createFolderDef(folder),
      rename: (from, next) => this.renameFolderDef(from, next),
      remove: (name) => this.removeFolderDef(name),
    };
  }

  /**
   * The three definition changes, each recording its own reverse. Members
   * are never rewritten by create or remove: a folder's members keep their
   * key, which reads as loose while the folder is gone and as the folder
   * again the moment it is back. Only a rename touches notes.
   */
  private async createFolderDef(folder: FolderSpace, record = true): Promise<void> {
    this.plugin.settings.folders.push(folder);
    if (this.byFolders) {
      await this.plugin.placement.createGrid(this.gridNameFor(folder.grid), folder.name);
    }
    await this.plugin.saveSettings();
    if (!record) return;
    this.history.push({
      label: `New folder ${folder.name}`,
      undo: () => this.removeFolderDef(folder.name, false, folder.grid),
      redo: () => this.createFolderDef(folder, false),
    });
  }

  private async renameFolderDef(from: string, next: FolderSpace, record = true): Promise<void> {
    const key = next.grid;
    const entry = this.plugin.settings.folders.find((f) => f.grid === key && f.name === from);
    if (!entry) return;
    const was: FolderSpace = { ...entry };
    const members = next.name !== from ? this.folderMembers(from) : [];
    entry.name = next.name;
    entry.icon = next.icon;
    if (this.openFolder === from) {
      this.openFolder = next.name;
      this.spaceBar?.setFolder(next.name);
    }
    await this.plugin.saveSettings();
    if (next.name !== from && this.byFolders) {
      await this.plugin.placement.renameFolder(this.gridNameFor(key), from, next.name);
    } else if (members.length > 0) {
      await this.assign(members, this.activeGrid().name, next.name);
    }
    this.refresh();
    if (!record) return;
    this.history.push({
      label: next.name !== from ? `Rename ${from}` : `Edit ${from}`,
      undo: () => this.renameFolderDef(next.name, was, false),
      redo: () => this.renameFolderDef(from, next, false),
    });
  }

  private async removeFolderDef(name: string, record = true, grid?: string): Promise<void> {
    const key = grid ?? this.folderGridKey();
    const settings = this.plugin.settings;
    const index = settings.folders.findIndex((f) => f.grid === key && f.name === name);
    if (index === -1) return;
    const [removed] = settings.folders.splice(index, 1);
    // In folder mode the subdirectory goes and its clippings come out onto
    // the grid it was on. Otherwise members keep a key that no longer
    // resolves, which folders.ts reads as loose, and nothing is rewritten.
    if (this.byFolders) {
      await this.plugin.placement.removeGrid(this.gridNameFor(key), name);
    }
    if (this.openFolder === name) {
      this.openFolder = null;
      this.spaceBar?.setFolder(null);
    }
    await this.plugin.saveSettings();
    // A plain refresh, so the members glide back out onto the wall and
    // the camera holds on whatever it was anchored to.
    this.refresh();
    if (!record || !removed) return;
    this.history.push({
      label: `Remove ${name}`,
      undo: async () => {
        settings.folders.splice(Math.min(index, settings.folders.length), 0, removed);
        await this.plugin.saveSettings();
        this.refresh();
      },
      redo: () => this.removeFolderDef(name, false, key),
    });
  }

  private gridsController(): GridsController {
    const settings = this.plugin.settings;

    return {
      home: () => this.homeGrid(),
      byFolders: () => this.byFolders,
      grids: () => settings.grids,
      memberCount: (name) => membersOf(this.plugin.index.records(), name).length,

      // Every tile, typed and tallied together. A rule is written against the
      // whole vault, so the active grid's vocabulary would be the wrong one,
      // and its counts would not survive switching to the grid being made.
      ruleWorld: () => {
        const tiles = buildTiles(
          this.plugin.index.records(),
          this.plugin.archiver.cache,
          this.unloadable
        );
        const defs = this.allDefs(tiles);
        return {
          defs,
          facets: facetsOf(tiles, defs),
          matches: (rules) => smartMembers(tiles, rules, defs).length,
        };
      },

      create: (space) => this.createGridDef(space),
      rename: (from, next) => this.renameGridDef(from, next),
      reorder: (index, delta) => this.reorderGridDef(index, delta),
      remove: (index) => this.removeGridDef(index),
      demote: (name, into) => this.demoteGrid(name, into),
    };
  }

  /** The grid definition changes, each recording its own reverse. */
  private async createGridDef(space: GridSpace, record = true): Promise<void> {
    const settings = this.plugin.settings;
    settings.grids.push(space);
    // In folder mode the directory is what makes the grid exist at all: the
    // registry is read back off the tree, and an entry with no folder would
    // be dropped the next time it is.
    if (this.byFolders && !isSmartGrid(space)) await this.plugin.placement.createGrid(space.name);
    await this.plugin.saveSettings();
    // Stay where you are. Switching to the new grid put you on an empty wall
    // (or, for a view, a wall you did not ask to see) with the wall you were
    // working on gone from under you; the switcher has it when you want it.
    this.refresh();
    new Notice(
      isSmartGrid(space) ? `Goko: created the ${space.name} view` : `Goko: created ${space.name}`
    );
    if (!record) return;
    this.history.push({
      label: `New grid ${space.name}`,
      undo: () => this.removeGridDef(settings.grids.indexOf(space), false),
      redo: () => this.createGridDef(space, false),
    });
  }

  private async renameGridDef(from: string, next: GridSpace, record = true): Promise<void> {
    const settings = this.plugin.settings;
    const members = membersOf(this.plugin.index.records(), from).map((r) => r.path);
    let was: GridSpace;
    // Read before the branch below moves it. Home's key is "" whatever it is
    // called, so a home rename has no tile size to carry.
    const renamingHome = from === settings.homeGridName;

    if (from === settings.homeGridName) {
      was = { name: settings.homeGridName, icon: settings.homeGridIcon };
      settings.homeGridName = next.name;
      settings.homeGridIcon = next.icon;
    } else {
      const entry = settings.grids.find((grid) => grid.name === from);
      if (!entry) return;
      was = { ...entry };
      entry.name = next.name;
      entry.icon = next.icon;
      // Absent means none, for both: the colour picker and the description
      // screen say so by leaving the key off what they hand in, and an
      // assignment would put `undefined` in the file instead of nothing.
      if ("color" in next) entry.color = next.color;
      else delete entry.color;
      if ("description" in next) entry.description = next.description;
      else delete entry.description;
      if (next.rules !== undefined) entry.rules = next.rules;
    }
    if (settings.activeGrid === from) settings.activeGrid = next.name;
    /*
     * The look itself rides on the grid object and needs nothing here. Tile
     * size is the exception: it is kept in a map by name, because it is the
     * one part of a look that does not travel to another device, and a map
     * keyed by name is what a rename can orphan.
     */
    if (!renamingHome && next.name !== from) {
      const stage = settings.gridTileSizes[from];
      if (stage !== undefined) {
        settings.gridTileSizes[next.name] = stage;
        delete settings.gridTileSizes[from];
      }
    }
    await this.plugin.saveSettings();

    if (next.name !== from) {
      if (this.byFolders) {
        // One rename, and Obsidian carries every note and every link with
        // it. Home is the clippings folder itself, which is a setting rather
        // than a grid: renaming it renames the label, not the directory, and
        // the service leaves it alone.
        await this.plugin.placement.renameGrid(from, next.name);
      } else if (members.length > 0) {
        // Renaming home rewrites only the notes that spell it out; the rest
        // belong to it by absence and need no touching. assign() then drops
        // their key entirely, since the target is home.
        await this.assign(members, next.name);
      }
    }

    this.spaceBar?.setActive(this.activeGrid());
    this.refresh();
    if (!record) return;
    this.history.push({
      label: next.name !== from ? `Rename ${from}` : `Edit ${from}`,
      undo: () => this.renameGridDef(next.name, was, false),
      redo: () => this.renameGridDef(from, next, false),
    });
  }

  private async reorderGridDef(index: number, delta: number, record = true): Promise<void> {
    const settings = this.plugin.settings;
    const target = index + delta;
    if (target < 0 || target >= settings.grids.length) return;
    const [moved] = settings.grids.splice(index, 1);
    settings.grids.splice(target, 0, moved);
    await this.plugin.saveSettings();
    if (!record) return;
    this.history.push({
      label: `Move ${moved.name}`,
      undo: () => this.reorderGridDef(target, -delta, false),
      redo: () => this.reorderGridDef(index, delta, false),
    });
  }

  /**
   * A grid dragged in the rail to just before or after another. Undo puts
   * the whole list back as it was, which is simpler than working out the
   * reverse move and cannot drift from it.
   */
  private async moveGridBeside(name: string, beside: string, after: boolean): Promise<void> {
    const grids = this.plugin.settings.grids;
    const from = grids.findIndex((grid) => grid.name === name);
    const to = grids.findIndex((grid) => grid.name === beside);
    if (from < 0 || to < 0) return;
    await this.putInOrder(grids, moveBeside(grids, from, to, after), `Move ${name}`);
  }

  /** The same for a folder, among its own grid's folders. */
  private async moveFolderBeside(
    grid: string,
    name: string,
    beside: string,
    after: boolean
  ): Promise<void> {
    const folders = this.plugin.settings.folders;
    const from = folders.findIndex((folder) => folder.grid === grid && folder.name === name);
    const to = folders.findIndex((folder) => folder.grid === grid && folder.name === beside);
    if (from < 0 || to < 0) return;
    await this.putInOrder(folders, moveBeside(folders, from, to, after), `Move ${name}`);
  }

  /** A drop on the rail, whichever of its five meanings it has. */
  private async onRailDrop(drop: RailDrop): Promise<void> {
    switch (drop.kind) {
      case "grid-order":
        return this.moveGridBeside(drop.grid, drop.beside, drop.after);
      case "folder-order":
        return this.moveFolderBeside(drop.grid, drop.folder, drop.beside, drop.after);
      case "folder-move": {
        const folder = this.plugin.settings.folders.find(
          (f) => f.grid === drop.grid && f.name === drop.folder
        );
        if (folder) await this.moveFoldersTo([folder], drop.into);
        return;
      }
      case "promote":
        return this.promoteFolder(drop.grid, drop.folder, { grid: drop.beside, after: drop.after });
      case "demote":
        return this.demoteGrid(drop.grid, drop.into, { folder: drop.beside, after: drop.after });
    }
  }

  /** The clippings in one folder of one grid, whichever grid is on screen. */
  private membersOfFolder(gridKey: string, name: string): string[] {
    return filterByGrid(
      this.plugin.index.records(),
      this.gridNameFor(gridKey),
      this.plugin.settings.homeGridName,
      this.registered()
    )
      .filter((record) => record.folder.trim() === name)
      .map((record) => record.path);
  }

  /**
   * A folder made a grid of its own, with every clipping in it.
   *
   * The definitions change first and the clippings follow: in folder mode the
   * directory's move is what the registry sync hears, and by then the new
   * grid is already in the list, where the sync keeps it with its look rather
   * than adding it plain at the end. Placed beside `beside` when it was
   * dropped there, and just after the grid it came off otherwise.
   */
  private async promoteFolder(
    gridKey: string,
    name: string,
    beside?: { grid: string; after: boolean },
    record = true
  ): Promise<void> {
    const settings = this.plugin.settings;
    const folder = settings.folders.find((f) => f.grid === gridKey && f.name === name);
    if (!folder) return;
    const refusal =
      promotionRefusal(folder, settings.grids, settings.homeGridName) ??
      ((await this.plugin.placement.isFree(name)) ? null : `there is already a folder called ${name} beside the grids`);
    if (refusal) {
      new Notice(`Goko: ${refusal}`);
      return;
    }

    const from = settings.grids.find((g) => g.name === gridKey);
    const grid = promotedGrid(folder, from);
    const members = this.membersOfFolder(gridKey, name);
    const placement = this.placementOf(members);
    const wasGrids = [...settings.grids];
    const wasFolders = [...settings.folders];
    const inside = this.openFolder === name && this.gridKey() === gridKey;

    const nextGrids = insertBeside(
      settings.grids,
      grid,
      (g) => g.name === (beside?.grid ?? gridKey),
      beside?.after ?? true
    );
    settings.grids.splice(0, settings.grids.length, ...nextGrids);
    settings.folders.splice(settings.folders.indexOf(folder), 1);
    await this.plugin.saveSettings();

    if (this.byFolders) {
      const moved = await this.plugin.placement.relocate({ grid: this.gridNameFor(gridKey), folder: name }, { grid: name });
      if (!moved) {
        settings.grids.splice(0, settings.grids.length, ...wasGrids);
        settings.folders.splice(0, settings.folders.length, ...wasFolders);
        await this.plugin.saveSettings();
        this.refresh();
        return;
      }
    } else if (members.length > 0) {
      await this.assign(members, name);
    }

    if (inside) this.activate(name);
    else this.refresh();
    new Notice(`Goko: ${name} is a grid now`);
    if (!record) return;
    this.history.push({
      label: `Make ${name} a grid`,
      undo: async () => {
        settings.grids.splice(0, settings.grids.length, ...wasGrids);
        settings.folders.splice(0, settings.folders.length, ...wasFolders);
        const following = settings.activeGrid === name;
        if (following) settings.activeGrid = this.gridNameFor(gridKey);
        await this.plugin.saveSettings();
        if (this.byFolders) {
          await this.plugin.placement.relocate({ grid: name }, { grid: this.gridNameFor(gridKey), folder: name });
        } else {
          await this.restorePlacement(placement, members);
        }
        if (following) this.spaceBar?.setActive(this.activeGrid());
        this.refresh();
      },
      redo: () => this.promoteFolder(gridKey, name, beside, false),
    });
  }

  /**
   * A grid made a folder on another, with every clipping on it.
   *
   * Refused, with the reason, for anything demotionRefusal refuses: a view, a
   * grid with folders of its own, a name the target's folders already use.
   * Placed beside `beside` among the target's folders, or after the last.
   */
  private async demoteGrid(
    name: string,
    into: string,
    beside?: { folder: string | null; after: boolean },
    record = true
  ): Promise<void> {
    const settings = this.plugin.settings;
    const grid = settings.grids.find((g) => g.name === name);
    if (!grid) return;
    const target = settings.grids.find((g) => g.name === into);
    const refusal =
      demotionRefusal(grid, target, settings.folders) ??
      ((await this.plugin.placement.isFree(into, name)) ? null : `${into} already has a folder called ${name}`);
    if (refusal) {
      new Notice(`Goko: ${refusal}`);
      return;
    }

    const folder = demotedFolder(grid, into);
    const members = membersOf(this.plugin.index.records(), name).map((r) => r.path);
    const placement = this.placementOf(members);
    const wasGrids = [...settings.grids];
    const wasFolders = [...settings.folders];
    const wasStage = settings.gridTileSizes[name];
    const wasActive = settings.activeGrid;

    const last = settings.folders.filter((f) => f.grid === into).at(-1)?.name ?? null;
    const anchor = beside?.folder ?? last;
    const nextFolders = insertBeside(
      settings.folders,
      folder,
      (f) => f.grid === into && f.name === anchor,
      beside?.folder ? beside.after : true
    );
    settings.folders.splice(0, settings.folders.length, ...nextFolders);
    settings.grids.splice(settings.grids.indexOf(grid), 1);
    delete settings.gridTileSizes[name];
    const inside = settings.activeGrid === name;
    if (inside) settings.activeGrid = into;
    await this.plugin.saveSettings();

    if (this.byFolders) {
      const moved = await this.plugin.placement.relocate({ grid: name }, { grid: into, folder: name });
      if (!moved) {
        settings.grids.splice(0, settings.grids.length, ...wasGrids);
        settings.folders.splice(0, settings.folders.length, ...wasFolders);
        if (wasStage !== undefined) settings.gridTileSizes[name] = wasStage;
        settings.activeGrid = wasActive;
        await this.plugin.saveSettings();
        this.refresh();
        return;
      }
    } else if (members.length > 0) {
      await this.assign(members, into, name);
    }

    if (inside) {
      this.spaceBar?.setActive(this.activeGrid());
      this.enterFolder(name);
    }
    this.refresh();
    new Notice(`Goko: ${name} is a folder on ${into} now`);
    if (!record) return;
    this.history.push({
      label: `Make ${name} a folder`,
      undo: async () => {
        settings.grids.splice(0, settings.grids.length, ...wasGrids);
        settings.folders.splice(0, settings.folders.length, ...wasFolders);
        if (wasStage !== undefined) settings.gridTileSizes[name] = wasStage;
        // Back onto the grid itself if the wall had followed it into the
        // folder it became, rather than left inside a folder that is gone.
        const following = settings.activeGrid === into && this.openFolder === name;
        if (following) {
          settings.activeGrid = name;
          this.openFolder = null;
          this.spaceBar?.setFolder(null);
        }
        await this.plugin.saveSettings();
        if (this.byFolders) {
          await this.plugin.placement.relocate({ grid: into, folder: name }, { grid: name });
        } else {
          await this.restorePlacement(placement, members);
        }
        if (following) this.spaceBar?.setActive(this.activeGrid());
        this.refresh();
      },
      redo: () => this.demoteGrid(name, into, beside, false),
    });
  }

  /**
   * Rewrites a list in place, so everything holding the settings' own array
   * sees the new order, and records the old order as its undo.
   */
  private async putInOrder<T>(list: T[], next: readonly T[], label: string, record = true): Promise<void> {
    const was = [...list];
    list.splice(0, list.length, ...next);
    await this.plugin.saveSettings();
    this.refresh();
    if (!record) return;
    this.history.push({
      label,
      undo: () => this.putInOrder(list, was, label, false),
      redo: () => this.putInOrder(list, next, label, false),
    });
  }

  private async removeGridDef(index: number, record = true): Promise<void> {
    const settings = this.plugin.settings;
    const [removed] = settings.grids.splice(index, 1);
    if (!removed) return;
    // In folder mode there is a directory to take away, and clippings inside
    // it to bring home first. Never a delete of the clippings: a board is a
    // way of looking at them, not a container that owns them.
    if (this.byFolders && !isSmartGrid(removed)) {
      await this.plugin.placement.removeGrid(removed.name);
    }
    // Members keep a key that no longer resolves, which spaces.ts reads as
    // home. Nothing is rewritten, so recreating the grid undoes this.
    if (settings.activeGrid === removed.name) {
      settings.activeGrid = settings.homeGridName;
      // Home arrives whole, as it would through activate().
      this.filter = emptyFilter();
    }
    await this.plugin.saveSettings();
    this.spaceBar?.setActive(this.activeGrid());
    this.refresh();
    if (!record) return;
    this.history.push({
      label: `Delete ${removed.name}`,
      undo: async () => {
        settings.grids.splice(Math.min(index, settings.grids.length), 0, removed);
        await this.plugin.saveSettings();
        this.refresh();
      },
      redo: () => this.removeGridDef(settings.grids.indexOf(removed), false),
    });
  }
}
