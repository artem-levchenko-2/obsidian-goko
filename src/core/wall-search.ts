/**
 * Search as a narrowing of the wall, rather than a list beside it.
 *
 * The palette answers a query with at most eight clippings and takes you to
 * the one you pick, which is the right shape for "go to that clipping" and
 * the wrong one for "show me everything about boots": the other results are
 * gone the moment you choose, and a card inside a folder has no tile to be
 * taken to.
 * Here the query decides which cards stay on the wall, the way a filter does,
 * so every match is a card you can open, step through and come back from.
 *
 * What is searched is the record's haystack and nothing else: the words a
 * clipping carries, not the names of the grid and folder it is filed in.
 *
 * Pure: view.ts runs this over the tiles in scope.
 */

import { NOTE_KEY, SUMMARY_KEY, domainOf } from "./scan";
import type { ClippingRecord } from "./scan";

/** One word of a query, ready to be looked for. */
export interface SearchTerm {
  /** Lower case, as the haystack is. */
  text: string;
  /**
   * True when the word only counts at the start of a word in the text.
   *
   * A short word is found inside far too many longer ones: measured on a
   * real library, "cat" was in 60 clippings, 46 of them only inside words
   * like modification and scattered, and "ring" in 175, mostly inside
   * wearing and featuring. A longer word inside another is nearly always
   * the word itself, run into a hashtag or a compound, so "tattoo" still
   * finds #darktattoo and "boots" finds ankleboots.
   */
  atWordStart: boolean;
}

/** The longest word that has to start a word to count. */
const SHORT_WORD = 4;

/** A run of letters and digits, with the marks that belong to them. */
const WORD = /[\p{L}\p{N}\p{M}]+/gu;
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

/**
 * Scripts that leave no space between words. There is no start of a word to
 * find in 黒い猫, so a word in them is looked for anywhere, and one character
 * is a whole word rather than a stray letter.
 */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * The words of a query, in the order they were typed, each once.
 *
 * Anything that is not a letter or a digit separates words, so a `#` typed
 * out of habit, a hyphen and a comma all read as a space: the tags a card
 * carries are in its haystack without their `#`, and an article's body has
 * had its hyphens flattened to spaces. A single letter is dropped, because
 * the first keystroke of a word would otherwise match most of the library
 * and redraw the whole wall only to narrow it again a moment later.
 */
export function searchTerms(query: string): SearchTerm[] {
  const terms: SearchTerm[] = [];
  const seen = new Set<string>();
  for (const [text] of query.toLowerCase().matchAll(WORD)) {
    const unspaced = UNSPACED.test(text);
    const length = Array.from(text).length;
    if (length < 2 && !unspaced) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    terms.push({ text, atWordStart: length <= SHORT_WORD && !unspaced });
  }
  return terms;
}

/**
 * Whether the text holds the word. At a word's start means after the
 * beginning of the text or after anything that is not a letter, a digit or a
 * mark, so "cat" is found in "a cat", "(cat" and "#cat" but not in
 * "scattered". Every place the word occurs is tried, since the first one can
 * be inside a longer word and a later one on its own.
 */
function holds(text: string, term: SearchTerm): boolean {
  if (!term.atWordStart) return text.includes(term.text);
  let from = 0;
  for (;;) {
    const at = text.indexOf(term.text, from);
    if (at === -1) return false;
    if (at === 0 || !WORD_CHAR.test(text[at - 1])) return true;
    from = at + 1;
  }
}

/** Whether a clipping holds every word of the query. */
export function matchesSearch(record: ClippingRecord, terms: readonly SearchTerm[]): boolean {
  return terms.every((term) => holds(record.haystack, term));
}

/** Where a match is: 0 for the title or a tag, 1 for what was written about
    the clipping, 2 for the text of the clipping itself. */
export type SearchTier = 0 | 1 | 2;

function tierOfTerm(record: ClippingRecord, term: SearchTerm): SearchTier {
  const inAny = (values: readonly string[]): boolean =>
    values.some((value) => holds(value.toLowerCase(), term));
  if (inAny([record.title, ...record.categories])) return 0;
  const about = [
    record.description,
    ...(record.properties[NOTE_KEY] ?? []),
    ...(record.properties[SUMMARY_KEY] ?? []),
    domainOf(record.source),
  ];
  if (inAny(about)) return 1;
  return 2;
}

/**
 * How good a match a clipping is. A card named for the word is a better
 * answer than one that mentions it in the fortieth paragraph of an article,
 * and a word in its description, its note or its summary sits between the
 * two. With several words the card is as good as its weakest one: "red
 * boots" in the title beats "boots" in the title and "red" in the body.
 */
export function searchTier(record: ClippingRecord, terms: readonly SearchTerm[]): SearchTier {
  let tier: SearchTier = 0;
  for (const term of terms) {
    const found = tierOfTerm(record, term);
    if (found > tier) tier = found;
  }
  return tier;
}

/**
 * Every clipping that matches, by path, with how good a match it is.
 *
 * Worked out once for a query over the whole library and kept: the wall
 * repaints on every frame while media is downloading, and a word that is in
 * nothing reads every haystack to the end to say so.
 */
export function searchHits(
  records: readonly ClippingRecord[],
  terms: readonly SearchTerm[]
): Map<string, SearchTier> {
  const hits = new Map<string, SearchTier>();
  for (const record of records) {
    if (matchesSearch(record, terms)) hits.set(record.path, searchTier(record, terms));
  }
  return hits;
}

/**
 * The tiles among the hits, best tier first.
 *
 * Within a tier they keep the order they came in, which is the wall's own:
 * the newest first, shuffled or by last edit, whatever the wall was set to.
 * Sorting by anything finer would reshuffle the cards with every letter
 * typed, and a wall that jumps around while you type is hard to read.
 */
export function narrowToHits<T extends { id: string }>(
  tiles: readonly T[],
  hits: ReadonlyMap<string, SearchTier>
): T[] {
  const found: Array<{ tile: T; tier: SearchTier; index: number }> = [];
  tiles.forEach((tile, index) => {
    const tier = hits.get(tile.id);
    if (tier !== undefined) found.push({ tile, tier, index });
  });
  found.sort((a, b) => a.tier - b.tier || a.index - b.index);
  return found.map((hit) => hit.tile);
}

/** The tiles that match a query, best tier first; see narrowToHits. */
export function searchTiles<T extends { id: string; record: ClippingRecord }>(
  tiles: readonly T[],
  terms: readonly SearchTerm[]
): T[] {
  if (terms.length === 0) return [...tiles];
  return narrowToHits(tiles, searchHits(tiles.map((tile) => tile.record), terms));
}
