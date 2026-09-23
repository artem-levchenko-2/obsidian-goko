/**
 * `remind`: the date a clipping should come back.
 *
 * The inbox is a queue, and a queue that can only be emptied by deciding
 * about every card in it is a queue that does not get emptied. Later is the
 * third answer beside file and delete — "not now, but not gone" — and it is
 * only a real answer if the card actually leaves the inbox and actually
 * returns. So the date is written into the note, the wall hides a clipping
 * whose date has not arrived, and the day it has, the card is simply there
 * again.
 *
 * A property rather than plugin state, for the same reason everything else
 * here is: it survives a reinstall, it syncs with the note, and it can be
 * read and edited by hand.
 *
 * Pure: view.ts writes the key through its own door and hides what this
 * marks as snoozed.
 */

import { looksLikeDate, parseDate, todayISO } from "./dates";
import type { ClippingRecord } from "./scan";

export const REMIND_KEY = "remind";

/** How far ahead one tap of Later puts a clipping. A week: long enough to
    clear the inbox, short enough that nothing is being buried. */
export const LATER_DAYS = 7;

/** The date this clipping is waiting for, or "". */
export function remindOf(record: Pick<ClippingRecord, "properties">): string {
  return (record.properties[REMIND_KEY] ?? [])[0]?.trim() ?? "";
}

/** `days` from today, as the ISO date the key holds. */
export function laterDate(days = LATER_DAYS, now: Date = new Date()): string {
  const then = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return todayISO(then);
}

/**
 * Whether this clipping is still waiting, and so should not be in the inbox.
 *
 * A date that has arrived is not snoozed: the whole point is that the card
 * comes back on the day it names, so today counts as due rather than as one
 * more day of waiting. Anything that is not a date at all — a hand-written
 * "next spring" — leaves the card visible: a key nothing can read is not
 * grounds for hiding a clipping.
 */
export function isSnoozed(record: Pick<ClippingRecord, "properties">, now: number): boolean {
  const value = remindOf(record);
  if (!looksLikeDate(value)) return false;
  const at = parseDate(value);
  if (Number.isNaN(at)) return false;
  return at > parseDate(todayISO(new Date(now)));
}

/** The inbox, and what it is holding back. Order is preserved in both. */
export function partitionSnoozed<T extends Pick<ClippingRecord, "properties">>(
  records: readonly T[],
  now: number
): { shown: T[]; snoozed: T[] } {
  const shown: T[] = [];
  const snoozed: T[] = [];
  for (const record of records) (isSnoozed(record, now) ? snoozed : shown).push(record);
  return { shown, snoozed };
}
