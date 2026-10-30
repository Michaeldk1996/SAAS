-- Tennis Explorer's Bet365 price as a fifth SNAPSHOT source (founder 2026-10-30, "TE above Bet365" follow-up: "Yes, last
-- before dash" — for Market edge and Derived lines, not the Database page's closing-price figures). ADDITIVE on
-- historical_snapshot (… + 20261020090000): one more allowed source, the Bet365 label and the same protections (SELECT +
-- INSERT only for service_role, the no-change / no-truncate triggers, RLS) — nothing else moves.
-- Rules: .claude/rules/historical-odds-archive.md "Pinnacle (approx.)" → "Tennis Explorer · Bet365".
--
--   source 'Tennis Explorer · Bet365'  Bet365's last listed pre-match price on the Tennis Explorer match page, read from the
--                                      pages tools/te-odds-batch.mjs already saved (stennisfy-ops tools/te-b365-extract.mjs,
--                                      no request) and imported by tools/tdarch.py te-import. Label 'Bet365 (approx.)'.
--
-- Like the Pinnacle row: price_ts = the later side's last change where the page shows a history, null where the cell never
-- moved (about two rows in three; kept — the founder accepted it for the join-only surfaces). It must name its TE match and
-- the sha256 of the page (detail->>'teMatchId', detail->>'pageSha256'). Idempotent.

alter table public.historical_snapshot drop constraint if exists historical_snapshot_source_check;
alter table public.historical_snapshot add constraint historical_snapshot_source_check
  check (source in ('api-tennis Pinnacle', 'oddspapi Pinnacle (start − 10)', 'api-tennis Bet365', 'Tennis Explorer · Pinnacle',
                    'Tennis Explorer · Bet365'));

-- the two Bet365 sources carry Bet365's own label, every other source 'Pinnacle (approx.)'
alter table public.historical_snapshot drop constraint if exists historical_snapshot_label_check;
alter table public.historical_snapshot add constraint historical_snapshot_label_check check (
  (source in ('api-tennis Bet365', 'Tennis Explorer · Bet365') and label = 'Bet365 (approx.)')
  or (source not in ('api-tennis Bet365', 'Tennis Explorer · Bet365') and label = 'Pinnacle (approx.)'));

alter table public.historical_snapshot drop constraint if exists historical_snapshot_times_check;
alter table public.historical_snapshot add constraint historical_snapshot_times_check check (
  (source in ('api-tennis Pinnacle', 'api-tennis Bet365') and cut_ts is null and price_ts is null and start_ts is null)
  or (source = 'oddspapi Pinnacle (start − 10)' and cut_ts is not null and price_ts is not null and start_ts is not null
      and price_ts <= cut_ts and cut_ts < start_ts and gap_to_start_s is not null and fixture_id is not null and raw_id is not null)
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
