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
  return { buildStyleSection, ps2Record, ps2Edge, ps2Meeting, ps2IsWalkover, ps2StateFor, _maRowReg, STY, ELO,
    set matrix(v){ psMatrixData = v; }, set dna(v){ _mdna = v; }, set styles(v){ playerStyles = v; }, get tips(){ return tips; } };
`)();
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
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
function setup(){ S.matrix = matrix(); S.styles = { byKey: { x: 1 } }; S.dna = { byKey: {}, meta: {} }; for (const k of Object.keys(S.STY)) delete S.STY[k]; for (const k of Object.keys(S.ELO)) delete S.ELO[k]; }

// Mutation: the mirror falls through to the "below the floor" branch (psCellFor's diagonal null read as a thin cell).
test('mirror matchup (G5): the 50/50 matrix copy, the diagonal n, no surface tiles', () => {
  setup(); S.STY['J. Sinner'] = { archetype_label: ACE }; S.STY['C. Alcaraz'] = { archetype_label: ACE };
  const h = S.buildStyleSection(match('J. Sinner', 'C. Alcaraz', { p1StyleMeetings: { [ACE]: rows(14, 15) }, p2StyleMeetings: { [ACE]: rows(15, 12) } }));
  const t = text(h);
  assert.match(t, /Mirror matchup: both play as All Court Elites n=39 tour meetings · same archetype 50% 50%/);
  assert.match(t, /Style gives neither player an edge/);
  assert.doesNotMatch(h, /class="ps2-tile"/, 'no surface tiles on a mirror (G5)');
  // the personal record's matrix avg on a mirror = the diagonal's 50%
  assert.match(t, /Sinner vs All Court Elites W14–L15 48% n=29 .*Matrix avg 50% −2/);
});

// Mutation: the matrix cell read in p2's direction (the leader's name and the percentages swap).
test('cross-archetype cell: p1 direction, the lean, three surface tiles (today tagged, below-floor dashed with its n)', () => {
  setup(); S.STY['A. Arnaldi'] = { archetype_label: AB }; S.STY['B. Baez'] = { archetype_label: CP, variety: true };
  const h = S.buildStyleSection(match('A. Arnaldi', 'B. Baez'));
  const t = text(h);
  assert.match(t, /Counterpunchers beat Attacking Baseliners n=1,592 tour meetings 48% 52% Attacking Baseliner 50% coin-flip Counterpuncher/);
  assert.match(t, /Leans \+2 pts to the counterpuncher/);
  assert.match(h, /\+ Variety Player/);
  const tile = sf => text(new RegExp(`data-ps2-surface="${sf}"[\\s\\S]*?</div>\\s*</div>|data-ps2-surface="${sf}"[\\s\\S]*?</span></div>`).exec(h)[0]);
  assert.match(tile('Clay'), /Clay n=447 48% – 52%/);
  assert.match(tile('Hard'), /Hard n=968 47% – 53% Today's surface/);
  assert.match(tile('Grass'), /Grass n=12 — – —/);
  // each box's "Matrix avg" in ITS player's direction: Arnaldi (AB) v CP = 48, Baez (CP) v AB = 52
  assert.match(text(/data-ps2-side="a"[\s\S]*?data-ps2-side="b"/.exec(h)[0]), /Matrix avg 48%/);
  assert.match(text(/data-ps2-side="b"[\s\S]*?class="ps2-card ps2-dna"/.exec(h)[0]), /Matrix avg 52%/);
  // an unknown (or carpet) surface tags no tile as today's
  assert.doesNotMatch(text(S.buildStyleSection(match('A. Arnaldi', 'B. Baez', { surface: '' }))), /Today's surface/);
});

// Mutation: the lean threshold dropped (a 51% cell "leans +1 pts") — the live rule: under 2 points is a coin-flip.
test('lean: under 2 points reads as a coin-flip on style', () => {
  setup(); const M = matrix(); M.matrix[CP][AB] = { pct: 51, n: 900 }; M.matrix[AB][CP] = { pct: 49, n: 900 }; S.matrix = M;
  S.STY['A. Aa'] = { archetype_label: CP }; S.STY['B. Bb'] = { archetype_label: AB };
  assert.match(text(S.buildStyleSection(match('A. Aa', 'B. Bb'))), /Effectively a coin-flip on style alone/);
});

// Mutation: the walkover filter removed from ps2Record (a W/O counted as a win / loss, N2).
test('personal record (N2): walkovers excluded from the W–L, n, the list and the "Show career meetings (n)" count; a retirement counts', () => {
  setup(); S.STY['A. Aa'] = { archetype_label: CP }; S.STY['B. Bb'] = { archetype_label: AB };
  const extra = [{ won: true, opponent: 'W O', surface: 'hard', tournament: 'Chengdu', result: 'W/O', date: '2026-01-05', round: 'R16', oddsSelf: null, oddsOpp: null },
    { won: true, opponent: 'R T', surface: 'hard', tournament: 'Chengdu', result: '6-4 3-1 RET', date: '2026-01-04', round: 'R32', oddsSelf: 1.4, oddsOpp: 3 }];
  const m = match('A. Aa', 'B. Bb', { p1StyleMeetings: { [AB]: rows(8, 4, extra) }, p2StyleMeetings: { [CP]: [] } });
  const R = S.ps2Record(m, 0);
  assert.equal(R.w, 9); assert.equal(R.l, 4); assert.equal(R.n, 13);
  assert.ok(!R.rows.some(r => /w\/o/i.test(r.result)), 'the walkover row is not listed');
  assert.match(text(S.buildStyleSection(m)), /Aa vs Attacking Baseliners W9–L4 69% n=13 .*\+5 wins .*Matrix avg 52% \+17 .*Show career meetings \(13\)/);
  S.ps2StateFor(m).meetA = true;
  assert.match(S.buildStyleSection(m), /6-4, 3-1<span class="ma-ret"[^>]*>ret\.<\/span>/, 'the shared scores cell marks the retirement');
});

// Mutation: the box keeps its own ladder (a % on n 1–4) instead of the one gate (D2).
test('D2 gate: n 0 "—", n 3 W–L only, n 7 grey + footnote, n 12 full', () => {
  setup(); S.STY['A. Aa'] = { archetype_label: CP }; S.STY['B. Bb'] = { archetype_label: AB };
  const box = (w, l) => { const h = S.buildStyleSection(match('A. Aa', 'B. Bb', { p1StyleMeetings: { [AB]: rows(w, l) }, p2StyleMeetings: { [CP]: [] } }));
    return { h, a: /data-ps2-side="a"[\s\S]*?Show career|data-ps2-side="a"[\s\S]*?No career meetings/.exec(h)[0] }; };
  let b = box(0, 0); assert.match(text(b.a), /W?— .*No career meetings/); assert.doesNotMatch(text(b.a), /0%|NaN/);
  b = box(2, 1); assert.match(text(b.a), /W2–L1 n=3/); assert.doesNotMatch(text(b.a), /W2–L1 \d+%/);
  assert.match(b.a, /right:50%; top:0; bottom:0; width:0%/, 'no tug fill on n 1–4 (a bar whose length is a rate follows the gate)');
  b = box(5, 2); assert.match(b.a, /data-ma-gate="small"/); assert.match(text(b.h), /Grey = small sample \(5–9 meetings\)/);
  b = box(8, 4); assert.match(b.a, /data-ma-gate="full"[^>]*>67%/); assert.doesNotMatch(text(b.h), /Grey = small sample/);
});

// Mutation: the list drawn by a tab-local row renderer / a row that stops opening the shared sheet (DoD 8).
test('career meetings (DoD 8): the shared rows, 8 shown + "Show N more matches" (G18), every row opens the shared sheet', () => {
  setup(); S.STY['A. Aa'] = { archetype_label: CP }; S.STY['B. Bb'] = { archetype_label: AB };
  const m = match('A. Aa', 'B. Bb', { p1StyleMeetings: { [AB]: rows(7, 5) }, p2StyleMeetings: { [CP]: rows(1, 1) } });
  S.ps2StateFor(m).meetA = true;
  const h = S.buildStyleSection(m);
  const card = /class="ps2-meet" data-ps2-side="a"[\s\S]*$/.exec(h)[0];
  assert.match(card, /class="ma-rows ma-rows-table"/, 'the shared table variant');
  assert.match(text(card), /Showing 8 of 12/); assert.match(text(card), /Show 4 more matches/);
  const ids = [...card.matchAll(/maOpenRowSheet\('(mr\d+)', this\)/g)].map(x => x[1]);
  assert.equal(ids.length, 8, 'every shown row opens the sheet');
  const d = S._maRowReg[ids[0]];
  assert.equal(d.key, '1'); assert.equal(d.name, 'A. Aa'); assert.ok(d.date && d.opp, 'joined by date + opponent');
  assert.doesNotMatch(h, /data-ps2-side="b"[^>]*class="ps2-meet"|class="ps2-meet" data-ps2-side="b"/, 'a closed box lists nothing');
  S.ps2StateFor(m).moreA = true;
  assert.match(text(S.buildStyleSection(m)), /Showing 12 of 12 .*Show fewer/);
  // the card's sub-line rate follows the same gate as the box (n 7 → grey)
  const m7 = match('A. Aa', 'B. Bb', { p1StyleMeetings: { [AB]: rows(5, 2) }, p2StyleMeetings: { [CP]: [] } }); S.ps2StateFor(m7).meetA = true;
  assert.match(/class="ps2-meet-sub"[^>]*>[\s\S]*?<\/span>(?=\s*<\/div>)/.exec(S.buildStyleSection(m7))[0], /data-ma-gate="small"[^>]*>71%/);
});

// Mutation: a player with no style label reads "No career meetings on record" (the meetings are only tracked between
// classified players — the claim would be false).
test('personal record: an unclassified player\'s own box says so, never "no meetings"', () => {
  setup(); S.STY['B. Bb'] = { archetype_label: CP };
  const h = S.buildStyleSection(match('A. Aa', 'B. Bb', { p1StyleMeetings: null, p2StyleMeetings: null }));
  const a = text(/data-ps2-side="a"[\s\S]*?data-ps2-side="b"/.exec(h)[0]);
  assert.match(a, /Aa's playing style is not classified/); assert.doesNotMatch(a, /No career meetings/);
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

// Mutation: the tooltip drops the population / n (or states the wrong one); the window label back to "Career".
test('DNA: true percentiles with the population and n on the shared tooltip; "Since Mar 2024", never "Career"', () => {
  setup(); S.dna = dna(); S.ELO['J. Sinner'] = 2234; S.ELO['C. Alcaraz'] = 2071;
  const m = match('J. Sinner', 'C. Alcaraz');
  let h = S.buildStyleSection(m);
  const tip = k => { const x = new RegExp(`data-ps2-axis="${k}" tabindex="0" data-aotip="([^"]*)"`).exec(h); assert.ok(x, 'axis ' + k + ' has the shared tooltip'); return x[1].replace(/&lt;br&gt;/g, ' | ').replace(/&amp;/g, '&'); };
  assert.match(tip('serve'), /Sinner: 304 · percentile 99\.0 .*Rank among 178 rated ATP main-tour players with &gt;= 10 matches \(Hard, last 52 weeks\)/);
  assert.match(tip('elo'), /current Tennis Abstract rating, the same on both views .*Rank among 272 /);
  assert.match(text(h), /Last 52 weeks Since Mar 2024/); assert.doesNotMatch(text(h), /\bCareer\b/);
  assert.ok(S.tips > 0, 'the positioned tooltip listener is initialised');
  S.ps2StateFor(m).win = 'since';
  h = S.buildStyleSection(m);
  assert.match(tip('serve'), /since Mar 2024 .*Rank among 210 /);
  assert.equal(tip('underPressure'), 'No since-Mar-2024 figure yet; see the career view.', 'founder Q14: the since view dashes Under pressure');
  assert.match(text(h), /percentile vs the api-tennis field · since Mar 2024/);
});

// Founder Q14 (TEN-312 5262e790). Mutation: falling back to the career scope prints a number.
test('DNA (Q14): on the since view Under pressure is "—" for both players — no number, shape point, percentile or Δ', () => {
  setup();
  const D = dna(); D.byKey[2].surfaces.Hard.last52.sample.matches = 40; S.dna = D;   // both players above the floor
  const m = match('J. Sinner', 'C. Alcaraz'); S.ps2StateFor(m).prof = true;
  const TIP = 'No since-Mar-2024 figure yet; see the career view.';
  const axis = h => /data-ps2-axis="underPressure" tabindex="0" data-aotip="([^"]*)"[\s\S]*?<\/span><\/span><\/span>/.exec(h);
  const row = h => /<div class="ps2-prow" data-ps2-axis="underPressure"[\s\S]*?<\/div><\/div>/.exec(h)[0];
  const pts = (h, c) => (new RegExp(`class="${c}" points="([^"]*)"`).exec(h) || [, ''])[1].trim().split(/\s+/).filter(Boolean).length;
  // 52-week view unchanged: both numbers, five shape points
  let h = S.buildStyleSection(m);
  assert.match(text(axis(h)[0]), /Under pressure 319\.0 · 245\.5/);
  assert.equal(pts(h, 'ps2-poly-a'), 5); assert.equal(pts(h, 'ps2-poly-b'), 5);
  S.ps2StateFor(m).win = 'since';
  h = S.buildStyleSection(m);
  const A = axis(h);
  assert.equal(A[1], TIP, 'the exact founder tooltip');
  assert.match(text(A[0]), /> Under pressure — · —$/, 'both players dashed on the radar label');
  const r = row(h);
  assert.doesNotMatch(text(r), /\d/, 'no number, percentile or Δ in the profile row');
  assert.match(text(r), /^— UNDER PRESSURE —$|^— Under pressure —$/);
  assert.match(r, /class="ps2-bar-a" style="width:0%/); assert.match(r, /class="ps2-bar-b" style="width:0%/);
  assert.equal(pts(h, 'ps2-poly-a'), 4, 'no Under pressure shape point for A'); assert.equal(pts(h, 'ps2-poly-b'), 4, 'nor for B');
  assert.match(r, new RegExp('data-aotip="' + TIP.replace(/[.;]/g, '\\$&') + '"'), 'the profile row carries the same tooltip');
});

// Mutation: the Elo axis read from the window's node (a windowed Elo — D6 says none exists).
test('DNA (D6): Surface Elo is the current rating on both views and says "current"', () => {
  setup(); S.dna = dna(); S.ELO['J. Sinner'] = 2234; S.ELO['C. Alcaraz'] = 2071;
  const m = match('J. Sinner', 'C. Alcaraz');
  const elo = h => /data-ps2-axis="elo"[\s\S]*?<\/span><\/span><\/span>/.exec(h)[0];
  const a = text(elo(S.buildStyleSection(m)));
  S.ps2StateFor(m).win = 'since';
  const b = text(elo(S.buildStyleSection(m)));
  assert.equal(a, b); assert.match(a, /Surface Elo · current 2234 · 2071/);
  S.ps2StateFor(m).prof = true;
  assert.match(text(S.buildStyleSection(m)), /current 2234 SURFACE ELO|current 2234 Surface Elo/);
});

// Mutation: the Δ printed on the since view (or a below-floor player's polygon still drawn).
test('DNA: Δ only on the 52-week view; a player under the 10-match floor draws no shape and says why', () => {
  setup(); S.dna = dna();
  const m = match('J. Sinner', 'C. Alcaraz'); S.ps2StateFor(m).prof = true;
  let h = S.buildStyleSection(m);
  assert.match(text(h), /▴ 3 304/, 'serve Δ vs 2024–now');
  assert.match(h, /class="ps2-poly-a"/); assert.doesNotMatch(h, /class="ps2-poly-b"/, 'Alcaraz has 6 matches: no shape');
  assert.match(text(h), /Alcaraz: 6 Hard matches last 52 weeks, below the 10-match floor; not drawn\./);
  S.ps2StateFor(m).win = 'since';
  h = S.buildStyleSection(m);
  assert.doesNotMatch(/class="ps2-prof"[\s\S]*$/.exec(h)[0], /[▴▾±]/, 'no Δ (not even ±0) on the since view');
});

// Mutation: a player coloured blue, or the profile bars toned by who leads (the non-negotiable: never highlight the better stat).
test('both players white (D4, palette `cur`); the profile bars never tone the leader', () => {
  // B leads on Serve (A leads the rest), so a bar toned by who leads would differ between the two sides
  const D = dna(); D.byKey[2].surfaces.Hard.last52.serve.pct = 100; D.byKey[2].surfaces.Hard.last52.sample.matches = 40;
  setup(); S.dna = D; S.STY['J. Sinner'] = { archetype_label: CP }; S.STY['C. Alcaraz'] = { archetype_label: AB };
  const m = match('J. Sinner', 'C. Alcaraz'); S.ps2StateFor(m).prof = true;
  const h = S.buildStyleSection(m);
  assert.match(h, /class="ps2-poly-a" points="[^"]+" fill="var\(--viz-guide\)" stroke="var\(--text\)"/);
  const bars = [...h.matchAll(/class="ps2-bar-([ab])" style="width:[^;]+; background:([^;]+);/g)];
  assert.equal(bars.length, 10);
  for (const [, side, bg] of bars) assert.equal(bg, 'var(--text)', 'bar ' + side);
  assert.doesNotMatch(/class="ps2-card ps2-dna"[\s\S]*$/.exec(h)[0].replace(/class="seg ps2-prof-toggle"[^>]*>/, ''), /var\(--link\)[^;]*;\s*(stroke|fill)|(stroke|fill)(="|:\s*)var\(--link\)/);
});

// Mutation: the design's review switchers / SAMPLE chip / seeded rows back in the tab.
test('no sample data or review switcher in the tab (DoD 4)', () => {
  const code = PS2.split('\n').map(l => l.replace(/\s*\/\/ .*$/, '')).filter(l => !/^\s*\/\//.test(l)).join('\n');   // code, not the comments that name what is not built
  assert.doesNotMatch(code, /SAMPLE|Sample opponent|1,591|psPal|psPrVar|Style dimensions/);
  setup(); S.STY['A. Aa'] = { archetype_label: CP }; S.STY['B. Bb'] = { archetype_label: AB };
  assert.doesNotMatch(S.buildStyleSection(match('A. Aa', 'B. Bb')), /SAMPLE/i);
});

// Mutation: the archetypes read before they load ("Not yet classified" for everyone while the file is in flight).
test('loading: archetypes not in memory → the one-line loading state, not "not yet classified" (G17)', () => {
  setup(); S.styles = { byKey: {} };
  assert.equal(text(S.buildStyleSection(match('A. Aa', 'B. Bb', { _ps2Loaded: false }))), 'Loading playing styles…');
  assert.match(text(S.buildStyleSection(match('A. Aa', 'B. Bb'))), /Not yet classified .*No style matchup/);
});

// Mutation: a tab-local row or tooltip renderer (the pre-TEN-340 ones, or any new one) — DoD item 8.
test('DoD 8: no tab-local row or tooltip renderer; the old renderers are deleted, not hidden', () => {
  for (const f of ['styleVsArchetypeRowHtml', 'psvListHtml', 'styleVsArchetypeCard', 'stylePersonalCard', 'styleEdgeHtml', 'styleDnaRadarHtml', 'styleArchLabelsHtml', 'styleSurfaceTableHtml'])
    assert.equal(html.indexOf(`function ${f}(`), -1, f + ' is deleted');
  assert.doesNotMatch(PS2, /class="elotip|title="|<div class="[^"]*psvr|grid-template-columns:\$\{PS2_MEET_GRID\}/, 'no own tooltip, native title or row grid');
  assert.match(PS2, /maMatchRowsHtml\(groups, \{ cols: PS2_MEET_COLS/);
  assert.match(PS2, /maRowOnclick\(\{ key, name: R\.name/);
});

// Mutation: the TML walkover skip removed from the builder (a "W/O" counted in the matrix, the record and the shard).
test('build-matchup-matrix.js (N2): a TML walkover enters no cell, no record and no meeting row', () => {
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
    assert.equal(shard.vs[AB].length, 2); assert.ok(!shard.vs[AB].some(x => /W\/O/.test(x.result)));
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
