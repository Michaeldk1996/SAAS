-- TEN-347 self-test: drives publish_watch.evaluate() with synthetic checks, dry_run on (nothing is sent), and
-- ROLLS BACK — the live tables are untouched. Any failed expectation raises and turns the run red.
begin;
update publish_watch.config set dry_run = true, label = null, stale_after = interval '30 minutes', unreachable_n = 5;
delete from publish_watch.checks;
delete from publish_watch.messages;
update publish_watch.state set condition = 'ok', since = now(), owed_kind = null, owed_text = null;

do $$
declare t timestamptz := now(); r text; n integer; m text;
begin
  -- A. FRESH CONTROL, including cache lag: the last read shows a build 40 min before `now`, but it is a copy that
  --    left the origin 590 s before it was read. The proven gap is 25 min, so no alert. Then a new build.
  insert into publish_watch.checks (id, fired_at, processed_at, status_code, built_at, commit_sha, cache_age_s) values
    (-1, t - interval '30 minutes', t, 200, t - interval '40 minutes', 'aaaaaaa1', 0);
  r := publish_watch.evaluate();
  insert into publish_watch.checks (id, fired_at, processed_at, status_code, built_at, commit_sha, cache_age_s) values
    (-2, t - interval '20 minutes', t, 200, t - interval '40 minutes', 'aaaaaaa1', 500);
  r := publish_watch.evaluate();
  insert into publish_watch.checks (id, fired_at, processed_at, status_code, built_at, commit_sha, cache_age_s) values
    (-3, t - interval '5 minutes', t, 200, t - interval '40 minutes', 'aaaaaaa1', 590);
  r := publish_watch.evaluate();
  if r <> 'ok' then raise exception 'A: cache-lagged read (proven gap 25 min) gave %', r; end if;
  insert into publish_watch.checks (id, fired_at, processed_at, status_code, built_at, commit_sha, cache_age_s) values
    (-4, t - interval '1 minute', t, 200, t - interval '10 minutes', 'aaaaaaa2', 30);
  r := publish_watch.evaluate();
  select count(*) into n from publish_watch.messages;
  if r <> 'ok' or n <> 0 then raise exception 'A: fresh control sent % message(s), condition %', n, r; end if;

  -- B. FORCED STALE: no new build for 35 min (proven, cache age 0) -> exactly ONE alert, however many ticks follow.
  delete from publish_watch.checks;
  insert into publish_watch.checks (id, fired_at, processed_at, status_code, built_at, commit_sha, cache_age_s) values
    (-10, t - interval '40 minutes', t, 200, t - interval '45 minutes', 'bbbbbbb1', 0);
  r := publish_watch.evaluate();
  if r <> 'ok' then raise exception 'B: 5-min gap gave %', r; end if;
  insert into publish_watch.checks (id, fired_at, processed_at, status_code, built_at, commit_sha, cache_age_s) values
    (-11, t - interval '10 minutes', t, 200, t - interval '45 minutes', 'bbbbbbb1', 0);
  r := publish_watch.evaluate();
  if r <> 'stale (sent alert)' then raise exception 'B: 35-min gap gave %', r; end if;
  for i in 1..5 loop
    insert into publish_watch.checks (id, fired_at, processed_at, status_code, built_at, commit_sha, cache_age_s) values
      (-11 - i, t - interval '10 minutes' + make_interval(mins => i), t, 200, t - interval '45 minutes', 'bbbbbbb1', 0);
    r := publish_watch.evaluate();
  end loop;
  select count(*), max(text) into n, m from publish_watch.messages;
  if n <> 1 then raise exception 'B: % messages during one freeze, want 1', n; end if;
  if m not like '%BOARD FROZEN — no new build published for 35 min%' or m not like '%bbbbbbb%' then
    raise exception 'B: alert text wrong: %', m; end if;

  -- C. RECOVERY: a new build -> exactly one recovery notice, then silence.
  insert into publish_watch.checks (id, fired_at, processed_at, status_code, built_at, commit_sha, cache_age_s) values
    (-20, t - interval '3 minutes', t, 200, t - interval '4 minutes', 'ccccccc1', 0);
  r := publish_watch.evaluate();
  if r <> 'ok (sent recovery)' then raise exception 'C: new build gave %', r; end if;
  for i in 1..3 loop r := publish_watch.evaluate(); end loop;
  select count(*) into n from publish_watch.messages where kind = 'recovery';
  if n <> 1 then raise exception 'C: % recovery messages, want 1', n; end if;
  select text into m from publish_watch.messages where kind = 'recovery';
  if m not like '%BOARD PUBLISHING AGAIN%ccccccc%No publish for about 41 min%' then
    raise exception 'C: recovery text wrong: %', m; end if;

  -- D. An older copy from another edge after recovery must not re-open the freeze.
  insert into publish_watch.checks (id, fired_at, processed_at, status_code, built_at, commit_sha, cache_age_s) values
    (-21, t - interval '2 minutes', t, 200, t - interval '45 minutes', 'bbbbbbb1', 0);
  r := publish_watch.evaluate();
  select count(*) into n from publish_watch.messages;
  if r <> 'ok' or n <> 2 then raise exception 'D: old edge copy gave % with % messages', r, n; end if;

  -- E. LOST DELIVERY: the alert's send failed (TLS timeout) -> the same text is sent again, once.
  delete from publish_watch.checks; delete from publish_watch.messages;
  update publish_watch.state set condition = 'ok', since = t, owed_kind = null, owed_text = null;
  insert into publish_watch.checks (id, fired_at, processed_at, status_code, built_at, commit_sha, cache_age_s) values
    (-30, t - interval '1 minute', t, 200, t - interval '50 minutes', 'eeeeeee1', 0);
  r := publish_watch.evaluate();
  update publish_watch.messages set delivery = 'failed: TLS handshake timeout';
  r := publish_watch.evaluate();
  if r <> 'stale (re-sent alert)' then raise exception 'E: lost alert gave %', r; end if;
  r := publish_watch.evaluate(); r := publish_watch.evaluate();
  select count(*) into n from publish_watch.messages;
  if n <> 2 then raise exception 'E: % messages after one re-send, want 2', n; end if;

  -- F. UNREACHABLE: 5 failed GETs in a row -> one alert; a pending (unprocessed) GET is not a failure.
  delete from publish_watch.checks; delete from publish_watch.messages;
  update publish_watch.state set condition = 'ok', since = t, owed_kind = null, owed_text = null;
  insert into publish_watch.checks (id, fired_at, processed_at, status_code, built_at, commit_sha, cache_age_s) values
    (-40, t - interval '10 minutes', t, 200, t - interval '11 minutes', 'fffffff1', 0);
  for i in 1..4 loop
    insert into publish_watch.checks (id, fired_at, processed_at, status_code) values
      (-40 - i, t - interval '10 minutes' + make_interval(mins => i), t, 503);
  end loop;
  insert into publish_watch.checks (id, fired_at) values (-49, t);          -- in flight
  r := publish_watch.evaluate();
  if r <> 'ok' then raise exception 'F: 4 failures + 1 pending gave %', r; end if;
  insert into publish_watch.checks (id, fired_at, processed_at, status_code) values (-45, t - interval '5 minutes', t, 503);
  r := publish_watch.evaluate();
  if r <> 'unreachable (sent alert)' then raise exception 'F: 5 failures gave %', r; end if;
  select text into m from publish_watch.messages;
  if m not like '%BOARD UNREACHABLE%HTTP 503%fffffff%' then raise exception 'F: text wrong: %', m; end if;

  raise notice 'publish_watch selftest: A-F passed';
end $$;
rollback;
select 'selftest passed' as result;
