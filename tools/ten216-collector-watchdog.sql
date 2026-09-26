-- TEN-295 (founder 2026-09-26, comment 5dafce2b, item 4): "The collector was down 22–26 Sep and
-- nothing flagged it. Add an alert when no new price row (heartbeat included) has landed for more
-- than 60 minutes during the season. A failed run must fail visibly."
--
-- WHAT IT WATCHES: the newest row in EITHER the TEN-216 change log (ten216_test_odds_changes) or
-- its per-poll heartbeat (ten216_test_polls, chart-apitennis-rpc.sql — install that first). The
-- collector polls every 5 min; api-tennis re-prices ~every 30 min, so the heartbeat is what keeps a
-- quiet-but-healthy collector from reading as down.
--
-- RULE (a test): every 10 min, if now() - newest row > 60 min (120 min until the first OK heartbeat
-- exists — change rows alone go quiet for up to ~60 min) and today is IN SEASON, condition
-- `collector_stale` is open -> one Telegram alert, repeated every 3 h while it stays open, and a
-- RECOVERED message when a row lands again. Off-season = 1–26 Dec (UTC date); nothing alerts then.
--
-- WHERE IT GOES (measured 2026-09-26): the ops chat (Vault ops_telegram_bot_token /
-- ops_telegram_chat_id) when both exist — they do NOT today; else the Superbet drop-bot chat
-- (Vault ten287_telegram_bot_token / ten287_telegram_chat_id), the one Telegram route measured
-- delivering (HTTP 200). Every send is logged in ten216_watch_log with the channel used, and
-- resolved against pg_net: 'queued' -> 'sent' | 'failed: HTTP n' | 'failed: timeout/error' |
-- 'failed: no response' (10 min). No secret at all -> 'unsent' + RAISE WARNING. Never silent.
-- Hosts: api.telegram.org only. Reads no market data beyond two max(observed_at).
do $outer$
begin
  create extension if not exists pg_cron;
  create extension if not exists pg_net;

  create table if not exists public.ten216_watch_alerts (
      condition     text        primary key,
      is_open       boolean     not null default false,
      opened_at     timestamptz,
      last_sent_at  timestamptz,
      detail        text,
      updated_at    timestamptz not null default now()
  );
  create table if not exists public.ten216_watch_log (
      id          bigserial   primary key,
      at          timestamptz not null default now(),
      condition   text        not null,
      kind        text        not null,      -- alert | recovered
      channel     text,                      -- ops | ten287-drop-bot | none
      message     text        not null,
      request_id  bigint,
      delivered   text        not null       -- 'queued' -> 'sent' | 'failed: …'; 'unsent: …'
  );
  alter table public.ten216_watch_alerts enable row level security;
  alter table public.ten216_watch_log    enable row level security;
  revoke all on public.ten216_watch_alerts from anon, authenticated;
  revoke all on public.ten216_watch_log    from anon, authenticated;

  create or replace function public.ten216_watch_send(p_condition text, p_kind text, p_text text)
  returns text
  language plpgsql security definer
  set search_path = public, pg_temp
  as $fn$
  declare
    tok text; chat text; ch text := 'ops'; req bigint;
  begin
    select decrypted_secret into tok  from vault.decrypted_secrets where name = 'ops_telegram_bot_token' limit 1;
    select decrypted_secret into chat from vault.decrypted_secrets where name = 'ops_telegram_chat_id' limit 1;
    if coalesce(length(trim(tok)), 0) = 0 or coalesce(length(trim(chat)), 0) = 0 then
      ch := 'ten287-drop-bot';
      select decrypted_secret into tok  from vault.decrypted_secrets where name = 'ten287_telegram_bot_token' limit 1;
      select decrypted_secret into chat from vault.decrypted_secrets where name = 'ten287_telegram_chat_id' limit 1;
    end if;
    if coalesce(length(trim(tok)), 0) = 0 or coalesce(length(trim(chat)), 0) = 0 then
      insert into public.ten216_watch_log (condition, kind, channel, message, delivered)
      values (p_condition, p_kind, 'none', p_text, 'unsent: no telegram secret in vault');
      raise warning 'TEN-216 collector ALERT UNSENT (no telegram secret in vault): %', p_text;
      return 'unsent';
    end if;
    select net.http_post(
      url := 'https://api.telegram.org/bot' || trim(tok) || '/sendMessage',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('chat_id', trim(chat), 'text', p_text, 'disable_web_page_preview', true)
    ) into req;
    insert into public.ten216_watch_log (condition, kind, channel, message, request_id, delivered)
    values (p_condition, p_kind, ch, p_text, req, 'queued');
    return 'queued:' || ch;
  end $fn$;
  revoke all on function public.ten216_watch_send(text, text, text) from public, anon, authenticated;

  create or replace function public.ten216_collector_check(p_now timestamptz default now())
  returns text
  language plpgsql security definer
  set search_path = public, pg_temp
  as $fn$
  declare
    newest timestamptz; stale boolean; a record; msg text; d date := (p_now at time zone 'UTC')::date;
    offseason boolean; has_hb boolean; limit_min int;
  begin
    -- a queued send is not a delivery: resolve it against pg_net
    update public.ten216_watch_log l set delivered = case
        when r.timed_out or r.error_msg is not null then 'failed: timeout/error'
        when r.status_code between 200 and 299 then 'sent'
        else 'failed: HTTP ' || r.status_code end
      from net._http_response r
      where l.delivered = 'queued' and r.id = l.request_id
        and (r.status_code is not null or r.timed_out or r.error_msg is not null);
    update public.ten216_watch_log l set delivered = 'failed: no response'
      where l.delivered = 'queued' and l.at < p_now - interval '10 minutes'
        and not exists (select 1 from net._http_response r where r.id = l.request_id);

    select greatest(
             (select max(observed_at) from public.ten216_test_odds_changes),
             (select max(observed_at) from public.ten216_test_polls where ok))
      into newest;
    offseason := extract(month from d) = 12 and extract(day from d) <= 26;
    -- Until the first OK heartbeat exists (the collector picks up the heartbeat code at its next
    -- 5.5-h hand-off), only change rows can prove life, and api-tennis re-prices in ~30-min
    -- batches (longest measured quiet stretch 60 min 20 s, 26 Sep): 120 min then, 60 min after.
    has_hb := exists (select 1 from public.ten216_test_polls where ok);
    limit_min := case when has_hb then 60 else 120 end;
    stale := not offseason and (newest is null or p_now - newest > make_interval(mins => limit_min));

    select * into a from public.ten216_watch_alerts where condition = 'collector_stale';
    if stale then
      if not coalesce(a.is_open, false) or a.last_sent_at is null
         or a.last_sent_at < p_now - interval '3 hours' then
        msg := 'ALERT - Stennisfy api-tennis odds collector (TEN-216): no new price row or heartbeat (limit '
               || limit_min || ' min) for '
               || coalesce(floor(extract(epoch from (p_now - newest)) / 60)::text || ' min (newest '
                  || to_char(newest at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || 'Z)', 'ever')
               || '. The collector chain has stopped - the Odds-tab api-tennis lines go stale. '
               || 'Restart: dispatch .github/workflows/ten216-collector.yml on main.';
        perform public.ten216_watch_send('collector_stale', 'alert', msg);
        insert into public.ten216_watch_alerts (condition, is_open, opened_at, last_sent_at, detail, updated_at)
        values ('collector_stale', true, p_now, p_now, msg, p_now)
        on conflict (condition) do update set
          is_open = true,
          opened_at = case when ten216_watch_alerts.is_open then ten216_watch_alerts.opened_at else p_now end,
          last_sent_at = p_now, detail = excluded.detail, updated_at = p_now;
        return 'alerted';
      end if;
      return 'open';
    elsif coalesce(a.is_open, false) then
      msg := 'RECOVERED - Stennisfy api-tennis odds collector (TEN-216): rows landing again (newest '
             || to_char(newest at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || 'Z; down since '
             || to_char(a.opened_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || 'Z).';
      perform public.ten216_watch_send('collector_stale', 'recovered', msg);
      update public.ten216_watch_alerts set is_open = false, detail = null, updated_at = p_now
        where condition = 'collector_stale';
      return 'recovered';
    end if;
    return case when offseason then 'off-season' else 'ok' end;
  end $fn$;
  revoke all on function public.ten216_collector_check(timestamptz) from public, anon, authenticated;

  begin
    perform cron.unschedule('ten216-collector-watchdog');
  exception when others then null;   -- not scheduled yet: nothing to remove
  end;
  perform cron.schedule('ten216-collector-watchdog', '*/10 * * * *', 'select public.ten216_collector_check()');
end
$outer$;
