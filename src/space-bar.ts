import { Platform, setIcon } from "obsidian";
import { settled } from "./core/settle";
import type { GridSpace } from "./core/spaces";
import { setGlyph } from "./glyph";
import { attachTip, retip } from "./core/tip";
import { NotificationPanel } from "./notifications";
import type { NotificationCenter } from "./notifications";

/** Space left between a control and the menu it launches. */
const LAUNCH_GAP = 10;

/**
 * How long typing has to pause before the wall follows it. Long enough that
 * a word typed at speed redraws the wall once rather than once a letter, and
 * short enough that stopping to look reads as the wall answering.
 */
const QUERY_SETTLE_MS = 150;

/** The field's growth, on the easing every other move in the dock uses. */
const MORPH_MS = 240;
const MORPH_EASING = "cubic-bezier(0.22, 0.9, 0.28, 1)";

export interface SpaceBarHandlers {
  /**
   * What the search field holds, once typing pauses, or at once on Enter.
   * The field is in the bar rather than behind a shortcut, because a
   * shortcut is not a UI: it is not on a phone, it is not discoverable, and
   * it is the first thing to fail.
   */
  onQuery: (text: string) => void;
  /** The count beside the query was pressed: search somewhere else. */
  onSearchScope: () => void;
  /** The clear button was pressed: the search is over. */
  onEndSearch: () => void;
  /** Open the create menu, anchored at the given point. */
  onCreate: (x: number, y: number) => void;
  /** Open the settings menu for the grid on screen, anchored at a point. */
  onSettings: (x: number, y: number) => void;
  /** Open the filter menu, anchored at a point. */
  onFilter: (x: number, y: number) => void;
  /** Leave the open folder and show the grid whole again. */
  onBack: () => void;
}

/**
 * The toolbar the wall always shows: clip, search, filter, grid settings,
 * and the bell.
 *
 * It was two clusters pinned to opposite corners of the pane, with the grid
 * switcher and a pair of toggles for folding the rail and the details panel
 * away. All of that is gone. The rail is permanent and folds itself when the
 * pane is too narrow; the details panel is a drawer that arrives on a click
 * and leaves when the selection does; and a switcher that names the grid you
 * are on says what the rail says already, in a menu that covers the wall.
 *
 * What is left is four errands, the bell, and one rule: everything here is
 * about the wall itself, or, for the bell, about the library behind it. What
 * is about a selection lives in the bar beside this one, which arrives when
 * there is a selection to speak about. The two sit in one dock so they read
 * as one control that grows a second half, rather than as two bars that
 * happened to appear at once.
 */
export class SpaceBar {
  private root: HTMLElement;
  private manage: HTMLElement;
  private create: HTMLElement;
  private filter: HTMLElement;
  private filterCount: HTMLElement;
  private shownCount = -1;
  /**
   * The search: a button that grows into the field it opens, in its own
   * place in the bar, so the query stays in sight for as long as it is
   * narrowing the wall. Open is its own state rather than the phone bar's
   * `expanded`, since the bar folding away for a selection or a tap
   * elsewhere must not take a live search with it.
   */
  private search: HTMLElement;
  private searchInput: HTMLInputElement;
  private searchFound: HTMLElement;
  private searchScope: HTMLElement;
  private searchOpen = false;
  private querySettle: { call: () => void; cancel: () => void };
  private fitFrame = 0;
  /** Where a menu about grids opens from when nothing was clicked. */
  switcherAnchor: () => { x: number; y: number } = () => ({ x: 0, y: 0 });
  private back: HTMLElement;
  private grid: GridSpace | null = null;
  private folder: string | null = null;
  /**
   * The button the bar folds into on a phone, and whether it is open.
   *
   * Obsidian owns the foot of a phone screen, and this bar sitting just above
   * its navbar made two toolbars of the same shape and size stacked one on
   * the other. Folded, it is a single control in the corner; opened, it is
   * the same four buttons, grown out to the left of it.
   *
   * Last in the row on purpose: the button that was tapped stays exactly
   * where the thumb left it while the rest arrive beside it.
   */
  private more: HTMLElement | null = null;
  private moreGlyph: HTMLElement | null = null;
  private expanded = false;
  /** The bell's panel, and the call that stops the dot following the list. */
  private notifications: NotificationPanel | null = null;
  private stopNotifications: (() => void) | null = null;
  /** Puts the dot on the bell while the list has something unread. */
  private showDot: () => void = () => {};

  /** The element the dock lays out, for the bar beside it to move against. */
  get el(): HTMLElement {
    return this.root;
  }

  /**
   * @param notifications the session's list, and the pane its panel opens
   * over. The plugin owns the list; the bar only shows it.
   */
  constructor(
    container: HTMLElement,
    back: HTMLElement,
    handlers: SpaceBarHandlers,
    notifications?: { center: NotificationCenter; host: HTMLElement }
  ) {
    this.root = container.createDiv({ cls: "pg-spacebar" });

    const button = (name: string, tip: string, key: string, glyphs: string[]): HTMLElement => {
      const el = this.root.createEl("button", { cls: "pg-bar-button pg-space-" + name });
      const glyph = el.createSpan({ cls: "pg-bar-glyph" });
      setGlyph(glyph, ...glyphs);
      attachTip(el, tip, key);
      el.setAttribute("aria-label", tip);
      return el;
    };

    const divider = (): void => {
      this.root.createDiv({ cls: "pg-bar-divider" });
    };

    // Clipping and finding first: they are what you come to the bar to do.
    this.create = button("create", "Clip", "", ["plus"]);
    this.create.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      const rect = this.create.getBoundingClientRect();
      handlers.onCreate(rect.right, rect.top - LAUNCH_GAP);
    };

    this.search = this.root.createDiv({ cls: "pg-space-search" });
    const open = this.search.createEl("button", { cls: "pg-bar-button pg-space-search-button" });
    setGlyph(open.createSpan({ cls: "pg-bar-glyph" }), "search");
    attachTip(open, "Search", "");
    open.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      this.openSearch();
    };

    const input = this.search.createEl("input", { cls: "pg-space-search-input", type: "text" });
    input.placeholder = "Search the library";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("enterkeyhint", "search");
    this.searchInput = input;
    this.querySettle = settled(() => handlers.onQuery(input.value), QUERY_SETTLE_MS, window);
    input.oninput = () => {
      this.search.toggleClass("has-text", input.value.trim().length > 0);
      this.querySettle.call();
    };
    input.onkeydown = (event: KeyboardEvent) => {
      // Not while an input method is still composing: that Enter picks a
      // character, it does not ask for the search.
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      this.querySettle.cancel();
      handlers.onQuery(input.value);
      // The keyboard goes back to the wall, where the arrows and Space act
      // on the cards the query left.
      input.blur();
    };
    // An empty field folds away when you leave it. One with a query in it
    // stays, because it is still deciding what the wall shows.
    input.onblur = () => {
      if (!this.searchOpen || input.value.trim()) return;
      this.querySettle.cancel();
      handlers.onQuery("");
      this.closeSearch();
    };

    // What was found and where, which is also the way to look somewhere else.
    this.searchScope = this.search.createEl("button", { cls: "pg-space-search-scope" });
    this.searchFound = this.searchScope.createSpan({ cls: "pg-space-search-found" });
    attachTip(this.searchScope, "Search the whole library", "");
    this.searchScope.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      if (this.searchScope.hasClass("is-switch")) handlers.onSearchScope();
    };

    const clear = this.search.createEl("button", { cls: "pg-space-search-clear" });
    setIcon(clear.createSpan({ cls: "pg-space-search-clear-glyph" }), "x");
    attachTip(clear, "Clear search", "");
    clear.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      handlers.onEndSearch();
    };

    // Pressing a control inside the field would blur the input before the
    // click lands, and an empty field folds on blur: the button would be gone
    // from under the pointer before it was clicked.
    for (const inside of [open, this.searchScope, clear]) {
      inside.addEventListener("pointerdown", (event) => {
        if (this.searchOpen) event.preventDefault();
      });
    }

    // Then the two that change how the wall is shown rather than what is on
    // it, behind a rule that says as much.
    divider();

    this.filter = button("filter", "Filter", "", ["funnel", "list-filter", "filter"]);
    this.filterCount = this.filter.createDiv({ cls: "pg-space-count" });
    this.filter.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      const rect = this.filter.getBoundingClientRect();
      handlers.onFilter(rect.left, rect.top - LAUNCH_GAP);
    };

    this.manage = button("manage", "Grid settings", "", ["layout-grid"]);
    this.manage.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      // Left edge, so the flip in placeMenu leaves it opening rightward and
      // upward out of the button.
      const rect = this.manage.getBoundingClientRect();
      handlers.onSettings(rect.left, rect.top - LAUNCH_GAP);
    };

    // Last, after the errands: it is about the library behind the wall, and
    // nothing in it needs answering before anything else here does.
    if (notifications) {
      const { center, host } = notifications;
      const bell = button("notifications", "Notifications", "", ["bell"]);
      bell.createDiv({ cls: "pg-notif-dot" });
      const panel = new NotificationPanel(host, center);
      this.notifications = panel;
      bell.onclick = (event: MouseEvent) => {
        event.stopPropagation();
        if (panel.isOpen) {
          panel.close();
          return;
        }
        // Centred on the bar rather than on the bell: the panel is wider
        // than the bar, and one lined up with the bell's edge sits off to
        // one side of everything under it.
        const rect = this.root.getBoundingClientRect();
        panel.open(rect.left + rect.width / 2, rect.top);
      };
      // The phone's folded bar hides the bell, so its button wears the dot
      // too while there is something to see.
      const showDot = (): void => {
        bell.toggleClass("has-unread", center.unread);
        this.more?.toggleClass("has-unread", center.unread);
      };
      this.stopNotifications = center.onChange(showDot);
      this.showDot = showDot;
    }

    // The way out of a folder: the detail view's back button, in the same
    // corner, so leaving a folder feels like leaving a clipping. Passed in
    // rather than made here, because it belongs to the pane and not to the
    // dock the bar sits in.
    this.back = back;
    setIcon(this.back, "arrow-left");
    attachTip(this.back, "Back", "⎋");
    this.back.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      handlers.onBack();
    };

    if (Platform.isMobile) {
      this.more = this.root.createEl("button", { cls: "pg-bar-button pg-space-more" });
      this.moreGlyph = this.more.createSpan({ cls: "pg-bar-glyph" });
      setGlyph(this.moreGlyph, "more-horizontal");
      this.more.setAttribute("aria-label", "Wall controls");
      this.more.createDiv({ cls: "pg-notif-dot" });
      this.more.onclick = (event: MouseEvent) => {
        event.stopPropagation();
        this.setExpanded(!this.expanded);
      };
      this.root.addClass("is-collapsed");
    }
    this.showDot();

    // The grid menu now opens out of the settings button, the switcher that
    // used to own that job having gone.
    this.switcherAnchor = () => {
      const rect = this.manage.getBoundingClientRect();
      return { x: rect.right, y: rect.top - LAUNCH_GAP };
    };
  }

  /**
   * Stands the bar down while a selection is up.
   *
   * Only ever asked for on a phone. The two bars are 155 and 241 wide with a
   * gap between them, which is 402: more than a 390px phone has. One bar at a
   * time is also how Photos and Files put it, and it suits a mode that a long
   * press enters and a tap on empty space leaves.
   */
  setHidden(hidden: boolean): void {
    this.root.toggleClass("is-hidden", hidden);
    // Folded again while it is away, so it never comes back already open
    // from whatever was being done before the selection took the bottom.
    if (hidden) this.setExpanded(false, false);
  }

  /** Folds the phone's bar out of its button, or back into it. */
  private setExpanded(expanded: boolean, animate = true): void {
    if (!this.more || !this.moreGlyph || expanded === this.expanded) return;
    // A live search holds the bar open: the field is the bar while it is.
    if (!expanded && this.searchOpen) return;
    const before = this.root.getBoundingClientRect().width;
    this.expanded = expanded;
    this.root.toggleClass("is-collapsed", !expanded);
    setGlyph(this.moreGlyph, expanded ? "x" : "more-horizontal");
    if (!animate) return;
    const after = this.root.getBoundingClientRect().width;
    this.root.animate(
      [{ width: `${before}px` }, { width: `${after}px` }],
      { duration: 220, easing: "cubic-bezier(0.22, 0.9, 0.28, 1)" }
    );
  }

  /** Folds it away when a tap lands anywhere else. */
  collapse(): void {
    this.setExpanded(false);
  }

  /** Whether the bell's panel is open, for an Escape that would close it. */
  get panelOpen(): boolean {
    return this.notifications?.isOpen ?? false;
  }

  /** Whether the search field is open, with or without a query in it. */
  get isSearching(): boolean {
    return this.searchOpen;
  }

  /**
   * Folds a live search into its button while the dock cannot hold it and
   * the selection bar side by side, and opens it out again once it can.
   * Asked after the selection changes and when the pane is resized, which
   * are the two things that decide whether the pair fits.
   */
  fitDock(): void {
    // A frame later: the details panel takes its width off the wall on the
    // next frame, and the dock's room is measured against the wall after.
    if (this.fitFrame) window.cancelAnimationFrame(this.fitFrame);
    this.fitFrame = window.requestAnimationFrame(() => {
      this.fitFrame = 0;
      this.fitNow();
    });
  }

  private fitNow(): void {
    const dock = this.root.parentElement;
    this.root.removeClass("is-tight");
    if (!dock || !this.searchOpen) return;
    // Measured by where the last thing in each box ends rather than by
    // scrollWidth, which counts the tips too: they hang out past the bar's
    // edge, unseen until a button is pointed at.
    const spills = (box: HTMLElement): boolean => {
      const edge = box.getBoundingClientRect().right + 0.5;
      return Array.from(box.children).some(
        (child) =>
          child.instanceOf(HTMLElement) &&
          child.offsetParent !== null &&
          child.getBoundingClientRect().right > edge
      );
    };
    if (spills(this.root) || spills(dock)) this.root.addClass("is-tight");
  }

  /** Grows the field out of its button and puts the cursor in it. */
  openSearch(): void {
    // Asked for by hand, so shown even where it does not fit beside the
    // selection bar: typing is about to clear the selection anyway.
    this.root.removeClass("is-tight");
    if (!this.searchOpen) {
      const before = this.search.getBoundingClientRect().width;
      this.searchOpen = true;
      this.search.addClass("is-open");
      this.root.addClass("is-searching");
      this.morph(before, this.search.getBoundingClientRect().width);
    }
    this.searchInput.focus();
  }

  /**
   * Folds the field back into its button, emptied. Called once the view has
   * let go of the search, or never had one, so nothing here asks it to.
   */
  closeSearch(): void {
    if (!this.searchOpen) return;
    this.querySettle.cancel();
    const before = this.search.getBoundingClientRect().width;
    this.searchOpen = false;
    this.searchInput.value = "";
    this.search.removeClass("is-open", "has-text", "has-result");
    this.root.removeClass("is-searching", "is-tight");
    if (this.searchInput.doc.activeElement === this.searchInput) this.searchInput.blur();
    this.morph(before, this.search.getBoundingClientRect().width);
    // The phone's bar folds back into its button, as it does after any
    // other errand run from it.
    this.setExpanded(false);
  }

  /** The field itself, for the view to tell a keystroke meant for it. */
  get searchField(): HTMLElement {
    return this.searchInput;
  }

  /**
   * What the search found and where it looked, or null while it has found
   * nothing to count. `switchTo` names the other place the count would
   * search if pressed, and is null when there is nowhere else to go: then
   * the count is only words.
   */
  setSearchResult(result: { count: number; place: string; switchTo: string | null } | null): void {
    this.search.toggleClass("has-result", result !== null);
    if (!result) return;
    this.searchFound.setText(`${result.count} in ${result.place}`);
    this.searchScope.toggleClass("is-switch", result.switchTo !== null);
    if (result.switchTo) retip(this.searchScope, result.switchTo, "");
  }

  /**
   * Eases the field from one width to another. The field clips while it
   * moves, so what is inside is revealed rather than squashed, and it does
   * not move at all for someone who has asked the system for less motion.
   */
  private morph(before: number, after: number): void {
    const win = this.root.doc.defaultView;
    if (!win || Math.abs(before - after) < 1) return;
    if (win.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    this.search.addClass("is-morphing");
    const motion = this.search.animate(
      [{ width: `${before}px` }, { width: `${after}px` }],
      { duration: MORPH_MS, easing: MORPH_EASING }
    );
    const done = (): void => this.search.removeClass("is-morphing");
    motion.onfinish = done;
    motion.oncancel = done;
  }

  setActive(grid: GridSpace): void {
    this.grid = grid;
  }

  /** The folder open on the wall, or null for the grid whole. */
  setFolder(name: string | null): void {
    this.folder = name;
    this.back.toggleClass("is-open", name !== null);
    this.root.toggleClass("is-in-folder", name !== null);
  }

  /** What the wall is showing, for a menu that wants to name it. */
  get active(): { grid: GridSpace | null; folder: string | null } {
    return { grid: this.grid, folder: this.folder };
  }

  /**
   * A filter hides things, so it has to say so from the outside. Without a
   * count on the button, a filtered wall is indistinguishable from an empty
   * grid, and the only clue is a menu you have to open to read.
   */
  setFilterCount(count: number): void {
    // Guarded: this runs on every repaint, including each one the archiver
    // triggers, and almost none of them change the number.
    if (count === this.shownCount) return;
    this.shownCount = count;
    this.filterCount.setText(count > 0 ? String(count) : "");
    this.filter.toggleClass("is-active", count > 0);
  }

  destroy(): void {
    this.querySettle.cancel();
    if (this.fitFrame) window.cancelAnimationFrame(this.fitFrame);
    this.stopNotifications?.();
    this.notifications?.close(true);
    this.root.remove();
  }
}
