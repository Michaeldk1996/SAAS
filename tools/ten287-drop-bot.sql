-- TEN-287 — SUPERBET dropping-odds bot (founder 2026-09-26, comment 3840b895: "build and enable the Superbet
-- drops path now"). Idempotent; safe to re-run. Installs NOTHING scheduled: the pg_cron job is a separate,
-- explicit step, so an install or a backtest can never start alerts.
--
-- Rules = the live Bet105 bot's (ten280_bot), founder-ruled for this path:
--   >= 5% drop vs the price 10 min earlier · NO floor (config.min_dropped_to_price NULL) ·
--   30-min cooldown per match PER BOOK (this bot is Superbet-only, so per match here; a Bet105 alert never
--   silences a Superbet one — separate tables, separate cooldowns) · match winner · pre-match men's singles.
-- Layout = the Bet105 v3 layout (Opening / Pre-drop / Odds now / Drop (10 min) / Since open / Moved / Bookmaker),
--   headed "🟢 SUPERBET DROP". No lay / spread / depth lines (Betfair-only).
-- Clocks, honestly labelled:
--   price time = odds-api.io's `updatedAt` for the market (the vendor's clock; `at` below);
--   known_at   = when OUR recorder received it (`seen_at`) — the detector never uses a tick before we had it;
--   Opening    = odds-api.io /odds/movements `opening` → "(vendor first record)"; else our first sighting →
--                "(first seen)". Never presented as the book's post time.
-- FEED TAP: reads ten287_rec (the TEN-287 recorder) only. Never reads or writes ten280_bot. Betfair Exchange
-- ticks are in the same recorder and are NEVER evaluated here (book filter below).
-- Private schema: no grant to anon / authenticated.
create schema if not exists ten287_bot;
revoke all on schema ten287_bot from public, anon, authenticated;

create table if not exists ten287_bot.alerts (
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
    ref_at          timestamptz,            -- vendor updatedAt of the price in force 10 min before eval_at
    cur_price       numeric,
    cur_at          timestamptz,            -- vendor updatedAt of the dropped-to price
    pct_10m         numeric,
    open_price      numeric,
    open_at         timestamptz,
    open_kind       text,                   -- 'vendor first record' | 'first seen'
    pct_open        numeric,
    message         text,
    net_request_id  bigint,
    sent_at         timestamptz,
    move_delay_s    numeric,
    delivery        text        not null default 'unsent',
    created_at      timestamptz not null default now()
);
create index if not exists alerts_cooldown_idx on ten287_bot.alerts (mode, run_id, book, event_id, eval_at);
-- the 30-s load reads one book over a time range
create index if not exists ticks_book_upd_idx on ten287_rec.ticks (book, book_updated_at);

create table if not exists ten287_bot.config (
    id                   boolean primary key default true check (id),
    book                 text    not null default 'Superbet',
    min_dropped_to_price numeric            -- NULL = no floor (founder 2026-09-26: "No floor. Match the live Bet105 bot.")
);
insert into ten287_bot.config (id) values (true) on conflict (id) do nothing;

create table if not exists ten287_bot.events (          -- startup / test messages
    id              bigserial primary key,
    kind            text        not null,
    detail          jsonb,
    net_request_id  bigint,
    delivery        text        not null default 'unsent',
    created_at      timestamptz not null default now()
);
alter table ten287_bot.alerts enable row level security;
alter table ten287_bot.events enable row level security;
alter table ten287_bot.config enable row level security;
revoke all on all tables in schema ten287_bot from public, anon, authenticated;

-- odds-api.io writes "Surname, First" for tour players and "First Surname" for ITF; show "First Surname"
-- everywhere, as the Bet105 alerts do. A name without a comma is shown as the vendor wrote it.
create or replace function ten287_bot.disp(p text) returns text
language sql immutable as $$
  select case when p like '%, %' then btrim(split_part(p, ', ', 2)) || ' ' || btrim(split_part(p, ', ', 1)) else p end
$$;

create or replace function ten287_bot.px(p numeric) returns text
language sql immutable as $$
  select regexp_replace(regexp_replace(to_char(p, 'FM9990.000'), '0+$', ''), '\.$', '')
$$;
create or replace function ten287_bot.pct(p numeric) returns text
language sql immutable as $$
  select case when p < 0 then '−' || to_char(abs(p), 'FM9990.0') else '+' || to_char(p, 'FM9990.0') end || '%'
$$;
create or replace function ten287_bot.spct(p numeric) returns text
language sql immutable as $$
  select case when round(p, 1) = 0 then '0.0%' else ten287_bot.pct(round(p, 1)) end
$$;
create or replace function ten287_bot.hhmm(p timestamptz) returns text
language sql immutable as $$ select to_char(p at time zone 'UTC', 'HH24:MI') || ' UTC' $$;
create or replace function ten287_bot.moved(p_secs numeric) returns text
language sql immutable as $$
  select case when p_secs is null then '—' when p_secs < 60 then 'just now' else floor(p_secs / 60)::int || ' min ago' end
$$;

-- LOAD the book's pre-match men's-singles ML price CHANGES into pg_temp.t287 (one row per side per change).
-- A same-price re-stamp from the vendor is not a change: only the first row of each run of equal prices is kept,
-- so "Pre-drop @ time" is when that price was SET, not when it was last re-sent.
create or replace function ten287_bot.load_ticks(p_book text, p_from timestamptz, p_to timestamptz) returns integer
language plpgsql as $$
declare n integer;
begin
  drop table if exists pg_temp.t287;
  create temp table t287 as
  with raw as (
    select t.event_id, s.side, s.price, t.book_updated_at as at, t.seen_at as known_at, t.event_status
    from ten287_rec.ticks t
    join ten287_rec.events e using (event_id)
    cross join lateral (values ('home', t.back_home), ('away', t.back_away)) s(side, price)
    where t.book = p_book and e.tier is not null
      and coalesce(t.event_status, e.status) = 'pending'   -- a tick without a status falls back to the event's current one
      and s.price >= 1.01 and t.book_updated_at is not null
      and t.book_updated_at between p_from and p_to and t.seen_at <= p_to
  ),
  ordered as (
    select *, lag(price) over (partition by event_id, side order by at, known_at) as prev_price from raw
  )
  select event_id, side, price, at, known_at from ordered where prev_price is distinct from price;
  create index on t287 (event_id, side, at);
  select count(*) into n from t287;
  return n;
end $$;

-- The alert text: the Bet105 v3 layout (TEN-282), Superbet header and book line.
create or replace function ten287_bot.render(a ten287_bot.alerts, p_at timestamptz) returns text
language sql stable as $$
  select concat_ws(chr(10),
    '🟢 SUPERBET DROP',
    '',
    format('🎾 Match: %s vs %s (%s)', coalesce(a.player_a, '—'), coalesce(a.player_b, '—'), coalesce(a.tier, '—')),
    format('🎯 Line: Match Winner – %s', coalesce(a.side_player, '—')),
    case when a.open_price is null then '🟢 Opening: —'
         else format('🟢 Opening: %s @ %s (%s)', ten287_bot.px(a.open_price), ten287_bot.hhmm(a.open_at), a.open_kind) end,
    format('🟠 Pre-drop: %s @ %s', ten287_bot.px(a.ref_price), ten287_bot.hhmm(a.ref_at)),
    format('🔴 Odds now: %s @ %s', ten287_bot.px(a.cur_price), ten287_bot.hhmm(a.cur_at)),
    format('📉 Drop (10 min): −%s%%', to_char(round((a.ref_price - a.cur_price) / a.ref_price * 100, 1), 'FM9990.0')),
    case when a.open_price is null then '➡️ Since open: —'
         else format('%s Since open: %s',
                case sign(round((a.cur_price - a.open_price) / a.open_price * 100, 1)) when 1 then '↗️' when -1 then '↘️' else '➡️' end,
                ten287_bot.spct((a.cur_price - a.open_price) / a.open_price * 100)) end,
    format('⏱️ Moved: %s', ten287_bot.moved(extract(epoch from (p_at - a.cur_at))::numeric)),
    format('🏦 Bookmaker: %s', a.book))
$$;

-- SCAN: identical semantics to ten280_bot.scan — current = the side's latest known price if it changed inside
-- the window; reference = the latest known price at or before e − window; alert when the drop >= threshold,
-- the current price >= floor (NULL = none), and this book has no alert on this match within `cooldown`.
create or replace function ten287_bot.scan(
    p_book text, p_from timestamptz, p_to timestamptz, p_threshold numeric, p_mode text, p_run text,
    p_window interval default interval '10 minutes', p_floor numeric default null,
    p_cooldown interval default interval '30 minutes') returns integer
language plpgsql as $$
declare
  e   timestamptz := case when p_from = p_to then p_from else date_trunc('minute', p_from) end;
  n   integer := 0;
  c   record; op record; ev record; aid bigint;
  o_price numeric; o_at timestamptz; o_kind text;
begin
  while e <= p_to loop
    for c in
      with cur as (
        select distinct on (event_id, side) event_id, side, price as cur_price, at as cur_at
        from pg_temp.t287
        where known_at <= e and at <= e and at > e - p_window
        order by event_id, side, at desc, known_at desc
      )
      select cur.*, r.price as ref_price, r.at as ref_at,
             round((r.price - cur.cur_price) / r.price * 100, 2) as pct_10m
      from cur
      cross join lateral (
        select x.price, x.at from pg_temp.t287 x
        where x.event_id = cur.event_id and x.side = cur.side and x.at <= e - p_window and x.known_at <= e
        order by x.at desc, x.known_at desc limit 1) r
      where (p_floor is null or cur.cur_price >= p_floor)
        and (r.price - cur.cur_price) / r.price * 100 >= p_threshold
      order by pct_10m desc, event_id, side
    loop
      if exists (select 1 from ten287_bot.alerts a
                 where a.mode = p_mode and a.run_id is not distinct from p_run and a.book = p_book
                   and a.threshold = p_threshold and a.event_id = c.event_id and a.eval_at > e - p_cooldown) then
        continue;
      end if;
      select e2.home, e2.away, e2.tier into ev from ten287_rec.events e2 where e2.event_id = c.event_id;
      -- Opening: the vendor's first record when we have it, else our own first sighting of that side.
      select case c.side when 'home' then o.open_home else o.open_away end, o.open_at
        into o_price, o_at
        from ten287_rec.openings o where o.event_id = c.event_id and o.book = p_book and o.status_code = 200;
      if o_price is not null and o_price >= 1.01 and o_at is not null then
        o_kind := 'vendor first record';
      else
        select price, at into op from pg_temp.t287
         where event_id = c.event_id and side = c.side and known_at <= e order by at asc limit 1;
        o_price := op.price; o_at := op.at; o_kind := 'first seen';
      end if;
      insert into ten287_bot.alerts (mode, run_id, book, threshold, event_id, side, tier, player_a, player_b, side_player,
          eval_at, ref_price, ref_at, cur_price, cur_at, pct_10m, open_price, open_at, open_kind, pct_open)
      values (p_mode, p_run, p_book, p_threshold, c.event_id, c.side, ev.tier,
          ten287_bot.disp(ev.home), ten287_bot.disp(ev.away),
          ten287_bot.disp(case c.side when 'home' then ev.home else ev.away end),
          e, c.ref_price, c.ref_at, c.cur_price, c.cur_at, c.pct_10m, o_price, o_at, o_kind,
          case when o_price is not null then round((c.cur_price - o_price) / o_price * 100, 2) end)
      returning id into aid;
      update ten287_bot.alerts set message = ten287_bot.render(alerts, e) where id = aid;
      n := n + 1;
      o_price := null; o_at := null; o_kind := null;
    end loop;
    e := e + interval '1 minute';
  end loop;
  return n;
end $$;

-- Telegram: Vault, under this bot's own names (copied from the same GitHub secrets as the Bet105 bot).
create or replace function ten287_bot.send(p_text text) returns bigint
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

create or replace function ten287_bot.settle() returns void
language plpgsql as $$
begin
  update ten287_bot.alerts a set delivery = case when r.status_code between 200 and 299 then 'sent'
                                                 else 'failed: ' || coalesce('HTTP ' || r.status_code, r.error_msg, 'no response') end
    from net._http_response r where a.delivery = 'queued' and r.id = a.net_request_id;
  update ten287_bot.events v set delivery = case when r.status_code between 200 and 299 then 'sent'
                                                 else 'failed: ' || coalesce('HTTP ' || r.status_code, r.error_msg, 'no response') end
    from net._http_response r where v.delivery = 'queued' and r.id = v.net_request_id;
end $$;

-- LIVE tick (pg_cron every 30 s). Superbet only: config.book.
create or replace function ten287_bot.tick() returns integer
language plpgsql as $$
declare e timestamptz := now(); n integer; a ten287_bot.alerts; rid bigint; v_at timestamptz; msg text;
        fl numeric; bk text;
begin
  if not pg_try_advisory_xact_lock(287287) then return 0; end if;
  perform ten287_bot.settle();
  select min_dropped_to_price, book into fl, bk from ten287_bot.config;
  perform ten287_bot.load_ticks(bk, now() - interval '14 days', now());
  n := ten287_bot.scan(bk, e, e, 5, 'live', null, interval '10 minutes', fl);
  for a in select * from ten287_bot.alerts where mode = 'live' and delivery = 'unsent' order by id limit 10 loop
    v_at := clock_timestamp();
    msg  := ten287_bot.render(a, v_at);
    rid  := ten287_bot.send(msg);
    update ten287_bot.alerts set net_request_id = rid, message = msg,
                                 sent_at = case when rid is not null then v_at end,
                                 move_delay_s = case when rid is not null then round(extract(epoch from (v_at - a.cur_at))::numeric, 3) end,
                                 delivery = case when rid is null then 'unsent: no vault secret' else 'queued' end
     where id = a.id;
  end loop;
  return n;
end $$;

-- One-time startup message; a re-install never re-sends it (guarded on an existing startup row).
create or replace function ten287_bot.startup() returns bigint
language plpgsql as $$
declare rid bigint; msg text;
begin
  perform pg_advisory_xact_lock(287287);
  -- any earlier attempt that actually went out (queued, sent, or failed after sending) blocks a repeat
  if exists (select 1 from ten287_bot.events where kind = 'startup' and delivery <> 'unsent: no vault secret') then
    return null;
  end if;
  msg := concat_ws(chr(10),
    '🟢 SUPERBET DROP — bot is live (startup test)',
    '',
    'Same rules as Bet105: ≥5% drop vs the price 10 min earlier · no floor · 30-min cooldown per match per book.',
    'Pre-match men''s singles, match winner. Source: odds-api.io (Superbet), polled every 30 s.',
    'Opening = odds-api.io''s first record, or "first seen" by us — never the book''s post time.',
    '🏦 Bookmaker: Superbet');
  rid := ten287_bot.send(msg);
  insert into ten287_bot.events (kind, detail, net_request_id, delivery)
  values ('startup', jsonb_build_object('text', msg), rid, case when rid is null then 'unsent: no vault secret' else 'queued' end);
  return rid;
end $$;

revoke all on all functions in schema ten287_bot from public, anon, authenticated;
