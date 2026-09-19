#!/usr/bin/env python3
"""TEN-225 item I(2) — is api-tennis's bet365 the same book as oddspapi's bet365?

Founder 2026-09-19: "SAME-ENTITY CHECK before any Open/Now pairing across
sources... Confirm at n >= 30 on same-instant pairs. a. MEASURE THE LAG IN
MINUTES on the 36.8%... per book, not just bet365. b. Explain the 1.3% genuine
disagreement — show me the cases."

WHERE THE DATA COMES FROM, and why this costs nothing.

  matches.json is committed by the pipeline ~150x/day. Every commit is a
  simultaneous observation of BOTH feeds:

    bet365Now  -> ODDSPAPI's bet365. Carries `at` (the instant oddspapi says the
                  book moved the price) and `observedAt` (when we fetched).
    odds /     -> API-TENNIS books. `odds` is the headline book, `bestOdds` the
    bestOdds /    best price per side, `bookOpens` the per-book first sighting.
    bookOpens     The commit instant is the observation instant.

  So git history IS the paired time series, at no API cost and with no new
  polling. Replaying it also means the comparison is over prices that were
  really live at the time, rather than over what either vendor returns today.

THE ODDSPAPI TICK SERIES is reconstructed from the distinct (at, p1, p2) values
bet365Now took across those commits. That is oddspapi's own change instant, not
our sampling clock, so a tick is a real book move rather than a poll artefact.

THE COMPARISON, per api-tennis observation of a book at instant T:

  IDENTICAL   api-tennis == the oddspapi tick CURRENT at T (2dp truncation)
  LAGGING     api-tennis == an EARLIER oddspapi tick -> lag = T_current - T_matched
  DISAGREE    api-tennis matches NO tick in the series

⚠️ Only bet365 can be classed at all: oddspapi entitles bet365 and nothing else,
so there is no oddspapi series for Betano or 1xBet to compare against. The
per-book half of (a) is answered a different way — see the REFRESH INTERVAL
section, which measures how often each api-tennis book's price CHANGES in our
observations. That bounds how stale a book can be without needing a second feed.
"""
import json
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone

REPO = '/Users/Michael/bsp-consult-project'
SINCE = '4 days ago'


def sh(*a):
    return subprocess.run(a, cwd=REPO, capture_output=True, text=True).stdout


def parse(ts):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace('Z', '+00:00'))
    except Exception:
        return None


def trunc2(x):
    """api-tennis TRUNCATES to 2dp and never rounds (measured, 0 counter-examples
    in 394 agreeing observations). So the comparison must truncate the oddspapi
    side the same way, or every 3-decimal oddspapi price reads as a disagreement
    when it is in fact the same quote through a narrower pipe."""
    return None if x is None else int(float(x) * 100) / 100.0


def main():
    commits = [l.split() for l in sh('git', 'log', 'origin/main',
                                     f'--since={SINCE}', '--format=%H %cI',
                                     '--', 'matches.json').strip().splitlines()]
    commits = [(h, parse(t)) for h, t in commits if parse(t)]
    commits.sort(key=lambda x: x[1])
    print(f'replaying {len(commits)} commits of matches.json '
          f'({commits[0][1].isoformat()} -> {commits[-1][1].isoformat()})')

    # oddspapi bet365 ticks per fixture: {fid: {at_iso: (p1, p2)}}
    odds_ticks = defaultdict(dict)
    # api-tennis observations: [(fid, commit_time, book, p1, p2)]
    api_obs = []
    # fixture identity, for the full-series join below: {fid: (name1, name2, day)}
    ident = {}

    for h, ct in commits:
        raw = sh('git', 'show', f'{h}:matches.json')
        if not raw.strip():
            continue
        try:
            d = json.loads(raw)
        except Exception:
            continue
        ms = d['matches'] if isinstance(d, dict) and 'matches' in d else d
        if not isinstance(ms, list):
            continue
        for m in ms:
            fid = m.get('id')
            if not fid:
                continue
            if fid not in ident and m.get('p1') and m.get('p2'):
                day = (m.get('date') or m.get('startTime') or '')[:10]
                if day:
                    ident[fid] = (m['p1'], m['p2'], day)
            b = m.get('bet365Now')
            if b and b.get('at') and b.get('p1') and b.get('p2'):
                odds_ticks[fid][b['at']] = (b['p1'], b['p2'])
            # api-tennis legs. A pair is only usable when BOTH sides name the
            # SAME book -- bestOdds is a best-across-books merge, so taking its
            # two sides as one book's quote would compare a price nobody quoted.
            o = m.get('odds')
            if o and o.get('p1') and o.get('p2') and o.get('bookmaker'):
                api_obs.append((fid, ct, o['bookmaker'], o['p1'], o['p2']))
            bo = m.get('bestOdds')
            if (bo and isinstance(bo.get('p1'), dict) and isinstance(bo.get('p2'), dict)
                    and bo['p1'].get('bookmaker')
                    and bo['p1'].get('bookmaker') == bo['p2'].get('bookmaker')
                    and bo['p1'].get('price') and bo['p2'].get('price')):
                api_obs.append((fid, ct, bo['p1']['bookmaker'],
                                bo['p1']['price'], bo['p2']['price']))
            for book, v in (m.get('bookOpens') or {}).items():
                if v.get('p1') and v.get('p2') and v.get('seenAt'):
                    t = parse(v['seenAt'])
                    if t:
                        api_obs.append((fid, t, book, v['p1'], v['p2']))

    # Dedupe: the same (fixture, book, instant, price) seen in several commits is
    # ONE observation. Without this, a price that sits unchanged for 20 commits
    # would be counted 20 times and would dominate every percentage below.
    api_obs = sorted(set(api_obs), key=lambda x: x[1])
    print(f'oddspapi bet365 tick series: {len(odds_ticks)} fixture(s), '
          f'{sum(len(v) for v in odds_ticks.values())} distinct tick(s)')
    print(f'api-tennis observations: {len(api_obs)} (deduped)')

    # ---------------------------------------------------------------- classify
    series = {}
    for fid, ticks in odds_ticks.items():
        s = sorted(((parse(a), p) for a, p in ticks.items()), key=lambda x: x[0])
        series[fid] = [(t, p) for t, p in s if t]

    IDENT, LAG, DIS = [], [], []
    for fid, t, book, p1, p2 in api_obs:
        if book.lower() != 'bet365':
            continue                      # no oddspapi series for any other book
        s = series.get(fid) or []
        past = [(tt, pp) for tt, pp in s if tt <= t]
        if not past:
            continue
        cur_t, cur_p = past[-1]
        want = (trunc2(p1), trunc2(p2))
        if (trunc2(cur_p[0]), trunc2(cur_p[1])) == want:
            IDENT.append((fid, t, cur_t))
            continue
        hit = None
        for tt, pp in reversed(past[:-1]):
            if (trunc2(pp[0]), trunc2(pp[1])) == want:
                hit = tt
                break
        if hit:
            LAG.append((fid, t, cur_t, hit, (cur_t - hit).total_seconds() / 60.0))
        else:
            DIS.append((fid, t, cur_p, (p1, p2)))

    n = len(IDENT) + len(LAG) + len(DIS)
    print(f'\n=== SAME-ENTITY, bet365 only (n={n}) ===')
    if not n:
        print('  ::warning:: ZERO comparable bet365 pairs. This is NOT "the books '
              'disagree" and NOT "they agree" — nothing was assessed. Do not read '
              'a verdict off this run.')
    else:
        for name, c in (('IDENTICAL to the current oddspapi tick', len(IDENT)),
                        ('LAGGING  (matches an EARLIER oddspapi tick)', len(LAG)),
                        ('DISAGREE (matches no tick in the series)', len(DIS))):
            print(f'  {name:46} {c:>5}  {100.0*c/n:5.1f}%')
        flag = '  ⚠️ n<30' if n < 30 else ''
        print(f'  {"total":46} {n:>5}{flag}')

    if LAG:
        v = sorted(x[4] for x in LAG)
        p95 = v[min(len(v) - 1, int(round(0.95 * (len(v) - 1))))]
        print(f'\n(a) LAG in MINUTES on the lagging set: median {v[len(v)//2]:.1f}'
              f'  p95 {p95:.1f}  max {v[-1]:.1f}  n={len(v)}'
              + ('  ⚠️ n<30' if len(v) < 30 else ''))

    if DIS:
        print(f'\n(b) THE DISAGREEMENTS — every case, not a percentage (n={len(DIS)}):')
        for fid, t, cur_p, got in DIS[:25]:
            print(f'    {fid:22} at {t.isoformat()}  oddspapi {cur_p[0]}/{cur_p[1]}'
                  f'   api-tennis {got[0]}/{got[1]}')

    # ================================================================
    # THE DECISIVE PASS — against oddspapi's FULL tick series.
    #
    # Everything above reconstructs oddspapi's series from bet365Now as WE
    # observed it, and we observe that leg HOURLY. Any tick between two of our
    # reads is invisible, so an api-tennis price matching one of those ticks
    # cannot be recognised as LAGGING and falls into DISAGREE instead. That
    # makes the DISAGREE figure above an UPPER BOUND and the LAG figure a LOWER
    # BOUND — not wrong, but not the number the founder asked for.
    #
    # bet365-history/*.json carries the COMPLETE oddspapi tick series (every
    # createdAt, every price) for fixtures that have finished. Joining to it
    # removes the sampling hole entirely, at the cost of covering only fixtures
    # old enough to have been archived. Both passes are reported, because the
    # difference between them IS the measurement of how much our hourly
    # sampling was hiding.
    # ================================================================
    import glob
    import ten225_names as NM
    full = {}
    for f in sorted(glob.glob(f'{REPO}/bet365-history/2026-*.json')):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        for oid, e in (d.get('fixtures') or {}).items():
            if not (e.get('s1') and e.get('s2') and e.get('start')):
                continue
            day = datetime.fromtimestamp(e['start'], timezone.utc).strftime('%Y-%m-%d')
            k = NM.match_key(day, e.get('p1') or '', e.get('p2') or '')
            if not k:
                continue
            # Drop on ambiguity, exactly as every other matcher on this issue
            # does: two archived fixtures on one key means we cannot say which
            # series belongs to which match, so neither is offered.
            full[k] = None if k in full else e
    full = {k: v for k, v in full.items() if v}

    def series_at(e, t):
        """oddspapi's (p1, p2) current at instant t, from the full series."""
        ts = t.timestamp()
        a = [p for tt, p in e['s1'] if tt <= ts]
        b = [p for tt, p in e['s2'] if tt <= ts]
        return (a[-1], b[-1]) if a and b else None

    FI, FL, FD = [], [], []
    for fid, t, book, p1, p2 in api_obs:
        if book.lower() != 'bet365' or fid not in ident:
            continue
        n1, n2, day = ident[fid]
        e = full.get(NM.match_key(day, n1, n2))
        if not e:
            continue
        cur = series_at(e, t)
        if not cur:
            continue
        want = (trunc2(p1), trunc2(p2))
        if (trunc2(cur[0]), trunc2(cur[1])) == want:
            FI.append(1)
            continue
        # walk BACK through the real series for the tick api-tennis is showing
        hit = None
        ts = t.timestamp()
        pts = sorted({tt for tt, _ in e['s1'] if tt <= ts}
                     | {tt for tt, _ in e['s2'] if tt <= ts}, reverse=True)
        for tt in pts:
            at = datetime.fromtimestamp(tt, timezone.utc)
            pp = series_at(e, at)
            if pp and (trunc2(pp[0]), trunc2(pp[1])) == want:
                hit = tt
                break
        if hit is not None:
            FL.append((t.timestamp() - hit) / 60.0)
        else:
            FD.append((fid, t, cur, (p1, p2)))

    nf = len(FI) + len(FL) + len(FD)
    print(f'\n=== DECISIVE: against oddspapi\'s FULL tick series (n={nf}) ===')
    print(f'    archived fixtures joinable: {len(full)}')
    if not nf:
        print('  ::warning:: ZERO api-tennis bet365 observations joined to an archived '
              'full series. Nothing was assessed on this axis — the bound above is '
              'all this run measured. NOT a verdict either way.')
    else:
        for name, c in (('IDENTICAL to the tick current at that instant', len(FI)),
                        ('LAGGING  (matches a real EARLIER tick)', len(FL)),
                        ('DISAGREE (matches NO tick in the full series)', len(FD))):
            print(f'  {name:48} {c:>5}  {100.0*c/nf:5.1f}%')
        print(f'  {"total":48} {nf:>5}' + ('  ⚠️ n<30' if nf < 30 else ''))
        if FL:
            v = sorted(FL)
            p95 = v[min(len(v) - 1, int(round(0.95 * (len(v) - 1))))]
            print(f'  LAG minutes: median {v[len(v)//2]:.1f}  p95 {p95:.1f}  '
                  f'max {v[-1]:.1f}  n={len(v)}' + ('  ⚠️ n<30' if len(v) < 30 else ''))
        for fid, t, cur, got in FD[:15]:
            print(f'    DISAGREE {fid:22} {t.isoformat()}  oddspapi {cur[0]}/{cur[1]}'
                  f'   api-tennis {got[0]}/{got[1]}')

    # ------------------------------------------- per-book refresh, the (a) half
    # oddspapi carries no series for these books, so "how far behind oddspapi" is
    # unanswerable for them. What IS measurable, and is the number the cadence
    # decision actually needs: how often each book's price CHANGES in our own
    # observations. A book that moves every 40 min cannot be more than ~40 min
    # stale however we poll it.
    print('\n(a, per book) OBSERVED CHANGE INTERVAL — minutes between distinct '
          'prices for the same fixture+book')
    byb = defaultdict(lambda: defaultdict(list))
    for fid, t, book, p1, p2 in api_obs:
        byb[book][fid].append((t, (trunc2(p1), trunc2(p2))))
    rows = []
    for book, fixtures in byb.items():
        gaps, nobs = [], 0
        for fid, obs in fixtures.items():
            obs.sort(key=lambda x: x[0])
            nobs += len(obs)
            last_t, last_p = obs[0]
            for t, p in obs[1:]:
                if p != last_p:
                    gaps.append((t - last_t).total_seconds() / 60.0)
                    last_t, last_p = t, p
        if gaps:
            g = sorted(gaps)
            p95 = g[min(len(g) - 1, int(round(0.95 * (len(g) - 1))))]
            rows.append((book, len(g), g[len(g)//2], p95, g[-1], nobs))
        else:
            rows.append((book, 0, None, None, None, nobs))
    rows.sort(key=lambda r: -r[1])
    print(f"  {'book':12} {'changes':>8} {'median':>9} {'p95':>9} {'max':>9} {'obs':>6}")
    for book, ng, med, p95, mx, nobs in rows:
        if ng:
            print(f'  {book:12} {ng:>8} {med:>8.1f}m {p95:>8.1f}m {mx:>8.1f}m {nobs:>6}'
                  + ('  ⚠️n<30' if ng < 30 else ''))
        else:
            print(f'  {book:12} {ng:>8} {"—":>9} {"—":>9} {"—":>9} {nobs:>6}'
                  '   no price change observed')
    return 0


if __name__ == '__main__':
    sys.exit(main())
