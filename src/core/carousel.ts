/**
 * Walking the media of one clipping.
 *
 * A post with four pictures is one note and one card, so the other three are
 * only reachable from inside the detail view. This is the arithmetic of that
 * walk, kept away from the DOM so it can be tested without a stage.
 */

import type { TileModel } from "./tile";

/**
 * How far a finger must travel before it counts as a swipe rather than a tap
 * that wobbled. In CSS pixels, and generous: the stage is also pannable when
 * zoomed, so a small drag belongs to the picture, not to the reel.
 */
export const SWIPE_MIN = 48;

/**
 * How much straighter than tall a swipe must be to read as sideways.
 *
 * A gesture that is mostly vertical is a scroll of the details panel, and one
 * that is diagonal is ambiguous; requiring the horizontal leg to be the longer
 * of the two keeps an ambiguous drag from turning the page under the reader.
 */
const SWIPE_RATIO = 1.2;

/**
 * The next index, wrapping at both ends.
 *
 * Wrapping rather than stopping: the reel is a handful of pictures from one
 * post, not a list with a meaningful end, and a reader holding the arrow down
 * to get back to the first one should not have to change direction. A count of
 * one wraps to itself, so a lone picture cannot go anywhere.
 */
export function stepIndex(index: number, count: number, direction: -1 | 1): number {
  if (count <= 0) return 0;
  return (((index + direction) % count) + count) % count;
}

/**
 * Where in the reel the card's own cover sits, or 0 when it cannot be found.
 *
 * Matched on signature rather than on path, because every tile in the reel
 * carries the same note path: the signature is what says which picture. The
 * wall's cover is the first ref that resolved, so this is normally 0 and the
 * search is insurance — a cover set by hand in frontmatter, or one adopted
 * from the source page, is not in the reel at all, and opening at the start is
 * the honest answer for both.
 */
export function indexOfTile(tiles: readonly TileModel[], current: TileModel): number {
  const found = tiles.findIndex((tile) => tile.signature === current.signature);
  return found === -1 ? 0 : found;
}

/**
 * Which way a drag turns the reel, or null when it does not.
 *
 * Sideways is inverted the way every photo viewer inverts it: dragging the
 * picture leftwards brings the next one in from the right.
 */
export function swipeDirection(dx: number, dy: number): -1 | 1 | null {
  if (Math.abs(dx) < SWIPE_MIN) return null;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return null;
  return dx < 0 ? 1 : -1;
}

/**
 * Which frame the pointer is over, when a card's width is read as a row of
 * invisible segments.
 *
 * The cursor does not drag anything: crossing into a segment shows that
 * segment's picture, which reads as scrubbing without any of a drag's
 * bookkeeping. Four pictures across a 300px card is 75px per frame, wide
 * enough to land on deliberately and narrow enough that one sweep of the wrist
 * sees all four.
 *
 * Clamped rather than wrapped: a pointer at the very edge, or a rect measured a
 * frame late, must not roll around to the far end of the reel.
 */
export function segmentIndex(offsetX: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0;
  const segment = Math.floor((offsetX / width) * count);
  return Math.min(count - 1, Math.max(0, segment));
}

/** `2 / 4`, or empty when there is nothing to count through. */
export function reelLabel(index: number, count: number): string {
  return count > 1 ? `${index + 1} / ${count}` : "";
}
