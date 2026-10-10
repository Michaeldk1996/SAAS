// Series page — founder-ruling lock harness for items 2 and 5.
//
// TEN-194 (ask a37a68e9, answered 2026-09-12). Four rulings, all option (a), encoded
// the same day so they cannot silently regress:
//
//   handicap-line    (a) — drop the −1.5/−5.5 fallback. A handicap card ships ONLY at
//     −3.5; on a thin day the family disappears rather than falling back to a line
//     that says nothing (−1.5 is cleared by 79 of 79 straight-sets bo3 wins).
//   handicap-bestof  (a) — the CARD drops the "(best-of-N)" qualifier: "Covered −3.5
//     games". The History modal is out of scope and keeps it, so the format the run
//     was built on is still visible somewhere.
//   reference-label  (a) — the sub-line NAMES the window, never "career": the pool is
//     five calendar years AND tier-scoped, so "career" would be a false claim.
//   reference-lone   (a) — a run that is the only one ever to reach its own length
//     prints as-is rather than being reworded or truncated.
//
// TEN-204 item 2.4 (2026-09-15) REWORDS the sub-line and RE-SOURCES its year:
//   "longest since 2021 9 · 1st time at 9+"  ->  "Best since 2021: 9 · 1st run of 9+",
//   the year comes from the STREAK (earliest in-tier record) rather than the artifact's
//   query window, the type drops 14px -> 11.5px, and a player with a coverage YEAR GAP
//   dashes the line. Both rulings above survive in substance and are still asserted.
//
// Plus item 5's own standing requirement: "Both components required. If either is
// unavailable for a streak type, the sub-line renders — rather than showing half."
//
// METHOD — every assertion EXECUTES the shipped code and is mutation-checked.
// Source-text regexes are not used to prove behaviour here: on the `lone-year` lock a
// regex form passed against the REJECTED option, which is how that lesson was learnt.
// Each block below lifts the real bytes out of series.js and runs them.
//
// Run: node tools/test-series-reference.js   (also wired into `npm test`)
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'series.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'series.css'), 'utf8');

const checks = [];
const ok = (name) => checks.push(name);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ── TEN-427 (founder step 14, 2026-10-10): the reference sub-line ("Best since 2021: 9 · 4th run of 6+") is OFF the
// page — the design's card 2b and Count-tile pop-up have no slot for it, and the reference wins. The ENGINE still
// computes streak.reference (asserted below), so the sub-line can return without a rebuild.
assert(!/function referenceHtml\(/.test(src), 'the reference sub-line renderer is back on the page — card 2b has no slot for it');

// ── handicap-bestof (a): the CARD drops it, the MODAL keeps it ───────────────
// Executes the shipped claim builders rather than reading them.
function liftClaim(source) {
  const start = source.indexOf('  var ARCH_LABEL = {};');
  const end = source.indexOf('  // ─── THE ONE ROW BUILDER');
  assert(start > 0 && end > start, 'series.js claim block not found — markers moved?');
  const block = source.slice(start, end);
  assert(/function claimOf\(/.test(block) && /function claimLong\(/.test(block), 'lifted the wrong block');
  // eslint-disable-next-line no-new-func
  return new Function('esc', 'cap',
    block + '\n return { claimOf: claimOf, claimLong: claimLong };')(esc, (s) => String(s));
}
const { claimOf, claimLong } = liftClaim(src);
const hcap = { type: 'handicap', cover: true, line: 3.5, bestOf: 5, direction: 'win' };
// TEN-427 round 2 (founder 20de43fe, fix 2) rewords the claim to the reference's template ("Won by more than 3.5 games —
// covered −3.5"); the ruling stands: no "(best-of-N)" on the card, the pop-up keeps it.
assert.strictEqual(claimOf(hcap), 'Won by more than 3.5 games — covered −3.5',
  'ruling handicap-bestof (a): the card must read the reference wording with no format qualifier');
assert(!/best-of/.test(claimOf(hcap)), 'the card kept "(best-of-N)" — ruling handicap-bestof (a) rejected option (b)');
assert(!/best-of/.test(claimOf({ type: 'handicap', cover: false, line: 3.5, bestOf: 3, direction: 'loss' })),
  'the losing side of the handicap family still prints the format qualifier');
assert.strictEqual(claimLong(hcap), 'Won by more than 3.5 games — covered −3.5 (best-of-5)',
  'the History modal is out of scope ("does not change") and must keep the format qualifier');
// …and the neighbouring family must NOT have been swept up: total games keeps its
// qualifier, because only item 2 was ruled on.
assert(/best-of-3/.test(claimOf({ type: 'total', over: false, line: 23.5, bestOf: 3, direction: 'loss' })),
  'the TOTAL family lost its "(best-of-N)" — ruling handicap-bestof (a) was about the handicap card only');
ok('handicap-bestof (a): the card drops "(best-of-N)", the modal and the total family keep it');

// ── handicap-line (a): −3.5 only; the fallback never reaches a card ──────────
// Executes flatten() — the real gate — with a stubbed suppression pass, so this
// measures the shipped filter and not a copy of its condition.
function liftFlatten(source) {
  const start = source.indexOf('  var HANDICAP_DISPLAY_LINE =');
  const end = source.indexOf('  function passesFilters(c');
  assert(start > 0 && end > start, 'series.js flatten block not found — markers moved?');
  const block = source.slice(start, end);
  // TEN-427 round 2: the subset suppression moved from flatten() to reslot() (it runs on the as-of-start runs)
  assert(/function flatten\(data\)/.test(block), 'lifted the wrong block');
  // eslint-disable-next-line no-new-func
  return new Function('suppressOutcomeDuplicates',
    block + '\n return flatten;')((cards) => cards);
}
const flatten = liftFlatten(src);
const live = { pool: 40, lastDate: '2026-09-12', ageDays: 0 };
const board = {
  players: [{
    name: 'X', streaks: [
      Object.assign({ type: 'handicap', line: 3.5, count: 7, cover: true }, live),
      Object.assign({ type: 'handicap', line: 1.5, count: 9, cover: true }, live),
      Object.assign({ type: 'handicap', line: 5.5, count: 4, cover: true }, live),
      Object.assign({ type: 'handicap', line: '3.5', count: 6, cover: true }, live),  // string line
      Object.assign({ type: 'all', count: 6, direction: 'win' }, live),
      Object.assign({ type: 'total', line: 1.5, count: 5, over: true }, live),        // NOT handicap
    ],
  }],
};
const kept = flatten(board).map((c) => c.streak);
const keptHcap = kept.filter((s) => s.type === 'handicap');
assert.strictEqual(keptHcap.length, 2, 'expected the two −3.5 runs and nothing else, got ' +
  JSON.stringify(keptHcap.map((s) => s.line)));
assert(keptHcap.every((s) => Number(s.line) === 3.5),
  'ruling handicap-line (a) REVERTED: a fallback line reached a card. Lines kept: ' +
  JSON.stringify(keptHcap.map((s) => s.line)));
assert(!kept.some((s) => s.type === 'handicap' && Number(s.line) === 1.5),
  'the −1.5 fallback is back — and note it is the LONGEST run here (9 v 7), which is exactly ' +
  'why it used to win the family before fix #4');
assert(kept.some((s) => s.type === 'total' && Number(s.line) === 1.5),
  'the −3.5-only rule leaked outside the handicap family and ate a total-games card');
assert(kept.some((s) => s.type === 'all'), 'the match-outcome family was caught by the handicap filter');
ok('handicap-line (a): only −3.5 reaches a card, and the rule stays inside the handicap family');

// On a slate where nobody has a qualifying −3.5 run the family is simply EMPTY —
// the ruling's own stated consequence, not a bug to be papered over with a fallback.
const thin = flatten({ players: [{ name: 'Y', streaks: [
  Object.assign({ type: 'handicap', line: 1.5, count: 6, cover: true }, live),
  Object.assign({ type: 'all', count: 6, direction: 'win' }, live),
] }] }).map((c) => c.streak);
assert.strictEqual(thin.filter((s) => s.type === 'handicap').length, 0,
  'ruling handicap-line (a): "family disappears on thin days" — a −1.5-only player shows no handicap card');
assert.strictEqual(thin.length, 1, 'the rest of that player\'s board must survive');
ok('handicap-line (a): a player with no −3.5 run shows no handicap card at all');

// ── the ENGINE half of item 5, executed ──────────────────────────────────────
// The clean-context review defeated an earlier version of this file by hard-coding
// `longest: 99` inside build-series.js and by breaking `occurrences` to a strict `>`:
// `npm test` stayed green and every card would have printed a fabricated number. The
// harness never loaded the engine at all. It does now — streakReference() is called for
// real, on fixtures, with no network and no API key.
const eng = require(path.join(ROOT, 'build-series.js'));
assert(typeof eng.streakReference === 'function', 'build-series.js no longer exports streakReference');

// A minimal record the `all` builder's condition understands: won/lost on a date.
const rec = (date, won) => ({ date, won, surface: 'hard', bestOf: 3 });
// An `all`-competitions WIN streak whose emitted run is the tail. matches[] is what the
// self-check compares against, so it must be the real tail.
const mkAll = (dates, tail) => ({
  type: 'all', family: 'all', direction: 'win', count: tail.length,
  matches: tail.map((d) => ({ date: d })),
});
// history: W W W  L  W W W W W  L  W W   → runs of 3, 5, 2; current run = 2
const H = [
  rec('2024-01-01', true), rec('2024-01-08', true), rec('2024-01-15', true),
  rec('2024-02-01', false),
  rec('2024-02-08', true), rec('2024-02-15', true), rec('2024-02-22', true),
  rec('2024-03-01', true), rec('2024-03-08', true),
  rec('2024-03-15', false),
  rec('2024-03-22', true), rec('2024-03-29', true),
];
const r1 = eng.streakReference(mkAll(H, ['2024-03-22', '2024-03-29']), H);
assert(r1, 'the engine refused a reference for a well-formed run');
assert.strictEqual(r1.longest, 5, 'longest must be the longest run in the window, got ' + r1.longest);
assert.strictEqual(r1.occurrences, 3, 'occurrences must count every run reaching the CURRENT length (2): 3, 5 and 2 all do — got ' + r1.occurrences);
assert.strictEqual(r1.runs, 3);
ok('the engine computes longest and occurrences from real history, executed not asserted');

// The current run is itself counted — "4th time at 6+" includes this time. A strict `>`
// here is the off-by-one the review demonstrated, and it makes every card understate.
const r2 = eng.streakReference(mkAll(H, ['2024-03-22', '2024-03-29']), H);
assert.strictEqual(r2.occurrences, 3, 'the current run must be included in its own occurrence count');
// …and a run at the window's best is the 1st time at that length — ruling reference-lone.
const H2 = [rec('2024-01-01', false), rec('2024-01-08', true), rec('2024-01-15', true), rec('2024-01-22', true)];
const r3 = eng.streakReference(mkAll(H2, ['2024-01-08', '2024-01-15', '2024-01-22']), H2);
assert.deepStrictEqual([r3.longest, r3.occurrences], [3, 1],
  'a run that is the window\'s best must read "1st time at N+" — got ' + JSON.stringify(r3));
ok('the current run counts toward its own occurrences, and a window-best reads 1st');

// longest can never be SMALLER than the run it sits under — that would put a card in
// contradiction with its own title.
for (const t of [['2024-03-22', '2024-03-29'], ['2024-02-08', '2024-02-15', '2024-02-22', '2024-03-01', '2024-03-08']]) {
  const st = mkAll(H, t);
  const r = eng.streakReference(st, H);
  if (r) assert(r.longest >= st.count, 'longest < count would contradict the card title');
}
ok('longest is never smaller than the run it describes');

// The self-check is the guarantee behind "never a guess": an emitted run that the
// enumeration cannot reproduce must yield NO reference, so the card dashes.
assert.strictEqual(eng.streakReference(mkAll(H, ['2024-03-22', '2024-06-01']), H), null,
  'a run whose member dates do not match the enumeration must yield no reference');
assert.strictEqual(eng.streakReference(mkAll(H, ['2024-01-01', '2024-01-08', '2024-01-15']), H), null,
  'a run that is not the TAIL must yield no reference — it is not the streak on the card');
assert.strictEqual(eng.streakReference(mkAll(H, ['2024-03-29']), []), null, 'an empty history yields no reference');
ok('the self-check refuses a reference it cannot reproduce, rather than guessing');

// RULING `ref-gapcut` (a), founder 2026-09-12, gate 1521c810: "the reference must be
// measured exactly the way the run on the card is". So the layoff cut (MAX_GAP_DAYS)
// applies to HISTORICAL runs exactly as mkStreak applies it to the current one.
// Rejected: (b) no cut for the reference, (c) no cut for SURFACE runs only.
const GAP = eng.MAX_GAP_DAYS;
const far = new Date(Date.parse('2024-01-15T00:00:00Z') + (GAP + 10) * 86400000).toISOString().slice(0, 10);
const H3 = [rec('2024-01-01', true), rec('2024-01-08', true), rec('2024-01-15', true), rec(far, true)];
const r4 = eng.streakReference(mkAll(H3, [far]), H3);
assert.strictEqual(r4.longest, 3, 'a layoff longer than MAX_GAP_DAYS must split a HISTORICAL run too, got ' + JSON.stringify(r4));
assert.strictEqual(r4.occurrences, 2, 'both segments reach the current length of 1');
ok('ruling ref-gapcut (a): the historical layoff cut is the engine\'s own MAX_GAP_DAYS');

// …and it applies to SURFACE runs too, which is what option (c) would have exempted and
// the ruling did not. This is the P. Martinez shape exactly: a clay run split by the
// CLAY-SEASON boundary rather than by an absence — he plays hard courts in between, and
// those records are outside the condition's domain, so they neither extend nor break it.
const recS = (date, won, surface) => ({ date, won, surface, bestOf: 3 });
const mkSurf = (tail) => ({
  type: 'surface', family: 'surface', subtype: 'clay', direction: 'win',
  count: tail.length, matches: tail.map((d) => ({ date: d })),
});
const H4 = [
  recS('2024-04-01', true, 'clay'), recS('2024-04-15', true, 'clay'), recS('2024-05-01', true, 'clay'),
  recS('2024-07-01', true, 'hard'), recS('2024-08-01', false, 'hard'),   // out of domain entirely
  recS('2025-04-01', true, 'clay'), recS('2025-04-15', true, 'clay'),
];
const r5 = eng.streakReference(mkSurf(['2025-04-01', '2025-04-15']), H4);
assert(r5, 'exempting SURFACE runs from the cut is ruling (c), which was rejected — the ' +
  'merged run then fails the self-check and the card dashes instead of reading its clay best');
assert.strictEqual(r5.longest, 3, 'the off-season must split a clay run: longest is 3, not 5 — got ' + JSON.stringify(r5));
assert.strictEqual(r5.occurrences, 2, 'both clay segments reach the current length of 2');
ok('ruling ref-gapcut (a): the cut applies to SURFACE runs too — (c) exempted them, and lost');

// ── the artifact's record of the handicap rule cannot drift from the renderer ──
// series.js owns HANDICAP_DISPLAY_LINE as a literal ON PURPOSE (item 9 was silently
// reverted for a deploy because the page adopted a value from the artifact). The
// artifact still RECORDS the rule, so the two must agree or series.json describes a
// page that no longer exists.
const engSrc = fs.readFileSync(path.join(ROOT, 'build-series.js'), 'utf8');
const recorded = /handicapDisplayLine:\s*([\d.]+)/.exec(engSrc);
const rendered = /var HANDICAP_DISPLAY_LINE = ([\d.]+);/.exec(src);
assert(recorded && rendered, 'the handicap display line is no longer stated in both files');
assert.strictEqual(Number(recorded[1]), Number(rendered[1]),
  `series.json records handicapDisplayLine=${recorded[1]} but series.js renders ${rendered[1]}`);
ok('the artifact\'s handicapDisplayLine matches the line the renderer actually enforces');

console.log('series item 2 + item 5 ruling lock — ' + checks.length + ' checks pass:');
checks.forEach((c) => console.log('  ✓ ' + c));
