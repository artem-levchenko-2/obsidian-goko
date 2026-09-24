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

## Style

Comments explain *why*, in full sentences, and match the density of the code
around them. They describe the code as it is now: when behaviour changes, the
comment changes with it.

Commit messages have a short subject and a body that says what was wrong and
why the change is right, not a list of files.
