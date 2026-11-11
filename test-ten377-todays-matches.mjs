// TEN-377 — Today's Matches step 2 (founder, design_handoff_todays_matches README, OFFICIAL VERSION 1).
//
// The card builders are SLICED out of the shipped HTML and EXECUTED; the CSS checks read the
// last rule that wins for each selector (a regex over a superseded rule would pass on dead code).
//
// Run: node --test test-ten377-todays-matches.mjs
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
// The REAL book-label map (exact anchor), so a regression in bsp-consult-dashboard.html's MX_BOOK_LABELS fails here.
function sliceObj(name, src = html) {
  const start = src.indexOf(`\nconst ${name} = {`);
  assert.ok(start > 0, `const ${name} not found`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start + 1, i + 1) + ';';
}
const MX_BOOK_LABELS_SRC = sliceObj('MX_BOOK_LABELS');
const A = new Function(`
  ${MX_BOOK_LABELS_SRC}
  const _mcNowPair = m => m.__pair || null;
  const _ocsOf = m => m.__ocs || null;
  const _mcCardCloseDerivedOf = (m, who) => (m.__pin ? m.__pin[who] : null);
  const _mcPinClose = m => m.__pin || null, mxPinCloseAgeMin = (m, who) => (m.__age == null ? 5 : m.__age);
  ${slice('mxOddsTxt')} ${slice('mcTitleAttr')} ${slice('oddsPctDelta')} ${slice('mxMovePct')} ${slice('mxBookLabel')}
  ${slice('mcTiebreaks')} ${slice('mcSetIsWon')} ${slice('mcSetCluster')} ${slice('mcTermCell')} ${slice('mcJourney')}
  ${slice('mxPinCloseW60')} ${slice('mxUpsetOf')} ${slice('mxUpsets')} ${slice('mcBoardBooks')}
  return { mcSetCluster, mcTermCell, mcJourney, mxUpsets, mcBoardBooks };
`)();

// ── README §7 "7a": sets-won tile · divider · one cell per set, tie-break in the corner ──
test('score: sets-won tile, then ONE cell per played set (no padding cells), won/lost per set', () => {
  const fs = { sets: [{ p1: 7, p2: 6 }, { p1: 3, p2: 6 }, { p1: 6, p2: 4 }], p1Sets: 2, p2Sets: 1, winner: 'p1', display: '7-6(5), 3-6, 6-4' };
  const h = A.mcSetCluster(fs, 'p1', false, 5);
  assert.match(h, /^<span class="mc-score"><span class="mc-score__won w">2<\/span><span class="mc-score__div"><\/span>/);
  assert.equal((h.match(/class="mc-score__c[ "]/g) || []).length, 3, 'a 3-set match draws 3 cells even on a 5-set board');
  assert.match(h, /mc-score__c w">7<sup>7<\/sup>/, 'the tie-break winner shows his own points');
  assert.match(h, /mc-score__c">3</, 'a lost set has no .w');
  const l = A.mcSetCluster(fs, 'p2', false, 5);
  assert.match(l, /mc-score__won l">1/);
  assert.match(l, /mc-score__c">6<sup>5<\/sup>/, 'the tie-break loser shows HIS points too (reference 7⁷ / 6⁵)');
});

test('score: a walkover has no cells; a retirement recounts the sets', () => {
  assert.equal(A.mcTermCell({ finalScore: { winner: 'p1' } }, 'p1', 3), '<span class="mc-score mc-score--term"></span>');
  const ret = { finalScore: { sets: [{ p1: 6, p2: 2 }, { p1: 7, p2: 5 }, { p1: 3, p2: 2 }], p1Sets: 3, p2Sets: 0, winner: 'p1', display: '6-2, 7-5, 3-2' } };
  assert.match(A.mcTermCell(ret, 'p1', 3), /mc-score__won w">2</, 'the abandoned 3-2 is credited to nobody');
});

// ── README §7: Open → Close · Move; the price-journey bar is removed ──
test('prices: Open → Close · Move on one grid; signed % on the 2-dp prices, one decimal (TEN-403 card 9b1c3aa1), true minus; no journey bar', () => {
  const h = A.mcJourney(1.52, 1.38, false, {});
  assert.equal(h, '<span class="mc-px"><span class="mc-px__open">1.52</span><span class="mc-px__arr">→</span>'
    + '<span class="mc-px__close">1.38</span><span class="mc-px__move neg">−9.2%</span></span>');
  assert.match(A.mcJourney(2.60, 3.30, false, {}), /mc-px__move pos">\+26\.9%/);
  assert.match(A.mcJourney(2.0, 2.0, false, {}), /mc-px__move">±0\.0%</, 'a genuine zero reads ±0.0% grey (TEN-403 card 9b1c3aa1: the one move formula), never blank');
});

test('prices: no open -> "—" and no Move; vendor-pinned open -> no Move; older close -> white with Move', () => {
  const noOpen = A.mcJourney(null, 1.40, false, {});
  assert.match(noOpen, /mc-px__open mc-px__nodata">—/);
  assert.match(noOpen, /mc-px__move"><\/span>/);
  assert.match(A.mcJourney(null, null, false, {}), /mc-px__close mc-px__nodata">—/, 'missing close is a dash, never blank');
  assert.match(A.mcJourney(1.5, 1.6, true, {}), /mc-px__move"><\/span>/, 'TEN-198 anchorOnly');
  assert.match(A.mcJourney(1.5, 1.6, false, { closeOlder: true }), /mc-px__close">1\.60<\/span><span class="mc-px__move pos">\+6\.7%/, 'TEN-377: an older close shows white with its Move');
});

// ── README §2: header stats ──
test('header stats: Books counts distinct bookmakers once per label (Pncl = Pinnacle)', () => {
  const list = [
    { bookNow: { Pncl: {} }, bookOpens: { Betano: {}, Pinnacle: {} }, odds: { bookmaker: 'Pncl' }, __pair: { book: 'bet105' } },
    { bookNow: {}, bookOpens: { '1xBet': {} }, __ocs: { book: 'bet105' } },
  ];
  assert.equal(A.mcBoardBooks(list), 4, 'Pinnacle, Betano, bet105, 1xBet');
  assert.equal(A.mcBoardBooks([]), 0, 'an empty board is a real 0');
});

test('header stats: Upsets = the same rule as the Upsets tile (step 15: the favourite at the Pinnacle close lost, within-60 legs)', () => {
  const m = (w, p1, p2, age) => ({ p1: 'A', p2: 'B', finalScore: { winner: w }, __pin: p1 == null ? null : { p1, p2 }, __age: age });
  const u = A.mxUpsets([m('p1', 3.95, 1.26), m('p1', 1.38, 3.30), m('p2', 1.5, 2.5, 90), m('p2', 2.1, 1.9), { p1: 'X' }]);
  assert.equal(u.n, 3, 'three priced favourites (the 90-min-old close is not a figure, the unplayed card has none)');
  assert.equal(u.favWon, 2);
  assert.deepEqual(u.list.map(r => [r.winner, r.close]), [['A', 3.95]], 'only the favourite that lost');
  const two = A.mxUpsets([m('p1', 3.95, 1.26), m('p2', 1.3, 4.4)]);
  assert.deepEqual(two.list.map(r => r.close), [4.4, 3.95], 'longest winning close first');
  const tile = slice('renderMatches');
  assert.match(tile, /const up = mxUpsets\(filtered\)/, 'the tile reads the one shared rule');
  assert.match(slice('mcRenderHeaderStats'), /\['Upsets', mxUpsets\(shown\)\.list\.length\]/, 'the header reads it too');
  assert.match(tile, /mcRenderHeaderStats\(filtered\);\n  if \(filtered\.length === 0\)/, 'stats render before the empty-board return');
});

// ── CSS: the winning rule per selector (last one in the file) ──
function lastRule(sel) {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const all = [...html.matchAll(new RegExp(esc + '\\{([^}]*)\\}', 'g'))];
  assert.ok(all.length, `no rule for ${sel}`);
  return all[all.length - 1][1];
}
const M = '[data-page="matches"]';
test('Upcoming: both names white, both form bars --viz-lead/--bar, odds cell is the pop-up trigger', () => {
  assert.match(lastRule(`${M} .mc-players.up .mc-row .mc-name`), /color:var\(--text\)/);
  assert.doesNotMatch(html, /:not\(:has\(\.mc-fav-tag\)\) \.mc-name\{ color:var\(--text-soft\)/, 'the soft second name is gone');
  assert.doesNotMatch(html, /:not\(:has\(\.mc-fav-tag\)\) \.mc-form__fill\{ background:var\(--bar-2\)/, 'the 45% second form bar is gone');
  assert.match(lastRule(`${M} .match-card .mc-oddswrap`), /padding:4px 6px; margin:-4px -6px; border-radius:7px; transition:background \.12s/);
  assert.match(lastRule(`${M} .match-card .mc-sigpanel`), /background:var\(--card\); border-top:1px solid var\(--edge-6\)/);
});

test('Completed: inset tiles, winner 3.5% wash + 3px --pos pill, loser grey (never red)', () => {
  assert.match(lastRule(`${M} .mc-players.cmpl .mc-row`), /grid-template-columns:minmax\(0,1fr\) auto 1px 150px; gap:0 12px; align-items:center; padding:10px; border-radius:10px/);
  assert.match(lastRule(`${M} .mc-players.cmpl .mc-row.winner`), /color-mix\(in srgb, var\(--text\) 3\.5%, transparent\)/);
  assert.match(lastRule(`${M} .mc-players.cmpl .mc-row.winner::before`), /width:3px; border-radius:0 3px 3px 0; background:color-mix\(in srgb, var\(--pos\) 90%, transparent\)/);
  const loser = lastRule(`${M} .mc-players.cmpl .mc-row:not(.winner) .mc-name`);
  assert.match(loser, /color:var\(--text-label\)/);
  assert.doesNotMatch(loser, /--neg/);
});

test('removed: the price-journey bar, its gradient and the "Showing … settled" context bar', () => {
  assert.ok(!/class="mc-journey|\.mc-journey[\w-]*\s*[{,]|journey__bar/.test(html), 'no journey markup or CSS rule left');
  assert.ok(!/id="mcContextBar"|renderContextBar|See the full tournament breakdown/.test(html), 'no context bar left');
});

// TEN-403 (founder shell refresh): the header card is the shared 35b page header — values locked in
// test-ten403-header.mjs; here only that the board's stats sit in its stat row, after the live column.
test('header card: the 35b header; live column first, then the four stats in the same .sfh__stats row', () => {
  assert.match(html, /<div class="sfh__stats sfh__stats--c">\s*<div class="sfh__stat mx-datastatus" id="dataStatus">[\s\S]*?<\/div>\s*<div class="mx-hstats" id="mxHeaderStats"/);
  assert.match(lastRule(`${M} .mx-hstats`), /display:contents/);
});

test('odds pop-up surface: 312px, --card, radius 12, --shadow-pop, ledger max 236px, latest row --wash-5', () => {
  assert.match(lastRule(`${M} .phb`), /width:312px;[\s\S]*padding:14px 0 10px;[\s\S]*background:var\(--card\); border-radius:12px; box-shadow:var\(--shadow-pop\)/);
  assert.match(lastRule(`${M} .phb-list`), /max-height:236px; overflow-y:auto; padding:6px 8px/);
  assert.match(lastRule(`${M} .phb-row.phb-latest`), /background:var\(--wash-5\)/);
  assert.match(lastRule(`${M} .phb-row, ${M} .phb-opening`), /grid-template-columns:1fr 52px 62px; gap:10px/);
});

// ── founder answers on card d29dcdc5 (2026-10-03): README vs reference, item by item ──
test('founder Q1: Completed surface soft, round chip inner + 10% inset white, sets-won tile per README 7a, 6% rules, soft book names', () => {
  assert.match(lastRule(`${M} .match-card.cmpl .mc-surface`), /color:var\(--text-soft\)/);
  assert.match(lastRule(`${M} .match-card.cmpl .mc-round`), /box-shadow:inset 0 0 0 1px var\(--edge-10\); color:var\(--text\)/);
  const tile = lastRule(`${M} .mc-score__won`);
  assert.match(tile, /background:color-mix\(in srgb, var\(--text\) 4\.5%, transparent\); color:var\(--text-label\)/, 'loser: white 4.5%, grey number');
  assert.doesNotMatch(tile, /box-shadow/, 'loser tile has no edge');
  assert.match(lastRule(`${M} .mc-score__won.w`), /color-mix\(in srgb, var\(--text\) 9%, transparent\); box-shadow:inset 0 0 0 1px var\(--edge-10\); color:var\(--text\)/);
  assert.match(lastRule(`${M} .match-card.cmpl .mc-foot`), /border-top:1px solid var\(--edge-6\)/);
  assert.match(lastRule(`${M} .match-card.cmpl .mc-sigpanel`), /border-top:1px solid var\(--edge-6\)/);
  assert.match(lastRule(`${M} .match-card.cmpl .mc-sig-src`), /color:var\(--text-soft\)/);
  assert.match(lastRule(`${M} .match-card.cmpl .mc-analysis`), /font-weight:600/);
  assert.match(lastRule(`${M} .match-card .mc-head`), /color-mix\(in srgb, var\(--text\) 3\.5%, transparent\)/, 'Upcoming hairlines: reference 3.5%');
});

test('README §8: Upcoming / Completed switch keeps the selected date when the other rail shows it', () => {
  const body = slice('setMatchesView');
  assert.match(body, /const keepDay = state\.day;/);
  assert.match(body, /if \(keepBtn && keepBtn\.style\.display !== 'none' && keepBtn\.offsetParent !== null\) \{\n    state\.day = keepDay;/);
  assert.match(body, /\} else \{\n    mxLandOnNearestDay\(\);/, 'a day the other rail does not show still lands as before');
});

test('README §8: empty day / no results = card tone, centred 13px label', () => {
  assert.match(lastRule(`${M} .mx-empty`), /font-size:13px; color:var\(--text-label\); background:var\(--card\)/);
});

test('header stats render: Upcoming and Completed labels, counts, Updated HH:MM, "—" with no clock', () => {
  const run = (view, list, up, tz = 'Asia/Makassar') => new Function('list', 'view', 'up', 'tz', `
    const el = { innerHTML: '' };
    const document = { getElementById: () => el };
    const state = { view };
    const newsTz = () => tz;
    const mxOddsUpdatedAt = () => up;
    const mxTodayPreview = () => false, matches = [], mxPipelineAt = null, mxLoadPipelineAt = () => Promise.resolve(null);   // founder 2026-10-30: no preview here
    const _mcNowPair = m => m.__pair || null; const _ocsOf = () => null;
    const _mcCardCloseDerivedOf = (m, who) => (m.__pin ? m.__pin[who] : null);
    const _mcPinClose = m => m.__pin || null, mxPinCloseAgeMin = () => 5;
    ${MX_BOOK_LABELS_SRC}
    ${slice('mxBookLabel')} ${slice('mxPinCloseW60')} ${slice('mxUpsetOf')} ${slice('mxUpsets')} ${slice('mcBoardBooks')} ${slice('mxHeaderSet')} const MX_QUAL_SUFFIX = ' · Qualifying'; ${slice('mxIsQual')} ${slice('mxTourKey')} ${slice('mcRenderHeaderStats')}
    mcRenderHeaderStats(list); return el.innerHTML;`)(list, view, up, tz);
  const vals = h => [...h.matchAll(/sfh__l">([^<]*)<\/span><span class="sfh__v[^"]*">([^<]*)</g)].map(x => x[1] + '=' + x[2]);
  const up = [{ tour: 'ATP Tokyo', bookNow: { Pncl: {} } }, { tour: 'ATP Beijing', bookOpens: { Pinnacle: {}, Betano: {} } }];
  assert.deepEqual(vals(run('upcoming', up, Date.parse('2026-10-03T02:10:05Z'))), ['Matches=2', 'Tournaments=2'], 'CHANGES_2026-11-11 A3: Books and Updated removed');
  const done = [{ tour: 'ATP Tokyo', p1: 'A', p2: 'B', finalScore: { winner: 'p1' }, __pin: { p1: 3.9, p2: 1.3 } }, { tour: 'ATP Tokyo' }];
  assert.deepEqual(vals(run('completed', done, null)), ['Settled=1', 'Tournaments=1', 'Upsets=1', 'Updated=—'], 'no clock -> dash, a count of 0 stays 0');
  assert.match(vals(run('completed', done, Date.parse('2026-10-03T02:10:05Z'), 'Not/AZone'))[3], /^Updated=\d\d:\d\d$/, 'a bad stored zone falls back, never throws');
});

// ── founder review ba49d5fc (2026-10-03) items 4–9 ──
test('review 4/8: Completed and Upcoming always draw three tiles; an empty tile says so in one grey line; no provenance line', () => {
  const body = slice('renderMatches') + slice('mxStreakTileHtml') + slice('mxBetsTileHtml');
  for (const t of ['No market moves', 'No upsets', 'No streaks on court today', 'No bets posted yet today'])
    assert.ok(body.includes(t), `empty line "${t}"`);
  assert.doesNotMatch(body, /mc-story__faint|mcMoveBookLabel|The rolling record shows/);
  assert.doesNotMatch(body, /sp\.book \? ' · ' \+ sp\.book/, 'no "· book" suffix');
  assert.match(body, /const stripHtml = `<div class="mc-story-strip">\$\{panels\.join\(''\)\}<\/div>`;/, 'Completed strip is unconditional');
});
test('founder design 2026-11-07 (CHANGES §2–§3): Market Signal = ONE ledger, eight rows in order, dash rows for every missing source, nothing constant', () => {
  const S = (opts = {}) => new Function('opts', `
    const window = { sfPlan: opts.plan || null };
    const eloRatings = opts.elo === undefined ? { taLastUpdate: '2026-10-26', elo: {
      'rublev|a': { all: { rating: 2000 }, hard: { rating: 1950 } }, 'safiullin|r': { all: { rating: 1900 }, hard: { rating: null } } } } : opts.elo;
    const _ocsOf = m => m.__ocs || null, _mcPinClose = m => m.__pin || null, mxPinCloseAgeMin = () => 12;
    const mxJClose = (m, who) => (m.__j ? m.__j[who] : null), cardStartMs = m => m.__start, newsTz = () => 'UTC';
    ${slice('psEsc')} ${slice('psEloNorm')} ${slice('mxOddsTxt')} ${slice('mxSurname')} ${slice('mxIsPro')} ${slice('eventKeyOfMatch')} ${slice('ocsNfd')}
    ${slice('mcSigReady')} ${slice('mcSigPanel')} ${slice('mcSigPair')} ${slice('mcSigImp')} ${slice('mcSigFirst')} ${slice('mcSigClock')}
    ${slice('mcSigEloRec')} ${slice('mcSigEloLast')} ${slice('mcSigEloStaleText')} ${slice('mcSigEloP')} ${slice('mcSigFair')} ${slice('mcSigElo')} ${slice('mcSigEloTitle')} ${slice('mcSigModelP')}
    ${slice('mcSigPolyUsd')} ${slice('mcSigLiqRec')} ${slice('mcSigSurKey')} ${slice('mcSigK')} ${slice('mcSigLast')} ${slice('mcSigPredRows')} ${slice('mcSigModelDress')} ${slice('mcSigRowHtml')} ${slice('mcSigBody')}
    return { mcSigPanel, mcSigBody };`)(opts);
  const names = h => [...h.matchAll(/mc-sg-name">([^<]*)</g)].map(x => x[1]);
  const EIGHT = ['Pinnacle', 'Bet105', 'Bet365', 'Elo Overall', 'Elo Hard', 'Stennisfy Model', 'Kalshi', 'Polymarket'];
  const up = { id: 'u1', p1: 'A. Rublev', p2: 'R. Safiullin', surface: 'hard', _oddsLoaded: true,
    pinnacleOpen: { p1: 1.6, p2: 2.44 }, bookOpens: { bet365: { p1: 1.57, p2: 2.37, seenAt: '2026-10-26T10:00:00Z' } },
    oddsMovement: { chart: { books: { Bet105: { p1: [['2026-10-25T10:00:00Z', 1.64]], p2: [['2026-10-25T10:00:00Z', 2.33]] } } } },
    valueSnapshot: { fairP1: 0.65, fairP2: 0.35, ts: '2026-10-26T01:00:00Z' } };
  const free = S().mcSigBody(up);
  assert.deepEqual(names(free), EIGHT);
  assert.match(free, /<div class="mc-sg-row mc-sg-lh"><span class="mc-sg-lc">Source<\/span><span class="mc-sg-hn a" title="A\. Rublev">Rublev<\/span><span><\/span><span class="mc-sg-hn b" title="R\. Safiullin">Safiullin<\/span><\/div>/, 'SOURCE · surnames centred over each player\'s two columns');
  assert.doesNotMatch(free, /Betfair|Consensus|Liquidity|Says| vs |agree|mc-sg-grp|BEST/i, 'no group heads, no tag on Upcoming');
  assert.match(free, /mc-sg-oa"><span class="mc-sg-o">1\.60<\/span><\/span><span class="mc-sg-pa lead">60%<\/span>/, 'open odds A, then the margin-removed implied %, the leaning side lead');
  assert.match(free, /<span class="mc-sg-pb">40%<\/span><span class="mc-sg-ob"><span class="mc-sg-o">2\.44</);
  assert.equal((free.match(/mc-sg-row mc-sg-lr rule/g) || []).length, 2, 'two hairlines only');
  assert.match(free, /mc-sg-lr rule"[^>]*><span class="mc-sg-src"><span class="mc-sg-nl"><span class="mc-sg-name">Elo Overall/);
  assert.match(free, /mc-sg-lr rule dash"[^>]*><span class="mc-sg-src"><span class="mc-sg-nl"><span class="mc-sg-name">Kalshi/);
  assert.equal((free.match(/class="mc-sg-row mc-sg-lr(?: rule)? dash(?: go)?"/g) || []).length, 3, 'Elo Hard (no surface rating) + Kalshi + Polymarket (no market) → dash rows, kept');
  assert.match(free, /title="Tennis Abstract weekly scrape · hElo · as of 2026-10-26 · win % → fair odds · no hard rating"/);
  assert.match(free, /title="Kalshi · no market for this match"/);
  assert.match(free, /title="Stennisfy model · Pro only · upgrade to see the model price"><span class="mc-sg-src"><span class="mc-sg-nl"><span class="mc-sg-name">Stennisfy Model<\/span><svg class="mc-sg-lock"/, 'non-Pro: a lock, no click');
  assert.match(free, /mc-sg-oa is-blur"><span class="mc-sg-o">1\.54</, 'Model → fair odds 1/p, blurred for a non-Pro member');
  const pro = S({ plan: 'pro' }).mcSigBody(up);
  assert.doesNotMatch(pro, /is-blur|mc-sg-lock/, 'Pro sees it');
  assert.match(pro, /class="mc-sg-row mc-sg-lr go"[^>]*role="button" tabindex="0" data-sig-model="u1"/, 'Pro: the model row opens the model page');
  assert.doesNotMatch(free, /data-sig-model/);
  const bare = S({ elo: { elo: {} } }).mcSigBody({ id: 'u2', p1: 'A', p2: 'B', surface: 'clay', _oddsLoaded: true });
  assert.equal((bare.match(/class="mc-sg-row mc-sg-lr(?: rule)? dash(?: go)?"/g) || []).length, 8, 'no source → eight dash rows, never a zero');
  assert.doesNotMatch(bare, />0\.00<|>0%</);
  assert.match(S().mcSigPanel({ id: 'u3', p1: 'A', p2: 'B' }), /Loading…/, 'not drawn before its sources load');
  // Completed (CHANGES §3): both players at the close, the winner's side lead, the Pinnacle close as a tick, BEST ×2
  const done = { id: 'c1', p1: 'M. Berrettini', p2: 'T. M. Etcheverry', surface: 'hard', finalScore: { winner: 'p1' }, __start: Date.parse('2026-10-26T12:00:00Z'),
    __pin: { p1: 1.58, p2: 2.6, source: 'Oddspapi' }, __ocs: { book: 'bet105', p1: { close: 1.575 }, p2: { close: 2.51 } }, __j: { p1: 1.53, p2: 2.5 },
    valueSnapshot: { fairP1: 0.64, fairP2: 0.36, ts: '2026-10-26T01:00:00Z' } };
  const d = S({ plan: 'pro' }).mcSigBody(done);
  assert.match(d, /<span class="mc-sg-lc">Source · at close<\/span><span class="mc-sg-hn a win" title="M\. Berrettini">Berrettini<\/span><span class="mc-sg-tklg" title="Pinnacle closing chance · M\. Berrettini 62% · T\. M\. Etcheverry 38%">\| = Pinnacle close<\/span><span class="mc-sg-hn b lose"/);
  assert.doesNotMatch(d, /Price on|won/);
  assert.deepEqual(names(d), EIGHT);
  assert.equal((d.match(/mc-sg-best"[^>]*>BEST/g) || []).length, 2, 'one BEST among the books, one among the ratings');
  assert.match(d, /Pinnacle<\/span><span class="mc-sg-best"/, 'the book that gave the winner the highest chance (Pinnacle 62.2% > Bet365 62.0% > Bet105 61.4%)');
  assert.match(d, /Stennisfy Model<\/span><span class="mc-sg-best"/, 'the only rating with a value');
  assert.match(d, /<span class="mc-sg-o lead">1\.58<\/span>/, 'winner\'s odds white 700');
  assert.match(d, /<span class="mc-sg-o">2\.60<\/span>/, 'loser\'s grey 500');
  const ticks = [...d.matchAll(/class="tk" style="left:([0-9.]+)%"/g)].map(x => x[1]);
  assert.equal(ticks.length, 4, 'a tick on every row with data (3 books + the model)');
  assert.ok(ticks.every(t => t === ticks[0]) && Math.abs(Number(ticks[0]) - 62.2) < 0.1, 'all at the Pinnacle close');
  assert.match(d, /<span class="a win" style="width:62\.2/);
  assert.equal((d.match(/class="mc-sg-row mc-sg-lr(?: rule)? dash(?: go)?"/g) || []).length, 4, 'Elo Overall + Elo Hard (no pre-match snapshot) + Kalshi + Polymarket');
  const dFree = S().mcSigBody(done);
  assert.equal((dFree.match(/mc-sg-best"[^>]*>BEST/g) || []).length, 1, 'a blurred model never carries BEST');
  assert.match(dFree, /is-blur/, 'non-Pro: the model is blurred on Completed too');
  const late = S({ plan: 'pro' }).mcSigBody(Object.assign({}, done, { valueSnapshot: { fairP1: 0.6, fairP2: 0.4, ts: '2026-10-26T13:00:00Z' } }));
  assert.equal((late.match(/class="mc-sg-row mc-sg-lr(?: rule)? dash(?: go)?"/g) || []).length, 5, 'a model read frozen after the start is not a pre-match snapshot');
  const noPin = S({ plan: 'pro' }).mcSigBody(Object.assign({}, done, { __pin: null }));
  assert.doesNotMatch(noPin, /class="tk"/, 'no Pinnacle close → no tick anywhere');
  assert.match(noPin, /title="No Pinnacle close stored for this match"/);
});
test('review 6/7/9: grid start; white caret in the reference font stack; one chip row with All first on both views', () => {
  assert.match(lastRule(`${M} .match-card .mc-msig .chev`), /font-family:'Hanken Grotesk', sans-serif;[^}]*color:var\(--text\)/);
  const chips = slice('buildTournamentFilters');
  assert.match(chips, /const allChip = `<button class="mx-chip/);
  assert.doesNotMatch(chips, /const allChip = completed/, 'not Completed-only any more');
});

// ── founder card 0b990217 (review 1–3): stats read only within-60 card-book closes ──
test('stats paths read _mcCardCloseDerivedOf (within-60), never the display close — EXCEPT the Move (TEN-403 founder 414de0fe: tile + Biggest-move sort rank every close the cards show)', () => {
  const body = slice('renderMatches');
  assert.match(body, /const bmv = mxCompletedBiggestMove\(filtered\);/, 'Completed Biggest market move tile');
  assert.match(slice('mxCompletedBiggestMove'), /const o = _openDerivedOf\(m, who\), c = _mcCardCloseOf\(m, who\);/, 'tile = the card\'s close');
  assert.match(slice('moveScore'), /const c1 = _mcCardCloseOf\(m, 'p1'\), c2 = _mcCardCloseOf\(m, 'p2'\);/, 'Biggest-move sort = the card\'s close');
  assert.match(slice('_mcOddsLanded'), /_mcCardCloseDerivedOf\(m, 'p1'\) != null \|\| _mcCardCloseDerivedOf\(m, 'p2'\) != null/);
  assert.match(slice('syncSortDropdown'), /const moveLanded = [\s\S]*?_mcCardCloseOf\(m, 'p1'\) != null \|\| _mcCardCloseOf\(m, 'p2'\) != null/);
  for (const fn of ['upsetScore', 'closingScore', 'marketWrongScore', 'mxJourney', '_mcOddsLanded'])
    assert.doesNotMatch(slice(fn), /_mcCardCloseOf\(|_mcCloseOf\(|_mcPinClose/, `${fn} never reads a display close`);
});

test('founder design 2026-11-07 §1/§4/§5: Completed rail stops at Today; favourite cards and the Pro model row are click targets', () => {
  const run = (view, day, dir) => new Function(`
    const state = { view: ${JSON.stringify(view)}, day: ${JSON.stringify(day)} };
    let rendered = 0; const renderMatches = () => { rendered++; }, setActiveButton = () => {};
    const document = { querySelector: () => ({}), getElementById: () => ({}) };
    const MX_RAIL_DAYS = ['daymin3', 'daymin2', 'yesterday', 'today', 'tomorrow', 'day2', 'day3'];
    ${slice('mxRailMaxIdx')} ${slice('stepDay')}
    stepDay(${dir}); return state.day;`)();
  assert.equal(run('completed', 'today', 1), 'today', 'Completed: no paging past Today');
  assert.equal(run('completed', 'yesterday', 1), 'today');
  assert.equal(run('completed', 'today', -1), 'yesterday');
  assert.equal(run('upcoming', 'today', 1), 'tomorrow', 'Upcoming pages forward as before');
  assert.match(slice('syncDayArrows'), /const atRightEdge = idx < 0 \|\| idx >= mxRailMaxIdx\(\);/, 'the forward arrow dims at Today on Completed');
  assert.match(slice('mxFavStripHtml'), /<div class="mx-favcard" data-id="\$\{psEsc\(m\.id\)\}" role="button" tabindex="0" title="Open match analysis">/);
  const fav = slice('mxFavCardGo');
  assert.match(fav, /if \(e\.target\.closest\('\[data-fav\]'\)\) return false;/, 'the star only toggles');
  assert.match(fav, /openAnalysisModal\(card\.getAttribute\('data-id'\), 'key'\)/, 'Key factors');
  assert.match(slice('mxSigModelGo'), /e\.stopPropagation\(\);\n  openEdgeModel\(row\.getAttribute\('data-sig-model'\)\);/);
  assert.match(lastRule(`${M} .mx-favcard:hover`), /border-color:var\(--edge-16\)/);
});
