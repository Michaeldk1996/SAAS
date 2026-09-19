# Founder rulings that the export does not state

The export specifies markup, colour and geometry. It does not specify every
behaviour the page needs. Where the founder has ruled on one, it is written here
verbatim with its key, so a later pixel pass does not "correct" it back to
whatever the export happened to imply.

A ruling here **outranks the export**. Each entry names the deviation and why.

---

## §5.3 · Record per tournament — LIST ORDER

**Ruled 2026-09-19.**

> "162 positions moving with a 22-place jump is a member opening a page they know
> and finding it rearranged. career-backfill sorts on won + lost and the renderer
> never re-sorts, so nobody chose that order deliberately. Pin it to a stable,
> stated key and write the key into the spec."

### THE PINNED KEY

```
matches played DESC  ->  last played DESC  ->  display name ASC
```

Implemented as `tournOrder()` in `player-profile-v2.js`, applied by `tournViews()`
so every caller (the modal list, the box-3 headline, `bestEvent()`) shares one
order. Locked by `tools/test-tourn-order.js`.

### One correction to the ruling's premise

The renderer **did** re-sort — `tournViews` ended in `.sort((a,b) => b.n - a.n)`.
The defect was subtler than "no sort": `Array.sort` is stable, so every tie fell
through to the order `career-backfill.js` emitted, and that builder sorts on
`won + lost` tie-broken by merge sequence.

That matters because the tie is not an edge case. Measured on the deployed store:

| | |
|---|---|
| tournament rows | 13,012 |
| **rows sitting in a tie on match count** | **11,664 — 89.6%** |
| longest tie run | 36 |

So roughly nine rows in ten were ordered by upstream merge order. Nobody chose
it, and any unrelated builder change could reshuffle it. The two trailing terms
make the order **total** — the display name is unique per row — so the store's
emission order can no longer reach the page at all. That is the property the
test asserts, by shuffling the store and requiring a byte-identical render.

### What the pin does NOT do, stated rather than hidden

It does not make the order immune to a record correction. A row that loses a
match still crosses its count band. Replaying the WD fix under each candidate
key, counting rows that change position:

| key | rows moved | largest shift |
|---|---:|---:|
| matches desc + insertion order (what shipped) | 176 | 7 |
| **matches desc, last played, name** (this key) | 426 | 28 |
| last played desc, matches desc, name | 141 | 7 |
| last played desc, name asc | **0** | **0** |
| name asc | **0** | **0** |

Only a key that never reads the record is immune — and both immune keys collapse
to near-alphabetical. On today's data `last played desc, name asc` opens Sinner's
list with **Doha 2–1 above Wimbledon 27–4**, and Zverev's on Acapulco.

That is a worse page every day of the year in exchange for avoiding a reshuffle
that only happens when we correct the data. The count stays primary; the cost is
written down here instead of being discovered later.

---

## §5.9 · Ratings tiles — ACE AND DOUBLE FAULT ARE COUNTS, NOT RATES

**Ruled 2026-09-19. This is a deliberate deviation from the export.**

> "Relabel as what the store actually holds: per-match counts, not rates. 'Aces
> per match' and 'Double faults per match'. No % sign anywhere. Do not synthesise
> a service-point denominator to make the export's label true — claim less, the
> plain label over the enhanced one."

The export's own tile labels are `Ace rate` and `Double fault rate`, both carrying
a `%` (`Player Stat Boxes.dc.html`, the `serve` metric list). **We deviate.**

**Reason.** `dna-apitennis-ratings.json` holds `acesPerMatch` and `dfPerMatch` —
aces divided by matches. There is no service-point denominator anywhere in the
store, so the export's label cannot be made true without inventing one. Printing
a per-match count under a `%` sign would be a fabricated unit, which §3 forbids
outright.

So the tiles read **"Aces per match"** and **"Double faults per match"**, with no
`%` on the value, the delta, or the tour figure.

---

## §5.9 · Ratings tiles — WHAT "TOUR" MEANS

**Ruled 2026-09-19.**

> "Compute it over the … rated players and SAY SO on the page, in the footnote, in
> plain words: the average of the N players we rate, not the ATP field. State the
> real N at render time, not … hardcoded — it moves as the DNA store grows.
> Anywhere 'tour' appears as a column header with no room for the caveat, the
> footnote carries it."

The tour figure on every Ratings tile and on the radar's tour polygon is the mean
over the players carrying a row in `dna-apitennis-ratings.json` for that scope —
**not** the ATP field. `N` is counted at render time from the store, never
hardcoded, because the store grows.

The `TOUR` column header has no room for the caveat, so the footnote carries it.
