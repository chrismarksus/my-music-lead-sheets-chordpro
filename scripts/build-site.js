#!/usr/bin/env node
// Builds a static HTML site (into _site/, gitignored) from the ChordPro song files in the
// repo root: one page per song plus an index. Run via `npm run build-site`; deployed to
// GitHub Pages by .github/workflows/pages.yml on every push to master.
'use strict';

const fs = require('fs');
const path = require('path');
const { ChordProParser, HtmlDivFormatter } = require('chordsheetjs');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '_site');
const SONGS_DIR = path.join(OUT_DIR, 'songs');

const CHROME_CSS = `
body {
  font-family: system-ui, -apple-system, Segoe UI, sans-serif;
  max-width: 40em;
  margin: 2em auto;
  padding: 0 1em;
  line-height: 1.5;
}
header { margin-bottom: 1.5em; }
header a { text-decoration: none; }
.song-list { list-style: none; padding: 0; }
.song-list li { padding: 0.3em 0; border-bottom: 1px solid #eee; }
.artist { color: #666; font-size: 0.9em; }
h1.title { margin-bottom: 0; }
h2.subtitle { margin-top: 0.2em; color: #666; font-weight: normal; }
.chord-sheet { font-family: ui-monospace, Menlo, Consolas, monospace; white-space: pre-wrap; }
.chord-sheet .row { display: flex; flex-wrap: wrap; }
.chord-sheet .chord { color: #b00; font-weight: bold; }
`;

function listSongFiles() {
  return fs.readdirSync(ROOT)
    .filter((f) => f.endsWith('.txt'))
    .sort();
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function slugFor(filename) {
  return filename.replace(/\.txt$/, '');
}

function pageShell({ title, bodyHtml, isSongPage }) {
  const stylesheetHref = isSongPage ? '../style.css' : 'style.css';
  const backLink = isSongPage ? '<header><a href="../index.html">&larr; Back to song list</a></header>' : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${stylesheetHref}">
</head>
<body>
${backLink}
<main>
${bodyHtml}
</main>
</body>
</html>
`;
}

function buildIndexPage(entries) {
  const rows = entries
    .map(({ title, artist, slug }) => `<li><a href="songs/${slug}.html">${escapeHtml(title)}</a>${artist ? ` &mdash; <span class="artist">${escapeHtml(artist)}</span>` : ''}</li>`)
    .join('\n');
  return pageShell({
    title: 'Song Index',
    bodyHtml: `<h1>Song Index</h1>\n<p>${entries.length} songs.</p>\n<ul class="song-list">\n${rows}\n</ul>`,
    isSongPage: false,
  });
}

function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(SONGS_DIR, { recursive: true });

  const files = listSongFiles();
  const entries = [];

  files.forEach((filename) => {
    const content = fs.readFileSync(path.join(ROOT, filename), 'utf8');
    let song;
    try {
      song = new ChordProParser().parse(content);
    } catch (e) {
      console.error(`build-site: skipping ${filename}, failed to parse: ${e.message}`);
      return;
    }
    const slug = slugFor(filename);
    const title = song.title || filename;
    const html = new HtmlDivFormatter().format(song);
    fs.writeFileSync(path.join(SONGS_DIR, `${slug}.html`), pageShell({ title, bodyHtml: html, isSongPage: true }));
    entries.push({ title, artist: song.subtitle || '', slug });
  });

  entries.sort((a, b) => a.title.localeCompare(b.title));
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), buildIndexPage(entries));

  const formatterCss = new HtmlDivFormatter().cssString('.chord-sheet');
  fs.writeFileSync(path.join(OUT_DIR, 'style.css'), `${CHROME_CSS}\n${formatterCss}`);
  fs.writeFileSync(path.join(OUT_DIR, '.nojekyll'), '');

  console.log(`build-site: wrote ${entries.length} song pages + index.html to ${path.relative(ROOT, OUT_DIR)}/`);
}

main();
