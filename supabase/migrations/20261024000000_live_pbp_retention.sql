-- Point-by-point carry-over (founder brief 2026-10-23): a finished match's point log stays readable the moment it ends.
--
-- Before: write_live_pbp() deleted a match's row on the first tick after it left the live board, so the live tab's point
-- log vanished at the finish and the finished-match view had nothing until the next pipeline publish (measured
-- 2026-10-24: +149 min on van Assche v Musetti, while the data runs were frozen; 25-60 min when they are not).
-- After:
--   1. A row whose match leaves the board is KEPT, stamped ended_at, for 6 hours, then deleted.
--   2. write_live_pbp_final() writes the provider's own log for an ended match (the poller re-asks get_fixtures for 2 h
--      after the end) and its final summary (status, result, set scores, players). It never writes an empty log over a
--      log, and never an older fetch over a newer one.
--   3. live_pbp_due_finals() names the ended matches due a re-ask.
-- Additive and idempotent. Applied by supabase-live-golive.yml AFTER 20260901000100_live_pbp_rpc.sql (which re-creates
-- the one-argument write_live_pbp this file replaces).

alter table public.live_pbp add column if not exists ended_at timestamptz;   -- null while the match is on the live board
alter table public.live_pbp add column if not exists final    jsonb;         -- provider fixture summary once ended
alter table public.live_pbp add column if not exists final_at timestamptz;   -- when the poller last fetched the final log

-- One argument (the old poller) or two (_live: every event_key on the board, with or without a point log yet).
drop function if exists public.write_live_pbp(jsonb);
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
end;
$$;
revoke execute on function public.write_live_pbp(jsonb, jsonb) from public, anon, authenticated;
grant  execute on function public.write_live_pbp(jsonb, jsonb) to service_role;   -- the poller's role

-- The provider's own log for an ended match. _pbp empty or not an array: the log is left as it is (never blanked).
create or replace function public.write_live_pbp_final(_event_key text, _pbp jsonb, _final jsonb, _fetched_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.live_pbp
     set pbp = case when jsonb_typeof(_pbp) = 'array' and jsonb_array_length(_pbp) > 0 then _pbp else pbp end,
         final = coalesce(_final, final),
         final_at = _fetched_at,
         updated_at = case when jsonb_typeof(_pbp) = 'array' and jsonb_array_length(_pbp) > 0 then _fetched_at else updated_at end
   where event_key = _event_key
     and ended_at is not null                                   -- only once off the board: the live tick owns a live row
     and (final_at is null or final_at < _fetched_at);          -- never an older fetch over a newer one
end;
$$;
revoke execute on function public.write_live_pbp_final(text, jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant  execute on function public.write_live_pbp_final(text, jsonb, jsonb, timestamptz) to service_role;   -- the poller's role

-- Ended matches due a re-ask: ended within _window_min minutes, last fetched _every_s seconds ago or never. Oldest first.
create or replace function public.live_pbp_due_finals(_window_min int, _every_s int, _max int)
returns setof text
language sql
security definer
set search_path = public
as $$
  select event_key from public.live_pbp
   where ended_at is not null and ended_at > now() - make_interval(mins => _window_min)
     and (final_at is null or final_at < now() - make_interval(secs => _every_s))
   order by coalesce(final_at, ended_at) asc
   limit _max;
$$;
revoke execute on function public.live_pbp_due_finals(int, int, int) from public, anon, authenticated;
grant  execute on function public.live_pbp_due_finals(int, int, int) to service_role;   -- the poller's role
