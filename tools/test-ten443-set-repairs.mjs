#!/usr/bin/env node
// TEN-443 · the sets api-tennis drops (founder ruling 2026-10-17, comment b5b5ef00 item 1): repaired only where
// Tennis Explorer AND Sackmann agree on the full score; every other short row flagged with the reason.
//   1. tools/build-set-repairs.mjs over fixture sources: one case per outcome — both agree (own TE page; opponent's
//      TE page, flipped), sources disagree, TE only, Sackmann only, neither; Sackmann qualifying dated by the main draw;
//      two Sackmann candidates of which one fits.
//   2. set-repairs.js: the missing set goes in where the sources put it; sets already on the row keep their
//      tiebreak points; a row that no longer holds the short list is left alone.
//   3. WIRING: the REAL writeCareerHistoryShards with SET_REPAIR=1 writes the repaired list to the shard, the Lines
//      tab's own lineSetCount then reads the row as whole (not `partial`); SET_REPAIR off changes nothing; on with no
//      repair file the run stops.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const B = await import('../tools/build-set-repairs.mjs');
const { applySetRepairs } = require('../set-repairs.js');

let pass = 0, fail = 0;
const check = async (n, fn) => { try { await fn(); pass++; console.log('  ok   ' + n); } catch (e) { fail++; console.log('  FAIL ' + n + ' :: ' + e.message); } };
const g = (sets) => (sets || []).map((s) => `${s.p}-${s.o}`).join(' ');

// ── fixture sources ────────────────────────────────────────────────────────────────────────────────────────────
const A = '501', O = '502';   // our player, and an opponent who has a TE page
const row = (ek, date, opp, result, won, sets, tour = 'Challenger X') => ({ year: date.slice(0, 4), surface: 'hard', level: 'chitf', date, tournament: tour, round: 'R32', opponent: opp, result, won, src: 'fixtures', eventKey: ek, sets });
const shardsA = [
  row(1, '2022-03-01', 'B. Bravo', '2 - 1', true, [{ p: 4, o: 6 }, { p: 6, o: 3, pTb: null }]),            // agree: 6-0 missing last
  row(2, '2022-04-05', 'C. Charlie', '2 - 1', true, [{ p: 7, o: 6, pTb: 7, oTb: 4 }, { p: 3, o: 6 }]),     // disagree
  row(3, '2022-05-10', 'D. Delta', '2 - 0', true, [{ p: 6, o: 4 }]),                                          // TE only (no Sackmann)
  row(4, '2022-06-14', 'E. Echo', '0 - 2', false, [{ p: 3, o: 6 }]),                                          // Sackmann only
  row(5, '2022-07-19', 'F. Foxtrot', '1 - 2', false, [{ p: 6, o: 4 }, { p: 2, o: 6 }]),                       // neither
  row(6, '2022-08-23', 'O. Oscar', '2 - 1', true, [{ p: 6, o: 7 }, { p: 6, o: 2 }]),                          // opponent's TE page
  row(7, '2022-06-20', 'Q. Quebec', '2 - 1', true, [{ p: 6, o: 4 }, { p: 4, o: 6 }], 'Wimbledon'),           // qualifying, dated +7 d
  row(8, '2022-09-06', 'R. Romeo', '2 - 1', true, [{ p: 6, o: 3 }, { p: 3, o: 6 }]),                          // two candidates, one fits
  row(9, '2022-10-04', 'S. Sierra', '2 - 0', true, [{ p: 6, o: 3 }, { p: 6, o: 4 }]),                         // whole: not a short row
];
const shardsO = [row(6, '2022-08-23', 'A. Alpha', '1 - 2', false, [{ p: 7, o: 6 }, { p: 2, o: 6 }])];
const COLS = ['season', 'date', 'event', 'cat', 'round', 'surface', 'court', 'opp', 'oppSlug', 'won', 'score', 'wo', 'ret', 'teMatchId', 'dateAmbiguous'];
const T = (date, opp, won, score) => [2022, date, 'Challenger X', 'Challenger', 'R32', 'hard', 'outdoor', opp, opp.toLowerCase(), won ? 1 : 0, score, 0, 0, null, 0];
const teA = [T('2022-03-01', 'Bravo B.', true, '4-6, 6-3, 6-0'), T('2022-04-05', 'Charlie C.', true, '7-6(4), 3-6, 6-1'),
  T('2022-05-10', 'Delta D.', true, '6-4, 6-0'), T('2022-07-19', 'Foxtrot F.', false, '4-6, 6-3, 6-0'),
  [2022, '2022-06-20', 'Wimbledon', 'ATP qual', 'Q-1R', 'grass', 'outdoor', 'Quebec Q.', 'quebec', 1, '6-4, 4-6, 6-0', 0, 0, null, 0],
  T('2022-09-06', 'Romeo R.', true, '6-3, 3-6, 6-0')];
// the opponent's page: he LOST to A; TE prints the score winner first (A's "6-7, 6-2, 6-0")
const teO = [T('2022-08-23', 'Alpha A.', false, '6-7, 6-2, 6-0')];
const CSV = 'tourney_id,tourney_name,surface,draw_size,tourney_level,tourney_date,match_num,winner_id,winner_seed,winner_entry,winner_name,winner_hand,winner_ht,winner_ioc,winner_age,loser_id,loser_seed,loser_entry,loser_name,loser_hand,loser_ht,loser_ioc,loser_age,score,best_of,round';
const S = (d, wid, wn, lid, ln, score, round = 'R32', tname = 'Challenger X') => `t,${tname},Hard,32,C,${d},1,${wid},,,${wn},R,,,,${lid},,,${ln},R,,,,${score},3,${round}`;
const sack = [CSV,
  S('20220228', '9501', 'Al Alpha', '9601', 'Bob Bravo', '4-6 6-3 6-0'),
  S('20220404', '9501', 'Al Alpha', '9602', 'Cy Charlie', '7-6(4) 3-6 6-2'),       // TE says 6-1
  S('20220613', '9603', 'Ed Echo', '9501', 'Al Alpha', '6-3 6-0'),
  S('20220822', '9501', 'Al Alpha', '9502', 'Oz Oscar', '6-7(3) 6-2 6-0'),
  S('20220627', '9501', 'Al Alpha', '9604', 'Quinn Quebec', '6-4 4-6 6-0', 'Q1', 'Wimbledon'),   // main-draw date, +7 d
  S('20220829', '9501', 'Al Alpha', '9605', 'Ray Romeo', '6-1 6-1'),               // earlier meeting: does not fit
  S('20220905', '9501', 'Al Alpha', '9605', 'Ray Romeo', '6-3 3-6 6-0'),
].join('\n');

function sources(dir) {
  for (const d of ['ch', 'te', 'sack']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  fs.writeFileSync(path.join(dir, 'ch', `${A}.json`), JSON.stringify({ key: A, matches: shardsA }));
  fs.writeFileSync(path.join(dir, 'ch', `${O}.json`), JSON.stringify({ key: O, matches: shardsO }));
  fs.writeFileSync(path.join(dir, 'te', `${A}.json`), JSON.stringify({ key: A, src: 'te', cols: COLS, rows: teA }));
  fs.writeFileSync(path.join(dir, 'te', `${O}.json`), JSON.stringify({ key: O, src: 'te', cols: COLS, rows: teO }));
  fs.writeFileSync(path.join(dir, 'sack', 'atp_matches_qual_chall_2022.csv'), sack + '\n');
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten443-sets-'));
sources(tmp);
const out = B.build({ shards: path.join(tmp, 'ch'), teDir: path.join(tmp, 'te'), sack: B.loadSackmann(path.join(tmp, 'sack')),
  sids: { [A]: '9501', [O]: '9502' }, names: {} });
const rep = out.repairs[A] || {}, flg = out.flags[A] || {};

await check('every short row is checked: 8 short rows of A + 1 of O, the whole row is not', () => {
  assert.strictEqual(out.shortRows, 9);
  assert.ok(!rep[9] && !flg[9]);
});
await check('both agree (his own TE page + Sackmann): repaired, the 6-0 set where the sources put it', () => {
  assert.ok(rep[1], JSON.stringify(flg[1])); assert.strictEqual(g(rep[1].sets), '4-6 6-3 6-0'); assert.strictEqual(rep[1].te, 'own');
});
await check('sources disagree: flagged with both scores, not repaired', () => {
  assert.ok(!rep[2]); assert.match(flg[2].why, /^sources disagree: Tennis Explorer 7-6 3-6 6-1 · Sackmann 7-6 3-6 6-2/);
});
await check('Tennis Explorer only / Sackmann only / neither: flagged, not repaired', () => {
  assert.ok(!rep[3] && /^Tennis Explorer only/.test(flg[3].why), JSON.stringify(flg[3]));
  assert.ok(!rep[4] && /^Sackmann only/.test(flg[4].why), JSON.stringify(flg[4]));
  assert.ok(!rep[5] && /^neither/.test(flg[5].why), JSON.stringify(flg[5]));
});
await check('the opponent\'s TE page, flipped to our side, + Sackmann: repaired (and his own row too)', () => {
  assert.ok(rep[6], JSON.stringify(flg[6])); assert.strictEqual(rep[6].te, 'opponent'); assert.strictEqual(g(rep[6].sets), '6-7 6-2 6-0');
  assert.ok(out.repairs[O] && out.repairs[O][6], JSON.stringify(out.flags[O])); assert.strictEqual(g(out.repairs[O][6].sets), '7-6 2-6 0-6');
});
await check('Sackmann qualifying dated by the main draw (+7 d) still joins', () => { assert.ok(rep[7], JSON.stringify(flg[7])); });
await check('two Sackmann meetings in the window: the one that fits is taken', () => { assert.ok(rep[8], JSON.stringify(flg[8])); assert.strictEqual(g(rep[8].sets), '6-3 3-6 6-0'); });

await check('applySetRepairs: inserts the missing set, keeps tiebreak points, tags the row; flags carry the reason', () => {
  const rows = [row(1, '2022-03-01', 'B. Bravo', '2 - 1', true, [{ p: 4, o: 6, pTb: 3, oTb: 7 }, { p: 6, o: 3 }]), row(5, '2022-07-19', 'F. Foxtrot', '1 - 2', false, [{ p: 6, o: 4 }, { p: 2, o: 6 }])];
  const store = { repairs: { [A]: { 1: { short: [{ p: 4, o: 6 }, { p: 6, o: 3 }], sets: [{ p: 4, o: 6 }, { p: 6, o: 3 }, { p: 6, o: 0 }] } } }, flags: { [A]: { 5: { short: rows[1].sets, why: 'neither' } } } };
  const d = applySetRepairs(rows, A, store);
  assert.deepStrictEqual(d, { repaired: 1, flagged: 1, stale: 0 });
  assert.strictEqual(g(rows[0].sets), '4-6 6-3 6-0'); assert.strictEqual(rows[0].sets[0].pTb, 3); assert.strictEqual(rows[0].setsFrom, 'te+sackmann');
  assert.strictEqual(rows[1].setsIncomplete, 'neither'); assert.strictEqual(g(rows[1].sets), '6-4 2-6');
});
await check('applySetRepairs: a row that no longer holds the short list (the feed filled it) is left alone', () => {
  const rows = [row(1, '2022-03-01', 'B. Bravo', '2 - 1', true, [{ p: 4, o: 6 }, { p: 6, o: 3 }, { p: 6, o: 1 }])];
  const d = applySetRepairs(rows, A, { repairs: { [A]: { 1: { short: [{ p: 4, o: 6 }, { p: 6, o: 3 }], sets: [{ p: 4, o: 6 }, { p: 6, o: 3 }, { p: 6, o: 0 }] } } } });
  assert.strictEqual(d.stale, 1); assert.strictEqual(g(rows[0].sets), '4-6 6-3 6-1'); assert.ok(!rows[0].setsFrom);
  // a row holding a DIFFERENT part of the repair (one set, not the two it was built from) is not this repair's row
  const r2 = [row(1, '2022-03-01', 'B. Bravo', '2 - 1', true, [{ p: 4, o: 6 }])];
  const d2 = applySetRepairs(r2, A, { repairs: { [A]: { 1: { short: [{ p: 4, o: 6 }, { p: 6, o: 3 }], sets: [{ p: 4, o: 6 }, { p: 6, o: 3 }, { p: 6, o: 0 }] } } } });
  assert.strictEqual(d2.stale, 1); assert.strictEqual(g(r2[0].sets), '4-6');
});

// ── wiring: the real shard writer ──────────────────────────────────────────────────────────────────────────────
function load(on) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(ROOT) && !k.includes('node_modules')) delete require.cache[k];
  if (on) process.env.SET_REPAIR = '1'; else delete process.env.SET_REPAIR;
  return require('../bsp-pipeline.js');
}
async function writer(on, withFile) {
  const P = load(on);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten443-sets-w-'));
  if (withFile) fs.writeFileSync(path.join(dir, 'set-repairs.json'), JSON.stringify(out));
  const cwd = process.cwd(); process.chdir(dir);
  const profiles = { [A]: { name: 'A. Alpha', careerMatches: JSON.parse(JSON.stringify(shardsA)), careerByYear: [] } };
  try {
    await P.writeCareerHistoryShards(profiles, { archive: {}, log: () => {}, currentYear: 2026 });
    return { rows: JSON.parse(fs.readFileSync(path.join(dir, 'career-history', `${A}.json`), 'utf8')).matches,
      meta: JSON.parse(fs.readFileSync(path.join(dir, 'career-history-index.json'), 'utf8')).meta };
  } finally { process.chdir(cwd); delete process.env.SET_REPAIR; }
}
// the Lines tab's own set counter, from the deployed page module
function lineSetCount() {
  const sb = { FEATURE_PP2: true }; global.window = sb;
  new Function('window', fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8'))(sb);
  return sb.PlayerProfileV2._internals.lineSetCount;
}
const on = await writer(true, true), off = await writer(false, false);
let threw = null; try { await writer(true, false); } catch (e) { threw = e; }
const ek = (rows, k) => rows.find((r) => String(r.eventKey) === String(k));
await check('WIRING · SET_REPAIR on: the shard row carries the repaired list; flagged rows carry the reason; meta counts them', () => {
  assert.strictEqual(g(ek(on.rows, 1).sets), '4-6 6-3 6-0'); assert.strictEqual(ek(on.rows, 1).setsFrom, 'te+sackmann');
  assert.match(ek(on.rows, 2).setsIncomplete, /^sources disagree/);
  assert.deepStrictEqual({ r: on.meta.setRepairs.repaired, f: on.meta.setRepairs.flagged }, { r: 4, f: 4 });
});
await check('WIRING · the Lines tab reads a repaired row as whole and a flagged one still as partial', () => {
  const lsc = lineSetCount();
  const spine = (r) => ({ sets: r.result, setGames: r.sets });
  assert.ok(!lsc(spine(ek(on.rows, 1))).partial, 'repaired row still partial');
  assert.ok(lsc(spine(ek(off.rows, 1))).partial, 'the control: unrepaired row must read partial');
  assert.ok(lsc(spine(ek(on.rows, 2))).partial, 'a flagged row must stay partial');
});
await check('WIRING · SET_REPAIR off: no file read, rows exactly as the feed gave them, meta null', () => {
  assert.strictEqual(g(ek(off.rows, 1).sets), '4-6 6-3'); assert.ok(!off.rows.some((r) => r.setsFrom || r.setsIncomplete));
  assert.strictEqual(off.meta.setRepairs, null);
});
await check('WIRING · SET_REPAIR on with no set-repairs.json: the run stops', () => assert.ok(threw && /set-repairs\.json/.test(threw.message), String(threw)));

console.log(`\nTEN-443 set repairs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
