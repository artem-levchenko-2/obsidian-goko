import { DRAG_TYPE } from "./drag";

/**
 * Where a file let go over a card lands: on that card as its cover, or on the
 * wall as a new clipping.
 *
 * Only the card's lower band takes a cover; the rest of it is wall like any
 * other. A card that claimed every drop over it left a full wall with nowhere
 * to add a clipping, because a full wall is nearly all cards.
 *
 * On a phone no card takes a cover by drag at all. The band was still in the
 * way there: a phone's cards are small, the band's fingertip minimum is much
 * of each one, and a picture dragged in kept landing as a cover when a new
 * clipping was wanted. The card's menu sets a cover on a phone, and every
 * drop there is a clipping.
 *
 * Pure, and in screen pixels throughout. The wall zooms, and the band has to
 * be big enough for the finger that is actually over it, not for the card's
 * size before the camera scaled it.
 */

/**
 * The shortest the band is allowed to be, which is the smallest touch target
 * the platform guidelines allow. A third of a small card is less than a
 * fingertip, and a target that needs aiming is one a person misses.
 */
export const COVER_BAND_MIN = 44;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export type CoverDropTarget = "cover" | "clip";

/**
 * Whether a file of this MIME type can be a card's cover.
 *
 * A picture or a video, the two the Set cover picker offers. A PDF counts as
 * a picture everywhere else on the wall, because it is shown as its first
 * page, but a document dropped on a card is a document to keep rather than a
 * picture for the card, and it goes to the wall as a clipping of its own.
 */
export function isCoverType(mime: string): boolean {
  const key = mime.split(";")[0].trim().toLowerCase();
  return key.startsWith("image/") || key.startsWith("video/");
}

/**
 * Whether a drag in flight may be carrying a cover, so that a card should
 * offer its band.
 *
 * `types` is the drag's own list and `fileTypes` the MIME of each file item.
 * Only a file from outside: a card dragged across the wall carries DRAG_TYPE
 * and means "file me somewhere", which is the wall's business and not a card's.
 *
 * A file whose type cannot be read yet is given the benefit of the doubt. Not
 * every engine lets a page see the types before the drop, and a band that
 * never showed there would take the gesture away for every picture; the drop
 * reads the real type and hands anything that is not a cover to the wall.
 *
 * `phone` is whether the wall is on a phone, where no drag offers a cover and
 * every drop goes to the wall. A tablet is not a phone: its cards are large
 * enough for the band to be the small target it is on a desktop.
 */
export function offersCover(
  types: readonly string[],
  fileTypes: readonly string[],
  { phone = false }: { phone?: boolean } = {}
): boolean {
  if (phone) return false;
  if (!types.includes("Files") || types.includes(DRAG_TYPE)) return false;
  if (fileTypes.length === 0) return true;
  return fileTypes.some((type) => type === "" || isCoverType(type));
}

/**
 * The band across the foot of a card that takes a cover.
 *
 * A third of the card, so the rest of it is plainly still the wall, but never
 * shorter than a fingertip, and never taller than the card itself.
 */
export function coverBand(card: Box): Box {
  const height = Math.max(0, Math.min(card.height, Math.max(COVER_BAND_MIN, card.height / 3)));
  return { left: card.left, top: card.top + card.height - height, width: card.width, height };
}

/**
 * What a drop at this point over this card would do.
 *
 * The band's edges are inclusive, so a point on the line between the band and
 * the rest of the card is on the band: the band is the smaller target, and
 * the one a person is aiming for when they are that close to it.
 */
export function coverDropTarget(card: Box, point: Point): CoverDropTarget {
  if (!(card.width > 0) || !(card.height > 0)) return "clip";
  const band = coverBand(card);
  const inside =
    point.x >= band.left &&
    point.x <= band.left + band.width &&
    point.y >= band.top &&
    point.y <= band.top + band.height;
  return inside ? "cover" : "clip";
}
