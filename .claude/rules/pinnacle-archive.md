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
  plain-pushes (never `--force`), so git history keeps every earlier copy too. A same-day re-run skips a COMPLETE day ("day already written, skipped"); an incomplete one fails
  (`historical-odds-archive.md` "Same-day re-runs").

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
- **Held back (never exported, never deleted):** a `derive-held` close (rule `start-alone`) and a `captured` close of a
  match on or before 16 Sep (rule `captured-before-live-flip`, founder ruling 2026-10-17 item 1: those 420 were cut at
  Oddspapi's start alone). `pinarch.py` `HELD_BACK_RULES` carries how each was made; the export's `heldBack.byRule`
  counts them (`odds.md` "held back").
- `derive-held` (dispatch only; founder ruling 2026-10-16, TEN-437 item 6; **its closes are HELD BACK since founder round 3
  item 2** — in the archive, never exported or shown, `odds.md` "held back") — closes for the held `pinnacle+30` payloads
  whose match has **no `live_flip_log` row** (the back-fill, before 17 Sep). Window `from` / `to` (UTC days; default the
  ruled **13–30 Apr**; anything wider is not ruled), `dry_run` (default yes: counts, inserts nothing). Cut = Oddspapi's
  `trueStartTime` alone after the `resolve_start` gate; missing or rejected → no close, counted (`odds.md` "Pinnacle
  closing source by period"). Events = api-tennis `get_fixtures` (UTC) ATP / Challenger singles of the window, minus
  walkovers / cancellations and minus any event with a live-flip row (the `derive` above owns those). The Oddspapi fixture:
  the board map, else the fixtures we already hold — the committed `.ten225-fixture-index.json.gz` (`/v4/fixtures` as read
  on 17 Sep: 21 Mar – 16 Sep, with trueStart and trueEnd), else a back-fill raw row's own `meta` — joined on BOTH surnames
  within 36 h of api-tennis's start, exactly one candidate; a fixture claimed by two events is no one's. **It never makes
  the metered `/v4/fixtures` call**: a match only that call could join gets no close and is counted. **Test:**
  `tools/test-pinarch-close.py`.
- `restore-check` — rebuilds every row from the backups and compares with the live tables (no write).
- **Post-start pull** — `oddspapi-postmatch.yml` job `pinnacle-history` (dispatched at :07 / :22 / :37 / :52 by the
  pg_cron pinger, after the post-match job so the two never call Oddspapi at once): every match our poller saw start in the
  last 6 h without an archive close → its free `/v4/historical-odds` for `bookmakers=pinnacle+30`, stored as a raw row,
  then the close derived at once. A match whose close is not derivable yet is pulled again at most 4 times, 30 min apart.
  The captured close stays first on the page until the archive close supersedes it.
  **Its own slot (founder 2026-10-14 item 2):** the pull never waits for the odds loop's key gate (`loop_idle` / the
  :05–:14 window, `odds.md` "The loop wins the key"): the endpoint is free, so only Oddspapi's ~5 s cooldown applies
  (`HIST_COOLDOWN_S` 5.5 s between calls; a 429 pauses 60 s and retries, at most 3 times). A long odds-loop run cannot
  stop it (on 14 Oct a 390-minute loop run held the gate shut and two pulls waited ~590 s each for nothing). **Test:**
  `tools/test-pinarch-close.py` (no gate in the pull path; cooldown + 429 retry; the book named).
- **Backlog pull** — `pinnacle-archive.yml` mode `pull-backlog` (`pull --hours N`): the same pull over the last N days, for
  every started match with no archive close and no Pinnacle +30 payload held.
- **Back-fill** (founder brief 2026-10-15 item 4) — `.github/workflows/pinnacle-backfill.yml` (main only, every 6 h, ~5.4 h a
  run, until nothing is left) runs `pinarch.py backfill`: every ATP / Challenger / Davis Cup singles fixture Oddspapi lists
  from ~185 days back (its history window: on 15 Oct the 11–12 Apr fixtures already 404, 13 Apr on answer) to 17 Sep (from
  there the live-flip pulls cover every start), **oldest first**, with no Pinnacle +30 payload in the archive and no bucket
  object waiting for the daily import → its free `/v4/historical-odds` (`bookmakers=pinnacle+30`) as a raw row
  (insert-only, `meta.trigger` `backfill`). **Below the post-start pull:** it never uses the odds loop's key gate, sits out
  while an `oddspapi-postmatch.yml` run is queued or running (`postmatch_busy`; unreadable = busy), and calls once every
  6.5 s (`BACKFILL_GAP_S`, wider than the pull's 5.5 s); a 429 pauses 60 s (hist_get). A fixture that answered 404 on two
  runs is not asked again (state in the Actions cache). Each run prints every month's listed / pulled / failed / left and
  the date its history expires (`month start + 180 days`). **Test:** `tools/test-pinarch-close.py` (oldest first, skips,
  the yield, no key gate, insert-only).
- **Fixture discovery includes Oddspapi's "Davis Cup" category** (item 1: api-tennis files Davis Cup World Group singles as
  `Atp Singles`; all 24 failed ATP joins of 17 Sep – 14 Oct were Davis Cup), and a cache kept under the older list is asked
  again once (`DISCOVERY_VERSION`). **Compound surnames:** when the strict join (`refresh-odds-history.orient`) finds no
  fixture, `orient_compound` joins api-tennis's first-part surname to Oddspapi's full one ("I. Parisca" = "Parisca Romera,
  Ignacio", "C. Bittoun" = "Bittoun Kouzmine, Constantin", "Wu Tung-Lin" = "Wu, Tung-Lin"): our shorter surname must START
  theirs, initials must share one, both players, ±36 h, exactly one candidate — never a tail of theirs ("A. Martin" is not
  "Lopez San Martin"). **Test:** `tools/test-pinarch-close.py` (with the strict-join control).
- **The export is refreshed from the current api-tennis fixture every run** (items 3 and 5): every close's player keys
  (`refresh_keys`: L. Xiao 31666 → 38140 on 12164753; a key that still agrees orients the other, else the names; an
  unreadable or unorientable fixture keeps the stored keys, counted) and an archive close's api-tennis result (a close
  derived mid-match stored "Set 1", so the Database feed could not add the match). The stored rows are never changed.
  **Test:** `tools/test-pinarch-close.py` (keys, result, the feed control).
- **Every history pull names the book** (founder 2026-10-14 item 3): `bookmakers=pinnacle+30` in `tools/pinarch.py`
  (`HIST_BOOK`) and in the daily archive / back-fill calls of `archive-oddspapi-raw.py` (`HIST_BOOKS`). Without it the
  endpoint returns the account's entitled book of the day, so every payload pulled while the key was entitled to bet365
  (before 26 Sep) came back bet365-only and was never pulled again (342 matches on 14 Oct). **Test:**
  `test-oddspapi-postmatch.py` (both archive calls name the book).
- **Every pipeline run** — after `build-captured-pinnacle.js`, `import-captured` appends this run's captured closes
  (insert-only), `export pinnacle-closes.json` writes the current close per match (an archive close over a captured one),
  `td-feed` turns it into the Database feed and `build-database-yield.js` rebuilds the Database archive with it; then
  `build-match-closes.js` builds the closing-prices shards from the export. Pages read these files; the archive is the source.
  **Fail-closed** (founder ruling 2026-10-17, odds master close-out item 3): each of those steps failing, or the archive gate
  (`tools/archive-gate.mjs`) finding a count missing, empty or below the last good run's, fails the run — nothing uploads,
  the site keeps the last good master and pre-2010 file, and a Telegram alert goes out (`odds.md` "The archive gate").

## Measured at the build (2026-10-14 03:29Z)
Database 2.34 GB of an 8 GB disk (5.53 GB free; Pro plan, Micro compute). Bucket `oddspapi-raw` 6,137 fixtures, 181 MB
gzip (2026-05 319, 2026-09 4,218, 2026-10 1,600). A Pinnacle +30 payload is ~57 KB gzip / ~0.75 MB JSON (50–58
markets); a bet365 one ~0.2 KB. ATP + Challenger add ~1,400 completed matches a month → ~80 MB a month of raw rows.
