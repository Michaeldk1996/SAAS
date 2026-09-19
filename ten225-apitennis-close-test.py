#!/usr/bin/env python3
"""TEN-225 item J — is api-tennis's stored last-pre-match price usable as a Close?

Founder 2026-09-19: "J: the api-tennis Close test. They keep the last price
received before start for all 17 books. Test it against the Closes we trust
(oddspapi bet365 close, Kibl last pre-start tick) on 30 finished fixtures across
ATP / Challenger / Davis Cup, per book coverage %, price and
implied-probability deltas, n."

WHAT API-TENNIS ACTUALLY PROMISED (their reply, verbatim, 2026-09-18): no
timestamps on any price; odds refreshed at least every 30 minutes; opening odds
NOT stored; "they store and display the LATEST ODDS RECEIVED BEFORE THE MATCH
STARTS". That last clause is the whole hypothesis: it is the definition of a
Close, minus the timestamp.

⚠️ WHAT THIS TEST CAN AND CANNOT SHOW.
  * It CAN show whether a price comes back for a finished fixture at all, per
    book and per level, and how far it sits from a Close we already trust.
  * It CANNOT show WHEN that price was taken, because the feed carries no
    timestamp. So agreement is evidence, not proof: a price that happens to
    equal our close is consistent with "last pre-match" and also with "a price
    from two hours earlier that never moved". The 60-minute lag limb we apply to
    every other Close is unavailable here by construction, and that is the
    honest limit of what adopting this would buy.

THE TRUSTED SIDE is `closingOdds` on the DEPLOYED matches.json — the pipeline's
pinned pre-play close (TEN-124: never a live price, never another book). Read
from the deployed artefact, not the checkout, which is a cron-refreshed stub.

Free on both sides: api-tennis get_odds is bulk-by-date on Ultra, and the
deployed JSON is a static fetch. Zero oddspapi units.
"""
import json
import sys
import time
import urllib.request
from collections import defaultdict

BASE = 'https://api.api-tennis.com/tennis/'
DEPLOYED = 'https://michaeldk1996.github.io/SAAS'
REPO = '/Users/Michael/bsp-consult-project'

sys.path.insert(0, REPO)
from book_names import canon, display  # noqa: E402


def key():
    for line in open(f'{REPO}/.env'):
        if line.startswith('API_TENNIS_KEY='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")
    raise SystemExit('::error::API_TENNIS_KEY not found')


def get(url, tries=3):
    for a in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=90) as r:
                return json.load(r)
        except Exception:
            time.sleep(3 * (a + 1))
    return None


def level_of(tour):
    s = (tour or '').lower()
    if 'davis cup' in s:
        return 'Davis Cup'
    if 'challenger' in s:
        return 'Challenger'
    if 'itf' in s or s.startswith('m15') or s.startswith('m25'):
        return 'ITF'
    if 'wta' in s:
        return 'WTA'
    return 'ATP'


def implied(a, b):
    """Vig-free implied probability of side a. None when either leg is absent."""
    if not (isinstance(a, (int, float)) and isinstance(b, (int, float))
            and a > 0 and b > 0):
        return None
    ia, ib = 1.0 / a, 1.0 / b
    return ia / (ia + ib)


def pct(n, d):
    return f'{100.0 * n / d:5.1f}%' if d else '    -'


def main():
    k = key()
    ms = get(f'{DEPLOYED}/matches.json')
    if not ms:
        print('::error::could not fetch the deployed matches.json'); return 1
    arr = ms['matches'] if isinstance(ms, dict) and 'matches' in ms else ms

    done = [m for m in arr if m.get('finalScore') and m.get('date')]
    trusted = [m for m in done
               if (m.get('closingOdds') or {}).get('p1', 0) > 0
               and (m.get('closingOdds') or {}).get('p2', 0) > 0]
    print(f'deployed matches.json: {len(arr)} fixtures · finished {len(done)} · '
          f'with a TRUSTED close {len(trusted)}')
    if not trusted:
        print('::warning::no finished fixture carries a pinned close — NOTHING was '
              'assessed. This is not "api-tennis has no close".')
        return 1

    by_lvl = defaultdict(list)
    for m in trusted:
        by_lvl[level_of(m.get('tour'))].append(m)
    print('  trusted closes by level: '
          + ', '.join(f'{lv}={len(v)}' for lv, v in sorted(by_lvl.items())))

    # One get_odds call per distinct finished DAY — bulk-by-date, so 30 fixtures
    # cost a handful of calls rather than 30.
    days = sorted({m['date'] for m in trusted})
    odds_by_day = {}
    for d in days:
        r = get(f'{BASE}?method=get_odds&APIkey={k}&date_start={d}&date_stop={d}')
        if r is None or not isinstance(r.get('result'), dict):
            print(f'  ::warning::{d}: get_odds failed — that day is EXCLUDED '
                  f'rather than counted as "no close"')
            continue
        odds_by_day[d] = r['result']
    print(f'  get_odds days fetched: {len(odds_by_day)} of {len(days)}  '
          f'({len(days) - len(odds_by_day)} excluded)')

    # ── (a) does a price come back AFTER the match finished, per book? ───────
    cover = defaultdict(int)              # book -> fixtures with BOTH legs
    cover_lvl = defaultdict(lambda: defaultdict(int))
    seen_fix, seen_lvl = 0, defaultdict(int)
    paired = []                           # (m, book, at_p1, at_p2)
    for m in trusted:
        day = odds_by_day.get(m['date'])
        if day is None:
            continue
        ek = str(m.get('id', '')).split('-')[-1]
        entry = day.get(ek)
        seen_fix += 1
        lvl = level_of(m.get('tour'))
        seen_lvl[lvl] += 1
        if not entry:
            continue
        hw = entry.get('Home/Away') or {}
        home = {canon(b): v for b, v in (hw.get('Home') or {}).items() if v}
        away = {canon(b): v for b, v in (hw.get('Away') or {}).items() if v}
        for b in (set(home) & set(away)):
            try:
                p1, p2 = float(home[b]), float(away[b])
            except (TypeError, ValueError):
                continue
            if not (p1 > 0 and p2 > 0):
                continue
            cover[b] += 1
            cover_lvl[lvl][b] += 1
            paired.append((m, b, p1, p2))

    print('\n' + '=' * 76)
    print('(a) DOES A PRICE COME BACK FOR A FINISHED FIXTURE — per book')
    print('=' * 76)
    print(f'  fixtures assessed: {seen_fix}' + ('   ⚠️ n<30' if seen_fix < 30 else ''))
    if not seen_fix:
        print('  ::warning::nothing assessed'); return 1
    print(f"  {'book':14} {'fixtures':>9} {'coverage':>9}")
    for b, n in sorted(cover.items(), key=lambda x: -x[1]):
        print(f'  {display(b):14} {n:>9} {pct(n, seen_fix):>9}')
    if not cover:
        print('  NONE — api-tennis returns no two-sided price for ANY finished '
              'fixture in this sample. That is the answer to (a).')

    print('\n  by level:')
    for lvl, n in sorted(seen_lvl.items(), key=lambda x: -x[1]):
        cells = [f'{display(b)} {pct(c, n).strip()}'
                 for b, c in sorted(cover_lvl[lvl].items(), key=lambda x: -x[1])[:6]]
        print(f'  {lvl:12} n={n:<4}' + ('  ⚠️ n<30' if n < 30 else '        ')
              + '  ' + (', '.join(cells) or 'no book returns a two-sided price'))

    # ── (b) how far is it from a Close we already trust? ────────────────────
    print('\n' + '=' * 76)
    print('(b) DELTA vs THE PINNED oddspapi/bet365 CLOSE')
    print('=' * 76)
    deltas = defaultdict(list)            # book -> [(dpx, dimp)]
    for m, b, p1, p2 in paired:
        c = m['closingOdds']
        i_at, i_c = implied(p1, p2), implied(c['p1'], c['p2'])
        if i_at is None or i_c is None:
            continue
        deltas[b].append((abs(p1 - c['p1']), abs(i_at - i_c) * 100.0,
                          1 if (p1 == c['p1'] and p2 == c['p2']) else 0))
    if not deltas:
        print('  nothing to compare — see (a).')
    else:
        print(f"  {'book':14} {'n':>4}  {'identical':>9}  "
              f"{'|Δ price| med':>13}  {'|Δ implied| med':>15}  {'p95':>7}")
        for b, ds in sorted(deltas.items(), key=lambda x: -len(x[1])):
            n = len(ds)
            px = sorted(d[0] for d in ds)
            im = sorted(d[1] for d in ds)
            ident = sum(d[2] for d in ds)
            p95 = im[min(n - 1, int(round(0.95 * (n - 1))))]
            print(f'  {display(b):14} {n:>4}{"⚠️" if n < 30 else "  "} '
                  f'{pct(ident, n):>9}  {px[n // 2]:>13.3f}  '
                  f'{im[n // 2]:>14.2f}pp  {p95:>5.2f}pp')

    # ─────────────────────────────────────────────────────────────────────
    # WIDENING — the deployed board is Davis Cup only this week, so ATP and
    # Challenger cannot be measured from it at all. bet365-history/ carries a
    # real bet365 tick series for both, joined to api-tennis by (date, surname
    # keys) with the shared matcher. get_odds DOES answer for past dates
    # (measured: 73-121 priced fixtures/day going back a month), which is what
    # makes this possible at all.
    #
    # ⚠️ THE CUT IS AT the shard's `start`, and on a /1 entry that field is
    # `trueStartTime or startTime` collapsed — the defect fixed at source on
    # 2026-09-18, affecting 3.59% of joinable fixtures. Acceptable for a
    # COMPARISON, where it shifts a handful of reference closes by minutes; it
    # would not be acceptable for a rendered price, and is not used as one.
    import glob
    import ten225_names as NK

    def _cut_close(entry):
        st = entry.get('start')
        if not st:
            return None
        out = []
        for ser in ('s1', 's2'):
            pre = [t for t in (entry.get(ser) or [])
                   if isinstance(t, list) and len(t) == 2 and t[0] < st]
            if not pre:
                return None
            out.append(float(pre[-1][1]))
        return out

    shard_by_day = defaultdict(dict)   # 'YYYY-MM-DD' -> {(k1,k2): (cat, p1, p2)}
    for f in sorted(glob.glob(f'{REPO}/bet365-history/2026-0*.json')):
        try:
            fx = json.load(open(f)).get('fixtures') or {}
        except Exception:
            continue
        for e in fx.values():
            cut = _cut_close(e)
            if not cut:
                continue
            day = time.strftime('%Y-%m-%d', time.gmtime(e['start']))
            k1, k2 = NK.name_key(e.get('p1', '')), NK.name_key(e.get('p2', ''))
            if not k1 or not k2 or k1 == k2:
                continue
            shard_by_day[day][tuple(sorted((k1, k2)))] = (e.get('cat'), k1, cut)

    wide_days = [d for d in sorted(shard_by_day, reverse=True)][:6]
    print('\n' + '=' * 76)
    print('WIDENED SAMPLE — ATP / Challenger, from bet365-history')
    print('=' * 76)
    print(f'  bet365-history days with a cuttable close: {len(shard_by_day)}; '
          f'querying the {len(wide_days)} most recent')
    wcover, wseen = defaultdict(lambda: defaultdict(int)), defaultdict(int)
    wdelta = defaultdict(list)
    for day in wide_days:
        fx = get(f'{BASE}?method=get_fixtures&APIkey={k}&date_start={day}&date_stop={day}')
        od = get(f'{BASE}?method=get_odds&APIkey={k}&date_start={day}&date_stop={day}')
        if not fx or not od or not isinstance(od.get('result'), dict):
            print(f'  ::warning::{day}: a call failed — EXCLUDED, not counted as zero')
            continue
        atk = {}
        for f_ in (fx.get('result') or []):
            a, b = NK.name_key(f_.get('event_first_player', '')), NK.name_key(f_.get('event_second_player', ''))
            if a and b and a != b:
                atk[tuple(sorted((a, b)))] = (str(f_.get('event_key')), a)
        for pair, (cat, s_first, cut) in shard_by_day[day].items():
            hit = atk.get(pair)
            if not hit:
                continue
            lvl = 'ATP' if cat == 'ATP' else ('Challenger' if cat == 'Challenger' else cat)
            wseen[lvl] += 1
            entry = od['result'].get(hit[0])
            if not entry:
                continue
            hw = entry.get('Home/Away') or {}
            home = {canon(b): v for b, v in (hw.get('Home') or {}).items() if v}
            away = {canon(b): v for b, v in (hw.get('Away') or {}).items() if v}
            for b in (set(home) & set(away)):
                try:
                    ap1, ap2 = float(home[b]), float(away[b])
                except (TypeError, ValueError):
                    continue
                if not (ap1 > 0 and ap2 > 0):
                    continue
                wcover[lvl][b] += 1
                # Orient BOTH sides onto the same player before comparing: the
                # api-tennis Home is its first player, the shard's s1 is its p1,
                # and they are not the same player by construction.
                if hit[1] != s_first:
                    ap1, ap2 = ap2, ap1
                ia, ic = implied(ap1, ap2), implied(cut[0], cut[1])
                if ia is not None and ic is not None:
                    wdelta[(lvl, b)].append((abs(ap1 - cut[0]), abs(ia - ic) * 100.0,
                                             1 if (ap1 == cut[0] and ap2 == cut[1]) else 0))
    if not wseen:
        print('  ::warning::no fixture joined across the two sources — NOTHING '
              'assessed. Not "api-tennis has no close".')
    for lvl in sorted(wseen, key=lambda x: -wseen[x]):
        n = wseen[lvl]
        cells = [f'{display(b)} {pct(c, n).strip()}'
                 for b, c in sorted(wcover[lvl].items(), key=lambda x: -x[1])[:7]]
        print(f'  {lvl:12} joined n={n:<5}' + ('⚠️ n<30' if n < 30 else '       ')
              + '  ' + (', '.join(cells) or 'no book returns a two-sided price'))
    print(f"\n  {'level / book':26} {'n':>4}  {'identical':>9}  "
          f"{'|Δ price| med':>13}  {'|Δ implied| med':>15}")
    for (lvl, b), ds in sorted(wdelta.items(), key=lambda x: -len(x[1]))[:14]:
        n = len(ds)
        px = sorted(d[0] for d in ds); im = sorted(d[1] for d in ds)
        print(f'  {lvl + " / " + display(b):26} {n:>4}{"⚠️" if n < 30 else "  "} '
              f'{pct(sum(d[2] for d in ds), n):>9}  {px[n // 2]:>13.3f}  '
              f'{im[n // 2]:>14.2f}pp')

    # ── the bet365-vs-bet365 case, which is the one that decides it ─────────
    b365 = [(m, p1, p2) for m, b, p1, p2 in paired if b == canon('bet365')]
    print(f'\n  bet365 on BOTH sides (the same book, two vendors): n={len(b365)}'
          + ('   ⚠️ n<30' if len(b365) < 30 else ''))
    for m, p1, p2 in b365[:12]:
        c = m['closingOdds']
        i_at, i_c = implied(p1, p2), implied(c['p1'], c['p2'])
        print(f'    api-tennis {p1:>6.3f}/{p2:<6.3f} vs close {c["p1"]:>6.3f}/'
              f'{c["p2"]:<6.3f}  Δimplied '
              f'{"":>1}{(i_at - i_c) * 100 if (i_at and i_c) else float("nan"):+6.2f}pp'
              f'  {m["p1"]} v {m["p2"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
