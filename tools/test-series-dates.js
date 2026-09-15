// Series page — founder-ruling lock harness for the card's date cells + footer.
//
// TEN-194 (ask c2719150, answered 2026-09-12). Three rulings, encoded the same
// day so they cannot silently regress:
//
//   footer-note (a) — the honesty note was reworded because ruling q1 moved POOL
//     off the card into the modal, which made "Every card shows both" false. The
//     stale sentence must stay gone; the drop guarantee must stay stated.
//   last-year   (a) — STARTED and LAST print the export's bare day + month, and
//     carry a 2-digit year ONLY when the run itself crosses a year boundary.
//     Whenever both ends are renderable the year lands on both. (An end that cannot
//     render is a dash and drops its year — see `lone-year` below, which rules that
//     asymmetry IN rather than suppressing it.)
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

// ═══════════════════════════════════════════════════════════════════════════════
// TEN-204 item 2.3 SUPERSEDES the three date rulings below.
//
//   Brief, 2026-09-15, verbatim: "Four columns, 1fr 1fr 1fr 1.2fr: STARTED (with year,
//   '5 Aug 2026') / LAST (short, '13 Sep') / PRICE CELL / TYPE."
//
// So the year is now UNCONDITIONAL on STARTED, ABSENT from LAST, and FOUR digits. That
// replaces `last-year` (a), `prior-year` (a) and `lone-year` (a) — all 2026-09-12 — which
// put a 2-digit year on BOTH cells, but only on a year-crossing or prior-year run.
//
// The new rule is strictly stronger for the reader, which is why it is implemented rather
// than queried: every card now states the year its run began, so "Started 5 Dec 2025 /
// Last 12 Jan" is unambiguous without any conditional, and there is no longer a case where
// the card knows the year and withholds it.
//
// crossesYear() / priorYear() / yearOfIso() are KEPT and still unit-tested below, even
// though the strip no longer calls them. They encode founder rulings that are being
// superseded on the strength of one line in a brief; keeping them live makes a reversal a
// one-line change at the call site instead of a rebuild. That is a deliberate retention,
// not rot — every one of them is exercised here.
// ═══════════════════════════════════════════════════════════════════════════════

// ── TEN-204 2.3: the two cell forms ─────────────────────────────────────────
assert.strictEqual(fmtShort('2026-09-12'), '12 Sep');
assert.strictEqual(fmtShort('2026-09-12', false), '12 Sep');
assert.strictEqual(fmtShort('2026-12-05'), '5 Dec');           // no leading zero on the day
ok('LAST keeps the export\'s bare day + month');

assert.strictEqual(fmtShort('2026-08-05', true), '5 Aug 2026', 'the brief\'s worked example, verbatim');
assert.strictEqual(fmtShort('2025-12-05', true), '5 Dec 2025');
assert.strictEqual(fmtShort('2026-01-12', true), '12 Jan 2026');
assert(!/’/.test(String(fmtShort('2026-01-12', true))),
  'the 2-digit apostrophe year is back — TEN-204 2.3 asks for the full four digits');
ok('STARTED carries the FULL four-digit year ("5 Aug 2026")');

// The superseded helpers still behave, so a reversal is a call-site change.
assert.strictEqual(crossesYear('2025-12-05', '2026-01-12'), true);
assert.strictEqual(crossesYear('2026-08-05', '2026-09-12'), false);
assert.strictEqual(crossesYear('2026-01-01', '2026-12-31'), false, 'a full year inside ONE year is not a crossing');
assert.strictEqual(priorYear('2026-09-13', '2027-01-20T06:04:14.376Z'), true,
  'a 2026 run still on the board in 2027 would be marked, were the conditional live');
assert.strictEqual(priorYear('2026-09-13', '2026-09-12T06:04:14.376Z'), false);
ok('the superseded crossesYear/priorYear rules still hold at the helper level');

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
// Comment-stripped, so the code may still NAME the build-side expression it is contrasting
// itself with (`new Date().getFullYear() - 5`) without tripping its own guard. The rule is
// about what EXECUTES, not about what is written down.
const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
assert(!/new Date\(\)\.getFullYear|getFullYear\(\)/.test(noComments),
  'the year reference reads the client clock — it must come from the data');
ok('no client-clock year anywhere in the executed page code');

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

// ── TEN-204 2.3 · what the RENDERER actually paints ─────────────────────────
// Asserted against the shipped strip, not against the helpers: what the reader sees is what
// the renderer composes, and a source-text regex cannot hold this. That lesson is already
// recorded below in the `lone-year` block, and it applies unchanged to the new rule.
//
// ── lone-year (a), now superseded: an unknown START no longer affects LAST ───
// Under TEN-204 2.3 the two cells are independent by construction — STARTED always carries
// its year, LAST never does — so the asymmetry that ruling `lone-year` (a) had to defend is
// no longer reachable. What still has to hold is the standing rule underneath it: an
// unrenderable STARTED is a dash, and it must not damage LAST beside it.
//
// EXECUTE the shipped strip. A source-text regex cannot hold this: a guard written as
// `... && !!fmtShort(startYmd)` slips past any pattern anchored on `showYear &&`, and an
// earlier regex form of this very check passed against exactly that mutation.
const stripSrc = (() => {
  const a = src.indexOf('    var startYmd = startedOf(st);');
  const b = src.indexOf("      '</div>';", a);
  assert(a > 0 && b > a, 'series.js strip block not found — markers moved?');
  return src.slice(a, b + "      '</div>';".length);
})();
assert(/showYear/.test(stripSrc) && /sr-cell-v/.test(stripSrc), 'lifted the wrong block');
// Real helpers, stubbed surroundings; `st` and generatedAt are the only inputs.
// §2.3 (2026-09-15) added isMatchResultFam() to the strip: it chooses between the AVG PRICE
// cell and a line/set family's EMPTY third track. `isResult` defaults true so every existing
// date assertion keeps painting the match-result shape it was written against.
function paintStrip(startYmd, lastDate, generatedAt, isResult) {
  const fn = new Function('startedOf', 'st', '_data', 'esc', 'dash', 'FAM_BADGE', 'famOf',
    'fmtShort', 'crossesYear', 'priorYear', 'proofSummary', 'isMatchResultFam',
    stripSrc + '\n return strip;');
  return fn(() => startYmd, { lastDate, type: 'all' }, { generatedAt },
    (s) => String(s), '—', {}, () => 'all', fmtShort, crossesYear, priorYear,
    () => ({ label: 'Avg price', value: '1.42' }), () => isResult !== false);
}
// The headline rule, painted: STARTED with a four-digit year, LAST without one.
const std = paintStrip('2026-08-05', '2026-09-13', '2026-09-15T01:44:07.908Z');
assert(/Started<\/span><span class="sr-cell-v">5 Aug 2026</.test(std),
  'TEN-204 2.3: STARTED must paint "5 Aug 2026" — painted: ' + std);
assert(/Last<\/span><span class="sr-cell-v">13 Sep</.test(std),
  'TEN-204 2.3: LAST must paint the short form with no year — painted: ' + std);
assert(!/13 Sep 2026|13 Sep ’26/.test(std), 'LAST grew a year back — the brief asks for "13 Sep"');
ok('TEN-204 2.3: the RENDERER paints "Started 5 Aug 2026 / Last 13 Sep"');

// A same-year run is no longer a special case — it gets the year too.
const sameYear = paintStrip('2026-08-26', '2026-09-13', '2026-09-12T07:13:37.585Z');
assert(/26 Aug 2026/.test(sameYear) && /13 Sep</.test(sameYear),
  'a same-year run must still stamp STARTED — the conditional is gone. Painted: ' + sameYear);
ok('the year is unconditional — a same-year run carries it too');

// Standing rule: an unrenderable STARTED is a dash and does not damage LAST.
const lone = paintStrip(null, '2026-09-13', '2027-01-20T06:04:14.376Z');
assert(/Started<\/span><span class="sr-cell-v">—</.test(lone),
  'an unrenderable STARTED must dash — painted: ' + lone);
assert(/Last<\/span><span class="sr-cell-v">13 Sep</.test(lone),
  'an unrenderable STARTED must not blank LAST beside it. Painted: ' + lone);
assert(/sr-strip--yr/.test(lone), 'the strip lost its narrow-viewport modifier — the year will elide');
ok('an unrenderable STARTED dashes without damaging LAST');

// ── the third cell (PIXEL PASS §2.3, founder 2026-09-15) ────────────────────
// The ruling: a match-result family reads AVG PRICE over the mean of its own rows; a
// line/set family renders an EMPTY track — "No 'PROOF' label, no 'AVG 1ST-SET GAMES',
// no dash" — while TYPE stays in the fourth column so neighbouring cards line up.
//
// PAINTED, not pattern-matched. Both shapes are rendered from the shipped bytes and the
// output inspected, because "the label is absent" is exactly the kind of claim a source
// regex will happily confirm against a build that still prints it under another name.
{
  const resultStrip = paintStrip('2026-08-05', '2026-09-13', '2026-09-15T01:44:07.908Z', true);
  assert(/Avg price<\/span><span class="sr-cell-v sr-cell-pv">1\.42</.test(resultStrip),
    '§2.3: a match-result card must read AVG PRICE over its figure. Painted: ' + resultStrip);

  const lineStrip = paintStrip('2026-08-05', '2026-09-13', '2026-09-15T01:44:07.908Z', false);
  // Four cells still, so TYPE stays in track four.
  assert((lineStrip.match(/class="sr-cell[ "]/g) || []).length === 4,
    '§2.3: a line/set card must still emit FOUR strip cells so TYPE stays in the fourth ' +
    'track and the card aligns with its neighbours. Painted: ' + lineStrip);
  assert(/<span class="sr-cell sr-cell-blank"><\/span>/.test(lineStrip),
    '§2.3: a line/set card\'s third track must be EMPTY. Painted: ' + lineStrip);
  // The three rejected renderings, each named, each asserted absent from the PAINTED cell.
  assert(!/Proof|Avg games|Avg margin|1st-set games|Avg price/i.test(lineStrip),
    '§2.3: a line/set card is printing a price-or-proof LABEL in its third track — the ' +
    'founder removed all of them ("no PROOF label, no AVG 1ST-SET GAMES"). Painted: ' + lineStrip);
  assert(!/sr-cell-pv/.test(lineStrip),
    '§2.3: a line/set card carries the bold price modifier — AVG PRICE is the only bold ' +
    'value in the strip. Painted: ' + lineStrip);
  // A dash is NOT the empty state here: the founder ruled the track blank, and a dash
  // reads as "we looked and found nothing" for a figure we deliberately stopped showing.
  const third = /sr-cell-v">([^<]*)<\/span><\/span><span class="sr-cell"><span class="sr-cell-k">Type/.exec(lineStrip);
  assert(!third, '§2.3: a line/set card still paints a VALUE (a dash or a figure) between ' +
    'LAST and TYPE. The track must be empty. Painted: ' + lineStrip);
}
// §2.3's literal ratio, restored. TEN-204 had overridden the first track to 1.2fr because
// on the 3-up grid the even ratio gave STARTED 82.2px against an intrinsic 84-92px and
// ellipsised the year. The founder re-specified the even ratio after being shown that, so
// the spec value is what ships and the clip is reported rather than re-overridden.
// Locked so a later run cannot quietly reinstate the override without a new ruling.
assert(/grid-template-columns: 1fr 1fr 1fr 1\.2fr/.test(css),
  '§2.3: the card strip is no longer the four tracks "1fr 1fr 1fr 1.2fr". That ratio is a '
  + 'founder ruling of 2026-09-15, made in full knowledge that it clips STARTED on the 3-up '
  + 'grid — it must not be re-widened without a new ruling.');
{
  const m = /\.sr-strip \{[^}]*grid-template-columns: ([^;]+);/.exec(css);
  const tr = m && m[1].trim().split(/\s+/).map((x) => parseFloat(x));
  assert(tr && tr.length === 4, 'the strip is not four tracks');
  assert(tr[0] === 1 && tr[1] === 1 && tr[2] === 1 && Math.abs(tr[3] - 1.2) < 1e-9,
    '§2.3: the strip tracks are ' + JSON.stringify(tr) + ', not 1 / 1 / 1 / 1.2');
}
// AVG PRICE renders whatever proofSummary() returns, and DASHES when it returns null.
//
// This replaces "must show a DASH ... until Phase 3 is authorised", which had gone stale:
// Phase 3 was authorised and prices shipped live on 2026-09-15, so the rule it enforced no
// longer existed. It kept passing only because this file's own stub returned `value: null` —
// its expectation came from the stub rather than from the code, so it could not fail for the
// right reason. Both branches are now painted from the shipped bytes with a stub that
// actually varies, which is what makes the pair able to fail.
{
  const priced = paintStrip('2026-08-05', '2026-09-13', '2026-09-15T01:44:07.908Z', true);
  assert(/Avg price<\/span><span class="sr-cell-v sr-cell-pv">1\.42</.test(priced),
    'a priced match-result card must paint its AVG PRICE figure. Painted: ' + priced);
  const unpriced = (() => {
    const fn = new Function('startedOf', 'st', '_data', 'esc', 'dash', 'FAM_BADGE', 'famOf',
      'fmtShort', 'crossesYear', 'priorYear', 'proofSummary', 'isMatchResultFam',
      stripSrc + '\n return strip;');
    return fn(() => '2026-08-05', { lastDate: '2026-09-13', type: 'all' },
      { generatedAt: '2026-09-15T01:44:07.908Z' }, (s) => String(s),
      '<span class="sr-dash">—</span>', {}, () => 'all', fmtShort, crossesYear, priorYear,
      () => ({ label: 'Avg price', value: null }), () => true);
  })();
  assert(/Avg price<\/span><span class="sr-cell-v sr-cell-pv"><span class="sr-dash">—<\/span></.test(unpriced),
    'an UNPRICED match-result card must dash under AVG PRICE — never a zero, never a ' +
    'plausible default (standing rule). Painted: ' + unpriced);
  assert(!/>0\.00<|>0<|>—0/.test(unpriced), 'an unpriced AVG PRICE painted a zero. Painted: ' + unpriced);
}
ok('the strip has four tracks; AVG PRICE paints its figure and dashes when unpriced');

// ── the review's finding: the converse — an unknown LAST yields NO year at all ─
// Not a contradiction of lone-year (a): there the year is carried by the cell that
// CAN render it. Here the year's own source cell is the dash, so nothing supports a
// year and STARTED must not be given one.
assert.strictEqual(crossesYear(null, '2026-01-12'), false);
assert.strictEqual(crossesYear('2025-12-05', null), false);
assert.strictEqual(crossesYear('2026-1-5', '2027-01-12'), false, 'unpadded start is unrenderable → no crossing');
assert.strictEqual(crossesYear('2025-12-05', '2027-01-12T10:00:00Z'), false, 'timestamp end is unrenderable → no crossing');
assert.strictEqual(fmtShort('2026-1-5'), null);
ok('an unrenderable end yields a dash on both cells, never a lone year');

// ── standing rule: never fabricate. An impossible month is a dash ────────────
assert.strictEqual(fmtShort('2026-00-05'), null, 'month 00 must not print "5 undefined"');
assert.strictEqual(fmtShort('2026-13-05', true), null, 'month 13 must not print "5 undefined 2026"');
assert.strictEqual(fmtDate('2026-00-05'), null);
assert.strictEqual(fmtDate('2026-13-05'), null);
assert.strictEqual(fmtShort(''), null);
assert.strictEqual(fmtShort(undefined), null);
assert.strictEqual(fmtDate('2026-09-12'), '12 Sep 2026', 'the modal keeps the FULL year');
ok('an impossible or missing date falls to a dash, never a fabricated string');

// The modal used to fall back to the RAW string, so an unrenderable date printed
// verbatim there while the card beside it dashed for the same value.
assert(!/fmtDate\(r\.date\) \|\| r\.date/.test(src),
  'the modal prints the raw date string again when fmtDate fails — the card dashes for the same value');
assert(/fmtDate\(r\.date\) \? esc\(fmtDate\(r\.date\)\) : dash/.test(src),
  'the modal date cell no longer dashes on an unrenderable date');
ok('the modal dashes an unrenderable date too, matching the card');

// ── the narrow-viewport escape hatch for year-bearing strips ────────────────
assert(/sr-strip--yr/.test(src), 'series.js no longer marks the year-bearing strip');
assert(/showYear \? ' sr-strip--yr' : ''/.test(src), 'the sr-strip--yr modifier is no longer gated on showYear');
const mq = css.slice(css.indexOf('@media (max-width: 640px)'));
assert(mq.indexOf('@media') === 0 && mq.length > 0, 'the narrow-viewport media query is gone');
// TEN-204 2.3: every card is year-bearing now AND the strip is four cells wide, so the
// relaxation applies to `.sr-strip` outright and lays out 2x2 rather than spanning TYPE.
assert(/\.sr-strip\.sr-strip--yr \{[^}]*grid-template-columns: 1fr 1fr/.test(mq),
  'the narrow-viewport two-column relaxation is gone — four mono cells will elide below ~364px');
assert(/\[data-page="series"\] \.sr-strip,\s*\n\s*\[data-page="series"\] \.sr-strip\.sr-strip--yr/.test(mq),
  'the relaxation no longer covers the unmodified .sr-strip — a four-cell strip needs it on every card');
assert(/\[data-page="series"\] \.sr-strip\.sr-strip--yr/.test(mq),
  'the relaxation lost its [data-page="series"] scope and will be outranked by the base rule');
ok('the four-cell strip still has its narrow-viewport relaxation, correctly scoped');

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
