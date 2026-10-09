// TEN-408 (founder step 9, 2026-10-09) — the Playing Styles page on the step-1 tokens, night. Every check drives the
// page's REAL code (the TEN-408 block, PS_ARCHETYPES, psCellFor and the name helpers sliced out of
// bsp-consult-dashboard.html and executed; tools/build-matchup-matrix.js run on a fixture) and is run against a mutant
// that must turn it red. Rules: .claude/rules/playing-styles.md.
//   · data: one classification; top-200 counts (key join + the scrambled-name fallback, unique both ways); cells under 30
//     matches "—" (the modal keeps its own floor); small sample < 10 players tagged + out of every pick + named in the
//     note; average edge = mean of the rated edges; the verdict bands; examples = top 5 by the Ratings Elo; no zero for
//     a store that failed to load; the note carries the window and no "Sample data."
//   · builder: Laver Cup + exhibitions out of every matrix cell, Davis Cup in, the records keep every match
//   · look: shell header, no top-level outline, open card = 10% white edge (never blue), green / red only on signed
//     figures, tug tick 40% white, ±2 = 35% white, hover = selected / inner / 25%
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const BUILDER = readFileSync(join(HERE, 'tools/build-matchup-matrix.js'), 'utf8');
const PIPE = readFileSync(join(HERE, 'bsp-pipeline.js'), 'utf8');
const FIX_INDEX = JSON.parse(readFileSync(join(HERE, 'tools/fixtures/ten408-player-index-top200.json'), 'utf8')).players;
const FIX_STYLES = JSON.parse(readFileSync(join(HERE, 'tools/fixtures/ten408-styles-labelled.json'), 'utf8'));
const MATRIX = JSON.parse(readFileSync(join(HERE, 'matchup-matrix.json'), 'utf8'));

function slice(html, name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let d = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; }
  return html.slice(start, i + 1);
}
function between(html, a, b) { const i = html.indexOf(a), j = html.indexOf(b, i); assert.ok(i > 0 && j > i, 'block not found: ' + a.slice(0, 40)); return html.slice(i, j); }
// A minimal DOM: getElementById hands back a recorder per id, so psRenderPage writes into plain objects.
function page(html) {
  const PAGE = between(html, '// ---- TEN-408 step 9 · the Playing Styles page', '/* ---------- MATCHES ---------- */');
  const ARCH = /const PS_ARCHETYPES = \[[\s\S]*?\n\];/.exec(html)[0];
  return new Function(`
    const els = {};
    const document = { getElementById(id){ return els[id] || (els[id] = { id, innerHTML: '', textContent: '', style: { setProperty(){}, display: '' }, addEventListener(){} }); },
      querySelectorAll(){ return []; }, querySelector(){ return null; } };
    let psMatrixData = null, playerIndex = [];
    ${ARCH}
    ${['psCellFor', 'psEsc', 'psEloNorm', 'psEloFor', 'styleKey', 'psGivenOf', 'psGivenClash'].map(n => slice(html, n)).join('\n')}
    ${PAGE}
    return { els, setMatrix(m){ psMatrixData = m; }, psStylesModel, psRenderPage, psRankedMembers, psVerdict, psBand, psFmtEdge, PS_ARCHETYPES, psCellFor };
  `)();
}
const P = page(HTML);
// Every mutant must hit its anchor: a replace that matches nothing returns the unchanged code and the check passes vacuously.
const mut = (a, b) => { assert.ok(HTML.includes(a), 'mutant anchor missing: ' + a.slice(0, 80)); return HTML.replace(a, b); };
const mutB = (a, b) => { assert.ok(BUILDER.includes(a), 'builder mutant anchor missing: ' + a.slice(0, 80)); return BUILDER.replace(a, b); };
// Elo store in the Ratings shape (fetch-elo.js: `ratings` = `elo[k].all.rating`).
function eloStore(map) {
  const ratings = {}, elo = {};
  for (const [k, v] of Object.entries(map)) { ratings[k] = v; elo[k] = { all: { rating: v } }; }
  return { ratings, elo, bySurname: {}, bySurnameElo: {} };
}
function model(p, stores) { p.setMatrix(stores.matrix); return p.psStylesModel(stores); }
const REAL = () => ({ matrix: MATRIX, styles: FIX_STYLES, index: FIX_INDEX, elo: JSON.parse(readFileSync(join(HERE, 'elo-ratings.json'), 'utf8')) });
// The same cells for every check that needs a hand-made matrix: 8 labels, every pair n=200 at 60% for the row unless set.
function grid(over = {}) {
  const L = P.PS_ARCHETYPES.map(a => a.ids[0]), m = {};
  L.forEach((a, i) => { m[a] = {}; L.forEach((b, j) => { m[a][b] = i === j ? { pct: 50, n: 10 } : { pct: i < j ? 60 : 40, n: 200 }; }); });
  for (const [k, v] of Object.entries(over)) { const [a, b] = k.split('|'); m[a][b] = v; m[b][a] = v.pct == null ? { ...v } : { pct: 100 - v.pct, n: v.n }; }
  return { matrix: { matrix: m, minSampleN: 20, matchesCounted: 1234, window: '2000-2026', through: '2026-10-08' } };
}
const PLAYERS = (counts) => {   // counts: label -> n ranked players named "<Label initial>. Pn<i>"
  const styles = [], index = []; let rank = 1;
  for (const [lab, n] of Object.entries(counts)) for (let i = 0; i < n; i++) {
    const sur = 'Zz' + lab.replace(/[^A-Za-z]/g, '') + i;
    styles.push({ name: 'Q. ' + sur, archetype_label: lab }); index.push({ key: String(1000 + rank), name: 'Quentin ' + sur, rank: rank++, hasProfile: true });
  }
  return { styles: { players: styles }, index };
};

// ── Data 2 + 3: the cells — the matrix the modal reads, "—" under 30 matches on this page only ──────────────────────
function checkCells(p) {
  const g = grid({ 'Big Server|All Court Elite': { pct: 30, n: 25 } });     // above the modal's floor (20), under the page's (30)
  const M = model(p, { ...g, styles: { players: [] }, index: null, elo: null });
  const i = 0, j = 7;
  if (M.cells[i][j].edge !== null) return 'a 25-match cell prints an edge (page floor is 30)';
  if (p.psCellFor(i, j).pct !== 30) return 'the modal lost its own floor-20 cell';
  if (M.cells[1][2].edge !== 10 || M.cells[1][2].wr !== 60) return 'edge is not win rate − 50';
  if (!/A cell under 30 matches shows —: Big Server vs All Court Elite \(25 matches\)\./.test(M.note)) return 'the note does not name the under-30 cell: ' + M.note;
  if (!M.cells[3][3].diag) return 'the diagonal is not the "—" cell';
  return null;
}
test('Data 3: a cell under 30 matches is "—" here and named in the note; the modal keeps the matrix floor', () => {
  assert.equal(checkCells(P), null);
  assert.ok(checkCells(page(mut('nn < PS_PAGE_MIN_N', 'nn < 20'))), 'mutant: the page floor at 20');
  assert.ok(checkCells(page(mut("if (thin.length) notes.push(", "if (false) notes.push("))), 'mutant: no note line for the thin cell');
});

// ── Data 4: N players = classified players in the ATP top 200 this week, one join, the scrambled names recovered ────
function checkCounts(p) {
  const M = model(p, REAL());
  const by = Object.fromEntries(M.arch.map(a => [a.name, a.count]));
  const want = { 'Big Server': 3, 'Big Server + First Strike': 23, 'Big Server + Complete Baseliner': 16, 'Attacking Baseliner': 67,
    'Solid Baseliner': 30, 'Counterpuncher': 20, 'Solid Defender': 11, 'All Court Elite': 3 };
  for (const [k, v] of Object.entries(want)) if (by[k] !== v) return `${k}: ${by[k]} players, want ${v}`;
  if (M.players !== 173 || M.players !== M.arch.reduce((s, a) => s + a.count, 0)) return 'header Players is not the sum of the cards: ' + M.players;
  if (M.styles !== 8 || M.matchups !== 28) return 'Styles / Matchups are not 8 / 28';
  // the scrambled standings name "Martin Etcheverry Tomas" (#31) is T. M. Etcheverry, Solid Baseliner
  const ranked = p.psRankedMembers(FIX_STYLES.players, FIX_INDEX, 200);
  const te = ranked.find(m => m.row.name === 'Martin Etcheverry Tomas');
  if (!te || te.player.name !== 'T. M. Etcheverry') return 'the scrambled standings name did not join';
  // unique both ways: two classified players who both fit one row join neither
  const amb = p.psRankedMembers([{ name: 'T. M. Etcheverry', archetype_label: 'Solid Baseliner' }, { name: 'T. Etcheverry', archetype_label: 'Counterpuncher' }],
    [{ key: '1', name: 'Martin Etcheverry Tomas', rank: 31 }], 200);
  if (amb.length) return 'an ambiguous fallback pairing joined';
  // a full given name must agree: Darwin Blanch (#159) is not the classified Dali Blanch (both blanch|d)
  const withDali = p.psRankedMembers(FIX_STYLES.players.concat([{ name: 'Dali Blanch', archetype_label: 'Big Server + First Strike' }]), FIX_INDEX, 200);
  if (withDali.some(m => m.row.name === 'Darwin Blanch')) return 'Darwin Blanch took his brother Dali\'s style';
  // rank 201 is out
  const out = p.psRankedMembers([{ name: 'A. Bcd', archetype_label: 'Big Server' }], [{ key: '9', name: 'Ann Bcd', rank: 201 }], 200);
  if (out.length) return 'rank 201 counted';
  return null;
}
test('Data 4: counts = classified players in this week\'s top 200 (173 on the 9 Oct fixture), header Players = the sum', () => {
  assert.equal(checkCounts(P), null);
  assert.ok(checkCounts(page(mut("if (pairs.filter(y => y.r === x.r).length === 1 && pairs.filter(y => y.p === x.p).length === 1)", 'if (true)'))), 'mutant: the fallback is not unique both ways');
  assert.ok(checkCounts(page(mut('Number(r.rank) <= cap', 'Number(r.rank) <= cap + 1'))), 'mutant: rank 201 counted');
  assert.ok(checkCounts(page(mut('  const free = lab.filter(p => !used.has(p));', '  const free = [];'))), 'mutant: no scrambled-name fallback');
  const M1 = "const c = (byKey.get(styleKey(r.name)) || []).filter(p => !psGivenClash(p.name, r.name));";
  assert.ok(HTML.includes(M1), 'mutant anchor moved');
  assert.ok(checkCounts(page(mut(M1, 'const c = (byKey.get(styleKey(r.name)) || []);'))), 'mutant: no given-name guard');
});

// ── Data 5 + 6: small sample tag, out of every pick, named in the note; average edge + verdict bands ───────────────
function checkSmallAndAvg(p) {
  const counts = { 'Big Server': 3, 'Big Server + First Strike': 12, 'Big Server + Complete Baseliner': 12, 'Attacking Baseliner': 12,
    'Solid Baseliner': 12, 'Counterpuncher': 12, 'Solid Defender': 10, 'All Court Elite': 9 };
  // Solid Baseliner (row 4): huge edge vs Big Server (small) and All Court Elite (small) — must not be its "best" picks.
  const g = grid({ 'Solid Baseliner|Big Server': { pct: 95, n: 300 }, 'Solid Baseliner|All Court Elite': { pct: 5, n: 300 } });
  const M = model(p, { ...g, ...PLAYERS(counts), elo: null });
  const slb = M.arch[4];
  if (!M.arch[0].small || !M.arch[7].small || slb.small || M.arch[6].small) return 'small sample is not "< 10 players" (10 is not small)';
  if (slb.picks.includes(0) || slb.picks.includes(7)) return 'a small-sample style is in a strongest / weakest pick';
  if (slb.picks.length !== 4) return 'not two best + two worst';
  if (!slb.vs.includes(0) || !slb.vs.includes(7) || slb.vs.length !== 7) return 'the Vs list dropped a style';
  if (!/Big Server \(3 players\) and All Court Elite \(9 players\) are below the 10-player threshold\./.test(M.note)) return 'the note does not name the small styles: ' + M.note;
  // average = mean of the seven rated edges, rounded
  const edges = [0, 1, 2, 3, 5, 6, 7].map(j => M.cells[4][j].edge);
  if (slb.avg !== Math.round(edges.reduce((s, v) => s + v, 0) / 7) || slb.rated !== 7) return 'average edge is not the mean of the seven edges: ' + slb.avg;
  const V = [[25, 'Strong advantage'], [24, 'Slight edge'], [6, 'Slight edge'], [5, 'Even matchups'], [-5, 'Even matchups'], [-6, 'Slight disadvantage'], [-15, 'Slight disadvantage'], [-16, 'Struggles broadly']];
  for (const [a, w] of V) if (p.psVerdict(a) !== w) return `verdict at ${a} is ${p.psVerdict(a)}`;
  return null;
}
test('Data 5 + 6: small sample (< 10) tagged, out of every pick, named in the note; average edge and the verdict bands', () => {
  assert.equal(checkSmallAndAvg(P), null);
  assert.ok(checkSmallAndAvg(page(mut('const pickable = rated.filter(b => !b.small);', 'const pickable = rated;'))), 'mutant: small styles picked');
  assert.ok(checkSmallAndAvg(page(mut('count != null && count < PS_SMALL_N', 'count != null && count <= PS_SMALL_N'))), 'mutant: 10 counted as small');
  assert.ok(checkSmallAndAvg(page(mut("avg >= 6 ? 'Slight edge'", "avg > 6 ? 'Slight edge'"))), 'mutant: a band boundary moved');
});

// ── Data 7 + 9: example players = top 5 by the Ratings Elo; a store that failed is "—", never 0; no sample data ─────
function checkExamplesAndAbsent(p) {
  const pl = PLAYERS({ 'Attacking Baseliner': 7 });
  const elo = eloStore(Object.fromEntries(pl.styles.players.map((s, i) => [s.name.split(' ')[1].toLowerCase() + '|q', 1500 + i * 10]).filter((_, i) => i !== 6)));
  const M = model(p, { ...grid(), ...pl, elo });
  const ex = M.arch[3].examples;
  if (ex.length !== 5 || ex[0].elo !== 1550 || ex[4].elo !== 1510) return 'not the top 5 by Elo: ' + JSON.stringify(ex.map(x => x.elo));
  const thin = eloStore(Object.fromEntries(pl.styles.players.slice(0, 3).map((s, i) => [s.name.split(' ')[1].toLowerCase() + '|q', 1500 + i])));
  if (model(p, { ...grid(), ...pl, elo: thin }).arch[3].examples.length !== 3) return 'unrated players backfill the top 5';
  if (ex.some(x => x.elo == null)) return 'an unrated player was shown';
  const N = model(p, { ...grid(), styles: pl.styles, index: null, elo: null });
  if (N.players !== null || N.arch.some(a => a.count !== null || a.small)) return 'a failed standings load reads as 0 / small';
  p.psRenderPage(N);
  if (!/<span class="sfh__v sfh__v--none">—<\/span>/.test(p.els.psHeadStats.innerHTML)) return 'header Players is not a grey "—"';
  if (/>0 players</.test(p.els.psCards.innerHTML)) return 'a card prints 0 players';
  const S0 = model(p, { ...grid(), styles: null, index: pl.index, elo: null });
  if (S0.players !== null || S0.arch.some(a => a.count !== null || a.small) || /threshold/.test(S0.note)) return 'a failed styles load reads as 0 players / small sample';
  const M0 = model(p, { matrix: null, styles: pl.styles, index: pl.index, elo: null });
  if (/\(0\)|Under 30/.test(M0.note) || M0.cells[0][1].edge !== null || M0.cells[0][1].n !== null) return 'a failed matrix load prints 0-match cells: ' + M0.note;
  if (/Sample data/i.test(HTML.slice(HTML.indexOf('data-page="styles"'), HTML.indexOf('data-page="styles"') + 3000)) || /Sample data/i.test(N.note)) return '"Sample data." is still on the page';
  return null;
}
test('Data 7 + 9: examples = top 5 by the weekly Ratings Elo; an absent store is "—", never 0; no "Sample data."', () => {
  assert.equal(checkExamplesAndAbsent(P), null);
  assert.ok(checkExamplesAndAbsent(page(mut('.filter(x => x.elo != null).sort((x, y) => y.elo - x.elo)', '.sort((x, y) => (y.elo || 0) - (x.elo || 0))'))), 'mutant: unrated players backfill');
  assert.ok(checkExamplesAndAbsent(page(mut("(v == null ? '—' : Number(v).toLocaleString('en-US'))", "(Number(v || 0).toLocaleString('en-US'))"))), 'mutant: absent reads 0');
  const safe = f => { try { return f(); } catch (e) { return 'threw: ' + e.message; } };
  assert.ok(safe(() => checkExamplesAndAbsent(page(mut('const ranked = (stores.index && stylesOk)', 'const ranked = (stores.index)')))), 'mutant: a failed styles load counts 0');
  assert.ok(checkExamplesAndAbsent(page(mut('    if (!haveM) return { n: null, wr: null, edge: null };\n', ''))), 'mutant: a failed matrix load = 0-match cells');
});

// ── Data 2 + 9: the note line — the window, the Form rule, full stops (no "—" between sentences) ───────────────────
function checkNote(p) {
  const M = model(p, { ...grid(), styles: { players: [] }, index: null, elo: null });
  if (!M.note.startsWith('Win rates from 1,234 completed ATP main-draw matches between classified players, 2000 \u2013 8 Oct 2026. Styles are each player\'s current label. Laver Cup and exhibitions out.'))
    return 'the note does not state the source, the window and the Form rule: ' + M.note;
  if (/ — /.test(M.note)) return 'an em dash separates sentences';
  return null;
}
test('Data 2: the note line states the match pool, the window (2000 to the last match) and the Form rule, full stops only', () => {
  assert.equal(checkNote(P), null);
  assert.ok(checkNote(page(mut("current label. Laver Cup and exhibitions out.'", "current label — Laver Cup and exhibitions out.'"))), 'mutant: em dash between sentences');
  // the regenerated store carries the window and the Form rule count
  assert.equal(MATRIX.from && MATRIX.through && typeof MATRIX.formRuleExcluded === 'number', true, 'matchup-matrix.json lacks from / through / formRuleExcluded');
});

// ── Builder: Laver Cup + exhibitions out of every cell; Davis Cup in; records keep every match ───────────────────────
function runBuilder(src) {
  const dir = mkdtempSync(join(tmpdir(), 'ten408-mx-'));
  try {
    mkdirSync(join(dir, 'tools')); mkdirSync(join(dir, 'tml-cache'));
    writeFileSync(join(dir, 'tools/build-matchup-matrix.js'), src);
    writeFileSync(join(dir, 'playing-styles.json'), JSON.stringify({ players: [{ name: 'A. Alpha', archetype_label: 'Big Server' }, { name: 'B. Beta', archetype_label: 'Attacking Baseliner' }] }));
    const H = 'tourney_id,tourney_name,surface,draw_size,tourney_level,indoor,tourney_date,match_num,winner_id,winner_seed,winner_entry,winner_name,winner_hand,winner_ht,winner_ioc,winner_age,winner_rank,winner_rank_points,loser_id,loser_seed,loser_entry,loser_name,score,best_of,round';
    const row = (t, lvl, d, w, l) => `x,${t},Hard,8,${lvl},I,${d},1,${w === 'Alpha' ? 1 : 2},,,${w === 'Alpha' ? 'Ann Alpha' : 'Bob Beta'},R,,,,,,${l === 'Alpha' ? 1 : 2},,,${l === 'Alpha' ? 'Ann Alpha' : 'Bob Beta'},6-4 6-4,3,RR`;
    writeFileSync(join(dir, 'tml-cache/2024.csv'), [H, row('Laver Cup', 'A', '20240920', 'Alpha', 'Beta'), row('Davis Cup Finals QF: ITA vs ARG', 'D', '20241119', 'Beta', 'Alpha'),
      row('Doha', 'A', '20240219', 'Alpha', 'Beta'), row('Six Kings Slam Exhibition', 'A', '20241016', 'Alpha', 'Beta')].join('\n') + '\n');
    // the api-tennis season supplement: a Laver Cup row (out) and a regular row (in)
    const fx = (t, d) => ({ status: 'Finished', winner: '1', date: d, p1: 'A. Alpha', p2: 'B. Beta', tournament: t, tournament_key: '9', sets: [['6', '4'], ['6', '4']], round: '' });
    writeFileSync(join(dir, 'tml-cache/apitennis-2026.json'), JSON.stringify({ fixtures: [fx('ATP Laver Cup', '2026-09-20'), fx('ATP Shanghai', '2026-10-05')] }));
    const r = spawnSync(process.execPath, [join(dir, 'tools/build-matchup-matrix.js')], { encoding: 'utf8' });
    if (r.status !== 0) return 'builder failed: ' + r.stderr.slice(0, 300);
    return JSON.parse(readFileSync(join(dir, 'matchup-matrix.json'), 'utf8'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function checkBuilder(src) {
  const m = runBuilder(src);
  if (typeof m === 'string') return m;
  const c = m.matrix['Big Server']['Attacking Baseliner'];
  if (c.n !== 3) return `the cell counts ${c.n} matches, want 3 (Doha + Davis Cup + Shanghai; both Laver Cups and the exhibition out)`;
  if (m.formRuleExcluded !== 3) return 'formRuleExcluded is not 3';
  if (m.matrixBySurface.hard['Big Server']['Attacking Baseliner'].n !== 2) return 'the hard-court plane kept a Laver Cup / exhibition match';
  const bp = m.byPlayer['alpha|a'].vs['Attacking Baseliner'];
  if (bp.w + bp.l !== 6) return 'the personal record lost a match (records keep every match)';
  if (m.from !== '2024-02-19' || m.through !== '2026-10-05') return `window ${m.from}..${m.through}`;
  return null;
}
test('builder: the Form rule — Laver Cup and exhibitions out of every cell, Davis Cup in, records keep every match', () => {
  assert.equal(checkBuilder(BUILDER), null);
  assert.ok(checkBuilder(mutB("const formMatch = !FORM_NOT_ATP_RECORD.test(c[ix.tourney_name] || '');", 'const formMatch = true;')), 'mutant: no Form rule');
  assert.ok(checkBuilder(mutB("if (formMatch && winsSurf[surf])", 'if (winsSurf[surf])')), 'mutant: the surface plane keeps Laver Cup');
  assert.ok(checkBuilder(mutB("if (FORM_NOT_ATP_RECORD.test(r.tournament || '')) { formOut++; supp.added++; continue; }", '')), 'mutant: the api-tennis supplement keeps Laver Cup');
  // one list in all three places
  const re = s => /laver cup\|hopman cup\|ultimate tennis showdown\|\\buts\\b\|six kings\|exhibition\|kooyong classic\|mubadala world tennis/.test(s);
  assert.ok(re(BUILDER), 'builder list drifted');
  assert.ok(/const H2H_NOT_ATP_RECORD = \/hopman cup\|ultimate tennis showdown\|\\buts\\b\|six kings\|exhibition\|kooyong classic\|mubadala world tennis\/i;/.test(PIPE)
    && /new RegExp\('laver cup\|' \+ H2H_NOT_ATP_RECORD\.source/.test(PIPE), 'pipeline list drifted');
  assert.ok(/const FH_H2H_NOT_ATP_RECORD = \/hopman cup\|ultimate tennis showdown\|\\buts\\b\|six kings\|exhibition\|kooyong classic\|mubadala world tennis\/i;/.test(HTML), 'dashboard list drifted');
});

// ── Render: cells, tug bars, the open detail, links ──────────────────────────────────────────────────────────────────
function checkRender(p) {
  const pl = PLAYERS({ 'Big Server': 12, 'Big Server + First Strike': 12, 'Big Server + Complete Baseliner': 12, 'Attacking Baseliner': 12,
    'Solid Baseliner': 12, 'Counterpuncher': 12, 'Solid Defender': 12, 'All Court Elite': 12 });
  pl.index[0].hasProfile = false;
  const elo = eloStore(Object.fromEntries(pl.styles.players.map((s, i) => [s.name.split(' ')[1].toLowerCase() + '|q', 1700 - i])));
  const g = grid({ 'Big Server|Big Server + First Strike': { pct: 52, n: 100 }, 'Big Server|Big Server + Complete Baseliner': { pct: 47, n: 100 } });
  const M = model(p, { ...g, ...pl, elo });
  p.psRenderPage(M);
  const grid_ = p.els.psMatrix.innerHTML, cards = p.els.psCards.innerHTML, head = p.els.psHeadStats.innerHTML;
  if (!/<span class="sfh__l">Styles<\/span><span class="sfh__v">8<\/span>/.test(head) || !/>Players<\/span><span class="sfh__v">96</.test(head) || !/>Matchups<\/span><span class="sfh__v">28</.test(head)) return 'header stats: ' + head;
  if (!/<span class="ps-edge ps-edge-n">\+2<\/span><span class="ps-wr">52%<\/span>/.test(grid_)) return '+2 is not grey';
  if (!/<span class="ps-edge ps-edge-r">−3<\/span><span class="ps-wr">47%<\/span>/.test(grid_)) return '−3 is not red with a true minus';
  if (!/<span class="ps-edge ps-edge-g">\+10<\/span>/.test(grid_)) return '+10 is not green';
  if (!/<span class="ps-edge ps-edge-d">—<\/span>/.test(grid_)) return 'no faint "—" on the diagonal';
  if (!/Strong vs<\/span><span class="ps-baropp">/.test(cards) || !/Weak vs/.test(cards) || !/Even vs/.test(cards)) return 'tug labels';
  if (!/ps-tug-fill ps-tug-n" style="left:50%;width:2%;"/.test(cards)) return 'an even (±2) bar is not the 35% white fill from the tick';
  if (!/ps-tug-fill ps-tug-r" style="left:47%;width:3%;"/.test(cards)) return 'a loss bar does not run left from the tick';
  if (!/<span class="ps-axis"><span>−40<\/span><span>0<\/span><span>\+40<\/span><\/span>/.test(cards)) return 'no −40 / 0 / +40 axis';
  if (!/Average edge across its seven style matchups\./.test(cards)) return 'average line';
  if (!/<a class="ps-plink" href="#" onclick="event\.preventDefault\(\);event\.stopPropagation\(\);psOpenProfile\('10\d\d'\)">/.test(cards)) return 'example chips do not open the profile';
  if (!/<span class="ps-plink">Q\. ZzBigServer0<\/span>/.test(cards)) return 'a player with no profile is a link, or the chip is not the profile display name';
  if (!/>SRV · 12 players</.test(cards)) return 'card meta is not "code · N players"';
  return null;
}
test('render: grid cells sign-coloured at ±2, tug bars from the tick, the open detail, chips → Player Profile', () => {
  assert.equal(checkRender(P), null);
  assert.ok(checkRender(page(mut("function psBand(e){ return e > 2 ? 'g' : (e < -2 ? 'r' : 'n'); }", "function psBand(e){ return e > 0 ? 'g' : (e < 0 ? 'r' : 'n'); }"))), 'mutant: the ±2 band gone');
  assert.ok(checkRender(page(mut("(e < 0 ? 50 - w : 50)", '0'))), 'mutant: bars from the left edge');
  assert.ok(checkRender(page(mut("(p.key && p.hasProfile ?", '(p.key ?'))), 'mutant: a link without a profile');
});

// ── Look: the CSS the page owns (header = the shared .sfh, never restyled here) ─────────────────────────────────────
function cssOf(html) { return between(html, '/* ---------- PLAYING STYLES (TEN-408', '</style>'); }
function rule(css, sel) { const i = css.indexOf(sel + '{'); return i < 0 ? null : css.slice(i + sel.length + 1, css.indexOf('}', i)); }
function checkLook(html) {
  const css = cssOf(html), S = '[data-page="styles"] ';
  if (/\[data-page="styles"\] \.(ps-head|sfh)/.test(css)) return 'the page restyles the shell header';
  if (!/<div class="sfh ps-head">\s*<div class="sfh__text">\s*<h1 class="sfh__title">Matchup grid<\/h1>/.test(html)) return 'header is not the 35b .sfh card';
  for (const sel of ['.ps-gridcard', '.ps-arow']) { const r = rule(css, S + sel); if (!r || !/border:1px solid transparent/.test(r) || !/border-radius:12px/.test(r) || !/background:var\(--card\)/.test(r)) return sel + ' is not card tone, no outline, r12'; }
  if (!/border-color:var\(--edge-10\)/.test(rule(css, S + '.ps-arow.open') || '')) return 'the open card is not the 10% white edge';
  if (/--open-card|--bar\b|--viz-lead|--link|--viz-amber|--viz-(hard|clay|grass|indoor)/.test(css)) return 'blue / amber / surface colour on the page';
  if (!/color-mix\(in srgb, var\(--text\) 40%, transparent\)/.test(rule(css, S + '.ps-tug-tick') || '')) return 'tick is not 40% white';
  if (!/color-mix\(in srgb, var\(--text\) 35%, transparent\)/.test(rule(css, S + '.ps-tug-n') || '')) return 'even bar is not 35% white';
  if (!/18%/.test(rule(css, S + '.ps-sum .ps-tug-tick') || '')) return 'open tick is not 18% white';
  if (!/opacity:0\.25/.test(rule(css, S + '.ps-gridcard.ps-iso .ps-cell2') || '')) return 'hover does not drop the rest to 25%';
  if (!/background:var\(--inner\)/.test(rule(css, S + '.ps-gridcard.ps-iso .ps-lit') || '') || !/background:var\(--selected\)/.test(rule(css, S + '.ps-gridcard.ps-iso .ps-lit.ps-x') || '')) return 'hover tones';
  if (!/border-bottom:1px solid var\(--edge-10\)/.test(rule(css, S + '.ps-ghead') || '')) return 'no 10% rule under the grid head';
  if (!/border-top:1px solid var\(--edge-6\)/.test(rule(css, S + '.ps-note') || '') || !/font-size:11\.5px/.test(rule(css, S + '.ps-note') || '')) return 'note is not 11.5 on a 6% hairline';
  // green / red only on signed figures: the only --pos / --neg rules are the edge classes and the tug fills
  const signed = [...css.matchAll(/([^{}]+)\{[^}]*var\(--(pos|neg)\)/g)].map(m => m[1].trim());
  const ok = s => /\.ps-edge-[gr]$|\.ps-avg\.ps-edge-[gr]$|\.ps-tug-[gr]$/.test(s);
  if (signed.some(s => !ok(s))) return 'green / red outside a signed value: ' + signed.filter(s => !ok(s)).join(', ');
  return null;
}
test('look: shell header untouched, cards without outline, open = 10% white edge, no blue / amber, green / red only signed', () => {
  assert.equal(checkLook(HTML), null);
  assert.ok(checkLook(mut('[data-page="styles"] .ps-arow.open{ border-color:var(--edge-10); }', '[data-page="styles"] .ps-arow.open{ border-color:var(--open-card); }')), 'mutant: blue ring');
  assert.ok(checkLook(mut('[data-page="styles"] .ps-listhint{ font-size:12px; color:var(--text-label); }', '[data-page="styles"] .ps-listhint{ font-size:12px; color:var(--pos); }')), 'mutant: green on a label');
  assert.ok(checkLook(mut("[data-page=\"styles\"] .ps-gridcard{ background:var(--card); box-shadow:var(--top-light); border:1px solid transparent;", "[data-page=\"styles\"] .ps-gridcard{ background:var(--card); box-shadow:var(--top-light); border:1px solid var(--edge-6);")), 'mutant: outlined card');
});

// ── Keep as built: hover isolation + one card open at a time, executed on fake elements ─────────────────────────────
function fakeDom(html) {
  const PAGE = between(html, '// ---- TEN-408 step 9 · the Playing Styles page', '/* ---------- MATCHES ---------- */');
  const cls = () => { const set = new Set(); return { add: (...a) => a.forEach(x => set.add(x)), remove: (...a) => a.forEach(x => set.delete(x)), contains: x => set.has(x), set }; };
  const el = (r, c) => ({ attrs: { 'data-r': r, 'data-c': c }, classList: cls(), getAttribute(k){ return this.attrs[k] ?? null; }, closest(sel){ return sel === '#psMatrix' ? {} : (this.attrs['data-r'] != null || this.attrs['data-c'] != null ? this : null); } });
  const cells = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells.push(el(String(r), String(c)));
  const heads = [el(null, '0'), el(null, '1'), el('0', null)];
  const all = cells.concat(heads), gap = { closest: sel => (sel === '#psMatrix' ? {} : null) }, outside = { closest: () => null };
  const L = {}, card = { classList: cls(), addEventListener(t, f){ L[t] = f; }, querySelectorAll(sel){ return sel === '.ps-lit' ? all.filter(e => e.classList.contains('ps-lit')) : all; } };
  const rows = [0, 1, 2].map(() => ({ classList: cls() }));
  const document = { getElementById: id => (/^psArow\d$/.test(id) ? rows[+id.slice(6)] : null), querySelectorAll: () => rows.filter(r => r.classList.contains('open')) };
  const f = new Function('document', 'PS_ARCHETYPES', 'psCellFor', 'psEloNorm', 'psEloFor', 'styleKey', 'psEsc', 'playerIndex', 'psMatrixData', 'psGivenClash', PAGE + '\nreturn { psWireGridHover, psToggleRow };')(document, [], () => null, x => x, () => null, () => null, x => x, [], null, () => false);
  f.psWireGridHover(card);
  return { L, card, cells, heads, rows, gap, outside, f };
}
function checkKeep(html) {
  const D = fakeDom(html);
  D.L.mouseover({ target: D.cells[4] });                         // row 1 × col 1
  const lit = D.cells.filter(e => e.classList.contains('ps-lit')).map(e => e.attrs['data-r'] + e.attrs['data-c']).sort().join(',');
  if (lit !== '01,10,11,12,21') return 'hover does not light the crossed row + column: ' + lit;
  if (!D.cells[4].classList.contains('ps-x') || D.cells.filter(e => e.classList.contains('ps-x')).length !== 1) return 'the crossed cell is not the one selected-tone cell';
  if (!D.card.classList.contains('ps-iso') || !D.heads[1].classList.contains('ps-lit')) return 'no isolation / the column head is not lit';
  D.L.mouseover({ target: D.gap });                               // the 4px gap between two cells
  if (!D.card.classList.contains('ps-iso') || !D.cells[4].classList.contains('ps-x')) return 'crossing a gap between cells drops the isolation (flicker)';
  D.L.mouseover({ target: D.outside });                           // the note line
  if (D.card.classList.contains('ps-iso')) return 'leaving the grid keeps the isolation';
  D.L.mouseover({ target: D.cells[0] }); D.L.mouseleave();
  if (D.card.classList.contains('ps-iso') || D.cells.some(e => e.classList.contains('ps-lit'))) return 'mouseleave keeps the isolation';
  D.f.psToggleRow(0); D.f.psToggleRow(2);
  if (D.rows[0].classList.contains('open') || !D.rows[2].classList.contains('open')) return 'more than one card open';
  D.f.psToggleRow(2);
  if (D.rows.some(r => r.classList.contains('open'))) return 'a second click does not close the card';
  return null;
}
test('keep as built: hover isolates row + column (no flicker across the gaps); one card open at a time', () => {
  assert.equal(checkKeep(HTML), null);
  assert.ok(checkKeep(mut("    if (!t && e.target.closest('#psMatrix')) return;     // the 4px gap between cells: keep the current isolation\n", '')), 'mutant: the gap flicker');
  assert.ok(checkKeep(mut("  document.querySelectorAll('[data-page=\"styles\"] .ps-arow.open').forEach(e => e.classList.remove('open'));\n", '')), 'mutant: several cards open');
  assert.ok(checkKeep(mut("      if (r != null && c != null && er === r && ec === c) el.classList.add('ps-x');\n", '')), 'mutant: no selected-tone crossed cell');
});

// ── Founder, card 369e281c: ONE style per player on every page — a given-name clash on a shared key is another person ─
// Darwin Blanch (ranked 159) and his brother Dali Blanch (classified Big Server + First Strike) are both blanch|d.
function lookups(html) {
  return new Function(`
    let playerStyles = { byKey: {} }, pgArchByKey = null;
    let playerIndex = [{ key: '17463', name: 'Darwin Blanch', rank: 159 }, { key: '2072', name: 'Jannik Sinner', rank: 1 }, { key: '777', name: 'Daniel Vallejo Adolfo', rank: 52 }];
    let playerProfiles = {};
    ${['psEloNorm', 'styleKey', 'psGivenOf', 'psGivenClash', 'psIndexNameOf', 'psKeyNameClash', 'ppStyleFor', 'pgJoinKey', 'pgArchetypeFor'].map(n => slice(html, n)).join('\n')}
    return { psGivenClash, ppStyleFor, pgArchetypeFor, setIndex(x){ playerIndex = x; }, setProfiles(x){ playerProfiles = x; },
      load(rows){ const byKey = {}, byKeyAll = {}; rows.forEach(pl => { const k = styleKey(pl.name); if (k){ byKey[k] = pl; (byKeyAll[k] = byKeyAll[k] || []).push(pl); } });
        playerStyles = { byKey, byKeyAll }; pgArchByKey = new Map();
        rows.forEach(p => { const k = pgJoinKey(p.name); if (k && p.archetype_label) (pgArchByKey.get(k) || pgArchByKey.set(k, []).get(k)).push(p); }); } };
  `)();
}
function checkOneStyle(html) {
  const L = lookups(html);
  const DALI = { name: 'Dali Blanch', archetype_label: 'Big Server + First Strike' };   // a labelled row of ANOTHER player on blanch|d
  L.load(FIX_STYLES.players.concat([{ name: 'Ulises Blanch', archetype_label: null }, DALI]));
  const C = [['Dali', 'Darwin', true], ['Dali', 'Dar.', true], ['Alex', 'Alexander', false], ['D.', 'Darwin', false], ['J-L.', 'Jan-Lennard', false], ['T. M.', 'Martin', false]];
  for (const [a, b, want] of C) if (L.psGivenClash(a + ' X', b + ' X') !== want) return `psGivenClash(${a}, ${b}) is not ${want}`;
  for (const n of ['Dar. Blanch', 'Darwin Blanch']) {
    if (L.ppStyleFor(n)) return `Match analysis / Head to Head: ${n} took Dali Blanch's style`;
    if (L.pgArchetypeFor(n)) return `Players page: ${n} took Dali Blanch's style`;
  }
  // an initial-only name on Darwin's key (a career row "D. Blanch", oppKey 17463) is refused through the key's full name
  if (L.ppStyleFor('D. Blanch', '17463') || L.pgArchetypeFor('D. Blanch', '17463')) return 'an initial-only name on Darwin\'s key took Dali\'s style';
  // the board passes NUMERIC keys
  if (L.ppStyleFor('D. Blanch', 17463) || L.pgArchetypeFor('D. Blanch', 17463)) return 'a numeric key is not matched (String())';
  // the same person under a scrambled standings name keeps his style (Adolfo Daniel Vallejo = "Daniel Vallejo Adolfo")
  L.load(FIX_STYLES.players.concat([{ name: 'Adolfo Daniel Vallejo', archetype_label: 'Solid Baseliner' }]));
  if ((L.ppStyleFor('Adolfo Daniel Vallejo', '777') || {}).archetype_label !== 'Solid Baseliner') return 'a scrambled standings name dropped the player\'s own style';
  L.load(FIX_STYLES.players.concat([{ name: 'Ulises Blanch', archetype_label: null }, DALI]));
  // standings not loaded yet (or failed): the profile name stands in; a reassigned standings array is re-read
  L.setIndex([]); L.setProfiles({ 17463: { name: 'Dar. Blanch' } });
  if (L.ppStyleFor('D. Blanch', 17463)) return 'before the standings load, an initial-only name on Darwin\'s key took Dali\'s style';
  L.setProfiles({}); L.setIndex([{ key: '17463', name: 'Darwin Blanch' }]);
  if (L.ppStyleFor('D. Blanch', '17463')) return 'a reassigned standings array was not re-read';
  L.setIndex([{ key: '2072', name: 'Jannik Sinner', rank: 1 }]);
  if ((L.ppStyleFor('D. Blanch', '17463') || {}).archetype_label !== 'Big Server + First Strike') return 'the key cache kept a stale standings array';
  L.setIndex([{ key: '17463', name: 'Darwin Blanch', rank: 159 }, { key: '2072', name: 'Jannik Sinner', rank: 1 }]);
  if ((L.ppStyleFor('J. Sinner', '2072') || {}).archetype_label !== 'All Court Elite' || L.pgArchetypeFor('J. Sinner', '2072') !== 'All Court Elite') return 'a key with no clash lost its style';
  if ((L.ppStyleFor('Dali Blanch') || {}).archetype_label !== 'Big Server + First Strike' || L.pgArchetypeFor('Dali Blanch') !== 'Big Server + First Strike') return 'Dali Blanch lost his own style';
  if ((L.ppStyleFor('J. Sinner') || {}).archetype_label !== 'All Court Elite' || (L.ppStyleFor('Jannik Sinner') || {}).archetype_label !== 'All Court Elite') return 'an initial or full first name no longer joins';
  if ((L.ppStyleFor('T. Martin Etcheverry') || {}).archetype_label !== 'Solid Baseliner') return 'a profile spelling no longer joins';
  return null;
}
test('one style per player: the Blanch pair on Match analysis / Head to Head (ppStyleFor), the Players page and this page', () => {
  assert.equal(checkOneStyle(HTML), null);
  assert.ok(checkOneStyle(mut('const ok = all.filter(p => !psGivenClash(p.name, name) && !psKeyNameClash(p.name, full));', 'const ok = all;')), 'mutant: ppStyleFor without the guard');
  assert.ok(checkOneStyle(mut('const p = rows.find(r => !psGivenClash(r.name, name) && !psKeyNameClash(r.name, full));', 'const p = rows[0];')), 'mutant: Players page without the guard');
  assert.ok(checkOneStyle(mut('!x.startsWith(y) && !y.startsWith(x)', 'x !== y')), 'mutant: an abbreviation ("Dar.") read as a different name… or not');
  assert.ok(checkOneStyle(mut('const ok = all.filter(p => !psGivenClash(p.name, name) && !psKeyNameClash(p.name, full));', 'const ok = all.filter(p => !psGivenClash(p.name, name));')), 'mutant: ppStyleFor ignores the key');
  assert.ok(checkOneStyle(mut('const p = rows.find(r => !psGivenClash(r.name, name) && !psKeyNameClash(r.name, full));', 'const p = rows.find(r => !psGivenClash(r.name, name));')), 'mutant: Players page ignores the key');
  assert.ok(checkOneStyle(mut('return psIndexNameOf._m.get(String(key)) ||', 'return psIndexNameOf._m.get(key) ||')), 'mutant: numeric keys miss');
  assert.ok(checkOneStyle(mut('if (psIndexNameOf._src !== idx){', 'if (!psIndexNameOf._m){')), 'mutant: the cache never re-reads the standings');
  assert.ok(checkOneStyle(mut("|| (prof && prof.name) || null;", '|| null;')), 'mutant: no profile-name stand-in before the standings load');
  assert.ok(checkOneStyle(mut('.some(t => g.startsWith(t) || t.startsWith(g));', '.slice(0, 1).some(t => g.startsWith(t) || t.startsWith(g));')), 'mutant: the key name compared on its first word only (scrambled names)');
  // every caller that holds a key passes it
  for (const c of ['ppStyleFor(other, idx ? m.p1Key : m.p2Key)', 'ppStyleFor(name, side ? m.p2Key : m.p1Key), opp = ppStyleFor(other, side ? m.p1Key : m.p2Key)',
    'ppStyleFor(m.p1, m.p1Key), s2 = ppStyleFor(m.p2, m.p2Key)', 'ppStyleFor(p && p.name, p && p.key)', 'ppStyleFor(p.name, p.key)', 'styleOf(r.opp, r.oppKey)',
    'styleOf(opp, k ? m.p1Key : m.p2Key)', 'ppStyleFor(p.full, p.key)', 'pgArchetypeFor(p.name, p.key)'])
    assert.ok(HTML.includes(c), 'a caller lost its key: ' + c);
  assert.equal((HTML.match(/ppStyleFor\((?![^)]*[Kk]ey)[^)]*\)/g) || []).filter(x => !/ppStyleFor\(name, key\)/.test(x)).length, 0, 'a ppStyleFor call without the key');
  // this page: Darwin is not counted (checkCounts asserts it on the real fixtures) and the note carries the residual sentence
  const M = model(P, REAL());
  // Founder answer 3 (TEN-408): the residual-bucket sentence only if the classifier still drops misfits into Solid
  // Baseliner. It does not (every label is a hand-finalized board label), so the sentence is NOT printed.
  assert.ok(!/residual bucket/.test(M.note), 'the residual-bucket sentence is printed: ' + M.note);
  assert.ok(M.note.endsWith('left out of every strongest / weakest pick.'), 'the note does not end on the small-sample sentence: ' + M.note);
  assert.ok(!/ — /.test(M.note), 'an em dash between sentences');
});

// ── Round 3 (founder comment dc31ce3b): fixes 1, 2, 3, 4, 5, 8 and the board-label guard ─────────────────────────────
function checkRound3(html) {
  const p = page(html);
  // fix 8: a rounded tie breaks on the unrounded edge (w / n), then the larger n
  const g = grid();
  const L = P.PS_ARCHETYPES.map(a => a.ids[0]), m = g.matrix.matrix;
  const set = (a, b, pct, n, w) => { m[L[a]][L[b]] = { pct, n, w }; m[L[b]][L[a]] = { pct: 100 - pct, n, w: n - w }; };
  set(7, 1, 88, 147, 130); set(7, 4, 88, 142, 125); set(7, 2, 77, 183, 141); set(7, 3, 84, 338, 284); set(7, 5, 91, 230, 209); set(7, 6, 80, 200, 160); set(7, 0, 85, 100, 85);
  const pl = PLAYERS({ 'Big Server': 12, 'Big Server + First Strike': 12, 'Big Server + Complete Baseliner': 12, 'Attacking Baseliner': 12,
    'Solid Baseliner': 12, 'Counterpuncher': 12, 'Solid Defender': 12, 'All Court Elite': 3 });
  const M = model(p, { ...g, ...pl, elo: null });
  const ace = M.arch[7];
  if (ace.vs.indexOf(1) > ace.vs.indexOf(4)) return 'fix 8: +38 (130/147) does not rank before +38 (125/142)';
  set(7, 1, 88, 100, 89); set(7, 4, 88, 200, 176);   // rounded tie; the unrounded edge (39 v 38) wins over the larger n
  const M1 = model(p, { ...g, ...pl, elo: null });
  if (M1.arch[7].vs.indexOf(1) > M1.arch[7].vs.indexOf(4)) return 'fix 8: the larger n beat a higher unrounded edge (rounded sort)';
  set(7, 1, 88, 100, 88); set(7, 4, 88, 200, 176);   // the same unrounded rate: the larger n wins
  const M2 = model(p, { ...g, ...pl, elo: null });
  if (M2.arch[7].vs.indexOf(4) > M2.arch[7].vs.indexOf(1)) return 'fix 8: an exact tie does not go to the larger match count';
  // the weakest picks: lowest edge first, an exact tie to the larger n (row 3 = Attacking Baseliner, 12 players)
  set(3, 5, 40, 100, 40); set(3, 6, 40, 300, 120); set(3, 0, 70, 100, 70); set(3, 1, 65, 100, 65); set(3, 2, 60, 100, 60);
  const M4 = model(p, { ...g, ...pl, elo: null });
  if (M4.arch[3].picks[2] !== 6 || M4.arch[3].picks[3] !== 5) return 'fix 8: weakest picks ' + JSON.stringify(M4.arch[3].picks) + ' (want the n=300 tie first)';
  // 3 players each (two small styles, the same count)
  const pl3 = PLAYERS({ 'Big Server': 3, 'Big Server + First Strike': 12, 'Big Server + Complete Baseliner': 12, 'Attacking Baseliner': 12,
    'Solid Baseliner': 12, 'Counterpuncher': 12, 'Solid Defender': 12, 'All Court Elite': 3 });
  if (!/Big Server and All Court Elite \(3 players each\) are below the 10-player threshold\. Their edges are indicative only and left out of every strongest \/ weakest pick\./.test(model(p, { ...g, ...pl3, elo: null }).note)) return 'fix 6: the "(3 players each)" form';
  // fix 5: the small-sample line in the open card; fix 2: the Vs list ±2 band
  const small = grid({ 'Attacking Baseliner|Solid Defender': { pct: 52, n: 300 }, 'Attacking Baseliner|Counterpuncher': { pct: 48, n: 300 } });
  const M3 = model(p, { ...small, ...pl, elo: null });
  p.psRenderPage(M3);
  const cards = p.els.psCards.innerHTML;
  if (!/<span class="ps-smallline">3 players, below the 10-player threshold\. Edges are indicative only\.<\/span>/.test(cards)) return 'fix 5: no small-sample line in the open card';
  if ((cards.match(/ps-smallline/g) || []).length !== 1) return 'fix 5: the small-sample line on a 10+ player style';
  const row = (who) => (new RegExp('<span class="ps-vsname">' + who + '</span><span class="ps-vswr">[^<]*</span><span class="ps-vsedge ps-edge-(\\w)">').exec(cards.slice(cards.indexOf('id="psArow3"'))) || [])[1];
  if (row('Solid Defender') !== 'n' || row('Counterpuncher') !== 'n') return 'fix 2: a ±2 Vs-list edge is not grey';
  // fix 1, 3: CSS
  const css = between(html, '/* ---------- PLAYING STYLES (TEN-408', '</style>');
  if (!/grid-template-columns:212px repeat\(var\(--ps-n,8\),minmax\(0,1fr\)\)/.test(css)) return 'fix 1: the row label column is not 212px';
  if (/\.ps-gcol-name\{[^}]*nowrap/.test(css)) return 'fix 1: a column-head name cannot wrap';
  if (!/\.ps-bar\{ display:grid; grid-template-columns:190px 84px 44px;/.test(css) || !/\.ps-arow-head\{[^}]*338px 16px/.test(css)) return 'fix 1: the tug-bar name column is not 190px';
  if (!/\.ps-lit\.ps-x\{ background:var\(--selected\); box-shadow:inset 0 0 0 1px var\(--edge-10\);/.test(css)) return 'fix 3: the crossed cell is not selected tone + 10% edge';
  // fix 4: the reference's full sentence
  if (!html.includes('<p class="sfh__sub">Row beats column: the figure is the edge vs an even 50% split, the raw win rate sits beneath. Hover to isolate a row and column.</p>')) return 'fix 4: header sentence';
  return null;
}
test('round 3: tie rule (unrounded, then n), small-sample line, Vs ±2 band, no-truncation widths, crossed cell, header sentence', () => {
  assert.equal(checkRound3(HTML), null);
  assert.ok(checkRound3(mut('const best = (x, y) => (C(y).exact - C(x).exact) || (C(y).n - C(x).n);', 'const best = (x, y) => (C(y).edge - C(x).edge);')), 'mutant: rounded sort');
  assert.ok(checkRound3(mut('const best = (x, y) => (C(y).exact - C(x).exact) || (C(y).n - C(x).n);', 'const best = (x, y) => (C(y).exact - C(x).exact);')), 'mutant: no n tiebreak');
  assert.ok(checkRound3(mut("(a.small ? '<span class=\"ps-smallline\">'", "(false ? '<span class=\"ps-smallline\">'")), 'mutant: no small-sample line');
  assert.ok(checkRound3(mut("'<span class=\"ps-vsedge ps-edge-' + (x.edge == null ? 'd' : psBand(x.edge))", "'<span class=\"ps-vsedge ps-edge-' + (x.edge == null ? 'd' : (x.edge > 0 ? 'g' : x.edge < 0 ? 'r' : 'n'))")), 'mutant: Vs list without the band');
  assert.ok(checkRound3(mut('grid-template-columns:212px repeat', 'grid-template-columns:176px repeat')), 'mutant: narrow label column');
  assert.ok(checkRound3(mut('top2.concat(pickable.slice().sort(worst).filter(b => !top2.includes(b)).slice(0, 2))', 'top2.concat(pickable.slice(-2).reverse())')), 'mutant: weakest picks read off the best order');
  // (dropping the n tiebreak from `worst` is an equivalent mutant: Array#sort is stable and `pickable` is already in the
  // best order, where ties sit larger-n first — so it is not asserted.)
  assert.ok(checkRound3(mut("(same ? join + ' (' + pl(small[0].count) + ' each)'", "(false ? join + ' (' + pl(small[0].count) + ' each)'")), 'mutant: no "each" form');
});

// ── The board labels: tools/apply-board-archetypes.js never puts one player's hand label on another (Darwin → Dali) ──
function runApply(src) {
  const dir = mkdtempSync(join(tmpdir(), 'ten408-apply-'));
  try {
    mkdirSync(join(dir, 'tools'));
    writeFileSync(join(dir, 'tools/apply-board-archetypes.js'), src);
    writeFileSync(join(dir, 'tools/board-archetypes.json'), JSON.stringify({ players: [
      { name: 'Dar. Blanch', label: 'Big Server + First Strike' }, { name: 'D.Medvedev', label: 'Solid Defender' },
      { name: 'J-L. Struff', label: 'Big Server' }, { name: 'U. Blanchet', label: 'Attacking Baseliner' }] }));
    writeFileSync(join(dir, 'playing-styles.json'), JSON.stringify({ players: [{ name: 'Dali Blanch' }, { name: 'Ulises Blanch' },
      { name: 'Daniil Medvedev' }, { name: 'Jan-Lennard Struff' }, { name: 'U. Blanchet' }] }));
    const r = spawnSync(process.execPath, [join(dir, 'tools/apply-board-archetypes.js')], { encoding: 'utf8' });
    if (r.status !== 0) return 'apply failed: ' + r.stderr.slice(0, 200);
    return Object.fromEntries(JSON.parse(readFileSync(join(dir, 'playing-styles.json'), 'utf8')).players.map(p => [p.name, p.archetype_label || null]));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function checkApply(src) {
  const L = runApply(src);
  if (typeof L === 'string') return L;
  if (L['Dali Blanch'] !== null) return 'Darwin\'s board label ("Dar. Blanch") landed on Dali Blanch';
  if (L['Ulises Blanch'] !== null) return 'a board label landed on Ulises Blanch';
  if (L['Daniil Medvedev'] !== 'Solid Defender' || L['Jan-Lennard Struff'] !== 'Big Server' || L['U. Blanchet'] !== 'Attacking Baseliner') return 'the guard dropped a real match: ' + JSON.stringify(L);
  return null;
}
test('board labels: a given-name clash is another player (Dar. ≠ Dali); initials and "J-L." still match', () => {
  const APPLY = readFileSync(join(HERE, 'tools/apply-board-archetypes.js'), 'utf8');
  assert.equal(checkApply(APPLY), null);
  const a = "const same = list => (list || []).filter(p => !givenClash(name, p.name));   // TEN-408 given-name guard";
  assert.ok(APPLY.includes(a), 'apply mutant anchor missing');
  assert.ok(checkApply(APPLY.replace(a, 'const same = list => (list || []);')), 'mutant: apply without the guard');
  // the committed store follows: no labelled "Dali Blanch"
  const st = JSON.parse(readFileSync(join(HERE, 'playing-styles.json'), 'utf8')).players.find(p => p.name === 'Dali Blanch');
  assert.ok(!st || !st.archetype_label, 'playing-styles.json still labels Dali Blanch');
});

// ── Founder R2 (card 78054b1c): the note says styles are current labels; the H2H page keeps "Dar. Blanch" as one name ──
function checkR2(html) {
  const M = model(page(html), { ...grid(), styles: { players: [] }, index: null, elo: null });
  if (!M.note.includes('2000 – 8 Oct 2026. Styles are each player\'s current label.')) return 'note: no en-dash range / current-label sentence: ' + M.note;
  const shortOf = new Function(slice(html, 'shortOf') + '\nreturn shortOf;')();
  const C = [['Dar. Blanch', 'Dar. Blanch'], ['J-L. Struff', 'J-L. Struff'], ['C. Alcaraz', 'C. Alcaraz'], ['Carlos Alcaraz', 'C. Alcaraz'], ['Daniel Merida Aguilar', 'D. Merida Aguilar']];
  for (const [i, o] of C) if (shortOf(i) !== o) return `shortOf(${i}) = ${shortOf(i)}, want ${o}`;
  return null;
}
test('founder R2: "Styles are each player\'s current label." after the en-dash range; H2H short name keeps "Dar." (one name)', () => {
  assert.equal(checkR2(HTML), null);
  assert.ok(checkR2(mut("if (/^[A-Z][A-Za-z-]*[.．]$/.test(p[0])) return s;", "if (/^[A-Z][.．]$/.test(p[0])) return s;")), 'mutant: shortOf re-cuts "Dar."');
  assert.ok(checkR2(mut(". Styles are each player\\'s current label. Laver Cup", ". Laver Cup")), 'mutant: no current-label sentence');
});
