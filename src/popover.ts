import { setIcon } from "obsidian";
import { GRID_ICONS, ICON_GROUPS, iconsMatching } from "./core/icon-choices";

/**
 * A small panel beside the row it was opened from, for the two things a
 * context menu cannot hold: a grid of icons to pick from, and a line of
 * text to write. It stays next to what it changes rather than in the middle
 * of the window, and goes on Escape, on a click anywhere else, or once it
 * has done its job.
 */

interface Popover {
  root: HTMLElement;
  close: () => void;
}

/** Room kept between the panel and the edges of the window. */
const MARGIN = 8;

function openPopover(doc: Document, anchor: DOMRect, cls: string, onEscape?: () => void): Popover {
  const root = doc.body.createDiv({ cls: `pg-popover ${cls}` });
  let closed = false;

  const onPointer = (event: PointerEvent): void => {
    if (!root.contains(event.target as Node)) close();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onEscape?.();
    close();
  };
  const close = (): void => {
    if (closed) return;
    closed = true;
    doc.removeEventListener("pointerdown", onPointer, true);
    doc.removeEventListener("keydown", onKey, true);
    root.remove();
  };
  doc.addEventListener("pointerdown", onPointer, true);
  doc.addEventListener("keydown", onKey, true);

  // Beside the row, to its right, and held inside the window: a rail row near
  // the bottom opens the panel upwards rather than off the screen.
  const place = (): void => {
    const win = doc.defaultView;
    const width = root.offsetWidth;
    const height = root.offsetHeight;
    const maxX = (win?.innerWidth ?? 0) - width - MARGIN;
    const maxY = (win?.innerHeight ?? 0) - height - MARGIN;
    root.style.left = `${Math.max(MARGIN, Math.min(anchor.right + MARGIN, maxX))}px`;
    root.style.top = `${Math.max(MARGIN, Math.min(anchor.top, maxY))}px`;
  };
  doc.defaultView?.requestAnimationFrame(place);

  return { root, close };
}

/**
 * Icons to pick from, the same list the grid editor offers, with a field
 * that narrows it by name. The current icon is marked, and one the list does
 * not have is offered first under Current, so it can be kept.
 */
export function openIconPopover(
  doc: Document,
  anchor: DOMRect,
  current: string,
  onPick: (icon: string) => void
): void {
  const { root, close } = openPopover(doc, anchor, "pg-icon-popover");
  const input = root.createEl("input", { type: "search", placeholder: "Search icons…" });
  const grid = root.createDiv({ cls: "pg-popover-icons" });

  const paint = (): void => {
    grid.empty();
    const query = input.value.trim();
    const matching = new Set(iconsMatching(query));
    const groups: Array<{ title: string; icons: readonly string[] }> = [];
    if (current && !GRID_ICONS.includes(current)) groups.push({ title: "Current", icons: [current] });
    groups.push(...ICON_GROUPS);
    for (const group of groups) {
      const icons = query ? group.icons.filter((name) => matching.has(name)) : group.icons;
      if (icons.length === 0) continue;
      if (!query) grid.createDiv({ cls: "pg-popover-caption", text: group.title });
      for (const name of icons) {
        const button = grid.createEl("button", { cls: "pg-popover-icon" });
        if (name === current) button.addClass("is-on");
        button.setAttribute("aria-label", name.replace(/-/g, " "));
        setIcon(button, name);
        button.onclick = () => {
          close();
          onPick(name);
        };
      }
    }
    if (grid.childElementCount === 0) grid.createDiv({ cls: "pg-popover-empty", text: "No icon by that name" });
  };

  input.oninput = paint;
  input.onkeydown = (event: KeyboardEvent) => {
    // Enter takes the first match, which is what typing a name and pressing
    // Enter means.
    if (event.key !== "Enter") return;
    const first = grid.querySelector<HTMLButtonElement>(".pg-popover-icon");
    first?.click();
  };
  paint();
  input.focus();
}

/**
 * One line of text to write, saved on Enter or on leaving the field, and
 * dropped on Escape. For a grid's description.
 */
export function openTextPopover(
  doc: Document,
  anchor: DOMRect,
  options: { value: string; placeholder: string; maxLength: number; onSave: (value: string) => void }
): void {
  // Escape leaves the text as it was: marked done before the field is
  // removed, since removing it is a blur and a blur saves.
  let done = false;
  const { root, close } = openPopover(doc, anchor, "pg-text-popover", () => {
    done = true;
  });
  const input = root.createEl("input", { type: "text", placeholder: options.placeholder });
  input.value = options.value;
  input.maxLength = options.maxLength;
  const save = (): void => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    close();
    if (value !== options.value.trim()) options.onSave(value);
  };
  input.onkeydown = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    save();
  };
  input.onblur = save;
  input.focus();
  input.select();
}
