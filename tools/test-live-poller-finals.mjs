// Point-by-point carry-over, the poller half (supabase/functions/live-poller/finals.ts + index.ts), founder brief
// 2026-10-23. finals.ts is pure, so it runs here with a stubbed fetch; index.ts is checked for its wiring.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// finals.ts is ES-module TypeScript for Deno; the repo's package.json is CommonJS, so it is loaded as a temporary .mts copy
const os = await import('node:os');
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'poller-finals-')), 'finals.mts');
fs.copyFileSync(path.join(ROOT, 'supabase/functions/live-poller/finals.ts'), tmp);
const F = await import(tmp);
let pass = 0, fail = 0;
const check = async (name, fn) => { try { await fn(); console.log(`  ok  ${name}`); pass++; } catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; } };
const fixture = (ek, games = 3) => ({ event_key: Number(ek), event_status: 'Finished', event_final_result: '2 - 0', event_winner: 'First Player',
  scores: [{ score_first: '6', score_second: '3', score_set: '1' }], event_first_player: 'A. One', first_player_key: 1, event_second_player: 'B. Two', second_player_key: 2,
  statistics: [{ x: 1 }], pointbypoint: Array.from({ length: games }, (_, i) => ({ number_game: String(i + 1) })) });
const okRes = body => ({ ok: true, json: async () => body });

await check('summarize keeps the provider\'s own result fields and drops the heavy ones', () => {
  const s = F.summarize(fixture('9'));
  assert.equal(s.event_final_result, '2 - 0'); assert.equal(s.event_winner, 'First Player'); assert.deepEqual(s.scores[0].score_set, '1');
  assert.ok(!('pointbypoint' in s) && !('statistics' in s));
  assert.equal(F.summarize(null), null);
});
await check('fetchFinals returns the provider log for each due match, at most FINALS_MAX_PER_TICK', async () => {
  const asked = [];
  const got = await F.fetchFinals(['11', '12', '13'], { apiKey: 'k', startedAt: 0, leaseMs: 7000, now: () => 100,
    fetchFn: async url => { const ek = /match_key=(\d+)/.exec(url)[1]; asked.push(ek); return okRes({ result: [fixture(ek, 4)] }); } });
  assert.deepEqual(asked, ['11', '12']); assert.equal(F.FINALS_MAX_PER_TICK, 2);
  assert.equal(got.length, 2); assert.equal(got[0].pbp.length, 4); assert.equal(got[0].final.event_status, 'Finished');
});
await check('fetchFinals starts nothing once the lease is nearly spent (single-flight for get_livescore holds)', async () => {
  let n = 0;
  const got = await F.fetchFinals(['11'], { apiKey: 'k', startedAt: 0, leaseMs: 7000, now: () => 7000 - F.FINALS_START_BEFORE_MS + 1,
    fetchFn: async () => { n++; return okRes({ result: [fixture('11')] }); } });
  assert.equal(n, 0); assert.equal(got.length, 0);
});
await check('a failed, empty, mismatched or throwing fetch is skipped, never written as a blank', async () => {
  const replies = { 21: { ok: false, json: async () => ({}) }, 22: okRes({ result: [] }), 23: okRes({ result: [fixture('99')] }) };
  const run = keys => F.fetchFinals(keys, { apiKey: 'k', startedAt: 0, leaseMs: 60000, now: () => 0,
    fetchFn: async url => { const ek = /match_key=(\d+)/.exec(url)[1]; if (ek === '24') throw new Error('timeout'); return replies[ek]; } });
  assert.deepEqual(await run(['21', '22']), []); assert.deepEqual(await run(['23', '24']), []);
});
await check('index.ts: the board keys go to write_live_pbp, and the finals re-ask runs after it inside the lease', () => {
  const src = fs.readFileSync(path.join(ROOT, 'supabase/functions/live-poller/index.ts'), 'utf8');
  assert.ok(src.includes('db.rpc("write_live_pbp", { _pbp: pbpByEk, _live: liveKeys })'), 'write_live_pbp does not get the board keys');
  const a = src.indexOf('db.rpc("write_live_pbp"'), b = src.indexOf('db.rpc("live_pbp_due_finals"'), c = src.indexOf('db.rpc("write_live_pbp_final"');
  assert.ok(a > 0 && b > a && c > b, 'order: live write, then due list, then final write');
  assert.ok(src.includes('leaseMs: LEASE_TTL_SECONDS * 1000') && src.includes('const startedAt = Date.now();'), 'the finals do not run on the lease clock');
});
await check('the retention migration is applied by the go-live workflow, after the RPC it replaces', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github/workflows/supabase-live-golive.yml'), 'utf8');
  const a = y.indexOf('apply supabase/migrations/20260901000100_live_pbp_rpc.sql'), b = y.indexOf('apply supabase/migrations/20261024000000_live_pbp_retention.sql');
  assert.ok(a > 0 && b > a, 'retention migration missing from go-live, or applied before the RPC it replaces');
});
console.log(`\nlive-poller finals: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
