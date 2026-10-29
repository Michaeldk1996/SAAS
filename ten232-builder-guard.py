#!/usr/bin/env python3
"""Pinger task (founder 2026-10-29) — never run the card-state builder while
the daily line-summary load runs.

The founder's ruling: "a guard so the pinger never fires the builder while the
daily load runs (the 'too many connections' hit)". Both jobs write through the
Supabase pooler. The load is scheduled at 06:25Z but GitHub's throttle starts
it anywhere from 11:18Z to 13:40Z (measured 17-29 Oct), and it is also
dispatched by hand, so the clock cannot say when it runs: its run state is read
right here, at the moment the builder would start. (The pg_cron pinger cannot
do it: pg_net is asynchronous, so the pinger could only read the answer to its
PREVIOUS tick, up to 5 minutes old.)

Busy = any ten225-line-summary.yml run in_progress / queued / waiting /
requested / pending. A read that fails, or an answer that does not parse,
counts as busy. Every decision is printed, written to the step summary, and
appended to public.ten232_builder_guard_log; a failed log write is a warning
and never changes the decision. A skip is not a failure: the run stays green.

Env: GITHUB_TOKEN, SUPABASE_URL, SUPABASE_SECRET_KEY, GITHUB_RUN_ID,
GITHUB_EVENT_NAME, GITHUB_OUTPUT, GITHUB_STEP_SUMMARY. Writes busy=true|false.
"""

import json
import os
import sys
import urllib.request

REPO = "Michaeldk1996/SAAS"
LOAD_WF = "ten225-line-summary.yml"
BUSY_STATES = ("in_progress", "queued", "waiting", "requested", "pending")
LOG_TABLE = "ten232_builder_guard_log"


def gh_get(path, token):
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        headers={"Authorization": f"Bearer {token}",
                 "Accept": "application/vnd.github+json",
                 "User-Agent": "ten232-builder-guard/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def load_state(token, get=gh_get):
    """(busy, reason, the load's run id or None). Unreadable counts as busy."""
    if not token:
        return True, "unreadable: no GITHUB_TOKEN", None
    for st in BUSY_STATES:
        try:
            body = get(f"/repos/{REPO}/actions/workflows/{LOAD_WF}/runs"
                       f"?status={st}&per_page=5", token)
            runs = body["workflow_runs"]
            if not isinstance(runs, list):
                raise ValueError("workflow_runs is not a list")
        except Exception as e:                                # noqa: BLE001
            return True, f"unreadable: {st} runs ({type(e).__name__}: {str(e)[:120]})", None
        if runs:
            r = runs[0]
            return True, (f"daily line-summary load {st} (run {r.get('id')}, "
                          f"started {r.get('run_started_at')})"), str(r.get("id"))
    return False, "daily line-summary load not running", None


def log_row(url, key, row, post=None):
    """Append one row; returns an error string or None."""
    if not url or not key:
        return "SUPABASE_URL / SUPABASE_SECRET_KEY missing"
    req = urllib.request.Request(
        url.rstrip("/") + f"/rest/v1/{LOG_TABLE}",
        data=json.dumps(row).encode(), method="POST",
        headers={"apikey": key, "Authorization": f"Bearer {key}",
                 "Content-Type": "application/json", "Prefer": "return=minimal",
                 "User-Agent": "ten232-builder-guard/1.0"})
    try:
        (post or urllib.request.urlopen)(req, timeout=30).close()
        return None
    except Exception as e:                                    # noqa: BLE001
        return f"{type(e).__name__}: {str(e)[:160]}"


def emit(name, value):
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"{name}={value}\n")


def main(get=gh_get, post=None):
    busy, reason, ls_run = load_state((os.environ.get("GITHUB_TOKEN") or "").strip(), get)
    decision = "skipped" if busy else "ran"
    row = {"run_id": os.environ.get("GITHUB_RUN_ID"),
           "event": os.environ.get("GITHUB_EVENT_NAME"),
           "decision": decision, "reason": reason, "line_summary_run": ls_run}
    err = log_row((os.environ.get("SUPABASE_URL") or "").strip(),
                  (os.environ.get("SUPABASE_SECRET_KEY") or "").strip(), row, post)
    line = f"builder guard: {decision.upper()} — {reason}"
    if busy:
        print(f"::notice::{line}. Card state and publish skip this firing; the sweep ran.")
    else:
        print(line)
    if err:
        print(f"::warning::builder guard: could not append to {LOG_TABLE} ({err}); "
              f"the decision stands")
    summ = os.environ.get("GITHUB_STEP_SUMMARY")
    if summ:
        with open(summ, "a") as f:
            f.write(f"\n{line}\n")
    emit("busy", "true" if busy else "false")
    return 0


if __name__ == "__main__":
    sys.exit(main())
