// TEN-449 B — mutants for tools/test-workflow-expr-length.mjs: every scalar form of `run:` and `with: script:` that holds
// an expression is measured and flagged past 18,000 chars; the same value without an expression, or under the limit,
// passes; a sibling key of the step is never swallowed into the value. Also: the 19 Oct incident file (893f7d43e) fails
// and today's workflow files pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanText, checkFiles, defaultFiles, HEADROOM } from './test-workflow-expr-length.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPR = '${{ vars.TE_INGEST }}';
const pad = (n) => 'x'.repeat(n);
const LONG = HEADROOM + 1000, SHORT = HEADROOM - 1000;

const wf = (steps) => `name: m\non: workflow_dispatch\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n${steps}\n      - name: after\n        run: echo done\n`;
// Each form builds a step whose run/script value is about `n` chars long and holds an expression when `e` is true.
const FORMS = {
  'run: | block': (n, e) => `      - name: s\n        run: |\n          ${e ? EXPR : ''}${pad(n)}\n          echo two`,
  'run: >- folded block': (n, e) => `      - name: s\n        run: >-\n          ${e ? EXPR : ''}${pad(n)}`,
  '- run: | (run first in the step)': (n, e) => `      - run: |\n          ${e ? EXPR : ''}${pad(n)}\n        name: s`,
  'run: single-line plain': (n, e) => `      - name: s\n        run: echo ${e ? EXPR : ''}${pad(n)}`,
  '- run: single-line plain': (n, e) => `      - run: echo ${e ? EXPR : ''}${pad(n)}\n        name: s`,
  'run: "double-quoted"': (n, e) => `      - name: s\n        run: "echo ${e ? EXPR : ''}${pad(n)}"`,
  "run: 'single-quoted'": (n, e) => `      - name: s\n        run: 'echo ${e ? EXPR : ''}${pad(n)}'`,
  'run: plain continued over lines': (n, e) => `      - name: s\n        run: echo a\n          ${e ? EXPR : ''}${pad(n)}`,
  'run: "double-quoted" over lines': (n, e) => `      - name: s\n        run: "echo a\n          ${e ? EXPR : ''}${pad(n)}"`,
  'with: script: | block': (n, e) => `      - uses: actions/github-script@v7\n        with:\n          script: |\n            ${e ? EXPR : ''}${pad(n)}`,
  'with: script: single-line': (n, e) => `      - uses: actions/github-script@v7\n        with:\n          script: core.info('${e ? EXPR : ''}${pad(n)}')`,
  'with: script: "quoted"': (n, e) => `      - uses: actions/github-script@v7\n        with:\n          github-token: x\n          script: "core.info('${e ? EXPR : ''}${pad(n)}')"`,
};

for (const [form, make] of Object.entries(FORMS)) {
  test(`${form}: long with an expression is flagged`, () => {
    const v = scanText(wf(make(LONG, true))).filter((x) => x.expr);
    assert.equal(v.length, 1, JSON.stringify(v));
    assert.ok(v[0].len > HEADROOM, `measured ${v[0].len}`);
    assert.equal(v[0].key, form.includes('script') ? 'with.script' : 'run');
  });
  test(`${form}: long WITHOUT an expression, or with one under the limit, passes`, () => {
    assert.equal(scanText(wf(make(LONG, false))).filter((x) => x.expr).length, 0);
    const v = scanText(wf(make(SHORT, true))).filter((x) => x.expr);
    assert.equal(v.length, 1);
    assert.ok(v[0].len <= HEADROOM && v[0].len > SHORT - 100, `measured ${v[0].len}`);
  });
}

test('a sibling key after a single-line run is not part of the value', () => {
  const v = scanText(wf(`      - run: echo ${EXPR}\n        env:\n          BIG: "${pad(LONG)}"`));
  assert.equal(v.find((x) => x.expr).len, `echo ${EXPR}`.length);
});

test('script: outside with: (an env var) and a job named `run` are not values; steps under the job still are', () => {
  const t = `jobs:\n  run:\n    runs-on: ubuntu-latest\n    env:\n      script: "${EXPR}${pad(LONG)}"\n    steps:\n      - run: echo ${EXPR}${pad(LONG)}\n`;
  const v = scanText(t);
  assert.deepEqual(v.map((x) => [x.key, x.line]), [['run', 7]]);
});

test('run/script keys in forms the guard cannot measure fail closed (flow mapping, quoted key, space before colon)', () => {
  const odd = {
    'flow-mapping step': `      - { name: s, run: "${EXPR}" }`,
    'flow-mapping with': `      - uses: actions/github-script@v7\n        with: { script: "${EXPR}" }`,
    'double-quoted key': `      - "run": echo ${EXPR}`,
    'single-quoted key': `      - 'run': echo ${EXPR}`,
    'space before colon': `      - run : echo ${EXPR}`,
  };
  for (const [name, step] of Object.entries(odd)) {
    const v = scanText(wf(step));
    assert.ok(v.some((x) => x.unmeasured), `${name}: not flagged`);
  }
  // the plain block-style forms are measured, not flagged as unmeasured
  assert.ok(!scanText(wf(`      - run: echo ${EXPR}`)).some((x) => x.unmeasured));
});

test('checkFiles flags a mutant file and names the line', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'exprlen-'));
  try {
    const f = path.join(d, 'm.yml');
    fs.writeFileSync(f, wf(FORMS['run: single-line plain'](LONG, true)));
    const r = checkFiles([f]);
    assert.equal(r.fails.length, 1);
    assert.match(r.fails[0], /m\.yml:8: run value with an inline expression is \d+ chars/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("today's workflow files pass, including tools/te-store-repo/te-refresh.yml", () => {
  const files = defaultFiles();
  assert.ok(files.some((f) => f.endsWith('te-refresh.yml')));
  assert.deepEqual(checkFiles(files).fails, []);
});

// The 19 Oct incident: 893f7d43e put TE_INGEST='${{ vars.TE_INGEST }}' inline into a 25,754-char run block.
const cliFails = (text) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'exprlen-'));
  try {
    const f = path.join(d, 'pipeline.yml');
    fs.writeFileSync(f, text);
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/test-workflow-expr-length.mjs'), f], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /run value with an inline expression is \d{5} chars/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
};

test("the incident's shape on today's pipeline.yml: an inline expression in its largest run block fails via the CLI", () => {
  const today = fs.readFileSync(path.join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');
  const big = scanText(today).filter((v) => !v.expr).sort((a, b) => b.len - a.len)[0];
  const L = today.split('\n');
  const ind = L[big.line].match(/^(\s*)/)[1];
  L[big.line] = `${ind}TE_INGEST='${EXPR}' ${L[big.line].slice(ind.length)}`; // its first content line, as 893f7d43e did
  // if someone shrinks that block below the limit, pad it so the test still exercises the shape (TEN-449 review)
  if (big.len <= HEADROOM) L.splice(big.line + 1, 0, `${ind}# ${pad(LONG - big.len)}`);
  cliFails(L.join('\n'));
});

test("the incident's own pipeline.yml (893f7d43e) fails via the CLI", (t) => {
  const show = spawnSync('git', ['show', '893f7d43e:.github/workflows/pipeline.yml'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // ci-suite clones --depth 100, so the commit can be out of reach there; the test above covers the same shape.
  if (show.status !== 0) { t.skip('893f7d43e is not in this (shallow) clone'); return; }
  cliFails(show.stdout);
});
