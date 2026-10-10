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
  ['prices: bet365 ahead of Pinnacle', "const EDGE_SHARP = [['Pncl', 'Pinnacle'], ['bet365', 'bet365']];", "const EDGE_SHARP = [['bet365', 'bet365'], ['Pncl', 'Pinnacle']];"],
  ['prices: best soft scans Pinnacle too', "filter(k => k !== 'Pncl' && k !== sk && edgeQuote(m.bookNow, k));", "filter(k => k !== sk && edgeQuote(m.bookNow, k));"],
  ['prices: move on the unrounded quotes', "const mv = (typeof mxMovePct === 'function') ? mxMovePct(o, n) : null;", "const mv = (o > 0 && n > 0) ? { dir: n > o ? 'pos' : 'neg', text: ((n / o - 1) * 100).toFixed(2) + '%' } : null;"],
  ['fair price: an odd of 1.00 or below is priced', "return (isFinite(v) && v > 1) ? v : null;", "return (isFinite(v) && v > 0) ? v : null;"],
  ['fair price: gap against the no-vig price', "function edgeGapOf(prob, odd){ return (prob == null || odd == null) ? null : (prob - 1 / odd) * 100; }", "function edgeGapOf(prob, odd){ return (prob == null || odd == null) ? null : (prob - 1 / odd / 1.03) * 100; }"],
  ['layers: rows by shift, not weight', "}).sort((x, y) => (x.w.rank - y.w.rank) || (y.mag - x.mag));", "}).sort((x, y) => (y.mag - x.mag));"],
  ['layers: a gated layer reads Poor', "  return a.gated ? 'partial' : 'missing';\n}", "  return 'missing';\n}"],
  ['layers: strip jump uses scrollIntoView', "(sc === window ? window : sc).scrollBy({ top, behavior: 'smooth' });", "el.scrollIntoView({ block: 'center', behavior: 'smooth' });"],
  ['layers: breakdown open on load', "let edgeLayersOpen = false;", "let edgeLayersOpen = true;"],
  ['pro: Upgrade line shown on Pro too', "${free ? '<div class=\"em-mv-up\">", "${true ? '<div class=\"em-mv-up\">"],
  ['pro: Free sees the whole analysis', "const list = free ? paras.slice(0, 2) : paras;", "const list = paras;"],
  ['analysis: shown with a disclaimer when the run has none', "if (!(sum && sum.ok && sum.text)) return '';", "if (!(sum && sum.ok && sum.text)) return '<div class=\"em-card\">Stennisfy Analysis is not available yet.</div>';"],
  ['analysis: stamp is the clock', "const stamp = st === 'shown' ? edgeClock(sum.generatedAt) : null;", "const stamp = st === 'shown' ? edgeClock(new Date().toISOString()) : null;"],
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
