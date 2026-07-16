#!/usr/bin/env node
// Resolves ChordPro chord names (e.g. "F#m7", "C/E") to guitar fingerings from
// @tombatossals/chords-db and renders them as inline SVG fretboard diagrams.
// Chords that don't resolve (exotic alterations, malformed annotations) are
// skipped by the caller rather than erroring the build - see build-site.js.
'use strict';

const { Chord } = require('chordsheetjs');
const db = require('@tombatossals/chords-db/lib/guitar.json');

const SEMITONE_TO_KEY = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const KEY_TO_CHORDS_PROP = { 'C#': 'Csharp', 'F#': 'Fsharp' };
const NOTE_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// chords-db's suffix vocabulary doesn't exactly match chordsheetjs's parsed
// suffix strings (or common ChordPro shorthand) - map the common variants
// found across sheets/ to their chords-db equivalent.
const SUFFIX_ALIASES = {
  '': 'major',
  m: 'minor',
  min: 'minor',
  sus: 'sus4',
  '2': 'sus2',
  '4': 'sus4',
  M: 'major',
  M7: 'maj7',
  min7: 'm7',
  add6: '6',
  dom7: '7',
  '7sus': '7sus4',
  '+': 'aug',
};

function noteToSemitone(note) {
  const letter = note[0].toUpperCase();
  let semitone = NOTE_TO_SEMITONE[letter];
  for (const ch of note.slice(1)) {
    if (ch === '#') semitone += 1;
    else if (ch === 'b') semitone -= 1;
  }
  return ((semitone % 12) + 12) % 12;
}

// Returns the primary (lowest-fret) fingering for a chord name, or null if
// it can't be resolved against the chord database.
function resolveChordPosition(chordName) {
  let chord;
  try {
    chord = Chord.parse(chordName);
  } catch (e) {
    return null;
  }
  if (!chord || !chord.root) return null;

  const dbKey = SEMITONE_TO_KEY[noteToSemitone(chord.root.note)];
  const chordsProp = KEY_TO_CHORDS_PROP[dbKey] || dbKey;
  const rawSuffix = chord.suffix || '';
  const suffix = SUFFIX_ALIASES[rawSuffix] !== undefined ? SUFFIX_ALIASES[rawSuffix] : rawSuffix;

  const entries = db.chords[chordsProp];
  if (!entries) return null;
  const entry = entries.find((e) => e.suffix === suffix);
  if (!entry || !entry.positions.length) return null;
  return entry.positions[0];
}

const STRING_COUNT = 6;
const NECK_LEFT = 10;
const NECK_RIGHT = 80;
const NECK_TOP = 20;
const FRET_COUNT = 4;
const FRET_HEIGHT = 16;
const NECK_BOTTOM = NECK_TOP + FRET_COUNT * FRET_HEIGHT;
const DOT_RADIUS = 6;

function stringX(index) {
  return NECK_LEFT + (index * (NECK_RIGHT - NECK_LEFT)) / (STRING_COUNT - 1);
}

function fretY(fretRow) {
  // fretRow is 1-based, relative to baseFret
  return NECK_TOP + (fretRow - 0.5) * FRET_HEIGHT;
}

function escapeXml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderChordDiagramSvg(position) {
  const { frets, fingers = [], baseFret } = position;
  const parts = [];

  parts.push(
    `<svg class="chord-diagram" viewBox="0 0 90 ${NECK_BOTTOM + 10}" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">`
  );

  // open/muted markers above the nut
  frets.forEach((fret, i) => {
    const x = stringX(i);
    if (fret === 0) {
      parts.push(`<circle class="chord-diagram-mark" cx="${x}" cy="${NECK_TOP - 8}" r="3.5" fill="none"/>`);
    } else if (fret < 0) {
      const r = 3.2;
      parts.push(
        `<path class="chord-diagram-mark" d="M${x - r},${NECK_TOP - 8 - r} L${x + r},${NECK_TOP - 8 + r} M${x + r},${NECK_TOP - 8 - r} L${x - r},${NECK_TOP - 8 + r}"/>`
      );
    }
  });

  // strings
  for (let i = 0; i < STRING_COUNT; i += 1) {
    const x = stringX(i);
    parts.push(`<line class="chord-diagram-string" x1="${x}" y1="${NECK_TOP}" x2="${x}" y2="${NECK_BOTTOM}"/>`);
  }

  // frets (horizontal lines), thick nut when at the first position
  for (let row = 0; row <= FRET_COUNT; row += 1) {
    const y = NECK_TOP + row * FRET_HEIGHT;
    const isNut = row === 0 && baseFret === 1;
    parts.push(
      `<line class="${isNut ? 'chord-diagram-nut' : 'chord-diagram-fret'}" x1="${NECK_LEFT}" y1="${y}" x2="${NECK_RIGHT}" y2="${y}"/>`
    );
  }

  if (baseFret > 1) {
    parts.push(
      `<text class="chord-diagram-basefret" x="${NECK_LEFT - 6}" y="${fretY(1) + 4}" text-anchor="end">${baseFret}fr</text>`
    );
  }

  // barres: for each barred fret row, span from the lowest to highest string held at that fret
  (position.barres || []).forEach((barreFret) => {
    const indices = frets.reduce((acc, fret, i) => (fret === barreFret ? [...acc, i] : acc), []);
    if (indices.length < 2) return;
    const x1 = stringX(Math.min(...indices));
    const x2 = stringX(Math.max(...indices));
    const y = fretY(barreFret);
    parts.push(
      `<rect class="chord-diagram-barre" x="${x1 - DOT_RADIUS}" y="${y - DOT_RADIUS}" width="${x2 - x1 + DOT_RADIUS * 2}" height="${DOT_RADIUS * 2}" rx="${DOT_RADIUS}"/>`
    );
  });

  // finger dots
  frets.forEach((fret, i) => {
    if (fret <= 0) return;
    const x = stringX(i);
    const y = fretY(fret);
    parts.push(`<circle class="chord-diagram-dot" cx="${x}" cy="${y}" r="${DOT_RADIUS}"/>`);
    const finger = fingers[i];
    if (finger) {
      parts.push(
        `<text class="chord-diagram-finger" x="${x}" y="${y + 3}" text-anchor="middle">${finger}</text>`
      );
    }
  });

  parts.push('</svg>');
  return parts.join('');
}

// Builds a { [chordName]: svgString } map for the given chord names,
// silently omitting any that can't be resolved.
function buildChordDiagrams(chordNames) {
  const diagrams = {};
  chordNames.forEach((name) => {
    const position = resolveChordPosition(name);
    if (!position) return;
    diagrams[name] = renderChordDiagramSvg(position);
  });
  return diagrams;
}

module.exports = {
  buildChordDiagrams, resolveChordPosition, renderChordDiagramSvg, escapeXml,
  // Exported for scripts/detect-keys.js, which needs the same note-name -> pitch-class
  // mapping to compare chord roots against candidate keys.
  noteToSemitone,
};
