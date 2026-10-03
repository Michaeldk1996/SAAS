// TEN-331 (TEN-312 H2H tab, founder 2026-09-28 / 2026-09-29) — the H2H tab rebuilt on the design file.
// Every check drives the page's REAL code (the TEN-263 block sliced out of bsp-consult-dashboard.html and executed) and
// names the mutation that turns it red; tools/test-ten331-mutants.js applies each one to a copy of the page (TEN331_HTML).
//   · N1: opens on All · one record card with the tug bar from the centre (DF L4351), drawn at any n ≥ 1, no %
//   · the small-sample chip for every n 1–9 · a walkover is listed ("w/o") and counted nowhere (N2)
//   · hot lines need ≥ 3 eligible meetings, their bar follows the gate; column-head dots are the neutral surface token
//   · the price range names the book actually used; n = 1 / 2 carry their count; the pop-up is the shared tooltip
//   · DoD 8: meetings are maMatchRowsHtml rows (one group per meeting, "surface · level"), every one opens the sheet
//   · the Breakdown drawers (sets / tiebreaks / deciding sets); an empty drawer says so (DESIGN GAP G10)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN331_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const HOUSE_RATINGS_SRC = readFileSync(join(HERE, 'house-ratings.js'), 'utf8');
globalThis.MarketEdgeCore = createRequire(import.meta.url)(join(HERE, 'market-edge-core.js'));
function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let d = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; }
  return html.slice(start, i + 1);
}
function block() {
  const a = html.indexOf('/* =====================================================================\n   TEN-263 ');
  const b = html.indexOf('/* ---------- TOURNAMENT SUB-TAB ---------- */');
  assert.ok(a > 0 && b > a, 'TEN-263 block not found');
  return html.slice(a, b);
}
const PS_TOUR_META_SRC = /const PS_TOUR_META = \(\(\) => \{[\s\S]*?\n\}\)\(\);/.exec(html)[0];
const S = new Function(`
  const document = { addEventListener(){}, getElementById(){ return null; }, querySelector(){ return null; }, querySelectorAll(){ return []; },
    head: { appendChild(){} }, createElement(){ return { set textContent(v){} }; } };
  const playerProfiles = {};
  function formPanelHtml(){ return ''; } function ensureFormPanelTabs(){}
  function ensureFormRows(m){ return Promise.resolve(m); } function loadCareerHistory(){ return Promise.resolve([]); }
  function ensureStyleMeetings(m){ return Promise.resolve(m); } function ensurePsMatrix(){ return Promise.resolve(); }
  function ppStyleFor(){ return null; } function psArchFor(){ return null; } function styleMeetRowsFor(){ return []; }
  function openPlayerProfileFromMatch(){} function aGoTab(){}
  const HouseRatings = (function(){ const window = {}; ${HOUSE_RATINGS_SRC}; return window.HouseRatings; })();
  ${PS_TOUR_META_SRC}
  ${['escapeHtml', 'surnameFirstName', 'psShortName', 'formIni', 'ppCleanTournamentName', 'psNormTour', 'psTourMeta', 'psRoundAbbr', 'h2hRoundLabel', 'eventKeyOfMatch'].map(slice).join('\n')}
  ${block()}
  return { fhBuildH2H, fhH2hRecCard, fhH2hSetScores, fhStateFor, fhH2hToList, get fh(){ return _fh; } };
`)();
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// Fixture: J. Sinner v C. Alcaraz. meet(date, won, sets, extra) → one api-tennis H2H row + p1's form row (the set scores).
let EK = 7000;
function fixture(specs, extra) {
  const list = [], form = [];
  for (const [date, won, sets, x] of specs) {
    const ek = ++EK, o = x || {};
    const done = sets.filter(s => Math.max(s[0], s[1]) >= 6 && (Math.abs(s[0] - s[1]) >= 2 || Math.max(s[0], s[1]) === 7));
    const pS = done.filter(s => s[0] > s[1]).length;
    list.push({ date, tournament: o.t || 'ATP Test Open', round: o.rd || 'ATP Test Open - Final', surface: o.s || 'hard', p1Won: won,
      result: o.wo ? '0 - 0' : pS + ' - ' + (done.length - pS), eventKey: ek, level: 'ATP', qualifying: false });
    form.push({ opponent: 'C. Alcaraz', opponentKey: '2', date, tournament: o.t || 'ATP Test Open', round: 'Final', surface: o.s || 'hard',
      result: o.wo ? '0 - 0' : pS + ' - ' + (done.length - pS), won, retired: !!o.ret, walkover: !!o.wo, qualifying: false, tier: 'atp', eventKey: ek,
      sets: o.wo ? [] : sets.map(s => { const r = { p: s[0], o: s[1] }; if (s[2] != null) { if (s[0] < s[1]) r.pTb = s[2]; else r.oTb = s[2]; } return r; }) });
  }
  return Object.assign({ id: 'fx-h2h-' + String.fromCharCode(97 + (EK % 26)), p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: '1', p2Key: '2', surface: 'hard', date: '2026-09-01',
    h2h: { matches: list }, p1RecentFormMatches: form, p2RecentFormMatches: [], _fhH2hData: true,
    _fhCh: [[{ date: '2019-01-01', level: 'atp' }], [{ date: '2019-01-01', level: 'atp' }]], _fhCloses: [null, null] }, extra || {});
}
const W2 = [[6, 3], [6, 4]], L2 = [[3, 6], [4, 6]];
const d = i => '2024-0' + (1 + (i % 9)) + '-1' + (i % 9);   // distinct dates
const nMeet = (n, wonFn) => fixture(Array.from({ length: n }, (_, i) => [d(i), wonFn(i), wonFn(i) ? W2 : L2]));
const build = (m, st) => { S.fhStateFor(m); if (st) Object.assign(S.fh.h2h, st); return S.fhBuildH2H(m); };
const cardOf = h => h.slice(h.indexOf('>Overall<') > 0 ? h.lastIndexOf('<div', h.indexOf('Meetings ↓')) : 0, h.indexOf('fh-h2stat'));

// Mutation 'N1: H2H opens on today's surface'
test('N1: H2H opens on All surfaces (Form opens on today\'s surface)', () => {
  const m = nMeet(3, () => true); m.surface = 'clay';
  S.fhStateFor(m);
  assert.equal(S.fh.h2h.surf, 'all');
  assert.match(build(m), /class="seg" onclick="fhH2h\(\{surf:'all'[^"]*"[^>]*font-weight:700/, 'the All chip is the selected one');
});
// Mutations 'tug: the split bar back', 'tug: a % printed beside the bar', 'record: label ignores the filter'
test('record card: one card, the tug bar from the centre at any n ≥ 1 (a count, no %), label follows the filter', () => {
  const h = build(nMeet(3, i => i < 2));               // 2–1
  assert.equal((h.match(/class="fh-tug"/g) || []).length, 1, 'one record card (the file draws no "Today\'s surface" card)');
  assert.match(h, /class="fh-tug" data-tug-a="16\.66+\d*%" data-tug-b="0%"/, '2–1 pulls +1 of 3 = 16.7% left of centre');
  assert.ok(text(h).includes('+1 Sinner'), 'the tug reads as a count');
  const card = h.slice(h.indexOf('>Overall<'), h.indexOf('fh-h2stat'));
  assert.ok(!/\d%/.test(text(card)), 'no rate on the record card (n = 3 < 5; the tug is exempt from the gate, its numbers are not)');
  const one = build(nMeet(1, () => false));
  assert.match(one, /data-tug-a="0%" data-tug-b="50%"/, 'n = 1 still draws the bar');
  const lvl = build(fixture([[d(1), true, W2], [d(2), false, L2]]));
  assert.match(lvl, /data-tug-a="0%" data-tug-b="0%"/); assert.ok(text(lvl).includes('Level'));
  const m = fixture([[d(1), true, W2, { s: 'clay' }], [d(2), false, L2], [d(3), false, L2]]);
  assert.ok(build(m, { surf: 'Clay' }).includes('>On clay<'), 'filtered: "On clay", over the filtered meetings');
  assert.match(build(m, { surf: 'Clay' }), /data-tug-a="50%"/);
});
// Mutation 'chip: back to n === 2 only'
test('small-sample chip on the record card for every n 1–9, not at 10', () => {
  for (const n of [1, 3, 9]) assert.ok(build(nMeet(n, i => i % 2 === 0)).includes(`Small sample · n=${n}`), `n=${n}`);
  assert.ok(!build(nMeet(10, i => i % 2 === 0)).includes('Small sample'), 'n=10');
});
// Mutation 'N2: a walkover counted as a meeting'
test('N2: a walkover is listed as "w/o" and enters no count, tally or record', () => {
  const m = fixture([[d(1), true, W2], [d(2), true, W2], [d(3), false, [], { wo: true }]]);
  const h = build(m);
  assert.ok(h.includes('>w/o<'), 'listed, marked w/o');
  assert.match(h, /All<span[^>]*>2<\/span>/, 'surface count: 2 played');
  assert.ok(text(h).includes('2 meetings') && text(h).includes('2 on record · 1 w/o not counted'));
  assert.ok(h.includes('>2 – 0<') || />2<\/span><span[^>]*> – <\/span><span[^>]*>0</.test(h), 'record 2–0');
});
// Mutations 'N2: an all-walkover H2H lists nothing', 'N2: a w/o-only surface greyed out'
test('N2: every meeting a walkover → the card reads 0–0 and the w/o rows are still listed (DESIGN GAP G11)', () => {
  const m = fixture([[d(1), true, [], { wo: true }], [d(2), false, [], { wo: true, s: 'clay' }]]);
  const h = build(m);
  assert.ok(h.includes('id="fhH2hList"') && (h.match(/>w\/o</g) || []).length === 2, 'both walkovers listed');
  assert.ok(text(h).includes('No meetings') && text(h).includes('0 on record · 2 w/o not counted'));
  assert.ok(!h.includes('Price range') && !h.includes('Hot lines') && !h.includes('fh-h2stat'), 'nothing to tally, price or rank');
  assert.match(h, /class="seg" onclick="fhH2h\(\{surf:'all'/, 'All stays clickable');
  assert.match(h, /class="seg" onclick="fhH2h\(\{surf:'Clay'[^>]*>Clay<span[^>]*>0<\/span>/, 'a w/o-only surface opens (its count stays 0)');
  assert.ok(!text(h).includes('No meetings on all'));
});
// Mutation 'price: header counts a today price it does not draw'
test('price header: today\'s Bet365 price is named only where it is drawn (the range marker, n ≥ 2)', () => {
  const m = nMeet(3, () => true);
  m._fhCloses = [{ rows: [{ date: d(0), opp: 'Alcaraz C.', won: true, P: [1.8, 2.0], B: null, oppKey: '2' }], cap: [] }, null];
  m.bet365Now = { p1: 1.7, p2: 2.1 };
  assert.ok(build(m).includes('· Closing odds · Pinnacle<'), 'n = 1: no Today marker, so today\'s book is not named');
  m._fhCloses[0].rows.push({ date: d(1), opp: 'Alcaraz C.', won: true, P: [1.9, 1.95], B: null, oppKey: '2' });
  assert.ok(build(m).includes('Pinnacle, Bet365 where missing (today)'), 'control: n = 2 draws Today, so its book is named');
});
// Mutations 'today: the dash loses its reason', 'text: the section loses its foundation ink (inherits the page)'
test('Today with no Pinnacle / Bet365 price: a dash with its reason; the section\'s own ink is the design token', () => {
  const m = nMeet(3, () => true);
  m._fhCloses = [{ rows: [0, 1].map(i => ({ date: d(i), opp: 'Alcaraz C.', won: true, P: [1.8 + i / 10, 2.0], B: null, oppKey: '2' })), cap: [] }, null];
  m.bookNow = { Betano: { p1: 1.12, p2: 6.2 } }; m.bestOdds = { p1: { price: 1.12 }, p2: { price: 6.2 } };
  const h = build(m);
  assert.match(h, /Today <span class="fh-today-dash" title="No Pinnacle or Bet365 price for today on record[^"]*"[^>]*>—</, 'Betano / bestOdds never stand in');
  assert.ok(!h.includes('Today 1.12'));
  // TEN-376 Foundation: the modal's own --ma-s-e7e9ee ink is gone; the section's ink is the one foundation token (tokens.css).
  assert.match(block(), /#aSectionH2H\{ color:var\(--text\); \}/, 'uncoloured text takes the foundation ink token (re-themes Night / Day)');
});
// Mutations 'hot lines: appear under 3', 'hot lines: bar ignores the gate', 'hot lines: column dots coloured by surface'
test('hot lines: ≥ 3 meetings to appear; a 3-of-3 bar draws no fill; neutral column-head dots', () => {
  assert.ok(text(build(nMeet(2, () => true))).includes('Not enough meetings to rank lines (n=2)'));
  const h = build(nMeet(3, () => true));
  assert.ok(h.includes('3 of 3'), 'a line appears at 3');
  // one retirement: the Bo3-completed lines have 2 eligible meetings and never appear, even under "Show all lines"
  const r = build(fixture([[d(1), true, W2], [d(2), true, W2], [d(3), true, [[6, 3], [2, 1]], { ret: true }]]), { allLines: true });
  assert.ok(!/ of 2</.test(r) && !r.includes('Over 22.5 games'), 'a line on 2 eligible meetings is not shown');
  assert.ok(r.includes('wins set 1'), 'control: set-1 lines (3 eligible) show');
  assert.match(h, /data-ma-gate="nopct" style="height:5px;[^"]*"><span style="width:0%; background:transparent;/, 'n = 3: no %, no fill');
  assert.ok(/data-ma-gate="full"/.test(build(nMeet(10, () => true))), 'control: n = 10 fills');
  const head = h.slice(h.indexOf('>LINE<'), h.indexOf('>HANDICAP<') > 0 ? h.indexOf('>HANDICAP<') : h.indexOf('fh-h2wrap') + 99999);
  // TEN-376 Foundation: match-analysis-tokens.css (which re-pointed --court-* to --ma-t1 inside the modal) is deleted;
  // the builder's surface map itself is now the neutral --text-soft for every surface ("surfaces neutral").
  assert.ok(/border-radius:50%; background:var\(--text-soft\);/.test(head), 'column dot = the neutral surface token');
  const FH_SURF = /\nconst FH_SURF = (\{[^\n]*\});/.exec(html);
  assert.ok(FH_SURF, 'FH_SURF found');
  assert.equal(FH_SURF[1], "{ Hard: 'var(--text-soft)', Clay: 'var(--text-soft)', Grass: 'var(--text-soft)' }", 'every surface neutral (never clay amber)');
});
// Mutations 'price: n=2 loses its count', 'price: the pop-up back on a tab-local tooltip', 'price: header names one book over mixed data'
test('price range: book actually used, n = 1 / 2 carry their count, the pop-up is the shared tooltip', () => {
  const rows = (k) => Array.from({ length: k }, (_, i) => ({ date: d(i), opp: 'Alcaraz C.', won: true, P: i === 0 ? null : [1.8 + i / 10, 2.0], B: i === 0 ? [1.7, 2.1] : null, oppKey: '2' }));
  const shard = (k) => ({ rows: rows(k), cap: [] });
  const withP = (k) => { const m = nMeet(3, () => true); m._fhCloses = [shard(k), null]; return build(m); };
  const one = withP(1), two = withP(2), three = withP(3);
  assert.ok(text(one).includes('1 of 3 meetings priced') && one.includes('>n=1<'));
  assert.ok(two.includes('title="Range built from 2 priced meetings"') && two.includes('>n=2<'), 'n = 2 shows its count');
  assert.ok(!three.includes('Range built from'), 'control: n = 3 carries no count');
  assert.ok(three.includes('Closing odds · Pinnacle, Bet365 where missing (1 meeting)'), 'the book actually used');
  assert.match(three, /<div class="elotip fh-prtip" style="position:relative; display:block; display:grid;/, 'the shared tooltip wraps the figures');
  assert.ok(three.includes('every priced close') && three.includes('class="elotip-pop"'));
  assert.ok(!/fh-elotip/.test(html), 'no tab-local tooltip class anywhere');
  assert.ok(three.includes('Retirements settled on the official ATP result.'), 'TEN-325 note on the price range');
});
// Mutations 'DoD 8: an H2H-local row renderer again', 'rows: group meta loses the level', 'rows: a row stops opening the sheet'
test('DoD 8: meetings are the shared helper\'s rows, one group per meeting, each opening the sheet', () => {
  assert.ok(!/function fhH2hRowHtml\(|function fhStickyHeadHtml\(|function fhWlChip\(/.test(html), 'no H2H row renderer left in the page');
  const m = fixture([[d(1), true, W2], [d(2), true, W2, { s: 'clay' }], [d(3), false, [[6, 7, 4], [2, 1]], { ret: true }]]);
  const h = build(m);
  const list = h.slice(h.indexOf('id="fhH2hList"'));
  assert.equal((list.match(/<div class="ma-rows"/g) || []).length, 1);
  assert.equal((list.match(/class="seg ma-row fh-h2row"/g) || []).length, 3);
  assert.equal((list.match(/class="ma-rows-group"/g) || []).length, 3, 'a group per meeting, as the file');
  assert.equal((list.match(/onclick="fhOpenSheet\('h2h_/g) || []).length, 3, 'every row opens the shared sheet');
  assert.match(list, /<span title="ATP tour" style="[^"]*">Clay · ATP<\/span>/);
  assert.ok(list.includes('>6-7(4), 2-1 ret.<'), 'tiebreak points and " ret." (N2)');
  assert.ok(list.includes('>Home<') && list.includes('>Away<'));
  assert.equal(S.fhH2hSetScores({ sets: [[7, 6, 4], [6, 4, null]], ret: false }), '7-6(4), 6-4');
});
// Mutations 'drawer: an empty drawer opens nothing', 'drawer: sets rows lose " ret."'
test('Breakdown drawers: rows per meeting, each opening the sheet; an empty drawer says why (DESIGN GAP G10)', () => {
  const m = fixture([[d(1), true, W2], [d(2), false, [[3, 6], [1, 2]], { ret: true }], [d(3), true, [[6, 4], [3, 6], [6, 2]]]]);
  const sets = build(m, { stat: 'sets' });
  assert.ok(sets.includes('Sets won per meeting') && sets.includes('Hide breakdown ▴'));
  assert.equal((sets.match(/class="seg fh-h2brow" onclick="fhOpenSheet\(/g) || []).length, 3);
  assert.ok(sets.includes('3-6  1-2  ret.'), 'a retirement is marked');
  const tb = build(m, { stat: 'tb' });
  assert.ok(tb.includes('class="fh-h2drawer"') && text(tb).includes('No tiebreak in these meetings.'));
  const dec = build(m, { stat: 'dec' });
  assert.equal((dec.match(/class="seg fh-h2brow"/g) || []).length, 1, 'one match went the distance');
});
// Mutation '"Meetings ↓" resets the filter'
test('"Meetings ↓" scrolls to the list and keeps the filter (DF onOverall)', () => {
  assert.ok(!/fhH2h\(/.test(slice('fhH2hToList')));
  assert.ok(build(nMeet(3, () => true)).includes('onclick="fhH2hToList()"'));
});
test('no sample, no review switcher, no seeded data in the H2H block', () => {
  const h = build(nMeet(3, () => true));
  assert.ok(!/sample data/i.test(text(h)), 'no SAMPLE DATA chip or "Sample data." footnote');
  assert.ok(!/h2State|h2RecBar|h2Pal|Paris Masters/.test(block()), 'no design review state or demo meeting in the page');
});

// Founder Q4 (2026-09-30): no meeting → "{A} and {B} have no meeting on record." plus what was searched; the design's
// "have not played" is a named exception (our store can only say what it holds). Mutation 'Q4: the design's "have not played"'.
test('Q4: no meeting reads "have no meeting on record" with the searched scope — never "have not played"', () => {
  const h = build(fixture([]));
  const t = text(h);
  assert.ok(t.includes('No previous meetings on record J. Sinner and C. Alcaraz have no meeting on record.'), t.slice(0, 200));
  assert.match(t, /have no meeting on record\. Closest guide: [^]*ATP since 2019/, 'the line names what was searched');
  assert.ok(!/have not played/.test(t));
});

