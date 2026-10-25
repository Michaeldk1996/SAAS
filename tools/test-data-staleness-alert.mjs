// Founder brief "round 2" item 1.5 (2026-10-25) — tools/data-staleness-alert.mjs with a fake clock, fixture
// build-info.json bodies and a fake Telegram: no network. One message when the published data first passes 60 min, at
// most one an hour while the same stale build lasts, at once for a new stale build; an unreadable build-info.json alerts
// only after every try in the pass failed; an undelivered message is not recorded (retried next pass); the wiring.
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, readBuildInfo, run, STALE_AFTER_MIN, REPEAT_MIN } from './data-staleness-alert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m + '\n        ' + d); } };
const MIN = 60000;
const T0 = Date.UTC(2026, 9, 25, 0, 13, 5);   // data.builtAt of the fixture
// The live shape (read 2026-10-25 00:40Z), trimmed.
const info = (dataBuilt = T0, pubBuilt = T0 + 3 * MIN) => ({ commit: 'fbb823e3', builtAt: new Date(pubBuilt).toISOString(), publishedBy: 'publish.yml',
  data: { runId: '40143787576', commit: '953a1488', builtAt: new Date(dataBuilt).toISOString() } });
const good = (i = info()) => ({ ok: true, info: i, tries: 1 });
const at = (m) => T0 + m * MIN;

ok(STALE_AFTER_MIN === 60 && REPEAT_MIN === 60, 'thresholds are the brief\'s: 60 min stale, at most hourly');
// ── the decision, fake clock ──
let d = decide({ now: at(60), read: good(), prev: null });
ok(!d.alert, 'exactly 60 min old is not yet stale (more than 60)', JSON.stringify(d));
d = decide({ now: at(61), read: good(), prev: null });
ok(d.alert && /data is stale/.test(d.text) && /2026-10-25 00:13Z, 61 min ago/.test(d.text) && d.state.episode === `stale:${T0}` && d.state.at === at(61),
  '61 min old, no prior alert → ONE message naming the data build time and age', JSON.stringify(d));
ok(/Last publish: 2026-10-25 00:16Z/.test(d.text), 'the message also names the publish time (builtAt), so a fresh publish of old data reads as such', d.text);
const fresh = info(at(100), at(101));
d = decide({ now: at(110), read: good(fresh), prev: null });
ok(!d.alert, 'measures data.builtAt, not the top-level builtAt: old publish + fresh data → nothing', JSON.stringify(d));
d = decide({ now: at(130), read: good(info(T0, at(125))), prev: null });
ok(d.alert, 'a fresh publish (builtAt 5 min old) of 130-min-old data still alerts', JSON.stringify(d));
let prev = { episode: `stale:${T0}`, at: at(61) };
d = decide({ now: at(76), read: good(), prev });
ok(!d.alert, 'same stale build, 15 min after the alert → nothing', JSON.stringify(d));
d = decide({ now: at(120), read: good(), prev });
ok(!d.alert, 'same stale build, 59 min after the alert → nothing', JSON.stringify(d));
d = decide({ now: at(121), read: good(), prev });
ok(d.alert && /^Still: /.test(d.text) && d.state.at === at(121), 'same stale build, 60 min after the alert → one repeat, marked "Still:"', JSON.stringify(d));
d = decide({ now: at(90), read: good(info(at(25))), prev });
ok(d.alert && !/^Still/.test(d.text) && d.state.episode === `stale:${at(25)}`, 'a NEW stale build 29 min after the last alert → alerts at once (new episode)', JSON.stringify(d));
// a full 15-min schedule: one message at the crossing, one an hour after — 3 over 3 hours, not 12
let state = null, sent = [];
for (let m = 0; m <= 240; m += 15) { const x = decide({ now: at(m), read: good(), prev: state }); if (x.alert) { sent.push(m); state = x.state; } }
ok(sent.join(',') === '75,135,195', 'every 15 min for 4 h: alerts at 75, 135, 195 min only', sent.join(','));
// a dropped tick only delays: never a second message inside the hour, never a missed one
state = null; sent = [];
for (const m of [5, 20, 107, 108, 150, 168, 169]) { const x = decide({ now: at(m), read: good(), prev: state }); if (x.alert) { sent.push(m); state = x.state; } }
ok(sent.join(',') === '107,168', 'irregular ticks (throttled schedule): first tick past 60, then the first tick 60+ min later', sent.join(','));
// unreadable
const bad = { ok: false, why: 'HTTP 404', tries: 3 };
d = decide({ now: at(0), read: bad, prev: null });
ok(d.alert && /could not be read \(HTTP 404, 3 tries/.test(d.text) && d.state.episode === 'unread', 'build-info.json unreadable after every try → a message that says so', JSON.stringify(d));
d = decide({ now: at(30), read: bad, prev: d.state });
ok(!d.alert, 'still unreadable 30 min later → nothing (hourly limit)', JSON.stringify(d));
d = decide({ now: at(90), read: good(), prev: { episode: 'unread', at: at(70) } });
ok(d.alert && /stale/.test(d.text), 'readable again but stale → a stale alert at once (a different thing to say)', JSON.stringify(d));

// ── the read: retries, reasons ──
const resp = (status, body) => ({ status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const seq = (list) => { let i = 0; const urls = []; const f = async (u) => { urls.push(u); const x = list[Math.min(i++, list.length - 1)]; if (x instanceof Error) throw x; return x; }; f.urls = urls; return f; };
const sleeps = []; const sleep = async (ms) => { sleeps.push(ms); };
let f = seq([new TypeError('fetch failed'), resp(503, 'x'), resp(200, info())]);
let r = await readBuildInfo('https://x/SAAS/', { now: 7, fetchImpl: f, sleep, gapMs: 30000 });
ok(r.ok && r.tries === 3 && f.urls.length === 3 && sleeps.join(',') === '30000,30000', 'two failures then a read inside one pass → read, no alert material (a blip is retried, 30 s apart)', JSON.stringify(r) + ' ' + sleeps);
ok(f.urls[0] === 'https://x/SAAS/build-info.json?cb=7', 'cache-busted URL, no double slash', f.urls[0]);
f = seq([resp(200, info())]); sleeps.length = 0;
r = await readBuildInfo('https://x/SAAS', { fetchImpl: f, sleep });
ok(r.ok && f.urls.length === 1 && sleeps.length === 0, 'a good first read does not retry or wait');
f = seq([resp(404, 'nope')]);
r = await readBuildInfo('https://x', { fetchImpl: f, sleep });
ok(!r.ok && r.why === 'HTTP 404' && r.tries === 3 && f.urls.length === 3, 'three 404s → unreadable, HTTP 404', JSON.stringify(r));
r = await readBuildInfo('https://x', { fetchImpl: seq([resp(200, '<html>')]), sleep });
ok(!r.ok && r.why === 'not valid JSON', 'HTML instead of JSON → unreadable', JSON.stringify(r));
r = await readBuildInfo('https://x', { fetchImpl: seq([resp(200, { builtAt: new Date(T0).toISOString() })]), sleep });
ok(!r.ok && r.why === 'no valid data.builtAt', 'no data.builtAt (only the publish time) → unreadable, never read as fresh', JSON.stringify(r));

// ── one pass end to end: fake Telegram, temp state file ──
let tgStatus = 200; const tg = [];
const srv = createServer((req, res) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { tg.push({ url: req.url, body: JSON.parse(b || '{}') }); res.writeHead(tgStatus); res.end('{}'); }); });
await new Promise((x) => srv.listen(0, '127.0.0.1', x));
const dir = mkdtempSync(join(tmpdir(), 'stale-alert-'));
const env = { SITE_URL: 'https://x/SAAS', STATE_FILE: join(dir, 'st', 'state.json'), GITHUB_OUTPUT: join(dir, 'out'), GITHUB_STEP_SUMMARY: join(dir, 'sum'),
  TELEGRAM_API_URL: `http://127.0.0.1:${srv.address().port}`, TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '42', FETCH_GAP_MS: '0' };
const quiet = () => {};
let p = await run(env, { now: at(30), fetchImpl: seq([resp(200, info())]), log: quiet });
ok(!p.sent && tg.length === 0 && !existsSync(env.STATE_FILE), 'fresh pass: no message, no state written');
tgStatus = 500;
p = await run(env, { now: at(70), fetchImpl: seq([resp(200, info())]), log: quiet });
ok(tg.length === 1 && !p.save && !existsSync(env.STATE_FILE) && /NOT sent \(HTTP 500\)/.test(readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8')),
  'Telegram refuses → no state saved (next pass retries), step summary says NOT sent', JSON.stringify(p));
tgStatus = 200;
p = await run(env, { now: at(85), fetchImpl: seq([resp(200, info())]), log: quiet });
ok(tg.length === 2 && p.save && tg[1].url === '/bottok/sendMessage' && tg[1].body.chat_id === '42' && /stale/.test(tg[1].body.text)
  && JSON.parse(readFileSync(env.STATE_FILE, 'utf8')).at === at(85) && /save=true/.test(readFileSync(env.GITHUB_OUTPUT, 'utf8')),
  'next pass delivers → state saved, save=true for the cache step', JSON.stringify(tg[1]));
p = await run(env, { now: at(100), fetchImpl: seq([resp(200, info())]), log: quiet });
ok(tg.length === 2 && !p.save, 'the pass after (state restored) → nothing');
p = await run(env, { now: at(146), fetchImpl: seq([resp(200, info())]), log: quiet });
ok(tg.length === 3 && /^Still: /.test(tg[2].body.text), 'an hour later → the one repeat');
srv.close(); rmSync(dir, { recursive: true, force: true });

// ── wiring ──
const y = readFileSync(join(ROOT, '.github/workflows/data-staleness-alert.yml'), 'utf8');
ok(/cron: '\*\/15 \* \* \* \*'/.test(y), 'scheduled every 15 min');
ok(/workflows: \['BSP data pipeline', 'BSP oddspapi post-match archive'\]/.test(y), 'also rides on the two pg_cron-pinged workflows (schedule is throttled here)');
ok(/if: github\.ref == 'refs\/heads\/main'/.test(y) && /ref: main/.test(y), 'runs from main only');
ok(/cancel-in-progress: false/.test(y), 'one pass at a time, never cut off (so each pass restores the last save)');
ok(/node tools\/data-staleness-alert\.mjs/.test(y) && /TELEGRAM_BOT_TOKEN: \$\{\{ secrets\.TELEGRAM_BOT_TOKEN \}\}/.test(y) && /TELEGRAM_CHAT_ID: \$\{\{ secrets\.TELEGRAM_CHAT_ID \}\}/.test(y),
  'the existing Telegram secrets');
ok(/SITE_URL: https:\/\/michaeldk1996\.github\.io\/SAAS\n/.test(y), 'reads the live site');
const restore = y.slice(y.indexOf('actions/cache/restore@v4')), save = y.slice(y.indexOf('actions/cache/save@v4'));
ok(/restore-keys: data-staleness-alert-\n/.test(restore) && /path: \.data-staleness-alert\n/.test(restore) && /STATE_FILE: \.data-staleness-alert\/state\.json/.test(y),
  'state restored by prefix into the path the script reads');
ok(/if: steps\.alert\.outputs\.save == 'true'/.test(y.slice(y.indexOf('Save the alert'))) && /path: \.data-staleness-alert\n/.test(save)
  && /key: data-staleness-alert-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/.test(save), 'saved under a unique key, only after a delivered message');
ok(y.indexOf('cache/restore') < y.indexOf('node tools/data-staleness-alert.mjs') && y.indexOf('node tools/data-staleness-alert.mjs') < y.indexOf('cache/save'), 'restore → decide → save, in that order');
const src = readFileSync(join(ROOT, 'tools/data-staleness-alert.mjs'), 'utf8');
ok(!/process\.exit\(1\)/.test(src), 'an unsent or unreadable alert never fails the job (an ::error:: instead)');
console.log(`\ntest-data-staleness-alert: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
