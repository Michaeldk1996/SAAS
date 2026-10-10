// TEN-418 step 12 (Stennisfy Model) — every check in test-ten418-model.mjs must FAIL when its rule is reverted or bent.
// Each mutant is applied to a copy of bsp-consult-dashboard.html (TEN418_HTML) and the suite runs against it; a mutant
// that leaves it green is a vacuous test and fails this runner. Anchors occur exactly once.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
  ['header: Updated reads the clock', "const at = e.generatedAt || (modelOutput && modelOutput.generatedAt);", "const at = new Date().toISOString();"],
  ['header: the layer count is a fixed 17', "sub.textContent = total ? `Fair prices from ${total} weighted layers", "sub.textContent = total ? `Fair prices from 17 weighted layers"],
  ['rail: reads every match, not the board list', "  const all = (typeof getFiltered === 'function') ? getFiltered() : matches;\n  const order = [], by = {};", "  const all = matches;\n  const order = [], by = {};"],
  ['rail: raw feed tournament name', "options: [{ value: 'all', label: 'All tournaments' }].concat(order.map(t => ({ value: t, label: edgeEventName(t) }))) });", "options: [{ value: 'all', label: 'All tournaments' }].concat(order.map(t => ({ value: t, label: t }))) });"],
  ['names: feed spelling instead of the shared formatter', "return (typeof newsPlayerName === 'function') ? newsPlayerName(key, feed) : String(feed || '');", "return String(feed || '');"],
  ['styles: a second label set (engine archetype)', "const style = edgeStyleName(name, key);", "const style = P.archetype || null;"],
  ['prices: Bet365 ahead of Pinnacle', "const EDGE_SHARP = [['Pncl', 'Pinnacle'], ['bet365', 'Bet365']];", "const EDGE_SHARP = [['bet365', 'Bet365'], ['Pncl', 'Pinnacle']];"],
  ['prices: best soft scans Pinnacle too', "filter(k => k !== 'Pncl' && k !== sk && edgeQuote(m.bookNow, k));", "filter(k => k !== sk && edgeQuote(m.bookNow, k));"],
  ['prices: move on the unrounded quotes', "const mv = (typeof mxMovePct === 'function') ? mxMovePct(o, n) : null;", "const mv = (o > 0 && n > 0) ? { dir: n > o ? 'pos' : 'neg', text: ((n / o - 1) * 100).toFixed(2) + '%' } : null;"],
  ['fair price: an odd of 1.00 or below is priced', "return (isFinite(v) && v > 1) ? v : null;", "return (isFinite(v) && v > 0) ? v : null;"],
  ['fair price: gap from the unrounded fair (R1 fix 6)', "function edgeGapOf(prob, odd){ return (prob == null || odd == null) ? null : Math.round(prob * 1000) / 10 - 100 / odd; }", "function edgeGapOf(prob, odd){ return (prob == null || odd == null) ? null : prob * 100 - 100 / odd; }"],
  ['layers: rows by shift, not weight', "}).sort((x, y) => (x.w.rank - y.w.rank) || (y.mag - x.mag));", "}).sort((x, y) => (y.mag - x.mag));"],
  ['layers: a gated layer reads Poor', "  return (a.gated || edgeNotThisFormat(a)) ? 'partial' : 'missing';\n}", "  return 'missing';\n}"],
  ['layers: strip jump uses scrollIntoView', "(sc === window ? window : sc).scrollBy({ top, behavior: 'smooth' });", "el.scrollIntoView({ block: 'center', behavior: 'smooth' });"],
  ['layers: breakdown open on load', "let edgeLayersOpen = false;", "let edgeLayersOpen = true;"],
  ['pro: Upgrade line shown on Pro too', "${free ? '<div class=\"em-mv-up\">", "${true ? '<div class=\"em-mv-up\">"],
  ['pro: Free sees the whole analysis', "const list = free ? paras.slice(0, 1) : paras;", "const list = paras;"],
  ['analysis: the off switch ignored', "  if (!edgeAnalysisOn()) return '';\n", "\n"],
  ['analysis: Free can generate', "  if (free && !has) return '';", "  if (false && !has) return '';"],
  ['analysis: Regenerate + stamp for Free', "${st === 'shown' && !free ? `<a class=\"em-link em-ai-regen\"", "${st === 'shown' ? `<a class=\"em-link em-ai-regen\""],
  ['analysis: a failed generate hides the section', "edgeAiState[id] = (x && x.summary && x.summary.ok && x.summary.text) ? 'shown' : 'failed';", "edgeAiState[id] = 'shown';"],
  ['analysis: stamp is the clock', "const stamp = (st === 'shown' && !free) ? edgeClock(sum.generatedAt) : null;", "const stamp = (st === 'shown' && !free) ? edgeClock(new Date().toISOString()) : null;"],
  ['R1 fix 1: format split hidden again (13 layers)', "function edgeVisibleAdjs(list){ return (list || []).slice(); }", "function edgeVisibleAdjs(list){ return (list || []).filter(a => !a.hidden); }"],
  ['R1 fix 2: normalised scores back in the player columns', "      const sa = fig ? fig[0] : '—', sb = fig ? fig[1] : '—';", "      const sa = applied ? Math.abs(signal).toFixed(2) : '—', sb = applied ? '0.00' : '—';"],
  ['R1 fix 3: engine shorthand back in the Why', "    case 'surface':\n      if ((x = /^(\\w+) record", "    case 'surfaceX':\n      if ((x = /^(\\w+) record"],
  ['R1 fix 3: Data quality says a different state', "  if (q === 'Good') return 'The inputs behind this layer are complete for both players in this match.';", "  if (q === 'Good') return 'Applied: the engine rates the sample behind this layer medium for this match.';"],
  ['R1 fix 4: style matchup ignores the Playing Styles cell', "edgeNumHtml(a.key === 'styleMatchup' && !applied ? edgeStyleWhy(names, keys) : edgeWhyText(a, names))", "edgeNumHtml(edgeWhyText(a, names))"],
  ['R1 fix 4: two names for the manual layer', "const EDGE_LAYER_NAMES = { subjective: 'Manual context' };", "const EDGE_LAYER_NAMES = {};"],
  ['R1 fix 5: note margin from the now quote', "    .map(b => `<span class=\"em-mono\">${edgeMargin(b.open)}</span> (${edgeEsc(b.name)})`).join(' / ');", "    .map(b => `<span class=\"em-mono\">${edgeMargin(b.now)}</span> (${edgeEsc(b.name)})`).join(' / ');"],
  ['R1 fix 7: bet365 lower case', "  if (l === 'bet365') return 'Bet365';", "  if (l === 'bet365') return 'bet365';"],
  ['R1 fix 8: ELO capitals', "<span class=\"em-mono\">Elo ${edgeEsc(P.eloAll)}</span>", "<span class=\"em-mono\">ELO ${edgeEsc(P.eloAll)}</span>"],
  ['R1 fix 14: Model base shown without a model', "        ${noModel ? '' : `<div class=\"em-mk-base\">", "        ${false ? '' : `<div class=\"em-mk-base\">"],
  ['review: an even row reads No data / Poor', "  if (edgeEven(a)) return 'full';\n", ""],
  ['review: styles known still read No data', "    const off = !a.applied && a.key === 'styleMatchup' && names && edgeStylesKnown(names, keys);", "    const off = false;"],
  ['gate: a state-3 match priced', "const stateConfirmed = gateState === 2 && hoursToStart != null && hoursToStart > 0 && hoursToStart <= 30;", "const stateConfirmed = hoursToStart != null && hoursToStart > 0 && hoursToStart <= 30;"],
  ['data: "sample data" note back', "· shift = movement of the fair price in percentage points</span>", "· shift = movement of the fair price in percentage points · sample data</span>"],
  ['colour: player names link-blue', ".em-plink{ color:var(--text); text-decoration:none; cursor:pointer; }", ".em-plink{ color:var(--link); text-decoration:none; cursor:pointer; }"],
  ['colour: blue focus ring on the odd inputs', ".em-odd:focus, .em-odd:focus-visible{ border-color:var(--edge-16); outline:none; box-shadow:none; }", ".em-odd:focus, .em-odd:focus-visible{ border-color:var(--edge-16); outline:2px solid var(--bar); box-shadow:none; }"],
  ['generator: the page rule drifts from summary.js', "  return Object.keys((m && m.bookNow) || {}).filter(k => k !== 'Pncl'", "  return Object.keys((m && m.bookOpens) || {}).filter(k => k !== 'Pncl'"],
  ['analysis: Regenerate swaps in a run without this match’s analysis', "if (x && x.ok && x.summary && x.summary.ok && x.summary.text){ modelOutput = d; modelOutputLoaded = true; }", "if (d && d.matches){ modelOutput = d; modelOutputLoaded = true; }"],
  ['prices: Pinnacle chosen with no price now', "return all.find(b => b.now) || all.find(b => b.open) || null;", "return all.find(b => b.now || b.open) || null;"],
  ['prices: the sharp book also scanned as soft', "filter(k => k !== 'Pncl' && k !== sk && edgeQuote(m.bookNow, k));", "filter(k => k !== 'Pncl' && edgeQuote(m.bookNow, k));"],
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
