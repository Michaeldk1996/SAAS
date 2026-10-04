// TEN-339 — every check in test-ten339-progression.mjs must FAIL when the behaviour it locks is reverted. Each mutant is
// applied to a copy of bsp-consult-dashboard.html and the suite is run against it (TEN339_HTML); a mutant that leaves
// the suite green is a vacuous test and fails this runner. Anchors must occur exactly once in the page.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
  ['review F5: the Facing row ignores the highlight', "seg(fhEsc(l + ' · ' + opp(P.roads[0].cells[j]) + ' / ' + opp(P.roads[1].cells[j])), hi === j,", "seg(fhEsc(l + ' · ' + opp(P.roads[0].cells[j]) + ' / ' + opp(P.roads[1].cells[j])), false,"],
  ['Serve rating: the Tournament Report 4-term (no aces / double faults)', "    serveRating: { v: hr.serve.v, why: hr.serve.missing },",
    "    serveRating: { v: hr.serve.v == null ? null : hr.serve.v - (Number(A['Service:Aces']) || 0) + (Number(A['Service:Double Faults']) || 0), why: hr.serve.missing },"],
  ['road: the analysed match itself on the road', "    if (ek && x.eventKey != null ? String(x.eventKey) === ek : (maSameOpp(x.opponent, oppName) && Math.abs(d - ref) <= 1)) return;\n", ''],
  ['this match: dropped by surname even when both carry an event key', "    if (ek && x.eventKey != null ? String(x.eventKey) === ek : (maSameOpp(x.opponent, oppName) && Math.abs(d - ref) <= 1)) return;",
    "    if ((ek && x.eventKey != null && String(x.eventKey) === ek) || maSameOpp(x.opponent, oppName)) return;"],
  ['failed load: a history that failed to load reads as an empty one (a made-up bye)', "loaded: Array.isArray(hist) && k != null && k in _careerHistoryShards };", "loaded: Array.isArray(hist) };"],
  ['Slam: numbered from the first round a history shows (a 128 draw read as 32)', "FH_SLAMS.has(psNormTour(tourn)) ? 0 : PG_ATP_FIRST", "PG_ATP_FIRST"],
  ['road: qualifying rows on the road (N7)', "    if (x.qualifying || /^qualif/i.test(String(x.round || ''))) return;                  // N7: main draw only\n", ''],
  ['set scores: the feed order (not player-oriented)', "  const scoreOf = r => (r.wo ? 'w/o' : r.sets ? r.sets.map(x => x[0] + '-' + x[1]).join(' ')",
    "  const scoreOf = r => (r.wo ? 'w/o' : r.sets ? r.sets.map(x => x[1] + '-' + x[0]).join(' ')"],
  ['DRAW avg: an event off the board still gets a draw row', "  if (!t) return null;\n  const players = t.players || [];", "  const players = (t && t.players) || [];"],
  ['DRAW avg: winners only, not both players of every match', "      if (x.round !== L) return;", "      if (x.round !== L || P.eliminated) return;"],
  ['Q7: the DRAW avg of Pressure points computed again (50.0%)', "out[mt.key] = mt.noDraw ? null : {", "out[mt.key] = {"],
  ['gate: a rate on n 1–4 printed as a %', "  if (g === 'nopct') return { t: x.won + '/' + x.total, count: ' (' + x.won + '/' + x.total + ')' };\n", ''],
  ['AVG: the mean of the round rates, not the summed counts', "return { v: won / total * 100, won, total, n: got.length }; }",
    "return { v: sum(x => x.v) / got.length, won, total, n: got.length }; }"],
  ['R1: the tab hidden in the first round again', "  // TEN-339: the Progression tab is always listed — the design draws its first-round state (DF L681, \"No progression yet\").\n",
    "  const progNav = document.querySelector('#aTabs .asidenav-item[data-atab=\"progression\"]');\n  if (progNav) progNav.style.display = progressionRoundState(m).state === 'hidden' ? 'none' : '';\n"],
  ['bye: any missing round called a bye', "      const bye = j === 0 && s.loaded && byeOk", "      const bye = s.loaded && byeOk"],
  ['N2: a walkover counted in the W–L and sets', "    const real = cells.filter(c => c.r && !c.r.wo);", "    const real = cells.filter(c => c.r);"],
  ['DoD 8: a road cell stops opening the shared sheet', "fhSrcTitle(r) : '')), click: c.click });", "fhSrcTitle(r) : '')), click: '' });"],
  ['DoD 8: a tab-local tooltip renderer', "function pgState(m){", "function pgTipHtml(){ return ''; }\nfunction pgState(m){"],
  ['DoD 8: a non-design hover text back on a native title', "      return `<span data-aotip=\"${fhEsc(tip)}\" style=\"text-align:center;", "      return `<span title=\"${fhEsc(tip)}\" style=\"text-align:center;"],
  ['seeded numbers back in the unplayed-round placeholder', "<span>— v —</span><span>DR —</span>", "<span>1.60 v 2.35</span><span>DR 1.20</span>"],
];
MUTANTS.push(
  ['Q7: a future round on the Facing track', "${played}${seg(fhEsc(P.facing), hi == null, P.facing + ' · this match', hi == null ? null : 'pgHi(' + hi + ')')}</div>", "${played}${seg(fhEsc(P.facing), hi == null, P.facing + ' · this match', hi == null ? null : 'pgHi(' + hi + ')')}${(P.future || []).map(l => seg(l, false, '', null)).join('')}</div>"],
  ['Q7: the current round not selected', "${seg(fhEsc(P.facing), hi == null, P.facing", "${seg(fhEsc(P.facing), false, P.facing"],
  ['Q7: a bye written from inference', "  const opp = c => (c.r ? fhSurname(c.r.opp) || c.r.opp : FH_DASHC);", "  const opp = c => (c.r ? fhSurname(c.r.opp) || c.r.opp : c.bye ? 'Bye' : FH_DASHC);"],
  ['Q7: no Facing row on a first-round match', "${pgFacingHtml(P, null)}${head}", "${head}"],
);
const SUITES = ['test-ten339-progression.mjs'];
// Control: the unmutated page must pass, or every "caught" below means nothing.
{ const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('✖ the suite is red on the unmutated page — mutants are meaningless'); process.exit(1); }
  console.log('✔ control: the unmutated page passes'); }
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten339-mut-'));
for (const [name, from, to] of MUTANTS) {
  if (html.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, html.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, { TEN339_HTML: file }), encoding: 'utf8' });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
