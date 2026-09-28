-- TEN-347 — publish-freshness alert. The founder hears on Telegram when the board has published no new build for
-- 30 min (founder ruling, TEN-314 comment 70fb039e, 2026-09-28): two freezes that day were each noticed ~1.5 h late.
--
-- Runs in Supabase pg_cron, OUTSIDE GitHub Actions: the pipeline it watches cannot silence it. Every minute:
--   1. ingest the previous GET of the live build-info.json (pg_net keeps responses ~6 h),
--   2. decide ok | stale | unreachable,
--   3. ONE alert when a freeze starts, ONE recovery message when it ends — no repeats in between,
--   4. fire the next GET.
--
-- Staleness is measured at the ORIGIN, not from the cached copy: Pages serves max-age=600, so a copy read now may
-- be up to 10 min old. Fastly's `age` header says when that copy left the origin, and at that moment the origin
-- still held builtAt. So  gap = (fired_at - age) - builtAt  is a lower bound on how long nothing was published;
-- a freeze is flagged only when that proven gap passes stale_after. It never alerts on cache lag alone and is at
-- most ~10 min late. Max over the window, because the site cannot roll backwards (one concurrency group): an older
-- copy from another edge cannot re-open a freeze that a newer build already closed.
--
-- Delivery (the TEN-280 lesson): pg_net -> api.telegram.org can lose a message to a TLS timeout, so a message counts
-- only on a 2xx; an unconfirmed alert/recovery is re-sent (same text), backing off after backoff_after failures.
-- Own Vault names (ten347_telegram_*), never another job's. Idempotent; schedules NOTHING (a separate, explicit step).
-- Stop: select cron.unschedule('ten347_publish_watch');
create schema if not exists publish_watch;
revoke all on schema publish_watch from public, anon, authenticated;

create table if not exists publish_watch.config (
    id            boolean primary key default true check (id),
    url           text     not null default 'https://michaeldk1996.github.io/SAAS/build-info.json',
    stale_after   interval not null default interval '30 minutes',
    unreachable_n integer  not null default 5,          -- consecutive failed GETs before "unreachable"
    backoff_after integer  not null default 5,          -- failed sends in a row before backing off
    backoff_every interval not null default interval '15 minutes',
    label         text,                                 -- non-null only during a live test: prefixes every message
    dry_run       boolean  not null default false       -- self-test: record messages, send nothing
);
insert into publish_watch.config (id) values (true) on conflict (id) do nothing;

create table if not exists publish_watch.checks (
    id           bigint primary key,                    -- the pg_net request id (tests use negative ids)
    fired_at     timestamptz not null default now(),
    processed_at timestamptz,
    status_code  integer,
    built_at     timestamptz,
    commit_sha   text,
    cache_age_s  integer,
    error        text
);
create index if not exists checks_fired_idx on publish_watch.checks (fired_at);

create table if not exists publish_watch.messages (
    id             bigserial primary key,
    kind           text not null,                       -- alert | recovery | selftest
    text           text not null,
    net_request_id bigint,
    delivery       text not null default 'queued',      -- queued | sent | dry | failed: ...
    created_at     timestamptz not null default now()
);

create table if not exists publish_watch.state (
    id        boolean primary key default true check (id),
    condition text not null default 'ok',               -- ok | stale | unreachable
    since     timestamptz not null default now(),
    owed_kind text,                                     -- the transition message this episode must deliver
    owed_text text
);
insert into publish_watch.state (id) values (true) on conflict (id) do nothing;

-- A body that is not JSON (an HTML error page) must not raise and roll the tick back forever.
create or replace function publish_watch.try_jsonb(p text) returns jsonb
language plpgsql immutable as $$
begin
  if p is null or left(ltrim(p), 1) <> '{' then return null; end if;
  return p::jsonb;
exception when others then
  return null;
end $$;

create or replace function publish_watch.try_ts(p text) returns timestamptz
language plpgsql immutable as $$
begin
  return p::timestamptz;
exception when others then
  return null;
end $$;

create or replace function publish_watch.skey(p_name text) returns text
language sql stable as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1
$$;

create or replace function publish_watch.send(p_kind text, p_text text) returns bigint
language plpgsql as $$
declare cfg publish_watch.config; tok text; chat text; rid bigint; body text;
begin
  select * into cfg from publish_watch.config;
  body := coalesce('🧪 ' || cfg.label || E' — ', '') || p_text;
  if cfg.dry_run then
    insert into publish_watch.messages (kind, text, delivery) values (p_kind, body, 'dry');
    return 0;
  end if;
  tok := publish_watch.skey('ten347_telegram_bot_token');
  chat := publish_watch.skey('ten347_telegram_chat_id');
  if tok is null or chat is null then
    insert into publish_watch.messages (kind, text, delivery) values (p_kind, body, 'failed: no vault secret');
    return null;
  end if;
  select net.http_post(url := 'https://api.telegram.org/bot' || tok || '/sendMessage',
                       body := jsonb_build_object('chat_id', chat, 'text', body),
                       headers := '{"Content-Type": "application/json"}'::jsonb) into rid;
  insert into publish_watch.messages (kind, text, net_request_id) values (p_kind, body, rid);
  return rid;
end $$;

-- ok | stale | unreachable, from publish_watch.checks only (tests drive it with rows). Returns the kind plus the
-- numbers the messages need.
create or replace function publish_watch.condition(out kind text, out gap_min integer, out built_at timestamptz,
                                                    out commit_sha text, out detail text)
language plpgsql stable as $$
declare cfg publish_watch.config; n_fail integer; seen_at timestamptz;
begin
  select * into cfg from publish_watch.config;
  select c.built_at, c.commit_sha into built_at, commit_sha from publish_watch.checks c
   where c.built_at is not null order by c.built_at desc, c.id desc limit 1;
  select max(c.fired_at - make_interval(secs => coalesce(c.cache_age_s, 0))) into seen_at
    from publish_watch.checks c where c.built_at is not null;
  gap_min := floor(extract(epoch from seen_at - built_at) / 60);

  select count(*) filter (where c.built_at is null) into n_fail
    from (select * from publish_watch.checks where processed_at is not null
           order by fired_at desc, id desc limit cfg.unreachable_n) c;
  if n_fail >= cfg.unreachable_n then
    select coalesce('HTTP ' || c.status_code, c.error, 'no body') into detail from publish_watch.checks c
     where c.processed_at is not null order by c.fired_at desc, c.id desc limit 1;
    kind := 'unreachable';
  elsif built_at is null then
    kind := 'ok';                                   -- no reading yet: nothing proven either way
  elsif seen_at - built_at > cfg.stale_after then
    kind := 'stale';
  else
    kind := 'ok';
  end if;
end $$;

-- Steps 2-3. Separate from tick() so the self-test can drive it without any network.
create or replace function publish_watch.evaluate() returns text
language plpgsql as $$
declare cfg publish_watch.config; st publish_watch.state; c record; msg text; kind_label text;
        delivered boolean; attempt_at timestamptz; fails integer;
begin
  select * into cfg from publish_watch.config;
  select * into c from publish_watch.condition();
  select * into st from publish_watch.state;

  -- One message per TRANSITION between ok and not-ok. stale <-> unreachable is the same freeze: no message.
  if (c.kind = 'ok') <> (st.condition = 'ok') then
    if c.kind = 'ok' then
      msg := format(E'✅ BOARD PUBLISHING AGAIN\n\nNew build %s, built %s UTC.\nNo publish for about %s min before it (alert raised %s UTC).',
                    left(c.commit_sha, 7), to_char(c.built_at at time zone 'UTC', 'HH24:MI'),
                    greatest(0, round(extract(epoch from c.built_at - coalesce(
                      (select max(k.built_at) from publish_watch.checks k where k.built_at < c.built_at), st.since)) / 60)),
                    to_char(st.since at time zone 'UTC', 'HH24:MI'));
      update publish_watch.state set condition = 'ok', since = now(), owed_kind = 'recovery', owed_text = msg;
    else
      if c.kind = 'stale' then
        msg := format(E'⚠️ BOARD FROZEN — no new build published for %s min\n\nLast build %s, built %s UTC.\nSource: %s\nOne alert per freeze: the next message is the recovery notice.',
                      c.gap_min, left(c.commit_sha, 7), to_char(c.built_at at time zone 'UTC', 'HH24:MI'), cfg.url);
      else
        msg := format(E'⚠️ BOARD UNREACHABLE — the live build-info.json failed %s checks in a row (last: %s)\n\nLast build seen: %s, built %s UTC.\nOne alert per freeze: the next message is the recovery notice.',
                      cfg.unreachable_n, c.detail, coalesce(left(c.commit_sha, 7), '?'),
                      coalesce(to_char(c.built_at at time zone 'UTC', 'HH24:MI'), '?'));
      end if;
      update publish_watch.state set condition = c.kind, since = now(), owed_kind = 'alert', owed_text = msg;
    end if;
    perform publish_watch.send(case when c.kind = 'ok' then 'recovery' else 'alert' end, msg);
    return c.kind || ' (sent ' || case when c.kind = 'ok' then 'recovery' else 'alert' end || ')';
  end if;
  if c.kind <> st.condition then                      -- stale <-> unreachable: track it silently
    update publish_watch.state set condition = c.kind where true;
  end if;

  -- The owed transition message must be CONFIRMED (2xx). Lost to a TLS timeout -> send the same text again, once
  -- nothing is in flight; after backoff_after failures only every backoff_every.
  if st.owed_kind is not null then
    select bool_or(m.delivery in ('sent', 'dry')), max(m.created_at),
           count(*) filter (where m.delivery like 'failed%')
      into delivered, attempt_at, fails
      from publish_watch.messages m where m.kind = st.owed_kind and m.created_at >= st.since;
    if coalesce(delivered, false) then
      update publish_watch.state set owed_kind = null, owed_text = null where true;
    elsif not exists (select 1 from publish_watch.messages where delivery = 'queued')
          and (coalesce(fails, 0) < cfg.backoff_after or attempt_at < now() - cfg.backoff_every) then
      perform publish_watch.send(st.owed_kind, st.owed_text);
      return c.kind || ' (re-sent ' || st.owed_kind || ')';
    end if;
  end if;
  return c.kind;
end $$;

create or replace function publish_watch.tick() returns text
language plpgsql as $$
declare cfg publish_watch.config; rid bigint; res text;
begin
  if not pg_try_advisory_xact_lock(347347) then return 'locked'; end if;
  select * into cfg from publish_watch.config;

  -- 1. ingest GET responses
  update publish_watch.checks c
     set processed_at = now(), status_code = r.status_code, error = r.error_msg,
         built_at = case when r.status_code = 200
                         then publish_watch.try_ts(publish_watch.try_jsonb(r.content)->>'builtAt') end,
         commit_sha = publish_watch.try_jsonb(r.content)->>'commit',
         cache_age_s = case when coalesce(r.headers->>'age', r.headers->>'Age') ~ '^\d+$'
                            then coalesce(r.headers->>'age', r.headers->>'Age')::integer end
    from net._http_response r
   where c.processed_at is null and r.id = c.id;
  update publish_watch.checks set processed_at = now(), error = 'no response'
   where processed_at is null and fired_at < now() - interval '2 minutes';
  update publish_watch.messages m
     set delivery = case when r.status_code between 200 and 299 then 'sent'
                         else 'failed: ' || coalesce('HTTP ' || r.status_code, r.error_msg, 'no response') end
    from net._http_response r
   where m.delivery = 'queued' and r.id = m.net_request_id;
  update publish_watch.messages set delivery = 'failed: no response'
   where delivery = 'queued' and created_at < now() - interval '2 minutes';

  -- 2-3.
  res := publish_watch.evaluate();

  -- 4. next GET
  select net.http_get(url := cfg.url, timeout_milliseconds := 15000) into rid;
  insert into publish_watch.checks (id) values (rid);
  delete from publish_watch.checks where fired_at < now() - interval '3 days';
  delete from publish_watch.messages where created_at < now() - interval '60 days';
  return res;
end $$;

revoke all on all functions in schema publish_watch from public, anon, authenticated;
revoke all on all tables in schema publish_watch from public, anon, authenticated;
revoke all on all sequences in schema publish_watch from public, anon, authenticated;
