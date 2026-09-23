/**
 * Adding to a clipping's frontmatter from something other than a person.
 *
 * Domain rules and the vision model both want to write here, and neither may
 * be trusted with the file: a rule can be mistyped, a model can be wrong, and
 * both run over many notes at once, so a mistake is a mistake everywhere. This
 * is the one shape their output takes and the one merge that applies it. The
 * merge only ever adds — nothing here removes a value a person put there, and
 * nothing here touches a key the plugin already refuses to edit.
 *
 * Pure, no Obsidian: the contract is tested here, and annotate-service.ts is a
 * thin wrapper that hands the result to processFrontMatter.
 */

import { isEditable } from "./editable";
import type { EditablePolicy } from "./editable";

/** What a source wants written: values to add, by frontmatter key. */
export type Annotation = Record<string, string[]>;

/** What frontmatter looks like to the merge: whatever YAML parsed to. */
export type Frontmatter = Record<string, unknown>;

export interface MergeOutcome {
  /** True when at least one key gained a value. */
  changed: boolean;
  /** The keys that were written, for a notice that says what happened. */
  written: string[];
  /** Keys the annotation named that the policy would not let through. */
  refused: string[];
}

/** Every string a frontmatter value holds, however it was written. */
export function valuesOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string | number | boolean =>
      typeof v === "string" || typeof v === "number" || typeof v === "boolean"
    ).map(String).map((v) => v.trim()).filter(Boolean);
  }
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  return [];
}

/** Same value, ignoring case and stray whitespace: `Design` and `design` are one tag. */
function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Writes an annotation into frontmatter, in place.
 *
 * Rules, in order of how much they matter:
 *
 * - A key the policy refuses is skipped whole and reported. This is the same
 *   `isEditable` the detail pane uses, so a rule cannot reach a key a click
 *   cannot.
 * - A value already present is not written again, and the comparison ignores
 *   case: a vault with `design` must not gain `Design` beside it.
 * - A key that held one plain string keeps holding a list once a second value
 *   arrives; a key that held nothing gets a single string if one value came,
 *   which is how the vault's own property editor would have written it.
 * - Nothing is removed, ever. An annotation is additive by definition here;
 *   taking a value away is a person's decision and goes through the pane.
 *
 * @param scalarKeys keys that should stay a single string even when a value
 * arrives for one already holding a different one — `summary` is prose, and a
 * second summary should replace the first rather than sit in a list beside it.
 */
export function mergeAnnotation(
  frontmatter: Frontmatter,
  annotation: Annotation,
  policy: EditablePolicy = {},
  scalarKeys: ReadonlySet<string> = new Set()
): MergeOutcome {
  const written: string[] = [];
  const refused: string[] = [];

  for (const [rawKey, incoming] of Object.entries(annotation)) {
    const key = rawKey.trim();
    if (!key) continue;
    if (!isEditable(key, policy)) {
      refused.push(key);
      continue;
    }

    const wanted = incoming.map((v) => v.trim()).filter(Boolean);
    if (wanted.length === 0) continue;

    if (scalarKeys.has(key)) {
      // Prose replaces prose. The last value in the annotation wins, since a
      // source that sent several meant the final one.
      const next = wanted[wanted.length - 1];
      const current = valuesOf(frontmatter[key])[0];
      if (current !== undefined && same(current, next)) continue;
      frontmatter[key] = next;
      written.push(key);
      continue;
    }

    const held = valuesOf(frontmatter[key]);
    const added = wanted.filter(
      (v, i) => !held.some((h) => same(h, v)) && wanted.findIndex((w) => same(w, v)) === i
    );
    if (added.length === 0) continue;

    const all = [...held, ...added];
    frontmatter[key] = all.length === 1 ? all[0] : all;
    written.push(key);
  }

  return { changed: written.length > 0, written, refused };
}

/** Two annotations as one, later values after earlier ones. */
export function combineAnnotations(...parts: Annotation[]): Annotation {
  const out: Annotation = {};
  for (const part of parts) {
    for (const [key, values] of Object.entries(part)) {
      out[key] = [...(out[key] ?? []), ...values];
    }
  }
  return out;
}
