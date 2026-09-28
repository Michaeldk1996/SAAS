#!/usr/bin/env node
'use strict';
// TEN-323 — fill the 2024+ ATP / Challenger box-score store from api-tennis TIER PAGES.
//
// WHY THIS EXISTS. setstats/{ek}.json, matchstats-index.json and pbp/{ek}.json are
// written from point-by-point-cache.json, and that cache only ever holds matches the
// pipeline touched: the board, board players' Form rows and H2H rows. Measured over
// the 707-player wide roster (TEN-312 phase0-b §1.3) that is 26–86% of ATP and
// 39–64% of Challenger per year 2024–26, against ~100% in the feed from 2024-03.
// A tier page (`get_fixtures&date_start&date_stop&event_type_key`) carries every
// fixture's `statistics` and `pointbypoint` inline, so a week of a whole tier costs
// one request (~135 weeks × 2 tiers ≈ 270 in total).
//
// WHERE IT WRITES, AND WHY NOT INTO THE CACHE. Folding ~25k entries of 6–12 KB into
// point-by-point-cache.json would take that one file past V8's ~512 MB max string
// length, and JSON.stringify / readFileSync would throw on it. That cache is also the
// only copy of past tiebreak points (TEN-312 N12), so it is not a file to grow
// towards a hard wall. The sweep writes its own store instead: one gzipped file
// per tier-week, boxscore-archive/{tier}-{weekStart}.json.gz, weeks anchored on
// 2024-03-01. build-point-by-point.js unions it into the shards at emit time,
// through mergeEntry(), which never replaces a point log it already holds.
//
// WRITE-ONCE, AND THE FILE IS THE NEGATIVE CACHE. Only SETTLED weeks are fetched
// (last day at least SETTLE_DAYS ago, so late results and stat corrections have
// landed) and only whole weeks, so a file is written exactly once and never
// rewritten. A week whose file exists is never asked again, whatever it held —
// an empty {} is an answer, and a rerun costs only the weeks that settled since.
// A failed page (non-200, success!=1, network) writes nothing and is retried.
// Write-once is also what keeps git growth equal to the data size: a gzip stream
// cannot be delta-compressed past its first changed byte, so a rewritten .gz costs
// a whole fresh blob every time (measured, TEN-206).
//
// Parsed with build-point-by-point.js's parseFixture/buildCacheEntry, the same
// reader the per-match path uses, so an entry cannot depend on which path reached it.
//
// Usage:
//   node tools/tier-page-sweep.js [--from=2024-03-01] [--to=YYYY-MM-DD] [--tiers=265,281]
//        [--max-requests=300] [--dir=boxscore-archive] [--dry-run]
// `--to` defaults to the last settled day; later days are the pipeline's per-match job.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
try { require('dotenv').config({ quiet: true }); } catch (_) { /* dotenv optional */ }

const ROOT = path.join(__dirname, '..');
const { buildCacheEntry, parseFixture } = require(path.join(ROOT, 'build-point-by-point.js'));

const API_TENNIS_BASE = 'https://api.api-tennis.com/tennis/';
const TIER_NAMES = { 265: 'atp', 281: 'challenger' };
const FINAL_STATUSES = ['Finished', 'Retired', 'Walk Over'];
// A week is only final once late results and stat corrections have landed.
const SETTLE_DAYS = 3;
const WINDOW_DAYS = 7;   // the feed's bulk date-range cap
const PACE_MS = 300;

const DAY = 86400000;
const iso = t => new Date(t).toISOString().slice(0, 10);
const parseDay = s => Date.parse(`${s}T00:00:00Z`);

// Consecutive 7-day windows [start, start+6] covering from..to inclusive.
function weekWindows(from, to) {
  const out = [];
  for (let t = parseDay(from); t <= parseDay(to); t += WINDOW_DAYS * DAY) {
    out.push({ start: iso(t), stop: iso(Math.min(t + (WINDOW_DAYS - 1) * DAY, parseDay(to))) });
  }
  return out;
}

// The newest day a sweep may cover: SETTLE_DAYS before today.
function lastSettledDay(today) { return iso(parseDay(today) - SETTLE_DAYS * DAY); }

// The tier-weeks still to fetch: whole weeks only (a week ending after `to` is
// left for a later run rather than fetched partially), minus every week whose
// file already exists.
function planWindows(from, to, tiers, has) {
  const plan = [];
  for (const tier of tiers) for (const w of weekWindows(from, to)) {
    if ((parseDay(w.stop) - parseDay(w.start)) / DAY !== WINDOW_DAYS - 1) continue;   // partial tail week
    if (!has(tier, w.start)) plan.push({ tier, w });
  }
  return plan;
}

function isSingles(f) {
  return /singles/i.test(f.event_type_type || '') && !/doubles/i.test(f.event_type_type || '');
}

// One archive entry: the cache-entry shape plus the three fields a coverage report
// and the emitter need (tier, date, tournament). Finished singles only — a match
// still in play would freeze a partial log.
function archiveEntry(f, tier) {
  if (!isSingles(f) || !FINAL_STATUSES.includes(f.event_status)) return null;
  if (f.event_key == null) return null;
  const e = buildCacheEntry(parseFixture(f));
  return { ...e, t: TIER_NAMES[tier] || String(tier), d: f.event_date || null, tn: f.tournament_name || null, tk: f.tournament_key ?? null };
}

const FILE_RE = /^(\d+)-(\d{4}-\d{2}-\d{2})\.json\.gz$/;
function weekPath(dir, tier, start) { return path.join(dir, `${tier}-${start}.json.gz`); }

function readWeek(file) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
}

// Deterministic bytes: sorted keys (V8 orders integer-like keys ascending anyway),
// minified, gzip with no mtime in the header — identical content, identical blob.
function writeWeek(dir, tier, start, entries) {
  const sorted = {};
  for (const k of Object.keys(entries).sort((a, b) => Number(a) - Number(b))) sorted[k] = entries[k];
  const buf = zlib.gzipSync(Buffer.from(JSON.stringify(sorted)), { level: 9 });
  const p = weekPath(dir, tier, start);
  fs.writeFileSync(`${p}.tmp`, buf);
  fs.renameSync(`${p}.tmp`, p);
}

function listWeeks(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => FILE_RE.test(f)).sort();
}

async function fetchPage(key, tier, w) {
  const url = `${API_TENNIS_BASE}?method=get_fixtures&APIkey=${key}&date_start=${w.start}&date_stop=${w.stop}&event_type_key=${tier}`;
  const res = await fetch(url);
  // A rate-limited or errored page must not read as an empty week.
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data || data.success !== 1) throw new Error(`feed returned success=${data && data.success}`);
  return Array.isArray(data.result) ? data.result : [];
}

async function main() {
  const arg = (n, d) => { const h = process.argv.find(a => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
  const today = iso(Date.now());
  const from = arg('from', '2024-03-01');
  const to = arg('to', lastSettledDay(today));
  const tiers = arg('tiers', '265,281').split(',').map(Number);
  const maxRequests = Number(arg('max-requests', '300'));
  const dir = path.resolve(ROOT, arg('dir', 'boxscore-archive'));
  const dryRun = process.argv.includes('--dry-run');
  const key = process.env.API_TENNIS_KEY;
  if (!key && !dryRun) { console.error('tier-sweep: API_TENNIS_KEY not set.'); process.exit(1); }
  if (to > lastSettledDay(today)) { console.error(`tier-sweep: --to=${to} is not settled yet (last settled day ${lastSettledDay(today)}); a file is written once and never refreshed.`); process.exit(1); }

  fs.mkdirSync(dir, { recursive: true });
  const plan = planWindows(from, to, tiers, (tier, start) => fs.existsSync(weekPath(dir, tier, start)));
  const whole = planWindows(from, to, tiers, () => false).length;
  console.log(`tier-sweep: ${whole} whole tier-weeks in ${from}..${to}; ${whole - plan.length} already archived, ${plan.length} to fetch (budget ${maxRequests}).`);
  if (dryRun) return;

  let requests = 0, failed = 0, written = 0;
  for (const { tier, w } of plan) {
    if (requests >= maxRequests) { console.log(`tier-sweep: budget ${maxRequests} reached — the rest wait for the next run.`); break; }
    requests++;
    let fixtures;
    try {
      fixtures = await fetchPage(key, tier, w);
    } catch (e) {
      failed++;   // nothing written: the week is retried next run
      console.error(`tier-sweep ${tier} ${w.start}..${w.stop} FAILED — ${e.message}`);
      continue;
    } finally {
      await new Promise(r => setTimeout(r, PACE_MS));
    }
    let finished = 0, withStats = 0, withPbp = 0;
    const entries = {};
    for (const f of fixtures) {
      const e = archiveEntry(f, tier);
      if (!e) continue;
      finished++;
      if (e.matchStats) withStats++;
      if (e.sets && e.sets.length) withPbp++;
      entries[String(f.event_key)] = e;
    }
    // Written per page, so an interrupted sweep loses at most one page and never
    // holds more than one week in memory. It never touches point-by-point-cache.json.
    writeWeek(dir, tier, w.start, entries);
    written++;
    // box= is counted over the WHOLE page, so the page is its own control: an empty
    // file can only mean the feed had nothing, never that we skipped it.
    console.log(`tier-sweep ${tier} ${w.start}..${w.stop}  fixtures=${String(fixtures.length).padStart(4)}  finished=${String(finished).padStart(4)}  box=${String(withStats).padStart(4)}  pbp=${String(withPbp).padStart(4)}`);
  }
  console.log(`tier-sweep: ${requests} request(s), ${failed} failed, ${written} week file(s) written to ${path.relative(ROOT, dir)}/.`);
}

if (require.main === module) {
  main().catch(e => { console.error('tier-sweep: unexpected error —', e); process.exit(1); });
}

module.exports = { weekWindows, lastSettledDay, planWindows, archiveEntry, readWeek, writeWeek, listWeeks, weekPath, FILE_RE, SETTLE_DAYS };
