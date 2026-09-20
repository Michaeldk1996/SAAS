# ⚠️ SUPERSEDED — do not build from this bundle

**The authoritative Database handoff is `.ten243-design/design_handoff_database/`**
(the ZIP the founder sent). This directory is kept as history only.

Marked 2026-09-20, TEN-242. The two bundles **contradict each other**, and the
contradiction shipped a real defect: the cumulative-profit curve was built on a
calendar x-axis and drew as a staircase.

| | `.ten243-design/design_handoff_database/CHARTS.md` (**authoritative**) | `design-export/database-handoff-4/CHARTS.md` (this one) |
|---|---|---|
| profit-curve x | **match index** — `x = (x0 + (1 − x0) · i/(n−1)) × 1000`, §"Geometry helpers" | §10 **"Retired — do not build"** retires the match-index panel *by its caption* |
| x axis | season labels, `SEASON` eyebrow | season ticks every two seasons, `SEASON` eyebrow |

Both describe a `SEASON` eyebrow, which is why the disagreement was easy to miss:
the visible label is the same, the **geometry underneath it is not**.

Reading this copy led to the TEN-243 `season-axis` ruling (2026-09-19), which the
founder overturned a day later once the two files were put side by side. The
live build is on the match index, captioned "Season · match index" because the
labels are seasons while the spacing is match count.

**Known further divergence in this bundle, already ruled on:** §8 asks for ONE
shared y-ladder `[10…2500]` across all five charts. That was built, shown to the
founder and REJECTED (gate `b6f04a43`, 2026-09-14) — it takes 699 of 1,129 player
panels to an axis whose only label is `0`. The live build keeps two ladders, per
README.md:273 and Database.dc.html:935. Do not "fix" it to §8.

If you are implementing anything from here, stop and read the ZIP instead.
