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
  'fhOdd', 'fhSigned', 'fhSourceNote', 'fhSrcTitle', 'fhScoreText', 'fhEligible', 'fhIneligibleWhy', 'fhScoreLines', 'fhHotLineRank', 'fhFamOf',
  'fhFormLineDefs', 'surnameFirstName', 'fhOppFmt', 'psShortName', 'fhSurname', 'fhTournCode', 'fhHotLinesHead', 'fhHotRateHtml', 'fhHotLinesTable', 'fhHotMoreHtml',
  'maPct', 'maRate', 'maRateHtml', 'fhFormRowsFromCareer',
  'fhFormPlayer', 'fhFormSetScores', 'fhFormTipScore', 'fhFormRowData', 'maMatchRowsHtml', 'maTipHtml', 'fhFormColumnHtml', 'fhFormListHtml', 'fhFormHotHtml',
  'fhStateFor', 'fhNameLink', 'fhFullName', 'fhEloText', 'fhRetNote', 'fhFormDataRows', 'fhSegStyle', 'fhSegTrack'];
const CONSTS = ['FH_SLAMS', 'FH_BOOK_ORDER', 'FH_BOOK', 'FH_SRC', 'FH_DASHC', 'FH_MONO', 'FH_THIN', 'FH_AC', 'FH_SURF', 'FH_ELO_MAX_AGE_DAYS',
  'FH_HOT_MIN_ELIGIBLE', 'FH_HOT_FAM', 'FH_TCODE', 'FH_MONS', 'FH_FORM_ROW_CAP', 'FH_H2H_NOT_ATP_RECORD', 'FH_FORM_NOT_ATP_RECORD', 'MA_GREY', 'MA_SMALL_NOTE', 'MA_ROW_COLS', 'MA_ROW_GAP', 'FH_HOT_COLS', 'FH_HOT_FOOT'];
globalThis.MarketEdgeCore = (await import('node:module')).createRequire(import.meta.url)(join(HERE, 'market-edge-core.js'));
const S = new Function(`
  let _fh = null; const playerProfiles = {};
  function eventKeyOfMatch(m){ return m.eventKey || null; }
  ${CONSTS.map(constSrc).join('\n')}
  ${FNS.map(slice).join('\n')}
  const hotTable = (rows, sc) => fhHotLinesTable(rows, sc, { colMin: '22px', colHead: 'date', today: 'Hard', showAll: false, lineCls: k => 'fl-' + k, colTip: () => '', dotTip: () => '' });
  return { formRule: FH_FORM_NOT_ATP_RECORD, fhSegTrack, hotTable, fhFormDataRows, fhFormPlayer, fhFormColumnHtml, fhFormListHtml, fhFormHotHtml, fhFormRowData, maMatchRowsHtml, fhFormRowsFromCareer, fhStateFor, fhFormSetScores,
    fhNameLink, profiles: playerProfiles, get fh(){ return _fh; } };
`)();
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
  assert.ok(!text(S.fhFormListHtml(P)).includes('Gamma') && !text(S.fhFormListHtml(P)).includes('Eps'), 'no walkover row in Recent matches');
  assert.match(text(S.fhFormListHtml(P)), /3 on record/);
});

// Mutation: the retirement unpriced (`if (c && !r.ret)`), or " ret." dropped from fhFormSetScores.
test('a retirement is a match, settles at its listed price and is marked "ret."', () => {
  const P = player(match());
  const ret = P.win.find(r => r.opp === 'D. Delta');
  assert.ok(ret.ret && ret.price === 1.8, 'priced at the listed close');
  assert.equal(S.fhFormSetScores(ret), '6-2, 2-1 ret.');
  assert.match(text(S.fhFormListHtml(P)), /6-2, 2-1 ret\./);
});

// Mutation: the price span removed from the bar, or an unpriced bar printing a number / nothing.
test('every form bar carries the closing price under it; "—" when unpriced; empty slots carry none (DF L947)', () => {
  const m = match(); S.fhStateFor(m);
  const P = player(m, { n: 5 });
  const col = S.fhFormColumnHtml(P, false);
  const prices = [...col.matchAll(/class="fh-bar-price"[^>]*>([^<]*)</g)].map(x => x[1]);
  assert.deepEqual(prices, ['—', '1.80', '1.50'], 'oldest → newest: F. Phi unpriced, then 1.80, 1.50');
  const slots = (col.match(/height:7px; border-radius:4px/g) || []).length;
  assert.equal(slots, 5, 'Last 5 → 5 bar slots (2 empty)');
  assert.equal((col.match(/font-size:8\.5px; white-space:nowrap; height:10px;"><\/span>/g) || []).length, 2, 'empty slots: an empty price line');
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
  const P = player(match({ _fhFormRows: [rows, []], _fhFormSrc: ['career', null], _fhCloses: [null, null] }));
  assert.ok(P.win.every(r => !r.wo) && P.shown.length === 39, 'the walkover row is dropped; 39 played matches on record');
});

// Mutation: the group header meta dropped, or the tooltip/rows back to the double-space score join, or Form back on the
// file's grid / the TEN-350 scores-under-the-name layout (TEN-380: README §5's grid with a Score column of its own).
test('the rows: "surface · W–L" group header, README §5 grid with its own Score column, Elo after the name (TEN-380)', () => {
  const P = player(match());
  const L = S.fhFormListHtml(P);
  assert.match(text(L), /Test Open Hard · 2–0/);
  assert.match(text(L), /Other Cup Clay · 0–1/);
  // TEN-380 (README §5): header + rows on `40px 10px minmax(96px,1fr) 28px 34px minmax(86px,1fr) 38px 38px; gap 0 6px`
  const G = 'grid-template-columns:40px 10px minmax(96px,1fr) 28px 34px minmax(86px,1fr) 38px 38px; gap:0 6px;';
  assert.equal(L.split(G).length - 1, 1 + P.win.length, 'the sticky header + every listed row');
  assert.match(text(L), /Date Opponent Rd Sets Score H A/, 'the column is "Score" (was "Set scores")');
  assert.match(text(L), /18\.07\. Beta B\. R16 2 - 0 6-4, 6-3 1\.50 2\.60/, 'name, then Rd · Sets · Score · H · A — no Elo in the row (TEN-380 Q5)');
  assert.ok(!/ma-row-elo|data-elo/.test(L), 'TEN-380 Q5: the Elo lives in the bar tooltip, not the row');
  assert.match(L, /class="ma-row-score" title="6-4, 6-3" style="[^"]*color:var\(--text-label\);[^"]*"><span style="white-space:nowrap;">6-4,<\/span> <span style="white-space:nowrap;">6-3<\/span><\/span>/, 'Score = its own cell, --text-label; wraps only between sets, never cut (TEN-380 review)');
  // the header: --card on a 1px --line rule (decisions §1); the card: --card + 1px --edge-6
  assert.match(L, /class="ma-rows-head" style="[^"]*background:var\(--card\); padding:10px 14px 8px; border-bottom:1px solid var\(--line\);/);
  assert.match(L, /class="fh-fcard" style="border:1px solid var\(--edge-6\);[^"]*background:var\(--card\);/);
});

// TEN-380 README §5: "Used in form stats" rules = --edge-10 (never the blue open-card outline). Mutation: back to --open-card.
test('the "↑ used in form stats" divider: rules --edge-10, a mono lowercase label', () => {
  const P = player(match(), { n: 5 });
  const L = S.fhFormListHtml(P);
  const d = /<div class="fh-used"[\s\S]*?<\/div>/.exec(L);
  assert.ok(d, 'the divider is drawn under the window');
  assert.equal((d[0].match(/height:1px; background:var\(--edge-10\);/g) || []).length, 2);
  assert.ok(!/open-card/.test(d[0]));
  assert.match(d[0], />↑ used in form stats</);
});

// TEN-380 (README §5): the hot lines are identical for both players — Line · Rate · Covered · dots; Rate on the D2 gate
// (no % under 5 eligible, greyed 5–9); dots --hot-dot with a 1px ring; "Most covered" on --inner with no edge, its label
// --link; "Show all lines (N)" --text, centred. Mutations: the player colour back on the dots, the gate bar back instead
// of the Rate, a % printed on n 3–4, the Most covered row back on --selected + an outline.
test('hot lines: Rate column on the D2 gate, --hot-dot dots for both players, Most covered = --inner, toggle centred', () => {
  const m = match(); S.fhStateFor(m);
  const A = player(m, { n: 10 }, 0), B = player(m, { n: 10 }, 1);
  for (const P of [A, B]) {
    const H = S.fhFormHotHtml(P);
    assert.match(text(H), /Line Rate Covered/);
    assert.ok(!/data-ma-gate="(full|small)"[^>]*style="height:5px/.test(H), 'no gate bar');
    const dots = [...H.matchAll(/border:1px solid (var\(--[a-z-]+\)|transparent); box-sizing:border-box/g)].map(x => x[1]);
    if (P.hot.ok) assert.ok(dots.length && dots.every(c => c === 'var(--hot-dot)' || c === 'transparent'), 'every eligible dot rings in --hot-dot (both players)');
    const top = /<div class="[^"]*fh-hl-top" style="([^"]*)"/.exec(H);
    if (top) { assert.match(top[1], /background:var\(--inner\);/); assert.ok(!/box-shadow|border:/.test(top[1]), 'no edge'); }
  }
  assert.ok(A.hot.ok, 'the fixture ranks lines for A'); assert.match(S.fhFormHotHtml(A), /Most covered/);
  const rate = /class="fh-hl-rate"[^>]*>(?:<span[^>]*>)?([^<]*)</.exec(S.fhFormHotHtml(A))[1];
  assert.ok(/^(\d+%|—)$/.test(rate), 'a Rate cell is a % or a gated dash: ' + rate);
});
test('hot lines Rate: n 3–4 a grey dash (no %), n 5–9 grey, 10+ the % in --text', () => {
  S.fhStateFor(match());
  const run = (c, n) => { const rows = Array.from({ length: n }, (_, i) => ({ mid: 'm' + i, date: '2026-07-0' + (i % 9 + 1), tourn: 'T', surface: 'Hard', pS: 2, oS: 0, sets: [[6, 1], [6, 1]], tot: i < c ? 30 : 12, diff: 10, bo: 3, tbN: 0, decider: false }));
    const sc = { scored: [{ k: 0, L: { g: 'tot', name: 'Over 22.5 games', need: 'games', bo3: true, cov: r => r.tot > 22.5, basis: '' }, name: 'Over 22.5 games', n, c, r: c / n }], covMap: {} };
    return S.fhFormHotHtml({ idx: 0, name: 'A', HC: 'x', hot: { ok: true, sc, hdr: { win: 'Last 10', surf: 'Hard', role: 'Any role' }, short: false, few: false,
      table: S.hotTable(rows, sc) } }); };
  assert.match(run(3, 4), /data-ma-gate="nopct"[^>]*>—</); assert.doesNotMatch(run(3, 4), />75%</);
  assert.match(run(5, 7), /data-ma-gate="small"[^>]*color:var\(--text-label\);[^>]*>71%</);
  assert.match(run(9, 12), /data-ma-gate="full"[^>]*color:var\(--text\);[^>]*>75%</);
});

// Mutation: the hot-line header back to one ctx string, or the Short chip shown again (DF L4773 short:false).
test('hot lines: "window · surface · role" header under the name; the Short chip never shows (the file hard-codes it off)', () => {
  const m = match(); const F = S.fhStateFor(m);
  const P = player(m, { n: 10 });
  assert.equal(P.hot.short, false);
  const H = S.fhFormHotHtml(P);
  assert.match(text(H), /A\. Tester Last 10 All surfaces Any role/);
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
test('profit figures that count retirements carry "Retirements settled on the official ATP result." (one constant)', () => {
  const NOTE = globalThis.MarketEdgeCore.RET_SETTLE_NOTE;
  assert.equal(NOTE, 'Retirements settled on the official ATP result.');
  const many = Array.from({ length: 6 }, (_, i) => row(`2026-07-${String(18 - i).padStart(2, '0')}`, 'P. ' + ['Alpha', 'Bravo', 'Carlo', 'Delta', 'Echo', 'Foxtrot'][i], i % 2 === 0, [[6, 4], [6, 3]]));
  const cl = { rows: many.map(r => ({ date: r.date, opp: r.opponent, won: r.won, P: [1.7, 2.2], B: null, ret: false, oppKey: null })), cap: [] };
  const m = match({ _fhFormRows: [many, many], _fhFormSrc: ['form', 'form'], _fhCloses: [cl, cl] });
  const A = player(m, {}, 0), B = player(m, {}, 1);
  assert.ok(A.mktOk, `market figures shown (n ${A.n}, priced ${A.np})`);
  assert.ok(S.fhFormColumnHtml(A, false).includes(' · ' + NOTE + '"'), 'the v market pill\'s tooltip');
  const d = S.fhFormDataRows(A, B, [['flat', 'Flat 1u', 'P/L'], ['medP', 'Median odd', 'x']]);
  assert.equal((d.match(new RegExp('title="' + NOTE.replace(/\./g, '\\.') + '"', 'g')) || []).length, 2, 'both Flat 1u values, and no other figure');
});

// Mutation: Form draws its rows / bar tooltips with its own renderer again (founder 2026-09-29, DoD item 8).
test('Form renders rows with maMatchRowsHtml and bar tooltips with maTipHtml; no Form-local row or tooltip renderer', () => {
  assert.ok(!/\nfunction fhFormRowHtml\(|\nfunction fhFormPriceCell\(/.test(html), 'the Form row renderers are deleted');
  const P = player(match());
  const L = S.fhFormListHtml(P);
  assert.equal((L.match(/class="seg ma-row fh-frow"/g) || []).length, P.win.length, 'every listed row is the shared row');
  assert.ok(L.includes('padding:10px 14px 8px') && L.includes('padding:11px 14px 5px') && L.includes('padding:0 8px;'), 'Form inset = parameters of the shared helper');
  const col = S.fhFormColumnHtml(P, false);
  assert.equal((col.match(/class="elotip fh-bar"/g) || []).length, P.win.length, 'every bar is the shared tooltip');
  assert.ok(!/fh-elotip/.test(col), 'no Form-local tooltip class');
  assert.ok(col.includes('style="bottom:20px;"'), 'the file\'s tooltip offset is a parameter');
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
test('Form filters: one nowrap row of four Darker tracks, Last N on its own track', () => {
  const src = slice('fhBuildForm');
  assert.match(src, /<div class="fh-filters" style="display:flex; align-items:center; gap:10px; flex-wrap:nowrap; overflow-x:auto; margin-bottom:22px;">\$\{surf\}\$\{vr\}\$\{role\}\$\{vr\}\$\{mode\}\$\{valsHtml\}<\/div>/);
  assert.equal((src.match(/= fhSegTrack\(/g) || []).length, 4, 'four tracks: surface, role, Matches/Days, Last N');
  const t = S.fhSegTrack([{ label: 'Last 5', on: false, onclick: 'x()' }, { label: 'Last 10', on: true, onclick: 'y()' }]);
  assert.match(t, /^<div class="fh-track" style="display:inline-flex; flex:0 0 auto; gap:4px; background:var\(--card\); border:1px solid var\(--edge-6\); border-radius:9px; padding:3px;">/);
  assert.match(t, /padding:5px 11px;[^"]*font-weight:700; color:var\(--text\); background:var\(--inner\); border:1px solid var\(--edge-10\);[^>]*>Last 10</);
  assert.match(t, /font-weight:600; color:var\(--text-label\); background:transparent; border:1px solid transparent;[^>]*>Last 5</);
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
