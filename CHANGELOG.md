# Changelog

All notable changes to Goko are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A post on X that shares an X Article saves the article's videos and images,
  in the order the article shows them, and takes its title and description
  from the article. Such a post used to clip with nothing to download and the
  bare link as its title. Of each video, the best copy below 4K is saved:
  4K outgrows the download limit within seconds.
- Goko says when a post's video could not be saved for a reason you can fix,
  naming the clipping: the site turned yt-dlp away, which usually means
  yt-dlp is out of date; the video is over your Maximum file size; or the
  download ran past three minutes. A clip tells you at once, and the pass
  that fills in missing media tells you once at the end. A post with no
  video in it stays quiet, as before.
- SVG pictures get a card. A page whose only picture is an SVG used to be
  clipped without one, and a dropped or pasted SVG saved as a broken PNG.
  The wall paints a picture drawn from the SVG at 1600 px wide, never the
  SVG itself, which as markup could run scripts. An SVG is a clipping's
  picture only when it has no other, the page's own included: in a page, an
  SVG is far more often a logo, an icon or a badge than what the page is
  about.
- On a phone, Save a copy hands a clipping's files to the share sheet, where
  Save Image, Save Video and Save to Files sit beside every app that takes
  them, and Open file opens its picture or video in a tab. Both stand where
  a desktop has Export to Downloads and Show in system explorer: in the
  card's menu, in Search and in the full-screen view. Save a copy appears
  only where the phone's share sheet can take files.

### Changed

- A clipping made in Goko records the time it was added as well as the day,
  as `created: 2026-10-12T14:30:05`, and the wall orders by it, newest first,
  so the clip you just took is the first card. The time is taken when you
  add the clip, not when its downloads finish, and no two clippings get the
  same second: files dropped together stand in the order you dropped them
  in, the first at the top, instead of by title. A note dropped onto the
  wall without a `created` of its own gets the time it was added, where it
  used to go to the very end. A time written with its zone, as Obsidian's
  Web Clipper writes one when set to, sorts by the moment it names. Notes
  that have only the day stand under that day's timed ones, ordered by title
  as before. The details panel shows when a clipping was saved as a date and
  a time in your own format rather than as the raw value.
- Videos on the wall play while the pointer is over them, rather than all at
  once whenever they are in view. Autoplay videos, in the settings, turns
  the old way back on. This is the starting point of a new install: a vault
  that already has Goko keeps what its settings say. On a phone, which has
  no pointer, a video plays once its card is open.
- A new install starts with no AI provider picked. It used to show OpenAI
  picked with no key, which looked set up when it was not. Until a provider
  is picked, AI descriptions show only that choice, and Describe says where
  to make it. A vault that already has Goko keeps its provider.
- A new install lets you add and remove tags in the details panel and the
  property menus, as Obsidian's own property editor does. Turn off Let Goko
  edit tags for a vault where only the Web Clipper writes them. A vault
  that already has Goko keeps its setting.
- A new install comes with three rules under Properties by domain: a
  clipping from Dribbble or Behance gets `categories: design`, one from
  GitHub `categories: code`. The box used to start empty, so a rule was
  something you read about before you saw one work. They are ordinary
  rules, to change or delete. A vault that already has Goko keeps its own.

### Fixed

- The wall does less work as you move over it and change the tile size. The
  pills a card shows on hover no longer keep a layer of their own on every
  card while hidden, and a step between tile sizes restyles each card's
  frame alone, not every pill and picture inside it.
- A card no longer pauses before it lifts the first time it is hovered. The
  lift's shadow is already there at rest, transparent, and the lift scales
  both sides by one factor, so its rounded corners stay round.
- An Instagram post that Instagram will not show, because it is private or
  was removed, is saved as a link titled "Instagram post" with a notice
  that says so. It used to be saved "without a picture" under the title
  "Instagram", and on a desktop as a picture of Instagram's sign-in page.
- A clip made while a folder is open is flown to, as any other clip is,
  when grids follow the folders on disk. Filing it into the folder moved the
  note, and the wall kept looking for it where it had been.
- A video Goko did not download itself, such as one dropped onto the wall,
  embedded in a note by hand or set as a card's cover, shows on its card
  and plays like any other. Such a card used to show only its title, or a
  blank frame for a cover: a card shows a video by a still of it, and only
  a video Goko had downloaded was given one.
- With Autoplay videos off, a GIF moved by itself. It rests on its still
  now and plays while the pointer is over it, as a video does, and a GIF
  dropped onto the wall, embedded by hand or set as a card's cover gets a
  still to rest on. A GIF over 8 MB stays on its still on the wall, as it
  was always meant to, since playing it costs more than the motion is
  worth; it plays once its card is open.
- A GIF picked on the wall showed only a still in the side panel, the one
  made for list rows. It plays there now, as a video does.
- A large video is no longer read into memory whole to make its still,
  which on a phone could close Obsidian: a video dropped onto the wall can
  be any size. Over 128 MB on a phone and 512 MB on a desktop, the still is
  left to a desktop with ffmpeg. And a file that cannot be read no longer
  stops Goko making stills for every file after it.
- On a phone, Search offers Describe with AI and File as suggested for the
  selected cards again. Both had been left out with the actions that need a
  desktop's file system, which they do not.
- Goko and another plugin that used the same class names no longer restyle
  each other when both are on in one vault. With both on, Goko's bar shrank
  to an empty strip and card captions moved to the top. If you style Goko
  with a CSS snippet, its classes now start with `goko-` instead of `pg-`.

## [1.0.10] - 2026-09-28

### Changed

- Search narrows the wall instead of opening a list. The search button grows
  into a field in the bar, and as you type the wall keeps the cards that
  match, from the whole library and from inside folders. The rail counts the
  matches on each grid and folder, and a click on one searches only there. A
  match opens like any card, the arrows step through the matches, and the
  search stays until you clear it, which takes you back to where you were.
  The list showed eight clippings at most, and a card picked from it that sat
  inside a folder opened as a note.
- A word of four letters or fewer matches only at the start of a word, so
  `cat` no longer finds modification or scattered.

### Fixed

- The library showed only a smart view's cards when it was opened from that
  view.

## [1.0.9] - 2026-09-27

### Fixed

- Everything in a card's sheet can be clicked: the band of wall above it
  and its close shut it, and the bar's buttons, the picture and the details
  answer the pointer with their hover and their tips. All of it was drawn
  but let clicks through to the cards behind, so Select could open the next
  card instead: the sheet shared its class name with the note card, whose
  layer lets every click pass.
- The full screen's bar is built to the dock's measure, the same height,
  padding, spacing, border and hover, instead of a bar of its own.

## [1.0.8] - 2026-09-26

### Added

- Copy image, in a card's right-click menu and in full screen, where a right
  click on the picture and `⌘C` do it too. The whole picture goes to the
  clipboard as a PNG.
- Select in full screen, a button on the bar and `Space`: walk through the
  cards with the arrows, pick the ones you want, and they are still picked on
  the wall when you close it.
- Card details can open as a sheet. With Card details set to Sheet, in the
  settings or the grid's settings menu, a click opens the card in a panel
  that slides up over the wall, the picture beside its details, with a band
  of the wall above it and a close in that band. Cmd-click and a drag still
  pick without opening.
- Deleting a grid or removing a folder asks with a box to tick: unticked, the
  clippings go back to the inbox or the grid; ticked, they go to the trash
  with it, along with the media nothing else uses.

### Changed

- A grid's or a folder's row in the rail has a menu at the pointer, like a
  card's, rather than a panel in the middle of the window. The name is typed
  over in the row, the icon is picked and the description written in a panel
  beside it, the colour is a submenu. New grid and New folder name themselves
  in the rail the same way. On a phone, where there is no rail, the sheets
  stay.

## [1.0.7] - 2026-09-26

### Added

- Descriptions run several at a time, three by default and up to ten with
  Descriptions at once under AI descriptions. Each worker takes the next
  clipping as soon as it is free, so one slow picture no longer holds up a
  batch.
- A describe shows its count at the top of the wall with a Stop button. Stop
  lets the running ones finish and drops the rest.
- A batch stops by itself at the first answer saying the subscription's
  window or the provider's rate limit is used up, and says how many were left,
  instead of failing every remaining clipping in turn.

## [1.0.6] - 2026-09-26

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
