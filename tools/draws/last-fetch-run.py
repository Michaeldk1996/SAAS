#!/usr/bin/env python3
"""Start time of the most recent draws.yml run that actually FETCHED (its "Build draws.json" step succeeded).

    GH_TOKEN=… python3 tools/draws/last-fetch-run.py <owner/repo> [<this run id, excluded>]   → ISO time, or "" if none

A cadence-gated run that skipped also ends `success`, so "last successful run" is the wrong clock: measured from skips,
a pipeline that completes every <110 min would keep draws.yml skipping forever (seen 2026-10-20 18:00 + 18:07Z).
"""
import json, os, sys, urllib.request

BUILD_STEP = "Build draws.json"


def get(url, token):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def last_fetch(runs, jobs_of, exclude=None):
    """runs: newest first [{id, run_started_at, conclusion}]; jobs_of(run) → [{steps:[{name, conclusion}]}]."""
    for r in runs:
        if exclude and str(r["id"]) == str(exclude):
            continue
        for j in jobs_of(r):
            for st in j.get("steps") or []:
                if st.get("name", "").startswith(BUILD_STEP) and st.get("conclusion") == "success":
                    return r["run_started_at"]
    return ""


if __name__ == "__main__":
    repo, exclude = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else None)
    tok = os.environ["GH_TOKEN"]
    runs = get(f"https://api.github.com/repos/{repo}/actions/workflows/draws.yml/runs?per_page=30", tok).get("workflow_runs") or []
    print(last_fetch(runs, lambda r: get(r["jobs_url"], tok).get("jobs") or [], exclude))
