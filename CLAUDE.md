# CLAUDE.md — Stennisfy

## What this project is

Stennisfy is a tennis betting analytics SaaS dashboard for serious ATP bettors, covering Grand Slams, ATP 1000s, 500s, 250s, Challengers and ITF.

**Brand:** **Stennisfy** is the product name rendered throughout the UI. Legacy `bsp-*` names survive in the source tree for historical reasons — leave them alone unless a task says otherwise.

- **Repo:** `michaeldk1996/SAAS`
- **Live:** `michaeldk1996.github.io/SAAS/`
- **App domain (future):** `stennisfy.com`

---

## Tech stack

| Layer | Detail |
|---|---|
| Frontend | Served live from the repo at `michaeldk1996.github.io/SAAS/`. The old single-file `bsp-consult-dashboard.html` is no longer the frontend — read the repo for the current entry point, don't assume |
| Pipeline | `bsp-pipeline.js` (Node.js) — GitHub Actions cron `*/15 * * * *` |
| Data files | `matches.json`, `tournament-profiles.json`, `tournament-progression.json`, `player-profiles.json` |
| Odds | The Odds API (Slams, 1000s, 500s) + OddsAPI + Oddsapi (250s, broader coverage) + kibl + bet105 |
| Tennis data | api-tennis.com (fixtures, results, H2H, surface stats, box scores) |
| Historical | Jeff Sackmann tennis_atp + MatchChartingProject (see licensing below) |
| Backtest | `backtest_elo.py`, `backtest_demo.py`, `demo_matches.csv` — internal only |

### File structure

```
/
├── bsp-pipeline.js                ← Node.js data pipeline (runs on cron)
├── matches.json                   ← Output: today's matches + odds
├── tournament-profiles.json       ← Output: tournament data
├── tournament-progression.json    ← Output: draw/bracket data
├── player-profiles.json           ← Output: player stats cache
├── api-tennis-integration.js      ← Reference: API-Tennis endpoint shapes
├── design-export/                 ← Canonical design source (see Design system)
└── .github/workflows/             ← GitHub Actions pipeline config
```

For current build state, open build state — do not rely on a snapshot in this file.

---

## Architecture rules — every task

1. **Never fabricate data.** Every stat, number or chart comes from a confirmed real source. If a field isn't available, show nothing or flag it — never approximate or invent.
2. **Feasibility before UI.** Confirm a data field exists in the pipeline before writing display code. Flag gaps rather than filling them.
3. **Atomic writes only.** Pipeline output uses temp file + rename — never write directly to live JSON.
4. **Global fixes over local patches.** A bug in multiple places is fixed at the source.
5. **Scope discipline.** Respect the stated boundaries exactly. Do not refactor, redesign or touch anything outside scope.
6. **Real data sources only.** Sackmann datasets are flat files, not live APIs — download, parse and cache locally; never query at runtime.
7. **ATP only.** No WTA anywhere — filter at pipeline level (`tourBadge === 'ATP'`).
8. **A check that passes on an empty set is not a check.** Manufacture the state and run the pre-fix build as a control. If there is nothing to measure, **skip out loud** — never report a vacuous pass or a misleading red.
9. **Every suite is wired into `npm test`.** A red harness and a healthy one have produced identical builds.
10. **Run `tools/clobber-check.sh` before every land.** Express changes as replayable patch scripts with exact anchors that test the *result*, not the anchor. Whole-file writes from a stale checkout silently revert other tasks' work.
11. **Self-chaining workflows run from `main` or they do not run.** A branch chain drifted 1,188 lines and looked healthy for twelve runs.
12. **Ship, don't merge.** No feature flags, no go-live gates — there are no members yet. Report with a deployed commit and a live read. "Merged" is not "shipped".
13. **`n` on every figure; flag `n < 30`.** Say "unknown" rather than inferring from a spec.
14. **A read-only probe must never trip a circuit breaker** and starve an archive.
15. **Think in proportion to ambiguity.** A rebuild against a spec file needs execution, not deliberation — read the values and build. A root-cause hunt, an architecture call, or anything where the first plausible approach might be wrong deserves real thought before acting.

---

## Data sources

| Source | Provides | Status |
|---|---|---|
| api-tennis.com | Fixtures, results, H2H, surface stats, box scores | Live |
| The Odds API | Price backup only (TEN-371): `h2h` prices on cards matched to an api-tennis fixture | Live |
| OddsAPI / Oddsapi | ATP 250 and broader coverage | Live |
| kibl | — | — |
| bet105 | — | — |
| Open-Meteo (free endpoint, licence accepted by founder — TEN-304) | Venue weather | Live; rules in `.claude/rules/modal-weather.md` |
| Sackmann tennis_atp | Historical W/L, surface splits, tournament records | In progress |
| Sackmann MatchCharting | Shot-by-shot, serve/return, rally length | In progress |

**Model R&D mode (founder ruling TEN-8).** The h2h-model — every Stage-2 adjustment layer and the Layer #8 MCP archetype baseline — runs in internal R&D mode. The Sackmann CC BY-NC-SA non-commercial restriction gates **commercial serving to paying members**, not internal R&D. Do **not** flag the licence as a blocker on R&D builds. It re-engages at commercial deployment, when a commercially-licensed alternative or a clean-room Stage-1-only fair price is required.

**api-tennis is the spine; The Odds API is a price backup only** (founder ruling TEN-371, 2026-10-01). Fixtures, player names, player keys, scores, results and status come from api-tennis. The Odds API contributes price fields and nothing else, and it never blocks a publish.
- **Test:** every board card's `p1`/`p2` is its api-tennis fixture's `event_first_player`/`event_second_player` (oriented by `fixtureFirstIsHome`), and every profile `name` is the spelling of that player in his most recent api-tennis fixture (TEN-372: one spelling on card and profile), whatever form The Odds API used ("Alexander Zverev" → "A. Zverev"). `tools/test-ten371-name-spine.js` drives `buildMatchObject`, `buildUpcomingMatchObject` and `buildOneProfile` with Odds API data present, absent and in full-name form; display names come out identical in all three.
- **Test:** an Odds API event with no api-tennis fixture, or with an orientation `fixtureFirstIsHome` can't decide, is not carded and is logged by name ("not carded (no-fixture|undecidable)"). No name or ID is invented for it.
- **Test:** an Odds API refusal (non-2xx, network error, non-list body) logs "Odds API unavailable: <status>" with `x-requests-remaining` and the run continues with no Odds API prices. It never throws and never reads as "Found 0 odds events".
- **Test:** an api-tennis fixture with status `Finished`, no `event_winner` and no game won by anyone (every set 0–0) is a dead pairing, like a Cancelled one, and is never a card (`isUnplayedFinishedFixture`; measured: A. Molcan v A. Rinderknech, 12166954, 1 Oct). A named winner (a retirement after 0–0), any game won, or status `Retired`/`Walk Over` keeps it a result.
- **Test:** the pre-publish gate (`tools/test-pp2-reconcile.js`) reads its fixture players by api-tennis key from `pp2-fixture-players.js` (Alcaraz 2382, Zverev 1980, Djokovic 1905, Schwartzman 67), never by name, with no stand-in player: a missing one aborts "fixture player <key> not found". The pipeline builds those keys first and outside the per-run build budget (`PINNED_PROFILE_KEYS`), as per-player shards only; they never enter the eager `player-profiles.json`.
- **Test (TEN-372):** player 796 is "Y. Bu" on his card and his profile, never get_players' "B. Yunchaokete". get_players' `player_name` disagreed with the fixture spelling for 78 of 1,769 players (measured 1 Oct: "T. Barrios" for T. Barrios Vera, "C. O&apos;Connell", ". A. Nedic"), so it names a profile only when the player has no fixture of his own, entity-decoded ("C. O'Connell"). `profileNameFromFixtures` in `bsp-pipeline.js`; `tools/test-ten371-name-spine.js` checks both.
- **Exception:** price matching still joins The Odds API to a fixture by surname (`findApiTennisFixture`), so a surname-first vendor name ("Bu Yunchaokete" v api-tennis "Y. Bu") misses. That event is left off and its api-tennis card keeps api-tennis's own prices.

**api-tennis times are the Europe/Berlin wall clock** (founder ruling TEN-304 → TEN-308, 2026-09-27). An api-tennis `event_date` + `event_time`, and a card's `date` + `time` when it has no `startTs`, is Berlin local time: CEST until 25 Oct 2026, CET after. It becomes an instant only through the tz database: `berlin-time.js` (`berlinWallMs`) in Node, `zoneinfo('Europe/Berlin')` in Python, `at time zone 'Europe/Berlin'` in SQL. The page's `cardStartMs` and `stennisfy-drops/status.mjs` carry inline copies of the same method because they cannot require a file. In the repeated hour (25 Oct 02:00–02:59) the Node, page and Python readers take the earlier (CEST) instant.
- **Test:** 14:00 Berlin on 24 Oct is 12:00Z; 14:00 on 26 Oct is 13:00Z; 01:30 on 25 Oct is 23:30Z on the 24th; 02:30 on 25 Oct is 00:30Z. Every site passes all four in `tools/test-ten308-berlin-time.js` / `test-ten308-berlin-time.py`. A UTC read, a fixed +2, or an offset looked up at the wall time read as UTC fails them.
- **Exceptions:** a record with a `startTs` uses it (a UTC instant; on odds-API records `date`/`time` are UTC too). Our own api-tennis calls made with `&timezone=UTC` are UTC.

---

## Design system — the export is canonical

**The design is the specification, not a reference.** Michael designs in Claude Design; the export **is** what he designed. Reproduce it — do not interpret, improve or substitute an equivalent.

**Sources, in priority order:**
1. **Per-tab specs** — `design-export/specs/*.md` — authoritative inside their tab's scope.
2. **`design-export/computed-styles.json`** — authoritative for every measurable value: padding, margin, width, font size and weight, line height, radius, gap, fill alpha, gradient stop, glyph. No rounding.
3. **`design-export/README.md`** — authoritative on rules, scope and reasoning.
4. Tokens: `tokens-observed.json` (raw), `tokens-design.json` (readable).

**Working rules:**

- **No number quoted in a prompt is a source — including the founder's.** Treat every quoted value as a hypothesis to verify against the export.
- **No generic-convention defaults.** Component-library styling and design instinct are wrong here by default. Reaching for a sensible standard treatment is the signal to stop and read the export.
- **Rebuild rather than restyle.** If structure differs from the export, adjusting colours and spacing will not converge — build the export's structure.
- **On a measurable conflict, the export wins and you proceed.** Note the divergence in your report; do not hold work waiting on a ruling.

**Three carve-outs — stop and ask, because the export cannot settle them:**

1. **Fabricated or absent data.** No export mock justifies inventing a value. Em dash and report.
2. **Scope.** A section, control or binding with no counterpart in the data layer — report before building.
3. **Product decisions that post-date the export.** Before deleting something *because the export lacks it*, ask.

**Frozen — do not change without the audit saying so:** anything signed off; the half-pixel authored sizes (13.5, 12.5, 11.5, 10.5, 9.5) — except caps labels, which are Hanken 10.5 everywhere (TEN-376); the handoff removals (Summary view, H2H trend chart, Extra Stats tab, uncomputed match time).

---

## Universal design tests

Each is phrased as a test you can apply. Surface-specific rulings live in `.claude/rules/` — see **Where the rest lives**.

- **Palette = the foundation (founder TEN-376, OFFICIAL VERSION 1, 2026-10-03).** Every colour on every surface — the Match analysis modal included — is a token from `tokens.css`, night by default, day via `data-theme="day"`, Auto following the OS live. Theme 12a and the modal's Night 24b / Day 26f are retired. **Test:** `tools/lint-raw-colours.mjs` (first in `npm test`) finds zero raw colours in any published page, stylesheet or script; the full rule set — surfaces, three greys, blue = fills / `--link` = links, green/red = signed only, amber on two pages, lime on one dot, badges, charts, shadows — is `.claude/rules/foundation.md`.

- **Layout = the 12a design file (founder brief TEN-286, 2026-09-26).** The reference is `design/reference/portal-12a.html` (never published). It renders only with JavaScript: open it in headless Chrome, measure **computed styles** relative to the portal frame (the `<aside>`'s parent), and compare at the same DPR. **The design file's computed values beat any label text and any HANDOFF.md number** where they disagree (its label strip says "#10131F surfaces, 6% hairlines"; it computes `#0E1019` and 0.045 — computed wins). **Test:** the component comparator (review A) reports delta 0 or a listed data-driven exemption for every component; `test-ten286-layout.mjs` locks the values on the shipped source.

- **Colour semantics.** Tone carries hierarchy (`--text` → `--text-soft` → `--text-label`); hue carries meaning. **Test:** if blue text is not a link, if green/red is not a signed value, if amber is outside the Stennisfy Model or Trading Report, or if lime is not the live serve dot, it is wrong (`.claude/rules/foundation.md`).

- **Font weight.** Valid iff one of **{400, 500, 600, 700, 800}**. **Test:** any other weight is wrong. Heavy 600/700/800 use is the design — do not tone it down.

- **Gradients, shadows, blur.** The only colour gradient is the page glow `--page-bg` (`--glow`), on `<html>` only — never a card, modal or the sidebar panel (founder TEN-376 S6). Functional masks (overflow fades) and greyscale small-sample hatches (white ≤ 12%) are not decoration and are allowed (T2). Shadows are `--shadow-menu` / `--shadow-pop` / `--shadow-modal`, overlays `--backdrop` + `blur(3px)` (founder TEN-376 U5). **Test:** the colour lint passes and every `box-shadow` on a floating layer is one of the three tokens.

- **Em dash vs zero.** Absent value renders **"—"**, never `0`. Genuinely-zero value renders **`0`**, never an em dash. **Test:** absent, or really zero? Never interchangeable.

- **One container per content block.** **Test:** if a block sits inside two cards, collapse to one.

- **Empty states fabricate nothing.** Em dash, an explicit "no data" label, or nothing. **Test:** every value traces to real source data or it isn't a number.

- **Modal tab rail** (founder step 3, TEN-380 README §1, 2026-10-03). Exactly **twelve** tabs in this order: Key factors, Odds, Market edge, Form, H2H, Playing style, Progression, Tournament, Weather, News, Overview, Match Stats; the modal **opens on Odds**. Active tab = `--inner` + inset 1px `--edge-10`, white words + icon; idle = `--text-label` words, white icon, no hover tint — no blue in the rail. **Test:** the rail lists exactly that order (`test-ten310-market-edge.mjs`, `test-ten314-modal-frame.mjs`), a plain open lands on Odds, and the rail's colours read those tokens (`test-ten303-colours.mjs`).

- **Match-detail view toggle.** Every nested match-detail instance offers exactly two views: **Stats** and **Point by point**. Summary is removed product-wide. **Test:** a Summary button anywhere is wrong.

- **Expandable panels** must have a visible close control. **Charts** are preferred over tables for comparison views.

---

## Non-negotiables

- Never show a pipeline health banner or infrastructure warning to end users. *Exception:* the Dropping Odds page's "FEED DISCONNECTED" banner, worded exactly as its export draws it (founder, TEN-297 card 79e9db02 Q3) — see `.claude/rules/drops.md`.
- Never highlight the better stat between two players with colour — neutral display only. **Test:** both players' figures and text are the same colour. *Exception (founder ruling 8, TEN-380, 2026-10-03):* two-player BARS split leader / trailer — the leader's bar solid, the trailer's at 45% (`--white-bar` / `--white-bar-2`, or `--bar` / `--bar-2`); the figures beside them stay white.
- Never show "went the distance (4+ sets)" for best-of-three tournaments
- Recent form always includes Challenger and ITF — never ATP-only
- Tournament records reflect full career history, not a truncated range
- Closing odds are preserved through pipeline rebuilds — never recomputed at display time
- The Clay surface tag never renders green
- Confidence percentage: no decimals (88%, not 88.5%), white not orange
- Player names in match lists are never truncated — use flex-grow

### Odds — hard invariants

Full source detail, book ladder, card and close rules: `.claude/rules/odds.md`.

- **One book per fixture.** Open, Now and Close come from the same book. Never mix books within a fixture.
- **Missing = dash.** Never zero, never a plausible default, never a price from another book.
- **Price floor:** strictly below 1.01 is suppressed. 1.01 itself is a real book minimum.
- **Close = last price before the *actual* start** — never the scheduled time, which lands after the real start 58% of the time.
- **Kibl timestamps are insert time, never book-post time.** Label them that way everywhere.
- **Kibl has no history endpoint** — uncaptured prices are lost permanently. The archive must run daily.

---

## Open question — do not resolve alone

**Value % methodology.** Two different things wear one name, and this file and `design-export/README.md` disagree:

- The proprietary `value %` (W/UE ratio, surface form weighting, fatigue scoring) — `null` everywhere in the data, not built.
- The rendered value verdict ("SHARP VALUE" / "NO VALUE") — built, derived from a no-vig best-price margin `ppGap = (1/fair − 1/price) × 100`, with soft-book price inputs the README flags as authored placeholders.

Do **not** wire the proprietary methodology behind the rendered verdict, and do not ship the placeholder inputs as if they were the model, until Michael confirms which is intended.

---

## Known bugs

1. **H2H surface filter** — does not work correctly on the H2H page
2. **Weather** — the Match analysis → Weather tab is the TEN-304 Wave B rebuild of the locked handoff: it reads its own per-venue Open-Meteo files (`weather-index.json` + `weather/`, built by `build-weather.js` in the pipeline, re-fetched every 3 h, never committed), shows venue-local times, and a tournament with no mapped venue shows the unavailable state. A completed match shows our archived pre-start forecast (`weather/archive/`), labelled "forecast, not observed"; no archive → unavailable. Open: the severity cut-offs are PLACEHOLDERS until the founder rules (the "THRESHOLDS TBD — MICHAEL" chip stays); model layer #12 is OFF until a backtest shows it improves predictions. The completed-match archive is committed by the pipeline's commit-back; an api-tennis 02:00Z placeholder start reads as TBC. Rules: `.claude/rules/modal-weather.md`
3. **Form bars** — had rendering issues on Today's Matches; check current state before touching
4. **Modal filter pills** — should show tournament names with an "All surfaces" dropdown, not surface-type pills

---

## How tasks arrive

Each task is a self-contained brief specifying what to build, what not to touch, which data source to use, and any feasibility checks required first.

**Read the brief fully before writing code. Complete feasibility checks and report back before implementing.**

### Agent roles

**Claude Code (developer).** Writes and edits code; does not design. Flag visual judgment calls rather than guessing. The pipeline and the live site are a production system — treat them as one.

**Claude Design (visual/UI).** Produces design direction and specifications; does not write implementation code. Never suggests fabricated data or placeholder charts, never proposes designs needing unconfirmed data sources, never redesigns outside scope.

---

## Deploying — one lane at a time

Pushing to main does not deploy on its own. The deploy workflow is tick-only: your commit goes live on the next scheduled tick, after the pipeline runs and the CDN updates. Budget ~26 min median, ~35 min worst case from push to live. A measured run came in at 21.9 min. Do not plan around the fast case.

Before you claim the lane, get the commit fully ready (founder rulings TEN-273). The lane is first come, first served, and it covers deploying only:

1. **Rebased:** run `git fetch origin`. Every commit in `<sha>..origin/main` must be a data-bot commit: `[skip ci]` in its subject AND a data-bot author (`DATA_BOT_AUTHORS`) AND only files a data bot really writes (`DATA_FILES` / `DATA_DIRS` in `tools/deploy-lane.mjs`, taken from the bots' own `git add` lines; hand-curated files the code reads never count). If any code commit is missing from yours, rebase.
2. **Suite green:** `tools/ci-suite.sh <sha>` exits 0. It runs `npm test` in a fresh CI-shaped clone and writes the suite receipt that `claim` requires. Nothing else writes receipts.
3. **Reviewed:** the review is done.
4. **Clobber check:** `tools/clobber-check.sh <base> <files>` is clear. If it reports anything, stop and rebase.
5. **Claim:** `node tools/deploy-lane.mjs claim --ticket TEN-123 --sha <sha> --reviewed`. **No exit 0, no push.**
   - Your first ready claim puts you in the waiter queue.
   - The lane goes to the **longest-waiting live claimant**, not to whoever polls first.
   - Exit 3 prints your `position` and `waitedMin`; re-run `claim` every ≤ 5 min.
   - Exit 7 means the commit is not ready; the output lists what is missing. If you were already waiting, you keep your place and it still reports your position.
   - **Any waiter silent for 15 min drops out, alive or not** (ruled 2026-09-25 03:24Z). Every drop is logged with the task and time, and a dropped waiter can rejoin at the back. Dead waiters drop out. **If you are already waiting, run `ci-suite.sh` with `DEPLOY_LANE_TICKET` set** (`DEPLOY_LANE_TICKET=TEN-123 bash tools/ci-suite.sh <sha>`): it checks in every 4 min while the suite runs, so a long test run never costs you your place.
   - Other runs with ready commits offer them with `deploy-lane.mjs ready` (withdraw with `unready`); that is not a place in the lane queue. A waiter whose commit is batched in leaves the queue.
   - **Every land goes through `node tools/deploy-batch.mjs --ticket TEN-123 --sha <the sha you claimed with>`.** It handles the solo case, pushes only the claimed, suite-green sha (plus any batch), and records your `readBack` sha and push time on the claim. A raw `git push` is outside the contract; this tool cannot block it.
   - The pushed tree may differ from the suite-tested tree **only by `[skip ci]` data-bot commits**, and the clobber check is re-run against them. If a code commit lands after your claim: `release`, rebase, run `ci-suite.sh` again, claim again.
   - **Hold: 40 min from the claim** (the clobber check, `deploy-batch.mjs` and the push all run inside it).
     - It is **extended while your own pipeline run is in progress**, then for **12 min of read-back grace** after that run succeeds. A healthy deploy is never cut off. Your run is the *first* `pipeline.yml` run whose first job started after your push (a run cancelled while queued never started); later ticks never extend. One failed GitHub read reuses the last known state if it is ≤ 5 min old, and only to keep the lane, never to release it.
     - You are released at once if your run is dead, if your pipeline run sits queued for more than 10 min, or at 40 min with none of the above. Pending behind a tick that started before your push counts as moving (ruled 2026-09-25 03:24Z).
     - GitHub unreachable never extends a hold.
     - A forced release puts you at the back of the queue only if you had not pushed, posts on your ticket, and turns a `pipeline-watchdog.yml` run red with the reason.
   - Waiting, dead claimants, same-ticket runs, the hold rules, cutover and exit codes 0/1/2/3/6/7: `.claude/rules/deploy-lane.md`.
   - Post on your issue too, so the founder can see it.

CI enforces rebasing (step 1) independently: the deploy workflow refuses to publish a commit that is not a descendant of origin/main. Read its output — if the step fails with no message, that is this guard, and the answer is rebase and retry, not a retry on the same commit.

After you push:

6. **Confirm your commit is live, and release the lane, in one step.** In your poll loop run `node tools/deploy-lane.mjs confirm-live --ticket TEN-123 --sha <readBack>`, using the `readBack` sha `deploy-batch.mjs` printed. It equals your sha when your commit was pushed as is; otherwise the cherry-pick means only `readBack` is on main.
   - `confirm-live` accepts only your claimed sha or that recorded `readBack`; any other sha → exit 1.
   - It checks the **site first** (`tools/check-live-build.sh <your-sha>`) and **releases the lane on exit 0**, even if the hold rules would have released you at that moment. On exit 1 or 2 the hold rules run: still holding → exit 3, poll again; released → exit 1 with the reason (your push is out: read back without the lane).
   - Batched in by another holder? You never held the lane: read back your `landedAs` sha with `tools/check-live-build.sh`.
   - `check-live-build.sh` tests whether your commit is **contained in** the live build, not whether the SHAs match. Data commits land on main every 30–60 s, so the live stamp is routinely ahead of your tip and an equality test would false-alarm constantly.
7. **Everything after that runs without the lane:** measuring, verifying, watching, reading logs. If verification finds a fix, that fix gets ready and claims again like anyone else.

What `check-live-build.sh` returns, whether you call it directly or through `confirm-live`:
- **exit 0**: your commit is in the live build. Measure.
- **exit 1**: your commit is not in the live build. Either the tick has not run yet or something else published. Wait a tick and re-run. Do not measure.
- **exit 2**: undetermined. That is a dash, not a pass. Report that you could not confirm the build and treat every probe result as unverified.

Pass your sha. Run bare, it verifies nothing and returns 2. "Nothing checked" is a dash, not a pass.

Never report a pass, a fail, or a regression against a build that `check-live-build.sh` has not returned 0 for. If you must stop before your build is live, run `node tools/deploy-lane.mjs release --ticket TEN-123`, say so on your issue, and keep the read-back as your own open item.

What the live build carries, for anything reading it directly: `build-info.json` at the site root — `commit` is the **full 40-char** sha of the tip of main at build time, alongside `tip`, `behindTip`, `onMain`, `runNumber`, `builtAt` — and the same sha as `<meta name="build-sha">` in the dashboard HTML, readable from the DOM without a second fetch. Both are written by the `Deploy ancestor guard + build stamp` step of `pipeline.yml`, regenerated every run, and neither is committed.

---

## Where the rest lives

Surface-specific rulings moved out of this file so they load only when relevant:

| Rules | Location |
|---|---|
| Overview tab — the design build, identity/outcome colours, what a count opens, pop-up figures | `.claude/rules/modal-overview.md` |
| Key Factors — model card, soft-book gap, tournament tier | `.claude/rules/modal-key-factors.md` |
| Weather tab — venue files, archive (completed matches), venue-local times, MATCH badge vs header, severity config, model layer #12, venues | `.claude/rules/modal-weather.md` |
| Match Stats tone rules, point-log, score header | `.claude/rules/modal-match-stats.md` |
| Match analysis News tab — feed, 5-day window, player_key join, N9 empty/unavailable, no sample | `.claude/rules/modal-news.md` |
| Player Profile export parity | `.claude/rules/player-profile.md` |
| Records counting (Flashscore rules), walkovers, retirements | `.claude/rules/pipeline-records.md` |
| Match analysis modal rebuild (TEN-312): players/avatars, walkovers on every tab, sample gate, build order | `.claude/rules/modal-analysis.md` |
| Odds sources, book ladder, card rules, close rules | `.claude/rules/odds.md` |
| Match analysis Form / H2H tabs — price order, display constants, all-level H2H, market-edge, odds alarms | `.claude/rules/modal-form-h2h.md` |
| Market edge (Match analysis tab + player-profile basis) — data path, populations, settlement, today's price, Needs, floor, pill, shared basis | `.claude/rules/modal-market-edge.md` |
| Odds archive (tennis-data closing prices): drop-in refresh, merge, never-thinner, readers | `.claude/rules/odds-archive.md` |
| Deploy lane — ready gate, first-come-first-served queue, deploy-batch as the one land path, confirm-live release, 40-min pipeline-aware hold, cutover, waiter reports | `.claude/rules/deploy-lane.md` |
| App shell — 252px sidebar + floating panel, no user-row chevron, nav glyphs | `.claude/rules/app-shell.md` |
| Today's Matches (TEN-377) — header stats, Upcoming / Completed card rulings, odds pop-up pointer | `.claude/rules/todays-matches.md` |
| Foundation — colour tokens, theme switch, surfaces, text greys, meaning colours, badges, charts, shadows, type (TEN-376) | `.claude/rules/foundation.md` |
| Layout 12a — layout reference, logo, brand pages | `.claude/rules/theme-12a.md` |
| Database Ratings board / Lines tab rulings | `.claude/rules/ratings.md`, `.claude/rules/lines.md` |
| Pre-match drops page — B′ Fly endpoint, what a row is, Dropped to vs Latest, 24 h window, freshness, watchdog | `.claude/rules/drops.md` |

Full rationale and superseded decisions live in `BUILD-NOTES.md`, not here.

---

## Recording a new ruling

Every founder ruling is written into the right rules file the **same day** — a ruling that lives only in a chat has to be re-asked next time.

- **State it as a test someone can apply, not a prohibition.** *"Blue answers whose number this is, never whether the number is good"* beats *"never use blue on a performance value."*
- **List exceptions inline with the rule**, so nobody applies a rule without seeing its carve-outs.
- **Replace, don't append.** If a ruling reverses an earlier one, delete the earlier one. Superseded rules in context produce work against the wrong spec.
- **Rationale goes in `BUILD-NOTES.md`.** This file carries the rule; the notes carry the reasoning.
