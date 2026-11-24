// TEN-339 — every check in test-ten339-progression.mjs must FAIL when the behaviour it locks is reverted. Each mutant is
// applied to a copy of bsp-consult-dashboard.html and the suite is run against it (TEN339_HTML); a mutant that leaves
// the suite green is a vacuous test and fails this runner. Anchors must occur exactly once in the page.
// Match analysis rebuild (2026-11-23): the renderer is maProgressionV2 in match-analysis-v2.js; a mutant tagged 'ma2' is
// applied to a copy of that file (TEN339_MA2), a mutant given as a list of [file, from, to] edits to both.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const ma2 = fs.readFileSync(path.join(ROOT, 'match-analysis-v2.js'), 'utf8');
const MUTANTS = [
  ['review F5: the Facing row ignores the highlight', "opp(P.roads[1].cells[j]), on: hi === j,", "opp(P.roads[1].cells[j]), on: false,", 'ma2'],
  ['Serve rating: the Tournament Report 4-term (no aces / double faults)', "    serveRating: { v: hr.serve.v, why: hr.serve.missing },",
    "    serveRating: { v: hr.serve.v == null ? null : hr.serve.v - (Number(A['Service:Aces']) || 0) + (Number(A['Service:Double Faults']) || 0), why: hr.serve.missing },"],
  ['road: the analysed match itself on the road', "    if (ek && x.eventKey != null ? String(x.eventKey) === ek : (maSameOpp(x.opponent, oppName) && Math.abs(d - ref) <= 1)) return;\n", ''],
  ['this match: dropped by surname even when both carry an event key', "    if (ek && x.eventKey != null ? String(x.eventKey) === ek : (maSameOpp(x.opponent, oppName) && Math.abs(d - ref) <= 1)) return;",
    "    if ((ek && x.eventKey != null && String(x.eventKey) === ek) || maSameOpp(x.opponent, oppName)) return;"],
  ['failed load: a history that failed to load reads as an empty one (a made-up bye)', "loaded: Array.isArray(hist) && k != null && k in _careerHistoryShards };", "loaded: Array.isArray(hist) };"],
  ['Slam: numbered from the first round a history shows (a 128 draw read as 32)', "FH_SLAMS.has(psNormTour(tourn)) ? 0 : PG_ATP_FIRST", "PG_ATP_FIRST"],
  ['road: qualifying rows on the road (N7)', "    if (x.qualifying || /^qualif/i.test(String(x.round || ''))) return;                  // N7: main draw only\n", ''],
  ['set scores: the feed order (not player-oriented)', "r.sets ? r.sets.map(x => x[0] + '-' + x[1]).join(', ')", "r.sets ? r.sets.map(x => x[1] + '-' + x[0]).join(', ')", 'ma2'],
  ['DRAW avg: an event off the board still gets a draw row', "  if (!t) return null;\n  const players = t.players || [];", "  const players = (t && t.players) || [];"],
  ['DRAW avg: winners only, not both players of every match', "      if (x.round !== L) return;", "      if (x.round !== L || P.eliminated) return;"],
  ['Q7: the DRAW avg of Pressure points computed again (50.0%)', [['html', "out[mt.key] = mt.noDraw ? null : {", "out[mt.key] = {"],
    ['ma2', "const f = mt.noDraw ? { t: DASH } : pgDrawFig(d, mt);", "const f = pgDrawFig(d, mt);"],
    ['ma2', "const fa = mt.noDraw || !x.fAvg ? { t: DASH } : pgDrawFig(x.fAvg, mt);", "const fa = !x.fAvg ? { t: DASH } : pgDrawFig(x.fAvg, mt);"]]],
  ['gate: a rate on n 1–4 printed as a %', "  if (g === 'nopct') return { t: x.won + '/' + x.total, count: ' (' + x.won + '/' + x.total + ')' };\n", ''],
  ['AVG: the mean of the round rates, not the summed counts', "return { v: won / total * 100, won, total, n: got.length }; }",
    "return { v: sum(x => x.v) / got.length, won, total, n: got.length }; }"],
  ['R1: the tab hidden in the first round again', "  // TEN-339: the Progression tab is always listed — the design draws its first-round state (DF L681, \"No progression yet\").\n",
    "  const progNav = document.querySelector('#aTabs .asidenav-item[data-atab=\"progression\"]');\n  if (progNav) progNav.style.display = progressionRoundState(m).state === 'hidden' ? 'none' : '';\n"],
  ['bye: any missing round called a bye', "      const bye = !rr && j === 0 && s.loaded && byeOk", "      const bye = !rr && s.loaded && byeOk"],
  ['round robin: group rows dropped (the pre-2026-11-24 tab)', "    if (rr) ri = ri === 5 ? 3", "    if (false) ri = ri === 5 ? 3"],
  ['round robin: the event match needs the exact feed name', "  if (n(a) === n(b)) return true;", "  if (psNormTour(a) === psNormTour(b)) return true;"],
  ['N2: a walkover counted in the W–L and sets', "    const real = cells.filter(c => c.r && !c.r.wo);", "    const real = cells.filter(c => c.r);"],
  ['DoD 8: a road cell stops opening the shared sheet', "'<div class=\"seg ma2-row\"' + click + ' title=", "'<div class=\"seg ma2-row\"' + ' onclick=\"\"' + ' title=", 'ma2'],
  ['DoD 8: a tab-local tooltip renderer', "function pgState(m){", "function pgTipHtml(){ return ''; }\nfunction pgState(m){"],
  // dropped with the 2026-11-23 design: 'a non-design hover back on a native title' (the design's hovers are native titles,
  // STEP1 #8) and 'seeded numbers in the unplayed-round placeholder' (the design draws no unplayed round)
];
MUTANTS.push(
  ['gate: the small-sample footnote dropped', "Grey = small sample (5–9): hover a figure for its count.", "", 'ma2'],
  ['Q7: a future round on the Facing track', ".concat([{ label: P.facing, on: hi == null,", ".concat(['SF', 'F'].map(l => ({ label: l, on: false, onclick: '' }))).concat([{ label: P.facing, on: hi == null,", 'ma2'],
  ['Q7: the current round not selected', "{ label: P.facing, on: hi == null,", "{ label: P.facing, on: false,", 'ma2'],
  ['Q7: a bye written from inference', "const opp = c => (c.r ? fhSurname(c.r.opp) || c.r.opp : DASH);", "const opp = c => (c.r ? fhSurname(c.r.opp) || c.r.opp : c.bye ? 'Bye' : DASH);", 'ma2'],
  ['Q7: no Facing row on a first-round match', "if (P.isEmpty) return wrap(pgFacing(P, null) + ", "if (P.isEmpty) return wrap(", 'ma2'],
);
const SUITES = ['test-ten339-progression.mjs'];
// Control: the unmutated page must pass, or every "caught" below means nothing.
{ const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('✖ the suite is red on the unmutated page — mutants are meaningless'); process.exit(1); }
  console.log('✔ control: the unmutated page passes'); }
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten339-mut-'));
for (const [name, a, b, f] of MUTANTS) {
  const edits = Array.isArray(a) ? a : [[f || 'html', a, b]];
  const src = { html, ma2 };
  if (edits.some(([k, from]) => src[k].split(from).length !== 2)) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  for (const [k, from, to] of edits) src[k] = src[k].replace(from, to);
  const file = path.join(dir, 'm.html'), mfile = path.join(dir, 'm.js');
  fs.writeFileSync(file, src.html); fs.writeFileSync(mfile, src.ma2);
  const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, { TEN339_HTML: file, TEN339_MA2: mfile }), encoding: 'utf8' });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
