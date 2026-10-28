#!/usr/bin/env python3
"""card-job-lock — apply a schema file only when it has changed.

WHY. ten232-kibl-archive.yml re-applied ten232-kibl-schema.sql and
ten225-card-state-schema.sql on EVERY run. Both are idempotent, but idempotent
is not lock-free: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` and `ALTER COLUMN
SET DEFAULT` take an ACCESS EXCLUSIVE lock even when they change nothing. The
bet105 bot's tick() and drops_api.snapshot() hold read locks on kibl_fixtures
and kibl_line_observations almost constantly, so from 27 Oct 13:31Z every run
died at "Apply the schema" with 40P01 (deadlock) or 57014 (statement timeout)
and no card was re-cut.

WHAT IT DOES. Records the sha256 of each applied file in
public.schema_apply_versions. A run whose file matches the recorded sha does
not touch the tables at all: one read of the version table, no lock on any
kibl or card table. Only a changed file is applied, inside one transaction with
a short lock_timeout, and retried on a lock or connection failure. It never
stops or pauses the bots to get a lock; it waits its turn and gives up loudly.

    python3 -B ten232-schema-gate.py <file.sql>

Env: SUPABASE_URL, SUPABASE_ACCESS_TOKEN, GITHUB_RUN_ID (recorded, optional).
Exit 0: unchanged, or applied. Exit 1: a changed file could not be applied.
"""

import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

MGMT = "https://api.supabase.com"
LOCK_TIMEOUT = "3s"          # how long one attempt queues behind the bots' read locks
STATEMENT_TIMEOUT = "100s"   # under the Management API's own cut-off, so OUR timeout names the cause
ATTEMPTS = 6
BACKOFF_S = (15, 30, 45, 60, 90)   # ~4 min across six attempts

# Lock or transient-connection failures: worth another attempt.
RETRY_CODES = ("55P03", "40P01", "57014")      # lock_not_available, deadlock, statement timeout
RETRY_HTTP = (500, 502, 503, 504, 520, 522, 524, 544)

# Bootstrap. The version table is new with this change, so the first run finds
# no row for either file. Both files are byte-identical to the ones the last
# successful runs applied (27 Oct 07:33Z run 40467880224 at 650ff1ee6 and
# 22:40Z run 40596583235 at c5e8d9c8d; neither file has changed since
# 25 Sep). A missing row whose file still has exactly this sha is therefore
# already live: record it without re-applying, so the first run after the fix
# does not walk straight back into the lock it exists to avoid. Any OTHER sha
# with no row is applied normally. Used only while the row is missing.
ALREADY_LIVE = {
    "ten232-kibl-schema.sql":
        "a4851a5536f498b08469aac96772d8c868876c501094dfd7800283e13eb02f22",
    "ten225-card-state-schema.sql":
        "8f01429cbad3eb950da30f08064419bf877da0c259853f53146e8a62188041a6",
}

VERSION_DDL = """
create table if not exists public.schema_apply_versions (
    name        text primary key,
    sha256      text not null,
    applied_at  timestamptz not null default now(),
    run_id      text,
    note        text
);
alter table public.schema_apply_versions enable row level security;
revoke all on public.schema_apply_versions from anon, authenticated;
"""


class SqlError(Exception):
    def __init__(self, msg, http=None):
        super().__init__(msg)
        self.http = http

    @property
    def retryable(self):
        if self.http in RETRY_HTTP:
            return True
        return any(c in str(self) for c in RETRY_CODES) or "connection timeout" in str(self).lower()


def lit(s):
    return "'" + str(s).replace("'", "''") + "'"


def project_ref(url):
    m = re.search(r"https?://([a-z0-9]+)\.supabase\.co", url or "")
    if not m:
        raise SystemExit("::error::could not derive project ref from SUPABASE_URL")
    return m.group(1)


def make_runner(ref, token):
    def run_sql(query):
        req = urllib.request.Request(
            f"{MGMT}/v1/projects/{ref}/database/query",
            data=json.dumps({"query": query}).encode(),
            headers={"Authorization": f"Bearer {token}",
                     "Content-Type": "application/json",
                     "User-Agent": "ten232-schema-gate/1.0"},
            method="POST")
        try:
            with urllib.request.urlopen(req, timeout=150) as r:
                return json.loads(r.read().decode() or "[]")
        except urllib.error.HTTPError as e:
            raise SqlError(f"HTTP {e.code} {e.read().decode()[:400]}", http=e.code)
        except Exception as e:                                   # noqa: BLE001
            raise SqlError(f"{type(e).__name__}: {e}", http=544)  # no response: treat as a dropped connection
    return run_sql


def apply_sql(name, sha, body, run_id):
    """The changed-file path: the file and its version row commit together or not at all."""
    return (f"begin;\n"
            f"set local lock_timeout = {lit(LOCK_TIMEOUT)};\n"
            f"set local statement_timeout = {lit(STATEMENT_TIMEOUT)};\n"
            f"{body}\n;\n"   # own line: a trailing comment in the file cannot swallow the terminator
            f"insert into public.schema_apply_versions (name, sha256, applied_at, run_id, note)\n"
            f"  values ({lit(name)}, {lit(sha)}, now(), {lit(run_id)}, 'applied')\n"
            f"  on conflict (name) do update set sha256 = excluded.sha256,\n"
            f"    applied_at = excluded.applied_at, run_id = excluded.run_id, note = excluded.note;\n"
            f"commit;\n")


def with_retry(fn, what, attempts=ATTEMPTS, sleep=time.sleep, log=print):
    for i in range(1, attempts + 1):
        try:
            return fn()
        except SqlError as e:
            if not e.retryable or i == attempts:
                raise
            wait = BACKOFF_S[min(i - 1, len(BACKOFF_S) - 1)]
            log(f"{what}: attempt {i}/{attempts} failed ({str(e)[:160]}); retrying in {wait}s")
            sleep(wait)


def gate(path, run_sql, run_id="", sleep=time.sleep, log=print):
    """Returns 'unchanged' | 'recorded' | 'applied'. Raises SqlError when a changed file cannot be applied."""
    name = os.path.basename(path)
    with open(path, "rb") as f:
        raw = f.read()
    sha = hashlib.sha256(raw).hexdigest()

    # The version table lives apart from every hot table, so creating and reading it never queues behind the bots.
    have = with_retry(lambda: run_sql(
        "select to_regclass('public.schema_apply_versions') is not null as have;"),
        "version table", sleep=sleep, log=log)
    if not (have and have[0].get("have")):
        with_retry(lambda: run_sql(VERSION_DDL), "version table create", sleep=sleep, log=log)
    rows = with_retry(lambda: run_sql(
        f"select sha256 from public.schema_apply_versions where name = {lit(name)};"),
        "version read", sleep=sleep, log=log)
    stored = rows[0]["sha256"] if rows else None

    if stored == sha:
        log(f"{name}: unchanged (sha {sha[:12]}, recorded) — not applied, no table locks taken.")
        return "unchanged"
    if stored is None and ALREADY_LIVE.get(name) == sha:
        with_retry(lambda: run_sql(
            f"insert into public.schema_apply_versions (name, sha256, run_id, note) values "
            f"({lit(name)}, {lit(sha)}, {lit(run_id)}, 'bootstrap: already live, not re-applied') "
            f"on conflict (name) do nothing;"), "bootstrap record", sleep=sleep, log=log)
        log(f"{name}: first sight of the version table; file unchanged since the last good apply "
            f"(sha {sha[:12]}) — recorded, not re-applied.")
        return "recorded"

    log(f"{name}: changed ({(stored or 'none')[:12]} -> {sha[:12]}) — applying with "
        f"lock_timeout {LOCK_TIMEOUT}, up to {ATTEMPTS} attempts.")
    with_retry(lambda: run_sql(apply_sql(name, sha, raw.decode(), run_id)), f"{name} apply",
               sleep=sleep, log=log)
    log(f"{name}: applied and recorded (sha {sha[:12]}).")
    return "applied"


def main(argv):
    if len(argv) != 2:
        print("usage: ten232-schema-gate.py <file.sql>")
        return 2
    url = (os.environ.get("SUPABASE_URL") or "").strip()
    token = (os.environ.get("SUPABASE_ACCESS_TOKEN") or "").strip()
    if not url or not token:
        print("::error::SUPABASE_URL / SUPABASE_ACCESS_TOKEN missing")
        return 1
    try:
        gate(argv[1], make_runner(project_ref(url), token),
             run_id=(os.environ.get("GITHUB_RUN_ID") or "").strip())
    except SqlError as e:
        print(f"::error::schema apply failed for {os.path.basename(argv[1])}: {e}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
