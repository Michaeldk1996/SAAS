#!/usr/bin/env python3
"""Backup → restore round trip of the Pinnacle archive on two throwaway Postgres databases (founder brief 2026-10-14,
item 1: "how to restore from it"). Real gzip payloads, a correction row (supersedes), two dated copies (the second
holds only the rows added since the first), then restore into an EMPTY database and compare every row of every table.
Plus: a dated copy is never replaced; a tampered file stops the restore; the captured-file import plans only new rows
and adds a changed row as a correction (supersedes), never an edit. No Postgres → SKIP out loud (never a pass)."""
import gzip, hashlib, json, os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _pinarch_pg import PG, MIG
import importlib.util
spec = importlib.util.spec_from_file_location('pinarch', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pinarch.py'))
P = importlib.util.module_from_spec(spec); spec.loader.exec_module(P)

passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('  PASS ', name)
    else: failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-400:])

# 1. pure planning checks (no database needed)
cap = [{'eventKey': 1, 'date': '2026-07-12', 'p1Key': 10, 'p2Key': 11, 'p1Name': 'A', 'p2Name': 'B', 'p1': 1.5, 'p2': 2.6,
        'at': '2026-07-12T10:00:00.000Z', 'trueStart': '2026-07-12T10:05:00.000Z'},
       {'eventKey': 2, 'date': '2026-09-30', 'p1': 1.9, 'p2': 1.95, 'at': '2026-09-30T09:00:00.000Z',
        'trueStart': '2026-09-30T09:30:00.000Z', 'book': 'Pinnacle +30s', 'startSource': 'api-tennis-live'}]
rows = P.captured_close_rows(cap, 'abc')
check('captured: a row to 2 Sep without a book is Oddspapi plain Pinnacle', rows[0]['book'] == 'Pinnacle' and rows[1]['book'] == 'Pinnacle +30s', rows)
check('captured: gap to start = start − price time, in seconds', rows[0]['gap_to_start_s'] == 300.0 and rows[1]['gap_to_start_s'] == 1800.0)
check('captured: the original row is kept verbatim in detail', rows[1]['detail']['row'] == cap[1])
try:
    P.captured_close_rows([{'eventKey': 3, 'date': '2026-09-20', 'p1': 1.5, 'p2': 2.5, 'at': 'x'}]); bad = False
except ValueError:
    bad = True
check('captured: a row after 2 Sep with no book is refused, never guessed', bad)
held = [{'id': 7, 'event_key': 1, 'dedupe_key': rows[0]['dedupe_key']}]
plan = P.plan_captured(rows, held)
check('captured re-import: a held row is not added again', [r['event_key'] for r in plan] == [2], plan)
changed = P.captured_close_rows([dict(cap[0], p1=1.55, at='2026-07-12T10:01:00.000Z')])
plan2 = P.plan_captured(changed, held)
check('captured: a changed row is ADDED as a correction (supersedes = the held row), never an edit', len(plan2) == 1 and plan2[0]['supersedes'] == 7, plan2)

pg = PG()
if not pg.available():
    print(f'SKIP  database part of test-pinarch-roundtrip: {pg.why} — NOT A PASS (the code gate runs it)')
    print(f'\ntest-pinarch-roundtrip: {passed} passed, {failed} failed'); sys.exit(1 if failed else 0)
try:
    pg.roles()
    rc, err = pg.file(MIG); check('migration applies', rc == 0, err)
    body1 = json.dumps({'fixtureId': 'id1', 'bookmakers': {'pinnacle+30': {'markets': {'121': {'outcomes': {}}}}}}).encode()
    body2 = json.dumps({'fixtureId': 'id1', 'bookmakers': {'pinnacle+30': {'markets': {'121': {'outcomes': {'121': {}}}}}}}).encode()
    def ins_raw(fid, body, sup='NULL'):
        gz = gzip.compress(body)
        rc, out = pg.q(f"insert into public.oddspapi_archive_raw (fixture_id, source, object_path, pulled_at, books, payload_gz, payload_sha256, body_bytes, meta, supersedes) "
                       f"values ('{fid}', 'oddspapi-raw bucket', '2026-10/{fid}.json.gz', '2026-10-01T10:00:00Z', array['pinnacle+30'], '\\x{gz.hex()}', "
                       f"'{hashlib.sha256(body).hexdigest()}', {len(body)}, '{{\"month\": \"2026-10\"}}', {sup}) returning id")
        return int(out.splitlines()[0]) if rc == 0 else None
    r1 = ins_raw('id1', body1); r2 = ins_raw('id1', body2, r1)
    for r in P.captured_close_rows(cap, 'abc'):
        cols = [c for c in P.COLS[P.CLOSE] if c not in ('id', 'inserted_at') and r.get(c) is not None]
        rc, out = pg.q(f"insert into public.pinnacle_archive_close ({','.join(cols)}) values ({','.join(P.sql_lit(r[c], c) for c in cols)})")
        check(f'close row for event {r["event_key"]} inserted', rc == 0, out)
    pg.q("insert into public.pinnacle_archive_count (job, raw_rows, close_rows) values ('t', 2, 2)")
    def dump(table, db='postgres', after=0):
        rc, out = pg.q(f"select coalesce(json_agg(t order by id), '[]') from (select * from public.{table} where id > {after}) t", db=db)
        return json.loads(out) if rc == 0 else out
    out = tempfile.mkdtemp(prefix='pinarch-bk-')
    m1 = P.write_backup_day(out, '2026-10-14', [dump(P.RAW)[:1], dump(P.RAW)[1:]], dump(P.CLOSE), dump(P.COUNT), None)
    check('day 1 holds both raw rows in id order', m1['raw'] == {'fromId': r1, 'toId': r2, 'rows': 2, 'cumulativeRows': 2}, m1['raw'])
    try:
        P.write_backup_day(out, '2026-10-14', [], [], [], m1); replaced = True
    except FileExistsError:
        replaced = False
    check('a dated copy is never replaced (writing the same day again is refused)', not replaced)
    # founder 2026-10-16 (round 3, item 5): the daily job's same-day check — a complete day is skipped, a broken one fails
    check('day_written: a complete day reads as written (the re-run skips it)', P.day_written(os.path.join(out, P.BACKUP_DIR, '2026-10-14')))
    check('day_written: no folder = not written', not P.day_written(os.path.join(out, P.BACKUP_DIR, '2026-10-30')))
    import shutil as _sh
    _sh.copytree(os.path.join(out, P.BACKUP_DIR, '2026-10-14'), os.path.join(out, 'broken'))
    open(os.path.join(out, 'broken', m1['files'][0]['name']), 'ab').write(b'x')
    try:
        P.day_written(os.path.join(out, 'broken')); hid = True
    except RuntimeError:
        hid = False
    check('control: a day folder whose file does not match its manifest is a real failure, never a skip', not hid)
    _sh.rmtree(os.path.join(out, 'broken'))
    r3 = ins_raw('id3', body1.replace(b'id1', b'id3'))
    m2 = P.write_backup_day(out, '2026-10-15', [dump(P.RAW, after=m1['raw']['toId'])], dump(P.CLOSE), dump(P.COUNT), m1)
    check('day 2 holds only the row added since day 1', m2['raw']['rows'] == 1 and m2['raw']['fromId'] == r3 and m2['previous'] == '2026-10-14', m2['raw'])
    check('day 1 is untouched by day 2', json.load(open(os.path.join(out, P.BACKUP_DIR, '2026-10-14', 'manifest.json'))) == m1)
    days, rows_b = P.read_backups(out)
    sql = P.restore_sql(rows_b)
    pg.q('create database restored'); pg.roles('restored')
    rc, err = pg.file(MIG, db='restored'); check('migration applies to the empty restore target', rc == 0, err)
    f = os.path.join(out, 'restore.sql'); open(f, 'w').write(sql)
    rc, err = pg.file(f, db='restored'); check('restore SQL applies', rc == 0, err)
    for t in P.TABLES:
        a, b = dump(t), dump(t, 'restored')
        check(f'{t}: every row restored exactly ({len(a)} rows)', a == b and len(a) > 0, (a, b))
    rc, out2 = pg.q("select payload_gz from public.oddspapi_archive_raw where id = %d" % r2, db='restored')
    check('restored payload decompresses to the exact original body', gzip.decompress(bytes.fromhex(out2[2:])) == body2)
    rc, err = pg.file(f, db='restored'); check('restore is idempotent (a second run adds nothing)', rc == 0 and dump(P.RAW, 'restored') == dump(P.RAW), err)
    rc, out3 = pg.q("insert into public.oddspapi_archive_raw (fixture_id, source, payload_gz, payload_sha256, body_bytes) values ('n','t','\\x00','h9',1) returning id", db='restored')
    check('after a restore, new rows continue above the restored ids', rc == 0 and int(out3.splitlines()[0]) > r3, out3)
    bf = os.path.join(out, P.BACKUP_DIR, '2026-10-15', 'raw-0001.jsonl.gz')
    open(bf, 'ab').write(b'tamper')
    try:
        P.read_backups(out); stopped = False
    except ValueError:
        stopped = True
    check('a tampered backup file stops the restore (sha256 mismatch)', stopped)
finally:
    pg.close()
print(f'\ntest-pinarch-roundtrip: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
