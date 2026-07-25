// Ad-hoc validation harness for h2h-model Layer #7 (quality-adjusted career form).
// Resolves real players from the live data layer, runs qualityForm(ctx) on
// hand-picked matchups, and prints the per-player deviations, sample dampening,
// surface signal, and final deltaP1 so the layer's behaviour can be checked by
// hand against career-splits q7. Not shipped in the pipeline — a dev harness.
const data = require('../h2h-model/data');
const { qualityForm } = require('../h2h-model/adjustments');
const config = require('../h2h-model/config');
const c = config.adjustments.qualityForm;
const W = c.recencyWeights;

function wr(b) { // recency-weighted WR + raw M, for hand-checking
  let n = 0, d = 0, M = 0;
  for (let e = 0; e < 3; e++) { const m = b[e*2]||0, w = b[e*2+1]||0; d += W[e]*m; n += W[e]*w; M += m; }
  return { wr: d > 0 ? n/d : null, M };
}
function damp(M) { for (const [f, k] of c.dampTiers) if (M >= f) return k; return 0; }

// [p1Key, p2Key, surface, note]
const MATCHUPS = [
  [1905, 2382, 'Grass', 'Djokovic vs Alcaraz — both full sample; surface signal fires'],
  [2832, 2973, 'Grass', 'Fritz vs Shelton — Shelton Grass top50=10 -> Signal B damped 0.4'],
  [2849, 430,  'Grass', 'Musetti vs Ruud — Ruud Grass top50=3 (<floor 10) -> Signal B self-hides'],
  [372,  1852, 'Hard',  'Cobolli vs Vacherot — Vacherot career top50=29 -> Signal A damped 0.7'],
];

console.log(`Layer #7 config: maxMag=${c.maxMagnitude} weightA/B=${c.weightA}/${c.weightB} `
  + `recency=[${W}] dampTiers=${JSON.stringify(c.dampTiers)} surfaceFloorM=${c.surfaceFloorM} scale=${c.signalScale}\n`);

for (const [k1, k2, surface, note] of MATCHUPS) {
  const p1 = data.resolvePlayer(k1, null), p2 = data.resolvePlayer(k2, null);
  const ctx = { p1, p2, surface, match: { surface } };
  const r = qualityForm(ctx);
  console.log('='.repeat(78));
  console.log(`${p1.fullName}  vs  ${p2.fullName}   [${surface}]`);
  console.log(`  ${note}`);
  for (const [tag, p] of [['P1', p1], ['P2', p2]]) {
    const q = p.splits.q7;
    const ov = wr(q.overall), t50 = wr(q.top50);
    const cat = surface;
    const sb = q.surf50[cat];
    const su = sb ? wr(sb) : { wr: null, M: 0 };
    const devA = t50.wr - ov.wr;
    const devB = (su.wr != null && su.M >= c.surfaceFloorM) ? su.wr - t50.wr : 0;
    const pp = x => `${x>=0?'+':''}${(x*100).toFixed(1)}pp`;
    console.log(`  ${tag} ${p.fullName}`);
    console.log(`     overall WR ${(ov.wr*100).toFixed(1)}%  | top50 WR ${(t50.wr*100).toFixed(1)}% (M=${t50.M}, dampA=${damp(t50.M)})`);
    console.log(`     Signal A devA=${pp(devA)}  x dampA=${damp(t50.M)}  => ${pp(devA*damp(t50.M))}` + (t50.M < c.dampTiers[c.dampTiers.length-1][0] ? '  [THIN <10 -> flagged]' : ''));
    console.log(`     ${cat} top50 WR ${su.wr!=null?(su.wr*100).toFixed(1)+'%':'--'} (M=${su.M})  | Signal B devB=${pp(devB)}  x dampB=${su.M>=c.surfaceFloorM?damp(su.M):0}  => ${pp(devB*(su.M>=c.surfaceFloorM?damp(su.M):0))}` + (!(su.M>=c.surfaceFloorM) ? `  [surface M<${c.surfaceFloorM} -> B self-hides]` : ''));
  }
  console.log(`  LAYER OUTPUT: applied=${r.applied} dir=${r.direction} signal=${r.signal} deltaP1=${r.deltaP1} (${(r.deltaP1*100).toFixed(2)}pp) conf=${r.confidence} flag=${r.qualityFlag}`);
  console.log(`  detail: ${r.detail}`);
}
