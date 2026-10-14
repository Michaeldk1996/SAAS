// The sandbox skip of test-pp2-reconcile (founder 2026-10-14, item 5): an unreachable deployed site SKIPS out loud in
// the cloud sandbox only. Control: the same unreachable site with CI set (the GitHub gate) still aborts red, and so does
// a plain local run without the sandbox marker. Each case runs the real suite against a dead address.
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
// The suite runs from an ISOLATED root: every top-level repo entry symlinked except .deployed-cache, and the two tools
// copied (deployed-store.js keys its cache on its own directory), so a cache another suite filled cannot answer here.
const REPO = path.join(__dirname, '..');
const ISO = fs.mkdtempSync(path.join(os.tmpdir(), 'pp2skip-root-'));
for (const e of fs.readdirSync(REPO)) if (e !== '.deployed-cache' && e !== 'tools' && e !== '.git') fs.symlinkSync(path.join(REPO, e), path.join(ISO, e));
fs.mkdirSync(path.join(ISO, 'tools'));
for (const f of ['test-pp2-reconcile.js', 'deployed-store.js']) fs.copyFileSync(path.join(__dirname, f), path.join(ISO, 'tools', f));
const SUITE = path.join(ISO, 'tools', 'test-pp2-reconcile.js');
let pass = 0, fail = 0;
function run(extra) {
  const env = Object.assign({}, process.env, { TEN206_DATA_BASE: 'http://127.0.0.1:9' });
  for (const k of ['CI', 'GITHUB_ACTIONS', 'CCR_AGENT_PROXY_ENABLED', 'STENNISFY_SANDBOX', 'TEN206_BUILT_DIR']) delete env[k];
  Object.assign(env, extra);
  return spawnSync(process.execPath, [SUITE], { env, encoding: 'utf8', timeout: 120000 });
}
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + '\n        ' + detail); } }
const a = run({ STENNISFY_SANDBOX: '1' });
check('sandbox + unreachable site → exit 0 with a SKIP line that says it is not a pass',
  a.status === 0 && /SKIP\s+test-pp2-reconcile/.test(a.stdout) && /NOT A PASS/.test(a.stdout), `status ${a.status}: ${(a.stdout + a.stderr).slice(-300)}`);
const b = run({ STENNISFY_SANDBOX: '1', CI: 'true' });
check('CI set (the GitHub gate) → still aborts red, no skip', b.status === 1 && !/SKIP\s+test-pp2-reconcile/.test(b.stdout), `status ${b.status}`);
const c = run({});
check('no sandbox marker → still aborts red', c.status === 1 && /COULD NOT READ/.test(c.stderr), `status ${c.status}`);
fs.rmSync(ISO, { recursive: true, force: true });
console.log(`\ntest-pp2-sandbox-skip: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
