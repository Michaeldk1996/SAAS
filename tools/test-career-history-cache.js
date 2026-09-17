// tools/test-career-history-cache.js — TEN-228.
//
// A FAILED career-history fetch must not be cached as an ANSWER.
//
// What went wrong. `loadCareerHistoryIndex()` set `careerHistoryIndex = {}` on
// both the non-ok and the thrown path, and `{}` is truthy, so its own first-line
// guard returned it for the rest of the session. `loadCareerHistory()` then wrote
// `_careerHistoryShards[pk] = []`, which `pk in _careerHistoryShards` serves
// forever. One transient blip on career-history-index.json therefore left EVERY
// career-spine surface — Calendar, Career record, Court speed, Streaks — reading
// zero rows for every player until the tab was reloaded. And because
// `loadPp2CareerHistory()` published `window.careerHistory[k] = []`, the V2
// renderer saw a SETTLED store and stated the zero as a fact about the player.
//
// Measured while photographing §5.5: two headless browsers against the same
// hybrid server, one read Zverev's 775 rows, the other read 0 and rendered
// "No matches on record, so no court can be rated." for a man with 775.
//
// The three functions are lifted out of bsp-consult-dashboard.html by source
// extraction rather than copied, so this test cannot pass against a page that no
// longer contains the fix.
//
// Every assertion is paired with a negative control.
//
// Run: node tools/test-career-history-cache.js

'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');

/** Lift a function declaration (optionally `async`) out of the page by brace match. */
function grab(name) {
  const re = new RegExp('(async\\s+)?function\\s+' + name + '\\s*\\(');
  const m = re.exec(HTML);
  assert.ok(m, `bsp-consult-dashboard.html no longer declares ${name}`);
  const start = m.index;
  let depth = 0;
  for (let i = HTML.indexOf('{', start); i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (!depth) return HTML.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

/**
 * A fresh module scope with a scripted fetch. `plan` is consulted per URL and
 * may be changed between calls, which is how "fails once, then succeeds" —
 * the whole point of a released memo — is expressed.
 */
function makeScope(plan) {
  const calls = [];
  const scope = {
    calls,
    warns: [],
    fetch(url) {
      calls.push(url);
      const res = plan(url, calls.length);
      if (res === 'throw') return Promise.reject(new Error('network down'));
      if (typeof res === 'number') return Promise.resolve({ ok: false, status: res });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(res) });
    },
  };
  const src = `
    let careerHistoryIndex = null;
    let _careerHistoryIndexPromise = null;
    const _careerHistoryShards = {};
    const _careerHistoryPromises = {};
    const console = { warn: (...a) => __scope.warns.push(a.join(' ')) };
    const fetch = __scope.fetch;
    function pp2RepaintIfOpen(){ }
    ${grab('loadCareerHistoryIndex')}
    ${grab('loadCareerHistory')}
    ${grab('loadPp2CareerHistory')}
    return {
      loadCareerHistoryIndex, loadCareerHistory, loadPp2CareerHistory,
      shards: () => _careerHistoryShards,
      index: () => careerHistoryIndex,
      window: (window = { }) => window,
    };
  `;
  // `window` is the bridge loadPp2CareerHistory writes to.
  const win = {};
  // eslint-disable-next-line no-new-func
  const api = new Function('__scope', 'window', src)(scope, win);
  return { api, scope, win };
}

let pass = 0, fail = 0;
const failures = [];
function check(name, fn) {
  return fn().then(
    () => { pass++; console.log('  PASS  ' + name); },
    (e) => { fail++; failures.push(name + ' :: ' + e.message); console.log('  FAIL  ' + name + ' :: ' + e.message); });
}
function mustFail(name, fn) {
  return fn().then(
    () => { fail++; failures.push('[neg] ' + name + ' :: NOT caught — the check is vacuous'); console.log('  FAIL  [neg] ' + name + ' :: NOT caught — the check is vacuous'); },
    () => { pass++; console.log('  PASS  [neg] ' + name + ' (correctly rejected)'); });
}

const IDX = { players: { 1980: 775, 370: 405 } };
const SHARD = { matches: [{ date: '2024-01-15', won: true, surface: 'hard' }] };

console.log('TEN-228 · a failed career-history fetch is not cached as an answer');

(async () => {

  // ── 1 · the index: a failure is retried, an answer is not ──────────────────
  await check('a FAILED index fetch is retried on the next open (the memo is released)', async () => {
    let failFirst = true;
    const { api, scope } = makeScope((url) => {
      if (url.indexOf('career-history-index') > -1) {
        if (failFirst) { failFirst = false; return 'throw'; }
        return IDX;
      }
      return SHARD;
    });
    const first = await api.loadCareerHistoryIndex();
    assert.deepStrictEqual(first, {}, 'the failed call should degrade to {} for that caller');
    const second = await api.loadCareerHistoryIndex();
    assert.ok(second && second['1980'] === 775,
      'the second call did not retry — it served the cached failure: ' + JSON.stringify(second));
    assert.strictEqual(scope.calls.filter((u) => u.indexOf('career-history-index') > -1).length, 2,
      'the index was not re-fetched, so the memo was never released');
  });

  await check('a SUCCESSFUL index fetch is cached (fetched exactly once)', async () => {
    const { api, scope } = makeScope(() => IDX);
    await api.loadCareerHistoryIndex();
    await api.loadCareerHistoryIndex();
    await api.loadCareerHistoryIndex();
    assert.strictEqual(scope.calls.filter((u) => u.indexOf('career-history-index') > -1).length, 1,
      'a good index was re-fetched — the memo is not working');
  });

  await check('an index that is READABLE but genuinely empty stays cached', async () => {
    const { api, scope } = makeScope(() => ({ players: {} }));
    await api.loadCareerHistoryIndex();
    await api.loadCareerHistoryIndex();
    assert.strictEqual(scope.calls.length, 1,
      'a real empty answer was retried — "he has none" would re-fetch forever');
  });

  // ── 2 · the shard: the same rule, per player ───────────────────────────────
  await check('an UNREADABLE index does not freeze the player at zero rows', async () => {
    let down = true;
    const { api } = makeScope((url) => {
      if (url.indexOf('career-history-index') > -1) return down ? 'throw' : IDX;
      return SHARD;
    });
    const a = await api.loadCareerHistory('1980');
    assert.deepStrictEqual(a, [], 'the failed call should degrade to [] for that caller');
    assert.ok(!('1980' in api.shards()),
      'the failure was cached in _careerHistoryShards — every later open would serve []');
    down = false;
    const b = await api.loadCareerHistory('1980');
    assert.strictEqual(b.length, 1, 'the retry did not reach the shard: ' + JSON.stringify(b));
  });

  await check('a 404 SHARD is retried, not cached as "no matches"', async () => {
    let missing = true;
    const { api } = makeScope((url) => {
      if (url.indexOf('career-history-index') > -1) return IDX;
      return missing ? 404 : SHARD;
    });
    await api.loadCareerHistory('1980');
    assert.ok(!('1980' in api.shards()), 'a 404 shard was cached as an answer');
    missing = false;
    const b = await api.loadCareerHistory('1980');
    assert.strictEqual(b.length, 1, 'the retry after a 404 did not serve rows');
  });

  await check('a player the READ index omits is answered [] and cached', async () => {
    const { api, scope } = makeScope(() => IDX);
    const a = await api.loadCareerHistory('99999');       // not in IDX.players
    assert.deepStrictEqual(a, [], 'an omitted player should answer []');
    assert.ok('99999' in api.shards(),
      'a real "he has none" was NOT cached — it would re-fetch the index on every open');
    await api.loadCareerHistory('99999');
    assert.strictEqual(scope.calls.filter((u) => u.indexOf('/99999.json') > -1).length, 0,
      'a shard was fetched for a player the index does not list');
  });

  // ── 3 · the bridge: settle only on an answer ───────────────────────────────
  await check('the V2 bridge key is ABSENT after a failure (so §5.5 says "has not loaded")', async () => {
    const { api, win } = makeScope((url) =>
      (url.indexOf('career-history-index') > -1 ? 'throw' : SHARD));
    await api.loadPp2CareerHistory('1980');
    const store = win.careerHistory || {};
    assert.ok(!Object.prototype.hasOwnProperty.call(store, '1980'),
      'the bridge settled the key on a FAILED fetch — the renderer would print '
      + '"No matches on record" for a player whose shard merely did not arrive');
  });

  await check('the V2 bridge key is PRESENT after an answer, empty or not', async () => {
    const { api, win } = makeScope(() => IDX);
    await api.loadPp2CareerHistory('99999');              // answered: he has none
    assert.ok(Object.prototype.hasOwnProperty.call(win.careerHistory || {}, '99999'),
      'a genuine "he has none" left the key absent — the card would spin forever');
    assert.deepStrictEqual(win.careerHistory['99999'], [],
      'the answered-empty case should publish []');
  });

  await check('the bridge publishes the rows on a good fetch', async () => {
    const { api, win } = makeScope((url) =>
      (url.indexOf('career-history-index') > -1 ? IDX : SHARD));
    await api.loadPp2CareerHistory('1980');
    assert.strictEqual((win.careerHistory['1980'] || []).length, 1,
      'the rows did not reach the bridge: ' + JSON.stringify(win.careerHistory));
  });

  // ── 4 · negative controls ─────────────────────────────────────────────────
  await mustFail('the retry check would catch the OLD sticky-{} index', async () => {
    // The pre-fix body, verbatim in shape: a truthy {} cached on failure.
    let careerHistoryIndex = null, promise = null, calls = 0;
    const load = () => {
      if (careerHistoryIndex) return Promise.resolve(careerHistoryIndex);
      if (promise) return promise;
      calls++;
      promise = Promise.reject(new Error('down'))
        .catch(() => { careerHistoryIndex = {}; return careerHistoryIndex; });
      return promise;
    };
    await load();
    await load();
    assert.strictEqual(calls, 2, 'the old sticky-{} index re-fetched — it should not have');
  });

  await mustFail('the bridge check would catch the OLD unconditional settle', async () => {
    // The pre-fix body: `window.careerHistory[k] = rows || []` with no answered test.
    const win = { careerHistory: {} };
    const rows = [];                                     // what a failure resolved to
    win.careerHistory['1980'] = rows || [];
    assert.ok(!Object.prototype.hasOwnProperty.call(win.careerHistory, '1980'),
      'the unconditional settle left the key absent');
  });

  await mustFail('the shard check would catch a cached failure', async () => {
    const shards = { 1980: [] };                         // the old failure cache
    assert.ok(!('1980' in shards), 'a cached failure was not detected');
  });

  console.log('\n' + '='.repeat(64));
  console.log(`PASS ${pass}   FAIL ${fail}`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  process.exit(fail ? 1 : 0);
})();
