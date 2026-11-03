#!/usr/bin/env python3
"""kibl-stream/cards_worker.py (architecture program stage 3, 2026-11-03) and tools/card-worker-fresh.py, offline.

A cycle is driven with the network, git and the two builder scripts stubbed:
  - a good cycle runs the builder, hands the publisher the PREVIOUS doc (its re-verification guard reads it), writes the
    new doc to card_state_doc (id 1, merge) and one ok card_state_runs row with 'done';
  - a failed build writes NO doc and a card_state_runs row ok=false, stage 'build', with the builder's tail;
  - the line-summary load running (or its state unreadable) skips the cycle: no build, a 'skipped' row;
  - card-worker-fresh: a good cycle within 20 min → fresh=true; none → false; unreadable → false (GitHub builds).
Each behaviour has a mutant control that must turn it red."""
import importlib.util, io, json, os, sys, tempfile, types

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FAILED = []


def check(name, ok, detail=''):
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else f'   {detail}'))
    if not ok:
        FAILED.append(name)


def load(src_path, replace=None):
    src = open(src_path).read()
    if replace:
        assert replace[0] in src, f'mutant anchor gone: {replace[0]!r}'
        src = src.replace(*replace)
    m = types.ModuleType('m'); m.__file__ = src_path
    exec(compile(src, src_path, 'exec'), m.__dict__)
    return m


def harness(W, build_rc=0, busy=False, prev_doc=None):
    calls = {'rest': [], 'run': []}
    work = tempfile.mkdtemp()
    W.WORK = work

    def rest(method, path, body=None, prefer=None, timeout=120):
        calls['rest'].append((method, path, body))
        if method == 'GET' and path.startswith('card_state_doc'):
            return [{'doc': prev_doc}] if prev_doc else []
        return None

    def run(cmd, timeout):
        calls['run'].append(cmd)
        if 'ten225-kibl-card-state.py' in cmd[2]:
            return build_rc, 1.0, 'build tail' if build_rc else ''
        out = cmd[cmd.index('--out') + 1]
        calls['prev_seen'] = json.load(open(out)) if os.path.exists(out) else None
        json.dump({'generatedAt': '2026-11-03T10:00:00Z', 'matches': 3, 'byKey': {'k': {}}}, open(out, 'w'))
        return 0, 2.0, ''

    W.rest, W.run, W.sync_repo = rest, run, (lambda: None)
    W.line_summary_busy = lambda: (busy, None)
    ok = W.cycle()
    return ok, calls


W = load(os.path.join(HERE, 'cards_worker.py'))
ok, c = harness(W, prev_doc={'generatedAt': '2026-11-03T09:50:00Z', 'byKey': {'old': {}}})
writes = [x for x in c['rest'] if x[0] == 'POST' and x[1].startswith('card_state_doc')]
runs = [x for x in c['rest'] if x[0] == 'POST' and x[1] == 'card_state_runs']
check('a good cycle builds, then publishes', ok and len(c['run']) == 2 and 'ten225-kibl-card-state.py' in c['run'][0][2], c['run'])
check('the publisher is handed the PREVIOUS doc (its re-verification guard reads it)', (c.get('prev_seen') or {}).get('byKey') == {'old': {}}, c.get('prev_seen'))
check('the new doc is written to card_state_doc id 1 (merge), with its generatedAt',
      len(writes) == 1 and writes[0][2]['id'] == 1 and writes[0][2]['generated_at'] == '2026-11-03T10:00:00Z' and writes[0][2]['doc']['byKey'] == {'k': {}}, writes)
check('one ok card_state_runs row, stage done, with timings', len(runs) == 1 and runs[0][2]['ok'] and runs[0][2]['stage'] == 'done' and runs[0][2]['build_s'] == 1.0, runs)

ok, c = harness(W, build_rc=1)
writes = [x for x in c['rest'] if x[0] == 'POST' and x[1].startswith('card_state_doc')]
runs = [x for x in c['rest'] if x[0] == 'POST' and x[1] == 'card_state_runs']
check('a failed build writes NO doc (the last good one stays)', not ok and not writes, writes)
check('…and a card_state_runs row ok=false, stage build, with the builder tail',
      len(runs) == 1 and runs[0][2]['ok'] is False and runs[0][2]['stage'] == 'build' and 'build tail' in runs[0][2]['error'], runs)

ok, c = harness(W, busy=True)
runs = [x for x in c['rest'] if x[0] == 'POST' and x[1] == 'card_state_runs']
check('the daily line-summary load running → no build, a skipped row (the builder guard)', not c['run'] and runs and runs[0][2]['stage'] == 'skipped', (c['run'], runs))

M = load(os.path.join(HERE, 'cards_worker.py'), ("        if busy:\n", "        if False:\n"))
ok, c = harness(M, busy=True)
check('MUTANT caught: the guard ignored → the builder runs during the load', bool(c['run']))
M = load(os.path.join(HERE, 'cards_worker.py'), ("        if rc != 0:\n            raise RuntimeError(f'card-state build exited", "        if False:\n            raise RuntimeError(f'card-state build exited"))
ok, c = harness(M, build_rc=1)
check('MUTANT caught: a failed build ignored → a doc would be written', any(x[0] == 'POST' and x[1].startswith('card_state_doc') for x in c['rest']))

# card-worker-fresh
F = load(os.path.join(ROOT, 'tools', 'card-worker-fresh.py'))


class R(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): return False


def fresh_with(answer):
    out = tempfile.mktemp()
    os.environ.update(SUPABASE_URL='https://x', SUPABASE_SECRET_KEY='k', GITHUB_OUTPUT=out)
    real = F.urllib.request.urlopen
    def op(req, timeout=None):
        if isinstance(answer, Exception): raise answer
        return R(json.dumps(answer).encode())
    F.urllib.request.urlopen = op
    try:
        F.main()
    finally:
        F.urllib.request.urlopen = real
    return open(out).read().strip()


check('card-worker-fresh: a good cycle within 20 min → fresh=true (GitHub does not build)', fresh_with([{'finished_at': 'x', 'host': 'h'}]) == 'fresh=true')
check('card-worker-fresh: none → fresh=false (GitHub builds as before)', fresh_with([]) == 'fresh=false')
check('card-worker-fresh: unreadable → fresh=false (never a gap in card prices)', fresh_with(OSError('down')) == 'fresh=false')

print()
if FAILED:
    print(f'{len(FAILED)} FAILED: {FAILED}')
    sys.exit(1)
print('test-cards-worker: all checks passed')
