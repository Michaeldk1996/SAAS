/**
 * TEN-227 — the Phase 3 loader's DDL allowlist is the only thing standing
 * between this probe and the production Supabase project. Assert it against the
 * statements it must refuse, not just the ones it should pass.
 *
 *   node --test tools/test-ten227-ddl-guard.js
 */
const test = require('node:test');
const assert = require('node:assert');

const load = () => import('./ten227-bulk-load.mjs');

test('every shipped DDL statement passes its own guard', async () => {
  const { assertDdlAllowed, DDL_STATEMENTS } = await load();
  const stmts = DDL_STATEMENTS();
  assert.ok(stmts.length >= 6, `expected the loader to ship its tables, got ${stmts.length}`);
  for (const sql of stmts) {
    const name = assertDdlAllowed(sql);
    assert.match(name, /^betsapi_raw_/, `statement targets "${name}": ${sql.slice(0, 60)}`);
  }
});

test('the guard refuses everything outside betsapi_raw_*', async () => {
  const { assertDdlAllowed } = await load();
  // Each of these is a statement that, if it ever reached the Management API,
  // would damage something the brief explicitly says not to touch.
  const forbidden = [
    ['drops a product table', 'drop table ten216_test_odds_changes'],
    ['drops one of ours', 'drop table betsapi_raw_odds'],
    ['truncates', 'truncate table betsapi_raw_odds'],
    ['deletes rows', 'delete from betsapi_raw_events'],
    ['creates a table outside the prefix', 'create table if not exists player_profiles (id text)'],
    ['indexes a foreign table', 'create index if not exists x_idx on ten216_test_odds_changes (id)'],
    ['alters a foreign table', 'alter table ten216_test_odds_changes enable row level security'],
    ['alters ours for something other than RLS', 'alter table betsapi_raw_odds add column sneaky text'],
    ['opens the anon key up', 'create policy anon_read on betsapi_raw_odds for select using (true)'],
    ['grants', 'grant select on betsapi_raw_odds to anon'],
    ['touches pg_cron', "select cron.schedule('x','* * * * *','select 1')"],
    ['bare select is not DDL', 'select * from betsapi_raw_odds'],
  ];
  for (const [why, sql] of forbidden) {
    assert.throws(() => assertDdlAllowed(sql), /refusing|only allowed/i,
      `guard let through a statement that ${why}: ${sql}`);
  }
});

// The Management API's database/query endpoint runs whatever SQL it is handed,
// including several statements separated by semicolons. So a payload can open
// with a perfectly legal `create table betsapi_raw_…` — passing both the
// allowlist AND the prefix check — and carry the damage in a second statement.
// Only DDL_FORBIDDEN stands in the way of that, which makes these the cases
// that actually lock it: a mutant that guts the forbidden-verb list must fail
// here, because every other test still passes on the prefix check alone.
test('a chained second statement cannot ride in behind a legal first one', async () => {
  const { assertDdlAllowed } = await load();
  const chained = [
    ['drops a product table after ours',
      'create table if not exists betsapi_raw_x (id text); drop table player_profiles'],
    ['grants the anon key access after ours',
      'create index if not exists betsapi_raw_i on betsapi_raw_odds (event_id); grant select on betsapi_raw_odds to anon'],
    ['opens a policy after ours',
      'create table if not exists betsapi_raw_y (id text); create policy p on betsapi_raw_y for select using (true)'],
    ['schedules cron after ours',
      "create table if not exists betsapi_raw_z (id text); select cron.schedule('x','* * * * *','select 1')"],
    ['deletes rows after ours',
      'create table if not exists betsapi_raw_w (id text); delete from ten216_test_odds_changes'],
    ['truncates after ours',
      'create table if not exists betsapi_raw_v (id text); truncate ten216_test_odds_changes'],
  ];
  for (const [why, sql] of chained) {
    assert.throws(() => assertDdlAllowed(sql), /forbidden verb/i,
      `guard let through a chained statement that ${why}: ${sql}`);
  }
});

test('a prefix lookalike does not sneak past', async () => {
  const { assertDdlAllowed } = await load();
  // "betsapi_raw" without the trailing underscore, and a name merely containing
  // the prefix, are both outside scope.
  assert.throws(() => assertDdlAllowed('create table if not exists evil_betsapi_raw_x (id text)'), /refusing/i);
});
