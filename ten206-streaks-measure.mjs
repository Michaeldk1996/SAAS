// TEN-206 §5.4 · RULING cal-2 — re-measurement of every run length.
//
// The founder ruled "move it now in this branch; re-measure every run length"
// when told the Calendar tab had moved onto the career match rows while Streaks
// was still counting the priced archive. This script is that re-measurement.
//
// It reads the DEPLOYED shards, not the repo copies — the JSON is cron-refreshed
// and the committed files lag. For each player it computes the run set BOTH ways
// (old archive spine, new career spine) and prints every run length on both, so
// the move is a table of numbers rather than a claim.
//
// Two independent computations of the new spine are compared on every player:
//   A. the SHIPPED code — player-profile-v2.js loaded into the same window shim
//      the test suite uses, driving calSpineFiltered() + calRuns();
//   B. a scan written here from the definition alone (walk the dated rows oldest
//      first; a run breaks when won flips).
// If A and B disagree the script exits non-zero. A measurement that only asks
// the code under test what it thinks is not a measurement.
//
// Run: node ten206-streaks-measure.mjs

import fs from 'fs';

const BASE = 'https://michaeldk1996.github.io/SAAS';
const SUBJECTS = [
  { key: '1980', label: 'Zverev  (top-10)' },
  { key: '1775', label: 'Martinez (~#136)' },
  { key: '906', label: 'Krumich (Challenger-only)' },
];

async function j(path) {
  const res = await fetch(`${BASE}/${path}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

// ── B · the independent scan ────────────────────────────────────────────────
function scanRuns(rows) {
  const out = [];
  for (const r of rows) {
    const res = r.won ? 'W' : 'L';
    const last = out[out.length - 1];
    if (last && last.res === res) { last.len += 1; last.to = r.date; }
    else out.push({ res, len: 1, from: r.date, to: r.date });
  }
  return out;
}

// ── A · the shipped code, in the test suite's shim ──────────────────────────
function loadModule(profiles, extra) {
  const sandbox = Object.assign({ FEATURE_PP2: true, playerProfiles: { players: profiles } }, extra || {});
  global.window = sandbox;
  const src = fs.readFileSync('player-profile-v2.js', 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', src)(sandbox);
  if (!sandbox.PlayerProfileV2) throw new Error('module did not export PlayerProfileV2');
  return sandbox.PlayerProfileV2._internals;
}

function hist(runs) {
  const by = {};
  runs.forEach((r) => { const k = r.res + r.len; by[k] = (by[k] || 0) + 1; });
  return Object.keys(by).sort((a, b) => {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    return Number(a.slice(1)) - Number(b.slice(1));
  }).map(k => `${k}x${by[k]}`).join(' ');
}
function longest(runs, res) {
  const s = runs.filter(r => r.res === res).sort((a, b) => b.len - a.len)[0];
  return s ? s.len : 0;
}

let bad = 0;
for (const s of SUBJECTS) {
  const [prof, mk, ch] = await Promise.all([
    j(`profiles/${s.key}.json`), j(`market-edge/${s.key}.json`), j(`career-history/${s.key}.json`),
  ]);
  const p = prof && prof.profile;
  if (!p) { console.log(`${s.label}: no deployed profile shard`); bad++; continue; }
  const chRows = ((ch && ch.matches) || []).filter(r => r && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)));
  const mkRows = ((mk && mk.matches) || []).slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // The same two lazy stores the page fills after first paint: careerHistory
  // holds the ARRAY of match rows per key, marketEdge the whole shard object.
  const M = loadModule({ [s.key]: p }, {
    careerHistory: { [s.key]: (ch && ch.matches) || [] },
    marketEdge: { [s.key]: mk },
  });
  M.state.calSurface = 'all';
  M.state.calTab = 'streaks';
  const spine = M.calSpineFiltered(p);
  const runsA = M.calRuns(spine);
  const runsB = scanRuns(chRows.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)));
  const runsOld = scanRuns(mkRows);

  const agree = runsA.length === runsB.length
    && runsA.every((r, i) => r.res === runsB[i].res && r.len === runsB[i].len);
  if (!agree) bad++;

  const priced = spine.filter(r => r.cents != null).length;
  console.log(`\n${s.label}  key ${s.key}`);
  console.log(`  rows        archive ${mkRows.length}  ->  career ${chRows.length}   (priced subset ${priced})`);
  console.log(`  runs        archive ${runsOld.length}  ->  career ${runsA.length}`);
  console.log(`  longest W   archive ${longest(runsOld, 'W')}  ->  career ${longest(runsA, 'W')}`);
  console.log(`  longest L   archive ${longest(runsOld, 'L')}  ->  career ${longest(runsA, 'L')}`);
  console.log(`  runs 5+     archive ${runsOld.filter(r => r.len >= 5).length}  ->  career ${runsA.filter(r => r.len >= 5).length}`);
  console.log(`  win rate    archive ${(mkRows.filter(r => r.won).length / (mkRows.length || 1) * 100).toFixed(1)}%  ->  career ${(spine.filter(r => r.won).length / (spine.length || 1) * 100).toFixed(1)}%`);
  console.log(`  every run length, archive spine: ${hist(runsOld)}`);
  console.log(`  every run length, career  spine: ${hist(runsA)}`);
  console.log(`  independent scan agrees: ${agree ? 'yes' : 'NO — shipped code and definition disagree'}`);
}

console.log(bad ? `\nFAIL — ${bad} subject(s) did not reconcile` : '\nOK — every subject reconciles');
process.exit(bad ? 1 : 0);
