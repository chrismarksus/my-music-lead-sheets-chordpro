#!/usr/bin/env node
// Regenerates INDEX.md from scratch by reading every sheets/*.chordpro file's {t:}/{st:}
// directives. Run via `npm run generate-index` whenever songs are added, renamed, or
// retitled — see CONTRIBUTING.md. Table format and row-extraction regex must stay in sync
// with parseIndex() in scripts/check-consistency.js.
// `--check` (used by `npm run check-index` in CI) compares the generated output against
// the committed INDEX.md instead of writing, and exits 1 if they differ.
'use strict';

const fs = require('fs');
const path = require('path');
const { listSongFiles } = require('./lint');

const ROOT = path.resolve(__dirname, '..');
const SHEETS_DIR = path.join(ROOT, 'sheets');
const INDEX_PATH = path.join(ROOT, 'INDEX.md');

function extractDirective(content, name) {
  const match = content.match(new RegExp(`\\{${name}:([^}]*)\\}`));
  return match ? match[1].trim() : '';
}

function generateIndex() {
  const files = listSongFiles();

  const rows = files.map((f) => {
    const content = fs.readFileSync(path.join(SHEETS_DIR, f), 'utf8');
    return {
      title: extractDirective(content, 't'),
      artist: extractDirective(content, 'st'),
      file: f,
    };
  });

  rows.sort((a, b) => {
    const [al, bl] = [a.title.toLowerCase(), b.title.toLowerCase()];
    return al < bl ? -1 : al > bl ? 1 : 0;
  });

  const lines = [
    '# Song Index',
    '',
    `${rows.length} songs. Generated from each file's \`{t:}\`/\`{st:}\` directives.`,
    '',
    '| Title | Artist / Notes | File |',
    '|---|---|---|',
    ...rows.map((r) => `| ${r.title} | ${r.artist} | [${r.file}](sheets/${r.file}) |`),
  ];

  return lines.join('\n') + '\n';
}

function main() {
  const generated = generateIndex();

  if (process.argv.includes('--check')) {
    const current = fs.existsSync(INDEX_PATH) ? fs.readFileSync(INDEX_PATH, 'utf8') : '';
    if (current !== generated) {
      console.error(
        'INDEX.md is out of date with sheets/*.chordpro.\n'
          + 'Run `npm run generate-index` and commit the result.'
      );
      process.exit(1);
    }
    console.log(`check-index: INDEX.md is up to date (${listSongFiles().length} songs).`);
    return;
  }

  fs.writeFileSync(INDEX_PATH, generated);
  console.log(`INDEX.md regenerated: ${listSongFiles().length} songs.`);
}

if (require.main === module) {
  main();
}

module.exports = { generateIndex };
