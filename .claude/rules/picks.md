# Picks — store, roles, figures

Applies to `picks-*.js`, `picks-page.css`, `firestore.rules`, `tools/picks-updater.mjs`, `tools/firestore-rules.mjs`
and the "Bets today" tile. Design source: `design-export/picks-handoff/` (LOCKED 2026-10-27). Handoff and open items:
`picks-readonly-handoff.md` in the main checkout.

## Roles are real, never a preview switch (founder 2026-10-27)

- **Admin** = the founder's uid, the same allowlist as `isAdmin()` in `firestore.rules` and `isBspAdmin()` (admin-config.js).
  Only the admin posts, edits within 10 minutes (note and stake only), voids with a reason.
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

## Visuals

- Design wins on every visual (founder 2026-10-27): the controls row is the Picks reference's, not the landed Matches shell.
- Picks tokens are named in `tokens.css`: `--lost-card`, `--inner-band`, `--drawer-backdrop`, `--shadow-drawer`, `--pro-hover`, `--badge-fill`, `--badge-ink`.
- **Test:** `tools/test-picks-page.mjs` (headless Chrome, `--hide-scrollbars`, plan pinned).
