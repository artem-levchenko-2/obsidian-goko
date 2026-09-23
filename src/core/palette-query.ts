/**
 * The search field's own little language: `@grid` and `#tag`.
 *
 * The palette searches everything at once, which is what makes it quick and
 * also what makes a common question awkward: "the poster I saved, the one on
 * the Payments board". Every word narrows against titles and prose, and there
 * was no way to say "and only that board". These two prefixes are that way,
 * and they read as they do everywhere else — Slack, GitHub, resurf all spell
 * a channel and a label like this.
 *
 * A token becomes a chip and leaves the text, so what is left is the search
 * and the chips are the scope. Pure: the palette in view.ts draws the chips.
 */

import type { ClippingRecord } from "./scan";
import { effectiveGrid } from "./spaces";

/** What a chip narrows by. */
export type NarrowKind = "grid" | "folder" | "tag";

export interface Narrow {
  kind: NarrowKind;
  /** For a folder chip, the grid it sits on; "" when it stands alone. */
  grid?: string;
  value: string;
}

export interface ParsedQuery {
  /** What is left to search with once the tokens are taken out. */
  terms: string;
  /** The chips the tokens named, in the order they were written. */
  narrow: Narrow[];
  /**
   * A token still being typed at the end of the field, which is what the
   * suggestions are for. `@` alone is a prefix of "", meaning offer
   * everything.
   */
  typing: { sigil: "@" | "#"; prefix: string } | null;
}

/** A grid or a folder the field can be narrowed to. */
export interface NarrowTarget {
  kind: NarrowKind;
  value: string;
  /** The grid a folder belongs to, for telling two folders of a name apart. */
  grid?: string;
  /** How it reads in the list: "Payments" or "Payments / Checkout". */
  label: string;
  /** The grid's or folder's own icon, so the row is recognised rather than read. */
  icon?: string;
  /** The grid's colour, which tints that icon as it does in the rail. */
  color?: string;
}

const TOKEN = /(^|\s)([@#])([^\s@#]*)/g;

/**
 * Splits a query into its search terms and its chips.
 *
 * A token has to start the field or follow a space, so an email address in a
 * title is not read as a grid and a colour written `#1a2b3c` is a tag only
 * when it was typed as one. The last token is treated as still being typed
 * when the field ends there, which is how the suggestions appear as you go
 * and stop the moment you type a space.
 */
export function parseQuery(text: string): ParsedQuery {
  const narrow: Narrow[] = [];
  let typing: ParsedQuery["typing"] = null;
  let terms = "";
  let at = 0;

  for (const match of text.matchAll(TOKEN)) {
    const [whole, lead, sigil, body] = match;
    const start = match.index ?? 0;
    terms += text.slice(at, start) + lead;
    at = start + whole.length;

    // Still being written: the field ends here, so this is what the
    // suggestions answer rather than a chip that has been settled on.
    if (at >= text.length) {
      typing = { sigil: sigil as "@" | "#", prefix: body };
      break;
    }
    if (!body) continue;
    narrow.push(chipFor(sigil, body));
  }

  terms += text.slice(at);
  return { terms: terms.trim().replace(/\s+/g, " "), narrow, typing };
}

/** A token's text as a chip: `@Payments/Checkout` names a folder on a grid. */
function chipFor(sigil: string, body: string): Narrow {
  if (sigil === "#") return { kind: "tag", value: body };
  const slash = body.indexOf("/");
  if (slash === -1) return { kind: "grid", value: body };
  return { kind: "folder", grid: body.slice(0, slash), value: body.slice(slash + 1) };
}

/** How a chip is written back into the field, so parsing it again gives it back. */
export function tokenFor(chip: Narrow): string {
  if (chip.kind === "tag") return `#${chip.value}`;
  if (chip.kind === "folder" && chip.grid) return `@${chip.grid}/${chip.value}`;
  return `@${chip.value}`;
}

/** How a chip reads to a person. */
export function chipLabel(chip: Narrow): string {
  return chip.kind === "folder" && chip.grid ? `${chip.grid} / ${chip.value}` : chip.value;
}

/**
 * Which targets a half-typed token is offering, best first.
 *
 * Prefix before contains, and a shorter name before a longer one: typing
 * `@pa` should reach Payments before Pattern library, and a folder called
 * Checkout on Payments should come after the grid itself. Case is ignored,
 * because nobody capitalises a search.
 */
export function suggestNarrow(
  prefix: string,
  targets: readonly NarrowTarget[],
  limit = 8
): NarrowTarget[] {
  const wanted = prefix.trim().toLowerCase();
  const scored: Array<{ target: NarrowTarget; score: number }> = [];

  for (const target of targets) {
    const value = target.value.toLowerCase();
    if (!wanted) {
      scored.push({ target, score: 2 });
      continue;
    }
    if (value.startsWith(wanted)) scored.push({ target, score: 2 });
    else if (value.includes(wanted)) scored.push({ target, score: 1 });
  }

  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.target.value.length - b.target.value.length ||
        a.target.label.localeCompare(b.target.label)
    )
    .slice(0, limit)
    .map((hit) => hit.target);
}

export interface NarrowWorld {
  homeGrid: string;
  registered: ReadonlySet<string>;
  /** Which property the tags live in, alongside `tags` itself. */
  tagProperties: readonly string[];
}

/**
 * Whether a clipping is inside every chip.
 *
 * Every one, not any: two chips are two conditions, which is what a person
 * means by putting both there. A grid chip is matched against where the card
 * actually resolves, so a chip naming a grid that has since gone matches
 * nothing rather than matching what fell back to home.
 */
export function withinNarrow(
  record: ClippingRecord,
  narrow: readonly Narrow[],
  world: NarrowWorld
): boolean {
  if (narrow.length === 0) return true;
  const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

  return narrow.every((chip) => {
    if (chip.kind === "grid") {
      return same(effectiveGrid(record, world.homeGrid, world.registered), chip.value);
    }
    if (chip.kind === "folder") {
      if (!same(record.folder.trim(), chip.value)) return false;
      if (!chip.grid) return true;
      return same(effectiveGrid(record, world.homeGrid, world.registered), chip.grid);
    }
    return world.tagProperties.some((key) =>
      (record.properties[key] ?? []).some((value) => same(value.trim(), chip.value))
    );
  });
}
