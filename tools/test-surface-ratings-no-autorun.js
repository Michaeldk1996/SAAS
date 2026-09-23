#!/usr/bin/env node
'use strict';
// TEN-254 — surface-ratings.js must NOT run itself when another program loads it.
//
// FOUNDER, 2026-09-23: "Guard the generator: surface-ratings.js runs itself when
// another program loads it (it ends in an IIFE). That already cost one quota cycle
// today. Make it run only when started directly. Add a test that loading the file
// makes no network call."
//
// WHAT IT COST. The file ended in a bare `(async () => {...})()`. A
// `node -e 'require("./surface-ratings.js")'` typed to syntax-check an edit ran the
// whole generator: 1 get_standings + one get_fixtures per candidate — 385 api-tennis
// calls on the run that exposed it — and overwrote surface-ratings.json in place.
//
// HOW THIS TESTS IT. Not by grepping for `require.main`. It POISONS every network
// primitive the generator can reach, actually `require()`s the file, and then WAITS,
// because the body is async.
//
// ⚠️ THE WAIT IS THE WHOLE POINT. The first version of this file asserted
// synchronously after require() and PASSED with the bare IIFE restored: the body had
// started but had not yet reached its first fetch, and an unhandled rejection inside
// an async IIFE never propagates back to require(). The one assertion this file
// exists for was vacuous, and only the mutation control below exposed it.
const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const TARGET = path.join(ROOT, 'surface-ratings.js');
const SETTLE_MS = 2500;                     // time for an async body to reach the network
const settle = () => new Promise(r => setTimeout(r, SETTLE_MS));

let pass = 0; const fails = [];
async function check(name, fn) {
  try { await fn(); pass++; console.log(`  ok    ${name}`); }
  catch (e) { fails.push(name); console.error(`  FAIL  ${name}\n        ${e.message}`); }
}

async function requireAndWatch() {
  const events = [];
  const origFetch = global.fetch;
  // ⚠️ REDACT THE URL. The generator puts the api-tennis key in the query string, so
  // logging the raw URL would print a live credential into CI output on every
  // failure — and a failure here is exactly when someone pastes the log somewhere.
  // Keep the method (which is the diagnostic) and drop everything else.
  const redact = (u) => {
    const s = String(u);
    const m = /method=([a-z_]+)/.exec(s);
    const host = (/^https?:\/\/([^/?]+)/.exec(s) || [, '?'])[1];
    return `${host} method=${m ? m[1] : '?'}`;
  };
  global.fetch = (...a) => { events.push('fetch ' + redact(a[0])); return Promise.reject(new Error('network during require')); };
  const saved = [];
  for (const mod of ['http', 'https']) {
    const m = require(mod);
    for (const fnName of ['get', 'request']) {
      saved.push([m, fnName, m[fnName]]);
      m[fnName] = () => { events.push(mod + '.' + fnName); throw new Error('network during require'); };
    }
  }
  const origWrite = fs.writeFileSync, origRename = fs.renameSync;
  fs.writeFileSync = (p, ...r) => { if (String(p).includes('surface-ratings')) { events.push('WROTE ' + p); throw new Error('wrote the store'); } return origWrite(p, ...r); };
  fs.renameSync = (a, b) => { if (String(b).includes('surface-ratings')) { events.push('RENAMED onto ' + b); throw new Error('renamed the store'); } return origRename(a, b); };

  const onUnhandled = e => events.push('unhandled: ' + String(e && e.message).slice(0, 50));
  process.on('unhandledRejection', onUnhandled);
  let threw = null;
  try {
    delete require.cache[require.resolve(TARGET)];
    require(TARGET);
    await settle();
  } catch (e) { threw = e; }
  finally {
    process.removeListener('unhandledRejection', onUnhandled);
    fs.writeFileSync = origWrite; fs.renameSync = origRename;
    for (const [m, fnName, orig] of saved) m[fnName] = orig;
    if (origFetch) global.fetch = origFetch; else delete global.fetch;
  }
  return { events, threw };
}

async function main() {
  await check('requiring surface-ratings.js makes NO network call and writes nothing', async () => {
    const { events, threw } = await requireAndWatch();
    assert.strictEqual(threw, null, `require() threw: ${threw && threw.message}`);
    assert.deepStrictEqual(events, [],
      `loading the file did ${events.length} thing(s) it must not: ${events.join(' | ')}`);
  });

  await check('the guard is require.main === module, not a weaker test', async () => {
    const src = fs.readFileSync(TARGET, 'utf8');
    assert.ok(/if \(require\.main === module\)/.test(src),
      'the `require.main === module` guard is gone; the file is a landmine again');
    const bare = src.split('\n').filter(l => /^\(async \(\) => \{/.test(l));
    assert.deepStrictEqual(bare, [],
      `${bare.length} unguarded top-level async IIFE(s) — each one runs on require`);
  });

  await check('the real entry point still works — node surface-ratings.js is NOT disabled', async () => {
    // Not asserting a successful build (that costs quota) — asserting the body is
    // REACHED. A guard of `!==`, or a typo, exits 0 instantly with no output.
    let out = '';
    try {
      out = execFileSync(process.execPath, [TARGET], {
        cwd: ROOT, timeout: 6000, encoding: 'utf8',
        env: { ...process.env, API_TENNIS_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      out = (e.stdout || '') + (e.stderr || '');
      if (e.code === 'ETIMEDOUT' || e.signal === 'SIGTERM') out += '\n[timed out — the body was running]';
    }
    assert.ok(out.trim().length > 0,
      'running the file directly produced NO output — the guard disabled the entry point, ' +
      'which is how the workflow invokes it (`run: node surface-ratings.js`)');
  });

  console.log(`\nsurface-ratings autorun guard: ${pass} pass, ${fails.length} fail`);
  if (fails.length) { console.error('FAILED: ' + fails.join(' · ')); process.exit(1); }
}
main();
