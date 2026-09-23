import { setIcon } from "obsidian";
import { facetLabel } from "./core/filter";
import { isHttpUrl } from "./core/resolve";
import { NOTE_KEY, SUMMARY_KEY } from "./core/scan";
import { attachTip } from "./core/tip";
import type { TileModel } from "./core/tile";

/**
 * The rows that describe one clipping: its title, where it came from, its
 * properties as chips, the model's summary, and the reader's own note.
 *
 * Lifted out of the detail view because the inspector wants the same rows in
 * the same order with the same writes behind them. Two panels drawing the
 * same facts from two bodies of code is how they drift apart, and the one
 * that drifts is always the one nobody happens to be looking at.
 *
 * Draws into a host and does nothing else: where the panel sits, how wide it
 * is and whether it animates in are the caller's business. The class names
 * stay `pg-detail-*` so both hosts inherit one stylesheet rather than two
 * that have to be kept in step.
 */

/**
 * Frontmatter keys the panel already reports in its own words, so enabling one
 * as a filter property does not print it twice. Filename and Resolution are
 * read off the media rather than the note, so no key can collide with them.
 */
export const INTRINSIC = new Set(["title", "source", "created"]);

/** What the reader is invited to write when the note is empty. */
export const NOTE_PROMPT = "Why did you save this…";

export interface MetaWrites {
  /**
   * Opens one property's value picker, anchored at the chip that asked.
   *
   * The write itself stays behind this: the licence to touch a note the
   * plugin did not create lives in one place in the view, and this only
   * moves where the request is made from.
   */
  onEditProperty: (id: string, key: string, x: number, y: number) => void;
  /**
   * Writes one prose property whole. A picker lists values to choose among;
   * a note is written, not chosen, so it needs its own way through the same
   * gate. An empty value clears the key.
   */
  onEditText: (id: string, key: string, value: string) => void;
}

export interface MetaSource {
  /** The card's own list of properties (Settings → Properties → Card). */
  properties: () => string[];
  /** Whether this plugin may write that key on this note. */
  editable: (key: string) => boolean;
}

/** A label and a value, or nothing at all when there is no value. */
function field(host: HTMLElement, label: string, value: string): void {
  if (!value) return;
  const block = host.createDiv({ cls: "pg-detail-field" });
  block.createDiv({ cls: "pg-detail-label", text: label });
  block.createDiv({ cls: "pg-detail-value", text: value });
}

/**
 * A property's values as chips, one per value, wrapping.
 *
 * They were one joined string in one button, which the panel's edge clipped
 * at the third of five categories with the rest unreachable. A chip is its
 * own target: clicking one opens the property's picker at that chip, where
 * the value can be unticked or another added, and the trailing + opens the
 * same picker with nothing pointed at.
 *
 * A read-only property gets the same chips as plain spans; with no values it
 * gets no row, as the fields above do, while an editable one keeps an Add
 * chip, since a property with nothing in it is exactly the one worth
 * clicking.
 */
export function chipsField(
  host: HTMLElement,
  id: string,
  key: string,
  label: string,
  values: string[],
  editable: boolean,
  writes: MetaWrites
): void {
  if (!editable && values.length === 0) return;
  const block = host.createDiv({
    cls: editable ? "pg-detail-field is-editable" : "pg-detail-field",
  });
  block.createDiv({ cls: "pg-detail-label", text: label });
  const chips = block.createDiv({ cls: "pg-detail-chips" });

  const pick = (anchor: HTMLElement): void => {
    const rect = anchor.getBoundingClientRect();
    writes.onEditProperty(id, key, rect.left, rect.bottom + 4);
  };

  for (const value of values) {
    if (!editable) {
      chips.createSpan({ cls: "pg-detail-chip", text: value });
      continue;
    }
    const chip = chips.createEl("button", { cls: "pg-detail-chip", text: value });
    chip.onclick = () => pick(chip);
  }
  if (!editable) return;

  const add = chips.createEl("button", {
    cls: values.length ? "pg-detail-chip is-add" : "pg-detail-chip is-empty",
    text: values.length ? "+" : "Add…",
  });
  if (values.length) attachTip(add, `Add ${label.toLowerCase()}`);
  add.onclick = () => pick(add);
}

/**
 * The whole address, as a link out to the page, with a button that copies it.
 *
 * It was shown as the domain with the URL on hover, and the hover is not
 * there on a phone; the value wraps anywhere, so a long one costs lines
 * rather than being clipped. The button is for not having to select it by
 * hand: a URL that wraps over three lines is a poor drag target.
 */
export function sourceField(host: HTMLElement, source: string): void {
  if (!isHttpUrl(source)) {
    field(host, "Source", source);
    return;
  }

  const block = host.createDiv({ cls: "pg-detail-field" });
  block.createDiv({ cls: "pg-detail-label", text: "Source" });
  const value = block.createDiv({ cls: "pg-detail-value" });
  value.createEl("a", { cls: "pg-detail-link", text: source, href: source });

  const copy = value.createEl("button", { cls: "pg-detail-copy" });
  // The glyph lives in a holder of its own. setIcon appends rather than
  // replaces, and the button also carries its tip and its hidden name, so
  // neither emptying the button nor calling setIcon twice on it works: the
  // first destroys the label, the second leaves both glyphs stacked.
  const glyph = copy.createSpan({ cls: "pg-detail-copy-glyph" });
  setIcon(glyph, "copy");
  attachTip(copy, "Copy link");

  let restore = 0;
  const showGlyph = (icon: string): void => {
    glyph.empty();
    setIcon(glyph, icon);
  };

  copy.onclick = (event) => {
    event.preventDefault();
    void navigator.clipboard
      .writeText(source)
      .then(() => {
        // Only on success: a tick over an empty clipboard is a lie, and the
        // write can be refused outright on a page without focus.
        showGlyph("check");
        copy.addClass("is-copied");
        window.clearTimeout(restore);
        restore = window.setTimeout(() => {
          // The panel is rebuilt on every step through the wall and the reel,
          // so by now this button may belong to no document at all.
          if (!copy.isConnected) return;
          showGlyph("copy");
          copy.removeClass("is-copied");
        }, 1200);
      })
      .catch(() => {
        showGlyph("x");
        window.clearTimeout(restore);
        restore = window.setTimeout(() => {
          if (copy.isConnected) showGlyph("copy");
        }, 1200);
      });
  };
}

/**
 * A prose property edited in place, as a textarea rather than a picker.
 *
 * Saves on blur and on ⌘↩; Escape puts the old text back. Both paths go
 * through onEditText, which the view routes into the same setProperty a click
 * on a value goes through, so the licence to write stays in one place.
 */
export function noteField(
  host: HTMLElement,
  model: TileModel,
  source: MetaSource,
  writes: MetaWrites
): void {
  if (!source.editable(NOTE_KEY)) return;
  const held = (model.record.properties[NOTE_KEY] ?? []).join(" ");

  const block = host.createDiv({ cls: "pg-detail-field is-editable is-note" });
  block.createDiv({ cls: "pg-detail-label", text: "Note" });

  const show = block.createEl("button", {
    cls: "pg-detail-value pg-detail-edit",
    text: held || NOTE_PROMPT,
  });
  if (!held) show.addClass("is-empty");

  show.onclick = () => {
    const area = block.createEl("textarea", { cls: "pg-detail-note" });
    area.value = held;
    area.rows = Math.min(8, Math.max(2, held.split("\n").length + 1));
    show.hide();
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);

    let settled = false;
    const finish = (save: boolean): void => {
      if (settled) return;
      settled = true;
      const next = area.value.trim();
      area.remove();
      show.show();
      if (!save || next === held) return;
      show.textContent = next || NOTE_PROMPT;
      show.toggleClass("is-empty", !next);
      writes.onEditText(model.id, NOTE_KEY, next);
    };

    area.onblur = () => finish(true);
    area.onkeydown = (event) => {
      // The host's own key handler takes Escape to close and the arrows to
      // move. While typing, none of that may fire.
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        finish(true);
      }
    };
  };
}

/**
 * Every row that describes one clipping, in the order both panels show them.
 *
 * Title, then where it came from, then whatever properties the card is set to
 * report, then the model's summary, then the reader's own line — which is
 * offered whether or not it is filled in, because why this was saved is the
 * one thing no clipper and no model can write, and the empty row is the
 * invitation.
 */
export function paintCardMeta(
  host: HTMLElement,
  model: TileModel,
  source: MetaSource,
  writes: MetaWrites
): void {
  field(host, "Title", model.record.title);
  sourceField(host, model.record.source);

  for (const key of source.properties()) {
    if (INTRINSIC.has(key) || key === NOTE_KEY || key === SUMMARY_KEY) continue;
    chipsField(
      host,
      model.id,
      key,
      facetLabel(key),
      model.record.properties[key] ?? [],
      source.editable(key),
      writes
    );
  }

  // The model's summary, read-only here: it is regenerated, not edited, and a
  // hand-edited summary would be overwritten by the next run anyway.
  field(host, "Summary", (model.record.properties[SUMMARY_KEY] ?? []).join(" "));

  noteField(host, model, source, writes);
}
