#!/usr/bin/env node
// TEN-442 · roster-wide reconciliation of the Record-by-season drills, on the DEPLOYED stores.
//
// For every player, every season row and the career row, every cell (Total, Clay, Hard, Indoors, Grass) under
// every Tier that carries a record: does the drill list as many matches as the cell counts? Reads the deployed
// player-profiles.json (tools/deployed-store.js) and the local career-history/ shards (hydrate them first — this
// tool refuses to run on a short store), loads player-profile-v2.js and asks drillScope(), the function the page
// paints from. Each mismatch is put down to ONE cause, checked in this order:
//   pre-2021        the season row is the provider's aggregate; results before 2021 hold tour-level matches only
//   no-flag shard   the shard predates the per-match court flag (TEN-395), so a carved season's court is unknown
//   hole-fill 2021  a 2021 hole-fill row with no court flag (fixed in the writer by TEN-442; clears on rebuild)
//   court unknown   some other unresolved court
//   olympic         the shard carries the corrected Olympic surface and the cached season row does not yet
//   other           anything else (should be 0; listed in full)
// Report only, exit 0 — this measures data convergence; tools/test-ten442-season-drills.js is the wiring gate.
// Run: node tools/probe-ten442-season-drills.js [--tiers all,atp,chitf] [--list other]
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const D = require('./deployed-store.js');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const TIERS = arg('--tiers', 'all').split(',');
const LIST = arg('--list', 'other');

const STORE = D.playerProfiles();
if (STORE.source !== 'deployed' && STORE.source !== 'built') {
  console.error('  ✗ the deployed player-profiles.json could not be read: ' + STORE.drift.why); process.exit(1);
}
const index = D.careerHistoryIndex() || {};
const CH = {};
const dir = path.join(D.BUILT_DIR || ROOT, 'career-history');
let short = 0;
if (fs.existsSync(dir)) {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const k = f.slice(0, -5);
    CH[k] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).matches || [];
    if (typeof index[k] === 'number' && CH[k].length < index[k]) short++;
  }
}
const want = Object.keys(index).length;
if (!Object.keys(CH).length || short || Object.keys(CH).length < want) {
  console.error(`  ✗ career-history/ holds ${Object.keys(CH).length} of ${want} deployed shards (${short} short). ` +
    'Hydrate it first: node -e "require(\'./tools/deployed-store.js\').hydrateCareerHistory()"');
  process.exit(1);
}
const sb = { FEATURE_PP2: true, playerProfiles: { players: STORE.players }, careerHistory: CH,
  TournamentIdentity: require('../tournament-identity.js') };
global.window = sb;
new Function('window', fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8'))(sb);
const I = sb.PlayerProfileV2._internals;

const CELLS = ['total', 'clay', 'hard', 'indoors', 'grass'];
const causes = {}, examples = {}, byKind = { season: { cells: 0, exact: 0 }, career: { cells: 0, exact: 0 } }, kindCause = {};
let cells = 0, exact = 0, players = 0;
let kind = 'season';
const put = (c, ctx) => { causes[c] = (causes[c] || 0) + 1; (examples[c] = examples[c] || []).push(ctx);
  kindCause[kind + '|' + c] = (kindCause[kind + '|' + c] || 0) + 1; };
for (const [key, p0] of Object.entries(STORE.players)) {
  const p = Object.assign({ key }, p0);
  if (!p.careerByYear || !p.careerByYear.length || !CH[key]) continue;
  players++;
  const flagged = CH[key].some((r) => r.src === 'fixtures' && 'indoor' in r);
  for (const tier of TIERS) {
    const scopes = I.spineYears(p).map((y) => ({ year: String(y.year), g: I.tierGridCells(y, tier) }));
    scopes.push({ year: null, g: I.careerTierCells(p, tier) });
    for (const s of scopes) {
      const scope = I.drillScope(p, s.year, null, tier);
      for (const c of CELLS) {
        const rec = s.g[c];
        const n = rec ? (rec.won || 0) + (rec.lost || 0) : 0;
        if (!n) continue;
        cells++;
        kind = s.year ? 'season' : 'career';
        byKind[kind].cells++;
        const rows = c === 'total' ? scope : scope.filter((r) => r.cell === c);
        if (rows.length === n) { exact++; byKind[kind].exact++; continue; }
        const ctx = `${p.name} ${tier} ${s.year || 'career'} ${c}: ${n} counted, ${rows.length} found`;
        const yrs = s.year ? [s.year] : [...new Set(scope.map((r) => r.year))];
        const raw = CH[key].filter((r) => yrs.includes(String(r.year)));
        // only an unresolved court that could belong in THIS cell explains its shortfall
        const unknown = c !== 'total' && scope.some((r) => r.cell === I.COURT_UNKNOWN && (c === 'indoors' || r.surface === c));
        if (s.year && +s.year < 2021) put('pre-2021', ctx);
        else if (!s.year && I.spineYears(p).some((y) => +y.year < 2021) && rows.length < n) put('pre-2021', ctx);
        else if (unknown && !flagged) put('no-flag shard', ctx);
        else if (unknown && raw.some((r) => r.holeFill)) put('hole-fill 2021', ctx);
        else if (unknown) put('court unknown', ctx);
        else if (raw.some((r) => /olympic/i.test(r.tournament || ''))) put('olympic', ctx);
        else put('other', ctx);
      }
    }
  }
}
const noFlag = Object.keys(CH).filter((k) => CH[k].some((r) => r.src === 'fixtures') &&
  !CH[k].some((r) => r.src === 'fixtures' && 'indoor' in r)).length;
const withFix = Object.keys(CH).filter((k) => CH[k].some((r) => r.src === 'fixtures')).length;
console.log(`TEN-442 season-drill reconciliation · profiles ${STORE.fetchedAt} · tiers ${TIERS.join(',')}`);
console.log(`  ${players} players · ${cells} cells checked · ${exact} reconcile (list = W+L) · ${cells - exact} do not`);
for (const [c, n] of Object.entries(causes).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(6)}  ${c}   e.g. ${examples[c].slice(0, 2).join(' | ')}`);
}
for (const k of ['season', 'career']) {
  console.log(`  ${k} cells: ${byKind[k].cells} checked · ${byKind[k].exact} reconcile · ${byKind[k].cells - byKind[k].exact} do not` +
    Object.keys(kindCause).filter((x) => x.startsWith(k + '|')).map((x) => ` · ${x.slice(k.length + 1)} ${kindCause[x]}`).join(''));
}
console.log(`  shards without the per-match court flag: ${noFlag} of ${withFix} with fixture rows`);
if (examples[LIST]) examples[LIST].forEach((e) => console.log('    ' + LIST + ': ' + e));
