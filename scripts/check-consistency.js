#!/usr/bin/env node
// Repo consistency checks that go beyond per-file linting (see scripts/lint.js for that).
// See CONTRIBUTING.md for what to do when one of these fails.
//   1. index-missing   - every .txt file in the repo root must have a row in INDEX.md
//   2. index-stray     - every file linked from INDEX.md must exist in the repo root
//   3. index-drift     - a song's {t:}/{st:} directives must match its INDEX.md row
//   4. cross-ref       - {c:...see also X.txt...} comments must point at real filenames
//   5. duplicate       - no two .txt files may have byte-identical content
//   6. stray-file      - no unrecognized files/directories in the repo root
//   7. encoding        - every .txt file must be valid UTF-8 with no BOM
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

const KNOWN_ROOT_FILES = new Set([
  'CONTRIBUTING.md',
  'INDEX.md',
  'NOTICE.md',
  'package.json',
  'package-lock.json',
  '.gitignore',
]);

const KNOWN_ROOT_DIRS = new Set(['scripts', '.github', 'node_modules', '.git']);

function listSongFiles() {
  return fs.readdirSync(ROOT)
    .filter((f) => f.endsWith('.txt'))
    .sort();
}

function extractDirective(content, name) {
  const match = content.match(new RegExp(`\\{${name}:([^}]*)\\}`));
  return match ? match[1].trim() : '';
}

function parseIndex() {
  const content = fs.readFileSync(path.join(ROOT, 'INDEX.md'), 'utf8');
  const rowRe = /^\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*\[.*?\]\((.*?)\)\s*\|$/;
  const rows = [];
  content.split(/\r\n|\r|\n/).forEach((line, idx) => {
    const m = line.match(rowRe);
    if (m && m[3] !== 'File') {
      rows.push({ title: m[1], artist: m[2], file: m[3], line: idx + 1 });
    }
  });
  return rows;
}

function checkIndex(files, indexRows, errors) {
  const fileSet = new Set(files);
  const indexedFiles = new Set(indexRows.map((r) => r.file));

  files.forEach((f) => {
    if (!indexedFiles.has(f)) {
      errors.push(`INDEX.md: missing a row linking to ${f}`);
    }
  });

  indexRows.forEach((r) => {
    if (!fileSet.has(r.file)) {
      errors.push(`INDEX.md:${r.line}: links to ${r.file}, which does not exist in the repo root`);
    }
  });

  const rowsByFile = new Map(indexRows.map((r) => [r.file, r]));
  files.forEach((f) => {
    const row = rowsByFile.get(f);
    if (!row) return;
    const content = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const title = extractDirective(content, 't');
    const artist = extractDirective(content, 'st');
    if (title !== row.title) {
      errors.push(`INDEX.md:${row.line}: title "${row.title}" doesn't match ${f}'s {t:${title}}`);
    }
    if (artist !== row.artist) {
      errors.push(`INDEX.md:${row.line}: artist "${row.artist}" doesn't match ${f}'s {st:${artist}}`);
    }
  });
}

function checkCrossReferences(files, errors) {
  const fileSet = new Set(files);
  files.forEach((f) => {
    const content = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const lines = content.split(/\r\n|\r|\n/);
    lines.forEach((line, idx) => {
      const m = line.match(/\{c:[^}]*see also\s+([A-Za-z0-9_.-]+\.txt)/i);
      if (m && !fileSet.has(m[1])) {
        errors.push(`${f}:${idx + 1}: cross-reference points at ${m[1]}, which does not exist`);
      }
    });
  });
}

function checkDuplicates(files, errors) {
  const seen = new Map();
  files.forEach((f) => {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
    if (seen.has(hash)) {
      errors.push(`${f}: byte-identical to ${seen.get(hash)} (possible accidental duplicate)`);
    } else {
      seen.set(hash, f);
    }
  });
}

function checkStrayFiles(errors) {
  fs.readdirSync(ROOT, { withFileTypes: true }).forEach((entry) => {
    if (entry.isDirectory()) {
      if (!KNOWN_ROOT_DIRS.has(entry.name)) {
        errors.push(`stray directory in repo root: ${entry.name}/`);
      }
      return;
    }
    if (entry.name.endsWith('.txt')) return;
    if (KNOWN_ROOT_FILES.has(entry.name)) return;
    errors.push(`stray file in repo root: ${entry.name}`);
  });
}

function checkEncoding(files, errors) {
  files.forEach((f) => {
    const buf = fs.readFileSync(path.join(ROOT, f));
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      errors.push(`${f}: has a UTF-8 byte-order mark (BOM), should be plain UTF-8`);
    }
    const roundTrip = Buffer.from(buf.toString('utf8'), 'utf8');
    if (!roundTrip.equals(buf)) {
      errors.push(`${f}: not valid UTF-8 (contains malformed byte sequences)`);
    }
  });
}

function main() {
  const files = listSongFiles();
  const errors = [];

  checkIndex(files, parseIndex(), errors);
  checkCrossReferences(files, errors);
  checkDuplicates(files, errors);
  checkStrayFiles(errors);
  checkEncoding(files, errors);

  if (errors.length > 0) {
    console.error(`Consistency check failed: ${errors.length} issue(s) found\n`);
    errors.forEach((e) => console.error(`  ${e}`));
    process.exit(1);
  }

  console.log(`Consistency check passed: ${files.length} files, INDEX.md, and cross-references all match.`);
}

main();
