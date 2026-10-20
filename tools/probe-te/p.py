# read-only probe (writes nothing): Sakamoto v Goncalves fixture; api-tennis birthdays for the players named in item 4
import json, os, urllib.request, urllib.parse
K = os.environ['API_TENNIS_KEY']
def at(**q):
    q['APIkey'] = K; q.setdefault('timezone', 'UTC')
    with urllib.request.urlopen('https://api.api-tennis.com/tennis/?' + urllib.parse.urlencode(q), timeout=60) as r: return json.load(r)
c = json.load(open('st/te-odds/calib-01.json'))
r = [x for x in c['rows'] if 'Sakamoto' in x['a'] + x['b'] and 'Goncalves' in x['a'] + x['b']][0]
print('calib-01 target:', json.dumps({k: r.get(k) for k in ('ek', 'level', 'date', 'a', 'b', 'ka', 'kb', 'status')}))
F = at(method='get_fixtures', date_start=r['date'], date_stop=r['date'], event_key=r['ek']).get('result') or []
for f in F:
    print('fixture:', json.dumps({k: f.get(k) for k in ('event_key', 'event_date', 'event_time', 'event_type_type', 'tournament_name', 'tournament_key', 'tournament_round', 'event_qualification', 'event_first_player', 'event_second_player', 'first_player_key', 'second_player_key', 'event_status', 'event_final_result')}))
for d in (r['date'],):
    day = at(method='get_fixtures', date_start=d, date_stop=d).get('result') or []
    hit = [f for f in day if any(n in (f.get('event_first_player') or '') + (f.get('event_second_player') or '') for n in ('Sakamoto', 'Alves'))]
    for f in hit: print('same day:', json.dumps({k: f.get(k) for k in ('event_key', 'event_type_type', 'tournament_name', 'tournament_round', 'event_first_player', 'event_second_player', 'first_player_key', 'second_player_key', 'event_status')}))
for k in (r['ka'], r['kb'], 14638, 1860, 69562, 67442, 38273):
    p = (at(method='get_players', player_key=k).get('result') or [{}])[0]
    print('player', k, json.dumps({x: p.get(x) for x in ('player_key', 'player_name', 'player_full_name', 'player_country', 'player_bday')}))
