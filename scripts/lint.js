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
'use strict';

const fs = require('fs');
const path = require('path');
const { ChordProParser } = require('chordsheetjs');

const ROOT = path.resolve(__dirname, '..');
const SHEETS_DIR = path.join(ROOT, 'sheets');

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
  const files = listSongFiles();
  const allErrors = files.flatMap(lintFile);

  if (allErrors.length > 0) {
    console.error(`Lint failed: ${allErrors.length} issue(s) found across ${files.length} files\n`);
    allErrors.forEach((e) => console.error(`  ${e}`));
    process.exit(1);
  }

  console.log(`Lint passed: ${files.length} files checked, no issues found.`);
}

main();
