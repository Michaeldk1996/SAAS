#!/usr/bin/env node
/**
 * TEN-216 — ISOLATED api-tennis odds accuracy collector.
 *
 * AUTHORISED BY FOUNDER 2026-09-16. This is a TEST collector.
 * It writes ONLY under ten216-data/ on the dedicated branch `ten216-odds-accuracy`.
 * It reads no production file and writes no production file. Nothing it produces
 * feeds the live board or the model.
 *
 * NOT TOUCHED (explicit do-not-touch list): fetchApiTennisMatchOdds,
 * refresh-odds.py, odds-history.yml / odds-now.yml, matches.json,
 * model-output.json, config.js, any model layer.
 *
 * WHAT IT RECORDS, per 5-minute tick:
 *   1. Every Home/Away price for every book over the window today..today+2,
 *      but written as CHANGE ROWS only (a row appears the tick a price first
 *      appears or changes). First appearance is flagged `first:true` — that is
 *      the "first seen" the whole measurement is about.
 *   2. Fixture state for every match_key in the window (event_status, start
 *      time, and the NS->live flip) so a close can be located without timezone
 *      guesswork.
 *   3. Scheduled-vs-actual tick time, for the Actions lateness distribution (H).
 *   4. An hourly FULL RAW payload snapshot, gzipped, for auditability.
 *
 * WHY NOT FULL RAW EVERY TICK: measured 2026-09-17 on the real window —
 * 1.676 MB/call raw, 0.196 MB gzipped (8.6:1). At 5-min polling that is
 * 483 MB/day raw -> 3.30 GB over 7 days (395 MB even gzipped). Change-rows
 * carry every price transition at ~1% of that, and the hourly raw snapshot
 * preserves the all-books/all-markets audit trail. Deviation reported to the
 * founder; trivially reversible by setting RAW_EVERY_TICK=1.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const KEY = process.env.API_TENNIS_KEY;
if (!KEY) { console.error('FATAL: API_TENNIS_KEY not set'); process.exit(1); }

const BASE = 'https://api.api-tennis.com/tennis/';
const DATA = process.env.TEN216_DATA || 'ten216-data';
const INTERVAL_MIN = Number(process.env.TEN216_INTERVAL_MIN || 5);
const LOOP_MINUTES = Number(process.env.TEN216_LOOP_MINUTES || 330);
const RAW_EVERY_TICK = process.env.TEN216_RAW_EVERY_TICK === '1';
const RAW_EVERY_N = Math.max(1, Math.round(60 / INTERVAL_MIN)); // hourly

fs.mkdirSync(path.join(DATA, 'raw'), { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = () => new Date().toISOString();
const day = (off = 0) => new Date(Date.now() + off * 86400000).toISOString().slice(0, 10);

async function call(params, tries = 3) {
  const url = `${BASE}?APIkey=${KEY}&` + new URLSearchParams(params).toString();
  for (let i = 0; i < tries; i++) {
    try {
      const t0 = Date.now();
      const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.status !== 200) { await sleep(3000 * (i + 1)); continue; }
      return { bytes: buf.length, ms: Date.now() - t0, json: JSON.parse(buf.toString('utf8')), raw: buf };
    } catch (e) {
      if (i === tries - 1) return { error: String(e && e.message || e) };
      await sleep(3000 * (i + 1));
    }
  }
  return { error: 'exhausted' };
}

function appendJsonl(file, rows) {
  if (!rows.length) return;
  fs.appendFileSync(path.join(DATA, file), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
}

// ---- state carried across ticks so we can emit change-rows ------------------
// key: `${match_key}|${book}|${side}` -> last price string
const lastPrice = new Map();
// match_key -> last event_status seen
const lastStatus = new Map();

const STATE_FILE = path.join(DATA, 'state.json');
if (fs.existsSync(STATE_FILE)) {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    for (const [k, v] of Object.entries(s.lastPrice || {})) lastPrice.set(k, v);
    for (const [k, v] of Object.entries(s.lastStatus || {})) lastStatus.set(k, v);
    console.log(`[state] resumed ${lastPrice.size} price keys, ${lastStatus.size} statuses`);
  } catch (e) { console.log(`[state] unreadable, starting clean: ${e.message}`); }
}
function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    savedAt: iso(),
    lastPrice: Object.fromEntries(lastPrice),
    lastStatus: Object.fromEntries(lastStatus),
  }));
}

async function tick(n, scheduledAt) {
  const actualAt = iso();
  const lateSec = (Date.parse(actualAt) - Date.parse(scheduledAt)) / 1000;

  const dStart = day(0), dStop = day(2);
  const odds = await call({ method: 'get_odds', date_start: dStart, date_stop: dStop });
  const fx = await call({ method: 'get_fixtures', date_start: dStart, date_stop: dStop });

  const tickRow = {
    tick: n, scheduledAt, actualAt, lateSec,
    dStart, dStop,
    oddsBytes: odds.bytes ?? null, oddsMs: odds.ms ?? null, oddsError: odds.error ?? null,
    fxBytes: fx.bytes ?? null, fxMs: fx.ms ?? null, fxError: fx.error ?? null,
    runId: process.env.GITHUB_RUN_ID || null,
    host: process.env.GITHUB_ACTIONS ? 'actions' : 'local',
  };

  // ---- fixtures: status, start time, NS->live flip -------------------------
  const fixtures = Array.isArray(fx.json?.result) ? fx.json.result : [];
  const meta = new Map();
  const statusRows = [];
  for (const f of fixtures) {
    const mk = String(f.event_key);
    meta.set(mk, {
      date: f.event_date, time: f.event_time,
      p1: f.event_first_player, p2: f.event_second_player,
      p1k: f.first_player_key, p2k: f.second_player_key,
      tour: f.tournament_name, round: f.tournament_round,
      season: f.tournament_season, type: f.event_type_type,
      live: f.event_live, status: f.event_status,
    });
    const sig = `${f.event_live}|${f.event_status}`;
    if (lastStatus.get(mk) !== sig) {
      statusRows.push({
        obsAt: actualAt, tick: n, mk,
        prev: lastStatus.get(mk) ?? null, live: f.event_live, status: f.event_status,
        date: f.event_date, time: f.event_time,
        p1: f.event_first_player, p2: f.event_second_player,
        tour: f.tournament_name, round: f.tournament_round, type: f.event_type_type,
      });
      lastStatus.set(mk, sig);
    }
  }
  tickRow.fixtures = fixtures.length;
  tickRow.statusChanges = statusRows.length;

  // ---- odds: Home/Away change rows ----------------------------------------
  const res = (odds.json && odds.json.result && typeof odds.json.result === 'object' && !Array.isArray(odds.json.result))
    ? odds.json.result : {};
  const priceRows = [];
  let withOdds = 0, quotes = 0;
  for (const [mk, markets] of Object.entries(res)) {
    const ha = markets && markets['Home/Away'];
    if (!ha || typeof ha !== 'object') continue;
    withOdds++;
    const m = meta.get(mk) || {};
    for (const side of Object.keys(ha)) {
      const byBook = ha[side];
      if (!byBook || typeof byBook !== 'object') continue;
      for (const [book, price] of Object.entries(byBook)) {
        quotes++;
        const k = `${mk}|${book}|${side}`;
        const prev = lastPrice.get(k);
        if (prev === String(price)) continue;
        priceRows.push({
          obsAt: actualAt, tick: n, mk, book, side,
          price: Number(price), prevPrice: prev === undefined ? null : Number(prev),
          first: prev === undefined,
          date: m.date ?? null, time: m.time ?? null,
          p1: m.p1 ?? null, p2: m.p2 ?? null,
          tour: m.tour ?? null, round: m.round ?? null, type: m.type ?? null,
          evLive: m.live ?? null, evStatus: m.status ?? null,
        });
        lastPrice.set(k, String(price));
      }
    }
  }
  tickRow.matchesWithOdds = withOdds;
  tickRow.quotes = quotes;
  tickRow.priceChanges = priceRows.length;
  tickRow.firstSeen = priceRows.filter(r => r.first).length;

  appendJsonl('prices.jsonl', priceRows);
  appendJsonl('status.jsonl', statusRows);
  appendJsonl('ticks.jsonl', [tickRow]);

  if (odds.raw && (RAW_EVERY_TICK || n % RAW_EVERY_N === 0)) {
    const f = path.join(DATA, 'raw', `odds-${actualAt.replace(/[:.]/g, '-')}.json.gz`);
    fs.writeFileSync(f, zlib.gzipSync(odds.raw, { level: 9 }));
    console.log(`  [raw] ${path.basename(f)}`);
  }
  saveState();

  console.log(`[tick ${n}] ${actualAt} late=${lateSec.toFixed(0)}s fixtures=${fixtures.length} ` +
    `withOdds=${withOdds} quotes=${quotes} changes=${priceRows.length} first=${tickRow.firstSeen} ` +
    `statusFlips=${statusRows.length}`);
  return tickRow;
}

// ---- supervisor loop ------------------------------------------------------
// Same shape as the production odds capture loop: one delivered schedule slot
// buys ~5h30m of 5-minute ticks. GitHub sheds short-interval crons (measured
// 27% delivery on an hourly schedule), so the loop — not the cron — is what
// makes the cadence real.
const started = Date.now();
let n = 0;
console.log(`TEN216 collector start ${iso()} interval=${INTERVAL_MIN}m loop=${LOOP_MINUTES}m data=${DATA}`);
while ((Date.now() - started) / 60000 < LOOP_MINUTES) {
  n++;
  const scheduledAt = new Date(started + (n - 1) * INTERVAL_MIN * 60000).toISOString();
  try { await tick(n, scheduledAt); }
  catch (e) { console.error(`[tick ${n}] FAILED: ${e && e.stack || e}`); }
  const nextAt = started + n * INTERVAL_MIN * 60000;
  const wait = nextAt - Date.now();
  if (wait > 0) await sleep(wait);
}
console.log(`TEN216 collector end ${iso()} after ${n} ticks`);
