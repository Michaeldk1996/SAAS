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
import unicodedata

# The rotation number Kibl glues to the front of a fixture name ("6112 Suresh
# vs Kwon"). Stripped for display; harmless for keying because name_key() drops
# non-alphabetic tokens anyway.
_VS = ' vs '


def nfd(s):
    """Standing rule: NFD accent strip before any cross-feed name comparison."""
    s = unicodedata.normalize('NFD', s or '')
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return ' '.join(s.lower().replace(',', ' ').replace('.', ' ').split())


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
