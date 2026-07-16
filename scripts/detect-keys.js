#!/usr/bin/env node
// Infers a likely {key:X} for every song in sheets/ that doesn't already have one, from its
// chord vocabulary alone: each chord is scored against how well it fits the diatonic chord set
// of every candidate major/minor key (with partial credit for common borrowings — mixolydian
// bVII, borrowed minor iv, secondary dominants — since this collection leans worship/rock/pop),
// weighted a bit higher when the chord opens or closes a line.
//
// High-confidence guesses (a clear best-fit key with good chord coverage) are written directly
// into the file's {key:} directive, inserted next to {meta: genre ...} — the same spot the two
// pre-existing hand-tagged songs (sheets/trading_my_sorrows.chordpro,
// sheets/amazing_grace.chordpro) already use. Everything else is left for a human to review in
// data/key-suggestions.md (gitignored, mirrors data/artist-suggestions.md) rather than guessed
// into the file unsupervised — this is a chord-counting heuristic, not real harmonic analysis,
// and it will never be certain about a song that's genuinely ambiguous from chords alone (e.g.
// a I-IV-V-vi vocabulary fits its own key and the key a fourth away almost equally well).
//
//   node scripts/detect-keys.js
//
// Safe to re-run any time: it only ever looks at files that don't already have {key:}, so
// re-running after adding new songs (or after manually confirming a low-confidence guess)
// only touches what's new.
'use strict';

const fs = require('fs');
const path = require('path');
const { ChordProParser, ChordLyricsPair, Chord } = require('chordsheetjs');
const { noteToSemitone } = require('./chord-diagrams');

const ROOT = path.resolve(__dirname, '..');
const SHEETS_DIR = path.join(ROOT, 'sheets');
const DATA_DIR = path.join(ROOT, 'data');

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// Credit a chord earns toward a candidate key, keyed by its semitone offset from the
// candidate's tonic and its own quality (major/minor/dim; anything else — sus, add9, 7ths,
// etc. — is bucketed as major/minor by chord.root.minor before this lookup, see qualityOf()).
// 1.0 = fully diatonic. Lower values are common non-diatonic borrowings that show up often
// enough in this repo's worship/rock/pop songs to deserve partial credit rather than zero.
// Offsets not listed score 0 (chromatic to the candidate key).
const MAJOR_DEGREES = {
  0: { major: 1.0, minor: 0.15 }, // I (occasional borrowed minor tonic)
  2: { minor: 1.0, major: 0.4 }, // ii
  4: { minor: 1.0, major: 0.55 }, // iii (major here is often V/vi, a secondary dominant)
  5: { major: 1.0, minor: 0.3 }, // IV (borrowed minor iv is a common cadential color)
  7: { major: 1.0, minor: 0.35 }, // V
  9: { minor: 1.0, major: 0.45 }, // vi
  10: { major: 0.55 }, // bVII (mixolydian borrowing, very common in this repo's genres)
  11: { dim: 1.0, minor: 0.5, major: 0.3 }, // vii°
};
const MINOR_DEGREES = {
  0: { minor: 1.0, major: 0.15 }, // i
  2: { dim: 0.7, minor: 0.3 }, // ii°
  3: { major: 1.0, minor: 0.3 }, // III
  5: { minor: 1.0, major: 0.3 }, // iv
  7: { major: 0.9, minor: 0.9 }, // V (harmonic minor) or v (natural minor) — both common
  8: { major: 1.0 }, // VI
  10: { major: 0.85 }, // VII (natural minor subtonic)
  11: { dim: 0.5, major: 0.3 }, // vii° (harmonic minor) or borrowed major bVII-of-relative
};

const PHRASE_EDGE_BONUS = 0.5; // extra weight for a chord that opens or closes a line
const HIGH_CONFIDENCE_MARGIN = 0.15; // top score must beat the next distinct rival by this fraction
const HIGH_CONFIDENCE_COVERAGE = 0.85; // top score must explain this much of the song's weighted chord usage
const MIN_UNIQUE_CHORDS = 3; // fewer than this and there isn't enough signal to trust "high"
// Relative keys and I/IV/V pairs share most of their diatonic chords, so the top two candidates
// are routinely near-tied even for a song with an obvious, unambiguous key. Below this gap,
// break the tie using which tonic the song actually opens on (see detectKey).
const NEAR_TIE_THRESHOLD = 0.12;

function listSongFiles() {
  return fs.readdirSync(SHEETS_DIR).filter((f) => f.endsWith('.chordpro')).sort();
}

function hasKeyDirective(content) {
  return /\{key:[^}]*\}/i.test(content);
}

function qualityOf(chord) {
  if (!chord.root) return null;
  if (chord.root.minor) return 'minor';
  if ((chord.suffix || '').startsWith('dim')) return 'dim';
  return 'major';
}

// Walks the parsed song in document order and returns every sounding chord as
// { semitone, quality, weight }, plus the very first chord (a useful tie-breaker: songs in
// this collection overwhelmingly open on or near the tonic). Chords that don't resolve to a
// recognizable root (rare malformed annotations like "E7sus (add 9)") are skipped.
function collectChordWeights(song) {
  const occurrences = [];
  let firstChord = null;

  song.lines.forEach((line) => {
    const items = line.items.filter((it) => it instanceof ChordLyricsPair && it.chords);
    items.forEach((item, idx) => {
      let chord;
      try {
        chord = Chord.parse(item.chords);
      } catch (e) {
        chord = null;
      }
      if (!chord || !chord.root) return;
      const quality = qualityOf(chord);
      if (!quality) return;

      const semitone = noteToSemitone(chord.root.note);
      let weight = 1;
      if (idx === 0 || idx === items.length - 1) weight += PHRASE_EDGE_BONUS;
      occurrences.push({ semitone, quality, weight });
      if (!firstChord) firstChord = { semitone, quality };
    });
  });

  return { occurrences, firstChord };
}

function scoreCandidate(occurrences, root, degrees) {
  let score = 0;
  occurrences.forEach(({ semitone, quality, weight }) => {
    const offset = (semitone - root + 12) % 12;
    const credit = (degrees[offset] && degrees[offset][quality]) || 0;
    score += weight * credit;
  });
  return score;
}

// Returns { keyName, confidence, coverage, margin, uniqueChords } or null if the song has no
// usable chord data at all (a lyrics-only hymn transcription, for example).
function detectKey(song) {
  const { occurrences, firstChord } = collectChordWeights(song);
  if (!occurrences.length) return null;

  const totalWeight = occurrences.reduce((sum, o) => sum + o.weight, 0);
  const uniqueChords = new Set(occurrences.map((o) => `${o.semitone}${o.quality}`)).size;

  const candidates = [];
  for (let root = 0; root < 12; root += 1) {
    candidates.push({ root, mode: 'major', score: scoreCandidate(occurrences, root, MAJOR_DEGREES) });
    candidates.push({ root, mode: 'minor', score: scoreCandidate(occurrences, root, MINOR_DEGREES) });
  }
  candidates.sort((a, b) => b.score - a.score);

  let top = candidates[0];
  let partner = candidates[1];
  const isNearTie = top.score > 0 && (top.score - partner.score) / top.score < NEAR_TIE_THRESHOLD;
  if (isNearTie && firstChord && firstChord.semitone === partner.root && firstChord.quality === partner.mode) {
    top = candidates[1];
    partner = candidates[0];
  }

  // Judge confidence against the next candidate that isn't the (possibly tie-broken) top pick
  // or its near-tied partner — that pair's closeness was already explained by the opening
  // chord, so it shouldn't count as a competing rival.
  const rival = candidates.find((c) => c !== top && c !== partner) || partner;
  const margin = top.score > 0 ? (top.score - rival.score) / top.score : 0;
  const coverage = totalWeight > 0 ? Math.min(top.score / totalWeight, 1) : 0;

  const confidence =
    coverage >= HIGH_CONFIDENCE_COVERAGE && margin >= HIGH_CONFIDENCE_MARGIN && uniqueChords >= MIN_UNIQUE_CHORDS
      ? 'high'
      : 'low';

  const keyName = NOTE_NAMES[top.root] + (top.mode === 'minor' ? 'm' : '');
  return { keyName, confidence, coverage, margin, uniqueChords };
}

function insertKeyDirective(content, keyName) {
  const directive = `{key:${keyName}}`;
  const genreLineRe = /^(\{meta:\s*genre\s+[^}]+\})\r?\n/m;
  if (genreLineRe.test(content)) {
    return content.replace(genreLineRe, `$1\n${directive}\n`);
  }
  // Every song is expected to have {meta: genre ...} (lint rule 7), so this only fires for a
  // file that lint would already be rejecting — still place the key right after the title so
  // the output stays well-formed rather than silently doing nothing.
  return content.replace(/^(\{t:[^}]*\})\r?\n/m, `$1\n${directive}\n`);
}

function main() {
  const files = listSongFiles();
  const applied = [];
  const suggestions = [];
  const noChords = [];

  files.forEach((filename) => {
    const filePath = path.join(SHEETS_DIR, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    if (hasKeyDirective(content)) return;

    let song;
    try {
      song = new ChordProParser().parse(content);
    } catch (e) {
      console.error(`${filename}: failed to parse, skipping (${e.message})`);
      return;
    }

    const result = detectKey(song);
    if (!result) {
      noChords.push(filename);
      return;
    }

    if (result.confidence === 'high') {
      fs.writeFileSync(filePath, insertKeyDirective(content, result.keyName));
      applied.push({ filename, ...result });
    } else {
      suggestions.push({ filename, ...result });
    }
  });

  console.log(
    `detect-keys: ${files.length} songs checked — ${applied.length} keys auto-applied (high confidence), ` +
      `${suggestions.length} left for review (low confidence), ${noChords.length} skipped (no usable chords).`
  );
  applied.forEach((a) =>
    console.log(`  applied ${a.filename}: {key:${a.keyName}} (coverage ${Math.round(a.coverage * 100)}%, margin ${Math.round(a.margin * 100)}%)`)
  );

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const lines = [
    '# Key suggestions (needs manual review)',
    '',
    "Songs missing a {key:...} directive where scripts/detect-keys.js's chord-vocabulary",
    'heuristic could not settle on a confident guess — an ambiguous chord set (often a key vs.',
    'its relative, or vs. a neighbor a fourth/fifth away, which share most of their diatonic',
    'chords and are genuinely hard to tell apart from chords alone), too few chords, or no clear',
    "margin over a rival key. \"Best guess\" is still usually right — confirm by ear (or against a",
    'known recording) before adding {key:X} to the file by hand.',
    '',
    '| File | Best guess | Confidence signal |',
    '|---|---|---|',
    ...suggestions
      .sort((a, b) => a.filename.localeCompare(b.filename))
      .map(
        (s) =>
          `| ${s.filename} | \`{key:${s.keyName}}\` | coverage ${Math.round(s.coverage * 100)}%, margin ${Math.round(s.margin * 100)}%, ${s.uniqueChords} unique chords |`
      ),
    '',
  ];
  if (noChords.length) {
    lines.push(
      '## No usable chords',
      '',
      "These files have no chord annotations at all (or none scripts/detect-keys.js's chord",
      'parser could resolve), so there was nothing to guess from:',
      '',
      ...noChords.map((f) => `- ${f}`),
      ''
    );
  }
  fs.writeFileSync(path.join(DATA_DIR, 'key-suggestions.md'), lines.join('\n'));
  console.log(`Wrote data/key-suggestions.md (${suggestions.length} songs to review, ${noChords.length} with no usable chords).`);
}

main();
