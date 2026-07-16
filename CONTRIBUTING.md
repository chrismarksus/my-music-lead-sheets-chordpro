# Contributing

Personal ChordPro lead sheet collection (lyrics + inline `[Chord]` notation), one file per
song. This doc covers the repo conventions, how the CI lint check works, and what to do
when it fails.

## Conventions

- **Directives: short forms only.** Use `{t:}` `{st:}` `{c:}` `{soc}`/`{eoc}` `{gc:}`
  `{define:}` `{sot}`/`{eot}` — never the long forms (`{title:}`, `{subtitle:}`,
  `{comment:}`, `{start_of_chorus}`, etc.).
- **Every file needs a `{t:}` title.** Add `{st:}` for artist/subtitle when useful.
- **Directives must open and close on the same line.** A `{gc:...}` or `{c:...}` comment
  can't have a line break in the middle of it — the ChordPro parser reads directives
  line-by-line.
- **Filenames are snake_case**, optionally with hyphen-joined segments for disambiguation,
  e.g. `song_title.chordpro` or `song_title-artist_name.chordpro`.
- **Multiple arrangements cross-reference each other.** If you have
  `amazing_grace.chordpro` and `amazing_grace_ii.chordpro`, each should carry a
  `{c:Alternate arrangement — see also X.chordpro}` comment pointing at the other.
- **Never reflow or trim whitespace inside `{sot}`/`{eot}` blocks** — those are ASCII guitar
  tab diagrams; the spacing is the content.
- **`INDEX.md` is generated, not hand-edited.** Regenerate it whenever you add, rename, or
  retitle a song (from each file's `{t:}`/`{st:}` directives).
- **`NOTICE.md`** documents that song content is copyrighted material used for personal/
  church purposes, not licensed for redistribution — keep that in mind before adding songs.

## How the CI/CD pipeline works

Every push and pull request triggers the **CI** GitHub Actions workflow
(`.github/workflows/lint.yml`), which runs:

```
npm ci
npm run lint
npm run check
```

`npm run lint` runs [`scripts/lint.js`](scripts/lint.js), which checks every `.chordpro` file in
`sheets/` against the rules listed in that file's header comment (parse validity,
required title, banned long-form directives, balanced `{soc}`/`{eoc}` and `{sot}`/`{eot}`
blocks, balanced chord brackets, snake_case filename). The rule list lives in one place —
`scripts/lint.js` — rather than being duplicated here, so it can't drift out of sync with
what the code actually checks.

`npm run check` runs [`scripts/check-consistency.js`](scripts/check-consistency.js), which
checks repo-wide consistency rather than individual files: `INDEX.md` matches the actual
files (no missing/stray rows, no title/artist drift), `{c:...see also X.chordpro}`
cross-references between alternate arrangements point at real filenames, there are no
byte-identical duplicate `.chordpro` files, no unrecognized stray files/directories in the repo
root or in `sheets/`, and every `.chordpro` file is valid UTF-8 with no BOM. As with lint, the
rule list lives in the script's header comment.

If every file passes both checks, CI exits 0 (green). If anything fails, it exits 1 (red)
and prints every violation as `filename:line: message` (or `filename: message` for
whole-file issues).

### Running lint and the consistency check locally before you push

```
npm install    # once, or whenever chordsheetjs version changes
npm run lint
npm run check
```

Fix anything they report, then commit.

### Auto-fix on push

`.github/workflows/lint-autofix.yml` runs on every push that touches `sheets/**`. It runs
`npm run lint:fix` (`scripts/lint.js --fix`), which mechanically rewrites long-form
directives to short-form — the only lint rule that's a pure find-and-replace with no
judgment call. If that changes any files, the workflow commits and pushes the fix back as
`github-actions[bot]`. This mainly covers edits made through the GitHub web editor, where
it's easy to type `{title:}` instead of `{t:}` without a local `npm run lint` to catch it.

Every other lint failure (missing title, bad/missing genre, unbalanced blocks or brackets,
non-snake_case filename, parse error) needs a human to supply or correct content, so
`--fix` leaves those alone and `lint.yml` still reports and fails on them normally.

### What to do when CI fails

Read the failing line from the Actions log or the PR check annotation — it's in
`filename:line: message` form. Fixes by category:

| Failure | Fix |
|---|---|
| `ChordPro parse error` | Usually a directive or `[chord]` bracket that isn't closed on the same line. Check the line number for a stray `[`, `]`, or `{`/`}`. |
| `missing required {t:...} title directive` | Add a `{t:Song Title}` line near the top of the file. |
| `long-form directive "{X:}" found` | Replace it with the short form named in the message (e.g. `{title:}` → `{t:}`). |
| `unbalanced {soc}/{eoc}` or `{sot}/{eot}` blocks | You opened a block without closing it (or vice versa) — add the missing tag. |
| `unbalanced [ ] chord brackets on this line` | A `[Chord]` is missing its `[` or `]` on that line. |
| `filename must be snake_case` | Rename the file to lowercase, underscore-separated words (hyphen-joined segments are OK for `song-artist` disambiguation). |
| `INDEX.md: missing a row linking to X.chordpro` | Add a row for `X.chordpro` to `INDEX.md`. |
| `INDEX.md:N: links to X.chordpro, which does not exist` | Fix or remove that row — the file it points at is gone or renamed. |
| `INDEX.md:N: title/artist "..." doesn't match X.chordpro's {t:.../st:...}` | Someone edited the file's title/subtitle without regenerating `INDEX.md` (or vice versa) — make them match. |
| `cross-reference points at X.chordpro, which does not exist` | Fix the `{c:...see also X.chordpro}` comment — the referenced file was renamed or removed. |
| `X.chordpro: byte-identical to Y.chordpro` | Likely an accidental duplicate — remove one, or add a `{c:}` cross-reference if they're intentionally meant to be identical starting points. |
| `stray file/directory in repo root` | Remove it, or add it to `KNOWN_ROOT_FILES`/`KNOWN_ROOT_DIRS` in `scripts/check-consistency.js` if it's meant to be there. |
| `not valid UTF-8` / `has a UTF-8 byte-order mark` | Re-save the file as plain UTF-8 without a BOM. |

## Adding a new song

1. Copy the structure of an existing file for conventions.
2. Name it `snake_case.chordpro`, adding a `-artist_name` segment only if needed to disambiguate.
3. Run `npm run lint` before committing.
4. Regenerate `INDEX.md`.

## Adding an alternate arrangement

Name it with an `_ii` or trailing number suffix (e.g. `bad_moon_rising2-...chordpro`), and add a
`{c:Alternate arrangement — see also X.chordpro}` comment in **both** files pointing at each
other.

## Site generation

[`scripts/build-site.js`](scripts/build-site.js) renders every song to HTML (via
`chordsheetjs`'s `HtmlDivFormatter`) into a `_site/` directory: one page per song plus an
`index.html` song list. `_site/` is gitignored — it's a build artifact, never committed.

`index.html` has a live search box (vanilla JS, no dependencies) that filters the song list
by title/artist substring match as you type. It relies on `data-title`/`data-artist`
attributes written on each `<li>` at build time — if you add a new metadata field to search
on, extend both the `entries` extraction in `main()` and the `data-*` attributes in
`buildIndexPage()`.

### Chord diagrams

[`scripts/chord-diagrams.js`](scripts/chord-diagrams.js) resolves each chord name a song
uses (via `song.getChords()`) to a guitar fingering from
[`@tombatossals/chords-db`](https://www.npmjs.com/package/@tombatossals/chords-db) and
renders it as an inline SVG. `build-site.js` uses this to add, per song page:

- a "chords in this song" strip near the top of the page (one diagram per unique chord)
- a hover/focus/tap tooltip on every chord occurrence in the lyrics, showing that chord's
  diagram

Chord names that don't resolve — exotic alterations, malformed annotations, anything outside
`chords-db`'s vocabulary — are silently skipped (no diagram, no tooltip); this is intentional,
not a bug to chase. `chords-db` is a devDependency used only at build time, like
`chordsheetjs`; nothing from it ships to `_site/` beyond the generated SVG markup.

```
npm run build-site
```

`.github/workflows/pages.yml` runs this on every push to `master` and deploys `_site/` to
GitHub Pages via `actions/upload-pages-artifact` + `actions/deploy-pages`. This requires
the repo's **Settings → Pages → Source** to be set to "GitHub Actions" (a one-time manual
step, not something the workflow can do for itself).

## Roadmap

Phase 1 (CI lint), phase 2 (repo consistency scanning + HTML site generation on GitHub
Pages), and phase 3 (migration from `.txt` to the standard `.chordpro` extension for
better interop with ChordPro tooling/apps that key off file extension) are all
implemented.
