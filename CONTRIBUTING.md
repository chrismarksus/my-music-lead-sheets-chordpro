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

Every push and pull request triggers the **Lint** GitHub Actions workflow
(`.github/workflows/lint.yml`), which runs:

```
npm ci
npm run lint
```

`npm run lint` runs [`scripts/lint.js`](scripts/lint.js), which checks every `.txt` file in
the repo root against the rules listed in that file's header comment (parse validity,
required title, banned long-form directives, balanced `{soc}`/`{eoc}` and `{sot}`/`{eot}`
blocks, balanced chord brackets, snake_case filename). The rule list lives in one place —
`scripts/lint.js` — rather than being duplicated here, so it can't drift out of sync with
what the code actually checks.

If every file passes, the check exits 0 (green). If anything fails, it exits 1 (red) and
prints every violation as `filename:line: message`.

### Running lint locally before you push

```
npm install    # once, or whenever chordsheetjs version changes
npm run lint
```

Fix anything it reports, then commit.

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

## Adding a new song

1. Copy the structure of an existing file for conventions.
2. Name it `snake_case.txt`, adding a `-artist_name` segment only if needed to disambiguate.
3. Run `npm run lint` before committing.
4. Regenerate `INDEX.md`.

## Adding an alternate arrangement

Name it with an `_ii` or trailing number suffix (e.g. `bad_moon_rising2-...txt`), and add a
`{c:Alternate arrangement — see also X.txt}` comment in **both** files pointing at each
other.

## Roadmap

This is phase 1 of a larger CI/CD setup. Planned follow-ups (not yet implemented):

- **Repo consistency scanning** — verifying `INDEX.md` matches the actual files, that
  `{c:}` cross-references between alternate arrangements point at real filenames, and that
  there are no duplicate/stray files or encoding issues.
- **HTML site generation** — rendering every song to HTML (via `chordsheetjs`) and
  publishing a static site on GitHub Pages, built automatically on push to `master`.

This section will be updated as those land.
