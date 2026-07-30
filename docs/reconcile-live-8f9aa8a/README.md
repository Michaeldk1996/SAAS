# Deploy reconciliation — live `main` @ `8f9aa8a`

All PNGs below are 1400px renders of the **deployed** `bsp-consult-dashboard.html`
(git blob `23fca59`, byte-identical to `origin/main:bsp-consult-dashboard.html`).
Auth gate is stubbed by the render harness; **no styling is altered**. Match data is
served from the local worktree, which is stale/empty for match lists — so the
Matches/Completed shots show the page **shell** correctly but not populated cards.

Correction on record: the prior status read the deployed tip as `6522d44`. The real
remote `main` tip is `8f9aa8a` — but the two commits past `6522d44` are both
`[skip ci]` chores (scores + admin log). The SPA is byte-identical, so the visual
state is unchanged. The mistake was reading a **stale local `origin/main` ref**
without fetching first.

| Shot | Page | Verdict |
|------|------|---------|
| `today-matches.png` | Today's Matches (Upcoming) | Shell redesign **deployed** (Stennisfy sidebar/header, segmented control, date rail, filter/search). Card internals not shown (empty local data). |
| `completed-matches.png` | Completed Matches | **Not styled.** H1 still "Today's Matches", Upcoming subtitle, green live dot, date strip offers Tomorrow/1 Aug, no summary strip. Commit `ca842f2` added only BUILD-NOTES + a harness script — **zero product-file changes**. |
| `players.png` | Players | Structural rebuild **deployed** (tournament groups, archetype+Elo cards, odds pills, search). But export **fidelity not delivered**: avatars still **initials** not photos, View-profile is the loudest element, cards tall/lifted, sidebar active ring. |
| `tournaments.png` | Tournaments | Real, **styled** page (Overview/Reports, court-speed panel, conditions read, trend chart). Some data feeds unwired (per-tournament ROI, favourite reliability). |

## Deploy-status of every named page

**Deployed & landed:** Today's Matches shell, Players (structure only), Tournaments,
News (`27172c1` + rulings `91c499c`), Profile (`7dcc700`), News/Styles/Profile/Model
batch (`2e70526`).

**Done but NOT deployed:**
- Account Settings rebuild `30c3af8` — on **local `main`, 3 commits ahead, never pushed**.
- Auth OTP email step `71cedc5` — on branch `ten8-redesign-matches`, **unmerged**.
- Playing Styles on-token colours `36de9b8` — **local, not in `origin/main`**.
- News derived-fields `f7dc054` — **not deployed**.

**Never done as product code:**
- Completed Matches — see above. `ca842f2` was documentation + a verify harness only.
