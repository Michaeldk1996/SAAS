# Historical odds archive — Tennis-Data files, closes 2010+, the private CSV export (founder brief 2026-10-16)

Applies to `supabase/migrations/20261016090000_historical_odds_archive.sql`, `tools/tdarch.py` (the one writer),
`tools/histarch-guard.mjs`, `tools/no-odds-export-check.mjs` and `.github/workflows/historical-archive.yml`. The Pinnacle
archive (`pinnacle-archive.md`) is a separate set of tables and is not changed by any of this.

**Why:** Tennis-Data has stopped serving its files (founder 2026-10-16, after unauthorised scraping). Every Tennis-Data
file we hold is irreplaceable.

## Where it lives
- **Supabase, schema `public`**, four append-only tables:
  - `historical_odds_file` — every Tennis-Data file we hold, byte for byte (`content_gz` = gzip of the original bytes;
    `sha256` of the original, unique): the repo's `odds-archive/` CSVs, every earlier version of them in git history, the
    public mirror's original workbooks (`nickdatak/Tennis-Match-Predictions`, GitHub — never tennis-data.co.uk) and every
    workbook in the private repo's `tennis-data/originals/` (the founder's drop-ins).
  - `historical_close` — every Tennis-Data closing price from 2010: one row per match per book, `tennis-data Pinnacle`
    and `tennis-data Bet365` as separate sources, each naming the sha256 of the file it came from. A changed price is a
    new row whose `supersedes` names the old one.
  - `historical_odds_export` — one row per private CSV export (name, sha256, rows, per-year counts, its private path).
  - `historical_archive_count` — one row per job run: the publish guard's baseline.
- **Private repo `Michaeldk1996/stennisfy-ops`:** `tennis-data/files/<sha256>__<name>` (each original, never replaced) and
  `tennis-data/manifests/<day>.json`; `closes-export/<day>/` (the CSV export + manifest); `historical-archive/<day>/`
  (the daily dated backup of the four tables).

## Rules — each one is a test
- **Rows are only ever added.** service_role: SELECT + INSERT only; anon / authenticated: nothing; RLS on; triggers refuse
  UPDATE, DELETE and TRUNCATE for every role. A close must name a stored file; a price is >= 1.01 (a missing price is no
  row, never a zero). **Test:** `tools/test-historical-archive-sql.py` (a real throwaway Postgres, negative controls).
- **No job writes it any other way.** **Test:** `tools/test-histarch.mjs` part 1 (every tracked file scanned; mutants).
- **The deploy fails if a count goes down or a protection is gone** (`publish.yml` "Historical odds archive guard");
  unreachable or not yet installed = a loud SKIP. **Test:** `tools/test-histarch.mjs` part 2.
- **The export is private.** It is written only into the private ops repo, as NEW dated files
  (`pinnacle-closes-2010-YYYY_<day>.csv` + one per year, a manifest with each sha256); a day is never replaced. The
  published site may hold no odds CSV, no export-named file, no export header and no backup folder (`publish.yml` "No odds
  export in the published site"); the public repo may track no export or backup (`npm test`). **Test:**
  `tools/test-histarch.mjs` part 3, `tools/test-tdarch.py`.
- **Export columns (one row per match):** date, tournament, round, surface, tour (ATP main draw / qualifying /
  Challenger), player1, player2, winner, score, pinnacle_p1, pinnacle_p2, source (Tennis-Data / Oddspapi / captured),
  close_time, start_time, start_source, gap_to_start_s, bet365_p1, bet365_p2, bet365_source. Tennis-Data matches: player1 =
  the winner; Pinnacle from Tennis-Data, else the one archive close that joins the match (same day ±1, both surnames — the
  td-feed join); Bet365 from Tennis-Data. Archive-only closes (Challenger, qualifying, ATP main draw after Tennis-Data's
  last day) are their own rows; ITF is not exported. Empty = missing, never zero. The score is empty for Tennis-Data rows
  (our normalized CSVs carry no set scores) and api-tennis's set count for archive rows.
- **Verify** (`historical-archive.yml` mode `verify-export`): per year, the export's Tennis-Data Pinnacle / Bet365 rows
  equal the archive's; no export file answers 200 from the site; a restore from the backups reproduces every row and every
  export file's sha256.

## Pinnacle (approx.) — snapshots, never closes (founder ruling 2026-10-16)
- **Its own tables:** `historical_snapshot` (source `api-tennis Pinnacle`, label `Pinnacle (approx.)` — both enforced by a
  CHECK, so a snapshot can never carry a close's source or label) + `historical_snapshot_count`; migration
  `20261016150000_historical_snapshot.sql`, the same protections (SELECT + INSERT only, triggers, RLS) and their own guard
  RPC `historical_snapshot_guard()`, read by `publish.yml` through `tools/histarch-guard.mjs`. Backed up daily with the four
  tables (`snapshot-full` / `scount-full`). **Test:** `tools/test-historical-archive-sql.py` (negative controls),
  `tools/test-histarch.mjs`.
- **What it holds:** for every Tennis-Data ATP main-draw row of 13 Jan – 12 Apr 2026 with no Tennis-Data Pinnacle pair
  (walkovers out), api-tennis's stored `Pncl` match-winner pair from the ONE api-tennis ATP-singles fixture that joins it
  (day −1 … +2, both surnames; Home = the fixture's first player), oriented to the Tennis-Data winner; a missing side or a
  price below 1.01 is no row. Written only by `tools/tdarch.py approx-import` (`historical-archive.yml` mode
  `approx-import`); a changed snapshot is a new row whose `supersedes` names the old one. **Test:** `tools/test-tdarch.py`.
- **Where it is used:** the Database join only (`database.md` "Pinnacle (approx.)"), never over a Tennis-Data or Oddspapi
  close; Bet365 stays the fallback where api-tennis has no pair. The private CSV export does NOT carry it (its columns are
  closes).

## Known exposure (founder to rule)
- **The `SAAS` repo is public**, and `odds-archive/*.csv` (every Tennis-Data season 2004–2026 with its Pinnacle and Bet365
  prices) is tracked in it. The repo check lists those 23 files by name (`REPO_KNOWN`) instead of failing on them, pending
  the founder's ruling on moving them to the private repo. Any OTHER odds CSV fails.
