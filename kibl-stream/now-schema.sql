-- TEN-270 — the Kibl stream -> live "Now" tables. Idempotent; safe to re-run.
--
-- Founder brief 2026-09-24T01:21Z, item 4: "The browser gets a SELECT-only
-- policy on the price table only, via the publishable key. No secret keys in
-- the page." So:
--   kibl_now_price    anon: SELECT (one policy, no insert/update/delete policy)
--                     and in the supabase_realtime publication.
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

alter table public.kibl_now_price   enable row level security;
alter table public.kibl_now_history enable row level security;

revoke all on public.kibl_now_price   from anon, authenticated;
revoke all on public.kibl_now_history from anon, authenticated;
grant select on public.kibl_now_price to anon, authenticated;

drop policy if exists "public read kibl_now_price" on public.kibl_now_price;
create policy "public read kibl_now_price"
    on public.kibl_now_price for select to anon, authenticated using (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public'
                   and tablename = 'kibl_now_price') then
    alter publication supabase_realtime add table public.kibl_now_price;
  end if;
end $$;
