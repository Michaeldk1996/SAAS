-- played-start-recorder — switch the live recorder to the played rule (founder ruling 2026-10-26).
--
-- Applied ONLY after test-live-flip-log.sql has passed against record_live_flips_played()
-- (20261027090000_live_flip_played.sql); see ten225-live-flip.yml mode=install.
--
-- write_snapshot() calls record_live_flips(_board, _prev_board, _prev_ts, _now) inside its own exception block
-- (20260917100100_write_snapshot_flip.sql), so the signature stays and write_snapshot is not touched: this body now
-- hands every tick to the played recorder with T = 300 s. A fault still lands in live_flip_stats.last_error, never on
-- the board.
--
-- ORDER MATTERS ON A RE-RUN: 20260917100000_live_flip_log.sql re-creates the old body of this function, so this file
-- must be applied after it wherever both are applied (supabase-live-golive.yml; tools/test-golive-recorder-wiring.js).
-- Idempotent: create or replace.

create or replace function public.record_live_flips(
  _board      jsonb,
  _prev_board jsonb,
  _prev_ts    timestamptz,
  _now        timestamptz,
  _poller     text default 'live-poller-10s'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.record_live_flips_played(_board, _prev_board, _prev_ts, _now, _poller, 300);
end;
$$;

revoke execute on function public.record_live_flips(jsonb, jsonb, timestamptz, timestamptz, text)
  from public, anon, authenticated;
