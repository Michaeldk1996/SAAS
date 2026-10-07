# Odds archive (`odds-archive/`) — how it is refreshed, and who reads it

Founder ruling TEN-262, 2026-09-23. `odds-archive/{yyyy}.csv` holds tennis-data.co.uk
**closing** prices (ATP main draw), normalised by `mirror-odds-archive.py`.

## The source cannot be fetched automatically; the founder drops the file in

tennis-data.co.uk blocks automated downloads: GitHub Actions runners get a Cloudflare
"you have been blocked" 403 (even `robots.txt`), and this Mac is TCP-refused. **Do not try
any way around the block** (proxies, headless browsers, rotated agents). The fallback
mirror in `mirror-odds-archive.py` (nickdatak) stopped on 2026-06-17.

**The refresh path.** The founder saves the season workbook (e.g. `2026.xlsx`) into
**`~/Stennisfy/odds-archive-inbox/`**. The launchd agent `com.stennisfy.odds-archive-dropin`
runs `tools/odds-archive-dropin.sh`, which clones main fresh, runs
`tools/odds-archive-refresh.py`, rebuilds the committed readers, runs the full suite,
takes the deploy lane as `session:ODDS-ARCHIVE`, clobber-checks, pushes, waits for the
live build and releases the lane. The result is in `LAST-RUN.txt` in the inbox, as a
macOS notification, and in `~/.stennisfy/odds-archive-dropin/dropin.log`. Install or
reinstall the agent with `bash tools/odds-archive-dropin.sh --install`.

**Do not refresh a season with `mirror-odds-archive.py`.** It rewrites a whole season from
whatever it downloads; it has no merge and no never-thinner guard. It exists for the
historical backfill only.

## The refresh rules — each one is a test

- **Validate before merging (exit 3, nothing written; 2 is Python's own usage error).** Every column the archive is built
  from is present; every row has a winner, a loser and a date that parses; all rows are
  in one season, and it is the season in the file name; one row per match (no duplicate
  date / tournament / round / winner / loser).
- **Merge, don't overwrite.** A new match is added. A published match keeps its row
  unless the source now says something different: that is a source correction; it is
  applied and every changed field is reported and logged.
- **Never thinner (exit 1, nothing written).** A published match that is absent from the
  source, or a merged season smaller than the published one, stops the run. An empty
  workbook is refused even for a season with no published file.
- **A missing price is a dash.** `-`, blanks and anything outside 1.01–1000 are written as
  empty cells. Never a zero, and never another book's price (a missing Pinnacle price
  stays an empty CELL; which book prices a Database row is the join rule below).
- **Every refresh is logged** in `odds-archive/refresh-log.jsonl`: time, source sha256,
  rows before and after, added, changed, latest date.
- **"Archive through" comes from the data.** It is `database-yield.json`
  `meta.dateRange[1]`, the latest match in the CSVs. When that is more than 14 days
  before today (UTC days; exactly 14 is not stale), the same line reads
  "Archive through [date]. Updates pending."
  **The clock is the latest MATCH, not the last refresh (founder ruling, 2026-09-23).** So
  "Updates pending" also shows in the off-season (from about early December to early January;
  the last matches of 2022–2025 fell on 16–20 Nov), when no ATP matches are played. That is
  intended; do not switch it to a refresh clock.

Locked by `test-odds-archive-refresh.py` (the tool, 11 mutants, plus the published archive,
log and store agreeing) and `test-ten262.mjs` (the stamp, 3 mutants).

## Price join: Pinnacle, else Bet365, per row (founder ruling TEN-384, 2026-10-07, option "me")

`build-database-yield.js` prices **each row** the way Market edge does (`build-market-edge.js`
`pickBook`): **Pinnacle closing when both Pinnacle prices are valid, else Bet365 closing
when both Bet365 prices are valid**, in every season. A row with no valid pair on either
book is dropped (`meta.exclusions.noResolvingBookPrice`, e.g. all of 2009). Each row's
`r[8]` is the book actually used. The Database rows (Tour, Tournaments, Players) and
`tour-baselines.json` are the **same rows** (`basis: 'market-edge'`,
`equalsDatabaseTour: true`); there is no `--baseline-basis` flag and no `seamSeason`.
This replaces TEN-146 / TEN-262 "one book per season: Pinnacle 2010–2025, Bet365 for the
whole 2026 season; never fill a missing Pinnacle price from another book" for the
DATABASE JOIN. (The archive CSV itself still never fills a cell from another book: see
"A missing price is a dash" above.)

The source's Pinnacle column stops on 2026-01-13 (`meta.pinnacleLastPriced`), so Bet365
prices every later row; earlier, Bet365 fills single rows Pinnacle did not price (191 rows
in 2010–2025 + early Jan 2026 today). Measured at the change (2026-10-07): 40,972 matches,
38,830 priced on Pinnacle and 2,142 on Bet365; All −4.37%, Favourites −1.78%, Underdogs
−6.96% (was 40,791 · 38,761 / 2,030 · −4.33% / −1.79% / −6.88%).

**The Database says so in plain words.** The header reads: "Pinnacle closing prices, else
Bet365, 2010–2026 (the source's Pinnacle prices stop on 13 Jan 2026). The change is marked
on the curves." The book line reads "Pinnacle closing, else Bet365 — both books in this
selection; per-book split below …"; the "Split by book" lines say "… N matches priced on
Bet365 (where Pinnacle has no price)" (no season); the method note says "Each match is
priced on its Pinnacle closing price, or on its Bet365 closing price where Pinnacle has
none (…stop on 13 Jan 2026)" and "38,830 priced on Pinnacle and 2,142 on Bet365 (where
Pinnacle has no price)"; the no-price exclusion is "with no closing price on either book".
**Never "settled on"**: it reads as bet settlement. "Closing" stays (founder's call),
although the source's own wording is only "the most recent before play starts" (a 2020
copy of its notes; the files carry no timestamp).
- The years are `meta.dateRange`; the stop date is `meta.pinnacleLastPriced` (the latest
  archive row with a valid Pinnacle pair), never typed, and printed only when the archive
  runs past it. No date in the store → no parenthetical and no change to mark.
- **The curve mark** (dashed line, "Bet365" label, "Book change after 13 Jan 2026, where the
  source's Pinnacle prices stop …" footnote) sits at the first Bet365-priced row AFTER
  `meta.pinnacleLastPriced`. Earlier Bet365 fills are not a book change and are not marked.
- **Test:** paint `renderChrome` and read exactly that header (plus fixtures for another
  stop date, a stop in an earlier season, an archive that ends on the last Pinnacle date,
  and a 2027 archive); paint `renderFootnote` (two fixtures) and read the per-row join,
  "priced on", never "settled on", never "(2026)"; paint `bandPanel` / `dbBookSplit` and
  read the seasonless Bet365 clause (`test-ten262.mjs`, with mutants). The seam keys on
  `seamAfter` (`test-ten242-rulings.mjs`). `tools/test-pp2-reconcile.js` Q8: the baselines
  file is `basis 'market-edge'`, `equalsDatabaseTour`, equals the Database `agg`/`bands`
  over `database-yield.json` bit for bit, and the store carries Bet365 rows before 2026
  (mutants: the old basis, a one-book-per-season store). The published store's stop date
  must equal the value recomputed from the CSVs (`test-odds-archive-refresh.py`).
- **The blend is the rule:** curves, ROI cards (`tournament-market.json`, built from
  `database-yield.json`), player panels and the profile's tour baselines all read the
  per-row join. Every figure that spans both books shows the per-book split. (TEN-266: if
  2026 Pinnacle prices arrive, the join picks them up row by row with no code change.)

## Who writes it, who reads it

- **Writers:** `tools/odds-archive-refresh.py` (via the drop-in job) and, for the historical
  backfill only, `mirror-odds-archive.py` run by hand. **No GitHub workflow writes
  `odds-archive/`.**
- **Rebuilt by the drop-in job and committed:** `database-yield.json` and
  `database-yield-players.json` (Database tab: header, Archive through, Tour, Tournament
  and Player curves), `tour-baselines.json` (the profile's Market edge tour yields per role,
  written by the same `build-database-yield.js` run from the same rows, so they equal the
  Database Tour aggregates; TEN-384), and `tournament-market.json` (Tournament ROI cards; also rebuilt on
  every pipeline run).
- **Rebuilt on every pipeline run:** `odds-performance/` and its index (player profile
  market section), and `tournament-market.json`.
- **Hand-built, NOT refreshed by the drop-in** (they need gitignored stores a fresh clone
  lacks: `career-history/`, `tml-cache/`): `market-edge*` (profile market edge),
  `court-speed-map.json` (court speed), `matchup-matrix.json` (Playing Styles). They keep
  their last build until someone rebuilds them against the deployed stores.
