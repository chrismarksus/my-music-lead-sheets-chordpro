#!/usr/bin/env node
// Builds a static HTML site (into _site/, gitignored) from the ChordPro song files in
// sheets/: one page per song plus an index. Run via `npm run build-site`; deployed to
// GitHub Pages by .github/workflows/pages.yml on every push to master.
//
// Redesign notes (Classical-derived look, phone/tablet-first):
//  - style.css below is the full stylesheet — see handoff/style.css for the same
//    content with commentary. Keep the two in sync if you tune tokens.
//  - Index groups songs under A–Z letter headers with a jump strip, per request.
//  - Search still matches title + artist only; behavior unchanged, markup restyled.
//  - Light/dark toggle kept, restyled to the new palette.
//  - Tab blocks ({sot}...{eot}) are pulled out before chordsheetjs parses and
//    re-injected as a monospace plate after formatting, so ASCII string
//    diagrams stay aligned instead of running through the chord/lyric column
//    layout in the body serif font.
'use strict';

const fs = require('fs');
const path = require('path');
const { ChordProParser, HtmlDivFormatter } = require('chordsheetjs');
const { buildChordDiagrams } = require('./chord-diagrams');

const ROOT = path.resolve(__dirname, '..');
const SHEETS_DIR = path.join(ROOT, 'sheets');
const OUT_DIR = path.join(ROOT, '_site');
const SONGS_DIR = path.join(OUT_DIR, 'songs');
const SPOTIFY_LINKS_PATH = path.join(ROOT, 'data', 'spotify-links.json');

// Keep in sync with GENRES in scripts/lint.js. Order here is display order for the index
// page's filter pills — worship-adjacent genres first (this collection's overwhelming
// majority), then secular genres roughly by how common they are in the collection.
const GENRES = [
  'Worship/CCM', 'Hymn', 'Christmas', 'Rock', 'Pop', 'Folk/Singer-Songwriter',
  'Country', 'Jazz/Standards', 'R&B/Soul',
];

// Only "high" confidence matches (title + artist both verified against the Spotify result)
// get linked from the site — see scripts/fetch-spotify-links.js. Lower-confidence and
// unverified matches are left out rather than risk linking the wrong recording.
function loadSpotifyLinks() {
  if (!fs.existsSync(SPOTIFY_LINKS_PATH)) return {};
  const data = JSON.parse(fs.readFileSync(SPOTIFY_LINKS_PATH, 'utf8'));
  const links = {};
  for (const [filename, entry] of Object.entries(data)) {
    if (entry.confidence === 'high' && entry.track?.url && entry.track?.id) {
      links[filename] = { url: entry.track.url, id: entry.track.id };
    }
  }
  return links;
}

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
  -webkit-font-smoothing: antialiased; overflow-x: hidden;
}
a { color: var(--link); text-underline-offset: 3px; }
a:hover { color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
::selection { background: rgba(182, 130, 53, 0.28); }

.site-header {
  position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 12px;
  padding: 14px 20px; background: var(--bg); border-bottom: 1px solid var(--divider);
}
.site-header .back { font-family: var(--font-heading); font-weight: 600; font-size: 15px; color: var(--text); text-decoration: none; white-space: nowrap; margin-right: auto; }
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

.genre-filter { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 18px; }
.genre-filter button {
  font-family: var(--font-body); font-size: 12.5px; font-weight: 600; color: var(--muted);
  background: var(--surface); border: 1px solid var(--divider); border-radius: 999px;
  padding: 5px 12px; cursor: pointer;
}
.genre-filter button:hover { border-color: var(--accent); color: var(--accent-text); }
.genre-filter button[aria-pressed="true"] {
  background: rgba(182, 130, 53, 0.16); border-color: var(--accent); color: var(--accent-text);
}
.genre-filter button .n { opacity: 0.7; font-weight: 400; }

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
.song-list .title-wrap { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.song-list .title { font-family: var(--font-heading); font-weight: 600; font-size: 18px; }
.song-list .genre { color: var(--muted); font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; }
.song-list .artist { color: var(--muted); font-size: 13.5px; text-align: right; flex: none; max-width: 45%; }

h1.title { font-family: var(--font-heading); font-weight: 600; font-size: 32px; line-height: 1.15; letter-spacing: -0.01em; margin: 6px 0 0; }
h2.subtitle { font-family: var(--font-body); font-style: italic; font-weight: 400; font-size: 16px; color: var(--muted); margin: 4px 0 20px; }
.genre-badge {
  margin: -12px 0 20px; display: inline-block; font-family: var(--font-body); font-size: 11.5px;
  font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent-text);
  background: rgba(182, 130, 53, 0.14); border-radius: 999px; padding: 4px 12px;
}
.spotify-link { margin: -10px 0 20px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.spotify-link a {
  display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-heading);
  font-weight: 600; font-size: 14px; text-decoration: none; color: var(--accent-text);
  border: 1px solid var(--divider); border-radius: 999px; padding: 5px 12px 5px 10px;
}
.spotify-link a:hover { border-color: var(--accent); }
.spotify-link svg { width: 14px; height: 14px; flex: none; fill: currentColor; }
.spotify-play-btn {
  font-family: var(--font-heading); font-weight: 600; font-size: 14px; color: var(--muted);
  background: none; border: 1px solid var(--divider); border-radius: 999px; padding: 5px 12px;
  cursor: pointer;
}
.spotify-play-btn:hover { border-color: var(--accent); color: var(--accent-text); }
.spotify-embed:not([hidden]) { margin: -10px 0 20px; }
.spotify-embed iframe { display: block; }
.song-divider { height: 1px; border: 0; background: var(--divider); margin: 0 0 22px; }

.chord-diagrams { display: flex; flex-wrap: wrap; gap: 14px; margin: 0 0 22px; }
.chord-diagram-card {
  display: flex; flex-direction: column; align-items: center; gap: 4px; width: 62px;
  padding: 8px 4px 6px; border: 1px solid var(--divider); border-radius: 6px; background: var(--surface);
}
.chord-diagram-card .chord-diagram-name { font-family: var(--font-heading); font-weight: 600; font-size: 13px; color: var(--accent-text); }
svg.chord-diagram { display: block; width: 54px; height: auto; overflow: visible; }
.chord-diagram-string { stroke: var(--muted); stroke-width: 1; }
.chord-diagram-fret { stroke: var(--divider); stroke-width: 1; }
.chord-diagram-nut { stroke: var(--text); stroke-width: 3; }
.chord-diagram-barre { fill: var(--accent); opacity: 0.28; }
.chord-diagram-dot { fill: var(--accent-text); }
.chord-diagram-finger { fill: var(--surface); font-size: 8px; font-family: var(--font-body); }
.chord-diagram-mark { stroke: var(--muted); stroke-width: 1.4; fill: none; }
.chord-diagram-basefret { fill: var(--muted); font-size: 8px; font-family: var(--font-body); }

.chord-sheet { font-size: 17px; line-height: 1.9; }
.chord-sheet .paragraph { margin-bottom: 22px; }
.chord-sheet .paragraph.chorus { padding-left: 14px; border-left: 2px solid var(--divider); }
.chord-sheet .row { display: flex; flex-wrap: wrap; }
.chord-sheet .column { display: flex; flex-direction: column; padding-right: 0.35em; }
.chord-sheet .chord { font-family: var(--font-heading); font-weight: 600; font-size: 0.88em; color: var(--accent-text); min-height: 1.3em; }
.chord-sheet .chord.has-diagram {
  position: relative; cursor: pointer; text-decoration: underline dotted; text-underline-offset: 3px;
  text-decoration-color: var(--divider);
}
.chord-sheet .chord-tooltip {
  display: none; position: absolute; z-index: 20; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
  background: var(--surface); border: 1px solid var(--divider); border-radius: 8px; padding: 8px 6px 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18); white-space: normal;
}
.chord-sheet .chord.has-diagram:hover .chord-tooltip,
.chord-sheet .chord.has-diagram:focus .chord-tooltip,
.chord-sheet .chord.has-diagram.tooltip-open .chord-tooltip { display: block; }
.chord-sheet .lyrics { white-space: pre; }
.chord-sheet .comment { display: block; font-style: italic; color: var(--muted); font-size: 0.85em; margin: 10px 0; padding: 6px 10px; border-left: 2px solid var(--divider); }

.chord-sheet .tab { display: block; margin: 4px 0 22px; }
.chord-sheet .tab-label { display: block; font-family: var(--font-heading); font-weight: 600; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent-text); margin: 0 0 6px; }
.chord-sheet .tab-block {
  display: block; margin: 0; overflow-x: auto; padding: 14px 16px;
  border: 1px solid var(--divider); border-radius: 4px; background: var(--surface); color: var(--text);
  font-family: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
  font-size: 13.5px; line-height: 1.6; white-space: pre; -webkit-font-smoothing: auto;
}

.song-nav { display: flex; justify-content: space-between; gap: 12px; margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--divider); }
.song-nav a { display: flex; flex-direction: column; text-decoration: none; color: var(--text); max-width: 46%; }
.song-nav .next { margin-left: auto; text-align: right; align-items: flex-end; }
.song-nav .dir { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.song-nav .nav-title { font-family: var(--font-heading); font-weight: 600; font-size: 15px; }
.song-nav a:hover .nav-title { color: var(--accent-text); }

main.has-autoscroll { padding-bottom: 104px; }
main.has-transpose { padding-bottom: 168px; }
.song-control-bars {
  position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 15;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
}
.autoscroll-bar, .transpose-bar {
  display: flex; align-items: center; gap: 12px; background: var(--surface);
  border: 1px solid var(--divider); border-radius: 999px; padding: 8px 16px 8px 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
}
#autoscroll-toggle {
  flex: none; width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;
  background: var(--accent); color: #fff; border: none; border-radius: 50%; cursor: pointer;
}
#autoscroll-toggle:hover { opacity: 0.88; }
#autoscroll-toggle svg { width: 16px; height: 16px; }
.autoscroll-speed { display: flex; align-items: center; gap: 8px; }
#autoscroll-speed-range { width: 88px; accent-color: var(--accent); }
#autoscroll-speed-label { font-family: var(--font-heading); font-weight: 600; font-size: 13px; color: var(--muted); min-width: 24px; }

#transpose-down, #transpose-up, #transpose-reset {
  flex: none; min-width: 32px; height: 32px; padding: 0 8px; display: inline-flex;
  align-items: center; justify-content: center; background: var(--accent); color: #fff;
  border: none; border-radius: 999px; font-family: var(--font-heading); font-weight: 600;
  font-size: 15px; cursor: pointer;
}
#transpose-down:hover, #transpose-up:hover, #transpose-reset:hover { opacity: 0.88; }
#transpose-down:disabled, #transpose-up:disabled { opacity: 0.4; cursor: default; }
#transpose-reset { background: transparent; color: var(--muted); border: 1px solid var(--divider); font-size: 12px; padding: 0 10px; }
#transpose-readout { font-family: var(--font-heading); font-weight: 600; font-size: 14px; color: var(--muted); min-width: 26px; text-align: center; }
.capo-suggestion { font-family: var(--font-body); font-size: 12.5px; color: var(--accent-text); white-space: nowrap; }
body.transpose-active .chord-sheet .chord.has-diagram { cursor: default; text-decoration: none; }
body.transpose-active .chord-sheet .chord-tooltip { display: none !important; }

@media (max-width: 420px) {
  main { padding: 18px 14px 56px; }
  h1.page-title { font-size: 28px; }
  h1.title { font-size: 27px; }
  .song-list .artist { max-width: 38%; }
  .song-control-bars { bottom: 12px; gap: 6px; }
  .autoscroll-bar, .transpose-bar { padding: 6px 12px 6px 6px; gap: 8px; }
  #autoscroll-speed-range { width: 68px; }
}

@media print {
  .site-header, .search-wrap, .az-jump, .genre-filter, .song-nav, .spotify-link, .song-control-bars { display: none !important; }
  body { background: #fff; color: #000; font-size: 12pt; }
  a { color: #000; text-decoration: none; }
  main { max-width: 100%; margin: 0; padding: 0; }
  h1.title { font-size: 22pt; }
  h2.subtitle { color: #333; }
  .genre-badge { display: none; }
  .song-divider { background: #999; }
  .chord-sheet .chord { color: #000; }
  .chord-sheet .comment { border-left-color: #999; color: #333; }
  .chord-sheet .tab-block { border-color: #999; background: #fff; -webkit-print-color-adjust: exact; }
  .chord-sheet .chord-tooltip { display: none !important; }
  @page { margin: 1.2cm; }
}
`;

const FAVICON_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>
<rect width='64' height='64' rx='14' fill='#b68235'/>
<ellipse cx='24' cy='46' rx='8' ry='6' transform='rotate(-15 24 46)' fill='#fdf8f0'/>
<rect x='30' y='14' width='4' height='34' fill='#fdf8f0'/>
<path d='M34 14 Q48 18 46 30 Q44 24 34 24 Z' fill='#fdf8f0'/>
</svg>`;
const FAVICON_HREF = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`;

const THEME_TOGGLE_ICONS = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></svg>',
};

const SEARCH_SCRIPT = `<script>
(function () {
  var input = document.getElementById('song-search');
  var items = Array.prototype.slice.call(document.querySelectorAll('#song-list li'));
  var groups = Array.prototype.slice.call(document.querySelectorAll('.letter-group'));
  var genreButtons = Array.prototype.slice.call(document.querySelectorAll('.genre-filter button'));
  var countEl = document.getElementById('song-count');
  var noResultsEl = document.getElementById('no-results');
  var total = items.length;
  var activeGenre = null;
  function filter() {
    var q = input.value.trim().toLowerCase();
    var visible = 0;
    items.forEach(function (li) {
      var matchesText = !q || li.dataset.title.indexOf(q) !== -1 || li.dataset.artist.indexOf(q) !== -1;
      var matchesGenre = !activeGenre || li.dataset.genre === activeGenre;
      var match = matchesText && matchesGenre;
      li.classList.toggle('hidden', !match);
      if (match) visible++;
    });
    groups.forEach(function (g) {
      var anyVisible = g.querySelector('li:not(.hidden)');
      g.style.display = anyVisible ? '' : 'none';
    });
    countEl.textContent = (q || activeGenre) ? (visible + ' of ' + total + ' songs.') : (total + ' songs.');
    noResultsEl.style.display = visible === 0 ? 'block' : 'none';
  }
  input.addEventListener('input', filter);
  genreButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var g = btn.dataset.genre;
      activeGenre = activeGenre === g ? null : g;
      genreButtons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.genre === activeGenre)); });
      filter();
    });
  });
})();
</script>`;

// :hover/:focus alone cover mouse and keyboard, but touch devices don't hover -
// tapping a chord toggles its tooltip open, tapping elsewhere closes it.
const CHORD_TOOLTIP_SCRIPT = `<script>
(function () {
  var chords = Array.prototype.slice.call(document.querySelectorAll('.chord.has-diagram'));
  if (!chords.length) return;
  chords.forEach(function (el) {
    el.addEventListener('click', function (e) {
      var wasOpen = el.classList.contains('tooltip-open');
      chords.forEach(function (c) { c.classList.remove('tooltip-open'); });
      if (!wasOpen) el.classList.add('tooltip-open');
      e.stopPropagation();
    });
  });
  document.addEventListener('click', function () {
    chords.forEach(function (c) { c.classList.remove('tooltip-open'); });
  });
})();
</script>`;

// The Spotify player iframe isn't inserted until the button is clicked, so
// song pages don't pay for a third-party embed load until someone asks for it.
const SPOTIFY_EMBED_SCRIPT = `<script>
(function () {
  var btn = document.querySelector('.spotify-play-btn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var container = btn.parentElement.nextElementSibling;
    var iframe = document.createElement('iframe');
    iframe.src = 'https://open.spotify.com/embed/track/' + btn.dataset.trackId + '?utm_source=generator';
    iframe.width = '100%';
    iframe.height = '152';
    iframe.frameBorder = '0';
    iframe.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
    iframe.loading = 'lazy';
    container.appendChild(iframe);
    container.hidden = false;
    btn.hidden = true;
  });
})();
</script>`;

const AUTOSCROLL_ICONS = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
};

// Scrolls the page at a steady rate via requestAnimationFrame (frame-rate independent,
// unlike a setInterval + fixed-pixel step). Speed is a 1-10 dial persisted in
// localStorage; any manual wheel/touch scroll outside the control bar cancels playback,
// since at that point the reader has taken over.
const AUTOSCROLL_SCRIPT = `<script>
(function () {
  var bar = document.querySelector('.autoscroll-bar');
  if (!bar) return;
  var toggleBtn = document.getElementById('autoscroll-toggle');
  var range = document.getElementById('autoscroll-speed-range');
  var speedLabel = document.getElementById('autoscroll-speed-label');
  var ICONS = ${JSON.stringify(AUTOSCROLL_ICONS)};
  var PX_PER_SEC_PER_UNIT = 7;
  var scrolling = false;
  var rafId = null;
  var lastTime = null;
  var pxRemainder = 0;
  var stored = parseFloat(localStorage.getItem('autoscroll-speed'));
  var speed = isNaN(stored) ? 3 : Math.min(10, Math.max(1, stored));

  range.value = String(speed);
  speedLabel.textContent = speed + '×';
  toggleBtn.innerHTML = ICONS.play;

  function atBottom() {
    return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 1;
  }

  function step(timestamp) {
    if (!scrolling) return;
    if (lastTime != null) {
      var dt = (timestamp - lastTime) / 1000;
      pxRemainder += speed * PX_PER_SEC_PER_UNIT * dt;
      var delta = Math.floor(pxRemainder);
      if (delta > 0) {
        window.scrollBy(0, delta);
        pxRemainder -= delta;
      }
      if (atBottom()) {
        stop();
        return;
      }
    }
    lastTime = timestamp;
    rafId = requestAnimationFrame(step);
  }

  function start() {
    if (atBottom()) return;
    scrolling = true;
    lastTime = null;
    pxRemainder = 0;
    toggleBtn.innerHTML = ICONS.pause;
    toggleBtn.setAttribute('aria-label', 'Pause auto-scroll');
    rafId = requestAnimationFrame(step);
  }

  function stop() {
    scrolling = false;
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = null;
    toggleBtn.innerHTML = ICONS.play;
    toggleBtn.setAttribute('aria-label', 'Start auto-scroll');
  }

  toggleBtn.addEventListener('click', function () {
    if (scrolling) stop(); else start();
  });

  range.addEventListener('input', function () {
    speed = parseFloat(range.value);
    localStorage.setItem('autoscroll-speed', String(speed));
    speedLabel.textContent = speed + '×';
  });

  ['wheel', 'touchstart'].forEach(function (evt) {
    window.addEventListener(evt, function (e) {
      if (scrolling && !bar.contains(e.target)) stop();
    }, { passive: true });
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && scrolling) stop();
  });
})();
</script>`;

// Transposes displayed chord names client-side from each .chord div's
// data-chord (the untransposed original — always re-parsed from there, never
// from already-mutated text, so repeated +/- clicks never compound rounding
// or parsing error). Offset never persists (resets to 0 on load, unlike
// autoscroll speed). When a song's {key:} is known (data-key on
// .transpose-bar), also recommends a capo fret + open-shape key. Chords this
// can't parse are left exactly as rendered — mirrors chord-diagrams.js's
// "silently skip what can't be resolved" philosophy. Diagram tooltips are
// baked in at build time for the original key only, so they're suppressed via
// the body.transpose-active CSS rule (see CHROME_CSS) whenever offset !== 0,
// rather than risk showing a now-wrong fretboard.
const TRANSPOSE_SCRIPT = `<script>
(function () {
  var bar = document.querySelector('.transpose-bar');
  if (!bar) return;
  var chordEls = Array.prototype.slice.call(document.querySelectorAll('.chord[data-chord]'));
  var downBtn = document.getElementById('transpose-down');
  var upBtn = document.getElementById('transpose-up');
  var resetBtn = document.getElementById('transpose-reset');
  var readout = document.getElementById('transpose-readout');
  var capoEl = document.getElementById('capo-suggestion');
  var songKey = bar.dataset.key || '';

  // Keep in sync with SEMITONE_TO_KEY / NOTE_TO_SEMITONE in scripts/chord-diagrams.js.
  var SEMITONE_TO_KEY = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  var NOTE_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var EASY_KEYS = ['C', 'G', 'D', 'A', 'E']; // tunable: major open-chord shapes to recommend into
  var EASY_KEY_SEMITONES = EASY_KEYS.map(noteToSemitone);
  var MIN_OFFSET = -11, MAX_OFFSET = 11;
  var offset = 0;

  function noteToSemitone(note) {
    if (!note) return null;
    var letter = note.charAt(0).toUpperCase();
    if (!(letter in NOTE_TO_SEMITONE)) return null;
    var semitone = NOTE_TO_SEMITONE[letter];
    for (var i = 1; i < note.length; i++) {
      var ch = note.charAt(i);
      if (ch === '#') semitone += 1;
      else if (ch === 'b') semitone -= 1;
      else return null;
    }
    return ((semitone % 12) + 12) % 12;
  }

  // "F#m7/A" -> { root: "F#", suffix: "m7", bass: "A" }; null if root/bass unparseable.
  var CHORD_RE = /^([A-Ga-g])([#b]*)([^\\/]*)(?:\\/([A-Ga-g][#b]*))?$/;
  function parseChord(name) {
    var m = CHORD_RE.exec(name.trim());
    if (!m) return null;
    var root = m[1].toUpperCase() + m[2];
    if (noteToSemitone(root) === null) return null;
    if (m[4] && noteToSemitone(m[4]) === null) return null;
    return { root: root, suffix: m[3] || '', bass: m[4] || null };
  }

  function transposeNote(note, delta) {
    var s = noteToSemitone(note);
    if (s === null) return null;
    return SEMITONE_TO_KEY[((s + delta) % 12 + 12) % 12];
  }

  function transposeChordName(name, delta) {
    if (delta === 0) return name;
    var parsed = parseChord(name);
    if (!parsed) return name;
    var newRoot = transposeNote(parsed.root, delta);
    if (newRoot === null) return name;
    var result = newRoot + parsed.suffix;
    if (parsed.bass) {
      var newBass = transposeNote(parsed.bass, delta);
      if (newBass === null) return name; // bail whole chord rather than half-transpose it
      result += '/' + newBass;
    }
    return result;
  }

  function updateCapoSuggestion() {
    if (!capoEl) return;
    var keyMatch = /^([A-Ga-g])([#b]*)$/.exec(songKey.trim());
    if (!songKey || !keyMatch) { capoEl.hidden = true; return; } // no key, or e.g. minor "Am" -> fail closed
    var keySemitone = noteToSemitone(keyMatch[1].toUpperCase() + keyMatch[2]);
    var target = ((keySemitone + offset) % 12 + 12) % 12;
    for (var c = 0; c <= 7; c++) {
      var shape = ((target - c) % 12 + 12) % 12;
      var idx = EASY_KEY_SEMITONES.indexOf(shape);
      if (idx !== -1) {
        capoEl.textContent = c === 0
          ? ('Play in ' + EASY_KEYS[idx] + ' shapes (no capo)')
          : ('Capo ' + c + ' — play in ' + EASY_KEYS[idx] + ' shapes');
        capoEl.hidden = false;
        return;
      }
    }
    capoEl.hidden = true; // unreachable given EASY_KEYS' <=3-semitone spacing, kept defensive
  }

  function render() {
    chordEls.forEach(function (el) {
      if (el.firstChild && el.firstChild.nodeType === 3) {
        el.firstChild.nodeValue = transposeChordName(el.dataset.chord, offset);
      }
    });
    document.body.classList.toggle('transpose-active', offset !== 0);
    readout.textContent = (offset > 0 ? '+' : '') + offset;
    resetBtn.hidden = offset === 0;
    downBtn.disabled = offset <= MIN_OFFSET;
    upBtn.disabled = offset >= MAX_OFFSET;
    updateCapoSuggestion();
  }

  function setOffset(n) {
    offset = Math.max(MIN_OFFSET, Math.min(MAX_OFFSET, n));
    render();
  }

  downBtn.addEventListener('click', function () { setOffset(offset - 1); });
  upBtn.addEventListener('click', function () { setOffset(offset + 1); });
  resetBtn.addEventListener('click', function () { setOffset(0); });
  render();
})();
</script>`;

function listSongFiles() {
  return fs.readdirSync(SHEETS_DIR)
    .filter((f) => f.endsWith('.chordpro'))
    .sort();
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Tab blocks ({sot}...{eot} / {start_of_tab}...{end_of_tab}) are ASCII string
// diagrams — chordsheetjs's chord/lyric column layout would re-flow their
// spacing and break alignment. Pull each block out before parsing (leaving a
// placeholder comment tag chordsheetjs passes through untouched), then swap
// the placeholder for a monospace block after formatting.
function extractTabs(content) {
  const tabs = [];
  const replaced = content.replace(
    /\{(?:sot|start_of_tab)\}[ \t]*\r?\n([\s\S]*?)\r?\n?\{(?:eot|end_of_tab)\}/gi,
    (match, body) => {
      const token = `__TAB_BLOCK_${tabs.length}__`;
      tabs.push(body.replace(/\n$/, ''));
      return `{comment: ${token}}`;
    },
  );
  return { replaced, tabs };
}

function injectTabs(html, tabs) {
  if (!tabs.length) return html;
  return html.replace(/<div class="comment">__TAB_BLOCK_(\d+)__<\/div>/g, (match, idx) => {
    const body = tabs[Number(idx)];
    return `<div class="tab"><span class="tab-label">Tab</span><pre class="tab-block">${escapeHtml(body)}</pre></div>`;
  });
}

function slugFor(filename) {
  return filename.replace(/\.chordpro$/, '');
}

function buildChordDiagramsStrip(chordNames, diagrams) {
  const cards = chordNames
    .filter((name) => diagrams[name])
    .map(
      (name) =>
        `<div class="chord-diagram-card"><span class="chord-diagram-name">${escapeHtml(name)}</span>${diagrams[name]}</div>`
    )
    .join('\n');
  if (!cards) return '';
  return `<div class="chord-diagrams">\n${cards}\n</div>`;
}

// Adds data-chord="OriginalName" to every rendered <div class="chord">Name</div>
// (so the client-side transpose script always transposes from the canonical
// original name, never from already-transposed text), and wraps chords with a
// known diagram in a hover/focus/tap tooltip. Chords without a resolved
// diagram (see chord-diagrams.js) get the data attribute but no tooltip.
function injectChordData(html, diagrams) {
  return html.replace(/<div class="chord">([^<]*)<\/div>/g, (match, name) => {
    const dataAttr = ` data-chord="${escapeHtml(name)}"`;
    const svg = diagrams[name];
    if (!svg) return `<div class="chord"${dataAttr}>${name}</div>`;
    return `<div class="chord has-diagram"${dataAttr} tabindex="0">${name}<span class="chord-tooltip">${svg}</span></div>`;
  });
}

function pageShell({ title, bodyHtml, isSongPage, description, songKey, hasChords }) {
  const stylesheetHref = isSongPage ? '../style.css' : 'style.css';
  const homeHref = isSongPage ? '../index.html' : null;
  const header = isSongPage
    ? `<a class="back" href="${homeHref}">&larr; Song list</a>`
    : `<span class="brand">Lead Sheets</span>`;
  const desc = escapeHtml(description || 'Personal collection of ChordPro lead sheets.');
  const autoscrollBarHtml = isSongPage
    ? `<div class="autoscroll-bar" role="group" aria-label="Auto-scroll controls">
<button id="autoscroll-toggle" type="button" aria-label="Start auto-scroll"></button>
<div class="autoscroll-speed">
<input type="range" id="autoscroll-speed-range" min="1" max="10" step="1" value="3" aria-label="Auto-scroll speed">
<span id="autoscroll-speed-label">3&times;</span>
</div>
</div>`
    : '';
  const transposeBarHtml = isSongPage && hasChords
    ? `<div class="transpose-bar" data-key="${escapeHtml(songKey || '')}" role="group" aria-label="Transpose controls">
<button id="transpose-down" type="button" aria-label="Transpose down one semitone">&minus;</button>
<span id="transpose-readout" aria-live="polite">0</span>
<button id="transpose-up" type="button" aria-label="Transpose up one semitone">&plus;</button>
<button id="transpose-reset" type="button" aria-label="Reset transpose" hidden>Reset</button>
<span id="capo-suggestion" class="capo-suggestion" aria-live="polite" hidden></span>
</div>`
    : '';
  const controlBarsHtml = isSongPage
    ? `<div class="song-control-bars">${transposeBarHtml}${autoscrollBarHtml}</div>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${desc}">
<link rel="icon" href="${FAVICON_HREF}">
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
<main${isSongPage ? ` class="has-autoscroll${hasChords ? ' has-transpose' : ''}"` : ''}>
${bodyHtml}
</main>
${controlBarsHtml}
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
${isSongPage ? `${CHORD_TOOLTIP_SCRIPT}\n${SPOTIFY_EMBED_SCRIPT}\n${TRANSPOSE_SCRIPT}\n${AUTOSCROLL_SCRIPT}` : SEARCH_SCRIPT}
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
        .map(({ title, artist, genre, slug }) => `<li data-title="${escapeHtml(title.toLowerCase())}" data-artist="${escapeHtml(artist.toLowerCase())}" data-genre="${escapeHtml(genre)}"><a href="songs/${slug}.html"><span class="title-wrap"><span class="title">${escapeHtml(title)}</span>${genre ? `<span class="genre">${escapeHtml(genre)}</span>` : ''}</span>${artist ? `<span class="artist">${escapeHtml(artist)}</span>` : ''}</a></li>`)
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

  // Only render a pill for genres actually present in the collection, in GENRES order,
  // so an empty bucket (e.g. no Country songs yet) doesn't show up as a dead filter.
  const genreCounts = new Map();
  entries.forEach((e) => genreCounts.set(e.genre, (genreCounts.get(e.genre) || 0) + 1));
  const genreFilterHtml = GENRES.filter((g) => genreCounts.has(g))
    .map((g) => `<button type="button" data-genre="${escapeHtml(g)}" aria-pressed="false">${escapeHtml(g)} <span class="n">${genreCounts.get(g)}</span></button>`)
    .join('\n');

  const bodyHtml = `<h1 class="page-title">Song Index</h1>
<div class="search-wrap">
<input type="search" id="song-search" placeholder="Search by title or artist&hellip;" aria-label="Search songs by title or artist">
<p id="song-count">${entries.length} songs.</p>
</div>
<div class="genre-filter" role="group" aria-label="Filter by genre">${genreFilterHtml}</div>
<nav class="az-jump" aria-label="Jump to letter">${jumpHtml}</nav>
<p id="no-results">No songs match your search.</p>
${groupsHtml}`;
  return pageShell({
    title: 'Song Index',
    bodyHtml,
    isSongPage: false,
    description: `${entries.length} personal chord/lyric lead sheets, searchable by title or artist and filterable by genre.`,
  });
}

function songNavHtml(prev, next) {
  const prevHtml = prev
    ? `<a href="${prev.slug}.html"><span class="dir">&larr; Prev</span><span class="nav-title">${escapeHtml(prev.title)}</span></a>`
    : '<span></span>';
  const nextHtml = next
    ? `<a class="next" href="${next.slug}.html"><span class="dir">Next &rarr;</span><span class="nav-title">${escapeHtml(next.title)}</span></a>`
    : '<span></span>';
  return `<nav class="song-nav" aria-label="Song navigation">${prevHtml}${nextHtml}</nav>`;
}

function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(SONGS_DIR, { recursive: true });

  const files = listSongFiles();
  const spotifyLinks = loadSpotifyLinks();
  const entries = [];

  files.forEach((filename) => {
    const rawContent = fs.readFileSync(path.join(SHEETS_DIR, filename), 'utf8');
    const { replaced: content, tabs } = extractTabs(rawContent);
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
    const genre = song.metadata.getSingle('genre') || '';
    // HtmlDivFormatter's own output already includes <h1 class="title"> (and
    // <h2 class="subtitle"> when present) ahead of the chord sheet, so we
    // only need to splice in the divider rather than render our own heading
    // (which would duplicate the formatter's).
    const chordNames = song.getChords();
    const hasChords = chordNames.length > 0;
    const diagrams = buildChordDiagrams(chordNames);
    const diagramsStrip = buildChordDiagramsStrip(chordNames, diagrams);
    const chordSheetHtml = injectChordData(injectTabs(new HtmlDivFormatter().format(song), tabs), diagrams);
    const spotify = spotifyLinks[filename];
    const spotifyLinkHtml = spotify
      ? `<p class="spotify-link"><a href="${escapeHtml(spotify.url)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.559.3z"/></svg>Listen on Spotify</a><button type="button" class="spotify-play-btn" data-track-id="${escapeHtml(spotify.id)}">&#9654; Play preview</button></p><div class="spotify-embed" hidden></div>`
      : '';
    const genreBadgeHtml = genre ? `<p class="genre-badge">${escapeHtml(genre)}</p>` : '';
    const bodyHtml = chordSheetHtml.replace(
      '<div class="chord-sheet">',
      `${genreBadgeHtml}<hr class="song-divider">\n${spotifyLinkHtml}\n${diagramsStrip}\n<div class="chord-sheet">`
    );
    entries.push({ title, artist, genre, slug, bodyHtml, songKey: song.key || '', hasChords });
  });

  entries.sort((a, b) => a.title.localeCompare(b.title));

  // Written after sorting so each page can link to its alphabetical
  // neighbors (prev/next nav), letting you flip through songs in order
  // without returning to the index each time.
  entries.forEach((entry, i) => {
    const prev = i > 0 ? entries[i - 1] : null;
    const next = i < entries.length - 1 ? entries[i + 1] : null;
    const bodyHtml = entry.bodyHtml + songNavHtml(prev, next);
    const description = `Chords and lyrics for "${entry.title}"${entry.artist ? ` by ${entry.artist}` : ''}.`;
    fs.writeFileSync(
      path.join(SONGS_DIR, `${entry.slug}.html`),
      pageShell({ title: entry.title, bodyHtml, isSongPage: true, description, songKey: entry.songKey, hasChords: entry.hasChords })
    );
  });

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
