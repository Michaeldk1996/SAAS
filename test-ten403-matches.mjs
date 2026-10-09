// TEN-403 — Today's Matches parts 3, 4, 5 of the founder's Shell refresh (PROMPT_SHELL.md):
// the 39b insight tiles + the Biggest-market-move view, the odds-movement pop-up's move, and
// favourites (star, strip, persistence).
//
// The page code is SLICED out of the shipped files and EXECUTED over stubbed inputs (the same
// method as test-ten377); the CSS checks read the last rule that wins for each selector. Every
// group ends with a mutant the assertions must catch, so a check that stopped reading the file
// goes red instead of passing.
//
// Run: node --test test-ten403-matches.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const authSrc = readFileSync(join(HERE, 'auth.js'), 'utf8');
const require = createRequire(import.meta.url);

function slice(name, src = html) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}
function lastRule(sel, src = html) {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const all = [...src.matchAll(new RegExp(esc + '\\{([^}]*)\\}', 'g'))];
  assert.ok(all.length, `no rule for ${sel}`);
  return all[all.length - 1][1];
}
const M = '[data-page="matches"]';

// ── part 3 · the move formula ────────────────────────────────────────────────────────────
const movePct = src => new Function(`${slice('mxMovePct', src)}; return mxMovePct;`)();
const mxMovePct = movePct(html);

test('move formula: (now / open − 1) × 100, one decimal, explicit sign, TRUE minus; zero = grey ±0.0%', () => {
  assert.deepEqual(mxMovePct(2.36, 2.45), { v: 3.8, dir: 'pos', text: '+3.8%' });
  assert.deepEqual(mxMovePct(1, 1.125), { v: 13, dir: 'pos', text: '+13.0%' });   // 1.00 → 1.13 as shown (TEN-403 R1)
  assert.deepEqual(mxMovePct(2.0, 1.6), { v: -20, dir: 'neg', text: '−20.0%' });   // U+2212, never '-'
  assert.equal(mxMovePct(5.27, 5.15).text, '−2.3%');
  assert.deepEqual(mxMovePct(1.15, 1.15), { v: 0, dir: '', text: '±0.0%' });
  assert.equal(mxMovePct(1.5, 1.5004).text, '±0.0%', 'a move that rounds to 0.0 is the zero state, no sign colour');
  for (const [o, n] of [[null, 2], [2, null], [0, 2], [2, 0], [undefined, 2]])
    assert.equal(mxMovePct(o, n), null, `${o} → ${n} is not a move`);
});

test('MUTANTS: a hyphen minus, or a whole-percent round, is caught', () => {
  const hyphen = movePct(html.replace("(v > 0 ? '+' : '−')", "(v > 0 ? '+' : '-')"));
  assert.notEqual(hyphen(2.0, 1.6).text, mxMovePct(2.0, 1.6).text);
  const whole = movePct(html.replace('Math.sign(r) * Math.round(Math.abs(r)) / 10', 'Math.sign(r) * Math.round(Math.abs(r) / 10)'));
  assert.notEqual(whole(1.28, 1.34).text, '+4.7%');
});

test('one formula: the tile and the pop-up both call mxMovePct', () => {
  const body = slice('renderMatches');
  assert.match(body, /const d1 = mxMovePct\(p\.o1, p\.n1\), d2 = mxMovePct\(p\.o2, p\.n2\);/, 'the Biggest-market-move tile');
  assert.match(body, /const s = moveNowScore\(m\);/, 'the tile ranks on the sort\'s own score');
  assert.match(slice('moveNowScore'), /const a = mxMovePct\(p\.o1, p\.n1\), b = mxMovePct\(p\.o2, p\.n2\);/, 'the sort');
  const phb = readFileSync(join(HERE, 'price-history-box.js'), 'utf8');
  assert.match(phb, /if \(typeof mxMovePct === 'function'\) return mxMovePct\(open, now\);/, 'the odds pop-up');
});

// ── TEN-403 R1 · item 1: the move is computed on the prices AS SHOWN (2 dp) ────────────────
// Founder review 2026-10-09: "Compute the move from the open and now prices exactly as the card shows
// them (2 dp)". His seven expected values, verbatim.
const FOUNDER_R1 = [[1.28, 1.34, '+4.7%'], [1.37, 1.43, '+4.4%'], [1.09, 1.11, '+1.8%'], [1.41, 1.38, '−2.1%'],
  [1.33, 1.38, '+3.8%'], [1.59, 1.55, '−2.5%'], [1.78, 1.85, '+3.9%']];
// Unrounded quotes behind those cards (what the old formula divided): each prints as the founder's pair.
const RAW_R1 = [[1.282, 1.341, '+4.7%'], [1.372, 1.431, '+4.4%'], [1.092, 1.114, '+1.8%'], [1.412, 1.379, '−2.1%'],
  [1.334, 1.380, '+3.8%'], [1.594, 1.551, '−2.5%'], [1.781, 1.847, '+3.9%']];

test("TEN-403 R1: the founder's seven moves come out exactly", () => {
  for (const [o, n, want] of FOUNDER_R1) assert.equal(mxMovePct(o, n).text, want, `${o} → ${n}`);
});

test('TEN-403 R1: the rounding is INSIDE mxMovePct — unrounded quotes give the move of the digits shown', () => {
  const { mxOddsTxt } = new Function(`${slice('mxOddsTxt')}; return { mxOddsTxt };`)();
  for (const [o, n, want] of RAW_R1) {
    assert.equal(mxMovePct(o, n).text, want, `${o} → ${n} (shows ${mxOddsTxt(o)} → ${mxOddsTxt(n)})`);
    assert.equal(mxMovePct(o, n).text, mxMovePct(+mxOddsTxt(o), +mxOddsTxt(n)).text, 'raw = as shown');
  }
  // a half rounds away from zero, symmetric in sign: 2.00 → 2.045 shows 2.05 (+2.5%); 2.00 → 1.95 −2.5%
  assert.equal(mxMovePct(2, 1.95).text, '−2.5%');
  assert.equal(mxMovePct(1.6, 1.564).text, '−2.5%', '1.60 → 1.56 = −2.5% exactly');
});

test('MUTANT: the pre-R1 formula on the unrounded quotes misses the founder values', () => {
  const pre = movePct(html.replace(
    'const r = (n2 - o2) * 1000 / o2;', 'const r = (now / open - 1) * 1000;'));
  const missed = RAW_R1.filter(([o, n, want]) => pre(o, n).text !== want);
  assert.ok(missed.length >= 5, `the unrounded formula should miss most of them, missed ${missed.length}`);
});

// ── part 3 · the move view: columns and cells ────────────────────────────────────────────
const cellApi = src => new Function(`
  ${slice('mxOddsTxt', src)} ${slice('mcTitleAttr', src)} ${slice('mxMovePct', src)} ${slice('mcDriftCell', src)}
  return { mcDriftCell };`)();
const { mcDriftCell } = cellApi(html);
const cells = h => [...h.matchAll(/<span class="(mc-drifted__\w+)([^"]*)"[^>]*>([^<]*)<\/span>/g)].map(m => [m[1], m[2].trim(), m[3]]);

test('move view cells: Open · → · Now · Move, signed move only on a measurable pair', () => {
  assert.deepEqual(cells(mcDriftCell(2.36, 2.45, false, { paired: true })),
    [['mc-drifted__open', '', '2.36'], ['mc-drifted__arr', '', '→'], ['mc-drifted__now', '', '2.45'], ['mc-drifted__pct', 'pos', '+3.8%']]);
  assert.deepEqual(cells(mcDriftCell(1.54, 1.50, false, { paired: true }))[3], ['mc-drifted__pct', 'neg', '−2.6%']);
  assert.deepEqual(cells(mcDriftCell(1.50, 1.50, false, { paired: true }))[3], ['mc-drifted__pct', '', '±0.0%'], 'zero: grey ±');
  // `—` (not a blank) whenever no move can be measured
  assert.deepEqual(cells(mcDriftCell(1.72, 1.80, false, { paired: false }))[3], ['mc-drifted__pct', '', '—'], 'no same-book pair');
  assert.deepEqual(cells(mcDriftCell(1.72, 1.80, true, { paired: true }))[3], ['mc-drifted__pct', '', '—'], 'TEN-198 vendor-pinned open');
  assert.deepEqual(cells(mcDriftCell(1.72, 1.80, false, { paired: true, nowOlder: true }))[3], ['mc-drifted__pct', '', '—'], 'TEN-253 older close');
  const noOpen = cells(mcDriftCell(null, 1.80, false, { paired: false }));
  assert.deepEqual(noOpen[0], ['mc-drifted__open', 'nodata', '—'], 'no opening price: the Open is a dash, never derived from Now');
  assert.deepEqual(noOpen[3], ['mc-drifted__pct', '', '—']);
  assert.deepEqual(cells(mcDriftCell(1.72, null, false, { paired: true }))[2], ['mc-drifted__now', 'nodata', '—']);
});

test('move view columns: head + rows on 56px 14px 60px 48px at gap 10; row = name · 1px · block', () => {
  assert.match(slice('renderMatches'), /<span class="mc-colhead-drift"><span>Open<\/span><span><\/span><span>Now<\/span><span>Move<\/span><\/span>/);
  assert.match(slice('renderMatches'), /<div class="mc-players up\$\{mxDriftView\(\) \? ' mv' : ''\}">/);
  for (const sel of [`${M} .mc-drifted`, `${M} .mc-colhead-drift`])
    assert.match(lastRule(sel), /grid-template-columns:56px 14px 60px 48px; gap:0 10px;/, sel);
  assert.match(lastRule(`${M} .mc-colhead-drift span`), /text-align:right/);
  assert.match(lastRule(`${M} .mc-players.up.mv .mc-row`), /grid-template-columns:minmax\(0,1fr\) 1px 208px; gap:0 10px;/);
  assert.match(html, /\[data-page="matches"\] \.mc-drifted__open\{ font-family:var\(--font-nums\); font-size:13px; font-weight:500; color:var\(--text-label\)/);
  assert.match(lastRule(`${M} .mc-drifted__arr`), /font-size:12px; color:var\(--text-label\)/);
  assert.match(html, /\[data-page="matches"\] \.mc-drifted__now\{ font-family:var\(--font-nums\); font-size:19px; font-weight:800; color:var\(--text\)/);
  assert.match(lastRule(`${M} .mc-drifted__pct`), /font-size:12px; font-weight:700; color:var\(--text-label\)/);
  assert.match(lastRule(`${M} .mc-drifted__pct.pos`), /color:var\(--pos\)/);
  assert.match(lastRule(`${M} .mc-drifted__pct.neg`), /color:var\(--neg\)/);
});

test('MUTANT: a cell that prints the move off an unpaired leg is caught', () => {
  const bad = cellApi(html.replace('!anchorOnly && o.paired && !o.nowOlder', '!anchorOnly && !o.nowOlder')).mcDriftCell;
  assert.notDeepEqual(cells(bad(1.72, 1.80, false, { paired: false }))[3], ['mc-drifted__pct', '', '—']);
});

// ── part 3 · the order: biggest |move| first, `—` last, nothing dropped ──────────────────
const driftBranch = src => {
  const gf = slice('getFiltered', src);
  const at = gf.indexOf("else if (state.sort === 'drift'){");
  assert.ok(at > 0, 'drift branch not found');
  let depth = 0, i = gf.indexOf('{', at);
  for (; i < gf.length; i++) { if (gf[i] === '{') depth++; else if (gf[i] === '}') { depth--; if (depth === 0) break; } }
  return gf.slice(gf.indexOf('{', at) + 1, i);
};
const sorter = src => new Function('out', `
  const MOVE_NONE = -1, MOVE_UNPRICED = -2;
  const _ocsOf = m => null, _mcNowPair = m => m.__nowPair || null;
  const _openAnchorOf = (m, who) => (m.__open ? m.__open[who] ?? null : null);
  const _mcNowOf = (m, who) => (m.__now ? m.__now[who] ?? null : null);
  const _mcOpenNowPair = m => m.__pair || null;
  const cardStartMs = m => m.__t;
  ${slice('_mcHasAnyPrice', src)} ${slice('mxMovePct', src)} ${slice('moveNowScore', src)}
  ${driftBranch(src)}
  return out;`);
const card = (id, t, pair, extra = {}) => Object.assign({ id, time: '', __t: t, __pair: pair }, extra);
const BOARD = () => [
  card('early-dash', 1, null, { __now: { p1: 1.8, p2: 2.0 }, __open: { p1: 1.72, p2: 2.1 } }),   // vendor open: `—`
  card('small', 2, { o1: 2.36, o2: 1.54, n1: 2.45, n2: 1.55 }),                                       // 3.8%
  card('unpriced', 3, null),                                                                          // dash / dash
  card('big-p2', 4, { o1: 1.50, o2: 2.50, n1: 1.45, n2: 3.10 }),                                      // 24% on the 2nd player
  card('flat', 5, { o1: 5.5, o2: 1.1, n1: 5.5, n2: 1.1 }),                                            // 0%
  card('late-dash', 6, null, { __now: { p1: 1.2, p2: 4.0 } }),
];

test('order: biggest |move| on either player first, then 0%, then `—` (time order), unpriced last; every card kept', () => {
  const out = sorter(html)(BOARD());
  assert.deepEqual(out.map(m => m.id), ['big-p2', 'small', 'flat', 'early-dash', 'late-dash', 'unpriced']);
  assert.equal(out.length, BOARD().length, 'the move view drops nothing');
  assert.doesNotMatch(slice('getFiltered'), /\.filter\(mxMoved\)/);
});

test('MUTANT: without the time tie-break the `—` cards keep feed order', () => {
  const noTie = html.replace('(sc.get(b) - sc.get(a)) || (cardStartMs(a) - cardStartMs(b)) || ', '(sc.get(b) - sc.get(a)) || 0 || ');
  assert.notEqual(noTie, html);
  const board = BOARD(); board.reverse();
  const out = sorter(noTie)(board).map(m => m.id);
  assert.notDeepEqual(out.slice(3, 5), ['early-dash', 'late-dash']);
});

// ── TEN-403 R1 · the sort and the tile rank on the SHOWN move, tie → earlier start ──────────────
test('TEN-403 R1: the sort ranks on the shown move — +4.7% (shows 1.28→1.34) above +4.4% (unrounded 4.6 vs 4.3 too), a tie keeps time order', () => {
  // a: raw 1.284→1.343 = +4.6% unrounded, shows 1.28→1.34 = +4.7%; b: raw 1.374→1.437 = +4.59% unrounded, shows 1.37→1.44 = +5.1%
  const a = card('a', 2, { o1: 1.284, o2: 3, n1: 1.343, n2: 3 });
  const b = card('b', 3, { o1: 1.374, o2: 3, n1: 1.437, n2: 3 });
  const c = card('c', 1, { o1: 1.28, o2: 3, n1: 1.34, n2: 3 });   // the same shown +4.7% as a, starts earlier
  const out = sorter(html)([a, b, c]).map(m => m.id);
  assert.deepEqual(out, ['b', 'c', 'a'], 'ranked on 5.1 > 4.7 = 4.7, the tie by start');
  // MUTANT: the old unrounded score splits the a/c tie on hidden digits and reorders a/b
  const unrounded = html.replace('return Math.max(Math.abs(a.v), Math.abs(b.v));', 'return Math.max(Math.abs(p.n1 / p.o1 - 1), Math.abs(p.n2 / p.o2 - 1));');
  assert.notEqual(unrounded, html);
  assert.notDeepEqual(sorter(unrounded)([a, b, c]).map(m => m.id), out);
});

// The tile's own code, cut out of renderMatches and run: it must name a leg of the match the sort puts first.
const tileApi = src => {
  const body = slice('renderMatches', src);
  const a = body.indexOf('    let bmv = null, bmvPairs = 0;'), b = body.indexOf('    // TEN-377 review item 8');
  assert.ok(a > 0 && b > a, 'tile block not found');
  return daySlate => new Function('daySlate', `
    const MOVE_NONE = -1, MOVE_UNPRICED = -2;
    const _ocsOf = m => null, _mcNowPair = m => null, _openAnchorOf = () => null, _mcNowOf = () => null;
    const _mcOpenNowPair = m => m.__pair || null;
    const cardStartMs = m => m.__t;
    const roundBadgeText = r => r || '';
    ${slice('_mcHasAnyPrice', src)} ${slice('mxMovePct', src)} ${slice('moveNowScore', src)}
    ${body.slice(a, b)}
    return bmv;`)(daySlate);
};
test('TEN-403 R1: the tile names a leg of the match the sort puts first (shown figure, start-time tie-break)', () => {
  const tile = tileApi(html);
  const mk = (id, t, pair) => Object.assign(card(id, t, pair), { p1: id + '-1', p2: id + '-2' });
  // late: raw +4.6% unrounded but shows +4.7%; early: the same shown +4.7% on player 2, earlier start
  const board = [mk('late', 9, { o1: 1.284, o2: 2, n1: 1.343, n2: 2 }), mk('early', 4, { o1: 2, o2: 1.28, n1: 2, n2: 1.34 }),
                 // mid: shows 1.37 → 1.43 = +4.4%, but its unrounded quotes are +4.98% — the old tile's pick
                 mk('mid', 1, { o1: 1.366, o2: 2, n1: 1.434, n2: 2 })];
  const t = tile(board);
  const first = sorter(html)(board.slice())[0];
  assert.equal(t.m, first, 'the tile and the sort agree on the top match');
  assert.equal(t.name, 'early-2', 'the leg that carries the move');
  assert.equal(t.d.text, '+4.7%');
  assert.equal(tile([mk('flat', 1, { o1: 1.5, o2: 2, n1: 1.5004, n2: 2.001 })]), null, 'a shown 0.0% board has no headline');
  // MUTANT: the pre-R1 tile ranked on the unrounded |c/o − 1| with no tie-break → names "late"
  const pre = html.replace('const s = moveNowScore(m);', 'const s = Math.max(Math.abs(p.n1 / p.o1 - 1), Math.abs(p.n2 / p.o2 - 1)) * 100;');
  assert.notEqual(pre, html);
  assert.equal(tileApi(pre)(board).m.id, 'mid', 'the mutant names the card the sort does not put first');
});

// ── part 3 · the 39b tiles ───────────────────────────────────────────────────────────────
test('tiles: Biggest market move is a toggle with the hint swap; edge 7% → hover 16% → on 24%', () => {
  const body = slice('renderMatches');
  assert.match(body, /\$\{driftOn \? 'Showing open → now · biggest first' : 'Show open → now'\}/);
  assert.match(body, /<div class="mc-story-strip mc-story-strip--up">/);
  assert.match(body, /<span class="mc-story__open">\$\{mxOddsTxt\(bmv\.o\)\}<\/span><span class="mc-story__arr">→<\/span><span class="mc-story__now">\$\{mxOddsTxt\(bmv\.c\)\}<\/span><span class="mc-story__pct \$\{bmv\.d\.dir\}">/);
  assert.match(body, /\$\{bmvPairs \? 'No market moves' : 'No opening prices on file'\}/);
  assert.match(lastRule(`${M} .mc-story-strip--up > .mc-story`), /padding:14px 18px 15px; border:1px solid var\(--edge-7\)/);
  assert.match(lastRule(`${M} .mc-story-strip--up > .mc-story--click.is-on`), /border-color:var\(--edge-24\)/);
  assert.match(lastRule(`${M} .mc-story-strip--up > .mc-story--click:hover`), /border-color:var\(--edge-16\)/);
  // hover is declared AFTER on, so hovering an on tile reads 16% (reference)
  assert.ok(html.indexOf(`${M} .mc-story-strip--up > .mc-story--click:hover`) > html.indexOf(`${M} .mc-story-strip--up > .mc-story--click.is-on`));
  assert.match(lastRule(`${M} .mc-story__hint`), /font-size:11px; font-weight:600; color:var\(--text-label\)/);
  assert.match(lastRule(`${M} .mc-story--click.is-on .mc-story__hint`), /color:var\(--text\)/);
  assert.match(lastRule(`${M} .mc-story__open`), /font-size:22px; font-weight:700; color:var\(--text-label\)/);
  assert.match(lastRule(`${M} .mc-story__now`), /font-size:22px; font-weight:800; color:var\(--text\)/);
  assert.match(lastRule(`${M} .mc-story__pct`), /font-size:13px; font-weight:700/);
  assert.match(lastRule(`${M} .mc-story-strip--up .mc-story__ctx`), /white-space:nowrap; overflow:hidden; text-overflow:ellipsis/);
  assert.match(lastRule(`${M} .mc-story-strip--up .mc-story__tname`), /font-size:14px; font-weight:700; color:var\(--text\)/);
  // the tiles sit below the date row and above the filter / search row
  const slot = html.indexOf('id="mcSummaryStrip"');
  assert.ok(html.indexOf('class="mx-daytabsrow"') < slot && slot < html.indexOf('<div class="mx-filterbar">'));
});

// ── part 4 · the pop-up's move reads the card's pair ─────────────────────────────────────
test('pop-up: an Upcoming % needs the same measurable pair as the card (no pair → no %), one formula', () => {
  const B = require('./price-history-box.js');
  try {
    globalThis.mxMovePct = mxMovePct;
    globalThis._mcOpenNowPair = () => null;
    assert.equal(B.cardData({ openingOdds: { bookmaker: 'bet105' } }, 'p1').pctOk, false, 'no pair: the card dashes, so does the pop-up');
    globalThis._mcOpenNowPair = () => ({ o1: 2, o2: 2, n1: 1.6, n2: 2.4 });
    assert.equal(B.cardData({ openingOdds: { bookmaker: 'bet105' } }, 'p1').pctOk, true, 'CONTROL: a pair shows its %');
    const base = { book: 'Bet105', open: { price: 1.5, at: '2026-10-08T01:00:00Z' }, historyAvailable: true, now: 1.5 };
    assert.match(B.html(B.model(base, [], [])), /<span class="phb-pct">±0\.0%<\/span>/, 'the pop-up prints the page formula');
  } finally { delete globalThis.mxMovePct; delete globalThis._mcOpenNowPair; }
});

// ── part 5 · favourites ──────────────────────────────────────────────────────────────────
const FAV_FNS = ['psEsc', 'eventKeyOfMatch', 'mxFavKey', 'mxFavClean', 'mxFavReadLocal', 'mxFavWriteLocal', 'mxFavMerge',
  'mxFavSettled', 'mxFavPrune', 'mxFavHas', 'mxFavPersist', 'mxFavToggle', 'mxFavOnAuth', 'mxFavSettleClear',
  'mxFavStarSvg', 'mxFavStarHtml', 'mxFavStripHtml'];
function favApi({ ls = {}, bsp = null, src = html } = {}) {
  const store = new Map(Object.entries(ls));
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const consts = [/const MX_FAV_LS = [^;]+;/, /const MX_FAV_STAR_PATH = [^;]+;/, /const mxFav = [^;]+;/].map(r => r.exec(src)[0]).join('\n');
  const api = new Function('localStorage', 'window', `
    const state = { day: 'today', view: 'upcoming' };
    const cardStartMs = m => m.__t;
    const _mcNowPair = m => m.__pair || null;
    const roundBadgeText = r => r || '';
    const cardFmtStart = (m, withDate) => (withDate ? '9 Oct ' : '') + (m.__hm || '');
    const matchDayBucket = m => m.__day || 'today';
    ${slice('mxOddsTxt', src)}
    ${FAV_FNS.map(n => slice(n, src)).join('\n')}
    ${consts}
    return { mxFav, ${FAV_FNS.join(', ')} };`)(localStorage, { BSP: bsp });
  return Object.assign(api, { store });
}
const LS = 'stennisfy.favourites';
const fakeBsp = (fail = false) => {
  const calls = [];
  return { calls, updateProfile: patch => { calls.push(patch); return fail ? Promise.reject(new Error('offline')) : Promise.resolve({}); } };
};

test('the key survives a refresh and settling: upcoming-123 and past-123 are one favourite', () => {
  const F = favApi();
  assert.equal(F.mxFavKey({ id: 'upcoming-12169127' }), '12169127');
  assert.equal(F.mxFavKey({ id: 'past-12169127' }), '12169127');
  assert.equal(F.mxFavKey({ id: '0f3c9a' }), '0f3c9a', 'a hash id is its own key');
});

test('nothing is starred by default; star states and tooltips', () => {
  const F = favApi();
  assert.deepEqual(F.mxFav.keys, []);
  const idle = F.mxFavStarHtml({ id: 'upcoming-1' });
  assert.match(idle, /class="mc-star" data-fav="1" title="Add to favourites" aria-label="Add to favourites" aria-pressed="false"/);
  F.mxFavToggle('1');
  assert.match(F.mxFavStarHtml({ id: 'upcoming-1' }), /class="mc-star is-on" data-fav="1" title="Remove from favourites"/);
  assert.match(slice('renderMatches'), /<div class="mc-head">\s*\$\{isCompleted \? '' : mxFavStarHtml\(m\)\}\s*<span class="mc-surface/, 'the star is the FIRST item of an Upcoming header');
  assert.match(lastRule(`${M} .match-card .mc-star`), /width:24px; height:24px; margin:-4px 0 -4px -6px; padding:0; border:0; border-radius:7px;/);
  assert.match(lastRule(`${M} .match-card .mc-star:hover`), /background:var\(--inner\)/);
  assert.match(lastRule(`${M} .mc-star path, ${M} .mx-favcard__star path`), /stroke:currentColor; stroke-width:1\.5/);
  assert.match(lastRule(`${M} .mc-star.is-on path, ${M} .mx-favcard__star path`), /fill:currentColor/);
});

test('strip: hidden when nothing is starred (no empty state), else "Favourites · N" mini cards in start order', () => {
  const F = favApi();
  const board = [
    { id: 'upcoming-9', p1: 'J. Sinner', p2: 'C. Alcaraz', tour: 'ATP Shanghai', tournamentRound: 'QF', __t: 9, __hm: '18:00', __pair: { p1: 1.39, p2: 3.55 } },
    { id: 'upcoming-5', p1: 'C. Ugo Carabelli', p2: 'F. Cobolli', tour: 'ATP Shanghai', tournamentRound: 'R32', __t: 5, __hm: '13:15', __pair: null },
    { id: 'past-7', p1: 'A', p2: 'B', finalScore: { winner: 'p1' }, __t: 1 },
  ];
  assert.equal(F.mxFavStripHtml(board), '', 'nothing starred: no strip at all');
  F.mxFav.keys.push('7');
  assert.equal(F.mxFavStripHtml(board), '', 'only a settled match starred: still no strip');
  F.mxFav.keys.push('9', '5');
  const h = F.mxFavStripHtml(board);
  assert.match(h, /^<span class="mx-favstrip__lbl">Favourites · 2<\/span><div class="mx-favstrip__row">/);
  assert.ok(h.indexOf('C. Ugo Carabelli') < h.indexOf('J. Sinner'), 'start-time order, not star order');
  assert.match(h, /<span class="mx-favcard__where">ATP Shanghai · QF · 18:00<\/span><button type="button" class="mx-favcard__star" data-fav="9" title="Remove from favourites"/);
  assert.match(h, /<div class="mx-favcard__row a"><span class="mx-favcard__name">J\. Sinner<\/span><span class="mx-favcard__px">1\.39<\/span><\/div>/);
  assert.match(h, /<div class="mx-favcard__row b"><span class="mx-favcard__name">F\. Cobolli<\/span><span class="mx-favcard__px">—<\/span><\/div>/, 'no price = —');
  assert.match(lastRule(`${M} .mx-favstrip:empty`), /display:none/);
  assert.match(lastRule(`${M} .mx-favcard`), /width:272px; box-sizing:border-box; display:flex; flex-direction:column; gap:7px; padding:10px 14px 11px;/);
  assert.match(lastRule(`${M} .mx-favstrip__row`), /display:flex; gap:10px; padding:0 0 2px; overflow-x:auto/);
  assert.match(lastRule(`${M} .mx-favcard__px`), /font-size:14px; font-weight:800/);
  // above the match grid, below the filter row; Upcoming only
  const at = html.indexOf('id="mxFavStrip"');
  assert.ok(html.indexOf('<div class="mx-filterbar">') < at && at < html.indexOf('<div id="matchlist">'));
  assert.match(slice('mxFavRenderStrip'), /state\.view === 'completed' \? '' : mxFavStripHtml\(matches\)/);
});

test('settle-clear: a starred match that settled leaves the list and the store; an absent one is kept', () => {
  const F = favApi({ ls: { [LS]: JSON.stringify(['7', '9', '404', '11']) } });
  assert.deepEqual(F.mxFav.keys, ['7', '9', '404', '11'], 'signed out: the local list');
  const board = [
    { id: 'past-7', finalScore: { winner: 'p1' } },             // settled
    { id: 'upcoming-9' },                                       // still to play
    { id: 'upcoming-11', live: true, finalScore: { winner: 'p2' } },   // live: not settled yet
  ];
  assert.equal(F.mxFavSettleClear(board), true);
  assert.deepEqual(F.mxFav.keys, ['9', '404', '11']);
  assert.equal(F.store.get(LS), JSON.stringify(['9', '404', '11']), 'the store is rewritten');
  assert.equal(F.mxFavSettleClear(board), false, 'nothing more to clear: no write');
  assert.equal(F.mxFavSettleClear([]), false, 'an empty (unloaded) board clears nothing');
  assert.deepEqual(F.mxFavPrune(['3'], [{ id: 'past-3', walkover: true }]), [], 'a walkover is settled');
  assert.deepEqual(F.mxFavPrune(['3'], [{ id: 'past-3', retired: true }]), [], 'a retirement is settled');
});

test('signed out → signed in: the local list merges into the account, is written once, then emptied', async () => {
  const bsp = fakeBsp();
  const F = favApi({ ls: { [LS]: JSON.stringify(['a', 'b']) }, bsp });
  const merged = await F.mxFavOnAuth({ uid: 'u1', favouriteMatches: ['b', 'c'] });
  assert.deepEqual(merged, ['b', 'c', 'a'], 'account order first, then local-only keys');
  assert.deepEqual(F.mxFav.keys, ['b', 'c', 'a']);
  assert.deepEqual(bsp.calls, [{ favouriteMatches: ['b', 'c', 'a'] }]);
  assert.equal(F.store.has(LS), false, 'local list emptied after the account write');
  // signed in, a toggle writes the account, never localStorage
  F.mxFavToggle('d');
  assert.deepEqual(bsp.calls[1], { favouriteMatches: ['b', 'c', 'a', 'd'] });
  assert.equal(F.store.has(LS), false);
  // signing out shows the (now empty) local list
  await F.mxFavOnAuth(null);
  assert.deepEqual(F.mxFav.keys, []);
});

test('merge edge cases: a failed write keeps the local list; nothing local → no write', async () => {
  const failing = fakeBsp(true);
  const F = favApi({ ls: { [LS]: JSON.stringify(['a']) }, bsp: failing });
  assert.deepEqual(await F.mxFavOnAuth({ uid: 'u1', favouriteMatches: [] }), ['a']);
  assert.equal(F.store.get(LS), JSON.stringify(['a']), 'the write failed: the local list survives for the next sign-in');
  const quiet = fakeBsp();
  const G = favApi({ bsp: quiet });
  assert.deepEqual(await G.mxFavOnAuth({ uid: 'u2', favouriteMatches: ['x', 'x', 7, ''] }), ['x'], 'junk in the account is cleaned');
  assert.deepEqual(quiet.calls, [], 'nothing local: no write');
});

test('MUTANT: a merge that drops the local list, or a prune that ignores settling, is caught', async () => {
  const bad = html.replace('const merged = mxFavMerge(account, local);', 'const merged = account;');
  assert.notEqual(bad, html);
  const F = favApi({ ls: { [LS]: JSON.stringify(['a']) }, bsp: fakeBsp(), src: bad });
  assert.notDeepEqual(await F.mxFavOnAuth({ uid: 'u', favouriteMatches: ['b'] }), ['b', 'a']);
  const bad2 = html.replace('return !!m && !m.live && !!(m.finalScore || m.retired || m.walkover);', 'return false;');
  assert.notEqual(bad2, html);
  assert.deepEqual(favApi({ src: bad2 }).mxFavPrune(['7'], [{ id: 'past-7', finalScore: {} }]), ['7']);
});

test('the account accepts the field: auth.js updateProfile + publicUser carry favouriteMatches, cleaned', () => {
  assert.match(slice('publicUser', authSrc), /favouriteMatches: cleanMatchKeys\(data\.favouriteMatches\),/);
  assert.match(authSrc, /if \(Array\.isArray\(patch\.favouriteMatches\)\) updates\.favouriteMatches = cleanMatchKeys\(patch\.favouriteMatches\);/);
  const cleanMatchKeys = new Function(`${slice('cleanMatchKeys', authSrc)}; return cleanMatchKeys;`)();
  assert.deepEqual(cleanMatchKeys(['1', '1', '', 5, null, 'x'.repeat(65), '2']), ['1', '2']);
  assert.deepEqual(cleanMatchKeys('nope'), []);
  assert.equal(cleanMatchKeys(Array.from({ length: 600 }, (_, i) => 'k' + i)).length, 500);
  // firestore.rules: own-doc read/write, no field whitelist to extend
  assert.match(readFileSync(join(HERE, 'firestore.rules'), 'utf8'), /match \/users\/\{uid\} \{\s*allow read, write: if request\.auth != null && request\.auth\.uid == uid;/);
});

// ── Review fold-in (clean-context review, 2026-10-09): the wiring the helper tests above did not reach ─────────────
test('wiring: renderMatches settle-clears against the board; the signed-out list starts from localStorage', () => {
  assert.match(slice('renderMatches'), /\n  mxFavSettleClear\(matches\);\n/, 'renderMatches calls the settle-clear on the loaded board');
  assert.match(html, /const mxFav = \{ keys: mxFavReadLocal\(\), uid: null \};/, 'signed out, the list is the local store');
  assert.match(html, /BSP\.onAuthChange\(u => \{ mxFavOnAuth\(u\)/, 'auth changes drive the merge');
});

test('MUTANT: dropping the settle-clear call or the local start is caught', () => {
  const bad = html.replace('\n  mxFavSettleClear(matches);\n', '\n');
  assert.notEqual(bad, html);
  assert.doesNotMatch(slice('renderMatches', bad), /mxFavSettleClear\(matches\);/);
  const bad2 = html.replace('const mxFav = { keys: mxFavReadLocal(), uid: null };', 'const mxFav = { keys: [], uid: null };');
  assert.notEqual(bad2, html);
  assert.doesNotMatch(bad2, /const mxFav = \{ keys: mxFavReadLocal\(\), uid: null \};/);
});

test('a failed profile read never writes the account: stays on the local list (auth.js flags the fallback)', async () => {
  assert.match(authSrc, /var pu = publicUser\(fbUser, \{\}\); pu\.profileLoadFailed = true; done\(pu\);/);
  const bsp = fakeBsp();
  const F = favApi({ ls: { [LS]: JSON.stringify(['a']) }, bsp });
  assert.deepEqual(await F.mxFavOnAuth({ uid: 'u1', favouriteMatches: [], profileLoadFailed: true }), ['a']);
  assert.equal(F.mxFav.uid, null, 'treated as signed out');
  F.mxFavToggle('b');
  assert.deepEqual(bsp.calls, [], 'no account write, before or after a toggle');
  assert.equal(F.store.get(LS), JSON.stringify(['a', 'b']));
  const bad = html.replace('if (!uid || u.profileLoadFailed){', 'if (!uid){');
  assert.notEqual(bad, html);
  const G = favApi({ ls: { [LS]: JSON.stringify(['a']) }, bsp: fakeBsp(), src: bad });
  await G.mxFavOnAuth({ uid: 'u1', favouriteMatches: [], profileLoadFailed: true });
  assert.equal(G.mxFav.uid, 'u1', 'mutant: the failed read is taken as the account');
});

test('promo card takes grid row 2 (after the first full row at any column count); mutant caught', () => {
  const rule = /\[data-page="matches"\] #matchlist > \.mc-promo\{ grid-row:2; \}/;
  assert.match(html, rule);
  assert.doesNotMatch(html.replace('#matchlist > .mc-promo{ grid-row:2; }', '#matchlist > .mc-promo{ }'), rule);
});

test('avatar menu: hover bridge, above any scrim, Escape refocuses only after a keyboard open; same on account.html', () => {
  const acct = readFileSync(join(HERE, 'account.html'), 'utf8');
  for (const [name, src] of [['dashboard', html], ['account', acct]]) {
    assert.match(src, /\.sf-menu::before\{ content:''; position:absolute; top:0; bottom:0; right:100%; width:16px; \}/, name + ' bridge');
    assert.match(src, /\.sf-sidebar:has\(\.sf-menu\.open\)\{ z-index:9500; \}/, name + ' z-index');
    assert.match(src, /kbOpen = e\.detail === 0;/, name + ' kbOpen');
    assert.match(src, /if \(kbOpen\) chip\.focus\(\);/, name + ' Escape refocus gated');
  }
  assert.doesNotMatch(html.replace('if (kbOpen) chip.focus();', 'chip.focus();'), /if \(kbOpen\) chip\.focus\(\);/);
});

test('rail Live badge reads the count itself off the Live tab (review: it froze); live-tab.js exposes liveCount', () => {
  const lt = readFileSync(join(HERE, 'live-tab.js'), 'utf8');
  assert.match(lt, /async liveCount\(\) \{\n\s+const row = await fetchSnapshot\(\);[\s\S]{0,160}return all\.filter\(isAtpSingles\)\.filter\(isUnderway\)\.length;/);
  assert.match(html, /LiveFeed\.liveCount\(\)\.then\(paint, function \(\) \{\}\);/);
  assert.match(html, /setInterval\(peek, 60000\);/);
  assert.doesNotMatch(html.replace('setInterval(peek, 60000);', ''), /setInterval\(peek, 60000\);/);
});

// ── TEN-403 R1 · item 2 + nit: every board price at 2 dp; the sort option reads "Move" ─────────────
test('TEN-403 R1: board prices print 2 dp (1.092 → 1.09), in the move-view cell too; mutant caught', () => {
  const h = mcDriftCell(1.092, 1.114, false, { paired: true });
  assert.deepEqual(cells(h), [['mc-drifted__open', '', '1.09'], ['mc-drifted__arr', '', '→'], ['mc-drifted__now', '', '1.11'], ['mc-drifted__pct', 'pos', '+1.8%']]);
  const three = cellApi(html.replace("  return v.toFixed(2);\n}", "  if (v < 1.10){ const t = v.toFixed(3); if (!t.endsWith('0')) return t; }\n  return v.toFixed(2);\n}"));
  assert.notDeepEqual(cells(three.mcDriftCell(1.092, 1.114, false, { paired: true }))[0], ['mc-drifted__open', '', '1.09']);
});

test('TEN-403 R1 nit: the Upcoming sort reads "Sort: Move" while the move view is on (key stays drift); mutant caught', () => {
  const run = (src, sort) => new Function(`
    const state = { sort: ${JSON.stringify(sort)} };
    const els = { sortMenu: { innerHTML: '' }, sortBtnLabel: { textContent: '' } };
    const document = { getElementById: id => els[id] || null, querySelectorAll: () => [] };
    const _mcOddsLanded = () => false, _openPinIsVendor = () => true, _mcCardCloseDerivedOf = () => null, matches = [];
    ${slice('syncSortDropdown', src)}
    syncSortDropdown(false);
    return els.sortBtnLabel.textContent;`)();
  assert.equal(run(html, 'drift'), 'Move');
  assert.equal(run(html, 'time'), 'Time');
  assert.match(html, /<span class="mx-sortbtn__pre">Sort:<\/span> <span id="sortBtnLabel">Time<\/span>/, 'the "Sort:" prefix is the control\'s');
  assert.notEqual(run(html.replace("['drift','Move',false]", "['drift','Drift',false]"), 'drift'), 'Move');
});

test('R1 review: plan locks start locked, skip a failed profile read, and never grey the selected page icon (both pages)', () => {
  const acct = readFileSync(join(HERE, 'account.html'), 'utf8');
  for (const [name, src] of [['dashboard', html], ['account', acct]]) {
    assert.match(src, /window\.sfPlanLocks\(null\);   \/\/ locked until the account says Edge \/ Pro/, name + ' default locked');
    assert.match(src, /if \(u && u\.profileLoadFailed\) return;/, name + ' failed read keeps state');
    assert.match(src, /\.sf-item\.active\.is-locked \.sf-ico > svg\{ stroke:var\(--text\); \}/, name + ' active wins');
  }
  assert.doesNotMatch(html.replace('if (u && u.profileLoadFailed) return;', ''), /if \(u && u\.profileLoadFailed\) return;/);
});

test('card 9b1c3aa1: Completed card Move and Completed Biggest-market-move tile use THE move formula (mxMovePct)', () => {
  const j = slice('mcJourney');
  assert.match(j, /const d = mxMovePct\(open, close\);/, 'Completed card Move');
  assert.doesNotMatch(j, /oddsPctDelta\(/);
  assert.match(slice('mxCompletedBiggestMove'), /const d = mxMovePct\(o, c\);\n\s*if \(!d \|\| d\.v === 0\) return;\n\s*if \(!bmv \|\| Math\.abs\(d\.v\) > Math\.abs\(bmv\.d\.v\)\) \{/, 'Completed tile ranks on the shown move');
  assert.equal((html.match(/oddsPctDelta\(/g) || []).length, 1, 'oddsPctDelta has no caller left (definition only)');
});

test('card 9b1c3aa1 review: the Completed "Biggest move" sort ranks on the printed move (mxMovePct), not the raw quotes', () => {
  const ms = slice('moveScore');
  assert.match(ms, /mxMovePct\(o, c\)/);
  assert.doesNotMatch(ms, /Math\.abs\(c1 \/ o1 - 1\)/);
  // +5.5% printed (2.00 → 2.11 on 2.004 → 2.106) must outrank +5.0% printed (2.00 → 2.10 on 2.00 → 2.104)
  const F = new Function(`${slice('mxMovePct')}; return mxMovePct;`)();
  assert.ok(Math.abs(F(2.004, 2.106).v) > Math.abs(F(2.00, 2.104).v));
});

// Founder TEN-403 (comment 414de0fe, 2026-10-09): "the tile's figure = the largest |move| among the Completed cards shown,
// with the same player". EXECUTES the shipped tile pick (mxCompletedBiggestMove) and the shipped card renderer (mcJourney)
// over one board, reads each card's printed Move, and compares. Includes an OLDER close (the +16.4% case the 60-min rule
// used to hide from the tile) and a vendor-pinned open (no Move on the card, none in the tile).
function completedHarness(src = html) {
  return new Function(`
    const OCS = {};
    function _openPinIsVendor(m){ return !!m._vendor; }
    function _openAnchorOf(m, who){ return m._open ? m._open[who] : null; }
    function _openDerivedOf(m, who){ return _openPinIsVendor(m) ? null : _openAnchorOf(m, who); }
    function _mcCardCloseOf(m, who){ return m._close ? m._close[who] : null; }
    function roundBadgeText(r){ return r || ''; }
    function mcTitleAttr(){ return ''; }
    ${slice('mxOddsTxt', src)} ${slice('mxMovePct', src)} ${slice('mcJourney', src)} ${slice('mxCompletedBiggestMove', src)}
    return { mxCompletedBiggestMove, mcJourney, _openAnchorOf, _mcCardCloseOf, _openPinIsVendor };`)();
}
const COMPLETED_BOARD = [
  { p1: 'A. Molcan', p2: 'A. De Minaur', finalScore: {}, _open: { p1: 1.96, p2: 1.90 }, _close: { p1: 2.21, p2: 1.70 } },   // +12.8 / −10.5
  { p1: 'J. Sinner', p2: 'C. Alcaraz', finalScore: {}, _open: { p1: 1.95, p2: 1.88 }, _close: { p1: 2.27, p2: 1.62 }, _older: true }, // +16.4 (older close)
  { p1: 'T. Fritz', p2: 'H. Hurkacz', finalScore: {}, _open: { p1: 1.50, p2: 2.60 }, _close: { p1: 1.20, p2: 4.40 }, _vendor: true }, // vendor pin: no Move
  { p1: 'B. Shelton', p2: 'D. Altmaier', finalScore: {}, _open: { p1: 1.60, p2: 2.40 }, _close: { p1: 1.51, p2: 2.68 } },     // −5.6 / +11.7
];
function largestPrintedMove(A, board) {
  let best = null;
  for (const m of board) for (const who of ['p1', 'p2']) {
    const h = A.mcJourney(A._openAnchorOf(m, who), A._mcCardCloseOf(m, who), A._openPinIsVendor(m), {});
    const t = /mc-px__move[^"]*">([^<]*)</.exec(h)[1];
    if (!t || t === '±0.0%') continue;
    const v = parseFloat(t.replace('−', '-').replace('+', ''));
    if (!best || Math.abs(v) > Math.abs(best.v)) best = { v, text: t, name: who === 'p1' ? m.p1 : m.p2 };
  }
  return best;
}
test('founder 414de0fe: the Completed tile = the largest |printed Move| among the cards shown, same player (older closes included)', () => {
  const A = completedHarness();
  const card = largestPrintedMove(A, COMPLETED_BOARD), tile = A.mxCompletedBiggestMove(COMPLETED_BOARD);
  assert.deepEqual({ text: tile.d.text, name: tile.name }, { text: card.text, name: card.name });
  assert.deepEqual({ text: tile.d.text, name: tile.name }, { text: '+16.4%', name: 'J. Sinner' }, 'the older-close +16.4% row wins');
  assert.equal(A.mxCompletedBiggestMove([COMPLETED_BOARD[2]]), null, 'a vendor-pinned open prints no Move, so the tile has none');
});
test('MUTANT: a tile that skips older closes (the pre-414de0fe within-60 close) no longer matches the cards', () => {
  const bad = html.replace('const o = _openDerivedOf(m, who), c = _mcCardCloseOf(m, who);', 'const o = _openDerivedOf(m, who), c = m._older ? null : _mcCardCloseOf(m, who);');
  assert.notEqual(bad, html);
  const A = completedHarness(bad);
  assert.notEqual(A.mxCompletedBiggestMove(COMPLETED_BOARD).d.text, largestPrintedMove(A, COMPLETED_BOARD).text);
});
