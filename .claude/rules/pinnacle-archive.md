# Permanent Pinnacle archive (founder brief 2026-10-14, item 1)

Applies to `supabase/migrations/20261014120000_pinnacle_archive.sql`, `tools/pinarch.py` (the one writer),
`tools/pinarch-guard.mjs` (the publish guard) and `.github/workflows/pinnacle-archive.yml`.

## Where it lives
- **Supabase database, project `witpzsbfvctarmytakzw`, schema `public`** — never a file in this repo:
  - `oddspapi_archive_raw`: every Oddspapi `/v4/historical-odds` payload we hold, **byte for byte** (`payload_gz` = the
    gzip of the response body exactly as stored or received; `payload_sha256` = sha256 of the decompressed body), one row
    per distinct payload per fixture, with `books`, `source`, `object_path`, `pulled_at`.
  - `pinnacle_archive_close`: every derived Pinnacle close — `source`, `label` (`captured` | `from Pinnacle history`),
    `close_ts`, `start_ts`, `start_source`, `gap_to_start_s`, the original record in `detail`.
  - `pinnacle_archive_count`: one row per archive job run with the counts it saw (the publish guard's baseline).
- **Backup: the private repo `Michaeldk1996/stennisfy-ops`, folder `pinnacle-archive/YYYY-MM-DD/`** (GitHub, a separate
  provider from Supabase). One dated folder per day: `raw-NNNN.jsonl.gz` (the raw rows added since the previous day,
  every column), `close-full.jsonl.gz` and `count-full.jsonl.gz` (full snapshots), `manifest.json` (ids, row counts,
  sha256 of every file, the previous day). A day is never replaced: the writer refuses an existing folder and only ever
  plain-pushes (never `--force`), so git history keeps every earlier copy too.

## Rules — each one is a test
- **Rows are only ever added.** Grants: anon / authenticated get nothing; `service_role` (the pipeline's key) gets
  SELECT + INSERT only. Triggers refuse UPDATE, DELETE and TRUNCATE for every role, the owner included. A correction is
  a new row whose `supersedes` names the old one. **Test:** `tools/test-pinnacle-archive-sql.py` (a real throwaway
  Postgres: every write path refused for service_role and the owner; the guard reports a dropped trigger / a granted
  privilege — negative controls).
- **No job writes it any other way.** `tools/pinarch.py` writes only `INSERT … ON CONFLICT DO NOTHING`
  (`resolution=ignore-duplicates`). **Test:** `tools/test-pinnacle-archive-guard.mjs` scans every tracked file: the tables
  may be named only by the allow-listed files, and none of them may carry an UPDATE / DELETE / TRUNCATE / DROP /
  DISABLE TRIGGER, an upsert, a PATCH / PUT / DELETE request, a write GRANT or a force-push (11 mutants caught).
- **The deploy fails if a count ever goes down.** `publish.yml` runs `tools/pinarch-guard.mjs` before the Pages deploy:
  any table below the highest count recorded in `pinnacle_archive_count`, a trigger missing, a write privilege or RLS
  off → the publish fails and the site keeps its last build. An unreachable database is a loud SKIP, never a pass and
  never a block. **Test:** `tools/test-pinarch-guard-check.mjs`.
- **Restore = the backups alone.** `python3 tools/pinarch.py restore <checkout of stennisfy-ops> --sql-out restore.sql`
  verifies every file's sha256 against its manifest (a mismatch stops it), then writes `INSERT … OVERRIDING SYSTEM VALUE …
  ON CONFLICT DO NOTHING` for every row with its original id (so every `supersedes` still points at its row) and moves each
  identity past the highest id. `--apply` runs it through the Management API (`SUPABASE_ACCESS_TOKEN`) into the live tables
  (after `pinnacle-archive.yml` mode `install` on a new project). `--compare` checks the backups against the live tables.
  **Test:** `tools/test-pinarch-roundtrip.py` (two dated copies → restore into an EMPTY database → every row of every
  table identical; a tampered file stops the restore; a day is never replaced).

## Jobs (`.github/workflows/pinnacle-archive.yml`, main only)
- `install` — applies the migration (additive, idempotent) and records a count.
- `daily` (cron 04:37 UTC) = `import` + `backup`: `captured-closes-pinnacle.json` (latest main) → close rows labelled
  `captured`; every object in the `oddspapi-raw` bucket not yet archived (by path + the object's `updated_at`) → raw rows;
  then today's dated backup. A changed captured row or a changed bucket object is added as a new row with `supersedes`.
- `derive` (in `daily`: the last 3 days; on dispatch: `--days N`) — for every ATP / Challenger singles match our live
  poller saw start (`live_flip_log`), the newest payload the archive holds for its Oddspapi fixture → one close row
  labelled `from Pinnacle history` (rule: `odds.md` "Pinnacle closing source by period"). The fixture comes from the odds
  loop's board map (`odds-fixture-map.json`: eventKey → fixtureId + orient), else from the Oddspapi fixtures list joined on
  BOTH surnames within 36 h (exactly one candidate; two or more, or none → no close, counted). Player keys are
  api-tennis's (`get_fixtures`, `timezone=UTC`). The Oddspapi fixtures list is the only METERED call (`/v4/fixtures`, one
  per 6-day window, cached; re-asked every 6 h); the meter is printed before and after.
- `restore-check` — rebuilds every row from the backups and compares with the live tables (no write).
- **Post-start pull** — `oddspapi-postmatch.yml` job `pinnacle-history` (dispatched at :07 / :22 / :37 / :52 by the
  pg_cron pinger, after the post-match job so the two never call Oddspapi at once): every match our poller saw start in the
  last 6 h without an archive close → its free `/v4/historical-odds` in the first key window (the :05–:14 window +
  `loop_idle`), stored as a raw row, then the close derived at once. A match whose close is not derivable yet is pulled
  again at most 4 times, 30 min apart. The captured close stays first on the page until the archive close supersedes it.
- **Export** — every pipeline run, `python3 tools/pinarch.py export pinnacle-closes.json` (read-only) writes the current
  close per match; `build-match-closes.js` builds the closing-prices shards from it.

## Measured at the build (2026-10-14 03:29Z)
Database 2.34 GB of an 8 GB disk (5.53 GB free; Pro plan, Micro compute). Bucket `oddspapi-raw` 6,137 fixtures, 181 MB
gzip (2026-05 319, 2026-09 4,218, 2026-10 1,600). A Pinnacle +30 payload is ~57 KB gzip / ~0.75 MB JSON (50–58
markets); a bet365 one ~0.2 KB. ATP + Challenger add ~1,400 completed matches a month → ~80 MB a month of raw rows.
