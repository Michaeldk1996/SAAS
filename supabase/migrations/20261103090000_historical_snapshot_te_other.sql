-- Tennis Explorer · another book, margin removed, as a seventh SNAPSHOT source (founder 2026-11-03: "use those books but can
-- you devig them?"; "fixed order, out of ROI"). ADDITIVE on historical_snapshot (… + 20261101090000): one more allowed
-- source, its own label and its times rule; the same protections (SELECT + INSERT only for service_role, the no-change /
-- no-truncate triggers, RLS) — nothing else moves.
-- Rules: .claude/rules/odds.md "Another bookmaker, margin removed".
--
--   source 'Tennis Explorer · other book'  where the Tennis Explorer page lists neither Pinnacle nor bet365: ONE other book
--                                          (the first of a fixed order with both prices; stennisfy-ops te-other-extract.mjs),
--                                          its last listed pre-match pair with the margin removed. Label
--                                          'Other book (approx., margin removed)'. The book, its raw pair and the margin are in
--                                          detail. Never a close, never a Pinnacle or Bet365 label.
-- Idempotent.

alter table public.historical_snapshot drop constraint if exists historical_snapshot_source_check;
alter table public.historical_snapshot add constraint historical_snapshot_source_check
  check (source in ('api-tennis Pinnacle', 'oddspapi Pinnacle (start − 10)', 'api-tennis Bet365', 'Tennis Explorer · Pinnacle',
                    'Tennis Explorer · Bet365', 'oddspapi Pinnacle (before start)', 'Tennis Explorer · other book'));

alter table public.historical_snapshot drop constraint if exists historical_snapshot_label_check;
alter table public.historical_snapshot add constraint historical_snapshot_label_check check (
  (source in ('api-tennis Bet365', 'Tennis Explorer · Bet365') and label = 'Bet365 (approx.)')
  or (source = 'Tennis Explorer · other book' and label = 'Other book (approx., margin removed)')
  or (source not in ('api-tennis Bet365', 'Tennis Explorer · Bet365', 'Tennis Explorer · other book') and label = 'Pinnacle (approx.)'));

alter table public.historical_snapshot drop constraint if exists historical_snapshot_times_check;
alter table public.historical_snapshot add constraint historical_snapshot_times_check check (
  (source in ('api-tennis Pinnacle', 'api-tennis Bet365') and cut_ts is null and price_ts is null and start_ts is null)
  or (source = 'oddspapi Pinnacle (start − 10)' and cut_ts is not null and price_ts is not null and start_ts is not null
      and price_ts <= cut_ts and cut_ts < start_ts and gap_to_start_s is not null and fixture_id is not null and raw_id is not null)
  or (source = 'oddspapi Pinnacle (before start)' and cut_ts is not null and price_ts is not null and start_ts is not null
      and price_ts <= cut_ts and cut_ts = start_ts and start_source in ('scheduled start', 'oddspapi trueStart', 'first live sighting')
      and gap_to_start_s is not null and fixture_id is not null and raw_id is not null)
  or (source in ('Tennis Explorer · Pinnacle', 'Tennis Explorer · Bet365') and cut_ts is null and start_ts is null and start_source is null
      and gap_to_start_s is null and fixture_id is null and raw_id is null
      and (price_ts is null or price_ts <= fetched_at)
      and coalesce(detail->>'teMatchId', '') ~ '^[0-9]+$'
      and coalesce(detail->>'pageSha256', '') ~ '^[0-9a-f]{64}$')
  or (source = 'Tennis Explorer · other book' and cut_ts is null and start_ts is null and start_source is null
      and gap_to_start_s is null and fixture_id is null and raw_id is null
      and (price_ts is null or price_ts <= fetched_at)
      and coalesce(detail->>'teMatchId', '') ~ '^[0-9]+$'
      and coalesce(detail->>'pageSha256', '') ~ '^[0-9a-f]{64}$'
      and coalesce(detail->>'book', '') <> ''));
