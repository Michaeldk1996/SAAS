-- TEN-287 Superbet drop bot self-test. Runs inside the install transaction; any failure raises and rolls the
-- whole install back. Drives the REAL load_ticks / scan / render over synthetic recorder rows (negative ids),
-- then deletes them. Base instant T = 2026-01-01 12:00 UTC; every tick is "seen" 20 s after its vendor time.
do $$
declare
  T timestamptz := '2026-01-01 12:00:00+00';
  n int; a ten287_bot.alerts; want text;
begin
  delete from ten287_bot.alerts where mode = 'selftest';
  delete from ten287_rec.ticks where event_id < 0;
  delete from ten287_rec.openings where event_id < 0;
  delete from ten287_rec.events where event_id < 0;

  insert into ten287_rec.events (event_id, home, away, start_at, status, league, tier) values
    (-287101, 'Boscardin Dias, Pedro', 'Mena, Facundo', T + interval '3 hours', 'pending', 'Challenger - Buenos Aires 2, Argentina', 'Challenger'),
    (-287102, 'Halys, Quentin', 'Safiullin, Roman', T + interval '3 hours', 'pending', 'ATP - Chengdu, China', 'ATP'),
    (-287103, 'Sebastian Dominko', 'Marko Bekeni', T + interval '3 hours', 'pending', 'Tennis - ITF Men Pardubice - R16', 'ITF Men'),
    (-287104, 'A, B / C, D', 'E, F / G, H', T + interval '3 hours', 'pending', 'ATP - Chengdu, China', null);   -- doubles

  -- (event, book, minute, home, away, status)
  insert into ten287_rec.ticks (book, event_id, back_home, back_away, book_updated_at, seen_at, event_status, src, state_md5)
  select b, ev, h, aw, T + (m || ' minutes')::interval, T + (m || ' minutes')::interval + interval '20 seconds', st, 'selftest',
         md5(ev::text || b || m::text || h::text || aw::text)
  from (values
    (-287101, 'Superbet',          0, 2.00, 1.80, 'pending'),
    (-287101, 'Superbet',          5, 2.00, 1.80, 'pending'),   -- same-price re-stamp: not a change
    (-287101, 'Superbet',         12, 1.90, 1.85, 'pending'),   -- home −5.0% → ALERT (evaluated at T+13, when we knew it)
    (-287101, 'Betfair Exchange', 12, 1.50, 2.90, 'pending'),   -- other book: never evaluated
    (-287101, 'Superbet',         13, 1.60, 2.40, 'live'),      -- in-play: never a price here
    (-287101, 'Superbet',         20, 1.80, 1.85, 'pending'),   -- −10% but inside the 30-min cooldown → no alert
    (-287101, 'Superbet',         30, 1.80, 1.76, 'pending'),   -- away −4.86% → no alert
    (-287101, 'Superbet',         50, 1.70, 1.76, 'pending'),   -- home −5.56% vs 1.80, cooldown over → ALERT at T+51
    (-287102, 'Superbet',          0, 1.80, 2.00, 'pending'),
    (-287102, 'Superbet',         12, 1.80, 1.902, 'pending'),  -- away −4.9% → no alert
    (-287103, 'Superbet',          0, 2.00, 1.80, 'pending'),
    (-287103, 'Superbet',         12, 1.90, 1.85, 'pending'),   -- home −5.0% → ALERT, Opening "first seen"
    (-287104, 'Superbet',          0, 2.00, 1.80, 'pending'),
    (-287104, 'Superbet',         12, 1.80, 1.95, 'pending')    -- doubles −10% → no alert
  ) v(ev, b, m, h, aw, st);

  insert into ten287_rec.openings (event_id, book, open_home, open_away, open_at, status_code) values
    (-287101, 'Superbet', 2.10, 1.75, T - interval '5 hours', 200),
    (-287103, 'Betfair Exchange', 9.99, 9.99, T - interval '5 hours', 200);  -- other book's opening: never used

  perform ten287_bot.load_ticks('Superbet', T - interval '1 hour', T + interval '2 hours');
  if (select count(*) from pg_temp.t287 where event_id = -287101 and side = 'home') <> 4 then
    raise exception 'SELFTEST: -287101 home should load 4 price changes (2.00, 1.90, 1.80, 1.70), got %',
      (select string_agg(price::text || '@' || to_char(at, 'HH24:MI'), ' ' order by at) from pg_temp.t287 where event_id = -287101 and side = 'home');
  end if;
  if exists (select 1 from pg_temp.t287 where event_id = -287104) then
    raise exception 'SELFTEST: a doubles event was loaded';
  end if;
  if exists (select 1 from pg_temp.t287 where price in (1.50, 1.60, 2.90, 2.40)) then
    raise exception 'SELFTEST: a Betfair Exchange or in-play price was loaded';
  end if;

  n := ten287_bot.scan('Superbet', T, T + interval '60 minutes', 5, 'selftest', 'st');
  if n <> 3 then
    raise exception 'SELFTEST: want 3 alerts, got %: %', n,
      (select string_agg(event_id || '/' || side || '@' || to_char(eval_at, 'HH24:MI'), ', ' order by id) from ten287_bot.alerts where mode = 'selftest');
  end if;

  select * into a from ten287_bot.alerts where mode = 'selftest' and event_id = -287101 order by eval_at limit 1;
  if a.side is distinct from 'home' or a.eval_at is distinct from T + interval '13 minutes'
     or a.ref_price is distinct from 2.00 or a.ref_at is distinct from T
     or a.cur_price is distinct from 1.90 or a.cur_at is distinct from T + interval '12 minutes'
     or a.open_price is distinct from 2.10 or a.open_kind is distinct from 'vendor first record' then
    raise exception 'SELFTEST: first alert wrong: %', row_to_json(a);
  end if;
  want := concat_ws(chr(10),
    '🟢 SUPERBET DROP', '',
    '🎾 Match: Pedro Boscardin Dias vs Facundo Mena (Challenger)',
    '🎯 Line: Match Winner – Pedro Boscardin Dias',
    '🟢 Opening: 2.1 @ 07:00 UTC (vendor first record)',
    '🟠 Pre-drop: 2 @ 12:00 UTC',
    '🔴 Odds now: 1.9 @ 12:12 UTC',
    '📉 Drop (10 min): −5.0%',
    '↘️ Since open: −9.5%',
    '⏱️ Moved: 1 min ago',
    '🏦 Bookmaker: Superbet');
  if a.message is distinct from want then
    raise exception 'SELFTEST: rendered text differs. GOT: % | WANT: %', a.message, want;
  end if;

  select * into a from ten287_bot.alerts where mode = 'selftest' and event_id = -287101 order by eval_at desc limit 1;
  if a.eval_at is distinct from T + interval '51 minutes' or a.ref_price is distinct from 1.80
     or a.ref_at is distinct from T + interval '20 minutes' or a.cur_price is distinct from 1.70 then
    raise exception 'SELFTEST: second alert wrong: %', row_to_json(a);
  end if;

  select * into a from ten287_bot.alerts where mode = 'selftest' and event_id = -287103;
  if a.open_kind is distinct from 'first seen' or a.open_price is distinct from 2.00 or a.open_at is distinct from T
     or position('🟢 Opening: 2 @ 12:00 UTC (first seen)' in a.message) = 0
     or position('🎾 Match: Sebastian Dominko vs Marko Bekeni (ITF Men)' in a.message) = 0 then
    raise exception 'SELFTEST: first-seen Opening / ITF name wrong: %', a.message;
  end if;

  if ten287_bot.disp('Damm Jr, Martin') is distinct from 'Martin Damm Jr' then
    raise exception 'SELFTEST: name display wrong';
  end if;

  delete from ten287_bot.alerts where mode = 'selftest';
  delete from ten287_rec.ticks where event_id < 0;
  delete from ten287_rec.openings where event_id < 0;
  delete from ten287_rec.events where event_id < 0;
  raise notice 'TEN-287 SUPERBET DROP BOT SELFTEST PASS';
end $$;
