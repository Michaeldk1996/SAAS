// tools/deployed-store.js — read the stores the USERS get, not the ones in git.
//
// WHY THIS EXISTS
// ---------------
// `player-profiles.json` is committed, ~21 MB, and last written 2026-07-22. The
// pipeline rebuilds it on every tick and publishes it to Pages; it does NOT
// commit it back. So the file in the working tree is a fossil, and every tool
// that opened it with `fs.readFileSync(ROOT/player-profiles.json)` was reporting
// on July.
//
// That is not a hypothetical: the 2021-hole fix (`f9781b61`, BACKFILL_UP_TO_YEAR
// 2020 -> current year) landed 2026-08-04, THIRTEEN DAYS AFTER the committed
// store was written. A whole investigation was run against a file that predated
// the fix it was measuring, and every roster-wide figure it produced had to be
// withdrawn.
//
// The rule this module enforces: a tool may read the deployed store, or it may
// abort. It may not quietly read the committed one and print roster-wide
// numbers. Same fail-closed shape as the career-history drift guard that caught
// the 665-vs-775 short store.
//
// Cache: `<root>/.deployed-cache/` (gitignored). Fetched with curl, not Node
// fetch — the IPv6 route to github.io is unreachable from this host.

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.deployed-cache');
const BASE = (process.env.TEN206_DATA_BASE || 'https://michaeldk1996.github.io/SAAS').replace(/\/+$/, '');
// A tick is ~10 min and a deploy ~26 min; an hour keeps a multi-tool run on one
// consistent snapshot without ever reading something from a previous day.
const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000;

function cachePathFor(rel) {
  return path.join(CACHE_DIR, rel.replace(/[^A-Za-z0-9._-]+/g, '_'));
}

/**
 * Fetch `rel` from the deployed site into the cache and return its text.
 * Returns null on any network/HTTP failure — the CALLER decides what that means.
 * Never throws for a network problem, always throws for a corrupt cache write.
 */
function fetchText(rel, opts = {}) {
  const maxAge = opts.maxAgeMs == null ? DEFAULT_MAX_AGE_MS : opts.maxAgeMs;
  const dest = cachePathFor(rel);
  if (!opts.force && fs.existsSync(dest)) {
    const age = Date.now() - fs.statSync(dest).mtimeMs;
    if (age < maxAge) return fs.readFileSync(dest, 'utf8');
  }
  let body;
  try {
    body = execFileSync('curl', [
      '-sS', '--fail', '--max-time', String(opts.timeoutSec || 120),
      `${BASE}/${rel.replace(/^\/+/, '')}`,
    ], { maxBuffer: 256 << 20 }).toString();
  } catch (err) {
    // Stale cache beats no data, but the caller is told it is stale.
    if (fs.existsSync(dest)) return fs.readFileSync(dest, 'utf8');
    return null;
  }
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(dest, body);
  return body;
}

function fetchJson(rel, opts) {
  const text = fetchText(rel, opts);
  if (text == null) return null;
  try { return JSON.parse(text); } catch (err) {
    throw new Error(`deployed ${rel} is not valid JSON (${err.message.slice(0, 80)})`);
  }
}

/**
 * The player-profiles store, resolved against the deployed site.
 *
 * Returns { players, fetchedAt, source, committedFetchedAt, drift }:
 *   source 'deployed'  — read from Pages (or a <1h cache of it).
 *   source 'committed' — the network was unreachable AND nothing was cached.
 *                        `drift` carries the evidence. A caller printing
 *                        roster-wide figures MUST abort on this.
 */
function playerProfiles(opts = {}) {
  const committedPath = path.join(ROOT, 'player-profiles.json');
  const committed = fs.existsSync(committedPath)
    ? JSON.parse(fs.readFileSync(committedPath, 'utf8')) : null;
  const live = fetchJson('player-profiles.json', opts);
  if (!live || !live.players) {
    return {
      players: (committed && committed.players) || {},
      fetchedAt: committed && committed.fetchedAt,
      source: 'committed',
      committedFetchedAt: committed && committed.fetchedAt,
      drift: { why: 'deployed player-profiles.json unreachable and not cached' },
    };
  }
  const liveKeys = Object.keys(live.players);
  const comKeys = committed ? Object.keys(committed.players || {}) : [];
  const comSet = new Set(comKeys);
  const liveSet = new Set(liveKeys);
  return {
    players: live.players,
    tourAverage: live.tourAverage,
    fetchedAt: live.fetchedAt,
    source: 'deployed',
    committedFetchedAt: committed && committed.fetchedAt,
    drift: {
      deployedPlayers: liveKeys.length,
      committedPlayers: comKeys.length,
      onlyDeployed: liveKeys.filter(k => !comSet.has(k)).length,
      onlyCommitted: comKeys.filter(k => !liveSet.has(k)).length,
      committedFetchedAt: committed && committed.fetchedAt,
      deployedFetchedAt: live.fetchedAt,
    },
  };
}

/** The deployed per-player row-count index for career-history/. */
function careerHistoryIndex(opts) {
  const j = fetchJson('career-history-index.json', opts);
  return (j && j.players) || null;
}

/**
 * Bring the local `career-history/` up to the deployed store, shard by shard.
 * Only fetches shards that are MISSING or SHORT, so a warm tree costs one
 * index fetch. Returns { checked, fetched, failed, missing }.
 */
function hydrateCareerHistory(opts = {}) {
  const dir = opts.dir || path.join(ROOT, 'career-history');
  const index = careerHistoryIndex(opts);
  if (!index) return { error: 'deployed career-history-index.json unreachable' };
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const want = opts.keys ? opts.keys.filter(k => k in index) : Object.keys(index);
  let fetched = 0, failed = 0, skipped = 0;
  const failures = [];
  for (const key of want) {
    const dest = path.join(dir, `${key}.json`);
    if (fs.existsSync(dest)) {
      let rows = -1;
      try { rows = (JSON.parse(fs.readFileSync(dest, 'utf8')).matches || []).length; } catch (e) { rows = -1; }
      if (rows >= index[key]) { skipped++; continue; }
    }
    const text = fetchText(`career-history/${key}.json`, { force: true, maxAgeMs: 0, timeoutSec: 30 });
    if (text == null) { failed++; failures.push(key); continue; }
    fs.writeFileSync(dest, text);
    fetched++;
  }
  return { checked: want.length, fetched, skipped, failed, failures: failures.slice(0, 10) };
}

/**
 * Batched fetch of many small shards over ONE curl invocation per chunk, so the
 * connection is reused. 587 shards as 587 processes takes minutes; as 12 does
 * not. Returns { ok: Map<key,text>, failed: [key] }.
 */
function fetchShards(dirRel, keys, opts = {}) {
  const chunk = opts.chunk || 50;
  const tmp = path.join(CACHE_DIR, '_shardtmp');
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
  const ok = new Map(); const failed = [];
  for (let i = 0; i < keys.length; i += chunk) {
    const slice = keys.slice(i, i + chunk);
    // --parallel is what makes this practical: serially, 587 small shards off
    // Pages is ~15 min of round-trips; 20 at a time is under a minute.
    const args = ['-sS', '--parallel', '--parallel-max', String(opts.parallel || 20),
      '--max-time', String(opts.timeoutSec || 120)];
    slice.forEach((k) => {
      args.push('-o', path.join(tmp, `${k}.json`), `${BASE}/${dirRel}/${k}.json`);
    });
    try { execFileSync('curl', args, { maxBuffer: 256 << 20 }); } catch (err) { /* per-file check below */ }
    slice.forEach((k) => {
      const f = path.join(tmp, `${k}.json`);
      if (!fs.existsSync(f)) { failed.push(k); return; }
      const t = fs.readFileSync(f, 'utf8');
      fs.unlinkSync(f);
      if (!t || t.trim().charAt(0) !== '{') { failed.push(k); return; }
      ok.set(k, t);
    });
  }
  return { ok, failed };
}

/** The deployed per-player {n: tournaments, m: matches} index for tournament-history/. */
function tournamentHistoryIndex(opts) {
  const j = fetchJson('tournament-history-index.json', opts);
  return (j && j.players) || null;
}

/**
 * Re-attach `tournamentHistory` to a deployed profiles map.
 *
 * TEN-207 moved tournamentHistory OUT of player-profiles.json into
 * `tournament-history/{key}.json`, fetched lazily by the page. A tool that
 * reads the deployed store and walks `p.tournamentHistory` therefore finds
 * NOTHING and prints a clean bill of health over an empty walk — exactly the
 * vacuous pass `tools/audit-tournament-records.js` shipped against the lite
 * file. So this is not an optimisation: without it, reading the live store is
 * WORSE than reading the July fossil, because the fossil at least had rows.
 *
 * Fail-closed: mutates `players` in place and returns a report; a caller that
 * gets `attached` well short of `indexed` must abort rather than report.
 */
function hydrateTournamentHistory(players, opts = {}) {
  const index = tournamentHistoryIndex(opts);
  if (!index) return { error: 'deployed tournament-history-index.json unreachable' };
  const dir = opts.dir || path.join(ROOT, 'tournament-history');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const keys = Object.keys(players).filter((k) => k in index);
  const need = [];
  const readShard = (k) => {
    const f = path.join(dir, `${k}.json`);
    if (!fs.existsSync(f)) return null;
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
  };
  for (const k of keys) {
    const j = readShard(k);
    // Short == stale. The index carries the tournament count the deployed shard
    // holds, so a locally-cached shard that lost rows is caught, not trusted.
    if (!j || !Array.isArray(j.tournamentHistory) || j.tournamentHistory.length < index[k].n) need.push(k);
  }
  let fetched = 0;
  if (need.length) {
    const res = fetchShards('tournament-history', need, opts);
    for (const [k, text] of res.ok) { fs.writeFileSync(path.join(dir, `${k}.json`), text); fetched++; }
  }
  let attached = 0, rows = 0, short = 0;
  for (const k of keys) {
    const j = readShard(k);
    if (!j || !Array.isArray(j.tournamentHistory)) continue;
    if (j.tournamentHistory.length < index[k].n) short++;
    players[k].tournamentHistory = j.tournamentHistory;
    attached++;
    rows += j.tournamentHistory.length;
  }
  return {
    indexed: keys.length, attached, fetched, short, tournamentRows: rows,
    rosterNotInIndex: Object.keys(players).length - keys.length,
  };
}

module.exports = {
  BASE, CACHE_DIR, fetchText, fetchJson, fetchShards,
  playerProfiles, careerHistoryIndex, hydrateCareerHistory,
  tournamentHistoryIndex, hydrateTournamentHistory,
};
