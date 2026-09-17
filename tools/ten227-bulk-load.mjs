#!/usr/bin/env node
/**
 * TEN-227 Phase 3 — bulk download of BetsAPI ended tennis events + odds into
 * Supabase tables named `betsapi_raw_*`.
 *
 * Scope guard, enforced in code rather than by convention:
 *   - every DDL statement is matched against an allowlist and may only name an
 *     object whose name starts with `betsapi_raw_`
 *   - no DROP, no ALTER of anything pre-existing, no policy or pg_cron change
 *   - every table is created with RLS ON and ZERO policies, so the publishable
 *     anon key cannot read a single row
 *   - nothing here touches matches.json, the pipeline, the live site, the
 *     TEN-216 collector's tables, or the TEN-225 Oddspapi work
 *
 * Resumable and idempotent. All progress lives in `betsapi_raw_progress`, keyed
 * by (level, day); a run that dies mid-day re-does that day and no other, and
 * every write is an upsert on a natural key, so re-doing a day cannot duplicate.
 *
 * Subcommands
 *   setup   create the tables (idempotent; safe to re-run)
 *   size    measure what is loaded so far and project the full download
 *   load    download, newest year first, until the request or wall-clock budget
 *           runs out — then exit 0 with `MORE_WORK=1` so the caller can chain
 *
 * Budgets, all client-side and all printed at start and end:
 *   BETSAPI_MAX_REQ         hard request ceiling for this process
 *   BETSAPI_RATE_PER_HOUR   pacing ceiling (trial is 1800; we stay at 1600)
 *   LOAD_DEADLINE_MIN       stop cleanly this many minutes in, to land inside
 *                           the Actions job timeout with the checkpoint written
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const TOKEN = (process.env.BETSAPI_TOKEN || '').trim();
const SB_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const SB_KEY = (process.env.SUPABASE_SECRET_KEY || '').trim();
const SB_MGMT = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();

const CMD = process.argv[2] || 'size';
const OUT = 'betsapi-out';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const MAX_REQ = Number(process.env.BETSAPI_MAX_REQ || 1500);
const RATE_PER_HOUR = Number(process.env.BETSAPI_RATE_PER_HOUR || 1600);
const MIN_GAP_MS = Math.ceil(3600_000 / RATE_PER_HOUR);
const DEADLINE_MS = Number(process.env.LOAD_DEADLINE_MIN || 300) * 60_000;
const STARTED = Date.now();
const TENNIS = 13;
const MARKETS = { '13_1': 'mw', '13_2': 'hcap', '13_3': 'ou' };

const need = (v, k) => { if (!v) { console.error(`FATAL: ${k} is empty`); process.exit(1); } return v; };
const redact = (s) => {
  let out = String(s);
  for (const secret of [TOKEN, SB_KEY, SB_MGMT]) if (secret) out = out.split(secret).join('«SECRET»');
  return out;
};
const log = (...a) => console.log(redact(a.join(' ')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REF = SB_URL ? new URL(SB_URL).hostname.split('.')[0] : null;

/* ------------------------------------------------------------ betsapi http */

let reqCount = 0;
let lastReqAt = 0;
let rateLimitHeaders = null;
class BudgetExhausted extends Error {}

function budgetLeft() {
  return { req: MAX_REQ - reqCount, ms: DEADLINE_MS - (Date.now() - STARTED) };
}
function checkBudget() {
  const b = budgetLeft();
  if (b.req <= 0) throw new BudgetExhausted(`request ceiling ${MAX_REQ} reached`);
  if (b.ms <= 0) throw new BudgetExhausted(`wall-clock deadline ${DEADLINE_MS / 60000}min reached`);
}

async function api(path, params = {}, { retries = 3 } = {}) {
  checkBudget();
  const u = new URL('https://api.b365api.com' + path);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
  u.searchParams.set('token', TOKEN);

  const gap = Date.now() - lastReqAt;
  if (gap < MIN_GAP_MS) await sleep(MIN_GAP_MS - gap);

  for (let attempt = 0; ; attempt++) {
    lastReqAt = Date.now();
    reqCount++;
    let res, text;
    try {
      res = await fetch(u, { headers: { 'User-Agent': 'stennisfy-ten227-load' } });
      text = await res.text();
    } catch (err) {
      if (attempt < retries) { await sleep(3000 * (attempt + 1)); continue; }
      return { ok: false, status: 0, transport: redact(err.message), body: null };
    }
    const headers = Object.fromEntries([...res.headers.entries()]);
    const rl = Object.fromEntries(Object.entries(headers).filter(([k]) => /ratelimit|retry-after/i.test(k)));
    if (Object.keys(rl).length) rateLimitHeaders = rl;

    let body = null;
    try { body = JSON.parse(text); } catch { body = { __unparsed: text.slice(0, 300) }; }

    if ((res.status === 429 || body?.error === 'TOO_MANY_REQUESTS') && attempt < retries) {
      const wait = Number(headers['retry-after'] || 0) * 1000 || 65_000;
      log(`  rate-limited, sleeping ${Math.round(wait / 1000)}s (req #${reqCount})`);
      await sleep(wait);
      continue;
    }
    return { ok: res.ok && body?.success === 1, status: res.status, body };
  }
}

/* ----------------------------------------------------------- supabase http */

// Management API — DDL only, behind the allowlist below.
const DDL_OK = /^\s*(create table if not exists|create index if not exists|alter table|comment on)\b/i;
const DDL_FORBIDDEN = /\b(drop|truncate|delete|grant|revoke|create policy|cron\.)\b/i;

// Exported so the guard can be tested against statements we must never send,
// rather than eyeballed. A regex that silently stops matching is the exact
// failure this whole allowlist exists to prevent.
export function assertDdlAllowed(sql) {
  const name = sql.match(/\b(?:table|index)\s+(?:if not exists\s+)?(?:public\.)?([a-z0-9_]+)/i)?.[1] || '';
  if (!DDL_OK.test(sql)) throw new Error(`refusing DDL outside the allowlist: ${sql.slice(0, 80)}`);
  if (DDL_FORBIDDEN.test(sql)) throw new Error(`refusing DDL containing a forbidden verb: ${sql.slice(0, 80)}`);
  // ALTER is permitted only to switch RLS on for a table we just created.
  if (/^\s*alter table/i.test(sql) && !/enable row level security/i.test(sql)) {
    throw new Error(`ALTER is only allowed to enable RLS: ${sql.slice(0, 80)}`);
  }
  if (!/^betsapi_raw_/.test(name)) throw new Error(`refusing DDL on a non-betsapi_raw_ object: "${name}"`);
  return name;
}

// The statements the loader itself ships, exported so the test can assert that
// every one of them passes its own guard.
export const DDL_STATEMENTS = () => TABLES;

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

// PostgREST — data plane, upserts only.
async function upsert(table, rows, onConflict) {
  if (!rows.length) return 0;
  const CHUNK = 500;
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
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`upsert ${table} HTTP ${res.status}: ${redact(t).slice(0, 400)}`);
    }
    done += slice.length;
  }
  return done;
}

/* -------------------------------------------------------------------- setup */

const TABLES = [
  `create table if not exists betsapi_raw_events (
     event_id      text primary key,
     level         text not null,
     day           text not null,
     league_id     text,
     league_name   text,
     round_id      text,
     round_name    text,
     home_name     text,
     away_name     text,
     ss            text,
     start_time    bigint,
     time_status   text,
     bo            smallint,
     odds_fetched  boolean not null default false,
     odds_rows     integer,
     ingested_at   timestamptz not null default now()
   )`,
  `create index if not exists betsapi_raw_events_pending_idx
     on betsapi_raw_events (day desc) where odds_fetched = false`,
  `create index if not exists betsapi_raw_events_level_day_idx
     on betsapi_raw_events (level, day)`,

  // One row per quoted price. `betsapi_row_id` is BetsAPI's own row id, which
  // makes the upsert key natural and the load genuinely idempotent — re-running
  // a day rewrites the same rows instead of appending a second copy.
  `create table if not exists betsapi_raw_odds (
     event_id        text not null,
     source          text not null,
     market          text not null,
     betsapi_row_id  text not null,
     add_time        bigint,
     home_od         text,
     away_od         text,
     draw_od         text,
     over_od         text,
     under_od        text,
     handicap        text,
     ss              text,
     time_str        text,
     is_prematch     boolean,
     primary key (event_id, source, market, betsapi_row_id)
   )`,
  `create index if not exists betsapi_raw_odds_event_idx on betsapi_raw_odds (event_id)`,
  `create index if not exists betsapi_raw_odds_market_idx on betsapi_raw_odds (market, handicap)`,

  // Day-level checkpoint. The loader never re-enumerates a day marked done.
  `create table if not exists betsapi_raw_progress (
     day            text primary key,
     enumerated     boolean not null default false,
     all_tennis     integer,
     pages_read     integer,
     truncated      boolean,
     events_kept    integer,
     odds_done      integer,
     updated_at     timestamptz not null default now()
   )`,
];

async function cmdSetup() {
  need(SB_MGMT, 'SUPABASE_ACCESS_TOKEN');
  for (const sql of TABLES) { await ddl(sql); log(`ok: ${sql.trim().split('\n')[0]}`); }
  for (const t of ['betsapi_raw_events', 'betsapi_raw_odds', 'betsapi_raw_progress']) {
    await ddl(`alter table ${t} enable row level security`);
    log(`RLS on: ${t}`);
  }
  // Prove the guard rather than assume it: a table with RLS on and no policy is
  // unreadable by the anon key, and that is the property we actually care about.
  const pol = await sbSelect(`select tablename, count(*) as n from pg_policies
     where schemaname='public' and tablename like 'betsapi\\_raw\\_%' group by tablename`);
  const rls = await sbSelect(`select relname, relrowsecurity from pg_class
     where relname like 'betsapi\\_raw\\_%' and relkind='r'`);
  log(`policies on betsapi_raw_*: ${JSON.stringify(pol)} (must be [])`);
  log(`rls flags: ${JSON.stringify(rls)} (all must be true)`);
  if (pol.length) { console.error('FATAL: a policy exists on a betsapi_raw_ table'); process.exit(1); }
  if (rls.some((r) => !r.relrowsecurity)) { console.error('FATAL: RLS is off somewhere'); process.exit(1); }
}

/* --------------------------------------------------------------------- size */

async function cmdSize() {
  const diskBytes = Number(process.env.SUPABASE_DISK_BYTES || 8 * 1024 ** 3);
  const db = await sbSelect('select pg_database_size(current_database()) as bytes');
  const used = Number(db[0].bytes);
  const mine = await sbSelect(`select relname, pg_total_relation_size(relid) as bytes, n_live_tup as rows
     from pg_stat_user_tables where relname like 'betsapi\\_raw\\_%'
     order by pg_total_relation_size(relid) desc`);
  const ev = await sbSelect(`select level, substring(day,1,4) as year, count(*) as events,
       count(*) filter (where odds_fetched) as with_odds
     from betsapi_raw_events group by 1,2 order by 2 desc, 1`).catch(() => []);
  const oddsRows = await sbSelect('select count(*) as n from betsapi_raw_odds').catch(() => [{ n: 0 }]);

  const report = {
    measured_at: new Date().toISOString(),
    database_bytes: used,
    disk_bytes: diskBytes,
    used_pct: (100 * used) / diskBytes,
    ceiling_70pct_bytes: Math.round(0.7 * diskBytes),
    betsapi_raw_tables: mine,
    odds_rows: Number(oddsRows[0]?.n || 0),
    events_by_level_year: ev,
  };
  // Bytes per loaded match, measured — the only honest basis for a projection.
  const loaded = ev.reduce((a, r) => a + Number(r.with_odds), 0);
  const mineBytes = mine.reduce((a, r) => a + Number(r.bytes), 0);
  report.loaded_matches = loaded;
  report.bytes_per_match = loaded ? mineBytes / loaded : null;
  report.note = loaded
    ? 'bytes_per_match is measured from the rows actually loaded'
    : 'nothing loaded yet — no projection is possible without a measured bytes/match';
  save('phase3-size.json', report);
  log(JSON.stringify(report, null, 1));
}

const save = (n, o) => writeFileSync(`${OUT}/${n}`, JSON.stringify(o, null, 1));

/* --------------------------------------------------------------------- load */

const DROP = {
  doubles: /(\bMD\b|\bWD\b|doubles)\s*$/i,
  qualifying: /\bqual(ifying|ifier)?\b\s*$/i,
  women: /\bwta\b|\bwomen\b|\bgirls\b|\bladies\b|\bw\d{2,3}\b/i,
  lower_tier: /\bitf\b|\butr\b|\bm\d{2,3}\b|exhibition|junior/i,
};
function classify(name) {
  if (!name) return null;
  for (const re of Object.values(DROP)) if (re.test(name)) return null;
  const n = name.trim().toLowerCase();
  if (/^(australian open|roland garros|french open|wimbledon|us open)$/.test(n)) return 'slam';
  if (/^challenger\b/.test(n)) return 'challenger';
  if (/^atp\b/.test(n)) return 'atp';
  return null;
}

// Newest year first, per the brief; within a year, newest day first.
function* daysNewestFirst(fromYear, toYear) {
  for (let y = toYear; y >= fromYear; y--) {
    const lastMonth = 12, firstMonth = y === 2016 ? 9 : 1;
    for (let m = lastMonth; m >= firstMonth; m--) {
      const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
      for (let d = dim; d >= 1; d--) {
        const day = `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
        if (day < '20160901') continue;
        if (Number(day) > Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''))) continue;
        yield day;
      }
    }
  }
}

async function cmdLoad() {
  need(TOKEN, 'BETSAPI_TOKEN');
  need(SB_KEY, 'SUPABASE_SECRET_KEY');
  const fromYear = Number(process.env.LOAD_FROM_YEAR || 2016);
  const toYear = Number(process.env.LOAD_TO_YEAR || 2025);

  const doneDays = new Set(
    (await sbSelect(`select day from betsapi_raw_progress where enumerated and odds_done is not null`))
      .map((r) => r.day),
  );
  log(`resume: ${doneDays.size} days already complete`);

  const stats = { days: 0, events: 0, odds_rows: 0, errors: 0, started: new Date().toISOString() };
  let exhausted = false;

  for (const day of daysNewestFirst(fromYear, toYear)) {
    if (doneDays.has(day)) continue;
    try {
      checkBudget();
      // --- enumerate the day
      const keep = [];
      let allTennis = null, pages = 0;
      for (let page = 1; page <= 100; page++) {
        const r = await api('/v3/events/ended', { sport_id: TENNIS, day, page });
        pages = page;
        if (!r.ok) { stats.errors++; break; }
        const rows = r.body?.results || [];
        if (page === 1) allTennis = r.body?.pager?.total ?? null;
        for (const e of rows) {
          const lvl = classify(e.league?.name);
          if (!lvl) continue;
          if (String(e.time_status) !== '3') continue;
          if (/\//.test(e.home?.name || '') || /\//.test(e.away?.name || '')) continue;
          const sets = (e.ss || '').split(',').filter(Boolean).length;
          keep.push({
            event_id: String(e.id), level: lvl, day,
            league_id: e.league?.id != null ? String(e.league.id) : null,
            league_name: e.league?.name ?? null,
            round_id: e.round?.id != null ? String(e.round.id) : null,
            round_name: e.round?.name ?? null,
            home_name: e.home?.name ?? null, away_name: e.away?.name ?? null,
            ss: e.ss ?? null, start_time: Number(e.time) || null,
            time_status: String(e.time_status),
            bo: sets >= 4 ? 5 : sets >= 1 ? 3 : null,
          });
        }
        const total = r.body?.pager?.total ?? 0;
        const per = r.body?.pager?.per_page ?? 50;
        if (rows.length < per || page * per >= total) break;
      }
      await upsert('betsapi_raw_events', keep, 'event_id');

      // --- odds, one request per kept event
      let oddsDone = 0, rowsWritten = 0;
      for (const ev of keep) {
        checkBudget();
        const r = await api('/v2/event/odds', { event_id: ev.event_id });
        if (!r.ok) { stats.errors++; continue; }
        const odds = r.body?.results?.odds || {};
        const rows = [];
        for (const [market, list] of Object.entries(odds)) {
          if (!Array.isArray(list)) continue;
          for (const row of list) {
            rows.push({
              event_id: ev.event_id, source: 'bet365', market,
              betsapi_row_id: String(row.id ?? `${market}:${row.add_time}:${row.handicap ?? ''}`),
              add_time: Number(row.add_time) || null,
              home_od: row.home_od ?? null, away_od: row.away_od ?? null, draw_od: row.draw_od ?? null,
              over_od: row.over_od ?? null, under_od: row.under_od ?? null,
              handicap: row.handicap ?? null, ss: row.ss ?? null, time_str: row.time_str ?? null,
              is_prematch: !row.ss && !row.time_str && Number(row.add_time) <= Number(ev.start_time),
            });
          }
        }
        rowsWritten += await upsert('betsapi_raw_odds', rows, 'event_id,source,market,betsapi_row_id');
        await upsert('betsapi_raw_events',
          [{ event_id: ev.event_id, level: ev.level, day: ev.day, odds_fetched: true, odds_rows: rows.length }],
          'event_id');
        oddsDone++;
      }

      await upsert('betsapi_raw_progress', [{
        day, enumerated: true, all_tennis: allTennis, pages_read: pages,
        truncated: false, events_kept: keep.length, odds_done: oddsDone,
        updated_at: new Date().toISOString(),
      }], 'day');

      stats.days++; stats.events += keep.length; stats.odds_rows += rowsWritten;
      const b = budgetLeft();
      log(`${day}: tennis=${allTennis ?? '—'} kept=${keep.length} odds=${oddsDone} rows=${rowsWritten} [req ${reqCount}, ${b.req} left, ${Math.round(b.ms / 60000)}min left]`);
    } catch (e) {
      if (e instanceof BudgetExhausted) { log(`stopping cleanly: ${e.message}`); exhausted = true; break; }
      throw e;
    }
  }

  stats.finished = new Date().toISOString();
  stats.requests_used = reqCount;
  stats.rate_limit_headers = rateLimitHeaders;
  stats.more_work = exhausted;
  save('phase3-load.json', stats);
  log(`\nLOAD SUMMARY ${JSON.stringify(stats)}`);
  // The caller chains on this, per the TEN-221 self-dispatch rulings.
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `more_work=${exhausted ? 1 : 0}\n`, { flag: 'a' });
  }
}

/* --------------------------------------------------------------------- main */

// Importing this module (the guard test does) must not fire a download.
const INVOKED_DIRECTLY = process.argv[1] && process.argv[1].endsWith('ten227-bulk-load.mjs');
if (INVOKED_DIRECTLY) {
  log(`cmd=${CMD} max_req=${MAX_REQ} rate=${RATE_PER_HOUR}/h gap=${MIN_GAP_MS}ms deadline=${DEADLINE_MS / 60000}min`);
  if (CMD === 'setup') await cmdSetup();
  else if (CMD === 'size') await cmdSize();
  else if (CMD === 'load') await cmdLoad();
  else { console.error(`unknown cmd: ${CMD}`); process.exit(2); }
  log(`requests used: ${reqCount}`);
}
