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
  // every file the server needs is in the image: the CA and each relative module server.mjs imports
  const docker = read('stennisfy-drops/Dockerfile'), copied = (docker.match(/^COPY (?!package)(.+) \.\/$/m) || [])[1] || '';
  const need = ['server.mjs', 'supabase-ca-2021.crt', ...[...read('stennisfy-drops/server.mjs').matchAll(/from '\.\/([^']+)'/g)].map((m) => m[1])];
  need.forEach((f) => assert.ok(copied.split(/\s+/).includes(f), f + ' is copied into the image'));
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
  // no vendor "started" flag and no per-fixture is_live scan: status is api-tennis's (card 518c56f0)
  assert.doesNotMatch(sql, /'started'|'pastScheduledStart'|o\.is_live is true/);
  // the poller watermark moves on every sweep (last_seen_at), not only on a new price (observed_at); `is not null`
  // + plain desc so the ascending index serves it backwards (a `nulls last` sort is a full sort). The PLAN is
  // checked in the database by tools/ten294-steps-install.json (plan_* steps) — a regex cannot see a plan.
  assert.match(sql, /select o\.last_seen_at from public\.kibl_line_observations o\s+where o\.feed_source_id = 171 and o\.last_seen_at is not null\s+order by o\.last_seen_at desc limit 1/);
  assert.doesNotMatch(sql, /nulls last/);
  const steps = JSON.parse(read('tools/ten294-steps-install.json')).map((x) => x.name);
  for (const n of ['plan_poller_watermark', 'plan_poller_latest', 'plan_superbet_latest']) assert.ok(steps.includes(n), n);
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
  assert.match(wf, /TELEGRAM_CHAT_ID: \$\{\{ secrets\.TELEGRAM_PIPELINE_CHAT_ID \|\| secrets\.TELEGRAM_CHAT_ID \}\}/);
  assert.match(wf, /watchdog NOT installed/, 'never armed against an endpoint that is not up');
});

// ════ The Dropping Odds page (drops-page.js; founder card 79e9db02, drops.md "The Dropping Odds page") ════
// Pure rules drive the REAL module (createRequire); rendering EXECUTES the real file in a vm sandbox with a
// fake document and a fake fetch returning the endpoint's real payload shape — a regex over the source can't
// see what the page renders.
import { createRequire } from 'node:module';
import vm from 'node:vm';
const PAGE = createRequire(import.meta.url)('./drops-page.js');
// TEN-427 Data 6: the page's clocks read the member's zone (stennisfy.tz via newsTz); these tests set it to UTC
globalThis.newsTz = () => 'UTC';
const PT0 = Date.parse('2026-09-26T12:00:00Z');
const at = (msAgo) => new Date(PT0 - msAgo).toISOString();
const HR = 3600e3;
function frow(o) {
  return { id: o.id, book: o.book || 'Bet105', line: 'Match Winner', tier: o.tier || 'ATP', playerA: o.a || 'Alan Alpha', playerB: o.b || 'Bruno Beta',
    side: o.side || o.a || 'Alan Alpha', open: { at: at(o.openAgo ?? 20 * HR), kind: 'book opener', price: String(o.open) },
    preDrop: { at: at(o.preAgo ?? 2 * HR), price: String(o.pre ?? o.open) }, droppedTo: { at: at(o.dropAgo ?? 1.9 * HR), price: String(o.dropped ?? o.now) },
    latest: { at: at(o.latestAgo ?? 1 * HR), price: String(o.now) }, dropPct: o.botPct ?? 6, sinceOpenPct: 0, detectedAt: at(o.detAgo ?? 1.9 * HR),
    started: o.started ?? false, pastScheduledStart: false, scheduledStart: o.start ?? at(-3 * HR), ...(o.match ? { match: o.match } : {}) };
}





test('page staleness: green <= 90 s, amber past 90 s, disconnected past 5 min or unreachable', () => {
  assert.equal(PAGE.feedState(90, true), 'connected');
  assert.equal(PAGE.feedState(91, true), 'amber');
  assert.equal(PAGE.feedState(300, true), 'amber');
  assert.equal(PAGE.feedState(301, true), 'disconnected');
  assert.equal(PAGE.feedState(5, false), 'disconnected');
  assert.equal(PAGE.feedState(null, true), 'disconnected');
});

// TEN-301: the vertices of a step line, as numbers
const stepPts = (pl) => pl.split(' ').map((p) => p.split(',').map(Number));



// TEN-376 Foundation: the 8585095a named values are now read through tokens.css — red = --neg (a drop is a signed value),
// the small drop --neg at 75%, the flat tint --neg at 10%, muted --text-label; the box surface --card.


test('page avatars: a board key only on an exact, unique two-player match', () => {
  const r = { playerA: 'Daniil Medvedev', playerB: 'Valentin Royer', side: 'Daniil Medvedev' };
  const card = { p1: 'D. Medvedev', p2: 'V. Royer', p1Key: 1093, p2Key: 954 };
  const hit = PAGE.boardKeyFor(r, [card]);
  assert.equal(hit.key, '1093'); assert.equal(hit.photoName, 'D. Medvedev');
  assert.equal(hit.card, card, 'the matched card itself (the pop-up reads its metadata)'); assert.equal(hit.cardSide, 'p1');
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
// Dropping Odds v2 (2026-11-23): a selection's books come from the endpoint's lines; each test row stands for one book's
// recorded first price and price now on its side of the match
const linesOf = (rows) => rows.map((r) => ({ key: '', playerA: r.playerA, playerB: r.playerB, side: r.side,
  books: { [r.book]: { side: [[r.open.at, +r.open.price], [r.latest.at, +r.latest.price]], other: [], lastSeen: r.latest.at } } }));
async function renderPage({ rows, ageS = 12, reachable = true, board = [], statusExtra = {}, mk = null, leave = false, tz = 'UTC' }) {
  const root = { innerHTML: '', addEventListener() {}, closest: () => ({ classList: { contains: () => false } }), querySelector: () => null };
  const btn = { style: { display: 'none' } };
  const timers = [];
  const status = { schema: 1, generatedAt: new Date(PT0 - ageS * 1000).toISOString(), serverNow: new Date(PT0).toISOString(), ageS, freshness: ageS > 300 ? 'paused' : 'ok', rowCount: rows.length, sources: [], ...statusExtra };
  const res = (body) => ({ status: 200, ok: true, headers: { get: () => '"e1"' }, json: async () => body });
  const sandbox = {
    document: { readyState: 'complete', getElementById: (id) => (id === 'dropsRoot' ? root : id === 'dropsTabBtn' ? btn : null), querySelector: () => null,
      addEventListener() {}, activeElement: null, body: { appendChild() {} }, createElement: () => ({ style: { setProperty() {} } }) },
    location: { search: '' }, localStorage: { getItem: () => null }, URLSearchParams,
    fetch: async (url) => { if (!reachable) throw new Error('down'); return res(url.endsWith('/status.json') ? status : { schema: 1, windowHours: 24, rows, lines: linesOf(rows) }); },
    setTimeout: (f, ms) => { timers.push(ms); return timers.length; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [PT0])); } static now() { return PT0; } },
    Promise, JSON, Math, String, Number, Object, Array, isFinite, parseFloat, RegExp, Error, matches: board, newsTz: () => tz, addEventListener() {},
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



// ── review folds (clean-context review of 8c441ec4): each test kills a mutation that survived ──


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



// ── second review (of eac4f55b): lock every fix, in a sandbox that keeps the modal and the key handler ──
function pageSandbox({ feed, windowHours = 24, hang = false, ageS = 12 }) {
  const root = { innerHTML: '', addEventListener() {}, closest: () => ({ classList: { contains: () => false } }), querySelector: () => null };
  const overlay = { writes: 0, _h: '', style: { setProperty() {} }, className: '', id: '', remove() { overlay.gone = true; }, querySelector: () => null };
  Object.defineProperty(overlay, 'innerHTML', { get: () => overlay._h, set: (v) => { overlay.writes += 1; overlay._h = v; } });
  let mounted = false; const keys = [];
  const status = () => ({ schema: 1, generatedAt: new Date(PT0 - ageS * 1000).toISOString(), serverNow: new Date(PT0).toISOString(), ageS, freshness: 'ok', sources: [] });
  const res = (body) => ({ status: 200, ok: true, headers: { get: () => '"e1"' }, json: async () => body });
  const sandbox = {
    document: { readyState: 'complete', activeElement: null, querySelector: () => null,
      getElementById: (id) => (id === 'dropsRoot' ? root : id === 'doOverlay' ? (mounted ? overlay : null) : null),
      addEventListener: (t, f) => { if (t === 'keydown') keys.push(f); },
      body: { appendChild: () => { mounted = true; } }, createElement: () => overlay },
    location: { search: '' }, localStorage: { getItem: () => null }, URLSearchParams,
    fetch: (url) => (hang ? new Promise(() => {}) : Promise.resolve(res(url.endsWith('/status.json') ? status() : { schema: 1, windowHours, rows: feed() }))),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [PT0])); } static now() { return PT0; } },
    Promise, JSON, Math, String, Number, Object, Array, isFinite, parseFloat, RegExp, Error, matches: [], newsTz: () => 'UTC',
  };
  sandbox.window = sandbox;
  vm.runInNewContext(read('drops-page.js'), sandbox);
  const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
  const P = sandbox.window.DropsPage;
  return { P, st: P._state, root, overlay, keys, flush, activate: async () => { P.setActive(true); await flush(); } };
}









// ════ Price-move pop-up rebuild (founder comment 777a3192: decisions 1–7) ════
const SHARD_CHART = { books: {
  'Pinnacle +30s': { p1: [[at(20 * HR), 3.32], [at(2 * HR), 3.06]], p2: [[at(20 * HR), 1.35], [at(2 * HR), 1.42]] },
  // the shard's first Bet105 price (3.40) differs from the alert's open (3.30): the own book must read as its list row
  Bet105: { p1: [[at(20 * HR), 3.40], [at(3 * HR), 3.05]], p2: [[at(20 * HR), 1.36], [at(3 * HR), 1.43]] },
  Superbet: { p1: [[at(10 * HR), 2.85], [at(1 * HR), 2.82]], p2: [[at(10 * HR), 1.40], [at(1 * HR), 1.42]] },
  'Betfair Exchange (recorded by us)': { p1: [[at(9 * HR), 3.00], [at(1 * HR), 3.15]], p2: [[at(9 * HR), 1.49], [at(1 * HR), 1.46]] },
}, meta: {} };
const MROW = frow({ id: 'bet105-9', a: 'Adrian Mannarino', b: 'Denis Shapovalov', side: 'Adrian Mannarino', open: 3.3, now: 3.05, latestAgo: 3 * HR });




test('pop-up SQL: pre-match = pending AND before the first non-pending sighting; ambiguous joins dropped; ids on their indexes', () => {
  const sql = read('tools/ten294-drops-lines.sql').replace(/--.*$/gm, '');
  assert.match(sql, /t\.event_status is distinct from 'pending'/);
  assert.match(sql, /\(lf\.at is null or t\.book_updated_at < lf\.at\)/);
  assert.match(sql, /o\.is_live is false/);
  assert.equal((sql.match(/case when count\(\*\) = 1 then min\(/g) || []).length, 2, 'exactly one candidate at each vendor, never a guess');
  assert.match(sql, /prev is distinct from px/, 'same-price re-stamps collapse');
  assert.doesNotMatch(sql, /_id::text/, 'a text cast on an id defeats its index');
  assert.doesNotMatch(sql, /= any \(\(select/, 'the x = any((select arr)) trap');
  assert.match(read('tools/ten294-drops-api.sql'), /'lines', drops_api\.lines\(p_hours\)/);
  const steps = JSON.parse(read('tools/ten294-steps-install.json')).map((x) => x.name);
  assert.ok(steps.indexOf('install_lines') < steps.indexOf('install'), 'lines installed before the snapshot that calls it');
  for (const n of ['lines_grants', 'lines_plan', 'lines_time']) assert.ok(steps.includes(n), n);
});

test('pop-up endpoint: /drops.json carries the snapshot\'s lines, and an older snapshot without them serves []', async () => {
  const lines = [{ key: 'a|b|a', books: { Superbet: { first: [iso(1000), 2], side: [], other: [] } } }];
  const h = harness({ reader: (clock) => ({ ...snapshot({ dbNow: clock }), lines }) });
  await h.svc.readOnce();
  assert.deepEqual(JSON.parse(call(h.svc, '/drops.json').body).lines, lines);
  const h2 = harness();
  await h2.svc.readOnce();
  assert.deepEqual(JSON.parse(call(h2.svc, '/drops.json').body).lines, []);
});

// executing the real pop-up: matched (shard + board metadata + link) and unmatched (dashes, no link)
async function openPopup({ rows, board = [], lines = [], chart = null, elo = null }) {
  const overlay = { writes: 0, _h: '', style: { setProperty() {} }, remove() {}, querySelector: () => null };
  Object.defineProperty(overlay, 'innerHTML', { get: () => overlay._h, set: (v) => { overlay.writes += 1; overlay._h = v; } });
  let mounted = false;
  const root = { innerHTML: '', addEventListener() {}, closest: () => ({ classList: { contains: () => false } }), querySelector: () => null };
  const status = { schema: 1, generatedAt: new Date(PT0 - 10000).toISOString(), serverNow: new Date(PT0).toISOString(), ageS: 10, freshness: 'ok', sources: [] };
  const res = (body) => ({ status: 200, ok: true, headers: { get: () => '"e1"' }, json: async () => body });
  const sandbox = {
    document: { readyState: 'complete', activeElement: null, querySelector: () => null, addEventListener() {},
      getElementById: (id) => (id === 'dropsRoot' ? root : id === 'doOverlay' ? (mounted ? overlay : null) : null),
      body: { appendChild: () => { mounted = true; } }, createElement: () => overlay },
    location: { search: '' }, localStorage: { getItem: () => null }, URLSearchParams,
    fetch: async (url) => res(url.endsWith('/status.json') ? status : { schema: 1, windowHours: 24, rows, lines }),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [PT0])); } static now() { return PT0; } },
    Promise, JSON, Math, String, Number, Object, Array, isFinite, parseFloat, RegExp, Error,
    matches: board, newsTz: () => 'UTC',
    ensureOddsMovement: async (m) => { m.oddsMovement = chart ? { chart } : null; m._oddsLoaded = true; return m; },
    eloRatings: elo || { ratings: {} },
    psEloFor: (e, name) => { const p = String(name).toLowerCase().split(' '); return e.ratings[p[p.length - 1] + '|' + p[0][0]] ?? null; },
    roundBadgeText: (r) => (/quarter/i.test(r || '') ? 'QF' : null),
    openAnalysisModal: () => {},
  };
  sandbox.window = sandbox;
  vm.runInNewContext(read('drops-page.js'), sandbox);
  const P = sandbox.window.DropsPage;
  P.setActive(true);
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  return { P, overlay, open: async (id) => { P._state.drawer = id; P.setActive(true); for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); return overlay._h; } };
}






test('pop-up review 2: the SQL rules sit in the step that uses them (block comments stripped, not just --)', () => {
  const sql = read('tools/ten294-drops-lines.sql').replace(/\/\*[^]*?\*\//g, '').replace(/--.*$/gm, '');
  const cte = (name, next) => sql.slice(sql.indexOf(name + ' as ('), sql.indexOf(next + ' as ('));
  assert.match(cte('ko', 'pts'), /and o\.side_id in \(2, 3\)/, 'the side filter is in the Bet105 step itself');
  assert.match(cte('per_side', 'per_book'), /filter \(where rn <= 1000\)[\s\S]*count\(\*\) > 1000 truncated/, 'the whole-life rule and its truncation flag are in the series step');
  assert.match(cte('seen', 'per_book'), /select k1, k2, ks, book, max\(seen\) last_seen from pts group by 1, 2, 3, 4/, 'lastSeen = every sighting, one grouped pass');
  assert.match(cte('per_book', 'books'), /'lastSeen', max\(sn\.last_seen\)/);
  assert.match(cte('ko', 'pts'), /coalesce\(o\.last_seen_at, o\.inserted_on\) seen/);
  assert.match(cte('tk', 'ko'), /t\.seen_at seen/);
});

test('overload 2026-10-30: the read is bounded on the server and lines() does each pass once', () => {
  // drops_reader's own statement_timeout: the app's startup option did not bound the reads (17–19 min each, five at
  // a time); the role setting holds whatever the pooler forwards, and fires before the app gives up
  const api = read('tools/ten294-drops-api.sql').replace(/--.*$/gm, '');
  const m = api.match(/alter role drops_reader set statement_timeout = '(\d+)s';/);
  assert.ok(m, 'drops_reader carries its own statement_timeout');
  const cfg = dbConfig('postgresql://u.ref:p@h:5432/postgres', 'CA');
  assert.ok(Number(m[1]) * 1000 < cfg.query_timeout, 'the server stops the read before the app abandons it');
  assert.ok(api.indexOf('alter role drops_reader') > api.indexOf("create role drops_reader"), 'set after the role exists');
  const steps = JSON.parse(read('tools/ten294-steps-install.json'));
  assert.ok(steps.find((x) => x.name === 'reader_timeout' && x.required), 'the install reads the setting back');
  // lines(): measured 7.5 s -> 0.8 s on the live store, output md5-identical at 24 / 48 / 72 h
  const sql = read('tools/ten294-drops-lines.sql').replace(/--.*$/gm, '');
  assert.match(sql, /fx_c as materialized \(/, 'fixtures keyed once, not once per selection');
  assert.match(sql, /ev_c as materialized \(/);
  assert.doesNotMatch(sql, /from pts p where/, 'no re-scan of pts per book (it spilled ~2.3 GB of temp a read)');
  assert.doesNotMatch(sql, /from per_side p where/, 'no correlated per_side scans per book');
  assert.doesNotMatch(sql, /from per_book pb\s+where/, 'no correlated per_book scan per selection');
  assert.match(sql, /left join books b on b\.k1 = s\.k1 and b\.k2 = s\.k2 and b\.ks = s\.ks/);
  assert.match(sql, /'books', coalesce\(b\.books, '\{\}'::jsonb\)/, 'a selection with no book still ships {}');
  // the SQL-only reinstall never touches the Fly app
  const wf = read('.github/workflows/ten294-drops.yml');
  assert.match(wf, /\n  workflow_dispatch:\n/);
  assert.match(wf, /deploy:\n\s+needs: sql\n\s+if: github\.event_name == 'push'\n/, 'deploy (and the watchdog after it) is push-only');
});

test('pop-up review 2: the board date window is ±36 h around noon UTC of the card\'s date (live UTC+2 / Kibl drift cases)', () => {
  const card = (date) => ({ p1: 'H. Gaston', p2: 'A. Rublev', p1Key: 1, p2Key: 2, date });
  const r = (start) => ({ playerA: 'Hugo Gaston', playerB: 'Andrey Rublev', side: 'Hugo Gaston', start });
  assert.ok(PAGE.boardKeyFor(r('2026-09-27T22:00:00Z'), [card('2026-09-27')]), 'the live Kibl drift case (row 27 22:00Z vs card 27)');
  assert.ok(PAGE.boardKeyFor(r('2026-09-26T01:00:00Z'), [card('2026-09-27')]), '35 h before the anchor');
  assert.equal(PAGE.boardKeyFor(r('2026-09-25T23:00:00Z'), [card('2026-09-27')]), null, '37 h before the anchor');
  assert.equal(PAGE.boardKeyFor(r('2026-09-29T01:00:00Z'), [card('2026-09-27')]), null, '37 h after the anchor');
});


test('pop-up review: a board card only counts for the same event (dated within 36 h of the row\'s start)', () => {
  const r = { playerA: 'Daniil Medvedev', playerB: 'Valentin Royer', side: 'Daniil Medvedev', start: '2026-09-26T08:00:00Z' };
  const today = { p1: 'D. Medvedev', p2: 'V. Royer', p1Key: 1, p2Key: 2, date: '2026-09-26' };
  const old = { ...today, date: '2026-09-23' };
  assert.equal(PAGE.boardKeyFor(r, [old]), null, 'three days earlier is another event');
  assert.equal(PAGE.boardKeyFor(r, [old, today]).card, today, 'the old card no longer makes today\'s ambiguous');
});


// ════ Match status + the live cut (founder comment bef04c62, card 518c56f0; drops.md) ════
import * as STATUS from './stennisfy-drops/status.mjs';
import { makeEnrich, WINDOW_HOURS } from './stennisfy-drops/server.mjs';
const Z = (iso) => new Date(iso).toISOString();
const NOW_S = Date.parse('2026-09-26T11:00:00Z');
// the measured cases (TEN-297 doc status-feasibility)
const damm = { id: 'bet105-2027', book: 'Bet105', playerA: 'Martin Damm', playerB: 'Hubert Hurkacz', side: 'Martin Damm', scheduledStart: '2026-09-26T06:55:00+00:00',
  open: { at: '2026-09-24T17:34:00Z', price: '4.02' }, latest: { at: '2026-09-26T06:29:00Z', price: '2.98' },
  preDrop: { at: '2026-09-25T19:30:00Z', price: '3.2' }, droppedTo: { at: '2026-09-25T19:46:00Z', price: '3.0' } };
const singh = { id: 'superbet-39', book: 'Superbet', playerA: 'Karan Singh', playerB: 'Paul Jubb', side: 'Karan Singh', scheduledStart: '2026-09-26T09:00:00+00:00',
  open: { at: '2026-09-25T10:00:00Z', price: '3.55' }, latest: { at: '2026-09-26T08:47:00Z', price: '1.01' },
  preDrop: { at: '2026-09-26T08:40:00Z', price: '1.4' }, droppedTo: { at: '2026-09-26T08:47:00Z', price: '1.01' } };
const flips = [
  { eventKey: '12165854', liveAt: '2026-09-26T06:36:13Z', date: '2026-09-26', time: '08:55', p1: 'M. Damm', p2: 'H. Hurkacz' },
  { eventKey: '12165991', liveAt: '2026-09-26T07:08:16Z', date: '2026-09-26', time: '09:20', p1: 'K. Singh', p2: 'P. Jubb' },
];
const singhLine = { key: 'jubb|singh|singh', playerA: 'Karan Singh', playerB: 'Paul Jubb', side: 'Karan Singh', books: {
  Superbet: { first: ['2026-09-25T10:00:00Z', 3.55], lastSeen: '2026-09-26T09:30:00Z',
    side: [['2026-09-25T10:00:00Z', 3.55], ['2026-09-26T06:50:00Z', 2.85], ['2026-09-26T07:30:00Z', 1.33], ['2026-09-26T08:47:00Z', 1.01]],
    other: [['2026-09-25T10:00:00Z', 1.22], ['2026-09-26T07:30:00Z', 2.9]] },
  'Betfair Exchange': { first: ['2026-09-26T07:20:00Z', 1.5], lastSeen: '2026-09-26T08:00:00Z', side: [['2026-09-26T07:20:00Z', 1.5]], other: [] } } };

test('status: a live sighting + an api-tennis Finished = finished, cut at the live start (Damm)', () => {
  const ctx = { flips, board: new Map(), byKey: new Map([['12165854', { event_status: 'Finished', event_live: '0' }]]), fixtures: null, now: NOW_S };
  const m = STATUS.resolveMatch(damm, ctx);
  assert.equal(m.status, 'finished');
  assert.equal(m.eventKey, '12165854');
  assert.equal(m.cutAt, '2026-09-26T06:36:13Z', 'cut = our first live sighting');
  assert.equal(m.cutKind, 'live');
  // not yet confirmed finished, off the board: in play (it went live), never "not started"
  assert.equal(STATUS.resolveMatch(damm, { ...ctx, byKey: new Map() }).status, 'in_play');
  // on the live board: in play without asking api-tennis
  const onBoard = { ...ctx, byKey: new Map(), board: new Map([['12165854', { status: 'Set 2', live: '1' }]]) };
  assert.equal(STATUS.resolveMatch(damm, onBoard).status, 'in_play');
  assert.deepEqual(STATUS.apiNeeds([damm], onBoard, { keys: new Map() }).keys, [], 'live now: no api-tennis call');
  // the status WORD wins over event_live (a just-finished match reads Finished with event_live 1)
  assert.equal(STATUS.resolveMatch(damm, { ...ctx, byKey: new Map(), board: new Map([['12165854', { status: 'Finished', live: '1' }]]) }).status, 'finished');
});

test('status: the Superbet in-play case (Karan Singh) — every price after 07:08:16Z is cut, the row keeps its last pre-match price', () => {
  const ctx = { flips, board: new Map(), byKey: new Map([['12165991', { event_status: 'Finished' }]]), fixtures: null, now: NOW_S };
  const { rows, lines } = STATUS.withStatus([singh], [singhLine], ctx);
  const r = rows[0];
  assert.equal(r.match.status, 'finished');
  assert.equal(r.latest.price, '2.85', 'the 1.01 at 08:47 was in play; the last pre-match price was 2.85 at 06:50');
  assert.equal(r.latest.at, '2026-09-26T06:50:00Z');
  assert.equal(r.latest.kind, 'last pre-match');
  assert.equal(r.droppedTo, null, 'the alert fired in play: its price is not a pre-match figure');
  assert.equal(r.preDrop, null);
  const sb = lines[0].books.Superbet;
  assert.deepEqual(sb.side.map((p) => p[1]), [3.55, 2.85], 'the chart series stops at the live start');
  assert.deepEqual(sb.other.map((p) => p[1]), [1.22]);
  assert.ok(Date.parse(sb.lastSeen) < Date.parse('2026-09-26T07:08:16Z'), 'lastSeen clamps to the cut');
  assert.equal(lines[0].books['Betfair Exchange'], undefined, 'a book first quoted in play has no pre-match price: out');
});

test('status: a row whose first price is already in play is not a pre-match row (dropped, never shown)', () => {
  const late = { ...singh, id: 'superbet-99', open: { at: '2026-09-26T07:10:00Z', price: '2.0' } };
  const ctx = { flips, board: new Map(), byKey: new Map(), fixtures: null, now: NOW_S };
  assert.equal(STATUS.withStatus([late], [], ctx).rows.length, 0);
});

test('status: no live sighting — not started before the start; after it, api-tennis by date decides (missed sighting); else unknown', () => {
  const up = { ...damm, scheduledStart: '2026-09-26T12:00:00Z' };
  const none = { flips: [], board: new Map(), byKey: new Map(), fixtures: null, now: NOW_S };
  assert.equal(STATUS.resolveMatch(up, none).status, 'not_started');
  assert.deepEqual(STATUS.apiNeeds([up], none, { keys: new Map() }).days, [], 'no call before the start');
  const passed = { ...damm };                                     // 06:55Z, 4 h ago, no sighting
  const u = STATUS.resolveMatch(passed, none);
  assert.equal(u.status, 'unknown', 'api-tennis not read: unknown, never a guess');
  assert.equal(u.cutAt, Z('2026-09-26T06:55:00Z'), 'and CUT at the passed scheduled start: an unknown row never shows in-play prices');
  assert.deepEqual(STATUS.apiNeeds([passed], none, { keys: new Map() }).days, ['2026-09-26'], 'one day per call: the start\'s day');
  // a start within 6 h of midnight UTC also asks the neighbouring day (a vendor start can be early or late across it)
  assert.deepEqual(STATUS.apiNeeds([{ ...damm, scheduledStart: '2026-09-25T23:30:00Z' }], none, { keys: new Map() }).days, ['2026-09-25', '2026-09-26']);
  const fx = [{ event_key: 12165854, event_status: 'Finished', event_live: '0', event_date: '2026-09-26', event_time: '06:55', utc: true, event_first_player: 'M. Damm', event_second_player: 'H. Hurkacz' }];
  const m = STATUS.resolveMatch(passed, { ...none, fixtures: fx });
  assert.equal(m.status, 'finished');
  assert.equal(m.cutKind, 'scheduled', 'the live moment is unknown: cut at the earlier scheduled start');
  assert.equal(m.cutAt, Z('2026-09-26T06:55:00Z'), 'api-tennis\'s start, asked in UTC');
  // the vendor start 1 h EARLIER than api-tennis's: the earlier (conservative) one
  assert.equal(STATUS.resolveMatch({ ...passed, scheduledStart: '2026-09-26T05:55:00Z' }, { ...none, fixtures: fx }).cutAt, Z('2026-09-26T05:55:00Z'));
  // the vendor start 20 h early (a wrong start): api-tennis's, never 20 h of real pre-match prices thrown away
  assert.equal(STATUS.resolveMatch({ ...passed, scheduledStart: '2026-09-25T10:55:00Z' }, { ...none, fixtures: fx }).cutAt, Z('2026-09-26T06:55:00Z'));
  // Cancelled / Postponed: unknown, cut at the passed start
  const cx = STATUS.resolveMatch(passed, { ...none, fixtures: [{ ...fx[0], event_status: 'Cancelled' }] });
  assert.equal(cx.status, 'unknown'); assert.ok(cx.cutAt);
  // two fixtures on the same pair within 24 h: ambiguous, never guessed
  assert.equal(STATUS.resolveMatch(passed, { ...none, fixtures: [...fx, { ...fx[0], event_key: 1 }] }).status, 'unknown');
  // doubles never join
  assert.equal(STATUS.resolveMatch(passed, { ...none, fixtures: [{ ...fx[0], event_first_player: 'M. Damm/X. Y' }] }).status, 'unknown');
});

test('status: the live-sighting join needs both surnames, a start within 24 h and exactly one candidate', () => {
  assert.equal(STATUS.matchFlip(damm, flips).eventKey, '12165854');
  assert.equal(STATUS.matchFlip({ ...damm, scheduledStart: '2026-09-28T07:00:00Z' }, flips), null, '48 h away: another meeting');
  assert.equal(STATUS.matchFlip(damm, [...flips, { ...flips[0], eventKey: '9' }]), 'ambiguous');
  assert.equal(STATUS.resolveMatch(damm, { flips: [...flips, { ...flips[0], eventKey: '9' }], board: new Map(), now: NOW_S }).status, 'unknown');
  // the live Kibl drift case: Kibl 27 22:00Z vs api-tennis 27 04:00+02:00 (20 h) still joins
  assert.equal(STATUS.matchFlip({ playerA: 'Hugo Gaston', playerB: 'Andrey Rublev', scheduledStart: '2026-09-27T22:00:00Z' },
    [{ eventKey: '12166049', liveAt: 'x', date: '2026-09-27', time: '04:00', p1: 'H. Gaston', p2: 'A. Rublev' }]).eventKey, '12166049');
  // compound surname: last token of the surname part on both sides
  assert.ok(STATUS.samePair('Inaki Montes-De La Torre', 'Michael Agwi', 'I. Montes-De La Torre', 'M. Agwi'));
  // both players' initials must agree, every given name counting: "Adolfo Daniel Vallejo" is api-tennis's "D. Vallejo"
  const vf = [{ eventKey: '12165884', liveAt: '2026-09-26T13:20:00Z', date: '2026-09-26', time: '13:30', p1: 'C. Wong', p2: 'D. Vallejo' }];
  const vSb = { id: 'v1', book: 'Superbet', playerA: 'Coleman Wong', playerB: 'Adolfo Daniel Vallejo', side: 'Coleman Wong', scheduledStart: '2026-09-26T11:30:00Z', open: { at: '2026-09-25T10:00:00Z', price: '2.5' }, latest: { at: '2026-09-26T11:00:00Z', price: '2.3' } };
  const vK = { ...vSb, id: 'v2', book: 'Bet105', playerB: 'Adolfo Vallejo', scheduledStart: '2026-09-26T12:15:00Z' };
  assert.equal(STATUS.matchFlip(vSb, vf).eventKey, '12165884');
  assert.equal(STATUS.matchFlip(vK, vf), null, 'the Kibl row names only "Adolfo": alone it is refused, never guessed');
  const vg = STATUS.withStatus([vSb, vK], [], { flips: vf, board: new Map(), byKey: new Map(), fixtures: null, now: Date.parse('2026-09-26T14:00:00Z') }).rows;
  assert.deepEqual(vg.map((r) => r.match.eventKey), ['12165884', '12165884'], '...and gets the match through its group');
  // accents, hyphens and a Jr suffix join (third review): Lehečka / Carreno-Busta / Damm Jr
  assert.ok(STATUS.samePair('Jiří Lehečka', 'Pablo Carreno Busta', 'J. Lehecka', 'P. Carreno-Busta'));
  assert.ok(STATUS.samePair('Martin Damm Jr', 'Hubert Hurkacz', 'M. Damm', 'H. Hurkacz'));
  // two surname candidates: the initials decide; neither agreeing -> ambiguous
  const wz = { playerA: 'Jiri Wang', playerB: 'Wei Zheng', scheduledStart: '2026-09-26T10:00:00Z' };
  const two = [{ eventKey: '1', liveAt: 'x', date: '2026-09-26', time: '12:00', p1: 'J. Zheng', p2: 'W. Wang' }, { eventKey: '2', liveAt: 'x', date: '2026-09-26', time: '12:30', p1: 'W. Zheng', p2: 'J. Wang' }];
  assert.equal(STATUS.matchFlip(wz, two).eventKey, '2');
  assert.equal(STATUS.matchFlip(wz, [two[0], { ...two[0], eventKey: '3' }]), null, 'both players\' initials conflict: not this match');
  // two candidates, each agreeing on one player only: the tie cannot be broken -> ambiguous
  const half = [{ eventKey: '4', liveAt: 'x', date: '2026-09-26', time: '12:00', p1: 'J. Wang', p2: 'X. Zheng' }, { eventKey: '5', liveAt: 'x', date: '2026-09-26', time: '12:30', p1: 'X. Wang', p2: 'W. Zheng' }];
  assert.equal(STATUS.matchFlip(wz, half), null, 'each conflicts on one player: neither is this match');
  assert.equal(STATUS.matchFlip(wz, [two[1], { ...two[1], eventKey: '9' }]), 'ambiguous', 'two full matches: ambiguous, never picked');
  // a same-surname pair is told apart by initials (F. v J. Cerundolo), never dropped as "no key"
  const cer = { playerA: 'Francisco Cerundolo', playerB: 'Juan Manuel Cerundolo', scheduledStart: '2026-09-26T10:00:00Z' };
  assert.equal(STATUS.matchFlip(cer, [{ eventKey: '7', liveAt: 'x', date: '2026-09-26', time: '12:00', p1: 'J. Cerundolo', p2: 'F. Cerundolo' }]).eventKey, '7');
});

test('status: api-tennis vocabulary — terminal words, live flags, bare numbers', () => {
  const c = STATUS.classifyFixture;
  assert.equal(c({ event_status: 'Finished', event_live: '1' }), 'finished');
  assert.equal(c({ event_status: 'Retired' }), 'finished');
  assert.equal(c({ event_status: 'Walk Over' }), 'finished');
  assert.equal(c({ event_status: 'Set 2', event_live: '1' }), 'in_play');
  assert.equal(c({ event_status: 'Interrupted', event_live: '0' }), 'in_play');
  assert.equal(c({ event_status: '', event_live: '0', event_final_result: '-' }), 'not_started');
  assert.equal(c({ event_status: '1', event_live: '0', event_final_result: '-' }), 'not_started', 'tomorrow\'s fixtures read "1"');
  assert.equal(c({ event_status: '2', event_live: '0', event_final_result: '0 - 1' }), 'in_play', 'a bare number with a set score has started');
});

test('status: api-tennis calls are bounded and cached; a terminal answer is never asked again', async () => {
  const calls = [];
  const fetchImpl = async (u) => { calls.push(u); return { json: async () => ({ success: 1, result: [{ event_key: Number(u.match(/event_key=(\d+)/)[1]), event_status: 'Finished', event_live: '0' }] }) }; };
  let clock = NOW_S;
  const api = STATUS.createApiTennis({ key: 'k', fetchImpl, now: () => clock });
  const enrich = makeEnrich({ api, now: () => clock });
  const snap = { rows: [damm], lines: [], flips, board: { at: Z(clock), matches: [] } };
  let out = await enrich(snap);
  assert.equal(out.rows[0].match.status, 'finished');
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].includes('date_start'), 'one event, by key');
  clock += 10 * 60e3; out = await enrich(snap);
  assert.equal(calls.length, 1, 'Finished is cached for good');
  // the key never reaches a log line
  const logs = []; const bad = STATUS.createApiTennis({ key: 'SECRETKEY', fetchImpl: async () => { throw new Error('boom https://x?APIkey=SECRETKEY'); }, log: (m) => logs.push(m) });
  await bad.fill({ keys: ['1'], dates: null });
  assert.ok(logs.length && logs.every((l) => !l.includes('SECRETKEY')));
});

test('status: api-tennis down or a stale board never un-cuts a price', async () => {
  const api = STATUS.createApiTennis({ key: 'k', fetchImpl: async () => { throw new Error('down'); } });
  const enrich = makeEnrich({ api, now: () => NOW_S });
  // stale board (older than 2 min) says "live" for a finished match: ignored; the cut still applies
  const out = await enrich({ rows: [singh], lines: [singhLine], flips, board: { at: Z(NOW_S - 10 * 60e3), matches: [{ eventKey: '12165991', status: 'Set 2', live: '1' }] } });
  assert.equal(out.rows[0].match.status, 'in_play', 'went live, not confirmed finished');
  assert.equal(out.rows[0].latest.price, '2.85', 'the cut holds without api-tennis');
  // a stale board is not trusted: the match that left it is checked with api-tennis (a fresh board skips the call)
  const asked = []; const api3 = STATUS.createApiTennis({ key: 'k', fetchImpl: async (u) => { asked.push(u); return { json: async () => ({ success: 1, result: [] }) }; } });
  const staleBoard = { at: Z(NOW_S - 10 * 60e3), matches: [{ eventKey: '12165991', status: 'Set 2', live: '1' }] };
  await makeEnrich({ api: api3, now: () => NOW_S })({ rows: [singh], lines: [], flips, board: staleBoard });
  assert.equal(asked.length, 1, 'stale board: api-tennis asked');
  asked.length = 0;
  await makeEnrich({ api: STATUS.createApiTennis({ key: 'k', fetchImpl: async (u) => { asked.push(u); return { json: async () => ({ success: 1, result: [] }) }; } }), now: () => NOW_S })({ rows: [singh], lines: [], flips, board: { ...staleBoard, at: Z(NOW_S - 30e3) } });
  assert.equal(asked.length, 0, 'fresh board: live now, no call');
  // no key at all: same
  const out2 = await makeEnrich({ api: STATUS.createApiTennis({ key: '' }), now: () => NOW_S })({ rows: [singh], lines: [singhLine], flips, board: null });
  assert.equal(out2.rows[0].latest.price, '2.85');
});

test('status: the service serves ONLY enriched rows; the SQL hands over sightings + board; 72 h; the key is a Fly secret', async () => {
  let clock = T0;
  const svc = createDropsService({ readSnapshot: async () => snapshot({ dbNow: clock }), enrich: async (s) => ({ rows: s.rows.map((r) => ({ ...r, match: { status: 'finished' } })), lines: [] }), now: () => clock });
  await svc.readOnce();
  const body = JSON.parse(call(svc, '/drops.json').body);
  assert.ok(body.rows.length && body.rows.every((r) => r.match && r.match.status === 'finished'));
  assert.equal(WINDOW_HOURS, 72, 'card 518c56f0 Q4');
  assert.match(read('stennisfy-drops/server.mjs'), /drops_api\.snapshot\(\$1\) as j', \[WINDOW_HOURS\]/);
  const sql = read('tools/ten294-drops-api.sql').replace(/--.*$/gm, '');
  assert.match(sql, /from public\.live_flip_log_current f/);   // superseded false starts skipped (2026-10-27)
  assert.match(sql, /from fl join rk on rk\.k1 = fl\.k1 and rk\.k2 = fl\.k2/, 'only sightings for a pair that has a row');
  assert.match(sql, /not like '%\/%'/, 'singles only');
  assert.match(sql, /from public\.live_snapshot s where s\.id = 1/);
  assert.match(sql, /'flips', v_flips, 'board', v_board/);
  const wf = read('.github/workflows/ten294-drops.yml');
  assert.match(wf, /API_TENNIS_KEY: \$\{\{ secrets\.API_TENNIS_KEY \}\}/);
  assert.match(wf, /printf 'API_TENNIS_KEY=%s\\n' "\$API_TENNIS_KEY" \| flyctl secrets import --stage -a stennisfy-drops > \/dev\/null/, 'stdin, never argv, never echoed');
  assert.ok(wf.indexOf('API_TENNIS_KEY staged') < wf.indexOf('- name: Deploy'), 'staged before the deploy applies it');
});


test('status review (ba48b81d): exact boundaries, the pre-match fallback, one match = one status', () => {
  const live = '2026-09-26T07:08:16Z';
  const ctx = { flips, board: new Map(), byKey: new Map([['12165991', { event_status: 'Finished' }]]), fixtures: null, now: NOW_S };
  // a price recorded AT the live sighting is in play
  const atCut = { ...singh, latest: { at: live, price: '1.9' } };
  const lineAt = { ...singhLine, books: { Superbet: { ...singhLine.books.Superbet, side: [['2026-09-25T10:00:00Z', 3.55], [live, 1.9]] } } };
  const r1 = STATUS.withStatus([atCut], [lineAt], ctx);
  assert.equal(r1.rows[0].latest.price, '3.55', 'the tick at exactly the live time is not pre-match');
  assert.deepEqual(r1.lines[0].books.Superbet.side.map((p) => p[1]), [3.55]);
  // no own series in lines: the latest recorded price before the cut among the alert's prices, never the open by default
  const noLine = { ...singh, droppedTo: { at: '2026-09-26T06:50:00Z', price: '2.85' }, preDrop: { at: '2026-09-26T06:40:00Z', price: '3.1' } };
  const r2 = STATUS.withStatus([noLine], [], ctx).rows[0];
  assert.equal(r2.latest.price, '2.85', 'the alert price at 06:50 was pre-match: the row keeps it');
  // one match, two vendors, starts 20 h apart, only one row joins the sighting: both rows share the status
  const kibl = { ...damm, id: 'bet105-x', scheduledStart: '2026-09-27T02:55:00Z' };   // Kibl's start 20 h late
  const sb = { ...damm, id: 'superbet-x', book: 'Superbet', scheduledStart: '2026-09-26T06:55:00Z' };
  const onlyOne = [{ ...flips[0], date: '2026-09-26', time: '08:55' }];
  const both = STATUS.withStatus([kibl, sb], [], { flips: onlyOne, board: new Map(), byKey: new Map([['12165854', { event_status: 'Finished' }]]), fixtures: null, now: NOW_S }).rows;
  assert.deepEqual(both.map((r) => r.match.status), ['finished', 'finished'], 'never Upcoming and Completed at once');
  assert.ok(both.every((r) => r.match.cutAt === flips[0].liveAt));
  // the reviewer's case: NO live sighting; one vendor's start is right (passed -> api-tennis says Finished), the
  // other's is 20 h late (in the future -> alone it would read "not started"): the match is Completed for both
  const fxs = [{ event_key: 12165854, event_status: 'Finished', event_live: '0', event_date: '2026-09-26', event_time: '06:55', utc: true, event_first_player: 'M. Damm', event_second_player: 'H. Hurkacz' }];
  const late = { ...damm, id: 'bet105-late', scheduledStart: '2026-09-27T02:55:00Z' };
  assert.equal(STATUS.resolveMatch(late, { flips: [], board: new Map(), fixtures: fxs, now: NOW_S }).status, 'not_started', 'alone, the late row reads not started');
  const pair = STATUS.withStatus([late, sb], [], { flips: [], board: new Map(), byKey: new Map(), fixtures: fxs, now: NOW_S }).rows;
  assert.deepEqual(pair.map((r) => r.match.status), ['finished', 'finished'], 'one match, one view');
  // the board never overrides an api-tennis Finished
  const stale = { ...ctx, byKey: new Map([['12165854', { event_status: 'Finished' }]]), board: new Map([['12165854', { status: 'Set 3', live: '1' }]]) };
  assert.equal(STATUS.resolveMatch(damm, stale).status, 'finished');
});

test('status review: api-tennis load is bounded — 20 keys a read, empty answers cached, days in the background, failures cached', async () => {
  let clock = NOW_S; const calls = [];
  const fetchImpl = async (u) => { calls.push(u); return { json: async () => ({ success: 1, result: [] }) }; };
  const api = STATUS.createApiTennis({ key: 'k', fetchImpl, now: () => clock });
  const manyFlips = Array.from({ length: 30 }, (_, i) => ({ eventKey: String(100 + i), liveAt: '2026-09-26T08:00:00Z', date: '2026-09-26', time: '10:00', p1: 'A. P' + String.fromCharCode(97 + i), p2: 'B. Q' + String.fromCharCode(97 + i) }));
  const rows = manyFlips.map((f, i) => ({ ...damm, id: 'r' + i, playerA: 'Al P' + String.fromCharCode(97 + i), playerB: 'Bo Q' + String.fromCharCode(97 + i), side: 'Al P' + String.fromCharCode(97 + i), scheduledStart: '2026-09-26T08:00:00Z' }));
  const ctx = { flips: manyFlips, board: new Map(), now: clock };
  const needs = STATUS.apiNeeds(rows, ctx, api.cache);
  assert.equal(needs.keys.length, 20, 'at most 20 event keys a read');
  await api.fill(needs);
  assert.equal(calls.length, 20);
  assert.equal(STATUS.apiNeeds(rows.slice(0, 20), ctx, api.cache).keys.length, 0, 'an empty answer is not asked again at once');
  clock += 11 * 60e3;
  assert.equal(STATUS.apiNeeds(rows.slice(0, 20), { ...ctx, now: clock }, api.cache).keys.length, 20, 'retried after 10 min');
  // days: the read never waits for a day (a day can take 45 s); a failed day is not retried for 10 min
  let release; const slow = new Promise((r) => { release = r; }); const dayCalls = [];
  const api2 = STATUS.createApiTennis({ key: 'k', now: () => clock, fetchImpl: async (u) => { dayCalls.push(u); await slow; throw new Error('x'); } });
  const t0 = Date.now(); await api2.fill({ keys: [], days: ['2026-09-26'] });
  assert.ok(Date.now() - t0 < 200, 'fill returned without waiting for the day');
  assert.ok(/date_start=2026-09-26&date_stop=2026-09-26/.test(dayCalls[0]) && /timezone=UTC/.test(dayCalls[0]), 'one day per call, asked in UTC');
  await api2.fill({ keys: [], days: ['2026-09-26'] });
  assert.equal(dayCalls.length, 1, 'a day in flight is not asked twice');
  release(); await new Promise((r) => setTimeout(r, 10));
  await api2.fill({ keys: [], days: ['2026-09-26'] });
  assert.equal(dayCalls.length, 1, 'a failed day is cached (not re-asked every 30 s)');
  assert.equal(api2.fixtures(), null, 'and gives no fixtures');
});


test('status second review (36b4a518): the 30-min grace believes a live fixture; siblings share the last pre-match price; grouping never chains', () => {
  // 10 min after the vendor start, no live sighting, api-tennis shows "Set 1": in play, cut at api-tennis's start
  const now = Date.parse('2026-09-26T12:21:00Z');
  const row = { id: 'b1', book: 'Superbet', playerA: 'Arthur Boutleux', playerB: 'Max Seifert', side: 'Arthur Boutleux', scheduledStart: '2026-09-26T12:11:28Z',
    open: { at: '2026-09-26T08:00:00Z', price: '9.0' }, latest: { at: '2026-09-26T12:14:58Z', price: '7.25' } };
  const fx = [{ event_key: 5, event_status: 'Set 1', event_live: '1', event_date: '2026-09-26', event_time: '12:00', utc: true, event_first_player: 'A. Boutleux', event_second_player: 'M. Seifert' }];
  const m = STATUS.resolveMatch(row, { flips: [], board: new Map(), fixtures: fx, now });
  assert.equal(m.status, 'in_play');
  assert.equal(m.cutAt, Z('2026-09-26T12:00:00Z'));
  assert.equal(STATUS.resolveMatch(row, { flips: [], board: new Map(), fixtures: null, now }).status, 'not_started', 'no fixture yet: the poller is trusted for 30 min');
  assert.deepEqual(STATUS.apiNeeds([row], { flips: [], board: new Map(), now }, { keys: new Map() }).days, ['2026-09-26'], 'asked as soon as the start passed');
  // a fixture joined from a day list is re-asked by key until terminal; the fresher by-key answer wins
  const needs = STATUS.apiNeeds([row], { flips: [], board: new Map(), fixtures: fx, now }, { keys: new Map() });
  assert.deepEqual(needs.keys, ['5']);
  assert.equal(STATUS.resolveMatch(row, { flips: [], board: new Map(), fixtures: fx, byKey: new Map([['5', { event_status: 'Finished' }]]), now }).status, 'finished');
  // repeat alerts of one selection x book: every row gets the same, latest, pre-cut price
  const ctx = { flips, board: new Map(), byKey: new Map([['12165991', { event_status: 'Finished' }]]), fixtures: null, now: NOW_S };
  const a = { ...singh, id: 's1', latest: { at: '2026-09-26T08:47:00Z', price: '1.01' }, droppedTo: { at: '2026-09-26T06:59:00Z', price: '3.2' }, preDrop: null };
  const b = { ...singh, id: 's2', latest: { at: '2026-09-26T08:47:00Z', price: '1.01' }, droppedTo: { at: '2026-09-26T07:05:00Z', price: '2.85' }, preDrop: null };
  const out = STATUS.withStatus([a, b], [], ctx).rows;
  assert.deepEqual(out.map((r) => r.latest.price), ['2.85', '2.85'], 'both rows: 2.85 at 07:05, the last price before 07:08:16');
  // grouping is anchored: a row with no first name never chains two different matches together
  const w0 = { id: 'w0', book: 'Bet105', playerA: 'Wang', playerB: 'Zheng', side: 'Wang', scheduledStart: '2026-09-26T08:00:00Z', open: { at: '2026-09-25T08:00:00Z', price: '2' }, latest: { at: '2026-09-26T07:00:00Z', price: '1.8' } };
  const w1 = { ...w0, id: 'w1', playerA: 'Yafan Wang', playerB: 'Saisai Zheng', side: 'Yafan Wang', scheduledStart: '2026-09-26T20:00:00Z' };
  const w2 = { ...w0, id: 'w2', playerA: 'Xinyu Wang', playerB: 'Qinwen Zheng', side: 'Xinyu Wang', scheduledStart: '2026-09-26T20:00:00Z' };
  const wf = [{ eventKey: '77', liveAt: '2026-09-26T07:30:00Z', date: '2026-09-26', time: '09:30', p1: 'Y. Wang', p2: 'S. Zheng' }];
  const g = STATUS.withStatus([w0, w1, w2], [], { flips: wf, board: new Map(), byKey: new Map(), fixtures: null, now: Date.parse('2026-09-26T08:00:00Z') }).rows;
  assert.equal(g.find((r) => r.id === 'w2').match.status, 'not_started', 'Xinyu Wang v Qinwen Zheng is not Yafan Wang v Saisai Zheng');
});

test('status second review: the tie-break, middle-name initials, anchor-only grouping, conflicting event keys', () => {
  const F = (eventKey, time, p1, p2, date = '2026-09-26') => ({ eventKey, liveAt: date + 'T' + time + ':00Z', date, time, p1, p2 });
  // two surname candidates both passing the loose test: the one where BOTH players agree wins
  const wz = { playerA: 'Jiri Wang', playerB: 'Wei Zheng', scheduledStart: '2026-09-26T10:00:00Z' };
  assert.equal(STATUS.matchFlip(wz, [F('A', '12:00', 'J. Wang', 'X. Zheng'), F('B', '12:30', 'J. Wang', 'W. Zheng')]).eventKey, 'B');
  // a middle name counts: "Adolfo Daniel Vallejo" is "D. Vallejo", not "X. Vallejo"
  const cw = { playerA: 'Coleman Wong', playerB: 'Adolfo Daniel Vallejo', scheduledStart: '2026-09-26T11:30:00Z' };
  assert.equal(STATUS.matchFlip(cw, [F('A', '13:30', 'C. Wong', 'D. Vallejo'), F('B', '13:45', 'C. Wong', 'X. Vallejo')]).eventKey, 'A');
  // anchor-only grouping: c is 40 h after a (another meeting); b sits between them — c never inherits a's status
  const base = { book: 'Bet105', playerA: 'Jiri Wang', playerB: 'Wei Zheng', side: 'Jiri Wang', open: { at: '2026-09-20T00:00:00Z', price: '2' }, latest: { at: '2026-09-20T01:00:00Z', price: '1.8' } };
  const a = { ...base, id: 'a', scheduledStart: '2026-09-24T00:00:00Z' }, b = { ...base, id: 'b', scheduledStart: '2026-09-24T20:00:00Z' }, c = { ...base, id: 'c', scheduledStart: '2026-09-25T16:00:00Z' };
  const now = Date.parse('2026-09-24T12:00:00Z');
  const g = STATUS.withStatus([a, b, c], [], { flips: [F('K1', '04:00', 'J. Wang', 'W. Zheng', '2026-09-23')], board: new Map(), byKey: new Map([['K1', { event_status: 'Finished' }]]), fixtures: null, now }).rows;
  assert.equal(g.find((r) => r.id === 'a').match.status, 'finished');
  assert.equal(g.find((r) => r.id === 'b').match.status, 'finished', 'b (20 h after a) is the same meeting');
  assert.equal(g.find((r) => r.id === 'c').match.status, 'not_started', "c is not a's match");
  // two rows 23 h apart that joined DIFFERENT event keys are two matches, never merged
  const r1 = { ...base, id: 'r1', scheduledStart: '2026-09-24T00:00:00Z' }, r2 = { ...base, id: 'r2', scheduledStart: '2026-09-24T23:00:00Z' };
  // K1 22 h before r1 (45 h before r2); K2 21 h after r2 (44 h after r1): each row joins its own key
  const fl = [F('K1', '04:00', 'J. Wang', 'W. Zheng', '2026-09-23'), F('K2', '22:00', 'J. Wang', 'W. Zheng', '2026-09-25')];
  const two = STATUS.withStatus([r1, r2], [], { flips: fl, board: new Map(), byKey: new Map([['K1', { event_status: 'Finished' }]]), fixtures: null, now: Date.parse('2026-09-26T00:00:00Z') }).rows;
  assert.deepEqual(two.map((r) => [r.match.eventKey, r.match.status]), [['K1', 'finished'], ['K2', 'in_play']]);
});

test('status third review (68cdc26e): repeat alerts agree even when pre-match; a same-surname pair never swaps prices; fixtures are indexed', () => {
  const ctx = { flips, board: new Map(), byKey: new Map([['12165991', { event_status: 'Finished' }]]), fixtures: null, now: NOW_S };
  const a = { ...singh, id: 'p1', latest: { at: '2026-09-26T05:00:00Z', price: '1.8' }, droppedTo: null, preDrop: null };
  const b = { ...singh, id: 'p2', latest: { at: '2026-09-26T06:30:00Z', price: '1.6' }, droppedTo: null, preDrop: null };
  assert.deepEqual(STATUS.withStatus([a, b], [], ctx).rows.map((r) => r.latest.price), ['1.6', '1.6'], 'both: the later pre-match price');
  // Karolina v Kristyna Pliskova: each side keeps its own prices
  const pf = [{ eventKey: '44', liveAt: '2026-09-26T10:06:00Z', date: '2026-09-26', time: '12:00', p1: 'Ka. Pliskova', p2: 'Kr. Pliskova' }];
  const base = { book: 'Superbet', playerA: 'Karolina Pliskova', playerB: 'Kristyna Pliskova', scheduledStart: '2026-09-26T10:00:00Z', open: { at: '2026-09-25T10:00:00Z', price: '2' }, preDrop: null };
  const kA = { ...base, id: 'k1', side: 'Karolina Pliskova', latest: { at: '2026-09-26T11:00:00Z', price: '1.1' }, droppedTo: { at: '2026-09-26T09:00:00Z', price: '1.4' } };
  const kB = { ...base, id: 'k2', side: 'Kristyna Pliskova', latest: { at: '2026-09-26T11:00:00Z', price: '9' }, droppedTo: { at: '2026-09-26T09:00:00Z', price: '2.9' } };
  const pr = STATUS.withStatus([kA, kB], [], { flips: pf, board: new Map(), byKey: new Map(), fixtures: null, now: NOW_S }).rows;
  assert.deepEqual(pr.map((r) => [r.side, r.latest.price]), [['Karolina Pliskova', '1.4'], ['Kristyna Pliskova', '2.9']]);
  // the by-day lists are indexed by surname pair; matchFixture reads the index
  const idx = STATUS.indexFixtures([{ event_key: 1, event_first_player: 'M. Damm', event_second_player: 'H. Hurkacz', event_date: '2026-09-26', event_time: '06:55', utc: true }]);
  assert.ok(idx instanceof Map && idx.get('damm|hurkacz').length === 1);
  assert.equal(STATUS.matchFixture(damm, idx).event_key, 1);
});

// ════ TEN-299: the Telegram drop bots stop at the live start (founder comment 8585095a) ════
test('TEN-299: both bots drop every tick at or after the live start, in one guarded transaction', () => {
  const sql = read('tools/ten299-live-cut.sql');
  const code = sql.replace(/--.*$/gm, '');
  // one transaction, guard last
  assert.match(code, /^\s*begin;/m);
  assert.ok(code.trimEnd().endsWith('commit;'), 'commit is the last statement');
  assert.ok(code.indexOf('do $$') > code.indexOf('ten280_bot.load_ticks(p_from timestamp'), 'the guard runs after both definitions');
  assert.match(code, /raise exception 'TEN-299 guard: % Superbet ticks left after the live cut'/);
  assert.match(code, /raise exception 'TEN-299 guard: % Bet105 ticks left after the live cut'/);
  assert.match(code, /raise exception 'TEN-299 guard: no live sightings/);
  // the cut, in each bot's load_ticks, before its count; at-or-after (>=), never after only
  for (const [tbl, key, fn, ct] of [['t287', 'event_id', 'cuts_287', 'cut287'], ['t280', 'fixture_id', 'cuts_280', 'cut280']]) {
    const re = new RegExp('create temp table ' + ct + ' as select \\* from drops_live\\.' + fn + "\\(greatest\\(p_from, p_to - interval '4 days'\\) - interval '2 days'\\);\\s+delete from pg_temp\\." + tbl + ' t using pg_temp\\.' + ct + ' c\\s+where t\\.' + key + ' = c\\.' + key + ' and t\\.at >= c\\.cut_at;\\s+select count\\(\\*\\) into n from ' + tbl + ';');
    assert.match(code, re, tbl + ': the cuts are kept and applied right before the count');
    // the scan evaluates nothing at or after a match's cut (review of 43f06494: the 10-min window / late-recorded tick)
    assert.match(code, new RegExp('where known_at <= e and at <= e and at > e - p_window\\s+and not exists \\(select 1 from pg_temp\\.' + ct + ' x where x\\.' + key + ' = ' + tbl + '\\.' + key + ' and x\\.cut_at <= e\\)'), tbl + ' scan');
  }
  // empty surname keys never join
  assert.doesNotMatch(code, /event_time/, 'the sighting join never reads the scheduled time (TEN-225 ruling 1, founder 2026-10-26)');
  assert.equal((code.match(/where ev\.h <> '' and ev\.a <> '' and drops_live\.ini_ok/g) || []).length, 4, 'all four join legs');
  // the bots' own filters are untouched (the live definitions + the delete)
  assert.match(code, /coalesce\(t\.event_status, e\.status\) = 'pending'/);
  assert.match(code, /o\.is_live is false and o\.price_decimal >= 1\.01/);
  // the join mirrors status.mjs: surname key, given-name initials, 24 h, exactly one (else the scheduled start)
  assert.match(code, /'\\s\+\(jr\|sr\|ii\|iii\|iv\)\\\.\?\$'/, 'Jr / Sr / II suffix dropped');
  assert.match(code, /normalize\(/, 'accents stripped');
  assert.match(code, /abs\(extract\(epoch from fl\.live_at - ev\.start_at\)\) < 86400/, 'the 24 h window is measured from the live sighting');
  assert.match(code, /case when cardinality\(p_keys\) = 1 then p_live\[1\] else p_start end/);
  // installed from the drops workflow, measured before and after with the bots' real scan (backtest mode only)
  const steps = JSON.parse(read('tools/ten294-steps-install.json')).map((s) => s.name);
  for (const n of ['ten299_base_287', 'ten299_base_280', 'install_live_cut', 'ten299_cut_287', 'ten299_cut_280', 'ten299_summary']) assert.ok(steps.includes(n), n);
  // last in the install: a TEN-299 failure (e.g. the poller down) never blocks the drops endpoint's own steps
  assert.ok(steps.indexOf('ten299_base_287') > steps.indexOf('install') && steps.indexOf('ten299_base_287') > steps.indexOf('install_lines'));
  assert.ok(steps.includes('ten299_after_cut'), 'the measurement counts backtest alerts at or after a cut (must be 0)');
  assert.ok(steps.indexOf('ten299_base_287') < steps.indexOf('install_live_cut') && steps.indexOf('install_live_cut') < steps.indexOf('ten299_cut_287'));
  const st = JSON.parse(read('tools/ten294-steps-install.json'));
  assert.deepEqual(st.find((s) => s.name === 'install_live_cut'), { name: 'install_live_cut', file: 'tools/ten299-live-cut.sql', required: true, stop_on_error: true });
  st.filter((s) => /^ten299_(base|cut)_(287|280)$/.test(s.name)).forEach((s) => assert.match(s.sql, /'backtest'/, s.name + ' never writes a live alert'));
});



