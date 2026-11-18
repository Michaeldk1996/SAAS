// Founder review 2026-11-18 (Database Lines: "Field / Edge empty under As favourite, fix it"). The page's own
// db2LnCutTally (sliced out of the dashboard, the way build-lines-field.js slices the line rules) tallies one player's
// line results under every side / price band / archetype / level cut; tools/build-lines-field-cuts.mjs runs it over the
// roster in Chrome. This locks the tally on a fixture and runs the CONTROL mutants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../bsp-consult-dashboard.html', import.meta.url), 'utf8');
function fnSource(src, name) {
  const i = src.indexOf('  function ' + name + '(');
  if (i < 0) throw new Error('function ' + name + ' is gone');
  const open = src.indexOf('{', i); let d = 0;
  for (let k = open; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } }
  throw new Error('unbalanced ' + name);
}
function varSource(src, name) {
  const i = src.indexOf('  var ' + name);
  if (i < 0) throw new Error('var ' + name + ' is gone');
  const eq = src.indexOf('=', i); let k = eq + 1; while (src[k] === ' ') k++;
  const oc = src[k] === '{' ? ['{', '}'] : src[k] === '[' ? ['[', ']'] : null;
  if (!oc) return src.slice(i, src.indexOf(';', i) + 1);
  let d = 0;
  for (let j = k; j < src.length; j++) { if (src[j] === oc[0]) d++; else if (src[j] === oc[1]) { d--; if (!d) return src.slice(i, j + 1) + ';'; } }
  throw new Error('unbalanced ' + name);
}
// three bo3 matches: won 6-4 6-4 (a push on −4) as favourite at 1.40 (Clear favourite? no: 1.36-1.50 = Favourite, index 2) on hard,
// lost 4-6 3-6 as underdog at 2.20 (Slight underdog, index 1) on clay, won 7-6 6-4 with no price (unpriced) on hard
const ROWS = [
  { date: '2026-10-01', surface: 'Hard', sets: [{ p: 6, o: 4 }, { p: 6, o: 4 }], arch: 'Big Server', lvl: 'ATP 500', px: { p: 1.4, op: 3.0 } },
  { date: '2026-09-01', surface: 'Clay', sets: [{ p: 4, o: 6 }, { p: 3, o: 6 }], arch: 'Big Server', lvl: 'ATP 250', px: { p: 2.2, op: 1.7 } },
  { date: '2020-01-01', surface: 'Hard', sets: [{ p: 7, o: 6 }, { p: 6, o: 4 }], arch: null, lvl: null, px: null },
];
function tally(src) {
  const code = ['LN_LADDERS', 'LN_GROUPS', 'DB2_BANDS', 'DB2_LN_ARCH', 'DB2_LN_LEVELS'].map(v => varSource(src, v)).join('\n') + '\n' +
    ['db2InBand', 'lnCutoff', 'lnPartition', 'lnFormat', 'lnPools', 'lnHit', 'db2LnCutTally'].map(f => fnSource(src, f)).join('\n') +
    '\nreturn db2LnCutTally;';
  const px = new Map(ROWS.filter(r => r.px).map(r => [r, r.px]));
  const fn = new Function('LNF', 'db2LnPrice', 'db2LnArchOf', 'db2LnLevelOf', code)(
    { l52Cutoff: '2025-11-18' }, () => px, r => r.arch, r => r.lvl);
  return fn('X. Player', ROWS);
}
function check(src) {
  const T = tally(src);
  const line = (k, l) => (T[k] || {})[l];
  // −1.5 games: covered by the 6-3 6-4 win (margin 5), missed by the loss; the unpriced win is in no side cut
  if (JSON.stringify(line('bo3|All|career|fav|-', '−1.5 games')) !== '[1,1]') return 'favourite cut −1.5: ' + JSON.stringify(line('bo3|All|career|fav|-', '−1.5 games'));
  if (JSON.stringify(line('bo3|All|career|dog|-', '−1.5 games')) !== '[0,1]') return 'underdog cut −1.5: ' + JSON.stringify(line('bo3|All|career|dog|-', '−1.5 games'));
  if (!T['bo3|Hard|career|fav:2|-']) return 'no band cut for a favourite at 1.40 (Favourite, 1.36-1.50)';
  if (!T['bo3|Clay|l52|dog:1|a:0']) return 'no underdog band x archetype cut on clay, last 52 weeks';
  if (line('bo3|All|career|fav|-', '−4 games')) return 'a push on a whole line counts: ' + JSON.stringify(line('bo3|All|career|fav|-', '−4 games'));
  if (T['bo3|All|career|all|-']) return 'the base slice is re-tallied (lines-field.json owns it)';
  if (JSON.stringify(line('bo3|All|career|all|a:0', '−1.5 games')) !== '[1,2]') return 'archetype cut over both priced and unpriced: ' + JSON.stringify(line('bo3|All|career|all|a:0', '−1.5 games'));
  if (T['bo3|All|l52|fav|-'] && line('bo3|All|career|fav|-', '−1.5 games')[1] !== 1) return 'last 52 weeks leaks the 2020 match';
  return null;
}
const MUTANTS = [
  ['side flipped', s => s.replace("var sd=q.p<q.op?'fav':'dog';", "var sd=q.p>q.op?'fav':'dog';")],
  ['base slice tallied', s => s.replace("if(P==='all' && X==='-') return;", "")],
  ['no archetype cut', s => s.replace("if(ai>=0) Xs.push('a:'+ai);", "")],
  ['voids counted', s => s.replace("if(h && h.hit!==null) hits.push", "if(h) hits.push")],
];
test('Lines field cuts: the page tally', () => { assert.equal(check(SRC), null); });
test('CONTROL: every Lines field cut mutant is caught', () => {
  const survived = [];
  for (const [name, mut] of MUTANTS) {
    const m = mut(SRC); if (m === SRC) { survived.push(name + ' (did not apply)'); continue; }
    let r; try { r = check(m); } catch (e) { r = 'threw'; }
    if (r === null) survived.push(name);
  }
  assert.deepEqual(survived, []);
});
// the builder: a failed shard or a missing input fails the build, never a thinner field
test('build-lines-field-cuts fails closed', () => {
  const b = readFileSync(new URL('./build-lines-field-cuts.mjs', import.meta.url), 'utf8');
  assert.match(b, /if \(res\.failed\.length\) die\(/);
  assert.match(b, /surface-ratings\.json missing or empty/);
  assert.match(b, /retired-players\.json missing/);
  assert.match(b, /writeFileSync\(OUT \+ '\.tmp', body\); renameSync\(OUT \+ '\.tmp', OUT\);/);   // atomic write
});
