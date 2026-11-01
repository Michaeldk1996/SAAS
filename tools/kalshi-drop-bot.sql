-- KALSHI recorder + dropping-odds bot (founder 2026-11-01: "build what's possible for Kalshi, do the same as Polymarket").
-- Source: Kalshi's PUBLIC market-data API (no key, no account): GET
--   https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXATPMATCH&status=open
-- = every open ATP match-winner market (ATP main draw + ATP qualifying; one market per player: "X wins", Yes/No).
-- Measured 1 Nov 2026: 54 open markets (27 matches) in one call; fields yes_ask_dollars (the price to back the player),
-- yes_ask_size_fp (contracts offered at it), volume_fp (contracts traded), open_interest_fp, updated_time.
-- Idempotent; safe to re-run. Schedules NOTHING: the two pg_cron jobs are an explicit step of kalshi-drops.yml.
--
-- Recorder (kalshi_rec): every 30 s ingest the last answer, keep one tick per CHANGE of a market's state, fire the next
-- call. Price time = Kalshi's own updated_time; known_at = when our answer arrived.
-- Bot (kalshi_bot) = the Polymarket bot's rules (tools/poly-drop-bot.sql):
--   >= 5% drop of the DECIMAL price (1 / yes_ask) vs 10 min earlier · 30-min cooldown per match · >= $100 at the price
--   before AND after (dollars = contracts offered × price; config.min_depth, NULL = none) · ATP only (drops_scope) ·
--   never after the live start: the cut = the earlier of our live-flip sighting (live_flip_log, joined on both surnames
--   + initials, exactly one) and the api-tennis fixture's scheduled start (kalshi_bot.match_fx; a scheduled time only
--   ever STOPS a feed early). Kalshi's own occurrence / expiration times are LISTING placeholders, never a start
--   (measured 1 Nov 2026: every 2-Nov Paris match read occurrence = expiration = 1 Nov 13:00Z; api-tennis 2 Nov 09:00Z).
--   Header "🟣 KALSHI DROP". Traded = both players' markets' contracts traded, live from the recorder (a contract pays
--   $1). Match-winner liquidity = the whole order book of both markets, in dollars, from the pipeline
--   (tools/kalshi-volume.mjs → public.kalshi_book_ingest), "—" without one.
-- Telegram: the drop chat, through the Superbet bot's Vault names.
create schema if not exists kalshi_rec;
create schema if not exists kalshi_bot;
revoke all on schema kalshi_rec from public;
revoke all on schema kalshi_bot from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema kalshi_rec from anon, authenticated';
    execute 'revoke all on schema kalshi_bot from anon, authenticated';
  end if;
end $$;

create table if not exists kalshi_rec.config (
    id      boolean primary key default true check (id),
    series  text not null default 'KXATPMATCH',
    base    text not null default 'https://api.elections.kalshi.com/trade-api/v2'
);
insert into kalshi_rec.config (id) values (true) on conflict (id) do nothing;

create table if not exists kalshi_rec.requests (
    id            bigint primary key,
    fired_at      timestamptz not null default now(),
    processed_at  timestamptz,
    status_code   integer,
    n_items       integer,
    note          text
);
create index if not exists krequests_open_idx on kalshi_rec.requests (processed_at) where processed_at is null;

create table if not exists kalshi_rec.markets (
    ticker         text primary key,
    event_ticker   text not null,
    player         text,
    occurrence_at  timestamptz,
    status         text,
    first_seen     timestamptz not null default now(),
    last_seen      timestamptz not null default now()
);
create index if not exists kmarkets_event_idx on kalshi_rec.markets (event_ticker);

create table if not exists kalshi_rec.ticks (
    id            bigserial primary key,
    ticker        text not null,
    event_ticker  text not null,
    yes_ask       numeric,          -- dollars per contract (0.01 … 0.99) to back the player
    yes_ask_size  numeric,          -- contracts offered at that price
    yes_bid       numeric,
    yes_bid_size  numeric,
    volume        numeric,          -- contracts traded, this market
    open_interest numeric,
    status        text,
    updated_at    timestamptz,      -- Kalshi's updated_time
    seen_at       timestamptz not null,
    state_md5     text not null
);
create unique index if not exists kticks_state_uq on kalshi_rec.ticks (ticker, updated_at, state_md5) nulls not distinct;
create index if not exists kticks_ticker_idx on kalshi_rec.ticks (ticker, updated_at);
create index if not exists kticks_seen_idx on kalshi_rec.ticks (seen_at);

create or replace function kalshi_rec.num(p text) returns numeric
language plpgsql immutable as $$
begin
  return nullif(btrim(p), '')::numeric;
exception when others then
  return null;
end $$;

-- ingest one answer body (the markets list); returns the ticks written
create or replace function kalshi_rec.ingest(p_body jsonb, p_seen timestamptz) returns integer
language plpgsql as $$
declare m jsonb; n integer := 0; k integer;
begin
  for m in select * from jsonb_array_elements(coalesce(p_body->'markets', '[]'::jsonb)) loop
    continue when coalesce(m->>'ticker', '') = '' or coalesce(m->>'event_ticker', '') = '';
    insert into kalshi_rec.markets (ticker, event_ticker, player, occurrence_at, status, first_seen, last_seen)
    values (m->>'ticker', m->>'event_ticker', nullif(m->>'yes_sub_title', ''),
            nullif(m->>'occurrence_datetime', '')::timestamptz, m->>'status', p_seen, p_seen)
    on conflict (ticker) do update set player = coalesce(excluded.player, kalshi_rec.markets.player),
           occurrence_at = coalesce(excluded.occurrence_at, kalshi_rec.markets.occurrence_at),
           status = excluded.status, last_seen = excluded.last_seen;
    insert into kalshi_rec.ticks (ticker, event_ticker, yes_ask, yes_ask_size, yes_bid, yes_bid_size, volume, open_interest,
                                  status, updated_at, seen_at, state_md5)
    values (m->>'ticker', m->>'event_ticker', kalshi_rec.num(m->>'yes_ask_dollars'), kalshi_rec.num(m->>'yes_ask_size_fp'),
            kalshi_rec.num(m->>'yes_bid_dollars'), kalshi_rec.num(m->>'yes_bid_size_fp'), kalshi_rec.num(m->>'volume_fp'),
            kalshi_rec.num(m->>'open_interest_fp'), m->>'status', nullif(m->>'updated_time', '')::timestamptz, p_seen,
            md5(concat_ws('|', m->>'yes_ask_dollars', m->>'yes_ask_size_fp', m->>'yes_bid_dollars', m->>'yes_bid_size_fp',
                               m->>'volume_fp', m->>'status')))
    on conflict do nothing;
    get diagnostics k = row_count; n := n + k;
  end loop;
  return n;
end $$;

-- pg_cron every 30 s: ingest finished answers, keep 14 days, fire the next call (one in flight at most).
create or replace function kalshi_rec.tick() returns integer
language plpgsql as $$
declare r record; n integer := 0; k integer; cfg kalshi_rec.config; rid bigint;
begin
  if not pg_try_advisory_xact_lock(288289) then return 0; end if;
  for r in select q.id, h.status_code, h.content, h.error_msg, h.created from kalshi_rec.requests q
             join net._http_response h on h.id = q.id where q.processed_at is null loop
    k := null;
    if r.status_code = 200 then
      begin k := kalshi_rec.ingest(r.content::jsonb, coalesce(r.created, now()));
      exception when others then k := null; end;
    end if;
    update kalshi_rec.requests set processed_at = now(), status_code = r.status_code, n_items = k,
           note = case when r.status_code = 200 and k is null then 'unreadable body'
                       when r.status_code is distinct from 200 then left(coalesce(r.error_msg, 'HTTP ' || r.status_code), 300) end
     where id = r.id;
    n := n + coalesce(k, 0);
  end loop;
  update kalshi_rec.requests set processed_at = now(), note = 'no response'
   where processed_at is null and fired_at < now() - interval '3 minutes';
  delete from kalshi_rec.ticks where seen_at < now() - interval '14 days';
  delete from kalshi_rec.requests where fired_at < now() - interval '2 days';
  if not exists (select 1 from kalshi_rec.requests where processed_at is null and fired_at > now() - interval '60 seconds') then
    select * into cfg from kalshi_rec.config;
    select net.http_get(url := cfg.base || '/markets?series_ticker=' || cfg.series || '&status=open&limit=1000',
                        timeout_milliseconds := 20000) into rid;
    insert into kalshi_rec.requests (id) values (rid);
  end if;
  return n;
end $$;

-- ── the bot ──
create table if not exists kalshi_bot.config (
    id          boolean primary key default true check (id),
    book        text    not null default 'Kalshi',
    threshold   numeric not null default 5,
    win         interval not null default interval '10 minutes',
    cooldown    interval not null default interval '30 minutes',
    min_depth   numeric default 100
);
insert into kalshi_bot.config (id) values (true) on conflict (id) do nothing;

create table if not exists kalshi_bot.alerts (
    id              bigserial primary key,
    mode            text        not null check (mode in ('live', 'backtest', 'selftest')),
    run_id          text,
    book            text        not null,
    threshold       numeric     not null,
    event_ticker    text        not null,
    ticker          text        not null,
    tier            text,
    player_a        text,
    player_b        text,
    side_player     text,
    eval_at         timestamptz not null,
    ref_price       numeric,
    ref_at          timestamptz,
    ref_depth       numeric,
    cur_price       numeric,
    cur_at          timestamptz,
    cur_depth       numeric,
    pct_10m         numeric,
    open_price      numeric,
    open_at         timestamptz,
    contracts       numeric,               -- both markets' contracts traded at the drop (live, from the recorder)
    market_liq      numeric,               -- whole order book of both markets, dollars (pipeline); NULL = none
    market_liq_at   timestamptz,
    message         text,
    net_request_id  bigint,
    sent_at         timestamptz,
    move_delay_s    numeric,
    delivery        text        not null default 'unsent',
    created_at      timestamptz not null default now()
);
create index if not exists kalerts_cooldown_idx on kalshi_bot.alerts (mode, run_id, book, event_ticker, eval_at);

create table if not exists kalshi_bot.book (            -- per match, from the pipeline
    event_ticker  text primary key,
    liquidity     numeric,
    contracts     numeric,
    fetched_at    timestamptz not null default now()
);
create table if not exists kalshi_bot.events (
    id              bigserial primary key,
    kind            text        not null,
    detail          jsonb,
    net_request_id  bigint,
    delivery        text        not null default 'unsent',
    created_at      timestamptz not null default now()
);
alter table kalshi_rec.requests enable row level security;
alter table kalshi_rec.markets enable row level security;
alter table kalshi_rec.ticks enable row level security;
alter table kalshi_rec.config enable row level security;
alter table kalshi_bot.alerts enable row level security;
alter table kalshi_bot.book enable row level security;
alter table kalshi_bot.events enable row level security;
alter table kalshi_bot.config enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema kalshi_rec from anon, authenticated';
    execute 'revoke all on all tables in schema kalshi_bot from anon, authenticated';
  end if;
end $$;

create or replace function kalshi_bot.px(p numeric) returns text
language sql immutable as $$ select regexp_replace(regexp_replace(to_char(p, 'FM9990.000'), '0+$', ''), '\.$', '') $$;
create or replace function kalshi_bot.usd(p numeric) returns text
language sql immutable as $$ select case when p is null then '—' else '$' || to_char(round(p), 'FM999,999,999,990') end $$;
create or replace function kalshi_bot.cnt(p numeric) returns text
language sql immutable as $$ select case when p is null then '—' else to_char(round(p), 'FM999,999,999,990') end $$;
create or replace function kalshi_bot.hhmm(p timestamptz) returns text
language sql immutable as $$ select to_char(p at time zone 'UTC', 'HH24:MI') || ' UTC' $$;
create or replace function kalshi_bot.spct(p numeric) returns text
language sql immutable as $$
  select case when round(p, 1) = 0 then '0.0%' when p < 0 then '−' || to_char(abs(round(p, 1)), 'FM9990.0') || '%'
              else '+' || to_char(round(p, 1), 'FM9990.0') || '%' end
$$;
create or replace function kalshi_bot.moved(p_secs numeric) returns text
language sql immutable as $$
  select case when p_secs is null then '—' when p_secs < 60 then 'just now' else floor(p_secs / 60)::int || ' min ago' end
$$;

-- one row per match: the two players (the two markets of the event, in ticker order) and the scheduled time
create or replace view kalshi_bot.matches as
  select event_ticker, min(player) filter (where rn = 1) player_a, min(player) filter (where rn = 2) player_b,
         min(occurrence_at) occurrence_at, count(*) n_markets
    from (select m.*, row_number() over (partition by event_ticker order by ticker) rn from kalshi_rec.markets m) x
   group by event_ticker;

-- each Kalshi match → ONE api-tennis fixture: both surnames + initials, either order, the fixture starting within
-- [occurrence − 24 h, occurrence + 72 h] (Kalshi's occurrence is the listing time, a day or more before the match),
-- exactly one candidate both ways. Its start is the match's start everywhere (the cut, the ATP scope, the arb engine).
create or replace view kalshi_bot.match_fx as
  with j as (
    select m.event_ticker, f.event_key, f.start_utc, f.first_player, f.second_player
      from kalshi_bot.matches m join drops_scope.fixture f
        on ((drops_scope.same(m.player_a, f.first_player) and drops_scope.same(m.player_b, f.second_player))
         or (drops_scope.same(m.player_a, f.second_player) and drops_scope.same(m.player_b, f.first_player)))
       and f.start_utc between m.occurrence_at - interval '24 hours' and m.occurrence_at + interval '72 hours'
     where m.n_markets = 2 and position('/' in coalesce(f.first_player, '') || coalesce(f.second_player, '')) = 0
  )
  select j.* from j
   where (select count(*) from j x where x.event_ticker = j.event_ticker) = 1
     and (select count(*) from j x where x.event_key = j.event_key) = 1;

-- the live-start cut per match: the earlier of our live-flip sighting (exactly one, both surnames + initials, within
-- 24 h of the schedule) and Kalshi's scheduled occurrence time.
create or replace function kalshi_bot.cuts(p_from timestamptz) returns table(event_ticker text, cut_at timestamptz)
language plpgsql stable as $$
begin
  return query
  with ev as (
    select m.event_ticker, m.player_a, m.player_b, x.start_utc occurrence_at, drops_live.sk(m.player_a) h, drops_live.sk(m.player_b) a
      from kalshi_bot.matches m join kalshi_bot.match_fx x using (event_ticker) where x.start_utc >= p_from
  ), fl as (select * from drops_live.flips(p_from - interval '1 day')),
  j as (
    select ev.event_ticker, fl.event_key, fl.live_at from ev join fl on fl.k1 = ev.h and fl.k2 = ev.a
     where drops_live.ini_ok(fl.p1, ev.player_a) and drops_live.ini_ok(fl.p2, ev.player_b) and abs(extract(epoch from fl.live_at - ev.occurrence_at)) < 86400
    union
    select ev.event_ticker, fl.event_key, fl.live_at from ev join fl on fl.k1 = ev.a and fl.k2 = ev.h
     where drops_live.ini_ok(fl.p1, ev.player_b) and drops_live.ini_ok(fl.p2, ev.player_a) and abs(extract(epoch from fl.live_at - ev.occurrence_at)) < 86400
  ), one as (select j.event_ticker, min(j.live_at) live_at from j group by j.event_ticker having count(distinct j.event_key) = 1)
  select ev.event_ticker, least(ev.occurrence_at, one.live_at) from ev left join one using (event_ticker);
end $$;

-- LOAD price CHANGES (decimal = 1 / yes_ask, 3 dp) with the dollars at that price, cut at the live start.
create or replace function kalshi_bot.load_ticks(p_from timestamptz, p_to timestamptz) returns integer
language plpgsql as $$
declare n integer;
begin
  drop table if exists pg_temp.tk;
  create temp table tk as
  with raw as (
    select t.event_ticker, t.ticker, round(1 / t.yes_ask, 3) price, round(t.yes_ask_size * t.yes_ask, 2) depth,
           coalesce(t.updated_at, t.seen_at) at, t.seen_at known_at
      from kalshi_rec.ticks t
     where t.status = 'active' and t.yes_ask > 0 and t.yes_ask < 1
       and coalesce(t.updated_at, t.seen_at) between p_from and p_to and t.seen_at <= p_to
  ), ordered as (select *, lag(price) over (partition by ticker order by at, known_at) prev_price from raw)
  select event_ticker, ticker, price, depth, at, known_at from ordered where prev_price is distinct from price and price >= 1.01;
  create index on tk (ticker, at);
  drop table if exists pg_temp.kcut;
  create temp table kcut as select * from kalshi_bot.cuts(greatest(p_from, p_to - interval '4 days') - interval '2 days');
  delete from pg_temp.tk t using pg_temp.kcut c where t.event_ticker = c.event_ticker and t.at >= c.cut_at;
  select count(*) into n from tk;
  return n;
end $$;

create or replace function kalshi_bot.render(a kalshi_bot.alerts, p_at timestamptz) returns text
language sql stable as $$
  select concat_ws(chr(10),
    '🟣 KALSHI DROP',
    '',
    format('🎾 Match: %s vs %s (%s)', coalesce(a.player_a, '—'), coalesce(a.player_b, '—'), coalesce(a.tier, '—')),
    format('🎯 Line: Match Winner – %s', coalesce(a.side_player, '—')),
    case when a.open_price is null then '🟣 Opening: —'
         else format('🟣 Opening: %s @ %s (first seen)', kalshi_bot.px(a.open_price), kalshi_bot.hhmm(a.open_at)) end,
    format('🟠 Pre-drop: %s @ %s', kalshi_bot.px(a.ref_price), kalshi_bot.hhmm(a.ref_at)),
    format('🔴 Odds now: %s @ %s', kalshi_bot.px(a.cur_price), kalshi_bot.hhmm(a.cur_at)),
    format('📉 Drop (10 min): −%s%%', to_char(round((a.ref_price - a.cur_price) / a.ref_price * 100, 1), 'FM9990.0')),
    case when a.open_price is null then '➡️ Since open: —'
         else format('%s Since open: %s',
                case sign(round((a.cur_price - a.open_price) / a.open_price * 100, 1)) when 1 then '↗️' when -1 then '↘️' else '➡️' end,
                kalshi_bot.spct((a.cur_price - a.open_price) / a.open_price * 100)) end,
    format('💧 Liquidity at price: %s → %s', kalshi_bot.usd(a.ref_depth), kalshi_bot.usd(a.cur_depth)),
    format('📊 Traded on match: %s contracts ($1 each)', kalshi_bot.cnt(a.contracts)),
    case when a.market_liq is null then '📚 Match-winner liquidity: —'
         else format('📚 Match-winner liquidity: %s (as of %s)', kalshi_bot.usd(a.market_liq), kalshi_bot.hhmm(a.market_liq_at)) end,
    format('⏱️ Moved: %s', kalshi_bot.moved(extract(epoch from (p_at - a.cur_at))::numeric)),
    format('🏦 Bookmaker: %s', a.book))
$$;

create or replace function kalshi_bot.scan(p_from timestamptz, p_to timestamptz, p_threshold numeric, p_mode text, p_run text,
    p_window interval, p_cooldown interval, p_min_depth numeric) returns integer
language plpgsql as $$
declare
  e timestamptz := case when p_from = p_to then p_from else date_trunc('minute', p_from) end;
  n integer := 0; c record; mt record; op record; aid bigint; cfg kalshi_bot.config; vol numeric; bk record;
begin
  select * into cfg from kalshi_bot.config;
  while e <= p_to loop
    for c in
      with cur as (
        select distinct on (ticker) event_ticker, ticker, price cur_price, depth cur_depth, at cur_at
          from pg_temp.tk
         where known_at <= e and at <= e and at > e - p_window
           and not exists (select 1 from pg_temp.kcut x where x.event_ticker = tk.event_ticker and x.cut_at <= e)
         order by ticker, at desc, known_at desc
      )
      select cur.*, r.price ref_price, r.depth ref_depth, r.at ref_at, round((r.price - cur.cur_price) / r.price * 100, 2) pct_10m
        from cur cross join lateral (
          select x.price, x.depth, x.at from pg_temp.tk x
           where x.ticker = cur.ticker and x.at <= e - p_window and x.known_at <= e order by x.at desc, x.known_at desc limit 1) r
       where (r.price - cur.cur_price) / r.price * 100 >= p_threshold
         and (p_min_depth is null or (coalesce(cur.cur_depth, 0) >= p_min_depth and coalesce(r.depth, 0) >= p_min_depth))
       order by pct_10m desc, ticker
    loop
      if exists (select 1 from kalshi_bot.alerts a where a.mode = p_mode and a.run_id is not distinct from p_run
                   and a.book = cfg.book and a.threshold = p_threshold and a.event_ticker = c.event_ticker
                   and a.eval_at > e - p_cooldown) then
        continue;
      end if;
      select * into mt from kalshi_bot.matches m where m.event_ticker = c.event_ticker;
      select price, at into op from pg_temp.tk where ticker = c.ticker and known_at <= e order by at asc limit 1;
      select sum(v) into vol from (select distinct on (t.ticker) t.volume v from kalshi_rec.ticks t
                                    where t.event_ticker = c.event_ticker and t.seen_at <= e order by t.ticker, t.seen_at desc) s;
      select * into bk from kalshi_bot.book b where b.event_ticker = c.event_ticker and b.fetched_at > e - interval '6 hours';
      insert into kalshi_bot.alerts (mode, run_id, book, threshold, event_ticker, ticker, tier, player_a, player_b, side_player,
          eval_at, ref_price, ref_at, ref_depth, cur_price, cur_at, cur_depth, pct_10m, open_price, open_at, contracts,
          market_liq, market_liq_at)
      values (p_mode, p_run, cfg.book, p_threshold, c.event_ticker, c.ticker, 'ATP', mt.player_a, mt.player_b,
          (select player from kalshi_rec.markets where ticker = c.ticker),
          e, c.ref_price, c.ref_at, c.ref_depth, c.cur_price, c.cur_at, c.cur_depth, c.pct_10m, op.price, op.at, vol,
          bk.liquidity, bk.fetched_at)
      returning id into aid;
      update kalshi_bot.alerts set message = kalshi_bot.render(alerts, e) where id = aid;
      n := n + 1;
    end loop;
    e := e + interval '1 minute';
  end loop;
  return n;
end $$;

create or replace function kalshi_bot.send(p_text text) returns bigint
language plpgsql as $$
declare tok text; chat text;
begin
  select decrypted_secret into tok  from vault.decrypted_secrets where name = 'ten287_telegram_bot_token';
  select decrypted_secret into chat from vault.decrypted_secrets where name = 'ten287_telegram_chat_id';
  if tok is null or chat is null then return null; end if;
  return net.http_post(
    url     := 'https://api.telegram.org/bot' || btrim(tok) || '/sendMessage',
    body    := jsonb_build_object('chat_id', btrim(chat), 'text', p_text, 'disable_web_page_preview', true),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000);
end $$;

create or replace function kalshi_bot.settle() returns void
language plpgsql as $$
begin
  update kalshi_bot.alerts a set delivery = case when r.status_code between 200 and 299 then 'sent'
                                                 else 'failed: ' || coalesce('HTTP ' || r.status_code, r.error_msg, 'no response') end
    from net._http_response r where a.delivery = 'queued' and r.id = a.net_request_id;
  update kalshi_bot.events v set delivery = case when r.status_code between 200 and 299 then 'sent'
                                                 else 'failed: ' || coalesce('HTTP ' || r.status_code, r.error_msg, 'no response') end
    from net._http_response r where v.delivery = 'queued' and r.id = v.net_request_id;
end $$;

-- ATP-only posting scope: the drops_scope verdict, as every other bot.
create or replace function drops_scope.on_kalshi_alert() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare st timestamptz; v text;
begin
  if new.mode <> 'live' or new.delivery <> 'unsent' then return new; end if;
  begin
    select x.start_utc into st from kalshi_bot.match_fx x where x.event_ticker = new.event_ticker;
  exception when others then st := null;
  end;
  v := drops_scope.apply('kalshi', new.id, new.player_a, new.player_b, st, new.eval_at, false);
  if v <> 'post' then new.delivery := v; end if;
  return new;
end $$;
drop trigger if exists drops_scope_scope on kalshi_bot.alerts;
create trigger drops_scope_scope before insert on kalshi_bot.alerts
  for each row execute function drops_scope.on_kalshi_alert();

create or replace function kalshi_bot.recheck() returns integer
language plpgsql as $$
declare r record; v text; n integer := 0; st timestamptz;
begin
  for r in select a.id, a.player_a, a.player_b, a.eval_at, a.event_ticker from kalshi_bot.alerts a
            where a.mode = 'live' and a.eval_at > now() - interval '30 minutes'
              and a.delivery in ('held: no api-tennis fixture', 'held: no api-tennis fixture (fixture list stale)', 'held: scope check failed') loop
    select x.start_utc into st from kalshi_bot.match_fx x where x.event_ticker = r.event_ticker;
    v := drops_scope.apply('kalshi', r.id, r.player_a, r.player_b, st, r.eval_at, true);
    update kalshi_bot.alerts set delivery = case when v = 'post' then 'unsent' else v end where id = r.id and delivery like 'held:%';
    if v = 'post' then n := n + 1; end if;
  end loop;
  return n;
end $$;

create or replace function kalshi_bot.tick() returns integer
language plpgsql as $$
declare e timestamptz := now(); n integer; a kalshi_bot.alerts; rid bigint; v_at timestamptz; msg text; cfg kalshi_bot.config;
begin
  if not pg_try_advisory_xact_lock(288290) then return 0; end if;
  perform kalshi_bot.settle();
  perform kalshi_bot.recheck();
  select * into cfg from kalshi_bot.config;
  perform kalshi_bot.load_ticks(now() - interval '14 days', now());
  n := kalshi_bot.scan(e, e, cfg.threshold, 'live', null, cfg.win, cfg.cooldown, cfg.min_depth);
  for a in select * from kalshi_bot.alerts where mode = 'live' and delivery = 'unsent' order by id limit 10 loop
    v_at := clock_timestamp();
    msg  := kalshi_bot.render(a, v_at);
    rid  := kalshi_bot.send(msg);
    update kalshi_bot.alerts set net_request_id = rid, message = msg, sent_at = case when rid is not null then v_at end,
           move_delay_s = case when rid is not null then round(extract(epoch from (v_at - a.cur_at))::numeric, 3) end,
           delivery = case when rid is null then 'unsent: no vault secret' else 'queued' end
     where id = a.id;
  end loop;
  return n;
end $$;

create or replace function kalshi_bot.startup() returns bigint
language plpgsql as $$
declare rid bigint; msg text;
begin
  perform pg_advisory_xact_lock(288290);
  if exists (select 1 from kalshi_bot.events where kind = 'startup' and delivery <> 'unsent: no vault secret') then return null; end if;
  msg := concat_ws(chr(10),
    '🟣 KALSHI DROP — bot is live (startup test)',
    '',
    'Same rules as Bet105, Superbet and Polymarket: ≥5% drop vs the price 10 min earlier · 30-min cooldown per match · ATP only.',
    'Only when at least $100 waits at the price before and after the drop.',
    'Pre-match men''s singles, match winner. Source: Kalshi''s public API (no key), polled every 30 s.',
    'Decimal odds = 1 ÷ the Kalshi price. Liquidity at price = contracts offered × price. Traded = contracts ($1 each).',
    '🏦 Bookmaker: Kalshi');
  rid := kalshi_bot.send(msg);
  insert into kalshi_bot.events (kind, detail, net_request_id, delivery)
  values ('startup', jsonb_build_object('text', msg), rid, case when rid is null then 'unsent: no vault secret' else 'queued' end);
  return rid;
end $$;

-- The pipeline's writer (service_role only). p_rows = [{event_ticker, liquidity, contracts}].
create or replace function public.kalshi_book_ingest(p_rows jsonb) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare n integer;
begin
  with src as (
    select distinct on (r->>'event_ticker') r->>'event_ticker' ev, nullif(r->>'liquidity', '')::numeric liq,
           nullif(r->>'contracts', '')::numeric con
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r where coalesce(r->>'event_ticker', '') <> '' order by r->>'event_ticker'
  )
  insert into kalshi_bot.book as b (event_ticker, liquidity, contracts, fetched_at)
  select ev, liq, con, now() from src
  on conflict (event_ticker) do update set liquidity = excluded.liquidity, contracts = excluded.contracts, fetched_at = excluded.fetched_at;
  get diagnostics n = row_count;
  delete from kalshi_bot.book where fetched_at < now() - interval '10 days';
  return n;
end $$;
revoke all on function public.kalshi_book_ingest(jsonb) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.kalshi_book_ingest(jsonb) from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.kalshi_book_ingest(jsonb) to service_role';
  end if;
end $$;

create or replace function kalshi_bot.report(p_hours integer default 24) returns jsonb
language plpgsql stable as $$
declare j jsonb; cj jsonb;
begin
  select jsonb_build_object(
    'config', (select to_jsonb(c) - 'id' from kalshi_bot.config c),
    'requests', (select jsonb_build_object('n', count(*), 'ok', count(*) filter (where status_code = 200),
                   'last_ok', max(processed_at) filter (where status_code = 200),
                   'last_items', (select n_items from kalshi_rec.requests where status_code = 200 order by processed_at desc limit 1))
                   from kalshi_rec.requests where fired_at > now() - make_interval(hours => p_hours)),
    'markets', (select count(*) from kalshi_rec.markets where last_seen > now() - interval '1 hour'),
    'matches', (select count(*) from kalshi_bot.matches where n_markets = 2),
    'ticks', (select count(*) from kalshi_rec.ticks where seen_at > now() - make_interval(hours => p_hours)),
    'bookRows', (select count(*) from kalshi_bot.book),
    'delivery', (select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) from (
        select delivery k, count(*) c from kalshi_bot.alerts where mode = 'live' and created_at > now() - make_interval(hours => p_hours) group by 1) z),
    'startup', (select delivery from kalshi_bot.events where kind = 'startup' order by id desc limit 1)) into j;
  begin
    execute 'select jsonb_agg(to_jsonb(x)) from (select jobname, schedule, active from cron.job where jobname in (''kalshi-recorder'', ''kalshi-drop-bot'')) x' into cj;
  exception when others then cj := null;
  end;
  return j || jsonb_build_object('cron', cj);
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all functions in schema kalshi_rec from public, anon, authenticated';
    execute 'revoke all on all functions in schema kalshi_bot from public, anon, authenticated';
  end if;
end $$;
