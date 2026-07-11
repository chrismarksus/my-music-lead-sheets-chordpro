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
  e.g. `song_title.txt` or `song_title-artist_name.txt`.
- **Multiple arrangements cross-reference each other.** If you have
  `amazing_grace.txt` and `amazing_grace_ii.txt`, each should carry a
  `{c:Alternate arrangement — see also X.txt}` comment pointing at the other.
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

`npm run lint` runs [`scripts/lint.js`](scripts/lint.js), which checks every `.txt` file in
the repo root against the rules listed in that file's header comment (parse validity,
required title, banned long-form directives, balanced `{soc}`/`{eoc}` and `{sot}`/`{eot}`
blocks, balanced chord brackets, snake_case filename). The rule list lives in one place —
`scripts/lint.js` — rather than being duplicated here, so it can't drift out of sync with
what the code actually checks.

`npm run check` runs [`scripts/check-consistency.js`](scripts/check-consistency.js), which
checks repo-wide consistency rather than individual files: `INDEX.md` matches the actual
files (no missing/stray rows, no title/artist drift), `{c:...see also X.txt}`
cross-references between alternate arrangements point at real filenames, there are no
byte-identical duplicate `.txt` files, no unrecognized stray files/directories in the repo
root, and every `.txt` file is valid UTF-8 with no BOM. As with lint, the rule list lives
in the script's header comment.

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
| `INDEX.md: missing a row linking to X.txt` | Add a row for `X.txt` to `INDEX.md`. |
| `INDEX.md:N: links to X.txt, which does not exist` | Fix or remove that row — the file it points at is gone or renamed. |
| `INDEX.md:N: title/artist "..." doesn't match X.txt's {t:.../st:...}` | Someone edited the file's title/subtitle without regenerating `INDEX.md` (or vice versa) — make them match. |
| `cross-reference points at X.txt, which does not exist` | Fix the `{c:...see also X.txt}` comment — the referenced file was renamed or removed. |
| `X.txt: byte-identical to Y.txt` | Likely an accidental duplicate — remove one, or add a `{c:}` cross-reference if they're intentionally meant to be identical starting points. |
| `stray file/directory in repo root` | Remove it, or add it to `KNOWN_ROOT_FILES`/`KNOWN_ROOT_DIRS` in `scripts/check-consistency.js` if it's meant to be there. |
| `not valid UTF-8` / `has a UTF-8 byte-order mark` | Re-save the file as plain UTF-8 without a BOM. |

## Adding a new song

1. Copy the structure of an existing file for conventions.
2. Name it `snake_case.txt`, adding a `-artist_name` segment only if needed to disambiguate.
3. Run `npm run lint` before committing.
4. Regenerate `INDEX.md`.

## Adding an alternate arrangement

Name it with an `_ii` or trailing number suffix (e.g. `bad_moon_rising2-...txt`), and add a
`{c:Alternate arrangement — see also X.txt}` comment in **both** files pointing at each
other.

## Site generation

[`scripts/build-site.js`](scripts/build-site.js) renders every song to HTML (via
`chordsheetjs`'s `HtmlDivFormatter`) into a `_site/` directory: one page per song plus an
`index.html` song list. `_site/` is gitignored — it's a build artifact, never committed.

```
npm run build-site
```

`.github/workflows/pages.yml` runs this on every push to `master` and deploys `_site/` to
GitHub Pages via `actions/upload-pages-artifact` + `actions/deploy-pages`. This requires
the repo's **Settings → Pages → Source** to be set to "GitHub Actions" (a one-time manual
step, not something the workflow can do for itself).

## Roadmap

Phase 1 (CI lint) and phase 2 (repo consistency scanning + HTML site generation on GitHub
Pages) are both implemented.

Phase 3 (planned, not started): **migrate from `.txt` to a standard ChordPro extension**
(`.cho` or `.chordpro`). The collection currently uses `.txt` deliberately, but adopting a
standard extension would improve interop with ChordPro tooling/apps that key off file
extension. Would require updating `scripts/lint.js` and `scripts/check-consistency.js`'s
file-matching globs, `scripts/build-site.js`, the `INDEX.md` generator, and renaming every
file (with `{c:...see also X}` cross-reference comments updated to match).
