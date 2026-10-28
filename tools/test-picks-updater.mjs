#!/usr/bin/env node
// Picks Task 2 — tools/picks-updater.mjs patchFor(), on manufactured board states (every state the updater meets: before
// the start, live, final, retired, a stale close, a swapped player order, an outright). Expected values are worked by hand
// from the rows. Then mutants of the updater: each must turn this red.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'tools/picks-updater.mjs'), 'utf8');
const MINUS = '−';

async function load(src) {
  const f = path.join(ROOT, 'tools', `.picks-updater-under-test-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(f, src);
  try { return await import(pathToFileURL(f).href); } finally { fs.unlinkSync(f); }
}
const T0 = Date.parse('2026-10-28T19:30:00Z');
const base = () => ({ id: 'x1', kind: 'match', status: 'posted', match_id: 777, date: '2026-10-28', market: 'Match winner', line: null, selection: 'a',
  player_a: { id: 11, name: 'M. Berrettini' }, player_b: { id: 22, name: 'T. M. Etcheverry' }, posted_price: 2.02, posted_at: '2026-10-28T08:41:00Z', stake: 1,
  open_price: null, now_price: null, opp_now_price: null, close_price: null, opp_close_price: null, frozen_at: null });
const lines = () => new Map([[777, [
  { market: 'ml', side: '11', line: null, price: 2.10, status: 'ok', open_price: 1.95 }, { market: 'ml', side: '22', line: null, price: 1.78, status: 'ok', open_price: 1.88 },
  { market: 'gh', side: '11', line: 2.5, price: 1.80, status: 'ok', open_price: 1.83 }, { market: 'gh', side: '22', line: -2.5, price: 2.00, status: 'ok', open_price: 1.97 },
  { market: 'tg', side: 'over', line: 22.5, price: 1.90, status: 'ok', open_price: 1.85 }, { market: 'tg', side: 'under', line: 22.5, price: 1.90, status: 'ok', open_price: 1.95 }]]]);
const m0 = (o) => Object.assign({ id: 'upcoming-777', p1: 'M. Berrettini', p2: 'T. M. Etcheverry', p1Key: 11, p2Key: 22, live: false, finalScore: null }, o || {});
const close = (o) => Object.assign({ p1: 1.79, p2: 2.12, p1At: new Date(T0 - 20 * 60000).toISOString(), p2At: new Date(T0 - 10 * 60000).toISOString(), ageRefTs: new Date(T0).toISOString() }, o || {});
const final = (sets, winner, display, extra) => Object.assign({ finalScore: { sets, winner, display, p1Sets: 0, p2Sets: 0 } }, extra || {});

function suite(U) {
  const fails = []; let n = 0;
  const eq = (name, got, want) => { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) fails.push(`${name}: got ${g} want ${w}`); };
  const near = (name, got, want) => { n++; if (!(typeof got === 'number' && Math.abs(got - want) < 1e-5)) fails.push(`${name}: got ${got} want ≈${want}`); };
  const run = (p, m, L) => { const log = []; return { patch: U.patchFor(p, { board: new Map(m ? [[777, m]] : []), lines: L || lines(), log, now: T0 }), log }; };

  // before the start: Open once, Now both sides, no status change, no close
  let r = run(base(), m0());
  eq('pre-start: open = bet105 first sighting', r.patch.open_price, 1.95);
  eq('pre-start: now / opp now', [r.patch.now_price, r.patch.opp_now_price], [2.10, 1.78]);
  eq('pre-start: status unchanged, no close, frozen_at = posted + 10 min', [r.patch.status, r.patch.close_price, r.patch.frozen_at], [undefined, undefined, '2026-10-28T08:51:00.000Z']);
  r = run(Object.assign(base(), { open_price: 1.90 }), m0());
  eq('a stored Open is never overwritten (first sighting stays)', r.patch.open_price, undefined);
  // live: status live, Now frozen (a later price is ignored)
  const live = Object.assign(base(), { now_price: 2.10, opp_now_price: 1.78, open_price: 1.95, frozen_at: 'x' });
  const L2 = lines(); L2.get(777)[0].price = 2.40;
  r = run(live, m0({ live: true }), L2);
  eq('live: status → live, Now frozen at the last pre-start price', [r.patch.status, r.patch.now_price], ['live', undefined]);
  // final: won, result with tiebreak on the tb winner, Pinnacle close within 60, CLV and P/L
  r = run(Object.assign(live, { status: 'live' }), m0(final([{ p1: 6, p2: 4 }, { p1: 7, p2: 6 }], 'p1', '6-4, 7-6(5)', { pinClose: close() })));
  eq('final: won', r.patch.status, 'won');
  eq('final: result sets, tb on the tb winner', r.patch.result, { sets: [{ a: '6', b: '4' }, { a: '7', b: '6', tb: '5', tb_side: 'a' }], retired: false });
  eq('final: Pinnacle close a / b', [r.patch.close_price, r.patch.opp_close_price], [1.79, 2.12]);
  near('final: CLV = 2.02 × fair(1.79, 2.12) − 1', r.patch.clv, 2.02 * ((1 / 1.79) / ((1 / 1.79) + (1 / 2.12))) - 1);
  near('final: P/L = 1 × (2.02 − 1)', r.patch.pl_pct, 1.02);
  // a stale close (a leg older than 60 min) feeds no figure
  r = run(Object.assign(base(), { status: 'live' }), m0(final([{ p1: 6, p2: 4 }, { p1: 6, p2: 3 }], 'p2', '6-4, 6-3', { pinClose: close({ p1At: new Date(T0 - 61 * 60000).toISOString() }) })));
  eq('stale close: no close, CLV dash; lost', [r.patch.close_price, r.patch.clv, r.patch.status, r.patch.pl_pct], [undefined, null, 'lost', -1]);
  // retirement before set 1 completes: void, P/L 0
  r = run(Object.assign(base(), { status: 'live' }), m0(final([{ p1: 2, p2: 3 }], 'p2', '2-3 ret.', { retired: true })));
  eq('retired in set 1: void, P/L 0', [r.patch.status, r.patch.pl_pct, r.patch.result.retired], ['void', 0, true]);
  // swapped order: the pick's player a is the board's p2
  const sw = Object.assign(base(), { status: 'live', player_a: { id: 22, name: 'T. M. Etcheverry' }, player_b: { id: 11, name: 'M. Berrettini' } });
  r = run(sw, m0(final([{ p1: 6, p2: 4 }, { p1: 6, p2: 3 }], 'p1', '6-4, 6-3', { pinClose: close() })));
  eq('swapped order: a = board p2 → lost; close a = board p2', [r.patch.status, r.patch.close_price, r.patch.result.sets[0]], ['lost', 2.12, { a: '4', b: '6' }]);
  // no player ids → the board is never joined (never on surnames)
  r = run(Object.assign(base(), { status: 'live', player_a: { id: null, name: 'M. Berrettini' }, player_b: { id: null, name: 'T. M. Etcheverry' } }), m0(final([{ p1: 6, p2: 4 }, { p1: 6, p2: 3 }], 'p1', '6-4, 6-3')));
  eq('no ids: not settled, no prices', [r.patch.status, r.patch.open_price], [undefined, undefined]);
  // Games handicap +2.5 on a (11): 6-4 4-6 4-6 → a 14, b 16 → 14 + 2.5 > 16 won
  const gh = Object.assign(base(), { status: 'live', market: 'Games handicap', line: '+2.5', posted_price: 1.8 });
  r = run(gh, m0(final([{ p1: 6, p2: 4 }, { p1: 4, p2: 6 }, { p1: 4, p2: 6 }], 'p2', '6-4, 4-6, 4-6')));
  eq('handicap +2.5: 14 + 2.5 > 16 → won', r.patch.status, 'won');
  r = run(Object.assign({}, gh, { status: 'posted', line: MINUS + '2.5', selection: 'b' }), m0({ live: false }), lines());
  eq('handicap −2.5 on b: rows side 22 at −2.5 / 11 at +2.5', [r.patch.open_price, r.patch.now_price, r.patch.opp_now_price], [1.97, 2.00, 1.80]);
  // Total games Over 22.5: 6-4 7-6 = 23 → over won; Under → lost
  const tg = Object.assign(base(), { status: 'live', market: 'Total games', line: 'Over 22.5', posted_price: 1.9 });
  r = run(tg, m0(final([{ p1: 6, p2: 4 }, { p1: 7, p2: 6 }], 'p1', '6-4, 7-6(3)')));
  eq('totals Over 22.5 with 23 games → won', r.patch.status, 'won');
  r = run(Object.assign({}, tg, { line: 'Under 22.5' }), m0(final([{ p1: 6, p2: 4 }, { p1: 7, p2: 6 }], 'p1', '6-4, 7-6(3)')));
  eq('totals Under 22.5 with 23 games → lost', r.patch.status, 'lost');
  r = run(Object.assign({}, tg, { status: 'posted' }), m0());
  eq('totals: Over / Under rows', [r.patch.open_price, r.patch.now_price, r.patch.opp_now_price], [1.85, 1.90, 1.90]);
  // a games market on a retirement after set 1: held, never guessed
  r = run(gh, m0(final([{ p1: 6, p2: 4 }, { p1: 2, p2: 1 }], 'p1', '6-4, 2-1 ret.', { retired: true })));
  eq('handicap, retired after set 1: held (a ruling is needed): no status write, logged', [r.patch && r.patch.status, r.log.length], [undefined, 1]);
  // no line close for games markets (the cut is not confirmed): CLV dash
  r = run(Object.assign({}, gh, { line: '+2.5', selection: 'a' }), m0(final([{ p1: 6, p2: 4 }, { p1: 4, p2: 6 }, { p1: 4, p2: 6 }], 'p2', '6-4, 4-6, 4-6', { pinClose: close() })));
  eq('handicap: the match-winner close is never used as a line close', [r.patch.close_price, r.patch.clv], [undefined, null]);
  // outright: only frozen_at
  r = run(Object.assign(base(), { kind: 'outright', market: 'Outright', match_id: null, player_b: null }), null);
  eq('outright: only frozen_at', Object.keys(r.patch), ['frozen_at']);
  // an unchanged pick writes nothing
  const settledRow = Object.assign(base(), { status: 'won', open_price: 1.95, now_price: 2.10, opp_now_price: 1.78, frozen_at: 'x', close_price: 1.79, opp_close_price: 2.12,
    result: { sets: [{ a: '6', b: '4' }, { a: '7', b: '6', tb: '5', tb_side: 'a' }], retired: false } });
  settledRow.clv = Math.round((2.02 * ((1 / 1.79) / ((1 / 1.79) + (1 / 2.12))) - 1) * 1e6) / 1e6; settledRow.pl_pct = 1.02;
  r = run(settledRow, m0(final([{ p1: 6, p2: 4 }, { p1: 7, p2: 6 }], 'p1', '6-4, 7-6(5)', { pinClose: close() })));
  eq('nothing changed → no write', r.patch, null);
  return { n, fails };
}

const real = suite(await load(SRC));
console.log(`picks-updater: ${real.n - real.fails.length}/${real.n} checks pass`);
real.fails.forEach(f => console.log('  FAIL ' + f));
const MUTANTS = [
  ['close without the 60-min rule', 'ref - t1 > W60 || ref - t2 > W60 || ', ''],
  ['Now keeps moving after the start', "if (!started && p.status === 'posted') {", "if (p.status === 'posted' || p.status === 'live') {"],
  ['joined on surnames', "if (a == null || b == null) return null;\n  if (String(m.p1Key)", "if (a == null || b == null) return C.surname(p.player_a.name) === C.surname(m.p1) ? 'p1' : 'p2';\n  if (String(m.p1Key)"],
  ['retirement settles on the result', "if (ret === 'void' || ret === 'no-sets') return { status: 'void', result: res };", ''],
  ['games markets settle after a standing retirement', "if (ret === 'stands') return { hold: 'retirement after set 1: the games markets need a ruling', result: res };", ''],
  ['handicap line ignored', 'x = mine + L.line - theirs;', 'x = mine - theirs;'],
  ['match close used for lines', "if (m && aIs && S && S.code === 'ml') {", 'if (m && aIs && S) {'],
  ['open overwritten', "if (p.open_price == null && me &&", 'if (me &&'],
];
let survived = 0;
for (const [name, from, to] of MUTANTS) {
  if (!SRC.includes(from)) { console.log('  MUTANT ANCHOR MISSING: ' + name); survived++; continue; }
  let r; try { r = suite(await load(SRC.replace(from, to))); } catch (e) { r = { fails: ['threw ' + e.message] }; }
  if (!r.fails.length) { console.log('  MUTANT SURVIVED: ' + name); survived++; }
}
console.log(`mutants: ${MUTANTS.length - survived}/${MUTANTS.length} caught`);
const exit = real.fails.length || survived ? 1 : 0;
console.log(`EXIT=${exit}`);
process.exit(exit);
