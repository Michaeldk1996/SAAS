// TEN-341 — every check in test-ten341-key-factors.mjs (and the Key factors checks it shares with test-ten295-odds-chart.mjs
// and test-ten314-modal-frame.mjs) must FAIL when the behaviour it locks is reverted. Each mutant is applied to a copy of
// bsp-consult-dashboard.html and the suites are run against it (TEN341_HTML for this suite, TEN295_HTML for the odds
// chart, TEN314_HTML for the modal frame); a mutant that leaves them green is a vacuous test and fails this runner.
// Anchors must occur exactly once in the page.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PAGE = 'bsp-consult-dashboard.html';
const MUTANTS = [
  // Playing style
  ['style: the bar drawn at p2\'s share', '<span style="width:${E.a}%; background:${FH_AC};"></span>', '<span style="width:${E.b}%; background:${FH_AC};"></span>'],
  ['style: the file\'s gradient bar back', '<div class="kf-edge-bar" style="display:flex; height:8px;', '<div class="kf-edge-bar" style="background:linear-gradient(90deg,var(--ma-link),var(--ma-fill)); display:flex; height:8px;'],
  ['style: a mirror dashed (no 50 / 50)', "const rated = E.kind === 'cell' || E.kind === 'mirror';", "const rated = E.kind === 'cell';"],
  // Recent form
  ['N2: the pills read the raw rows (a walkover and the match itself become pills)', 'const pills = P.shown.slice(0, 5).map(', 'const pills = ((m._fhFormRows || [])[idx] || []).slice(0, 5).map('],
  ['D2: "Last N" printed as a bare rate', 'maRateHtml(P.wins, n, { nopct: `${P.wins}–${n - P.wins}`, color: C.text })', '`${Math.round(P.wins / n * 100)}%`'],
  ['season: an empty surface season printed as 0–0', 'txt: n ? `${c.won}–${c.lost}` : FH_DASHC,', 'txt: `${c ? c.won : 0}–${c ? c.lost : 0}`,'],
  ['season: the form rows\' year read instead of the match season', "const key = idx ? m.p2Key : m.p1Key, season = /^\\d{4}/.test(String(m.date || '')) ? String(m.date).slice(0, 4) : ovSeasonYear();", "const key = idx ? m.p2Key : m.p1Key, season = '2025';"],
  // Head to head
  ['N2: a walkover counted as a meeting', 'const counted = fhMeetings(m).filter(r => !r.wo && (FH_H2H_RET_COUNTS || !r.ret));', 'const counted = fhMeetings(m);'],
  ['H2H: a retirement dropped from the record', 'const counted = fhMeetings(m).filter(r => !r.wo && (FH_H2H_RET_COUNTS || !r.ret));', 'const counted = fhMeetings(m).filter(r => !r.wo && !r.ret);'],
  ['H2H: the "last meeting" = the oldest', 'const lm = counted[n - 1] || null;', 'const lm = counted[0] || null;'],
  // Dimension edge (N10)
  ['N10: the MCP radar fetched again', '      ensureOddsMovement(m), kfEnsureWeather(m)].map(p =>', "      ensureOddsMovement(m), kfEnsureWeather(m), fetch('./style-radar.json')].map(p =>"],
  ['DNA: the gaps ranked by the raw rating, not the percentile', '.sort((x, y) => Math.abs(y.a.pct - y.b.pct) - Math.abs(x.a.pct - x.b.pct)).slice(0, 3);', '.sort((x, y) => Math.abs(y.a.raw - y.b.raw) - Math.abs(x.a.raw - x.b.raw)).slice(0, 3);'],
  ['DNA: a shape drawn under the 10-match floor', 'const shape = s => (s.d.ok ?', 'const shape = s => (true ?'],
  ['DNA: the axis note (population + n) dropped from the gap rows', '<span tabindex="0" data-aotip="${escapeHtml(ps2AxisTip(D, g.i))}"', '<span tabindex="0" data-x="${escapeHtml(ps2AxisTip(D, g.i))}"'],
  // Tournament
  ['hold: the count-less % shown again', "? maTipHtml('<b tabindex=\"0\">—</b>', MA_HOLD_NO_N, { wrap: 220, start: true }) : dash(trSpeedNote(m));", "? `<b>${cs.serviceHold}%</b>` : dash(trSpeedNote(m));"],
  ['hold: the dash loses its tooltip', "? maTipHtml('<b tabindex=\"0\">—</b>', MA_HOLD_NO_N, { wrap: 220, start: true }) : dash(trSpeedNote(m));", "? '<b tabindex=\"0\">—</b>' : dash(trSpeedNote(m));"],
  ['hold: the tooltip back to one clipped line', "MA_HOLD_NO_N, { wrap: 220, start: true }) : dash(", "MA_HOLD_NO_N) : dash("],
  ['hold: the tooltip centred again (overhangs the column)', "MA_HOLD_NO_N, { wrap: 220, start: true }) : dash(", "MA_HOLD_NO_N, { wrap: 220 }) : dash("],
  ['hold: the dash not focusable', "maTipHtml('<b tabindex=\"0\">—</b>', MA_HOLD_NO_N", "maTipHtml('<b>—</b>', MA_HOLD_NO_N"],
  ['hold: no visible reason without hover', "cs && cs.serviceHold != null ? 'n not published' : FH_DASHC", "cs && cs.serviceHold != null ? 'at this event' : FH_DASHC"],
  ['N6: a synthesised Withdrawal edition counted', "function trEditionsOf(hist){ return ((hist && hist.years) || []).filter(y => !y.withdrew); }", "function trEditionsOf(hist){ return ((hist && hist.years) || []); }"],
  ['tier: a fabricated tier for an unknown event', "const tier = (m.venue && m.venue.category) || (catHit && catHit.category) || '';", "const tier = (m.venue && m.venue.category) || (catHit && catHit.category) || 'ATP 250';"],
  ['round: "1/16-finals" left in the feed\'s code', "return /^1\\/\\d+-finals$/i.test(rdRaw) ? (TR_RESULT[psRoundAbbr(rdRaw)] || rdRaw) : rdRaw;", "return rdRaw;"],
  // Odds
  ['odds: the book preference dropped (the Odds tab\'s first live row wins)', 'const pick = KF_BOOK_PREF.map(re => live.find(r => re.test(r.name))).find(Boolean) || live[0] || null;', 'const pick = live[0] || null;'],
  ['odds: a gapped book drawn across the gap', 'if (row.gaps && row.gaps.length) return { svg: \'\',', 'if (false) return { svg: \'\','],
  ['odds: the prices from bestOdds (a second book)', 'const a = row.aNow, b = row.bNow, nvA =', 'const a = (m.bestOdds && m.bestOdds.p1 && m.bestOdds.p1.price) || row.aNow, b = (m.bestOdds && m.bestOdds.p2 && m.bestOdds.p2.price) || row.bNow, nvA ='],
  // Weather
  ['weather: the strip reads the card\'s own field, not the Weather tab\'s model', 'else { note = W.verdict; if (!W.unavail) at = W.at; }', 'else { note = W.verdict; if (!W.unavail) at = { temp: m.weather && m.weather.temperature }; }'],
  // Stennisfy Model
  ['model: the soft book\'s "vs fair" computed', "${box('Best soft book', soft, fhEsc(bo && bo.bookmaker ? bo.bookmaker : FH_DASHC), FH_DASHC, 'kf-soft')}", "${box('Best soft book', soft, fhEsc(bo && bo.bookmaker ? bo.bookmaker : FH_DASHC), '+0.0pp vs fair', 'kf-soft')}"],
  ['model: "Now" from the legacy books only (chart-shape Pinnacle loses its Now)', "const pinRow = (m.oddsMovement || m._oddsLoaded) ? aOddsRowsOf(m, {}).rows.find(", "const pinRow = (m.oddsMovement && m.oddsMovement.books && Object.keys(m.oddsMovement.books).some(k => /pinnacle/i.test(k))) ? aOddsRowsOf(m, {}).rows.find("],
  ['model: the move arrow read off unrounded prices', "arrow = po != null && pn != null ? (d2(pn) > d2(po) ?", "arrow = po != null && pn != null ? (pn > po ?"],
  ['model: the flag off the Pinnacle edge', 'sharp = edge != null && edge > 0.005;', 'sharp = edge != null && edge > 0.05;'],
  ['model: the empty state stops linking to the Model page', "if (!vs || vs.fairP1 == null || vs.fairP2 == null) return open(", "if (!vs || vs.fairP1 == null || vs.fairP2 == null) return (x => head + x)("],
  // the tab
  ['tab: a card routed nowhere', "return `<div class=\"seg kf-card\" data-kf=\"${tab}\"${kfLink(`aGoTab('${tab}')`)}", "return `<div class=\"seg kf-card\" data-kf=\"${tab}\"${kfLink('')}"],
  ['DoD 4: the design\'s SAMPLE DATA chip back', '<div class="kf-grid" style="display:grid;', '<span>SAMPLE DATA</span><div class="kf-grid" style="display:grid;'],
  ['DoD 8: a native title back', '<span class="kf-last" tabindex="0" data-aotip=', '<span class="kf-last" title="Last matches" tabindex="0" data-aotip='],
  ['DoD 8: an old renderer back (hidden, not deleted)', 'function buildKeyFactorsSection(m){', 'function akOddsMoveSvg(m){ return \'\'; }\nfunction buildKeyFactorsSection(m){'],
  ['D1: a literal colour in a style attribute', '<span class="kf-tour-note" style="font-size:12px; color:${C.t4};">', '<span class="kf-tour-note" style="font-size:12px; color:#4b5672;">'],
  ['odds: an all-stale market reads "no prices in the feed"', "kfNote(D.hasSeries ? 'No recent prices:", "kfNote(false ? 'No recent prices:"],
  ['odds: the vig split from two unmatched latest quotes', "const p1 = nvA ? 100 / nvA : null,", "const p1 = (1 / a) / (1 / a + 1 / b) * 100,"],
  ['escaping: the tournament title unescaped', "${fhEsc(tier ? `${clean} · ${tier}` : clean)}", "${tier ? `${clean} · ${tier}` : clean}"],
  ['D1: a literal colour in the card surface', "card: fhS('0a0d14', '--surface'), line: fhS('ffffff-090', '--line'),", "card: '#0a0d14', line: fhS('ffffff-090', '--line'),"],
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
