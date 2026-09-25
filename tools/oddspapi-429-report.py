#!/usr/bin/env python3
"""TEN-270 — "Report 429 counts for both jobs after 24 h." (founder ruling)

Reads the GitHub job logs of the two jobs that share the oddspapi key and
counts /v4/historical-odds 429s over the last --hours:

  odds-now.yml (the live price loop)  — `historical-odds … failed … HTTP 429`
      warnings. The loop retries a 429 up to 4 times and logs only a call that
      FAILED after its retries, so this is failed calls, not raw 429 responses.
      Denominator: the calls in its `across N historical-odds call(s)` lines.
  oddspapi-postmatch.yml — the run summary's `"http429": N` (every 429
      response, retries included) and `"/v4/historical-odds": N` calls.

Read-only. Token from GH_TOKEN or GITHUB_TOKEN; never printed.
  python3 tools/oddspapi-429-report.py --hours 24
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

REPO = 'michaeldk1996/SAAS'


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def gh(path, token, raw=False):
    req = urllib.request.Request('https://api.github.com' + path, headers={
        'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json'})
    try:
        with urllib.request.build_opener(_NoRedirect).open(req, timeout=120) as r:
            body = r.read()
    except urllib.error.HTTPError as e:
        # Job logs answer 302 to a signed storage URL, which must be fetched
        # WITHOUT our Authorization header (it rejects one with a 401).
        if e.code != 302:
            raise
        with urllib.request.urlopen(e.headers['Location'], timeout=120) as r:
            body = r.read()
    return body if raw else json.loads(body)


def job_logs(wf, since, token):
    try:
        runs = gh(f'/repos/{REPO}/actions/workflows/{wf}/runs?per_page=100', token)['workflow_runs']
    except urllib.error.HTTPError as e:
        print(f'  {wf}: no runs readable (HTTP {e.code}) — not on main yet?')
        return
    for run in runs:
        upd = datetime.fromisoformat(run['updated_at'].replace('Z', '+00:00'))
        if upd < since:
            continue
        for job in gh(f'/repos/{REPO}/actions/runs/{run["id"]}/jobs', token)['jobs']:
            try:
                yield gh(f'/repos/{REPO}/actions/jobs/{job["id"]}/logs', token, raw=True).decode('utf-8', 'replace')
            except Exception as e:                            # noqa: BLE001 — reported
                print(f'  (log for job {job["id"]} unreadable: {e})')


def in_window(line, since):
    m = re.match(r'(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)', line)
    return bool(m) and datetime.fromisoformat(m.group(1)).replace(tzinfo=timezone.utc) >= since


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hours', type=float, default=24)
    a = ap.parse_args()
    token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
    if not token:
        sys.exit('GH_TOKEN / GITHUB_TOKEN not set')
    since = datetime.now(timezone.utc) - timedelta(hours=a.hours)

    failed = calls = 0
    for log in job_logs('odds-now.yml', since, token):
        for ln in log.splitlines():
            if not in_window(ln, since):
                continue
            if 'historical-odds' in ln and 'HTTP 429' in ln:
                failed += 1
            m = re.search(r'across (\d+) historical-odds call', ln)
            if m:
                calls += int(m.group(1))
    print(f'odds loop (odds-now.yml), last {a.hours:g} h: {failed} historical-odds call(s) '
          f'failed on 429 after retries, of {calls} call(s).')

    r429 = hist = runs = 0
    for log in job_logs('oddspapi-postmatch.yml', since, token):
        for ln in log.splitlines():
            if not in_window(ln, since):
                continue
            m = re.search(r'"http429": (\d+)', ln)
            if m:
                r429 += int(m.group(1))
                runs += 1
            m = re.search(r'"/v4/historical-odds": (\d+)', ln)
            if m:
                hist += int(m.group(1))
    if not runs:
        print(f'post-match (oddspapi-postmatch.yml), last {a.hours:g} h: — (no run summary found; '
              f'a zero here would be a vacuous count).')
    else:
        print(f'post-match (oddspapi-postmatch.yml), last {a.hours:g} h: {r429} 429 response(s) '
              f'over {hist} historical-odds call(s) in {runs} run(s).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
