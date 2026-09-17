/**
 * TEN-227 match-winner history download — the parts that can be wrong SILENTLY.
 *
 *   node --test tools/test-ten227-history.js
 *
 * Three things, and only three, because everything else in the tool prints a
 * measurement with its own n:
 *
 *   1. The DDL allowlist. It is the only thing between this download and the
 *      production Supabase project — including the TEN-216 collector and the
 *      TEN-225 tables the brief says not to touch. Asserted against statements
 *      it must REFUSE, such as a forbidden verb chained behind a legal
 *      `create table`, because the Management API runs multi-statement SQL.
 *   2. `deriveClose`, which IS board ruling 1. A Close that quietly takes an
 *      in-play quote is not a wrong-looking number: it is a plausible price
 *      that silently poisons every line-coverage figure built on it. Each case
 *      below is written so a naive implementation PASSES the happy path and
 *      FAILS here — rows[0] is deliberately the row a "take the first one,
 *      they come newest first" reading would pick.
 *   3. The eligibility filter. Doubles, qualifying, women's draws and Davis Cup
 *      rubbers entering an "ATP + Challenger singles" download would produce a
 *      confident report about the wrong matches.
 */
const test = require('node:test');
const assert = require('node:assert');

const load = () => import('./ten227-history.mjs');

/* ------------------------------------------------------------- DDL allowlist */

test('every shipped DDL statement passes its own guard', async () => {
  const { assertDdlAllowed, TABLES } = await load();
  assert.ok(TABLES.length >= 6, `expected the tool to ship its tables, got ${TABLES.length}`);
  for (const sql of TABLES) {
    const name = assertDdlAllowed(sql);
    assert.match(name, /^betsapi_raw_/, `statement targets "${name}": ${sql.slice(0, 60)}`);
  }
});

test('the guard refuses everything outside betsapi_raw_*', async () => {
  const { assertDdlAllowed } = await load();
  const forbidden = [
    ['drops the TEN-216 collector table', 'drop table ten216_test_odds_changes'],
    ['drops the TEN-225 line summary', 'drop table oddspapi_line_summary'],
    ['drops one of ours', 'drop table betsapi_raw_mw_matches'],
    ['truncates', 'truncate table betsapi_raw_mw_matches'],
    ['deletes rows', 'delete from betsapi_raw_mw_days'],
    ['touches the upcoming-campaign tables', 'create index if not exists i on betsapi_upcoming_test_polls (betsapi_event_id)'],
    ['creates a table elsewhere', 'create table if not exists matches_backup (id text)'],
    ['grants', 'grant select on betsapi_raw_mw_matches to anon'],
    ['opens a policy', 'create policy p on betsapi_raw_mw_matches for select using (true)'],
    ['schedules a cron job', "select cron.schedule('x','* * * * *','select 1')"],
    ['alters a column instead of enabling RLS', 'alter table betsapi_raw_mw_matches add column x text'],
    ['chains a drop behind a legal create', 'create table if not exists betsapi_raw_mw_x (id text); drop table matches'],
  ];
  for (const [why, sql] of forbidden) {
    assert.throws(() => assertDdlAllowed(sql), /refusing|only allowed/i, `guard ACCEPTED a statement that ${why}: ${sql}`);
  }
});

/* ----------------------------------------------- ruling 1: the Close derivation */

const START = 1_700_000_000;                 // the "actual start", unix seconds
const row = (o) => ({ id: 'x', home_od: '1.80', away_od: '2.00', ss: null, time_str: null, ...o });

test('pickStart follows ruling 1\'s ladder and flags the scheduled fallback', async () => {
  const { pickStart } = await load();
  assert.deepStrictEqual(pickStart({ trueStart: 10, liveFlip: 20, schedStart: 30 }), { ts: 10, source: 'true_start', flagged: false });
  assert.deepStrictEqual(pickStart({ liveFlip: 20, schedStart: 30 }), { ts: 20, source: 'live_flip', flagged: false });
  const sched = pickStart({ schedStart: 30 });
  assert.strictEqual(sched.source, 'scheduled');
  assert.strictEqual(sched.flagged, true, 'a scheduled start is an UPPER BOUND and must be flagged');
  assert.strictEqual(pickStart({}), null, 'with no start at all the tool must refuse, not guess');
});

test('Close is the latest PRE-START row, not the newest row in the array', async () => {
  const { deriveClose, pickStart } = await load();
  // Vendor order: newest first. rows[0] is in-play — the trap.
  const rows = [
    row({ id: 'inplay', add_time: START + 600, ss: '3-2', time_str: '25:14', home_od: '1.20' }),
    row({ id: 'kickoff_ish', add_time: START - 30, home_od: '1.85', away_od: '1.95' }),
    row({ id: 'earlier', add_time: START - 4000, home_od: '1.70', away_od: '2.10' }),
  ];
  const r = deriveClose(rows, pickStart({ trueStart: START }));
  assert.strictEqual(r.close.odds_id, 'kickoff_ish');
  assert.strictEqual(r.close.home_dec, 1.85);
  assert.strictEqual(r.n_eligible, 2);
  assert.strictEqual(r.lead_seconds, 30);
  assert.strictEqual(r.start_flagged, false);
});

test('array order cannot change the answer', async () => {
  const { deriveClose, pickStart } = await load();
  const rows = [
    row({ id: 'a', add_time: START - 4000 }),
    row({ id: 'b', add_time: START - 30 }),
    row({ id: 'c', add_time: START - 900 }),
  ];
  const start = pickStart({ trueStart: START });
  assert.strictEqual(deriveClose(rows, start).close.odds_id, 'b');
  assert.strictEqual(deriveClose([...rows].reverse(), start).close.odds_id, 'b');
});

test('a row stamped after the start is excluded even with a null score', async () => {
  const { deriveClose, pickStart } = await load();
  // This is the case the last probe caught: a market still quoted at 0-0 AFTER
  // the scheduled start. Ruling 1 requires BOTH conditions, not either.
  const rows = [
    row({ id: 'after_start_null_score', add_time: START + 120 }),
    row({ id: 'legit', add_time: START - 60 }),
  ];
  const r = deriveClose(rows, pickStart({ trueStart: START }));
  assert.strictEqual(r.close.odds_id, 'legit');
  assert.strictEqual(r.n_excluded_after_start, 1);
});

test('all-zero set scores are pre-start; anything else is not', async () => {
  const { isPreStartRow } = await load();
  for (const ss of [null, '', '0-0', '0-0,0-0', ' 0-0 , 0-0 ']) {
    assert.strictEqual(isPreStartRow(row({ ss })), true, `ss=${JSON.stringify(ss)} should be pre-start`);
  }
  for (const ss of ['0-1', '1-0', '6-4,0-0', '0']) {
    assert.strictEqual(isPreStartRow(row({ ss })), false, `ss=${JSON.stringify(ss)} must NOT be pre-start`);
  }
  assert.strictEqual(isPreStartRow(row({ ss: '0-0', time_str: '0:42' })), false,
    'an in-play clock disqualifies the row whatever the score says');
});

test('a row with no usable price cannot be a closing price', async () => {
  const { deriveClose, pickStart } = await load();
  const rows = [
    row({ id: 'dashed', add_time: START - 10, home_od: '-', away_od: '-' }),
    row({ id: 'priced', add_time: START - 300, home_od: '1.44', away_od: '2.75' }),
  ];
  const r = deriveClose(rows, pickStart({ trueStart: START }));
  assert.strictEqual(r.close.odds_id, 'priced');
  assert.strictEqual(r.n_excluded_no_price, 1);
});

test('no start time and no eligible rows both yield a null Close, never a guess', async () => {
  const { deriveClose, pickStart } = await load();
  const rows = [row({ id: 'a', add_time: START - 10 })];
  assert.strictEqual(deriveClose(rows, pickStart({})).close, null, 'no start time at all must not produce a Close');
  assert.strictEqual(deriveClose(rows, null).close, null);
  const allInPlay = [row({ id: 'p', add_time: START + 5, ss: '1-0' })];
  const r = deriveClose(allInPlay, pickStart({ trueStart: START }));
  assert.strictEqual(r.close, null);
  assert.strictEqual(r.n_eligible, 0);
  assert.strictEqual(r.n_rows, 1);
});

test('a scheduled-start Close is flagged in the result', async () => {
  const { deriveClose, pickStart } = await load();
  const r = deriveClose([row({ id: 'a', add_time: START - 10 })], pickStart({ schedStart: START }));
  assert.strictEqual(r.start_source, 'scheduled');
  assert.strictEqual(r.start_flagged, true);
});

test('parseOdds handles decimal, fractional and rubbish', async () => {
  const { parseOdds } = await load();
  assert.strictEqual(parseOdds('1.83'), 1.83);
  assert.strictEqual(parseOdds('5/6'), 1 + 5 / 6);
  for (const bad of [null, undefined, '', '-', 'evs', '0', '-2.5']) assert.strictEqual(parseOdds(bad), null, `parseOdds(${JSON.stringify(bad)})`);
});

test('the kickoff cross-check never turns missing data into agreement', async () => {
  const { compareCloseKickoff } = await load();
  assert.strictEqual(compareCloseKickoff(null, row({})), null);
  assert.strictEqual(compareCloseKickoff({ home_dec: 1.8, away_dec: 2.0 }, null), null);
  assert.strictEqual(compareCloseKickoff({ home_dec: 1.8, away_dec: 2.0 }, row({ home_od: '-', away_od: '-' })), null);
  const same = compareCloseKickoff({ home_dec: 1.8, away_dec: 2.0 }, row({ home_od: '1.80', away_od: '2.00', add_time: START }));
  assert.strictEqual(same.agree, true);
  const off = compareCloseKickoff({ home_dec: 1.8, away_dec: 2.0 }, row({ home_od: '1.75', away_od: '2.05', add_time: START }));
  assert.strictEqual(off.agree, false);
  assert.ok(Math.abs(off.d_home - 0.05) < 1e-9);
  const late = compareCloseKickoff({ home_dec: 1.8, away_dec: 2.0 }, row({ home_od: '1.80', away_od: '2.00', ss: '1-0', add_time: START }));
  assert.strictEqual(late.kickoff_inplay, true, 'an in-play kickoff row must be visible as such');
});

/* ----------------------------------------------------------- scope filtering */

const ev = (o) => ({ id: 1, time: START, time_status: '3', league: { name: 'ATP Cincinnati' }, home: { name: 'A Zverev' }, away: { name: 'C Alcaraz' }, ...o });

test('only ended ATP/Slam/Challenger singles are eligible', async () => {
  const { eligible } = await load();
  assert.strictEqual(eligible(ev()), 'atp');
  assert.strictEqual(eligible(ev({ league: { name: 'Challenger Como' } })), 'challenger');
  assert.strictEqual(eligible(ev({ league: { name: 'US Open' } })), 'slam');

  const rejected = [
    ['doubles container', ev({ league: { name: 'ATP Cincinnati MD' } })],
    ['explicit doubles', ev({ league: { name: 'ATP Cincinnati Doubles' } })],
    ['qualifying', ev({ league: { name: 'ATP Cincinnati Qualifying' } })],
    ['women', ev({ league: { name: 'WTA Cincinnati' } })],
    ['ITF, out of scope', ev({ league: { name: 'ITF M25 Sofia' } })],
    ['not ended normally', ev({ time_status: '4' })],
    ['still in play', ev({ time_status: '1' })],
    ['a doubles pairing', ev({ home: { name: 'Bopanna/Ebden' } })],
    ['a Davis Cup rubber', ev({ league: { name: 'ATP Davis Cup' }, home: { name: 'Italy' }, away: { name: 'Spain' } })],
    ['no league', ev({ league: null })],
  ];
  for (const [why, e] of rejected) assert.strictEqual(eligible(e), null, `accepted ${why}`);
});

test('daysOfYear runs newest first and never into the future', async () => {
  const { daysOfYear } = await load();
  const today = new Date(Date.UTC(2026, 8, 17));
  const y2026 = daysOfYear(2026, today);
  assert.strictEqual(y2026[0], '20260917', 'must start at today');
  assert.strictEqual(y2026.at(-1), '20260101');
  assert.strictEqual(y2026.length, 260);
  const y2024 = daysOfYear(2024, today);
  assert.strictEqual(y2024.length, 366, '2024 is a leap year');
  assert.strictEqual(y2024[0], '20241231');
});
