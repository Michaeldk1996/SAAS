#!/usr/bin/env python3
"""TEN-225 — cross-feed player-name keys and the match join key.

WHY THIS MODULE EXISTS
----------------------
Three feeds now name the same player three different ways:

    oddspapi    'Zverev, Alexander'                surname FIRST, comma
    api-tennis  'A. Zverev' / 'Alexander Zverev'   surname LAST
    kibl        '6112 Dhakshineswar Suresh vs Soonwoo Kwon'
                                                   both players in ONE string,
                                                   surname LAST, rotation number
                                                   glued to the front

`ten225-load-line-summary.py` already carries the two-feed version of this rule
and is live with 114 assertions behind it. This module is NOT a rewrite of it —
it is the same rule, importable by jobs that must not exec a 1,000-line loader
just to key a name (`archive-kibl.py` runs inside the sweep, where a failure
costs a price nobody can re-fetch).

Two copies of one rule is how a matcher drifts, so the drift is made LOUD rather
than trusted: `test-ten225-kibl-card-state.py` execs the line-summary loader and
asserts `L.name_key(x) == name_key(x)` over a corpus that includes every trap
the original harness found. If either file moves, that assertion goes red.

Stdlib only. No network, no secrets.
"""
import datetime
import unicodedata

# The rotation number Kibl glues to the front of a fixture name ("6112 Suresh
# vs Kwon"). Stripped for display; harmless for keying because name_key() drops
# non-alphabetic tokens anyway.
_VS = ' vs '


# TEN-225 ruling D (founder, 2026-09-18) — "fix the matcher (Auger-Aliassime and
# any other non-isalpha surname)".
#
# THE BUG. name_key() keeps a token only if `t.isalpha()`, and a hyphen is not a
# letter. 'Auger-Aliassime' therefore produced NO token at all and the key came
# back None, so the fixture was unpairable in every direction — not mis-paired,
# invisible. Apostrophes fail identically: "O'Connell" keyed to None for the same
# reason, and that second class was never named.
#
# THE FIX, AND WHY IT IS A SPACE AND NOT A KEPT HYPHEN. Keeping the hyphen inside
# the token would key 'auger-aliassime', which only pairs against a feed that
# also writes the hyphen. api-tennis is documented HERE to reorder and respace
# multi-part surnames, so the space variant is not hypothetical. Folding the
# separator to a SPACE puts both spellings through the existing last-token rule
# and they land on the same key:
#
#     'Auger-Aliassime, Felix'  -> 'auger aliassime' -> 'aliassime'
#     'F. Auger-Aliassime'      -> 'f auger aliassime' -> 'aliassime'
#     'F. Auger Aliassime'      -> 'f auger aliassime' -> 'aliassime'
#
# which is exactly how 'Van de Zandschulp' is already handled. No new rule — the
# existing rule, finally reaching the names it was locked out of.
#
# The full dash range is folded, not just ASCII '-': feeds emit U+2010..U+2015
# and the two curly apostrophes, and a matcher that handles one spelling of a
# separator and not another is the same bug with a different code point.
_SEPS = str.maketrans({c: ' ' for c in "-‐‑‒–—―'‘’ʼ"})


def nfd(s):
    """Standing rule: NFD accent strip before any cross-feed name comparison."""
    s = unicodedata.normalize('NFD', s or '')
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return ' '.join(s.lower().replace(',', ' ').replace('.', ' ')
                    .translate(_SEPS).split())


def name_key(name):
    """A surname key that survives the feeds' different orderings.

    Take the part before the comma if there is one, else the whole string, then
    key on its LAST alphabetic token of length > 1.

    "Last token of the surname part", not "the whole surname part", because
    api-tennis reorders multi-part surnames: 'Van de Zandschulp, Botic' and
    'B. Van De Zandschulp' both reduce to 'zandschulp'.

    NOT the longest token — that was the first draft on the oddspapi side and
    its harness caught it: 'Zverev, Alexander' has 'alexander' as its longest
    token and 'A. Zverev' has 'zverev', so every full-vs-initial pair silently
    failed to match.
    """
    s = nfd(name.split(',')[0] if ',' in (name or '') else name)
    toks = [t for t in s.split() if len(t) > 1 and t.isalpha()]
    return toks[-1] if toks else None


def given_initial(name):
    """The first letter of this player's GIVEN name, or None.

    Reads the same three feed orderings name_key() does, and must agree across
    them or it is useless as a conflict test:

        'Auger-Aliassime, Felix'  -> after the comma      -> 'f'
        'F. Auger-Aliassime'      -> before the surname   -> 'f'
        'Felix Auger-Aliassime'   -> before the surname   -> 'f'
        'Nadal'                   -> no given name at all -> None

    None means "this feed did not tell us", which is NOT a conflict — see
    initials_conflict().
    """
    raw = name or ''
    if ',' in raw:
        part = nfd(raw.split(',', 1)[1])
    else:
        toks = nfd(raw).split()
        part = ' '.join(toks[:-1])       # everything ahead of the surname token
    toks = [t for t in part.split() if t]
    return toks[0][0] if toks else None


def initials_conflict(a, b):
    """True when two names share a surname key but CANNOT be the same player.

    FOUNDER RULING D (2026-09-18): "surnames match but given-name initials
    conflict = drop, not pair."

    MEASURED REASON (ten225-d-matcher-delta.py, 2,807 local names). Folding the
    hyphen is what lets a surname key reach the tail of a compound name, and that
    is also what lets two different players land on one key. The corpus holds the
    case already: Benjamin O'Connell and Christopher O'Connell both key to
    'connell'. Before the fold they keyed to 'benjamin' and 'christopher' — they
    could not collide because they were being keyed on their FIRST names, which
    was a worse bug hiding this one.

    ONE-SIDED ABSENCE IS NOT A CONFLICT. A feed that gives only a surname tells
    us nothing about the given name, and treating silence as disagreement would
    drop every legitimate single-token pairing ('Nadal' vs 'R. Nadal'). Only two
    PRESENT and DIFFERENT initials are a conflict.
    """
    ia, ib = given_initial(a), given_initial(b)
    return bool(ia and ib and ia != ib)


def split_kibl_fixture_name(raw):
    """Kibl's one-string fixture name -> (player1, player2) or (None, None).

    Returns the two players in the order the feed wrote them, with the leading
    rotation number stripped. (None, None) for anything that is not two singles
    players, and that NULL is load-bearing: it is what makes a doubles fixture
    dash rather than pair on half a name.

    Doubles are excluded on the '/' that separates a pair ('A/B vs C/D'). This
    step prices match winner on singles only; a doubles fixture that paired onto
    a singles match would put one pair's price on another match's card.
    """
    if not raw or not isinstance(raw, str):
        return None, None
    # Case-insensitive ' vs ' only — never a bare 'vs' substring, which would
    # split 'Davis Cup' style names containing the letters inside a word.
    low = raw.lower()
    idx = low.find(_VS)
    if idx < 0:
        return None, None
    left, right = raw[:idx], raw[idx + len(_VS):]
    if low.find(_VS, idx + 1) >= 0:
        # Two separators: we cannot tell which one divides the fixture.
        return None, None
    if '/' in left or '/' in right:
        return None, None
    left = _strip_rotation(left).strip()
    right = right.strip()
    if not left or not right:
        return None, None
    return left, right


def _strip_rotation(s):
    """Drop a leading rotation number ('6112 Soonwoo Kwon' -> 'Soonwoo Kwon').

    Only a leading ALL-DIGIT token is dropped, and only the first one. A player
    whose name begins with a digit does not exist, but a name that merely
    CONTAINS one must survive intact.
    """
    parts = s.strip().split()
    if parts and parts[0].isdigit():
        parts = parts[1:]
    return ' '.join(parts)


def match_key(day, p1, p2):
    """The cross-feed join key for one match: 'YYYY-MM-DD|keyA|keyB', sorted.

    Sorted so the two feeds' player ORDER cannot produce two different keys for
    one match — orientation is a separate question, answered per row, and it
    must not leak into identity.

    Returns None — never a partial key — when either name fails to key or the
    two key to the SAME surname. Two same-surname players (brothers, or a
    parse that swallowed a name) would make the key unable to distinguish the
    sides, and the standing rule is to drop on ambiguity rather than guess.
    """
    k1, k2 = name_key(p1), name_key(p2)
    if not (day and k1 and k2) or k1 == k2:
        return None
    a, b = sorted((k1, k2))
    return f'{day[:10]}|{a}|{b}'


# ── TEN-270 date-key ruling (founder 2026-09-24T10:16Z) ─────────────────────
# "Make the card-state date key match the card and stream key." A vendor's own
# start time is NOT the card's date: Kibl's scheduled_start is UTC (a 01:15
# UTC+2 card is the previous UTC day) and Kibl re-lists matches at a provisional
# time hours away (Medvedev-Royer, a 26 Sep 04:00 card, was listed on 25 Sep).
# 16 of 142 carded matches were keyed to the wrong day between 2026-09-18 and
# 2026-09-24, so the page (ocsKeyOf = card date) found no entry.
BOARD_REKEY_DAYS = 2


def board_pair_index(matches):
    """matches.json -> {(surname_a, surname_b): {card match_key, ...}}."""
    idx = {}
    for m in matches or []:
        k = match_key((m.get('date') or '')[:10], m.get('p1'), m.get('p2'))
        if k:
            _, a, b = k.split('|')
            idx.setdefault((a, b), set()).add(k)
    return idx


def board_key_for(key, pair_index, days=BOARD_REKEY_DAYS):
    """A vendor match_key -> (the board card's key, verdict).

    verdict: 'same' (already the card's key), 'rekeyed', 'no_card' (no board
    card with this pair within +/-days: the vendor key is kept, and the next run
    re-keys once the card appears), or 'ambiguous' (two or more such cards: the
    vendor key is kept, never a guessed card)."""
    if not key or key.count('|') != 2:
        return key, 'no_card'
    day, a, b = key.split('|')
    try:
        d0 = datetime.date.fromisoformat(day)
    except ValueError:
        return key, 'no_card'
    near = sorted(k for k in pair_index.get((a, b), ())
                  if abs((datetime.date.fromisoformat(k[:10]) - d0).days) <= days)
    if not near:
        return key, 'no_card'
    if len(near) > 1:
        return (key, 'same') if key in near else (key, 'ambiguous')
    return near[0], ('same' if near[0] == key else 'rekeyed')


def rekey_rows_to_board(rows, matches, st=None):
    """Rewrite each row's match_key to its board card's key, in place. Counts
    every verdict in st (a Counter) under rekey_<verdict>.

    Never MERGES two fixtures of one book onto one key (review round 3,
    finding 3): a provisional and a real listing of the same match are two
    fixture ids; moved onto one key, the selection pass sees two rows for one
    side, drops the group, and the card goes blank. Such a move is undone and
    counted rekey_fixture_collision — the row keeps its vendor key, exactly as
    before this rule existed."""
    idx = board_pair_index(matches)
    plan = []
    for r in rows:
        k, verdict = board_key_for(r.get('match_key'), idx)
        plan.append((r, r.get('match_key'), k, verdict))
    owners = {}
    for r, old, new, _ in plan:
        owners.setdefault((new, r.get('book')), set()).add(str(r.get('fixture_id')))
    for r, old, new, verdict in plan:
        if verdict == 'rekeyed' and len(owners.get((new, r.get('book')), ())) > 1:
            new, verdict = old, 'fixture_collision'
        if st is not None:
            st[f'rekey_{verdict}'] += 1
        r['match_key'] = new
    return rows
