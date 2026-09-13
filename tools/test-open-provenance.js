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

// ---------------------------------------------------------------------------
// TEN-198 — the api-tennis bet365 OPEN fallback (founder ruling 2026-09-13,
// gate 05ded3ab): write-once capture, into m.openingOdds, vendor-tagged.
// ---------------------------------------------------------------------------
console.log('\nTEN-198 api-tennis bet365 OPEN fallback (founder ruling 2026-09-13)');

const SIGHT = { p1: 1.66, p2: 2.30, seenAt: '2026-09-12T16:10:21.000Z' };
// The real Zverev-Shelton shape: oddspapi 404s /v4/historical-odds, so the pipeline
// attaches NO oddsMovement at all and the old code `continue`d straight past it.
const noMovement = (over) => ({ id: 'm1', date: '2026-09-13', p1: 'A. Zverev', p2: 'B. Shelton', ...over });

t('no oddspapi movement at all + an api-tennis sighting -> a vendor-tagged OPEN', () => {
  const m = noMovement({ apiTennisBet365: { ...SIGHT } });
  runBlock({ matches: [m] });
  assert.ok(m.openingOdds, 'the fixture this issue was opened about must get an open');
  assert.strictEqual(m.openingOdds.p1, 1.66);
  assert.strictEqual(m.openingOdds.p2, 2.30);
  assert.strictEqual(m.openingOdds.bookmaker, 'bet365', 'it IS bet365 — same book, second vendor');
  assert.strictEqual(m.openingOdds.vendor, 'api-tennis');
  assert.strictEqual(m.openingOdds.src, 'vendor-sighting');
  assert.strictEqual(m.openingOdds.seenAt, '2026-09-12T16:10:21.000Z');
  assert.ok(!('at' in m.openingOdds),
    'api-tennis serves no timestamp — a vendor pin must not manufacture an `at`');
});

t('oddspapi has books but no bet365 legs + a sighting -> vendor OPEN (2nd exit path)', () => {
  const m = mk({ apiTennisBet365: { ...SIGHT } });
  m.oddsMovement.books = { pinnacle: { p1: series(['2026-09-10T13:00:00Z', 1.5]), p2: series(['2026-09-10T13:00:00Z', 2.5]) } };
  runBlock({ matches: [m] });
  assert.strictEqual(m.openingOdds.vendor, 'api-tennis');
  assert.strictEqual(m.openingOdds.p1, 1.66);
});

t('oddspapi bet365 WINS when both are available — the fallback is a fallback', () => {
  const m = mk({ apiTennisBet365: { ...SIGHT } });
  runBlock({ matches: [m], firstSeenByFixture: new Map([['fx1', '2026-09-10T19:00:00Z']]) });
  assert.strictEqual(m.openingOdds.src, 'first-sighting');
  assert.strictEqual(m.openingOdds.p1, 1.22);
  assert.ok(!m.openingOdds.vendor, 'the primary vendor must not be tagged as the fallback');
});

t('WRITE-ONCE: a sighting never overwrites an already-published open', () => {
  const m = noMovement({ apiTennisBet365: { ...SIGHT } });
  const prior = new Map([['id:m1', { openingOdds: { p1: 1.70, p2: 2.20, bookmaker: 'bet365', at: '2026-09-11T10:00:00.000Z', src: 'ingestion' } }]]);
  runBlock({ matches: [m], priorOdds: prior });
  assert.strictEqual(m.openingOdds.p1, 1.70, 'forward-only: a published open must not move');
  assert.ok(!m.openingOdds.vendor);
});

t('a carried VENDOR pin is HELD against a later bet365-less oddspapi stream', () => {
  // The regression that would make the fix self-defeating: the dash branch nulls a
  // carried open because it assumes it is cross-book. A vendor pin is bet365.
  const m = mk();
  m.oddsMovement.books = { pinnacle: { p1: series(['2026-09-10T13:00:00Z', 1.5]), p2: series(['2026-09-10T13:00:00Z', 2.5]) } };
  const prior = new Map([['id:m1', { openingOdds: { p1: 1.66, p2: 2.30, bookmaker: 'bet365', seenAt: SIGHT.seenAt, src: 'vendor-sighting', vendor: 'api-tennis' } }]]);
  runBlock({ matches: [m], priorOdds: prior });
  assert.ok(m.openingOdds, 'a vendor pin must survive a bet365-less oddspapi stream');
  assert.strictEqual(m.openingOdds.p1, 1.66);
  assert.strictEqual(m.openingOdds.vendor, 'api-tennis');
});

t('the provenance census does NOT relabel a vendor pin as an ingestion point', () => {
  const m = noMovement({ apiTennisBet365: { ...SIGHT } });
  const logs = runBlock({ matches: [m] });
  assert.strictEqual(m.openingOdds.src, 'vendor-sighting', 'the vendor tag must survive the census');
  const line = logs.find(l => l.includes('OPEN provenance split'));
  assert.ok(/1 \(100\.0%\) bet365 via api-tennis/.test(line), line);
});

t('the archive does NOT overwrite a vendor pin', () => {
  const m = mk({ apiTennisBet365: { ...SIGHT } });
  m.oddsMovement.books = { pinnacle: { p1: series(['2026-09-10T13:00:00Z', 1.5]), p2: series(['2026-09-10T13:00:00Z', 2.5]) } };
  runBlock({ matches: [m], archiveOpens: new Map([['fx1', { p1: 9.99, p2: 1.01, atMs: Date.parse('2026-09-01T00:00:00Z') }]]) });
  assert.strictEqual(m.openingOdds.p1, 1.66, 'an ingestion instant must not replace a sighting');
  assert.strictEqual(m.openingOdds.vendor, 'api-tennis');
});

t('a malformed sighting mints nothing — missing seenAt, or a non-positive price', () => {
  const a = noMovement({ apiTennisBet365: { p1: 1.66, p2: 2.30 } });               // no seenAt
  const b = noMovement({ id: 'm2', apiTennisBet365: { p1: 1.66, p2: 0, seenAt: SIGHT.seenAt } });
  const c = noMovement({ id: 'm3', apiTennisBet365: { p1: 1.66, p2: 2.30, seenAt: 'not-a-date' } });
  runBlock({ matches: [a, b, c] });
  assert.ok(!a.openingOdds, 'no observation instant -> no pin');
  assert.ok(!b.openingOdds, 'one leg only would be a cross-feed artefact -> no pin');
  assert.ok(!c.openingOdds, 'an unparseable instant -> no pin');
});

t('a COMPLETED fixture never pins a post-match api-tennis price as its OPEN', () => {
  // api-tennis keeps serving Home/Away after the match ends and buildPastMatchObject()
  // calls get_odds for completed fixtures — so an unguarded pin would publish a
  // post-match price under the word "Opening", permanently (write-once).
  const m = noMovement({ finalScore: { winner: 'p1', p1Sets: 3, p2Sets: 1 },
                         apiTennisBet365: { p1: 1.02, p2: 15.0, seenAt: '2026-09-13T21:00:00.000Z' } });
  const logs = runBlock({ matches: [m] });
  assert.ok(!m.openingOdds, 'a settled fixture must dash, not pin a post-match price');
  const line = logs.find(l => l.includes('OPEN fallback (founder ruling 2026-09-13'));
  assert.ok(/1 post-match sighting\(s\) REJECTED/.test(line), line);
});

t('an open captured while UPCOMING survives into the settled card', () => {
  // The other half of the rule above: write-once + the existing carry-forward is what
  // makes a completed card able to show an open at all on this path.
  const m = noMovement({ id: 'past-1', date: '2026-09-13', p1: 'A. Zverev', p2: 'B. Shelton',
                         finalScore: { winner: 'p2', p1Sets: 1, p2Sets: 3 } });
  const prior = new Map([['np:2026-09-13|azverev|bshelton',
    { openingOdds: { p1: 1.66, p2: 2.30, bookmaker: 'bet365', seenAt: SIGHT.seenAt, src: 'vendor-sighting', vendor: 'api-tennis' } }]]);
  runBlock({ matches: [m], priorOdds: prior });
  assert.strictEqual(m.openingOdds.p1, 1.66);
  assert.strictEqual(m.openingOdds.vendor, 'api-tennis');
});

t('the transient sighting carrier never reaches matches.json', () => {
  const m = noMovement({ apiTennisBet365: { ...SIGHT } });
  const m2 = mk({ id: 'm2', apiTennisBet365: { ...SIGHT } });
  runBlock({ matches: [m, m2], firstSeenByFixture: new Map([['fx1', '2026-09-10T19:00:00Z']]) });
  assert.ok(!('apiTennisBet365' in m), 'stripped on the fallback path');
  assert.ok(!('apiTennisBet365' in m2), 'stripped on the oddspapi-wins path too');
});

t('the fallback log reports both counters', () => {
  const m = noMovement({ apiTennisBet365: { ...SIGHT } });
  const logs = runBlock({ matches: [m] });
  const line = logs.find(l => l.includes('OPEN fallback (founder ruling 2026-09-13'));
  assert.ok(line, 'no TEN-198 fallback line emitted');
  assert.ok(/1 open\(s\) pinned to bet365 via api-tennis/.test(line), line);
  assert.ok(/0 carried vendor pin\(s\) held/.test(line), line);
});

// ---------------------------------------------------------------------------
// TEN-198 close-out — NO RETROACTIVE BACKFILL (founder ruling 2026-09-13,
// gate b2d536ed). Asked whether to import the one evidenced bet365 sighting for
// Zverev-Shelton (1 of 42 collector polls, 2026-09-12T16:10:21.048Z, 1.66/2.30)
// he chose A: leave it dashed. "The fix is forward-looking and that is all it
// claims." So an OPEN may only ever be an observation THIS pipeline's own live
// poll made. The 11/11 coverage figure was measured by REPLAYING the TEN-164
// collector archive (/Users/Michael/ten164-odds-probe, outside the repo) — that
// replay is a measurement artefact and must never become a pipeline input. The
// obvious "improvement" next month is to wire it in; this is the tripwire.
// ---------------------------------------------------------------------------
console.log('\nTEN-198 no retroactive backfill (founder ruling 2026-09-13, gate b2d536ed)');

t('a sighting our own live poll did not make mints nothing', () => {
  // Everything a replay/backfill would plausibly hang the value off — but no
  // apiTennisBet365, because no live poll of this run saw bet365.
  const m = noMovement({
    collectorSighting:      { ...SIGHT },
    apiTennisBet365History: [{ ...SIGHT }],
    vendorOpenBackfill:     { ...SIGHT },
  });
  runBlock({ matches: [m] });
  assert.ok(!m.openingOdds,
    'the OPEN may only come from the live carrier — no backfill field mints one');
});

t('the live get_odds call is the ONLY writer of the sighting carrier', () => {
  // A third write site is by definition a new provenance path for a published
  // OPEN. If you are adding one, you are re-opening gate b2d536ed: take it to
  // the founder rather than deleting this assertion.
  const writes = lines
    .map((l, i) => ({ n: i + 1, text: l.trim() }))
    .filter(o => /\bapiTennisBet365\s*=/.test(o.text));
  assert.strictEqual(writes.length, 2,
    `expected exactly 2 carrier write sites, found ${writes.length}:\n` +
    writes.map(o => `  L${o.n}: ${o.text}`).join('\n'));
  for (const o of writes) {
    assert.ok(/^if \((pastOdds|upOdds)\.bet365\) match\.apiTennisBet365 = \1\.bet365;$/.test(o.text),
      `L${o.n} does not assign straight from a live fetchApiTennisMatchOdds() result: ${o.text}`);
  }
  // ...and both of those variables must actually be that live call, not a re-bind.
  for (const v of ['pastOdds', 'upOdds']) {
    const decl = lines.filter(l => new RegExp(`(const|let|var)\\s+${v}\\b|\\b${v}\\s*\\]`).test(l));
    assert.ok(decl.length > 0, `no declaration found for ${v}`);
    const src = lines.join('\n');
    assert.ok(new RegExp(`${v}\\s*\\]?\\s*=?[\\s\\S]{0,200}?fetchApiTennisMatchOdds\\(`).test(src),
      `${v} is not bound to a live fetchApiTennisMatchOdds() call`);
  }
});

t('the pipeline reads no out-of-repo collector or replay artefact', () => {
  const src = lines.join('\n');
  for (const needle of ['ten164-odds-probe', 'collector.mjs', 'collector.log', '.ten198-probe']) {
    assert.ok(!src.includes(needle),
      `bsp-pipeline.js references ${needle} — a measurement artefact is not a feed`);
  }
  // No open may be built from a file read at all: the two legitimate stored
  // sources (odds-archive/, the previous matches.json) reach the block as
  // archiveOpens/priorOdds, both passed in by runPipeline, not read here.
  const block = BLOCK;
  assert.ok(!/readFileSync|readFile\(|require\(/.test(block),
    'the OPEN block must not read the filesystem — its inputs are passed in');
});

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
