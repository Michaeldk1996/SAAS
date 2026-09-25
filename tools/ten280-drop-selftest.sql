-- TEN-280 — self-test of ten280_bot.scan on synthetic ticks. Raises (HTTP 400,
-- the workflow fails, nothing is scheduled) on the first wrong answer.
-- Fixture ids are negative, so they can never collide with a Kibl fixture.
do $$
declare
  t0 timestamptz := '2026-01-01 10:00:00+00';
  n  integer;
  r  record;
begin
  delete from ten280_bot.alerts where mode = 'selftest';
  drop table if exists pg_temp.t280;
  create temp table t280 (fixture_id bigint, side_id int, price numeric, at timestamptz,
                          known_at timestamptz, is_opener boolean, row_key text, src text);
  insert into t280 values
    -- A: 2.00 (Kibl opener) -> 1.88 at +15: 6.0% vs the price 10 min earlier
    (-1, 2, 2.00, t0,                         t0,                         true,  'a1', 't'),
    (-1, 2, 1.88, t0 + interval '15 min',     t0 + interval '15 min',     false, 'a2', 't'),
    -- same match, other side, drops 8% at +25: inside A's 30-min cooldown -> suppressed
    (-1, 3, 1.90, t0,                         t0,                         false, 'a3', 't'),
    (-1, 3, 1.748,t0 + interval '25 min',     t0 + interval '25 min',     false, 'a4', 't'),
    -- same side again at +60 (cooldown over): 1.88 -> 1.75 = 6.9% -> alert
    (-1, 2, 1.75, t0 + interval '60 min',     t0 + interval '60 min',     false, 'a5', 't'),
    -- B: floor. 1.40 -> 1.29 (7.9%) but the dropped-to price is below 1.30 -> none
    (-2, 2, 1.40, t0,                         t0,                         false, 'b1', 't'),
    (-2, 2, 1.29, t0 + interval '15 min',     t0 + interval '15 min',     false, 'b2', 't'),
    -- C: below threshold. 2.00 -> 1.92 = 4.0% -> none at 5%
    (-3, 2, 2.00, t0 + interval '100 min',    t0 + interval '100 min',    false, 'c1', 't'),
    (-3, 2, 1.92, t0 + interval '105 min',    t0 + interval '105 min',    false, 'c2', 't'),
    -- D: up then down. 2.00, 2.20 at +12, 2.00 at +20. At e=+20 the reference
    -- (price at +10) is 2.00 -> 0%; at e=+22 it is 2.20 -> 9.1% -> alert at +22.
    (-4, 2, 2.00, t0,                         t0,                         false, 'd1', 't'),
    (-4, 2, 2.20, t0 + interval '12 min',     t0 + interval '12 min',     false, 'd2', 't'),
    (-4, 2, 2.00, t0 + interval '20 min',     t0 + interval '20 min',     false, 'd3', 't'),
    -- E: a 10% drop we only LEARN of 20 min later (poller lag) — by then it is
    -- outside the window, so the bot (and the backtest) never fires on it.
    (-5, 2, 3.00, t0,                         t0,                         false, 'e1', 't'),
    (-5, 2, 2.70, t0 + interval '15 min',     t0 + interval '35 min',     false, 'e2', 't');

  n := ten280_bot.scan(t0, t0 + interval '120 min', 5, 'selftest', 'st5');
  if n <> 3 then raise exception 'SELFTEST: expected 3 alerts at 5%%, got %', n; end if;

  select * into r from ten280_bot.alerts where mode = 'selftest' and run_id = 'st5' and fixture_id = -1 order by eval_at limit 1;
  if r.side_id <> 2 or r.eval_at <> t0 + interval '15 min' or r.cur_price <> 1.88 or r.ref_price <> 2.00
     or r.pct_10m <> 6.00 or r.open_price <> 2.00 or not r.open_is_opener or r.message not like '%: opened 2 @ 01.01 10:00 UTC, dropped to 1.88 (−6.0% in 10 min, from 2) @ 01.01 10:15 UTC · since opened: −6.0%' then
    raise exception 'SELFTEST: case A wrong: % | %', row_to_json(r), r.message;
  end if;
  if (select count(*) from ten280_bot.alerts where mode='selftest' and run_id='st5' and fixture_id=-1) <> 2 then
    raise exception 'SELFTEST: cooldown wrong (match -1 should alert twice: +15 and +60)';
  end if;
  if exists (select 1 from ten280_bot.alerts where mode='selftest' and run_id='st5' and fixture_id=-1 and side_id=3) then
    raise exception 'SELFTEST: cooldown did not suppress the other side at +25';
  end if;
  if exists (select 1 from ten280_bot.alerts where mode='selftest' and run_id='st5' and fixture_id in (-2, -3, -5)) then
    raise exception 'SELFTEST: floor / below-threshold / late-knowledge case fired';
  end if;
  select * into r from ten280_bot.alerts where mode='selftest' and run_id='st5' and fixture_id=-4;
  if r.eval_at <> t0 + interval '22 min' or r.ref_price <> 2.20 or r.pct_10m <> 9.09 or r.open_is_opener
     or r.message not like '%: first seen 2 @ 01.01 10:00 UTC, dropped to 2 (−9.1% in 10 min, from 2.2) @ 01.01 10:20 UTC · since first seen: +0.0%' then
    raise exception 'SELFTEST: case D wrong: % | %', row_to_json(r), r.message;
  end if;

  -- 7%: A at +15 (6.0) no; D (9.1) yes; A at +60 (6.9) no; the other side at +25
  -- (8.0) now fires because nothing on match -1 fired before it.
  n := ten280_bot.scan(t0, t0 + interval '120 min', 7, 'selftest', 'st7');
  if n <> 2 then raise exception 'SELFTEST: expected 2 alerts at 7%%, got %', n; end if;
  n := ten280_bot.scan(t0, t0 + interval '120 min', 10, 'selftest', 'st10');
  if n <> 0 then raise exception 'SELFTEST: expected 0 alerts at 10%%, got %', n; end if;

  delete from ten280_bot.alerts where mode = 'selftest';
  raise notice 'SELFTEST PASS';
end $$;
select 'SELFTEST PASS' as result;
