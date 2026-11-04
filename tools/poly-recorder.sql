-- POLYMARKET RECORDER on Polymarket's own free feed (founder 2026-11-04: "build the polymarket one", so the odds-api.io
-- slot that carries Polymarket can go to a bookmaker — Napoleon Sports BE). The live worker (tools/live-arb-recorder.mjs,
-- live-arb.yml, always on) follows every ATP / Challenger Polymarket match on the public CLOB websocket and, every 15 s,
-- hands the best ask + the dollars at it per player to public.poly_rec_push. This writes ten287_rec.events / ticks in
-- the odds-api.io recorder's own shape, so the Polymarket drop bot, the arbitrage engine, the Odds tab chart and the
-- Dropping Odds box read it unchanged:
--   back price  = 1 / best ask (decimal, 3 dp)          depth = shares at the best ask × the ask (dollars)
--   event       = 900 000 000 000 + the Polymarket event id (never an odds-api.io id)
--   status      = 'pending' until Polymarket marks the match live / ended, then 'live' / 'ended'
--   league/tier = from the api-tennis fixture the match joins (drops_scope.fixture: both players, start ± 24 h, exactly
--                 one) — 'ATP - <event>' / 'Challenger - <event>'; no single fixture → tier NULL (the bots never read it)
--   a tick is written when a price changes, the dollars at it move by ≥ 20 %, or 5 min after the last one
--   liveness    = one ten287_rec.requests row per push (status 200), read by the engine's "recorder answered" test
-- PARALLEL RUN: the label is polyrec.config.book — 'Polymarket CLOB' at install, beside odds-api.io's 'Polymarket', so
-- nothing doubles. polyrec.compare() sets the two side by side. polyrec.switch() (one transaction) renames ours to
-- 'Polymarket' and takes 'Polymarket' out of ten287_rec.config.books, so odds-api.io stops recording it.
-- Idempotent; schedules nothing.
create schema if not exists polyrec;
revoke all on schema polyrec from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema polyrec from anon, authenticated'; end if;
end $$;

create table if not exists polyrec.config (
    id         boolean primary key default true check (id),
    book       text     not null default 'Polymarket CLOB',
    depth_move numeric  not null default 0.20,
    refresh    interval not null default interval '5 minutes'
);
insert into polyrec.config (id) values (true) on conflict (id) do nothing;
alter table polyrec.config enable row level security;
create sequence if not exists polyrec.req_seq start 1;
-- the last state we wrote per event (the change test)
create table if not exists polyrec.last (
    event_id  bigint primary key,
    back_home numeric, back_away numeric, depth_home numeric, depth_away numeric, status text, at timestamptz
);
alter table polyrec.last enable row level security;

-- one Polymarket match → its single api-tennis fixture (ATP / Challenger singles), or null
create or replace function polyrec.fixture_of(p_a text, p_b text, p_start timestamptz) returns table(event_type text, tournament text)
language sql stable as $$
  with c as (
    select f.event_type_type, f.tournament_name from drops_scope.fixture f
     where f.event_type_type in ('Atp Singles', 'Challenger Men Singles')
       and ((drops_scope.same(f.first_player, p_a) and drops_scope.same(f.second_player, p_b))
         or (drops_scope.same(f.first_player, p_b) and drops_scope.same(f.second_player, p_a)))
       and (p_start is null or abs(extract(epoch from f.start_utc - p_start)) < 86400)
  )
  select event_type_type, tournament_name from c where (select count(*) from c) = 1
$$;

-- the worker's push: {rows: [{pmId, title, a, b, start, live, ended, askA, askB, sizeA, sizeB}], worker: {...}}
create or replace function public.poly_rec_push(p jsonb) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare c polyrec.config; r jsonb; eid bigint; bh numeric; ba numeric; dh numeric; da numeric; st text; l polyrec.last;
        fx record; lg text; n integer := 0; now_ timestamptz := now(); rid bigint;
begin
  select * into c from polyrec.config;
  rid := -nextval('polyrec.req_seq');   -- negative: never an odds-api.io / pg_net id
  insert into ten287_rec.requests (id, kind, book, fired_at, processed_at, status_code, n_items, note)
  values (rid, 'clob', c.book, now_, now_, 200, jsonb_array_length(coalesce(p->'rows', '[]'::jsonb)), 'polymarket clob push');
  for r in select * from jsonb_array_elements(coalesce(p->'rows', '[]'::jsonb)) loop
    continue when coalesce(r->>'pmId', '') !~ '^\d+$' or coalesce(r->>'a', '') = '' or coalesce(r->>'b', '') = '';
    eid := 900000000000 + (r->>'pmId')::bigint;
    bh := case when (r->>'askA')::numeric > 0 and (r->>'askA')::numeric < 1 then round(1 / (r->>'askA')::numeric, 3) end;
    ba := case when (r->>'askB')::numeric > 0 and (r->>'askB')::numeric < 1 then round(1 / (r->>'askB')::numeric, 3) end;
    dh := round((r->>'sizeA')::numeric * (r->>'askA')::numeric, 2);
    da := round((r->>'sizeB')::numeric * (r->>'askB')::numeric, 2);
    st := case when (r->>'ended')::boolean then 'ended' when (r->>'live')::boolean then 'live' else 'pending' end;
    select * into fx from polyrec.fixture_of(r->>'a', r->>'b', (r->>'start')::timestamptz);
    lg := case fx.event_type when 'Atp Singles' then 'ATP - ' when 'Challenger Men Singles' then 'Challenger - ' end
          || coalesce(fx.tournament, split_part(r->>'title', ':', 1));
    insert into ten287_rec.events as e (event_id, home, away, start_at, status, league, tier, first_seen, last_seen)
    values (eid, r->>'a', r->>'b', (r->>'start')::timestamptz, st, lg, ten287_rec.tier(lg, r->>'a'), now_, now_)
    on conflict (event_id) do update set status = excluded.status, start_at = coalesce(excluded.start_at, e.start_at),
        league = coalesce(excluded.league, e.league), tier = coalesce(excluded.tier, e.tier), last_seen = now_;
    select * into l from polyrec.last where event_id = eid;
    if not found or l.back_home is distinct from bh or l.back_away is distinct from ba or l.status is distinct from st
       or l.at < now_ - c.refresh
       or abs(coalesce(dh, 0) - coalesce(l.depth_home, 0)) > c.depth_move * greatest(coalesce(l.depth_home, 0), 1)
       or abs(coalesce(da, 0) - coalesce(l.depth_away, 0)) > c.depth_move * greatest(coalesce(l.depth_away, 0), 1) then
      insert into ten287_rec.ticks (book, event_id, market, back_home, back_away, depth_home, depth_away,
                                    book_updated_at, seen_at, event_status, src, state_md5)
      values (c.book, eid, 'ML', bh, ba, dh, da, now_, now_, st, 'clob', md5(concat_ws('|', bh, ba, dh, da, st)))
      on conflict do nothing;
      insert into polyrec.last values (eid, bh, ba, dh, da, st, now_)
      on conflict (event_id) do update set back_home = bh, back_away = ba, depth_home = dh, depth_away = da, status = st, at = now_;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.poly_rec_push(jsonb) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.poly_rec_push(jsonb) from anon, authenticated';
    execute 'grant execute on function public.poly_rec_push(jsonb) to service_role';
  end if;
end $$;

-- side by side for the parallel run: each match both feeds price now (latest pre-match tick each), by names + start
create or replace function polyrec.compare(p_hours integer default 6) returns jsonb
language sql stable as $$
  with ours as (
    select distinct on (t.event_id) e.home, e.away, e.start_at, t.back_home, t.back_away, t.depth_home, t.seen_at
      from ten287_rec.ticks t join ten287_rec.events e using (event_id)
     where t.book = (select book from polyrec.config) and t.book <> 'Polymarket' and t.event_status = 'pending'
       and t.seen_at > now() - make_interval(hours => p_hours)
     order by t.event_id, t.seen_at desc),
  theirs as (
    select distinct on (t.event_id) e.home, e.away, e.start_at, t.back_home, t.back_away, t.depth_home, t.seen_at
      from ten287_rec.ticks t join ten287_rec.events e using (event_id)
     where t.book = 'Polymarket' and t.src <> 'clob' and coalesce(t.event_status, e.status) = 'pending'
       and t.seen_at > now() - make_interval(hours => p_hours)
     order by t.event_id, t.seen_at desc),
  j as (
    select o.home, o.away, o.back_home ob, o.back_away oa, x.back_home xb, x.back_away xa, o.seen_at os, x.seen_at xs
      from ours o join theirs x on drops_scope.same(o.home, x.home) and drops_scope.same(o.away, x.away)
                               and abs(extract(epoch from o.start_at - x.start_at)) < 86400)
  select jsonb_build_object(
    'oursMatches', (select count(*) from ours), 'theirsMatches', (select count(*) from theirs), 'both', (select count(*) from j),
    'samePrice', (select count(*) from j where ob = xb and oa = xa),
    'within1pct', (select count(*) from j where abs(ob - xb) <= 0.01 * xb and abs(oa - xa) <= 0.01 * xa),
    'examples', (select coalesce(jsonb_agg(to_jsonb(j)), '[]'::jsonb) from (select * from j limit 8) j))
$$;

-- the switch (run once, when the comparison is good): ours becomes 'Polymarket', odds-api.io stops recording it
create or replace function polyrec.switch() returns jsonb
language plpgsql as $$
begin
  update polyrec.config set book = 'Polymarket' where id;
  update ten287_rec.config set books = array_remove(books, 'Polymarket') where id;
  return jsonb_build_object('ours', (select book from polyrec.config), 'oddsApiIoBooks', (select to_jsonb(books) from ten287_rec.config));
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all functions in schema polyrec from public, anon, authenticated';
    execute 'revoke all on all tables in schema polyrec from anon, authenticated';
  end if;
end $$;
