-- ARBITRAGE + DIVERGENCE engine (founder 2026-11-01): every 30 s, the latest price of each source for every upcoming ATP
-- match, after fees, against ONE fair price, and the two-sided arbitrages between sources.
--
-- Fair price (founder): Pinnacle's, read as Bet105 with the margin removed (Bet105 is live through Kibl):
--   p_first = (1/a) / (1/a + 1/b), fair = 1 / p.
-- Sources (each joined to ONE api-tennis fixture of type 'Atp Singles' in drops_scope.fixture — the drop bots' spine —
-- on both surnames + initials and a start within 24 h, exactly one candidate both ways, never a guess):
--   Bet105     sharp       public.kibl_now_card (the Kibl stream), live while the worker heartbeat is <= 180 s old
--   soft books config.soft_books, read from ten287_rec (odds-api.io recorder), live while that book's recorder answered
--              within 3 min. Founder 2026-11-09: arbitrage = Polymarket, Kalshi and Bet105 only — Napoleon Sports BE
--              is out (other settlement rules; its recorder and drop bot are untouched), as Superbet is (2026-11-06).
--   Polymarket prediction  ten287_rec, same; liquidity = dollars at the best price (odds-api.io depth)
--   Kalshi     prediction  kalshi_rec (public API recorder), live while it answered within 3 min; liquidity = ask × size;
--                          its fixture = kalshi_bot.match_fx (Kalshi's own times are listing placeholders)
-- (The api-tennis bookmaker collector, ten216_test_odds_changes, has written nothing since 30 Sep 2026: not a source.)
-- Fees (per contract / share, on the buy price q = 1 / decimal):
--   Kalshi taker:     0.07 × q × (1 − q)          (series fee_type quadratic_with_maker_fees, multiplier 1; config)
--   Polymarket taker: rate × q × (1 − q)        (docs.polymarket.com/trading/fees: fee = C × feeRate × p × (1 − p);
--                     Sports taker rate 0.05, makers free — the market's feeSchedule says rate 0.05, taker only; config)
--   bookmakers: none. Effective decimal = 1 / (q + fee).
-- Output:
--   DIVERGENCE  one source's effective price >= config.div_min % above the fair price (prediction legs need
--               >= config.min_liq dollars at the price);
--   ARB         back each player at a DIFFERENT source with 1/e1 + 1/e2 < 1: locked-in profit >= config.arb_min % after
--               fees; stakes split by 1/e. Flag (founder: flagged, not excluded): a prediction market (pays the player who
--               advances once a ball is played) against a bookmaker (may void a retirement) settles retirements
--               differently.
-- Telegram (drop chat, the Superbet bot's Vault names): ⚖️ ARB and 📐 DIVERGENCE, one per match + kind + source(s)
-- per config.cooldown. Page: public.arb_now() (anon, read-only) for Dropping Odds → Arbitrage.
-- Idempotent; schedules nothing (arb-engine.yml install does).
create schema if not exists arb;
revoke all on schema arb from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema arb from anon, authenticated'; end if;
end $$;

create table if not exists arb.config (
    id            boolean primary key default true check (id),
    arb_min       numeric  not null default 1,        -- % locked-in profit after fees
    arb_max       numeric           default 10,       -- a pre-match arb above this is a settlement artefact, never sent
    div_min       numeric  not null default 5,        -- % above the fair price
    min_liq       numeric           default 100,      -- dollars at the price for a prediction-market leg; NULL = none
    kalshi_coef   numeric  not null default 0.07,
    poly_rate     numeric  not null default 0.05,
    poly_exp      numeric  not null default 1,
    hb_max        interval not null default interval '180 seconds',
    rec_max       interval not null default interval '3 minutes',
    horizon       interval not null default interval '48 hours',
    cooldown      interval not null default interval '30 minutes'
);
insert into arb.config (id) values (true) on conflict (id) do nothing;

create table if not exists arb.alerts (
    id              bigserial primary key,
    kind            text not null check (kind in ('arb', 'divergence')),
    akey            text not null,                  -- kind|event|leg sources|side: the cooldown key
    event_key       bigint not null,
    detail          jsonb not null,
    message         text,
    net_request_id  bigint,
    sent_at         timestamptz,
    delivery        text not null default 'unsent',
    created_at      timestamptz not null default now()
);
create index if not exists arb_alerts_key_idx on arb.alerts (akey, created_at);
-- the engine's "answered lately" reads (arb.quotes live_books / kalshi_live); first built CONCURRENTLY by arb-engine.yml mode indexes
create index if not exists ten287_rec_requests_ok_idx on ten287_rec.requests (processed_at) include (book) where status_code = 200;
create index if not exists kalshi_rec_requests_ok_idx on kalshi_rec.requests (processed_at) where status_code = 200;
-- LIVE (founder 2026-11-02): the in-play Kalshi × Polymarket worker posts its gaps here as kind 'live'.
alter table arb.alerts add column if not exists retries integer not null default 0;   -- Telegram re-sends (founder 2026-11-03)
alter table arb.alerts drop constraint if exists alerts_kind_check;
alter table arb.alerts add constraint alerts_kind_check check (kind in ('arb', 'divergence', 'live'));
alter table arb.config add column if not exists arb_max numeric default 10;   -- founder 2026-11-03 (withdrawals)
alter table arb.config add column if not exists live_min      numeric  not null default 1;                      -- % after fees
alter table arb.config add column if not exists live_cooldown interval not null default interval '10 minutes';  -- per match + direction
alter table arb.config add column if not exists live_hb_max   interval not null default interval '90 seconds';  -- worker heartbeat
-- founder 2026-11-10 ("it needs to be 100% true"): a live row older than this at push time is never sent
alter table arb.config add column if not exists live_fresh    interval not null default interval '5 seconds';
-- founder 2026-11-12: a Bet105 leg only while the Kibl stream worker is current (its position row in kibl_live_ml, fixture 0)
alter table arb.config add column if not exists live_stream_lag interval not null default interval '5 seconds';
-- the odds-api.io bookmakers read as soft sources (founder 2026-11-05: Napoleon Sports BE beside Superbet); each must also
-- be in ten287_rec.config.books or it has no ticks. A book's name here is the name its alerts print.
alter table arb.config add column if not exists soft_books text[] not null default '{}';
alter table arb.config alter column soft_books set default '{}';
-- founder 2026-11-06: Superbet leaves the arbitrage sources (Polymarket, Kalshi, Napoleon Sports BE, Bet105). Putting it
-- back is an edit here, not a config change: every install takes it out again.
update arb.config set soft_books = array_remove(soft_books, 'Superbet') where 'Superbet' = any(soft_books);
-- founder 2026-11-09: Napoleon Sports BE leaves too (arbitrage = Polymarket, Kalshi, Bet105). Same rule: back only by an edit here.
update arb.config set soft_books = array_remove(soft_books, 'Napoleon Sports BE') where 'Napoleon Sports BE' = any(soft_books);
create table if not exists arb.live_state (
    id      boolean primary key default true check (id),
    at      timestamptz,                 -- the worker's last push (its heartbeat)
    gaps    jsonb not null default '[]', -- every Kalshi × Polymarket pair with a positive edge after fees right now
    worker  jsonb                        -- its own counters (pairs joined, polls, errors)
);
insert into arb.live_state (id) values (true) on conflict (id) do nothing;
-- arb.tick() stores each 30-s result here; the page reads it (arb.opps() takes ~3 s, the anon statement limit:
-- measured 2 Nov 11:22Z, 1 read in 4 timed out). Served up to 10 min old (founder 2026-11-03: a few skipped ticks timed the
-- page out again, 3 Nov 06:03Z, at 2 min); older (engine stopped) → computed on the spot.
create table if not exists arb.snap (
    id    boolean primary key default true check (id),
    at    timestamptz,
    opps  jsonb
);
alter table arb.snap enable row level security;
alter table arb.live_state enable row level security;
alter table arb.alerts enable row level security;
alter table arb.config enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on all tables in schema arb from anon, authenticated'; end if;
end $$;

-- effective decimal after a prediction market's taker fee; a bookmaker price as is
create or replace function arb.eff(p_source text, p_price numeric) returns numeric
language plpgsql stable as $$
declare q numeric; c arb.config;
begin
  if p_price is null or p_price < 1.01 then return null; end if;
  if p_source not in ('Kalshi', 'Polymarket') then return p_price; end if;
  select * into c from arb.config;
  q := 1 / p_price;
  if p_source = 'Kalshi' then return round(1 / (q + c.kalshi_coef * q * (1 - q)), 3); end if;
  return round(1 / (q + c.poly_rate * power(q * (1 - q), c.poly_exp)), 3);
end $$;

-- a match api-tennis marks over or not to be played: no price, no alert (founder 2026-11-03, Davidovich Fokina v Kouame:
-- four ⚖️ ARB of +26% after the withdrawal, off a frozen Polymarket book). Not started / Set N = open.
create or replace function arb.fixture_closed(p_status text, p_winner text) returns boolean
language sql immutable as $$
  select coalesce(p_winner, '') <> ''
      or coalesce(p_status, '') ~* '(walk ?over|w/o|retired|ret\.|cancel|postpon|abandon|finished|awarded|default|withdr|suspend|interrupt)'
$$;

-- every live quote, one row per (fixture, source): both players' price, effective price, liquidity, time, and the match
-- page where we know it (founder 2026-11-06): Polymarket = its event slug from poly_bot.volume (both surname keys, start
-- within 36 h, one candidate both ways), Kalshi = its event ticker. Bet105 and Napoleon give us no match link: none.
drop function if exists arb.quotes();   -- the url column changes the row type (create or replace cannot)
create or replace function arb.quotes() returns table(event_key bigint, first_player text, second_player text, start_utc timestamptz,
    source text, grp text, p_first numeric, p_second numeric, e_first numeric, e_second numeric, l_first numeric, l_second numeric,
    at timestamptz, url text)
language plpgsql stable as $$
declare c arb.config;
begin
  select * into c from arb.config;
  return query
  with fx as (
    select f.event_key, f.first_player, f.second_player, f.start_utc, drops_scope.sk(f.first_player) k1, drops_scope.sk(f.second_player) k2
      from drops_scope.fixture f
     where f.event_type_type = 'Atp Singles' and f.start_utc > now() and f.start_utc < now() + c.horizon
       and not arb.fixture_closed(f.event_status, f.event_winner)
       and position('/' in coalesce(f.first_player, '') || coalesce(f.second_player, '')) = 0
       -- a match that has STARTED is never a pre-match arbitrage, whatever its scheduled time (founder 2026-11-10: Sonego v
       -- Halys went live 13:24:17, before its 13:30 slot; the ⚖️ ARB at 13:28 paired Bet105's 13:16 pre-match 2.08 with a
       -- live Polymarket price). Started = our 10-s live poller's flip, or api-tennis already reporting a set / live.
       and not exists (select 1 from public.live_flip_log_current l where l.event_key = f.event_key::text)
       and coalesce(f.event_status, '') !~* '^set|live'
  ),
  -- Bet105 (Kibl stream): card key = board date | surname keys; live while the worker beats
  b105 as (
    select k.*, split_part(k.card_key, '|', 1)::date cdate from public.kibl_now_card k
     where lower(coalesce(k.book, '')) = 'bet105'
       and exists (select 1 from public.kibl_now_price h where h.kind = 'heartbeat' and h.written_at > now() - c.hb_max)
  ),
  b105j as (
    select fx.event_key, b.card_key, case when b.a_side = fx.k1 then b.a_price else b.b_price end pf,
           case when b.a_side = fx.k1 then b.b_price else b.a_price end ps, greatest(b.a_at, b.b_at) at
      from fx join b105 b on ((b.a_side = fx.k1 and b.b_side = fx.k2) or (b.a_side = fx.k2 and b.b_side = fx.k1))
                          and abs(b.cdate - (fx.start_utc at time zone 'Europe/Berlin')::date) <= 1
  ),
  b105u as (
    select j.* from b105j j
     where (select count(*) from b105j x where x.event_key = j.event_key) = 1
       and (select count(*) from b105j x where x.card_key = j.card_key) = 1
  ),
  -- which recorders answered lately: read ONCE per run on the (processed_at) WHERE status_code = 200 indexes below,
  -- never once per price row (5 Nov 2026: the per-row check scanned all of ten287_rec.requests every tick, 3.1B rows read)
  live_books as materialized (
    select distinct r.book from ten287_rec.requests r where r.status_code = 200 and r.processed_at > now() - c.rec_max
  ),
  kalshi_live as materialized (
    select exists (select 1 from kalshi_rec.requests r where r.status_code = 200 and r.processed_at > now() - c.rec_max) ok
  ),
  -- odds-api.io books (shared recorder): the latest ML tick per event and book, live while that book answered lately
  oa as (
    select distinct on (t.event_id, t.book) t.event_id, t.book, t.back_home, t.back_away, t.depth_home, t.depth_away,
           coalesce(t.book_updated_at, t.seen_at) at, e.home, e.away, e.start_at
      from ten287_rec.ticks t join ten287_rec.events e using (event_id)
     where t.market = 'ML' and (t.book = 'Polymarket' or t.book = any(c.soft_books)) and coalesce(t.event_status, e.status) = 'pending'
       -- Polymarket = our own CLOB recorder only (src 'clob', tools/poly-recorder.sql). odds-api.io's older Polymarket
       -- events stay 'pending' after the switch (4 Nov 12:28Z) and would make every match carried by both ambiguous.
       and (t.book <> 'Polymarket' or t.src = 'clob')
       and e.start_at > now() - interval '1 hour' and e.start_at < now() + c.horizon
       and t.book in (select lb.book from live_books lb)
     order by t.event_id, t.book, coalesce(t.book_updated_at, t.seen_at) desc, t.seen_at desc
  ),
  oaj as (
    select fx.event_key, o.event_id, o.book, o.at,
           case when drops_scope.same(o.home, fx.first_player) then o.back_home else o.back_away end pf,
           case when drops_scope.same(o.home, fx.first_player) then o.back_away else o.back_home end ps,
           case when drops_scope.same(o.home, fx.first_player) then o.depth_home else o.depth_away end lf,
           case when drops_scope.same(o.home, fx.first_player) then o.depth_away else o.depth_home end ls
      from fx join oa o on ((drops_scope.same(o.home, fx.first_player) and drops_scope.same(o.away, fx.second_player))
                         or (drops_scope.same(o.home, fx.second_player) and drops_scope.same(o.away, fx.first_player)))
                        and abs(extract(epoch from o.start_at - fx.start_utc)) < 86400
  ),
  oau as (
    select j.* from oaj j
     where (select count(*) from oaj x where x.event_key = j.event_key and x.book = j.book) = 1
       and (select count(*) from oaj x where x.event_id = j.event_id and x.book = j.book) = 1
  ),
  -- Kalshi (public API recorder): the latest tick per market, live while the recorder answered lately
  ka as (
    select distinct on (t.ticker) t.ticker, t.event_ticker, t.yes_ask, t.yes_ask_size, t.seen_at at   -- when WE saw it (Kalshi's updated_time read 15:00 for a 09:38 price)
      from kalshi_rec.ticks t
     where t.status = 'active' and t.seen_at > now() - interval '1 day'
       and (select kl.ok from kalshi_live kl)
     order by t.ticker, t.seen_at desc
  ),
  -- each Kalshi match's api-tennis fixture is kalshi_bot.match_fx (Kalshi's own times are listing placeholders)
  kam as (
    select m.event_ticker, m.player_a, m.player_b, x.event_key,
           (select ka.yes_ask from ka join kalshi_rec.markets mk using (ticker) where mk.event_ticker = m.event_ticker and mk.player = m.player_a) qa,
           (select ka.yes_ask * ka.yes_ask_size from ka join kalshi_rec.markets mk using (ticker) where mk.event_ticker = m.event_ticker and mk.player = m.player_a) la,
           (select ka.yes_ask from ka join kalshi_rec.markets mk using (ticker) where mk.event_ticker = m.event_ticker and mk.player = m.player_b) qb,
           (select ka.yes_ask * ka.yes_ask_size from ka join kalshi_rec.markets mk using (ticker) where mk.event_ticker = m.event_ticker and mk.player = m.player_b) lb,
           (select max(ka.at) from ka where ka.event_ticker = m.event_ticker) at
      from kalshi_bot.matches m join kalshi_bot.match_fx x using (event_ticker)
  ),
  kau as (
    select fx.event_key, k.event_ticker, k.at,
           case when drops_scope.same(k.player_a, fx.first_player) then k.qa else k.qb end qf,
           case when drops_scope.same(k.player_a, fx.first_player) then k.qb else k.qa end qs,
           case when drops_scope.same(k.player_a, fx.first_player) then k.la else k.lb end lf,
           case when drops_scope.same(k.player_a, fx.first_player) then k.lb else k.la end ls
      from fx join kam k using (event_key)
     where k.qa > 0 and k.qa < 1 and k.qb > 0 and k.qb < 1
  ),
  -- the Polymarket match page: poly_bot.volume's slug (a start known only by its slug day is noon UTC: 36 h either way)
  pslug as (
    select fx.event_key, v.slug from fx join poly_bot.volume v
        on ((v.sk_a = fx.k1 and v.sk_b = fx.k2) or (v.sk_a = fx.k2 and v.sk_b = fx.k1))
       and (v.start_at is null or abs(extract(epoch from v.start_at - fx.start_utc)) < 129600)
  ),
  pslugu as (
    select p.* from pslug p
     where (select count(*) from pslug x where x.event_key = p.event_key) = 1
       and (select count(*) from pslug x where x.slug = p.slug) = 1
  ),
  q as (
    select b.event_key, 'Bet105'::text src, 'sharp'::text g, b.pf, b.ps, null::numeric lf, null::numeric ls, b.at, null::text u from b105u b
    union all
    select o.event_key, o.book, case o.book when 'Polymarket' then 'prediction' else 'soft' end, o.pf, o.ps,
           case when o.book = 'Polymarket' then o.lf end, case when o.book = 'Polymarket' then o.ls end, o.at,
           case when o.book = 'Polymarket' then (select 'https://polymarket.com/event/' || p.slug from pslugu p where p.event_key = o.event_key) end
      from oau o
    union all
    select k.event_key, 'Kalshi', 'prediction', round(1 / k.qf, 3), round(1 / k.qs, 3), round(k.lf, 2), round(k.ls, 2), k.at,
           'https://kalshi.com/markets/kxatpmatch/atp-tennis-match/' || lower(k.event_ticker) from kau k
  )
  select fx.event_key, fx.first_player, fx.second_player, fx.start_utc, q.src, q.g, q.pf, q.ps,
         arb.eff(q.src, q.pf), arb.eff(q.src, q.ps), q.lf, q.ls, q.at, q.u
    from q join fx using (event_key)
   where q.pf >= 1.01 and q.ps >= 1.01
     -- Bet105 already trading it in play (Kibl betting type 3, kibl_live_ml): started, even before api-tennis flags it
     and not exists (select 1 from b105j j join public.kibl_now_card k on k.card_key = j.card_key
                       join public.kibl_live_ml m on m.fixture_id = k.fixture_id
                      where j.event_key = fx.event_key);
end $$;

-- the opportunities now: fair per match, divergences and the best arbitrage per match
create or replace function arb.opps() returns jsonb
language plpgsql stable as $$
declare c arb.config; j jsonb;
begin
  select * into c from arb.config;
  with qt as (select * from arb.quotes()),
  fair as (
    select event_key, round(1 / ((1 / p_first) / (1 / p_first + 1 / p_second)), 3) ff,
           round(1 / ((1 / p_second) / (1 / p_first + 1 / p_second)), 3) fs, at fair_at
      from qt where source = 'Bet105'
  ),
  sides as (
    select q.*, s.side, s.price, s.eff, s.liq, s.player
      from qt q cross join lateral (values ('first', q.p_first, q.e_first, q.l_first, q.first_player),
                                           ('second', q.p_second, q.e_second, q.l_second, q.second_player)) s(side, price, eff, liq, player)
  ),
  liq_ok as (
    select s.*, (s.grp <> 'prediction' or c.min_liq is null or coalesce(s.liq, 0) >= c.min_liq) ok from sides s
  ),
  div as (
    select l.event_key, l.first_player, l.second_player, l.start_utc, l.source, l.grp, l.side, l.player, l.price, l.eff, l.liq, l.at, l.url,
           case l.side when 'first' then f.ff else f.fs end fair, f.fair_at,
           round((l.eff / case l.side when 'first' then f.ff else f.fs end - 1) * 100, 2) edge
      from liq_ok l join fair f using (event_key)
     where l.source <> 'Bet105' and l.ok and l.eff >= (case l.side when 'first' then f.ff else f.fs end) * (1 + c.div_min / 100)
  ),
  pairs as (
    select a.event_key, a.first_player, a.second_player, a.start_utc,
           a.source sa, a.grp ga, a.price pa, a.eff ea, a.liq la, a.at ta, a.url ua,
           b.source sb, b.grp gb, b.price pb, b.eff eb, b.liq lb, b.at tb, b.url ub,
           round((1 / (1 / a.eff + 1 / b.eff) - 1) * 100, 2) profit,
           round((1 / a.eff) / (1 / a.eff + 1 / b.eff) * 100, 1) stake_a
      from liq_ok a join liq_ok b on b.event_key = a.event_key and a.side = 'first' and b.side = 'second' and a.source <> b.source
     where a.ok and b.ok and a.eff is not null and b.eff is not null
  ),
  best as (
    select distinct on (event_key) * from pairs where profit >= c.arb_min and (c.arb_max is null or profit <= c.arb_max) order by event_key, profit desc, sa, sb
  )
  select jsonb_build_object(
    'at', now(),
    'config', jsonb_build_object('arbMin', c.arb_min, 'arbMax', c.arb_max, 'divMin', c.div_min, 'minLiq', c.min_liq),
    'fair', coalesce((select jsonb_agg(jsonb_build_object('eventKey', f.event_key, 'first', q.first_player, 'second', q.second_player,
                        'start', q.start_utc, 'fairFirst', f.ff, 'fairSecond', f.fs, 'at', f.fair_at,
                        'sources', (select jsonb_agg(jsonb_build_object('source', x.source, 'group', x.grp, 'first', x.p_first, 'second', x.p_second,
                                      'effFirst', x.e_first, 'effSecond', x.e_second, 'liqFirst', x.l_first, 'liqSecond', x.l_second, 'at', x.at, 'url', x.url)
                                      order by x.grp, x.source) from qt x where x.event_key = f.event_key))
                        order by q.start_utc)
                      from fair f join qt q on q.event_key = f.event_key and q.source = 'Bet105'), '[]'::jsonb),
    'divergences', coalesce((select jsonb_agg(jsonb_build_object('eventKey', event_key, 'first', first_player, 'second', second_player,
                        'start', start_utc, 'source', source, 'group', grp, 'side', side, 'player', player, 'price', price, 'eff', eff,
                        'liq', liq, 'at', at, 'url', url, 'fair', fair, 'fairAt', fair_at, 'edge', edge) order by edge desc) from div), '[]'::jsonb),
    'arbs', coalesce((select jsonb_agg(jsonb_build_object('eventKey', event_key, 'first', first_player, 'second', second_player,
                        'start', start_utc, 'profit', profit, 'stakeFirst', stake_a, 'stakeSecond', round(100 - stake_a, 1),
                        'legFirst', jsonb_build_object('source', sa, 'group', ga, 'price', pa, 'eff', ea, 'liq', la, 'at', ta, 'url', ua),
                        'legSecond', jsonb_build_object('source', sb, 'group', gb, 'price', pb, 'eff', eb, 'liq', lb, 'at', tb, 'url', ub),
                        'retirementFlag', (ga = 'prediction') <> (gb = 'prediction')) order by profit desc) from best), '[]'::jsonb)
  ) into j;
  return j;
end $$;

-- read-only, for the page (publishable key)
create or replace function public.arb_now() returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select o || jsonb_build_object(
    'liveOn', coalesce(l.at > now() - c.live_hb_max, false),
    'liveAt', l.at,
    'live', case when l.at > now() - c.live_hb_max then
              (select coalesce(jsonb_agg(g order by (g->>'edge')::numeric desc), '[]'::jsonb) from jsonb_array_elements(l.gaps) g
                where (g->>'edge')::numeric >= c.live_min
                  and (c.min_liq is null or not coalesce((g->>'hasPm')::boolean, true) or (g->>'stake')::numeric >= c.min_liq)
                  -- founder 2026-11-09: Polymarket, Kalshi, Bet105 only (as arb_live_push)
                  and not exists (select 1 from jsonb_array_elements(coalesce(g->'legs', '[]'::jsonb)) x
                                   where coalesce(x->>'venue', '') not in ('Polymarket', 'Kalshi', 'Bet105')))
            end,
    'config', (o->'config') || jsonb_build_object('liveMin', c.live_min))
  from (select case when s.at > now() - interval '10 minutes' then s.opps else arb.opps() end as o
          from (select 1) one left join arb.snap s on s.id) oo(o), arb.live_state l, arb.config c $$;
revoke all on function public.arb_now() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.arb_now() to anon, authenticated, service_role';
  end if;
end $$;

create or replace function arb.px(p numeric) returns text
language sql immutable as $$ select regexp_replace(regexp_replace(to_char(p, 'FM9990.000'), '0+$', ''), '\.$', '') $$;
create or replace function arb.usd(p numeric) returns text
language sql immutable as $$ select case when p is null then '—' else '$' || to_char(round(p), 'FM999,999,999,990') end $$;
-- USD → EUR (founder 2026-11-04: "just in euros"): the ECB reference rate via api.frankfurter.app, asked through pg_net at most
-- every 6 h from tick(), settled on the next tick. A rate older than 4 days is not used: the amount stays in dollars.
create table if not exists arb.fx (
    id        boolean primary key default true check (id),
    usd_eur   numeric,
    rate_date date,
    asked_at  timestamptz,
    req       bigint
);
insert into arb.fx (id) values (true) on conflict (id) do nothing;
alter table arb.fx enable row level security;
create or replace function arb.fx_tick() returns void
language plpgsql as $$
declare f arb.fx; r record; v numeric;
begin
  select * into f from arb.fx;
  if f.req is not null then
    select * into r from net._http_response where id = f.req;
    if found then
      begin
        v := (r.content::jsonb -> 'rates' ->> 'EUR')::numeric;
        if r.status_code between 200 and 299 and v > 0.3 and v < 3 then
          update arb.fx set usd_eur = v, rate_date = (r.content::jsonb ->> 'date')::date, req = null where id;
        else update arb.fx set req = null where id; end if;
      exception when others then update arb.fx set req = null where id;
      end;
    end if;
  end if;
  if (f.asked_at is null or f.asked_at < now() - interval '6 hours') then
    update arb.fx set req = net.http_get(url := 'https://api.frankfurter.app/latest?from=USD&to=EUR'), asked_at = now() where id;
  end if;
end $$;
create or replace function arb.eur2(p numeric) returns text
language sql immutable as $$ select case when p is null then '—' when abs(p) < 1000 then '€' || to_char(p, 'FM990.00')
                                         else '€' || to_char(round(p), 'FM999,999,999,990') end $$;
create or replace function arb.usd2(p numeric) returns text
language sql immutable as $$ select case when p is null then '—' when abs(p) < 1000 then '$' || to_char(p, 'FM990.00')
                                         else '$' || to_char(round(p), 'FM999,999,999,990') end $$;
-- an amount people read: euros first (dollars in brackets) while the rate is fresh, else dollars
create or replace function arb.money(p numeric) returns text
language sql stable as $$
  select case when p is null then '—'
              when (select usd_eur from arb.fx where rate_date > current_date - 4) is null then arb.usd2(p)
              else arb.eur2(p * (select usd_eur from arb.fx)) || ' (' || arb.usd2(p) || ')' end
$$;

-- a pre-match arb's largest total: a prediction-market leg holds liq dollars at its price (= contracts × price), so the most
-- that leg takes is liq × price / eff (its cost with the fee) and the total is that over its share of the split; the
-- smaller of the two legs decides. NULL when neither leg is a prediction market (bookmaker limits are not known here).
create or replace function arb.max_total(a jsonb) returns numeric
language sql immutable as $$
  select min(t) from (
    select (l->>'liq')::numeric * (l->>'price')::numeric / (l->>'eff')::numeric / (sh / 100) t
      from (values (a->'legFirst', (a->>'stakeFirst')::numeric), (a->'legSecond', (a->>'stakeSecond')::numeric)) v(l, sh)
     where l->>'group' = 'prediction' and (l->>'liq')::numeric > 0 and sh > 0) x
$$;
create or replace function arb.hhmm(p timestamptz) returns text
language sql immutable as $$ select case when p is null then '—' else to_char(p at time zone 'UTC', 'HH24:MI') || ' UTC' end $$;
create or replace function arb.hms(p timestamptz) returns text
language sql immutable as $$ select case when p is null then '—' else to_char(p at time zone 'UTC', 'HH24:MI:SS') || ' UTC' end $$;
create or replace function arb.feeword(p_source text) returns text
language sql immutable as $$ select case when p_source in ('Kalshi', 'Polymarket') then ' (after fee ' else '' end $$;

create or replace function arb.leg(l jsonb, p_player text) returns text
language sql immutable as $$
  select format('✅ Back %s @ %s on %s%s · %s', p_player, arb.px((l->>'price')::numeric), l->>'source',
           case when l->>'source' in ('Kalshi', 'Polymarket') then ' (after fee ' || arb.px((l->>'eff')::numeric) || ')' else '' end,
           case when l->>'group' = 'prediction' then 'liquidity ' || arb.usd((l->>'liq')::numeric) else 'bookmaker' end)
      || case when coalesce(l->>'url', '') <> '' then chr(10) || '🔗 ' || (l->>'url') else '' end
$$;

create or replace function arb.render_arb(a jsonb) returns text
language sql stable as $$
  select concat_ws(chr(10),
    '⚖️ ARB',
    '',
    format('🎾 Match: %s vs %s (ATP)', a->>'first', a->>'second'),
    arb.leg(a->'legFirst', a->>'first'),
    arb.leg(a->'legSecond', a->>'second'),
    -- dollars per leg (founder 2026-11-04): at the largest total the prediction-market book takes, else per $1,000;
    -- one player per line (founder 2026-11-06: where each stake goes, at a glance)
    format('💰 %s %s', case when arb.max_total(a) is not null then 'Max stake' else 'Per $1,000 staked' end,
           arb.money(coalesce(arb.max_total(a), 1000))),
    format('   • %s: %s on %s', a->>'first', arb.money(coalesce(arb.max_total(a), 1000) * (a->>'stakeFirst')::numeric / 100), a->'legFirst'->>'source'),
    format('   • %s: %s on %s', a->>'second', arb.money(coalesce(arb.max_total(a), 1000) * (a->>'stakeSecond')::numeric / 100), a->'legSecond'->>'source'),
    format('💵 Pays %s whoever wins → profit %s (+%s%%)',
           arb.money(coalesce(arb.max_total(a), 1000) * (1 + (a->>'profit')::numeric / 100)),
           arb.money(coalesce(arb.max_total(a), 1000) * (a->>'profit')::numeric / 100), to_char((a->>'profit')::numeric, 'FM990.00')),
    case when arb.max_total(a) is null then '📏 Both legs are bookmakers: their limits are not known here.'
         else '📏 The most the prediction-market book takes at this price; a smaller stake keeps the same split.' end,
    case when (a->>'retirementFlag')::boolean then
      '⚠️ Retirement rules differ: Kalshi / Polymarket pay the player who advances once a ball is played; a bookmaker may void the bet on a retirement.' end,
    -- each leg's clock says what it is: Bet105 comes from the Kibl stream, which sends only changes — its time is when the
    -- price last CHANGED (still current: the stream was connected at send time); the others are their last update
    format('🕒 Prices at %s — %s · %s', arb.hhmm(now()),
           case when a->'legFirst'->>'source' = 'Bet105' then format('Bet105 unchanged since %s (Kibl stream connected)', arb.hhmm((a->'legFirst'->>'at')::timestamptz))
                else format('%s updated %s', a->'legFirst'->>'source', arb.hhmm((a->'legFirst'->>'at')::timestamptz)) end,
           case when a->'legSecond'->>'source' = 'Bet105' then format('Bet105 unchanged since %s (Kibl stream connected)', arb.hhmm((a->'legSecond'->>'at')::timestamptz))
                else format('%s updated %s', a->'legSecond'->>'source', arb.hhmm((a->'legSecond'->>'at')::timestamptz)) end))
$$;

create or replace function arb.render_div(d jsonb) returns text
language sql immutable as $$
  select concat_ws(chr(10),
    '📐 DIVERGENCE',
    '',
    format('🎾 Match: %s vs %s (ATP)', d->>'first', d->>'second'),
    format('🎯 %s: %s @ %s%s', d->>'source', d->>'player', arb.px((d->>'price')::numeric),
           case when d->>'source' in ('Kalshi', 'Polymarket') then ' (after fee ' || arb.px((d->>'eff')::numeric) || ')' else '' end),
    case when coalesce(d->>'url', '') <> '' then '🔗 ' || (d->>'url') end,
    format('📏 Fair (Bet105, margin removed): %s → +%s%% above fair', arb.px((d->>'fair')::numeric), to_char((d->>'edge')::numeric, 'FM990.0')),
    case when d->>'group' = 'prediction' then format('💧 Liquidity at price: %s', arb.usd((d->>'liq')::numeric)) end,
    format('🕒 Prices: %s @ %s · Bet105 @ %s', d->>'source', arb.hhmm((d->>'at')::timestamptz), arb.hhmm((d->>'fairAt')::timestamptz)))
$$;

-- the chat (founder 2026-11-05, replacing 2026-11-04's split): every kind — ⚡ live arbitrage, ⚖️ pre-match arbitrage and
-- 📐 divergence — goes to the arbitrage group (Vault arb_telegram_chat_id, "Arbritage Bot"). Same bot as the drop chat.
-- No arbitrage chat stored yet → the drop chat (ten287_telegram_chat_id; an alert is never lost to a missing setting).
-- the one-argument send of 2026-11-02 is dropped: left beside this one, every arb.send(msg) call was ambiguous and each
-- tick that found a pre-match arbitrage failed (4 Nov 13:16Z – 5 Nov, 146 runs) — create or replace never removes an old signature.
drop function if exists arb.send(text);
create or replace function arb.send(p_text text, p_kind text default 'arb') returns bigint
language plpgsql as $$
declare tok text; chat text;
begin
  select decrypted_secret into tok  from vault.decrypted_secrets where name = 'ten287_telegram_bot_token';
  select decrypted_secret into chat from vault.decrypted_secrets where name = 'arb_telegram_chat_id';
  if chat is null then select decrypted_secret into chat from vault.decrypted_secrets where name = 'ten287_telegram_chat_id'; end if;
  if tok is null or chat is null then return null; end if;
  return net.http_post(url := 'https://api.telegram.org/bot' || btrim(tok) || '/sendMessage',
    body := jsonb_build_object('chat_id', btrim(chat), 'text', p_text, 'disable_web_page_preview', true),
    headers := '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds := 10000);
end $$;

-- pg_cron every 30 s: settle, find, post new ones (one per key per cooldown)
create or replace function arb.tick() returns integer
language plpgsql as $$
declare c arb.config; o jsonb; x jsonb; k text; n integer := 0; rid bigint; msg text;
begin
  if not pg_try_advisory_xact_lock(288291) then return 0; end if;
  update arb.alerts a set delivery = case when r.status_code between 200 and 299 then 'sent'
                                         else 'failed: ' || coalesce('HTTP ' || r.status_code, r.error_msg, 'no response') end
    from net._http_response r where a.delivery = 'queued' and r.id = a.net_request_id;
  -- one re-send for an alert Telegram did not take (founder 2026-11-03: 3 of 13 live alerts timed out at the TLS handshake
  -- on 2 Nov), only while it is fresh (15 min): any kind, the same message, recorded on the row.
  for x in select to_jsonb(a) from arb.alerts a where a.delivery like 'failed:%' and a.retries = 0 and a.created_at > now() - interval '15 minutes' loop
    rid := arb.send(x->>'message', x->>'kind');
    update arb.alerts set retries = 1, net_request_id = coalesce(rid, net_request_id), sent_at = case when rid is not null then now() else sent_at end,
           delivery = case when rid is null then 'unsent: no vault secret' else 'queued' end
     where id = (x->>'id')::bigint;
  end loop;
  perform arb.fx_tick();
  select * into c from arb.config;
  o := arb.opps();
  insert into arb.snap (id, at, opps) values (true, now(), o) on conflict (id) do update set at = excluded.at, opps = excluded.opps;
  for x in select * from jsonb_array_elements(o->'arbs') loop
    k := 'arb|' || (x->>'eventKey') || '|' || (x->'legFirst'->>'source') || '+' || (x->'legSecond'->>'source');
    continue when exists (select 1 from arb.alerts where akey = k and created_at > now() - c.cooldown);
    msg := arb.render_arb(x); rid := arb.send(msg, 'arb');
    insert into arb.alerts (kind, akey, event_key, detail, message, net_request_id, sent_at, delivery)
    values ('arb', k, (x->>'eventKey')::bigint, x, msg, rid, case when rid is not null then now() end,
            case when rid is null then 'unsent: no vault secret' else 'queued' end);
    n := n + 1;
  end loop;
  for x in select * from jsonb_array_elements(o->'divergences') loop
    k := 'divergence|' || (x->>'eventKey') || '|' || (x->>'source') || '|' || (x->>'side');
    continue when exists (select 1 from arb.alerts where akey = k and created_at > now() - c.cooldown);
    msg := arb.render_div(x); rid := arb.send(msg, 'divergence');
    insert into arb.alerts (kind, akey, event_key, detail, message, net_request_id, sent_at, delivery)
    values ('divergence', k, (x->>'eventKey')::bigint, x, msg, rid, case when rid is not null then now() end,
            case when rid is null then 'unsent: no vault secret' else 'queued' end);
    n := n + 1;
  end loop;
  return n;
end $$;

-- the legs of a live row (founder 2026-11-08: bookmakers join the live list). A row from a worker built before 8 Nov carries
-- only the Polymarket / Kalshi fields; it is read into the same two legs.
create or replace function arb.live_legs(g jsonb) returns jsonb
language sql immutable as $$
  select coalesce(case when jsonb_typeof(g->'legs') = 'array' then g->'legs' end, jsonb_build_array(
    jsonb_build_object('venue', 'Polymarket', 'name', g->'polyName', 'group', 'prediction', 'dec', g->'polyDec', 'eff', g->'polyEff',
                       'stake', g->'polyStake', 'at', g->'polyAt'),
    jsonb_build_object('venue', 'Kalshi', 'name', g->'kalName', 'group', 'prediction', 'dec', g->'kalDec', 'eff', g->'kalEff',
                       'stake', g->'kalStake', 'at', g->'kalAt')))
$$;

create or replace function arb.render_live(g jsonb) returns text
language sql stable as $$
  with l as (select x, n from jsonb_array_elements(arb.live_legs(g)) with ordinality t(x, n)),
       f as (select bool_or(x->>'group' = 'book') book, bool_or(x->>'group' = 'prediction') pm from l)
  select concat_ws(chr(10),
    '⚡ LIVE ARB',
    '',
    format('🎾 Match: %s (ATP)', g->>'match'),
    format('%s · %s', case g->>'phase' when 'changeover' then '🪑 Changeover (players sit)' when 'set' then '⏸ Set break'
                                         else '🔄 New game (serve changes)' end, coalesce(g->>'score', 'score —')),
    -- dollars, not shares (founder 2026-11-04): the most both books take at these prices, per leg, and what it returns;
    -- a bookmaker publishes no limit, so a bookmaker-only gap gives the split instead
    (select string_agg(concat_ws(chr(10),
       case when x->>'stake' is not null
            then format('✅ Stake %s on %s @ %s on %s', arb.money((x->>'stake')::numeric), x->>'name', arb.px((x->>'dec')::numeric), x->>'venue')
            else format('✅ Back %s @ %s on %s · %s%% of the total', x->>'name', arb.px((x->>'dec')::numeric), x->>'venue',
                        to_char((x->>'share')::numeric, 'FM990.0')) end
         || case when x->>'group' = 'prediction' then format(' (after fee %s)', arb.px((x->>'eff')::numeric)) else '' end,
       case when x->>'url' is not null then '🔗 ' || (x->>'url') end), chr(10) order by n) from l),
    case when g->>'stake' is not null
         then format('💰 Total %s → pays %s whoever wins → profit %s (+%s%%)', arb.money((g->>'stake')::numeric), arb.money((g->>'payout')::numeric),
                     arb.money((g->>'profitUsd')::numeric), to_char((g->>'edge')::numeric, 'FM990.00'))
         else format('💰 Any total in this split pays the same whoever wins: +%s%%', to_char((g->>'edge')::numeric, 'FM990.00')) end,
    case when g->>'stake' is not null then
      case when (select book from f) then '📏 That is the most the prediction market takes at this price (the bookmaker publishes no limit); a smaller stake keeps the same split and the same +%.'
           else '📏 That is the most both order books take at these prices; a smaller stake keeps the same split and the same +%.' end end,
    case when (select book and pm from f) then '⚠️ Retirement rules differ: Kalshi / Polymarket pay the player who advances once a ball is played; a bookmaker may void the bet on a retirement.'
         when (select book from f) then '⚠️ Check each bookmaker''s retirement rule: one may void the bet on a retirement while the other settles it.' end,
    '⚠️ Live prices move every point: check both before you bet.',
    -- the moment every price above was checked, and when the bookmaker itself set its price (to the second)
    case when g->>'computedAt' is not null
         then '🕒 All prices checked at ' || arb.hms((g->>'computedAt')::timestamptz)
              || coalesce((select string_agg(format(' · %s set this price at %s', x->>'venue', arb.hms((x->>'setAt')::timestamptz)), '' order by n)
                             from l where x->>'group' = 'book' and x->>'setAt' is not null), '')
         else '🕒 Prices: ' || (select string_agg(format('%s @ %s', x->>'venue', arb.hhmm((x->>'at')::timestamptz)), ' · ' order by n) from l) end)
$$;

-- the live worker's push (service role only): the current gaps + heartbeat; posts each new one >= live_min with
-- >= min_liq dollars to lock in, once per match + direction per live_cooldown. Returns the number posted.
create or replace function public.arb_live_push(p jsonb) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare c arb.config; g jsonb; k text; n integer := 0; rid bigint; msg text;
begin
  select * into c from arb.config;
  update arb.live_state set at = now(), gaps = coalesce(p->'gaps', '[]'::jsonb), worker = p->'worker' where id;
  update arb.alerts a set delivery = case when r.status_code between 200 and 299 then 'sent'
                                         else 'failed: ' || coalesce('HTTP ' || r.status_code, r.error_msg, 'no response') end
    from net._http_response r where a.kind = 'live' and a.delivery = 'queued' and r.id = a.net_request_id;
  for g in select * from jsonb_array_elements(coalesce(p->'gaps', '[]'::jsonb)) loop
    continue when coalesce((g->>'edge')::numeric, 0) < c.live_min;
    -- the dollars to lock in apply to a gap with a prediction-market leg; bookmakers publish no limit (founder 2026-11-08)
    continue when c.min_liq is not null and coalesce((g->>'hasPm')::boolean, true) and coalesce((g->>'stake')::numeric, 0) < c.min_liq;
    continue when not coalesce((g->>'started')::boolean, false);   -- before the start the 30-s engine covers it
    -- founder 2026-11-10: every price in a signal is true when it is sent. The worker computed the row at most live_fresh ago;
    -- every leg was read at most 3 s before that; a BOOKMAKER leg was set by the book after the latest score change on the
    -- board (a price from before the game / set ended is about to be re-priced); the worker's own checks came back empty.
    continue when (g->>'computedAt') is null or (g->>'computedAt')::timestamptz < now() - c.live_fresh;
    continue when jsonb_array_length(coalesce(g->'legs', '[]'::jsonb)) < 2;
    continue when exists (select 1 from jsonb_array_elements(g->'legs') l
                           where (l->>'checkedAt') is null
                              or (l->>'checkedAt')::timestamptz < (g->>'computedAt')::timestamptz - interval '3 seconds');
    continue when exists (select 1 from jsonb_array_elements(g->'legs') l
                           where l->>'group' = 'book' and ((l->>'setAt') is null or (g->>'scoreAt') is null
                                                           or (l->>'setAt')::timestamptz < (g->>'scoreAt')::timestamptz));
    continue when jsonb_array_length(coalesce(g->'checks', '[]'::jsonb)) > 0;
    -- founder 2026-11-12: both 11 Nov signals priced Bet105 from the stream worker's backlog (~2 min behind Kibl). A Bet105
    -- leg needs the worker's stream position (fixture 0 / player 0) written within live_fresh and at most live_stream_lag
    -- behind Kibl when it was written — read HERE, at send time, not trusted from the worker's row.
    continue when exists (select 1 from jsonb_array_elements(g->'legs') l where l->>'venue' = 'Bet105')
              and not exists (select 1 from public.kibl_live_ml s
                               where s.fixture_id = 0 and s.fixture_participant_id = 0
                                 and s.received_at >= now() - c.live_fresh
                                 and s.received_at - s.kibl_inserted_on <= c.live_stream_lag);
    -- only when there is time to place both bets (founder 2026-11-03): the live score board shows the game at 0–0 — a new
    -- game (the serve changes), a changeover (players sit, after an odd game) or a set break — never during points;
    -- and never on a match the board or api-tennis says is over or not being played (walkover, retirement …)
    continue when coalesce(g->>'phase', '') not in ('game', 'changeover', 'set');
    continue when arb.fixture_closed(g->>'boardStatus', null);
    -- ATP tour only: a Kalshi ATP event, or an odds-api.io ATP singles event the worker marks atp (never Challenger)
    continue when not (coalesce(g->>'kalshiEvent', '') like 'KXATPMATCH-%' or coalesce((g->>'atp')::boolean, false));
    -- founder 2026-11-09: arbitrage = Polymarket, Kalshi, Bet105 only; a gap with any other leg (a worker still on the
    -- old book list) is never sent
    continue when exists (select 1 from jsonb_array_elements(coalesce(g->'legs', '[]'::jsonb)) l
                           where coalesce(l->>'venue', '') not in ('Polymarket', 'Kalshi', 'Bet105'));
    k := 'live|' || coalesce(g->>'mkey', g->>'kalshiEvent') || '|' || (g->>'dir');
    continue when exists (select 1 from arb.alerts where akey = k and created_at > now() - c.live_cooldown);
    msg := arb.render_live(g); rid := arb.send(msg, 'live');
    insert into arb.alerts (kind, akey, event_key, detail, message, net_request_id, sent_at, delivery)
    values ('live', k, 0, g, msg, rid, case when rid is not null then now() end,
            case when rid is null then 'unsent: no vault secret' else 'queued' end);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.arb_live_push(jsonb) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.arb_live_push(jsonb) from anon, authenticated';
    execute 'grant execute on function public.arb_live_push(jsonb) to service_role';
  end if;
end $$;

create or replace function arb.report(p_hours integer default 24) returns jsonb
language plpgsql stable as $$
declare o jsonb; cj jsonb;
begin
  o := arb.opps();
  begin
    execute 'select to_jsonb(x) from (select jobname, schedule, active from cron.job where jobname = ''arb-engine'') x' into cj;
  exception when others then cj := null;
  end;
  return jsonb_build_object('config', (select to_jsonb(c) - 'id' from arb.config c),
    'matchesWithFair', jsonb_array_length(o->'fair'),
    'quotesBySource', (select jsonb_object_agg(s, n) from (select x->>'source' s, count(*) n from jsonb_array_elements(o->'fair') f,
                         jsonb_array_elements(f->'sources') x group by 1) z),
    'divergencesNow', jsonb_array_length(o->'divergences'), 'arbsNow', jsonb_array_length(o->'arbs'),
    'alerts', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select kind || ' · ' || delivery k, count(*) n from arb.alerts
                where created_at > now() - make_interval(hours => p_hours) group by 1) a),
    'cron', cj,
    'live', (select jsonb_build_object('at', at, 'gaps', jsonb_array_length(gaps), 'worker', worker) from arb.live_state));
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all functions in schema arb from public, anon, authenticated';
  end if;
end $$;
