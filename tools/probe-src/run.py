# READ-ONLY probe (branch only). Step 2 of the founder brief 2026-10-19: which source is closest to a REAL Pinnacle close on
# ATP qualifying, Challenger main draw and Challenger qualifying, from 17 Sep 2026. SportsAPI365: hard cap 36 requests.
import json, os, sys, csv, re, glob, gzip, statistics, collections, unicodedata, datetime as dt, urllib.request, urllib.parse, time, importlib.util
sys.path.insert(0, 'tools')
spec = importlib.util.spec_from_file_location('pinarch', 'tools/pinarch.py'); P = importlib.util.module_from_spec(spec); spec.loader.exec_module(P)
EX = json.load(open('pc.json'))['rows']
LV = {'atp-q': 'ATP qualifying', 'ch': 'Challenger main draw', 'ch-q': 'Challenger qualifying'}
C = []; ORIENT_SKIP = []
for e in EX:
    a = e.get('apiTennis') or {}
    lv = P.lower_level(a) if a else None
    if lv not in LV or e['date'] < '2026-09-17': continue
    if a.get('event_winner') not in ('First Player', 'Second Player') or 'walk' in str(a.get('event_status') or '').lower(): continue
    fw = a['event_winner'] == 'First Player'          # api-tennis Home = its first player
    wn = a.get('event_first_player') if fw else a.get('event_second_player')
    p1w = P.same_surname(e['p1Name'], wn); p2w = P.same_surname(e['p2Name'], wn)
    if p1w == p2w: ORIENT_SKIP.append(e.get('eventKey')); continue
    C.append({'date': e['date'], 'lv': LV[lv], 'ek': str(e.get('eventKey')), 'fw': fw, 'label': e.get('label'),
              'w': e['p1Name'] if p1w else e['p2Name'], 'l': e['p2Name'] if p1w else e['p1Name'],
              'cw': float(e['p1'] if p1w else e['p2']), 'cl': float(e['p2'] if p1w else e['p1']), 'start': e.get('startTs'), 'src': e.get('startSource')})
print('### closes', json.dumps({'n': len(C), 'orientUnclear': len(ORIENT_SKIP), 'byLevel': collections.Counter(c['lv'] for c in C), 'byLabel': collections.Counter(c['label'] for c in C),
                               'byStartSource': collections.Counter(c['src'] for c in C), 'dates': [min(c['date'] for c in C), max(c['date'] for c in C)]}))
def at(p):
    u = 'https://api.api-tennis.com/tennis/?' + urllib.parse.urlencode({**p, 'APIkey': os.environ['API_TENNIS_KEY']})
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'probe'}), timeout=90) as r: return json.loads(r.read())
        except Exception as e: err = e
    return {}
def fl(v):
    try: f = float(v); return f if f >= 1.01 else None
    except Exception: return None
days = sorted({c['date'] for c in C} | {(dt.date.fromisoformat(c['date']) - dt.timedelta(days=1)).isoformat() for c in C})
OD = {}
import concurrent.futures as cf
with cf.ThreadPoolExecutor(8) as ex:
    for res in ex.map(lambda d: at({'method': 'get_odds', 'date_start': d, 'date_stop': d}).get('result') or {}, days):
        if isinstance(res, dict):
            for k, v in res.items(): OD[str(k)] = (v or {}).get('Home/Away') or {}
S = collections.defaultdict(dict)   # source -> ek -> (winner price, loser price)
for c in C:
    ha = OD.get(c['ek']) or {}; H, A = ha.get('Home') or {}, ha.get('Away') or {}
    for b, name in (('Pncl', 'api-tennis Pinnacle'), ('bet365', 'api-tennis Bet365')):
        h, a_ = fl(H.get(b)), fl(A.get(b))
        if h and a_: S[name][c['ek']] = (h, a_) if c['fw'] else (a_, h)
# captured Bet365 (bet365-history): both surnames, start within 36 h of the close's start, exactly one fixture
def nrm(s): return unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode().lower()
def sur_td(n): return re.sub(r'\s+([a-z]{1,3}\.)+$', '', nrm(n).replace('-', ' ')).strip().split()
def sur_b(n): return nrm(n).split(',')[0].replace('-', ' ').split()
B = []
for f in glob.glob('bet365-history/2026-0[9].json') + glob.glob('bet365-history/2026-1*.json'):
    for fid, x in (json.load(open(f)).get('fixtures') or {}).items(): B.append(x)
def ts(s):
    try: return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00')).timestamp()
    except Exception: return None
def last(series, cut): 
    v = [p for t, p in series if t <= cut]; return v[-1] if v else None
for c in C:
    st = ts(c['start'])
    if st is None: continue
    w, l = P.td_name(c['w']), P.td_name(c['l'])
    hit = []
    for x in B:
        if abs((x.get('start') or 0) - st) > 36 * 3600: continue
        a, b = sur_b(x['p1']), sur_b(x['p2'])
        if sur_td(w) == a and sur_td(l) == b: hit.append((x, True))
        elif sur_td(w) == b and sur_td(l) == a: hit.append((x, False))
    if len(hit) == 1:
        x, o = hit[0]; cut = x['start']
        p1, p2 = last(x['s1'], cut), last(x['s2'], cut)
        if p1 and p2 and p1 >= 1.01 and p2 >= 1.01: S['captured Bet365'][c['ek']] = (p1, p2) if o else (p2, p1)
# SportsAPI365: the free key, hard cap 36 requests (the founder: ~40 left this month). The key never prints.
KEY = os.environ.get('SPORTSAPI365_KEY', ''); CAP = 36 if 's365' in open('tools/probe-src/trigger').read() else 0; USED = 0; LOG = []
def s365(path):
    global USED
    if USED >= CAP: return None
    USED += 1
    req = urllib.request.Request('https://api.sportsapi365.com/v1/tennis' + path, headers={'X-Gravitee-Api-Key': KEY, 'Accept': 'application/json', 'User-Agent': 'curl/8.5.0'})
    try:
        r = urllib.request.urlopen(req, timeout=40); st, body = r.status, r.read().decode('utf8', 'replace')
    except urllib.error.HTTPError as e: st, body = e.code, e.read().decode('utf8', 'replace')
    except Exception as e: st, body = 0, str(e)[:200]
    LOG.append((USED, path.split('?')[0], st, len(body))); time.sleep(0.5)
    try: return json.loads(body)
    except Exception: return None
def full_sur(n): return nrm(n).replace('-', ' ').split()
def fits(full, tdn):
    s = sur_td(tdn); w = full_sur(full)
    return bool(s) and ' '.join(s) in ' '.join(w)
byday = collections.Counter(c['date'] for c in C)
# 14 days spread over the window, busiest first within each third
alld = sorted(byday)
pick = sorted(sorted(alld, key=lambda d: -byday[d])[:14])
rows = {}
for d in pick:
    j = s365(f'/atp/results/{d}?pageSize=500&pageNo=1')
    for r in (j or {}).get('data') or []:
        r['_d'] = d; rows[str(r.get('matchId'))] = r
    if j is not None and (j or {}).get('hasNextPage'): print('note: more than one results page on', d)
M = {}
for c in C:
    if c['date'] not in pick: continue
    cand = [r for r in rows.values() if r['_d'] == c['date'] and '/' not in str((r.get('player1') or {}).get('name'))
            and fits((r.get('player1') or {}).get('name'), P.td_name(c['w'])) and fits((r.get('player2') or {}).get('name'), P.td_name(c['l']))]
    if len(cand) == 1: M[c['ek']] = cand[0]
for ek, r in M.items():
    a, b = fl(r.get('odd1')), fl(r.get('odd2'))
    if a and b: S['SportsAPI365 Marathonbet (results row)'][ek] = (a, b)
left = [ek for ek in M][: max(0, CAP - USED)]
for ek in left:
    r = M[ek]; j = s365(f"/matches/{r['matchId']}/odds?type=atp&source=game")
    for o in (j or {}).get('odds') or []:
        a, b = fl(o.get('k1')), fl(o.get('k2'))
        if not (a and b): continue
        i1 = str(o.get('id1_o'))
        pr = (a, b) if i1 == str(r.get('player1Id')) else (b, a) if i1 == str(r.get('player2Id')) else None
        if pr and o.get('bookmaker') in ('Pinnacle', 'Marathonbet'): S['SportsAPI365 ' + o['bookmaker'] + ' (per match)'][ek] = pr
print('### sportsapi365', json.dumps({'requestsUsed': USED, 'cap': CAP, 'calls': LOG, 'daysRead': pick, 'closesOnThoseDays': sum(byday[d] for d in pick), 'joined': len(M)}))
# per source: coverage, exact (2 dp both sides), within 0.05 both sides, median no-vig gap, largest gaps — vs the real close
def nv(a, b): return (1 / a) / (1 / a + 1 / b)
CB = {c['ek']: c for c in C}
out = {}
for name, d in S.items():
    for lv in ['all'] + list(LV.values()):
        cs = [c for c in C if lv == 'all' or c['lv'] == lv]
        base = [c for c in cs if not name.startswith('SportsAPI365') or c['date'] in pick]
        xs = [(c, d[c['ek']]) for c in base if c['ek'] in d]
        if not xs: out[(name, lv)] = {'n': 0, 'of': len(base)}; continue
        g = sorted(((abs(nv(c['cw'], c['cl']) - nv(*p)) * 100, c, p) for c, p in xs), key=lambda z: z[0])
        out[(name, lv)] = {'n': len(xs), 'of': len(base), 'exact': sum(1 for c, p in xs if round(c['cw'], 2) == round(p[0], 2) and round(c['cl'], 2) == round(p[1], 2)),
                           'within0.05': sum(1 for c, p in xs if abs(c['cw'] - p[0]) <= 0.05 + 1e-9 and abs(c['cl'] - p[1]) <= 0.05 + 1e-9),
                           'medianNoVigPp': round(statistics.median([z[0] for z in g]), 2), 'p90': round(g[int(0.9 * (len(g) - 1))][0], 2),
                           'largest': [f"{z[1]['date']} {z[1]['w']} d. {z[1]['l']} close {z[1]['cw']}/{z[1]['cl']} vs {z[2][0]}/{z[2][1]} ({z[0]:.1f}pp)" for z in g[-3:]]}
for k, v in sorted(out.items()): print('SRC', json.dumps({'source': k[0], 'level': k[1], **v}, ensure_ascii=False))
