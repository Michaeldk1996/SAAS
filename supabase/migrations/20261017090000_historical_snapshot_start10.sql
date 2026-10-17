-- Pinnacle (approx.) from the Oddspapi Pinnacle archive at Oddspapi's start − 10 min (founder ruling 2026-10-17, item 2).
-- ADDITIVE on historical_snapshot (20261016150000): a second SNAPSHOT source, never a close, under the same label and the
-- same protections (SELECT + INSERT only for service_role, the no-change / no-truncate triggers, RLS) — nothing else moves.
-- Rules: .claude/rules/historical-odds-archive.md "Pinnacle (approx.)".
--
--   source 'oddspapi Pinnacle (start − 10)'  the last ACTIVE pinnacle+30 match-winner entry per side at or before
--                                            Oddspapi's trueStart − 10 min (the trueStart through the ruled sanity gate),
--                                            read from a payload the Pinnacle archive holds (its raw payload table).
--   source 'api-tennis Pinnacle'             unchanged (api-tennis's stored Pncl price, no timestamp).
--
-- Each start − 10 row stores its cut (cut_ts), the later side's entry time (price_ts), the start it was cut against
-- (start_ts, start_source) and the gap to the start (gap_to_start_s); api-tennis rows leave them empty (it has no times).
-- The label stays 'Pinnacle (approx.)' for both sources, so a snapshot can never carry a close's label. Idempotent.

alter table public.historical_snapshot drop constraint if exists historical_snapshot_source_check;
alter table public.historical_snapshot add constraint historical_snapshot_source_check
  check (source in ('api-tennis Pinnacle', 'oddspapi Pinnacle (start − 10)'));

alter table public.historical_snapshot add column if not exists cut_ts         timestamptz;   -- start − 10 min
alter table public.historical_snapshot add column if not exists price_ts       timestamptz;   -- the later side's entry
alter table public.historical_snapshot add column if not exists start_ts       timestamptz;   -- Oddspapi trueStart
alter table public.historical_snapshot add column if not exists start_source   text;
alter table public.historical_snapshot add column if not exists gap_to_start_s numeric;       -- start_ts − price_ts
alter table public.historical_snapshot add column if not exists fixture_id     text;          -- the Oddspapi fixture
alter table public.historical_snapshot add column if not exists raw_id         bigint;        -- the Pinnacle archive raw row id

-- a start − 10 row always carries its times; an api-tennis row never claims any
alter table public.historical_snapshot drop constraint if exists historical_snapshot_times_check;
alter table public.historical_snapshot add constraint historical_snapshot_times_check check (
  (source = 'api-tennis Pinnacle' and cut_ts is null and price_ts is null and start_ts is null)
  or (source = 'oddspapi Pinnacle (start − 10)' and cut_ts is not null and price_ts is not null and start_ts is not null
      and price_ts <= cut_ts and cut_ts < start_ts and gap_to_start_s is not null and fixture_id is not null and raw_id is not null));
