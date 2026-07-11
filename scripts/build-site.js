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
:root {
  --bg: #fff;
  --fg: #222;
  --muted: #666;
  --border: #eee;
  --chord: #b00;
  --link: #0645ad;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1a1a1a;
    --fg: #e4e4e4;
    --muted: #999;
    --border: #333;
    --chord: #ff6b6b;
    --link: #6cb2ff;
  }
}
:root[data-theme="light"] {
  --bg: #fff;
  --fg: #222;
  --muted: #666;
  --border: #eee;
  --chord: #b00;
  --link: #0645ad;
}
:root[data-theme="dark"] {
  --bg: #1a1a1a;
  --fg: #e4e4e4;
  --muted: #999;
  --border: #333;
  --chord: #ff6b6b;
  --link: #6cb2ff;
}
body {
  font-family: system-ui, -apple-system, Segoe UI, sans-serif;
  max-width: 40em;
  margin: 2em auto;
  padding: 0 1em;
  line-height: 1.5;
  background: var(--bg);
  color: var(--fg);
}
a { color: var(--link); }
header { margin-bottom: 1.5em; display: flex; align-items: center; }
header a { text-decoration: none; }
#theme-toggle {
  margin-left: auto;
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.3em 0.6em;
  cursor: pointer;
  color: var(--fg);
  font-size: 0.9rem;
  line-height: 1;
}
#song-search {
  width: 100%;
  box-sizing: border-box;
  padding: 0.5em;
  font-size: 1rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--fg);
  margin-bottom: 0.5em;
}
#no-results { display: none; color: var(--muted); }
.song-list { list-style: none; padding: 0; }
.song-list li { padding: 0.3em 0; border-bottom: 1px solid var(--border); }
.song-list li.hidden { display: none; }
.artist { color: var(--muted); font-size: 0.9em; }
h1.title { margin-bottom: 0; }
h2.subtitle { margin-top: 0.2em; color: var(--muted); font-weight: normal; }
.chord-sheet { font-family: ui-monospace, Menlo, Consolas, monospace; white-space: pre-wrap; }
.chord-sheet .row { display: flex; flex-wrap: wrap; }
.chord-sheet .chord { color: var(--chord); font-weight: bold; }
`;

const SEARCH_SCRIPT = `<script>
(function () {
  var input = document.getElementById('song-search');
  var items = Array.prototype.slice.call(document.querySelectorAll('#song-list li'));
  var countEl = document.getElementById('song-count');
  var noResultsEl = document.getElementById('no-results');
  var total = items.length;
  function filter() {
    var q = input.value.trim().toLowerCase();
    var visible = 0;
    items.forEach(function (li) {
      var match = !q || li.dataset.title.indexOf(q) !== -1 || li.dataset.artist.indexOf(q) !== -1;
      li.classList.toggle('hidden', !match);
      if (match) visible++;
    });
    countEl.textContent = q ? (visible + ' of ' + total + ' songs.') : (total + ' songs.');
    noResultsEl.style.display = visible === 0 ? 'block' : 'none';
  }
  input.addEventListener('input', filter);
})();
</script>`;

function listSongFiles() {
  return fs.readdirSync(ROOT)
    .filter((f) => f.endsWith('.chordpro'))
    .sort();
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function slugFor(filename) {
  return filename.replace(/\.chordpro$/, '');
}

function pageShell({ title, bodyHtml, isSongPage }) {
  const stylesheetHref = isSongPage ? '../style.css' : 'style.css';
  const backLink = isSongPage ? '<a href="../index.html">&larr; Back to song list</a>' : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${stylesheetHref}">
<script>
(function () {
  var stored = localStorage.getItem('theme');
  if (stored === 'dark' || stored === 'light') {
    document.documentElement.setAttribute('data-theme', stored);
  }
})();
</script>
</head>
<body>
<header>
${backLink}
<button id="theme-toggle" type="button" aria-label="Toggle dark mode"></button>
</header>
<main>
${bodyHtml}
</main>
<script>
(function () {
  var root = document.documentElement;
  var btn = document.getElementById('theme-toggle');
  function effectiveTheme() {
    return root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  function render() {
    btn.textContent = effectiveTheme() === 'dark' ? '☀️ Light' : '🌙 Dark';
  }
  render();
  btn.addEventListener('click', function () {
    var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    render();
  });
})();
</script>
${isSongPage ? '' : SEARCH_SCRIPT}
</body>
</html>
`;
}

function buildIndexPage(entries) {
  const rows = entries
    .map(({ title, artist, slug }) => `<li data-title="${escapeHtml(title.toLowerCase())}" data-artist="${escapeHtml(artist.toLowerCase())}"><a href="songs/${slug}.html">${escapeHtml(title)}</a>${artist ? ` &mdash; <span class="artist">${escapeHtml(artist)}</span>` : ''}</li>`)
    .join('\n');
  const bodyHtml = `<h1>Song Index</h1>
<input type="search" id="song-search" placeholder="Search by title or artist&hellip;" aria-label="Search songs by title or artist">
<p id="song-count">${entries.length} songs.</p>
<p id="no-results">No songs match your search.</p>
<ul class="song-list" id="song-list">
${rows}
</ul>`;
  return pageShell({
    title: 'Song Index',
    bodyHtml,
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
