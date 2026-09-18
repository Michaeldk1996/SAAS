#!/usr/bin/env python3
"""TEN-225 / TEN-232 — fill odds_card_state (match winner) from the KIBL archive.

Founder ruling 2026-09-18T00:18Z: Kibl (Sports411 / Bet105) is the PRIMARY book.
Order is kibl(1) -> bet365 via oddspapi(2) -> api-tennis(3). One book per
fixture; Open, Now and Close always from the SAME book; a higher-priority book
that appears later takes over all three values using its own first tick as Open.

ZERO Kibl API calls and zero oddspapi units. Everything here is a projection of
what the archive already stored:

    kibl_line_observations  -> Open, Now, Close candidates
    kibl_fixtures           -> player names, scheduled time, match_key
    oddspapi_line_summary   -> the RESOLVED start (so the ladder runs once)
    oddspapi_fixtures       -> the names that let a kibl fixture find that start

WHAT IS DIFFERENT ABOUT KIBL, AND WHY THAT MATTERS TO EVERY RULE BELOW
---------------------------------------------------------------------
Oddspapi is a HISTORY feed: we fetch a finished fixture's whole tick series
afterwards, so "did the archive decay eat the tail" is the live question and the
21-day window answers it. Kibl is a LIVE feed with no history endpoint at all:
we hold exactly the prices our own sweeps caught, and a fixture is archived
BEFORE it starts, not after. Transplanting the 21-day test would mark every
correctly-captured Kibl close unreliable (age_days is negative on a capture that
preceded the start). So the close test here is the LAG limb of Michael's ruling 2
— the part that asks how close to the start our last pre-start price sits — and
the decay limb is reported as inapplicable rather than silently dropped. See
judge_close_live(). That difference is flagged to Michael, not ruled here.

THREE TIMESTAMP FACTS THAT ARE NOT INTERCHANGEABLE
--------------------------------------------------
  inserted_on   Kibl's OWN row-write time. Founder: "Every Kibl timestamp is
                vendor-insert time, not book-post time. Label it that way in the
                data." -> ts_kind = 'vendor-insert' on every row this file
                writes. It is the price's time and it is what Open/Now/Close are
                stamped with.
  observed_at   when OUR sweep ran. Never rendered. It is our cadence, not the
                market's, and mixing it into a published timestamp is exactly
                what makes a book look slower than it is.
  scheduled_start  Kibl's scheduled time. NEVER a Close cutoff (standing rule).

Reads SUPABASE_URL / SUPABASE_SECRET_KEY. Stdlib only. Secrets never printed.
"""
import argparse
import collections
import json
import os
import sys
import types
import urllib.parse
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'ten225-kibl-card-state.json')

from ten225_names import match_key as mk_of, name_key  # noqa: E402
import ten225_orientation as ORI  # noqa: E402

# The board file, read for its INDEPENDENT prices only. It is the api-tennis /
# oddspapi view of the same matches, oriented to its own p1/p2, and nothing on
# the Kibl path writes to it — which is what makes it a valid control.
MATCHES = os.path.join(HERE, 'matches.json')

MARKET = 'match winner'
BOOK = 'sports411'          # the book we are actually served; NOT Bet105 (measured)
SOURCE = 'kibl'
BOOK_RANK = 1
TS_KIND = 'vendor-insert'
PAGE = 1000                 # PostgREST caps a page here; asking for more truncates
MIN_N = 30                  # standing rule: flag anything below this

# Kibl market identity for "match winner", from /reference (not from the spec):
#   market_type_id 1 = Moneyline, segment_id 1 = Full Game, betting_type_id 1 =
#   Prematch. Live for tennis is 3 ("Live Fluid"), NOT the 2 the swagger implies,
#   and it returns zero rows on this entitlement — so a betting_type filter of
#   {1} is not merely a prematch preference, it is everything we are served.
# The observation columns the rules below actually READ. A module constant, not
# an inline string, so the harness can assert on the VALUE rather than on the
# source text — an assertion against the source matched this very comment and
# passed while the column was missing (mutation j, first attempt).
#
# ⚠️ fixture_participant_id is LOAD-BEARING, not diagnostic: side_labels_for()
# orders a fixture's two sides by it. Run 35295569715 omitted it and every one
# of 25 priced fixtures came back undecidable — 0 card rows. It failed in the
# safe direction, a dash rather than a wrong price, but it failed silently.
OBS_COLUMNS = (
    'fixture_id,side_id,participant_id,fixture_participant_id,'
    'market_type_id,segment_id,betting_type_id,is_live,'
    'is_opener,is_current,price_decimal,inserted_on,observed_at,alt_id,'
    'is_main,point')

MARKET_TYPE_ID = 1
SEGMENT_ID = 1
BETTING_TYPE_ID = 1

# Founder ruling 2026-09-18 item 2: "is_main unfiltered". alt_id is 0 on every
# row we are served (measured), so there are no alternates to separate today;
# this file does not assume that, it just does not filter on it.

# Import the line-summary loader's shared helpers rather than restating its
# rules. exec of the source text, not importlib: macOS caches bytecode outside
# the repo and a same-size restore can serve stale code.
L = types.ModuleType('L')
L.__file__ = os.path.join(HERE, 'ten225-load-line-summary.py')
_argv, sys.argv = sys.argv, ['L']
exec(compile(open(L.__file__).read(), L.__file__, 'exec'), L.__dict__)
sys.argv = _argv

# And the oddspapi card filler's Now rule — ONE Now rule for every source, so a
# price cannot qualify as "Now" on one card path and not on another.
C = types.ModuleType('C')
C.__file__ = os.path.join(HERE, 'ten225-load-card-state.py')
_argv, sys.argv = sys.argv, ['C']
exec(compile(open(C.__file__).read(), C.__file__, 'exec'), C.__dict__)
sys.argv = _argv

epoch, iso, sb, creds = L.epoch, L.iso, L.sb, L.creds
qualifies_as_now = C.qualifies_as_now
RELIABLE_LAG_MIN = L.RELIABLE_LAG_MIN
FLIP_GAP_MAX_S = L.FLIP_GAP_MAX_S


# ------------------------------------------------------------------- the rules

def is_match_winner(obs):
    """Is this observation the two-way match-winner line?

    All three ids are checked, not just market_type_id. Moneyline on a SET
    segment would also be market_type_id 1, and pricing a set winner as the
    match winner is the kind of error that renders as a perfectly plausible
    number. (Measured: this entitlement returns no Sets segment at all — which
    is why the filter has to be explicit rather than relying on that staying
    true.)
    """
    return (obs.get('market_type_id') == MARKET_TYPE_ID
            and obs.get('segment_id') == SEGMENT_ID
            and obs.get('betting_type_id') == BETTING_TYPE_ID
            and obs.get('is_live') is not True)


def side_labels_for(obs_list):
    """This fixture's Kibl side_ids -> our '1'/'2' labels. {} if undecidable.

    ⚠️ THE PREVIOUS VERSION OF THIS FUNCTION WAS WRONG AND ITS FIRST BRANCH WAS
    UNREACHABLE. It mapped side_id 1 -> '1' and 2 -> '2' and dropped the rest.
    Measured on run 35295326133 over 7,237 match-winner rows / 1,795 fixtures:

        side_id census            {2: 3617, 3: 3620}
        shape per fixture         {'2+3': 1795}   (1795 of 1795)

    **side_id 1 does not exist on this feed.** So the old mapping wrote every
    price into side '2' and discarded side 3 as an "unknown side" — half of a
    two-way market, dropped, while the run stayed green and Open read 100%
    (of the one side it kept). The 90 "odd" side_id-3 rows were never an
    oddity; they were the other player.

    WHAT IS MEASURED, AND WHAT IS STILL ASSUMED
    -------------------------------------------
    Measured: side_id pins exactly ONE participant_id per fixture (0 of 3,590
    (fixture, side_id) pairs map to more than one), and every fixture carries
    exactly two distinct participants (1,795 of 1,795). So side_id is a stable
    participant slot. That part is not in doubt.

    Assumed, and therefore adjudicated rather than trusted: that the LOWER
    `fixture_participant_id` is the fixture string's FIRST-named player. The
    ids run consecutively per fixture (e.g. 1029618 / 1029619) which is
    suggestive, but suggestive is not measured. `raw_object` carries no
    name-like field anywhere in the payload (0 found), so the mapping is not
    answerable from what we store — it is answerable only by cross-checking the
    resulting favourite against an independent book, which is what
    ten225_orientation does, and the guard dashes whatever disagrees.

    Ordering on `fixture_participant_id` and NOT on `side_id` is deliberate:
    "2 before 3" is an ordering of two arbitrary labels, and if a future
    fixture arrives as 1+2 or 3+4 a side_id ordering would silently mean
    something different. The participant id is the thing that actually
    identifies the player.
    """
    pairs = {}
    for o in obs_list:
        sid, pid = o.get('side_id'), o.get('fixture_participant_id')
        if sid is None or pid is None:
            continue
        # One participant per side is the measured invariant. If a fixture ever
        # violates it, the fixture is undecidable and every line on it dashes —
        # never resolved by majority, which would render a real price on a side
        # we cannot name.
        if sid in pairs and pairs[sid] != pid:
            return {}
        pairs[sid] = pid
    if len(pairs) != 2:
        # Exactly two sides, or we cannot orient. A one-sided fixture has no
        # favourite and nothing to check it against.
        return {}
    ordered = sorted(pairs.items(), key=lambda kv: kv[1])
    return {ordered[0][0]: '1', ordered[1][0]: '2'}


def open_of(obs_list):
    """The book's OPENING price for one line. Founder: "Open = is_opener price,
    with inserted_on".

    Only a row Kibl itself flagged `is_opener` can be an Open. The earliest
    observation WE hold is our first sighting, not the book's opener, and
    stamping it "Open" would be exactly the approximation the standing rules
    forbid — so a line with no opener row dashes its Open.

    Among opener rows the EARLIEST inserted_on wins (first sighting wins
    forever). Two opener rows sharing one inserted_on but disagreeing on price
    is a contradiction we cannot resolve, so it drops on ambiguity.

    Returns (price, ts_iso, reason) — exactly one of price/reason is set.
    """
    openers = [o for o in obs_list
               if o.get('is_opener') and o.get('price_decimal') is not None
               and epoch(o.get('inserted_on')) is not None]
    if not openers:
        return None, None, 'no_opener_row'
    openers.sort(key=lambda o: epoch(o['inserted_on']))
    first_ts = epoch(openers[0]['inserted_on'])
    tied = {float(o['price_decimal']) for o in openers
            if epoch(o['inserted_on']) == first_ts}
    if len(tied) > 1:
        return None, None, 'ambiguous_opener'
    return float(openers[0]['price_decimal']), openers[0]['inserted_on'], None


def newest_of(obs_list):
    """The freshest price we hold for one line, by VENDOR time.

    Ordered on inserted_on (the price's own time) and only then on observed_at
    (our sweep's time) as a tie-break. Ordering on observed_at first would make
    a sweep that re-saw an old price look like a new price.
    """
    usable = [o for o in obs_list
              if o.get('price_decimal') is not None
              and epoch(o.get('inserted_on')) is not None]
    if not usable:
        return None
    usable.sort(key=lambda o: (epoch(o['inserted_on']),
                               epoch(o.get('observed_at')) or 0.0))
    return usable[-1]


def close_of(obs_list, start_ts):
    """The last price held STRICTLY BEFORE the start. Founder: "Close = last
    pre-start price held; exclude any in-play row by start time".

    `start_ts` is the TEN-225 ladder's answer (gated oddspapi trueStartTime, or
    the api-tennis live flip). It is never Kibl's scheduled_start — the standing
    rule forbids the schedule as a cutoff and Kibl publishes nothing else.
    No start -> no Close. Dash, with the reason carried on the row.

    The comparison is on inserted_on, the price's own time, and it is strict:
    a price inserted AT the start instant is not demonstrably pre-start.
    """
    if start_ts is None:
        return None
    pre = [o for o in obs_list
           if o.get('price_decimal') is not None
           and epoch(o.get('inserted_on')) is not None
           and epoch(o['inserted_on']) < start_ts]
    if not pre:
        return None
    pre.sort(key=lambda o: (epoch(o['inserted_on']),
                            epoch(o.get('observed_at')) or 0.0))
    return pre[-1]


def judge_close_live(start_ts, close_ts, start_src='oddspapi', flip_gap=None):
    """Is a LIVE-CAPTURED close good enough to render? -> (reliable, lag_minutes)

    This is Michael's ruling 2 with its two limbs separated, because only one of
    them is about this source:

      LAG limb (applies): the last pre-start price must sit within
      RELIABLE_LAG_MIN of the start. A price from four hours before the start is
      not a close, whoever captured it.

      DECAY limb (does NOT apply): the 21-day window asks whether oddspapi's
      archive had already eaten the tail by the time we fetched it. Kibl has no
      history endpoint, so nothing is ever fetched after the fact — every close
      here was captured before the start it is judged against, which makes
      age_days negative and would fail judge_close() unconditionally. Applying it
      would not be conservative, it would be vacuous: zero Kibl closes, forever,
      on a green run.

      FLIP-GAP limb (applies, unchanged): a close cut at the live-flip lower
      bound inherits that bound's uncertainty, so it needs gap_seconds <= 300.
      An UNKNOWN gap is not a pass.

    ⚠️ RULED, NOT PROPOSED — DO NOT REINSTATE THE DECAY LIMB HERE.
    Founder ruling 2026-09-18 item 2, in his words: *"21-day decay limb for
    Kibl: agreed, skip it. It assumes post-match retrieval and Kibl has no
    history — every Kibl close is captured live, which is what the rule wants.
    Keep the <=60-min lag limb and the <=300 s flip-gap limb. Document the
    exemption in the code so nobody reinstates it."*

    The exemption is SOURCE-SPECIFIC and does not generalise: `judge_close()` in
    the line-summary loader keeps its 21-day window, because oddspapi IS fetched
    after the fact and there the window is the whole point. A future run that
    "harmonises" the two judges has broken this ruling in the direction that
    reports zero coverage on a green run. Locked by test-ten225-kibl-card-state.
    """
    if start_ts is None or close_ts is None:
        return False, None
    lag_min = (start_ts - close_ts) / 60.0
    if lag_min < 0:
        # An in-play price reached the close slot. close_of() makes this
        # unreachable; the assertion stays because it is the one failure that
        # must never render.
        return False, lag_min
    reliable = lag_min <= RELIABLE_LAG_MIN
    if reliable and start_src == 'api-tennis-live':
        reliable = flip_gap is not None and flip_gap <= FLIP_GAP_MAX_S
    return reliable, lag_min


# --------------------------------------------------------- cross-feed pairing

def day_candidates(day):
    """The scheduled day and its two neighbours.

    A fixture at 23:40 UTC on one feed and 00:10 on the other is one match. The
    line-summary loader already does this for the live-flip pairing; the same
    allowance is needed here or every near-midnight match silently unpairs.
    """
    if not day:
        return []
    return [day, L._shift_day(day, -1), L._shift_day(day, 1)]


def index_oddspapi(fx_rows, summary_rows):
    """oddspapi fixtures + summary -> {match_key: resolved-start record}.

    DROPS ON AMBIGUITY from both sides: two oddspapi fixtures on one match_key
    means we cannot tell which start belongs to which match, so neither is
    offered and both Kibl closes dash. A guessed start is worse than no close —
    it pins a price to the wrong instant and nothing downstream can tell.

    Returns (index, stats). The record carries the start AND the per-side prices,
    because the orientation cross-check needs the same pairing.
    """
    by_key, ambiguous = {}, set()
    st = collections.Counter()
    fx_by_id = {f['fixture_id']: f for f in fx_rows}
    for f in fx_rows:
        day = (f.get('true_start') or f.get('scheduled_start') or '')[:10]
        k = mk_of(day, f.get('player1'), f.get('player2'))
        if not k:
            # WHY it could not be keyed, not just that it could not. Run
            # 35291839986 reported 49,287 unkeyable fixtures and the counter
            # could not say whether that was a pairing problem or an empty
            # column — it was an empty column, and the undifferentiated count
            # cost a round trip to find out.
            if not (f.get('player1') and f.get('player2')):
                st['oddspapi_no_player_names'] += 1
            elif not day:
                st['oddspapi_no_day'] += 1
            else:
                st['oddspapi_same_surname'] += 1
            st['oddspapi_fixture_unkeyable'] += 1
            continue
        if k in by_key:
            ambiguous.add(k)
        by_key[k] = f['fixture_id']

    starts = {}
    for r in summary_rows:
        if r.get('market') != MARKET:
            continue
        starts.setdefault(r['fixture_id'], {})[r.get('side')] = r

    index = {}
    for k, fid in by_key.items():
        if k in ambiguous:
            st['oddspapi_ambiguous'] += 1
            continue
        sides = starts.get(fid)
        if not sides:
            st['oddspapi_no_summary'] += 1
            continue
        any_row = next(iter(sides.values()))
        index[k] = {
            'fixture_id': fid,
            # The fixture's OWN player order, carried so the orientation check
            # can resolve oddspapi's favourite to a NAME. Without it the only
            # thing comparable is slot-to-slot, and the two feeds do not share
            # an order — see ten225_orientation's header.
            'player1': fx_by_id[fid].get('player1'),
            'player2': fx_by_id[fid].get('player2'),
            'start_ts': epoch(any_row.get('start_ts')),
            'start_ts_source': any_row.get('start_ts_source') or 'none',
            'start_reject_reason': any_row.get('start_reject_reason'),
            'flip_gap_seconds': any_row.get('flip_gap_seconds'),
            'sides': sides,
        }
        st['oddspapi_indexed'] += 1
    return index, st


def find_start(kibl_fx, odds_index):
    """A Kibl fixture -> the oddspapi-resolved start, or a no-start record.

    Tries the scheduled day and its neighbours. Never derives a start of its own:
    the ladder lives in resolve_start() and running a second copy of it here is
    how two rows of one fixture end up with two different start_ts_source values.
    """
    base = (kibl_fx.get('scheduled_start') or '')[:10]
    k1 = name_key(kibl_fx.get('player1_name'))
    k2 = name_key(kibl_fx.get('player2_name'))
    if not (k1 and k2) or k1 == k2:
        return None, 'unpairable_name'
    for d in day_candidates(base):
        k = mk_of(d, kibl_fx.get('player1_name'), kibl_fx.get('player2_name'))
        if k and k in odds_index:
            return odds_index[k], None
    return None, 'no_oddspapi_pair'


# ------------------------------------------------------------ the build itself

def build_rows(kibl_fixtures, observations, odds_index, as_of):
    """kibl_fixtures + kibl_line_observations -> odds_card_state rows.

    One row per (fixture, side). `observations` is {fixture_id: [obs, ...]}.
    """
    rows, st = [], collections.Counter()
    unknown_sides = collections.defaultdict(list)
    side_shapes = collections.Counter()
    for fx in kibl_fixtures:
        fid = fx['fixture_id']
        obs = [o for o in observations.get(fid, []) if is_match_winner(o)]
        if not obs:
            st['fixture_no_match_winner_rows'] += 1
            continue
        st['fixtures_with_rows'] += 1

        rec, why = find_start(fx, odds_index)
        start_ts = rec['start_ts'] if rec else None
        start_src = rec['start_ts_source'] if rec else 'none'
        reject = rec['start_reject_reason'] if rec else None
        flip_gap = rec.get('flip_gap_seconds') if rec else None
        st[f'start_{why or start_src}'] += 1

        sched = epoch(fx.get('scheduled_start'))
        now_ok, now_basis = qualifies_as_now(start_ts, sched, as_of)

        # WHICH side_ids this fixture actually carries, as a set. The counts
        # alone cannot answer the question that matters: run 35294707656 showed
        # 25 fixtures priced, 25 card rows and 90 side_id-3 rows, and "90 odd
        # rows" reads as a fringe oddity — while "every fixture carries exactly
        # one recognised side plus side_id 3" says the two-way market is not
        # two-way as we read it, which is a different finding entirely.
        side_shapes[frozenset(o.get('side_id') for o in obs)] += 1

        labels = side_labels_for(obs)
        if not labels:
            st['fixture_undecidable_sides'] += 1
        by_side = collections.defaultdict(list)
        for o in obs:
            s = labels.get(o.get('side_id'))
            if s is None:
                # Name the value. Run 35291839986 counted 88 of these and could
                # not say whether the feed carries a third side or simply omits
                # the field on some rows — two very different findings.
                st['obs_unknown_side'] += 1
                st[f'obs_side_id_{o.get("side_id")}'] += 1
                # Founder ruling 2026-09-18 item 3: keep dashing side_id 3, and
                # report how often it appears AND ON WHICH FIXTURES — he is
                # asking Bet105 what it is, and a bare count is not a question
                # anyone can answer.
                unknown_sides[o.get('side_id')].append({
                    'fixture_id': fid,
                    'fixture': fx.get('name'),
                    'league_id': fx.get('league_id'),
                    'scheduled_start': fx.get('scheduled_start'),
                    'price': o.get('price_decimal'),
                    'inserted_on': o.get('inserted_on'),
                })
                continue
            by_side[s].append(o)

        for side, lst in sorted(by_side.items()):
            open_price, open_ts, open_reason = open_of(lst)
            if open_reason:
                st[f'open_{open_reason}'] += 1
            else:
                st['open_ok'] += 1

            newest = newest_of(lst) if now_ok else None
            if now_ok and newest is None:
                st['now_no_usable_row'] += 1
            elif not now_ok:
                st['now_withheld_not_prematch'] += 1
            else:
                st['now_ok'] += 1

            close_obs = close_of(lst, start_ts)
            close_ts = close_obs['inserted_on'] if close_obs else None
            reliable, lag = judge_close_live(start_ts, epoch(close_ts),
                                             start_src, flip_gap)
            if close_obs and not reliable:
                st['close_withheld_unreliable'] += 1
            elif reliable:
                st['close_ok'] += 1
            else:
                st['close_absent'] += 1

            rows.append({
                'fixture_id': str(fid),
                'id_space': SOURCE,
                'book': BOOK,
                'market': MARKET,
                'side': side,
                'line': None,
                'match_key': fx.get('match_key'),
                'book_rank': BOOK_RANK,
                # Never set by a filler — the selection pass owns it.
                'is_selected': False,
                'ts_kind': TS_KIND,
                'open_price': open_price,
                'open_ts': open_ts,
                # Kibl carries max_limit on the wire but it reads 0.0 = "not
                # provided" on every row we are served. 0.0 is a limit-shaped
                # number, so it is stored as NULL, never as a stake limit.
                'open_limit': _limit(lst),
                'now_price': (float(newest['price_decimal']) if newest else None),
                'now_ts': (newest['inserted_on'] if newest else None),
                'close_price': (float(close_obs['price_decimal'])
                                if (close_obs and reliable) else None),
                'close_ts': close_ts if (close_obs and reliable) else None,
                'start_ts': iso(start_ts) if start_ts is not None else None,
                'start_ts_source': start_src,
                'start_reject_reason': reject,
                'source': SOURCE,
                'label': None,
                # Report-only fields, stripped before the upsert.
                '_now_basis': now_basis,
                '_close_lag_min': lag,
                '_start_why': why,
            })
            st['rows'] += 1
    shapes = {'+'.join(str(x) for x in sorted(k, key=lambda v: (v is None, v))): n
              for k, n in side_shapes.items()}
    return rows, st, {str(k): v for k, v in unknown_sides.items()}, shapes


def _limit(obs_list):
    """The stake limit, or None. 0.0 means "not provided" on this feed."""
    for o in obs_list:
        v = o.get('max_limit')
        if v not in (None, '', 0, 0.0):
            try:
                return float(v)
            except (TypeError, ValueError):
                return None
    return None


# -------------------------------------------------- the book-priority selection

def run_selection(url, key, dry_run=False):
    """Re-decide is_selected across EVERY source, then write it back.

    ⚠️ THIS MUST READ THE WHOLE TABLE, NOT THIS RUN'S ROWS. The three sources are
    filled by three different jobs at three different times; a pass that only saw
    its own rows could never demote a bet365 row that Kibl has just taken over,
    and "a higher-priority book that appears later takes over all three values"
    is precisely the founder's instruction. Selecting from a partial view is how
    a card ends up showing two books at once — or, worse, keeps showing the old
    one because nothing ever told it to stop.

    The write-back sends the NOT NULL columns alongside is_selected: PostgREST
    upserts as INSERT ... ON CONFLICT DO UPDATE, and a payload missing a NOT NULL
    column can fail on the insert tuple even when every row is really an update.
    No price column is in the payload, so this pass cannot alter a price.
    """
    # EVERY column, not just the ones the pass changes. PostgREST upserts as
    # INSERT ... ON CONFLICT DO UPDATE, so a partial payload is a partial INSERT
    # TUPLE on any row whose conflict does not fire. Run 35291839986 is why this
    # is spelled out: a payload of keys + is_selected produced a candidate row
    # with every price NULL and is_selected true, which the selected_ck CHECK
    # rejected — correctly, and loudly, which is the only reason the real problem
    # (the grain constraint) surfaced at all instead of silently inserting 26,302
    # duplicate rows. Round-tripping the whole row makes the payload valid on
    # either branch; the schema's NULLS NOT DISTINCT repair makes the INSERT
    # branch unreachable. Both, because either alone leaves a hole.
    cols = ('fixture_id,id_space,book,market,side,line,match_key,book_rank,'
            'is_selected,ts_kind,source,label,start_ts,start_ts_source,'
            'start_reject_reason,open_price,open_ts,open_limit,now_price,now_ts,'
            'close_price,close_ts')
    rows, err = fetch_all(url, key, 'odds_card_state', cols)
    if err:
        print(f'::error::reading odds_card_state for selection failed ({err})')
        return None, err
    before = sum(1 for r in rows if r.get('is_selected'))
    n_before = len(rows)
    rows, st = select_winners(rows)
    after = sum(1 for r in rows if r['is_selected'])
    print(f'selection over the WHOLE table: n={n_before} rows, '
          f'selected {before} -> {after}  {dict(st)}')
    if dry_run:
        return st, None
    sent, uerr = L.upsert(url, key, 'odds_card_state', rows,
                          'fixture_id,book,market,side,line')
    print(f'selection write-back: {sent}/{len(rows)}'
          + (f' — FAILED {uerr}' if uerr else ''))
    if uerr:
        return st, uerr

    # MUTATE, THEN COUNT. An upsert whose conflict never fires reports success
    # and doubles the table; the only thing that can tell the two apart is the
    # row count afterwards. Read it back rather than trusting the write.
    after_rows, rerr = fetch_all(url, key, 'odds_card_state', 'fixture_id')
    if rerr:
        print(f'::warning::could not re-count odds_card_state ({rerr}); the '
              f'write-back is unverified')
    elif len(after_rows) != n_before:
        print(f'::error::odds_card_state went {n_before} -> {len(after_rows)} '
              f'rows on a pass that updates in place. The grain constraint is '
              f'not matching, so every upsert is inserting a duplicate.')
        return st, f'row count {n_before} -> {len(after_rows)}'
    else:
        print(f'row count unchanged at {n_before} — the write-back updated in '
              f'place (proof the grain constraint matched)')
    st['row_count'] = n_before
    return st, None


def select_winners(rows):
    """Founder ruling: one book per fixture, lowest book_rank wins.

    Operates on (match_key, market, side, line) — NOT on fixture_id, because the
    three sources key the same match under three different id spaces and
    fixture_id cannot see that they are one match.

    A row with NO match_key cannot be shown to be a duplicate of anything AND
    cannot be joined to a board match, so it is never selected. That is the
    conservative direction: an unselected row renders nothing, which is the dash
    the standing rules ask for.

    A row carrying none of Open/Now/Close is not selected either — selecting it
    would let an empty rank-1 row hide a populated rank-2 one, which is the exact
    way a priority change makes a working card go blank.

    Returns (rows, stats) with is_selected set in place.
    """
    groups, st = collections.defaultdict(list), collections.Counter()
    for r in rows:
        r['is_selected'] = False
        if not r.get('match_key'):
            st['no_match_key'] += 1
            continue
        if (r.get('open_price') is None and r.get('now_price') is None
                and r.get('close_price') is None):
            st['empty_row'] += 1
            continue
        groups[(r['match_key'], r['market'], r['side'], r.get('line'))].append(r)

    for k, cands in groups.items():
        top = min(int(c['book_rank']) for c in cands)
        winners = [c for c in cands if int(c['book_rank']) == top]
        if len(winners) > 1:
            # Two rows of one rank on one logical line: two fixtures of one
            # source paired onto one match. Ambiguous -> neither is selected,
            # because picking either would be a coin toss rendered as a price.
            st['rank_tie_dropped'] += 1
            continue
        winners[0]['is_selected'] = True
        st[f'selected_rank_{top}'] += 1
        st['demoted'] += len(cands) - 1
    st['selected'] = sum(1 for r in rows if r['is_selected'])
    return rows, st


# ---------------------------------------------- the orientation cross-check

def load_matches():
    """The board file, or [] with a counted reason. Never an exception.

    An unreadable board must not take the card path down — it must take the
    CROSS-CHECK down, which then dashes every Kibl row via the guard. Failing
    open here would ship unverified prices on a green run, which is the exact
    shape of the defect this whole control exists to catch.
    """
    try:
        with open(MATCHES) as fh:
            m = json.load(fh)
        return (m if isinstance(m, list) else []), None
    except (OSError, ValueError) as e:
        return [], str(e)


def run_orientation(rows, kibl_fixtures, odds_index, matches):
    """The side-mapping control and the guard it feeds, in one pass.

    Founder ruling 2026-09-18 item 1. The comparison itself lives in
    ten225_orientation — one copy of the rule, driven here on live data and
    driven by the harness on the reversed-universe payload that live data
    cannot supply.

    Kibl's favourite is taken from the OPEN price, because Open is the value
    the founder's rule names and the one every Kibl row carries.

    Returns (report, dashed_match_keys).
    """
    prices = collections.defaultdict(dict)
    for r in rows:
        if r.get('open_price') is not None:
            prices[int(r['fixture_id'])][r['side']] = r['open_price']

    kibl_index, kst = ORI.kibl_favourites(
        [{'fixture_id': int(f['fixture_id']),
          'player1_name': f.get('player1_name'),
          'player2_name': f.get('player2_name'),
          'name': f.get('name'),
          'scheduled_start': f.get('scheduled_start')}
         for f in kibl_fixtures], prices)

    board_index, bst = ORI.board_favourites(matches)
    odds_reads = ORI.oddspapi_favourites(odds_index)

    # Every independent reading for a match, from every non-Kibl source.
    independent = collections.defaultdict(dict)
    for k, rec in board_index.items():
        independent[k].update(rec['readings'])
    for k, rec in odds_reads.items():
        independent[k]['oddspapi:line_summary'] = rec

    vmap = ORI.verdicts(kibl_index, independent)
    report = ORI.agreement(vmap)
    report['kiblStats'] = dict(kst)
    report['boardStats'] = dict(bst)
    report['oddspapiReadings'] = len(odds_reads)

    dashed = {k for k, v in vmap.items() if v['verdict'] == 'disagree'}
    return report, dashed


def apply_orientation_guard(rows, dashed, st):
    """Founder ruling 2026-09-18 item 1: *"if a Kibl fixture's favourite
    disagrees with an independent source on the same match, dash it and log it,
    rather than display."*

    Dashes the PRICES and leaves the row, so the disagreement stays auditable in
    the table instead of vanishing. A row with no price is never selected
    (select_winners drops empty rows), so a dashed row cannot hide a good
    bet365 row behind a rank-1 Kibl one — it steps aside for it.
    """
    for r in rows:
        if r.get('match_key') in dashed:
            for f in ('open_price', 'open_ts', 'open_limit',
                      'now_price', 'now_ts', 'close_price', 'close_ts'):
                r[f] = None
            r['label'] = 'orientation-disagreement'
            st['orientation_guard_dashed'] += 1
    return rows


# -------------------------------------------------------------------- plumbing

def fetch_all(url, key, table, cols, extra='', order='fixture_id.asc'):
    """Page a table. PostgREST caps a page at 1,000 rows and truncates silently
    past that, so the loop is not an optimisation — without it a full read is a
    quiet 1,000-row lie."""
    out, offset = [], 0
    while True:
        got, err = sb('GET', f'/rest/v1/{table}?select={cols}{extra}'
                             f'&order={order}&limit={PAGE}&offset={offset}',
                      url, key)
        if got is None:
            return out, err
        rows = json.loads(got.decode('utf-8'))
        out.extend(rows)
        if len(rows) < PAGE:
            return out, None
        offset += PAGE


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--days-back', type=int, default=45,
                    help='how far back to read observations')
    a = ap.parse_args()

    url, key = creds()
    as_of = datetime.now(timezone.utc).timestamp()
    result = {'generatedAt': iso(as_of), 'market': MARKET, 'book': BOOK,
              'source': SOURCE}

    fx, err = fetch_all(url, key, 'kibl_fixtures',
                        'fixture_id,league_id,scheduled_start,name,'
                        'player1_name,player2_name,match_key,first_seen_at')
    if err:
        print(f'::error::reading kibl_fixtures failed ({err})')
        return 1
    print(f'kibl_fixtures: {len(fx)} rows')
    if not fx:
        # A wholly empty surface for a structural reason is the failure that
        # hides longest. The sweep has been running since 2026-09-17; zero
        # fixtures means the projection never wrote, not that tennis stopped.
        print('::error::kibl_fixtures is empty — the sweep has not projected '
              'fixtures yet. Refusing to report a clean zero as coverage.')
        return 1

    obs_rows, err = fetch_all(
        url, key, 'kibl_line_observations',
        OBS_COLUMNS,
        f'&market_type_id=eq.{MARKET_TYPE_ID}&segment_id=eq.{SEGMENT_ID}'
        f'&betting_type_id=eq.{BETTING_TYPE_ID}'
        # Bounded on OUR capture time, not on the price's. A window on
        # inserted_on would drop a still-valid opener the moment the book's
        # opening price aged past the cutoff, which is the one row the whole
        # source exists to carry.
        f'&observed_at=gte.{iso(as_of - a.days_back * 86400)}',
        order='fixture_id.asc,inserted_on.asc')
    if err:
        print(f'::error::reading kibl_line_observations failed ({err})')
        return 1
    observations = collections.defaultdict(list)
    for o in obs_rows:
        observations[o['fixture_id']].append(o)
    print(f'kibl_line_observations: {len(obs_rows)} match-winner rows over '
          f'{len(observations)} fixtures')

    ofx, err = fetch_all(url, key, 'oddspapi_fixtures',
                         'fixture_id,player1,player2,scheduled_start,true_start,'
                         'category_name')
    if err:
        print(f'::error::reading oddspapi_fixtures failed ({err})')
        return 1
    osum, err = fetch_all(url, key, 'oddspapi_line_summary',
                          'fixture_id,market,side,open_price,open_ts,close_price,'
                          'start_ts,start_ts_source,start_reject_reason,'
                          'flip_gap_seconds',
                          f'&market=eq.{urllib.parse.quote(MARKET)}')
    if err:
        print(f'::error::reading oddspapi_line_summary failed ({err})')
        return 1
    odds_index, ist = index_oddspapi(ofx, osum)
    print(f'oddspapi pairing index: {len(odds_index)} match keys  {dict(ist)}')

    rows, st, unknown_sides, side_shapes = build_rows(
        fx, observations, odds_index, as_of)
    print(f'side_id shapes per priced fixture: {side_shapes}')
    two_way = sum(n for k, n in side_shapes.items() if '1' in k.split('+')
                  and '2' in k.split('+'))
    print(f'fixtures carrying BOTH sides 1 and 2: {two_way} of '
          f'{sum(side_shapes.values())} — a fixture with one recognised side '
          f'has no favourite, so it cannot enter the orientation check')
    print(f'kibl card rows: {len(rows)}  {dict(st)}')
    for sid, hits in sorted(unknown_sides.items()):
        fixtures = sorted({h['fixture_id'] for h in hits})
        print(f'side_id {sid}: {len(hits)} rows over {len(fixtures)} fixtures '
              f'— DASHED. fixtures={fixtures[:20]}'
              + (' ...' if len(fixtures) > 20 else ''))

    matches, merr = load_matches()
    if merr:
        print(f'::warning::could not read {MATCHES} ({merr}) — the orientation '
              f'cross-check loses its upcoming-fixture arm')
    orient, dashed = run_orientation(rows, fx, odds_index, matches)
    orient['matchesReadError'] = merr
    print(f'orientation cross-check: n={orient["n"]}, '
          f'agree={orient["agree"]}, disagree={orient["disagree"]}, '
          f'rate={orient["rate"]}, passes={orient["passes"]}'
          + (f'  <-- n<{MIN_N}, FLAGGED' if orient['belowMinN'] else ''))
    print(f'  by source: {orient["bySource"]}')
    print(f'  unchecked: {orient["unchecked"]}')
    for d in orient['disagreements']:
        print(f'::warning::orientation disagreement on {d["match_key"]} '
              f'({d["kibl"]["fixture"]}): kibl favours {d["kibl"]["favourite"]}, '
              f'{d["disagreeing"]} favour otherwise — DASHED, not displayed')
    rows = apply_orientation_guard(rows, dashed, st)
    if dashed:
        print(f'orientation guard dashed {len(dashed)} match(es)')

    n = max(len(rows), 1)
    have_open = sum(1 for r in rows if r['open_price'] is not None)
    have_now = sum(1 for r in rows if r['now_price'] is not None)
    have_close = sum(1 for r in rows if r['close_price'] is not None)
    print(f'coverage (n={len(rows)} rows): Open {have_open} ({have_open/n:.1%}), '
          f'Now {have_now} ({have_now/n:.1%}), '
          f'Close {have_close} ({have_close/n:.1%})'
          + (f'  <-- n<{MIN_N}' if len(rows) < MIN_N else ''))

    lags = sorted(r['_close_lag_min'] for r in rows
                  if r['_close_lag_min'] is not None)
    result.update({
        'counts': dict(st), 'pairing': dict(ist),
        'orientation': orient,
        # Founder item 3 — the count AND the fixtures, capped for size but with
        # the true total alongside so the cap can never read as the total.
        'unknownSides': {
            sid: {'rows': len(hits),
                  'fixtures': len({h['fixture_id'] for h in hits}),
                  'sample': hits[:25],
                  'sampleCapped': len(hits) > 25}
            for sid, hits in sorted(unknown_sides.items())},
        'coverage': {'n': len(rows), 'open': have_open, 'now': have_now,
                     'close': have_close},
        'closeLagMinutes': ({'n': len(lags), 'min': lags[0],
                             'median': lags[len(lags) // 2], 'max': lags[-1]}
                            if lags else {'n': 0}),
        'closeRule': {'lagMinutes': RELIABLE_LAG_MIN,
                      'decayWindowApplied': False,
                      'why': ('kibl is captured live, so every close predates '
                              'its start and the 21-day decay limb is vacuous '
                              'here — reported, not ruled')},
    })

    if not a.dry_run and rows:
        payload = [{k: v for k, v in r.items() if not k.startswith('_')}
                   for r in rows]
        sent, uerr = L.upsert(url, key, 'odds_card_state', payload,
                              'fixture_id,book,market,side,line')
        print(f'upserted {sent}/{len(payload)} kibl card rows'
              + (f' — FAILED {uerr}' if uerr else ''))
        result['upserted'] = sent
        if uerr:
            result['error'] = str(uerr)
            json.dump(result, open(OUT, 'w'), indent=1)
            return 1

    # The book-priority pass runs LAST and over every source, so a Kibl row that
    # has just landed can take a match off bet365 in the same run that created
    # it. Run it even on a dry run — it prints what it WOULD change, which is the
    # number worth reading before anything renders.
    sel, serr = run_selection(url, key, dry_run=a.dry_run)
    result['selection'] = dict(sel) if sel else None
    if serr:
        result['error'] = str(serr)
        json.dump(result, open(OUT, 'w'), indent=1)
        return 1

    json.dump(result, open(OUT, 'w'), indent=1)
    print(f'wrote {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
