TEN-244: carry per-set GAMES through the fixtures half, and exclude unfinished matches by the score

The Database Lines tab needs per-set GAMES. `result` is a set COUNT ("2 - 1");
`f.scores` is the games in each set, and the fixtures-half push kept the former
and dropped the latter on every row - which is why per-set games sat at 7.9% on
that half (99.5% on the archive half) and 0.5% across the last 52 weeks.

Reuses formSetsFromFixture rather than parsing again, per the ticket: it is
already player-oriented, already decodes api-tennis's "<games>.<tiebreakPoints>"
into pTb/oTb, and already drops the 0-0 pseudo-set the feed emits for a walkover.
Zero new fetches - these fields are in responses we already pay for.

THE COMPLETENESS PREDICATE, and the defect a clean-context review caught in the
first version of it. A line is a RATE, so an abandoned match counted as a miss
deflates numerator and denominator together and nothing on screen reveals it.
The flags do not cover it: in a 5,870-row ATP sample, 115 rows are not a finished
2-or-3-set win and 21 carry NEITHER retired NOR walkover.

But a score-only rule of "winner reaches 2, loser below" cannot see that a
BEST-OF-FIVE stopped early. "7-6 6-4 RET" at a Slam reduces to "2 - 0", an
ordinary completed best-of-three. Measured over the 78,090-match TML archive,
that misread 1,391 of 2,362 retirements (58.9%) as complete - and the archive
half is exactly where no flag existed to fall back on, because career-backfill
parsed `ret` and never wrote it to the row. So:

  - the predicate now takes the FORMAT (Bo5 = Slam main draw) and requires the
    winner to reach the ladder's target;
  - career-backfill carries `retired` onto archive rows for the first time;
  - the shard writer ORs the two. The score catches the 21 unflagged rows; the
    flag catches what arithmetic cannot (a Bo3 retirement that still reached a
    legal 2-0). Both controls are in the suite, in both directions.

Also from the review: formSetsFromFixture turned a MISSING games number into 0
(`Number('')` is 0 and passes `Number.isFinite`), so a one-sided null shipped a
fabricated 6-0. Harmless while these sets only drew the Form tab; not harmless
now that a rate is computed from them. It returns null for the set instead - a
missing figure is a dash, never a zero.

Coverage is logged PER HALF. A blended percentage can read healthy while the
fixtures half stays where it was, since the archive half alone was already 99.5%.

NOT DONE HERE, deliberately - PROFILE_SCHEMA_VERSION is NOT bumped. It would be
the fast way to push these fields into the store, but measured: pass 2 has a
400-build cap and no wall-clock guard against pipeline.yml's 30-minute timeout,
and this file's own note records 400 builds taking 30.2 min - a killed job writes
nothing. Pass 2b is capped at 60/run, so convergence is ~6 runs, and a player not
reached is OMITTED while writePlayerShardsAndIndex unlinks profiles/ before
rewriting - a silent roster shrink, which is TEN-219's failure mode. The
reasoning is recorded at the constant. Without the bump the fields still arrive:
immediately for seed players, and for the rest as the 14-day TTL churns.

Full suite EXIT=0 in a CI-shaped clone; new suite 14/14 and wired into npm test.
