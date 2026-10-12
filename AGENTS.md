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
`.github/workflows/tests.yml` runs the same three on every push to a branch
that changes more than Markdown or `media/`.
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

**`main` is what people install.** Obsidian reads `manifest.json` on `main` to
learn the newest version and shows the `README.md` there on the plugin's page,
and a clone builds whatever `main` holds. So no change goes there straight
away: it lives in the release's branch, `release-X.Y.Z`, as a commit of its
own (push it, and CI tests it), another agent reviews the branch in a fresh
session, and it reaches `main` as a fast-forward once the maintainer
approves. A change too large to review with the rest of a release gets a
branch of its own. No squash: commits keep their authors. If `main` has moved on meanwhile, rebase the branch onto
`origin/main`, push it again and wait for CI; a rebase that changed code needs
a new review.

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

1. Changes collect under `## [Unreleased]` in `CHANGELOG.md`, each in the
   commit that makes it.
2. Bump `version` in `manifest.json` and `package.json`, add
   `"X.Y.Z": "<minAppVersion>"` to `versions.json`, rename the heading to
   `## [X.Y.Z] - YYYY-MM-DD`, and commit as `Goko X.Y.Z`: the last commit of
   the release's branch.
3. Once the maintainer approves it, bring `main` up to date (`git fetch
   origin`, `git merge --ff-only origin/main` on `main`), fast-forward it to
   the branch (`git merge --ff-only <branch>`), tag it with the bare version
   (`1.0.10`, no `v`: the directory matches it against `manifest.json`), build
   from a clean tree with `npm ci && npm run build`, and push both in one go:
   `git push --atomic origin main X.Y.Z`. A tag can be neither moved nor
   deleted on GitHub, so without `--atomic` a rejected `main` would leave the
   version spent on a commit `main` never gets.
4. Publish the release straight away, with the changelog section as notes,
   each bullet on one line (GitHub keeps the line breaks of release notes):

   ```bash
   n=$(mktemp)
   awk '/^## \[X.Y.Z\]/ {f = 1; next} /^## \[/ {f = 0} f' CHANGELOG.md |
     perl -0pe 's/(?<=\S)\n +(?![-*+] |\d+[.)] )(?=\S)/ /g' > "$n"
   test -s "$n" && gh release create X.Y.Z dist/main.js dist/manifest.json dist/styles.css \
     --verify-tag --title "Goko X.Y.Z" --notes-file "$n"
   ```

   Obsidian and the directory take the version from `manifest.json` on `main`
   and the files from the release with that tag; until the release is up, an
   update finds nothing to download.
5. `.github/workflows/attest.yml` rebuilds from the tag, checks that the
   uploaded `main.js` and `styles.css` match byte for byte, and attests them.
   A red run means the assets are not what the tag builds.

## Style

Comments explain *why*, in full sentences, and match the density of the code
around them. They describe the code as it is now: when behaviour changes, the
comment changes with it.

Commit messages have a short subject and a body that says what was wrong and
why the change is right, not a list of files.
