-- played-start-recorder (founder ruling 2026-10-26) — a live flag is not a start until play is seen.
--
-- WHY. On 2026-10-26 at 12:18:31Z api-tennis listed Berrettini v Etcheverry, Vacherot v Navone and Echargui v Hassan
-- as event_live 1 / "Set 1" at 0-0 with no server and no point. record_live_flips() took the flag as the start, and
-- tools/pinarch.py pull cut three Pinnacle closes at it four minutes later (archive ids 3876-3878). Vacherot v Navone
-- was still 0-0 in set 1 at ~13:35Z.
--
-- THE RULE (founder): a close must be a price from before the first ball; an early close is acceptable, a late one
-- never is. So a live flag waits in live_flip_pending until the board shows play (match_played, the same definition
-- as the line-price worker's played()):
--   * play seen within _t_seconds (T = 300 s) of the flag -> live_flip_log with the ORIGINAL flag bounds: the cut is
--     the last poll before the flag, never the time play was seen;
--   * play seen later than T -> live_flip_log with last_not_live_seen_at and gap_seconds EMPTY, so no reader cuts a
--     close at it (every reader skips a row with no lower bound);
--   * play ALREADY on the board at the first sighting -> also no lower bound (founder 2026-10-27): the poll before
--     only proves the match was not listed live, not that no ball had been struck;
--   * the match leaves the live board before play -> the pending row is deleted (a later flag starts fresh).
-- Every promoted row carries play_seen_at (the shadow measurement of flag -> first play that T will be set from).
--
-- ADDITIVE ON PURPOSE. This file creates a new table, two new functions and one new nullable column; it does not touch
-- record_live_flips() or write_snapshot(). 20261027090100_record_live_flips_played.sql switches the live recorder over,
-- and only after test-live-flip-log.sql has passed against the function created here (ten225-live-flip.yml install).
-- Idempotent: if not exists / create or replace.

create table if not exists public.live_flip_pending (
  event_key             text        primary key,
  first_live_seen_at    timestamptz not null,    -- the poll that first showed the flag
  last_not_live_seen_at timestamptz,             -- the poll before it (the cut, if play follows within T)
  poller                text        not null,
  gap_seconds           numeric,
  event_date            text,
  event_time            text,                    -- SCHEDULED; provenance only, never read as a time (TEN-225 ruling 1)
  first_player          text,
  second_player         text,
  tournament_name       text,
  event_type_type       text,
  recorded_at           timestamptz not null default now()
);
alter table public.live_flip_pending enable row level security;
revoke all on public.live_flip_pending from anon, authenticated;

-- the shadow measurement: when the board first showed play for this row (null on rows recorded before this change)
alter table public.live_flip_log   add column if not exists play_seen_at timestamptz;
alter table public.live_flip_stats add column if not exists last_pending_count integer;

-- kibl-stream/line_engine.py played(), ported. A point must be on the board — a game score other than 0-0 / "-", a set
-- score above 0-0, a point in the point-by-point — or the event is over. A live flag or a "Set N" status alone is not
-- play. An unreadable score is skipped, never taken as play.
create or replace function public.match_played(fix jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  st text := lower(btrim(coalesce(fix ->> 'event_status', '')));
  g  text := replace(coalesce(fix ->> 'event_game_result', ''), ' ', '');
  x  jsonb;
  a  text;
  b  text;
begin
  if fix is null or jsonb_typeof(fix) <> 'object' then
    return false;
  end if;
  if st in ('finished', 'retired', 'walk over', 'walkover', 'cancelled', 'abandoned', 'defaulted') then
    return true;
  end if;
  if g <> '' and g not in ('0-0', '-') then
    return true;
  end if;
  if jsonb_typeof(fix -> 'scores') = 'array' then
    for x in select * from jsonb_array_elements(fix -> 'scores') loop
      if jsonb_typeof(x) <> 'object' then continue; end if;
      a := coalesce(nullif(btrim(x ->> 'score_first'), ''), '0');
      b := coalesce(nullif(btrim(x ->> 'score_second'), ''), '0');
      if a !~ '^\d+(\.\d+)?$' or b !~ '^\d+(\.\d+)?$' then continue; end if;
      if a::numeric + b::numeric > 0 then
        return true;
      end if;
    end loop;
  end if;
  if jsonb_typeof(fix -> 'pointbypoint') = 'array' then
    for x in select * from jsonb_array_elements(fix -> 'pointbypoint') loop
      if jsonb_typeof(x) = 'object' and jsonb_typeof(x -> 'points') = 'array' and jsonb_array_length(x -> 'points') > 0 then
        return true;
      end if;
    end loop;
  end if;
  return false;
end;
$$;

-- The recorder with the pending step. Same arguments as record_live_flips() plus T; same return (rows written to
-- live_flip_log this tick). Steps, in this order, inside the caller's transaction:
--   1. a key live now and not live on the previous board, with no live_flip_log row yet -> live_flip_pending;
--   2. a pending key whose current board row shows play -> live_flip_log (bounds kept within T, emptied after T),
--      play_seen_at = now; the pending row is removed;
--   3. a pending key no longer live on the board -> removed (the flag never turned into play);
--   4. a pending row older than 24 h -> removed (housekeeping; step 3 normally clears it first).
create or replace function public.record_live_flips_played(
  _board      jsonb,
  _prev_board jsonb,
  _prev_ts    timestamptz,
  _now        timestamptz,
  _poller     text default 'live-poller-10s',
  _t_seconds  numeric default 300
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  _board_n   int := 0;
  _live_n    int := 0;
  _new_n     int := 0;
  _pending_n int := 0;
begin
  select count(*) into _board_n
    from jsonb_array_elements(coalesce(_board -> 'matches', '[]'::jsonb)) fix;
  select count(*) into _live_n
    from jsonb_array_elements(coalesce(_board -> 'matches', '[]'::jsonb)) fix
   where fix ->> 'event_live' = '1' and coalesce(fix ->> 'event_key', '') <> '';

  -- 1. new flags wait here
  insert into public.live_flip_pending (
    event_key, first_live_seen_at, last_not_live_seen_at, poller, gap_seconds,
    event_date, event_time, first_player, second_player, tournament_name, event_type_type
  )
  select distinct on (fix ->> 'event_key')
         fix ->> 'event_key', _now, _prev_ts, _poller,
         case when _prev_ts is null then null else extract(epoch from (_now - _prev_ts)) end,
         fix ->> 'event_date', fix ->> 'event_time', fix ->> 'event_first_player', fix ->> 'event_second_player',
         fix ->> 'tournament_name', fix ->> 'event_type_type'
    from jsonb_array_elements(coalesce(_board -> 'matches', '[]'::jsonb)) fix
   where fix ->> 'event_live' = '1'
     and coalesce(fix ->> 'event_key', '') <> ''
     and not exists (select 1 from jsonb_array_elements(coalesce(_prev_board -> 'matches', '[]'::jsonb)) p
                      where p ->> 'event_live' = '1' and p ->> 'event_key' = fix ->> 'event_key')
     and not exists (select 1 from public.live_flip_log l where l.event_key = fix ->> 'event_key')
  on conflict (event_key) do nothing;

  -- 2. play seen: promote. Within T the flag-side bound stands; after T no bound is written.
  with cur as (
    select distinct on (fix ->> 'event_key') fix ->> 'event_key' as k, fix
      from jsonb_array_elements(coalesce(_board -> 'matches', '[]'::jsonb)) fix
     where coalesce(fix ->> 'event_key', '') <> ''
  ), ready as (
    -- in_time: play seen AFTER the flag tick and within T. Play already on the board at the first sighting (the
    -- flag tick itself) is not in time: the first ball may precede the poll before it (founder 2026-10-27).
    select p.*, (p.first_live_seen_at < _now and extract(epoch from (_now - p.first_live_seen_at)) <= _t_seconds) as in_time
      from public.live_flip_pending p
      join cur on cur.k = p.event_key
     where public.match_played(cur.fix)
  ), ins as (
    insert into public.live_flip_log (
      event_key, first_live_seen_at, last_not_live_seen_at, poller, gap_seconds,
      event_date, event_time, first_player, second_player, tournament_name, event_type_type, play_seen_at
    )
    select event_key, first_live_seen_at,
           case when in_time then last_not_live_seen_at end,
           poller,
           case when in_time then gap_seconds end,
           event_date, event_time, first_player, second_player, tournament_name, event_type_type, _now
      from ready
    on conflict (event_key) do nothing
    returning 1
  ), del as (
    delete from public.live_flip_pending p using ready r where p.event_key = r.event_key
  )
  select count(*) into _new_n from ins;

  -- 3. no longer live and never played: the flag was not a start
  delete from public.live_flip_pending p where not exists (select 1 from jsonb_array_elements(coalesce(_board -> 'matches', '[]'::jsonb)) fix where fix ->> 'event_live' = '1' and fix ->> 'event_key' = p.event_key);

  -- 4. housekeeping
  delete from public.live_flip_pending where first_live_seen_at < _now - interval '24 hours';

  select count(*) into _pending_n from public.live_flip_pending;

  update public.live_flip_stats
     set last_tick_at       = _now,
         last_board_count   = _board_n,
         last_live_count    = _live_n,
         last_new_count     = _new_n,
         last_pending_count = _pending_n,
         total_flips        = total_flips + _new_n,
         last_error         = null
   where id = 1;

  return _new_n;
end;
$$;

revoke execute on function public.record_live_flips_played(jsonb, jsonb, timestamptz, timestamptz, text, numeric)
  from public, anon, authenticated;
revoke execute on function public.match_played(jsonb) from public, anon, authenticated;
grant execute on function public.record_live_flips_played(jsonb, jsonb, timestamptz, timestamptz, text, numeric) to service_role;
