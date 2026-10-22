#!/usr/bin/env node
'use strict';
// Point-by-point: our copy is the provider's latest, provable duplicates are deleted, everything else is drawn as received.
//
// THE MATCH: Bonzi v Norrie, Lyon R32, 2026-10-20, api-tennis event 12172010. The shard we served (fixture
// 12172010-stored-2026-10-22.json, read from the live site 2026-10-22) holds 26 of 27 games as the provider's sequence with
// a replay appended — set 1 game 9: 15:0 30:0 40:0 30:0 40:0 30:0 40:0 — because the builder fetched the log once, while
// the provider still had it garbled, and kept it forever. The provider's log the same day
// (12172010-feed-2026-10-22.json) is clean in every game. Founder brief 2026-10-22:
//   1. RULES    — pbp-integrity.js check: forward only, the deuce cycle and gaps are legal, the 7-6 set-closing row is not
//                 a tiebreak point; it decides what is listed, never what is drawn.
//   2. REPAIR   — deletion only: an exact tiebreak duplicate, the same score twice in a row, a replayed game whose first run
//                 ends on the header winner's game point. A kept point is always a point of the input, in order.
//   3. PAGE     — the dashboard's REAL loader and the three REAL renderers draw every point of a shard (no dash).
//   4. BUILDER  — build-point-by-point.js's REAL main(), stubbed feed: a fetch REPLACES the stored log with the provider's
//                 (the old append behaviour turns these red), ours is kept only when the provider's is shorter, the shard
//                 is the repaired log, every repair is in pbp-repairs.json, the re-ask schedule holds, and a replacement
//                 asks for a cache save.
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
process.env.API_TENNIS_KEY = 'stub';          // read at require time by the builder (else main() exits early and ends this test)
process.env.PBP_TB_FLOOR_ANNOTATE = '0';
const P = require(path.join(ROOT, 'pbp-integrity.js'));
const builder = require(path.join(ROOT, 'build-point-by-point.js'));
const STORED = () => JSON.parse(fs.readFileSync(path.join(FX, `${EK}-stored-2026-10-22.json`), 'utf8'));
const FEED = () => JSON.parse(fs.readFileSync(path.join(FX, `${EK}-feed-2026-10-22.json`), 'utf8')).result[0];
const FEED_SETS = () => builder.compactPbp(FEED().pointbypoint).sets;
const UNAVAILABLE = 'Point-by-point unavailable';
// a log reduced to what the page shows: set, game number, header and point scores
const shape = sets => sets.map(s => ({ set: s.set, games: s.games.map(g => [g.g, g.score, (g.points || []).map(p => p.s)]) }));
const pointCount = sets => sets.reduce((a, s) => a + s.games.reduce((b, g) => b + (g.points || []).length, 0), 0);

const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const pts = (...s) => s.map((x, i) => ({ n: i + 1, s: x }));

// ── 1. RULES ──────────────────────────────────────────────────────────────────
check('rules: a clean game, the deuce cycle, a gap and an advantage swap pass', () => {
  assert.strictEqual(P.gameReason(pts('15 - 0', '30 - 0', '40 - 0')), null);
  assert.strictEqual(P.gameReason(pts('40 - 40', 'A - 40', '40 - 40', '40 - A', '40 - 40', 'A - 40')), null);
  assert.strictEqual(P.gameReason(pts('15 - 0', '40 - 0')), null, 'a missing point is a gap, not impossible');
  assert.strictEqual(P.gameReason(pts('40 - 40', 'A - 40', '40 - A')), null, 'advantage to advantage: the 40:40 is missing');
});
check('rules: a replay, a repeat, a fall out of deuce, an A against a non-40 fail', () => {
  assert.ok(P.gameReason(pts('15 - 0', '30 - 0', '40 - 0', '30 - 0', '40 - 0')));
  assert.ok(P.gameReason(pts('15 - 0', '30 - 0', '30 - 0')));
  assert.ok(P.gameReason(pts('40 - 40', '40 - A', '30 - 30')));
  assert.ok(P.gameReason(pts('0 - 15', '0 - A')));
});
check('rules: the provider\'s 7-6 set-closing row is not a second tiebreak point; a real duplicate still fails', () => {
  const g = (n, score, points = []) => ({ g: n, score, points });
  const games = Array.from({ length: 12 }, (_, i) => g(i + 1, `${Math.ceil((i + 1) / 2)} - ${Math.floor((i + 1) / 2)}`, pts('15 - 0')));
  const tb = ['1 - 0', '2 - 0', '3 - 0', '4 - 0', '5 - 0', '6 - 0', '6 - 1', '6 - 2', '6 - 3', '6 - 4', '6 - 5', '6 - 6', '7 - 6', '8 - 6'].map((s, i) => g(i + 1, s));
  assert.strictEqual(P.checkSet({ set: 2, games: [...games, ...tb, g(13, '7 - 6')] }).tb.reason, null, 'closer listed last (12172316)');
  assert.strictEqual(P.checkSet({ set: 2, games: [...games, g(13, '7 - 6'), ...tb] }).tb.reason, null, 'closer listed first (12170854)');
  assert.ok(P.checkSet({ set: 2, games: [...games, g(1, '1 - 0'), ...tb] }).tb.reason, 'a duplicated tiebreak point');
});

// ── 2. REPAIR ─────────────────────────────────────────────────────────────────
const set1 = games => ({ sets: [{ set: 1, games }] });
const gm = (n, score, winner, ...p) => ({ g: n, score, winner, server: 'p1', points: pts(...p) });
const isSubsequence = (kept, all) => { let i = 0; for (const x of all) if (i < kept.length && x === kept[i]) i++; return i === kept.length; };
check('repair: a replayed game keeps its first run when it ends on the header winner\'s game point', () => {
  const r = P.repair(set1([gm(1, '1 - 0', 'p1', '15 - 0', '30 - 0', '40 - 0', '30 - 0', '40 - 0')]));
  assert.deepStrictEqual(r.sets[0].games[0].points.map(p => p.s), ['15 - 0', '30 - 0', '40 - 0']);
  assert.deepStrictEqual(r.repairs.map(x => x.rule), ['replayed-game']);
});
check('repair: a first run that does not end on the winner\'s game point is left exactly as received', () => {
  const input = set1([gm(1, '0 - 1', 'p2', '15 - 0', '30 - 0', '15 - 0', '15 - 15')]);   // header: p2 won; first run ends 30:0
  const r = P.repair(input);
  assert.deepStrictEqual(r.sets[0].games[0].points.map(p => p.s), ['15 - 0', '30 - 0', '15 - 0', '15 - 15']);
  assert.strictEqual(r.repairs.length, 0);
});
check('repair: the same score twice in a row keeps one; an exact tiebreak duplicate keeps one', () => {
  const r1 = P.repair(set1([gm(1, '1 - 0', 'p1', '15 - 0', '15 - 0', '30 - 0', '40 - 0')]));
  assert.deepStrictEqual(r1.sets[0].games[0].points.map(p => p.s), ['15 - 0', '30 - 0', '40 - 0']);
  const tb = (n, s) => ({ g: n, score: s, points: [] });
  const r2 = P.repair(set1([gm(1, '1 - 0', 'p1', '40 - 0'), tb(1, '1 - 0'), tb(1, '1 - 0'), tb(2, '2 - 0'), tb(3, '3 - 0')]));
  assert.deepStrictEqual(r2.sets[0].games.filter(P.isTbRow).map(g => g.score), ['1 - 0', '2 - 0', '3 - 0']);
  assert.deepStrictEqual(r2.repairs.map(x => x.rule), ['tiebreak-duplicate']);
});
check('repair: deletion only — every kept point is an input point, in order, on every game of the stored shard', () => {
  const st = STORED(), r = P.repair(st);
  st.sets.forEach((s, i) => s.games.forEach((g, j) => {
    assert.ok(isSubsequence(r.sets[i].games[j].points.map(p => p.s), (g.points || []).map(p => p.s)), `set ${s.set} game ${g.g}`);
    assert.strictEqual(r.sets[i].games[j].score, g.score, 'a header was changed');
  }));
});

// ── the fixture: the population everything below runs on ──────────────────────
check('fixture: the stored shard fails 26 of 27 games; the provider\'s log fails none; deleting the replays gives exactly the provider\'s log', () => {
  assert.strictEqual(P.check(STORED()).filter(i => i.kind === 'points').length, 26);
  assert.deepStrictEqual(P.check({ sets: FEED_SETS() }), []);
  assert.deepStrictEqual(shape(P.repair(STORED()).sets), shape(FEED_SETS()), 'repaired stored log != provider log');
});

// ── 3. PAGE: the dashboard's real loader and renderers ─────────────────────────
function slice(name) {
  const start = HTML.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found in the page`);
  let d = 0, i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) { if (HTML[i] === '{') d++; else if (HTML[i] === '}' && --d === 0) break; }
  return HTML.slice(start, i + 1);
}
const konst = name => { const m = new RegExp(`const ${name} = [^\\n]*\\n`).exec(HTML); assert.ok(m, `const ${name} not found`); return m[0]; };
const integrityWindow = () => { const w = {}; new Function('window', fs.readFileSync(path.join(ROOT, 'pbp-integrity.js'), 'utf8'))(w); return w; };
function page(shardJson, warned = []) {
  const fetch = async url => { assert.ok(url.includes(`pbp/${EK}.json`), url); return { ok: true, json: async () => JSON.parse(JSON.stringify(shardJson)) }; };
  // eslint-disable-next-line no-new-func
  return new Function('PbpIntegrity', 'fetch', 'console', `
    const _pbpShards = {}, _pbpShardPromises = {};
    ${['escapeHtml', 'fhEsc', 'fhSheetSectionHead', 'pbpParseScore', 'pbpSplitSet', 'pbpPointList', 'pbpRowHtml', 'buildPointByPointHtml',
       'fhPbpSetModel', 'fhPbpMatchCtx', 'fhSheetPbpHtml', 'loadPbpShard', 'pbpStampIntegrity'].map(slice).join('\n')}
    ${konst('FH_MONO')}${konst('FH_DASHC')}${konst('PBP_LOST_TAG')}
    const PBP_BALL = '';
    return { loadPbpShard, buildPointByPointHtml, fhPbpSetModel, fhPbpMatchCtx, fhSheetPbpHtml };
  `)(integrityWindow().PbpIntegrity, fetch, { warn: (...a) => warned.push(a.join(' ')), log() {} });
}
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const tokens = h => (text(h).match(/\b(?:0|15|30|40|A):(?:0|15|30|40|A)\b/g) || []).length;

check('page · Match Stats sheet and the class-based log draw every stored point, no dash', async () => {
  const st = STORED(), pg = page(st);
  const sh = await pg.loadPbpShard(EK);
  const ctx = pg.fhPbpMatchCtx(sh, 3);
  const sheet = sh.sets.map(s => pg.fhSheetPbpHtml(pg.fhPbpSetModel(s, ctx[s.set]))).join('');
  const classic = sh.sets.map(s => pg.buildPointByPointHtml({ p1: sh.p1, p2: sh.p2 }, sh, s.set)).join('');
  const held = pointCount(st.sets);
  assert.ok(held > 300, `fixture too small: ${held}`);
  assert.strictEqual(tokens(sheet), held, 'Match Stats sheet');
  assert.strictEqual(tokens(classic), held, 'class-based log');
  assert.ok(!sheet.includes(UNAVAILABLE) && !classic.includes(UNAVAILABLE), 'a dash is drawn');
});
check('page · Player Profile match panel draws every stored point, no dash', async () => {
  const sh = await page(STORED()).loadPbpShard(EK);
  const MATCH = { date: '2026-10-20', opponent: 'C. Norrie', tournament: 'Lyon', round: 'R32', surface: 'hard', won: true, eventKey: Number(EK), result: '2 - 1',
    sets: [{ p: 6, o: 3 }, { p: 3, o: 6 }, { p: 6, o: 3 }] };
  const SUBJECT = { key: 4242, name: 'B. Bonzi', recentForm: { pct: 0, matches: [MATCH] } };
  const sandbox = { FEATURE_PP2: true, playerProfiles: { players: { 4242: SUBJECT } }, matchStats: {},
    pbpIndex: new Set([EK]), setStatsIndex: new Set(), matchStatsIndex: new Set(), pbpShards: { [EK]: sh },
    setStatsShards: { [EK]: { p1Key: 4242, p2Key: 7777, sets: null, match: null } } };   // keys orient the log
  global.window = sandbox;
  new Function('window', PP2)(sandbox);
  const I = sandbox.PlayerProfileV2._internals;
  I.state.key = 4242; I.state.mpTab = 'points';
  let drawn = 0, html = '';
  for (const set of ['1', '2', '3']) {
    I.state.mpPointSet = set;
    const h = I.renderMatchPanel(SUBJECT, I.build(SUBJECT), '2026-10-20|C. Norrie');
    html += h; drawn += (text(h).match(/\b(?:0|15|30|40|A) - (?:0|15|30|40|A)\b/g) || []).length;
  }
  delete global.window;
  assert.strictEqual(drawn, pointCount(STORED().sets));
  assert.ok(!html.includes(UNAVAILABLE));
});
check('page · the loader logs the match id of a log that still fails the check', async () => {
  const warned = [];
  await page(STORED(), warned).loadPbpShard(EK);
  assert.ok(warned.some(w => w.includes(`pbp ${EK}: 26 game(s)`)), JSON.stringify(warned));
});

// ── 4. BUILDER: build-point-by-point.js main(), stubbed feed ────────────────────
const realFetch = global.fetch;
async function runBuilder({ cache, matches, feed, prev = null }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbp-integrity-'));
  const cwd = process.cwd();
  fs.writeFileSync(path.join(dir, 'matches.json'), JSON.stringify({ matches }));
  fs.writeFileSync(path.join(dir, 'point-by-point-cache.json'), JSON.stringify(cache));
  if (prev) fs.writeFileSync(path.join(dir, '.pbp-prev-cache.json'), JSON.stringify(prev));
  const calls = [], logs = [];
  global.fetch = async url => { const ek = /match_key=(\d+)/.exec(url)[1]; calls.push(ek); return { ok: true, status: 200, json: async () => ({ success: 1, result: [feed(ek)] }) }; };
  const log = console.log; console.log = (...a) => logs.push(a.join(' '));
  try { process.chdir(dir); await builder.main(); }
  finally { process.chdir(cwd); global.fetch = realFetch; console.log = log; }
  const read = f => fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) : null;
  return { calls, logs, cache: read('point-by-point-cache.json'), shard: read(`pbp/${EK}.json`), out: read('point-by-point.json'),
    repairs: read('pbp-repairs.json'), stats: read('pbp-build-stats.json'), index: read('pbp-index.json') };
}
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const storedEntry = (extra = {}) => { const s = STORED(); return { p1: s.p1, p2: s.p2, sets: s.sets, p1Key: 1, p2Key: 2, stats: null, matchStats: null, ...extra }; };
const windowMatch = date => [{ id: `past-${EK}`, date, finalScore: { display: '6-3, 3-6, 6-3' }, p1: 'B. Bonzi', p2: 'C. Norrie' }];

check('builder · a fetch REPLACES the stored log with the provider\'s (cache, shard and sidecar) — never appends', async () => {
  const r = await runBuilder({ cache: { [EK]: storedEntry() }, matches: windowMatch(daysAgo(2)), feed: () => FEED() });
  assert.deepStrictEqual(r.calls, [EK], 'exactly one re-fetch, or the scenario is vacuous');
  const feedPoints = pointCount(FEED_SETS());
  assert.strictEqual(pointCount(r.cache[EK].sets), feedPoints, `cache holds ${pointCount(r.cache[EK].sets)} points, the provider sent ${feedPoints}`);
  assert.deepStrictEqual(shape(r.cache[EK].sets), shape(FEED_SETS()), 'cache != provider');
  assert.deepStrictEqual(shape(r.shard.sets), shape(FEED_SETS()), 'shard != provider');
  assert.deepStrictEqual(shape(r.out[EK].sets), shape(FEED_SETS()), 'point-by-point.json != provider');
  assert.ok(r.cache[EK].pbpFeedAt && r.cache[EK].pbpRecheckAt);
  assert.strictEqual(r.stats.replaced, 1, 'pbp-build-stats.json does not report the replacement');
});
check('builder · the provider\'s complete log replaces ours even when it is itself impossible (shown as received, then repaired, then listed)', async () => {
  // the provider's log with ONE impossible game that no rule can prove: set 1 game 9 reads 15:0 30:0 15:0
  const bad = () => { const f = FEED(); const g = f.pointbypoint.find(x => x.set_number === 'Set 1' && x.number_game === '9');
    g.points = [{ number_point: '1', score: '15 - 0' }, { number_point: '2', score: '30 - 0' }, { number_point: '3', score: '15 - 0' }]; return f; };
  const r = await runBuilder({ cache: { [EK]: storedEntry() }, matches: windowMatch(daysAgo(1)), feed: bad });
  const g9 = s => s.find(x => x.set === 1).games.find(x => x.g === 9).points.map(p => p.s);
  assert.deepStrictEqual(g9(r.cache[EK].sets), ['15 - 0', '30 - 0', '15 - 0'], 'cache is not the provider\'s log');
  assert.deepStrictEqual(g9(r.shard.sets), ['15 - 0', '30 - 0', '15 - 0'], 'an unprovable game was altered');
  assert.ok(r.repairs.matches[EK] && r.repairs.matches[EK].remaining.length === 1, 'the unrepaired game is not listed');
});
check('builder · a provider log missing a set keeps ours; the shard is ours less its provable replays (== the provider\'s games)', async () => {
  const short = () => { const f = FEED(); f.pointbypoint = f.pointbypoint.filter(g => g.set_number !== 'Set 3'); return f; };
  const r = await runBuilder({ cache: { [EK]: storedEntry() }, matches: windowMatch(daysAgo(1)), feed: short });
  assert.deepStrictEqual(r.calls, [EK]);
  assert.deepStrictEqual(r.cache[EK].sets, STORED().sets, 'ours was not kept');
  assert.deepStrictEqual(shape(r.shard.sets), shape(FEED_SETS()), 'the repaired shard != the provider\'s games');
  assert.strictEqual(r.repairs.byRule['replayed-game'], 26, JSON.stringify(r.repairs.byRule));
  assert.ok(r.logs.some(l => /provider's log is shorter than ours/.test(l)));
});
check('builder · re-ask schedule: an old failing log is asked once, then not again; a recent one waits an hour between asks', async () => {
  const old = await runBuilder({ cache: { [EK]: storedEntry() }, matches: windowMatch(daysAgo(60)), feed: () => FEED() });
  assert.deepStrictEqual(old.calls, [EK], 'an old failing log was never asked');
  const asked = await runBuilder({ cache: { [EK]: storedEntry({ pbpRecheckAt: new Date(Date.now() - 3 * 864e5).toISOString() }) }, matches: windowMatch(daysAgo(60)), feed: () => FEED() });
  assert.deepStrictEqual(asked.calls, [], 'an old log asked before was asked again');
  const soon = await runBuilder({ cache: { [EK]: storedEntry({ pbpRecheckAt: new Date(Date.now() - 10 * 6e4).toISOString() }) }, matches: windowMatch(daysAgo(1)), feed: () => FEED() });
  assert.deepStrictEqual(soon.calls, [], 're-asked within the hour');
  const later = await runBuilder({ cache: { [EK]: storedEntry({ pbpRecheckAt: new Date(Date.now() - 90 * 6e4).toISOString() }) }, matches: windowMatch(daysAgo(1)), feed: () => FEED() });
  assert.deepStrictEqual(later.calls, [EK], 'a recent failing log was not re-asked after the hour');
});
check('builder · a freshly finished match is re-asked every run for two hours, even when its log passes (provider still adding points)', async () => {
  // the first copy at Finished: the provider's log less the last point of set 3 game 9 — it passes the check
  const early = FEED_SETS(); const g = early.find(s => s.set === 3).games.find(x => x.g === 9); g.points = g.points.slice(0, -1);
  assert.deepStrictEqual(P.check({ sets: early }).filter(i => i.kind !== 'header'), [], 'the early copy must pass, or the scenario is vacuous');
  const entry = { ...storedEntry(), sets: early, pbpRecheckAt: new Date(Date.now() - 20 * 6e4).toISOString() };
  const board = finished => [{ ...windowMatch(daysAgo(0))[0], finishedAt: new Date(Date.now() - finished * 6e4).toISOString() }];
  const r = await runBuilder({ cache: { [EK]: JSON.parse(JSON.stringify(entry)) }, matches: board(30), feed: () => FEED() });
  assert.deepStrictEqual(r.calls, [EK], 'a match finished 30 min ago was not re-asked');
  assert.deepStrictEqual(shape(r.shard.sets), shape(FEED_SETS()), 'the provider\'s later log was not adopted');
  const late = await runBuilder({ cache: { [EK]: JSON.parse(JSON.stringify(entry)) }, matches: board(180), feed: () => FEED() });
  assert.deepStrictEqual(late.calls, [], 'a passing log finished 3 h ago was re-asked');
});
check('version bump · a store reset to a few entries gets every log of the previous version back (never smaller)', async () => {
  // the 2026-10-22 shape: the current store is the small committed copy; the previous version held many logs
  const named = n => ({ p1: 'A. One', p2: 'B. Two', sets: [{ set: 1, games: [{ g: 1, score: '1 - 0', winner: 'p1', points: pts('15 - 0', '30 - 0', '40 - 0') }] }], p1Key: 1, p2Key: 2, stats: null, matchStats: null, pbpRecheckAt: new Date().toISOString(), pbpFeedAt: new Date().toISOString(), n });
  const prev = {}; for (let i = 0; i < 40; i++) prev[String(11000000 + i)] = named(i);
  const cache = { '10000001': named(-1) };   // the committed copy: one log the previous version does not hold
  const r = await runBuilder({ cache, prev, matches: [], feed: () => null });   // the provider answers nothing: the restore alone must hold
  assert.strictEqual(r.calls.length, 40, `every restored log is re-asked once (asked ${r.calls.length})`);
  assert.strictEqual(r.index.length, 41, `published ${r.index.length} shards; the previous version held 40 and the store 1`);
  assert.ok(Object.keys(prev).every(k => r.index.includes(k)), 'a previous-version log is missing from the index');
  assert.strictEqual(r.stats.restored, 40, 'pbp-build-stats.json does not report the restore (no cache save would follow)');
  assert.ok(r.logs.some(l => /::notice title=pbp fallback::previous version held 40 named logs; 40 added/.test(l)), 'no public notice of the restore');
  // a log the current store holds always wins over the previous version's copy
  const both = await runBuilder({ cache: { [EK]: { ...storedEntry(), pbpRecheckAt: new Date().toISOString(), pbpFeedAt: new Date().toISOString(), sets: FEED_SETS() } },
    prev: { [EK]: storedEntry() }, matches: [], feed: () => FEED() });
  assert.deepStrictEqual(shape(both.shard.sets), shape(FEED_SETS()), 'the previous version overwrote a log the current store holds');
});
check('version bump · restored logs are "stored", counted as failing before repair, re-asked before the backlog; the ledger carries the target', async () => {
  // previous version: the appended Bonzi copy, provider-confirmed marks and all (they must not survive the restore)
  const prev = { [EK]: storedEntry({ pbpFeedAt: '2026-10-01T00:00:00Z', pbpRecheckAt: '2026-10-01T00:00:00Z' }) };
  // the current store: one OLDER failing log never asked, which would come first by date without the restore priority
  const other = '12999999';   // sorts AHEAD of 12172010 by key, so only the restore priority can put the restored log first
  const cache = { [other]: { ...storedEntry(), p1: 'X. Old', p2: 'Y. Older' } };
  const key = process.env.PBP_RECHECK_MAX; process.env.PBP_RECHECK_MAX = '1';
  delete require.cache[require.resolve(path.join(ROOT, 'build-point-by-point.js'))];
  const b2 = require(path.join(ROOT, 'build-point-by-point.js'));
  const saved = builder.main; builder.main = b2.main;
  try {
    const r = await runBuilder({ cache, prev, matches: [], feed: () => FEED() });
    assert.deepStrictEqual(r.calls, [EK], `the restored log must be re-asked first (asked: ${r.calls})`);
    assert.ok(r.logs.some(l => /1 of the 1 restored fail the validator before repair/.test(l)), r.logs.filter(l => /fallback/.test(l)).join(' | '));
    assert.strictEqual(r.repairs.fallback.target, 1, 'target = the previous version\'s named logs');
    assert.strictEqual(r.repairs.fallback.storeBeforeMerge, 1, 'store size before the merge');
    assert.strictEqual(r.repairs.fallback.restored, 1);
    // a restored log that the provider has not yet answered is tagged 'stored' (here the budget went to it, so check the other path)
    const r2 = await runBuilder({ cache: {}, prev, matches: [], feed: () => { throw new Error('no feed'); } });
    assert.strictEqual(r2.repairs.byRuleSource['replayed-game:stored'], 26, `restored log not tagged stored: ${JSON.stringify(r2.repairs.byRuleSource)}`);
  } finally { builder.main = saved; if (key == null) delete process.env.PBP_RECHECK_MAX; else process.env.PBP_RECHECK_MAX = key; }
  // no previous file this run: the target travels from the deployed ledger via PBP_FALLBACK_TARGET
  process.env.PBP_FALLBACK_TARGET = '72551';
  try {
    const r3 = await runBuilder({ cache: { [EK]: storedEntry({ pbpRecheckAt: new Date().toISOString() }) }, matches: [], feed: () => FEED() });
    assert.strictEqual(r3.repairs.fallback.target, 72551, 'the target was not carried forward');
    assert.strictEqual(r3.repairs.fallback.storeBeforeMerge, 1);
  } finally { delete process.env.PBP_FALLBACK_TARGET; }
});
check('version bump · pipeline.yml restores the previous version (vprev) before the real restore and keeps ONLY its point-by-point store', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pipeline.yml'), 'utf8');
  assert.ok(/echo "vprev=\$\(\(V - 1\)\)" >> "\$GITHUB_OUTPUT"/.test(y), 'the schema step does not publish vprev');
  const i = y.indexOf('id: prevpbp'), j = y.indexOf('- name: Restore pipeline caches');
  assert.ok(i > 0 && j > i, 'the fallback restore must run BEFORE the real restore');
  const step = y.slice(i, j);
  assert.ok(step.includes('restore-keys: |\n            bsp-caches-v${{ steps.schema.outputs.vprev }}-'), 'the fallback is not keyed on the previous version');
  assert.ok(step.includes('mv point-by-point-cache.json .pbp-prev-cache.json'), 'the previous store is not set aside');
  assert.ok(step.includes('git checkout -- player-profiles.json point-by-point-cache.json tournament-profiles.json'), 'a previous-version profile file could leak into this run');
  assert.ok(/rm -rf player-profiles-cache\.json player-tournament-history\.json tml-cache model-output\.json news-feed\.json tournament-entries\.json/.test(step), 'a previous-version cache file could leak into this run');
});
check('ledger · a replayed game is tagged by source: our stored copy, or the provider\'s own (checked) log', async () => {
  const stored = await runBuilder({ cache: { [EK]: { ...storedEntry(), pbpRecheckAt: new Date().toISOString() } }, matches: [], feed: () => FEED() });
  assert.deepStrictEqual(stored.calls, [], 'scenario must not re-ask');
  assert.strictEqual(stored.repairs.byRuleSource['replayed-game:stored'], 26, JSON.stringify(stored.repairs.byRuleSource));
  const bad = () => { const f = FEED(); const g = f.pointbypoint.find(x => x.set_number === 'Set 1' && x.number_game === '9');
    g.points = ['15 - 0', '30 - 0', '40 - 0', '30 - 0', '40 - 0'].map((s, i) => ({ number_point: String(i + 1), score: s })); return f; };
  const prov = await runBuilder({ cache: { [EK]: storedEntry() }, matches: windowMatch(daysAgo(1)), feed: bad });
  assert.strictEqual(prov.repairs.byRuleSource['replayed-game:provider'], 1, JSON.stringify(prov.repairs.byRuleSource));
  assert.ok(!prov.repairs.byRuleSource['replayed-game:stored'], 'a provider-checked log was tagged as our stored copy');
});
check('cache save · a run that replaced stored logs asks for a save; one that did not, does not', async () => {
  const { decide } = await import(path.join(ROOT, 'tools', 'cache-save-decision.mjs'));
  assert.strictEqual(decide({ stats: { opponentsBuilt: 0 }, todayCount: 2, pbp: { replaced: 3 } }).save, true);
  assert.strictEqual(decide({ stats: { opponentsBuilt: 0 }, todayCount: 2, pbp: { replaced: 0 } }).save, false);
  assert.strictEqual(decide({ stats: { opponentsBuilt: 0 }, todayCount: 6, pbp: { replaced: 3 } }).save, false, 'the 6/day valve still holds');
});

(async () => {
  let pass = 0, fail = 0;
  console.log('\npoint-by-point: storage, repair, display\n');
  for (const [name, fn] of checks) {
    try { await fn(); console.log(`  ok  ${name}`); pass++; }
    catch (e) { console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`); fail++; }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
