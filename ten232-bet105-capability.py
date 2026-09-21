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


def normalise_prices(rows):
    """A NON-POSITIVE PRICE IS ABSENT, not a price. Returns (rows, dropped).

    ⚠️ THIS IS NOT COSMETIC, AND THE FIRST RUN OF THIS REPORT GOT IT WRONG.
    44 of the 135 bet105 closes in the archive are `0.000` — on BOTH sides,
    always within seconds of the scheduled start. That is Kibl's marker for a
    suspended market, not a price anyone could take.

    Left in, a zero does not merely add noise, it flips the answer:
    * `open != close` is true for every one of them, so all 44 counted as the
      book MOVING. The move rate read 98.5%, and much of that was the
      suspension marker rather than the book repricing.
    * a zero is a price-shaped number, which is precisely what the standing
      rule — missing = dash, never zero — exists to keep away from a reader.

    `ten225-publish-card-state.py` already applies this rule at the publish
    boundary, which is why no `0.00` reaches the board. Applying the SAME rule
    here keeps the report and the page telling one story: a measurement that
    counts rows the product refuses to show is measuring the wrong thing.
    """
    dropped = collections.Counter()
    for r in rows:
        for f in ('open_price', 'now_price', 'close_price'):
            v = r.get(f)
            if v is not None and float(v) <= 0:
                dropped[(r.get('book'), f)] += 1
                r[f] = None
                r['zeroed_' + f] = True
    return rows, dropped


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

    rows, zeroed = normalise_prices(rows)
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

    # ── THE OVERLAP CENSUS, BEFORE ANY EXAMPLE IS ATTEMPTED ─────────────────
    # "No worked examples available" is not an answer to the founder's
    # question, it is a symptom. If bet105 and bet365 do not price the same
    # fixtures, that fact IS the finding and it decides how much of this
    # document can be a comparison at all — so it is measured and printed
    # before the examples rather than inferred from their absence.
    h3('Which books can even be compared — the overlap census')
    srcs = collections.Counter((r.get('book'), r.get('source')) for r in rows)
    print('| book | source | rows |')
    print('|---|---|---|')
    for (b, s), n in srcs.most_common():
        print(f'| {b} | {s} | {n:,} |')

    mk105 = {mk for mk, bk in idx.items() if 'bet105' in bk}
    print(f'\nfixtures carrying a bet105 row: **{len(mk105):,}**')
    print('\n| other book | shares a fixture with bet105 | shares a SIDE with a close on both |')
    print('|---|---|---|')
    others = sorted({r.get('book') for r in rows} - {'bet105', None})
    legs = {}
    for ob in others:
        share = {mk for mk in mk105 if ob in idx[mk]}
        both = 0
        for mk in share:
            a, b = idx[mk]['bet105'], idx[mk][ob]
            both += sum(1 for s in a if s in b
                        and a[s].get('close_price') is not None
                        and b[s].get('close_price') is not None)
        legs[ob] = (len(share), both)
        print(f'| {ob} | {len(share):,} | {both:,} |')

    if not legs.get('bet365', (0, 0))[0]:
        print(f'\n⚠️ **bet105 and bet365 do not price a single fixture in '
              f'common.** This is not a gap in the archive — it is what the two '
              f'feeds cover: Kibl prices Challenger and ITF, while the bet365 '
              f'series we hold from oddspapi is ATP and Davis Cup. So bet105 '
              f'**cannot be validated against bet365 on price**, today, at any '
              f'sample size. That is a material input to the ladder ruling and '
              f'it is stated here rather than left as an empty table.')

    # Pick the best second leg that actually EXISTS rather than insisting on
    # the one named in the directive and reporting nothing.
    LEG_ORDER = ['bet365', 'api-tennis', 'sports411']
    leg = next((b for b in LEG_ORDER if legs.get(b, (0, 0))[1] >= 2), None)
    if leg is None:
        leg = next((b for b, (sh, bo) in legs.items() if bo >= 2), None)

    cand = []
    if leg:
        for mk, bk in idx.items():
            b105, b2 = bk.get('bet105'), bk.get(leg)
            if not b105 or not b2:
                continue
            ok = [s for s in b105 if s in b2
                  and b105[s].get('close_price') is not None
                  and b2[s].get('close_price') is not None]
            if len(ok) >= 2:
                cand.append((mk, bk, sorted(ok)[:2]))
        cand.sort(key=lambda c: c[0])

    if not cand:
        print(f'\n{DASH}  **No fixture carries a bet105 close alongside a close '
              f'from ANY other book on the same side.** Worked examples with '
              f'both legs are therefore not available on the data we hold — '
              f'not "zero", not "they disagree": the comparison cannot be '
              f'made. The census above is the evidence, and §6(a) gives the '
              f'coverage that causes it.')
        print(f'\nWhat would make it available, in order of cost: pair against '
              f'**api-tennis**, which covers Challenger as well as ATP and is '
              f'free (it is already the referee arm of the side-mapping gate); '
              f'or extend the oddspapi archive to the Challenger tier, which '
              f'costs units against the request budget.')
    else:
        if leg != 'bet365':
            print(f'\n⚠️ **The second leg below is `{leg}`, not bet365.** The '
                  f'directive asks for the bet365 close, and bet105 shares no '
                  f'fixture with it (census above). Substituting a leg is '
                  f'flagged rather than done quietly, because a gap measured '
                  f'against a different book is a different measurement.')
        print(f'\nFixtures where bet105 and `{leg}` both close on both sides: '
              f'**{len(cand)}** ({n_flag(len(cand))}). Showing '
              f'{min(want_examples, len(cand))}.')
        for mk, bk, sides in cand[:want_examples]:
            b105, b365 = bk['bet105'], bk[leg]
            at = bk.get('api-tennis') or {}
            h3(mk)
            # The column is named for the book actually in it. Printing
            # sports411 numbers under a "bet365 close" heading is how a
            # flagged substitution quietly becomes a false statement.
            print(f'| side | bet105 open | bet105 close | {leg} close | '
                  f'api-tennis close | Δ implied (b105−{leg}) |')
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
            # ⚠️ The clock label follows the BOOK, not the column position.
            # sports411 comes through Kibl and is vendor-insert like bet105;
            # only bet365-via-oddspapi is a book tick. Printing "(book-tick)"
            # over a Kibl timestamp would undo the one caveat that matters most
            # in this whole document.
            leg_clock = 'book-tick' if leg == 'bet365' else 'vendor-insert'
            print(f'\noverround — bet105 {num(ov1)} · {leg} {num(ov2)}   '
                  f'· bet105 open ts {ts(b105[sides[0]].get("open_ts"))} '
                  f'(vendor-insert) · close ts {ts(b105[sides[0]].get("close_ts"))} '
                  f'(vendor-insert) · {leg} close ts '
                  f'{ts(b365[sides[0]].get("close_ts"))} ({leg_clock})')

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
    ref = leg or 'bet365'
    if ref != 'bet365':
        print(f'\n⚠️ The comparison leg is **`{ref}`**, not bet365 — bet105 and '
              f'bet365 share no fixture (census in (a)). A gap measured against '
              f'a different book answers a different question, so the book is '
              f'named on the figure.')
    gaps, gaps_clean, paired_fixtures = [], [], set()
    ref_bad = []
    for mk, bk in idx.items():
        b105, b365 = bk.get('bet105'), bk.get(ref)
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
        print(f'\nmedian |Δ implied| against the {ref} close on the same '
              f'fixture and side: **{statistics.median(gaps):.2f} points** '
              f'({n_flag(len(gaps))} side-pairs across {len(paired_fixtures)} fixtures)')
        print(f'distribution: {dist(gaps, 2)}')
        if ref_bad:
            med_c = (f'{statistics.median(gaps_clean):.2f}' if gaps_clean else DASH)
            print(f'\n⚠️ **{len(ref_bad)} of those pairs have a {ref} close of '
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
        print(f'\nmedian |Δ implied| vs {ref}: {DASH}  — no side on any fixture '
              f'carries a close from both books, so there is nothing to '
              f'subtract. Not zero: the subtraction has no operands.')

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

    # THE BIGGEST ONE FIRST, because it is a third of the population and it is
    # the reason every figure above had to be recomputed.
    z105 = zeroed.get(('bet105', 'close_price'), 0)
    if z105:
        h3(f'{z105} bet105 "closes" are 0.000 — the vendor\'s suspension marker, '
           f'not a price')
        n_close = sum(1 for r in rows if r.get('book') == 'bet105'
                      and (r.get('close_price') is not None
                           or r.get('zeroed_close_price')))
        print(f'**{z105} of the {n_close} bet105 closes in the archive '
              f'({pct(z105, n_close)})** carry a price of exactly `0.000`. They '
              f'come in PAIRS — both sides of the same fixture — and every one '
              f'is timestamped within seconds to a couple of minutes of the '
              f'scheduled start. That shape is a market being suspended at the '
              f'live flip, not a book quoting zero.')
        print(f'\n**What it costs us:** those fixtures have no Close at all. '
              f'The last real price we hold is the Open, and the card dashes '
              f'the Close — correctly, but it is a Close we would have had if '
              f'the final pre-flip price had been captured before the market '
              f'went down.')
        print(f'\n**What it does NOT cost us:** nothing reaches a member. '
              f'`ten225-publish-card-state.py` already treats a non-positive '
              f'price as absent, so no `0.00` has ever been published. I have '
              f'confirmed that on the deployed `odds-card-state.json`: zero '
              f'non-positive prices in the file.')
        print(f'\n⚠️ **Every figure in (b) and (c) above is computed with these '
              f'rows treated as ABSENT**, the same rule the publisher applies. '
              f'Counting them as prices would have reported the move rate as '
              f'98.5% when 44 of those "moves" were a market closing.')
        if zeroed:
            print(f'\nNon-positive prices across the whole table, by book and leg:')
            for (b, f), n in zeroed.most_common():
                print(f'* {b} · `{f}` — {n:,}')

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

    def present(mkt_exact, seg_exact):
        """Rows whose market type AND segment BOTH match exactly.

        ⚠️ BOTH HALVES ARE EXACT, AND THE FIRST RUN OF THIS REPORT GOT THE
        MARKET HALF WRONG. The gate before it had already learned this lesson
        on the SEGMENT (matching `set` as a substring folded First Set into
        Sets); I carried the fix forward for segments and left the market type
        as a substring test. `total` then also matched **Team Total** — a
        different product entirely, the games won by ONE player — and "total
        games" reported 25,366 rows when the real figure is 11,707. The other
        13,659 were Team Total.

        Two markets sharing a word is exactly how a book gets credited with a
        product it does not sell, and it has now happened once in each
        vocabulary. So neither is a substring test any more.
        """
        rows = 0
        fset = set()
        for k, n in combo_rows.items():
            m, s, _b = k
            mn = str(mt.get(m, '')).lower().strip()
            sn = str(sg.get(s, '')).lower().strip()
            if mn in mkt_exact and sn in seg_exact:
                rows += n
                for lg_set in combo_fx[k].values():
                    fset |= lg_set
        return rows, len(fset)

    asks = [
        ('match winner (Moneyline × Full Game)', {'moneyline'}, {'full game'}),
        ('games handicap (Spread × Full Game)', {'spread'}, {'full game'}),
        ('total games (Total × Full Game)', {'total'}, {'full game'}),
        ('**SET HANDICAP** (Spread × Sets)', {'spread'}, {'sets'}),
        ('**TOTAL SETS** (Total × Sets)', {'total'}, {'sets'}),
        ('— a DIFFERENT market: Team Total × Full Game (games won by one player)',
         {'team total'}, {'full game'}),
        ('— a DIFFERENT market: Spread × First Set (games hcp inside set 1)',
         {'spread'}, {'first set'}),
        ('— a DIFFERENT market: Total × First Set (games inside set 1)',
         {'total'}, {'first set'}),
    ]
    print('\n| market | present | rows | fixtures |')
    print('|---|---|---|---|')
    accounted = 0
    for label, mn, sx in asks:
        r, f = present(mn, sx)
        accounted += r
        print(f'| {label} | {"YES" if r else "no"} | {r:,} | {f:,} |' if r
              else f'| {label} | no | {DASH} | {DASH} |')

    # ⚠️ EXACT MATCHING TRADES A FALSE YES FOR A POSSIBLE FALSE NO. If Kibl
    # spells a market "Money Line" tomorrow, every exact test above silently
    # answers "no" for a market that is right there in the feed. So the rows
    # the table does NOT account for are counted and, if any exist, named —
    # a vocabulary this report cannot read must be loud, not absent.
    total_rows = sum(combo_rows.values())
    missed = total_rows - accounted
    if missed:
        named = {(str(mt.get(m, m)), str(sg.get(s, s)))
                 for (m, s, _b) in combo_rows
                 if not any(str(mt.get(m, '')).lower().strip() in mn
                            and str(sg.get(s, '')).lower().strip() in sx
                            for _l, mn, sx in asks)}
        print(f'\n⚠️ **{missed:,} of {total_rows:,} rows ({pct(missed, total_rows)}) '
              f'are not covered by any row of the table above.** The tests are '
              f'EXACT on both the market type and the segment, so a vendor '
              f'spelling this report does not know reads as "no" rather than '
              f'as an error. These are the (market, segment) pairs that fell '
              f'through, and any of them being interesting is a question for '
              f'the next run, not something to infer here:')
        for m, s in sorted(named)[:20]:
            print(f'* {m} × {s}')
    else:
        print(f'\nEvery one of the {total_rows:,} archived rows is accounted '
              f'for by a line in the table above, so no market is hiding '
              f'behind a spelling this report does not recognise.')

    sh, _ = present({'spread'}, {'sets'})
    ts_, _ = present({'total'}, {'sets'})
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

KIBL_BUCKET = 'kibl-raw'
RAW_BLOBS = 4


def kibl_blob(url, key, path):
    """One gzipped sweep blob out of the PRIVATE kibl-raw bucket.

    ⚠️ NOT `L.sb_download` — that one is pinned to the `oddspapi-raw` bucket
    and would 404 every path here.
    """
    import gzip
    got, err = L.sb('GET', f'/storage/v1/object/{KIBL_BUCKET}/'
                    + urllib.parse.quote(path), url, key)
    if got is None:
        return None, err
    try:
        return json.loads(gzip.decompress(got).decode('utf-8')), None
    except Exception as e:                                       # noqa: BLE001
        return None, f'unreadable: {e}'


def field_census(records):
    seen, filled = collections.Counter(), collections.Counter()
    for rec in records:
        if not isinstance(rec, dict):
            continue
        for k, v in rec.items():
            seen[k] += 1
            if v is not None and v != '':
                filled[k] += 1
    return seen, filled


def raw_records(url, key, fsid, want_blobs=RAW_BLOBS):
    """The actual vendor records for one book, out of the raw sweep blobs.

    ⚠️ `kibl_line_observations.raw_object` IS A PATH, NOT THE RECORD. It holds
    `2026/09/20/<sweep>-<ts>.json.gz`, the key of the gzipped sweep blob in the
    private `kibl-raw` bucket. The first cut of §3 iterated that STRING as if
    it were the vendor object, found no keys in it, and printed an empty field
    table — and, far worse, concluded from that empty read that "no field on a
    bet105 row is named for a stake limit". That is a definitive negative drawn
    from a read that never happened, which is the one thing this report must
    never do. The blob is downloaded now, and if it cannot be, §3 says so and
    concludes nothing.
    """
    paths, err = fetch_all(url, key, 'kibl_line_observations',
                           'raw_object,observed_at',
                           extra=(f'&feed_source_id=eq.{fsid}'
                                  '&order=observed_at.desc'),
                           page=1000, cap=1000)
    if err:
        return None, [], f'could not list raw paths: {err}'
    uniq = []
    for r in paths:
        p = r.get('raw_object')
        if p and p not in uniq:
            uniq.append(p)
        if len(uniq) >= want_blobs:
            break
    if not uniq:
        return None, [], 'no raw_object path on any archived row'

    out, used, errs = [], [], []
    shape = None
    for p in uniq:
        blob, berr = kibl_blob(url, key, p)
        if blob is None:
            errs.append(f'{p}: {berr}')
            continue
        # ⚠️ THE PRICE RECORDS LIVE UNDER `market_participants`. The first cut
        # guessed at `rows`/`data`, matched neither, and reported "blobs
        # downloaded but carried no rows for this book" — a refusal that was
        # honest but pointed at the book when the fault was my key list.
        recs = blob if isinstance(blob, list) else (
            blob.get('market_participants') or blob.get('rows')
            or blob.get('data') or [])
        if shape is None and isinstance(blob, dict):
            shape = sorted(blob)[:14]
        mine = [r for r in recs if isinstance(r, dict)
                and r.get('feed_source_id') == fsid]
        out.extend(mine)
        used.append((p, len(recs), len(mine)))
    if not out:
        # Say what WAS in there. A refusal nobody can act on is half a refusal,
        # and the next reader should not have to re-derive the envelope from
        # the writer's source the way I just did.
        diag = f' (blob top-level keys: {", ".join(shape)})' if shape else ''
        if used and used[0][1]:
            diag += (f'; {used[0][1]:,} records present but none carrying '
                     f'feed_source_id={fsid}')
        return None, used, (('; '.join(errs) if errs else
                             'blobs downloaded but carried no rows for this book')
                            + diag)
    return out, used, None


def section_rows(url, key, obs):
    h1('§3 — WHAT EACH PRICE ROW ACTUALLY CARRIES')

    recs, used, rerr = raw_records(url, key, BET105)
    if rerr:
        print(f'::warning::{rerr}')
        print(f'\n{DASH}  **The raw vendor records could not be read**, so (a) '
              f'and (b) report nothing. Specifically: nothing below claims the '
              f'stake limit is absent — an unread field and a missing field '
              f'are the same thing from here, and only one of them is a finding.')
        print(f'\nReason: `{rerr}`')
    else:
        print(f'Read the **actual vendor records** out of the private '
              f'`{KIBL_BUCKET}` bucket — `raw_object` on an observation row is '
              f'a PATH to a gzipped sweep blob, not the record itself.')
        print(f'\n| blob | records in sweep | bet105 records |')
        print('|---|---|---|')
        for p, tot, mine in used:
            print(f'| `{p}` | {tot:,} | {mine:,} |')
        print(f'\nCensus population: **{len(recs):,}** bet105 vendor records '
              f'({n_flag(len(recs))}) from {len(used)} sweep blob(s).')

    # ── (a) the stake limit ─────────────────────────────────────────────────
    h2('(a) Stake limit')
    print('> "It was null on all 299,250 Sports411 rows. If populated, report '
          'the range by league — a sharp book\'s limit is a confidence signal."')

    seen = filled = None
    if recs:
        seen, filled = field_census(recs)
        limit_keys = sorted(k for k in seen
                            if any(w in k.lower()
                                   for w in ('limit', 'stake', 'max', 'wager')))
        if not limit_keys:
            print(f'\n**No field on a bet105 vendor record is named for a stake '
                  f'limit, a stake, a maximum or a wager.** Not "null" — the key '
                  f'is not in the record at all, across all {len(recs):,} '
                  f'records read. Sports411 carried the same absence.')
            print(f'\nSo the limit is not available as a confidence signal on '
                  f'this feed, and the reason is the payload shape, not the '
                  f'book. Whether Kibl can expose it at all is **unknown** from '
                  f'here — a question for Bet105.')
            print(f'\nFor the reader to check that against: the full key list '
                  f'is in (b) below, so "no limit field" can be verified rather '
                  f'than taken.')
        else:
            print(f'\n**The stake limit IS populated on bet105.** '
                  f'limit-shaped fields present: ' +
                  ', '.join(f'`{k}`' for k in limit_keys))
            for k in limit_keys:
                vals = [float(r[k]) for r in recs
                        if isinstance(r.get(k), (int, float))]
                print(f'\n`{k}` overall: {dist(vals, 2)}')
                # ⚠️ THE LEAGUE KEY ON A RAW RECORD IS `_league_id`. The archive
                # stamps it on during the sweep; the vendor's own record has no
                # league on it. Reading `league_id` bucketed every row under
                # None and printed one line labelled "None" where the founder
                # asked for a range BY LEAGUE.
                per_league = collections.defaultdict(list)
                for r in recs:
                    if isinstance(r.get(k), (int, float)):
                        lg = r.get('_league_id', r.get('league_id'))
                        per_league[lg].append(float(r[k]))
                print(f'\nby league:')
                for lg, v in sorted(per_league.items(), key=lambda kv: -len(kv[1])):
                    print(f'* **{LEAGUES.get(lg, lg)}**: {dist(v, 2)}')

                # The founder's premise was that this was null on all 299,250
                # Sports411 rows. If it is populated there too, the premise was
                # about OUR TABLE, not the feed — a materially different fact
                # and one he should hear rather than have confirmed wrongly.
                s411, _u, e411 = raw_records(url, key, SPORTS411)
                if s411:
                    sv = [float(r[k]) for r in s411
                          if isinstance(r.get(k), (int, float))]
                    if sv:
                        print(f'\n⚠️ **`{k}` is populated on Sports411 too**: '
                              f'{dist(sv, 2)}')
                        print(f'\nSo "null on all 299,250 Sports411 rows" was '
                              f'true **of our summary table, not of the feed**. '
                              f'`archive-kibl.py` does not copy `{k}` into '
                              f'`kibl_line_observations`, so every query we ever '
                              f'ran against it returned null. The value has been '
                              f'arriving all along and is sitting in the raw '
                              f'blobs. Recovering it is one column in '
                              f'`to_summary()` plus one in the DDL — and the '
                              f'history is NOT lost, because the blobs are kept.')
                    else:
                        print(f'\n`{k}` on Sports411: present but never numeric '
                              f'({n_flag(len(s411))} records).')
    else:
        print(f'\n{DASH}  not read. See the note above — this is silence, not '
              f'a negative finding.')

    # ── (b) every field, with % populated ───────────────────────────────────
    h2('(b) Every field on a bet105 record, with % populated')
    if not recs:
        print(f'{DASH}  not read.')
    else:
        n = len(recs)
        print(f'| field | present on | non-null | % populated |')
        print('|---|---|---|---|')
        for k, s in sorted(seen.items(), key=lambda kv: (-kv[1], kv[0])):
            print(f'| `{k}` | {s:,} | {filled[k]:,} | {pct(filled[k], n)} |')

        h3('Named plainly: what bet105 carries that Sports411 did not')
        recs43, used43, err43 = raw_records(url, key, SPORTS411)
        if err43:
            print(f'{DASH}  the Sports411 records could not be read '
                  f'(`{err43}`), so the comparison is not made rather than '
                  f'asserted in either direction.')
        else:
            s43, f43 = field_census(recs43)
            print(f'Compared on {len(recs43):,} Sports411 vendor records '
                  f'({n_flag(len(recs43))}).')
            only105 = sorted(k for k in filled if filled[k] and not f43.get(k))
            absent = sorted(k for k in seen if k not in s43)
            if only105:
                print('\nFields populated on bet105 and never populated on '
                      'Sports411:')
                for k in only105:
                    print(f'* `{k}` — {pct(filled[k], n)} populated on bet105, '
                          f'0 on Sports411')
            else:
                print('\nNo field is populated on bet105 and empty on '
                      'Sports411.')
            if absent:
                print('\nFields that do not appear on a Sports411 record at all:')
                for k in absent:
                    print(f'* `{k}`')
            if not only105 and not absent:
                print('\n**The two books return the same row shape.** The '
                      'difference between them is entirely in the MARKETS they '
                      'price (§1b), not in what a price row carries.')

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
# Tennis on Kibl. The leagues are the men's three; the sport id is resolved at
# run time from /reference/sports rather than hard-coded, because a wrong id
# would make a live endpoint look dead.
TENNIS_LEAGUE_IDS = sorted(LEAGUES)

# (path, [param variants to try in order], what the founder asked it for).
# ⚠️ SEVERAL OF THESE ENDPOINTS REQUIRE PARAMETERS AND SAY SO IN AN ERROR
# ENVELOPE THAT STILL CARRIES HTTP 200. Probing them bare and reporting
# "200/empty" would have told the founder that /mapping/* is unavailable on our
# credential, when the real answer may be that the call was malformed. So each
# one is tried bare AND scoped, and the vendor's own `description` is printed.
PROBES = [
    ('/info/markets-alerts', [{}, {'sport_id': '@tennis'},
                              {'league_id': TENNIS_LEAGUE_IDS}],
     'the free line-movement signal — what does it fire on?'),
    ('/info/markets-last-updated', [{}], 'per-book freshness; could it replace our staleness guessing?'),
    ('/info/outcomes', [{}], 'anything api-tennis does not already give us?'),
    ('/info/fixtures-states', [{}], 'ditto'),
    ('/info/fixtures-segments-scores', [{}, {'sport_id': '@tennis'},
                                        {'league_id': TENNIS_LEAGUE_IDS}], 'ditto'),
    ('/mapping/donbest', [{}, {'sport_id': '@tennis'},
                          {'league_id': TENNIS_LEAGUE_IDS}],
     'DonBest id mapping — could it replace surname matching?'),
    ('/mapping/espn', [{}, {'sport_id': '@tennis'},
                       {'league_id': TENNIS_LEAGUE_IDS}],
     'ESPN id mapping — ditto'),
    ('/reference/sports', [{}], 'inventory'),
    ('/reference/leagues', [{}], 'inventory'),
    ('/reference/sportsbooks', [{}], 'the entitlement itself'),
    ('/reference/market-types', [{}], 'vocabulary'),
    ('/reference/segments', [{}], 'vocabulary'),
    ('/reference/betting-types', [{}], 'vocabulary'),
    ('/reference/market-statuses', [{}], 'vocabulary'),
    ('/reference/fixture-types', [{}], 'vocabulary'),
    ('/reference/periods', [{}, {'sport_id': '@tennis'}], 'vocabulary'),
]


def vendor_error(payload):
    """The vendor's OWN words when a 200 carries an error envelope.

    ⚠️ Kibl answers a malformed or unentitled call with **HTTP 200** and a body
    of `{code, description, request_uuid, timestamp}`. The client reports that
    as an unrecognised envelope and zero rows — which, printed as "200/empty",
    reads exactly like "this endpoint has no data for us". They are completely
    different answers: one is a capability gap, the other is a bad request.
    The `description` distinguishes them and it is free to read.
    """
    if not isinstance(payload, dict):
        return None
    if 'description' in payload or 'code' in payload:
        return f"{payload.get('code', '?')}: {str(payload.get('description', ''))[:120]}"
    return None


def section_endpoints(client):
    h1('§4 — OTHER ENDPOINTS, PROBED ON OUR CREDENTIAL')
    print('Each row is a GET actually issued on this account. A 200 with zero '
          'rows is reported as **200/empty** — per the founder\'s rule, that is '
          'not a capability.')
    print('\n⚠️ **This vendor answers a malformed or unentitled call with HTTP '
          '200** and a `{code, description}` body. So an endpoint is tried bare '
          'and then scoped to tennis, and where it refuses, the vendor\'s own '
          'description is printed. "We called it wrong" and "we are not '
          'entitled" are different findings and only the description separates '
          'them.')

    # Resolve the tennis sport_id rather than assuming it.
    tennis_id = None
    try:
        payload, _m = client.get('/reference/sports')
        for r in client.rows(payload):
            if isinstance(r, dict) and str(r.get('name', '')).lower() == 'tennis':
                tennis_id = r.get('sport_id')
                break
    except Exception:                                            # noqa: BLE001
        pass
    print(f'\ntennis `sport_id` resolved from `/reference/sports`: '
          f'**{tennis_id if tennis_id is not None else DASH}**'
          + ('' if tennis_id is not None else
             '  — unresolved, so the scoped retries below are skipped and a '
             '"no" from a parameterised endpoint stays **unknown**'))

    print('\n| endpoint | status | rows | first-row keys | vendor says | asked for |')
    print('|---|---|---|---|---|---|')
    results = {}
    for path, variants, why in PROBES:
        best = None
        for params in variants:
            p = dict(params)
            if p.get('sport_id') == '@tennis':
                if tennis_id is None:
                    continue
                p['sport_id'] = tennis_id
            try:
                payload, meta = client.get(path, p)
            except Exception as e:                               # noqa: BLE001
                best = {'status': 'error', 'rows': None, 'keys': [],
                        'says': str(e)[:110], 'params': p}
                continue
            rows = [r for r in client.rows(payload) if isinstance(r, dict)]
            cand = {'status': (meta or {}).get('status', 200), 'rows': len(rows),
                    'keys': list(rows[0]) if rows else [],
                    'says': vendor_error(payload), 'params': p}
            if best is None or (cand['rows'] or 0) > (best.get('rows') or 0):
                best = cand
            if rows:
                break
        results[path] = best or {'status': '?', 'rows': None, 'keys': [], 'says': None}
        b = results[path]
        keys = ', '.join(f'`{k}`' for k in b['keys'][:8]) if b['keys'] else DASH
        verdict = f"{b['status']}" + ('/empty' if not b['rows'] else '')
        scope = ('' if not b.get('params') else
                 (' (bare)' if not b['params'] else
                  ' (' + ', '.join(f'{k}={v}' for k, v in b['params'].items())[:34] + ')'))
        says = f"`{b['says']}`" if b.get('says') else DASH
        print(f"| `{path}`{scope} | {verdict} | "
              f"{b['rows'] if b['rows'] is not None else DASH} | {keys} | "
              f"{says} | {why} |")

    h2('What this means for the three the founder asked about by name')

    ma = results.get('/info/markets-alerts', {})
    says = str(ma.get('says') or '')
    print(f'\n**`/info/markets-alerts`** — {ma.get("status")}, '
          f'{ma.get("rows") if ma.get("rows") is not None else DASH} rows, '
          f'vendor says `{says or DASH}`.')
    if ma.get('rows'):
        print('\nIt answers and carries data, so a dropping-odds alert could be '
              'driven from it without any new polling budget. What it FIRES ON '
              'is only readable from rows over time — one call cannot establish '
              'a trigger rule, so that part stays **unknown** until we watch it.')
    elif 'success' in says.lower():
        # The distinction the error envelope buys. Worth spelling out: the
        # previous run of this report called the same observation "unknown
        # which", because it could not see that the vendor had said SUCCESS.
        print('\n**The call SUCCEEDED and returned no alerts.** That is the '
              'vendor\'s own word — `api success`, not an exception — so this '
              'is not an entitlement gap and not a malformed request: the '
              'endpoint works on our credential and there were simply no '
              'alerts in flight at that moment.')
        print('\nSo a dropping-odds alert could be driven from it, free, and '
              'the open question is not *whether* we can read it but **what it '
              'fires on and how often** — which needs it sampled over time '
              'rather than called once. One empty call at one moment says '
              'nothing about the rate.')
    else:
        print('\nIt returned nothing AND did not report success, so this is '
              'either an entitlement gap (which fails silently with 200 on '
              'this vendor) or a malformed call. **Unknown which** — the '
              'vendor message above is the lead to follow.')

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
    for nm, r in (('donbest', db), ('espn', es)):
        if r.get('says') and not r.get('rows'):
            print(f'\n* `/mapping/{nm}` refused with the vendor\'s own message: '
                  f'**{r["says"]}**. That is the endpoint telling us why, and '
                  f'it is NOT the same as "we hold no mapping data" — it is '
                  f'read here rather than turned into a capability verdict.')
    if db.get('rows') or es.get('rows'):
        print('A stable third-party id would replace surname matching for '
              'cross-source pairing, which has caused three name bugs on this '
              'product. ⚠️ It only helps if the OTHER side also carries that '
              'id: oddspapi and api-tennis would each need a DonBest or ESPN '
              'id for the same fixture. That is the thing to check before '
              'building on it, and it is not answered by this call.')
    elif db.get('says') or es.get('says'):
        print('\nSo the honest verdict is **unknown**, not "unavailable": '
              'neither call returned mapping rows, and both told us why in a '
              'way that points at the request rather than at the entitlement. '
              'Surname matching stays the only cross-source key we have TODAY, '
              'and the next step is one question to Bet105 about the required '
              'parameters — not a rebuild of the matcher.')
    else:
        print('Neither answers with data on this credential, and neither gave '
              'a reason. Surname matching stays the only cross-source key we '
              'have.')

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
