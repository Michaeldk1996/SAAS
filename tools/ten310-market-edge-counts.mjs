// TEN-310 report numbers: node tools/ten310-market-edge-counts.mjs <dir-with-shards> [refDate] [key:name ...]
// Reads career-history-<key>.json + match-closes-<key>.json from <dir> (fetched from the DEPLOYED
// site, never the local stores) and prints every count the brief asks for, through the page's code.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildData } from './ten310-harness.mjs';

const dir = process.argv[2];
const ref = process.argv[3] || new Date().toISOString().slice(0, 10);
const players = (process.argv.slice(4).length ? process.argv.slice(4) : ['2072:J. Sinner', '2382:C. Alcaraz']).map((s) => s.split(':'));
const { meRowsFor, fhParseCloses, core } = buildData();
const refDay = Date.UTC(+ref.slice(0, 4), +ref.slice(5, 7) - 1, +ref.slice(8, 10)) / 86400000;
const pct = (v) => (v == null ? '—' : (v * 100).toFixed(1) + '%');
const rd = (p) => JSON.parse(readFileSync(join(dir, p), 'utf8'));
const statsIdx = existsSync(join(dir, 'match-stats-index.json')) ? new Set(Object.keys(rd('match-stats-index.json').matches || rd('match-stats-index.json'))) : null;
for (const [key, name] of players) {
  const career = rd(`career-history-${key}.json`).matches;
  const cl = fhParseCloses(rd(`match-closes-${key}.json`));
  const rows = meRowsFor(career, cl, key, name);
  console.log(`\n=== ${name} (${key}) · history rows ${career.length}, ATP tour ${rows.length}, other levels ${rows.notTour} · ref ${ref}`);
  for (const scope of ['career', 'l52']) {
    const M = core.playerModel(rows, { scope, refDay, todayPrice: null });
    const byBookSrc = {};
    M.priced.forEach((r) => { const k = r.book + r.src; byBookSrc[k] = (byBookSrc[k] || 0) + 1; });
    console.log(`[${scope}] tour rows in scope ${M.scoped} → ${JSON.stringify(M.why)}`);
    console.log(`   priced ${M.priced.length}: Pinnacle ${M.book.P} / Bet365 ${M.book.B}  (${JSON.stringify(byBookSrc)})  last ${M.lastDate}  units ${M.units.toFixed(2)}`);
    console.log(`   derived-lines population: ${JSON.stringify(M.whyBo3)}`);
    const at2 = M.priced.filter((r) => Math.round(r.price * 1000) === 2000).length;
    console.log(`   priced exactly 2.00: ${at2}`);
    if (statsIdx) {
      const ek = M.priced.filter((r) => r.ek != null), res = ek.filter((r) => statsIdx.has(String(r.ek)));
      console.log(`   stats-sheet resolve: ${res.length}/${M.priced.length} priced rows have a box score (${ek.length} carry an eventKey)`);
    }
    M.bands.forEach((b) => console.log(`   ${b.label.padEnd(12)} n=${String(b.n).padStart(3)} ${b.w}-${b.l} won ${pct(b.won)} needs ${pct(b.needs)} 1u ${b.n ? b.units.toFixed(2) : '—'} yield ${pct(b.yield)}`));
    if (scope === 'career') {
      console.log('   Needs (a) 100/mid · (b) 100/mean price · (c) n/Σprice');
      M.bands.forEach((b, i) => { const c = core.needsCandidates(b.rows, i); console.log(`   ${b.label.padEnd(12)} n=${String(c.n).padStart(3)}  a ${pct(c.a)}  b ${pct(c.b)}  c ${pct(c.c)}`); });
    }
  }
}
