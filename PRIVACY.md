# Privacy Policy — Goko

_Last updated: 24 September 2026_

Goko is an Obsidian plugin. It runs entirely on the device it is installed
on and writes only into that device's Obsidian vault.

## Who this covers

One person: whoever installed it. Goko has no accounts and no sign-up, and
every installation is separate from every other — there is nothing that could
join them, because there is nowhere for anything to be joined.

## There is no server

Goko has no backend. Nothing it reads is sent to its author, because there is
nowhere to send it, and every byte it keeps is written to the local Obsidian
vault. Almost every request goes straight from your device to the site being
read; the one exception is named below, and you can switch it off.

## What is accessed, and why

**Web pages you clip.** When you clip a link, Goko fetches that page to read
its title, description and preview image, and saves them as a note in your
vault along with a local copy of the picture, so the clipping survives the page
being deleted. For a post on a site that hides its media behind a player, it
reads the same public embed a browser would — Instagram's own, from Instagram,
and Threads' own, from Threads. A Pinterest pin is read from Pinterest itself:
the pin's public data from `www.pinterest.com` (a `pin.it` short link passes
through `api.pinterest.com` on the way there), and its pictures and video from
Pinterest's own servers, `i.pinimg.com` and `v1.pinimg.com`.

**One community mirror, for X.** X does not publish the address of a post's
video to anything but its own player, so Goko asks `api.fxtwitter.com` — a
community service run by neither X nor us — and that request carries the
handle and post id of the link you clipped. Nothing else is sent, and nothing
about you goes with it. This is the setting **Use community media resolvers**
under Settings → Downloads. It is on by default; turn it off and posts from X
fall back to whatever poster image the site gives its own crawlers.

**AI description, if you enable it.** This is off by default and does nothing
until you turn it on. Which way the request goes depends on the provider you
pick:

- **Anthropic** or **OpenAI** — the picture and the text of the clipping go to
  that provider's API under your own account, with the key you supplied, to
  generate a summary and categories.
- **Claude Code** — the same material is handed to the Claude Code CLI already
  installed on your machine, which sends it under whatever account that CLI is
  already signed in as. Goko neither sees nor stores a key in this mode.

**Programs on your machine, if you installed them.** On desktop, Goko runs
`yt-dlp` and `ffmpeg` when it finds them, to archive a video and to pull a
still out of one. If they are missing and you press **Install** under
Settings → Video tools, Goko runs Homebrew (on macOS) or winget (on Windows)
to install them, and that package manager downloads them from its own
sources, as it would from a terminal. Apart from that, Goko runs nothing it
did not find already installed, and nothing on mobile.

## What is stored, and where

Everything Goko keeps lives inside your Obsidian vault and its plugin folder
on your own devices:

- clippings, as plain Markdown notes you can read without the plugin;
- copies of the pictures and videos those clippings point at;
- a rebuildable cache of image dimensions and download outcomes;
- plugin settings.

An API key, if you supplied one, is kept in Obsidian's keychain on the device
you entered it on, encrypted wherever the system offers that. It is not
written into your notes or into the plugin's settings, so it does not travel
with the vault: a service you chose to synchronise the vault with (Obsidian
Sync, iCloud, Dropbox) never holds a copy, and each device is given the key
separately.

## What is shared

Nothing. Goko performs no analytics, no telemetry, no crash reporting and no
advertising, and it has no third-party SDKs.

## Retention and deletion

Data stays until you delete it. Deleting a note, or the vault, removes it.
Removing the plugin removes its settings and anything stored alongside them.

## Children

Goko is not directed at children and collects nothing from anyone.

## Changes

Any change to this policy is a change to this file, in public version control,
with its history visible.

## Contact

Artem Levchenko — artik320@gmail.com
