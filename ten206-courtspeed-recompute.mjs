#!/usr/bin/env node
// TEN-206 §8 · independent recompute.
//
// Deliberately does NOT load player-profile-v2.js. It re-derives the Court speed
// band table straight from the raw shards, using the spec as written rather than
// the page's implementation, so a shared bug cannot make both agree. Compare its
// output against the numbers the browser painted.
//
// Usage: node ten206-courtspeed-recompute.mjs <key> [key...]
import fs from 'node:fs';

const ROOT = '/Users/Michael/bsp-wt-ten206cs';
const map = JSON.parse(fs.readFileSync(`${ROOT}/court-speed-map.json`, 'utf8'));

// §5.5 quintile cut-offs, frozen in the page and repeated here from the SPEC, not
// imported — if the page's array is edited this recompute must disagree.
const BANDS = [
  ['vslow', 'Very slow', 0.752], ['slow', 'Slow', 0.938], ['med', 'Medium', 1.076],
  ['fast', 'Fast', 1.188], ['vfast', 'Very fast', Infinity],
];
const bandOf = (speed) => {
  if (speed == null || !isFinite(speed)) return null;
  return BANDS.find((b) => speed <= b[2]) || BANDS[BANDS.length - 1];
};

// Three tiers, in this order, and the order matters.
//   1. the shipped dictionary (exact name)
//   2. case-SENSITIVE substring — the matcher's own rule
//   3. case-insensitive WHOLE-NAME equality only
// Tier 3 exists for "Rio De Janeiro" vs the rated venue "Rio de Janeiro", which is
// one venue spelled two ways; the page reaches it through its aliased display name.
// It is deliberately equality and not substring: relaxing the SUBSTRING tier to
// case-insensitive instead moved Martinez from 141 banded to 211, because short
// venue names then match inside unrelated Challenger event titles. That is the
// false-positive class the voted map exists to prevent.
function venueFor(raw) {
  if (raw && map.apiNames[raw]) return map.apiNames[raw];
  for (const v of Object.keys(map.venues)) if (raw && String(raw).includes(v)) return v;
  const lower = String(raw || '').toLowerCase();
  for (const v of Object.keys(map.venues)) if (lower === v.toLowerCase()) return v;
  return null;
}

for (const key of process.argv.slice(2)) {
  const ch = JSON.parse(fs.readFileSync(`${ROOT}/career-history/${key}.json`, 'utf8')).matches;
  const spine = ch.filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)));
  const agg = new Map(BANDS.map((b) => [b[0], { label: b[1], w: 0, l: 0, n: 0 }]));
  let unbanded = 0;
  for (const r of spine) {
    let b;
    // founder ruling 2026-09-16 — grass is always Very fast
    if (String(r.surface || '').toLowerCase() === 'grass') b = BANDS[4];
    else {
      const v = venueFor(r.tournament);
      if (!v) { unbanded++; continue; }
      const guard = map.surfaceGuard[v];
      if (guard && guard.keep) {
        const keep = String(guard.keep).split('/')[0];
        const s = r.surface ? r.surface[0].toUpperCase() + r.surface.slice(1) : null;
        if (s && keep && keep !== '?' && s !== keep) { unbanded++; continue; }
      }
      b = bandOf(map.venues[v].speed);
    }
    if (!b) { unbanded++; continue; }
    const a = agg.get(b[0]);
    if (r.won) a.w++; else a.l++;
    a.n++;
  }
  const banded = [...agg.values()].reduce((s, a) => s + a.n, 0);
  const tw = [...agg.values()].reduce((s, a) => s + a.w, 0);
  const tl = [...agg.values()].reduce((s, a) => s + a.l, 0);
  const base = tw / (tw + tl);
  let best = null;
  for (const a of agg.values()) {
    if (a.n < 10) continue;
    const gap = a.w / a.n - base;
    if (gap <= 0) continue;
    if (!best || gap > best.gap || (gap === best.gap && a.n > best.n)) best = { ...a, gap };
  }
  console.log(`\n=== ${key} — INDEPENDENT RECOMPUTE ===`);
  console.log(`spine ${spine.length} | banded ${banded} | unbanded ${unbanded} | ` +
    `check ${banded + unbanded === spine.length ? 'OK' : 'MISMATCH'}`);
  [...agg.values()].sort((x, y) => (y.n ? y.w / y.n : -1) - (x.n ? x.w / x.n : -1)).forEach((a) => {
    console.log(`  ${a.label.padEnd(10)} ${String(a.w).padStart(4)}–${String(a.l).padEnd(4)} ` +
      `n=${String(a.n).padStart(4)}  ${a.n >= 5 ? Math.round(100 * a.w / a.n) + '%' : '—'}`);
  });
  console.log(`  CAREER     ${tw}–${tl}  n=${banded}  ${Math.round(100 * base)}%`);
  console.log(`  best band (§8.3): ${best ? best.label + ' (+' + (100 * best.gap).toFixed(1) + 'pp, n=' + best.n + ')' : '—'}`);
}
