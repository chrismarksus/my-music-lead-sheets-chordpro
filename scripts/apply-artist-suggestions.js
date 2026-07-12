#!/usr/bin/env node
// One-off backfill: for every .chordpro file with no {st:} artist directive, writes one
// using the Spotify match recorded in data/spotify-links.json (confidence "unverified" —
// see scripts/fetch-spotify-links.js), then updates INDEX.md's Artist column to match.
//
// These matches were never checked against an existing artist (there wasn't one), so a
// trailing " ?" is appended to the {st:} value when the match looks untrustworthy (a
// cover/kids/karaoke channel, or a live/arranged/instrumental version) — search for " ?}"
// to find and manually fix those.
//
//   node scripts/apply-artist-suggestions.js
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHEETS_DIR = path.join(ROOT, 'sheets');
const INDEX_PATH = path.join(ROOT, 'INDEX.md');

const LOW_TRUST_ARTIST_RE = /kids|karaoke|tribute|cover|made famous|sing.?along|hit crew|vbs|sunday school|worship together|lifetree|instrumental|players club|sound.?alike/i;
const LOW_TRUST_TRACK_RE = /\(live|\(cover|karaoke|instrumental|\barr\.|reprise|medley|\(demo|tribute/i;

function isLowTrust(artistName, trackName) {
  return LOW_TRUST_ARTIST_RE.test(artistName) || LOW_TRUST_TRACK_RE.test(trackName);
}

function insertSubtitle(content, stValue) {
  const m = content.match(/^(\{t:[^}]*\})(\r\n|\r|\n)/);
  if (!m) return null;
  const [full, titleLine, eol] = m;
  return content.slice(0, full.length) + `{st:${stValue}}${eol}` + content.slice(full.length);
}

function main() {
  const links = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'spotify-links.json'), 'utf8'));
  let indexContent = fs.readFileSync(INDEX_PATH, 'utf8');

  let applied = 0;
  let lowTrust = 0;
  let skipped = 0;

  for (const [filename, entry] of Object.entries(links)) {
    if (entry.confidence !== 'unverified' || !entry.track) continue;

    const filePath = path.join(SHEETS_DIR, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    if (/\{st:/.test(content)) {
      skipped++;
      continue;
    }

    const artistName = entry.track.artists.join(', ').replace(/\|/g, '-');
    const flagged = isLowTrust(artistName, entry.track.name);
    const stValue = flagged ? `${artistName} ?` : artistName;

    const updated = insertSubtitle(content, stValue);
    if (!updated) {
      console.error(`${filename}: couldn't find a {t:...} line to insert {st:} after, skipping`);
      skipped++;
      continue;
    }
    fs.writeFileSync(filePath, updated);
    applied++;
    if (flagged) lowTrust++;

    const rowRe = new RegExp(`(\\|\\s*${entry.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\|\\s*)(\\s*)(\\|\\s*\\[.*?\\]\\(sheets/${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\s*\\|)`);
    if (rowRe.test(indexContent)) {
      indexContent = indexContent.replace(rowRe, `$1${stValue}$3`);
    } else {
      console.error(`${filename}: couldn't find its INDEX.md row to update artist column`);
    }
  }

  fs.writeFileSync(INDEX_PATH, indexContent);

  console.log(`apply-artist-suggestions: ${applied} files updated (${lowTrust} flagged low-trust with " ?"), ${skipped} skipped.`);
}

main();
