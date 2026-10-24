// hotlines-mtb-and-loader · Fix 1 (founder brief 2026-10-24). Hot lines must not read a match-tiebreak decider's points
// as games: a best-of-3 decided 10-8 in a match tiebreak (stored as a third "set") is out of every games-based Hot line —
// total games, games handicap, Tiebreak in match — exactly as Derived lines excludes it (player-profile-v2.js
// lineFormatOf 'mtb', the ONE predicate both read). Set-based lines (set handicap, deciding set, wins set 1) keep it.
// Drives the page's REAL functions sliced out of bsp-consult-dashboard.html and the REAL player-profile-v2.js.
// Mutations that turn it red (each named at its assertion):
//   M1  delete the fhEligible line `if (def.need === 'games' && fhMtbOf(r) !== false) return false;`
//   M2  fhMtbOf compares lineFormatOf(...) to anything but 'mtb' (e.g. 'nextgen')
//   M3  fhMtbOf returns false (instead of null) when player-profile-v2.js is not loaded (fail open)
//   M4  the exclusion widened to every line (drop `def.need === 'games' &&`): set-based lines lose the match
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.HLMTB_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
function slice(name) {
  const start = html.indexOf(`\nfunction ${name}(`);
  if (start < 0 && name === 'fhMtbOf') return 'const fhMtbOf = () => { throw new Error("fhMtbOf absent (pre-fix page)"); };';
  assert.ok(start > 0, `${name} not found`);
  let d = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; }
  return html.slice(start, i + 1);
}
function constSrc(name) {
  const start = html.indexOf(`\nconst ${name} = `);
  assert.ok(start > 0, `const ${name} not found`);
  const eol = html.indexOf('\n', start + 1), line = html.slice(start, eol);
  if (/;\s*(\/\/.*)?$/.test(line)) return line;                       // one line (a trailing comment allowed)
  return html.slice(start, html.indexOf(';\n', start) + 1);
}
function loadPP2() {
  const sb = { FEATURE_PP2: true, playerProfiles: { players: {} }, matches: [], addEventListener() {},
    document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] } };
  const prev = globalThis.window; globalThis.window = sb;
  try { new Function('window', readFileSync(join(HERE, 'player-profile-v2.js'), 'utf8'))(sb); } finally { globalThis.window = prev; }
  assert.equal(typeof sb.PlayerProfileV2._internals.lineFormatOf, 'function', 'player-profile-v2.js exposes lineFormatOf');
  return sb.PlayerProfileV2;
}
const PP2 = loadPP2();
const FNS = ['psNormTour', 'fhSetDone', 'fhBestOf', 'fhFinishRow', 'fhMtbOf', 'fhIneligibleWhy', 'fhEligible', 'fhScoreLines', 'fhHotLineRank', 'fhFamOf',
  'fhFormLineDefs', 'fhH2hLineDefs'];
const build = win => new Function('window', `
  ${constSrc('FH_SLAMS')}
  ${constSrc('FH_HOT_MIN_ELIGIBLE')}
  ${constSrc('FH_H2H_SET1_MIRROR')}
  ${FNS.map(slice).join('\n')}
  return { fhFinishRow, fhEligible, fhIneligibleWhy, fhScoreLines, fhFormLineDefs, fhH2hLineDefs, fhMtbOf };
`)(win);
const S = build({ PlayerProfileV2: PP2 });

let n = 0;
const mk = (sets, extra) => S.fhFinishRow(Object.assign({ mid: 'm' + (n++), won: true, sets, ret: false, wo: false, tourn: 'Umag', tournRaw: 'Umag', tier: 'atp',
  result: sets.filter(s => s[0] > s[1]).length + ' - ' + sets.filter(s => s[1] > s[0]).length }, extra || {}));
// A best-of-3 decided 10-8 in a match tiebreak, stored as a third set.
const MTB = () => mk([[6, 4, null], [3, 6, null], [10, 8, null]]);
const STD = () => [mk([[6, 4, null], [6, 4, null]]), mk([[6, 4, null], [3, 6, null], [6, 3, null]]), mk([[7, 6, 3], [6, 4, null]])];

test('the shared predicate: a 10-8 decider is a match tiebreak; a 6-3 decider and a Slam-style 12-10 final set are not', () => {
  assert.equal(S.fhMtbOf(MTB()), true, 'M2: the 10-8 decider must read as Derived lines reads it');
  assert.equal(S.fhMtbOf(mk([[6, 4, null], [3, 6, null], [6, 3, null]])), false);
  assert.equal(S.fhMtbOf(mk([[6, 4, null], [3, 6, null], [12, 10, null]], { tournRaw: 'Wimbledon - Qualification', tourn: 'Wimbledon' })), false,
    'an advantage final set at a Slam is a set (Derived lines\' rule, not a second one)');
  const r = MTB();
  assert.equal(S.fhMtbOf(r) === true, PP2._internals.lineFormatOf({ sets: r.result, setGames: r.sets.map(x => ({ p: x[0], o: x[1] })), tournament: 'Umag' },
    PP2._internals.lineSetCount({ sets: r.result, setGames: r.sets.map(x => ({ p: x[0], o: x[1] })) })) === 'mtb', 'one rule with Derived lines');
});

test('games-based Hot lines exclude a match decided by a match tiebreak (Form and H2H defs)', () => {
  const rows = [...STD(), MTB()];
  for (const defs of [S.fhFormLineDefs('Tester'), S.fhH2hLineDefs('Tester', 'Other')]) {
    const sc = S.fhScoreLines(rows, defs);
    const line = name => sc.scored.find(x => x.name === name);
    // Pre-fix the 10-8 decider adds 18 "games": 6+3+10 / 4+6+8 = 37 total → Over 22.5 / 24.5 "covered", n = 4.
    assert.equal(line('Over 22.5 games').n, 3, 'M1: the match-tiebreak match must not be eligible for a totals line');
    assert.equal(line('Over 22.5 games').c, 2, 'M1: 6-4 3-6 6-3 (28 games) and 7-6 6-4 (23) cover Over 22.5; the MTB match (37 "games") is not counted');
    assert.equal(line('Tiebreak in match').n, 3, 'M1: Tiebreak in match is a games line (need: games) — the MTB match is out');
    const hc = line('Tester +3.5 games');
    assert.equal(hc.n, 3, 'M1: games handicap excludes it too');
    const mtbRow = rows[3];
    const totDef = defs.find(d => d.name === 'Over 22.5 games');
    assert.equal(S.fhIneligibleWhy(mtbRow, totDef), 'match tiebreak', 'the dot tooltip says why');
  }
});

test('set-based Hot lines keep the match-tiebreak match (unchanged; methodology call reported, not made)', () => {
  const rows = [...STD(), MTB()];
  const sc = S.fhScoreLines(rows, S.fhH2hLineDefs('Tester', 'Other'));
  const line = name => sc.scored.find(x => x.name === name);
  assert.equal(line('Match goes to a deciding set').n, 4, 'M4: deciding set still counts the MTB match');
  assert.equal(line('Match goes to a deciding set').c, 2);
  assert.equal(line('Tester wins set 1').n, 4, 'M4: wins set 1 still counts it');
  assert.equal(line('Tester −1.5 sets').n, 4, 'M4: set handicap still counts it');
});

test('fail closed: without player-profile-v2.js loaded, a games line counts nothing — never a match tiebreak\'s points', () => {
  const B = build({});
  const rows = [mk([[6, 4, null], [6, 4, null]]), MTB(), mk([[7, 6, 3], [6, 4, null]]), mk([[6, 2, null], [6, 1, null]])];
  const r = B.fhFinishRow(Object.assign({}, rows[1], { _mtb: undefined }));
  assert.equal(B.fhMtbOf(r), null, 'M3: the rule is unknown, not "no match tiebreak"');
  const def = B.fhH2hLineDefs('Tester', 'Other').find(d => d.name === 'Over 22.5 games');
  assert.equal(B.fhEligible(r, def), false, 'M3: unknown → not eligible');
  const set1 = B.fhH2hLineDefs('Tester', 'Other').find(d => d.name === 'Tester wins set 1');
  assert.equal(B.fhEligible(r, set1), true, 'set lines do not depend on the rule');
});
