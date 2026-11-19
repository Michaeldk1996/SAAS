'use strict';
// Founder 2026-11-19 model changes: style matchup reads the step-9 label, odds movement can lead on Bet105's chart line,
// the court speed record layer (staged), and layer #2's automatic read of our match reports (context.js).
const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const config = require(path.join(ROOT, 'h2h-model/config.js'));
const adj = require(path.join(ROOT, 'h2h-model/adjustments.js'));
const { chartSeries } = require(path.join(ROOT, 'h2h-model/price.js'));
const ctxMod = require(path.join(ROOT, 'h2h-model/context.js'));
let n = 0; const ok = (name) => { n++; console.log('  ✓ ' + name); };
const byKey = (list, k) => list.find(a => a.key === k);
const restore = JSON.parse(JSON.stringify(config.adjustments));
const reset = () => { for (const k of Object.keys(restore)) config.adjustments[k] = JSON.parse(JSON.stringify(restore[k])); };

const mm = { minSampleN: 20, matrix: { 'Big Server': { 'Solid Defender': { pct: 60, n: 400 }, 'Counterpuncher': { pct: 70, n: 25 } } } };
const P = (label, extra) => Object.assign({ abbrName: 'X', style: { archetype_label: label } }, extra);
const baseCtx = (a, b, match) => ({ p1: P(a), p2: P(b), match: match || {}, matchupMatrix: mm, surface: 'hard', bestOf: 3 });

// --- the switches ship off: today's output is unchanged until the founder approves ---
assert.strictEqual(config.adjustments.styleMatchup.readLabels, false);
assert.strictEqual(config.adjustments.oddsMovement.lead, null);
assert.strictEqual(config.adjustments.courtSpeedRecord.gated, true);
assert.strictEqual(config.adjustments.subjective.context.mode, 'shadow', 'reads are made and shown, never priced');
ok('every new switch ships staged (no price changes before go-live)');

// --- style matchup ---
let r = adj.runAll(baseCtx('Big Server', 'Solid Defender'));
assert.strictEqual(byKey(r, 'styleMatchup').applied, false, 'off: the label is not read');
config.adjustments.styleMatchup.readLabels = true;
r = adj.runAll(baseCtx('Big Server', 'Solid Defender'));
const st = byKey(r, 'styleMatchup');
assert.ok(st.applied && Math.abs(st.deltaP1 - 0.2 * 0.10) < 1e-9, 'signal (60−50)/50 × 10pp');
assert.match(st.detail, /^Big Server win 60% of 400 matches against Solid Defender\.$/);
r = adj.runAll(baseCtx('Big Server', 'Counterpuncher'));
assert.strictEqual(byKey(r, 'styleMatchup').applied, false, 'a cell under the page floor of 30 is not applied');
r = adj.runAll(baseCtx('Big Server + Variety Player'.replace(' + Variety Player', ''), 'Big Server'));
assert.match(byKey(r, 'styleMatchup').detail, /Mirror matchup/);
reset(); ok('style matchup reads archetype_label, the page cell rule (n ≥ 30), mirror = no edge');

// --- Bet105 chart series: each side pairs with the other side's last price, cut at the start ---
const start = Date.parse('2026-11-19T13:00:00Z');
const chart = { books: {
  Bet105: { p1: [['2026-11-19T08:00:00Z', 1.80], ['2026-11-19T11:00:00Z', 1.60], ['2026-11-19T13:30:00Z', 1.20]],
            p2: [['2026-11-19T08:00:01Z', 2.05], ['2026-11-19T11:00:02Z', 2.40]] },
  Superbet: { p1: [['2026-11-19T08:00:00Z', 1.82], ['2026-11-19T12:00:00Z', 1.62]], p2: [['2026-11-19T08:00:00Z', 2.00], ['2026-11-19T12:00:00Z', 2.35]] },
  Other: { p1: [['2026-11-19T08:00:00Z', 1.75], ['2026-11-19T12:00:00Z', 1.58]], p2: [['2026-11-19T08:00:00Z', 2.10], ['2026-11-19T12:00:00Z', 2.45]] },
} };
const match = { startTs: start, tour: 'ATP Finals - Turin', oddsMovement: { books: {}, chart } };
const s = chartSeries(match, 'Bet105');
assert.ok(s && s.count === 3, 'three paired ticks, the in-play 1.20 dropped');
assert.strictEqual(s.opening.p1, 1.80); assert.strictEqual(s.current.p1, 1.60); assert.strictEqual(s.current.p2, 2.40);
assert.ok(s.shift > 0.06, 'P1 shortened: a positive no-vig move');
ok('chartSeries pairs change-only sides and stops at the start');

r = adj.runAll({ p1: P(null), p2: P(null), match, matchupMatrix: mm, surface: 'hard', bestOf: 3 });
assert.match(byKey(r, 'oddsMovement').detail, /No clean pre-match Pinnacle line/, 'off: the legacy Pinnacle series');
config.adjustments.oddsMovement.lead = 'Bet105';
r = adj.runAll({ p1: P(null), p2: P(null), match, matchupMatrix: mm, surface: 'hard', bestOf: 3 });
const om = byKey(r, 'oddsMovement');
assert.ok(om.applied && om.deltaP1 > 0, 'Bet105 lead: moves toward the shortened player');
assert.match(om.detail, /^Bet105 p1 .*\(2\/2 books (steam|no steam), (\d+% late|move late|timing n\/a)\)\.$/);
reset(); ok('odds movement leads on Bet105 with the other chart books as steam check');

// --- court speed record (staged): not a row while gated; the math when on ---
assert.ok(!byKey(adj.runAll(baseCtx(null, null)), 'courtSpeedRecord'), 'gated = no row (the page keeps 14)');
ok('court speed record is no row while staged');
config.adjustments.courtSpeedRecord.gated = true;
{
  const fresh = require('child_process').execFileSync(process.execPath, ['-e', `
    const c = require(${JSON.stringify(path.join(ROOT, 'h2h-model/config.js'))}); c.adjustments.courtSpeedRecord.gated = false;
    const a = require(${JSON.stringify(path.join(ROOT, 'h2h-model/adjustments.js'))});
    const rec = (w, l) => ({ wins: w, losses: l, sampleSize: w + l });
    const m = { extraStats: { courtSpeedRecord: { category: 'Fast', p1: rec(15, 5), p2: rec(2, 2), p1All: rec(30, 20), p2All: rec(20, 20) } } };
    const r = a.runAll({ p1: {}, p2: {}, match: m, matchupMatrix: {}, surface: 'hard', bestOf: 3 }).find(x => x.key === 'courtSpeedRecord');
    process.stdout.write(JSON.stringify(r));`]).toString();
  const cs = JSON.parse(fresh);
  // P1: 75% fast v 60% overall = +0.15 × 20/35; P2 under 5 fast matches = 0 → signal 0.0857/0.20 = 0.4286 → 1.07pp
  assert.ok(cs.applied && Math.abs(cs.deltaP1 - (0.15 * 20 / 35 / 0.20) * 0.025) < 1e-4, JSON.stringify(cs));
  assert.match(cs.detail, /^Last 52 weeks: P1 15–5 on fast courts \(75%\) v 60% overall; P2 2–2 on fast courts \(50%\) v 50% overall\.$/);
}
ok('court speed record (when switched on): band minus overall, shrunk, a thin side counts 0');

// --- layer #2: the automatic read ---
assert.deepStrictEqual(ctxMod.parseRead('x {"edge":"p2","lean":-0.4,"confidence":"med","why":"Jodar is serving well."} y'),
  { edge: 'p2', lean: -0.4, confidence: 'med', why: 'Jodar is serving well.' });
assert.strictEqual(ctxMod.parseRead('no json'), null);
assert.strictEqual(ctxMod.parseRead('{"lean":"high"}'), null);
assert.strictEqual(ctxMod.parseRead('{"lean":3}').lean, 1, 'clamped to ±1');
ok('parseRead takes only a numeric lean, clamped');

const read = { ok: true, read: { edge: 'p1', lean: 0.5, confidence: 'med', why: 'Shelton looked sharper.' } };
const subj = (mode) => { config.adjustments.subjective.context.mode = mode; return byKey(adj.runAll(Object.assign(baseCtx(null, null), { contextRead: read })), 'subjective'); };
let sj = subj('off'); assert.strictEqual(sj.applied, false); assert.match(sj.detail, /No manual input/);
sj = subj('shadow'); assert.strictEqual(sj.applied, false); assert.match(sj.detail, /^Shelton looked sharper\. \(Read only/);
sj = subj('on'); assert.ok(sj.applied && Math.abs(sj.deltaP1 - 0.5 * 0.3 * 0.10) < 1e-9, 'lean × scale × 10pp = 1.5pp');
reset(); ok('layer #2: off / shadow (shown, never priced) / on (capped at scale × 10pp)');

const items = [
  { id: 'q1', type: 'quote', playerId: '9', opponentId: '1', player: 'Opp', opponent: 'A', timestamp: '2026-11-18T10:00:00Z', text: 'he was great' },
  { id: 'r1', type: 'report', playerId: '1', opponentId: '9', player: 'A', opponent: 'Opp', timestamp: '2026-11-15T10:00:00Z', text: 'A won.' },
  { id: 'q2', type: 'quote', playerId: '1', opponentId: '9', player: 'A', opponent: 'Opp', timestamp: '2026-11-17T10:00:00Z', text: 'I don&#039;t mind' },
  { id: 'old', type: 'report', playerId: '1', opponentId: '7', player: 'A', opponent: 'Z', timestamp: '2026-08-01T10:00:00Z', text: 'old' },
];
const got = ctxMod.itemsFor(items, '1', Date.parse('2026-11-19T00:00:00Z'), { windowDays: 45, perPlayer: 8 });
assert.deepStrictEqual(got.map(x => x.id), ['r1', 'q2', 'q1'], 'reports, then his quotes, then opponents; outside the window out');
const inp = ctxMod.contextInputs({ p1: 'A', p2: 'B', p1Key: '1', p2Key: '2', tour: 'T', surface: 'hard', bestOf: 3 },
  { items, nowMs: Date.parse('2026-11-19T00:00:00Z'), styles: new Map([['A', 'Big Server']]) });
assert.ok(/I don't mind/.test(inp.prompt) && /Styles: P1 Big Server; P2 unknown/.test(inp.prompt));
assert.deepStrictEqual(inp.n, { p1: 3, p2: 0 });
const inp2 = ctxMod.contextInputs({ p1: 'A', p2: 'B', p1Key: '1', p2Key: '2', tour: 'T', surface: 'hard', bestOf: 3 },
  { items: items.slice(1), nowMs: Date.parse('2026-11-19T00:00:00Z'), styles: new Map() });
assert.notStrictEqual(inp.hash, inp2.hash, 'a new report or quote changes the hash (a new read)');
ok('context inputs: ranked items, decoded quotes, styles, a hash that moves with the texts');

console.log(`model layers 2026-11-19: ${n} checks passed`);
