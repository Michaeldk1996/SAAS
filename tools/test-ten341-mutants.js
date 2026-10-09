// TEN-341 / TEN-380 — every check in test-ten341-key-factors.mjs (and the Key factors checks it shares with test-ten295-odds-chart.mjs
// and test-ten314-modal-frame.mjs) must FAIL when the behaviour it locks is reverted. Each mutant is applied to a copy of
// bsp-consult-dashboard.html and the suites are run against it (TEN341_HTML for this suite, TEN295_HTML for the odds
// chart, TEN314_HTML for the modal frame); a mutant that leaves them green is a vacuous test and fails this runner.
// Anchors must occur exactly once in the page.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PAGE = 'bsp-consult-dashboard.html';
const MUTANTS = [
  ['review: one story, one line dropped (re-written headlines shown twice)', "return !k || arr.findIndex(y => aNewsStoryKey(y.a.title) === k) === i;", "return true;"],
  ['review item 2: a dot back on a news item', '<div class="kf-news-item" data-kf-news="${x.who.join(\'\')}" style="position:relative; display:flex; flex-direction:column; gap:2px; padding:8px 0 8px 12px; min-width:0;">', '<div class="kf-news-item" data-kf-news="${x.who.join(\'\')}" style="position:relative; display:flex; flex-direction:column; gap:2px; padding:8px 0 8px 12px; min-width:0;"><span style="width:7px; height:7px; border-radius:50%;"></span>'],
  ['review F1: the Market edge prefetch loads a match the modal left', "    .then(() => { if (_aM === m) meLoad(m);", "    .then(() => { meLoad(m);"],
  // Playing style (record vs the opponent's style)
  ['style: the tug drawn on the losses side', 'const tw = shown && R.w > R.l ? (R.w - R.l) / n * 50 : 0, tl = shown && R.l > R.w ? (R.l - R.w) / n * 50 : 0;', 'const tl = shown && R.w > R.l ? (R.w - R.l) / n * 50 : 0, tw = shown && R.l > R.w ? (R.l - R.w) / n * 50 : 0;'],
  ['style: the oldest meetings shown as "recent"', ".sort((x, y) => String(y.date || '').localeCompare(String(x.date || ''))).slice(0, 3)", ".sort((x, y) => String(x.date || '').localeCompare(String(y.date || ''))).slice(0, 3)"],
  ['D2: a record-vs-style % printed at n = 2', "const pct = shown ? Math.round(R.w / n * 100) + '%' : FH_DASHC;", "const pct = n ? Math.round(R.w / n * 100) + '%' : FH_DASHC;"],
  ['N2: a walkover counted in the record vs style', 'const rows = raw.filter(r => !ps2IsWalkover(r));', 'const rows = raw;'],
  // Recent form
  ['N2: the bars read the raw rows (a walkover and the match itself become bars)', 'const bars = P.win.slice().reverse().map(', 'const bars = (((m._fhFormRows || [])[idx]) || []).slice(0, 10).reverse().map('],
  ['Q16: the box counts all surfaces', "{ surf: surf || 'all', role: 'all', wmode: 'n', n: 10 });   // the Form tab's default view (fhStateFor, N1)", "{ surf: 'all', role: 'all', wmode: 'n', n: 10 });"],
  ['Q13: the meta loses the surface', "meta = fhEsc(`Last 10${surf ? ' · ' + surf : ''}`)", "meta = fhEsc('Last 10')"],
  ['form: v market not coloured by its sign', "mktCol(d == null ? C.t3 : kfSignCol(d, 1) === C.t3 ? C.text : kfSignCol(d, 1))", 'mktCol(C.text)'],
  ['form: every scored hot line (no best-per-family pick)', 'hot = FH_HOT_FAM.map(f => P.hot.sc.scored.find(x => fhFamOf(x.L.g) === f[0])).filter(Boolean).map(x => {', 'hot = P.hot.sc.scored.map(x => {'],
  // Tournament
  ['N6: a synthesised Withdrawal edition counted', "function trEditionsOf(hist){ return ((hist && hist.years) || []).filter(y => !y.withdrew); }", "function trEditionsOf(hist){ return ((hist && hist.years) || []); }"],
  ['Q25: "no record on file" back', "if (!hist) return `<span class=\"kf-tour-note\">${words('first appearance')}</span>`;", "if (!hist) return `<span class=\"kf-tour-note\">${words('no record on file')}</span>`;"],
  ['tier: a fabricated tier for an unknown event', "const tier = (m.venue && m.venue.category) || (catHit && catHit.category) || '';", "const tier = (m.venue && m.venue.category) || (catHit && catHit.category) || 'ATP 250';"],
  ['round: "1/16-finals" left in the feed\'s code', "return /^1\\/\\d+-finals$/i.test(rdRaw) ? (TR_RESULT[psRoundAbbr(rdRaw)] || rdRaw) : rdRaw;", "return rdRaw;"],
  ['Q14: the knob placed on the abstract speed', 'const idx = cs && cs.speed != null && Number.isFinite(Number(cs.speed)) ? Math.max(0, Math.min(100, Number(cs.speed))) : null;', 'const idx = cs && cs.abstractSpeed != null ? Math.max(0, Math.min(100, Number(cs.abstractSpeed) * 50)) : null;'],
  ['D2: the ROI tiles ungated', "rateOk = !!mk && (g === 'full' || g === 'small');", 'rateOk = !!mk;'],
  ['ROI coloured by its delta to the tour, not its sign', "const col = !has ? C.t3 : g === 'small' ? MA_GREY : kfSignCol(v, 1) === C.t3 ? C.text : kfSignCol(v, 1);", "const col = !has ? C.t3 : g === 'small' ? MA_GREY : kfSignCol(dlt, 1);"],
  // founder Q9 (2026-09-30): the event hold rate is the Tournament tab's cell (our box scores, n in the tooltip)
  ['Q9: Key factors prints the court-conditions sheet\'s count-less %', "hold ${trHoldHtml(m, 'kf-hold')}", "hold ${cs && cs.serviceHold != null ? cs.serviceHold + '%' : FH_DASHC}"],
  ['Q9: the tooltip loses n', "(n = ${fmt(H.n)}), both players,", "both players,"],
  ['Q9: the hold rate gated like a sample rate', "const val = H.state === 'ok' ? Math.round(H.pct) + '%' : FH_DASHC;", "const val = H.state === 'ok' && H.matches >= 100 ? Math.round(H.pct) + '%' : FH_DASHC;"],
  // Odds
  ['Q17: the book preference dropped (the Odds tab\'s first live row wins)', 'const pick = KF_BOOK_PREF.map(re => live.find(r => re.test(r.name))).find(Boolean) || live[0] || null;', 'const pick = live[0] || null;'],
  ['odds: a gapped book drawn across the gap', "if (row.gaps && row.gaps.length) return { a: '', b: '', svg: '',", "if (false) return { a: '', b: '', svg: '',"],
  ['odds: the now from bestOdds (a second book)', "now = row && row[x + 'Now'] != null ? aOddsFmt(row[x + 'Now']) : FH_DASHC;", "now = m.bestOdds && m.bestOdds[x === 'a' ? 'p1' : 'p2'] ? aOddsFmt(m.bestOdds[x === 'a' ? 'p1' : 'p2'].price) : FH_DASHC;"],
  ['odds: Fair from two unmatched latest quotes', "const fair = x => (row && row.nv && row.nv[x].length ? aOddsFmt(row.nv[x][row.nv[x].length - 1][1]) : FH_DASHC);", "const fair = x => (row && row[x + 'Now'] != null ? aOddsFmt(row[x + 'Now'] * (1 / row.aNow + 1 / row.bNow)) : FH_DASHC);"],
  ['odds: an all-stale market reads "no prices in the feed"', "kfNote(X.D.hasSeries ? 'No recent prices:", "kfNote(false ? 'No recent prices:"],
  ['Q12: a "Soft avg" back', '<span>Fair<span class="kf-fair-${x}"', '<span>Soft avg 1.00</span><span>Fair<span class="kf-fair-${x}"'],
  // DNA (N10)
  ['N10: the MCP radar fetched again', 'kfEnsureNews(m), kfEnsureMarketEdge(m)]', "kfEnsureNews(m), kfEnsureMarketEdge(m), fetch('./style-radar.json')]"],
  ['DNA: the raw rating printed instead of the percentile', 'const a = pctOf(D.a.vals[i]), b = pctOf(D.b.vals[i]);', 'const a = D.a.vals[i].raw, b = D.b.vals[i].raw;'],
  ['ruling 8: the DNA trailer solid (no 45%)', "Math.round(p) < Math.round(o) ? C.dna2 : C.dna}", "Math.round(p) < Math.round(o) ? C.dna : C.dna}"],
  ['ruling 8: the DNA bars toned per player, not per axis leader', '${val(a)}${bar(a, false, b)}', '${val(a)}${bar(a, false, -1)}'],
  ["ruling 8: the reference's 40% opacity trailer", "Math.round(p) < Math.round(o) ? C.dna2 : C.dna}", "Math.round(p) < Math.round(o) ? C.dna + '; opacity:0.4' : C.dna}"],
  ['DNA: the bars on --bar (white inside Key factors)', "dna: 'var(--viz-lead)',", "dna: 'var(--bar)',"],
  ['DNA: an axis drawn under the 10-match floor', 'd.ok && !!d.ratings && d.ratings[i] != null;', '!!d.ratings && d.ratings[i] != null;'],
  ['DNA: the axis note (population + n) dropped', '<span tabindex="0" data-aotip="${escapeHtml(ps2AxisTip(D, i))}" style="font-size:11.5px;', '<span tabindex="0" data-x="${escapeHtml(ps2AxisTip(D, i))}" style="font-size:11.5px;'],
  // Head to head
  ['N2: a walkover counted as a meeting', 'const counted = fhMeetings(m).filter(r => !r.wo && (FH_H2H_RET_COUNTS || !r.ret));', 'const counted = fhMeetings(m);'],
  ['H2H: a retirement dropped from the record', 'const counted = fhMeetings(m).filter(r => !r.wo && (FH_H2H_RET_COUNTS || !r.ret));', 'const counted = fhMeetings(m).filter(r => !r.wo && !r.ret);'],
  ['H2H: the tug drawn toward the trailer', "style=\"position:absolute; top:0; bottom:0; ${a > b ? 'right' : 'left'}:50%;", "style=\"position:absolute; top:0; bottom:0; ${a > b ? 'left' : 'right'}:50%;"],
  ['H2H: the sets counted per meeting', "scored.forEach(r => { if (r.done) r.done.forEach(x => { if (x[0] > x[1]) a++; else if (x[1] > x[0]) b++; }); else { a += r.pS; b += r.oS; } });", "scored.forEach(r => { if (r.won) a++; else b++; });"],
  ['H2H: an absent tally printed as 0', "const pair = p => (p ? [String(p[0]), String(p[1])] : [FH_DASHC, FH_DASHC]);", "const pair = p => (p ? [String(p[0]), String(p[1])] : ['0', '0']);"],
  ['H2H: hot-line rows on --inner', 'gap:4px 14px; align-items:center; padding:8px 12px; ${KF_PANEL}', 'gap:4px 14px; align-items:center; padding:8px 12px; background:var(--inner);'],
  ['Q18: a hot line opens the sheet', '<div class="kf-h2h-hot" style=', '<div class="kf-h2h-hot" onclick="event.stopPropagation();fhOpenSheet(\'x\')" style='],
  // Progression
  ['progression: one round instead of the pooled figure', 'const fig = s => { const f = x ? pgFig(x.avg[s], mt)', 'const fig = s => { const f = x ? pgFig(x.series[s][0], mt)'],
  ['Q7: Pressure points given a draw average', 'const dr = mt.noDraw || !x ? FH_DASHC : pgDrawFig(x.fAvg, mt).t;', "const dr = !x ? FH_DASHC : '50.0%';"],
  ['Q8: Pressure points swapped out', 'const rows = PG_METRICS.map((mt, i) => {', "const rows = PG_METRICS.filter(mt => mt.key !== 'pressure').map((mt, i) => {"],
  // News
  ['news: an article in both lists shown twice', "const k = a.news_key != null ? String(a.news_key) : ts + '|' + (a.title || '');", "const k = who + (a.news_key != null ? String(a.news_key) : ts + '|' + (a.title || ''));"],
  ['news: not newest first', 'return [...by.values()].sort((x, y) => y.ts - x.ts);', 'return [...by.values()];'],
  // Stennisfy Model
  ['Q11: the Best soft gap computed', "${kfModelBox('Best soft', FH_DASHC, C.t3, soft,", "${kfModelBox('Best soft', has && bo && fairP > 0 ? '+' + ((fairP - 1 / bo.price) * 100).toFixed(1) + 'pp' : FH_DASHC, C.t3, soft,"],
  ['model: the flag off another threshold', 'sharp = edge != null && edge > 0.005;', 'sharp = edge != null && edge > 0.05;'],
  ['model: a verdict printed with no Pinnacle edge', 'const flag = has && edge != null ?', 'const flag = has ?'],
  ['model: the box stops linking to the Model page', "go: `openEdgeModelFromMatch('${idAttr}')`", "go: `aGoTab('odds')`"],
  ['model: the Model page\'s net adjustment ignored', 'const net = mo && mo.ok && mo.stage2 && mo.stage2.totalDeltaP1 != null ? Number(mo.stage2.totalDeltaP1) * 100 : null;', 'const net = null;'],
  ['model: "Now" from the legacy books only (chart-shape Pinnacle loses its Now)', "const pinRow = (m.oddsMovement || m._oddsLoaded) ? aOddsRowsOf(m, {}).rows.find(", "const pinRow = (m.oddsMovement && m.oddsMovement.books && Object.keys(m.oddsMovement.books).some(k => /pinnacle/i.test(k))) ? aOddsRowsOf(m, {}).rows.find("],
  ['model: the move read off unrounded prices', 'mv = po != null && pn != null ? (d2(pn) - d2(po)) / d2(po) * 100 : null;', 'mv = po != null && pn != null ? (pn - po) / po * 100 : null;'],
  ['model: a shortening move coloured red', 'color:${Math.abs(mv) < 0.05 ? C.t3 : mv < 0 ? C.up : C.dn};', 'color:${Math.abs(mv) < 0.05 ? C.t3 : mv < 0 ? C.dn : C.up};'],
  // Market edge
  ['market edge: the tiles read another band than today\'s', 'b = ready && M.tb >= 0 ? M.bands[M.tb] : null;', 'b = ready && M.tb >= 0 ? M.bands[0] : null;'],
  ['market edge: the top-2 lines lose their wash', "background:${r.top ? C.wash : 'transparent'};", 'background:transparent;'],
  // Weather
  ['weather: the box reads the card\'s own field, not the Weather tab\'s model', 'else { verdict = W.verdict; if (!W.unavail) at = W.at; }', 'else { verdict = W.verdict; if (!W.unavail) at = { temp: m.weather && m.weather.temperature }; }'],
  ['Q14: "usual" back on the court pace', "${tile('kf-wx-pace', 'Court pace', pace, cs && cs.category ? fhEsc(cs.category) : '')}", "${tile('kf-wx-pace', 'Court pace', pace, 'usual')}"],
  // TEN-380 (founder step 3, README §1; replaces Q26): the modal always opens on Odds (test-ten314-modal-frame.mjs "TEN-380")
  ['TEN-380: the last-used tab restored', "  const first = (tab && A_TAB_BUILD[tab]) ? tab : 'odds';   // TEN-380: the modal opens on Odds (README §1, reference)", "  const first = (tab && A_TAB_BUILD[tab]) ? tab : (Object.keys(A_TAB_BUILD).find(t => { const b = document.querySelector(`#aTabs .asidenav-item[data-atab=\"${t}\"]`); return b && b.classList.contains('active'); }) || 'odds');"],
  ['TEN-380: the default back on Key factors', "  const first = (tab && A_TAB_BUILD[tab]) ? tab : 'odds';   // TEN-380: the modal opens on Odds (README §1, reference)", "  const first = (tab && A_TAB_BUILD[tab]) ? tab : 'key';"],
  // the tab
  ['tab: a box routed nowhere', "const go = o.go || `aGoTab('${tab}')`;", "const go = o.go || '';"],
  ['tab: the 3-column grid back', '<div class="kf-grid" style="display:grid; grid-template-columns:repeat(6,minmax(0,1fr));', '<div class="kf-grid" style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr));'],
  ['tab: a header title that can be clipped', '<span class="kf-title" style="flex:none; ${KF_CAP}">', '<span class="kf-title" style="flex:1 1 auto; min-width:0; overflow:hidden; ${KF_CAP}">'],
  ['DoD 4: the design\'s SAMPLE DATA chip back', '<div class="kf-grid" style="display:grid;', '<span>SAMPLE DATA</span><div class="kf-grid" style="display:grid;'],
  ['DoD 8: a native title back', '<span class="${cls}"${tip ? ` tabindex="0" data-aotip=', '<span class="${cls}" title="x"${tip ? ` tabindex="0" data-aotip='],
  ['DoD 8: an old renderer back (hidden, not deleted)', 'function buildKeyFactorsSection(m){', 'function akOddsMoveSvg(m){ return \'\'; }\nfunction buildKeyFactorsSection(m){'],
  ['D1: a literal colour in a style constant', "const KF_PANEL = 'background:var(--card); border:1px solid var(--edge-6);';", "const KF_PANEL = 'background:#10131d; border:1px solid var(--edge-6);';"],
  ['D1: a literal colour in the tile surface', "  card: 'var(--card)', edge: 'var(--edge-7)',", "  card: '#10131d', edge: 'var(--edge-7)',"],
  ['escaping: the tournament title unescaped', "${fhEsc(tier ? `${trName(m)} · ${tier}` : trName(m))}", "${tier ? `${trName(m)} · ${tier}` : trName(m)}"],
  ['lazy: Key factors stops loading the H2H meetings', 'fhEnsureFormData(m), fhEnsureH2hData(m), ensureMatchDna(),', 'fhEnsureFormData(m), ensureMatchDna(),'],
  ['lazy: no final paint (Download report prints the loading lines)', '.then(() => { done = true; paint(); });', '.then(() => { done = true; });'],
];
const SUITES = [['test-ten341-key-factors.mjs', 'TEN341_HTML'], ['test-ten295-odds-chart.mjs', 'TEN295_HTML'], ['test-ten314-modal-frame.mjs', 'TEN314_HTML']];
const run = file => spawnSync(process.execPath, ['--test', ...SUITES.map(([f]) => path.join(ROOT, f))],
  { env: Object.assign({}, process.env, file ? Object.fromEntries(SUITES.map(([, k]) => [k, file])) : {}), encoding: 'utf8' });
// Control: the unmutated page must pass, or every "caught" below means nothing.
{ const r = run(); if (r.status !== 0) { console.error('✖ the suites are red on the unmutated page — mutants are meaningless'); process.exit(1); }
  console.log('✔ control: the unmutated page passes'); }
const src = fs.readFileSync(path.join(ROOT, PAGE), 'utf8');
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten341-mut-'));
for (const [name, from, to] of MUTANTS) {
  if (src.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, PAGE);
  fs.writeFileSync(file, src.replace(from, to));
  const r = run(file);
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
