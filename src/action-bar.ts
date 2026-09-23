import { setGlyph } from "./glyph";
import { attachTip, retip } from "./core/tip";

/** Which kind of thing the bar is acting on. A selection is one or the other. */
export type SelectionKind = "folders" | "clippings";

export interface ActionBarHandlers {
  /** Opens the property menu for the selection, anchored to the button. */
  onProperties: (x: number, y: number) => void;
  /** Deletes clippings, or asks what removing a folder should take with it. */
  onDelete: () => void;
  /** Opens the list of grids to move the selection to, anchored to the button. */
  onMoveToGrid: (x: number, y: number) => void;
  /** Opens the list of folders to move the selection into, anchored to the button. */
  onMoveToFolder: (x: number, y: number) => void;
  /** Leaves selection mode with nothing selected. */
  onDone: () => void;
  /** Sends the selection to the vision model for a summary and tags. */
  onDescribe: () => void;
  /** Files each selected card where its suggestion says, all at once. */
  onFileSuggested: () => void;
}

function anchorOf(button: HTMLElement): { x: number; y: number } {
  const rect = button.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top };
}

/** The dock's one easing, shared by the push and the rise so they read as
    one movement rather than two that happen to overlap. */
const DOCK_EASE = "cubic-bezier(0.22, 0.9, 0.28, 1)";

/**
 * The selection half of the dock: the bar that rises beside the space bar
 * while something is picked, and slides away again when nothing is.
 *
 * Deliberately small. It holds the actions that apply to a selection and
 * nothing else, so that the dock reads as one surface with two jobs rather
 * than as two surfaces competing with the wall.
 */
export class ActionBar {
  private root: HTMLElement;
  private count: HTMLElement;
  private properties: HTMLElement;
  private folder: HTMLElement;
  private describe: HTMLElement;
  private suggest: HTMLElement;
  private trash: HTMLElement;
  private folderable = false;
  private suggestible = false;
  private suppressed = false;
  private held: string[] = [];
  private kind: SelectionKind = "clippings";
  private shown = false;
  /**
   * The bar this one appears beside.
   *
   * The dock centres the pair, so this arriving pushes the other one left.
   * That push is the whole gesture — two halves of one control rather than a
   * bar that materialises over the wall — and it has to be animated from
   * where the other bar actually was, which only this knows the moment for.
   */
  private partner: HTMLElement | null = null;

  setPartner(partner: HTMLElement): void {
    this.partner = partner;
  }

  constructor(container: HTMLElement, handlers: ActionBarHandlers) {
    this.root = container.createDiv({ cls: "pg-actionbar" });

    /*
     * A visible way out, ahead of the count.
     *
     * Tapping empty space clears the selection too, and on desktop that is
     * the whole story. On a phone it cannot be: a densely packed wall may
     * have no empty space within reach of a thumb, and while a selection is
     * up this bar has taken the bottom from the wall's own controls, so
     * being unable to leave would strand them.
     */
    this.button("x", "Done", "esc", handlers.onDone);

    // The count and the rules either side of it, as one piece: a phone has no
    // room for it beside seven actions at Obsidian's own touch size, and two
    // rules with nothing between them would be what hiding it alone left.
    const head = this.root.createDiv({ cls: "pg-actionbar-head" });
    head.createDiv({ cls: "pg-bar-divider" });
    this.count = head.createDiv({ cls: "pg-actionbar-count" });
    head.createDiv({ cls: "pg-bar-divider" });

    // Same icon, label and key as the detail view's, since it is the same
    // menu: what one clipping is, asked of several at once.
    this.properties = this.button("sliders-horizontal", "Properties", "P", () => {
      const { x, y } = this.propertiesAnchor();
      handlers.onProperties(x, y);
    });

    // Where the selection lives, beside what it is. Anchored to their own
    // buttons, as the property menu is, so the list rises out of the bar.
    const grid = this.button("corner-up-right", "Move to grid", "", () => {
      const { x, y } = anchorOf(grid);
      handlers.onMoveToGrid(x, y);
    });
    this.folder = this.button("folder", "Move to folder", "", () => {
      const { x, y } = anchorOf(this.folder);
      handlers.onMoveToFolder(x, y);
    });

    // What the selection is about, asked of a model. Beside Properties, since
    // that is what it writes into; before Delete, since the bar reads left to
    // right from doing to undoing.
    this.describe = this.button("sparkles", "Describe with AI", "", handlers.onDescribe);

    // Every selected card to its own suggested place, in one press: the one
    // filing gesture the rail cannot make, since a drag has one destination.
    this.suggest = this.button("list-checks", "File as suggested", "\u21b5", handlers.onFileSuggested);

    this.root.createDiv({ cls: "pg-bar-divider" });

    this.trash = this.button("trash-2", "Delete", "⌫", handlers.onDelete);
  }

  /** Folders live on grids that can be filed into; elsewhere the button goes. */
  setFolderable(folderable: boolean): void {
    this.folderable = folderable;
    this.applyKind();
  }

  /**
   * Shows the buttons that fit what is picked.
   *
   * A folder has no properties to edit and does not go inside another
   * folder, so those two leave rather than sit there inert: the bar is only
   * as wide as what it can do, and a dead control is worse than a missing one. Where it goes and
   * whether it stays are the two questions a folder does answer, and they
   * are the two that remain.
   */
  private applyKind(): void {
    const clippings = this.kind === "clippings";
    this.properties.toggle(clippings);
    this.folder.toggle(clippings && this.folderable);
    // A folder has nothing for the model to look at and no suggestion of its
    // own, so those two go with the properties.
    this.describe.toggle(clippings);
    this.suggest.toggle(clippings && this.suggestible);
    // Removing a folder takes nothing away on its own, so the button says
    // so; what it does to the clippings inside is the question it asks.
    retip(this.trash, clippings ? "Delete" : "Remove", "⌫");
  }

  /** Shown only while something selected has a suggestion to follow. */
  setSuggestible(count: number): void {
    this.suggestible = count > 0;
    this.applyKind();
  }

  /** Where the property menu opens from, whether by click or by key. */
  propertiesAnchor(): { x: number; y: number } {
    return anchorOf(this.properties);
  }

  private button(
    icon: string,
    label: string,
    shortcut: string,
    onClick: () => void
  ): HTMLElement {
    const button = this.root.createEl("button", { cls: "pg-bar-button pg-actionbar-button" });
    setGlyph(button.createSpan({ cls: "pg-bar-glyph" }), icon);
    attachTip(button, label, shortcut);
    button.setAttribute("aria-label", label);

    button.onclick = (event: MouseEvent) => {
      event.stopPropagation();
      onClick();
    };
    return button;
  }

  setSelection(ids: string[], kind: SelectionKind = "clippings"): void {
    const n = ids.length;
    this.held = ids;
    this.kind = kind;
    this.applyKind();
    // Folders say so, because the bar is otherwise identical to the one a
    // handful of clippings raises and the actions are not.
    this.count.setText(
      kind === "folders"
        ? `${n} ${n === 1 ? "folder" : "folders"} selected`
        : n === 1
          ? "1 selected"
          : `${n} selected`
    );
    this.paintVisible();
  }

  /**
   * Stands the bar down while another mode owns the bottom of the wall.
   *
   * On a phone the details panel takes the bottom of the screen, so the bar
   * stands down the moment a single card is picked and comes back as soon as
   * the selection is anything else. See view.ts, which is the one caller.
   */
  setSuppressed(suppressed: boolean): void {
    this.suppressed = suppressed;
    this.paintVisible();
  }

  /**
   * Brings the bar in, and moves its partner over to make room.
   *
   * The pair is centred, so the arrival is a width change in the dock, which
   * no transition can follow on its own. So the partner is measured either
   * side of the change and carried across by a transform, while this one
   * rises from below. Leaving does the same in reverse, with this bar taken
   * out of the flow first so the partner starts moving back immediately
   * rather than waiting for the fade to finish.
   */
  private paintVisible(): void {
    const next = this.held.length > 0 && !this.suppressed;
    if (next === this.shown) return;
    this.shown = next;

    const before = this.partner?.getBoundingClientRect().left ?? 0;
    this.root.toggleClass("is-leaving", !next);
    this.root.toggleClass("is-visible", next);
    const after = this.partner?.getBoundingClientRect().left ?? 0;

    if (this.partner && before !== after) {
      this.partner.animate(
        [{ transform: `translateX(${before - after}px)` }, { transform: "none" }],
        { duration: next ? 280 : 200, easing: DOCK_EASE }
      );
    }

    if (next) {
      this.root.animate(
        [{ transform: "translateY(14px)", opacity: 0 }, { transform: "none", opacity: 1 }],
        { duration: 280, easing: DOCK_EASE }
      );
      return;
    }

    // Already out of the flow; it fades down where it stood and is then put
    // away, unless a selection arrived again in the meantime.
    const leaving = this.root.animate(
      [{ transform: "none", opacity: 1 }, { transform: "translateY(14px)", opacity: 0 }],
      { duration: 200, easing: DOCK_EASE }
    );
    void leaving.finished
      .then(() => {
        if (!this.shown) this.root.removeClass("is-leaving");
      })
      .catch(() => undefined);
  }

  destroy(): void {
    this.root.remove();
  }
}
