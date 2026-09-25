#!/usr/bin/env python3
"""TEN-270 post-match archive — reproducible mutant runs.

Applies each mutant of a guarded rule to a TEMP COPY (never the checkout), runs
the suite that guards it, and prints KILLED / SURVIVED per mutant plus the total.
A mutant whose anchor text is not found is reported as ANCHOR MISSING and counts
as not killed — a harness that silently skips is a vacuous pass.

  python3 tools/mutate-ten270-postmatch.py        # exit 0 only if every mutant is killed

Python mutants run test-oddspapi-postmatch.py with POSTMATCH_MODULE pointing at
the mutated copy of archive-oddspapi-raw.py (schema mutants: POSTMATCH_SCHEMA).
Box mutants run test-ten270-price-history-box.mjs from a temp dir holding the
mutated price-history-box.js next to copies of the test and the dashboard HTML.
The suite's 6 in-file schema CONTROLs are separate and not counted here.
"""
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = os.path.join(ROOT, 'archive-oddspapi-raw.py')
SQL = os.path.join(ROOT, 'kibl-stream', 'now-schema.sql')
JS = os.path.join(ROOT, 'price-history-box.js')

PY_MUT = {
    'result = past- only (finalScore dropped)': (
        "return str(m.get('id') or '').startswith('past-') and bool(m.get('finalScore'))",
        "return str(m.get('id') or '').startswith('past-')"),
    'no 30-min wait': ("if t['seenAgeMin'] < PM_WAIT_MIN:", "if False:"),
    'held fixture pulled again': ("        if held:\n            counts['held'] += 1",
                                  "        if False:\n            counts['held'] += 1"),
    'held checked in one month folder only': ("    for mo in months:\n", "    for mo in months[-1:]:\n"),
    'held not remembered in state (re-listed every run)': (
        "        if known.get('path'):", "        if False:"),
    'open market saved (no inactive check)': (
        "if ticks is not None and not market_closed(ticks):", "if False:"),
    'only ONE side must be inactive': (
        "return bool(ticks) and all(ticks.get(oc)", "return bool(ticks) and any(ticks.get(oc)"),
    '429 does not stop the run': ("            stop = '429'\n", "            stop = None\n"),
    '429 retried after a backoff': (
        "    if err == 429:\n        counts['http429'] += 1\n    return body, err",
        "    if err == 429:\n        counts['http429'] += 1\n        _sleep(10)\n"
        "        body, err = free_get('/v4/historical-odds', {'fixtureId': fixture_id}, key, raw=True)\n"
        "    return body, err"),
    '404 not recorded': ("r['n'] = int(r.get('n') or 0) + 1", "r['n'] = 0"),
    'a billable discovery call added': (
        "    # Pass 2 — the key: inside the window",
        "    api_get('/v4/fixtures', {'sportId': 12}, odds_key)\n    # Pass 2 — the key: inside the window"),
    'FREE_PATHS widened to /v4/fixtures': (
        "FREE_PATHS = frozenset({'/v4/historical-odds', '/v4/account'})",
        "FREE_PATHS = frozenset({'/v4/historical-odds', '/v4/account', '/v4/fixtures'})"),
    'window gate removed': ("    if can_call(now):\n        return True\n", "    return True\n"),
    'call margin dropped': (
        "return in_window(now) and in_window(now + timedelta(seconds=PM_CALL_MARGIN_S))",
        "return in_window(now)"),
    'loop gate removed (always idle)': ("        idle, why = loop_idle(now)\n",
                                        "        idle, why = True, 'mutant'\n"),
    'loop gate fails OPEN on a GitHub error': (
        "        return False, f'odds-now runs unreadable ({err})'",
        "        return True, f'odds-now runs unreadable ({err})'"),
    'loop restart ignored (boundary only)': ("    since = max([boundary] + live)", "    since = boundary"),
    'unreadable state read as empty': ("        return {} if is_not_found(err) else None", "        return {}"),
    'duplicate: ticks from the unsaved pull': (
        "            if t['bet365Card'] and t['orient']:\n                project_from_bucket(t, path, _now())",
        "            if t['bet365Card'] and t['orient']:\n                project_ticks(url, sb_key, t, payload, state, _now(), counts)"),
    'orientation ignored (121 always p1)': (
        "    side_of = {'121': 'p1', '122': 'p2'} if target['orient'] == 'same' \\\n        else {'121': 'p2', '122': 'p1'}",
        "    side_of = {'121': 'p1', '122': 'p2'}"),
    'every tick stored (no change-only)': (
        "            if prev and prev == (price, active):\n                continue\n", ""),
    'sub-1.01 prices stored': ("            if price < 1.01:\n                continue\n", ""),
    'name mismatch guessed as orient': (
        "        return 'swap' if o == 'same' else 'same'\n    return None",
        "        return 'swap' if o == 'same' else 'same'\n    return o"),
    'overwrite upload (upsert)': ("gzip.compress(body, 6), upsert=False)", "gzip.compress(body, 6), upsert=True)"),
}
SQL_MUT = {
    'RPC drops the fixture count': ("    'fixtures',        (select n_fx from fx),\n", ""),
}
JS_MUT = {
    'completed bet365 falls back to the shard': (
        "(bk === 'bet365' ? (upcoming ? 'shard' : (completed ? 'archive' : null)) : null)",
        "(bk === 'bet365' ? (upcoming || completed ? 'shard' : null) : null)"),
    'underway bet365 reads the archive': (
        "(bk === 'bet365' ? (upcoming ? 'shard' : (completed ? 'archive' : null)) : null)",
        "(bk === 'bet365' ? (upcoming ? 'shard' : 'archive') : null)"),
    'suspended ticks shown': ("if (!r || r.side !== who || r.active === false) continue;",
                              "if (!r || r.side !== who) continue;"),
    'side filter dropped': ("if (!r || r.side !== who || r.active === false) continue;",
                            "if (!r || r.active === false) continue;"),
    'not-archived says nothing special': (
        "if (!(Number(p.stored) > 0) || p.selected === false || Number(p.fixtures) !== 1) {", "if (false) {"),
    'fixtures != 1 not treated as not recorded': (
        " || Number(p.fixtures) !== 1) {", ") {"),
    'no-start shows rows anyway': ("if (!p.start_ts) return", "if (false) return"),
    'archive label = upcoming label': (
        "const ARCHIVE_NOTE = 'change times from bet365 · archived after the match';",
        "const ARCHIVE_NOTE = 'change times from bet365 · refreshed every 15 min';"),
    'failed read = empty history': ("if (p == null) return { card, rows: [], failed: true };",
                                    "if (p == null) return { card, rows: [] };"),
}


def run_py(mod_src=None, sql_src=None):
    d = tempfile.mkdtemp()
    env = dict(os.environ)
    try:
        if mod_src is not None:
            env['POSTMATCH_MODULE'] = os.path.join(d, 'archive-oddspapi-raw.py')
            open(env['POSTMATCH_MODULE'], 'w').write(mod_src)
        if sql_src is not None:
            env['POSTMATCH_SCHEMA'] = os.path.join(d, 'now-schema.sql')
            open(env['POSTMATCH_SCHEMA'], 'w').write(sql_src)
        r = subprocess.run([sys.executable, os.path.join(ROOT, 'test-oddspapi-postmatch.py')],
                           cwd=ROOT, env=env, capture_output=True, text=True, timeout=300)
    finally:
        shutil.rmtree(d)
    fails = [ln.strip() for ln in r.stdout.splitlines() if ln.strip().startswith('FAIL')]
    return r.returncode, fails or r.stderr.strip().splitlines()[-1:]


def run_js(js_src):
    d = tempfile.mkdtemp()
    try:
        for f in ('test-ten270-price-history-box.mjs', 'bsp-consult-dashboard.html'):
            shutil.copy(os.path.join(ROOT, f), d)
        open(os.path.join(d, 'price-history-box.js'), 'w').write(js_src)
        r = subprocess.run(['node', '--test', 'test-ten270-price-history-box.mjs'], cwd=d,
                           capture_output=True, text=True, timeout=300)
    finally:
        shutil.rmtree(d)
    fails = [ln.strip() for ln in r.stdout.splitlines() if ln.strip().startswith('✖')]
    return r.returncode, fails


def main():
    py, sql, js = open(PY).read(), open(SQL).read(), open(JS).read()
    base = [run_py()[0], run_js(js)[0]]
    print(f'baseline (unmutated): python suite exit {base[0]}, box suite exit {base[1]}')
    if any(base):
        print('baseline is RED — mutant results would mean nothing.')
        return 2
    killed = total = 0
    plan = ([('PY', n, py, a, b, lambda s: run_py(mod_src=s)) for n, (a, b) in PY_MUT.items()]
            + [('SQL', n, sql, a, b, lambda s: run_py(sql_src=s)) for n, (a, b) in SQL_MUT.items()]
            + [('JS', n, js, a, b, run_js) for n, (a, b) in JS_MUT.items()])
    for kind, name, src, a, b, runner in plan:
        total += 1
        if src.count(a) != 1:
            print(f'[{kind}] ANCHOR MISSING ({src.count(a)} matches): {name}')
            continue
        code, fails = runner(src.replace(a, b))
        killed += code != 0
        print(f'[{kind}] {"KILLED  " if code else "SURVIVED"} {name}'
              + (f' — {fails[0][:110]}' if code and fails else ''))
    print(f'{killed}/{total} mutants killed')
    return 0 if killed == total else 1


if __name__ == '__main__':
    sys.exit(main())
