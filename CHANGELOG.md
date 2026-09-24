# Changelog

All notable changes to Goko are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
