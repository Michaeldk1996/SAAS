#!/usr/bin/env node
/**
 * TEN-216 — isolated api-tennis odds-accuracy collector, Supabase sink.
 *
 * Michael's decisions (TEN-186, 2026-09-17):
 *   - storage: Supabase, test-only. Change-rows -> Postgres. Gzipped raw -> Storage bucket.
 *   - raw fidelity: full gzipped raw EVERY poll for the first 24h, then hourly for days 2-7.
 *     Change-rows every poll throughout.
 *   - polling: 5-minute.
 *
 * ISOLATION. This writes to exactly two objects, both test-prefixed:
 *   table  public.ten216_test_odds_changes   (RLS on, zero policies -> anon cannot read)
 *   bucket ten216-test-raw                   (private)
 * It reads api-tennis and writes Supabase. It touches no repo file, no matches.json,
 * no model-output.json, no existing table, bucket, policy or pg_cron job.
 *
 * "Open" is NEVER backfilled from a past-date query. change_kind='first_seen' means
 * this collector's own live poll saw that (match, market, line, selection, book) for the
 * first time. A missed first sighting stays missed — it is a dash, not a guess.
 */

import { gzipSync } from 'node:zlib';

const API_KEY = must('API_TENNIS_KEY');
const SB_URL  = must('SUPABASE_URL').replace(/\/+$/, '');
const SB_KEY  = must('SUPABASE_SECRET_KEY');
const TABLE   = 'ten216_test_odds_changes';
const BUCKET  = 'ten216-test-raw';

const INTERVAL_MIN = Number(process.env.INTERVAL_MIN || 5);
const LOOP_MIN     = Number(process.env.LOOP_MINUTES || 330);
const WINDOW_DAYS  = Number(process.env.WINDOW_DAYS || 2);

/** Safety cap. 3,000,000 rows is roughly 450 MB with indexes — ~5.5% of the 8 GB
 *  Pro disk. If churn is far above what was measured, stop writing and say so
 *  loudly rather than quietly filling the production database. */
const MAX_ROWS = Number(process.env.MAX_ROWS || 3000000);

function must(k) {
  const v = (process.env[k] || '').trim();
  if (!v) { console.error(`FATAL: ${k} is empty`); process.exit(1); }
  return v;
}

const SEP = String.fromCharCode(1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = d => new Date(d).toISOString();
const ymd = d => new Date(d).toISOString().slice(0, 10);
const keyOf = (matchKey, market, line, selection, book) =>
  [matchKey, market, line ?? '', selection, book].join(SEP);

// ---------------------------------------------------------------- api-tennis

async function apiTennis(method, params = {}) {
  const qs = new URLSearchParams({ method, APIkey: API_KEY, ...params });
  const res = await fetch(`https://api.api-tennis.com/tennis/?${qs}`, {
    signal: AbortSignal.timeout(90000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`api-tennis ${method} HTTP ${res.status}`);
  return { text, json: JSON.parse(text) };
}

function windowDates() {
  const now = Date.now();
  return { start: ymd(now), stop: ymd(now + WINDOW_DAYS * 86400000) };
}

/**
 * Flatten get_odds into quote records.
 *
 * The nesting is NOT uniform: Home/Away is market -> selection -> book, while
 * handicap markets are market -> line -> selection -> book. Walking a fixed depth
 * mints garbage bookmaker keys (that is how an earlier pass reported "111 books").
 * So the bookmaker is only ever read from the last level that holds a scalar.
 */
function flattenOdds(result) {
  const out = new Map();
  const add = (matchKey, market, line, selection, book, price) =>
    out.set(keyOf(matchKey, market, line, selection, book),
            { matchKey, market, line, selection, book, price });

  for (const [matchKey, markets] of Object.entries(result || {})) {
    if (!markets || typeof markets !== 'object') continue;
    for (const [market, body] of Object.entries(markets)) {
      if (!body || typeof body !== 'object') continue;
      for (const [lvl1, v1] of Object.entries(body)) {
        if (!v1 || typeof v1 !== 'object') continue;
        for (const [lvl2, v2] of Object.entries(v1)) {
          if (v2 && typeof v2 === 'object') {
            for (const [book, price] of Object.entries(v2)) {
              add(matchKey, market, lvl1, lvl2, book, price);   // market -> line -> selection -> book
            }
          } else {
            add(matchKey, market, null, lvl1, lvl2, v2);         // market -> selection -> book
          }
        }
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ supabase

function sbFetch(path, init = {}) {
  return fetch(`${SB_URL}${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, ...(init.headers || {}) },
    signal: AbortSignal.timeout(120000),
  });
}

async function insertRows(rows) {
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await sbFetch(`/rest/v1/${TABLE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const body = await res.text();
      if (res.status !== 409) throw new Error(`insert HTTP ${res.status}: ${body.slice(0, 300)}`);
    } else {
      written += chunk.length;
    }
  }
  return written;
}

async function rowCount() {
  const res = await sbFetch(`/rest/v1/${TABLE}?select=id`, {
    headers: { Prefer: 'count=exact', Range: '0-0' },
  });
  const n = Number((res.headers.get('content-range') || '').split('/')[1]);
  return Number.isFinite(n) ? n : null;
}

async function firstObservedAt() {
  const res = await sbFetch(`/rest/v1/${TABLE}?select=observed_at&order=observed_at.asc&limit=1`);
  if (!res.ok) return null;
  const j = await res.json();
  return j?.[0]?.observed_at ? Date.parse(j[0].observed_at) : null;
}

/** Rebuild last-known price per quote so a handoff does not re-emit every quote as
 *  first_seen. Without this, every successor run would fabricate a new "Open" — the
 *  exact failure mode the Open rule exists to prevent. */
async function loadState() {
  const state = new Map();
  const page = 10000;
  for (let from = 0; ; from += page) {
    const res = await sbFetch(
      `/rest/v1/${TABLE}?select=match_key,market,line,selection,bookmaker,price,change_kind&order=id.asc`,
      { headers: { Range: `${from}-${from + page - 1}` } });
    if (!res.ok) break;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      const k = keyOf(r.match_key, r.market, r.line, r.selection, r.bookmaker);
      if (r.change_kind === 'removed') state.delete(k);
      else state.set(k, {
        price: r.price == null ? null : String(r.price),
        matchKey: r.match_key, market: r.market, line: r.line,
        selection: r.selection, book: r.bookmaker,
      });
    }
    if (rows.length < page) break;
  }
  return state;
}

async function uploadRaw(path, buf) {
  const res = await sbFetch(`/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/gzip', 'x-upsert': 'true' },
    body: buf,
  });
  if (!res.ok) throw new Error(`upload HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// ---------------------------------------------------------------------- tick

async function tick(state, startedAt) {
  const observedAt = new Date();
  const pollId = observedAt.toISOString().replace(/[:.]/g, '-');
  const { start, stop } = windowDates();

  const { text: rawText, json } = await apiTennis('get_odds', { date_start: start, date_stop: stop });
  if (json?.success !== 1) { console.log(`  ${iso(observedAt)} get_odds success!=1 — skipping tick`); return; }

  // event_live / event_status drive the Closing definition (last price before live).
  const live = new Map();
  try {
    const fx = await apiTennis('get_fixtures', { date_start: start, date_stop: stop });
    for (const f of fx.json?.result || []) {
      live.set(String(f.event_key), {
        status: f.event_status ?? null,
        live: f.event_live === '1' || f.event_live === 1,
        tour: f.event_type_type ?? null,
      });
    }
  } catch (e) {
    console.log(`  fixtures lookup failed (non-fatal): ${e.message}`);
  }

  const now = flattenOdds(json.result);
  const rows = [];
  const base = { observed_at: observedAt.toISOString(), poll_id: pollId };

  for (const [k, q] of now) {
    const meta = live.get(String(q.matchKey)) || {};
    const prev = state.get(k);
    const cur = q.price == null ? null : String(q.price);
    if (!prev || prev.price !== cur) {
      rows.push({
        ...base,
        match_key: String(q.matchKey), tour: meta.tour ?? null,
        event_status: meta.status ?? null, event_live: meta.live ?? null,
        market: q.market, line: q.line, selection: q.selection, bookmaker: q.book,
        price: cur, prev_price: prev ? prev.price : null,
        change_kind: prev ? 'changed' : 'first_seen',
      });
    }
    state.set(k, { price: cur, ...q });
  }
  for (const [k, prev] of [...state]) {
    if (now.has(k)) continue;
    rows.push({
      ...base,
      match_key: String(prev.matchKey), market: prev.market, line: prev.line,
      selection: prev.selection, bookmaker: prev.book,
      price: null, prev_price: prev.price, change_kind: 'removed',
      tour: null, event_status: null, event_live: null,
    });
    state.delete(k);
  }

  const count = await rowCount();
  if (count != null && count + rows.length > MAX_ROWS) {
    console.error(`STOP: change-row cap reached (${count} + ${rows.length} > ${MAX_ROWS}). ` +
                  `Churn is far above what was measured. Not writing — reporting instead.`);
    process.exit(2);
  }

  const written = await insertRows(rows);

  // Raw fidelity: every poll for the first 24h, then hourly.
  const ageH = (observedAt - startedAt) / 3600000;
  const keepRaw = ageH < 24 || observedAt.getUTCMinutes() < INTERVAL_MIN;
  let rawNote = 'raw skipped (day 2-7, not top of hour)';
  if (keepRaw) {
    const gz = gzipSync(Buffer.from(rawText), { level: 9 });
    await uploadRaw(`odds/${ymd(observedAt)}/${pollId}.json.gz`, gz);
    rawNote = `raw ${(gz.length / 1024).toFixed(0)} KB gz (${ageH < 24 ? 'first-24h full' : 'hourly'})`;
  }

  const by = k => rows.filter(r => r.change_kind === k).length;
  console.log(`  ${iso(observedAt)} matches=${Object.keys(json.result).length} quotes=${now.size} ` +
              `rows=${rows.length} (first_seen=${by('first_seen')} changed=${by('changed')} ` +
              `removed=${by('removed')}) written=${written} table=${count ?? '-'} | ${rawNote}`);
}

// ---------------------------------------------------------------------- main

const t0 = Date.now();
console.log(`TEN-216 Supabase collector — interval ${INTERVAL_MIN} min, loop ${LOOP_MIN} min, window +${WINDOW_DAYS}d`);
const state = await loadState();
const firstSeen = await firstObservedAt();
const startedAt = firstSeen ? new Date(firstSeen) : new Date();
console.log(`state rebuilt: ${state.size} known quotes; collection started ${iso(startedAt)}`);

let n = 0;
while ((Date.now() - t0) / 60000 < LOOP_MIN) {
  n += 1;
  try { await tick(state, startedAt); }
  catch (e) { console.error(`  tick ${n} failed (continuing): ${e.message}`); }
  if ((Date.now() - t0) / 60000 + INTERVAL_MIN >= LOOP_MIN) break;
  await sleep(INTERVAL_MIN * 60000);
}
console.log(`loop done after ${n} ticks, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
