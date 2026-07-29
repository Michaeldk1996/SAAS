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
