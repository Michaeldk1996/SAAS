-- api-tennis's stored Bet365 price as a third SNAPSHOT source (founder brief 2026-10-19, item 3: the lower levels and the
-- events Tennis-Data does not cover, priced in the measured order close > start − 10 > api-tennis Pinnacle > Bet365).
-- ADDITIVE on historical_snapshot (20261016150000 + 20261017090000): one more allowed source, its own label, the same
-- protections (SELECT + INSERT only for service_role, the no-change / no-truncate triggers, RLS) — nothing else moves.
-- Rules: .claude/rules/historical-odds-archive.md "Pinnacle (approx.)" → "api-tennis Bet365".
--
--   source 'api-tennis Bet365'   api-tennis's stored bet365 match-winner pair (no timestamp): label 'Bet365 (approx.)',
--                                never a close, never a Pinnacle label. Stored only where api-tennis has no Pinnacle pair.
--
-- A source carries exactly its own label: the two Pinnacle sources 'Pinnacle (approx.)', the Bet365 one 'Bet365 (approx.)'.
-- Like the api-tennis Pinnacle rows it claims no times. Idempotent.

alter table public.historical_snapshot drop constraint if exists historical_snapshot_source_check;
alter table public.historical_snapshot add constraint historical_snapshot_source_check
  check (source in ('api-tennis Pinnacle', 'oddspapi Pinnacle (start − 10)', 'api-tennis Bet365'));

alter table public.historical_snapshot drop constraint if exists historical_snapshot_label_check;
alter table public.historical_snapshot add constraint historical_snapshot_label_check check (
  (source = 'api-tennis Bet365' and label = 'Bet365 (approx.)')
  or (source <> 'api-tennis Bet365' and label = 'Pinnacle (approx.)'));

alter table public.historical_snapshot drop constraint if exists historical_snapshot_times_check;
alter table public.historical_snapshot add constraint historical_snapshot_times_check check (
  (source in ('api-tennis Pinnacle', 'api-tennis Bet365') and cut_ts is null and price_ts is null and start_ts is null)
  or (source = 'oddspapi Pinnacle (start − 10)' and cut_ts is not null and price_ts is not null and start_ts is not null
      and price_ts <= cut_ts and cut_ts < start_ts and gap_to_start_s is not null and fixture_id is not null and raw_id is not null));
