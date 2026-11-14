-- Sharp drop alerts (founder 2026-11-14) — rules: .claude/rules/sharp-drops.md
--
-- A fast Bet105 drop (the live stand-in for Pinnacle) becomes one alert row; each member whose own settings match gets
-- it by Telegram DM from one bot; every alert is graded on the Oddspapi Pinnacle close and the api-tennis result.
--
-- Reads (never writes): public.kibl_fixtures / kibl_line_observations / kibl_now_history (Bet105, the Bet105 drop bot's
-- own loader), drops_scope.fixture (api-tennis fixtures, start, status, winner — the drops join), public.live_flip_log_current
-- (our live-start sightings), kalshi_bot.match_fx + kalshi_rec.markets / ticks (Kalshi best ask, when installed),
-- public.pinnacle_archive_close (the Oddspapi close).
-- Writes only its own schema. Alerts, deliveries and grades are append-only. Installs NOTHING scheduled and sends nothing:
-- the cron jobs are the workflow's separate 'schedule' step, and delivery needs config.live = true.
-- Idempotent: safe to re-run.
create schema if not exists sharp_bot;
revoke all on schema sharp_bot from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema sharp_bot from anon, authenticated'; end if;
end $$;

create table if not exists sharp_bot.config (
    id               boolean primary key default true check (id),
    live             boolean not null default false,   -- deliveries are sent only when true
    beta_only        boolean not null default true,    -- founder 2026-11-14: admins only until opened
    base_drop        numeric not null default 2,       -- % within lookback_min that records an alert
    lookback_min     integer not null default 5,
    max_window_min   integer not null default 180,
    cooldown_min     integer not null default 5,
    max_overround    numeric not null default 0.20,
    kalshi_fee       numeric not null default 0.07,
    token_secret     text    not null default 'sharp_telegram_bot_token',
    fallback_secret  text    not null default 'ten287_telegram_bot_token',
    tg_offset        bigint  not null default 0,
    last_scan_at     timestamptz
);
insert into sharp_bot.config (id) values (true) on conflict (id) do nothing;

-- One row per member. Settings columns are written ONLY by public.sharp_members_upsert (the Firestore sync); the chat
-- columns ONLY by the bot (Telegram /start, /stop).
create table if not exists sharp_bot.members (
    uid          text primary key,
    name         text,
    admin        boolean not null default false,
    enabled      boolean not null default true,
    link_code    text unique,
    levels       text[]  not null default '{ATP,ATP Q,CH,CH Q}',
    drop_min     numeric not null default 2,
    drop_max     numeric          default 3,
    price_min    numeric not null default 1.01,
    price_max    numeric          default 1.80,
    window_min   integer not null default 180,
    steps_only   boolean not null default false,
    books        text[]  not null default '{Bet105,Kalshi}',
    daily_cap    integer not null default 0,
    quiet_from   text,
    quiet_to     text,
    tz           text    not null default 'Europe/Brussels',
    updated_at   timestamptz not null default now(),
    chat_id      bigint,
    linked_at    timestamptz,
    tg_paused    boolean not null default false
);

create table if not exists sharp_bot.alerts (
    id             bigserial primary key,
    fixture_id     bigint      not null,            -- Kibl fixture
    side_id        integer     not null,            -- 2 = player 1, 3 = player 2 (Kibl)
    event_key      bigint,                          -- api-tennis
    level          text        not null,            -- ATP | ATP Q | CH | CH Q | ITF | ITF Q
    tournament     text,
    player         text        not null,            -- the backed player (api-tennis spelling)
    opponent       text        not null,
    start_utc      timestamptz not null,            -- api-tennis scheduled start (the window only, never a close cut)
    alert_at       timestamptz not null,            -- Kibl insert time of the dropped price
    known_at       timestamptz not null,            -- when we had it
    price_before   numeric     not null,            -- Bet105, lookback_min earlier
    price          numeric     not null,            -- Bet105 now
    other_price    numeric     not null,
    drop_pct       numeric     not null,            -- on the 2 dp prices
    steps          integer     not null,            -- price changes inside the lookback
    bet_at         numeric     not null,            -- no-vig fair price of the backed player
    mins_to_start  integer     not null,
    kalshi_ticker  text,
    kalshi_odds    numeric,                         -- decimal, after fee
    kalshi_size    numeric,                         -- contracts at the best ask
    created_at     timestamptz not null default now(),
    unique (fixture_id, side_id, alert_at)
);
create index if not exists sharp_alerts_created_idx on sharp_bot.alerts (created_at);

create table if not exists sharp_bot.deliveries (
    id              bigserial primary key,
    alert_id        bigint not null references sharp_bot.alerts(id),
    uid             text   not null,
    chat_id         bigint,
    status          text   not null,                -- queued | not sent: live off | not sent: no bot token
    message         text,
    net_request_id  bigint,
    created_at      timestamptz not null default now(),
    unique (alert_id, uid)
);
create index if not exists sharp_deliv_uid_idx on sharp_bot.deliveries (uid, created_at);

create table if not exists sharp_bot.grades (
    alert_id       bigint primary key references sharp_bot.alerts(id),
    result         text   not null,                 -- W | L | void | no units | no result
    close_price    numeric,                         -- Oddspapi Pinnacle close, backed player
    close_prob     numeric,                         -- its no-vig probability
    close_source   text,
    edge_pct       numeric,                         -- bet_at x close_prob - 1, in %
    pl_bet105      numeric,                         -- 1 u at the Bet105 price at the alert
    pl_bet_at      numeric,                         -- 1 u at the bet-at price
    note           text,
    graded_at      timestamptz not null default now()
);

create table if not exists sharp_bot.tg_requests (
    id            bigint primary key,               -- pg_net request id of a getUpdates call
    fired_at      timestamptz not null default now(),
    processed_at  timestamptz,
    note          text
);
create table if not exists sharp_bot.events (
    id bigserial primary key, kind text not null, detail jsonb, at timestamptz not null default now()
);

alter table sharp_bot.config      enable row level security;
alter table sharp_bot.members     enable row level security;
alter table sharp_bot.alerts      enable row level security;
alter table sharp_bot.deliveries  enable row level security;
alter table sharp_bot.grades      enable row level security;
alter table sharp_bot.tg_requests enable row level security;
alter table sharp_bot.events      enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema sharp_bot from anon, authenticated';
  end if;
end $$;

-- append-only: alerts, deliveries and grades are never changed or removed
create or replace function sharp_bot.no_change() returns trigger language plpgsql as $$
begin raise exception 'sharp_bot.% is append-only', tg_table_name; end $$;
drop trigger if exists sharp_alerts_append on sharp_bot.alerts;
create trigger sharp_alerts_append before update or delete on sharp_bot.alerts for each row execute function sharp_bot.no_change();
drop trigger if exists sharp_grades_append on sharp_bot.grades;
create trigger sharp_grades_append before update or delete on sharp_bot.grades for each row execute function sharp_bot.no_change();
drop trigger if exists sharp_deliv_append on sharp_bot.deliveries;
create trigger sharp_deliv_append before delete on sharp_bot.deliveries for each row execute function sharp_bot.no_change();

-- ── helpers ───────────────────────────────────────────────────────────────────
create or replace function sharp_bot.r2(p numeric) returns numeric language sql immutable as $$ select round(p, 2) $$;
create or replace function sharp_bot.px(p numeric) returns text language sql immutable as $$ select to_char(round(p, 2), 'FM990.00') $$;
create or replace function sharp_bot.skey(p_name text) returns text language sql immutable as $$
  select regexp_replace(lower(regexp_replace(coalesce(p_name, ''), '^.*\s', '')), '[^a-z]', '', 'g') $$;
create or replace function sharp_bot.level_of(p_type text, p_qual text) returns text language sql immutable as $$
  select case
    when p_type = 'Atp Singles'             then 'ATP'
    when p_type = 'Challenger Men Singles'  then 'CH'
    when p_type = 'Itf Men Singles'         then 'ITF'
  end || case when lower(coalesce(p_qual, '')) in ('true', '1') then ' Q' else '' end $$;
create or replace function sharp_bot.level_name(p text) returns text language sql immutable as $$
  select case p when 'ATP' then 'ATP' when 'ATP Q' then 'ATP qualifying' when 'CH' then 'Challenger'
                when 'CH Q' then 'Challenger qualifying' when 'ITF' then 'ITF' when 'ITF Q' then 'ITF qualifying' else p end $$;

-- LOAD: Bet105 pre-match match-winner ticks, all men's tiers — the Bet105 drop bot's loader (ten280_bot.load_ticks),
-- the same filters, into pg_temp.tsd. `at` = Kibl insert time; `known_at` = when we had it.
create or replace function sharp_bot.load_ticks(p_from timestamptz, p_to timestamptz) returns integer
language plpgsql as $$
declare n integer;
begin
  drop table if exists pg_temp.tsd;
  create temp table tsd as
  with fx as (
    select fixture_id, player1_name, player2_name
    from public.kibl_fixtures
    where league_id in (19, 537, 962) and player1_name is not null and player2_name is not null
  ),
  poll as (
    select o.fixture_id, o.side_id, o.price_decimal as price, o.inserted_on as at, o.observed_at as known_at, o.row_key
    from public.kibl_line_observations o join fx using (fixture_id)
    where o.feed_source_id = 171 and o.market_type_id = 1 and o.segment_id = 1
      and o.betting_type_id = 1 and o.is_live is false and o.price_decimal >= 1.01
      and o.side_id in (2, 3) and o.inserted_on between p_from and p_to and o.observed_at <= p_to
  ),
  strm as (
    select h.fixture_id,
           coalesce((select o.side_id from public.kibl_line_observations o where o.row_key = h.row_key limit 1),
                    case when sharp_bot.skey(fx.player1_name) = sharp_bot.skey(fx.player2_name) then null
                         when h.side_key = sharp_bot.skey(fx.player1_name) then 2
                         when h.side_key = sharp_bot.skey(fx.player2_name) then 3 end) as side_id,
           h.price, h.kibl_inserted_on as at, h.written_at as known_at, h.row_key
    from public.kibl_now_history h join fx using (fixture_id)
    where h.price >= 1.01 and h.kibl_inserted_on between p_from and p_to and h.written_at <= p_to
      and not exists (select 1 from poll p where p.row_key = h.row_key)
  )
  select fixture_id, side_id, price, at, known_at from poll
  union all
  select fixture_id, side_id, price, at, known_at from strm where side_id in (2, 3);
  create index on tsd (fixture_id, side_id, at);
  select count(*) into n from tsd;
  return n;
end $$;

-- Kalshi best ask for a player of an api-tennis event, as seen at p_at (ATP series only; null when not recorded).
create or replace function sharp_bot.kalshi_quote(p_event_key bigint, p_player text, p_at timestamptz,
    out ticker text, out odds numeric, out size numeric)
language plpgsql stable as $$
declare fee numeric;
begin
  select kalshi_fee into fee from sharp_bot.config;
  select t.ticker, t.yes_ask, t.yes_ask_size into ticker, odds, size
    from kalshi_bot.match_fx x
    join kalshi_rec.markets m on m.event_ticker = x.event_ticker and drops_scope.same(m.player, p_player)
    join lateral (select k.ticker, k.yes_ask, k.yes_ask_size from kalshi_rec.ticks k
                   where k.ticker = m.ticker and k.seen_at <= p_at and k.yes_ask > 0.01 and k.yes_ask < 0.99
                   order by k.seen_at desc limit 1) t on true
   where x.event_key = p_event_key
   limit 1;
  if odds is not null then odds := round(1 / (odds + fee * odds * (1 - odds)), 3); end if;
exception when others then ticker := null; odds := null; size := null;      -- Kalshi not installed / unreadable
end $$;

-- SCAN: every tick that became known since the last scan and dropped >= base_drop % against its own price lookback_min
-- earlier. Returns the number of alerts recorded.
create or replace function sharp_bot.scan(p_now timestamptz default now()) returns integer
language plpgsql as $$
declare
  cfg sharp_bot.config; since timestamptz; n integer := 0; c record; v record; f record;
  q numeric; ov numeric; st timestamptz; lvl text; kq record; back text; opp text;
begin
  select * into cfg from sharp_bot.config;
  since := coalesce(cfg.last_scan_at, p_now - interval '2 minutes');
  for c in
    select t.fixture_id, t.side_id, t.price, t.at, t.known_at,
           r.price as ref_price,
           o.price as other_price,
           (select count(*) from pg_temp.tsd s where s.fixture_id = t.fixture_id and s.side_id = t.side_id
              and s.at > t.at - make_interval(mins => cfg.lookback_min) and s.at <= t.at) as steps
      from pg_temp.tsd t
      cross join lateral (select x.price from pg_temp.tsd x where x.fixture_id = t.fixture_id and x.side_id = t.side_id
                            and x.at <= t.at - make_interval(mins => cfg.lookback_min) and x.known_at <= p_now
                          order by x.at desc limit 1) r
      cross join lateral (select y.price from pg_temp.tsd y where y.fixture_id = t.fixture_id and y.side_id = 5 - t.side_id
                            and y.at <= t.at and y.known_at <= p_now
                          order by y.at desc limit 1) o
     where t.known_at > since and t.known_at <= p_now and t.at > p_now - interval '30 minutes'
       and (sharp_bot.r2(r.price) - sharp_bot.r2(t.price)) / sharp_bot.r2(r.price) * 100 >= cfg.base_drop
     order by t.at
  loop
    if exists (select 1 from sharp_bot.alerts a where a.fixture_id = c.fixture_id and a.side_id = c.side_id
                 and a.alert_at > c.at - make_interval(mins => cfg.cooldown_min)) then continue; end if;
    ov := 1 / c.price + 1 / c.other_price - 1;
    if ov > cfg.max_overround or ov < -0.01 then continue; end if;
    select k.player1_name, k.player2_name, k.scheduled_start into f from public.kibl_fixtures k where k.fixture_id = c.fixture_id;
    select * into v from drops_scope.verdict(f.player1_name, f.player2_name, f.scheduled_start, c.at);
    if v.candidates is distinct from 1 or v.event_key is null then continue; end if;
    lvl := sharp_bot.level_of(v.event_type_type, v.event_qualification);
    if lvl is null then continue; end if;
    select x.start_utc, x.tournament_name, x.first_player, x.second_player, x.event_status into f
      from drops_scope.fixture x where x.event_key = v.event_key;
    st := f.start_utc;
    if st is null or st <= c.at or st - c.at > make_interval(mins => cfg.max_window_min) then continue; end if;
    if coalesce(f.event_status, '') <> '' then continue; end if;                     -- started, finished or off
    if exists (select 1 from public.live_flip_log_current l where l.event_key = v.event_key::text) then continue; end if;
    -- the backed player in api-tennis spelling (Kibl side 2 = its player 1)
    back := case when drops_scope.same(case c.side_id when 2 then (select player1_name from public.kibl_fixtures where fixture_id = c.fixture_id)
                                                     else (select player2_name from public.kibl_fixtures where fixture_id = c.fixture_id) end,
                                       f.first_player) then f.first_player else f.second_player end;
    opp  := case when back = f.first_player then f.second_player else f.first_player end;
    q := (1 / c.price) / (1 / c.price + 1 / c.other_price);
    select * into kq from sharp_bot.kalshi_quote(v.event_key, back, c.known_at);
    insert into sharp_bot.alerts (fixture_id, side_id, event_key, level, tournament, player, opponent, start_utc, alert_at,
        known_at, price_before, price, other_price, drop_pct, steps, bet_at, mins_to_start, kalshi_ticker, kalshi_odds, kalshi_size)
    values (c.fixture_id, c.side_id, v.event_key, lvl, f.tournament_name, back, opp, st, c.at, c.known_at, c.ref_price,
        c.price, c.other_price,
        round((sharp_bot.r2(c.ref_price) - sharp_bot.r2(c.price)) / sharp_bot.r2(c.ref_price) * 100, 2),
        c.steps, round(1 / q, 3), floor(extract(epoch from (st - c.at)) / 60)::int, kq.ticker, kq.odds, kq.size)
    on conflict (fixture_id, side_id, alert_at) do nothing;
    if found then n := n + 1; end if;
  end loop;
  update sharp_bot.config set last_scan_at = p_now;
  return n;
end $$;

-- Does an alert pass a member's settings (filters only; cap, quiet hours and one-per-player in deliver())?
create or replace function sharp_bot.passes(a sharp_bot.alerts, m sharp_bot.members) returns boolean
language sql immutable as $$
  select a.level = any(m.levels)
     and a.drop_pct >= m.drop_min and (m.drop_max is null or a.drop_pct < m.drop_max)
     and a.price >= m.price_min and (m.price_max is null or a.price < m.price_max)
     and a.mins_to_start <= m.window_min
     and (not m.steps_only or a.steps >= 2)
$$;

create or replace function sharp_bot.in_quiet(m sharp_bot.members, p_at timestamptz) returns boolean
language plpgsql stable as $$
declare t time; a time; b time;
begin
  if m.quiet_from is null or m.quiet_to is null or m.quiet_from = '' or m.quiet_to = '' then return false; end if;
  t := (p_at at time zone coalesce(nullif(m.tz, ''), 'UTC'))::time; a := m.quiet_from::time; b := m.quiet_to::time;
  return case when a <= b then t >= a and t < b else t >= a or t < b end;
exception when others then return false;
end $$;

create or replace function sharp_bot.render(a sharp_bot.alerts, m sharp_bot.members) returns text
language sql stable as $$
  select concat_ws(chr(10),
    '⚡ SHARP DROP · ' || sharp_bot.level_name(a.level),
    a.player || ' to beat ' || a.opponent,
    coalesce(a.tournament, '') || ' · starts in ' || a.mins_to_start || ' min',
    '',
    'Bet105 ' || sharp_bot.px(a.price_before) || ' → ' || sharp_bot.px(a.price) || ' (−' || to_char(a.drop_pct, 'FM990.0') || '% in 5 min)',
    'Bet at ' || sharp_bot.px(a.bet_at) || ' or better',
    nullif(concat_ws(' · ',
      case when 'Bet105' = any(m.books) then 'Bet105 ' || sharp_bot.px(a.price) end,
      case when 'Kalshi' = any(m.books) and a.kalshi_odds is not null
           then 'Kalshi ' || sharp_bot.px(a.kalshi_odds) || ' after fee' ||
                coalesce(' (' || to_char(a.kalshi_size, 'FM999999') || ' contracts)', '') end), ''),
    'Graded on the Pinnacle close after the match.')
$$;

-- the bot token: the members' bot, else the drop bots' (beta)
create or replace function sharp_bot.token() returns text
language plpgsql stable as $$
declare cfg sharp_bot.config; t text;
begin
  select * into cfg from sharp_bot.config;
  select btrim(decrypted_secret) into t from vault.decrypted_secrets where name = cfg.token_secret and btrim(decrypted_secret) <> '' limit 1;
  if t is null then
    select btrim(decrypted_secret) into t from vault.decrypted_secrets where name = cfg.fallback_secret and btrim(decrypted_secret) <> '' limit 1;
  end if;
  return t;
end $$;

create or replace function sharp_bot.tg_send(p_chat bigint, p_text text) returns bigint
language plpgsql as $$
declare tok text := sharp_bot.token();
begin
  if tok is null or p_chat is null then return null; end if;
  return net.http_post(
    url     := 'https://api.telegram.org/bot' || tok || '/sendMessage',
    body    := jsonb_build_object('chat_id', p_chat, 'text', p_text, 'disable_web_page_preview', true),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000);
end $$;

-- DELIVER: each recent alert to each member whose settings pass; one per player per match per member.
create or replace function sharp_bot.deliver(p_now timestamptz default now()) returns integer
language plpgsql as $$
declare cfg sharp_bot.config; a sharp_bot.alerts; m sharp_bot.members; n integer := 0; msg text; rid bigint; today integer;
begin
  select * into cfg from sharp_bot.config;
  for a in select * from sharp_bot.alerts where created_at > p_now - interval '15 minutes' order by id loop
    for m in select * from sharp_bot.members
              where enabled and chat_id is not null and not tg_paused and (admin or not cfg.beta_only) loop
      continue when not sharp_bot.passes(a, m);
      continue when exists (select 1 from sharp_bot.deliveries d join sharp_bot.alerts x on x.id = d.alert_id
                             where d.uid = m.uid and x.fixture_id = a.fixture_id and x.side_id = a.side_id);
      continue when sharp_bot.in_quiet(m, p_now);
      if m.daily_cap > 0 then
        select count(*) into today from sharp_bot.deliveries d
         where d.uid = m.uid and d.status = 'queued'
           and (d.created_at at time zone m.tz)::date = (p_now at time zone m.tz)::date;
        continue when today >= m.daily_cap;
      end if;
      msg := sharp_bot.render(a, m);
      rid := case when cfg.live then sharp_bot.tg_send(m.chat_id, msg) end;
      insert into sharp_bot.deliveries (alert_id, uid, chat_id, status, message, net_request_id)
      values (a.id, m.uid, m.chat_id,
              case when not cfg.live then 'not sent: live off' when rid is null then 'not sent: no bot token' else 'queued' end,
              msg, rid)
      on conflict (alert_id, uid) do nothing;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

-- TELEGRAM: read the bot's updates (getUpdates through pg_net), link /start <code>, pause /stop, resume /start.
create or replace function sharp_bot.tg_poll() returns integer
language plpgsql as $$
declare
  cfg sharp_bot.config; r record; u jsonb; txt text; chat bigint; code text; mx bigint; n integer := 0; m sharp_bot.members; tok text;
begin
  select * into cfg from sharp_bot.config;
  for r in select q.id, h.status_code, h.content from sharp_bot.tg_requests q join net._http_response h on h.id = q.id
            where q.processed_at is null order by q.id loop
    mx := null;
    if r.status_code = 200 then
      for u in select * from jsonb_array_elements(coalesce((r.content::jsonb) -> 'result', '[]'::jsonb)) loop
        mx := greatest(coalesce(mx, 0), (u ->> 'update_id')::bigint);
        txt  := btrim(coalesce(u -> 'message' ->> 'text', ''));
        chat := (u -> 'message' -> 'chat' ->> 'id')::bigint;
        continue when chat is null or (u -> 'message' -> 'chat' ->> 'type') is distinct from 'private';
        if txt ~* '^/stop' then
          update sharp_bot.members set tg_paused = true where chat_id = chat;
          perform sharp_bot.tg_send(chat, 'Sharp drop alerts paused. Send /start to resume.');
        elsif txt ~* '^/start\s*$' then
          update sharp_bot.members set tg_paused = false where chat_id = chat;
          perform sharp_bot.tg_send(chat, case when found then 'Sharp drop alerts resumed.'
            else 'To link this chat, copy the code from the Sharp drops page on Stennisfy and send: /start YOUR-CODE' end);
        else
          code := upper(btrim(regexp_replace(txt, '^/start\s+', '', 'i')));
          select * into m from sharp_bot.members where link_code = code;
          if m.uid is not null then
            update sharp_bot.members set chat_id = null where chat_id = chat and uid <> m.uid;
            update sharp_bot.members set chat_id = chat, linked_at = now(), tg_paused = false where uid = m.uid;
            perform sharp_bot.tg_send(chat, 'Linked. You will get Stennisfy sharp drop alerts that match your settings. Send /stop to pause.');
            insert into sharp_bot.events (kind, detail) values ('linked', jsonb_build_object('uid', m.uid));
            n := n + 1;
          elsif txt ~* '^/start' then
            perform sharp_bot.tg_send(chat, 'That code is not known. Copy it again from the Sharp drops page on Stennisfy.');
          end if;
        end if;
      end loop;
    end if;
    update sharp_bot.tg_requests set processed_at = now(),
           note = case when r.status_code is distinct from 200 then 'HTTP ' || coalesce(r.status_code::text, '?') end
     where id = r.id;
    if mx is not null then update sharp_bot.config set tg_offset = mx + 1; end if;
  end loop;
  update sharp_bot.tg_requests set processed_at = now(), note = 'no response'
   where processed_at is null and fired_at < now() - interval '2 minutes';
  delete from sharp_bot.tg_requests where fired_at < now() - interval '2 days';
  if not exists (select 1 from sharp_bot.tg_requests where processed_at is null) then
    tok := sharp_bot.token();
    if tok is not null then
      select * into cfg from sharp_bot.config;
      insert into sharp_bot.tg_requests (id)
      values (net.http_get(url := 'https://api.telegram.org/bot' || tok || '/getUpdates?timeout=0&allowed_updates=%5B%22message%22%5D&offset=' || cfg.tg_offset,
                           timeout_milliseconds := 10000));
    end if;
  end if;
  return n;
end $$;

-- GRADE: one grade per alert once the match is over — the Oddspapi Pinnacle close and the api-tennis result.
create or replace function sharp_bot.grade(p_now timestamptz default now()) returns integer
language plpgsql as $$
declare a sharp_bot.alerts; f record; c record; res text; cp numeric; cpr numeric; n integer := 0; pl1 numeric; pl2 numeric; nt text;
begin
  for a in select x.* from sharp_bot.alerts x where not exists (select 1 from sharp_bot.grades g where g.alert_id = x.id)
             and x.start_utc < p_now - interval '3 hours' order by x.id limit 500 loop
    select fx.event_status, fx.event_winner, fx.first_player into f from drops_scope.fixture fx where fx.event_key = a.event_key;
    res := case
      when f.event_status in ('Walk Over', 'Cancelled', 'Postponed') then 'void'
      when f.event_status = 'Retired' then 'no units'
      when f.event_winner in ('First Player', 'Second Player') then
        case when (f.event_winner = 'First Player') = (a.player = f.first_player) then 'W' else 'L' end
    end;
    if res is null then
      continue when a.start_utc > p_now - interval '3 days';      -- not over yet: grade later
      res := 'no result';
    end if;
    -- the current Oddspapi close of the event (newest archive close not superseded)
    select p.p1, p.p2, p.p1_name, p.p2_name, p.label into c
      from public.pinnacle_archive_close p
     where p.event_key = a.event_key
       and not exists (select 1 from public.pinnacle_archive_close s where s.supersedes = p.id)
     order by (p.label = 'from Pinnacle history') desc, p.id desc limit 1;
    cp := null; cpr := null; nt := null;
    if c.p1 is not null then
      if drops_scope.same(a.player, c.p1_name) then cp := c.p1; cpr := (1 / c.p1) / (1 / c.p1 + 1 / c.p2);
      elsif drops_scope.same(a.player, c.p2_name) then cp := c.p2; cpr := (1 / c.p2) / (1 / c.p1 + 1 / c.p2);
      else nt := 'close found, player not matched'; end if;
    else nt := 'no Pinnacle close on record'; end if;
    pl1 := case res when 'W' then a.price - 1 when 'L' then -1 end;
    pl2 := case res when 'W' then a.bet_at - 1 when 'L' then -1 end;
    insert into sharp_bot.grades (alert_id, result, close_price, close_prob, close_source, edge_pct, pl_bet105, pl_bet_at, note)
    values (a.id, res, cp, round(cpr, 4), case when cp is not null then 'Oddspapi Pinnacle (' || c.label || ')' end,
            case when cpr is not null then round((a.bet_at * cpr - 1) * 100, 2) end, pl1, pl2, nt)
    on conflict (alert_id) do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function sharp_bot.tick() returns jsonb
language plpgsql as $$
declare n_t integer; n_a integer; n_d integer; n_l integer;
begin
  if not pg_try_advisory_xact_lock(288401) then return '{"skipped":true}'::jsonb; end if;
  n_t := sharp_bot.load_ticks(now() - interval '45 minutes', now());
  n_a := sharp_bot.scan(now());
  n_d := sharp_bot.deliver(now());
  begin n_l := sharp_bot.tg_poll(); exception when others then n_l := -1; end;
  return jsonb_build_object('ticks', n_t, 'alerts', n_a, 'deliveries', n_d, 'linked', n_l);
end $$;

-- ── public RPCs ───────────────────────────────────────────────────────────────
-- The member sync (Firestore → here), service_role only. Settings only: never the chat columns.
create or replace function public.sharp_members_upsert(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, sharp_bot as $$
declare r jsonb; n integer := 0; out jsonb := '[]'::jsonb;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    -- update first, insert when new (no upsert in this file: the archive guard scans every file that reads the archive)
    update sharp_bot.members set name = r ->> 'name', admin = coalesce((r ->> 'admin')::boolean, false),
        enabled = coalesce((r ->> 'enabled')::boolean, true), link_code = upper(nullif(r ->> 'linkCode', '')),
        levels = coalesce((select array_agg(x) from jsonb_array_elements_text(r -> 'levels') x), '{ATP,ATP Q,CH,CH Q}'),
        drop_min = coalesce((r ->> 'dropMin')::numeric, 2), drop_max = (r ->> 'dropMax')::numeric,
        price_min = coalesce((r ->> 'priceMin')::numeric, 1.01), price_max = (r ->> 'priceMax')::numeric,
        window_min = coalesce((r ->> 'windowMin')::int, 180), steps_only = coalesce((r ->> 'stepsOnly')::boolean, false),
        books = coalesce((select array_agg(x) from jsonb_array_elements_text(r -> 'books') x), '{Bet105,Kalshi}'),
        daily_cap = coalesce((r ->> 'dailyCap')::int, 0), quiet_from = nullif(r ->> 'quietFrom', ''),
        quiet_to = nullif(r ->> 'quietTo', ''), tz = coalesce(nullif(r ->> 'tz', ''), 'Europe/Brussels'), updated_at = now()
     where uid = r ->> 'uid';
    if not found then
      insert into sharp_bot.members (uid, name, admin, enabled, link_code, levels, drop_min, drop_max, price_min, price_max,
          window_min, steps_only, books, daily_cap, quiet_from, quiet_to, tz, updated_at)
      values (r ->> 'uid', r ->> 'name', coalesce((r ->> 'admin')::boolean, false), coalesce((r ->> 'enabled')::boolean, true),
          upper(nullif(r ->> 'linkCode', '')),
          coalesce((select array_agg(x) from jsonb_array_elements_text(r -> 'levels') x), '{ATP,ATP Q,CH,CH Q}'),
          coalesce((r ->> 'dropMin')::numeric, 2), (r ->> 'dropMax')::numeric,
          coalesce((r ->> 'priceMin')::numeric, 1.01), (r ->> 'priceMax')::numeric,
          coalesce((r ->> 'windowMin')::int, 180), coalesce((r ->> 'stepsOnly')::boolean, false),
          coalesce((select array_agg(x) from jsonb_array_elements_text(r -> 'books') x), '{Bet105,Kalshi}'),
          coalesce((r ->> 'dailyCap')::int, 0), nullif(r ->> 'quietFrom', ''), nullif(r ->> 'quietTo', ''),
          coalesce(nullif(r ->> 'tz', ''), 'Europe/Brussels'), now());
    end if;
    n := n + 1;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('uid', uid, 'linked', chat_id is not null, 'paused', tg_paused,
                                               'linkedAt', linked_at)), '[]'::jsonb) into out from sharp_bot.members;
  return jsonb_build_object('upserted', n, 'members', out);
end $$;
revoke all on function public.sharp_members_upsert(jsonb) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function public.sharp_members_upsert(jsonb) from anon, authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function public.sharp_members_upsert(jsonb) to service_role'; end if;
end $$;

-- The record for the page: every alert of the last p_days with its grade (no member data).
create or replace function public.sharp_feed(p_days integer default 60) returns jsonb
language sql stable security definer set search_path = public, sharp_bot as $$
  select jsonb_build_object('generatedAt', now(), 'alerts', coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'eventKey', a.event_key, 'level', a.level, 'tournament', a.tournament, 'player', a.player,
      'opponent', a.opponent, 'start', a.start_utc, 'at', a.alert_at, 'before', a.price_before, 'price', a.price,
      'drop', a.drop_pct, 'steps', a.steps, 'betAt', a.bet_at, 'mins', a.mins_to_start,
      'kalshi', a.kalshi_odds, 'kalshiSize', a.kalshi_size,
      'result', g.result, 'close', g.close_price, 'edge', g.edge_pct, 'pl', g.pl_bet105, 'plBetAt', g.pl_bet_at,
      'gradeNote', g.note) order by a.alert_at desc), '[]'::jsonb))
    from sharp_bot.alerts a left join sharp_bot.grades g on g.alert_id = a.id
   where a.alert_at > now() - make_interval(days => least(greatest(p_days, 1), 400))
$$;
revoke all on function public.sharp_feed(integer) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'grant execute on function public.sharp_feed(integer) to anon, authenticated'; end if;
end $$;

create or replace function sharp_bot.report(p_hours integer default 24) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'config', (select to_jsonb(c) - 'tg_offset' from sharp_bot.config c),
    'alerts', (select count(*) from sharp_bot.alerts where created_at > now() - make_interval(hours => p_hours)),
    'byLevel', (select jsonb_object_agg(level, n) from (select level, count(*) n from sharp_bot.alerts
                 where created_at > now() - make_interval(hours => p_hours) group by level) x),
    'deliveries', (select jsonb_object_agg(status, n) from (select status, count(*) n from sharp_bot.deliveries
                    where created_at > now() - make_interval(hours => p_hours) group by status) y),
    'members', (select count(*) from sharp_bot.members), 'linked', (select count(*) from sharp_bot.members where chat_id is not null),
    'graded', (select count(*) from sharp_bot.grades),
    'record', (select jsonb_build_object('n', count(*), 'won', count(*) filter (where result = 'W'),
                 'lost', count(*) filter (where result = 'L'), 'units', round(sum(pl_bet105), 2),
                 'edgeAvg', round(avg(edge_pct), 2)) from sharp_bot.grades where result in ('W', 'L')))
$$;
