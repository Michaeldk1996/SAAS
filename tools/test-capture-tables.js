#!/usr/bin/env node
// tools/test-capture-tables.js — architecture program stage 4, phase A (2026-11-05).
//   1 · equivalence: three evolving matches.json snapshots → (a) the git path (build-captured-pinnacle absorb + deriveRow)
//       and (b) the tables path (tools/capture-to-table.py rows_of, the REAL Python, then tools/captured-diff.js
//       eventsFromTables + the same deriveRow) build the IDENTICAL captured close for every match. Controls: a lost read
//       moves seenAt and a lost tick moves the close — the diff names both.
//   2 · compare(): same / differ / gitOnly / tableOnly, and matches before the dual-write window are not compared.
//   3 · capture-tables.sql: append-only (SELECT + INSERT for service_role, UPDATE/DELETE/TRUNCATE refused, RLS on).
//   4 · wiring: the capture loop writes the tables before EVERY commit (the tick and the recompute), odds-history too,
//       the archive job applies the schema, and the pipeline's diff step is report-only.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const B = require('../build-captured-pinnacle.js');
const D = require('./captured-diff.js');

let pass = 0; const fails = [];
const check = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { fails.push(name); console.log(`  FAIL ${name}\n       ${e.message}`); } };

// rows_of from the shipped Python writer, over each snapshot; the union is what the tables would hold.
function pyRows(snapshot) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-'));
  const f = path.join(dir, 'matches.json'); fs.writeFileSync(f, JSON.stringify(snapshot));
  const code = `import json,sys,importlib.util\nspec=importlib.util.spec_from_file_location('c',${JSON.stringify(path.join(ROOT, 'tools', 'capture-to-table.py'))})\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nt,r,c=m.rows_of(json.load(open(sys.argv[1])))\nprint(json.dumps({'ticks':t,'reads':r,'cards':c}))`;
  return JSON.parse(execFileSync('python3', ['-c', code, f], { encoding: 'utf8' }));
}
const at = (h, m = 0) => new Date(Date.UTC(2026, 10, 6, h, m)).toISOString();
const card = (series, checkedAt, extra = {}) => ({ id: 'upcoming-901', p1: 'A. Alpha', p2: 'B. Beta', p1Key: 11, p2Key: 22, date: '2026-11-06',
  tournamentRound: '1/16-finals', qualifying: false, tour: 'ATP Paris', ...extra,
  oddsMovement: { chart: { books: { 'Pinnacle +30s': series }, meta: { 'Pinnacle +30s': { checkedAt, source: 'oddspapi', group: 'Sharp' } } } } });
const S1 = card({ p1: [[at(8), 1.8]], p2: [[at(8), 2.05]] }, at(9));
const S2 = card({ p1: [[at(8), 1.8], [at(10), 1.72]], p2: [[at(8), 2.05], [at(10), 2.18]] }, at(11));
const S3 = card({ p1: [[at(8), 1.8], [at(10), 1.72]], p2: [[at(8), 2.05], [at(10), 2.18]] }, at(12, 30), { id: 'past-901', finalScore: { winner: 'p1' } });
const SNAPS = [[S1], [S2], [S3]];
const START = { ms: Date.parse(at(13)), source: 'api-tennis-live' };
const NOW = Date.parse(at(18));

function gitRow() { const ev = {}; for (const s of SNAPS) B.absorb(ev, s); return B.deriveRow('901', ev['901'], START, NOW); }
function tableRow(drop = {}) {
  const u = { ticks: [], reads: [], cards: [] };
  SNAPS.forEach((s, i) => { const r = pyRows(s); for (const k of Object.keys(u)) u[k].push(...r[k].map((x) => ({ ...x, recorded_at: at(9 + i) }))); });
  if (drop.read) u.reads = u.reads.filter((r) => r.checked_at !== drop.read);
  if (drop.tick) u.ticks = u.ticks.filter((t) => t.tick_ts !== drop.tick);
  const ev = D.eventsFromTables(u);
  return B.deriveRow('901', ev['901'], START, NOW);
}

console.log('\n1 · git path vs tables path\n');
check('the tables build the identical captured close (prices, tick, start, sighting, open, result, round, flag)', () => {
  const g = gitRow(), t = tableRow();
  assert.ok(g.row && t.row, JSON.stringify({ g, t }));
  assert.deepStrictEqual(t.row, g.row);
  assert.strictEqual(g.row.p1, 1.72); assert.strictEqual(g.row.seenAt, at(12, 30)); assert.strictEqual(g.row.winner, 'p1');
});
check('CONTROL: a read missing from the tables moves the sighting — the diff names seenAt', () => {
  const g = gitRow(), t = tableRow({ read: at(12, 30) });
  const c = D.compare([g.row], new Map([['901', { date: t.row.date, ...t }]]), '2026-11-01');
  assert.strictEqual(c.differ.length, 1); assert.deepStrictEqual(Object.keys(c.differ[0].fields), ['seenAt']);
});
check('CONTROL: a tick missing from the tables moves the close — the diff names the prices', () => {
  const g = gitRow(), t = tableRow({ tick: at(10) });
  const c = D.compare([g.row], new Map([['901', { date: t.row.date, ...t }]]), '2026-11-01');
  assert.strictEqual(c.differ.length, 1); assert.ok(['p1', 'p2', 'at'].every((k) => k in c.differ[0].fields), JSON.stringify(c.differ[0].fields));
});
check('a card with no captured series writes nothing', () => {
  const r = pyRows([{ id: 'upcoming-5', p1: 'X', p2: 'Y', oddsMovement: { chart: { books: { Bet105: { p1: [[at(8), 2]] } } } } }]);
  assert.deepStrictEqual([r.ticks.length, r.reads.length, r.cards.length], [0, 0, 0]);
});

console.log('\n2 · compare\n');
check('same / differ / gitOnly / tableOnly, and the window', () => {
  const g = gitRow().row;
  const old = { ...g, eventKey: 7, date: '2026-10-01' };
  const gitOnly = { ...g, eventKey: 8 };
  const built = new Map([['901', { date: g.date, row: g }], ['902', { date: g.date, row: { ...g, eventKey: 902 } }], ['8', { date: g.date, reason: 'noStart' }]]);
  const c = D.compare([g, old, gitOnly], built, '2026-11-01');
  assert.strictEqual(c.same, 1); assert.strictEqual(c.differ.length, 0);
  assert.deepStrictEqual(c.gitOnly.map((x) => [x.eventKey, x.tableReason]), [[8, 'noStart']]);
  assert.deepStrictEqual(c.tableOnly.map((x) => x.eventKey), [902]);
});

console.log('\n3 · capture-tables.sql\n');
const SQL = fs.readFileSync(path.join(ROOT, 'capture-tables.sql'), 'utf8');
check('append-only: service_role SELECT + INSERT only, update/delete/truncate refused, RLS on', () => {
  assert.match(SQL, /grant select, insert on public\.%I to service_role/);
  assert.ok(!/grant[^;]*(update|delete|truncate)/i.test(SQL), 'a write grant');
  assert.match(SQL, /before update or delete on public\.%I for each row execute function public\.capture_forbid\(\)/);
  assert.match(SQL, /before truncate on public\.%I/);
  assert.match(SQL, /enable row level security/);
  for (const t of ['capture_tick', 'capture_read', 'capture_card']) assert.match(SQL, new RegExp(`create table if not exists public\\.${t}`));
  assert.ok(!/pinnacle_archive|oddspapi_archive_raw|historical_/.test(SQL.replace(/^--.*$/gm, '')), 'touches an archive table');
});
check('the writer inserts with ON CONFLICT DO NOTHING only', () => {
  const PY = fs.readFileSync(path.join(ROOT, 'tools', 'capture-to-table.py'), 'utf8');
  assert.match(PY, /resolution=ignore-duplicates/);
  assert.ok(!/merge-duplicates|method='(PATCH|PUT|DELETE)'/.test(PY));
});

console.log('\n4 · wiring\n');
const LOOP = fs.readFileSync(path.join(ROOT, 'odds-capture-loop.sh'), 'utf8');
const PIPE = fs.readFileSync(path.join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');
check('the capture loop writes the tables before every commit (tick and recompute)', () => {
  const commits = [...LOOP.matchAll(/\.\/ci-commit-push\.sh "chore\(odds\): capture tick/g)].map((m) => m.index);
  assert.strictEqual(commits.length, 2);
  for (const c of commits) { const w = LOOP.lastIndexOf('python3 tools/capture-to-table.py matches.json', c); assert.ok(w > 0 && c - w < 400, 'writer not right before a commit'); }
});
check('odds-history writes the tables; the archive job applies the schema; the pipeline diff is report-only', () => {
  assert.match(fs.readFileSync(path.join(ROOT, '.github/workflows/odds-history.yml'), 'utf8'), /python3 tools\/capture-to-table\.py matches\.json \|\| echo/);
  assert.match(fs.readFileSync(path.join(ROOT, '.github/workflows/ten232-kibl-archive.yml'), 'utf8'), /ten232-schema-gate\.py capture-tables\.sql/);
  assert.match(PIPE, /run: node tools\/captured-diff\.js --root \. --out \.captured-diff\.json \|\| echo/);
  assert.ok(PIPE.indexOf('node tools/captured-diff.js') > PIPE.indexOf('node build-captured-pinnacle.js'), 'the diff must follow the git build');
});

console.log(`\ncapture tables: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
