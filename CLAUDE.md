# BSP Consult — Tennis Dashboard Project

Read this whole file before doing anything. It's the full context from a long
planning conversation with the project owner (Michael, who runs BSP Consult,
a tennis betting analysis business). He has no developer — you are it.

## The one rule that matters most

**Never fabricate data.** Every number shown in the dashboard must be either
(a) real, from a tested API response, or (b) honestly labeled "coming soon."
This was enforced repeatedly during planning — a fake Track Record tab and an
invented match were both caught and removed. Keep this standard. If you can't
get real data for something, show an honest "not connected yet" state instead
of a placeholder number.

## What this business is

BSP Consult is a real, existing tennis betting analysis service (400+ paying
members via TikTok/Instagram/Telegram). This project is a NEW subscription
dashboard product, structurally similar to a competitor (matchup-tennis.fr)
but with BSP Consult's own branding, data, and methodology — never their
copyrighted content, never their locked/paid data.

## API keys the user has (get these from him, don't hardcode in committed files)

- **The Odds API** key: works, free tier, EU region odds tested and confirmed live
- **API-Tennis.com** key: works, trial tier, confirmed live for fixtures/H2H/player stats
- Ask him for both keys and put them in a `.env` file (already referenced in
  `bsp-pipeline.js` via `process.env`). Never commit `.env` to git.

## Files in this folder

- `bsp-consult-dashboard.html` — production dashboard. Fetches live from
  `./matches.json`. **Must be served via a real HTTP server** (`python3 -m
  http.server`, `npx serve`, or similar) — opening it via `file://` will
  always fail due to browser CORS rules. This is expected, not a bug.
- `bsp-consult-dashboard-preview.html` — same UI but with data embedded
  directly, works via plain double-click. Good for quick visual checks only.
- `bsp-consult-website.html` — marketing landing page. **OUT OF DATE**: still
  says "value bets" and shows a fake mockup from before the pivot to an
  honest odds-only product. Needs a copy/content update to match reality.
- `bsp-pipeline.js` — the real data pipeline. Pulls odds from The Odds API,
  merges with API-Tennis.com data (H2H, surface win rates, rank, tournament
  round, and now Open-Meteo weather), matched by player last name across
  APIs. Outputs `matches.json` in the shape the dashboard expects.
  **This has been tested piece-by-piece against real API responses during
  planning, but has never been run as a complete script end-to-end** — your
  first job is to actually run it and fix whatever breaks.
- `api-tennis-integration.js` — standalone reference for the API-Tennis
  endpoints (already merged into bsp-pipeline.js, kept for reference).
- `matches.json` — currently contains 3 REAL matches from July 7, 2026
  (Lehecka/Zverev, Auger-Aliassime/Djokovic, Sinner/Struff) with real odds,
  H2H, and surface stats manually verified during planning. This is a
  snapshot, not live — running the pipeline will regenerate it with
  whatever's actually happening when you run it.
- `backtest_elo.py` / `backtest_demo.py` / `demo_matches.csv` — Elo rating
  research tool for Jeff Sackmann's tennis_atp dataset (github.com/
  JeffSackmann/tennis_atp). **LICENSE WARNING: that dataset is CC BY-NC-SA
  (non-commercial only)**. Use it only for internal model R&D — never serve
  it or a model trained on it to paying members. `backtest_demo.py` has
  been run and confirmed working on 15 real matches; `backtest_elo.py` is
  the full version for the real dataset, untested at scale.

## What's real vs. still missing (as of end of planning)

**Real and working:**
- Live odds (The Odds API), best-price-across-bookmakers comparison
- Vig-removed implied win probability
- H2H record (via API-Tennis get_H2H)
- Surface-specific win rate, singles only (bug was found and fixed: the raw
  API mixes doubles/mixed_doubles into the same stats array — filter by
  `type === 'singles'`, and handle `""` empty-string values as 0, not NaN)
- Tournament round, current rank

**Wired in code but UNTESTED live:**
- Open-Meteo weather integration (`fetchMatchWeather` in bsp-pipeline.js) —
  built from their official docs, never actually called successfully (their
  site blocks automated fetches from the environment used during planning).
  Coordinates only added for Wimbledon so far (`VENUE_COORDS` object) — add
  more venues as needed. **Test this first thing**, it's the newest, least
  proven piece.
- Note: Open-Meteo's free tier is for non-commercial use; the data itself is
  CC BY 4.0. Check their commercial API pricing before high-volume production
  use.

**Not started at all — this is BSP Consult's actual product differentiator:**
- The scoring methodology (W/UE-equivalent, surface form weighting, fatigue)
  that would populate the `value %` field. This is deliberately left `null`
  everywhere rather than faked. Building this requires Michael's own
  expertise/decisions about what factors matter — don't invent it yourself,
  ask him.
- Playing-style classification (e.g. "Aggressive" vs "Defensive baseliner").
  No vendor sells this. Same deal — needs his input on categories.
- The name-matching logic between The Odds API and API-Tennis (matches by
  last name) has been tested against 4 real player pairs across 2 different
  days with no failures, including hyphenated names (Auger-Aliassime,
  Jan-Lennard Struff) — reasonably solid, but not exhaustively tested against
  a really busy match day. Watch for silent match-merge failures.

## Your step-by-step plan

1. **Get both API keys from Michael**, create a `.env` file:
   ```
   ODDS_API_KEY=...
   API_TENNIS_KEY=...
   ```
2. **Run `node bsp-pipeline.js`** (needs `npm install dotenv` first). Fix
   whatever breaks — this has never been run as a complete script before.
3. **Test the Open-Meteo integration specifically** — it's the least proven
   part. Confirm it returns sane temperature/wind/humidity numbers for a real
   match.
4. **Serve the dashboard properly**: put `matches.json` next to
   `bsp-consult-dashboard.html`, serve both via a real HTTP server, confirm
   it loads real data (green "Live" status, not the red error).
5. **Set up a scheduled run** (cron, or whatever's simplest for how Michael
   wants to host this) so `matches.json` refreshes automatically — right now
   nothing regenerates it on its own.
6. **Fix the landing page** (`bsp-consult-website.html`) to match the honest
   odds-only product instead of the old fake "value bets" messaging.
7. **Talk to Michael** about the scoring methodology and playing-style
   categories before building either — these are business decisions, not
   engineering ones.
8. Once steps 1-6 are solid, help him figure out actual deployment (hosting,
   domain, etc.) if he wants this properly live for members.

## Things to NOT do

- Don't fabricate any stat, ever, even temporarily "to make it look nice" —
  ask Michael or leave it honestly blank.
- Don't use the Sackmann dataset for anything customer-facing.
- Don't copy matchup-tennis.fr's actual copy, images, or locked content —
  UI/layout inspiration is fine, their content is not.
- Don't commit API keys to git.
