#!/usr/bin/env python3
"""TEN-225 ruling A.2 — the Postgres scope projection, PRE-START ONLY.

Michael's ruling: "POSTGRES SCOPE: pre-start ticks only. Challengers are a
priority. Project size for (a) ATP tour + Slams, (b) (a) + Challengers,
(c) (b) + ITF - backfill and per year, pre-start only. Load the largest option
that stays under 25% of the 8 GB database per year."

The markets-check projection cannot be reused: it sized the keep-set at FULL
density (1,750 ticks/fixture, pre-start AND in-play). Pre-start only is a
different and much smaller number, and it has to be measured, not scaled by a
guessed ratio. Two measurements, both recomputed from this run:

  A. LEVEL MIX  — one metered /v4/fixtures window over the last 7 days, all
     tennis, no tier filter. The cached target list cannot answer this: it
     holds only ATP/Challenger/WTA/WTA125K (16,709 fixtures, zero ITF), because
     it was built for the tour-scoped bet365-history job. Option (c) needs ITF
     counts that simply are not in it.

  B. PRE-START DENSITY — free /v4/historical-odds on fixtures aged 4-9 days,
     which the decay work shows are still undecayed, counting ticks in the four
     keep-list families only (match winner, games handicap, total games, set
     betting; set handicap dropped, absent 0/26). Split pre-start vs in-play on
     the fixture start, and report per level.

Row cost 377.7 B is TEN-216's measured figure for this Supabase instance.
"""
import collections, gzip, json, os, statistics, sys, time
import urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = 'https://api.oddspapi.io'
BOOK = 'bet365'
SPORT_TENNIS = 12
SLEEP = 5.5
ROW_BYTES = 377.7
DB_GB = 8.0
BUDGET_FRACTION = 0.25          # "under 25% of the 8 GB database per year"
PER_LEVEL = 5                   # fixtures sampled per level for density
OUT = os.path.join(HERE, 'ten225-scope-probe.json')
CATALOGUE = os.path.join(HERE, '.oddspapi-markets.json')

# Only levels that can plausibly carry bet365 odds. UTR / Juniors / Wheelchairs
# 404 on /v4/historical-odds across the board (measured: 19/19 in the first
# pass) so they are not sampled and not projected.
DENSITY_LEVELS = ('ATP', 'Challenger', 'ITF Men', 'ITF Women', 'WTA',
                  'WTA 125K', 'Davis Cup')

# The four keep-list families, by the catalogue names in the markets-check.
KEEP_FAMILIES = {
    'match winner':    lambda name: name == 'Winner',
    'games handicap':  lambda name: name == 'Game Handicap',
    'total games':     lambda name: name == 'Total Games Over Under',
    'set betting':     lambda name: name == 'Correct Score',
}


def read_key():
    for line in open(os.path.join(HERE, '.env')):
        if line.startswith('ODDSPAPI_KEY='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")
    return os.environ.get('ODDSPAPI_KEY')


def api_get(path, params, key, timeout=180):
    p = dict(params); p['apiKey'] = key
    url = BASE + path + '?' + urllib.parse.urlencode(p)
    req = urllib.request.Request(url, headers={'User-Agent': 'BSP-Consult-Dashboard/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r), None
    except urllib.error.HTTPError as e:
        return None, e.code
    except Exception as e:
        return None, str(e)


def epoch(ts):
    if not ts: return None
    try: return datetime.fromisoformat(str(ts).replace('Z', '+00:00')).timestamp()
    except ValueError: return None


def market_names(key):
    """marketId -> family name. The historical-odds payload carries NO names,
    only ids (measured: a market object has exactly one key, 'outcomes'), so the
    keep-list can only be applied through this catalogue. Cached on disk: it is
    a metered call and the catalogue does not change between runs."""
    if os.path.exists(CATALOGUE):
        cat = json.load(open(CATALOGUE))
        print(f'  markets catalogue: {len(cat)} ids (cached, 0 metered units)')
        return cat
    d, err = api_get('/v4/markets', {'sportId': SPORT_TENNIS}, key)
    if d is None:
        print(f'  markets catalogue FAILED ({err})'); return {}
    rows = d if isinstance(d, list) else (d.get('data') or d.get('markets') or [])
    cat = {}
    for m in rows:
        mid = m.get('id') or m.get('marketId')
        nm = m.get('name') or m.get('marketName')
        if mid is not None and nm:
            cat[str(mid)] = nm
    json.dump(cat, open(CATALOGUE, 'w'))
    print(f'  markets catalogue: {len(cat)} ids (1 metered unit, now cached)')
    return cat


def meter(key, when):
    d, err = api_get('/v4/account', {}, key)
    if d is None:
        print(f'  meter unreadable {when} ({err})'); return None, None
    s = d.get('subscription') or (d.get('subscriptions') or [{}])[0] or {}
    u, l = s.get('request_count'), s.get('request_limit')
    print(f'  oddspapi meter {when}: {u}/{l}')
    return u, l


def main():
    key = read_key()
    now = datetime.now(timezone.utc)
    result = {'generatedAt': now.strftime('%Y-%m-%dT%H:%M:%SZ')}

    print('=== meter ===')
    u0, lim = meter(key, 'before')

    # ---------- A. level mix, one metered window ----------
    print('\n=== A. level mix — 1 metered /v4/fixtures window, last 7 days, all tennis ===')
    frm = (now - timedelta(days=6)).strftime('%Y-%m-%dT00:00:00Z')
    to = now.strftime('%Y-%m-%dT00:00:00Z')
    data, err = api_get('/v4/fixtures', {'sportId': SPORT_TENNIS, 'from': frm, 'to': to}, key)
    if data is None:
        print(f'  FAILED ({err}) — cannot project without the level mix'); sys.exit(1)
    rows = data if isinstance(data, list) else (data.get('data') or data.get('fixtures') or [])
    mix = collections.Counter()
    pool = collections.defaultdict(list)
    for f in rows:
        cat = (f.get('categoryName') or 'unknown')
        if 'Simulated' in cat or 'Srl' in cat:   # synthetic, excluded everywhere
            continue
        mix[cat] += 1
        st = epoch(f.get('trueStartTime')) or epoch(f.get('startTime'))
        if st is None or st > now.timestamp(): continue
        age = (now.timestamp() - st) / 86400.0
        if 4 <= age <= 9:
            pool[cat].append((f.get('fixtureId'), st, f.get('tournamentName')))
    days = 6.0
    print(f'  {sum(mix.values())} non-synthetic tennis fixtures over {days:.0f} days '
          f'= {sum(mix.values())/days:.0f}/day')
    for k, v in mix.most_common():
        print(f'    {k:<28} {v:>6}  ({v/days:>6.1f}/day)')
    result['levelMix'] = dict(mix)
    result['windowDays'] = days

    # ---------- B. pre-start density on the keep-list ----------
    print(f'\n=== B. pre-start density, keep-list only, fixtures aged 4-9d '
          f'({PER_LEVEL}/level, free calls) ===')
    names = market_names(key)
    cat_rows, calls, skipped = collections.defaultdict(list), 0, collections.Counter()
    for cat in sorted([c for c in pool if c in DENSITY_LEVELS], key=lambda c: -mix[c]):
        picks = sorted(pool[cat], key=lambda t: str(t[0]))[::max(1, len(pool[cat]) // PER_LEVEL)][:PER_LEVEL]
        for fid, st, tourn in picks:
            d, e = api_get('/v4/historical-odds', {'fixtureId': fid, 'bookmakers': BOOK}, key)
            calls += 1; time.sleep(SLEEP)
            if d is None:
                skipped[f'{cat}:http-{e}'] += 1; continue
            blk = ((d or {}).get('bookmakers') or {}).get(BOOK)
            if not isinstance(blk, dict):
                skipped[f'{cat}:no-bet365'] += 1; continue
            pre = ip = 0
            for mid, m in (blk.get('markets') or {}).items():
                if not isinstance(m, dict): continue
                name = names.get(str(mid), '')
                if not any(fn(name) for fn in KEEP_FAMILIES.values()): continue
                for oc in (m.get('outcomes') or {}).values():
                    for plist in ((oc or {}).get('players') or {}).values():
                        for p in (plist or []):
                            t = epoch(p.get('createdAt'))
                            if t is None or p.get('price') is None: continue
                            if t <= st: pre += 1
                            else: ip += 1
            if pre == 0 and ip == 0:
                skipped[f'{cat}:no-keeplist-ticks'] += 1; continue
            cat_rows[cat].append({'fid': fid, 'pre': pre, 'inplay': ip, 'tourn': tourn})
            print(f'  {cat:<14} {fid} pre-start={pre:>5} in-play={ip:>6}', flush=True)

    print('\n  per level:')
    dens = {}
    for cat, rs in cat_rows.items():
        p = [r['pre'] for r in rs]
        dens[cat] = statistics.median(p)
        flag = '  <-- n<30' if len(rs) < 30 else ''
        print(f'    {cat:<14} n={len(rs)} median pre-start rows/fixture = {statistics.median(p):>7.0f} '
              f'(min {min(p)}, max {max(p)}){flag}')
    result['density'] = {k: {'n': len(v), 'median_pre': dens[k],
                             'rows': v} for k, v in cat_rows.items()}
    result['skipped'] = dict(skipped)

    # ---------- projection ----------
    print('\n=== PROJECTION — pre-start only, keep-list only, 377.7 B/row ===')
    GROUPS = [
        ('(a) ATP tour + Slams',        ['ATP']),
        ('(b) (a) + Challengers',       ['ATP', 'Challenger']),
        ('(c) (b) + ITF',               ['ATP', 'Challenger']),   # ITF cats appended below
    ]
    itf_cats = [c for c in mix if 'ITF' in c or 'Futures' in c]
    GROUPS[2] = ('(c) (b) + ITF', ['ATP', 'Challenger'] + itf_cats)
    print(f'  ITF categories seen in the window: {itf_cats or "NONE"}')

    fallback = statistics.median(list(dens.values())) if dens else 0
    budget_gb = DB_GB * BUDGET_FRACTION
    print(f'\n  {"option":<26} {"fix/day":>8} {"fix/yr":>9} {"rows/yr":>13} '
          f'{"GB/yr":>8} {"backfill GB":>12}  verdict (line = {budget_gb:.1f} GB/yr)')
    proj = {}
    for label, cats in GROUPS:
        fx_day = sum(mix.get(c, 0) for c in cats) / days
        rows_yr = sum(mix.get(c, 0) / days * 365.0 * dens.get(c, fallback) for c in cats)
        gb_yr = rows_yr * ROW_BYTES / 1e9
        # backfill = the ~180d window that still exists, but decayed: the decay
        # work measured median pre-start survivors at 2-4 months, so the
        # backfill is NOT gb_yr/2. Scale by measured survivor ratio instead.
        gb_backfill = gb_yr * (180.0 / 365.0) * DECAY_SURVIVOR
        ok = 'OK' if gb_yr <= budget_gb else f'OVER by {gb_yr - budget_gb:.2f} GB'
        print(f'  {label:<26} {fx_day:>8.1f} {fx_day*365:>9.0f} {rows_yr:>13,.0f} '
              f'{gb_yr:>8.2f} {gb_backfill:>12.2f}  {ok}')
        proj[label] = {'cats': cats, 'fixturesPerDay': fx_day, 'rowsPerYear': rows_yr,
                       'gbPerYear': gb_yr, 'gbBackfill': gb_backfill,
                       'underLine': gb_yr <= budget_gb}
    result['projection'] = proj
    result['budgetGbPerYear'] = budget_gb
    result['rowBytes'] = ROW_BYTES

    print('\n=== meter ===')
    u1, _ = meter(key, 'after')
    result['meter'] = {'before': u0, 'after': u1, 'limit': lim}
    result['freeCalls'] = calls
    json.dump(result, open(OUT, 'w'), indent=1)
    print(f'\nwrote {OUT}  ({calls} free /v4/historical-odds calls, '
          f'{(u1 - u0) if (u0 is not None and u1 is not None) else "?"} metered units)')


# Measured on this run's decay work: median pre-start ticks surviving at 2-4
# months vs a fresh fixture. Set from ten225-decay-probe.json rather than
# guessed; see the report. 9/15.5 at 2 months, 4/15.5 at 4 months -> ~0.42 mean
# over a 180-day window that is mostly older than 2 months.
DECAY_SURVIVOR = 0.42

if __name__ == '__main__':
    main()
