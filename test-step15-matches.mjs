// Step 15 — Today's Matches: sorts, sort hash, Market read, Upsets, Bets today, Streak on court (founder 2026-10-27,
// design_handoff_todays_matches_v2 README §1–§3). The functions are SLICED out of the shipped HTML and EXECUTED.
//
// Run: node --test test-step15-matches.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');

function slice(name, src = html) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}
const MOVE_MIN = /const MX_MOVE_MIN = [\d.]+;/.exec(html)[0];

// ── §3 sort keys + the comparator the board runs ──
function sortApi(src = html) {
  const body = slice('getFiltered', src);
  const a = body.indexOf("  else if (state.sort === 'upset' || state.sort === 'move'"), b = body.indexOf("  else if (state.sort === 'closing')");
  assert.ok(a > 0 && b > a, 'sort branch not found');
  return (list, sort) => new Function('out', 'state', `
    const _mcNowPair = m => m.__now || null, cardStartMs = m => m.__t;
    const _openDerivedOf = (m, w) => (m.__o ? m.__o[w] : null), _mcCardCloseOf = (m, w) => (m.__c ? m.__c[w] : null);
    const _mcCardCloseDerivedOf = (m, w) => (m.__c && m.__w60 !== false ? m.__c[w] : null);
    const _mcPinClose = m => m.__pin || null, mxPinCloseAgeMin = () => 10;
    ${MOVE_MIN} ${slice('mxMovePct', src)} ${slice('mxPinCloseW60', src)} ${slice('mxUpsetOf', src)} ${slice('mxJourney', src)} ${slice('mxJourneyOf', src)}
    ${slice('mxTightSortKey', src)} ${slice('mxShortSortKey', src)} ${slice('mxMoveSortKey', src)} ${slice('mxUpsetSortKey', src)} ${slice('mxWrongSortKey', src)}
    if (false) {}
    ${body.slice(a, b)}
    return out.map(m => m.id);`)(list.slice(), { sort });
}
const up = (id, t, a, b) => ({ id, __t: t, time: String(t), __now: a == null ? null : { p1: a, p2: b } });

test('Upcoming: Tightest = smallest |A − B| first; Shortest price = lowest min(A, B) first; unpriced last, in time order', () => {
  const run = sortApi();
  const board = [up('u1', 1, 1.2, 4.5), up('none1', 2), up('u2', 3, 1.9, 1.95), up('u3', 4, 1.5, 2.6), up('none0', 0)];
  assert.deepEqual(run(board, 'tight'), ['u2', 'u3', 'u1', 'none0', 'none1']);
  assert.deepEqual(run(board, 'short'), ['u1', 'u3', 'u2', 'none0', 'none1']);
  // MUTANT: unpriced treated as 0 → they jump to the top of an ascending sort
  const mut = html.replace("function mxTightSortKey(m){ const p = _mcNowPair(m); return p && p.p1 > 0 && p.p2 > 0 ? Math.abs(p.p1 - p.p2) : null; }",
                           "function mxTightSortKey(m){ const p = _mcNowPair(m); return p && p.p1 > 0 && p.p2 > 0 ? Math.abs(p.p1 - p.p2) : 0; }");
  assert.notEqual(mut, html);
  assert.notDeepEqual(sortApi(mut)(board, 'tight'), run(board, 'tight'));
});

const done = (id, t, w, o, c, pin, w60) => ({ id, __t: t, time: String(t), finalScore: { winner: w }, __o: o, __c: c, __pin: pin, __w60: w60 });
test('Completed: Biggest upset = upsets at the Pinnacle close first (winner close desc), then the rest; Market got it wrong; Biggest move', () => {
  const run = sortApi();
  const L = [
    done('favWon', 1, 'p1', { p1: 1.5, p2: 2.6 }, { p1: 1.4, p2: 2.9 }, { p1: 1.4, p2: 2.9 }),
    done('upsetBig', 2, 'p2', { p1: 1.3, p2: 3.6 }, { p1: 1.25, p2: 4.1 }, { p1: 1.25, p2: 4.1 }),
    done('upsetSmall', 3, 'p1', { p1: 2.0, p2: 1.8 }, { p1: 2.2, p2: 1.7 }, { p1: 2.2, p2: 1.7 }),
    done('noPrice', 0, 'p1', null, null, null),
  ];
  assert.deepEqual(run(L, 'upset'), ['upsetBig', 'upsetSmall', 'favWon', 'noPrice']);
  // wrong = the price moved 2%+ towards the player who lost: upsetBig (p1 shortened, p2 won) and upsetSmall (p2 shortened)
  assert.deepEqual(run(L, 'marketwrong'), ['upsetBig', 'upsetSmall', 'favWon', 'noPrice'], 'wrong first, by how far the winner drifted (+13.9% before +10.0%)');
  assert.deepEqual(run(L, 'move'), ['upsetBig', 'favWon', 'upsetSmall', 'noPrice'], 'the printed move, either side: 13.9 · 11.5 · 10.0');
});

test('the sort rides in the hash (#Matches/<key>), resets on a view switch, and a key the view lacks falls back to Time', () => {
  assert.match(slice('mxWriteHash'), /\(state\.sort && state\.sort !== 'time' \? '\/' \+ state\.sort : ''\)/);
  const re = new Function(`${/const MX_HASH_RE = [^;]+;/.exec(html)[0]} return MX_HASH_RE;`)();
  assert.deepEqual(re.exec('#Matches/tight').slice(1), ['Matches', 'tight']);
  assert.deepEqual(re.exec('#Results').slice(1), ['Results', undefined]);
  assert.equal(re.exec('#match/past-1/key'), null, 'a modal link is not a board hash');
  assert.match(slice('setMatchesView'), /if \(state\.view !== next\) state\.sort = 'time';/);
  const run = (sort, completed) => new Function(`
    const state = { sort: ${JSON.stringify(sort)} };
    const els = { sortMenu: { innerHTML: '' }, sortBtnLabel: { textContent: '' } };
    const document = { getElementById: id => els[id] || null };
    const _mcOddsLanded = () => false, _openPinIsVendor = () => true, _mcCardCloseOf = () => null, matches = [];
    ${slice('syncSortDropdown')}
    syncSortDropdown(${completed});
    return [state.sort, els.sortBtnLabel.textContent, els.sortMenu.innerHTML.match(/data-sort="[a-z]+"/g).join(' ')];`)();
  assert.deepEqual(run('short', false), ['short', 'Shortest price', 'data-sort="time" data-sort="drift" data-sort="tight" data-sort="short"']);
  assert.deepEqual(run('upset', true), ['upset', 'Biggest upset', 'data-sort="time" data-sort="move" data-sort="upset" data-sort="marketwrong"']);
  assert.equal(run('tight', true)[0], 'time', 'Tightest is not a Completed sort');
  assert.doesNotMatch(run('time', true)[2], /disabled/);
});

test('Market read (day): Pinnacle first price → Pinnacle close within 60 min, 2% minimum, counts only; thin under 3; the 30-day hover', () => {
  const mk = src => new Function(`
    const _mcPinClose = m => m.__pin || null, mxPinCloseAgeMin = (m, w) => (m.__age == null ? 10 : m.__age);
    const ensureOddsMovement = m => Promise.resolve(m);
    ${/const MX_MOVE_MIN = [\d.]+;/.exec(src)[0]} ${slice('mxMovePct', src)} ${slice('mxPinCloseW60', src)} ${slice('mxJourneyOf', src)}
    ${slice('mxPinOpen', src)} ${slice('mxPinJourney', src)} ${slice('mxMarketRead', src)} ${slice('mxEnsureShards', src).replace('function mxEnsureShards', 'let _mxShardBatch = null; function mxEnsureShards')}
    return mxMarketRead;`)();
  const R = mk(html);
  const pin = (o, c, w, age, loaded = true) => ({ finalScore: { winner: w }, _oddsLoaded: loaded, __pin: c, __age: age, p1: 'A. One', p2: 'B. Two',
    oddsMovement: o ? { chart: { books: { 'Pinnacle +30s': { p1: [['t0', 1.0], ['t1', o.p1]], p2: [['t1', o.p2]] } } } } : null });
  const L = [
    pin({ p1: 2.0, p2: 1.8 }, { p1: 1.8, p2: 2.0 }, 'p1'),      // shortened p1, p1 won → right
    pin({ p1: 1.5, p2: 2.6 }, { p1: 1.4, p2: 2.9 }, 'p2'),      // shortened p1, p2 won
    pin({ p1: 1.5, p2: 2.6 }, { p1: 1.49, p2: 2.62 }, 'p1'),    // under 2%: not moved
    pin({ p1: 2.0, p2: 1.8 }, { p1: 1.6, p2: 2.3 }, 'p1', 90),  // close older than 60 min: excluded
    pin(null, { p1: 1.6, p2: 2.3 }, 'p1'),                       // no Pinnacle open: excluded
  ];
  const r = R(L);
  assert.deepEqual([r.won, r.moved, r.excluded, r.pending], [1, 2, 2, false]);
  assert.deepEqual([r.best.o, r.best.c, r.best.name], [2.0, 1.8, 'A. One'], 'the sub-1.01 first tick is not the open');
  assert.match(r.title, /^Open = Pinnacle first price \(Oddspapi\) · close = Pinnacle within 60 min · 2 of 5 excluded/);
  assert.equal(R([pin(null, null, 'p1', 10, false)]).pending, true, 'a card whose shard is not in yet reads Loading, not —');
  assert.deepEqual([R([]).moved, R([]).best], [0, null], 'nothing moved → the tile prints —');
  const body = slice('renderMatches');
  assert.match(body, /mr\.moved > 0 && mr\.moved < 3 \? '<span class="mc-story__thin">· thin<\/span>'/);
  assert.match(body, /\$\{mr\.moved \? `\$\{mr\.won\} of \$\{mr\.moved\}` : '—'\}/, 'counts only, never %');
  // MUTANT: no minimum move → the flat card counts
  assert.equal(mk(html.replace('const MX_MOVE_MIN = 2.0;', 'const MX_MOVE_MIN = 0;'))(L).moved, 3);
  // MUTANT: the card book instead of Pinnacle → the founder's basis is lost
  assert.notEqual(html.indexOf('const j = mxPinJourney(m);'), -1);
});

test('Elo rows: P(A) = 1/(1+10^((Rb−Ra)/400)), fair odds 1/P to 2 dp, no margin; surface on both sides or a dash (founder numbers)', () => {
  const E = new Function(`
    let eloRatings = { elo: { 'fils|a': { all: { rating: 2034.5 }, hard: { rating: 1973.6 }, clay: { rating: 1900 } },
                              'michelsen|a': { all: { rating: 1880.7 }, hard: { rating: 1859.6 } } } };
    ${slice('psEloNorm')} ${slice('mcSigEloRec')} ${slice('mcSigEloLast')} ${slice('mcSigEloP')} ${slice('mcSigFair')} ${slice('mcSigElo')}
    return { mcSigElo, mcSigFair, mcSigEloP };`)();
  const m = { p1: 'A. Fils', p2: 'A. Michelsen' };
  const all = E.mcSigElo(m, 'all'), hard = E.mcSigElo(m, 'hard'), clay = E.mcSigElo(m, 'clay');
  assert.equal(all.p.toFixed(2), '70.79'); assert.equal((100 - all.p).toFixed(2), '29.21');
  assert.deepEqual([E.mcSigFair(all.p), E.mcSigFair(100 - all.p)], ['1.41', '3.42']);
  assert.equal(hard.p.toFixed(2), '65.84');
  assert.deepEqual([E.mcSigFair(hard.p), E.mcSigFair(100 - hard.p)], ['1.52', '2.93']);
  assert.equal(clay.p, null, 'Michelsen has no clay rating → the surface row dashes; never his overall in its place');
  assert.match(clay.why, /no clay rating/);
  assert.equal(E.mcSigFair(100 / 1.05), '1.05', 'two decimals even below 1.10');
  // MUTANT: a surface row that falls back to the overall rating for the player without one
  const mut = slice('mcSigElo').replace("const a = r1[slot] && r1[slot].rating, b = r2[slot] && r2[slot].rating;",
    "const a = (r1[slot] && r1[slot].rating) || r1.all.rating, b = (r2[slot] && r2[slot].rating) || r2.all.rating;");
  assert.notEqual(mut, slice('mcSigElo'));
  const M = new Function(`let eloRatings = { elo: { 'fils|a': { all: { rating: 2034.5 }, clay: { rating: 1900 } }, 'michelsen|a': { all: { rating: 1880.7 } } } };
    ${slice('psEloNorm')} ${slice('mcSigEloRec')} ${slice('mcSigEloLast')} ${slice('mcSigEloP')} ${mut} return mcSigElo;`)();
  assert.notEqual(M(m, 'clay').p, null, 'the mutant mixes surface and overall — the real code does not');
});

test('Elo rows: a player Tennis Abstract dropped takes his LAST record, labelled stale with its report date; the current report always wins (founder 2026-10-30, Rune v Vacherot)', () => {
  // The real shapes: Vacherot in the current report, Rune only in lastKnown (his 21 Sep report record, read 29 Sep).
  const store = {
    elo: { 'vacherot|v': { all: { rating: 1858 }, hard: { rating: 1809 } }, 'zverev|a': { all: { rating: 2050 }, hard: { rating: 2000 } } },
    bySurnameElo: { vacherot: { all: { rating: 1858 }, hard: { rating: 1809 } } },
    lastKnown: { 'rune|h': { all: { rating: 1776 }, hard: { rating: 1747 }, name: 'Holger Rune', report: '2026-09-21', fetched: '2026-09-29' },
                 'zverev|a': { all: { rating: 1500 }, hard: { rating: 1500 }, report: '2026-01-05' },
                 'smith|j': { all: { rating: 1600 }, report: null, fetched: '2026-08-10' } },
  };
  const make = (fn = slice('mcSigElo')) => new Function('store', `let eloRatings = store;
    ${slice('psEloNorm')} ${slice('mcSigEloRec')} ${html.includes('function mcSigEloLast(') ? slice('mcSigEloLast') : ''} ${slice('mcSigEloP')} ${slice('mcSigFair')} ${fn}
    ${html.includes('function mcSigEloStaleText(') ? slice('mcSigEloStaleText') : 'function mcSigEloStaleText(){ return ""; }'}
    return { mcSigElo, mcSigFair, mcSigEloStaleText };`)(store);
  const E = make();
  const m = { p1: 'H. Rune', p2: 'V. Vacherot' };
  const all = E.mcSigElo(m, 'all'), hard = E.mcSigElo(m, 'hard');
  // P(A) = 1/(1+10^((1858−1776)/400)) = 38.41%; hard 1/(1+10^((1809−1747)/400)) = 41.17% — the formula unchanged.
  assert.equal(all.p.toFixed(2), '38.41'); assert.deepEqual([E.mcSigFair(all.p), E.mcSigFair(100 - all.p)], ['2.60', '1.62']);
  assert.equal(hard.p.toFixed(2), '41.17'); assert.deepEqual([E.mcSigFair(hard.p), E.mcSigFair(100 - hard.p)], ['2.43', '1.70']);
  assert.deepEqual(all.stale.map(s => s.name), ['H. Rune'], 'only the dropped player is marked stale');
  assert.equal(E.mcSigEloStaleText(all.stale), 'H. Rune: not in the current Tennis Abstract report — rating from its 21 Sep 2026 report (stale)');
  assert.equal(E.mcSigEloStaleText([{ name: 'J. Smith', report: null, fetched: '2026-08-10' }]),
    'J. Smith: not in the current Tennis Abstract report — rating from the report we read on 10 Aug 2026 (stale)');
  // The current report wins: Zverev's lastKnown 1500 is never read while the report holds him.
  const z = E.mcSigElo({ p1: 'A. Zverev', p2: 'V. Vacherot' }, 'all');
  assert.equal(z.stale.length, 0); assert.equal(z.p.toFixed(2), (100 / (1 + Math.pow(10, (1858 - 2050) / 400))).toFixed(2));
  // Exact key only — a different initial never borrows a dropped player's record; a player in neither file still dashes.
  assert.equal(E.mcSigElo({ p1: 'A. Rune', p2: 'V. Vacherot' }, 'all').p, null);
  assert.equal(E.mcSigElo({ p1: 'X. Nobody', p2: 'V. Vacherot' }, 'all').p, null);
  // A last record without the surface still dashes the surface row (never the overall in its place).
  assert.equal(E.mcSigElo({ p1: 'J. Smith', p2: 'V. Vacherot' }, 'hard').p, null);
  // The card: the stale line sits under the Elo rows and the rows' hover carries it.
  const body = slice('mcSigBody');
  assert.match(body, /<div class="mc-sg-stale">Elo · \$\{psEsc\(eloStale\)\}<\/div>/);
  assert.match(body, /src: st \? src \+ ' · ' \+ st : src/);
  assert.match(html, /\.mc-sg-stale\{[^}]*color:var\(--text-label\)/);
  // CONTROL — the pre-fix lookup (no lastKnown) dashes Rune v Vacherot.
  const old = `function mcSigElo(m, slot){
  if (!eloRatings || !eloRatings.elo) return { p: null, why: 'Elo file not loaded' };
  const r1 = mcSigEloRec(m.p1), r2 = mcSigEloRec(m.p2);
  if (!r1 || !r2) return { p: null, why: 'player not in the Elo file' };
  const a = r1[slot] && r1[slot].rating, b = r2[slot] && r2[slot].rating;
  if (!(a > 0) || !(b > 0)) return { p: null, why: slot === 'all' ? 'no Elo rating' : \`no \${slot} rating\` };
  return { p: 100 * mcSigEloP(a, b), why: '' };
}`;
  assert.equal(make(old).mcSigElo(m, 'all').p, null, 'control: the old code dashes the row this test fills');
});

test('fetch-elo carryLastKnown: a dropped player keeps his last record with the report date; a returning, ambiguous or 2-year-old one does not', () => {
  const { carryLastKnown } = createRequire(import.meta.url)('./fetch-elo.js');
  const now = Date.parse('2026-10-26T23:00:00Z');
  const prev = { generatedAt: '2026-09-29T00:11:10Z', taLastUpdate: '2026-09-21', ambiguous: ['blanch|d'],
    elo: { 'rune|h': { all: { rating: 1776 } }, 'blanch|d': { all: { rating: 1500 } }, 'sinner|j': { all: { rating: 2297 } } },
    names: { 'rune|h': 'Holger Rune' },
    lastKnown: { 'old|x': { all: { rating: 1400 }, report: '2024-09-01' }, 'back|y': { all: { rating: 1600 }, report: '2026-08-01' } } };
  const out = { elo: { 'sinner|j': { all: { rating: 2300 } }, 'back|y': { all: { rating: 1650 } } }, ambiguous: [] };
  const lk = carryLastKnown(prev, out, now);
  assert.deepEqual(Object.keys(lk), ['rune|h']);
  assert.deepEqual(lk['rune|h'], { all: { rating: 1776 }, name: 'Holger Rune', report: '2026-09-21', fetched: '2026-09-29' });
  // Carried on: the next week's report still lacks him → the same record, the same date.
  assert.deepEqual(carryLastKnown(Object.assign({}, out, { lastKnown: lk, generatedAt: '2026-10-27' }), out, now)['rune|h'], lk['rune|h']);
  // The committed store carries Rune's 21 Sep record.
  const store = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'elo-ratings.json'), 'utf8'));
  for (const k of Object.keys(store.lastKnown || {})) assert.ok(!store.elo[k], `${k} is in the report AND lastKnown`);
});

test('Bets today (BETS_TODAY_TILE.md, LOCK 2026-10-30): row = selection · market + price; 3-line cap; PRO chip in both states; non-Pro rows blurred whole', () => {
  // Today's open picks (posted · live), posting order, the rail badge's rows (PicksShell.loadToday). A non-Pro member gets
  // teasers (no selection, no price), so each blurred row is drawn over a placeholder — never the real pick.
  const PC = createRequire(import.meta.url)('./picks-core.js');   // the real picks-core: the tile reads the Picks page's own words
  const B = (picks, plan, admin, src = slice('mxBetsTileHtml')) => new Function('picks', 'plan', 'admin', 'PicksCore', `
    const window = { sfPlan: plan }; let _mxPicks = picks; const isBspAdmin = () => !!admin;
    ${slice('psEsc')} ${slice('mxOddsTxt')} ${slice('mxIsPro')} ${slice('mxBetMarket')} ${src} return mxBetsTileHtml();`)(picks, plan, admin, PC);
  const mw = (a, b, sel, px, extra) => Object.assign({ kind: 'match', market: 'Match winner', tournament: 'Swiss Indoors', round: 'QF', selection: sel, player_a: { name: a }, player_b: { name: b }, posted_price: px, status: 'posted' }, extra || {});
  const fritz = mw('T. Fritz', 'A. Fils', 'a', 1.95), struff = mw('J-L. Struff', 'N. Borges', 'a', 1.77),
    struffHc = mw('J-L. Struff', 'N. Borges', 'a', 1.8, { market: 'Games handicap', line: '+2.5' }),
    tot = mw('H. Rune', 'V. Vacherot', 'a', 1.9, { market: 'Total games', line: 'Over 22.5' }),
    typed = mw('B. Vacherot', 'A. Michelsen', 'b', 2.4, { market: 'Other', market_text: 'Tiebreak' }),
    outr = { kind: 'outright', event: 'Nitto ATP Finals', selection: 'a', player_a: { name: 'J. Sinner' }, posted_price: 3.5, status: 'posted' },
    noMkt = mw('T. Paul', 'C. Alcaraz', 'a', 2.1, { market: null });
  const rows = h => (h.match(/class="mc-story__bet[ "]/g) || []).length;
  // 1–3 bets: one row each, no more-line
  for (const set of [[fritz], [fritz, struff], [fritz, struff, struffHc]]) {
    const h = B(set, 'pro'); assert.equal(rows(h), set.length); assert.doesNotMatch(h, /more bets/);
  }
  // 4+: exactly 2 rows + "+N more bets →"
  const five = B([fritz, struff, struffHc, tot, typed], 'pro');
  assert.equal(rows(five), 2, 'never more than 3 lines');
  assert.match(five, /mc-story__betmore">\+3 more bets →</);
  assert.match(five, /betpick">Fritz<\/span><span class="mc-story__betmkt"> · Match winner<\/span><\/span><span class="mc-story__betpx">1\.95</, 'selection · market + price');
  assert.match(five, /betpick">J-L\. Struff<\/span><span class="mc-story__betmkt"> · Match winner</, 'the reference\'s "J-L. Struff"');
  assert.match(five, /mc-story__now">5<\/span><span class="mc-story__name">bets today/);
  assert.doesNotMatch(five, /Swiss Indoors|QF|\d\d:\d\d/, 'no tournament, round or time on the tile');
  // the market as posted
  const m = B([struffHc, tot, typed], 'pro');
  assert.match(m, /betmkt"> · Games \+2\.5</); assert.match(m, /betmkt"> · Total games O 22\.5</); assert.match(m, /betpick">Michelsen<\/span><span class="mc-story__betmkt"> · Tiebreak</, 'a typed market reads its own name, the picked side');
  assert.match(B([outr], 'pro'), /betpick">Sinner<\/span><span class="mc-story__betmkt"> · Nitto ATP Finals</, 'an outright reads its event');
  assert.match(B([noMkt], 'pro'), /betmkt"> · Match winner</, 'no market stored → Match winner');
  // Pro / non-Pro: PRO chip in both; cue grey vs accent; non-Pro rows blurred whole, the more-line readable, no real pick
  const pro = B([fritz, struff, struffHc, tot], 'pro');
  assert.match(pro, /mc-story__pro">PRO<\/span><span class="mc-story__hint">Open picks →/);
  assert.doesNotMatch(pro, /is-blur/);
  const teasers = [fritz, struff, struffHc, tot].map(p => Object.assign({}, p, { _teaser: true, player_a: null, player_b: null, posted_price: null }));
  const free = B(teasers, null);
  assert.match(free, /mc-story__pro">PRO<\/span><span class="mc-story__hint mc-story__hint--cta">Unlock today’s picks →/);
  assert.equal((free.match(/mc-story__bet is-blur"/g) || []).length, 2, 'each listed row blurred as a whole');
  assert.match(free, /mc-story__betmore">\+2 more bets →</, 'the more-line stays readable');
  assert.doesNotMatch(free, /Fritz|Struff|1\.95|1\.77/, 'a non-Pro tile never holds the real selection or price');
  // the admin bypasses Pro gating (founder 2026-10-28)
  const adm = B([fritz], 'free', true); assert.doesNotMatch(adm, /is-blur/); assert.match(adm, /Open picks →/);
  const mxIsPro = new Function('window', 'isBspAdmin', `${slice('mxIsPro')} return mxIsPro();`);
  assert.equal(mxIsPro({ sfPlan: 'free' }, () => true), true); assert.equal(mxIsPro({ sfPlan: 'free' }, () => false), false); assert.equal(mxIsPro({ sfPlan: 'pro' }, () => false), true);
  assert.match(B([], null), /mc-story__now">—<\/span>[\s\S]*No bets posted yet today/);
  assert.match(B([fritz], null), /bet today</, 'singular');
  // CSS: a long market truncates before the price; the price never wraps
  assert.match(html, /\.mc-story__betsel\{[^}]*white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0;/);
  assert.match(html, /\.mc-story__betpx\{[^}]*flex:none;/);
  // MUTANTS: no cap (every bet listed); the PRO chip hidden for Pro
  const noCap = slice('mxBetsTileHtml').replace('const shown = n > 3 ? picks.slice(0, 2) : picks;', 'const shown = picks;');
  assert.notEqual(noCap, slice('mxBetsTileHtml')); assert.equal(rows(B([fritz, struff, struffHc, tot, typed], 'pro', false, noCap)), 5, 'no-cap mutant caught');
  const noChip = slice('mxBetsTileHtml').replace('<span class="mc-story__pro">PRO</span><span', "${pro ? '' : '<span class=\"mc-story__pro\">PRO</span>'}<span");
  assert.notEqual(noChip, slice('mxBetsTileHtml')); assert.doesNotMatch(B([fritz], 'pro', false, noChip), /mc-story__pro/, 'no-chip mutant caught');
});

test('Streak on court: the top Series card, "+N more on court today" by player, the empty state; Series is asked with its defaults', () => {
  const T = (rows, day = 'today') => new Function('rows', 'day', `
    const state = { day }; const _mxStreak = { day: 'today', rows };
    const matchById = () => ({ tour: 'ATP Vienna', tournamentRound: 'ATP Vienna - 1/16-finals' });
    const mxEventName = t => t, roundBadgeText = () => 'R32';
    ${slice('psEsc')} ${slice('mxStreakTileHtml')} return mxStreakTileHtml();`)(rows, day);
  const rows = [{ count: 6, claim: 'wins in a row', name: 'A. De Minaur', key: '1', opp: 'T. Machac', event: 'Vienna Open', matchId: 'u1' },
                { count: 4, claim: 'wins in a row', name: 'H. Rune', key: '2', opp: 'Q. Halys', event: 'Swiss Indoors' },
                { count: 4, claim: 'Over 21.5 total games', name: 'H. Rune', key: '2', opp: 'Q. Halys', event: 'Swiss Indoors' }];
  const h = T(rows);
  assert.match(h, /mc-story__now">6<\/span><span class="mc-story__name">A\. De Minaur<\/span><span class="mc-story__claim">wins in a row/);
  assert.match(h, /v T\. Machac · Vienna Open R32/);
  assert.match(h, /\+1 more on court today/, 'Rune counts once');
  assert.match(T([]), /No streaks on court today[\s\S]*Streaks come from the Series page · 75-day rule/);
  assert.match(T(rows, 'tomorrow'), /Loading streaks/, 'another day’s answer is never shown');
  // a failed series.json load is not the empty state: the tile stays on Loading and the next render asks again
  const E = new Function(`
    const state = { day: 'today' }; const window = { SeriesPage: { onCourt: () => Promise.resolve(null) } };
    const document = { querySelector: () => null }; const _mxStreak = { day: null, rows: null, pending: null, at: 0, emptyTries: 0 };
    ${slice('mxStreakEnsure')} mxStreakEnsure('today'); return _mxStreak.pending.then(() => _mxStreak);`)();
  // an EMPTY first answer is asked again (live 2026-10-27: the boot answer was empty while the slate held 19 streaks)
  const answers = [[], [{ key: '1' }]];
  const F = new Function('answers', `
    const state = { day: 'today', view: 'upcoming' }; const timers = [];
    const window = { SeriesPage: { onCourt: () => Promise.resolve(answers.shift()) } };
    const setTimeout = fn => timers.push(fn);
    const document = { querySelector: () => null }; const _mxStreak = { day: null, rows: null, pending: null, at: 0, emptyTries: 0 };
    ${slice('mxStreakEnsure')}
    mxStreakEnsure('today');
    return _mxStreak.pending.then(() => { const first = _mxStreak.rows.length; timers.shift()(); return _mxStreak.pending.then(() => [first, _mxStreak.rows.length]); });`);
  return E.then(st => {
    assert.equal(st.rows, null, 'no rows → not "No streaks on court today"');
    assert.equal(st.day, null, 'cleared so the next render retries');
    return F(answers);
  }).then(([first, second]) => {
    assert.deepEqual([first, second], [0, 1], 'the empty answer was re-asked and the real one replaced it');
  }).then(() => {
  const series = readFileSync(join(HERE, 'series.js'), 'utf8');
  assert.match(series, /var f = Object\.assign\(\{\}, DEFAULTS\);/, 'the Series page defaults, not the member’s filters');
  assert.match(series, /passesFilters\(c, false, f\)/);
  // founder 2026-10-28: only players with a card on the board (ATP) — a series-only fixture never counts
  assert.match(series, /return c\.slot && c\.slot\.board && c\.slot\.day === day && passesFilters\(c, false, f\);/);
  assert.match(series, /onCourt: onCourt,\n    openStreak: openStreak,/);
  });
});

// ── Founder ruling 2026-10-28 (close-rule corrections items 2 + 3) ──
test('item 3: "moved" = the shortening side fell 2%+; a drift on the other side never qualifies (day tile + Market got it wrong)', () => {
  const OLD = "moved: toward != null && fell < 0 && -fell >= MX_MOVE_MIN, toward };";
  assert.ok(html.includes(OLD), 'the ruled rule is in the page');
  const J = src => new Function(`${/const MX_MOVE_MIN = [\d.]+;/.exec(src)[0]} ${slice('mxMovePct', src)} ${slice('mxJourneyOf', src)} return mxJourneyOf;`)();
  const j = J(html);
  // Griekspoor v Lehecka, 23 Oct: 3.36/1.366 → 3.49/1.355 — p1 drifted +3.9%, p2 shortened −0.8%.
  assert.equal(j(3.36, 1.366, 3.49, 1.355).moved, false, 'a 3.9% drift with a 0.8% shortening is not a move');
  assert.equal(j(1.5, 2.6, 1.47, 2.62).moved, true, 'exactly −2.0% on the shortening side is a move');
  assert.equal(j(1.5, 2.6, 1.48, 2.62).moved, false, '−1.3% is not');
  assert.equal(j(1.5, 2.6, 1.6, 2.9).moved, false, 'both sides drifted: nothing shortened, not a move');
  // Market got it wrong reads the same flag: the drift shape with p1 winning is no longer "wrong first".
  const run = sortApi();
  const L = [done('drift', 1, 'p1', { p1: 3.36, p2: 1.366 }, { p1: 3.49, p2: 1.355 }, null),
             done('real', 2, 'p2', { p1: 1.5, p2: 2.6 }, { p1: 1.47, p2: 2.62 }, null)];
  assert.deepEqual(run(L, 'marketwrong'), ['real', 'drift']);
  // CONTROL: the pre-ruling rule (the larger move on either side) counts the drift.
  const mut = html.replace(OLD, 'moved: mag >= MX_MOVE_MIN && toward != null, toward };');
  assert.notEqual(mut, html);
  assert.equal(J(mut)(3.36, 1.366, 3.49, 1.355).moved, true, 'the old rule is caught by this test');
  assert.deepEqual(sortApi(mut)(L, 'marketwrong'), ['drift', 'real']);
});

test('item 2: the Pinnacle close age runs from our last sighting (seenAt), else the leg tick; never from a sighting before the tick', () => {
  const A = src => new Function('c', `const _mcPinClose = () => c; ${slice('mxPinCloseAgeMs', src)} ${slice('mxPinCloseAgeMin', src)} return w => mxPinCloseAgeMin({}, w);`);
  const c = { p1At: '2026-10-20T10:00:00Z', p2At: '2026-10-20T09:30:00Z', seenAt: '2026-10-20T11:20:00Z', ageRefTs: '2026-10-20T11:31:00Z' };
  assert.deepEqual([A(html)(c)('p1'), A(html)(c)('p2')], [11, 11], 'both legs aged from the 11:20 read');
  assert.deepEqual([A(html)(Object.assign({}, c, { seenAt: null }))('p1'), A(html)(Object.assign({}, c, { seenAt: null }))('p2')], [91, 121], 'no sighting: the ticks');
  assert.equal(A(html)(Object.assign({}, c, { seenAt: '2026-10-20T09:45:00Z' }))('p1'), 91, 'a sighting before a leg tick does not age that leg');
  // CONTROL: the tick clock (pre-ruling) is caught.
  const mut = html.replace("const t = Number.isFinite(seen) && seen >= tick ? seen : tick,", "const t = tick,");
  assert.notEqual(mut, html);
  assert.equal(A(mut)(c)('p1'), 91);
});
