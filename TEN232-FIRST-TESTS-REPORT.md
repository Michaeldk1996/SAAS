# TEN-232 — Kibl first tests (a–d), and what is now archiving

Commit `6745cbee`. All figures measured against the live API on 2026-09-17,
credentials read from Actions secrets, never printed. Report only — nothing is
on the site and nothing is published.

---

## Three things that change the premise

**1. The book we are being served is `Sports411`, not Bet105.**

`/reference/sportsbooks` returns exactly one row, and that list *is* the
entitlement — it is the only book any market call is allowed to ask for:

| feed_source_id | name | tag | feed_type_id | metadata |
|---|---|---|---|---|
| 43 | Sports411 | sports411 | 2 | `{"tier": "primary", "offered": true}` |

No book named Bet105 exists anywhere in our view of the API. Every number below
is therefore a measurement of **Sports411**, not of Bet105 — unless Sports411 *is*
Bet105's pricing feed under another name, which only Bet105 can tell us. I have
not assumed either way. **This is the first thing to put to them**, because the
affiliate premise is that we display *their* price.

**2. The state model is two states, not three — and the documented trap is not
the real one.** This one would have silently produced an archive with no opening
prices in it. Detail in section (d).

**3. `/info/markets` requires `feed_source_id`, undocumented, and fails open.**
Without it the API returns **HTTP 200**, no `result` key, and the text
`"minimum of 1 feed_source_id needed"` — for every league, every sport and every
time window. The swagger marks the parameter optional. My first run believed the
swagger and measured *zero market coverage across the entire account*. That was
wrong, and it is exactly the shape of a number worth distrusting: a clean zero
with a 200 behind it.

---

## a. What this account is actually entitled to

Entitlement is **not** in the Cognito token — no custom attributes at all. It is
expressed only as the contents of the reference tables and as row counts.

**Leagues.** All six tennis leagues are visible and return fixtures (window
−3d/+7d):

| league_id | league | fixtures | priced by Sports411? | in archive scope |
|---|---|---|---|---|
| 19 | ATP | 3 | yes | yes |
| 537 | Challenger | 149 | yes | yes |
| 962 | ITF Men | 272 | **no — 0 rows** | yes (capturing nothing) |
| 20 | WTA | 75 | yes | no (your ruling) |
| 643 | WTA 125K | 93 | yes | no (your ruling) |
| 963 | ITF Women | 217 | not in freshness table | no (your ruling) |

Two things worth your attention here. **ITF Men is in our archive scope and is
not priced at all** — 272 fixtures, zero market rows, and it is absent from
Kibl's own freshness endpoint. **WTA and WTA-125K *are* priced**, so the leagues
you excluded are live and the ones you included are two-thirds live. You asked
to be told if entitlement covered the women's leagues: it does, and they are
being actively priced. They remain out of the archive per your ruling.

**ATP shows only 3 fixtures in a 10-day window** against 149 Challenger and 272
ITF Men. I am flagging that as implausible rather than explaining it — there are
only 6 tennis leagues in the whole reference table, so ATP main draw is not
hiding under another league id. Either this feed's ATP coverage is thin or the
fixture list is partial. Not yet diagnosed.

**Betting types — no live.** Prematch (1) returns rows; both live types return
nothing, and Kibl's own freshness endpoint lists `betting_type_id=1` only:

| betting_type_id | market rows |
|---|---|
| 1 Prematch | 180 |
| 2 Live Stop-N-Go | 0 |
| 3 Live Fluid | 0 |

So the entitlement for live that you asked Bet105 for has **not** landed. Worth
noting the trap survives for when it does: for tennis, live is `3` (Live Fluid),
not `2` as the spec's parameter doc says.

**`is_main` — no alternates.** `true`, `false` and omitted all return the same
108 rows, and `alt_id` is `0` on every single one. You ruled is_main unrestricted
so we would capture main + alternates; there are no alternates to capture from
this book. The archive still omits the filter, so the day they appear we get them.

**Markets — no set handicap, no total sets.** Only three market/segment
combinations exist across every fixture:

- Moneyline / Full Game
- Spread / Full Game (games handicap)
- Total / Full Game (total games)

The `Sets` segment **does** exist in Kibl's reference taxonomy (segment_id 54,
plus First–Fifth Set) — it is *our book* that returns zero rows on it, which is
the sharper way to put the question to Bet105. Your specific question was whether
Bet105 prices the set handicap that bet365-on-Oddspapi does not: **for this book,
no.** Nor total sets, nor set betting.

---

## b. Backward reach — about 30 days, and it is worth having

`start_time`/`end_time` **do** reach backwards to finished fixtures:

| days back | fixtures | market rows | fixtures priced |
|---|---|---|---|
| 1 | 133 | 132 | 22 |
| 2 | 117 | 342 | 59 |
| 3 | 62 | 270 | 57 |
| 5 | 50 | 96 | 16 |
| 7 | 147 | 170 | 29 |
| 14 | 175 | 258 | 43 |
| 30 | 162 | 356 | 64 |
| 60 | 95 | **0** | 0 |
| 90 | 81 | **0** | 0 |
| 180 | 30 | **0** | 0 |
| 365 | 49 | **0** | 0 |

Fixtures survive a year; **prices survive at least 30 days**. The cutoff is
somewhere in (30, 60] — I did not bisect it, so "at least 30", not "about 30".

⚠️ **Correction.** An earlier version of this report said the backward windows
return only the final price with no openers. **That was never measured** — the
backward-reach test ran before the state model was corrected, so it pulled on the
`is_current` axis (which does nothing) and `is_opener` was never sent for a single
historical window. Status: **unknown**. The backfill now running does send it, so
the answer will come from its captured state mix rather than from an assumption.

What can be said: `distinct inserted_on` equals the row count exactly (356 stamps
for 356 rows), which is what you would see if each line has one surviving row
rather than a tick series.

That window slides forward every day, so I have started a backfill over it — it
is the one piece of history here that is recoverable at all, and only this week.

---

## c. Coverage, Sports411, pre-match, men's leagues

Window +3 days, `betting_type_id=1`, `feed_source_id=43`:

| league | fixtures (n) | priced | % priced | market rows | lines/fixture | both sides % |
|---|---|---|---|---|---|---|
| ATP (19) | 3 | 2 | 66.7% | 4 | 1.0 | 100.0% |
| Challenger (537) | 23 | 18 | 78.3% | 104 | 3.8 | 50.7% |
| ITF Men (962) | 37 | 0 | 0.0% | 0 | — | — |

n is small for ATP — 3 fixtures is below any threshold worth trusting, flagged
rather than dressed up. Worse, the three "ATP" fixture names are Challenger-level
pairings, so the denominator itself looks wrong: I would put **no** percentage on
ATP yet. Challenger is the real coverage story: 78.3% of fixtures
priced, ~3.8 lines each (moneyline + games handicap + total games).

"Both sides quoted" at 50.7% on Challenger is not a coverage gap — it is the
opener/current split: a line whose price has moved returns one row per state, and
only unmoved lines return a clean pair. Read it with section (d), not as missing
prices.

---

## d. The `is_current` trap — the documented one is not the real one

You asked me to confirm the `is_current` default trap was handled. It is, but not
in the way the documentation implies, and this is the finding I would most want a
second pair of eyes on.

Counts alone say the filters do nothing — every variant returns 108 rows:

| call | rows | states returned |
|---|---|---|
| unfiltered | 108 | `{current: 78, opener: 30}` |
| `is_current=true` | 108 | `{current: 78, opener: 30}` |
| `is_current=false` | 108 | `{current: 78, opener: 30}` |
| `is_opener=true` | 108 | `{opener: 108}` |
| `is_opener=false` | 108 | `{opener: 108}` |

Identical counts under contradictory filters. Counting cannot distinguish "the
filter is ignored" from "the filter works and the counts coincide", so I compared
the row **sets** by identity instead:

- `is_opener=true` vs unfiltered: **78 of 108 rows differ** (jaccard 0.16). The
  filter is real — it returns the opening price for each line. The 30 shared rows
  are lines whose current price still equals the opener, i.e. lines that have not
  moved.
- `is_current=true` vs `is_current=false`: **identical sets, jaccard 1.0**. The
  parameter does nothing whatsoever.
- `is_previous`: **never appears on a single row**, in any pull.

So: **two retrievable states (opening and current), not three**, and the axis is
`is_opener`, not `is_current`. `is_opener=false` returns openers too — only the
parameter's *presence* matters, not its value.

**This found a real bug in my own code before it wrote anything.** I had built
the archive's read exactly as the docs describe — merge `is_current=true` with
`is_current=false`. That pulls the *same rows twice* and never retrieves a single
opening price. It would have produced a full-looking archive, correct row counts,
plausible sizes, and no openers in it at all. Now fixed to pull unfiltered +
`is_opener`, and locked with an offline test that fails if `is_current` is ever
sent again.

---

## What is now running

The Part 1 archive is live and has taken its first sweeps.

- Private Supabase bucket `kibl-raw` created (verified private), raw gzipped
  payload per sweep.
- `kibl_line_observations` + `kibl_sweeps` in Postgres, **RLS on, zero policies**,
  verified by query rather than asserted.
- First sweep: **258 market rows across 26 priced fixtures**, 23.5 KB gzipped
  (ATP 8 rows / Challenger 250 / ITF Men 0).
- Scope as ruled: men's leagues, pre-match, `is_main` unfiltered.
- Append-only, first-write-wins — a held observation is never overwritten,
  because the held one is the one that cannot be re-fetched.
- Schedule: every 30 minutes. Offline tests gate every run.

**Cadence.** I am not yet able to justify a number: it needs consecutive sweeps
to measure how often a price actually changes. The job reports `rows_new` per
sweep and I will bring you the observed change rate with an n. Starting
conservative at 30 min because Kibl documents **no rate limit, quota or 429
anywhere** in 71 endpoints, and across 70 calls I saw **no rate-limit header, no
429 and no Retry-After** — no evidence of a ceiling in either direction, which is
a reason for caution, not confidence.

---

## What I need from you / from Bet105

1. **Is Sports411 their feed?** Everything else depends on this. If it is not, we
   are archiving a book we have no affiliate relationship with and the display
   question is moot.
2. **Live entitlement has not landed** — both live betting types return zero. If
   they are granting it, for tennis it is `betting_type_id=3`, not `2`.
3. **ITF Men is not priced at all.** Is that expected, or a gap they can fill?
4. **No set handicap and no alternates** from this book. That answers the
   line-coverage question in the negative — worth confirming it is not an
   entitlement restriction on our account rather than a genuine absence.
5. **Retention**: prices vanish between 30 and 60 days back. Their own statement
   would let me stop measuring it.

No decisions taken and none needed from me. Oddspapi remains primary throughout;
nothing here touches it, the model, the pipeline, or the site.
