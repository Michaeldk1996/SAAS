#!/usr/bin/env node
// Re-derives the three figures the clean-context review disputed, so I change a
// number in the repo only against my own measurement.
import fs from 'node:fs'; import path from 'node:path';
const HERE=path.dirname(new globalThis.URL(import.meta.url).pathname), ROOT=path.join(HERE,'..');
const D=JSON.parse(fs.readFileSync(path.join(ROOT,'database-yield.json'),'utf8'));
const N=JSON.parse(fs.readFileSync(path.join(ROOT,'database-yield-players.json'),'utf8'));
const rows=D.rows, nm=N.names, M=D.meta;
const PL=[1,2,5,10,20,25,50,100];
const pidx=new Map();
for(let i=0;i<rows.length;i++){const r=rows[i],w=nm[i][0],l=nm[i][1],fw=r[7];
 const push=(n,rec)=>{if(!n)return;if(!pidx.has(n))pidx.set(n,[]);pidx.get(n).push(rec);};
 push(w,{p:fw?r[5]:r[6],w:1,d:r[0],fav:fw===1});push(l,{p:fw?r[6]:r[5],w:0,d:r[0],fav:fw===0});}
function raw(n){const rc=pidx.get(n);let all=[];
 for(const s of [rc,rc.filter(v=>v.fav),rc.filter(v=>!v.fav)]){const o=s.slice().sort((a,b)=>a.d-b.d);let c=0;
  for(const v of o){c+=v.w?(v.p-1):-1;all.push(c);}} return [Math.max(...all),Math.min(...all)];}

// (i) the page's algorithm: walk the ladder, re-judge each rung AFTER rounding.
function pageAxis(hiR,loR){let dHi=hiR,dLo=loR;if(dHi<0)dHi=0;if(dLo>0)dLo=0;let step,rnd,hi,lo;
 for(let i=0;i<PL.length;i++){step=PL[i];if(i<PL.length-1&&(dHi-dLo)/step>10)continue;
  rnd=Math.max(1,step/5);hi=Math.ceil(dHi/rnd)*rnd;lo=Math.floor(dLo/rnd)*rnd;if(hi===lo)hi=lo+rnd;
  if(Math.floor(hi/step)-Math.ceil(lo/step)+1<=10)break;} return {step,hi,lo};}
// (ii) the EXPORT's literal rule (README.md:343 / Database.dc.html:821): ONE pass on the RAW span.
function exportAxis(hiR,loR){let dHi=hiR,dLo=loR;if(dHi<0)dHi=0;if(dLo>0)dLo=0;
 const step=[1,2,5,10,20,25,50].filter(s=>(dHi-dLo)/s<=10)[0]||100;
 const rnd=Math.max(1,step/5);let hi=Math.ceil(dHi/rnd)*rnd,lo=Math.floor(dLo/rnd)*rnd;
 if(hi===lo)hi=lo+rnd; return {step,hi,lo};}
const count=a=>Math.floor(a.hi/a.step)-Math.ceil(a.lo/a.step)+1;
let differ=0, over10=0, pos=0;
for(const p of pidx.keys()){const [h,l]=raw(p);
 const a=pageAxis(h,l), b=exportAxis(h,l);
 if(a.step!==b.step||a.hi!==b.hi||a.lo!==b.lo) differ++;
 if(count(b)>10) over10++;
 const lab=[];for(let v=Math.floor(a.hi/a.step)*a.step;v>=a.lo;v-=a.step)lab.push(v);
 if(lab.some(v=>v>0)) pos++;}
console.log(`panels where the page's axis differs from the EXPORT's literal rule: ${differ}`);
console.log(`panels the EXPORT's literal rule would paint with >10 gridlines (violating CHARTS.md 8's own cap): ${over10}`);
console.log(`panels rendering >=1 positive gridline on the shipped build: ${pos}`);

// (iii) widest REACHABLE span, honouring the Round Robin + Finals folds.
const RR=M.rounds.indexOf('Round Robin'), FIN=M.levels.indexOf('Finals');
console.log(`\nRound Robin is round index ${RR}; Finals is level index ${FIN}`);
const n=rows.length;
const lvl=new Uint8Array(n),srf=new Uint8Array(n),rnd_=new Uint8Array(n);
const dF=new Float64Array(n),dD=new Float64Array(n);
for(let i=0;i<n;i++){const r=rows[i];lvl[i]=r[1];srf[i]=r[2];rnd_[i]=r[3];
 dF[i]=r[7]?(r[5]-1):-1; dD[i]=r[7]?-1:(r[6]-1);}
function span(mL,mS,mR){let cf=0,cd=0,hi=-Infinity,lo=Infinity,c=0;
 for(let i=0;i<n;i++){ if(mL&&!((mL>>lvl[i])&1))continue; if(mS&&!((mS>>srf[i])&1))continue; if(mR&&!((mR>>rnd_[i])&1))continue;
  cf+=dF[i];cd+=dD[i];c++; if(cf>hi)hi=cf; if(cd>hi)hi=cd; if(cf<lo)lo=cf; if(cd<lo)lo=cd;}
 return c?{sp:hi-lo,c}:null;}
const NL=M.levels.length,NS=M.surfaces.length,NR=M.rounds.length;
let best=0,bestMask=null,bestReach=0,bestReachMask=null;
for(let a=0;a<=(1<<NL)-1;a++){ for(let b=0;b<=(1<<NS)-1;b++){ for(let c=0;c<=(1<<NR)-1;c++){
  const res=span(a===(1<<NL)-1?0:a, b===(1<<NS)-1?0:b, c===(1<<NR)-1?0:c); if(!res) continue;
  if(res.sp>best){best=res.sp;bestMask=[a,b,c];}
  // reachable = the user can never include Round Robin or Finals via a picker
  const selL = a===0?((1<<NL)-1):a, selR = c===0?((1<<NR)-1):c;
  if(((selL>>FIN)&1) || ((selR>>RR)&1)) continue;
  if(res.sp>bestReach){bestReach=res.sp;bestReachMask=[a,b,c];}
}}}
const nameMask=(m,arr)=>m===0?'(all)':arr.filter((_,i)=>(m>>i)&1).join('+');
console.log(`widest span over ALL masks:      ${best.toFixed(4)}u  L=${nameMask(bestMask[0],M.levels)} S=${nameMask(bestMask[1],M.surfaces)} R=${nameMask(bestMask[2],M.rounds)}`);
console.log(`widest span REACHABLE in the UI: ${bestReach.toFixed(4)}u  L=${nameMask(bestReachMask[0],M.levels)} S=${nameMask(bestReachMask[1],M.surfaces)} R=${nameMask(bestReachMask[2],M.rounds)}`);
console.log(`headroom on the 5000 rung (reachable): ${(25000/bestReach).toFixed(1)}x`);
