#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// TEN-255 — the build stamp, and the check that reads it.
//
// TWO THINGS THIS FILE REFUSES TO DO, both because they have burned us before:
//
//  1. It does not re-implement the stamping rule. It EXTRACTS the real `node -e`
//     block out of .github/workflows/pipeline.yml and executes it through a real
//     shell, with the same single-quote wrapping the workflow uses. A test that
//     copies the rule passes happily after someone reverts the rule.
//
//  2. It does not stub the dashboard HTML. It copies the real
//     bsp-consult-dashboard.html into the sandbox, so the anchor this depends on
//     is the anchor that actually ships. A stub with a hand-written
//     <meta charset> would keep passing after the real file's head changed.
//
// The negative cases are the point. Founder ruling on this ticket: a stamp
// reading "unknown" or "" is WORSE than a missing file, because it reads as a
// real answer. So the bad-SHA cases assert that NOTHING was written, not merely
// that the step failed.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { execFileSync, spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const WORKFLOW = path.join(REPO, '.github', 'workflows', 'pipeline.yml');
const DASHBOARD = path.join(REPO, 'bsp-consult-dashboard.html');
const CHECKER = path.join(REPO, 'tools', 'check-live-build.sh');

let pass = 0; const fails = [];
function check(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fails.push(name); console.error(`  FAIL ${name}\n       ${e.message}`); }
}

// ── Extract the real stamp block ────────────────────────────────────────────
const SRC = fs.readFileSync(WORKFLOW, 'utf8');
const BLOCK = (() => {
  const re = /\n\s*node -e '\n([\s\S]*?)\n\s*'\n/g;
  let m;
  while ((m = re.exec(SRC)) !== null) {
    if (m[1].includes('_site/build-info.json') && m[1].includes('build-sha')) return m[1];
  }
  return null;
})();

check('the stamp block is still findable in pipeline.yml', () => {
  assert.ok(BLOCK,
    'no node -e block in pipeline.yml writes both _site/build-info.json and a build-sha meta tag. '
    + 'Either the stamp was removed or it was restructured out of reach of this test — '
    + 'every case below would be vacuous, so this fails loudly instead.');
});
if (!BLOCK) { console.error('\nFAILED: stamp block not found'); process.exit(1); }

// ── Run the real block the way the workflow runs it ─────────────────────────
function runStamp(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten255-'));
  fs.mkdirSync(path.join(dir, '_site'));
  const html = fs.readFileSync(DASHBOARD);
  fs.writeFileSync(path.join(dir, '_site', 'index.html'), html);
  fs.writeFileSync(path.join(dir, '_site', 'bsp-consult-dashboard.html'), html);
  if (env.__stripAnchorFrom) {
    const f = path.join(dir, '_site', env.__stripAnchorFrom);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('<meta charset="UTF-8">', '<meta charset="utf-8">'));
  }
  // Single-quote wrapping identical to the workflow's, so shell quoting is in scope.
  const script = `set -uo pipefail\nnode -e '\n${BLOCK}\n'\n`;
  const r = spawnSync('/bin/bash', ['-c', script], {
    cwd: dir,
    env: { ...process.env, GITHUB_EVENT_NAME: 'schedule', GITHUB_RUN_ID: '1', GITHUB_RUN_NUMBER: '1', ...env },
    encoding: 'utf8',
  });
  const read = f => {
    const p = path.join(dir, '_site', f);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  };
  const metas = f => {
    const s = read(f);
    return s === null ? null : [...s.matchAll(/<meta name="build-sha" content="([0-9a-f]{40})">/g)].map(m => m[1]);
  };
  return {
    status: r.status, stderr: r.stderr || '', stdout: r.stdout || '', dir,
    info: read('build-info.json'),
    metaIndex: metas('index.html'),
    metaDash: metas('bsp-consult-dashboard.html'),
  };
}

const GOOD = 'a0913224bc15ce8c7fe8a620f7ffc9dc78beb7d7';

// ── The happy path ──────────────────────────────────────────────────────────
const ok = runStamp({ SHA: GOOD, TIP: GOOD, BEHIND: '0', VERIFIED: 'true' });

check('a real SHA stamps build-info.json with that exact commit', () => {
  assert.strictEqual(ok.status, 0, `exit ${ok.status}\n${ok.stderr}`);
  assert.ok(ok.info, 'build-info.json was not written');
  assert.strictEqual(JSON.parse(ok.info).commit, GOOD);
});

check('both published dashboard copies carry exactly one build-sha meta tag', () => {
  assert.deepStrictEqual(ok.metaIndex, [GOOD], `index.html: ${JSON.stringify(ok.metaIndex)}`);
  assert.deepStrictEqual(ok.metaDash, [GOOD], `bsp-consult-dashboard.html: ${JSON.stringify(ok.metaDash)}`);
});

check('the meta tag and build-info.json cannot disagree — same 40-char value in both', () => {
  const fromJson = JSON.parse(ok.info).commit;
  assert.strictEqual(ok.metaIndex[0], fromJson,
    `meta says ${ok.metaIndex[0]}, build-info.json says ${fromJson}`);
  assert.match(fromJson, /^[0-9a-f]{40}$/, 'the published form must be the FULL sha, not short');
});

check('the tag lands inside <head>, where a DOM read will find it', () => {
  const head = fs.readFileSync(path.join(ok.dir, '_site', 'index.html'), 'utf8').slice(0, 2000);
  assert.ok(head.includes(`<meta name="build-sha" content="${GOOD}">`),
    'the tag is not in the first 2 KB — it may have landed outside <head>');
});

// ── The negative cases: nothing written, not a placeholder ──────────────────
for (const [label, sha] of [['the string "unknown"', 'unknown'], ['an empty string', ''], ['a short sha', GOOD.slice(0, 7)]]) {
  check(`${label} writes NOTHING and fails the step`, () => {
    const r = runStamp({ SHA: sha, TIP: '', BEHIND: '-1', VERIFIED: 'false' });
    assert.notStrictEqual(r.status, 0, `exit was 0 — a bad SHA deployed silently\n${r.stdout}`);
    assert.strictEqual(r.info, null,
      `build-info.json WAS written (${r.info}). A stamp containing a placeholder reads as a real answer and is worse than absence.`);
    assert.deepStrictEqual(r.metaIndex, [], 'index.html was stamped anyway');
    assert.deepStrictEqual(r.metaDash, [], 'bsp-consult-dashboard.html was stamped anyway');
  });
}

check('a missing anchor fails the step rather than publishing an unstamped dashboard', () => {
  const r = runStamp({ SHA: GOOD, TIP: GOOD, BEHIND: '0', VERIFIED: 'true', __stripAnchorFrom: 'bsp-consult-dashboard.html' });
  assert.notStrictEqual(r.status, 0,
    'exit was 0 — the dashboard would ship with no build-sha while build-info.json claimed a commit');
  assert.deepStrictEqual(r.metaDash, [], 'the anchorless file was somehow stamped');
});

check('the real dashboard still has the anchor the stamp depends on', () => {
  const head = fs.readFileSync(DASHBOARD, 'utf8').slice(0, 4000);
  const n = (head.match(/<meta charset="UTF-8">/g) || []).length;
  assert.strictEqual(n, 1,
    `bsp-consult-dashboard.html has ${n} <meta charset="UTF-8"> in its head, expected exactly 1`);
});

// ── The checker's three exit codes, mismatch path included ──────────────────
//
// The server runs OUT OF PROCESS on purpose. An http.createServer in this
// process cannot answer, because spawnSync blocks the event loop that would
// accept the connection — curl then fails to connect and the checker returns 2.
// That is not a harmless bug in a test: `UNDETERMINED` is a legal exit code
// here, so the two exit-2 cases below PASSED while never once exercising the
// paths they name. The readiness poll is what keeps them honest.
const CTL = fs.mkdtempSync(path.join(os.tmpdir(), 'ten255-srv-'));
const RESP = path.join(CTL, 'response.json');
const SERVER_JS = `
  const fs = require("fs"), http = require("http");
  http.createServer((req, res) => {
    if (req.url === "/__ready") { res.writeHead(200); return res.end("ready"); }
    let r;
    try { r = JSON.parse(fs.readFileSync(${JSON.stringify(RESP)}, "utf8")); }
    catch { res.writeHead(500); return res.end("no response configured"); }
    res.writeHead(r.status, { "Content-Type": "application/json" });
    res.end(r.body);
  }).listen(Number(process.argv[1]), "127.0.0.1");
`;

const PORT = 38000 + (process.pid % 2000);
const server = require('child_process').spawn(process.execPath, ['-e', SERVER_JS, String(PORT)], {
  stdio: 'ignore', detached: false,
});
process.on('exit', () => { try { server.kill(); } catch {} });

// Block until it actually answers. Without this the cases below are vacuous.
let ready = false;
for (let i = 0; i < 100 && !ready; i++) {
  const r = spawnSync('curl', ['-fsS', '--max-time', '1', `http://127.0.0.1:${PORT}/__ready`], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim() === 'ready') ready = true;
  else spawnSync('/bin/bash', ['-c', 'sleep 0.05']);
}

check('the local stamp server is actually answering (guards every case below)', () => {
  assert.ok(ready,
    `no response from http://127.0.0.1:${PORT}/__ready after ~5s. Every checker case below would `
    + 'return UNDETERMINED for the wrong reason and two of them would pass vacuously.');
});

function serveAndCheck(body, expectedArg, status = 200) {
  fs.writeFileSync(RESP, JSON.stringify({ body, status }));
  const args = expectedArg ? [CHECKER, expectedArg] : [CHECKER];
  const r = spawnSync('/bin/bash', args, {
    cwd: REPO, encoding: 'utf8',
    env: { ...process.env, SITE_URL: `http://127.0.0.1:${PORT}` },
  });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const HEAD = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
const PREV = execFileSync('git', ['rev-parse', 'HEAD~1'], { cwd: REPO, encoding: 'utf8' }).trim();
const stamp = c => JSON.stringify({ commit: c, tip: c, behindTip: 0, onMain: true, builtAt: '2026-09-23T00:00:00.000Z' });

check('checker exits 0 when the live sha IS your commit', () => {
  const r = serveAndCheck(stamp(HEAD), HEAD);
  assert.strictEqual(r.status, 0, `exit ${r.status}\n${r.out}`);
  assert.match(r.out, /MATCH/);
});

check('checker exits 0 when your commit is an ANCESTOR of the live sha', () => {
  // The everyday case: a later data tick restamped the site, your bytes are still there.
  const r = serveAndCheck(stamp(HEAD), PREV);
  assert.strictEqual(r.status, 0, `exit ${r.status}\n${r.out}`);
  assert.match(r.out, /CONTAINED/);
});

// THE MISMATCH PATH. Without this the suite would pass on a checker that returns
// 0 unconditionally.
check('checker exits 1 on a deliberately wrong sha (the mismatch path)', () => {
  const r = serveAndCheck(stamp(PREV), HEAD);   // live is OLDER than ours => not contained
  assert.strictEqual(r.status, 1,
    `expected exit 1 MISMATCH, got ${r.status}. A checker that cannot report a mismatch is not a check.\n${r.out}`);
  assert.match(r.out, /MISMATCH/);
});

check('checker exits 2 (a dash, not a pass) when the stamp is unreadable', () => {
  const r = serveAndCheck('<html>404</html>', HEAD, 404);
  assert.strictEqual(r.status, 2,
    `expected exit 2 UNDETERMINED, got ${r.status}. An unreadable stamp must never read as a pass or a regression.\n${r.out}`);
  assert.match(r.out, /UNDETERMINED/);
});

check('checker exits 2 on a 200 that is not a build stamp', () => {
  const r = serveAndCheck('{"commit":"unknown"}', HEAD);
  assert.strictEqual(r.status, 2, `expected exit 2, got ${r.status}\n${r.out}`);
});

// Kill the server explicitly. A live child holds the event loop open, and this
// file is one `&&` link in a 60-suite `npm test` — a hang here stalls the whole
// deploy gate rather than failing it, which is the worse of the two.
try { server.kill('SIGKILL'); } catch {}
try { fs.rmSync(CTL, { recursive: true, force: true }); } catch {}

console.log(`\nTEN-255 build stamp: ${pass} pass, ${fails.length} fail`);
if (fails.length) { console.error('FAILED: ' + fails.join(' · ')); process.exit(1); }
process.exit(0);
