import { setIcon } from "obsidian";

/**
 * Sets an icon, falling back through a list of names until one draws.
 *
 * `setIcon` appends nothing and says nothing when it does not know a name, so
 * a renamed glyph leaves a blank square and no error anywhere. That is not
 * hypothetical: Lucide renames icons between versions — `filter` became
 * `funnel`, `list-checks` and `layout-grid` have both moved — and Obsidian
 * bundles whichever version it was built against, which is never today's.
 *
 * So a name is offered, the element is checked for an SVG, and the next name
 * is tried if none arrived. Pass names newest first: the design names the
 * glyph it wants, and the older aliases are what make it land on whatever
 * this Obsidian actually ships.
 *
 * Returns the name that drew, or "" when none of them did — which is worth
 * logging rather than shrugging at, since the button is then invisible.
 */
export function setGlyph(element: HTMLElement, ...names: string[]): string {
  for (const name of names) {
    element.empty();
    setIcon(element, name);
    if (element.querySelector("svg")) return name;
  }
  element.empty();
  console.warn("Goko: no icon drew for any of", names);
  return "";
}
