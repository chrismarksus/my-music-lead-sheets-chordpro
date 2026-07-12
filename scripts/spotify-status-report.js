#!/usr/bin/env node
// Generates a local-only HTML status report (data/spotify-status.html) summarizing Spotify
// match coverage across sheets/. This is a maintenance view for the repo owner — it is
// gitignored and build-site.js never reads it, so it's never published to the public site.
//
//   node scripts/spotify-status-report.js
//
// Reads data/spotify-links.json (written by fetch-spotify-links.js) for match/confidence
// data, but reads each .chordpro file directly for the *current* {st:} artist — that can
// drift from what's recorded in spotify-links.json (e.g. right after
// scripts/apply-artist-suggestions.js backfills a file, before the next fetch re-verifies
// it), so "pending re-verification" is tracked as its own metric rather than silently
// showing stale data as current.
//
// Diffs against data/spotify-links.previous.json when fetch-spotify-links.js has left one
// (it rotates the previous run's snapshot there before overwriting spotify-links.json).
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHEETS_DIR = path.join(ROOT, 'sheets');
const DATA_DIR = path.join(ROOT, 'data');
const LINKS_PATH = path.join(DATA_DIR, 'spotify-links.json');
const PREVIOUS_PATH = path.join(DATA_DIR, 'spotify-links.previous.json');
const REPORT_PATH = path.join(DATA_DIR, 'spotify-status.html');

function listSongFiles() {
  return fs.readdirSync(SHEETS_DIR)
    .filter((f) => f.endsWith('.chordpro'))
    .sort();
}

function extractDirective(content, name) {
  const match = content.match(new RegExp(`\\{${name}:([^}]*)\\}`));
  return match ? match[1].trim() : '';
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function statusFor(entry) {
  if (!entry) return { key: 'unverified', label: 'Not yet checked' };
  if (entry.confidence === 'high') return { key: 'linked', label: 'Linked' };
  if (entry.confidence === 'low') return { key: 'review', label: 'Needs review' };
  if (entry.confidence === 'error') return { key: 'unverified', label: 'Lookup failed' };
  return { key: 'unverified', label: entry.track ? 'No artist listed' : 'No match found' };
}

// {c:...see also X.chordpro} cross-references mark alternate arrangements of the same
// song (see CONTRIBUTING.md) — they should usually end up with matching link status.
function crossReferencePairs(files) {
  const fileSet = new Set(files);
  const pairs = new Set();
  files.forEach((f) => {
    const content = fs.readFileSync(path.join(SHEETS_DIR, f), 'utf8');
    const m = content.match(/\{c:[^}]*see also\s+([A-Za-z0-9_.-]+\.chordpro)/i);
    if (m && fileSet.has(m[1])) pairs.add([f, m[1]].sort().join('::'));
  });
  return Array.from(pairs).map((p) => p.split('::'));
}

function buildRows(files, links) {
  return files.map((filename) => {
    const content = fs.readFileSync(path.join(SHEETS_DIR, filename), 'utf8');
    const title = extractDirective(content, 't') || filename;
    const liveArtist = extractDirective(content, 'st');
    const stDirective = content.match(/\{st:[^}]*\}/);
    const entry = links[filename];
    return {
      filename,
      title,
      artist: liveArtist,
      status: statusFor(entry),
      lowTrust: /\s\?\}$/.test(stDirective ? stDirective[0] : ''),
      stale: Boolean(entry) && (entry.artist || '') !== liveArtist,
      matchedTrack: entry?.track?.name || '',
      matchedArtists: entry?.track?.artists?.join(', ') || '',
      url: entry?.track?.url || '',
    };
  }).sort((a, b) => a.title.localeCompare(b.title));
}

function buildHtml({ rows, counts, diffRows, mismatchedPairs, lastVerified, hasPrevious }) {
  const rowsJson = JSON.stringify(rows);
  const diffSection = diffRows.length
    ? `<section class="panel">
        <h2>Since last run</h2>
        <p class="panel-dek">${diffRows.length} song(s) changed status.</p>
        <table class="mini-table"><tbody>
          ${diffRows.map((d) => `<tr><td class="title-cell">${escapeHtml(d.title)}</td><td>${escapeHtml(d.before)} &rarr; ${escapeHtml(d.after)}</td></tr>`).join('')}
        </tbody></table>
      </section>`
    : `<section class="panel"><h2>Since last run</h2><p class="panel-dek">${hasPrevious ? 'No status changes since the previous run.' : 'No previous run recorded yet — this is the first report.'}</p></section>`;

  const mismatchSection = mismatchedPairs.length
    ? `<section class="panel">
        <h2>Alternate arrangements with mismatched status</h2>
        <p class="panel-dek">Cross-referenced songs (see CONTRIBUTING.md) whose link status disagrees — often an easy manual fix.</p>
        <table class="mini-table"><tbody>
          ${mismatchedPairs.map(({ a, b }) => `<tr><td class="title-cell">${escapeHtml(a.title)}</td><td><span class="pill ${a.status.key}">${a.status.label}</span></td><td class="vs">vs</td><td class="title-cell">${escapeHtml(b.title)}</td><td><span class="pill ${b.status.key}">${b.status.label}</span></td></tr>`).join('')}
        </tbody></table>
      </section>`
    : `<section class="panel"><h2>Alternate arrangements with mismatched status</h2><p class="panel-dek">None — all cross-referenced arrangement pairs agree.</p></section>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spotify link status</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Lora:ital,wght@0,400;0,600;1,400&display=swap');
:root {
  --bg: #f3f2f2; --surface: #eae9e9; --surface-2: #e2e0df; --text: #201f1d; --muted: #67635f;
  --divider: rgba(32, 31, 29, 0.14); --accent: #b68235; --accent-text: #7d5411;
  --linked: #4c7a52; --linked-bg: rgba(76, 122, 82, 0.13);
  --review: #a5631f; --review-bg: rgba(165, 99, 31, 0.13);
  --unverified: #5b6b73; --unverified-bg: rgba(91, 107, 115, 0.13);
  --stale: #8a5ea8; --stale-bg: rgba(138, 94, 168, 0.13);
  --font-heading: "Cormorant Garamond", Georgia, serif; --font-body: "Lora", Georgia, serif;
  --font-mono: ui-monospace, "Cascadia Mono", "SF Mono", Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1c1b1a; --surface: #242320; --surface-2: #2b2925; --text: #f1efec; --muted: #a49d94;
    --divider: rgba(241, 239, 236, 0.14); --accent: #dbaf70; --accent-text: #e7bd82;
    --linked: #8fc396; --linked-bg: rgba(143, 195, 150, 0.14);
    --review: #e3a05c; --review-bg: rgba(227, 160, 92, 0.14);
    --unverified: #9fb3bb; --unverified-bg: rgba(159, 179, 187, 0.13);
    --stale: #c39fe0; --stale-bg: rgba(195, 159, 224, 0.14);
  }
}
:root[data-theme="dark"] {
  --bg: #1c1b1a; --surface: #242320; --surface-2: #2b2925; --text: #f1efec; --muted: #a49d94;
  --divider: rgba(241, 239, 236, 0.14); --accent: #dbaf70; --accent-text: #e7bd82;
  --linked: #8fc396; --linked-bg: rgba(143, 195, 150, 0.14);
  --review: #e3a05c; --review-bg: rgba(227, 160, 92, 0.14);
  --unverified: #9fb3bb; --unverified-bg: rgba(159, 179, 187, 0.13);
  --stale: #c39fe0; --stale-bg: rgba(195, 159, 224, 0.14);
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font-body); font-size: 16px; line-height: 1.5; }
.wrap { max-width: 960px; margin: 0 auto; padding: 32px 22px 64px; }
h1 { font-family: var(--font-heading); font-weight: 700; font-size: 30px; margin: 0 0 4px; }
.dek { color: var(--muted); font-size: 15px; margin: 0 0 4px; max-width: 68ch; }
.meta { color: var(--muted); font-size: 13px; margin: 4px 0 22px; }
.meta code { font-family: var(--font-mono); background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }
.stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin: 0 0 22px; }
.stat { background: var(--surface); border: 1px solid var(--divider); border-radius: 10px; padding: 12px 14px; text-align: left; }
.stat .n { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-weight: 600; font-size: 26px; color: var(--stat-color, var(--text)); }
.stat .label { font-size: 12px; color: var(--muted); }
.stat.all { --stat-color: var(--accent-text); }
.stat.linked { --stat-color: var(--linked); background: var(--linked-bg); border-color: transparent; }
.stat.review { --stat-color: var(--review); background: var(--review-bg); border-color: transparent; }
.stat.unverified { --stat-color: var(--unverified); }
.stat.stale { --stat-color: var(--stale); background: var(--stale-bg); border-color: transparent; }
.panel { background: var(--surface); border: 1px solid var(--divider); border-radius: 10px; padding: 16px 18px; margin-bottom: 14px; }
.panel h2 { font-family: var(--font-heading); font-size: 18px; margin: 0 0 4px; }
.panel-dek { color: var(--muted); font-size: 13.5px; margin: 0 0 10px; }
.mini-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.mini-table td { padding: 6px 8px; border-bottom: 1px solid var(--divider); }
.mini-table tr:last-child td { border-bottom: none; }
.mini-table .vs { color: var(--muted); text-align: center; width: 30px; }
.toolbar { display: flex; gap: 10px; margin: 26px 0 4px; }
#search { flex: 1; padding: 10px 13px; font: inherit; font-size: 15px; color: var(--text); background: var(--surface); border: 1px solid var(--divider); border-radius: 8px; }
#count { color: var(--muted); font-size: 13px; margin: 10px 2px 8px; }
.table-scroll { overflow-x: auto; }
table.main { width: 100%; border-collapse: collapse; font-size: 14.5px; }
thead th { text-align: left; font-family: var(--font-heading); font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); padding: 8px 10px; border-bottom: 1px solid var(--divider); white-space: nowrap; }
tbody tr { border-bottom: 1px solid var(--divider); }
tbody tr:hover { background: var(--surface); }
tbody tr.hidden { display: none; }
td { padding: 9px 10px; vertical-align: top; }
td.title-cell { font-weight: 600; }
td.artist-cell { color: var(--muted); }
td.match-cell { color: var(--muted); font-size: 13.5px; }
td.match-cell a { color: var(--accent-text); text-decoration: none; }
td.match-cell a:hover { text-decoration: underline; }
.pill { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 999px; white-space: nowrap; }
.pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.pill.linked { color: var(--linked); background: var(--linked-bg); }
.pill.review { color: var(--review); background: var(--review-bg); }
.pill.unverified { color: var(--unverified); background: var(--unverified-bg); }
.flag { display: inline-block; margin-left: 6px; font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 5px; }
.flag.stale { color: var(--stale); background: var(--stale-bg); }
.flag.lowtrust { color: var(--review); background: var(--review-bg); }
#empty { display: none; padding: 30px 4px; color: var(--muted); text-align: center; }
@media (max-width: 700px) {
  .stats { grid-template-columns: repeat(2, 1fr); }
  thead { display: none; }
  table.main, tbody, tr, td { display: block; width: 100%; }
  tbody tr { padding: 10px 2px; }
  td { padding: 2px 0; }
  td.artist-cell::before { content: "by "; }
}
</style>
</head>
<body>
<div class="wrap">
  <h1>Spotify link status</h1>
  <p class="dek">Local maintenance view — not published to the site. All ${rows.length} lead sheets, checked against Spotify's catalog.</p>
  <p class="meta">Last verified <code>${lastVerified}</code> &middot; regenerate with <code>npm run spotify-status</code> (or automatically after <code>npm run fetch-spotify-links</code>)</p>

  <div class="stats">
    <div class="stat all"><span class="n">${rows.length}</span><span class="label">All songs</span></div>
    <div class="stat linked"><span class="n">${counts.linked}</span><span class="label">Linked</span></div>
    <div class="stat review"><span class="n">${counts.review}</span><span class="label">Needs review</span></div>
    <div class="stat unverified"><span class="n">${counts.unverified}</span><span class="label">No artist / no match</span></div>
    <div class="stat stale"><span class="n">${counts.stale}</span><span class="label">Pending re-verification</span></div>
  </div>

  ${diffSection}
  ${mismatchSection}

  <div class="toolbar">
    <input type="search" id="search" placeholder="Search by title or artist&hellip;" aria-label="Search songs">
  </div>
  <p id="count"></p>
  <div class="table-scroll">
    <table class="main">
      <thead><tr><th>Title</th><th>Artist</th><th>Status</th><th>Spotify match</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </div>
  <p id="empty">No songs match your search.</p>
</div>
<script>
const DATA = ${rowsJson};
const tbody = document.getElementById("rows");
tbody.innerHTML = DATA.map((row) => {
  const matchHtml = row.url
    ? \`<a href="\${row.url}" target="_blank" rel="noopener">\${esc(row.matchedTrack)} — \${esc(row.matchedArtists)}</a>\`
    : "—";
  const flags = (row.stale ? '<span class="flag stale" title="Artist on file differs from what was last verified">pending</span>' : '')
    + (row.lowTrust ? '<span class="flag lowtrust" title="Flagged as an uncertain match when backfilled">low-trust</span>' : '');
  return \`<tr data-title="\${esc(row.title.toLowerCase())}" data-artist="\${esc(row.artist.toLowerCase())}">
    <td class="title-cell">\${esc(row.title)}</td>
    <td class="artist-cell">\${esc(row.artist || "—")}\${flags}</td>
    <td><span class="pill \${row.status.key}">\${esc(row.status.label)}</span></td>
    <td class="match-cell">\${matchHtml}</td>
  </tr>\`;
}).join("");

function esc(str) { return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

const allRows = Array.from(tbody.querySelectorAll("tr"));
const searchInput = document.getElementById("search");
const countEl = document.getElementById("count");
const emptyEl = document.getElementById("empty");
function applyFilter() {
  const q = searchInput.value.trim().toLowerCase();
  let visible = 0;
  allRows.forEach((tr) => {
    const show = !q || tr.dataset.title.includes(q) || tr.dataset.artist.includes(q);
    tr.classList.toggle("hidden", !show);
    if (show) visible++;
  });
  countEl.textContent = \`\${visible} of \${allRows.length} songs\`;
  emptyEl.style.display = visible === 0 ? "block" : "none";
}
searchInput.addEventListener("input", applyFilter);
applyFilter();
</script>
</body>
</html>
`;
}

function main() {
  if (!fs.existsSync(LINKS_PATH)) {
    console.error('data/spotify-links.json not found — run `npm run fetch-spotify-links` first.');
    process.exit(1);
  }
  const links = JSON.parse(fs.readFileSync(LINKS_PATH, 'utf8'));
  const previous = fs.existsSync(PREVIOUS_PATH) ? JSON.parse(fs.readFileSync(PREVIOUS_PATH, 'utf8')) : null;
  const lastVerified = fs.statSync(LINKS_PATH).mtime.toISOString();

  const files = listSongFiles();
  const rows = buildRows(files, links);

  const counts = {
    linked: rows.filter((r) => r.status.key === 'linked').length,
    review: rows.filter((r) => r.status.key === 'review').length,
    unverified: rows.filter((r) => r.status.key === 'unverified').length,
    stale: rows.filter((r) => r.stale).length,
  };

  const diffRows = [];
  if (previous) {
    files.forEach((filename) => {
      const before = statusFor(previous[filename]).label;
      const after = statusFor(links[filename]).label;
      if (before !== after) {
        const row = rows.find((r) => r.filename === filename);
        diffRows.push({ filename, title: row ? row.title : filename, before, after });
      }
    });
  }

  const rowByFile = new Map(rows.map((r) => [r.filename, r]));
  const mismatchedPairs = crossReferencePairs(files)
    .map(([a, b]) => ({ a: rowByFile.get(a), b: rowByFile.get(b) }))
    .filter(({ a, b }) => a && b && a.status.key !== b.status.key);

  const html = buildHtml({ rows, counts, diffRows, mismatchedPairs, lastVerified, hasPrevious: Boolean(previous) });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, html);

  console.log(
    `spotify-status-report: wrote data/spotify-status.html — ${counts.linked} linked, ${counts.review} review, ` +
      `${counts.unverified} unverified, ${counts.stale} pending re-verification, ${diffRows.length} changed since last run.`
  );
}

main();
