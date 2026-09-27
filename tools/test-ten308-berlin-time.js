#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════════
// TEN-308 — api-tennis event_date/event_time is the Europe/Berlin wall clock
// ----------------------------------------------------------------------------
// Founder ruling (TEN-304 → TEN-308, 2026-09-27): parse it through the tz
// database, no fixed offsets anywhere; each fixed site is tested with a match on
// each side of the 25 Oct 2026 change and inside the 01:00–02:59 window of that
// day. Every case below fails on the code it replaced: a UTC read fails all of
// them, a fixed +2 fails the CET side, and the page's old "offset at the wall
// time read as UTC" fails 25 Oct 01:00–02:59 (01:30 came out 02:30).
// Python sites: test-ten308-berlin-time.py.
// ════════════════════════════════════════════════════════════════════════════
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' :: ' + e.message); }
}
const iso = ms => (Number.isFinite(ms) ? new Date(ms).toISOString() : String(ms));
const HTML = fs.readFileSync(process.env.TEN308_HTML || path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
// A top-level function's source, cut out of a file so the shipped code runs in a sandbox.
const slice = (name, src = HTML) => {
  const start = src.indexOf(`\nfunction ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(start, i + 1);
};

// [Berlin date, Berlin time, true UTC instant, what it is]
const CASES = [
  ['2026-10-24', '14:00', '2026-10-24T12:00:00.000Z', 'CEST side (24 Oct)'],
  ['2026-10-26', '14:00', '2026-10-26T13:00:00.000Z', 'CET side (26 Oct) — a fixed +2 is 1 h off'],
  ['2026-10-25', '01:30', '2026-10-24T23:30:00.000Z', '25 Oct 01:30 (CEST, before the change)'],
  ['2026-10-25', '02:30', '2026-10-25T00:30:00.000Z', '25 Oct 02:30 (repeated hour → the earlier, CEST)'],
  ['2026-10-26', '00:30', '2026-10-25T23:30:00.000Z', '26 Oct 00:30 (CET; the previous UTC day)'],
];
// The readings each site used before TEN-308, so every case is shown to discriminate.
const OLD = {
  utc: (d, t) => Date.parse(`${d}T${t}:00Z`),
  plus2: (d, t) => Date.parse(`${d}T${t}:00+02:00`),
  offsetAtNaive: (d, t) => { const n = Date.parse(`${d}T${t}:00Z`); return n - (n >= Date.parse('2026-10-25T01:00:00Z') ? 3600e3 : 7200e3); },
};

(async () => {
  console.log('TEN-308 · Berlin wall clock at every api-tennis site\n');

  await check('control: every case disagrees with at least one old reading, and the set fails all three', () => {
    for (const [name, f] of Object.entries(OLD)) {
      assert.ok(CASES.some(([d, t, want]) => iso(f(d, t)) !== want), `old ${name} reading passes every case — vacuous`);
    }
  });

  // ── the one converter ───────────────────────────────────────────────────
  const { berlinWallMs, berlinWallIso } = require('../berlin-time.js');
  for (const [d, t, want, what] of CASES) {
    await check(`berlin-time.js: ${what}: ${d} ${t} Berlin = ${want}`, () => assert.strictEqual(berlinWallIso(d, t), want));
  }
  await check('berlin-time.js: spring gap 28 Mar 2027 02:30 reads with the pre-change offset (01:30Z), as zoneinfo fold=0', () =>
    assert.strictEqual(berlinWallIso('2027-03-28', '02:30'), '2027-03-28T01:30:00.000Z'));
  await check('berlin-time.js: no usable time → NaN / null (never a guessed hour)', () => {
    assert.ok(Number.isNaN(berlinWallMs('2026-10-24', null)));
    assert.strictEqual(berlinWallIso('2026-10-24', ''), null);
    assert.strictEqual(berlinWallIso('24/10/2026', '14:00'), null);
  });

  // ── 1. Edge Model pre-match cut: preMatchCutoffMs, pinnacleSeries, bookSeries, timingWeight ──
  const price = require('../h2h-model/price.js');
  const cfg = require('../h2h-model/config.js');
  const adj = require('../h2h-model/adjustments.js');
  const BUF = cfg.marketCutoffBufferHours * 3600e3;
  for (const [d, t, want, what] of CASES) {
    await check(`price.js preMatchCutoffMs: ${what}: start ${want} − ${cfg.marketCutoffBufferHours} h`, () =>
      assert.strictEqual(iso(price.preMatchCutoffMs({ date: d, time: t })), iso(Date.parse(want) - BUF)));
  }
  await check('price.js preMatchCutoffMs: a startTs (UTC instant, odds-API record) wins over date/time', () =>
    assert.strictEqual(iso(price.preMatchCutoffMs({ date: '2026-10-26', time: '14:00', startTs: '2026-10-26T14:00:00.000Z' })),
      iso(Date.parse('2026-10-26T14:00:00Z') - BUF)));
  await check('price.js preMatchCutoffMs: no time → null (no cut, as before)', () =>
    assert.strictEqual(price.preMatchCutoffMs({ date: '2026-10-26', time: null }), null));

  // A Pinnacle series whose last tick sits inside the window the old cut wrongly admitted.
  // 26 Oct 14:00 Berlin = 13:00Z → cut 10:00Z. Old UTC read: 11:00Z; fixed +2: 09:00Z.
  const series = (pts) => ({ p1: pts.map(([ts, a]) => [ts, a]), p2: pts.map(([ts, , b]) => [ts, b]) });
  const pinMatch = (date, time, pts) => ({ date, time, oddsMovement: { books: { Pinnacle: series(pts) } } });
  const cet = pinMatch('2026-10-26', '14:00', [
    ['2026-10-25T18:00:00Z', 2.00, 1.85], ['2026-10-26T09:30:00Z', 1.95, 1.90], ['2026-10-26T10:30:00Z', 1.90, 1.95]]);
  await check('pinnacleSeries CET: the close is the 09:30Z tick (old UTC read took 10:30Z, 2.5 h pre-start; fixed +2 took 18:00Z)', () => {
    const s = price.pinnacleSeries(cet);
    assert.deepStrictEqual([s.current.p1, s.current.p2, s.closingUsed], [1.95, 1.90, true]);
  });
  await check('bookSeries CET: same cut — two pre-match ticks, not three', () =>
    assert.strictEqual(price.bookSeries(cet, 'Pinnacle').count, 2));
  // 25 Oct 01:30 Berlin = 23:30Z on the 24th → cut 20:30Z. The page's old method: 21:30Z.
  const window = pinMatch('2026-10-25', '01:30', [
    ['2026-10-24T12:00:00Z', 2.00, 1.85], ['2026-10-24T20:00:00Z', 1.95, 1.90], ['2026-10-24T21:00:00Z', 1.90, 1.95]]);
  await check('pinnacleSeries 25 Oct 01:30: the close is the 20:00Z tick, not 21:00Z (cut 20:30Z)', () => {
    const s = price.pinnacleSeries(window);
    assert.deepStrictEqual([s.current.p1, s.current.p2], [1.95, 1.90]);
  });
  const cest = pinMatch('2026-10-24', '14:00', [
    ['2026-10-23T18:00:00Z', 2.00, 1.85], ['2026-10-24T08:30:00Z', 1.95, 1.90], ['2026-10-24T09:30:00Z', 1.90, 1.95]]);
  await check('pinnacleSeries CEST: the close is the 08:30Z tick (cut 09:00Z; old UTC read 11:00Z took 09:30Z)', () => {
    const s = price.pinnacleSeries(cest);
    assert.deepStrictEqual([s.current.p1, s.current.p2], [1.95, 1.90]);
  });
  await check('timingWeight: the late window is measured back from the Berlin-correct cut', () => {
    // cut 26 Oct 10:00Z, late window 12 h → edge 25 Oct 22:00Z. A tick at 22:30Z is LATE under the
    // correct cut; under the old UTC read (edge 23:00Z) it was early.
    const c = { ...cfg.adjustments.marketMovement, lateWindowHours: 12, timingFloor: 0.6 };
    const ticks = [['2026-10-25T08:00:00Z', 0.50], ['2026-10-25T21:00:00Z', 0.50], ['2026-10-25T22:30:00Z', 0.60], ['2026-10-26T09:00:00Z', 0.60]]
      .map(([ts, v]) => ({ ts: Date.parse(ts), vfP1: v }));
    const pin = { ticks, opening: ticks[0], current: ticks[ticks.length - 1] };
    const r = adj.timingWeight(pin, { date: '2026-10-26', time: '14:00' }, c);
    assert.strictEqual(r.label, '100% late');
  });

  // ── 2. bsp-pipeline.js computeDay(commence) for upcoming api-tennis fixtures ──
  const P = require('../bsp-pipeline.js');
  for (const [d, t, want, what] of CASES) {
    await check(`bsp-pipeline apiTennisCommence: ${what}`, () => assert.strictEqual(P.apiTennisCommence(d, t), want));
  }
  const RealDate = Date;
  const dayAt = (nowIso, commence) => {
    global.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [nowIso])); } static now() { return RealDate.parse(nowIso); } };
    try { return P.computeDay(commence); } finally { global.Date = RealDate; }
  };
  await check('computeDay: 26 Oct 14:00 Berlin (13:00Z) is past at 13:30Z — the UTC read kept it "today" until 14:00Z', () => {
    assert.strictEqual(dayAt('2026-10-26T13:30:00Z', P.apiTennisCommence('2026-10-26', '14:00')), 'past');
    assert.strictEqual(dayAt('2026-10-26T13:30:00Z', '2026-10-26T14:00:00Z'), 'today');   // control: the old commence as the UTC runner read it
  });
  await check('computeDay: 24 Oct 14:00 Berlin (12:00Z) is past at 12:30Z — the UTC read was 2 h late', () =>
    assert.strictEqual(dayAt('2026-10-24T12:30:00Z', P.apiTennisCommence('2026-10-24', '14:00')), 'past'));
  await check('computeDay: 26 Oct 00:30 Berlin starts 25 Oct 23:30Z → "today" on 25 Oct, not "tomorrow"', () => {
    assert.strictEqual(dayAt('2026-10-25T20:00:00Z', P.apiTennisCommence('2026-10-26', '00:30')), 'today');
    assert.strictEqual(dayAt('2026-10-25T20:00:00Z', '2026-10-26T00:30:00Z'), 'tomorrow');   // control, as above
  });
  await check('computeDay: 25 Oct 01:30 Berlin starts 24 Oct 23:30Z → "today" on 24 Oct', () =>
    assert.strictEqual(dayAt('2026-10-24T20:00:00Z', P.apiTennisCommence('2026-10-25', '01:30')), 'today'));
  await check('computeDay: an upcoming fixture with no time keeps its bare date (as before: "past" once the day has begun)', () => {
    assert.strictEqual(P.apiTennisCommence('2026-10-26', null), '2026-10-26');
    assert.strictEqual(dayAt('2026-10-26T10:00:00Z', P.apiTennisCommence('2026-10-26', undefined)), 'past');
  });
  await check('pinCloseStart: a startTs record (date/time UTC) is not also read as Berlin — the 1 h-early term never wins the min', () => {
    const src = fs.readFileSync(path.join(ROOT, 'bsp-pipeline.js'), 'utf8');
    const bt = fs.readFileSync(path.join(ROOT, 'berlin-time.js'), 'utf8');
    const ctx = vm.createContext({});
    vm.runInContext(bt.slice(bt.indexOf('const BERLIN_FMT'), bt.indexOf('// Same, as a UTC ISO string')) + slice('pinCloseStart', src), ctx);
    const odds = { date: '2026-10-26', time: '14:00', startTs: '2026-10-26T14:00:00.000Z' };
    assert.strictEqual(iso(ctx.pinCloseStart(odds, NaN).ms), '2026-10-26T14:00:00.000Z');
    assert.strictEqual(iso(ctx.pinCloseStart({ date: '2026-10-26', time: '14:00' }, NaN).ms), '2026-10-26T13:00:00.000Z');
    assert.strictEqual(iso(ctx.pinCloseStart({ date: '2026-10-25', time: '01:30' }, NaN).ms), '2026-10-24T23:30:00.000Z');
  });
  await check('bsp-pipeline: the upcoming builder passes computeDay the Berlin-converted commence', () => {
    const src = fs.readFileSync(path.join(ROOT, 'bsp-pipeline.js'), 'utf8');
    const body = src.slice(src.indexOf('async function buildUpcomingMatchObject('), src.indexOf('day: computeDay(commence)'));
    assert.ok(/const commence = apiTennisCommence\(fixture\.event_date, fixture\.event_time/.test(body), 'commence is not converted');
  });

  // ── 3. the page's cardStartMs (bsp-consult-dashboard.html) — the 01:00–02:59 bug ──
  const page = vm.createContext({});
  vm.runInContext(slice('acctTzOffsetMin') + '\n' + slice('cardStartMs'), page);
  for (const [d, t, want, what] of CASES) {
    await check(`page cardStartMs: ${what}`, () => assert.strictEqual(iso(page.cardStartMs({ date: d, time: t })), want));
  }
  await check('page cardStartMs: startTs still wins; no time still NaN', () => {
    assert.strictEqual(iso(page.cardStartMs({ date: '2026-10-25', time: '01:30', startTs: '2026-10-25T09:00:00Z' })), '2026-10-25T09:00:00.000Z');
    assert.ok(Number.isNaN(page.cardStartMs({ date: '2026-10-25', time: '' })));
  });

  // ── 3b. stennisfy-drops/status.mjs apiStartMs (was a fixed +02:00) ──
  const drops = await import(path.join(ROOT, 'stennisfy-drops', 'status.mjs'));
  for (const [d, t, want, what] of CASES) {
    await check(`drops apiStartMs (Berlin sighting): ${what}`, () => assert.strictEqual(iso(drops.apiStartMs(d, t, false)), want));
  }
  await check('drops apiStartMs: our own &timezone=UTC calls still read as UTC', () =>
    assert.strictEqual(iso(drops.apiStartMs('2026-10-26', '14:00', true)), '2026-10-26T14:00:00.000Z'));

  // ── 4. build-series.js slate day tag (was event_date against the UTC today) ──
  const S = require('../build-series.js');
  await check('build-series slateDayOf: 26 Oct 00:30 Berlin is "today" on UTC 25 Oct (event_date said tomorrow)', () =>
    assert.strictEqual(S.slateDayOf({ event_date: '2026-10-26', event_time: '00:30' }, '2026-10-25', '2026-10-26'), 'today'));
  await check('build-series slateDayOf: 25 Oct 01:30 Berlin is "today" on UTC 24 Oct', () =>
    assert.strictEqual(S.slateDayOf({ event_date: '2026-10-25', event_time: '01:30' }, '2026-10-24', '2026-10-25'), 'today'));
  await check('build-series slateDayOf: daytime either side of the change stays on its date', () => {
    assert.strictEqual(S.slateDayOf({ event_date: '2026-10-24', event_time: '14:00' }, '2026-10-24', '2026-10-25'), 'today');
    assert.strictEqual(S.slateDayOf({ event_date: '2026-10-26', event_time: '14:00' }, '2026-10-25', '2026-10-26'), 'tomorrow');
  });
  await check('build-series slateDayOf: no time → the event_date as dated', () =>
    assert.strictEqual(S.slateDayOf({ event_date: '2026-10-26', event_time: '' }, '2026-10-25', '2026-10-26'), 'tomorrow'));

  // ── 4b. ten225-board-states.mjs (a month rule for DST: wrong in late Mar and late Oct) ──
  const bsSrc = fs.readFileSync(path.join(ROOT, 'ten225-board-states.mjs'), 'utf8');
  const bs = vm.createContext({ berlinWallMs });
  vm.runInContext(slice('cardStartMs', bsSrc), bs);
  for (const [d, t, want, what] of CASES) {
    await check(`ten225-board-states cardStartMs: ${what}`, () => assert.strictEqual(iso(bs.cardStartMs({ date: d, time: t })), want));
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
