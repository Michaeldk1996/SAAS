#!/usr/bin/env node
'use strict';
// TEN-254 (founder rulings 1–3, 2026-09-23) — the Challenger resolution layer.
//
//   ruling 1 · fail loud: a meaningful share of REFUSED api-tennis fetches aborts the
//              run before the store is written. Never publish a thinner store as a
//              success.
//   ruling 2 · challResolved: per player, did the Challenger lookup actually happen.
//   ruling 3 · a fixed, hand-confirmed api-tennis ID map. No looser matching.
//
// ⚠️ THE BUG THIS LOCKS. fetchPlayerChallengerFixtures used to return `[]` for BOTH
// "no Challenger matches" and "api-tennis refused", and `!data.success` took the
// EMPTY path. An unpaid key answers HTTP 200 with falsy success and cod 1006, so an
// unpaid key would have produced 384 clean "empties" and published a store with zero
// Challenger data as a success. 17 of the 40 zero-Challenger players on the
// 2026-09-23 board were never-fetched, not real zeros.
//
// These tests EXECUTE the real functions against a stubbed TRANSPORT (global.fetch),
// never a stubbed helper — a helper stub that returns the wrong shape is how a dead
// feature once got certified. Every check has a mutant that must break it.
const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHALL = path.join(ROOT, 'surface-ratings-chall-apitennis.js');
const MAP = path.join(ROOT, 'api-tennis-player-map.json');

let pass = 0; const fails = [];
async function check(name, fn) {
  try { await fn(); pass++; console.log(`  ok    ${name}`); }
  catch (e) { fails.push(name); console.error(`  FAIL  ${name}\n        ${e.message}`); }
}

// Stub the TRANSPORT. `reply(playerKey)` returns {status, body}.
function withFetch(reply, fn) {
  const orig = global.fetch;
  global.fetch = async (url) => {
    const m = /player_key=(\d+)/.exec(String(url));
    const r = reply(m ? m[1] : null);
    if (r === 'throw') throw new Error('socket');
    return { ok: r.status === 200, status: r.status, json: async () => r.body };
  };
  return Promise.resolve(fn()).finally(() => { if (orig) global.fetch = orig; else delete global.fetch; });
}
const cands = (n) => Array.from({ length: n }, (_, i) => ({ playerKey: 1000 + i, name: 'P' + i }));
const OPTS = { apiKey: 'x', fromYear: 2022, dateStop: '2026-09-23', surfaceMap: new Map(), concurrency: 4, log: () => {} };

function loadChall() { delete require.cache[require.resolve(CHALL)]; return require(CHALL); }

async function main() {
  // ── ruling 1 · an api-refusal is an ERROR, not an empty ───────────────────
  await check('cod 1006 (HTTP 200, success falsy) is a REFUSAL, not a genuine empty', async () => {
    const { fetchPlayerChallengerFixtures } = loadChall();
    await withFetch(() => ({ status: 200, body: { success: 0, cod: 1006, description: 'unpaid' } }), async () => {
      const r = await fetchPlayerChallengerFixtures('k', 1, '2022-01-01', '2026-09-23');
      assert.strictEqual(r.ok, false, 'an unpaid-key reply was treated as a successful fetch — this is the bug that would publish a Challenger-less store as a success');
      assert.match(r.reason, /^api-refused:1006$/, `reason was "${r.reason}"; the vendor code must survive for diagnosis`);
      assert.ok(!/APIkey|[a-f0-9]{32}/i.test(JSON.stringify(r)), 'the refusal payload leaked something key-shaped');
    });
  });

  await check('a real empty (success true, result []) is ok:true — a TRUSTWORTHY zero', async () => {
    const { fetchPlayerChallengerFixtures } = loadChall();
    await withFetch(() => ({ status: 200, body: { success: 1, result: [] } }), async () => {
      const r = await fetchPlayerChallengerFixtures('k', 1, '2022-01-01', '2026-09-23');
      assert.strictEqual(r.ok, true, 'a genuine "no Challenger matches" was recorded as a refusal — that would make every top-20 player MISSING');
      assert.deepStrictEqual(r.rows, []);
    });
  });

  await check('transport and HTTP failures are refusals too', async () => {
    const { fetchPlayerChallengerFixtures } = loadChall();
    await withFetch(() => 'throw', async () => {
      const r = await fetchPlayerChallengerFixtures('k', 1, 'a', 'b');
      assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'transport');
    });
    await withFetch(() => ({ status: 500, body: null }), async () => {
      const r = await fetchPlayerChallengerFixtures('k', 1, 'a', 'b');
      assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'http-500');
    });
  });

  // ── ruling 1 · the threshold, and that it is a RATE not a count ───────────
  await check('the refusal rate is measured, and 100% refusal is reported as 100%', async () => {
    const { fetchChallengerContribs } = loadChall();
    await withFetch(() => ({ status: 200, body: { success: 0, cod: 1006 } }), async () => {
      const r = await fetchChallengerContribs(cands(50), OPTS);
      assert.strictEqual(r.fetched, 50);
      assert.strictEqual(r.refusals, 50);
      assert.strictEqual(r.refusalRate, 1, `refusalRate ${r.refusalRate} — a total outage must read as 1.0`);
      assert.strictEqual(r.resolvedKeys.size, 0, 'a refused fetch must not mark the player resolved');
      assert.ok(r.refusalRate > r.maxRefusalRate, 'a total outage does not exceed the threshold — the abort would never fire');
    });
  });

  await check('one transient failure in 50 does NOT exceed the threshold', async () => {
    const { fetchChallengerContribs } = loadChall();
    await withFetch((pk) => (pk === '1000' ? { status: 503, body: null } : { status: 200, body: { success: 1, result: [] } }), async () => {
      const r = await fetchChallengerContribs(cands(50), OPTS);
      assert.strictEqual(r.refusals, 1);
      assert.ok(r.refusalRate <= r.maxRefusalRate,
        `1 in 50 (${(r.refusalRate * 100).toFixed(1)}%) trips the ${(r.maxRefusalRate * 100).toFixed(1)}% threshold — a nightly build must survive one flaky call`);
      assert.strictEqual(r.resolvedKeys.size, 49, 'the 49 that succeeded must all be resolved');
    });
  });

  // ── ruling 2 · resolved vs missing is carried, and a zero is not invented ──
  await check('challResolved distinguishes a true zero from a never-fetched player', async () => {
    const { fetchChallengerContribs } = loadChall();
    // 1000 succeeds empty (true zero); 1001 is refused (missing)
    await withFetch((pk) => (pk === '1001' ? { status: 200, body: { success: 0, cod: 1006 } } : { status: 200, body: { success: 1, result: [] } }), async () => {
      const r = await fetchChallengerContribs(cands(2), OPTS);
      assert.ok(r.resolvedKeys.has('1000'), 'the player whose fetch SUCCEEDED with no matches must be resolved — his zero is real');
      assert.ok(!r.resolvedKeys.has('1001'), 'the REFUSED player must not be resolved — his zero is missing data');
      assert.strictEqual(r.contribs.length, 0, 'neither player has matches, so neither contributes');
    });
  });

  // ── ruling 3 · the hand map ───────────────────────────────────────────────
  await check('the map is ID-keyed, hand-confirmed, and free of duplicate IDs', async () => {
    delete require.cache[require.resolve(MAP)];
    const m = require(MAP);
    const entries = Object.entries(m.map || {});
    assert.ok(entries.length >= 8, `only ${entries.length} mappings — the 8 confirmed players should be here`);
    const ids = entries.map(([, v]) => v.playerKey);
    assert.ok(ids.every(v => Number.isInteger(v)), 'every mapping must be an INTEGER api-tennis player_key, not a name string');
    assert.strictEqual(new Set(ids).size, ids.length,
      `duplicate api-tennis ID in the map: ${ids.filter((v, i) => ids.indexOf(v) !== i).join(', ')} — two players would share one player's matches`);
    for (const [name, v] of entries) {
      assert.ok(v.confirmed && v.confirmed.length > 30, `${name} has no real confirmation note`);
      assert.ok(/bday|born/i.test(v.confirmed), `${name}'s note does not cite a birthdate — name alone is not confirmation`);
    }
    // The two rulings that are about a SPECIFIC player.
    assert.strictEqual(m.map['J. M. Cerundolo'].playerKey, 388,
      'J. M. Cerundolo must map to 388 (b.15.11.2001), not 1104 which is F. Cerundolo (b.13.08.1998)');
    assert.ok(!ids.includes(1104), 'F. Cerundolo (1104) must not appear — he resolves on his own and is a different player');
    assert.ok(!('M. Ymer' in (m.map || {})),
      'M. Ymer is mapped, but the founder ruled DO NOT MAP — neither Elias (1082) nor Rafael (52076) is Mikael');
    assert.ok(m._unmapped && m._unmapped['M. Ymer'], 'M. Ymer must be recorded in _unmapped with the reason');
  });

  await check('the generator applies the map and refuses a double-attach', async () => {
    const src = require('fs').readFileSync(path.join(ROOT, 'surface-ratings.js'), 'utf8');
    assert.ok(/PLAYER_MAP\[meta\.name\]/.test(src), 'the generator no longer consults the map');
    assert.ok(/candSeen\.has\(pk\)/.test(src), 'the generator no longer guards against two players claiming one api-tennis ID');
    assert.ok(/challResolved/.test(src), 'the generator no longer emits challResolved');
    // the map must only ADD — it is consulted on the !hits.length branch
    const i = src.indexOf('PLAYER_MAP[meta.name]');
    const before = src.slice(Math.max(0, i - 400), i);
    assert.ok(/if \(!hits\.length\)/.test(before),
      'the map is consulted outside the "no standings hit" branch — it could re-point a player who already resolves');
  });

  // ── MUTANTS ──────────────────────────────────────────────────────────────
  const MUTANTS = [
    ['cod-1006 back to an empty (the original bug)', s => s.replace(/if \(!data\.success\) \{[\s\S]*?\n  \}/, 'if (!data.success) return { ok: true, rows: [], reason: null };')],
    ['threshold raised so nothing ever trips it', s => s.replace('const MAX_REFUSAL_RATE = 0.02;', 'const MAX_REFUSAL_RATE = 1.01;')],
    ['a refused player marked resolved anyway', s => s.replace('        continue;                          // NOT resolved — stays out of resolvedKeys', '        resolvedKeys.add(String(c.playerKey)); continue;')],
    ['a real empty recorded as unresolved', s => s.replace("      resolvedKeys.add(String(c.playerKey));\n      if (!r.rows.length) continue;", '      if (!r.rows.length) continue;\n      resolvedKeys.add(String(c.playerKey));')],
  ];
  await check('CONTROL: every mutant is caught', async () => {
    const fs = require('fs');
    const orig = fs.readFileSync(CHALL, 'utf8');
    const survivors = [];
    for (const [name, mutate] of MUTANTS) {
      const mutated = mutate(orig);
      assert.notStrictEqual(mutated, orig, `mutant "${name}" did not apply — it proves nothing`);
      let caught = false;
      try {
        fs.writeFileSync(CHALL, mutated);
        const { fetchPlayerChallengerFixtures, fetchChallengerContribs } = loadChall();
        // check 1: cod 1006 must be a refusal
        await withFetch(() => ({ status: 200, body: { success: 0, cod: 1006 } }), async () => {
          const r = await fetchPlayerChallengerFixtures('k', 1, 'a', 'b');
          if (r.ok !== false) caught = true;
        });
        // check 2: a total outage must exceed the threshold and resolve nobody
        if (!caught) await withFetch(() => ({ status: 200, body: { success: 0, cod: 1006 } }), async () => {
          const r = await fetchChallengerContribs(cands(50), OPTS);
          if (!(r.refusalRate > r.maxRefusalRate)) caught = true;
          if (r.resolvedKeys.size !== 0) caught = true;
        });
        // check 3: a real empty must resolve the player
        if (!caught) await withFetch(() => ({ status: 200, body: { success: 1, result: [] } }), async () => {
          const r = await fetchChallengerContribs(cands(3), OPTS);
          if (r.resolvedKeys.size !== 3) caught = true;
        });
      } catch { caught = true; }
      finally { fs.writeFileSync(CHALL, orig); delete require.cache[require.resolve(CHALL)]; }
      if (!caught) survivors.push(name);
    }
    assert.deepStrictEqual(survivors, [], `${survivors.length} of ${MUTANTS.length} mutants SURVIVED: ${survivors.join(' · ')}`);
    console.log(`  mutants: ${MUTANTS.length} caught, 0 survived`);
  });

  console.log(`\nTEN-254 chall resolution: ${pass} pass, ${fails.length} fail`);
  if (fails.length) { console.error('FAILED: ' + fails.join(' · ')); process.exit(1); }
}
main();
