#!/usr/bin/env python3
"""TEN-232 — promote Bet105 to the card path. A REPLAYABLE patch, not hand edits.

FOUNDER RULING, 2026-09-20 (gate eb147dfc, answered after (f) passed 114/84/0):
"Promote Bet105 to the card path now (set VERIFIED_FEED_SOURCE_ID=171).
 Match winner only, ladder unchanged."

The shared checkout is reset by concurrent runs, so every anchor is exact-match
and the RESULT is tested before the anchor — a replay is a verified no-op rather
than a double-apply.

Usage: python3 ten232-apply-bet105-promote.py <repo-root>
"""
import os
import sys

EDITS = []
CS = 'ten225-kibl-card-state.py'
DASH = 'bsp-consult-dashboard.html'


def edit(path, name, old, new):
    EDITS.append((path, name, old, new))


# ── 1. THE BOOK LABEL ────────────────────────────────────────────────────────
# ⚠️ THIS LINE AND THE FEED-SOURCE ID MUST MOVE TOGETHER OR NOT AT ALL.
# Flipping the id without the label stamps Bet105 prices `sports411`, which is
# the exact breach of the founder's 2026-09-18 item 2 ("nothing on any surface
# may imply otherwise") that VERIFIED_FEED_SOURCE_ID was installed to prevent.
edit(CS, 'BOOK: the book we are now served',
     "BOOK = 'sports411'          # the book we are actually served; NOT Bet105 (measured)",
     "BOOK = 'bet105'             # the book we are NOW served. See the swap note below.\n"
     "# Rows already written as `sports411` KEEP that label — founder, 2026-09-18:\n"
     "# \"Everything already captured or published as sports411 keeps that label.\"\n"
     "# Nothing here rewrites them; this constant only stamps rows written FROM NOW.")

# ── 2. THE ENTITLEMENT NOTE — it currently asserts something that is false ───
edit(CS, 'the entitlement paragraph (it said Bet105 does NOT appear)',
     "# MEASURED 2026-09-18T22:33Z, run 35401888326: /reference/sportsbooks returns\n"
     "# exactly ONE book — feed_source_id 43, name Sports411, tag `sports411`. Bet105\n"
     "# does NOT appear; the entitlement IS that list (a restricted account returns\n"
     "# 200 with fewer rows, never a 403), so this is an answer, not a failed call.\n"
     "#\n"
     "# So today this filter excludes nothing and is a no-op. That is exactly when it\n"
     "# is safe to install one. Raising it later, after a second book is already in\n"
     "# the table, would mean auditing which cards were built from which book after\n"
     "# the fact.",
     "# ⚠️ THE ENTITLEMENT SWAPPED. IT DID NOT GROW.\n"
     "# MEASURED 2026-09-20T23:18Z, run 35544209624: /reference/sportsbooks returns\n"
     "# exactly ONE book — **feed_source_id 171, name Bet105**, tag `bet105`.\n"
     "# **Sports411 (43) is GONE.** The change landed 2026-09-19T14:07:24Z (the stamp\n"
     "# the entitlement watch wrote into kibl-entitlement-baseline.json).\n"
     "#\n"
     "# Until 2026-09-18 this note said the opposite — \"Bet105 does NOT appear\" —\n"
     "# and that was true when it was written and false the next day. It is corrected\n"
     "# rather than deleted, because a stale confident claim in a header is how the\n"
     "# next reader gets the answer wrong without ever re-measuring.\n"
     "#\n"
     "# The guard did its job in the meantime: between the swap and this promotion it\n"
     "# excluded EVERY Bet105 row (56,976 of them) from every card, on a green run,\n"
     "# while the archive captured them with no deploy. That is the whole design.\n"
     "#\n"
     "# Bet105 is here now because it PASSED ITS OWN GATE on its own data, not\n"
     "# because it inherited Sports411's: run 35545303855, 114 fixtures paired with an\n"
     "# independent source, 84 of them lopsided, **0 disagreements on the favourite**.\n"
     "# Founder ruled promote on 2026-09-20. Match winner only; the ladder is\n"
     "# unchanged (neither book is named in MX_BOOK_LADDER, so both rank 500).")

edit(CS, 'VERIFIED_FEED_SOURCE_ID 43 -> 171',
     "VERIFIED_FEED_SOURCE_ID = 43",
     "VERIFIED_FEED_SOURCE_ID = 171")

# The OBS_COLUMNS comment names the label it is checking. It has to move with it,
# or it documents a check against a book that can no longer arrive.
edit(CS, 'the feed_source_id read-back comment',
     "    # assert per row that every price it is about to stamp `sports411` actually\n"
     "    # came from Sports411. A filter alone is a promise about the query; reading\n"
     "    # the column back is a check on the answer.",
     "    # assert per row that every price it is about to stamp with BOOK actually\n"
     "    # came from VERIFIED_FEED_SOURCE_ID. A filter alone is a promise about the\n"
     "    # query; reading the column back is a check on the answer. It is keyed on\n"
     "    # the constants, not on a book name, so the entitlement swap of 2026-09-19\n"
     "    # could not leave the check pointing at a book we no longer receive.")

# ── 3. THE TIE THE SWAP CREATES — and it would have DASHED live cards ────────
edit(CS, 'resolve a rank-1 tie between the old book and the entitled one',
     """        best_tier, best_rank = scored[0][0], scored[0][1]
        winners = [s for s in scored if s[0] == best_tier and s[1] == best_rank]
        if len(winners) > 1:""",
     """        best_tier, best_rank = scored[0][0], scored[0][1]
        winners = [s for s in scored if s[0] == best_tier and s[1] == best_rank]

        # ⚠️ AN ENTITLEMENT SWAP IS NOT A COIN TOSS, AND WITHOUT THIS IT READS AS
        # ONE. Kibl swapped Sports411 (43) for Bet105 (171) on 2026-09-19T14:07Z.
        # `odds_card_state` therefore holds legacy `sports411` rows AND new
        # `bet105` rows, both written by this file at BOOK_RANK 1 — so any fixture
        # quoted by both books across the swap is a rank-1 tie, and the branch
        # below would drop it. A card that shows a price today would go to a dash
        # tomorrow for a reason that is not about the market at all.
        #
        # The tie-break is a FACT, not a preference: Sports411 is no longer served,
        # so where both exist the Bet105 row is the live one and the Sports411 row
        # is frozen history. Nothing is relabelled — the legacy row keeps its own
        # book name and simply stops being selected.
        #
        # Narrow on purpose. It fires ONLY at BOOK_RANK (the Kibl slot, which no
        # other source writes) and ONLY when exactly one tying book is the one we
        # are currently entitled to. Two genuinely ambiguous books still drop,
        # which is the refusal this branch exists for.
        if len(winners) > 1 and best_rank == BOOK_RANK:
            entitled = [w for w in winners if w[2] == BOOK]
            if len(entitled) == 1:
                st['kibl_entitlement_tie_resolved'] += 1
                winners = entitled

        if len(winners) > 1:""")

# ── 4. NO DISPLAY-LABEL EDIT, AND THE HARNESS IS WHY ────────────────────────
# I first added `bet105: 'Bet105'` to MX_BOOK_LABELS for the vendor's own
# casing. test-ten225-book-relabel.mjs went red on "exactly THREE entries in the
# map, so a fourth cannot be added without this assertion being revisited" —
# which is that assertion doing precisely its job.
#
# Revisited, and the entry does not belong there. That map is the three
# VENDOR-CONFIRMED ABBREVIATION EXPANSIONS (Sbo -> SBOBET, Pncl -> Pinnacle,
# Victor Chandler -> BetVictor). `bet105` is not an abbreviation of anything; it
# is the vendor's own spelling, and folding a casing preference into an
# abbreviation table is how the next reader concludes the feed sends something
# it does not.
#
# So Bet105 renders as `bet105` — exactly as `sports411` rendered before it, and
# for the same reason. The founder ruled "promote to the card path"; he did not
# ask for a restyle, and the dashboard is untouched by this patch.


# ── 5. THE RULINGS BECOME TESTS, SAME DAY ───────────────────────────────────
# Rewritten to the ruling in force, never deleted: their job is to PIN where the
# line is, and a deleted assertion pins nothing. Each one now carries the run
# that measured it, so the next reader can re-check rather than re-derive.
TCS = 'test-ten225-kibl-card-state.py'

edit(TCS, 'the book assertion',
     "check('book is the book we are actually served', r1['book'] == 'sports411', r1['book'])",
     "# Was 'sports411' until 2026-09-20. Kibl SWAPPED the book on our credential\n"
     "# (43 Sports411 -> 171 Bet105, 2026-09-19T14:07Z) and the founder promoted\n"
     "# Bet105 to the card path once it passed its own side-mapping gate.\n"
     "check('book is the book we are actually served NOW — Bet105, not the '\n"
     "      'Sports411 it replaced', r1['book'] == 'bet105', r1['book'])")

edit(TCS, 'the VERIFIED_FEED_SOURCE_ID assertion',
     "check('VERIFIED_FEED_SOURCE_ID is 43 - Sports411, the ONLY book '\n"
     "      '/reference/sportsbooks returned (measured 2026-09-18T22:33Z, run '\n"
     "      '35401888326). Not a placeholder and not inferred.',\n"
     "      getattr(K, 'VERIFIED_FEED_SOURCE_ID', None) == 43,\n"
     "      getattr(K, 'VERIFIED_FEED_SOURCE_ID', '<missing>'))",
     "check('VERIFIED_FEED_SOURCE_ID is 171 - Bet105, the ONLY book '\n"
     "      '/reference/sportsbooks returns (measured 2026-09-20T23:18Z, run '\n"
     "      '35544209624; it REPLACED Sports411/43, which is gone). Promoted only '\n"
     "      'after its own gate passed 114/84/0 on run 35545303855.',\n"
     "      getattr(K, 'VERIFIED_FEED_SOURCE_ID', None) == 171,\n"
     "      getattr(K, 'VERIFIED_FEED_SOURCE_ID', '<missing>'))\n"
     "\n"
     "check('the id and the LABEL moved together — an id pointing at Bet105 while '\n"
     "      'BOOK still said sports411 would stamp every Bet105 price with the name '\n"
     "      'of a book it did not come from, which is the exact breach this '\n"
     "      'constant was installed to prevent',\n"
     "      (getattr(K, 'VERIFIED_FEED_SOURCE_ID', None) == 171)\n"
     "      == (getattr(K, 'BOOK', None) == 'bet105'),\n"
     "      f\"id={getattr(K, 'VERIFIED_FEED_SOURCE_ID', None)} \"\n"
     "      f\"book={getattr(K, 'BOOK', None)}\")")

edit(TCS, 'the manufactured observation carries the entitled feed source',
     "'feed_source_id': 43,",
     "'feed_source_id': 171,")

edit(TCS, 'the entitlement-swap tie-break test',
     """check('two DIFFERENT books at one rank on one fixture drop on ambiguity',
      not any(r['is_selected'] for r in rows) and st['rank_tie_dropped'] == 1,
      dict(st))""",
     """check('two DIFFERENT books at one rank on one fixture drop on ambiguity',
      not any(r['is_selected'] for r in rows) and st['rank_tie_dropped'] == 1,
      dict(st))

# ── THE ENTITLEMENT SWAP, 2026-09-19T14:07Z ─────────────────────────────────
# Kibl replaced Sports411 (43) with Bet105 (171). odds_card_state therefore
# holds legacy `sports411` rows AND new `bet105` rows, both written at
# BOOK_RANK 1 — so a fixture quoted by both across the swap is a rank-1 tie.
# Without the tie-break the check directly above would fire on it and the card
# would go to a DASH: a price today, nothing tomorrow, for a reason that has
# nothing to do with the market.
rows, st = K.select_winners([srow('d|a|b', K.BOOK_RANK, 'kibl', book='sports411'),
                             srow('d|a|b', K.BOOK_RANK, 'kibl', book=K.BOOK)])
sel = [r for r in rows if r['is_selected']]
check('a legacy-book row and an entitled-book row at one rank do NOT drop — '
      'the swap is a fact, not a coin toss',
      len(sel) == 1 and st.get('rank_tie_dropped', 0) == 0, dict(st))
check('...and the ENTITLED book is the one selected; the legacy row is demoted, '
      'never relabelled',
      sel and sel[0]['book'] == K.BOOK, [r['book'] for r in sel])
check('...and the resolution is COUNTED, so the day it fires is a number in the '
      'summary rather than silence',
      st.get('kibl_entitlement_tie_resolved', 0) == 1, dict(st))

# CONTROL. Same shape, neither book entitled -> it must still drop. Without
# this, a tie-break that simply picked the first row would pass every check
# above.
_c_rows, _c_st = K.select_winners([srow('d|a|b', K.BOOK_RANK, 'kibl', book='kiblA'),
                                   srow('d|a|b', K.BOOK_RANK, 'kibl', book='kiblB')])
check('CONTROL: two books at one rank with NEITHER entitled still drop',
      not any(r['is_selected'] for r in _c_rows)
      and _c_st['rank_tie_dropped'] == 1, dict(_c_st))

# CONTROL. A rank that is not the Kibl slot must never be narrowed this way —
# the tie-break is a statement about ONE source's book changing, not a licence
# to break ties anywhere.
_d_rows, _d_st = K.select_winners([srow('d|a|b', 2, 'oddspapi', book=K.BOOK),
                                   srow('d|a|b', 2, 'oddspapi', book='other')])
check('CONTROL: the tie-break does not reach a rank other than BOOK_RANK',
      not any(r['is_selected'] for r in _d_rows)
      and _d_st['rank_tie_dropped'] == 1, dict(_d_st))""")

# ── 6. THE WATCH TEST PINNED THE LITERAL, AND THAT IS THE SAME DEFECT AGAIN ──
# `test-ten232-entitlement-watch.py` asserted the SOURCE TEXT
# `VERIFIED_FEED_SOURCE_ID = 43`. That is the identical shape as the baseline
# assertion sitting twelve lines below it — which another run has already had to
# fix, for exactly this reason, after a monitor doing its job took the site
# undeployable. A value that moves by design must not be pinned by a gate.
#
# What the check MEANS, per its own wording, is "the card path admits ONE book,
# and which one is bound to a constant a human has to move deliberately". That
# is true at 43, true at 171, and false for the thing it exists to catch: a read
# that admits every book in the archive.
TEW = 'test-ten232-entitlement-watch.py'

edit(TEW, 'the card-path assertion: the property, not the frozen id',
     """check('VERIFIED_FEED_SOURCE_ID is still the only book the card path admits, so a '
      'newly activated book is captured by the sweep and REFUSED by the card',
      'VERIFIED_FEED_SOURCE_ID = 43' in CARD)""",
     """# ⚠️ DO NOT PIN THE ID HERE. This read `'VERIFIED_FEED_SOURCE_ID = 43' in CARD`
# until 2026-09-20, when the founder promoted Bet105 (171) after its gate passed
# — and a gate that goes red because a ruling was CARRIED OUT is not measuring
# the thing it names. Same defect the baseline assertion below already had to be
# rescued from. The guarantee is single-valued admission bound to a constant;
# the value is TEN-232's business, not this gate's.
_m = re.search(r'^VERIFIED_FEED_SOURCE_ID\\s*=\\s*(\\d+)\\s*$', CARD, re.M)
check('the card path admits exactly ONE feed_source_id, and it is a bare int '
      'constant a human has to move deliberately — not a list, not a wildcard',
      _m is not None, '<no single-int assignment found>')
check('...and the observation read is BOUND to that constant rather than to a '
      'literal id, so promoting a book after its gate passes is one line and '
      'cannot leave the filter pointing at the book it replaced',
      'feed_source_id=eq.{VERIFIED_FEED_SOURCE_ID}' in CARD)
check('...and nothing widens it to every book in the archive, which is the '
      'failure this guard actually exists to catch',
      'feed_source_id=in.' not in CARD and 'feed_source_id=neq.' in CARD)""")

edit(TEW, 'the superseded NOTE about 43 vs 171',
     "    # NOTE, and it is not cosmetic: the entitlement HAS moved, 43/Sports411 ->\n"
     "    # 171/Bet105, while VERIFIED_FEED_SOURCE_ID is still 43. The assertion above\n"
     "    # that the card path admits only book 43 still passes, so no unverified book\n"
     "    # can reach a card - but which book the account actually carries is now a\n"
     "    # live question for TEN-232, not something this gate should answer.",
     "    # NOTE: the entitlement moved 43/Sports411 -> 171/Bet105 on 2026-09-19T14:07Z,\n"
     "    # and on 2026-09-20 the founder promoted Bet105 to the card path after it\n"
     "    # passed its own side-mapping gate (114 paired, 84 lopsided, 0 disagreements,\n"
     "    # run 35545303855). VERIFIED_FEED_SOURCE_ID is now 171. The assertion above\n"
     "    # no longer names either number, deliberately: which book we carry is a live\n"
     "    # question for TEN-232, and a pre-deploy gate must not go red because the\n"
     "    # answer changed.")

edit(TEW, 're is imported for the constant scan',
     "import json\n",
     "import json\nimport re\n")

edit(TCS, 'the mutation-control record',
     "  i. split_kibl_fixture_name() accepts doubles              RED (wrong card)",
     "  i. split_kibl_fixture_name() accepts doubles              RED (wrong card)\n"
     "  j. BOOK moves to bet105 while the id stays 43             RED (mislabel)\n"
     "  k. the entitlement tie-break ignores BOOK                 RED (coin toss)")


# ── 7. THE LABEL PROBE IS NOW INVERTED ──────────────────────────────────────
# `ten232-bet105-label-probe.mjs` was written on 2026-09-18 to prove the
# founder's item 2 — "no Bet105 price reaches a card until the gate passes" —
# and every one of its assertions says some form of "Bet105 appears nowhere".
# The gate has now passed and the founder has ruled promote, so left as it is it
# asserts the opposite of the standing ruling. It is not in `npm test` (its name
# does not match the suite pattern), so it would not have reddened a deploy — it
# would just have quietly told the next reader the wrong thing.
#
# Rewritten to the invariant that SURVIVES the promotion: the two books are
# never conflated. Bet105 is expected on cards; sports411 rows keep their own
# label; neither is rendered under the other's name.
PROBE = 'ten232-bet105-label-probe.mjs'

# LANDED in 89f87e8c: the probe's absence-assertions were inverted to the
# post-promotion invariant there. NOT re-registered here — its anchor is gone
# from main by construction, and an edit that can never match again would make
# every replay of this script an ::error:: instead of a verified no-op.
# Edit 8 below continues from that landed text.
edit(PROBE, 'the published-file assertions follow the same ruling',
     """  check('the published data file carries no Bet105 label', nB === 0, `${nB}`);
  check('...and it is non-empty, so that zero was read rather than missed',
        nS > 0, `${nS} sports411 rows`);""",
     """  check('the published data file was read at all — without this, every count '
        + 'below is a zero nobody looked for', ocs.length > 200, `${ocs.length} bytes`);
  check('the published file now carries Bet105, so the promotion reached the '
        + 'data and not only the code', nB > 0, `${nB} bet105 mentions`);
  console.log(`  legacy sports411 mentions still on file: ${nS} (frozen history; `
              + `no new one can arrive — 43 left the entitlement 2026-09-19T14:07Z)`);""")


# ── 8. THE PROBE FAILED ON AN EMPTY SET, WHICH IS THE MIRROR OF A VACUOUS PASS ─
# MEASURED 2026-09-21T00:50Z on the deployed board: THREE cards, and not one of
# them a Kibl fixture — bet105 tooltips 0, and **sports411 tooltips 0 as well**.
# A board carrying no Kibl match cannot answer "did Bet105 replace Sports411 on
# the cards"; reporting a red there says the promotion failed when nothing was
# tested. Gate on the precondition and skip out loud.
edit(PROBE, 'gate the render check on there being a Kibl fixture at all',
     """  check('the Kibl book now renders as bet105 — the promotion is visible, not '
        + 'merely merged', (r.books.bet105 || 0) > 0,
        `bet105 tooltips: ${r.books.bet105 || 0}`);""",
     """  const kiblOnBoard = (r.books.bet105 || 0) + (r.books.sports411 || 0);
  if (kiblOnBoard === 0) {
    // NOT a pass and NOT a fail. The set is empty, so there is nothing to
    // measure — and a red here would read as "the promotion did not work".
    console.log('  SKIP  no Kibl fixture on the board at all (bet105 0 + sports411 0):'
                + ' this check has nothing to measure. Re-run on a board carrying a'
                + ' Challenger/ATP day.');
  } else {
    check('the Kibl book now renders as bet105 — the promotion is visible, not '
          + 'merely merged', (r.books.bet105 || 0) > 0,
          `bet105 ${r.books.bet105 || 0} vs legacy sports411 ${r.books.sports411 || 0}`);
  }""")


def apply(root):
    changed = 0
    for path, name, old, new in EDITS:
        full = os.path.join(root, path)
        src = open(full, encoding='utf-8').read()
        # RESULT FIRST: several edits keep the anchor they insert beside, so an
        # anchor-first test would re-apply on replay.
        if src.count(new) >= 1:
            print(f'  no-op   {name}')
            continue
        n = src.count(old)
        if n != 1:
            print(f'::error::  {name}: anchor matched {n} times, expected 1')
            return 1
        open(full, 'w', encoding='utf-8').write(src.replace(old, new, 1))
        print(f'  applied {name}')
        changed += 1
    print(f'{changed} edit(s) applied')
    return 0


if __name__ == '__main__':
    raise SystemExit(apply(sys.argv[1] if len(sys.argv) > 1 else '.'))
