// Harvest all ATP-singles fixtures over the trailing 52 weeks (monthly pulls,
// deduped by event_key). Editions that span a pull boundary reunite when the
// resolver groups by tournament_key+season. Writes one combined JSON to scratch.
import fs from 'fs';
// dotenv is convenient locally (.env) but optional in CI, where API_TENNIS_KEY is
// injected via the workflow env. Load it best-effort so the harvester runs either way.
try { await import('dotenv/config'); } catch { /* no dotenv installed — rely on process.env */ }

const KEY = process.env.API_TENNIS_KEY;
const OUT = process.argv[2] || '/tmp/fx_window.json';
const END = process.argv[3] || '2026-09-08';   // window end (today)
const START = process.argv[4] || '2025-09-08';  // 52 weeks back

function addDays(d, n) { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }

const ranges = [];
let cur = START;
while (cur < END) {
  const stop = addDays(cur, 27) < END ? addDays(cur, 27) : END;
  ranges.push([cur, stop]);
  cur = addDays(stop, 1);
}

const byKey = new Map();
let calls = 0;
for (const [a, b] of ranges) {
  const url = `https://api.api-tennis.com/tennis/?method=get_fixtures&event_type_key=265&date_start=${a}&date_stop=${b}&APIkey=${KEY}`;
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    try {
      const res = await fetch(url);
      const j = await res.json();
      const r = j.result || [];
      for (const f of r) { if (f.event_key != null) byKey.set(f.event_key, f); }
      calls++; ok = true;
      console.error(`  ${a}..${b}  +${r.length}  total=${byKey.size}`);
    } catch (e) { console.error(`  retry ${a}..${b}: ${e.message}`); await new Promise((r) => setTimeout(r, 1500)); }
  }
}
// strip the heavy nested blobs we don't need (statistics/pointbypoint/scores)
const slim = [...byKey.values()].map((f) => {
  const { statistics, pointbypoint, scores, event_first_player_logo, event_second_player_logo, ...rest } = f;
  return rest;
});
fs.writeFileSync(OUT, JSON.stringify({ fetchedRanges: ranges.length, calls, count: slim.length, window: [START, END], result: slim }));
console.error(`DONE calls=${calls} fixtures=${slim.length} -> ${OUT}`);
