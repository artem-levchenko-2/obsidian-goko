# Changelog

All notable changes to Goko are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Grids no longer lose their icons, colours and order when Obsidian starts.
  While Obsidian lists a vault it reports every folder as new, and Goko
  rebuilt its list of grids on each of those, from a folder tree that did
  not have them all yet: it dropped the rest and brought each back plain as
  its folder was listed. It now waits for the vault to be listed, and a
  grid whose folder goes and comes back returns as it was.
- A device that had not read the vault's grids, or held a copy days old, can
  no longer replace them for every device. The shared file now says which
  configurations its writer had seen, and one written without having seen
  this device's is merged into it instead. This replaces the revision number
  1.0.4 added, which such a device could count past.

## [1.0.5] - 2026-09-26

### Added

- A folder can become a grid, and a grid a folder on another grid. Drag a
  folder out between the grids in the rail, or drop a grid onto another grid
  or between its folders; or use Make it a grid in a folder's menu and Make it
  a folder in the grid's. The new grid keeps its old grid's icon and colour. A
  grid with folders of its own is refused, with the reason. Undo reverses
  either.
- Dropping a folder onto the middle of another grid's row moves it there.

### Fixed

- Moving a folder to another grid with grids following folders no longer
  leaves the empty folder behind, which put it straight back on the grid it
  had left.

## [1.0.4] - 2026-09-26

### Fixed

- A device that had not yet read the vault's grids can no longer paint every
  grid plain for every device. With grids following folders, such a device
  built the list from the folders alone and published it, and the icons and
  colours of every grid went in one sync. A plain list now only replaces one
  with looks when it was written after it; otherwise the looks are kept and
  sent back out, and each device keeps a copy of the last looks it saw to
  restore them from after being closed.
- Opening a grid or folder whose icon is not in the picker and pressing Save
  no longer resets its icon. The picker offers it under Current.
- The inbox no longer proposes every card for the smallest grid. The
  "clippings" tag the web clipper and Goko write on every card, and any tag
  that every grid carries, no longer counts as a reason to file a card.

### Changed

- The icon picker offers 288 icons in 24 groups, up from 120, adding style,
  home, tools, vehicles, fantasy, devices, drawing, food, feelings, the
  outdoors, science, reading, people and sport.
- The panel of card details opens for one selected card only. With several
  selected it only covered the wall's last column, where the cards still to
  be added to the selection were, and every action for several cards is on
  the selection bar.

## [1.0.3] - 2026-09-25

### Fixed

- A page whose title starts with a dot or an underscore is no longer saved
  as a note nobody can see. A leading dot made the file hidden to Obsidian,
  and a leading underscore made the wall skip it; both are dropped from the
  front of the name now, as are dots at the end, which Windows refuses.
- On a Mac or Windows, a clipping whose title differs from an existing one
  only in case is saved as "Name 2" instead of failing with "File already
  exists". Moving a note into a folder counts names the same way.
- A Pinterest picture uploaded as a PNG or a WebP keeps its transparency.
  Goko saves the original when it has see-through pixels, and Pinterest's
  JPEG, a fraction of the size, when it has none. A HEIC photo is saved as
  that JPEG instead of failing to download.
- A pin whose address ends in letters and digits rather than a number is
  recognised as a pin: a public one is clipped with its picture, and clipping
  one twice finds the first.
- A pin Pinterest shows only to a signed-in reader is saved as its address,
  titled "Pinterest pin", instead of a scan of Pinterest's front page.

## [1.0.2] - 2026-09-24

### Changed

- The plugin's description says what Goko does in the directory's 200
  characters.
- The license file is the GPL-3.0 text as published, so GitHub and the
  plugin directory recognise it; the copyright notices moved to NOTICE.
- Cards no longer use the CSS `:has()` selector, which made the browser
  recheck every card whenever one changed.

## [1.0.1] - 2026-09-24

### Fixed

- A desktop left open no longer erases what a phone recorded about the media
  it downloaded. Each device reads the other's record before writing its own,
  so posters and sizes made on one device are kept on the other.
- The wall no longer zooms under two fingers on a phone, as it already did not
  on a desktop; the tile sizes are how it shows more or less.

## [1.0.0] - 2026-09-24

First public release.

### The wall

- Every clipping in a folder laid out as a pannable, scalable masonry wall, on
  desktop and on a phone, at five tile sizes.
- A click picks a card and a panel down the right says what it is: its picture,
  its palette, its name, its source, its categories as chips you edit in place,
  a summary and a note of your own. The full screen — zoom, pan, the whole
  reel — is a button in it.
- A card shows what kind of thing it is in one corner, how many pictures it
  holds in the other, and the folder it is filed in along the bottom. Hovering
  swaps those for its name and its categories; sweeping across it steps through
  its pictures without opening anything.
- A rail down the left lists the library, the inbox, and every grid with its
  folders and how much each holds. Drop a card on a row to file it; drag the
  rows themselves to put them in order.
- One dock at the foot of the wall: clip, search, filter, the grid's own
  settings and a bell for notifications, with a second bar that rises beside it
  when something is selected.
- An empty wall says how to begin, and a start-here note in the vault walks
  through the rest.

### Clipping

- Paste or drop a link, picture, video, PDF or markdown file anywhere on the
  wall, or clip from a phone's share sheet. A note dropped on a grid is filed
  there.
- Posts from Instagram, X, Threads, Pinterest and YouTube arrive with their
  pictures and their video. Carousels come whole and uncropped, and a YouTube
  video too long to download keeps its cover and a button to watch it there.
- An article's own text and a PDF's own text are read into the note, so the
  search finds a clipping by words that are inside it rather than only by its
  title.
- A link with no picture becomes a card of its own words rather than nothing.
- HEIC photos from an iPhone get a picture the wall can show.

### Filing

- Grids, folders inside them, and smart views that collect by rule.
- The inbox can lay itself out by where each clipping probably belongs, read
  from its categories, its domain and rules you write. Nothing moves until you
  say so.
- Domain rules give every clipping from a site the same categories, as it is
  saved or all at once.
- Grids and folders travel between devices through one note in the vault.

### Media

- Every picture and video copied into the vault, so a clipping survives the page
  it came from being deleted. Turned off, only what you clip in Goko is saved.
- Video plays on hover and returns to its cover when the pointer leaves; any
  frame can be made that cover.
- A phone gets a video it cannot fetch itself, and the pictures for it, the next
  time a desktop opens the vault.
- yt-dlp and ffmpeg, the two optional video tools, install from the settings
  with one button, through Homebrew on a Mac or winget on Windows.

### Optional

- A summary and categories written into a clipping's frontmatter by a model,
  with your own API key or the Claude Code CLI already on your machine. Off by
  default. What arrived from another device while the computer was closed can
  be described when it opens, or offered under the bell first.
- Reminders that bring a clipping back on a date you choose.
