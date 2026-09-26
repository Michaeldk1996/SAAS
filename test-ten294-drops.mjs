// TEN-294 — the drops endpoint (founder ruling 2026-09-26: path B′; design doc `design`, card 37612d3d).
// Each ruling in .claude/rules/drops.md is driven through the REAL service (createDropsService) with an
// injected reader that returns drops_api.snapshot()'s shape, or read off the real config files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  createDropsService, nextReadDelay, sourceStates, freshness,
  READ_INTERVAL_MS, MIN_GAP_MS, ALIGN_MARGIN_MS, AMBER_AFTER_S, PAUSED_AFTER_S, STALE_AFTER_S, DEFAULT_ORIGINS,
  dbConfig, errorCode, CA_FILE,
} from './stennisfy-drops/server.mjs';
import crypto from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const T0 = Date.parse('2026-09-26T12:00:00Z');
const iso = (msAgo, base = T0) => new Date(base - msAgo).toISOString();

// drops_api.snapshot()'s shape (tools/ten294-drops-api.sql)
function snapshot({ rows = [ROW], dbNow = T0, bot = 5_000 } = {}) {
  return {
    schema: 1, dbNow: new Date(dbNow).toISOString(), windowHours: 24, rows,
    sources: [
      { id: 'kibl-stream', label: 'Kibl stream (ATP)', lastAt: iso(10_000, dbNow) },
      { id: 'kibl-poller', label: 'Kibl poller (Challenger/ITF)', lastAt: iso(200_000, dbNow) },
      { id: 'superbet-recorder', label: 'Superbet recorder', lastAt: iso(20_000, dbNow) },
      { id: 'bet105-bot', label: 'Bet105 drop bot', lastAt: bot == null ? null : iso(bot, dbNow) },
      { id: 'superbet-bot', label: 'Superbet drop bot', lastAt: iso(15_000, dbNow) },
    ],
  };
}
const ROW = { id: 'bet105-1', book: 'Bet105', tier: 'ATP', playerA: 'A One', playerB: 'B Two', side: 'A One',
  line: 'Match Winner', open: { price: '2.1', at: iso(3_600_000), kind: 'book opener' },
  preDrop: { price: '2', at: iso(700_000) }, droppedTo: { price: '1.85', at: iso(60_000) },
  dropPct: 7.5, sinceOpenPct: -11.9, detectedAt: iso(50_000), latest: { price: '1.83', at: iso(20_000) },
  started: false, pastScheduledStart: false };

function harness({ reader, origins } = {}) {
  let clock = T0;
  let reads = 0;
  const svc = createDropsService({
    readSnapshot: reader ? async () => { reads += 1; return reader(clock); } : async () => { reads += 1; return snapshot({ dbNow: clock }); },
    now: () => clock, origins,
  });
  return { svc, tick: (ms) => { clock += ms; }, reads: () => reads };
}
function call(svc, url, headers = {}, method = 'GET') {
  let status, hdrs, body;
  const res = { writeHead: (s, h) => { status = s; hdrs = h || {}; }, end: (b) => { body = b; } };
  svc.handle({ url, method, headers }, res);
  return { status, headers: hdrs, body };
}

// ---- Ruling 1: B′ — a separate Fly app, never Pages, never kibl-stream ----

const tomlTables = (src) => src.split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter((l) => /^\[\[?[^\]]+\]\]?$/.test(l));

test('B′: the endpoint host is the stennisfy-drops Fly app — not *.github.io and not kibl-stream', () => {
  const app = read('stennisfy-drops/fly.toml').match(/^app\s*=\s*"([^"]+)"/m)[1];
  const host = `${app}.fly.dev`;
  assert.equal(app, 'stennisfy-drops');
  assert.doesNotMatch(host, /\.github\.io$/);
  assert.doesNotMatch(host, /kibl-stream/);
  assert.ok(tomlTables(read('stennisfy-drops/fly.toml')).includes('[http_service]'), 'the drops app serves HTTP');
});

test('B′: kibl-stream/fly.toml has no [http_service] and no [[services]] block', () => {
  const t = tomlTables(read('kibl-stream/fly.toml'));
  assert.ok(t.length > 0, 'parsed some tables (a vacuous parse would pass)');
  assert.ok(!t.includes('[http_service]') && !t.includes('[[services]]'), `service block found: ${t}`);
  // control: the same parser DOES see a service block when one is present
  assert.ok(tomlTables('[[vm]]\n[http_service]\n  internal_port = 1').includes('[http_service]'));
});

test('B′: every drops page fetches only from the drops app (skips OUT LOUD until the page exists)', (t) => {
  const pages = fs.readdirSync(ROOT).filter((f) => /^drops.*\.(html|js|mjs)$/.test(f));
  if (!pages.length) { t.skip('no drops page yet — the page is built against its Claude Design export'); return; }
  for (const p of pages) {
    const hosts = [...read(p).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
    const dataHosts = hosts.filter((h) => !/fonts\.(googleapis|gstatic)\.com$/.test(h));
    assert.ok(dataHosts.includes('stennisfy-drops.fly.dev'), `${p} never names the drops app`);
    for (const h of dataHosts) {
      assert.doesNotMatch(h, /\.github\.io$|kibl-stream|supabase/, `${p} fetches from ${h}`);
    }
  }
});

test('CORS allows exactly the Pages origin (origins carry no path)', () => {
  assert.deepEqual(DEFAULT_ORIGINS, ['https://michaeldk1996.github.io']);
  assert.match(read('stennisfy-drops/fly.toml'), /ALLOWED_ORIGINS = "https:\/\/michaeldk1996\.github\.io"/);
});

// ---- Ruling 2: one read fanned out to every viewer ----

test('fan-out: 500 viewers x every route = zero extra database reads', async () => {
  const h = harness();
  await h.svc.readOnce();
  assert.equal(h.reads(), 1);
  for (let i = 0; i < 500; i++) {
    call(h.svc, '/status.json'); call(h.svc, '/drops.json'); call(h.svc, '/health');
  }
  assert.equal(h.reads(), 1, 'a request triggered a database read');
});

test('cadence: never faster than the bots write (>= MIN_GAP), never slower than one tick + margin; aligned after the Bet105 tick', () => {
  assert.equal(READ_INTERVAL_MS, 30_000);
  assert.equal(ALIGN_MARGIN_MS, 3_000);
  for (let botAgo = 0; botAgo <= 120_000; botAgo += 1_000) {
    const d = nextReadDelay(snapshot({ bot: botAgo }), T0);
    assert.ok(d >= MIN_GAP_MS && d <= READ_INTERVAL_MS + ALIGN_MARGIN_MS, `botAgo=${botAgo} -> ${d}`);
  }
  // bot JUST finished -> read 3 s after its NEXT run, not 0 s after it (review finding: a 30 s cap lost this)
  assert.equal(nextReadDelay(snapshot({ bot: 0 }), T0), 33_000);
  // bot finished 5 s ago -> next tick ends ~25 s from now, read 3 s after it
  assert.equal(nextReadDelay(snapshot({ bot: 5_000 }), T0), 28_000);
  // bot finished 24 s ago -> its next tick lands 9 s from now, inside the 10 s floor -> skip to the tick after (clamped to 33 s)
  assert.equal(MIN_GAP_MS, 10_000);
  assert.equal(nextReadDelay(snapshot({ bot: 24_000 }), T0), 33_000);
  assert.equal(nextReadDelay(snapshot({ bot: 20_000 }), T0), 13_000);
  // no bot heartbeat -> plain 30 s
  assert.equal(nextReadDelay(snapshot({ bot: null }), T0), 30_000);
});

// ---- Ruling 3: never present stale drops as current ----

test('generatedAt advances ONLY on a successful read; a failing reader leaves the true age growing', async () => {
  let fail = false;
  const h = harness({ reader: (clock) => { if (fail) throw new Error('db down'); return snapshot({ dbNow: clock }); } });
  await h.svc.readOnce();
  const first = h.svc.status().generatedAt;
  fail = true;
  h.tick(95_000); await h.svc.readOnce();
  let s = h.svc.status();
  assert.equal(s.generatedAt, first, 'a failed read moved the clock');
  assert.equal(s.ageS, 95);
  assert.equal(s.freshness, 'amber');
  assert.equal(s.lastError, 'db_error');
  assert.equal(call(h.svc, '/health').status, 503);
  h.tick(210_000); await h.svc.readOnce();
  s = h.svc.status();
  assert.equal(s.freshness, 'paused');
  // last good rows still served (with their age), never replaced by an empty list
  assert.equal(JSON.parse(call(h.svc, '/drops.json').body).rows.length, 1);
  fail = false; h.tick(1_000); await h.svc.readOnce();
  assert.equal(h.svc.status().freshness, 'ok');
  assert.notEqual(h.svc.status().generatedAt, first);
});

test('freshness thresholds: amber past 3x the interval (90 s), paused past 5 min — both edges', () => {
  assert.equal(AMBER_AFTER_S, 3 * READ_INTERVAL_MS / 1000);
  assert.equal(PAUSED_AFTER_S, 300);
  assert.equal(freshness(90), 'ok'); assert.equal(freshness(90.5), 'amber');
  assert.equal(freshness(300), 'amber'); assert.equal(freshness(300.5), 'paused');
  assert.equal(freshness(null), 'none');
});

test('a malformed snapshot is a failed read, not an empty board', async () => {
  const h = harness({ reader: () => ({ rows: null, sources: [] }) });
  await h.svc.readOnce();
  assert.equal(h.svc.status().generatedAt, null);
  assert.equal(call(h.svc, '/drops.json').status, 503);
});

test('before the first good read /drops.json is 503 "no snapshot yet", never [] (which would read as "no drops")', () => {
  const h = harness();
  const r = call(h.svc, '/drops.json');
  assert.equal(r.status, 503);
  assert.match(r.body, /no snapshot yet/);
});

test('per-source staleness: each source against its own limit, age measured on the DB clock plus snapshot age', () => {
  const snap = snapshot();
  snap.sources.find((s) => s.id === 'kibl-stream').lastAt = iso((STALE_AFTER_S['kibl-stream'] + 1) * 1000);
  snap.sources.find((s) => s.id === 'superbet-bot').lastAt = null;
  const st = Object.fromEntries(sourceStates(snap).map((s) => [s.id, s.state]));
  assert.deepEqual(st, { 'kibl-stream': 'stale', 'kibl-poller': 'ok', 'superbet-recorder': 'ok', 'bet105-bot': 'ok', 'superbet-bot': 'unknown' });
  // the poller (200 s old) is fine at its 900 s limit, but not 710 s later
  assert.equal(sourceStates(snapshot(), 710).find((s) => s.id === 'kibl-poller').state, 'stale');
  for (const s of snapshot().sources) assert.ok(s.id in STALE_AFTER_S, `no limit for ${s.id}`);
});

// ---- the database link: verified TLS or nothing (review blocker: sslmode in the URL dropped the CA) ----

test('dbConfig: strips every URL ssl parameter, verifies against the bundled Supabase CA, refuses without one', () => {
  const ca = fs.readFileSync(CA_FILE, 'utf8');
  const c = dbConfig('postgresql://u.ref:p%40ss@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require&sslrootcert=x&application_name=drops', ca);
  assert.doesNotMatch(c.connectionString, /ssl/i, 'an ssl URL parameter would override the ssl object');
  assert.match(c.connectionString, /application_name=drops/, 'unrelated parameters survive');
  assert.equal(c.ssl.ca, ca);
  assert.equal(c.ssl.rejectUnauthorized, true);
  assert.equal(c.ssl.servername, 'aws-0-eu-west-1.pooler.supabase.com');
  assert.ok(c.idleTimeoutMillis < READ_INTERVAL_MS && c.connectionTimeoutMillis > 0 && c.query_timeout > 0);
  assert.throws(() => dbConfig('postgresql://u:p@h/db', null), /no CA/);
  // the workflow never builds an sslmode URL
  assert.doesNotMatch(read('.github/workflows/ten294-drops.yml'), /sslmode/);
});

test('the bundled CA is Supabase Root 2021 (fingerprint pinned)', () => {
  const x = new crypto.X509Certificate(fs.readFileSync(CA_FILE));
  assert.match(x.subject, /CN=Supabase Root 2021 CA/);
  assert.equal(x.fingerprint256, '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
  assert.match(read('stennisfy-drops/Dockerfile'), /COPY server\.mjs supabase-ca-2021\.crt/);
});

test('a failure is public only as a code — the driver text (which can name the database host) stays in the logs', async () => {
  const h = harness({ reader: () => { throw new Error('getaddrinfo ENOTFOUND aws-0-eu-west-1.pooler.supabase.com'); } });
  await h.svc.readOnce();
  for (const route of ['/status.json', '/health']) assert.doesNotMatch(call(h.svc, route).body, /supabase|pooler|ENOTFOUND/, route);
  assert.equal(errorCode(new Error('Query read timeout')), 'db_timeout');
  assert.equal(errorCode(new Error('snapshot shape')), 'bad_snapshot');
});

// ---- transport: 304s make unchanged rows nearly free; CORS ----

test('ETag: unchanged rows answer 304; a new alert changes the ETag; gzip on request', async () => {
  let rows = [ROW];
  const h = harness({ reader: (clock) => snapshot({ rows, dbNow: clock }) });
  await h.svc.readOnce();
  const a = call(h.svc, '/drops.json');
  assert.equal(a.status, 200);
  assert.equal(call(h.svc, '/drops.json', { 'if-none-match': a.headers.ETag }).status, 304);
  h.tick(30_000); await h.svc.readOnce();                       // same rows, new read
  assert.equal(call(h.svc, '/drops.json', { 'if-none-match': a.headers.ETag }).status, 304);
  rows = [ROW, { ...ROW, id: 'superbet-9', book: 'Superbet' }];
  h.tick(30_000); await h.svc.readOnce();
  const b = call(h.svc, '/drops.json', { 'if-none-match': a.headers.ETag, 'accept-encoding': 'gzip, br' });
  assert.equal(b.status, 200);
  assert.equal(b.headers['Content-Encoding'], 'gzip');
  assert.equal(JSON.parse(zlib.gunzipSync(b.body)).rows.length, 2);
  assert.equal(JSON.parse(call(h.svc, '/status.json').body).rowsEtag, b.headers.ETag, 'status.json names the current rowsEtag');
});

test('CORS: the Pages origin is echoed; any other origin gets no allow header', async () => {
  const h = harness();
  await h.svc.readOnce();
  assert.equal(call(h.svc, '/status.json', { origin: 'https://michaeldk1996.github.io' }).headers['Access-Control-Allow-Origin'], 'https://michaeldk1996.github.io');
  assert.equal(call(h.svc, '/status.json', { origin: 'https://evil.example' }).headers['Access-Control-Allow-Origin'], undefined);
  assert.equal(call(h.svc, '/drops.json', {}, 'POST').status, 405);
});

test('status.json max-age never outlives the next read', async () => {
  const h = harness();
  await h.svc.readOnce();
  h.svc.state.nextReadAtMs = T0 + 12_400;
  assert.match(call(h.svc, '/status.json').headers['Cache-Control'], /max-age=12$/);
});

// ---- the SQL: rows are the bots' live alerts, read-only, no vendor calls, no public grant ----

test('snapshot SQL: live bot alerts only, security definer with a pinned search_path, no anon grant, no vendor call', () => {
  const sql = read('tools/ten294-drops-api.sql').replace(/--.*$/gm, '');
  assert.match(sql, /from ten280_bot\.alerts a[\s\S]*?where a\.mode = 'live'/);
  assert.match(sql, /from ten287_bot\.alerts a[\s\S]*?where a\.mode = 'live'/);
  assert.match(sql, /security definer\s+set search_path = pg_catalog, pg_temp/);
  assert.match(sql, /revoke all on function drops_api\.snapshot\(integer\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function drops_api\.snapshot\(integer\) to drops_reader/);
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated|public)\b/i);
  assert.doesNotMatch(sql, /net\.http_|http_(get|post)|insert into|update ten2|delete from/i);
});

test('snapshot SQL is cheap at 2 reads/min: no bot loader calls (they full-scan), started time-gated, watermarks on indexes', () => {
  const sql = read('tools/ten294-drops-api.sql').replace(/--.*$/gm, '');
  assert.doesNotMatch(sql, /load_ticks\s*\(/, 'a bot loader full-scans kibl_line_observations + kibl_now_history');
  // Latest keeps the loaders' filters: Bet105 poller = feed 171, ML, full match, not live, >= 1.01; Superbet = pending
  assert.match(sql, /o\.feed_source_id = 171 and o\.betting_type_id = 1\s+and o\.is_live is false and o\.price_decimal >= 1\.01/);
  assert.match(sql, /o\.price_decimal >= 1\.01 and o\.inserted_on is not null/, 'a row with no clock never wins "latest"');
  // stream side = load_ticks' mapping: row_key -> poller side_id first, surname key only as the fallback
  assert.match(sql, /select o\.side_id from public\.kibl_line_observations o where o\.row_key = hr\.row_key/);
  assert.match(sql, /when ten280_bot\.skey\(fx\.player1_name\) = ten280_bot\.skey\(fx\.player2_name\) then null/, 'same surname -> never guess');
  assert.match(sql, /p\.fixture_id = a\.fixture_id and p\.feed_source_id = 171/, 'stream latest is Bet105 only');
  assert.match(sql, /coalesce\(k\.event_status, ev\.status\) = 'pending'/);
  // "started" = live evidence only, and the Kibl scan runs only near the scheduled time
  assert.match(sql, /'started', case when fx\.scheduled_start is null then null\s+when fx\.scheduled_start > v_now \+ interval '3 hours' then false\s+else exists \(select 1 from public\.kibl_line_observations o\s+where o\.fixture_id = a\.fixture_id and o\.is_live is true\) end/);
  assert.match(sql, /'started', coalesce\(ev\.status in \('live', 'settled', 'finished', 'ended'\), false\)/);
  assert.doesNotMatch(sql, /status <> 'pending'/, 'cancelled / postponed are not "started"');
  // the poller watermark moves on every sweep (last_seen_at), not only on a new price (observed_at); `is not null`
  // + plain desc so the ascending index serves it backwards (a `nulls last` sort is a full sort). The PLAN is
  // checked in the database by tools/ten294-steps-install.json (plan_* steps) — a regex cannot see a plan.
  assert.match(sql, /select o\.last_seen_at from public\.kibl_line_observations o\s+where o\.feed_source_id = 171 and o\.last_seen_at is not null\s+order by o\.last_seen_at desc limit 1/);
  assert.doesNotMatch(sql, /nulls last/);
  const steps = JSON.parse(read('tools/ten294-steps-install.json')).map((x) => x.name);
  for (const n of ['plan_poller_watermark', 'plan_poller_latest', 'plan_started', 'plan_superbet_latest']) assert.ok(steps.includes(n), n);
});

test('watchdog SQL: safe JSON cast, anti-flap recovery, send back-off, own vault names, not scheduled by the install', () => {
  const sql = read('tools/ten294-drops-watchdog.sql').replace(/--.*$/gm, '');
  assert.match(sql, /body = drops_watch\.try_jsonb\(r\.content\)/);
  assert.match(sql, /exception when others then\s+return null;/);
  assert.doesNotMatch(sql, /r\.content::jsonb/, 'a raw cast raises on a bad body and rolls back every tick');
  assert.match(sql, /recover_n\s+integer not null default 3/);
  assert.match(sql, /return 'holding';/);
  assert.match(sql, /backoff_after/);
  assert.match(sql, /'ten294_telegram_bot_token'/);
  assert.match(sql, /'ten294_telegram_chat_id'/);
  assert.doesNotMatch(sql, /cron\.schedule/, 'the install never starts the watchdog; scheduling is a separate explicit step');
  // state compares the condition KIND, never the detail text (ages change every tick -> an alert a minute)
  assert.match(sql, /v_kind := split_part\(cond, ':', 1\)/);
  assert.match(sql, /if v_kind is distinct from st\.condition then/);
});

test('watchdog arming: own vault names from the drop-alert chat, scheduled once, test ping must be CONFIRMED sent', () => {
  const steps = JSON.parse(read('tools/ten294-steps-watchdog.json'));
  const by = Object.fromEntries(steps.filter((x) => x.name).map((x) => [x.name, x]));
  assert.equal(by.vault_tg_token.vault_name, 'ten294_telegram_bot_token');
  assert.equal(by.vault_tg_chat.vault_name, 'ten294_telegram_chat_id');
  assert.equal(by.vault_tg_chat.vault_from_env, 'TELEGRAM_CHAT_ID', 'the drop alerts\' chat (founder Q5), not the ops chat');
  assert.match(by.schedule.sql, /cron\.schedule\('ten294_drops_watchdog', '\* \* \* \* \*', 'select drops_watch\.tick\(\)'\)/);
  // queued is not delivered: the run goes red unless pg_net saw a 2xx from Telegram
  // and it judges THIS run's ping (the newest), never an earlier run's that is still inside a time window
  for (const n of ['selftest_send', 'selftest_delivered']) {
    assert.equal(by[n].required, true, n);
    assert.match(by[n].sql, /raise exception/, `${n}: a notice returns 2xx and the gate goes vacuous`);
  }
  assert.match(by.selftest_send.sql, /if drops_watch\.send\([^]*\) is null then raise exception/);
  assert.match(by.selftest_delivered.sql, /where kind = 'selftest' order by id desc limit 1\); begin if d is distinct from 'sent' then raise exception/);
  assert.doesNotMatch(by.selftest_delivered.sql, /interval/);
  // one tick must settle the response before the gate reads it (pg_cron every 60 s + the explicit settle tick)
  const iSleep = steps.findIndex((x) => 'sleep' in x);
  assert.ok(steps[iSleep].sleep >= 60, 'sleep >= 60 s');
  const at = (n) => steps.findIndex((x) => x.name === n);
  assert.ok(at('selftest_send') < iSleep && iSleep < at('settle') && at('settle') < at('selftest_delivered'));
  const wf = read('.github/workflows/ten294-drops.yml');
  // flyctl resolves --config against a positional dir -> deploy from the app dir, no positional (run 36220018511)
  assert.match(wf, /working-directory: stennisfy-drops\n\s+run: flyctl deploy --remote-only --config fly\.toml --ha=false --yes\n/);
  assert.match(wf, /watchdog:\n\s+needs: deploy/);
  assert.match(wf, /TELEGRAM_CHAT_ID: \$\{\{ secrets\.TELEGRAM_CHAT_ID \}\}/);
  assert.match(wf, /watchdog NOT installed/, 'never armed against an endpoint that is not up');
});

// ════ The Dropping Odds page (drops-page.js; founder card 79e9db02, drops.md "The Dropping Odds page") ════
// Pure rules drive the REAL module (createRequire); rendering EXECUTES the real file in a vm sandbox with a
// fake document and a fake fetch returning the endpoint's real payload shape — a regex over the source can't
// see what the page renders.
import { createRequire } from 'node:module';
import vm from 'node:vm';
const PAGE = createRequire(import.meta.url)('./drops-page.js');
const PT0 = Date.parse('2026-09-26T12:00:00Z');
const at = (msAgo) => new Date(PT0 - msAgo).toISOString();
const HR = 3600e3;
function frow(o) {
  return { id: o.id, book: o.book || 'Bet105', line: 'Match Winner', tier: o.tier || 'ATP', playerA: o.a || 'Alan Alpha', playerB: o.b || 'Bruno Beta',
    side: o.side || o.a || 'Alan Alpha', open: { at: at(o.openAgo ?? 20 * HR), kind: 'book opener', price: String(o.open) },
    preDrop: { at: at(o.preAgo ?? 2 * HR), price: String(o.pre ?? o.open) }, droppedTo: { at: at(o.dropAgo ?? 1.9 * HR), price: String(o.dropped ?? o.now) },
    latest: { at: at(o.latestAgo ?? 1 * HR), price: String(o.now) }, dropPct: o.botPct ?? 6, sinceOpenPct: 0, detectedAt: at(o.detAgo ?? 1.9 * HR),
    started: o.started ?? false, pastScheduledStart: false, scheduledStart: o.start ?? at(-3 * HR) };
}

test('page Q1: one row per selection x book, drop = (open - latest)/open, shortened only, never the bot figure', () => {
  const rows = PAGE.buildRows([
    frow({ id: 'a1', open: 2.0, now: 1.8, botPct: 99, detAgo: 5 * HR }),
    frow({ id: 'a2', open: 2.0, now: 1.8, botPct: 7, detAgo: 1 * HR }),          // repeat alert, same selection x book
    frow({ id: 'b1', book: 'Superbet', open: 2.0, now: 1.9 }),                     // same selection, other book: own row
    frow({ id: 'c1', a: 'Cid Gamma', b: 'Dan Delta', side: 'Cid Gamma', open: 1.59, now: 2.02 }),  // lengthened: not listed
    frow({ id: 'd1', a: 'Eli Eps', b: 'Fox Zeta', side: 'Eli Eps', open: 1.5, now: 1.5 }),         // flat: not listed
  ]);
  assert.deepEqual(rows.map((r) => r.id).sort(), ['a2', 'b1'], 'newest alert wins; lengthened and flat rows are not listed');
  const a = rows.find((r) => r.id === 'a2');
  assert.equal(a.drop.toFixed(1), '10.0');
  assert.notEqual(a.drop, 7, 'the bot figure is never the drop');
  assert.equal(rows.find((r) => r.id === 'b1').drop.toFixed(1), '5.0');
  // a row with no open or no latest is not listed (never a guessed price)
  assert.equal(PAGE.buildRows([{ ...frow({ id: 'x', open: 2, now: 1.8 }), open: null }]).length, 0);
  assert.equal(PAGE.buildRows([{ ...frow({ id: 'y', open: 2, now: 1.8 }), latest: { at: null, price: null } }]).length, 0);
});

test('page Q2: "Since open" = everything the feed holds; 12h/24h cut on detectedAt; 48h is disabled in the markup', async () => {
  const rows = PAGE.buildRows([frow({ id: 'r1', open: 2, now: 1.8, detAgo: 2 * HR }), frow({ id: 'r2', a: 'Gus Eta', b: 'Hal Theta', side: 'Gus Eta', open: 3, now: 2.5, detAgo: 20 * HR })]);
  const S = PAGE.defaults();
  const ids = (win) => PAGE.view(rows, { ...S, win }, PT0).list.map((r) => r.id).sort().join();
  assert.equal(S.win, 'open');
  assert.equal(ids('open'), ids('24h'), 'Since open and 24h hold the same rows while the feed keeps 24h');
  assert.equal(ids('12h'), 'r1');
  const html = (await renderPage({ rows: [frow({ id: 'r1', open: 2, now: 1.8 })] })).html;
  assert.match(html, /data-act="win" data-v="48h" disabled/);
  assert.match(html, /data-act="win" data-v="open"[^>]*title="Everything the feed holds: the last 24h of flagged moves"/);
});

test('page BOOKS: Sharp/Soft is odds.md\'s ruled table, not a guess', () => {
  const odds = read('.claude/rules/odds.md');
  for (const [book, cls] of Object.entries(PAGE.BOOK_CLASS)) {
    const m = odds.match(new RegExp('\\|\\s*' + book + '\\s*\\|\\s*(Sharp|Soft)\\s*\\|'));
    assert.ok(m, `${book} is in odds.md's table`);
    assert.equal(m[1].toLowerCase(), cls, book);
  }
  const rows = PAGE.buildRows([frow({ id: 's1', open: 2, now: 1.8 }), frow({ id: 's2', book: 'Superbet', a: 'Ivo Iota', b: 'Jon Kappa', side: 'Ivo Iota', open: 2, now: 1.7 })]);
  const only = (btype) => PAGE.view(rows, { ...PAGE.defaults(), btype }, PT0).list.map((r) => r.book).join();
  assert.equal(only('sharp'), 'Bet105');
  assert.equal(only('soft'), 'Superbet');
});

test('page: a started match sorts last in every order; tier maps ITF Men -> ITF', () => {
  const rows = PAGE.buildRows([
    frow({ id: 'st', a: 'Big Drop', b: 'Opp One', side: 'Big Drop', open: 4, now: 2, started: true, start: at(1 * HR) }),
    frow({ id: 'n1', a: 'Small Drop', b: 'Opp Two', side: 'Small Drop', open: 2, now: 1.9, tier: 'ITF Men', start: at(-1 * HR) }),
  ]);
  for (const sort of ['drop', 'recent', 'soon']) {
    const l = PAGE.view(rows, { ...PAGE.defaults(), sort }, PT0).list;
    assert.equal(l.at(-1).id, 'st', sort);
  }
  assert.equal(rows.find((r) => r.id === 'n1').tier, 'ITF');
  assert.equal(PAGE.tierOf('WTA 250'), null);
});

test('page staleness: green <= 90 s, amber past 90 s, disconnected past 5 min or unreachable', () => {
  assert.equal(PAGE.feedState(90, true), 'connected');
  assert.equal(PAGE.feedState(91, true), 'amber');
  assert.equal(PAGE.feedState(300, true), 'amber');
  assert.equal(PAGE.feedState(301, true), 'disconnected');
  assert.equal(PAGE.feedState(5, false), 'disconnected');
  assert.equal(PAGE.feedState(null, true), 'disconnected');
});

test('page Q4 chart: recorded prices only, last 24h, dashed across gaps, nothing interpolated', () => {
  const [r] = PAGE.buildRows([frow({ id: 'c', open: 2.5, now: 2.0, openAgo: 30 * HR, pre: 2.3, preAgo: 8 * HR, dropped: 2.1, dropAgo: 7.9 * HR, latestAgo: 0.5 * HR })]);
  const pts = PAGE.chartPoints(r, PT0);
  assert.deepEqual(pts.map((p) => p.kind), ['pre', 'dropped', 'latest'], 'the 30h-old open is off the 24h axis');
  const svg = PAGE.chartSvg(pts, r.open);
  assert.equal((svg.match(/<circle/g) || []).length, 3, 'one dot per recorded price, none invented');
  assert.equal((svg.match(/class="do-gap"/g) || []).length, 1, 'the 7.4h stretch (> 15% of the axis) is dashed');
  assert.equal((svg.match(/class="do-seg-l"/g) || []).length, 1, 'the 6-min drop is a solid segment');
  assert.match(svg, /class="do-open-ref"/, 'the open level is still marked');
  // duplicates (same time and price) collapse to one dot
  const [d] = PAGE.buildRows([frow({ id: 'd', open: 2, now: 1.8, dropped: 1.8, dropAgo: 1 * HR, latestAgo: 1 * HR })]);
  assert.equal(PAGE.chartPoints(d, PT0).filter((p) => p.v === 1.8).length, 1);
});

test('page avatars: a board key only on an exact, unique two-player match', () => {
  const r = { playerA: 'Daniil Medvedev', playerB: 'Valentin Royer', side: 'Daniil Medvedev' };
  const card = { p1: 'D. Medvedev', p2: 'V. Royer', p1Key: 1093, p2Key: 954 };
  assert.deepEqual(PAGE.boardKeyFor(r, [card]), { key: '1093', photoName: 'D. Medvedev' });
  assert.equal(PAGE.boardKeyFor({ ...r, side: 'Valentin Royer' }, [card]).key, '954');
  assert.equal(PAGE.boardKeyFor(r, [card, { ...card }]), null, 'two matching cards: no guess');
  assert.equal(PAGE.boardKeyFor(r, [{ ...card, p2: 'X. Other' }]), null, 'one player matching is not a match');
});

test('page: no placeholder from the export ships', () => {
  const src = read('drops-page.js') + read('drops-page.css');
  for (const bad of ['Morita', 'Beleza', 'Brandt', 'Ferrante', 'Keller', 'Voss', 'Sorokin', 'randomuser', 'ILLUSTRATIVE', 'Monteverde', 'Kestrel']) {
    assert.ok(!src.includes(bad), bad);
  }
  assert.doesNotMatch(src, /Book [A-G]\b/);
});

// ── executing the real page ──
async function renderPage({ rows, ageS = 12, reachable = true, board = [], statusExtra = {}, mk = null, leave = false }) {
  const root = { innerHTML: '', addEventListener() {}, closest: () => ({ classList: { contains: () => false } }), querySelector: () => null };
  const btn = { style: { display: 'none' } };
  const timers = [];
  const status = { schema: 1, generatedAt: new Date(PT0 - ageS * 1000).toISOString(), serverNow: new Date(PT0).toISOString(), ageS, freshness: ageS > 300 ? 'paused' : 'ok', rowCount: rows.length, sources: [], ...statusExtra };
  const res = (body) => ({ status: 200, ok: true, headers: { get: () => '"e1"' }, json: async () => body });
  const sandbox = {
    document: { readyState: 'complete', getElementById: (id) => (id === 'dropsRoot' ? root : id === 'dropsTabBtn' ? btn : null), querySelector: () => null,
      addEventListener() {}, activeElement: null, body: { appendChild() {} }, createElement: () => ({ style: { setProperty() {} } }) },
    location: { search: '' }, localStorage: { getItem: () => null }, URLSearchParams,
    fetch: async (url) => { if (!reachable) throw new Error('down'); return res(url.endsWith('/status.json') ? status : { schema: 1, windowHours: 24, rows }); },
    setTimeout: (f, ms) => { timers.push(ms); return timers.length; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [PT0])); } static now() { return PT0; } },
    Promise, JSON, Math, String, Number, Object, Array, isFinite, parseFloat, RegExp, Error, matches: board,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(read('drops-page.js'), sandbox);
  if (mk) sandbox.window.DropsPage._state.S.mk = mk;
  sandbox.window.DropsPage.setActive(true);
  let timersAfterLeave = null;
  if (leave) { sandbox.window.DropsPage.setActive(false); const n = timers.length; for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); timersAfterLeave = timers.slice(n); }
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  return { html: root.innerHTML, btn, timers, timersAfterLeave };
}

test('page render: live rows from the feed, market tabs honest, alerts disabled, sidebar revealed', async () => {
  const { html, btn, timers } = await renderPage({ rows: [
    frow({ id: 'r1', open: 2.62, now: 1.97 }),
    frow({ id: 'r2', a: 'Cid Gamma', b: 'Dan Delta', side: 'Cid Gamma', open: 1.59, now: 2.02 }),   // lengthened: absent
  ] });
  assert.equal(btn.style.display, '', 'FEATURE_DROPS on by default reveals the sidebar button');
  assert.equal((html.match(/class="do-row"/g) || []).length, 1);
  assert.match(html, /<span class="do-fig-n">24\.8<span class="do-fig-p">%<\/span>/, '(2.62 - 1.97) / 2.62');
  assert.match(html, /<span class="do-px-o">2\.62<\/span><span class="do-px-a">→<\/span><span class="do-px-n">1\.97<\/span>/);
  assert.match(html, /1 move across 1 match/);
  assert.match(html, /Match winner<span class="do-tab-n">1<\/span>/);
  for (const m of ['Set handicap', 'Game handicap', 'Total games', 'Total sets']) {
    assert.match(html, new RegExp(m + '<span class="do-tab-n">—</span>'), `${m}: untracked is "—", never 0`);
  }
  assert.match(html, /Live · updated 12s ago/);
  assert.doesNotMatch(html, /FEED DISCONNECTED/);
  assert.match(html, /do-btn-alerts" aria-disabled="true" title="Coming soon"/);
  assert.match(html, /data-act="menu" data-v="surf" aria-disabled="true"/);
  assert.match(html, /placeholder="Search players"/);
  assert.ok(timers.includes(30000), 'polls on the endpoint\'s own 30 s cadence');
  assert.doesNotMatch(html, /ILLUSTRATIVE|illustrative/);
});

test('page render: past 5 min the export\'s banner as drawn, dimmed rows, "as of" in UTC; unreachable too', async () => {
  const stale = (await renderPage({ rows: [frow({ id: 'r1', open: 2, now: 1.8 })], ageS: 12 * 60 })).html;
  assert.match(stale, /FEED DISCONNECTED/);
  assert.match(stale, /Showing prices as of <span class="do-mono">11:48 UTC<\/span>\. New moves will not appear until the feed reconnects\./);
  assert.match(stale, /class="do-list stale"/);
  assert.match(stale, /Prices updated <span class="do-mono">12 min<\/span> ago/);
  assert.doesNotMatch(stale, /Live · updated/, 'never a fake-fresh line');
  const amber = (await renderPage({ rows: [frow({ id: 'r1', open: 2, now: 1.8 })], ageS: 120 })).html;
  assert.match(amber, /do-dot amber/);
  assert.doesNotMatch(amber, /FEED DISCONNECTED/);
  const down = (await renderPage({ rows: [], reachable: false })).html;
  assert.match(down, /FEED DISCONNECTED/);
  assert.doesNotMatch(down, /class="do-row"/);
});

// ── review folds (clean-context review of 8c441ec4): each test kills a mutation that survived ──
test('page render: endpoint down before any read -> dashes and the banner, never zeros or a "no moves" claim', async () => {
  const { html } = await renderPage({ rows: [], reachable: false });
  assert.match(html, /data-k="drops">—</);
  assert.match(html, /All markets<span class="do-tab-n">—<\/span>/);
  assert.match(html, /Match winner<span class="do-tab-n">—<\/span>/);
  assert.doesNotMatch(html, /No moves above your threshold/);
  assert.doesNotMatch(html, /do-tab-n">0</);
  assert.doesNotMatch(html, /data-k="drops">0</);
  assert.match(html, /FEED DISCONNECTED/);
});

test('page render: an untracked market shows dashes in the header and count, never 0', async () => {
  const out = await renderPage({ rows: [frow({ id: 'r1', open: 2, now: 1.8 })], mk: ['sh'] });
  assert.match(out.html, /data-k="drops">—</);
  assert.match(out.html, /<span class="do-count">—<\/span>/);
  assert.match(out.html, /No drops on this market/);
});

test('page render: every feed string is escaped', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const { html } = await renderPage({ rows: [frow({ id: 'x"1', a: evil, b: 'Bob <b>', side: evil, open: 2, now: 1.8, book: 'Bet105' })] });
  assert.ok(!html.includes('<img src=x'), 'raw markup from the feed reached the page');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; to win/);
  assert.match(html, /vs Bob &lt;b&gt;/);
});

test('page: polling stops when the tab is left', async () => {
  const out = await renderPage({ rows: [frow({ id: 'r1', open: 2, now: 1.8 })], leave: true });
  assert.equal(out.timersAfterLeave.filter((ms) => ms === 30000).length, 0, 'a 30 s poll was scheduled after setActive(false)');
});

test('page: "Starts within" means an upcoming start; "Starting soonest" puts passed starts after upcoming ones', () => {
  const rows = PAGE.buildRows([
    frow({ id: 'past', a: 'Past One', b: 'Opp P', side: 'Past One', open: 3, now: 2, start: at(15 * HR) }),
    frow({ id: 'soon', a: 'Soon One', b: 'Opp S', side: 'Soon One', open: 2, now: 1.9, start: at(-2 * HR) }),
    frow({ id: 'late', a: 'Late One', b: 'Opp L', side: 'Late One', open: 2, now: 1.8, start: at(-10 * HR) }),
  ]);
  const ids = (S) => PAGE.view(rows, { ...PAGE.defaults(), ...S }, PT0).list.map((r) => r.id).join();
  assert.equal(ids({ starts: 3 }), 'soon', 'a match 15 h past its start is not "starting within 3h"');
  assert.equal(ids({ sort: 'soon' }), 'soon,late,past');
});

test('page: the banner time is UTC whatever the viewer\'s timezone', async () => {
  const prev = process.env.TZ;
  process.env.TZ = 'Asia/Singapore';
  try {
    const { html } = await renderPage({ rows: [frow({ id: 'r1', open: 2, now: 1.8 })], ageS: 12 * 60 });
    assert.match(html, /as of <span class="do-mono">11:48 UTC<\/span>/);
  } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
});
