-- TEN-280 Part B — Bet105 dropping-odds bot (founder brief 2026-09-25, comment 618c03c7).
-- Idempotent; safe to re-run. Installs NOTHING scheduled: the pg_cron job is a
-- separate, explicit step (ten280-steps-live.json), so a backtest install can
-- never start alerts.
--
-- FEED TAP. Reads the Now worker's OUTPUT (kibl_now_history, ATP-fast) and the
-- poller's archive (kibl_line_observations, all men's tiers). It is NOT a
-- consumer of the Kibl RabbitMQ queue — nothing here talks to the broker.
--
-- Private schema: not in PostgREST's exposed schemas, no grant to anon /
-- authenticated, so no browser can read alerts or call the functions.
create schema if not exists ten280_bot;
revoke all on schema ten280_bot from public, anon, authenticated;

create table if not exists ten280_bot.alerts (
    id              bigserial primary key,
    mode            text        not null check (mode in ('live', 'backtest', 'selftest')),
    run_id          text,
    threshold       numeric     not null,
    fixture_id      bigint      not null,
    side_id         integer     not null,
    league_id       integer,
    tier            text,
    player_a        text,
    player_b        text,
    side_player     text,
    eval_at         timestamptz not null,   -- the minute the detector fired (our clock)
    ref_price       numeric,                -- price in force 10 min before eval_at
    ref_at          timestamptz,            -- Kibl insert time of that price
    cur_price       numeric,                -- the dropped-to price
    cur_at          timestamptz,            -- Kibl insert time of the drop
    pct_10m         numeric,                -- (ref - cur) / ref * 100, the trigger
    open_price      numeric,
    open_at         timestamptz,
    open_is_opener  boolean,                -- true only when Kibl flags that row as its opener
    pct_open        numeric,                -- (cur - open) / open * 100, signed
    message         text,
    net_request_id  bigint,
    delivery        text        not null default 'unsent',  -- unsent | queued | sent | failed: ...
    created_at      timestamptz not null default now()
);
create index if not exists alerts_cooldown_idx on ten280_bot.alerts (mode, run_id, fixture_id, eval_at);

create table if not exists ten280_bot.events (          -- startup / test messages, run log
    id              bigserial primary key,
    kind            text        not null,
    detail          jsonb,
    net_request_id  bigint,
    delivery        text        not null default 'unsent',
    created_at      timestamptz not null default now()
);

alter table ten280_bot.alerts enable row level security;
alter table ten280_bot.events enable row level security;
revoke all on all tables in schema ten280_bot from public, anon, authenticated;

-- Surname key for mapping a stream row's side_key onto Kibl's side id when the
-- row_key did not also reach the poller. Last token, lower-case, letters only.
create or replace function ten280_bot.skey(p_name text) returns text
language sql immutable as $$
  select regexp_replace(lower(regexp_replace(coalesce(p_name, ''), '^.*\s', '')), '[^a-z]', '', 'g')
$$;

create or replace function ten280_bot.tier_of(p_league integer) returns text
language sql immutable as $$
  select case p_league when 19 then 'ATP' when 537 then 'Challenger' when 962 then 'ITF Men' end
$$;

-- Price display: Kibl's own decimals, trailing zeros trimmed (1.950 -> 1.95).
create or replace function ten280_bot.px(p numeric) returns text
language sql immutable as $$
  select regexp_replace(regexp_replace(to_char(p, 'FM9990.000'), '0+$', ''), '\.$', '')
$$;

create or replace function ten280_bot.ts(p timestamptz) returns text
language sql immutable as $$
  select to_char(p at time zone 'UTC', 'DD.MM HH24:MI') || ' UTC'
$$;

-- Signed percent with a true minus sign (U+2212), one decimal.
create or replace function ten280_bot.pct(p numeric) returns text
language sql immutable as $$
  select case when p < 0 then '−' || to_char(abs(p), 'FM9990.0') else '+' || to_char(p, 'FM9990.0') end || '%'
$$;

-- LOAD: Bet105 men's-singles pre-match match-winner ticks into pg_temp.t280.
--   poller rows: feed 171, market 1, segment 1, betting type 1, not live, price >= 1.01
--   stream rows: kibl_now_history (pre-match by construction), side mapped via the
--                shared row_key, else the surname key.
-- `at` = Kibl's insert time (the price's own clock). `known_at` = when WE had it
-- (poller observed_at / stream written_at) — the detector never uses a tick
-- before we knew it, so the backtest cannot see the future.
create or replace function ten280_bot.load_ticks(p_from timestamptz, p_to timestamptz) returns integer
language plpgsql as $$
declare n integer;
begin
  drop table if exists pg_temp.t280;
  create temp table t280 as
  with fx as (
    select fixture_id, league_id, player1_name, player2_name
    from public.kibl_fixtures
    where league_id in (19, 537, 962) and player1_name is not null and player2_name is not null
  ),
  poll as (
    select o.fixture_id, o.side_id, o.price_decimal as price, o.inserted_on as at,
           o.observed_at as known_at, coalesce(o.is_opener, false) as is_opener, o.row_key, 'poller'::text as src
    from public.kibl_line_observations o join fx using (fixture_id)
    where o.feed_source_id = 171 and o.market_type_id = 1 and o.segment_id = 1
      and o.betting_type_id = 1 and o.is_live is false and o.price_decimal >= 1.01
      and o.side_id in (2, 3)
      and o.inserted_on between p_from and p_to
  ),
  strm as (
    select h.fixture_id,
           coalesce((select o.side_id from public.kibl_line_observations o where o.row_key = h.row_key limit 1),
                    case when ten280_bot.skey(fx.player1_name) = ten280_bot.skey(fx.player2_name) then null  -- same surname: never guess
                         when h.side_key = ten280_bot.skey(fx.player1_name) then 2
                         when h.side_key = ten280_bot.skey(fx.player2_name) then 3 end) as side_id,
           h.price, h.kibl_inserted_on as at, h.written_at as known_at, false as is_opener, h.row_key, 'stream'::text as src
    from public.kibl_now_history h join fx using (fixture_id)
    where h.price >= 1.01 and h.kibl_inserted_on between p_from and p_to
      and not exists (select 1 from poll p where p.row_key = h.row_key)
  )
  select * from poll
  union all
  select * from strm where side_id in (2, 3);
  create index on t280 (fixture_id, side_id, at);
  create index on t280 (at);
  select count(*) into n from t280;
  return n;
end $$;

-- SCAN: evaluate every minute e in [p_from, p_to] exactly as the live bot does at
-- e — current = the side's latest known price if it was inserted within the
-- window, reference = the latest known price inserted at or before e - window —
-- and record an alert when the reference-to-current drop >= threshold, the
-- current price >= floor, and the match has no alert in the last `cooldown`
-- (same mode + run). Reads pg_temp.t280 (load_ticks, or a self-test's own rows).
-- Returns the number of alerts written.
create or replace function ten280_bot.scan(
    p_from timestamptz, p_to timestamptz, p_threshold numeric, p_mode text, p_run text,
    p_window interval default interval '10 minutes', p_floor numeric default 1.30,
    p_cooldown interval default interval '30 minutes') returns integer
language plpgsql as $$
declare
  e   timestamptz := date_trunc('minute', p_from);
  n   integer := 0;
  c   record;
  op  record;
  fx  record;
  lbl text;
begin
  while e <= p_to loop
    for c in
      with cur as (
        select distinct on (fixture_id, side_id) fixture_id, side_id, price as cur_price, at as cur_at
        from pg_temp.t280
        -- only sides that moved inside the window can have dropped; their latest
        -- known tick is then this in-window one (a later tick would be in it too)
        where known_at <= e and at <= e and at > e - p_window
        order by fixture_id, side_id, at desc
      )
      select cur.*, r.price as ref_price, r.at as ref_at,
             round((r.price - cur.cur_price) / r.price * 100, 2) as pct_10m
      from cur
      cross join lateral (
        select x.price, x.at from pg_temp.t280 x
        where x.fixture_id = cur.fixture_id and x.side_id = cur.side_id
          and x.at <= e - p_window and x.known_at <= e
        order by x.at desc limit 1) r
      where cur.cur_at > e - p_window
        and cur.cur_price >= p_floor
        and (r.price - cur.cur_price) / r.price * 100 >= p_threshold
      order by pct_10m desc, fixture_id, side_id
    loop
      if exists (select 1 from ten280_bot.alerts a
                 where a.mode = p_mode and a.run_id is not distinct from p_run
                   and a.threshold = p_threshold
                   and a.fixture_id = c.fixture_id and a.eval_at > e - p_cooldown) then
        continue;
      end if;
      select price, at, is_opener into op from pg_temp.t280
       where fixture_id = c.fixture_id and side_id = c.side_id and known_at <= e
       order by at asc, is_opener desc limit 1;
      select f.league_id, f.player1_name, f.player2_name into fx
        from public.kibl_fixtures f where f.fixture_id = c.fixture_id;
      lbl := case when op.is_opener then 'opened' else 'first seen' end;
      insert into ten280_bot.alerts (mode, run_id, threshold, fixture_id, side_id, league_id, tier,
          player_a, player_b, side_player, eval_at, ref_price, ref_at, cur_price, cur_at, pct_10m,
          open_price, open_at, open_is_opener, pct_open, message)
      values (p_mode, p_run, p_threshold, c.fixture_id, c.side_id, fx.league_id, ten280_bot.tier_of(fx.league_id),
          fx.player1_name, fx.player2_name,
          case c.side_id when 2 then fx.player1_name when 3 then fx.player2_name end,
          e, c.ref_price, c.ref_at, c.cur_price, c.cur_at, c.pct_10m,
          op.price, op.at, op.is_opener, round((c.cur_price - op.price) / op.price * 100, 2),
          format('%s v %s — %s — Match Winner (%s): %s %s @ %s, dropped to %s (%s in 10 min, from %s) @ %s · since %s: %s · Bet105',
                 coalesce(fx.player1_name, '—'), coalesce(fx.player2_name, '—'),
                 coalesce(ten280_bot.tier_of(fx.league_id), '—'),
                 coalesce(case c.side_id when 2 then fx.player1_name when 3 then fx.player2_name end, '—'),
                 lbl, ten280_bot.px(op.price), ten280_bot.ts(op.at),
                 ten280_bot.px(c.cur_price), ten280_bot.pct(-round(c.pct_10m, 1)), ten280_bot.px(c.ref_price),
                 ten280_bot.ts(c.cur_at),
                 lbl, ten280_bot.pct(round((c.cur_price - op.price) / op.price * 100, 1))));
      n := n + 1;
    end loop;
    e := e + interval '1 minute';
  end loop;
  return n;
end $$;

-- Telegram secrets: Vault, under this bot's own names (never the ops bot's rows).
create or replace function ten280_bot.send(p_text text) returns bigint
language plpgsql as $$
declare tok text; chat text;
begin
  select decrypted_secret into tok  from vault.decrypted_secrets where name = 'ten280_telegram_bot_token';
  select decrypted_secret into chat from vault.decrypted_secrets where name = 'ten280_telegram_chat_id';
  if tok is null or chat is null then
    return null;
  end if;
  return net.http_post(
    url     := 'https://api.telegram.org/bot' || tok || '/sendMessage',
    body    := jsonb_build_object('chat_id', chat, 'text', p_text, 'disable_web_page_preview', true),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000);
end $$;

-- Delivery bookkeeping from pg_net's response table (kept ~6 h by pg_net).
create or replace function ten280_bot.settle() returns void
language plpgsql as $$
begin
  update ten280_bot.alerts a set delivery = case when r.status_code between 200 and 299 then 'sent'
                                                 else 'failed: ' || coalesce('HTTP ' || r.status_code, r.error_msg, 'no response') end
    from net._http_response r
   where a.delivery = 'queued' and r.id = a.net_request_id;
  update ten280_bot.events v set delivery = case when r.status_code between 200 and 299 then 'sent'
                                                 else 'failed: ' || coalesce('HTTP ' || r.status_code, r.error_msg, 'no response') end
    from net._http_response r
   where v.delivery = 'queued' and r.id = v.net_request_id;
end $$;

-- LIVE: one minute. Threshold/window/floor/cooldown are the founder's spec
-- (5% / 10 min / 1.30 / 30 min). Loads 14 days so "first seen" looks far back.
create or replace function ten280_bot.tick() returns integer
language plpgsql as $$
declare e timestamptz := date_trunc('minute', now()); n integer; a record; rid bigint;
begin
  -- one tick at a time: a manual call during a cron run can never double-send
  if not pg_try_advisory_xact_lock(280280) then
    return 0;
  end if;
  perform ten280_bot.settle();
  perform ten280_bot.load_ticks(now() - interval '14 days', now());
  n := ten280_bot.scan(e, e, 5, 'live', null);
  for a in select id, message from ten280_bot.alerts where mode = 'live' and delivery = 'unsent' order by id limit 10 loop  -- Telegram burst cap; the rest go next minute
    rid := ten280_bot.send(a.message);
    update ten280_bot.alerts set net_request_id = rid,
                                 delivery = case when rid is null then 'unsent: no vault secret' else 'queued' end
     where id = a.id;
  end loop;
  return n;
end $$;

revoke all on all functions in schema ten280_bot from public, anon, authenticated;
