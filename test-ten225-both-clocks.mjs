// TEN-225 — founder ruling 2026-09-18 09:33Z, items 1 + 3 + 4, as tests.
//
//   ITEM 1 — "show both clocks. Format: 'bet365 · 1.22 since 01:08 · seen
//   09:15' (book · price · when the book last moved it · when we last observed
//   it). If the one-line slot cannot hold it, use two lines in the tooltip
//   rather than dropping a clock."
//
//   ITEM 3 — "ten225-kibl-card-state.py writing the opener row into both open_
//   and now_: confirm that is fixed at source, not only guarded in the
//   renderer."
//
//   ITEM 4 — "a 0% needs two observations and ... comparing our observation
//   clock (not bet365's change instant) is the right test. Keep it."
//
// WHY THESE NEED TESTS AND NOT A SCREENSHOT. Every failure mode here is a
// LABEL, and a wrong label renders exactly as convincingly as a right one. The
// tooltip that started this round was not blank, it was confidently eight hours
// wrong. So each check below pins a STRING or a decision, and several carry a
// deliberate CONTROL — an input that must produce the opposite answer — because
// a suppression rule that suppresses everything passes a one-sided test.
//
// The functions are sliced out of the shipped HTML, never copied, so this file
// goes red if the page changes and it does not.
//
// Run: node --test test-ten225-both-clocks.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');

function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found in bsp-consult-dashboard.html`);
  let depth = 0, i = html.indexOf('{', start);
  const open = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  assert.ok(i > open, `${name} braces did not balance`);
  return html.slice(start, i + 1);
}

// MC_TITLE_1LINE_MAX is read out of the shipped source too. Hardcoding it here
// would let the page raise the threshold and leave this file asserting a wrap
// that no longer happens.
const maxM = html.match(/const MC_TITLE_1LINE_MAX = (\d+);/);
assert.ok(maxM, 'MC_TITLE_1LINE_MAX not found in bsp-consult-dashboard.html');
const MAX = Number(maxM[1]);

// The stub set is NOT a fixed list — every free identifier the shipped functions
// reach for has to be declared here, or the sandbox throws and every assertion
// below stops running while the file still looks like a test suite. That is what
// happened when G1 (c4eab0b7) put mxBookLabel inside mcPriceTitle: this file went
// 8/17 red on main and nothing surfaced it. `newsTz` and `mxBookLabel` are
// stubbed to identity/UTC so the assertions stay about CLOCK SELECTION, which is
// what this file is for — the labels have their own tests.
const shipped = ['ocsFmtTs', 'ocsFmtClock', 'mcPriceTitle', '_obsMs', '_measurablePair'].map(slice).join('\n');
const { mcPriceTitle, _measurablePair, _obsMs } = new Function(`
  const MC_TITLE_1LINE_MAX = ${MAX};
  const newsTz = () => 'UTC';
  const mxBookLabel = b => b;
  ${shipped}
  return { mcPriceTitle, _measurablePair, _obsMs };
`)();

// The page formats in the VIEWER's locale and timezone; the tests assert on the
// same formatter's own output rather than on a literal, so this file does not
// go red in another timezone while the page is correct.
const fmt = new Function(
  `const newsTz = () => 'UTC';\n${slice('ocsFmtTs')}\n${slice('ocsFmtClock')} return ocsFmtClock;`)();
// ocsFmtClock prints a BARE time for today and a dated one otherwise — correctly,
// since a bare "23:45" on a yesterday stamp would understate the tooltip's own
// age. That makes any fixture with a hardcoded calendar date a test that AGES:
// written on 2026-09-18 it asserted a 39-character one-liner, and by 2026-09-19
// the same call returns "Sep 18 09:08 AM" and wraps. The two format tests below
// therefore build their instants from TODAY; the clock VALUES are still asserted
// against the page's own formatter, never against a literal.
const DTODAY = new Date().toISOString().slice(0, 10);

// ─────────────────────────────────────────────────────── item 1 — both clocks
test('the founder format: book · price · since <book clock> · seen <our clock>', () => {
  const AT = `${DTODAY}T01:08:52Z`, OBS = `${DTODAY}T09:15:00Z`;
  const t = mcPriceTitle({ book: 'bet365', at: AT, obs: OBS, kind: 'book-tick' }, 1.22);
  assert.equal(t, `bet365 · 1.22 since ${fmt(AT)} · seen ${fmt(OBS)}`);
  assert.match(t, /since/);
  assert.match(t, /seen/);
});

test('NEITHER clock is ever dropped — when the line is too long it WRAPS', () => {
  // This is the founder's own instruction: "use two lines in the tooltip rather
  // than dropping a clock". The failure this guards is a silent truncation that
  // looks like the option-1 tooltip he rejected.
  const t = mcPriceTitle(
    { book: 'a-very-long-bookmaker-name', at: `${DTODAY}T01:08:52Z`,
      obs: `${DTODAY}T09:15:00Z`, kind: 'book-tick' }, 1.22);
  assert.ok(t.includes('\n'), `expected a wrap, got ${JSON.stringify(t)}`);
  assert.equal(t.split('\n').length, 2);
  assert.match(t, /since/);
  assert.match(t, /seen/);
  // CONTROL: the short form does NOT wrap, so the wrap is a length decision and
  // not something that fires unconditionally.
  const short = mcPriceTitle(
    { book: 'bet365', at: `${DTODAY}T01:08:52Z`, obs: `${DTODAY}T09:15:00Z`, kind: 'book-tick' }, 1.22);
  assert.ok(!short.includes('\n'), `the short form wrapped: ${JSON.stringify(short)}`);
});

test('the PRICE in the tooltip is the hovered cell\'s, not the fixture\'s', () => {
  const pair = { book: 'bet365', at: '2026-09-18T01:08:52Z', obs: '2026-09-18T09:15:00Z',
                 kind: 'book-tick', p1: 1.22, p2: 3.75 };
  assert.match(mcPriceTitle(pair, pair.p1), /^bet365 · 1\.22\b/);
  assert.match(mcPriceTitle(pair, pair.p2), /^bet365 · 3\.75\b/);
});

test('a `sighting` row prints seen ONLY — our poll time is never dressed as "since"', () => {
  // api-tennis ships no tick time. Printing our own clock after the word
  // "since" would assert the book moved the price when we looked at it, which
  // is the class of false label this whole round was opened about.
  const t = mcPriceTitle({ book: 'Betano', at: null, obs: '2026-09-18T09:22:10Z', kind: 'sighting' }, 1.18);
  assert.ok(!/since/.test(t), t);
  assert.match(t, /seen/);
});

test('`at` is NEVER borrowed as our observation clock', () => {
  // The takeover row writes now_ts = the LOADER'S run clock and leaves
  // now_observed_at NULL on purpose. A fallback from `obs` to `at` would print
  // that run clock as "seen" — the value the loader had just refused to record.
  const t = mcPriceTitle({ book: 'Betano', at: '2026-09-18T09:31:00Z', obs: null, kind: 'sighting' }, 1.18);
  assert.equal(t, 'Betano · 1.18');
  // CONTROL: with a REAL observation clock the same row does print it.
  assert.match(mcPriceTitle({ book: 'Betano', at: null, obs: '2026-09-18T09:31:00Z', kind: 'sighting' }, 1.18),
               /seen /);
});

test('a price with no clock at all names the book and stops', () => {
  assert.equal(mcPriceTitle({ book: 'Sbo', at: null, kind: 'sighting' }, 1.4), 'Sbo · 1.40');
});

test('the wrap keeps the BOOK CLOCK on line one — it is never the clock dropped', () => {
  const t = mcPriceTitle({ book: 'a-very-long-bookmaker-name', at: '2026-09-18T01:08:52Z',
                           obs: '2026-09-18T09:15:00Z', kind: 'book-tick' }, 1.22);
  const [l1, l2] = t.split('\n');
  assert.match(l1, /^a-very-long-bookmaker-name · 1\.22 since /);
  assert.match(l2, /^seen /);
});

test('zero is not a price in the tooltip either (standing rule)', () => {
  assert.equal(mcPriceTitle({ book: 'bet365', at: null, kind: 'sighting' }, 0), 'bet365');
});

test('no book -> no tooltip; a clock with no book names nothing', () => {
  assert.equal(mcPriceTitle({ at: '2026-09-18T01:08:52Z', obs: '2026-09-18T09:15:00Z' }, 1.22), '');
  assert.equal(mcPriceTitle(null, 1.22), '');
});

// ──────────────────────────────────── items 3 + 4 — a 0% needs two OBSERVATIONS
test('EVIDENCED FLAT: same price, LATER observation -> measurable', () => {
  const p = { o1: 1.22, o2: 3.75, n1: 1.22, n2: 3.75, book: 'sports411', kind: 'vendor-insert',
              obs: '2026-09-18T09:15:00Z' };
  assert.ok(_measurablePair(p, _obsMs('2026-09-18T01:15:00Z'), _obsMs('2026-09-18T09:15:00Z')));
});

test('SINGLE SIGHTING: same price, SAME observation -> not measurable', () => {
  const p = { o1: 4.1, o2: 1.25, n1: 4.1, n2: 1.25, book: 'sports411', kind: 'vendor-insert',
              obs: '2026-09-18T08:24:14Z' };
  assert.equal(_measurablePair(p, _obsMs('2026-09-18T08:24:14Z'), _obsMs('2026-09-18T08:24:14Z')), null);
});

test('a MOVE is its own evidence and needs no clock at all', () => {
  // The suppression must not reach a fixture that actually moved — that would
  // be item 2 broken in the other direction, hiding a real market move.
  const p = { o1: 6.5, o2: 1.091, n1: 9.0, n2: 1.061, book: 'bet365', kind: 'sighting' };
  assert.ok(_measurablePair(p, NaN, NaN));
});

test('a SIGHTING row with no observation clock can never evidence a flat', () => {
  // The takeover path: open_ts is the pin's sighting and now_ts is the LOADER's
  // run clock, so the plain timestamp test passes on a fixture we looked at
  // exactly once. Without this branch that renders a fabricated evidenced 0%.
  const p = { o1: 1.18, o2: 4.55, n1: 1.18, n2: 4.55, book: 'Betano', kind: 'sighting', obs: null };
  assert.equal(
    _measurablePair(p, _obsMs('2026-09-18T09:22:10Z'), _obsMs('2026-09-18T09:31:00Z')),
    null);
  // CONTROL: the same row WITH a real observation clock is measurable. Without
  // this the rule above would pass by suppressing every sighting row forever.
  const q = { ...p, obs: '2026-09-18T09:31:00Z' };
  assert.ok(_measurablePair(q, _obsMs('2026-09-18T09:22:10Z'), _obsMs('2026-09-18T09:31:00Z')));
});

test('the book\'s CHANGE INSTANT is not the test — our observation clock is', () => {
  // Griekspoor/Mejia, deployed 2026-09-18: bet365 last moved the price at
  // 09:05:58 and we re-read it at 09:15 having first seen it the previous
  // afternoon. Ordering on `at` alone is not what makes this measurable; two
  // separate looks are.
  const p = { o1: 1.15, o2: 4.5, n1: 1.15, n2: 4.5, book: 'bet365', kind: 'book-tick',
              obs: '2026-09-18T09:15:00Z' };
  assert.ok(_measurablePair(p, _obsMs('2026-09-17T15:45:01Z'), _obsMs('2026-09-18T09:15:00Z')));
  // And a NEWER `at` with no second look is still not evidence.
  assert.equal(_measurablePair(p, _obsMs('2026-09-18T09:15:00Z'), _obsMs('2026-09-18T09:15:00Z')), null);
});

// ───────────────────────────────── the publisher's half of item 3, as a contract
test('the publisher emits the observation clocks the renderer reads', () => {
  // A renderer preference for `openObs`/`nowObs` is inert if nothing writes
  // them. This pins the two ends to the same field names — the failure mode is
  // silent and looks exactly like "no data yet".
  const pub = readFileSync(join(HERE, 'ten225-publish-card-state.py'), 'utf8');
  for (const k of ['openObs', 'nowObs', 'open_observed_at', 'now_observed_at'])
    assert.ok(pub.includes(k), `ten225-publish-card-state.py does not mention ${k}`);
  assert.ok(pub.includes('open_observed_at,'), 'open_observed_at is not in the SELECT column list');
  for (const k of ['openObs', 'nowObs'])
    assert.ok(html.includes(k), `the dashboard does not read ${k}`);
});

test('the schema carries both columns, nullable', () => {
  const ddl = readFileSync(join(HERE, 'ten225-card-state-schema.sql'), 'utf8');
  assert.match(ddl, /open_observed_at\s+timestamptz/);
  assert.match(ddl, /now_observed_at\s+timestamptz/);
  // Idempotent ALTER too, or an instance that already has the table never gets
  // the columns and the publisher 400s on an unknown SELECT column.
  assert.match(ddl, /ADD COLUMN IF NOT EXISTS open_observed_at/);
  assert.match(ddl, /ADD COLUMN IF NOT EXISTS now_observed_at/);
  // NOT tied to the price by a CHECK: the oddspapi path has a price and no
  // observation clock, and a pairing constraint would reject every one of them.
  assert.ok(!/\(now_price IS NULL\) = \(now_observed_at IS NULL\)/.test(ddl));
});
