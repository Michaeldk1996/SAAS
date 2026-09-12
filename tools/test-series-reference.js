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
//   reference-label  (a) — the sub-line NAMES the window ("longest since 2021 9"),
//     never "career": the pool is five calendar years AND tier-scoped, so "career"
//     would be a false claim. The year comes from the ARTIFACT, never the clock.
//   reference-lone   (a) — a run that is the only one ever to reach its own length
//     prints as-is: "longest 9 · 1st time at 9+".
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

// ── lift 1 · the reference sub-line block (item 5) ───────────────────────────
// series.js is a browser IIFE with no exports, so evaluate exactly those bytes.
function liftRef(source) {
  const start = source.indexOf('  function ordinal(n) {');
  const endMarker = '\n  // Effective card FAMILY';
  const end = source.indexOf(endMarker);
  assert(start > 0 && end > start, 'series.js reference block not found — markers moved?');
  const block = source.slice(start, end);
  assert(/function referenceHtml\(/.test(block) && /function referenceSinceYear\(/.test(block),
    'reference block no longer contains referenceHtml/referenceSinceYear');
  // eslint-disable-next-line no-new-func
  return new Function('_data', 'esc',
    block + '\n return { referenceHtml: referenceHtml, ordinal: ordinal };');
}
const ARTIFACT = { rules: { referenceWindow: { sinceYear: 2021, years: 5, scope: 'in-tier' } } };
const refApi = (data) => liftRef(src)(data === undefined ? ARTIFACT : data, esc);
const { referenceHtml, ordinal } = refApi();

// ── reference-label (a): the window is NAMED, and named from the artifact ────
const zverev = referenceHtml({ count: 6, reference: { longest: 15, occurrences: 12 } });
assert(/longest since 2021 15/.test(zverev),
  'ruling reference-label (a): the sub-line must name the window. Painted: ' + zverev);
assert(/12th time at 6\+/.test(zverev), 'the occurrence half is wrong. Painted: ' + zverev);
assert(!/career/i.test(zverev),
  'ruling reference-label (a) REVERTED: "career" is back. Option (d) "career longest is close ' +
  'enough" was rejected 2026-09-12 — the window is 5 years AND tier-scoped, so it is nobody\'s career.');
ok('reference-label (a): the sub-line names the window and never says "career"');

// The year is the ARTIFACT's, not this machine's clock and not a constant. A different
// artifact must move the label; that is what makes it a record rather than a guess.
const shifted = refApi({ rules: { referenceWindow: { sinceYear: 2019 } } }).referenceHtml(
  { count: 6, reference: { longest: 15, occurrences: 12 } });
assert(/longest since 2019 15/.test(shifted),
  'the window year is hard-coded — it must be read from rules.referenceWindow.sinceYear. Painted: ' + shifted);
ok('the window year is read from the artifact, never from the clock or a literal');

// ── reference-lone (a): a first-ever run at this length prints as-is ─────────
const simakin = referenceHtml({ count: 9, reference: { longest: 9, occurrences: 1 } });
assert(/longest since 2021 9 · 1st time at 9\+/.test(simakin),
  'ruling reference-lone (a): a lone run must print in full — "longest 9 · 1st time at 9+". ' +
  'Options (b) "his best run" and (c) "first component only" were rejected. Painted: ' + simakin);
ok('reference-lone (a): the only-ever run at this length prints "1st time at N+" in full');

// ── item 5: both components required, else a dash — never half a sub-line ────
const halves = [
  ['no reference at all (a pre-item-5 artifact)', { count: 6 }],
  ['reference present but longest missing', { count: 6, reference: { occurrences: 3 } }],
  ['reference present but occurrences missing', { count: 6, reference: { longest: 9 } }],
  ['longest is zero', { count: 6, reference: { longest: 0, occurrences: 3 } }],
  ['occurrences is zero', { count: 6, reference: { longest: 9, occurrences: 0 } }],
  ['a non-integer sneaks in', { count: 6, reference: { longest: 9.5, occurrences: 3 } }],
  ['null, which isFinite() would not catch on its own', { count: 6, reference: { longest: null, occurrences: 3 } }],
];
halves.forEach(([why, st]) => {
  const out = referenceHtml(st);
  assert(/class="sr-ref sr-ref--none"/.test(out) && />—</.test(out),
    'item 5: ' + why + ' must dash the WHOLE sub-line. Painted: ' + out);
  assert(!/longest|time at/.test(out), 'item 5: half a sub-line shipped for ' + why + '. Painted: ' + out);
});
ok('item 5: a missing half dashes the whole sub-line, never shows the other half');

// An unnameable window is the same case: ruling (a) is to NAME the window, so a
// reference we cannot label is a reference we cannot print. Never "longest since —".
[{}, { rules: {} }, { rules: { referenceWindow: {} } }, { rules: { referenceWindow: { sinceYear: '2021' } } }]
  .forEach((data) => {
    const out = refApi(data).referenceHtml({ count: 6, reference: { longest: 9, occurrences: 3 } });
    assert(/sr-ref--none/.test(out) && !/longest/.test(out),
      'an artifact with no usable window year must dash, not print an unlabelled or half label. Painted: ' + out);
  });
ok('an artifact that cannot name its window dashes rather than labelling it wrongly');

// ── the ordinal itself, including the teens the naive rule gets wrong ────────
[[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [11, '11th'], [12, '12th'], [13, '13th'],
 [21, '21st'], [22, '22nd'], [23, '23rd'], [101, '101st'], [111, '111th'], [112, '112th']]
  .forEach(([n, want]) => assert.strictEqual(ordinal(n), want, 'ordinal(' + n + ')'));
ok('the ordinal is correct through the 11–13 teens and the 101/111 wrap');

// ── handicap-bestof (a): the CARD drops it, the MODAL keeps it ───────────────
// Executes the shipped claim builders rather than reading them.
function liftClaim(source) {
  const start = source.indexOf('  var ARCH_LABEL = {};');
  const end = source.indexOf('  function describe(st)');
  assert(start > 0 && end > start, 'series.js claim block not found — markers moved?');
  const block = source.slice(start, end);
  assert(/function claimOf\(/.test(block) && /function claimLong\(/.test(block), 'lifted the wrong block');
  // eslint-disable-next-line no-new-func
  return new Function('esc', 'cap',
    block + '\n return { claimOf: claimOf, claimLong: claimLong };')(esc, (s) => String(s));
}
const { claimOf, claimLong } = liftClaim(src);
const hcap = { type: 'handicap', cover: true, line: 3.5, bestOf: 5, direction: 'win' };
assert.strictEqual(claimOf(hcap), 'Covered −3.5 games',
  'ruling handicap-bestof (a): the card must read "Covered −3.5 games" with no format qualifier');
assert(!/best-of/.test(claimOf(hcap)), 'the card kept "(best-of-N)" — ruling handicap-bestof (a) rejected option (b)');
assert(!/best-of/.test(claimOf({ type: 'handicap', cover: false, line: 3.5, bestOf: 3, direction: 'loss' })),
  'the losing side of the handicap family still prints the format qualifier');
assert.strictEqual(claimLong(hcap), 'Covered −3.5 games (best-of-5)',
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
  const end = source.indexOf('  function passesFilters(c)');
  assert(start > 0 && end > start, 'series.js flatten block not found — markers moved?');
  const block = source.slice(start, end);
  assert(/function flatten\(data\)/.test(block) && /suppressOutcomeDuplicates/.test(block), 'lifted the wrong block');
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

// ── the sub-line's shipped styling, item 5's own spec ────────────────────────
// "Mono, #5b6880, same size as the STARTED / LAST values" — .sr-cell-v is 14px.
const refCss = css.slice(css.indexOf('[data-page="series"] .sr-ref {'));
assert(refCss.indexOf('[data-page="series"] .sr-ref {') === 0, '.sr-ref has no scoped rule — it will inherit card type');
const refRule = refCss.slice(0, refCss.indexOf('}') + 1);
assert(/IBM Plex Mono/.test(refRule), 'item 5: the sub-line must be mono');
assert(/font-size: 14px/.test(refRule), 'item 5: the sub-line must match the STARTED/LAST value size (14px)');
assert(/color: #5b6880/.test(refRule), 'item 5: the sub-line colour must be #5b6880');
const cellV = css.slice(css.indexOf('[data-page="series"] .sr-cell-v {'));
assert(/font-size: 14px/.test(cellV.slice(0, cellV.indexOf('}'))),
  'the STARTED/LAST value size moved — the sub-line no longer matches it');
assert(/\[data-page="series"\] \.sr-ref--none \{[^}]*color: #4b5672/.test(css),
  'item 5: the unavailable state must be #4b5672');
// The sub-line must WRAP, never elide. Measured at 320-360px: a nowrap sub-line makes
// the card's min-content 370px inside a 288px grid track, so the card breaks out of its
// column; the alternative escape (min-width:0) trades that for an ellipsis, i.e. a
// truncated reference — the corrupted-value failure the year-bearing date strip was
// relaxed to avoid. Both regressions reintroduce themselves through this one property.
assert(!/white-space:\s*nowrap/.test(refRule),
  'the sub-line is nowrap again — at 320px it pushes the card past its grid track');
assert(/white-space:\s*normal/.test(refRule), 'the sub-line must be allowed to wrap');
assert(!/text-overflow:\s*ellipsis/.test(refRule),
  'an ellipsis on the sub-line would print a TRUNCATED reference — never a partial value');
ok('the sub-line ships mono / 14px / #5b6880, with the dash state at #4b5672');

// …and nothing later in the file may quietly outrank those three declarations. The
// review's point: a `[data-page="series"] .sr-card .sr-ref { font-size: 9px }` added
// below would satisfy every assertion above while shipping the wrong type. So the FULL
// set of rules mentioning .sr-ref is pinned, not just the first one. (The browser probe
// measures getComputedStyle and is the real instrument — this is the offline guard.)
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
const refSelectors = (cssCode.match(/[^{}();]*\.sr-ref[^{}]*\{/g) || []).map((s) => s.replace(/\s*\{$/, '').trim());
assert.deepStrictEqual(refSelectors.sort(), [
  '[data-page="series"] .sr-ref',
  '[data-page="series"] .sr-ref--none',
].sort(), 'a new rule targets .sr-ref — it may outrank the item-5 type spec: ' + JSON.stringify(refSelectors));
ok('no later CSS rule can outrank the sub-line\'s ruled type, size or colour');

// ── it is actually ON the card, in the ruled position — by EXECUTING cardHtml ──
// The previous version of this block matched `var refLine = referenceHtml(st);` and the
// assembly expression as TEXT. The clean-context review defeated it in one line —
// appending `refLine = '';` after the assignment left item 5 rendering nothing anywhere
// while the harness still printed a tick. cardHtml is now run for real and the markup it
// returns is what gets asserted. A helper nothing calls is the exact shape of the
// undelivered item this project has shipped before.
function liftCard(source) {
  const start = source.indexOf('  function cardHtml(c, idx) {');
  const end = source.indexOf('  // ─── header card');
  assert(start > 0 && end > start, 'series.js cardHtml block not found — markers moved?');
  const block = source.slice(start, end);
  assert(/referenceHtml\(/.test(block), 'lifted the wrong block');
  // eslint-disable-next-line no-new-func
  return new Function('esc', 'cap', 'avatarHtml', 'claimOf', 'runLabel', 'valence', 'DIR_LABEL',
    'startedOf', 'fmtShort', 'crossesYear', 'priorYear', 'fmtTime', 'famOf', 'FAM_BADGE', 'referenceHtml', '_data',
    block + '\n return cardHtml;');
}
const mkCard = (refHtmlFn) => liftCard(src)(
  esc, (s) => String(s), () => '<span class="sr-av-wrap"></span>', () => 'Won', (n) => n + ' in a row',
  () => 'win', { win: 'Winning run' }, (st) => st.lastDate, (d) => d, () => false, () => false,
  (t) => t, () => 'all', { all: 'All comps' }, refHtmlFn, ARTIFACT);
const CARD_ST = { type: 'all', direction: 'win', count: 6, lastDate: '2026-09-12',
  matches: [{ date: '2026-09-01' }], reference: { longest: 9, occurrences: 4 } };
const CARD_C = { player: { name: 'X', rank: 5, upcoming: { day: 'today', time: '11:00', opponentName: 'Y' } }, streak: CARD_ST };
const html = mkCard(referenceHtml)(CARD_C, 0);
assert(/longest since 2021 9 · 4th time at 6\+/.test(html),
  'item 5: cardHtml does not put the sub-line on the card. Painted: ' + html.slice(0, 400));
// …and in the ruled POSITION: after the title block, before the player row.
const iTop = html.indexOf('sr-cardtop'), iRef = html.indexOf('sr-ref'), iProw = html.indexOf('sr-prow');
assert(iTop >= 0 && iRef > iTop && iProw > iRef,
  `item 5: the sub-line must sit between the title and the player row — got cardtop@${iTop} ref@${iRef} prow@${iProw}`);
// Nothing may sit between them.
const between = html.slice(html.indexOf('</div>', html.indexOf('sr-tag-dir')) + 6, iProw - '<div class="'.length);
assert(!/<(div|span|article)/.test(between.replace(/<div class="sr-ref[^]*?<\/div>/, '')),
  'something was inserted between the title and the sub-line, or between the sub-line and the player row: ' + between);
ok('cardHtml really paints the sub-line, between the title and the player row');

// The dash state reaches the card too — not just the helper in isolation.
const dashHtml = mkCard(referenceHtml)({ player: CARD_C.player, streak: Object.assign({}, CARD_ST, { reference: undefined }) }, 0);
assert(/class="sr-ref sr-ref--none">—</.test(dashHtml), 'a reference-less streak must paint the dashed sub-line on the CARD');
assert(!/longest|time at/.test(dashHtml), 'half a sub-line reached the card');
ok('a reference-less streak paints the dash on the card itself');

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

// The layoff cut (MAX_GAP_DAYS) applies to historical runs, exactly as mkStreak applies
// it to the current one. This is the behaviour flagged to the founder on ask-gate
// `ref-gapcut` — locked here as SHIPPED so a change to it is a deliberate act.
const GAP = eng.MAX_GAP_DAYS;
const far = new Date(Date.parse('2024-01-15T00:00:00Z') + (GAP + 10) * 86400000).toISOString().slice(0, 10);
const H3 = [rec('2024-01-01', true), rec('2024-01-08', true), rec('2024-01-15', true), rec(far, true)];
const r4 = eng.streakReference(mkAll(H3, [far]), H3);
assert.strictEqual(r4.longest, 3, 'a layoff longer than MAX_GAP_DAYS must split a HISTORICAL run too, got ' + JSON.stringify(r4));
assert.strictEqual(r4.occurrences, 2, 'both segments reach the current length of 1');
ok('the historical layoff cut is the engine\'s own MAX_GAP_DAYS, and is locked as shipped');

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
