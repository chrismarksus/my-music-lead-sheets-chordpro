#!/usr/bin/env node
// Builds a static HTML site (into _site/, gitignored) from the ChordPro song files in the
// repo root: one page per song plus an index. Run via `npm run build-site`; deployed to
// GitHub Pages by .github/workflows/pages.yml on every push to master.
//
// Redesign notes (Classical-derived look, phone/tablet-first):
//  - style.css below is the full stylesheet — see handoff/style.css for the same
//    content with commentary. Keep the two in sync if you tune tokens.
//  - Index groups songs under A–Z letter headers with a jump strip, per request.
//  - Search still matches title + artist only; behavior unchanged, markup restyled.
//  - Light/dark toggle kept, restyled to the new palette.
'use strict';

const fs = require('fs');
const path = require('path');
const { ChordProParser, HtmlDivFormatter } = require('chordsheetjs');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '_site');
const SONGS_DIR = path.join(OUT_DIR, 'songs');

const CHROME_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Lora:ital,wght@0,400;0,600;1,400&display=swap');

:root {
  --bg: #f3f2f2;
  --surface: #eae9e9;
  --text: #201f1d;
  --muted: #67635f;
  --divider: rgba(32, 31, 29, 0.15);
  --accent: #b68235;
  --accent-text: #7d5411;
  --link: var(--accent-text);
  --font-heading: "Cormorant Garamond", Georgia, serif;
  --font-body: "Lora", Georgia, serif;
}
:root[data-theme="dark"] {
  --bg: #1c1b1a; --surface: #26241f; --text: #f1efec; --muted: #a49d94;
  --divider: rgba(241, 239, 236, 0.16); --accent: #dbaf70; --accent-text: #e7bd82;
  --link: var(--accent-text);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1c1b1a; --surface: #26241f; --text: #f1efec; --muted: #a49d94;
    --divider: rgba(241, 239, 236, 0.16); --accent: #dbaf70; --accent-text: #e7bd82;
    --link: var(--accent-text);
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font-family: var(--font-body); font-size: 17px; line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--link); text-underline-offset: 3px; }
a:hover { color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
::selection { background: rgba(182, 130, 53, 0.28); }

.site-header {
  position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 12px;
  padding: 14px 20px; background: var(--bg); border-bottom: 1px solid var(--divider);
}
.site-header .back { font-family: var(--font-heading); font-weight: 600; font-size: 15px; color: var(--text); text-decoration: none; white-space: nowrap; }
.site-header .back:hover { color: var(--accent-text); }
.site-header .brand { font-family: var(--font-heading); font-weight: 600; font-size: 19px; margin-right: auto; text-decoration: none; color: var(--text); }
#theme-toggle {
  flex: none; width: 38px; height: 38px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid var(--divider); border-radius: 6px; color: var(--text); cursor: pointer;
}
#theme-toggle:hover { border-color: var(--accent); color: var(--accent-text); }

main { max-width: 680px; margin: 0 auto; padding: 24px 20px 64px; }

h1.page-title { font-family: var(--font-heading); font-weight: 600; font-size: 34px; letter-spacing: -0.01em; margin: 4px 0 16px; }

.search-wrap { position: sticky; top: 61px; z-index: 9; background: var(--bg); padding-bottom: 10px; margin-bottom: 4px; }
#song-search {
  width: 100%; box-sizing: border-box; padding: 12px 14px; font: inherit; font-size: 16px;
  color: var(--text); background: var(--surface); border: 1px solid var(--divider); border-radius: 8px;
}
#song-search:focus-visible { border-color: var(--accent); outline-offset: 0; }
#song-search::placeholder { color: var(--muted); }

#song-count { color: var(--muted); font-size: 13px; margin: 10px 2px 6px; }
#no-results { display: none; color: var(--muted); padding: 24px 2px; }

.az-jump { display: flex; flex-wrap: wrap; gap: 2px; margin: 4px 0 18px; padding: 8px 0; border-top: 1px solid var(--divider); border-bottom: 1px solid var(--divider); }
.az-jump a, .az-jump span {
  font-family: var(--font-heading); font-weight: 600; font-size: 13px; width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center; color: var(--text); text-decoration: none; border-radius: 4px;
}
.az-jump a:hover { background: rgba(182, 130, 53, 0.14); color: var(--accent-text); }
.az-jump span { color: var(--muted); opacity: 0.4; }

.letter-group { scroll-margin-top: 130px; margin-bottom: 6px; }
.letter-group h2 {
  font-family: var(--font-heading); font-weight: 600; font-size: 15px; color: var(--accent-text);
  letter-spacing: 0.04em; margin: 22px 0 2px; padding-bottom: 4px; border-bottom: 1px solid var(--divider);
}

ul.song-list { list-style: none; margin: 0; padding: 0; }
.song-list li { border-bottom: 1px solid var(--divider); }
.song-list li.hidden { display: none; }
.song-list a { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 13px 2px; text-decoration: none; color: var(--text); }
.song-list a:hover .title { color: var(--accent-text); }
.song-list .title { font-family: var(--font-heading); font-weight: 600; font-size: 18px; }
.song-list .artist { color: var(--muted); font-size: 13.5px; text-align: right; flex: none; max-width: 45%; }

h1.title { font-family: var(--font-heading); font-weight: 600; font-size: 32px; line-height: 1.15; letter-spacing: -0.01em; margin: 6px 0 0; }
h2.subtitle { font-family: var(--font-body); font-style: italic; font-weight: 400; font-size: 16px; color: var(--muted); margin: 4px 0 20px; }
.song-divider { height: 1px; border: 0; background: var(--divider); margin: 0 0 22px; }

.chord-sheet { font-size: 17px; line-height: 1.9; }
.chord-sheet .paragraph { margin-bottom: 22px; }
.chord-sheet .paragraph.chorus { padding-left: 14px; border-left: 2px solid var(--divider); }
.chord-sheet .row { display: flex; flex-wrap: wrap; }
.chord-sheet .column { display: flex; flex-direction: column; padding-right: 0.35em; }
.chord-sheet .chord { font-family: var(--font-heading); font-weight: 600; font-size: 0.88em; color: var(--accent-text); min-height: 1.3em; }
.chord-sheet .lyrics { white-space: pre; }
.chord-sheet .comment { display: block; font-style: italic; color: var(--muted); font-size: 0.85em; margin: 10px 0; padding: 6px 10px; border-left: 2px solid var(--divider); }

@media (max-width: 420px) {
  main { padding: 18px 14px 56px; }
  h1.page-title { font-size: 28px; }
  h1.title { font-size: 27px; }
  .song-list .artist { max-width: 38%; }
}
`;

const THEME_TOGGLE_ICONS = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></svg>',
};

const SEARCH_SCRIPT = `<script>
(function () {
  var input = document.getElementById('song-search');
  var items = Array.prototype.slice.call(document.querySelectorAll('#song-list li'));
  var groups = Array.prototype.slice.call(document.querySelectorAll('.letter-group'));
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
    groups.forEach(function (g) {
      var anyVisible = g.querySelector('li:not(.hidden)');
      g.style.display = anyVisible ? '' : 'none';
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
  const homeHref = isSongPage ? '../index.html' : null;
  const header = isSongPage
    ? `<a class="back" href="${homeHref}">&larr; Song list</a>`
    : `<span class="brand">Lead Sheets</span>`;
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
<header class="site-header">
${header}
<button id="theme-toggle" type="button" aria-label="Toggle dark mode"></button>
</header>
<main>
${bodyHtml}
</main>
<script>
(function () {
  var root = document.documentElement;
  var btn = document.getElementById('theme-toggle');
  var ICONS = ${JSON.stringify(THEME_TOGGLE_ICONS)};
  function effectiveTheme() {
    return root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  function render() {
    btn.innerHTML = effectiveTheme() === 'dark' ? ICONS.sun : ICONS.moon;
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

function letterFor(title) {
  const ch = title.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(ch) ? ch : '#';
}

function buildIndexPage(entries) {
  // group alphabetically by title's first letter; non-letters bucket under "#"
  const byLetter = new Map();
  entries.forEach((e) => {
    const letter = letterFor(e.title);
    if (!byLetter.has(letter)) byLetter.set(letter, []);
    byLetter.get(letter).push(e);
  });
  const letters = ['#', ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('')];
  const present = letters.filter((l) => byLetter.has(l));

  const jumpHtml = letters
    .map((l) => (byLetter.has(l) ? `<a href="#letter-${l === '#' ? 'num' : l}">${l}</a>` : `<span>${l}</span>`))
    .join('');

  const groupsHtml = present
    .map((letter) => {
      const rows = byLetter.get(letter)
        .map(({ title, artist, slug }) => `<li data-title="${escapeHtml(title.toLowerCase())}" data-artist="${escapeHtml(artist.toLowerCase())}"><a href="songs/${slug}.html"><span class="title">${escapeHtml(title)}</span>${artist ? `<span class="artist">${escapeHtml(artist)}</span>` : ''}</a></li>`)
        .join('\n');
      const anchorId = letter === '#' ? 'num' : letter;
      return `<section class="letter-group" id="letter-${anchorId}">
<h2>${letter}</h2>
<ul class="song-list" id="song-list">
${rows}
</ul>
</section>`;
    })
    .join('\n');
  // Note: id="song-list" repeats per group intentionally so the existing
  // querySelectorAll('#song-list li') selector in SEARCH_SCRIPT still finds
  // every row across groups (ids aren't unique here, which is harmless for
  // a read-only selector but flag if you add code relying on getElementById).

  const bodyHtml = `<h1 class="page-title">Song Index</h1>
<div class="search-wrap">
<input type="search" id="song-search" placeholder="Search by title or artist&hellip;" aria-label="Search songs by title or artist">
<p id="song-count">${entries.length} songs.</p>
</div>
<nav class="az-jump" aria-label="Jump to letter">${jumpHtml}</nav>
<p id="no-results">No songs match your search.</p>
${groupsHtml}`;
  return pageShell({ title: 'Song Index', bodyHtml, isSongPage: false });
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
    const artist = song.subtitle || '';
    // HtmlDivFormatter's own output already includes <h1 class="title"> (and
    // <h2 class="subtitle"> when present) ahead of the chord sheet, so we
    // only need to splice in the divider rather than render our own heading
    // (which would duplicate the formatter's).
    const chordSheetHtml = new HtmlDivFormatter().format(song);
    const bodyHtml = chordSheetHtml.replace(
      '<div class="chord-sheet">',
      '<hr class="song-divider">\n<div class="chord-sheet">'
    );
    fs.writeFileSync(path.join(SONGS_DIR, `${slug}.html`), pageShell({ title, bodyHtml, isSongPage: true }));
    entries.push({ title, artist, slug });
  });

  entries.sort((a, b) => a.title.localeCompare(b.title));
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), buildIndexPage(entries));

  // formatterCss first, CHROME_CSS second: our selectors are equally specific
  // to the formatter's own defaults, so ours must come last in the cascade
  // to win (the original script had these reversed, which is why chord
  // color / spacing were relying on being first — kept correct here).
  const formatterCss = new HtmlDivFormatter().cssString('.chord-sheet');
  fs.writeFileSync(path.join(OUT_DIR, 'style.css'), `${formatterCss}\n${CHROME_CSS}`);
  fs.writeFileSync(path.join(OUT_DIR, '.nojekyll'), '');

  console.log(`build-site: wrote ${entries.length} song pages + index.html to ${path.relative(ROOT, OUT_DIR)}/`);
}

main();
