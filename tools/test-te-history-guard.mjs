#!/usr/bin/env node
// TEN-443 · the te-history clobber guard. Every check is proven on its own (each case breaks exactly one thing and
// asserts the guard names THAT thing), so removing any one check turns this red:
//   index missing · a listed file missing · a file shorter than the index · players below the high-water mark ·
//   rows below the high-water mark · a store not tagged src 'te' · shrinking against the committed index (the
//   index rewritten smaller, its own high-water mark included) · a player dropped from it ·
//   a write from a workflow, a script, a composite action, a .py/.cjs file, writeJsonAtomic, an async fs call,
//   or through a constant that holds the store's path.
// A reader stays green; the real repo has no writer but the builder.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkStore, checkWriters } from './te-history-guard.mjs';

let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('  ok   ' + n); } catch (e) { fail++; console.log('  FAIL ' + n + ' :: ' + e.message); } };
const row = (i) => [2025, '2025-05-0' + (i % 9 + 1), 'Rome', 'ATP', '1R', 'clay', 'outdoor', 'X Y.', 'x', 1, '6-1, 6-1', 0, 0, null, 0];
const write = (d, k, rows, src = 'te') => fs.writeFileSync(path.join(d, 'te-history', `${k}.json`), JSON.stringify({ src, rows }));
function store(edit) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'te-guard-'));
  fs.mkdirSync(path.join(d, 'te-history'));
  write(d, 1, [row(1), row(2), row(3)]); write(d, 2, [row(4), row(5)]);
  const idx = { players: { 1: { rows: 3 }, 2: { rows: 2 } }, totalRows: 5, highWater: { totalRows: 5, players: 2 } };
  if (edit) edit(d, idx);
  fs.writeFileSync(path.join(d, 'te-history-index.json'), JSON.stringify(idx));
  return d;
}
const why = (d, opts) => checkStore(d, opts).why.join(' | ');
const only = (d, re, opts) => { const r = checkStore(d, opts); assert.strictEqual(r.ok, false, 'guard passed'); assert.ok(r.why.length === 1 && re.test(r.why[0]), r.why.join(' | ')); };

check('a whole store passes', () => assert.strictEqual(checkStore(store()).ok, true, why(store())));
check('index missing -> red', () => { const d = store(); fs.rmSync(path.join(d, 'te-history-index.json')); only(d, /missing or unreadable/); });
check('a listed player file missing -> red (and only that)', () => only(store((d, idx) => { fs.rmSync(path.join(d, 'te-history', '2.json')); idx.highWater.totalRows = 3; }), /2\.json missing/));
check('a file shorter than the index -> red (and only that)', () => only(store((d, idx) => { write(d, 1, [row(1)]); idx.highWater.totalRows = 3; }), /holds 1 rows, the index records 3/));
check('players below the high-water mark -> red (and only that)', () => only(store((d, idx) => { idx.highWater.players = 3; }), /index lists 2 players, high-water 3/));
check('rows below the high-water mark -> red (and only that)', () => only(store((d, idx) => { idx.highWater.totalRows = 9; }), /store holds 5 rows, high-water 9/));
check("a store not tagged src 'te' -> red (and only that)", () => only(store((d) => write(d, 2, [row(4), row(5)], 'archive')), /not tagged src 'te'/));
check('the index rewritten smaller, high-water mark and all, is caught against the committed index', () => {
  const prev = { players: { 1: { rows: 3 }, 2: { rows: 2 } }, totalRows: 5, highWater: { totalRows: 5, players: 2 } };
  const d = store((dd, idx) => { fs.rmSync(path.join(dd, 'te-history', '2.json')); delete idx.players[2]; idx.totalRows = 3; idx.highWater = { totalRows: 3, players: 1 }; });
  assert.strictEqual(checkStore(d).ok, true, 'without the committed index the rewrite looks whole — that is the gap');
  const r = checkStore(d, { prev }); assert.strictEqual(r.ok, false);
  assert.ok(/committed index listed 2/.test(r.why.join()) && /committed store held 5/.test(r.why.join()) && /player 2 dropped/.test(r.why.join()), r.why.join(' | '));
});
check('an empty index {"players":{}} against the committed index -> red', () => {
  const d = store((dd, idx) => { idx.players = {}; idx.totalRows = 0; idx.highWater = {}; });
  assert.strictEqual(checkStore(d, { prev: { players: { 1: {}, 2: {} }, totalRows: 5 } }).ok, false);
});
function writerCase(rel, body) {
  const d = store(); fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), body);
  return checkWriters(d);
}
for (const [name, rel, body] of [
  ['a workflow step that deletes it', '.github/workflows/x.yml', 'steps:\n  - run: rm -rf te-history\n'],
  ['a composite action that moves it', '.github/actions/a/action.yml', 'runs:\n  steps:\n    - run: mv te-history /tmp/x\n'],
  ['a pipeline script writeFileSync', 'bsp-x.js', "fs.writeFileSync('te-history/1.json', '{}')\n"],
  ["the pipeline's writeJsonAtomic", 'bsp-y.js', "writeJsonAtomic('te-history-index.json', {})\n"],
  ['an async fs.promises.unlink', 'tools/z.mjs', "await fs.promises.unlink('te-history/1.json')\n"],
  ['a write through a path constant', 'bsp-z.js', "const STORE = 'te-history';\nfs.rmSync(STORE, { recursive: true });\n"],
  // TEN-449: the pipeline builds its store paths with path.join(TE_STORE_DIR, 'te-history')
  ['a write through a joined path constant', 'bsp-j.js', "const TE_HISTORY_INDEX = require('path').join(TE_STORE_DIR, 'te-history-index.json');\nfs.writeFileSync(TE_HISTORY_INDEX, '{}');\n"],
  ['a .py script', 'scripts/w.py', "open('te-history/1.json', 'w').write('{}')\n"],
  ['a .cjs script', 'tools/w.cjs', "require('fs').writeFileSync('te-history-index.json', '{}')\n"],
]) check(`writer: ${name} -> red`, () => assert.strictEqual(writerCase(rel, body).ok, false));
check('a reader of the store stays green', () => assert.strictEqual(writerCase('bsp-r.js', "const TE_HISTORY_DIR = 'te-history';\nJSON.parse(fs.readFileSync(`${TE_HISTORY_DIR}/1.json`))\n").ok, true));
// TEN-449: in the store repo the refresh checks SAAS out into saas/ (its own repository, guarded by its own CI); the
// control — the same file with no .git beside it — is still a writer
check('a nested git checkout (the store refresh\'s saas/) is not scanned; the same file outside a checkout is', () => {
  const body = "fs.writeFileSync('te-history/1.json', '{}')\n";
  const d = store(); fs.mkdirSync(path.join(d, 'saas', '.git'), { recursive: true }); fs.mkdirSync(path.join(d, 'saas', 'tools'));
  fs.writeFileSync(path.join(d, 'saas', 'tools', 'w.mjs'), body);
  assert.strictEqual(checkWriters(d).ok, true, checkWriters(d).why.join('; '));
  assert.strictEqual(writerCase('saas/tools/w.mjs', body).ok, false, 'control: no .git, the writer must be named');
});
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
check('the repo: no script, workflow or action outside the builder writes te-history', () => { const w = checkWriters(ROOT); assert.strictEqual(w.ok, true, w.why.join('; ')); });
if (fs.existsSync(path.join(ROOT, 'te-history-index.json'))) {
  check('the committed store passes the guard', () => { const s = checkStore(ROOT); assert.strictEqual(s.ok, true, s.why.join('; ')); });
}
console.log(`\nte-history guard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
