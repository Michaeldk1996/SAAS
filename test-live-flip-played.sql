-- played-start-recorder harness (founder ruling 2026-10-26) for record_live_flips_played() and match_played().
--
-- Runs against the real instance inside a transaction that is ALWAYS rolled back (like test-live-flip-log.sql): keys
-- are TEST-P*, both boards are arguments, nothing survives. ten225-live-flip.yml mode=install runs it BEFORE
-- 20261027090100_record_live_flips_played.sql switches the live recorder; any RAISE fails that step.
--
-- MUTANTS. Each named mutant is the REAL function's definition (pg_get_functiondef) copied into pg_temp with one
-- textual change; the same scenarios must FAIL against it. A mutant whose anchor is missing raises too, so a rewrite
-- cannot silently retire one. Each scenario names the mutant that turns it red:
--   S1 flag, no play, then play at +6 min -> row with NO lower bound (no close cut)        T_IGNORED
--   S2 flag, play at +2 min -> lower bound = the poll before the flag, not play-seen time   CUT_AT_PLAY_SEEN
--   S3 a flag alone is not a start: no live_flip_log row while no play is on the board      FLAG_IS_START
--   S4 flag, drop off the board, flag again, play -> the bound is the poll before the 2nd flag   PENDING_KEPT_ON_DROP
--   S5 play_seen_at is recorded on every promoted row (the shadow measurement)              NO_PLAY_SEEN_AT
--   S6 match_played(): false-live fixture is not play; each evidence kind is; junk score is not   (direct checks)
begin;

create function pg_temp.lfp_scen(fn text) returns text language plpgsql as $s$
declare
  t0 timestamptz := '2026-10-26T12:00:00Z';
  e  jsonb := '{"matches": []}'::jsonb;
  falselive jsonb := '{"event_live":"1","event_status":"Set 1","event_game_result":"0 - 0","event_final_result":"0 - 0","event_serve":null,"scores":[]}'::jsonb;
  played jsonb := '{"event_live":"1","event_status":"Set 1","event_game_result":"15 - 0","event_final_result":"0 - 0","scores":[{"score_first":"0","score_second":"0","score_set":"1"}]}'::jsonb;
  b_flag jsonb; b_play jsonb; r record; n int;
  call text := format('select %s($1, $2, $3, $4, %L, 300)', fn, 'test');
  at_ timestamptz;
begin
  delete from public.live_flip_log where event_key like 'TEST-P%';
  delete from public.live_flip_pending where event_key like 'TEST-P%';

  -- S1: flag at t0+10s (previous poll t0), still no play at +3 min, play at +6 min
  b_flag := jsonb_build_object('matches', jsonb_build_array(falselive || '{"event_key":"TEST-P1","event_first_player":"A. One","event_second_player":"B. Two"}'));
  b_play := jsonb_build_object('matches', jsonb_build_array(played    || '{"event_key":"TEST-P1","event_first_player":"A. One","event_second_player":"B. Two"}'));
  execute call into n using b_flag, e, t0, t0 + interval '10 seconds';
  execute call into n using b_flag, b_flag, t0 + interval '3 minutes', t0 + interval '3 minutes 10 seconds';
  if exists (select 1 from public.live_flip_log where event_key = 'TEST-P1') then return 'S3: a live flag with no play reached live_flip_log'; end if;
  if not exists (select 1 from public.live_flip_pending where event_key = 'TEST-P1') then return 'S3: the flag is not held in live_flip_pending'; end if;
  execute call into n using b_play, b_flag, t0 + interval '6 minutes', t0 + interval '6 minutes 10 seconds';
  select * into r from public.live_flip_log where event_key = 'TEST-P1';
  if r is null then return 'S1: play after 6 min wrote no row'; end if;
  if r.last_not_live_seen_at is not null or r.gap_seconds is not null then
    return format('S1: play seen after T kept a lower bound (%s) — a close could be cut at it', r.last_not_live_seen_at); end if;
  if r.first_live_seen_at <> t0 + interval '10 seconds' then return 'S1: first_live_seen_at is not the flag poll'; end if;
  if exists (select 1 from public.live_flip_pending where event_key = 'TEST-P1') then return 'S1: the pending row was not removed'; end if;

  -- S2: flag at t0+10s, play at +2 min -> the cut is t0 (the poll before the flag)
  b_flag := jsonb_build_object('matches', jsonb_build_array(falselive || '{"event_key":"TEST-P2"}'));
  b_play := jsonb_build_object('matches', jsonb_build_array(played    || '{"event_key":"TEST-P2"}'));
  execute call into n using b_flag, e, t0, t0 + interval '10 seconds';
  execute call into n using b_play, b_flag, t0 + interval '1 minute 50 seconds', t0 + interval '2 minutes';
  if n <> 1 then return format('S2: expected 1 row written on the play tick, got %s', n); end if;
  select * into r from public.live_flip_log where event_key = 'TEST-P2';
  if r is null then return 'S2: play within T wrote no row'; end if;
  if r.last_not_live_seen_at is distinct from t0 then
    return format('S2: the cut is %s, not the poll before the flag (%s)', r.last_not_live_seen_at, t0); end if;
  if r.gap_seconds is distinct from 10::numeric then return format('S2: gap_seconds %s, expected 10', r.gap_seconds); end if;
  if r.first_live_seen_at <> t0 + interval '10 seconds' then return 'S2: first_live_seen_at is not the flag poll'; end if;
  -- S5
  if r.play_seen_at is distinct from t0 + interval '2 minutes' then return format('S5: play_seen_at %s, expected the play tick', r.play_seen_at); end if;

  -- S4: flag (prev t0), drop off at +1 min, flag again at +20 min (prev +19m50s), play at +21 min
  b_flag := jsonb_build_object('matches', jsonb_build_array(falselive || '{"event_key":"TEST-P4"}'));
  b_play := jsonb_build_object('matches', jsonb_build_array(played    || '{"event_key":"TEST-P4"}'));
  execute call into n using b_flag, e, t0, t0 + interval '10 seconds';
  execute call into n using e, b_flag, t0 + interval '10 seconds', t0 + interval '1 minute';
  if exists (select 1 from public.live_flip_pending where event_key = 'TEST-P4') then return 'S4: a flag that left the board is still pending'; end if;
  execute call into n using b_flag, e, t0 + interval '19 minutes 50 seconds', t0 + interval '20 minutes';
  execute call into n using b_play, b_flag, t0 + interval '20 minutes 50 seconds', t0 + interval '21 minutes';
  select * into r from public.live_flip_log where event_key = 'TEST-P4';
  if r is null or r.last_not_live_seen_at is distinct from t0 + interval '19 minutes 50 seconds' then
    return format('S4: the cut is %s, expected the poll before the SECOND flag', coalesce(r.last_not_live_seen_at::text, 'no row')); end if;

  -- S3 again, the plainest form: one false-live tick is pending, not logged
  b_flag := jsonb_build_object('matches', jsonb_build_array(falselive || '{"event_key":"TEST-P3"}'));
  execute call into n using b_flag, e, t0, t0 + interval '10 seconds';
  if n <> 0 or exists (select 1 from public.live_flip_log where event_key = 'TEST-P3') then return 'S3: a bare live flag was written as a start'; end if;

  return null;
end;
$s$;

do $$
declare
  why text;
  def text;
  base text := pg_get_functiondef('public.record_live_flips_played(jsonb,jsonb,timestamptz,timestamptz,text,numeric)'::regprocedure);
  m record;
begin
  -- S6: match_played, directly
  if public.match_played('{"event_live":"1","event_status":"Set 1","event_game_result":"0 - 0","scores":[]}') then raise exception 'S6: "Set 1" at 0-0 counted as play'; end if;
  if public.match_played('{"event_live":"1","event_status":"Set 1","event_game_result":"-","scores":[{"score_first":"0","score_second":"0"}]}') then raise exception 'S6: 0-0 set score counted as play'; end if;
  if public.match_played('{"event_status":"Set 1","scores":[{"score_first":"x","score_second":"y"}]}') then raise exception 'S6: an unreadable score counted as play'; end if;
  if not public.match_played('{"event_status":"Set 1","event_game_result":"15 - 0"}') then raise exception 'S6: a game score is play'; end if;
  if not public.match_played('{"event_status":"Set 1","scores":[{"score_first":"1","score_second":"0"}]}') then raise exception 'S6: a set score above 0-0 is play'; end if;
  if not public.match_played('{"event_status":"Set 1","pointbypoint":[{"points":[{"score":"15 - 0"}]}]}') then raise exception 'S6: a point in the point-by-point is play'; end if;
  if not public.match_played('{"event_status":"Finished"}') then raise exception 'S6: a finished event is play'; end if;
  if public.match_played(null) then raise exception 'S6: null is not play'; end if;

  why := pg_temp.lfp_scen('public.record_live_flips_played');
  if why is not null then raise exception 'REAL FUNCTION FAILED: %', why; end if;

  -- the mutants: each must turn at least one scenario red
  for m in select * from (values
      ('T_IGNORED',            'case when in_time then last_not_live_seen_at end', 'last_not_live_seen_at'),
      ('CUT_AT_PLAY_SEEN',     'case when in_time then last_not_live_seen_at end', 'case when in_time then _now end'),
      ('FLAG_IS_START',        'where public.match_played(cur.fix)',               'where true'),
      ('PENDING_KEPT_ON_DROP', 'delete from public.live_flip_pending p where not exists', 'delete from public.live_flip_pending p where false and not exists'),
      ('NO_PLAY_SEEN_AT',      'event_type_type, _now',                            'event_type_type, null')
    ) v(name, anchor, repl)
  loop
    if position(m.anchor in base) = 0 then raise exception 'mutant % has lost its anchor — re-anchor it, never drop it', m.name; end if;
    def := replace(replace(base, 'public.record_live_flips_played(', 'pg_temp.lfp_mutant('), m.anchor, m.repl);
    execute def;
    why := pg_temp.lfp_scen('pg_temp.lfp_mutant');
    if why is null then raise exception 'MUTANT % SURVIVED: the harness did not notice it', m.name; end if;
    raise notice 'mutant % killed: %', m.name, why;
    execute 'drop function pg_temp.lfp_mutant(jsonb,jsonb,timestamptz,timestamptz,text,numeric)';
  end loop;
end
$$;

rollback;
