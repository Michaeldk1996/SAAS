-- TEN-287 recorder self-test. Runs inside the install transaction: any failed assertion raises and the
-- whole install rolls back. Test rows use NEGATIVE event ids and are deleted before commit.
-- Fixtures are the verbatim shapes measured on 2026-09-25 (probe run 36198963732).
do $$
declare
  bfe jsonb := '{"id": -287001, "home": "Boscardin Dias, Pedro", "away": "Mena, Facundo", "date": "2026-09-26T17:10:00Z",
                 "status": "pending", "league": {"name": "Challenger - Buenos Aires 2, Argentina"},
                 "bookmakerIds": {"Betfair Exchange": "36117538"},
                 "bookmakers": {"Betfair Exchange": [
                    {"name": "ML", "updatedAt": "2026-09-25T22:51:25.04Z",
                     "odds": [{"home": "2.16", "away": "1.52", "layHome": "2.92", "layAway": "1.87",
                               "depthHome": "55.89", "depthAway": "469.1", "depthLayHome": "244.19", "depthLayAway": "64.56"}]},
                    {"name": "Totals (Games)", "updatedAt": "2026-09-25T22:51:25.04Z",
                     "odds": [{"hdp": 22.5, "over": "1.9", "under": "2.0"}]}]}}';
  sb  jsonb := '{"id": -287002, "home": "Halys, Quentin", "away": "Safiullin, Roman", "date": "2026-09-26T05:30:00Z",
                 "status": "pending", "league": {"name": "ATP - Chengdu, China"},
                 "bookmakers": {"Superbet": [{"name": "ML", "updatedAt": "2026-09-25T22:40:00Z",
                                              "odds": [{"home": "2.25", "away": "-"}]}],
                                "Some Other Book": [{"name": "ML", "updatedAt": "2026-09-25T22:40:00Z",
                                                     "odds": [{"home": "2.3", "away": "1.6"}]}]}}';
  dbl jsonb := '{"id": -287003, "home": "A, B / C, D", "away": "E, F / G, H", "status": "pending",
                 "league": {"name": "ATP - Chengdu, China"}}';
  t record; n int;
begin
  n := ten287_rec.ingest_event(bfe, '2026-09-25 22:56:26+00', 'selftest');
  if n <> 1 then raise exception 'SELFTEST: BFE event wrote % ML ticks, want 1 (Totals must be skipped)', n; end if;
  n := ten287_rec.ingest_event(bfe, '2026-09-25 22:57:00+00', 'selftest');
  if n <> 0 then raise exception 'SELFTEST: re-ingesting the same state wrote % rows, want 0', n; end if;

  select * into t from ten287_rec.ticks where event_id = -287001;
  if t.book is distinct from 'Betfair Exchange' or t.back_home is distinct from 2.16 or t.back_away is distinct from 1.52
     or t.lay_home is distinct from 2.92 or t.lay_away is distinct from 1.87
     or t.depth_home is distinct from 55.89 or t.depth_away is distinct from 469.1
     or t.depth_lay_home is distinct from 244.19 or t.depth_lay_away is distinct from 64.56
     or t.book_updated_at is distinct from '2026-09-25 22:51:25.04+00'::timestamptz
     or t.seen_at is distinct from '2026-09-25 22:56:26+00'::timestamptz then
    raise exception 'SELFTEST: BFE tick parsed wrong: %', row_to_json(t);
  end if;

  n := ten287_rec.ingest_event(sb, '2026-09-25 22:56:26+00', 'selftest');
  if n <> 1 then raise exception 'SELFTEST: Superbet event wrote % ticks, want 1 (an unselected book must be skipped)', n; end if;
  select * into t from ten287_rec.ticks where event_id = -287002;
  if t.book is distinct from 'Superbet' or t.back_home is distinct from 2.25 or t.back_away is not null or t.lay_home is not null or t.depth_home is not null then
    raise exception 'SELFTEST: Superbet tick wrong (an unparseable "-" must be NULL, not a default): %', row_to_json(t);
  end if;

  perform ten287_rec.ingest_event(dbl, now(), 'selftest');
  if (select tier from ten287_rec.events where event_id = -287001) is distinct from 'Challenger'
     or (select tier from ten287_rec.events where event_id = -287002) is distinct from 'ATP'
     or (select tier from ten287_rec.events where event_id = -287003) is not null then
    raise exception 'SELFTEST: tier classification wrong';
  end if;
  if (select bookmaker_ids->>'Betfair Exchange' from ten287_rec.events where event_id = -287001) is distinct from '36117538' then
    raise exception 'SELFTEST: Betfair event id not kept';
  end if;
  if ten287_rec.scrub('https://x/?apiKey=abc123&a=1') is distinct from 'https://x/?apiKey=***&a=1' then
    raise exception 'SELFTEST: key scrub failed';
  end if;

  -- a market with no updatedAt must still dedupe (nulls not distinct)
  n := ten287_rec.ingest_event('{"id": -287004, "home": "X, Y", "away": "Z, W", "league": {"name": "ATP - T"},
        "bookmakers": {"Superbet": [{"name": "ML", "odds": [{"home": "1.5", "away": "2.5"}]}]}}'::jsonb, now(), 'selftest');
  n := n + ten287_rec.ingest_event('{"id": -287004, "home": "X, Y", "away": "Z, W", "league": {"name": "ATP - T"},
        "bookmakers": {"Superbet": [{"name": "ML", "odds": [{"home": "1.5", "away": "2.5"}]}]}}'::jsonb, now(), 'selftest');
  if n <> 1 then raise exception 'SELFTEST: null updatedAt wrote % rows for one state, want 1', n; end if;
  -- malformed shapes return 0 instead of raising
  if ten287_rec.ingest_event('{"id": -287005, "bookmakers": null}'::jsonb, now(), 'selftest') <> 0
     or ten287_rec.ingest_event('{"id": -287006, "bookmakers": []}'::jsonb, now(), 'selftest') <> 0 then
    raise exception 'SELFTEST: malformed bookmakers not tolerated';
  end if;
  -- budget guard: a fresh low reading blocks, a stale one does not
  -- the guard reads the NEWEST request by id, so the fake reading must out-rank every real one (a live
  -- recorder has thousands; id -1 passed only on the first, empty install — run 36213324178)
  insert into ten287_rec.requests (id, kind, fired_at, processed_at, ratelimit_remaining)
  values (9223372036854775000, 'selftest', now(), now(), 100);
  if ten287_rec.budget_ok() then raise exception 'SELFTEST: budget guard did not trip on a fresh reading of 100'; end if;
  update ten287_rec.requests set fired_at = now() - interval '20 minutes' where id = 9223372036854775000;
  if ten287_rec.budget_ok() is distinct from true then
    -- a stale fake reading must not block; the real readings from the last 15 min decide (normally healthy)
    if (select ratelimit_remaining from ten287_rec.requests where ratelimit_remaining is not null
          and fired_at > now() - interval '15 minutes' order by id desc limit 1) >= (select min_remaining from ten287_rec.config)
       or not exists (select 1 from ten287_rec.requests where id <> 9223372036854775000 and ratelimit_remaining is not null
          and fired_at > now() - interval '15 minutes') then
      raise exception 'SELFTEST: budget guard did not release a stale reading';
    end if;
  end if;
  delete from ten287_rec.requests where id = 9223372036854775000;

  delete from ten287_rec.ticks where event_id < 0;
  delete from ten287_rec.events where event_id < 0;
  raise notice 'TEN-287 RECORDER SELFTEST PASS';
end $$;
