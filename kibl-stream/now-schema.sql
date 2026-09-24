-- TEN-270 — the Kibl stream -> live "Now" tables. Idempotent; safe to re-run.
--
-- Founder brief 2026-09-24T01:21Z, item 4: "The browser gets a SELECT-only
-- policy on the price table only, via the publishable key. No secret keys in
-- the page." So:
--   kibl_now_price    anon: SELECT (one policy, no insert/update/delete policy).
--                     Heartbeat + per-side Now. Leaves the Realtime publication
--                     via `unpublish-price` once old-client tabs have reloaded.
--   kibl_now_card     anon: SELECT; the ONLY table in supabase_realtime.
--   kibl_now_history  RLS on, NO anon grant, NO policy — invisible to the browser.
-- The worker writes both with the service key, server-side only.
--
-- Nothing here touches a table the poller owns.

create table if not exists public.kibl_now_price (
    card_key          text        not null,  -- ocsKeyOf(card): card date | surname keys
    side_key          text        not null,  -- the side's surname key (ocsNameKey)
    kind              text        not null default 'price',   -- 'price' | 'heartbeat'
    price             numeric(9,3),
    book              text,                   -- Kibl tag, e.g. 'bet105' (odds_card_state's book string)
    book_name         text,                   -- Kibl's display name, e.g. 'Bet105'
    feed_source_id    integer,
    fixture_id        bigint,
    kibl_inserted_on  timestamptz,           -- KIBL's clock: when Kibl saved the price
    source            text,                   -- 'stream' | 'seed' | 'worker'
    note              jsonb,                  -- heartbeat body only
    written_at        timestamptz not null default now(),  -- OUR clock, set by trigger
    primary key (card_key, side_key),
    constraint kibl_now_price_kind check (kind in ('price', 'heartbeat')),
    constraint kibl_now_price_real check (kind <> 'price' or price >= 1.01)
);

create table if not exists public.kibl_now_history (
    id                bigserial   primary key,
    row_key           text        not null unique,   -- the sweep's row_key_of(): dedupes seed vs stream
    card_key          text        not null,
    side_key          text        not null,
    price             numeric(9,3) not null check (price >= 1.01),
    book              text,
    book_name         text,
    feed_source_id    integer,
    fixture_id        bigint,
    kibl_inserted_on  timestamptz not null,
    received_at       timestamptz,
    source            text,
    written_at        timestamptz not null default now()
);
-- 08:58Z brief, item 3: ONE row per card, both sides — the only table in the
-- Realtime publication, so one price change is one message per subscribed
-- viewer (two side rows made it two). Sides are keyed by the card's surname
-- keys (a_side < b_side), each with its OWN Kibl time.
create table if not exists public.kibl_now_card (
    card_key          text        primary key,
    book              text,
    book_name         text,
    feed_source_id    integer,
    fixture_id        bigint,
    a_side            text        not null,
    a_price           numeric(9,3) not null check (a_price >= 1.01),
    a_at              timestamptz not null,
    b_side            text        not null,
    b_price           numeric(9,3) not null check (b_price >= 1.01),
    b_at              timestamptz not null,
    source            text,
    written_at        timestamptz not null default now()
);

create index if not exists kibl_now_history_card_idx
    on public.kibl_now_history (card_key, side_key, kibl_inserted_on);

-- written_at is the DATABASE's clock on every insert AND update. A PostgREST
-- upsert does not re-apply a column default on the update path, so without
-- this the worker->screen delay would be measured from the FIRST write of a
-- side, not the latest.
create or replace function public.kibl_now_touch() returns trigger
language plpgsql as $$
begin
  new.written_at := now();
  return new;
end $$;
drop trigger if exists kibl_now_price_touch on public.kibl_now_price;
create trigger kibl_now_price_touch before insert or update on public.kibl_now_price
    for each row execute function public.kibl_now_touch();
drop trigger if exists kibl_now_card_touch on public.kibl_now_card;
create trigger kibl_now_card_touch before insert or update on public.kibl_now_card
    for each row execute function public.kibl_now_touch();

-- Newer-only, per side, IN THE DATABASE: an overlapping worker during a deploy,
-- a seed older than what is stored, or a retry of a write that did land can
-- never move a side back — and a write that moves nothing is skipped, so it
-- costs no Realtime message (review 3rd pass, finding 7).
create or replace function public.kibl_now_card_newer() returns trigger
language plpgsql as $$
begin
  if new.a_side = old.a_side and new.b_side = old.b_side then
    if new.a_at <= old.a_at and new.b_at <= old.b_at then
      return null;                                   -- nothing newer: no update, no message
    end if;
    if new.a_at < old.a_at then new.a_price := old.a_price; new.a_at := old.a_at; end if;
    if new.b_at < old.b_at then new.b_price := old.b_price; new.b_at := old.b_at; end if;
  end if;
  return new;
end $$;
drop trigger if exists kibl_now_card_newer on public.kibl_now_card;
create trigger kibl_now_card_newer before update on public.kibl_now_card
    for each row execute function public.kibl_now_card_newer();

alter table public.kibl_now_price   enable row level security;
alter table public.kibl_now_history enable row level security;
alter table public.kibl_now_card    enable row level security;

revoke all on public.kibl_now_price   from anon, authenticated;
revoke all on public.kibl_now_history from anon, authenticated;
revoke all on public.kibl_now_card    from anon, authenticated;
grant select on public.kibl_now_price to anon, authenticated;
grant select on public.kibl_now_card  to anon, authenticated;

drop policy if exists "public read kibl_now_price" on public.kibl_now_price;
create policy "public read kibl_now_price"
    on public.kibl_now_price for select to anon, authenticated using (true);

drop policy if exists "public read kibl_now_card" on public.kibl_now_card;
create policy "public read kibl_now_card"
    on public.kibl_now_card for select to anon, authenticated using (true);

-- Realtime: the CARD table in. The new page subscribes to it alone, so the
-- per-side table costs messages only for tabs still running the old client.
-- It leaves the publication LATER, with the `unpublish-price` action, once
-- those tabs have reloaded — dropping it now would leave them showing
-- "● live" on a 60 s backstop (review 3rd pass, finding 1).
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public'
                   and tablename = 'kibl_now_card') then
    alter publication supabase_realtime add table public.kibl_now_card;
  end if;
end $$;
