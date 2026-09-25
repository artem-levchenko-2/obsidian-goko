import { Platform, setIcon, setTooltip } from "obsidian";
import { DRAG_TYPE } from "./core/drag";
import type { RailDrop, RailItem, SidebarGrid, SidebarModel } from "./core/sidebar";
import {
  RAIL_TYPE,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  clampSidebarWidth,
  dropZone,
  offersInto,
  railDrop,
  sidebarVisible,
} from "./core/sidebar";
import { HOME_TINT, gridTint } from "./core/spaces";
import { attachTip } from "./core/tip";

/**
 * The rail down the left of the wall: Inbox, the grids with their folders,
 * the smart views, and a way to make another.
 *
 * Grids lived in a menu behind a button in the corner. That is a fine way to
 * switch between two of them and a poor way to know what you have, and it
 * gave a card nowhere to be dropped: filing something meant selecting it,
 * finding Move to grid, and reading a list that covered the wall. Here the
 * list is simply present, every row is a target, and the count beside each
 * name says what filing has actually achieved.
 *
 * An overlay pinned to the left rather than a column in a flex row: the wall
 * and everything over it are already positioned against the view, so a rail
 * that took part in the layout would have meant rebuilding all of it. The
 * viewport is inset by a custom property instead, which is one line of CSS
 * and one call to relayout.
 */

export interface SidebarHandlers {
  /** Switch the wall to this grid, or into one of its folders. */
  onPick: (grid: string, folder?: string) => void;
  /** Show every clipping in the vault, filed or not. */
  onPickAll: () => void;
  /** The grid's own menu, at the pointer: rename, icon, colour, delete. */
  onGridMenu: (grid: string, x: number, y: number) => void;
  /** A folder's own menu, at the pointer. */
  onFolderMenu: (grid: string, folder: string, x: number, y: number) => void;
  /**
   * Make a grid named what was typed into the row at the end of the list.
   * Answers whether it was made, so a name that is refused stays in the
   * field to be fixed rather than vanishing.
   */
  onCreateGrid: (name: string) => Promise<boolean>;
  /** Clippings dropped onto a row. */
  onDrop: (ids: string[], grid: string, folder?: string) => void;
  /** A row dropped on another row: reordered, moved, or turned into the other kind. */
  onRailDrop: (drop: RailDrop) => void;
  /** A width the person dragged, to be remembered for this device. */
  onResize: (width: number) => void;
  /** The rail appearing or going, so the wall can be laid out again. */
  onLayout: () => void;
}

export class Sidebar {
  private root: HTMLElement;
  private list: HTMLElement;
  private handle: HTMLElement;
  private model: SidebarModel | null = null;
  private active = "";
  private activeFolder: string | null = null;
  /** Whether the wall is showing the whole library rather than one grid. */
  private showingAll = false;
  private width = 0;
  private hidden = false;
  private shown = false;
  /** Folders collapsed by grid name. Session state: a fold is not a setting. */
  private folded = new Set<string>();
  /**
   * The row being dragged to a new place, if one is. Kept here because a
   * drag's data cannot be read until the drop, and every row it passes has
   * to know before then whether it may take it.
   */
  private moving: RailItem | null = null;
  /**
   * The row whose name is being typed over, if one is, and what has been
   * typed so far. Kept here because the rail is rebuilt on every wall
   * refresh, and a field that lived only in the DOM would be thrown away
   * mid-word by a card landing.
   */
  private renaming: { grid: string; folder: string | null; value: string; commit: (name: string) => Promise<boolean> } | null = null;
  /** The name typed into the New grid row, while it is a field. */
  private creating: { value: string } | null = null;

  constructor(
    private container: HTMLElement,
    private handlers: SidebarHandlers,
    width: number
  ) {
    this.width = clampSidebarWidth(width);
    this.root = container.createDiv({ cls: "pg-sidebar" });
    this.list = this.root.createDiv({ cls: "pg-sidebar-list" });
    this.handle = this.root.createDiv({ cls: "pg-sidebar-handle" });
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

  /** Whether the rail is on screen right now, pane width included. */
  get isShowing(): boolean {
    return this.shown;
  }

  setWidth(width: number): void {
    this.width = clampSidebarWidth(width);
    this.apply();
  }

  /**
   * Redraws for a model and a selection. Called on every wall refresh, so it
   * rebuilds rather than diffs: a dozen rows of text is nothing to paint, and
   * a diff of a list that changes shape is where stale counts come from.
   */
  paint(model: SidebarModel, active: string, folder: string | null, all: boolean): void {
    this.model = model;
    this.active = active;
    this.activeFolder = folder;
    this.showingAll = all;
    this.apply();
  }

  /** The rail stands aside on a pane too narrow to give it room. */
  measure(): void {
    this.apply();
  }

  /**
   * Turns a row's name into a field, in place, the way a file is renamed in
   * the explorer. Enter or leaving the field commits, Escape puts the name
   * back. `commit` answers whether the name was taken, so one that was
   * refused stays in the field to be fixed. False when the row is not on
   * screen, for the caller to fall back on.
   */
  rename(grid: string, folder: string | null, commit: (name: string) => Promise<boolean>): boolean {
    if (!this.shown) return false;
    if (folder) this.folded.delete(grid);
    this.renaming = { grid, folder, value: folder ?? grid, commit };
    this.render();
    return this.list.querySelector(".pg-sidebar-rename") !== null;
  }

  /** Where a row is on screen, for a panel opened beside it. */
  rowRect(grid: string, folder: string | null = null): DOMRect | null {
    if (!this.shown) return null;
    const rows = this.list.querySelectorAll<HTMLElement>(".pg-sidebar-row");
    for (const row of Array.from(rows)) {
      if (row.dataset.grid === grid && (row.dataset.folder ?? null) === folder) return row.getBoundingClientRect();
    }
    return null;
  }

  /** A name field in place of a row's name; see rename. */
  private nameField(host: HTMLElement): void {
    const state = this.renaming;
    if (!state) return;
    const input = host.createEl("input", { cls: "pg-sidebar-rename", type: "text" });
    input.value = state.value;
    let settled = false;
    const finish = async (keep: boolean): Promise<void> => {
      if (settled) return;
      settled = true;
      const name = input.value.trim();
      if (keep && name && name !== (state.folder ?? state.grid)) {
        if (!(await state.commit(name))) {
          // Refused, with the reason already said: back into the field.
          settled = false;
          input.focus();
          return;
        }
      }
      this.renaming = null;
      this.render();
    };
    input.oninput = () => {
      state.value = input.value;
    };
    input.onkeydown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Enter") void finish(true);
      else if (event.key === "Escape") void finish(false);
    };
    input.onblur = () => void finish(true);
    // A click in the field is the field's, not the row's.
    input.onclick = (event) => event.stopPropagation();
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  private apply(): void {
    const paneWidth = this.container.getBoundingClientRect().width;
    // A phone has no room and no pointer for this; the grid menu does the work.
    const shown = !Platform.isMobile && sidebarVisible(paneWidth, this.hidden) && !!this.model;
    const changed = shown !== this.shown;
    this.shown = shown;

    this.root.toggleClass("is-showing", shown);
    this.root.style.width = `${this.width}px`;
    // What the wall is inset by. Zero when the rail is away, so the wall keeps
    // the whole pane rather than a gap where a rail used to be.
    this.container.style.setProperty("--pg-sidebar-w", shown ? `${this.width}px` : "0px");
    if (shown) this.render();
    else this.list.empty();
    if (changed) this.handlers.onLayout();
  }

  private render(): void {
    const model = this.model;
    if (!model) return;
    this.list.empty();

    // The two rows that are not boards: everything there is, and what has
    // not been filed yet. Above the rule, because neither can be renamed,
    // reordered, deleted or dropped into — they are the two ways of looking
    // at the library rather than places inside it.
    //
    // Library first, and first is where the wall opens. A reference library
    // is a thing you sweep your eye across; the inbox is a chore. Putting the
    // chore at the top made the plugin open onto work to be done rather than
    // onto what it is for.
    this.libraryRow(model.all.count);
    this.row(model.home, { home: true });

    this.list.createDiv({ cls: "pg-sidebar-rule" });

    if (model.grids.length > 0) this.caption("Grids");
    for (const grid of model.grids) this.row(grid, {});

    this.addRow();

    // Views last: they are rules rather than places, and a rule is a thing
    // you consult rather than a thing you file into.
    if (model.views.length > 0) {
      this.caption("Views");
      for (const view of model.views) this.row(view, {});
    }
  }

  /**
   * The row that makes a grid. A click turns it into a field for the name,
   * where the grid is made on Enter: in place, in the list it will join,
   * rather than in a panel in the middle of the window. Its icon and colour
   * are the row's own menu afterwards.
   */
  private addRow(): void {
    const add = this.list.createEl("button", { cls: "pg-sidebar-add" });
    const glyph = add.createSpan({ cls: "pg-sidebar-glyph" });
    setIcon(glyph, "plus");
    if (!this.creating) {
      add.createSpan({ cls: "pg-sidebar-name", text: "New grid" });
      add.onclick = (event) => {
        event.stopPropagation();
        this.creating = { value: "" };
        this.render();
      };
      return;
    }

    const state = this.creating;
    const input = add.createEl("input", { cls: "pg-sidebar-rename", type: "text", placeholder: "Grid name" });
    input.value = state.value;
    let settled = false;
    const finish = async (keep: boolean): Promise<void> => {
      if (settled) return;
      settled = true;
      const name = input.value.trim();
      if (keep && name && !(await this.handlers.onCreateGrid(name))) {
        settled = false;
        input.focus();
        return;
      }
      this.creating = null;
      this.render();
    };
    input.oninput = () => {
      state.value = input.value;
    };
    input.onkeydown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Enter") void finish(true);
      else if (event.key === "Escape") void finish(false);
    };
    input.onblur = () => void finish(Boolean(input.value.trim()));
    input.onclick = (event) => event.stopPropagation();
    window.setTimeout(() => input.focus(), 0);
  }

  /** Every clipping in the vault. Not a grid: nothing is filed into it. */
  private libraryRow(count: number): void {
    const row = this.list.createEl("button", { cls: "pg-sidebar-row is-system" });
    if (this.showingAll) row.addClass("is-on");
    const glyph = row.createSpan({ cls: "pg-sidebar-glyph" });
    setIcon(glyph, "book-open");
    row.createSpan({ cls: "pg-sidebar-name", text: "Library" });
    row.createSpan({ cls: "pg-sidebar-count", text: count > 0 ? String(count) : "" });
    row.onclick = (event) => {
      event.stopPropagation();
      this.handlers.onPickAll();
    };
  }

  private caption(text: string): void {
    this.list.createDiv({ cls: "pg-sidebar-caption", text });
  }

  private row(entry: SidebarGrid, options: { home?: boolean }): void {
    const name = entry.grid.name;
    const row = this.list.createEl("button", { cls: "pg-sidebar-row" });
    row.dataset.grid = name;
    if (name === this.active && !this.activeFolder && !this.showingAll) row.addClass("is-on");
    if (entry.smart) row.addClass("is-smart");
    if (options.home) row.addClass("is-system");

    const glyph = row.createSpan({ cls: "pg-sidebar-glyph" });
    setIcon(glyph, entry.grid.icon || "layout-grid");
    // Every grid has a colour, chosen or derived, so the rail and the chips
    // on the wall name the same board in the same hue. A folder takes its
    // grid's: a folder is a place inside a board, not another board. The
    // inbox is not a board, so it is drawn plain, as the library is.
    const color = options.home ? HOME_TINT : gridTint(entry.grid);
    glyph.style.color = color;

    if (this.renaming && this.renaming.grid === name && this.renaming.folder === null) this.nameField(row);
    else row.createSpan({ cls: "pg-sidebar-name", text: name });
    row.createSpan({ cls: "pg-sidebar-count", text: entry.count > 0 ? String(entry.count) : "" });
    // What the grid is for, under the pointer: the one place it is shown
    // outside the grid's own sheet, now that the wall carries no band for it.
    const about = entry.grid.description?.trim();
    if (about) setTooltip(row, about, { placement: "right" });

    // The fold arrow shares the right edge with the count rather than taking
    // a gutter on the left: a gutter is paid for by every row in the list,
    // including the ones that never fold, and it pushed the whole rail in to
    // make room for two arrows. Only under the pointer, where the count
    // steps aside for it — a row is read for its name and its number, and
    // the arrow is for when you have decided to act on it.
    const folders = entry.folders;
    if (folders.length > 0) {
      row.addClass("is-foldable");
      if (this.folded.has(name)) row.addClass("is-folded");
      const twist = row.createSpan({ cls: "pg-sidebar-twist" });
      setIcon(twist, this.folded.has(name) ? "chevron-right" : "chevron-down");
      twist.onclick = (event) => {
        event.stopPropagation();
        if (this.folded.has(name)) this.folded.delete(name);
        else this.folded.add(name);
        this.render();
      };
    }

    row.onclick = (event) => {
      event.stopPropagation();
      this.handlers.onPick(name);
    };
    // A menu at the pointer, as a card's is. Home has one too, for its
    // name and its icon; the menu leaves out what it cannot do.
    row.oncontextmenu = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.handlers.onGridMenu(name, event.clientX, event.clientY);
    };
    // Nothing is filed into a view: it shows whatever matches its rules, and a
    // card dropped on one would have to be given a value it never asked for.
    if (!entry.smart) this.makeTarget(row, name);
    // The inbox stays first, under the library: it is where the wall starts,
    // not one board among the others.
    if (!options.home) this.makeMovable(row, { kind: entry.smart ? "view" : "grid", grid: name });

    if (this.folded.has(name)) return;
    for (const held of folders) {
      const sub = this.list.createEl("button", { cls: "pg-sidebar-row is-folder" });
      sub.dataset.grid = name;
      sub.dataset.folder = held.folder.name;
      if (name === this.active && held.folder.name === this.activeFolder && !this.showingAll) {
        sub.addClass("is-on");
      }
      // The elbow that says this row belongs to the one above it. A span
      // rather than a border on the row, so it can be an L rather than a
      // straight line down the side of every child.
      sub.createSpan({ cls: "pg-sidebar-elbow" });
      const folderGlyph = sub.createSpan({ cls: "pg-sidebar-glyph" });
      setIcon(folderGlyph, held.folder.icon || "folder");
      folderGlyph.style.color = color;
      if (this.renaming && this.renaming.grid === name && this.renaming.folder === held.folder.name) {
        this.nameField(sub);
      } else {
        sub.createSpan({ cls: "pg-sidebar-name", text: held.folder.name });
      }
      sub.createSpan({
        cls: "pg-sidebar-count",
        text: held.count > 0 ? String(held.count) : "",
      });
      sub.onclick = (event) => {
        event.stopPropagation();
        this.handlers.onPick(name, held.folder.name);
      };
      sub.oncontextmenu = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.handlers.onFolderMenu(held.folder.grid, held.folder.name, event.clientX, event.clientY);
      };
      this.makeTarget(sub, name, held.folder.name);
      this.makeMovable(sub, { kind: "folder", grid: held.folder.grid, folder: held.folder.name });
    }
  }

  /**
   * A row that can be dragged to a new place in the rail, and that takes
   * another row dropped on it: see railDrop for what each drop means. The
   * edges put the other just above or below; the middle of a grid's row,
   * when that means something, takes it in, and the row lights up whole to
   * say so rather than drawing a line.
   *
   * Its own data type, so the card drop on the same row ignores it and it
   * ignores cards. The type is checked as well as the row in hand, because
   * a drag that ended outside the window never tells the row it started on.
   */
  private makeMovable(row: HTMLElement, item: RailItem): void {
    // Not while its name is being typed over; see nameField.
    row.draggable = !row.querySelector(".pg-sidebar-rename");
    const unmark = (): void => {
      row.removeClass("is-drop-before");
      row.removeClass("is-drop-after");
      row.removeClass("is-drop-into");
    };
    const dropAt = (event: DragEvent): RailDrop | null => {
      if (!event.dataTransfer?.types.includes(RAIL_TYPE) || this.moving === null) return null;
      const rect = row.getBoundingClientRect();
      const zone = dropZone(event.clientY - rect.top, rect.height, offersInto(this.moving, item));
      return railDrop(this.moving, item, zone);
    };

    row.addEventListener("dragstart", (event: DragEvent) => {
      if (!event.dataTransfer) return;
      event.dataTransfer.setData(RAIL_TYPE, JSON.stringify(item));
      event.dataTransfer.effectAllowed = "move";
      this.moving = item;
      row.addClass("is-moving");
    });
    row.addEventListener("dragend", () => {
      this.moving = null;
      row.removeClass("is-moving");
    });
    row.addEventListener("dragover", (event: DragEvent) => {
      const drop = dropAt(event);
      if (!drop) {
        unmark();
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const into = (drop.kind === "demote" && drop.beside === null) || drop.kind === "folder-move";
      const after = !into && "after" in drop && drop.after;
      row.toggleClass("is-drop-into", into);
      row.toggleClass("is-drop-before", !into && !after);
      row.toggleClass("is-drop-after", after);
    });
    row.addEventListener("dragleave", unmark);
    row.addEventListener("drop", (event: DragEvent) => {
      const drop = dropAt(event);
      unmark();
      if (!drop) return;
      event.preventDefault();
      this.moving = null;
      this.handlers.onRailDrop(drop);
    });
  }

  /**
   * A row that takes clippings dragged off the wall.
   *
   * dragover has to cancel the event on every move rather than once, or the
   * browser goes back to refusing the drop halfway across the row — the same
   * rule the wall's own drop target is written against.
   */
  private makeTarget(row: HTMLElement, grid: string, folder?: string): void {
    // Marked as well as wired: while a card is in flight every row that can
    // take it says so, rather than each one waiting to be found.
    row.addClass("is-droppable");
    row.addEventListener("dragover", (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      row.addClass("is-target");
    });
    row.addEventListener("dragleave", () => row.removeClass("is-target"));
    row.addEventListener("drop", (event: DragEvent) => {
      row.removeClass("is-target");
      const raw = event.dataTransfer?.getData(DRAG_TYPE);
      if (!raw) return;
      event.preventDefault();
      const ids = raw.split("\n").filter(Boolean);
      if (ids.length > 0) this.handlers.onDrop(ids, grid, folder);
    });
  }

  /**
   * Whether a card is in flight, and so whether the rows that can take it
   * should be showing that they can.
   *
   * The article's "revealed" state for a drop zone: today a row only admits
   * it is a target once you are over it, which is no help while you are
   * deciding where to aim.
   */
  setDropHint(lifted: boolean): void {
    this.root.toggleClass("is-dropping", lifted);
  }

  /** The right edge, dragged to set the width. */
  private installResize(): void {
    let from = 0;
    let start = 0;

    const move = (event: PointerEvent): void => {
      const next = clampSidebarWidth(start + (event.clientX - from));
      this.width = next;
      this.root.style.width = `${next}px`;
      this.container.style.setProperty("--pg-sidebar-w", `${next}px`);
      this.handlers.onLayout();
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
      this.setWidth((SIDEBAR_MIN + SIDEBAR_MAX) / 2);
      this.handlers.onResize(this.width);
      this.handlers.onLayout();
    });

    attachTip(this.handle, "Drag to resize");
  }
}
