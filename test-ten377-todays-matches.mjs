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
  ${/const MX_3DP_BELOW = [^;]+;/.exec(html)[0]}
  ${MX_BOOK_LABELS_SRC}
  const _mcNowPair = m => m.__pair || null;
  const _ocsOf = m => m.__ocs || null;
  const _mcCardCloseDerivedOf = (m, who) => (m.__pin ? m.__pin[who] : null);
  ${slice('mxOddsTxt')} ${slice('mcTitleAttr')} ${slice('oddsPctDelta')} ${slice('mxBookLabel')}
  ${slice('mcTiebreaks')} ${slice('mcSetIsWon')} ${slice('mcSetCluster')} ${slice('mcTermCell')} ${slice('mcJourney')}
  ${slice('mcUpsetRows')} ${slice('mcBoardBooks')}
  return { mcSetCluster, mcTermCell, mcJourney, mcUpsetRows, mcBoardBooks };
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
test('prices: Open → Close · Move on one grid; signed %, true minus; no journey bar', () => {
  const h = A.mcJourney(1.52, 1.38, false, {});
  assert.equal(h, '<span class="mc-px"><span class="mc-px__open">1.52</span><span class="mc-px__arr">→</span>'
    + '<span class="mc-px__close">1.38</span><span class="mc-px__move neg">−9%</span></span>');
  assert.match(A.mcJourney(2.60, 3.30, false, {}), /mc-px__move pos">\+27%/);
  assert.match(A.mcJourney(2.0, 2.0, false, {}), /mc-px__move">0%</, 'a genuine 0% move reads 0, never blank');
});

test('prices: no open -> "—" and no Move; vendor-pinned open -> no Move; older close -> white with Move', () => {
  const noOpen = A.mcJourney(null, 1.40, false, {});
  assert.match(noOpen, /mc-px__open mc-px__nodata">—/);
  assert.match(noOpen, /mc-px__move"><\/span>/);
  assert.match(A.mcJourney(null, null, false, {}), /mc-px__close mc-px__nodata">—/, 'missing close is a dash, never blank');
  assert.match(A.mcJourney(1.5, 1.6, true, {}), /mc-px__move"><\/span>/, 'TEN-198 anchorOnly');
  assert.match(A.mcJourney(1.5, 1.6, false, { closeOlder: true }), /mc-px__close">1\.60<\/span><span class="mc-px__move pos">\+7%/, 'TEN-377: an older close shows white with its Move');
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

test('header stats: Upsets = the same rule as the Upsets tile (winner closed longer, card-book within-60 closes)', () => {
  const m = (w, p1, p2) => ({ p1: 'A', p2: 'B', finalScore: { winner: w }, __pin: { p1, p2 } });
  const rows = A.mcUpsetRows([m('p1', 3.95, 1.26), m('p1', 1.38, 3.30), m('p2', 1.5, null), { p1: 'X' }]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { winner: 'A', loser: 'B', price: 3.95 });
  const tile = slice('renderMatches');
  assert.match(tile, /const upsetRows = mcUpsetRows\(filtered\);/, 'the tile reads the one shared rule');
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

test('header card: four stats, Hanken 10.5 caps labels (override), Plex Mono 17/700 values', () => {
  assert.match(html, /<div class="mx-hstats" id="mxHeaderStats"/);
  assert.match(lastRule(`${M} .mx-hstat__l`), /font-family:var\(--font-words\); font-size:10\.5px; font-weight:700; letter-spacing:0\.10em; text-transform:uppercase; color:var\(--text-label\)/);
  assert.match(lastRule(`${M} .mx-hstat__v`), /font-family:var\(--font-nums\); font-size:17px; font-weight:700; color:var\(--text\)/);
  assert.match(lastRule(`${M} .mx-hstats`), /gap:34px/);
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
    const _mcNowPair = m => m.__pair || null; const _ocsOf = () => null;
    const _mcCardCloseDerivedOf = (m, who) => (m.__pin ? m.__pin[who] : null);
    ${MX_BOOK_LABELS_SRC}
    ${slice('mxBookLabel')} ${slice('mcUpsetRows')} ${slice('mcBoardBooks')} ${slice('mcRenderHeaderStats')}
    mcRenderHeaderStats(list); return el.innerHTML;`)(list, view, up, tz);
  const vals = h => [...h.matchAll(/mx-hstat__l">([^<]*)<\/span><span class="mx-hstat__v">([^<]*)</g)].map(x => x[1] + '=' + x[2]);
  const up = [{ tour: 'ATP Tokyo', bookNow: { Pncl: {} } }, { tour: 'ATP Beijing', bookOpens: { Pinnacle: {}, Betano: {} } }];
  assert.deepEqual(vals(run('upcoming', up, Date.parse('2026-10-03T02:10:05Z'))), ['Matches=2', 'Tournaments=2', 'Books=2', 'Updated=10:10']);
  const done = [{ tour: 'ATP Tokyo', p1: 'A', p2: 'B', finalScore: { winner: 'p1' }, __pin: { p1: 3.9, p2: 1.3 } }, { tour: 'ATP Tokyo' }];
  assert.deepEqual(vals(run('completed', done, null)), ['Settled=1', 'Tournaments=1', 'Upsets=1', 'Updated=—'], 'no clock -> dash, a count of 0 stays 0');
  assert.match(vals(run('upcoming', up, Date.parse('2026-10-03T02:10:05Z'), 'Not/AZone'))[3], /^Updated=\d\d:\d\d$/, 'a bad stored zone falls back, never throws');
});

// ── founder review ba49d5fc (2026-10-03) items 4–9 ──
test('review 4/8: Completed and Upcoming always draw three tiles; an empty tile says so in one grey line; no provenance line', () => {
  const body = slice('renderMatches');
  for (const t of ['No market moves', 'No upsets', 'Not enough pick history yet', 'No prices yet'])
    assert.ok(body.includes(t), `empty line "${t}"`);
  assert.doesNotMatch(body, /mc-story__faint|mcMoveBookLabel|The rolling record shows/);
  assert.doesNotMatch(body, /sp\.book \? ' · ' \+ sp\.book/, 'no "· book" suffix');
  assert.match(body, /const stripHtml = `<div class="mc-story-strip">\$\{panels\.join\(''\)\}<\/div>`;/, 'Completed strip is unconditional');
});
test('review 5: the Market Signal drawer draws only rows with data, only groups with rows, no explainer', () => {
  const S = new Function(`${MX_BOOK_LABELS_SRC} ${slice('mxBookLabel')} ${slice('mcSigPanel')}; return mcSigPanel;`)();
  const up = S({ p1: 'A. Rublev', p2: 'R. Safiullin', odds: { p1: 1.69, p2: 2.27, bookmaker: 'Betano' } });
  assert.match(up, /Sharp estimates/);
  assert.doesNotMatch(up, /Market money|Stennisfy|Polymarket|Kalshi|—|never invented|mc-sig-note/);
  assert.equal((up.match(/class="mc-sig-row"/g) || []).length, 1);
  // TEN-384 item 6: the row names the book in the house style, through the real map.
  for (const [raw, shown] of [['Pncl', 'Pinnacle'], ['WilliamHill', 'William Hill'], ['Bet365', 'bet365'], ['1xBet', '1xBet'], ['Betano', 'Betano']]) {
    const h = S({ p1: 'A', p2: 'B', odds: { p1: 1.5, p2: 2.6, bookmaker: raw } });
    assert.match(h, new RegExp('mc-sig-dotm"></span>' + shown.replace('.', '\\.') + '</span>'), `${raw} -> ${shown}`);
  }
  const none = S({ p1: 'A', p2: 'B', odds: null });
  assert.match(none, /No market signal for this match yet/);
  assert.doesNotMatch(none, /Sharp estimates|mc-sig-row/);
  const done = S({ p1: 'A', p2: 'B', odds: { p1: 1.5, p2: 2.6, bookmaker: '1xBet' }, finalScore: {} });
  assert.doesNotMatch(done, /grouplabel|Liquidity/, 'Completed: one flat list');
});
test('review 6/7/9: grid start; white caret in the reference font stack; one chip row with All first on both views', () => {
  assert.match(lastRule(`${M} .match-card .mc-msig .chev`), /font-family:'Hanken Grotesk', sans-serif;[^}]*color:var\(--text\)/);
  const chips = slice('buildTournamentFilters');
  assert.match(chips, /const allChip = `<button class="mx-chip/);
  assert.doesNotMatch(chips, /const allChip = completed/, 'not Completed-only any more');
});

// ── founder card 0b990217 (review 1–3): stats read only within-60 card-book closes ──
test('stats paths read _mcCardCloseDerivedOf (within-60), never the display close', () => {
  const body = slice('renderMatches');
  assert.match(body, /const moveCloseOf = \(m, who\) => \(m\.finalScore \? _mcCardCloseDerivedOf\(m, who\) : null\);/, 'Completed Biggest market move tile');
  assert.match(slice('_mcOddsLanded'), /_mcCardCloseDerivedOf\(m, 'p1'\) != null \|\| _mcCardCloseDerivedOf\(m, 'p2'\) != null/);
  assert.match(slice('syncSortDropdown'), /const moveLanded = [\s\S]*?_mcCardCloseDerivedOf\(m, 'p1'\) != null \|\| _mcCardCloseDerivedOf\(m, 'p2'\) != null/);
  for (const fn of ['upsetScore', 'closingScore', 'moveScore', 'marketWrongScore', 'mcUpsetRows', '_mcOddsLanded'])
    assert.doesNotMatch(slice(fn), /_mcCardCloseOf\(|_mcCloseOf\(|_mcPinClose/, `${fn} never reads a display close`);
});
