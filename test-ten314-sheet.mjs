// TEN-314 (TEN-312 Phase 1, founder 2026-09-28): ONE match stats sheet. fhOpenSheet (Form / H2H / Market edge) and
// the Match Stats tab's old buildMatchStatsSheet path are one component; every match row, dot and cell on every tab
// opens it; the design's Key stats scope is the one it opens on; a match without a box score still opens it, header
// wired, every stat a dash and "Match stats not available for this match" (10.5px, faint) under it.
// Every check names the mutation that turns it red; tools/test-ten314-mutants.js applies each one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN314_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
// TEN-327: the sheet's Serve / Return ratings come from the shared helper the page loads by <script src>.
const HOUSE_RATINGS_SRC = readFileSync(join(HERE, 'house-ratings.js'), 'utf8');
function slice(name) {
  let start = html.indexOf(`\nfunction ${name}(`);
  if (start < 0) start = html.indexOf(`\nasync function ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let d = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; }
  return html.slice(start, i + 1);
}
function sliceBlock() {
  const a = html.indexOf('/* =====================================================================\n   TEN-263 ');
  const b = html.indexOf('/* ---------- TOURNAMENT SUB-TAB ---------- */');
  assert.ok(a > 0 && b > a, 'TEN-263 block not found');
  return html.slice(a, b);
}
const S = new Function(`
  const document = { addEventListener(){}, getElementById(){ return null; }, querySelector(){ return null; },
    head: { appendChild(){} }, createElement(){ return { set textContent(v){} }; } };
  const playerProfiles = {};
  function aAvatarHtml(name, key){ return '<AV ' + name + '|' + key + '>'; }
  function formPanelHtml(){ return ''; } function ensureFormRows(m){ return Promise.resolve(m); } function loadCareerHistory(){ return Promise.resolve([]); }
  const HouseRatings = (function(){ const window = {}; ${HOUSE_RATINGS_SRC}; return window.HouseRatings; })();
  ${['escapeHtml', 'surnameFirstName', 'psShortName', 'formIni', 'ppCleanTournamentName', 'h2hRoundLabel', 'eventKeyOfMatch'].map(slice).join('\n')}
  ${sliceBlock()}
  return { fhSheetModel, fhSheetKeyModel, fhSheetKeyHtml, fhSheetStatsHtml, fhSheetHeadHtml, fhSheetTabs, MA_SHEET_NA };
`)();
const SIDE = (o = {}) => Object.assign({
  'Service:Aces': 5, 'Service:Double Faults': 1, 'Points:Winners': 28, 'Points:Unforced errors': 18,
  raw: { 'Service:1st serve points won': { won: 35, total: 46 }, 'Service:2nd serve points won': { won: 15, total: 30 },
    'Service:Break Points Saved': { won: 4, total: 4 }, 'Return:1st return points won': { won: 12, total: 43 },
    'Return:2nd return points won': { won: 15, total: 27 }, 'Return:Break Points Converted': { won: 2, total: 3 },
    'Points:Service Points Won': { won: 50, total: 76 }, 'Points:Return Points Won': { won: 27, total: 70 },
    'Points:Total Points Won': { won: 77, total: 146 }, 'Games:Service games won': { won: 10, total: 10 },
    'Games:Return games won': { won: 2, total: 10 } } }, o);

// Mutation: drop a Key stats row, or compute Winners / total points over the player's OWN points won (77) instead of
// the match's total points (146).
test('Key stats = the design keySection: six rows, each ratio with its counts, values from the Match model', () => {
  const K = S.fhSheetKeyModel({ own: SIDE(), opp: SIDE({ 'Points:Winners': 20, 'Points:Unforced errors': 25 }) });
  assert.deepEqual(K.map(r => r.label), ['Dominance ratio', 'Serve rating', 'Return rating', 'Winners / total points',
    'Unforced errors / total points', 'Winners / unforced errors']);
  const M = S.fhSheetModel({ own: SIDE(), opp: SIDE() });
  assert.equal(K[0].a.txt, M.dr[0].txt, 'DR is the Match scope\'s DR');
  assert.equal(K[1].a.txt, M.sections[0].rows[0].a.txt, 'Serve rating is the Match scope\'s');
  assert.equal(K[3].a.txt, (28 / 146).toFixed(2)); assert.equal(K[3].a.sub, '(28/146)');
  assert.equal(K[4].b.txt, (25 / 146).toFixed(2));
  assert.equal(K[5].a.txt, (28 / 18).toFixed(2)); assert.equal(K[5].a.sub, '(28/18)');
});

// Mutation: fhSheetStatsHtml returns the old message-only empty state (no sections), or the note is dropped.
test('no box score: the sections still draw, every stat a dash, with the 10.5px faint note', () => {
  for (const h of [S.fhSheetStatsHtml(null, 'x'), S.fhSheetKeyHtml(null)]) {
    assert.ok(h.includes(S.MA_SHEET_NA), 'the note');
    assert.match(h, /class="ma-sheet-na" style="font-size:10\.5px; color:var\(--text-faint\);/);
  }
  const full = S.fhSheetStatsHtml(null, 'x');
  assert.ok(/>Service</.test(full) && />Return</.test(full) && />Points won</.test(full), 'every section drawn');
  assert.ok(!/\d+\.\d%/.test(full), 'no figure anywhere');
  assert.equal(S.MA_SHEET_NA, 'Match stats not available for this match');
  assert.ok(!S.fhSheetStatsHtml({ own: SIDE(), opp: SIDE() }).includes(S.MA_SHEET_NA), 'a match with stats carries no note');
});

// Mutation: fhSheetInit opens on 'match' again (the design opens on Key stats), or the Key stats tab is dropped.
test('the sheet opens on Key stats (DF mkSheet default), tabs Match · Key stats · Set n · Point by point', () => {
  assert.match(slice('fhSheetInit'), /\n    scope: 'key',/);
  const tabs = S.fhSheetTabs({ scope: 'key', nSets: 2, sets: { 1: {}, 2: {} }, hasPbp: true, slot: 'tab' });
  assert.deepEqual(tabs.map(t => t.label), ['Match', 'Key stats', 'Set 1', 'Set 2', 'Point by point']);
  assert.ok(tabs.every(t => t.onclick.endsWith(",'tab')")), 'every tab drives its own slot (pop-up and inline tab never cross)');
});

// Mutation: fhSheetHeadHtml back to initials-in-rings (D5), or the inline tab keeps the ✕ / set chips.
test('header: D5 avatars in the 56px ring; the inline copy (Match Stats tab) has no ✕ and no set chips', () => {
  const e = { aName: 'J. Sinner', aKey: 7, bName: 'C. Alcaraz', bKey: 8 };
  const r = { sets: [[6, 4], [4, 6], [7, 6]], pS: 2, oS: 1, won: true, price: 1.54, oppPrice: 2.62, tourn: 'Washington', surface: 'Hard', round: 'QF', date: '2026-07-20' };
  const pop = S.fhSheetHeadHtml(e, r), tab = S.fhSheetHeadHtml(e, r, { inline: true });
  assert.ok(pop.includes('<span class="fh-av"><AV J. Sinner|7></span>') && pop.includes('<AV C. Alcaraz|8>'));
  assert.ok(pop.includes('fhCloseSheet()') && />7-6</.test(pop));
  assert.ok(!tab.includes('fhCloseSheet()') && !/>7-6</.test(tab));
  assert.ok(tab.includes('SINNER WON') || /won 6-4 4-6 7-6/i.test(tab), 'the result pill');
  assert.match(html, /\.fh-av img, \.fh-av \.avatar-fallback\{ width:56px; height:56px; border-radius:50%; border:2px solid var\(--line-open\);/);
});

// Mutation: the Match Stats tab back to buildMatchStatsSheet for a completed match, or maMsSheetInit not called.
test('the Match Stats tab renders THE sheet inline for a finished match, filled from the match\'s own box score', () => {
  assert.match(slice('buildMatchStatsSection'), /if \(hasPointLog\) return maMsSheetHtml\(m\);/);
  assert.match(html, /  matchstats\(m\)\{ aPaint\('aSectionMatchStats', buildMatchStatsSection\(m\)\); maMsSheetInit\(m\); \},/);
  const entry = new Function('eventKeyOfMatch', 'h2hRoundLabel', '_mcCloseOf', `${slice('maMsSheetEntry')}; return maMsSheetEntry;`)(
    () => 99, x => x, (m, w) => (w === 'p1' ? 1.54 : 2.62));
  const E = entry({ p1: 'A', p1Key: 1, p2: 'B', p2Key: 2, tour: 'ATP X', finalScore: { sets: [{ p1: 6, p2: 4 }, { p1: 6, p2: 3 }], p1Sets: 2, p2Sets: 0, winner: 'p1' },
    matchStats: { p1: { 'Service:Aces': 3 }, p2: { 'Service:Aces': 9 } }, setStats: { 1: { p1: { a: 1 }, p2: { a: 2 } } } });
  assert.deepEqual(E.r.sets, [[6, 4], [6, 3]]); assert.equal(E.r.won, true); assert.equal(E.r.ek, '99');
  assert.deepEqual([E.r.price, E.r.oppPrice], [1.54, 2.62]);
  assert.deepEqual(E.r.inline.match, { own: { 'Service:Aces': 3 }, opp: { 'Service:Aces': 9 } }, 'p1 = A, oriented like the header');
  assert.deepEqual(Object.keys(E.r.inline.sets), ['1']);
});

// Mutation: put back meSheetOk (Market edge rows without stats on file stop opening), or drop the row opener from
// the Overview drill / Tournament / Playing-style rows.
test('every match row opens the sheet: Market edge rows unconditionally; Overview, Tournament and Playing style through maRowOnclick', () => {
  const me = slice('meRowsHtml');
  assert.ok(me.includes(`onclick="meOpenRow('\${r.mid}')"`) && !/meSheetOk|\? ` onclick/.test(me));
  assert.ok(!html.includes('function meSheetOk('), 'the stats-on-file gate is gone');
  assert.match(slice('showOverviewMatches'), /const click = maRowOnclick\(\{ key: playerKey,/);
  assert.match(slice('atournMatchRowHtml'), /const click = maRowOnclick\(\{ key: opts\.playerKey,/);
  assert.match(slice('styleVsArchetypeRowHtml'), /const click = side \? maRowOnclick\(/);
  assert.match(slice('psvListHtml'), /styleVsArchetypeRowHtml\(r, side\)/);
});

// The row opener over a fake history; `modalOpen` models #analysisModal.open.
function rowOpener(history, opts = {}) {
  const opened = [], map = {}; let modalOpen = opts.open !== false;
  const document = { getElementById: () => ({ classList: { contains: () => modalOpen } }) };
  const api = new Function('document', 'loadCareerHistory', 'fhLoadCloses', 'meRowFromCareer', 'fhFinishRow', 'fhNameKey', 'fhSafeId', 'fhStateFor', 'fhOpenSheet', '_aMref',
    `let _aM = _aMref; const _maRowReg = {}; let _maRowSeq = 0; ${slice('maRowOnclick')} ${slice('maSameOpp')} let _maRowReq = 0; ${slice('maOpenRowSheet')}
     return { maRowOnclick, maOpenRowSheet, setM: x => { _aM = x; } };`)(
    document, () => (opts.slow ? new Promise(r => setTimeout(() => r(history), 5)) : Promise.resolve(history)), () => Promise.resolve(null),
    (x) => ({ mid: 'career:' + x.eventKey, opp: x.opponent, oppKey: null }), r => { r.finished = true; },
    n => String(n || '').replace(/^[A-Z][-A-Za-z]*\.\s*/, '').toLowerCase().replace(/[^a-z]/g, ''), x => x,
    () => ({ sheetMap: map }), mid => opened.push(mid), { id: 'm' });
  const click = d => { const id = /maOpenRowSheet\('(mr\d+)'\)/.exec(api.maRowOnclick(d))[1]; api.maOpenRowSheet(id); };
  return { click, opened, map, api, close: () => { modalOpen = false; } };
}
const tick = () => new Promise(r => setTimeout(r, 10));

// Mutation: maOpenRowSheet opens nothing when the career history has no matching row (the fallback dropped).
test('a row the career history cannot place still opens the sheet, headed from the row itself', async () => {
  const O = rowOpener([{ eventKey: 5, date: '2026-01-01', opponent: 'X' }]);
  O.click({ key: 1, name: 'A', ek: null, date: '2025-05-05', opp: 'Y', fallback: { won: true, sets: [[6, 1]] } }); await tick();
  assert.equal(O.opened.length, 1);
  const e = O.map[O.opened[0]];
  assert.ok(e && e.r.finished && e.r.opp === 'Y' && e.r.won === true && e.aName === 'A', 'fallback row, finished, headed from the row');
  O.click({ key: 1, name: 'A', ek: 5, opp: 'X' }); await tick();
  assert.equal(O.opened[1], 'career:5', 'a history row joined by event key goes through meRowFromCareer (prices, flags)');
});

// Mutation: the date join back to exact name keys (review 2026-09-28: 0 of Munar's 235 meetings joined), or it accepts
// one of two same-date candidates.
test('a Playing-style meeting (full names) joins its career-history row (short names) on the date — only when exactly one qualifies', async () => {
  const O = rowOpener([{ eventKey: 7, date: '2026-02-12', opponent: 'K. Khachanov' }, { eventKey: 8, date: '2026-03-01', opponent: 'A. Davidovich Fokina' },
    { eventKey: 9, date: '2026-04-04', opponent: 'J. Lehecka' }, { eventKey: 10, date: '2026-04-04', opponent: 'J. Lehecka' }]);
  O.click({ key: 1, name: 'A', date: '2026-02-12', opp: 'Karen Khachanov' }); await tick();
  O.click({ key: 1, name: 'A', date: '2026-03-01', opp: 'Alejandro Davidovich Fokina' }); await tick();
  O.click({ key: 1, name: 'A', date: '2026-04-04', opp: 'Jiri Lehecka', fallback: { won: false } }); await tick();
  assert.deepEqual(O.opened.slice(0, 2), ['career:7', 'career:8']);
  assert.ok(!String(O.opened[2]).startsWith('career:'), 'two candidates on one date: never a guess');
});

// Mutation: drop the `.open` / request-token guard (a late history fetch opens a sheet into a closed modal, which then
// shows over the next match — review 2026-09-28).
test('a late fetch opens nothing once the modal is closed, reopened, or a later row was clicked', async () => {
  const O = rowOpener([{ eventKey: 5, date: '2026-01-01', opponent: 'X' }], { slow: true });
  O.click({ key: 1, name: 'A', ek: 5, opp: 'X' }); O.close(); await tick();
  assert.deepEqual(O.opened, [], 'closed');
  const P = rowOpener([{ eventKey: 5, date: '2026-01-01', opponent: 'X' }, { eventKey: 6, date: '2026-01-02', opponent: 'Y' }], { slow: true });
  P.click({ key: 1, name: 'A', ek: 5, opp: 'X' }); P.click({ key: 1, name: 'A', ek: 6, opp: 'Y' }); await tick();
  assert.deepEqual(P.opened, ['career:6'], 'only the last click opens');
  assert.match(slice('closeAnalysisModal'), /fhCloseSheet\(\)/);
  assert.match(slice('openAnalysisModal'), /fhCloseSheet\(\); _maMsSheet = null;/);
});

// Mutation: drop the Match-scope switch from printAnalysisReport (the report prints the six Key stats rows only).
test('Download report prints the Match Stats sheet\'s full box score, not its Key stats', () => {
  const p = slice('printAnalysisReport');
  assert.ok(p.indexOf("_maMsSheet.scope = 'match'; fhSheetRender('tab');") > p.indexOf('aBuildForReport()'), 'after the tabs are built');
});

// Mutation: put the footer line back.
test('the modal carries no footer line (founder 2026-09-28: no real data timestamp → nothing)', () => {
  assert.ok(!html.includes('All stats are updated live') && !html.includes('aanalysisfooter'));
});
