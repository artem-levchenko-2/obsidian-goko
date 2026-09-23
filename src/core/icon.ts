/**
 * The Goko mark: an eye whose pupil is four panels at four proportions, which
 * is the wall itself. Drawn in the design file at 800 square and scaled to
 * the 100 Obsidian's addIcon expects, so the coordinates here are the ones
 * the file holds and nothing was redrawn by hand.
 *
 * Stroked rather than filled, in currentColor, so it takes the theme and sits
 * beside Obsidian's own icons instead of next to them. The transform carries
 * the stroke width down with it: 50 and 40 at 800 are 6.25 and 5 at 100.
 */
export const GOKO_ICON_ID = "goko-mark";

export const GOKO_ICON_SVG =
  "<g transform=\"scale(0.125)\" fill=\"none\" stroke=\"currentColor\" " +
  "stroke-linecap=\"round\" stroke-linejoin=\"round\">" +
  // The eye, drawn heavier than what it is looking at.
  "<path stroke-width=\"50\" d=\"" +
  "M400 675.666C517.667 675.666 627.334 606.332 703.667 486.332C733.667 439.332 733.667 " +
  "360.332 703.667 313.331C627.334 193.331 517.667 123.998 400 123.998C282.333 123.998 " +
  "172.666 193.331 96.3325 313.331C66.3325 360.332 66.3325 439.332 96.3325 486.332C172.666 " +
  "606.332 282.333 675.666 400 675.666Z" +
  "\"/>" +
  // Four panels at four proportions: the wall, seen through it.
  "<path stroke-width=\"40\" d=\"" +
  "M349.001 247H264C254.611 247 247 254.611 247 264V381C247 390.388 254.611 398 264 " +
  "398H349.001C358.389 398 366.001 390.388 366.001 381V264C366.001 254.611 358.389 247 " +
  "349.001 247Z" +
  "\"/>" +
  "<path stroke-width=\"40\" d=\"" +
  "M536.001 247H451.001C441.612 247 434 254.611 434 264V317C434 326.389 441.612 334 451.001" +
  " 334H536.001C545.39 334 553.001 326.389 553.001 317V264C553.001 254.611 545.39 247 " +
  "536.001 247Z" +
  "\"/>" +
  "<path stroke-width=\"40\" d=\"" +
  "M536.001 402.002H451.001C441.612 402.002 434 409.613 434 419.002V536.002C434 545.39 " +
  "441.612 553.002 451.001 553.002H536.001C545.39 553.002 553.001 545.39 553.001 " +
  "536.002V419.002C553.001 409.613 545.39 402.002 536.001 402.002Z" +
  "\"/>" +
  "<path stroke-width=\"40\" d=\"" +
  "M349.001 466H264C254.611 466 247 473.611 247 483V536C247 545.389 254.611 553 264 " +
  "553H349.001C358.389 553 366.001 545.389 366.001 536V483C366.001 473.611 358.389 466 " +
  "349.001 466Z" +
  "\"/>" +
  "</g>";
