-- TEN-270 — pg_cron dispatcher for .github/workflows/oddspapi-postmatch.yml.
-- Founder 2026-09-25: "Yes, I'll add the secret; install the dispatcher and
-- remove the GitHub schedule". This is the post-match job's ONLY trigger (its
-- workflow has no `schedule:`). Applied by the `schema` action of
-- .github/workflows/ten270-stream-now.yml, after kibl-stream/now-schema.sql.
--
-- WHY. GitHub's `schedule:` delivers only a fraction of slots on this repo
-- (~27% of an hourly schedule, odds-now.yml; ZERO of ~66 five-minute slots for
-- the Kibl archive, measured 2026-09-18 — ten232-kibl-sweep-cron.py). pg_cron is
-- minute-accurate and measured at ~100% on this project (TEN-141).
--
-- THE SECRET — the same pattern as the Kibl pinger (ten232-kibl-sweep-cron.py)
-- and the TEN-141 pipeline pinger: a PAT stored in Supabase Vault under its OWN
-- name, read at dispatch time from vault.decrypted_secrets. The `schema` action
-- stores it from the POSTMATCH_DISPATCH_PAT repository secret (delete +
-- vault.create_secret), never echoing it. It is deliberately NOT the Kibl
-- pinger's gh_kibl_dispatch_pat or TEN-141's gh_workflow_pat: removing either
-- of those jobs must not stop this one.
--
-- FAIL SAFE. Everything below runs inside one DO block that turns any failure
-- into a WARNING, so it can never fail the schema apply. With no vault secret
-- the job still runs every slot but dispatches nothing: postmatch_dispatch()
-- raises a WARNING (Postgres log) and returns 'skipped: …' (cron.job_run_details).
--
-- The dispatched workflow file must exist on main (workflow_dispatch resolves
-- the file on the ref it is sent to).

do $outer$
begin
  create extension if not exists pg_cron;
  create extension if not exists pg_net;

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
    return 'dispatched: net request ' || req;
  end $fn$;
  revoke all on function public.postmatch_dispatch() from public;
  revoke all on function public.postmatch_dispatch() from anon, authenticated;

  begin
    perform cron.unschedule('ten270-oddspapi-postmatch-ping');
  exception when others then null;
  end;
  perform cron.schedule('ten270-oddspapi-postmatch-ping', '7,22,37,52 * * * *',
                        'select public.postmatch_dispatch()');
exception when others then
  raise warning 'TEN-270 post-match pinger NOT installed: % (%)', sqlerrm, sqlstate;
end
$outer$;
