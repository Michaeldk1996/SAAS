#!/usr/bin/env python3
"""Founder ruling 2026-10-17 item 3: the "close" label (any wording) is reserved for a price cut at a VERIFIED start — our
live-flip, or the earlier-of rule from 17 Sep. This test fails if any other source is labelled a close.

1. Every kind of Pinnacle-archive row goes through the one export (`pinarch.export_rows`, the only path to the Database
   join, the closes shards and the private export): every row it exports carries a verified start; a start-alone close, a
   captured close of 12 Jul - 16 Sep, a captured close with no live-flip proof and a row with no start source never leave.
2. Every snapshot (Pinnacle (approx.), both sources) is named "not a confirmed close" in every hover the code carries, and
   none of them reads "close ·" / "closing" — the page, the builder, the writer.
3. The Database feed carries a close code (3 / 4) only for the export's rows (td-feed reads the export, nothing else).
Each part has a control that must go red."""
import os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import pinarch as P
passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    if ok: passed += 1; print('  PASS ', name)
    else: failed += 1; print('  FAIL ', name, '\n       ', str(detail)[-300:])

# ── 1. the export ──
def row(i, label, date, start_source, **k):
    return dict({'id': i, 'event_key': 9000 + i, 'label': label, 'match_date': date, 'start_source': start_source, 'p1_key': 1, 'p2_key': 2,
                 'p1': 1.5, 'p2': 2.6, 'source': 's', 'book': 'b', 'dedupe_key': f'k{i}', 'supersedes': None}, **k)
H = P.ARCHIVE_LABEL
rows = [row(1, H, '2026-09-20', P.CUT_SOURCE),                 # live-flip: a close
        row(2, H, '2026-09-21', P.TRUE_START_SOURCE),          # earlier-of from 17 Sep: a close
        row(3, H, '2026-04-20', P.NO_FLIP_SOURCE),             # start alone: never
        row(4, 'captured', '2026-07-20', 'oddspapi'),          # 12 Jul - 16 Sep captured: never
        row(5, 'captured', '2026-09-16', 'api-tennis-live'),   # the window's last day: never
        row(6, 'captured', '2026-09-18', 'api-tennis-live'),   # live-flip from 17 Sep: a close
        row(7, 'captured', '2026-09-19', 'oddspapi'),          # trueStart with no live-flip proof: never
        row(8, 'captured', '2026-09-22', None),                # no start source on record: never
        row(9, H, '2026-09-23', None)]                         # an archive row with no start source: never
ex = {r['eventKey'] - 9000: r for r in P.export_rows(rows)}
check('only the verified-start rows are exported as closes (1 live-flip, 2 earlier-of, 6 captured at our live-flip)', sorted(ex) == [1, 2, 6], sorted(ex))
check('every exported close carries a verified start source',
      all(r['startSource'] in (P.CUT_SOURCE, P.TRUE_START_SOURCE, *P.CAPTURED_VERIFIED_SOURCES) for r in ex.values()), ex)
check('each held-back row names its rule', [P.held_back_reason(r) for r in rows] ==
      [None, None, 'start-alone', 'captured-before-live-flip', 'captured-before-live-flip', None, 'unverified-start', 'unverified-start', 'unverified-start'],
      [P.held_back_reason(r) for r in rows])
check('a held-back row is still an archive row (the export never removes it from the table): every rule carries its note',
      all(P.HELD_BACK_RULES.get(P.held_back_reason(r)) for r in rows if P.held_back(r)))
# control: an export that skipped the verification would have labelled the unverified rows closes
orig = P.held_back
P.held_back = lambda r: False
try:
    leak = sorted(r['eventKey'] - 9000 for r in P.export_rows(rows))
finally:
    P.held_back = orig
check('control: without the verified-start rule every row WOULD be exported as a close', leak == list(range(1, 10)), leak)

# ── 2. every snapshot hover says "not a confirmed close" and never "close ·" / "closing" ──
def consts(path, names):
    src = open(os.path.join(ROOT, path), encoding='utf8').read(); out = {}
    for n in names:
        m = re.search(rf"\b{n}\s*=\s*(['\"])(.+?)\1", src)
        out[n] = m.group(2) if m else None
    return out
hovers = {**consts('bsp-consult-dashboard.html', ['SF_APPROX_HOVER', 'SF_OD10_HOVER']),
          **consts('build-database-yield.js', ['APPROX_HOVER', 'APPROX_HOVER_OD10']),
          **consts('tools/tdarch.py', ['START10_HOVER', 'APPROX_HOVER'])}
def snapshot_ok(t): return bool(t) and 'not a confirmed close' in t and not re.search(r'\bclose ·|\bclosing\b|\bclose price', t, re.I)
check('every snapshot hover in the code is found', all(hovers.values()), hovers)
check('every snapshot hover says "not a confirmed close" and never names itself a close', all(snapshot_ok(t) for t in hovers.values()), hovers)
check('control: a hover that called a snapshot a "Pinnacle close" fails the rule', not snapshot_ok('Pinnacle close · start − 10'))
html = open(os.path.join(ROOT, 'bsp-consult-dashboard.html'), encoding='utf8').read()
m = re.search(r"function fhSrcTitle\(r\)\{ return r && r\.book === 'A' \? `\$\{FH_BOOK\.A\} · \$\{r\.src === 'od10' \? SF_OD10_HOVER : SF_APPROX_HOVER\}`", html)
check('the shared source title gives a snapshot (book A) its snapshot hover before the "… close ·" branch', bool(m))
check('no snapshot label reads "Pinnacle (approx.) close" anywhere in the shipped code', not any(
    re.search(r'Pinnacle \(approx\.\)\s*close', open(os.path.join(ROOT, f), encoding='utf8').read())
    for f in ('bsp-consult-dashboard.html', 'series.js', 'player-profile-v2.js', 'build-database-yield.js', 'tools/tdarch.py')))

# ── 3. the Database feed's close codes come from the export only ──
src = open(os.path.join(HERE, 'pinarch.py'), encoding='utf8').read()
tdf = src[src.index('def cmd_td_feed'):]; tdf = tdf[:tdf.index('\ndef ', 10)]
check('td-feed reads the export file it is handed (pinnacle-closes.json in pipeline.yml), never the archive table', 'json.load(open(export_path))' in tdf and 'select_all(' not in tdf and 'td-feed pinnacle-closes.json' in open(os.path.join(ROOT, '.github/workflows/pipeline.yml')).read(), tdf[:400])
print(f'\ntest-close-label: {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
