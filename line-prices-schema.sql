-- bet105 line prices (founder brief 2026-10-24, bet105-line-prices Part 2). ADDITIVE: two new tables + one function;
-- touches no existing object. Written by the live Kibl stream worker (kibl-stream/line_engine.py on Fly, founder
-- ruling 2026-10-25: the same path as the Now prices). The page reads line_prices_current with its publishable key
-- (line-prices.js); line_price_ticks is never readable from the browser. Applied by ten270-stream-now.yml,
-- action lines-schema.
--
--   line_prices_current  the latest normalised Kibl (bet105) price per (event_key, market, side, line, book), with the
--                        guard verdict. Upserted every run.
--   line_price_ticks     APPEND-ONLY history: a row only when a key's price (or status) changes. Nothing nightly
--                        regenerates or overwrites it.
--
-- Protection, the Pinnacle archive's pattern (supabase/migrations/20261014120000_pinnacle_archive.sql):
--   * RLS on; line_price_ticks has no policy (anon / authenticated read and write nothing there); line_prices_current
--     has ONE policy, SELECT for anon / authenticated, and no write grant;
--   * line_price_ticks: service_role gets SELECT + INSERT only; BEFORE UPDATE OR DELETE / BEFORE TRUNCATE triggers raise
--     for every role, the owner included;
--   * line_prices_current: service_role gets SELECT + INSERT + UPDATE (it is a "current" table); DELETE and TRUNCATE
--     are revoked.
-- Idempotent: safe to re-run on every workflow run.
create table if not exists public.line_prices_current (
  event_key    bigint      not null,          -- api-tennis event key (the site's match id)
  market       text        not null,          -- ml | ml1 | gh | sh | tg | ts
  side         text        not null,          -- api-tennis player key, or 'over' / 'under'
  line         numeric,                       -- that side's own signed line; NULL for ml / ml1
  book         text        not null,          -- 'bet105'
  price        numeric,                       -- NULL when suspended (never 0)
  implied      numeric,                       -- de-vigged, both sides of the same line, same book; NULL when not derivable
  status       text        not null,          -- 'ok' or the dash reason
  open_price   numeric,
  open_ts      timestamptz,                   -- Kibl insert time of the opener (never book-post time)
  max_limit    numeric,
  inserted_on  timestamptz,                   -- Kibl insert time of the current price
  seen_at      timestamptz not null,          -- the run that last read it
  start_ts     timestamptz,                   -- api-tennis scheduled start (UTC)
  kibl_fixture bigint,
  alt_id       integer,
  constraint line_prices_current_key unique nulls not distinct (event_key, market, side, line, book)
);
create table if not exists public.line_price_ticks (
  id           bigint generated always as identity primary key,
  event_key    bigint      not null,
  market       text        not null,
  side         text        not null,
  line         numeric,
  book         text        not null,
  price        numeric,
  status       text        not null,
  is_opener    boolean     not null default false,
  max_limit    numeric,
  inserted_on  timestamptz,
  seen_at      timestamptz not null,
  constraint line_price_ticks_once unique nulls not distinct (event_key, market, side, line, book, inserted_on, price, status)
);
create index if not exists line_price_ticks_event on public.line_price_ticks (event_key);

create or replace function public.line_price_ticks_forbid() returns trigger language plpgsql as $$
begin
  raise exception 'line_price_ticks is append-only: % on %.% is not allowed', tg_op, tg_table_schema, tg_table_name
    using errcode = '42501';
end $$;

alter table public.line_prices_current enable row level security;
alter table public.line_price_ticks enable row level security;
revoke all on public.line_prices_current from public, anon, authenticated, service_role;
revoke all on public.line_price_ticks from public, anon, authenticated, service_role;
grant select, insert, update on public.line_prices_current to service_role;
grant select, insert on public.line_price_ticks to service_role;
grant usage on sequence public.line_price_ticks_id_seq to service_role;
-- The page's read (founder 2026-10-25): SELECT on the CURRENT table only, the existing Kibl Now pattern. No insert,
-- update or delete for anon / authenticated; the ticks table keeps no policy and no grant, so it stays unreadable.
grant select on public.line_prices_current to anon, authenticated;
drop policy if exists line_prices_current_read on public.line_prices_current;
create policy line_prices_current_read on public.line_prices_current for select to anon, authenticated using (true);
drop trigger if exists line_price_ticks_no_change on public.line_price_ticks;
create trigger line_price_ticks_no_change before update or delete on public.line_price_ticks
  for each row execute function public.line_price_ticks_forbid();
drop trigger if exists line_price_ticks_no_truncate on public.line_price_ticks;
create trigger line_price_ticks_no_truncate before truncate on public.line_price_ticks
  for each statement execute function public.line_price_ticks_forbid();
