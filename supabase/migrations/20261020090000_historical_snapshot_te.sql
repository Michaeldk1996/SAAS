-- Tennis Explorer's Pinnacle price as a fourth SNAPSHOT source (founder 2026-10-19: steps 0-3 approved — "new append-only
-- source 'Tennis Explorer · Pinnacle', always 'Pinnacle (approx.)', never a close"). ADDITIVE on historical_snapshot
-- (20261016150000 + 20261017090000 + 20261019090000): one more allowed source, the same label and the same protections
-- (SELECT + INSERT only for service_role, the no-change / no-truncate triggers, RLS) — nothing else moves.
-- Rules: .claude/rules/historical-odds-archive.md "Pinnacle (approx.)" → "Tennis Explorer · Pinnacle".
--
--   source 'Tennis Explorer · Pinnacle'  Pinnacle's last listed pre-match price on the Tennis Explorer match page, read by
--                                        tools/te-odds-batch.mjs (stennisfy-ops) and imported from the private store
--                                        (stennisfy-te-store/te-odds/) by tools/tdarch.py te-import. Label 'Pinnacle
--                                        (approx.)': TE shows when the price last CHANGED, never that it still stood at a
--                                        verified start, so it is a snapshot, never a close.
--
-- A TE row stores the later side's last change (price_ts, null when TE shows no change: the price never moved since TE
-- first listed it) and never claims a cut, a start, an Oddspapi fixture or a Pinnacle archive row. It must name its TE
-- match and the sha256 of the page it was read from (detail->>'teMatchId', detail->>'pageSha256'). Idempotent.

alter table public.historical_snapshot drop constraint if exists historical_snapshot_source_check;
alter table public.historical_snapshot add constraint historical_snapshot_source_check
  check (source in ('api-tennis Pinnacle', 'oddspapi Pinnacle (start − 10)', 'api-tennis Bet365', 'Tennis Explorer · Pinnacle'));

-- unchanged rule, restated so this file stands alone: Bet365's own label, every other source 'Pinnacle (approx.)'
alter table public.historical_snapshot drop constraint if exists historical_snapshot_label_check;
alter table public.historical_snapshot add constraint historical_snapshot_label_check check (
  (source = 'api-tennis Bet365' and label = 'Bet365 (approx.)')
  or (source <> 'api-tennis Bet365' and label = 'Pinnacle (approx.)'));

alter table public.historical_snapshot drop constraint if exists historical_snapshot_times_check;
alter table public.historical_snapshot add constraint historical_snapshot_times_check check (
  (source in ('api-tennis Pinnacle', 'api-tennis Bet365') and cut_ts is null and price_ts is null and start_ts is null)
  or (source = 'oddspapi Pinnacle (start − 10)' and cut_ts is not null and price_ts is not null and start_ts is not null
      and price_ts <= cut_ts and cut_ts < start_ts and gap_to_start_s is not null and fixture_id is not null and raw_id is not null)
  or (source = 'Tennis Explorer · Pinnacle' and cut_ts is null and start_ts is null and start_source is null
      and gap_to_start_s is null and fixture_id is null and raw_id is null
      and (price_ts is null or price_ts <= fetched_at)
      and coalesce(detail->>'teMatchId', '') ~ '^[0-9]+$'
      and coalesce(detail->>'pageSha256', '') ~ '^[0-9a-f]{64}$'));
