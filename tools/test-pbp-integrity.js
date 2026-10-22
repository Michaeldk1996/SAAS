#!/usr/bin/env node
'use strict';
// Point-by-point integrity (pbp-integrity.js) — a game whose stored points step backwards is never drawn.
//
// THE MATCH: Bonzi v Norrie, Lyon R32, 2026-10-20, api-tennis event 12172010. The deployed shard (fixture
// 12172010-stored-2026-10-22.json, fetched from the live site 2026-10-22) holds 26 of 27 games as the real sequence followed
// by a replay of part of it — set 1 game 9: 15:0 30:0 40:0 30:0 40:0 30:0 40:0. The same match asked of the feed the same
// day (12172010-feed-2026-10-22.json) is clean in every game. So:
//   1. RULES     — the validator's own cases (deuce cycle legal, every regression and an A against a non-40 not).
//   2. PAGE      — the dashboard's REAL loader (loadPbpShard, stubbed fetch) feeds the stored shard to the REAL renderers
//                  (Match Stats tab sheet, the class-based log, Player Profile's panel): no drawn point list regresses,
//                  every failing game says "Point-by-point unavailable for this game", the clean feed copy draws all of
//                  its points. Remove the stamp in loadPbpShard and every check here turns red.
//   3. BUILDER   — build-point-by-point.js's REAL main(), stubbed feed: a cached garbled log of a recent match is re-asked
//                  and the feed's clean log adopted; a feed that is still garbled leaves ours as stored (never "cleaned");
//                  an old match is not re-asked.
// A check that passes on an empty set is not a check: every scenario asserts its own population first.

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const FX = path.join(__dirname, 'fixtures', 'pbp-integrity');
const EK = '12172010';
const HTML = fs.readFileSync(process.env.PBP_INTEGRITY_HTML || path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const PP2 = fs.readFileSync(process.env.PBP_INTEGRITY_PP2 || path.join(ROOT, 'player-profile-v2.js'), 'utf8');
process.env.API_TENNIS_KEY = 'stub';          // read at require time by the builder (else main() exits 0 and ends this test)
process.env.PBP_TB_FLOOR_ANNOTATE = '0';
const P = require(path.join(ROOT, 'pbp-integrity.js'));
const builder = require(path.join(ROOT, 'build-point-by-point.js'));
const STORED = () => JSON.parse(fs.readFileSync(path.join(FX, `${EK}-stored-2026-10-22.json`), 'utf8'));
const FEED = () => JSON.parse(fs.readFileSync(path.join(FX, `${EK}-feed-2026-10-22.json`), 'utf8')).result[0];
const UNAVAILABLE = 'Point-by-point unavailable for this game';

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

// ── 1. RULES ──────────────────────────────────────────────────────────────────
const pts = (...s) => s.map((x, i) => ({ n: i + 1, s: x }));
check('rules: a clean game, and the deuce/advantage cycle, pass', () => {
  assert.strictEqual(P.gameReason(pts('15 - 0', '30 - 0', '40 - 0')), null);
  assert.strictEqual(P.gameReason(pts('15 - 0', '15 - 15', '30 - 15', '30 - 30', '40 - 30', '40 - 40', 'A - 40', '40 - 40', '40 - A', '40 - 40', 'A - 40')), null);
  assert.strictEqual(P.gameReason(pts('15 - 0', ' - ', '30 - 0')), null, 'a blank entry is not a point');
});
check('rules: every regression fails — the replay, a repeat, a fall out of deuce, an A against a non-40', () => {
  assert.ok(P.gameReason(pts('15 - 0', '30 - 0', '40 - 0', '30 - 0', '40 - 0')), 'replay (set 1 game 9)');
  assert.ok(P.gameReason(pts('15 - 0', '30 - 0', '40 - 0', '40 - 0')), 'a repeated score');
  assert.ok(P.gameReason(pts('40 - 40', '40 - A', '30 - 30')), 'out of deuce back to 30:30');
  assert.ok(P.gameReason(pts('40 - 40', 'A - 40', '40 - A')), 'advantage to advantage with no deuce between');
  assert.ok(P.gameReason(pts('0 - 15', '0 - 30', '0 - 40', '0 - A')), 'A against a 0');
  assert.ok(P.gameReason(pts('40 - 40', 'A - A')), 'A - A');
});
check('rules: a tiebreak is numeric and monotonic in draw order — a duplicated row fails', () => {
  const tb = (...s) => ({ set: 1, games: [{ g: 1, score: '6 - 6', points: pts('15 - 0') }, ...s.map((x, i) => ({ g: i + 1, score: x, points: [] }))] });
  assert.strictEqual(P.checkSet(tb('1 - 0', '1 - 1', '2 - 1', '3 - 1')).tb.reason, null);
  assert.ok(P.checkSet(tb('1 - 0', '1 - 0', '2 - 0', '3 - 0')).tb.reason, 'duplicate 1-0');
  assert.ok(P.checkSet(tb('1 - 0', '2 - 0', '1 - 1', '3 - 0')).tb.reason, 'two rows on running total 2');
});
check('rules: a game header must move on from the last — a repeat (duplicated row) or a step back fails, a missing game does not', () => {
  const g = (n, score, winner) => ({ g: n, score, winner, points: pts('15 - 0') });
  const v = P.checkSet({ set: 1, games: [g(1, '1 - 0', 'p1'), g(2, '1 - 1', 'p2'), g(3, '1 - 1', 'p2'), g(4, '3 - 1', 'p1'), g(5, '2 - 2', 'p2'), g(6, '3 - 3', 'p2')] });
  assert.deepStrictEqual(v.games.map(x => x.headerOk), [true, true, false, true, false, true]);
});

// ── the fixture itself: the population the page checks run on ─────────────────
check('fixture: the stored shard fails 26 of 27 games, the feed copy fails none (else the page checks are vacuous)', () => {
  const stored = P.check(STORED()).filter(i => i.kind === 'points');
  assert.strictEqual(stored.length, 26, `stored shard: ${stored.length} failing games`);
  const fresh = builder.compactPbp(FEED().pointbypoint);
  assert.deepStrictEqual(P.check(fresh), [], 'the feed copy should pass every game and header');
  const g9 = STORED().sets[0].games.find(g => g.g === 9);
  assert.deepStrictEqual(g9.points.map(p => p.s), ['15 - 0', '30 - 0', '40 - 0', '30 - 0', '40 - 0', '30 - 0', '40 - 0'], 'set 1 game 9 as in the screenshot');
});

// ── 2. PAGE: the dashboard's real loader and renderers ─────────────────────────
function slice(name) {
  const start = HTML.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found in the page`);
  let d = 0, i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) { if (HTML[i] === '{') d++; else if (HTML[i] === '}' && --d === 0) break; }
  return HTML.slice(start, i + 1);
}
const konst = name => { const m = new RegExp(`const ${name} = [^\\n]*\\n`).exec(HTML); assert.ok(m, `const ${name} not found`); return m[0]; };
function page(shardJson) {
  const window = {};
  new Function('window', fs.readFileSync(path.join(ROOT, 'pbp-integrity.js'), 'utf8'))(window);
  const fetch = async url => { assert.ok(url.includes(`pbp/${EK}.json`), url); return { ok: true, json: async () => JSON.parse(JSON.stringify(shardJson)) }; };
  // eslint-disable-next-line no-new-func
  return new Function('PbpIntegrity', 'fetch', 'console', `
    const _pbpShards = {}, _pbpShardPromises = {};
    ${['escapeHtml', 'fhEsc', 'fhSheetSectionHead', 'pbpParseScore', 'pbpSplitSet', 'pbpPointList', 'pbpRowHtml', 'buildPointByPointHtml',
       'fhPbpSetModel', 'fhPbpMatchCtx', 'fhSheetPbpHtml', 'loadPbpShard'].map(slice).join('\n')}
    ${(() => { try { return slice('pbpStampIntegrity'); } catch (e) { return ''; } })()}
    ${konst('FH_MONO')}${konst('FH_DASHC')}${konst('PBP_LOST_TAG')}
    ${(() => { try { return konst('PBP_UNAVAILABLE_HTML'); } catch (e) { return ''; } })()}
    const PBP_BALL = '';
    return { loadPbpShard, buildPointByPointHtml, fhPbpSetModel, fhPbpMatchCtx, fhSheetPbpHtml };
  `)(window.PbpIntegrity, fetch, { warn() {}, log() {} });
}
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
// Every drawn point list in a rendered set, as score strings "a - b" (the renderers print "a:b").
function drawnSequences(html, gameSplit) {
  return html.split(gameSplit).slice(1).map(chunk => (text(chunk).match(/\b(?:0|15|30|40|A):(?:0|15|30|40|A)\b/g) || [])
    .map(s => s.replace(':', ' - ')));
}
async function renderAll(shardJson) {
  const pg = page(shardJson);
  const sh = await pg.loadPbpShard(EK);
  const ctx = pg.fhPbpMatchCtx(sh, 3);
  const sheet = sh.sets.map(st => pg.fhSheetPbpHtml(pg.fhPbpSetModel(st, ctx[st.set])));
  const classic = sh.sets.map(st => pg.buildPointByPointHtml({ p1: sh.p1, p2: sh.p2 }, sh, st.set));
  return { sh, sheet, classic };
}

const pageChecks = [];
const pcheck = (name, fn) => pageChecks.push([name, fn]);
pcheck('page · Match Stats sheet (the screenshot\'s renderer): no drawn sequence regresses; 26 games say unavailable', async () => {
  const { sheet } = await renderAll(STORED());
  const seqs = sheet.flatMap(h => drawnSequences(h, 'class="ma-pbp-game"'));
  assert.strictEqual(seqs.length, 27, `expected 27 game rows, drew ${seqs.length}`);
  const bad = seqs.filter(s => s.length && P.gameReason(s.map(x => ({ s: x }))));
  assert.deepStrictEqual(bad, [], `regressed sequences were drawn: ${JSON.stringify(bad.slice(0, 2))}`);
  const n = sheet.join('').split(UNAVAILABLE).length - 1;
  assert.strictEqual(n, 26, `"${UNAVAILABLE}" drawn ${n} times`);
  assert.ok(/15:0[\s\S]*30:0[\s\S]*40:0/.test(text(sheet[1])), 'the one clean game (set 2, 2-2: 15:0 30:0 40:0) is still drawn');
});
pcheck('page · Match Stats sheet: headers that follow the set still show (4 · 2 etc.)', async () => {
  const { sheet } = await renderAll(STORED());
  const s1 = text(sheet[0]);
  for (const h of ['1 · 0', '2 · 1', '4 · 2', '6 · 3']) assert.ok(s1.includes(h), `set 1 header ${h} missing`);
});
pcheck('page · class-based log (Form rows / match-detail panels): no drawn sequence regresses', async () => {
  const { classic } = await renderAll(STORED());
  const seqs = classic.flatMap(h => drawnSequences(h, 'class="pbp-grow"'));
  assert.strictEqual(seqs.length, 27, `expected 27 game rows, drew ${seqs.length}`);
  const bad = seqs.filter(s => s.length && P.gameReason(s.map(x => ({ s: x }))));
  assert.deepStrictEqual(bad, [], `regressed sequences were drawn: ${JSON.stringify(bad.slice(0, 2))}`);
  assert.strictEqual(classic.join('').split(UNAVAILABLE).length - 1, 26);
});
pcheck('page · Player Profile match panel (Points): no drawn sequence regresses', async () => {
  const pg = page(STORED());
  const sh = await pg.loadPbpShard(EK);
  const MATCH = { date: '2026-10-20', opponent: 'C. Norrie', tournament: 'Lyon', round: 'R32', surface: 'hard', won: true, eventKey: Number(EK), result: '2 - 1',
    sets: [{ p: 6, o: 3 }, { p: 3, o: 6 }, { p: 6, o: 3 }] };
  const SUBJECT = { key: 4242, name: 'B. Bonzi', recentForm: { pct: 0, matches: [MATCH] } };
  const sandbox = { FEATURE_PP2: true, playerProfiles: { players: { 4242: SUBJECT } }, matchStats: {},
    pbpIndex: new Set([EK]), setStatsIndex: new Set(), matchStatsIndex: new Set(), pbpShards: { [EK]: sh }, setStatsShards: { [EK]: { p1Key: 4242, p2Key: 7777, sets: null, match: null } } };   // keys orient the log
  global.window = sandbox;
  new Function('window', PP2)(sandbox);
  const I = sandbox.PlayerProfileV2._internals;
  I.state.key = 4242; I.state.mpTab = 'points';
  let seqs = [], unavailable = 0;
  for (const set of ['1', '2', '3']) {
    I.state.mpPointSet = set;
    const html = I.renderMatchPanel(SUBJECT, I.build(SUBJECT), '2026-10-20|C. Norrie');
    unavailable += html.split(UNAVAILABLE).length - 1;
    seqs = seqs.concat(html.split('<div style="padding:16px 4px;border-bottom:1px solid var(--line);">').slice(1)
      .map(c => (text(c).match(/\b(?:0|15|30|40|A) - (?:0|15|30|40|A)\b/g) || [])));
  }
  delete global.window;
  assert.strictEqual(seqs.length, 27, `expected 27 game rows, drew ${seqs.length}`);
  const bad = seqs.filter(s => s.length && P.gameReason(s.map(x => ({ s: x }))));
  assert.deepStrictEqual(bad, [], `regressed sequences were drawn: ${JSON.stringify(bad.slice(0, 2))}`);
  assert.strictEqual(unavailable, 26, `"${UNAVAILABLE}" drawn ${unavailable} times`);
});
pcheck('page · the feed\'s clean copy draws every point and no "unavailable" (the guard does not over-block)', async () => {
  const clean = { p1: 'B. Bonzi', p2: 'C. Norrie', sets: builder.compactPbp(FEED().pointbypoint).sets };
  const { sheet, classic } = await renderAll(clean);
  assert.ok(!sheet.join('').includes(UNAVAILABLE) && !classic.join('').includes(UNAVAILABLE));
  const drawn = sheet.flatMap(h => drawnSequences(h, 'class="ma-pbp-game"')).reduce((a, s) => a + s.length, 0);
  const held = clean.sets.reduce((a, st) => a + st.games.reduce((b, g) => b + g.points.length, 0), 0);
  assert.strictEqual(drawn, held, `drew ${drawn} of ${held} points`);
});
pcheck('page · the loader logs the match id of a failing log', async () => {
  const window = {}; new Function('window', fs.readFileSync(path.join(ROOT, 'pbp-integrity.js'), 'utf8'))(window);
  const warned = [];
  const load = new Function('PbpIntegrity', 'fetch', 'console', `const _pbpShards = {}, _pbpShardPromises = {};\n${slice('loadPbpShard')}\n${slice('pbpStampIntegrity')}\nreturn loadPbpShard;`)(
    window.PbpIntegrity, async () => ({ ok: true, json: async () => STORED() }), { warn: (...a) => warned.push(a.join(' ')) });
  await load(EK);
  assert.ok(warned.some(w => w.includes(`pbp ${EK}: 26 game(s)`)), `no warning naming ${EK}: ${JSON.stringify(warned)}`);
});

// ── 3. BUILDER: build-point-by-point.js main(), stubbed feed ────────────────────
const realFetch = global.fetch;
async function runBuilder({ cache, matches, feed }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbp-integrity-'));
  const cwd = process.cwd();
  fs.writeFileSync(path.join(dir, 'matches.json'), JSON.stringify({ matches }));
  fs.writeFileSync(path.join(dir, 'point-by-point-cache.json'), JSON.stringify(cache));
  const calls = [], logs = [];
  global.fetch = async url => { const ek = /match_key=(\d+)/.exec(url)[1]; calls.push(ek); return { ok: true, status: 200, json: async () => ({ success: 1, result: [feed(ek)] }) }; };
  const log = console.log; console.log = (...a) => logs.push(a.join(' '));
  try { process.chdir(dir); await builder.main(); }
  finally { process.chdir(cwd); global.fetch = realFetch; console.log = log; }
  const read = f => fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) : null;
  return { calls, logs, cache: read('point-by-point-cache.json'), shard: read(`pbp/${EK}.json`), out: read('point-by-point.json') };
}
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const storedEntry = () => { const s = STORED(); return { p1: s.p1, p2: s.p2, sets: s.sets, p1Key: 1, p2Key: 2, stats: null, matchStats: null }; };
const windowMatch = date => [{ id: `past-${EK}`, date, finalScore: { display: '6-3, 3-6, 6-3' }, p1: 'B. Bonzi', p2: 'C. Norrie' }];
const failing = sh => P.check(sh).filter(i => i.kind === 'points').length;

pcheck('builder · a recent cached garbled log is re-asked and the feed\'s clean log adopted (shard + sidecar)', async () => {
  const r = await runBuilder({ cache: { [EK]: storedEntry() }, matches: windowMatch(daysAgo(2)), feed: () => FEED() });
  assert.deepStrictEqual(r.calls, [EK], 'exactly one re-fetch, or the scenario is vacuous');
  assert.strictEqual(failing(r.shard), 0, `the shard still holds ${failing(r.shard)} failing games`);
  assert.strictEqual(failing(r.out[EK]), 0, 'point-by-point.json still holds the garbled log');
  assert.strictEqual(r.shard.p1, 'B. Bonzi');
  assert.ok(r.cache[EK].pbpRecheckAt, 'the re-check time is recorded');
  assert.ok(r.logs.some(l => /pbp-integrity: 12172010 re-fetched/.test(l)), 'the adoption is logged');
});
pcheck('builder · a feed that is still garbled leaves the stored log exactly as it was (never cleaned) and names it in the log', async () => {
  const garbledFeed = () => { const f = FEED(); const s = STORED();
    f.pointbypoint = f.pointbypoint.map(g => { const st = s.sets.find(x => x.set === Number(String(g.set_number).replace(/\D/g, ''))); const sg = st && st.games.find(x => x.g === Number(g.number_game));
      return sg ? { ...g, points: sg.points.map(p => ({ number_point: String(p.n), score: p.s })) } : g; }); return f; };
  const r = await runBuilder({ cache: { [EK]: storedEntry() }, matches: windowMatch(daysAgo(1)), feed: garbledFeed });
  assert.deepStrictEqual(r.calls, [EK], 'exactly one re-fetch');
  assert.deepStrictEqual(r.shard.sets, STORED().sets, 'the stored log was altered');
  assert.ok(r.logs.some(l => /pbp-integrity: 1 of 1 shards .*12172010/.test(l)), `failing shard not named: ${r.logs.filter(l => /pbp-integrity/.test(l)).join(' | ')}`);
});
pcheck('builder · an old match is not re-asked; a re-check inside the hour is not repeated', async () => {
  const old = await runBuilder({ cache: { [EK]: storedEntry() }, matches: windowMatch(daysAgo(30)), feed: () => FEED() });
  assert.deepStrictEqual(old.calls, [], 'an old match was re-asked');
  const e = storedEntry(); e.pbpRecheckAt = new Date(Date.now() - 10 * 6e4).toISOString();
  const soon = await runBuilder({ cache: { [EK]: e }, matches: windowMatch(daysAgo(1)), feed: () => FEED() });
  assert.deepStrictEqual(soon.calls, [], 're-asked within the hour');
});

(async () => {
  let pass = 0, fail = 0;
  console.log('\npoint-by-point integrity\n');
  for (const [name, fn] of [...checks, ...pageChecks]) {
    try { await fn(); console.log(`  ok  ${name}`); pass++; }
    catch (e) { console.log(`  FAIL ${name}\n       ${e.message.split('\n')[0]}`); fail++; }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
