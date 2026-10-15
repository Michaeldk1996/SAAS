#!/usr/bin/env node
// TEN-437 D3/D4 · rebuilds the ARCHIVE half of tools/fixtures/ten437/h2h-golden-pairs.json with the PRODUCTION archive
// builder (career-backfill.js buildArchiveHistories) over the TML year files, so the gate's archive rows are exactly what
// the pipeline writes into career-history shards from 2026-10-16 on: each row carries its opponent's TML/ATP id (`oppId`,
// D3), and carpet / blank-surface matches are kept (D4). The fixture's feed rows (api-tennis, `src: 'fixtures'`) and its
// 2021 hole-fill rows stay as copied from the live shards; a hole-fill row gets its `oppId` from the same TML row it was
// filled from (owner id + event date + opponent name key). Each side also gets `id` = his TML/ATP id, as the shard's `id`
// gives the screens. A side whose reconciled TML id differs from the pair's ATP code is reported and left without `id`.
//
// D1 context: the qualifying rule (h2h-core resolveQualifying) dates a word-round feed meeting against the first main-draw
// round either player played at that event, so each side also carries his OTHER feed rows of the same event within 21
// days (copied from his live shard, --shards), exactly what the screens hand the join.
//
// Run (operator machine): node tools/ten437-golden-archive-rebuild.mjs <tml-cache dir> [--shards <dir of live shards>] [--add <pairs.json>]
//   <tml-cache dir>  the repo's tml-cache/ (Sackmann/TML year CSVs, gitignored — present on the operator machine)
//   --add            extra golden pairs to append: [{ a:{short,full,key,atpCode}, b:{…}, atp:{a,b,n}, checkedOn, source,
//                    note, chA, chB }] with chA/chB copied from live shards (feed rows are kept, archive rows rebuilt).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const H2HCore = require(path.join(ROOT, 'h2h-core.js'));
const CB = require(path.join(ROOT, 'career-backfill.js'));
const OUT = path.join(ROOT, 'tools/fixtures/ten437/h2h-golden-pairs.json');
const ARCHIVE_MAX_YEAR = 2020;   // writeCareerHistoryShards: currentYear - 6 (2026)

const tmlDir = process.argv[2];
if (!tmlDir || !fs.existsSync(tmlDir)) { console.error('usage: ten437-golden-archive-rebuild.mjs <tml-cache dir> [--add pairs.json]'); process.exit(2); }
const addAt = process.argv.indexOf('--add');
const shAt = process.argv.indexOf('--shards');
const shardDir = shAt > 0 ? process.argv[shAt + 1] : null;
const liveRows = k => { if (!shardDir) return []; const f = path.join(shardDir, String(k) + '.json'); return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')).matches || []) : []; };
const day = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : null; };
// the side's other feed rows at the events of his kept feed meetings (same tournament string, within 21 days)
const contextRows = (side, kept) => {
  const meet = kept.filter(r => r.src !== 'archive');
  const have = new Set(kept.map(r => (r.eventKey != null ? 'e' + r.eventKey : 'd' + r.date + '|' + r.opponent)));
  return liveRows(side.key).filter(r => r && r.src !== 'archive' && !have.has(r.eventKey != null ? 'e' + r.eventKey : 'd' + r.date + '|' + r.opponent)
    && meet.some(x => x.tournament === r.tournament && Math.abs(day(x.date) - day(r.date)) <= 21));
};
const G = JSON.parse(fs.readFileSync(OUT, 'utf8'));
if (addAt > 0) G.pairs.push(...JSON.parse(fs.readFileSync(process.argv[addAt + 1], 'utf8')));

const csvByYear = {};
for (const f of fs.readdirSync(tmlDir)) { const m = /^(\d{4})\.csv$/.exec(f); if (m) csvByYear[+m[1]] = fs.readFileSync(path.join(tmlDir, f), 'utf8'); }
const index = await CB._internal.buildTmlIndex(() => {}, { csvByYear });

// every golden player, once: the archive builder reconciles him by name, as the pipeline does
const players = new Map();
for (const p of G.pairs) for (const s of [p.a, p.b]) players.set(String(s.key), s);
const profiles = {}; for (const [k, s] of players) profiles[k] = { name: s.full };
const ids = new Map();
const archive = await CB.buildArchiveHistories(profiles, 2000, ARCHIVE_MAX_YEAR, { index, idsOut: ids });

// the TML row behind a hole-fill row: owner id + event date + opponent name key -> opponent id
const tmlOpp = (ownerId, date, opp) => {
  const hits = (index.byId.get(ownerId) || []).filter(m => m.date === date && H2HCore.nameKey(m.oppName) === H2HCore.nameKey(opp));
  return hits.length === 1 ? String(hits[0].oppId) : null;
};
const problems = [];
const rebuild = (side, other, rows) => {
  const id = ids.get(String(side.key)) || null;
  if (!id || id.toUpperCase() !== String(side.atpCode || '').toUpperCase()) problems.push(`${side.short}: reconciled to ${id || 'nothing'}, ATP code ${side.atpCode}`);
  const nkO = H2HCore.nameKey(other.full);
  const kept = rows.filter(r => !(r.src === 'archive' && !r.holeFill && +String(r.date).slice(0, 4) <= ARCHIVE_MAX_YEAR))
    .map(r => (r.src === 'archive' && r.holeFill && id ? Object.assign({}, r, (o => (o ? { oppId: o } : {}))(tmlOpp(id, r.date, r.opponent))) : r));
  const fresh = (archive[String(side.key)] || []).filter(r => H2HCore.nameKey(r.opponent) === nkO).map(r => Object.assign({}, r, { src: 'archive' }));
  fresh.forEach(r => { delete r._indoor; });
  const ctx = contextRows(side, kept);
  return { id, rows: kept.concat(fresh, ctx).sort((x, y) => String(y.date).localeCompare(String(x.date))) };
};
for (const p of G.pairs) {
  const A = rebuild(p.a, p.b, p.chA || []), B = rebuild(p.b, p.a, p.chB || []);
  p.chA = A.rows; p.chB = B.rows;
  if (A.id && A.id.toUpperCase() === String(p.a.atpCode).toUpperCase()) p.a.id = A.id; else delete p.a.id;
  if (B.id && B.id.toUpperCase() === String(p.b.atpCode).toUpperCase()) p.b.id = B.id; else delete p.b.id;
}
G.builtFrom = (G.builtFrom || '') + ' · archive half rebuilt 2026-10-16 with the production buildArchiveHistories over tml-cache (oppId, carpet/blank kept: TEN-437 D3/D4)';
fs.writeFileSync(OUT, JSON.stringify(G, null, 1) + '\n');
console.log(`pairs ${G.pairs.length}; players ${players.size}; reconciled ${ids.size}`);
if (problems.length) console.log('id problems (side left without id):\n  ' + [...new Set(problems)].join('\n  '));
