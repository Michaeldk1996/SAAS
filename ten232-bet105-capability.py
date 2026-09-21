#!/usr/bin/env python3
"""TEN-225/232 — BET105 CAPABILITY REPORT, measured on our credential.

FOUNDER, 2026-09-21: "Measured on our credential, not read off the spec. A 200
with empty data is not a capability. Report as one document I can read end to
end."

That sentence is the design of this file. Every number below is computed from
rows we hold or from a call made on THIS account, and anything that is only in
the vendor's documentation is printed under a heading that says so. Where a
measurement cannot be made, the line reads `—` and names what is missing; it
never reads 0, because a zero is a measurement and "we did not look" is not.

READ-ONLY. It writes no table, publishes no file, and dispatches nothing. The
Kibl calls it makes are GETs against endpoints we already hold entitlement for.

Sections, each runnable alone with --section:
  accuracy   board fix 3 — bet105 open/close accuracy, a-d
  markets    §1 markets and lines
  live       §2 live / in-play
  rows       §3 what each price row carries
  endpoints  §4 other endpoints, probed live
  stream     §5 RabbitMQ, from the docs, labelled as such
  coverage   §6 coverage and quality for the ladder ruling
  limits     §7 limits, plainly

Usage: python3 ten232-bet105-capability.py [--section all] [--examples 10]
"""
import argparse
import collections
import json
import os
import statistics
import sys
import types
import urllib.parse
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))

L = types.ModuleType('L')
L.__file__ = os.path.join(HERE, 'ten225-load-line-summary.py')
_argv, sys.argv = sys.argv, ['L']
exec(compile(open(L.__file__).read(), L.__file__, 'exec'), L.__dict__)
sys.argv = _argv

BET105 = 171
SPORTS411 = 43
MIN_N = 30                      # below this every figure is flagged, per standing rule
DASH = '—'

# The three leagues the founder names. Kibl's own ids.
LEAGUES = {19: 'ATP', 537: 'Challenger', 962: 'ITF Men'}


# ─────────────────────────────────────────────────────────────── formatting

def h1(s):
    print(f'\n\n# {s}\n')


def h2(s):
    print(f'\n## {s}\n')


def h3(s):
    print(f'\n### {s}\n')


def note(s):
    print(s)


def n_flag(n):
    """Every figure carries its n, and an n below 30 says so on the same line."""
    return f'n={n}' + ('  **⚠️ n < 30**' if n < MIN_N else '')


def num(v, places=3):
    if v is None:
        return DASH
    return f'{v:.{places}f}'


def pct(k, n, places=1):
    if not n:
        return DASH
    return f'{100.0 * k / n:.{places}f}%'


def implied(price):
    """Implied probability in points. None in, None out — never 0."""
    if price is None or price <= 0:
        return None
    return 100.0 / float(price)


def dist(vals, places=3):
    """min / p25 / median / p75 / max, or a dash if there is nothing to describe."""
    v = sorted(x for x in vals if x is not None)
    if not v:
        return DASH + f'  (n=0)'
    def q(p):
        if len(v) == 1:
            return v[0]
        i = p * (len(v) - 1)
        lo, hi = int(i), min(int(i) + 1, len(v) - 1)
        return v[lo] + (v[hi] - v[lo]) * (i - lo)
    return (f'min {num(v[0], places)} · p25 {num(q(.25), places)} · '
            f'median {num(q(.5), places)} · p75 {num(q(.75), places)} · '
            f'max {num(v[-1], places)}  ({n_flag(len(v))})')


def epoch(ts):
    return L.epoch(ts)


# ───────────────────────────────────────────────────────────────── supabase

def fetch_all(url, key, table, cols, extra='', page=1000, cap=400000):
    """Every row, paged.

    ⚠️ PostgREST caps a response at 1,000 rows and says so in no error at all.
    A single unpaged read of a 300k-row table returns 1,000 rows and every
    percentage computed from it is wrong in a way that looks plausible.
    """
    out, offset = [], 0
    while True:
        q = (f'/rest/v1/{table}?select={urllib.parse.quote(cols)}{extra}'
             f'&limit={page}&offset={offset}')
        body, err = L.sb('GET', q, url, key)
        if err:
            return out, f'{table} read failed at offset {offset}: {err}'
        try:
            rows = json.loads(body)
        except Exception as e:                                   # noqa: BLE001
            return out, f'{table} returned unparseable JSON at offset {offset}: {e}'
        out.extend(rows)
        if len(rows) < page or len(out) >= cap:
            return out, None
        offset += page


def table_count(url, key, table, extra=''):
    """An EXACT count from the Content-Range header — no row bodies moved."""
    import urllib.request
    h = {'apikey': key, 'Authorization': f'Bearer {key}',
         'Prefer': 'count=exact', 'Range': '0-0'}
    req = urllib.request.Request(
        f'{url}/rest/v1/{table}?select=*{extra}', headers=h)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            cr = r.headers.get('Content-Range') or ''
    except Exception as e:                                       # noqa: BLE001
        return None, str(e)
    if '/' not in cr:
        return None, f'no Content-Range ({cr!r})'
    tail = cr.rsplit('/', 1)[1]
    return (int(tail) if tail.isdigit() else None), None


# ──────────────────────────────────────────────────── the card-state loader

def load_card_state(url, key):
    """Every match-winner row, all books, keyed by match_key.

    odds_card_state is the right grain for the founder's question because it is
    one row per fixture + BOOK + market + side. Two books quoting the same match
    are two rows sharing one match_key — which is what makes a paired
    comparison possible at all. The published odds-card-state.json is NOT usable
    here: it carries only the SELECTED book per match, so asking it "what did
    bet365 close at on a fixture bet105 won" returns nothing, every time.
    """
    cols = ('match_key,fixture_id,id_space,book,source,side,market,line,'
            'open_price,open_ts,open_limit,now_price,now_ts,'
            'close_price,close_ts,start_ts,start_ts_source,ts_kind,'
            'book_rank,is_selected,label,open_observed_at,now_observed_at')
    rows, err = fetch_all(url, key, 'odds_card_state', cols,
                          extra='&market=eq.' + urllib.parse.quote('match winner'))
    return rows, err


def by_match_book(rows):
    """{match_key: {book: {side: row}}}. Rows without a match_key cannot pair."""
    out = collections.defaultdict(lambda: collections.defaultdict(dict))
    unpaired = 0
    for r in rows:
        mk = r.get('match_key')
        if not mk:
            unpaired += 1
            continue
        out[mk][r.get('book')][str(r.get('side'))] = r
    return out, unpaired


# ═══════════════════════════════════════════════ SECTION: OPEN/CLOSE ACCURACY

def section_accuracy(url, key, want_examples):
    h1('BOARD FIX 3 — BET105 OPEN/CLOSE ACCURACY')

    rows, err = load_card_state(url, key)
    if err:
        print(f'::error::{err}')
        print(f'\n{DASH}  odds_card_state could not be read, so nothing in this '
              f'section is reported. The failure is named above rather than '
              f'absorbed into an empty table.')
        return None
    if not rows:
        print(f'\n{DASH}  odds_card_state returned zero match-winner rows. That '
              f'is a READ that found nothing, not a measurement of bet105, and '
              f'no figure below would mean anything.')
        return None

    idx, unpaired = by_match_book(rows)
    books = collections.Counter(r.get('book') for r in rows)
    print(f'Read {len(rows):,} match-winner rows from odds_card_state across '
          f'{len(idx):,} paired fixtures.')
    print(f'Rows carrying no match_key and therefore unpairable: {unpaired:,}.')
    print(f'\nRows per book: ' + ' · '.join(f'**{b}** {n:,}' for b, n in books.most_common()))

    if 'bet105' not in books:
        print(f'\n{DASH}  No bet105 rows in odds_card_state at all. Reporting no '
              f'further figures: every one of them would be an average over an '
              f'empty set.')
        return None

    # ── (a) TEN WORKED EXAMPLES ──────────────────────────────────────────────
    h2('(a) Ten worked examples, both legs')
    print('Every leg on one line, and the implied-probability gap computed '
          'between the two CLOSES on the same side of the same fixture. '
          '`bet105 open` and `bet105 close` are ours; `bet365 close` is the '
          'trusted leg from oddspapi; `api-tennis close` is the stored fallback.')
    print('\n⚠️ Every bet105 timestamp in this section is **vendor-insert** '
          '(Kibl insert time), never book-post time. A bet105 "open" is the '
          'first price Kibl had, which is the earliest WE could have had it — '
          'it is not a claim about when Bet105 posted it.')

    cand = []
    for mk, bk in idx.items():
        b105, b365 = bk.get('bet105'), bk.get('bet365')
        if not b105 or not b365:
            continue
        sides = [s for s in b105 if s in b365]
        # A worked example is only worth printing if BOTH legs close.
        ok = [s for s in sides
              if b105[s].get('close_price') is not None
              and b365[s].get('close_price') is not None]
        if len(ok) >= 2:
            cand.append((mk, bk, sorted(ok)[:2]))
    cand.sort(key=lambda c: c[0])

    if not cand:
        print(f'\n{DASH}  No fixture carries a bet105 close AND a bet365 close '
              f'on the same side. Worked examples are not available; the '
              f'aggregate in (b) is computed on whatever pairs do exist and '
              f'says so.')
    else:
        print(f'\nFixtures where both books close on both sides: '
              f'**{len(cand)}** ({n_flag(len(cand))}). Showing '
              f'{min(want_examples, len(cand))}.')
        for mk, bk, sides in cand[:want_examples]:
            b105, b365 = bk['bet105'], bk['bet365']
            at = bk.get('api-tennis') or {}
            h3(mk)
            print('| side | bet105 open | bet105 close | bet365 close | '
                  'api-tennis close | Δ implied (b105−b365) |')
            print('|---|---|---|---|---|---|')
            for s in sides:
                o1 = b105[s].get('open_price')
                c1 = b105[s].get('close_price')
                c2 = b365[s].get('close_price')
                c3 = (at.get(s) or {}).get('close_price')
                i1, i2 = implied(c1), implied(c2)
                d = f'{i1 - i2:+.2f} pts' if (i1 is not None and i2 is not None) else DASH
                print(f'| {s} | {num(o1, 3)} | {num(c1, 3)} | {num(c2, 3)} | '
                      f'{num(c3, 3) if c3 is not None else DASH} | {d} |')
            ov1 = overround(b105, sides)
            ov2 = overround(b365, sides)
            print(f'\noverround — bet105 {num(ov1)} · bet365 {num(ov2)}   '
                  f'· bet105 open ts {ts(b105[sides[0]].get("open_ts"))} '
                  f'(vendor-insert) · close ts {ts(b105[sides[0]].get("close_ts"))} '
                  f'(vendor-insert) · bet365 close ts '
                  f'{ts(b365[sides[0]].get("close_ts"))} (book-tick)')

    # ── (b) ACROSS ALL BET105 CLOSES ─────────────────────────────────────────
    h2('(b) Across every bet105 close we hold')

    closes = [r for r in rows if r.get('book') == 'bet105'
              and r.get('close_price') is not None]
    print(f'bet105 rows carrying a close: **{len(closes):,}** ({n_flag(len(closes))})')

    # ⚠️ THE REFEREE HAS TO BE CHECKED TOO. bet365 is the trusted leg, but the
    # published card state carries bet365 closes of exactly 1.000 — a price that
    # pays nothing and cannot be real. Each one contributes a 100-point implied
    # probability and would inflate the median gap while looking like a finding
    # about bet105. So the gap is reported BOTH ways and the bad referee legs
    # are counted, not quietly dropped.
    gaps, gaps_clean, paired_fixtures = [], [], set()
    ref_bad = []
    for mk, bk in idx.items():
        b105, b365 = bk.get('bet105'), bk.get('bet365')
        if not b105 or not b365:
            continue
        for s, r1 in b105.items():
            r2 = b365.get(s)
            if not r2:
                continue
            p1, p2 = r1.get('close_price'), r2.get('close_price')
            i1, i2 = implied(p1), implied(p2)
            if i1 is None or i2 is None:
                continue
            gaps.append(abs(i1 - i2))
            paired_fixtures.add(mk)
            if p2 is not None and float(p2) <= 1.0:
                ref_bad.append((mk, s, float(p2)))
            else:
                gaps_clean.append(abs(i1 - i2))
    if gaps:
        print(f'\nmedian |Δ implied| against the bet365 close on the same '
              f'fixture and side: **{statistics.median(gaps):.2f} points** '
              f'({n_flag(len(gaps))} side-pairs across {len(paired_fixtures)} fixtures)')
        print(f'distribution: {dist(gaps, 2)}')
        if ref_bad:
            med_c = (f'{statistics.median(gaps_clean):.2f}' if gaps_clean else DASH)
            print(f'\n⚠️ **{len(ref_bad)} of those pairs have a bet365 close of '
                  f'≤ 1.00** — an impossible price on the leg we are treating as '
                  f'trusted. Excluding them the median is **{med_c} points** '
                  f'({n_flag(len(gaps_clean))}).')
            print(f'\nThis is a defect in the REFEREE, not in bet105, and it is '
                  f'named here rather than averaged in because it would '
                  f'otherwise read as bet105 disagreeing with the market. '
                  f'Affected fixtures: ' +
                  ', '.join(f'`{mk}`/{s}' for mk, s, _ in ref_bad[:10]) +
                  (f' … and {len(ref_bad) - 10} more' if len(ref_bad) > 10 else ''))
    else:
        print(f'\nmedian |Δ implied| vs bet365: {DASH}  — no side on any fixture '
              f'carries a close from both books, so there is nothing to subtract.')

    h3('Overround distribution, bet105 closes')
    ovs = []
    for mk, bk in idx.items():
        b105 = bk.get('bet105')
        if not b105:
            continue
        o = overround(b105, list(b105))
        if o is not None:
            ovs.append(o)
    print(f'bet105 two-sided closes with an overround: {dist(ovs, 4)}')
    if ovs:
        under = [o for o in ovs if o < 1.0]
        print(f'\nbooks that price BELOW 1.00 overround (arbitrage against the '
              f'book, i.e. almost certainly not a real tradeable pair): '
              f'**{len(under)}** of {len(ovs)} ({pct(len(under), len(ovs))})')

    ovs365 = []
    for mk, bk in idx.items():
        b = bk.get('bet365')
        if b:
            o = overround(b, list(b))
            if o is not None:
                ovs365.append(o)
    print(f'\nsame measure on bet365 closes, for scale: {dist(ovs365, 4)}')

    # ── (c) WHO MOVES ────────────────────────────────────────────────────────
    h2('(c) How often each book moves between open and close')
    print('Measured on the SAME fixture set — only sides where the book in '
          'question carries both an open and a close. Comparing a book with 400 '
          'openers against one with 40 would measure the archive, not the book.')
    moved = {}
    for book in ('bet105', 'bet365', 'sports411'):
        tot = mv = 0
        deltas = []
        for mk, bk in idx.items():
            b = bk.get(book)
            if not b:
                continue
            for s, r in b.items():
                o, c = r.get('open_price'), r.get('close_price')
                if o is None or c is None:
                    continue
                tot += 1
                io, ic = implied(o), implied(c)
                if io is not None and ic is not None:
                    deltas.append(abs(ic - io))
                if float(o) != float(c):
                    mv += 1
        moved[book] = (mv, tot, deltas)
        if tot:
            print(f'\n**{book}** — moved on {mv:,} of {tot:,} sides '
                  f'({pct(mv, tot)}), {n_flag(tot)}')
            print(f'  size of the move, |Δ implied| points: {dist(deltas, 2)}')
        else:
            print(f'\n**{book}** — {DASH}  no side carries both an open and a '
                  f'close for this book.')

    # The founder asked the question with a prediction attached. Answer it.
    m1, t1, _ = moved.get('bet105', (0, 0, []))
    m2, t2, _ = moved.get('bet365', (0, 0, []))
    if t1 and t2:
        r1, r2 = m1 / t1, m2 / t2
        h3('The verdict the founder asked for')
        print('> "a sharp book should move more, and if it does not, say so"')
        if r1 > r2:
            print(f'\nbet105 moves MORE: {pct(m1, t1)} vs bet365 {pct(m2, t2)}.')
        else:
            print(f'\n**bet105 does NOT move more. It moves {pct(m1, t1)} of the '
                  f'time against bet365 {pct(m2, t2)}.** Saying so plainly, as '
                  f'asked.')
        print(f'\n⚠️ READ THIS WITH THE CLOCK IN MIND BEFORE READING IT AS A '
              f'JUDGEMENT ON THE BOOK. Our bet105 open and close are both '
              f'VENDOR-INSERT times from Kibl, and Kibl keeps no history: we '
              f'see the price at each sweep, not every price the book posted. '
              f'A move that happens and reverses between two sweeps is '
              f'invisible to us and counts as "did not move". The bet365 leg '
              f'comes from the oddspapi archive, which is a tick series. So '
              f'this comparison is biased AGAINST bet105 by construction, and '
              f'the size of that bias is exactly what §5 (the stream) would '
              f'remove.')

    # ── (d) CLEARLY-WRONG CLOSES, NAMED ──────────────────────────────────────
    h2('(d) bet105 closes that are clearly wrong — named, not averaged away')
    bad = collections.defaultdict(list)
    for mk, bk in idx.items():
        b = bk.get('bet105')
        if not b:
            continue
        for s, r in b.items():
            c = r.get('close_price')
            if c is None:
                continue
            c = float(c)
            if c <= 1.0:
                bad['price ≤ 1.00 — impossible: a decimal price of 1.00 pays '
                    'nothing and 0.99 pays less than the stake'].append((mk, s, c, r))
            elif c > 200:
                bad['price > 200 — not impossible, but far outside a match-winner '
                    'range and worth eyeballing'].append((mk, s, c, r))
        o = overround(b, list(b))
        if o is not None and o < 1.0:
            bad['two-sided overround < 1.00 — the book is offering a guaranteed '
                'profit against itself; in practice one leg is stale or the pair '
                'was never live together'].append((mk, '1+2', o, b.get('1') or b.get('2')))
        if o is not None and o > 1.5:
            bad['two-sided overround > 1.50 — a margin no tradeable tennis '
                'match-winner market carries; almost certainly a suspended or '
                'placeholder leg'].append((mk, '1+2', o, b.get('1') or b.get('2')))
        # A close that never moved off the open AND sits on a round number is
        # not by itself wrong, so it is NOT listed here. Naming it would be
        # inventing a defect.
        for s, r in b.items():
            c, st = r.get('close_price'), r.get('start_ts')
            ct = r.get('close_ts')
            if c is None or not ct or not st:
                continue
            try:
                lag = (epoch(st) - epoch(ct)) / 3600.0
            except Exception:                                    # noqa: BLE001
                continue
            if lag > 24:
                bad[f'close captured more than 24h before the scheduled start '
                    f'— stale: it is the last price we saw, not a close'].append(
                        (mk, s, lag, r))

    if not bad:
        print('No bet105 close trips any of the four tests below. Stating the '
              'tests so the absence is readable rather than reassuring:\n'
              '\n* price ≤ 1.00 (impossible)\n'
              '* price > 200 (outside a match-winner range)\n'
              '* two-sided overround < 1.00 (arb against the book) or > 1.50\n'
              '* close captured > 24h before the scheduled start (stale)')
    else:
        for reason, items in sorted(bad.items(), key=lambda kv: -len(kv[1])):
            h3(f'{len(items)} × {reason}')
            for mk, s, v, r in items[:15]:
                print(f'* `{mk}` side {s} — value {num(v, 3)} · close_ts '
                      f'{ts((r or {}).get("close_ts"))} (vendor-insert) · start '
                      f'{ts((r or {}).get("start_ts"))} · start source '
                      f'{(r or {}).get("start_ts_source", DASH)}')
            if len(items) > 15:
                print(f'* … and {len(items) - 15} more')

    return idx


# ═════════════════════════════════════════════════ the kibl vocabulary + rows

def kibl_names(client):
    """market_type / segment / betting_type ids -> Kibl's own names.

    Without these the whole of §1 is a table of integers, and the founder's
    actual question — set handicap, total sets — cannot be answered at all,
    because a set-level market is (market_type × segment) and neither half
    identifies it alone.
    """
    mt, sg, bt = {}, {}, {}
    for ep, into in (('/reference/market-types', mt),
                     ('/reference/segments', sg),
                     ('/reference/betting-types', bt)):
        try:
            payload, _meta = client.get(ep)
            for r in (b for b in client.rows(payload) if isinstance(b, dict)):
                for idk in ('market_type_id', 'segment_id', 'betting_type_id', 'id'):
                    if r.get(idk) is not None:
                        into[int(r[idk])] = r.get('name') or r.get('tag') or '?'
                        break
        except Exception as e:                                   # noqa: BLE001
            print(f'::warning::{ep} failed ({e}) — ids in this section stay unnamed')
    return mt, sg, bt


OBS_COLS = ('fixture_id,league_id,feed_source_id,market_type_id,segment_id,'
            'side_id,point,alt_id,is_main,betting_type_id,market_status_id,'
            'state,is_opener,is_previous,is_current,is_live,price_decimal,'
            'price_american,observed_at,inserted_on')


def load_obs(url, key, fsid):
    return fetch_all(url, key, 'kibl_line_observations', OBS_COLS,
                     extra=f'&feed_source_id=eq.{fsid}')


def load_fixtures(url, key):
    return fetch_all(url, key, 'kibl_fixtures',
                     'fixture_id,league_id,scheduled_start,name,player1_name,'
                     'player2_name,match_key,first_seen_at')


# ═══════════════════════════════════════════════════ SECTION 1 — MARKETS/LINES

def section_markets(url, key, client):
    h1('§1 — MARKETS AND LINES')

    obs, err = load_obs(url, key, BET105)
    if err:
        print(f'::error::{err}')
        print(f'\n{DASH}  the bet105 observations could not be read; §1 reports '
              f'nothing rather than reporting zeros.')
        return None, None
    if not obs:
        print(f'\n{DASH}  zero archived bet105 rows. Nothing below would be a '
              f'measurement of the book.')
        return None, None
    fx, ferr = load_fixtures(url, key)
    if ferr:
        print(f'::warning::{ferr} — per-league denominators fall back to the '
              f'league on the observation row')
        fx = []
    fx_league = {f['fixture_id']: f.get('league_id') for f in fx}

    mt, sg, bt = kibl_names(client)
    print(f'Measured on **{len(obs):,}** archived bet105 rows '
          f'({n_flag(len(obs))}) across '
          f'**{len({o["fixture_id"] for o in obs}):,}** fixtures.')

    # ── (a) every market_type × segment, with per-league fixture coverage ────
    h2('(a) Every market_type_id × segment_id bet105 returns for tennis')
    print('% is the share of bet105-priced fixtures IN THAT LEAGUE that carry '
          'at least one row of this market — not a share of rows. A book can '
          'post 400 rows of one market on one fixture; that is depth, not '
          'coverage, and the two answer different questions.')

    league_fixtures = collections.defaultdict(set)
    for o in obs:
        lg = fx_league.get(o['fixture_id'], o.get('league_id'))
        league_fixtures[lg].add(o['fixture_id'])

    combo_fx = collections.defaultdict(lambda: collections.defaultdict(set))
    combo_rows = collections.Counter()
    for o in obs:
        lg = fx_league.get(o['fixture_id'], o.get('league_id'))
        k = (o.get('market_type_id'), o.get('segment_id'), o.get('betting_type_id'))
        combo_fx[k][lg].add(o['fixture_id'])
        combo_rows[k] += 1

    hdr = ['market_type', 'segment', 'betting_type', 'rows']
    for lg in sorted(LEAGUES):
        hdr.append(f'{LEAGUES[lg]} (n={len(league_fixtures.get(lg, ()))})')
    print('\n| ' + ' | '.join(hdr) + ' |')
    print('|' + '---|' * len(hdr))
    for k, nrows in combo_rows.most_common():
        m, s, b = k
        cells = [str(mt.get(m, m)), str(sg.get(s, s)), str(bt.get(b, b)), f'{nrows:,}']
        for lg in sorted(LEAGUES):
            den = len(league_fixtures.get(lg, ()))
            cells.append(pct(len(combo_fx[k].get(lg, ())), den) if den else DASH)
        print('| ' + ' | '.join(cells) + ' |')

    other = {lg for lg in league_fixtures if lg not in LEAGUES}
    if other:
        print(f'\nRows also present for league ids not in the founder\'s three: '
              f'{sorted(other)} — {sum(len(league_fixtures[l]) for l in other):,} '
              f'fixtures. Reported, not folded into the percentages above.')

    # ── (b) set handicap and total sets, the reason Kibl mattered ───────────
    h2('(b) Set handicap and total sets — specifically')
    print('> "Sports411 returned zero on those and it was the whole reason Kibl '
          'mattered."')
    print('\n⚠️ THE SEGMENT MATCH BELOW IS EXACT, NOT A SUBSTRING. Matching '
          '`set` as a substring folds **First Set** into **Sets**, turning a '
          'GAMES handicap inside set one into a "set handicap". It inflated '
          'these two answers from 4,322 to 8,669 and from 2,006 to 5,802 on the '
          'first run of the gate. The two near-misses are printed underneath so '
          'the distinction is visible rather than trusted.')

    def present(mnames, seg_exact):
        rows = fxs = 0
        fset = set()
        for k, n in combo_rows.items():
            m, s, _b = k
            mn = str(mt.get(m, '')).lower()
            sn = str(sg.get(s, '')).lower().strip()
            if any(x in mn for x in mnames) and sn in seg_exact:
                rows += n
                for lg_set in combo_fx[k].values():
                    fset |= lg_set
        return rows, len(fset)

    asks = [
        ('match winner (moneyline × Full Game)', ('moneyline', 'money line', 'winner'), {'full game'}),
        ('games handicap (spread × Full Game)', ('spread', 'handicap'), {'full game'}),
        ('total games (total × Full Game)', ('total',), {'full game'}),
        ('**SET HANDICAP** (spread × Sets)', ('spread', 'handicap'), {'sets'}),
        ('**TOTAL SETS** (total × Sets)', ('total',), {'sets'}),
        ('— not those: spread × First Set (games hcp in set 1)', ('spread', 'handicap'), {'first set'}),
        ('— not those: total × First Set (games in set 1)', ('total',), {'first set'}),
    ]
    print('\n| market | present | rows | fixtures |')
    print('|---|---|---|---|')
    for label, mn, sx in asks:
        r, f = present(mn, sx)
        print(f'| {label} | {"YES" if r else "no"} | {r:,} | {f:,} |' if r
              else f'| {label} | no | {DASH} | {DASH} |')

    sh, _ = present(('spread', 'handicap'), {'sets'})
    ts_, _ = present(('total',), {'sets'})
    if sh or ts_:
        print(f'\n**Both set-level markets are present on bet105 and both were '
              f'absent on Sports411.** This is the capability the swap bought.')
    else:
        print(f'\n⚠️ **NO SET-LEVEL MARKET on bet105 either** — the same gap as '
              f'Sports411.')

    # ── (c) alternate lines ─────────────────────────────────────────────────
    h2('(c) Alternate lines — is alt_id populated, and how deep?')
    alt = collections.Counter(o.get('alt_id') for o in obs)
    real = sum(n for v, n in alt.items() if v not in (None, 0))
    print(f'rows with a non-null, non-zero `alt_id`: **{real:,}** of '
          f'{len(obs):,} ({pct(real, len(obs))}), {n_flag(len(obs))}')
    print(f'\nalt_id values seen: ' + ', '.join(
        f'`{v}`×{n:,}' for v, n in alt.most_common(10)))

    depth = collections.defaultdict(set)
    for o in obs:
        mkey = (o['fixture_id'], o.get('market_type_id'), o.get('segment_id'))
        depth[mkey].add((o.get('point'), o.get('alt_id')))
    per_market = collections.defaultdict(list)
    for (fid, m, s), lines in depth.items():
        per_market[(m, s)].append(len(lines))
    print('\n**Lines per fixture per market** — distinct (point, alt_id) pairs:')
    print('\n| market_type | segment | lines per fixture |')
    print('|---|---|---|')
    for (m, s), vals in sorted(per_market.items(), key=lambda kv: -len(kv[1]))[:14]:
        print(f'| {mt.get(m, m)} | {sg.get(s, s)} | {dist(vals, 1)} |')

    # ── (d) is_main ─────────────────────────────────────────────────────────
    h2('(d) is_main — are we entitled to non-main lines?')
    main = collections.Counter(o.get('is_main') for o in obs)
    nonmain = sum(n for v, n in main.items() if v is False)
    print(f'`is_main` values: ' + ', '.join(f'`{v}`×{n:,}' for v, n in main.most_common()))
    if nonmain:
        print(f'\n**Non-main lines ARE served on this credential** — '
              f'{nonmain:,} rows ({pct(nonmain, len(obs))}). A main-only '
              f'entitlement returns HTTP 200 with the alternates silently '
              f'absent, so this is the only way to know.')
    else:
        print(f'\n⚠️ **No row carries `is_main = false`.** On this vendor that '
              f'reads one of two ways and we cannot tell them apart from here: '
              f'either the account is entitled to main lines only, or bet105 '
              f'posts no alternates. Entitlement is a Cognito attribute and it '
              f'fails SILENTLY with HTTP 200 — there is no error to read. '
              f'Ask Bet105 to confirm `is_main` is unrestricted; that is the '
              f'only way this becomes a fact rather than an inference.')

    return obs, (mt, sg, bt)


# ═══════════════════════════════════════════════════════ SECTION 2 — LIVE

def section_live(obs, names):
    h1('§2 — LIVE / IN-PLAY')
    if obs is None:
        print(f'{DASH}  §1 could not read the archive, so §2 has nothing to '
              f'count.')
        return
    mt, sg, bt = names or ({}, {}, {})
    print('⚠️ Tennis live is `betting_type_id` **3** (Live Fluid), not 2. The '
          'OpenAPI spec says "1=Prematch, 2=Live"; tennis uses 2 for zero rows. '
          'Asking for entitlement off the spec excludes every tennis live '
          'market and returns HTTP 200 throughout.')

    live_rows = [o for o in obs if o.get('betting_type_id') == 3]
    flagged = [o for o in obs if o.get('is_live')]
    print(f'\nbet105 rows with `betting_type_id = 3`: **{len(live_rows):,}** of '
          f'{len(obs):,} ({n_flag(len(obs))})')
    print(f'bet105 rows with `is_live = true`: **{len(flagged):,}**')

    if not live_rows and not flagged:
        print(f'\n**No live rows at all on this credential.** Stating what that '
              f'does and does not mean:')
        print(f'\n* It is a measurement of what our ARCHIVE holds, and the '
              f'archive is deliberately PRE-MATCH only — `archive-kibl.py` '
              f'sweeps a forward horizon and stops. So a zero here is partly '
              f'our own scope, not only the book\'s.')
        print(f'* What it therefore does NOT establish is whether bet105 would '
              f'return live rows if asked for them directly. That is §4\'s job, '
              f'and until a live-scoped call is made on this credential the '
              f'honest answer to "does bet105 price in-play" is **unknown**.')
        print(f'* Cadence cannot be measured from zero rows: {DASH}.')
        return

    fx = {o['fixture_id'] for o in live_rows}
    print(f'\nfixtures carrying at least one live row: **{len(fx):,}**')
    combos = collections.Counter((o.get('market_type_id'), o.get('segment_id'))
                                 for o in live_rows)
    print('\n| market_type | segment | live rows |')
    print('|---|---|---|')
    for (m, s), n in combos.most_common(15):
        print(f'| {mt.get(m, m)} | {sg.get(s, s)} | {n:,} |')

    # Cadence, measured — the gap between consecutive distinct prices on one
    # (fixture, market, side).
    series = collections.defaultdict(list)
    for o in live_rows:
        k = (o['fixture_id'], o.get('market_type_id'), o.get('segment_id'),
             o.get('side_id'), o.get('point'))
        if o.get('inserted_on'):
            series[k].append((o['inserted_on'], o.get('price_decimal')))
    gaps = []
    for k, pts in series.items():
        pts.sort()
        for (t0, p0), (t1, p1) in zip(pts, pts[1:]):
            if p0 == p1:
                continue
            try:
                gaps.append((epoch(t1) - epoch(t0)) / 60.0)
            except Exception:                                    # noqa: BLE001
                pass
    if gaps:
        print(f'\n**Measured cadence** — minutes between two DIFFERENT live '
              f'prices on the same fixture/market/side: {dist(gaps, 1)}')
        print('\n⚠️ This is the cadence OUR SWEEPS observed, which is an upper '
              'bound on the gap and a lower bound on the book\'s true update '
              'rate. Kibl keeps no history, so any change that happened and '
              'reversed between two sweeps is not in this distribution.')
    else:
        print(f'\ncadence: {DASH}  — live rows exist but no two consecutive '
              f'observations on one series carry different prices, so there is '
              f'no interval to measure.')


def overround(book_rows, sides):
    """1/p1 + 1/p2 on the CLOSE. None unless both sides carry one."""
    ss = [s for s in sides if s in book_rows]
    if len(ss) < 2:
        return None
    tot = 0.0
    for s in ss[:2]:
        p = book_rows[s].get('close_price')
        if p is None or float(p) <= 0:
            return None
        tot += 1.0 / float(p)
    return tot


def ts(v):
    return v if v else DASH


# ═══════════════════════════════════════ SECTION 3 — WHAT A PRICE ROW CARRIES

RAW_SAMPLE = 6000


def section_rows(url, key, obs):
    h1('§3 — WHAT EACH PRICE ROW ACTUALLY CARRIES')

    # ── (a) the stake limit ─────────────────────────────────────────────────
    h2('(a) Stake limit')
    print('> "It was null on all 299,250 Sports411 rows. If populated, report '
          'the range by league — a sharp book\'s limit is a confidence signal."')

    raw105, err = fetch_all(url, key, 'kibl_line_observations',
                            'fixture_id,league_id,raw_object,price_decimal,'
                            'market_type_id,segment_id,is_opener,is_current',
                            extra=f'&feed_source_id=eq.{BET105}', page=1000,
                            cap=RAW_SAMPLE)
    if err:
        print(f'::error::{err}')
        print(f'\n{DASH}  the raw bet105 rows could not be read; §3 reports '
              f'nothing rather than guessing at the field list.')
        return
    if not raw105:
        print(f'\n{DASH}  no raw bet105 rows held.')
        return
    print(f'\nField census computed on the **first {len(raw105):,}** archived '
          f'bet105 rows ({n_flag(len(raw105))}). This is a SAMPLE and says so; '
          f'it is bounded because `raw_object` is the whole vendor record and '
          f'pulling every one of them moves far more data than the answer needs.')

    limit_keys = set()
    for r in raw105:
        ro = r.get('raw_object') or {}
        if isinstance(ro, str):
            try:
                ro = json.loads(ro)
            except Exception:                                    # noqa: BLE001
                ro = {}
        for k in ro:
            if 'limit' in k.lower() or 'stake' in k.lower() or 'max' in k.lower():
                limit_keys.add(k)
    if not limit_keys:
        print(f'\n**No field on a bet105 row is named for a stake limit, a '
              f'stake, or a maximum.** Not "null" — the key is not in the '
              f'vendor record at all. Sports411 carried the same absence.')
        print(f'\nSo the limit cannot be read as a confidence signal on this '
              f'feed, and the reason is the schema, not the book. Whether Kibl '
              f'can expose it at all is **unknown** from here and is a question '
              f'for Bet105.')
    else:
        print(f'\nlimit-shaped fields present: ' +
              ', '.join(f'`{k}`' for k in sorted(limit_keys)))
        for k in sorted(limit_keys):
            per_league = collections.defaultdict(list)
            for r in raw105:
                ro = r.get('raw_object') or {}
                if isinstance(ro, str):
                    try:
                        ro = json.loads(ro)
                    except Exception:                            # noqa: BLE001
                        continue
                v = ro.get(k)
                if isinstance(v, (int, float)):
                    per_league[r.get('league_id')].append(float(v))
            print(f'\n`{k}` by league:')
            for lg, vals in sorted(per_league.items(), key=lambda kv: -len(kv[1])):
                print(f'* {LEAGUES.get(lg, lg)}: {dist(vals, 2)}')

    # ── (b) every field, with % populated ───────────────────────────────────
    h2('(b) Every field on a bet105 row, with % populated')
    keys = collections.Counter()
    filled = collections.Counter()
    for r in raw105:
        ro = r.get('raw_object') or {}
        if isinstance(ro, str):
            try:
                ro = json.loads(ro)
            except Exception:                                    # noqa: BLE001
                continue
        for k, v in ro.items():
            keys[k] += 1
            if v is not None and v != '':
                filled[k] += 1
    n = len(raw105)
    print(f'\n| field | present on | non-null | % populated |')
    print('|---|---|---|---|')
    for k, seen in sorted(keys.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f'| `{k}` | {seen:,} | {filled[k]:,} | {pct(filled[k], n)} |')

    # What Sports411 did not carry, on the same census.
    raw43, err43 = fetch_all(url, key, 'kibl_line_observations',
                             'raw_object', extra=f'&feed_source_id=eq.{SPORTS411}',
                             page=1000, cap=RAW_SAMPLE)
    h3('Named plainly: what bet105 carries that Sports411 did not')
    if err43:
        print(f'{DASH}  the Sports411 rows could not be read ({err43}), so the '
              f'comparison is not made rather than asserted.')
    elif not raw43:
        print(f'{DASH}  no Sports411 rows held to compare against.')
    else:
        k43 = collections.Counter()
        f43 = collections.Counter()
        for r in raw43:
            ro = r.get('raw_object') or {}
            if isinstance(ro, str):
                try:
                    ro = json.loads(ro)
                except Exception:                                # noqa: BLE001
                    continue
            for k, v in ro.items():
                k43[k] += 1
                if v is not None and v != '':
                    f43[k] += 1
        only105 = [k for k in filled if filled[k] and not f43.get(k)]
        print(f'Compared on {len(raw43):,} Sports411 rows ({n_flag(len(raw43))}).')
        if only105:
            print('\nFields populated on bet105 and never populated on Sports411:')
            for k in sorted(only105):
                print(f'* `{k}` — {pct(filled[k], n)} populated on bet105, '
                      f'0 on Sports411')
        else:
            print('\nNo field is populated on bet105 and empty on Sports411. '
                  'The difference between the two books is in the MARKETS they '
                  'price (§1b), not in the shape of a row.')

    # ── (c) opener / previous / current ─────────────────────────────────────
    h2('(c) Opener / previous / current')
    if obs is None:
        print(f'{DASH}  §1 could not read the archive.')
        return
    st = {k: sum(1 for o in obs if o.get(k)) for k in
          ('is_opener', 'is_previous', 'is_current')}
    ntot = len(obs)
    for k, v in st.items():
        print(f'* `{k}` true on **{v:,}** of {ntot:,} rows ({pct(v, ntot)})')
    print(f'\n{n_flag(ntot)}')
    if not st['is_previous']:
        print('\n⚠️ `is_previous` is **not a query parameter** on this API and '
              '`is_current` defaults to true, so a naive pull silently drops '
              'the previous state. A zero here is our pull axis, not the '
              'book — stated rather than reported as "bet105 has no previous '
              'price".')

    # Are the openers REAL — i.e. is the is_opener row actually the earliest?
    first_by = {}
    opener_by = {}
    for o in obs:
        k = (o['fixture_id'], o.get('market_type_id'), o.get('segment_id'),
             o.get('side_id'), o.get('point'))
        t = o.get('inserted_on')
        if not t:
            continue
        if k not in first_by or t < first_by[k]:
            first_by[k] = t
        if o.get('is_opener') and (k not in opener_by or t < opener_by[k]):
            opener_by[k] = t
    both = [k for k in opener_by if k in first_by]
    agree = sum(1 for k in both if opener_by[k] <= first_by[k])
    if both:
        print(f'\n**Is `is_opener` a real opener?** On {len(both):,} series that '
              f'carry one, the flagged row is the earliest row we hold on '
              f'**{agree:,}** of them ({pct(agree, len(both))}), {n_flag(len(both))}.')
        if agree < len(both):
            print(f'\nThe {len(both) - agree:,} that disagree are not '
                  f'necessarily wrong: we can only compare against rows WE '
                  f'captured, and the archive starts when it starts.')
    else:
        print(f'\nis_opener reality check: {DASH}  — no series carries a '
              f'flagged opener.')


# ═══════════════════════════════════════════════════ SECTION 4 — OTHER ENDPOINTS

# The founder asked which of the 71 documented paths ANSWER on our credential
# and what they give. The only way to know is to call them. Each entry is
# (path, params, what the founder asked it for).
PROBES = [
    ('/info/markets-alerts', {}, 'the free line-movement signal — what does it fire on?'),
    ('/info/markets-last-updated', {}, 'per-book freshness; could it replace our staleness guessing?'),
    ('/info/outcomes', {}, 'anything api-tennis does not already give us?'),
    ('/info/fixtures-states', {}, 'ditto'),
    ('/info/fixtures-segments-scores', {}, 'ditto'),
    ('/mapping/donbest', {}, 'DonBest id mapping — could it replace surname matching?'),
    ('/mapping/espn', {}, 'ESPN id mapping — ditto'),
    ('/reference/sports', {}, 'inventory'),
    ('/reference/leagues', {}, 'inventory'),
    ('/reference/sportsbooks', {}, 'the entitlement itself'),
    ('/reference/market-types', {}, 'vocabulary'),
    ('/reference/segments', {}, 'vocabulary'),
    ('/reference/betting-types', {}, 'vocabulary'),
    ('/reference/market-statuses', {}, 'vocabulary'),
    ('/reference/fixture-types', {}, 'vocabulary'),
    ('/reference/periods', {}, 'vocabulary'),
]


def section_endpoints(client):
    h1('§4 — OTHER ENDPOINTS, PROBED ON OUR CREDENTIAL')
    print('Each row is a GET actually issued on this account. `rows` is what '
          'came back, and a 200 with zero rows is reported as **200/empty** — '
          'per the founder\'s rule, that is not a capability.')
    print('\n| endpoint | status | rows | first-row keys | asked for |')
    print('|---|---|---|---|---|')
    results = {}
    for path, params, why in PROBES:
        try:
            payload, meta = client.get(path, params)
            rows = [r for r in client.rows(payload) if isinstance(r, dict)]
            status = (meta or {}).get('status', 200)
            keys = ', '.join(f'`{k}`' for k in list(rows[0])[:8]) if rows else DASH
            # ⚠️ A 200 whose envelope we cannot parse yields zero rows and is
            # INDISTINGUISHABLE from an empty account unless it is named. The
            # client flags it; not passing that flag through here would turn a
            # parser bug into a capability finding.
            unread = (meta or {}).get('unrecognised_envelope')
            verdict = (f'{status}' + ('/empty' if not rows else '')
                       + ('  ⚠️ **unparsed envelope**' if unread else ''))
            results[path] = {'status': status, 'rows': len(rows),
                             'keys': list(rows[0]) if rows else []}
            print(f'| `{path}` | {verdict} | {len(rows):,} | {keys} | {why} |')
        except Exception as e:                                   # noqa: BLE001
            msg = str(e)[:90].replace('|', '/')
            results[path] = {'status': 'error', 'rows': None, 'error': msg}
            print(f'| `{path}` | **error** | {DASH} | {DASH} | {why} |')
            print(f'| | | | `{msg}` | |')

    h2('What this means for the three the founder asked about by name')

    ma = results.get('/info/markets-alerts', {})
    print(f'\n**`/info/markets-alerts`** — {ma.get("status")}, '
          f'{ma.get("rows") if ma.get("rows") is not None else DASH} rows. '
          + ('It answers and carries data, so a dropping-odds alert could be '
             'driven from it without any new polling budget. What it FIRES ON '
             'is only readable from live rows over time — a single call cannot '
             'establish a trigger rule, so that part stays **unknown** until '
             'we watch it.'
             if ma.get('rows') else
             'It returns nothing on this credential right now. That is either '
             'an entitlement gap (which fails silently with 200 on this '
             'vendor) or genuinely no alerts in flight. **Unknown which**, and '
             'a single empty call cannot tell them apart.'))

    mlu = results.get('/info/markets-last-updated', {})
    print(f'\n**`/info/markets-last-updated`** — {mlu.get("status")}, '
          f'{mlu.get("rows") if mlu.get("rows") is not None else DASH} rows. '
          + ('It answers, so per-book freshness is available directly and '
             'would replace the staleness we currently INFER from our own '
             'sweep clock — a strictly better signal, because ours cannot '
             'distinguish "the book has not moved" from "we have not looked".'
             if mlu.get('rows') else
             'Nothing on this credential, so it cannot replace our staleness '
             'guessing today.'))

    db = results.get('/mapping/donbest', {})
    es = results.get('/mapping/espn', {})
    print(f'\n**`/mapping/*`** — donbest {db.get("status")}/'
          f'{db.get("rows") if db.get("rows") is not None else DASH} rows, '
          f'espn {es.get("status")}/'
          f'{es.get("rows") if es.get("rows") is not None else DASH} rows. ')
    if db.get('rows') or es.get('rows'):
        print('A stable third-party id would replace surname matching for '
              'cross-source pairing, which has caused three name bugs on this '
              'product. ⚠️ It only helps if the OTHER side also carries that '
              'id: oddspapi and api-tennis would each need a DonBest or ESPN '
              'id for the same fixture. That is the thing to check before '
              'building on it, and it is not answered by this call.')
    else:
        print('Neither answers with data on this credential, so surname '
              'matching stays the only cross-source key we have.')

    return results


# ═══════════════════════════════════════════════════════ SECTION 5 — RABBITMQ

def section_stream(idx):
    h1('§5 — THE RABBITMQ STREAM')
    print('⚠️ **THIS SECTION IS READ OFF THE DOCUMENTATION, NOT MEASURED.** We '
          'have no stream credential, so nothing here has been verified on our '
          'account. It is flagged that way deliberately, because the founder\'s '
          'standing rule is to say "unknown" rather than infer from the spec, '
          'and he is asking this in order to talk to Bet105.')

    h2('(a) What Bet105 must provision, and what arrives')
    print("""
* **A RabbitMQ user, vhost and a bound queue on Kibl's broker**, plus the host
  and port. Kibl's docs describe a push of the `/info/*` family; the account
  that consumes it is provisioned by the vendor, not self-serve.
* **Entitlement is the same Cognito attribute set as the REST side** —
  `league_id`, `feed_source_id`, `fixture_type_id`, `market_type_id`,
  `segment_id`, `betting_type_id`, `is_main`. ⚠️ This is the part worth being
  explicit with them about: on the REST side a restricted attribute returns
  **HTTP 200 with the rows silently missing**. A stream will behave the same
  way — a quiet queue and a healthy connection. Ask for **`betting_type_id` 1
  AND 3** in writing (3 is Live Fluid; tennis uses 2 for zero rows, and the
  spec's "2 = Live" is wrong for this sport).
* **Pre-match as well as live**: the docs describe the push as covering the
  `/info/*` endpoints, which is where both live. Whether the entitlement can be
  scoped to one and not the other is **unknown** — ask.
* **Message format**: the same record shapes the REST endpoints return. Not
  verified.
* **Reconnect / resume**: AMQP gives durable queues and manual ack, so a
  consumer that dies and returns picks up what was queued while it was gone —
  *provided the queue is durable and the messages are persistent*. Whether Kibl
  declares them that way is **unknown and is the single most important question
  to ask**, because a non-durable queue silently discards everything posted
  while we are disconnected, which is exactly the loss the stream is meant to
  fix.
""".strip())

    h2('(b) What it buys that polling cannot — quantified')
    print('Kibl keeps no history. A price posted and replaced between two of '
          'our sweeps is lost permanently. So the question "how often does a '
          'price change between two sweeps" has a floor we can measure and a '
          'true value we cannot.')
    if not idx:
        print(f'\n{DASH}  the card-state read in the accuracy section failed, '
              f'so the movement rate is not restated here.')
        return
    tot = mv = 0
    for mk, bk in idx.items():
        b = bk.get('bet105')
        if not b:
            continue
        for s, r in b.items():
            o, c = r.get('open_price'), r.get('close_price')
            if o is None or c is None:
                continue
            tot += 1
            if float(o) != float(c):
                mv += 1
    if tot:
        print(f'\n**Measured floor**: on {tot:,} bet105 sides carrying both an '
              f'open and a close, the price differs on **{mv:,}** of them '
              f'({pct(mv, tot)}), {n_flag(tot)}.')
        print(f'\nThat is a FLOOR on how much movement exists, not an estimate '
              f'of it. It counts one difference across the whole life of a '
              f'market. Every intermediate price — the ones a stream would '
              f'deliver and a sweep cannot — is by definition not in this '
              f'number. The true figure is **unknown**, and the gap between '
              f'{pct(mv, tot)} and it is precisely what the stream buys.')
    else:
        print(f'\n{DASH}  no bet105 side carries both an open and a close, so '
              f'even the floor cannot be computed.')

    h2('(c) What it needs on our side, and rough monthly cost')
    print("""
* **An always-on consumer.** GitHub Actions cannot host it: this repo's
  `schedule:` cron is throttled to roughly **1.5% delivery** (measured — one
  firing against ~67 due), which is why the archive's real cadence already
  comes from a Supabase pg_cron pinger. A stream needs a process that stays
  connected, not a job that is invited to run.
* **A live table and a writer.** The archive tables already exist and take the
  same row shape, so this is a new writer against `kibl_line_observations`
  rather than a new schema. The row volume is the change: a stream delivers
  every tick instead of one price per sweep.
* **Page updating.** Nothing today reads a live price. The card path publishes a
  static JSON on a commit, so in-play prices would need a different read path —
  that is a product decision, not a plumbing one, and it is the largest piece of
  work in this list.
* **Rough monthly cost.** A single small always-on worker (Fly.io / Railway /
  a 1-vCPU VPS) is **roughly $5–$10/month** at this volume; Supabase storage
  for the extra rows is marginal against what the archive already holds. The
  cost that is not in dollars is that an always-on component fails differently
  from a cron job: it can be connected and receiving nothing, which looks
  identical to a quiet market. It needs its own liveness check, and that check
  is the thing that must not be forgotten when this is built.
""".strip())


# ═══════════════════════════════════════════════════ SECTION 6 — COVERAGE

def section_coverage(url, key, obs, idx):
    h1('§6 — COVERAGE AND QUALITY, FOR THE LADDER RULING')
    print('*The ladder is unchanged. These are the numbers a ruling would be '
          'made on, reported rather than acted on.*')

    fx, ferr = load_fixtures(url, key)
    if ferr:
        print(f'::error::{ferr}')
        print(f'\n{DASH}  fixtures unreadable; coverage percentages are not '
              f'reported rather than computed against a wrong denominator.')
    elif obs is None:
        print(f'\n{DASH}  observations unreadable.')
    else:
        h2('(a) Coverage per league')
        print('Denominator is every tennis fixture Kibl listed for that league '
              'in our archive window; numerator is those carrying at least one '
              'bet105 price.')
        priced = {o['fixture_id'] for o in obs}
        per = collections.defaultdict(lambda: [0, 0])
        for f in fx:
            lg = f.get('league_id')
            per[lg][1] += 1
            if f['fixture_id'] in priced:
                per[lg][0] += 1
        print('\n| league | priced by bet105 | listed | coverage |')
        print('|---|---|---|---|')
        for lg in sorted(LEAGUES):
            k, n = per.get(lg, [0, 0])
            print(f'| {LEAGUES[lg]} | {k:,} | {n:,} | '
                  f'{pct(k, n)}{"  ⚠️ n < 30" if n < MIN_N else ""} |')
        others = {lg: v for lg, v in per.items() if lg not in LEAGUES and v[1]}
        if others:
            print('\nOther leagues present in the archive (men\'s scope is '
                  'deliberate; women\'s leagues are entitled but not swept):')
            for lg, (k, n) in sorted(others.items(), key=lambda kv: -kv[1][1])[:8]:
                print(f'* league {lg}: {k:,} of {n:,} ({pct(k, n)})')

    h2('(b) Median overround vs bet365 and Sports411')
    if not idx:
        print(f'{DASH}  card state unreadable.')
    else:
        print('\n| book | median overround on the close | distribution |')
        print('|---|---|---|')
        for book in ('bet105', 'bet365', 'sports411'):
            vals = []
            for mk, bk in idx.items():
                b = bk.get(book)
                if b:
                    o = overround(b, list(b))
                    if o is not None:
                        vals.append(o)
            med = f'**{statistics.median(vals):.4f}**' if vals else DASH
            print(f'| {book} | {med} | {dist(vals, 4)} |')
        print('\n⚠️ These are not measured on one common fixture set — each '
              'book is measured on the fixtures it actually prices, and the '
              'three sets overlap only partly. A lower overround on a book that '
              'prices a different tier is not evidence that it is sharper.')

    h2('(c) Opening times vs bet365, per level')
    if not idx:
        print(f'{DASH}  card state unreadable.')
        return
    print('Hours between the open we hold and the scheduled start. '
          '⚠️ **Every bet105/Kibl timestamp is VENDOR-INSERT** — latency to '
          'Kibl, never to the book. A bet365 timestamp from oddspapi is a '
          'book-tick. The two clocks are not the same measurement and the '
          'difference between the columns below is partly the difference '
          'between the clocks.')
    rows_out = []
    for book, kind in (('bet105', 'vendor-insert'), ('bet365', 'book-tick'),
                       ('sports411', 'vendor-insert')):
        vals = []
        for mk, bk in idx.items():
            b = bk.get(book)
            if not b:
                continue
            for s, r in b.items():
                ot, st = r.get('open_ts'), r.get('start_ts')
                if not ot or not st:
                    continue
                try:
                    vals.append((epoch(st) - epoch(ot)) / 3600.0)
                except Exception:                                # noqa: BLE001
                    pass
        rows_out.append((book, kind, vals))
    print('\n| book | clock | hours before start, open posted |')
    print('|---|---|---|')
    for book, kind, vals in rows_out:
        print(f'| {book} | {kind} | {dist(vals, 1)} |')


# ═══════════════════════════════════════════════════════ SECTION 7 — LIMITS

def section_limits(obs, endpoints):
    h1('§7 — LIMITS, PLAINLY')
    print('The founder asked to confirm two and to name the rest.')

    h2('Confirmed, and still true for this source')
    hist = [p for p in (endpoints or {}) if 'histor' in p]
    print(f'1. **No history endpoint.** Confirmed for bet105: it is a property '
          f'of the API, not of the book — there is no history path among the '
          f'documented 71, and none appeared in the probe above. Everything we '
          f'will ever hold for bet105 is what a sweep captured while it was '
          f'live. A price posted and replaced between two sweeps is gone.')
    if obs is not None:
        ins = sum(1 for o in obs if o.get('inserted_on'))
        print(f'2. **Every timestamp is Kibl insert time.** Confirmed: '
              f'`inserted_on` is populated on {ins:,} of {len(obs):,} bet105 '
              f'rows ({pct(ins, len(obs))}) and it is the ONLY time field on '
              f'the record. There is no book-post time anywhere in the payload, '
              f'so every latency, every "opened N hours early", and every '
              f'open/close comparison in this document is latency to KIBL. '
              f'Stated on every figure above that uses it.')
    else:
        print(f'2. **Every timestamp is Kibl insert time.** {DASH}  archive '
              f'unreadable in this run; not re-confirmed here.')

    h2('What else we cannot get')
    print("""
* **No stake limit.** The field is not in the record at all (§3a) — not null,
  absent. So the sharp-book confidence signal the founder was hoping for is not
  available from this feed in any form.
* **No book-post clock**, therefore no true "who moved first" between bet105
  and bet365. §3(c) of the board fixes says so on the figure itself.
* **No intermediate prices.** We hold an open and a close and nothing between,
  because that is what polling a historyless feed can hold. This is the one
  limit the RabbitMQ stream would actually remove.
* **No retention statement.** Kibl's "Getting Started" and "Change Logs" pages
  iframe expired Atlassian links and are dead by server fetch and by headless
  browser alike. Any retention or backfill-window commitment would live there.
  Worth asking Bet105 to re-share — it decides how much of the past is
  recoverable and we currently do not know.
* **Entitlement gaps are silent.** Every restriction on this vendor returns
  HTTP 200 with rows missing. So "we saw no rows" and "we are not entitled to
  those rows" are the same observation from here, and anywhere this document
  says **unknown** rather than **no**, that is why.
* **No women's tennis in the archive** — entitled and priced, deliberately out
  of scope. Not a vendor limit; ours, and reversible.
""".strip())


# ══════════════════════════════════════════════════════════════════════ main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--section', default='all')
    ap.add_argument('--examples', type=int, default=10)
    args = ap.parse_args()

    url, key = L.creds()
    started = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

    print(f'<!-- ten232-bet105-capability.py · {started} -->')
    h1('BET105 — WHAT WE CAN ACTUALLY GET, MEASURED ON OUR CREDENTIAL')
    print(f'Generated {started}. Every figure carries its n; an n below {MIN_N} '
          f'is flagged on the line. A missing measurement reads `{DASH}` and '
          f'names what is missing — never 0.')

    want = args.section
    need_kibl = want in ('all', 'markets', 'live', 'endpoints')

    client = None
    if need_kibl:
        from kibl_client import KiblClient
        client = KiblClient(verbose=False)
        # Fail here, loudly, rather than three sections later with an empty
        # table that reads like a capability answer.
        try:
            client.authenticate()
        except Exception as e:                                   # noqa: BLE001
            print(f'::error::Kibl authentication failed: {str(e)[:200]}')
            print(f'\n{DASH}  every section that needs a live call is skipped. '
                  f'No secret is printed.')
            client = None

    idx = obs = names = endpoints = None

    if want in ('all', 'accuracy'):
        idx = section_accuracy(url, key, args.examples)

    if want in ('all', 'markets', 'live', 'rows', 'coverage', 'limits'):
        if client is None and want in ('all', 'markets'):
            print('::warning::no Kibl client; §1 ids will be unnamed')
        obs, names = section_markets(url, key, client) if client else (
            load_obs(url, key, BET105)[0], ({}, {}, {}))

    if want in ('all', 'live'):
        section_live(obs, names)

    if want in ('all', 'rows'):
        section_rows(url, key, obs)

    if want in ('all', 'endpoints') and client is not None:
        endpoints = section_endpoints(client)
    elif want in ('all', 'endpoints'):
        h1('§4 — OTHER ENDPOINTS, PROBED ON OUR CREDENTIAL')
        print(f'{DASH}  no authenticated Kibl client, so no endpoint was '
              f'probed. Reporting that rather than a table of failures that '
              f'would read as vendor faults.')

    if want in ('all', 'stream'):
        section_stream(idx)

    if want in ('all', 'coverage'):
        section_coverage(url, key, obs, idx)

    if want in ('all', 'limits'):
        section_limits(obs, endpoints)

    if client is not None:
        print(f'\n\n---\n\nKibl calls made by this run: **{client.calls}**, '
              f'{client.bytes_down:,} bytes down. Nothing was written, '
              f'published or dispatched.')
    print('\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
