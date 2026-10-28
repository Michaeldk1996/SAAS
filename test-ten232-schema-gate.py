#!/usr/bin/env python3
"""Offline tests for ten232-schema-gate.py (card-job-lock) — no network, no secrets.

The card job died at "Apply the schema" from 27 Oct 13:31Z because it re-applied
an unchanged schema on every run, taking ACCESS EXCLUSIVE locks the bots' reads
deadlocked against. These pin the rule: an unchanged file sends nothing that
touches a table; a changed file goes in one transaction with a short
lock_timeout and is retried on a lock or connection failure, never on an SQL error.
Each check names the mutation that turns it red.
"""

import importlib.util
import json
import os
import re
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("schema_gate", os.path.join(HERE, "ten232-schema-gate.py"))
sg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sg)

FAILS = []


def check(label, ok, detail=""):
    print(f"  {'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        FAILS.append(label)
        if detail:
            print(f"       {detail}")


class FakeDb:
    """A Management API stand-in: records every query, answers the version reads, fails on demand."""

    def __init__(self, stored=None, have_table=True, fail=()):
        self.stored, self.have, self.fail, self.sent = stored, have_table, list(fail), []

    def __call__(self, q):
        self.sent.append(q)
        if "to_regclass('public.schema_apply_versions')" in q:
            return [{"have": self.have}]
        if q.lstrip().startswith("select sha256"):
            return [{"sha256": self.stored}] if self.stored else []
        if self.fail and q.startswith("begin;"):
            raise self.fail.pop(0)
        return []


def sql_file(body, name="x-schema.sql"):
    d = tempfile.mkdtemp()
    p = os.path.join(d, name)
    with open(p, "w") as f:
        f.write(body)
    return p


BODY = "alter table public.kibl_fixtures add column if not exists foo text;\n-- trailing comment"
quiet = lambda *_: None   # noqa: E731

print("1. an unchanged file takes no table lock")
p = sql_file(BODY)
sha = sg.hashlib.sha256(BODY.encode()).hexdigest()
db = FakeDb(stored=sha)
r = sg.gate(p, db, sleep=lambda _s: None, log=quiet)
touched = [q for q in db.sent if re.search(r"\b(alter|create|insert|update|delete|begin)\b|kibl_", q, re.I)]
check("returns 'unchanged'  [mutant: always apply]", r == "unchanged", r)
check("sends only the two version reads, nothing naming a table or DDL", len(db.sent) == 2 and not touched, db.sent)

print("2. a changed file is applied once, in one transaction, with lock_timeout")
db = FakeDb(stored="0" * 64)
r = sg.gate(p, db, run_id="77", sleep=lambda _s: None, log=quiet)
applied = [q for q in db.sent if q.startswith("begin;")]
check("returns 'applied'", r == "applied", r)
check("exactly one apply  [mutant: apply twice]", len(applied) == 1, len(applied))
a = applied[0] if applied else ""
check("lock_timeout and statement_timeout are set LOCAL before the body  [mutant: drop lock_timeout]",
      a.index("set local lock_timeout") < a.index(BODY.splitlines()[0])
      and "set local statement_timeout" in a if a else False)
check("the version row is written in the SAME transaction, before commit  [mutant: record after commit]",
      a.index("insert into public.schema_apply_versions") < a.rindex("commit;") if a else False)
check("a trailing comment in the file cannot swallow the terminator  [mutant: rstrip(';') + ';']",
      "-- trailing comment\n;\n" in a, a[-200:])
check("the run id is recorded", "'77'" in a)
lt = re.match(r"(\d+)s$", sg.LOCK_TIMEOUT)
check("lock_timeout is short (<= 5 s) so a waiting ALTER never queues the bots for long",
      bool(lt) and int(lt.group(1)) <= 5, sg.LOCK_TIMEOUT)

print("3. bootstrap: a missing row for an already-live file is recorded, not re-applied")
name = "boot-schema.sql"
pb = sql_file(BODY, name)
real = dict(sg.ALREADY_LIVE)
sg.ALREADY_LIVE[name] = sha
try:
    db = FakeDb(stored=None)
    r = sg.gate(pb, db, sleep=lambda _s: None, log=quiet)
    check("returns 'recorded'  [mutant: drop ALREADY_LIVE]", r == "recorded", r)
    check("sends no apply transaction", not any(q.startswith("begin;") for q in db.sent))
    check("records the row with ON CONFLICT DO NOTHING (never overwrites a newer apply)",
          any("bootstrap" in q and "do nothing" in q for q in db.sent))
    db = FakeDb(stored=None)
    sg.ALREADY_LIVE[name] = "f" * 64
    r = sg.gate(pb, db, sleep=lambda _s: None, log=quiet)
    check("a missing row for any OTHER sha is applied  [mutant: bootstrap on any missing row]", r == "applied", r)
finally:
    sg.ALREADY_LIVE.clear()
    sg.ALREADY_LIVE.update(real)
db = FakeDb(stored=None, have_table=False)
sg.gate(p, db, sleep=lambda _s: None, log=quiet)
check("the version table is created only when to_regclass says it is missing",
      any("create table if not exists public.schema_apply_versions" in q for q in db.sent))
db = FakeDb(stored=sha, have_table=True)
sg.gate(p, db, sleep=lambda _s: None, log=quiet)
check("...and never on a normal run (no ALTER on every run, even of the version table)",
      not any("create table" in q or "alter table" in q for q in db.sent), db.sent)

print("4. retries: lock and connection failures yes, SQL errors no")
for code, label in (("55P03", "lock_timeout"), ("40P01", "deadlock"), ("57014", "statement timeout")):
    sleeps = []
    db = FakeDb(stored="0" * 64, fail=[sg.SqlError(f"HTTP 400 ERROR: {code}: x", http=400)] * 2)
    r = sg.gate(p, db, sleep=sleeps.append, log=quiet)
    check(f"{code} ({label}) twice, then success → applied after 2 waits", r == "applied" and len(sleeps) == 2,
          f"{r} {sleeps}")
sleeps = []
db = FakeDb(stored="0" * 64, fail=[sg.SqlError("HTTP 544 Connection terminated due to connection timeout", http=544)])
check("HTTP 544 (the breaker's 27 Oct failure) is retried",
      sg.gate(p, db, sleep=sleeps.append, log=quiet) == "applied" and len(sleeps) == 1)
sleeps = []
db = FakeDb(stored="0" * 64, fail=[sg.SqlError("HTTP 400 ERROR: 42601: syntax error", http=400)])
try:
    sg.gate(p, db, sleep=sleeps.append, log=quiet)
    raised = False
except sg.SqlError:
    raised = True
check("a syntax error fails at once, no retry  [mutant: retry everything]", raised and sleeps == [], sleeps)
sleeps = []
db = FakeDb(stored="0" * 64, fail=[sg.SqlError("HTTP 400 ERROR: 40P01: deadlock", http=400)] * 99)
try:
    sg.gate(p, db, sleep=sleeps.append, log=quiet)
    raised = False
except sg.SqlError:
    raised = True
check(f"a lock that never frees gives up after {sg.ATTEMPTS} attempts, loudly",
      raised and len(sleeps) == sg.ATTEMPTS - 1, len(sleeps))

print("5. the wiring")
wf = open(os.path.join(HERE, ".github/workflows/ten232-kibl-archive.yml")).read()
for f in ("ten232-kibl-schema.sql", "ten225-card-state-schema.sql"):
    check(f"{f} is applied only through the gate  [control: the pre-fix workflow piped it to curl]",
          f"python3 -B ten232-schema-gate.py {f}" in wf and not re.search(rf"jq -Rs[^\n]*{re.escape(f)}", wf))
kibl = open(os.path.join(HERE, "ten232-kibl-schema.sql")).read()
lk = re.search(r"lock table public\.kibl_fixtures, public\.kibl_line_observations in access exclusive mode", kibl)
first_alter = kibl.find("alter table public.kibl_line_observations")
check("the Kibl schema locks kibl_fixtures THEN kibl_line_observations (the readers' order) before any ALTER  "
      "[control: the pre-fix file ALTERs kibl_line_observations first]",
      bool(lk) and 0 <= lk.start() < first_alter)
check("the workflow's offline tests run this file", "python3 -B test-ten232-schema-gate.py" in wf)
pkg = json.load(open(os.path.join(HERE, "package.json")))["scripts"]["test"]
check("npm test runs this file and the breaker tests",
      "test-ten232-schema-gate.py" in pkg and "test-ten232-breaker.py" in pkg)

print()
if FAILS:
    print(f"FAILED {len(FAILS)}: {FAILS}")
    sys.exit(1)
print("all card-job-lock schema-gate tests passed")
