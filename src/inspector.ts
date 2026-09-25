import { Notice, Platform, setIcon } from "obsidian";
import { paintCardMeta } from "./card-meta";
import {
  INSPECTOR_MAX,
  INSPECTOR_MIN,
  clampInspectorWidth,
  fileFacts,
  formatLabel,
  inspectorVisible,
  selectionLabel,
} from "./core/inspector";
import { segmentIndex, stepIndex } from "./core/carousel";
import { setGlyph } from "./glyph";
import { paintSwatchStrip, readSwatches } from "./core/swatch-strip";
import { systemAvailable } from "./core/system";
import { previewOf } from "./core/tile";
import type { TileModel } from "./core/tile";
import { attachTip } from "./core/tip";
import { watchedOnYoutube } from "./core/youtube";

/**
 * The panel down the right of the wall: what the selected card is, and every
 * way of changing it, without leaving the wall to find out.
 *
 * A click used to open the full screen. That is the right gesture for looking
 * at a picture and the wrong one for reading a title, fixing a tag or seeing
 * where something came from: it covers the wall, it loses your place, and it
 * answers one card at a time. So the click now selects, this panel says what
 * was selected, and the full screen is behind a button in it — a gesture you
 * choose rather than one you fall into.
 *
 * A drawer, not a column: away until a card is picked, then in from the edge,
 * over the wall rather than beside it.
 *
 * It stood there permanently at first, on the reasoning that appearing on the
 * click would reflow the masonry under the very card just clicked. Sliding
 * over the wall instead settles that without costing a column of the wall all
 * day: nothing is ever laid out again, so nothing moves under the pointer.
 * What it does cover is the last column and the wall's own controls, so the
 * controls step aside by the same width and in the same moment.
 *
 * On a phone there is no room for a column, so the same panel is a sheet
 * along the bottom and the wall keeps its whole width above it.
 */

export interface InspectorHandlers {
  /** The full screen, for the one card the button belongs to. */
  onOpen: (id: string) => void;
  /** The clipping's note, opened in Obsidian. */
  onOpenNote: (id: string) => void;
  /** The clipping's first file, shown in the system file manager. */
  onReveal: (id: string) => void;
  onDelete: (ids: string[]) => void;
  onDescribe: (ids: string[]) => void;
  /** One property's value picker, for every selected clipping at once. */
  onEditProperty: (ids: string[], key: string, x: number, y: number) => void;
  /** One prose property, written whole. Single selection only. */
  onEditText: (id: string, key: string, value: string) => void;
  onMoveToGrid: (ids: string[], x: number, y: number) => void;
  onMoveToFolder: (ids: string[], x: number, y: number) => void;
  /** Drops the selection, which empties the panel. */
  onClear: () => void;
  /** A width the person dragged, to be remembered for this device. */
  onResize: (width: number) => void;
  /** What the archived file weighs, for the folded facts. */
  bytesOf: (model: TileModel) => number;
  /** A vault path as something an <img> can load. */
  resource: (path: string) => string;
  /** Every picture this clipping holds, for stepping through them here. */
  reelFor: (model: TileModel) => TileModel[];
  /** A frame grabbed off a playing video, to stand as the card's cover. */
  onSetCoverFrame: (id: string, frame: Blob) => void;
  /** The card's own list of properties (Settings → Properties → Card). */
  properties: () => string[];
  /** Whether this plugin may write that key. */
  editable: (key: string) => boolean;
}

/**
 * How long the drawer takes to leave, matching the transition in the
 * stylesheet. The contents are dropped when it lands rather than when it is
 * asked to go, or it would slide out blank.
 */
const SHUT_MS = 280;

export class Inspector {
  private root: HTMLElement;
  private body: HTMLElement;
  private handle: HTMLElement;
  private models: TileModel[] = [];
  private width = 0;
  private hidden = false;
  private shown = false;
  /** Which folded sections are open, kept across repaints of the same card. */
  private unfolded = new Set<string>();
  /** A repaint asked for this frame, so a marquee paints once rather than
      once per card it sweeps over. */
  private frame = 0;

  constructor(
    private container: HTMLElement,
    private handlers: InspectorHandlers,
    width: number
  ) {
    this.width = clampInspectorWidth(width);
    this.root = container.createDiv({ cls: "pg-inspector" });
    if (Platform.isMobile) this.root.addClass("is-sheet");
    this.body = this.root.createDiv({ cls: "pg-inspector-body" });
    this.handle = this.root.createDiv({ cls: "pg-inspector-handle" });
    this.handle.setAttribute("aria-hidden", "true");
    this.installResize();
    this.apply();
  }

  /** Hidden by the setting, whatever the pane is doing. */
  setHidden(hidden: boolean): void {
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    this.apply();
  }

  get isHidden(): boolean {
    return this.hidden;
  }

  /** Whether the panel is on screen right now, pane width included. */
  get isShowing(): boolean {
    return this.shown;
  }

  setWidth(width: number): void {
    this.width = clampInspectorWidth(width);
    this.apply();
  }

  /**
   * What is selected now.
   *
   * Rebuilt rather than diffed, as the rail is: a panel of a dozen rows is
   * nothing to paint, and a diff of a list that changes shape is where stale
   * values come from. A selection of the same one card repaints in place,
   * which is what keeps an edit from elsewhere showing up here.
   */
  show(models: TileModel[]): void {
    this.models = models;
    if (models.length !== 1) this.unfolded.clear();
    // Coalesced. A marquee reports every card it sweeps over, and painting a
    // panel of chips per card makes the drag itself stutter.
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.apply();
    });
  }

  /** The pane changed size, so the panel may no longer fit beside the wall. */
  measure(): void {
    this.apply();
  }

  private apply(): void {
    const paneWidth = this.container.getBoundingClientRect().width;
    // One card picked, and only one: the drawer says what that card is. With
    // two or more the question is what to do to all of them, and every answer
    // to that is on the selection bar already. The drawer then only lies over
    // the last column, where the cards someone is still sweeping into the
    // selection are, so it stays shut.
    // The pane test is the desktop's alone: a phone is narrower than any
    // threshold a column would need, and the sheet is not a column.
    const shown =
      this.models.length === 1 &&
      (Platform.isMobile ? !this.hidden : inspectorVisible(paneWidth, this.hidden));
    const changed = shown !== this.shown;
    this.shown = shown;

    this.root.toggleClass("is-showing", shown);
    this.root.style.width = Platform.isMobile ? "" : `${this.width}px`;
    // How far the wall's own controls step aside. Not the wall itself: the
    // drawer is over it, so the masonry is never laid out again.
    this.container.style.setProperty(
      "--pg-inspector-w",
      shown && !Platform.isMobile ? `${this.width}px` : "0px"
    );

    if (shown) this.render();
    // Emptied a beat later than it closes, so the drawer slides out with its
    // contents rather than blank.
    else if (changed) window.setTimeout(() => this.clearIfShut(), SHUT_MS);
  }

  /**
   * Whether the reader is part-way through typing into the panel.
   *
   * A repaint replaces the textarea, which takes the caret and the unsaved
   * text with it. Refreshes arrive from the vault on their own schedule — an
   * archive finishing, a rule firing — and none of them are worth a sentence
   * someone was in the middle of.
   */
  private isEditing(): boolean {
    const active = this.body.doc.activeElement;
    return active instanceof HTMLElement && this.body.contains(active) && active.isContentEditable
      ? true
      : active instanceof HTMLTextAreaElement && this.body.contains(active);
  }

  /** Drops the contents of a drawer that is still shut when the slide ends. */
  private clearIfShut(): void {
    if (!this.shown) this.body.empty();
  }

  private render(): void {
    if (this.isEditing()) return;
    this.body.empty();
    if (this.models.length === 1) this.renderOne(this.models[0]);
  }

  private renderOne(model: TileModel): void {
    this.paintHead([model]);
    this.paintPreview(model);
    this.paintBar([model]);

    const meta = this.body.createDiv({ cls: "pg-inspector-meta" });
    paintCardMeta(
      meta,
      model,
      { properties: this.handlers.properties, editable: this.handlers.editable },
      {
        onEditProperty: (id, key, x, y) => this.handlers.onEditProperty([id], key, x, y),
        onEditText: (id, key, value) => this.handlers.onEditText(id, key, value),
      }
    );

    this.paintPlace(meta, [model]);
    this.paintFacts(meta, model);
  }

  /** The count, and a way out of the selection. */
  private paintHead(models: TileModel[]): void {
    const head = this.body.createDiv({ cls: "pg-inspector-head" });
    head.createSpan({
      cls: "pg-inspector-count",
      text: selectionLabel(models.length),
    });

    const clear = head.createEl("button", { cls: "pg-inspector-icon" });
    setIcon(clear, "x");
    attachTip(clear, "Clear selection");
    clear.setAttribute("aria-label", "Clear selection");
    clear.onclick = () => this.handlers.onClear();
  }

  /**
   * The picture, with what it is written over the corner.
   *
   * Reads the same preview the wall is already showing, so this costs a
   * cached decode rather than a fetch. A video has no still to show unless it
   * was given a poster, and shows its format chip alone rather than a hole.
   */
  private paintPreview(model: TileModel): void {
    const frame = this.body.createDiv({ cls: "pg-inspector-frame" });

    const format = formatLabel(model);
    if (format) frame.createSpan({ cls: "pg-inspector-format", text: format });

    // The colours go directly under whatever they were read from, so the row
    // is held open for them rather than landing at the foot of whatever had
    // been drawn by the time the decode finished.
    const palette = this.body.createDiv({ cls: "pg-inspector-palette" });

    if (model.kind === "video" && model.filePath) {
      this.paintVideo(frame, model, palette);
      return;
    }

    const preview = previewOf(model);
    if (!preview) {
      const glyph = frame.createSpan({ cls: "pg-inspector-noframe" });
      setIcon(glyph, model.kind === "video" ? "play" : "file-text");
      return;
    }

    const image = frame.createEl("img", { cls: "pg-inspector-image" });
    const src = (tile: TileModel): string => {
      const held = previewOf(tile);
      if (!held) return "";
      return held.remote ? held.path : this.handlers.resource(held.path);
    };
    image.src = preview.remote ? preview.path : this.handlers.resource(preview.path);
    image.decoding = "async";

    this.paintReel(frame, image, model, src);
    void this.paintSwatches(image, palette);
  }

  /**
   * A video, playing, with the browser's own controls under it.
   *
   * Not on hover, as the wall is: picking one card is already the deliberate
   * act that hovering stands in for out there, and a panel you have to keep
   * the pointer inside to watch is a panel you cannot scrub. So it plays on
   * arrival and carries a timeline, which is the thing the wall cannot give
   * a clip and the reason to open one card at all.
   */
  private paintVideo(frame: HTMLElement, model: TileModel, palette: HTMLElement): void {
    const video = frame.createEl("video", { cls: "pg-inspector-image pg-inspector-video" });
    video.src = model.remote ? model.filePath : this.handlers.resource(model.filePath);
    if (model.posterPath) video.poster = this.handlers.resource(model.posterPath);
    video.controls = true;
    video.autoplay = true;
    video.loop = true;
    video.playsInline = true;

    // Read off the poster, there being no decoded picture to read otherwise.
    // A video with no poster simply has no palette, which is honest.
    if (model.posterPath) {
      const still = createEl("img");
      still.src = this.handlers.resource(model.posterPath);
      void this.paintSwatches(still, palette);
    }

    const grab = frame.createEl("button", { cls: "pg-inspector-grab" });
    setGlyph(grab.createSpan({ cls: "pg-bar-glyph" }), "image-plus", "image", "camera");
    attachTip(grab, "Set frame as cover");
    grab.setAttribute("aria-label", "Set frame as cover");
    grab.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      this.grabFrame(video, model.id);
    };
  }

  /**
   * The frame showing right now, as the card's cover.
   *
   * A video's cover is whatever poster the archiver derived, which is the
   * first frame it could decode — often black, often a hand halfway into
   * shot. The one frame that says what the clip is, is the one you stopped
   * on, and by then you are already looking at it.
   */
  private grabFrame(video: HTMLVideoElement, id: string): void {
    if (!video.videoWidth || !video.videoHeight) return;
    const canvas = createEl("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;

    try {
      context.drawImage(video, 0, 0);
      // Throws rather than returning null on a canvas the video tainted,
      // which is what a file still being served from its origin does.
      canvas.toBlob(
        (blob) => {
          if (blob) this.handlers.onSetCoverFrame(id, blob);
        },
        "image/jpeg",
        0.92
      );
    } catch {
      new Notice("Goko: this video will not give up a frame");
    }
  }

  /**
   * Stepping through a post's other pictures, here as well as on the wall.
   *
   * The card scrubs under the pointer and the full screen has a reel, and
   * between them sat the one place that showed a stack as a single picture
   * and gave no hint there were sixteen more. The dots are the hint; the
   * sweep is the wall's own gesture, brought over unchanged so it is the
   * same thing being learnt once.
   *
   * And a click steps one frame on, because a sweep needs a pointer and this
   * panel is a sheet on a phone.
   */
  private paintReel(
    frame: HTMLElement,
    image: HTMLImageElement,
    model: TileModel,
    src: (tile: TileModel) => string
  ): void {
    const reel = this.handlers.reelFor(model).filter((tile) => previewOf(tile) !== null);
    if (reel.length < 2) return;

    frame.addClass("is-reel");
    const dots = frame.createDiv({ cls: "pg-dots" });
    const marks = reel.map((_tile, i) =>
      dots.createSpan({ cls: i === 0 ? "pg-dot-step is-on" : "pg-dot-step" })
    );

    // Where the frame returns to when the pointer leaves: the cover, which is
    // what the wall shows and so what this panel is understood to be about.
    let shown = 0;
    const show = (index: number): void => {
      const next = Math.max(0, Math.min(reel.length - 1, index));
      if (next === shown) return;
      shown = next;
      const href = src(reel[next]);
      if (href) image.src = href;
      marks.forEach((mark, i) => mark.toggleClass("is-on", i === next));
    };

    frame.addEventListener("pointermove", (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const box = frame.getBoundingClientRect();
      show(segmentIndex(event.clientX - box.left, box.width, reel.length));
    });
    frame.addEventListener("pointerleave", () => show(0));
    frame.addEventListener("click", () => show(stepIndex(shown, reel.length, 1)));
  }

  /**
   * Adds the palette once the picture has decoded.
   *
   * Not awaited by the caller: the colours are worth a moment's wait, the
   * panel is not. The panel is rebuilt on every selection change, so by the
   * time a large picture has decoded this host may belong to no document.
   */
  private async paintSwatches(image: HTMLImageElement, host: HTMLElement): Promise<void> {
    const swatches = await readSwatches(image);
    if (!host.isConnected || swatches.length === 0) return;
    paintSwatchStrip(host, swatches);
  }

  /**
   * One row at the top: the full screen, then everything else that can be
   * done to what is selected.
   *
   * The actions sat at the foot of the panel, which put them a scroll away on
   * any card with a few properties, and left the top of the panel holding a
   * single wide button. Doing something to a card is not the last thing you
   * think of after reading it, so it is not the last thing on the panel.
   */
  private paintBar(models: TileModel[]): void {
    const ids = models.map((model) => model.id);
    const bar = this.body.createDiv({ cls: "pg-inspector-bar" });

    // Only for one card. A full screen of five is a lie about which one it
    // would show, and the reel already walks the wall from inside it.
    if (models.length === 1) {
      const open = bar.createEl("button", { cls: "pg-inspector-open" });
      const glyph = open.createSpan({ cls: "pg-inspector-open-glyph" });
      setIcon(glyph, "expand");
      open.createSpan({ cls: "pg-inspector-open-label", text: "Open" });
      open.onclick = () => this.handlers.onOpen(ids[0]);
    }

    const button = (
      icon: string,
      label: string,
      run: () => void,
      destructive = false
    ): void => {
      const element = bar.createEl("button", {
        cls: destructive ? "pg-inspector-action is-destructive" : "pg-inspector-action",
      });
      const glyph = element.createSpan({ cls: "pg-inspector-action-glyph" });
      setIcon(glyph, icon);
      attachTip(element, label);
      element.setAttribute("aria-label", label);
      element.onclick = () => run();
    };

    button("sparkles", "Describe with AI", () => this.handlers.onDescribe(ids));
    if (models.length === 1) {
      button("file-text", "Open note", () => this.handlers.onOpenNote(ids[0]));
      // An ordinary YouTube video is kept as its cover, not downloaded, so
      // the video itself is on YouTube and this is the way to it. The same
      // as Open in browser in the full screen, which is a click further away.
      const source = models[0].record.source;
      if (watchedOnYoutube(source)) {
        button("external-link", "Open on YouTube", () => window.open(source));
      }
      // Nothing to reveal without a file manager to reveal it in, and nothing
      // to reveal for a clipping whose media is still someone else's URL.
      if (systemAvailable() && models[0].filePath && !models[0].remote) {
        button("folder-open", "Show in system explorer", () => this.handlers.onReveal(ids[0]));
      }
    }
    button("trash-2", "Delete", () => this.handlers.onDelete(ids), true);
  }

  /**
   * Where these cards live, as two buttons rather than as chips.
   *
   * A grid and a folder are one value each and a move, not a set and a tick,
   * so the picker they open is the wall's move menu rather than a property's.
   */
  private paintPlace(host: HTMLElement, models: TileModel[]): void {
    const ids = models.map((model) => model.id);
    const grids = new Set(models.map((model) => model.record.grid || ""));
    const folders = new Set(models.map((model) => model.record.folder || ""));

    const row = (
      label: string,
      values: Set<string>,
      fallback: string,
      open: (x: number, y: number) => void
    ): void => {
      const block = host.createDiv({ cls: "pg-detail-field is-editable" });
      block.createDiv({ cls: "pg-detail-label", text: label });
      const chips = block.createDiv({ cls: "pg-detail-chips" });
      const text =
        values.size > 1
          ? "Mixed"
          : [...values][0] || fallback;
      const chip = chips.createEl("button", {
        cls: text === fallback ? "pg-detail-chip is-empty" : "pg-detail-chip",
        text,
      });
      chip.onclick = () => {
        const rect = chip.getBoundingClientRect();
        open(rect.left, rect.bottom + 4);
      };
    };

    row("Grid", grids, "Unfiled…", (x, y) => this.handlers.onMoveToGrid(ids, x, y));
    row("Folder", folders, "Loose…", (x, y) => this.handlers.onMoveToFolder(ids, x, y));
  }

  /**
   * What the file is, folded away.
   *
   * These rows were pulled out of the detail panel once because a designer's
   * card is about the picture and not about the file. That is still true of
   * the card; it is not true of the moment you need to know whether this is
   * big enough to use.
   */
  private paintFacts(host: HTMLElement, model: TileModel): void {
    const facts = fileFacts(model, this.handlers.bytesOf(model));
    if (facts.length === 0) return;

    const fold = host.createEl("details", { cls: "pg-inspector-fold" });
    fold.open = this.unfolded.has("facts");
    const summary = fold.createEl("summary", { cls: "pg-inspector-summary" });
    summary.createSpan({ text: "Details" });
    fold.ontoggle = () => {
      if (fold.open) this.unfolded.add("facts");
      else this.unfolded.delete("facts");
    };

    const table = fold.createDiv({ cls: "pg-inspector-facts" });
    for (const fact of facts) {
      const line = table.createDiv({ cls: "pg-inspector-fact" });
      line.createSpan({ cls: "pg-inspector-fact-label", text: fact.label });
      line.createSpan({ cls: "pg-inspector-fact-value", text: fact.value });
    }
  }

  destroy(): void {
    if (this.frame) window.cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.root.remove();
    // The wall keeps the width back, in case the pane outlives this panel.
    this.container.setCssProps({ "--pg-inspector-w": "0px" });
  }

  private installResize(): void {
    let from = 0;
    let start = 0;

    const move = (event: PointerEvent): void => {
      // The handle is on the panel's left edge, so travel to the left widens
      // it: the sign is the mirror of the rail's, not a different rule.
      const next = clampInspectorWidth(start + (from - event.clientX));
      this.width = next;
      this.root.style.width = `${next}px`;
      this.container.style.setProperty("--pg-inspector-w", `${next}px`);
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this.container.doc.body.removeClass("pg-resizing");
      this.handlers.onResize(this.width);
    };

    this.handle.addEventListener("pointerdown", (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      from = event.clientX;
      start = this.width;
      this.container.doc.body.addClass("pg-resizing");
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });

    // Double-click resets, which is the only way back from a width dragged to
    // an extreme without dragging it back by hand.
    this.handle.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      this.setWidth((INSPECTOR_MIN + INSPECTOR_MAX) / 2);
      this.handlers.onResize(this.width);
    });
  }
}
