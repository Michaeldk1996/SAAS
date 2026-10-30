#!/usr/bin/env node
// Model anchor — api-tennis Pinnacle (founder brief 2026-10-30). The model's Pinnacle line (State-2 anchor and the
// sharp reference) is api-tennis's Pinnacle quote: m.bookOpens.Pncl (first sighting) and m.bookNow.Pncl (the latest
// pipeline read). It is never oddsMovement.books.Pinnacle (Oddspapi plain pinnacle, not written since 2 Sep), never
// the bestOdds "Pinnacle best on both sides" path, never another book. Each check runs against mutated copies of
// h2h-model/price.js and must fail on every one (a check that passes on its mutant is vacuous).
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PRICE = path.join(ROOT, 'h2h-model', 'price.js');
const SRC = fs.readFileSync(PRICE, 'utf8');
const T_OPEN = '2026-10-30T03:30:43.238Z', T_NOW = '2026-10-30T12:00:39.622Z';
// 30 Oct 20:00 Berlin (CET) = 19:00Z → pre-match cut 16:00Z: both reads are pre-match.
const base = () => ({ id: 'upcoming-1', date: '2026-10-30', time: '20:00', p1: 'A. One', p2: 'B. Two' });
const withPncl = () => Object.assign(base(), {
  bookOpens: { Pncl: { p1: 2.94, p2: 1.45, seenAt: T_OPEN }, bet365: { p1: 2.75, p2: 1.44, seenAt: T_OPEN } },
  bookNow: { Pncl: { p1: 2.95, p2: 1.45, seenAt: T_NOW, since: T_NOW }, bet365: { p1: 2.8, p2: 1.44, seenAt: T_NOW } },
});

function load(src) {
  // A copy beside the original so its relative requires (./config, ../berlin-time) resolve.
  const f = path.join(ROOT, 'h2h-model', `.price-mut-${process.pid}-${Math.random().toString(36).slice(2)}.js`);
  fs.writeFileSync(f, src);
  try { delete require.cache[require.resolve(f)]; return require(f); } finally { fs.unlinkSync(f); }
}

const CHECKS = [
  ['the anchor is the api-tennis Pinnacle quote: first sighting = opening, latest read = current, each with its read time', (P) => {
    const s = P.pinnacleSeries(withPncl());
    assert.ok(s, 'a Pinnacle line');
    assert.deepStrictEqual([s.opening.p1, s.opening.p2, s.opening.ts], [2.94, 1.45, T_OPEN]);
    assert.deepStrictEqual([s.current.p1, s.current.p2, s.current.ts], [2.95, 1.45, T_NOW]);
    assert.match(s.source, /^Pinnacle \(api-tennis/);
  }],
  ['only a latest read: it is both the opening and the current line', (P) => {
    const m = withPncl(); delete m.bookOpens.Pncl;
    const s = P.pinnacleSeries(m);
    assert.deepStrictEqual([s.opening.p1, s.current.p1, s.opening.ts], [2.95, 2.95, T_NOW]);
  }],
  ['never the old field: oddsMovement.books.Pinnacle alone is no Pinnacle line', (P) => {
    const m = base();
    m.oddsMovement = { books: { Pinnacle: { p1: [[T_OPEN, 2.1]], p2: [[T_OPEN, 1.8]] } } };
    assert.strictEqual(P.pinnacleSeries(m), null);
  }],
  ['never the old field: with both, the api-tennis quote is the line', (P) => {
    const m = withPncl();
    m.oddsMovement = { books: { Pinnacle: { p1: [[T_OPEN, 2.1]], p2: [[T_OPEN, 1.8]] } } };
    assert.strictEqual(P.pinnacleSeries(m).opening.p1, 2.94);
  }],
  ['never the bestOdds path: Pinnacle best on both sides with no Pncl quote is no line', (P) => {
    const m = base();
    m.bestOdds = { p1: { price: 2.95, bookmaker: 'Pncl' }, p2: { price: 1.45, bookmaker: 'Pncl' } };
    assert.strictEqual(P.pinnacleSeries(m), null);
  }],
  ['never another book: bet365 (or any non-Pinnacle quote) alone is no Pinnacle line', (P) => {
    const m = withPncl(); delete m.bookOpens.Pncl; delete m.bookNow.Pncl;
    assert.strictEqual(P.pinnacleSeries(m), null);
    assert.strictEqual(P.pinnaclePrices ? null : null, null);
  }],
  ['both legs or nothing: a one-sided Pncl quote is no line', (P) => {
    const m = withPncl(); m.bookOpens.Pncl.p2 = null; m.bookNow.Pncl.p2 = 0;
    assert.strictEqual(P.pinnacleSeries(m), null);
  }],
];

function runAll(P) { const fails = []; for (const [n, f] of CHECKS) { try { f(P); } catch (e) { fails.push(n + ' :: ' + e.message.split('\n')[0]); } } return fails; }

// 1) the shipped price.js passes every check
const real = runAll(require(PRICE));
for (const [n] of CHECKS) console.log((real.some(x => x.startsWith(n)) ? '  FAIL  ' : '  PASS  ') + n);
real.forEach(f => console.log('    ' + f));

// 2) the model picks State 2 on the api-tennis quote, State 3 without it (never another book standing in)
let modelFail = 0;
try {
  const { selectMarketAnchor } = require(path.join(ROOT, 'h2h-model', 'model.js'));
  const a = selectMarketAnchor(withPncl());
  assert.deepStrictEqual([a.state, a.anchorPrice.p1, a.anchorPrice.p2, a.anchorPrice.ts], [2, 2.94, 1.45, T_OPEN]);
  const old = base(); old.oddsMovement = { books: { Pinnacle: { p1: [[T_OPEN, 2.1]], p2: [[T_OPEN, 1.8]] } } };
  assert.notStrictEqual(selectMarketAnchor(old).state, 2, 'the old field never confirms State 2');
  const bo = base(); bo.bestOdds = { p1: { price: 2.95, bookmaker: 'Pncl' }, p2: { price: 1.45, bookmaker: 'Pncl' } };
  assert.notStrictEqual(selectMarketAnchor(bo).state, 2, 'bestOdds never confirms State 2');
  console.log('  PASS  model: State 2 on the api-tennis quote (anchor = first sighting + its time), never on the old field or bestOdds');
} catch (e) { modelFail = 1; console.log('  FAIL  model: ' + e.message.split('\n')[0]); }

// 3) the pipeline freezes the opening's time from the api-tennis sighting and reads no oddsMovement.books.Pinnacle
const pipe = fs.readFileSync(path.join(ROOT, 'bsp-pipeline.js'), 'utf8');
const pipeReads = pipe.split('\n').filter(l => /oddsMovement\.books\.Pinnacle/.test(l) && !/^\s*\/\//.test(l));
const fnBody = (() => { const a = SRC.indexOf('function apiTennisPinnacle('), b = SRC.indexOf('\nfunction bookSeries(', a); return a > 0 && b > a ? SRC.slice(a, b) : null; })();
const priceReads = fnBody == null ? ['pinnacleSeries / apiTennisPinnacle not found'] : fnBody.split('\n').filter(l => /books\.Pinnacle|bestOdds|sharpBooks/.test(l) && !/^\s*(\/\/|\*)/.test(l));
const staticOk = pipeReads.length === 0 && priceReads.length === 0;
console.log((staticOk ? '  PASS  ' : '  FAIL  ') + 'no code line in bsp-pipeline.js, or in price.js\'s Pinnacle reader, reads oddsMovement.books.Pinnacle / bestOdds / sharpBooks' + (staticOk ? '' : ' :: ' + pipeReads.concat(priceReads).join(' | ')));

// 4) mutants: each must turn at least one check red
const MUTANTS = [
  ['reads the old field again', "const pinTicks = apiTennisPinnacle(match);",
    "const _om = match.oddsMovement && match.oddsMovement.books && match.oddsMovement.books.Pinnacle;\n  const pinTicks = _om ? _om.p1.map((x, k) => ({ p1: x[1], p2: _om.p2[k][1], ts: x[0] })) : apiTennisPinnacle(match);"],
  ['bestOdds fallback back', "  // No api-tennis Pinnacle quote on both legs = no Pinnacle line. Never another book standing in.\n  return null;",
    "  const bo = match.bestOdds;\n  if (bo && bo.p1 && bo.p2 && bo.p1.bookmaker === 'Pncl' && bo.p2.bookmaker === 'Pncl') { const two = { p1: bo.p1.price, p2: bo.p2.price }; return { opening: two, current: two, closingUsed: true, source: 'bestOdds' }; }\n  return null;"],
  ['another book stands in', "const open = leg(match.bookOpens && match.bookOpens.Pncl);",
    "const open = leg(match.bookOpens && (match.bookOpens.Pncl || match.bookOpens.bet365));"],
  ['another book stands in (now)', "const now = leg(match.bookNow && match.bookNow.Pncl);",
    "const now = leg(match.bookNow && (match.bookNow.Pncl || match.bookNow.bet365));"],
  ['the read time dropped', "{ p1: rec.p1, p2: rec.p2, ts: rec.seenAt || null }", "{ p1: rec.p1, p2: rec.p2, ts: null }"],
];
let survived = 0;
for (const [name, from, to] of MUTANTS) {
  if (SRC.split(from).length !== 2) { console.log('  FAIL  mutant anchor not found once: ' + name); survived++; continue; }
  let fails;
  try { fails = runAll(load(SRC.replace(from, to))); } catch (e) { fails = ['load: ' + e.message]; }
  if (fails.length) console.log('  caught  ' + name); else { console.log('  SURVIVED  ' + name); survived++; }
}
// control: the unmutated copy loaded the same way passes
const ctl = runAll(load(SRC));
if (ctl.length) { console.log('  FAIL  control: the unmutated copy is red — mutants are meaningless'); survived++; }

const bad = real.length + modelFail + (staticOk ? 0 : 1) + survived;
console.log(`\nRESULT: ${CHECKS.length + 2 - real.length - modelFail - (staticOk ? 0 : 1)} passed, ${real.length + modelFail + (staticOk ? 0 : 1)} failed; mutants ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(bad ? 1 : 0);
