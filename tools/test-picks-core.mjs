#!/usr/bin/env node
// Picks page — every SPEC §11 formula in picks-core.js, tested against the design package's demo rows
// (design-export/picks-handoff/demo-data.json → picks.json) and the SYNTHETIC test ledger
// (tools/fixtures/picks-synthetic-ledger.json: ≥ 25 settled rows, Games handicap + Total games, a void with a
// void_reason, rows with a null close / opp_close). Expected values are worked by hand from the rows, or come from an
// oracle copied verbatim from the LOCKED design's logic class (fair · clv · units · recFor) — never from picks-core.js.
//
// Then a mutant pass: each mutant bends one rule in a copy of picks-core.js; the suite must go red on every one.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE_SRC = fs.readFileSync(path.join(ROOT, 'picks-core.js'), 'utf8');
const DEMO = JSON.parse(fs.readFileSync(path.join(ROOT, 'design-export/picks-handoff/demo-data.json'), 'utf8'));
const SERVED = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/picks-demo.json'), 'utf8'));   // the demo fixture (never served since Task 2)
const SYN = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/picks-synthetic-ledger.json'), 'utf8'));
const MINUS = '−', EN = '–', DASH = '—';

function load(src) {
  const sandbox = { module: { exports: {} }, Intl, Date, Math, JSON, String, Number, Object, Array, isFinite, isNaN };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(src, sandbox, { filename: 'picks-core.js' });
  return sandbox.module.exports;
}

// ── the oracle: the LOCKED design's own helpers (Picks LOCKED 2026-10-27.dc.html, class Component) ──────────────────
const O = {
  fair: (p, q) => (1 / p) / ((1 / p) + (1 / q)),
  clv(posted, close, closeOpp) { if (!close || !closeOpp) return null; return posted * O.fair(close, closeOpp) - 1; },
  units(status, posted, stake) { if (status === 'won') return stake * (posted - 1); if (status === 'lost') return -stake; return 0; },
  pct(x) { if (x == null) return '—'; const v = x * 100; return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%'; },
  u(x, dp) { const d = dp == null ? 2 : dp; if (x == null) return '—'; return (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d).replace(/\.?0+$/, '') + '%'; },
};

function suite(C) {
  const fails = [];
  let n = 0;
  const eq = (name, got, want) => { n++; if (Object.is(got, want) || (typeof got === 'number' && typeof want === 'number' && Math.abs(got - want) < 1e-9)) return; fails.push(`${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
  const near = (name, got, want, tol = 5e-6) => { n++; if (typeof got === 'number' && Math.abs(got - want) <= tol) return; fails.push(`${name}: got ${got} want ≈${want}`); };
  const ok = (name, cond) => { n++; if (!cond) fails.push(name); };

  const by = Object.fromEntries(SERVED.picks.map(p => [p.id, p]));
  ok('the demo fixture holds the 9 demo rows', SERVED.picks.length === DEMO.today.length + DEMO.settled_sun_26.length && SERVED.picks.length === 9);

  // ── fair / clv (posted × fair(close, opp_close) − 1) ──
  near('fair(1.78, 2.15)', C.fair(1.78, 2.15), 0.5470708);
  eq('fair missing leg', C.fair(1.78, null), null);
  near('clv p2 (live, close 1.78/2.15)', C.clvOf(by.p2), 0.0120865);
  eq('clv p2 text', C.pct(C.clvOf(by.p2)), '+1.2%');
  near('clv s1', C.clvOf(by.s1), 0.0193350);
  eq('clv s2 text (true minus)', C.pct(C.clvOf(by.s2)), MINUS + '11.5%');
  eq('clv s3 (void) text', C.pct(C.clvOf(by.s3)), MINUS + '1.8%');
  eq('clv s4 text', C.pct(C.clvOf(by.s4)), '+0.3%');
  eq('clv p1 posted → dash', C.pct(C.clvOf(by.p1)), DASH);
  eq('clv outright → null', C.clvOf(by.o1), null);
  // Close is "—" until live, even when a posted row carries one (manufactured state; control for closeOf)
  const postedWithClose = Object.assign({}, by.p1, { close_price: 2.0, opp_close_price: 1.85 });
  eq('posted row with a close: close shows dash', C.closeOf(postedWithClose), null);
  eq('posted row with a close: clv dash', C.clvOf(postedWithClose), null);
  eq('live row with a close: close shows', C.closeOf(Object.assign({}, postedWithClose, { status: 'live' })), 2.0);
  // every served settled/live clv agrees with the oracle (a set, not an empty pass)
  const withClose = SERVED.picks.filter(p => p.status !== 'posted' && p.close_price && p.opp_close_price);
  ok('rows with a close exist (non-empty set)', withClose.length === 5);
  withClose.forEach(p => near(`clv ${p.id} = oracle`, C.clvOf(p), O.clv(p.posted_price, p.close_price, p.opp_close_price)));

  // ── pl_pct (won → stake × (posted − 1) · lost → −stake · void → 0), % of bankroll ──
  near('pl s1', C.plOf(by.s1), 0.88);
  eq('pl s1 text', C.u(C.plOf(by.s1)), '+0.88%');
  eq('pl s2 text', C.u(C.plOf(by.s2)), MINUS + '1%');
  eq('pl s3 void', C.plOf(by.s3), 0);
  eq('pl s3 header text', C.plText(by.s3), '0%');
  near('pl s4', C.plOf(by.s4), 1.05);
  eq('pl unsettled → null', C.plOf(by.p1), null);
  eq('pl header unsettled → empty', C.plText(by.p2), '');
  SERVED.picks.filter(C.isSettled).forEach(p => near(`pl ${p.id} = oracle`, C.plOf(p), O.units(p.status, p.posted_price, p.stake)));
  // stored clv / pl_pct are the recomputation, to 6 dp
  SERVED.picks.forEach(p => {
    const c = C.clvOf(p), x = C.plOf(p);
    ok(`stored clv ${p.id} = recomputed`, c == null ? p.clv === null : Math.abs(p.clv - c) < 1e-6);
    ok(`stored pl_pct ${p.id} = recomputed`, x == null ? p.pl_pct === null : Math.abs(p.pl_pct - x) < 1e-6);
  });

  // ── model fair odds = 1 / (model_pct / 100), 2 dp; dash with no model ──
  [['p1', '1.72'], ['p2', '1.79'], ['p3', '2.17'], ['s1', '1.67'], ['s2', '2.44'], ['s3', '2.04'], ['s4', '1.59']]
    .forEach(([id, want]) => eq(`model fair ${id}`, C.f2(C.modelFair(by[id].model_pct)), want));
  eq('model fair outright (null)', C.f2(C.modelFair(by.o1.model_pct)), DASH);
  eq('model fair 0 → dash', C.modelFair(0), null);

  // ── FAV = the side with the lower CURRENT price ──
  eq('FAV p1 (sel a 2.10 vs 1.78) → b', C.favSide(by.p1), 'b');
  eq('FAV p2 (sel a 1.80 vs 2.05) → a', C.favSide(by.p2), 'a');
  eq('FAV p3 (sel b 1.80 vs 2.00) → b', C.favSide(by.p3), 'b');
  eq('FAV s2 (sel b 2.55 vs 1.52) → a', C.favSide(by.s2), 'a');
  eq('FAV outright → none', C.favSide(by.o1), null);
  eq('FAV equal prices → none', C.favSide(Object.assign({}, by.p1, { now_price: 1.9, opp_now_price: 1.9 })), null);

  // ── trail segment colours ──
  const G = 'var(--pos)', R = 'var(--neg)', F28 = 'color-mix(in srgb, var(--text) 28%, transparent)', F14 = 'color-mix(in srgb, var(--text) 14%, transparent)';
  eq('seg lower → green', C.trailColour(2.02, 1.9), G);
  eq('seg higher → red', C.trailColour(2.02, 2.10), R);
  eq('seg equal → 28%', C.trailColour(2.0, 2.0), F28);
  eq('seg missing → 14%', C.trailColour(2.0, null), F14);
  const t1 = C.trail(by.p1);
  eq('p1 four stops', t1.stops, 4); eq('p1 Open→Posted always 14%', t1.segs[0], F14); eq('p1 Posted→Now (2.02→2.10) red', t1.segs[1], R); eq('p1 Now→Close (no close) 14%', t1.segs[2], F14);
  eq('p1 label Now while posted', t1.nowLabel, 'Now');
  const t2 = C.trail(by.p2);
  eq('p2 label Last once live', t2.nowLabel, 'Last'); eq('p2 Posted→Now green', t2.segs[1], G); eq('p2 Now→Close green', t2.segs[2], G);
  const tS = C.trail(by.s2);
  eq('settled three stops', tS.stops, 3); eq('s2 Posted→Close (2.40→2.60) red', tS.segs[1], R);
  eq('s1 Posted→Close green', C.trail(by.s1).segs[1], G);
  eq('settled four on mobile', C.trail(by.s1, true).stops, 4);
  eq('outright no trail', C.trail(by.o1), null);

  // ── bet-line text ──
  eq('bet line p1', C.betLine(by.p1), 'Berrettini to win');
  eq('bet line p3 (sel b)', C.betLine(by.p3), 'Cobolli to win');
  eq('bet line o1', C.betLine(by.o1), 'Sinner · To win the tournament');
  eq('bet line o2', C.betLine(by.o2), 'Cobolli · To qualify for the Nitto ATP Finals');
  eq('surname strips both initials', C.surname('T. M. Etcheverry'), 'Etcheverry');
  const syn = SYN.picks, sb = Object.fromEntries(syn.map(p => [p.id, p]));
  eq('bet line handicap (syn02, sel b)', C.betLine(sb.syn02), 'Testthree +2.5 games');
  eq('bet line totals (syn03)', C.betLine(sb.syn03), 'Over 22.5 games');
  eq('line tag handicap', C.lineTag(sb.syn02), '+2.5 games');
  eq('line tag totals', C.lineTag(sb.syn03), 'Over 22.5');
  eq('type tags', [by.p1, sb.syn02, sb.syn03, by.o1].map(C.typeTag).join(' '), 'WINNER HANDICAP TOTALS OUTRIGHT');

  // ── chips, times (Europe/Brussels), void tail, score block ──
  eq('chip posted', C.statusChip(by.p1).text, 'POSTED 09:41');
  eq('chip live still POSTED', C.statusChip(by.p2).text, 'POSTED 09:52');
  eq('chip words', [by.s1, by.s2, by.s3].map(p => C.statusChip(p).text).join(' '), 'WON LOST VOID');
  eq('Brussels summer (CEST) 07:41Z → 09:41', C.hhmm('2026-07-01T07:41:00Z'), '09:41');
  eq('Brussels winter (CET) 08:41Z → 09:41', C.hhmm('2026-10-27T08:41:00Z'), '09:41');
  eq('Brussels day across midnight', C.brusselsDay('2026-10-26T23:30:00Z'), '2026-10-27');
  eq('void tail', C.voidTail(by.s3), ' · ret. 2-3 set 1 · void (Pinnacle rule)');
  const s4a = C.scoreSide(by.s4, 'a'), s4b = C.scoreSide(by.s4, 'b');
  eq('s4 sets won a', s4a.setsWon, 3); eq('s4 sets won b', s4b.setsWon, 2);
  eq('cells coloured PER SET (a)', s4a.cells.map(c => c.won ? 'W' : 'l').join(''), 'lWlWW');
  eq('tiebreak only on the tb winner', s4a.cells.map(c => c.tb).join('|') + ' / ' + s4b.cells.map(c => c.tb).join('|'), '|3|||8 / ||||');
  const s3a = C.scoreSide(by.s3, 'a'), s3b = C.scoreSide(by.s3, 'b');
  ok('retired set: nobody won it', !s3a.cells[0].won && !s3b.cells[0].won && s3a.setsWon === 0 && s3b.setsWon === 0);
  eq('score text from the pick side (s2, sel b)', C.scoreText(by.s2), '3-6 6-7');

  // ── day views, bets box, empty states ──
  const today = SERVED.as_of_day;
  const up = C.picksFor(SERVED.picks, 'upcoming', today), done = C.picksFor(SERVED.picks, 'completed', '2026-10-26');
  eq('upcoming today = 5', up.length, 5); eq('completed 26 Oct = 4', done.length, 4);
  const bx = C.betsBox(up, 'upcoming', today, today);
  eq('bets box title', bx.title, 'Today · 5 bets');
  eq('bets box meta', bx.meta, '5% staked · 2 outright · posted time · line @ bet105 price · stake');
  eq('bets box meta = design u(5,1)', bx.meta.split(' ')[0], O.u(5, 1).replace('+', ''));
  const bxc = C.betsBox(done, 'completed', '2026-10-26', today);
  eq('settled box title', bxc.title, 'Mon 26 · settled · 4 bets');
  eq('settled box meta', bxc.meta, '2' + EN + '1 · 1 void · 4.5% staked');
  ok('box hidden with one pick', !C.betsBox(up.slice(0, 1), 'upcoming', today, today).show);
  eq('singular bet', C.betsBox(up.slice(0, 1), 'upcoming', today, today).title, 'Today · 1 bet');
  eq('where (match)', C.whereText(by.p1), 'Vienna Open R32 · 20:30');
  eq('where (outright)', C.whereText(by.o1), 'Nitto ATP Finals · Turin');
  eq('empty upcoming today', C.emptyState('upcoming', today, today).title, 'No bets posted yet today');
  eq('empty completed today', JSON.stringify(C.emptyState('completed', today, today)), JSON.stringify({ title: 'No bets settled yet today.', sub: 'Today’s picks are under Upcoming until their match ends.' }));
  eq('empty future', C.emptyState('upcoming', '2026-10-28', today).title, 'No bets posted yet for Wed 28.');
  eq('empty past', C.emptyState('completed', '2026-10-24', today).title, 'No bets this day.');

  // ── Record: the served demo period is thin ──
  const r30 = C.record(SERVED.picks, '30d', today);
  eq('served 30 d settled n', r30.n, 4);
  ok('served 30 d is thin (n < 20)', r30.thin);
  eq('thin: Settled text, amber elsewhere', r30.settledText, 'n=4 · thin');
  eq('thin: all four stats dash', r30.stats.map(s => s.value).join(' '), [DASH, DASH, DASH, DASH].join(' '));

  // ── Record: the synthetic ledger, 30 d / 90 d / Season, against the design's recFor ──
  const sToday = SYN.as_of_day;
  const settledSyn = syn.filter(p => ['won', 'lost', 'void'].includes(p.status));
  ok('synthetic ledger ≥ 25 settled rows', settledSyn.length >= 25);
  ok('synthetic has a Games handicap and a Total games row', syn.some(p => p.market === 'Games handicap') && syn.some(p => p.market === 'Total games'));
  ok('synthetic has a void with a void_reason', syn.some(p => p.status === 'void' && p.void_reason));
  ok('synthetic has rows with a null close / opp_close', syn.some(p => p.close_price == null) && syn.some(p => p.opp_close_price == null));
  const ages = p => Math.round((Date.parse(sToday) - Date.parse(p.date)) / 864e5);
  for (const [period, lim] of [['30d', 30], ['90d', 90]]) {
    const rows = settledSyn.filter(p => ages(p) <= lim), rec = C.record(syn, period, sToday);
    const w = rows.filter(p => p.status === 'won').length, l = rows.filter(p => p.status === 'lost').length;
    const units = rows.reduce((a, p) => a + O.units(p.status, p.posted_price, p.stake), 0);
    // founder ruling 2026-10-27: ROI's denominator is the won + lost stakes only (a void stake is returned)
    const stake = rows.filter(p => p.status !== 'void').reduce((a, p) => a + p.stake, 0);
    const wc = rows.map(p => O.clv(p.posted_price, p.close_price, p.opp_close_price)).filter(x => x != null);
    eq(`${period} n`, rec.n, rows.length);
    ok(`${period} not thin`, !rec.thin && rows.length >= 20);
    eq(`${period} Record W–L`, rec.stats[0].value, w + EN + l);
    eq(`${period} Profit`, rec.stats[1].value, O.u(units, 1));
    eq(`${period} ROI`, rec.stats[2].value, O.pct(units / stake));
    eq(`${period} Avg CLV (rows with a close only)`, rec.stats[3].value, O.pct(wc.reduce((a, x) => a + x, 0) / wc.length));
    ok(`${period} Avg CLV skips null closes`, rec.withClose === wc.length && wc.length < rows.length);
  }
  // the thin boundary: 19 settled in the period → thin, 20 → not (manufactured from the synthetic rows)
  const in30 = settledSyn.filter(p => ages(p) <= 30 && p.status !== 'void');
  ok('thin boundary: 19 settled is thin', C.record(in30.slice(0, 19), '30d', sToday).thin && C.record(in30.slice(0, 19), '30d', sToday).settledText === 'n=19 \u00b7 thin');
  ok('thin boundary: 20 settled is not thin', !C.record(in30.slice(0, 20), '30d', sToday).thin && C.record(in30.slice(0, 20), '30d', sToday).settledText === '20');
  // the 30 d window holds the void (syn05, stake 1): ROI over won + lost stakes differs from ROI over every stake
  { const r30s = C.record(syn, '30d', sToday), rows = settledSyn.filter(p => ages(p) <= 30);
    const pl = rows.reduce((a, p) => a + O.units(p.status, p.posted_price, p.stake), 0);
    const all = rows.reduce((a, p) => a + p.stake, 0), wl = rows.filter(p => p.status !== 'void').reduce((a, p) => a + p.stake, 0);
    ok('the 30 d window holds a void (the ROI ruling is exercised)', rows.some(p => p.status === 'void') && all !== wl);
    near('ROI = Σ pl ÷ Σ won + lost stakes', r30s.roi, pl / wl, 1e-12); }
  eq('Season hover', C.PERIODS.season.hover, '1 January to today');
  eq('30 d count by hand (ages ≤ 30)', C.record(syn, '30d', sToday).n, 26);
  eq('W–L excludes the void', C.record(syn, '30d', sToday).w + C.record(syn, '30d', sToday).l, 25);
  eq('Season = this calendar year', C.record(syn, 'season', sToday).n, settledSyn.filter(p => p.date.startsWith('2026') && ages(p) >= 0).length);
  ok('Season excludes last year', settledSyn.some(p => !p.date.startsWith('2026')));

  // ── ledger rows + sort ──
  const led = C.record(syn, '30d', sToday).rows.map(C.ledgerRow);
  const d0 = C.sortLedger(led, 'date', -1);
  ok('default sort: date, newest first', d0[0].date >= d0[d0.length - 1].date && d0[0].date === '2026-10-26');
  eq('same head flips', JSON.stringify(C.nextSort({ key: 'clv', dir: -1 }, 'clv')), JSON.stringify({ key: 'clv', dir: 1 }));
  eq('new head sorts descending', JSON.stringify(C.nextSort({ key: 'clv', dir: 1 }, 'pl')), JSON.stringify({ key: 'pl', dir: -1 }));
  const byClv = C.sortLedger(led, 'clv', -1);
  ok('null CLV sorts last', byClv[byClv.length - 1].clv === null && byClv[0].clv >= byClv[1].clv);
  const vrow = led.find(r => r.status === 'void');
  eq('ledger void result', vrow.result, 'V · 2-3 ret.');
  eq('ledger date text', C.ledgerRow(by.s1).dateText, '26 Oct');
  eq('ledger market + line', C.ledgerRow(sb.syn02).market, 'Games handicap +2.5');

  // ── formats ──
  eq('f2 dash', C.f2(null), DASH); eq('f2', C.f2(1.8), '1.80');
  eq('pct dash', C.pct(null), DASH); eq('pct zero unsigned', C.pct(0), '0.0%');
  eq('u trims', C.u(1.5), '+1.5%'); eq('u(10)', C.u(10), '+10%'); eq('u negative', C.u(-2.25), MINUS + '2.25%'); eq('u dash', C.u(null), DASH);
  eq('stake text', C.stakeText(1.5), '1.5%');
  ok('no hyphen-minus on a negative', !/-\d/.test(C.pct(-0.05) + C.u(-1)));
  eq('sign colours', [C.sgnColour(1), C.sgnColour(-1), C.sgnColour(0), C.sgnColour(null)].join(' '), 'var(--pos) var(--neg) var(--text-label) var(--text-label)');

  // ── the synthetic ledger never reaches the page ──
  ok('served picks carry no synthetic id', !SERVED.picks.some(p => /^syn/.test(p.id)));
  ok('served file is labelled a fixture', SERVED.fixture === true && /DEMO/.test(SERVED._note));

  return { n, fails };
}

const real = suite(load(CORE_SRC));
console.log(`picks-core: ${real.n - real.fails.length}/${real.n} checks pass`);
real.fails.forEach(f => console.log('  FAIL ' + f));

// the demo fixture must be the build of demo-data.json (no hand edits)
let built = true;
try { execFileSync(process.execPath, [path.join(ROOT, 'tools/build-picks-fixture.mjs'), '--check'], { stdio: 'pipe' }); }
catch (e) { built = false; console.log('  FAIL ' + String(e.stdout || '') + String(e.stderr || '')); }
console.log(built ? 'picks-demo.json: matches its build from demo-data.json' : 'picks-demo.json: DIFFERS from its build');

// ── mutants: each must turn the suite red ──
const MUTANTS = [
  ['clv without margin removal', 'return f == null || pp == null ? null : pp * f - 1;', 'return f == null || pp == null ? null : pp / price(close) - 1;'],
  ['close shown on a posted card', "return p && p.status !== 'posted' && !isOutright(p) ? price(p.close_price) : null;", 'return p && !isOutright(p) ? price(p.close_price) : null;'],
  ['void pays out', "if (status === 'void') return 0;", "if (status === 'void') return s;"],
  ['FAV on the higher price', 'return mine < opp ? p.selection : other;', 'return mine > opp ? p.selection : other;'],
  ['trail colours inverted', "return to < from ? 'down' : to > from ? 'up' : 'flat';", "return to > from ? 'down' : to < from ? 'up' : 'flat';"],
  ['thin at 10', 'var THIN_N = 20;', 'var THIN_N = 10;'],
  ['hyphen-minus', "MINUS = '\u2212'", "MINUS = '-'"],
  ['UTC clock', "var TZ = 'Europe/Brussels';", "var TZ = 'UTC';"],
  ['avg CLV over every row', 'var c = clvOf(p); if (c != null) { withC++; clvSum += c; }', 'var c = clvOf(p); withC++; clvSum += c || 0;'],
  ['W–L counts voids', "l = set.filter(function (p) { return p.status === 'lost'; }).length", "l = set.filter(function (p) { return p.status !== 'won'; }).length"],
  ['model % not odds', 'return m == null || !(m > 0) || m > 100 ? null : 1 / (m / 100);', 'return m == null || !(m > 0) || m > 100 ? null : m / 100;'],
  ['ROI counts void stakes', "if (p.status !== 'void') stake += num(p.stake) || 0;", 'stake += num(p.stake) || 0;'],
  ['set cells per match', 'var won = !retiredSet && isFinite(mine) && isFinite(theirs) && mine > theirs;', "var won = p.status === 'won' ? side === p.selection : side !== p.selection;"],
];
let survived = 0;
for (const [name, from, to] of MUTANTS) {
  if (!CORE_SRC.includes(from)) { console.log(`  MUTANT ANCHOR MISSING: ${name}`); survived++; continue; }
  let r;
  try { r = suite(load(CORE_SRC.replace(from, to))); } catch (e) { r = { fails: ['threw: ' + e.message] }; }
  if (!r.fails.length) { console.log(`  MUTANT SURVIVED: ${name}`); survived++; }
}
console.log(`mutants: ${MUTANTS.length - survived}/${MUTANTS.length} caught`);

const exit = real.fails.length || !built || survived ? 1 : 0;
console.log(`EXIT=${exit}`);
process.exit(exit);
