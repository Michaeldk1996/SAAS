# CLAUDE.md — Stennisfy
## Agent briefing — read this fully before touching any file

---

## What this project is

Stennisfy is a tennis betting analytics SaaS dashboard for serious ATP bettors. It tracks matches across Grand Slams, ATP 1000s, 500s, 250s, Challengers, and ITF. Members use it daily to analyse matches, odds, and player data for betting decisions.

**Product brand:** **Stennisfy** — this is the name rendered throughout the UI. The design export build contains zero rendered "BSP" strings (verified). BSP Consult is the *business* behind the product. "BSP" is deliberately retained in the source folder name, archived backups, the mobile prototype, the Login-options exploration, the Funnel wordmark and the handoff docs — **do not rename those**; they are intentional, not stragglers.

**Owner:** Michael (BSP Consult, the business) — Belgian, francophone, digital nomad  
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
| Historical | Jeff Sackmann tennis_atp + MatchChartingProject (CC BY-NC-SA — internal R&D use; commercial serving to paying members gated until a commercially-licensed alternative — see **Model R&D mode** below) |
| Automation | GitHub Actions cron `*/15 * * * *` |
| Backtest tools | `backtest_elo.py`, `backtest_demo.py`, `demo_matches.csv` (Elo research, internal only) |

---

## Current state snapshot
*As of July 2026*

### ✅ Built and working

- **Today's Matches page** — live odds, match cards, form indicators, tournament filters, player search, day tabs (Today / Tomorrow / Live & Past)
- **Match Analysis modal** — eleven tabs, in rail order: Key factors, News, Playing style, Form, H2H, Match Stats, Progression, Overview, Tournament, Weather, Odds. (The former "Extra stats" tab was removed from the build; News was added. Verified against the rendered modal, `design-export/computed-styles.json` state `modal-news`, 2026-07-31.)
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

1. **Value % scoring methodology — UNRESOLVED (this doc vs `design-export/README.md`; do not resolve without Michael).** Two different things wear one name:
   - *This doc's position:* the proprietary `value %` (W/UE ratio, surface form weighting, fatigue scoring) is Stennisfy's real differentiator, is `null` everywhere in the data, and must not be invented or approximated — ask Michael for the scoring logic before building it.
   - *The export's position:* the design already renders a value verdict ("SHARP VALUE" / "NO VALUE") derived from a **no-vig best-price margin** (`ppGap = (1/fair − 1/price) × 100`); the README flags the soft-book price inputs behind it as authored placeholders under "Known gaps".
   - These are not the same feature: a no-vig price-margin verdict (built, placeholder inputs) vs a proprietary W/UE model score (not built). Do **not** wire the proprietary methodology behind the rendered verdict, or ship the placeholder inputs as if they were the model, until Michael confirms which is intended.
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

**Model R&D mode (founder decision, TEN-8, 2026-07-26):** The h2h-model — including every Stage-2 adjustment layer (e.g. Layer #4 surface record) and the Layer #8 MCP archetype baseline — is being built and run in **internal research & development mode**. The CC BY-NC-SA non-commercial restriction is a gate on **commercial serving to paying members**, not on internal R&D. Do **not** flag the non-commercial data licence as a blocker for R&D builds — activate and iterate. The licence gate re-engages only when we move to **commercial deployment with paying members**, at which point a commercially-licensed alternative (or clean-room Stage-1-only fair price) is required before serving. Flag licensing then, not now.

**License warning — Sackmann datasets:** CC BY-NC-SA (non-commercial). Internal model R&D use is permitted (see **Model R&D mode** above). Do not serve this data, or a model trained on it directly, to **paying members** once the product is commercially deployed — revisit for a commercially-licensed alternative before commercial launch.

**License warning — Layer #8 W/UE MCP archetype baseline (`mcp-archetype-baseline.json`):** derived from the Match Charting Project (CC BY-NC-SA, non-commercial). Same rule as the model weights above — **internal R&D use is permitted** (see **Model R&D mode**); it seeds the W/UE-ratio expectation per archetype but must NOT be served commercially to paying members until we have a commercially-licensed alternative. Founder decisions (TEN-8, 2026-07-25; R&D-mode clarification 2026-07-26).

**Name matching note:** The Odds API and API-Tennis use different name formats. Current matching is by last name — tested against 4 real pairs. Watch for silent match-merge failures on busy match days.

---

## Design system — the export is canonical

**Canonical source of truth:** the Framer design export under `design-export/` **is** the design. Read exact values from `design-export/computed-styles.json` (every element, every state — 30 page-states), the raw token set from `design-export/tokens-observed.json`, and the readable token set from `design-export/tokens-design.json`. The narrative reference is `design-export/README.md`. **Where this doc and the export disagree on anything measurable, the export wins** — on rules, scope and reasoning, the README wins. (This section was corrected on 2026-07-31 after CLAUDE.md was found describing a different product than the export; report any remaining conflict rather than guessing.)

**Per-tab dev specs sit above the export within their scope (founder handoff, 2026-08-01).** Where a tab has a dedicated handoff spec — `design-export/specs/match-stats-tab-spec.md`, `design-export/specs/form-tab-spec.md`, and any that follow, one per tab — that spec is **authoritative for that tab**: read exact values from the spec, and fall back to `computed-styles.json` for the tab's own page-state only where the spec is silent. Outside a tab that has its own spec, the export rules (as above). On a spec-vs-export conflict inside a tab's scope, the spec wins — note the divergence in your report and proceed.

- **Aesthetic:** Dark dashboard, near-black backgrounds (#06070a / #0a0d14), hairline borders (rgba(255,255,255,0.06–0.09)). Surfaces are mostly flat — but the build uses gradients, one shadow, and tinted washes **deliberately**. Do not strip them:
  - **Gradients** (present, correct): the Recent Form bar (`--brand-deep → --brand`); identity-tinted cards on the Tournament / Overview / Form tabs (`hexA(identity, 0.16) → --card`); the Completed-match odds-journey line (`--muted → brand blue`); the logo mark; the court-speed slider track.
  - **Shadow** (present, correct): the Match Analysis modal card — `box-shadow: 0 40px 120px rgba(0,0,0,0.6)`. This is the **only** elevation shadow in the build; everything else stays flat.
  - **Tinted washes** (present, correct): `--brand-wash` rgba(91,155,255,0.08), `--brand-tint` rgba(91,155,255,0.15), `--pos-bg` / `--neg-bg` value tiles, day-card fills. These are surface tints carrying meaning, not decoration — keep them.
- **Style reference:** Linear, Vercel dashboard, Stripe settings pages — confident typography, generous whitespace, clear hierarchy
- **Typography:** Five font weights are used, as built: 400 (regular, the bulk of text), 500, 600, 700, and 800 (headings, active pills, large mono figures). The export is canonical here — 600/700/800 across 7,500+ elements is the design, not a violation. Hierarchy comes from size and weight, not hue. (Verified against `design-export/tokens-observed.json`, 2026-07-31.)
- **Case:** Sentence case for prose, headings, body copy and nav. **All-caps is used deliberately** for utility/mono labels — section eyebrows, stat labels, date-group headers and meta ("STAT COMPARISON", "MATCH TIME", "OPEN / CLOSE", "30 JUL 2026", "n OF 17 VALUE LAYERS ACTIVE"), typically letterspaced mono. Never title case. Sentence case for content, caps for mono/utility labels — match the export.
- **Colour semantics — hue carries meaning, tone carries hierarchy.** Text hierarchy is built from grey tone-levels (`--text` #e7e9ee → `--muted` #5b6880 → `--muted-2` #4b5672 → body prose), never from hue. Hue is reserved for meaning: brand blue #5b9bff for interactive/identity, green #3dd68c / red #e0616f for value verdicts and data-quality, clay #e8a84e for the clay surface, per-player identity tints for *who* a player is. This is why "hierarchy through weight/size, not colour" and the graded grey text system agree — greys are tone, not hue.
- **Spacing:** Generous — data-dense but never cramped
- **Stat display:** Never use hue to indicate *who leads or won* between two players — head-to-head comparison stats stay neutral. (Single-player threshold colouring against a baseline, and value/data-quality verdicts, are a different axis and do use hue — see colour semantics above.) *Exception inline (Match Stats tab only, founder ruling 2026-08-01, narrowed 2026-08-01):* on the Match Stats tab, **tone — not hue — may mark outcome in the point-log game/tiebreak scores only** (winner `#e7e9ee` / other `#4b5672`) — grey tone-levels signalling outcome, permitted because *hue carries meaning, tone carries hierarchy* (line above). **The score-header names are NOT an outcome mark: both names are `#e7e9ee`, winner and loser alike** — the earlier winner `#e7e9ee` / loser `#5b6880` dim was reversed by founder ruling (the render never dimmed the loser). Outcome on the score header rides on the score panel itself (sets/per-set line), never on the two names. **Identity hue is unaffected:** player A stays `#6aaeff` and player B `#e7e9ee` by name order in the legend, values and bar fills, regardless of who won. Test: the two score-header names are always the same tone (`#e7e9ee`); the only permitted tone-marked outcome is the point-log game/tiebreak score; a player's identity blue/white must never change with the result.
- **Expandable panels:** All must have a visible close/dismiss control
- **Charts:** Preferred over tables for comparison views where possible

---

## Rulings ledger — apply these as tests

**Standing process (founder ruling, 2026-08-01).** Every ruling the founder gives is written into *this file* as a rule the **same day** it is given — not only applied to the tab in front of you and logged in BUILD-NOTES. CLAUDE.md loads automatically every session; a ruling that lives only in a chat has to be re-asked next time. When you record one:

- **State it as a test someone can apply, not a prohibition.** Prohibitions generate edge-case questions; tests resolve them. Model: *"blue answers whose number this is, never whether the number is good"* beats *"never use blue on a performance value"* — the second one made us litigate whether an ace counts as performance.
- **List exceptions inline with the rule**, not in a separate section, so nobody applies a rule without seeing its carve-outs.

### Default resolution rule (founder ruling, 2026-08-01)

When the export and a documented rule disagree on anything **measurable — spacing, colour, weight, radius, anatomy, layout, ordering — the export wins and you proceed.** Note the divergence in your report so it stays visible, but do **not** hold work waiting on a ruling. (This replaces the old "flag both and never pick." Flagging still happens; waiting does not.)

**Three carve-outs where you still stop and ask, because the export cannot settle them:**

1. **Fabricated or absent data.** If a value isn't in the source, no export mock justifies inventing one. Em dash and report.
2. **Scope.** If the export shows a section, control or binding with no counterpart in the build's data layer, report before building it.
3. **Product decisions that post-date the export.** The export is a snapshot; some things were deliberately added or removed after it. Before you delete something *because the export lacks it*, ask first.

### Rulings — each is a test

- **Blue.** Blue (`--brand #5b9bff`) answers *whose* number this is — interactive control or player/tournament identity — never *whether* the number is good. Test: if the blue is signalling quality/performance, it's wrong; recolour or neutralise. *Exception inline:* the legacy blue `#3e7bfa` (`--accent`, `--mx-brand-blue`) is frozen — do not migrate it to `--brand` piecemeal, only on explicit founder go-ahead. (The archetype dominance / matchup-edge bars are **not** a blue exception — those are a directional edge and take green/red; see below and [[ten8-playing-styles-export-colors]].)
- **Green / red.** Green (`#3dd68c`) / red (`#e0616f`) answer **"is this value trustworthy"** or **"which direction did this move"** — **never "which player is better."** Direction is permitted only where the thing being measured is *itself* directional: an odds-movement delta, a matchup edge, a drift. A count or rate placed beside another player's count or rate is a **comparison**, and comparisons take identity colour or neutral, never green/red (so H2H comparison stats stay neutral). Test: is the colour answering trustworthy-or-direction, or is it ranking two players? If it ranks players, it's wrong — neutralise. *Exceptions inline — canonical tokens `#3dd68c`/`#e0616f` only, on canonical values only:* (a) Playing Styles **matchup edge and dominance** (grid + bars — the page's subject is strong-vs-weak and the edge is itself directional); (b) **Odds-tab movement deltas**; (c) **LOST SERVE and BP markers**; (d) the Clay surface tag never renders green — it is orange/terracotta. The former app-wide near-miss hues `#3ECF8E`/`#E8607A` are **retired** — migrated to the canonical tokens in commit `f497400` (67 sites across dashboard, funnel, verify). If either near-miss hex reappears in a UI file, it's wrong.
- **Modal tab rail.** The Match Analysis modal has **exactly eleven tabs** and **News is second**. Rail order: Key factors, News, Playing style, Form, H2H, Match Stats, Progression, Overview, Tournament, Weather, Odds. Test: count = 11 and position 2 = News; if not, it's wrong.
- **Overview tab — identity vs outcome (founder ruling 2026-08-01).** Two distinct axes coexist on the Overview modal tab. **(1) Identity by name order:** the career-card surface bars, the `THIS SEASON · BY SURFACE` row left-accent, and the nested match-stats block's left name carry *whose column this is* — left player (P1) blue `#6aaeff`, right (P2) neutral `#e7e9ee`, fixed by name order, **never** by clay/hard/grass and never by value. (Reverses the earlier "career bars all-neutral / accent surface-family-blue" calls.) **(2) Outcome as a data fact:** the `W`/`L` result letter in the surface drill-down and match lists is coloured by outcome — canonical W `#3dd68c` / L `#e0616f` — and a `ret.` suffix carries the loss red (`w/o` stays neutral). A completed match's result is a data-fact verdict, not a two-player comparison, so it is a permitted green/red exception alongside LOST SERVE/BP markers (reverses the earlier "W/L neutral in modal" call). Test: surface bars/accents/left-name never change hue with the *value* (identity only); the W/L letter never stays neutral on a completed match.
- **Nested Match Stats block (Overview drill) is tertiary.** The shared `.aform-*` form panel, when it appears inside a match-row drill inside the Overview career card (`.yr-drill` scope), reads one step **smaller** than the Form tab / Player Profile (which are primary surfaces and keep full size). Its active view chip is **flat** — segmented-control standard `rgba(91,155,255,0.22)` fill + `#e7e9ee` text, **never** the solid `#3E7BFA` fill (reserved product-wide to Login-primary / Verify). Test: the Overview nested block is visibly smaller than the standalone Match Stats tab and its active chip carries no solid bright fill.
- **Strong text (`--sf-text-strong: #fff`, founder ruling 2026-08-01).** `#fff` is the **brightest text tier**, reserved for **active-state accents** — the label of an active segmented-control pill on a brand-tint fill, and similar selected-state controls. Body/label text stays `#e7e9ee` (`--sf-text`). **Test: if it's the *selected state* of a control, it's `#fff`; everything else is `#e7e9ee`.** The export settles the pill case: the active `span.seg` leaf computes `rgb(255,255,255)`/700 on the tinted fill in both matches-upcoming and matches-completed states, while the inactive sibling stays `#5b6880` — a deliberate accent, not a `#e7e9ee` artifact. **Token, not migration:** a sweep found **786 raw `#fff` occurrences** in the export — an unnamed brightest tier the palette never documented. Do **not** migrate those 786 sites; the token `--sf-text-strong: #fff` is defined (dashboard `:root`) so **new work** references the token instead of a raw hex. (Superseded the placeholder name `--active-pill-text`.)
- **Font weight.** A weight is valid iff it is one of **{400, 500, 600, 700, 800}**. Test: any other weight is wrong. Heavy use of 600/700/800 is the design (verified against `tokens-observed.json`), not a violation — do not "tone it down".
- **Gradients, shadows, tinted washes.** These are permitted **exactly where the export uses one** — apply where the export element carries it, remove only where the export element doesn't. Test: does the corresponding export element carry the gradient/shadow/wash? Match it. *Exception inline:* the only elevation shadow in the build is the Match Analysis modal card (`box-shadow: 0 40px 120px rgba(0,0,0,0.6)`); every other surface stays flat.
- **Em dash vs zero.** A field with no value renders an em dash **"—"**, never `0`; a field whose value is genuinely zero renders **`0`**, never an em dash. Test: is the value absent or is it really zero? They are never interchangeable, on any surface.
- **One container per content block.** Each content block is wrapped in **exactly one** container — no nested duplicate card/panel/border wrappers around the same block. Test: strip to a single enclosing container per block; if a block sits inside two cards, collapse to one.
- **Empty states fabricate nothing.** An empty state shows only what the data actually is — an em dash, a "no data"/"not measured" label, or nothing — it never invents, approximates, back-fills, or falls back to a placeholder number. Test: every value in the empty state must trace to real source data; if it can't, it must be an em dash or an explicit unavailable label.
- **Match-detail view toggle — no Summary view (founder ruling / form-tab-spec §4, 2026-08-01).** Every nested match-detail instance — the standalone modal **Match Stats** tab, and the expanded-row detail inside **Form**, **H2H** and the **Overview** career drill — offers exactly two views: **Stats** and **Point by point**. The **Summary view is removed product-wide**; the API carries no match-duration data, which was its only unique content. Test: a match-detail view toggle shows *Stats | Point by point* and nothing else — a Summary button anywhere is wrong.
- **Weather "How conditions affect play" cards (founder ruling 2026-08-01).** The three cards — Court pace, Serve advantage, Rally length — each render **one scalar in [0,1]**: the bar fill is the scalar's position and the verdict word is its band, both read from the *same* scalar so the word and the fill can never disagree. The scalar is derived from the forecast (temp / wind / humidity) + surface through the single `WX_IMPACT_MODEL` object; **its thresholds are ratified (founder 2026-08-01) — do not re-tune them without a fresh ruling.** Closed vocab only: Court pace *Faster / Neutral / Slower*; Serve advantage *Elevated / Neutral / Reduced* (never "Server"/"Returner" — those are the pole labels, not verdicts); Rally length *Longer / Neutral / Shorter*. Fill direction: a **fuller** bar = slower court / more server advantage / longer rallies. Colour is muted grey `#5b6880` — **never green/red** (a weather verdict is not a player comparison). Absent forecast → **em dash, no fill** (a missing temperature is not 0 °C). Test: verdict word and fill share one scalar; the word is in the closed set; the bar grows toward slower/server/longer; no green/red anywhere; an absent forecast is an em dash, never a fabricated 0.

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
