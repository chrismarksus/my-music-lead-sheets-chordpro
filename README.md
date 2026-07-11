# my-music-lead-sheets-chordpro

A personal collection of lead sheets (lyrics + inline `[Chord]` notation) in
[ChordPro](https://www.chordpro.org/) format — 286 songs and counting, kept
for personal and church/worship-team use.

Every song lives in [`sheets/`](sheets/) as one `.chordpro` file. CI lints
each file and checks repo-wide consistency on every push, and a static,
searchable site is generated from the collection and deployed to GitHub
Pages.

See [`NOTICE.md`](NOTICE.md) for the copyright situation — the songs
themselves are not licensed for redistribution.

## Repo layout

| Path | What it is |
|---|---|
| `sheets/` | One `.chordpro` file per song |
| `INDEX.md` | Generated table of every song, linking title/artist to its file |
| `scripts/lint.js` | Per-file lint rules (parse validity, required title, banned long-form directives, etc.) |
| `scripts/check-consistency.js` | Repo-wide checks (`INDEX.md` accuracy, cross-references, duplicates, stray files, encoding) |
| `scripts/build-site.js` | Renders every song to HTML into `_site/` (gitignored build output) |
| `.github/workflows/lint.yml` | Runs lint + consistency check on every push/PR |
| `.github/workflows/pages.yml` | Builds the site and deploys it to GitHub Pages on push to `master` |

## Getting started

```
npm install
npm run lint    # per-file rules
npm run check   # repo-wide consistency
npm run build-site   # renders sheets/ into _site/ for local preview
```

## Adding a song

1. Copy the structure of an existing file in `sheets/` for conventions.
2. Name it `snake_case.chordpro`, adding a `-artist_name` segment only if
   needed to disambiguate.
3. Run `npm run lint` and `npm run check` before committing.
4. Regenerate `INDEX.md`.

Full conventions (directive short forms, alternate-arrangement
cross-references, tab block formatting, etc.) and what to do when CI fails
are documented in [`CONTRIBUTING.md`](CONTRIBUTING.md).
