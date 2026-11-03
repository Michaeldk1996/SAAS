#!/usr/bin/env python3
"""Card-state worker — architecture program stage 3 (2026-11-03).

Builds the card state (Open / Now / Close) every CYCLE_S seconds on an always-on Fly machine instead of GitHub's
throttled schedule (~20 min a run there + ~35 min to publish, so card prices sat ~65 min old on the site).

Each cycle, from a fresh shallow clone of main (the SAME code and the SAME committed inputs the GitHub job reads —
matches.json, .ten225-fixture-index.json.gz, … — so the result is the GitHub result, built sooner):
  1. ten225-kibl-card-state.py --use-live-flip   (re-derives every close; writes odds_card_state)
  2. ten225-publish-card-state.py --out <doc>     (the projection; its re-verification guard reads the PREVIOUS doc,
                                                  fetched from card_state_doc first)
  3. the doc → public.card_state_doc (one row), and one public.card_state_runs row (timings, error).
A failed cycle writes its card_state_runs row with the stage it stopped at and the error, keeps the last good doc, and
the next cycle tries again; the data-alarms watch alarms on a doc older than its limit. Nothing here is a gate.
Env: SUPABASE_URL, SUPABASE_SECRET_KEY, API_TENNIS_KEY (the app's existing secrets, base64 as NAME_B64).
"""
import base64, json, os, shutil, socket, subprocess, sys, threading, time, urllib.error, urllib.request
from datetime import datetime, timezone

REPO = os.environ.get('CARDS_REPO', 'https://github.com/Michaeldk1996/SAAS.git')
WORK = os.environ.get('CARDS_WORK', '/tmp/cards')
CYCLE_S = int(os.environ.get('CARDS_CYCLE_S', '600'))
BUILD_TIMEOUT_S = int(os.environ.get('CARDS_BUILD_TIMEOUT_S', '1500'))
# the database's rest between builds: never back to back, whatever a build took (3 Nov: a 30-s gap after slow builds
# kept the database reading continuously)
MIN_GAP_S = int(os.environ.get('CARDS_MIN_GAP_S', '300'))
# after a FAILED cycle (statement timeouts are the usual cause: a busy database) the next one waits longer
FAIL_GAP_S = int(os.environ.get('CARDS_FAIL_GAP_S', '900'))


def decode_b64_env():
    for k in list(os.environ):
        if k.endswith('_B64'):
            os.environ.setdefault(k[:-4], base64.b64decode(os.environ[k]).decode())


def now_iso():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def rest(method, path, body=None, prefer=None, timeout=120):
    url = os.environ['SUPABASE_URL'].rstrip('/') + '/rest/v1/' + path
    key = os.environ['SUPABASE_SECRET_KEY']
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={'apikey': key, 'Authorization': 'Bearer ' + key,
                                          'Content-Type': 'application/json', **({'Prefer': prefer} if prefer else {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    return json.loads(raw) if raw else None


def sync_repo():
    """A fresh shallow clone of main each cycle (cheap; never a stale tree)."""
    if os.path.isdir(WORK):
        shutil.rmtree(WORK)
    subprocess.run(['git', 'clone', '--depth', '1', '--branch', 'main', '--quiet', REPO, WORK], check=True, timeout=300)


LOAD_WF_RUNS = 'https://api.github.com/repos/Michaeldk1996/SAAS/actions/workflows/ten225-line-summary.yml/runs?per_page=5'
BUSY_STATES = ('in_progress', 'queued', 'waiting', 'requested', 'pending')


def line_summary_busy():
    """The builder guard's rule (ten232-builder-guard.py, founder 2026-10-29): never build while the daily line-summary
    load runs — both write through the pooler. Read anonymously (public repo); an unreadable answer counts as busy."""
    try:
        req = urllib.request.Request(LOAD_WF_RUNS, headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'stennisfy-cards/1.0'})
        with urllib.request.urlopen(req, timeout=30) as r:
            runs = json.loads(r.read()).get('workflow_runs') or []
        return any(x.get('status') in BUSY_STATES for x in runs), None
    except Exception as e:                       # noqa: BLE001
        return True, f'guard unreadable ({type(e).__name__}) — counted as busy'


LAST_TRACE = []                                  # the slowest pauses of the last run() (see trace_text)


def run(cmd, timeout):
    """Run a builder script unbuffered, timing every output line: LAST_TRACE keeps the 10 longest pauses with the line
    printed BEFORE each (the step that took the time), so card_state_runs says where a slow build spent it."""
    global LAST_TRACE
    t0 = time.time()
    p = subprocess.Popen(cmd, cwd=WORK, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
                         env={**os.environ, 'TEN270_CACHE_DIR': '/tmp/cards-cache', 'PYTHONUNBUFFERED': '1'})
    lines, gaps, prev_t, prev_l = [], [], t0, '(start)'
    killer = threading.Timer(timeout, p.kill)    # a silent hang is killed too (the read below would block forever)
    killer.start()
    try:
        for line in p.stdout:
            t = time.time()
            gaps.append((t - prev_t, prev_l))
            prev_t, prev_l = t, line.rstrip()[:200]
            lines.append(line)
        p.wait()
    finally:
        killer.cancel()
    gaps.append((time.time() - prev_t, prev_l))
    LAST_TRACE = sorted(gaps, reverse=True)[:10]
    if time.time() - t0 >= timeout:
        raise subprocess.TimeoutExpired(cmd, timeout)
    tail = ''.join(lines)[-1500:]
    return p.returncode, time.time() - t0, tail


def trace_text(trace):
    return '\n'.join(f'{d:7.1f}s after: {l}' for d, l in trace) or None


def cycle():
    started, stage, row = now_iso(), 'sync', {}
    try:
        busy, why = line_summary_busy()
        if busy:
            stage, ok, err = 'skipped', True, why or 'the daily line-summary load is running (builder guard)'
            raise StopIteration
        sync_repo()
        stage = 'build'
        # --obs-incremental: the builder reads kibl_line_observations from its local snapshot plus the rows seen since
        # its last read (a full read daily) — run back to back, the full 45-day read every cycle starved the database
        # of disk reads (3 Nov 05:00Z)
        rc, build_s, tail = run([sys.executable, '-B', 'ten225-kibl-card-state.py', '--use-live-flip', '--obs-incremental'],
                                BUILD_TIMEOUT_S)
        row['build_s'] = round(build_s, 1)
        row['trace'] = trace_text(LAST_TRACE)
        if rc != 0:
            raise RuntimeError(f'card-state build exited {rc}: {tail}')
        stage = 'publish'
        out = os.path.join(WORK, 'odds-card-state.json')
        # the publisher's re-verification guard reads the previous doc from --out: give it the one the page serves
        prev = rest('GET', 'card_state_doc?id=eq.1&select=doc') or []
        if prev:
            with open(out, 'w') as fh:
                json.dump(prev[0]['doc'], fh)
        rc, publish_s, tail = run([sys.executable, '-B', 'ten225-publish-card-state.py', '--out', out], 900)
        row['publish_s'] = round(publish_s, 1)
        if rc != 0:
            raise RuntimeError(f'publish exited {rc}: {tail}')
        stage = 'write'
        with open(out) as fh:
            doc = json.load(fh)
        row['matches'] = doc.get('matches')
        rest('POST', 'card_state_doc?on_conflict=id', {'id': 1, 'generated_at': doc['generatedAt'], 'written_at': now_iso(), 'doc': doc},
             prefer='resolution=merge-duplicates,return=minimal', timeout=300)
        stage, ok, err = 'done', True, None
    except StopIteration:
        pass
    except Exception as e:                       # noqa: BLE001 — recorded, the next cycle retries
        ok, err = False, f'{type(e).__name__}: {str(e)[-1200:]}'
        if stage == 'build' and LAST_TRACE:
            row['trace'] = trace_text(LAST_TRACE)
    try:
        rest('POST', 'card_state_runs', {'started_at': started, 'ok': ok, 'stage': stage, 'error': err,
                                         'host': socket.gethostname(), **row}, prefer='return=minimal')
    except Exception as e:                       # noqa: BLE001
        print(f'card_state_runs write failed: {e}', flush=True)
    print(f'{now_iso()} cycle ok={ok} stage={stage} {row} {err or ""}'[:3000], flush=True)
    return ok


def main():
    decode_b64_env()
    for k in ('SUPABASE_URL', 'SUPABASE_SECRET_KEY'):
        if not os.environ.get(k):
            raise SystemExit(f'missing {k}')
    if os.environ.get('CARDS_PAUSED') == '1':
        # paused by the deployment (fly.toml): no build, no write — the GitHub card job builds instead
        print('cards worker PAUSED (CARDS_PAUSED=1): no builds; the GitHub card job builds the card state', flush=True)
        while True:
            time.sleep(3600)
    print(f'cards worker up: every {CYCLE_S} s, repo {REPO}', flush=True)
    while True:
        t0 = time.time()
        ok = cycle()
        time.sleep(max(MIN_GAP_S if ok else FAIL_GAP_S, CYCLE_S - (time.time() - t0)))


if __name__ == '__main__':
    main()
