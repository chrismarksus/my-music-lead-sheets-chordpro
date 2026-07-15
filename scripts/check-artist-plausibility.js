#!/usr/bin/env node
// Flags {st:} artist directives that look like a lyric fragment or song subtitle rather
// than an actual performer/composer credit — the failure mode that put "The Triumphal
// Entry Song", "I Will Praise", and "Falling On My Knees" in the artist field of songs
// whose real credit was sitting one line down in {c:}. (A related case, "The Temptations"
// misattributed to a Casey Corum worship song, came from a bad Spotify-driven guess rather
// than this pattern, but is the same underlying risk: {st:} content nobody fact-checked.)
//
//   node scripts/check-artist-plausibility.js
//
// Advisory only — prints findings for human review and always exits 0. Telling a real (if
// obscure) composer name apart from a mis-filed lyric snippet needs judgment a script can't
// fully automate, so this isn't part of the lint/check pipeline (same reasoning as
// fetch-spotify-links.js not being in it).
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHEETS_DIR = path.join(ROOT, 'sheets');

function listSongFiles() {
  return fs.readdirSync(SHEETS_DIR)
    .filter((f) => f.endsWith('.chordpro'))
    .sort();
}

function extractDirective(content, name) {
  const m = content.match(new RegExp(`\\{${name}:([^}]*)\\}`));
  return m ? m[1].trim() : '';
}

function extractAll(content, name) {
  const re = new RegExp(`\\{${name}:([^}]*)\\}`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(content))) out.push(m[1].trim());
  return out;
}

function normalize(str) {
  return str.toLowerCase().replace(/[[\]{}()*.,'!?]/g, '').replace(/\s+/g, ' ').trim();
}

// Strip ChordPro directives and chord brackets so lyric text can be compared as plain text.
function lyricText(content) {
  return content.replace(/\{[^}]*\}/g, ' ').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ');
}

// Known-intentional non-artist {st:} conventions (see CONTRIBUTING.md): a Bible reference,
// or an arrangement/reading/traditional note. Mirrors isJunkArtist() in fetch-spotify-links.js
// — kept in sync by hand since the two scripts check different things (Spotify search input
// vs. lyric-fragment detection) and a shared helper would couple them for no real benefit.
const BIBLE_BOOK_RE = /\b(genesis|exodus|leviticus|numbers|deuteronomy|joshua|judges|ruth|samuel|kings|chronicles|ezra|nehemiah|esther|job|psalms?|proverbs|ecclesiastes|song of (?:songs|solomon)|isaiah|jeremiah|lamentations|ezekiel|daniel|hosea|joel|amos|obadiah|jonah|micah|nahum|habakkuk|zephaniah|haggai|zechariah|malachi|matthew|mark|luke|john|acts|romans|corinthians|galatians|ephesians|phil+ippians|colossians|thessalonians|timothy|titus|philemon|hebrews|james|peter|revelation)\b/i;
const NON_ARTIST_WORD_RE = /\b(version|reading|verses|arrangement|ending|intro|outro|bridge|medley|adapted|traditional)\b/i;

function isKnownConvention(artist) {
  if (BIBLE_BOOK_RE.test(artist) && /\d/.test(artist)) return true;
  if (NON_ARTIST_WORD_RE.test(artist)) return true;
  return false;
}

function findFlags(files) {
  const flagged = [];
  files.forEach((filename) => {
    const content = fs.readFileSync(path.join(SHEETS_DIR, filename), 'utf8');
    const artist = extractDirective(content, 'st');
    if (!artist || isKnownConvention(artist)) return;

    const normArtist = normalize(artist);
    const normLyrics = normalize(lyricText(content));
    // A short match (e.g. a two-word artist name) is too likely to collide with ordinary
    // lyric text by chance; require enough length that a coincidental substring match is
    // implausible.
    if (normArtist.length >= 6 && normLyrics.includes(normArtist)) {
      const composers = extractAll(content, 'c').filter((c) => !/^\(c\)|https?:\/\//i.test(c));
      flagged.push({ filename, artist, composers });
    }
  });
  return flagged;
}

function main() {
  const files = listSongFiles();
  const flagged = findFlags(files);

  if (!flagged.length) {
    console.log(`check-artist-plausibility: ${files.length} songs checked, no likely lyric-fragment-as-artist cases found.`);
    return;
  }

  console.log(
    `check-artist-plausibility: ${flagged.length} of ${files.length} songs have an {st:} value that also appears ` +
      `verbatim in their own lyrics — likely a lyric fragment or subtitle was filed as the artist. Review before trusting:\n`
  );
  flagged.forEach((f) => {
    console.log(`  ${f.filename}`);
    console.log(`    {st:${f.artist}}`);
    if (f.composers.length) console.log(`    {c:} credits on file: ${f.composers.join(' | ')}`);
    console.log('');
  });
}

main();
