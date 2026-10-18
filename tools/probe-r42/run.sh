#!/usr/bin/env bash
# probe r42: Z. Bergs' full record on the live data, every row with its price or the dash's hover reason. $1 = site-data run.
set -uo pipefail
sed -i "s#tab: pick(tab) };#tab: pick(tab), lv, why: tab \&\& tab.price == null ? fhSrcTitle(tab) : null };#" tools/price-consistency.mjs; grep -c 'why: tab &&' tools/price-consistency.mjs
gh run download "$1" -R "$GITHUB_REPOSITORY" -n site-data -D after
BK=$(node -e "
const s=f=>{try{return require('./after/'+f)}catch(e){return null}};
const ks=new Set();
for (const f of ['career-history-index.json','player-profiles.json','player-index.json']) { const j=s(f); if(!j) continue; const o=j.players||j;
  for (const [k,v] of Object.entries(o)) if (/\bBergs\b/i.test(JSON.stringify(v))) ks.add(String(v && (v.key||v.playerKey) || k)); }
console.log([...ks].join(','))")
echo "Bergs key(s): $BK"
K=${BK%%,*}
ls -l after/career-history/$K.json
CHROME_BIN=google-chrome timeout 900 node tools/price-consistency.mjs --site after --only "$K" --sample 1 --pick "$K||" --coverage-out cov-bergs.json --quarantine-out q-bergs.json > pc-bergs.txt 2>&1; echo "bergs exit $?"
grep -o '### price-coverage .*' pc-bergs.txt | cut -c1-1500
echo "rows shown: $(grep -c '^SHOW' pc-bergs.txt)"
grep '^SHOW' pc-bergs.txt | sed 's/^SHOW //' | node -e "
const L=require('fs').readFileSync(0,'utf8').trim().split('\n').map(JSON.parse).sort((a,b)=>a.date<b.date?-1:1);
for (const r of L) console.log([r.date, r.lv, r.event, r.round, 'v '+r.opp, r.tab || ('— '+r.why)].join(' | '));"
