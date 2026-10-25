#!/usr/bin/env node
'use strict';
// Point-by-point carry-over, the page half (founder brief 2026-10-23): a just-finished match shows its point log
// straight away from the live store, and the published log replaces it only when newer. Never a blank, never older
// over newer, never a guessed result. Runs the real pbp-integrity.js helpers and the dashboard's own functions (sliced
// out of bsp-consult-dashboard.html, network stubbed), plus the builder's asOf stamp.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
process.env.API_TENNIS_KEY = 'stub';
const P = require(path.join(ROOT, 'pbp-integrity.js'));
const builder = require(path.join(ROOT, 'build-point-by-point.js'));
const HTML = fs.readFileSync(process.env.PBP_CARRY_HTML || path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const FEED = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pbp-integrity', '12172010-feed-2026-10-22.json'), 'utf8')).result[0];
const STORED = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pbp-integrity', '12172010-stored-2026-10-22.json'), 'utf8'));
const EK = '12172010';
const shape = sets => sets.map(s => ({ set: s.set, games: s.games.map(g => [g.g, g.score, (g.points || []).map(p => p.s)]) }));
const finalOf = (over = {}) => Object.assign({ event_status: 'Finished', event_winner: 'First Player', scores: FEED.scores,
  event_first_player: FEED.event_first_player, first_player_key: FEED.first_player_key, event_second_player: FEED.event_second_player, second_player_key: FEED.second_player_key }, over);

let pass = 0, fail = 0;
const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check('compact is byte-identical to the builder\'s compactPbp on the real fixture', () => {
  assert.deepStrictEqual(P.compact(FEED.pointbypoint), builder.compactPbp(FEED.pointbypoint));
  assert.strictEqual(P.compact([]), null);
});
check('finalScoreFromFeed: the provider\'s result, oriented by player key either way; nothing while in play or unmatched', () => {
  const a = P.finalScoreFromFeed(finalOf(), FEED.first_player_key, FEED.second_player_key);
  assert.strictEqual(a.display, '6-3, 3-6, 6-3'); assert.strictEqual(a.winner, 'p1'); assert.strictEqual(a.p1Sets, 2);
  const b = P.finalScoreFromFeed(finalOf(), FEED.second_player_key, FEED.first_player_key);
  assert.strictEqual(b.display, '3-6, 6-3, 3-6'); assert.strictEqual(b.winner, 'p2');
  assert.strictEqual(P.finalScoreFromFeed(finalOf({ event_status: 'Set 3' }), FEED.first_player_key, FEED.second_player_key), null, 'in play is not finished');
  assert.strictEqual(P.finalScoreFromFeed(finalOf(), 1, 2), null, 'unmatched keys must not be guessed');
  assert.strictEqual(P.finalScoreFromFeed(finalOf({ event_status: 'Retired' }), FEED.first_player_key, FEED.second_player_key).retired, true);
});
check('chooseLog: newer wins; no shard -> live (repaired); a shard without asOf wins; never a blank over a log', () => {
  const row = (at, pbp = FEED.pointbypoint) => ({ pbp, final: finalOf(), ended_at: at, final_at: at, updated_at: at });
  const shard = (asOf) => ({ p1: 'B. Bonzi', p2: 'C. Norrie', sets: STORED.sets, asOf });
  let c = P.chooseLog(null, row('2026-10-20T20:00:00Z'));
  assert.strictEqual(c.src, 'live'); assert.deepStrictEqual(shape(c.sets), shape(P.compact(FEED.pointbypoint).sets));
  c = P.chooseLog(shard(null), row('2026-10-25T00:00:00Z')); assert.strictEqual(c.src, 'shard', 'a shard without asOf predates the stamp and wins');
  c = P.chooseLog(shard('2026-10-20T19:00:00Z'), row('2026-10-20T20:00:00Z')); assert.strictEqual(c.src, 'live', 'older shard lost to a newer live log');
  c = P.chooseLog(shard('2026-10-20T21:00:00Z'), row('2026-10-20T20:00:00Z')); assert.strictEqual(c.src, 'shard', 'newer shard kept');
  c = P.chooseLog(shard('2026-10-20T19:00:00Z'), row('2026-10-20T20:00:00Z', [])); assert.strictEqual(c.src, 'shard', 'an empty live log never replaces a log');
  assert.strictEqual(P.chooseLog(null, null), null);
  // the live log goes through the same deletion-only repair as a published shard: the appended Bonzi copy comes out clean
  const garbled = STORED.sets.flatMap(s => s.games.map(g => ({ set_number: `Set ${s.set}`, number_game: String(g.g), score: g.score,
    player_served: g.server === 'p1' ? 'First Player' : 'Second Player', serve_winner: g.winner === 'p1' ? 'First Player' : 'Second Player',
    points: g.points.map(p => ({ number_point: String(p.n), score: p.s })) })));
  c = P.chooseLog(null, row('2026-10-20T20:00:00Z', garbled));
  assert.deepStrictEqual(shape(c.sets), shape(P.compact(FEED.pointbypoint).sets), 'the live copy was not repaired');
});

// ── the page's own functions ───────────────────────────────────────────────────
function slice(name) {
  const start = HTML.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let d = 0, i = HTML.indexOf('{', start);
  for (; i < HTML.length; i++) { if (HTML[i] === '{') d++; else if (HTML[i] === '}' && --d === 0) break; }
  return HTML.slice(start, i + 1);
}
const konst = re => { const m = re.exec(HTML); assert.ok(m, String(re)); return m[0]; };
function page({ configured = true, shard = null, row = null, now = Date.now() } = {}) {
  const w = {}; new Function('window', fs.readFileSync(path.join(ROOT, 'pbp-integrity.js'), 'utf8'))(w);
  const window = { SUPABASE_URL: configured ? 'https://x.supabase.co' : '__SUPABASE_URL__', SUPABASE_ANON_KEY: configured ? 'pub' : '__SUPABASE_ANON_KEY__' };
  const asked = [];
  const fetch = async (url) => { asked.push(url);
    if (url.includes('/rest/v1/live_pbp')) return { ok: true, json: async () => (row ? [row] : []) };
    if (url.includes(`pbp/${EK}.json`)) return shard ? { ok: true, json: async () => JSON.parse(JSON.stringify(shard)) } : { ok: false, json: async () => null };
    throw new Error('unexpected ' + url); };
  // eslint-disable-next-line no-new-func
  const api = new Function('window', 'PbpIntegrity', 'fetch', 'console', 'Date', `
    const _pbpShards = {}, _pbpShardPromises = {};
    ${konst(/const _pbpLiveRows = \{\}, _pbpLiveAt = \{\}, _pbpLiveCand = new Set\(\);\n/)}${konst(/const PBP_LIVE_TTL_MS = \d+;\n/)}
    function eventKeyOfMatch(m){ return m.eventKey; }
    ${['pbpLiveConfigured', 'pbpLiveMark', 'loadPbpLive', 'pbpLiveCandidate', 'pbpLiveView', 'pbpStampIntegrity', 'loadPbpShard'].map(slice).join('\n')}
    return { pbpLiveMark, loadPbpLive, pbpLiveCandidate, pbpLiveView, loadPbpShard };
  `)(window, w.PbpIntegrity, fetch, { warn() {}, log() {} }, Object.assign(function () { return new Date(...arguments); }, { now: () => now, parse: Date.parse }));
  return Object.assign(api, { asked });
}
const boardMatch = (over = {}) => Object.assign({ eventKey: EK, p1: 'B. Bonzi', p2: 'C. Norrie', p1Key: FEED.first_player_key, p2Key: FEED.second_player_key, live: true }, over);
const endedRow = (at = new Date().toISOString()) => ({ pbp: FEED.pointbypoint, final: finalOf(), ended_at: at, final_at: at, updated_at: at });

check('page: a just-finished board match opens as finished, from a COPY carrying the provider\'s result (board m untouched)', async () => {
  const pg = page({ row: endedRow() });
  const m = boardMatch();
  assert.ok(pg.pbpLiveCandidate(m));
  pg.pbpLiveMark(EK); await pg.loadPbpLive(EK);
  const v = pg.pbpLiveView(m);
  assert.notStrictEqual(v, m); assert.strictEqual(v.finalScore.display, '6-3, 3-6, 6-3'); assert.strictEqual(v.live, false);
  assert.ok(!m.finalScore && m.live === true, 'the board match was edited');
});
check('page: its point log is there with no published shard (no blank), and is the provider\'s log', async () => {
  const pg = page({ row: endedRow(), shard: null });
  pg.pbpLiveMark(EK);
  const d = await pg.loadPbpShard(EK);
  assert.ok(d && d.src === 'live', 'no log shown before the publish');
  assert.deepStrictEqual(shape(d.sets), shape(P.compact(FEED.pointbypoint).sets));
});
check('page: once a NEWER published log exists it replaces the live one; an older one does not', async () => {
  const at = '2026-10-24T05:00:00Z';
  const newer = await page({ row: endedRow(at), shard: { p1: 'B. Bonzi', p2: 'C. Norrie', sets: P.compact(FEED.pointbypoint).sets, asOf: '2026-10-24T05:30:00Z' } });
  newer.pbpLiveMark(EK); assert.strictEqual((await newer.loadPbpShard(EK)).src, 'shard');
  const older = await page({ row: endedRow(at), shard: { p1: 'B. Bonzi', p2: 'C. Norrie', sets: STORED.sets, asOf: '2026-10-24T04:00:00Z' } });
  older.pbpLiveMark(EK); assert.strictEqual((await older.loadPbpShard(EK)).src, 'live');
});
check('page: no Supabase config (placeholders) asks nothing and behaves as before', async () => {
  const pg = page({ configured: false, row: endedRow(), shard: null });
  pg.pbpLiveMark(EK);
  assert.strictEqual(await pg.loadPbpLive(EK), null);
  assert.ok(!pg.asked.some(u => u.includes('/rest/v1/')), 'Supabase was asked without config');
  assert.strictEqual(pg.pbpLiveView(boardMatch()).finalScore, undefined);
});
check('page: a still-live row (no ended_at) never turns the match finished; a non-candidate match is not asked', async () => {
  const pg = page({ row: { pbp: FEED.pointbypoint, final: null, ended_at: null, updated_at: new Date().toISOString() } });
  pg.pbpLiveMark(EK); await pg.loadPbpLive(EK);
  const m = boardMatch(); assert.strictEqual(pg.pbpLiveView(m), m);
  assert.strictEqual(pg.pbpLiveCandidate(boardMatch({ finalScore: { display: '6-0' }, finishedAt: '2026-01-01T00:00:00Z', live: false })), false, 'an old finished match is not a candidate');
});
check('page: the Match Stats tab paints the carry-over view (wiring)', () => {
  const tab = HTML.slice(HTML.indexOf('  matchstats(m){'), HTML.indexOf('  matchstats(m){') + 1400);
  assert.ok(/if \(pbpLiveCandidate\(m\)\)/.test(tab) && /pbpLiveMark\(ek\)/.test(tab), 'the tab never marks a candidate');
  assert.ok(/const mv = pbpLiveView\(m\);\s*aPaint\('aSectionMatchStats', buildMatchStatsSection\(mv\)\); maMsSheetInit\(mv\);/.test(tab), 'the tab paints the published m, not the carry-over view');
  assert.ok(HTML.includes("S.hasPbp = pbpIdx.has(ek) || !!(_pbpLiveCand.has(ek)"), 'the sheet hides Point by point when only the live log exists');
});
check('builder: every published log carries asOf (when it was fetched), so the page can tell newer from older', async () => {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbp-asof-')), cwd = process.cwd();
  fs.writeFileSync(path.join(dir, 'matches.json'), JSON.stringify({ matches: [{ id: `past-${EK}`, date: new Date().toISOString().slice(0, 10), finalScore: { display: 'x' }, p1: 'B. Bonzi', p2: 'C. Norrie' }] }));
  const realFetch = global.fetch, log = console.log;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: 1, result: [FEED] }) });
  console.log = () => {}; process.env.PBP_TB_FLOOR_ANNOTATE = '0';
  try { process.chdir(dir); await builder.main(); } finally { process.chdir(cwd); global.fetch = realFetch; console.log = log; }
  const sh = JSON.parse(fs.readFileSync(path.join(dir, 'pbp', `${EK}.json`), 'utf8'));
  assert.ok(sh.asOf && Number.isFinite(Date.parse(sh.asOf)), `shard asOf: ${sh.asOf}`);
});

(async () => {
  console.log('\npoint-by-point carry-over\n');
  for (const [name, fn] of checks) {
    try { await fn(); console.log(`  ok  ${name}`); pass++; }
    catch (e) { console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`); fail++; }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
