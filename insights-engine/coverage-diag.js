/* TEN-8 coverage diagnostic — why do 92 of 233 players get no dynamic card?
 *
 * Loads engine.js into this context so the INTERNAL check functions are
 * reachable, then for every player and every check records one of:
 *   'fired'     — the check produced a finding
 *   'floor'     — blocked by an INS_MIN sample floor (a DATA problem)
 *   'threshold' — sample was sufficient, gap was below INS_THRESH*relax
 *                 (a THRESHOLD DECISION, not a data problem)
 *   'nodata'    — the underlying split row does not exist at all
 *
 * The floor/threshold split is the whole point: it decides whether widening
 * coverage means lowering a bar or finding more matches.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
vm.runInThisContext(src);   // `module` is not global here, so the exports tail is skipped

const splitsFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'career-splits.json'), 'utf8'));
const splits = splitsFile.players || splitsFile;
const styles = JSON.parse(fs.readFileSync(path.join(ROOT, 'playing-styles.json'), 'utf8'));
const styleTourAverage = styles.tourAverage;

// Mirror the dashboard EXACTLY: styles are keyed by "lastname|firstinitial"
// (styleKey/ppStyleFor at bsp-consult-dashboard.html:6693), NOT by profile key.
// Keying by profile key silently returns null for all 233 and fakes a
// data-absence result for the radar check.
// psEloNorm, bsp-consult-dashboard.html:1996 — the hyphen/dot collapse matters:
// "F. Auger-Aliassime" and "Felix Auger-Aliassime" must both key to "aliassime|f".
function psEloNorm(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['’]/g, '').replace(/[.\-]/g, ' ').replace(/\s+/g, ' ').trim();
}
function styleKey(name) {
  const p = psEloNorm(name).split(' ').filter(Boolean);
  return p.length < 2 ? null : p[p.length - 1] + '|' + p[0][0];
}
const styleByKey = {};
(styles.players || []).forEach(pl => { const k = styleKey(pl.name); if (k) styleByKey[k] = pl; });
const styleFor = name => { const k = styleKey(name); return k ? (styleByKey[k] || null) : null; };

// Market shards are per-player files; load whatever exists on disk.
const oddsDir = path.join(ROOT, 'odds-performance');
const oddsIndex = fs.existsSync(path.join(ROOT, 'odds-performance-index.json'))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, 'odds-performance-index.json'), 'utf8')) : {};
function loadMarket(key) {
  const f = path.join(oddsDir, String(key) + '.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

const keys = Object.keys(splits);
const RELAX_FLOOR = 0.6;   // the loosest the shipped selector ever goes

// --- per-check sample-sufficiency probes, mirroring each check's own guards ---
const SUFFICIENT = {
  format(sp) {
    const b3 = insRow(sp.career, 'Best of 3'), b5 = insRow(sp.career, 'Best of 5');
    if (!b3 || !b5) return 'nodata';
    return (b3.M >= INS_MIN.format && b5.M >= INS_MIN.format) ? 'ok' : 'floor';
  },
  surface(sp) {
    const rows = ['Hard', 'Clay', 'Grass', 'Carpet'].map(s => insRow(sp.career, s)).filter(Boolean);
    if (rows.length < 2) return 'nodata';
    return rows.filter(r => r.M >= INS_MIN.surface).length >= 2 ? 'ok' : 'floor';
  },
  level(sp, ctx) {
    if (!ctx.overall || ctx.overall.M < INS_MIN.overall) return 'floor';
    const rows = ['Grand Slams', 'Masters', 'Other Tours'].map(l => insRow(sp.career, l)).filter(Boolean);
    if (!rows.length) return 'nodata';
    return rows.some(r => r.M >= INS_MIN.level) ? 'ok' : 'floor';
  },
  top10(sp, ctx) {
    const r = insRow(sp.career, 'vs. Top 10');
    if (!r) return 'nodata';
    if (!ctx.overall || ctx.overall.M < INS_MIN.overall) return 'floor';
    return r.M >= INS_MIN.top10 ? 'ok' : 'floor';
  },
  radar(sp, ctx) {
    const st = ctx.style;
    if (!st || !st.archetype_scores) return 'nodata';
    return Object.keys(st.archetype_scores).length >= 2 ? 'ok' : 'floor';
  },
  trend(sp, ctx) {
    const l52 = insOverall(sp.last52 || {});   // same accessor insCheckTrend uses
    if (!l52 || !l52.M) return 'nodata';
    if (!ctx.overall || ctx.overall.M < INS_MIN.overall) return 'floor';
    return l52.M >= INS_MIN.last52 ? 'ok' : 'floor';
  },
  hand(sp) {
    const lf = insRow(sp.career, 'vs. Lefties'), rt = insRow(sp.career, 'vs. Righties');
    if (!lf || !rt) return 'nodata';
    return (lf.M >= INS_MIN.hand && rt.M >= INS_MIN.hand) ? 'ok' : 'floor';
  },
  market(sp, ctx) {
    const m = ctx.market;
    if (!m) return 'nodata';
    // same splits insCheckMarket scans: overall, byRole, bySurface
    const recs = [m.overall,
      m.byRole && m.byRole.underdog, m.byRole && m.byRole.favourite,
      ...(m.bySurface ? Object.values(m.bySurface) : [])]
      .filter(r => r && typeof r.vsMarket === 'number');
    if (!recs.length) return 'nodata';
    return recs.some(r => r.matches >= INS_MIN.market) ? 'ok' : 'floor';
  }
};

const CHECKS = [
  ['format', insCheckFormat], ['surface', insCheckSurface], ['level', insCheckLevel],
  ['top10', insCheckTop10], ['radar', insCheckRadar], ['trend', insCheckTrend],
  ['hand', insCheckHand], ['market', insCheckMarket]
];

const rows = [];
for (const key of keys) {
  const sp = splits[key];
  if (!sp || !sp.career) { rows.push({ key, cards: 0, nosplits: true, why: {} }); continue; }
  const styleRec = styleFor(sp.fullName);
  const market = loadMarket(key);
  const ctx = {
    overall: insOverall(sp.career),
    tour: insTourAverages(splits),
    tourOverall: insTourOverall(splits),
    shape: insTourShape(splits),
    style: styleRec,
    styleTourAverage: styleTourAverage,
    market: market || null,
    marketTour: oddsIndex.tourBaseline || null,
    marketAsOf: oddsIndex.archiveLatest || null,
    last: 'He'
  };
  const why = {};
  let fired = 0;
  for (const [name, fn] of CHECKS) {
    let f = null;
    try { f = fn(sp, ctx, RELAX_FLOOR); } catch (e) { why[name] = 'error:' + e.message; continue; }
    if (f) { why[name] = 'fired'; fired++; continue; }
    let suf = 'ok';
    try { suf = SUFFICIENT[name] ? SUFFICIENT[name](sp, ctx) : 'ok'; } catch (e) { suf = 'error'; }
    why[name] = suf === 'ok' ? 'threshold' : suf;
  }
  // what the shipped selector actually renders (no pipeline top-up)
  const picked = ppDynamicInsights(key, sp.fullName || '', splits, styleRec, [], market,
    oddsIndex.tourBaseline, styleTourAverage, oddsIndex.archiveLatest)
    .filter(c => c.source !== 'pipeline');
  rows.push({ key, name: sp.fullName || key, cards: picked.length, firedChecks: fired, why });
}

// ---------------- report ----------------
const zero = rows.filter(r => r.cards === 0);
const tally = {};
for (const [n] of CHECKS) tally[n] = { fired: 0, threshold: 0, floor: 0, nodata: 0, error: 0 };
for (const r of zero) {
  for (const [n] of CHECKS) {
    const v = (r.why[n] || 'nodata').split(':')[0];
    if (tally[n][v] !== undefined) tally[n][v]++; else tally[n].error++;
  }
}

// --- sanity: prove the joins actually resolved before trusting any absence ---
const joinedStyle = keys.filter(k => splits[k] && styleFor(splits[k].fullName)).length;
const joinedMarket = keys.filter(k => loadMarket(k)).length;
console.log('SANITY  style recs joined :', joinedStyle, '/', keys.length);
console.log('SANITY  market shards on disk for split players :', joinedMarket, '/', keys.length);
if (joinedStyle === 0 || joinedMarket === 0) {
  console.log('!! a join resolved to zero — absence numbers below are harness artefacts, not data');
}
console.log('');
console.log('players in career-splits :', rows.length);
console.log('with >=1 dynamic card    :', rows.filter(r => r.cards > 0).length);
console.log('with ZERO dynamic cards  :', zero.length);
console.log('  (3 cards)              :', rows.filter(r => r.cards >= 3).length);
console.log('\nAmong the ZERO-card players, per check — why nothing fired:');
console.log('check      fired  threshold   floor  nodata');
for (const [n] of CHECKS) {
  const t = tally[n];
  console.log(n.padEnd(10),
    String(t.fired).padStart(5), String(t.threshold).padStart(10),
    String(t.floor).padStart(7), String(t.nodata).padStart(7));
}

// Headline question: is a zero-card player blocked by floors or by thresholds?
let anyThreshold = 0, allBlocked = 0;
for (const r of zero) {
  const vals = CHECKS.map(([n]) => (r.why[n] || '').split(':')[0]);
  if (vals.includes('threshold')) anyThreshold++; else allBlocked++;
}
console.log('\nZero-card players with at least one check that had ENOUGH sample');
console.log('but fell under threshold (a threshold decision):', anyThreshold);
console.log('Zero-card players where EVERY check lacked sample (a data problem):', allBlocked);

console.log('\nCareer match counts of the zero-card players:');
const ms = zero.map(r => { const sp = splits[r.key]; return sp && sp.career ? insOverall(sp.career).M : 0; })
  .sort((a, b) => a - b);
if (ms.length) {
  const q = p => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
  console.log('  min', ms[0], ' p25', q(.25), ' median', q(.5), ' p75', q(.75), ' max', ms[ms.length - 1]);
  console.log('  under the overall floor of ' + INS_MIN.overall + ':', ms.filter(m => m < INS_MIN.overall).length);
}
fs.writeFileSync('/tmp/ten8-cov-diag.json', JSON.stringify({ rows, tally }, null, 1));
console.log('\nfull per-player detail -> /tmp/ten8-cov-diag.json');
