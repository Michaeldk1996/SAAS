// TEN-330 (TEN-312 Form tab, founder 2026-09-28) — the Form tab rebuilt on the design file.
// Every check drives the page's REAL functions (sliced out of bsp-consult-dashboard.html and executed) and names the
// mutation that turns it red; tools/test-ten330-mutants.js applies each one to a copy of the page (TEN330_HTML).
//   · the closing price under every form bar (DF L947), "—" when unpriced, nothing in an empty slot
//   · a walkover is not a match played (N2): no bar, no row, no W–L, no count
//   · a retirement is a match and settles at the listed price (ruling A); its set scores carry "ret."
//   · N1: Form opens on today's surface
//   · a player without a form shard reads his career-history shard, capped at the form-row cap (phase0-c §1)
//   · the file's row geometry, "surface · W–L" group header, "window · surface · role" hot-line header; no Short chip
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN330_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
function slice(name) {
  const start = html.indexOf(`\nfunction ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  const eol = html.indexOf('\n', start + 1), line = html.slice(start, eol);
  if (/\}\s*$/.test(line) && (line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
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
const FNS = ['escapeHtml', 'fhEsc', 'fhSafeId', 'ppCleanTournamentName', 'fhTournClean', 'fhSurfName', 'h2hRoundLabel', 'maRoundName', 'psRoundAbbr', 'fhRoundCode',
  'fhSetsFrom', 'psNormTour', 'fhBestOf', 'fhSetDone', 'fhFinishRow', 'fhRowFromForm', 'fhDayNum', 'fhDDMM', 'fhLongDate', 'fhIsInitial', 'fhNameKey',
  'fhPickBook', 'fhCloseFor', 'fhEloKey', 'fhEloKeyOwners', 'fhEloAt', 'fhRefDay', 'tourxSampleGate', 'maGate', 'maGateBar', 'maSmallNote', 'fhMedian',
  'fhOdd', 'fhSigned', 'fhSourceNote', 'fhB365Approx', 'fhPxMark', 'fhSrcTitle', 'fhScoreText', 'fhEligible', 'fhMtbOf', 'fhIneligibleWhy', 'fhScoreLines', 'fhHotLineRank', 'fhFamOf',
  'fhFormLineDefs', 'surnameFirstName', 'fhOppFmt', 'psShortName', 'fhSurname', 'fhTournCode', 'fhHotLinesHead', 'fhHotRateHtml', 'fhHotLinesTable', 'fhHotMoreHtml',
  'maPct', 'maRate', 'maRateHtml', 'fhFormRowsFromCareer',
  'fhFormPlayer', 'fhFormSetScores', 'fhFormTipScore', 'maMatchRowsHtml', 'maTipHtml',
  'fhStateFor', 'fhNameLink', 'fhFullName', 'fhEloText', 'fhRetNote', 'fhSegStyle', 'fhSegTrack'];
// Match analysis rebuild (2026-11-23): the Form renderers live in match-analysis-v2.js (maFormV2 and its IIFE-local
// formBars / formBox / formDataRows / hotBox / recentBox). Its source runs in the same scope as the sliced data layer;
// TEN330_MA2 points the mutant runner at a mutated copy.
const { ma2Src } = (await import('node:module')).createRequire(import.meta.url)(join(HERE, 'tools', 'ma2-test-load.cjs'));
const MA2 = ma2Src(process.env.TEN330_MA2 || join(HERE, 'match-analysis-v2.js'), ['formBars', 'formBox', 'formDataRows', 'hotBox', 'recentBox']);
const CONSTS = ['FH_SLAMS', 'FH_BOOK_ORDER', 'FH_BOOK', 'FH_SRC', 'FH_B365_APPROX_HOVER', 'FH_DASHC', 'FH_MONO', 'FH_THIN', 'FH_AC', 'FH_SURF', 'FH_ELO_MAX_AGE_DAYS',
  'FH_HOT_MIN_ELIGIBLE', 'FH_HOT_FAM', 'FH_TCODE', 'FH_MONS', 'FH_FORM_ROW_CAP', 'FH_FORM_EVENTS_NOT_COUNTED', 'FH_FORM_NOT_ATP_RECORD', 'MA_GREY', 'MA_SMALL_NOTE', 'MA_ROW_COLS', 'MA_ROW_GAP', 'FH_HOT_COLS', 'FH_HOT_FOOT'];
globalThis.MarketEdgeCore = (await import('node:module')).createRequire(import.meta.url)(join(HERE, 'market-edge-core.js'));
// hotlines-mtb (2026-10-24): fhEligible reads Derived lines' match-tiebreak rule from the REAL player-profile-v2.js
// (PlayerProfileV2._internals.lineFormatOf); without it every games-based Hot line fails closed. The sliced page code
// below resolves `window` to this global.
function hlmtbLoadPP2() {
  const sb = { FEATURE_PP2: true, playerProfiles: { players: {} }, matches: [], addEventListener() {},
    document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] } };
  const prev = globalThis.window; globalThis.window = sb;
  try { new Function('window', readFileSync(join(HERE, 'player-profile-v2.js'), 'utf8'))(sb); } finally { globalThis.window = prev; }
  return sb.PlayerProfileV2;
}
globalThis.window = Object.assign(globalThis.window || {}, { PlayerProfileV2: hlmtbLoadPP2() });
const S = new Function(`
  let _fh = null; const playerProfiles = {};
  function eventKeyOfMatch(m){ return m.eventKey || null; }
  ${CONSTS.map(constSrc).join('\n')}
  ${FNS.map(slice).join('\n')}
  const __MA2_ROOT = Object.create(globalThis);
  ${MA2}
  const T = __MA2_ROOT.__t;
  return { formRule: FH_FORM_NOT_ATP_RECORD, fhFormPlayer, fhFormRowsFromCareer, fhStateFor, fhFormSetScores, fhNameLink,
    maFormV2: __MA2_ROOT.maFormV2, formBars: T.formBars, formBox: T.formBox, formDataRows: T.formDataRows, hotBox: T.hotBox, recentBox: T.recentBox,
    profiles: playerProfiles, get fh(){ return _fh; } };
`)();
// the Form tab's own renderers, on the state fhFormPlayer was built with
const listHtml = P => S.recentBox(P, S.fh.form);
const hotHtml = (P, m) => S.hotBox(P, S.fh.form, m || S.fh.m);
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// Fixture: A. Tester's last matches, newest first (analysed match on 2026-07-20, Hard).
const row = (date, opp, won, sets, extra) => Object.assign({ opponent: opp, opponentKey: null, date, tournament: 'Test Open', round: '1/8-finals',
  surface: 'hard', result: '', won, sets: sets.map(([p, o]) => ({ p, o })), retired: false, walkover: false, qualifying: false, tier: 'atp', eventKey: null }, extra || {});
const ROWS = [
  row('2026-07-18', 'B. Beta', true, [[6, 4], [6, 3]]),
  row('2026-07-17', 'C. Gamma', false, [], { walkover: true, result: '0 - 0' }),           // W/O given: not a match
  row('2026-07-16', 'D. Delta', true, [[6, 2], [2, 1]], { retired: true }),                // retirement: a win, priced
  row('2026-07-10', 'E. Eps', true, [], { walkover: true, result: '0 - 0' }),              // W/O received: not a match
  row('2026-07-09', 'F. Phi', false, [[4, 6], [3, 6]], { tournament: 'Other Cup', surface: 'clay' }),
];
const closes = { rows: [
  { date: '2026-07-18', opp: 'B. Beta', won: true, P: [1.5, 2.6], B: null, ret: false, oppKey: null },
  { date: '2026-07-16', opp: 'D. Delta', won: true, P: [1.8, 2.0], B: null, ret: true, oppKey: null },
], cap: [] };
function match(extra) {
  return Object.assign({ p1: 'A. Tester', p2: 'Z. Other', p1Key: '9001', p2Key: '9002', date: '2026-07-20', surface: 'Hard',
    _fhFormRows: [ROWS, []], _fhFormSrc: ['form', null], _fhCloses: [closes, null], _fhElo: null, _fhFormData: true }, extra || {});
}
function player(m, patch, idx = 0) {
  const F = S.fhStateFor(m);
  Object.assign(F.form, { surf: 'all' }, patch || {});
  return S.fhFormPlayer(m, idx, F.form);
}

// Mutation: `&& !r.wo` dropped from fhFormPlayer's row filter (a walkover becomes a bar, a row and a loss).
test('a walkover is not a match played: no bar, no row, not in the W–L (N2)', () => {
  const P = player(match());
  assert.equal(P.n, 3, 'three matches played (the two walkovers are not matches)');
  assert.equal(P.wins + '–' + (P.n - P.wins), '2–1');
  assert.ok(P.win.every(r => !r.wo));
  assert.ok(!text(listHtml(P)).includes('Gamma') && !text(listHtml(P)).includes('Eps'), 'no walkover row in Recent matches');
  assert.match(text(listHtml(P)), /3 on record/);
});

// Mutation: the retirement unpriced (`if (c && !r.ret)`), or " ret." dropped from fhFormSetScores.
test('a retirement is a match, settles at its listed price and is marked "ret."', () => {
  const P = player(match());
  const ret = P.win.find(r => r.opp === 'D. Delta');
  assert.ok(ret.ret && ret.price === 1.8, 'priced at the listed close');
  assert.equal(S.fhFormSetScores(ret), '6-2, 2-1 ret.');
  assert.match(text(listHtml(P)), /6-2, 2-1 ret\./);
});

// Mutation: the price span removed from the bar, or an unpriced bar printing a number / nothing.
// (2026-11-23 rebuild: the bars are maFormV2's formBars — 6px bar, a 9px mono price line under it.)
test('every form bar carries the closing price under it; "—" when unpriced; empty slots carry none (DF L947)', () => {
  const m = match(); S.fhStateFor(m);
  const P = player(m, { n: 5 });
  const col = S.formBars(P);
  const prices = [...col.matchAll(/font-size:9px; color:var\(--ma2-grey\); white-space:nowrap; height:11px;">([^<]*)</g)].map(x => x[1]);
  assert.deepEqual(prices, ['—', '1.80', '1.50'], 'oldest → newest: F. Phi unpriced, then 1.80, 1.50');
  const slots = (col.match(/height:6px; border-radius:3px/g) || []).length;
  assert.equal(slots, 5, 'Last 5 → 5 bar slots (2 empty)');
  assert.equal((col.match(/<div aria-hidden="true"[^>]*>.*?<span style="height:11px;"><\/span>/g) || []).length, 2, 'empty slots: an empty price line');
});

// Mutation: fhStateFor opens Form on 'all' (N1: today's surface).
test('N1: Form opens on today\'s surface', () => {
  const m = match({ surface: 'Clay' });
  S.fh && (S.fh.m = null);
  const F = S.fhStateFor(m);
  assert.equal(F.form.surf, 'Clay');
});

// Mutation: fhFormRowsFromCareer loses its cap, or the career-history row keeps a walkover as a played match.
test('a player without a form shard reads career-history, capped at the form-row cap (phase0-c §1)', () => {
  const ch = Array.from({ length: 60 }, (_, i) => ({ date: `2026-06-${String(28 - (i % 28)).padStart(2, '0')}`, tournament: 'CH Event', round: 'Qualifying',
    opponent: 'Q. Opp' + i, won: i % 2 === 0, result: '2 - 0', level: 'chitf', surface: 'hard', sets: [{ p: 6, o: 3 }, { p: 6, o: 4 }], eventKey: 7000 + i }));
  ch[0].walkover = true;
  const rows = S.fhFormRowsFromCareer(ch);
  assert.equal(rows.length, 40, 'capped at FH_FORM_ROW_CAP');
  assert.equal(rows[1].qualifying, true, 'a "Qualifying" round is a qualifying row');
  assert.equal(rows[1].tier, 'chitf', 'Challenger / ITF rows stay (recent form is never ATP-only)');
  // founder 2026-10-22: the cap counts PLAYED rows (the walkover is split off first and listed on its own)
  assert.ok(rows.every(r => !r.walkover), 'no walkover among the capped Form rows');
  assert.deepEqual(S.fhFormRowsFromCareer(ch, true).map(r => r.opponent), ['Q. Opp0'], 'the walkover row, for the list');
  const P = player(match({ _fhFormRows: [rows, []], _fhFormSrc: ['career', null], _fhCloses: [null, null] }));
  assert.ok(P.win.every(r => !r.wo) && P.shown.length === 40, '40 played matches on record; the walkover is in none of them');
});

// Mutation: the group header meta dropped, or the tooltip/rows back to the double-space score join, or Form back on the
// file's grid / the TEN-350 scores-under-the-name layout (TEN-380: README §5's grid with a Score column of its own).
// 2026-11-23 rebuild: the design's Recent matches grid (Date · · Opponent · Rd · Sets · Score · Price · Opp, FL_COLS)
// replaces README §5's grid and its colours; the rules that stay: "surface · W–L" headers, Score its own cell that wraps
// only between sets, no Elo in the row (Q5).
test('the rows: "surface · W–L" group header, a Score column of its own, no Elo in the row (TEN-380 Q5)', () => {
  const P = player(match());
  const L = listHtml(P);
  assert.match(text(L), /Test Open Hard · 2–0/);
  assert.match(text(L), /Other Cup Clay · 0–1/);
  const G = 'grid-template-columns:44px 8px minmax(78px,1.1fr) 28px 44px minmax(86px,1.3fr) 38px 38px; gap:0 8px;';
  assert.equal(L.split(G).length - 1, 1 + P.win.length, 'the column head + every listed row on one grid');
  assert.match(text(L), /Date Opponent Rd Sets Score Price Opp/, 'the column is "Score"');
  assert.match(text(L), /18\.07\. Beta B\. R16 2–0 6-4, 6-3 1\.50 2\.60/, 'name, then Rd · Sets · Score · Price · Opp — no Elo in the row (TEN-380 Q5)');
  assert.ok(!/ma-row-elo|data-elo|fh-tip-elo/.test(L), 'TEN-380 Q5: the Elo lives in the bar tooltip, not the row');
  assert.match(L, /line-height:1\.35;"><span style="white-space:nowrap;">6-4,<\/span> <span style="white-space:nowrap;">6-3<\/span><\/span>/, 'Score = its own cell; wraps only between sets, never cut (TEN-380 review)');
});

// TEN-380: the divider under the window is two neutral rules round its label, never the blue open-card outline.
// (2026-11-23 design: the label reads "Used in the form figures above", the rules are 6% white.)
test('the "used in the form figures" divider: two neutral rules round the label, no blue', () => {
  const P = player(match(), { n: 5 });
  const L = listHtml(P);
  const d = /<div style="display:flex; align-items:center; gap:10px; padding:8px 18px;">[\s\S]*?<\/div>/.exec(L);
  assert.ok(d, 'the divider is drawn under the window');
  assert.match(d[0], />Used in the form figures above</);
  assert.equal((d[0].match(/flex:1; height:1px; background:color-mix\(in srgb, var\(--ma2-white\) 6%, transparent\);/g) || []).length, 2);
  assert.ok(!/open-card|blue|--bar|--link/.test(d[0]), 'no blue rule');
});

// TEN-380 (README §5): the hot lines are identical for both players — Line · Rate · Covered · dots; Rate on the D2 gate
// (no % under 5 eligible, greyed 5–9); dots --hot-dot with a 1px ring; "Most covered" on --inner with no edge, its label
// --link; "Show all lines (N)" --text, centred. Mutations: the player colour back on the dots, the gate bar back instead
// of the Rate, a % printed on n 3–4, the Most covered row back on --selected + an outline.
// 2026-11-23 rebuild: the design's Line · Covered head (the rate sits in Covered beside "c of n"), dots in --ma2-blue for
// both players, "Most covered" a chip. The rules kept: the rate on the D2 gate, one dot colour for both players (never
// the player colour), Most covered on the best line.
test('hot lines: the rate on the D2 gate, one dot colour for both players, Most covered on the top line', () => {
  const m = match({ _fhFormRows: [ROWS, ROWS], _fhFormSrc: ['form', 'form'], _fhCloses: [closes, closes] }); S.fhStateFor(m);
  const A = player(m, { n: 10 }, 0), B = player(m, { n: 10 }, 1);
  for (const P of [A, B]) {
    const H = hotHtml(P, m);
    assert.ok(P.hot.ok, 'the fixture ranks lines for player ' + P.idx);
    assert.match(text(H), /Line Covered/);
    const dots = [...H.matchAll(/border:1\.5px solid (var\(--[a-z0-9-]+\)|transparent); box-sizing:border-box/g)].map(x => x[1]);
    assert.ok(dots.length && dots.every(c => c === 'var(--ma2-blue)' || c === 'transparent'), 'every eligible dot rings in the one dot colour (both players)');
  }
  assert.ok(A.hot.ok, 'the fixture ranks lines for A'); assert.match(hotHtml(A, m), /Most covered/);
  const rate = /data-ma-gate="(?:full|small|nopct)"[^>]*>([^<]*)</.exec(hotHtml(A, m))[1];
  assert.ok(/^(\d+%|—)$/.test(rate), 'a rate cell is a % or a gated dash: ' + rate);
});
test('hot lines rate: n 3–4 a grey dash (no %), n 5–9 grey, 10+ the % in white', () => {
  const m = match(); S.fhStateFor(m);
  const run = (c, n) => { const rows = Array.from({ length: n }, (_, i) => ({ mid: 'm' + i, date: '2026-07-0' + (i % 9 + 1), tourn: 'T', round: 'R16', opp: 'O. Opp', surface: 'Hard', pS: 2, oS: 0, sets: [[6, 1], [6, 1]], done: [[6, 1], [6, 1]], tot: i < c ? 30 : 12, diff: 10, bo: 3, tbN: 0, decider: false }));
    const sc = { scored: [{ k: 0, L: { g: 'tot', name: 'Over 22.5 games', need: 'games', bo3: true, cov: r => r.tot > 22.5, basis: '' }, name: 'Over 22.5 games', n, c, r: c / n }], covMap: {} };
    return S.hotBox({ idx: 0, name: 'A', key: null, win: rows, hot: { ok: true, sc, hdr: { win: 'Last 10', surf: 'Hard', role: 'Any role' }, short: false, few: false } }, S.fh.form, m); };
  assert.match(run(3, 4), /data-ma-gate="nopct"[^>]*>—</); assert.doesNotMatch(run(3, 4), />75%</);
  assert.match(run(5, 7), /data-ma-gate="small"[^>]*color:var\(--ma2-grey\);[^>]*>71%</);
  assert.match(run(9, 12), /data-ma-gate="full"[^>]*color:var\(--ma2-text\);[^>]*>75%</);
});

// Mutation: the hot-line header back to one ctx string, or the Short chip shown again (DF L4773 short:false).
test('hot lines: "window · surface · role" header under the name; the Short chip never shows (the file hard-codes it off)', () => {
  const m = match(); const F = S.fhStateFor(m);
  const P = player(m, { n: 10 });
  assert.equal(P.hot.short, false);
  const H = hotHtml(P, m);
  assert.match(text(H), /A\. Tester Last 10 · All surfaces · Any role/);
  assert.ok(!/Short odds/.test(H));
});

// Mutation: the keyless name join dropped (`|| (r.oppKey == null && clNoKey ? … : null)` removed) — every career-history
// row comes out unpriced, because the closes shard resolved its opponents' keys.
test('a career-history row (no opponent key) is priced by name against a keyed archive row; a different result is not', () => {
  const rows = S.fhFormRowsFromCareer([
    { date: '2026-07-18', tournament: 'Test Open', round: '1/8-finals', opponent: 'B. Beta', won: true, result: '2 - 0', level: 'atp', surface: 'hard', sets: [{ p: 6, o: 3 }, { p: 6, o: 4 }], eventKey: 1 },
    { date: '2026-07-16', tournament: 'Test Open', round: '1/16-finals', opponent: 'D. Delta', won: false, result: '0 - 2', level: 'atp', surface: 'hard', sets: [{ p: 3, o: 6 }, { p: 4, o: 6 }], eventKey: 2 }]);
  const keyed = { rows: [{ date: '2026-07-18', opp: 'Beta B.', won: true, P: [1.4, 3.1], B: null, ret: false, oppKey: '77' },
    { date: '2026-07-16', opp: 'Delta D.', won: true, P: [1.6, 2.4], B: null, ret: false, oppKey: '78' }], cap: [] };
  const P = player(match({ _fhFormRows: [rows, []], _fhFormSrc: ['career', null], _fhCloses: [keyed, null] }));
  assert.equal(P.win.find(r => r.opp === 'B. Beta').price, 1.4, 'matched by name, same day, same result');
  assert.equal(P.win.find(r => r.opp === 'D. Delta').price, null, 'the archive row disagrees on the result → unpriced, never guessed');
  // review 2026-09-29: a Bet365-only capture on the row's eventKey must not beat the Pinnacle Tennis-Data close.
  const withCap = { rows: keyed.rows, cap: [{ date: '2026-07-18', oppKey: '77', P: null, B: [1.5, 2.7], ek: '1' }] };
  const P2 = player(match({ _fhFormRows: [rows, []], _fhFormSrc: ['career', null], _fhCloses: [withCap, null] }));
  const b = P2.win.find(r => r.opp === 'B. Beta');
  assert.deepEqual([b.price, b.book, b.src], [1.4, 'P', 'td'], 'Pinnacle Tennis-Data before Bet365 captured (FH_BOOK_ORDER)');
});

// Mutation: the settlement note dropped from the v-market pill or the Flat 1u value (TEN-325, founder 70fb039e).
test('profit figures that count retirements carry "Retirements settle on Pinnacle rules for all rows." (one constant)', () => {
  const NOTE = globalThis.MarketEdgeCore.RET_SETTLE_NOTE;
  assert.equal(NOTE, 'Retirements settle on Pinnacle rules for all rows.');
  const many = Array.from({ length: 6 }, (_, i) => row(`2026-07-${String(18 - i).padStart(2, '0')}`, 'P. ' + ['Alpha', 'Bravo', 'Carlo', 'Delta', 'Echo', 'Foxtrot'][i], i % 2 === 0, [[6, 4], [6, 3]]));
  const cl = { rows: many.map(r => ({ date: r.date, opp: r.opponent, won: r.won, P: [1.7, 2.2], B: null, ret: false, oppKey: null })), cap: [] };
  const m = match({ _fhFormRows: [many, many], _fhFormSrc: ['form', 'form'], _fhCloses: [cl, cl] });
  const A = player(m, {}, 0), B = player(m, {}, 1);
  assert.ok(A.mktOk, `market figures shown (n ${A.n}, priced ${A.np})`);
  assert.ok(S.formBox(A).includes(' · ' + NOTE + '"'), 'the Against the market hover');
  const d = S.formDataRows(A, B, [['flat', 'Flat 1u', 'P/L', 'high'], ['medP', 'Median odd', 'x', 'low']]);
  assert.equal((d.match(new RegExp('title="' + NOTE.replace(/\./g, '\\.') + '"', 'g')) || []).length, 2, 'both Flat 1u values, and no other figure');
});

// DoD item 8 (founder 2026-09-29), on the 2026-11-23 rebuild: no Form row renderer is left in the dashboard (the old
// fhFormRowHtml / fhFormPriceCell / fhFormListHtml are gone), and every match row and every form bar opens the ONE match
// stats sheet (fhOpenSheet) on that match. The maMatchRowsHtml / maTipHtml half of DoD 8 is not met by the rebuild (the
// design draws its own rows) — reported, not asserted.
test('Form: no Form-local renderer in the dashboard; every row and every bar opens the one sheet', () => {
  assert.ok(!/\nfunction (fhFormRowHtml|fhFormPriceCell|fhFormListHtml|fhFormColumnHtml|fhFormHotHtml)\(/.test(html), 'the old Form renderers are deleted');
  const P = player(match());
  const L = listHtml(P);
  const rowsOpen = [...L.matchAll(/class="seg ma2-row fh-frow" data-fh-mid="([^"]+)" onclick="fhOpenSheet\('([^']+)'\)"/g)];
  assert.equal(rowsOpen.length, P.win.length, 'every listed row opens the sheet');
  assert.ok(rowsOpen.every(x => x[1] === x[2]), 'on its own match');
  const col = S.formBars(P);
  assert.deepEqual([...col.matchAll(/class="ma2-fbar" onclick="fhOpenSheet\('([^']+)'\)"/g)].map(x => x[1]), P.win.slice().reverse().map(r => r.mid), 'every bar opens its match');
  assert.match(col, /class="fh-tip-elo"/, 'the bar tooltip carries the Elo at the match date (Q5)');
});

// Founder Q27 (2026-09-30): a player with no profile is plain text — no link, no handler; with a profile the name links.
// Mutation 'Q27: a name links with no profile behind it' (tools/test-ten330-mutants.js).
test('Q27: a Form name with no profile is plain text; with a profile it links to it', () => {
  S.profiles['7'] = { name: 'A. Tester' };
  assert.match(S.fhNameLink('A. Tester', '7', 'x'), /^<span class="plink" onclick="fhOpenProfile\('7'\)" style="x">A\. Tester<\/span>$/);
  for (const k of ['8', null, undefined]) assert.equal(S.fhNameLink('B. Nobody', k, 'x'), '<span style="x">B. Nobody</span>', 'key ' + k);
  delete S.profiles['7'];
});

// TEN-380 (README §5): all four Form filters on ONE row that never wraps (it scrolls sideways): surface | role |
// Matches/Days, then Last N (or N days) on its own Darker track (track --card + 1px --edge-6; selected --inner + --edge-10).
// Mutations 'form: the four filters wrap onto two lines', 'form: Last N back off its track'.
// 2026-11-23 design: the filter row wraps (the design's flex-wrap:wrap) — the TEN-380 one-nowrap-row rule is superseded.
// Kept: four tracks (surface | role | Matches/Days, then Last N on its own track), selected = lifted + white 700.
test('Form filters: four tracks, Last N on its own track', () => {
  const m = match(); S.fh && (S.fh.m = null); S.fhStateFor(m);
  const h = S.maFormV2(m);
  const row = h.slice(h.indexOf('<div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px 12px;">'), h.indexOf('Form</span>'));
  const tracks = row.split('class="ma2-track"').slice(1).map(t => text('<' + t).replace(/^[^>]*>/, ''));
  assert.equal(tracks.length, 4, 'four tracks: surface, role, Matches/Days, Last N');
  assert.match(tracks[0], /^All Clay Hard Grass/); assert.match(tracks[1], /^All As favourite As underdog/);
  assert.match(tracks[2], /^Matches Days/); assert.match(tracks[3], /^Last 5 Last 10 Last 15 Last 20/, 'Last N on its own track');
  assert.match(row, /font-weight:700; color:var\(--ma2-text\); background:var\(--ma2-lifted\);[^>]*>Last 10</, 'the selected window');
});

// Founder review 2 (TEN-380, 2026-10-04) item 5: Laver Cup is not in the ATP's official win-loss record, so it is never a
// Form row — not in the last 10, the W–L or the hot lines; the next match slides in. Davis Cup still counts (the ATP counts it).
// Mutation: the FH_FORM_NOT_ATP_RECORD filter dropped.
test('review 2: a Laver Cup match is not a Form row; Davis Cup still is', () => {
  const R = [
    row('2026-07-18', 'L. Laver', false, [[4, 6], [6, 3], [8, 10]], { tournament: 'Laver Cup' }),
    row('2026-07-17', 'D. Cup', true, [[6, 4], [6, 4]], { tournament: 'Davis Cup - Finals' }),
    row('2026-07-10', 'B. Beta', true, [[6, 4], [6, 3]]),
  ];
  const m = { id: 'x', p1: 'A. Tester', p2: 'Z. Zed', p1Key: 1, p2Key: 2, date: '2026-07-20', surface: 'Hard', _fhFormRows: [R, []], _fhCloses: [null, null] };
  const P = S.fhFormPlayer(m, 0, S.fhStateFor(m).form);
  const all = P.shown;
  assert.ok(!all.some(r => /laver/i.test(r.tournRaw || r.tourn || '')), 'no Laver Cup row');
  assert.ok(all.some(r => /davis/i.test(r.tournRaw || r.tourn || '')), 'Davis Cup stays (it counts in the ATP record)');
  assert.equal(P.wins, 2, 'W–L: 2–0 without the Laver Cup loss');
});

// TEN-383 (founder 2026-10-04): the Matches board card's Recent form % uses the same Form rule — Laver Cup and exhibitions
// out, the next match slides in; Davis Cup and United Cup stay. The card's % is the pipeline's recentFormPct over the very
// rows the Form tab reads, so one fixture drives both and they must agree: board = Form tab (All surfaces, Last 10) = Key
// factors' Recent form (fhFormPlayer). The Zverev shape: two Laver Cup losses in his last 10 → 80% counted, 100% ruled.
// Mutation: the FORM_NOT_ATP_RECORD filter dropped from recentFormPct (TEN330_PIPELINE), or the two lists drifting apart.
const PIPE = (await import('node:module')).createRequire(import.meta.url)(process.env.TEN330_PIPELINE || join(HERE, 'bsp-pipeline.js'));
test('TEN-383: the board card\'s Recent form % counts the Form tab\'s matches (Laver Cup out, Davis/United Cup in)', () => {
  const R = [
    row('2026-09-21', 'L. One', false, [[4, 6], [4, 6]], { tournament: 'ATP Laver Cup' }),
    row('2026-09-20', 'L. Two', false, [[6, 7], [4, 6]], { tournament: 'ATP Laver Cup' }),
    row('2026-09-12', 'D. Cup', true, [[6, 4], [6, 4]], { tournament: 'Davis Cup - World Group I' }),
    row('2026-01-04', 'U. Cup', true, [[6, 4], [6, 4]], { tournament: 'United Cup' }),
    ...[...Array(8)].map((_, i) => row(`2025-12-${String(20 - i).padStart(2, '0')}`, 'W. Win' + i, true, [[6, 3], [6, 3]])),
    row('2025-11-01', 'O. Old', false, [[3, 6], [3, 6]]),
  ];
  assert.equal(PIPE.FORM_NOT_ATP_RECORD.source, S.formRule.source, 'the pipeline and the Form tab share one list');
  const card = PIPE.recentFormPct(R);
  assert.equal(card, 100, 'card: last 10 without the two Laver Cup losses, Davis Cup and United Cup counted');
  const m = { id: 'z', p1: 'A. Zverev', p2: 'Z. Zed', p1Key: 1, p2Key: 2, date: '2026-10-04', surface: 'Hard', _fhFormRows: [R, []], _fhCloses: [null, null] };
  const P = player(m, { surf: 'all', wmode: 'n', n: 10 });
  const n = P.n;
  assert.equal(n, 10, 'Form tab: ten matches in the window');
  assert.equal(Math.round(P.wins / n * 1000) / 10, card, 'board % = Form tab W–L %');
});

// TEN-383 "profile too" (founder 2026-10-04 10:04Z): the Player Profile's Recent form — the ribbon, its rate and chips, and
// the full ledger — counts the same list. Drives the REAL V2 renderer (player-profile-v2.js buildCtx → renderRibbon) on the
// Zverev-shaped fixture: no Laver Cup row, Davis Cup and United Cup kept, last 10 = 10–0 = the card's 100%. The three
// lists (pipeline, Form tab, profile) must be one source. The legacy renderer applies FH_FORM_NOT_ATP_RECORD directly.
// Mutations: the inForm filter dropped from buildCtx; the profile list drifting from the other two.
function loadPP2() {
  const sb = { FEATURE_PP2: true, playerProfiles: { players: {} }, matches: [], addEventListener() {}, document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] } };
  const prev = globalThis.window; globalThis.window = sb;
  try { new Function('window', readFileSync(process.env.TEN330_PP2 || join(HERE, 'player-profile-v2.js'), 'utf8'))(sb); } finally { globalThis.window = prev; }
  return sb.PlayerProfileV2;
}
test('TEN-383: the Player Profile Recent form (ribbon, chips, ledger) counts the same matches as the card and the Form tab', () => {
  const R = [
    row('2026-09-21', 'L. One', false, [[4, 6], [4, 6]], { tournament: 'ATP Laver Cup' }),
    row('2026-09-20', 'L. Two', false, [[6, 7], [4, 6]], { tournament: 'ATP Laver Cup' }),
    row('2026-09-12', 'D. Cup', true, [[6, 4], [6, 4]], { tournament: 'ATP Davis Cup - World Group I' }),
    row('2026-01-04', 'U. Cup', true, [[6, 4], [6, 4]], { tournament: 'ATP United Cup' }),
    ...[...Array(8)].map((_, i) => row(`2025-12-${String(20 - i).padStart(2, '0')}`, 'W. Win' + i, true, [[6, 3], [6, 3]])),
    row('2025-11-01', 'O. Old', false, [[3, 6], [3, 6]]),
  ];
  const PP = loadPP2(), I = PP._internals;
  assert.equal(I.FORM_NOT_ATP_RECORD.source, S.formRule.source, 'profile list = Form tab list');
  assert.equal(I.FORM_NOT_ATP_RECORD.source, PIPE.FORM_NOT_ATP_RECORD.source, 'profile list = card list');
  const ctx = I.build({ key: '1980', name: 'A. Zverev', recentForm: { pct: null, matches: R } });
  const t = r => String(r.tournament || '');
  assert.ok(!ctx.filtered.some(r => /laver/i.test(t(r))), 'ribbon / chips: no Laver Cup row');
  assert.ok(!ctx.formRows.some(x => /laver/i.test(t(x.m))), 'ledger: no Laver Cup row');
  assert.ok(ctx.filtered.some(r => /davis/i.test(t(r))) && ctx.filtered.some(r => /united/i.test(t(r))), 'Davis Cup and United Cup stay');
  assert.equal(ctx.ledgerRows.length, R.length, 'records keep every match (sheet lookup, career drills)');
  assert.equal(ctx.rows.length, R.length, 'the header (Current run, Last played) keeps every match — a record, not form');
  assert.equal(I.currentRun(ctx.rows).won, false, 'Current run reads the latest match played, a Laver Cup loss');
  const r10 = I.formRate(ctx.filtered.slice(-10));
  assert.equal(Math.round(r10.won / r10.n * 1000) / 10, PIPE.recentFormPct(R), 'profile last 10 = the card\'s Recent form %');
  assert.equal(PIPE.recentFormPct(R), 100);
  const rib = I.renderRibbon(ctx);
  assert.ok(!/Laver/.test(rib), 'the ribbon html names no Laver Cup match');
  assert.match(rib, />91%<\/span> <span[^>]*>10–1</, 'ribbon rate = 10–1 over the 11 form rows (13 minus the two Laver Cup losses)');
  assert.match(rib, />last 11 · oldest/, 'the strip draws the 11 form rows');
  const P0 = { key: '1980', name: 'A. Zverev', recentForm: { pct: null, matches: R } };
  const led = I.renderLedger(P0, Object.assign(I.build(P0), { ledgerOpen: true }));
  assert.ok(!/Laver/.test(led), 'the full ledger lists no Laver Cup match');
  // TEN-384: the provenance footnote ("Window: N matches") gave way to the reference's head ("pct · N matches")
  // and "See all N results"; the window is still the 11 form rows, counted in the head and drawn as rows.
  assert.match(led, /full ledger<\/span>.*?> · 11 matches</, 'the ledger head counts the 11 form rows');
  assert.equal((led.match(/class="pp2-ledger-row"/g) || []).length, 11, 'the ledger draws the 11 form rows');
});

