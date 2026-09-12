// Series page — founder-ruling lock harness for the card's date cells + footer.
//
// TEN-194 (ask c2719150, answered 2026-09-12). Three rulings, encoded the same
// day so they cannot silently regress:
//
//   footer-note (a) — the honesty note was reworded because ruling q1 moved POOL
//     off the card into the modal, which made "Every card shows both" false. The
//     stale sentence must stay gone; the drop guarantee must stay stated.
//   last-year   (a) — STARTED and LAST print the export's bare day + month, and
//     carry a 2-digit year ONLY when the run itself crosses a year boundary. The
//     year appears on BOTH cells or neither — never one alone.
//   two-up      (a) — the card grid stays minmax(400px,1fr); no 340px variant.
//
// Plus the three defects the clean-context review caught on that build, which are
// behaviour rather than ruling and would otherwise be invisible until December
// (today's series.json has no cross-year run to exercise them):
//
//   • a year-bearing strip is 84px of mono and ELIDES to "12 Sep ’…" below ~364px
//     unless the narrow-viewport variant relaxes it — a corrupted date is worse
//     than the year-less one it replaced, so the CSS escape hatch is pinned here.
//   • crossesYear must agree with fmtShort about what is renderable, or a lone
//     "’27" prints beside an em-dash.
//   • month 00/13 passes the \d{2} regex and would print "5 undefined" — a
//     fabricated user-visible value, against the standing missing-data rule.
//
// Run: node tools/test-series-dates.js   (also wired into `npm test`)
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'series.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'series.css'), 'utf8');

const checks = [];
const ok = (name) => checks.push(name);

// ── execute the SHIPPED helpers, rather than reimplementing them here. series.js
//    is a browser IIFE with no exports, so lift the date block out by its markers
//    and evaluate exactly those bytes.
function lift() {
  const start = src.indexOf('var YMD_RE =');
  const endMarker = '\n  function startedOf(';
  const end = src.indexOf(endMarker);
  assert(start > 0 && end > start, 'series.js date block not found — markers moved?');
  const block = src.slice(start, end);
  assert(/function fmtShort\(/.test(block) && /function crossesYear\(/.test(block) && /function fmtDate\(/.test(block),
    'date block no longer contains fmtDate/fmtShort/crossesYear');
  assert(/function priorYear\(/.test(block) && /function yearOfIso\(/.test(block),
    'date block no longer contains priorYear/yearOfIso');
  // eslint-disable-next-line no-new-func
  return new Function(block + '\n return { fmtDate: fmtDate, fmtShort: fmtShort, crossesYear: crossesYear,' +
    ' priorYear: priorYear, yearOfIso: yearOfIso };')();
}
const { fmtDate, fmtShort, crossesYear, priorYear, yearOfIso } = lift();

// ── last-year (a): the bare export form is the default ───────────────────────
assert.strictEqual(fmtShort('2026-09-12'), '12 Sep');
assert.strictEqual(fmtShort('2026-09-12', false), '12 Sep');
assert.strictEqual(fmtShort('2026-12-05'), '5 Dec');           // no leading zero on the day
ok('same-year cells keep the export\'s bare day + month');

// ── last-year (a): the year returns ONLY across a boundary, on BOTH cells ────
assert.strictEqual(crossesYear('2025-12-05', '2026-01-12'), true);
assert.strictEqual(fmtShort('2025-12-05', true), '5 Dec ’25');
assert.strictEqual(fmtShort('2026-01-12', true), '12 Jan ’26');
ok('a cross-year run carries a 2-digit year on both cells');

assert.strictEqual(crossesYear('2026-08-05', '2026-09-12'), false);
assert.strictEqual(crossesYear('2026-01-01', '2026-12-31'), false, 'a full year inside ONE year is not a crossing');
ok('a same-year run never carries a year');

// ── prior-year (a): the year also marks a run whose LAST is not in the data year ──
// The case the crossing rule cannot reach: a Slam run wholly inside a past year.
assert.strictEqual(crossesYear('2026-08-26', '2026-09-13'), false, 'wholly in 2026 — not a crossing');
assert.strictEqual(priorYear('2026-09-13', '2027-01-20T06:04:14.376Z'), true,
  'a 2026 run still on the board in 2027 must be marked');
assert.strictEqual(fmtShort('2026-08-26', true), '26 Aug ’26');
assert.strictEqual(fmtShort('2026-09-13', true), '13 Sep ’26');
ok('a run wholly inside a past year carries the year on both cells');

assert.strictEqual(priorYear('2026-09-13', '2026-09-12T06:04:14.376Z'), false,
  'a run inside the snapshot\'s own year stays bare — today\'s cards must not change');
ok('a current-data-year run keeps the export\'s bare day + month');

// The ruling says "not in the current data year" — which is a ≠, not a <. A LAST in a
// FUTURE year relative to the snapshot is equally not-in-the-data-year and is a real
// shape: a Jan-1-local United Cup match is 31 Dec UTC, so a fresh 31-Dec artifact can
// carry a 1-Jan LAST. Pinned because a `<` here reads as correct and is not.
assert.strictEqual(priorYear('2027-01-01', '2026-12-31T22:00:00Z'), true,
  'a future-year LAST is also outside the data year');
ok('the rule is "different year", not "earlier year"');

// The reference is the DATA's year, never the client clock, or the page would read
// differently by timezone and could disagree with the artifact it is painting.
assert.strictEqual(yearOfIso('2027-01-01T00:00:00Z'), '2027');
assert.strictEqual(yearOfIso('2026-12-31T23:30:00Z'), '2026', 'UTC, matching the UPDATED clock');
assert(!/new Date\(\)\.getFullYear|getFullYear\(\)/.test(src),
  'the year reference reads the client clock — it must come from generatedAt');
assert(/priorYear\(st\.lastDate, _data && _data\.generatedAt\)/.test(src),
  'priorYear is no longer fed generatedAt at the call site');
ok('the reference year comes from generatedAt in UTC, not the browser clock');

// No usable generatedAt → no marking. A year is never guessed. The LAST here is
// deliberately in a DIFFERENT year from any year the code could plausibly hardcode:
// testing this with a same-year date passes even against a stubbed-in constant.
assert.strictEqual(priorYear('2026-09-13', null), false);
assert.strictEqual(priorYear('2019-09-13', null), false, 'a missing generatedAt must not fall back to a constant');
assert.strictEqual(priorYear('2019-09-13', ''), false);
assert.strictEqual(priorYear('2019-09-13', 'not-a-date'), false);
assert.strictEqual(yearOfIso(null), null);
assert.strictEqual(yearOfIso(undefined), null);
assert.strictEqual(yearOfIso(''), null);
assert.strictEqual(yearOfIso('not-a-date'), null);
// V8's legacy parser invents a year instead of failing — these must NOT be accepted,
// or a malformed generatedAt year-stamps the whole board off a year found nowhere in
// the data. (new Date('Sep 12') is 2001; new Date('0') is 1999.)
assert.strictEqual(yearOfIso('Sep 12'), null, "'Sep 12' parses as 2001 — a fabricated reference year");
assert.strictEqual(yearOfIso('12'), null);
assert.strictEqual(yearOfIso('0'), null);
assert.strictEqual(yearOfIso('2026'), null, 'a bare year is not an instant');
// …and a timestamp with no Z/offset is read in the BROWSER's zone, which is exactly the
// per-timezone divergence the generatedAt reference exists to avoid.
assert.strictEqual(yearOfIso('2026-12-31T23:00:00'), null, 'no Z/offset — ambiguous, must not be trusted');
assert.strictEqual(yearOfIso('2026-09-12T06:04:11.197Z'), '2026', 'what build-series.js actually writes');
assert.strictEqual(yearOfIso('2027-01-01T09:00:00+10:00'), '2026', 'an explicit offset is resolved to UTC');
assert.strictEqual(yearOfIso('2026-09-12'), '2026', 'a bare ISO date is unambiguous');
ok('a malformed generatedAt yields no year — V8\'s parser cannot invent one');
// …and an unrenderable LAST must not drag a lone year onto STARTED beside its dash.
assert.strictEqual(priorYear(null, '2027-01-20T06:04:14.376Z'), false);
assert.strictEqual(priorYear('2026-13-05', '2027-01-20T06:04:14.376Z'), false, 'month 13 is a dash, not a year');
assert.strictEqual(priorYear('2026-9-13', '2027-01-20T06:04:14.376Z'), false, 'unpadded LAST is unrenderable');
ok('an unusable generatedAt or an unrenderable LAST yields no year, never a guess');

// The two rulings OR together at the call site — neither may be dropped.
assert(/crossesYear\(startYmd, st\.lastDate\) \|\|\s*\n?\s*priorYear\(/.test(src),
  'showYear no longer ORs the crossing rule with the prior-year rule');
ok('showYear ORs last-year (a) with prior-year (a)');

// ── the review's finding: one unknown end must not produce a lone year ───────
assert.strictEqual(crossesYear(null, '2026-01-12'), false);
assert.strictEqual(crossesYear('2025-12-05', null), false);
assert.strictEqual(crossesYear('2026-1-5', '2027-01-12'), false, 'unpadded start is unrenderable → no crossing');
assert.strictEqual(crossesYear('2025-12-05', '2027-01-12T10:00:00Z'), false, 'timestamp end is unrenderable → no crossing');
assert.strictEqual(fmtShort('2026-1-5'), null);
ok('an unrenderable end yields a dash on both cells, never a lone year');

// ── standing rule: never fabricate. An impossible month is a dash ────────────
assert.strictEqual(fmtShort('2026-00-05'), null, 'month 00 must not print "5 undefined"');
assert.strictEqual(fmtShort('2026-13-05', true), null, 'month 13 must not print "5 undefined ’26"');
assert.strictEqual(fmtDate('2026-00-05'), null);
assert.strictEqual(fmtDate('2026-13-05'), null);
assert.strictEqual(fmtShort(''), null);
assert.strictEqual(fmtShort(undefined), null);
assert.strictEqual(fmtDate('2026-09-12'), '12 Sep 2026', 'the modal keeps the FULL year');
ok('an impossible or missing date falls to a dash, never a fabricated string');

// ── the narrow-viewport escape hatch for year-bearing strips ────────────────
assert(/sr-strip--yr/.test(src), 'series.js no longer marks the year-bearing strip');
assert(/showYear \? ' sr-strip--yr' : ''/.test(src), 'the sr-strip--yr modifier is no longer gated on showYear');
const mq = css.slice(css.indexOf('@media (max-width: 640px)'));
assert(mq.indexOf('@media') === 0 && mq.length > 0, 'the narrow-viewport media query is gone');
assert(/\.sr-strip\.sr-strip--yr \{[^}]*grid-template-columns: 1fr 1fr/.test(mq),
  'the narrow-viewport two-column relaxation for year-bearing strips is gone — the year will elide below ~364px');
assert(/\.sr-strip\.sr-strip--yr .sr-cell:nth-child\(3\) \{[^}]*grid-column: 1 \/ -1/.test(mq),
  'TYPE no longer spans on the relaxed strip');
assert(/\[data-page="series"\] \.sr-strip\.sr-strip--yr/.test(mq),
  'the relaxation lost its [data-page="series"] scope and will be outranked by the base rule');
ok('a year-bearing strip still has its narrow-viewport relaxation, correctly scoped');

// ── two-up (a): the export's track width stands ──────────────────────────────
assert(/minmax\(400px, ?1fr\)/.test(css), 'the card grid is no longer the export\'s minmax(400px,1fr)');
assert(!/minmax\(340px, ?1fr\)/.test(css), 'a 340px track reappeared — ruling two-up (a) accepted 2-up');
ok('the card grid keeps the export\'s minmax(400px,1fr) — 2-up accepted');

// ── footer-note (a): the reworded honesty note ──────────────────────────────
// "this string must be GONE" runs against a comment-stripped view, so the code
// can still name the sentence it replaced and say why.
const srcCode = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
assert(!/Every card shows both/.test(srcCode), 'the stale "Every card shows both" claim is back — it is false since ruling q1');
assert(/Every streak carries both/.test(src), 'the reworded honesty claim is gone');
assert(/doesn’t appear/.test(src), 'the drop guarantee ("a streak that can’t show both doesn’t appear") is gone');
assert(/open it to see the pool/.test(src), 'the footer no longer tells the reader where the pool lives');
ok('the footer honesty note matches the build');

// ── and the guarantee the footer rests on, at its source ────────────────────
const flatten = src.slice(src.indexOf('function flatten'), src.indexOf('function passesFilters'));
assert(/st\.pool == null \|\| !st\.lastDate \|\| st\.ageDays == null/.test(flatten),
  'the poolless/dateless drop guard is gone — the footer\'s promise would become false');
ok('a streak with no pool or no date is still dropped before it reaches a card');

console.log('series date/footer ruling lock — ' + checks.length + ' checks pass:');
checks.forEach((c) => console.log('  ✓ ' + c));
