#!/usr/bin/env node
/**
 * TEN-227 — BetsAPI historical closing-odds probe.
 *
 * READ-ONLY reconnaissance. Touches nothing the product uses: no matches.json,
 * no pipeline, no Supabase, no live site. Everything it learns is written to
 * ./betsapi-out/ and uploaded as a workflow artifact.
 *
 * The token lives ONLY as the BETSAPI_TOKEN Actions secret. It is never printed:
 * every string that reaches stdout goes through redact().
 *
 * Subcommands
 *   status    package + entitlement + rate-limit discovery (cheap, ~30 requests)
 *   discover  distinct tennis league names per target year, for level classification
 *   probe     Phase 2 proper: tables a-i
 *
 * Request budget is enforced client-side (BETSAPI_MAX_REQ) and paced to stay
 * under BETSAPI_RATE_PER_HOUR. Both are printed at start and end of every run.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';

// The secret as stored carries a trailing newline, and BetsAPI answers a
// whitespace-suffixed token with AUTHORIZE_FAILED — indistinguishable from a
// dead token. Trim here rather than asking for the secret to be re-pasted.
const TOKEN = (process.env.BETSAPI_TOKEN || '').trim();
// `dryrun` exercises the extraction against BetsAPI's own published sample JSON
// and needs no credential; every other subcommand does.
if (!TOKEN && process.argv[2] !== 'dryrun') { console.error('FATAL: BETSAPI_TOKEN is not set'); process.exit(1); }

const BASE = 'https://api.b365api.com';
const OUT = 'betsapi-out';
const MAX_REQ = Number(process.env.BETSAPI_MAX_REQ || 1500);
const RATE_PER_HOUR = Number(process.env.BETSAPI_RATE_PER_HOUR || 1600);
const MIN_GAP_MS = Math.ceil(3600_000 / RATE_PER_HOUR);
const TENNIS = 13;

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const redact = (s) => (TOKEN ? String(s).split(TOKEN).join('«TOKEN»') : String(s));
const log = (...a) => console.log(redact(a.join(' ')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let reqCount = 0;
let lastReqAt = 0;
let rateLimitHeaders = null;

class BudgetExhausted extends Error {}

async function api(path, params = {}, { retries = 2 } = {}) {
  if (reqCount >= MAX_REQ) throw new BudgetExhausted(`request budget ${MAX_REQ} exhausted`);
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  u.searchParams.set('token', TOKEN);

  const gap = Date.now() - lastReqAt;
  if (gap < MIN_GAP_MS) await sleep(MIN_GAP_MS - gap);

  for (let attempt = 0; ; attempt++) {
    lastReqAt = Date.now();
    reqCount++;
    let res, text;
    try {
      res = await fetch(u, { headers: { 'User-Agent': 'stennisfy-ten227-probe' } });
      text = await res.text();
    } catch (err) {
      if (attempt < retries) { await sleep(3000 * (attempt + 1)); continue; }
      return { ok: false, status: 0, transport: redact(err.message), body: null, headers: {} };
    }
    const headers = Object.fromEntries([...res.headers.entries()]);
    // Remember whatever rate-limit headers the vendor actually emits.
    const rl = Object.fromEntries(Object.entries(headers).filter(([k]) => /ratelimit|rate-limit|x-rl|retry-after/i.test(k)));
    if (Object.keys(rl).length) rateLimitHeaders = rl;

    let body = null;
    try { body = JSON.parse(text); } catch { body = { __unparsed: text.slice(0, 400) }; }

    const tooMany = res.status === 429 || body?.error === 'TOO_MANY_REQUESTS';
    if (tooMany && attempt < retries) {
      const wait = Number(headers['retry-after'] || 0) * 1000 || 65_000;
      log(`  rate-limited, sleeping ${Math.round(wait / 1000)}s (req #${reqCount})`);
      await sleep(wait);
      continue;
    }
    return { ok: res.ok && body?.success === 1, status: res.status, body, headers, path, params: { ...params } };
  }
}

const save = (name, obj) => writeFileSync(`${OUT}/${name}`, JSON.stringify(obj, null, 1));
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* -------------------------------------------------------------------- diag */

// Every endpoint answering AUTHORIZE_FAILED ("Token is not provided or
// incorrect" per the Glossary) is ambiguous: a dead token and a mangled secret
// look identical. This isolates the two without ever printing the token or any
// substring of it — only its length, character class and a SHA-256 fingerprint,
// which Michael can recompute locally to confirm we hold what he pasted.
async function cmdDiag() {
  const { createHash } = await import('node:crypto');
  const raw = process.env.BETSAPI_TOKEN || '';
  const fp = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);
  const shape = {
    length: raw.length,
    sha256_prefix: fp(raw),
    all_alnum: /^[0-9a-zA-Z]+$/.test(raw),
    all_hex: /^[0-9a-f]+$/i.test(raw),
    has_leading_ws: /^\s/.test(raw),
    has_trailing_ws: /\s$/.test(raw),
    has_inner_ws: /\S\s+\S/.test(raw),
    has_quotes: /^["']|["']$/.test(raw),
    has_newline: /[\r\n]/.test(raw),
    trimmed_length: raw.trim().length,
    trimmed_sha256_prefix: fp(raw.trim()),
  };
  console.log('token shape:', JSON.stringify(shape));

  const variants = {
    raw,
    trimmed: raw.trim(),
    dequoted: raw.trim().replace(/^["']|["']$/g, ''),
    first_field: raw.trim().split(/\s+/)[0] || '',
  };
  const results = {};
  for (const [name, tok] of Object.entries(variants)) {
    if (!tok) { results[name] = 'empty'; continue; }
    for (const host of ['https://api.b365api.com', 'https://api.betsapi.com']) {
      const u = `${host}/v3/events/ended?sport_id=13&token=${encodeURIComponent(tok)}`;
      let res, body;
      try {
        res = await fetch(u, { headers: { 'User-Agent': 'stennisfy-ten227-probe' } });
        body = await res.text();
      } catch (e) { results[`${name}@${host}`] = `transport:${e.message}`; continue; }
      let j = null; try { j = JSON.parse(body); } catch {}
      results[`${name}@${host}`] = `http=${res.status} success=${j?.success ?? '?'} error=${j?.error ?? '?'} detail=${j?.error_detail ?? '—'}`;
      console.log(`  ${name} @ ${host}: ${results[`${name}@${host}`]}`);
      await sleep(1500);
    }
  }
  // Control: a deliberately bogus token, to confirm what "bad token" looks like
  // and prove the AUTHORIZE_FAILED we get is not just how this endpoint answers.
  const ctl = await fetch('https://api.b365api.com/v3/events/ended?sport_id=13&token=deadbeefdeadbeef');
  const ctlBody = await ctl.text();
  console.log(`  CONTROL bogus token: http=${ctl.status} body=${ctlBody.slice(0, 200)}`);
  // Control: no token at all.
  const ctl2 = await fetch('https://api.b365api.com/v3/events/ended?sport_id=13');
  console.log(`  CONTROL no token:    http=${ctl2.status} body=${(await ctl2.text()).slice(0, 200)}`);

  save('diag.json', { shape, results });
}

/* ------------------------------------------------------------------ status */

async function cmdStatus() {
  const out = { ran_at: new Date().toISOString(), probes: [] };
  const rec = async (label, path, params) => {
    const r = await api(path, params);
    const entry = {
      label, path, params: { ...params },
      http: r.status,
      success: r.body?.success ?? null,
      error: r.body?.error ?? null,
      error_detail: r.body?.error_detail ?? null,
      pager: r.body?.pager ?? null,
      results_len: Array.isArray(r.body?.results) ? r.body.results.length
        : r.body?.results ? 'object' : null,
      headers: r.headers,
      unparsed: r.body?.__unparsed ? redact(r.body.__unparsed) : undefined,
    };
    out.probes.push(entry);
    log(`  ${label.padEnd(34)} http=${entry.http} success=${entry.success} error=${entry.error ?? '—'} n=${entry.results_len ?? '—'}`);
    return r;
  };

  log('== A. entitlement matrix ==');
  // Events API — tennis (what a Tennis API or All Events or Everything package buys)
  const y = new Date(Date.now() - 3 * 86400_000);
  const recentDay = `${y.getUTCFullYear()}${String(y.getUTCMonth() + 1).padStart(2, '0')}${String(y.getUTCDate()).padStart(2, '0')}`;
  const ended = await rec('events/ended tennis (recent)', '/v3/events/ended', { sport_id: TENNIS, day: recentDay });
  await rec('events/ended soccer', '/v3/events/ended', { sport_id: 1, day: recentDay });
  await rec('events/ended tennis 20170715', '/v3/events/ended', { sport_id: TENNIS, day: '20170715' });
  await rec('events/ended tennis 20160901(min)', '/v3/events/ended', { sport_id: TENNIS, day: '20160901' });
  await rec('events/ended tennis 20160831(<min)', '/v3/events/ended', { sport_id: TENNIS, day: '20160831' });
  await rec('league tennis', '/v1/league', { sport_id: TENNIS });
  await rec('bet365/upcoming tennis', '/v1/bet365/upcoming', { sport_id: TENNIS });
  await rec('betfair/ex_upcoming tennis', '/v1/betfair/ex_upcoming', { sport_id: TENNIS });
  await rec('bwin/upcoming tennis', '/v1/bwin/upcoming', { sport_id: TENNIS });

  const sampleEvent = ended.body?.results?.[0];
  if (sampleEvent) {
    out.sample_event = sampleEvent;
    log(`  sample tennis event_id=${sampleEvent.id} league=${sampleEvent.league?.name}`);
    await rec('event/odds (bet365)', '/v2/event/odds', { event_id: sampleEvent.id });
    await rec('event/odds/summary', '/v2/event/odds/summary', { event_id: sampleEvent.id });
    await rec('event/odds pinnaclesports', '/v2/event/odds', { event_id: sampleEvent.id, source: 'pinnaclesports' });
  }

  log('== B. account / order endpoint discovery ==');
  for (const p of ['/v1/account', '/v1/user', '/v1/me', '/v1/orders', '/v1/token', '/v1/subscription', '/v2/account']) {
    await rec(`account probe ${p}`, p, {});
  }

  out.rate_limit_headers = rateLimitHeaders;
  out.requests_used = reqCount;
  save('status.json', out);
  log(`\nrate-limit headers seen: ${JSON.stringify(rateLimitHeaders)}`);
  log(`requests used: ${reqCount} / budget ${MAX_REQ}`);
}

/* ----------------------------------------------------------------- discover */

const YEARS = [2017, 2020, 2023, 2025];
// Stratified: two days a month across the tennis calendar (Jan-Nov), fixed
// offsets so the sample is reproducible and not cherry-picked.
function sampleDays(year) {
  const days = [];
  for (let m = 1; m <= 11; m++) for (const d of [9, 23]) {
    days.push(`${year}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`);
  }
  return days;
}

async function cmdDiscover() {
  const out = { ran_at: new Date().toISOString(), years: {} };
  for (const year of YEARS) {
    const names = new Map();
    const days = sampleDays(year).filter((_, i) => i % 3 === 0); // 4 days/year for discovery
    for (const day of days) {
      const r = await api('/v3/events/ended', { sport_id: TENNIS, day });
      for (const e of r.body?.results || []) {
        const n = e.league?.name || '(null)';
        names.set(n, (names.get(n) || 0) + 1);
      }
      log(`  ${day}: total=${r.body?.pager?.total ?? '—'} page1=${r.body?.results?.length ?? 0}`);
    }
    out.years[year] = [...names.entries()].sort((a, b) => b[1] - a[1]);
    log(`${year}: ${names.size} distinct league names`);
  }
  out.requests_used = reqCount;
  save('discover.json', out);
}

/* -------------------------------------------------------------------- probe */

// Level classification from the BetsAPI tennis league name. Deliberately
// conservative: anything not clearly one of the three target levels is dropped
// rather than guessed at.
function classify(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  if (/doubles/.test(n)) return null;            // singles only
  if (/\bwta\b|\bwomen\b|\bgirls\b|\bladies\b/.test(n)) return null;
  if (/\bitf\b|\butr\b|exhibition|juniors?\b/.test(n)) return null;
  if (/australian open|roland garros|french open|wimbledon|us open/.test(n)) return 'slam';
  if (/challenger/.test(n)) return 'challenger';
  if (/\batp\b/.test(n)) return 'atp';
  return null;
}

const MARKETS = { mw: '13_1', hcap: '13_2', ou: '13_3' };
// (f) the line-coverage design's target lines, matched as exact quoted strings.
const TARGET_HCAP = ['-2.5', '-3.5', '-4.5', '-1.5'];
const TARGET_OU = ['20.5', '22.5', '21.5', '23.5'];

// Two independent pre-match discriminators, kept separate on purpose:
//   by time  — add_time <= the event's scheduled start
//   by score — the row carries no ss/time_str, i.e. the book had not gone in-play
// The dry-run on BetsAPI's own sample showed they DISAGREE (a market can still
// be quoted with a null score after the scheduled start). The closing price is
// taken from the intersection, which is the conservative reading; the two
// counts are reported side by side so the disagreement stays visible.
function seriesStats(rows, startTs) {
  const byTime = rows.filter((r) => Number(r.add_time) <= startTs);
  const byScore = rows.filter((r) => !r.ss && !r.time_str);
  const pre = rows.filter((r) => !r.ss && !r.time_str && Number(r.add_time) <= startTs);
  return {
    n_rows: rows.length,
    n_pre_by_time: byTime.length,
    n_pre_by_score: byScore.length,
    n_pre: pre.length,
    pre,
    preMatchByScore: byScore,
  };
}

async function cmdProbe() {
  const cfg = {
    per_level_per_year: Number(process.env.PROBE_N || 50),
    years: YEARS,
  };
  const out = { ran_at: new Date().toISOString(), cfg, cells: {}, pinnacle: null, books: null, requests_used: 0 };

  // ---- 1. build the stratified sample of ended singles events
  const sample = {}; // `${year}|${level}` -> [event]
  for (const year of YEARS) {
    const days = sampleDays(year);
    const buckets = { atp: [], slam: [], challenger: [] };
    for (const day of days) {
      if (Object.values(buckets).every((b) => b.length >= cfg.per_level_per_year)) break;
      for (let page = 1; page <= 3; page++) {
        let r;
        try { r = await api('/v3/events/ended', { sport_id: TENNIS, day, page }); }
        catch (e) { if (e instanceof BudgetExhausted) { log('BUDGET EXHAUSTED during sampling'); break; } throw e; }
        const rows = r.body?.results || [];
        for (const e of rows) {
          const lvl = classify(e.league?.name);
          if (!lvl) continue;
          if (String(e.time_status) !== '3') continue;   // ended normally only
          if (buckets[lvl].length >= cfg.per_level_per_year) continue;
          buckets[lvl].push({ id: e.id, time: Number(e.time), league: e.league?.name, home: e.home?.name, away: e.away?.name, ss: e.ss, round: e.round?.name ?? null, day });
        }
        const total = r.body?.pager?.total ?? 0;
        if (rows.length < 50 || page * 50 >= total) break;
      }
    }
    for (const [lvl, arr] of Object.entries(buckets)) {
      sample[`${year}|${lvl}`] = arr;
      log(`sample ${year} ${lvl}: n=${arr.length}`);
    }
  }
  save('sample.json', sample);
  log(`sampling used ${reqCount} requests`);

  // ---- 2. per-event odds pull
  const rawDir = `${OUT}/raw`;
  if (!existsSync(rawDir)) mkdirSync(rawDir, { recursive: true });

  for (const [key, events] of Object.entries(sample)) {
    const cell = {
      n_events: events.length,
      mw_present: 0, hcap_present: 0, ou_present: 0,
      any_rows_mw: 0,
      hcap_lines: {}, ou_lines: {},
      hcap_distinct_per_match: [], ou_distinct_per_match: [],
      series_rows_mw: [], pre_rows_mw: [], lead_minutes_mw: [],
      extra_markets: {},
      bo: { bo3: 0, bo5: 0, unknown: 0 },
      target_lines: {},
      discriminator_disagreements: 0,
      errors: 0,
    };
    for (const ev of events) {
      let r;
      // Deliberately NOT restricted with odds_market: the docs list only three
      // generic markets for tennis, and (d) asks whether a set handicap exists
      // at all. Asking for everything is the only way to answer that rather
      // than assume it — and it costs the same one request.
      try { r = await api('/v2/event/odds', { event_id: ev.id }); }
      catch (e) { if (e instanceof BudgetExhausted) { log(`BUDGET EXHAUSTED at ${key}`); break; } throw e; }
      if (!r.ok) { cell.errors++; continue; }
      const odds = r.body?.results?.odds || {};
      for (const k of Object.keys(odds)) if (!Object.values(MARKETS).includes(k)) cell.extra_markets[k] = (cell.extra_markets[k] || 0) + 1;

      const sets = (ev.ss || '').split(',').length;
      if (sets >= 4) cell.bo.bo5++; else if (sets >= 1 && ev.ss) cell.bo.bo3++; else cell.bo.unknown++;

      const start = ev.time;
      const mw = odds[MARKETS.mw] || [];
      const hc = odds[MARKETS.hcap] || [];
      const ou = odds[MARKETS.ou] || [];

      const mwS = seriesStats(mw, start);
      cell.any_rows_mw += mwS.n_rows > 0 ? 1 : 0;
      if (mwS.n_pre > 0) {
        cell.mw_present++;
        cell.series_rows_mw.push(mwS.n_rows);
        cell.pre_rows_mw.push(mwS.n_pre);
        const last = mwS.pre.reduce((a, b) => (Number(a.add_time) > Number(b.add_time) ? a : b));
        cell.lead_minutes_mw.push((start - Number(last.add_time)) / 60);
        // How often the two pre-match discriminators disagree, so the closing
        // definition can be stated with a measured error rate rather than a hope.
        if (mwS.n_pre_by_score !== mwS.n_pre) cell.discriminator_disagreements++;
      }
      const hcS = seriesStats(hc, start);
      if (hcS.n_pre > 0) {
        cell.hcap_present++;
        const lines = new Set();
        for (const row of hcS.pre) { if (row.handicap != null) lines.add(String(row.handicap)); }
        cell.hcap_distinct_per_match.push(lines.size);
        for (const l of lines) cell.hcap_lines[l] = (cell.hcap_lines[l] || 0) + 1;
        // (f) target lines — the exact line must have been quoted pre-match.
        for (const t of TARGET_HCAP) if (lines.has(t) || lines.has(t.replace('-', '+'))) cell.target_lines[`hcap ${t}`] = (cell.target_lines[`hcap ${t}`] || 0) + 1;
      }
      const ouS = seriesStats(ou, start);
      if (ouS.n_pre > 0) {
        cell.ou_present++;
        const lines = new Set();
        for (const row of ouS.pre) { if (row.handicap != null) lines.add(String(row.handicap)); }
        cell.ou_distinct_per_match.push(lines.size);
        for (const l of lines) cell.ou_lines[l] = (cell.ou_lines[l] || 0) + 1;
        for (const t of TARGET_OU) if (lines.has(t)) cell.target_lines[`total ${t}`] = (cell.target_lines[`total ${t}`] || 0) + 1;
      }
      writeFileSync(`${rawDir}/${key.replace('|', '_')}_${ev.id}.json`, JSON.stringify({ ev, odds }, null, 0));
    }
    cell.median_series_rows_mw = median(cell.series_rows_mw);
    cell.median_pre_rows_mw = median(cell.pre_rows_mw);
    cell.median_lead_minutes_mw = median(cell.lead_minutes_mw);
    cell.lead_minutes_range = cell.lead_minutes_mw.length
      ? [Math.min(...cell.lead_minutes_mw), Math.max(...cell.lead_minutes_mw)] : null;
    cell.median_hcap_lines_per_match = median(cell.hcap_distinct_per_match);
    cell.median_ou_lines_per_match = median(cell.ou_distinct_per_match);
    delete cell.series_rows_mw; delete cell.pre_rows_mw; delete cell.lead_minutes_mw;
    delete cell.hcap_distinct_per_match; delete cell.ou_distinct_per_match;
    out.cells[key] = cell;
    log(`${key}: n=${cell.n_events} mw=${pct(cell.mw_present, cell.n_events)} hcap=${pct(cell.hcap_present, cell.n_events)} ou=${pct(cell.ou_present, cell.n_events)} err=${cell.errors} [req ${reqCount}]`);
    save('probe.json', out);   // checkpoint after every cell
  }

  // ---- 3. (g) pinnacle on 20 ended ATP matches
  const atpPool = [...(sample['2023|atp'] || []), ...(sample['2025|atp'] || [])].slice(0, 20);
  const pin = { n: 0, ok: 0, markets: {}, errors: {} };
  for (const ev of atpPool) {
    let r; try { r = await api('/v2/event/odds', { event_id: ev.id, source: 'pinnaclesports' }); }
    catch (e) { if (e instanceof BudgetExhausted) break; throw e; }
    pin.n++;
    if (r.ok) {
      pin.ok++;
      for (const [k, v] of Object.entries(r.body?.results?.odds || {})) pin.markets[k] = (pin.markets[k] || 0) + (Array.isArray(v) ? v.length : 0);
    } else {
      const key = `${r.status}:${r.body?.error || 'empty'}`;
      pin.errors[key] = (pin.errors[key] || 0) + 1;
    }
  }
  out.pinnacle = pin;
  log(`pinnacle: n=${pin.n} ok=${pin.ok} markets=${JSON.stringify(pin.markets)} errors=${JSON.stringify(pin.errors)}`);

  // ---- 4. (h) other bookmakers, handicap/total history on tennis
  const books = ['1xbet', 'betfair', 'bwin', 'williamhill', 'unibet', '188bet', 'marathonbet', 'betway', 'sbobet', '10bet'];
  const bookPool = [...(sample['2023|atp'] || []), ...(sample['2025|atp'] || [])].slice(0, 8);
  const bookOut = {};
  for (const b of books) {
    const bs = { n: 0, mw: 0, hcap: 0, ou: 0, rows: 0 };
    for (const ev of bookPool) {
      let r; try { r = await api('/v2/event/odds', { event_id: ev.id, source: b, odds_market: '1,2,3' }); }
      catch (e) { if (e instanceof BudgetExhausted) break; throw e; }
      bs.n++;
      const o = r.body?.results?.odds || {};
      if ((o[MARKETS.mw] || []).length) bs.mw++;
      if ((o[MARKETS.hcap] || []).length) bs.hcap++;
      if ((o[MARKETS.ou] || []).length) bs.ou++;
      bs.rows += Object.values(o).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);
    }
    bookOut[b] = bs;
    log(`book ${b.padEnd(13)} n=${bs.n} mw=${bs.mw} hcap=${bs.hcap} ou=${bs.ou} rows=${bs.rows}`);
  }
  out.books = bookOut;

  out.requests_used = reqCount;
  out.rate_limit_headers = rateLimitHeaders;
  save('probe.json', out);
  log(`\nTOTAL requests used: ${reqCount} / budget ${MAX_REQ}`);
}

/* ------------------------------------------------------------------ dryrun */

// Proves the Phase 2 extraction end to end without spending a single credited
// request: BetsAPI publishes real /v2/event/odds and /v2/event/odds/summary
// payloads at /docs/samples/. They are soccer (market keys 1_*), so the keys are
// remapped to the tennis equivalents (13_*) — the row SHAPE is identical across
// sports, which is the thing under test.
async function cmdDryrun() {
  const fetchSample = async (n) => {
    const local = `${OUT}/${n}`;
    if (existsSync(local)) return JSON.parse(readFileSync(local, 'utf8'));
    const r = await fetch(`https://betsapi.com/docs/samples/${n}`);
    const j = await r.json();
    writeFileSync(local, JSON.stringify(j));
    return j;
  };

  const sampleOdds = await fetchSample('event_odds.json');
  const sampleSummary = await fetchSample('event_odds_summary.json');

  const remap = { '1_1': MARKETS.mw, '1_2': MARKETS.hcap, '1_3': MARKETS.ou };
  const odds = {};
  for (const [k, v] of Object.entries(sampleOdds.results.odds)) if (remap[k]) odds[remap[k]] = v;

  // The sample has no event record, so derive a plausible start time from the
  // data itself: the earliest row carrying an in-play marker is at-or-after
  // kickoff, so the latest pre-match row is strictly before it.
  const allRows = Object.values(odds).flat();
  const inplay = allRows.filter((r) => r.ss || r.time_str).map((r) => Number(r.add_time));
  const startTs = inplay.length ? Math.min(...inplay) : Math.max(...allRows.map((r) => Number(r.add_time)));

  const report = { startTs_derived: startTs, markets: {} };
  for (const [name, key] of Object.entries(MARKETS)) {
    const rows = odds[key] || [];
    const s = seriesStats(rows, startTs);
    const lines = {};
    for (const row of s.preMatchByScore) if (row.handicap != null) lines[String(row.handicap)] = (lines[String(row.handicap)] || 0) + 1;
    const last = s.preMatchByScore.length
      ? s.preMatchByScore.reduce((a, b) => (Number(a.add_time) > Number(b.add_time) ? a : b)) : null;
    report.markets[`${name} (${key})`] = {
      rows: s.n_rows,
      pre_match_rows_by_null_score: s.n_pre_by_score,
      pre_match_rows_by_start_time: s.n_pre_by_time,
      distinct_pre_match_lines: Object.keys(lines).length ? lines : '—',
      last_pre_match_row: last,
      lead_minutes_before_start: last ? ((startTs - Number(last.add_time)) / 60).toFixed(1) : '—',
    };
  }

  // The summary endpoint's start/end are undocumented: show empirically what
  // each one actually carries, because `end` is NOT necessarily the close.
  const firstBook = Object.keys(sampleSummary.results)[0];
  const so = sampleSummary.results[firstBook].odds;
  report.summary_semantics = {
    bookmaker: firstBook,
    bookmakers_listed: Object.keys(sampleSummary.results).length,
    start: so.start,
    end: so.end,
    end_rows_carry_inplay_marker: Object.values(so.end || {}).map((r) => ({ key: r.id, ss: r.ss, time_str: r.time_str })),
  };

  console.log(JSON.stringify(report, null, 1));
  save('dryrun.json', report);
}

/* --------------------------------------------------------------------- main */

const cmd = process.argv[2] || 'status';
log(`BetsAPI probe — cmd=${cmd} budget=${MAX_REQ} pace=${RATE_PER_HOUR}/h (${MIN_GAP_MS}ms gap)`);
try {
  if (cmd === 'diag') await cmdDiag();
  else if (cmd === 'dryrun') await cmdDryrun();
  else if (cmd === 'status') await cmdStatus();
  else if (cmd === 'discover') await cmdDiscover();
  else if (cmd === 'probe') await cmdProbe();
  else { console.error('unknown command'); process.exit(2); }
} catch (err) {
  if (err instanceof BudgetExhausted) log(`STOPPED: ${err.message} after ${reqCount} requests`);
  else { console.error(redact(err.stack || err.message)); process.exit(1); }
}
log(`done — ${reqCount} requests used`);
