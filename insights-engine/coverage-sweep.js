/* TEN-8 — would lowering the floors actually buy coverage, and at what cost?
 *
 * The diagnostic says 87 of the 92 zero-card players sit under INS_MIN.overall
 * (30 career matches), median 10. So this sweeps the floors downward and counts
 * (a) how many of the 92 gain a card, (b) what sample those new cards rest on.
 * A card built on 6 matches is not coverage, it is a fabricated claim.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8'));

const splits = JSON.parse(fs.readFileSync(path.join(ROOT, 'career-splits.json'), 'utf8')).players;
const styles = JSON.parse(fs.readFileSync(path.join(ROOT, 'playing-styles.json'), 'utf8'));
const oddsIndex = JSON.parse(fs.readFileSync(path.join(ROOT, 'odds-performance-index.json'), 'utf8'));
function psEloNorm(n) {
  return String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’]/g, '').replace(/[.\-]/g, ' ').replace(/\s+/g, ' ').trim();
}
function sKey(n) { const p = psEloNorm(n).split(' ').filter(Boolean); return p.length < 2 ? null : p[p.length - 1] + '|' + p[0][0]; }
const byKey = {}; (styles.players || []).forEach(p => { const k = sKey(p.name); if (k) byKey[k] = p; });
const styleFor = n => byKey[sKey(n)] || null;
const mkt = k => { const f = path.join(ROOT, 'odds-performance', k + '.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };

const keys = Object.keys(splits);
const ORIG = JSON.parse(JSON.stringify(INS_MIN));

function countCards() {
  const out = [];
  for (const k of keys) {
    const sp = splits[k]; if (!sp || !sp.career) continue;
    const picked = ppDynamicInsights(k, sp.fullName || '', splits, styleFor(sp.fullName), [],
      mkt(k), oddsIndex.tourBaseline, styles.tourAverage, oddsIndex.archiveLatest)
      .filter(c => c.source !== 'pipeline');
    out.push({ k, name: sp.fullName, rank: sp.rank, M: insOverall(sp.career).M, cards: picked.length, picked });
  }
  return out;
}

const base = countCards();
const zeroKeys = new Set(base.filter(r => r.cards === 0).map(r => r.k));
console.log('baseline: ' + zeroKeys.size + ' of ' + base.length + ' players with no dynamic card\n');

console.log('Rank distribution of the 92 (career-splits rank field):');
const ranks = base.filter(r => zeroKeys.has(r.k)).map(r => r.rank).filter(r => typeof r === 'number').sort((a, b) => a - b);
console.log('  n with rank:', ranks.length, ' min', ranks[0], ' median', ranks[Math.floor(ranks.length / 2)], ' max', ranks[ranks.length - 1]);
const covered = base.filter(r => !zeroKeys.has(r.k)).map(r => r.rank).filter(r => typeof r === 'number').sort((a, b) => a - b);
console.log('  covered players  median rank', covered[Math.floor(covered.length / 2)], '\n');

// --- sweep: scale every floor down together ---
console.log('scale  overallFloor  recovered/92  median sample behind the NEW cards');
for (const scale of [1, 0.8, 0.66, 0.5, 0.4, 0.33]) {
  for (const k of Object.keys(ORIG)) INS_MIN[k] = Math.max(3, Math.round(ORIG[k] * scale));
  const now = countCards();
  const gained = now.filter(r => zeroKeys.has(r.k) && r.cards > 0);
  const samples = gained.map(r => r.M).sort((a, b) => a - b);
  console.log(
    String(scale).padEnd(6),
    String(INS_MIN.overall).padStart(12),
    String(gained.length).padStart(13),
    String(samples.length ? samples[Math.floor(samples.length / 2)] : '-').padStart(20),
    samples.length ? ' (min ' + samples[0] + ', max ' + samples[samples.length - 1] + ' career matches)' : ''
  );
}
for (const k of Object.keys(ORIG)) INS_MIN[k] = ORIG[k];

// --- what the thinnest recovered card would actually SAY ---
for (const k of Object.keys(ORIG)) INS_MIN[k] = Math.max(3, Math.round(ORIG[k] * 0.5));
const half = countCards().filter(r => zeroKeys.has(r.k) && r.cards > 0).sort((a, b) => a.M - b.M);
console.log('\nAt scale 0.5, the three thinnest players who would gain a card:');
half.slice(0, 3).forEach(r => {
  console.log('  ' + r.name + '  (' + r.M + ' career matches, rank ' + r.rank + ')');
  r.picked.forEach(c => console.log('      [' + c.check + '] ' + c.title + ' — ' + c.text.slice(0, 150)));
});
for (const k of Object.keys(ORIG)) INS_MIN[k] = ORIG[k];
