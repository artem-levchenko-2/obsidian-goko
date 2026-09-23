/**
 * What a tile shows about its clipping on hover, as a handful of small
 * pills. Pure: grid.ts renders what this returns.
 *
 * One slot, chosen in Settings → Goko → Wall: a property, a pill per
 * value with the overflow folded into a count. One property, not a list of
 * them — a tile has room for a glance, and a row of mixed properties reads as
 * noise at that size.
 *
 * There was a second slot, a date in the top-right corner. The corner holds
 * the media count now, and a date that had to give way to it on exactly the
 * cards worth sweeping was a slot that reported on the quiet ones only.
 * Nothing else read the `corner` field once it went, so the field went too.
 */

import { domainOf } from "./scan";
import type { ClippingRecord } from "./scan";

export interface TileBadge {
  /** The badge as one line, for anything that wants it read out whole. */
  text: string;
  /** The values one by one, for a pill each. */
  values: string[];
}

/** How many pills a tile shows before folding the rest into a "+N". */
export const MAX_TILE_PILLS = 3;

/**
 * Which values get a pill and how many are folded away. Three pills and a
 * count read at a glance where five whole tags did not. The bar this
 * replaced ran every value together and ticked sideways when it was too
 * long, and a bar that moves under the pointer is a thing to watch rather
 * than a thing to read.
 */
export function tilePills(values: readonly string[], max = MAX_TILE_PILLS): { shown: string[]; more: number } {
  if (values.length <= max) return { shown: [...values], more: 0 };
  // Never a "+1": the one hidden value fits where the count would go.
  if (values.length === max + 1) return { shown: [...values], more: 0 };
  return { shown: values.slice(0, max), more: values.length - max };
}

export interface TileSlots {
  /** Frontmatter key shown as pills; "" for none. */
  property: string;
}

export function tileBadges(record: ClippingRecord, slots: TileSlots): TileBadge[] {
  const out: TileBadge[] = [];

  if (slots.property) {
    const values = (record.properties[slots.property] ?? [])
      .map((raw) => raw.trim())
      .filter(Boolean)
      // A URL is unreadable at pill size; its host is the part that means
      // anything on a wall.
      .map((value) => (slots.property === "source" ? domainOf(value) || value : value));
    if (values.length) out.push({ text: values.join(" \u00b7 "), values });
  }
  return out;
}
