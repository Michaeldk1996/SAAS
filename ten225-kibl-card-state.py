#!/usr/bin/env python3
"""TEN-225 / TEN-232 — fill odds_card_state (match winner) from the KIBL archive.

Founder ruling 2026-09-18T00:18Z: Kibl is the PRIMARY book. The book it
serves us is SPORTS411. Sports411, NOT Bet105 — measured 2026-09-18T22:33Z (run 35401888326): /reference/sportsbooks returns exactly one book, feed_source_id 43, name Sports411. Bet105 does not appear in our entitlement. The two are not the same book and nothing here carries an affiliate relationship.
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
  observed_at   when OUR sweep ran. It is our cadence, not the market's, and
                MIXING it into a price's timestamp is exactly what makes a book
                look slower than it is — so it is never written into open_ts /
                now_ts / close_ts.
                It IS now written, and rendered, in its own columns
                (open_observed_at / now_observed_at) and shown as the second
                clock in the hover: "bet365 · 1.22 since 01:08 · seen 09:15"
                (founder ruling 2026-09-18 09:33Z, items 1 + 3). Separate
                columns, separate labels — the ban is on conflating them, not on
                showing our own clock. Withholding it was itself a defect: it
                left a 0% move unable to say whether a later sweep had confirmed
                the flat price or whether we had only ever looked once.
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

from ten225_names import match_key as mk_of, name_key, initials_conflict  # noqa: E402
import ten225_orientation as ORI  # noqa: E402
import ten225_apitennis_odds as AT  # noqa: E402

# The board file, read for its INDEPENDENT prices only. It is the api-tennis /
# oddspapi view of the same matches, oriented to its own p1/p2, and nothing on
# the Kibl path writes to it — which is what makes it a valid control.
MATCHES = os.path.join(HERE, 'matches.json')

MARKET = 'match winner'
BOOK = 'sports411'          # the book we are actually served; NOT Bet105 (measured)

# ⚠️ ITEM 7 GUARD (founder directive 2026-09-18T22:01Z): "No Bet105 price reaches
# a card until 5 passes." This constant is what enforces it, and it has to,
# because nothing else can:
#
#   archive-kibl.py:run_window() does NOT hard-code a book. It reads
#   /reference/sportsbooks every sweep and sends EVERY entitled feed_source_id,
#   comma-joined — deliberately, "so a change in entitlement shows up as more
#   data rather than as a silent miss". That is right for an archive racing
#   irreversible data loss. It also means the DAY Bet105 is activated on the
#   account, its prices start landing in kibl_line_observations with no deploy,
#   no PR and no notice.
#
#   This file used to read that table without `feed_source_id` at all and stamp
#   the constant BOOK on every row it projected. A second book would therefore
#   have reached a card labelled `sports411` — breaking item 7 and item 2 (the
#   label must never imply another book) in the same write, silently, on a
#   green run, with the archive behaving perfectly.
#
# MEASURED 2026-09-18T22:33Z, run 35401888326: /reference/sportsbooks returns
# exactly ONE book — feed_source_id 43, name Sports411, tag `sports411`. Bet105
# does NOT appear; the entitlement IS that list (a restricted account returns
# 200 with fewer rows, never a 403), so this is an answer, not a failed call.
#
# So today this filter excludes nothing and is a no-op. That is exactly when it
# is safe to install one. Raising it later, after a second book is already in
# the table, would mean auditing which cards were built from which book after
# the fact.
#
# DO NOT widen this to "every book in the archive". A book is added here only
# after its own side-mapping gate passes on its own data — the convention does
# not carry over between sources, which is the whole reason the gate exists.
VERIFIED_FEED_SOURCE_ID = 43
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
    # last_seen_at — founder ruling 2026-09-18 item A, bumped every sweep. It is
    # the ONLY column on this table that moves; it is what makes a re-sighting
    # of an UNCHANGED price visible at all, and therefore what lets a flat 0%
    # be evidenced rather than suppressed.
    'is_opener,is_current,price_decimal,inserted_on,observed_at,last_seen_at,alt_id,'
    # feed_source_id is SELECTED, not merely filtered on, so the projection can
    # assert per row that every price it is about to stamp `sports411` actually
    # came from Sports411. A filter alone is a promise about the query; reading
    # the column back is a check on the answer.
    'is_main,point,feed_source_id')

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

    Returns (price, ts_iso, reason, observed_at) — exactly one of price/reason
    is set. `observed_at` is OUR sweep clock for the row the Open came from, and
    it is a fourth return value rather than a field on the same timestamp because
    conflating the two is the defect this ruling was raised about: see
    `open_observed_at` in ten225-card-state-schema.sql.
    """
    openers = [o for o in obs_list
               if o.get('is_opener') and o.get('price_decimal') is not None
               and epoch(o.get('inserted_on')) is not None]
    if not openers:
        return None, None, 'no_opener_row', None
    openers.sort(key=lambda o: epoch(o['inserted_on']))
    first_ts = epoch(openers[0]['inserted_on'])
    tied = {float(o['price_decimal']) for o in openers
            if epoch(o['inserted_on']) == first_ts}
    if len(tied) > 1:
        return None, None, 'ambiguous_opener', None
    # The EARLIEST sweep that saw this opener row, not the row we happened to
    # sort first: an opener re-served on every sweep would otherwise drift its
    # own "when did we first see it" forward, which is `first sighting wins
    # forever` broken from the other end.
    # Filter on the PARSED value, not on the raw string's truthiness: an
    # unparseable-but-non-empty stamp would put a None into the list and kill
    # min() — and with it the whole card-state build — on one bad row.
    seen = [e for e in (epoch(o.get('observed_at')) for o in openers
                        if epoch(o['inserted_on']) == first_ts) if e is not None]
    return (float(openers[0]['price_decimal']), openers[0]['inserted_on'], None,
            iso(min(seen)) if seen else None)


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


# Margin distributions for the flip-started Closes, so item B can report how
# much room each pass had rather than only that it passed. Module-level and
# cleared per build so a second call in one process cannot inherit the first.
FLIP_LAGS = []
FLIP_GAPS = []
# Item 9 — the rejected-on-lag population, with the factors needed to ask what
# they have in common. Cleared per build alongside the distributions above.
LAG_FAILS = []


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
            #
            # TEN-225 ruling D follow-up (2026-09-18). The `else` below USED to
            # be `oddspapi_same_surname`, which made this counter tell the same
            # kind of lie the comment above it was written to stop. match_key
            # returns None for THREE reasons, and "both players reduce to one
            # surname" is only one of them — a name that fails to key AT ALL
            # lands here too, under a label asserting the opposite (that both
            # names keyed, and keyed identically).
            #
            # That mattered: before ruling D every hyphenated and apostrophe
            # surname keyed to None, so each one was counted as a same-surname
            # collision. The run that led to this fix reported 394 in that
            # bucket and there was no way to tell from the number how many were
            # really unkeyable names. Now there is.
            p1, p2 = f.get('player1'), f.get('player2')
            if not (p1 and p2):
                st['oddspapi_no_player_names'] += 1
            elif not day:
                st['oddspapi_no_day'] += 1
            else:
                k1, k2 = name_key(p1), name_key(p2)
                if not (k1 and k2):
                    st['oddspapi_name_unkeyable'] += 1
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


def index_live_flips(flip_rows):
    """live_flip_log -> {match_key: live-flip start record}.

    ── LADDER ITEM I(b) (founder, 2026-09-18 04:36Z) ──────────────────────────
    "Where no pair exists, use the live-flip lower bound from live_flip_log —
     this is the flip_gap_seconds fix."

    The oddspapi path already carries a live-flip start where oddspapi ITSELF
    has the fixture: resolve_start() puts it on the summary row and
    index_oddspapi() hands it through. What has never existed is the path for a
    Kibl fixture oddspapi does NOT carry at all — the 'no_oddspapi_pair'
    population, which is most of the Challenger board. This builds it.

    THE BOUND IS `last_not_live_seen_at`, NOT `first_live_seen_at`. At that
    instant the poller held a COMPLETE live board that did not contain this
    fixture, so it was provably not yet live. first_live_seen_at is an upper
    bound and using it would let an in-play tick into the Close slot — the one
    failure close_of() exists to prevent. gap_seconds travels with it so
    judge_close_live() can apply the ruled <=300 s limb; an UNKNOWN gap is not a
    pass.

    DROPS ON AMBIGUITY, both sides, exactly like index_oddspapi(): two flip rows
    reaching one match_key means we cannot say which start belongs to which
    match, so neither is offered. A guessed start is worse than no close.

    NEVER the scheduled time, on any branch — standing rule.
    """
    st = collections.Counter()
    by_key, ambiguous = {}, set()
    for r in flip_rows:
        day = (r.get('event_date') or '')[:10]
        n1, n2 = r.get('first_player'), r.get('second_player')
        if not (day and n1 and n2):
            st['flip_unkeyable_fields'] += 1
            continue
        k = mk_of(day, n1, n2)
        if not k:
            st['flip_name_unkeyable'] += 1
            continue
        lower = epoch(r.get('last_not_live_seen_at'))
        if lower is None:
            # A flip with no lower bound is a sighting, not a bound. It cannot
            # cut a Close and is counted rather than silently skipped.
            st['flip_no_lower_bound'] += 1
            continue
        if k in by_key:
            ambiguous.add(k)
        by_key[k] = {
            'start_ts': lower,
            'start_ts_source': 'api-tennis-live',
            'start_reject_reason': None,
            'flip_gap_seconds': r.get('gap_seconds'),
            'player1': n1,
            'player2': n2,
        }
    for k in ambiguous:
        by_key.pop(k, None)
        st['flip_ambiguous'] += 1
    st['flip_indexed'] = len(by_key)
    return by_key, st


def _initials_ok(n1, n2, rec):
    """Founder ruling D, applied to whichever index offered the record.

    Same test index_oddspapi's consumer runs: surnames match but given-name
    initials conflict -> drop, not pair. Orientation-free, because no two feeds
    agree on who is listed first.
    """
    by_key = {}
    for nm in (rec.get('player1'), rec.get('player2')):
        kk = name_key(nm)
        if kk:
            by_key[kk] = nm
    return not any(initials_conflict(nm, by_key.get(name_key(nm)))
                   for nm in (n1, n2) if by_key.get(name_key(nm)))


def find_start(kibl_fx, odds_index, flip_index=None, use_flip=False):
    """A Kibl fixture -> a resolved start, or a no-start record.

    Two sources, in the ruled order: the oddspapi pair first (I(a)), then the
    live-flip lower bound (I(b)) for the fixtures oddspapi does not carry at
    all. `use_flip` gates the SECOND one because it changes what renders, and
    the founder's standing order is to measure first — with it off the flip
    branch still runs and still counts, so a dry run reports exactly how many
    Closes it would recover without recovering any.

    Tries the scheduled day and its neighbours. Never derives a start of its own:
    the ladder lives in resolve_start() and running a second copy of it here is
    how two rows of one fixture end up with two different start_ts_source values.
    """
    base = (kibl_fx.get('scheduled_start') or '')[:10]
    n1, n2 = kibl_fx.get('player1_name'), kibl_fx.get('player2_name')
    k1, k2 = name_key(n1), name_key(n2)
    if not (k1 and k2) or k1 == k2:
        return None, 'unpairable_name'
    for d in day_candidates(base):
        k = mk_of(d, n1, n2)
        if k and k in odds_index:
            rec = odds_index[k]
            # FOUNDER RULING D (2026-09-18): "surnames match but given-name
            # initials conflict = drop, not pair."
            #
            # The surname key is deliberately coarse — it has to be, to survive
            # three feeds' orderings — so two different players CAN reach one
            # key. The measured case is Benjamin vs Christopher O'Connell, both
            # 'connell'. A false pair here is not a missing price, it is the
            # WRONG match's start time pinned to this fixture's Close, and
            # nothing downstream can tell. So the initials are checked on BOTH
            # sides and a conflict drops the pair rather than taking it.
            #
            # Checked per ORIENTATION-FREE side: the two feeds do not agree on
            # who is listed first, so each Kibl name is tested against whichever
            # oddspapi name shares its surname key, not against the same slot.
            o1, o2 = rec.get('player1'), rec.get('player2')
            by_key = {}
            for nm in (o1, o2):
                kk = name_key(nm)
                if kk:
                    by_key[kk] = nm
            if any(initials_conflict(nm, by_key.get(name_key(nm)))
                   for nm in (n1, n2) if by_key.get(name_key(nm))):
                return None, 'initials_conflict'
            return rec, None

    # ── I(b): no oddspapi pair. Try the live flip. ───────────────────────────
    for d in day_candidates(base):
        k = mk_of(d, n1, n2)
        rec = (flip_index or {}).get(k) if k else None
        if not rec:
            continue
        if not _initials_ok(n1, n2, rec):
            return None, 'flip_initials_conflict'
        # COUNTED EVEN WHEN NOT USED, so a dry run can answer "how many Closes
        # does this recover" before it recovers any.
        return (rec, None) if use_flip else (None, 'flip_available_not_enabled')
    return None, 'no_start_anywhere'


# ------------------------------------------------------------ the build itself

def build_rows(kibl_fixtures, observations, odds_index, as_of,
               flip_index=None, use_flip=False):
    """kibl_fixtures + kibl_line_observations -> odds_card_state rows.

    One row per (fixture, side). `observations` is {fixture_id: [obs, ...]}.
    """
    rows, st = [], collections.Counter()
    unknown_sides = collections.defaultdict(list)
    # Ladder I(b) ruling D: the live-flip recovery, split by league, plus the
    # denominator it needs. See the bump site below.
    flip_by_league = collections.Counter()
    league_seen = collections.Counter()
    FLIP_LAGS.clear(); FLIP_GAPS.clear(); LAG_FAILS.clear()
    side_shapes = collections.Counter()
    for fx in kibl_fixtures:
        fid = fx['fixture_id']
        obs = [o for o in observations.get(fid, []) if is_match_winner(o)]
        if not obs:
            st['fixture_no_match_winner_rows'] += 1
            continue
        st['fixtures_with_rows'] += 1

        rec, why = find_start(fx, odds_index, flip_index, use_flip)
        start_ts = rec['start_ts'] if rec else None
        start_src = rec['start_ts_source'] if rec else 'none'
        reject = rec['start_reject_reason'] if rec else None
        flip_gap = rec.get('flip_gap_seconds') if rec else None
        st[f'start_{why or start_src}'] += 1

        # LADDER I(b), founder ruling D 2026-09-18T22:58Z: "run the counting pass
        # and post the number — how many Kibl Closes the live-flip start would
        # recover, BY LEAGUE, with n. Then I switch it on."
        #
        # The flat counter already existed; a bare 31 does not answer a question
        # asked per league, and the founder's switch-on decision is exactly the
        # kind that turns on the league split (Kibl prices Challenger heavily and
        # no ITF, so one number hides where the recovery actually lands).
        #
        # Counted on the fixture, not the side, because a Close is recovered for
        # a fixture — counting sides would double every figure and read as twice
        # the recovery.
        # ⚠️ THE COUNTER HAS TO SWITCH WITH THE FLAG. 'flip_available_not_enabled'
        # is by CONSTRUCTION zero once --use-live-flip is on: the flip is used,
        # so the start source becomes 'api-tennis-live' and nothing is ever
        # "available but not enabled" again. Counting only that state produced a
        # table reading "0 would recover / 0.0%" on the very run that switched it
        # on, which reads as "the flip recovers nothing" and is the exact opposite
        # of the truth. Under ENABLED the recovered population IS the
        # flip-started one.
        if (why or start_src) == 'flip_available_not_enabled' \
           or start_src == 'api-tennis-live':
            flip_by_league[fx.get('league_id')] += 1
        # The denominator the percentage needs: every fixture we looked at, per
        # league. Without it "31 recovered" has no n and cannot be read.
        league_seen[fx.get('league_id')] += 1

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
            open_price, open_ts, open_reason, open_obs = open_of(lst)
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
            # LADDER I(b), founder item B 2026-09-19: "confirm none fail the
            # <=60-min lag or <=300 s flip-gap limbs."
            #
            # close_withheld_unreliable alone CANNOT answer that. It is one flat
            # counter over both limbs and both start sources, so a zero in it
            # proves the conjunction and a non-zero names neither limb. Switching
            # the flip on while the only instrument is that counter would mean
            # reporting "none fail" from a number that cannot distinguish the
            # two failures being asked about.
            #
            # Split by LIMB and by START SOURCE, because the flip-gap limb only
            # exists on the flip-started population and mixing it with the
            # oddspapi-started majority dilutes exactly the rate under test.
            src_tag = 'flip' if start_src == 'api-tennis-live' else 'oddspapi'
            if close_obs and not reliable:
                st['close_withheld_unreliable'] += 1
                if lag is not None and lag < 0:
                    # Must never happen: close_of() cuts at the start.
                    st[f'close_reject_INPLAY_{src_tag}'] += 1
                elif lag is not None and lag > RELIABLE_LAG_MIN:
                    st[f'close_reject_lag_over_{RELIABLE_LAG_MIN}min_{src_tag}'] += 1
                    # ITEM 9, founder 2026-09-19: "B's 17 lag failures: what do
                    # they have in common — league, book, time of day, flip start
                    # vs oddspapi start? Would sweeping closer to start recover
                    # them?"
                    #
                    # A count cannot answer any of that. The COMMON FACTORS have
                    # to travel with each rejection or the question is
                    # unanswerable after the fact — which is the same shape as
                    # the flat counter item B already had to replace.
                    LAG_FAILS.append({
                        'fixture_id': fid,
                        'league_id': fx.get('league_id'),
                        'start_src': start_src,
                        'lag_min': round(lag, 1),
                        # The hour the CLOSE was cut, in UTC. If these cluster in
                        # a band, the sweep is thin at that hour rather than the
                        # fixtures being unusual.
                        'close_hour_utc': (close_ts or '')[11:13],
                        'start_ts': start_ts,
                        'scheduled': fx.get('scheduled_start'),
                    })
                elif src_tag == 'flip' and flip_gap is None:
                    # An UNKNOWN gap is a rejection, not a pass — ruled. Counted
                    # apart from a measured over-limit gap because the fixes
                    # differ: this one is a missing field, that one is a slow poll.
                    st['close_reject_flipgap_UNKNOWN'] += 1
                elif src_tag == 'flip':
                    st[f'close_reject_flipgap_over_{FLIP_GAP_MAX_S}s'] += 1
                else:
                    st[f'close_reject_unclassified_{src_tag}'] += 1
            elif reliable:
                st['close_ok'] += 1
                st[f'close_ok_{src_tag}'] += 1
                if src_tag == 'flip':
                    # The margin, not just the verdict. "Zero failed" is much
                    # weaker evidence if every pass sat at 299 s of a 300 s limb.
                    FLIP_LAGS.append(lag)
                    if flip_gap is not None:
                        FLIP_GAPS.append(flip_gap)
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
                # ── FOUNDER RULING 2026-09-18 09:33Z ITEM 3, FIXED AT SOURCE ──
                # "ten225-kibl-card-state.py writing the opener row into both
                #  open_ and now_: confirm that is fixed at source, not only
                #  guarded in the renderer."
                #
                # The VALUE was never wrong: with one observation on file, the
                # opener IS also the freshest price we hold, and item 2 rules
                # that it must keep rendering ("keep the price rendering with no
                # delta on a single sighting — do not dash it"). What was wrong
                # is that the row said nothing about WHICH of the two cases it
                # was, so the renderer had to infer it from open_ts == now_ts —
                # which also suppresses the legitimate case where a LATER sweep
                # re-saw an unchanged price. That is an evidenced flat market and
                # it was being thrown away with the artefact.
                #
                # These two columns carry OUR sweep clock, which is the clock
                # a 0% actually rests on.
                #
                # ⚠️ AND ON THIS SOURCE IT NEEDED A PART 1 CHANGE TO WORK.
                # kibl_line_observations is append-only and its row_key
                # (kibl_client.observation_key) hashes inserted_on + price +
                # flags WITHOUT observed_at, under an ignore-duplicates insert.
                # A sweep that re-sees an unchanged current price therefore
                # writes no row, so `observed_at` never advanced and
                # now_observed_at > open_observed_at held exactly when
                # now_ts <> open_ts — the test the renderer already applied, so
                # the column added nothing. MEASURED on the deployed board
                # 2026-09-19: sports411's nowObs ran a 191.7-minute median and a
                # 1,026.8-minute p95 while the archive publishes every 2.5-5
                # minutes, an order of magnitude worse than anything else on the
                # board, on the freshest feed we have.
                #
                # FIXED at source (founder ruling 2026-09-18 item A, built
                # 2026-09-19): `last_seen_at` on kibl_line_observations, bumped
                # by a second merge pass on every sweep, first-write-wins kept on
                # every other column. The Now clock reads it here.
                #
                # The FALLBACK to observed_at is for rows written before that
                # migration, where observed_at IS the last time we saw them —
                # the truthful value, not a placeholder. The Open deliberately
                # does NOT fall back the other way: an Open's clock is its FIRST
                # sighting and must never move.
                # See `open_observed_at` in ten225-card-state-schema.sql.
                'open_observed_at': open_obs,
                'now_price': (float(newest['price_decimal']) if newest else None),
                'now_ts': (newest['inserted_on'] if newest else None),
                'now_observed_at': ((newest.get('last_seen_at')
                                     or newest.get('observed_at')) if newest else None),
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
    st['_flip_by_league'] = dict(flip_by_league)
    st['_league_seen'] = dict(league_seen)
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


def book_completeness(book_rows):
    """Does this book quote BOTH SIDES of this fixture for open, and for now?

    The unit is the fixture, not the row, because the founder's takeover rule is
    about a fixture switching book: half an Open is not an Open for this purpose,
    for the same reason the publisher refuses to render one.
    """
    sides = {r.get('side') for r in book_rows}
    both = lambda col: (len(sides) >= 2
                        and all(any(r.get('side') == s and r.get(col) is not None
                                    for r in book_rows) for s in sides))
    return {'open': both('open_price'), 'now': both('now_price'),
            'close': both('close_price')}


def select_winners(rows):
    """Founder ruling: one book per fixture, lowest book_rank wins.

    Operates on (match_key, market, line) — NOT on fixture_id, because the three
    sources key the same match under three different id spaces and fixture_id
    cannot see that they are one match.

    A row with NO match_key cannot be shown to be a duplicate of anything AND
    cannot be joined to a board match, so it is never selected. That is the
    conservative direction: an unselected row renders nothing, which is the dash
    the standing rules ask for.

    A row carrying none of Open/Now/Close is not selected either — selecting it
    would let an empty rank-1 row hide a populated rank-2 one, which is the exact
    way a priority change makes a working card go blank.

    ── TEN-225 RULING 4a (founder, 2026-09-18) — THE TAKEOVER ──────────────────

    "A fixture whose current book has an Open but no Now, while another book has
     both, switches ENTIRELY to that book, using its own first tick as Open."

    Two changes, and the first is the one that makes the second possible:

    1. THE GRAIN MOVED FROM THE SIDE TO THE FIXTURE. This function used to decide
       each (match_key, market, SIDE, line) independently, which means "one book
       per fixture" was never actually enforced here — it was enforced downstream
       by the publisher DROPPING any match whose selected rows disagreed about the
       book. Per-side selection also cannot express a takeover at all: "switches
       ENTIRELY to that book" is a statement about the fixture, and a rule that
       only ever looks at one side has no way to know the other side is missing.

    2. COMPLETENESS OUTRANKS RANK, AND ONLY WHERE A NOW IS MEANINGFUL. Within a
       fixture, a book quoting BOTH legs of Open AND BOTH legs of Now beats a
       lower-ranked book that does not. That is the takeover, stated as a sort
       key rather than as a special case.

       The tier applies ONLY to a fixture that has not started. After the off a
       Now is CORRECTLY absent — that is the whole point of withholding it — so
       applying the tier there would demote a perfectly good bet365 open+close
       row in favour of any book still carrying a stale in-play price. That is
       not a hypothetical: `qualifies_as_now` in the loader exists precisely
       because an earlier draft relabelled three-month-old closes as "Now" and
       the number looked healthy. A fixture with NO start on file is treated as
       not started, which is the state Kibl rows are all in (start_ts_source is
       'none' on every one of them) and the state where the tier does real work.

    MEASURED, deployed board 2026-09-18 — THE TAKEOVER FIRES ZERO TIMES TODAY,
    and the reason is upstream of this function, not in it. `odds_card_state`
    holds three sources and only three: Kibl/sports411, bet365 via oddspapi,
    bet365 via api-tennis. On the founder's own example, Skatov/Samrej, the
    other book is Sbo — which has never been written to this table, because
    bsp-pipeline.js collapsed the api-tennis per-book map to one headline line
    and discarded the rest. Sbo therefore has no first tick to take over with.
    That capture now exists (`m.bookOpens`, pinned write-once per book), but it
    can only accrue forward: a first sighting not taken is not recoverable. This
    pass is built and correct ahead of the rows it needs, and reported as such.

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
        groups[(r['match_key'], r['market'], r.get('line'))].append(r)

    for _k, cands in groups.items():
        by_book = collections.defaultdict(list)
        for c in cands:
            by_book[(int(c['book_rank']), c.get('book'))].append(c)

        started = fixture_has_started(cands)
        scored = []
        for (rank, book), brows in by_book.items():
            cov = book_completeness(brows)
            # Tier 1 = "has both legs of Open AND both legs of Now", which is
            # exactly the condition the founder's rule names. Never applied after
            # the off; see the docstring.
            tier = 1 if (not started and cov['open'] and cov['now']) else 0
            scored.append((-tier, rank, book, brows))
        scored.sort(key=lambda x: (x[0], x[1]))

        best_tier, best_rank = scored[0][0], scored[0][1]
        winners = [s for s in scored if s[0] == best_tier and s[1] == best_rank]
        if len(winners) > 1:
            # Two books of one rank at one completeness on one fixture: two
            # fixtures of one source paired onto one match. Ambiguous -> nothing
            # is selected, because picking either would be a coin toss rendered
            # as a price.
            st['rank_tie_dropped'] += 1
            continue
        _t, rank, _book, brows = winners[0]

        # Within the winning book, one row per (side, line). More than one is the
        # same ambiguity a rank tie is, one level down, and it drops the FIXTURE
        # rather than the side — a fixture showing one real side beside a dash
        # that exists only because we could not decide is worse than two dashes.
        per_side = collections.Counter((r.get('side'), r.get('line')) for r in brows)
        if any(n > 1 for n in per_side.values()):
            st['side_tie_dropped'] += 1
            continue

        for r in brows:
            r['is_selected'] = True
        st[f'selected_rank_{rank}'] += len(brows)
        if best_tier == -1 and rank != min(s[1] for s in scored):
            # A book took over from a higher-priority one on completeness alone.
            # Counted, because this is the founder's rule firing and a rule that
            # fires silently cannot be checked against the board.
            st['takeover_on_completeness'] += 1
        st['demoted'] += len(cands) - len(brows)
    st['selected'] = sum(1 for r in rows if r['is_selected'])
    return rows, st


def fixture_has_started(cands):
    """Has this fixture started, per the start we hold for it?

    True only on EVIDENCE — a resolved start_ts that is in the past. A fixture
    with no start on file reads as NOT started, which is the conservative
    direction for the completeness tier: it keeps the tier live on exactly the
    population the takeover was written for (every Kibl row carries
    start_ts_source 'none') and costs nothing on a fixture that really has
    started, because after the off no book should be carrying a Now at all.
    """
    now = datetime.now(timezone.utc)
    for c in cands:
        ts = c.get('start_ts')
        if not ts:
            continue
        try:
            t = datetime.fromisoformat(str(ts).replace('Z', '+00:00'))
        except (TypeError, ValueError):
            continue
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        if t <= now:
            return True
    return False


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


def participant_ids_by_fixture(observations):
    """{fixture_id: {'1': fixture_participant_id, '2': ...}} for the report.

    Founder 2d asks for the Kibl participant ids on every evidence line. They
    come from the SAME `side_labels_for()` the card rows are built through, so
    the ids printed beside a price are the ids that produced it; reading them in
    a second independent pass would let the evidence and the data drift apart.
    """
    out = {}
    for fid, obs in observations.items():
        mw = [o for o in obs if is_match_winner(o)]
        labels = side_labels_for(mw)
        if not labels:
            continue
        ids = {}
        for o in mw:
            lbl = labels.get(o.get('side_id'))
            if lbl:
                ids[lbl] = o.get('fixture_participant_id')
        out[int(fid)] = ids
    return out


def run_orientation(rows, kibl_fixtures, odds_index, matches, ids=None,
                    api_tennis_key=None):
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
         for f in kibl_fixtures], prices, ids)

    board_index, bst = ORI.board_favourites(matches)
    odds_reads = ORI.oddspapi_favourites(odds_index)

    # Every independent reading for a match, from every non-Kibl source.
    independent = collections.defaultdict(dict)
    for k, rec in board_index.items():
        independent[k].update(rec['readings'])
    for k, rec in odds_reads.items():
        independent[k]['oddspapi:line_summary'] = rec

    # ---------------------------------------------------- the free referee arm
    # The board alone cannot referee this: it prices Davis Cup and ATP, Kibl
    # prices Challenger, and the two sets barely intersect (23 of 25 unpaired,
    # all of them `not_on_board`). api-tennis get_odds covers both, by date, on
    # the api-tennis key — zero oddspapi units.
    at_rows, at_index, at_valid, at_err = [], {}, None, None
    if api_tennis_key:
        days = sorted({kr['day'] for kr in kibl_index.values() if kr.get('day')})
        for day in days:
            got, err = AT.fixtures_and_odds(api_tennis_key, day)
            if err:
                at_err = err
                print(f'::warning::api-tennis {day}: {err}')
                continue
            at_rows.extend(got)
        at_index, at_st = ORI.apitennis_favourites(at_rows)
        print(f'api-tennis arm: {len(at_rows)} priced fixtures over '
              f'{len(days)} day(s) -> {len(at_index)} keyed  {dict(at_st)}')

        # The arm is checked against a source it cannot see BEFORE it referees
        # anything. bet365 via the board is that source.
        ref = {k: r['readings']['oddspapi:bet365Now']
               for k, r in board_index.items()
               if 'oddspapi:bet365Now' in r['readings']}
        ref.update({k: r['readings']['oddspapi:openingOdds']
                    for k, r in board_index.items()
                    if k not in ref and 'oddspapi:openingOdds' in r['readings']})
        at_valid = ORI.validate_home_away(at_index, ref)
        print(f"api-tennis Home==event_first_player vs bet365: "
              f"n={at_valid['n']}, agree={at_valid['agree']}, "
              f"disagree={at_valid['disagree']}, "
              f"trustworthy={at_valid['trustworthy']}")
        if not at_valid['trustworthy']:
            # REFUSE rather than dilute. An arm that disagrees with bet365 about
            # which player is favourite is not a weaker referee, it is a
            # differently-oriented one, and folding it in would let it agree
            # with a reversed Kibl and certify the exact defect the gate exists
            # to catch. n=0 refuses too: unvalidated is not the same as fine.
            for d in at_valid['disagreements']:
                print(f"::error::api-tennis disagrees with bet365 on "
                      f"{d['match_key']}: {d['apitennis']} vs {d['reference']}")
            print('::warning::api-tennis arm REFUSED — not folded into the '
                  'gate. The gate will report on the board arm alone.')
            at_index = {}
        else:
            for k, rec in at_index.items():
                independent[k]['api-tennis:get_odds'] = rec
    else:
        print('::warning::no API_TENNIS_KEY — the free referee arm is absent '
              'and the gate sees only the board')

    vmap = ORI.verdicts(kibl_index, independent)
    report = ORI.agreement(vmap)
    report['kiblStats'] = dict(kst)
    report['boardStats'] = dict(bst)
    report['oddspapiReadings'] = len(odds_reads)
    # Founder ruling 2026-09-18 item 2: the bar this decision is actually made
    # against. `agreement()` keeps reporting n < 30 alongside it rather than
    # being redefined by it.
    report['shipGate'] = ORI.ship_gate(vmap)
    # The gate names its own blocker. `no_independent_price: N` cannot say
    # whether N is a matcher bug, an odds-coverage gap, or nothing at all.
    report['unpaired'] = why_unpaired(kibl_index, independent, matches)
    report['apiTennisArm'] = {'pricedFixtures': len(at_rows),
                              'keyed': len(at_index),
                              'validation': at_valid, 'error': at_err}

    dashed = {k for k, v in vmap.items() if v['verdict'] == 'disagree'}
    return report, dashed


def why_unpaired(kibl_index, independent, matches):
    """The 23 Kibl fixtures that found no independent price — WHICH failure?

    `no_independent_price: 23` is a true number and a useless one: it is the same
    count whether our name normaliser is dropping the pairing, whether the board
    carries the match but prices nothing, or whether Kibl simply prices matches
    we do not carry. Those three have three different fixes — the first is a
    code bug, the second needs the odds feed, the third needs nothing at all —
    and the founder's order puts "upcoming lane" before "name normaliser
    report" precisely because he cannot sequence them without knowing which.

    So each unpaired fixture is classified, never counted in one bucket:

      board_unpriced   the board HAS this match and prices neither side
                       -> our odds coverage, not our matcher
      surname_on_board one player's surname is on the board that day but the
                       match_key did not form
                       -> SUSPECT THE MATCHER. This is the bucket that would
                          hide a name defect, so it is listed in full.
      not_on_board     neither surname appears that day
                       -> Kibl prices a match we do not carry. Nothing to fix.

    Read-only. No vendor calls, no writes.
    """
    board_keys, by_day_surname = set(), collections.defaultdict(set)
    for m in matches or []:
        day = (m.get('date') or '')[:10]
        k = ORI.mk_of(day, m.get('p1'), m.get('p2'))
        if k:
            board_keys.add(k)
        for p in (m.get('p1'), m.get('p2')):
            nk = ORI.name_key(p)
            if nk:
                by_day_surname[day].add(nk)

    buckets = collections.defaultdict(list)
    for k, kr in kibl_index.items():
        if independent.get(k):
            continue
        day, ka, kb = k.split('|')
        if k in board_keys:
            bucket = 'board_unpriced'
        elif ka in by_day_surname.get(day, ()) or kb in by_day_surname.get(day, ()):
            bucket = 'surname_on_board'
        else:
            bucket = 'not_on_board'
        buckets[bucket].append(
            {'match_key': k, 'fixture_id': kr['fixture_id'],
             'fixture': f"{kr['p1']} vs {kr['p2']}", 'day': day})
    return {b: sorted(v, key=lambda r: r['match_key'])
            for b, v in buckets.items()}


def print_unpaired(buckets):
    total = sum(len(v) for v in buckets.values())
    print(f'\nWHY {total} KIBL FIXTURE(S) FOUND NO INDEPENDENT PRICE')
    if not total:
        print('  (every priced Kibl fixture paired)')
        return
    for b in ('surname_on_board', 'board_unpriced', 'not_on_board'):
        rows = buckets.get(b) or []
        note = {'surname_on_board': 'SUSPECT THE MATCHER — listed in full',
                'board_unpriced': 'our odds coverage, not our matcher',
                'not_on_board': 'Kibl prices a match we do not carry'}[b]
        print(f'  {b}: {len(rows)}  ({note})')
        # The matcher-suspect bucket is never truncated: a capped list is how a
        # name defect reads as a handful of oddities.
        shown = rows if b == 'surname_on_board' else rows[:8]
        for r in shown:
            print(f"      {r['day']}  {r['fixture']}  (kibl {r['fixture_id']})")
        if len(shown) < len(rows):
            print(f'      ... {len(rows) - len(shown)} more (of {len(rows)})')


def print_evidence(gate):
    """Founder 2d: every fixture on its own line, readable, not a percentage.

    Printed to the job summary so the evidence is in the run that produced it —
    a JSON artifact nobody opens is not a report.
    """
    fixtures = gate.get('fixtures') or []
    if not fixtures:
        print('\nSIDE-MAPPING EVIDENCE: no fixture carried both a Kibl price '
              'and an independent one. Nothing is claimed.')
        return
    for group in ('lopsided', 'near-even'):
        rows = [f for f in fixtures if f['group'] == group]
        blocking = 'BLOCKING' if group == 'lopsided' else 'noted, not blocking'
        print(f'\n{group.upper()} GROUP — n={len(rows)} ({blocking})')
        if not rows:
            print('  (none)')
            continue
        for f in rows:
            k = f['kibl']
            pid = k['participant_ids']
            print(f"  [{f['verdict'].upper()}] {k['fixture']}  "
                  f"(kibl fixture {k['fixture_id']}, day {f['day']})")
            print(f"      kibl        {_pxs(k['prices'], pid)}  "
                  f"fav={k['favourite']} gap={k['gap_pp']}pp"
                  f"{' lopsided:' + k['limb'] if k['lopsided'] else ''}")
            for lbl, r in sorted(f['independent'].items()):
                print(f"      {lbl:<24} {_pxs(r['prices'])}  "
                      f"fav={r['favourite']} gap={r['gap_pp']}pp "
                      f"book={r['book']}"
                      f"{' lopsided:' + r['limb'] if r['lopsided'] else ''}")


def _pxs(prices, ids=None):
    """'Kwon 1.57 [fp 1029619] / Suresh 2.32 [fp 1029618]' — names, never slots.

    `ids` is keyed by PLAYER NAME, the same as `prices`, because that is how
    `kibl_favourites` stores it. Keying it by slot and zipping on sort order
    would reintroduce the exact slot-positional assumption this whole control
    exists to disprove — and it would do so silently, printing one player's
    participant id beside the other player's price.
    """
    out = []
    for name, price in sorted((prices or {}).items()):
        pid = (ids or {}).get(name)
        out.append(f'{name} {price}' + (f' [fp {pid}]' if pid is not None else ''))
    return ' / '.join(out)


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
            for f in ('open_price', 'open_ts', 'open_limit', 'open_observed_at',
                      'now_price', 'now_ts', 'now_observed_at',
                      'close_price', 'close_ts'):
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
    ap.add_argument('--use-live-flip', action='store_true',
                    help='LADDER I(b): cut a Kibl Close at the live-flip lower '
                         'bound where oddspapi has no pair. OFF by default — '
                         'the flip branch still runs and still counts, so a '
                         'normal run reports how many Closes it would recover '
                         'without recovering any. Turn on once the founder has '
                         'the number.')
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
        # Item 7: only the book whose side mapping has passed its own gate may
        # reach a card. See VERIFIED_FEED_SOURCE_ID.
        f'&feed_source_id=eq.{VERIFIED_FEED_SOURCE_ID}'
        # Bounded on OUR capture time, not on the price's. A window on
        # inserted_on would drop a still-valid opener the moment the book's
        # opening price aged past the cutoff, which is the one row the whole
        # source exists to carry.
        f'&observed_at=gte.{iso(as_of - a.days_back * 86400)}',
        order='fixture_id.asc,inserted_on.asc')
    if err:
        print(f'::error::reading kibl_line_observations failed ({err})')
        return 1
    # The filter is a promise about the query; this is the check on the answer.
    # A PostgREST filter that silently failed to apply would otherwise be
    # indistinguishable from one book being in the table.
    foreign = [o for o in obs_rows
               if o.get('feed_source_id') != VERIFIED_FEED_SOURCE_ID]
    if foreign:
        ids = sorted({o.get('feed_source_id') for o in foreign})
        print(f'::error::the feed_source_id filter did not hold — {len(foreign)} '
              f'rows came back from {ids}, not {VERIFIED_FEED_SOURCE_ID}. '
              f'Refusing to stamp them "{BOOK}".')
        return 1

    observations = collections.defaultdict(list)
    for o in obs_rows:
        observations[o['fixture_id']].append(o)
    print(f'kibl_line_observations: {len(obs_rows)} match-winner rows over '
          f'{len(observations)} fixtures '
          f'(feed_source_id={VERIFIED_FEED_SOURCE_ID} only)')

    # Item 7, the visible half. A book we do not project must still be COUNTED,
    # or "a new book was activated" looks exactly like "nothing happened". This
    # is the line that turns the day Bet105 lands from a silent relabel into a
    # number in the job summary.
    excluded, err_x = fetch_all(
        url, key, 'kibl_line_observations', 'fixture_id,feed_source_id',
        f'&market_type_id=eq.{MARKET_TYPE_ID}&segment_id=eq.{SEGMENT_ID}'
        f'&betting_type_id=eq.{BETTING_TYPE_ID}'
        f'&observed_at=gte.{iso(as_of - a.days_back * 86400)}'
        f'&feed_source_id=neq.{VERIFIED_FEED_SOURCE_ID}')
    n_excluded = len(excluded or [])
    if err_x:
        print(f'::warning::could not count unverified-book rows ({err_x})')
    elif n_excluded:
        books_seen = sorted({o.get('feed_source_id') for o in excluded})
        print(f'::warning::ITEM 7 HELD: {n_excluded} rows from book(s) '
              f'{books_seen} — other than '
              f'feed_source_id {VERIFIED_FEED_SOURCE_ID} are in the archive and '
              f'were NOT projected to any card. They are captured and safe; they '
              f'stay off cards until that book passes its own side-mapping gate.')
    else:
        print(f'item 7: 0 rows from any other book in this window '
              f'(the archive holds one book, feed_source_id '
              f'{VERIFIED_FEED_SOURCE_ID}).')

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

    # ── LADDER ITEM I(b) — the live-flip start for fixtures oddspapi lacks ───
    # Read unconditionally so the counters are real on every run. Whether the
    # bound is USED is a separate switch (--use-live-flip), because it changes
    # what renders and the standing order is to report the number first.
    flip_rows, err = fetch_all(url, key, 'live_flip_log',
                               'event_key,first_live_seen_at,'
                               'last_not_live_seen_at,gap_seconds,event_date,'
                               'first_player,second_player',
                               order='event_key.asc')
    if err:
        # NOT fatal. Losing the flip index costs some Closes; failing the run
        # costs every Kibl card its Open and Now as well.
        print(f'::warning::reading live_flip_log failed ({err}) — I(b) is '
              f'unavailable this run; Kibl closes fall back to oddspapi only')
        flip_rows = []
    flip_index, fst = index_live_flips(flip_rows)
    print(f'live-flip index: {len(flip_index)} match keys from '
          f'{len(flip_rows)} flip rows  {dict(fst)}')

    rows, st, unknown_sides, side_shapes = build_rows(
        fx, observations, odds_index, as_of, flip_index, a.use_live_flip)
    print(f'side_id shapes per priced fixture: {side_shapes}')
    # ⚠️ THIS COUNTED THE WRONG THING UNTIL 2026-09-18. It asked how many
    # fixtures carry side_ids *1 and 2*, and side_id 1 does not exist on this
    # feed — so it printed 0 beside a table in which every fixture was in fact
    # two-way, and 0 reads as "nothing can be checked" rather than as "this line
    # is measuring a side that was never served". Founder 2g asks the real
    # question, so it is asked of the ROWS WE BUILT, not of the raw side_ids:
    # a fixture carries both sides when side_labels_for() resolved two
    # participants and each produced a card row.
    sides_per_fixture = collections.Counter()
    for r in rows:
        sides_per_fixture[r['fixture_id']] += 1
    both = sum(1 for n in sides_per_fixture.values() if n == 2)
    odd = {f: n for f, n in sides_per_fixture.items() if n != 2}
    print(f'fixtures carrying BOTH sides after the 2/3 fix: {both} of '
          f'{len(sides_per_fixture)} priced fixtures'
          + (f'  <-- {len(odd)} NOT two-way: {dict(list(odd.items())[:10])}'
             if odd else ' (every priced fixture is two-way)'))
    if st.get('fixture_undecidable_sides'):
        print(f'::warning::{st["fixture_undecidable_sides"]} fixture(s) had '
              f'undecidable sides and dashed entirely — never rendered on a '
              f'guess')
    print(f'kibl card rows: {len(rows)}  {dict(st)}')

    # ── LADDER I(b) — THE NUMBER RULING D ASKS FOR ──────────────────────────
    # Founder 2026-09-18T22:58Z ruling D: "run the counting pass and post the
    # number — how many Kibl Closes the live-flip start would recover, by
    # league, with n. Then I switch it on."
    #
    # Printed as its own table rather than left inside the stats blob, because a
    # figure buried in a 20-key Counter is a figure nobody reads — and this one
    # is the input to a switch-on decision.
    _LEAGUE = {19: 'ATP', 537: 'Challenger', 962: 'ITF Men',
               20: 'WTA', 643: 'WTA 125K', 963: 'ITF Women'}
    fbl = st.get('_flip_by_league') or {}
    seen = st.get('_league_seen') or {}
    tot_f = sum(fbl.values())
    tot_n = sum(seen.values())
    mode = 'ENABLED — these fixtures took their start FROM the flip' \
           if a.use_live_flip \
           else 'GATED OFF — these fixtures COULD have, and did not'
    print()
    print(f'LADDER I(b) live-flip start, {mode}')
    if not seen:
        # A clean zero that nobody assessed is not a clean zero. This is the
        # same false-negative shape that has bitten this issue three times.
        print('  ::warning:: no fixtures were assessed at all — this is NOT '
              '"the flip recovers nothing", it is "we measured nothing".')
    else:
        hdr = 'flip-started' if a.use_live_flip else 'would recover'
        print(f"  {'league':14} {hdr:>14} {'fixtures seen':>14} {'rate':>8}")
        for lid in sorted(seen, key=lambda x: (x is None, x)):
            n = seen.get(lid, 0)
            f = fbl.get(lid, 0)
            nm = _LEAGUE.get(lid, f'league {lid}')
            flag = '  (n<30)' if n < 30 else ''
            print(f'  {nm:14} {f:>14} {n:>14} {(100.0*f/n if n else 0):>7.1f}%{flag}')
        print(f"  {'TOTAL':14} {tot_f:>14} {tot_n:>14} "
              f"{(100.0*tot_f/tot_n if tot_n else 0):>7.1f}%")

    # ── ITEM B — "confirm none fail the <=60-min lag or <=300 s flip-gap
    # limbs". Reported as an explicit verdict over named counters, because the
    # honest answer to "did any fail" is unobtainable from a total.
    print()
    print(f'LIMB CHECK on Closes cut at the live-flip bound '
          f'(lag <= {RELIABLE_LAG_MIN} min AND flip gap <= {FLIP_GAP_MAX_S} s)')
    lag_rej  = st.get(f'close_reject_lag_over_{RELIABLE_LAG_MIN}min_flip', 0)
    gap_rej  = st.get(f'close_reject_flipgap_over_{FLIP_GAP_MAX_S}s', 0)
    gap_unk  = st.get('close_reject_flipgap_UNKNOWN', 0)
    inplay   = st.get('close_reject_INPLAY_flip', 0)
    unclass  = st.get('close_reject_unclassified_flip', 0)
    n_pass   = st.get('close_ok_flip', 0)
    n_total  = n_pass + lag_rej + gap_rej + gap_unk + inplay + unclass
    if n_total == 0:
        # The vacuous-pass shape this issue has hit three times: "no limb failed"
        # over an empty population is not a pass, it is a measurement of nothing.
        print('  ::warning:: ZERO Closes were cut at the flip bound in this run. '
              'This is NOT "no limb failed" — nothing was assessed, so the limbs '
              'were never exercised and this run cannot support the claim.')
    else:
        print(f"  {'outcome':38} {'n':>6}")
        for label, n in (('PASS  both limbs', n_pass),
                         (f'FAIL  lag > {RELIABLE_LAG_MIN} min', lag_rej),
                         (f'FAIL  flip gap > {FLIP_GAP_MAX_S} s', gap_rej),
                         ('FAIL  flip gap UNKNOWN', gap_unk),
                         ('FAIL  in-play price in close slot', inplay),
                         ('FAIL  unclassified', unclass)):
            print(f'  {label:38} {n:>6}')
        n_fail = n_total - n_pass
        flag = '  (n<30)' if n_total < 30 else ''
        print(f"  {'TOTAL assessed':38} {n_total:>6}{flag}")
        print(f'  VERDICT: {"NONE FAIL" if n_fail == 0 else str(n_fail) + " FAIL"} '
              f'({n_pass}/{n_total} pass)')
        # The margin, not just the verdict.
        def _dist(name, vals, unit):
            if not vals:
                print(f'  {name}: no values recorded')
                return
            v = sorted(vals)
            p95 = v[min(len(v) - 1, int(round(0.95 * (len(v) - 1))))]
            print(f'  {name}: median {v[len(v)//2]:.1f}{unit}  p95 {p95:.1f}{unit}  '
                  f'max {v[-1]:.1f}{unit}  n={len(v)}')
        # ITEM 4 — "Build the denser sweep near the off for flip-started
        # fixtures instead, and report how many of the 17 it recovers."
        #
        # THE DECISIVE TEST, before building anything. A denser sweep can only
        # recover a Close where the shortfall is OUR sampling gap. It cannot
        # recover one where the book had already stopped quoting.
        #
        # For a flip-started fixture the START is the live-flip bound, which can
        # sit hours AFTER the scheduled time when a match is delayed on a busy
        # court. Kibl stops quoting at around the scheduled start. So the lag is
        # the DELAY, not our cadence -- and no sweep frequency closes it.
        #
        # If delay ~= lag, sweeping denser recovers nothing and the honest answer
        # is to say so. If delay is small while lag is large, the gap IS ours and
        # a denser sweep is worth building. The two are distinguishable, so they
        # are distinguished rather than assumed.
        delays = []
        for r in LAG_FAILS:
            # `_start_ts`, NOT `st`. `st` is the Counter built at the top of
            # main() and read at the end of it as `dict(st)` — rebinding it to a
            # float here made every measurement in this block print correctly and
            # then killed the run at the write-back with
            # "TypeError: 'float' object is not iterable" (run 35413651657).
            # The report was sound and the persistence never happened.
            _start_ts, sch = r.get('start_ts'), epoch(r.get('scheduled'))
            if _start_ts is not None and sch is not None:
                delays.append((_start_ts - sch) / 60.0)
        if delays:
            v = sorted(delays)
            p95d = v[min(len(v) - 1, int(round(0.95 * (len(v) - 1))))]
            print(f'  START DELAY (flip start - scheduled start): median '
                  f'{v[len(v)//2]:.1f} min  p95 {p95d:.1f}  max {v[-1]:.1f}  '
                  f'min {v[0]:.1f}  n={len(v)}' + ('  (n<30)' if len(v) < 30 else ''))
            paired = [(r['lag_min'], (r['start_ts'] - epoch(r['scheduled'])) / 60.0)
                      for r in LAG_FAILS
                      if r.get('start_ts') is not None and epoch(r.get('scheduled')) is not None]
            # How much of each failure's lag is explained by the delay alone.
            expl = [min(d, l) / l for l, d in paired if l > 0]
            if expl:
                e = sorted(expl)
                print(f'  DELAY EXPLAINS: median {100*e[len(e)//2]:.0f}% of the lag '
                      f'(n={len(e)}). A denser sweep can only recover the REMAINDER.')
            recoverable = [l for l, d in paired if (l - d) > RELIABLE_LAG_MIN]
            print(f'  RECOVERABLE BY A DENSER SWEEP: {len(recoverable)} of '
                  f'{len(paired)} — fixtures where the lag exceeds the limb even '
                  f'AFTER the delay is accounted for. The rest are the book '
                  f'having stopped quoting, which no cadence fixes.')
        else:
            print('  ::warning:: no failure carried both a start and a scheduled '
                  'time, so the delay-vs-cadence question was NOT assessed.')
        _dist('  passing lag     ', FLIP_LAGS, ' min')
        _dist('  passing flip gap', FLIP_GAPS, ' s')

    # ── ITEM 9 — what the lag failures have in common, and whether sweeping
    # closer to the start would recover them.
    if LAG_FAILS:
        print()
        print(f'ITEM 9 — the {len(LAG_FAILS)} Close(s) rejected on the '
              f'{RELIABLE_LAG_MIN}-min lag limb')
        def _tally(field, label):
            c = collections.Counter(str(r.get(field)) for r in LAG_FAILS)
            named = ', '.join(f'{_LEAGUE.get(int(k), k) if field == "league_id" and str(k).isdigit() else k}={v}'
                              for k, v in c.most_common())
            print(f'  by {label:14} {named}')
        _tally('league_id', 'league')
        _tally('start_src', 'start source')
        _tally('close_hour_utc', 'close hour UTC')
        lags = sorted(r['lag_min'] for r in LAG_FAILS)
        p95 = lags[min(len(lags) - 1, int(round(0.95 * (len(lags) - 1))))]
        print(f'  lag minutes: median {lags[len(lags)//2]:.1f}  p95 {p95:.1f}  '
              f'max {lags[-1]:.1f}  min {lags[0]:.1f}  n={len(lags)}'
              + ('  (n<30)' if len(lags) < 30 else ''))
        # THE ACTIONABLE HALF. A tighter sweep can only help where the shortfall
        # is our sampling gap, not where the book simply stopped quoting. Both
        # are reported because they call for opposite fixes: a denser sweep
        # versus accepting that no pre-start price exists to find.
        for cut in (60, 120, 240):
            n = sum(1 for x in lags if x <= cut)
            print(f'  would pass if the limb were {cut:>3} min: {n:>3} of '
                  f'{len(lags)} ({100.0*n/len(lags):.0f}%)')
        near = sum(1 for x in lags if x <= RELIABLE_LAG_MIN * 2)
        print(f'  VERDICT: {near} of {len(lags)} sit within 2x the limb, so a '
              f'denser sweep near the off is plausible for those; the rest are '
              f'{lags[-1]:.0f}-min-scale gaps that a faster sweep cannot close '
              f'because no nearer price was ever quoted.')

    for sid, hits in sorted(unknown_sides.items()):
        fixtures = sorted({h['fixture_id'] for h in hits})
        print(f'side_id {sid}: {len(hits)} rows over {len(fixtures)} fixtures '
              f'— DASHED. fixtures={fixtures[:20]}'
              + (' ...' if len(fixtures) > 20 else ''))

    matches, merr = load_matches()
    if merr:
        print(f'::warning::could not read {MATCHES} ({merr}) — the orientation '
              f'cross-check loses its upcoming-fixture arm')
    orient, dashed = run_orientation(rows, fx, odds_index, matches,
                                     participant_ids_by_fixture(observations),
                                     os.environ.get('API_TENNIS_KEY', '').strip()
                                     or None)
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
    # Founder ruling 2026-09-18 item 2 — the bar this ships against.
    gate = orient['shipGate']
    print('\nSHIP GATE (founder 2a-2c) — DIRECTION ONLY, never price levels')
    for name, c in sorted(gate['criteria'].items()):
        print(f"  {'PASS' if c['pass'] else 'FAIL'}  {name}: "
              f"{c['actual']} (required {c['required']})")
    print(f"  lopsided group: n={gate['lopsided']['n']}, "
          f"agree={gate['lopsided']['agree']}, "
          f"disagree={gate['lopsided']['disagree']}  [BLOCKING]")
    print(f"  near-even group: n={gate['nearEven']['n']}, "
          f"agree={gate['nearEven']['agree']}, "
          f"disagree={gate['nearEven']['disagree']}  [noted, not blocking]")
    print(f"  GATE: {'PASSES' if gate['passes'] else 'DOES NOT PASS'}")
    print_evidence(gate)
    print_unpaired(orient['unpaired'])
    for d in gate['lopsided']['disagreements']:
        print(f"::error::LOPSIDED disagreement on {d['match_key']} "
              f"({d['kibl']['fixture']}) — this stops the ship. "
              f"kibl={d['kibl']['prices']} independent={d['independent']}")

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
