// Stennisfy Model page (handoff 2026-11-16; TEN-418 step 12) — every check in test-ten418-model.mjs must FAIL when its rule is reverted or bent.
// Each mutant is applied to a copy of bsp-consult-dashboard.html (TEN418_HTML) and the suite runs against it; a mutant
// that leaves it green is a vacuous test and fails this runner. Anchors occur exactly once.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
  ['head: Updated back in the "?"', "compared with Pinnacle and the best soft book.`;", "compared with Pinnacle and the best soft book. Model run ${edgeClock(e && e.generatedAt, 'full')}.`;"],
  ['head: a fixed 17 layers', "then folds in ${total || 'its'} value layers.", "then folds in 17 value layers."],
  ['rail: reads every match, not the board list', "  if (edgeScopeAll) return edgeUpcomingAll();\n  return (typeof getFiltered === 'function') ? getFiltered() : matches;", "  if (edgeScopeAll) return edgeUpcomingAll();\n  return matches;"],
  ['rail: raw feed tournament name in the group head', "<div class=\"sm-grp\"><div class=\"sm-grp-h\"><span class=\"sm-caps\">${edgeEsc(edgeEventName(t))}</span>", "<div class=\"sm-grp\"><div class=\"sm-grp-h\"><span class=\"sm-caps\">${edgeEsc(t)}</span>"],
  ['rail: dropdown never closes on a pick', "function edgeRailSetTour(v){ edgeRailTour = v; edgeRailOpen = false; edgeRenderRail(); }", "function edgeRailSetTour(v){ edgeRailTour = v; edgeRenderRail(); }"],
  ['rail: a placeholder round', "const w = edgeWhenParts(m), rd = edgeRoundCode(m, null) || '—';", "const w = edgeWhenParts(m), rd = 'QF';"],
  ['empty: Today’s Matches state not put back', "  try { return getFiltered(); } finally { Object.assign(state, keep); }", "  return getFiltered();"],
  ['empty: no model-run time in the note', "  const runLine = run ? ' Model last run ' + run + '.' : '';", "  const runLine = '';"],
  ['names: feed spelling instead of the shared formatter', "return (typeof newsPlayerName === 'function') ? newsPlayerName(key, feed) : String(feed || '');", "return String(feed || '');"],
  ['header: H2H link without the pair in storage', "  try { sessionStorage.setItem('stn_h2h_pair', JSON.stringify({ a, b })); } catch (x) {}\n", ""],
  ['header: H2H href without the pair', "`<a href=\"?a=${encodeURIComponent(keys.p1)}&amp;b=${encodeURIComponent(keys.p2)}\"", "`<a href=\"#\""],
  ['header: names cut with an ellipsis', ".sm-mh-nm{ font-size:22px; font-weight:800; letter-spacing:-0.015em; max-width:100%; overflow-wrap:anywhere; }", ".sm-mh-nm{ font-size:22px; font-weight:800; letter-spacing:-0.015em; max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }"],
  ['prices: Bet365 ahead of Pinnacle', "const EDGE_SHARP = [['Pncl', 'Pinnacle'], ['bet365', 'Bet365']];", "const EDGE_SHARP = [['bet365', 'Bet365'], ['Pncl', 'Pinnacle']];"],
  ['prices: best soft scans Pinnacle too', "filter(k => k !== 'Pncl' && k !== sk && !/exchange|matchbook|smarkets|betdaq/i.test(k) && edgeQuote(m.bookNow, k));", "filter(k => k !== sk && !/exchange|matchbook|smarkets|betdaq/i.test(k) && edgeQuote(m.bookNow, k));"],
  ['prices: an exchange counted as soft', "filter(k => k !== 'Pncl' && k !== sk && !/exchange|matchbook|smarkets|betdaq/i.test(k) && edgeQuote(m.bookNow, k));", "filter(k => k !== 'Pncl' && k !== sk && edgeQuote(m.bookNow, k));"],
  ['market: edge against the raw implied, not the no-vig', "const d = (q && base[s] != null) ? smPP((base[s] - edgeNoVig(q, s)) * 100) : { t: '—', c: '' };", "const d = (q && base[s] != null) ? smPP((base[s] - 1 / q[s]) * 100) : { t: '—', c: '' };"],
  ['market: Implied % shows the odds', "const v = !q ? '—' : (pct ? (edgeNoVig(q, s) * 100).toFixed(1) + '%' : mxOddsTxt(q[s]));", "const v = !q ? '—' : mxOddsTxt(q[s]);"],
  ['market: no anchor read time', "+ (pinRead ? ` The model anchors to Pinnacle’s quote from api-tennis, read ${edgeClock(pinRead, 'full')}.` : '');", ";"],
  ['fair: an odd of 1.00 or below is priced', "return (isFinite(v) && v > 1) ? v : null;", "return (isFinite(v) && v > 0) ? v : null;"],
  ['fair: gap from the unrounded fair (R1 fix 6)', "function edgeGapOf(prob, odd){ return (prob == null || odd == null) ? null : Math.round(prob * 1000) / 10 - 100 / odd; }", "function edgeGapOf(prob, odd){ return (prob == null || odd == null) ? null : prob * 100 - 100 / odd; }"],
  ['verdict: recomputed from the page’s gap, not the model’s flag', "const by = s => { const f = flags.filter(x => x.side === s);", "const by = s => { const f = []; if (((st3.sharp && st3.sharp.edge) || {})[s] > 0) f.push({ type: 'Sharp Value' });"],
  ['verdict: no value is red on both sides', "return { p1: { t: 'No value', c: dec === 'p1' ? 'neg' : '' }, p2: { t: 'No value', c: dec === 'p2' ? 'neg' : '' } };", "return { p1: { t: 'No value', c: 'neg' }, p2: { t: 'No value', c: 'neg' } };"],
  ['verdict: the other side reads No value', "{ t: 'Market side', c: '' }, p2: v.p2", "{ t: 'No value', c: '' }, p2: v.p2"],
  ['layers: rows by shift, not weight', "}).sort((x, y) => (x.w.rank - y.w.rank) || (y.mag - x.mag));", "}).sort((x, y) => (y.mag - x.mag));"],
  ['layers: gated reads Medium, not Not applicable', "function edgeNa(a){ return !!(a && (a.gated || edgeNotThisFormat(a))); }", "function edgeNa(a){ return false; }"],
  ['layers: level threshold 0.01', "const EDGE_LEVEL_PP = 0.05;", "const EDGE_LEVEL_PP = 0.01;"],
  ['layers: shift pill on both sides', "const sp = s => `<span class=\"sm-sp${lead(s) ? ' on' : ''}\">${lead(s) ? v.shift : ''}</span>`;", "const sp = s => `<span class=\"sm-sp on\">${v.shift}</span>`;"],
  ['layers: both figures white', "const rt = s => `<span class=\"sm-rt${!v.has ? ' na' : lead(s) ? ' lead' : ''}\">", "const rt = s => `<span class=\"sm-rt${!v.has ? ' na' : ' lead'}\">"],
  ['layers: a plain space inside a sub line part', "map(x => edgeEsc(x).replace(/ /g, '\\u00a0').replace(/-/g, '\\u2011')).join('\\u00a0· ')", "map(x => edgeEsc(x)).join('\\u00a0· ')"],
  ['layers: strip jump uses scrollIntoView', "(sc === window ? window : sc).scrollBy({ top, behavior: 'smooth' });", "el.scrollIntoView({ block: 'center', behavior: 'smooth' });"],
  ['layers: breakdown open on load', "let edgeLayersOpen = false;", "let edgeLayersOpen = true;"],
  ['layers: format split hidden again (13 layers)', "function edgeVisibleAdjs(list){ return (list || []).slice(); }", "function edgeVisibleAdjs(list){ return (list || []).filter(a => !a.hidden); }"],
  ['layers: engine shorthand back in the Why', "    case 'surface':\n      if ((x = /^(\\w+) record", "    case 'surfaceX':\n      if ((x = /^(\\w+) record"],
  ['layers: Data quality says a different state', "  if (q === 'Good') return 'The inputs behind this layer are complete for both players in this match.';", "  if (q === 'Good') return 'Applied: the engine rates the sample behind this layer medium for this match.';"],
  ['layers: style matchup ignores the Playing Styles cell', "const why = a.key === 'styleMatchup' && !a.applied && v.r.cell ? edgeStyleWhy(names, keys) : (a.key === 'styleMatchup' && !a.applied ? edgeStyleWhy(names, keys) : edgeWhyText(a, names));", "const why = edgeWhyText(a, names);"],
  ['layers: two names for the manual layer', "const EDGE_LAYER_NAMES = { subjective: 'Manual context' };", "const EDGE_LAYER_NAMES = {};"],
  ['layers: an even row reads No data / Poor', "  if (edgeEven(a)) return 'full';\n", ""],
  ['layers: a court figure under the floor printed as measured', "return Number(n) < EDGE_QF_SURF_FLOOR ? `${P} under", "return false ? `${P} under"],
  ['layers: a hyphen as the minus', "function edgeSigned(v){ const n = Number(String(v).replace('−', '-')); return isFinite(n) ? (n > 0 ? '+' : n < 0 ? '−' : '')", "function edgeSigned(v){ const n = Number(String(v).replace('−', '-')); return isFinite(n) ? (n > 0 ? '+' : n < 0 ? '-' : '')"],
  ['movers: share of the net, not of every move', "const share = all > 0 ? Math.round(t3 / all * 100) + '%' : '—';", "const share = all > 0 ? Math.round(t3 / Math.abs((e.stage2.totalDeltaP1 || 0) * 100) * 100) + '%' : '—';"],
  ['movers: Upgrade to Pro back', "<div class=\"sm-ic\"><div class=\"sm-cs\"><span></span><span>Layer</span>", "<a class=\"sf-upgrade\">Upgrade to Pro</a><div class=\"sm-ic\"><div class=\"sm-cs\"><span></span><span>Layer</span>"],
  ['b105: the cut not removed', "p1: sp.p1 / EDGE_B105_K, p2: sp.p2 / EDGE_B105_K,", "p1: sp.p1, p2: sp.p2,"],
  ['b105: a different K', "const EDGE_B105_K = 0.9956;", "const EDGE_B105_K = 0.98;"],
  ['b105: a stale stream still priced', "function edgeB105Cell(bl, s){ return bl && bl.live ? mxOddsTxt(bl[s]) : '—'; }", "function edgeB105Cell(bl, s){ return bl ? mxOddsTxt(bl[s]) : '—'; }"],
  ['b105: gap from the base, not the adjusted fair', "const b105Gap = s => { const g = edgeB105Gap(b105, s, prob(s));", "const b105Gap = s => { const g = edgeB105Gap(b105, s, (e.stage1 || {})['base' + s.toUpperCase()]);"],
  ['b105: a started match still gets a line', "  if (isFinite(st) && Date.now() >= st) return null;\n  const sp = K.pairFor(m, 'bet105');", "  const sp = K.pairFor(m, 'bet105');"],
  ['b105: the newer side’s time', "new Date(Math.min(ts[0], ts[1])).toISOString()", "new Date(Math.max(ts[0], ts[1])).toISOString()"],
  ['b105: repaint re-renders the page', "  const c = edgeB105Ctx; if (!c || c.id !== edgeCurrentId) return;", "  const c = edgeB105Ctx; if (!c || c.id !== edgeCurrentId) return; renderEdgeModel(edgeCurrentId);"],
  ['b105: pop-up ledger on the raw price', "rows = raw.filter(r => r.price >= 1.01).map(r => ({ at: r.at, price: r.price / EDGE_B105_K }));", "rows = raw.filter(r => r.price >= 1.01).map(r => ({ at: r.at, price: r.price }));"],
  ['b105: pop-up never opens above', "const up = r.bottom + 400 > vh && r.top > 400;", "const up = false;"],
  ['b105: the derived line leaks outside the Model block', "// Form cell for the FORM column.", "const EDGE_B105_K_COPY = 1; // Form cell for the FORM column."],
  ['anchor: stale gate off', "const EDGE_PIN_STALE_MIN = 120;", "const EDGE_PIN_STALE_MIN = null;"],
  ['anchor: stale gate at 60', "const EDGE_PIN_STALE_MIN = 120;", "const EDGE_PIN_STALE_MIN = 60;"],
  ['gate: a state-3 match priced', "const stateConfirmed = gateState === 2 && hoursToStart != null && hoursToStart > 0 && hoursToStart <= 30;", "const stateConfirmed = hoursToStart != null && hoursToStart > 0 && hoursToStart <= 30;"],
  ['analysis: the off switch ignored', "  if (!edgeAnalysisOn()) return '';\n", "\n"],
  ['look: a raw colour in the page CSS', ".sm-card{ background:var(--sm-card);", ".sm-card{ background:#0E1019;"],
  ['look: player one ring white', ".sm-av.a{ box-shadow:0 0 0 2px var(--sm-blue); }", ".sm-av.a{ box-shadow:0 0 0 2px var(--sm-text); }"],
  ['look: names link-blue', ".sm-plink{ cursor:pointer; color:var(--sm-text) !important;", ".sm-plink{ cursor:pointer; color:var(--sm-blue) !important;"],
  ['generator: the page rule drifts from summary.js', "  return Object.keys((m && m.bookNow) || {}).filter(k => k !== 'Pncl'", "  return Object.keys((m && m.bookOpens) || {}).filter(k => k !== 'Pncl'"],
];
const SUITES = ['test-ten418-model.mjs'];
const run = env => spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, env), encoding: 'utf8', timeout: 60000 });
// Control: the unmutated file must pass, or every "caught" below means nothing.
if (run({}).status !== 0) { console.error('✖ the suite is red on the unmutated file — mutants are meaningless'); process.exit(1); }
console.log('✔ control: the unmutated file passes');
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten418-mut-'));
for (const [name, from, to] of MUTANTS) {
  if (src.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, src.replace(from, to));
  if (run({ TEN418_HTML: file }).status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
