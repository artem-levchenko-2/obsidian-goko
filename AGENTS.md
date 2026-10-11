# Working on Goko

Goko is an Obsidian plugin: a pannable, scalable wall of web clippings, with
their media downloaded into the vault. TypeScript, bundled with esbuild,
tested with vitest. Desktop and mobile.

This file is for anyone changing the code, human or agent.

## Commands

```bash
npm ci              # install
npm test            # vitest, every test in tests/
npm run lint        # eslint with the official Obsidian rules
npm run build       # tsc --noEmit, then a production bundle into dist/
npm run dev         # watch; set VAULT_PLUGIN_DIR to write into a vault's plugin folder
```

**Done means all three are green:** `npm test && npm run lint && npm run build`.
Lint is at zero problems and stays there — it is the same rule set the
Obsidian community directory runs on every submission.

## Layout

| where | what |
| --- | --- |
| `src/core/` | pure logic, **no `obsidian` imports** — parsing, layout, rules, anything testable |
| `src/*.ts` | the Obsidian shell: views, DOM, vault, network, commands |
| `tests/` | vitest, mostly against `src/core/` |
| `styles.css` | every selector scoped under the plugin's own classes |
| `media/` | README screenshots and their brief |

Keep that boundary. If a function can be written without Obsidian, it belongs
in `src/core/` with a test beside it; the shell calls it.

Clipping a link runs through `src/capture.ts` (which route a URL takes),
`src/core/resolve.ts` (URL matchers and response parsers for each service) and
`src/archive-service.ts` (downloading media, including video through `yt-dlp`
when it is installed).

## Rules

**Every action is a visible button.** Nothing may be reachable only by a
shortcut, and no command registers a default hotkey — a plugin that ships
chords takes them from whatever the person already bound.

**Popout windows.** Use the owning element's document (`el.doc`) or
`activeDocument`, never the bare `document` global. Add a listener and remove
it on the same document object. The lint rule enforces this.

**DOM.** `createEl` / `createDiv`, never `innerHTML`. UI text in sentence case.

**CSS stays scoped.** No bare element selectors, nothing declared on `:root`.
Every class, custom property and animation name starts with `goko-`. A
shorter prefix is one other plugins use too, and two plugins that share a
class restyle each other in the same vault; animation names are global, so
the later stylesheet also replaces the other's animations.

**Network.** Requests go to the service being read, under the plugin's own
User-Agent — never one pretending to be another client. The one third party is
`api.fxtwitter.com`, and `PRIVACY.md` says so. A new host means a line in
`PRIVACY.md` in the same change.

**Undocumented endpoints degrade, they do not break.** Instagram's and
Threads' embeds, Pinterest's pin resource and Obsidian's bundled `/lib/` files
are not APIs. Each use falls back to the page's `og:image`, so a change on
their side returns a clip to a lesser picture instead of losing it.

**Attribution lives in `NOTICE` only.** It carries the copyright notices and
the statement of what this program is a modified version of. `LICENSE` is the
GPL's own text, unaltered, so that GitHub and the plugin directory recognise
it. Do not add names, links or credits for other projects anywhere else in
the repository, commit messages included.

**Test data is synthetic.** No real handles, post codes, CDN ids, email
addresses or anyone's personal data in fixtures. Keep the shape — same length,
same character classes — and invent the values.

## Gotchas

**Lint disables.** An inline disable of any `obsidianmd/*` rule (or
`no-console`) is itself an error under the directory's config — fix the code.
Any other disable needs a `-- reason`.

**New parts get new class names.** Reusing an existing class inherits its
rules: a card sheet once shared one with the note card, whose layer lets every
click through, and nothing inside the sheet could be clicked.

**Vault events at start-up.** While Obsidian lists the vault it reports every
folder and file as created, one at a time. Anything that rebuilds state from
the folder tree starts in `workspace.onLayoutReady`, or it saves a half-seen
vault — that is how grids once lost their icons and order on every launch.

**`minAppVersion` stays at 1.13.0** or above: the settings tab uses
`SettingDefinition`, which first appears there.

**A second Obsidian for testing** (macOS) runs with its own `HOME`, its own
`--user-data-dir` and `--use-mock-keychain`, opened in the background
(`open -g`). Obsidian rebinds `~/.obsidian-cli.sock` under `HOME` at start-up
and would take it from the instance already running; an empty `HOME` without
the mock keychain makes Electron ask to reset the login keychain; a focused
window catches whatever is being typed or dictated.

**Phone checks.** To see what the phone clips on its own, keep the desktop app
closed — otherwise the desktop finishes the downloads and hides the gap.

## Releasing

1. Changes collect under `## [Unreleased]` in `CHANGELOG.md` as they land.
2. Bump `version` in `manifest.json` and `package.json`, add
   `"X.Y.Z": "<minAppVersion>"` to `versions.json`, rename the heading to
   `## [X.Y.Z] - YYYY-MM-DD`, and commit as `Goko X.Y.Z`.
3. The tag is the bare version (`1.0.10`, no `v`): the directory matches it
   against `manifest.json`.
4. `gh release create X.Y.Z dist/main.js dist/manifest.json dist/styles.css
   --target main --title "Goko X.Y.Z" --notes-file <that CHANGELOG section>`.
5. `.github/workflows/attest.yml` rebuilds from the tag, checks that the
   uploaded `main.js` and `styles.css` match byte for byte, and attests them.
   A red run means the assets are not what the tag builds.

## Style

Comments explain *why*, in full sentences, and match the density of the code
around them. They describe the code as it is now: when behaviour changes, the
comment changes with it.

Commit messages have a short subject and a body that says what was wrong and
why the change is right, not a list of files.
