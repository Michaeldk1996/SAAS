// TEN-449 A — tools/actionlint.mjs: the pinned actionlint is obtained only with a matching checksum (fail closed
// otherwise), its own rules catch what GitHub's parser rejects, and the one ignore in .github/actionlint.yaml is
// scoped to one file and one message. The repo-wide run itself is the `node tools/actionlint.mjs` command in npm test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { obtainTarball, extract, lint, platformKey, workflowFiles, SHA256, VERSION, CONFIG } from './actionlint.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'actionlint-test-'));
const serve = (body) => new Promise((res) => {
  const s = http.createServer((q, r) => { r.writeHead(200); r.end(body); });
  s.listen(0, '127.0.0.1', () => res(s));
});

test('a download whose checksum does not match the pinned one is refused, and nothing is cached', async () => {
  const d = tmp();
  const s = await serve(Buffer.from('not actionlint'));
  try {
    await assert.rejects(obtainTarball({ key: 'linux_amd64', cacheDir: d, url: `http://127.0.0.1:${s.address().port}/a.tgz` }), /checksum mismatch/);
    assert.deepEqual(fs.readdirSync(d), []);
  } finally { s.close(); fs.rmSync(d, { recursive: true, force: true }); }
});

test('no network = an error that fails closed, never a skip', async () => {
  const d = tmp();
  const s = await serve('');
  const port = s.address().port;
  await new Promise((r) => s.close(r)); // nothing listens on this port now
  try {
    await assert.rejects(obtainTarball({ key: 'linux_amd64', cacheDir: d, url: `http://127.0.0.1:${port}/a.tgz`, attempts: 2, timeoutMs: 2000 }), /failing closed/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('a tampered cached tarball is thrown away and fetched again (and verified again)', async () => {
  const d = tmp();
  const good = Buffer.from('pretend tarball');
  const s = await serve(good);
  try {
    const expected = crypto.createHash('sha256').update(good).digest('hex');
    const name = `actionlint_${VERSION}_linux_amd64.tar.gz`;
    fs.writeFileSync(path.join(d, name), 'tampered');
    const f = await obtainTarball({ key: 'linux_amd64', expected, cacheDir: d, url: `http://127.0.0.1:${s.address().port}/a.tgz` });
    assert.deepEqual(fs.readFileSync(f), good);
  } finally { s.close(); fs.rmSync(d, { recursive: true, force: true }); }
});

test('only pinned platforms run; an unknown one is an error', () => {
  assert.equal(platformKey('linux', 'x64'), 'linux_amd64'); // GitHub's ubuntu-latest
  assert.equal(platformKey('darwin', 'arm64'), 'darwin_arm64');
  assert.throws(() => platformKey('win32', 'x64'), /no pinned checksum/);
  for (const v of Object.values(SHA256)) assert.match(v, /^[0-9a-f]{64}$/);
});

test('the default file set is every workflow plus tools/te-store-repo/te-refresh.yml', () => {
  const f = workflowFiles();
  assert.ok(f.length > 10);
  assert.ok(f.some((x) => x.endsWith('.github/workflows/pipeline.yml')));
  assert.ok(f.some((x) => x.endsWith('tools/te-store-repo/te-refresh.yml')));
});

// ── the real, pinned binary on mutant workflows ──────────────────────────────
let ex;
test.before(async () => { ex = extract(await obtainTarball()); });
test.after(() => { if (ex) fs.rmSync(ex.dir, { recursive: true, force: true }); });

const WF = (steps, extra = '') => `name: m\non: workflow_dispatch\n${extra}jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n${steps}\n`;
const lintText = (text, name = 'm.yml') => {
  const d = tmp();
  try {
    fs.mkdirSync(path.join(d, '.github', 'workflows'), { recursive: true });
    const f = path.join(d, '.github', 'workflows', name);
    fs.writeFileSync(f, text);
    return lint(ex.bin, [f], { cwd: d, config: CONFIG });
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
};

test('a clean workflow passes', () => {
  const r = lintText(WF('      - id: a\n        run: echo hi\n      - run: echo "${{ steps.a.outcome }}"'));
  assert.equal(r.code, 0, r.output);
});

const MUTANTS = {
  'a step output that does not exist (the steps.deploy class)': WF('      - id: a\n        run: echo hi\n      - run: echo "${{ steps.nope.outcome }}"'),
  'an unknown key GitHub refuses (runs-on misspelt)': 'name: m\non: workflow_dispatch\njobs:\n  build:\n    run-on: ubuntu-latest\n    steps:\n      - run: echo hi\n',
  'an invalid cron': 'name: m\non:\n  schedule:\n    - cron: "61 * * * *"\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n',
  'needs: a job that does not exist': 'name: m\non: workflow_dispatch\njobs:\n  build:\n    needs: nope\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n',
  'an expression syntax error': WF('      - run: echo "${{ vars.A == }}"'),
  'a step with neither run nor uses': WF('      - name: nothing'),
};
for (const [what, text] of Object.entries(MUTANTS)) {
  test(`mutant fails: ${what}`, () => {
    const r = lintText(text);
    assert.equal(r.code, 1, r.output);
    assert.match(r.output, /m\.yml:\d+:\d+: /);
  });
}

test("the .github/actionlint.yaml ignore covers pipeline.yml's steps.deploy finding only: same text under another name still fails", () => {
  const pipeline = fs.readFileSync(path.join(path.dirname(CONFIG), 'workflows', 'pipeline.yml'), 'utf8');
  assert.equal(lintText(pipeline, 'pipeline.yml').code, 0);
  const r = lintText(pipeline, 'copy.yml');
  assert.equal(r.code, 1);
  assert.match(r.output, /property "deploy" is not defined/);
  // and any OTHER finding in pipeline.yml is still reported
  const r2 = lintText(pipeline.replace("if: always() && steps.trading_splits.outcome", "if: always() && steps.trading_splitz.outcome"), 'pipeline.yml');
  assert.equal(r2.code, 1);
  assert.match(r2.output, /property "trading_splitz" is not defined/);
  // an unrelated new step (which changes the step-id list actionlint prints) doesn't bring the ignored finding back
  const r3 = lintText(pipeline.replace(/\n(\s*)- name: /, '\n$1- name: added\n$1  id: aaa_new\n$1  run: echo hi\n$1- name: '), 'pipeline.yml');
  assert.equal(r3.code, 0, r3.output);
});
