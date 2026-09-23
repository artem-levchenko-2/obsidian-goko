import { extensionOf } from "./formats";
import { humanBytes } from "./media-refs";
import type { ClippingRecord } from "./scan";
import type { TileModel } from "./tile";

/**
 * The rules behind the panel down the right of the wall.
 *
 * Pure, no DOM and no Obsidian: inspector.ts draws what these return. The
 * width arithmetic is the rail's, mirrored — a panel that appeared at a
 * different pane width, or clamped to a different range, would read as a
 * second idea rather than the same one on the other side.
 */

export const INSPECTOR_MIN = 240;
export const INSPECTOR_MAX = 460;
export const INSPECTOR_DEFAULT = 300;

/** A dragged width, clamped. A stored width from a hand-edited file too. */
export function clampInspectorWidth(width: number): number {
  if (!Number.isFinite(width)) return INSPECTOR_DEFAULT;
  return Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, Math.round(width)));
}

/**
 * How wide the pane has to be before the panel can stand beside the wall.
 *
 * Lower than the rail's threshold, and deliberately: the rail is a way of
 * getting somewhere and the grid menu in the dock does that job too, while
 * the panel is now the only way to read a card without leaving the wall.
 * When room runs out the rail goes first.
 */
export const INSPECTOR_MIN_PANE = 560;

/** Whether the panel should stand beside the wall, given the pane. */
export function inspectorVisible(paneWidth: number, hidden: boolean): boolean {
  return !hidden && paneWidth >= INSPECTOR_MIN_PANE;
}

/** What the heading says for a selection of this size. */
export function selectionLabel(count: number): string {
  return count === 1 ? "1 selected" : `${count} selected`;
}

export interface Fact {
  label: string;
  value: string;
}

/**
 * What the file is, for the section that is folded away by default.
 *
 * These rows sat in the detail panel once and were the first thing asked to
 * go: a designer's card is about the picture, not the file. They are here
 * because sometimes the question really is "how big is this", and behind a
 * fold because it usually is not.
 */
export function fileFacts(model: TileModel, bytes: number): Fact[] {
  const facts: Fact[] = [];

  if (model.width > 0 && model.height > 0) {
    facts.push({ label: "Dimensions", value: `${model.width}×${model.height}` });
  }
  if (bytes > 0) facts.push({ label: "Size", value: humanBytes(bytes) });

  const ext = extensionOf(model.filePath || model.record.cover || model.record.source);
  if (ext) facts.push({ label: "Type", value: ext.toUpperCase() });

  if (model.record.created) facts.push({ label: "Saved", value: model.record.created });

  return facts;
}

/** The format chip over the thumbnail: the extension, or nothing to say. */
export function formatLabel(model: TileModel): string {
  const ext = extensionOf(model.filePath || model.record.cover || model.record.source);
  return ext ? ext.toUpperCase() : "";
}

/**
 * The values of a property that every selected clipping carries.
 *
 * A chip in a multiple selection stands for "all of these have this", so it
 * can only be one the whole selection agrees on. Removing it then means
 * something definite; showing a value two of five happen to have, and letting
 * it be unticked, would not.
 *
 * Order follows the first record, so the row does not reshuffle as the
 * selection grows.
 */
export function sharedValues(records: readonly ClippingRecord[], key: string): string[] {
  if (records.length === 0) return [];
  const first = records[0].properties[key] ?? [];
  if (records.length === 1) return [...first];

  const rest = records.slice(1).map((record) => new Set(record.properties[key] ?? []));
  return first.filter((value) => rest.every((held) => held.has(value)));
}

/**
 * Every property key worth a row for this selection, in the order the card
 * reports them, minus the ones the panel already says in its own words.
 */
export function rowKeys(
  properties: readonly string[],
  skip: ReadonlySet<string>
): string[] {
  return properties.filter((key) => !skip.has(key));
}
