-- POLYMARKET dropping-odds bot (founder 2026-11-01, task "telegram-bot-scope" follow-up: "build all of this").
-- Idempotent; safe to re-run. Schedules NOTHING: the pg_cron job is a separate, explicit step in
-- .github/workflows/poly-drops.yml (install), so an install or a test can never start alerts.
--
-- Rules = the Superbet bot's (ten287_bot), founder-ruled for this book:
--   >= 5% drop vs the price 10 min earlier · 30-min cooldown per match · match winner (ML) · pre-match men's singles ·
--   ATP only (the drops_scope BEFORE INSERT trigger below, the same verdict the two other bots get).
-- Polymarket only (founder 2026-11-01):
--   * header "🔵 POLYMARKET DROP" (blue);
--   * liquidity = odds-api.io's depthHome / depthAway: the DOLLARS waiting at the best back price (measured 1 Nov:
--     Halys 348 = 589.78 shares × $0.59 on Polymarket's own CLOB book; Fery 11 ≈ 26 × $0.42);
--   * an alert needs >= config.min_depth dollars at the price BEFORE and AFTER the drop (founder lean, $100; one row,
--     config.min_depth, NULL = no minimum). A drop on a thinner book is never an alert;
--   * total traded on the match = Polymarket's own Gamma API event `volume` (all of the match's markets), written by the
--     pipeline (tools/polymarket-volume.mjs → public.poly_volume_ingest); joined on both surnames + initials + a start
--     within 36 h, exactly one candidate, else "—";
--   * match-winner liquidity = Polymarket's `liquidity` for the match-winner market only: its whole order book, every price,
--     both sides, dollars (founder 2026-11-01). Same join; "—" without one.
-- Clocks: price time = odds-api.io's `updatedAt` for the market (`at`); known_at = when OUR recorder had it (`seen_at`).
-- FEED TAP: reads ten287_rec (the shared odds-api.io recorder) with book = 'Polymarket'. Never writes ten287_rec,
-- ten287_bot or ten280_bot. Telegram: the drop chat, through the Superbet bot's Vault names (same bot, same chat).
create schema if not exists poly_bot;
revoke all on schema poly_bot from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema poly_bot from anon, authenticated'; end if;
end $$;

create table if not exists poly_bot.config (
    id          boolean primary key default true check (id),
    book        text    not null default 'Polymarket',
    threshold   numeric not null default 5,
    win         interval not null default interval '10 minutes',
    cooldown    interval not null default interval '30 minutes',
    min_depth   numeric default 100                 -- dollars at the best back price, before AND after; NULL = none
);
insert into poly_bot.config (id) values (true) on conflict (id) do nothing;

create table if not exists poly_bot.alerts (
    id              bigserial primary key,
    mode            text        not null check (mode in ('live', 'backtest', 'selftest')),
    run_id          text,
    book            text        not null,
    threshold       numeric     not null,
    event_id        bigint      not null,
    side            text        not null check (side in ('home', 'away')),
    tier            text,
    player_a        text,
    player_b        text,
    side_player     text,
    eval_at         timestamptz not null,
    ref_price       numeric,
    ref_at          timestamptz,
    ref_depth       numeric,                -- dollars at the best back price, 10 min before
    cur_price       numeric,
    cur_at          timestamptz,
    cur_depth       numeric,                -- dollars at the best back price, now
    pct_10m         numeric,
    open_price      numeric,
    open_at         timestamptz,
    open_kind       text,
    pct_open        numeric,
    volume          numeric,                -- Polymarket event volume (all markets), dollars; NULL = no confident match
    volume_at       timestamptz,
    market_liq      numeric,                -- the match-winner market's whole order book, dollars; NULL = no confident match
    message         text,
    net_request_id  bigint,
    sent_at         timestamptz,
    move_delay_s    numeric,
    delivery        text        not null default 'unsent',
    created_at      timestamptz not null default now()
);
alter table poly_bot.alerts add column if not exists market_liq numeric;
create index if not exists alerts_cooldown_idx on poly_bot.alerts (mode, run_id, book, event_id, eval_at);

-- Polymarket's own per-match totals, from the pipeline (one row per Polymarket event).
create table if not exists poly_bot.volume (
    slug        text primary key,
    player_a    text,
    player_b    text,
    sk_a        text,
    sk_b        text,
    start_at    timestamptz,
    volume      numeric,
    volume_ml   numeric,
    liquidity   numeric,
    fetched_at  timestamptz not null default now()
);
create index if not exists volume_pair_idx on poly_bot.volume (sk_a, sk_b);

create table if not exists poly_bot.events (          -- startup / test messages
    id              bigserial primary key,
    kind            text        not null,
    detail          jsonb,
    net_request_id  bigint,
    delivery        text        not null default 'unsent',
    created_at      timestamptz not null default now()
);
alter table poly_bot.alerts enable row level security;
alter table poly_bot.events enable row level security;
alter table poly_bot.config enable row level security;
alter table poly_bot.volume enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema poly_bot from anon, authenticated';
  end if;
end $$;

-- "Surname, First" (odds-api.io) → "First Surname"; a name without a comma as written.
create or replace function poly_bot.disp(p text) returns text
language sql immutable as $$
  select case when p like '%, %' then btrim(split_part(p, ', ', 2)) || ' ' || btrim(split_part(p, ', ', 1)) else p end
$$;
create or replace function poly_bot.px(p numeric) returns text
language sql immutable as $$
  select regexp_replace(regexp_replace(to_char(p, 'FM9990.000'), '0+$', ''), '\.$', '')
$$;
create or replace function poly_bot.spct(p numeric) returns text
language sql immutable as $$
  select case when round(p, 1) = 0 then '0.0%'
              when p < 0 then '−' || to_char(abs(round(p, 1)), 'FM9990.0') || '%'
              else '+' || to_char(round(p, 1), 'FM9990.0') || '%' end
$$;
create or replace function poly_bot.usd(p numeric) returns text
language sql immutable as $$
  select case when p is null then '—' else '$' || to_char(round(p), 'FM999,999,999,990') end
$$;
create or replace function poly_bot.hhmm(p timestamptz) returns text
language sql immutable as $$ select to_char(p at time zone 'UTC', 'HH24:MI') || ' UTC' $$;
create or replace function poly_bot.moved(p_secs numeric) returns text
language sql immutable as $$
  select case when p_secs is null then '—' when p_secs < 60 then 'just now' else floor(p_secs / 60)::int || ' min ago' end
$$;

-- Polymarket's total for the match: exactly one volume row whose two surnames and initials are this match's and
-- whose start is within 36 h; anything else is NULL ("—"), never a guess.
create or replace function poly_bot.volume_for(p_a text, p_b text, p_start timestamptz,
    out volume numeric, out volume_at timestamptz, out market_liq numeric)
language plpgsql stable as $$
declare ka text := drops_scope.sk(p_a); kb text := drops_scope.sk(p_b); n integer;
begin
  select count(*), min(v.volume), min(v.fetched_at), min(v.liquidity) into n, volume, volume_at, market_liq
    from poly_bot.volume v
   where ((v.sk_a = ka and v.sk_b = kb) or (v.sk_a = kb and v.sk_b = ka))
     and ((drops_scope.same(p_a, v.player_a) and drops_scope.same(p_b, v.player_b))
       or (drops_scope.same(p_a, v.player_b) and drops_scope.same(p_b, v.player_a)))
     and (p_start is null or v.start_at is null or abs(extract(epoch from (v.start_at - p_start))) < 36 * 3600);
  if n <> 1 then volume := null; volume_at := null; market_liq := null; end if;
end $$;

-- LOAD Polymarket's pre-match ML price CHANGES (with the dollars at that price) into pg_temp.tpoly, cut at each
-- match's live start (drops_live.cuts_287: the same cut the Superbet bot uses; both read ten287_rec.events).
create or replace function poly_bot.load_ticks(p_book text, p_from timestamptz, p_to timestamptz) returns integer
language plpgsql as $$
declare n integer;
begin
  drop table if exists pg_temp.tpoly;
  create temp table tpoly as
  with raw as (
    select t.event_id, s.side, s.price, s.depth, t.book_updated_at as at, t.seen_at as known_at
    from ten287_rec.ticks t
    join ten287_rec.events e using (event_id)
    cross join lateral (values ('home', t.back_home, t.depth_home), ('away', t.back_away, t.depth_away)) s(side, price, depth)
    where t.book = p_book and t.market = 'ML' and e.tier is not null
      and coalesce(t.event_status, e.status) = 'pending'
      and s.price >= 1.01 and t.book_updated_at is not null
      and t.book_updated_at between p_from and p_to and t.seen_at <= p_to
  ),
  ordered as (
    select *, lag(price) over (partition by event_id, side order by at, known_at) as prev_price from raw
  )
  select event_id, side, price, depth, at, known_at from ordered where prev_price is distinct from price;
  create index on tpoly (event_id, side, at);
  drop table if exists pg_temp.cutpoly;
  create temp table cutpoly as select * from drops_live.cuts_287(greatest(p_from, p_to - interval '4 days') - interval '2 days');
  delete from pg_temp.tpoly t using pg_temp.cutpoly c where t.event_id = c.event_id and t.at >= c.cut_at;
  select count(*) into n from tpoly;
  return n;
end $$;

create or replace function poly_bot.render(a poly_bot.alerts, p_at timestamptz) returns text
language sql stable as $$
  select concat_ws(chr(10),
    '🔵 POLYMARKET DROP',
    '',
    format('🎾 Match: %s vs %s (%s)', coalesce(a.player_a, '—'), coalesce(a.player_b, '—'), coalesce(a.tier, '—')),
    format('🎯 Line: Match Winner – %s', coalesce(a.side_player, '—')),
    case when a.open_price is null then '🔵 Opening: —'
         else format('🔵 Opening: %s @ %s (%s)', poly_bot.px(a.open_price), poly_bot.hhmm(a.open_at), a.open_kind) end,
    format('🟠 Pre-drop: %s @ %s', poly_bot.px(a.ref_price), poly_bot.hhmm(a.ref_at)),
    format('🔴 Odds now: %s @ %s', poly_bot.px(a.cur_price), poly_bot.hhmm(a.cur_at)),
    format('📉 Drop (10 min): −%s%%', to_char(round((a.ref_price - a.cur_price) / a.ref_price * 100, 1), 'FM9990.0')),
    case when a.open_price is null then '➡️ Since open: —'
         else format('%s Since open: %s',
                case sign(round((a.cur_price - a.open_price) / a.open_price * 100, 1)) when 1 then '↗️' when -1 then '↘️' else '➡️' end,
                poly_bot.spct((a.cur_price - a.open_price) / a.open_price * 100)) end,
    format('💧 Liquidity at price: %s → %s', poly_bot.usd(a.ref_depth), poly_bot.usd(a.cur_depth)),
    case when a.volume is null then '📊 Traded on match: —'
         else format('📊 Traded on match: %s (as of %s)', poly_bot.usd(a.volume), poly_bot.hhmm(a.volume_at)) end,
    format('📚 Match-winner liquidity: %s', poly_bot.usd(a.market_liq)),
    format('⏱️ Moved: %s', poly_bot.moved(extract(epoch from (p_at - a.cur_at))::numeric)),
    format('🏦 Bookmaker: %s', a.book))
$$;

-- SCAN: the Superbet scan's semantics, plus the liquidity minimum on both prices.
create or replace function poly_bot.scan(p_book text, p_from timestamptz, p_to timestamptz, p_threshold numeric,
    p_mode text, p_run text, p_window interval, p_cooldown interval, p_min_depth numeric) returns integer
language plpgsql as $$
declare
  e   timestamptz := case when p_from = p_to then p_from else date_trunc('minute', p_from) end;
  n   integer := 0;
  c   record; op record; ev record; vo record; aid bigint;
  o_price numeric; o_at timestamptz; o_kind text;
begin
  while e <= p_to loop
    for c in
      with cur as (
        select distinct on (event_id, side) event_id, side, price as cur_price, depth as cur_depth, at as cur_at
        from pg_temp.tpoly
        where known_at <= e and at <= e and at > e - p_window
          and not exists (select 1 from pg_temp.cutpoly x where x.event_id = tpoly.event_id and x.cut_at <= e)
        order by event_id, side, at desc, known_at desc
      )
      select cur.*, r.price as ref_price, r.depth as ref_depth, r.at as ref_at,
             round((r.price - cur.cur_price) / r.price * 100, 2) as pct_10m
      from cur
      cross join lateral (
        select x.price, x.depth, x.at from pg_temp.tpoly x
        where x.event_id = cur.event_id and x.side = cur.side and x.at <= e - p_window and x.known_at <= e
        order by x.at desc, x.known_at desc limit 1) r
      where (r.price - cur.cur_price) / r.price * 100 >= p_threshold
        and (p_min_depth is null or (coalesce(cur.cur_depth, 0) >= p_min_depth and coalesce(r.depth, 0) >= p_min_depth))
      order by pct_10m desc, event_id, side
    loop
      if exists (select 1 from poly_bot.alerts a
                 where a.mode = p_mode and a.run_id is not distinct from p_run and a.book = p_book
                   and a.threshold = p_threshold and a.event_id = c.event_id and a.eval_at > e - p_cooldown) then
        continue;
      end if;
      select e2.home, e2.away, e2.tier, e2.start_at into ev from ten287_rec.events e2 where e2.event_id = c.event_id;
      select case c.side when 'home' then o.open_home else o.open_away end, o.open_at into o_price, o_at
        from ten287_rec.openings o where o.event_id = c.event_id and o.book = p_book and o.status_code = 200;
      if o_price is not null and o_price >= 1.01 and o_at is not null then
        o_kind := 'vendor first record';
      else
        select price, at into op from pg_temp.tpoly
         where event_id = c.event_id and side = c.side and known_at <= e order by at asc limit 1;
        o_price := op.price; o_at := op.at; o_kind := 'first seen';
      end if;
      select * into vo from poly_bot.volume_for(poly_bot.disp(ev.home), poly_bot.disp(ev.away), ev.start_at);
      insert into poly_bot.alerts (mode, run_id, book, threshold, event_id, side, tier, player_a, player_b, side_player,
          eval_at, ref_price, ref_at, ref_depth, cur_price, cur_at, cur_depth, pct_10m, open_price, open_at, open_kind,
          pct_open, volume, volume_at, market_liq)
      values (p_mode, p_run, p_book, p_threshold, c.event_id, c.side, ev.tier,
          poly_bot.disp(ev.home), poly_bot.disp(ev.away),
          poly_bot.disp(case c.side when 'home' then ev.home else ev.away end),
          e, c.ref_price, c.ref_at, c.ref_depth, c.cur_price, c.cur_at, c.cur_depth, c.pct_10m, o_price, o_at, o_kind,
          case when o_price is not null then round((c.cur_price - o_price) / o_price * 100, 2) end,
          vo.volume, vo.volume_at, vo.market_liq)
      returning id into aid;
      update poly_bot.alerts set message = poly_bot.render(alerts, e) where id = aid;
      n := n + 1;
      o_price := null; o_at := null; o_kind := null;
    end loop;
    e := e + interval '1 minute';
  end loop;
  return n;
end $$;

-- Telegram: the drop chat, through the Superbet bot's Vault names (one bot, one chat for every drop alert).
create or replace function poly_bot.send(p_text text) returns bigint
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

create or replace function poly_bot.settle() returns void
language plpgsql as $$
begin
  update poly_bot.alerts a set delivery = case when r.status_code between 200 and 299 then 'sent'
                                               else 'failed: ' || coalesce('HTTP ' || r.status_code, r.error_msg, 'no response') end
    from net._http_response r where a.delivery = 'queued' and r.id = a.net_request_id;
  update poly_bot.events v set delivery = case when r.status_code between 200 and 299 then 'sent'
                                               else 'failed: ' || coalesce('HTTP ' || r.status_code, r.error_msg, 'no response') end
    from net._http_response r where v.delivery = 'queued' and r.id = v.net_request_id;
end $$;

-- ATP-only posting scope: the drops_scope verdict, exactly as the two other bots (tools/drops-scope.sql).
create or replace function drops_scope.on_poly_alert() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare st timestamptz; v text;
begin
  if new.mode <> 'live' or new.delivery <> 'unsent' then return new; end if;
  begin
    select e.start_at into st from ten287_rec.events e where e.event_id = new.event_id;
  exception when others then st := null;
  end;
  v := drops_scope.apply('poly', new.id, new.player_a, new.player_b, st, new.eval_at, false);
  if v <> 'post' then new.delivery := v; end if;
  return new;
end $$;
drop trigger if exists drops_scope_scope on poly_bot.alerts;
create trigger drops_scope_scope before insert on poly_bot.alerts
  for each row execute function drops_scope.on_poly_alert();

-- Rows held only for want of a fixture (or a failed check), for 30 min after the drop: release an ATP one.
create or replace function poly_bot.recheck() returns integer
language plpgsql as $$
declare r record; v text; n integer := 0; st timestamptz;
begin
  for r in select a.id, a.player_a, a.player_b, a.eval_at, a.event_id from poly_bot.alerts a
            where a.mode = 'live' and a.eval_at > now() - interval '30 minutes'
              and a.delivery in ('held: no api-tennis fixture', 'held: no api-tennis fixture (fixture list stale)', 'held: scope check failed') loop
    select e.start_at into st from ten287_rec.events e where e.event_id = r.event_id;
    v := drops_scope.apply('poly', r.id, r.player_a, r.player_b, st, r.eval_at, true);
    update poly_bot.alerts set delivery = case when v = 'post' then 'unsent' else v end
     where id = r.id and delivery like 'held:%';
    if v = 'post' then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- LIVE tick (pg_cron every 30 s).
create or replace function poly_bot.tick() returns integer
language plpgsql as $$
declare e timestamptz := now(); n integer; a poly_bot.alerts; rid bigint; v_at timestamptz; msg text; cfg poly_bot.config;
begin
  if not pg_try_advisory_xact_lock(288288) then return 0; end if;
  perform poly_bot.settle();
  perform poly_bot.recheck();
  select * into cfg from poly_bot.config;
  perform poly_bot.load_ticks(cfg.book, now() - interval '14 days', now());
  n := poly_bot.scan(cfg.book, e, e, cfg.threshold, 'live', null, cfg.win, cfg.cooldown, cfg.min_depth);
  for a in select * from poly_bot.alerts where mode = 'live' and delivery = 'unsent' order by id limit 10 loop
    v_at := clock_timestamp();
    msg  := poly_bot.render(a, v_at);
    rid  := poly_bot.send(msg);
    update poly_bot.alerts set net_request_id = rid, message = msg,
                               sent_at = case when rid is not null then v_at end,
                               move_delay_s = case when rid is not null then round(extract(epoch from (v_at - a.cur_at))::numeric, 3) end,
                               delivery = case when rid is null then 'unsent: no vault secret' else 'queued' end
     where id = a.id;
  end loop;
  return n;
end $$;

-- One-time startup message; a re-install never re-sends it.
create or replace function poly_bot.startup() returns bigint
language plpgsql as $$
declare rid bigint; msg text;
begin
  perform pg_advisory_xact_lock(288288);
  if exists (select 1 from poly_bot.events where kind = 'startup' and delivery <> 'unsent: no vault secret') then
    return null;
  end if;
  msg := concat_ws(chr(10),
    '🔵 POLYMARKET DROP — bot is live (startup test)',
    '',
    'Same rules as Bet105 and Superbet: ≥5% drop vs the price 10 min earlier · 30-min cooldown per match · ATP only.',
    'Only when at least $100 waits at the price before and after the drop.',
    'Pre-match men''s singles, match winner. Source: odds-api.io (Polymarket), polled every 30 s.',
    'Liquidity at price = dollars at the best back price; Match-winner liquidity = that market''s whole order book; Traded = Polymarket''s own total for the match.',
    '🏦 Bookmaker: Polymarket');
  rid := poly_bot.send(msg);
  insert into poly_bot.events (kind, detail, net_request_id, delivery)
  values ('startup', jsonb_build_object('text', msg), rid, case when rid is null then 'unsent: no vault secret' else 'queued' end);
  return rid;
end $$;

-- The pipeline's writer (service_role only). p_rows = [{slug, a, b, start, volume, volume_ml, liquidity}].
create or replace function public.poly_volume_ingest(p_rows jsonb) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare n integer;
begin
  with src as (
    select distinct on (r->>'slug') r->>'slug' slug, r->>'a' a, r->>'b' b,
           nullif(r->>'start', '')::timestamptz st,
           nullif(r->>'volume', '')::numeric vol, nullif(r->>'volume_ml', '')::numeric vml, nullif(r->>'liquidity', '')::numeric liq
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
     where coalesce(r->>'slug', '') <> '' and coalesce(r->>'a', '') <> '' and coalesce(r->>'b', '') <> ''
     order by r->>'slug'
  )
  insert into poly_bot.volume as v (slug, player_a, player_b, sk_a, sk_b, start_at, volume, volume_ml, liquidity, fetched_at)
  select slug, a, b, drops_scope.sk(a), drops_scope.sk(b), st, vol, vml, liq, now() from src
  on conflict (slug) do update set player_a = excluded.player_a, player_b = excluded.player_b, sk_a = excluded.sk_a,
         sk_b = excluded.sk_b, start_at = excluded.start_at, volume = excluded.volume, volume_ml = excluded.volume_ml,
         liquidity = excluded.liquidity, fetched_at = excluded.fetched_at;
  get diagnostics n = row_count;
  delete from poly_bot.volume where fetched_at < now() - interval '10 days';
  return n;
end $$;
revoke all on function public.poly_volume_ingest(jsonb) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.poly_volume_ingest(jsonb) from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.poly_volume_ingest(jsonb) to service_role';
  end if;
end $$;

-- Read-back: counts only, no player data.
create or replace function poly_bot.report(p_hours integer default 24) returns jsonb
language plpgsql stable as $$
declare j jsonb; cj jsonb;
begin
  select jsonb_build_object(
    'config', (select to_jsonb(c) - 'id' from poly_bot.config c),
    'recorderBooks', (select to_jsonb(books) from ten287_rec.config),
    'polymarketTicks', (select count(*) from ten287_rec.ticks where book = 'Polymarket' and seen_at > now() - make_interval(hours => p_hours)),
    'polymarketTicksWithDepth', (select count(*) from ten287_rec.ticks where book = 'Polymarket' and seen_at > now() - make_interval(hours => p_hours)
                                   and depth_home is not null and depth_away is not null),
    'volumeRows', (select count(*) from poly_bot.volume),
    'volumeNewest', (select max(fetched_at) from poly_bot.volume),
    'delivery', (select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) from (
        select delivery k, count(*) c from poly_bot.alerts
         where mode = 'live' and created_at > now() - make_interval(hours => p_hours) group by 1) z),
    'startup', (select delivery from poly_bot.events where kind = 'startup' order by id desc limit 1)) into j;
  begin
    execute 'select to_jsonb(x) from (select jobname, schedule, active from cron.job where jobname = ''poly-drop-bot'') x' into cj;
  exception when others then cj := null;
  end;
  return j || jsonb_build_object('cron', cj);
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all functions in schema poly_bot from public, anon, authenticated';
  end if;
end $$;
