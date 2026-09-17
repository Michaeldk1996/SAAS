#!/usr/bin/env node
/**
 * TEN-227 — BetsAPI UPCOMING odds reliability check (REPORT ONLY).
 *
 * Phase 2 measured finished matches. This measures the other half: does BetsAPI
 * give a trustworthy Open / Now / Close for matches that have not started yet,
 * and how does it sit next to Oddspapi bet365 (TEN-225) and api-tennis (TEN-216)
 * on the SAME match at the SAME moment.
 *
 * Nothing here is a product surface. It writes only to Supabase tables named
 * `betsapi_upcoming_test_*` (RLS on, zero policies) and to ./betsapi-out/.
 * It does not touch matches.json, the pipeline, the live site, the TEN-216
 * collector's tables, or the TEN-225 archive's bucket.
 *
 * Subcommands
 *   setup    create the three tables (idempotent)
 *   select   choose the sample and write it to betsapi_upcoming_test_selection
 *   poll     one poll cycle over the selection (BetsAPI + Oddspapi)
 *   loop     poll every INTERVAL_MIN until LOOP_MINUTES is up, then hand off
 *   report   analyse whatever has been collected (answers Q1-Q7)
 *
 * ── Two measured facts that shape the design ────────────────────────────────
 *
 * 1. `/v2/event/odds` returns rows NEWEST-FIRST. Measured on 431 of 431 series
 *    in the Phase 2 artifact, strictly descending by add_time, zero exceptions.
 *    "Open = first row" is inverted. Everything here reads open = MIN(add_time)
 *    and close = the latest PRE-START add_time.
 *
 * 2. The brief asks for `/v4/odds` once per poll per fixture on the Oddspapi
 *    side. That endpoint is not what this account has: the entitled pre-match
 *    call is `/v4/odds-by-tournaments`, HARD-CAPPED AT 5 tournamentIds per call
 *    (measured 2026-09-10 in refresh-odds.py: 6 ids -> HTTP 400, and the 400
 *    still bills). Per-fixture polling would cost
 *        40 fixtures x 4 polls/h x 36 h  = 5,760 units
 *    against a 5,000-unit MONTHLY quota with 493 already spent — i.e. it cannot
 *    be run at all, let alone under the 80% ceiling. Chunked by tournament it is
 *        ceil(T/5) calls x 4 polls/h x 36 h  ≈ 430 units at T≈15,
 *    the same prices at ~7% of the cost. That substitution is reported, not
 *    hidden, and ODDSPAPI_CEILING_FRAC enforces the 80% rule regardless.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';

/* ------------------------------------------------------------------ config */

const TOKEN = (process.env.BETSAPI_TOKEN || '').trim();
const ODDSPAPI_KEY = (process.env.ODDSPAPI_KEY || '').trim();
const API_TENNIS_KEY = (process.env.API_TENNIS_KEY || '').trim();
const SB_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const SB_KEY = (process.env.SUPABASE_SECRET_KEY || '').trim();
const SB_MGMT = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();

const CMD = process.argv[2] || 'report';
const OUT = 'betsapi-out';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// BetsAPI budget. The brief caps this check at 400 req/hour so the rest of the
// 1,600/h ceiling stays available to anything else running on the trial.
const BETSAPI_RATE_PER_HOUR = Number(process.env.BETSAPI_RATE_PER_HOUR || 400);
const BETSAPI_MIN_GAP_MS = Math.ceil(3600_000 / BETSAPI_RATE_PER_HOUR);
const BETSAPI_MAX_REQ = Number(process.env.BETSAPI_MAX_REQ || 100_000);

// Oddspapi budget. Standing rule: never spend past 80% of request_limit.
const ODDSPAPI_CEILING_FRAC = 0.80;
const ODDSPAPI_SLEEP_MS = 1800;   // ~1.6s minimum between calls, measured
const CHUNK_TIDS = 5;             // HARD API LIMIT — a 6th id is a billable 400

const TENNIS_BETSAPI = 13;
const TENNIS_ODDSPAPI = 12;
const MARKET_WINNER = '121';      // oddspapi match-winner market id
const OUTCOME_P1 = '121', OUTCOME_P2 = '122';   // fixture participant1 / participant2
const BOOK = 'bet365';

/**
 * One leg of the oddspapi match-winner line, as
 * bookmakerOdds[book].markets['121'].outcomes[oc].players['0'].
 * `changedAt` is when BET365 last moved that price, not when we fetched it.
 */
export function oddspapiLeg(bookmakerBlock, outcome) {
  const mkt = (bookmakerBlock?.markets || {})[MARKET_WINNER];
  const v = ((mkt?.outcomes || {})[outcome]?.players || {})['0'] || {};
  const pr = Number(v.price);
  return { price: Number.isFinite(pr) && pr > 1 ? pr : null, changedAt: v.changedAt || null };
}

const SELECT_MIN_H = Number(process.env.SELECT_MIN_H || 12);
const SELECT_MAX_H = Number(process.env.SELECT_MAX_H || 36);
const TARGET_PER_LEVEL = Number(process.env.TARGET_PER_LEVEL || 20);

const redact = (s) => {
  let out = String(s);
  for (const secret of [TOKEN, ODDSPAPI_KEY, API_TENNIS_KEY, SB_KEY, SB_MGMT]) {
    if (secret) out = out.split(secret).join('«SECRET»');
  }
  return out;
};
const log = (...a) => console.log(redact(a.join(' ')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const save = (name, obj) => writeFileSync(`${OUT}/${name}`, JSON.stringify(obj, null, 1));
const REF = SB_URL ? new URL(SB_URL).hostname.split('.')[0] : null;
const nowIso = () => new Date().toISOString();

/* -------------------------------------------------------------- betsapi http */

let betsapiReq = 0;
let betsapiLast = 0;

async function betsapi(path, params = {}, { retries = 2 } = {}) {
  if (betsapiReq >= BETSAPI_MAX_REQ) throw new Error(`betsapi request ceiling ${BETSAPI_MAX_REQ} reached`);
  const u = new URL('https://api.b365api.com' + path);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
  u.searchParams.set('token', TOKEN);

  const gap = Date.now() - betsapiLast;
  if (gap < BETSAPI_MIN_GAP_MS) await sleep(BETSAPI_MIN_GAP_MS - gap);

  for (let attempt = 0; ; attempt++) {
    betsapiLast = Date.now();
    betsapiReq++;
    let res, text;
    try {
      res = await fetch(u, { headers: { 'User-Agent': 'stennisfy-ten227-upcoming' } });
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

/* ------------------------------------------------------------ oddspapi http */

let oddspapiUnits = 0;
let oddspapiLast = 0;
let oddspapiMeter = null;   // { used, limit } as of the last /v4/account read

async function oddspapi(path, params = {}, { metered = true } = {}) {
  const u = new URL('https://api.oddspapi.io' + path);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
  u.searchParams.set('apiKey', ODDSPAPI_KEY);
  const gap = Date.now() - oddspapiLast;
  if (gap < ODDSPAPI_SLEEP_MS) await sleep(ODDSPAPI_SLEEP_MS - gap);
  oddspapiLast = Date.now();
  if (metered) oddspapiUnits++;
  // NO blind retries: on this vendor a 429 and a 400 both bill, so a retry loop
  // is a way to burn the monthly quota faster while fixing nothing.
  try {
    const res = await fetch(u, { headers: { 'User-Agent': 'BSP-Consult-Dashboard/1.0' } });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, body: null };
    return { ok: true, status: res.status, body: JSON.parse(text) };
  } catch (err) {
    return { ok: false, status: 0, transport: redact(err.message), body: null };
  }
}

async function readMeter(when) {
  const r = await oddspapi('/v4/account', {}, { metered: false });
  const subs = (r.body?.subscriptions || []).filter((s) => s.is_active);
  if (!subs.length) { log(`  oddspapi meter ${when}: UNREADABLE`); return null; }
  const s = subs[0];
  oddspapiMeter = { used: s.request_count, limit: s.request_limit };
  log(`  oddspapi meter ${when}: ${s.request_count}/${s.request_limit} ` +
      `(80% ceiling ${Math.floor(s.request_limit * ODDSPAPI_CEILING_FRAC)})`);
  return oddspapiMeter;
}

/** True when spending `need` more units would cross 80% of the monthly limit. */
function oddspapiWouldBreachCeiling(need) {
  if (!oddspapiMeter) return true;   // no meter read = do not spend (standing rule)
  const ceiling = Math.floor(oddspapiMeter.limit * ODDSPAPI_CEILING_FRAC);
  return oddspapiMeter.used + oddspapiUnits + need > ceiling;
}

/* ----------------------------------------------------------- supabase ddl/io */

const DDL_OK = /^\s*(create table if not exists|create index if not exists|alter table|comment on)\b/i;
const DDL_FORBIDDEN = /\b(drop|truncate|delete|grant|revoke|create policy|cron\.)\b/i;

/**
 * Every DDL statement this tool can send must name an object whose name starts
 * with `betsapi_upcoming_test_`. Exported so the guard is TESTED against
 * statements we must never send, rather than eyeballed — including a forbidden
 * verb chained behind a legal `create table`, because the Management API runs
 * multi-statement SQL in one call.
 */
export function assertDdlAllowed(sql) {
  const name = sql.match(/\b(?:table|index)\s+(?:if not exists\s+)?(?:public\.)?([a-z0-9_]+)/i)?.[1] || '';
  if (!DDL_OK.test(sql)) throw new Error(`refusing DDL outside the allowlist: ${sql.slice(0, 80)}`);
  if (DDL_FORBIDDEN.test(sql)) throw new Error(`refusing DDL containing a forbidden verb: ${sql.slice(0, 80)}`);
  if (/^\s*alter table/i.test(sql) && !/enable row level security/i.test(sql)) {
    throw new Error(`ALTER is only allowed to enable RLS: ${sql.slice(0, 80)}`);
  }
  if (!/^betsapi_upcoming_test_/.test(name)) {
    throw new Error(`refusing DDL on a non-betsapi_upcoming_test_ object: "${name}"`);
  }
  return name;
}

async function ddl(sql) {
  assertDdlAllowed(sql);
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SB_MGMT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`DDL HTTP ${res.status}: ${redact(text).slice(0, 300)}`);
  return JSON.parse(text || 'null');
}

async function sbSelect(sql) {
  if (!/^\s*select\b/i.test(sql)) throw new Error('refusing a non-SELECT statement');
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SB_MGMT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SELECT HTTP ${res.status}: ${redact(text).slice(0, 300)}`);
  return JSON.parse(text || 'null');
}

async function upsert(table, rows, onConflict) {
  if (!rows.length) return 0;
  const CHUNK = 200;
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

export const TABLES = [
  // The sample, frozen at selection time so a later poll cannot quietly change
  // what is being measured.
  `create table if not exists betsapi_upcoming_test_selection (
     betsapi_event_id   text primary key,
     level              text not null,
     league_name        text,
     home_name          text,
     away_name          text,
     sched_start        bigint not null,
     oddspapi_fixture   text,
     oddspapi_tournament text,
     oddspapi_start     timestamptz,
     apitennis_key      text,
     selected_at        timestamptz not null default now(),
     poll_until         bigint not null
   )`,
  `create index if not exists betsapi_upcoming_test_selection_start_idx
     on betsapi_upcoming_test_selection (sched_start)`,

  // Every raw BetsAPI response, stamped with OUR observed_at. Raw bytes, because
  // the whole question is what their fields mean and a reduction would pre-judge it.
  `create table if not exists betsapi_upcoming_test_polls (
     betsapi_event_id  text not null,
     endpoint          text not null,
     observed_at       timestamptz not null,
     poll_no           integer not null,
     http_status       integer,
     payload           jsonb,
     primary key (betsapi_event_id, endpoint, observed_at)
   )`,
  `create index if not exists betsapi_upcoming_test_polls_event_idx
     on betsapi_upcoming_test_polls (betsapi_event_id, observed_at)`,

  // The Oddspapi leg at the SAME poll, so "who moved first" is answerable.
  `create table if not exists betsapi_upcoming_test_oddspapi (
     oddspapi_fixture  text not null,
     observed_at       timestamptz not null,
     poll_no           integer not null,
     bookmaker         text not null,
     payload           jsonb,
     primary key (oddspapi_fixture, bookmaker, observed_at)
   )`,
  `create index if not exists betsapi_upcoming_test_oddspapi_fixture_idx
     on betsapi_upcoming_test_oddspapi (oddspapi_fixture, observed_at)`,

  `alter table betsapi_upcoming_test_selection enable row level security`,
  `alter table betsapi_upcoming_test_polls enable row level security`,
  `alter table betsapi_upcoming_test_oddspapi enable row level security`,
];

async function cmdSetup() {
  for (const sql of TABLES) {
    const name = assertDdlAllowed(sql);
    await ddl(sql);
    log(`  ok  ${sql.slice(0, 46).replace(/\s+/g, ' ')}… (${name})`);
  }
  // Prove the RLS claim rather than asserting it: a table with RLS on and zero
  // policies is unreadable with the publishable key, and that is the guarantee.
  const rows = await sbSelect(`select c.relname, c.relrowsecurity,
      (select count(*) from pg_policies p where p.tablename = c.relname) as policies
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'betsapi_upcoming_test_%'
    order by c.relname`);
  log('\n  table                                 rls   policies');
  for (const r of rows || []) log(`  ${String(r.relname).padEnd(36)} ${String(r.relrowsecurity).padEnd(5)} ${r.policies}`);
}

/* ------------------------------------------------------------- name matching */

/** NFD accent strip + case fold + punctuation squash. */
export const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Team fixtures are not singles matches and must never enter the sample. */
export const isTeamFixture = (a, b) => {
  const re = /\bteam\b|\/|\band\b/i;
  const countries = /^(russia|serbia|spain|france|italy|usa|germany|croatia|australia|canada|greece|poland|argentina|czechia|great britain|netherlands|belgium|chile|norway|denmark|switzerland)$/i;
  return [a, b].some((n) => re.test(String(n)) || countries.test(String(n || '').trim()));
};

/** Surname key: last token of the normalised name. Alcaraz Garfia -> garfia is
 *  wrong, so we key on the SET of tokens and require a non-empty overlap plus a
 *  first-initial agreement. Ambiguity (more than one candidate) is a DROP. */
export function nameKey(s) {
  const t = norm(s).split(' ').filter(Boolean);
  return t.length ? t[t.length - 1] : '';
}

export function pairScore(betsapiName, oddspapiName) {
  const a = norm(betsapiName).split(' ').filter(Boolean);
  const b = norm(oddspapiName).split(' ').filter(Boolean);
  if (!a.length || !b.length) return 0;
  const overlap = a.filter((t) => b.includes(t) && t.length > 2);
  if (!overlap.length) return 0;
  // A shared surname alone is not enough (Zverev x2, Alcaraz x1). Require the
  // first initial to agree too when both sides carry a given name.
  const ai = a[0][0], bi = b[0][0];
  const initialOk = a.length === 1 || b.length === 1 || ai === bi ||
                    a.includes(b[0]) || b.includes(a[0]);
  return initialOk ? overlap.length : 0;
}

/* --------------------------------------------------------- level classifier */

// Same conservative classifier as the Phase 2 probe: anything not clearly one of
// the target levels is DROPPED rather than guessed, and every drop is counted.
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

/* ---------------------------------------------------------------------- diag */

/**
 * What is actually on the board, and what does the TEN-216 table look like.
 * Exists because the first `select` returned 14 Challengers and zero ATP, and
 * "the classifier is wrong" and "there is no ATP tennis tomorrow" are the same
 * log line until you print the league names.
 */
async function cmdDiag() {
  const now = Date.now();
  const days = new Set();
  for (let t = now; t <= now + 3 * 86400_000; t += 86400_000) {
    days.add(new Date(t).toISOString().slice(0, 10).replace(/-/g, ''));
  }
  const leagues = new Map();   // name -> { n, classified, firstStart, lastStart }
  let total = 0, pagesRead = 0;
  for (const day of [...days].sort()) {
    for (let page = 1; page <= 30; page++) {
      const r = await betsapi('/v3/events/upcoming', { sport_id: TENNIS_BETSAPI, day, page });
      pagesRead++;
      const rows = r.body?.results || [];
      const pager = r.body?.pager;
      if (page === 1) log(`  day ${day}: pager ${JSON.stringify(pager)}`);
      if (!rows.length) break;
      total += rows.length;
      for (const e of rows) {
        const name = e.league?.name || '(none)';
        if (!leagues.has(name)) leagues.set(name, { n: 0, level: classify(name), first: Infinity, last: -Infinity });
        const L = leagues.get(name);
        L.n++;
        L.first = Math.min(L.first, Number(e.time));
        L.last = Math.max(L.last, Number(e.time));
      }
      if (!pager || pager.page * pager.per_page >= pager.total) break;
    }
  }
  const sorted = [...leagues.entries()].sort((a, b) => b[1].n - a[1].n);
  log(`\n${total} upcoming tennis events over ${days.size} days, ${pagesRead} pages, ${leagues.size} distinct leagues`);
  log('\n  n     level        first start (UTC)     league');
  for (const [name, L] of sorted.slice(0, 60)) {
    log(`  ${String(L.n).padStart(4)}  ${String(L.level ?? 'DROP').padEnd(11)} ` +
        `${new Date(L.first * 1000).toISOString().slice(0, 16)}  ${name}`);
  }
  const hrs = (h) => now + h * 3600_000;
  for (const [lo, hi] of [[12, 36], [6, 48], [2, 72]]) {
    const n = sorted.reduce((acc, [, L]) => acc + (L.first * 1000 <= hrs(hi) && L.last * 1000 >= hrs(lo) ? L.n : 0), 0);
    log(`  window ${lo}-${hi}h: <= ${n} events in leagues overlapping it`);
  }

  // TEN-216's real column names, so the api-tennis overlap read stops guessing.
  try {
    const cols = await sbSelect(`select table_name, column_name, data_type
      from information_schema.columns
      where table_schema='public' and table_name like 'ten216%'
      order by table_name, ordinal_position`);
    log('\nTEN-216 columns:');
    for (const c of cols || []) log(`  ${c.table_name}.${c.column_name} ${c.data_type}`);
  } catch (err) { log(`::warning::ten216 schema unreadable: ${redact(err.message).slice(0, 160)}`); }

  save('upcoming-diag.json', { ran_at: nowIso(), total, leagues: sorted.map(([k, v]) => ({ league: k, ...v })) });
  log(`\nbetsapi requests: ${betsapiReq}`);
}

/* -------------------------------------------------------------------- select */

async function cmdSelect() {
  const now = Date.now();
  const winStart = now + SELECT_MIN_H * 3600_000;
  const winEnd = now + SELECT_MAX_H * 3600_000;
  log(`selection window ${new Date(winStart).toISOString()} .. ${new Date(winEnd).toISOString()}`);

  // ---- 1. BetsAPI upcoming tennis, paged, across the days the window spans.
  const days = new Set();
  for (let t = winStart; t <= winEnd + 86400_000; t += 86400_000) {
    days.add(new Date(t).toISOString().slice(0, 10).replace(/-/g, ''));
  }
  const events = [];
  const drops = { level: 0, team: 0, window: 0, doubles_name: 0 };
  for (const day of [...days].sort()) {
    for (let page = 1; page <= 30; page++) {
      const r = await betsapi('/v3/events/upcoming', { sport_id: TENNIS_BETSAPI, day, page });
      const rows = r.body?.results || [];
      if (!rows.length) break;
      for (const e of rows) {
        const start = Number(e.time) * 1000;
        if (!(start >= winStart && start <= winEnd)) { drops.window++; continue; }
        const level = classify(e.league?.name);
        if (!level) { drops.level++; continue; }
        const home = e.home?.name, away = e.away?.name;
        if (isTeamFixture(home, away)) { drops.team++; continue; }
        if (/\//.test(String(home)) || /\//.test(String(away))) { drops.doubles_name++; continue; }
        events.push({ id: String(e.id), level, league: e.league?.name, home, away, start: Number(e.time) });
      }
      const pager = r.body?.pager;
      if (!pager || pager.page * pager.per_page >= pager.total) break;
    }
  }
  log(`BetsAPI upcoming singles in window: ${events.length} ` +
      `(dropped: ${drops.window} outside window, ${drops.level} level, ${drops.team} team, ${drops.doubles_name} doubles-name) ` +
      `[${betsapiReq} req]`);

  // ---- 2. Oddspapi fixtures over the same window. 1-2 metered units.
  await readMeter('before selection');
  if (oddspapiWouldBreachCeiling(2)) throw new Error('oddspapi 80% ceiling would be breached by selection');
  const fx = await oddspapi('/v4/fixtures', {
    sportId: TENNIS_ODDSPAPI,
    from: new Date(winStart - 3600_000).toISOString().replace(/\.\d+Z$/, 'Z'),
    to: new Date(winEnd + 3600_000).toISOString().replace(/\.\d+Z$/, 'Z'),
  });
  const fixtures = (Array.isArray(fx.body) ? fx.body : fx.body?.data || [])
    .filter((f) => f.fixtureId && !/Simulated|Srl/.test(f.categoryName || ''));
  log(`Oddspapi fixtures in window: ${fixtures.length} [${oddspapiUnits} metered units]`);

  // ---- 3. Pair BetsAPI -> Oddspapi. Drop on ambiguity, count every drop.
  const paired = [];
  let ambiguous = 0, unmatched = 0;
  for (const e of events) {
    const cands = fixtures.filter((f) => {
      const s1 = pairScore(e.home, f.participant1Name) && pairScore(e.away, f.participant2Name);
      const s2 = pairScore(e.home, f.participant2Name) && pairScore(e.away, f.participant1Name);
      if (!s1 && !s2) return false;
      const fs = Date.parse(f.startTime || '');
      return Number.isFinite(fs) && Math.abs(fs - e.start * 1000) < 6 * 3600_000;
    });
    if (cands.length > 1) { ambiguous++; continue; }
    if (!cands.length) { unmatched++; continue; }
    const f = cands[0];
    paired.push({ ...e, fixtureId: String(f.fixtureId), tournamentId: f.tournamentId != null ? String(f.tournamentId) : null,
                  oddspapiStart: f.startTime || null, oddspapiCat: f.categoryName || null });
  }
  const rate = events.length ? (100 * paired.length / events.length).toFixed(1) : '—';
  log(`BetsAPI <-> Oddspapi pairing: ${paired.length}/${events.length} matched (${rate}%), ` +
      `${ambiguous} dropped ambiguous, ${unmatched} unmatched`);

  // ---- 4. api-tennis presence, read from the TEN-216 collector's stored data
  //         (read-only; the brief forbids touching that collector).
  let apitennisKeys = new Set();
  try {
    const rows = await sbSelect(`select distinct event_key::text as k, home_name, away_name
      from ten216_test_odds_changes limit 5000`);
    for (const r of rows || []) apitennisKeys.add(`${norm(r.home_name)}|${norm(r.away_name)}`);
    log(`TEN-216 stored api-tennis rows: ${apitennisKeys.size} distinct fixtures available for overlap`);
  } catch (err) {
    log(`::warning::TEN-216 stored data unreadable (${redact(err.message).slice(0, 120)}) — api-tennis overlap will be reported as unknown`);
  }
  for (const p of paired) {
    const k1 = `${norm(p.home)}|${norm(p.away)}`, k2 = `${norm(p.away)}|${norm(p.home)}`;
    p.apitennisKey = apitennisKeys.has(k1) ? k1 : apitennisKeys.has(k2) ? k2 : null;
  }

  // ---- 5. Take the sample. Prefer matches present in all three feeds; fall back
  //         to BetsAPI+Oddspapi and SAY SO rather than quietly shrinking n.
  const pick = (level, n) => {
    const pool = paired.filter((p) => p.level === level).sort((a, b) => a.start - b.start);
    const all3 = pool.filter((p) => p.apitennisKey);
    const rest = pool.filter((p) => !p.apitennisKey);
    return [...all3, ...rest].slice(0, n);
  };
  const sample = [
    ...pick('atp', TARGET_PER_LEVEL), ...pick('slam', 0),
    ...pick('challenger', TARGET_PER_LEVEL),
    ...pick('itf', Number(process.env.TARGET_ITF || 10)),
  ];
  const byLevel = {};
  for (const s of sample) byLevel[s.level] = (byLevel[s.level] || 0) + 1;
  log(`sample: ${sample.length} — ${JSON.stringify(byLevel)} ` +
      `(${sample.filter((s) => s.apitennisKey).length} present in all three feeds)`);

  const rows = sample.map((s) => ({
    betsapi_event_id: s.id,
    level: s.level,
    league_name: s.league,
    home_name: s.home,
    away_name: s.away,
    sched_start: s.start,
    oddspapi_fixture: s.fixtureId,
    oddspapi_tournament: s.tournamentId,
    oddspapi_start: s.oddspapiStart,
    apitennis_key: s.apitennisKey,
    poll_until: s.start + 30 * 60,      // 30 minutes after the scheduled start
  }));
  if (rows.length) await upsert('betsapi_upcoming_test_selection', rows, 'betsapi_event_id');

  const meta = {
    ran_at: nowIso(), window_h: [SELECT_MIN_H, SELECT_MAX_H],
    betsapi_candidates: events.length, betsapi_drops: drops,
    oddspapi_fixtures: fixtures.length,
    pairing: { matched: paired.length, rate_pct: rate, ambiguous, unmatched },
    apitennis_overlap: sample.filter((s) => s.apitennisKey).length,
    sample_size: sample.length, by_level: byLevel,
    betsapi_requests: betsapiReq, oddspapi_units: oddspapiUnits,
  };
  save('upcoming-selection.json', meta);
  log(`\nrequests: BetsAPI ${betsapiReq}, Oddspapi ${oddspapiUnits} metered units`);
  await readMeter('after selection');
}

/* ---------------------------------------------------------------------- poll */

async function loadSelection() {
  const rows = await sbSelect(
    `select * from betsapi_upcoming_test_selection order by sched_start`);
  return rows || [];
}

async function cmdPoll(pollNo = 0) {
  const sel = await loadSelection();
  const now = Math.floor(Date.now() / 1000);
  const live = sel.filter((s) => now <= Number(s.poll_until));
  log(`poll #${pollNo} — ${live.length} of ${sel.length} still inside their window`);
  if (!live.length) return { live: 0, betsapi: 0, oddspapi: 0 };

  const observedAt = nowIso();
  const pollRows = [];

  // --- BetsAPI: summary + the match-winner series, 2 requests per match.
  for (const s of live) {
    for (const [endpoint, params] of [
      ['summary', { event_id: s.betsapi_event_id }],
      ['odds_13_1', { event_id: s.betsapi_event_id, odds_market: '13_1' }],
    ]) {
      const path = endpoint === 'summary' ? '/v2/event/odds/summary' : '/v2/event/odds';
      const r = await betsapi(path, params);
      pollRows.push({
        betsapi_event_id: s.betsapi_event_id,
        endpoint,
        observed_at: observedAt,
        poll_no: pollNo,
        http_status: r.status,
        payload: r.body ?? null,
      });
    }
  }
  if (pollRows.length) await upsert('betsapi_upcoming_test_polls', pollRows, 'betsapi_event_id,endpoint,observed_at');

  // --- Oddspapi: the SAME moment, chunked by tournament (see header note 2).
  let oddsRows = [];
  const tids = [...new Set(live.map((s) => s.oddspapi_tournament).filter(Boolean))];
  const chunks = [];
  for (let i = 0; i < tids.length; i += CHUNK_TIDS) chunks.push(tids.slice(i, i + CHUNK_TIDS));
  if (!oddspapiMeter) await readMeter('poll start');
  if (oddspapiWouldBreachCeiling(chunks.length)) {
    log(`::warning::oddspapi 80% ceiling reached — SKIPPING the oddspapi leg of poll #${pollNo}. ` +
        `This is a gap in the data, not a zero.`);
  } else {
    const byFixture = new Map();
    for (const chunk of chunks) {
      const r = await oddspapi('/v4/odds-by-tournaments', {
        tournamentIds: chunk.join(','), bookmaker: BOOK,
        marketId: MARKET_WINNER, oddsFormat: 'decimal',
      });
      if (!r.ok) { log(`  oddspapi chunk ${chunk.join(',')}: HTTP ${r.status} — not retried (a 400 and a 429 both bill)`); continue; }
      const items = Array.isArray(r.body) ? r.body : r.body?.data || [];
      for (const it of items) if (it.fixtureId) byFixture.set(String(it.fixtureId), it);
    }
    oddsRows = live
      .filter((s) => s.oddspapi_fixture && byFixture.has(String(s.oddspapi_fixture)))
      .map((s) => ({
        oddspapi_fixture: String(s.oddspapi_fixture),
        observed_at: observedAt,
        poll_no: pollNo,
        bookmaker: BOOK,
        payload: byFixture.get(String(s.oddspapi_fixture)),
      }));
    if (oddsRows.length) await upsert('betsapi_upcoming_test_oddspapi', oddsRows, 'oddspapi_fixture,bookmaker,observed_at');
  }

  log(`  stored ${pollRows.length} BetsAPI rows, ${oddsRows.length} Oddspapi rows ` +
      `[betsapi req ${betsapiReq}, oddspapi units ${oddspapiUnits}]`);
  return { live: live.length, betsapi: pollRows.length, oddspapi: oddsRows.length };
}

/* ---------------------------------------------------------------------- loop */

async function cmdLoop() {
  const intervalMin = Number(process.env.INTERVAL_MIN || 15);
  const loopMin = Number(process.env.LOOP_MINUTES || 320);
  const deadline = Date.now() + loopMin * 60_000;
  await readMeter('loop start');
  let pollNo = Number(process.env.START_POLL_NO || 0);
  let anyLive = true;
  while (Date.now() < deadline) {
    const t0 = Date.now();
    try {
      const r = await cmdPoll(pollNo++);
      anyLive = r.live > 0;
    } catch (err) {
      log(`::warning::poll #${pollNo - 1} failed: ${redact(err.message).slice(0, 200)}`);
    }
    if (!anyLive) { log('every selected match is past its poll_until — standing down.'); break; }
    const wait = intervalMin * 60_000 - (Date.now() - t0);
    if (Date.now() + Math.max(wait, 0) >= deadline) break;
    if (wait > 0) await sleep(wait);
  }
  // Tell the workflow whether a successor is needed. The handoff lives in the
  // job, not in GitHub's cron: this repo's scheduler has been throttled before
  // and a sparse sample of the quantity under measurement is worthless.
  const more = anyLive ? '1' : '0';
  log(`loop finished. MORE_WORK=${more} NEXT_POLL_NO=${pollNo}`);
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `more_work=${more}\nnext_poll_no=${pollNo}\n`, { flag: 'a' });
  }
}

/* -------------------------------------------------------------------- report */

const impl = (o) => (Number(o) > 0 ? 100 / Number(o) : null);
const median = (xs) => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const fmt = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));
const ZERO_SS = /^[0\-,\s]*$/;
const isPreStartRow = (r) => !r.time_str && (r.ss == null || ZERO_SS.test(String(r.ss)));

async function cmdReport() {
  const sel = await loadSelection();
  if (!sel.length) { log('no selection stored — run `select` first.'); return; }
  // Pull polls in pages: PostgREST/Management SELECT both cap, so page explicitly
  // rather than trusting a short page to mean "end of data" (a truncated read
  // once fabricated 19,155 rows on this codebase).
  const polls = [];
  for (let off = 0; ; off += 500) {
    const page = await sbSelect(
      `select betsapi_event_id, endpoint, observed_at, poll_no, http_status, payload
       from betsapi_upcoming_test_polls order by observed_at, betsapi_event_id, endpoint
       limit 500 offset ${off}`);
    if (!page || !page.length) break;
    polls.push(...page);
    if (page.length < 500) break;
  }
  const oddsp = [];
  for (let off = 0; ; off += 500) {
    const page = await sbSelect(
      `select oddspapi_fixture, observed_at, poll_no, payload
       from betsapi_upcoming_test_oddspapi order by observed_at limit 500 offset ${off}`);
    if (!page || !page.length) break;
    oddsp.push(...page);
    if (page.length < 500) break;
  }
  log(`selection ${sel.length}, betsapi poll rows ${polls.length}, oddspapi poll rows ${oddsp.length}`);

  const selById = new Map(sel.map((s) => [String(s.betsapi_event_id), s]));
  const out = { ran_at: nowIso(), n_selection: sel.length, n_polls: polls.length, n_oddspapi: oddsp.length };

  /* Q1 — which books appear, and when do they first appear. */
  const bookSeen = new Map();   // book -> { matches:Set, byLevel:{}, firstSeenHrs:[] }
  for (const p of polls.filter((x) => x.endpoint === 'summary')) {
    const s = selById.get(String(p.betsapi_event_id));
    if (!s) continue;
    const books = p.payload?.results || {};
    for (const [book, blk] of Object.entries(books)) {
      const mw = blk?.odds?.['13_1'] || blk?.['13_1'];
      const quoted = mw && (mw.start || mw.kickoff || mw.end);
      if (!quoted) continue;
      if (!bookSeen.has(book)) bookSeen.set(book, { matches: new Set(), byLevel: {}, firstSeen: new Map() });
      const b = bookSeen.get(book);
      b.matches.add(String(p.betsapi_event_id));
      b.byLevel[s.level] = b.byLevel[s.level] || new Set();
      b.byLevel[s.level].add(String(p.betsapi_event_id));
      const obs = Date.parse(p.observed_at) / 1000;
      const prev = b.firstSeen.get(String(p.betsapi_event_id));
      if (prev == null || obs < prev) b.firstSeen.set(String(p.betsapi_event_id), obs);
    }
  }
  const levelTotals = {};
  for (const s of sel) levelTotals[s.level] = (levelTotals[s.level] || 0) + 1;
  out.q1_books = [...bookSeen.entries()].map(([book, b]) => ({
    book,
    matches_quoted: b.matches.size,
    pct_of_sample: sel.length ? (100 * b.matches.size / sel.length) : null,
    by_level: Object.fromEntries(Object.entries(b.byLevel).map(([k, v]) =>
      [k, { n: v.size, pct: levelTotals[k] ? 100 * v.size / levelTotals[k] : null }])),
    first_seen_hours_before_start_median: median([...b.firstSeen.entries()].map(([eid, ts]) => {
      const s = selById.get(eid); return s ? (Number(s.sched_start) - ts) / 3600 : NaN;
    })),
  })).sort((a, b) => b.matches_quoted - a.matches_quoted);

  /* Q2 — what the timestamps mean. The only honest test is: between two of OUR
     polls, did the stamp move while the price did not, and vice versa. */
  const tsEvidence = { moved_ts_same_price: [], moved_price_same_ts: [], both: 0, neither: 0 };
  const byEvent = new Map();
  for (const p of polls.filter((x) => x.endpoint === 'summary')) {
    const k = String(p.betsapi_event_id);
    if (!byEvent.has(k)) byEvent.set(k, []);
    byEvent.get(k).push(p);
  }
  for (const [eid, rows] of byEvent) {
    rows.sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1].payload?.results?.[BOOK], cur = rows[i].payload?.results?.[BOOK];
      const pk = prev?.odds?.['13_1']?.kickoff || prev?.odds?.['13_1']?.start;
      const ck = cur?.odds?.['13_1']?.kickoff || cur?.odds?.['13_1']?.start;
      if (!pk || !ck) continue;
      const tsMoved = String(pk.add_time) !== String(ck.add_time);
      const priceMoved = String(pk.home_od) !== String(ck.home_od) || String(pk.away_od) !== String(ck.away_od);
      if (tsMoved && !priceMoved && tsEvidence.moved_ts_same_price.length < 10) {
        tsEvidence.moved_ts_same_price.push({ event: eid, from: rows[i - 1].observed_at, to: rows[i].observed_at,
          add_time: [pk.add_time, ck.add_time], price: [pk.home_od, pk.away_od] });
      } else if (priceMoved && !tsMoved && tsEvidence.moved_price_same_ts.length < 10) {
        tsEvidence.moved_price_same_ts.push({ event: eid, from: rows[i - 1].observed_at, to: rows[i].observed_at,
          add_time: pk.add_time, price: [[pk.home_od, pk.away_od], [ck.home_od, ck.away_od]] });
      } else if (tsMoved && priceMoved) tsEvidence.both++;
      else tsEvidence.neither++;
    }
  }
  out.q2_timestamps = tsEvidence;

  /* Q3 — is `start` fixed once set? */
  const startStability = [];
  for (const [eid, rows] of byEvent) {
    const stamps = new Set(), prices = new Set();
    for (const r of rows) {
      const st = r.payload?.results?.[BOOK]?.odds?.['13_1']?.start;
      if (st) { stamps.add(String(st.add_time)); prices.add(`${st.home_od}/${st.away_od}`); }
    }
    if (stamps.size) startStability.push({ event: eid, distinct_add_time: stamps.size, distinct_price: prices.size,
      hours_before_start: (Number(selById.get(eid)?.sched_start) - Number([...stamps][0])) / 3600 });
  }
  out.q3_start = {
    n: startStability.length,
    n_with_moving_add_time: startStability.filter((x) => x.distinct_add_time > 1).length,
    n_with_moving_price: startStability.filter((x) => x.distinct_price > 1).length,
    hours_before_start_median: median(startStability.map((x) => x.hours_before_start)),
    examples: startStability.slice(0, 10),
  };

  /* Q4 — "now" freshness vs Oddspapi at the same poll. */
  const oddspByFixturePoll = new Map();
  for (const o of oddsp) oddspByFixturePoll.set(`${o.oddspapi_fixture}|${o.poll_no}`, o);
  const nowCmp = [];
  for (const p of polls.filter((x) => x.endpoint === 'odds_13_1')) {
    const s = selById.get(String(p.betsapi_event_id));
    if (!s?.oddspapi_fixture) continue;
    const rows = p.payload?.results?.odds?.['13_1'] || [];
    const pre = rows.filter(isPreStartRow);
    // Rows come back NEWEST-FIRST (measured, 431/431), so "latest pre-start" is
    // the FIRST pre-start element, not the last.
    const latest = pre[0];
    const o = oddspByFixturePoll.get(`${s.oddspapi_fixture}|${p.poll_no}`);
    const blk = (o?.payload?.bookmakerOdds || {})[BOOK];
    if (!latest || !blk) continue;
    const leg = oddspapiLeg(blk, OUTCOME_P1);
    if (leg.price == null) continue;
    nowCmp.push({
      event: String(p.betsapi_event_id), poll: p.poll_no,
      betsapi_home: Number(latest.home_od), oddspapi_p1: leg.price,
      betsapi_add_time: Number(latest.add_time),
      // changedAt is the instant BET365 last moved that price, not the instant
      // we fetched it — which is what makes "who moved first" answerable.
      oddspapi_changed_at: leg.changedAt,
      same: Math.abs(Number(latest.home_od) - leg.price) < 1e-9,
    });
  }
  out.q4_now = {
    n: nowCmp.length,
    pct_identical: nowCmp.length ? 100 * nowCmp.filter((x) => x.same).length / nowCmp.length : null,
    median_implied_prob_gap_pts: median(nowCmp.map((x) => {
      const a = impl(x.betsapi_home), b = impl(x.oddspapi_p1);
      return a != null && b != null ? Math.abs(a - b) : NaN;
    })),
    samples: nowCmp.slice(0, 15),
  };

  /* Q5 — kickoff: when does it appear, does it move, is ss always 0-0. */
  const kick = [];
  for (const [eid, rows] of byEvent) {
    rows.sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
    const s = selById.get(eid);
    let first = null; const stamps = new Set(); const sss = new Set();
    for (const r of rows) {
      const k = r.payload?.results?.[BOOK]?.odds?.['13_1']?.kickoff;
      if (!k) continue;
      if (!first) first = { observed_at: r.observed_at, add_time: Number(k.add_time), price: [k.home_od, k.away_od] };
      stamps.add(`${k.add_time}|${k.home_od}|${k.away_od}`);
      sss.add(String(k.ss ?? 'null'));
    }
    if (!first) continue;
    kick.push({
      event: eid, level: s?.level,
      first_seen_min_after_sched: (Date.parse(first.observed_at) / 1000 - Number(s?.sched_start)) / 60,
      add_time_min_after_sched: (first.add_time - Number(s?.sched_start)) / 60,
      distinct_versions: stamps.size,
      ss_values: [...sss],
    });
  }
  out.q5_kickoff = {
    n: kick.length,
    first_seen_min_after_sched_median: median(kick.map((x) => x.first_seen_min_after_sched)),
    add_time_min_after_sched_median: median(kick.map((x) => x.add_time_min_after_sched)),
    n_changed_after_first_appearance: kick.filter((x) => x.distinct_versions > 1).length,
    n_ss_not_zero: kick.filter((x) => x.ss_values.some((v) => v !== 'null' && !ZERO_SS.test(v))).length,
    n_add_time_gt_5min_after_sched: kick.filter((x) => x.add_time_min_after_sched > 5).length,
    examples: kick.slice(0, 10),
  };

  out.requests = { betsapi_this_run: betsapiReq, oddspapi_units_this_run: oddspapiUnits };
  save('upcoming-report.json', out);
  log(JSON.stringify({
    q1_books: out.q1_books.length, q2: { ts_only: out.q2_timestamps.moved_ts_same_price.length,
      price_only: out.q2_timestamps.moved_price_same_ts.length, both: out.q2_timestamps.both, neither: out.q2_timestamps.neither },
    q3_n: out.q3_start.n, q4_n: out.q4_now.n, q5_n: out.q5_kickoff.n,
  }, null, 1));
  log(`wrote ${OUT}/upcoming-report.json`);
}

/* ---------------------------------------------------------------------- main */

const needs = {
  diag: ['BETSAPI_TOKEN', 'SUPABASE_URL', 'SUPABASE_ACCESS_TOKEN'],
  setup: ['SUPABASE_URL', 'SUPABASE_ACCESS_TOKEN'],
  select: ['BETSAPI_TOKEN', 'ODDSPAPI_KEY', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_ACCESS_TOKEN'],
  poll: ['BETSAPI_TOKEN', 'ODDSPAPI_KEY', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_ACCESS_TOKEN'],
  loop: ['BETSAPI_TOKEN', 'ODDSPAPI_KEY', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_ACCESS_TOKEN'],
  report: ['SUPABASE_URL', 'SUPABASE_ACCESS_TOKEN'],
};

async function main() {
  for (const k of needs[CMD] || []) {
    if (!(process.env[k] || '').trim()) { console.error(`FATAL: ${k} is not set`); process.exit(1); }
  }
  if (CMD === 'diag') return cmdDiag();
  if (CMD === 'setup') return cmdSetup();
  if (CMD === 'select') return cmdSelect();
  if (CMD === 'poll') return cmdPoll(Number(process.env.START_POLL_NO || 0));
  if (CMD === 'loop') return cmdLoop();
  if (CMD === 'report') return cmdReport();
  console.error(`unknown subcommand: ${CMD}`);
  process.exit(1);
}

// Importing for the guard test must not fire a run.
if (process.argv[1] && /ten227-upcoming\.mjs$/.test(process.argv[1])) {
  main().catch((err) => { console.error('FATAL:', redact(err.stack || err.message)); process.exit(1); });
}
