#!/usr/bin/env node
// Looks up a Spotify track match for every song in sheets/ and writes the results to
// data/spotify-links.json, which build-site.js reads to render a "Listen on Spotify" link
// on each song page. Run manually (or re-run after adding songs) — not part of the CI
// lint/check pipeline, since it needs network access and API credentials.
//
//   node scripts/fetch-spotify-links.js
//
// Requires SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET, read from a local .env (gitignored,
// see .env.example) or the environment. Uses the Client Credentials flow (catalog search
// only, no user login).
//
// Also writes data/artist-suggestions.md: songs whose {st:} artist directive is blank but
// whose title matched a Spotify track, so a human can review and copy in a {st:} attribution.
// This script never edits .chordpro files itself.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHEETS_DIR = path.join(ROOT, 'sheets');
const DATA_DIR = path.join(ROOT, 'data');
const REQUEST_DELAY_MS = 250;
const FETCH_TIMEOUT_MS = 10000;
const MAX_RETRIES = 4;
const MAX_RETRY_AFTER_MS = 30000;

// Node's fetch has no default timeout — a stalled TCP connection (rare, but seen against
// Spotify's API) hangs the whole script forever. Bound every request explicitly.
async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  });
}

function listSongFiles() {
  return fs.readdirSync(SHEETS_DIR)
    .filter((f) => f.endsWith('.chordpro'))
    .sort();
}

function extractDirective(content, name) {
  const match = content.match(new RegExp(`\\{${name}:([^}]*)\\}`));
  return match ? match[1].trim() : '';
}

function normalize(str) {
  return str
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAccessToken(clientId, clientSecret) {
  const res = await fetchWithTimeout('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    throw new Error(`token request failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return json.access_token;
}

async function runQuery(token, q, attempt = 0) {
  const url = `https://api.spotify.com/v1/search?${new URLSearchParams({ q, type: 'track', limit: '5' })}`;
  const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') || '2') * 1000;
    // A short retry-after is normal rate-limit backoff, worth honoring. A long one (seen:
    // ~16 hours after a burst of full-collection runs) means the app is in an extended
    // penalty window — sleeping through that would hang the script for hours, so fail fast
    // instead and let the caller retry the whole run later.
    if (attempt >= MAX_RETRIES || retryAfter > MAX_RETRY_AFTER_MS) {
      throw new Error(
        `search failed for query "${q}": rate-limited, retry-after ${Math.round(retryAfter / 1000)}s`
      );
    }
    await sleep(retryAfter);
    return runQuery(token, q, attempt + 1);
  }
  if (!res.ok) {
    throw new Error(`search failed for query "${q}": ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return json.tracks?.items || [];
}

// Field-filtered search (track:"..." artist:"...") is precise but brittle — it can miss
// real matches on titling quirks. Fall back to a plain free-text query before giving up.
async function searchTrack(token, title, artist) {
  const filtered = artist ? `track:"${title}" artist:"${artist}"` : `track:"${title}"`;
  let items = await runQuery(token, filtered);
  if (!items.length) {
    await sleep(REQUEST_DELAY_MS);
    items = await runQuery(token, artist ? `${title} ${artist}` : title);
  }
  return items;
}

function pickMatch(items, expectedArtist) {
  if (!items.length) return { confidence: 'none' };
  const top = items[0];
  const matchedArtists = top.artists.map((a) => a.name);
  let confidence;
  if (!expectedArtist) {
    confidence = 'unverified';
  } else {
    const norm = normalize(expectedArtist);
    confidence = matchedArtists.some(
      (a) => normalize(a).includes(norm) || norm.includes(normalize(a))
    )
      ? 'high'
      : 'low';
  }
  return {
    confidence,
    track: {
      name: top.name,
      artists: matchedArtists,
      url: top.external_urls.spotify,
      id: top.id,
    },
  };
}

async function main() {
  loadEnvFile();
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET (set them in .env or the environment).');
    process.exit(1);
  }

  const token = await getAccessToken(clientId, clientSecret);
  const files = listSongFiles();
  const results = {};
  const artistSuggestions = [];
  const counts = { high: 0, low: 0, unverified: 0, none: 0 };

  for (const [i, filename] of files.entries()) {
    if (i > 0 && i % 50 === 0) console.log(`fetch-spotify-links: ${i}/${files.length}...`);
    const content = fs.readFileSync(path.join(SHEETS_DIR, filename), 'utf8');
    const title = extractDirective(content, 't');
    const artist = extractDirective(content, 'st');
    if (!title) continue;

    let items;
    try {
      items = await searchTrack(token, title, artist);
    } catch (e) {
      console.error(`${filename}: ${e.message}`);
      results[filename] = { title, artist, confidence: 'error' };
      continue;
    }
    const { confidence, track } = pickMatch(items, artist);
    counts[confidence] = (counts[confidence] || 0) + 1;
    results[filename] = { title, artist, confidence, track: track || null };

    if (!artist && confidence === 'unverified' && track) {
      artistSuggestions.push({ filename, title, matchedArtists: track.artists, url: track.url });
    }

    await sleep(REQUEST_DELAY_MS);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'spotify-links.json'), `${JSON.stringify(results, null, 2)}\n`);

  const suggestionsLines = [
    '# Spotify artist suggestions',
    '',
    `Songs with no {st:} artist in their .chordpro file, where a Spotify title search found a`,
    'plausible track. Not applied automatically — review each before adding {st:...} to the file',
    '(worship-song titles are prone to matching the wrong recording).',
    '',
    '| File | Title | Suggested artist | Spotify |',
    '|---|---|---|---|',
    ...artistSuggestions.map(
      (s) => `| ${s.filename} | ${s.title} | ${s.matchedArtists.join(', ')} | [listen](${s.url}) |`
    ),
    '',
  ];
  fs.writeFileSync(path.join(DATA_DIR, 'artist-suggestions.md'), suggestionsLines.join('\n'));

  console.log(
    `fetch-spotify-links: ${files.length} songs — ${counts.high} high-confidence, ${counts.low} low-confidence, ` +
      `${counts.unverified} unverified (no artist to check against), ${counts.none} no match.`
  );
  console.log(`Wrote data/spotify-links.json and data/artist-suggestions.md (${artistSuggestions.length} suggestions).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
