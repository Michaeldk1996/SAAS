#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// TEN-273 — deployed-store fetchShards: ONE retry per failed shard, then fail closed.
//
// FOUNDER, 2026-09-25: "Wire the proposal in tools/deployed-store.js fetchShards: one more fetch
// per failed key, one at a time. Still failing means abort, exactly as today (fail-closed).
// Tests: fail once → passes; fail twice → aborts. Name the mutant that breaks each."
//
// Measured before: 37 pipeline ticks aborted 2026-09-19..25 at the tournament-history hydrate
// gate (tools/test-pp2-reconcile.js), a different single shard each time.
//
// The REAL tools/deployed-store.js runs in a child process (it shells out to curl
// synchronously, so the fake site must live in another process) against a local HTTP server:
//   ok1    served every time
//   flaky  500 on the first request, served on the second
//   dead   500 every time
// Cases:
//   A. fail once → passes: flaky attaches; every indexed player hydrates (the gate passes).
//   B. fail twice → aborts: dead stays missing, attached < indexed (the gate aborts).
//   C. one more fetch, not more: flaky and dead are each requested exactly twice.
// Each case is then run against named mutants of the real source; every mutant must fail it.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const SRC = path.join(__dirname, 'deployed-store.js');
const SHARD = (k) => JSON.stringify({ key: k, tournamentHistory: [{ name: 'T', won: 1, lost: 0 }] });

function startSite() {
  const hits = {};
  const srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    hits[u] = (hits[u] || 0) + 1;
    if (u === '/tournament-history-index.json') { res.end(JSON.stringify({ players: { ok1: { n: 1 }, flaky: { n: 1 }, dead: { n: 1 } } })); return; }
    const m = /^\/tournament-history\/(\w+)\.json$/.exec(u);
    if (!m) { res.statusCode = 404; res.end('nope'); return; }
    const k = m[1];
    if (k === 'dead' || (k === 'flaky' && hits[u] === 1)) { res.statusCode = 500; res.end('<html>502 Bad Gateway</html>'); return; }
    res.end(SHARD(k));
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, hits, base: `http://127.0.0.1:${srv.address().port}` })));
}

// Run one hydrate through the given copy of deployed-store.js; → { th, hits }.
async function hydrate(storeFile) {
  const site = await startSite();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ten273-shard-'));
  const script = `const D = require(${JSON.stringify(storeFile)});
    const players = { ok1: {}, flaky: {}, dead: {} };
    const th = D.hydrateTournamentHistory(players, { dir: ${JSON.stringify(path.join(work, 'th'))}, force: true, maxAgeMs: 0, timeoutSec: 10 });
    process.stdout.write(JSON.stringify(th));`;
  const out = await new Promise((ok, bad) => {
    const ch = spawn(process.execPath, ['-e', script], { env: Object.assign({}, process.env, { TEN206_DATA_BASE: site.base }) });
    let o = '', e = '';
    ch.stdout.on('data', (d) => { o += d; }); ch.stderr.on('data', (d) => { e += d; });
    ch.on('close', (code) => (code === 0 ? ok(o) : bad(new Error(`child exit ${code}: ${e.slice(-400)}`))));
  });
  site.srv.closeAllConnections(); site.srv.close();
  fs.rmSync(work, { recursive: true, force: true });
  return { th: JSON.parse(out), hits: site.hits };
}

const CASES = {
  'A. fail once → passes (the flaky shard attaches on its one retry)': ({ th }) => {
    assert.ok(!th.error, th.error);
    assert.ok(!th.missing.includes('flaky'), `flaky missing: ${JSON.stringify(th.missing)}`);
    assert.strictEqual(th.retried, 2, 'flaky and dead were each retried once');
  },
  'B. fail twice → aborts (dead stays missing; the gate attached < indexed holds)': ({ th }) => {
    assert.deepStrictEqual(th.missing, ['dead']);
    assert.strictEqual(th.indexed, 3);
    assert.strictEqual(th.attached, 2);
    assert.ok(th.attached < th.indexed, 'the caller (tools/test-pp2-reconcile.js) aborts on attached < indexed');
  },
  'C. one more fetch, not more (each failing shard is requested exactly twice)': ({ hits }) => {
    assert.strictEqual(hits['/tournament-history/flaky.json'], 2);
    assert.strictEqual(hits['/tournament-history/dead.json'], 2);
    assert.strictEqual(hits['/tournament-history/ok1.json'], 1);
  },
};

// Named mutants of the real source: each must turn at least its named case red.
const MUTANTS = [
  ['no retry at all', 'A. fail once → passes (the flaky shard attaches on its one retry)',
    'const retried = failed.splice(0);', 'const retried = [];'],
  ['the retry fails OPEN (a shard that failed twice is accepted)', 'B. fail twice → aborts (dead stays missing; the gate attached < indexed holds)',
    "if (!t || t.trim().charAt(0) !== '{') failed.push(k); else ok.set(k, t);", "ok.set(k, t && t.trim().charAt(0) === '{' ? t : '{\"tournamentHistory\":[]}');"],
  ['two retries instead of one', 'C. one more fetch, not more (each failing shard is requested exactly twice)',
    'for (const k of retried) {', 'for (const k of [...retried, ...retried]) {'],
];

(async () => {
  let pass = 0; const fails = [];
  const check = async (name, fn) => {
    try { await fn(); pass++; console.log(`  ok   ${name}`); } catch (e) { fails.push(name); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`); }
  };
  console.log('\nTEN-273 · deployed-store fetchShards: one retry, then fail closed\n');
  const real = await hydrate(SRC);
  for (const [name, fn] of Object.entries(CASES)) await check(`real: ${name}`, () => fn(real));
  for (const [label, caseName, find, replace] of MUTANTS) {
    await check(`mutant bites — ${label} → "${caseName.split(' (')[0]}" fails`, async () => {
      const src = fs.readFileSync(SRC, 'utf8');
      assert.strictEqual(src.split(find).length - 1, 1, `anchor must occur exactly once: ${find}`);
      const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ten273-shard-mut-')), 'tools');
      fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, 'deployed-store.js');
      fs.writeFileSync(f, src.replace(find, replace));
      const r = await hydrate(f);
      let failed = false;
      try { CASES[caseName](r); } catch { failed = true; }
      assert.ok(failed, `"${caseName}" still passes with the mechanism cut out`);
    });
  }
  console.log(`\nshard retry: ${pass} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
