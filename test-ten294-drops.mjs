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
    started: o.started ?? false, pastScheduledStart: false, scheduledStart: o.start ?? at(-3 * HR), ...(o.match ? { match: o.match } : {}) };
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

test('page views (card 518c56f0 Q1 = b): every row is in exactly one of Upcoming / In play / Completed', () => {
  const M = (status, extra) => ({ status, eventKey: '1', liveAt: null, apiStatus: null, cutAt: null, cutKind: null, ...extra });
  const rows = PAGE.buildRows([
    frow({ id: 'up', a: 'Up Coming', b: 'Opp A', side: 'Up Coming', open: 2, now: 1.8, match: M('not_started') }),
    frow({ id: 'unk', a: 'Un Known', b: 'Opp B', side: 'Un Known', open: 2, now: 1.8, match: M('unknown') }),
    frow({ id: 'ip', a: 'In Play', b: 'Opp C', side: 'In Play', open: 2, now: 1.8, match: M('in_play', { liveAt: at(0.5 * HR), cutAt: at(0.5 * HR), cutKind: 'live' }) }),
    frow({ id: 'fin', a: 'Fin Ished', b: 'Opp D', side: 'Fin Ished', open: 2, now: 1.8, match: M('finished', { apiStatus: 'Retired', cutAt: at(3 * HR), cutKind: 'live' }) }),
    frow({ id: 'old', a: 'Old Feed', b: 'Opp E', side: 'Old Feed', open: 2, now: 1.8 }),        // no status from the feed
  ]);
  const ids = (vw) => PAGE.view(rows, { ...PAGE.defaults(), vw }, PT0).list.map((r) => r.id).sort();
  assert.deepEqual(ids('upcoming'), ['old', 'unk', 'up'], 'not started, and unknown (badged) — never a guessed live/finished');
  assert.deepEqual(ids('inplay'), ['ip']);
  assert.deepEqual(ids('completed'), ['fin']);
  const all = [...ids('upcoming'), ...ids('inplay'), ...ids('completed')].sort();
  assert.deepEqual(all, rows.map((r) => r.id).sort(), 'each row in exactly one view');
  assert.deepEqual(PAGE.view(rows, PAGE.defaults(), PT0).vwCount, { upcoming: 3, inplay: 1, completed: 1 });
  assert.equal(PAGE.defaults().vw, 'upcoming');
  // "Starts within" narrows Upcoming only: it never empties Completed of matches whose start has passed
  assert.deepEqual(PAGE.view(rows, { ...PAGE.defaults(), vw: 'completed', starts: 3 }, PT0).list.map((r) => r.id), ['fin']);
  assert.equal(rows.find((r) => r.id === 'fin').tier, 'ATP');
  assert.equal(PAGE.tierOf('ITF Men'), 'ITF');
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

test('pop-up chart (bef04c62 item 2): the axis runs opening -> now at real UTC times; recorded points only; dashed past 3.6 h', () => {
  // a 30 h life: first seen 30 h ago, a 6-min drop 8 h ago, latest 0.5 h ago
  const series = [{ t: PT0 - 30 * HR, v: 2.5 }, { t: PT0 - 8 * HR, v: 2.3 }, { t: PT0 - 7.9 * HR, v: 2.1 }, { t: PT0 - 0.5 * HR, v: 2.0 }];
  const pts = PAGE.seriesPoints(series);
  assert.equal(pts.length, 4, 'the 30 h-old first price is ON the axis (no fixed 24 h window)');
  assert.equal(pts[0].fr, 0, 'first recorded price = the left edge');
  assert.equal(pts[3].fr, 1, 'latest recorded price = the right edge');
  const svg = PAGE.chartSvg(pts, 2.5, 'latest');
  assert.equal((svg.match(/<circle/g) || []).length, 4, 'one dot per recorded price, none invented');
  assert.equal((svg.match(/class="do-gap"/g) || []).length, 2, 'the 22 h and 7.4 h stretches are dashed');
  assert.equal((svg.match(/class="do-seg-l"/g) || []).length, 1, 'the 6-min drop is a solid segment');
  assert.match(svg, /class="do-open-ref"/, 'the open level is still marked');
  assert.doesNotMatch(svg, /−24h|−12h|-24h|-12h/, 'no rolling-window labels');
  const ticks = [...svg.matchAll(/class="do-tick"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.equal(ticks[0], 'first seen 25 Sep 06:00', 'left tick = the first recorded time, dated (the line spans two days)');
  assert.equal(ticks[ticks.length - 1], 'latest 26 Sep 11:30', 'right tick = the latest recorded time (not the clock: "latest", never "now")');
  assert.ok(ticks.length >= 3 && ticks.length <= 5, 'a few real intermediate times, not a crowd: ' + ticks.join(' | '));
  ticks.slice(1, -1).forEach((t) => assert.match(t, /^(\d+ Sep )?\d\d:00$/, 'intermediates sit on round UTC hours'));
  const multi = PAGE.axisTicks(Date.parse('2026-09-24T15:27:00Z'), Date.parse('2026-09-26T11:09:00Z'), 'latest');
  let dayNow = 24;
  multi.slice(1, -1).forEach((t) => { const d = new Date(t.t).getUTCDate(); if (d !== dayNow) assert.match(t.label, new RegExp('^' + d + ' Sep '), 'a tick on a new day is dated: ' + multi.map((x) => x.label).join(' | ')); dayNow = d; });
  // a completed line ends at its last recorded price, labelled as such (the caller passes the word)
  assert.match(PAGE.chartSvg(pts, 2.5, 'last'), />last 26 Sep 11:30</);
  // same-day line: time only
  const day = PAGE.axisTicks(PT0 - 5 * HR, PT0 - 1 * HR, 'latest');
  assert.equal(day[0].label, 'first seen 07:00');
  assert.equal(day[day.length - 1].label, 'latest 11:00');
  // a round hour 5 min after the first record would collide with the left label: skipped
  const near = PAGE.axisTicks(PT0 - 4 * HR - 5 * 60e3, PT0 - 5 * 60e3, 'latest');
  assert.deepEqual(near.map((t) => t.label), ['first seen 07:55', '09:00', '10:00', '11:00', 'latest 11:55'], '08:00 (2% in) would overprint the left label');
  // no two labels overlap, even with a long dated end label (the live Damm case: 24 Sep 17:36 -> 26 Sep 06:29)
  const ext = (x) => { const w = x.label.length * 6.1, c = x.fr * 942; return x.anchor === 'start' ? [c, c + w] : x.anchor === 'end' ? [c - w, c] : [c - w / 2, c + w / 2]; };
  const damm = PAGE.axisTicks(Date.parse('2026-09-24T17:36:00Z'), Date.parse('2026-09-26T06:29:00Z'), 'latest');
  for (let i = 1; i < damm.length; i++) assert.ok(ext(damm[i])[0] >= ext(damm[i - 1])[1] + 14, 'labels clear each other: ' + damm.map((t) => t.label).join(' | '));
  assert.ok(damm.length >= 3, 'still some real intermediate times');
  // a single recorded price: one dot, one label, no line
  const one = PAGE.chartSvg(PAGE.seriesPoints([{ t: PT0, v: 1.9 }]), 1.9, 'latest');
  assert.equal((one.match(/<circle/g) || []).length, 1);
  assert.match(one, /text-anchor="end">first seen 12:00</, 'a single price is labelled where its dot is (the right edge)');
  assert.equal((one.match(/<line class="do-(gap|seg-l)"/g) || []).length, 0);
});

test('pop-up chart (bef04c62 item 1): the house style — the Database cumulative-profit chart\'s own values, never red', () => {
  const dash = read('bsp-consult-dashboard.html');
  const colFav = dash.match(/var COL_FAV='(#[0-9a-f]{6})'/i)[1], fillFav = dash.match(/FILL_FAV='([^']+)'/)[1];
  assert.equal(PAGE.HOUSE_LINE.toLowerCase(), colFav.toLowerCase(), 'the line is the Database chart\'s blue');
  assert.equal(PAGE.HOUSE_FILL, fillFav, 'the area is the Database chart\'s fill');
  const svg = PAGE.chartSvg(PAGE.seriesPoints([{ t: PT0 - 2 * HR, v: 2.4 }, { t: PT0 - 1 * HR, v: 2.2 }, { t: PT0, v: 2.0 }]), 2.4, 'now');
  assert.doesNotMatch(svg, /#DA6259|218,\s*98,\s*89/i, 'no red anywhere in the chart');
  assert.match(svg, new RegExp('class="do-area"[^>]*fill="' + fillFav.replace(/[()]/g, '\\$&') + '"'));
  assert.match(svg, new RegExp('class="do-seg-l"[^>]*stroke="' + colFav + '" stroke-width="2.6"', 'i'), 'the Database line weight');
});

test('pop-up chart: the endpoint sends the whole recorded life; a truncated series is not drawn as a gap', () => {
  const sql = read('tools/ten294-drops-lines.sql').replace(/--.*$/gm, '');
  assert.match(sql, /filter \(where rn <= 1000\), '\[\]'::jsonb\) series,\s*count\(\*\) > 1000 truncated/, 'no time window on the series');
  assert.doesNotMatch(sql, /rn <= 400 and at >= now\(\)/);
  assert.match(sql, /'truncated', coalesce\(/);
  const [r] = PAGE.buildRows([frow({ id: 'superbet-60', book: 'Superbet', a: 'Pat Pi', b: 'Rho Rho', side: 'Pat Pi', open: 2.2, now: 1.9 })]);
  const mk = (truncated) => ({ books: { 'Betfair Exchange': { first: [at(40 * HR), 2.30], side: [[at(20 * HR), 2.2], [at(2 * HR), 2.1]], other: [[at(2 * HR), 1.95]], truncated } } });
  const full = PAGE.modalBooks(r, { rows: [r], line: mk(false), now: PT0 }).books.find((b) => b.book === 'Betfair Exchange');
  assert.equal(full.series[0].v, 2.30, 'the first record opens the chart');
  assert.equal(PAGE.seriesPoints(full.series)[0].fr, 0);
  const cut = PAGE.modalBooks(r, { rows: [r], line: mk(true), now: PT0 }).books.find((b) => b.book === 'Betfair Exchange');
  assert.equal(cut.truncated, true);
  assert.equal(cut.series[0].v, 2.2, 'a truncated series starts at its oldest SENT point, not the first record');
  assert.equal(cut.first.v, 2.30, 'the % still uses the first record');
  // the row's OWN book truncated: row points older than the oldest sent point are not merged (no false gap)
  const own = { books: { Superbet: { first: [at(72 * HR), 2.2], side: [[at(10 * HR), 2.05], [at(1 * HR), 1.9]], other: [[at(1 * HR), 2.0]], truncated: true } } };
  const ob = PAGE.modalBooks(r, { rows: [r], line: own, now: PT0 }).books.find((b) => b.own);
  assert.ok(ob.series.every((p) => p.t >= PT0 - 10 * HR), 'the chart starts at the oldest sent point: ' + ob.series.map((p) => new Date(p.t).toISOString()).join(','));
  assert.equal(ob.first.v, 2.2, 'the row still reads open -> now (Q1)');
});

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
    Promise, JSON, Math, String, Number, Object, Array, isFinite, parseFloat, RegExp, Error, matches: [],
  };
  sandbox.window = sandbox;
  vm.runInNewContext(read('drops-page.js'), sandbox);
  const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
  const P = sandbox.window.DropsPage;
  return { P, st: P._state, root, overlay, keys, flush, activate: async () => { P.setActive(true); await flush(); } };
}

test('page review 2: the count line is never "0 moves" when the endpoint is down, and nothing reads 0 in flight', async () => {
  const down = (await renderPage({ rows: [], reachable: false })).html;
  assert.match(down, /<span class="do-count">—<\/span>/);
  const x = pageSandbox({ feed: () => [], hang: true });
  x.P.setActive(true); await x.flush();
  assert.match(x.root.innerHTML, /<span class="do-count">Loading moves…<\/span>/);
  assert.match(x.root.innerHTML, /Loading prices…/);
  assert.doesNotMatch(x.root.innerHTML, /do-tab-n">0<|data-k="drops">0</);
});

test('page review 2: the open modal is rebuilt only when what it shows changes', async () => {
  const x = pageSandbox({ feed: () => [frow({ id: 'r1', open: 2, now: 1.8 })] });
  await x.activate();
  x.st.drawer = 'r1';
  await x.activate();
  const w = x.overlay.writes;
  assert.ok(w >= 1, 'the modal was drawn');
  await x.activate(); await x.activate();          // two more renders with nothing new: no rebuild
  assert.equal(x.overlay.writes, w);
  x.st.drBook = 'Bet105'; x.st.tip = true;         // what it shows changed: rebuilt once
  await x.activate();
  assert.equal(x.overlay.writes, w + 1);
});

test('page review 2: Enter on a row opens it with the chart on its own book and the tooltip closed', async () => {
  const x = pageSandbox({ feed: () => [frow({ id: 'r1', open: 2, now: 1.8 })] });
  await x.activate();
  x.st.drBook = 'Superbet'; x.st.tip = true;
  const row = { getAttribute: () => 'r1' };
  x.keys[0]({ key: 'Enter', preventDefault() {}, target: { closest: (s) => (s === '.do-row' ? row : null) } });
  assert.equal(x.st.drawer, 'r1');
  assert.equal(x.st.drBook, null);
  assert.equal(x.st.tip, false);
});

test('page review 2: a book that appears later joins only an all-books selection', async () => {
  let rows = [frow({ id: 'r1', open: 2, now: 1.8 })];
  const x = pageSandbox({ feed: () => rows });
  await x.activate();
  assert.deepEqual([...x.st.S.books].sort(), ['Bet105', 'Superbet']);
  rows = rows.concat([frow({ id: 'p1', book: 'Pinnacle', a: 'Pat Pi', b: 'Rho Rho', side: 'Pat Pi', open: 2, now: 1.7 })]);
  await x.activate();
  assert.ok(x.st.S.books.includes('Pinnacle'), 'all books were selected, so the new one joins');
  // the member narrowed the list to Bet105; Pinnacle then appears: it must not be added
  const z = pageSandbox({ feed: () => (z.st.knownBooks ? rows : rows.slice(0, 1)) });
  await z.activate(); z.st.S.books = ['Bet105'];
  await z.activate();
  assert.deepEqual(z.st.S.books, ['Bet105'], 'a narrowed selection is never widened behind the member\'s back');
});

test('page review 2: repeat alerts collapse to the newest INSTANT, whatever the timestamp format', () => {
  const a = { ...frow({ id: 'older', open: 2, now: 1.8 }), detectedAt: '2026-09-26T11:00:00Z' };
  const b = { ...frow({ id: 'newer', open: 2, now: 1.8 }), detectedAt: '2026-09-26T11:00:00.900+00:00' };
  assert.deepEqual(PAGE.buildRows([a, b]).map((r) => r.id), ['newer']);
  assert.deepEqual(PAGE.buildRows([b, a]).map((r) => r.id), ['newer']);
});

test('page review 2: the Since-open label reads the feed\'s own window', async () => {
  const x = pageSandbox({ feed: () => [frow({ id: 'r1', open: 2, now: 1.8 })], windowHours: 12 });
  await x.activate();
  assert.match(x.root.innerHTML, /title="Everything the feed holds: the last 12h of flagged moves"/);
});

test('page review 2: "Starting soonest" is stable for unknown starts and orders passed starts most-recent first', () => {
  const rows = PAGE.buildRows([
    frow({ id: 'u1', a: 'Un One', b: 'Op A', side: 'Un One', open: 2, now: 1.8, start: null }),
    frow({ id: 'p15', a: 'Past Far', b: 'Op B', side: 'Past Far', open: 2, now: 1.8, start: at(15 * HR) }),
    frow({ id: 'p1', a: 'Past Near', b: 'Op C', side: 'Past Near', open: 2, now: 1.8, start: at(1 * HR) }),
    frow({ id: 'up', a: 'Up Soon', b: 'Op D', side: 'Up Soon', open: 2, now: 1.8, start: at(-1 * HR) }),
    frow({ id: 'u2', a: 'Un Two', b: 'Op E', side: 'Un Two', open: 2, now: 1.8, start: null }),
  ]);
  for (const r of rows) if (r.id.startsWith('u') && r.id !== 'up') r.start = null;
  const ids = PAGE.sortRows(rows, 'soon', PT0).map((r) => r.id);
  assert.equal(ids[0], 'up');
  assert.deepEqual(ids.slice(1, 3), ['p1', 'p15'], 'passed starts after upcoming, most recent first');
  assert.deepEqual(ids.slice(3).sort(), ['u1', 'u2'], 'unknown starts last');
});

// ════ Price-move pop-up rebuild (founder comment 777a3192: decisions 1–7) ════
const SHARD_CHART = { books: {
  'Pinnacle +30s': { p1: [[at(20 * HR), 3.32], [at(2 * HR), 3.06]], p2: [[at(20 * HR), 1.35], [at(2 * HR), 1.42]] },
  // the shard's first Bet105 price (3.40) differs from the alert's open (3.30): the own book must read as its list row
  Bet105: { p1: [[at(20 * HR), 3.40], [at(3 * HR), 3.05]], p2: [[at(20 * HR), 1.36], [at(3 * HR), 1.43]] },
  Superbet: { p1: [[at(10 * HR), 2.85], [at(1 * HR), 2.82]], p2: [[at(10 * HR), 1.40], [at(1 * HR), 1.42]] },
  'Betfair Exchange (recorded by us)': { p1: [[at(9 * HR), 3.00], [at(1 * HR), 3.15]], p2: [[at(9 * HR), 1.49], [at(1 * HR), 1.46]] },
}, meta: {} };
const MROW = frow({ id: 'bet105-9', a: 'Adrian Mannarino', b: 'Denis Shapovalov', side: 'Adrian Mannarino', open: 3.3, now: 3.05, latestAgo: 3 * HR });

test('pop-up decision 1: a board-matched row shows every book in its chart shard, both sides, own book = its list row', () => {
  const [r] = PAGE.buildRows([MROW]);
  const mb = PAGE.modalBooks(r, { rows: [r], chart: SHARD_CHART, cardSide: 'p1' });
  assert.equal(mb.source, 'board');
  assert.deepEqual(mb.books.map((b) => b.book), ['Pinnacle +30s', 'Bet105', 'Superbet', 'Betfair Exchange'], 'Sharp first, then Soft; "(recorded by us)" dropped from the label');
  const own = mb.books.find((b) => b.own);
  assert.equal(own.book, 'Bet105'); assert.equal(own.first.v, 3.3); assert.equal(own.now.v, 3.05); assert.equal(own.drop, r.drop);
  const bfe = mb.books.find((b) => b.book === 'Betfair Exchange');
  assert.ok(bfe.drop < 0, 'a lengthened book is kept and shown as lengthened, never dropped');
  assert.equal(bfe.margin, null, 'decision 4: no margin on an exchange');
  const sb = mb.books.find((b) => b.book === 'Superbet');
  assert.equal(sb.margin.toFixed(2), ((1 / 2.82 + 1 / 1.42 - 1) * 100).toFixed(2), 'margin from the two sides\' latest recorded prices');
  assert.equal(PAGE.summaryText(mb), 'Down 10% or more at 0 of 4 books we record quoting this line (0 of 2 sharp).');
});

test('pop-up decision 1: an unmatched row uses the endpoint lines; without them only flagged books, and the summary says so', () => {
  const r0 = frow({ id: 'superbet-16', book: 'Superbet', tier: 'Challenger', a: 'Nishesh Basavareddy', b: 'Dylan Dietrich', side: 'Nishesh Basavareddy', open: 1.68, now: 1.44 });
  const [r] = PAGE.buildRows([r0]);
  const line = { key: PAGE.lineKey(r), books: {
    Superbet: { first: [at(8 * HR), 1.68], side: [[at(8 * HR), 1.68], [at(2 * HR), 1.44]], other: [[at(8 * HR), 2.1], [at(2 * HR), 2.6]] },
    'Betfair Exchange': { first: [at(8 * HR), 1.32], side: [[at(8 * HR), 1.32], [at(1 * HR), 1.54]], other: [] } } };
  const mb = PAGE.modalBooks(r, { rows: [r], line });
  assert.equal(mb.source, 'endpoint');
  assert.deepEqual(mb.books.map((b) => b.book), ['Superbet', 'Betfair Exchange']);
  assert.equal(PAGE.summaryText(mb), 'Down 10% or more at 1 of 2 books we record quoting this line (0 of 0 sharp).');
  const flagged = PAGE.modalBooks(r, { rows: [r] });
  assert.equal(flagged.source, 'flagged');
  assert.equal(flagged.m, 1, 'never padded');
  assert.match(PAGE.summaryText(flagged), /1 of 1 books with a flagged move on this line/);
});

test('pop-up: the strip\'s Sharp/Soft is odds.md\'s table, and the JS line key is the SQL surname key', () => {
  const odds = read('.claude/rules/odds.md');
  for (const [book, cls] of Object.entries(PAGE.STRIP_CLASS)) {
    const label = book === 'Betfair Exchange' ? 'Betfair Exchange \\(recorded by us\\)' : book.replace('+', '\\+');
    const m = odds.match(new RegExp('\\|\\s*' + label + '\\s*\\|\\s*(Sharp|Soft)\\s*\\|'));
    assert.ok(m, book); assert.equal(m[1].toLowerCase(), cls, book);
  }
  // the SQL's drops_api.nk(): "Last, First" and "First Last" both key to the last surname token, a–z only
  for (const [n, k] of [['Davidovich Fokina, Alejandro', 'fokina'], ['Alejandro Davidovich Fokina', 'fokina'], ['Cerundolo, Juan Manuel', 'cerundolo'], ['Díaz', 'daz']]) {
    assert.equal(PAGE.nk(n), k, n);
  }
  const sql = read('tools/ten294-drops-lines.sql');
  assert.match(sql, /case when p like '%,%' then split_part\(p, ',', 1\) else p end/);
  assert.match(sql, /'\^\.\*\\s', ''\)\), '\[\^a-z\]', '', 'g'\)/);
});

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
    matches: board,
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

test('pop-up render: a board-matched row shows the shard\'s books, real rank/Elo/event/round and the analysis link', async () => {
  const card = { id: 'upcoming-1', p1: 'A. Mannarino', p2: 'D. Shapovalov', p1Key: 1, p2Key: 2, p1Rank: 78, p2Rank: 50, tour: 'ATP Chengdu', surface: 'hard', tournamentRound: 'ATP Chengdu - Quarter-finals' };
  const x = await openPopup({ rows: [MROW], board: [card], chart: SHARD_CHART, elo: { ratings: { 'mannarino|a': 1663, 'shapovalov|d': 1788 } } });
  const html = await x.open('bet105-9');
  assert.equal((html.match(/class="do-ov-cell/g) || []).length, 4);
  assert.match(html, /Adrian Mannarino<\/span><span class="rk">#78 · Elo 1663<\/span>/);
  assert.match(html, /Denis Shapovalov<\/span><span class="rk">#50 · Elo 1788<\/span>/);
  assert.match(html, /ATP Chengdu · Hard · QF · /);
  assert.match(html, /class="do-ov-link"[^>]*data-v="upcoming-1">Open match analysis →<\/a>/);
  assert.match(html, /Margin \d+\.\d%/);
  assert.match(html, /books we record quoting this line/);
});

test('pop-up render: an unmatched row dashes rank/Elo/event/round, has no link, and never shows the export\'s placeholder values', async () => {
  const r0 = frow({ id: 'superbet-29', book: 'Superbet', tier: 'ITF Men', a: 'Stepan Baum', b: 'Matyas Cerny', side: 'Stepan Baum', open: 3.35, now: 2.12 });
  const x = await openPopup({ rows: [r0] });
  const html = await x.open('superbet-29');
  assert.match(html, /Stepan Baum<\/span><span class="rk">— · Elo —<\/span>/);
  assert.match(html, /<span class="do-ov-meta">— · — · — · /);
  assert.doesNotMatch(html, /do-ov-link/);
  assert.match(html, /1 of 1 books with a flagged move on this line/);
  for (const bad of ['1716', '1668', '#132', '#189', 'Monteverde', 'Book A', 'Clay']) assert.ok(!html.includes(bad), bad);
});

// ── review of f143a345: lock each fix and the mutations that survived ──
test('pop-up review: the backed side can be the card\'s p2; the margin uses one source\'s own pair, not the feed\'s fresher price', () => {
  const r0 = frow({ id: 'bet105-10', a: 'Denis Shapovalov', b: 'Adrian Mannarino', side: 'Adrian Mannarino', open: 3.3, now: 2.5, latestAgo: 0.1 * HR });
  const [r] = PAGE.buildRows([r0]);
  const chart = { books: { Bet105: { p1: [[at(20 * HR), 1.36], [at(3 * HR), 1.43]], p2: [[at(20 * HR), 3.40], [at(3 * HR), 3.05]] } } };
  const mb = PAGE.modalBooks(r, { rows: [r], chart, cardSide: 'p2' });
  const own = mb.books.find((b) => b.own);
  assert.ok(own.series.some((p) => p.v === 3.05), 'the p2 series is the backed side\'s');
  assert.equal(own.margin, null, 'the source\'s latest (3.05) is not the price shown (2.50): its pair is not this price\'s margin');
  const [r2] = PAGE.buildRows([{ ...r0, latest: { at: at(3 * HR), price: '3.05' } }]);
  const own2 = PAGE.modalBooks(r2, { rows: [r2], chart, cardSide: 'p2' }).books.find((b) => b.own);
  assert.equal(own2.margin.toFixed(2), ((1 / 3.05 + 1 / 1.43 - 1) * 100).toFixed(2), 'the shard\'s own pair when it is the price shown');
});

test('pop-up review 2: an endpoint book not seen for 24 h is not quoting; every other book shows its own age', async () => {
  const [r] = PAGE.buildRows([frow({ id: 'superbet-60', book: 'Superbet', a: 'Pat Pi', b: 'Rho Rho', side: 'Pat Pi', open: 2.2, now: 1.9 })]);
  const line = { key: PAGE.lineKey(r), books: {
    Superbet: { first: [at(30 * HR), 2.2], side: [[at(2 * HR), 1.9]], other: [[at(2 * HR), 2.0]], lastSeen: at(0.1 * HR) },
    'Betfair Exchange': { first: [at(40 * HR), 2.30], side: [[at(30 * HR), 2.10]], other: [[at(30 * HR), 1.95]], lastSeen: at(28 * HR) },
    Bet105: { first: [at(40 * HR), 2.40], side: [[at(30 * HR), 2.25]], other: [[at(30 * HR), 1.70]], lastSeen: at(0.5 * HR) } } };
  const mb = PAGE.modalBooks(r, { rows: [r], line, now: PT0 });
  assert.deepEqual(mb.books.map((b) => b.book).sort(), ['Bet105', 'Superbet'], 'BFE last seen 28 h ago is left out; Bet105 re-seen 30 min ago at an unchanged price stays');
  assert.equal(mb.m, 2);
  const x = await openPopup({ rows: [frow({ id: 'superbet-60', book: 'Superbet', a: 'Pat Pi', b: 'Rho Rho', side: 'Pat Pi', open: 2.2, now: 1.9 })], lines: [line] });
  const html = await x.open('superbet-60');
  assert.match(html, /Bet105<span class="t sharp">SHARP<\/span>[^]*?<span class="r">moved 30h ago<\/span>/, 'a held price carries its own age, never reads as fresh');
  assert.doesNotMatch(html, /Betfair Exchange/);
});

test('pop-up review 2: an unchanged price reads 0.0% in the strip and the caption', async () => {
  const r0 = frow({ id: 'superbet-61', book: 'Superbet', a: 'Pat Pi', b: 'Rho Rho', side: 'Pat Pi', open: 2.2, now: 1.9 });
  const line = { key: PAGE.lineKey({ playerA: 'Pat Pi', playerB: 'Rho Rho', side: 'Pat Pi' }), books: {
    Superbet: { first: [at(30 * HR), 2.2], side: [[at(2 * HR), 1.9]], other: [], lastSeen: at(0.1 * HR) },
    'Betfair Exchange': { first: [at(20 * HR), 2.10], side: [[at(20 * HR), 2.10]], other: [], lastSeen: at(0.1 * HR) } } };
  const x = await openPopup({ rows: [r0], lines: [line] });
  let html = await x.open('superbet-61');
  assert.match(html, /<span class="d none">0\.0%<\/span>/);
  x.P._state.drBook = 'Betfair Exchange';
  html = await x.open('superbet-61');
  assert.match(html, /2\.10 → 2\.10 · 0\.0%/);
  assert.doesNotMatch(html, /▲ 0\.0%/);
});

test('pop-up review 2: the SQL rules sit in the step that uses them (block comments stripped, not just --)', () => {
  const sql = read('tools/ten294-drops-lines.sql').replace(/\/\*[^]*?\*\//g, '').replace(/--.*$/gm, '');
  const cte = (name, next) => sql.slice(sql.indexOf(name + ' as ('), sql.indexOf(next + ' as ('));
  assert.match(cte('ko', 'pts'), /and o\.side_id in \(2, 3\)/, 'the side filter is in the Bet105 step itself');
  assert.match(cte('per_side', 'per_book'), /filter \(where rn <= 1000\)[\s\S]*count\(\*\) > 1000 truncated/, 'the whole-life rule and its truncation flag are in the series step');
  assert.match(cte('per_book', 'zzz_end') || sql.slice(sql.indexOf('per_book as (')), /'lastSeen', \(select max\(p\.seen\) from pts p/);
  assert.match(cte('ko', 'pts'), /coalesce\(o\.last_seen_at, o\.inserted_on\) seen/);
  assert.match(cte('tk', 'ko'), /t\.seen_at seen/);
});

test('pop-up review 2: the board date window is ±36 h around noon UTC of the card\'s date (live UTC+2 / Kibl drift cases)', () => {
  const card = (date) => ({ p1: 'H. Gaston', p2: 'A. Rublev', p1Key: 1, p2Key: 2, date });
  const r = (start) => ({ playerA: 'Hugo Gaston', playerB: 'Andrey Rublev', side: 'Hugo Gaston', start });
  assert.ok(PAGE.boardKeyFor(r('2026-09-27T22:00:00Z'), [card('2026-09-27')]), 'the live Kibl drift case (row 27 22:00Z vs card 27)');
  assert.ok(PAGE.boardKeyFor(r('2026-09-26T01:00:00Z'), [card('2026-09-27')]), '35 h before the anchor');
  assert.equal(PAGE.boardKeyFor(r('2026-09-25T23:00:00Z'), [card('2026-09-27')]), null, '37 h before the anchor');
  assert.equal(PAGE.boardKeyFor(r('2026-09-29T01:00:00Z'), [card('2026-09-27')]), null, '37 h after the anchor');
});

test('pop-up review: the endpoint\'s first price is the book\'s first record; a quoting book that has not moved in 24 h stays in', () => {
  const [r] = PAGE.buildRows([frow({ id: 'superbet-50', book: 'Superbet', a: 'Pat Pi', b: 'Rho Rho', side: 'Pat Pi', open: 2.2, now: 1.9 })]);
  const line = { books: {
    Superbet: { first: [at(30 * HR), 2.2], side: [[at(2 * HR), 1.9]], other: [[at(2 * HR), 2.0]] },
    'Betfair Exchange': { first: [at(40 * HR), 2.30], side: [[at(30 * HR), 2.10]], other: [[at(30 * HR), 1.95]] } } };
  const mb = PAGE.modalBooks(r, { rows: [r], line });
  const bfe = mb.books.find((b) => b.book === 'Betfair Exchange');
  assert.ok(bfe, 'a flat book (last move 30 h ago) is still quoting');
  assert.equal(bfe.first.v, 2.30, 'first = the endpoint\'s first record, not the first point on the axis');
  assert.equal(bfe.now.v, 2.10);
  assert.equal(mb.m, 2);
  assert.equal(PAGE.seriesPoints(bfe.series).length, 2, 'and the chart shows its whole recorded life (opening -> now)');
  const sql = read('tools/ten294-drops-lines.sql').replace(/--.*$/gm, '');
  assert.match(sql, /filter \(where rn <= 1000\)/, 'the latest point always ships; the cap keeps the newest');
  assert.match(sql, /row_number\(\) over \(partition by k1, k2, ks, book, w order by at desc, id desc\) rn/);
  assert.match(sql, /and o\.side_id in \(2, 3\)/, 'the drop bot\'s side filter');
  assert.match(sql, /case when drops_api\.nk\(f\.player1_name\) = m\.ks then 2 when drops_api\.nk\(f\.player2_name\) = m\.ks then 3 end/, 'Kibl side 2 = player1, 3 = player2 (the bot\'s mapping)');
  assert.match(sql, /case when drops_api\.nk\(e\.home\) = m\.ks then t\.back_home when drops_api\.nk\(e\.away\) = m\.ks then t\.back_away end ps/);
  assert.ok(read('tools/ten294-drops-lines.sql').indexOf('create schema if not exists drops_api') < read('tools/ten294-drops-lines.sql').indexOf('create or replace function drops_api.nk'), 'installs on a fresh DB');
});

test('pop-up review: a board card only counts for the same event (dated within 36 h of the row\'s start)', () => {
  const r = { playerA: 'Daniil Medvedev', playerB: 'Valentin Royer', side: 'Daniil Medvedev', start: '2026-09-26T08:00:00Z' };
  const today = { p1: 'D. Medvedev', p2: 'V. Royer', p1Key: 1, p2Key: 2, date: '2026-09-26' };
  const old = { ...today, date: '2026-09-23' };
  assert.equal(PAGE.boardKeyFor(r, [old]), null, 'three days earlier is another event');
  assert.equal(PAGE.boardKeyFor(r, [old, today]).card, today, 'the old card no longer makes today\'s ambiguous');
});

test('pop-up chart review (bcee4794): a flagged-only row says only its move is loaded; the rendered chart is house blue', async () => {
  const x = pageSandbox({ feed: () => [frow({ id: 'r1', open: 2, now: 1.8 })] });
  await x.activate();
  x.st.drawer = 'r1';
  await x.activate();
  const h = x.overlay._h;
  assert.match(h, /FIRST SEEN → LATEST · UTC/);
  assert.match(h, /Only this move's recorded prices are loaded here; dashed stretches join them, nothing is interpolated\./,
    'no endpoint line and no board shard: the stretches between the row\'s four prices are not claimed as "no snapshots"');
  assert.doesNotMatch(h, /Dashed stretches had no snapshots/);
  const chart = h.slice(h.indexOf('<svg'), h.indexOf('</svg>'));
  assert.doesNotMatch(chart, /#DA6259|218,98,89/i);
  assert.match(chart, />latest \d/);
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
  assert.deepEqual(STATUS.apiNeeds([passed], none, { keys: new Map() }).days, ['2026-09-25', '2026-09-26'], 'one day per call: the start\'s day and the day before');
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
  // first initials must agree when both carry one: another Wang v Zheng is not this one
  assert.ok(!STATUS.samePair('Jiri Wang', 'Wei Zheng', 'J. Zheng', 'W. Wang'));
  assert.ok(STATUS.samePair('Jiri Wang', 'Wei Zheng', 'W. Zheng', 'J. Wang'));
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
  assert.match(sql, /from public\.live_flip_log f/);
  assert.match(sql, /from fl join rk on rk\.k1 = fl\.k1 and rk\.k2 = fl\.k2/, 'only sightings for a pair that has a row');
  assert.match(sql, /not like '%\/%'/, 'singles only');
  assert.match(sql, /from public\.live_snapshot s where s\.id = 1/);
  assert.match(sql, /'flips', v_flips, 'board', v_board/);
  const wf = read('.github/workflows/ten294-drops.yml');
  assert.match(wf, /API_TENNIS_KEY: \$\{\{ secrets\.API_TENNIS_KEY \}\}/);
  assert.match(wf, /printf 'API_TENNIS_KEY=%s\\n' "\$API_TENNIS_KEY" \| flyctl secrets import --stage -a stennisfy-drops > \/dev\/null/, 'stdin, never argv, never echoed');
  assert.ok(wf.indexOf('API_TENNIS_KEY staged') < wf.indexOf('- name: Deploy'), 'staged before the deploy applies it');
});

test('page: a cut row reads "last pre-match", its chart ends there, and the board shard is cut too', () => {
  const cut = at(2 * HR);
  const [r] = PAGE.buildRows([frow({ id: 'c1', open: 3.3, now: 3.05, latestAgo: 2.5 * HR, match: { status: 'finished', apiStatus: 'Finished', liveAt: cut, cutAt: cut, cutKind: 'live' } })]);
  assert.equal(r.vw, 'completed');
  const mb = PAGE.modalBooks(r, { rows: [r], chart: SHARD_CHART, cardSide: 'p1', now: PT0, cutAt: cut });
  mb.books.forEach((b) => b.series.forEach((p) => assert.ok(p.t < Date.parse(cut), b.book + ' has no point at or after the cut')));
  assert.equal(mb.books.find((b) => b.book === 'Superbet').now.v, 2.85, 'Superbet\'s 1 h-old price was in play; its last pre-match was 2.85');
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

test('page review: the cut applies to the other side and to other flagged rows too', () => {
  const cut = at(2 * HR);
  const M = { status: 'finished', apiStatus: 'Finished', liveAt: cut, cutAt: cut, cutKind: 'live' };
  const [r] = PAGE.buildRows([frow({ id: 'c1', open: 3.3, now: 3.05, latestAgo: 2.5 * HR, match: M })]);
  const mb = PAGE.modalBooks(r, { rows: [r], chart: SHARD_CHART, cardSide: 'p1', now: PT0, cutAt: cut });
  mb.books.forEach((b) => (b.other || []).forEach((p) => assert.ok(p.t < Date.parse(cut), b.book + ' other side cut')));
  const rows = PAGE.buildRows([frow({ id: 'o1', open: 2, now: 1.8, latestAgo: 2.5 * HR, match: M }),
    frow({ id: 'o2', book: 'Superbet', open: 2, now: 1.7, latestAgo: 1 * HR, dropAgo: 1.5 * HR, preAgo: 1.6 * HR, match: M })]);
  const fb = PAGE.modalBooks(rows[0], { rows, now: PT0, cutAt: cut }).books.find((b) => b.book === 'Superbet');
  fb.series.forEach((p) => assert.ok(p.t < Date.parse(cut), 'a flagged row\'s in-play points are not plotted'));
});
