-- TEN-270 — pg_cron dispatcher for .github/workflows/oddspapi-postmatch.yml,
-- and its dead-token alarm.
-- Founder 2026-09-25: "install the dispatcher and remove the GitHub schedule".
-- Founder 2026-09-25T00:53Z: "If a dispatch fails (expired or invalid token,
-- 401/403), it must show as a visible alert, not a silent skip."
-- This is the post-match job's ONLY trigger (its workflow has no `schedule:`).
-- Applied by the `schema` action of .github/workflows/ten270-stream-now.yml,
-- after kibl-stream/now-schema.sql.
--
-- WHY. GitHub's `schedule:` delivers only a fraction of slots on this repo
-- (~27% of an hourly schedule, odds-now.yml; ZERO of ~66 five-minute slots for
-- the Kibl archive, measured 2026-09-18). pg_cron is minute-accurate and was
-- measured at ~100% on this project (TEN-141).
--
-- SECRETS (Supabase Vault, read at run time from vault.decrypted_secrets):
--   gh_postmatch_dispatch_pat  the fine-grained PAT (SAAS only, Actions r/w).
--                              Stored by the founder directly in Vault. The
--                              schema action writes it ONLY when the
--                              POSTMATCH_DISPATCH_PAT repo secret exists — it
--                              never deletes or overwrites it otherwise.
--   ops_telegram_bot_token     bsp_alerts.py's bot (TELEGRAM_BOT_TOKEN) and
--   ops_telegram_chat_id       ops chat (TELEGRAM_OPS_CHAT_ID), copied in by the
--                              schema action when those repo secrets exist.
--
-- THE ALARM. A dead token means GitHub never runs anything, so the alert has to
-- start here. Every dispatch records its pg_net request id; a second job,
-- 5 minutes after each dispatch slot, reads net._http_response for OUR ids only:
--   dispatch_http   a dispatch answered non-2xx in the last 45 min (401/403 =
--                   token expired or invalid; 404 = workflow not on main)
--   dispatch_stale  no 2xx dispatch in the last 45 min (dispatcher stopped),
--                   judged only once 45 min of dispatch history exists
--   dispatch_error  pg_net timed out / errored, or no response after 10 min
-- At most one alert per condition per 6 h, and a RECOVERED message when it
-- clears. Sent to Telegram via pg_net (api.telegram.org only). With no
-- Telegram secret in Vault the alert is still recorded (postmatch_alert_log,
-- delivered = 'unsent: …') and RAISE WARNING'd, and `verify` goes red on it.
--
-- FAIL SAFE. Everything runs inside one DO block that turns any failure into a
-- WARNING, so it can never fail the schema apply.

do $outer$
begin
  create extension if not exists pg_cron;
  create extension if not exists pg_net;

  create table if not exists public.postmatch_dispatch_log (
      id          bigserial   primary key,
      request_id  bigint,                    -- net.http_post id; null = not sent
      sent_at     timestamptz not null default now(),
      note        text
  );
  create index if not exists postmatch_dispatch_log_sent_idx on public.postmatch_dispatch_log (sent_at);
  create table if not exists public.postmatch_alerts (
      condition     text        primary key,  -- dispatch_http | dispatch_stale | dispatch_error
      is_open       boolean     not null default false,
      opened_at     timestamptz,
      last_sent_at  timestamptz,
      detail        text,
      updated_at    timestamptz not null default now()
  );
  create table if not exists public.postmatch_alert_log (
      id          bigserial   primary key,
      at          timestamptz not null default now(),
      condition   text        not null,
      kind        text        not null,      -- alert | recovered
      message     text        not null,
      request_id  bigint,                    -- the Telegram send's pg_net id
      delivered   text        not null       -- 'queued' -> 'sent' | 'failed: …'; 'unsent: …'
  );
  alter table public.postmatch_dispatch_log enable row level security;
  alter table public.postmatch_alerts       enable row level security;
  alter table public.postmatch_alert_log    enable row level security;
  revoke all on public.postmatch_dispatch_log from anon, authenticated;
  revoke all on public.postmatch_alerts       from anon, authenticated;
  revoke all on public.postmatch_alert_log    from anon, authenticated;

  create or replace function public.postmatch_dispatch() returns text
  language plpgsql security definer
  set search_path = public, pg_temp
  as $fn$
  declare
    pat text;
    req bigint;
  begin
    select decrypted_secret into pat
      from vault.decrypted_secrets where name = 'gh_postmatch_dispatch_pat' limit 1;
    if pat is null or length(trim(pat)) = 0 then
      insert into public.postmatch_dispatch_log (request_id, note) values (null, 'skipped: no vault secret');
      raise warning 'TEN-270 post-match dispatch skipped: vault secret gh_postmatch_dispatch_pat is missing';
      return 'skipped: vault secret gh_postmatch_dispatch_pat missing';
    end if;
    select net.http_post(
      url := 'https://api.github.com/repos/Michaeldk1996/SAAS/actions/workflows/oddspapi-postmatch.yml/dispatches',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || trim(pat),
        'Accept', 'application/vnd.github+json',
        'User-Agent', 'supabase-pg-cron-ten270-postmatch',
        'Content-Type', 'application/json'),
      body := '{"ref":"main"}'::jsonb
    ) into req;
    insert into public.postmatch_dispatch_log (request_id) values (req);
    return 'dispatched: net request ' || req;
  end $fn$;
  revoke all on function public.postmatch_dispatch() from public;
  revoke all on function public.postmatch_dispatch() from anon, authenticated;

  -- One message to the ops chat, or a recorded 'unsent' row + WARNING.
  create or replace function public.postmatch_send_alert(p_condition text, p_kind text, p_text text)
  returns text
  language plpgsql security definer
  set search_path = public, pg_temp
  as $fn$
  declare
    tok text;
    chat text;
    req bigint;
  begin
    select decrypted_secret into tok from vault.decrypted_secrets where name = 'ops_telegram_bot_token' limit 1;
    select decrypted_secret into chat from vault.decrypted_secrets where name = 'ops_telegram_chat_id' limit 1;
    if tok is null or length(trim(tok)) = 0 or chat is null or length(trim(chat)) = 0 then
      insert into public.postmatch_alert_log (condition, kind, message, delivered)
      values (p_condition, p_kind, p_text, 'unsent: telegram secret missing in vault');
      raise warning 'TEN-270 post-match ALERT UNSENT (no telegram secret in vault): %', p_text;
      return 'unsent';
    end if;
    select net.http_post(
      url := 'https://api.telegram.org/bot' || trim(tok) || '/sendMessage',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('chat_id', trim(chat), 'text', p_text,
                                 'disable_web_page_preview', true)
    ) into req;
    insert into public.postmatch_alert_log (condition, kind, message, request_id, delivered)
    values (p_condition, p_kind, p_text, req, 'queued');
    return 'queued';
  end $fn$;
  revoke all on function public.postmatch_send_alert(text, text, text) from public;
  revoke all on function public.postmatch_send_alert(text, text, text) from anon, authenticated;

  create or replace function public.postmatch_dispatch_check() returns text
  language plpgsql security definer
  set search_path = public, pg_temp
  as $fn$
  declare
    c record;
    a record;
    msg text;
    summary text := '';
  begin
    -- A queued Telegram send is not a delivery: resolve it against pg_net.
    update public.postmatch_alert_log l set delivered = case
        when r.timed_out or r.error_msg is not null then 'failed: timeout/error'
        when r.status_code between 200 and 299 then 'sent'
        else 'failed: HTTP ' || r.status_code end
      from net._http_response r
      where l.delivered = 'queued' and r.id = l.request_id
        and (r.status_code is not null or r.timed_out or r.error_msg is not null);
    update public.postmatch_alert_log l set delivered = 'failed: no response'
      where l.delivered = 'queued' and l.at < now() - interval '10 minutes'
        and not exists (select 1 from net._http_response r where r.id = l.request_id);
    for c in
      with ours as (
        select d.sent_at, r.status_code, r.timed_out, r.error_msg, r.id as rid, d.request_id
        from public.postmatch_dispatch_log d
        left join net._http_response r on r.id = d.request_id
        where d.sent_at > now() - interval '45 minutes' and d.request_id is not null
      ),
      hist as (select min(sent_at) as since from public.postmatch_dispatch_log)
      select 'dispatch_http'::text as condition,
             exists (select 1 from ours where status_code is not null
                     and status_code not between 200 and 299) as is_open,
             (select 'GitHub answered HTTP ' || status_code || ' to the dispatch at '
                     || to_char(sent_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || 'Z'
                     || case when status_code in (401, 403)
                             then ' - the token gh_postmatch_dispatch_pat is expired or invalid'
                             when status_code = 404 then ' - workflow or repo not found (is the workflow on main?)'
                             else '' end
              from ours where status_code is not null and status_code not between 200 and 299
              order by sent_at desc limit 1) as detail
      union all
      select 'dispatch_stale',
             (select since from hist) <= now() - interval '45 minutes'
             and not exists (select 1 from ours where status_code between 200 and 299),
             'no successful (2xx) dispatch in the last 45 min - the dispatcher has stopped or every dispatch failed'
      union all
      select 'dispatch_error',
             exists (select 1 from ours where timed_out or error_msg is not null
                     or (rid is null and sent_at < now() - interval '10 minutes')),
             (select 'pg_net ' || coalesce(case when timed_out then 'timed out' end, error_msg,
                                              'got no response within 10 min')
                     || ' on the dispatch at ' || to_char(sent_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || 'Z'
              from ours where timed_out or error_msg is not null
                 or (rid is null and sent_at < now() - interval '10 minutes')
              order by sent_at desc limit 1)
    loop
      select * into a from public.postmatch_alerts where condition = c.condition;
      if coalesce(c.is_open, false) then
        -- `a` has no row for a condition never seen: its fields are null, so
        -- coalesce() rather than a record IS NULL test (false once any field is set).
        if not coalesce(a.is_open, false) or a.last_sent_at is null
           or a.last_sent_at < now() - interval '6 hours' then
          msg := 'ALERT - Stennisfy post-match archive dispatcher: ' || coalesce(c.detail, c.condition)
                 || '. The post-match bet365 archive is not being triggered. (' || c.condition || ')';
          perform public.postmatch_send_alert(c.condition, 'alert', msg);
          insert into public.postmatch_alerts (condition, is_open, opened_at, last_sent_at, detail, updated_at)
          values (c.condition, true, now(), now(), c.detail, now())
          on conflict (condition) do update set
            is_open = true,
            opened_at = case when postmatch_alerts.is_open then postmatch_alerts.opened_at else now() end,
            last_sent_at = now(), detail = excluded.detail, updated_at = now();
          summary := summary || c.condition || ':alerted ';
        end if;
      elsif coalesce(a.is_open, false) then
        msg := 'RECOVERED - Stennisfy post-match archive dispatcher: ' || c.condition
               || ' cleared at ' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || 'Z'
               || ' (open since ' || to_char(a.opened_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || 'Z).';
        perform public.postmatch_send_alert(c.condition, 'recovered', msg);
        update public.postmatch_alerts set is_open = false, detail = null, updated_at = now()
        where condition = c.condition;
        summary := summary || c.condition || ':recovered ';
      end if;
    end loop;
    return coalesce(nullif(summary, ''), 'ok');
  end $fn$;
  revoke all on function public.postmatch_dispatch_check() from public;
  revoke all on function public.postmatch_dispatch_check() from anon, authenticated;

  begin
    perform cron.unschedule('ten270-oddspapi-postmatch-ping');
  exception when others then null;
  end;
  perform cron.schedule('ten270-oddspapi-postmatch-ping', '7,22,37,52 * * * *',
                        'select public.postmatch_dispatch()');
  begin
    perform cron.unschedule('ten270-oddspapi-postmatch-check');
  exception when others then null;
  end;
  perform cron.schedule('ten270-oddspapi-postmatch-check', '12,27,42,57 * * * *',
                        'select public.postmatch_dispatch_check()');
exception when others then
  raise warning 'TEN-270 post-match pinger NOT installed: % (%)', sqlerrm, sqlstate;
end
$outer$;
