/**
 * Clippings that reached this computer while it was closed.
 *
 * A note clipped on the phone while the desktop is open lands in the folder
 * as a file, and main.ts gives it the rules and, when asked, the model. A
 * note clipped while the desktop is shut is already on the disk when
 * Obsidian starts, so it is part of the library before anything could see
 * it arrive, and the model is never offered it. This is how the start of a
 * session finds those notes again, and what it does with them.
 *
 * "While it was closed" is measured against the last time this device saw
 * the library: a mark kept in the device's own storage, not in the vault,
 * since a mark that synced would be every other device's mark too. A note
 * counts when its file was created after that mark and it has no summary
 * yet.
 *
 * The file's creation time is the clock, rather than the `created` key or
 * the modification time. The key is the clipper's to write and usually a
 * bare date, which cannot tell this morning's launch from this afternoon's
 * clip, and an imported note carries a date from years ago. The
 * modification time moves whenever any device edits the note, which would
 * bring back clippings nobody new has touched. The creation time is either
 * when the file first appeared on this disk or, where the sync carries it
 * across as iCloud Drive does, when it was made on the other device; a clip
 * made while this computer was shut is later than the mark either way.
 *
 * Pure: arrival-check.ts reads the mark, the files and the setting, and
 * does what planArrivals says.
 */

import type { NotificationDraft } from "./notifications";
import type { ClippingRecord } from "./scan";
import { isDescribed } from "./vision";

/** What to do with clippings that arrived while this computer was closed. */
export type ArrivalMode = "describe" | "notify" | "off";

export const ARRIVAL_MODES: readonly ArrivalMode[] = ["describe", "notify", "off"];

/**
 * A notification is the default. Describing costs money or quota, so it is
 * not started for someone who never said to, and saying nothing at all would
 * leave the notes as undescribed as they were before this existed. It waits
 * behind the bell rather than asking in a modal: the question is about notes
 * made somewhere else hours ago, and nothing about it is urgent enough to
 * stand in front of the wall at launch.
 */
export const DEFAULT_ARRIVAL_MODE: ArrivalMode = "notify";

export function isArrivalMode(value: unknown): value is ArrivalMode {
  return typeof value === "string" && (ARRIVAL_MODES as readonly string[]).includes(value);
}

/**
 * The local storage key of the mark. Obsidian keeps local storage per vault
 * and per device, which is exactly the scope the mark needs.
 */
export const LAST_SEEN_KEY = "goko-last-seen";

/** How often an open session moves the mark on, in milliseconds. */
export const LAST_SEEN_EVERY_MS = 60_000;

/**
 * The mark as stored, or null when there is none worth trusting. Local
 * storage hands back whatever was written, and a value this cannot read is
 * treated as a device that has never been seen, which offers nothing.
 */
export function readLastSeen(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * The clippings that arrived after the mark and still have no summary, in
 * the order given.
 *
 * No mark means this device has never run this before: the first launch
 * after installing, or after an update that brought this in. Everything in
 * the library would count as new then, so nothing does, and the mark set
 * now is where the next launch starts counting.
 *
 * @param createdAt a file's creation time in milliseconds, or undefined when
 * it is not known, which does not count as new.
 */
export function arrivedSince(
  records: readonly ClippingRecord[],
  createdAt: (path: string) => number | undefined,
  lastSeen: number | null
): string[] {
  if (lastSeen === null) return [];
  const paths: string[] = [];
  for (const record of records) {
    if (isDescribed(record)) continue;
    const created = createdAt(record.path);
    if (created !== undefined && created > lastSeen) paths.push(record.path);
  }
  return paths;
}

/**
 * Whether a note the folder gains is described as it lands, by the toggle
 * for new clippings.
 *
 * Only when it came while the session was open. Obsidian announces every
 * file already in the vault as created while it loads, so the notes that
 * "land" before the layout is ready are the whole library, not arrivals.
 * Describing those as they landed sent every clipping without a summary to
 * the model at every launch, and the ones it could not describe again the
 * next time. What among them is really new is the startup count's to find,
 * and the setting for clippings from other devices is what decides.
 */
export function describesOnLanding(arrivedWhileOpen: boolean, autoDescribe: boolean): boolean {
  return arrivedWhileOpen && autoDescribe;
}

export type ArrivalPlan =
  | { kind: "none" }
  | { kind: "describe"; paths: string[] }
  | { kind: "notify"; paths: string[] };

/**
 * What the start of a session does about them. Nothing when there is nothing
 * to describe or nothing to describe it with: an offer whose only answer is
 * a settings page is not worth making.
 */
export function planArrivals(mode: ArrivalMode, paths: readonly string[], ready: boolean): ArrivalPlan {
  if (paths.length === 0 || !ready || mode === "off") return { kind: "none" };
  return { kind: mode, paths: [...paths] };
}

/** The id the notification is posted under, so a second post replaces the first. */
export const ARRIVAL_NOTIFICATION_ID = "arrivals";

/** The action ids on it, for the handlers that answer them. */
export const DESCRIBE_ACTION = "describe";
export const DISMISS_ACTION = "dismiss";

/** The notification offering to describe this many clippings. */
export function arrivalNotification(count: number): NotificationDraft {
  const one = count === 1;
  return {
    id: ARRIVAL_NOTIFICATION_ID,
    title: one ? "A new clipping from another device" : "New clippings from your other devices",
    body: one
      ? "1 clipping arrived while this computer was away and doesn't have a description yet."
      : `${count} clippings arrived while this computer was away and don't have a description yet.`,
    actions: [
      { id: DESCRIBE_ACTION, label: `Describe ${count}`, primary: true },
      { id: DISMISS_ACTION, label: "Dismiss" },
    ],
  };
}

/** What the automatic path says as it starts. */
export function describingNotice(count: number): string {
  return count === 1
    ? "Goko: describing 1 clipping that arrived while this computer was away"
    : `Goko: describing ${count} clippings that arrived while this computer was away`;
}
