import { App, Platform, setIcon } from "obsidian";
import { resourceUrl } from "./convert";
import {
  clampCamera,
  clampZoom,
  initialCamera,
  preserveAnchor,
  revealCamera,
  staleTouches,
  visibleContentBand,
} from "./core/camera";
import type { Camera, Point } from "./core/camera";
import { tileBadges, tilePills } from "./core/badges";
import { computeIslands, islandAt } from "./core/islands";
import type { IslandHeader, IslandHit } from "./core/islands";
import type { TileSlots } from "./core/badges";
import { DEFAULT_STAGE, stageColumns } from "./core/density";
import type { DensityStage } from "./core/density";
import { COVER_COUNT, collagePlan, heightRatioFor, spanFor, widthForDrag } from "./core/folders";
import { DRAG_TYPE, dragPayload, dragSet } from "./core/drag";
import { coverBand, coverDropTarget, offersCover } from "./core/cover-drop";
import type { CoverDropTarget } from "./core/cover-drop";
import type { FolderTileModel, FolderWidth } from "./core/folders";
import {
  computeLayout,
  pressureAt,
  shouldMountAll,
  visibleRange,
} from "./core/layout";
import type { Box, LayoutResult, Position } from "./core/layout";
import {
  MARQUEE_SLOP,
  idsInRect,
  mergeSelection,
  rangeSelection,
  rectFromCorners,
  toggleSelection,
} from "./core/selection";
import type { Rect } from "./core/selection";
import { setGlyph } from "./glyph";
import type { PlaceChip } from "./core/places";
import type { TileModel } from "./core/tile";
import { mediaCount, noteText, noteTileHeight, previewOf, showsPlayMark } from "./core/tile";
import { domainOf } from "./core/scan";
import { extensionOf } from "./core/formats";
import { segmentIndex } from "./core/carousel";

/** The side of the small card a drag carries, matching .pg-drag-ghost. */
/**
 * How much bigger a card gets when the cursor rests on it at the tightest
 * stage. Twice over is enough to read a card without turning the wall into
 * a slideshow of one card at a time.
 */
const MAGNIFY = 2;

/** How many thumbnails a dragged stack shows before the count carries the rest. */
const DRAG_GHOST_FAN = 3;

/** Layout gap. Cards sit inset inside their box, adding SELECT_LIFT a side. */
/**
 * One section of the wall while the inbox is being sorted: where these cards
 * are proposed to go, and whether you have said yes to it.
 *
 * The key is the grid's name, and "" is the island nothing spoke up for.
 * The wall draws what it is given and decides nothing: which cards are in an
 * island, and why, is the view's business.
 */
export interface IslandModel {
  key: string;
  label: string;
  icon: string;
  /** Folded to its heading, by a click on it. */
  collapsed: boolean;
  /** The loose cards, in no folder, in the order the wall should show them. */
  ids: readonly string[];
  /** Why these cards are here, in a few words, or "" for the unsure island. */
  why?: string;
  /** Folders on this grid with cards proposed for them. */
  pockets: IslandPocketModel[];
  /** A button on the heading offering something other than Accept: the
      undecided pile uses it to offer a new grid for what its cards share. */
  offer?: { label: string };
}

/** Where a card is suggested to go, as its corner chip says it. */
export interface Suggestion {
  label: string;
  icon: string;
  /** The reason, for the chip's tooltip. */
  why: string;
  /** Strong is safe to accept unread; fair is worth a glance first. */
  strength: "strong" | "fair";
}

/** A folder on an island's grid, with the cards going into it. */
export interface IslandPocketModel {
  key: string;
  label: string;
  icon: string;
  ids: readonly string[];
  why?: string;
}

const GAP = 6;

/**
 * How tall an island's heading is, in content units.
 *
 * Fixed rather than measured: the layout is computed before anything is in
 * the DOM, which is what lets the whole wall resolve in one pass, and a
 * heading is one line of text whose height is not in question.
 */
const ISLAND_HEADER_H = 44;
/** A pocket's heading: one line, smaller than the island's. */
const POCKET_HEADER_H = 34;

/**
 * How close to the top or bottom edge a dragged card has to come before the
 * wall starts moving under it, and how fast it moves at the very edge.
 *
 * A drag cannot scroll: the pointer is busy holding the card, and the wheel
 * is not read during a drag. Without this, a card at the bottom of a long
 * wall could never reach an island at the top of it.
 */
const DRAG_EDGE = 64;
const DRAG_SCROLL_MAX = 22;

/** How far below an island's last row a drop still counts as that island. */
const ISLAND_DROP_SLACK = 48;



/**
 * Room between an island's cards and the band behind them. The heading's
 * left padding in styles.css is the same number, so the icon lines up with
 * the cards' edge.
 */
const ISLAND_INSET = 14;

/** One key for a pocket's elements: a folder name is unique only on its grid. */
function pocketKey(island: string, pocket: string): string {
  return `${island}/${pocket}`;
}

function hitToOver(hit: IslandHit | null): { key: string; pocket: string | null } | null {
  return hit ? { key: hit.island.key, pocket: hit.pocket?.key ?? null } : null;
}
/**
 * How far a selected card grows on every edge. It lives inside the tile's
 * own inset, so expansion can never overlap a neighbour, and it is applied
 * as a per-tile scale rather than an inset change so the compositor can
 * animate it without laying out.
 */
const SELECT_LIFT = 4;

/** Must match the leave animation in styles.css. */
/* Must outlast the pg-vanish keyframes, or the element returns to the pool
   mid-animation and the departure is cut off. */
const LEAVE_MS = 260;
/* Matches the pg-pop keyframes. */
const ENTER_MS = 460;
/** Per-tile delay when several enter at once, capped so a big batch is not slow. */
const ENTER_STAGGER_MS = 28;
const ENTER_STAGGER_CAP = 6;
const OVERSCAN = 600;
const MAX_OVERSCAN = 1500;
/**
 * At or below this many tiles the whole wall is mounted and never recycled.
 * See shouldMountAll in layout.ts for why, and why the figure is deliberately
 * cautious rather than as high as the DOM could bear.
 */
const MOUNT_ALL_BUDGET = 150;
/** Movement past which a pointer gesture is a pan, not a click. */
const CLICK_SLOP = 3;
/**
 * How long a finger must rest on a card before it starts a selection.
 * Long enough not to fire on a slow flick, short enough that the gesture
 * feels answered rather than ignored.
 */
const LONG_PRESS_MS = 450;
/**
 * A finger wanders further than a mouse does, so a press survives more
 * travel than a click before it is reclassified as a pan.
 */
const TOUCH_SLOP = 10;
/** Degrees a card tips at its edges. Small: it should read as give, not spin. */
/** How long the reel takes to slide one frame. Matched in styles.css. */
const TRACK_SLIDE_MS = 300;

/**
 * How long a finger rests on a folder before its resize handles show. A
 * mouse gets them on hover; a finger has no hover, so it asks by holding.
 */
const HANDLE_PRESS_MS = 450;
/** How long the wall stays dimmed around a folder that has just been made. */
const SPOTLIGHT_MS = 1600;

interface TileElement {
  root: HTMLElement;
  media: HTMLElement | null;
  id: string;
  signature: string;
  kind: string;
  /**
   * The clipping's other pictures, resolved once on mount. Empty for the
   * ordinary card, which is most of them, so scrubbing costs a length check.
   */
  reel: TileModel[];
  /** Which of the reel is painted. 0 is the cover the card mounted with. */
  frame: number;
  dots: HTMLElement | null;
  /**
   * The sliding strip of the reel's pictures, built when scrubbing starts and
   * taken down when it ends.
   *
   * A separate layer rather than a replacement for the cover: `media` is what
   * the reveal, the measure, the error fallback and the playback controller all
   * hold, and swapping it for a strip would have to teach each of them about
   * reels. The cover stays exactly as it was, under a strip that only exists
   * while the pointer is on the card.
   */
  track: HTMLElement | null;
}

/**
 * A pannable, zoomable canvas of virtualized masonry tiles.
 *
 * The camera is a transform on a single layer rather than scroll position,
 * which is what allows zooming and panning into empty space. Only the tiles
 * inside the camera's content band exist in the DOM, and scrolling reuses
 * elements from a pool rather than building them.
 */
export class GridRenderer {
  private viewport: HTMLElement;
  private canvas: HTMLElement;
  private tiles: TileModel[] = [];
  private byId = new Map<string, TileModel>();
  /**
   * Folder tiles, laid out ahead of the clippings and spanning columns. Kept
   * apart from `tiles` so selection, keyboard travel and playback, which all
   * walk that list, never see one: a folder is not a clipping and none of
   * those should reach it.
   */
  private folders: FolderTileModel[] = [];
  private folderById = new Map<string, FolderTileModel>();
  private mountedFolders = new Map<string, HTMLElement>();
  private knownFolders = new Set<string>();
  /** The last layout's column geometry, which a corner drag snaps against. */
  private columns = 1;
  private columnWidth = 0;
  private handlePress = 0;
  /** A folder just made: it pops in alone while the rest of the wall dims. */
  private spotlightId: string | null = null;
  private spotlightTimer = 0;
  private layout: LayoutResult = { positions: [], totalHeight: 0 };
  private mounted = new Map<string, TileElement>();
  /** Fires as a drag off the wall begins, with what it carries. */
  onDragStarted: ((ids: string[]) => void) | null = null;
  /** Clippings dropped onto a folder's card on the wall. */
  onDropIntoFolder: ((ids: string[], folder: string) => void) | null = null;
  /** The card being scrubbed, so leaving it can put its cover back. */
  private scrubbedId: string | null = null;
  private pool: TileElement[] = [];
  private frame = 0;
  private relayoutFrame = 0;
  private onWindowDragEnd: (() => void) | null = null;
  /**
   * The band across a card's foot while a picture from outside is over it:
   * let go there and the picture becomes that card's cover.
   *
   * Drawn in a layer of its own over the view rather than inside the card.
   * The wall's drop frame lies blurred over the whole wall, and the band has
   * to read through it; nothing inside the viewport can, the viewport being a
   * stacking context of its own.
   */
  private coverLayer: HTMLElement;
  private coverBandEl: HTMLElement;
  /** The card offering its band, and whether the pointer is on the band. */
  private coverOffer: { root: HTMLElement; onBand: boolean } | null = null;
  private measured = new Map<string, { w: number; h: number }>();
  /** Ids present in the previous setTiles, to tell new tiles from newly visible ones. */
  private known = new Set<string>();
  private entering = new Set<string>();
  /**
   * Set for the one render following a replace. Holds off the glide, so the
   * wall restages instead of every survivor sliding to a new spot.
   */
  private restaging = false;
  /** Elements playing their leave animation, no longer eligible for reuse. */
  private leaving = new Set<TileElement>();

  private camera: Camera = { x: 0, y: 0, zoom: 1 };
  private contentWidth = 0;
  private placed = false;

  private spaceHeld = false;
  private panning = false;
  private panMoved = false;
  /**
   * Live touches by pointer id. A finger is the only pointer the wall
   * tracks by identity: mouse gestures are told apart by button and
   * modifier, but two touches are distinguishable only by their ids.
   */
  private touches = new Map<number, Point>();
  private touchPan: { x: number; y: number; camX: number; camY: number } | null = null;
  private readonly nativeScroll: boolean;
  /** Sized to the scaled wall, so the browser has something to scroll over. */
  private scroller: HTMLElement | null = null;
  private onScroll: (() => void) | null = null;
  private longPress = 0;
  /**
   * Touch has no modifier keys, so multi-select is a mode rather than a
   * chord: a long press turns it on and taps then add and remove, the way
   * Photos and Files do it. Cleared when the selection empties.
   */
  private touchSelecting = false;
  private panOrigin = { x: 0, y: 0, camX: 0, camY: 0 };
  private onKeyDown: ((event: KeyboardEvent) => void) | null = null;
  private onKeyUp: ((event: KeyboardEvent) => void) | null = null;
  private onBlur: (() => void) | null = null;

  private marquee: HTMLElement;
  private selection = new Set<string>();
  private selecting = false;
  private selectionBase = new Set<string>();
  private marqueeOrigin = { x: 0, y: 0 };
  private marqueeMoved = false;
  /** Where a shift-click measures its range from. */
  private selectionAnchor: string | null = null;

  private positionById = new Map<string, Position>();
  private hoveredId: string | null = null;
  private pointer: { x: number; y: number } | null = null;
  private hoverFrame = 0;
  private hoveredMedia: HTMLVideoElement | HTMLImageElement | null = null;
  /** The card under the pointer changed. Set by the view, to drive playback
      for a wall whose autoplay is off. */
  onHoverMedia:
    | ((media: HTMLVideoElement | HTMLImageElement | Array<HTMLVideoElement | HTMLImageElement> | null) => void)
    | null = null;

  /** The card currently open in the detail view, hidden while it is. */
  private focusedId: string | null = null;

  onRendered: () => void = () => {};
  onSourceFailed: (id: string, signature: string) => void = () => {};
  /**
   * A cover whose file the vault could not resolve, which is not the same as
   * one that failed to load. See PendingSources.
   */
  onSourcePending: (id: string, signature: string) => void = () => {};
  onSelectionChanged: (ids: string[]) => void = () => {};
  onDeleteRequested: (ids: string[]) => void = () => {};
  onPropertiesRequested: (ids: string[]) => void = () => {};
  onContextRequested: (ids: string[], x: number, y: number) => void = () => {};
  onExportRequested: (ids: string[]) => void = () => {};
  onOpenFolder: (name: string) => void = () => {};
  /** A card with no picture was opened: its note is the thing to show. */
  onOpenNoteRequested: (id: string) => void = () => {};
  /**
   * A picture was dropped onto one card's cover band: it becomes that card's
   * cover. Answers whether the drop was taken, so a transfer nothing here
   * wants carries on to the wall and is clipped as a new card instead.
   */
  onCoverDropped: (id: string, transfer: DataTransfer) => boolean = () => false;
  /**
   * The pointer has moved onto a card's cover band with a picture in flight,
   * or off it again.
   *
   * The wall frames itself for a drop as soon as one enters, and that frame
   * promises a new clipping. On the band that promise is wrong, so the frame
   * is taken down and the band is the only thing saying where the picture is
   * going; anywhere else over a card the promise holds, and the frame is up.
   */
  onCoverAim: (aimed: boolean) => void = () => {};
  onFolderContextRequested: (name: string, x: number, y: number) => void = () => {};
  /** Right-click on the wall itself, with no card or folder under it. */
  onSpaceContextRequested: (x: number, y: number) => void = () => {};
  /** A corner drag ended on a different width. The caller persists it. */
  onFolderResized: (name: string, width: FolderWidth) => void = () => {};
  onOpenDetail: (
    model: TileModel,
    origin: { rect: { x: number; y: number; w: number; h: number }; at: { x: number; y: number } }
  ) => void = () => {};

  /**
   * The tile-size stage the layout follows; stageColumns turns it into
   * columns. Set through setDensity, which also stamps it on the viewport so
   * the stylesheet can trim the card chrome that stops fitting as the
   * columns narrow.
   */
  private density: DensityStage = DEFAULT_STAGE;

  constructor(private app: App, container: HTMLElement) {
    this.viewport = container.createDiv({ cls: "pg-viewport" });
    this.viewport.dataset.density = DEFAULT_STAGE;

    /*
     * On touch the wall is scrolled by the browser rather than by us.
     *
     * WebKit's scroller already has momentum and rubber-banding, written by
     * the people who decided what those should feel like and running off the
     * main thread. Reimplementing it means guessing constants and getting a
     * worse answer, so the viewport becomes a real scroll box and a spacer
     * sized to the wall gives it something to travel over. The camera stops
     * being state we animate and becomes a reading of the scroll position.
     *
     * Desktop keeps the transform camera: it has a wheel, a held space and a
     * marquee, none of which a scroll box would improve.
     */
    this.nativeScroll = Platform.isMobile;
    if (this.nativeScroll) {
      this.viewport.addClass("is-native-scroll");
      this.scroller = this.viewport.createDiv({ cls: "pg-scroll" });
      this.canvas = this.scroller.createDiv({ cls: "pg-canvas" });
      this.onScroll = () => this.readScroll();
      this.viewport.addEventListener("scroll", this.onScroll, { passive: true });
    } else {
      this.canvas = this.viewport.createDiv({ cls: "pg-canvas" });
    }

    this.coverLayer = container.createDiv({ cls: "pg-cover-layer" });
    this.coverBandEl = this.coverLayer.createDiv({
      cls: "pg-cover-band",
      text: "Drop to set as cover",
    });

    // A drag cancelled over a card (Escape, or a drop refused by the system)
    // does not always send dragleave, and the band would stay up on a wall
    // nothing is being carried over any more.
    this.onWindowDragEnd = () => this.offerCover(null);
    window.addEventListener("dragend", this.onWindowDragEnd);
    window.addEventListener("drop", this.onWindowDragEnd);

    this.marquee = this.viewport.createDiv({ cls: "pg-marquee" });
    this.installGestures();
    this.installSelection();
    this.installIslandDrops();
    this.installHover();
    this.installTouch();
  }

  get viewportEl(): HTMLElement {
    return this.viewport;
  }

  get zoom(): number {
    return this.camera.zoom;
  }

  /** What a hovered tile shows; see badges.ts. */
  private tileSlots: TileSlots = { property: "" };

  /**
   * Redraws every mounted card's badges in place. A card keeps its DOM for as
   * long as its cover is unchanged, so this is the only way a settings change
   * reaches tiles already on screen.
   */
  setTileSlots(slots: TileSlots): void {
    // Repainting every mounted tile's badges is real work, and this is now
    // called on every settings save rather than only when a corner changes.
    // Same bargain setDensity makes one method up.
    if (slots.property === this.tileSlots.property) return;
    this.tileSlots = { ...slots };
    this.repaintMetas();
  }

  /** Whether the title caption is drawn along the bottom of a hovered card. */
  private tileTitle = true;

  /**
   * Suggestions: where the grids say each card belongs, drawn as a chip in
   * the card's corner. A chip is a proposal, and tapping it agrees: the
   * wall does not decide what that means, the view does.
   */
  private suggestions: ReadonlyMap<string, Suggestion> = new Map();
  /** Where each card is filed. The library names the whole path, a board's
      own wall names only the folder, and a card loose on that wall gets no
      chip, there being nothing to say. */
  private places: ReadonlyMap<string, PlaceChip> = new Map();
  onSuggestionTap: ((id: string) => void) | null = null;
  /** The chip's own no: the suggestion is waved away, the card stays. */
  onSuggestionDismiss: ((id: string) => void) | null = null;

  /** The card under the pointer, for a key that acts on it. */
  get hoveredTile(): string | null {
    return this.hoveredId;
  }


  setSuggestions(suggestions: ReadonlyMap<string, Suggestion>): void {
    this.suggestions = suggestions;
    for (const [id, element] of this.mounted) this.paintSuggestion(element, id);
  }

  setPlaces(places: ReadonlyMap<string, PlaceChip>): void {
    this.places = places;
    for (const [id, element] of this.mounted) this.paintPlace(element, id);
  }

  /**
   * The chip saying where this card is filed.
   *
   * The same corner and the same shape as the suggestion above, because the
   * two are the same idea at two stages: the inbox says where a card could
   * go, everywhere else says where it went. On the inbox both can be up on
   * the same card, and the suggestion — the one that wants a tap — sits
   * above.
   *
   * Not a button. Clicking it to jump to that grid is the obvious next move
   * and the wrong one here: the click belongs to the card, and a target
   * inside a target is how you open the wrong thing.
   */
  private paintPlace(element: TileElement, id: string): void {
    const frame = element.root.querySelector<HTMLElement>(".pg-frame");
    if (!frame) return;
    frame.querySelector(".pg-place")?.remove();
    const place = this.places.get(id);
    if (!place) return;

    const chip = frame.createDiv({ cls: "pg-place" });
    chip.toggleClass("is-loose", !place.filed);
    const glyph = chip.createSpan({ cls: "pg-place-icon" });
    setIcon(glyph, place.icon);
    if (place.color) glyph.style.color = place.color;
    chip.createSpan({ cls: "pg-place-name", text: place.label });
  }

  /**
   * The chip in the corner of one card.
   *
   * Bottom left, away from the marks a card makes about itself: the kind is
   * top left and the count top right, and a suggestion must not be mistaken
   * for something the clipping says. Always up rather than on hover, since
   * it is the thing to tap.
   */
  private paintSuggestion(element: TileElement, id: string): void {
    const frame = element.root.querySelector<HTMLElement>(".pg-frame");
    if (!frame) return;
    frame.querySelector(".pg-suggest")?.remove();
    const suggestion = this.suggestions.get(id);
    // Said on the tile for the caption's sake (see .pg-tile.has-suggestion),
    // rather than asked of it with :has().
    element.root.toggleClass("has-suggestion", suggestion !== undefined);
    if (!suggestion) return;
    // Two segments, one yes and one no, so agreeing and disagreeing cost the
    // same single tap. A no that took a menu was a no nobody gave.
    const chip = frame.createDiv({ cls: "pg-suggest" });
    chip.toggleClass("is-strong", suggestion.strength === "strong");
    const yes = chip.createDiv({ cls: "pg-suggest-yes", attr: { "aria-label": suggestion.why } });
    setIcon(yes.createSpan({ cls: "pg-suggest-icon" }), suggestion.icon);
    // A fair suggestion says so in the plainest way there is: a question
    // mark. Colour alone was read as inconsistency, not as confidence.
    yes.createSpan({
      cls: "pg-suggest-name",
      text: suggestion.strength === "fair" ? `${suggestion.label}?` : suggestion.label,
    });
    yes.onclick = (event: MouseEvent) => {
      // The card must not open as well: the tap was for the chip.
      event.stopPropagation();
      this.onSuggestionTap?.(element.root.dataset.tileId ?? id);
    };
    const no = chip.createDiv({ cls: "pg-suggest-no", attr: { "aria-label": "Not there" } });
    setIcon(no, "x");
    no.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      this.onSuggestionDismiss?.(element.root.dataset.tileId ?? id);
    };
  }

  /** The islands the wall is laid out in, or null for the flat wall. */
  private islands: IslandModel[] | null = null;
  private islandHeaders: IslandHeader[] = [];
  private islandEls = new Map<string, HTMLElement>();
  /** The band behind each island, sized to it, lit while a card is over it. */
  private islandBands = new Map<string, HTMLElement>();
  /** Pocket headings and bands, keyed by island and folder. */
  private pocketEls = new Map<string, HTMLElement>();
  private pocketBands = new Map<string, HTMLElement>();
  /** Where a drag is currently over, for the highlight. */
  private dragOver: { key: string; pocket: string | null } | null = null;
  /**
   * The cards a drag is carrying, so the ones left behind can read as lifted
   * rather than as still sitting there. The browser paints the drag image;
   * this is the other half of the same gesture.
   */
  private dragging = new Set<string>();
  /** A drag from the wall began or ended: the rail reveals its targets. */
  onDragLifted: ((lifted: boolean) => void) | null = null;
  private dragScrollFrame = 0;
  private dragPointerY = 0;
  private dragSeenAt = 0;
  /** The Accept button on a heading: the island is agreed to, or not any more. */
  onIslandAccepted: ((key: string) => void) | null = null;
  /** A heading clicked: fold the island to its heading, or open it again. */
  onIslandFolded: ((key: string) => void) | null = null;
  /** The heading's offer taken, on an island that carries one. */
  onIslandOffer: ((key: string) => void) | null = null;
  /** Cards dropped anywhere on an island, or in one of its pockets. */
  onIslandDropped: ((ids: string[], key: string, folder: string) => void) | null = null;

  /**
   * Lays the wall out in sections, one per proposed destination.
   *
   * The camera goes back to the top rather than following its anchor tile:
   * this is a change of mode, not a repaint of the same wall, and every
   * height on it is now different. Following an anchor through that lands
   * you somewhere arbitrary in the middle of a layout you have not seen.
   */
  setIslands(islands: IslandModel[] | null): void {
    // Only the change of mode moves the camera. Islands are rebuilt whenever
    // a mark changes, several times a minute, and a wall that jumped to the
    // top each time you ticked something would be unusable.
    const changed = (this.islands === null) !== (islands === null);
    this.islands = islands;
    this.viewport.toggleClass("is-islands", Boolean(islands));
    if (!islands) {
      for (const held of [this.islandEls, this.islandBands, this.pocketEls, this.pocketBands]) {
        for (const element of held.values()) element.remove();
        held.clear();
      }
      this.islandHeaders = [];
      this.stopDragScroll();
    }
    if (changed) this.placed = false;
    this.relayout();
    this.schedule();
  }

  setTileCaption(on: boolean): void {
    if (this.tileTitle === on) return;
    this.tileTitle = on;
    this.repaintMetas();
  }

  private repaintMetas(): void {
    for (const [id, element] of this.mounted) {
      const model = this.byId.get(id);
      const meta = element.root.querySelector<HTMLElement>(".pg-meta");
      if (!model || !meta) continue;
      meta.empty();
      this.paintBadges(meta, model);
    }
  }

  /**
   * Takes one property write onto a tile that is already on screen.
   *
   * Two things stop the wall's own repaint from showing it. The repaint is
   * held while a menu or a selection is up, which is exactly when the
   * property menu writes; and when it does arrive it skips the card anyway,
   * because a card keeps its DOM for as long as its cover is unchanged and a
   * frontmatter edit changes no cover. So the value goes onto the model and
   * the pills are redrawn here. The next rebuild reads the note and agrees.
   */
  setRecordProperty(id: string, key: string, values: string[]): void {
    const model = this.byId.get(id);
    if (!model) return;

    // Copied rather than written through: the record object belongs to the
    // index, which has its own reading of the note on the way.
    const properties = { ...model.record.properties };
    if (values.length === 0) delete properties[key];
    else properties[key] = [...values];
    model.record = { ...model.record, properties };

    const meta = this.mounted.get(id)?.root.querySelector<HTMLElement>(".pg-meta");
    if (!meta) return;
    meta.empty();
    this.paintBadges(meta, model);
  }

  /**
   * Swaps one card's model for a new one and lays the wall out again.
   *
   * For a change to what a card *shows* rather than to what it says — a
   * cover set by hand — where setRecordProperty's repaint of the pills is
   * not enough and the view's own refresh is too much. A refresh re-runs
   * the filter over every record, which the view holds back while anything
   * is selected, and setting a cover is something you do to a card you have
   * selected. This touches the one tile and nothing else decides anything.
   */
  replaceTile(id: string, model: TileModel): void {
    const index = this.tiles.findIndex((tile) => tile.id === id);
    if (index < 0) return;
    this.tiles[index] = model;
    this.byId.set(id, model);
    // Not entering: the card is already on the wall and only its picture
    // changed, so an entrance would read as a new clipping arriving.
    this.entering.delete(id);
    this.relayout();
  }

  private paintBadges(meta: HTMLElement, model: TileModel): void {
    const badges = tileBadges(model.record, this.tileSlots);
    // The title says the one thing a wall of pictures cannot say for itself.
    // A card of words already says it, in its own type on its own sheet, so
    // it gets neither the title nor the dark fade the title needs to be
    // legible over a photograph.
    const titled = this.tileTitle && model.kind !== "note";
    // The fade is for anything white over a photograph, not for the title
    // alone: a card showing two tags and no title needs it just as much.
    meta.toggleClass("has-fade", titled || badges.length > 0);
    if (badges.length === 0 && !titled) return;

    // One block in one corner, tags above the name. They were in two places
    // with the tile's whole height between them, which on a card that is
    // mostly picture read as two unrelated things rather than as one label.
    const block = meta.createDiv({ cls: "pg-caption" });
    for (const badge of badges) {
      // A pill per value, wrapping, the tail folded into a count. Each one
      // clips with an ellipsis on its own if a single value is wider than
      // the tile; nothing moves.
      const pills = block.createDiv({ cls: "pg-badges" });
      const { shown, more } = tilePills(badge.values);
      for (const value of shown) pills.createSpan({ cls: "pg-badge", text: value });
      if (more > 0) pills.createSpan({ cls: "pg-badge is-more", text: `+${more}` });
    }
    if (titled) block.createDiv({ cls: "pg-title", text: model.record.title });
  }

  /**
   * Reflows the wall into the columns a stage asks for. The camera is left
   * to relayout, which keeps whatever tile was at the centre at the centre,
   * so stepping through the stages reads as the wall tightening around the
   * place you were looking rather than jumping back to the top.
   */
  setDensity(stage: DensityStage): void {
    this.viewport.dataset.density = stage;
    if (stage === this.density) return;
    this.density = stage;
    // Folders count as something to lay out. A grid can hold nothing but
    // folders, and this read `this.tiles.length > 0` from before they
    // existed, so such a wall stored the new stage and never reflowed to it:
    // shrink and expand did nothing until you left, changed it on a grid
    // with clippings, and came back to a wall rebuilt at the stored stage.
    // A folder's height is measured off the stage too, so it is not only
    // the columns that were stale.
    if (this.tiles.length > 0 || this.folders.length > 0) this.relayout();
  }

  private viewportSize(): { width: number; height: number } {
    return {
      width: this.viewport.clientWidth || 800,
      height: this.viewport.clientHeight || 600,
    };
  }

  private contentSize(): { width: number; height: number } {
    return { width: this.contentWidth, height: this.layout.totalHeight };
  }

  private applyCamera(smooth = false): void {
    if (this.nativeScroll) {
      // Only the zoom is ours to clamp. How far the wall may travel is the
      // scroller's business, and it is already the authority on that.
      this.camera = { ...this.camera, zoom: clampZoom(this.camera.zoom) };
      this.writeScroll(smooth);
      return;
    }
    this.camera = clampCamera(this.camera, this.viewportSize(), this.contentSize());
    this.canvas.style.transform =
      `translate3d(${this.camera.x}px, ${this.camera.y}px, 0) scale(${this.camera.zoom})`;
    this.schedule();
  }

  /**
   * Sizes the spacer to the scaled wall and moves the scroller to where the
   * camera says it should be.
   *
   * The scroll position is left alone unless it has actually drifted:
   * writing back a position the scroller has just reported would interrupt
   * the fling that is delivering it, which is the one thing this whole
   * approach exists to avoid.
   */
  private writeScroll(smooth: boolean): void {
    if (!this.scroller) return;
    const content = this.contentSize();
    const zoom = this.camera.zoom;

    this.scroller.style.width = `${content.width * zoom}px`;
    this.scroller.style.height = `${content.height * zoom}px`;
    this.canvas.style.transform = `scale(${zoom})`;

    const left = this.scrollerOffset(zoom) - this.camera.x;
    const top = -this.camera.y;
    if (
      Math.abs(this.viewport.scrollLeft - left) > 0.5 ||
      Math.abs(this.viewport.scrollTop - top) > 0.5
    ) {
      this.viewport.scrollTo({ left, top, behavior: smooth ? "smooth" : "auto" });
    }
    this.schedule();
  }

  /**
   * The camera, read back off the scroller rather than written to it.
   *
   * Deliberately not applyCamera: answering a scroll by writing a scroll
   * would fight the momentum that is producing it.
   */
  private readScroll(): void {
    this.camera = {
      ...this.camera,
      x: this.scrollerOffset(this.camera.zoom) - this.viewport.scrollLeft,
      y: -this.viewport.scrollTop,
    };
    this.schedule();
  }

  setCamera(camera: Camera): void {
    this.camera = camera;
    this.applyCamera();
  }

  private tweenFrame = 0;

  private cancelTween(): void {
    if (this.tweenFrame) window.cancelAnimationFrame(this.tweenFrame);
    this.tweenFrame = 0;
  }

  /**
   * Eases the camera to a target. Used for reset, where a
   * jump is disorienting. Gestures stay immediate, since easing a trackpad
   * would feel like lag.
   */
  private animateCamera(target: Camera, ms = 240): void {
    this.cancelTween();
    // A scroller animates itself, and better than writing a position into
    // it every frame would. Asking it to go somewhere smoothly is the tween.
    if (this.nativeScroll) {
      this.camera = target;
      this.applyCamera(true);
      return;
    }
    const start = { ...this.camera };
    const t0 = performance.now();

    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      this.camera = {
        x: start.x + (target.x - start.x) * e,
        y: start.y + (target.y - start.y) * e,
        zoom: start.zoom + (target.zoom - start.zoom) * e,
      };
      this.applyCamera();
      if (k < 1) this.tweenFrame = window.requestAnimationFrame(step);
      else this.tweenFrame = 0;
    };

    this.tweenFrame = window.requestAnimationFrame(step);
  }

  /**
   * `animate: false` places the camera outright. There is no spatial
   * continuity between two different sets of contents, so tweening from a
   * position in the old wall to one in the new is motion that means nothing,
   * and it costs a render per frame while the new images are still decoding.
   */
  resetView(animate = true): void {
    this.cancelTween();
    const size = this.viewportSize();
    this.placed = true;
    const target = initialCamera(size, this.contentSize());
    if (!animate) {
      this.camera = target;
      this.applyCamera();
      this.schedule();
      return;
    }
    this.animateCamera(target);
  }

  /**
   * `replace` means the wall is showing a different set of things, not that
   * things were added to the set it was already showing.
   *
   * It restages the whole wall: everything on it pops in at its new position
   * and nothing glides there. Gliding is right when a clipping is added to
   * the set you are already looking at, since the tiles around it are the
   * same tiles and should be followed to where they went. It is wrong when
   * the set itself changes. A filter reflows the masonry, so a dozen
   * survivors set off along a dozen different paths at once, and that reads
   * as jitter rather than as movement.
   *
   * The departure is suppressed with it. The arrival pop stays: it is what
   * makes a switch land rather than cut, and it is cheap, being bounded by
   * what is actually on screen.
   *
   * The departure is not cheap, and the cost is not the animation. playLeave
   * holds every departing element for LEAVE_MS before returning it to the
   * pool, so on a switch the pool is empty at exactly the moment the arriving
   * tiles come looking for elements, and the wall builds a screen of fresh
   * DOM instead of recycling the subtrees being vacated in front of it.
   * Releasing at once means the arrivals reuse them.
   */
  setTiles(tiles: TileModel[], options: { replace?: boolean } = {}): void {
    this.tiles = tiles;
    this.byId = new Map(tiles.map((t) => [t.id, t]));

    // New to the data, as opposed to merely scrolled into view. On a replace
    // everything counts as arriving, including whatever survived the change.
    this.entering = options.replace
      ? new Set(tiles.map((t) => t.id))
      : new Set(tiles.filter((t) => !this.known.has(t.id)).map((t) => t.id));
    this.restaging = options.replace === true;
    this.known = new Set(tiles.map((t) => t.id));

    for (const [id, element] of [...this.mounted]) {
      if (!this.byId.has(id)) {
        this.mounted.delete(id);
        if (options.replace) this.release(element);
        else this.playLeave(element);
      }
    }
    this.relayout();
  }

  /**
   * The folder tiles to show ahead of the clippings. Always followed by
   * setTiles from the view, which is what lays both out; this only reconciles
   * the mounted elements so a removed folder leaves at once.
   */
  setFolders(folders: FolderTileModel[]): void {
    this.folders = folders;
    this.folderById = new Map(folders.map((f) => [f.id, f]));
    for (const [id, element] of [...this.mountedFolders]) {
      if (!this.folderById.has(id)) {
        this.mountedFolders.delete(id);
        element.remove();
      }
    }
  }

  /**
   * Brings a folder in on its own: the rest of the wall dims for a moment
   * while the card pops, so a folder made from a selection is seen landing
   * rather than found later at the top. Applied at paint time too, since the
   * card is usually not mounted yet when this is asked for.
   */
  spotlight(id: string): void {
    window.clearTimeout(this.spotlightTimer);
    this.spotlightId = id;
    this.viewport.addClass("is-spotlight");
    this.mountedFolders.get(id)?.addClass("is-spotlit");
    this.spotlightTimer = window.setTimeout(() => {
      this.spotlightId = null;
      this.viewport.removeClass("is-spotlight");
      for (const element of this.mountedFolders.values()) element.removeClass("is-spotlit");
    }, SPOTLIGHT_MS);
  }

  /** Pops a newly arrived tile in, staggered so a batch lands as a wave. */
  private playEnter(element: TileElement, id: string, order: number): void {
    this.entering.delete(id);
    const delay = Math.min(order, ENTER_STAGGER_CAP) * ENTER_STAGGER_MS;
    element.root.style.setProperty("--pg-enter-delay", `${delay}ms`);
    element.root.addClass("is-entering");
    window.setTimeout(() => element.root.removeClass("is-entering"), delay + ENTER_MS + 60);
  }

  /** Fades a removed tile out in place, then returns its element to the pool. */
  private playLeave(element: TileElement): void {
    element.root.addClass("is-leaving");
    element.root.removeClass("is-selected");
    this.leaving.add(element);
    window.setTimeout(() => {
      this.leaving.delete(element);
      element.root.removeClass("is-leaving");
      this.release(element);
    }, LEAVE_MS);
  }

  /** The tile nearest the viewport centre, used to hold position across a relayout. */
  /**
   * The tiles nearest the viewport centre, nearest first, to hold position
   * across a relayout. Several rather than one: the nearest may be the very
   * thing being removed (a folder just deleted, a clipping just trashed),
   * and with no surviving anchor the wall used to jump by however much the
   * layout changed above the fold. relayout takes the first that survives.
   */
  private anchor(): Array<{ id: string; y: number }> {
    if (!this.placed || this.layout.positions.length === 0) return [];
    const band = visibleContentBand(this.camera, this.viewportSize());
    const centre = band.top + band.height / 2;

    return this.layout.positions
      .map((p) => ({ id: p.id, y: p.y, distance: Math.abs(p.y + p.h / 2 - centre) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 8)
      .map(({ id, y }) => ({ id, y }));
  }

  /**
   * `restage` plays a width change the way a grid switch is played: every
   * tile pops in at its new place and nothing glides there. A reflow moves
   * every tile along its own path at once, which reads as jitter, and each
   * glide is a transform transition on a tile that may be a playing video;
   * the pop is bounded by what is on screen and lands rather than cuts.
   * Only a width change restages, since only a width change reflows: a
   * height change (the keyboard, a status bar) leaves every position as it
   * was, and popping the wall for that would be noise.
   */
  relayout(options: { restage?: boolean; hold?: boolean } = {}): void {
    // A pane behind another tab measures 0 by 0. Laying it out then would
    // fall back to viewportSize's nominal size and arrange the wall for a
    // pane that does not exist, moving the camera to suit; switching back
    // laid it out again for the real width, and the tiles gliding from the
    // phantom positions to the real ones read as the wall rearranging
    // itself. Nothing is visible while hidden, so nothing is done: the
    // resize that brings the pane back is what lays it out.
    if (this.viewport.clientWidth === 0 || this.viewport.clientHeight === 0) return;

    // The wall is laid out at the unzoomed viewport width, so zooming out
    // reveals empty space around it rather than reflowing the columns.
    const anchors = this.anchor();
    const size = this.viewportSize();
    if (options.restage && this.placed && size.width !== this.contentWidth) {
      this.entering = new Set(this.tiles.map((t) => t.id));
      this.restaging = true;
    }
    this.contentWidth = size.width;
    // A phone counts columns where everything else fits a width; the rule is
    // in stageColumns, and only whether this is a phone is known here.
    const { columns, unit } = stageColumns(this.density, size.width, GAP, Platform.isPhone);
    this.columns = columns;
    this.columnWidth = (size.width - GAP * (columns - 1)) / columns;

    // Folders first: a folder is a place you go back to, and a place should
    // not move. Its height follows the tile-size setting's column width, not
    // the measured one: the measured column stretches to fill the pane, so
    // a folder that followed it was half again as tall in a narrow pane or
    // on a phone as on a full screen. On a phone that width is capped at the
    // column the count leaves (see stageColumns). The card still spans the
    // real columns.
    const folderItems = this.folders.map((f) => {
      const span = spanFor(f.folder.width, columns);
      const w = this.columnWidth * span + GAP * (span - 1);
      // From the stored width, not the clamped span, so a card keeps its
      // height on a wall too narrow to show its whole width.
      const h =
        (unit * f.folder.width + GAP * (f.folder.width - 1)) * heightRatioFor(f.folder.width);
      return { id: f.id, width: w, height: h, span };
    });

    const tileItems = this.tiles.map((t) => {
      // How tall a card of words wants to be depends on how wide it is: the
      // same note is four lines in a wide column and nine in a narrow one.
      // Its stored size is the answer at a nominal width; here the real one
      // is known, so it is asked again.
      if (t.kind === "note") {
        return {
          id: t.id,
          width: this.columnWidth,
          height: noteTileHeight(t.record, this.columnWidth),
        };
      }
      const learned = t.provisional ? this.measured.get(t.id) : undefined;
      return { id: t.id, width: learned?.w ?? t.width, height: learned?.h ?? t.height };
    });

    this.positionById.clear();
    if (this.islands) {
      // Folders are left out: sorting is a pass over loose cards, and a pile
      // standing in for five of them is five decisions you cannot make.
      const byId = new Map(tileItems.map((item) => [item.id, item]));
      const pick = (ids: readonly string[]) =>
        ids.map((id) => byId.get(id)).filter((item) => item !== undefined);
      const groups = this.islands.map((island) => ({
        key: island.key,
        items: pick(island.ids),
        collapsed: island.collapsed,
        pockets: island.pockets.map((pocket) => ({ key: pocket.key, items: pick(pocket.ids) })),
      }));
      // A tile no island claimed is by definition one nothing spoke up for.
      const claimed = new Set(
        this.islands.flatMap((island) => [
          ...island.ids,
          ...island.pockets.flatMap((pocket) => [...pocket.ids]),
        ])
      );
      const rest = tileItems.filter((item) => !claimed.has(item.id));
      if (rest.length > 0) {
        const unsure = groups.find((group) => group.key === "");
        if (unsure) unsure.items.push(...rest);
        else groups.push({ key: "", items: rest, collapsed: false, pockets: [] });
      }
      const laid = computeIslands(
        groups,
        size.width,
        columns,
        GAP,
        ISLAND_HEADER_H,
        ISLAND_INSET,
        POCKET_HEADER_H
      );
      this.layout = { positions: laid.positions, totalHeight: laid.totalHeight };
      this.islandHeaders = laid.headers;
    } else {
      this.layout = computeLayout([...folderItems, ...tileItems], size.width, columns, GAP);
    }

    for (const position of this.layout.positions) {
      this.positionById.set(position.id, position);
    }

    if (!this.placed && this.tiles.length > 0) {
      this.placed = true;
      this.camera = initialCamera(size, this.contentSize());
    } else if (anchors.length > 0 && !options.hold) {
      // `hold` keeps the camera where it is. A corner drag reflows the wall
      // under the pointer several times a second, and following the anchor
      // tile through each reflow moved the wall while the hand was still.
      // Adding a clipping inserts at the top and pushes everything down;
      // shift the camera by the same amount so the view does not jump.
      for (const anchor of anchors) {
        const moved = this.positionById.get(anchor.id);
        if (!moved) continue;
        this.camera = preserveAnchor(this.camera, anchor.y, moved.y);
        break;
      }
    }

    if (this.islands) this.paintIslands();
    this.applyCamera();
  }

  /**
   * The headings, positioned in content units inside the canvas exactly as
   * the tiles are, so the camera carries them with the wall.
   *
   * Rebuilt rather than diffed: there are a handful of them, and each one's
   * count and tick change as cards move between islands.
   */
  private paintIslands(): void {
    const wanted = new Set(this.islandHeaders.map((header) => header.key));
    for (const held of [this.islandEls, this.islandBands]) {
      for (const [key, element] of [...held]) {
        if (wanted.has(key)) continue;
        element.remove();
        held.delete(key);
      }
    }
    const wantedPockets = new Set(
      this.islandHeaders.flatMap((header) =>
        header.pockets.map((pocket) => pocketKey(header.key, pocket.key))
      )
    );
    for (const held of [this.pocketEls, this.pocketBands]) {
      for (const [key, element] of [...held]) {
        if (wantedPockets.has(key)) continue;
        element.remove();
        held.delete(key);
      }
    }

    for (const header of this.islandHeaders) {
      const model = this.islands?.find((island) => island.key === header.key);
      const unsure = header.key === "";
      const overIsland = this.dragOver?.key === header.key && this.dragOver.pocket === null;

      // The band first, so it sits under the heading in document order as
      // well as in z-order: it is the island's floor, and everything else
      // stands on it.
      let band = this.islandBands.get(header.key);
      if (!band) {
        band = this.canvas.createDiv({ cls: "pg-island-band" });
        this.islandBands.set(header.key, band);
      }
      band.style.transform = `translate3d(0px, ${header.y}px, 0)`;
      band.style.width = `${this.contentWidth}px`;
      band.style.height = `${header.bottom - header.y}px`;
      band.toggleClass("is-unsure", unsure);
      band.toggleClass("is-drop-into", overIsland);

      let element = this.islandEls.get(header.key);
      if (!element) {
        element = this.canvas.createDiv({ cls: "pg-island" });
        this.installIsland(element, header.key);
        this.islandEls.set(header.key, element);
      }
      element.style.transform = `translate3d(0px, ${header.y}px, 0)`;
      element.style.width = `${this.contentWidth}px`;
      element.style.height = `${header.height}px`;
      element.toggleClass("is-unsure", unsure);
      element.toggleClass("is-collapsed", header.collapsed);
      element.toggleClass("is-drop-into", overIsland);
      element.empty();

      // The pile nothing spoke for cannot be folded or accepted: it is the
      // work, not one of the answers, so it carries neither control.
      if (!unsure) {
        const fold = element.createDiv({ cls: "pg-island-fold" });
        setIcon(fold, header.collapsed ? "chevron-right" : "chevron-down");
      }
      const icon = element.createDiv({ cls: "pg-island-icon" });
      setIcon(icon, model?.icon ?? "layout-grid");
      element.createDiv({
        cls: "pg-island-name",
        text: model?.label ?? (header.key || "Undecided"),
      });
      if (header.count > 0) {
        element.createDiv({ cls: "pg-island-count", text: String(header.count) });
      }
      const why = model?.why?.trim();
      if (why) element.createDiv({ cls: "pg-island-why", text: why });

      if (!unsure) {
        // A button with a word on it rather than a bare circle: the island is
        // a proposal, and a proposal needs the thing that says yes to it to
        // look like one. Pressing it files every card in the island.
        const accept = element.createEl("button", { cls: "pg-island-accept" });
        accept.createSpan({ text: header.count === 1 ? "Accept" : `Accept ${header.count}` });
        accept.onclick = (event: MouseEvent) => {
          event.stopPropagation();
          this.onIslandAccepted?.(header.key);
        };
      } else if (model?.offer) {
        const offer = element.createEl("button", { cls: "pg-island-accept pg-island-offer" });
        setIcon(offer.createSpan({ cls: "pg-island-offer-icon" }), "plus");
        offer.createSpan({ text: model.offer.label });
        offer.onclick = (event: MouseEvent) => {
          event.stopPropagation();
          this.onIslandOffer?.(header.key);
        };
      }

      for (const pocket of header.pockets) {
        const pm = model?.pockets.find((candidate) => candidate.key === pocket.key);
        const id = pocketKey(header.key, pocket.key);
        const over = this.dragOver?.key === header.key && this.dragOver.pocket === pocket.key;

        let pocketBand = this.pocketBands.get(id);
        if (!pocketBand) {
          pocketBand = this.canvas.createDiv({ cls: "pg-pocket-band" });
          this.pocketBands.set(id, pocketBand);
        }
        pocketBand.style.transform = `translate3d(${ISLAND_INSET}px, ${pocket.y}px, 0)`;
        pocketBand.style.width = `${this.contentWidth - ISLAND_INSET * 2}px`;
        pocketBand.style.height = `${pocket.bottom - pocket.y}px`;
        pocketBand.toggleClass("is-drop-into", over);

        let heading = this.pocketEls.get(id);
        if (!heading) {
          heading = this.canvas.createDiv({ cls: "pg-pocket" });
          this.pocketEls.set(id, heading);
        }
        heading.style.transform = `translate3d(${ISLAND_INSET}px, ${pocket.y}px, 0)`;
        heading.style.width = `${this.contentWidth - ISLAND_INSET * 2}px`;
        heading.style.height = `${pocket.height}px`;
        heading.toggleClass("is-drop-into", over);
        heading.empty();
        setIcon(heading.createDiv({ cls: "pg-pocket-icon" }), pm?.icon ?? "folder");
        heading.createDiv({ cls: "pg-pocket-name", text: pm?.label ?? pocket.key });
        heading.createDiv({ cls: "pg-pocket-count", text: String(pocket.count) });
        const pocketWhy = pm?.why?.trim();
        if (pocketWhy) heading.createDiv({ cls: "pg-pocket-why", text: pocketWhy });
      }
    }
  }

  /**
   * A heading folds its island; the pile nothing spoke for has nothing to
   * fold and stays open. Dropping is not wired here: the whole island is the
   * target, and that is resolved from where the pointer is, in
   * installIslandDrops, so a card dropped on another card still lands.
   */
  private installIsland(element: HTMLElement, key: string): void {
    element.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      if (key === "") return;
      this.onIslandFolded?.(key);
    };
  }

  /**
   * Dropping a card anywhere on an island files it there.
   *
   * On the viewport rather than on each heading, and resolved from the
   * pointer's position rather than from what is under it: over a card, the
   * card is what the browser reports, and a drop target that only worked in
   * the gaps between cards would be a target you had to aim for. The same
   * handler moves the wall when the card is held near an edge, since a drag
   * cannot scroll on its own.
   */
  private installIslandDrops(): void {
    this.viewport.addEventListener("dragover", (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return;
      // Tracked whatever the wall is showing: a card dragged from the foot of
      // a long wall to a rail row at the top needs the wall to move under it,
      // and the rail is a target even when the wall itself is not. No
      // preventDefault outside the grouped view, or the wall would claim a
      // drop it has nothing to do with.
      this.dragPointerY = event.clientY;
      this.dragSeenAt = performance.now();
      this.startDragScroll();
      if (!this.islands) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const point = this.toContentPoint(event.clientX, event.clientY);
      const over = hitToOver(islandAt(this.islandHeaders, point.y, ISLAND_DROP_SLACK));
      if (over?.key !== this.dragOver?.key || over?.pocket !== this.dragOver?.pocket) {
        this.dragOver = over;
        this.paintDragOver();
      }
    });

    this.viewport.addEventListener("drop", (event: DragEvent) => {
      if (!this.islands) return;
      const raw = event.dataTransfer?.getData(DRAG_TYPE);
      if (!raw) return;
      event.preventDefault();
      // Ours, not the wall's own drop of files and links: that handler sits
      // on an ancestor and must not also read this.
      event.stopPropagation();
      const point = this.toContentPoint(event.clientX, event.clientY);
      const over = islandAt(this.islandHeaders, point.y, ISLAND_DROP_SLACK);
      this.endDrag();
      const ids = raw.split("\n").filter(Boolean);
      if (over && ids.length > 0) {
        this.onIslandDropped?.(ids, over.island.key, over.pocket?.key ?? "");
      }
    });

    // The source tile is inside the viewport, so its dragend bubbles here
    // whether the drop landed on an island, on the rail, or nowhere.
    this.viewport.addEventListener("dragend", () => this.endDrag());
  }

  private endDrag(): void {
    this.stopDragScroll();
    if (this.dragging.size > 0) {
      this.dragging = new Set();
      this.viewport.removeClass("is-dropping");
      for (const [id, element] of this.mounted) this.paintDragState(element, id);
      this.onDragLifted?.(false);
    }
    if (this.dragOver === null) return;
    this.dragOver = null;
    this.paintDragOver();
  }

  private paintDragOver(): void {
    const over = this.dragOver;
    const island = over && over.pocket === null ? over.key : null;
    for (const held of [this.islandEls, this.islandBands]) {
      for (const [key, element] of held) element.toggleClass("is-drop-into", key === island);
    }
    const pocket = over && over.pocket !== null ? pocketKey(over.key, over.pocket) : null;
    for (const held of [this.pocketEls, this.pocketBands]) {
      for (const [key, element] of held) element.toggleClass("is-drop-into", key === pocket);
    }
  }

  /**
   * Moves the wall while a dragged card is held near the top or bottom edge,
   * faster the closer it is.
   *
   * dragover keeps firing while the pointer is still, a few times a second,
   * so the loop stops itself when none has arrived for a moment: that is the
   * card having left the viewport, or been dropped somewhere that never told
   * us. Native scrolling walls have no HTML drag to speak of, and are left
   * alone.
   */
  private startDragScroll(): void {
    if (this.dragScrollFrame || this.nativeScroll) return;
    const step = (): void => {
      this.dragScrollFrame = 0;
      if (performance.now() - this.dragSeenAt > 400) return;
      const rect = this.viewport.getBoundingClientRect();
      const fromTop = this.dragPointerY - rect.top;
      const fromBottom = rect.bottom - this.dragPointerY;
      let delta = 0;
      if (fromTop < DRAG_EDGE) delta = ((DRAG_EDGE - fromTop) / DRAG_EDGE) * DRAG_SCROLL_MAX;
      else if (fromBottom < DRAG_EDGE) delta = -((DRAG_EDGE - fromBottom) / DRAG_EDGE) * DRAG_SCROLL_MAX;
      if (delta !== 0) {
        this.camera = { ...this.camera, y: this.camera.y + delta };
        this.applyCamera();
      }
      this.dragScrollFrame = window.requestAnimationFrame(step);
    };
    this.dragScrollFrame = window.requestAnimationFrame(step);
  }

  private stopDragScroll(): void {
    if (this.dragScrollFrame) window.cancelAnimationFrame(this.dragScrollFrame);
    this.dragScrollFrame = 0;
  }

  private scheduleRelayout(): void {
    if (this.relayoutFrame) return;
    this.relayoutFrame = window.requestAnimationFrame(() => {
      this.relayoutFrame = 0;
      this.relayout();
    });
  }

  private measure(id: string, w: number, h: number): void {
    if (!(w > 0 && h > 0)) return;
    const previous = this.measured.get(id);
    if (previous && previous.w === w && previous.h === h) return;
    this.measured.set(id, { w, h });
    this.scheduleRelayout();
  }

  private installGestures(): void {
    this.viewport.addEventListener(
      "wheel",
      (event: WheelEvent) => {
        event.preventDefault();
        this.cancelTween();

        // Trackpad pinch and cmd/ctrl+wheel both arrive with ctrlKey set.
        // The wall does not zoom: its tiles have a size setting of their own,
        // and a free zoom left them small and stranded in the middle of the
        // pane. Swallowed rather than scrolled, since the fingers were not
        // asking to move the wall either.
        if (event.ctrlKey || event.metaKey) return;

        this.camera = {
          ...this.camera,
          x: this.camera.x - event.deltaX,
          y: this.camera.y - event.deltaY,
        };
        this.applyCamera();
      },
      { passive: false }
    );

    this.onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;

      if (event.code === "Space" && !event.repeat) {
        this.spaceHeld = true;
        this.viewport.addClass("is-pannable");
        event.preventDefault();
        return;
      }

      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        this.selection.size > 0
      ) {
        event.preventDefault();
        this.onDeleteRequested([...this.selection]);
        return;
      }

      if (event.key === "Escape" && this.selection.size > 0) {
        event.preventDefault();
        this.clearSelection();
        return;
      }

      const modified = event.metaKey || event.ctrlKey || event.altKey;
      if (
        (event.key === "p" || event.key === "P") &&
        this.selectionKind() === "clippings" &&
        !modified
      ) {
        event.preventDefault();
        this.onPropertiesRequested([...this.selection]);
        return;
      }

      if (!(event.metaKey || event.ctrlKey)) return;

      if (event.key === "a") {
        event.preventDefault();
        this.selectAll();
        return;
      }

      if (event.key === "e" && this.selectionKind() === "clippings") {
        event.preventDefault();
        this.onExportRequested([...this.selection]);
        return;
      }
      // Cmd with 0, = and - are left to Obsidian, which zooms the whole
      // window with them: the wall has no zoom of its own to take them for.
    };

    this.onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") this.endPan();
    };

    // Losing focus mid-drag would otherwise leave the grab cursor stuck on.
    this.onBlur = () => this.endPan();

    this.viewport.doc.addEventListener("keydown", this.onKeyDown);
    this.viewport.doc.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);

    this.viewport.addEventListener("pointerdown", (event: PointerEvent) => {
      if (!this.spaceHeld && event.button !== 1) return;
      event.preventDefault();
      this.cancelTween();
      this.panning = true;
      this.panMoved = false;
      this.panOrigin = {
        x: event.clientX,
        y: event.clientY,
        camX: this.camera.x,
        camY: this.camera.y,
      };
      this.viewport.addClass("is-panning");
      this.viewport.setPointerCapture(event.pointerId);
    });

    this.viewport.addEventListener("pointermove", (event: PointerEvent) => {
      if (!this.panning) return;
      const dx = event.clientX - this.panOrigin.x;
      const dy = event.clientY - this.panOrigin.y;
      if (Math.abs(dx) > CLICK_SLOP || Math.abs(dy) > CLICK_SLOP) this.panMoved = true;
      this.camera = {
        ...this.camera,
        x: this.panOrigin.camX + dx,
        y: this.panOrigin.camY + dy,
      };
      this.applyCamera();
    });

    const stop = (event: PointerEvent): void => {
      if (!this.panning) return;
      this.panning = false;
      this.viewport.removeClass("is-panning");
      if (this.viewport.hasPointerCapture(event.pointerId)) {
        this.viewport.releasePointerCapture(event.pointerId);
      }
      // Cleared after the click that follows pointerup has been handled.
      window.setTimeout(() => {
        this.panMoved = false;
      }, 0);
    };

    this.viewport.addEventListener("pointerup", stop);
    this.viewport.addEventListener("pointercancel", stop);
  }

  /** Screen point to content point under the current camera. */
  private toContentPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.camera.x) / this.camera.zoom,
      y: (clientY - rect.top - this.camera.y) / this.camera.zoom,
    };
  }

  private installSelection(): void {
    this.viewport.addEventListener("pointerdown", (event: PointerEvent) => {
      // Panning owns space-drag and middle-click; a tile owns its own click.
      if (this.spaceHeld || event.button !== 0) return;
      // A touch reports button 0 like a left click, so without this a finger
      // drag rubber-band selects instead of moving the wall, and the capture
      // below swallows the rest of the gesture. installTouch owns touch.
      if (event.pointerType === "touch") return;
      // A heading owns its click as a tile does. Capturing the pointer here
      // would redirect the click that follows to the viewport, and the
      // heading would look like a button that does nothing.
      if ((event.target as HTMLElement | null)?.closest(".pg-tile, .pg-island")) return;

      this.selecting = true;
      this.marqueeMoved = false;
      this.viewport.addClass("is-selecting");
      this.selectionBase = new Set(this.baseFor("clippings"));
      const point = this.toContentPoint(event.clientX, event.clientY);
      this.marqueeOrigin = point;
      this.viewport.setPointerCapture(event.pointerId);
    });

    this.viewport.addEventListener("pointermove", (event: PointerEvent) => {
      if (!this.selecting) return;
      const point = this.toContentPoint(event.clientX, event.clientY);
      const rect = rectFromCorners(
        this.marqueeOrigin.x,
        this.marqueeOrigin.y,
        point.x,
        point.y
      );

      const travelled = Math.max(rect.w, rect.h) * this.camera.zoom;
      if (!this.marqueeMoved && travelled < MARQUEE_SLOP) return;
      this.marqueeMoved = true;

      this.drawMarquee(rect);
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      // Folders are not clippings: a marquee over one selects nothing in it.
      const hits = idsInRect(
        this.layout.positions.filter((p) => !this.folderById.has(p.id)),
        rect
      );
      if (hits.length > 0) this.selectionAnchor = hits[hits.length - 1];
      this.applySelection(mergeSelection(this.selectionBase, hits, additive));
    });

    const finish = (event: PointerEvent): void => {
      if (!this.selecting) return;
      this.selecting = false;
      this.viewport.removeClass("is-selecting");
      this.marquee.removeClass("is-active");
      if (this.viewport.hasPointerCapture(event.pointerId)) {
        this.viewport.releasePointerCapture(event.pointerId);
      }
      // A click on empty space with no drag clears the selection.
      if (!this.marqueeMoved) this.applySelection(new Set());
      this.marqueeMoved = false;
    };

    this.viewport.addEventListener("pointerup", finish);
    this.viewport.addEventListener("pointercancel", finish);

    /*
     * Right-clicking the wall itself asks what can be made here.
     *
     * Cards and folders stop their own menu from propagating, so anything
     * reaching the viewport landed on nothing; the closest() is a second
     * line in case a card ever forgets. The selection is left alone: a
     * right-click never clears one, and this menu is about the wall rather
     * than about whatever happens to be picked.
     */
    this.viewport.addEventListener("contextmenu", (event: MouseEvent) => {
      // An island's heading and a pocket's are furniture of the wall, not
      // empty space on it: a menu offering to make something there would be
      // answering a click that was aimed at the group under it.
      const target = event.target as HTMLElement | null;
      if (target?.closest(".pg-tile, .pg-island, .pg-pocket")) return;
      event.preventDefault();
      this.onSpaceContextRequested(event.clientX, event.clientY);
    });
  }

  private drawMarquee(rect: Rect): void {
    this.marquee.addClass("is-active");
    // Drawn in screen space so its border stays 1px at any zoom.
    this.marquee.style.transform = `translate3d(${
      rect.x * this.camera.zoom + this.camera.x
    }px, ${rect.y * this.camera.zoom + this.camera.y}px, 0)`;
    this.marquee.style.width = `${rect.w * this.camera.zoom}px`;
    this.marquee.style.height = `${rect.h * this.camera.zoom}px`;
  }

  /**
   * What the selection currently holds, or null when it holds nothing.
   *
   * A selection is folders or clippings, never both: the two answer to
   * different actions, and a bar whose every button meant two things would
   * be the worse half of that trade. The first member settles it, because
   * the rule below is what puts them in.
   */
  selectionKind(): "folders" | "clippings" | null {
    for (const id of this.selection) return this.folderById.has(id) ? "folders" : "clippings";
    return null;
  }

  /**
   * The selection a click of this kind builds on: the live one when it is
   * already that kind, and an empty one when it is the other. Picking a
   * folder therefore drops the clippings, and picking a clipping drops the
   * folders, with no separate step that clears them.
   */
  private baseFor(kind: "folders" | "clippings"): ReadonlySet<string> {
    const current = this.selectionKind();
    return current === null || current === kind ? this.selection : new Set<string>();
  }

  private applySelection(next: Set<string>): void {
    const changed =
      next.size !== this.selection.size || [...next].some((id) => !this.selection.has(id));
    this.selection = next;
    // Nothing selected is the way out of touch selection mode, so a tap on
    // the last selected card leaves taps opening cards again.
    if (next.size === 0) this.touchSelecting = false;
    this.paintSelection();
    if (changed) this.onSelectionChanged([...next]);
  }

  private paintSelection(): void {
    for (const [id, element] of this.mounted) {
      element.root.toggleClass("is-selected", this.selection.has(id));
    }
    // Folder cards are not pooled and so live in their own map, but they
    // wear the same ring. Painted on every render pass, which is what
    // catches a folder that scrolled into view already selected.
    for (const [id, root] of this.mountedFolders) {
      root.toggleClass("is-selected", this.selection.has(id));
    }
  }

  /**
   * Centres a tile and selects it, which is how the palette lands on a
   * clipping that could be anywhere on a wall thousands of pixels tall.
   * Selecting it as well is what makes the arrival useful: whatever you
   * searched for is then the thing ⌘E, a move or a delete acts on.
   *
   * Returns false when this wall has no tile for that clipping, so the
   * caller can fall back to opening the note rather than flying nowhere.
   */
  /**
   * Brings a tile into view. From the palette it is fitted and selected: you
   * asked for it by name. A clipping that has just been pasted is only
   * brought on screen, at the zoom you had and with the selection as it
   * was; a paste is not a request to look at one thing.
   */
  reveal(id: string, options: { fit?: boolean; select?: boolean } = {}): boolean {
    const position = this.positionById.get(id);
    if (!position) return false;
    const fit = options.fit ?? true;

    this.cancelTween();
    this.animateCamera(
      revealCamera(this.camera, this.viewportSize(), position, this.contentSize(), fit)
    );
    if (options.select ?? true) {
      this.selectionAnchor = id;
      this.applySelection(new Set([id]));
    }
    return true;
  }

  selectAll(): void {
    this.applySelection(new Set(this.tiles.map((t) => t.id)));
  }

  selectedIds(): string[] {
    return [...this.selection];
  }

  /**
   * The selected clippings themselves, in the wall's own order.
   *
   * What the panel draws. Ordered by the wall rather than by the order they
   * were picked, so a selection reads down the panel the way it reads across
   * the wall, and folder tiles are left out: they are not clippings and have
   * nothing the panel can say.
   */
  selectedTiles(): TileModel[] {
    return this.tiles.filter((tile) => this.selection.has(tile.id));
  }

  /**
   * The tile one step along the wall's own order, filter and sort applied,
   * or null at either end. What the detail view's arrow keys walk.
   */
  neighbor(id: string, direction: -1 | 1): TileModel | null {
    const index = this.tiles.findIndex((tile) => tile.id === id);
    if (index < 0) return null;
    return this.tiles[index + direction] ?? null;
  }

  clearSelection(): void {
    this.selectionAnchor = null;
    this.applySelection(new Set());
  }

  /**
   * The wall's touch gestures.
   *
   * The camera moves on a wheel, a held space or the middle button, and a
   * finger produces none of the three, so before this there was no way to
   * move the wall on a phone at all. `touch-action: none` on the viewport
   * means the browser will not scroll for us either, which is right for a
   * canvas that owns its gestures and fatal for one that does not.
   *
   * Touches are tracked by pointer id because that is the only thing that
   * tells two fingers apart. One finger pans. A second does nothing, since
   * the wall does not zoom on a phone any more than on a desktop, except
   * keep the lifts from counting as a tap; when it lifts, the one left
   * pans again from where it actually is, so the wall does not jump.
   */
  private installTouch(): void {
    const at = (event: PointerEvent): Point => ({ x: event.clientX, y: event.clientY });

    const beginPan = (from: Point): void => {
      this.touchPan = { x: from.x, y: from.y, camX: this.camera.x, camY: this.camera.y };
    };

    this.viewport.addEventListener("pointerdown", (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      this.cancelTween();
      // A primary touch means no other finger is down, whatever the map
      // says: a lift iOS never delivered (the long-press menu taking the
      // touch, typically) leaves an orphan here, and pairing the new finger
      // with it would turn this one-finger drag into a two-finger touch.
      if (staleTouches(event.isPrimary, this.touches.size)) {
        this.touches.clear();
        this.touchPan = null;
      }
      this.touches.set(event.pointerId, at(event));
      this.viewport.setPointerCapture(event.pointerId);

      const live = [...this.touches.values()];
      if (live.length === 1) {
        this.panMoved = false;
        // The scroller owns one-finger travel where there is one.
        if (!this.nativeScroll) beginPan(live[0]);
        return;
      }
      // A second finger makes the gesture something other than a tap, so
      // the click that eventually follows must not open anything.
      this.clearLongPress();
      this.panMoved = true;
      this.touchPan = null;
    });

    this.viewport.addEventListener("pointermove", (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      if (!this.touches.has(event.pointerId)) return;
      this.touches.set(event.pointerId, at(event));

      const live = [...this.touches.values()];
      if (this.nativeScroll || live.length !== 1 || !this.touchPan) return;
      const dx = live[0].x - this.touchPan.x;
      const dy = live[0].y - this.touchPan.y;
      if (Math.abs(dx) > TOUCH_SLOP || Math.abs(dy) > TOUCH_SLOP) {
        // Past the slop this is a pan, not a press held slightly unsteadily.
        this.panMoved = true;
        this.clearLongPress();
      }
      this.camera = {
        ...this.camera,
        x: this.touchPan.camX + dx,
        y: this.touchPan.camY + dy,
      };
      this.applyCamera();
    });

    const lift = (event: PointerEvent): void => {
      if (event.pointerType !== "touch") return;
      if (!this.touches.delete(event.pointerId)) return;
      if (this.viewport.hasPointerCapture(event.pointerId)) {
        this.viewport.releasePointerCapture(event.pointerId);
      }
      this.clearLongPress();

      const live = [...this.touches.values()];
      if (live.length >= 2) return;
      if (live.length === 1) {
        if (!this.nativeScroll) beginPan(live[0]);
        return;
      }

      this.touchPan = null;
      // Cleared after the click that follows the last lift, exactly as the
      // mouse pan does: a drag ending over a card must not also open it.
      window.setTimeout(() => {
        this.panMoved = false;
      }, 0);
    };

    this.viewport.addEventListener("pointerup", lift);
    this.viewport.addEventListener("pointercancel", lift);

    /*
     * Obsidian mobile watches for a downward drag in a view and opens the
     * command palette on it. A one-finger pan is that drag, so scrolling the
     * wall down was opening the palette on top of it.
     *
     * `touch-action: none` only tells the *browser* not to scroll; it says
     * nothing to a recogniser written in JavaScript. Claiming the gesture
     * means handling the touch event: propagation stops here so no ancestor
     * listener sees it, on touchstart as well, since a recogniser that never
     * arms cannot fire wherever it happens to listen for the movement.
     *
     * preventDefault is confined to touchmove on purpose. On touchstart it
     * also suppresses the synthetic click, and a tap still needs that click
     * to open a card.
     */
    const claim = (event: TouchEvent): void => {
      // On a native scroller preventDefault would cancel the very scroll
      // being handed to the browser, so the gesture is only hidden from
      // Obsidian's recogniser, never cancelled.
      if (this.nativeScroll) {
        event.stopPropagation();
        return;
      }
      // Unconditional because the viewport holds only the canvas and the
      // marquee: every overlay that scrolls itself, the sheet and palette
      // and action bar, mounts on the view instead. Nothing inside here
      // wants a touch the wall should not have. Checking the tracked
      // touches instead would tie this to whether pointerdown or touchstart
      // fires first, which the two engines do not agree on.
      event.stopPropagation();
      if (event.type === "touchmove") event.preventDefault();
    };

    this.viewport.addEventListener("touchstart", claim, { passive: false });
    this.viewport.addEventListener("touchmove", claim, { passive: false });

    /*
     * A tap on empty space clears the selection.
     *
     * Desktop gets this from the marquee, whose own click handling treats a
     * press that never moved as a request to select nothing. That stands
     * down for touch, so without this there is no way out of selection mode
     * except tapping every selected card off again, and while a selection is
     * up the wall's own controls have given the bottom bar to the selection
     * bar. That is a trap, not a mode.
     */
    this.viewport.addEventListener("click", (event: MouseEvent) => {
      if (!this.nativeScroll || this.selection.size === 0) return;
      // A pan or a two-finger touch that ends over empty space is not a tap,
      // and the cards answer their own.
      if (this.panMoved) return;
      if ((event.target as HTMLElement | null)?.closest(".pg-tile")) return;
      this.clearSelection();
    });
  }

  /**
   * How far the scrolled content is pushed in from the viewport's left edge.
   *
   * `margin: 0 auto` centres the wall whenever the scaled content is
   * narrower than the viewport, which is every zoom below the fit. That
   * centring sits between viewport coordinates and the wall's own, so every
   * conversion between them goes through it. It is zero at fit and above,
   * which is why leaving it out looks correct until the first pinch outwards.
   *
   * clampCamera centres an axis with no travel by exactly the same rule,
   * which is what lets the camera and the scroller mean the same thing.
   */
  private scrollerOffset(zoom: number): number {
    const scaled = this.contentSize().width * zoom;
    return Math.max(0, (this.viewportSize().width - scaled) / 2);
  }

  /**
   * Starts the clock on a press, which opens the card's menu.
   *
   * Touch has no right button, so a press is the only thing a context menu
   * can hang off. Selection mode is reached from inside that menu rather
   * than from the press itself: one gesture cannot mean two things, and of
   * the two the menu is the one worth reaching in a single motion.
   */
  private armLongPress(id: string, at: Point): void {
    this.clearLongPress();
    this.longPress = window.setTimeout(() => {
      this.longPress = 0;
      // Pressing outside the selection acts on that card alone, which is
      // what the right-click on a desktop does and what a file manager does
      // everywhere.
      // Pressing outside the selection acts on that card alone, which is
      // what the right-click on a desktop does and what a file manager does
      // everywhere.
      if (!this.selection.has(id)) this.selectOnly(id, new Set([id]));
      // The press has been answered. Suppressing the click that follows the
      // lift stops the card opening behind the menu that just appeared.
      this.panMoved = true;
      this.onContextRequested([...this.selection], at.x, at.y);
    }, LONG_PRESS_MS);
  }

  /**
   * Turns on the mode in which a tap adds and removes rather than opening.
   * Offered from the card's menu, touch having no modifier key to hold.
   */
  beginTouchSelection(id: string): void {
    this.touchSelecting = true;
    this.selectOnly(id, new Set([id]));
  }

  private clearLongPress(): void {
    if (this.longPress) window.clearTimeout(this.longPress);
    this.longPress = 0;
  }

  /**
   * Tips the card under the cursor away from it, as though the edge being
   * pointed at were pressed in. Worked out in content space from the camera,
   * so no element is measured and nothing is read from layout per frame.
   */
  private installHover(): void {
    this.viewport.addEventListener(
      "pointermove",
      (event: PointerEvent) => {
        // A finger is not a hover. Following it tips whichever card is
        // under the drag, which reads as the wall coming apart in your hand.
        if (event.pointerType === "touch") return;
        this.pointer = { x: event.clientX, y: event.clientY };
        this.scheduleHover();
      },
      { passive: true }
    );

    this.viewport.addEventListener("pointerleave", () => {
      this.pointer = null;
      this.clearHover();
      this.resetScrub();
    });
  }

  private scheduleHover(): void {
    if (this.hoverFrame) return;
    this.hoverFrame = window.requestAnimationFrame(() => {
      this.hoverFrame = 0;
      this.applyHover();
      this.applyScrub();
    });
  }

  private clearHover(): void {
    this.setHoveredMedia(null);
    this.hoveredId = null;
  }

  /**
   * The playable inside the card the pointer is over, or null.
   *
   * Reported from the hover pass, which already tracks which card that is and
   * already stands down for Reduce Motion, a pan, a selection and a held
   * space. Every one of those is a moment the wall should not also start
   * playing something, so following it is the answer rather than a
   * coincidence.
   */
  private setHoveredMedia(next: HTMLElement | null): void {
    const playable =
      next instanceof HTMLVideoElement ||
      (next instanceof HTMLImageElement && next.dataset.animatedSrc)
        ? next
        : null;
    if (this.hoveredMedia === playable) return;
    this.hoveredMedia = playable;
    this.onHoverMedia?.(playable);
  }

  /**
   * Every picture a clipping holds, for scrubbing on the wall. Assigned by the
   * view, which owns the media cache; null leaves the wall as it was.
   */
  reelFor: ((model: TileModel) => TileModel[]) | null = null;

  /**
   * Paints the frame the pointer is over, treating the card's width as a row
   * of invisible segments.
   *
   * Kept apart from applyHover because the two answer to different rules:
   * that one drives playback and stands down for Reduce Motion, while this
   * is the only way
   * to see a post's other pictures without opening it. Turning it off with
   * animations would hide content, not restraint.
   */
  private applyScrub(): void {
    if (!this.pointer || this.panning || this.selecting || this.spaceHeld) {
      this.resetScrub();
      return;
    }

    const point = this.toContentPoint(this.pointer.x, this.pointer.y);

    for (const [id, element] of this.mounted) {
      if (element.reel.length < 2) continue;
      const box = this.positionById.get(id);
      if (!box) continue;
      if (point.x < box.x || point.x > box.x + box.w) continue;
      if (point.y < box.y || point.y > box.y + box.h) continue;

      if (this.scrubbedId !== id) {
        this.resetScrub();
        this.scrubbedId = id;
        element.root.addClass("is-scrubbing");
        // Fetched on arrival rather than on mount: a wall of stacks would
        // otherwise pull every picture of every card into memory for a reel
        // nobody looked at.
        this.preloadReel(element);
        this.buildTrack(element);
      }

      this.paintFrame(element, segmentIndex(point.x - box.x, box.w, element.reel.length));
      return;
    }

    this.resetScrub();
  }

  /**
   * Builds the strip the reel slides on, every picture side by side.
   *
   * All of them at once rather than the neighbours of wherever the pointer is:
   * the strip is one transform away from any frame, so a sweep from the first
   * picture to the last is one continuous slide instead of a series of jumps
   * between rebuilt pairs.
   */
  private buildTrack(element: TileElement): void {
    const frame = element.root.querySelector<HTMLElement>(".pg-frame");
    if (!frame || element.track) return;

    // A leftover strip from a card the pointer left and came straight back
    // to: resetScrub clears the reference but the element outlives the slide
    // home, so without this a quick return leaves two stacked.
    frame.querySelectorAll(".pg-reel-clip").forEach((old) => old.remove());

    // Two elements, because the one that clips cannot be the one that moves:
    // overflow clips to an element's own box, and a box that has slid a frame
    // to the left takes its clip region with it, hiding the very picture it
    // slid to. The clip stays put; the strip inside it travels.
    const clip = frame.createDiv({ cls: "pg-reel-clip" });
    const track = clip.createDiv({ cls: "pg-reel-track" });
    for (const tile of element.reel) {
      const preview = previewOf(tile);
      const image = track.createEl("img", { cls: "pg-reel-frame" });
      image.decoding = "async";
      image.alt = "";
      if (preview) image.src = this.sourceFor(preview.path, preview.remote);
    }

    // First, not last. createDiv appends, which put the strip after the badge
    // layer and painted over it: hovering a stack hid the very badges hovering
    // is for. The z-index scale in styles.css is what decides the order now,
    // and this only keeps document order agreeing with it.
    frame.prepend(clip);
    element.track = track;
    this.slideTrack(element, element.frame);
  }

  private slideTrack(element: TileElement, frame: number): void {
    if (element.track) {
      element.track.style.transform = `translate3d(${-frame * 100}%, 0, 0)`;
    }
  }

  /** Slides to a frame and moves the dot, or does nothing if already there. */
  private paintFrame(element: TileElement, frame: number): void {
    if (frame === element.frame) return;
    element.frame = frame;
    this.slideTrack(element, frame);

    const dots = element.dots;
    if (!dots) return;
    for (let i = 0; i < dots.childElementCount; i++) {
      dots.children[i].toggleClass("is-on", i === frame);
    }
  }

  /**
   * Puts the card back to the cover it mounted with.
   *
   * The strip slides home before it is removed, so leaving a card mid-reel
   * reads as it returning rather than as the picture cutting back.
   */
  private resetScrub(): void {
    const id = this.scrubbedId;
    if (!id) return;
    this.scrubbedId = null;
    const element = this.mounted.get(id);
    if (!element) return;
    element.root.removeClass("is-scrubbing");
    this.paintFrame(element, 0);

    const track = element.track;
    element.track = null;
    if (!track) return;
    // Outlives the slide home, then goes. A card the pointer returns to builds
    // a fresh strip, which is cheaper than keeping one per mounted card alive.
    const clip = track.parentElement;
    window.setTimeout(() => (clip?.hasClass("pg-reel-clip") ? clip : track).remove(), TRACK_SLIDE_MS);
  }

  /**
   * Warms the reel so the strip is built from decoded pictures.
   *
   * Detached Images, so the fetches go through the same cache the strip will
   * read from without anything being added to the document.
   */
  private preloadReel(element: TileElement): void {
    for (const tile of element.reel) {
      const preview = previewOf(tile);
      if (!preview) continue;
      const warm = new Image();
      warm.decoding = "async";
      warm.src = this.sourceFor(preview.path, preview.remote);
    }
  }

  /**
   * Which card the pointer is over, and the video inside it.
   *
   * It answers "which one", which is what plays the media under the pointer.
   * A drag is already saying something with the cursor, so nothing here runs
   * during one.
   */
  private applyHover(): void {
    if (!this.pointer || this.panning || this.selecting || this.spaceHeld) {
      this.clearHover();
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.clearHover();
      return;
    }

    const point = this.toContentPoint(this.pointer.x, this.pointer.y);

    for (const [id, element] of this.mounted) {
      const box = this.positionById.get(id);
      if (!box) continue;
      // Non-null only for the card the point is inside.
      if (!pressureAt(point, box)) continue;

      if (this.hoveredId !== id) this.clearHover();
      this.hoveredId = id;
      this.setHoveredMedia(element.media);
      // The card used to tip towards the cursor from here. It was the one
      // piece of motion on the wall that answered nothing: a hover already
      // lifts the card and brings up its badges, and a picture read at an
      // angle is a picture read worse. What this pass is still for is knowing
      // which card the cursor is over, which is what plays the video under it
      // and scrubs through a stack.
      return;
    }

    this.clearHover();
  }

  /**
   * Hides the card that is open in the detail view.
   *
   * Hiding it is what makes the return read as one motion: leave it in
   * place and the flight lands on top of a duplicate of itself.
   */
  focusTile(id: string | null): void {
    this.focusedId = id;
    this.render();
  }

  private endPan(): void {
    this.spaceHeld = false;
    this.panning = false;
    this.viewport.removeClass("is-pannable");
    this.viewport.removeClass("is-panning");
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private acquire(): TileElement {
    const recycled = this.pool.pop();
    if (recycled) return recycled;
    const root = this.canvas.createDiv({ cls: "pg-tile" });
    // Wired once, on the pooled element rather than per paint: a tile is
    // recycled for card after card, and a listener added on each would stack
    // up one per repaint. The id is read at drag time for the same reason.
    root.draggable = true;
    root.addEventListener("dragstart", (event: DragEvent) => {
      const element = this.mounted.get(root.dataset.tileId ?? "");
      const id = element?.id ?? root.dataset.tileId ?? "";
      if (!id || !event.dataTransfer) {
        event.preventDefault();
        return;
      }
      const ids = dragSet(id, this.selectedIds());
      event.dataTransfer.setData(DRAG_TYPE, dragPayload(ids));
      event.dataTransfer.effectAllowed = "move";
      this.setDragImage(event, id, ids);
      this.dragging = new Set(ids);
      this.viewport.addClass("is-dropping");
      for (const [held, mounted] of this.mounted) this.paintDragState(mounted, held);
      this.onDragLifted?.(true);
      // Held for the drop to read, since a drop target in another element
      // cannot ask the wall what was selected at the moment of the drag.
      this.onDragStarted?.(ids);
    });

    // Every way out of a press — a second finger, movement past the slop,
    // the lift — is on the viewport, which sees the whole gesture.
    root.addEventListener("pointerdown", (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      const id = root.dataset.tileId ?? "";
      if (id) this.armLongPress(id, { x: event.clientX, y: event.clientY });
    });

    // A picture from outside over a card: the band across its foot takes it
    // as that card's cover, and the rest of the card is wall like any other,
    // where a drop is a new clipping. On a phone there is no band, and the
    // whole card is wall. Wired here for the same reason dragstart is: the
    // element is recycled, and the id is read at drop time rather than
    // closed over.
    root.addEventListener("dragover", (event: DragEvent) => {
      const target = this.coverTargetAt(root, event);
      this.offerCover(target === null ? null : root, target === "cover");
      // Off the band the drag is left to the wall's own handler, whose frame
      // stays up to say that a drop there is a new clipping.
      if (target !== "cover" || !event.dataTransfer) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    });
    root.addEventListener("dragleave", (event: DragEvent) => {
      // Crossing into one of the card's own children is not leaving it. An
      // engine that names no element here takes the band down, and the
      // dragover that follows in the same step puts it straight back.
      const next = event.relatedTarget;
      if (next !== null && root.contains(next as Node)) return;
      if (this.coverOffer?.root === root) this.offerCover(null);
    });
    root.addEventListener("drop", (event: DragEvent) => {
      const target = this.coverTargetAt(root, event);
      if (this.coverOffer?.root === root) this.offerCover(null);
      if (target !== "cover" || !event.dataTransfer) return;
      const id = root.dataset.tileId ?? "";
      if (!id) return;
      // Claimed only if something up there can use it. A file whose type
      // could not be read before the drop, and turns out not to be a picture,
      // still reaches the wall and is clipped.
      if (!this.onCoverDropped(id, event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
    });

    return {
      root,
      media: null,
      id: "",
      signature: "",
      kind: "",
      reel: [],
      frame: 0,
      dots: null,
      track: null,
    };
  }

  /**
   * Where a drop at this event's point over this card would land, or null
   * when the drag carries nothing a card could take as its cover, or the
   * wall is on a phone, where no card takes one by drag.
   *
   * Measured on the frame, which is the card as it is seen: the tile box
   * around it is a few pixels larger, and the band belongs to what is drawn.
   */
  private coverTargetAt(root: HTMLElement, event: DragEvent): CoverDropTarget | null {
    const transfer = event.dataTransfer;
    if (!transfer) return null;
    // Only kinds and types are legible before the drop, which is enough.
    const fileTypes = Array.from(transfer.items ?? [])
      .filter((item) => item.kind === "file")
      .map((item) => item.type);
    if (!offersCover(Array.from(transfer.types), fileTypes, { phone: Platform.isPhone })) return null;
    const card = this.coverFrameOf(root).getBoundingClientRect();
    return coverDropTarget(card, { x: event.clientX, y: event.clientY });
  }

  private coverFrameOf(root: HTMLElement): HTMLElement {
    return root.querySelector<HTMLElement>(".pg-frame") ?? root;
  }

  /**
   * Puts the band up on this card, lit while the pointer is on it, or takes
   * it down with null.
   *
   * The view hears only when the pointer crosses onto the band or off it,
   * which are the two moments the wall's own frame has to go down or back up.
   */
  private offerCover(root: HTMLElement | null, onBand = false): void {
    const wasOnBand = this.coverOffer?.onBand ?? false;
    const aimed = root !== null && onBand;
    this.coverOffer = root ? { root, onBand: aimed } : null;
    this.coverLayer.toggleClass("is-offered", root !== null);
    this.coverBandEl.toggleClass("is-aimed", aimed);
    if (root) this.placeCoverBand(root);
    if (aimed !== wasOnBand) this.onCoverAim(aimed);
  }

  /**
   * Lays the band over the foot of the card as it is on screen.
   *
   * Everything in screen pixels, from the same arithmetic the drop is decided
   * by, so the band drawn is exactly the band that takes the drop whatever
   * the zoom. The scale is carried too, for the card's rounded corners, which
   * are in the card's own pixels.
   */
  private placeCoverBand(root: HTMLElement): void {
    const frame = this.coverFrameOf(root);
    const card = frame.getBoundingClientRect();
    const layer = this.coverLayer.getBoundingClientRect();
    const band = coverBand(card);
    const scale = frame.offsetHeight > 0 ? card.height / frame.offsetHeight : 1;
    const style = this.coverBandEl.style;
    style.setProperty("--pg-band-x", `${band.left - layer.left}px`);
    style.setProperty("--pg-band-y", `${band.top - layer.top}px`);
    style.setProperty("--pg-band-w", `${band.width}px`);
    style.setProperty("--pg-band-h", `${band.height}px`);
    style.setProperty("--pg-band-scale", scale.toFixed(4));
  }

  /**
   * A small copy of the card under the cursor, as what the drag carries.
   *
   * The card itself is the wrong size for this: at a few hundred pixels it
   * covers the rail it is being dragged to, so you cannot see which row you
   * are over — the one thing the drag image exists to help with. A thumbnail
   * of it, offset just under the pointer, leaves the target in view.
   *
   * The element has to be in the document for the browser to rasterise it,
   * and gone by the time anything else is painted; a frame later is the
   * usual bargain, and the browser has taken its snapshot by then.
   */
  private setDragImage(event: DragEvent, grabbed: string, ids: readonly string[]): void {
    const ghost = this.viewport.doc.body.createDiv({ cls: "pg-drag-ghost" });

    // The card actually grabbed goes in front; the others fan out behind it,
    // which is what a handful of pictures looks like when you pick them up.
    // Three at most: past that the fan is a smear, and the count says the rest.
    const order = [grabbed, ...ids.filter((id) => id !== grabbed)].slice(0, DRAG_GHOST_FAN);
    // A card of words has no picture to shrink, and a blank rectangle under
    // the cursor says nothing about what is travelling. Its mark does.
    const faces = order
      .map((id): { src: string; letter: string } | null => {
        const media = this.mounted.get(id)?.media;
        if (media instanceof HTMLImageElement && media.currentSrc) {
          return { src: media.currentSrc, letter: "" };
        }
        const tile = this.tiles.find((candidate) => candidate.id === id);
        if (!tile || tile.kind !== "note") return null;
        const name = domainOf(tile.record.source) || tile.record.title;
        return { src: "", letter: (name[0] ?? "\u2014").toUpperCase() };
      })
      .filter((face): face is { src: string; letter: string } => face !== null);

    ghost.toggleClass("is-stack", faces.length > 1);
    // Behind to in front, so the front card is last in paint order and the
    // one under the cursor.
    for (const [index, face] of [...faces].reverse().entries()) {
      const card = ghost.createDiv({ cls: "pg-drag-card" });
      card.dataset.slot = String(faces.length - 1 - index);
      if (face.src) card.createEl("img").src = face.src;
      else card.createDiv({ cls: "pg-drag-note", text: face.letter });
    }
    if (faces.length === 0) ghost.createDiv({ cls: "pg-drag-card" });

    // Says how many are travelling, which three thumbnails cannot.
    if (ids.length > 1) ghost.createSpan({ cls: "pg-drag-ghost-count", text: String(ids.length) });

    // Measured rather than assumed: the box is CSS's business, and a constant
    // repeated here would be one to keep in step with it.
    event.dataTransfer?.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2);
    window.requestAnimationFrame(() => ghost.remove());
  }

  /** Dims a card while it is the one being carried. */
  private paintDragState(element: TileElement, id: string): void {
    element.root.toggleClass("is-dragging", this.dragging.has(id));
  }

  private release(tile: TileElement): void {
    if (this.leaving.has(tile)) return;
    if (this.hoveredId === tile.id) this.hoveredId = null;
    tile.root.setCssStyles({ display: "none" });
    tile.root.removeClass("is-gliding");
    tile.root.removeClass("is-entering");
    tile.root.empty();
    tile.id = "";
    tile.signature = "";
    tile.kind = "";
    tile.media = null;
    // Cleared with the rest: a recycled card that kept a reel would scrub
    // through another clipping's pictures.
    tile.reel = [];
    tile.frame = 0;
    tile.dots = null;
    tile.track = null;
    this.pool.push(tile);
  }

  private sourceFor(path: string, remote: boolean): string {
    return resourceUrl(this.app.vault, path, remote);
  }

  /**
   * Reveals an image once there is a frame to paint, not merely bytes.
   *
   * `load` fires before the image is decoded, so revealing there starts the
   * fade on an empty box and lets the decode land partway through it. decode()
   * settles when the bitmap exists, which costs a few milliseconds more and
   * buys a tile that is simply present.
   *
   * A rejection is not proof of a bad source: Chromium's decode cache is far
   * smaller than a wall of full-resolution pages, and decode() rejects when
   * the bitmap loses that race even though the image loaded and will paint on
   * demand. So a rejected image that has pixels is revealed anyway; one still
   * loading gets its reveal from `load`; one with no pixels really did fail,
   * and the error listener drops the tile.
   */
  private revealWhenDecoded(image: HTMLImageElement): void {
    const reveal = () => {
      if (image.isConnected) image.addClass("is-loaded");
    };
    void image
      .decode()
      .then(reveal)
      .catch(() => {
        if (image.complete && image.naturalWidth > 0) reveal();
        else image.addEventListener("load", reveal, { once: true });
      });
  }

  /**
   * A clipping with no picture, drawn as a sheet of paper lying on the card.
   *
   * The sheet is inset and has its own corners and shadow, so among the
   * photographs on the wall it reads as an object of a different kind rather
   * than as a hole where a picture failed. What is on it is the clipping's
   * own words; the chrome around them is a line saying where it came from.
   *
   * No colour is invented for it. Everything here is neutral except the
   * favicon, which is the site's own, and that is enough to tell GitHub from
   * Substack without reading either.
   */
  private paintSheet(frame: HTMLElement, model: TileModel): void {
    const sheet = frame.createDiv({ cls: "pg-sheet" });
    const host = domainOf(model.record.source);
    const text = noteText(model.record);

    // The head says where this came from. A clipped page says it with the
    // site's own mark and name; a note that came from a file has no site, so
    // it says what kind of file it was, the way a PDF card does. A grey box
    // with a dash in it, which is what stood here, said neither.
    const head = sheet.createDiv({ cls: "pg-sheet-head" });
    if (host) {
      this.paintFavicon(head, host);
      head.createSpan({ cls: "pg-sheet-host", text: host });
    } else {
      head.createDiv({
        cls: "pg-format pg-sheet-format",
        text: extensionOf(model.record.path).toUpperCase() || "NOTE",
      });
    }

    if (model.record.title) {
      sheet.createDiv({ cls: "pg-sheet-title", text: model.record.title });
    }
    if (text) {
      sheet.createDiv({ cls: "pg-sheet-text", text });
    } else {
      // Nothing to read: the mark stands in for it, the way an app icon does
      // on a card that is only ever a link to the app. With no name either,
      // the mark is the whole card; a class rather than :has(), which makes
      // the browser recheck every card whenever anything in one changes.
      sheet.addClass("is-bare");
      if (!model.record.title) sheet.addClass("is-mark-only");
    }
  }

  /**
   * The site's own mark, or the letter it starts with.
   *
   * Fetched straight from the host rather than archived: a favicon is a
   * couple of kilobytes, the browser caches it per host, and archiving one
   * would put a file in the vault for every site ever clipped. `/favicon.ico`
   * is not where every site keeps it any more, so a failure is expected and
   * the letter takes over without a gap.
   */
  private paintFavicon(head: HTMLElement, host: string): void {
    const mark = head.createDiv({ cls: "pg-sheet-mark" });
    mark.setText(host[0].toUpperCase());
    const icon = mark.createEl("img", { cls: "pg-sheet-icon" });
    icon.addEventListener("load", () => mark.addClass("has-icon"), { once: true });
    icon.addEventListener("error", () => icon.remove(), { once: true });
    icon.src = `https://${host}/favicon.ico`;
  }

  private swapImage(image: HTMLImageElement, next: string): void {
    if (!next || image.src === next) return;
    const preload = new Image();
    preload.src = next;
    const swap = () => {
      if (!image.isConnected) return;
      image.src = next;
      image.addClass("is-loaded");
    };
    void preload
      .decode()
      .then(swap)
      .catch(() => {
        // Same decode-cache caveat as revealWhenDecoded; a preload that truly
        // failed has no pixels, and then the tile keeps its current source.
        if (preload.complete && preload.naturalWidth > 0) swap();
      });
  }

  /**
   * How far a card may grow on each side when the cursor rests on it, at the
   * stage where the cards are too small to read.
   *
   * Kept inside the wall. A card in the first column grown evenly about its
   * centre reaches past the left edge, where the viewport cuts it off and the
   * rail covers what is left; the same at the right edge and along the top.
   * So the room a side cannot have is given to the side opposite, and the
   * card is the same size wherever it is — it simply grows away from the
   * edge it is against, which is how a contact sheet behaves when you put a
   * loupe on the corner of it.
   */
  private setMagnify(element: TileElement, position: Position): void {
    const wantX = (position.w * (MAGNIFY - 1)) / 2;
    const wantY = (position.h * (MAGNIFY - 1)) / 2;
    const room = (before: number, after: number, want: number): [number, number] => {
      // Never more than the room there is on both sides together: a card
      // wider than the wall cannot grow at all.
      const total = Math.min(want * 2, before + after);
      const left = Math.min(before, Math.max(total - after, want));
      return [left, total - left];
    };
    const [l, r] = room(position.x, Math.max(0, this.contentWidth - position.x - position.w), wantX);
    const [t, b] = room(
      position.y,
      Math.max(0, this.layout.totalHeight - position.y - position.h),
      wantY
    );
    const style = element.root.style;
    style.setProperty("--pg-grow-l", `${Math.round(l)}px`);
    style.setProperty("--pg-grow-r", `${Math.round(r)}px`);
    style.setProperty("--pg-grow-t", `${Math.round(t)}px`);
    style.setProperty("--pg-grow-b", `${Math.round(b)}px`);
  }

  /**
   * The card's rect on screen in client coordinates, or null if it is not in
   * the layout. Worked out from the position and the camera rather than read
   * off the element, so it answers for a card that is not mounted too.
   */
  tileRect(id: string): Box | null {
    const position = this.positionById.get(id);
    if (!position) return null;
    const bounds = this.viewport.getBoundingClientRect();
    return {
      x: bounds.left + position.x * this.camera.zoom + this.camera.x,
      y: bounds.top + position.y * this.camera.zoom + this.camera.y,
      w: position.w * this.camera.zoom,
      h: position.h * this.camera.zoom,
    };
  }

  /**
   * Opens the full screen for one card, by id.
   *
   * The panel's Open button, and the only way in now that a click selects.
   * Silent about a card that is not on this wall: the panel can outlive a
   * refresh that filtered it away.
   */
  openTile(id: string): void {
    const model = this.byId.get(id);
    if (model) this.openDetail(model, { x: 0.5, y: 0.5 });
  }

  /** Reports the card's rect on screen so the detail view can fly from it. */
  private openDetail(model: TileModel, at: { x: number; y: number }): void {
    // A card with no picture opens as what it is. A lightbox around a
    // paragraph of text would be a worse reader than the one Obsidian
    // already has, and the gesture stays honest: a picture opens as a
    // picture, words open as words.
    if (model.kind === "note") {
      this.onOpenNoteRequested(model.id);
      return;
    }

    const rect = this.tileRect(model.id);
    if (!rect) return;

    this.onOpenDetail(model, { rect, at });
  }

  private selectOnly(id: string, next: Set<string>): void {
    this.selectionAnchor = id;
    this.applySelection(next);
  }

  private paint(element: TileElement, model: TileModel, position: Position, order: number): void {
    element.root.setCssStyles({ display: "" });

    // A tile that keeps representing the same clipping glides to its new
    // position; a pooled element reused for a different clipping snaps,
    // otherwise it would visibly fly across the canvas.
    element.root.toggleClass("is-gliding", !this.restaging && element.id === model.id);
    element.root.toggleClass("is-focus-hidden", this.focusedId === model.id);
    element.root.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    element.root.style.width = `${position.w}px`;
    element.root.style.height = `${position.h}px`;

    // Scale that grows the card by exactly SELECT_LIFT on each edge, whatever
    // its size. A uniform factor would lift a tall tile far more than a short
    // one; the anisotropy here is under 2% and invisible.
    const sx = position.w > SELECT_LIFT * 2 ? position.w / (position.w - SELECT_LIFT * 2) : 1;
    const sy = position.h > SELECT_LIFT * 2 ? position.h / (position.h - SELECT_LIFT * 2) : 1;
    element.root.style.setProperty("--pg-sx", sx.toFixed(4));
    element.root.style.setProperty("--pg-sy", sy.toFixed(4));
    this.setMagnify(element, position);

    // Ahead of the early returns below. A pooled element can come back
    // already carrying the incoming tile's signature, and a genuinely new
    // clipping that landed on one would then skip its entrance entirely.
    if (this.entering.has(model.id)) this.playEnter(element, model.id, order);

    if (element.signature === model.signature) return;

    // Posters are always local files; the painted asset may be either.
    const still = this.sourceFor(model.posterPath, false);
    const original = this.sourceFor(model.filePath, model.remote);

    // resourceUrl gives "" for a vault path it has no file for, which is what
    // an attachment written moments ago looks like until the file registry
    // catches up. Mounting that sets src="" and fires error, and the tile is
    // then dropped as a broken cover for the whole session — over a race the
    // next paint wins. Leave the signature unstamped so there is a next paint,
    // and let the view decide how long to keep waiting.
    if (!original && model.kind !== "note") {
      element.root.empty();
      element.media = null;
      element.id = model.id;
      element.root.dataset.tileId = model.id;
      element.kind = model.kind;
      element.signature = "";
      this.onSourcePending(model.id, model.signature);
      return;
    }

    // An image tile whose source changed (archiving replaced the remote copy
    // with a local one) swaps in place rather than rebuilding the tile.
    if (
      element.id === model.id &&
      element.kind === "image" &&
      model.kind === "image" &&
      element.media instanceof HTMLImageElement
    ) {
      const image = element.media;
      this.swapImage(image, original);
      if (model.animated && still && original) {
        image.dataset.stillSrc = still;
        image.dataset.animatedSrc = original;
      } else {
        delete image.dataset.stillSrc;
        delete image.dataset.animatedSrc;
      }
      element.signature = model.signature;
      return;
    }

    element.id = model.id;
    element.root.dataset.tileId = model.id;
    element.signature = model.signature;
    element.kind = model.kind;
    element.root.empty();
    element.media = null;
    element.reel = [];
    element.frame = 0;
    element.dots = null;
    element.track = null;

    const frame = element.root.createDiv({ cls: "pg-frame" });

    // A card with no picture is finished here: its own words are what it
    // shows, and everything below this paints a cover it does not have.
    if (model.kind === "note") {
      element.root.addClass("is-note");
      this.paintSheet(frame, model);
      this.installTile(element, frame, model);
      return;
    }
    element.root.removeClass("is-note");

    // The two things a card says at rest rather than on hover: that it is a
    // stack rather than one picture, and that the picture is of a document
    // rather than being the thing itself. Without the first the reel is
    // undiscoverable — nothing else on the wall suggests there is anything
    // to sweep across. Without the second a PDF is a card that behaves
    // differently from its neighbours for no visible reason: Open takes it to
    // Obsidian's reader where it takes every other card to the full screen.
    // Opposite corners, because they answer different questions and one card
    // can raise both: the left says what kind of thing this is when it is not
    // simply a picture, the right says how many pictures are inside.
    const held = mediaCount(model.record);
    if (model.isDocument || showsPlayMark(model)) {
      const marks = frame.createDiv({ cls: "pg-marks" });
      // The only document format so far, and naming it is the point: PDF is
      // a word everyone reads at a glance, "document" is not. A clip has no
      // such word — it has a shape everyone already knows.
      if (model.isDocument) marks.createDiv({ cls: "pg-format", text: "PDF" });
      else setGlyph(marks.createDiv({ cls: "pg-kind" }), "play");
    }
    if (held) frame.createDiv({ cls: "pg-count", text: String(held) });

    if (held) {
      // Only frames with something to paint. A reel whose every entry can be
      // shown is what lets the dots be trusted: one dot, one picture.
      const reel = (this.reelFor?.(model) ?? []).filter((tile) => previewOf(tile) !== null);
      if (reel.length > 1) {
        element.reel = reel;
        const dots = frame.createDiv({ cls: "pg-dots" });
        for (let i = 0; i < reel.length; i++) {
          dots.createSpan({ cls: i === 0 ? "pg-dot-step is-on" : "pg-dot-step" });
        }
        element.dots = dots;
      }
    }

    if (model.kind === "video") {
      const video = frame.createEl("video", { cls: "pg-media" });
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = model.remote ? "metadata" : "none";
      if (still && !model.remote) video.poster = still;
      if (model.remote) video.src = original;
      else video.dataset.src = original;

      if (model.provisional) {
        video.addEventListener(
          "loadedmetadata",
          () => this.measure(model.id, video.videoWidth, video.videoHeight),
          { once: true }
        );
      }
      video.addEventListener(
        "error",
        () => this.onSourceFailed(model.id, model.signature),
        { once: true }
      );
      // A poster paints immediately; without one, wait for the first frame.
      if (still && !model.remote) video.addClass("is-loaded");
      else video.addEventListener("loadeddata", () => video.addClass("is-loaded"), { once: true });
      element.media = video;
    } else {
      const image = frame.createEl("img", { cls: "pg-media" });
      // Deliberately not loading="lazy". The grid decides for itself what is
      // worth mounting, and the browser's own heuristic measures intersection
      // against a canvas sitting under a transform, so it holds the fetch back
      // until the tile has already arrived on screen. Which is the hitch.
      image.decoding = "async";
      image.alt = model.record.title;
      // Always the full-resolution asset, so the tile stays sharp at any zoom.
      image.src = original;

      if (model.animated && still) {
        image.dataset.stillSrc = still;
        image.dataset.animatedSrc = original;
      }

      if (model.provisional) {
        image.addEventListener(
          "load",
          () => this.measure(model.id, image.naturalWidth, image.naturalHeight),
          { once: true }
        );
      }

      // A remote cover can 403 on a hotlink-protected host. Drop the tile
      // rather than leaving a broken image in the wall.
      image.addEventListener(
        "error",
        () => {
          if (image.isConnected) this.onSourceFailed(model.id, model.signature);
        },
        { once: true }
      );

      this.revealWhenDecoded(image);

      element.media = image;
    }

    this.installTile(element, frame, model);
  }

  /**
   * Everything a card carries besides the thing it shows: its badges, its
   * drag and suggestion state, and its gestures.
   *
   * Shared by both kinds of card, so a card of words is a card in every way
   * a card of pictures is — selectable, draggable, right-clickable — and the
   * only difference between them stays what is drawn inside.
   */
  private installTile(element: TileElement, frame: HTMLElement, model: TileModel): void {
    this.paintBadges(frame.createDiv({ cls: "pg-meta" }), model);
    this.paintSuggestion(element, model.id);
    this.paintPlace(element, model.id);
    this.paintDragState(element, model.id);

    element.root.oncontextmenu = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      // Right-clicking outside the selection acts on that card alone, which
      // is what every file manager does.
      if (!this.selection.has(model.id)) {
        this.selectOnly(model.id, new Set([model.id]));
      }
      this.onContextRequested([...this.selection], event.clientX, event.clientY);
    };

    element.root.onclick = (event: MouseEvent) => {
      // A pan that ends over a tile must not also open it.
      if (this.panMoved) return;

      // Once a long press has opened selection mode, a tap adds and removes
      // rather than opening. It is cmd-click, without a cmd key to hold.
      if (this.touchSelecting) {
        this.selectOnly(model.id, toggleSelection(this.baseFor("clippings"), model.id));
        return;
      }

      if (event.metaKey || event.ctrlKey) {
        this.selectOnly(model.id, toggleSelection(this.baseFor("clippings"), model.id));
        return;
      }

      if (event.shiftKey) {
        this.applySelection(
          rangeSelection(
            this.tiles.map((t) => t.id),
            this.selectionAnchor,
            model.id,
            this.baseFor("clippings")
          )
        );
        return;
      }

      // A plain click selects, and the panel down the side says what was
      // selected. It used to open the full screen, which is the right gesture
      // for looking at a picture and the wrong one for reading a title or
      // fixing a tag: it covered the wall and lost your place. The full
      // screen is a button in that panel now.
      this.selectOnly(model.id, new Set([model.id]));
    };
  }

  /**
   * The tiles worth having in the DOM.
   *
   * A small wall keeps all of them, so nothing is ever torn down and no tile
   * has to be rebuilt and re-decoded when it comes back into view. A large one
   * falls back to the window around the camera. Removal still works either
   * way: the layout only holds positions for tiles that currently exist, so a
   * deleted clipping drops out of this list and is released by the caller.
   */
  private visiblePositions(): Position[] {
    if (shouldMountAll(this.layout.positions.length, MOUNT_ALL_BUDGET)) {
      return this.layout.positions;
    }

    const band = visibleContentBand(this.camera, this.viewportSize());
    // Overscan is a screen-space budget, so it grows in content units as you
    // zoom out. Capped, or a far-out view would mount hundreds of tiles.
    const overscan = Math.min(OVERSCAN / this.camera.zoom, MAX_OVERSCAN);
    return visibleRange(this.layout.positions, band.top, band.height, overscan);
  }

  render(): void {
    const visible = this.visiblePositions();
    const wanted = new Set(visible.map((p) => p.id));

    for (const [id, element] of [...this.mounted]) {
      if (!wanted.has(id)) {
        this.mounted.delete(id);
        this.release(element);
      }
    }
    for (const [id, element] of [...this.mountedFolders]) {
      if (!wanted.has(id)) {
        this.mountedFolders.delete(id);
        element.remove();
      }
    }

    let order = 0;
    for (const position of visible) {
      const folder = this.folderById.get(position.id);
      if (folder) {
        this.paintFolder(folder, position, order++);
        continue;
      }
      const model = this.byId.get(position.id);
      if (!model) continue;
      let element = this.mounted.get(position.id);
      if (!element) {
        element = this.acquire();
        this.mounted.set(position.id, element);
      }
      this.paint(element, model, position, order++);
    }

    // Spent. Tiles mounted by a later scroll are following the wall, not
    // restaging with it, so they glide as usual.
    this.restaging = false;

    this.paintSelection();
    this.onRendered();
  }

  /**
   * A folder's card: a collage of its members' covers, its name and a count,
   * and on hover (or after a long press) four corner handles that drag it to
   * one, two or every column. Not pooled: there are a handful at most, and a
   * pooled tile element is shaped around one media element.
   */
  private paintFolder(model: FolderTileModel, position: Position, order: number): void {
    let root = this.mountedFolders.get(model.id);
    if (!root) {
      root = this.canvas.createDiv({ cls: "pg-tile pg-folder-tile" });
      this.mountedFolders.set(model.id, root);
      this.installFolder(root, model.id);
      const spotlit = model.id === this.spotlightId;
      if (spotlit) root.addClass("is-spotlit");
      if (!this.knownFolders.has(model.id) || this.restaging || spotlit) {
        // The spotlit card leads: no stagger, it is the one thing arriving.
        const delay = spotlit ? 0 : Math.min(order, ENTER_STAGGER_CAP) * ENTER_STAGGER_MS;
        root.style.setProperty("--pg-enter-delay", `${delay}ms`);
        root.addClass("is-entering");
        const el = root;
        window.setTimeout(() => el.removeClass("is-entering"), delay + ENTER_MS + 60);
      }
      this.knownFolders.add(model.id);
    }

    root.toggleClass("is-gliding", !this.restaging && root.dataset.signature !== undefined);
    root.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    root.style.width = `${position.w}px`;
    root.style.height = `${position.h}px`;
    root.dataset.width = String(model.folder.width);

    // Pictures lead, and cards of words fill what is left.
    //
    // This was pictures only, on the reasoning that a card of words has no
    // picture to contribute and would leave a blank pane. True of the pane,
    // wrong about the folder: a folder holding nothing but writing then drew
    // the empty-folder icon and read as having nothing in it at all, which
    // is a worse thing to say than an unfamiliar one. A note contributes a
    // page, so it draws a page.
    const members = [...model.members].sort(
      (a, b) => Number(a.kind === "note") - Number(b.kind === "note")
    );
    const covers = members.slice(0, COVER_COUNT[model.folder.width]);
    const signature = [
      model.folder.name,
      model.folder.icon,
      model.folder.width,
      model.members.length,
      ...covers.map((m) => m.signature),
    ].join("|");
    if (root.dataset.signature === signature) return;
    root.dataset.signature = signature;

    // Only the picture and the pills are rebuilt. The handles are made once
    // in installFolder and survive every repaint: a drag reflows the wall on
    // each step, and rebuilding the handle mid-drag took the pointer capture
    // with it, ending the drag at the first width it reached.
    const frame = root.querySelector<HTMLElement>(".pg-frame") ?? root.createDiv();
    frame.querySelectorAll(".pg-folder-collage, .pg-folder-head").forEach((el) => el.remove());
    const handles = frame.querySelector(".pg-folder-handle");
    const collage = createDiv({ cls: "pg-folder-collage" });
    frame.insertBefore(collage, handles);
    collage.dataset.count = String(covers.length);
    if (covers.length === 0) {
      setIcon(collage.createDiv({ cls: "pg-folder-empty" }), model.folder.icon);
    }
    const plan = collagePlan(covers.length, model.folder.width);
    covers.forEach((member, index) => {
      // Each cover is built the way its tile's media is, still and all, so
      // the playback controller can drive it the same way: a video sits on
      // its poster until played, and a GIF on its still frame.
      const slot = collage.createDiv({ cls: "pg-folder-cover" });
      const span = plan[index];
      if (span) slot.dataset.span = `${span.columns}x${span.rows}`;
      if (member.kind === "note") {
        // The tile's own sheet, at the size of a stamp: paper, and the
        // clipping's name on it. No favicon and no body — at a quarter of a
        // folder card neither is legible, and a name is what tells two
        // pages apart.
        const page = slot.createDiv({ cls: "pg-folder-page" });
        page.createDiv({ cls: "pg-folder-page-title", text: member.record.title });
        return;
      }

      const still = this.sourceFor(member.posterPath, false);
      const original = this.sourceFor(member.filePath, member.remote);
      if (member.kind === "video") {
        const video = slot.createEl("video");
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = member.remote ? "metadata" : "none";
        if (still && !member.remote) video.poster = still;
        if (member.remote) video.src = original;
        else video.dataset.src = original;
      } else {
        const image = slot.createEl("img");
        image.decoding = "async";
        image.alt = "";
        image.draggable = false;
        if (member.animated && still) {
          image.src = still;
          image.dataset.stillSrc = still;
          image.dataset.animatedSrc = original;
        } else {
          image.src = original;
        }
        image.addEventListener("error", () => slot.addClass("is-broken"), { once: true });
      }
    });

    // The same pills a tile shows on hover, kept on: the name is the point.
    const head = createDiv({ cls: "pg-folder-head" });
    const name = head.createDiv({ cls: "pg-folder-name" });
    setIcon(name.createDiv({ cls: "pg-folder-icon" }), model.folder.icon);
    name.createSpan({ text: model.folder.name });
    head.createDiv({ cls: "pg-folder-count", text: String(model.members.length) });
    frame.insertBefore(head, handles);
  }

  /**
   * Opening, the menu, the long press that shows handles on touch, and the
   * handles themselves, which are made here once so a repaint cannot lose
   * one mid-drag.
   */
  private installFolder(root: HTMLElement, id: string): void {
    // A folder card is a drop target as much as its row in the rail is:
    // dragging a picture onto the pile it belongs in is the gesture, and
    // having to find the rail to do it is not.
    root.addEventListener("dragover", (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      root.addClass("is-drop-into");
    });
    root.addEventListener("dragleave", () => root.removeClass("is-drop-into"));
    root.addEventListener("drop", (event: DragEvent) => {
      root.removeClass("is-drop-into");
      const raw = event.dataTransfer?.getData(DRAG_TYPE);
      if (!raw) return;
      event.preventDefault();
      const ids = raw.split("\n").filter(Boolean);
      // The folder by its id, read at drop time: the card is pooled and the
      // handler outlives whichever folder it was first wired for.
      const folder = this.folderById.get(id)?.folder.name;
      if (ids.length > 0 && folder) this.onDropIntoFolder?.(ids, folder);
    });

    const frame = root.createDiv({ cls: "pg-frame pg-folder" });
    // The hover loop, which is what plays a tile's media, walks the tile
    // pool and never sees a folder, so the card reports its own hover: every
    // cover that can move, together.
    root.addEventListener("pointerenter", (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      this.onHoverMedia?.(this.folderMedia(root));
    });
    root.addEventListener("pointerleave", (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      this.onHoverMedia?.(this.hoveredMedia);
    });
    for (const corner of ["tl", "tr", "bl", "br"]) {
      const handle = frame.createDiv({ cls: `pg-folder-handle is-${corner}` });
      this.installHandle(handle, root, id, corner.endsWith("l") ? -1 : 1);
    }

    root.onclick = (event: MouseEvent) => {
      if (this.panMoved || this.touchSelecting) return;
      if (root.hasClass("is-handles")) return;
      event.stopPropagation();
      // A plain click still opens the folder; the modifier is what picks it
      // up, exactly as it does on a card. Shift is left out: folders sit in
      // stored order at the head of the wall and there are a handful of
      // them, so a range has nothing to save.
      if (event.metaKey || event.ctrlKey) {
        this.selectOnly(id, toggleSelection(this.baseFor("folders"), id));
        return;
      }
      this.onOpenFolder(this.folderById.get(id)?.folder.name ?? "");
    };
    root.oncontextmenu = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const name = this.folderById.get(id)?.folder.name;
      if (!name) return;
      // Right-clicking outside the selection acts on that folder alone, the
      // same rule the cards follow.
      if (!this.selection.has(id)) this.selectOnly(id, new Set([id]));
      this.onFolderContextRequested(name, event.clientX, event.clientY);
    };
    root.addEventListener("pointerdown", (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      window.clearTimeout(this.handlePress);
      const start = { x: event.clientX, y: event.clientY };
      this.handlePress = window.setTimeout(() => {
        root.toggleClass("is-handles", !root.hasClass("is-handles"));
      }, HANDLE_PRESS_MS);
      const cancel = (move: PointerEvent): void => {
        if (Math.hypot(move.clientX - start.x, move.clientY - start.y) < TOUCH_SLOP) return;
        window.clearTimeout(this.handlePress);
        root.removeEventListener("pointermove", cancel);
      };
      root.addEventListener("pointermove", cancel);
      root.addEventListener(
        "pointerup",
        () => {
          window.clearTimeout(this.handlePress);
          root.removeEventListener("pointermove", cancel);
        },
        { once: true }
      );
    });
  }

  /**
   * One corner. Only horizontal travel counts, and a left-hand corner reads
   * it mirrored, so dragging any corner away from the card grows it. The
   * card follows the drag live, and the new width is reported on release.
   */
  private installHandle(
    handle: HTMLElement,
    root: HTMLElement,
    id: string,
    direction: 1 | -1
  ): void {
    handle.addEventListener("pointerdown", (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const model = this.folderById.get(id);
      if (!model) return;
      const startX = event.clientX;
      const startWidth = model.folder.width;
      let width = startWidth;
      handle.setPointerCapture(event.pointerId);
      // Held for the whole drag: the pointer leaves the card as it grows and
      // shrinks, and the brackets should not blink out while it is held.
      root.addClass("is-resizing");

      const move = (ev: PointerEvent): void => {
        const travel = ((ev.clientX - startX) * direction) / this.camera.zoom;
        // Always from where the drag started, so going out to full and back
        // in lands on the width the same travel would have reached directly.
        const next = widthForDrag(startWidth, travel, this.columnWidth, GAP, this.columns);
        if (next === width) return;
        width = next;
        // The live model, which a repaint may have replaced since the press.
        const live = this.folderById.get(id) ?? model;
        live.folder = { ...live.folder, width };
        this.relayout({ hold: true });
        this.schedule();
      };
      const end = (): void => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        root.removeClass("is-resizing");
        if (width !== startWidth) this.onFolderResized(model.folder.name, width);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    });
    // A press on a handle is neither a pan nor a tap on the card.
    handle.onclick = (event: MouseEvent) => event.stopPropagation();
  }

  mountedMedia(): Array<HTMLVideoElement | HTMLImageElement> {
    const out: Array<HTMLVideoElement | HTMLImageElement> = [];
    for (const tile of this.mounted.values()) {
      const media = tile.media;
      if (media instanceof HTMLVideoElement) out.push(media);
      else if (media instanceof HTMLImageElement && media.dataset.animatedSrc) out.push(media);
    }
    for (const root of this.mountedFolders.values()) out.push(...this.folderMedia(root));
    return out;
  }

  /** The covers in a folder card that can move: its videos and its GIFs. */
  private folderMedia(root: HTMLElement): Array<HTMLVideoElement | HTMLImageElement> {
    return Array.from(
      root.querySelectorAll<HTMLVideoElement | HTMLImageElement>(
        ".pg-folder-cover video, .pg-folder-cover img[data-animated-src]"
      )
    );
  }

  destroy(): void {
    this.cancelTween();
    if (this.onScroll) this.viewport.removeEventListener("scroll", this.onScroll);
    if (this.hoverFrame) window.cancelAnimationFrame(this.hoverFrame);
    if (this.onKeyDown) this.viewport.doc.removeEventListener("keydown", this.onKeyDown);
    if (this.onKeyUp) this.viewport.doc.removeEventListener("keyup", this.onKeyUp);
    if (this.onBlur) window.removeEventListener("blur", this.onBlur);
    if (this.onWindowDragEnd) {
      window.removeEventListener("dragend", this.onWindowDragEnd);
      window.removeEventListener("drop", this.onWindowDragEnd);
    }
    if (this.frame) window.cancelAnimationFrame(this.frame);
    if (this.relayoutFrame) window.cancelAnimationFrame(this.relayoutFrame);
    window.clearTimeout(this.spotlightTimer);
    this.mounted.clear();
    this.mountedFolders.clear();
    this.measured.clear();
    this.pool = [];
  }
}
