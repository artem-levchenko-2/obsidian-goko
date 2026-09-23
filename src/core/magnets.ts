/**
 * Where a card in the inbox probably belongs, worked out from what is
 * already on the grids.
 *
 * No model and no network: a grid you have been filing into for a month has
 * told you what it is about, in the tags its cards carry, the sites they came
 * from and the words in its own name. Four signals, each one weak on its own
 * and each one legible when it fires, so a wrong guess can be traced to the
 * thing that caused it rather than shrugged at.
 *
 * The output is a draft: a proposal per card, and a list of the cards nothing
 * spoke up for. Nothing here writes anything, and a proposal is worth exactly
 * as much as one glance at the wall says it is.
 *
 * Pure: view.ts builds the profiles from the index and lays the islands out.
 */

import { applyRules } from "./rules";
import type { DomainRule } from "./rules";
import { domainOf } from "./scan";
import type { ClippingRecord } from "./scan";

/** The frontmatter keys a rule writes to say where a card belongs. */
const GRID_KEY = "grid";
const FOLDER_KEY = "folder";

/**
 * Where a grid's name is looked for, besides the title: the reader's own
 * note. Not the model's summary and not the body — both are prose, and prose
 * says "design" about a Gundam kit as readily as about a poster. A title is
 * short and chosen; a note is the reader's own words. Those two are worth
 * trusting on a single word, and nothing longer is.
 */
const TEXT_KEYS = ["note"] as const;

/**
 * How much each signal is worth.
 *
 * A rule is a decision you already made, so it settles the question by
 * itself. Tags are the strongest thing the vault knows on its own: they were
 * put there deliberately, by you or by the model, and a card sharing the
 * tags that characterise a grid is the ordinary reason to file it there.
 * A tag that *is* the grid's name — "typography" on a card, Typography the
 * grid — is nearly as good, and it is the only signal a grid with nothing on
 * it yet can give; a tag with the name inside it, like poster-design for
 * Design, is worth about two thirds of that. The source is next — a site you file in one place you usually file in one
 * place — and the grid's own name last, since a word can turn up in a title
 * by coincidence in a way a tag cannot. Below the threshold on its own, so a
 * name in a title can tip a card that something else already spoke for and
 * never place one by itself.
 */
export const WEIGHTS = { tags: 0.55, named: 0.45, domain: 0.4, words: 0.2 } as const;

/**
 * How high a score has to be before the card is placed rather than left in
 * the unsure island.
 *
 * Set so that one signal firing weakly is not enough and one firing clearly
 * is: half the tags of a card matching a grid's characteristic tags clears
 * it, a single tag shared with a big grid does not. A wrong island costs a
 * drag; a card in the unsure pile costs a decision you were going to make
 * anyway, so the threshold errs high.
 */
export const THRESHOLD = 0.3;

/**
 * From here up a suggestion is one you can accept without looking: a rule,
 * a tag that is the grid's name, or tags that are all characteristic of it.
 * Below it the suggestion is fair — worth a glance before agreeing.
 */
export const STRONG = 0.45;

/** Hosts where the domain says nothing about the subject. */
const AGGREGATORS = new Set([
  "google.com",
  "twitter.com",
  "x.com",
  "threads.net",
  "threads.com",
  "instagram.com",
  "pinterest.com",
  "youtube.com",
  "youtu.be",
  "reddit.com",
  "facebook.com",
  "linkedin.com",
  "t.me",
  "medium.com",
  "notion.so",
  "github.com",
]);

/** Whether a host is one whose cards could be about anything. */
export function isAggregator(host: string): boolean {
  return AGGREGATORS.has(host.toLowerCase());
}

export interface GridProfile {
  /** The grid's name, or the folder's for a folder profile. */
  name: string;
  /** The grid a card scored against this profile would be filed on. */
  grid: string;
  /** The folder on that grid, or "" for the grid itself. */
  folder: string;
  /** How many cards are filed here. Zero means nothing to learn from. */
  size: number;
  /** The keys the tags were read from, so a card is read the same way. */
  tagKeys: readonly string[];
  /** Tag value to the share of this grid's cards carrying it, 0 to 1. */
  tags: Map<string, number>;
  /** Host to the share of this grid's cards from it, 0 to 1. */
  hosts: Map<string, number>;
  /** The words of the grid's own name, worth looking for in prose. */
  words: string[];
}

/**
 * A word without its plural, roughly: "portfolios" and "portfolio" are one
 * word for this purpose, as are "payments" and "payment". Nothing cleverer:
 * the names being matched are a few words long and chosen by the same
 * person, so the mismatch worth catching is the one where a folder is
 * called Portfolios and the tag is portfolio.
 */
export function stem(word: string): string {
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

/** The words of a name worth matching: three letters or more, lower case, stemmed. */
export function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9Ѐ-ӿ]+/)
    .filter((word) => word.length >= 3)
    .map(stem);
}

function tagsOf(record: ClippingRecord, keys: readonly string[]): string[] {
  const out = new Set<string>();
  for (const key of keys) {
    for (const value of record.properties[key] ?? []) {
      const clean = value.trim().toLowerCase();
      if (clean) out.add(clean);
    }
  }
  return [...out];
}

/**
 * What a grid is, as far as its contents say.
 *
 * Shares rather than counts, so a tag on two of three cards counts for more
 * than the same tag on two of ninety: the question is what is characteristic
 * of this grid, not what has ever been seen in it.
 */
export function gridProfile(
  name: string,
  members: readonly ClippingRecord[],
  tagKeys: readonly string[]
): GridProfile {
  const tags = new Map<string, number>();
  const hosts = new Map<string, number>();
  const size = members.length;

  for (const record of members) {
    for (const tag of tagsOf(record, tagKeys)) {
      tags.set(tag, (tags.get(tag) ?? 0) + 1);
    }
    const host = domainOf(record.source);
    if (host && !isAggregator(host)) hosts.set(host, (hosts.get(host) ?? 0) + 1);
  }

  if (size > 0) {
    for (const [tag, count] of tags) tags.set(tag, count / size);
    for (const [host, count] of hosts) hosts.set(host, count / size);
  }

  return {
    name,
    grid: name,
    folder: "",
    size,
    tagKeys: [...tagKeys],
    tags,
    hosts,
    words: nameWords(name),
  };
}

/**
 * A folder, profiled as a place of its own.
 *
 * A folder is a grid inside a grid, and its cards say what it is about in
 * the same way. Its profile is sharper than its grid's, since it holds fewer
 * cards, which is why proposeGrids only sends a card into a folder when the
 * folder says strictly more about it than the grid as a whole does.
 */
export function folderProfile(
  grid: string,
  folder: string,
  members: readonly ClippingRecord[],
  tagKeys: readonly string[]
): GridProfile {
  return { ...gridProfile(folder, members, tagKeys), grid, folder };
}

export interface Score {
  score: number;
  /** The signal that contributed most, in words, for the card to say why. */
  why: string;
}

/** The text a grid's name is looked for in: the title and the reader's note. */
function textOf(record: ClippingRecord): string {
  const parts = [record.title];
  for (const key of TEXT_KEYS) parts.push(...(record.properties[key] ?? []));
  return parts.join(" ").toLowerCase();
}

/** How much a tag with the grid's name inside it is worth, against one that is the name. */
const PART_OF_TAG = 0.7;

/**
 * Whether a tag is the grid's name, has the name inside it, or neither.
 *
 * Word by word, so "Payments" is found in "payments-ux" and "Type foundry"
 * in "type-foundry"; a substring match would find "art" in "cartoon".
 */
function nameInTag(tag: string, words: readonly string[]): number {
  if (words.length === 0) return 0;
  const parts = nameWords(tag);
  const shared = words.filter((word) => parts.includes(word)).length;
  if (shared === 0) return 0;
  return shared === words.length && parts.length === words.length ? 1 : PART_OF_TAG;
}

/** How many shared tags a reason names before folding the rest into a count. */
const WHY_TAGS = 3;

/** A reason that names the tags, since "2 tags in common" says nothing about which. */
function tagsWhy(shared: readonly string[]): string {
  const named = shared.slice(0, WHY_TAGS).join(", ");
  const more = shared.length - WHY_TAGS;
  return more > 0 ? `tagged ${named} +${more}` : `tagged ${named}`;
}

/**
 * How strongly this card belongs on this grid, and why.
 *
 * A domain rule that names the grid returns 1 and stops: it is not a signal
 * about the card, it is an instruction about the domain, and weighing it
 * against three guesses would let the guesses outvote it.
 */
export function scoreGrid(
  record: ClippingRecord,
  profile: GridProfile,
  rules: readonly DomainRule[] = []
): Score {
  const host = domainOf(record.source);
  const place = profile.folder ? "folder" : "grid";

  const ruled = applyRules([...rules], record.source);
  const ruledGrid = ruled[GRID_KEY]?.[0]?.trim() ?? "";
  const ruledFolder = ruled[FOLDER_KEY]?.[0]?.trim() ?? "";
  if (ruledGrid && ruledGrid === profile.grid && ruledFolder === profile.folder) {
    return { score: 1, why: `rule for ${host}` };
  }

  const tags = tagsOf(record, profile.tagKeys);
  let tagScore = 0;
  const shared: string[] = [];
  for (const tag of tags) {
    const share = profile.tags.get(tag);
    if (share === undefined) continue;
    shared.push(tag);
    tagScore += Math.min(1, share);
  }
  // Averaged over the card's own tags, so a card with one tag that is highly
  // characteristic scores as well as a card with four that are.
  tagScore = tags.length > 0 ? tagScore / tags.length : 0;

  let namedScore = 0;
  let namedTag = "";
  for (const tag of tags) {
    const value = nameInTag(tag, profile.words);
    if (value > namedScore) {
      namedScore = value;
      namedTag = tag;
    }
  }

  const domainScore = host && !isAggregator(host) ? (profile.hosts.get(host) ?? 0) : 0;

  const text = nameWords(textOf(record)).join(" ");
  const hits = profile.words.filter((word) => text.includes(word));
  const wordScore = profile.words.length > 0 ? hits.length / profile.words.length : 0;

  const score =
    WEIGHTS.tags * tagScore +
    WEIGHTS.named * namedScore +
    WEIGHTS.domain * domainScore +
    WEIGHTS.words * wordScore;

  // Named by whichever signal carried the most weight, since that is the one
  // to disbelieve when the island is wrong.
  const parts: Array<{ value: number; why: string }> = [
    { value: WEIGHTS.tags * tagScore, why: tagsWhy(shared) },
    { value: WEIGHTS.named * namedScore, why: `tagged ${namedTag}, which names the ${place}` },
    { value: WEIGHTS.domain * domainScore, why: `${host} is usually filed here` },
    { value: WEIGHTS.words * wordScore, why: `“${hits[0] ?? ""}” in the title` },
  ];
  parts.sort((a, b) => b.value - a.value);

  return { score, why: parts[0].value > 0 ? parts[0].why : "" };
}

export interface Proposal {
  grid: string;
  /** The folder on that grid, or "" for the grid itself. */
  folder: string;
  score: number;
  why: string;
}

export interface Proposals {
  /** Card path to where it is proposed to go. */
  placed: Map<string, Proposal>;
  /** The cards nothing spoke up for, in the order they came. */
  unsure: string[];
}

/**
 * A grid for every card that has one, and a list of those that do not.
 *
 * Grids are chosen first, each counted at the best its folders can do as
 * well as its own score, so a rule or a tag that names a folder still finds
 * the grid it is on. Ties go to the smaller grid: a grid with two hundred
 * cards matches something about almost anything, and the point of a
 * proposal is to put a card where it is one of a kind rather than where it
 * disappears. Then, within the grid, a folder is proposed only when it
 * says strictly more than the grid does — a card tagged fintech on a grid
 * that is all fintech belongs to the grid, not to whichever of its folders
 * happens to be fintech too.
 */
export function proposeGrids(
  records: readonly ClippingRecord[],
  profiles: readonly GridProfile[],
  rules: readonly DomainRule[] = [],
  threshold = THRESHOLD
): Proposals {
  const placed = new Map<string, Proposal>();
  const unsure: string[] = [];
  const grids = profiles.filter((profile) => !profile.folder);
  const foldersOf = (grid: string): GridProfile[] =>
    profiles.filter((profile) => profile.folder && profile.grid === grid);

  for (const record of records) {
    let best: { grid: GridProfile; own: Score; top: Score; folder: GridProfile | null } | null = null;
    for (const grid of grids) {
      const own = scoreGrid(record, grid, rules);
      let top = own;
      let folder: GridProfile | null = null;
      for (const candidate of foldersOf(grid.name)) {
        const scored = scoreGrid(record, candidate, rules);
        if (scored.score > top.score) {
          top = scored;
          folder = candidate;
        }
      }
      if (top.score < threshold) continue;
      const better =
        !best || top.score > best.top.score || (top.score === best.top.score && grid.size < best.grid.size);
      if (better) best = { grid, own, top, folder };
    }
    if (!best) {
      unsure.push(record.path);
      continue;
    }
    placed.set(record.path, {
      grid: best.grid.name,
      folder: best.folder?.name ?? "",
      score: best.top.score,
      why: best.top.why,
    });
  }

  return { placed, unsure };
}

/**
 * The rule a correction is worth remembering as, or null.
 *
 * Only the host: a rule is a statement about a site, and a site whose cards
 * could be about anything cannot carry one. Nothing is written from here —
 * the caller asks, and the answer is a line for the settings field.
 */
export function learnableRule(
  record: Pick<ClippingRecord, "source">,
  toGrid: string,
  toFolder = ""
): { host: string; line: string } | null {
  const host = domainOf(record.source);
  if (!host || isAggregator(host)) return null;
  const grid = toGrid.trim();
  if (!grid) return null;
  const folder = toFolder.trim();
  const where = folder ? `${GRID_KEY}: ${grid}, ${FOLDER_KEY}: ${folder}` : `${GRID_KEY}: ${grid}`;
  return { host, line: `${host}  ${where}` };
}

/**
 * The rules text with one line added, or unchanged when it already says this.
 *
 * Matched on the host rather than on the whole line: a second rule for a
 * domain that already has one would be a contradiction rather than an
 * addition, and the first match is the one applyRules uses.
 */
export function appendRule(text: string, line: string): string {
  const host = line.trim().split(/\s/)[0]?.toLowerCase() ?? "";
  if (!host) return text;
  const already = text
    .split(/\r?\n/)
    .some((raw) => raw.trim().split(/\s/)[0]?.toLowerCase() === host);
  if (already) return text;
  const body = text.trimEnd();
  return body ? `${body}\n${line}\n` : `${line}\n`;
}

/** A grid the undecided pile seems to be asking for. */
export interface GridIdea {
  /** The grid's name as it would be made: the tag, in sentence case. */
  name: string;
  /** The tag the cards share. */
  tag: string;
  /** The undecided cards carrying it. */
  paths: string[];
}

/** Tags that mean "this is a clipping" rather than what it is about. */
const NOT_A_SUBJECT = new Set(["clippings", "clipping", "unread", "read", "archived"]);

/** How much of what is already filed may carry a tag before it is too general to be a grid. */
const TOO_COMMON = 0.5;

/** "poster-design" as a name: "Poster design". */
export function gridNameFor(tag: string): string {
  const words = tag
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(" ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : tag;
}

/**
 * A grid the undecided cards are asking for, or null.
 *
 * The one thing a pile of cards with no place to go can say is what they
 * have in common. When several of them share a tag that no grid or folder is
 * named for, that tag is a grid waiting to be made — and making it, with
 * those cards on it, is one decision instead of one per card. Tags that say
 * "clipping" rather than a subject are left out, and so is any tag that more
 * than half of the cards already filed on grids carry: a subject that runs
 * through everything you have organised is not what a grid is for, and a
 * grid for it would be the library again. Measured against what is filed
 * rather than against the whole vault, or a small vault whose inbox is most
 * of it could never be offered anything.
 */
export function proposeNewGrid(
  undecided: readonly ClippingRecord[],
  everything: readonly ClippingRecord[],
  taken: readonly string[],
  tagKeys: readonly string[],
  min = 3
): GridIdea | null {
  if (undecided.length < min) return null;
  const takenWords = taken.map((name) => nameWords(name));
  const isTaken = (tag: string): boolean => {
    const words = nameWords(tag);
    if (words.length === 0) return true;
    const lower = tag.toLowerCase();
    return takenWords.some(
      (name) =>
        name.join(" ") === lower ||
        gridNameFor(lower).toLowerCase() === name.join(" ") ||
        (name.length > 0 && name.every((word) => words.includes(word)))
    );
  };

  const carriers = new Map<string, string[]>();
  for (const record of undecided) {
    for (const tag of tagsOf(record, tagKeys)) {
      const held = carriers.get(tag);
      if (held) held.push(record.path);
      else carriers.set(tag, [record.path]);
    }
  }

  const pile = new Set(undecided.map((record) => record.path));
  const filed = everything.filter((record) => !pile.has(record.path));

  let best: GridIdea | null = null;
  for (const [tag, paths] of carriers) {
    if (paths.length < min || NOT_A_SUBJECT.has(tag) || isTaken(tag)) continue;
    const across = filed.filter((record) => tagsOf(record, tagKeys).includes(tag)).length;
    if (filed.length > 0 && across / filed.length > TOO_COMMON) continue;
    const better =
      !best || paths.length > best.paths.length || (paths.length === best.paths.length && tag < best.tag);
    if (better) best = { name: gridNameFor(tag), tag, paths: [...paths] };
  }
  return best;
}
