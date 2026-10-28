// Step 15 — Today's Matches: sorts, sort hash, Market read, Upsets, Bets today, Streak on court (founder 2026-10-27,
// design_handoff_todays_matches_v2 README §1–§3). The functions are SLICED out of the shipped HTML and EXECUTED.
//
// Run: node --test test-step15-matches.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    ${slice('psEloNorm')} ${slice('mcSigEloRec')} ${slice('mcSigEloP')} ${slice('mcSigFair')} ${slice('mcSigElo')}
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
    ${slice('psEloNorm')} ${slice('mcSigEloRec')} ${slice('mcSigEloP')} ${mut} return mcSigElo;`)();
  assert.notEqual(M(m, 'clay').p, null, 'the mutant mixes surface and overall — the real code does not');
});

test('Bets today: count unblurred; tournament + round readable, selection + price blurred in ONE span unless Pro; empty → "No bets posted yet today"', () => {
  // Task 3 (founder 2026-10-27): the tile reads today's open picks from the picks store (picks-store.js). A non-Pro member
  // gets teasers (no selection, no price), so the blurred span is drawn over a placeholder — never the real pick.
  const B = (picks, plan, admin) => new Function('picks', 'plan', 'admin', `
    const window = { sfPlan: plan }; let _mxPicks = picks; const isBspAdmin = () => !!admin;
    const PicksCore = { surname: n => String(n || '').split(' ').slice(1).join(' ') };
    ${slice('psEsc')} ${slice('mxOddsTxt')} ${slice('mxIsPro')} ${slice('mxBetsTileHtml')} return mxBetsTileHtml();`)(picks, plan, admin);
  const real = [{ kind: 'match', tournament: 'Vienna Open', round: 'R32', selection: 'a', player_a: { name: 'M. Berrettini' }, player_b: { name: 'T. M. Etcheverry' }, posted_price: 2.02, status: 'posted' },
                { kind: 'match', tournament: 'Swiss Indoors', round: 'R32', selection: 'b', player_a: { name: 'A. Bublik' }, player_b: { name: 'H. Rune' }, posted_price: 1.85, status: 'live' },
                { kind: 'outright', event: 'Nitto ATP Finals · Turin', selection: 'a', player_a: { name: 'J. Sinner' }, posted_price: 3.5, status: 'posted' }];
  const teasers = real.map(p => Object.assign({}, p, { _teaser: true, player_a: null, player_b: null, posted_price: null }));
  const free = B(teasers, null);
  assert.match(free, /mc-story__now">3<\/span><span class="mc-story__name">bets today/, 'the count includes the outright');
  assert.equal((free.match(/mc-story__betsel is-blur"/g) || []).length, 2, 'one blurred span per match pick (outrights are not listed)');
  assert.match(free, /mc-story__betmeta">Vienna Open R32</);
  assert.match(free, /PRO<\/span><span class="mc-story__hint mc-story__hint--cta">Unlock today’s picks →/);
  assert.doesNotMatch(free, /Berrettini|Rune|2\.02|1\.85/, 'a non-Pro tile never holds the real selection or price');
  assert.doesNotMatch(free, /\d\d:\d\d/, 'no time');
  const pro = B(real, 'pro');
  assert.doesNotMatch(pro, /is-blur/);
  assert.match(pro, /Open picks →/);
  assert.doesNotMatch(pro, /mc-story__pro/, 'Pro: no PRO chip');
  assert.match(pro, /betpick">Berrettini<\/span><span class="mc-story__betpx">2\.02</);
  assert.match(pro, /betpick">Rune</, 'the picked side (b)');
  // founder 2026-10-28: the admin bypasses Pro gating everywhere — on a Free plan the tile is unblurred, "Open picks →"
  const adm = B(real, 'free', true);
  assert.doesNotMatch(adm, /is-blur/); assert.match(adm, /Open picks →/); assert.match(adm, /betpick">Berrettini</);
  const mxIsPro = new Function('window', 'isBspAdmin', `${slice('mxIsPro')} return mxIsPro();`);
  assert.equal(mxIsPro({ sfPlan: 'free' }, () => true), true, 'mxIsPro: the admin on Free');
  assert.equal(mxIsPro({ sfPlan: 'free' }, () => false), false, 'mxIsPro: a Free member');
  assert.equal(mxIsPro({ sfPlan: 'pro' }, () => false), true, 'mxIsPro: a Pro member');
  assert.match(B([], null), /mc-story__now">—<\/span>[\s\S]*No bets posted yet today/);
  assert.match(B([real[0]], null), /bet today</, 'singular');
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
