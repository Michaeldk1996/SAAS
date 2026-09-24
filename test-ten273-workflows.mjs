// TEN-273 item 1 — deploys never wait behind data jobs.
//  (a) pipeline.yml's concurrency group is used by no other workflow (GitHub
//      groups are repo-wide strings: a shared string would queue the deploy
//      behind a 330-min odds loop);
//  (b) every job in every workflow carries timeout-minutes, so no loop can hold
//      a runner forever (the 6-hour GitHub default is not a budget).
// Reads the real workflow files; a job added without a timeout turns this red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.github', 'workflows');
const files = fs.readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));

function groups(src) {
  const out = [];
  const re = /^[ \t]*concurrency:[ \t]*\n[ \t]+group:[ \t]*(.+)$/gm;
  let m;
  while ((m = re.exec(src))) out.push(m[1].trim().replace(/^['"]|['"]$/g, ''));
  const inline = /^[ \t]*concurrency:[ \t]*([^\s#][^\n#]*)$/gm;
  while ((m = inline.exec(src))) out.push(m[1].trim().replace(/^['"]|['"]$/g, ''));
  return out;
}

// Top-level jobs block: job keys at 2-space indent; a job's own keys at 4.
function jobs(src) {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start < 0) return [];
  const out = [];
  let cur = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l)) break;                              // next top-level key
    const k = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l);
    if (k) { cur = { name: k[1], keys: new Set() }; out.push(cur); continue; }
    const kk = /^ {4}([A-Za-z0-9_-]+):/.exec(l);
    if (cur && kk) cur.keys.add(kk[1]);
  }
  return out;
}

test('the parser sees jobs (not vacuous): pipeline.yml has a timed job', () => {
  const js = jobs(fs.readFileSync(path.join(DIR, 'pipeline.yml'), 'utf8'));
  assert.ok(js.length >= 1);
  assert.ok(js.some((j) => j.keys.has('timeout-minutes')));
});

test('pipeline.yml concurrency group is its own', () => {
  const mine = groups(fs.readFileSync(path.join(DIR, 'pipeline.yml'), 'utf8'));
  assert.deepEqual(mine, ['bsp-pipeline']);
  for (const f of files.filter((x) => x !== 'pipeline.yml')) {
    assert.ok(!groups(fs.readFileSync(path.join(DIR, f), 'utf8')).includes('bsp-pipeline'), `${f} shares the deploy's concurrency group`);
  }
});

test('every job in every workflow has timeout-minutes', () => {
  const missing = [];
  let n = 0;
  for (const f of files) {
    for (const j of jobs(fs.readFileSync(path.join(DIR, f), 'utf8'))) {
      if (j.keys.has('uses')) continue;                    // reusable-workflow call: the callee's jobs carry it
      n++;
      if (!j.keys.has('timeout-minutes')) missing.push(`${f}:${j.name}`);
    }
  }
  assert.ok(n > 30, `only ${n} jobs parsed — the parser is not reading the files`);
  assert.deepEqual(missing, []);
});
