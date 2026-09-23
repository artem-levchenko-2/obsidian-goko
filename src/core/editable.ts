/**
 * Which frontmatter keys the plugin may write, and how their values change.
 *
 * Pure, no DOM and no Obsidian, so the contract below is testable on its own
 * rather than only discoverable by writing to somebody's notes.
 */

/**
 * The Web Clipper's own keys. The vault treats these as a contract and
 * says never to modify, reorder or remove any of them, so the detail view
 * shows them and will not write them. Editing `title` here would rewrite the
 * clipped page's own record of itself.
 */
const CLIPPER_KEYS = new Set([
  "title",
  "source",
  "author",
  "published",
  "created",
  "description",
]);

/**
 * `tags` is the Clipper's too, but it is the one of its keys that is a list of
 * the reader's own labels rather than a record of the page: the vault's own
 * property editor lets anyone add to it, so refusing here only pushed the work
 * into another pane. Behind a setting, and off by the same default the vault
 * documents, so a clipper-managed vault is untouched until it opts in.
 */
const OPTIONAL_CLIPPER_KEYS = new Set(["tags"]);

/**
 * Keys the plugin owns. `type` is the parse flag, so clearing it would unfile
 * the clipping; `grid` has its own write path in view.assign and two routes to
 * one key is how they drift; `cover` and `media` are pointers at files, not
 * values to pick from a list; `origin` is where the clipped copy was first
 * published, as much the page's record of itself as the Clipper's `source`.
 */
const PLUGIN_KEYS = new Set(["type", "grid", "folder", "cover", "media", "origin"]);

/**
 * What the caller is allowed to write, so a key's fate does not depend on
 * which call site asked. Absent fields read as the safe default: refusing.
 */
export interface EditablePolicy {
  /** Whether `tags` may be written from the plugin's own panes. */
  allowEditingTags?: boolean;
}

export function isEditable(key: string, policy: EditablePolicy = {}): boolean {
  const name = key.trim().toLowerCase();
  if (name.length === 0) return false;
  if (CLIPPER_KEYS.has(name) || PLUGIN_KEYS.has(name)) return false;
  if (OPTIONAL_CLIPPER_KEYS.has(name)) return policy.allowEditingTags === true;
  return true;
}

/** Returns a new list; never edits the one it was given. */
export function withValue(values: string[], value: string): string[] {
  const wanted = value.trim();
  if (!wanted || values.includes(wanted)) return [...values];
  return [...values, wanted];
}

/** Returns a new list; never edits the one it was given. Removes every
    occurrence, so a value duplicated by hand cannot survive one click. */
export function withoutValue(values: string[], value: string): string[] {
  return values.filter((held) => held !== value);
}

/** Whether a value is held by every clipping in a selection, some, or none. */
export type Holding = "all" | "some" | "none";

export function holdingAcross(held: readonly (readonly string[])[], value: string): Holding {
  const count = held.filter((values) => values.includes(value)).length;
  if (count === 0) return "none";
  return count === held.length ? "all" : "some";
}

/**
 * One tap on a value across a selection: held by all, it comes off all of
 * them; held by some or none, it goes on all of them. The tick and the dash
 * both mean "not yet everywhere", and the tap makes it everywhere. A
 * single-choice property replaces rather than adds, as it does for one
 * clipping. Returns new lists; never edits the ones it was given.
 */
export function toggleAcross(
  held: readonly (readonly string[])[],
  value: string,
  single: boolean
): string[][] {
  const everywhere = holdingAcross(held, value) === "all";
  return held.map((values) => {
    if (everywhere) return single ? [] : withoutValue([...values], value);
    return single ? [value] : withValue([...values], value);
  });
}
