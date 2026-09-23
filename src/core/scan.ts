import { extensionOf, kindForExtension } from "./formats";

export interface MediaRef {
  url: string;
  kind: "image" | "video";
  alt: string;
  /** Sizes declared in the URL query. Used to lay out before archiving. */
  widthHint?: number;
  heightHint?: number;
}

export interface ClippingRecord {
  path: string;
  title: string;
  source: string;
  description: string;
  categories: string[];
  created: string;
  /** Optional hand-set override for the grid tile's cover image. */
  cover: string;
  /**
   * Which grid this clipping belongs to. Empty means it carries no key, which
   * is how every clipping that predates grids reads. Left raw here: turning
   * it into an effective grid needs the registry, which scanning has no
   * business knowing about. See spaces.ts.
   */
  grid: string;
  /**
   * Which folder on that grid it is filed in. Raw for the same reason as
   * grid: whether the folder exists is the registry's business. See
   * folders.ts.
   */
  folder: string;
  media: MediaRef[];
  /**
   * The opening of the note's own prose, case kept, for showing rather than
   * matching.
   *
   * A clipping usually says what it is in its frontmatter, and a card of
   * words reads from there. A note that was written rather than clipped —
   * dropped onto the wall, or exported from somewhere — has no description
   * and no summary, and without this its card would be a title on an empty
   * sheet. Free: the prose is already being flattened for the haystack.
   */
  excerpt: string;
  haystack: string;
  /**
   * Every frontmatter value, normalized to strings, so any key can back a
   * filter facet. Kept whole rather than curated: the settings list has to be
   * able to offer keys the suggester rejects.
   */
  properties: Record<string, string[]>;
}

const MD_IMAGE = /!\[([^\]]*)\]\(\s*(<?)([^)\s>]+)\2(?:\s+"[^"]*")?\s*\)/g;
const HTML_IMAGE = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const HTML_VIDEO = /<video\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
/**
 * Clippers emit both `<video src>` and `<video><source src></video>`. The
 * second form is matched as a whole element so a `<source>` inside a
 * `<picture>` is never mistaken for video.
 */
const HTML_VIDEO_BLOCK = /<video\b([^>]*)>([\s\S]*?)<\/video>/gi;
const SRC_ATTR = /\bsrc\s*=\s*["']([^"']+)["']/i;
const SOURCE_SRC = /<source\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i;
const HTML_ALT = /\balt\s*=\s*["']([^"']*)["']/i;
const ARIA_LABEL = /\baria-label\s*=\s*["']([^"']*)["']/i;
/** `![[path]]`, `![[path|label]]`, `![[path#heading]]`: an embed of a file in the vault. */
const WIKI_EMBED = /!\[\[([^\]|#]+)(?:[#|]([^\]]*))?\]\]/g;
const FENCED_CODE = /(^|\n)(```|~~~)[\s\S]*?\n\2[ \t]*(?=\n|$)/g;

/**
 * Blanks out fenced code blocks while preserving newlines, so character
 * offsets stay aligned and document order survives.
 */
function stripCode(body: string): string {
  return body.replace(FENCED_CODE, (m) => m.replace(/[^\n]/g, " "));
}

/**
 * How much of a clipping's prose reaches the search index.
 *
 * A clipped article runs to tens of kilobytes, and every record's haystack is
 * held in memory for the life of the session, so this cannot simply be the
 * whole body.
 *
 * It was ten thousand, on the reasoning that the terms worth finding sit near
 * the top and the tail is footers and related links. That is true of a
 * clipped web page and false of the two kinds of body the plugin writes
 * itself: a PDF's text and an article's, both of them chosen content the
 * whole way down. A word two thirds of the way through a document is a word
 * you will search for, and it was not being indexed — the first thing this
 * was tested with failed on exactly that.
 *
 * Twenty thousand is about four thousand words. It doubles what a record
 * costs to hold, which for a library of a few thousand clippings is tens of
 * megabytes of text, and buys the whole of everything the plugin writes.
 */
const BODY_BUDGET = 20000;

/**
 * How much of that prose a card may show. Enough to fill the sheet at the
 * largest tile size and be cut by the drawing rather than by this.
 */
const EXCERPT_BUDGET = 600;

/** `![alt](url)` and `[text](url)`: keep what was written, drop the address. */
const MD_LINK = /!?\[([^\]]*)\]\(\s*<?[^)\s>]+>?(?:\s+"[^"]*")?\s*\)/g;
/** `![[path|label]]` and `[[path|label]]`, likewise. */
const WIKI_LINK = /!?\[\[([^\]|#]+)(?:[#|]([^\]]*))?\]\]/g;
const HTML_TAG = /<[^>]+>/g;
const BARE_URL = /\bhttps?:\/\/\S+/gi;
const MD_MARKS = /[#>*_`~|-]+/g;

/**
 * The note's prose, flattened for matching.
 *
 * Addresses are stripped rather than indexed: a CDN path carrying the word
 * "design" would answer a search for design with every clipping that happened
 * to be served from it, which is worse than not searching the body at all.
 * Link text survives, since that is something a person wrote.
 */
export function bodyText(rest: string): string {
  return plainProse(rest).slice(0, BODY_BUDGET).toLowerCase();
}

/**
 * The same flattening with case and length kept, for a reader rather than
 * the index: this is what the vision model gets when a clipping is an
 * article. One pass over the markdown, so the two never disagree about what
 * counts as prose.
 */
export function plainProse(rest: string): string {
  return stripCode(rest)
    .replace(WIKI_LINK, (_m, target: string, label: string) => label || target)
    .replace(MD_LINK, (_m, text: string) => text)
    .replace(HTML_TAG, " ")
    .replace(BARE_URL, " ")
    .replace(MD_MARKS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRemote(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function widthHint(url: string): number | undefined {
  const match = /[?&](?:w|width)=(\d+)/i.exec(url);
  return match ? Number(match[1]) : undefined;
}

function heightHint(url: string): number | undefined {
  const match = /[?&](?:h|height)=(\d+)/i.exec(url);
  return match ? Number(match[1]) : undefined;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

/** One frontmatter value as facet values. Anything with no sensible string
    form, an object or an empty value, contributes nothing. */
function toValues(value: unknown): string[] {
  const one = (v: unknown): string | null => {
    if (typeof v === "string") return v.trim() || null;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return null;
  };
  if (Array.isArray(value)) {
    return value.map(one).filter((v): v is string => v !== null);
  }
  const single = one(value);
  return single === null ? [] : [single];
}

function toProperties(frontmatter: Record<string, unknown>): Record<string, string[]> {
  const properties: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    const values = toValues(value);
    if (values.length > 0) properties[key] = values;
  }
  return properties;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Sites that render media client-side (Threads, X) expose no video URL in
 * their HTML, so neither the clipper nor this plugin can find it. A `media:`
 * frontmatter list is the escape hatch: paste the direct URL and it is
 * archived like anything else. Worth doing promptly, since those CDN URLs
 * are signed and expire.
 */
function frontmatterMedia(value: unknown): MediaRef[] {
  const refs: MediaRef[] = [];
  for (const url of asStringArray(value).filter(isRemote)) {
    const kind = kindForExtension(extensionOf(url));
    refs.push({
      // No extension means we cannot tell; assume an image, which is the
      // common case and the cheaper mistake.
      kind: kind ?? "image",
      url,
      alt: "",
      widthHint: widthHint(url),
      heightHint: heightHint(url),
    });
  }
  return refs;
}

function basename(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.md$/i, "");
}

/**
 * Splits a note's own frontmatter block off the front of its body.
 *
 * Obsidian's metadata cache is the normal source of frontmatter, but it
 * resolves after the file write, so a note the plugin just authored has none
 * yet. This is the fallback for that window, working line by line rather than
 * by regex so that a value containing --- cannot close the block early and a
 * horizontal rule further down the body cannot be mistaken for the closer.
 */
export function splitFrontmatter(body: string): { yaml: string; rest: string } {
  const none = { yaml: "", rest: body };
  const lines = body.split("\n");
  const bare = (line: string): string => line.replace(/\r$/, "");
  if (bare(lines[0] ?? "") !== "---") return none;

  for (let i = 1; i < lines.length; i++) {
    if (bare(lines[i]) !== "---") continue;
    return {
      yaml: lines.slice(1, i).map(bare).join("\n"),
      rest: lines.slice(i + 1).join("\n"),
    };
  }

  // Unterminated: it is not frontmatter, it is a body that starts with a rule.
  return none;
}

/**
 * The two prose keys the plugin itself writes, both searchable.
 *
 * `note` is the reader's: why this was saved, in their own words, typed into
 * the detail pane. `summary` is the model's: what the picture shows. They are
 * named here once because scanClipping has to know to index them — frontmatter
 * is not part of the body, so without this a note written into the pane could
 * never be found by the palette that sits beside it.
 */
export const NOTE_KEY = "note";
export const SUMMARY_KEY = "summary";

export function scanClipping(
  path: string,
  frontmatter: Record<string, unknown>,
  body: string
): ClippingRecord {
  const clean = stripCode(body);
  const found: Array<{ index: number; ref: MediaRef }> = [];
  const seen = new Set<string>();

  const push = (index: number, url: string, kind: MediaRef["kind"], alt: string): void => {
    if (!isRemote(url) || seen.has(url + kind)) return;
    seen.add(url + kind);
    found.push({
      index,
      ref: { url, kind, alt, widthHint: widthHint(url), heightHint: heightHint(url) },
    });
  };

  for (const m of clean.matchAll(MD_IMAGE)) {
    push(m.index ?? 0, m[3], "image", m[1] ?? "");
  }
  for (const m of clean.matchAll(HTML_IMAGE)) {
    push(m.index ?? 0, m[1], "image", HTML_ALT.exec(m[0])?.[1] ?? "");
  }
  for (const m of clean.matchAll(HTML_VIDEO_BLOCK)) {
    const attrs = m[1] ?? "";
    const url = SRC_ATTR.exec(attrs)?.[1] ?? SOURCE_SRC.exec(m[2] ?? "")?.[1];
    if (!url) continue;
    const alt = HTML_ALT.exec(attrs)?.[1] ?? ARIA_LABEL.exec(attrs)?.[1] ?? "";
    push(m.index ?? 0, url, "video", alt);
  }

  // Self-closing or unclosed <video src>. The seen-set makes the overlap
  // with the block form harmless.
  for (const m of clean.matchAll(HTML_VIDEO)) {
    const alt = HTML_ALT.exec(m[0])?.[1] ?? ARIA_LABEL.exec(m[0])?.[1] ?? "";
    push(m.index ?? 0, m[1], "video", alt);
  }

  // The plugin's own notes embed their archived media as wikilinks, paths in
  // the vault rather than URLs, so they get a pass of their own: the kind is
  // read off the extension and the label, if any, is the alt. Without this
  // a link clipping's own picture never reached the tile, and it rendered
  // only through a second copy fetched as the page's cover.
  for (const m of clean.matchAll(WIKI_EMBED)) {
    const target = m[1].trim();
    const kind = kindForExtension(extensionOf(target));
    if (!kind || seen.has(target + kind)) continue;
    seen.add(target + kind);
    found.push({ index: m.index ?? 0, ref: { url: target, kind, alt: (m[2] ?? "").trim() } });
  }

  found.sort((a, b) => a.index - b.index);

  // Hand-listed media leads, so it wins the cover over anything in the body.
  const media = [...frontmatterMedia(frontmatter.media), ...found.map((f) => f.ref)];

  const title = str(frontmatter.title) || basename(path);
  const source = str(frontmatter.source);
  const description = str(frontmatter.description);
  const categories = asStringArray(frontmatter.categories);
  const created = str(frontmatter.created);

  // The body goes in last so a term shared with the title still reads as a
  // title hit: rank() scores this whole string as one secondary field, and
  // phraseMatch prefers the words found together and early.
  // The reader's note and the model's summary sit ahead of the body: they are
  // short, they are about the picture, and a hit in either is a better answer
  // than the same word deep in an article's prose.
  const prose = [...asStringArray(frontmatter[NOTE_KEY]), ...asStringArray(frontmatter[SUMMARY_KEY])];
  // Flattened once and read twice: lowercased and capped for matching,
  // trimmed short and left alone for showing.
  const flattened = plainProse(splitFrontmatter(body).rest);
  const haystack = [title, description, domainOf(source), ...categories, ...prose]
    .join(" ")
    .toLowerCase()
    .concat(" ", flattened.slice(0, BODY_BUDGET).toLowerCase());
  const excerpt = flattened.slice(0, EXCERPT_BUDGET);

  const cover = str(frontmatter.cover);
  const grid = str(frontmatter.grid);
  const folder = str(frontmatter.folder);

  const properties = toProperties(frontmatter);
  // The facet that ships enabled takes the field computed above rather than
  // the raw frontmatter, so categories keeps asStringArray.
  if (categories.length > 0) properties.categories = categories;
  else delete properties.categories;

  return {
    path,
    title,
    source,
    description,
    categories,
    created,
    cover,
    grid,
    folder,
    media,
    excerpt,
    haystack,
    properties,
  };
}
