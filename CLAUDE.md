# CLAUDE.md — BSP Consult Tennis Edge
## Agent briefing — read this fully before touching any file

---

## What this project is

BSP Consult Tennis Edge is a tennis betting analytics SaaS dashboard for serious ATP bettors. It tracks matches across Grand Slams, ATP 1000s, 500s, 250s, Challengers, and ITF. Members use it daily to analyse matches, odds, and player data for betting decisions.

**Owner:** Michael (BSP Consult) — Belgian, francophone, digital nomad  
**Repo:** `michaeldk1996/SAAS`  
**Live URL:** `michaeldk1996.github.io/SAAS/`  
**App domain (future):** `bspconsult.app`  
**Reference competitor:** matchup-tennis.fr (structure reference only — never copy their data or copy)

---

## Tech stack

| Layer | Detail |
|---|---|
| Frontend | Single HTML file: `bsp-consult-dashboard.html` |
| Pipeline | `bsp-pipeline.js` (Node.js) — runs every 15 min via GitHub Actions |
| Data files | `matches.json`, `tournament-profiles.json`, `tournament-progression.json`, `player-profiles.json` |
| Odds | The Odds API (Grand Slams, 1000s, 500s) + OddsAPI + Oddsapi (ATP 250 and broader coverage) |
| Tennis data | api-tennis.com (fixtures, results, H2H, surface stats, box scores) |
| Historical | Jeff Sackmann tennis_atp + MatchChartingProject (CC BY-NC-SA — internal use only, never serve to paying members) |
| Automation | GitHub Actions cron `*/15 * * * *` |
| Backtest tools | `backtest_elo.py`, `backtest_demo.py`, `demo_matches.csv` (Elo research, internal only) |

---

## Current state snapshot
*As of July 2026*

### ✅ Built and working

- **Today's Matches page** — live odds, match cards, form indicators, tournament filters, player search, day tabs (Today / Tomorrow / Live & Past)
- **Match Analysis modal** — tabs: Key Factors, Playing Style, Form, H2H, Match Stats, Progression, Overview, Tournament, Weather, Odds, Extra Stats
- **Player Profile page** — radar chart (Player DNA), serve/return stat cards, surface performance, recent form, key insights, season win rate chart
- **Tournament Profile page** — built
- **Tournament Reports page** — built
- **Head-to-Head page** — built (known surface filter bug, see below)
- **Playing Styles page** — partially built / placeholder
- **Track Record page** — partially built / placeholder
- **Methodology page** — partially built / placeholder
- **GitHub Actions pipeline** — running every 15 min, health monitoring, email alerts on failure
- **Opening and closing odds preservation** — closing odds survive pipeline rebuilds correctly
- **Live odds** — The Odds API, best-price-across-bookmakers comparison
- **Vig-removed implied win probability** — working
- **H2H record** — via API-Tennis get_H2H, working
- **Surface-specific win rate** — working (filter by `type === 'singles'`, handle `""` as 0 not NaN — bug was found and fixed)
- **Name-matching logic** — between The Odds API and API-Tennis, tested on 4 real player pairs including hyphenated names (Auger-Aliassime, Struff), reasonably solid

### ⚠️ Built but untested / fragile

- **Weather integration** — `fetchMatchWeather` in `bsp-pipeline.js` via Open-Meteo. Built from official docs, never successfully called in production. Coordinates only added for Wimbledon so far in `VENUE_COORDS` object. **Test this before relying on it.** Open-Meteo free tier is non-commercial — check commercial API pricing before scaling.
- **H2H page surface filter** — known bug, surface filter does not work correctly

### ❌ Not started — these are the remaining priorities

1. **Value % scoring methodology** — the `value %` field is `null` everywhere intentionally. This is BSP Consult's actual product differentiator (W/UE ratio, surface form weighting, fatigue scoring). **Do not invent or approximate this — ask Michael for his scoring logic before building it.**
2. **Playing-style classification** — "Aggressive", "Defensive baseliner", etc. No vendor provides this. Needs Michael's category definitions.
3. **Sackmann tennis_atp integration** — historical match results, W/L splits, surface splits, tournament records. Being integrated, not complete.
4. **Sackmann MatchChartingProject integration** — shot-by-shot data, serve/return stats, rally length. Being integrated, not complete.
5. **Subscription / paywall layer** — no auth or paywall logic exists yet
6. **Mobile responsiveness** — not addressed

---

## File structure

```
/
├── bsp-consult-dashboard.html     ← Main frontend (single file, all pages)
├── bsp-pipeline.js                ← Node.js data pipeline (runs on cron)
├── matches.json                   ← Output: today's matches + odds
├── tournament-profiles.json       ← Output: tournament data
├── tournament-progression.json    ← Output: draw/bracket data
├── player-profiles.json           ← Output: player stats cache
├── api-tennis-integration.js      ← Reference: API-Tennis endpoint shapes
├── backtest_elo.py                ← Internal Elo research tool (not production)
├── backtest_demo.py               ← Demo version, tested on 15 matches
├── demo_matches.csv               ← Test data for backtest
└── .github/
    └── workflows/                 ← GitHub Actions pipeline config
```

---

## Architecture rules — follow these on every task

1. **Never fabricate data.** Every stat, number, or chart must come from a confirmed real data source. If a field isn't available, show nothing or flag it — never approximate or invent.
2. **Feasibility before UI.** For any new data field, confirm it exists in the pipeline before writing display code. Flag gaps rather than filling them.
3. **Atomic writes only.** All pipeline output must use temp file + rename pattern — never write directly to live JSON files.
4. **Global fixes over local patches.** If a bug exists in multiple places, fix it at the source, not per-instance.
5. **Scope discipline.** Every task specifies what to keep unchanged — respect those boundaries exactly. Do not refactor, redesign, or touch anything outside the stated scope.
6. **Real data sources only.** Sackmann datasets are flat files, not live APIs — any integration must download, parse, and cache them locally, not query at runtime.
7. **ATP only.** No WTA content anywhere — filter it out at the pipeline level (`tourBadge === 'ATP'`).

---

## Data sources — confirmed status

| Source | What it provides | Status |
|---|---|---|
| api-tennis.com | Fixtures, results, H2H, surface stats, box scores | Live |
| The Odds API | Pre-match odds, Grand Slams / 1000s / 500s | Live |
| OddsAPI | Odds for ATP 250 and broader coverage | Live |
| Oddsapi | Additional odds depending on coverage | Live |
| Open-Meteo | Weather at venue | Built, untested in prod |
| Sackmann tennis_atp | Historical W/L, surface splits, tournament records | Integration in progress |
| Sackmann MatchCharting | Shot-by-shot, serve/return, rally length | Integration in progress |

**License warning — Sackmann datasets:** CC BY-NC-SA (non-commercial). Use for internal model R&D only. Never serve this data or a model trained on it directly to paying members.

**Name matching note:** The Odds API and API-Tennis use different name formats. Current matching is by last name — tested against 4 real pairs. Watch for silent match-merge failures on busy match days.

---

## Design system — never deviate from this

- **Aesthetic:** Dark dashboard, near-black backgrounds, flat surfaces, hairline borders only. No gradients, no shadows, no decorative backgrounds.
- **Style reference:** Linear, Vercel dashboard, Stripe settings pages — confident typography, generous whitespace, clear hierarchy
- **Typography:** Two font weights only — regular and medium (500). Never bold or heavy. Hierarchy through size and weight only, not colour.
- **Case:** Sentence case everywhere — never title case or all caps
- **Spacing:** Generous — data-dense but never cramped
- **Stat display:** Neutral only — never use colour to indicate which player has the better stat
- **Expandable panels:** All must have a visible close/dismiss control
- **Charts:** Preferred over tables for comparison views where possible

---

## Non-negotiables — these are hard rules

- Never show a pipeline health banner or infrastructure warnings to end users
- Never highlight the better stat between two players with colour — neutral display only
- Never show "went the distance (4+ sets)" stat for best-of-three format tournaments
- Recent form calculations always include Challenger and ITF matches — never ATP-only
- All tournament records must reflect full career history, not a truncated date range
- Closing odds must be preserved through pipeline rebuilds — never recomputed at display time
- The Clay surface tag must never render in green (it's orange/terracotta)
- Confidence percentage: no decimals (show 88%, not 88.5%), white colour not orange
- Player names in match lists must never be truncated — use flex-grow layout

---

## Known bugs to fix (in priority order)

1. **H2H surface filter** — does not work correctly on the H2H page
2. **Weather integration** — `fetchMatchWeather` has never successfully run in production, needs live test
3. **Form bars** — confirmed to have had rendering issues on Today's Matches page (check current state before touching)
4. **Filter pills on Match Analysis modal** — should show tournament names with "All surfaces" dropdown, not surface type pills (Clay/Hard/Grass)

---

## How tasks arrive

Michael uploads task documents to Google Drive and shares them. Each document is a self-contained brief specifying:
- What to build or fix
- What not to touch
- Which data source to use
- Any feasibility checks required before writing UI

**Read the task document fully before writing any code. Complete any feasibility checks first and report back before implementing.**

---

## Agent roles

### Claude Code agent (developer)
You write and edit code. You do not design. When a task requires visual judgment, flag it rather than guessing. Your two core files are `bsp-pipeline.js` and `bsp-consult-dashboard.html` — treat them as a production system.

### Claude Design agent (visual/UI)
You produce design direction, annotated mockups, and UI specifications. You do not write implementation code. When Michael sends a task you will receive: a screenshot of the current state, a description of what needs to change, and sometimes a reference design. Your output must be specific enough for Claude Code to implement without guessing.

**Claude Design must never:**
- Suggest fabricated data or placeholder charts — flag data availability gaps instead
- Propose designs requiring new data sources not already confirmed available
- Redesign sections outside the stated task scope

---

## Context on BSP Consult as a business

- 400+ paying members
- Channels: TikTok, Instagram (~22K followers), Telegram, ClickFunnels email list, bspconsult.app
- Affiliate partnership: bet105 (crypto bookmaker)
- Analytical framework: W/UE ratios, first-serve %, surface-specific records, Grand Slam experience differentials, physical fatigue, altitude/court speed conditions
- Focus: ATP 250 and above only
- Preferred players (positive framing): Alcaraz, Musetti, Fils
- Less favourable framing: Zverev
- TikTok compliance: avoid raw sportsbook UI visuals and direct betting terminology in algorithmically surfaced content
