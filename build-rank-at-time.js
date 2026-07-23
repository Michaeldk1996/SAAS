'use strict';

/**
 * build-rank-at-time.js — Step 2a rank-at-time sidecar builder.
 *
 * WHY: the model's quality-adjusted-form layer (adjustments.js#qualityForm)
 * asks "was this recent-form opponent top-50 / top-20 AT THE TIME of the match?"
 * but rankOf() historically returned the opponent's CURRENT rank as a proxy.
 * A player ranked #8 today may have been #180 when the recent-form match was
 * played, so the current-rank proxy silently mislabels quality wins.
 *
 * WHAT: reads the TML-Database match CSVs (tml-cache/, the reachable mirror of
 * the tennis_atp match-CSV schema — the atp_rankings snapshot files are
 * unreachable from CI, verified 401/404) and emits, per player, the timeline of
 * their match-day rank observations pulled from winner_rank / loser_rank on
 * every row. data.js#rankOf(key, name, date) then looks up the rank as of a
 * given date, falling back to current rank only when no observation exists.
 *
 * STORAGE: a standalone sidecar (Option B). It is NOT inlined into matches.json
 * or player-profiles.json (zero payload bloat) and is NOT copied into _site (it
 * is a model-build input, never served to the browser).
 *
 * KEY: the elo-style "lastname|initial" key (eloKeyFromFullName) so it joins
 * against the abbreviated opponent names the model already carries — the exact
 * same derivation data.js uses everywhere else, so the join is symmetric.
 *
 * Usage:  node build-rank-at-time.js
 *   env RANK_TML_DIR   override the tml-cache directory (default ./tml-cache)
 *   env RANK_FROM_YEAR earliest year to include (default 2019)
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const TML_DIR = process.env.RANK_TML_DIR || path.join(ROOT, 'tml-cache');
const FROM_YEAR = +(process.env.RANK_FROM_YEAR || 2019);
const OUT = path.join(ROOT, 'rank-at-time.json');

// --- key derivation: MUST match data.js#eloKeyFromFullName exactly ----------
function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function eloKeyFromFullName(fullName) {
  if (!fullName) return null;
  let s = stripAccents(fullName).toLowerCase()
    .replace(/'/g, '').replace(/\./g, ' ').replace(/-/g, ' ');
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  const firstInitial = parts[0][0];
  return `${last}|${firstInitial}`;
}

function readCsv(file) {
  const txt = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  const lines = txt.split('\n').filter(l => l.length);
  const header = lines[0].split(',');
  const idx = {}; header.forEach((h, i) => { idx[h] = i; });
  return { idx, rows: lines.slice(1).map(l => l.split(',')) };
}

// player -> Map(dateYYYYMMDD -> rank). A player can appear twice on the same
// tourney_date; the rank is identical within a tournament so last-write is safe.
const byKey = new Map();
function observe(fullName, dateStr, rankStr) {
  const key = eloKeyFromFullName(fullName);
  if (!key) return;
  const date = +dateStr;
  const rank = +rankStr;
  if (!Number.isFinite(date) || date < 19000000) return;
  if (!Number.isFinite(rank) || rank <= 0) return; // '' / 0 / unranked -> skip
  let m = byKey.get(key);
  if (!m) { m = new Map(); byKey.set(key, m); }
  m.set(date, rank);
}

const years = [];
const files = fs.readdirSync(TML_DIR).filter(f => /^\d{4}\.csv$/.test(f));
for (const f of files.sort()) {
  const y = +f.slice(0, 4);
  if (y < FROM_YEAR) continue;
  const { idx, rows } = readCsv(path.join(TML_DIR, f));
  years.push(y);
  for (const r of rows) {
    const d = r[idx.tourney_date];
    observe(r[idx.winner_name], d, r[idx.winner_rank]);
    observe(r[idx.loser_name], d, r[idx.loser_rank]);
  }
}

// serialise: { key: [[date,rank], ...] } sorted ascending by date
let players = 0, obs = 0;
const out = {};
for (const [key, m] of byKey) {
  const arr = [...m.entries()].sort((a, b) => a[0] - b[0]);
  out[key] = arr;
  players++; obs += arr.length;
}

const payload = {
  version: 1,
  builtFrom: 'tml-cache',
  fromYear: FROM_YEAR,
  years: years.sort((a, b) => a - b),
  players: out,
};
fs.writeFileSync(OUT, JSON.stringify(payload));
const bytes = fs.statSync(OUT).size;
console.log(`rank-at-time.json: ${players} players, ${obs} observations, ` +
  `years ${years[0]}-${years[years.length - 1]}, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
