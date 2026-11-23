// TEN-331 (TEN-312 H2H tab, founder 2026-09-28 / 2026-09-29) — the H2H tab rebuilt on the design file.
// Every check drives the page's REAL code (the TEN-263 block sliced out of bsp-consult-dashboard.html and executed) and
// names the mutation that turns it red; tools/test-ten331-mutants.js applies each one to a copy of the page (TEN331_HTML).
// Ported to the 2026-11-23 rebuild (maH2HV2 in match-analysis-v2.js):
//   · N1: opens on All · one record card, the record at any n ≥ 1 with no % · "small sample" for every n 1–9
//   · a walkover is listed ("w/o") and counted nowhere (N2)
//   · hot lines need ≥ 3 eligible meetings to rank, their rate follows the gate; column-head dots are neutral
//   · the price range names the book actually used; n = 1 / 2 carry their count; the every-close pop-up
//   · meetings grouped by year with an Event column ("surface · level"), every one opens the sheet
//   · the stat tiles open their meetings (sets / tiebreaks / deciding sets); an empty panel says so (DESIGN GAP G10)
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
// TEN-437: every H2H surface builds its meetings through h2h-core.js (window.H2HCore in the page).
globalThis.H2HCore = createRequire(import.meta.url)(join(HERE, 'h2h-core.js'));
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
// Match analysis rebuild (2026-11-23): the H2H tab is drawn by match-analysis-v2.js (maH2HV2: record card, Price range,
// Hot lines, Meetings) over the TEN-263 data layer; its source runs in the same scope. TEN331_MA2 = a mutated copy.
const { ma2Src } = createRequire(import.meta.url)(join(HERE, 'tools', 'ma2-test-load.cjs'));
const MA2_FILE = process.env.TEN331_MA2 || join(HERE, 'match-analysis-v2.js');
const MA2 = ma2Src(MA2_FILE);
const PS_TOUR_META_SRC = /const PS_TOUR_META = \(\(\) => \{[\s\S]*?\n\}\)\(\);/.exec(html)[0];
const S = new Function(`
  const document = { addEventListener(){}, getElementById(){ return null; }, querySelector(){ return null; }, querySelectorAll(){ return []; },
    head: { appendChild(){} }, createElement(){ return { set textContent(v){} }; } };
  const playerProfiles = {};
  function formPanelHtml(){ return ''; } function ensureFormPanelTabs(){}
  function ensureFormRows(m){ return Promise.resolve(m); } function loadCareerHistory(){ return Promise.resolve([]); } function careerHistoryIdOf(){ return null; }   // TEN-437 D3: no shard id in these fixtures
  function ensureStyleMeetings(m){ return Promise.resolve(m); } function ensurePsMatrix(){ return Promise.resolve(); }
  function ppStyleFor(){ return null; } function psArchFor(){ return null; } function styleMeetRowsFor(){ return []; }
  function openPlayerProfileFromMatch(){} function aGoTab(){}
  const HouseRatings = (function(){ const window = {}; ${HOUSE_RATINGS_SRC}; return window.HouseRatings; })();
  ${PS_TOUR_META_SRC}
  ${['escapeHtml', 'surnameFirstName', 'psShortName', 'formIni', 'ppCleanTournamentName', 'psNormTour', 'psTourMeta', 'psRoundAbbr', 'h2hRoundLabel', 'maRoundName', 'eventKeyOfMatch'].map(slice).join('\n')}
  ${block()}
  function aBuilt(){ return false; }
  const __MA2_ROOT = Object.create(globalThis);
  ${MA2}
  return { maH2HV2: __MA2_ROOT.maH2HV2, fhH2hSetScores, fhStateFor, fhH2hToList, get fh(){ return _fh; } };
`)();
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// Fixture: J. Sinner v C. Alcaraz. meet(date, won, sets, extra) → one meeting in BOTH players' career-history rows (TEN-437:
// the tab's meetings are H2HCore.joinMeetings over the two shards; m.h2h is not read) + p1's form row.
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
  // a board match always carries its tour and badge — the Hot lines read the match's format from them (founder 2026-10-26)
  return Object.assign({ id: 'fx-h2h-' + String.fromCharCode(97 + (EK % 26)), p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: '1', p2Key: '2', surface: 'hard', date: '2026-09-01', tour: 'ATP Basel', tourBadge: 'ATP',
    h2h: { matches: list }, p1RecentFormMatches: form, p2RecentFormMatches: [], _fhH2hData: true,
    // TEN-437 D1: each word-round meeting's event has its first main-draw round on file (p1 v a third player, same day)
    _fhCh: [form.map(x => Object.assign({}, x, { level: 'atp' })).concat([{ date: '2019-01-01', level: 'atp' }],
      form.map(x => ({ date: x.date, tournament: x.tournament, round: '1/4-finals', level: 'atp', opponent: 'K. Other', won: true, result: '2 - 0', eventKey: x.eventKey + 100000 }))),
      form.map(x => Object.assign({}, x, { level: 'atp', opponent: 'J. Sinner', opponentKey: '1', won: !x.won,
        result: String(x.result).replace(/^(\d+) - (\d+)$/, '$2 - $1'), sets: x.sets.map(t => ({ p: t.o, o: t.p, pTb: t.oTb, oTb: t.pTb })) }))
        .concat([{ date: '2019-01-01', level: 'atp' }])], _fhCloses: [null, null] }, extra || {});
}
const W2 = [[6, 3], [6, 4]], L2 = [[3, 6], [4, 6]];
const d = i => '2024-0' + (1 + (i % 9)) + '-1' + (i % 9);   // distinct dates
const nMeet = (n, wonFn) => fixture(Array.from({ length: n }, (_, i) => [d(i), wonFn(i), wonFn(i) ? W2 : L2]));
const build = (m, st) => { S.fhStateFor(m); if (st) Object.assign(S.fh.h2h, st); return S.maH2HV2(m); };
const W6 = 'color-mix(in srgb, var(--ma2-white) 6%, transparent)';
// the record card = from the card's title to the Price range card (or the Meetings list when nothing is priced/ranked)
const cardOf = h => { const a = h.indexOf('Head to head record'); const b = [h.indexOf('>Price range<'), h.indexOf('id="fhH2hList"')].filter(x => x > a); return h.slice(a, b.length ? Math.min(...b) : h.length); };
const hotOf = h => h.slice(h.indexOf('>Hot lines<'), h.indexOf('One dot per meeting'));

// Mutation 'N1: H2H opens on today's surface'
test('N1: H2H opens on All surfaces (Form opens on today\'s surface)', () => {
  const m = nMeet(3, () => true); m.surface = 'clay';
  S.fhStateFor(m);
  assert.equal(S.fh.h2h.surf, 'all');
  assert.match(build(m), /onclick="fhH2h\(\{surf:'all'[^"]*"[^>]*font-weight:700/, 'the All segment is the selected one');
});
// The 2026-11-23 design replaces the tug bar with the record figure and one dot per meeting; the rules kept: one record
// card, the record at any n ≥ 1, no rate on it (n < 5), the label follows the filter, a level record reads "Level".
// Mutations 'record: label ignores the filter', 'record: a % printed beside the record'.
test('record card: one card, the record at any n ≥ 1 (a count, no %), label follows the filter', () => {
  const h = build(nMeet(3, i => i < 2));               // 2–1
  assert.equal((h.match(/>Head to head record</g) || []).length, 1, 'one record card');
  const card = cardOf(h);
  assert.match(card, />2<span style="color:var\(--ma2-grey\);"> – <\/span>1</, 'the record 2–1');
  assert.ok(text(card).includes('Sinner leads'), 'the leader named');
  assert.ok(!/\d%/.test(text(card)), 'no rate on the record card (n = 3 < 5)');
  assert.match(cardOf(build(nMeet(1, () => false))), />0<span style="color:var\(--ma2-grey\);"> – <\/span>1</, 'n = 1 still draws the record');
  const lvl = build(fixture([[d(1), true, W2], [d(2), false, L2]]));
  assert.ok(text(cardOf(lvl)).includes('Level'));
  const m = fixture([[d(1), true, W2, { s: 'clay' }], [d(2), false, L2], [d(3), false, L2]]);
  const clay = build(m, { surf: 'Clay' });
  assert.ok(clay.includes('>On clay<'), 'filtered: "On clay", over the filtered meetings');
  assert.match(cardOf(clay), />1<span style="color:var\(--ma2-grey\);"> – <\/span>0</);
});
// Mutation 'chip: back to n === 2 only'
test('small-sample mark on the record card for every n 1–9, not at 10', () => {
  for (const n of [1, 3, 9]) assert.ok(text(cardOf(build(nMeet(n, i => i % 2 === 0)))).includes(`${n} meeting${n === 1 ? '' : 's'} · small sample`), `n=${n}`);
  assert.ok(!build(nMeet(10, i => i % 2 === 0)).includes('small sample'), 'n=10');
});
// Mutation 'N2: a walkover counted as a meeting'
test('N2: a walkover is listed as "w/o" and enters no count, tally or record', () => {
  const m = fixture([[d(1), true, W2], [d(2), true, W2], [d(3), false, [], { wo: true }]]);
  const h = build(m);
  assert.ok(/padding:2px 7px; white-space:nowrap;">w\/o</.test(h), 'listed, marked w/o');
  assert.match(h, /All<span[^>]*>2<\/span>/, 'surface count: 2 played');
  assert.ok(text(h).includes('2 meetings') && text(h).includes('2 on record · Sinner leads 2–0 · 1 w/o not counted'));
  assert.match(text(h), /2024 2–0 · 2 meetings · 1 w\/o/, 'the year header counts played meetings and names the walkover');
  assert.match(cardOf(h), />2<span style="color:var\(--ma2-grey\);"> – <\/span>0</, 'record 2–0');
});
// Mutations 'N2: an all-walkover H2H lists nothing', 'N2: a w/o-only surface greyed out'
test('N2: every meeting a walkover → the card reads 0–0 and the w/o rows are still listed (DESIGN GAP G11)', () => {
  const m = fixture([[d(1), true, [], { wo: true }], [d(2), false, [], { wo: true, s: 'clay' }]]);
  const h = build(m);
  assert.ok(h.includes('id="fhH2hList"') && (h.match(/class="seg ma2-row h2mg"/g) || []).length === 2 && (h.match(/padding:2px 7px; white-space:nowrap;">w\/o</g) || []).length === 2, 'both walkovers listed');
  assert.ok(text(h).includes('No meetings') && text(h).includes('0 on record · 2 w/o not counted'));
  assert.ok(!h.includes('>Price range<') && !h.includes('>Hot lines<') && !h.includes('Sets won'), 'nothing to tally, price or rank');
  assert.match(h, /onclick="fhH2h\(\{surf:'all'/, 'All stays clickable');
  assert.match(h, /onclick="fhH2h\(\{surf:'Clay'[^>]*>Clay<span[^>]*>0<\/span>/, 'a w/o-only surface opens (its count stays 0)');
  assert.ok(!text(h).includes('No meetings on all'));
});
// Mutation 'price: header counts a today price it does not draw'
test('price header: today\'s Bet365 price is named only where it is drawn (the range marker, n ≥ 2)', () => {
  const m = nMeet(3, () => true);
  m._fhCloses = [{ rows: [{ date: d(0), opp: 'Alcaraz C.', won: true, P: [1.8, 2.0], B: null, oppKey: '2' }], cap: [] }, null];
  m.bet365Now = { p1: 1.7, p2: 2.1 };
  assert.ok(build(m).includes('>Closing odds · Pinnacle<'), 'n = 1: no Today marker, so today\'s book is not named');
  m._fhCloses[0].rows.push({ date: d(1), opp: 'Alcaraz C.', won: true, P: [1.9, 1.95], B: null, oppKey: '2' });
  assert.ok(build(m).includes('Pinnacle, Bet365 where missing (today)'), 'control: n = 2 draws Today, so its book is named');
});
// Mutations 'today: the dash loses its reason', 'text: the section loses its design ink (inherits the page)'
test('Today with no Pinnacle / Bet365 price: a dash with its reason; the section\'s own ink is the design token', () => {
  const m = nMeet(3, () => true);
  m._fhCloses = [{ rows: [0, 1].map(i => ({ date: d(i), opp: 'Alcaraz C.', won: true, P: [1.8 + i / 10, 2.0], B: null, oppKey: '2' })), cap: [] }, null];
  m.bookNow = { Betano: { p1: 1.12, p2: 6.2 } }; m.bestOdds = { p1: { price: 1.12 }, p2: { price: 6.2 } };
  const h = build(m);
  assert.match(h, />Today<\/span><span title="No Pinnacle or Bet365 price for today on record[^"]*"[^>]*>—</, 'Betano / bestOdds never stand in');
  assert.ok(!h.includes('>1.12<'));
  assert.match(h, /^<div class="fh-h2wrap h2wrap" style="[^"]*color:var\(--ma2-text\);">/, 'uncoloured text takes the design ink token (re-themes Night / Day)');
});
// Mutations 'hot lines: appear under 3', 'hot lines: Rate ignores the gate', 'hot lines: column dots coloured by surface'
test('hot lines: ≥ 3 meetings to rank; a 3-of-3 line prints no rate (D2); white column-head dot = today\'s surface', () => {
  // founder 2026-10-26: 2 comparable meetings show results (below), never "not enough"
  assert.ok(!text(build(nMeet(2, () => true))).includes('Not enough meetings'));
  const h = build(nMeet(3, () => true));
  assert.ok(h.includes('3 of 3'), 'a line appears at 3');
  // one retirement: the Bo3-completed lines have 2 eligible meetings and never appear, even under "Show all lines"
  const r = build(fixture([[d(1), true, W2], [d(2), true, W2], [d(3), true, [[6, 3], [2, 1]], { ret: true }]]), { allLines: true });
  assert.ok(!/ of 2</.test(r) && !r.includes('Over 22.5 games'), 'a line on 2 eligible meetings is not shown');
  assert.ok(r.includes('wins set 1'), 'control: set-1 lines (3 eligible) show');
  assert.match(hotOf(h), /data-ma-gate="nopct"[^>]*color:var\(--ma2-grey\);">—</, 'n = 3: no %');
  assert.ok(!/>100%</.test(h), 'no % at n = 3');
  assert.match(build(nMeet(10, () => true)), /data-ma-gate="full"[^>]*color:var\(--ma2-text\);">100%</, 'control: n = 10 prints the rate');
  const head = hotOf(h).slice(0, hotOf(h).indexOf('Covered</span>') + 9999);
  // the head dot: white for a meeting on today's surface (the fixture is hard), white 22% otherwise — never a court colour
  const headDots = x => { const hh = hotOf(x); const g = hh.slice(hh.indexOf('>Covered<'), hh.indexOf('ma2-row h2hg')); return [...g.matchAll(/width:6px; height:6px; border-radius:50%; background:([^;]*);/g)].map(y => y[1]); };
  const dots = headDots(h);
  assert.ok(head && dots.length === 3 && dots.every(c => c === 'var(--ma2-text)'), 'today\'s-surface meetings: a white head dot');
  const md = headDots(build(fixture([[d(1), true, W2], [d(2), true, W2, { s: 'clay' }], [d(3), true, W2]])));
  assert.deepEqual(md.slice().sort(), ['color-mix(in srgb, var(--ma2-white) 22%, transparent)', 'var(--ma2-text)', 'var(--ma2-text)'], 'another surface: white 22%');
  const FH_SURF = /\nconst FH_SURF = (\{[^\n]*\});/.exec(html);
  assert.ok(FH_SURF, 'FH_SURF found');
  assert.equal(FH_SURF[1], "{ Hard: 'var(--text-soft)', Clay: 'var(--text-soft)', Grass: 'var(--text-soft)' }", 'every surface neutral (never clay amber)');
});
// Mutations 'price: n=2 loses its count', 'price: header names one book over mixed data', 'price: no TEN-325 note',
// 'price: the every-close pop-up dropped'
test('price range: book actually used, n = 1 / 2 carry their count, the every-close pop-up, the settlement note', () => {
  const rows = (k) => Array.from({ length: k }, (_, i) => ({ date: d(i), opp: 'Alcaraz C.', won: true, P: i === 0 ? null : [1.8 + i / 10, 2.0], B: i === 0 ? [1.7, 2.1] : null, oppKey: '2' }));
  const shard = (k) => ({ rows: rows(k), cap: [] });
  const withP = (k) => { const m = nMeet(3, () => true); m._fhCloses = [shard(k), null]; return build(m); };
  const one = withP(1), two = withP(2), three = withP(3);
  const priceOf = h => h.slice(h.indexOf('>Price range<'), h.indexOf('>Hot lines<'));
  assert.ok(text(one).includes('1 of 3 meetings priced') && priceOf(one).includes('>1 priced meeting<'), 'n = 1 carries its count');
  assert.ok(!/\b3 priced meetings\b|\bn=3\b/.test(text(priceOf(three))), 'control: n = 3 carries no count');
  assert.ok(three.includes('Closing odds · Pinnacle, Bet365 where missing (1 meeting)'), 'the book actually used');
  assert.ok(priceOf(three).includes('· every priced close') && priceOf(three).includes('>Average, margin removed<'), 'the every-close pop-up, its average margin-free (rule b)');
  assert.ok(!/fh-elotip/.test(html), 'no tab-local tooltip class anywhere');
  assert.match(priceOf(three), /title="Retirements settle on Pinnacle rules for all rows\."[^>]*>Closing odds/, 'TEN-325 note on the price range');
});
// modal-form-h2h.md "Price range: a range from fewer than FH_PRICE_THIN = 3 priced meetings shows an n=k chip". The old
// tab drew it (fhBuildH2H, base 3bde6a71a L16524: chip('n=' + nP) titled "Range built from N priced meetings"); the rebuilt h2Price marks n = 1
// ("1 priced meeting") but draws the n = 2 range with no count. RENDERER GAP (reported) — this test stays red until
// h2Price marks it. Mutant runners skip it by name.
test('RENDERER GAP: a price range from 2 priced meetings carries its count (FH_PRICE_THIN)', () => {
  const m = nMeet(3, () => true);
  m._fhCloses = [{ rows: [0, 1].map(i => ({ date: d(i), opp: 'Alcaraz C.', won: true, P: [1.8 + i / 10, 2.0], B: null, oppKey: '2' })), cap: [] }, null];
  const h = build(m), pr = h.slice(h.indexOf('>Price range<'), h.indexOf('>Hot lines<'));
  assert.match(text(pr.slice(pr.indexOf('meetings priced') + 15)), /\b2 priced meetings\b|\bn=2\b/, 'n = 2 shows its count on each side\'s range');
});
// Mutations 'DoD 8: an H2H-local row renderer again', 'rows: the event tag loses the level', 'rows: a row stops opening the sheet'
test('meetings: grouped by year with an Event column, the level in every tag, each row opening the sheet', () => {
  assert.ok(!/function fhH2hRowHtml\(|function fhStickyHeadHtml\(|function fhWlChip\(/.test(html), 'no H2H row renderer left in the page');
  const m = fixture([[d(1), true, W2], [d(2), true, W2, { s: 'clay' }], [d(3), false, [[6, 7, 4], [2, 1]], { ret: true }]]);
  const h = build(m);
  const list = h.slice(h.indexOf('id="fhH2hList"'));
  assert.equal((list.match(/class="seg ma2-row h2mg"/g) || []).length, 3);
  assert.equal((list.match(/<span style="font-size:12\.5px; font-weight:700; color:var\(--ma2-text\); white-space:nowrap;">2024<\/span>/g) || []).length, 1, 'TEN-380: one group per YEAR (all three in 2024)');
  assert.match(text(list), /2024 2–1 · 3 meetings/, 'the year header: W–L · count');
  assert.equal((list.match(/onclick="fhOpenSheet\('h2h_/g) || []).length, 3, 'every row opens the shared sheet');
  assert.ok(list.includes('>Event<'), 'the Event column');
  // the level is never dropped (ruling 2026-09-24): it sits in every row's event tag, after the surface; no Elo word (Q5)
  assert.match(list, /<span class="h2hide" style="[^"]*">Clay · ATP<\/span>/);
  assert.ok(list.includes('<span style="white-space:nowrap;">6-7(4),</span> <span style="white-space:nowrap;">2-1 ret.</span>'), 'tiebreak points and " ret." (N2), wrapping only between sets');
  assert.ok(list.includes('title="J. Sinner’s closing price"') && list.includes('title="C. Alcaraz’s closing price"'), 'one price column per player');
  assert.equal(S.fhH2hSetScores({ sets: [[7, 6, 4], [6, 4, null]], ret: false }), '7-6(4), 6-4');
});
// Mutations 'drawer: an empty drawer opens nothing', 'drawer: sets rows lose " ret."'
test('stat tiles open their meetings, each opening the sheet; an empty panel says why (DESIGN GAP G10)', () => {
  const m = fixture([[d(1), true, W2], [d(2), false, [[3, 6], [1, 2]], { ret: true }], [d(3), true, [[6, 4], [3, 6], [6, 2]]]]);
  const sets = build(m, { stat: 'sets' });
  assert.ok(text(sets).includes('Sets won 3 meetings · newest first') && sets.includes('onclick="fhH2h({stat:null})"'), 'the opened panel and its Close');
  assert.equal((sets.match(/class="seg ma2-row" role="button" tabindex="0" onclick="fhOpenSheet\(/g) || []).length, 3);
  assert.ok(sets.includes('3-6, 1-2 ret.'), 'a retirement is marked');
  const tb = build(m, { stat: 'tb' });
  assert.ok(text(tb).includes('No tiebreak in these meetings.'));
  const dec = build(m, { stat: 'dec' });
  assert.equal((dec.match(/class="seg ma2-row" role="button" tabindex="0" onclick="fhOpenSheet\(/g) || []).length, 1, 'one match went the distance');
});
// Mutation '"Show meetings" resets the filter'
test('"Show meetings" scrolls to the list and keeps the filter (DF onOverall)', () => {
  assert.ok(!/fhH2h\(/.test(slice('fhH2hToList')));
  assert.ok(build(nMeet(3, () => true)).includes('onclick="fhH2hToList()"'));
});
test('no sample, no review switcher, no seeded data in the H2H block', () => {
  const h = build(nMeet(3, () => true));
  assert.ok(!/sample data/i.test(text(h)), 'no SAMPLE DATA chip or "Sample data." footnote');
  // TEN-402 r1 fix 2: the one-name table (SF_EVENT_NAMES) legitimately prints "Paris Masters" for the registry's Paris — it is
  // the site's event name, not the design's demo meeting; the guard reads the block without that table.
  const noNames = block().replace(/\nconst SF_EVENT_NAMES = \{[\s\S]*?\n\};/, '');
  assert.ok(!/h2State|h2RecBar|h2Pal|Paris Masters/.test(noNames), 'no design review state or demo meeting in the page');
  const v2 = readFileSync(MA2_FILE, 'utf8'), h2 = v2.slice(v2.indexOf('// HEAD TO HEAD'), v2.indexOf('root.maH2HV2'));
  assert.ok(!/h2State|h2RecBar|h2Pal|Paris Masters/.test(h2), 'no design review state or demo meeting in the rebuilt tab');
});

// Founder Q4 (2026-09-30): no meeting → "{A} and {B} have no meeting on record." plus what was searched; the design's
// "have not played" is a named exception (our store can only say what it holds). Mutation 'Q4: the design's "have not played"'.
test('Q4: no meeting reads "have no meeting on record" with the searched scope — never "have not played"', () => {
  const h = build(fixture([]));
  const t = text(h);
  assert.ok(t.includes('No previous meetings') && t.includes('J. Sinner and C. Alcaraz have no meeting on record.'), t.slice(0, 200));
  // TEN-437: the same words as the Head to Head page — both histories, from the earliest ATP row either holds
  assert.match(t, /have no meeting on record\. [^]*Searched both players(?:'|&#39;|&#x27;) match histories since 2019\./, 'the line names what was searched');
  assert.ok(!/have not played/.test(t));
});

// TEN-380 rules kept on the 2026-11-23 design: no blue outline, no player colour on the record card; an open stat tile and
// the surface track's selected segment are lifted (tone + edge), never blue. (Titles inside their cards and the tug bar
// are the 2026-11-23 design's: superseded.) Mutations: the open tile on a blue edge, the selected segment blue.
test('TEN-380: an open tile and the selected surface segment lift (tone + edge), never blue', () => {
  const m = fixture([[d(1), true, W2], [d(2), false, L2], [d(3), true, [[6, 4], [3, 6], [6, 2]]]]);
  const h = build(m);
  assert.ok(!/var\(--fh-p[ab]\)/.test(cardOf(h)), 'no player colour on the record card');
  const open = build(m, { stat: 'sets' });
  assert.match(open, /onclick="fhH2h\(\{stat:null\}\)" title="Show the meetings behind this figure" style="background:var\(--ma2-lifted\); border:1px solid color-mix\(in srgb, var\(--ma2-white\) 22%, transparent\);/);
  const card = cardOf(open);
  assert.ok(!/open-card|--link|ma2-blue\); border|border:1px solid var\(--ma2-blue/.test(card.slice(card.indexOf('Sets won'))), 'no blue outline on the tiles or their panel');
  assert.match(h, /font-weight:700; color:var\(--ma2-text\); background:var\(--ma2-lifted\); border:1px solid color-mix\(in srgb, var\(--ma2-white\) 14%, transparent\);[^>]*>All</);
});
// TEN-380: a single meeting keeps the full layout with its n=1 marks; 0 meetings = the empty-state card on panel edges.
test('TEN-380: the 1-meeting and 0-meeting states', () => {
  const one = build(nMeet(1, () => true));
  assert.ok(text(one).includes('1 meeting · small sample') && text(one).includes('1 of 1'), 'one meeting: its results (founder 2026-10-26)');
  assert.match(text(one), /Meetings 1 on record · Sinner leads 1–0/);
  const zero = build(fixture([]));
  assert.equal((zero.match(new RegExp('background:var\\(--ma2-inner\\); border:1px solid ' + W6.replace(/[()]/g, '\\$&') + '; border-radius:11px;', 'g')) || []).length, 2, 'the two style tiles on the panel edge');
});

// Founder ruling 2026-10-26 · Hot lines from ONE meeting, format first. Mutations named per check (tools/test-ten331-mutants.js):
//   'hot: results mode off' (1–2 meetings ranked/rated as before), 'hot: format lock off' (other-format meetings count).
test('hot lines from 1 meeting: 1–2 comparable meetings show counts, never a rate or a ranking (mutant: hot: results mode off)', () => {
  for (const k of [1, 2]) {
    const h = build(nMeet(k, () => true), { allLines: false });
    const t = text(h);
    assert.ok(t.includes(k + ' of ' + k), k + ' meeting(s): each line reads "' + k + ' of ' + k + '"');
    const hot = hotOf(h);
    assert.ok(hot.length > 100 && !/\d%/.test(text(hot)), k + ': no percentage anywhere in Hot lines');
    assert.ok(!hot.includes('Most covered'), k + ': nothing is ranked');
    assert.ok(!/best[- ]covered/i.test(t), k + ': no "best-covered" wording');
    assert.match(hot, /data-ma-gate="nopct" title="Results only: fewer than 3 comparable meetings"/, k + ': the rate cell is the results-only dash');
    assert.ok(t.includes('too few to rate or rank'), k + ': the subtitle says why');
  }
  const three = build(nMeet(3, () => true));
  assert.ok(three.includes('Most covered') && text(three).includes('Best covered line'), 'control: 3 meetings rank as before');
});
test('hot lines format first: a best-of-3 match whose only meetings are best of 5 has 0 comparable meetings (mutant: hot: format lock off)', () => {
  const B5 = [[6, 3], [6, 4], [6, 2]];
  const slam = fixture([[d(1), true, B5, { t: 'Wimbledon' }], [d(2), false, [[3, 6], [4, 6], [2, 6]], { t: 'Australian Open' }]]);
  const t = text(build(slam));
  assert.ok(t.includes('No best-of-3 meetings'), 'the plain note: ' + t.slice(t.indexOf('Hot lines'), t.indexOf('Hot lines') + 120));
  assert.ok(!/best[- ]covered/i.test(t) && t.includes('Only best-of-3 meetings count'), 'no "best-covered" wording over an empty table');
  assert.ok(!/\d of \d/.test(t.slice(t.indexOf('Hot lines'), t.indexOf('Hot lines') + 400)), 'no line reads a best-of-5 meeting');
  const mixed = build(fixture([[d(1), true, B5, { t: 'Wimbledon' }], [d(2), true, W2]]));
  const mh = text(hotOf(mixed));
  assert.ok(mh.includes('1 of 1') && text(mixed).includes('one comparable meeting'),
    'one Bo3 + one Bo5: one comparable meeting: ' + mh.slice(0, 200));
  const games = mh.slice(0, mh.indexOf('Sets & tiebreaks'));
  assert.ok(!games.includes('of 2'), 'no games / set-handicap line counts the Bo5 meeting');
  // founder 2026-10-26 item 8 (reverted until ruled): the set-1 winners count EVERY meeting (mutant: hot: set-1 lines format-locked)
  assert.match(mh, /Match goes to a deciding set (— )*\d of 1 /, 'the deciding set counts the Bo3 meeting only (mutant: hot: format lock off)');
  assert.match(mh, /Sinner wins set 1 (— )*2 of 2/, 'set 1 counts both meetings, Bo5 included: ' + mh.slice(mh.indexOf('Sets & tiebreaks'), mh.indexOf('Sets & tiebreaks') + 160));
});
