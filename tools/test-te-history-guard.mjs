#!/usr/bin/env node
// TEN-443 · the te-history clobber guard must go red when the store is missing, a file is gone or short, the store
// shrinks below its high-water mark, a row loses src 'te', or any script other than the builder writes the store —
// and must stay green on the real committed store. Fixtures in a temp dir; the last check runs on the repo itself.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkStore, checkWriters } from './te-history-guard.mjs';

let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('  ok   ' + n); } catch (e) { fail++; console.log('  FAIL ' + n + ' :: ' + e.message); } };
const row = (i) => ({ season: 2025, date: '2025-05-0' + (i % 9 + 1), src: 'te', won: true });
function store(edit) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'te-guard-'));
  fs.mkdirSync(path.join(d, 'te-history'));
  const players = { 1: { rows: 3 }, 2: { rows: 2 } };
  fs.writeFileSync(path.join(d, 'te-history', '1.json'), JSON.stringify({ src: 'te', rows: [row(1), row(2), row(3)] }));
  fs.writeFileSync(path.join(d, 'te-history', '2.json'), JSON.stringify({ src: 'te', rows: [row(4), row(5)] }));
  const idx = { players, totalRows: 5, highWater: { totalRows: 5, players: 2 } };
  if (edit) edit(d, idx);
  fs.writeFileSync(path.join(d, 'te-history-index.json'), JSON.stringify(idx));
  return d;
}

check('a whole store passes', () => assert.strictEqual(checkStore(store()).ok, true));
check('index missing -> red', () => { const d = store(); fs.rmSync(path.join(d, 'te-history-index.json')); assert.strictEqual(checkStore(d).ok, false); });
check('a listed player file missing -> red', () => assert.strictEqual(checkStore(store((d) => fs.rmSync(path.join(d, 'te-history', '2.json')))).ok, false));
check('a file shorter than the index -> red', () => assert.strictEqual(checkStore(store((d) => fs.writeFileSync(path.join(d, 'te-history', '1.json'), JSON.stringify({ src: 'te', rows: [row(1)] })))).ok, false));
check('store shrinks below its high-water mark (index rewritten smaller) -> red', () => {
  const d = store((dd, idx) => { delete idx.players[2]; fs.rmSync(path.join(dd, 'te-history', '2.json')); idx.totalRows = 3; });
  const r = checkStore(d); assert.strictEqual(r.ok, false, JSON.stringify(r));
});
check("a row without src 'te' -> red", () => assert.strictEqual(checkStore(store((d) => fs.writeFileSync(path.join(d, 'te-history', '2.json'), JSON.stringify({ src: 'archive', rows: [row(4), row(5)] })))).ok, false));
check('a workflow that deletes the store -> red', () => {
  const d = store(); fs.mkdirSync(path.join(d, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(d, '.github', 'workflows', 'x.yml'), 'steps:\n  - run: rm -rf te-history\n');
  assert.strictEqual(checkWriters(d).ok, false);
});
check('a pipeline script that writes the store -> red', () => {
  const d = store(); fs.writeFileSync(path.join(d, 'bsp-x.js'), "fs.writeFileSync('te-history/1.json', '{}')\n");
  assert.strictEqual(checkWriters(d).ok, false);
});
check('a reader of the store stays green', () => {
  const d = store(); fs.writeFileSync(path.join(d, 'bsp-y.js'), "const r = JSON.parse(fs.readFileSync('te-history/1.json'))\n");
  assert.strictEqual(checkWriters(d).ok, true);
});
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
check('the repo: no script outside the builder writes te-history', () => { const w = checkWriters(ROOT); assert.strictEqual(w.ok, true, w.why.join('; ')); });
if (fs.existsSync(path.join(ROOT, 'te-history-index.json'))) {
  check('the committed store passes the guard', () => { const s = checkStore(ROOT); assert.strictEqual(s.ok, true, s.why.join('; ')); });
}
console.log(`\nte-history guard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
