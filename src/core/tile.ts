import type { MediaCache } from "./cache";
import { extensionOf, isRenderable, kindForExtension } from "./formats";
import { dedupeMedia, normalizeUrl, sourceVideoKeyFor } from "./normalize";
import type { CanonicalMedia } from "./normalize";
import { knownHostThumbnail } from "./page-cover";
import type { ClippingRecord } from "./scan";
import { watchedOnYoutube } from "./youtube";

export interface TileModel {
  id: string;
  record: ClippingRecord;
  /**
   * A still frame, used only to post a video and to freeze a paused GIF.
   * Empty for static images, which always paint at full resolution.
   */
  posterPath: string;
  /** What the tile paints: the full-resolution source. */
  filePath: string;
  /** True while the tile is showing the origin server's copy. */
  remote: boolean;
  /**
   * "note" is a clipping with no picture at all, drawn as its own words on a
   * sheet rather than skipped. Such a tile has no `filePath`, which is the
   * one thing every reader of this type has to know; changing the union is
   * how the compiler says so at each of them.
   */
  kind: "image" | "video" | "note";
  /** True when the cover moves on its own and playback should manage it. */
  animated: boolean;
  /**
   * The picture is of a document rather than being the thing itself: a PDF's
   * rendered first page. Two things follow from it, and nothing else does —
   * the card says so, and Open in the details panel goes to Obsidian's
   * reader rather than to the full screen.
   */
  isDocument?: boolean;
  width: number;
  height: number;
  /** True when width and height are guesses, to be corrected on load. */
  provisional: boolean;
  /** Changes whenever the painted content must change. */
  signature: string;
}

/** Aspect ratio used when nothing is known about a cover's shape. */
const DEFAULT_RATIO = { width: 4, height: 3 };

/** Most video is landscape, so this is the least-wrong guess before load. */
const VIDEO_RATIO = { width: 16, height: 9 };

/**
 * Frame 0 of an animated GIF is often useless as a cover: a terminal
 * recording opens on an empty prompt. Showing the original instead of a
 * still lets it animate, which is both truer to the content and closer to
 * how posts.design previews clips.
 */
const ANIMATED_EXT = /\.gif$/i;

/** Above this, decoding every frame costs more than the motion is worth. */
const MAX_ANIMATED_BYTES = 8 * 1024 * 1024;

/**
 * The words a clipping with no picture shows, best first.
 *
 * Your own note leads: you wrote it about this thing, on purpose. Then the
 * model's summary, then whatever the page said about itself, then the note's
 * own opening lines. The title is not here — it is drawn above this, in its
 * own line.
 */
export function noteText(record: ClippingRecord): string {
  const own = (record.properties.note ?? [])[0]?.trim();
  if (own) return own;
  const summary = (record.properties.summary ?? [])[0]?.trim();
  if (summary) return summary;
  const described = record.description.trim();
  if (described) return described;
  // Last, and the only one a note that was written rather than clipped will
  // have: its own opening lines. Without it such a card is a title on an
  // empty sheet, which says less than the file name already did.
  return record.excerpt.trim();
}

/**
 * Metrics of the drawn sheet. Every one of these mirrors a rule in
 * styles.css and has to move with it.
 *
 * They exist because the wall is laid out before a single tile is in the
 * DOM — that is what lets the whole thing resolve in one pass, with no
 * reflow — so how tall a card of words needs to be can only be estimated,
 * the way a picture's height is read off its file header.
 */
const FRAME_INSET = 4;
const SHEET_INSET = 10;
const SHEET_PAD = 12;
const MARK_H = 18;
const MARK_GAP = 8;
const TITLE_LINE = 19;
const TITLE_CHAR = 7;
const TITLE_MAX_LINES = 3;
const TITLE_GAP = 6;
const TEXT_LINE = 17;
const TEXT_CHAR = 6.1;
const TEXT_MAX_LINES = 8;

/** Nothing readable fits in a card this short, whatever is on it. */
const NOTE_MIN_HEIGHT = 96;

/**
 * Under this column a card has room for a name and nothing else.
 *
 * Sorting runs the wall at its tiniest stage, where the sheet is barely
 * wider than a stamp: four words a line, broken mid-word. A name and the
 * site's mark is what a card that small can honestly say, so the body is
 * dropped — here and, by the same number, in styles.css.
 */
export const COMPACT_COLUMN = 170;

/** The column width the wall is laid out at when nobody has said otherwise. */
const NOMINAL_COLUMN = 300;

function wrapped(value: string, perLine: number, max: number): number {
  const length = value.trim().length;
  if (length === 0) return 0;
  return Math.min(max, Math.max(1, Math.ceil(length / perLine)));
}

/**
 * How tall a card of words should be in a column of this width.
 *
 * Longer text earns a taller card, which is the whole reason the wall is a
 * masonry: a long note takes the room a tall photograph takes. Bounded at
 * the top, because one long note must not take the screen — what does not
 * fit is clamped in the drawing too, so the card never shows text its
 * measured box has no room for.
 */
export function noteTileHeight(record: ClippingRecord, columnWidth: number): number {
  const chrome = (FRAME_INSET + SHEET_INSET + SHEET_PAD) * 2;
  const inner = Math.max(48, columnWidth - chrome);
  const compact = columnWidth < COMPACT_COLUMN;

  const titleLines = wrapped(
    record.title,
    Math.max(6, Math.floor(inner / TITLE_CHAR)),
    compact ? 2 : TITLE_MAX_LINES
  );
  const textLines = compact
    ? 0
    : wrapped(noteText(record), Math.max(8, Math.floor(inner / TEXT_CHAR)), TEXT_MAX_LINES);

  const body =
    titleLines * TITLE_LINE +
    textLines * TEXT_LINE +
    (titleLines > 0 && textLines > 0 ? TITLE_GAP : 0);

  return Math.max(NOTE_MIN_HEIGHT, Math.round(chrome + MARK_H + MARK_GAP + body));
}

/**
 * The tile for a clipping with no picture.
 *
 * `width` and `height` are a ratio, not pixels: the layout scales them to
 * whatever column it ends up with. grid.ts recomputes the height at the
 * real column width, since how many lines the text takes depends on it;
 * this is the answer at the ordinary size, for anything that asks without
 * laying the wall out.
 */
function noteCover(record: ClippingRecord): Cover {
  return {
    posterPath: "",
    filePath: "",
    remote: false,
    kind: "note",
    animated: false,
    width: NOMINAL_COLUMN,
    height: noteTileHeight(record, NOMINAL_COLUMN),
    provisional: false,
  };
}

type Cover = Omit<TileModel, "id" | "record" | "signature">;

function signatureOf(cover: Cover, record: ClippingRecord): string {
  // A text card paints words rather than a file, so what it paints changes
  // when the words do: the model writing a summary has to repaint it.
  if (cover.kind === "note") return `note|${record.title}|${noteText(record)}|${record.source}`;
  return `${cover.kind}|${cover.animated ? 1 : 0}|${cover.posterPath}|${cover.filePath}`;
}

/**
 * Returns null when the file is archived but cannot be shown: a format
 * Chromium will not decode, whose preview has not been generated yet. The
 * caller moves on to the next ref rather than painting a broken tile.
 */
function localCover(
  entry: NonNullable<ReturnType<MediaCache["get"]>>
): Cover | null {
  const hasSize = entry.width > 0 && entry.height > 0;
  const size = {
    width: hasSize ? entry.width : DEFAULT_RATIO.width,
    height: hasSize ? entry.height : DEFAULT_RATIO.height,
    provisional: !hasSize,
  };
  const renderable = isRenderable(extensionOf(entry.file));

  if (entry.kind === "video") {
    if (renderable) {
      return {
        posterPath: entry.thumb,
        filePath: entry.file,
        remote: false,
        kind: "video",
        animated: false,
        ...size,
      };
    }
    // A container Chromium cannot play, such as AVI. The extracted frame is
    // the honest thing to show; the original stays archived.
    if (!entry.thumb) return null;
    return {
      posterPath: "",
      filePath: entry.thumb,
      remote: false,
      kind: "image",
      animated: false,
      ...size,
    };
  }

  if (!renderable) {
    // HEIC, TIFF, RAW, PDF and friends: paint the generated preview instead.
    if (!entry.thumb) return null;
    return {
      posterPath: "",
      filePath: entry.thumb,
      remote: false,
      kind: "image",
      animated: false,
      isDocument: extensionOf(entry.file) === "pdf",
      ...size,
    };
  }

  const animatable = ANIMATED_EXT.test(entry.file);
  return {
    // Only an animated GIF has any use for a still, to freeze on when paused.
    posterPath: animatable ? entry.thumb : "",
    filePath: entry.file,
    remote: false,
    kind: "image",
    animated: animatable && Boolean(entry.thumb) && entry.bytes <= MAX_ANIMATED_BYTES,
    ...size,
  };
}

function isRemote(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function remoteCover(
  url: string,
  kind: "image" | "video",
  widthHint?: number,
  heightHint?: number
): Cover {
  const ratio = kind === "video" ? VIDEO_RATIO : DEFAULT_RATIO;
  const hinted = Boolean(widthHint && heightHint);
  return {
    posterPath: "",
    filePath: url,
    remote: true,
    kind,
    // Nothing to swap back to yet, so playback has nothing to manage.
    animated: false,
    width: hinted ? widthHint! : ratio.width,
    height: hinted ? heightHint! : ratio.height,
    provisional: true,
  };
}

/**
 * What one media ref can contribute to a view of a clipping.
 *
 * Three outcomes rather than a nullable cover, because "nothing to show" and
 * "nothing to show but here is the page's own thumbnail" are different
 * answers: the second is a last resort the caller may only use once every
 * real ref has been tried.
 */
export type MediaOutcome =
  | { kind: "cover"; cover: Cover }
  | { kind: "skip" }
  | { kind: "page-thumbnail"; url: string };

const SKIP: MediaOutcome = { kind: "skip" };

/**
 * Resolves one media ref to something paintable.
 *
 * Split out of pickCover's loop so the same decision serves both readers: the
 * wall, which wants the first ref that works, and the detail view's carousel,
 * which wants every ref that works. Keeping one implementation is the point —
 * two would drift, and the wall would show a cover the carousel then skipped.
 */
export function coverForMedia(item: CanonicalMedia, cache: MediaCache): MediaOutcome {
  // A file in the vault, embedded as a wikilink. The archive knows its
  // size if it made it; otherwise the tile measures it once it loads.
  if (!isRemote(item.url)) {
    const archived = cache.byFile(item.url);
    if (archived) {
      const cover = localCover(archived);
      return cover ? { kind: "cover", cover } : SKIP;
    }
    // A video needs a poster to stand in for it, and there is none.
    if (item.kind === "video") return SKIP;
    // Nor does a format the browser cannot decode: a PDF, a HEIC, a RAW.
    // Pointing an <img> at one only errors, and the wall answers an error by
    // dropping the tile for the session — so the clipping would disappear
    // rather than wait. Nothing yet is the honest answer: the card shows its
    // own words until the archiver has rendered a preview, and swaps to the
    // picture when it lands.
    if (!isRenderable(extensionOf(item.url))) return SKIP;
    return {
      kind: "cover",
      cover: {
        posterPath: "",
        filePath: item.url,
        remote: false,
        kind: "image",
        animated: false,
        width: DEFAULT_RATIO.width,
        height: DEFAULT_RATIO.height,
        provisional: true,
      },
    };
  }

  // Before the cache gets a say: a known host's page URL is never playable,
  // whatever an old cache claims to have archived for it (see MediaCache.index
  // for the poisoned shape this guards against).
  if (item.kind === "video") {
    const known = knownHostThumbnail(item.url);
    if (known) return { kind: "page-thumbnail", url: known.url };
  }

  const entry = cache.get(item.key);
  // A recorded failure means the ref is bad at the source too, so there is
  // no point falling back to its remote URL.
  if (entry?.failed) return SKIP;
  if (entry?.file) {
    const cover = localCover(entry);
    return cover ? { kind: "cover", cover } : SKIP;
  }
  return {
    kind: "cover",
    cover: remoteCover(item.url, item.kind, item.widthHint, item.heightHint),
  };
}

/**
 * The cover named in the note's own `cover:`, which outranks everything.
 *
 * Two things it is not allowed to assume. The kind: a cover set by hand can
 * be a clip as easily as a still, and calling one an image paints it into an
 * <img> that can only fail. And that the file can be painted at all: a PDF
 * or a HEIC named here is answered by the preview rendered for it, exactly
 * as an embed of one is. Until that preview exists there is nothing to show,
 * and saying so lets the clipping fall back to its own words rather than to
 * a broken picture.
 *
 * An extension nothing recognises reads as a picture, which is what every
 * hand-set cover was before there was a choice to make.
 */
function handCover(record: ClippingRecord, cache: MediaCache): Cover | null {
  const cover = record.cover;
  if (!cover) return null;

  const remote = isRemote(cover);
  if (!remote && !isRenderable(extensionOf(cover))) {
    const entry = cache.byFile(cover);
    return entry ? localCover(entry) : null;
  }

  const kind = kindForExtension(extensionOf(cover)) ?? "image";
  return { ...remoteCover(cover, kind), remote };
}

/**
 * The clipping's own moving picture, wherever it lives, or null.
 *
 * Only consulted when a cover has been set by hand, so the walk it does is
 * paid for by the few cards that have one rather than by every card on the
 * wall. The order is pickCover's: a video pulled from the post itself, then
 * anything inline.
 */
function movingCover(record: ClippingRecord, cache: MediaCache): Cover | null {
  if (record.source) {
    const fromSource = cache.get(sourceVideoKeyFor(record.source));
    if (fromSource?.file) {
      const cover = localCover(fromSource);
      if (cover?.kind === "video") return cover;
    }
  }

  for (const item of dedupeMedia(record.media)) {
    const outcome = coverForMedia(item, cache);
    if (outcome.kind === "cover" && outcome.cover.kind === "video") return outcome.cover;
  }
  return null;
}

/**
 * Picks what a tile shows: the archived original when it exists, otherwise
 * the origin server's copy. Always the full-resolution asset, so a tile
 * stays sharp at any zoom. The grid never waits on archiving to show
 * something.
 *
 * Returns null when the clipping has no picture at all — including while a
 * preview is still being rendered for one. buildTiles answers that with a
 * card of the clipping's own words rather than leaving it off the wall.
 */
function pickCover(record: ClippingRecord, cache: MediaCache): Cover | null {
  const hand = handCover(record, cache);
  if (hand) {
    // A still chosen by hand says which frame to show. It does not say the
    // clipping has stopped being a clip — which is what returning it here
    // used to mean, and why setting a cover on a reel left a card that would
    // not play. The frame becomes the video's poster instead, so the card
    // shows what was chosen and still moves under the pointer.
    //
    // Only a local one: a poster is a vault path, and a cover pointing at
    // somebody else's server has none to give.
    const moving = hand.kind === "image" && !hand.remote ? movingCover(record, cache) : null;
    return moving ? { ...moving, posterPath: hand.filePath } : hand;
  }

  // A video pulled from the post itself outranks the poster image that page
  // published, which is only a still of the same thing.
  if (record.source) {
    const fromSource = cache.get(sourceVideoKeyFor(record.source));
    if (fromSource?.file) {
      const cover = localCover(fromSource);
      if (cover) return cover;
    }
  }

  const media: CanonicalMedia[] = dedupeMedia(record.media);

  // A known video host's page URL (a YouTube /embed/, say) is a document,
  // not a stream: a <video> pointed at it can only error, and the wall then
  // drops the tile. The cache records that failure once archiving has tried,
  // but a vault opened for the first time has no cache at all, so a cover
  // must never lean on it being there. The page's thumbnail is remembered
  // instead, to stand in only when no real media follows.
  let pageThumbnail: string | null = null;

  for (const item of media) {
    const outcome = coverForMedia(item, cache);
    if (outcome.kind === "cover") return outcome.cover;
    if (outcome.kind === "page-thumbnail") pageThumbnail ??= outcome.url;
  }

  // Nothing usable inline. Fall back to whatever the source page itself
  // publishes as its preview image.
  if (record.source) {
    const pageEntry = cache.get(normalizeUrl(record.source));
    if (pageEntry?.file) {
      const cover = localCover(pageEntry);
      if (cover) return cover;
    }
    if (!pageEntry?.failed) {
      // Known video hosts resolve to a thumbnail with no page fetch, so those
      // tiles are correct on first paint rather than after a background pass.
      const known = knownHostThumbnail(record.source);
      if (known) return remoteCover(known.url, "image");
    }
  }

  return pageThumbnail ? remoteCover(pageThumbnail, "image") : null;
}

/**
 * @param failedSignatures covers that could not be loaded, keyed by note
 * path. Matched on signature rather than path, so a clipping whose cover
 * later changes (archiving replaces a dead remote URL with a local file)
 * comes back instead of staying hidden for the rest of the session.
 */
export function buildTiles(
  records: ClippingRecord[],
  cache: MediaCache,
  failedSignatures?: ReadonlyMap<string, string>
): TileModel[] {
  const tiles: TileModel[] = [];

  for (const record of records) {
    // A clipping with no picture used to be dropped here, which meant the
    // note existed in the vault and nowhere else. It gets a tile of its own
    // words instead.
    const cover = pickCover(record, cache) ?? noteCover(record);
    const signature = signatureOf(cover, record);
    if (failedSignatures?.get(record.path) === signature) continue;
    tiles.push({ id: record.path, record, signature, ...cover });
  }

  return tiles;
}

/**
 * Every media a clipping holds, as tiles, in the order the note lists them.
 *
 * For the detail view's carousel. A post with four pictures saves all four and
 * the wall shows one, so without this the other three exist only as files in
 * the vault. Refs that resolve to nothing are left out rather than shown as a
 * gap: the count on the card has to match what scrolling actually reaches.
 *
 * Every tile carries the note's own path as its id, exactly as the wall's tile
 * does. The actions on the detail pane — open, export, reveal, delete, edit
 * properties — all act on the clipping, not on the picture being shown, and an
 * id that stopped resolving to a file in the vault would break each of them.
 *
 * The page's own preview image is deliberately not a fallback here: it stands
 * in for a clipping with no usable media, which is a cover's job, not a
 * carousel's. A record whose media all fail returns an empty list, and the
 * caller keeps the single cover tile it already has.
 */
export function tilesForRecord(
  record: ClippingRecord,
  cache: MediaCache
): TileModel[] {
  const tiles: TileModel[] = [];

  for (const item of dedupeMedia(record.media)) {
    const outcome = coverForMedia(item, cache);
    if (outcome.kind !== "cover") continue;
    tiles.push({
      id: record.path,
      record,
      signature: signatureOf(outcome.cover, record),
      ...outcome.cover,
    });
  }

  return tiles;
}

/**
 * How many pictures a card stands for, or 0 when it stands for just itself.
 *
 * Counted after dedupeMedia, because a clipper's note routinely names the same
 * image twice — once in `media:` and once in the body — and a badge saying
 * "2" over a single picture is worse than no badge at all. Zero rather than
 * one for the ordinary case, so the caller's test is a truthiness check.
 */
export function mediaCount(record: ClippingRecord): number {
  const count = dedupeMedia(record.media).length;
  return count > 1 ? count : 0;
}

/**
 * Whether a card wears the play mark: it is a video, or it is the cover of
 * one that plays on YouTube.
 *
 * An ordinary YouTube video is not downloaded, so its card is a picture like
 * any other, and nothing on the wall said it was a video until it was opened.
 * The same mark a downloaded clip wears says it here too, since both answer
 * the same question: this is something that plays.
 */
export function showsPlayMark(model: TileModel): boolean {
  if (model.kind === "video") return true;
  return model.kind === "image" && watchedOnYoutube(model.record.source);
}

export interface Preview {
  path: string;
  /** True when the path is a url rather than a file in the vault. */
  remote: boolean;
}

/**
 * A still worth putting in a list row, or null when there is none.
 *
 * Rows are small, so the generated still wins wherever one exists: it is a
 * few kilobytes against an original that can be megabytes, and it does not
 * animate, which a forty-pixel row has no business doing. A video has only
 * its poster, since an img cannot hold one.
 */
export function previewOf(tile: TileModel): Preview | null {
  if (tile.posterPath) return { path: tile.posterPath, remote: false };
  if (tile.kind === "video") return null;
  return tile.filePath ? { path: tile.filePath, remote: tile.remote } : null;
}
