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
  // R2 item 1 (founder, post-live): the Lines coverage line names no excluded count.
  linesCoverage(src) {
    const body = between(src, '  function lnPaint', '\n  function ');
    if (!body) return 'lnPaint not found';
    if (/excluded as unfinished or a different format/.test(body)) return 'coverage line still says "excluded as unfinished or a different format"';
    if (!/'Field = the median rate on each line across tour players with at least '\+LN_MIN_N\+' matches on that line\.'/.test(body)) return 'Lines field sentence is not the founder wording';
    return null;
  },
  // R2 item 2: Ratings subtitle has no discount factor; the footnote is three short lines.
  ratingsCopy(src) {
    if (/discounted \\u00d70\.9|discounted ×0\.9/.test(src)) return 'Ratings subtitle still says "discounted ×0.9"';
    const m = /var ELO_CAVEAT='([^']*)';/.exec(src);
    if (!m || m[1].length > 110) return 'Elo note is not one short line: ' + (m && m[1]);
    if (!/esc\('n is the serve-stat match count\.'\)/.test(src)) return 'n note is not the one-line form';
    return null;
  },
  // R2 item 3: Ratings compare Career figures white, regular weight.
  careerWhite(src) {
    const m = /\.db-cmpcell\.ref\{([^}]*)\}/.exec(src);
    if (!m || !/color:var\(--text\)/.test(m[1]) || !/font-weight:400/.test(m[1])) return 'Career compare cells are not white 400: ' + (m && m[1]);
    return null;
  },
  // R2 (card 0122a989 "ship-rounded"): Lines Vs field = displayed Rate − displayed Field, so the screen adds up.
  vsFieldDisplayed(src) {
    const m = /var delta = \(rate!=null && F\) \? ([^;]*);/.exec(src);
    if (!m) return 'Lines delta line not found';
    if (!/rate\.toFixed\(1\)/.test(m[1]) || !/F\.median\.toFixed\(1\)/.test(m[1])) return 'Vs field is not computed from the displayed figures: ' + m[1];
    // behaviour: 57.836 vs 37.861 shows 57.8% / 37.9% and must print +19.9, not +20.0
    const f = new Function('rate', 'F', 'return (rate!=null && F) ? ' + m[1] + ';');
    const v = f(57.836, { median: 37.861 });
    if (Math.abs(v - 19.9) > 1e-9) return 'Alcaraz case gives ' + v + ', want 19.9';
    return null;
  },
};
const MUTANTS = [
  ['Vs field from unrounded figures', 'vsFieldDisplayed', s => s.replace(/var delta = \(rate!=null && F\) \? [^;]*;/, 'var delta = (rate!=null && F) ? rate - F.median : null;')],
  ['excluded clause back', 'linesCoverage', s => s.replace("        (part.noGames ? ' · ' + part.noGames", "        (part.excluded ? ' · ' + part.excluded + ' excluded as unfinished or a different format' : '') +\n        (part.noGames ? ' · ' + part.noGames")],
  ['discount back in the subtitle', 'ratingsCopy', s => s.replace('with Challenger matches added for players thin at tour level.', 'with Challenger matches folded in (discounted \\u00d70.9) for players thin at tour level.')],
  ['Career grey again', 'careerWhite', s => s.replace('.db-cmpcell.ref{ font-size:16px; font-weight:400; color:var(--text); }', '.db-cmpcell.ref{ font-size:16px; font-weight:400; color:var(--db-sec); }')],
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
