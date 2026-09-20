# Deliberate divergences from the design spec — do NOT revert these as regressions

Every entry here is a **ruled** departure from a spec document. Each names the
ruling, the spec section it departs from, and why. If you are about to "fix" one
of these back to the spec, read the reason first — in every case the spec's own
literal text produces a worse or untrue result on our real data.

Guards live in `test-ten242-rulings.mjs`; each has a mutation control proving it
goes red when the divergence is reverted.

---

## 1 · Speed panel: neutral columns, SURFACE-TINTED SELECTED ROW
**Departs from:** `design_handoff_tournaments/README.md` §1.3 — neutral chips, neutral bars, **and a neutral selected row**.
**Ruling:** founder, 2026-09-20, gate `33f71aab`.

The columns stay neutral. The **selected** row takes its surface token as a 0.13
wash plus the inset bar and the value: clay `#e8a84e`, hard `#4db8ff`,
grass `#2ab8a0`.

The original brief also said "selection stays accent blue — selection and
category would collide". That sentence assumed the **columns** would be tinted.
They are not, so selection is the only colour on the panel and cannot be read as
a category.

**The tint derives from the row's own `t.surface`, never from its column.**
`bucketOf` is `indoor ? 'Indoor' : …`, so an indoor **clay** event would sit in
the Indoor column; a column-derived tint would paint it blue. Measured
2026-09-20: Indoor is 12/12 hard today, so this is a guard against a future row,
not a live defect.

## 2 · Profit curves: MATCH INDEX x-axis
**Departs from:** `design-export/database-handoff-4/CHARTS.md` §10, which retires the match-index panel outright.
**Follows:** `.ten243-design/design_handoff_database/CHARTS.md` §"Geometry helpers" — `x = (x0 + (1 − x0) · i/(n−1)) × 1000`.
**Ruling:** founder, 2026-09-20 (Tour/Tournament) and 2026-09-20 closing (Player panels). Supersedes the TEN-243 `season-axis` ruling of 2026-09-19 and the TEN-196 round-3 scope call of 2026-09-13.

The two CHARTS.md files contradict each other; the ZIP bundle is authoritative
(see `design-export/*/SUPERSEDED.md`). On a calendar axis a one-week event owns
one week of the width: the Australian Open's 2,045 matches sit in seventeen
January fortnights and the curve drew as a staircase.

**Applies to every chart in the product.** `calendarTicks` has been deleted —
leaving a working implementation of the superseded semantics next to its
replacement is how a migrated component gets un-migrated.

## 3 · Axis caption reads "Season · match index", not "Season"
**Departs from:** the ZIP's §"X axis", which specifies the bare eyebrow `SEASON`.
**Ruling:** founder, 2026-09-20 closing — *"Keep the caption."*

The tick labels are seasons; the **spacing** is match count. A busy season takes
more width than a quiet one. Captioning that "Season" alone invites reading
durations off an axis that does not carry them. Both profit surfaces carry it —
the Tour/Tournament curve and the Player main panel.

## 4 · Season labels placed from the REAL rows
**Departs from:** the ZIP's year-window formula `a = round((y0 − 2010) / 16 × (n − 1))`.

That formula assumes a **linear year→index map**. True of the prototype's
synthetic uniform data; false of ours, where matches cluster in tournament
weeks. Using it would put every season label in the wrong place. `seasonIndexTicks`
walks the real rows and puts each label at the index where that season's first
match actually sits.

## 5 · Retirements are VOIDED, not settled
**Departs from:** nothing in the design spec — this is a data-basis ruling.
**Ruling:** founder, 2026-09-20, gate `33f71aab`.

A book voids the match market when a player retires, so settling those rows
priced a bet the reader could never have had. 1,837 archive rows (1,278 in
window, 3.07% of the store) now sit in their own `retired` exclusion bucket and
the footnote names them.

**Note the direction, because the intuition runs the other way:** the favourite
was credited the win in only 58.8% of retirements against 69.5% overall, so
retirements were disproportionately **underdog** results. Voiding them moved
roiFav **+0.40pp** and roiDog **−1.50pp** — it does not stop flattering
favourites, it stops flattering underdogs.

## 6 · ROI cards are computed from `database-yield.json`, not the CSVs
**Ruling:** founder, 2026-09-20 (`align_window`), implemented beyond the letter of it.

The card and the Database panel it links to disagreed in sign on Hamburg
(−10.5% vs +0.71%). Aligning the **window** alone closed only 2.4pp of an 11.2pp
gap; the other 8.8pp was the price basis. Rather than duplicate the panel's four
exclusion rules into the card builder — two copies drifting IS that defect — the
cards read the panel's own rows. They now agree by construction.

## 7 · Hero knob is rescaled to the real venue span
**Departs from:** `design_handoff_tournaments/README.md` — `(speed − 0.50) × 100%`.
**Ruling:** founder, 2026-09-19.

Bounds derived from the venue set at build time with an 8% pad; nothing about
today's 0.41–1.42 is written down. A degenerate span centres the knob rather
than dividing by zero.

## 8 · Two y-ladders, not the one `CHARTS.md` §8 asks for
**Ruling:** founder TEN-196, gate `b6f04a43`, 2026-09-14 — built, shown, REJECTED.

§8's single `[10…2500]` ladder takes 699 of 1,129 player panels to an axis whose
only label is `0`. README.md:273 and Database.dc.html:935 specify the ladder in
use. Do not conform this to §8.
