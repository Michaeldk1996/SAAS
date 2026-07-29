# Today's Matches — build notes (TEN-8 redesign port)

Scoped entirely to `[data-page="matches"]` in `bsp-consult-dashboard.html`. Values taken
from the Stennisfy export (zip 32, `export/matches-upcoming.html`) — decoded from its
Framer scene-stack so the markup/tokens are the export's real ones, not icon-library or
eyeballed substitutes.

## Card-review round (founder comment 2026-07-29 04:12Z) — what changed

1. **Market Signal — expands in place.** The chip no longer navigates to the Edge page
   (`openEdgeModelAt`); it toggles a `.sig-open` class on its own card (`toggleSig`).
   The panel shows a centred `Player A vs Player B` header (A `#6aaeff`, "vs" muted,
   B `#e7e9ee`), a SHARP ESTIMATES group and a MARKET MONEY group with LIQUIDITY
   right-aligned on the group label line. Chevron flips (▾→▲) while open.
2. **Recent-form bars fill.** The fill was an inline `<span>` with no `display:block`,
   so it ignored its width and never painted. Fixed; the bar now fills proportionally in
   brand blue (`#2f6bd8→#5b9bff` gradient) at every level — never pos/warn/neg, which the
   design system reserves for data quality — and the value carries a `%`.
3. **Sidebar icons** are the export's exact six path strings (viewBox `0 0 20 20`):
   Matches = list rules, Players = person, Tournaments = trophy, Stennisfy Model = star,
   Playing Styles = bar chart, News = newspaper.
4. **Positioning.** Sidebar `250px` (was 280); content column left-aligned beside it,
   `padding:30px 40px 70px`, `max-width:1360px` — from the export's `<main>`.
5. **Date rail.** Tight inline cluster at the left, chevrons immediately adjacent; the
   full-width hairline under the rail is gone — only the ACTIVE day is underlined.
6. **Pro card.** Icon tile · "3 Bets Today" heading + subtext (left), PRO badge + CTA
   right-aligned — not a large standalone numeral.
7. **Nits.** Date/time separated by a space (`2026-07-29 01:00`), surface and tournament
   by spacing only (no middot), sort control shows the up-down glyph `⇅`.

## Market Money — three venues in the export, two shipped (per founder amendment)

The export's MARKET MONEY group renders **three** venues — Betfair Exchange, Polymarket,
Kalshi. This build ships **two: Polymarket and Kalshi only**. Betfair Exchange is dropped
because we can't link it, so it must not render. Both shipped venues are prediction-market
venues with real, sourceable liquidity. This is a decision, not a missing row.

## Data binding — what is live vs pending on this card

The card renders from `matches.json`. Only some Market Signal values are bound there:

- **Sharp / Pinnacle split — LIVE.** De-vigged from the card's bound odds: `m.odds` is a
  single-bookmaker two-way snapshot; the two implied probabilities are normalised to sum
  to 100. The row is labelled by the actual bookmaker that priced it.
- **Stennisfy model % — PENDING.** The model output is produced in CI and served
  separately; it is not carried on `matches.json`, so the row renders `—`.
- **Polymarket / Kalshi % + liquidity — PENDING.** The prediction-market feed / shards
  aren't on this card's data source yet, so both venue rows render `—` (including the
  LIQUIDITY column).

Pending values render as `—` with an explicit on-card note, never invented — per the
founder's instruction to say which values are missing rather than fabricate or fall back
to navigation.

## Verify

Rendered headless (Chrome `--headless=new`, 1400px) against the local today-dated slate
(37 real matches, both card states). Screenshots: `ten8-review2-default.png`,
`ten8-review2-sigopen.png` (in `~/.bsp-splits-cron/`). Preview served at
`http://localhost:8850/ten8-matches-preview.html` (auth gate neutralised in the preview
copy only; the committed file keeps the real gate).

## Verification pass (founder "finish Today's Matches" comment, 2026-07-29 05:09Z)

Ran the side-by-side the founder said was missing — a live-DOM probe + 1400px full-page
render taken FROM commit `8f48e86`, not from a preview I had lying around. Harness:
`render-matches.mjs` (Node 24 global WebSocket + spawned headless Chrome via CDP, zero
installs). It rebuilds the preview from `git show 8f48e86:bsp-consult-dashboard.html`,
injects a BSP auth stub matching the REAL publicUser shape `{uid,name,email,emailVerified}`,
serves the worktree, sets a 1400px CDP viewport, waits for `.match-card`, probes the DOM,
then screenshots full-page + the Market-Signal-expanded card.

Result — every outstanding Item-1 point is already satisfied at `8f48e86`:
- Stennisfy Model icon = line-chart glyph (paths `M4 4v12h12` + `M6.5 12.5l3-3.5 2.5 2 4-5.5`). Not an arrow/star.
- Playing Styles icon = bar-chart glyph (`M4 15V9M8 15V5M12 15v-4M16 15V7`). Not a target.
- Market Signal chip `onclick="toggleSig(this)"` — expands in place (`.sig-open`), never navigates.
- Expanded panel: SHARP ESTIMATES (Pinnacle 56/44 LIVE, Stennisfy —), MARKET MONEY
  (Polymarket, Kalshi — **Betfair absent**), LIQUIDITY right-aligned on the group label row.
- Sidebar foot: one bordered `.sf-userchip` (avatar · name · "Free plan" · chevron) + outlined
  "Upgrade to Pro". No bare Sign-out. `footHTMLhasSignOut=false`.
- Header: green dot `#3dd68c` + "Live · updated " (space present) + clock.
- Date rail: chevrons in bordered squares, right chevron immediately after the last day.

**Why the founder saw it as broken:** he was judging a STALE render, not `8f48e86`. This is
exactly the "reported matches without running the side-by-side" failure he flagged. Fixed the
process, not the code.

**One trap caught:** first render showed the account label as "preview" — that was MY stub
using `displayName` where the real `publicUser` (auth.js:132-134) exposes `name`. Corrected
the stub; label then renders "Alex Morgan". `paintAcct` (`u.name || email-localpart`) was
never wrong. Had I "fixed" it to read `displayName`, I'd have diverged from the real object.

**Known non-blocking gap (data, not composition):** Stennisfy model %, Polymarket & Kalshi
flow/liquidity aren't wired to this card's source yet — rendered as "—", never invented, with
an on-card footnote saying so. Pinnacle split is live. This is the documented data-layer gap,
not a design miss; founder said "data layer untouched" this pass.

Evidence artefacts (in agent workspace):
- `ten8-matches-1400-8f48e86.png` — full page, 1400×4084, from commit 8f48e86
- `ten8-matches-1400-8f48e86-sigopen.png` — Market Signal expanded card

## README-vs-comment disagreements logged (founder rule: README wins unless a direct order says otherwise)

- **Header status-line grey.** README "Today's Matches — Upcoming" says the "Live · updated"
  text + clock are `--muted-2` (#4b5672). Founder's 05:09Z comment explicitly said #5b6880
  (`--muted`). Current build follows the **comment** (#5b6880) — a direct, specific order
  outranks the general README-wins default. Flagged for founder to confirm; one-line revert
  if he wants README (#4b5672).
- **Live dot.** README wants a 7px `--pos` dot with a `rgba(61,214,140,0.18)` ring; current
  build uses a `--pos` dot with an 8px box-shadow glow. Founder's comment only specified the
  colour (#3dd68c). Minor; will switch to the README ring on the next Item-1 touch.

## NEXT — Item 2 (Login + OTP/Verify) build spec, from README "Login / Sign up" (authoritative)

Port the export's Login design onto the real `auth.html` (keeps Firebase OTP logic). Two-column.
- **Primary auth button** "Continue with email" = the ONE solid `--brand-deep` (#2f6bd8) fill in
  the product. Verify button on the code step shares it. Nothing else solid anywhere.
- **Secondary** ("Use phone instead", 2 OAuth tiles, 2 store badges): `rgba(255,255,255,0.04)`
  fill on `rgba(255,255,255,0.15)` border, radius 8px, label `--text` 600. Never brand-blue border.
- **Fields**: rest `rgba(255,255,255,0.04)` on `rgba(91,155,255,0.22)`; focus border →
  `rgba(91,155,255,0.35)`, nothing else (no glow/shadow/lift). Error: `--neg` border + message
  below in Hanken 13px `--neg`, clears on next keystroke, never on blur. Same treatment on the
  six code boxes.
- **Button states**: loading = disabled, label "Sending code…", fill 60% opacity. Disabled =
  fill 40% opacity. NO spinner exists in the product — opacity alone marks unavailability.
- **Left column**: brand mark alone at top; App Store + Google Play badges at the very foot,
  below the legal line, left-aligned side by side. No competing CTA above the primary.
- **Right preview panel**: reuses Matches components (match card, Market Signal, Line Movement)
  as ordinary `--card`/`--border-subtle` r12 blocks — DO NOT redefine them. "Visualize the edge"
  is the only non-identity blue on the panel; odds/book names/prices never blue.
- Reference: `design-export/login.html` + founder screenshots 13.08.09/.11/.12. Verify with the
  same 1400px render harness; produce the per-page evidence pack before calling it done.

## Item 2 (Login + OTP/Verify) — BUILT (auth.html fully replaced)

`auth.html` markup/styles rebuilt as the Stennisfy two-column design; `auth.js` (Firebase
email+password backend) is UNTOUCHED. Values from README tokens (authoritative) + the three
founder reference screenshots (composition). Rendered at a 1400px CDP viewport via a new
zero-install harness `scripts/render-auth.mjs` (Node 24 global WebSocket + spawned
`--headless=new` Chrome, static server rooted at the worktree, explicit
`Emulation.setDeviceMetricsOverride` width 1400 — never `--window-size`).

**Three steps, one left column + one static right preview panel:**
- `email`  — brand mark, "Log in or sign up", email field, the ONE solid `--brand-deep`
  (#2f6bd8) "Continue with email →" button (disabled=40% opacity + muted label; loading=60%
  + "Sending code…"; NO spinner), "or" divider, "Use phone instead", Google/Apple OAuth tiles
  (all secondary: `rgba(255,255,255,0.04)` fill on `rgba(255,255,255,0.15)` border), legal
  line, App Store + Google Play badges at the foot.
- `code`   — mail glyph, "Check your inbox", six mono code boxes (auto-advance / backspace /
  arrow-nav / paste-fills-all-six), "Verify" (shares the same solid fill), Resend, "‹ Use a
  different email".
- `password` — the REAL working Firebase sign-in / sign-up fallback (secondary affordance
  "Use a password instead" on the email step; also reached from the Verify note). Wires
  `BSP.signIn` / `BSP.signUp` / `BSP.sendPasswordReset` exactly as the old page did.

Fields: rest `rgba(255,255,255,0.04)` fill on `rgba(91,155,255,0.22)` border, radius 8px;
focus → border `rgba(91,155,255,0.35)` and NOTHING else; error → `--neg` border, cleared on
next keystroke. Right panel reuses Matches components as `--border-subtle` r12 blocks (match
card A=#6aaeff / B=#e7e9ee, Market Signal 74% bar, Line Movement); "Visualize the edge" is the
only non-identity blue on the panel; all odds/books/prices are IBM Plex Mono, never blue.

### OTP-BACKEND DECISION (also in an `<!-- OTP-BACKEND DECISION -->` block in auth.html)
- DESIGN = passwordless 6-digit email OTP. BACKEND = Firebase email+PASSWORD (`auth.js`).
  **No 6-digit-OTP issue/verify function exists**, and Firebase email-link (magic-link)
  sign-in is NOT usable without a console/config change (enable the Email-link provider +
  actionCodeSettings url + authorized domain) — so it was NOT wired.
- WIRED: "Continue with email" validates via `BSP.isValidEmail` then advances client-side to
  the code step (no code is actually emailed — nothing can send one yet). "Verify" calls
  `verifyCode()` which does **not** fake a login: it shows an inline note ("6-digit code
  sign-in isn't enabled yet — continue with your password instead") and routes to the working
  password step with the email prefilled. "Resend code" honestly states no code was sent.
- FALLBACK: a fully-working email+password sign-in / sign-up is always reachable, so no real
  user is locked out. It reuses `BSP.signIn/signUp/sendPasswordReset` unchanged.
- **NEEDS FOUNDER DECISION** to make the 6-digit code real: (a) enable Firebase email-link
  passwordless sign-in (console change; still a magic *link*, not a typed 6-digit code — the
  boxes become decorative), or (b) add a Cloud Function that issues + verifies a 6-digit code
  (true to the design). Until then the OTP step is a faithful visual shell over the fallback.

### Verification (1400px, from the working file — committed at the hash below)
Harness: `scripts/render-auth.mjs`. Screenshots in the worktree root:
`auth-1400-email.png` (email filled, button enabled solid), `auth-1400-email-empty.png`
(button disabled 40%), `auth-1400-code.png` (six boxes 3-2-3-1-2-3 + Verify),
`auth-1400-password.png` (fallback). DOM probes confirmed: Continue bg `rgb(47,107,216)`,
disabled opacity `0.4`, input border `rgba(91,155,255,0.22)`, Player A `rgb(106,174,255)`,
Player B `rgb(231,233,238)`, grass `rgb(42,184,160)`, viz `rgb(91,155,255)`, odds/codes in
`"IBM Plex Mono"`, `BSP.signIn` present on the password step.

### Diffs worked from the side-by-side (fixed before commit)
1. Brand tile was too bright — darkened to a navy gradient with a `#6aaeff` "T" to match ref.
2. Line-movement deltas were unsigned and the arrow rode up beside the price — now stack
   cleanly as `▼ -0.08` (pos) / `▲ +0.26` (neg) below each close price.
3. "74% favourite" — `favourite` moved to IBM Plex Mono (ref renders it mono).
4. "Use a password instead" was between the legal line and the store badges, breaking the
   ref's contiguous legal→badges foot — moved above the legal line.
5. "‹ Use a different email" — added a space after the chevron.

### README-vs-reference notes / deviations
- **Line-movement delta colour.** Ref renders the deltas quite muted; I used README semantics
  (`--pos` for a shortened price 1.42→1.34, `--neg` for a drifted price 3.20→3.46), which are
  a touch more saturated than the ref. README wins; one-line change if the founder prefers the
  muted ref look.
- **"Use a password instead" / password step do not appear in any reference.** They are a
  required, honest deviation: the design is passwordless but the only real backend is
  password, so a reachable working login must exist. Styled secondary to stay consistent.
- `--brand-deep #2f6bd8` (the solid-button fill) is given by the task, not the README token
  list; used verbatim for Continue + Verify + password Sign-in (only one solid shows per step).

### Residual gaps (honest)
- No 6-digit code is really sent/verified (backend decision above). The OTP step is a visual
  shell that routes to the working password path.
- Code boxes render 56×64px vs the ref's slightly larger ~64–72px squares — negligible, kept
  at 56 so six boxes + gaps equal the form-column width.

## Item 3 — COMPLETED MATCHES (finished-state of the Matches card)

Completed Matches is a **state**, not a page: the Upcoming/Completed segmented control's
"Completed" position filters the SAME Matches shell + header + `.match-card` component to
finished fixtures. No second card was forked — the existing card (`renderMatches`) already
carries an `isCompleted = !!m.finalScore` branch that reuses every shell/header binding and
only recomposes the row body + footer. This pass VERIFIED that state end-to-end (the gate the
prior commit never ran), documented every inferred element, and added a durable completed-state
render harness. The card code itself was already correct and committed at `9b782d0`; no HTML
change was required — the deliverable is the verified gate + this documentation + the harness.

### What the completed card composes (all reusing the existing shell/card)
- **Header** — unchanged shell: surface (colour-coded) · tournament · round badge, then the
  fixture **date+time** right-aligned in IBM Plex Mono muted (`.mc-altdate`). The two
  upcoming column-headers ("Odds · Implied", "Recent form") are **dropped** (`colHead=''`)
  because the completed body has no such columns.
- **Player rows** — identity colours kept per README (A `#6aaeff`, B `#e7e9ee`) regardless of
  who won. Winner emphasis is carried by three non-identity signals so the "never both blue /
  A always blue, B always white" rule is never broken:
  1. `WON` pill (`--mc-pos #3dd68c` on `pos-bg`/`pos-bd` — README `--pos` tokens),
  2. a 3px `--mc-pos` accent bar down the left of the winner row (`.mc-row.winner::before`),
  3. the winner's sets-won total tile carries the lighter `.w` background vs the loser's `.l`.
- **Score column** — `mcSetCluster()`: sets-won total tile + per-set games, ALL IBM Plex Mono
  (verified `fontFamily: "IBM Plex Mono"` in the render probe). Tiebreaks supported via `sup`.
- **Odds** — `mcJourney()`: opening→track→closing journey with a purely-directional drift
  glyph; when only a closing price was ever recorded it collapses to the bare close number
  (no placeholder, no "Open" label). Opening odds aren't in today's `matches.json`, so the
  cards currently show the closing price alone.
- **Footer / Market Signal** — the upcoming "Market Signal" chip **transforms** to
  "**Market Signal · final**" and still expands in place; on a finished match the sharp split
  is read from the settled/bound odds (e.g. bet365 75/25 live), Stennisfy % + Polymarket/Kalshi
  flow/liquidity stay `—` (same data-layer gap as upcoming). "See full analysis →" is retained.
- **Dropped upcoming-only affordances** (probed absent on every completed card): `FAV` tag,
  odds/implied `.mc-oddswrap`, recent-form bars, inline column headers, and the "3 Bets Today"
  Pro promo card (suppressed with `state.view !== 'completed'`).

### Verification (the gate) — 1400px, from commit `9b782d0`
Harness: `scripts/render-completed.mjs` (adapted from `render-verify.mjs`; Node 24 global
WebSocket + spawned `--headless=new` Chrome via CDP; explicit `Emulation.setDeviceMetricsOverride`
width 1400, never `--window-size`). It builds the preview from `git show 9b782d0:…html`, injects
the real-shape BSP auth stub, then **drives the page's own controls**: clicks the `yesterday`
day-tab (the bucket that actually carries finished fixtures — see day-bucket note below) and the
`data-view="completed"` segmented button, then **waits for a completed card to paint** by polling
for `.mc-sets`/`.mc-won` (no fixed-sleep-and-assume). DOM probe confirmed: `activeView:"completed"`,
13 completed cards, WON badge present, set totals in `"IBM Plex Mono"`, and FAV/oddswrap/form-bar/
column-head/Pro-promo all absent. Screenshots (worktree root):
`ten8-completed-1400-9b782d0.png` (full page), `-card.png` (first card), `-sigopen.png`
(Market Signal · final expanded).

### INFERRED — no founder reference existed for the completed card (confirm/correct)
The founder attached no Completed screenshot and `export/README.md` has no prose Completed
section. I decoded `export/stennisfy-dashboard.html` (a compressed Framer scene-stack): it does
NOT contain the Today's-Matches *completed card* — the only completed cues are the **Tournaments**
"Completed" status colour `#3ECF8E` on `rgba(62,207,142,0.12)` and a **player-history** "def. …
2 - 1" fixture format. The upcoming card's original composition came from a now-absent zip-32
`matches-upcoming.html`; no equivalent completed artifact survives. So the following are
reasoned inferences from the design system + upcoming-card consistency, NOT a reference:
1. **Winner emphasis = WON pill + accent bar + set-total tile, with identity colours kept.**
   (Not recolouring/dimming names — that would break the README A/B colour rule.)
2. **Market Signal is kept and relabelled "· final"** (frozen at settlement) rather than removed.
   An alternative reading is to drop it entirely on a finished match — flagged for confirmation.
3. **Score shown as per-player set-total tile + per-set games** (vs a single "6-4 4-6 6-4"
   scoreline). Chosen to mirror the upcoming card's right-aligned two-value layout.
4. **Closing odds shown as the odds journey** rather than dropping odds entirely on a finished
   match (README says finished cards need no live odds, but the closing price is historical fact).

### README-vs-export note
Export Tournaments uses green `#3ECF8E`/`rgba(62,207,142,0.12)` for "Completed"; the card uses
README `--pos #3dd68c` + `pos-bg rgba(61,214,140,0.15)`. README wins (per the founder rule);
one-line swap if he wants the export's exact green.

### Residual gaps (honest)
- **Opening odds** aren't in `matches.json`, so the journey renders the closing price only
  (no open→close movement). Real value, not a placeholder — expands automatically once the
  pipeline carries `openingOdds` on finished fixtures.
- **Day-bucket interaction (behaviour, not composition):** a *today*-dated finished match
  buckets to `past` (`matchDayBucket` returns `'past'` once `m.finalScore` exists), so the
  Completed view on the **Today** tab is empty by design — completed cards surface on the
  **Yesterday** / **Past** / any specific past-day tab. Left untouched (it's day-filter/data
  logic, out of Item 3's card scope); flagged so the founder can decide whether "Today +
  Completed" should also admit today's just-finished matches.
- **Avatars** use external `api.api-tennis.com` photo URLs that 404 under headless (they load
  in the live app); on failure they fall back to the shared A-tint/B-neutral initials circle
  (`mcAvatarFail`). Identical to the accepted upcoming-card behaviour — shared code, not a
  completed-state issue.

---

## Item 4 — THE SHARED MATCH-DETAIL COMPONENT (Summary / Stats / Point by point)

Consolidation refactor. The one geometry-bearing element of match detail — the diverging
per-stat bar — was rendered by **two hand-synced copies** that had to be kept identical by
hand. They have now been collapsed to **one implementation** (`msBarHtml`), so the bar
geometry can never drift per-surface again. Bar colours were also brought to the design spec.

### The copies found (discovery)
`bsp-consult-dashboard.html`, inline JS. Two near-duplicate stat-sheet stacks:
- **Copy A — modal Match Stats sheet:** `buildMatchStatsSheet` (~7391) + `msheetRowHtml`
  (~7241) + banner `buildMatchStatsBannerHtml` + `buildMatchStatsSection`. Binds inline
  `m.matchStats` / `m.setStats` (from `matches.json`).
- **Copy B — form-panel sheet:** `formPanelStatsBodyHtml` (~6280) + `formPanelStatRow` (~6247)
  + `formPanelHtml` (~6329). Binds `setstats/{ek}.json` shards via `loadSetStatsShard`
  (or inline for the Form tab).
- Both emitted the SAME `.msheet-bar` markup verbatim (the duplication).
- Already shared, left as-is: `buildPointByPointHtml` (5716) + `buildSetSelectorHtml` (7344).
- Dead CSS (never emitted): `.mstat-track` / `.mstat-seg` (985–988). Left in place, harmless.

### The seven mount points (all render the form-panel component `formPanelHtml`)
1. `showYearSurfaceMatches` (~5874) — modal Overview year/surface drill
2. `formRowHtml` (~6239) — modal Form tab rows
3. `h2hRowHtml` (~6731) — modal H2H tab rows
4. `atournMatchRowHtml` (~6878) — modal Tournament tab rows
5. `styleVsArchetypeRowHtml` (~8704) — modal Playing-Style "vs archetype" rows
6. `ppShowYearSurface` (~11089) — player-profile year/surface drill
7. `ppFormRow` in `buildPlayerProfileHtml` (~11805) — player-profile Recent form
Plus the modal's own **Match Stats tab** (mounted in `openAnalysisModal` @ 8933) = Copy A.
Each derives its own `ek` off the row object (`data-ek` on `.aform-panel-wrap`).

### What changed (before → after)
- **New shared helper `msBarHtml(rawA, rawB)`** (~6253): the ONE diverging bar. Fixed centre,
  total-normalised — each half = half the track; A's fill = `a/(a+b)` of the LEFT half drawn
  from the centre leftward (`.msheet-half.p1{justify-content:flex-end}`), B's = `b/(a+b)` of
  the RIGHT half from centre rightward. Clamps missing/non-positive sides to 0.
- `msheetRowHtml` (Copy A) and `formPanelStatRow` (Copy B) now BOTH call `msBarHtml` — the
  inline bar markup + its `mag`/`pct` math was deleted from both. **Grep proof:** exactly one
  `msheet-half p1` emit site remains (inside `msBarHtml`).
- **Bar colours → design spec** (CSS, one place, all mounts): `.msheet-fill.p1` `#3E7BFA`
  gradient → solid **`#6aaeff`** (Player A); `.msheet-fill.p2` `#E8934B` amber gradient →
  solid **`#e7e9ee`** (Player B). Matches the export runtime (`aFill:'#6aaeff'`,
  `bFill:'#e7e9ee'`) and the README A/B identity rule ("never both blue").
- **Legend dots → same identity:** `.mstat-dot.p1` `#3E7BFA`→`#6aaeff`, `.p2` `#E8934B`→`#e7e9ee`.

### Real ek(s) used + geometry proof
- Modal Stats: **`past-12149516`** (A. Tabilo vs T. Griekspoor, real `m.matchStats` from
  `matches.json`). Rendered vs independently-computed `a/(a+b)`: Aces 14/17 → shareA 0.452
  (14/31 = 0.4516); 1st-serve% 60/65 → 0.480; Break-pts-conv → 0.417. All within rounding.
  Max rendered half-share 0.583 < 1 → neither side fills its half. Colours `rgb(106,174,255)` /
  `rgb(231,233,238)` on every bar.
- Form-panel Stats via a REAL `setstats/{ek}.json`: ek **`12059463`**, fetched over HTTP through
  the shipped `loadSetStatsShard` → `matchStatsFromShard` → `formPanelStatsBodyHtml` → `msBarHtml`.
  12 bars; Aces 4-4 → renderedShareA 0.500; same identity colours. (Shard synthesized from the
  real `historical-match-stats.json` entry for the render harness only — never committed.)
- PbP: sub-tab still paints real game rows post-refactor (verified with a real point log).

### Verification harness
`scripts/render-matchdetail.mjs` — 1400px CDP (explicit `Emulation.setDeviceMetricsOverride`),
auth-stubbed, opens the modal on a real completed match, cross-checks every bar's rendered
fill-width-within-its-half against the raw stat, verifies computed colours, screenshots Stats +
PbP, exercises the real `setstats/{ek}.json` fetch path, and spot-checks other mounts.
Screenshots: `md-stats-1400-<commit>.png`, `md-pbp-1400-<commit>.png`.

### Inferred choices (no founder screenshot for this component — confirm)
1. **"Summary view" = the existing headline strip** (names+dots + `.ms-final` "Final · score"
   banner + set-total header), NOT a new third sub-tab. The export + current app both expose
   only **Stats / Point by point** sub-tabs; the founder's "Summary" maps to that header. No new
   tab was invented.
2. **Consolidated the geometry-bearing BAR, not the two sheet WRAPPERS.** A full fold of the
   modal sheet (p1/p2 absolute, banner, won/total fractions) and the form-panel sheet (own/opp
   orientation, compact leader-weighted value cells) into one wrapper would change the modal's
   data orientation and risk breaking a working modal — out of scope per the "stop rather than
   commit a broken modal" rule. The bar (which "took four attempts") is now single-sourced;
   the two value-cell layouts remain per their surface.
3. **Value-text colours left as shipped** (modal neutral `#e7ebf1`; form-panel leader-weighted).
   Item 4 specifies bar + identity colours only; value recolouring was not in scope.
4. Bar fills are **solid** (not gradients) per the export's `aFill`/`bFill` solids.

### Residual gaps (honest)
- No local match has a `point-by-point.json` entry (that sidecar covers older matches; the 37
  local `matches.json` fixtures don't overlap it), and `setstats/`/`pbp/` shard dirs are
  pipeline-built, absent from the worktree. PbP real-rows and the form-panel real-shard were
  therefore verified with **render-only** fixtures built from real data already in the repo
  (`point-by-point.json` re-keyed; `setstats` synthesized from `historical-match-stats.json`).
  The code paths, orientation and geometry are the shipped ones; only the file location is faked.
- The H2H tab's single local row is the *current* match (no past box score in the served index),
  so that specific row shows "stats not available" — a data gap, not a render break; the
  form-panel component structure renders.

---

## Item 5 — THE MATCH ANALYSIS MODAL: exactly ten tabs, "Extra stats" removed

Founder spec (verbatim): "THE MATCH ANALYSIS MODAL — all ten tabs. No screenshots for
these; work from the README. **Extra stats does not exist — the rail is ten tabs, not
eleven. Remove it from the live app.**" README rail order = Key factors · Playing style ·
Form · H2H · Match Stats · Progression · Overview · Tournament · Weather · Odds.

### DISCOVER — before/after tab inventory
The rail (`#aTabs .asidenav-item[data-atab]`, built in the modal markup ~L2686) was already
in README order; the ONLY divergence was an 11th tab. So this was a **removal**, not a
re-order or re-build — every one of the ten renderers already existed and paints.

BEFORE (11 rail items): key · style · form · h2h · matchstats · progression · overview ·
tournament · weather · odds · **extra ("Extra stats")**.
AFTER (10, README order): key · style · form · h2h · matchstats · progression · overview ·
tournament · weather · odds. (Plus the separate `.asidenav-download` "Download report"
action, which is not a tab.)

### What was removed (four sites + a dead helper chain)
1. **Rail entry** `data-atab="extra"` (was ~L2696).
2. **Section container** `<div class="asection" data-asection="extra" id="aSectionExtra">` (was ~L2710).
3. **Fill call** `document.getElementById('aSectionExtra').innerHTML = buildExtraStatsSection(m);`
   in `openAnalysisModal` (was ~L8990).
4. **The exclusive renderer chain** (grep-proved used nowhere else): `EXTRA_STAT_ORDER`,
   `extraStatRowHtml`, `extraStatsWindowHtml`, `buildExtraStatsSection` (~L7130–7214) —
   deleted, replaced by a one-paragraph removal comment.
The generic tab-switch handler (`#aTabs` click listener) is data-driven, so no handler
needed editing. `printAnalysisReport` iterates `.asection` generically — one fewer section,
no code change. Grep after: only the removal comment mentions the old names; no live ref to
`extra` / `buildExtraStatsSection` / `aSectionExtra` remains.
**Left in place (harmless dead CSS):** the `.aextra-*` rules (~L1530–1537), now unused —
consistent with the repo's approach to dead CSS (`.mstat-track` etc.). One-line strip if wanted.

### DISCOVERED + FIXED — pre-existing z-index bug that hid the whole rail
The redesign's `.sf-sidebar` (fixed app nav) is `z-index:60`; `.modal-overlay` (the Analysis
modal root `#analysisModal`) was `z-index:50`. So the fixed sidebar rendered **on top of**
the open modal, covering its left ~236px — i.e. the tab rail's icons+labels. Proved with
`document.elementFromPoint` at the first rail item's centre: it returned a `.sf-sidebar`
BUTTON, not the rail item. This predates Item 5 (both CSS rules untouched by this pass) but
makes "confirm the rail shows exactly 10 tabs" impossible to satisfy visually and blocks a
user from seeing/clicking the rail labels. Fix: `.modal-overlay` `z-index:50 → 100` (above
the sidebar's 60, below the global tooltip 99999). A blocking modal must sit above app
chrome. After the fix `elementFromPoint` hits the rail item (`hitIsRailItem:true`) and the
rail screenshot shows all ten labels. **Flagged for founder** — one-line revert to 50 if he
wants the old stacking, but that re-hides the rail.

### Per-tab binding + local availability (verified match `past-12149516`, A. Tabilo vs T. Griekspoor, Washington ATP 500, Final 7-6 4-6 6-4)
| Tab | Renderer | Binds | Local render |
|---|---|---|---|
| Key factors | `buildKeyFactorsSection` | matchup-matrix + archetypes (style edge), recent results, odds bento | **REAL** (style-edge 49/51, "coin-flip" copy, weather/odds bento) |
| Playing style | `renderStyleSection` (+ `loadStyleRadar`/`ensurePsMatrix`) | style-radar.json + matchup-matrix.json | **REAL** (Serve/Return/Baseline/Net/Defence/Clutch percentile bars, 23·116 charted) |
| Form | `buildFormSection` (+ lazy `ensureFormRows`) | per-player recentForm shard | honest placeholder — "Recent-form data needs the stats source" (lazy shard not served locally; live app has it) |
| H2H | `buildH2HSection` | h2h record from matches.json / player history | **REAL** header (met 1×, 1-0, match list); single row's box score needs a setstats shard → per-row "stats not available" |
| Match Stats | `buildMatchStatsSection` → shared `msBarHtml` (Item 4) | inline `m.matchStats`/`m.setStats` | **REAL** (10 diverging bars, Stats/Point-by-point sub-tabs, Set 1/2/3 selectors; PbP sub-tab paints 10 real game rows) |
| Progression | `buildMatchProgressionSection` | live tournament draw / progression | honest placeholder — "No live tournament draw data on file" (also round-gated: hidden in R1) |
| Overview | `buildYearlyTables` | player-tournament-history (career by tier/surface/season) | **REAL** (career 192-136 59%, clay/hard/grass splits, season) |
| Tournament | `buildTournamentSection` | tournament-surfaces/venues + player history at event | **REAL** header (Washington, ATP 500, court speed 1.18 Fast, altitude 90 m, round); some year rows need a stat-breakdown shard → note |
| Weather | `buildWeatherSection` | `m.weather` (weather backfill) | **REAL** (30.4°C, wind 6.7, humidity 51%, match-day + tournament-week strip) |
| Odds | `buildOddsSection` (+ lazy `ensureOddsMovement`) | `m.odds`/`m.books` de-vigged | **REAL** (bet365 41.2/58.8 vig-removed, market table bet365/Pnci/Sbo); movement chart upgrades when the lazy timeline shard lands |

Six tabs fully real from local data (Key factors, Playing style, Match Stats, Overview,
Tournament header, Weather, Odds) plus H2H header; the honest placeholders (Form, H2H
per-row box score, Progression draw, Tournament per-year breakdown) all bind to
pipeline-built/lazy shards (`setstats/`, recentForm shards, live draw) that are absent from
the worktree — the SAME documented local shard gap as Item 4. Nothing invented.

### VERIFY — the gate (1400px CDP, all ten tabs driven)
Harness `scripts/render-tabs.mjs` (zero-install: Node global WebSocket + spawned
`--headless=new` Chrome; explicit `Emulation.setDeviceMetricsOverride` width 1400, never
`--window-size`; setstats/{ek}.json synthesized from real `historical-match-stats.json` and a
re-keyed real `point-by-point.json` log, as in Item 4). It opens a real finished match, then:
- **Rail assertion:** `count===10`, `hasExtra===false`, labels+order === README, no `extra`
  section → `RAIL_EXACTLY_TEN_README_ORDER true`.
- **Drives all ten:** clicks each rail item, POLLS the section until it actually paints
  (children present AND past any loading line — no fixed-sleep-and-assume), records a text
  snippet + whether it's an honest `.acomingsoon` placeholder, and screenshots each tab →
  `ALL_TEN_PAINTED true`.
- **Depth check:** Match Stats → Point by point sub-tab paints 10 real game rows
  (`PBP_SUBTAB_GAME_ROWS 10`).
- **Visibility check:** `elementFromPoint` on the rail returns a rail item (post z-index fix).
Screenshots (worktree root, from WORKING == the committed tree):
`md-rail-1400-WORKING.png` (the ten-tab rail, no Extra stats), `md-tab-<atab>-1400-WORKING.png`
for all ten tabs, and the PbP sub-tab via the Item-4 harness.

### INFERRED (no founder reference for this pass — confirm/correct)
1. **Rail order was already README-correct at 050fbac**; Item 5 = pure removal of the 11th
   tab. No re-composition of the ten existing tabs was done (each already paints) — per the
   "don't break a working modal" rule.
2. **Removed the whole exclusive `buildExtraStatsSection` helper chain**, not just the rail
   entry, so no dead code path can resurrect the tab. Kept `.aextra-*` CSS (harmless).
3. **Raised `.modal-overlay` z-index above `.sf-sidebar`** to make the rail visible — a
   discovered pre-existing bug, fixed because the founder's own gate ("confirm the rail shows
   exactly 10 tabs") can't be met while the sidebar hides the rail. One-line revert if unwanted.

### Residual gaps (honest)
- Form / Progression / the H2H single-row box score / Tournament per-year breakdown bind to
  pipeline-built or lazy shards (`setstats/`, recentForm shards, live draw) absent from the
  worktree; they render honest placeholders locally and populate on the live app. Verified via
  the render-only real-data fixtures (Item 4 method) where a shard path had to be exercised.
- Progression is additionally round-gated (`progressionRoundState` hides it in the first
  round); the verify match is a later round so the tab is present and drivable.

---

## Item 6A — THE PLAYER PROFILE PAGE: port to the Stennisfy export composition

Restyle/port, NOT a rebuild. The profile (`buildPlayerProfileHtml` @ ~11196, mounted into
`#playerProfileView.pp-formsurface`, repainted only via `ppRepaint`) already renders every
section the export designs — and MORE (it is a rich superset). So this pass brought the four
named blocks (header/identity, ratings, recent form, career/history) to the export's
composition + README tokens; every data binding is untouched (recentForm, career-by-year,
KPIs, Elo, market shard all bind exactly as before).

### Authoritative source
No founder screenshot exists for Player Profile (it didn't come through), so
`export/player-profile.html` (a 480KB Framer scene-stack; template on its L387) was decoded
for values and is the sole reference. Every inferred choice is logged below for confirmation.

### DISCOVER — profile section → renderer inventory (unchanged code paths)
| Section (DOM order) | Renderer / line | Binds |
|---|---|---|
| Back to Players | inline @ ~11956 | — |
| HERO / identity | inline @ ~11973 (+ `ppEloFor`, `ppStyleFor`, styleLine/meta @ ~11942) | `p.name/rank/country/age/hand/backhand`, archetype |
| Left rail — surface chips | `chips` @ ~11209 (`setPpSurface`) | `p.kpis[s]` |
| Left rail — stat tiles | `tilesHtml` @ ~11270 | Elo (`ppEloForSurface`), `p.kpis`, recentForm, titles |
| Left rail — Playing style radar | `ppStyleCard` @ 10456 | `playing-styles.json` |
| Left rail — Surface performance | `surfHtml` @ ~11290 | `p.kpis[s]`, seasonSurfRec |
| Left rail — Surface record | `ppSurfaceRecordHtml` @ 10260 | `career-splits.json` |
| Right — Market performance | `#ppMarketPanel` @ ~11654 | `odds-performance/<key>.json` shard |
| Right — ASAP signal | `ppAsapSignalHtml` | `asapsports-signal.json` |
| Right — Recent form | `recentFormCard` @ ~11819 (`ppFormRow` @ 11718) | `p.recentForm.matches` |
| Right — Career record | `careerRecordCard` @ ~11869 (`ppCareerYears`, `ppShowYearSurface`) | careerByYear |
| Right — Career splits / Last 52 | `ppCareerSplitsHtml` @ 10193 | `career-splits.json` |
| Right — Record by tournament | `recordSearchCard` @ ~11923 | `p.tournamentHistory` |
| Right — Key insights | `insightsHtml` @ ~11907 (`ppDynamicInsights`) | splits/style/market |

### PORT — before → after (the four named blocks)
1. **HERO avatar.** Before: 84px rounded-square (`border-radius:22px`), navy gradient
   `#1c2333→#111623`, initials `#dbe6ff` 26/800 (Hanken), rank badge bottom-**right**. After
   (export): **circular** 96px, blue-tint gradient `rgba(91,155,255,0.22→0.05)`, border
   `rgba(91,155,255,0.35)`, initials **IBM Plex Mono** `#8fb6ff` 30/700, rank badge
   bottom-**centre** (`#3E7BFA`, mono 12/700). Probe-confirmed circular + mono.
2. **HERO name / pills.** Name 30px → **40px/800** (export 44; trimmed to 40 to sit inside the
   retained hero-card padding — INFERRED). ATP pill recoloured blue→**muted `#9fb2d4`** on
   `rgba(159,178,212,0.1)`/`.32` (export). The gold **Elo pill was DROPPED** from the header
   (export shows only the ATP pill; Elo remains in the ELO-Rating stat tile, binding intact) —
   INFERRED, one-line restore. Archetype line `#9cc0ff` 13.5/600 → **`#5b9bff` 18/700**
   (export identity accent). Meta 12.5→14px, divider `rgba(.16)`.
3. **Ratings stat tiles.** Value `20px/800` → **`24px/700` IBM Plex Mono** (export 26; 24 keeps
   wide records like `351–85` from ellipsis-clipping in the 340px rail — INFERRED).
4. **Surface performance cards.** name 12→14/700, win% `14/800`→**`16/700` coloured per
   surface**, radius 11→14, padding 12·14→14·16, dot 8→9 (export).
5. **Recent form.** Title `14/700`→**`20/800`**; form % recoloured green→**brand `#5b9bff`**
   (export). The W/L **letter pills were replaced by the export's thin chronological STRIP** —
   10 solid `8px`/`radius 2` segments, win **`#3dd68c`** / loss **`#e0616f`**, oldest→newest,
   with **"10 ago" / "now →"** mono captions below. Probe-confirmed 8px/2px, 10 segs, correct
   two colours, captions present.
6. **Career record.** Title `14/700`→**`20/800`** (both populated + empty states). Surface
   header/cell/total colours retokened to **README surfaces**: Clay `#eda869`→**`#e8a84e`**,
   Hard `#7ba4ff`→**`#4db8ff`**, Grass `#3ECF8E`→**`#2ab8a0`**. Probe-confirmed the three
   computed header colours are the exact README tokens.
7. **Surface token single-source.** `PP_SURF_COLORS` (@10293) changed to README values, which
   propagates the corrected surfaces to the surface chips, surface-performance cards and
   recent-form tournament tags in one place. Grass moving to teal `#2ab8a0` (from `#3ECF8E`)
   also **separates the grass colour from the win-green** (`#3dd68c`/`#3ECF8E`) — the win/loss
   badges and form strip hardcode the green literals, so they were NOT affected (verified: the
   strip still renders `rgb(61,214,140)` win).

### INFERRED (no founder reference — confirm/correct)
- **Outer card wrapper RETAINED.** The export flows sections as standalone cards on the page
  bg (no wrapper); the current profile wraps hero+body+footer in one bordered `border-radius:18px`
  card with a `border-right` left rail. I kept the wrapper: the export has no layout to port for
  the profile's *richer* right-column blocks (Market performance, ASAP, splits, Record-by-
  tournament, Key insights, none of which exist in the export), and the wrapper is load-bearing
  for the working two-column + `ppSyncCareerHeight` layout. Removing it is a larger restructure
  I judged out of scope for "don't break the working profile." One-line follow-up if wanted.
- **Name 40px** (export 44), **tile value 24px** (export 26) — both trimmed for the retained,
  more compact in-card context; see above.
- **"View by surface" chips left blue-active** (export colours them per surface). They are a
  nav control, not data; low priority. Flagged.
- **Elo pill dropped** from the header (Elo still in the tile). Restore is one line.
- **Radii** on the named cards left at the profile's existing 16px (export uses 12–14);
  harmonising the whole profile to README `--r-card 12` is a trivial follow-up but would touch
  the unchanged sibling cards, so deferred for consistency.

### VERIFY — the gate (1400px CDP, real data, from the WORKING tree == committed)
Harness `scripts/render-profile.mjs` (zero-install: Node 24 global WebSocket + spawned
`--headless=new` Chrome; explicit `Emulation.setDeviceMetricsOverride` width 1400, never
`--window-size`). It injects the real-shape BSP auth stub, loads the real
`player-profiles.json` (428 players), **drives the real navigation** (clicks the Players nav
tab, then `showPlayerProfile('2382')` — C. Alcaraz, ATP #1, 26 recentForm matches, 9 career
years), **polls until `.pp-shell` actually paints** (no fixed-sleep), then full-page +
hero-clip screenshots. DOM/computed-style probes confirmed every token above. Nothing broke:
`hasMarketPanel:true`, 9 career rows, back-link present, market shard rendered real data.
Evidence (worktree root): `pp-after-WORKING.png` (full page 1400×4474),
`pp-after-WORKING-hero.png` (header), `pp-before-WORKING.png` (pre-port baseline).

### Per-section: real data vs honest placeholder (local)
All four named blocks render **REAL** from `player-profiles.json`: header identity, stat tiles,
surface performance, recent form (26 real matches, grouped by tournament), career record (9
real year rows + Total). Market performance is **REAL** for Alcaraz (indexed odds-performance
shard present locally). Placeholders are the same documented lazy-shard gaps as Items 4/5: the
per-form-row expand panel (stats/pbp shards) and per-year drill only reveal chevrons for
matches present in the local stats/pbp indexes — data-layer, not composition.

### Residual gaps (honest)
- Outer-card wrapper + per-surface chip colouring + card radii are the logged deviations above.
- Form-row expand panels and career drill-downs bind to `setstats/`/`pbp/` shards that are
  pipeline-built and largely absent locally (same gap as Items 4/5); the row/table composition
  renders, the expand payload is shard-gated.

---

# Item 6B — TOURNAMENTS page (Overview) port to references (TEN-8)

Scoped to `renderTourxOverview()` / `tourxConditionsPanelHtml()` (the `tourx` system —
NOT the older `tprofile` catalog, which is dead for this surface). Data layer untouched:
`COURT_CONDITIONS` (real per-tournament altitude / 3-yr abstract speed / 1st-serve-won /
service-hold), `tournamentProfiles` (champion), `tournamentProgression` (report state),
and the live match feed (This-week list) are all bound exactly as before.

## Before → after composition
- **Section tabs** relabelled `Tournaments overview / Tournament Reports` → **`Overview / Reports`**
  to match the reference pill group (container styling already matched).
- **Right panel reordered** to the two founder screenshots. New top-to-bottom order:
  title+status → hero AS number + `abstract court speed · {label}` → slider →
  **SLOW/MEDIUM/FAST endpoint labels (new)** → **rank line (new)** → CONDITIONS READ →
  ALTITUDE / 1ST SERVE WON / SERVICE HOLD tiles → BOUNCE / CHAMPION → 3-yr chart →
  ROI BACKING FAVOURITES/UNDERDOGS → FAVOURITE RELIABILITY → report panel.
  (Was: hero → tiles(4) → bounce/champion → chart → borderless conditions-read → button.)
- **CONDITIONS READ** was a borderless top-border divider → now a **bordered data card**
  (`#0d1420`, radius 12), which also fixes the README "no borderless data block" rule.
- **Tiles: 4 → 3.** Dropped the redundant "Abstract court speed" tile (it is already the
  hero number above the slider). Reference shows exactly Altitude / 1st serve won / Service
  hold. Tile value size bumped 16→22px to match the reference's prominence.
- **Hero number** 44 → 54px (reference reads it as the dominant element).
- **Report state** moved from a small inline button to a **full-width panel** — solid
  "View report" CTA when `hasReport`, else the reference's centred "Report not available yet
  / Match reports are published after the tournament concludes." card.
- **Surface dot colours** aligned to README tokens: grass `#2ab8a0`, clay `#e8a84e`, hard
  `#4db8ff` (were `#3ECF8E / #eda869 / #7ba4ff`). Matches the reference dots more closely.

## Per-section: real data vs honest placeholder
- Hero AS, asLabel, altitude, 1st-serve-won, service-hold, bounce, 3-yr chart (1.10/1.08/1.11),
  champion (J. Sinner), conditions-read prose — **REAL** (`COURT_CONDITIONS` + `tourxBounce`
  + `tournamentProfiles`; prose is a fixed surface/speed-branched template over real values).
- **Rank line — REAL, DERIVED.** `20th fastest of 64 tour events · tour median 1.02`,
  computed live from the conditions registry (the same set the left rail lists). Differs
  from the design mock's `12th … of 18 … median 1.31` because the mock used a smaller
  placeholder set — the mock numbers are NOT reproduced.
- **ROI BACKING FAVOURITES / UNDERDOGS — HONEST PLACEHOLDER (`—` + "No per-tournament ROI
  feed wired").** The mock's `-1.1%` / `-0.2%` are NOT rendered: no per-tournament betting-ROI
  source exists locally. The `COURT_CONDITIONS` header comment states betting ROI / favourite
  win rate are "deliberately NOT shown … no real data source exists"; `tournament-profiles.json`
  carries no ROI field. Fabricating them is exactly the trap the founder has caught.
- **FAVOURITE RELIABILITY — HONEST PLACEHOLDER (`—`, empty neutral bar + note).** Same reason:
  the mock's `72% Moderate` binds to a tournament-level results-and-prices feed not wired here.

## README-vs-reference disagreements / inferred choices (logged)
- Reference shows **no ⓘ** next to `abstract court speed · Fast`; I kept a subtle grey ⓘ
  (the "What is abstract court speed?" explainer is a real, useful affordance). Minor.
- This-week left-rail contents are live-feed driven (today = Washington/Los Cabos, not the
  mock's Kitzbühel/Estoril/Gstaad) — correct real data, not a composition miss.
- ROI/reliability placeholders are a deliberate deviation from the reference per the
  never-invent rule; founder decides whether to source that feed.

## Verify
`scripts/render-tourn.mjs` — Node 24 global WebSocket + spawned headless Chrome via CDP,
zero installs. Rebuilds the preview from `git show <commit>:bsp-consult-dashboard.html`,
injects the real publicUser auth stub, serves the worktree, sets an explicit 1400px CDP
viewport (`Emulation.setDeviceMetricsOverride`, not `--window-size`), clicks the Tournaments
nav, selects Wimbledon, polls until the conditions panel paints (`/abstract court speed/`
in `.tourx-ovright`), probes every section, then full-page screenshots. Probe confirmed:
Overview/Reports tabs, This Week/This Season toggle, slider labels, real rank line, 3 tiles,
bounce/champion, 3-yr chart, ROI placeholders, reliability placeholder, report panel.
