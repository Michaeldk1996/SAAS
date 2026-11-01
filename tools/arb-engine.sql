-- ARBITRAGE + DIVERGENCE engine (founder 2026-11-01): every 30 s, the latest price of each source for every upcoming ATP
-- match, after fees, against ONE fair price, and the two-sided arbitrages between sources.
--
-- Fair price (founder): Pinnacle's, read as Bet105 with the margin removed (Bet105 is live through Kibl):
--   p_first = (1/a) / (1/a + 1/b), fair = 1 / p.
-- Sources (each joined to ONE api-tennis fixture of type 'Atp Singles' in drops_scope.fixture — the drop bots' spine —
-- on both surnames + initials and a start within 24 h, exactly one candidate both ways, never a guess):
--   Bet105     sharp       public.kibl_now_card (the Kibl stream), live while the worker heartbeat is <= 180 s old
--   Superbet   soft        ten287_rec (odds-api.io recorder), live while that book's recorder answered within 3 min
--   Polymarket prediction  ten287_rec, same; liquidity = dollars at the best price (odds-api.io depth)
--   Kalshi     prediction  kalshi_rec (public API recorder), live while it answered within 3 min; liquidity = ask × size
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

-- every live quote, one row per (fixture, source): both players' price, effective price, liquidity, time
create or replace function arb.quotes() returns table(event_key bigint, first_player text, second_player text, start_utc timestamptz,
    source text, grp text, p_first numeric, p_second numeric, e_first numeric, e_second numeric, l_first numeric, l_second numeric,
    at timestamptz)
language plpgsql stable as $$
declare c arb.config;
begin
  select * into c from arb.config;
  return query
  with fx as (
    select f.event_key, f.first_player, f.second_player, f.start_utc, drops_scope.sk(f.first_player) k1, drops_scope.sk(f.second_player) k2
      from drops_scope.fixture f
     where f.event_type_type = 'Atp Singles' and f.start_utc > now() and f.start_utc < now() + c.horizon
       and position('/' in coalesce(f.first_player, '') || coalesce(f.second_player, '')) = 0
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
  -- odds-api.io books (shared recorder): the latest ML tick per event and book, live while that book answered lately
  oa as (
    select distinct on (t.event_id, t.book) t.event_id, t.book, t.back_home, t.back_away, t.depth_home, t.depth_away,
           coalesce(t.book_updated_at, t.seen_at) at, e.home, e.away, e.start_at
      from ten287_rec.ticks t join ten287_rec.events e using (event_id)
     where t.market = 'ML' and t.book in ('Superbet', 'Polymarket') and coalesce(t.event_status, e.status) = 'pending'
       and e.start_at > now() - interval '1 hour' and e.start_at < now() + c.horizon
       and exists (select 1 from ten287_rec.requests r where r.book = t.book and r.status_code = 200 and r.processed_at > now() - c.rec_max)
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
    select distinct on (t.ticker) t.ticker, t.event_ticker, t.yes_ask, t.yes_ask_size, coalesce(t.updated_at, t.seen_at) at
      from kalshi_rec.ticks t
     where t.status = 'active' and t.seen_at > now() - interval '1 day'
       and exists (select 1 from kalshi_rec.requests r where r.status_code = 200 and r.processed_at > now() - c.rec_max)
     order by t.ticker, t.seen_at desc
  ),
  kam as (
    select m.event_ticker, m.player_a, m.player_b, m.occurrence_at,
           (select ka.yes_ask from ka join kalshi_rec.markets mk using (ticker) where mk.event_ticker = m.event_ticker and mk.player = m.player_a) qa,
           (select ka.yes_ask * ka.yes_ask_size from ka join kalshi_rec.markets mk using (ticker) where mk.event_ticker = m.event_ticker and mk.player = m.player_a) la,
           (select ka.yes_ask from ka join kalshi_rec.markets mk using (ticker) where mk.event_ticker = m.event_ticker and mk.player = m.player_b) qb,
           (select ka.yes_ask * ka.yes_ask_size from ka join kalshi_rec.markets mk using (ticker) where mk.event_ticker = m.event_ticker and mk.player = m.player_b) lb,
           (select max(ka.at) from ka where ka.event_ticker = m.event_ticker) at
      from kalshi_bot.matches m where m.n_markets = 2 and m.occurrence_at > now() - interval '1 hour'
  ),
  kaj as (
    select fx.event_key, k.event_ticker, k.at,
           case when drops_scope.same(k.player_a, fx.first_player) then k.qa else k.qb end qf,
           case when drops_scope.same(k.player_a, fx.first_player) then k.qb else k.qa end qs,
           case when drops_scope.same(k.player_a, fx.first_player) then k.la else k.lb end lf,
           case when drops_scope.same(k.player_a, fx.first_player) then k.lb else k.la end ls
      from fx join kam k on ((drops_scope.same(k.player_a, fx.first_player) and drops_scope.same(k.player_b, fx.second_player))
                          or (drops_scope.same(k.player_a, fx.second_player) and drops_scope.same(k.player_b, fx.first_player)))
                         and abs(extract(epoch from k.occurrence_at - fx.start_utc)) < 86400
     where k.qa > 0 and k.qa < 1 and k.qb > 0 and k.qb < 1
  ),
  kau as (
    select j.* from kaj j
     where (select count(*) from kaj x where x.event_key = j.event_key) = 1
       and (select count(*) from kaj x where x.event_ticker = j.event_ticker) = 1
  ),
  q as (
    select b.event_key, 'Bet105'::text src, 'sharp'::text g, b.pf, b.ps, null::numeric lf, null::numeric ls, b.at from b105u b
    union all
    select o.event_key, o.book, case o.book when 'Polymarket' then 'prediction' else 'soft' end, o.pf, o.ps,
           case when o.book = 'Polymarket' then o.lf end, case when o.book = 'Polymarket' then o.ls end, o.at from oau o
    union all
    select k.event_key, 'Kalshi', 'prediction', round(1 / k.qf, 3), round(1 / k.qs, 3), round(k.lf, 2), round(k.ls, 2), k.at from kau k
  )
  select fx.event_key, fx.first_player, fx.second_player, fx.start_utc, q.src, q.g, q.pf, q.ps,
         arb.eff(q.src, q.pf), arb.eff(q.src, q.ps), q.lf, q.ls, q.at
    from q join fx using (event_key)
   where q.pf >= 1.01 and q.ps >= 1.01;
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
    select l.event_key, l.first_player, l.second_player, l.start_utc, l.source, l.grp, l.side, l.player, l.price, l.eff, l.liq, l.at,
           case l.side when 'first' then f.ff else f.fs end fair, f.fair_at,
           round((l.eff / case l.side when 'first' then f.ff else f.fs end - 1) * 100, 2) edge
      from liq_ok l join fair f using (event_key)
     where l.source <> 'Bet105' and l.ok and l.eff >= (case l.side when 'first' then f.ff else f.fs end) * (1 + c.div_min / 100)
  ),
  pairs as (
    select a.event_key, a.first_player, a.second_player, a.start_utc,
           a.source sa, a.grp ga, a.price pa, a.eff ea, a.liq la, a.at ta,
           b.source sb, b.grp gb, b.price pb, b.eff eb, b.liq lb, b.at tb,
           round((1 / (1 / a.eff + 1 / b.eff) - 1) * 100, 2) profit,
           round((1 / a.eff) / (1 / a.eff + 1 / b.eff) * 100, 1) stake_a
      from liq_ok a join liq_ok b on b.event_key = a.event_key and a.side = 'first' and b.side = 'second' and a.source <> b.source
     where a.ok and b.ok and a.eff is not null and b.eff is not null
  ),
  best as (
    select distinct on (event_key) * from pairs where profit >= c.arb_min order by event_key, profit desc, sa, sb
  )
  select jsonb_build_object(
    'at', now(),
    'config', jsonb_build_object('arbMin', c.arb_min, 'divMin', c.div_min, 'minLiq', c.min_liq),
    'fair', coalesce((select jsonb_agg(jsonb_build_object('eventKey', f.event_key, 'first', q.first_player, 'second', q.second_player,
                        'start', q.start_utc, 'fairFirst', f.ff, 'fairSecond', f.fs, 'at', f.fair_at,
                        'sources', (select jsonb_agg(jsonb_build_object('source', x.source, 'group', x.grp, 'first', x.p_first, 'second', x.p_second,
                                      'effFirst', x.e_first, 'effSecond', x.e_second, 'liqFirst', x.l_first, 'liqSecond', x.l_second, 'at', x.at)
                                      order by x.grp, x.source) from qt x where x.event_key = f.event_key))
                        order by q.start_utc)
                      from fair f join qt q on q.event_key = f.event_key and q.source = 'Bet105'), '[]'::jsonb),
    'divergences', coalesce((select jsonb_agg(jsonb_build_object('eventKey', event_key, 'first', first_player, 'second', second_player,
                        'start', start_utc, 'source', source, 'group', grp, 'side', side, 'player', player, 'price', price, 'eff', eff,
                        'liq', liq, 'at', at, 'fair', fair, 'fairAt', fair_at, 'edge', edge) order by edge desc) from div), '[]'::jsonb),
    'arbs', coalesce((select jsonb_agg(jsonb_build_object('eventKey', event_key, 'first', first_player, 'second', second_player,
                        'start', start_utc, 'profit', profit, 'stakeFirst', stake_a, 'stakeSecond', round(100 - stake_a, 1),
                        'legFirst', jsonb_build_object('source', sa, 'group', ga, 'price', pa, 'eff', ea, 'liq', la, 'at', ta),
                        'legSecond', jsonb_build_object('source', sb, 'group', gb, 'price', pb, 'eff', eb, 'liq', lb, 'at', tb),
                        'retirementFlag', (ga = 'prediction') <> (gb = 'prediction')) order by profit desc) from best), '[]'::jsonb)
  ) into j;
  return j;
end $$;

-- read-only, for the page (publishable key)
create or replace function public.arb_now() returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$ select arb.opps() $$;
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
create or replace function arb.hhmm(p timestamptz) returns text
language sql immutable as $$ select case when p is null then '—' else to_char(p at time zone 'UTC', 'HH24:MI') || ' UTC' end $$;
create or replace function arb.feeword(p_source text) returns text
language sql immutable as $$ select case when p_source in ('Kalshi', 'Polymarket') then ' (after fee ' else '' end $$;

create or replace function arb.leg(l jsonb, p_player text) returns text
language sql immutable as $$
  select format('✅ Back %s @ %s on %s%s · %s', p_player, arb.px((l->>'price')::numeric), l->>'source',
           case when l->>'source' in ('Kalshi', 'Polymarket') then ' (after fee ' || arb.px((l->>'eff')::numeric) || ')' else '' end,
           case when l->>'group' = 'prediction' then 'liquidity ' || arb.usd((l->>'liq')::numeric) else 'bookmaker' end)
$$;

create or replace function arb.render_arb(a jsonb) returns text
language sql immutable as $$
  select concat_ws(chr(10),
    '⚖️ ARB',
    '',
    format('🎾 Match: %s vs %s (ATP)', a->>'first', a->>'second'),
    arb.leg(a->'legFirst', a->>'first'),
    arb.leg(a->'legSecond', a->>'second'),
    format('💰 Locked-in: +%s%% after fees · stakes %s%% / %s%%', to_char((a->>'profit')::numeric, 'FM990.00'),
           to_char((a->>'stakeFirst')::numeric, 'FM990.0'), to_char((a->>'stakeSecond')::numeric, 'FM990.0')),
    case when (a->>'retirementFlag')::boolean then
      '⚠️ Retirement rules differ: Kalshi / Polymarket pay the player who advances once a ball is played; a bookmaker may void the bet on a retirement.' end,
    format('🕒 Prices: %s @ %s · %s @ %s', a->'legFirst'->>'source', arb.hhmm((a->'legFirst'->>'at')::timestamptz),
           a->'legSecond'->>'source', arb.hhmm((a->'legSecond'->>'at')::timestamptz)))
$$;

create or replace function arb.render_div(d jsonb) returns text
language sql immutable as $$
  select concat_ws(chr(10),
    '📐 DIVERGENCE',
    '',
    format('🎾 Match: %s vs %s (ATP)', d->>'first', d->>'second'),
    format('🎯 %s: %s @ %s%s', d->>'source', d->>'player', arb.px((d->>'price')::numeric),
           case when d->>'source' in ('Kalshi', 'Polymarket') then ' (after fee ' || arb.px((d->>'eff')::numeric) || ')' else '' end),
    format('📏 Fair (Bet105, margin removed): %s → +%s%% above fair', arb.px((d->>'fair')::numeric), to_char((d->>'edge')::numeric, 'FM990.0')),
    case when d->>'group' = 'prediction' then format('💧 Liquidity at price: %s', arb.usd((d->>'liq')::numeric)) end,
    format('🕒 Prices: %s @ %s · Bet105 @ %s', d->>'source', arb.hhmm((d->>'at')::timestamptz), arb.hhmm((d->>'fairAt')::timestamptz)))
$$;

create or replace function arb.send(p_text text) returns bigint
language plpgsql as $$
declare tok text; chat text;
begin
  select decrypted_secret into tok  from vault.decrypted_secrets where name = 'ten287_telegram_bot_token';
  select decrypted_secret into chat from vault.decrypted_secrets where name = 'ten287_telegram_chat_id';
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
  select * into c from arb.config;
  o := arb.opps();
  for x in select * from jsonb_array_elements(o->'arbs') loop
    k := 'arb|' || (x->>'eventKey') || '|' || (x->'legFirst'->>'source') || '+' || (x->'legSecond'->>'source');
    continue when exists (select 1 from arb.alerts where akey = k and created_at > now() - c.cooldown);
    msg := arb.render_arb(x); rid := arb.send(msg);
    insert into arb.alerts (kind, akey, event_key, detail, message, net_request_id, sent_at, delivery)
    values ('arb', k, (x->>'eventKey')::bigint, x, msg, rid, case when rid is not null then now() end,
            case when rid is null then 'unsent: no vault secret' else 'queued' end);
    n := n + 1;
  end loop;
  for x in select * from jsonb_array_elements(o->'divergences') loop
    k := 'divergence|' || (x->>'eventKey') || '|' || (x->>'source') || '|' || (x->>'side');
    continue when exists (select 1 from arb.alerts where akey = k and created_at > now() - c.cooldown);
    msg := arb.render_div(x); rid := arb.send(msg);
    insert into arb.alerts (kind, akey, event_key, detail, message, net_request_id, sent_at, delivery)
    values ('divergence', k, (x->>'eventKey')::bigint, x, msg, rid, case when rid is not null then now() end,
            case when rid is null then 'unsent: no vault secret' else 'queued' end);
    n := n + 1;
  end loop;
  return n;
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
    'cron', cj);
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all functions in schema arb from public, anon, authenticated';
  end if;
end $$;
