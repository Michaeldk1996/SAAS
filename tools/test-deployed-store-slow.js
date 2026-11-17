#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// deployed-store: a SLOW link finishes, a STALLED one fails fast (founder 2026-11-16, "fix both").
//
// On 16 Nov the suite failed twice in tools/test-pp2-reconcile.js: the deployed player-profiles.json (6.2 MB) came in
// at ~20 KB/s and the flat `--max-time 120` cut it at 2.7 and 4.6 MB. curlTimeArgs now abandons a download only when it
// stalls (under 1 KB/s for STALL_SEC) and keeps a generous ceiling.
//
// The REAL tools/deployed-store.js runs in a child process against a local HTTP server:
//   /slow.json    a 48 KB JSON body trickled at ~8 KB/s (6 s) — a slow but moving link
//   /stall.json   10 bytes, then nothing — a dead link
// Cases:
//   A. no timeoutSec: the slow file arrives whole (the old flat cap, scaled down to 3 s, cuts it: mutant 1).
//   B. a stall is given up after the stall window (stallSec 2), well inside the child's 40 s budget (mutant 2: no
//      stall check — the child hangs to its budget).
//   C. the defaults are a 900 s ceiling and a 1 KB/s · 60 s stall rule; an explicit timeoutSec still sets the ceiling.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const SRC = fs.readFileSync(path.join(__dirname, 'deployed-store.js'), 'utf8');
const BODY = JSON.stringify({ pad: 'x'.repeat(48 * 1024) });

function startSite() {
  const srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/slow.json') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(BODY) });
      let i = 0; const step = 2048;
      const t = setInterval(() => {
        if (i >= BODY.length) { clearInterval(t); res.end(); return; }
        res.write(BODY.slice(i, i + step)); i += step;
      }, 250);
      req.on('close', () => clearInterval(t));
      return;
    }
    if (u === '/stall.json') { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': 100000 }); res.write('{"a":"bbbb'); return; }
    res.statusCode = 404; res.end('nope');
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, base: `http://127.0.0.1:${srv.address().port}` })));
}

async function run(src) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-slow-root-'));
  fs.mkdirSync(path.join(root, 'tools'));
  const file = path.join(root, 'tools', 'deployed-store.js');
  fs.writeFileSync(file, src);
  const site = await startSite();
  const script = `const D = require(${JSON.stringify(file)});
    const t0 = Date.now(); const slow = D.fetchText('slow.json', { force: true, maxAgeMs: 0 }); const tSlow = Date.now() - t0;
    const t1 = Date.now(); const stall = D.fetchText('stall.json', { force: true, maxAgeMs: 0, stallSec: 2 }); const tStall = Date.now() - t1;
    process.stdout.write(JSON.stringify({ slowLen: slow == null ? null : slow.length, tSlow, stall, tStall,
      def: D.curlTimeArgs ? D.curlTimeArgs({}) : null, t30: D.curlTimeArgs ? D.curlTimeArgs({ timeoutSec: 30 }) : null }));`;
  const out = await new Promise((ok) => {
    const ch = spawn(process.execPath, ['-e', script], { env: Object.assign({}, process.env, { TEN206_DATA_BASE: site.base, PP2_BUILT_STORE: '' }) });
    let o = ''; ch.stdout.on('data', (d) => { o += d; });
    const kill = setTimeout(() => ch.kill('SIGKILL'), 40000);
    ch.on('close', (code) => { clearTimeout(kill); ok(code === 0 ? o : null); });
  });
  site.srv.closeAllConnections(); site.srv.close();
  fs.rmSync(root, { recursive: true, force: true });
  return out ? JSON.parse(out) : { hung: true };
}

const checks = {
  'A. a slow but moving download arrives whole': (r) => assert.strictEqual(r.slowLen, BODY.length, JSON.stringify(r)),
  'B. a stalled download is given up within the stall window (null, not a hang)': (r) => {
    assert.ok(!r.hung, 'the child hung to its 40 s budget'); assert.strictEqual(r.stall, null); assert.ok(r.tStall < 20000, 'took ' + r.tStall + ' ms');
  },
  'C. defaults: 900 s ceiling, under 1 KB/s for 60 s = a stall; an explicit timeoutSec keeps its ceiling': (r) => {
    assert.deepStrictEqual(r.def, ['--max-time', '900', '--speed-limit', '1024', '--speed-time', '60']);
    assert.deepStrictEqual(r.t30, ['--max-time', '30', '--speed-limit', '1024', '--speed-time', '60']);
  },
};
const MUTANTS = [
  ['the old flat cap (scaled to 3 s) — a slow file is cut', (s) => s.replace("return ['--max-time', String(opts.timeoutSec || DEFAULT_TIMEOUT_SEC),\n    '--speed-limit', String(STALL_BYTES_PER_SEC), '--speed-time', String(opts.stallSec || STALL_SEC)];", "return ['--max-time', String(opts.timeoutSec || 3)];")],
  ['no stall check — a dead link hangs to the ceiling', (s) => s.replace("'--speed-limit', String(STALL_BYTES_PER_SEC), '--speed-time', String(opts.stallSec || STALL_SEC)];", "];")],
];

(async () => {
  let failed = 0;
  const base = await run(SRC);
  for (const [name, fn] of Object.entries(checks)) {
    try { fn(base); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + ' — ' + e.message.slice(0, 200)); }
  }
  for (const [name, mut] of MUTANTS) {
    const src = mut(SRC);
    if (src === SRC) { failed++; console.log('  FAIL mutant did not apply: ' + name); continue; }
    const r = await run(src);
    const red = Object.values(checks).some((fn) => { try { fn(r); return false; } catch (e) { return true; } });
    if (!red) failed++;
    console.log((red ? '  ok   mutant caught: ' : '  FAIL mutant survived: ') + name);
  }
  console.log(`\ntest-deployed-store-slow: ${Object.keys(checks).length} checks, ${MUTANTS.length} mutants, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
