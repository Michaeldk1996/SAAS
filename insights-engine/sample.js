/* Sample report for the reworked Key Insights engine.
 *
 * Runs the engine over the shipped data files exactly as the browser will, and
 * prints the three cards each player would see. The spec requires this report
 * across >=10 players spanning archetypes and ranking tiers BEFORE the UI is
 * wired, so this is the artefact that gate hangs on.
 *
 *   node insights-engine/sample.js            # the curated spanning sample
 *   node insights-engine/sample.js --all      # every player, coverage stats
 */
const fs = require('fs');
const path = require('path');
const E = require('./engine.js');

const ROOT = path.join(__dirname, '..');
const rd = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

const splits = rd('career-splits.json').players;
const stylesFile = rd('playing-styles.json');
const styles = stylesFile.players || [];
const oddsIdx = rd('odds-performance-index.json');
const marketTour = oddsIdx.tourBaseline || null;   // null until the builder publishes it

// career-splits carries "Carlos Alcaraz", playing-styles carries "C. Alcaraz",
// so the join is the dashboard's own styleKey(): lastname|first-initial, accent
// folded. Replicated here so the sample and the page agree on who is who.
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.'-]/g, ' ');
function styleKey(name) {
  const p = norm(name).split(' ').filter(Boolean);
  return p.length < 2 ? null : p[p.length - 1] + '|' + p[0][0];
}
const styleByKey = {};
styles.forEach(s => { const k = styleKey(s.name); if (k) styleByKey[k] = s; });

function marketFor(key) {
  const p = path.join(ROOT, 'odds-performance', key + '.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

function run(key) {
  const sp = splits[key];
  if (!sp) return null;
  const name = sp.fullName || sp.name || key;
  const st = styleByKey[styleKey(name)] || null;
  const cards = E.ppDynamicInsights(
    key, name, splits, st, [], marketFor(key), marketTour, stylesFile.tourAverage
  );
  return { key, name, rank: st && st.rank, archetype: st && st.archetype_label, cards };
}

const keys = Object.keys(splits);

if (process.argv.includes('--all')) {
  let three = 0, counts = {}, checkFreq = {}, withMarket = 0;
  keys.forEach(k => {
    const r = run(k);
    if (!r) return;
    counts[r.cards.length] = (counts[r.cards.length] || 0) + 1;
    if (r.cards.length >= 3) three++;
    r.cards.forEach(c => { checkFreq[c.check] = (checkFreq[c.check] || 0) + 1; });
    if (r.cards.some(c => c.check === 'market')) withMarket++;
  });
  console.log('players:', keys.length, ' with 3 cards:', three, ' market card shown:', withMarket);
  console.log('cards-per-player:', JSON.stringify(counts));
  console.log('check frequency:', JSON.stringify(checkFreq, null, 1));
  process.exit(0);
}

// Curated spanning sample: ranking tiers top-5 / 6-20 / 21-50 / 51-100 / 100+,
// and deliberately mixed archetypes.
const want = ['C. Alcaraz', 'J. Sinner', 'N. Djokovic', 'A. Zverev', 'T. Fritz',
              'G. Mpetshi Perricard', 'A. Bublik', 'F. Cobolli', 'A. Davidovich Fokina',
              'S. Baez', 'T. Etcheverry', 'J. Thompson', 'R. Collignon', 'M. Giron'];

const byName = {};
keys.forEach(k => { const n = splits[k].fullName; if (n) byName[styleKey(n)] = k; });

want.forEach(n => {
  const k = byName[styleKey(n)];
  if (!k) { console.log('\n### ' + n + ' — NOT IN career-splits\n'); return; }
  const r = run(k);
  console.log('\n### ' + r.name + '  (rank ' + (r.rank || '?') + ', ' + (r.archetype || 'unclassified') +
              ', key ' + r.key + ')');
  if (!r.cards.length) { console.log('   — no findings —'); return; }
  r.cards.forEach((c, i) => {
    console.log(' ' + (i + 1) + '. [' + c.check + '/' + c.accent + '  ratio ' + c.ratio.toFixed(2) + '] ' + c.title);
    console.log('    ' + c.text);
  });
});
