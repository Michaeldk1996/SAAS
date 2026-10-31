-- Telegram drop bots: ATP-only POSTING scope (founder task "telegram-bot-scope", 2026-10-30).
--
-- What it does: the two live drop bots (ten280_bot = Bet105, ten287_bot = Superbet) post a live alert to Telegram only
-- when its api-tennis fixture is ATP main draw or ATP qualifying: event_type_type = 'Atp Singles' (api-tennis files ATP
-- qualifying under the same type with event_qualification = 'True', e.g. event 12171713, Almaty 2026, "ATP Almaty -
-- Semi-finals", qualifying). Every other alert is still RECORDED (same row, same table, same drops page) and only its
-- `delivery` reads 'held: …' instead of being sent.
--
-- How: a BEFORE INSERT trigger on each bot's alerts table. The bots' tick() sends only rows whose delivery is 'unsent',
-- so a held row is never sent; the bots' own functions are not changed, so a re-install of a bot from its branch keeps
-- this scope (CREATE TABLE IF NOT EXISTS never drops a trigger). The drops endpoint (drops_api.snapshot) does not read
-- `delivery`, so the website keeps every alert, ATP, Challenger and ITF.
--
-- The fixture list: drops_scope.fixture, api-tennis get_fixtures (timezone=UTC, yesterday .. +4 days), written every
-- pipeline run by tools/drops-scope-fixtures.mjs through public.drops_scope_ingest(). Join = the drops endpoint's own
-- rule (stennisfy-drops/status.mjs samePair + sk): both surnames (accents, hyphens, Jr/Sr/II/III/IV ignored), the
-- given-name initials agree, either orientation, a fixture start within 24 h of the vendor's start (none: 12 h before
-- to 4 days after the alert), exactly ONE event key. No fixture, two fixtures, or an error = held, never a guess.
-- A row held only because no fixture matched YET is re-checked for 30 min (drops_scope.recheck, pg_cron each minute)
-- and released to 'unsent' if its fixture arrives and is ATP; past 30 min it stays held (a late drop is stale).
--
-- Rollback: drop the two triggers (drops_scope_scope on each alerts table); every row is then posted as before.
-- Additive and idempotent. Changes no bot function and no existing column.

create schema if not exists drops_scope;
revoke all on schema drops_scope from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema drops_scope from anon, authenticated'; end if;
end $$;

create table if not exists drops_scope.fixture (
    event_key            bigint primary key,
    event_date           date,
    event_time           text,
    start_utc            timestamptz,
    first_player         text,
    second_player        text,
    sk1                  text,
    sk2                  text,
    event_type_type      text,
    event_qualification  text,
    tournament_name      text,
    tournament_round     text,
    seen_at              timestamptz not null default now()
);
create index if not exists fixture_pair_idx on drops_scope.fixture (sk1, sk2);

create table if not exists drops_scope.feed (
    id           boolean primary key default true check (id),
    last_ok_at   timestamptz,
    last_rows    integer,
    last_window  text
);
insert into drops_scope.feed (id) values (true) on conflict (id) do nothing;

-- One row per verdict the trigger or the re-check made: the audit trail of what was posted or held and why.
create table if not exists drops_scope.verdict_log (
    id                   bigserial primary key,
    bot                  text        not null,      -- 'ten280' (Bet105) | 'ten287' (Superbet)
    alert_id             bigint      not null,
    verdict              text        not null,      -- 'post' | 'held: …'
    event_key            bigint,
    event_type_type      text,
    event_qualification  text,
    candidates           integer,
    by_recheck           boolean     not null default false,
    at                   timestamptz not null default now()
);
create index if not exists verdict_log_alert_idx on drops_scope.verdict_log (bot, alert_id);

-- Name keys: a port of stennisfy-drops/status.mjs sk() and initials(), so the bot and the drops page join alike.
create or replace function drops_scope.deaccent(n text) returns text language sql immutable as $$
  select regexp_replace(normalize(coalesce(n, ''), nfd), '[\u0300-\u036f]', '', 'g')
$$;
-- surname key: "Last, First" -> Last; hyphens split; a trailing Jr / Sr / II / III / IV dropped; the last token, a-z only
create or replace function drops_scope.sk(n text) returns text language sql immutable as $$
  select nullif(lower(regexp_replace(regexp_replace(regexp_replace(btrim(replace(split_part(drops_scope.deaccent(n), ',', 1), '-', ' ')),
                '\s+(jr|sr|ii|iii|iv)\.?$', '', 'i'), '^.*\s', ''), '[^A-Za-z]', '', 'g')), '')
$$;
-- every given name's initial: "Adolfo Daniel Vallejo" -> {a,d}; "D. Vallejo" -> {d}; "Damm, Martin" -> {m}; "Vallejo" -> {}
create or replace function drops_scope.inits(n text) returns text[] language sql immutable as $$
  select coalesce((select array_agg(distinct left(m[1], 1)) from regexp_matches(
           case when position(',' in v) > 0 then substr(v, position(',' in v) + 1)
                else coalesce(substring(btrim(v) from '^(.*)\s\S+$'), '') end, '([a-z]+)', 'g') m), '{}'::text[])
    from (select lower(drops_scope.deaccent(n)) v) s
$$;
-- one player: surnames equal, and the initials agree unless both carry some and share none
create or replace function drops_scope.same(x text, y text) returns boolean language sql immutable as $$
  select drops_scope.sk(x) is not null and drops_scope.sk(x) = drops_scope.sk(y)
     and (cardinality(drops_scope.inits(x)) = 0 or cardinality(drops_scope.inits(y)) = 0
          or drops_scope.inits(x) && drops_scope.inits(y))
$$;

-- The verdict for one alert: 'post' only for exactly one api-tennis fixture of type 'Atp Singles'.
create or replace function drops_scope.verdict(p_a text, p_b text, p_start timestamptz, p_at timestamptz,
    out verdict text, out event_key bigint, out event_type_type text, out event_qualification text, out candidates integer)
language plpgsql stable as $$
declare ka text := drops_scope.sk(p_a); kb text := drops_scope.sk(p_b); fresh boolean; ek bigint;
begin
  select count(distinct f.event_key), min(f.event_key) into candidates, ek
    from drops_scope.fixture f
   where ((f.sk1 = ka and f.sk2 = kb) or (f.sk1 = kb and f.sk2 = ka))
     and position('/' in coalesce(f.first_player, '') || coalesce(f.second_player, '')) = 0
     and ((drops_scope.same(p_a, f.first_player) and drops_scope.same(p_b, f.second_player))
       or (drops_scope.same(p_a, f.second_player) and drops_scope.same(p_b, f.first_player)))
     and case when p_start is not null then abs(extract(epoch from (f.start_utc - p_start))) < 86400
              else f.start_utc between p_at - interval '12 hours' and p_at + interval '4 days' end;
  if candidates > 1 then verdict := 'held: two api-tennis fixtures match'; return; end if;
  if candidates = 0 then
    select coalesce(last_ok_at > now() - interval '45 minutes', false) into fresh from drops_scope.feed;
    verdict := case when fresh then 'held: no api-tennis fixture' else 'held: no api-tennis fixture (fixture list stale)' end;
    return;
  end if;
  event_key := ek;
  select f.event_type_type, f.event_qualification into event_type_type, event_qualification
    from drops_scope.fixture f where f.event_key = ek;
  verdict := case when event_type_type = 'Atp Singles' then 'post'
                  else 'held: not ATP (' || coalesce(event_type_type, 'no type') || ')' end;
end $$;

-- the trigger body, shared by both bots
create or replace function drops_scope.apply(p_bot text, p_id bigint, p_a text, p_b text, p_start timestamptz,
    p_at timestamptz, p_recheck boolean) returns text
language plpgsql as $$
declare v record;
begin
  select * into v from drops_scope.verdict(p_a, p_b, p_start, p_at);
  insert into drops_scope.verdict_log (bot, alert_id, verdict, event_key, event_type_type, event_qualification, candidates, by_recheck)
  values (p_bot, p_id, v.verdict, v.event_key, v.event_type_type, v.event_qualification, v.candidates, p_recheck);
  return v.verdict;
exception when others then
  return 'held: scope check failed';     -- never post what could not be checked; the re-check tries again
end $$;

create or replace function drops_scope.on_ten280_alert() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare st timestamptz; v text;
begin
  if new.mode <> 'live' or new.delivery <> 'unsent' then return new; end if;
  begin
    select f.scheduled_start into st from public.kibl_fixtures f where f.fixture_id = new.fixture_id;
  exception when others then st := null;
  end;
  v := drops_scope.apply('ten280', new.id, new.player_a, new.player_b, st, new.eval_at, false);
  if v <> 'post' then new.delivery := v; end if;
  return new;
end $$;

create or replace function drops_scope.on_ten287_alert() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare st timestamptz; v text;
begin
  if new.mode <> 'live' or new.delivery <> 'unsent' then return new; end if;
  begin
    select e.start_at into st from ten287_rec.events e where e.event_id = new.event_id;
  exception when others then st := null;
  end;
  v := drops_scope.apply('ten287', new.id, new.player_a, new.player_b, st, new.eval_at, false);
  if v <> 'post' then new.delivery := v; end if;
  return new;
end $$;

drop trigger if exists drops_scope_scope on ten280_bot.alerts;
create trigger drops_scope_scope before insert on ten280_bot.alerts
  for each row execute function drops_scope.on_ten280_alert();
drop trigger if exists drops_scope_scope on ten287_bot.alerts;
create trigger drops_scope_scope before insert on ten287_bot.alerts
  for each row execute function drops_scope.on_ten287_alert();

-- Re-check rows held only for want of a fixture (or a failed check) for 30 min after the drop; release an ATP one.
create or replace function drops_scope.recheck() returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r record; v text; n integer := 0; st timestamptz;
begin
  if not pg_try_advisory_xact_lock(287281) then return 0; end if;
  for r in select a.id, a.player_a, a.player_b, a.eval_at, a.fixture_id from ten280_bot.alerts a
            where a.mode = 'live' and a.eval_at > now() - interval '30 minutes'
              and a.delivery in ('held: no api-tennis fixture', 'held: no api-tennis fixture (fixture list stale)', 'held: scope check failed') loop
    select f.scheduled_start into st from public.kibl_fixtures f where f.fixture_id = r.fixture_id;
    v := drops_scope.apply('ten280', r.id, r.player_a, r.player_b, st, r.eval_at, true);
    update ten280_bot.alerts set delivery = case when v = 'post' then 'unsent' else v end
     where id = r.id and delivery like 'held:%';
    if v = 'post' then n := n + 1; end if;
  end loop;
  for r in select a.id, a.player_a, a.player_b, a.eval_at, a.event_id from ten287_bot.alerts a
            where a.mode = 'live' and a.eval_at > now() - interval '30 minutes'
              and a.delivery in ('held: no api-tennis fixture', 'held: no api-tennis fixture (fixture list stale)', 'held: scope check failed') loop
    select e.start_at into st from ten287_rec.events e where e.event_id = r.event_id;
    v := drops_scope.apply('ten287', r.id, r.player_a, r.player_b, st, r.eval_at, true);
    update ten287_bot.alerts set delivery = case when v = 'post' then 'unsent' else v end
     where id = r.id and delivery like 'held:%';
    if v = 'post' then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- The writer: service_role only (the pipeline's key). p_rows = [{event_key, event_date, event_time, first, second,
-- type, qual, tournament, round}], times in UTC (the caller asks api-tennis with timezone=UTC).
create or replace function public.drops_scope_ingest(p_rows jsonb, p_window text) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare n integer;
begin
  insert into drops_scope.fixture as f (event_key, event_date, event_time, start_utc, first_player, second_player, sk1, sk2,
                                         event_type_type, event_qualification, tournament_name, tournament_round, seen_at)
  select (r->>'event_key')::bigint, (r->>'event_date')::date, r->>'event_time',
         case when r->>'event_date' ~ '^\d{4}-\d\d-\d\d$' then
           ((r->>'event_date') || ' ' || case when coalesce(r->>'event_time', '') ~ '^\d\d:\d\d$' then r->>'event_time' else '00:00' end)::timestamp
             at time zone 'UTC' end,
         r->>'first', r->>'second', drops_scope.sk(r->>'first'), drops_scope.sk(r->>'second'),
         r->>'type', r->>'qual', r->>'tournament', r->>'round', now()
    from (select distinct on (r->>'event_key') r from jsonb_array_elements(p_rows) r
           where coalesce(r->>'event_key', '') ~ '^\d+$' order by r->>'event_key') d(r)
  on conflict (event_key) do update set event_date = excluded.event_date, event_time = excluded.event_time,
      start_utc = excluded.start_utc, first_player = excluded.first_player, second_player = excluded.second_player,
      sk1 = excluded.sk1, sk2 = excluded.sk2, event_type_type = excluded.event_type_type,
      event_qualification = excluded.event_qualification, tournament_name = excluded.tournament_name,
      tournament_round = excluded.tournament_round, seen_at = excluded.seen_at;
  get diagnostics n = row_count;
  -- WHERE true: Supabase's pg_safeupdate refuses a bare UPDATE on a REST call (HTTP 400, the first install, 31 Oct)
  update drops_scope.feed set last_ok_at = now(), last_rows = n, last_window = p_window where true;
  delete from drops_scope.fixture where start_utc < now() - interval '10 days';
  delete from drops_scope.verdict_log where at < now() - interval '60 days';
  return n;
end $$;
revoke all on function public.drops_scope_ingest(jsonb, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.drops_scope_ingest(jsonb, text) from anon, authenticated';
    execute 'grant execute on function public.drops_scope_ingest(jsonb, text) to service_role';
  end if;
end $$;

-- The read-back for the install / report job (no secret, no player-level data beyond what the drops page shows).
create or replace function drops_scope.report(p_hours integer default 24) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'feed', (select to_jsonb(f) from drops_scope.feed f),
    'fixturesByType', (select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) from (
        select coalesce(event_type_type, '—') || ' · qualification ' || coalesce(event_qualification, '—') k, count(*) c
          from drops_scope.fixture group by 1) x),
    'verdicts', (select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) from (
        select bot || ' · ' || verdict k, count(*) c from drops_scope.verdict_log
         where at > now() - make_interval(hours => p_hours) and not by_recheck group by 1) y),
    'released', (select count(*) from drops_scope.verdict_log
                  where at > now() - make_interval(hours => p_hours) and by_recheck and verdict = 'post'),
    'delivery', (select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) from (
        select 'ten280 · ' || delivery k, count(*) c from ten280_bot.alerts
         where mode = 'live' and created_at > now() - make_interval(hours => p_hours) group by 1
        union all
        select 'ten287 · ' || delivery, count(*) from ten287_bot.alerts
         where mode = 'live' and created_at > now() - make_interval(hours => p_hours) group by 1) z))
$$;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('drops-scope-recheck', '* * * * *', 'select drops_scope.recheck()');
  end if;
end $$;
