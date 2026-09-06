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

### STANDING DIRECTIVE — design fidelity (founder ruling, 2026-08-02)

**The design is the specification, not a reference.** Michael designs this product in Claude Design; the export **is** what he designed. Your job is to reproduce it — not to interpret it, improve it, or substitute a reasonable equivalent.

1. **When the export and your instinct disagree, the export wins.** This already holds for measurable values; it also holds for anything that "looks fine either way."
2. **No generic-convention defaults.** Component-library styling, framework defaults and general design instinct are all *wrong here by default* — this system has specific rules that differ from convention. When you reach for a sensible standard treatment, that is the signal to stop and read the export instead.
3. **Rebuild rather than restyle.** If a section's structure differs from the export, adjusting colours and spacing on your existing markup will not converge — build the export's structure.
4. **Read values, never infer them.** `computed-styles.json` is authoritative for every measurable value — padding, margin, width, font size and weight, line height, radius, gap, fill alpha, gradient stop, glyph. No rounding. **No number quoted in a prompt — including the founder's — is a source; treat every quoted value as a hypothesis to verify against the export.**
5. **Per-tab specs outrank computed styles inside their scope.** Two exist: `design-export/specs/match-stats-tab-spec.md`, `design-export/specs/form-tab-spec.md`.

The three carve-outs where you still stop and ask are unchanged: **fabricated or absent data, scope with no data-layer counterpart, and product decisions that post-date the export.**

**Do not change** without the audit saying so: anything currently signed off; the half-pixel authored sizes (13.5, 12.5, 11.5, 10.5, 9.5 — real design values, source of the sub-pixel diff floor); the two blue systems (`#3e7bfa` legacy vs `#5b9bff` canonical — **frozen, do not migrate**); the handoff decisions list (removed Summary view, removed H2H trend chart, removed Extra Stats tab, uncomputed match time).

---

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

### Database tab — yield-by-odds-band window & method (TEN-146, founder ruling 2026-09-04)

The Database tab (`build-database-yield.js` → `database-yield.json` + lazy `database-yield-players.json`, rendered in `bsp-consult-dashboard.html`) is built from the Tennis-Data ATP closing-line archive (`odds-archive/*.csv`) under these LOCKED rulings — apply as tests, do not re-litigate:

- **Window: season ≥ 2010, fail-closed, NO pre-window fallback (Option A).** 2004–2008 is a materially different sport; a blended yield across it prices a market that no longer exists. This is a *regime* cut, not a coverage cut. Pre-2010 rows that would otherwise be usable land in the `preWindow` reconciliation bucket. **Test:** `meta.windowStart === 2010`; `meta.dateRange[0] >= '2010-01-01'`; `meta.used === 41667` on the current archive; `meta.exclusions.preWindow === 13659`; and used + all six exclusion buckets (walkover 344 + edge 8 + noResolvingBookPrice 3502 + exactTie 248 + overroundGt115 5 + preWindow 13659) === `meta.archiveRows` 59433 exactly. A build whose date range starts before 2010, or that fills pre-window years with a fallback book, is wrong.
- **Book: Pinnacle closing for every season except 2026; Bet365 for 2026 only (seam-marked, never blended into an unlabelled figure).** Split yields are reported per book. **Test:** page label reads "Pinnacle closing prices, 2010–2026", never "all years"/"2004"; a curve spanning 2026 carries a seam marker + caption; fav/dog yields shown Pinnacle (n=40002) and 2026-Bet365 (n=1665) separately.
- **Fav/dog by price** (shorter price = favourite); **exact ties excluded** (no ranking/positional tiebreak); **overround > 1.15 excluded**; **retirements included, walkovers + edge non-results excluded**; **bands = dynamic equal terciles recomputed inside the active filter** (at the default filter, 41667/3 = 13889 per band, counts identical). **Scope: ATP only, permanently — no WTA toggle.**

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
- **H2H trend chart removed (founder ruling 2026-08-01).** The Match Analysis **H2H tab** does **not** render an `H2H TREND` block (the SVG timeline of every meeting on a shared baseline, its legend, axis labels, `tick height = sets margin` caption and running-lead line). It was removed as a product decision that post-dates the export — the export still renders it. This is the **third** such export-has / product-doesn't divergence, alongside the removed **Extra stats** tab and the removed match-detail **Summary** view. Do **not** rebuild it and do **not** flag it as an H2H gap. The three cards (`OVERALL RECORD`, `ON HARD`, `SETS RECORD`) flow straight into `FULL MATCH HISTORY`. Test: an `H2H TREND` heading or `.ah2h-trend` element anywhere is wrong.
- **Weather "How conditions affect play" cards (founder ruling 2026-08-01).** The three cards — Court pace, Serve advantage, Rally length — each render **one scalar in [0,1]**: the bar fill is the scalar's position and the verdict word is its band, both read from the *same* scalar so the word and the fill can never disagree. The scalar is derived from the forecast (temp / wind / humidity) + surface through the single `WX_IMPACT_MODEL` object; **its thresholds are ratified (founder 2026-08-01) — do not re-tune them without a fresh ruling.** Closed vocab only: Court pace *Faster / Neutral / Slower*; Serve advantage *Elevated / Neutral / Reduced* (never "Server"/"Returner" — those are the pole labels, not verdicts); Rally length *Longer / Neutral / Shorter*. Fill direction: a **fuller** bar = slower court / more server advantage / longer rallies. Colour is muted grey `#5b6880` — **never green/red** (a weather verdict is not a player comparison). Absent forecast → **em dash, no fill** (a missing temperature is not 0 °C). Test: verdict word and fill share one scalar; the word is in the closed set; the bar grows toward slower/server/longer; no green/red anywhere; an absent forecast is an em dash, never a fabricated 0.
- **Key Factors — Stennisfy Model card destination (founder ruling 2026-08-02).** The full-width **Stennisfy Model** card at the foot of the modal's **Key Factors** tab (`akModelBlock`) deep-links to the **top-level Stennisfy Model page for that match** — *"exactly to the stennisfy model."* There is **no** model tab inside the modal, so the card routes out via `openEdgeModelFromMatch(id)`, which **closes the analysis overlay first** (else the page switch hides behind it and reads as a dead click) then calls `openEdgeModel(id)`. The empty/unpriced state links too (the model page carries its own empty state). Card gets a button affordance (hover tint, focus ring, right-aligned `›` chevron). Test: the card is `role="button"`; clicking it closes the modal and lands on the `edge` page/nav for that exact match id — it does not stay static and does not route to Odds.
- **Key Factors — best-soft-book "vs fair" gap (founder ruling 2026-08-02).** In the Stennisfy Model card, the **Pinnacle** box shows its real `edgeVsPinnacle` "±pp vs fair" (same edge that drives the SHARP VALUE / NO VALUE flag). The **Best soft book** box shows **only the real price + bookmaker name; its "vs fair" line is em-dashed (`● —`)**, never a computed pp. Rationale (chosen as the most logical of "keep raw / em-dash"): best odds **can't be de-vigged** — the best price per side can come from different books, and even a single book's price still carries its overround — so `fairP − 1/softPx` would fold the book margin into the "edge", a systematically biased, apples-to-oranges number sitting next to Pinnacle's clean edge. Consistent with the standing "never show a false-precision number" rule. Test: exactly the two Pinnacle boxes carry "pp vs fair"; both soft-book boxes show `● —` while still printing the soft price and book name.
- **Key Factors — tournament tier in the title (founder ruling 2026-08-02).** The Tournament card title (`akTournamentBlock`, `.akt-title`) renders **"City · TIER"** (e.g. `Rotterdam · ATP 500`). The tier is **not** in the feed (`tourBadge` is only "ATP") and there is **no other source** — *"just fix it with what you have."* Derive it locally: prefer the per-draw **`m.venue.category`**, else a lookup in the static **`TOURNAMENT_CATALOG`** by cleaned event name. When neither knows the event, render the **name alone** — never a fabricated tier. Test: a catalogued/venue-tagged event shows `Name · TIER`; an unknown event shows the name with no `·` tier suffix.
- **Player Profile — export parity (founder ruling 2026-08-01).** The Player Profile page (`buildPlayerProfileHtml`) drops three intentional enrichments the export lacks. **(1) No "Surface record" rail card** — the Layer #4A career + rolling-52-week per-surface card is removed; the left rail carries only the **Surface performance** bars. **(2) Recent form is a flat, most-recent-first list** — one row per match, labelled inline with its tournament, **not** grouped under per-tournament headers (tournament grouping stays only in the modal Form tab). **(3) The header archetype line is a single archetype label** (e.g. `All-Court Elite`, or a composed `A / B`) with **no appended "· <surface> Specialist" tag**, coloured **primary text `#e7e9ee`** — never brand blue (Blue rule). These are the **fourth** export-has-not / product-had divergence resolved toward the export, alongside Extra-stats, the Summary view and the H2H trend. Test: the profile rail has no "Surface record" card; Recent form shows no tournament group headers; the archetype line is one label in `#e7e9ee`, not blue and with no Specialist suffix.

- **Records must match Flashscore — count qualifying matches (founder ruling 2026-08-04).** Every surface that shows a win/loss record computed from our api-tennis archive must follow the **same counting rules as Flashscore**: all decided professional singles at any level (ATP + Challenger + ITF) **and any round including qualifying**. Do **not** apply an `event_qualification`/main-draw gate on these surfaces — it made our numbers a strict subset of the public record (Buse 2024 read 36/22 vs Flashscore 47/28; the gap was entirely dropped qualifying + null-flagged rows). Applies to `buildAllTierYearly` (Record-by-season), its drill-down twin `playerMatchHistory`, `seasonSurfaceByTier` (current-season surface record), `recentFormFromFixtures` (which additionally tags qualifying rows `'Q'`), and `fetchPlayerCareerHistory` (Record-by-**tournament** — extended 2026-08-04 after the founder reinforced that *every* record/results surface must share the same Flashscore rules; qualifying rows are tagged `'Q'`, rank -1, so W/L totals grow but bestResult/titles are untouched). Scope note: provider-aggregate stats (career/surface win %) and Tennis-Abstract career splits are separate data sources and are *not* forced to this rule. Separate, unrelated cause: a player's Record-by-**tournament** can still read below the public record when the api-tennis archive is genuinely *missing* older editions (e.g. Zverev's pre-2023 Canada) — a data horizon, not this qualifying filter, and not closed by counting qualifying. Test: for any player on the board, the Record-by-season totals equal Flashscore's per-year Match Record, and their per-tournament W/L includes qualifying rounds; no qualifying/main-draw gate exists in any archive-record builder.
- **Break/Hold heatmap — window 24 months, axis = SIX single-ordinal rows, roster rule Option B, desaturation not a floor (founder GRID RULING 2026-09-02, TEN-107; supersedes the 2026-09-01 3-bucket ruling).** The `holdbreak.json` shard (built by `build-holdbreak.js` from the harvested historical point-by-point in `apitennis-holdbreak-cache/`) rolls up SERVE hold% and RETURN break% over a **24-month** window (not the app's 52-week default — a window does not transfer between measurements), on a **single-ordinal** position axis: **one row per the server's service-game ordinal within the set, `meta.buckets === ['1','2','3','4','5','6']`**, keyed on the *server's service-game ordinal within the set* (never the raw game number, which alternates server), with **ordinal 7+ folded into row `'6'`** (7+ = 2.03% of games, essentially all ordinal 7). The frontend labels the rows by their game-number range (`Game 1-2` … `Game 11-12+`). Columns are set 1/2/3/4/5; surfaces all/hard/clay/grass. hold = `serve_winner === player_served`, break = the complement (so per cell hold% + break% = 100). Source is pbp only — box scores and Tennis-Abstract splits have no game position and cannot build it. Service games are **tiebreak-fixed** (`setKey` returns null for any `/tie/i` set label — a tiebreak is one game both players serve, so its mini-serve rows are dropped, ~18.6% of the raw count). **Roster (Option B):** a player appears iff **numeric key ∧ (rank ≤ 400 OR ≥ 150 tiebreak-fixed service games in the 24M window)** — OR not AND, so a ranked player with thin data still qualifies on rank alone and a well-sampled unranked/low-ranked player qualifies on the count. Rank is read from the frozen `player-profiles.json` (July data; the rank clause can't yet drop fallen players — TEN-135). The shard emits `{pct, n, won}` on every cell and **never drops data** — there is **NO sample floor**; below-threshold cells are handled in the frontend by **desaturation** (colour muted, % + fraction unchanged), a display parameter (`HB_DESAT_N`, currently 20), not a floor and not a founder-locked threshold. GLOBAL (sum of S1..S5) is derived in the frontend and rendered **visually dominant** (wider, heavier, divider) because it survives at every rank tier while the per-set columns thin out for the tail. Test: `holdbreak.json` `meta.windowMonths === 24` and `meta.buckets === ['1','2','3','4','5','6']`; `meta.coverage.serviceGames` equals the sum of `pooled.serve.all[set][ord].n` (conservation); any cell where `serve.hold.pct + return.break.pct` for the same (surface,set,ordinal) ≠ 100 (±0.11) is wrong; any player key that is non-numeric, or rank > 400 with < 150 service games, must be ABSENT; a raw-game-number axis, a 3-bucket early/mid/late axis, a 52-week window, or an emitted sample-floor drop is wrong.
- **A pre-match walkover a player GAVE is NOT a loss (founder ruling 2026-08-04).** *"Yeah a pre-match withdrawal is NOT a loss."* When a player withdraws **before** a match and hands his opponent a walkover, that match counts as **neither a win nor a loss** on every W/L record surface (Flashscore convention, and consistent with Recent Form already showing `w/o` as neutral). The signal is the feed's `event_status === 'Walk Over'` **and** the profiled player being the recorded loser — key on that, **never** on the empty scoreline (a *retirement* the provider stored with no partial score would else be misread). Two distinct, opposite cases must stay correct: a walkover **RECEIVED** (he's the winner) is still a **win**; an **in-match `Retired`** (he quit mid-match) is still a **loss** for the retiree — only the pre-match walkover-*given* is excluded. Shared predicate `isWalkoverGiven(f, won)`; the aggregate record builders (`buildAllTierYearly`, its drill twin `playerMatchHistory`, `seasonSurfaceByTier`, `seasonRowFromFixtures`, `courtSpeedRecordFromFixtures`) **skip** the fixture; `fetchPlayerCareerHistory` (Record-by-**tournament**) **keeps** the row but tags `res:'WD'`, does not add to `lost`, and leaves `_won:false` so it can never become a title while its round still drives the edition finish badge (e.g. Djokovic Paris '11 stays "Quarter-final", 51-10 → 51-9; Wawrinka Rome '13 25-18 → 25-17). Frontend renders `WD` neutral grey with verb `w/o to` — never the red loss colour. Known cache lag: cached opponent profiles rebuild on the `PROFILE_SCHEMA_VERSION` bump (season/surface records) and record-by-tournament on the new `TOURNAMENT_HISTORY_SCHEMA_VERSION` guard, both throttled so corrections roll out over a few runs. **Not yet applied** (flagged to founder, separate decision): H2H record (`get_H2H` may not carry `event_status`, walkover meetings are rare) and the Recent-Form win-%/insights momentum metric. Test: a fixture with `event_status:'Walk Over'` where the player is the loser adds 0 to won and 0 to lost on every record surface; a `Retired` loss still adds 1 to lost; a `Walk Over` win still adds 1 to won; the per-tournament panel shows a neutral grey `W/O` row, never a red `L`.
- **Authoritative fields beat heuristics — a set-count net may never override a main-draw signal (founder ruling TEN-157 / TEN-161, 2026-09-06).** A match's round / qualifying label is derived by a **strict signal hierarchy, highest wins**: **(1) `event_qualification`** (the feed's `'True'`/`'False'`/`null` *string* — see `bsp-pipeline.js`) and **(2) the round label itself** — the `1/N-finals` fraction form (`1/32-finals`, `1/16-finals`, `1/8-finals`, …) or its word form (`Round of 64`, `Quarter-finals`) — are **authoritative**. A **set-count net** — any heuristic that infers "qualifying" from a best-of-3-vs-best-of-5 set count (the Slam-qualifying-leak class of detector) — is a **last-resort *tertiary* signal**: it may only *fill* a label when BOTH authoritative signals are absent or genuinely ambiguous, and it may **never override an authoritative main-draw signal.** A fixture whose `event_qualification !== 'True'` carrying a main-draw round label is main draw, full stop, however few sets it went. This is the TEN-157 bug: a US Open **second-round main-draw** win (R64 / `1/32-finals`, `event_qualification: 'False'`) was stamped **`'Q'`** because the set-count net fired on a short/straight-sets result and outranked the authoritative fields. **Guarded by the P3 regression harness (TEN-160)**, which encodes the ruling as cases: in-play 2-1 main-draw R64 → not `Q`; settled 3-1 → R64; genuine qualifying row (`event_qualification === 'True'`) → `Q`; Slam retirement at 2 sets → main draw. Test: no code path assigns a qualifying / `'Q'` label to a fixture whose `event_qualification` is not `'True'` while a main-draw round label is present; the set-count net is reachable only after both authoritative signals are missing; a main-draw match that ended in 2 or 3 sets (retirement, walkover, or straight sets) keeps its main-draw round, never `'Q'`.
- **Live feed — interruptions STAY, retirements clear fast (founder ruling 2026-09-03, TEN-107).** *"The interruptions we had due to rain — the matches should just stay there in the live feed and not disappear; and retirements, like the Moutet game, should disappear from the live feed — it took a couple of hours, it shouldn't take so long."* Two cases, opposite handling, and **never a wall-clock timeout** (a timeout would wrongly drop rain-suspended matches). **(1) Rain-suspended** (`event_status` ∈ `Interrupted`/`Suspended`) → the card **stays** on the board, `interrupted=true`, `live=false`, partial score refreshed; it is never dropped and never given a winner. **(2) Retirement / terminal** (`Retired`/`Walk Over`/`Finished`) → the card must clear within **one 10-min `refresh-scores.py` cycle**, not hours. Root cause of the lag was a timezone join miss: a board card's `date` comes from the odds feed's `commence_time` in **UTC**, while the api-tennis fixture's `event_date` is **account-local** — a late-evening match lands one calendar day apart, so the exact-key `(date, {p1Key,p2Key})` join missed and the terminal flag was never stamped. Fix: `refresh-scores.py` widens its fixture fetch by **±1 day** and, on an exact-key miss, falls back to the adjacent day for the **same unordered player pair** (preferring an actionable — finished/interrupted/live — fixture, tie-broken by start-time proximity). **Guard A:** a terminal `event_status` beats a lagging `event_live='1'` in **both** `refresh-scores.py` and `bsp-pipeline.js` (`match.live = event_live==='1' && !['Finished','Retired','Walk Over'].includes(event_status)`) so a decided match never renders as a phantom LIVE card. Regression test: `test_retirement_clear.py` (retirement joined across a ±1-day skew and cleared; rain-Suspended stays with `interrupted=true`; Guard A holds; no card silently dropped). **Duplicate guard:** the board's tour+surname dedup passes are defeated when the two feeds render a match differently (un-aliased tour label, initials-only names) — that is how a match survived as TWO cards (one stranded-live odds card, one completed api-tennis twin). `bsp-pipeline.js` runs a final `dedupeByPlayerKeyPair(matches)` pass keyed on the unordered **numeric api-tennis player-key pair** (identical across both feeds, unlike surnames) within a **2-day** window, keeping the richest card (finalScore > interrupted > live > has-odds > fixture-only); two distinct ATP singles matches cannot share a player pair within 2 days, so only true duplicates are removed (`test_dedup_guard.js`). Test: an `Interrupted`/`Suspended` fixture keeps its card with `interrupted=true`/`live=false`; a `Retired` fixture dated ±1 day off the card is stamped `retired=true`/`live=false` in one refresh; no elapsed-time cutoff drops any live/underway card; no two cards ever share the same `{p1Key,p2Key}` pair within a 2-day window.

---

## Non-negotiables — these are hard rules

- Never show a pipeline health banner or infrastructure warnings to end users
- Never highlight the better stat between two players with colour — neutral display only
- Never show "went the distance (4+ sets)" stat for best-of-three format tournaments
- Recent form calculations always include Challenger and ITF matches — never ATP-only
- All tournament records must reflect full career history, not a truncated date range
- Closing odds must be preserved through pipeline rebuilds — never recomputed at display time
- Opening AND closing odds for a completed match are ALWAYS the bet365 stream (founder ruling TEN-124, 2026-09-02: bet365 is the most trustable soft book). Both legs pin to bet365 — a single-book journey, never cross-book. If bet365 is absent for a completed match, dash the journey; never substitute another book.
- A closing odd requires a PROVEN pre-first-ball reference (real startTs, or an in-play onset detected off bet365's own tick burst). No proof → dash. Nothing after a match's original first ball counts (a suspension/restart must not move the open→close journey). Missing close is a dash, never a substitute or in-play price.
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
