#!/usr/bin/env node
/**
 * TEN-227 — match-winner HISTORY download (board ruling 4, 2026-09-17T10:23Z).
 *
 * WHAT THE BOARD ASKED FOR
 *   4. "Match-winner history download: still wanted. Use the remaining trial
 *      window after the upcoming campaign's needs, 2026 first then backwards to
 *      2020. Store the full match-winner series per match (not only summary),
 *      so Close can be rebuilt as in ruling 1. Report bytes per match before
 *      loading and projected total; stop if it passes 25% of the database."
 *
 *   1. "Close = the latest row in /v2/event/odds where ss is null or all-zero,
 *      no in-play time_str, and add_time <= actual start (trueStartTime or live
 *      flip; scheduled start only as an upper bound if neither exists, and then
 *      flag it). Use summary kickoff only as a cross-check: report % agreement
 *      and deltas between series-close and kickoff, n."
 *
 * HOW THAT SHAPES THIS TOOL
 *   * The download stores the series VERBATIM and nothing else is thrown away.
 *     Close is DERIVED, never downloaded — `deriveClose()` is a pure function
 *     with unit tests, so when a better start time arrives (an Oddspapi
 *     trueStartTime, a TEN-225 live flip) Close is recomputed from stored rows
 *     instead of re-spending a trial that will not exist any more.
 *   * Every stored Close carries `start_source` and `start_flagged`. For
 *     2020-2025 neither a trueStartTime nor a live flip exists in anything we
 *     hold, so those rows are scheduled-start-bounded and FLAGGED — that is
 *     ruling 1's own fallback, made visible in the data rather than in a
 *     footnote.
 *   * `kickoff` is a CROSS-CHECK column, never the price. Ruling 1 demoted it
 *     after the last probe measured it already in-play on 2 of 39 matches.
 *
 * DO NOT TOUCH (issue brief): model, pipeline, matches.json, live site, the
 * existing Supabase tables, the TEN-216 collector, the TEN-225 work. This tool
 * writes ONLY to tables prefixed `betsapi_raw_`, behind a DDL allowlist that is
 * unit-tested before the job may reach the database.
 *
 * BUDGET: BetsAPI trial is 1,800 req/h and the brief's ceiling is 1,600. The
 * TEN-227 upcoming campaign is already spending 400/h, so this tool defaults to
 * 1,000/h and reports its own meter. 400 + 1,000 = 1,400 < 1,600.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const TOKEN = (process.env.BETSAPI_TOKEN || '').trim();
const SB_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const SB_KEY = (process.env.SUPABASE_SECRET_KEY || '').trim();
const SB_MGMT = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();

const CMD = process.argv[2] || 'size';
const OUT = 'betsapi-out';

const TENNIS = 13;
const MARKET_MW = '13_1';                 // match winner; the only market with history
const RATE_PER_HOUR = Number(process.env.BETSAPI_RATE_PER_HOUR || 1000);
const MIN_GAP_MS = Math.ceil(3600_000 / RATE_PER_HOUR);
const MAX_REQ = Number(process.env.BETSAPI_MAX_REQ || 100_000);

// Newest first, exactly as ruling 4 ordered it.
const YEARS = (process.env.HISTORY_YEARS || '2026,2025,2024,2023,2022,2021,2020')
  .split(',').map((s) => Number(s.trim())).filter(Boolean);
const LEVELS = new Set((process.env.HISTORY_LEVELS || 'atp,slam,challenger').split(',').map((s) => s.trim()));

// Ruling 4's stop condition, as a constant rather than a comment.
const DB_FRACTION_CEILING = 0.25;

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const redact = (s) => {
  let t = String(s ?? '');
  for (const secret of [TOKEN, SB_KEY, SB_MGMT]) if (secret && secret.length > 6) t = t.split(secret).join('«redacted»');
  return t;
};
const log = (...a) => console.log(redact(a.join(' ')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const save = (name, obj) => writeFileSync(`${OUT}/${name}`, JSON.stringify(obj, null, 1));
const nowIso = () => new Date().toISOString();
const REF = SB_URL ? new URL(SB_URL).hostname.split('.')[0] : null;

/* -------------------------------------------------------------- betsapi http */

let betsapiReq = 0;
let betsapiLast = 0;

async function betsapi(path, params = {}, { retries = 2 } = {}) {
  if (betsapiReq >= MAX_REQ) throw new Error(`betsapi request ceiling ${MAX_REQ} reached`);
  const u = new URL('https://api.b365api.com' + path);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
  u.searchParams.set('token', TOKEN);

  const gap = Date.now() - betsapiLast;
  if (gap < MIN_GAP_MS) await sleep(MIN_GAP_MS - gap);

  for (let attempt = 0; ; attempt++) {
    betsapiLast = Date.now();
    betsapiReq++;
    let res, text;
    try {
      res = await fetch(u, { headers: { 'User-Agent': 'stennisfy-ten227-history' } });
      text = await res.text();
    } catch (err) {
      if (attempt < retries) { await sleep(3000 * (attempt + 1)); continue; }
      return { ok: false, status: 0, transport: redact(err.message), body: null };
    }
    let body = null;
    try { body = JSON.parse(text); } catch { body = { __unparsed: text.slice(0, 300) }; }
    if ((res.status === 429 || body?.error === 'TOO_MANY_REQUESTS') && attempt < retries) {
      await sleep(65_000);
      continue;
    }
    return { ok: res.ok && body?.success === 1, status: res.status, body };
  }
}

/* ----------------------------------------------------------- supabase ddl/io */

const DDL_OK = /^\s*(create table if not exists|create index if not exists|alter table|comment on)\b/i;
const DDL_FORBIDDEN = /\b(drop|truncate|delete|grant|revoke|create policy|cron\.)\b/i;

/**
 * Every DDL statement this tool can send must name an object whose name starts
 * with `betsapi_raw_`. Exported so the guard is TESTED against statements we
 * must never send — including a forbidden verb chained behind a legal
 * `create table`, because the Management API runs multi-statement SQL in one
 * call, and including a legal-looking name that merely CONTAINS the prefix.
 */
export function assertDdlAllowed(sql) {
  const name = sql.match(/\b(?:table|index)\s+(?:if not exists\s+)?(?:public\.)?([a-z0-9_]+)/i)?.[1] || '';
  if (!DDL_OK.test(sql)) throw new Error(`refusing DDL outside the allowlist: ${sql.slice(0, 80)}`);
  if (DDL_FORBIDDEN.test(sql)) throw new Error(`refusing DDL containing a forbidden verb: ${sql.slice(0, 80)}`);
  if (/^\s*alter table/i.test(sql) && !/enable row level security/i.test(sql)) {
    throw new Error(`ALTER is only allowed to enable RLS: ${sql.slice(0, 80)}`);
  }
  if (!/^betsapi_raw_/.test(name)) {
    throw new Error(`refusing DDL on a non-betsapi_raw_ object: "${name}"`);
  }
  return name;
}

async function mgmtQuery(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SB_MGMT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL HTTP ${res.status}: ${redact(text).slice(0, 300)}`);
  return JSON.parse(text || 'null');
}

async function ddl(sql) { assertDdlAllowed(sql); return mgmtQuery(sql); }

async function sbSelect(sql) {
  if (!/^\s*select\b/i.test(sql)) throw new Error('refusing a non-SELECT statement');
  return mgmtQuery(sql);
}

async function upsert(table, rows, onConflict) {
  if (!rows.length) return 0;
  if (!/^betsapi_raw_/.test(table)) throw new Error(`refusing to write outside betsapi_raw_: ${table}`);
  const CHUNK = 100;
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const res = await fetch(`${SB_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(slice),
    });
    if (!res.ok) throw new Error(`upsert ${table} HTTP ${res.status}: ${redact(await res.text()).slice(0, 400)}`);
    done += slice.length;
  }
  return done;
}

/* ------------------------------------------------------- level classification */

// Same conservative classifier as the Phase 2 probe and the upcoming campaign:
// anything not clearly one of the target levels is DROPPED rather than guessed.
// ` MD` / ` WD` are DOUBLES containers, not "main draw".
const DROP_RE = {
  doubles: /(\bMD\b|\bWD\b|doubles)\s*$/i,
  qualifying: /\bqual(ifying|ifier)?\b\s*$/i,
  women: /\bwta\b|\bwomen\b|\bgirls\b|\bladies\b|\bw\d{2,3}\b/i,
};
export function classify(name) {
  if (!name) return null;
  for (const re of Object.values(DROP_RE)) if (re.test(name)) return null;
  const n = String(name).trim().toLowerCase();
  if (/^(australian open|roland garros|french open|wimbledon|us open)$/.test(n)) return 'slam';
  if (/^challenger\b/.test(n)) return 'challenger';
  if (/^atp\b/.test(n)) return 'atp';
  if (/\bitf\b|\bm\d{2,3}\b/.test(n)) return 'itf';
  return null;
}

/** Team fixtures (Davis Cup / United Cup rubbers) are not singles matches. */
export const isTeamFixture = (a, b) => {
  const re = /\bteam\b|\/|\band\b/i;
  const countries = /^(russia|serbia|spain|france|italy|usa|germany|croatia|australia|canada|greece|poland|argentina|czechia|great britain|netherlands|belgium|chile|norway|denmark|switzerland)$/i;
  return [a, b].some((n) => re.test(String(n)) || countries.test(String(n || '').trim()));
};

/** One event is downloadable iff it ended normally, is singles, and is in scope. */
export function eligible(ev, levels = LEVELS) {
  const level = classify(ev?.league?.name);
  if (!level || !levels.has(level)) return null;
  if (String(ev.time_status) !== '3') return null;         // 3 = ended normally
  if (isTeamFixture(ev?.home?.name, ev?.away?.name)) return null;
  return level;
}

/* ------------------------------------------------------ ruling 1: Close logic */

// "ss is null or all-zero": BetsAPI writes an unstarted match as null, '', or a
// comma list of 0-0 set scores. A single `0` is NOT accepted — it is not a set
// score, and treating an unparseable value as pre-match is exactly the direction
// that lets an in-play row become a closing price.
export const ZERO_SS = /^\s*0\s*-\s*0(\s*,\s*0\s*-\s*0)*\s*$/;

export function isPreStartRow(r) {
  if (!r) return false;
  if (r.time_str != null && String(r.time_str).trim() !== '') return false;  // any in-play clock disqualifies
  const ss = r.ss;
  if (ss == null || String(ss).trim() === '') return true;
  return ZERO_SS.test(String(ss));
}

/** BetsAPI quotes decimals ("1.83") but fractional ("5/6") appears on some books. */
export function parseOdds(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '' || s === '-') return null;
  const frac = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(s);
  if (frac) {
    const d = Number(frac[2]);
    return d > 0 ? 1 + Number(frac[1]) / d : null;
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const hasPrice = (r) => parseOdds(r?.home_od) != null && parseOdds(r?.away_od) != null;

/**
 * Ruling 1's start-time ladder, in its stated order of trust.
 *   trueStartTime -> live flip -> scheduled start (UPPER BOUND ONLY, flagged)
 * All inputs are unix seconds. Returns null when nothing at all is known, which
 * is a refusal to derive a Close rather than a silent fallback to "now".
 */
export function pickStart({ trueStart, liveFlip, schedStart } = {}) {
  const ok = (v) => Number.isFinite(Number(v)) && Number(v) > 0;
  if (ok(trueStart)) return { ts: Number(trueStart), source: 'true_start', flagged: false };
  if (ok(liveFlip)) return { ts: Number(liveFlip), source: 'live_flip', flagged: false };
  if (ok(schedStart)) return { ts: Number(schedStart), source: 'scheduled', flagged: true };
  return null;
}

/**
 * Close, exactly as ruling 1 defines it: the LATEST row that is (a) pre-start by
 * score, (b) carries no in-play clock, and (c) is stamped at or before the
 * actual start. A row with no usable price cannot be a closing price, so it is
 * excluded and counted separately.
 *
 * BetsAPI returns these series NEWEST FIRST, which is the ordering trap the
 * board acknowledged. Nothing here depends on the order: rows are ranked by
 * add_time, and ties break toward the earlier array index (the newer row under
 * the vendor's own ordering) so the result is deterministic either way.
 */
export function deriveClose(rows, start) {
  const all = Array.isArray(rows) ? rows : [];
  const out = {
    n_rows: all.length,
    n_excluded_inplay: 0,
    n_excluded_after_start: 0,
    n_excluded_no_price: 0,
    n_eligible: 0,
    start_ts: start?.ts ?? null,
    start_source: start?.source ?? null,
    start_flagged: start?.flagged ?? null,
    close: null,
    lead_seconds: null,
  };
  if (!start) return out;

  const eligibleRows = [];
  all.forEach((r, i) => {
    if (!isPreStartRow(r)) { out.n_excluded_inplay++; return; }
    const t = Number(r?.add_time);
    if (!Number.isFinite(t)) { out.n_excluded_inplay++; return; }
    if (t > start.ts) { out.n_excluded_after_start++; return; }
    if (!hasPrice(r)) { out.n_excluded_no_price++; return; }
    eligibleRows.push({ r, i, t });
  });
  out.n_eligible = eligibleRows.length;
  if (!eligibleRows.length) return out;

  eligibleRows.sort((a, b) => (b.t - a.t) || (a.i - b.i));
  const best = eligibleRows[0];
  out.close = {
    add_time: best.t,
    home_od: best.r.home_od,
    away_od: best.r.away_od,
    home_dec: parseOdds(best.r.home_od),
    away_dec: parseOdds(best.r.away_od),
    odds_id: best.r.id ?? null,
  };
  out.lead_seconds = start.ts - best.t;
  return out;
}

/**
 * Ruling 1's cross-check. `kickoff` is the summary endpoint's own last-pre-match
 * quote; we never price from it, we only measure how far it sits from the Close
 * this tool derives. Returns null when either side is missing, so "no data"
 * never masquerades as "agrees".
 */
export function compareCloseKickoff(close, kickoffRow) {
  if (!close || !kickoffRow) return null;
  const kh = parseOdds(kickoffRow.home_od);
  const ka = parseOdds(kickoffRow.away_od);
  if (kh == null || ka == null || close.home_dec == null || close.away_dec == null) return null;
  const dh = close.home_dec - kh;
  const da = close.away_dec - ka;
  return {
    agree: Math.abs(dh) < 1e-9 && Math.abs(da) < 1e-9,
    d_home: dh,
    d_away: da,
    kickoff_home: kh,
    kickoff_away: ka,
    kickoff_add_time: Number(kickoffRow.add_time) || null,
    kickoff_inplay: !isPreStartRow(kickoffRow),
  };
}

/* ----------------------------------------------------------------- the tables */

export const TABLES = [
  // One row per downloaded match. `series` holds the match-winner rows VERBATIM
  // (ruling 4: "the full match-winner series per match, not only summary"), so
  // Close can be rebuilt from storage when a better start time exists. Storing
  // the series as one jsonb array rather than one row per quote is deliberate:
  // at ~30-60 quotes a match, per-row Postgres overhead would have dominated the
  // payload, and the 25% ceiling is measured in bytes.
  `create table if not exists betsapi_raw_mw_matches (
     betsapi_event_id  text primary key,
     level             text not null,
     year              integer not null,
     day               text not null,
     league_name       text,
     home_name         text,
     away_name         text,
     sched_start       bigint not null,
     final_ss          text,
     series            jsonb not null,
     n_series_rows     integer not null,
     close_add_time    bigint,
     close_home_od     text,
     close_away_od     text,
     close_home_dec    numeric,
     close_away_dec    numeric,
     close_lead_sec    bigint,
     start_source      text,
     start_flagged     boolean,
     n_excluded_inplay integer,
     n_excluded_after  integer,
     kickoff_home_dec  numeric,
     kickoff_away_dec  numeric,
     kickoff_agree     boolean,
     kickoff_inplay    boolean,
     downloaded_at     timestamptz not null default now()
   )`,
  `create index if not exists betsapi_raw_mw_matches_year_level_idx
     on betsapi_raw_mw_matches (year, level)`,

  // The resume checkpoint. A day is only marked done once every eligible event
  // on it has been attempted, so an interrupted run re-does one day, never the
  // year — and a re-dispatch after the trial dies costs nothing.
  `create table if not exists betsapi_raw_mw_days (
     day            text primary key,
     year           integer not null,
     listed_events  integer,
     eligible       integer,
     fetched        integer,
     failed         integer,
     done           boolean not null default false,
     finished_at    timestamptz
   )`,

  // Run ledger — the TEN-221 circuit breaker reads this, so "three consecutive
  // failures" is a fact in the database rather than a hope about GitHub's UI.
  `create table if not exists betsapi_raw_mw_runs (
     run_id      text primary key,
     started_at  timestamptz not null default now(),
     ended_at    timestamptz,
     status      text,
     matches     integer,
     requests    integer,
     note        text
   )`,

  `alter table betsapi_raw_mw_matches enable row level security`,
  `alter table betsapi_raw_mw_days enable row level security`,
  `alter table betsapi_raw_mw_runs enable row level security`,
];

async function cmdSetup() {
  for (const sql of TABLES) {
    const name = assertDdlAllowed(sql);
    await ddl(sql);
    log(`  ok  ${sql.slice(0, 46).replace(/\s+/g, ' ')}… (${name})`);
  }
  // Prove the RLS claim rather than asserting it: RLS on + zero policies is
  // unreadable with the publishable key, and that is the whole guarantee.
  const rows = await sbSelect(`select c.relname, c.relrowsecurity,
      (select count(*) from pg_policies p where p.tablename = c.relname) as policies
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'betsapi_raw_%'
    order by c.relname`);
  log('\n  table                                 rls   policies');
  for (const r of rows || []) log(`  ${String(r.relname).padEnd(36)} ${String(r.relrowsecurity).padEnd(5)} ${r.policies}`);
}

/* ------------------------------------------------------------------- listing */

const dayStr = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

/** Every day of `year`, newest first, never past today. */
export function daysOfYear(year, today = new Date()) {
  const out = [];
  const end = new Date(Date.UTC(year, 11, 31));
  const last = end.getTime() > today.getTime() ? today : end;
  for (let t = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate()); ; t -= 86400_000) {
    const d = new Date(t);
    if (d.getUTCFullYear() !== year) break;
    out.push(dayStr(d));
  }
  return out;
}

/** Page 1 only: the pager carries the day's TOTAL without paging through it. */
async function dayTotal(day) {
  const r = await betsapi('/v3/events/ended', { sport_id: TENNIS, day });
  return {
    ok: r.ok,
    total: r.body?.pager?.total ?? null,
    perPage: r.body?.pager?.per_page ?? 50,
    rows: r.body?.results || [],
  };
}

/** Every ended tennis event on `day`, paged out. */
async function listDay(day, maxPages = 40) {
  const out = [];
  let total = null;
  for (let page = 1; page <= maxPages; page++) {
    const r = await betsapi('/v3/events/ended', { sport_id: TENNIS, day, page });
    if (!r.ok) return { ok: false, events: out, total, pages: page };
    const rows = r.body?.results || [];
    out.push(...rows);
    total = r.body?.pager?.total ?? total;
    const perPage = r.body?.pager?.per_page ?? 50;
    if (!rows.length || page * perPage >= (total ?? 0)) return { ok: true, events: out, total, pages: page };
  }
  return { ok: true, events: out, total, pages: maxPages, truncated: true };
}

/* ---------------------------------------------------------------- the fetch */

/** One match: its series, its derived Close, and (optionally) the cross-check. */
async function fetchMatch(ev, level, { withSummary = false } = {}) {
  const r = await betsapi('/v2/event/odds', { event_id: ev.id });
  if (!r.ok) return { ok: false, status: r.status, error: r.body?.error ?? null };
  const series = r.body?.results?.odds?.[MARKET_MW] || [];
  const start = pickStart({ schedStart: Number(ev.time) });   // 2020-2025: nothing better exists
  const close = deriveClose(series, start);

  let cross = null;
  if (withSummary) {
    const s = await betsapi('/v2/event/odds/summary', { event_id: ev.id });
    const book = s.body?.results || {};
    const bookName = Object.keys(book)[0] || null;
    const kickoff = bookName ? book[bookName]?.odds?.kickoff?.[MARKET_MW] : null;
    cross = { book: bookName, ...(compareCloseKickoff(close.close, kickoff) || { agree: null, unusable: true }) };
  }

  return {
    ok: true,
    row: {
      betsapi_event_id: String(ev.id),
      level,
      year: new Date(Number(ev.time) * 1000).getUTCFullYear(),
      day: dayStr(new Date(Number(ev.time) * 1000)),
      league_name: ev.league?.name ?? null,
      home_name: ev.home?.name ?? null,
      away_name: ev.away?.name ?? null,
      sched_start: Number(ev.time),
      final_ss: ev.ss ?? null,
      series,
      n_series_rows: series.length,
      close_add_time: close.close?.add_time ?? null,
      close_home_od: close.close?.home_od ?? null,
      close_away_od: close.close?.away_od ?? null,
      close_home_dec: close.close?.home_dec ?? null,
      close_away_dec: close.close?.away_dec ?? null,
      close_lead_sec: close.lead_seconds,
      start_source: close.start_source,
      start_flagged: close.start_flagged,
      n_excluded_inplay: close.n_excluded_inplay,
      n_excluded_after: close.n_excluded_after_start,
      kickoff_home_dec: cross?.kickoff_home ?? null,
      kickoff_away_dec: cross?.kickoff_away ?? null,
      kickoff_agree: cross?.agree ?? null,
      kickoff_inplay: cross?.kickoff_inplay ?? null,
    },
    close,
    cross,
  };
}

/* --------------------------------------------------------------------- size */

/**
 * Ruling 4: "Report bytes per match before loading and projected total; stop if
 * it passes 25% of the database."
 *
 * Two numbers are reported, because they are not the same number and only one
 * of them is the one the ceiling is about:
 *   * WIRE bytes  — the JSON we would store, measured exactly, no modelling.
 *   * ON-DISK bytes — measured by loading a pilot batch into the real table and
 *     reading pg_total_relation_size. TOAST compresses jsonb, so guessing this
 *     from the wire size would have been a fabricated number.
 * The match census is a PROJECTION from sampled days and is labelled as one,
 * with the sampled n printed next to it.
 */
async function cmdSize() {
  const perYear = Number(process.env.SIZE_DAYS_PER_YEAR || 6);
  const sampleMatches = Number(process.env.SIZE_MATCHES || 40);
  const summaryEvery = Number(process.env.SIZE_SUMMARY_EVERY || 2);
  const pilotLoad = process.env.SIZE_PILOT_LOAD !== 'no';

  const out = {
    ran_at: nowIso(), commit: process.env.GITHUB_SHA || null,
    years: YEARS, levels: [...LEVELS],
    census: {}, wire: {}, disk: {}, projection: {}, cross_check: {}, requests_used: 0,
  };

  // ---- 1. census: how many ended tennis events exist per day, per year.
  log('== census: ended tennis events per sampled day ==');
  const eligibleSamples = [];
  for (const year of YEARS) {
    const all = daysOfYear(year);
    if (!all.length) { out.census[year] = { sampled_days: 0, note: 'no elapsed days' }; continue; }
    const stride = all.length / perYear;
    const picked = Array.from({ length: Math.min(perYear, all.length) }, (_, i) => all[Math.floor(i * stride)]);
    const totals = [];
    for (const day of picked) {
      const t = await dayTotal(day);
      if (!t.ok) { log(`  ${day}: LISTING FAILED`); continue; }
      totals.push({ day, total: t.total });
      // Eligible fraction is measured on the FIRST page of each sampled day —
      // the same 50 events the total is drawn from, so the ratio is honest even
      // though the day is not fully paged.
      const elig = t.rows.filter((e) => eligible(e)).length;
      eligibleSamples.push({ year, day, page_rows: t.rows.length, eligible: elig });
    }
    const days = totals.filter((x) => Number.isFinite(x.total));
    const mean = days.length ? days.reduce((a, b) => a + b.total, 0) / days.length : null;
    out.census[year] = {
      sampled_days: days.length,
      elapsed_days: all.length,
      mean_tennis_events_per_day: mean,
      per_day: totals,
    };
    log(`  ${year}: n=${days.length} sampled days, mean ${mean == null ? '—' : mean.toFixed(1)} tennis events/day (of ${all.length} elapsed days)`);
  }
  const fracRows = eligibleSamples.reduce((a, b) => a + b.page_rows, 0);
  const fracElig = eligibleSamples.reduce((a, b) => a + b.eligible, 0);
  const eligFrac = fracRows ? fracElig / fracRows : null;
  out.census.eligible_fraction = { n_events_classified: fracRows, n_eligible: fracElig, fraction: eligFrac, by_day: eligibleSamples };
  log(`  eligible fraction (${[...LEVELS].join('+')} singles, ended): ${fracElig}/${fracRows} = ${eligFrac == null ? '—' : (eligFrac * 100).toFixed(1) + '%'}`);

  // ---- 2. wire bytes: a real sample of matches, spread across the years.
  log('\n== wire bytes per match ==');
  const perYearMatches = Math.max(1, Math.floor(sampleMatches / YEARS.length));
  const rows = [];
  const crossRows = [];
  for (const year of YEARS) {
    const days = daysOfYear(year);
    if (!days.length) continue;
    let got = 0;
    for (let i = 0; i < days.length && got < perYearMatches; i += Math.max(1, Math.floor(days.length / 12))) {
      const listed = await listDay(days[i], 4);
      const cands = listed.events.map((e) => ({ e, lvl: eligible(e) })).filter((x) => x.lvl);
      for (const { e, lvl } of cands) {
        if (got >= perYearMatches) break;
        const m = await fetchMatch(e, lvl, { withSummary: got % summaryEvery === 0 });
        if (!m.ok) continue;
        rows.push(m.row);
        if (m.cross) crossRows.push({ year, ...m.cross });
        got++;
      }
    }
    const mine = rows.filter((r) => r.year === year);
    const bytes = mine.map((r) => Buffer.byteLength(JSON.stringify(r), 'utf8'));
    const withSeries = mine.filter((r) => r.n_series_rows > 0).length;
    out.wire[year] = {
      n_matches: mine.length,
      n_with_series_rows: withSeries,
      mean_series_rows: mine.length ? mine.reduce((a, b) => a + b.n_series_rows, 0) / mine.length : null,
      mean_bytes: bytes.length ? bytes.reduce((a, b) => a + b, 0) / bytes.length : null,
      max_bytes: bytes.length ? Math.max(...bytes) : null,
    };
    const w = out.wire[year];
    log(`  ${year}: n=${w.n_matches}, series present on ${withSeries}, mean ${w.mean_series_rows == null ? '—' : w.mean_series_rows.toFixed(1)} rows, mean ${w.mean_bytes == null ? '—' : Math.round(w.mean_bytes)} B/match`);
  }

  // ---- 3. cross-check (ruling 1): series-close vs summary kickoff.
  const usable = crossRows.filter((c) => c.agree != null);
  out.cross_check = {
    n: usable.length,
    n_attempted: crossRows.length,
    pct_agree: usable.length ? (usable.filter((c) => c.agree).length / usable.length) * 100 : null,
    n_kickoff_inplay: crossRows.filter((c) => c.kickoff_inplay).length,
    mean_abs_delta_home: usable.length ? usable.reduce((a, b) => a + Math.abs(b.d_home), 0) / usable.length : null,
    rows: crossRows,
  };
  log(`\n== close vs kickoff cross-check ==`);
  log(`  n=${out.cross_check.n} usable of ${out.cross_check.n_attempted} attempted; ` +
      `agree ${out.cross_check.pct_agree == null ? '—' : out.cross_check.pct_agree.toFixed(1) + '%'}; ` +
      `kickoff already in-play on ${out.cross_check.n_kickoff_inplay}`);
  if (out.cross_check.n < 30) log(`  ::warning::cross-check n=${out.cross_check.n} < 30`);

  // ---- 4. on-disk bytes: load the pilot into the real table and MEASURE it.
  if (pilotLoad && rows.length && SB_URL && SB_KEY && SB_MGMT) {
    const before = await tableBytes();
    const n = await upsert('betsapi_raw_mw_matches', rows, 'betsapi_event_id');
    const after = await tableBytes();
    const stored = await sbSelect(`select count(*)::int as n from betsapi_raw_mw_matches`);
    const nStored = stored?.[0]?.n ?? null;
    out.disk = {
      pilot_matches_upserted: n,
      matches_in_table: nStored,
      table_bytes_before: before.total,
      table_bytes_after: after.total,
      bytes_per_match_on_disk: nStored ? after.total / nStored : null,
      database_bytes: after.database,
    };
    log(`\n== on-disk ==`);
    log(`  pilot ${n} matches upserted; table ${after.total} B over ${nStored} rows = ` +
        `${out.disk.bytes_per_match_on_disk == null ? '—' : Math.round(out.disk.bytes_per_match_on_disk)} B/match`);
    log(`  database size ${(after.database / 1e9).toFixed(3)} GB; 25% ceiling ${(after.database * DB_FRACTION_CEILING / 1e9).toFixed(3)} GB`);
  } else {
    out.disk = { measured: false, note: 'pilot load skipped' };
  }

  // ---- 5. the projection and the ruling-4 gate.
  const bpm = out.disk.bytes_per_match_on_disk ?? null;
  let totalMatches = 0;
  const perYearProj = {};
  for (const year of YEARS) {
    const c = out.census[year];
    if (!c || !Number.isFinite(c.mean_tennis_events_per_day) || eligFrac == null) { perYearProj[year] = null; continue; }
    const m = c.mean_tennis_events_per_day * eligFrac * c.elapsed_days;
    perYearProj[year] = Math.round(m);
    totalMatches += m;
  }
  out.projection = {
    basis: `mean tennis events/day x eligible fraction ${eligFrac == null ? '—' : (eligFrac * 100).toFixed(1) + '%'} x elapsed days`,
    matches_per_year: perYearProj,
    total_matches: Math.round(totalMatches),
    bytes_per_match_on_disk: bpm,
    projected_bytes: bpm == null ? null : Math.round(totalMatches * bpm),
    database_bytes: out.disk.database_bytes ?? null,
    ceiling_fraction: DB_FRACTION_CEILING,
    passes_ceiling: (bpm != null && out.disk.database_bytes)
      ? (totalMatches * bpm) > (out.disk.database_bytes * DB_FRACTION_CEILING)
      : null,
    requests_per_match: 1,
    requests_total: Math.round(totalMatches) + YEARS.reduce((a, y) => a + (out.census[y]?.elapsed_days || 0) * 2, 0),
  };
  log('\n== projection ==');
  for (const y of YEARS) log(`  ${y}: ${perYearProj[y] == null ? '—' : perYearProj[y].toLocaleString()} matches (projected)`);
  log(`  total ${out.projection.total_matches.toLocaleString()} matches` +
      (bpm == null ? '' : `, ${(out.projection.projected_bytes / 1e9).toFixed(3)} GB on disk`));
  log(`  request budget: ~${out.projection.requests_total.toLocaleString()} calls ` +
      `= ${(out.projection.requests_total / RATE_PER_HOUR).toFixed(1)} h at ${RATE_PER_HOUR}/h`);
  if (out.projection.passes_ceiling === true) {
    log(`::error::PROJECTION PASSES THE 25% CEILING — ruling 4 says stop. Not loading.`);
  } else if (out.projection.passes_ceiling === false) {
    log(`  under the 25% ceiling — the download may proceed.`);
  } else {
    log(`  ceiling test: UNKNOWN (missing on-disk or database size)`);
  }

  out.requests_used = betsapiReq;
  save('history-size.json', out);
  log(`\nbetsapi requests used: ${betsapiReq}`);
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT,
      `passes_ceiling=${out.projection.passes_ceiling}\nprojected_gb=${bpm == null ? '' : (out.projection.projected_bytes / 1e9).toFixed(3)}\n`,
      { flag: 'a' });
  }
}

async function tableBytes() {
  const r = await sbSelect(`select
      coalesce(pg_total_relation_size('public.betsapi_raw_mw_matches'), 0)::bigint as total,
      pg_database_size(current_database())::bigint as database`);
  return { total: Number(r?.[0]?.total || 0), database: Number(r?.[0]?.database || 0) };
}

/* ----------------------------------------------------------------- download */

/**
 * Resumable and idempotent, in both directions:
 *   * a day already marked done in betsapi_raw_mw_days is skipped outright;
 *   * inside a day, matches already stored are skipped, so a run killed halfway
 *     through a day re-spends only that day's remainder;
 *   * the write is an upsert on the event id, so a re-run overwrites rather than
 *     duplicating.
 */
async function cmdDownload() {
  const runId = process.env.GITHUB_RUN_ID || `local-${Date.now()}`;
  const budgetReq = Number(process.env.DOWNLOAD_MAX_REQ || 3000);
  const deadline = Date.now() + Number(process.env.DOWNLOAD_MINUTES || 300) * 60_000;
  const summaryEvery = Number(process.env.DOWNLOAD_SUMMARY_EVERY || 25);
  // A board-set cap on total matches in the table, for the case where the full
  // corpus does not fit under the ceiling and only the newest N are wanted.
  const maxMatches = Number(process.env.DOWNLOAD_MAX_MATCHES || 0);
  // The between-runs ceiling check cannot stop a 300-minute run that crosses it
  // in minute 40, so the same test runs every RECHECK_EVERY matches as well.
  const RECHECK_EVERY = 500;

  await upsert('betsapi_raw_mw_runs', [{ run_id: runId, started_at: nowIso(), status: 'running' }], 'run_id');

  // Ruling 4's gate is enforced here too, not only in `size`: a projection made
  // an hour ago is not a licence to keep writing after the table has grown.
  const guard = await tableBytes();
  if (guard.database && guard.total > guard.database * DB_FRACTION_CEILING) {
    log(`::error::betsapi_raw_mw_matches is ${(guard.total / 1e9).toFixed(3)} GB = ` +
        `over ${DB_FRACTION_CEILING * 100}% of the ${(guard.database / 1e9).toFixed(3)} GB database. STOPPING per ruling 4.`);
    await upsert('betsapi_raw_mw_runs', [{ run_id: runId, ended_at: nowIso(), status: 'ceiling', requests: betsapiReq }], 'run_id');
    return { stopped: 'ceiling' };
  }

  const doneDays = new Set((await sbSelect(
    `select day from betsapi_raw_mw_days where done = true`) || []).map((r) => r.day));
  const already = (await sbSelect(`select count(*)::int as n from betsapi_raw_mw_matches`))?.[0]?.n ?? 0;
  log(`resume: ${doneDays.size} days already complete, ${already} matches stored` +
      (maxMatches ? `, cap ${maxMatches}` : ''));
  if (maxMatches && already >= maxMatches) {
    log(`already at the ${maxMatches}-match cap — standing down`);
    await upsert('betsapi_raw_mw_runs', [{ run_id: runId, ended_at: nowIso(), status: 'cap', matches: 0, requests: betsapiReq }], 'run_id');
    if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `more_work=0\nmatches=0\n`, { flag: 'a' });
    return { stopped: 'cap' };
  }

  let matches = 0, failures = 0, moreWork = true, stopped = null;
  outer:
  for (const year of YEARS) {
    for (const day of daysOfYear(year)) {
      if (doneDays.has(day)) continue;
      if (Date.now() > deadline || betsapiReq >= budgetReq) { log(`budget/time reached inside ${day}`); break outer; }

      const listed = await listDay(day);
      if (!listed.ok) { log(`::warning::listing failed for ${day}`); failures++; continue; }
      const cands = listed.events.map((e) => ({ e, lvl: eligible(e) })).filter((x) => x.lvl);
      if (!cands.length) {
        await upsert('betsapi_raw_mw_days', [{ day, year, listed_events: listed.events.length, eligible: 0, fetched: 0, failed: 0, done: true, finished_at: nowIso() }], 'day');
        continue;
      }

      const have = new Set((await sbSelect(
        `select betsapi_event_id from betsapi_raw_mw_matches where day = '${day.replace(/[^0-9]/g, '')}'`) || [])
        .map((r) => r.betsapi_event_id));

      const batch = [];
      let fetched = 0, failed = 0, interrupted = false;
      for (const { e, lvl } of cands) {
        if (have.has(String(e.id))) { fetched++; continue; }
        if (Date.now() > deadline || betsapiReq >= budgetReq) { interrupted = true; break; }
        const m = await fetchMatch(e, lvl, { withSummary: matches % summaryEvery === 0 });
        if (!m.ok) { failed++; continue; }
        batch.push(m.row);
        fetched++; matches++;
        if (batch.length >= 100) { await upsert('betsapi_raw_mw_matches', batch.splice(0), 'betsapi_event_id'); }
        if (maxMatches && already + matches >= maxMatches) { stopped = 'cap'; interrupted = true; break; }
        if (matches % RECHECK_EVERY === 0) {
          const g = await tableBytes();
          if (g.database && g.total > g.database * DB_FRACTION_CEILING) {
            log(`::error::crossed ${DB_FRACTION_CEILING * 100}% of the database mid-run ` +
                `(${(g.total / 1e6).toFixed(1)} MB of ${(g.database / 1e6).toFixed(1)} MB) — STOPPING per ruling 4`);
            stopped = 'ceiling'; interrupted = true; break;
          }
        }
      }
      if (batch.length) await upsert('betsapi_raw_mw_matches', batch, 'betsapi_event_id');
      await upsert('betsapi_raw_mw_days', [{
        day, year,
        listed_events: listed.events.length, eligible: cands.length,
        fetched, failed, done: !interrupted, finished_at: interrupted ? null : nowIso(),
      }], 'day');
      log(`  ${day} ${listed.events.length} listed / ${cands.length} eligible / ${fetched} stored / ${failed} failed [req ${betsapiReq}]`);
      failures += failed;
      if (interrupted) break outer;
    }
  }

  // "More work" is a question about the calendar, not about this run: if every
  // day of every in-scope year is marked done, the chain has finished and must
  // stop dispatching successors.
  const remaining = await sbSelect(`select count(*)::int as n from betsapi_raw_mw_days where done = true`);
  const totalDays = YEARS.reduce((a, y) => a + daysOfYear(y).length, 0);
  // A cap or a ceiling stop ENDS the chain: re-dispatching into a wall we just
  // hit is exactly the loop the TEN-221 rulings exist to prevent.
  moreWork = !stopped && (remaining?.[0]?.n ?? 0) < totalDays;

  await upsert('betsapi_raw_mw_runs', [{
    run_id: runId, ended_at: nowIso(), status: stopped || 'ok', matches, requests: betsapiReq,
    note: `${remaining?.[0]?.n ?? 0}/${totalDays} days done`,
  }], 'run_id');

  log(`\ndownloaded ${matches} matches this run, ${failures} failures, ${betsapiReq} requests`);
  log(`days done ${remaining?.[0]?.n ?? 0}/${totalDays}. MORE_WORK=${moreWork ? 1 : 0}`);
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `more_work=${moreWork ? 1 : 0}\nmatches=${matches}\n`, { flag: 'a' });
  }
  return { matches, moreWork };
}

/* ------------------------------------------------------------------- report */

const fmt = (x, d = 1) => (x == null || !Number.isFinite(Number(x)) ? '—' : Number(x).toFixed(d));

async function cmdReport() {
  const out = { ran_at: nowIso(), commit: process.env.GITHUB_SHA || null };

  const byYear = await sbSelect(`select year, level, count(*)::int as matches,
      sum(case when n_series_rows > 0 then 1 else 0 end)::int as with_series,
      avg(n_series_rows)::numeric(10,2) as mean_rows,
      sum(case when close_home_dec is not null then 1 else 0 end)::int as with_close,
      sum(case when start_flagged then 1 else 0 end)::int as start_flagged
    from betsapi_raw_mw_matches group by year, level order by year desc, level`);
  out.by_year_level = byYear;
  log('\n  year  level        matches  with series  mean rows  with Close  scheduled-start flagged');
  for (const r of byYear || []) {
    log(`  ${r.year}  ${String(r.level).padEnd(11)} ${String(r.matches).padStart(7)} ` +
        `${String(r.with_series).padStart(12)} ${fmt(r.mean_rows).padStart(10)} ` +
        `${String(r.with_close).padStart(11)} ${String(r.start_flagged).padStart(23)}`);
  }

  // Ruling 1's cross-check, recomputed over everything stored so far.
  const x = await sbSelect(`select count(*)::int as n,
      sum(case when kickoff_agree then 1 else 0 end)::int as agree,
      sum(case when kickoff_inplay then 1 else 0 end)::int as kickoff_inplay,
      avg(abs(close_home_dec - kickoff_home_dec))::numeric(10,4) as mean_abs_d_home,
      max(abs(close_home_dec - kickoff_home_dec))::numeric(10,4) as max_abs_d_home
    from betsapi_raw_mw_matches
    where kickoff_home_dec is not null and close_home_dec is not null`);
  out.cross_check = x?.[0] ?? null;
  const c = out.cross_check;
  log('\n== series-Close vs summary kickoff (ruling 1 cross-check) ==');
  if (!c || !c.n) log('  n=0 — no match carries both a derived Close and a kickoff quote yet');
  else {
    log(`  n=${c.n}; agree ${fmt((c.agree / c.n) * 100)}%; kickoff already in-play on ${c.kickoff_inplay} ` +
        `(${fmt((c.kickoff_inplay / c.n) * 100)}%)`);
    log(`  |delta| home: mean ${fmt(c.mean_abs_d_home, 4)}, max ${fmt(c.max_abs_d_home, 4)}`);
    if (c.n < 30) log(`  ::warning::cross-check n=${c.n} < 30`);
  }

  const sz = await tableBytes();
  out.size = { table_bytes: sz.total, database_bytes: sz.database, fraction: sz.database ? sz.total / sz.database : null };
  log(`\n  table ${(sz.total / 1e6).toFixed(1)} MB of a ${(sz.database / 1e9).toFixed(3)} GB database = ` +
      `${fmt(out.size.fraction * 100, 2)}% (ceiling ${DB_FRACTION_CEILING * 100}%)`);

  // pg_total_relation_size rounds to 8 KB pages, so on a small pilot it reports
  // page granularity rather than payload — 35 rows came back as exactly 35
  // pages. pg_column_size reads the COMPRESSED stored width of each row, which
  // is the number the 25% ceiling should actually be projected from.
  const cols = await sbSelect(`select count(*)::int as n,
      avg(pg_column_size(t.*))::numeric(12,1) as mean_row_bytes,
      max(pg_column_size(t.*))::bigint as max_row_bytes,
      avg(pg_column_size(series))::numeric(12,1) as mean_series_bytes,
      avg(n_series_rows)::numeric(10,1) as mean_series_rows
    from betsapi_raw_mw_matches t`);
  out.stored_bytes = cols?.[0] ?? null;
  const s = out.stored_bytes;
  if (s?.n) {
    log(`  stored width (pg_column_size, n=${s.n}): mean ${s.mean_row_bytes} B/match ` +
        `(series alone ${s.mean_series_bytes} B over ${s.mean_series_rows} quotes), max ${s.max_row_bytes} B`);
    if (sz.database) {
      const ceilingMatches = Math.floor((sz.database * DB_FRACTION_CEILING) / Number(s.mean_row_bytes));
      log(`  the ${DB_FRACTION_CEILING * 100}% ceiling holds ~${ceilingMatches.toLocaleString()} matches at that width`);
      out.stored_bytes.ceiling_matches = ceilingMatches;
    }
  }

  const days = await sbSelect(`select year, count(*)::int as days_done, sum(eligible)::int as eligible, sum(fetched)::int as fetched
    from betsapi_raw_mw_days where done = true group by year order by year desc`);
  out.days = days;
  log('\n  year  days done  eligible  fetched');
  for (const r of days || []) log(`  ${r.year}  ${String(r.days_done).padStart(9)} ${String(r.eligible).padStart(9)} ${String(r.fetched).padStart(8)}`);

  save('history-report.json', out);
}

/* --------------------------------------------------------------------- main */

async function main() {
  log(`TEN-227 history — cmd=${CMD} at ${nowIso()} (commit ${process.env.GITHUB_SHA || 'local'})`);
  if (!TOKEN && ['size', 'download'].includes(CMD)) throw new Error('BETSAPI_TOKEN is empty');
  switch (CMD) {
    case 'setup': return cmdSetup();
    case 'size': return cmdSize();
    case 'download': return cmdDownload();
    case 'report': return cmdReport();
    default: throw new Error(`unknown command "${CMD}" (setup | size | download | report)`);
  }
}

// Importing for the guard test must not fire a run.
if (process.argv[1] && /ten227-history\.mjs$/.test(process.argv[1])) {
  main().catch((err) => { console.error('FATAL:', redact(err.stack || err.message)); process.exit(1); });
}
