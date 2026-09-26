"""TEN-295 (TEN-287 Wave 1, founder 2026-09-26) — the chart-only odds series.

Every multi-source odds-movement series lives in

    m.oddsMovement.chart = {
        'books': {<label>: {'p1': [[iso, price], ...], 'p2': [...]}},
        'meta':  {<label>: {'source', 'group', 'clock', 'checkedAt'}},
    }

and NEVER in m.oddsMovement.books, which the edge model reads (adjustment #17 counts
its keys, the anchor reads books.Pinnacle). put_chart() is the only writer: it touches
`chart` and nothing else on the match — not `books`, not `capturedAt` (the pipeline
reads capturedAt as "when bet365 was last looked at"), not `startTime`/`fixtureId`.

Shared by refresh-odds-history.py (Pinnacle +30s) and build-chart-books.py (Bet105,
the odds-api.io books). Stdlib only.
"""
from datetime import datetime, timezone

GROUPS = ('sharp', 'soft')
PRICE_FLOOR = 1.01            # .claude/rules/odds.md: strictly below 1.01 is not a price


def ts_iso(v):
    """Any ISO-8601 instant -> 'YYYY-MM-DDTHH:MM:SS.mmmZ' (UTC), else None.

    One format for every source, so the dashboard's grid (and any string compare)
    orders points from different books correctly."""
    if isinstance(v, datetime):
        d = v
    elif isinstance(v, str) and v:
        s = v.strip().replace(' ', 'T', 1)
        if s.endswith('Z'):
            s = s[:-1] + '+00:00'
        # fromisoformat before 3.11 wants 0, 3 or 6 fraction digits
        if '.' in s:
            head, _, tail = s.partition('.')
            frac, sign, tz = tail, '', ''
            for c in ('+', '-'):
                if c in tail:
                    frac, _, tz = tail.partition(c)
                    sign = c
                    break
            frac = (frac + '000000')[:6]
            s = f'{head}.{frac}{sign}{tz}'
        try:
            d = datetime.fromisoformat(s)
        except ValueError:
            return None
    else:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    d = d.astimezone(timezone.utc)
    return d.strftime('%Y-%m-%dT%H:%M:%S.') + f'{d.microsecond // 1000:03d}Z'


def now_iso():
    return ts_iso(datetime.now(timezone.utc))


def clean_points(points):
    """[[ts, price], ...] -> sorted, normalised, real prices only (>= 1.01), one point
    per instant. Nothing is interpolated or invented."""
    by_ts = {}
    for pt in points or []:
        if not isinstance(pt, (list, tuple)) or len(pt) < 2:
            continue
        t = ts_iso(pt[0])
        try:
            p = round(float(pt[1]), 3)
        except (TypeError, ValueError):
            continue
        if t is None or not p >= PRICE_FLOOR:
            continue
        by_ts[t] = [t, p]
    return [by_ts[k] for k in sorted(by_ts)]


def changes_only(points):
    """Keep the first point of every run of one price: a re-stamp at the same price is
    not a change (odds.md: same-price re-inserts are not changes)."""
    out = []
    for pt in points:
        if not out or out[-1][1] != pt[1]:
            out.append(pt)
    return out


def merge_side(old, new):
    """Union on instant, then changes only. Never shortens what we already hold: a
    vendor that prunes old rows (or a capped read) cannot move the start of a line."""
    return changes_only(clean_points(list(old or []) + list(new or [])))


def put_chart(m, label, series, meta):
    """Write one source's series + meta onto m.oddsMovement.chart.

    series  {'p1': [...], 'p2': [...]} in CARD orientation, or None to update meta only.
    meta    {'source', 'group', 'clock', 'checkedAt'}; checkedAt None keeps the held one.

    Returns True when the match now carries a non-empty series for `label`.
    """
    if meta.get('group') not in GROUPS:
        raise ValueError(f'chart group must be one of {GROUPS}: {meta.get("group")!r}')
    om = dict(m.get('oddsMovement') or {})
    chart = dict(om.get('chart') or {})
    books = dict(chart.get('books') or {})
    metas = dict(chart.get('meta') or {})
    held = books.get(label) or {}
    if series is not None:
        merged = {side: merge_side(held.get(side), series.get(side)) for side in ('p1', 'p2')}
        if merged['p1'] or merged['p2']:
            books[label] = merged
            held = merged
    mt = dict(metas.get(label) or {})
    checked = ts_iso(meta.get('checkedAt')) if meta.get('checkedAt') else None
    old_checked = mt.get('checkedAt')
    mt.update({k: meta[k] for k in ('source', 'group', 'clock') if meta.get(k)})
    # checkedAt only ever moves forward
    mt['checkedAt'] = max(x for x in (checked, old_checked, '') if x is not None) or None
    metas[label] = mt
    chart['books'] = books
    chart['meta'] = metas
    om['chart'] = chart
    m['oddsMovement'] = om
    return bool(held.get('p1') or held.get('p2'))


def chart_series(m, label):
    """The held chart series for one label, or {} (read helper for tests / callers)."""
    return (((m.get('oddsMovement') or {}).get('chart') or {}).get('books') or {}).get(label) or {}


def has_chart(m):
    return bool((((m.get('oddsMovement') or {}).get('chart') or {}).get('books')))
