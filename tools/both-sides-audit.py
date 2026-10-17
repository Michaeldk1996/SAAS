#!/usr/bin/env python3
"""Both-sides price audit (founder ruling 2026-10-17, item 3) — a REPORT, it writes nothing.

Every completed ATP main-draw match, 2010 to yesterday, and whether the Database prices it on BOTH sides from ONE source
(the existing order: Tennis-Data Pinnacle > our archive close > start - 10 > api-tennis Pinnacle (approx.) > Bet365; the
builder, build-database-yield.js, makes the pick — this script only reads its output). Per year: matches checked, priced
before, priced after, fixed (priced after, not before), still missing, each still-missing match with its reason.

  universe 2010 .. Tennis-Data's last day : every row of odds-archive/{yyyy}.csv (Tennis-Data = ATP main draw)
  universe after Tennis-Data's last day   : api-tennis get_fixtures 'Atp Singles', not qualifying, status Finished /
                                            Retired / Walk Over (needs API_TENNIS_KEY; else that part is skipped OUT LOUD)
  priced                                  : the match is a row of database-yield.json rows / retRows / tieRows

Usage: python3 tools/both-sides-audit.py --before <dir with database-yield*.json> --after <dir> [--feed pinnacle-archive-td.csv]
       [--approx pinnacle-approx.csv] [--json out.json]
A missing side is never filled here: the reasons say what each source holds."""
import argparse, collections, csv, datetime as dt, glob, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import pinarch as P

ap = argparse.ArgumentParser()
ap.add_argument('--before', required=True); ap.add_argument('--after', required=True)
ap.add_argument('--feed', default=os.path.join(ROOT, 'pinnacle-archive-td.csv'))
ap.add_argument('--approx', default=os.path.join(ROOT, 'pinnacle-approx.csv'))
ap.add_argument('--json', default=None); ap.add_argument('--examples', type=int, default=12)
A = ap.parse_args()

def price(v):
    try: x = float(v)
    except (TypeError, ValueError): return None
    return x if 1.01 <= x <= 1000 else None

def store_keys(d):
    b = json.load(open(os.path.join(d, 'database-yield.json'))); n = json.load(open(os.path.join(d, 'database-yield-players.json')))
    T = b['meta']['tournaments']; out = {}
    for rk, nk in (('rows', 'names'), ('retRows', 'retNames'), ('tieRows', 'tieNames')):
        for x, nm in zip(b.get(rk) or [], n.get(nk) or []):
            s = str(x[0]); t = x[4] if isinstance(x[4], str) else T[x[4]]
            out[f'{s[:4]}-{s[4:6]}-{s[6:8]}|{t}|{nm[0]}|{nm[1]}'] = x[8]
    return out, b['meta']

before, _ = store_keys(A.before)
after, meta = store_keys(A.after)
BOOK = {0: 'Tennis-Data Pinnacle', 1: 'Bet365', 2: 'Pinnacle (approx.) api-tennis', 3: 'Pinnacle history', 4: 'Pinnacle captured', 5: 'Pinnacle (approx.) start - 10'}

def read_csv(p):
    return list(csv.DictReader(open(p))) if p and os.path.exists(p) else []
feed = read_csv(A.feed)
ov = {'|'.join([r['date'], r['tournament'], r['winner'], r['loser']]): (price(r['psw']), price(r['psl'])) for r in feed if r['kind'] == 'override'}
adds = [r for r in feed if r['kind'] == 'add']
apx = collections.defaultdict(dict)
for r in read_csv(A.approx):
    apx['|'.join([r['date'], r['tournament'], r['winner'], r['loser']])][r['source']] = (price(r['psw']), price(r['psl']))

Y = collections.defaultdict(lambda: {'checked': 0, 'pricedBefore': 0, 'pricedAfter': 0, 'fixed': 0, 'missing': 0, 'reasons': collections.Counter()})
EX = collections.defaultdict(list); FIXED = []
def ex(reason, row):
    if len(EX[reason]) < A.examples: EX[reason].append(row)

td_last = ''
for f in sorted(glob.glob(os.path.join(ROOT, 'odds-archive', '*.csv'))):
    yr = os.path.basename(f)[:4]
    if not yr.isdigit() or int(yr) < 2010: continue
    for r in csv.DictReader(open(f)):
        d = r['date'].strip(); k = '|'.join([d, r['tournament'].strip(), r['winner'].strip(), r['loser'].strip()])
        td_last = max(td_last, d)
        y = Y[d[:4]]; y['checked'] += 1
        b, a = k in before, k in after
        y['pricedBefore'] += b; y['pricedAfter'] += a
        if a and not b: y['fixed'] += 1; FIXED.append({'match': k, 'book': BOOK.get(after[k])})
        if a: continue
        y['missing'] += 1
        com = r['comment'].strip()
        sides = {'Tennis-Data Pinnacle': (price(r['psw']), price(r['psl'])), 'Bet365': (price(r['b365w']), price(r['b365l']))}
        if k in ov: sides['our archive close'] = ov[k]
        for s, v in apx.get(k, {}).items(): sides[s] = v
        both = [s for s, v in sides.items() if v[0] and v[1]]
        one = [s for s, v in sides.items() if bool(v[0]) != bool(v[1])]
        if com == 'Walkover': why = 'walkover (no match played)'
        elif com not in ('Completed', 'Retired', 'Rrtired'): why = f'not a result ({com or "blank comment"})'
        elif both:
            pw, pl = sides[both[0]]
            why = 'priced on both sides but voided by the Database overround rule (1/pw + 1/pl > 1.15)' if 1 / pw + 1 / pl > 1.15 else 'both sides exist but the Database did not take the row (see its meta.exclusions)'
        elif one: why = 'no source has both sides (one side only: ' + ', '.join(one) + ')'
        else: why = 'no source has a price'
        y['reasons'][why] += 1
        ex(why, {'match': k, 'sides': {s: v for s, v in sides.items() if v[0] or v[1]}})

# after Tennis-Data's last day: api-tennis is the universe
post = {'from': None, 'to': None, 'skipped': None}
key = os.environ.get('API_TENNIS_KEY')
day0 = (dt.date.fromisoformat(td_last) + dt.timedelta(days=1)) if td_last else None
yday = dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=1)
TEAM = re.compile(r'Davis Cup|Laver Cup|United Cup|ATP Cup|Hopman', re.I)
if not key: post['skipped'] = 'API_TENNIS_KEY not set: matches after Tennis-Data\'s last day NOT checked'
elif day0 and day0 <= yday:
    post['from'], post['to'] = day0.isoformat(), yday.isoformat()
    by_day = collections.defaultdict(list)
    for k in after:
        d, t, w, l = k.split('|'); by_day[d].append((k, w, l))
    kb = collections.defaultdict(list)
    for k in before:
        d, t, w, l = k.split('|'); kb[d].append((k, w, l))
    def find(idx, f, wn, ln, wk, lk):
        d = dt.date.fromisoformat(f['event_date']); hits = []
        for dd in (d - dt.timedelta(days=1), d, d + dt.timedelta(days=1)):
            hits += [k for k, w, l in idx.get(dd.isoformat(), []) if P.same_player(w, wn, wk) and P.same_player(l, ln, lk)]
        return hits[0] if len(hits) == 1 else None
    d = day0
    while d <= yday:
        fx = P.apitennis_day(d.isoformat(), key)
        if fx is None: post.setdefault('daysFailed', []).append(d.isoformat()); d += dt.timedelta(days=1); continue
        for f in fx.values():
            if f.get('event_type_type') != 'Atp Singles' or str(f.get('event_qualification')) == 'True': continue
            st = f.get('event_status') or ''
            if st not in ('Finished', 'Retired', 'Walk Over'): continue
            win = f.get('event_winner'); fp, sp = f.get('event_first_player'), f.get('event_second_player')
            fk, sk = f.get('first_player_key'), f.get('second_player_key')
            wn, ln, wk, lk = (fp, sp, fk, sk) if win == 'First Player' else (sp, fp, sk, fk) if win == 'Second Player' else (None, None, None, None)
            y = Y[f['event_date'][:4]]; y['checked'] += 1
            row = {'match': f"{f['event_date']} {f.get('tournament_name')} {fp} v {sp}", 'eventKey': f.get('event_key'), 'status': st}
            a = find(by_day, f, wn, ln, wk, lk) if wn else None; b = find(kb, f, wn, ln, wk, lk) if wn else None
            y['pricedBefore'] += bool(b); y['pricedAfter'] += bool(a)
            if a and not b: y['fixed'] += 1; FIXED.append({'match': a, 'book': BOOK.get(after[a])})
            if a: continue
            y['missing'] += 1
            if st == 'Walk Over': why = 'walkover (no match played)'
            elif TEAM.search(f.get('tournament_name') or ''): why = 'team event (no Tennis-Data edition, the Database holds none)'
            elif not wn: why = 'no winner on record'
            else: why = 'after Tennis-Data\'s last day: no close in our Pinnacle archive (no other source in the order holds it)'
            y['reasons'][why] += 1; ex(why, row)
        d += dt.timedelta(days=1)

out = {'tennisDataLastDay': td_last, 'post': post, 'feedAdds': len(adds),
       'years': {k: dict(v, reasons=dict(v['reasons'])) for k, v in sorted(Y.items())},
       'fixed': FIXED[:200], 'fixedTotal': len(FIXED), 'examples': EX}
tot = collections.Counter()
for v in Y.values():
    for k in ('checked', 'pricedBefore', 'pricedAfter', 'fixed', 'missing'): tot[k] += v[k]
out['total'] = dict(tot)
print('### both-sides-audit', json.dumps({k: out[k] for k in ('tennisDataLastDay', 'post', 'total', 'fixedTotal')}))
for yr, v in sorted(Y.items()):
    print(f"{yr}: checked {v['checked']} · priced before {v['pricedBefore']} · after {v['pricedAfter']} · fixed {v['fixed']} · still missing {v['missing']}  {json.dumps(dict(v['reasons']))}")
print('fixed:', json.dumps(collections.Counter(x['book'] for x in FIXED)))
for why, rows in EX.items():
    print('EXAMPLES', why); [print('   ', json.dumps(r)) for r in rows]
if A.json: json.dump(out, open(A.json, 'w'), indent=1)
