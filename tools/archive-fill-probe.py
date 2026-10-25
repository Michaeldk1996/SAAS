#!/usr/bin/env python3
"""Archive fill probe + fill (round 2, item 1.4) — the plan run is READ-ONLY; only an approved write run inserts.

What the permanent Pinnacle archive (oddspapi_archive_raw) could yield for ATP MAIN-DRAW matches of 13 Apr - 16 Sep 2026,
against what the site has today (pinnacle_archive_close, as tools/pinarch.py `export` would export it). Writes NOTHING to
any database: candidate close rows and their diff against the protected close archive go into the output files only,
for Michael to approve.

Reused, never re-implemented (tools/pinarch.py, tools/tdarch.py, ten225-load-line-summary.py):
  population   Tennis-Data odds-archive/2026.csv rows in the window, walkovers out (the denominator, n per month)
  joins        tdarch.approx_join (Tennis-Data row -> ONE api-tennis ATP-singles fixture) and tdarch.od_fixture_of
               (api-tennis fixture -> ONE Oddspapi fixture: board map, else the committed fixture index + back-fill raw
               meta, both surnames, ±36 h); a fixture two rows claim is no one's (the start10 rule)
  start        pinarch.effective_cut: the ladder Oddspapi trueStartTime (after resolve_start's gate: end < start or
               end - start > 6 h, or no end and > 6 h before the schedule -> rejected) -> our live-flip lower bound
               (live_flip_log.last_not_live_seen_at) -> dash. Never the scheduled time.
  close        pinarch.close_at: per side the last ACTIVE pinnacle+30 entry >= 1.01 at or before the start; both sides
               or no close (a one-sided close is a dash on both sides)
  row          pinarch.archive_close_row (the exact row derive-held would insert) + pinarch.plan_archive_closes (diff)
  site today   pinarch.export_rows over the held close rows (held-back rows never export) — what pinnacle-closes.json
               carries for these events after the pipeline's export step
New here (pure, tested in tools/test-archive-fill-probe.py): the read-only request guard, first_captured, close_reliable
(close_lag <= 60 min, plus flip gap <= 300 s when the start is the live-flip bound), and the per-month summary.

READ-ONLY ENFORCEMENT (install_guard): every PostgREST call of the reused modules goes through check_request, which
refuses anything but `GET /rest/v1/<allow-listed table>?select=…` with no body and no write Prefer — so INSERT (POST),
RPC (POST /rpc/…), PATCH, PUT and DELETE never leave the process; pinarch.insert / record_count / guard_state are
replaced by refusers. Server side, PostgREST executes every GET in a READ ONLY transaction (its documented access mode
for GET/HEAD), so even a GET cannot write; and the archive tables' own triggers refuse UPDATE / DELETE / TRUNCATE.
There is no direct SQL connection in this repo's secrets (only the PostgREST URL + key), so `SET TRANSACTION READ ONLY`
cannot be issued by us; PostgREST issues it for GET.

FILL (founder ruling 2026-10-25): the plan run also MEASURES d = Oddspapi trueStart (gated) - our live-flip over every
live_flip_log match from 17 Sep (measure()), applies fill_rule (n < 50 stop; later in <= 2% and never > 2 min -> cut at
trueStart; else at trueStart - X min, X = ceil(p98 lateness)), and builds the fill rows (fill_row: start_source
pinarch.FILL_START_SOURCE, detail.closeCut + bufferMin, which pinarch.held_back exempts) with a digest of the plan. Only a
run with --write true AND --plan-digest equal to the recomputed digest inserts — exactly the plan's rows, INSERT … ON
CONFLICT DO NOTHING through pinarch.insert, after a fresh read proves none collides (write_preflight); the write guard
(check_write_request) lets nothing else out.

Usage: python3 tools/archive-fill-probe.py --out DIR [--from 2026-04-13] [--to 2026-09-16] [--measure-to YYYY-MM-DD]
                                         [--write true --plan-digest HEX]
Env: SUPABASE_URL, SUPABASE_SECRET_KEY, API_TENNIS_KEY (Actions only)."""
import argparse, collections, csv, datetime as dt, gzip, hashlib, importlib.util, json, math, os, re, sys, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
_s = importlib.util.spec_from_file_location('tdarch', os.path.join(HERE, 'tdarch.py'))
T = importlib.util.module_from_spec(_s); _s.loader.exec_module(T)
P = T.P                                                   # the ONE pinarch instance tdarch uses: guarded below

FROM, TO = '2026-04-13', '2026-09-16'                     # inclusive (Tennis-Data dates), the brief's window
FIRST_CAPTURE_LATE_H = 6                                  # flag: first captured < 6 h before the start
RELIABLE_LAG_S = 60 * 60                                  # odds.md: close_lag <= 60 min
FLIP_GAP_MAX_S = 300                                      # odds.md: flip gap <= 300 s (a live-flip cut only)
SMALL_N = 30                                              # CLAUDE.md rule 13: flag n < 30

# ── the read-only guard ─────────────────────────────────────────────────────────────────────────────────────────────
READ_TABLES = frozenset({'oddspapi_archive_raw', 'pinnacle_archive_close', 'live_flip_log'})
FORBIDDEN_PARAMS = frozenset({'on_conflict', 'columns'})
ALLOWED_PREFER = frozenset({'count=exact'})


class ReadOnlyRefused(RuntimeError):
    pass


def check_request(method, path, body=None, headers=None):
    """Raise ReadOnlyRefused unless the request is a plain PostgREST read of an allow-listed table."""
    if method != 'GET':
        raise ReadOnlyRefused(f'refused: {method} (this probe sends GET only)')
    if body is not None:
        raise ReadOnlyRefused('refused: a request body (a read carries none)')
    m = re.fullmatch(r'/rest/v1/([a-z_]+)\?(.+)', path or '')
    if not m:
        raise ReadOnlyRefused(f'refused: {str(path).split("?")[0]} is not a table read (rpc, storage and other paths are not allowed)')
    table, query = m.group(1), m.group(2)
    if table not in READ_TABLES:
        raise ReadOnlyRefused(f'refused: table {table} is not on the read allow-list')
    keys = [k for k, _ in urllib.parse.parse_qsl(query, keep_blank_values=True)]
    if 'select' not in keys:
        raise ReadOnlyRefused('refused: a read must name its select')
    bad = FORBIDDEN_PARAMS.intersection(keys)
    if bad:
        raise ReadOnlyRefused(f'refused: write parameter {sorted(bad)}')
    for k, v in (headers or {}).items():
        if k.lower() == 'prefer':
            parts = {p.strip() for p in str(v).split(',') if p.strip()}
            if not parts <= ALLOWED_PREFER:
                raise ReadOnlyRefused(f'refused: Prefer {sorted(parts - ALLOWED_PREFER)}')
        elif k.lower() not in ('accept', 'range', 'range-unit'):
            raise ReadOnlyRefused(f'refused: header {k}')
    return True


def _refuse(name):
    def f(*a, **k):
        raise ReadOnlyRefused(f'refused: {name} is a write path; this probe never writes')
    return f


def install_guard(mod):
    """Route `mod.rest` through check_request and disable its write helpers. Re-wraps whenever `rest` is not the guarded
    one (a re-assigned transport is never left bare). pinarch's own insert / record_count are kept aside in `_inner`
    for the approved write run only (enable_plan_writes). Returns the module (guarded)."""
    if getattr(mod, '_guarded', None) is not None and mod.rest is mod._guarded:
        return mod
    if not hasattr(mod, '_inner'):
        mod._inner = {'insert': getattr(mod, 'insert', None), 'record_count': getattr(mod, 'record_count', None)}
    inner = mod.rest
    mod._inner['rest'] = inner
    def guarded(method, path, body=None, headers=None, timeout=180, raw=False):
        check_request(method, path, body, headers)
        return inner(method, path, body=body, headers=headers, timeout=timeout, raw=raw)
    mod.rest = guarded
    mod._guarded = guarded
    for name in ('insert', 'record_count', 'guard_state'):
        if hasattr(mod, name):
            setattr(mod, name, _refuse(name))
    return mod


# ── pure logic ──────────────────────────────────────────────────────────────────────────────────────────────────────
def first_captured(series, start):
    """Per side, the EARLIEST active pinnacle+30 entry with a real price (>= 1.01) at or before the start: the first
    captured price (never called an opening line — it is the first price our archive holds, not the book's first post).
    Both sides required. No start -> (None, reason): an entry with no known start cannot be shown to be pre-match.
    Returns ({'121': (price, ts), '122': (price, ts), 'pairTs': iso, 'hoursBeforeStart': h, 'late': bool}, None)."""
    if start is None:
        return None, 'no start (trueStart missing or rejected, no live-flip)'
    out = {}
    for oc in ('121', '122'):
        pre = [p for p in series.get(oc) or [] if P.iso_ms(p['createdAt']) <= start and p.get('active') and P._price(p) is not None]
        if not pre:
            return None, f'no active entry before the start on outcome {oc}'
        out[oc] = (P._price(pre[0]), pre[0]['createdAt'])
    pair = max(P.iso_ms(out['121'][1]), P.iso_ms(out['122'][1]))
    h = (start - pair).total_seconds() / 3600
    out.update(pairTs=pair.isoformat(), hoursBeforeStart=round(h, 3), late=h < FIRST_CAPTURE_LATE_H)
    return out, None


def close_reliable(start, close_ts, cut_source, flip_gap_s):
    """odds.md "Close rules": close_lag <= 60 min, and — when the start is the live-flip lower bound — a flip gap
    <= 300 s (a missing gap is not a pass). Returns (reliable, lag_s)."""
    if start is None or close_ts is None:
        return False, None
    lag = (start - close_ts).total_seconds()
    ok = 0 <= lag <= RELIABLE_LAG_S
    if ok and cut_source == P.CUT_SOURCE:
        ok = flip_gap_s is not None and float(flip_gap_s) <= FLIP_GAP_MAX_S
    return ok, lag


_LLS = []


def _lls():
    if not _LLS:
        _LLS.append(P._load('lls', 'ten225-load-line-summary.py'))
    return _LLS[0]


def evaluate(td, f, winner_is_first, fid, first_is_p1, fx, flip, raw, series, rule=None):
    """One ATP main-draw match -> its probe record (+ the candidate close row, or None). `td` the Tennis-Data row, `f`
    the api-tennis fixture, `fx` the held Oddspapi fixture (trueStartTime / trueEndTime / startTime), `flip` its
    live_flip_log row or None, `raw` the newest pinnacle+30 raw row ({id, pulled_at}) or None, `series` mw_series.
    `rule` (fill_rule's output): when it says trueStart / trueStart-buffer and the start is the gated trueStart alone, the
    fill row too. Returns (record, close row at the start or None, fill row or None)."""
    ts, te, sc = P.iso_ms(fx.get('trueStartTime')), P.iso_ms(fx.get('trueEndTime')), P.iso_ms(fx.get('startTime'))
    lower = P.iso_ms((flip or {}).get('last_not_live_seen_at'))
    cut, src, reject = P.effective_cut(lower, ts, te, sc)
    rec = {'date': td['date'], 'month': td['date'][:7], 'tournament': td.get('tournament'), 'round': td.get('round'),
           'winner': td['winner'], 'loser': td['loser'], 'eventKey': str(f['event_key']), 'fixtureId': fid,
           'start': cut.isoformat() if cut else None, 'startSource': src, 'trueStartReject': reject,
           'liveFlip': bool(flip), 'hasPayload': raw is not None, 'rawId': (raw or {}).get('id')}
    if raw is None:
        rec['why'] = 'no pinnacle+30 payload held'
        return rec, None, None
    fc, why = first_captured(series, cut)
    if fc:
        w, l = ('121', '122') if bool(winner_is_first) == bool(first_is_p1) else ('122', '121')
        rec['firstCaptured'] = {'winner': fc[w][0], 'loser': fc[l][0], 'winnerTs': fc[w][1], 'loserTs': fc[l][1],
                                'pairTs': fc['pairTs'], 'hoursBeforeStart': fc['hoursBeforeStart'], 'late': fc['late']}
    else:
        rec['firstCapturedWhy'] = why
    ev = {'event_key': str(f['event_key']), 'date': f.get('event_date'), 'p1IsParticipant1': first_is_p1, 'cut': cut, 'cutSource': src,
          'liveFlipCut': lower, 'trueStartReject': reject, 'firstLive': (flip or {}).get('first_live_seen_at'),
          'lastNotLive': (flip or {}).get('last_not_live_seen_at'), 'trueStart': ts, 'trueEnd': te, 'scheduled': sc,
          'p1Name': f.get('event_first_player'), 'p2Name': f.get('event_second_player'),
          'p1Key': int(f['first_player_key']) if str(f.get('first_player_key') or '').isdigit() else None,
          'p2Key': int(f['second_player_key']) if str(f.get('second_player_key') or '').isdigit() else None,
          'api': {x: f.get(x) for x in P.API_FIELDS if f.get(x) is not None}}
    if cut is None:
        rec['why'] = f'no start: {reject}'
        return rec, None, None
    row, why = P.archive_close_row(ev, raw['id'], fid, series)
    if row is None:
        rec['why'] = why
        return rec, None, None
    rel, lag = close_reliable(cut, P.iso_ms(row['close_ts']), src, (flip or {}).get('gap_seconds'))
    win_is_p1 = bool(winner_is_first)
    rec['close'] = {'winner': row['p1'] if win_is_p1 else row['p2'], 'loser': row['p2'] if win_is_p1 else row['p1'],
                    'closeTs': row['close_ts'], 'lagS': lag, 'reliable': rel}
    # the full ruled judge (ten225-load-line-summary.judge_close) adds the 21-day archive-age limb: reported beside
    L = _lls()
    e = lambda d: d.timestamp() if d else None
    rec['close']['reliableWith21DayLimb'] = L.judge_close(e(cut), e(P.iso_ms(row['close_ts'])), e(P.iso_ms(raw.get('pulled_at'))),
                                                          'api-tennis-live' if src == P.CUT_SOURCE else 'oddspapi',
                                                          (flip or {}).get('gap_seconds'))[0]
    row['detail']['probe'] = {'closeReliable': rel, 'closeLagS': lag, 'heldBackIfWritten': P.held_back_reason(row)}
    fill = None
    if rule and rule.get('decision') in P.FILL_CUTS:
        if src != P.NO_FLIP_SOURCE:
            rec['fill'] = {'why': 'start is not the gated trueStart alone (a live-flip row exists: the derive job owns it)'}
        else:
            fill, fwhy = fill_row(ev, raw['id'], fid, series, rule)
            if fill is None:
                rec['fill'] = {'why': fwhy}
            else:
                rec['fill'] = {'winner': fill['p1'] if win_is_p1 else fill['p2'], 'loser': fill['p2'] if win_is_p1 else fill['p1'],
                               'closeTs': fill['close_ts'], 'closeCut': fill['detail']['closeCut'], 'bufferMin': fill['detail'].get('bufferMin'),
                               'lagS': fill['gap_to_start_s']}
    return rec, row, fill


def fill_row(ev, raw_id, fid, series, rule):
    """The fill-rule close (founder ruling 2026-10-25) for one event whose start is the gated trueStart alone: the last
    active pinnacle+30 pair (>= 1.01, both sides) at or before trueStart ('trueStart') or trueStart - X min
    ('trueStart-buffer', X = the TIER's buffer: founder ruling 2026-10-25 (2), per tier, never pooled). start_ts =
    trueStart, gap_to_start_s = trueStart - close_ts (>= X min by construction). Staleness guard: the price must be within
    60 min BEFORE THE CUT (cut - close_ts <= 60 min), else a dash — at a 71-min buffer a 60-min limit measured from trueStart
    could never be met. The row carries closeCut (+ bufferMin, tier, cutTs) in detail so it can be re-cut later. Returns
    (row, None) or (None, reason)."""
    ts = ev.get('cut')
    if ts is None or ev.get('cutSource') != P.NO_FLIP_SOURCE:
        return None, 'no gated trueStart'
    cut_kind = rule['decision']
    x = rule.get('X') if cut_kind == 'trueStart-buffer' else None
    if cut_kind == 'trueStart-buffer' and not (isinstance(x, int) and x > 0):
        return None, 'buffered rule without a whole-minute X'
    cut = ts - dt.timedelta(minutes=x or 0)
    row, why = P.archive_close_row(dict(ev, cut=cut, cutSource=P.FILL_START_SOURCE), raw_id, fid, series)
    if row is None:
        return None, why
    close_ts = P.iso_ms(row['close_ts'])
    lag = (ts - close_ts).total_seconds()
    stale = (cut - close_ts).total_seconds()
    if not 0 <= stale <= RELIABLE_LAG_S:
        return None, f'{STALE_WHY} ({round(stale / 60, 1)} min)'
    row['start_ts'] = ts.isoformat()
    row['gap_to_start_s'] = round(lag, 3)
    row['detail']['closeCut'] = cut_kind
    if x:
        row['detail']['bufferMin'] = x
    row['detail']['cutTs'] = cut.isoformat()
    if rule.get('tier'):
        row['detail']['tier'] = rule['tier']
    row['detail']['fillRule'] = {'ruling': 'founder 2026-10-25, round 2 item 1.4', 'measured': {k: rule.get(k) for k in ('n', 'lateShare', 'maxLateS', 'p98LateS')}}
    return row, None


# ── measurement: Oddspapi trueStart vs our live-flip (founder ruling 2026-10-25, item 1) ─────────────────────────────
MIN_OVERLAP_N = 50                 # n < 50: stop, no fill
TRUESTART_LATE_SHARE_MAX = 0.02    # trueStart later than live-flip in <= 2% of matches ...
TRUESTART_LATE_MAX_S = 120         # ... and never by more than 2 minutes -> the cut is trueStart alone
HIST_EDGES_S = (30, 60, 120, 300, 600, 1800, 3600)
STALE_WHY = 'stale: the last price is more than 60 min before the cut'
# Founder ruling 2026-10-25 (2): the buffer is per tier, never pooled. The tier of a live_flip_log level; the fill
# population (Tennis-Data ATP main draw) is the ATP tier. Challenger is measured and its X reported, never filled here.
TIER_OF_LEVEL = {'Atp Singles': 'ATP', 'Challenger Men Singles': 'Challenger'}
FILL_TIER = 'ATP'


def tier_rules(meas):
    """One fill_rule per tier, each on that tier's own primary measurement (lower edge, gap <= 300 s)."""
    out = {}
    for lv, st in (meas.get('byLevel') or {}).items():
        t = TIER_OF_LEVEL.get(lv)
        if t:
            out[t] = dict(fill_rule(st), tier=t, level=lv)
    return out


def early_hover(minutes):
    """The founder's tooltip for a buffer-cut price (2026-10-25), with the row's own X."""
    return f'Pinnacle price ≥{minutes} min before scheduled start; true close unavailable'


def tier_table(rules, meas):
    """Per tier: n, median d, median lateness (p50 of the later matches), p98 (s and min), X and the decision."""
    out = {}
    for t, r in rules.items():
        st = meas['byLevel'][r['level']]
        out[t] = {'n': st['n'], 'medianDS': st['medianS'], 'lateShare': st['lateShare'], 'medianLateS': st['lateS']['p50'],
                  'p98LateS': st['lateS']['p98'], 'p98LateMin': st['lateMin']['p98'], 'X': r.get('X'), 'decision': r['decision'],
                  'filled': t == FILL_TIER, 'smallN': st['n'] < SMALL_N}
    return out


def pct(sorted_vals, p):
    """Nearest-rank percentile (no interpolation): the smallest value with at least p% of the values at or below it."""
    if not sorted_vals:
        return None
    k = max(1, math.ceil(p / 100 * len(sorted_vals)))
    return sorted_vals[k - 1]


def lateness_stats(ds):
    """ds: d = trueStart - live-flip edge, seconds, one per match. Returns n, median d, share later, and the lateness
    distribution of the LATER ones (seconds and minutes, p50/p90/p95/p98/p99/max) with a histogram."""
    ds = sorted(float(d) for d in ds)
    late = sorted(d for d in ds if d > 0)
    out = {'n': len(ds), 'medianS': pct(ds, 50), 'lateN': len(late), 'lateShare': (len(late) / len(ds)) if ds else None,
           'lateS': {}, 'lateMin': {}, 'histogram': {}}
    for p in (50, 90, 95, 98, 99, 100):
        v = pct(late, p)
        k = 'max' if p == 100 else f'p{p}'
        out['lateS'][k] = v
        out['lateMin'][k] = None if v is None else round(v / 60, 2)
    lo = 0
    for hi in HIST_EDGES_S:
        out['histogram'][f'({lo},{hi}]s'] = sum(1 for d in late if lo < d <= hi)
        lo = hi
    out['histogram'][f'>{lo}s'] = sum(1 for d in late if d > lo)
    return out


def fill_rule(stats):
    """The founder's rule on the primary measurement (see measure()). n < 50 -> 'stop'. Later in <= 2% of matches AND
    never by more than 2 min -> 'trueStart'. Otherwise 'trueStart-buffer' with X = the 98th percentile of the measured
    lateness (the later matches' d, nearest rank), rounded UP to the next whole minute."""
    n = stats['n']
    base = {'n': n, 'lateShare': stats['lateShare'], 'maxLateS': stats['lateS']['max'], 'p98LateS': stats['lateS']['p98']}
    if n < MIN_OVERLAP_N:
        return dict(base, decision='stop', X=None, why=f'overlap n={n} < {MIN_OVERLAP_N}: no fill, report only')
    if stats['lateShare'] <= TRUESTART_LATE_SHARE_MAX and (stats['lateS']['max'] or 0) <= TRUESTART_LATE_MAX_S:
        return dict(base, decision='trueStart', X=None, why='later in <= 2% and never by > 2 min: cut at trueStart')
    x = max(1, math.ceil(stats['lateS']['p98'] / 60))
    return dict(base, decision='trueStart-buffer', X=x, why=f'cut at trueStart - {x} min (ceil of p98 lateness {stats["lateS"]["p98"]} s)')


def overlap_pairs(events, fixtures, flips_by_key):
    """events (pinarch.events_for over live_flip_log) -> one pair per match holding BOTH a live-flip and a GATED trueStart
    (resolve_start's gate via effective_cut with no live-flip). Each pair: dLowerS = trueStart - last_not_live_seen_at,
    dUpperS = trueStart - first_live_seen_at, gapS, level. Returns (pairs, rejected-by-reason)."""
    pairs, rej = [], collections.Counter()
    for ev in events:
        fx = fixtures.get(ev['fixture_id']) or {}
        ts, te, sc = P.iso_ms(fx.get('trueStartTime')), P.iso_ms(fx.get('trueEndTime')), P.iso_ms(fx.get('startTime'))
        if ts is None:
            rej['no Oddspapi trueStart'] += 1; continue
        g, _src, why = P.effective_cut(None, ts, te, sc)
        if g is None:
            rej[f'trueStart rejected: {why}'] += 1; continue
        fl = flips_by_key.get(str(ev['event_key'])) or {}
        lo, up = P.iso_ms(fl.get('last_not_live_seen_at')), P.iso_ms(fl.get('first_live_seen_at'))
        if lo is None or up is None:
            rej['live-flip edge missing'] += 1; continue
        gap = fl.get('gap_seconds')
        pairs.append({'eventKey': str(ev['event_key']), 'fixtureId': ev['fixture_id'], 'level': ev.get('level'), 'date': str(lo.date()),
                      'dLowerS': (g - lo).total_seconds(), 'dUpperS': (g - up).total_seconds(),
                      'gapS': None if gap is None else float(gap)})
    return pairs, dict(rej)


def measure(pairs):
    """The PRIMARY measurement the rule reads: d against the flip's LOWER edge (last_not_live_seen_at, the instant the
    close is cut at on the live-flip rung) on flips whose gap <= 300 s (the live-flip's own reliability bound: a wider
    gap does not place the start). The lower edge is the conservative one — the real start lies in [lower, upper], so a
    trueStart later than the lower edge MAY be in play; later than the upper edge it certainly is. Also reported: the
    upper edge, and every gap."""
    tight = [p for p in pairs if p['gapS'] is not None and p['gapS'] <= FLIP_GAP_MAX_S]
    return {'primary': dict(lateness_stats([p['dLowerS'] for p in tight]), edge='lower (last_not_live_seen_at)', flips='gap <= 300 s'),
            'upperEdgeGap300': dict(lateness_stats([p['dUpperS'] for p in tight]), edge='upper (first_live_seen_at)', flips='gap <= 300 s'),
            'lowerEdgeAllGaps': dict(lateness_stats([p['dLowerS'] for p in pairs]), edge='lower (last_not_live_seen_at)', flips='every gap'),
            'upperEdgeAllGaps': dict(lateness_stats([p['dUpperS'] for p in pairs]), edge='upper (first_live_seen_at)', flips='every gap'),
            'byLevel': {lv: lateness_stats([p['dLowerS'] for p in tight if p['level'] == lv]) for lv in sorted({p['level'] for p in tight if p['level']})},
            'byMonth': {m: lateness_stats([p['dLowerS'] for p in tight if p['date'][:7] == m]) for m in sorted({p['date'][:7] for p in tight})},
            'gapOver300Excluded': len(pairs) - len(tight)}


# ── the plan digest and the write guard (founder ruling 2026-10-25, item 3) ────────────────────────────────────────
def plan_digest(rule, rows):
    """sha256 over the decision, X and each candidate's identity + prices + times + cut, in dedupe-key order. The write
    run recomputes the plan and refuses unless this matches the digest the plan run reported."""
    proj = [{'dedupe_key': r['dedupe_key'], 'event_key': str(r['event_key']), 'fixture_id': r.get('fixture_id'), 'raw_id': r.get('raw_id'),
             'p1': float(r['p1']), 'p2': float(r['p2']), 'close_ts': r['close_ts'], 'start_ts': r['start_ts'],
             'closeCut': (r.get('detail') or {}).get('closeCut'), 'bufferMin': (r.get('detail') or {}).get('bufferMin'),
             'tier': (r.get('detail') or {}).get('tier')}
            for r in sorted(rows, key=lambda r: r['dedupe_key'])]
    blob = json.dumps({'decision': rule.get('decision'), 'X': rule.get('X'), 'tier': rule.get('tier'), 'rows': proj}, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(blob.encode()).hexdigest()


def check_write_request(method, path, body=None, headers=None, allowed_keys=frozenset(), job='archive-fill'):
    """The write run's guard: every read check_request allows, plus exactly two INSERTs — the plan's rows into
    pinnacle_archive_close (on_conflict=dedupe_key, ignore-duplicates, every dedupe_key one of the plan's) and one
    pinnacle_archive_count row for `job`. Nothing else: no PATCH / PUT / DELETE, no RPC, no upsert."""
    if method == 'GET':
        return check_request(method, path, body, headers)
    if method != 'POST':
        raise ReadOnlyRefused(f'refused: {method} (the write run sends GET and INSERT only)')
    m = re.fullmatch(r'/rest/v1/(pinnacle_archive_close|pinnacle_archive_count)\?(.+)', path or '')
    if not m:
        raise ReadOnlyRefused(f'refused: POST {str(path).split("?")[0]} (only the close and count tables take an INSERT)')
    q = dict(urllib.parse.parse_qsl(m.group(2)))
    want = 'dedupe_key' if m.group(1) == P.CLOSE else 'id'
    if q != {'on_conflict': want, 'select': 'id'}:
        raise ReadOnlyRefused(f'refused: insert parameters {q}')
    prefer = {p.strip() for k, v in (headers or {}).items() if k.lower() == 'prefer' for p in str(v).split(',')}
    if prefer != {'resolution=ignore-duplicates', 'return=representation'}:
        raise ReadOnlyRefused(f'refused: Prefer {sorted(prefer)} (an insert must be ignore-duplicates)')
    if not isinstance(body, list) or not body or not all(isinstance(r, dict) for r in body):
        raise ReadOnlyRefused('refused: an insert body must be a list of rows')
    if m.group(1) == P.CLOSE:
        stray = [r.get('dedupe_key') for r in body if r.get('dedupe_key') not in allowed_keys or r.get('supersedes') or 'id' in r]
        if stray:
            raise ReadOnlyRefused(f'refused: {len(stray)} row(s) are not the plan\'s (or carry supersedes / id)')
    elif len(body) != 1 or body[0].get('job') != job:
        raise ReadOnlyRefused('refused: the count insert must be one row for this job')
    return True


def enable_plan_writes(mod, allowed_keys, inner_rest, inner_insert, inner_record_count):
    """Swap the read-only guard for the write guard (the plan's dedupe keys only) and give back pinarch's own insert and
    record_count — the archive's one insert path (INSERT … ON CONFLICT DO NOTHING)."""
    def guarded(method, path, body=None, headers=None, timeout=180, raw=False):
        check_write_request(method, path, body, headers, allowed_keys)
        return inner_rest(method, path, body=body, headers=headers, timeout=timeout, raw=raw)
    mod.rest, mod.insert, mod.record_count = guarded, inner_insert, inner_record_count
    return mod


def write_preflight(plan, digest_in, fresh_held):
    """Refuse the write unless: the recomputed plan's digest equals the one approved, the rule is not 'stop', the plan
    has rows and proves it overwrites nothing, and a FRESH read of the close archive holds none of the candidates' event
    keys or dedupe keys. Returns the rows to insert (exactly the plan's)."""
    if not digest_in or digest_in != plan['digest']:
        raise ReadOnlyRefused(f'refused: stale plan (approved {digest_in or "nothing"}, recomputed {plan["digest"]})')
    if plan['rule']['decision'] not in P.FILL_CUTS:
        raise ReadOnlyRefused(f'refused: the rule says {plan["rule"]["decision"]} ({plan["rule"].get("why")})')
    if plan['rule']['n'] < MIN_OVERLAP_N:
        raise ReadOnlyRefused(f'refused: overlap n={plan["rule"]["n"]} < {MIN_OVERLAP_N}')
    if not plan['candidates']:
        raise ReadOnlyRefused('refused: the plan has no rows')
    if not plan['diff']['proof']['noneOverwrites']:
        raise ReadOnlyRefused('refused: the plan does not prove it overwrites nothing')
    hk = {h['dedupe_key'] for h in fresh_held}
    he = {str(h['event_key']) for h in fresh_held}
    hit = [r['dedupe_key'] for r in plan['candidates'] if r['dedupe_key'] in hk or str(r['event_key']) in he]
    if hit:
        raise ReadOnlyRefused(f'refused: {len(hit)} candidate(s) collide with a held row (re-run the plan)')
    if any(r.get('supersedes') or not P.fill_cut(r) for r in plan['candidates']):
        raise ReadOnlyRefused('refused: a candidate is not a fill-rule close')
    return list(plan['candidates'])


def diff_candidates(rows, held):
    """Candidate rows vs the protected close archive. A candidate is a row for an event with NO held close row of any
    label and a dedupe_key not held: adding it overwrites nothing. A row whose event already has a close would be a
    correction (supersedes) or a duplicate — it is listed, never a candidate. Returns (candidates, report)."""
    held_keys = {h['dedupe_key'] for h in held}
    held_events = {str(h['event_key']) for h in held}
    plan = P.plan_archive_closes(rows, held)
    cand = [r for r in plan if not r.get('supersedes') and str(r['event_key']) not in held_events and r['dedupe_key'] not in held_keys]
    would_supersede = [r for r in plan if r.get('supersedes')]
    dup = [r for r in rows if r['dedupe_key'] in held_keys]
    proof = {'candidateEventsAlreadyHeld': sorted({str(r['event_key']) for r in cand} & held_events),
             'candidateDedupeKeysAlreadyHeld': sorted({r['dedupe_key'] for r in cand} & held_keys),
             'candidatesWithSupersedes': sum(1 for r in cand if r.get('supersedes'))}
    proof['noneOverwrites'] = not (proof['candidateEventsAlreadyHeld'] or proof['candidateDedupeKeysAlreadyHeld'] or proof['candidatesWithSupersedes'])
    rep = {'derivedRows': len(rows), 'heldRowsForTheseEvents': len(held), 'candidates': len(cand),
           'wouldSupersedeAnExistingClose': len(would_supersede), 'sameCloseAlreadyHeld': len(dup),
           'eventsWithAHeldRowButNoNewRow': len(held_events - {str(r['event_key']) for r in rows}),
           'candidatesThatWouldExportUnderCurrentRulings': sum(1 for r in cand if not P.held_back(r)),
           'candidatesHeldBackIfWritten': dict(collections.Counter(P.held_back_reason(r) or 'none' for r in cand)),
           'proof': proof, 'supersedeList': [{'eventKey': r['event_key'], 'supersedes': r['supersedes'], 'p1': r['p1'], 'p2': r['p2'],
                                              'closeTs': r['close_ts']} for r in would_supersede]}
    return cand, rep


def flag(k, n):
    return f'{k}/{n}' + (' (n<30)' if n < SMALL_N else '')


def dash_reason(r, before_by_event, fill_events):
    """Why a match has no exported price after the fill (one reason, the first that applies)."""
    if not r.get('eventKey'):
        return 'no api-tennis fixture joined'
    if not r.get('fixtureId'):
        return 'no Oddspapi fixture joined (one, exactly)'
    if not r.get('hasPayload'):
        return 'no pinnacle+30 payload held'
    if r.get('why') and not r.get('close'):
        return 'no start' if str(r['why']).startswith('no start') else 'no pre-start pair (both sides)'
    f = r.get('fill') or {}
    if f.get('why'):
        return STALE_WHY if f['why'].startswith(STALE_WHY) else f['why']
    if f:
        return 'the event already holds an archive row (held back; never overwritten)'
    return 'no fill row'


def summarize(records, before_by_event, fill_events=frozenset()):
    """Per month: n = Tennis-Data ATP main-draw matches (walkovers out); every count over n, n < 30 flagged."""
    months = collections.OrderedDict()
    for r in sorted(records, key=lambda r: r['date']):
        months.setdefault(r['month'], []).append(r)
    out = {}
    for m, rs in months.items():
        n = len(rs)
        joined = [r for r in rs if r.get('eventKey')]
        cl = [r for r in rs if r.get('close')]
        fc = [r for r in rs if r.get('firstCaptured')]
        bef = [r for r in rs if r.get('eventKey') and before_by_event.get(r['eventKey'])]
        out[m] = {'n': n, 'smallN': n < SMALL_N,
                  'joinedToOddspapi': len([r for r in joined if r.get('fixtureId')]),
                  'hasPinnacle30Payload': sum(1 for r in rs if r.get('hasPayload')),
                  'startFromTrueStart': sum(1 for r in rs if r.get('startSource') in (P.NO_FLIP_SOURCE, P.TRUE_START_SOURCE)),
                  'startFromLiveFlip': sum(1 for r in rs if r.get('startSource') == P.CUT_SOURCE),
                  'firstCaptured': len(fc), 'firstCapturedUnder6h': sum(1 for r in fc if r['firstCaptured']['late']),
                  'close': len(cl), 'closeReliable': sum(1 for r in cl if r['close']['reliable']),
                  'closeReliableWith21DayLimb': sum(1 for r in cl if r['close'].get('reliableWith21DayLimb')),
                  'before': {'exportedClose': len(bef),
                             'byLabel': dict(collections.Counter(before_by_event[r['eventKey']]['label'] for r in bef))},
                  'after': {'closeAny': sum(1 for r in rs if r.get('close') or (r.get('eventKey') and before_by_event.get(r['eventKey']))),
                            'closeReliable': sum(1 for r in cl if r['close']['reliable'])},
                  'exportedAfterFill': sum(1 for r in rs if r.get('eventKey') and (before_by_event.get(r['eventKey']) or r['eventKey'] in fill_events)),
                  'fillRows': sum(1 for r in rs if r.get('eventKey') in fill_events),
                  'dashedByReason': dict(collections.Counter(dash_reason(r, before_by_event, fill_events) for r in rs
                                                             if not (r.get('eventKey') and (before_by_event.get(r['eventKey']) or r['eventKey'] in fill_events))))}
        out[m]['display'] = {k: flag(out[m][k], n) for k in ('hasPinnacle30Payload', 'firstCaptured', 'close', 'closeReliable')}
        out[m]['display']['beforeExported'] = flag(len(bef), n)
        out[m]['display']['afterExported'] = flag(out[m]['exportedAfterFill'], n)
    return out


def _r(v):
    return '—' if v is None else round(v, 1)


def _pc(v):
    return '—' if v is None else f'{round(100 * v, 1)}%'


def markdown(rep):
    L = [f"# Archive fill probe — ATP main draw {rep['window'][0]} … {rep['window'][1]} (read-only)", '',
         f"Generated {rep['generatedAt']} from commit {rep['commit']}. " + ('Plan run: nothing was written.' if rep.get('mode') != 'write' else 'Write run: see archive-fill-write.json.'), '',
         '| month | n | pinnacle+30 payload | first captured | of which < 6 h | close at start | close_reliable | Pinnacle close BEFORE (exported) | AFTER the fill |',
         '|---|---|---|---|---|---|---|---|---|']
    for m, s in rep['perMonth'].items():
        d = s['display']
        L.append(f"| {m} | {s['n']}{' ⚑' if s['smallN'] else ''} | {d['hasPinnacle30Payload']} | {d['firstCaptured']} | "
                 f"{s['firstCapturedUnder6h']}/{s['firstCaptured']} | {d['close']} | {d['closeReliable']} | {d['beforeExported']} | {d['afterExported']} |")
    t = rep['totals']
    L += ['', f"Totals: n={t['n']}, payload {t['hasPinnacle30Payload']}, first captured {t['firstCaptured']} "
              f"({t['firstCapturedUnder6h']} under 6 h), close {t['close']}, close_reliable {t['closeReliable']} "
              f"(with the 21-day archive-age limb: {t['closeReliableWith21DayLimb']}), site today {t['beforeExported']}.", '',
          '## Measurement: Oddspapi trueStart − our live-flip', '',
          'Primary (the rule reads it): d against the flip\'s LOWER edge (last_not_live_seen_at) on flips with gap ≤ 300 s; '
          'percentiles are nearest-rank; lateness = d over the matches where trueStart is later.', '', '```json',
          json.dumps({k: v for k, v in rep['measure'].items() if k not in ('byMonth',)}, indent=1), '```', '',
          '## Per tier (founder ruling 2026-10-25: the buffer is per tier, never pooled)', '',
          '| tier | n | median d (s) | share later | median lateness (s) | p98 lateness | X (min) | decision | filled here |',
          '|---|---|---|---|---|---|---|---|---|'] + [
          f"| {t} | {v['n']}{' ⚑' if v['smallN'] else ''} | {_r(v['medianDS'])} | {_pc(v['lateShare'])} | {_r(v['medianLateS'])} | "
          f"{_r(v['p98LateS'])} s = {v['p98LateMin']} min | {v['X'] if v['X'] is not None else '—'} | {v['decision']} | "
          f"{'yes (ATP main draw)' if v['filled'] else 'no — not in the fill population (Tennis-Data ATP main draw)'} |"
          for t, v in sorted(rep['tiers'].items())] + ['',
          f"**Fill rule (tier {rep['rule'].get('tier')}):** {rep['rule']['decision']}" + (f" (X = {rep['rule']['X']} min)" if rep['rule'].get('X') else '') + f" — {rep['rule']['why']}", '',
          f"Marker: **E**, tooltip `{rep['earlyHover']}`" if rep.get('earlyHover') else 'Marker: none (no buffer cut).', '',
          '## Filled vs dashed per month (ATP main draw)', '',
          '| month | n | filled (E) | stays dashed | dashed by reason |', '|---|---|---|---|---|'] + [
          f"| {m} | {s_['n']}{' ⚑' if s_['smallN'] else ''} | {flag(s_['fillRows'], s_['n'])} | {flag(s_['n'] - s_['exportedAfterFill'], s_['n'])} | "
          + '; '.join(f'{k}: {v}' for k, v in sorted(s_['dashedByReason'].items(), key=lambda kv: -kv[1])) + ' |'
          for m, s_ in rep['perMonth'].items()] + ['',
          f"**Plan digest** (the write run's `plan_digest` input): `{rep['digest']}` over {rep['diff']['candidates']} row(s).", '',
          '## Candidate rows (NOT written by the plan run)', '', '```json', json.dumps({k: v for k, v in rep['diff'].items() if k != 'supersedeList'}, indent=1), '```', '',
          '## Unmatched / not derived', '', '```json', json.dumps(rep['why'], indent=1), '```', '',
          '"First captured price" is the earliest Pinnacle +30 price our archive holds for the match, not an opening line.',
          'Start ladder: Oddspapi trueStartTime (gated) → live-flip lower bound → dash; never the scheduled time.']
    return '\n'.join(L) + '\n'


# ── the read (network: Actions only) ─────────────────────────────────────────────────────────────────────────────────
MEASURE_FROM = '2026-09-15'        # live_flip_log begins 17 Sep: from there every overlap is measured


def _quoted_in(col, vals):
    return f'{col}=in.(' + urllib.parse.quote(','.join('"' + str(v).replace('"', '') + '"' for v in vals), safe='') + ')'


def held_for(event_keys, dedupe_keys=()):
    """Every pinnacle_archive_close row for these event keys, plus any row holding one of these dedupe keys (GET only)."""
    cols = ('id,event_key,label,source,book,p1,p2,p1_key,p2_key,p1_name,p2_name,match_date,close_ts,start_ts,start_source,'
            'gap_to_start_s,supersedes,dedupe_key,detail')
    eks, out, seen = sorted({str(k) for k in event_keys}), [], set()
    for i in range(0, len(eks), 150):
        for h in P.select_all(P.CLOSE, cols, 'event_key=in.(' + ','.join(eks[i:i + 150]) + ')'):
            seen.add(h['id']); out.append(h)
    dks = sorted(set(dedupe_keys))
    for i in range(0, len(dks), 40):
        for h in P.select_all(P.CLOSE, cols, _quoted_in('dedupe_key', dks[i:i + 40])):
            if h['id'] not in seen:
                seen.add(h['id']); out.append(h)
    return out


def memo_load(mod):
    """pinarch._load re-executes a helper module on every call (effective_cut loads ten225-load-line-summary.py per
    match): load each one once for this run — the same pure code, thousands of times faster."""
    if getattr(mod, '_load_memo', None) is None:
        inner, memo = mod._load, {}
        def _load(name, file):
            if (name, file) not in memo:
                memo[(name, file)] = inner(name, file)
            return memo[(name, file)]
        mod._load, mod._load_memo = _load, memo
    return mod


def run(out_dir, frm, to, td_path=None, measure_to=None, write=False, digest_in=None):
    import concurrent.futures as cf
    install_guard(P)
    memo_load(P)
    os.makedirs(out_dir, exist_ok=True)
    td_all = list(csv.DictReader(open(td_path or os.path.join(ROOT, 'odds-archive', '2026.csv'))))
    targets = [r for r in td_all if frm <= r['date'] <= to and 'walk' not in str(r.get('comment') or '').lower()]
    walkovers = sum(1 for r in td_all if frm <= r['date'] <= to and 'walk' in str(r.get('comment') or '').lower())
    d0, d1 = dt.date.fromisoformat(frm) - dt.timedelta(days=1), dt.date.fromisoformat(to) + dt.timedelta(days=2)
    days = [(d0 + dt.timedelta(days=i)).isoformat() for i in range((d1 - d0).days + 1)]
    by_day = collections.defaultdict(list)
    def day(d):
        j = T._at({'method': 'get_fixtures', 'date_start': d, 'date_stop': d, 'timezone': 'UTC'})
        if not isinstance(j.get('result'), list) and j.get('success') != 1:
            raise RuntimeError(f'get_fixtures {d}: no result list')
        return j.get('result') or []
    with cf.ThreadPoolExecutor(8) as ex:
        for res in ex.map(day, days):
            for f in res:
                if f.get('event_type_type') == 'Atp Singles':
                    by_day[f['event_date']].append(f)
    if not by_day:
        P.die('api-tennis returned no ATP singles fixture for the window: nothing computed')
    R = P._load('roh', 'refresh-odds-history.py')
    idx = json.load(gzip.open(os.path.join(P.ROOT_DIR, P.FIXTURE_INDEX))).get('fixtures') or {}
    fixtures = P.held_fixture_meta(idx, P.select_all(P.RAW, 'id,fixture_id,books,meta', 'meta->>trigger=eq.backfill'))
    disc = [f for f in fixtures.values() if f.get('categoryName') in P.DISCOVERY_CATEGORIES]
    by_day_od, bmap = P._fixtures_by_day(disc), P._board_map()

    # 1. the measurement: every live_flip_log match with a gated Oddspapi trueStart (17 Sep .. measure_to)
    m_to = dt.datetime.fromisoformat(measure_to + 'T00:00:00+00:00') + dt.timedelta(days=1) if measure_to else None
    fl_all = P.flips(dt.datetime.fromisoformat(MEASURE_FROM + 'T00:00:00+00:00'), m_to)
    flips_by_key = {str(x['event_key']): x for x in fl_all}
    m_events, m_miss = P.events_for(fl_all, bmap, disc, {})
    pairs, m_rej = overlap_pairs(m_events, fixtures, flips_by_key)
    meas = measure(pairs)
    rules = tier_rules(meas)
    rule = rules.get(FILL_TIER) or dict(fill_rule(lateness_stats([])), tier=FILL_TIER, level=None)

    # 2. the window: joins, payloads, closes, fill rows
    why = collections.Counter()
    joined = []
    for r in targets:
        f, w = T.approx_join(r, by_day)
        if f is None:
            why['api-tennis join: ' + w] += 1; joined.append((r, None, None, None, None)); continue
        fid, first_p1 = T.od_fixture_of(f, R, bmap, by_day_od)
        if fid is None:
            why['oddspapi: ' + first_p1] += 1; joined.append((r, f, w, None, None)); continue
        joined.append((r, f, w, fid, first_p1))
    claimed = collections.Counter(j[3] for j in joined if j[3])
    fids = sorted({j[3] for j in joined if j[3] and claimed[j[3]] == 1})
    series = {}
    def chunk(ch):
        o = {}
        for fid, raw in P.raw_latest(ch).items():
            o[fid] = None if raw is P.NO_PINNACLE else ({'id': raw['id'], 'pulled_at': raw.get('pulled_at')},
                                                        P.mw_series(gzip.decompress(P.unhex(raw['payload_gz']))))
        return o
    with cf.ThreadPoolExecutor(8) as ex:
        for part in ex.map(chunk, [fids[i:i + 10] for i in range(0, len(fids), 10)]):
            series.update(part)
    records, rows, fills = [], [], []
    for r, f, w, fid, first_p1 in joined:
        base = {'date': r['date'], 'month': r['date'][:7], 'tournament': r.get('tournament'), 'round': r.get('round'),
                'winner': r['winner'], 'loser': r['loser'], 'eventKey': str(f['event_key']) if f else None, 'fixtureId': fid}
        if fid is None:
            records.append(base); continue
        if claimed[fid] > 1:
            why['oddspapi: one fixture, two Tennis-Data rows'] += 1; records.append(dict(base, fixtureId=None)); continue
        got = series.get(fid)
        if got is None:
            why['no pinnacle+30 payload held' if fid not in series else 'held payloads are another book only'] += 1
        raw, S = got if got else (None, {})
        rec, row, fill = evaluate(r, f, w, fid, first_p1, fixtures.get(fid) or {}, flips_by_key.get(str(f['event_key'])), raw, S, rule)
        if rec.get('why') and raw is not None:
            why['not derived: ' + rec['why']] += 1
        if (rec.get('fill') or {}).get('why'):
            why['no fill: ' + (STALE_WHY if rec['fill']['why'].startswith(STALE_WHY) else rec['fill']['why'])] += 1
        records.append(rec)
        if row:
            rows.append(row)
        if fill:
            fills.append(fill)
    eks = sorted({r['eventKey'] for r in records if r.get('eventKey')})
    held = held_for(eks, [x['dedupe_key'] for x in rows + fills])
    exported = {str(x['eventKey']): x for x in P.export_rows(held)}
    held_back = collections.Counter(P.held_back_reason(h) or 'not held back' for h in held)
    cand, diff = diff_candidates(fills, held)
    _, diff_at_start = diff_candidates(rows, held)
    digest = plan_digest(rule, cand)
    per = summarize(records, exported, frozenset(str(c['event_key']) for c in cand))
    tot = {k: sum(s[k] for s in per.values()) for k in ('n', 'hasPinnacle30Payload', 'firstCaptured', 'firstCapturedUnder6h', 'close',
                                                        'closeReliable', 'closeReliableWith21DayLimb', 'exportedAfterFill', 'fillRows')}
    tot['beforeExported'] = sum(s['before']['exportedClose'] for s in per.values())
    rep = {'window': [frm, to], 'generatedAt': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
           'commit': os.environ.get('GITHUB_SHA') or 'local', 'mode': 'write' if write else 'plan',
           'readOnly': 'plan: every request passed check_request (GET-only allow-list); PostgREST GET = READ ONLY transaction',
           'population': {'tennisDataRows': len(targets), 'walkoversExcluded': walkovers, 'source': 'odds-archive/2026.csv'},
           'measure': dict(meas, window=[MEASURE_FROM, measure_to or 'now'], liveFlipRows=len(fl_all), joinMisses=m_miss,
                           rejected=m_rej, pairs=len(pairs)),
           'rule': rule, 'rulesByTier': rules, 'tiers': tier_table(rules, meas), 'fillTier': FILL_TIER,
           'earlyHover': early_hover(rule['X']) if rule.get('X') else None, 'digest': digest, 'liveFlipRowsInWindow': sum(1 for r in records if r.get('liveFlip')),
           'perMonth': per, 'totals': tot, 'why': dict(why),
           'before': {'heldCloseRows': len(held), 'heldBackByRule': dict(held_back), 'exportedForTheseEvents': len(exported),
                      'exportedByLabel': dict(collections.Counter(x['label'] for x in exported.values()))},
           'diff': diff, 'diffOfCloseAtStart': {k: v for k, v in diff_at_start.items() if k != 'supersedeList'}}
    json.dump(rep, open(os.path.join(out_dir, 'archive-fill-probe.json'), 'w'), indent=1, default=str)
    json.dump(records, open(os.path.join(out_dir, 'archive-fill-matches.json'), 'w'), indent=1, default=str)
    json.dump(cand, open(os.path.join(out_dir, 'archive-fill-candidates.json'), 'w'), indent=1, default=str)
    json.dump(pairs, open(os.path.join(out_dir, 'archive-fill-measure-pairs.json'), 'w'), indent=1, default=str)
    open(os.path.join(out_dir, 'archive-fill-probe.md'), 'w').write(markdown(rep))
    print(markdown(rep))
    if not write:
        return rep

    # 3. the write: only exactly this plan, only when nothing collides, only INSERT
    plan = {'digest': digest, 'rule': rule, 'candidates': cand, 'diff': diff}
    res = {'approvedDigest': digest_in, 'recomputedDigest': digest, 'expected': len(cand)}
    try:
        fresh = held_for([c['event_key'] for c in cand], [c['dedupe_key'] for c in cand])
        todo = write_preflight(plan, digest_in, fresh)
    except ReadOnlyRefused as ex:
        res['refused'] = str(ex)
        json.dump(res, open(os.path.join(out_dir, 'archive-fill-write.json'), 'w'), indent=1, default=str)
        P.die(str(ex))
    inner = P._inner
    enable_plan_writes(P, frozenset(r['dedupe_key'] for r in todo), inner['rest'], inner['insert'], inner['record_count'])
    ids = []
    for i in range(0, len(todo), 200):
        ids += P.insert(P.CLOSE, todo[i:i + 200], 'dedupe_key')
    res['inserted'] = len(ids)
    res['ids'] = ids
    res['counts'] = P.record_count('archive-fill', {'digest': digest, 'inserted': len(ids), 'rule': rule['decision'], 'X': rule.get('X')})
    json.dump(res, open(os.path.join(out_dir, 'archive-fill-write.json'), 'w'), indent=1, default=str)
    print('### archive-fill write', json.dumps({k: v for k, v in res.items() if k != 'ids'}))
    if len(ids) != len(todo):
        P.die(f'inserted {len(ids)} of {len(todo)} plan rows (the rest were already held): see archive-fill-write.json')
    return rep


def main(argv=None):
    a = argparse.ArgumentParser()
    a.add_argument('--out', required=True)
    a.add_argument('--from', dest='frm', default=FROM)
    a.add_argument('--to', default=TO)
    a.add_argument('--measure-to', default=None, help='last live-flip day measured (UTC, inclusive); default today')
    a.add_argument('--write', choices=('true', 'false'), default='false')
    a.add_argument('--plan-digest', default='')
    o = a.parse_args(argv)
    for d in (o.frm, o.to) + ((o.measure_to,) if o.measure_to else ()):
        dt.date.fromisoformat(d)
    o.measure_to = o.measure_to or (dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=1)).isoformat()   # whole days only
    if o.write == 'true' and not re.fullmatch(r'[0-9a-f]{64}', o.plan_digest or ''):
        P.die('--write true needs --plan-digest (the 64-hex digest the plan run reported)')
    run(o.out, o.frm, o.to, measure_to=o.measure_to, write=o.write == 'true', digest_in=o.plan_digest or None)


if __name__ == '__main__':
    main()
