-- Match end time (founder brief 2026-11-11, news ticker v2 item A5): record, from the existing 10-second live poller,
-- the moment a match is first seen DECIDED, so a report can print a duration only when both ends were observed.
--
-- WHAT IS OBSERVED
--   The live board (get_livescore) keeps a decided match on it for a while with event_status 'Finished' / 'Retired'
--   and an event_winner (read 2026-11-11 09:39Z: three such rows on one board). So the end is bracketed by two ticks:
--     last_undecided_seen_at  the last tick the match was on the board and NOT decided;
--     decided_seen_at         the first tick it was decided.
--   Both are our clock (now() of the tick), ~10 s apart on a healthy poller. Nothing is estimated: a match first seen
--   already decided has no last_undecided_seen_at, and a reader must not print a duration for it.
--
-- WHERE
--   Inside write_live_pbp(), which the poller already calls every tick right after write_snapshot() and whose failure
--   never fails the tick. It reads the board the same tick just wrote (live_snapshot, at most 30 s old). No Edge
--   Function redeploy, no extra api-tennis call. The call is wrapped: an error in the recorder can never stop the
--   point-log write.
--
-- SCOPE  ATP and Challenger men's singles only (what our reports cover): about ten small upserts a tick. A row that is
--   decided is never written again. A row never decided (abandoned, left the board) is removed after 24 h.
-- Idempotent. Applied AFTER 20261024000000_live_pbp_retention.sql (it re-creates that file's write_live_pbp).

create table if not exists public.live_match_end (
  event_key              text        primary key,          -- api-tennis fixture key
  first_seen_at          timestamptz not null,              -- first tick this recorder saw the match on the board
  last_undecided_seen_at timestamptz,                       -- last tick on the board and not decided
  decided_seen_at        timestamptz,                       -- first tick decided (null while in play)
  event_status           text,                              -- the status at decided_seen_at
  event_winner           text,
  event_final_result     text,
  event_type_type        text,
  tournament_name        text,
  first_player           text,
  second_player          text,
  poller                 text        not null default 'live-poller-10s'
);
alter table public.live_match_end enable row level security;
revoke all on public.live_match_end from public, anon, authenticated;
grant select, insert, update, delete on public.live_match_end to service_role;

create or replace function public.record_match_ends(_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
begin
  with b as (
    select fix
      from public.live_snapshot s,
           jsonb_array_elements(case when jsonb_typeof(s.board -> 'matches') = 'array' then s.board -> 'matches' else '[]'::jsonb end) fix
     where s.id = 1
       and s.updated_at > _now - interval '30 seconds'            -- only the board this tick wrote, never a stale one
       and jsonb_typeof(fix) = 'object'
       and fix ->> 'event_type_type' in ('Atp Singles', 'Challenger Men Singles')
       and coalesce(fix ->> 'event_key', '') <> ''
  ), r as (
    select distinct on (fix ->> 'event_key')
           fix ->> 'event_key' as ek,
           (lower(coalesce(fix ->> 'event_status', '')) in ('finished', 'retired')
             and coalesce(fix ->> 'event_winner', '') <> '') as decided,
           fix
      from b
  ), w as (
    insert into public.live_match_end as e (event_key, first_seen_at, last_undecided_seen_at, decided_seen_at, event_status,
           event_winner, event_final_result, event_type_type, tournament_name, first_player, second_player)
    select ek, _now, case when decided then null else _now end, case when decided then _now end,
           fix ->> 'event_status', nullif(fix ->> 'event_winner', ''), fix ->> 'event_final_result', fix ->> 'event_type_type',
           fix ->> 'tournament_name', fix ->> 'event_first_player', fix ->> 'event_second_player'
      from r
    on conflict (event_key) do update
       set last_undecided_seen_at = case when excluded.decided_seen_at is null then excluded.last_undecided_seen_at else e.last_undecided_seen_at end,
           decided_seen_at        = excluded.decided_seen_at,
           event_status           = excluded.event_status,
           event_winner           = excluded.event_winner,
           event_final_result     = excluded.event_final_result
     where e.decided_seen_at is null                                -- a decided row is final: never written again
    returning 1
  )
  select count(*) into n from w;

  delete from public.live_match_end
   where decided_seen_at is null
     and coalesce(last_undecided_seen_at, first_seen_at) < _now - interval '24 hours';
  return n;
end;
$$;
revoke execute on function public.record_match_ends(timestamptz) from public, anon, authenticated;
grant  execute on function public.record_match_ends(timestamptz) to service_role;

-- write_live_pbp: the body of 20261024000000_live_pbp_retention.sql, unchanged, plus the wrapped recorder call.
create or replace function public.write_live_pbp(_pbp jsonb, _live jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  live_keys text[];
begin
  if _pbp is null or jsonb_typeof(_pbp) <> 'object' then _pbp := '{}'::jsonb; end if;
  -- The live set: the board's keys when the poller sends them, else the keys that carry a log (old poller).
  if _live is not null and jsonb_typeof(_live) = 'array' then
    select coalesce(array_agg(v), '{}') into live_keys from jsonb_array_elements_text(_live) v;
  else
    select coalesce(array_agg(k), '{}') into live_keys from jsonb_object_keys(_pbp) k;
  end if;

  -- Every match with a log this tick: its live log, and it is live again (ended_at cleared) if it had left.
  insert into public.live_pbp (event_key, pbp, updated_at, ended_at)
  select key, value, now(), null from jsonb_each(_pbp)
  on conflict (event_key) do update
    set pbp = excluded.pbp, updated_at = excluded.updated_at, ended_at = null;

  -- Left the board: kept, stamped once.
  update public.live_pbp set ended_at = now()
   where ended_at is null and not (event_key = any(live_keys));

  -- Six hours after the end, gone.
  delete from public.live_pbp where ended_at is not null and ended_at < now() - interval '6 hours';

  -- Match end recorder (2026-11-11). Wrapped: it can never fail the point-log write above.
  begin
    perform public.record_match_ends(now());
  exception when others then
    raise warning 'record_match_ends failed: %', sqlerrm;
  end;
end;
$$;
revoke execute on function public.write_live_pbp(jsonb, jsonb) from public, anon, authenticated;
grant  execute on function public.write_live_pbp(jsonb, jsonb) to service_role;   -- the poller's role
