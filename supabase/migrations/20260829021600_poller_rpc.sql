-- TEN-107 · Slice 2 — poller single-flight + snapshot write (server-side RPCs)
--
-- The poller runs as a stateless Edge Function, so a row held by
-- `FOR UPDATE SKIP LOCKED` cannot persist across the async get_livescore
-- fetch (the row lock releases when the claim transaction ends). We realise
-- the SAME intent — collapse overlapping ticks to one upstream call — with an
-- atomic TTL lease: only one tick within the lease window wins the claim.
--
-- STAGED ONLY. Not applied to the live project (confirm-before-live gate).
-- Idempotent: functions use `create or replace`.

-- ---------------------------------------------------------------------------
-- begin_poll — atomic lease claim. Returns true iff THIS caller won the tick.
--   Grants the lease only when it is free or expired (older than _ttl_seconds).
--   The single UPDATE is atomic, so concurrent ticks cannot both acquire.
-- ---------------------------------------------------------------------------
create or replace function public.begin_poll(_instance text, _ttl_seconds int default 25)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.poller_lock
     set locked_by = _instance,
         locked_at = now()
   where id = 1
     and (locked_at is null or locked_at < now() - make_interval(secs => _ttl_seconds))
  returning true;
$$;

-- ---------------------------------------------------------------------------
-- write_snapshot — upsert the singleton live board. Service role only.
-- ---------------------------------------------------------------------------
create or replace function public.write_snapshot(
  _board jsonb,
  _match_count int,
  _source_ts timestamptz default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.live_snapshot
     set board       = _board,
         match_count = _match_count,
         source_ts   = _source_ts,
         updated_at  = now()
   where id = 1;
$$;

-- ---------------------------------------------------------------------------
-- Lock down execution: these are service-role only. The public read path
-- never calls them (browsers only SELECT live_snapshot via PostgREST).
-- ---------------------------------------------------------------------------
revoke execute on function public.begin_poll(text, int)               from public, anon, authenticated;
revoke execute on function public.write_snapshot(jsonb, int, timestamptz) from public, anon, authenticated;
grant  execute on function public.begin_poll(text, int)               to service_role;
grant  execute on function public.write_snapshot(jsonb, int, timestamptz) to service_role;
