#!/usr/bin/env node
// TEN-179 item 1 (founder ruling 2026-09-11) — the OPEN provenance rules.
//
// "Where both are available, prefer the honest pin — the last Bet365 price showing
//  when we first looked. Fall back to the ingestion point only when there's nothing
//  better. Never derive, never interpolate, never take the series low. Report which
//  of the two each published open came from."
//
// This runs the SHIPPED bsp-pipeline.js source, not a copy of it. The odds
// open/close/NOW block lives inline inside runPipeline() and is not exported, so the
// harness slices those exact lines out of the file on disk and evaluates them with
// the free variables they close over. If someone edits the block, this test runs the
// edited text — which is the only way a test of an inline block is worth anything.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'bsp-pipeline.js');
const lines = fs.readFileSync(SRC, 'utf8').split('\n');

// Slice [let openDerived ... end of the provenance-split log block].
const start = lines.findIndex(l => l.startsWith('  let openDerived = 0,'));
assert.ok(start >= 0, 'could not find the odds-pin block in bsp-pipeline.js');
const splitLog = lines.findIndex(l => l.includes('OPEN provenance split (founder ruling'));
assert.ok(splitLog > start, 'could not find the provenance-split log in bsp-pipeline.js');
// The split log sits inside a `{ ... }` block; take everything through its closing brace.
let end = splitLog;
while (end < lines.length && lines[end] !== '  }') end++;
const BLOCK = lines.slice(start, end + 1).join('\n');

// Free variables the block closes over inside runPipeline().
function lastAtOrBefore(series, ms) {
  let hit = null;
  for (const p of series) { if (Date.parse(p[0]) <= ms) hit = p; else break; }
  return hit;
}
const normalizeName = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

function runBlock({ matches, priorOdds = new Map(), archiveOpens = new Map(), firstSeenByFixture = new Map() }) {
  const logs = [];
  const console_ = { log: (...a) => logs.push(a.join(' ')) };
  const fn = new Function(
    'matches', 'priorOdds', 'archiveOpens', 'firstSeenByFixture',
    'lastAtOrBefore', 'normalizeName', 'console',
    BLOCK);
  fn(matches, priorOdds, archiveOpens, firstSeenByFixture, lastAtOrBefore, normalizeName, console_);
  return logs;
}

// A bet365 series: [isoTimestamp, price]. Ascending, as the refresher writes it.
const series = (...pts) => pts;
const mk = (over) => ({
  id: 'm1', date: '2026-09-11', p1: 'A', p2: 'B',
  oddsMovement: {
    fixtureId: 'fx1', capturedAt: '2026-09-11T02:52:44Z',
    books: {
      bet365: {
        p1: series(['2026-09-10T13:41:00.351Z', 1.167], ['2026-09-10T18:00:00.000Z', 1.22], ['2026-09-11T02:34:48.523Z', 1.20]),
        p2: series(['2026-09-10T13:41:00.351Z', 5.00], ['2026-09-10T18:00:00.000Z', 4.60], ['2026-09-11T02:34:45.376Z', 4.50]),
      },
    },
  },
  ...over,
});

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
};

console.log('TEN-179 OPEN provenance (founder ruling 2026-09-11 item 1)');

t('honest pin wins when a first sighting has a quote at or before it', () => {
  const m = mk();
  runBlock({ matches: [m], firstSeenByFixture: new Map([['fx1', '2026-09-10T19:00:00Z']]) });
  assert.strictEqual(m.openingOdds.src, 'first-sighting');
  // 18:00 is the last quote at/before the 19:00 sighting — NOT series[0] (1.167),
  // and NOT the series low.
  assert.strictEqual(m.openingOdds.p1, 1.22);
  assert.strictEqual(m.openingOdds.at, '2026-09-10T18:00:00.000Z');
  assert.strictEqual(m.openingOdds.seenAt, new Date('2026-09-10T19:00:00Z').toISOString());
});

t('no first sighting -> ingestion point, PUBLISHED and explicitly labelled', () => {
  const m = mk();
  runBlock({ matches: [m] });
  assert.strictEqual(m.openingOdds.src, 'ingestion', 'the fallback must name itself');
  assert.strictEqual(m.openingOdds.p1, 1.167, 'ingestion pin is series[0], published not withheld');
  assert.ok(!('seenAt' in m.openingOdds), 'an ingestion pin must not claim a sighting');
});

t('sighting known but series starts after it -> ingestion, not a fabricated pin', () => {
  const m = mk();
  runBlock({ matches: [m], firstSeenByFixture: new Map([['fx1', '2026-09-10T10:00:00Z']]) });
  assert.strictEqual(m.openingOdds.src, 'ingestion');
  assert.strictEqual(m.openingOdds.p1, 1.167);
});

t('never takes the series low', () => {
  const m = mk();
  m.oddsMovement.books.bet365.p1 = series(
    ['2026-09-10T13:41:00.351Z', 1.30], ['2026-09-10T18:00:00.000Z', 1.05], ['2026-09-11T02:00:00.000Z', 1.25]);
  runBlock({ matches: [m] });
  assert.strictEqual(m.openingOdds.p1, 1.30, 'must be the first point, not the minimum');
});

t('archive replaces an ingestion pin only when genuinely earlier', () => {
  const m = mk();
  runBlock({ matches: [m], archiveOpens: new Map([['fx1', { p1: 1.30, p2: 4.0, atMs: Date.parse('2026-09-10T09:00:00Z') }]]) });
  assert.strictEqual(m.openingOdds.src, 'archive');
  assert.strictEqual(m.openingOdds.p1, 1.30);
});

t('archive does NOT overwrite the honest pin (ruling: prefer the honest pin)', () => {
  const m = mk();
  runBlock({
    matches: [m],
    firstSeenByFixture: new Map([['fx1', '2026-09-10T19:00:00Z']]),
    archiveOpens: new Map([['fx1', { p1: 1.30, p2: 4.0, atMs: Date.parse('2026-09-10T09:00:00Z') }]]),
  });
  assert.strictEqual(m.openingOdds.src, 'first-sighting');
  assert.strictEqual(m.openingOdds.p1, 1.22);
});

t('archive LATER than the pin is ignored', () => {
  const m = mk();
  runBlock({ matches: [m], archiveOpens: new Map([['fx1', { p1: 9.99, p2: 1.01, atMs: Date.parse('2026-09-10T20:00:00Z') }]]) });
  assert.strictEqual(m.openingOdds.src, 'ingestion');
  assert.strictEqual(m.openingOdds.p1, 1.167);
});

t('a carried open keeps its VALUE and gains an ingestion label', () => {
  const m = mk();
  const prior = new Map([['id:m1', { openingOdds: { p1: 1.167, p2: 5, bookmaker: 'bet365', at: '2026-09-10T13:41:00.351Z' } }]]);
  runBlock({ matches: [m], priorOdds: prior, firstSeenByFixture: new Map([['fx1', '2026-09-10T19:00:00Z']]) });
  assert.strictEqual(m.openingOdds.p1, 1.167, 'forward-only: a published open must not move');
  assert.strictEqual(m.openingOdds.at, '2026-09-10T13:41:00.351Z');
  assert.strictEqual(m.openingOdds.src, 'ingestion', 'and it must now name its source');
});

t('a carried open that already names a source is left alone', () => {
  const m = mk();
  const prior = new Map([['id:m1', { openingOdds: { p1: 1.22, p2: 4.6, bookmaker: 'bet365', at: '2026-09-10T18:00:00.000Z', src: 'first-sighting' } }]]);
  runBlock({ matches: [m], priorOdds: prior });
  assert.strictEqual(m.openingOdds.src, 'first-sighting');
  assert.strictEqual(m.openingOdds.p1, 1.22);
});

t('an open that reached the board WITHOUT a priorOdds hit is still labelled', () => {
  // The case that moved the labelling out of the carry-forward path: m.openingOdds is
  // already set on the match object and priorOdds has no record for it. Before, this
  // published unlabelled and was invisible in the split.
  const m = mk({ openingOdds: { p1: 1.167, p2: 5, bookmaker: 'bet365', at: '2026-09-10T13:41:00.351Z' } });
  runBlock({ matches: [m] });
  assert.strictEqual(m.openingOdds.src, 'ingestion');
  assert.strictEqual(m.openingOdds.p1, 1.167, 'forward-only: the value must not move');
});

t('labelling does not leak across two matches sharing one priorOdds record', () => {
  const rec = { openingOdds: { p1: 1.167, p2: 5, bookmaker: 'bet365', at: '2026-09-10T13:41:00.351Z' } };
  const a = mk(), b = mk({ id: 'm2' });
  runBlock({ matches: [a, b], priorOdds: new Map([['id:m1', rec], ['id:m2', rec]]) });
  assert.strictEqual(a.openingOdds.src, 'ingestion');
  assert.strictEqual(b.openingOdds.src, 'ingestion');
  assert.ok(!rec.openingOdds.src, 'the shared priorOdds record must not be mutated');
  assert.notStrictEqual(a.openingOdds, b.openingOdds, 'the two matches must not share one object');
});

t('the split log counts every PUBLISHED open, carried ones included', () => {
  const a = mk(), b = { ...mk(), id: 'm2' };
  b.oddsMovement = JSON.parse(JSON.stringify(a.oddsMovement));
  b.oddsMovement.fixtureId = 'fx2';
  const logs = runBlock({
    matches: [a, b],
    priorOdds: new Map([['id:m2', { openingOdds: { p1: 1.167, p2: 5, bookmaker: 'bet365', at: '2026-09-10T13:41:00.351Z' } }]]),
    firstSeenByFixture: new Map([['fx1', '2026-09-10T19:00:00Z']]),
  });
  const line = logs.find(l => l.includes('OPEN provenance split'));
  assert.ok(line, 'no provenance-split line emitted');
  assert.ok(/over 2 published open\(s\)/.test(line), line);
  assert.ok(/1 \(50\.0%\) honest pin/.test(line), line);
  assert.ok(/1 \(50\.0%\) oddspapi ingestion point/.test(line), line);
  
});

t('no bet365 stream -> no open at all (dash), never a cross-book artefact', () => {
  const m = mk();
  m.oddsMovement.books = { pinnacle: { p1: series(['2026-09-10T13:00:00Z', 1.5]), p2: series(['2026-09-10T13:00:00Z', 2.5]) } };
  runBlock({ matches: [m] });
  assert.ok(!m.openingOdds, 'an open must not be minted from another book');
});

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
