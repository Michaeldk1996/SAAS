#!/usr/bin/env python3
"""TEN-225 — load oddspapi_line_summary (and oddspapi_fixtures) from the raw
bucket and from bet365-history/. ZERO odds-API calls.

RULINGS THIS FILE IMPLEMENTS
----------------------------
Michael, 2026-09-17T07:33Z (scope):
  "one row per fixture + book + market + side + line ... Markets: match winner,
   games handicap, total games, set betting. Levels: all. Full tick series stays
   in the raw bucket only."
Michael, 2026-09-17T07:33Z (ruling 2, close_reliable):
  "true only if the fixture was archived within 21 days of its start AND
   close_lag_minutes <= 60. Otherwise close_price = null (dash on the site).
   Open is kept."
Michael, 2026-09-17T08:07Z (gate 0ef55f38):
  key  -> UNIQUE NULLS NOT DISTINCT
  close window -> 21 days (the stated rule), NOT the <=3d reading.

WHY NO API CALLS
----------------
The raw-archive job holds the same rate-limited oddspapi key for hours. A second
client calling /v4/historical-odds loses that race (measured: 3 fixtures in 9
minutes on 429 backoff) while slowing the one job racing irreversible retention
loss. Everything here reads the bucket the archive already wrote, plus the
committed bet365-history/ files. Re-run it after any archive run and n grows.

THE PAYLOAD -> ROW MAPPING, MEASURED NOT ASSUMED
------------------------------------------------
Verified against a live /v4/historical-odds payload (fixture id1200390774640370,
2026-09-17): the leaf tick list sits at

    bookmakers[book].markets[marketId].outcomes[outcomeId].players[playerKey]

and a tick has exactly five keys: createdAt, price, limit, active, exchangeMeta.
There is no `line` field anywhere — the line is encoded in the marketId, so
`line` is recovered by joining marketId -> /v4/markets.handicap. `side` is the
outcome NAME from the same join ('1', '2', 'Over', 'Under', '2:1', ...).

ONE LEAF WITH >= 1 PRE-START TICK IS EXACTLY ONE ROW. A leaf whose only ticks
are in-play contributes NO row: this table is the Open/Close serving index and
in-play stays in the bucket. That is the same rule the sizing measurement was
taken under, so the table bills the number that cleared the gate.

Reads SUPABASE_URL / SUPABASE_SECRET_KEY (Actions only; deliberately not in the
local .env). Stdlib only. Secrets are never printed.
"""
import argparse
import collections
import gzip
import json
import os
import statistics
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BUCKET = 'oddspapi-raw'
META_PREFIX = '_meta'
INDEX = os.path.join(HERE, '.ten225-fixture-index.json.gz')
CATALOGUE = os.path.join(HERE, '.oddspapi-tennis-markets.json.gz')
HISTORY_DIR = os.path.join(HERE, 'bet365-history')
OUT = os.path.join(HERE, 'ten225-load-line-summary.json')

BOOK_HISTORY = 'bet365'
RELIABLE_DAYS = 21          # Michael's ruling 2, confirmed on gate 0ef55f38
RELIABLE_LAG_MIN = 60.0     # Michael's ruling 2
BATCH = 500
MIN_N = 30                  # standing rule: flag anything below this

# The four ruled families, by /v4/markets catalogue name. Slams sit inside
# categoryName "ATP" so they need no separate entry. Set handicap is absent
# from the keep-list because bet365 does not carry it (0 of 26 fixtures,
# measured on the item-0 markets check) — a column that can never fill.
KEEP_FAMILIES = {
    'Winner':                 'match winner',
    'Game Handicap':          'games handicap',
    'Total Games Over Under': 'total games',
    'Correct Score':          'set betting',
}
# Match winner has no line. Storing the catalogue's 0.0 handicap there would be
# a fabricated value in a KEY column, so it is explicitly NULL.
NO_LINE_FAMILIES = {'match winner', 'set betting'}


# --------------------------------------------------------------------- helpers
def creds():
    url = (os.environ.get('SUPABASE_URL') or '').rstrip('/')
    key = os.environ.get('SUPABASE_SECRET_KEY') or ''
    if not url or not key:
        print('::error::SUPABASE_URL / SUPABASE_SECRET_KEY are not both set. '
              'This script runs in Actions, where those secrets live.')
        sys.exit(1)
    return url, key


def sb(method, path, url, key, body=None, headers=None, timeout=300):
    h = {'Authorization': f'Bearer {key}', 'apikey': key}
    h.update(headers or {})
    req = urllib.request.Request(url + path, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read(), None
    except urllib.error.HTTPError as e:
        return None, (e.code, e.read()[:400].decode('utf-8', 'replace'))
    except Exception as e:                      # noqa: BLE001 — reported
        return None, (0, str(e))


def sb_list(url, key, prefix, limit=1000):
    """Storage list is PAGED. A truncated listing silently shrinks n, so pages
    are walked to exhaustion and the caller is told when one failed."""
    out, offset, ok = [], 0, True
    while True:
        body = json.dumps({'prefix': prefix, 'limit': limit, 'offset': offset,
                           'sortBy': {'column': 'name', 'order': 'asc'}}).encode()
        got, err = sb('POST', f'/storage/v1/object/list/{BUCKET}', url, key,
                      body=body, headers={'Content-Type': 'application/json'})
        if got is None:
            print(f'::warning::listing {prefix!r} offset {offset} failed ({err}).')
            return out, False
        rows = json.loads(got.decode('utf-8'))
        out.extend(rows)
        if len(rows) < limit:
            return out, ok
        offset += limit


def sb_download(url, key, path):
    got, err = sb('GET', f'/storage/v1/object/{BUCKET}/'
                  + urllib.parse.quote(path), url, key)
    if got is None:
        return None, err
    try:
        return json.loads(gzip.decompress(got).decode('utf-8')), None
    except Exception as e:                      # noqa: BLE001 — reported
        return None, (0, f'unreadable: {e}')


def fetch_flips(url, key, page=1000):
    """Read live_flip_log, paged.

    PostgREST caps a page at 1,000 rows regardless of what you ask for, and a
    previous rebuild on this codebase was silently truncated by trusting a
    single unpaged read. So the page size is pinned AT the cap and the walk
    stops only on a short page. Requesting more than 1,000 would make
    `len(rows) < page` true on the very first full page and stop at 1,000.
    """
    assert page <= 1000, 'PostgREST caps pages at 1000; a larger page truncates'
    cols = ('event_key,first_live_seen_at,last_not_live_seen_at,gap_seconds,'
            'event_date,first_player,second_player,tournament_name,'
            'event_type_type')
    out, offset = [], 0
    while True:
        got, err = sb('GET',
                      f'/rest/v1/live_flip_log?select={cols}'
                      f'&order=event_key.asc&limit={page}&offset={offset}',
                      url, key)
        if got is None:
            return out, err
        rows = json.loads(got.decode('utf-8'))
        out.extend(rows)
        if len(rows) < page:
            return out, None
        offset += page


def upsert(url, key, table, rows, conflict):
    """PostgREST upsert. merge-duplicates + on_conflict makes a re-run
    idempotent, which matters because this job is meant to be re-run after
    every archive tick."""
    sent = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        q = urllib.parse.urlencode({'on_conflict': conflict})
        got, err = sb('POST', f'/rest/v1/{table}?{q}', url, key,
                      body=json.dumps(chunk).encode(),
                      headers={'Content-Type': 'application/json',
                               'Prefer': 'resolution=merge-duplicates,return=minimal'})
        if got is None:
            print(f'::error::upsert into {table} failed at row {i} ({err})')
            return sent, err
        sent += len(chunk)
    return sent, None


CORRECTION_KEY = ('fixture_id', 'book', 'market', 'side', 'line')


def _row_key(r):
    """The upsert's own conflict target, as a comparable tuple.

    Built from CORRECTION_KEY rather than retyped at each use, so this and the
    `on_conflict=` string cannot drift into keying different things — which
    would silently pair each incoming row against the WRONG stored row and
    report corrections that never happened.
    """
    return tuple(r.get(f) for f in CORRECTION_KEY)


def _same_price(a, b):
    """Two close prices, compared the way the column stores them.

    PostgREST hands numerics back as JSON numbers, and a price that went in as
    1.69 can come back through a different parse. A bare == on floats would
    report a correction on a row nobody touched, so the tolerance is explicit
    rather than inherited.
    """
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    try:
        return abs(float(a) - float(b)) < 1e-9
    except (TypeError, ValueError):
        return str(a) == str(b)


def _same_ts(a, b):
    """Two close timestamps, compared as INSTANTS, not as text.

    ⚠️ THE REASON THIS IS NOT `a == b`. We write `iso()` — "…T12:00:00Z" — and
    PostgREST returns timestamptz as "…T12:00:00+00:00". Same instant, different
    string. A textual compare would report EVERY matched row as a corrected
    close on every run, and the counter would read as a catastrophe on a
    database nothing had changed. Both sides go through the loader's own
    epoch(), which is the same normaliser the rest of this file trusts.
    """
    ea, eb = epoch(a), epoch(b)
    if ea is None and eb is None:
        # ⚠️ BOTH UNPARSEABLE IS NOT BOTH ABSENT. epoch() returns None for a
        # genuinely null timestamp AND for a format it cannot read, so a
        # timestamptz format change that defeats it on both sides would make
        # every row read "unchanged" and print the same 0 a healthy run prints.
        # Both genuinely ABSENT is unchanged; both UNPARSEABLE falls back to the
        # text, exactly as _same_price does. `None` and `''` are both absent —
        # epoch() already treats them the same, so this must too.
        a_absent, b_absent = a is None or a == '', b is None or b == ''
        if a_absent and b_absent:
            return True
        if a_absent != b_absent:
            return False
        return str(a) == str(b)
    if ea is None or eb is None:
        return False
    return abs(ea - eb) < 1.0


def sb_json(path, url, key):
    """`sb()` plus the decode `sb()` does not do. Returns (list|None, err).

    ⚠️ `sb()` RETURNS RAW BYTES, NOT PARSED JSON — `return r.read(), None`.
    Every other reader in this file decodes for itself (`fetch_flips` does
    `json.loads(got.decode('utf-8'))`). The first cut of `fetch_existing` did
    not, and tested `isinstance(got, list)` on a `bytes`: always False, so the
    stored rows silently became `{}` and the correction counter printed
    "0 of 0" on every real run while its own suite passed, because the suite
    injected an already-parsed list through `_get`. A shim that returns a shape
    production never produces certifies nothing. Parsing lives here, once, and
    the test now drives the real `sb()` through a stubbed `urlopen`.

    A body that is not a JSON list is an error, not an empty result — the two
    look identical downstream and mean opposite things.
    """
    got, err = sb('GET', path, url, key)
    if got is None:
        return None, err
    try:
        parsed = json.loads(got.decode('utf-8') if isinstance(got, bytes) else got)
    except (ValueError, UnicodeDecodeError) as e:
        return None, (0, f'unparseable PostgREST body: {e}')
    if not isinstance(parsed, list):
        return None, (0, f'expected a JSON list, got {type(parsed).__name__}')
    return parsed, None


def fetch_existing(url, key, rows, chunk=200, page=1000, _get=None):
    """The stored rows this run is about to overwrite, keyed by conflict target.

    Fetched by fixture_id in chunks: a PostgREST `in.(...)` carrying every id at
    once builds a URL long enough to be refused, and the refusal arrives as a
    400 that reads like a schema problem. Paged as well, because PostgREST caps
    a response at 1,000 rows and truncates SILENTLY — a truncated read here
    would report every unseen row as brand new and the correction count as zero.
    """
    get = _get or (lambda path: sb_json(path, url, key))
    fids = sorted({r.get('fixture_id') for r in rows if r.get('fixture_id') is not None})
    out = {}
    cols = ','.join(CORRECTION_KEY + ('close_price', 'close_ts', 'start_ts_source'))
    for i in range(0, len(fids), chunk):
        ids = ','.join(str(f) for f in fids[i:i + chunk])
        offset = 0
        while True:
            q = urllib.parse.urlencode({
                'select': cols, 'fixture_id': f'in.({ids})',
                # ⚠️ ORDER IS LOAD-BEARING ON A PAGED READ. limit/offset without
                # an ORDER BY is not a stable window in PostgreSQL: page 2 may
                # repeat rows from page 1 and omit others, and an omitted row is
                # counted NEW — corrections under-reported with no error. One
                # 200-fixture chunk is fixtures x books x markets x sides, which
                # clears 1,000 rows easily, so this is the ordinary path, not the
                # edge. `fetch_flips` already orders for the same reason.
                'order': 'fixture_id.asc,book.asc,market.asc,side.asc,line.asc',
                'limit': page, 'offset': offset})
            got, err = get(f'/rest/v1/oddspapi_line_summary?{q}')
            if got is None:
                # Reported, never swallowed. A failed read must not masquerade
                # as "no rows existed", which would print zero corrections and
                # look exactly like a clean run.
                return None, err
            for r in got:
                out[_row_key(r)] = r
            if len(got) < page:
                break
            offset += page
    return out, None


def count_close_corrections(existing, rows):
    """How many closes this run is about to CHANGE, split by start-source change.

    Founder, TEN-253 part E: "read the existing rows before the upsert and count
    close_price/close_ts changes, split by whether the start source changed."

    WHY THE SPLIT IS THE POINT. A close moving because the START moved is the
    Close rule working — close = last price before the ACTUAL start, so a better
    start estimate legitimately re-picks the close tick. A close moving while
    the start source stayed put is a different animal: same start, different
    answer, meaning either a tick arrived that should have been there before, or
    the selection changed under us. Counted together they are one number that
    cannot answer either question.

    Rows with no stored counterpart are NEW, not corrections, and are counted
    separately so the correction rate has an honest denominator.
    """
    out = {'incoming': len(rows), 'new': 0, 'matched': 0, 'unchanged': 0,
           'corrected': 0, 'corrected_start_source_changed': 0,
           'corrected_start_source_same': 0,
           'price_changed': 0, 'ts_changed': 0,
           'close_appeared': 0, 'close_disappeared': 0, 'examples': []}
    for r in rows:
        prev = existing.get(_row_key(r))
        if prev is None:
            out['new'] += 1
            continue
        out['matched'] += 1
        p_same = _same_price(prev.get('close_price'), r.get('close_price'))
        t_same = _same_ts(prev.get('close_ts'), r.get('close_ts'))
        if p_same and t_same:
            out['unchanged'] += 1
            continue
        out['corrected'] += 1
        if not p_same:
            out['price_changed'] += 1
        if not t_same:
            out['ts_changed'] += 1
        # A close arriving where there was none, and a close being withdrawn,
        # are both corrections but they are not the same event — one is the rule
        # finding an answer, the other is the rule taking one away.
        if prev.get('close_price') is None and r.get('close_price') is not None:
            out['close_appeared'] += 1
        elif prev.get('close_price') is not None and r.get('close_price') is None:
            out['close_disappeared'] += 1
        if prev.get('start_ts_source') != r.get('start_ts_source'):
            out['corrected_start_source_changed'] += 1
        else:
            out['corrected_start_source_same'] += 1
        if len(out['examples']) < 5:
            out['examples'].append({
                'key': list(_row_key(r)),
                'close_price': [prev.get('close_price'), r.get('close_price')],
                'close_ts': [prev.get('close_ts'), r.get('close_ts')],
                'start_ts_source': [prev.get('start_ts_source'), r.get('start_ts_source')],
            })
    return out


def print_close_corrections(c, min_n=None):
    """Every count with its denominator, and n<30 flagged. Returns the lines."""
    min_n = MIN_N if min_n is None else min_n
    if c is None:
        return ['close corrections: — (the pre-upsert read FAILED; '
                'NOT reported as zero)']
    m = c['matched']
    flag = f'  <-- n<{min_n}' if m < min_n else ''
    pc = (lambda n: '—' if not m else f'{100.0 * n / m:.1f}%')
    return [
        f"close corrections: {c['corrected']} of {m} row(s) this run also holds "
        f"({pc(c['corrected'])}){flag}; {c['new']} row(s) are NEW and not "
        f"corrections; {c['incoming']} incoming",
        f"  split by start source: {c['corrected_start_source_changed']} where the "
        f"start source CHANGED, {c['corrected_start_source_same']} where it did NOT "
        f"(denominator {c['corrected']})",
        f"  what moved: price {c['price_changed']}, ts {c['ts_changed']}, "
        f"close appeared {c['close_appeared']}, close withdrawn "
        f"{c['close_disappeared']} (denominator {c['corrected']})",
    ]


def epoch(ts):
    if ts is None or ts == '':
        return None
    if isinstance(ts, (int, float)):
        return float(ts)
    try:
        return datetime.fromisoformat(str(ts).replace('Z', '+00:00')).timestamp()
    except (ValueError, TypeError):
        return None


def iso(ep):
    if ep is None:
        return None
    return datetime.fromtimestamp(ep, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def load_catalogue():
    if not os.path.exists(CATALOGUE):
        return None
    with gzip.open(CATALOGUE, 'rt', encoding='utf-8') as fh:
        return json.load(fh)


# ------------------------------------------------------------------- the rules
GATE_SECONDS = 6 * 3600.0     # Michael's ruling 2026-09-17T10:02Z, option (a)
CONFLICT_MIN = 5.0            # ruling item 2
FLIP_GAP_MAX_S = 300.0        # ruling item 3, restated from 09:11Z

# Michael's ruling 2026-09-17T10:45Z item 3 — the ITF corroboration rule.
# ITF fixtures carry no trueEndTime, so the sanity gate can only ever run its
# WEAK limb there (trueStart-vs-startTime). From this date on, an ITF Close
# cutoff has to be corroborated by the live flip or it does not exist.
# Dated, not retroactive: the live-flip recorder only started 2026-09-17, so
# before that date there is no flip to corroborate against and applying the rule
# backwards would dash every historical ITF close for a reason that is about our
# instrumentation, not about the data.
ITF_RULE_FROM = datetime(2026, 9, 17, tzinfo=timezone.utc).timestamp()
ITF_LEVELS = ('ITF Men', 'ITF Women')


def itf_protected(level, true_start, sched):
    """Is this fixture inside the ITF corroboration rule's scope?

    Dated off the fixture's SCHEDULED time where there is one, because that is
    the one timestamp on an ITF fixture that is always present and is never
    itself under suspicion — it decides scope, never a cutoff.
    """
    if (level or '') not in ITF_LEVELS:
        return False
    ref = sched if sched is not None else true_start
    return ref is not None and ref >= ITF_RULE_FROM


def resolve_start(true_start, true_end, sched, flip_ts, flip_gap, level=None):
    """Michael's trueStartTime ruling (2026-09-17T10:02Z), in one place.

    Returns (start_ts, start_ts_source, reject_reason, conflict, conflict_min,
             flip_gap_used).

    RULING ITEM 1 — the sanity gate, option (a):
      reject trueStartTime when trueEndTime - trueStartTime > 6 h; when
      trueEndTime is missing, reject when trueStartTime is more than 6 h before
      startTime. Rejected -> fall through to the live-flip lower bound
      (last_not_live_seen_at); if none, Close = dash. Open is kept.

    Measured basis (TEN-225 item 4): the duration test catches 34/1,037 = 3.279%
    and is a STRICT SUPERSET of the early-start test at this threshold, which is
    why the early-start limb is only reached when trueEndTime is absent — there
    it is the only signal left, not a second opinion.

    TWO reason strings, not the one Michael named. He wrote
    start_reject_reason = 'implausible_duration'; limb 2 is not a duration test
    (it never sees an end time), so folding it under that label would make the
    per-level reject report unreadable and would misdescribe the row. Both are
    reported separately and the total is what he asked for. Flagged, not slipped.

    RULING ITEM 2 — the cross-check:
      when trueStartTime and last_not_live_seen_at disagree by more than 5 min,
      use the EARLIER of the two and flag the row. An earlier cutoff can only
      miss pre-start ticks, never include in-play ticks — so the failure mode is
      a Close that is slightly stale, never a Close that is secretly in-play.

    Note the asymmetry that makes this safe: the gate runs FIRST. A rejected
    trueStartTime never reaches the cross-check, so a garbage timestamp hours in
    the past can never win the min() and drag the cutoff with it.

    RULING 2026-09-17T10:45Z item 1 — trueEnd BEFORE trueStart:
      its own reject, reason 'end_before_start', same fall-through. It is a
      third string, not a widening of 'implausible_duration', because a negative
      duration is not an implausible match length — it is a feed contradiction,
      and folding the two together would hide which one the archive is producing.

    RULING 2026-09-17T10:45Z item 3 — ITF corroboration (see itf_protected):
      an in-scope ITF fixture's cutoff must AGREE with the live flip. trueStart
      missing, or more than 5 min from the flip -> use the flip bound; no flip at
      all -> no cutoff, Close = dash.

      Note this limb can move the cutoff LATER than trueStart, which the generic
      cross-check never does. That is safe here and only here, because
      last_not_live_seen_at is a timestamp at which the match was OBSERVED not
      live: every tick at or before it is pre-start by construction, whatever
      trueStartTime claims. The generic path has no such observation behind it,
      which is why it keeps the earlier-of-the-two rule.
    """
    reason = None
    ts = true_start

    if ts is not None:
        if true_end is not None:
            if true_end < ts:
                reason = 'end_before_start'
            elif (true_end - ts) > GATE_SECONDS:
                reason = 'implausible_duration'
        elif sched is not None:
            if (sched - ts) > GATE_SECONDS:
                reason = 'implausible_early_start'
        if reason is not None:
            ts = None

    if itf_protected(level, true_start, sched):
        if flip_ts is None:
            return None, 'none', reason or 'itf_uncorroborated_start', False, None, None
        if ts is None:
            return (flip_ts, 'api-tennis-live', reason or 'itf_uncorroborated_start',
                    False, None, flip_gap)
        diff_min = (ts - flip_ts) / 60.0
        if abs(diff_min) > CONFLICT_MIN:
            return (flip_ts, 'api-tennis-live', reason, True,
                    round(diff_min, 3), flip_gap)
        return ts, 'oddspapi', reason, False, None, None

    # Rejected, or never present: the live-flip lower bound, else dash.
    if ts is None:
        if flip_ts is not None:
            return flip_ts, 'api-tennis-live', reason, False, None, flip_gap
        return None, 'none', reason, False, None, None

    # Both exist -> cross-check.
    if flip_ts is not None:
        diff_min = (ts - flip_ts) / 60.0
        if abs(diff_min) > CONFLICT_MIN:
            if flip_ts < ts:
                return (flip_ts, 'api-tennis-live', reason, True,
                        round(diff_min, 3), flip_gap)
            return ts, 'oddspapi', reason, True, round(diff_min, 3), None

    return ts, 'oddspapi', reason, False, None, None


# TEN-225 ruling D (founder, 2026-09-18). Kept character-for-character identical
# to ten225_names.py: test-ten225-kibl-card-state.py asserts L.name_key(x) ==
# name_key(x) over a trap corpus, so a fix applied to one copy and not the other
# turns that assertion red rather than drifting quietly. See that module for the
# full reasoning — in short, a hyphen is not `isalpha`, so 'Auger-Aliassime' and
# "O'Connell" keyed to None and were unpairable in every direction.
_SEPS = str.maketrans({c: ' ' for c in "-‐‑‒–—―'‘’ʼ"})


def nfd(s):
    """Standing rule: NFD accent strip before any cross-feed name comparison."""
    s = unicodedata.normalize('NFD', s or '')
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return ' '.join(s.lower().replace(',', ' ').replace('.', ' ')
                    .translate(_SEPS).split())


def name_key(name):
    """A surname key that survives the two feeds' different orderings.

    The two feeds write the same player two different ways:
      oddspapi    'Zverev, Alexander'      — surname FIRST, comma-delimited
      api-tennis  'A. Zverev' / 'Alexander Zverev' — surname LAST
    so the rule is: take the part before the comma if there is one, else the
    whole string, and key on its LAST alphabetic token.

    "Last token of the surname part", not "the whole surname part", because
    api-tennis's player_full_name is known to reorder multi-part surnames:
    'Van de Zandschulp, Botic' and 'B. Van De Zandschulp' both reduce to
    'zandschulp', while the full surname strings do not match.

    NOT the longest token — that was the first draft and the harness caught it:
    'Zverev, Alexander' has 'alexander' as its longest token and 'A. Zverev' has
    'zverev', so every full-vs-initial pair silently failed to match.
    """
    s = nfd(name.split(',')[0] if ',' in (name or '') else name)
    toks = [t for t in s.split() if len(t) > 1 and t.isalpha()]
    return toks[-1] if toks else None


def pair_flips(fx_index, flip_rows):
    """live_flip_log rows -> {oddspapi fixtureId: (flip_ts, gap_seconds)}.

    Standing rule: DROP ON AMBIGUITY. The key is (date, frozenset of both
    players' name keys). If two fixtures or two flips collapse onto one key,
    neither is paired — an unpaired match dashes, it never guesses.

    The date comes from the oddspapi side's scheduled day. Using the scheduled
    DAY to bucket candidates is not using the scheduled TIME as a start: it
    narrows who to compare, and the timestamp that survives is api-tennis's
    observed flip. Matches near UTC midnight are handled by also trying the
    neighbouring day.
    """
    by_key, ambiguous = {}, set()
    for fid, m in fx_index.items():
        k1, k2 = name_key(m.get('p1')), name_key(m.get('p2'))
        day = (m.get('trueStart') or m.get('startSched') or '')[:10]
        if not (k1 and k2 and day) or k1 == k2:
            continue
        key = (day, frozenset((k1, k2)))
        if key in by_key:
            ambiguous.add(key)
        by_key[key] = fid

    out, st = {}, collections.Counter()
    seen_fid = {}
    for r in flip_rows:
        k1, k2 = name_key(r.get('first_player')), name_key(r.get('second_player'))
        lnl = epoch(r.get('last_not_live_seen_at'))
        if not (k1 and k2) or k1 == k2 or lnl is None:
            st['flip_unusable'] += 1
            continue
        day = (r.get('event_date') or '')[:10]
        cand = None
        for d in (day, _shift_day(day, -1), _shift_day(day, 1)):
            key = (d, frozenset((k1, k2)))
            if key in ambiguous:
                st['dropped_ambiguous'] += 1
                cand = None
                break
            if key in by_key:
                cand = by_key[key]
                break
        if cand is None:
            st['flip_unpaired'] += 1
            continue
        if cand in seen_fid:
            # Two different flips claiming one fixture is the same ambiguity
            # seen from the other side. Drop both rather than keep the first.
            out.pop(cand, None)
            st['dropped_ambiguous'] += 1
            continue
        seen_fid[cand] = True
        gap = r.get('gap_seconds')
        out[cand] = (lnl, None if gap is None else float(gap))
        st['paired'] += 1
    return out, st


def _shift_day(day, delta):
    if not day:
        return ''
    try:
        d = datetime.strptime(day, '%Y-%m-%d').replace(tzinfo=timezone.utc)
    except ValueError:
        return ''
    return (d + timedelta(days=delta)).strftime('%Y-%m-%d')


def start_for(fid, meta, flips):
    """Index meta + the paired flip -> resolve_start()'s 6-tuple.

    NOTE it reads trueStart/trueEnd/startSched as three separate fields and
    never `meta['start']` — that collapsed field can be the scheduled time.

    `cat` is passed through because the ITF corroboration rule is level-scoped.
    A fixture the index does not cover has no level, so it is not ITF-protected
    — it already dashes its Close for the stronger reason that it has no start
    fields at all.
    """
    flip_ts, flip_gap = (flips or {}).get(fid, (None, None))
    return resolve_start(epoch((meta or {}).get('trueStart')),
                         epoch((meta or {}).get('trueEnd')),
                         epoch((meta or {}).get('startSched')),
                         flip_ts, flip_gap, (meta or {}).get('cat'))


def judge_close(start_ts, close_ts, archived_at, start_src='oddspapi',
                flip_gap=None):
    """Michael's ruling 2, in one place so the loader and the tests share it.

    Returns (close_reliable, close_lag_minutes).

    RULING 2026-09-17T10:02Z item 3: a Close cut at the live-flip lower bound
    carries that bound's own uncertainty, so it needs gap_seconds <= 300 ON TOP
    OF the 21-day/60-minute test. A 40-minute gap means the match may have been
    live for 40 minutes before we saw it, and the "last pre-start tick" could
    then be an in-play price — the exact thing Close must never be. A missing
    gap is not a pass: we cannot show it is <= 300, so it is false.

    close_lag_minutes is returned whenever it is computable, EVEN when the close
    is judged unreliable — it is the diagnostic Part 4 item 4 reports on, and
    ruling 4 keeps the 21-day window open to retuning, which needs the lag to
    have survived. Nulling the close is the caller's job.

    A fixture archived BEFORE its start is not "archived within 21 days of its
    start" in any useful sense: its series is still open, so whatever sits at
    the end of it is not a close. That is false, not reliable.
    """
    if start_ts is None or close_ts is None:
        return False, None
    lag_min = (start_ts - close_ts) / 60.0
    if archived_at is None:
        return False, lag_min
    age_days = (archived_at - start_ts) / 86400.0
    reliable = (0.0 <= age_days <= RELIABLE_DAYS) and (lag_min <= RELIABLE_LAG_MIN)
    if reliable and start_src == 'api-tennis-live':
        reliable = flip_gap is not None and flip_gap <= FLIP_GAP_MAX_S
    return reliable, lag_min


def summarise_payload(payload, fixture_id, start, archived_at, catalogue):
    """One raw /v4/historical-odds payload -> summary rows at the ruled grain.

    `start` is the 6-tuple resolve_start() returns. It is resolved ONCE per
    fixture by the caller rather than per leaf: every leaf of one fixture shares
    one start, and re-deriving it per leaf is how a fixture ends up with two
    different start_ts_source values on two of its own rows.

    Returns (rows, stats). Rows are dicts ready for PostgREST.
    """
    start_ts, start_src, reason, conflict, conflict_min, flip_gap = start
    rows = []
    st = collections.Counter()
    for book, blk in ((payload or {}).get('bookmakers') or {}).items():
        if not isinstance(blk, dict):
            continue
        for mid, m in (blk.get('markets') or {}).items():
            if not isinstance(m, dict):
                continue
            meta = catalogue.get(str(mid))
            if meta is None:
                st['market_not_in_catalogue'] += 1
                continue
            fam = KEEP_FAMILIES.get(meta.get('name'))
            if fam is None:
                st['out_of_keeplist'] += 1
                continue
            line = None if fam in NO_LINE_FAMILIES else meta.get('handicap')
            outcomes = meta.get('outcomes') or {}
            for oid, oc in (m.get('outcomes') or {}).items():
                name = outcomes.get(str(oid))
                if name is None:
                    # Storing the raw id as a side label would put a number
                    # where a '1'/'Over' belongs and quietly split the grain.
                    st['outcome_not_in_catalogue'] += 1
                    continue
                for pkey, plist in ((oc or {}).get('players') or {}).items():
                    ticks = []
                    for p in (plist or []):
                        t = epoch(p.get('createdAt'))
                        if t is None or p.get('price') is None:
                            st['tick_unusable'] += 1
                            continue
                        lim = p.get('limit')
                        try:
                            lim = None if lim is None else float(lim)
                        except (TypeError, ValueError):
                            lim = None
                        ticks.append((t, float(p['price']), lim))
                    if not ticks:
                        continue
                    ticks.sort()
                    side = name if str(pkey) == '0' else f'{name}#{pkey}'

                    pre = [t for t in ticks if start_ts is None or t[0] <= start_ts]
                    if start_ts is not None and not pre:
                        st['inplay_only_leaf'] += 1
                        continue

                    open_ts, open_price, open_limit = ticks[0]
                    if start_ts is None:
                        # Never substitute the scheduled time — Michael's locked
                        # definition forbids it. Open is still exact (the first
                        # recorded tick is the first recorded tick); the close
                        # is simply not derivable until a start is known.
                        st['no_start_open_only'] += 1
                        rows.append(_row(
                            fixture_id, book, fam, side, line,
                            open_price, open_ts, None, None, None,
                            None, ticks[0][0], None, None, 'none',
                            'oddspapi-raw', archived_at, False,
                            reject_reason=reason, last_tick=ticks[-1][:2],
                            open_limit=open_limit))
                        continue

                    close_ts, close_price = pre[-1][0], pre[-1][1]
                    reliable, lag = judge_close(start_ts, close_ts, archived_at,
                                                start_src, flip_gap)
                    rows.append(_row(
                        fixture_id, book, fam, side, line,
                        open_price, open_ts,
                        close_price if reliable else None,
                        close_ts if reliable else None,
                        lag, len(pre), ticks[0][0], close_ts,
                        start_ts, start_src, 'oddspapi-raw', archived_at, reliable,
                        reject_reason=reason, conflict=conflict,
                        conflict_min=conflict_min, flip_gap=flip_gap,
                        last_tick=ticks[-1][:2], open_limit=open_limit))
                    st['reliable_close' if reliable else 'close_nulled'] += 1
    return rows, st


def _row(fixture_id, book, market, side, line, open_price, open_ts,
         close_price, close_ts, lag, pre_count, first_ts, last_pre_ts,
         start_ts, start_src, source, archived_at, reliable,
         reject_reason=None, conflict=False, conflict_min=None, flip_gap=None,
         last_tick=None, open_limit=None):
    # PART 2's "Now" source. `last_tick` is (ts, price) of the freshest tick we
    # actually observed for this series, or None. Stored as a FACT, with a
    # separate flag saying whether it is pre-start — odds_card_state is what
    # decides whether a given fact is allowed to be rendered as "Now". See the
    # schema note: a finished fixture's last tick is a settled price, not a Now.
    lt_ts, lt_price, lt_pre = None, None, None
    if last_tick is not None:
        lt_ts, lt_price = last_tick
        lt_pre = None if start_ts is None else bool(lt_ts <= start_ts)
    return {
        'last_tick_price': lt_price, 'last_tick_ts': iso(lt_ts),
        'last_tick_is_prestart': lt_pre,
        # Michael's locked Open definition: "first recorded Oddspapi tick for
        # fixture + book + side (createdAt), with timestamp AND STAKE LIMIT".
        # The tick carries `limit` and this loader was discarding it, so
        # odds_card_state.open_limit could only ever have been NULL. The
        # bet365-history months have no limit field at all, so that path is
        # honestly None rather than zero.
        'open_limit': open_limit,
        'fixture_id': fixture_id, 'book': book, 'market': market,
        'side': side, 'line': line,
        'open_price': open_price, 'open_ts': iso(open_ts),
        'close_price': close_price, 'close_ts': iso(close_ts),
        'close_lag_minutes': None if lag is None else round(lag, 3),
        'pre_start_tick_count': pre_count,
        'first_tick_ts': iso(first_ts),
        'last_pre_start_tick_ts': iso(last_pre_ts),
        'start_ts': iso(start_ts), 'start_ts_source': start_src,
        'start_reject_reason': reject_reason,
        'start_conflict': conflict,
        'conflict_minutes': conflict_min,
        'flip_gap_seconds': flip_gap,
        'source': source, 'archived_at': iso(archived_at),
        'close_reliable': reliable,
    }


def summarise_history(month_path, catalogue, fx_index, flips):
    """bet365-history/YYYY-MM.json -> summary rows.

    This archive is match winner ONLY (`market: 121`) and its s1/s2 series are
    pre-start by construction. `generatedAt` on the file is the capture time, so
    it is the archived_at that ruling 2's 21-day window is measured from — which
    is exactly why the Mar-May months fail it: they were generated 2026-09-10..12,
    four to six months after the fixtures they cover.

    THE START NO LONGER COMES FROM THE FILE. archive-bet365-history.py collapses
    `trueStartTime or startTime` into one `start` field (its fixture_start()), so
    the month files bake in the SCHEDULED time whenever trueStartTime is absent —
    466 of 12,995 joinable fixtures, 3.59%, measured 2026-09-17. Michael's locked
    definition forbids the scheduled time as a start ("Never use the scheduled
    time"), and the collapsed field also loses WHICH one it was, so a row could
    not even be audited after the fact.

    So this path now resolves the start from the 180-day index exactly like the
    bucket path: trueStart / trueEnd / startSched as three separate fields
    through resolve_start(). Fixtures the index does not cover keep Open and dash
    the Close rather than fall back to the file's collapsed value.
    """
    d = json.load(open(month_path))
    gen = epoch(d.get('generatedAt'))
    rows, st = [], collections.Counter()
    sides = {'s1': '1', 's2': '2'}
    for fid, f in (d.get('fixtures') or {}).items():
        meta = fx_index.get(fid) or {}
        if not meta:
            st['not_in_180d_index'] += 1
        start = start_for(fid, meta, flips)
        start_ts, start_src, reason, conflict, conflict_min, flip_gap = start
        for skey, side in sides.items():
            series = sorted((t, p) for t, p in (f.get(skey) or [])
                            if t is not None and p is not None)
            if not series:
                st['empty_series'] += 1
                continue
            open_ts, open_price = series[0]
            if start_ts is None:
                st['no_start'] += 1
                rows.append(_row(fid, BOOK_HISTORY, 'match winner', side, None,
                                 open_price, open_ts, None, None, None,
                                 None, open_ts, None, None, 'none',
                                 'bet365-history', gen, False,
                                 reject_reason=reason, last_tick=series[-1]))
                continue
            # The series is pre-start BY THE OLD START. Under a corrected or
            # earlier start it may not be, so re-cut it here instead of trusting
            # series[-1] — that is precisely the in-play-price-as-Close trap.
            pre = [x for x in series if x[0] <= start_ts]
            if not pre:
                st['no_pre_start_tick'] += 1
                rows.append(_row(fid, BOOK_HISTORY, 'match winner', side, None,
                                 open_price, open_ts, None, None, None,
                                 0, open_ts, None, start_ts, start_src,
                                 'bet365-history', gen, False,
                                 reject_reason=reason, conflict=conflict,
                                 conflict_min=conflict_min, flip_gap=flip_gap,
                                 last_tick=series[-1]))
                continue
            close_ts, close_price = pre[-1]
            reliable, lag = judge_close(start_ts, close_ts, gen,
                                        start_src, flip_gap)
            rows.append(_row(fid, BOOK_HISTORY, 'match winner', side, None,
                             open_price, open_ts,
                             close_price if reliable else None,
                             close_ts if reliable else None,
                             lag, len(pre), open_ts, close_ts,
                             start_ts, start_src, 'bet365-history', gen,
                             reliable, reject_reason=reason, conflict=conflict,
                             conflict_min=conflict_min, flip_gap=flip_gap,
                             last_tick=series[-1]))
            st['reliable_close' if reliable else 'close_nulled'] += 1
    return rows, st, gen


# ---------------------------------------------------------------------- driver
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--history', action='store_true',
                    help='load bet365-history/ (match winner, Mar-Sep 2026)')
    ap.add_argument('--bucket', action='store_true',
                    help='load the oddspapi-raw bucket (all four families)')
    ap.add_argument('--fixtures', action='store_true',
                    help='load oddspapi_fixtures from the 180d sweep index')
    ap.add_argument('--dry-run', action='store_true',
                    help='summarise and report, write nothing')
    ap.add_argument('--limit', type=int, default=0,
                    help='cap bucket objects processed (0 = all)')
    a = ap.parse_args()
    if not (a.history or a.bucket or a.fixtures):
        a.history = a.bucket = a.fixtures = True

    catalogue = load_catalogue()
    if catalogue is None:
        print(f'::error::{os.path.basename(CATALOGUE)} missing — the payload '
              f'carries only market ids, so neither the keep-list nor `line` '
              f'can be resolved.')
        return 1
    print(f'tennis markets catalogue: {len(catalogue)} ids (0 metered units)')

    url, key = ('', '')
    if not a.dry_run:
        url, key = creds()

    result = {
        'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'grain': 'fixture+book+market+side+line, >=1 pre-start tick',
        'closeRule': {'days': RELIABLE_DAYS, 'lagMinutes': RELIABLE_LAG_MIN,
                      'ruledBy': 'Michael 2026-09-17T08:07Z gate 0ef55f38'},
        'dryRun': a.dry_run,
    }

    # ------------------------------------------------------------- fixtures
    if a.fixtures:
        if not os.path.exists(INDEX):
            print(f'::error::{os.path.basename(INDEX)} missing — run '
                  f'ten225-fixture-index.py first.')
            return 1
        with gzip.open(INDEX, 'rt', encoding='utf-8') as fh:
            idx = json.load(fh)
        frows = []
        for fid, m in idx['fixtures'].items():
            frows.append({
                'fixture_id': fid,
                'category_name': m.get('cat'),
                'tournament_name': m.get('tourn'),
                'scheduled_start': m.get('startSched'),
                'true_start': m.get('trueStart'),
                # The DDL has carried player1/player2 since day one and NOTHING
                # ever wrote them. Measured 2026-09-18 on run 35291839986: all
                # 49,287 rows unkeyable, so the Kibl<->oddspapi pairing found 0
                # matches and every Kibl Close dashed — on a green run, because
                # "no pair" and "no names to pair with" produce the same output.
                # The names are in the committed index already (they are what the
                # live-flip pairing uses); they were simply never projected.
                'player1': m.get('p1'),
                'player2': m.get('p2'),
                'updated_at': result['generatedAt'],
            })
        no_true = sum(1 for r in frows if not r['true_start'])
        print(f'\noddspapi_fixtures: {len(frows)} fixtures from the '
              f'{idx["spanDays"]}d sweep; {no_true} ({no_true/max(len(frows),1):.2%}) '
              f'have NO trueStartTime')
        result['fixtures'] = {'rows': len(frows), 'noTrueStart': no_true,
                              'spanDays': idx['spanDays'],
                              'sliceErrors': idx.get('sliceErrors', 0)}
        if not a.dry_run:
            sent, err = upsert(url, key, 'oddspapi_fixtures', frows, 'fixture_id')
            print(f'  upserted {sent}/{len(frows)}' + (f' — FAILED {err}' if err else ''))
            result['fixtures']['upserted'] = sent
            if err:
                return 1

    all_rows = []

    # ------------------------------------ the start resolver's two inputs, once
    # Both load paths resolve the start the SAME way (Michael's ruling
    # 2026-09-17T10:02Z), so the index and the paired flips are built once here
    # rather than per path. Building them per path is how the two paths drift.
    fx_index = {}
    if os.path.exists(INDEX):
        with gzip.open(INDEX, 'rt', encoding='utf-8') as fh:
            fx_index = json.load(fh)['fixtures']
    have_end = sum(1 for m in fx_index.values() if m.get('trueEnd'))
    have_names = sum(1 for m in fx_index.values() if m.get('p1') and m.get('p2'))
    print(f'\n180d index: {len(fx_index)} fixtures; {have_end} with trueEnd, '
          f'{have_names} with both player names')
    if fx_index and not have_end:
        print('::warning::the index carries NO trueEnd — the sanity gate falls '
              'back to the early-start limb alone, which misses 70.6% of the '
              'impossible rows. Re-run ten225-fixture-index.py.')

    flips, flip_st = {}, collections.Counter()
    if a.dry_run:
        print('flips: SKIPPED in --dry-run (live_flip_log needs the Supabase '
              'key) — no api-tennis-live fallback in this run.')
    else:
        flip_rows, ferr = fetch_flips(url, key)
        if ferr:
            print(f'::warning::live_flip_log unreadable ({ferr}) — the '
                  f'api-tennis-live fallback is NOT applied in this run.')
        else:
            flips, flip_st = pair_flips(fx_index, flip_rows)
            print(f'live_flip_log: {len(flip_rows)} flips, '
                  f'{flip_st["paired"]} paired to an oddspapi fixture '
                  f'({flip_st["paired"]/max(len(flip_rows),1):.1%}); '
                  f'{flip_st["flip_unpaired"]} unpaired, '
                  f'{flip_st["dropped_ambiguous"]} dropped ambiguous, '
                  f'{flip_st["flip_unusable"]} unusable')
            if len(flip_rows) < MIN_N:
                print(f'::warning::n={len(flip_rows)} flips is below {MIN_N} — '
                      f'the recorder started 2026-09-17; treat every '
                      f'flip-derived rate as provisional.')
    result['flips'] = {'rows': len(flips), 'stats': dict(flip_st)}

    # --------------------------------------------------------- bet365-history
    # Loaded BEFORE the bucket on purpose. Where a fixture is in both, the raw
    # payload is strictly richer (verified 12 -> 17 ticks on a paired fixture),
    # so the bucket pass must be the one that lands last and wins the upsert.
    if a.history:
        hist_rows, hst, gens = [], collections.Counter(), {}
        months = sorted(f for f in os.listdir(HISTORY_DIR)
                        if f.endswith('.json') and f != 'index.json')
        print(f'\nbet365-history: {len(months)} months {months}')
        for mf in months:
            r, s, gen = summarise_history(os.path.join(HISTORY_DIR, mf),
                                          catalogue, fx_index, flips)
            rel = sum(1 for x in r if x['close_reliable'])
            print(f'  {mf}: {len(r):5d} rows, generated {iso(gen)}, '
                  f'{rel} reliable close ({rel/max(len(r),1):.1%})')
            gens[mf] = {'rows': len(r), 'generatedAt': iso(gen), 'reliable': rel}
            hist_rows.extend(r)
            hst.update(s)
        print(f'  total {len(hist_rows)} rows; {dict(hst)}')
        result['history'] = {'rows': len(hist_rows), 'perMonth': gens,
                             'stats': dict(hst)}
        all_rows.extend(hist_rows)

    # ---------------------------------------------------------------- bucket
    if a.bucket:
        if a.dry_run:
            print('\nbucket: SKIPPED in --dry-run (it needs the Supabase key).')
        else:
            if not fx_index:
                print('::error::fixture index missing; it supplies the start times.')
                return 1
            months, ok = sb_list(url, key, '')
            objects = []
            for m in months:
                name = m.get('name')
                if not name or name == META_PREFIX:
                    continue
                rows_, ok2 = sb_list(url, key, f'{name}/')
                ok = ok and ok2
                for r in rows_:
                    n = r.get('name') or ''
                    if n.endswith('.json.gz'):
                        objects.append((f'{name}/{n}', n[:-len('.json.gz')],
                                        r.get('created_at')))
            if a.limit:
                objects = objects[:a.limit]
            print(f'\nbucket {BUCKET}: {len(objects)} objects '
                  f'(listing complete: {ok})')
            if not ok:
                print('::warning::bucket listing INCOMPLETE — counts are a '
                      'LOWER bound.')

            brows, bst = [], collections.Counter()
            unindexed = unreadable = norow = 0
            for path, fid, created in objects:
                payload, err = sb_download(url, key, path)
                if payload is None:
                    unreadable += 1
                    continue
                meta = fx_index.get(fid) or {}
                if not meta:
                    unindexed += 1
                r, s = summarise_payload(payload, fid,
                                         start_for(fid, meta, flips),
                                         epoch(created), catalogue)
                bst.update(s)
                if not r:
                    norow += 1
                brows.extend(r)
            rel = sum(1 for x in brows if x['close_reliable'])
            print(f'  {len(brows)} rows from {len(objects)} objects; '
                  f'{unindexed} not in the 180d index, {unreadable} unreadable, '
                  f'{norow} with no keep-list pre-start series')
            print(f'  {rel} reliable close ({rel/max(len(brows),1):.1%}); {dict(bst)}')
            fam = collections.Counter(x['market'] for x in brows)
            for k, v in fam.most_common():
                print(f'    {k:<16} {v:>7} rows')
            result['bucket'] = {
                'objects': len(objects), 'listingComplete': ok,
                'rows': len(brows), 'unindexed': unindexed,
                'unreadable': unreadable, 'noKeeplistSeries': norow,
                'reliableClose': rel, 'byFamily': dict(fam), 'stats': dict(bst)}
            all_rows.extend(brows)

    # ------------------------------------- the ruling's own reporting asks
    # "Report how many fixtures were rejected per level" (item 1) and, for the
    # 48h report, the (trueStartTime - last_not_live_seen_at) distribution with
    # counts beyond 5 min in each direction (item 2). Reported at FIXTURE grain,
    # not row grain: a fixture with 8 side-rows is one rejected start, and
    # quoting 8 would inflate every rate by the market count.
    if all_rows:
        by_fix = {}
        for x in all_rows:
            by_fix.setdefault(x['fixture_id'], x)
        lvl_rej = collections.defaultdict(collections.Counter)
        for fid, x in by_fix.items():
            lvl = (fx_index.get(fid) or {}).get('cat') or 'not in 180d index'
            lvl_rej[lvl]['fixtures'] += 1
            if x['start_reject_reason']:
                lvl_rej[lvl][x['start_reject_reason']] += 1
                lvl_rej[lvl]['rejected'] += 1
                lvl_rej[lvl]['rescued_by_flip' if x['start_ts_source'] ==
                             'api-tennis-live' else 'fell_to_dash'] += 1
        tot_rej = sum(c['rejected'] for c in lvl_rej.values())
        print(f'\ntrueStartTime sanity gate (Michael 2026-09-17T10:02Z, option a)'
              f' — {tot_rej} of {len(by_fix)} fixtures rejected '
              f'({tot_rej/max(len(by_fix),1):.3%})')
        print(f'  {"level":<22} {"fixtures":>8} {"rejected":>8} {"duration":>9} '
              f'{"early":>6} {"end<st":>7} {"itf":>5} {"->flip":>7} {"->dash":>7}')
        for lvl, c in sorted(lvl_rej.items(), key=lambda kv: -kv[1]['rejected']):
            flag = '  <-- n<%d' % MIN_N if c['fixtures'] < MIN_N else ''
            print(f'  {lvl:<22} {c["fixtures"]:>8} {c["rejected"]:>8} '
                  f'{c["implausible_duration"]:>9} '
                  f'{c["implausible_early_start"]:>6} '
                  f'{c["end_before_start"]:>7} '
                  f'{c["itf_uncorroborated_start"]:>5} '
                  f'{c["rescued_by_flip"]:>7} {c["fell_to_dash"]:>7}{flag}')
        result['gate'] = {'fixtures': len(by_fix), 'rejected': tot_rej,
                          'byLevel': {k: dict(v) for k, v in lvl_rej.items()}}

        # Ruling 2026-09-17T10:45Z item 3 asks for ITF "separately in the 48h
        # cross-check report" — ITF is the level the corroboration rule now
        # governs, so a pooled figure would hide exactly the population he
        # asked to watch. Reported as three lines: all, ITF, non-ITF.
        def _cut(pred):
            fids = [fid for fid in by_fix if pred(fid)]
            m = [by_fix[fid]['conflict_minutes'] for fid in fids
                 if by_fix[fid]['conflict_minutes'] is not None]
            b = sum(1 for fid in fids if fid in flips
                    and (fx_index.get(fid) or {}).get('trueStart'))
            return fids, m, b

        def _is_itf(fid):
            return ((fx_index.get(fid) or {}).get('cat') or '') in ITF_LEVELS

        print('\ncross-check (ruling item 2; ITF split per ruling 10:45Z item 3)')
        cross = {}
        for name, pred in (('all', lambda f: True),
                           ('ITF', _is_itf),
                           ('non-ITF', lambda f: not _is_itf(f))):
            fids, confl, both = _cut(pred)
            line = (f'  {name:<8} {len(fids):>6} fixtures, {both:>5} with BOTH '
                    f'trueStartTime and a live-flip bound; beyond +-5 min: '
                    f'{len(confl)}')
            if confl:
                early = sum(1 for m in confl if m < 0)
                line += (f' (oddspapi earlier {early}, flip earlier '
                         f'{len(confl)-early}); median '
                         f'{statistics.median(confl):+.1f} min, '
                         f'min {min(confl):+.1f}, max {max(confl):+.1f}')
                if len(confl) < MIN_N:
                    line += f'  <-- n<{MIN_N}'
            elif not both:
                line += ' — no fixture has both sources yet'
            print(line)
            cross[name] = {'fixtures': len(fids), 'bothSources': both,
                           'flagged': len(confl), 'minutes': confl[:200]}
        itf_unc = sum(1 for fid in by_fix if _is_itf(fid)
                      and by_fix[fid]['start_reject_reason']
                      == 'itf_uncorroborated_start')
        print(f'  ITF dashed for want of corroboration: {itf_unc}')
        cross['ITF']['uncorroborated'] = itf_unc
        # Back-compatible key so anything already reading crossCheck.* keeps
        # working; the split lives under .byLevel.
        result['crossCheck'] = dict(cross['all'], byLevel=cross)

    # ----------------------------------------------------------------- write
    print(f'\ntotal summary rows: {len(all_rows)}')
    if all_rows:
        lags = [x['close_lag_minutes'] for x in all_rows
                if x['close_lag_minutes'] is not None]
        if lags:
            flag = f'  <-- n<{MIN_N}' if len(lags) < MIN_N else ''
            print(f'close lag (all rows with a computable lag, n={len(lags)}): '
                  f'median {statistics.median(lags):.1f} min, '
                  f'min {min(lags):.1f}, max {max(lags):.1f}{flag}')
            result['closeLag'] = {'n': len(lags),
                                  'medianMinutes': statistics.median(lags),
                                  'minMinutes': min(lags), 'maxMinutes': max(lags)}
    # ── TEN-253 part E — the Close-correction counter ───────────────────────
    # READ BEFORE THE UPSERT, because after it the previous value is gone: this
    # is a merge-duplicates upsert, so the row it overwrites leaves no trace and
    # the question "did this run change a close that was already published?"
    # becomes permanently unanswerable one statement later.
    #
    # Printed on EVERY run, dry or not. On a dry run the upsert is skipped but
    # the count is still the honest answer to "what would this have changed",
    # which is the one number that makes a dry run worth doing.
    corrections = None
    if all_rows:
        existing, err = fetch_existing(url, key, all_rows)
        if existing is None:
            print(f'::warning::pre-upsert read failed ({err}) — close corrections '
                  f'are UNMEASURED for this run, not zero')
        else:
            corrections = count_close_corrections(existing, all_rows)
    else:
        # EVERY run, as ruled — including one that produced no rows at all.
        # Silence here is indistinguishable from a run that never reached this
        # code, and a run with nothing to upsert is itself worth seeing.
        print('close corrections: — (this run produced NO rows to upsert, so there '
              'was nothing to compare; not a clean run, an empty one)')
    if all_rows:
        for line in print_close_corrections(corrections):
            print(line)
    result['closeCorrections'] = corrections

    if not a.dry_run and all_rows:
        sent, err = upsert(url, key, 'oddspapi_line_summary', all_rows,
                           ','.join(CORRECTION_KEY))
        print(f'upserted {sent}/{len(all_rows)} summary rows'
              + (f' — FAILED {err}' if err else ''))
        result['upserted'] = sent
        if err:
            result['error'] = str(err)
            json.dump(result, open(OUT, 'w'), indent=1)
            return 1

    json.dump(result, open(OUT, 'w'), indent=1)
    print(f'wrote {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
