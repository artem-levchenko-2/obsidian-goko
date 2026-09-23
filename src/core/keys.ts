/**
 * Whether a keystroke is a given Latin letter, on any keyboard layout.
 *
 * `event.key` is what the layout produces: on a Ukrainian layout ⌘K arrives
 * as "л", and every `key === "k"` in the plugin silently missed it — the
 * digits beside it matched, since digits are the same everywhere, which is
 * how the miss hid for so long. `event.code` names the physical key and does
 * not change with the layout, so both are accepted: the letter for layouts
 * where the key produces it, the code for the ones where it does not.
 */
export function keyIs(event: { key: string; code?: string }, letter: string): boolean {
  const want = letter.toLowerCase();
  if (event.key.toLowerCase() === want) return true;
  return event.code === `Key${want.toUpperCase()}`;
}
