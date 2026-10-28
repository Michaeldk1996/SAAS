#!/usr/bin/env node
// Bet Tracker T1b — bettracker-import.js on a SYNTHETIC fixture (tools/fixtures/bettracker-import-sample.csv: 10 tickets,
// 8 leg rows, made-up players). The member's own file is never read by a test. Proves every brief rule: tickets vs
// legs (an orphan leg reported, never attached), Simple → Single / Combined → Combination | Parlay, the ticket's own
// odds (a leg-product gap over 1% reported), € → % of a 10,000 € bankroll with stakeEur kept, the seven states (HW and
// CASH void with their text, no P/L), Live = Yes or a LIVE label, the PRE / LIVE prefix stripped, a blank bookmaker
// kept blank, the token table only (OUTRIGHT and mixed-market combos get no market), close null, unlocked, the
// source tag, tilt, then the store path (one bankroll, one write, removeImport, redo). Then mutants.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'bettracker-import.js'), 'utf8');
const STORE = fs.readFileSync(path.join(ROOT, 'bettracker-store.js'), 'utf8');
const CSV = fs.readFileSync(path.join(ROOT, 'tools/fixtures/bettracker-import-sample.csv'), 'utf8');

function load(src) {
  const sb = { module: { exports: {} }, JSON, Date, Math, String, Number, Object, Array, RegExp, isFinite, parseFloat };
  sb.globalThis = sb; vm.runInNewContext(src, sb, { filename: 'm.js' }); return sb.module.exports;
}
function storage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }

function run(I) {
  const fails = [];
  const eq = (n, g, w) => { if (JSON.stringify(g) !== JSON.stringify(w)) fails.push(`${n}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`); };
  const { bets, report: r } = I.parse(CSV, {});
  eq('file ok', r.ok, true);
  eq('tickets · combined · leg rows · attached', [r.tickets, r.combined, r.legRows, r.legsAttached], [10, 3, 8, 7]);
  eq('an orphan leg is reported with the ticket line it follows', r.orphanLegs, [{ line: 18, after: 17 }]);
  eq('types', r.types, { Single: 7, Combination: 2, Parlay: 1 });
  eq('states per ticket', r.states, { W: 2, L: 3, C: 1, CASH: 1, HW: 1, R: 1, P: 1 });
  eq('stakes over 10%', r.over10, 1);
  eq('odds mismatches over 1% (the ticket odds stand)', r.oddsMismatch.map(x => [x.line, x.odds, x.legProduct]), [[8, 4, 4.08], [12, 3, 2.25]]);
  eq('live · prefixes stripped · blank bookmakers', [r.live, r.prefixStripped, r.bookBlank], [2, 3, 5]);
  eq('hit rates', r.hits, { level: 10, surface: 10, market: 7, tournament: 0, bookmaker: 5 });
  eq('market conflicts · outrights', [r.conflicts.market, r.outrightNoMarket], [1, 1]);
  eq('unused columns that hold data are named', r.unusedColumnsFilled, { Cashout: 1 });
  eq('settled · pending · first date', [r.settled, r.pending, r.firstDate], [9, 1, '2022-01-14']);
  eq('tilt: the third bet on a day already down two', [r.tilt, bets.filter(b => b.tilt).map(b => b.text)], [1, ['Player C to win (ATP250 Grass: Player C - Player D)']]);
  const by = t => bets.find(b => b.text.startsWith(t));
  const b9 = by('Player I to win');
  eq('PRE : stripped, Masters 1000 Clay, Match winner, € → %, stakeEur kept', [b9.text.slice(0, 15), b9.level, b9.surface, b9.market, b9.stake, b9.stakeEur, b9.res, b9.timing, b9.book],
    ['Player I to win', '1000', 'Clay', 'Match winner', 1.13, 112.5, 'lost', 'pre', 'Napoleon Games']);
  const b8 = by('Player G over');
  eq('LIVE : → live, over 3.5 sets → Total sets, R → void, 822 € → 8.22%, blank book stays blank', [b8.timing, b8.market, b8.level, b8.surface, b8.res, b8.stake, b8.book], ['live', 'Total sets', 'Slam', 'Grass', 'void', 8.22, '']);
  const b7 = by('Player F');
  eq('HW → void + "(imported: HW)", OUTRIGHT → no market, comma odds read, 1200 € → 12%', [b7.res, / \(imported: HW\)$/.test(b7.text), b7.market, b7.odds, b7.stake], ['void', true, '', 6, 12]);
  const b6 = by('Two legs');
  eq('CASH → void + "(imported: cashout)", 2 legs → Combination, legs-only market blank', [b6.res, / \(imported: cashout\)$/.test(b6.text), b6.type, b6.legs, b6.market, b6.level, b6.surface], ['void', true, 'Combination', 2, '', '250', 'Hard']);
  const b5 = by('Three legs');
  eq('C → void, 3 legs → Parlay, Indoor → Indoor hard, all legs "to win" → Match winner', [b5.res, b5.type, b5.legs, b5.surface, b5.market], ['void', 'Parlay', 3, 'Indoor hard', 'Match winner']);
  const b4 = by('Player E to win &');
  eq('Live = Yes → live; mixed-market legs → no market; the ticket odds, not the leg product', [b4.timing, b4.market, b4.odds, b4.type, b4.level, b4.surface], ['live', '', 1.9, 'Combination', '500', 'Indoor hard']);
  eq('"to win set 2" → Player to win a set; tiebreak → Tiebreak in match', [by('Player A to win set').market, by('Player A tiebreak').market], ['Player to win a set', 'Tiebreak in match']);
  const b10 = by('Player K');
  eq('PRE: (no space) stripped, P → pending, games handicap, Challenger Hard, date + time', [b10.res, b10.pending, b10.market, b10.level, b10.surface, b10.date, new Date(b10.createdAt).getHours()], [null, true, 'Games handicap', 'Chall', 'Hard', '2022-01-14', 0]);
  eq('every bet: close null, unlocked, tagged, no tournament', bets.every(b => b.close === null && b.lockedAt === null && b.source === 'bet-analytix' && b.tour === ''), true);
  eq('ids unique', new Set(bets.map(b => b.id)).size, 10);
  // the store path
  const St = load(STORE), store = St.create({ local: storage(), session: storage(), now: () => new Date(Date.UTC(2026, 9, 28)) });
  const w = I.run(CSV, store, {});
  eq('run: one bankroll named BSP Consult Bet-Analytix holding 10 bets', [w.ok, w.stored, store.listBanks().find(b => b.id === 'bet-analytix').name, store.listBets('bet-analytix').length], [true, 10, 'BSP Consult Bet-Analytix', 10]);
  eq('run twice is refused, nothing doubled', [I.run(CSV, store, {}).reason, store.listBets('bet-analytix').length], ['already-imported', 10]);
  eq('removeImport then redo', [store.removeImport('bet-analytix', 'bet-analytix').removed, I.run(CSV, store, {}).stored], [10, 10]);
  eq('a file without the columns is refused', I.parse('"a";"b"\n"1";"2"', {}).report.ok, false);
  return fails;
}

const fails = run(load(SRC));
for (const f of fails) console.log('  FAIL ', f);
console.log(fails.length ? `bettracker-import: ${fails.length} failure(s)` : 'bettracker-import: all checks pass');
const MUTANTS = [
  ['legs attach after a Simple', "if (t && get(t.r, 'Type') === 'Combined') t.legs.push", 'if (t) t.legs.push'],
  ['HW keeps no text', "HW: ['void', ' (imported: HW)']", "HW: ['void', '']"],
  ['C is lost', "C: ['void', '']", "C: ['lost', '']"],
  ['no prefix strip', 'var label = get(r, \'Label\'), pre = /^(PRE|LIVE)\\s*:\\s*/i.exec(label);', "var label = get(r, 'Label'), pre = null;"],
  ['stake truncates', 'Math.round(eur * 10000 / bankroll) / 100', 'Math.floor(eur * 10000 / bankroll) / 100'],
  ['outright reads as match winner', "if (/\\boutright\\b/i.test(t)) return { v: '', outright: true };", ''],
  ['odds from the legs', "odds: odds, close: null", "odds: t.legs.length ? +t.legs.reduce(function (a, lg) { return a * dec(get(lg.r, 'Odds')); }, 1).toFixed(3) : odds, close: null"],
  ['Live column ignored', "var live = /^yes$/i.test(get(r, 'Live')) || /^LIVE\\b/i.test(label);", "var live = /^LIVE\\b/i.test(label);"],
  ['3 legs = Combination', "(t.legs.length >= 3 ? 'Parlay' : 'Combination')", "'Combination'"],
  ['no tilt', 'b.tilt = i >= 2 && run >= 2;', 'b.tilt = false;']
];
let survived = 0;
for (const [name, from, to] of MUTANTS) {
  if (!SRC.includes(from)) { console.log('  FAIL  mutant anchor missing:', name); survived++; continue; }
  let red; try { red = run(load(SRC.replace(from, to))).length > 0; } catch (e) { red = true; }
  if (!red) { console.log('  FAIL  mutant survived:', name); survived++; }
}
console.log(`mutants: ${MUTANTS.length - survived} of ${MUTANTS.length} killed`);
process.exit(fails.length || survived ? 1 : 0);
