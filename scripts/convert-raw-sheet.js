#!/usr/bin/env node
// Converts a raw "chords-over-lyrics" text paste into ChordPro. See CONTRIBUTING.md for
// the expected input shape. Deliberately does NOT use ChordSheetJS's ChordsOverWordsParser
// (its word-nearest heuristic mis-places chords on wide-spaced lines) — instead chords are
// inserted at their literal character column, which is what a monospace paste actually
// encodes.
'use strict';

// Root A-G, optional accidental, optional quality/extension, optional /bass note.
const CHORD_RE = /^[A-G][#b]?(?:maj|min|m|dim|aug|sus|add)?\d{0,2}(?:\/[A-G][#b]?)?$/i;

function isChordToken(token) {
  return CHORD_RE.test(token);
}

function isChordLine(line) {
  const trimmed = line.trim();
  if (trimmed === '') return false;
  return trimmed.split(/\s+/).every(isChordToken);
}

// Returns the section label for a `[Label]`-only line, or null if the line isn't one
// (including the edge case where the bracket contents are themselves a bare chord line,
// e.g. a lone `[C]` — that's an instrumental chord, not a section header).
function sectionHeaderLabel(line) {
  const trimmed = line.trim();
  const m = /^\[(.+)\]$/.exec(trimmed);
  if (!m) return null;
  if (isChordLine(m[1])) return null;
  return m[1].trim();
}

// Inserts each chord from `chordLine` into `lyricLine` at its literal character offset,
// processing right-to-left so earlier insertions don't shift later offsets. Pads with
// spaces if a chord's offset is past the end of the lyric line.
function mergeChordLine(chordLine, lyricLine) {
  const matches = [...chordLine.matchAll(/\S+/g)];
  let out = lyricLine;
  for (let i = matches.length - 1; i >= 0; i--) {
    const chord = matches[i][0];
    const col = matches[i].index;
    if (col >= out.length) {
      out = out.padEnd(col, ' ') + `[${chord}]`;
    } else {
      out = out.slice(0, col) + `[${chord}]` + out.slice(col);
    }
  }
  return out.replace(/[ \t]+$/, '');
}

function convertBody(bodyLines) {
  const out = [];
  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];

    const header = sectionHeaderLabel(line);
    if (header !== null) {
      out.push(`{c:${header}}`);
      continue;
    }

    if (isChordLine(line)) {
      const next = bodyLines[i + 1];
      const nextIsLyric = next !== undefined && next.trim() !== ''
        && !isChordLine(next) && sectionHeaderLabel(next) === null;
      if (nextIsLyric) {
        out.push(mergeChordLine(line, next));
        i++;
      } else {
        out.push(line.trim().split(/\s+/).map((c) => `[${c}]`).join(' '));
      }
      continue;
    }

    out.push(line);
  }
  return out.join('\n');
}

// Returns the converted ChordPro text, or null if no `{t:...}` title directive was found
// (a hard failure — the caller must not guess a title).
function convertRawSheet(content) {
  const lines = content.split(/\r\n|\r|\n/);
  let title = null;
  let artist = null;
  const bodyLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const tMatch = /^\{t:([^}]*)\}$/i.exec(trimmed);
    const stMatch = /^\{st:([^}]*)\}$/i.exec(trimmed);
    if (tMatch) { title = tMatch[1].trim(); continue; }
    if (stMatch) { artist = stMatch[1].trim(); continue; }
    bodyLines.push(line);
  }

  if (!title) return null;

  while (bodyLines.length && bodyLines[0].trim() === '') bodyLines.shift();
  while (bodyLines.length && bodyLines[bodyLines.length - 1].trim() === '') bodyLines.pop();

  const header = [`{t:${title}}`];
  if (artist) header.push(`{st:${artist}}`);

  return `${header.join('\n')}\n\n${convertBody(bodyLines)}\n`;
}

module.exports = { convertRawSheet, isChordToken, isChordLine, sectionHeaderLabel, mergeChordLine };
