-- TEN-225 item 2a — wire record_live_flips() into the live poller's write path.
--
-- SPLIT FROM 20260917100000_live_flip_log.sql ON PURPOSE. That migration is
-- purely additive (two new tables + one new function) and cannot affect
-- anything that exists. THIS one replaces write_snapshot(), which every Live-tab
-- viewer depends on, so it is applied only AFTER test-live-flip-log.sql has
-- passed against the function it calls. Two files, two steps, one gate between
-- them -- see .github/workflows/ten225-live-flip.yml.
--
-- Idempotent: create or replace.

-- ---------------------------------------------------------------------------
-- 5. write_snapshot — same signature, same observable effect on live_snapshot.
--
--    The ONLY change to the live write path is the guarded call added below.
--    The previous board is read under FOR UPDATE in the same transaction that
--    replaces it, so two concurrent ticks cannot both see the same previous
--    board and both claim the same flip. (The poller's TTL lease already makes
--    that near-impossible; the row lock makes it impossible.)
--
--    The call is wrapped in its own exception block: if the recorder raises for
--    any reason, the snapshot update below still runs and the member board is
--    untouched. A recorder failure surfaces as live_flip_stats.last_error, not
--    as a broken Live tab.
-- ---------------------------------------------------------------------------
create or replace function public.write_snapshot(
  _board jsonb,
  _match_count int,
  _source_ts timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _prev_board jsonb;
  _prev_ts    timestamptz;
  _now        timestamptz := now();
begin
  -- Lock and read the board we are about to replace.
  select board, updated_at
    into _prev_board, _prev_ts
    from public.live_snapshot
   where id = 1
     for update;

  begin
    perform public.record_live_flips(_board, _prev_board, _prev_ts, _now);
  exception when others then
    -- Record and carry on. The board is what members see; it wins.
    begin
      update public.live_flip_stats
         set last_tick_at = _now,
             last_error   = left(sqlstate || ' ' || sqlerrm, 500)
       where id = 1;
    exception when others then
      null;   -- even the error bookkeeping must not break the board
    end;
  end;

  update public.live_snapshot
     set board       = _board,
         match_count = _match_count,
         source_ts   = _source_ts,
         updated_at  = _now
   where id = 1;
end;
$$;

-- Unchanged posture: service-role only, exactly as the original grants had it.
revoke execute on function public.write_snapshot(jsonb, int, timestamptz)
  from public, anon, authenticated;
grant execute on function public.write_snapshot(jsonb, int, timestamptz)
  to service_role;
