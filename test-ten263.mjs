// TEN-263 — Match analysis Form + H2H tabs (design_handoff_match_analysis).
//
// Drives the REAL code: the client block is sliced out of the shipped
// bsp-consult-dashboard.html and executed (never a copy of the rule), and the
// match-close shards are built by the real build-match-closes.js over a
// synthetic archive written to a temp dir. Every data rule the brief set is a
// test here, with a control where a pass could be vacuous.
//
// Run: node --test test-ten263.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const html = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');

function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found in bsp-consult-dashboard.html`);
  let depth = 0, i = html.indexOf('{', start);
  const open = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  assert.ok(i > open, `${name} braces did not balance`);
  return html.slice(start, i + 1);
}
function sliceBlock() {
  const a = html.indexOf('/* =====================================================================\n   TEN-263 ');
  const b = html.indexOf('/* ---------- TOURNAMENT SUB-TAB ---------- */');
  assert.ok(a > 0 && b > a, 'TEN-263 block not found between its sentinels');
  return html.slice(a, b);
}
const PS_TOUR_META_SRC = /const PS_TOUR_META = \(\(\) => \{[\s\S]*?\n\}\)\(\);/.exec(html);
assert.ok(PS_TOUR_META_SRC, 'PS_TOUR_META not found');

const HELPERS = ['escapeHtml', 'surnameFirstName', 'psShortName', 'formIni', 'ppCleanTournamentName',
  'psNormTour', 'psTourMeta', 'psRoundAbbr', 'h2hRoundLabel', 'eventKeyOfMatch'];
function sandbox() {
  return new Function(`
    const document = { addEventListener(){}, getElementById(){ return null; }, querySelector(){ return null; },
      head: { appendChild(){} }, createElement(){ return { set textContent(v){} }; } };
    const playerProfiles = {};
    let _formPanelCalls = 0;
    function formPanelHtml(){ _formPanelCalls++; return '<div>panel</div>'; }
    function ensureFormPanelTabs(){}
    function ensureFormRows(m){ return Promise.resolve(m); }
    function loadCareerHistory(){ return Promise.resolve([]); }
    function ensureStyleMeetings(m){ return Promise.resolve(m); }
    function ensurePsMatrix(){ return Promise.resolve(); }
    function ppStyleFor(){ return null; }
    function psArchFor(){ return null; }
    function styleMeetRowsFor(){ return []; }
    function openPlayerProfileFromMatch(){}
    function aGoTab(){}
    ${PS_TOUR_META_SRC[0]}
    ${HELPERS.map(slice).join('\n')}
    ${sliceBlock()}
    function buildFormSection(m){ return fhBuildForm(m); }
    function buildH2HSection(m){ return fhBuildH2H(m); }
    return { fhCloseFor, fhFinishRow, fhRowFromForm, fhBestOf, fhMeetingList, fhMeetings, fhScoreLines,
      fhFormLineDefs, fhH2hLineDefs, fhPriceAvg, fhTodayPair, fhFormRowHtml, fhH2hRowHtml, fhBuildForm,
      fhBuildH2H, fhSetsFrom, fhRoundCode, fhStateFor, fhNameKey, fhOdd, fhH2hRecCard, fhPickBook,
      consts: { FH_HOT_MIN_ELIGIBLE, FH_PRICE_AVG_MARGIN_REMOVED, FH_H2H_SET1_MIRROR, FH_H2H_RET_COUNTS,
        FH_ELO_AT_TIME, FH_BOOK_ORDER, FH_SURF } };
  `)();
}
const S = sandbox();

// ── the flagged rules are one named constant each, at their designed values ──
test('flagged rules (a)–(e) are single constants at the designed values', () => {
  assert.equal(S.consts.FH_HOT_MIN_ELIGIBLE, 3);          // (a)
  assert.equal(S.consts.FH_PRICE_AVG_MARGIN_REMOVED, true); // (b)
  assert.equal(S.consts.FH_H2H_SET1_MIRROR, true);        // (c)
  assert.equal(S.consts.FH_SURF.Grass, '#2ab8a0');        // (d) the live site's grass token
  assert.equal(S.consts.FH_H2H_RET_COUNTS, true);         // (e)
});

// ── data check 4: no dated Elo → "No number" variant, no Elo in any row ──
test('No-number variant: neither row renders an Elo tag or number', () => {
  assert.equal(S.consts.FH_ELO_AT_TIME, false);
  const r = S.fhRowFromForm({ opponent: 'C. Alcaraz', opponentKey: 1, date: '2026-08-01', tournament: 'Cincinnati', round: 'ATP Cincinnati - Final',
    surface: 'hard', result: '2 - 0', won: true, sets: [{ p: 6, o: 4 }, { p: 6, o: 3 }], retired: false, walkover: false, qualifying: false, tier: 'atp', eventKey: 9 }, 5, 'J. Sinner', 0);
  for (const h of [S.fhFormRowHtml(r), S.fhH2hRowHtml(r)]) {
    assert.ok(!/ELO/.test(h), 'an ELO tag rendered');
    assert.ok(!/title="Opponent/.test(h), 'the Elo title rendered');
  }
});

// ── completeness from the score, not the flag; Bo5 incl. the "ATP " Slam prefix ──
test('retirement inferred from the score; done sets exclude the unfinished set', () => {
  const r = S.fhFinishRow({ result: '1 - 0', won: true, sets: [[6, 3, null], [2, 1, null]], ret: false, wo: false, tourn: 'Madrid', tier: 'atp' });
  assert.equal(r.ret, true);
  assert.equal(r.complete, false);
  assert.equal(r.pS, 1); assert.equal(r.oS, 0);
  const done = S.fhFinishRow({ result: '2 - 0', won: true, sets: [[6, 3, null], [6, 4, null]], ret: false, wo: false, tourn: 'Madrid', tier: 'atp' });
  assert.equal(done.ret, false, 'control: a completed match is not flagged');
});
test('best-of-five: ATP-prefixed Slam names and a 3-set tally', () => {
  assert.equal(S.fhBestOf({ pS: 2, oS: 1, tourn: 'ATP US Open', tier: 'atp', qualifying: false }), 5);
  assert.equal(S.fhBestOf({ pS: 2, oS: 1, tourn: 'US Open', tier: 'atp', qualifying: true }), 3, 'Slam qualifying is Bo3');
  assert.equal(S.fhBestOf({ pS: 3, oS: 0, tourn: 'Davis Cup', tier: 'atp' }), 5);
  assert.equal(S.fhBestOf({ pS: 2, oS: 0, tourn: 'Umag', tier: 'atp' }), 3);
});
test('qualifying rounds print as Q, never as the feed\'s "Final"', () => {
  assert.equal(S.fhRoundCode('ATP Cincinnati - Final', true), 'Q');
  assert.equal(S.fhRoundCode('ATP Cincinnati - Final', false), 'F');
});

// ── H2H: the fixture itself is not a previous meeting ──
test('fhMeetingList drops the fixture\'s own eventKey (control: other meetings stay)', () => {
  const m = { id: 'past-777', h2h: { matches: [{ eventKey: 777, date: '2026-09-22' }, { eventKey: 12, date: '2024-01-01' }] } };
  assert.deepEqual(S.fhMeetingList(m).map(x => x.eventKey), [12]);
  assert.equal(S.fhMeetingList({ id: 'upcoming-5', h2h: m.h2h }).length, 2);
});

// ── hot lines: Bo5 and RET not eligible for games/set lines; min 3 eligible ──
test('hot lines: eligibility and the minimum-3 rule', () => {
  const mk = (sets, extra) => S.fhFinishRow(Object.assign({ mid: Math.random().toString(36), won: true, sets, ret: false, wo: false, tourn: 'Umag', tier: 'atp',
    result: sets.filter(s => s[0] > s[1]).length + ' - ' + sets.filter(s => s[1] > s[0]).length }, extra || {}));
  const rows = [mk([[6, 4, null], [6, 4, null]]), mk([[6, 4, null], [3, 6, null], [6, 3, null]]),
    mk([[7, 6, 3], [6, 4, null]]), mk([[6, 4, null], [6, 4, null], [6, 4, null]], { tourn: 'Wimbledon' }), mk([[6, 4, null], [2, 1, null]], { result: '1 - 0' })];
  const sc = S.fhScoreLines(rows, S.fhFormLineDefs('Sinner'));
  const over = sc.scored.find(x => x.name === 'Over 22.5 games');
  assert.equal(over.n, 3, 'Bo5 and the retirement are not eligible for a totals line');
  const set1 = sc.scored.find(x => x.name === 'Sinner wins set 1');
  assert.equal(set1.n, 5, 'set 1 was completed in all five, including the retirement');
  const few = S.fhScoreLines(rows.slice(0, 2), S.fhFormLineDefs('Sinner'));
  assert.equal(few.scored.length, 0, 'fewer than 3 eligible → no line');
});
test('H2H lines carry the mirror pair while the flag is on', () => {
  const names = S.fhH2hLineDefs('Sinner', 'Alcaraz').map(d => d.name);
  assert.ok(names.includes('Sinner wins set 1') && names.includes('Alcaraz wins set 1'));
});

// ── price-range average is margin-removed ──
test('Price range average removes the margin (control: margin-included differs)', () => {
  const PR = [{ price: 1.5, oppPrice: 2.7 }, { price: 2.2, oppPrice: 1.7 }];
  const pA = ((1 / 1.5) / (1 / 1.5 + 1 / 2.7) + (1 / 2.2) / (1 / 2.2 + 1 / 1.7)) / 2;
  assert.ok(Math.abs(S.fhPriceAvg(PR, true) - 1 / pA) < 1e-9);
  const incl = 1 / ((1 / 1.5 + 1 / 2.2) / 2);
  assert.ok(Math.abs(S.fhPriceAvg(PR, true) - incl) > 0.01, 'control: the two averages must differ on this input');
});

// ── rendered states off real renderers ──
function formRow(i, won, surface, date, extra) {
  return Object.assign({ opponent: 'P. Opp' + String.fromCharCode(65 + i), opponentKey: 100 + i, date, tournament: 'Umag', round: 'ATP Umag - 1/8-finals',
    surface, result: won ? '2 - 0' : '0 - 2', won, sets: won ? [{ p: 6, o: 3 }, { p: 6, o: 4 }] : [{ p: 3, o: 6 }, { p: 4, o: 6 }],
    retired: false, walkover: false, qualifying: false, tier: 'atp', eventKey: 500 + i }, extra || {});
}
test('Form: partial pricing shows "N of M priced"; thin window shows no ratios', () => {
  const rows = Array.from({ length: 10 }, (_, i) => formRow(i, i % 3 !== 0, 'hard', `2026-08-${String(20 - i).padStart(2, '0')}`));
  const closes = rows.slice(0, 7).map((r, i) => ({ date: r.date, opp: r.opponent.replace(/^P\. (.*)$/, '$1 P.'), won: r.won,
    pairs: i < 5 ? { P: [1.8, 2.0], B: [1.7, 2.1] } : { P: null, B: [1.7, 2.1] } }));
  const m = { id: 'upcoming-1', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: 1, p2Key: 2, surface: 'hard', date: '2026-09-01',
    p1RecentFormMatches: rows, p2RecentFormMatches: rows.slice(0, 4), _fhFormData: true, _fhCloses: [closes, []] };
  const h = S.fhBuildForm(m);
  assert.ok(h.includes('7 of 10 priced'), 'coverage count missing');
  assert.ok(h.includes('7 of 10 priced · Pinnacle, Bet365 where missing (2)'), 'priced count + Bet365 note next to the market figures');
  assert.ok(h.includes('4 matches with these filters'), 'thin note missing for the 4-match player');
  assert.ok(!h.includes('ELO'));
});
test('H2H states: loading skeleton until the joins land; no meetings → empty state', () => {
  const m = { id: 'upcoming-3', p1: 'A. B', p2: 'C. D', p1Key: 1, p2Key: 2, surface: 'hard', h2h: { matches: [{ date: '2024-01-01', eventKey: 4, p1Won: true, result: '2 - 0', surface: 'hard' }] } };
  assert.ok(S.fhBuildH2H(m).includes('Loading head-to-head'));
  const e = S.fhBuildH2H({ id: 'upcoming-4', p1: 'A. B', p2: 'C. D', p1Key: 1, p2Key: 2, surface: 'hard', h2h: null, _styleMeetLoaded: true });
  assert.ok(e.includes('No previous meetings'));
  assert.ok(!e.includes('Price range'), 'sections below the empty state must be hidden');
});

// ── the builder: both books per row, each only when two-sided ──
test('build-match-closes: Pinnacle and Bet365 pairs per row, one-sided book dropped, walkovers skipped', () => {
  const { build } = require('./build-match-closes.js');
  const root = mkdtempSync(join(tmpdir(), 'ten263-'));
  try {
    mkdirSync(join(root, 'odds-archive'));
    const H = 'date,tournament,series,court,surface,round,bestof,winner,loser,wrank,lrank,comment,b365w,b365l,psw,psl,maxw,maxl,avgw,avgl,avgsrc';
    writeFileSync(join(root, 'odds-archive', '2025.csv'), [H,
      '2025-10-12,Shanghai Masters,Masters 1000,Outdoor,Hard,Semifinals,3,Sinner J.,Alcaraz C.,1,2,Completed,1.5,2.6,1.55,2.55,1.6,2.7,1.52,2.55,file',
      '2025-05-02,Madrid Masters,Masters 1000,Outdoor,Clay,Quarterfinals,3,Alcaraz C.,Sinner J.,2,1,Retired,1.8,2.0,1.85,2.05,1.9,2.1,1.82,2.02,file',
      '2025-06-01,Queens,ATP500,Outdoor,Grass,1st Round,3,Sinner J.,Nobody X.,1,300,Walkover,1.1,7.0,1.1,7.5,1.1,7.5,1.1,7.0,file',
      '2025-03-01,Dubai,ATP500,Outdoor,Hard,Final,3,Sinner J.,Rune H.,1,9,Completed,1.3,3.5,,,1.3,3.6,1.3,3.4,file',
      '2025-04-01,Miami,Masters 1000,Outdoor,Hard,Final,3,Sinner J.,Fritz T.,1,4,Completed,1.4,,1.42,,1.4,3.6,1.3,3.4,file'].join('\n') + '\n');
    writeFileSync(join(root, 'player-profiles.json'), JSON.stringify({ players: { 5: { name: 'J. Sinner' } } }));
    writeFileSync(join(root, 'matches.json'), JSON.stringify([{ p1: 'C. Alcaraz', p1Key: 6, p2: 'J. Sinner', p2Key: 5 }]));
    const r = build(root, join(root, 'match-closes'), join(root, 'match-closes-index.json'));
    const rows = JSON.parse(readFileSync(join(root, 'match-closes', '5.json'), 'utf8')).rows;
    assert.deepEqual(rows, [
      ['2025-03-01', 'Rune H.', 1, null, null, 1.3, 3.5, 0],          // no Pinnacle → Bet365 pair only
      ['2025-05-02', 'Alcaraz C.', 0, 2.05, 1.85, 2.0, 1.8, 1],      // retirement kept + flagged, both books
      ['2025-10-12', 'Alcaraz C.', 1, 1.55, 2.55, 1.5, 2.6, 0],
    ]);
    assert.ok(!rows.some(x => x[0] === '2025-04-01'), 'a match where every book is one-sided was priced');
    assert.ok(!rows.some(x => x[0] === '2025-06-01'), 'a walkover was priced');
    assert.equal(r.stats.walkovers, 1);
    const idx = JSON.parse(readFileSync(join(root, 'match-closes-index.json'), 'utf8'));
    assert.equal(idx.players['6'], 2, 'the board player resolved through matches.json');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── ODDS SOURCE RULE (founder ruling 2026-09-23). Every test holds a case that
//    goes wrong if the order is reversed to Bet365-first. ──
const PIN = [1.55, 2.55], B365 = [1.5, 2.6];
test('odds rule: the order constant is Pinnacle then Bet365', () => {
  assert.deepEqual(S.consts.FH_BOOK_ORDER, ['P', 'B']);
});
test('odds rule: Pinnacle present → Pinnacle, even when Bet365 is also there', () => {
  assert.deepEqual(S.fhPickBook({ P: PIN, B: B365 }), { price: 1.55, oppPrice: 2.55, book: 'P' });
});
test('odds rule: Pinnacle missing → Bet365 (and Pinnacle still wins when present)', () => {
  assert.deepEqual(S.fhPickBook({ P: null, B: B365 }), { price: 1.5, oppPrice: 2.6, book: 'B' });
  assert.equal(S.fhPickBook({ P: PIN, B: B365 }).book, 'P');
});
test('odds rule: neither book → no price (a dash, the match is unpriced)', () => {
  assert.equal(S.fhPickBook({ P: null, B: null }), null);
  assert.equal(S.fhPickBook({ P: PIN, B: B365 }).book, 'P', 'order control: Pinnacle first when both exist');
});
test('odds rule: a one-sided book is missing for that match → fall through', () => {
  assert.deepEqual(S.fhPickBook({ P: [1.55, null], B: B365 }), { price: 1.5, oppPrice: 2.6, book: 'B' });
  assert.equal(S.fhPickBook({ P: [1.55, null], B: [null, 2.6] }), null);
  assert.equal(S.fhPickBook({ P: PIN, B: B365 }).book, 'P', 'order control: Pinnacle first when both exist');
});
test('odds rule: never mixed books within one match', () => {
  for (const pairs of [{ P: PIN, B: B365 }, { P: [1.55, null], B: B365 }, { P: PIN, B: [null, 2.6] }]) {
    const x = S.fhPickBook(pairs), src = pairs[x.book];
    assert.deepEqual([x.price, x.oppPrice], src, 'both sides must come from the chosen book');
  }
  assert.deepEqual(S.fhPickBook({ P: PIN, B: B365 }), { price: 1.55, oppPrice: 2.55, book: 'P' }, 'order control');
});
test('closing join: date ±1, unique, result must agree, then the book rule', () => {
  const rows = [{ date: '2025-10-12', opp: 'Alcaraz C.', won: true, pairs: { P: PIN, B: B365 } },
                { date: '2026-03-15', opp: 'Alcaraz C.', won: false, pairs: { P: null, B: [2.1, 1.75] } }];
  assert.deepEqual(S.fhCloseFor(rows, '2025-10-13', 'C. Alcaraz', true), { price: 1.55, oppPrice: 2.55, book: 'P' });
  assert.deepEqual(S.fhCloseFor(rows, '2026-03-15', 'C. Alcaraz', false), { price: 2.1, oppPrice: 1.75, book: 'B' });
  assert.equal(S.fhCloseFor(rows, '2025-10-15', 'C. Alcaraz', true), null, '3 days off must not join');
  assert.equal(S.fhCloseFor(rows, '2025-10-12', 'C. Alcaraz', false), null, 'a result disagreement must not join');
  const dup = rows.concat([{ date: '2025-10-13', opp: 'Alcaraz C.', won: true, pairs: { P: PIN, B: null } }]);
  assert.equal(S.fhCloseFor(dup, '2025-10-12', 'C. Alcaraz', true), null, 'two candidates = no join');
});
test("Today's price: Pinnacle current, else Bet365 current, else none — never bestOdds", () => {
  const best = { p1: { price: 9.9, bookmaker: 'Betfair' }, p2: { price: 9.9, bookmaker: 'Sbo' } };
  assert.deepEqual(S.fhTodayPair({ bookNow: { Pncl: { p1: 1.7, p2: 2.2 }, bet365: { p1: 1.8, p2: 2.0 } }, bet365Now: { p1: 1.75, p2: 2.05 }, bestOdds: best }),
    { price: 1.7, oppPrice: 2.2, book: 'P' });
  assert.deepEqual(S.fhTodayPair({ bookNow: { Pncl: { p1: 1.7 } }, bet365Now: { p1: 1.75, p2: 2.05 }, bestOdds: best }),
    { price: 1.75, oppPrice: 2.05, book: 'B' }, 'one-sided Pinnacle falls through to Bet365');
  assert.equal(S.fhTodayPair({ bestOdds: best }), null, 'bestOdds alone is never a price here');
  assert.equal(S.fhTodayPair({ finalScore: '2-0', bookNow: { Pncl: { p1: 1.7, p2: 2.2 } } }), null, 'no Today after the match');
  const block = html.slice(html.indexOf('TEN-263 '), html.indexOf('/* ---------- TOURNAMENT SUB-TAB'));
  assert.ok(!/bestOdds\s*[.[]/.test(block.replace(/\/\/.*$/gm, '')), 'the block reads m.bestOdds');
  assert.ok(!/\|\|\s*1\.54|\|\|\s*2\.62/.test(block), 'the sample price fallback is in the shipped block');
});
test('B365 tag and source notes', () => {
  const r = S.fhRowFromForm({ opponent: 'C. Alcaraz', opponentKey: 1, date: '2026-03-15', tournament: 'Indian Wells', round: 'ATP Indian Wells - Final',
    surface: 'hard', result: '0 - 2', won: false, sets: [{ p: 4, o: 6 }, { p: 4, o: 6 }], retired: false, walkover: false, qualifying: false, tier: 'atp', eventKey: 9 }, 5, 'J. Sinner', 0);
  r.price = 2.1; r.oppPrice = 1.75; r.book = 'B';
  assert.ok(S.fhFormRowHtml(r).includes('>B365<') && S.fhH2hRowHtml(r).includes('>B365<'));
  r.book = 'P';
  assert.ok(!S.fhFormRowHtml(r).includes('B365') && !S.fhH2hRowHtml(r).includes('B365'), 'Pinnacle rows carry no tag');
});
test('H2H price header names the Bet365 fallback count; 0 priced reads the empty copy', () => {
  const mm = (date, p1Won, ek) => ({ date, tournament: 'Umag', round: 'ATP Umag - Final', surface: 'clay', p1Won, result: p1Won ? '2 - 0' : '0 - 2', qualifying: false, eventKey: ek });
  const base = { id: 'upcoming-9', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: 1, p2Key: 2, surface: 'clay', date: '2026-09-01',
    h2h: { matches: [mm('2026-07-26', true, 10), mm('2024-07-28', true, 11), mm('2023-07-30', false, 12), mm('2022-07-31', false, 13)] },
    p1RecentFormMatches: [], p2RecentFormMatches: [], _fhH2hData: true, _fhCh: [[], []] };
  const closes = [{ date: '2026-07-26', opp: 'Alcaraz C.', won: true, pairs: { P: null, B: [1.8, 2.0] } },
    { date: '2024-07-28', opp: 'Alcaraz C.', won: true, pairs: { P: [1.9, 1.95], B: [1.85, 1.95] } },
    { date: '2023-07-30', opp: 'Alcaraz C.', won: false, pairs: { P: [2.3, 1.62], B: null } }];
  const h = S.fhBuildH2H(Object.assign({}, base, { _fhCloses: [closes, []] }));
  assert.ok(h.includes('3 of 4 meetings priced'), 'N of M = either book');
  assert.ok(h.includes('Closing odds · Pinnacle, Bet365 where missing (1)'));
  assert.ok(h.includes('>B365<'));
  const pinOnly = S.fhBuildH2H(Object.assign({}, base, { _fhCloses: [closes.slice(1), []] }));
  assert.ok(pinOnly.includes('Closing odds · Pinnacle<'), 'all-Pinnacle header');
  const none = S.fhBuildH2H(Object.assign({}, base, { _fhCloses: [[], []] }));
  assert.ok(none.includes('0 of 4 meetings priced') && none.includes('No closing odds on record for these meetings'));
  assert.ok(!/Closing odds · Pinnacle/.test(none), 'no source is named for zero priced meetings');
  assert.ok(!none.includes('>0.00<'), 'unpriced rendered as zero');
});
