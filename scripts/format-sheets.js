#!/usr/bin/env node
// Orchestrates auto-conversion of raw chords-over-lyrics pastes dropped into sheets/ as
// `.txt` files (see CONTRIBUTING.md). Run via `npm run format-sheets`, locally or in CI
// (.github/workflows/format-sheets.yml). Exits nonzero if any .txt could not be
// converted, which is what makes CI go red instead of a bad paste sitting unconverted.
'use strict';

const fs = require('fs');
const path = require('path');
const { convertRawSheet } = require('./convert-raw-sheet');
const { lintFile } = require('./lint');
const { isKnownConvention } = require('./check-artist-plausibility');
const { generateIndex } = require('./generate-index');

const ROOT = path.resolve(__dirname, '..');
const SHEETS_DIR = path.join(ROOT, 'sheets');
const INDEX_PATH = path.join(ROOT, 'INDEX.md');

function slugSegment(text) {
  return text
    .normalize('NFKD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Bible-reference/arrangement-note {st:} values (see isKnownConvention) aren't a
// performer name, so they're left out of the filename rather than slugified into one.
function targetFilename(title, artist) {
  const titleSlug = slugSegment(title);
  const artistSlug = artist && !isKnownConvention(artist) ? slugSegment(artist) : '';
  return artistSlug ? `${titleSlug}-${artistSlug}.chordpro` : `${titleSlug}.chordpro`;
}

function main() {
  const rawFiles = fs.readdirSync(SHEETS_DIR).filter((f) => f.endsWith('.txt')).sort();

  if (rawFiles.length === 0) {
    console.log('format-sheets: no raw .txt files found in sheets/, nothing to convert.');
    return;
  }

  const converted = [];
  const failures = [];

  rawFiles.forEach((rawFile) => {
    const rawPath = path.join(SHEETS_DIR, rawFile);
    const content = fs.readFileSync(rawPath, 'utf8');
    const result = convertRawSheet(content);

    if (result === null) {
      failures.push(`${rawFile}: missing required {t:...} title directive — add one near the top and re-push`);
      return;
    }

    const titleMatch = /^\{t:([^}]*)\}/.exec(result);
    const artistMatch = /\{st:([^}]*)\}/.exec(result);
    const title = titleMatch[1].trim();
    const artist = artistMatch ? artistMatch[1].trim() : '';

    const targetName = targetFilename(title, artist);
    const targetPath = path.join(SHEETS_DIR, targetName);

    if (fs.existsSync(targetPath)) {
      failures.push(`${rawFile}: target ${targetName} already exists — rename or merge manually`);
      return;
    }

    fs.writeFileSync(targetPath, result);

    const lintErrors = lintFile(targetName);
    if (lintErrors.length > 0) {
      fs.unlinkSync(targetPath);
      failures.push(`${rawFile}: converted output failed lint checks:\n    ${lintErrors.join('\n    ')}`);
      return;
    }

    fs.unlinkSync(rawPath);
    converted.push(`${rawFile} -> ${targetName}`);
  });

  if (converted.length > 0) {
    fs.writeFileSync(INDEX_PATH, generateIndex());
    console.log(`format-sheets: converted ${converted.length} file(s):`);
    converted.forEach((c) => console.log(`  ${c}`));
  }

  if (failures.length > 0) {
    console.error(`format-sheets: ${failures.length} file(s) could not be converted:`);
    failures.forEach((f) => console.error(`  ${f}`));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { targetFilename, slugSegment };
