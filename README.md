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
| `scripts/generate-index.js` | Regenerates `INDEX.md` from every `sheets/*.chordpro` file's `{t:}`/`{st:}` directives; `--check` mode fails if it's out of date (used by CI) |
| `scripts/convert-raw-sheet.js` | Converts a raw chords-over-lyrics paste into ChordPro (used by `format-sheets.js`) |
| `scripts/format-sheets.js` | Finds `sheets/*.txt` raw pastes, converts each to `.chordpro`, and regenerates `INDEX.md` |
| `scripts/build-site.js` | Renders every song to HTML into `_site/` (gitignored build output) |
| `scripts/fetch-spotify-links.js` | Looks up a Spotify track match per song into `data/spotify-links.json`, which `build-site.js` uses to add a "Listen on Spotify" link |
| `scripts/spotify-status-report.js` | Writes a local-only `data/spotify-status.html` maintenance dashboard (coverage, diff vs. the last run, arrangement-pair mismatches) — never published |
| `.github/workflows/lint.yml` | Runs lint + consistency check + INDEX.md staleness check on every push/PR |
| `.github/workflows/format-sheets.yml` | Auto-converts `sheets/*.txt` raw pastes to `.chordpro` on push to `master`, committing the result back |
| `.github/workflows/pages.yml` | Builds the site and deploys it to GitHub Pages on push to `master` |

## Getting started

```
npm install
npm run lint    # per-file rules
npm run check   # repo-wide consistency
npm run check-index   # verifies INDEX.md matches sheets/*.chordpro
npm run build-site   # renders sheets/ into _site/ for local preview
```

## Spotify links

`data/spotify-links.json` is committed and drives the "Listen on Spotify" link on each song
page — `build-site.js` only links songs with a "high confidence" match (both title and
artist verified against the Spotify result), so most worship originals with no listed
artist won't show a link until reviewed.

To regenerate it (e.g. after adding songs), copy `.env.example` to `.env`, fill in a
Spotify Developer app's Client ID/Secret (Web API, Client Credentials flow — no user login
needed), then:

```
npm run fetch-spotify-links
```

This also writes `data/artist-suggestions.md` (gitignored, regenerated each run): songs
with no `{st:}` artist where a title search found a plausible track, for you to review
before manually adding a `{st:}` line.

## Checking coverage

`npm run spotify-status` (also run automatically at the end of `fetch-spotify-links`) writes
`data/spotify-status.html` — a local-only dashboard, gitignored and never part of the
published site. Open it in a browser to see: coverage counts, which songs changed status
since the last fetch run, alternate-arrangement pairs whose link status disagrees, and a
searchable table of all songs with "pending re-verification" / "low-trust" flags called out.
It reads the live `{st:}` from each `.chordpro` file rather than trusting
`data/spotify-links.json`'s stored artist, so it stays accurate even right after a manual
edit, before the next fetch re-verifies it.

## Adding a song

1. Copy the structure of an existing file in `sheets/` for conventions.
2. Name it `snake_case.chordpro`, adding a `-artist_name` segment only if
   needed to disambiguate.
3. Run `npm run lint` and `npm run check` before committing.
4. Run `npm run generate-index` to update `INDEX.md` (CI verifies this via `npm run check-index`).

Full conventions (directive short forms, alternate-arrangement
cross-references, tab block formatting, etc.) and what to do when CI fails
are documented in [`CONTRIBUTING.md`](CONTRIBUTING.md).

### Adding a song via the GitHub web UI

You don't need a local checkout for this. Create a new file directly in `sheets/`
through GitHub's web editor, name it anything ending in `.txt` (e.g. `new_song.txt`),
and paste:

```
{t:Song Title}
{st:Artist Name}

[Verse 1]
C            G
Some lyric line with chords above it
              Am
Another line
```

- `{t:...}` is required; `{st:...}` is optional. These are preserved as-is.
- `[Label]`-only lines (`[Intro]`, `[Verse 1]`, `[Chorus]`, ...) become `{c:Label}` section
  comments.
- A line of only chords (e.g. `C   G   Am   F`) with no lyric line under it becomes an
  instrumental line.
- Chord placement is column-exact: a chord character sits above the exact letter of the
  lyric it should attach to. This works cleanly if you type or paste the raw text into a
  monospace editor (which GitHub's file editor is) with real space characters — pasting
  from a source that doesn't preserve literal spacing (e.g. a web page that positions
  chords with CSS) can produce wrong placement, since there's nothing in the text to
  recover the intended position from.

Commit straight to `master`. Within about a minute, the **Auto-format sheets** workflow
converts the `.txt` to a properly named `.chordpro` file, regenerates `INDEX.md`, and
commits that back — then the normal lint/consistency checks and site rebuild run against
the converted file. If conversion fails (most commonly: no `{t:...}` line), the `.txt`
is left untouched and the **Auto-format sheets** check goes red with the reason in its
log — fix the `.txt` and push again.
