#!/usr/bin/env node
// Full multi-filter sweep of the Tour + Tournaments view space.
// Question: can ANY view reach the 5000 rung? If not, the Tour ladder and
// CHARTS.md §8's ladder are observationally identical on these two charts,
// which makes them IMMUNE subjects for the keep-as-is ruling.
import fs from 'node:fs'; import path from 'node:path';
const HERE=path.dirname(new globalThis.URL(import.meta.url).pathname);
const D=JSON.parse(fs.readFileSync(path.join(HERE,'..','database-yield.json'),'utf8'));
const rows=D.rows, M=D.meta;
const n=rows.length;
// rows are already in date order? verify, else sort.
let ordered=true; for(let i=1;i<n;i++) if(rows[i][0]<rows[i-1][0]){ordered=false;break;}
const R = ordered ? rows : rows.slice().sort((a,b)=>a[0]-b[0]);
console.log('rows in date order in the artefact:', ordered, ' n =', n);

const lvl=new Uint8Array(n), srf=new Uint8Array(n), rnd=new Uint8Array(n), trn=new Uint16Array(n);
const dFav=new Float64Array(n), dDog=new Float64Array(n);
for(let i=0;i<n;i++){ const r=R[i];
  lvl[i]=r[1]; srf[i]=r[2]; rnd[i]=r[3]; trn[i]=r[4];
  dFav[i]= r[7] ? (r[5]-1) : -1;
  dDog[i]= r[7] ? -1 : (r[6]-1);
}
const NL=M.levels.length, NS=M.surfaces.length, NR=M.rounds.length, NT=M.tournaments.length;

function span(maskL, maskS, maskR, tIdx){
  let cf=0,cd=0,hi=-Infinity,lo=Infinity,cnt=0;
  for(let i=0;i<n;i++){
    if(tIdx>=0){ if(trn[i]!==tIdx) continue; }
    else {
      if(maskL && !((maskL>>lvl[i])&1)) continue;
      if(maskS && !((maskS>>srf[i])&1)) continue;
      if(maskR && !((maskR>>rnd[i])&1)) continue;
    }
    cf+=dFav[i]; cd+=dDog[i]; cnt++;
    if(cf>hi)hi=cf; if(cd>hi)hi=cd; if(cf<lo)lo=cf; if(cd<lo)lo=cd;
  }
  return cnt? {sp:hi-lo, hi, lo, cnt} : null;
}
let best=0, bestOn='', combos=0, nonEmpty=0, over25k=0;
const fullL=(1<<NL)-1, fullS=(1<<NS)-1, fullR=(1<<NR)-1;
for(let a=0;a<=fullL;a++) for(let b=0;b<=fullS;b++) for(let c=0;c<=fullR;c++){
  combos++;
  const ml = a===0?0:a, ms=b===0?0:b, mr=c===0?0:c;   // 0 = "no filter" = all
  const res=span(ml===fullL?0:ml, ms===fullS?0:ms, mr===fullR?0:mr, -1);
  if(!res) continue;
  nonEmpty++;
  if(res.sp>25000) over25k++;
  if(res.sp>best){ best=res.sp; bestOn=`Tour L=${a.toString(2)} S=${b.toString(2)} R=${c.toString(2)} n=${res.cnt}`; }
}
console.log(`Tour combinations enumerated: ${combos}, non-empty: ${nonEmpty}`);
for(let t=0;t<NT;t++){
  const res=span(0,0,0,t); if(!res) continue; nonEmpty++;
  if(res.sp>25000) over25k++;
  if(res.sp>best){ best=res.sp; bestOn=`Event ${M.tournaments[t]} n=${res.cnt}`; }
}
console.log(`+ ${NT} tournament views`);
console.log(`WIDEST SPAN ANYWHERE: ${best.toFixed(1)}u on ${bestOn}`);
console.log(`views whose span exceeds 25,000u (the only place the ladders diverge): ${over25k}`);
console.log(`headroom on the 5000 rung: ${(25000/best).toFixed(1)}x`);
