-- Pinnacle (approx.) before the start as a sixth SNAPSHOT source (founder 2026-11-01, Task B: "the 300 s rule stays for
-- 'real close'. Where no start is verified, use the last pre-match Pinnacle price before the scheduled start, labelled
-- approximate. No match is a dash because the recorder missed it."). ADDITIVE on historical_snapshot (… + 20261030090000):
-- one more allowed source and its times rule; the same protections (SELECT + INSERT only for service_role, the no-change /
-- no-truncate triggers, RLS) — nothing else moves.
-- Rules: .claude/rules/odds.md "Pinnacle (approx.) before the start".
--
--   source 'oddspapi Pinnacle (before start)'  the last ACTIVE pinnacle+30 match-winner entry per side at or before the
--                                              EARLIEST of api-tennis's scheduled start, Oddspapi's gated trueStart and our
--                                              first live sighting (tools/tdarch.py sched-import). Label 'Pinnacle (approx.)'.
--
-- The row names its cut (cut_ts = start_ts: the time it was checked against), which time set it (start_source), the price
-- time (the later side, never after the cut), the gap, the Oddspapi fixture and the raw payload it was read from. Idempotent.

alter table public.historical_snapshot drop constraint if exists historical_snapshot_source_check;
alter table public.historical_snapshot add constraint historical_snapshot_source_check
  check (source in ('api-tennis Pinnacle', 'oddspapi Pinnacle (start − 10)', 'api-tennis Bet365', 'Tennis Explorer · Pinnacle',
                    'Tennis Explorer · Bet365', 'oddspapi Pinnacle (before start)'));

alter table public.historical_snapshot drop constraint if exists historical_snapshot_label_check;
alter table public.historical_snapshot add constraint historical_snapshot_label_check check (
  (source in ('api-tennis Bet365', 'Tennis Explorer · Bet365') and label = 'Bet365 (approx.)')
  or (source not in ('api-tennis Bet365', 'Tennis Explorer · Bet365') and label = 'Pinnacle (approx.)'));

alter table public.historical_snapshot drop constraint if exists historical_snapshot_times_check;
alter table public.historical_snapshot add constraint historical_snapshot_times_check check (
  (source in ('api-tennis Pinnacle', 'api-tennis Bet365') and cut_ts is null and price_ts is null and start_ts is null)
  or (source = 'oddspapi Pinnacle (start − 10)' and cut_ts is not null and price_ts is not null and start_ts is not null
      and price_ts <= cut_ts and cut_ts < start_ts and gap_to_start_s is not null and fixture_id is not null and raw_id is not null)
  or (source = 'oddspapi Pinnacle (before start)' and cut_ts is not null and price_ts is not null and start_ts is not null
      and price_ts <= cut_ts and cut_ts = start_ts and start_source in ('scheduled start', 'oddspapi trueStart', 'first live sighting')
      and gap_to_start_s is not null and fixture_id is not null and raw_id is not null)
  or (source = 'Tennis Explorer · Pinnacle' and cut_ts is null and start_ts is null and start_source is null
      and gap_to_start_s is null and fixture_id is null and raw_id is null
      and (price_ts is null or price_ts <= fetched_at)
      and coalesce(detail->>'teMatchId', '') ~ '^[0-9]+$'
      and coalesce(detail->>'pageSha256', '') ~ '^[0-9a-f]{64}$')
  or (source = 'Tennis Explorer · Bet365' and cut_ts is null and start_ts is null and start_source is null
      and gap_to_start_s is null and fixture_id is null and raw_id is null
      and (price_ts is null or price_ts <= fetched_at)
      and coalesce(detail->>'teMatchId', '') ~ '^[0-9]+$'
      and coalesce(detail->>'pageSha256', '') ~ '^[0-9a-f]{64}$'));
