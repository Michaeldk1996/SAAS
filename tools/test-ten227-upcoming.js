/**
 * TEN-227 upcoming-odds check — the parts that can be wrong SILENTLY.
 *
 *   node --test tools/test-ten227-upcoming.js
 *
 * Two things here, and only two, because everything else in the tool is a
 * measurement that the report prints with its own n:
 *
 *   1. The DDL allowlist. It is the only thing between a reconnaissance probe
 *      and the production Supabase project. Asserted against statements it must
 *      REFUSE, including a forbidden verb chained behind a legal `create table`
 *      — the Management API runs multi-statement SQL, so the prefix check alone
 *      is not a lock.
 *   2. The pairing rules. A matcher that quietly pairs the wrong Zverev, or
 *      lets a Davis Cup team fixture into a singles sample, produces a report
 *      full of confident numbers about the wrong matches.
 */
const test = require('node:test');
const assert = require('node:assert');

const load = () => import('./ten227-upcoming.mjs');

test('every shipped DDL statement passes its own guard', async () => {
  const { assertDdlAllowed, TABLES } = await load();
  assert.ok(TABLES.length >= 6, `expected the tool to ship its tables, got ${TABLES.length}`);
  for (const sql of TABLES) {
    const name = assertDdlAllowed(sql);
    assert.match(name, /^betsapi_upcoming_test_/, `statement targets "${name}": ${sql.slice(0, 60)}`);
  }
});

test('the guard refuses everything outside betsapi_upcoming_test_*', async () => {
  const { assertDdlAllowed } = await load();
  const forbidden = [
    ['drops the TEN-216 collector table', 'drop table ten216_test_odds_changes'],
    ['drops the TEN-225 line summary', 'drop table oddspapi_line_summary'],
    ['drops one of ours', 'drop table betsapi_upcoming_test_polls'],
    ['truncates', 'truncate table betsapi_upcoming_test_polls'],
    ['deletes rows', 'delete from betsapi_upcoming_test_selection'],
    ['touches the Phase 3 tables', 'create index if not exists i on betsapi_raw_odds (event_id)'],
    ['creates a table outside the prefix', 'create table if not exists player_profiles (id text)'],
    ['alters a foreign table', 'alter table ten216_test_odds_changes enable row level security'],
    ['alters ours for something other than RLS', 'alter table betsapi_upcoming_test_polls add column sneaky text'],
    ['opens the anon key up', 'create policy anon_read on betsapi_upcoming_test_polls for select using (true)'],
    ['grants', 'grant select on betsapi_upcoming_test_polls to anon'],
    ['touches pg_cron', "select cron.schedule('x','* * * * *','select 1')"],
    ['bare select is not DDL', 'select * from betsapi_upcoming_test_polls'],
    ['prefix lookalike', 'create table if not exists evil_betsapi_upcoming_test_x (id text)'],
  ];
  for (const [why, sql] of forbidden) {
    assert.throws(() => assertDdlAllowed(sql), /refusing|only allowed/i,
      `guard let through a statement that ${why}: ${sql}`);
  }
});

// This is the test that actually locks DDL_FORBIDDEN. Every case above still
// passes on the prefix check alone, so a mutant that guts the forbidden-verb
// list survives them — and must die here.
test('a chained second statement cannot ride in behind a legal first one', async () => {
  const { assertDdlAllowed } = await load();
  const chained = [
    ['drops the TEN-216 table after ours',
      'create table if not exists betsapi_upcoming_test_x (id text); drop table ten216_test_odds_changes'],
    ['grants the anon key access after ours',
      'create index if not exists betsapi_upcoming_test_i on betsapi_upcoming_test_polls (poll_no); grant select on betsapi_upcoming_test_polls to anon'],
    ['opens a policy after ours',
      'create table if not exists betsapi_upcoming_test_y (id text); create policy p on betsapi_upcoming_test_y for select using (true)'],
    ['schedules cron after ours',
      "create table if not exists betsapi_upcoming_test_z (id text); select cron.schedule('x','* * * * *','select 1')"],
    ['truncates the line summary after ours',
      'create table if not exists betsapi_upcoming_test_w (id text); truncate oddspapi_line_summary'],
  ];
  for (const [why, sql] of chained) {
    assert.throws(() => assertDdlAllowed(sql), /forbidden verb/i,
      `guard let through a chained statement that ${why}: ${sql}`);
  }
});

test('accents are stripped, not merely lowercased', async () => {
  const { norm } = await load();
  assert.strictEqual(norm('Félix Auger-Aliassime'), 'felix auger aliassime');
  assert.strictEqual(norm('Nicolás Jarry'), norm('Nicolas Jarry'));
  assert.strictEqual(norm('Čilić, Marin'), 'cilic marin');
});

test('team fixtures never enter a singles sample', async () => {
  const { isTeamFixture } = await load();
  for (const [a, b] of [
    ['Team Serbia', 'Team Spain'],
    ['Russia', 'Croatia'],
    ['Bolelli F. / Vavassori A.', 'Granollers M. / Zeballos H.'],
  ]) assert.ok(isTeamFixture(a, b), `let a team/doubles fixture through: ${a} vs ${b}`);

  for (const [a, b] of [
    ['Carlos Alcaraz', 'Jannik Sinner'],
    ['Auger-Aliassime F.', 'De Minaur A.'],
  ]) assert.ok(!isTeamFixture(a, b), `dropped a real singles fixture: ${a} vs ${b}`);
});

test('a shared surname alone is not a pair', async () => {
  const { pairScore } = await load();
  // The failure this prevents: Alexander and Mischa Zverev are different people,
  // and a surname-only matcher pairs whichever one the other feed listed first.
  assert.ok(pairScore('Alexander Zverev', 'Alexander Zverev') > 0);
  assert.strictEqual(pairScore('Alexander Zverev', 'Mischa Zverev'), 0);
  // Multi-part given/surnames must still pair — this is the documented defect
  // from the Phase 2 pairing pass.
  assert.ok(pairScore('Carlos Alcaraz Garfia', 'Carlos Alcaraz') > 0);
  assert.strictEqual(pairScore('Carlos Alcaraz', 'Novak Djokovic'), 0);
});

test('the level classifier drops doubles, qualifying and women rather than guessing', async () => {
  const { classify } = await load();
  assert.strictEqual(classify('ATP Cincinnati'), 'atp');
  assert.strictEqual(classify('Challenger Braunschweig'), 'challenger');
  assert.strictEqual(classify('US Open'), 'slam');
  assert.strictEqual(classify('ITF M25 Monastir'), 'itf');
  // ` MD` is a DOUBLES container, not "main draw" — getting this backwards fills
  // the sample with doubles, whose markets are a different question entirely.
  assert.strictEqual(classify('ATP Cincinnati MD'), null);
  assert.strictEqual(classify('Challenger Braunschweig Qualifying'), null);
  assert.strictEqual(classify('WTA Cincinnati'), null);
  assert.strictEqual(classify('Some Exhibition Thing'), null);
});
