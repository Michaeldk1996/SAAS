// TEN-368 (founder Q9, TEN-312 card 380abd18, 2026-09-30) — the event hold rate builder, build-event-hold.js.
// The rate = service games held ÷ service games played at the event, from OUR box scores (boxscore-archive/) over EVERY
// edition on file, n = service games, both players. Every check drives the real builder (TEN368_BUILDER swaps in a mutated
// copy, tools/test-ten368-mutants.js) and names the mutation that turns it red.
'use strict';
const assert = require('assert');
const path = require('path');
const B = require(process.env.TEN368_BUILDER || path.join(__dirname, '..', 'build-event-hold.js'));

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('✔ ' + name); } catch (e) { failed++; console.error('✖ ' + name + '\n  ' + (e && e.message)); }
}
const sg = (won, total) => ({ raw: { 'Games:Service games won': { won, total } } });
const ent = (tn, tk, d, a, b, t) => ({ t: t || 'atp', tn, tk, d, matchStats: { p1: a, p2: b } });

// Mutation 'one side only': a match counts one player's service games.
check('n = both players\' service games; held = both players\' holds', () => {
  const out = B.buildEventHold([{ 1: ent('ATP Tokyo', 1223, '2025-09-25', sg(10, 12), sg(9, 11)) }]);
  const e = out.events['1223'];
  assert.strictEqual(e.games, 23); assert.strictEqual(e.held, 19); assert.strictEqual(e.matches, 1);
});

// Mutation 'a half box score counted': a match missing one side's count enters the population.
check('a match counts only when both players\' counts are on file (whole matches only)', () => {
  const out = B.buildEventHold([{ 1: ent('Tokyo', 1223, '2025-09-25', sg(10, 12), sg(9, 11)), 2: ent('Tokyo', 1223, '2025-09-26', sg(8, 9), {}),
    3: ent('Tokyo', 1223, '2025-09-27', sg(8, 9), { raw: { 'Games:Service games won': { won: 5, total: 0 } } }) }]);
  assert.strictEqual(out.events['1223'].matches, 1); assert.strictEqual(out.events['1223'].games, 23);
});

// Mutation 'every tier': a Challenger event with the same name joins the ATP event.
check('ATP tier only: a Challenger event never enters (the board is ATP)', () => {
  const out = B.buildEventHold([{ 1: ent('Hangzhou', 11724, '2025-09-20', sg(10, 12), sg(9, 11)), 2: ent('Hangzhou', 11815, '2025-10-20', sg(1, 12), sg(1, 11), 'challenger') }]);
  assert.deepStrictEqual(Object.keys(out.events), ['11724']); assert.strictEqual(out.byName.hangzhou, '11724');
});

// Mutation 'a match listed twice counted twice': the weekly pages overlap.
check('one event key counts once across the weekly files', () => {
  const w = { 77: ent('Tokyo', 1223, '2025-09-25', sg(10, 12), sg(9, 11)) };
  assert.strictEqual(B.buildEventHold([w, w]).events['1223'].games, 23);
});

// Mutation 'window cut to recent seasons' (founder Q9: all editions on file, not the last N seasons).
check('every edition on file counts: 2024, 2025 and 2026 all enter, with the years stated', () => {
  const out = B.buildEventHold([{ 1: ent('ATP Washington', 1532, '2024-07-30', sg(10, 12), sg(9, 11)) },
    { 2: ent('Washington', 1532, '2025-07-29', sg(10, 10), sg(10, 10)) }, { 3: ent('Washington', 1532, '2026-07-28', sg(6, 12), sg(6, 11)) }]);
  const e = out.events['1532'];
  assert.deepStrictEqual(e.years, ['2024', '2025', '2026']);
  assert.strictEqual(e.games, 66); assert.strictEqual(e.held, 51); assert.strictEqual(e.matches, 3);
  assert.strictEqual(e.from, '2024-07-30'); assert.strictEqual(e.to, '2026-07-28');
});

// Mutation 'an ambiguous name joined': two ATP keys sharing a cleaned name must not resolve to either.
check('names: "ATP Tokyo" and "Tokyo" join one key; a name two keys share is left out (a dash, never a guess)', () => {
  const out = B.buildEventHold([{ 1: ent('ATP Tokyo', 1223, '2024-09-25', sg(10, 12), sg(9, 11)), 2: ent('Tokyo', 1223, '2025-09-25', sg(10, 12), sg(9, 11)),
    3: ent('Paris', 1725, '2024-11-01', sg(10, 12), sg(9, 11)), 4: ent('ATP Paris', 9999, '2024-08-01', sg(10, 12), sg(9, 11)) }]);
  assert.strictEqual(out.byName.tokyo, '1223');
  assert.ok(!('paris' in out.byName)); assert.deepStrictEqual(out.ambiguous, ['paris']);
});

// The committed archive (present in a CI-shaped clone: boxscore-archive/ is tracked): every edition on file reaches the
// output, not only recent ones. Skipped out loud when the archive is absent.
check('the committed archive: Tokyo carries its 2024 and 2025 editions with n = service games', () => {
  const fs = require('fs'), zlib = require('zlib');
  const dir = path.join(__dirname, '..', 'boxscore-archive');
  if (!fs.existsSync(dir)) { console.log('  (skipped: no boxscore-archive/ in this checkout)'); return; }
  const weeks = fs.readdirSync(dir).filter(f => /^265-\d{4}-(09|10)-\d{2}\.json\.gz$/.test(f)).sort()
    .map(f => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString('utf8')));
  const out = B.buildEventHold(weeks), e = out.events[out.byName.tokyo];
  assert.ok(e, 'Tokyo is in the archive');
  assert.ok(e.years.includes('2024') && e.years.includes('2025'), 'years ' + e.years);
  assert.ok(e.games > 1000 && e.held < e.games, e.games + ' / ' + e.held);
  console.log(`  Tokyo: ${e.held} of ${e.games} service games held (${(100 * e.held / e.games).toFixed(1)}%), ${e.matches} matches, ${e.years.join(', ')}`);
});

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nTEN-368 event hold builder: all checks passed');
