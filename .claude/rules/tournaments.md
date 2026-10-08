# Tournaments page — header, Overview, overlays, Entry list (founder step 7, TEN-401, 2026-10-08)

Applies to `renderTournamentsTab`, the Overview (`tourx*`) and `window.EntryListsTab` in `bsp-consult-dashboard.html`.
Reports has its own file: `.claude/rules/tournament-reports.md`. Reference = `OFFICIAL VERSION 1.html` → Tournaments,
night, 1512px; the reference wins except where a rule below says *(override)*. The Sep handoff
`design_handoff_tournaments/README.md` (TEN-242 zip, not committed) still holds structure, state and data shapes; its
colours are superseded by `foundation.md`. Reviews are night only; day tokens stay wired.

## Data
- **ROI cards and Favourite reliability come from `tournament-market.json`, built from `database-yield.json` rows** — the
  Database page's own rows (Pinnacle closing, else Bet365, per match; favourite = shorter price). Card = the Database →
  Tournament All row for the same event. No speed-derived formula (`roiFav = (speed − 1) × 8 − 2` …) exists anywhere.
  **Test:** the card's yields equal the Database All row (Wimbledon +0.30 / −11.96, n 1,949; `test-ten242-rulings.mjs`).
- **Yield colour = sign** (founder card c572b773, 2026-10-08): `--pos` above zero / `--neg` below, `--text-label` when
  within 1pp of the tour — never the gap to the tour (Madrid underdogs −4.4% vs tour −7.0 is red). **Test:**
  `test-ten242-rulings.mjs` "by SIGN". No join → grey `—`, and the card says "No closing prices joined to this event in
  our archive.", not "not enough matches". Hamburg includes "German Tennis Championships" (2016–20) and "European Open" clay (2021–24).
- **Shared archive strings are split by row** (founder card c572b773 "canada = split", + review fix): `build-tournament-market.js`
  `ROW_SPLIT` pools "Rogers Masters" / "Canadian Open" by the men's host year (to 2019 Toronto even / Montreal odd; from
  2021 Toronto odd / Montreal even — every edition 2010–26 checked against the Wikipedia infobox; 2020 not held, 0
  unplaced), "Masters Cup" = Turin 2021+ only, and "European Open" by surface (clay = Hamburg's July editions 2021–24,
  hard = Antwerp). Each split event emits `archiveFilter`; the ROI panel locks to those rows (`DatabaseTab`
  `initialTournamentFilter` → `rowLockFor` / `rowLockOk`, dropped on any new pick); Match analysis never joins career rows
  on a split string (`trArchiveNames`). Measured: Montreal 460 + Toronto 446 = Canada 906; Turin 73; Hamburg 565
  (−4.8 / +4.6); Antwerp 260. **Test:** `test-ten242-rulings.mjs` "row lock" (runs the panel's functions against a
  fixed host-city table) + the card-equals-panel recompute.
- **One court-speed registry** (`tourxConditionRegistry()`) feeds the rail, hero, rank / median and Compare all.
  *Known limit:* the page's `COURT_CONDITIONS` is a hand copy of the pipeline's table, held identical by a drift test.
- **What players say = real, traceable notes only** (speaker matched to one of our players + a year); an event with none
  shows no card. `TOURX_QUOTE_RULE` flips it. No placeholder quote ships.
- **An unsourced metric is `—`, never 0.**

## Header + tabs
- Header card = the Today's Matches pattern: caps line, "Tournaments" 29/800, sub 13.5 `--text-soft`; mono stats
  Events · This week · Updated (= `tournament-progression.json` fetchedAt) **only when all three compute from live data**, otherwise none (`TOURX_HEAD_STATS`).
- **"This week" is one set of events** (founder TEN-401 r1 fix 4 + review): `tourxThisWeekEvents()` = every Entry-list
  shard row (ATP tour, all levels) in the current ISO week ∪ the registry's in-play events (the rail's This-week group:
  on the match feed, dropped 24h after their final), de-duplicated on city. The header stat, the Entry list eyebrow's
  events, the current week's chip and "lists loaded" (the members with a list, so lists ≤ events) all count it; the
  eyebrow never follows the selected chip. The page loads the shards for it (`EntryListsTab.load()`, no render).
  **Test:** `test-ten401-b.mjs` r1.4 (synthetic + the real shards at 8 Oct and 13 Oct).
- **Every segmented control is the darker track** (`sfSegHtml`): track `--card` + 1px `--edge-6`, selected `--inner` +
  1px `--edge-10` white 700, idle `--text-label`, no hover change. No blue fill or border. **Test:** `test-ten401-b.mjs`.

## Overview
- Rail = panel (`--card` + `--edge-6`); search `--inner`, no edge; group heads Hanken 10.5 caps grey; **selected row =
  `--selected` + inset 16% ring**, no surface wash; tier chip `--inner`, grey, no edge.
- **Court-speed hero *(override)*:** 8px `--track`, no gradient, white 16px knob with a 3px `--card` ring; Slow / Medium /
  Fast Hanken 10.5 caps grey; band word white; "Compare all →", "Read all N →", "Open … graphics →" are `--link`.
- Condition tiles + Favourite reliability = panels (`--edge-6`), figures mono white; reliability bar `--bar` on `--track`.
  "Completed" badge `--inner`, grey caps, no edge. ROI cards = clickable tiles (`--edge-7`, hover `--tile-hover` +
  `--edge-16`). "View tournament report →" = `--inner` button, white, `--edge-10` on hover.
- Seven-year chart: no area fill, white 2.4px line, white dots with a `--card` ring, values white mono, years grey.
- **Test:** `test-ten242-rulings.mjs` (TEN-401 blocks: rail, scale, blocks, chart).

## Overlays (Compare all · What players say · ROI)
- Pop-up sheet `--card` + 1px `--edge-10`, `--shadow-modal`, over `--backdrop` + blur covering the content area only;
  close button `--inner`; Esc, outside click and a sidebar click close it.
- Compare all: columns card tone, IND / OUT / CLY / GRS chips `--inner` grey; matched row = selected tile, white text, no
  blue bar or value; bars `--bar` for the matched event, `--bar-2` for the rest. Quote avatars: initials, `--inner`, grey.

## Entry list
- Week chips on the darker track; tier heads Hanken 10.5 caps on a 10% rule; table = card; rows on 6% hairlines with an
  `--inner` hover; tier chip `--inner` grey; caret `--inner`, white when open; expanded panel `--inner`; ranks grey mono;
  a missing count is a grey `—`; the empty week is a card. **Test:** `test-ten401-b.mjs`.
- Founder TEN-401 r1 (2026-10-08), **Test:** `test-ten401-b.mjs` r1.4–r1.8:
  - **The current week is always the first chip**, even when the shards hold nothing for it (it then shows the empty
    state); its count is the `tourxThisWeekEvents()` set. Chips and the default week are re-derived at render time.
  - **Every player row has a rank**, grey mono `#12`: the list's own (ATP ranking at publication), else the current ATP
    standings (`player-index.json`), else a grey `—`. A Bye has none. The roster join is by playerKey **only when the
    names agree** (every list word in the roster name — "Clement Hemery" is not key 1206 Calvin Hemery; no rank, no
    profile link), else a unique same-words name (`namesAgree`).
  - **Full names**: a name the source PDF cut ("CERUNDOLO, Juan M…") is completed from the roster; unresolved prints
    surname first so the ellipsis is at the end. The name cell ellipsises at its end, on real overflow only.
  - **No "published {date}"** on an event row: neither shard holds the list's publication date (a draw's
    `sourcePublished` = the PDF's modDate, re-stamped per re-post; an advance list's = the aggregator page's update).
  - En dash in week ranges ("2–8 Nov", "12–18 Oct"); empty state "The ATP has {n} events in the week of {range}. …"
