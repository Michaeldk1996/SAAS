// TEN-294 — the stennisfy-drops endpoint (founder ruling 2026-09-26: path B′, a SEPARATE Fly app; design doc
// `design` approved on card 37612d3d). Rules: .claude/rules/drops.md.
//
// ONE READ, FANNED OUT. A single loop calls drops_api.snapshot() on its own cadence and keeps the result in
// memory. Requests are served from that memory and NEVER trigger a database read, so 500 viewers cost the
// database exactly what 1 viewer does (2 reads a minute).
//
// CADENCE = THE BOTS' WRITE CADENCE. Both drop bots write alerts every 30 s. The next read is scheduled for
// just after the Bet105 bot's next tick (its last successful run + 30 s + a small margin), clamped to
// [MIN_GAP_MS, READ_INTERVAL_MS] from now, so we never read faster than the data can change.
//
// NEVER STALE-AS-CURRENT. `generatedAt` advances only when a read SUCCEEDS. A failed read keeps serving the
// last good snapshot with its true, growing age, so the page ages into amber on its own.

import http from 'node:http';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { withStatus, apiNeeds, createApiTennis } from './status.mjs';

export const READ_INTERVAL_MS = 30_000;    // the bots' tick
export const MIN_GAP_MS = 10_000;          // floor between two reads, whatever the alignment says
export const ALIGN_MARGIN_MS = 3_000;      // after the bot's expected finish
export const AMBER_AFTER_S = 90;           // 3 x the read interval (founder, design §5)
export const PAUSED_AFTER_S = 300;         // rows dim, "as of HH:MM" (design §5)
export const WINDOW_HOURS = 72;            // founder card 518c56f0 Q4

// Per-source staleness, in seconds of age at read time. Proposal in design §5; tuned on measured data.
export const STALE_AFTER_S = {
  'kibl-stream': 120,        // worker heartbeat
  'kibl-poller': 900,        // */5 sweep whose runs take ~7.4 min
  'superbet-recorder': 180,  // 30 s recorder
  'bet105-bot': 120,         // 30 s pg_cron
  'superbet-bot': 120,       // 30 s pg_cron
};

export const DEFAULT_ORIGINS = ['https://michaeldk1996.github.io'];

// Supabase's own root CA (public; https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/
// prod-ca-2021.crt). The pooler's chain does NOT verify against the public roots (measured 2026-09-26:
// SELF_SIGNED_CERT_IN_CHAIN without it, authorized=true with it).
export const CA_FILE = new URL('./supabase-ca-2021.crt', import.meta.url);

// node-postgres lets `sslmode` in the URL OVERRIDE the ssl object (it becomes {}), silently dropping the CA
// (independent review, 2026-09-26). So the URL's ssl parameters are stripped and TLS is set here only.
export function dbConfig(url, ca) {
  if (!url) throw new Error('no database url');
  if (!ca) throw new Error('no CA: refusing an unverified database connection');
  const u = new URL(url);
  for (const k of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl', 'uselibpqcompat']) u.searchParams.delete(k);
  return {
    connectionString: u.toString(), max: 1,
    idleTimeoutMillis: 20_000,          // below the read interval: never hold an idle socket the server may drop
    connectionTimeoutMillis: 10_000, query_timeout: 25_000, statement_timeout: 20_000,
    ssl: { ca, rejectUnauthorized: true, servername: u.hostname },
  };
}

// What the public sees of a failure: a code, never the driver's text (it can carry the database host).
export function errorCode(e) {
  const m = String(e && (e.code || e.message) || e);
  if (/snapshot shape/.test(m)) return 'bad_snapshot';
  if (/timeout/i.test(m)) return 'db_timeout';
  return 'db_error';
}

const ms = (t) => (t == null ? null : new Date(t).getTime());

export function sourceStates(snapshot, extraAgeS = 0) {
  const dbNow = ms(snapshot.dbNow);
  return (snapshot.sources || []).map((s) => {
    const at = ms(s.lastAt);
    const ageS = at == null || !Number.isFinite(at) ? null : Math.max(0, (dbNow - at) / 1000 + extraAgeS);
    const staleAfterS = STALE_AFTER_S[s.id] ?? null;
    const state = ageS == null ? 'unknown' : staleAfterS != null && ageS > staleAfterS ? 'stale' : 'ok';
    return { id: s.id, label: s.label, lastAt: s.lastAt ?? null, ageS: ageS == null ? null : Math.round(ageS), staleAfterS, state };
  });
}

export function nextReadDelay(snapshot, nowMs) {
  const bot = (snapshot?.sources || []).find((s) => s.id === 'bet105-bot');
  const last = ms(bot?.lastAt);
  if (last == null || !Number.isFinite(last)) return READ_INTERVAL_MS;
  let target = last + READ_INTERVAL_MS + ALIGN_MARGIN_MS;
  while (target - nowMs < MIN_GAP_MS) target += READ_INTERVAL_MS;   // already passed: the tick after
  // ceiling = one tick + the margin, so a read right after a bot run still lands AFTER the next one
  return Math.min(READ_INTERVAL_MS + ALIGN_MARGIN_MS, Math.max(MIN_GAP_MS, target - nowMs));
}

export function freshness(ageS) {
  if (ageS == null) return 'none';
  if (ageS > PAUSED_AFTER_S) return 'paused';
  if (ageS > AMBER_AFTER_S) return 'amber';
  return 'ok';
}

export const BOARD_FRESH_MS = 120e3;       // the 10 s live poller's board; older than this it is not "now"

// Status + the live cut (status.mjs). Never throws: api-tennis trouble leaves the database-side status
// (live sightings + board) and the cut in place, and the rest reads "unknown" — never un-cut prices.
export function makeEnrich({ api, now = () => Date.now(), log = () => {} }) {
  return async function enrich(snap) {
    const b = snap.board || {};
    const fresh = b.at && now() - Date.parse(b.at) <= BOARD_FRESH_MS;
    const board = new Map(fresh ? (b.matches || []).map((m) => [String(m.eventKey), m]) : []);
    const ctx = { flips: Array.isArray(snap.flips) ? snap.flips : [], board, now: now() };
    try { if (api) await api.fill(apiNeeds(snap.rows, { ...ctx, fixtures: api.fixtures() }, api.cache)); } catch (e) { log('api-tennis fill failed'); }
    return withStatus(snap.rows, Array.isArray(snap.lines) ? snap.lines : [], { ...ctx, byKey: api ? api.byKey() : new Map(), fixtures: api ? api.fixtures() : null });
  };
}

export function createDropsService({ readSnapshot, enrich = null, now = () => Date.now(), origins = DEFAULT_ORIGINS, log = () => {} }) {
  const state = {
    snapshot: null,          // last GOOD snapshot
    generatedAtMs: null,     // when that good read finished (our clock)
    rowsBody: null, rowsGz: null, rowsEtag: null,
    nextReadAtMs: null,
    reads: 0, failures: 0, lastError: null, lastErrorAtMs: null,
    timer: null, stopped: false,
  };

  async function readOnce() {
    state.reads += 1;
    try {
      const snap = await readSnapshot();
      if (!snap || !Array.isArray(snap.rows) || !Array.isArray(snap.sources)) throw new Error('snapshot shape');
      // lines: every recorded book quoting each flagged line (the pop-up); an older snapshot without it -> []
      // enrich: each row's match status and the live cut (drops.md) — rows/lines are served ONLY enriched
      const fed = enrich ? await enrich(snap) : { rows: snap.rows, lines: Array.isArray(snap.lines) ? snap.lines : [] };
      const body = Buffer.from(JSON.stringify({ schema: 1, windowHours: snap.windowHours ?? null, rows: fed.rows, lines: fed.lines }));
      const etag = '"' + crypto.createHash('sha1').update(body).digest('base64url') + '"';
      if (etag !== state.rowsEtag) {
        state.rowsBody = body;
        state.rowsGz = zlib.gzipSync(body);
        state.rowsEtag = etag;
      }
      state.snapshot = snap;
      state.generatedAtMs = now();      // ONLY here: a failed read never refreshes the clock
      state.lastError = null;
    } catch (e) {
      state.failures += 1;
      state.lastError = errorCode(e);                  // public
      state.lastErrorAtMs = now();
      log(`read failed (${state.lastError}): ${String(e && e.message ? e.message : e).slice(0, 300)}`);   // logs only
    }
  }

  function schedule() {
    if (state.stopped) return;
    const delay = state.snapshot ? nextReadDelay(state.snapshot, now()) : READ_INTERVAL_MS;
    state.nextReadAtMs = now() + delay;
    state.timer = setTimeout(async () => { await readOnce(); schedule(); }, delay);
  }

  async function start() { await readOnce(); schedule(); }
  function stop() { state.stopped = true; clearTimeout(state.timer); }

  function ageS() {
    return state.generatedAtMs == null ? null : Math.max(0, (now() - state.generatedAtMs) / 1000);
  }

  function status() {
    const age = ageS();
    const sources = state.snapshot ? sourceStates(state.snapshot, age ?? 0) : [];
    return {
      schema: 1,
      generatedAt: state.generatedAtMs == null ? null : new Date(state.generatedAtMs).toISOString(),
      serverNow: new Date(now()).toISOString(),
      nextReadAt: state.nextReadAtMs == null ? null : new Date(state.nextReadAtMs).toISOString(),
      readIntervalS: READ_INTERVAL_MS / 1000,
      ageS: age == null ? null : Math.round(age),
      freshness: freshness(age),
      rowsEtag: state.rowsEtag,
      rowCount: state.snapshot ? state.snapshot.rows.length : null,
      sources,
      lastError: state.lastError,
    };
  }

  function corsHeaders(req) {
    const o = req.headers.origin;
    return o && origins.includes(o) ? { 'Access-Control-Allow-Origin': o, Vary: 'Origin' } : { Vary: 'Origin' };
  }

  function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'If-None-Match', 'Access-Control-Max-Age': '86400' });
      return res.end();
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, cors); return res.end(); }

    if (url.pathname === '/status.json') {
      const toNext = state.nextReadAtMs == null ? 1 : Math.max(1, Math.floor((state.nextReadAtMs - now()) / 1000));
      const body = JSON.stringify(status());
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${toNext}`, 'Access-Control-Expose-Headers': 'ETag' });
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    if (url.pathname === '/drops.json') {
      if (!state.rowsBody) {   // nothing good read yet: say so, never an empty list that looks like "no drops"
        res.writeHead(503, { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '30' });
        return res.end(JSON.stringify({ error: 'no snapshot yet' }));
      }
      const base = { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', ETag: state.rowsEtag, 'Access-Control-Expose-Headers': 'ETag' };
      if (req.headers['if-none-match'] === state.rowsEtag) { res.writeHead(304, base); return res.end(); }
      const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      res.writeHead(200, gz ? { ...base, 'Content-Encoding': 'gzip' } : base);
      return res.end(req.method === 'HEAD' ? undefined : gz ? state.rowsGz : state.rowsBody);
    }
    if (url.pathname === '/health') {
      const s = status();
      const bad = s.freshness !== 'ok' || s.sources.some((x) => x.state !== 'ok');
      res.writeHead(bad ? 503 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ok: !bad, ageS: s.ageS, freshness: s.freshness, sources: s.sources.map(({ id, state: st, ageS: a }) => ({ id, state: st, ageS: a })), lastError: s.lastError }));
    }
    res.writeHead(404, cors); return res.end();
  }

  return { start, stop, readOnce, status, handle, state };
}

// ---- entry point (Fly). pg is imported only here, so the tests need no driver. ----
async function main() {
  const { default: pg } = await import('pg');
  const url = Buffer.from(process.env.DROPS_DB_URL_B64 || '', 'base64').toString('utf8');
  if (!url) { console.error('DROPS_DB_URL_B64 not set'); process.exit(1); }
  const pool = new pg.Pool(dbConfig(url, fs.readFileSync(CA_FILE, 'utf8')));
  // an idle client the server drops emits 'error' on the pool; unhandled, it would kill the process and the cache
  pool.on('error', (e) => console.log(new Date().toISOString(), `pool error (${errorCode(e)}): ${e.message}`));
  // 72 h: founder card 518c56f0 Q4 (Completed goes back 72 h)
  const readSnapshot = async () => (await pool.query('select drops_api.snapshot($1) as j', [WINDOW_HOURS])).rows[0].j;
  const origins = (process.env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  const log = (m) => console.log(new Date().toISOString(), m);
  // the api-tennis key comes from the Fly secret only, and is never logged (status.mjs reports codes)
  if (!process.env.API_TENNIS_KEY) log('API_TENNIS_KEY not set: finished checks off, missed live sightings read "unknown"');
  const api = createApiTennis({ key: process.env.API_TENNIS_KEY || '', log });
  const svc = createDropsService({ readSnapshot, enrich: makeEnrich({ api, log }), origins, log });
  await svc.start();
  const port = Number(process.env.PORT || 8080);
  http.createServer(svc.handle).listen(port, '0.0.0.0', () => console.log(`stennisfy-drops on :${port}`));
  setInterval(() => { const s = svc.status(); console.log(`tick age=${s.ageS}s rows=${s.rowCount} fresh=${s.freshness} err=${s.lastError ?? '-'}`); }, 60_000);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
