/**
 * The orders a wall can be in.
 *
 * Newest is the default and the obvious one: a library of references is read
 * from the top. Shuffle is for coming across something forgotten. This adds
 * the third, which answers a different question — not "what did I save" but
 * "what have I been working with": a card gains a tag, a summary, a note, and
 * that is the card worth having in front of you.
 *
 * The date is already there. Every write the plugin makes stamps `updated`,
 * because the vault's own clipping rules list it among the properties tools
 * maintain, so this is a new way of reading what is recorded rather than a
 * new thing to record.
 *
 * Pure: index-store.ts holds the by-date and shuffled orders beside this one.
 */

import type { ClippingRecord } from "./scan";

/** How the wall is sorted. Not persisted: see the note on `view.order`. */
export type WallOrder = "newest" | "updated" | "shuffled";

/** The property every write stamps, and what this order reads. */
const UPDATED_KEY = "updated";

function updatedOf(record: ClippingRecord): string {
  return (record.properties[UPDATED_KEY] ?? [])[0]?.trim() ?? "";
}

/**
 * Most recently touched first.
 *
 * A card with no `updated` at all goes to the end rather than the start: one
 * that nothing has ever written to is not a card that was just worked on, and
 * an empty string sorting above real dates would put the whole untouched
 * library in front of the three notes actually being used.
 *
 * Falls back to `created` and then to the title, so the order is total: a
 * wall that reshuffles itself between repaints because two cards tie is a
 * wall that cannot be read.
 */
export function byUpdated(records: readonly ClippingRecord[]): ClippingRecord[] {
  return [...records].sort((a, b) => {
    const left = updatedOf(a);
    const right = updatedOf(b);
    if (left !== right) {
      if (!left) return 1;
      if (!right) return -1;
      return left < right ? 1 : -1;
    }
    if (a.created !== b.created) {
      if (!a.created) return 1;
      if (!b.created) return -1;
      return a.created < b.created ? 1 : -1;
    }
    return a.title.localeCompare(b.title);
  });
}
