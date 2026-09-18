# Quantities DERIVED FROM EXPORT LITERALS — not ruled, not specified

Founder ruling 2026-09-18 (item 2): *"6 of 6 reproducing is evidence, not a spec.
Record it in the locked spec as DERIVED FROM EXPORT LITERALS, not as a ruled
formula, with the reproductions as the evidence."*

Anything in this file is a reading of the export's hard-coded numbers, arrived at
by arithmetic on those numbers. **None of it is a founder ruling and none of it is
written down anywhere in the export.** Treat every entry as provisional: if the
founder later defines the quantity, the definition wins outright and the entry
here is deleted, not reconciled.

---

## §5.8 Derived lines — the "AVG MARGIN" column

**Status: DERIVED FROM EXPORT LITERALS. No formula exists in the export.**

`lineCoverage()` in `Player Stat Boxes.dc.html` (:1398-1493) ships a hard-coded
`D` literal. The column head reads `Avg margin`; nothing states what is being
averaged, over which matches, or in what unit.

### What the literals contain

| | count |
|---|---|
| row literals | **28** (12 split, 16 non-split) |
| **margin literals** | **52** — the 12 split rows carry 3 each (total, as favourite, as underdog); the 16 non-split rows carry 1 each |

All 52 were read; the 12 split rows are the only ones that can be cross-checked
against each other, because only they carry sub-values.

### Evidence 1 — the count-weighting (discriminating, 11 of 12 rows)

On every split row the printed total reproduces as the **hit-count-weighted mean**
of its favourite and underdog figures:

```
fmt  label        hitF hitD  mFav  mDog  printed  hit-weighted  plain (mF+mD)/2  differ@1dp
bo3  −4.5 games     31    8   7.9   5.6      7.4         7.428            6.750     YES
bo3  −2.5 games     44   13   6.2   4.4      5.8         5.789            5.300     YES
bo3  +2.5 games     69   45   4.0   1.7      3.1         3.092            2.850     YES
bo3  +4.5 games     77   54   3.1   0.9      2.2         2.193            2.000     YES
bo3  −1.5 sets      39   15   7.2   6.1      6.9         6.894            6.650     YES
bo3  +1.5 sets      68   47   3.3   1.6      2.6         2.605            2.450     YES
bo5  −6.5 games      3    5  10.4   9.4      9.8         9.775            9.900     YES
bo5  −3.5 games      4    8   7.6   6.8      7.1         7.067            7.200     YES
bo5  +3.5 games      7   19   3.6   2.0      2.4         2.431            2.800     YES
bo5  +6.5 games      8   22   2.5   0.7      1.2         1.180            1.600     YES
bo5  −2.5 sets       3    3  10.1   8.3      9.2         9.200            9.200     no
bo5  +2.5 sets       8   21   2.9   1.4      1.8         1.814            2.150     YES
```

**12 of 12 reproduce** under hit-count weighting. The unweighted mean of the two
sub-values differs at the printed 1 dp on **11 of 12** and matches the printed
total on none of those 11 — so the weighting is *discriminated by the data*, not
assumed. The one non-discriminating row (`bo5 −2.5 sets`) has equal sub-counts
(3 and 3), where the two candidates are algebraically the same number.

### Evidence 2 — the metric (weak; sign and magnitude only)

The weighting identity above says nothing about **what** is being averaged. It is
an algebraic identity that holds for the count-weighted mean of *any* per-match
quantity partitioned into two subsets — mean total games, mean set margin, mean
anything-per-match. It confirms the population (total row = favourite ∪ underdog)
and the per-match-mean structure, and stops there.

What points at *games margin* specifically is only the sign and magnitude of the
16 non-split literals:

- Match shape, bo3: `2–0 +6.9` · `2–1 +1.8` · `1–2 −1.9` · `0–2 −6.4` — monotone and near-symmetric about zero.
- Match shape, bo5: `3–0 +12.1` · `3–1 +7.3` · `3–2 +2.2` · `2–3 −2.6` · `1–3 −7.8` · `0–3 −11.4` — same shape, wider spread, as a longer format implies.
- Games handicap, bo3: `−4.5 → 7.4` · `−2.5 → 5.8` · `+2.5 → 3.1` · `+4.5 → 2.2` — falls monotonically as the line loosens, which is what a mean over *hitting* matches does when a looser line admits closer matches.
- Total games: all four values sit within ±2.3 of zero, as a margin averaged over a mixed set should.

**This is circumstantial.** It is consistent with a games margin and inconsistent
with an obviously different metric, but it is not proof, and no combination of the
52 literals can make it proof.

### What we implemented

`lineCoverage()` in `player-profile-v2.js`: the mean of `(games for − games against)`
across the matches that **hit** that line — not across the row's denominator. The
weighted identity above is then automatic rather than imposed.

### The honest limit

The founder asked whether a plain mean over the hit subset is distinguishable from
the hit-weighted mean. **For the two candidates the export can discriminate**
(weighted vs unweighted mean of the two sub-values) the answer is yes, on 11 of 12
rows. **For the reading where "plain mean over the hit subset" means the mean over
the individual hitting matches**, it is *identical by construction* to the
count-weighted mean of the two subgroup means — there is no measurement that could
separate them, because they are the same computation.

So: the weighting is confirmed. **The metric is not.** If `Avg margin` is ever
meant to be something other than games margin, nothing in the export contradicts
that, and this entry should be replaced by a ruling rather than argued with.
