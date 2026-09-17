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

// The books sweep turned up something the Phase 2 sweep could not see:
// /v2/event/odds/summary reports a Bet365 13_1 record on 52 of 52 sampled 2017
// matches, while /v2/event/odds returns ZERO rows for the same year. The
// summary endpoint therefore reaches back further than the series endpoint.
//
// That matters for the closing-price ruling, so the payload gets dumped verbatim
// rather than summarised: whether `start`/`end` carry ss/time_str decides whether
// a pre-match price is recoverable from them at all, and Phase 1 already showed
// `end` can be an in-play number. Reading the field names is the whole point.
async function cmdShape() {
  const out = { ran_at: new Date().toISOString(), samples: [] };
  for (const day of ['20170909', '20200923', '20250909']) {
    const ended = await api('/v3/events/ended', { sport_id: TENNIS, day });
    const ev = (ended.body?.results || []).find((e) => classify(e.league?.name));
    if (!ev) { log(`${day}: no classified event on page 1`); continue; }
    const s = await api('/v2/event/odds/summary', { event_id: ev.id });
    const o = await api('/v2/event/odds', { event_id: ev.id });
    const entry = {
      day,
      event: { id: ev.id, league: ev.league?.name, home: ev.home?.name, away: ev.away?.name, ss: ev.ss, time: ev.time },
      summary_books: Object.keys(s.body?.results || {}),
      summary_bet365: s.body?.results?.Bet365 ?? null,
      odds_markets: Object.fromEntries(Object.entries(o.body?.results?.odds || {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])),
    };
    out.samples.push(entry);
    log(`\n=== ${day} event ${ev.id} "${ev.league?.name}" ${ev.home?.name} vs ${ev.away?.name} start=${ev.time}`);
    log(`  /v2/event/odds markets: ${JSON.stringify(entry.odds_markets)}`);
    log(`  summary books: ${entry.summary_books.join(', ') || '—'}`);
    log(`  summary Bet365 verbatim:\n${JSON.stringify(entry.summary_bet365, null, 2)}`);
  }
  save('shape.json', out);
}

// The shape dump exposed a counting error I have to correct rather than paper
// over: on 2017 matches /v2/event/odds/summary returns `"13_1": null` — the KEY
// is present, the VALUE is empty. cmdBooks counted Object.keys(), so it scored
// those as coverage. Every number it produced is therefore "the book had a slot
// for this market", not "the book quoted this market".
//
// FonBet is the only book that scored 13_2/13_3 at all, so the entire
// handicap/total finding rests on whether ITS values are populated. This
// re-measures with a non-null test and dumps the payload verbatim so the answer
// is readable rather than inferred, and also pulls the FonBet price series to
// see whether a handicap LINE (not just a market slot) actually comes back.
async function cmdFonbet() {
  const out = { ran_at: new Date().toISOString(), days: {}, samples: [], tally: {} };
  const nonNull = (v) => v !== null && v !== undefined && typeof v === 'object';
  const tally = { matches: 0, fonbet_present: 0, fonbet_nonnull: { '13_1': 0, '13_2': 0, '13_3': 0 } };
  const bet365 = { '13_1': 0, '13_2': 0, '13_3': 0 };

  for (const day of ['20250909', '20250723', '20250520', '20250311']) {
    const ended = await api('/v3/events/ended', { sport_id: TENNIS, day });
    const evs = (ended.body?.results || []).filter((e) => classify(e.league?.name)).slice(0, 10);
    out.days[day] = evs.length;
    for (const ev of evs) {
      let r; try { r = await api('/v2/event/odds/summary', { event_id: ev.id }); }
      catch (e) { if (e instanceof BudgetExhausted) break; throw e; }
      if (!r.ok) continue;
      tally.matches++;
      const books = r.body?.results || {};
      for (const m of ['13_1', '13_2', '13_3']) {
        const b = books.Bet365?.odds;
        if (b && (nonNull(b.start?.[m]) || nonNull(b.kickoff?.[m]) || nonNull(b.end?.[m]))) bet365[m]++;
      }
      const f = books.FonBet;
      if (!f) continue;
      tally.fonbet_present++;
      for (const m of ['13_1', '13_2', '13_3']) {
        if (nonNull(f.odds?.start?.[m]) || nonNull(f.odds?.kickoff?.[m]) || nonNull(f.odds?.end?.[m])) tally.fonbet_nonnull[m]++;
      }
      if (out.samples.length < 3) {
        // Verbatim, plus the series, so the handicap LINE is visible if one exists.
        const series = await api('/v2/event/odds', { event_id: ev.id, source: 'fonbet' });
        out.samples.push({
          event: { id: ev.id, league: ev.league?.name, home: ev.home?.name, away: ev.away?.name, time: ev.time, ss: ev.ss },
          fonbet_summary: f,
          fonbet_series_counts: Object.fromEntries(Object.entries(series.body?.results?.odds || {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])),
          fonbet_series_first_rows: Object.fromEntries(Object.entries(series.body?.results?.odds || {}).map(([k, v]) => [k, Array.isArray(v) ? v.slice(-3) : null])),
        });
        log(`\n=== ${ev.id} "${ev.league?.name}" ${ev.home?.name} vs ${ev.away?.name}`);
        log(`  FonBet summary verbatim:\n${JSON.stringify(f, null, 2)}`);
        log(`  FonBet /v2/event/odds row counts: ${JSON.stringify(out.samples.at(-1).fonbet_series_counts)}`);
        log(`  FonBet earliest rows: ${JSON.stringify(out.samples.at(-1).fonbet_series_first_rows)}`);
      }
    }
  }
  out.tally = { ...tally, bet365_nonnull: bet365 };
  log(`\nmatches summarised: ${tally.matches}`);
  log(`FonBet present on:  ${tally.fonbet_present}  (${pct(tally.fonbet_present, tally.matches)})`);
  log(`FonBet NON-NULL  13_1=${tally.fonbet_nonnull['13_1']} 13_2=${tally.fonbet_nonnull['13_2']} 13_3=${tally.fonbet_nonnull['13_3']}`);
  log(`Bet365 NON-NULL  13_1=${bet365['13_1']} 13_2=${bet365['13_2']} 13_3=${bet365['13_3']}`);
  save('fonbet.json', out);
}

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
// rather than guessed at, and every drop is counted so the exclusion rate is
// reportable instead of invisible.
//
// The ` MD` / ` WD` suffixes are DOUBLES containers, not "main draw" — verified
// by the `suffix` subcommand, which reads the player names out of suffixed vs
// unsuffixed leagues ("A/B" pairs vs single names). Getting this backwards would
// silently fill the sample with doubles matches, whose games-handicap lines are
// a different market entirely.
const DROP = {
  doubles: /(\bMD\b|\bWD\b|doubles)\s*$/i,
  qualifying: /\bqual(ifying|ifier)?\b\s*$/i,
  women: /\bwta\b|\bwomen\b|\bgirls\b|\bladies\b|\bw\d{2,3}\b/i,
  lower_tier: /\bitf\b|\butr\b|\bm\d{2,3}\b|exhibition|junior/i,
};
const dropCounts = Object.fromEntries(Object.keys(DROP).map((k) => [k, 0]));
let unclassified = 0;

function classify(name) {
  if (!name) return null;
  for (const [reason, re] of Object.entries(DROP)) {
    if (re.test(name)) { dropCounts[reason]++; return null; }
  }
  const n = name.trim().toLowerCase();
  if (/^(australian open|roland garros|french open|wimbledon|us open)$/.test(n)) return 'slam';
  if (/^challenger\b/.test(n)) return 'challenger';
  if (/^atp\b/.test(n)) return 'atp';
  unclassified++;
  return null;
}

// Reads the player names behind suffixed and unsuffixed league names, so the
// MD/WD reading is measured rather than assumed. Doubles fixtures name two
// players per side, separated by "/".
async function cmdSuffix() {
  const out = { ran_at: new Date().toISOString(), groups: {} };
  const seen = { MD: [], WD: [], Qual: [], plain: [] };
  for (const day of ['20230523', '20250709', '20170715']) {
    for (let page = 1; page <= 2; page++) {
      const r = await api('/v3/events/ended', { sport_id: TENNIS, day, page });
      for (const e of r.body?.results || []) {
        const n = e.league?.name || '';
        const g = /\bMD$/.test(n) ? 'MD' : /\bWD$/.test(n) ? 'WD' : /\bQual$/.test(n) ? 'Qual' : 'plain';
        if (seen[g].length >= 6) continue;
        seen[g].push({ league: n, home: e.home?.name, away: e.away?.name, ss: e.ss, round: e.round?.name ?? null });
      }
    }
  }
  for (const [g, rows] of Object.entries(seen)) {
    const slashRate = rows.length ? rows.filter((r) => /\//.test(r.home || '') || /\//.test(r.away || '')).length / rows.length : null;
    out.groups[g] = { n: rows.length, pair_named_rate: slashRate, rows };
    log(`${g.padEnd(6)} n=${rows.length} "A/B"-named=${slashRate === null ? '—' : pct(slashRate * rows.length, rows.length)}`);
    for (const r of rows.slice(0, 3)) log(`    ${r.league} | ${r.home} vs ${r.away} | ss=${r.ss}`);
  }
  save('suffix.json', out);
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

// The stratified sample is deterministic — fixed days, fixed stride — so any
// later subcommand can rebuild the identical sample and stay comparable with
// the Phase 2 numbers instead of measuring a different set of matches.
async function buildSample(perLevelPerYear) {
  const sample = {}; // `${year}|${level}` -> [event]
  for (const year of YEARS) {
    const days = sampleDays(year);
    // Two passes on purpose. Filling buckets greedily as days stream in would
    // take all 50 ATP matches from January and call it a year — a hard-court
    // sample masquerading as a season. So: collect every candidate across the
    // whole calendar first, then thin each level evenly across the days that
    // actually have matches.
    const candidates = { atp: [], slam: [], challenger: [] };
    for (const day of days) {
      for (let page = 1; page <= 4; page++) {
        let r;
        try { r = await api('/v3/events/ended', { sport_id: TENNIS, day, page }); }
        catch (e) { if (e instanceof BudgetExhausted) { log('BUDGET EXHAUSTED during sampling'); break; } throw e; }
        const rows = r.body?.results || [];
        for (const e of rows) {
          const lvl = classify(e.league?.name);
          if (!lvl) continue;
          if (String(e.time_status) !== '3') continue;   // ended normally only
          if (/\//.test(e.home?.name || '') || /\//.test(e.away?.name || '')) continue; // belt-and-braces doubles guard
          candidates[lvl].push({ id: e.id, time: Number(e.time), league: e.league?.name, home: e.home?.name, away: e.away?.name, ss: e.ss, round: e.round?.name ?? null, day });
        }
        const total = r.body?.pager?.total ?? 0;
        if (rows.length < 50 || page * 50 >= total) break;
      }
    }
    for (const [lvl, all] of Object.entries(candidates)) {
      let picked = all;
      if (all.length > perLevelPerYear) {
        const stride = all.length / perLevelPerYear;
        picked = Array.from({ length: perLevelPerYear }, (_, i) => all[Math.floor(i * stride)]);
      }
      sample[`${year}|${lvl}`] = picked;
      const daysCovered = new Set(picked.map((p) => p.day)).size;
      log(`sample ${year} ${lvl}: n=${picked.length} of ${all.length} candidates, across ${daysCovered} days`);
    }
  }
  return sample;
}

// (h) done properly. The Phase 2 book sweep asked ten named bookmakers for odds
// and found handicap/total nowhere — but it never asked FonBet, and the markets
// probe then caught FonBet reporting 13_2 AND 13_3 on ended tennis. A named
// list can only ever find the books someone thought to name, so this inverts
// it: /v2/event/odds/summary returns EVERY book that priced the match in one
// request, so the books are discovered from the data instead of guessed, and
// the same call reports which market keys each one carried.
async function cmdBooks() {
  const n = Number(process.env.PROBE_N || 25);
  const out = { ran_at: new Date().toISOString(), per_level_per_year: n, cells: {}, books: {}, requests_used: 0 };
  const sample = await buildSample(n);
  save('books-sample.json', sample);
  log(`sampling used ${reqCount} requests`);

  // book -> year -> { seen, mw, hcap, ou }
  const agg = {};
  for (const [key, events] of Object.entries(sample)) {
    const [year, level] = key.split('|');
    const cell = { n_events: 0, ok: 0, books_seen: {} };
    for (const ev of events) {
      let r;
      try { r = await api('/v2/event/odds/summary', { event_id: ev.id }); }
      catch (e) { if (e instanceof BudgetExhausted) { log(`BUDGET EXHAUSTED at ${key}`); break; } throw e; }
      cell.n_events++;
      if (!r.ok) continue;
      cell.ok++;
      for (const [book, payload] of Object.entries(r.body?.results || {})) {
        // A key can be present with a null value — 2017 summaries return
        // "13_1": null on every book. Counting keys therefore counts empty
        // slots as coverage. Both are recorded: `*_key` is what the first pass
        // measured, `*` is what is actually quoted, and the gap between them is
        // the size of that error.
        const keys = new Set();
        const filled = new Set();
        for (const side of ['start', 'kickoff', 'end']) {
          for (const [k, v] of Object.entries(payload?.odds?.[side] || {})) {
            keys.add(k);
            if (v !== null && v !== undefined && typeof v === 'object') filled.add(k);
          }
        }
        cell.books_seen[book] = (cell.books_seen[book] || 0) + 1;
        agg[book] ||= {};
        agg[book][year] ||= { seen: 0, mw: 0, hcap: 0, ou: 0, mw_key: 0, hcap_key: 0, ou_key: 0, levels: {} };
        const a = agg[book][year];
        a.seen++;
        if (keys.has(MARKETS.mw)) a.mw_key++;
        if (keys.has(MARKETS.hcap)) a.hcap_key++;
        if (keys.has(MARKETS.ou)) a.ou_key++;
        if (filled.has(MARKETS.mw)) a.mw++;
        if (filled.has(MARKETS.hcap)) a.hcap++;
        if (filled.has(MARKETS.ou)) a.ou++;
        a.levels[level] = (a.levels[level] || 0) + 1;
      }
    }
    out.cells[key] = cell;
    log(`${key}: n=${cell.n_events} ok=${cell.ok} distinct books=${Object.keys(cell.books_seen).length} [req ${reqCount}]`);
    save('books.json', out);
  }
  out.books = agg;
  out.requests_used = reqCount;
  out.rate_limit_headers = rateLimitHeaders;
  save('books.json', out);

  // Rank by how often the book carried a handicap or a total, which is the only
  // thing the line-coverage design actually needs.
  const rank = Object.entries(agg).map(([b, years]) => {
    const t = { book: b, seen: 0, mw: 0, hcap: 0, ou: 0, mw_key: 0, hcap_key: 0, ou_key: 0 };
    for (const y of Object.values(years)) {
      for (const k of ['seen', 'mw', 'hcap', 'ou', 'mw_key', 'hcap_key', 'ou_key']) t[k] += y[k] || 0;
    }
    return t;
  }).sort((a, b) => (b.hcap + b.ou) - (a.hcap + a.ou) || b.mw - a.mw || b.seen - a.seen);
  log('\n                            QUOTED (non-null)        KEY PRESENT (may be null)');
  log('book                 seen    13_1   13_2   13_3      13_1   13_2   13_3');
  for (const t of rank) {
    log(`${t.book.padEnd(18)} ${String(t.seen).padStart(6)} ${String(t.mw).padStart(7)} ${String(t.hcap).padStart(6)} ${String(t.ou).padStart(6)}    ${String(t.mw_key).padStart(6)} ${String(t.hcap_key).padStart(6)} ${String(t.ou_key).padStart(6)}`);
  }
  log('\nper-year for any book that ever QUOTED 13_2 or 13_3:');
  const movers = rank.filter((x) => x.hcap + x.ou > 0);
  if (!movers.length) log('  none — no bookmaker quoted a handicap or a total on any sampled match.');
  for (const t of movers) {
    for (const [y, v] of Object.entries(agg[t.book]).sort()) {
      log(`  ${t.book.padEnd(16)} ${y}: seen=${v.seen} mw=${v.mw} hcap=${v.hcap} ou=${v.ou} levels=${JSON.stringify(v.levels)}`);
    }
  }
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
    // Two passes on purpose. Filling buckets greedily as days stream in would
    // take all 50 ATP matches from January and call it a year — a hard-court
    // sample masquerading as a season. So: collect every candidate across the
    // whole calendar first, then thin each level evenly across the days that
    // actually have matches.
    const candidates = { atp: [], slam: [], challenger: [] };
    for (const day of days) {
      for (let page = 1; page <= 4; page++) {
        let r;
        try { r = await api('/v3/events/ended', { sport_id: TENNIS, day, page }); }
        catch (e) { if (e instanceof BudgetExhausted) { log('BUDGET EXHAUSTED during sampling'); break; } throw e; }
        const rows = r.body?.results || [];
        for (const e of rows) {
          const lvl = classify(e.league?.name);
          if (!lvl) continue;
          if (String(e.time_status) !== '3') continue;   // ended normally only
          if (/\//.test(e.home?.name || '') || /\//.test(e.away?.name || '')) continue; // belt-and-braces doubles guard
          candidates[lvl].push({ id: e.id, time: Number(e.time), league: e.league?.name, home: e.home?.name, away: e.away?.name, ss: e.ss, round: e.round?.name ?? null, day });
        }
        const total = r.body?.pager?.total ?? 0;
        if (rows.length < 50 || page * 50 >= total) break;
      }
    }
    for (const [lvl, all] of Object.entries(candidates)) {
      const want = cfg.per_level_per_year;
      let picked = all;
      if (all.length > want) {
        // Even stride over the chronologically ordered candidate list.
        const stride = all.length / want;
        picked = Array.from({ length: want }, (_, i) => all[Math.floor(i * stride)]);
      }
      sample[`${year}|${lvl}`] = picked;
      const daysCovered = new Set(picked.map((p) => p.day)).size;
      log(`sample ${year} ${lvl}: n=${picked.length} of ${all.length} candidates, across ${daysCovered} days`);
    }
  }
  out.classifier = { drops: { ...dropCounts }, unclassified };
  log(`classifier drops: ${JSON.stringify(dropCounts)} unclassified=${unclassified}`);
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

/* ------------------------------------------------------------------ census */

// Phase 3 asks for "ended events per year 2016-2025" to size the full download.
// Counting every day of ten years would itself cost ~3,650 requests, so this
// measures a stratified sample of days and reports BOTH the measured counts and
// the projection built from them — the projection is labelled as such and
// carries its own n, because a download budget derived from a guess is a guess.
async function cmdCensus() {
  const CENSUS_YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
  const daysPerMonth = [6, 20];
  const out = { ran_at: new Date().toISOString(), years: {} };

  for (const year of CENSUS_YEARS) {
    // 2016 only exists from the 20160901 floor onward.
    const months = year === 2016 ? [9, 10, 11, 12] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const days = [];
    for (const m of months) for (const d of daysPerMonth) days.push(`${year}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`);

    const per = [];
    for (const day of days) {
      let allTennis = null;
      const counts = { atp: 0, slam: 0, challenger: 0 };
      for (let page = 1; page <= 4; page++) {
        let r;
        try { r = await api('/v3/events/ended', { sport_id: TENNIS, day, page }); }
        catch (e) { if (e instanceof BudgetExhausted) { log('BUDGET EXHAUSTED during census'); break; } throw e; }
        const rows = r.body?.results || [];
        if (page === 1) allTennis = r.body?.pager?.total ?? null;
        for (const e of rows) {
          const lvl = classify(e.league?.name);
          if (!lvl) continue;
          if (String(e.time_status) !== '3') continue;
          if (/\//.test(e.home?.name || '') || /\//.test(e.away?.name || '')) continue;
          counts[lvl]++;
        }
        const total = r.body?.pager?.total ?? 0;
        if (rows.length < 50 || page * 50 >= total) break;
      }
      // Paging stops at 4 pages; if the day had more, the target-level counts
      // are a FLOOR, not a count. Flag it rather than silently under-reporting.
      const truncated = (allTennis ?? 0) > 200;
      per.push({ day, all_tennis_ended: allTennis, ...counts, truncated });
    }

    const clean = per.filter((p) => !p.truncated);
    const sum = (k, rows) => rows.reduce((a, r) => a + (r[k] || 0), 0);
    const yearDays = year === 2016 ? 122 : (year % 4 === 0 ? 366 : 365);
    out.years[year] = {
      days_sampled: per.length,
      days_untruncated: clean.length,
      days_in_scope: yearDays,
      measured: { atp: sum('atp', per), slam: sum('slam', per), challenger: sum('challenger', per) },
      measured_untruncated: { atp: sum('atp', clean), slam: sum('slam', clean), challenger: sum('challenger', clean) },
      per_day: per,
    };
    const m = out.years[year].measured;
    log(`${year}: days=${per.length} (untruncated ${clean.length}) atp=${m.atp} slam=${m.slam} chal=${m.challenger} [req ${reqCount}]`);
    save('census.json', out);
  }
  out.requests_used = reqCount;
  out.note = 'measured counts only; any per-year projection must be computed from days_sampled vs days_in_scope and labelled a projection';
  save('census.json', out);
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

/* ------------------------------------------------------------------ markets */

// Phase 2 found ZERO games-handicap and ZERO total-games rows on /v2/event/odds
// across 539 ended matches. That kills the historical line-coverage design, but
// it leaves a materially different question open: do those markets exist on
// BetsAPI AT ALL for tennis, going forward?
//
// The pricing page claims the per-bookmaker APIs carry "all odds markets" while
// the Events API has "limited odds markets". That is a vendor claim about a
// product we would be paying for, so it gets measured rather than quoted:
//   - /v4/bet365/prematch on UPCOMING tennis, enumerating every market name
//   - /v2/event/odds/summary on ENDED tennis, enumerating every bookmaker and
//     every market key each one reports
// The distinction matters: "no history, collectable from today" and "not
// available at all" lead to completely different decisions.
async function cmdMarkets() {
  const out = { ran_at: new Date().toISOString(), prematch: null, summary: null, requests_used: 0 };
  const WANT = /(handicap|spread|line|total|over|under|set betting|games|asian)/i;

  // ---- 1. bet365 prematch on upcoming tennis
  const up = await api('/v1/bet365/upcoming', { sport_id: TENNIS });
  const rows = up.body?.results || [];
  log(`bet365/upcoming: success=${up.body?.success} total=${up.body?.pager?.total ?? '—'} page=${rows.length}`);
  const picks = [];
  for (const e of rows) {
    const lvl = classify(e.league?.name);
    if (!lvl) continue;
    picks.push({ id: e.id, level: lvl, league: e.league?.name, home: e.home?.name, away: e.away?.name, time: e.time });
    if (picks.length >= 12) break;
  }
  log(`  classified upcoming picks: ${picks.length} (of ${rows.length} on page 1)`);

  const pre = { n: 0, ok: 0, events: [], market_names: {}, matching: {}, errors: {} };
  for (const ev of picks) {
    let r; try { r = await api('/v4/bet365/prematch', { FI: ev.id }); }
    catch (e) { if (e instanceof BudgetExhausted) break; throw e; }
    pre.n++;
    if (!r.ok) { const k = `${r.status}:${r.body?.error || 'empty'}`; pre.errors[k] = (pre.errors[k] || 0) + 1; continue; }
    pre.ok++;
    // The payload nests market groups under arbitrary keys; walk it and collect
    // every object carrying a name, rather than assuming a shape.
    const names = new Set();
    const walk = (node) => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!node || typeof node !== 'object') return;
      const nm = node.NA ?? node.name;
      if (typeof nm === 'string' && nm.trim()) names.add(nm.trim());
      for (const v of Object.values(node)) walk(v);
    };
    walk(r.body.results);
    for (const n of names) {
      pre.market_names[n] = (pre.market_names[n] || 0) + 1;
      if (WANT.test(n)) pre.matching[n] = (pre.matching[n] || 0) + 1;
    }
    pre.events.push({ id: ev.id, level: ev.level, league: ev.league, distinct_names: names.size });
    log(`  FI=${ev.id} ${ev.level} "${ev.league}" -> ${names.size} distinct names`);
  }
  out.prematch = pre;
  const hits = Object.entries(pre.matching).sort((a, b) => b[1] - a[1]);
  log(`bet365 prematch: ${pre.ok}/${pre.n} ok; ${hits.length} market names matching handicap/total/set:`);
  for (const [n, c] of hits.slice(0, 40)) log(`    ${String(c).padStart(3)}x  ${n}`);

  // ---- 2. odds summary on ended tennis — which books, which market keys
  const endedDay = '20250909';
  const ended = await api('/v3/events/ended', { sport_id: TENNIS, day: endedDay });
  const evs = (ended.body?.results || []).filter((e) => classify(e.league?.name)).slice(0, 8);
  const summ = { n: 0, ok: 0, day: endedDay, books: {}, book_markets: {} };
  for (const e of evs) {
    let r; try { r = await api('/v2/event/odds/summary', { event_id: e.id }); }
    catch (err) { if (err instanceof BudgetExhausted) break; throw err; }
    summ.n++;
    if (!r.ok) continue;
    summ.ok++;
    for (const [book, payload] of Object.entries(r.body?.results || {})) {
      summ.books[book] = (summ.books[book] || 0) + 1;
      const keys = new Set();
      for (const side of ['start', 'end']) for (const k of Object.keys(payload?.odds?.[side] || {})) keys.add(k);
      summ.book_markets[book] ||= {};
      for (const k of keys) summ.book_markets[book][k] = (summ.book_markets[book][k] || 0) + 1;
    }
  }
  out.summary = summ;
  log(`odds/summary on ${summ.ok}/${summ.n} ended tennis matches (${endedDay}):`);
  for (const [b, n] of Object.entries(summ.books).sort((a, c) => c[1] - a[1])) {
    log(`    ${b.padEnd(16)} seen on ${n} matches, market keys: ${JSON.stringify(summ.book_markets[b])}`);
  }

  out.requests_used = reqCount;
  out.rate_limit_headers = rateLimitHeaders;
  save('markets.json', out);
}

/* --------------------------------------------------------------------- main */

const cmd = process.argv[2] || 'status';
log(`BetsAPI probe — cmd=${cmd} budget=${MAX_REQ} pace=${RATE_PER_HOUR}/h (${MIN_GAP_MS}ms gap)`);
try {
  if (cmd === 'diag') await cmdDiag();
  else if (cmd === 'dryrun') await cmdDryrun();
  else if (cmd === 'status') await cmdStatus();
  else if (cmd === 'discover') await cmdDiscover();
  else if (cmd === 'suffix') await cmdSuffix();
  else if (cmd === 'census') await cmdCensus();
  else if (cmd === 'probe') await cmdProbe();
  else if (cmd === 'markets') await cmdMarkets();
  else if (cmd === 'books') await cmdBooks();
  else if (cmd === 'shape') await cmdShape();
  else if (cmd === 'fonbet') await cmdFonbet();
  else { console.error('unknown command'); process.exit(2); }
} catch (err) {
  if (err instanceof BudgetExhausted) log(`STOPPED: ${err.message} after ${reqCount} requests`);
  else { console.error(redact(err.stack || err.message)); process.exit(1); }
}
log(`done — ${reqCount} requests used`);
