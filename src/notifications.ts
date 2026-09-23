import {
  addNotification,
  hasUnread,
  markAllRead,
  removeNotification,
} from "./core/notifications";
import type { GokoNotification, NotificationDraft } from "./core/notifications";
import { bottomInset } from "./core/insets";
import { placeAbove } from "./core/layout";

/** What each action on a notification runs, by action id. */
export type NotificationHandlers = Record<string, () => void>;

/**
 * The session's notifications, and what answering each one does.
 *
 * Owned by the plugin rather than by a wall, so something found while no
 * wall is open is still there when one opens, and every open wall's bell
 * shows the same dot. See core/notifications.ts for the rules the list
 * keeps.
 */
export class NotificationCenter {
  private list: readonly GokoNotification[] = [];
  private handlers = new Map<string, NotificationHandlers>();
  private listeners = new Set<() => void>();

  get items(): readonly GokoNotification[] {
    return this.list;
  }

  get unread(): boolean {
    return hasUnread(this.list);
  }

  /** Listens for changes; the returned function stops listening. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Posts a notification, or tells one already posted under its id again.
   * An action with no handler here only takes the notification away, which
   * is all a "dismiss" has to do.
   */
  post(draft: NotificationDraft, handlers: NotificationHandlers = {}): void {
    this.handlers.set(draft.id, handlers);
    this.set(addNotification(this.list, draft));
  }

  /** Answers a notification: runs the action, and takes it off the list. */
  answer(id: string, action: string): void {
    const run = this.handlers.get(id)?.[action];
    this.handlers.delete(id);
    this.set(removeNotification(this.list, id));
    run?.();
  }

  markAllRead(): void {
    this.set(markAllRead(this.list));
  }

  private set(next: readonly GokoNotification[]): void {
    if (next === this.list) return;
    this.list = next;
    for (const listener of this.listeners) listener();
  }
}

/** Space left between the bell and the panel it opens. */
const LAUNCH_GAP = 10;
/** A tap that arrives this soon after opening is the one that opened it. */
const SETTLE_MS = 350;
/** Long enough for the leave transition in styles.css to finish. */
const EXIT_MS = 120;

/**
 * The panel the bell opens: every notification, newest first, each with its
 * actions as buttons.
 *
 * Not an Obsidian Menu, which is rows of one label each and closes on the
 * first click; a notification is a title, a sentence and a choice. Built the
 * way the wall's own menus are instead — a backdrop that closes it, a panel
 * kept on screen by placeAbove, Escape to leave — so it looks and behaves
 * like the rest of the plugin's surfaces.
 */
export class NotificationPanel {
  private backdrop: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private anchor: { x: number; y: number } = { x: 0, y: 0 };
  private stopListening: (() => void) | null = null;
  private onKey: ((event: KeyboardEvent) => void) | null = null;

  constructor(
    private container: HTMLElement,
    private center: NotificationCenter
  ) {}

  get isOpen(): boolean {
    return this.panel !== null;
  }

  /**
   * Opens centred above the point given, which is the middle of the bar's
   * top edge. Opening is reading: the dot goes as the list appears.
   */
  open(x: number, y: number): void {
    this.close(true);
    this.anchor = { x, y: y - LAUNCH_GAP };
    this.backdrop = this.container.createDiv({ cls: "pg-notif-backdrop" });
    this.panel = this.container.createDiv({ cls: "pg-notif-panel" });
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-label", "Notifications");

    const openedAt = performance.now();
    this.backdrop.onclick = () => {
      if (performance.now() - openedAt >= SETTLE_MS) this.close();
    };
    this.onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    };
    this.container.doc.addEventListener("keydown", this.onKey, true);

    // A notification posted while the panel is up appears in it, and one
    // answered from it leaves; the panel goes when the last one does.
    this.stopListening = this.center.onChange(() => {
      if (this.center.items.length === 0) this.close();
      else this.paint();
    });
    this.paint();
    this.center.markAllRead();

    // Next frame, so the entry transition has a state to move from.
    window.requestAnimationFrame(() => {
      this.backdrop?.addClass("is-open");
      this.panel?.addClass("is-open");
    });
  }

  close(immediate = false): void {
    if (this.onKey) this.container.doc.removeEventListener("keydown", this.onKey, true);
    this.onKey = null;
    this.stopListening?.();
    this.stopListening = null;
    const going = [this.backdrop, this.panel].filter((node): node is HTMLElement => node !== null);
    this.backdrop = null;
    this.panel = null;
    if (immediate) {
      for (const node of going) node.remove();
      return;
    }
    for (const node of going) node.removeClass("is-open");
    window.setTimeout(() => {
      for (const node of going) node.remove();
    }, EXIT_MS);
  }

  private paint(): void {
    const panel = this.panel;
    if (!panel) return;
    panel.empty();
    panel.createDiv({ cls: "pg-notif-heading", text: "Notifications" });

    const items = this.center.items;
    if (items.length === 0) {
      panel.createDiv({ cls: "pg-notif-empty", text: "No notifications" });
    }
    for (const item of items) {
      const row = panel.createDiv({ cls: "pg-notif-item" });
      row.createDiv({ cls: "pg-notif-title", text: item.title });
      row.createDiv({ cls: "pg-notif-body", text: item.body });
      const actions = row.createDiv({ cls: "pg-notif-actions" });
      // The main answer at the right end, where the plugin's dialogs put
      // theirs, whatever order the notification lists them in.
      const ordered = [...item.actions.filter((a) => !a.primary), ...item.actions.filter((a) => a.primary)];
      for (const action of ordered) {
        const button = actions.createEl("button", {
          cls: action.primary ? "pg-notif-action mod-cta" : "pg-notif-action",
          text: action.label,
        });
        button.onclick = (event: MouseEvent) => {
          event.stopPropagation();
          this.center.answer(item.id, action.id);
        };
      }
    }
    this.place();
  }

  /** Centred over the bar and above it, and never off the pane. */
  private place(): void {
    const panel = this.panel;
    if (!panel) return;
    const bounds = this.container.getBoundingClientRect();
    // Untransformed size: the panel arrives scaled down for its entry, and
    // a transformed measurement would place it a few pixels short.
    const size = { width: panel.offsetWidth, height: panel.offsetHeight };
    const at = placeAbove(
      { x: this.anchor.x - bounds.left, y: this.anchor.y - bounds.top },
      size,
      { width: bounds.width, height: bounds.height - bottomInset(this.container) }
    );
    panel.setCssStyles({
      left: `${at.x}px`,
      top: `${at.y}px`,
      // Grows out of the bar, wherever the panel had to go to fit.
      transformOrigin: `${this.anchor.x - bounds.left - at.x}px ${this.anchor.y - bounds.top - at.y}px`,
    });
  }
}
