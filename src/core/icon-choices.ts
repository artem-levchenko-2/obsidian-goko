/**
 * Which icons a grid or a folder can be given, in the order the picker
 * offers them.
 *
 * A fixed palette rather than a free-text lucide id: a mistyped id renders
 * nothing at all, and the user would have no way to tell that from an icon
 * that simply looks blank. The sheet's swatch painter refuses to draw an
 * empty one, so a bad name here shows up as a missing swatch during review
 * rather than shipping as a hole in the grid.
 */

/**
 * The icons on offer, in captioned groups of twelve: two rows of six each,
 * so the keyboard's row arithmetic stays true across a caption. Order is
 * presentation only, since a grid stores the icon's name. Nothing should be
 * removed all the same: a grid carrying an icon that left the list keeps it,
 * offered under its own caption by offeredIcons, but cannot get it back once
 * another is picked.
 *
 * Every name here is one Obsidian ships. One it does not draws an empty
 * swatch, which is the whole of the failure, but it is still a hole.
 */
export const ICON_GROUPS: ReadonlyArray<{ title: string; icons: readonly string[] }> = [
  {
    title: "Marks",
    icons: ["layout-grid", "star", "heart", "bookmark", "pin", "tag",
      "flag", "check-circle", "circle", "square", "triangle", "hexagon"],
  },
  {
    title: "Containers",
    icons: ["folder", "archive", "package-open", "layers", "library", "sticky-note",
      "box", "briefcase", "inbox", "clipboard", "database", "hard-drive"],
  },
  {
    title: "Media",
    icons: ["image", "camera", "film", "music", "palette", "paintbrush",
      "video", "mic", "headphones", "tv", "radio", "disc"],
  },
  {
    title: "Making",
    icons: ["code", "terminal", "monitor", "flask-conical", "wrench", "scissors",
      "hammer", "pen-tool", "ruler", "cpu", "git-branch", "bug"],
  },
  {
    title: "Ideas",
    icons: ["lightbulb", "sparkles", "zap", "flame", "compass", "book-open",
      "brain", "rocket", "target", "trophy", "award", "key"],
  },
  {
    title: "Places",
    icons: ["home", "map", "map-pin", "globe", "building", "landmark",
      "mountain", "tent", "plane", "car", "train", "ship"],
  },
  {
    title: "Life",
    icons: ["user", "users", "coffee", "utensils", "shirt", "watch",
      "gift", "cake", "dumbbell", "bike", "bed", "baby"],
  },
  {
    title: "Nature",
    icons: ["sun", "moon", "cloud", "umbrella", "leaf", "flower",
      "tree-pine", "bird", "cat", "dog", "fish", "snowflake"],
  },
  {
    title: "Work",
    icons: ["shopping-cart", "shopping-bag", "credit-card", "wallet", "banknote", "receipt",
      "calendar", "clock", "mail", "phone", "calculator", "percent"],
  },
  {
    title: "Play",
    icons: ["gamepad-2", "dice-5", "puzzle", "ghost", "smile", "party-popper",
      "medal", "swords", "drum", "guitar", "piano", "joystick"],
  },
  {
    title: "Style",
    icons: ["glasses", "gem", "crown", "footprints", "ribbon", "backpack",
      "handbag", "diamond", "venetian-mask", "sparkle", "spray-can", "wand"],
  },
  {
    title: "Home",
    icons: ["sofa", "armchair", "lamp", "lamp-desk", "lamp-floor", "bath",
      "bed-double", "door-open", "refrigerator", "washing-machine", "fence", "heater"],
  },
  {
    title: "Tools",
    icons: ["drill", "pickaxe", "shovel", "axe", "paint-roller", "paint-bucket",
      "pencil-ruler", "cog", "nut", "construction", "hard-hat", "magnet"],
  },
  {
    title: "Vehicles",
    icons: ["car-front", "truck", "bus", "tractor", "motorbike", "scooter",
      "sailboat", "anchor", "helicopter", "plane-takeoff", "caravan", "fuel"],
  },
  {
    title: "Fantasy",
    icons: ["sword", "shield", "wand-sparkles", "skull", "castle", "scroll",
      "dices", "chess-knight", "chess-king", "spade", "club", "hourglass"],
  },
  {
    title: "Devices",
    icons: ["smartphone", "laptop", "keyboard", "mouse", "printer", "server",
      "wifi", "bluetooth", "usb", "battery", "plug", "webcam"],
  },
  {
    title: "Drawing",
    icons: ["pen", "pencil", "brush", "shapes", "frame", "spline",
      "type", "eraser", "pipette", "blend", "swatch-book", "sticker"],
  },
  {
    title: "Food",
    icons: ["pizza", "apple", "cherry", "cookie", "croissant", "ice-cream-cone",
      "wine", "beer", "cup-soda", "salad", "soup", "chef-hat"],
  },
  {
    title: "Feelings",
    icons: ["laugh", "frown", "angry", "meh", "annoyed", "smile-plus",
      "heart-crack", "heart-handshake", "hand-heart", "handshake", "thumbs-up", "bot"],
  },
  {
    title: "Outdoors",
    icons: ["flower-2", "trees", "tree-palm", "waves", "sunrise", "rainbow",
      "rabbit", "turtle", "squirrel", "paw-print", "feather", "sprout"],
  },
  {
    title: "Science",
    icons: ["atom", "dna", "microscope", "telescope", "test-tube", "flask-round",
      "orbit", "satellite", "earth", "sun-moon", "cloud-lightning", "sigma"],
  },
  {
    title: "Reading",
    icons: ["file-text", "notebook", "notebook-pen", "newspaper", "book", "book-marked",
      "scroll-text", "quote", "link", "files", "folder-open", "languages"],
  },
  {
    title: "People",
    icons: ["user-round", "users-round", "hand", "hand-metal", "person-standing", "contact",
      "venus", "mars", "graduation-cap", "school", "briefcase-business", "accessibility"],
  },
  {
    title: "Sport",
    icons: ["volleyball", "goal", "timer", "activity", "heart-pulse", "biceps-flexed",
      "mountain-snow", "tent-tree", "ship-wheel", "fish-symbol", "flag-triangle-right", "stars"],
  },
];

export const GRID_ICONS: readonly string[] = ICON_GROUPS.flatMap((group) => [...group.icons]);

/**
 * The icons the picker offers for a grid or folder that has `current`, each
 * group captioned on its first icon.
 *
 * An icon the list does not have — set before it was trimmed, in another
 * build, or written into the shared file by hand — is offered last, under
 * its own caption. Without it the picker had nothing to mark as chosen and
 * marked the first icon, so opening a grid to rename it and pressing Save
 * quietly made it a plain grid.
 */
export function offeredIcons(current: string): Array<{ name: string; heading?: string }> {
  const out: Array<{ name: string; heading?: string }> = ICON_GROUPS.flatMap((group) =>
    group.icons.map((name, index) => (index === 0 ? { name, heading: group.title } : { name }))
  );
  if (current && !GRID_ICONS.includes(current)) out.push({ name: current, heading: "Current" });
  return out;
}

/** Where `current` sits in offeredIcons, so the picker opens on it. */
export function iconIndex(current: string): number {
  const at = GRID_ICONS.indexOf(current);
  if (at >= 0) return at;
  return current ? GRID_ICONS.length : 0;
}

/**
 * The icons whose names hold what was typed, in the list's own order. Words
 * are joined the way icon names are, so "paint bucket" finds paint-bucket.
 */
export function iconsMatching(query: string): string[] {
  const words = query.trim().toLowerCase().replace(/\s+/g, "-");
  return words ? GRID_ICONS.filter((name) => name.includes(words)) : [...GRID_ICONS];
}
