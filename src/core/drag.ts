/**
 * Dragging clippings off the wall onto somewhere that files them.
 *
 * A private MIME type rather than `text/plain`: the wall is also a drop target
 * for files and links from outside, and a drag carrying plain text would be
 * read by its own drop handler as a URL to clip. A type nothing else uses is
 * how a drag from the wall is told from a drag into it.
 */

/** The data type a wall drag carries. Paths, one per line. */
export const DRAG_TYPE = "application/x-goko-clippings";

/** The payload for a set of clipping paths. */
export function dragPayload(ids: readonly string[]): string {
  return ids.join("\n");
}

/**
 * Which clippings a drag from this tile is about.
 *
 * A tile inside the selection drags the whole selection, which is what makes
 * filing a dozen cards one gesture. A tile outside it drags itself alone and
 * leaves the selection be: dragging one card is not a way of saying the
 * others were a mistake.
 */
export function dragSet(id: string, selected: readonly string[]): string[] {
  return selected.includes(id) ? [...selected] : [id];
}
