"""The ONE place book names are normalised and expanded. TEN-225 item 6.

Founder 2026-09-19: "Make normalised book-name matching the standard anywhere we
compare names across sources — the WilliamHill case is exactly how a real book
gets reported as absent."

THE CASE THAT CAUSED THIS. A coverage report matched the founder's priority list
literally and announced:

    5  William Hill        0      0.0%   <- ABSENT from the feed on every day measured

while api-tennis was returning `WilliamHill` on 244 fixtures. The book was there
the whole time. A book wrongly reported absent is worse than an unmeasured one,
because it reads as a measurement and gets acted on — that report was about to
drop a real book out of a ladder.

THE RULE: never compare book names as strings. Compare `canon(name)`.

    canon('William Hill') == canon('WilliamHill') == canon('WILLIAM HILL')

Casing, spacing, punctuation and hyphenation are the VENDOR'S to change, and
they do change between feeds for the same book. Anything that survives
lowercasing and stripping non-alphanumerics is what actually identifies a book.

VENDOR-CONFIRMED EXPANSIONS (founder item G1, api-tennis reply 2026-09-19).
These were inferences until the vendor confirmed them; they are now facts and
the guessing is retired:

    Sbo             -> SBOBET
    Pncl            -> Pinnacle
    Victor Chandler -> BetVictor

⚠️ `display()` is for the member-facing string ONLY. Identity tests — "is this
bet365?", "are these two rows the same book?" — must use `canon()`, never the
display name. Routing an identity test through a display relabel would let a
rename decide which prices may be paired with which, which is the cross-book
blend the one-book rule forbids. The dashboard draws the same line: its
`mxBookLabel` is display-only and `_isBet365` deliberately does not go through it.
"""

# Keyed on canon() form, so a vendor respelling cannot silently un-expand a book.
VENDOR_CONFIRMED = {
    'sbo': 'SBOBET',
    'pncl': 'Pinnacle',
    'victorchandler': 'BetVictor',
}


def canon(name):
    """The identity of a book, independent of how a feed spells it.

    Lowercase, alphanumerics only. This is what every cross-source comparison
    must key on. Returns '' for None/empty so a missing name cannot accidentally
    match another missing name in a dict lookup that treats '' as a real key --
    callers should test for falsiness before using the result as an identity.
    """
    return ''.join(c for c in str(name or '').lower() if c.isalnum())


def display(name):
    """The member-facing string: vendor-confirmed expansion, else verbatim.

    Verbatim is deliberate. A map that rewrote unrecognised books would be a
    false label, and this issue has paid for false labels repeatedly. Three books
    are expanded; every other name passes through untouched.
    """
    if not name:
        return name
    return VENDOR_CONFIRMED.get(canon(name), name)


# canon() of an abbreviation -> canon() of the book it abbreviates. Derived from
# VENDOR_CONFIRMED rather than restated, so the two lists cannot drift apart.
_ALIAS = {abbrev: canon(full) for abbrev, full in VENDOR_CONFIRMED.items()}


def ident(name):
    """The book's IDENTITY, folding vendor-confirmed abbreviations.

    ⚠️ THIS IS NOT canon(), AND THE DIFFERENCE IS A REAL DEFECT I SHIPPED.
    `canon('Pncl') == 'pncl'` and `canon('Pinnacle') == 'pinnacle'`, so a
    coverage report keyed on canon() printed

        Pinnacle    0    0.0%  <- ABSENT

    on 2026-09-19 while the same payload carried `Pncl` on 5 fixtures. That is
    the WilliamHill failure again, one layer down: canon() fixes spelling, and
    an ABBREVIATION is not a spelling.

    Use ident() for any cross-source comparison of books — coverage counts,
    ladder lookups, "does this feed carry book X". canon() remains correct where
    the question is only about spelling of one vendor's own string.

    Only the three vendor-CONFIRMED abbreviations fold. Nothing is guessed: an
    unrecognised name is its own identity, so a new abbreviation shows up as a
    new book rather than being silently merged into an existing one.
    """
    c = canon(name)
    return _ALIAS.get(c, c)


def same_book(a, b):
    """Are these two names the same book? The only correct way to ask.

    Folds abbreviations, so `same_book('Sbo', 'SBOBET')` is True — they are one
    book and every price-level comparison between them would otherwise read as
    two books disagreeing.
    """
    ia, ib = ident(a), ident(b)
    return bool(ia) and ia == ib


def find(name, candidates):
    """The entry in `candidates` naming the same book, or None.

    `candidates` may be any iterable of names or a dict keyed by name. This is
    the lookup that replaces `name in some_list`, which is exactly the test that
    reported William Hill absent.
    """
    c = ident(name)
    if not c:
        return None
    for k in candidates:
        if ident(k) == c:
            return k
    return None
