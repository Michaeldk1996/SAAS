-- TEN-287 — odds-api.io RECORDER for Betfair Exchange + Superbet (founder answer b758d347, 2026-09-25:
-- "Build the RECORDER only (poller + ticks, no alerts), 3–7 days, then a backtest you see first").
--
-- RECORD ONLY. Nothing here sends anything anywhere: no Telegram, no alert table, no page data.
-- Separate from the Bet105 bot: own schema (ten287_rec), own cron jobs; never reads or writes ten280_bot.
--
-- Runtime: pg_cron -> pg_net. Measured 2026-09-25 (run 36201161280): pg_net with its DEFAULT headers
-- decompresses odds-api.io's gzip and the keyed /odds/updated call returns 200 JSON; forcing
-- `Accept-Encoding: identity` makes the vendor send raw gzip that pg_net cannot read — never set it.
--
--   ten287-recorder        every 30 s: ingest finished responses, then fire /odds/updated for each book
--                          (since = now − 60 s; the vendor allows ≤ 90 s, so consecutive windows overlap and
--                          the unique key drops the repeats).
--   ten287-recorder-sweep  every 10 min: /events listing + /odds/multi for every pending/live men's-singles
--                          event (both books, one call per 10 events) — reconciles anything a lost poll missed.
--
-- Budget guard: nothing fires while the last seen x-ratelimit-remaining is below config.min_remaining.
-- Stop: select cron.unschedule('ten287-recorder'); select cron.unschedule('ten287-recorder-sweep');

create schema if not exists ten287_rec;
revoke all on schema ten287_rec from public, anon, authenticated;

create table if not exists ten287_rec.config (
    id            boolean primary key default true check (id),
    books         text[]  not null default array['Betfair Exchange', 'Superbet'],
    min_remaining integer not null default 1500
);
insert into ten287_rec.config (id) values (true) on conflict (id) do nothing;

-- one row per pg_net request we fired (the request id IS the pg_net id)
create table if not exists ten287_rec.requests (
    id            bigint primary key,
    kind          text not null,              -- updated | events | multi
    book          text,                       -- updated only
    fired_at      timestamptz not null default now(),
    processed_at  timestamptz,
    status_code   integer,
    n_items       integer,
    ratelimit_remaining integer,
    note          text                        -- error text, key-scrubbed
);
create index if not exists requests_open_idx on ten287_rec.requests (processed_at) where processed_at is null;

create table if not exists ten287_rec.events (
    event_id      bigint primary key,
    home          text,
    away          text,
    start_at      timestamptz,                -- the vendor's scheduled `date`
    status        text,
    league        text,
    tier          text,                       -- ATP | Challenger | ITF Men | NULL (anything else, incl. doubles)
    bookmaker_ids jsonb,
    first_seen    timestamptz not null default now(),
    last_seen     timestamptz not null default now()
);

-- one row per distinct ML state per book. Prices are the vendor's strings parsed to numeric;
-- a value that does not parse is NULL (a dash), never a default.
create table if not exists ten287_rec.ticks (
    id              bigserial primary key,
    book            text not null,
    event_id        bigint not null,
    market          text not null default 'ML',
    back_home       numeric, back_away numeric,
    lay_home        numeric, lay_away  numeric,           -- Betfair Exchange only
    depth_home      numeric, depth_away numeric,          -- at the best back price (Betfair Exchange only)
    depth_lay_home  numeric, depth_lay_away numeric,      -- at the best lay price (Betfair Exchange only)
    book_updated_at timestamptz,                          -- the market's `updatedAt`
    seen_at         timestamptz not null,                 -- when our response arrived
    event_status    text,
    src             text not null,                        -- updated | multi | selftest
    state_md5       text not null
);
create unique index if not exists ticks_state_uq on ten287_rec.ticks (book, event_id, market, book_updated_at, state_md5);
create index if not exists ticks_event_idx on ten287_rec.ticks (event_id, book, seen_at);

create or replace function ten287_rec.num(p text) returns numeric
language plpgsql immutable as $$
begin
  return nullif(btrim(p), '')::numeric;
exception when others then
  return null;
end $$;

create or replace function ten287_rec.tier(p_league text, p_home text) returns text
language sql immutable as $$
  select case
    when coalesce(p_home, '') like '%/%' then null
    when p_league like 'ATP - %' then 'ATP'
    when p_league like 'Challenger - %' then 'Challenger'
    when p_league like '%ITF Men%' then 'ITF Men'
    else null end
$$;

create or replace function ten287_rec.api_key() returns text
language sql stable security definer set search_path = '' as $$
  -- the stored secret carries stray quotes/whitespace (TEN-280); strip them here, never print it
  select btrim(regexp_replace(decrypted_secret, '^apikey=', '', 'i'), E' \t\r\n"''')
  from vault.decrypted_secrets where name = 'ten287_odds_api_io_key'
$$;
revoke all on function ten287_rec.api_key() from public, anon, authenticated;

create or replace function ten287_rec.scrub(p text) returns text
language sql immutable as $$
  select left(regexp_replace(coalesce(p, ''), 'apiKey=[^&\s"]*', 'apiKey=***', 'gi'), 500)
$$;

-- one vendor event object -> events upsert + one ML tick per book present
create or replace function ten287_rec.ingest_event(p_ev jsonb, p_seen timestamptz, p_src text) returns integer
language plpgsql as $$
declare
  eid bigint := (p_ev->>'id')::bigint;
  bk  text; m jsonb; o jsonb; n int := 0; k int;
begin
  if eid is null then return 0; end if;
  insert into ten287_rec.events as e (event_id, home, away, start_at, status, league, tier, bookmaker_ids, first_seen, last_seen)
  values (eid, p_ev->>'home', p_ev->>'away', (p_ev->>'date')::timestamptz, p_ev->>'status', p_ev->'league'->>'name',
          ten287_rec.tier(p_ev->'league'->>'name', p_ev->>'home'), p_ev->'bookmakerIds', p_seen, p_seen)
  on conflict (event_id) do update set
      home = coalesce(excluded.home, e.home), away = coalesce(excluded.away, e.away),
      start_at = coalesce(excluded.start_at, e.start_at), status = coalesce(excluded.status, e.status),
      league = coalesce(excluded.league, e.league),
      tier = ten287_rec.tier(coalesce(excluded.league, e.league), coalesce(excluded.home, e.home)),
      bookmaker_ids = coalesce(e.bookmaker_ids, '{}'::jsonb) || coalesce(excluded.bookmaker_ids, '{}'::jsonb),
      last_seen = greatest(e.last_seen, excluded.last_seen);
  for bk in select jsonb_object_keys(coalesce(p_ev->'bookmakers', '{}'::jsonb)) loop
    if not bk = any ((select books from ten287_rec.config)) then continue; end if;
    for m in select * from jsonb_array_elements(case when jsonb_typeof(p_ev->'bookmakers'->bk) = 'array' then p_ev->'bookmakers'->bk else '[]'::jsonb end) loop
      if m->>'name' is distinct from 'ML' then continue; end if;
      o := m->'odds'->0;
      if o is null then continue; end if;
      insert into ten287_rec.ticks (book, event_id, market, back_home, back_away, lay_home, lay_away,
                                    depth_home, depth_away, depth_lay_home, depth_lay_away,
                                    book_updated_at, seen_at, event_status, src, state_md5)
      values (bk, eid, 'ML', ten287_rec.num(o->>'home'), ten287_rec.num(o->>'away'),
              ten287_rec.num(o->>'layHome'), ten287_rec.num(o->>'layAway'),
              ten287_rec.num(o->>'depthHome'), ten287_rec.num(o->>'depthAway'),
              ten287_rec.num(o->>'depthLayHome'), ten287_rec.num(o->>'depthLayAway'),
              (m->>'updatedAt')::timestamptz, p_seen, p_ev->>'status', p_src, md5(o::text))
      on conflict do nothing;
      get diagnostics k = row_count; n := n + k;
    end loop;
  end loop;
  return n;
end $$;

-- read every finished response for our open requests; a request with no response after 3 min is closed as lost
create or replace function ten287_rec.ingest() returns integer
language plpgsql as $$
declare
  r record; body jsonb; ev jsonb; n int := 0; items int;
begin
  for r in
    select q.id, q.kind, q.fired_at, x.status_code, x.content, x.error_msg, x.timed_out, x.created,
           (x.headers->>'x-ratelimit-remaining')::int as rl
    from ten287_rec.requests q
    left join net._http_response x on x.id = q.id
    where q.processed_at is null
      and (x.id is not null or q.fired_at < now() - interval '3 minutes')
    order by q.id
  loop
    if r.created is null then
      update ten287_rec.requests set processed_at = now(), note = 'lost: no pg_net response within 3 min' where id = r.id;
      continue;
    end if;
    items := null;
    if r.status_code = 200 then
      begin
        body := r.content::jsonb;
      exception when others then
        body := null;
      end;
      if jsonb_typeof(body) = 'array' then
        items := jsonb_array_length(body);
        for ev in select * from jsonb_array_elements(body) loop
          n := n + ten287_rec.ingest_event(ev, r.created, case r.kind when 'events' then 'events' else r.kind end);
        end loop;
      end if;
    end if;
    update ten287_rec.requests set processed_at = now(), status_code = r.status_code, n_items = items,
           ratelimit_remaining = r.rl,
           note = case when r.status_code = 200 and items is not null then null
                       else ten287_rec.scrub(coalesce(r.error_msg, left(r.content, 300)) || case when r.timed_out then ' (timed out)' else '' end) end
    where id = r.id;
  end loop;
  return n;
end $$;

create or replace function ten287_rec.budget_ok() returns boolean
language sql stable as $$
  select coalesce((select ratelimit_remaining from ten287_rec.requests
                   where ratelimit_remaining is not null order by id desc limit 1), 999999)
         >= (select min_remaining from ten287_rec.config)
$$;

-- every 30 s
create or replace function ten287_rec.tick() returns integer
language plpgsql security definer set search_path = ten287_rec, public as $$
declare bk text; rid bigint; key text := ten287_rec.api_key(); n int;
begin
  n := ten287_rec.ingest();
  if key is null or not ten287_rec.budget_ok() then return n; end if;
  foreach bk in array (select books from ten287_rec.config) loop
    select net.http_get(url := 'https://api.odds-api.io/v3/odds/updated',
             params := jsonb_build_object('apiKey', key, 'since', (extract(epoch from now())::bigint - 60)::text,
                                          'bookmaker', bk, 'sport', 'tennis', 'markets', 'ML'),
             timeout_milliseconds := 20000) into rid;
    insert into ten287_rec.requests (id, kind, book) values (rid, 'updated', bk);
  end loop;
  return n;
end $$;

-- every 10 min
create or replace function ten287_rec.sweep() returns integer
language plpgsql security definer set search_path = ten287_rec, public as $$
declare key text := ten287_rec.api_key(); ids text; rid bigint; batches int := 0;
begin
  if key is null or not ten287_rec.budget_ok() then return 0; end if;
  select net.http_get(url := 'https://api.odds-api.io/v3/events',
           params := jsonb_build_object('apiKey', key, 'sport', 'tennis', 'limit', '5000',
                                        'from', to_char((now() - interval '4 hours') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                        'to',   to_char((now() + interval '48 hours') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
           timeout_milliseconds := 30000) into rid;
  insert into ten287_rec.requests (id, kind) values (rid, 'events');
  for ids in
    select string_agg(event_id::text, ',' order by event_id)
    from (select event_id, (row_number() over (order by event_id) - 1) / 10 as b
          from ten287_rec.events
          where tier is not null and status in ('pending', 'live')
            and start_at between now() - interval '4 hours' and now() + interval '48 hours') s
    group by b
  loop
    select net.http_get(url := 'https://api.odds-api.io/v3/odds/multi?eventIds=' || ids
                               || '&bookmakers=' || (select string_agg(replace(b, ' ', '%20'), ',') from unnest((select books from ten287_rec.config)) b)
                               || '&apiKey=' || key,
             timeout_milliseconds := 30000) into rid;
    insert into ten287_rec.requests (id, kind) values (rid, 'multi');
    batches := batches + 1;
  end loop;
  return batches;
end $$;

revoke all on all tables in schema ten287_rec from public, anon, authenticated;
revoke all on all functions in schema ten287_rec from public, anon, authenticated;
