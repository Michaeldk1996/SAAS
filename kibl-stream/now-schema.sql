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

-- Founder 2026-09-24 (item 6, answered): every period the worker was not
-- consuming. A gap over the queue's 120 s TTL lost price history; the price
-- history box shows it as "no data from–to". Browser access only through the
-- price_history RPC — no anon grant on this table.
create table if not exists public.kibl_now_gaps (
    id            bigserial   primary key,
    gap_from      timestamptz not null,
    gap_to        timestamptz not null,
    seconds       numeric     not null,
    reason        text        not null,          -- 'restart' | 'disconnect'
    lost_history  boolean     not null,          -- seconds > 120 (queue TTL)
    created_at    timestamptz not null default now(),
    constraint kibl_now_gaps_order check (gap_to > gap_from)
);
create index if not exists kibl_now_gaps_to_idx on public.kibl_now_gaps (gap_to);

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
alter table public.kibl_now_gaps    enable row level security;

revoke all on public.kibl_now_price   from anon, authenticated;
revoke all on public.kibl_now_history from anon, authenticated;
revoke all on public.kibl_now_card    from anon, authenticated;
revoke all on public.kibl_now_gaps    from anon, authenticated;
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

-- ── price_history(card_key) — founder 2026-09-24 item 6 (answered: RPC) ─────
-- ONE card's Bet105 match-winner history, for the price-history hover box.
-- security definer: the page's publishable key gets EXECUTE on this function
-- only — never SELECT on the tables it reads. Row caps bound every call.
-- Sources, merged by the page on (side, Kibl inserted_on, price):
--   poller  kibl_line_observations for the card's SELECTED Bet105 Kibl fixture —
--           never one the orientation guard dashed. Side '1'/'2' = lower/higher
--           fixture_participant_id, only where each side_id maps to exactly one
--           participant (ten225-kibl-card-state.py side_labels_for).
--   stream  kibl_now_history rows for the card, book bet105.
--   gaps    the card's own span only: worker gaps over the 120 s queue TTL
--           (stream era), and >10 min gaps between OK poller sweeps BEFORE the
--           stream went live (the founder's gap rule is the worker's TTL once
--           the stream exists; a poller stall then is not lost stream data).
-- Review round 5 findings 1–3, 7–9 folded in.
create index if not exists kibl_sweeps_started_idx on public.kibl_sweeps (started_at);

create or replace function public.price_history(p_card_key text)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  with fx as (
    select distinct ocs.fixture_id::bigint as fixture_id
    from public.odds_card_state ocs
    where ocs.match_key = p_card_key and ocs.id_space = 'kibl' and ocs.book = 'bet105'
      and ocs.market = 'match winner' and ocs.is_selected
      and ocs.label is distinct from 'orientation-disagreement'
      and ocs.fixture_id ~ '^[0-9]+$'
    limit 4
  ),
  mw as (
    select o.fixture_id, o.side_id, o.fixture_participant_id, o.price_decimal, o.inserted_on, o.observed_at
    from public.kibl_line_observations o join fx using (fixture_id)
    where o.feed_source_id = 171 and o.market_type_id = 1 and o.segment_id = 1
      and o.betting_type_id = 1 and o.is_live is not true
      and o.inserted_on is not null and o.fixture_participant_id is not null and o.side_id is not null
  ),
  parts as (
    select fixture_id, min(fixture_participant_id) as p_lo,
           count(distinct fixture_participant_id) as n_p, count(distinct side_id) as n_s,
           count(distinct (side_id, fixture_participant_id)) as n_pairs
    from mw group by fixture_id
  ),
  poller as (
    select m.fixture_id, case when m.fixture_participant_id = p.p_lo then '1' else '2' end as side,
           m.price_decimal as price, m.inserted_on as at, m.observed_at as seen
    from mw m join parts p using (fixture_id)
    where p.n_p = 2 and p.n_s = 2 and p.n_pairs = 2 and m.price_decimal >= 1.01
    order by m.inserted_on desc
    limit 2000
  ),
  stream as (
    select h.side_key as side, h.price, h.kibl_inserted_on as at, h.received_at as seen, h.source
    from public.kibl_now_history h
    where h.card_key = p_card_key and h.book = 'bet105'
    order by h.kibl_inserted_on desc
    limit 2000
  ),
  span as (
    select least((select min(at) from poller), (select min(at) from stream)) as since,
           -- up to 3 days past the last change (capped at now): an outage AFTER
           -- the last recorded move must still show (UI review finding 4)
           least(now(), greatest((select max(at) from poller), (select max(at) from stream))
                        + interval '3 days') as until
  ),
  gaps as (
    select g.gap_from, g.gap_to, g.seconds, g.reason
    from public.kibl_now_gaps g, span
    where g.lost_history and span.since is not null
      and g.gap_to >= span.since and g.gap_from <= span.until
    order by g.gap_from desc
    limit 100
  ),
  sweeps as (
    select s.started_at, lag(s.started_at) over (order by s.started_at) as prev
    from public.kibl_sweeps s, span
    where s.ok and span.since is not null
      and s.started_at >= span.since - interval '15 minutes'
      and s.started_at <= least(span.until + interval '15 minutes', timestamptz '2026-09-24 07:44:35+00')
  ),
  sweep_gaps as (
    select prev as gap_from, started_at as gap_to,
           extract(epoch from started_at - prev) as seconds
    from sweeps
    where prev is not null and started_at - prev > interval '10 minutes'
    order by prev desc
    limit 100
  )
  select jsonb_build_object(
    'card_key',   p_card_key,
    'generated_at', now(),
    'stream_live_since', timestamptz '2026-09-24 07:44:35+00',
    'fixtures',   coalesce((select jsonb_agg(jsonb_build_object('fixture_id', f.fixture_id,
                     'player1', kf.player1_name, 'player2', kf.player2_name))
                   from fx f left join public.kibl_fixtures kf on kf.fixture_id = f.fixture_id), '[]'::jsonb),
    'poller',     coalesce((select jsonb_agg(to_jsonb(p)) from poller p), '[]'::jsonb),
    'stream',     coalesce((select jsonb_agg(to_jsonb(s)) from stream s), '[]'::jsonb),
    'gaps',       coalesce((select jsonb_agg(to_jsonb(g)) from gaps g), '[]'::jsonb),
    'sweep_gaps', coalesce((select jsonb_agg(to_jsonb(w)) from sweep_gaps w), '[]'::jsonb)
  );
$fn$;
revoke all on function public.price_history(text) from public;
grant execute on function public.price_history(text) to anon, authenticated;

-- ── bet365 post-match archive (TEN-270, founder 2026-09-24/25) ──────────────
-- "Find a way to archive it straight after the game." / "Completed matches: the
-- archive history." archive-oddspapi-raw.py `postmatch` (workflow
-- oddspapi-postmatch.yml) writes the bet365 MATCH-WINNER ticks of each finished
-- bet365 card here, from the raw /v4/historical-odds payload it just archived:
--   card_key    ocsKeyOf(card) — the board card's date | surname keys
--   side        'p1' | 'p2' in CARD orientation (odds-fixture-map `orient`)
--   price, at   bet365's own price and tick time (createdAt)
--   active      bet365's flag on that tick (false = market suspended)
-- One row per CHANGE of (price, active) per side; the full tick series stays in
-- the raw bucket. Pre-start and in-play rows are both stored; which is which is
-- decided at READ time against odds_card_state.start_ts, because that start can
-- be resolved after the load. Server-side only: RLS on, no policy, no grant.
create table if not exists public.bet365_mw_ticks (
    card_key          text        not null,
    side              text        not null,
    price             numeric(9,3) not null,
    at                timestamptz not null,
    active            boolean,
    fixture_id        text        not null,   -- oddspapi fixtureId
    player            text,                   -- the card's name for that side
    loaded_at         timestamptz not null default now(),
    constraint bet365_mw_ticks_side check (side in ('p1', 'p2')),
    constraint bet365_mw_ticks_real check (price >= 1.01),
    constraint bet365_mw_ticks_key unique (card_key, side, at, price)
);
create index if not exists bet365_mw_ticks_card_idx on public.bet365_mw_ticks (card_key, at);
alter table public.bet365_mw_ticks enable row level security;
revoke all on public.bet365_mw_ticks from anon, authenticated;

-- bet365_history(card_key) — ONE completed card's archived bet365 history for
-- the price-history box. Rows only when the card's SELECTED book is bet365 (one
-- book per card), only when exactly one oddspapi fixture feeds the card key, and
-- only at or before the card's start (odds_card_state.start_ts — the start the
-- Close is judged against). No start known = no rows: nothing can be proven
-- pre-match. `stored` says whether the card was archived at all, so the page can
-- tell "not archived" from "archived, start unknown".
create or replace function public.bet365_history(p_card_key text)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  with sel as (
    select count(*) as n_sel, max(ocs.start_ts) as start_ts,
           max(ocs.start_ts_source) as start_ts_source
    from public.odds_card_state ocs
    where ocs.match_key = p_card_key and ocs.book = 'bet365'
      and ocs.market = 'match winner' and ocs.is_selected
  ),
  fx as (
    select count(distinct t.fixture_id) as n_fx, count(*) as stored
    from public.bet365_mw_ticks t
    where t.card_key = p_card_key
  ),
  pre as (
    select t.side, t.price, t.at, t.active
    from public.bet365_mw_ticks t, sel, fx
    where t.card_key = p_card_key and sel.n_sel > 0 and fx.n_fx = 1
      and sel.start_ts is not null and t.at <= sel.start_ts
    order by t.at desc
    limit 2000
  )
  select jsonb_build_object(
    'card_key',        p_card_key,
    'generated_at',    now(),
    'selected',        (select n_sel > 0 from sel),
    'start_ts',        (select start_ts from sel),
    'start_ts_source', (select start_ts_source from sel),
    'fixtures',        (select n_fx from fx),
    'stored',          (select stored from fx),
    'rows',            coalesce((select jsonb_agg(to_jsonb(p)) from pre p), '[]'::jsonb)
  );
$fn$;
revoke all on function public.bet365_history(text) from public;
grant execute on function public.bet365_history(text) to anon, authenticated;
