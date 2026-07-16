#!/usr/bin/env node
// Lint rules enforced over every song `.chordpro` file in sheets/. See CONTRIBUTING.md
// for what to do when one of these fails.
//   1. parse           - file must parse as valid ChordPro (chordsheetjs ChordProParser)
//   2. title           - must contain a {t:...} directive
//   3. long-form       - long-form directives are banned; short forms only
//   4. block-balance   - {soc}/{eoc} and {sot}/{eot} counts must match
//   5. bracket-balance - [ and ] must balance on each line (outside {sot}/{eot} blocks)
//   6. filename        - filename must be snake_case segments, optionally hyphen-joined
//                        (e.g. song_title-artist_name.txt)
//   7. genre           - must contain a {meta: genre ...} directive with a value from GENRES
//
// Run with --fix to auto-rewrite long-form directives (rule 3) to short-form in place before
// linting. It's the only rule that's a pure mechanical rewrite; every other failure still
// needs a human to supply or correct content.
'use strict';

const fs = require('fs');
const path = require('path');
const { ChordProParser } = require('chordsheetjs');

const ROOT = path.resolve(__dirname, '..');
const SHEETS_DIR = path.join(ROOT, 'sheets');

// Keep in sync with GENRES in scripts/build-site.js (drives the site's genre filter pills).
const GENRES = [
  'Worship/CCM', 'Hymn', 'Rock', 'Pop', 'Folk/Singer-Songwriter',
  'Country', 'Jazz/Standards', 'R&B/Soul', 'Christmas',
];

const LONG_FORM_DIRECTIVES = [
  { long: 'title:', short: 't:' },
  { long: 'subtitle:', short: 'st:' },
  { long: 'comment:', short: 'c:' },
  { long: 'guitar_comment:', short: 'gc:' },
  { long: 'start_of_chorus', short: 'soc' },
  { long: 'end_of_chorus', short: 'eoc' },
  { long: 'start_of_tab', short: 'sot' },
  { long: 'end_of_tab', short: 'eot' },
];

const FILENAME_RE = /^[a-z0-9]+(_[a-z0-9]+)*(-[a-z0-9]+(_[a-z0-9]+)*)*$/;

function listSongFiles() {
  return fs.readdirSync(SHEETS_DIR)
    .filter((f) => f.endsWith('.chordpro'))
    .sort();
}

// Only long-form directives are safe to auto-fix: it's a pure mechanical rewrite. Every
// other lint rule (missing title, bad genre, unbalanced blocks/brackets, filename, parse
// errors) needs a human to supply or correct content, so --fix leaves those for CI to report.
function fixLongFormDirectives(content) {
  let out = content;
  for (const { long, short } of LONG_FORM_DIRECTIVES) {
    out = long.endsWith(':')
      ? out.replace(new RegExp(`\\{\\s*${long}`, 'gi'), `{${short}`)
      : out.replace(new RegExp(`\\{\\s*${long}\\s*\\}`, 'gi'), `{${short}}`);
  }
  return out;
}

function fixFile(filename) {
  const filePath = path.join(SHEETS_DIR, filename);
  const original = fs.readFileSync(filePath, 'utf8');
  const fixed = fixLongFormDirectives(original);
  if (fixed !== original) {
    fs.writeFileSync(filePath, fixed);
    return true;
  }
  return false;
}

function lintFile(filename) {
  const errors = [];
  const content = fs.readFileSync(path.join(SHEETS_DIR, filename), 'utf8');
  const lines = content.split(/\r\n|\r|\n/);

  const base = filename.replace(/\.chordpro$/, '');
  if (!FILENAME_RE.test(base)) {
    errors.push(`${filename}: filename must be snake_case (lowercase letters, digits, underscores, optional hyphen-joined segments)`);
  }

  if (!/\{t:[^}]*\}/.test(content)) {
    errors.push(`${filename}: missing required {t:...} title directive`);
  }

  const genreMatch = content.match(/\{meta:\s*genre\s+([^}]+)\}/i);
  if (!genreMatch) {
    errors.push(`${filename}: missing required {meta: genre ...} directive`);
  } else if (!GENRES.includes(genreMatch[1].trim())) {
    errors.push(`${filename}: unrecognized genre "${genreMatch[1].trim()}" (must be one of: ${GENRES.join(', ')})`);
  }

  lines.forEach((line, idx) => {
    for (const { long, short } of LONG_FORM_DIRECTIVES) {
      if (new RegExp(`\\{\\s*${long}`, 'i').test(line)) {
        errors.push(`${filename}:${idx + 1}: long-form directive "{${long}}" found, use short form "{${short}}" instead`);
      }
    }
  });

  for (const [openTag, closeTag] of [['soc', 'eoc'], ['sot', 'eot']]) {
    const opens = (content.match(new RegExp(`\\{${openTag}\\}`, 'g')) || []).length;
    const closes = (content.match(new RegExp(`\\{${closeTag}\\}`, 'g')) || []).length;
    if (opens !== closes) {
      errors.push(`${filename}: unbalanced {${openTag}}/{${closeTag}} blocks (${opens} open, ${closes} close)`);
    }
  }

  let inTab = false;
  lines.forEach((line, idx) => {
    if (/\{sot\}/.test(line)) { inTab = true; return; }
    if (/\{eot\}/.test(line)) { inTab = false; return; }
    if (inTab) return;
    const opens = (line.match(/\[/g) || []).length;
    const closes = (line.match(/\]/g) || []).length;
    if (opens !== closes) {
      errors.push(`${filename}:${idx + 1}: unbalanced [ ] chord brackets on this line`);
    }
  });

  try {
    new ChordProParser().parse(content);
  } catch (e) {
    errors.push(`${filename}: ChordPro parse error: ${e.message}`);
  }

  return errors;
}

function main() {
  const fix = process.argv.includes('--fix');
  const files = listSongFiles();

  if (fix) {
    const fixedFiles = files.filter(fixFile);
    if (fixedFiles.length > 0) {
      console.log(`Auto-fixed ${fixedFiles.length} file(s) (long-form directives -> short-form):`);
      fixedFiles.forEach((f) => console.log(`  ${f}`));
    }
  }

  const allErrors = files.flatMap(lintFile);

  if (allErrors.length > 0) {
    console.error(`Lint failed: ${allErrors.length} issue(s) found across ${files.length} files\n`);
    allErrors.forEach((e) => console.error(`  ${e}`));
    process.exit(1);
  }

  console.log(`Lint passed: ${files.length} files checked, no issues found.`);
}

main();
