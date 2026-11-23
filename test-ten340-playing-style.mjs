// TEN-340 (TEN-312 Playing style tab, founder brief 2026-09-28 / DoD item 8 2026-09-29) — the Playing style tab rebuilt on
// the design file. Every check drives the page's REAL code (the TEN-263 block, the matrix / meetings / DNA helpers and the
// TEN-340 block sliced out of bsp-consult-dashboard.html and executed) and names the mutation that turns it red;
// tools/test-ten340-mutants.js applies each one to a copy of the page (TEN340_HTML).
//   · style matchup: the matrix cell in p1's direction, the lean, the three surface tiles; a mirror = the 50/50 copy (G5)
//   · personal record = the meetings shard vs the opponent's archetype, walkovers out (N2), every rate through the D2 gate
//   · career meetings = the shared rows (maMatchRowsHtml), 8 shown + the G18 control, every row opens the shared sheet
//   · DNA: true percentiles with the population and n on the shared tooltip; "Since Mar 2024", never "Career"; Surface Elo
//     current on both views; no Δ on the since view; a player below the floor draws no shape; on the since view Under
//     pressure is "—" for both players with the founder's tooltip (Q14, TEN-312 5262e790)
//   · both players white (D4 / the file's palette `cur`); no tab-local row or tooltip renderer (DoD 8); no sample data
//   · tools/build-matchup-matrix.js drops TML walkovers at source (N2)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN340_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let d = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; }
  return html.slice(start, i + 1);
}
function between(a, b) { const i = html.indexOf(a), j = html.indexOf(b, i); assert.ok(i > 0 && j > i, 'block not found: ' + a.slice(0, 40)); return html.slice(i, j); }
const TEN263 = between('/* =====================================================================\n   TEN-263 ', '/* ---------- TOURNAMENT SUB-TAB ---------- */');
const PS2 = between('// PLAYING STYLE — TEN-340', "// The modal header's two price pills");
const MDNA = between('const MDNA_AXES = [', '// =====================================================================\n// PLAYING STYLE — TEN-340');
const PS_TOUR_META_SRC = /const PS_TOUR_META = \(\(\) => \{[\s\S]*?\n\}\)\(\);/.exec(html)[0];
const PS_ARCH_SRC = /const PS_ARCHETYPES = \[[\s\S]*?\n\];/.exec(html)[0];
// Match analysis rebuild (2026-11-23): the tab renderer is maStyleV2 in match-analysis-v2.js (TEN340_MA2 = a mutated copy)
const MA2_SRC = readFileSync(process.env.TEN340_MA2 || join(HERE, 'match-analysis-v2.js'), 'utf8');
const S = new Function(`
  const document = { addEventListener(){}, getElementById(){ return null; }, querySelector(){ return null; }, querySelectorAll(){ return []; },
    head: { appendChild(){} }, createElement(){ return { set textContent(v){} }; } };
  const console = { warn(){}, log(){} };
  const playerProfiles = {};
  let playerStyles = { byKey: { x: 1 } }, psMatrixData = null;
  const STY = {};
  function styleKey(n){ return n; }
  function ppStyleFor(n){ return STY[n] || null; }
  function formPanelHtml(){ return ''; } function ensureFormPanelTabs(){}
  function ensureFormRows(m){ return Promise.resolve(m); } function loadCareerHistory(){ return Promise.resolve([]); }
  function openPlayerProfileFromMatch(){} function aGoTab(){} function psArchFor(){ return null; }
  function loadMatchStatsIndex(){ return Promise.resolve(new Set()); } function loadSetStatsShard(){ return Promise.resolve(null); } const _setStatsShards = {};
  function loadPlayerStyles(){ return Promise.resolve(); } const _careerHistoryShards = {};
  function aHeaderOdds(m){ return { p1: '—', p2: '—' }; } let tips = 0; function initAOddsTips(){ tips++; }
  let _aM = null; const _aBuilt = new Set(); function aBuilt(){ return false; } function aPaint(){}
  function ppEloForSurface(p, s){ return ELO[p.name] != null ? { rating: ELO[p.name] } : null; } const ELO = {};
  ${PS_TOUR_META_SRC}
  ${PS_ARCH_SRC}
  ${['escapeHtml', 'psShortName', 'psCellFor', 'psMirrorN', 'psSurfaceCellFor', 'psArchIndex', 'psFmtMeetDate', 'psRoundAbbr', 'psNormTour', 'psTourMeta',
     'psGroupMeetings', 'styleMeetRowsFor', 'ppCleanTournamentName', 'surnameFirstName', 'formIni'].map(slice).join('\n')}
  ${TEN263}
  ${MDNA}
  ${PS2}
  const __MA2 = (function(){ const window = {}; ${MA2_SRC}; return window; })();
  const maStyleV2 = __MA2.maStyleV2;
  return { buildStyleSection, ps2Record, ps2Edge: typeof ps2Edge === 'function' ? ps2Edge : null, ps2Meeting, ps2IsWalkover, ps2StateFor, _maRowReg, STY, ELO,
    click(code){ return eval(code); },   // runs a rendered onclick inside the page block's own scope (_ps2, ps2Set)
    set matrix(v){ psMatrixData = v; }, set dna(v){ _mdna = v; }, set styles(v){ playerStyles = v; }, get tips(){ return tips; } };
`)();
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
// TEN-380: the DNA card comes first; its own markup ends where the personal-record card starts.
const dnaOf = h => h.slice(h.indexOf('class="ps2-card ps2-dna"'), h.indexOf('class="ps2-card ps2-personal"'));
const CP = 'Counterpuncher', AB = 'Attacking Baseliner', ACE = 'All Court Elite';

// A matrix with one cross cell (CP beat AB 52%, n 1,592) and its surfaces, and one diagonal (ACE × ACE, n 39).
function matrix(){
  const c = (pct, n) => ({ pct, n });
  return { minSampleN: 20,
    matrix: { [CP]: { [AB]: c(52, 1592) }, [AB]: { [CP]: c(48, 1592) }, [ACE]: { [ACE]: c(50, 39) } },
    matrixBySurface: { clay: { [CP]: { [AB]: c(52, 447) }, [AB]: { [CP]: c(48, 447) } }, hard: { [CP]: { [AB]: c(53, 968) }, [AB]: { [CP]: c(47, 968) } },
      grass: { [CP]: { [AB]: c(null, 12) }, [AB]: { [CP]: c(null, 12) } } } };
}
// n meeting rows (w wins first), newest first, plus extra rows (walkovers, retirements) given verbatim.
function rows(w, l, extra){
  const out = [];
  for (let i = 0; i < w + l; i++) out.push({ won: i < w, opponent: 'Opp ' + i, surface: 'hard', tournament: i % 2 ? 'US Open' : 'Chengdu',
    result: i < w ? '6-4 6-4' : '4-6 4-6', date: `2025-${String(12 - (i % 12)).padStart(2, '0')}-${String(10 + (i % 18)).padStart(2, '0')}`, round: 'R32', oddsSelf: 1.5, oddsOpp: 2.6 });
  return (extra || []).concat(out);
}
function match(p1, p2, over){ return Object.assign({ id: 'fx-' + p1 + p2, p1, p2, p1Key: '1', p2Key: '2', surface: 'hard', _styleMeetLoaded: true, _ps2Loaded: true }, over || {}); }
// TEN-380: the style matchup opens collapsed; the checks that read its details open it first (ps2 state `mu`).
const openMu = m => { S.ps2StateFor(m).mu = true; return m; };
function setup(){ S.matrix = matrix(); S.styles = { byKey: { x: 1 } }; S.dna = { byKey: {}, meta: {} }; for (const k of Object.keys(S.STY)) delete S.STY[k]; for (const k of Object.keys(S.ELO)) delete S.ELO[k]; }

// ---- 2026-11-23 design (LOCKED 2026-11-21): Playing style card (radar + comparison) → Record against each style (two
// player boxes Record · Win rate · Vs other styles, then two match lists). Helpers read the rebuilt markup.
const recTiles = h => [...h.matchAll(/>(Record|Win rate|Vs other styles)<\/span><span style="[^"]*color:([^;]+);">([^<]*)</g)].map(x => ({ label: x[1], color: x[2], v: x[3] }));
const boxTiles = (h, i) => recTiles(h).slice(i * 3, i * 3 + 3);
const lists = h => h.split('overflow:hidden; display:flex; flex-direction:column; min-width:0;">').slice(1);
const listState = c => ({ showing: (/>Showing (\d+) of (\d+)/.exec(c) || []).slice(1).map(Number), rows: (c.match(/class="seg ma2-row"/g) || []).length,
  btn: (/onclick="(ps2Set\(\{more[AB]:(?:true|false)\}\))"[^>]*>([^<]*)</.exec(c) || [])[2] || (/>(All matches shown)</.exec(c) || [])[1] || null,
  onclick: (/onclick="(ps2Set\(\{more[AB]:(?:true|false)\}\))"/.exec(c) || [])[1] });

// RENDERER GAP (modal-playing-style.md "Data": Style matchup = matchup-matrix.json, the cell in p1's direction, the lean,
// the three surface tiles; a mirror = the 50/50 copy, G5). The rebuilt tab draws no Style matchup and ps2Edge is deleted;
// no founder ruling drops it (CLAUDE.md carve-out 3). This check stays red until the matchup is back or ruled out.
test('style matchup: the matrix cell in p1\'s direction, the lean and the surface tiles; a mirror reads 50/50 (G5)', () => {
  setup(); S.STY['A. Arnaldi'] = { archetype_label: AB }; S.STY['B. Baez'] = { archetype_label: CP };
  const t = text(S.buildStyleSection(match('A. Arnaldi', 'B. Baez')));
  assert.match(t, /Counterpunchers beat Attacking Baseliners/, 'the matchup head');
  assert.match(t, /1,592/, 'the cell\'s tour meetings');
  assert.match(t, /48%.*52%/, 'p1\'s direction first');
  setup(); S.STY['J. Sinner'] = { archetype_label: ACE }; S.STY['C. Alcaraz'] = { archetype_label: ACE };
  assert.match(text(S.buildStyleSection(match('J. Sinner', 'C. Alcaraz'))), /Style gives neither player an edge/, 'the mirror copy');
});

// Mutation: the walkover filter removed from ps2Record (a W/O counted as a win / loss, N2).
// Founder 2026-10-22 (N6 reversed): the walkover is LISTED — WO under the date, "–" score and sets, "—" prices, no sheet —
// and counted in no record, n or rate; the list chip counts the listed rows and says how many are walkovers.
test('personal record (N2 + 2026-10-22): a walkover is listed, never in the record or rate; a retirement counts', () => {
  setup(); S.STY['A. Aa'] = { archetype_label: CP }; S.STY['B. Bb'] = { archetype_label: AB };
  const extra = [{ won: true, opponent: 'W O', surface: 'hard', tournament: 'Chengdu', result: 'W/O', date: '2026-01-05', round: 'R16', oddsSelf: null, oddsOpp: null },
    { won: true, opponent: 'R T', surface: 'hard', tournament: 'Chengdu', result: '6-4 3-1 RET', date: '2026-01-04', round: 'R32', oddsSelf: 1.4, oddsOpp: 3 }];
  const m = match('A. Aa', 'B. Bb', { p1StyleMeetings: { [AB]: rows(8, 4, extra), [ACE]: rows(6, 6) }, p2StyleMeetings: { [CP]: [] } });
  const R = S.ps2Record(m, 0);
  assert.equal(R.w, 9); assert.equal(R.l, 4); assert.equal(R.n, 13);
  assert.ok(!R.rows.some(r => /w\/o/i.test(r.result)), 'the counted rows hold no walkover');
  assert.equal(R.listRows.filter(r => /w\/o/i.test(r.result)).length, 1, 'the listed rows do');
  const h = S.buildStyleSection(m), A = boxTiles(h, 0);
  assert.deepEqual(A.map(x => x.v), ['9–4', '69%', '+19 pts'], 'record 9–4 over 13 played, 69%, v the other styles\' 50%');
  const L = lists(h)[0];
  assert.match(L, />Showing 6 of 14 · 1 w\/o</, 'the walkover is one of the listed rows and named');
  const wo = /<div class="seg ma2-row"[^>]*>(?:(?!<div class="seg ma2-row").)*?>WO<\/span>[\s\S]*?(?=<div class="seg ma2-row"|<div style="display:flex; align-items:baseline)/.exec(L);
  assert.ok(wo, 'the walkover row is painted, WO under the date');
  assert.doesNotMatch(wo[0].slice(0, 30), /onclick/, 'a walkover opens no sheet');
  assert.match(text(wo[0]), /W\. O – – — —/, '"–" score and sets, "—" prices');
  S.ps2StateFor(m).moreA = true;
  assert.match(text(lists(S.buildStyleSection(m))[0]), /6-4, 3-1 ret\./, 'the retirement keeps its scores and "ret."');
});

// Mutation: the box keeps its own ladder (a % on n 1–4) instead of the one gate (D2).
test('D2 gate: n 0 "—", n 3 record only, n 7 grey + "small sample", n 12 full', () => {
  setup(); S.STY['A. Aa'] = { archetype_label: CP }; S.STY['B. Bb'] = { archetype_label: AB };
  const box = (w, l) => { const h = S.buildStyleSection(match('A. Aa', 'B. Bb', { p1StyleMeetings: { [AB]: rows(w, l), [ACE]: rows(10, 10) }, p2StyleMeetings: { [CP]: [] } }));
    return { h, t: boxTiles(h, 0) }; };
  let b = box(0, 0); assert.deepEqual(b.t.slice(0, 2).map(x => x.v), ['—', '—']); assert.doesNotMatch(text(b.h), /\b0%|NaN/);
  b = box(2, 1); assert.deepEqual(b.t.slice(0, 2).map(x => x.v), ['2–1', '—'], 'n 1–4: the record, no rate');
  b = box(5, 2); assert.equal(b.t[1].v, '71%'); assert.equal(b.t[1].color, 'var(--ma2-grey)', 'n 5–9 greyed');
  // modal-analysis.md D2: "n 5–9 greyed + 'small sample' note" — RENDERER GAP: the rebuilt Win rate tile carries no note
  assert.match(b.h.slice(b.h.indexOf('>Win rate<') - 400, b.h.indexOf('>Win rate<') + 400), /small sample/i, 'the 5–9 small-sample note');
  b = box(8, 4); assert.equal(b.t[1].v, '67%'); assert.equal(b.t[1].color, 'var(--ma2-white)', 'n 12 full');
});

// RENDERER GAP (modal-analysis.md D2: "Never render 0%, 0.0% or NaN% at n = 0"): a player with no meeting against any
// other style gets "−NaN pts" and "He wins NaN% against all other styles" (psRecordCard: maGate(0) is 'none', not 'nopct').
test('Vs other styles: no meeting against another style reads "—", never NaN', () => {
  setup(); S.STY['A. Aa'] = { archetype_label: CP }; S.STY['B. Bb'] = { archetype_label: AB };
  const h = S.buildStyleSection(match('A. Aa', 'B. Bb', { p1StyleMeetings: { [AB]: rows(8, 4) }, p2StyleMeetings: { [CP]: rows(6, 6) } }));
  assert.doesNotMatch(text(h), /NaN/);
  assert.equal(boxTiles(h, 0)[2].v, '—');
});

// Mutation: a row that stops opening the shared sheet. Each player's list shows 6 rows under "Showing 6 of N" + "Show N
// more matches"; every played row opens the shared sheet with the player's key, name, date and opponent.
test('career meetings: 6 shown + "Show N more matches", every played row opens the shared sheet', () => {
  setup(); S.STY['A. Aa'] = { archetype_label: CP }; S.STY['B. Bb'] = { archetype_label: AB };
  const m = match('A. Aa', 'B. Bb', { p1StyleMeetings: { [AB]: rows(7, 5) }, p2StyleMeetings: { [CP]: rows(1, 1) } });
  const h = S.buildStyleSection(m), [A, B] = lists(h);
  assert.match(text(A), /Showing 6 of 12/); assert.match(text(A), /Show 6 more matches/);
  const ids = [...A.matchAll(/class="seg ma2-row" onclick="event\.stopPropagation\(\); maOpenRowSheet\('(mr\d+)', this\)"/g)].map(x => x[1]);
  assert.equal(ids.length, 6, 'every shown row opens the sheet');
  const d = S._maRowReg[ids[0]];
  assert.equal(d.key, '1'); assert.equal(d.name, 'A. Aa'); assert.ok(d.date && d.opp, 'joined by date + opponent');
  assert.match(text(B), /Showing 2 of 2/, 'B\'s meetings are listed too, no click needed');
  S.ps2StateFor(m).moreA = true;
  assert.match(text(lists(S.buildStyleSection(m))[0]), /Showing 12 of 12 .*Show fewer/);
});

// Mutation: the two lists share one expanded flag. (Dropped with the 2026-11-23 design: the T. Paul v V. Vacherot layout
// checks — columns top-aligned, no flex:1 card, no margin-top:auto control — the locked design stretches the lists and pins
// the control to the foot.)
test('career meetings: each list expands and collapses on its own; counters = rows', () => {
  setup(); S.STY['T. Paul'] = { archetype_label: CP }; S.STY['V. Vacherot'] = { archetype_label: AB };
  const m = match('T. Paul', 'V. Vacherot', { p1StyleMeetings: { [AB]: rows(30, 15) }, p2StyleMeetings: { [CP]: rows(12, 8) } });
  const read = () => lists(S.buildStyleSection(m)).map(listState);
  const press = sd => { const st = read()[sd === 'a' ? 0 : 1]; assert.ok(st.onclick, 'list ' + sd + ' has its control'); S.click(st.onclick); };
  const check = (a, b) => { const [A, B] = read();
    assert.deepEqual(A.showing, [a, 45]); assert.equal(A.rows, a, 'A: the counter = the rows drawn');
    assert.deepEqual(B.showing, [b, 20]); assert.equal(B.rows, b, 'B: the counter = the rows drawn');
    assert.equal(A.btn, a === 45 ? 'Show fewer' : 'Show 39 more matches'); assert.equal(B.btn, b === 20 ? 'Show fewer' : 'Show 14 more matches'); };
  check(6, 6);
  press('a'); check(45, 6);
  press('b'); check(45, 20);
  press('a'); check(6, 20);
  press('b'); check(6, 6);
  press('b'); check(6, 20);
  press('a'); check(45, 20);
  for (const [w, l, sd] of [[4, 2, 'a'], [3, 2, 'b']]) {
    const m2 = match('T. Paul', 'V. Vacherot', sd === 'a' ? { p1StyleMeetings: { [AB]: rows(w, l) }, p2StyleMeetings: { [CP]: rows(12, 8) } } : { p1StyleMeetings: { [AB]: rows(30, 15) }, p2StyleMeetings: { [CP]: rows(w, l) } });
    const st = listState(lists(S.buildStyleSection(m2))[sd === 'a' ? 0 : 1]);
    assert.deepEqual(st.showing, [w + l, w + l]); assert.equal(st.rows, w + l);
    assert.equal(st.onclick, undefined, 'no Show more control on ' + (w + l) + ' meetings'); assert.equal(st.btn, 'All matches shown');
  }
});

// Mutation: a player with no style label reads "No matches" (the meetings are only tracked between classified players).
test('personal record: an unclassified player\'s own box says so, never "no matches"', () => {
  setup(); S.STY['B. Bb'] = { archetype_label: CP };
  const h = S.buildStyleSection(match('A. Aa', 'B. Bb', { p1StyleMeetings: null, p2StyleMeetings: null }));
  const a = h.slice(h.indexOf('>Record against each style<'), h.indexOf('B. Bb</span>', h.indexOf('>Record against each style<')));
  assert.match(text(a), /Aa’s playing style is not classified/); assert.doesNotMatch(text(a), /No matches/);
});

// Mutation: the retirement's unfinished set counted in the sets tally (N2 rule e).
test('meeting row: sets over finished sets only, "ret." on a retirement, tiebreaks as printed', () => {
  assert.deepEqual([S.ps2Meeting({ result: '6-4 3-1 RET' }).sets, S.ps2Meeting({ result: '6-4 3-1 RET' }).scores, S.ps2Meeting({ result: '6-4 3-1 RET' }).ret], ['1 - 0', '6-4, 3-1', true]);
  assert.deepEqual([S.ps2Meeting({ result: '7-6(7) 6-1' }).sets, S.ps2Meeting({ result: '7-6(7) 6-1' }).scores], ['2 - 0', '7-6(7), 6-1']);
  assert.equal(S.ps2Meeting({ result: '6-3 4-6 7-5 RET' }).sets, '2 - 1', 'a retirement after a finished set keeps it');
  assert.equal(S.ps2Meeting({ result: '7-6(5) 1-6 7-6(4) 4-6 13-12(3)' }).sets, '3 - 2', 'a final-set tiebreak at 12-12 is a finished set');
  assert.ok(S.ps2IsWalkover({ result: 'W/O' }) && !S.ps2IsWalkover({ result: '6-4 3-1 RET' }));
});

// The DNA fixture: two players on Hard with last-52 and since-Mar-2024 nodes, populations with their n. The file's own Elo
// copy (2200 / 2050) differs from the live rating (2234 / 2071), so a view that stopped reading the live Elo shows.
function dna(){
  const node = (s, r, u, d, m, base) => ({ serve: { rating: s, pct: base }, return: { rating: r, pct: base - 5 }, underPressure: { rating: u, pct: base - 10, srScope: 'last52' },
    dominanceRatio: { rating: d, pct: base - 1 }, sample: { matches: m } });
  const since = (s, r, u, d) => ({ serve: { rating: s, pct: 60 }, return: { rating: r, pct: 60 }, underPressure: { rating: u, pct: 60, srScope: 'career' }, dominanceRatio: { rating: d, pct: 60 }, sample: { matches: 90 } });
  const pop = (n, sc) => ({ n, population: `rated ATP main-tour players with >= 10 matches (Hard, ${sc})`, values: [] });
  const meta = { percentiles: { last52: { Hard: { serve: pop(178, 'last 52 weeks'), return: pop(178, 'last 52 weeks'), underPressure: pop(150, 'last 52 weeks'), dominanceRatio: pop(178, 'last 52 weeks') } },
    sinceBase: { Hard: { serve: pop(210, 'since Mar 2024'), return: pop(210, 'since Mar 2024'), underPressure: pop(190, 'since Mar 2024'), dominanceRatio: pop(210, 'since Mar 2024') } } },
    eloPercentiles: { Hard: { population: 'rated ATP main-tour players with a current Tennis Abstract Hard Elo', values: Array.from({ length: 272 }, (_, i) => 1400 + i * 3) } } };
  return { meta, byKey: {
    1: { surfaces: { Hard: { last52: node(303.6, 165.6, 319, 1.55, 53, 99), sinceBase: since(300.6, 162.5, 271.7, 1.52), elo: { rating: 2200, pct: 99.8 } } } },
    2: { surfaces: { Hard: { last52: node(293.9, 160.1, 245.5, 1.36, 6, 96), sinceBase: since(290.1, 159.6, 225.9, 1.34), elo: { rating: 2050, pct: 99 } } } } } };
}

const axisTip = (h, name) => { const x = new RegExp(`<span title="([^"]*)"[^>]*>\\s*<span[^>]*>${name}</span>`).exec(h); assert.ok(x, 'axis ' + name + ' has its hover'); return x[1].replace(/&lt;br&gt;/g, ' | ').replace(/&amp;/g, '&'); };
const dnaCard = h => h.slice(0, h.indexOf('>Record against each style<'));
const polys = h => [...h.matchAll(/<polygon points="([^"]*)"[^>]*stroke="var\(--ma2-(blue|text)\)"/g)].map(x => ({ who: x[2] === 'blue' ? 'a' : 'b', pts: x[1].trim().split(/\s+/) }));

// Mutation: the hover drops the population / n (or states the wrong one); the window label back to "Career".
test('DNA: true percentiles with the population and n on the axis hover; "Since Mar 2024", never "Career"', () => {
  setup(); S.dna = dna(); S.ELO['J. Sinner'] = 2234; S.ELO['C. Alcaraz'] = 2071;
  const m = match('J. Sinner', 'C. Alcaraz');
  let h = S.buildStyleSection(m);
  assert.match(axisTip(h, 'Serve'), /Sinner: 304 · percentile 99\.0 .*Rank among 178 rated ATP main-tour players with &gt;= 10 matches \(Hard, last 52 weeks\)/);
  assert.match(axisTip(h, 'Surface Elo'), /current Tennis Abstract rating, the same on both views .*Rank among 272 /);
  assert.match(text(dnaCard(h)), /Last 52 weeks Since Mar 2024/); assert.doesNotMatch(text(dnaCard(h)), /\bCareer\b/);
  S.ps2StateFor(m).win = 'since';
  h = S.buildStyleSection(m);
  assert.match(axisTip(h, 'Serve'), /since Mar 2024 .*Rank among 210 /);
  assert.equal(axisTip(h, 'Under pressure'), 'No since-Mar-2024 figure yet; see the career view.', 'founder Q14: the since view dashes Under pressure');
});

// Founder Q14 (TEN-312 5262e790). Mutation: falling back to the career scope prints a number.
// RENDERER GAP: the rebuilt radar draws the since-view Under pressure vertex at the centre (a 0th-percentile point);
// Q14 = no shape point for that axis.
test('DNA (Q14): on the since view Under pressure is "—" for both players — no number, no shape point', () => {
  setup();
  const D = dna(); D.byKey[2].surfaces.Hard.last52.sample.matches = 40; S.dna = D;
  const m = match('J. Sinner', 'C. Alcaraz');
  const lab = h => text(new RegExp('<span title="[^"]*"[^>]*>\\s*<span[^>]*>Under pressure</span>[\\s\\S]*?</span></span></span>').exec(h)[0]);
  const cmp = h => { const i = h.lastIndexOf('>Under pressure</span>'); return text(h.slice(h.lastIndexOf('<div style="display:grid; grid-template-columns:66px', i), h.indexOf('</div></div></div>', i))); };
  let h = S.buildStyleSection(m);
  assert.match(lab(h), /Under pressure 319\.0 · 245\.5/);
  assert.deepEqual(polys(h).map(p => p.pts.length), [5, 5]);
  S.ps2StateFor(m).win = 'since';
  h = S.buildStyleSection(m);
  assert.match(lab(h), /Under pressure — · —$/, 'both players dashed on the radar label');
  assert.match(cmp(h), /^— Under pressure — —(?: |$)/, 'no number in the comparison row: ' + cmp(h));
  const ctr = '210.0,150.0';
  assert.ok(polys(h).every(p => !p.pts.includes(ctr)), 'no Under pressure shape point (a vertex at the centre reads 0th percentile)');
});

// Mutation: the Elo axis read from the window's node (a windowed Elo — D6 says none exists).
test('DNA (D6): Surface Elo is the current rating on both views', () => {
  setup(); S.dna = dna(); S.ELO['J. Sinner'] = 2234; S.ELO['C. Alcaraz'] = 2071;
  const m = match('J. Sinner', 'C. Alcaraz');
  const elo = h => text(new RegExp('<span title="[^"]*"[^>]*>\\s*<span[^>]*>Surface Elo[^<]*</span>[\\s\\S]*?</span></span></span>').exec(h)[0]);
  const a = elo(S.buildStyleSection(m));
  S.ps2StateFor(m).win = 'since';
  const b = elo(S.buildStyleSection(m));
  assert.equal(a, b); assert.match(a, /2234 · 2071/, 'the live rating, not the file\'s 2200 / 2050');
});
// RENDERER GAP (D6 / modal-playing-style.md: "labelled 'current' (the radar label 'Surface Elo · current')"): the rebuilt
// radar label reads "Surface Elo" and the comparison row "Elo on hard"; "current" is only in the hover.
test('DNA (D6, renderer gap): the Surface Elo label says "current"', () => {
  setup(); S.dna = dna(); S.ELO['J. Sinner'] = 2234; S.ELO['C. Alcaraz'] = 2071;
  const h = S.buildStyleSection(match('J. Sinner', 'C. Alcaraz'));
  assert.match(text(new RegExp('<span title="[^"]*"[^>]*>\\s*<span[^>]*>Surface Elo[^<]*</span>').exec(h)[0]), /current/, 'the radar label says "current"');
});

// Mutation: a below-floor player's polygon still drawn. (Dropped with the 2026-11-23 design: the Δ vs 2024–now — the
// profile rows that carried it are replaced by the comparison list.)
test('DNA: a player under the 10-match floor draws no shape and says why', () => {
  setup(); S.dna = dna();
  const h = S.buildStyleSection(match('J. Sinner', 'C. Alcaraz'));
  assert.deepEqual(polys(h).map(p => p.who), ['a'], 'Alcaraz has 6 matches: no shape');
  assert.match(text(h), /No shape · Alcaraz: fewer than 10 matches last 52 weeks on hard \(6\)/);
});

// 2026-11-23 design (STEP1 #7, founder proceeding): player one blue, player two white — replaces D4's both-white palette
// and ruling 8's leader / trailer bars inside the box. Mutation: the two series swapped or a --link stroke.
test('DNA colours: player one blue, player two white; no link blue', () => {
  const D = dna(); D.byKey[2].surfaces.Hard.last52.sample.matches = 40;
  setup(); S.dna = D;
  const h = S.buildStyleSection(match('J. Sinner', 'C. Alcaraz'));
  assert.match(h, /<polygon points="[^"]+" fill="color-mix\(in srgb, var\(--ma2-blue\) 16%, transparent\)" stroke="var\(--ma2-blue\)"/, 'A = blue');
  assert.match(h, /<polygon points="[^"]+" fill="color-mix\(in srgb, var\(--ma2-text\) 7%, transparent\)" stroke="var\(--ma2-text\)"/, 'B = white');
  assert.ok(h.indexOf('stroke="var(--ma2-text)"') < h.indexOf('stroke="var(--ma2-blue)"'), 'A drawn on top');
  assert.doesNotMatch(h, /var\(--link\)/);
});

// Mutation: the design's review switchers / SAMPLE chip / seeded rows back in the tab.
test('no sample data or review switcher in the tab (DoD 4)', () => {
  const code = PS2.split('\n').map(l => l.replace(/\s*\/\/ .*$/, '')).filter(l => !/^\s*\/\//.test(l)).join('\n');   // code, not the comments that name what is not built
  assert.doesNotMatch(code, /SAMPLE|Sample opponent|1,591|psPal|psPrVar|Style dimensions/);
  const ps = MA2_SRC.slice(MA2_SRC.indexOf('// PLAYING STYLE (LOCKED'), MA2_SRC.indexOf('root.maStyleV2')).split('\n').map(l => l.replace(/\s*\/\/ .*$/, '')).join('\n');
  assert.doesNotMatch(ps, /SAMPLE|Sample opponent|psPal|psPrVar/, 'the rebuilt renderer carries no sample or review switcher');
  setup(); S.STY['A. Aa'] = { archetype_label: CP }; S.STY['B. Bb'] = { archetype_label: AB };
  assert.doesNotMatch(S.buildStyleSection(match('A. Aa', 'B. Bb')), /SAMPLE/i);
});

// Mutation: the archetypes read before they load ("not classified" for everyone while the file is in flight).
test('loading: archetypes not in memory → the one-line loading state, not "not classified" (G17)', () => {
  setup(); S.styles = { byKey: {} };
  assert.equal(text(S.buildStyleSection(match('A. Aa', 'B. Bb', { _ps2Loaded: false }))), 'Loading playing styles…');
  assert.match(text(S.buildStyleSection(match('A. Aa', 'B. Bb'))), /playing style is not classified/);
});

// DoD 8 kept: the old renderers are deleted, not hidden; every played row opens the ONE sheet through maRowOnclick.
// (Superseded by the 2026-11-23 lock: "rows through maMatchRowsHtml" — every rebuilt tab draws the design's own rows.)
test('DoD 8: the old renderers are deleted, not hidden; rows open the shared sheet', () => {
  for (const f of ['styleVsArchetypeRowHtml', 'psvListHtml', 'styleVsArchetypeCard', 'stylePersonalCard', 'styleEdgeHtml', 'styleDnaRadarHtml', 'styleArchLabelsHtml', 'styleSurfaceTableHtml'])
    assert.equal(html.indexOf(`function ${f}(`), -1, f + ' is deleted');
  assert.doesNotMatch(PS2, /class="elotip|<div class="[^"]*psvr/, 'no own tooltip or row grid in the page block');
  assert.match(MA2_SRC, /const click = wo \? '' : maRowOnclick\(\{ key, name, ek: null, date: r\.date, opp: r\.opponent,/);
});

// Mutation: the TML walkover skip removed from the builder (a "W/O" counted in the matrix, the record and the shard).
// Founder 2026-10-22: the walkover is a LISTED meeting row (flagged), never in a cell or a record.
test('build-matchup-matrix.js (N2 + 2026-10-22): a TML walkover enters no cell and no record; it is a flagged meeting row', () => {
  const root = mkdtempSync(join(tmpdir(), 'ten340-mm-'));
  try {
    mkdirSync(join(root, 'tools')); mkdirSync(join(root, 'tml-cache'));
    const src = process.env.TEN340_BUILDER || join(HERE, 'tools', 'build-matchup-matrix.js');
    copyFileSync(src, join(root, 'tools', 'build-matchup-matrix.js'));
    writeFileSync(join(root, 'playing-styles.json'), JSON.stringify({ players: [{ name: 'Adam Alpha', archetype_label: CP }, { name: 'Bob Beta', archetype_label: AB }] }));
    const H = 'tourney_id,tourney_name,surface,tourney_date,winner_id,winner_name,loser_id,loser_name,score,round';
    writeFileSync(join(root, 'tml-cache', '2025.csv'), [H, 'a,Chengdu,Hard,20250901,1,Adam Alpha,2,Bob Beta,6-4 6-4,R32', 'b,Tokyo,Hard,20250908,2,Bob Beta,1,Adam Alpha,6-4 3-1 RET,R16',
      'c,Basel,Hard,20251020,1,Adam Alpha,2,Bob Beta,W/O,QF'].join('\n'));
    const r = spawnSync(process.execPath, [join(root, 'tools', 'build-matchup-matrix.js')], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const M = JSON.parse(readFileSync(join(root, 'matchup-matrix.json'), 'utf8'));
    assert.equal(M.matrix[CP][AB].n, 2, 'the cell counts the two played matches');
    assert.deepEqual(M.byPlayer['alpha|a'].vs[AB], { w: 1, l: 1 });
    const shard = JSON.parse(readFileSync(join(root, 'style-meetings', 'alpha-a.json'), 'utf8'));
    assert.equal(shard.vs[AB].filter(x => !x.walkover).length, 2, 'the two played matches');
    assert.deepEqual(shard.vs[AB].filter(x => x.walkover).map(x => x.result), ['W/O'], 'the walkover, listed and flagged');
    assert.equal(M.tmlWalkoverExcluded, 1);
    // the api supplement carries the same Basel walkover as a finished row (±1 day): the TML pair + date still dedup it
    writeFileSync(join(root, 'tml-cache', 'apitennis-2026.json'), JSON.stringify({ fixtures: [{ status: 'Finished', winner: '1', date: '2025-10-21', p1: 'Adam Alpha', p2: 'Bob Beta',
      tournament: 'Basel', tournament_key: 'x', sets: [['6', '0']], round: 'Basel - Quarter-finals' }] }));
    const r2 = spawnSync(process.execPath, [join(root, 'tools', 'build-matchup-matrix.js')], { cwd: root, encoding: 'utf8' });
    assert.equal(r2.status, 0, r2.stderr);
    const M2 = JSON.parse(readFileSync(join(root, 'matchup-matrix.json'), 'utf8'));
    assert.deepEqual(M2.byPlayer['alpha|a'].vs[AB], { w: 1, l: 1 }, 'the api copy of the walkover is deduped, not counted');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// 2026-11-23 design order: Playing style (radar + comparison) → Record against each style (boxes, then lists). The
// record's "Vs other styles" bar is signed: --ma2-green above, --ma2-red below (the Playing-styles signed-bar exception).
test('2026-11-23 design: order, signed "Vs other styles" bars', () => {
  setup(); S.STY['A. Arnaldi'] = { archetype_label: AB }; S.STY['B. Baez'] = { archetype_label: CP };
  const m = match('A. Arnaldi', 'B. Baez', { p1StyleMeetings: { [CP]: rows(7, 3), [ACE]: rows(5, 5) }, p2StyleMeetings: { [AB]: rows(2, 9), [ACE]: rows(5, 5) } });
  const h = S.buildStyleSection(m);
  assert.ok(h.indexOf('>Playing style</span>') >= 0 && h.indexOf('>Playing style</span>') < h.indexOf('>Record against each style<'), 'DNA → record');
  assert.ok(h.indexOf('>Vs other styles<') < h.indexOf('>Showing '), 'boxes before the lists');
  const vs = [boxTiles(h, 0)[2], boxTiles(h, 1)[2]];
  assert.deepEqual(vs.map(x => x.v), ['+20 pts', '−32 pts']);
  assert.deepEqual(vs.map(x => x.color), ['var(--ma2-green)', 'var(--ma2-red)']);
});
