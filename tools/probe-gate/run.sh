#!/usr/bin/env bash
# READ-ONLY probe (branch only): the approved per-source gate simulated on (1) a real board day change and (2) PR #71.
set -u
LATEST=$(gh run list -R "$GITHUB_REPOSITORY" --workflow pipeline.yml --status success -L 1 --json databaseId -q '.[0].databaseId')
echo "inputs: run 39901527101 (23 Oct 04:40Z); later board: run $LATEST"
gh run download 39901527101 -R "$GITHUB_REPOSITORY" -n site-data -D good || exit 1
gh run download "$LATEST" -R "$GITHUB_REPOSITORY" -n site-data -D late || exit 1
RID2=$(gh run list -R "$GITHUB_REPOSITORY" --workflow historical-archive.yml --status success -L 20 --json databaseId -q '.[].databaseId' | while read -r r; do gh api "repos/$GITHUB_REPOSITORY/actions/runs/$r/artifacts" -q '.artifacts[] | select(.name=="lower-unpriced" and (.expired|not)) | .id' | head -1 | grep -q . && { echo "$r"; break; }; done)
gh run download "$RID2" -R "$GITHUB_REPOSITORY" -n lower-unpriced -D .
python3 tools/pinarch.py export pinnacle-closes.json >/dev/null || exit 1
python3 tools/tdarch.py approx-feed pinnacle-approx.csv pinnacle-approx-lower.csv >/dev/null || exit 1
python3 tools/pinarch.py td-feed pinnacle-closes.json pinnacle-archive-td.csv >/dev/null || exit 1
python3 tools/pinarch.py lower-closes pinnacle-closes.json pinnacle-lower-closes.csv >/dev/null || exit 1
cp build-database-yield.js A.js; cp tools/probe-gate/fix-build-database-yield.js F.js
node tools/probe-gate/patch.js A.js && node tools/probe-gate/patch.js F.js || exit 1
build() { # $1 label, $2 code, $3 board dir
  rm -rf career-history form bet365-history; cp -r good/career-history good/bet365-history .
  cp good/career-history-index.json good/player-index.json .
  cp "$3/player-profiles.json" "$3/matches.json" .; [ -d "$3/form" ] && cp -r "$3/form" .
  mkdir -p out-$1; DB_YIELD_OUT_DIR=out-$1 node "$2" | grep -E "^lower levels|era shard" | sed -E 's/"unpriced".*//' | cut -c1-300
  ls -la out-$1/ledger.json
}
build A A.js good; build AL A.js late; build F F.js good; build FL F.js late
gzip -c out-A/ledger.json | wc -c | sed 's/^/ledger gz bytes (probe form, incl. outcomes): /'
python3 - <<'PY'
import json
L=json.load(open('out-F/ledger.json'))
pi={str(x.get('key')):x for x in json.load(open('player-index.json')).get('players',[])}
ch=json.load(open('career-history-index.json')).get('players',{})
amb=[]
for o in L['outcomes']:
  if o.get('reason')!='name not resolved' or not o.get('cands'): continue
  if not any(len(c)>1 for _,c in o['cands']): continue
  amb.append(o)
  if not any(w in (o['p1']+o['p2']) for w in ('Nedic','Karol','Daniel, Taro','Brancaccio')): continue
  print('AMBIG', o['p1'],'v',o['p2'],o.get('cat'))
  for n,c in o['cands']:
    for k in c: x=pi.get(str(k),{}); print('   ',n,'->',k,x.get('name') or (ch.get(str(k)) or {}).get('name'),'rank',x.get('rank'),x.get('country'))
print('ambiguous-name captures (two+ candidate keys):',len(amb),'distinct names',len({n for o in amb for n,c in o['cands'] if len(c)>1}))
PY
node tools/probe-gate/gate-sim.mjs out-A/ledger.json out-AL/ledger.json "day change, today's code (the 22-23 Oct case)"
node tools/probe-gate/gate-sim.mjs out-F/ledger.json out-FL/ledger.json "day change, PR #71 code"
MAXSHOW=40 node tools/probe-gate/gate-sim.mjs out-A/ledger.json out-F/ledger.json "today's code -> PR #71 (same inputs)"
