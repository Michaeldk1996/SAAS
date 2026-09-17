#!/usr/bin/env python3
"""TEN-225 item 4 (Michael, 2026-09-17T09:11Z) — investigate the -369-minute ATP
trace before Part 4 sign-off, and before odds_card_state is filled.

    "The -369-minute ATP trace: investigate before Part 4 sign-off. If it's a
     pairing error, report how many other pairs share the same pattern, and fix
     the matcher before odds_card_state is filled."

THE ROW UNDER INVESTIGATION (doc `start-time-check`, table 1f row 4)
    ATP  Z. Svajda v D. Altmaier  2026-09-02
    api-tennis event_date+event_time  18:40 (UTC+2)  ->  16:40Z
    oddspapi  trueStartTime                              22:49:21Z
    residual                                              -369.4 min

THE DECISIVE TEST — and why it needs no new pairing logic
---------------------------------------------------------
A pairing error and a genuine late start are distinguishable from ONE field we
already hold: oddspapi's own `startTime` (its SCHEDULED time) for the very same
fixture row that supplied `trueStartTime`.

  * If oddspapi's own startTime ~= api-tennis's 16:40Z, then BOTH feeds agree on
    the scheduled time and disagree only on the actual start. The pair is right;
    the fixture genuinely started ~6h late. Nothing to fix in the matcher.
  * If oddspapi's own startTime ~= 22:45Z, the two feeds disagree about the
    SCHEDULE, which no rain delay can cause -> we matched the wrong fixture, and
    the matcher has to be fixed before odds_card_state is filled.

That comparison is internal to a single oddspapi row, so it cannot itself be
corrupted by the pairing.

SCALE — "how many other pairs share the same pattern"
-----------------------------------------------------
Two populations, reported separately because they answer different questions:

  A. oddspapi-internal (NO pairing involved, 29,496 fixtures already on disk in
     .ten225-fixture-index.json.gz): how often does oddspapi's own trueStartTime
     sit >6h from its own startTime? This is the base rate of the phenomenon. If
     it is common, a -369 residual is unremarkable and needs no matcher change.

  B. cross-feed pairs re-derived here (ATP + Challenger over the window): for
     every pair whose residual exceeds the threshold, is the residual EXPLAINED
     by oddspapi's own internal delta? A residual that the internal delta
     accounts for is a late start. A residual the internal delta does NOT
     account for is a schedule disagreement = a candidate pairing error, and
     every one of those is listed individually.

COST: 1-2 metered /v4/fixtures units (meter read before and after; standing
rule: stop at 80% of request_limit). api-tennis get_fixtures is not metered
against the oddspapi quota.
"""
import gzip
import json
import os
import statistics
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ODDSPAPI = 'https://api.oddspapi.io'
APITENNIS = 'https://api.api-tennis.com/tennis/'
SPORT_TENNIS = 12   # oddspapi sportId for tennis (sportId 2 is a 400)
QUOTA_CEILING = 0.80
INDEX = os.path.join(HERE, '.ten225-fixture-index.json.gz')
OUT = os.path.join(HERE, 'ten225-369-trace.json')

# The window that produced the 1f trace table. Kept deliberately tight: one
# /v4/fixtures slice, and api-tennis is queried one day at a time.
FROM = datetime(2026, 9, 1, tzinfo=timezone.utc)
TO = datetime(2026, 9, 7, tzinfo=timezone.utc)

# api-tennis event_time is UTC+2 (measured and re-confirmed in doc
# `start-time-check` 1b). Converting it is the ONLY use of event_time here, and
# it is used to compute a residual for diagnosis -- never as a start time.
APITENNIS_UTC_OFFSET_MIN = 120

# Residual magnitude above which a pair is examined individually.
BIG_RESIDUAL_MIN = 60.0
# How close oddspapi's internal delta must come to the cross-feed residual for
# the residual to count as "explained by a genuine late start". 10 minutes
# absorbs the ordinary few-minute scheduling difference between the two feeds.
EXPLAINED_TOL_MIN = 10.0

LEVELS = ('ATP', 'Challenger')


def read_key(name):
    p = os.path.join(HERE, '.env')
    if os.path.exists(p):
        for line in open(p):
            if line.strip().startswith(name + '='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    return os.environ.get(name)


def get_json(url, timeout=120):
    req = urllib.request.Request(url, headers={'User-Agent': 'BSP-Consult-Dashboard/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r), None
    except urllib.error.HTTPError as e:
        # The body carries oddspapi's reason for a 400. Reporting the code alone
        # turned a diagnosable window error into a guess on the first attempt.
        try:
            detail = e.read().decode('utf-8', 'replace')[:300]
        except Exception:                       # noqa: BLE001
            detail = ''
        return None, f'{e.code} {detail}'.strip()
    except Exception as e:                      # noqa: BLE001 — reported, not raised
        return None, str(e)


def oddspapi_get(path, params, key):
    p = dict(params)
    p['apiKey'] = key
    return get_json(ODDSPAPI + path + '?' + urllib.parse.urlencode(p))


def meter(key, when):
    d, err = oddspapi_get('/v4/account', {}, key)
    if d is None:
        print(f'  meter unreadable {when} ({err})')
        return None, None
    subs = [s for s in (d.get('subscriptions') or []) if s.get('is_active')]
    if not subs:
        print(f'  NO active subscription {when}')
        return None, None
    s = subs[0]
    print(f'  oddspapi meter {when}: {s.get("request_count")}/{s.get("request_limit")}')
    return s.get('request_count'), s.get('request_limit')


def parse_ts(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Name normalisation. This is the matcher under audit, so it is written out in
# full rather than imported: the point of the exercise is to be able to say
# exactly what it does.
# ---------------------------------------------------------------------------
def strip_accents(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s or '')
                   if unicodedata.category(c) != 'Mn')


def surname_of(raw):
    """Surname from either feed's format.

    oddspapi carries TWO formats in the same field -- "Surname, First" and
    "First Surname". Reading the comma format's first token as a given name is
    the bug that minted 577 false pairs on the previous sweep (doc
    `start-time-check`, method note). The comma is checked FIRST, so the comma
    format can never fall through to the space split.
    """
    s = strip_accents(str(raw or '')).strip()
    if not s:
        return ''
    if ',' in s:
        return s.split(',', 1)[0].strip().lower()
    # "D. Altmaier" / "Daniel Altmaier" / "Juan Pablo Varillas" -> last token.
    # An initial-only token ("D.") can never be the surname.
    toks = [t for t in s.replace('.', '. ').split() if t.strip()]
    toks = [t for t in toks if not (len(t) <= 2 and t.endswith('.'))]
    return toks[-1].strip().lower() if toks else ''


def pair_key(a, b):
    """Order-free key so a home/away swap between feeds still matches."""
    return tuple(sorted((a, b)))


def main():
    ok = read_key('ODDSPAPI_KEY')
    ak = read_key('API_TENNIS_KEY')
    if not ok or not ak:
        print('::error::ODDSPAPI_KEY / API_TENNIS_KEY not both available.')
        return 1

    used, limit = meter(ok, 'before')
    if used is None or not limit:
        print('::error::refusing to spend metered units without a meter read.')
        return 1
    if used + 2 > int(limit * QUOTA_CEILING):
        print(f'::error::80% ceiling {int(limit*QUOTA_CEILING)} reached ({used}/{limit}).')
        return 1

    report = {'generatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
              'meterBefore': used, 'meterLimit': limit,
              'window': [FROM.isoformat(), TO.isoformat()]}

    # -----------------------------------------------------------------------
    # A. oddspapi-INTERNAL base rate. No pairing, no network -- 29,496 fixtures
    #    already on disk from the 180-day sweep.
    # -----------------------------------------------------------------------
    print('\nA. oddspapi-internal sched-vs-true base rate (no pairing, offline)')
    idx = json.load(gzip.open(INDEX))
    internal = []
    by_level = defaultdict(list)
    for fid, f in idx['fixtures'].items():
        ts, ss = parse_ts(f.get('trueStart')), parse_ts(f.get('startSched'))
        if ts and ss:
            dmin = (ts - ss).total_seconds() / 60.0
            internal.append(dmin)
            by_level[f.get('cat') or 'unknown'].append(dmin)
    n = len(internal)
    sv = sorted(internal)
    def qq(p):
        return sv[int(p * (n - 1))]
    base = {'n': n, 'median': round(statistics.median(sv), 2),
            'p05': round(qq(.05), 2), 'p95': round(qq(.95), 2),
            'min': round(sv[0], 1), 'max': round(sv[-1], 1),
            'over': {str(t): sum(1 for v in sv if abs(v) > t) for t in (30, 60, 120, 300, 360)},
            'negative_gt_2min': sum(1 for v in sv if v < -2)}
    report['internalBaseRate'] = base
    print(f'   n={n}  median={base["median"]:+.2f}m  p05={base["p05"]:+.2f}  p95={base["p95"]:+.2f}')
    for t in (30, 60, 120, 300, 360):
        c = base['over'][str(t)]
        print(f'   |trueStart - startTime| > {t:4d} min: {c:6d}  ({100*c/n:.3f}%)')
    report['internalByLevel'] = {}
    for lvl in ('ATP', 'Challenger', 'WTA', 'ITF Men', 'ITF Women'):
        v = by_level.get(lvl) or []
        if v:
            c = sum(1 for x in v if abs(x) > 360)
            report['internalByLevel'][lvl] = {'n': len(v), 'over360': c,
                                              'pct': round(100 * c / len(v), 3)}
            print(f'   {lvl:12s} n={len(v):6d}  >360min: {c:4d} ({100*c/len(v):.3f}%)')

    # -----------------------------------------------------------------------
    # B. Fetch both feeds over the trace window and re-pair.
    # -----------------------------------------------------------------------
    print('\nB. oddspapi /v4/fixtures for the trace window')
    # Cached on disk: iterating the MATCHER must not cost a metered unit per
    # attempt. Delete the cache file to force a fresh pull.
    cache = os.path.join(HERE, '.ten225-369-fixtures.json.gz')
    units = 0
    if os.path.exists(cache):
        rows = json.load(gzip.open(cache))
        print(f'   {len(rows)} oddspapi fixtures (disk cache, 0 metered units)')
    else:
        data, err = oddspapi_get('/v4/fixtures', {
            'sportId': SPORT_TENNIS,
            'from': FROM.strftime('%Y-%m-%dT00:00:00Z'),
            'to': TO.strftime('%Y-%m-%dT00:00:00Z'),
        }, ok)
        units = 1
        if data is None:
            print(f'::error::/v4/fixtures failed ({err})')
            return 1
        rows = data if isinstance(data, list) else (data.get('data') or [])
        with gzip.open(cache, 'wt') as fh:
            json.dump(rows, fh)
    print(f'   {len(rows)} oddspapi fixtures')
    if rows:
        report['oddspapiSampleKeys'] = sorted(rows[0].keys())

    def participants(f):
        """Return (home, away) display names from whatever shape the row uses.

        The live shape is participant1Name / participant2Name, carrying the
        "Surname, First" format. The other pairs are kept as fallbacks so a
        provider-side rename shows up as an unpaired count rather than a crash.
        """
        for a, b in (('participant1Name', 'participant2Name'),
                     ('homeTeam', 'awayTeam'), ('home', 'away'),
                     ('homeName', 'awayName'), ('participant1', 'participant2')):
            h, w = f.get(a), f.get(b)
            if isinstance(h, dict):
                h = h.get('name')
            if isinstance(w, dict):
                w = w.get('name')
            if h and w:
                return str(h), str(w)
        ps = f.get('participants')
        if isinstance(ps, list) and len(ps) == 2:
            def nm(p):
                return p.get('name') if isinstance(p, dict) else str(p)
            return str(nm(ps[0])), str(nm(ps[1]))
        nm = f.get('name') or ''
        for sep in (' vs ', ' v ', ' - '):
            if sep in nm:
                a, b = nm.split(sep, 1)
                return a.strip(), b.strip()
        return '', ''

    op_by_day = defaultdict(lambda: defaultdict(list))
    op_amb = Counter()
    for f in rows:
        cat = f.get('categoryName') or ''
        if 'Simulated' in cat or 'Srl' in cat:
            continue
        if 'Doubles' in (f.get('tournamentName') or ''):
            continue
        h, w = participants(f)
        sn = pair_key(surname_of(h), surname_of(w))
        if not sn[0] or not sn[1] or sn[0] == sn[1]:
            continue
        st = parse_ts(f.get('trueStartTime') or f.get('startTime'))
        if not st:
            continue
        op_by_day[st.date().isoformat()][sn].append({
            'fixtureId': f.get('fixtureId'), 'cat': cat,
            'tourn': f.get('tournamentName'), 'home': h, 'away': w,
            'startTime': f.get('startTime'), 'trueStartTime': f.get('trueStartTime'),
        })

    print('\n   api-tennis get_fixtures, one day at a time')
    at_rows = []
    d = FROM
    while d < TO:
        u = (f'{APITENNIS}?method=get_fixtures&APIkey={urllib.parse.quote(ak)}'
             f'&date_start={d:%Y-%m-%d}&date_stop={d:%Y-%m-%d}')
        j, e = get_json(u)
        got = (j or {}).get('result') or []
        at_rows.extend(got)
        print(f'   {d:%Y-%m-%d}: {len(got)} api-tennis fixtures'
              + (f'  ERROR {e}' if e else ''))
        d += timedelta(days=1)

    # -----------------------------------------------------------------------
    # Pair, compute residuals, and classify every large one.
    # -----------------------------------------------------------------------
    paired, dropped_amb, dropped_unpaired = [], 0, 0
    target = None
    for r in at_rows:
        if str(r.get('event_type_type') or r.get('event_type') or '').lower().find('double') >= 0:
            continue
        lvl = r.get('event_type_type') or ''
        h, w = r.get('event_first_player') or '', r.get('event_second_player') or ''
        sn = pair_key(surname_of(h), surname_of(w))
        if not sn[0] or not sn[1] or sn[0] == sn[1]:
            continue
        ed, et = r.get('event_date'), r.get('event_time')
        if not ed or not et:
            continue
        try:
            local = datetime.strptime(f'{ed} {et}', '%Y-%m-%d %H:%M').replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        at_utc = local - timedelta(minutes=APITENNIS_UTC_OFFSET_MIN)
        # Look on the UTC day and its neighbours -- a 02:00 local fixture lands
        # on the previous UTC day.
        cands = []
        for off in (-1, 0, 1):
            day = (at_utc + timedelta(days=off)).date().isoformat()
            cands.extend(op_by_day.get(day, {}).get(sn, []))
        # De-duplicate: the +-1 day sweep can see the same fixture twice.
        seen, uniq = set(), []
        for c in cands:
            if c['fixtureId'] not in seen:
                seen.add(c['fixtureId'])
                uniq.append(c)
        if not uniq:
            dropped_unpaired += 1
            continue
        if len(uniq) > 1:
            dropped_amb += 1
            continue
        c = uniq[0]
        ts, ss = parse_ts(c['trueStartTime']), parse_ts(c['startTime'])
        if not ts:
            continue
        resid = (at_utc - ts).total_seconds() / 60.0
        internal_delta = ((ts - ss).total_seconds() / 60.0) if ss else None
        sched_gap = ((at_utc - ss).total_seconds() / 60.0) if ss else None
        rec = {'level': lvl, 'at_home': h, 'at_away': w,
               'op_home': c['home'], 'op_away': c['away'],
               'tourn': c['tourn'], 'cat': c['cat'], 'fixtureId': c['fixtureId'],
               'at_local': f'{ed} {et}', 'at_utc': at_utc.isoformat(),
               'op_startTime': c['startTime'], 'op_trueStartTime': c['trueStartTime'],
               'residual_min': round(resid, 1),
               'internal_delta_min': None if internal_delta is None else round(internal_delta, 1),
               'sched_gap_min': None if sched_gap is None else round(sched_gap, 1)}
        paired.append(rec)
        if {'svajda', 'altmaier'} == set(sn):
            target = rec

    tot = len(paired) + dropped_amb + dropped_unpaired
    report['pairing'] = {'apitennis_singles': tot, 'paired': len(paired),
                         'dropped_ambiguous': dropped_amb,
                         'dropped_unpaired': dropped_unpaired,
                         'pair_rate_pct': round(100 * len(paired) / tot, 2) if tot else None}
    print(f'\n   paired {len(paired)}/{tot} = '
          f'{report["pairing"]["pair_rate_pct"]}%   ambiguous {dropped_amb}   unpaired {dropped_unpaired}')

    # -----------------------------------------------------------------------
    # C. The target row.
    # -----------------------------------------------------------------------
    print('\nC. THE -369 ROW — Svajda v Altmaier')
    report['target'] = target
    if target is None:
        print('   NOT FOUND in this window under the current matcher.')
    else:
        for k in ('at_home', 'at_away', 'op_home', 'op_away', 'tourn', 'fixtureId',
                  'at_local', 'at_utc', 'op_startTime', 'op_trueStartTime',
                  'residual_min', 'internal_delta_min', 'sched_gap_min'):
            print(f'   {k:20s} {target[k]}')
        sg = target['sched_gap_min']
        if sg is None:
            verdict = 'INCONCLUSIVE — oddspapi row carries no startTime'
        elif abs(sg) <= EXPLAINED_TOL_MIN:
            verdict = ('GENUINE LATE START — both feeds agree on the SCHEDULE '
                       f'(gap {sg:+.1f} min); only the actual start differs. '
                       'The pair is correct; the matcher needs no change.')
        else:
            verdict = ('SCHEDULE DISAGREEMENT — the two feeds disagree by '
                       f'{sg:+.1f} min on the SCHEDULED time, which no delay can '
                       'cause. Candidate pairing error.')
        report['targetVerdict'] = verdict
        print(f'\n   VERDICT: {verdict}')

    # -----------------------------------------------------------------------
    # D. How many other pairs share the pattern.
    # -----------------------------------------------------------------------
    print(f'\nD. Pairs with |residual| > {BIG_RESIDUAL_MIN:.0f} min — classified')
    # Two INDEPENDENT signals, so three distinguishable causes:
    #   sched_gap      = api-tennis scheduled  - oddspapi scheduled   (cross-feed)
    #   internal_delta = oddspapi trueStart    - oddspapi scheduled   (self-only)
    # A pairing error shows up as a cross-feed schedule disagreement. An oddspapi
    # data defect shows up as self-inconsistency. They are not the same finding
    # and only one of them is ours to fix.
    big = [p for p in paired if abs(p['residual_min']) > BIG_RESIDUAL_MIN]
    buckets = defaultdict(list)
    for p in big:
        sg, idl = p['sched_gap_min'], p['internal_delta_min']
        sched_ok = sg is not None and abs(sg) <= EXPLAINED_TOL_MIN
        # trueStartTime BEFORE its own scheduled time by more than the tolerance
        # is physically impossible for a real start -- a match cannot begin
        # before it is scheduled by hours. That is an oddspapi field defect.
        self_bad = idl is not None and idl < -EXPLAINED_TOL_MIN
        if sg is None:
            p['cause'] = 'inconclusive_no_oddspapi_sched'
        elif sched_ok and self_bad:
            p['cause'] = 'oddspapi_truestart_precedes_own_schedule'
        elif sched_ok:
            p['cause'] = 'genuine_late_start'
        elif self_bad:
            p['cause'] = 'schedule_disagreement_AND_self_inconsistent'
        else:
            p['cause'] = 'schedule_disagreement'
        buckets[p['cause']].append(p)
    report['largeResiduals'] = {
        'threshold_min': BIG_RESIDUAL_MIN, 'explained_tol_min': EXPLAINED_TOL_MIN,
        'n_paired': len(paired), 'n_large': len(big),
        'byCause': {k: len(v) for k, v in buckets.items()},
        'rows': sorted(big, key=lambda x: -abs(x['residual_min'])),
    }
    print(f'   paired {len(paired)}   large {len(big)}')
    for k, v in sorted(buckets.items(), key=lambda kv: -len(kv[1])):
        print(f'     {k:48s} {len(v):4d}')
    print('\n   every large residual, with both signals:')
    for p in sorted(big, key=lambda x: -abs(x['residual_min'])):
        print(f'   {p["level"][:20]:20s} {p["at_home"][:18]:18s} v {p["at_away"][:18]:18s} '
              f'resid {p["residual_min"]:+9.1f}  schedGap {p["sched_gap_min"]:+8.1f}  '
              f'internal {p["internal_delta_min"]:+9.1f}  {p["cause"]}')

    # -----------------------------------------------------------------------
    # E. The oddspapi self-inconsistency at scale, over the whole 180-day index.
    #    No pairing involved, so this number cannot be a matcher artefact.
    # -----------------------------------------------------------------------
    print('\nE. oddspapi trueStartTime that precedes its own startTime (180d index)')
    neg = [v for v in internal if v < 0]
    scale = {'n': n}
    for t in (10, 60, 120, 360, 720, 1440):
        c = sum(1 for v in internal if v < -t)
        scale[f'earlier_than_sched_by_gt_{t}min'] = c
        print(f'   trueStart earlier than its own startTime by > {t:5d} min: '
              f'{c:6d}  ({100*c/n:.3f}%)')
    scale['any_negative'] = len(neg)
    report['selfInconsistencyAtScale'] = scale
    print(f'   any negative: {len(neg)} ({100*len(neg)/n:.2f}%) — most are the '
          f'ordinary few minutes early, which is normal')

    used2, _ = meter(ok, 'after')
    report['meterAfter'] = used2
    report['meteredUnitsThisRun'] = (used2 - used) if (used2 is not None) else None
    report['fixtureCallsMade'] = units
    json.dump(report, open(OUT, 'w'), indent=1)
    print(f'\nwrote {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
