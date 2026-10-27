#!/usr/bin/env python3
"""False 0-0 starts (founder brief 2026-10-27): a superseded live_flip_log row is never read as a start.

Part 1 (static, always runs): each of the 7 readers of a live-flip start reads public.live_flip_log_current (the view
that skips live_flip_log_superseded), never the table. Per reader a mutant points it back at the table and must be
caught, or the check is vacuous.
Part 2 (real throwaway Postgres): the migration applies twice; the view drops a superseded key and keeps the rest; the
sidecar is append-only (UPDATE / DELETE / TRUNCATE refused, owner and service_role); anon and authenticated read
neither; tools/false-starts-supersede.sql writes only rows that are still the measured false start and adds nothing on
a re-run. Control: the view WITHOUT its skip returns the superseded row (the mutant is caught). No Postgres binaries ->
SKIP out loud (never a pass); CI runners carry them."""
import os, re, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MIG = os.path.join(ROOT, 'supabase', 'migrations', '20261027120000_live_flip_superseded.sql')
DATA = os.path.join(ROOT, 'tools', 'false-starts-supersede.sql')
passed = failed = 0


def check(name, ok, detail=''):
    global passed, failed
    if ok:
        passed += 1; print('  PASS ', name)
    else:
        failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-300:])


# ── Part 1: every reader reads the view ─────────────────────────────────────────────────────────────────────────────
# A read of the raw table, in each reader's own idiom. The view's name extends the table's, so every pattern refuses a
# following word character (live_flip_log_current never matches).
RAW = [r"/rest/v1/live_flip_log(?!\w)", r"fetch_all\([^)]*'live_flip_log'", r"\bfrom\s+public\.live_flip_log(?!\w)",
       r"READ_TABLES\s*=\s*frozenset\(\{[^}]*'live_flip_log'"]
VIEW = r"live_flip_log_current"
# read-only diagnostics that must see every row, superseded ones included (they print the false starts themselves)
DIAGNOSTIC = {'tools/pinarch.py': ('def cmd_false_starts_report', 'def cmd_false_starts_ticks')}
# the files that WRITE the supersede (they must see the raw row to decide it), not readers of a start
WRITERS = {'tools/false-starts-supersede.sql'}
READERS = ['ten225-kibl-card-state.py', 'tools/pinarch.py', 'ten225-load-line-summary.py', 'tools/ten294-drops-api.sql',
           'tools/ten299-live-cut.sql', 'tools/tdarch.py', 'tools/archive-fill-probe.py']


def strip_diag(path, text):
    """The text minus the read-only diagnostic functions (each runs to the next top-level def)."""
    for start in DIAGNOSTIC.get(path, ()):
        i = text.find(start)
        if i < 0:
            continue
        j = text.find('\ndef ', i + 1)
        k = text.find('\nif __name__', i + 1)
        end = min(x for x in (j, k, len(text)) if x > 0)
        text = text[:i] + text[end:]
    return text


def reader_verdict(path, text):
    body = strip_diag(path, text)
    hits = [p for p in RAW if re.search(p, body)]
    if hits:
        return f'reads the raw table ({hits[0]})'
    if not re.search(VIEW, body):
        return 'does not read live_flip_log_current'
    return None


for path in READERS:
    text = open(os.path.join(ROOT, path)).read()
    v = reader_verdict(path, text)
    check(f'{path} reads live_flip_log_current, never the table', v is None, v)
    mutant = strip_diag(path, text).replace('live_flip_log_current', 'live_flip_log')
    check(f'{path} control: pointed back at the table -> caught', reader_verdict(path, mutant) is not None)

# the guard of the fill probe refuses the raw table outright (not only the read site)
fp = open(os.path.join(ROOT, 'tools/archive-fill-probe.py')).read()
check('archive-fill-probe READ_TABLES admits the view and not the table',
      "'live_flip_log_current'" in fp and not re.search(r"READ_TABLES[^\n]*'live_flip_log'", fp))

# nothing ELSE in the repo grew a raw read of a live-flip start since this test was written
skip_dirs = {'.git', 'node_modules', 'supabase', 'design-export'}
others = []
for d, ds, fs in os.walk(ROOT):
    ds[:] = [x for x in ds if x not in skip_dirs and not x.startswith('.')]
    for f in fs:
        if not f.endswith(('.py', '.js', '.mjs', '.sql')) or f.startswith('test'):
            continue
        rel = os.path.relpath(os.path.join(d, f), ROOT)
        if rel in READERS or rel in WRITERS:
            continue
        try:
            t = open(os.path.join(d, f), errors='ignore').read()
        except OSError:
            continue
        if any(re.search(p, t) for p in RAW[:3]):
            others.append(rel)
check('no other source reads live_flip_log raw', not others, others)

# ── Part 2: the migration on a real throwaway Postgres ─────────────────────────────────────────────────────────────
sys.path.insert(0, HERE)
from _pinarch_pg import PG  # noqa: E402
pg = PG()
if not pg.available():
    print(f'SKIP  Part 2 (real Postgres): {pg.why} — NOT A PASS (the code gate runs it)')
else:
    q = pg.q

    def qfile(path, role):
        """Run a SQL FILE as written (newlines kept — its `--` comments end at the line, never swallow the rest) and
        return every statement's rows, one per line: `psql -c` would print only the last statement's."""
        with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as t:
            t.write(f'set role {role};\n' + open(path).read())
        p = subprocess.run([pg.psql, '-h', pg.tmp, '-p', pg.port, '-U', 'postgres', '-d', 'postgres', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
                            '-f', t.name], capture_output=True, text=True)
        os.unlink(t.name)
        return p.returncode, '\n'.join(x for x in p.stdout.splitlines() if x.strip()) or p.stderr.strip()
    try:
        pg.roles()
        # the live table exactly as far as these files need it (columns the readers and the data file read)
        rc, out = q("create table public.live_flip_log (event_key text primary key, first_live_seen_at timestamptz not null, "
                    "last_not_live_seen_at timestamptz, poller text not null default 't', gap_seconds numeric, event_date text, "
                    "first_player text, second_player text, play_seen_at timestamptz);"
                    "alter table public.live_flip_log enable row level security; revoke all on public.live_flip_log from anon, authenticated;"
                    "grant select on public.live_flip_log to service_role;")
        check('fixture table', rc == 0, out)
        for i in (1, 2):
            rc, err = pg.file(MIG)
            check(f'migration applies (pass {i}: idempotent)', rc == 0, err)
        rc, out = q("insert into public.live_flip_log (event_key, first_live_seen_at, last_not_live_seen_at) values "
                    "('12173975', '2026-10-26T12:18:31.51Z', '2026-10-26T12:18:21.59Z'),"
                    "('12174058', '2026-10-26T12:18:31.51Z', '2026-10-26T12:18:21.59Z'),"
                    "('12174272', '2026-10-26T12:18:40Z', '2026-10-26T12:18:30Z'),"      # NOT the measured false start
                    "('99', '2026-10-26T13:00:00Z', '2026-10-26T12:59:50Z')")
        check('fixture rows', rc == 0, out)
        rc, out = q("select count(*) from public.live_flip_log_current", 'service_role')
        check('view holds every row before any supersede', out == '4', out)
        rc, out = qfile(DATA, 'service_role')
        check('data file: 3 wanted, 2 still the false start, 2 inserted; after: 2 superseded, 4 rows, 2 current',
              rc == 0 and out.split('\n') == ['3|2|2|0|4', '2|4|2'], out)
        rc, out = qfile(DATA, 'service_role')
        check('data file re-run adds nothing', rc == 0 and out.split('\n') == ['3|2|0|2|4', '2|4|2'], out)
        rc, out = q("select string_agg(event_key, ',' order by event_key) from public.live_flip_log_current", 'service_role')
        check('view skips the superseded keys and keeps the rest', out == '12174272,99', out)
        rc, out = q("select count(*) from public.live_flip_log")
        check('live_flip_log itself is untouched (4 rows)', out == '4', out)
        rc, out = q("select reason <> '' and evidence ? 'oddspapi_true_start' from public.live_flip_log_superseded limit 1")
        check('each superseded row carries its reason and evidence', out == 't', out)
        for verb, sql in (('UPDATE', "update public.live_flip_log_superseded set reason = 'x'"),
                          ('DELETE', 'delete from public.live_flip_log_superseded'),
                          ('TRUNCATE', 'truncate public.live_flip_log_superseded')):
            rc, out = q(sql, 'service_role'); check(f'service_role {verb} refused', rc != 0 and 'permission denied' in out, out)
            rc, out = q(sql); check(f'owner {verb} refused by the trigger', rc != 0 and 'append-only' in out, out)
        for role in ('anon', 'authenticated'):
            for rel in ('live_flip_log_current', 'live_flip_log_superseded'):
                rc, out = q(f'select count(*) from public.{rel}', role); check(f'{role} reads nothing from {rel}', rc != 0, out)
        # control: the same view without its skip returns a superseded row -> the check above would have failed
        q("create view public.lflc_mutant as select f.* from public.live_flip_log f")
        rc, out = q("select count(*) from public.lflc_mutant where event_key = '12173975'")
        check('control: a view without the skip returns the superseded row', out == '1', out)
    finally:
        pg.close()

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
