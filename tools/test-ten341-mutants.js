// TEN-341 / TEN-380 / the 2026-11-23 rebuild — every check in test-ten341-key-factors.mjs (and the Key factors checks it shares
// with test-ten314-modal-frame.mjs) must FAIL when the behaviour it locks is reverted. Each mutant is applied to a copy of its
// file — bsp-consult-dashboard.html (the data models, TEN341_HTML / TEN314_HTML) or match-analysis-v2.js (the boxes,
// TEN341_MA2) — and its suite is run against it; a mutant that leaves the suite green is a vacuous test and fails this runner.
// Anchors must occur exactly once in their file.
//   · The "RENDERER GAP:" tests of test-ten341-key-factors.mjs check rules the rebuilt boxes break today; they are red on the
//     unmutated code, so the mutant runs skip them (out loud). The suite command itself still reports them.
//   · A suite that is red on the unmutated code makes its mutants meaningless: they are SKIPPED out loud, never counted caught.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PAGE = 'bsp-consult-dashboard.html', MA2 = 'match-analysis-v2.js';
const KF = 'test-ten341-key-factors.mjs', FRAME = 'test-ten314-modal-frame.mjs';
const GAP = 'RENDERER GAP:';
// [name, file, from, to, suite]
const MUTANTS = [
  ['review F1: the Market edge prefetch loads a match the modal left', PAGE, "    .then(() => { if (_aM === m) meLoad(m);", "    .then(() => { meLoad(m);"],
  // Playing style (record vs the opponent's style)
  ['style: the tug drawn on the losses side', MA2, 'const tw = shown && R.w > R.l ? (R.w - R.l) / n * 50 : 0, tl = shown && R.l > R.w ? (R.l - R.w) / n * 50 : 0;', 'const tl = shown && R.w > R.l ? (R.w - R.l) / n * 50 : 0, tw = shown && R.l > R.w ? (R.l - R.w) / n * 50 : 0;'],
  ['style: the oldest meetings shown as "last 3"', MA2, ".sort((x, y) => String(y.date || '').localeCompare(String(x.date || ''))).slice(0, 3)", ".sort((x, y) => String(x.date || '').localeCompare(String(y.date || ''))).slice(0, 3)"],
  ['D2: a record-vs-style % printed at n = 2', MA2, "(shown ? Math.round(R.w / n * 100) + '%' : DASH)", "(n ? Math.round(R.w / n * 100) + '%' : DASH)"],
  ['N2: a walkover counted in the record vs style', PAGE, 'const rows = raw.filter(r => !ps2IsWalkover(r));', 'const rows = raw;'],
  // Recent form
  ['N2: the bars read the raw rows (a walkover and the match itself become bars)', MA2, 'const bars = P.win.slice().reverse().map(', 'const bars = (((m._fhFormRows || [])[i]) || []).slice(0, 10).reverse().map('],
  ['Q16: the box counts all surfaces', MA2, "{ surf: surf || 'all', role: 'all', wmode: 'n', n: 10 }", "{ surf: 'all', role: 'all', wmode: 'n', n: 10 }"],
  ['Q13: the scope loses the surface', MA2, "scope = 'Last 10' + (surf ? ' · ' + esc(surf.toLowerCase()) : '')", "scope = 'Last 10'"],
  ['form: against market not coloured by its sign', MA2, "mc(d == null ? 'var(--ma2-quiet)' : meUc(d, 1))", "mc('var(--ma2-text)')"],
  ['form: every scored hot line (no best-per-family pick)', MA2, 'hot = FH_HOT_FAM.map(f => P.hot.sc.scored.find(x => fhFamOf(x.L.g) === f[0])).filter(Boolean).map(x => {', 'hot = P.hot.sc.scored.map(x => {'],
  // Tournament
  ['Q25: "no record on file" back', MA2, "(hist[i] ? 'no main-draw match' : 'first appearance')", "(hist[i] ? 'no main-draw match' : 'no record on file')"],
  ['tier: a fabricated tier for an unknown event', MA2, "const tier = (m.venue && m.venue.category) || (catHit && catHit.category) || '',", "const tier = (m.venue && m.venue.category) || (catHit && catHit.category) || 'ATP 250',"],
  ['tier: printed twice when it equals the name ("ATP Finals · ATP Finals")', MA2, "tier && tier.toLowerCase() !== tn.toLowerCase() ? tn + ' · ' + tier : tn", "tier ? tn + ' · ' + tier : tn"],
  ['Q14: the knob placed on the abstract speed', MA2, 'idx = cs && cs.idx != null && isFinite(cs.idx) ? Math.max(0, Math.min(100, cs.idx)) : null', 'idx = cs && cs.v != null ? Math.max(0, Math.min(100, cs.v * 50)) : null'],
  ['D2: the market rows ungated', MA2, "ok = !!mk && (g === 'full' || g === 'small')", 'ok = !!mk'],
  ['a return coloured by its gap to the tour, not its sign', MA2, "sc = has ? meUc(v, 1) : 'var(--ma2-quiet)'", "sc = has ? meUc(d, 1) : 'var(--ma2-quiet)'"],
  ['Q9: Key factors prints the court-conditions sheet\'s count-less %', MA2, "'hold ' + trHoldHtml(m, 'kf-hold')", "'hold ' + (m.courtSpeed && m.courtSpeed.serviceHold != null ? m.courtSpeed.serviceHold + '%' : DASH)"],
  ['Q9: the tooltip loses n', PAGE, "(n = ${fmt(H.n)}), both players,", "both players,"],
  ['Q9: the hold rate gated like a sample rate', PAGE, "const val = H.state === 'ok' ? Math.round(H.pct) + '%' : FH_DASHC;", "const val = H.state === 'ok' && H.matches >= 100 ? Math.round(H.pct) + '%' : FH_DASHC;"],
  ['escaping: the tournament scope unescaped', MA2, 'const tn = trName(m), scope = esc(', 'const tn = trName(m), scope = ('],
  // Odds
  ['Q17: the book preference dropped (the Odds tab\'s first live row wins)', PAGE, 'const pick = KF_BOOK_PREF.map(re => live.find(r => re.test(r.name))).find(Boolean) || live[0] || null;', 'const pick = live[0] || null;'],
  ['odds: a gapped book drawn across the gap', MA2, "if (P.length < 2 || (row.gaps && row.gaps.length)) return '<span></span>';", "if (P.length < 2) return '<span></span>';"],
  ['odds: the now from bestOdds (a second book)', MA2, "n = row && row[x + 'Now'] != null ? aOddsFmt(row[x + 'Now']) : DASH;", "n = m.bestOdds && m.bestOdds[i ? 'p2' : 'p1'] ? aOddsFmt(m.bestOdds[i ? 'p2' : 'p1'].price) : DASH;"],
  ['odds: Fair from two unmatched latest quotes', MA2, 'const fairOf = x => row && row.nv && row.nv[x] && row.nv[x].length ? aOddsFmt(row.nv[x][row.nv[x].length - 1][1]) : DASH;', "const fairOf = x => row && row[x + 'Now'] != null ? aOddsFmt(row[x + 'Now'] * (1 / row.aNow + 1 / row.bNow)) : DASH;"],
  ['odds: an all-stale market reads "no prices in the feed"', MA2, "kfNote(X.D.hasSeries ? 'No recent prices:", "kfNote(false ? 'No recent prices:"],
  ['Q12: a "Soft avg" back', MA2, "hd('Now') + hd('Fair')", "hd('Now') + hd('Soft avg') + hd('Fair')"],
  // DNA (N10)
  ['N10: the MCP radar fetched again', PAGE, 'kfEnsureNews(m), kfEnsureMarketEdge(m)]', "kfEnsureNews(m), kfEnsureMarketEdge(m), fetch('./style-radar.json')]"],
  ['DNA: the raw rating printed instead of the percentile', MA2, 'const pc = v => (v.pct == null ? null : Math.max(0, Math.min(100, v.pct)));', 'const pc = v => (v.raw == null ? null : v.raw);'],
  ['DNA: an axis drawn under the 10-match floor', PAGE, 'd.ok && !!d.ratings && d.ratings[i] != null;', '!!d.ratings && d.ratings[i] != null;'],
  ['DNA: the axis note (population + n) dropped', MA2, "return '<div title=\"' + esc(ps2AxisTip(D, i))", "return '<div data-x=\"' + esc(ps2AxisTip(D, i))"],
  // Head to head
  ['N2: a walkover counted as a meeting', MA2, 'const counted = fhMeetings(m).filter(r => !r.wo && (FH_H2H_RET_COUNTS || !r.ret))', 'const counted = fhMeetings(m)'],
  ['H2H: a retirement dropped from the record', MA2, 'const counted = fhMeetings(m).filter(r => !r.wo && (FH_H2H_RET_COUNTS || !r.ret))', 'const counted = fhMeetings(m).filter(r => !r.wo && !r.ret)'],
  ['H2H: the record bar drawn for the trailer', MA2, "'<span style=\"width:' + (a / n * 100).toFixed(1) + '%; background:var(--ma2-blue);\">", "'<span style=\"width:' + (b / n * 100).toFixed(1) + '%; background:var(--ma2-blue);\">"],
  ['H2H: the sets counted per meeting', PAGE, "scored.forEach(r => { if (r.done) r.done.forEach(x => { if (x[0] > x[1]) a++; else if (x[1] > x[0]) b++; }); else { a += r.pS; b += r.oS; } });", "scored.forEach(r => { if (r.won) a++; else b++; });"],
  ['H2H: an absent tally printed as 0', MA2, '(p ? x : DASH)', '(p ? x : 0)'],
  ['Q18: a hot line opens the sheet', MA2, "'<div title=\"' + esc(KF_HOT_FAM[fhFamOf(x.L.g)]", "'<div onclick=\"event.stopPropagation();fhOpenSheet(\\'x\\')\" title=\"' + esc(KF_HOT_FAM[fhFamOf(x.L.g)]"],
  // Progression
  ['progression: one round instead of the pooled figure', MA2, 'fa = pgFig(x.avg[0], mt), fb = pgFig(x.avg[1], mt)', 'fa = pgFig(x.series[0][0], mt), fb = pgFig(x.series[1][0], mt)'],
  ['Q7: Pressure points given a draw average', MA2, 'const dr = mt.noDraw ? DASH : pgDrawFig(x.fAvg, mt).t;', "const dr = mt.noDraw ? '50.0%' : pgDrawFig(x.fAvg, mt).t;"],
  ['Q8: Pressure points swapped out', MA2, 'PG_METRICS.map((mt, i) => {', "PG_METRICS.filter(mt => mt.key !== 'pressure').map((mt, i) => {"],
  // News
  ['news: an article outside the 5-day window counted', MA2, ".filter(x => x.cat !== 'Tour News' && isFinite(x.ts) && x.ts >= since)", ".filter(x => x.cat !== 'Tour News' && isFinite(x.ts))"],
  ['news: not newest first', MA2, '.filter(x => x.hasA || x.hasB).sort((a, b) => b.ts - a.ts)', '.filter(x => x.hasA || x.hasB)'],
  ['review: one story, one line dropped (re-written headlines shown twice)', MA2, 'if (seen.has(k)) return false;', 'if (false) return false;'],
  // Stennisfy Model (brief 2026-11-23 item a)
  ['model: the draw store\'s copy ignored', MA2, '|| (ds && ds.model) || null;', '|| null;'],
  ['model: an exchange as a best soft book', PAGE, "k !== 'Pncl' && k !== sk && !/exchange|matchbook|smarkets|betdaq/i.test(k) && edgeQuote(m.bookNow, k)", "k !== 'Pncl' && k !== sk && edgeQuote(m.bookNow, k)"],
  ['model: the best-soft gap dashed (the retired Q11 rule)', MA2, 'sg = kfPP(soft ? edgeGapOf(prob, soft.price) : null)', 'sg = kfPP(null)'],
  ['model: the box stops linking to the Model page', MA2, "go: \"openEdgeModelFromMatch('\" + idA + \"')\"", "go: \"aGoTab('odds')\""],
  ['model: the run\'s net adjustment ignored', MA2, 'net = ok && e.stage2 && e.stage2.totalDeltaP1 != null ? e.stage2.totalDeltaP1 * 100 : null', 'net = null'],
  ['model: the prediction-market verdict dropped', PAGE, "return f.find(x => /sharp/i.test(x.type)) ? 'Sharp value' : pred(s) ? 'Prediction market value' :", "return f.find(x => /sharp/i.test(x.type)) ? 'Sharp value' : false ? 'Prediction market value' :"],
  // Market edge
  ['market edge: the tiles read another band than today\'s', MA2, 'b = ready && M.tb >= 0 ? M.bands[M.tb] : null', 'b = ready && M.tb >= 0 ? M.bands[0] : null'],
  ['market edge: the gate dropped (a stake beside two dashes)', MA2, "return { t: R.txt, c: R.mode === 'full' ? c : meGrey }; };", 'return { t: txt || DASH, c }; };'],
  // Weather
  ['weather: the box reads the card\'s own field, not the Weather tab\'s model', MA2, 'at = vm && !vm.indoor && !vm.unavail ? vm.at : null;', 'at = vm && !vm.indoor && !vm.unavail ? { temp: m.weather && m.weather.temperature } : null;'],
  ['Q14: "usual" back on the court speed box', MA2, "P.detail ? P.detail.charAt(0).toUpperCase() + P.detail.slice(1) : ''", "'usual'"],
  // the tab
  ['tab: a box routed nowhere', MA2, "const go = o.go || \"aGoTab('\" + o.tab + \"')\";", "const go = o.go || '';"],
  ['tab: the order changed', MA2, "order: 2, size: 'h', title: 'Odds'", "order: 12, size: 'h', title: 'Odds'"],
  ['tab: a size changed', MA2, "size: 'f', title: 'Stennisfy Model'", "size: 'h', title: 'Stennisfy Model'"],
  ['DoD 4: a SAMPLE DATA chip back', MA2, "title: 'Stennisfy Model',", "title: 'Stennisfy Model SAMPLE DATA',"],
  ['DoD 8: an old renderer back (hidden, not deleted)', PAGE, 'function buildKeyFactorsSection(m){', "function kfOddsMove(m){ return ''; }\nfunction buildKeyFactorsSection(m){"],
  ['D1: a literal colour in a box', MA2, "const kfNote = t => '<span style=\"font-size:12.5px; color:var(--ma2-grey);", "const kfNote = t => '<span style=\"font-size:12.5px; color:#a3aabe;"],
  // TEN-380 (founder step 3, README §1): the modal always opens on Odds; the Key factors loads (test-ten314-modal-frame.mjs)
  ['TEN-380: the default back on Key factors', PAGE, "  const first = (tab && A_TAB_BUILD[tab]) ? tab : 'odds';", "  const first = (tab && A_TAB_BUILD[tab]) ? tab : 'key';", FRAME],
  ['lazy: Key factors stops loading the H2H meetings', PAGE, 'fhEnsureFormData(m), fhEnsureH2hData(m), ensureMatchDna(),', 'fhEnsureFormData(m), ensureMatchDna(),', FRAME],
  ['lazy: no final paint (Download report prints the loading lines)', PAGE, '.then(() => { done = true; paint(); });', '.then(() => { done = true; });', FRAME],
];
const ENV = { [KF]: { [PAGE]: 'TEN341_HTML', [MA2]: 'TEN341_MA2' }, [FRAME]: { [PAGE]: 'TEN314_HTML' } };
const run = (suite, file, copy) => spawnSync(process.execPath, ['--test', ...(suite === KF ? ['--test-skip-pattern=' + GAP] : []), path.join(ROOT, suite)],
  { env: Object.assign({}, process.env, copy ? { [ENV[suite][file]]: copy } : {}), encoding: 'utf8' });
// Control per suite: the unmutated code must pass, or every "caught" below means nothing.
const green = {};
for (const suite of [KF, FRAME]) {
  green[suite] = run(suite).status === 0;
  console.log(green[suite] ? `✔ control: ${suite} passes on the unmutated code` + (suite === KF ? ` (its "${GAP}" tests skipped)` : '')
    : `⚠ SKIP: ${suite} is red on the unmutated code — its mutants are not run (nothing measured)`);
}
if (!green[KF]) { console.error(`✖ ${KF} is red on the unmutated code — its mutants are meaningless`); process.exit(1); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten341-mut-'));
let survived = 0, skipped = 0;
for (const [name, file, from, to, suite = KF] of MUTANTS) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  if (src.split(from).length !== 2) { console.error(`✖ anchor not found exactly once in ${file}: ${name}`); survived++; continue; }
  if (!green[suite]) { console.log(`⚠ SKIPPED (${suite} red): ${name}`); skipped++; continue; }
  const copy = path.join(dir, file);
  fs.writeFileSync(copy, src.replace(from, to));
  if (run(suite, file, copy).status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived - skipped} caught, ${survived} survived, ${skipped} skipped (suite red, not measured)`);
process.exit(survived ? 1 : 0);
