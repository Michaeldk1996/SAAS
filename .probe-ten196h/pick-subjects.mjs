import fs from 'node:fs'; import path from 'node:path';
const HERE=path.dirname(new globalThis.URL(import.meta.url).pathname);
const ROOT=path.join(HERE,'..');
const D=JSON.parse(fs.readFileSync(path.join(ROOT,'database-yield.json'),'utf8'));
const N=JSON.parse(fs.readFileSync(path.join(ROOT,'database-yield-players.json'),'utf8'));
const rows=D.rows, nm=N.names;
const PL=[1,2,5,10,20,25,50,100], S8=[10,25,50,100,250,500,1000,2500];
const fmtInt=v=>(v<0?'-':'')+Math.abs(Math.round(v)).toLocaleString('en-US');
function axis(rawHi,rawLo,L,rf){let dHi=rawHi,dLo=rawLo;if(dHi<0)dHi=0;if(dLo>0)dLo=0;let step,rnd,hi,lo;
 for(let i=0;i<L.length;i++){step=L[i];if(i<L.length-1&&(dHi-dLo)/step>10)continue;rnd=rf(step);
  hi=Math.ceil(dHi/rnd)*rnd;lo=Math.floor(dLo/rnd)*rnd;if(hi===lo)hi=lo+rnd;
  if(Math.floor(hi/step)-Math.ceil(lo/step)+1<=10)break;}
 const lab=[];for(let v=Math.floor(hi/step)*step;v>=lo;v-=step)lab.push(v===0?'0':(v>0?'+'+fmtInt(v)+'u':fmtInt(v)+'u'));
 return {step,labels:lab};}
const pidx=new Map();
for(let i=0;i<rows.length;i++){const r=rows[i],w=nm[i][0],l=nm[i][1],fw=r[7];
 const push=(n,rec)=>{if(!n)return;if(!pidx.has(n))pidx.set(n,[]);pidx.get(n).push(rec);};
 push(w,{p:fw?r[5]:r[6],w:1,d:r[0],fav:fw===1,b:r[8]});
 push(l,{p:fw?r[6]:r[5],w:0,d:r[0],fav:fw===0,b:r[8]});}
function raw(name){const recs=pidx.get(name);let all=[];
 for(const s of [recs,recs.filter(v=>v.fav),recs.filter(v=>!v.fav)]){const o=s.slice().sort((a,b)=>a.d-b.d);let c=0;
  for(const v of o){c+=v.w?(v.p-1):-1;all.push(c);}}
 return {rawHi:Math.max(...all),rawLo:Math.min(...all),n:recs.length,b365:recs.filter(v=>v.b===1).length};}
const out=[];
for(const p of pidx.keys()){const r=raw(p);
 const keep=axis(r.rawHi,r.rawLo,PL,s=>Math.max(1,s/5));
 const s8  =axis(r.rawHi,r.rawLo,S8,s=>Math.max(1,s/5));
 out.push({p,n:r.n,b365:r.b365,keep,s8,moves:JSON.stringify(keep.labels)!==JSON.stringify(s8.labels),
           s8bare:s8.labels.length===1&&s8.labels[0]==='0'});}
console.log('panels where the SS8 revert MOVES the axis:', out.filter(o=>o.moves).length, 'of', out.length);
console.log('\n-- largest seam-crossing subjects (b365>0) that MOVE --');
out.filter(o=>o.moves&&o.b365>0).sort((a,b)=>b.n-a.n).slice(0,6)
  .forEach(o=>console.log(`${o.p.padEnd(22)} n=${String(o.n).padStart(4)} b365=${String(o.b365).padStart(3)}  keep step ${String(o.keep.step).padStart(3)} (${o.keep.labels.length} lines) -> SS8 step ${o.s8.step} (${o.s8.labels.length})  ${o.s8bare?'SS8=BARE 0':''}`));
console.log('\n-- largest subjects that SS8 would collapse to a bare "0" --');
out.filter(o=>o.s8bare).sort((a,b)=>b.n-a.n).slice(0,6)
  .forEach(o=>console.log(`${o.p.padEnd(22)} n=${String(o.n).padStart(4)} b365=${String(o.b365).padStart(3)}  keep=${JSON.stringify(o.keep.labels)}`));
console.log('\n-- named in the gate --');
for(const who of ['Khachanov K.','Sinner J.','Michelsen A.','Murray A.']){
  const o=out.find(x=>x.p===who); if(!o){console.log(who,'NOT FOUND');continue;}
  console.log(`${who.padEnd(16)} n=${o.n} b365=${o.b365} keep step ${o.keep.step} ${JSON.stringify(o.keep.labels)}  -> SS8 ${JSON.stringify(o.s8.labels)}`);}
