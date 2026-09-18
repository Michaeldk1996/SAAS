#!/usr/bin/env python3
"""TEN-232 Part 1 — install / inspect / remove the Kibl sweep pinger.

WHAT THIS IS FOR. The archive workflow's `schedule:` trigger does not deliver on
this repo: MEASURED 2026-09-18 05:05Z, zero firings in 5h34m against ~66 due,
while seven OTHER workflows each got one schedule run in the same window. Kibl
serves no history, so an undelivered firing is a price that no longer exists.
This installs the mechanism TEN-141 measured at ~100% on this same project: a
Supabase pg_cron job that dispatches the workflow from always-on infrastructure.

WHAT IT DOES NOT DO. It does not decide the cadence. The dispatch carries
cadence_gate=true and should_sweep() applies the founder's 15-minute baseline /
5-minute-from-T-60 ruling; the pinger only sets how often that rule can be
applied. It also never touches TEN-141: its own job name, its own vault secret,
and an explicit post-install control that the pipeline's job and secret are
still there — because the failure that would matter most here is silently
taking the site's freshness ping down while fixing the archive's.

Secrets are read from the environment and never printed. The PAT is passed to
Postgres inside a vault.create_secret() call and is redacted from every echo.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

JOB = "ten232-kibl-sweep-ping"
SECRET_NAME = "gh_kibl_dispatch_pat"          # ours; NOT ten141's gh_workflow_pat
FOREIGN_JOB = "ten141-pipeline-ping"          # must survive everything we do
FOREIGN_SECRET = "gh_workflow_pat"            # ditto
REPO = "Michaeldk1996/SAAS"
WF = "ten232-kibl-archive.yml"
SCHEDULE = "*/5 * * * *"
MGMT = "https://api.supabase.com"


def die(msg):
    print(f"::error::{msg}")
    sys.exit(1)


def sql_lit(s):
    return "'" + s.replace("'", "''") + "'"


def project_ref(url):
    m = re.search(r"https?://([a-z0-9]+)\.supabase\.co", url)
    if not m:
        die("could not parse the project ref from SUPABASE_URL")
    return m.group(1)


def run_sql(ref, token, query, what, soft=False):
    """soft=True: a failure is reported and returns None instead of exiting.

    Used only for the diagnostic reads (pg_cron keeps run history in a table
    whose presence depends on the extension version). A diagnostic that cannot
    run must not fail an install that succeeded — but it must say so out loud
    rather than print an empty section that reads like "nothing wrong".
    """
    req = urllib.request.Request(
        f"{MGMT}/v1/projects/{ref}/database/query",
        data=json.dumps({"query": query}).encode(),
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json",
                 "User-Agent": "ten232-kibl-sweep-cron/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.loads(r.read().decode() or "[]")
    except urllib.error.HTTPError as e:
        msg = f"{what}: HTTP {e.code} {e.read().decode()[:400]}"
        if soft:
            print(f"::warning::{msg}")
            return None
        die(msg)
    except Exception as e:                                    # noqa: BLE001
        if soft:
            print(f"::warning::{what}: {e}")
            return None
        die(f"{what}: {e}")


def rest_get(url, key, path):
    req = urllib.request.Request(
        url.rstrip("/") + path,
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "User-Agent": "ten232-kibl-sweep-cron/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode() or "[]"), None
    except Exception as e:                                    # noqa: BLE001
        return None, str(e)


def sweep_gap(url, key):
    """Minutes since the last sweep actually recorded a window — the gap alert.

    Reads the sweeps table rather than the GitHub run list on purpose: a run
    that started, skipped on the cadence gate and exited green is not a capture,
    and a green run list is exactly how a dead archive would look healthy.
    """
    if not url or not key:
        return None
    rows, err = rest_get(
        url, key,
        "/rest/v1/kibl_sweeps?select=started_at,sweep_id&order=started_at.desc&limit=1")
    if err or not rows:
        return None
    import datetime as dt
    try:
        ts = dt.datetime.fromisoformat(str(rows[0]["started_at"]).replace("Z", "+00:00"))
    except Exception:                                         # noqa: BLE001
        return None
    now = dt.datetime.now(dt.timezone.utc)
    return (now - ts).total_seconds() / 60.0, rows[0].get("sweep_id")


def main():
    url = (os.environ.get("SUPABASE_URL") or "").strip()
    token = (os.environ.get("SUPABASE_ACCESS_TOKEN") or "").strip()
    # Trailing-newline trim on every secret read: the BetsAPI token failed on
    # exactly that, and a PAT with a newline dispatches nothing and says 401.
    pat = (os.environ.get("WORKFLOW_PAT") or "").strip()
    srk = (os.environ.get("SUPABASE_SECRET_KEY") or "").strip()
    action = (os.environ.get("ACTION") or "status").strip()
    if not url or not token:
        die("SUPABASE_URL / SUPABASE_ACCESS_TOKEN missing")
    ref = project_ref(url)
    print(f"project ref `{ref}`, action `{action}`, job `{JOB}`\n")

    body = json.dumps({"ref": "main",
                       "inputs": {"mode": "sweep", "cadence_gate": "true"}})

    if action == "install":
        if not pat:
            die("WORKFLOW_PAT is empty — cannot install the pinger")
        query = f"""
        create extension if not exists pg_cron;
        create extension if not exists pg_net;
        delete from vault.secrets where name = {sql_lit(SECRET_NAME)};
        select vault.create_secret({sql_lit(pat)}, {sql_lit(SECRET_NAME)},
                                   'TEN-232 Kibl sweep dispatch PAT');
        do $$ begin perform cron.unschedule({sql_lit(JOB)});
              exception when others then null; end $$;
        select cron.schedule(
          {sql_lit(JOB)},
          {sql_lit(SCHEDULE)},
          $job$
            select net.http_post(
              url := 'https://api.github.com/repos/{REPO}/actions/workflows/{WF}/dispatches',
              headers := jsonb_build_object(
                'Authorization', 'Bearer ' || (select decrypted_secret
                                                 from vault.decrypted_secrets
                                                where name = '{SECRET_NAME}'),
                'Accept', 'application/vnd.github+json',
                'User-Agent', 'supabase-pg-cron-ten232',
                'Content-Type', 'application/json'),
              body := '{body}'::jsonb
            );
          $job$
        );
        """
        run_sql(ref, token, query, "install")
        print("installed.")

    elif action == "uninstall":
        run_sql(ref, token, f"""
        do $$ begin perform cron.unschedule({sql_lit(JOB)});
              exception when others then null; end $$;
        delete from vault.secrets where name = {sql_lit(SECRET_NAME)};
        """, "uninstall")
        print("uninstalled.")

    elif action != "status":
        die(f"unknown action {action!r}")

    # ---- the same read-back for every action, so install and uninstall both
    # ---- have to show their work rather than assert it.
    jobs = run_sql(ref, token, f"""
      select jobname, schedule, active from cron.job
       where jobname in ({sql_lit(JOB)}, {sql_lit(FOREIGN_JOB)}) order by jobname;
    """, "job read-back")
    print("## pg_cron jobs")
    for j in jobs:
        print(f"- `{j['jobname']}` `{j['schedule']}` active={j['active']}")
    names = {j["jobname"] for j in jobs}
    if action == "install" and JOB not in names:
        die("install reported success but the job is not in cron.job")
    if action == "uninstall" and JOB in names:
        die("uninstall reported success but the job is still in cron.job")

    # The DO-NOT-TOUCH control. Asserted after every action, including
    # uninstall, because collateral damage to the pipeline's ping would be
    # invisible here and would show up hours later as a stale site.
    sec = run_sql(ref, token, f"""
      select name from vault.secrets
       where name in ({sql_lit(SECRET_NAME)}, {sql_lit(FOREIGN_SECRET)}) order by name;
    """, "vault read-back")
    have = {s["name"] for s in sec}
    print(f"\nTEN-141 still intact: job={FOREIGN_JOB in names}, "
          f"secret={FOREIGN_SECRET in have}")
    if FOREIGN_JOB not in names or FOREIGN_SECRET not in have:
        die("TEN-141's pipeline ping or its secret is missing — collateral damage")

    # Delivery evidence: what the job's own HTTP posts came back with. 204 is a
    # GitHub dispatch accepted; anything else is a pinger that looks scheduled
    # and delivers nothing.
    runs = run_sql(ref, token, f"""
      select status, return_message, start_time
        from cron.job_run_details d
        join cron.job j on j.jobid = d.jobid
       where j.jobname = {sql_lit(JOB)}
       order by start_time desc limit 5;
    """, "job run details", soft=True)
    print("\n## last pinger firings")
    if runs is None:
        print("- — (cron.job_run_details unreadable; see the warning above)")
        runs = []
    elif not runs:
        print("- none yet (the job fires on the next 5-minute boundary)")
    for r in runs:
        print(f"- {r['start_time']} {r['status']} {str(r.get('return_message') or '')[:80]}")

    resp = run_sql(ref, token, """
      select status_code, left(coalesce(content,''), 120) as body, error_msg, created
        from net._http_response order by created desc limit 5;
    """, "http responses")
    print("\n## last pg_net responses (all jobs on this project)")
    for r in resp:
        print(f"- {r['created']} status={r['status_code']} "
              f"err={str(r.get('error_msg') or '')[:60]} {str(r.get('body') or '')[:60]}")

    gap = sweep_gap(url, srk)
    print("\n## archive freshness")
    if gap is None:
        print("- minutes since the last recorded sweep: — (sweeps table unreadable here)")
    else:
        mins, sid = gap
        print(f"- last recorded sweep `{sid}`, {mins:.0f} min ago")
        if mins > 60:
            print(f"::warning::the Kibl archive has not captured a window in {mins:.0f} min")
    return 0


if __name__ == "__main__":
    sys.exit(main())
