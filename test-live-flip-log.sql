-- TEN-225 item 2a — offline-ish harness for record_live_flips().
--
-- There is no local Postgres on this machine, so this runs against the real
-- instance but inside a transaction that is ALWAYS rolled back. It touches
-- neither live_snapshot nor the poller: record_live_flips() takes both boards
-- as arguments precisely so it can be exercised this way.
--
-- Every assertion RAISES on failure, so a wrong result aborts the statement and
-- the caller sees a non-200 rather than a green run over a broken recorder.
--
-- The last block is a FAILING CONTROL: it deliberately breaks an expectation and
-- asserts that the harness catches it. Without that, a harness that silently
-- asserts nothing (0 of 0 passed) reads identically to one that passes.

begin;

-- Nothing below may survive. The rollback at the end is the guarantee, but the
-- savepoint-free structure means an early raise also unwinds everything.

do $$
declare
  t0 timestamptz := '2026-09-17T12:00:00Z';
  t1 timestamptz := '2026-09-17T12:00:10Z';   -- +10s, the poller cadence
  t2 timestamptz := '2026-09-17T12:00:20Z';
  t3 timestamptz := '2026-09-17T12:00:30Z';
  empty_board jsonb := '{"matches": []}'::jsonb;
  board_a jsonb;
  board_b jsonb;
  board_c jsonb;
  n int;
  r record;
  failed boolean;
begin
  -- Isolate: the real table may already hold rows for real fixtures. Every key
  -- used here is prefixed TEST- so nothing can collide with a real event_key.
  delete from public.live_flip_log where event_key like 'TEST-%';

  -- ---------------------------------------------------------------------
  -- board_a: two live fixtures + one NOT-live fixture that must be ignored.
  -- ---------------------------------------------------------------------
  board_a := jsonb_build_object('matches', jsonb_build_array(
    jsonb_build_object('event_key','TEST-1','event_live','1',
      'event_date','2026-09-17','event_time','12:00',
      'event_first_player','A. One','event_second_player','B. Two',
      'tournament_name','Test Open','event_type_type','Atp Singles'),
    jsonb_build_object('event_key','TEST-2','event_live','1',
      'event_date','2026-09-17','event_time','12:05',
      'event_first_player','C. Three','event_second_player','D. Four',
      'tournament_name','Test Open','event_type_type','Challenger Men Singles'),
    -- present in the payload but NOT live: must never be recorded, because a
    -- false first sighting can never be corrected afterwards.
    jsonb_build_object('event_key','TEST-NOTLIVE','event_live','0',
      'event_first_player','E. Five','event_second_player','F. Six')
  ));

  n := public.record_live_flips(board_a, empty_board, t0, t1, 'test');
  if n <> 2 then
    raise exception 'T1 FAILED: expected 2 first sightings, got %', n;
  end if;
  if exists (select 1 from public.live_flip_log where event_key = 'TEST-NOTLIVE') then
    raise exception 'T2 FAILED: a fixture with event_live=0 was recorded';
  end if;

  -- bounds and gap
  select * into r from public.live_flip_log where event_key = 'TEST-1';
  if r.first_live_seen_at <> t1 then
    raise exception 'T3 FAILED: first_live_seen_at = %, expected %', r.first_live_seen_at, t1;
  end if;
  if r.last_not_live_seen_at <> t0 then
    raise exception 'T4 FAILED: last_not_live_seen_at = %, expected %', r.last_not_live_seen_at, t0;
  end if;
  if r.gap_seconds <> 10 then
    raise exception 'T5 FAILED: gap_seconds = %, expected 10', r.gap_seconds;
  end if;
  if r.poller <> 'test' then
    raise exception 'T6 FAILED: poller = %, expected test', r.poller;
  end if;
  -- identity captured at flip time, so Part 2 can pair without re-querying
  if r.first_player <> 'A. One' or r.second_player <> 'B. Two'
     or r.tournament_name <> 'Test Open' or r.event_type_type <> 'Atp Singles'
     or r.event_date <> '2026-09-17' then
    raise exception 'T7 FAILED: identity columns not captured: %', r;
  end if;

  -- ---------------------------------------------------------------------
  -- board_b: TEST-1 still live, TEST-2 has LEFT, TEST-3 is new.
  -- Only TEST-3 is a first sighting.
  -- ---------------------------------------------------------------------
  board_b := jsonb_build_object('matches', jsonb_build_array(
    jsonb_build_object('event_key','TEST-1','event_live','1'),
    jsonb_build_object('event_key','TEST-3','event_live','1',
      'event_first_player','G. Seven','event_second_player','H. Eight')
  ));
  n := public.record_live_flips(board_b, board_a, t1, t2, 'test');
  if n <> 1 then
    raise exception 'T8 FAILED: expected 1 new sighting (TEST-3), got %', n;
  end if;
  if not exists (select 1 from public.live_flip_log where event_key = 'TEST-3') then
    raise exception 'T9 FAILED: TEST-3 was not recorded';
  end if;

  -- ---------------------------------------------------------------------
  -- board_c: TEST-2 RETURNS after being absent. First sighting wins forever --
  -- this must record nothing and must not move TEST-2's original timestamps.
  -- ---------------------------------------------------------------------
  board_c := jsonb_build_object('matches', jsonb_build_array(
    jsonb_build_object('event_key','TEST-1','event_live','1'),
    jsonb_build_object('event_key','TEST-2','event_live','1'),
    jsonb_build_object('event_key','TEST-3','event_live','1')
  ));
  n := public.record_live_flips(board_c, board_b, t2, t3, 'test');
  if n <> 0 then
    raise exception 'T10 FAILED: a returning fixture minted % new sighting(s); '
                    'first sighting must win forever', n;
  end if;
  select * into r from public.live_flip_log where event_key = 'TEST-2';
  if r.first_live_seen_at <> t1 or r.last_not_live_seen_at <> t0 or r.gap_seconds <> 10 then
    raise exception 'T11 FAILED: TEST-2 timestamps were rewritten on re-entry: %', r;
  end if;

  -- ---------------------------------------------------------------------
  -- A duplicate event_key inside ONE board must yield exactly one row.
  -- ---------------------------------------------------------------------
  delete from public.live_flip_log where event_key like 'TEST-%';
  n := public.record_live_flips(
    jsonb_build_object('matches', jsonb_build_array(
      jsonb_build_object('event_key','TEST-DUP','event_live','1'),
      jsonb_build_object('event_key','TEST-DUP','event_live','1'))),
    empty_board, t0, t1, 'test');
  if n <> 1 then
    raise exception 'T12 FAILED: duplicate key in one board produced % rows', n;
  end if;

  -- ---------------------------------------------------------------------
  -- No previous snapshot at all -> bound unknown -> gap_seconds NULL, never 0.
  -- A 0 here would pass the <=300s reliability rule on no evidence.
  -- ---------------------------------------------------------------------
  delete from public.live_flip_log where event_key like 'TEST-%';
  n := public.record_live_flips(
    jsonb_build_object('matches', jsonb_build_array(
      jsonb_build_object('event_key','TEST-NULLPREV','event_live','1'))),
    null, null, t1, 'test');
  select * into r from public.live_flip_log where event_key = 'TEST-NULLPREV';
  if r.gap_seconds is not null then
    raise exception 'T13 FAILED: gap_seconds = % with no previous bound, expected NULL',
      r.gap_seconds;
  end if;

  -- ---------------------------------------------------------------------
  -- An empty board is a normal quiet tick, not an error.
  -- ---------------------------------------------------------------------
  n := public.record_live_flips(empty_board, empty_board, t0, t1, 'test');
  if n <> 0 then
    raise exception 'T14 FAILED: empty board recorded % sightings', n;
  end if;

  -- ---------------------------------------------------------------------
  -- FAILING CONTROL. Assert that the harness can actually fail: feed it a board
  -- whose fixture IS in the previous board and check that the "expected 1"
  -- assertion would have fired. If this block does NOT raise, every assertion
  -- above is worthless and we say so loudly.
  -- ---------------------------------------------------------------------
  delete from public.live_flip_log where event_key like 'TEST-%';
  failed := false;
  begin
    n := public.record_live_flips(
      jsonb_build_object('matches', jsonb_build_array(
        jsonb_build_object('event_key','TEST-CTRL','event_live','1'))),
      jsonb_build_object('matches', jsonb_build_array(
        jsonb_build_object('event_key','TEST-CTRL','event_live','1'))),
      t0, t1, 'test');
    if n <> 1 then
      raise exception 'control fired';   -- expected: n is 0, so this DOES fire
    end if;
  exception when others then
    failed := true;
  end;
  if not failed then
    raise exception 'CONTROL FAILED: a fixture already live in the previous board '
                    'was counted as a first sighting -- the recorder is not '
                    'diffing the boards at all, and every assertion above is vacuous';
  end if;

  delete from public.live_flip_log where event_key like 'TEST-%';
  raise notice 'live_flip_log harness: 14 assertions + 1 failing control PASSED';
end
$$;

rollback;
