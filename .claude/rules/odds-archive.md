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
  stays empty).
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

## Book per season (unchanged, TEN-146)

`build-database-yield.js` uses **Pinnacle** for 2010–2025 and **Bet365 for the whole 2026
season**. The source's Pinnacle column stops on 2026-01-13 (71 rows, 4–13 Jan). Those rows
are not used, because one season is one book. Never fill a missing Pinnacle price from
another book.

**The Database says so in plain words (founder rulings, 2026-09-23; wording = option A).**
The header reads: "Pinnacle closing prices, 2010–2025; 2026 uses Bet365 prices (the
source's Pinnacle prices stop on 13 Jan 2026). The change is marked on the curves." The
"Split by book" lines say "… N 2026 matches priced on Bet365" and the method note says
"38,761 priced on Pinnacle and 2,030 on Bet365 (2026)". **Never "settled on"**: it reads
as bet settlement. "Closing" stays (founder's call), although the source's own wording is
only "the most recent before play starts" (a 2020 copy of its notes; the files carry no
timestamp).
- The first range ends the season before `seamSeason`; the stop date is
  `meta.pinnacleLastPriced` (the latest archive row with a valid Pinnacle pair), never
  typed. No date in the store → no parenthetical. An archive that ends before the seam
  season has no change to mark, so the sentence just ends.
- **Test:** paint `renderChrome` and read exactly that header (plus fixtures for another
  stop date, a 2027 seam, a pre-seam archive, and an out-of-season Pinnacle date); paint
  `renderFootnote` and read "priced on", never "settled on". The published store's stop
  date must equal the value recomputed from the CSVs. Locked by `test-ten262.mjs` and
  `test-odds-archive-refresh.py`. This replaces "2026 settled on Bet365 …, seam-marked on
  the curves" and the earlier "2010–2026", which over-claimed Pinnacle by a season.
- **The blend stays (ruling, 2026-09-23):** curves, ROI cards, player panels, Form, H2H and
  the matrix keep mixing Pinnacle (≤2025) and Bet365 (2026) until 2026 Pinnacle prices
  arrive. Tracked in TEN-266 (child of TEN-262).

## Who writes it, who reads it

- **Writers:** `tools/odds-archive-refresh.py` (via the drop-in job) and, for the historical
  backfill only, `mirror-odds-archive.py` run by hand. **No GitHub workflow writes
  `odds-archive/`.**
- **Rebuilt by the drop-in job and committed:** `database-yield.json` and
  `database-yield-players.json` (Database tab: header, Archive through, Tour, Tournament
  and Player curves), and `tournament-market.json` (Tournament ROI cards; also rebuilt on
  every pipeline run).
- **Rebuilt on every pipeline run:** `odds-performance/` and its index (player profile
  market section), and `tournament-market.json`.
- **Hand-built, NOT refreshed by the drop-in** (they need gitignored stores a fresh clone
  lacks: `career-history/`, `tml-cache/`): `market-edge*` (profile market edge),
  `court-speed-map.json` (court speed), `matchup-matrix.json` (Playing Styles). They keep
  their last build until someone rebuilds them against the deployed stores.
