# Picks — store, roles, figures

Applies to `picks-*.js`, `picks-page.css`, `firestore.rules`, `tools/picks-updater.mjs`, `tools/firestore-rules.mjs`
and the "Bets today" tile. Design source: `design_handoff_picks/` (LOCK 2026-10-30; authority CHANGES_2026-10-30 >
SIDEBAR_NAV > CHANGES_2026-10-29 > SPEC > README; reference `Picks LOCKED 2026-10-30.dc.html`). Handoff and open items:
`picks-readonly-handoff.md` in the main checkout.

## Roles are real, never a preview switch (founder 2026-10-27)

- **Admin** = the founder's uid, the same allowlist as `isAdmin()` in `firestore.rules` and `isBspAdmin()` (admin-config.js).
  Only the admin posts. **Research and development (founder 2026-10-30):** the admin changes a pick's note and stake, voids
  it with a reason, or deletes it (pick + teaser together) at any time; no 10-minute window, no freeze. The note has no
  length cap. Server-written fields stay server-only.
  - **Test:** a two-day-old settled pick opens "Edit pick" with Save and "Delete pick…"; a 3,000-character note saves whole;
    Google's evaluator allows the admin's delete and late edit and refuses a Pro member's (`node tools/firestore-rules.mjs test`).
- **Photos (founder 2026-10-30):** every player circle on the cards shows his photo by player ID through `playerPhotoImg`
  over the monogram (`player-photos.md`); the analysis sheet shows the backed player's photo beside the bet line. A
  gated (non-Pro) card never carries a photo: under the blur it would name the pick. **Test:** `tools/test-picks-page.mjs`.
- **The admin posts ONLY from the Picks page** (founder 2026-10-30, override 1; replaces the 2026-10-28 "too"): the blue
  "+ Post a pick" button, last in the tabs row on both tabs, admin only by the store's role, opens the drawer on its match
  search. There is no "+ Pick" on Today's Matches cards or in the analysis modal header. **Test:** `tools/test-picks-page.mjs`
  "+ Post a pick" (a member sees no button) and "no "+ Pick" on match cards" (no `pkPlusHtml` / `.pk-plus` anywhere).
- **The admin bypasses Pro gating everywhere on the site** (founder 2026-10-28), by the same uid rule.
  - `mxIsPro()` covers the Bets today tile, the Stennisfy Model row blur and the tile click.
  - `sfPlanLocks` covers the rail lock on Trading Report and Stennisfy Model, on both pages. `account.html` loads `admin-config.js` for this.
  - **Test:** a free-plan admin is never blurred or locked; another free uid is. `test-ten286-layout.mjs` has 3 mutants for this; `test-step15-matches.mjs` covers the tile.
- **Pro** = `users/{uid}.plan === 'pro'`, written only by the Whop webhook.
  - A client can never write `plan`: `firestore.rules` refuses it, and `auth.js` no longer sends it.
- **Test:** no "view as" toggle exists anywhere. Viewing another role means signing in as that account.
  - `tools/test-picks-rules.mjs` checks the rules text with mutants.
  - `node tools/firestore-rules.mjs test` runs the role cases on Google's evaluator.

## Where picks live

- Firestore `picks/{id}`: the full pick.
  - Settled (won / lost / void): readable by any signed-in member.
  - Posted / live: Pro and admin only.
  - Draft: admin only.
- `picks_public/{id}`: the teaser (type, tournament, round, time, posted time, stake, state) for a non-Pro member's blurred card.
  - A real pick never reaches a non-Pro browser; the blur is drawn over placeholders.
- **No picks file is published.** `tools/fixtures/picks-demo.json` is the demo fixture, for tests and screenshots only.
- Rules ship through `.github/workflows/firestore-rules.yml` (`diff` / `test` / `deploy`).
  - **Test:** `deploy` runs `test` first and refuses on red.
  - It only runs on the founder's go-ahead: it changes access for every member.

## Who writes what

- **The browser (admin) writes only:** the pick, the stake, the note, the match identity, and the price the drawer read.
  - Match identity: api-tennis event key `match_id`, plus both player ids.
  - Price: bet105 live, or typed and tagged MANUAL with `price_source: 'manual'`.
  - The model % is copied from the board's snapshot at post time.
- **`tools/picks-updater.mjs` writes the rest** (pipeline step, Admin SDK, every run): Open (first sighting, once), Now (frozen at the start), status, result, the Pinnacle close, CLV, P/L, `frozen_at`.
  - Join on player ids or the event key, never on surnames.
  - **The match-winner close** is used only when both legs moved within 60 min of the start (TEN-253 ruling 2).
  - **Line markets have no close yet:** the line-summary start cut is unconfirmed (handoff), so their CLV is a dash.
  - **A push on a whole-number line** (handicap +2, Over 23) is **void** (founder 2026-10-28): P/L 0%, excluded from W–L and from the ROI denominator, like any void.
  - **A retirement after set 1 on a handicap / totals line** is **void**, unless the line was already decided before the retirement; then it settles on that result (founder 2026-10-28).
    - A total is decided once the games played pass the line.
    - A handicap is never decided while games remain.
    - A retirement before set 1 completes is void (Pinnacle rule, `settlement.js`).
  - **Not auto-settled, held and logged:** outrights; typed markets.
- **Test:** `tools/test-picks-updater.mjs` (28 checks, 11 mutants; one mutant each for the push and retirement rulings).

## Figures

- `picks-core.js` (SPEC §11): ROI = Σ P/L ÷ Σ stake over **won + lost** only (founder 2026-10-27). Season = **1 January to today**.
- **Test:** `tools/test-picks-core.mjs`.

## Page (LOCK 2026-10-30)

- **Upcoming** = one full-width band per posted / live bet, today on (`PicksCore.upcoming`), under "Open · N bets" (day
  heads when the bets span more than one day); the header carries Bets today · Match · Outright · Staked · If all land
  (`todayStats`). **Completed** = the history ledger, settled in the last 30 days, newest day first, ~10 rows a page in
  whole days; the header carries the Record strip (30 d · 90 d · Season; under 20 settled → dashes + "n=N · thin").
  Two tabs only: no date strip, tournament menu, search or day chips. Bands keep the store's posted order (the
  package says "the bets-box row order").
- **Any band or ledger row opens the analysis sheet** (settled picks get the result block, open picks the trail); Esc, ✕
  and the scrim close it. A gated (non-Pro) band is blurred, not clickable and opens nothing.
- **Mobile (≤ 640)**: one mobile card per bet, 16 px gutter.
- **Shared 1340 column**: `.pk-page` 1420 max with 40 px gutters; the tab page is `min-height:100vh` so an empty day keeps
  the page glow (override 3).
- **Typed / other markets are never a dash** (founder 2026-10-30, override 2): the market's own name is the type tag (caps,
  truncated to fit) and the bet line reads "{Surname} · {market}" — band, sheet, ledger, Bets today tile, drawer label —
  from the stored `market_text` (a stored record is never rewritten). A typed name that equals a chip name selects that
  chip. The drawer keeps the player clicked for a typed market (the Michelsen pick was stored on the Total games side).
  **Test:** `tools/test-picks-core.mjs` (3 mutants), `tools/test-picks-page.mjs` (drawer mutant).
- **The drawer's price and stake boxes are `autocomplete="off"`** (founder 2026-10-30: a Fils pick was posted at Jodar's
  price). **Test:** `tools/test-picks-page.mjs` (static + rendered, with a mutant).
- **Bets today tile**: each row is its own pick — a match winner reads the selected player's surname (the reference), every
  other market the bet line. **Test:** `test-step15-matches.mjs` (mutant: the tile reads player_a).
- **Picks count badge** (SIDEBAR_NAV, replaces the new-pick dot): the Live count chip on the Picks icon showing today's
  posted + live bets (Brussels day), hidden at 0 (`PicksShell.todayCount` / `setCount`, re-read on auth and every 5 min).
  **Test:** `tools/test-picks-page.mjs` "count badge".
- **Report, not resolved** (open with the founder): Picks times are Brussels while Matches uses the viewer's zone; the
  outright CLV benchmark; a ledger export; a drafts list; a Bets settled tile.

## Visuals

- Design wins on every visual (founder 2026-10-27): the controls row is the Picks reference's, not the landed Matches shell.
- Picks tokens are named in `tokens.css`: `--lost-card`, `--inner-band`, `--drawer-backdrop`, `--shadow-drawer`, `--pro-hover`, `--badge-fill`, `--badge-ink`, `--pk-band`, `--pk-pill`, `--pk-post-hover`,
  `--pk-sheet-backdrop`, `--pk-shadow-sheet`.
- **Test:** `tools/test-picks-page.mjs` (headless Chrome, `--hide-scrollbars`, plan pinned).
