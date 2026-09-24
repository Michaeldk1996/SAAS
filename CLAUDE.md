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
| The Odds API | Pre-match odds — Slams / 1000s / 500s | Live |
| OddsAPI / Oddsapi | ATP 250 and broader coverage | Live |
| kibl | — | — |
| bet105 | — | — |
| Open-Meteo | Venue weather | Built, never verified in prod |
| Sackmann tennis_atp | Historical W/L, surface splits, tournament records | In progress |
| Sackmann MatchCharting | Shot-by-shot, serve/return, rally length | In progress |

**Model R&D mode (founder ruling TEN-8).** The h2h-model — every Stage-2 adjustment layer and the Layer #8 MCP archetype baseline — runs in internal R&D mode. The Sackmann CC BY-NC-SA non-commercial restriction gates **commercial serving to paying members**, not internal R&D. Do **not** flag the licence as a blocker on R&D builds. It re-engages at commercial deployment, when a commercially-licensed alternative or a clean-room Stage-1-only fair price is required.

**Name matching.** The Odds API and API-Tennis use different name formats; matching is by last name. Watch for silent match-merge failures on busy days.

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

**Frozen — do not change without the audit saying so:** anything signed off; the half-pixel authored sizes (13.5, 12.5, 11.5, 10.5, 9.5); the two blue systems (`#3e7bfa` legacy vs `#5b9bff` canonical — do not migrate piecemeal); the handoff removals (Summary view, H2H trend chart, Extra Stats tab, uncomputed match time).

---

## Universal design tests

Each is phrased as a test you can apply. Surface-specific rulings live in `.claude/rules/` — see **Where the rest lives**.

- **Blue.** `--brand #5b9bff` answers *whose* number this is — interactive control, or player/tournament identity — never *whether* the number is good. **Test:** if blue signals quality or performance, it's wrong. *Exception:* legacy `#3e7bfa` (`--accent`, `--mx-brand-blue`) is frozen.

- **Green / red.** `#3dd68c` / `#e0616f` answer **"is this value trustworthy"** or **"which direction did this move"** — never **"which player is better."** Direction is permitted only where the measured thing is itself directional. A count or rate beside another player's is a *comparison* and takes identity colour or neutral. **Test:** is the colour answering trustworthy-or-direction, or ranking two players? If it ranks, neutralise. *Exceptions, canonical tokens only:* Playing Styles matchup edge and dominance; Odds-tab movement deltas; LOST SERVE and BP markers. The Clay tag never renders green — it is orange/terracotta. The retired near-miss hues `#3ECF8E` / `#E8607A` appearing in any UI file is a bug.

- **Text tiers.** `--sf-text-strong: #fff` is the brightest tier, reserved for **active-state accents** — the label of a selected control on a brand-tint fill. Everything else is `#e7e9ee` (`--sf-text`). **Test:** selected state of a control → `#fff`; all else → `#e7e9ee`. New work references the token; do not migrate existing raw `#fff` sites.

- **Colour semantics.** Text hierarchy is built from grey tone-levels (`--text` #e7e9ee → `--muted` #5b6880 → `--muted-2` #4b5672), never from hue. Hue is reserved for meaning. Tone carries hierarchy; hue carries meaning.

- **Font weight.** Valid iff one of **{400, 500, 600, 700, 800}**. **Test:** any other weight is wrong. Heavy 600/700/800 use is the design — do not tone it down.

- **Gradients, shadows, washes.** Permitted exactly where the export uses one. **Test:** does the corresponding export element carry it? Match it. The Match Analysis modal card (`0 40px 120px rgba(0,0,0,0.6)`) is the **only** elevation shadow in the build.

- **Em dash vs zero.** Absent value renders **"—"**, never `0`. Genuinely-zero value renders **`0`**, never an em dash. **Test:** absent, or really zero? Never interchangeable.

- **One container per content block.** **Test:** if a block sits inside two cards, collapse to one.

- **Empty states fabricate nothing.** Em dash, an explicit "no data" label, or nothing. **Test:** every value traces to real source data or it isn't a number.

- **Modal tab rail.** Exactly **eleven** tabs, **News second**: Key factors, News, Playing style, Form, H2H, Match Stats, Progression, Overview, Tournament, Weather, Odds. **Test:** count = 11 and position 2 = News.

- **Match-detail view toggle.** Every nested match-detail instance offers exactly two views: **Stats** and **Point by point**. Summary is removed product-wide. **Test:** a Summary button anywhere is wrong.

- **Expandable panels** must have a visible close control. **Charts** are preferred over tables for comparison views.

---

## Non-negotiables

- Never show a pipeline health banner or infrastructure warning to end users
- Never highlight the better stat between two players with colour — neutral display only
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
2. **Weather integration** — `fetchMatchWeather` has never successfully run in production; needs a live test. `VENUE_COORDS` has Wimbledon only
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

Before you claim the lane, get the commit fully ready (founder ruling TEN-273). The lane is held only while deploying:

1. **Rebased:** run `git fetch origin`. Every commit in `<sha>..origin/main` must be a data-bot `[skip ci]` commit. If any code commit is missing from yours, rebase.
2. **Suite green:** `tools/ci-suite.sh <sha>` exits 0. It runs `npm test` in a fresh CI-shaped clone and writes the suite receipt that `claim` requires. Nothing else writes receipts.
3. **Reviewed:** the review is done.
4. **Clobber check:** `tools/clobber-check.sh <base> <files>` is clear. If it reports anything, stop and rebase.
5. **Claim:** `node tools/deploy-lane.mjs claim --ticket TEN-123 --sha <sha> --reviewed`. **No exit 0, no push.**
   - Exit 7 means the commit is not ready; the output lists what is missing.
   - The hold is at most **30 min** and nothing extends it. After that it auto-releases. `renew` only answers "do I still hold it?".
   - A claim whose owner run has ended is released on the next `claim`.
   - Other runs with ready commits queue with `deploy-lane.mjs ready` (withdraw with `unready`). If your granted claim lists a `batch`, land with `node tools/deploy-batch.mjs --ticket TEN-123 --sha <the sha you claimed with>`: one push for all of them, falling back to your commit alone if the combined tree fails.
   - The pushed tree may differ from the suite-tested tree **only by `[skip ci]` data-bot commits**, and the clobber check is re-run against them. If a code commit landed in between, rebase, get a new receipt and claim again.
   - Waiting, dead owners, the 30-min waiter report and exit codes 0/1/2/3/6/7: `.claude/rules/deploy-lane.md`.
   - Post on your issue too, so the founder can see it.

CI enforces rebasing (step 1) independently: the deploy workflow refuses to publish a commit that is not a descendant of origin/main. Read its output — if the step fails with no message, that is this guard, and the answer is rebase and retry, not a retry on the same commit.

After you push, before you measure anything on the live surface:

6. Run `tools/check-live-build.sh <your-sha>`. If you landed with `deploy-batch.mjs`, use the `readBack` sha it prints: it equals your sha when your commit was pushed as is, and otherwise the cherry-pick means only the printed sha is on main. If another holder batched you in, use your `landedAs` sha. It tests whether your commit is **contained in** the live build, not whether the SHAs match — data commits land on main every 30–60s, so the live stamp is routinely ahead of your tip and an equality test would false-alarm constantly.
   - **exit 0** — your commit is in the live build. Measure.
   - **exit 1** — your commit is not in the live build. Either the tick has not run yet or something else published. Wait a tick and re-run. Do not measure.
   - **exit 2** — undetermined. That is a dash, not a pass. Report that you could not confirm the build and treat every probe result as unverified.

   Pass your sha. Run bare, it verifies nothing and returns 2 — "nothing checked" is a dash, not a pass.

Never report a pass, a fail, or a regression against a build that `check-live-build.sh` has not returned 0 for.

Release the lane when verification is complete: `node tools/deploy-lane.mjs release --ticket TEN-123`, and say so on your issue. **The live read-back is mandatory even if the 30-min cap released the lane first.** `check-live-build.sh` tests containment, so a later push does not invalidate it.

What the live build carries, for anything reading it directly: `build-info.json` at the site root — `commit` is the **full 40-char** sha of the tip of main at build time, alongside `tip`, `behindTip`, `onMain`, `runNumber`, `builtAt` — and the same sha as `<meta name="build-sha">` in the dashboard HTML, readable from the DOM without a second fetch. Both are written by the `Deploy ancestor guard + build stamp` step of `pipeline.yml`, regenerated every run, and neither is committed.

---

## Where the rest lives

Surface-specific rulings moved out of this file so they load only when relevant:

| Rules | Location |
|---|---|
| Overview tab identity/outcome, nested Match Stats block | `.claude/rules/modal-overview.md` |
| Key Factors — model card, soft-book gap, tournament tier | `.claude/rules/modal-key-factors.md` |
| Weather "How conditions affect play" cards | `.claude/rules/modal-weather.md` |
| Match Stats tone rules, point-log, score header | `.claude/rules/modal-match-stats.md` |
| Player Profile export parity | `.claude/rules/player-profile.md` |
| Records counting (Flashscore rules), walkovers, retirements | `.claude/rules/pipeline-records.md` |
| Odds sources, book ladder, card rules, close rules | `.claude/rules/odds.md` |
| Match analysis Form / H2H tabs — price order, display constants, all-level H2H, market-edge, odds alarms | `.claude/rules/modal-form-h2h.md` |
| Odds archive (tennis-data closing prices): drop-in refresh, merge, never-thinner, readers | `.claude/rules/odds-archive.md` |
| Deploy lane — ready gate (suite receipt, rebased, reviewed), 30-min cap, dead-owner release, batching, waiter reports | `.claude/rules/deploy-lane.md` |
| App shell — sidebar width, Stennisfy Model icon | `.claude/rules/app-shell.md` |
| Database Ratings board / Lines tab rulings | `.claude/rules/ratings.md`, `.claude/rules/lines.md` |

Full rationale and superseded decisions live in `BUILD-NOTES.md`, not here.

---

## Recording a new ruling

Every founder ruling is written into the right rules file the **same day** — a ruling that lives only in a chat has to be re-asked next time.

- **State it as a test someone can apply, not a prohibition.** *"Blue answers whose number this is, never whether the number is good"* beats *"never use blue on a performance value."*
- **List exceptions inline with the rule**, so nobody applies a rule without seeing its carve-outs.
- **Replace, don't append.** If a ruling reverses an earlier one, delete the earlier one. Superseded rules in context produce work against the wrong spec.
- **Rationale goes in `BUILD-NOTES.md`.** This file carries the rule; the notes carry the reasoning.
