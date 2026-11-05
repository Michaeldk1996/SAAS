-- capture-tables.sql — architecture program stage 4 (2026-11-05): the odds captures live in tables, not in git.
--
-- Until now the Pinnacle +30s series a capture tick writes (refresh-odds-history.py → matches.json
-- oddsMovement.chart.books["Pinnacle +30s"]) existed only in matches.json's git history: build-captured-pinnacle.js
-- re-reads ~100 commits of a 4 MB file every pipeline run to rebuild the captured closes, and three jobs race to push
-- that file. These tables hold the same facts, written by tools/capture-to-table.py after every capture tick.
--
-- Phase A (this file): written IN PARALLEL with matches.json; read only by the report-only diff
-- (tools/captured-diff.mjs). Nothing on the site and nothing in the Pinnacle archive reads them yet.
--
--   capture_tick  one row per (match, source label, side, book tick time): the price at that tick.
--   capture_read  one row per (match, source label, read time): our capture read the source (chart meta checkedAt).
--   capture_card  one row per distinct identity snapshot of a board card (players, keys, round, flag, event, result).
--
-- Append-only, like the other ledgers: service_role gets SELECT + INSERT; triggers refuse UPDATE, DELETE and TRUNCATE;
-- RLS on with no policy, so anon / authenticated read and write nothing. Idempotent; applied by ten232-schema-gate.py
-- only when this file changes.
create table if not exists public.capture_tick (
  event_key   bigint      not null,
  label       text        not null,                     -- the stored chart label, e.g. 'Pinnacle +30s'
  side        text        not null check (side in ('p1', 'p2')),
  tick_ts     timestamptz not null,                     -- the book's own tick time (Oddspapi), never our clock
  price       numeric     not null check (price > 0),
  recorded_at timestamptz not null default now(),       -- when this row first reached the table
  primary key (event_key, label, side, tick_ts)
);

create table if not exists public.capture_read (
  event_key   bigint      not null,
  label       text        not null,
  checked_at  timestamptz not null,                     -- our read of the source (never later than the card start)
  recorded_at timestamptz not null default now(),
  primary key (event_key, label, checked_at)
);

create table if not exists public.capture_card (
  event_key   bigint      not null,
  fp          text        not null,                     -- sha1 of the identity fields below (a change = a new row)
  p1 text, p2 text, p1_key bigint, p2_key bigint, card_date text, round text, qualifying boolean, event text, winner text,
  recorded_at timestamptz not null default now(),
  primary key (event_key, fp)
);
create index if not exists capture_card_newest on public.capture_card (event_key, recorded_at desc);
create index if not exists capture_tick_recorded on public.capture_tick (recorded_at);

create or replace function public.capture_forbid() returns trigger language plpgsql as $$
begin
  raise exception 'capture tables are append-only (% on %)', tg_op, tg_table_name;
end $$;
revoke all on function public.capture_forbid() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['capture_tick', 'capture_read', 'capture_card'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select, insert on public.%I to service_role', t);
    execute format('drop trigger if exists %I on public.%I', t || '_no_change', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.capture_forbid()', t || '_no_change', t);
    execute format('drop trigger if exists %I on public.%I', t || '_no_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.capture_forbid()', t || '_no_truncate', t);
  end loop;
end $$;
