-- TEN-270 — pg_cron dispatcher for .github/workflows/oddspapi-postmatch.yml.
-- NOT APPLIED. Nothing in the repo runs this file; it is the schema step's
-- input once the founder approves the job.
--
-- WHY. GitHub's `schedule:` delivers only a fraction of slots on this repo
-- (~27% of an hourly schedule, odds-now.yml; ZERO of ~66 five-minute slots for
-- the Kibl archive, measured 2026-09-18 — ten232-kibl-sweep-cron.py). At 27% a
-- 15-min job runs about once an hour at irregular times, which is not "straight
-- after the game". pg_cron is minute-accurate and was measured at ~100% on this
-- project (TEN-141), so the dispatch lands at :07/:22/:37/:52 and the runner
-- starts shortly after; the script's own :05-:14 window check still guards the
-- key if a run is delayed.
--
-- PREREQUISITE. A vault secret named gh_postmatch_dispatch_pat holding a PAT
-- that may dispatch workflows on Michaeldk1996/SAAS. It is created the way
-- ten232-kibl-sweep-cron.py creates its own (vault.create_secret over the
-- Management API, never echoed). It is deliberately NOT the Kibl pinger's
-- gh_kibl_dispatch_pat or TEN-141's gh_workflow_pat: removing either of those
-- jobs must not silently stop this one.
--
-- ONE TRIGGER ONLY: apply this file and delete the `schedule:` block from
-- .github/workflows/oddspapi-postmatch.yml IN THE SAME CHANGE. With both active
-- every slot fires twice (the second run queues behind the first and re-lists).
--
-- The dispatched workflow file must exist on main (workflow_dispatch resolves
-- the file on the ref it is sent to).

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin perform cron.unschedule('ten270-oddspapi-postmatch-ping');
      exception when others then null; end $$;

select cron.schedule(
  'ten270-oddspapi-postmatch-ping',
  '7,22,37,52 * * * *',
  $job$
    select net.http_post(
      url := 'https://api.github.com/repos/Michaeldk1996/SAAS/actions/workflows/oddspapi-postmatch.yml/dispatches',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret
                                         from vault.decrypted_secrets
                                        where name = 'gh_postmatch_dispatch_pat'),
        'Accept', 'application/vnd.github+json',
        'User-Agent', 'supabase-pg-cron-ten270-postmatch',
        'Content-Type', 'application/json'),
      body := '{"ref":"main"}'::jsonb
    );
  $job$
);
