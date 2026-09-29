#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// TEN-351 — deployed-store fetchText: ONE retry per single-file read, then fail closed.
//
// Run 5264 (2026-09-28 21:09Z) aborted the pre-deploy gate with
//   curl: (22) The requested URL returned error: 503
//   ✗ tournament-history/ DID NOT HYDRATE FROM THE DEPLOYED STORE — ABORTING.
//     deployed tournament-history-index.json unreachable
// The shards behind that index get one retry (TEN-273, founder 2026-09-25); the index itself
// did not. This applies the same rule to fetchText: one more fetch, then null exactly as before.
//
// The REAL tools/deployed-store.js runs in a child process (it shells out to curl synchronously,
// so the fake site must live in another process) against a local HTTP server:
//   tournament-history-index.json   503 on the first request, served on the second  (flaky)
//   career-history-index.json       503 every time                                   (dead)
//   player-profiles.json            served every time                                (ok)
// Cases:
//   A. fail once → passes: the flaky index is read and the hydrate attaches every player.
//   B. fail twice → fails closed: the dead index reads null (callers abort on null).
//   C. one more fetch, not more: flaky and dead are requested exactly twice, ok once.
// The module runs from a temp copy: its cache lives beside it (<root>/.deployed-cache), and the
// real repo's cache must never hold this test's fake index (see test-ten273-shard-retry.js).
// Each case is then run against a named mutant of the real source; every mutant must fail it.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const SRC = path.join(__dirname, 'deployed-store.js');

function startSite() {
  const hits = {};
  const srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    hits[u] = (hits[u] || 0) + 1;
    if (u === '/career-history-index.json' || (u === '/tournament-history-index.json' && hits[u] === 1)) {
      res.statusCode = 503; res.end('<html>503 Service Unavailable</html>'); return;
    }
    if (u === '/tournament-history-index.json') { res.end(JSON.stringify({ players: { p1: { n: 1 } } })); return; }
    if (u === '/tournament-history/p1.json') { res.end(JSON.stringify({ key: 'p1', tournamentHistory: [{ name: 'T', won: 1, lost: 0 }] })); return; }
    if (u === '/player-profiles.json') { res.end(JSON.stringify({ fetchedAt: 'x', players: { p1: {} } })); return; }
    res.statusCode = 404; res.end('nope');
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, hits, base: `http://127.0.0.1:${srv.address().port}` })));
}

// A throwaway root holding a copy of the module (so its cache is throwaway too).
function copyOf(src) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ten351-fetch-root-')), 'tools');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'deployed-store.js');
  fs.writeFileSync(f, src);
  return f;
}
// Read all three files through the given copy of deployed-store.js; → { r, hits }.
async function run(storeFile) {
  const site = await startSite();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ten351-fetch-'));
  const script = `const D = require(${JSON.stringify(storeFile)});
    const opts = { force: true, maxAgeMs: 0, timeoutSec: 10 };
    const players = { p1: {} };
    const th = D.hydrateTournamentHistory(players, Object.assign({ dir: ${JSON.stringify(path.join(work, 'th'))} }, opts));
    const ch = D.careerHistoryIndex(opts);
    const pp = D.playerProfiles(opts);
    process.stdout.write(JSON.stringify({ th, ch, ppSource: pp.source }));`;
  const out = await new Promise((ok, bad) => {
    const ch = spawn(process.execPath, ['-e', script], { env: Object.assign({}, process.env, { TEN206_DATA_BASE: site.base, PP2_BUILT_STORE: '' }) });
    let o = '', e = '';
    ch.stdout.on('data', (d) => { o += d; }); ch.stderr.on('data', (d) => { e += d; });
    ch.on('close', (code) => (code === 0 ? ok(o) : bad(new Error(`child exit ${code}: ${e.slice(-400)}`))));
  });
  site.srv.closeAllConnections(); site.srv.close();
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(path.dirname(path.dirname(storeFile)), { recursive: true, force: true });   // the throwaway root
  return { r: JSON.parse(out), hits: site.hits };
}

const CASES = {
  'A. fail once → passes (the flaky index is read on its one retry and every player attaches)': ({ r }) => {
    assert.ok(!r.th.error, r.th.error);
    assert.strictEqual(r.th.indexed, 1);
    assert.strictEqual(r.th.attached, 1);
  },
  'B. fail twice → fails closed (the dead index reads null; callers abort on null)': ({ r }) => {
    assert.strictEqual(r.ch, null, `dead index read as ${JSON.stringify(r.ch)}`);
    assert.strictEqual(r.ppSource, 'deployed', 'the healthy file is still read from the deployed site');
  },
  'C. one more fetch, not more (each failing file is requested exactly twice, a healthy one once)': ({ hits }) => {
    assert.strictEqual(hits['/tournament-history-index.json'], 2);
    assert.strictEqual(hits['/career-history-index.json'], 2);
    assert.strictEqual(hits['/player-profiles.json'], 1);
  },
};

// Named mutants of the real source: each must turn its named case red.
const MUTANTS = [
  ['no retry at all', 'A. fail once → passes (the flaky index is read on its one retry and every player attaches)',
    'attempt <= 2 && body == null', 'attempt <= 1 && body == null'],
  ['the retry fails OPEN (a file that failed twice reads as an empty store)', 'B. fail twice → fails closed (the dead index reads null; callers abort on null)',
    '} catch (err) { body = null; }', "} catch (err) { body = attempt === 2 ? '{\"players\":{}}' : null; }"],
  ['two retries instead of one', 'C. one more fetch, not more (each failing file is requested exactly twice, a healthy one once)',
    'attempt <= 2 && body == null', 'attempt <= 3 && body == null'],
  ['a success is fetched again', 'C. one more fetch, not more (each failing file is requested exactly twice, a healthy one once)',
    'attempt <= 2 && body == null', 'attempt <= 2'],
];

(async () => {
  let pass = 0; const fails = [];
  const check = async (name, fn) => {
    try { await fn(); pass++; console.log(`  ok   ${name}`); } catch (e) { fails.push(name); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`); }
  };
  console.log('\nTEN-351 · deployed-store fetchText: one retry, then fail closed\n');
  const real = await run(copyOf(fs.readFileSync(SRC, 'utf8')));
  for (const [name, fn] of Object.entries(CASES)) await check(`real: ${name}`, () => fn(real));
  for (const [label, caseName, find, replace] of MUTANTS) {
    await check(`mutant bites — ${label} → "${caseName.split(' (')[0]}" fails`, async () => {
      const src = fs.readFileSync(SRC, 'utf8');
      assert.strictEqual(src.split(find).length - 1, 1, `anchor must occur exactly once: ${find}`);
      const r = await run(copyOf(src.replace(find, replace)));
      let failed = false;
      try { CASES[caseName](r); } catch { failed = true; }
      assert.ok(failed, `"${caseName}" still passes with the mechanism cut out`);
    });
  }
  console.log(`\nfetch retry: ${pass} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
