#!/usr/bin/env node
// TEN-196 round 8 — measure the `keep-as-is` ruling (gate b6f04a43).
// Recomputes from the two JSON artefacts. Imports nothing from the page.
import fs from 'node:fs';
import path from 'node:path';
const HERE = path.dirname(new globalThis.URL(import.meta.url).pathname);
const ROOT = path.join(HERE, '..');
const DATA  = JSON.parse(fs.readFileSync(path.join(ROOT,'database-yield.json'),'utf8'));
const NAMES = JSON.parse(fs.readFileSync(path.join(ROOT,'database-yield-players.json'),'utf8'));
const rows = DATA.rows, nm = NAMES.names;

const TOUR_LADDER   = [10,25,50,100,250,500,1000,2500,5000];   // live / keep-as-is
const PLAYER_LADDER = [1,2,5,10,20,25,50,100];                 // live / keep-as-is
const SPEC8         = [10,25,50,100,250,500,1000,2500];        // CHARTS.md §8

const fmtInt = v => (v<0?'-':'') + Math.abs(Math.round(v)).toLocaleString('en-US');

function playerAxis(rawHi, rawLo, LADDER, rndFn){
  let dHi=rawHi, dLo=rawLo;
  if(dHi<0) dHi=0; if(dLo>0) dLo=0;
  let step,rnd,hi,lo;
  for(let i=0;i<LADDER.length;i++){
    step=LADDER[i];
    if(i<LADDER.length-1 && (dHi-dLo)/step>10) continue;
    rnd=rndFn(step);
    hi=Math.ceil(dHi/rnd)*rnd; lo=Math.floor(dLo/rnd)*rnd;
    if(hi===lo) hi=lo+rnd;
    if(Math.floor(hi/step)-Math.ceil(lo/step)+1<=10) break;
  }
  const labels=[];
  for(let v=Math.floor(hi/step)*step; v>=lo; v-=step)
    labels.push(v===0?'0':(v>0?'+'+fmtInt(v)+'u':fmtInt(v)+'u'));
  return {step,hi,lo,labels};
}
function tourAxis(pred, isTourn, LADDER){
  let cf=0,cd=0,rawHi=-Infinity,rawLo=Infinity;
  for(const r of rows){
    if(pred && !pred(r)) continue;
    cf += r[7] ? (r[5]-1) : -1;
    cd += r[7] ? -1 : (r[6]-1);
    rawHi=Math.max(rawHi,cf,cd); rawLo=Math.min(rawLo,cf,cd);
  }
  if(rawHi===-Infinity) return null;
  const sp=rawHi-rawLo;
  let step,rnd,hi,lo;
  for(let i=0;i<LADDER.length;i++){
    step=LADDER[i];
    if(i<LADDER.length-1 && sp/step>10) continue;
    rnd=Math.max(10,step/10);
    hi=(isTourn&&rawHi>0)?Math.ceil(rawHi/step)*step:Math.max(rnd,Math.ceil(rawHi/rnd)*rnd);
    lo=Math.floor(rawLo/rnd)*rnd;
    if(hi===lo) hi=lo+rnd;
    if(lo>0) lo=0;
    if(hi===lo) hi=lo+rnd;
    if(Math.floor(hi/step)-Math.ceil(lo/step)+1<=10) break;
  }
  const labels=[];
  for(let v=Math.floor(hi/step)*step; v>0; v-=step) labels.push('+'+fmtInt(v)+'u');
  for(let v=0; v>=lo; v-=step) labels.push(v===0?'0':fmtInt(v)+'u');
  return {step,hi,lo,rawHi,rawLo,sp,labels};
}

// ---- build the player index ----
const pidx=new Map();
for(let i=0;i<rows.length;i++){
  const r=rows[i], w=nm[i][0], l=nm[i][1], fw=r[7];
  const push=(n,rec)=>{ if(!n) return; if(!pidx.has(n)) pidx.set(n,[]); pidx.get(n).push(rec); };
  push(w,{p:fw?r[5]:r[6], w:1, d:r[0], fav:fw===1});
  push(l,{p:fw?r[6]:r[5], w:0, d:r[0], fav:fw===0});
}
function playerRaw(name){
  const recs=pidx.get(name); let all=[];
  for(const s of [recs, recs.filter(v=>v.fav), recs.filter(v=>!v.fav)]){
    const ord=s.slice().sort((a,b)=>a.d-b.d); let c=0;
    for(const v of ord){ c+= v.w?(v.p-1):-1; all.push(c); }
  }
  return {rawHi:Math.max(...all), rawLo:Math.min(...all), n:recs.length};
}

const players=[...pidx.keys()];
console.log(`players in the shard: ${players.length}`);

function survey(LADDER, rndFn, label){
  let bare0=0, le2=0, pos=0; const counts=[];
  for(const p of players){
    const {rawHi,rawLo}=playerRaw(p);
    const ax=playerAxis(rawHi,rawLo,LADDER,rndFn);
    counts.push(ax.labels.length);
    if(ax.labels.length===1 && ax.labels[0]==='0') bare0++;
    if(ax.labels.length<=2) le2++;
    if(ax.labels.some(l=>l.startsWith('+'))) pos++;
  }
  counts.sort((a,b)=>a-b);
  const med=counts[Math.floor(counts.length/2)];
  console.log(`${label.padEnd(34)} bare-"0": ${String(bare0).padStart(4)}   <=2 lines: ${String(le2).padStart(4)}   median: ${med}   >=1 positive gridline: ${pos}`);
  return {bare0,le2,med,pos};
}
console.log('\n=== A/B/C · Players panels, all 1,129 ===');
const KEEP = survey(PLAYER_LADDER, s=>Math.max(1,s/5), 'KEEP-AS-IS (live, ruled)');
const S8P  = survey(SPEC8,         s=>Math.max(1,s/5), 'SS8 ladder + Players rnd');
const S8T  = survey(SPEC8,         s=>Math.max(10,s/10),'SS8 ladder + Tour rnd');

// ---- D · does §8 move Tour / Tournaments? ----
console.log('\n=== D · SS8 as a no-op on Tour + Tournaments ===');
const META=DATA.meta;
const views=[];
views.push(['Tour · unfiltered', null, false]);
const dims=[['level',3,META.levels],['surface',2,META.surfaces],['round',1,META.rounds]];
for(const [dn,ci,vals] of dims)
  (vals||[]).forEach((v,i)=>views.push([`Tour · ${dn}=${v}`, r=>r[ci]===i, false]));
(META.tournaments||[]).forEach((t,i)=>views.push([`Event · ${t}`, r=>r[4]===i, true]));
let moved=0, checked=0, widest=0, widestOn='';
for(const [nm_,pred,isT] of views){
  const a=tourAxis(pred,isT,TOUR_LADDER), b=tourAxis(pred,isT,SPEC8);
  if(!a||!b) continue;
  checked++;
  if(a.sp>widest){ widest=a.sp; widestOn=nm_; }
  if(JSON.stringify(a.labels)!==JSON.stringify(b.labels)) { moved++; if(moved<=5) console.log(`   MOVED ${nm_}: ${a.step} -> ${b.step}`); }
}
console.log(`views checked: ${checked}   moved under SS8: ${moved}`);
console.log(`widest span anywhere: ${widest.toFixed(1)}u on "${widestOn}"  (5000 rung needs 25,000u -> headroom ${(25000/widest).toFixed(1)}x)`);

// ---- E · is the 5000 rung reachable? ----
const anyUses5000 = views.map(([n,p,t])=>tourAxis(p,t,TOUR_LADDER)).filter(Boolean).filter(a=>a.step===5000).length;
console.log(`views whose chosen step is 5000: ${anyUses5000}`);
