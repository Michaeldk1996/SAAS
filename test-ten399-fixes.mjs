// TEN-399 founder fixes (card ff586600, 2026-10-08) that live in source text:
//   1  the "Choose a tournament" prompt does not promise a per-book split (it is Player-only);
//   6  the Ratings board tabs sit in the card header, right of the title (not under the count);
//   7  band names on Tour + Tournament: Heavy / Firm / Narrow favourite · Narrow / Mid underdog · Long shot.
// Each check runs against a mutant that must turn it red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('./bsp-consult-dashboard.html', import.meta.url), 'utf8');
const between = (s, a, b) => { const i = s.indexOf(a); if (i < 0) return null; const j = s.indexOf(b, i); return j < 0 ? null : s.slice(i, j); };
const CHECKS = {
  prompt(src) {
    const m = /<h3>Choose a tournament<\/h3><p>([^<]*)<\/p>/.exec(src);
    if (!m) return 'no Choose a tournament prompt';
    if (/per-book split|split by book/i.test(m[1])) return 'prompt still promises the per-book split';
    return null;
  },
  bandNames(src) {
    const f = /var FAV_NAMES=(\[[^\]]*\]);/.exec(src), d = /var DOG_NAMES=(\[[^\]]*\]);/.exec(src);
    if (!f || !d) return 'band name arrays not found';
    const fav = JSON.parse(f[1].replace(/'/g, '"')), dog = JSON.parse(d[1].replace(/'/g, '"'));
    if (fav.join('|') !== 'Heavy favourite|Firm favourite|Narrow favourite') return 'favourite bands ' + fav.join('|');
    if (dog.join('|') !== 'Narrow underdog|Mid underdog|Long shot') return 'underdog bands ' + dog.join('|');
    return null;
  },
  ratingsHeader(src) {
    const body = between(src, '  function renderRatings', '\n  function ');
    if (!body) return 'renderRatings not found';
    const head = /var rhead=el\('div','db-rcardhead'\)[^\n]*\n\s*rhead\.appendChild\(rtl\); rhead\.appendChild\(ratBoardTabs\(\)\); card\.appendChild\(rhead\);/.test(body);
    if (!head) return 'board tabs are not in the card header';
    if ((body.match(/ratBoardTabs\(\)/g) || []).length !== 1) return 'board tabs painted more than once';
    if (!/rtl\.appendChild\(el\('h2','db-rtitle'/.test(body)) return 'title is not in the header block';
    return null;
  },
};
const MUTANTS = [
  ['prompt promises the split', 'prompt', s => s.replace('and underdog yields by price band and the cumulative', 'and underdog yields by price band, the per-book split, and the cumulative')],
  ['old band names', 'bandNames', s => s.replace("var FAV_NAMES=['Heavy favourite','Firm favourite','Narrow favourite'];", "var FAV_NAMES=['Super Fav','Mid Fav','Slight Fav'];")],
  ['tabs back under the count', 'ratingsHeader', s => s.replace("rhead.appendChild(rtl); rhead.appendChild(ratBoardTabs()); card.appendChild(rhead);", "rhead.appendChild(rtl); card.appendChild(rhead); card.appendChild(ratBoardTabs());")],
];
for (const [n, fn] of Object.entries(CHECKS)) test('TEN-399 fix · ' + n, () => assert.equal(fn(SRC), null));
test('CONTROL: every TEN-399 fix mutant is caught', () => {
  const survived = [];
  for (const [name, key, mut] of MUTANTS) { const m = mut(SRC); if (m === SRC) { survived.push(name + ' (did not apply)'); continue; } if (CHECKS[key](m) === null) survived.push(name); }
  assert.deepEqual(survived, []);
});
