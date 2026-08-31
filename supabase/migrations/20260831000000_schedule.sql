-- TEN-107 · Slice 5 (go-live) — schedule the shared poller on a 10s pg_cron timer.
-- Tier 1 (founder-approved 2026-08-31): cadence 30s → 10s. NB the Edge Function's
-- LEASE_TTL_SECONDS must stay BELOW this cadence (see functions/live-poller/index.ts,
-- set to 7s with ~3s margin for pg_cron jitter) — otherwise the previous tick's lease
-- is still valid when the next fires and every tick self-skips, pinning the effective
-- cadence to the TTL.
--
-- Applied by .github/workflows/supabase-live-golive.yml AFTER the go-live step has
-- written two Vault secrets (via the Management API): POLLER_SECRET (the shared
-- secret the Edge Function checks) and POLLER_FN_URL (the function's invoke URL).
-- This migration reads both from the Vault, so it carries no project-specific
-- values and is safe to commit.
--
-- Idempotent: extensions guarded with IF NOT EXISTS, function via CREATE OR
-- REPLACE, the cron job unscheduled-then-scheduled. Re-running rotates nothing.

-- 1. Extensions: pg_cron drives the timer, pg_net makes the outbound HTTP call.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Wrapper: one clean call the cron command can invoke without nested quoting.
--    SECURITY DEFINER so the job (whatever role owns it) can read the Vault and
--    reach net.http_post. Reads the current secret/URL from the Vault each tick,
--    so rotating the secret needs no reschedule.
create or replace function public.tick_live_poller()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $$
declare
  _url    text;
  _secret text;
  _req_id bigint;
begin
  select decrypted_secret into _url    from vault.decrypted_secrets where name = 'POLLER_FN_URL';
  select decrypted_secret into _secret from vault.decrypted_secrets where name = 'POLLER_SECRET';
  if _url is null or _secret is null then
    raise notice 'tick_live_poller: POLLER_FN_URL / POLLER_SECRET not in Vault; skipping';
    return null;
  end if;
  select net.http_post(
    url     := _url,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-poller-secret', _secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 12000
  ) into _req_id;
  return _req_id;
end;
$$;

-- Service-side only: never exposed to browser roles.
revoke execute on function public.tick_live_poller() from public, anon, authenticated;

-- 3. (Re)schedule the 10s poller. cron.schedule with an existing jobname updates
--    it in place, but unschedule-first keeps a clean single definition. We drop
--    BOTH the legacy 'live-poller-30s' job AND any prior 'live-poller-10s' so a
--    previously-applied 30s job cannot linger alongside the new 10s one.
--
--    Sub-minute cadence MUST use pg_cron's interval form ('10 seconds'), NOT a
--    6-field seconds cron. pg_cron parses only 5-field cron: passing
--    '*/10 * * * * *' silently truncates to the 5-field '*/10 * * * *' = every
--    10 MINUTES, which froze live_snapshot on the first go-live. The interval
--    form is what verified live (cron.job.schedule = '30 seconds', active=true).
--    Do not "correct" this back to cron syntax.
do $$
declare _job text;
begin
  for _job in
    select jobname from cron.job where jobname in ('live-poller-30s', 'live-poller-10s')
  loop
    perform cron.unschedule(_job);
  end loop;
end
$$;

select cron.schedule('live-poller-10s', '10 seconds', 'select public.tick_live_poller();');
