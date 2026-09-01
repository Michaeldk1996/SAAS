-- TEN-107 · Detail panel — point-by-point sync RPC (service-role only)
--
-- The poller calls write_live_pbp() once per tick with the current board's point
-- logs, keyed by event_key: { "<event_key>": [ ...games... ], ... }. The function
-- upserts every present match and deletes rows for matches no longer on the board
-- (finished / dropped), so the store tracks exactly the live set. All writes are
-- server-side and atomic, matching the write_snapshot() posture in Slice 2.
--
-- STAGED ONLY. Idempotent (create or replace). Applied at the confirm-before-live
-- gate with the live_pbp table migration and the poller redeploy.

create or replace function public.write_live_pbp(_pbp jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- _pbp is a JSON object: { event_key -> games-array }. Absent / null → treat as
  -- "no live matches": clear the whole store rather than leaving stale rows.
  if _pbp is null or jsonb_typeof(_pbp) <> 'object' then
    delete from public.live_pbp;
    return;
  end if;

  -- Upsert every match present in this tick.
  insert into public.live_pbp (event_key, pbp, updated_at)
  select key, value, now()
  from jsonb_each(_pbp)
  on conflict (event_key) do update
    set pbp        = excluded.pbp,
        updated_at = excluded.updated_at;

  -- Drop matches that fell off the board this tick (finished / no longer live).
  delete from public.live_pbp
  where event_key not in (select jsonb_object_keys(_pbp));
end;
$$;

revoke execute on function public.write_live_pbp(jsonb) from public, anon, authenticated;
grant  execute on function public.write_live_pbp(jsonb) to service_role;
