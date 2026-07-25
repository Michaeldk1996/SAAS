'use strict';
const path=require('path');
const HM=__dirname;
const { h2h, setDominance }=require(path.join(HM,'adjustments'));
const cfg=require(path.join(HM,'config'));
const MAG=cfg.adjustments.h2h.maxMagnitude; // 0.025
const NOW='2026-07-25';
// helper: build a ctx with meetings
function ctx(surface, meetings){ return { surface, match:{ date:NOW, h2h:{ matches:meetings } } }; }
function meet(yearsAgo, surface, p1Won, result){
  const d=new Date(Date.parse(NOW)-yearsAgo*365.25*864e5).toISOString().slice(0,10);
  return { date:d, surface, p1Won, result };
}
let pass=0, fail=0;
function ok(name, cond, got){ if(cond){pass++; console.log('  ✓',name);} else {fail++; console.log('  ✗',name,'| got:',got);} }
const near=(a,b,e=1e-6)=>Math.abs(a-b)<=e;

console.log('=== setDominance ===');
ok('2-0 straight=1.0', setDominance('2 - 0',cfg.adjustments.h2h.dominance)===1.0);
ok('3-0 straight=1.0', setDominance('3 - 0',cfg.adjustments.h2h.dominance)===1.0);
ok('2-1 competitive=0.6', setDominance('2 - 1',cfg.adjustments.h2h.dominance)===0.6);
ok('3-2 competitive=0.6', setDominance('3 - 2',cfg.adjustments.h2h.dominance)===0.6);
ok('unparseable=0.7', setDominance('W/O',cfg.adjustments.h2h.dominance)===0.7);

console.log('=== hide + balanced ===');
ok('0 meetings => hidden', h2h(ctx('Clay',[])).hidden===true);
const bal=h2h(ctx('Clay',[meet(1,'Clay',true,'2 - 0'),meet(1,'Clay',false,'2 - 0')]));
ok('balanced 1-1 straight => applied & signal 0', bal.applied===true && near(bal.signal,0), bal.signal);

console.log('=== Tier 1: 8 same-surface recent straight-set sweeps => full magnitude ===');
const t1meet=Array.from({length:8},()=>meet(1,'Clay',true,'2 - 0'));
const t1=h2h(ctx('Clay',t1meet));
ok('tier1 detail', /tier 1/.test(t1.detail), t1.detail);
ok('tier1 signal=1.0 (dominAvg1 * t1mult1)', near(t1.signal,1.0), t1.signal);
ok('tier1 deltaP1=+2.5pp (full mag)', near(t1.deltaP1,MAG), t1.deltaP1);
ok('tier1 conf=high', t1.confidence==='high');

console.log('=== Tier 1 dominance: straight vs deciding sweeps ===');
const t1dec=h2h(ctx('Clay',Array.from({length:8},()=>meet(1,'Clay',true,'2 - 1'))));
ok('all-deciding wins signal=0.6', near(t1dec.signal,0.6), t1dec.signal);
ok('deciding deltaP1=0.6*2.5=1.5pp', near(t1dec.deltaP1,0.6*MAG), t1dec.deltaP1);

console.log('=== Tier 2: 4 same-surface recent straight wins (N_eff=4) => 45% mag ===');
const t2=h2h(ctx('Clay',Array.from({length:4},()=>meet(1,'Clay',true,'2 - 0'))));
ok('tier2 detail', /tier 2/.test(t2.detail), t2.detail);
ok('tier2 signal=0.45', near(t2.signal,0.45), t2.signal);
ok('tier2 deltaP1=0.45*2.5=1.125pp (round4)', near(t2.deltaP1,0.45*MAG,1e-4), t2.deltaP1);

console.log('=== Surface filter: 8 DIFFERENT-surface recent straight wins => N_eff=8*0.25=2 => Tier 3 ===');
const sf=h2h(ctx('Clay',Array.from({length:8},()=>meet(1,'Hard',true,'2 - 0'))));
ok('diff-surface drops to tier 3 (N_eff=2)', /tier 3/.test(sf.detail), sf.detail);

console.log('=== Recency filter: 8 same-surface OLD(>4y) straight wins => N_eff=8*0.2=1.6 => Tier 3 ===');
const rf=h2h(ctx('Clay',Array.from({length:8},()=>meet(6,'Clay',true,'2 - 0'))));
ok('old meetings drop to tier 3 (N_eff=1.6)', /tier 3/.test(rf.detail), rf.detail);

console.log('=== Loss sign: straight-set losses => negative signal toward p2 ===');
const loss=h2h(ctx('Clay',Array.from({length:8},()=>meet(1,'Clay',false,'2 - 0'))));
ok('straight losses signal=-1.0 dir p2', near(loss.signal,-1.0) && loss.direction==='p2', loss.signal+'/'+loss.direction);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
