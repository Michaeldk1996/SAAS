#!/usr/bin/env python3
"""Offline tests for the pinger task (founder 2026-10-29) — no network.

1. The live-flip cadence reason: a relevant live flip recorded since the last
   sweep makes an automatic firing sweep, so the card-state builder runs.
2. The builder guard: the builder never runs while the daily line-summary load
   runs; an unreadable run state counts as busy; every decision is logged.
3. The wiring in ten232-kibl-archive.yml and the log table's schema.
Each check names the mutant it catches. Run against the pre-task code, sections
1 and 2 fail (no flips_since / no guard script).
"""

import datetime as dt
import io
import json
import os
import re
import sys
import tempfile
import types
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
FAILS = []


def check(label, ok, detail=""):
    print(f"  {'ok  ' if ok else 'FAIL'} {label}")
    if not ok:
        FAILS.append(label)
        if detail:
            print(f"       {detail}")


def load(name, path):
    m = types.ModuleType(name)
    m.__file__ = os.path.join(HERE, path)
    argv, sys.argv = sys.argv, [name]
    try:
        exec(compile(open(m.__file__).read(), m.__file__, "exec"), m.__dict__)
    finally:
        sys.argv = argv
    return m


A = load("A", "archive-kibl.py")

print("1. live-flip cadence reason")
check("a flip since the last sweep sweeps inside the baseline floor  [mutant: no flip clause]",
      A.should_sweep(2.0, None, 1) == (True, "live-flip"))
check("no flip, same gap: still too soon (the cadence rule is unchanged)",
      A.should_sweep(2.0, None, 0)[0] is False)
check("the default (no flip count) is the old rule",
      A.should_sweep(2.0, None)[0] is False and A.should_sweep(15.0, None) == (True, "baseline"))
check("a firing already due keeps its tier name",
      A.should_sweep(15.0, None, 3) == (True, "baseline"))
check("the flip levels are the cards' levels",
      A.LIVE_FLIP_LEVELS == ("Atp Singles", "Challenger Men Singles"))
check("it reads the superseded-free view", A.LIVE_FLIP_TABLE == "live_flip_log_current")

calls = []


def stub(answer):
    def sb(method, path, url, key, **kw):
        calls.append(path)
        return answer
    return sb


now = dt.datetime(2026, 10, 29, 12, 0, 0)
real_sb = A.sb_request
try:
    A.sb_request = stub(([{"event_key": "1"}, {"event_key": "2"}], None))
    calls.clear()
    n = A.flips_since("u", "k", now, 7.0)
    check("counts the flips the read returns", n == 2, n)
    q = urllib.parse.unquote(calls[0]) if calls else ""
    check("reads flips recorded after the last sweep started  [mutant: wrong window]",
          "recorded_at=gt.2026-10-29T11:53:00Z" in q, q)
    check("filters on both levels", '"Atp Singles"' in q and '"Challenger Men Singles"' in q, q)
    check("from the view", q.startswith("/rest/v1/live_flip_log_current?"), q)
    calls.clear()
    check("no previous sweep: no read (it sweeps anyway)",
          A.flips_since("u", "k", now, None) is None and calls == [])
    A.sb_request = stub((None, "HTTP 500"))
    check("an unreadable flip table adds no sweep (None)", A.flips_since("u", "k", now, 7.0) is None)
finally:
    A.sb_request = real_sb


class Stop(Exception):
    pass


def run_sweep(since, to_start, flips):
    saved = {k: getattr(A, k) for k in
             ("supabase_creds", "ensure_bucket", "cadence_inputs", "flips_since",
              "KiblClient", "_emit_output")}
    out = {}
    A.supabase_creds = lambda: ("u", "k")
    A.ensure_bucket = lambda u, k: None
    A.cadence_inputs = lambda u, k, t: (since, to_start)
    A.flips_since = lambda u, k, t, s: flips

    def kc():
        raise Stop()
    A.KiblClient = kc
    A._emit_output = lambda k, v: out.__setitem__(k, v)
    args = types.SimpleNamespace(cadence_gate=True, lookback_hours=1, horizon_days=3,
                                 betting_type_id=1)
    try:
        try:
            rc = A.sweep(args)
        except Stop:
            rc = "swept"
    finally:
        for k, v in saved.items():
            setattr(A, k, v)
    return rc, out.get("swept")


check("sweep(): a flip makes a 2-min-old firing sweep  [mutant: flips not passed in]",
      run_sweep(2.0, None, 1) == ("swept", "true"), run_sweep(2.0, None, 1))
check("sweep(): no flip, same firing skips and says swept=false",
      run_sweep(2.0, None, 0) == (0, "false"), run_sweep(2.0, None, 0))
check("sweep(): unreadable flips (None) behave as no flip",
      run_sweep(2.0, None, None) == (0, "false"))

print("2. builder guard")
G = load("G", "ten232-builder-guard.py")


def gh(answers):
    seen = []

    def get(path, token):
        seen.append(path)
        st = re.search(r"status=(\w+)", path).group(1)
        a = answers.get(st, {"workflow_runs": []})
        if isinstance(a, Exception):
            raise a
        return a
    return get, seen


get, seen = gh({})
busy, why, rid = G.load_state("t", get)
check("nothing running: the builder runs", busy is False and rid is None, why)
check("every busy state is asked, of the daily load's workflow",
      [re.search(r"status=(\w+)", p).group(1) for p in seen] == list(G.BUSY_STATES)
      and all("/workflows/ten225-line-summary.yml/runs" in p for p in seen), seen)
for st in G.BUSY_STATES:
    get, _ = gh({st: {"workflow_runs": [{"id": 77, "run_started_at": "x"}]}})
    busy, why, rid = G.load_state("t", get)
    check(f"a load {st}: skip  [mutant: {st} not checked]", busy is True and rid == "77", why)
get, _ = gh({"queued": OSError("api down")})
busy, why, _ = G.load_state("t", get)
check("an unreadable answer counts as busy  [mutant: fail open]",
      busy is True and why.startswith("unreadable"), why)
get, _ = gh({"in_progress": {"message": "Bad credentials"}})
check("an answer without workflow_runs counts as busy", G.load_state("t", get)[0] is True)
check("no token counts as busy", G.load_state("", gh({})[0])[0] is True)
check("it guards the daily load only (founder: daily load only)",
      G.LOAD_WF == "ten225-line-summary.yml")


class Resp(io.BytesIO):
    pass


def run_main(get, post_fails=False):
    posts = []

    def post(req, timeout=None):
        if post_fails:
            raise OSError("pooler full")
        posts.append((req.full_url, json.loads(req.data.decode())))
        return Resp(b"")
    with tempfile.TemporaryDirectory() as d:
        env = {"GITHUB_TOKEN": "t", "SUPABASE_URL": "https://x.supabase.co",
               "SUPABASE_SECRET_KEY": "k", "GITHUB_RUN_ID": "9", "GITHUB_EVENT_NAME": "workflow_dispatch",
               "GITHUB_OUTPUT": os.path.join(d, "out"), "GITHUB_STEP_SUMMARY": os.path.join(d, "sum")}
        old = {k: os.environ.get(k) for k in env}
        os.environ.update(env)
        buf, so = io.StringIO(), sys.stdout
        sys.stdout = buf
        try:
            rc = G.main(get=get, post=post)
        finally:
            sys.stdout = so
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        out = open(env["GITHUB_OUTPUT"]).read()
        summ = open(env["GITHUB_STEP_SUMMARY"]).read()
    return rc, out, posts, buf.getvalue(), summ


rc, out, posts, text, summ = run_main(gh({"in_progress": {"workflow_runs": [{"id": 5}]}})[0])
check("busy: output busy=true, exit 0 (a skip is not a failure)", rc == 0 and "busy=true" in out, out)
check("busy: one 'skipped' row appended to the log table  [mutant: no log]",
      len(posts) == 1 and posts[0][0].endswith("/rest/v1/ten232_builder_guard_log")
      and posts[0][1]["decision"] == "skipped" and posts[0][1]["line_summary_run"] == "5"
      and posts[0][1]["run_id"] == "9", posts)
check("busy: a ::notice:: and a summary line", "::notice::builder guard: SKIPPED" in text and "SKIPPED" in summ, text)
rc, out, posts, text, _ = run_main(gh({})[0])
check("clear: busy=false and a 'ran' row", "busy=false" in out and posts[0][1]["decision"] == "ran", posts)
rc, out, posts, text, _ = run_main(gh({"queued": {"workflow_runs": [{"id": 6}]}})[0], post_fails=True)
check("a failed log write is a warning and the decision stands",
      rc == 0 and "busy=true" in out and "::warning::" in text, text)

print("3. wiring")
wf = open(os.path.join(HERE, ".github/workflows/ten232-kibl-archive.yml")).read()
gi = wf.find("id: guard")
ci = wf.find("id: cards")
check("the guard step sits after the sweep and before the card state",
      wf.find("id: sweep") < gi < wf.find("id: refsnap") < ci, (gi, ci))
for sid in ("refsnap", "cardsnap", "cards", "publish"):
    i = wf.find(f"id: {sid}")
    block = wf[i:wf.find("run:", i) if sid != "refsnap" and sid != "cardsnap" else wf.find("uses:", i)]
    check(f"{sid} is skipped when the guard says busy  [mutant: {sid} unguarded]",
          "steps.guard.outputs.busy != 'true'" in block, block[:300])
gblock = wf[gi:wf.find("run:", gi)]
check("the guard runs on automatic firings that swept",
      "github.event_name == 'schedule' || inputs.cadence_gate == 'true'" in gblock
      and "steps.sweep.outputs.swept != 'false'" in gblock, gblock)
check("the guard has the token and applies its table through the schema gate",
      "GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}" in wf[gi:ci]
      and "ten232-schema-gate.py ten232-builder-guard-schema.sql" in wf[gi:ci])
check("the workflow's offline tests run this file", "python3 -B test-ten232-pinger.py" in wf)
pkg = open(os.path.join(HERE, "package.json")).read()
check("npm test runs this file", "test-ten232-pinger.py" in pkg)

sql = open(os.path.join(HERE, "ten232-builder-guard-schema.sql")).read().lower()
check("log table: RLS on, browser roles revoked, service_role select+insert only",
      "enable row level security" in sql and "revoke all on public.ten232_builder_guard_log from anon, authenticated" in sql
      and "grant select, insert on public.ten232_builder_guard_log to service_role" in sql)
check("log table: update/delete/truncate refused",
      "before update or delete" in sql and "before truncate" in sql)
check("log table: no update or delete statement anywhere in the guard",
      not re.search(r"\b(update|delete)\b\s", open(os.path.join(HERE, "ten232-builder-guard.py")).read().lower()
                    .split('"""')[-1]))

print()
if FAILS:
    print(f"FAILED {len(FAILS)}: {FAILS}")
    sys.exit(1)
print("all pinger-task tests passed")
