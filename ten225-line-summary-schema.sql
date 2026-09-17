-- TEN-225 — oddspapi_line_summary + oddspapi_fixtures.
--
-- Michael's scope ruling (2026-09-17T07:33Z):
--   "Do NOT load every pre-start tick into Postgres. Instead create a summary
--    table, e.g. oddspapi_line_summary — one row per fixture + book + market +
--    side + line: open_price, open_ts, close_price, close_ts,
--    close_lag_minutes, pre_start_tick_count, first_tick_ts,
--    last_pre_start_tick_ts, source (oddspapi-raw | bet365-history),
--    close_reliable (bool). Markets: match winner, games handicap, total games,
--    set betting. Levels: all. Full tick series stays in the raw bucket only."
--
-- Sizing PASSED before this file was written: four families, all levels,
-- 0.106 GB/yr against the 2.00 GB/yr line (5.3%) — doc `summary-sizing`,
-- measured at 255.9 B/row on this instance by ten225-rowsize-probe.sql.
-- This DDL is the v1 shape that measurement was taken on, so the number that
-- cleared the gate is the number this table bills.
--
-- KEY — ruled by Michael 2026-09-17T08:07Z (gate 0ef55f38, option
-- `nulls-not-distinct`). `line` is NULL on match winner (oddspapi has no line
-- field; the line is encoded in the marketId and match winner simply has none),
-- and Postgres forces NOT NULL on every PRIMARY KEY column, so the ruled grain
-- cannot be a plain PK. UNIQUE NULLS NOT DISTINCT treats two NULL lines as one
-- key, which is what the grain intends. Requires PG >= 15; this instance is
-- 17.6, verified by the row-size probe.
--
-- TWO COLUMNS ADDED BEYOND THE RULED LIST, both nullable and both flagged in
-- the report rather than slipped in: `start_ts` and `start_ts_source`.
-- close_reliable and close_lag_minutes are both defined against the match start,
-- so without the start on the row neither can be audited or recomputed after a
-- rule change — and Michael's ruling 4 explicitly anticipates retuning the
-- 21-day window. 40.15% of the 49,287 fixtures in the 180-day sweep have no
-- trueStartTime, so which start was used is not a detail. Cost is ~12 B/row on
-- a table running at 5.3% of its line.
--
-- RLS ON, ZERO ANON POLICIES — Part 1 of the spec. No policy is created here at
-- all: with RLS enabled and no policy, PostgREST's anon and authenticated roles
-- read nothing, and the service key (which bypasses RLS) is the only way in.
-- That is the intended posture: this table is a build-time source for
-- odds_card_state, never read by a browser.
--
-- TOUCHES NOTHING THAT EXISTS. Both tables are new names. No existing table,
-- policy, publication or pg_cron job is referenced — all four are DO-NOT-TOUCH
-- on TEN-225. Re-runnable: every statement is IF NOT EXISTS.

-- ---------------------------------------------------------------------------
-- oddspapi_fixtures — the fixture identity behind a summary row.
-- Populated from the /v4/fixtures sweep (ten225-fixture-index.py). Needed by
-- Parts 2-4 to pair an oddspapi fixture to one of our matches, and it carries
-- the start time that close_reliable is judged against.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oddspapi_fixtures (
  fixture_id        text        PRIMARY KEY,
  category_name     text,                  -- ATP / Challenger / ITF Men / ...
  tournament_name   text,
  player1           text,
  player2           text,
  scheduled_start   timestamptz,           -- startTime. NEVER used as Close.
  true_start        timestamptz,           -- trueStartTime; null on 40.15%
  status            text,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE oddspapi_fixtures ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- oddspapi_line_summary — one row per series, not per tick.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oddspapi_line_summary (
  fixture_id              text        NOT NULL,
  book                    text        NOT NULL,   -- 'bet365' (books are config)
  market                  text        NOT NULL,   -- the four ruled families
  side                    text        NOT NULL,   -- outcome name: 1/2/Over/2:1
  line                    numeric,                -- NULL on match winner

  open_price              numeric     NOT NULL,   -- first recorded tick
  open_ts                 timestamptz NOT NULL,

  -- Close is NULLED when close_reliable is false (Michael's ruling 2:
  -- "Otherwise close_price = null (dash on the site). Open is kept.").
  close_price             numeric,
  close_ts                timestamptz,

  -- Diagnostics, ALWAYS populated when a start time is known — this is why the
  -- ruled column list carries both close_ts and last_pre_start_tick_ts. The
  -- second survives the nulling so the 21-day window can be retuned (ruling 4)
  -- without re-reading the bucket.
  close_lag_minutes       numeric,
  pre_start_tick_count    integer,                -- NULL when start is unknown
  first_tick_ts           timestamptz NOT NULL,
  last_pre_start_tick_ts  timestamptz,

  start_ts                timestamptz,            -- added; see header
  start_ts_source         text,                   -- oddspapi | api-tennis-live | none

  -- Michael's trueStartTime ruling (2026-09-17T10:02Z), option (a).
  -- Why the reason is a COLUMN and not a log line: a dashed Close is
  -- indistinguishable from "we never archived it" unless the row itself says
  -- which. Part 4 item 2 has to list every dashed match "with the reason".
  start_reject_reason     text,
  -- Ruling item 2, the cross-check. conflict_minutes is signed:
  -- trueStartTime - last_not_live_seen_at, so negative = oddspapi is earlier.
  start_conflict          boolean     NOT NULL DEFAULT false,
  conflict_minutes        numeric,
  -- The live-flip lower bound's own uncertainty. Michael's fallback rule needs
  -- gap_seconds <= 300, so the gap has to survive onto the row to be audited.
  flip_gap_seconds        numeric,

  source                  text        NOT NULL,   -- oddspapi-raw|bet365-history
  archived_at             timestamptz,            -- capture time; drives 21d
  close_reliable          boolean     NOT NULL DEFAULT false,
  loaded_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT oddspapi_line_summary_grain
    UNIQUE NULLS NOT DISTINCT (fixture_id, book, market, side, line),
  CONSTRAINT oddspapi_line_summary_source_ck
    CHECK (source IN ('oddspapi-raw', 'bet365-history')),
  CONSTRAINT oddspapi_line_summary_start_src_ck
    CHECK (start_ts_source IN ('oddspapi', 'api-tennis-live', 'none')),
  -- A reliable close must actually have a close. Cheap, and it makes the
  -- "close nulled but still flagged reliable" bug impossible rather than
  -- merely unlikely.
  CONSTRAINT oddspapi_line_summary_close_ck
    CHECK (NOT close_reliable OR (close_price IS NOT NULL AND close_ts IS NOT NULL)),
  -- A rejected trueStartTime must say why, and a reason must be one we ruled.
  CONSTRAINT oddspapi_line_summary_reject_ck
    CHECK (start_reject_reason IS NULL
           OR start_reject_reason IN ('implausible_duration',
                                      'implausible_early_start',
                                      'end_before_start',
                                      'itf_uncorroborated_start')),
  -- A flagged conflict must carry its magnitude, and an unflagged row must not
  -- claim one. Without this, "flagged but unquantified" is a silent state.
  CONSTRAINT oddspapi_line_summary_conflict_ck
    CHECK (start_conflict = (conflict_minutes IS NOT NULL))
);

-- ---------------------------------------------------------------------------
-- MIGRATION for the instance that already holds the v1 table.
--
-- CREATE TABLE IF NOT EXISTS above is a NO-OP against the live table (28,067
-- rows loaded 2026-09-17), so the trueStartTime-ruling columns would never
-- appear there without these. Every statement is additive and idempotent, and
-- the two new CHECKs are added separately because a constraint inside a
-- skipped CREATE TABLE is skipped with it.
-- ---------------------------------------------------------------------------
ALTER TABLE oddspapi_line_summary
  ADD COLUMN IF NOT EXISTS start_reject_reason text,
  ADD COLUMN IF NOT EXISTS start_conflict      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS conflict_minutes    numeric,
  ADD COLUMN IF NOT EXISTS flip_gap_seconds    numeric;

-- PART 2's "Now" source. Michael's locked definition: "Now = freshest Oddspapi
-- price already available to us, with its timestamp. No new polling in this
-- step." The freshest price we hold for a series IS its last observed tick, and
-- the loader already has it in hand — it was simply never stored.
--
-- NAMED FOR WHAT IT IS, NOT FOR WHAT A CARD CALLS IT. On a FINISHED fixture the
-- last tick is an in-play or settled price, and storing that under `now_price`
-- would put a post-match number one join away from a surface that renders
-- "Now". So the archive stores `last_tick_*` as a fact, and odds_card_state
-- decides — per fixture, against the start — whether that fact is a Now.
ALTER TABLE oddspapi_line_summary
  ADD COLUMN IF NOT EXISTS last_tick_price     numeric,
  ADD COLUMN IF NOT EXISTS last_tick_ts        timestamptz,
  ADD COLUMN IF NOT EXISTS last_tick_is_prestart boolean;

-- Same half-populated guard the other price/timestamp pairs carry.
ALTER TABLE oddspapi_line_summary
  DROP CONSTRAINT IF EXISTS oddspapi_line_summary_last_tick_ck;
ALTER TABLE oddspapi_line_summary
  ADD CONSTRAINT oddspapi_line_summary_last_tick_ck
  CHECK ((last_tick_price IS NULL) = (last_tick_ts IS NULL));

-- start_ts_source gained 'api-tennis-live' as a real (not merely allowed)
-- value with this ruling. The v1 CHECK already listed it, so this is a no-op
-- on a fresh table and a repair on any instance that predates it.
-- DROP IF EXISTS then ADD, as plain statements: that pair is idempotent on its
-- own, so there is no reason to wrap it in a DO block and hand the SQL-exec
-- endpoint a dollar-quoted body to pass through intact.
ALTER TABLE oddspapi_line_summary
  DROP CONSTRAINT IF EXISTS oddspapi_line_summary_start_src_ck;
ALTER TABLE oddspapi_line_summary
  ADD CONSTRAINT oddspapi_line_summary_start_src_ck
  CHECK (start_ts_source IN ('oddspapi', 'api-tennis-live', 'none'));

ALTER TABLE oddspapi_line_summary
  DROP CONSTRAINT IF EXISTS oddspapi_line_summary_reject_ck;
ALTER TABLE oddspapi_line_summary
  ADD CONSTRAINT oddspapi_line_summary_reject_ck
  CHECK (start_reject_reason IS NULL
         OR start_reject_reason IN ('implausible_duration',
                                    'implausible_early_start',
                                    -- Michael's ruling 2026-09-17T10:45Z added
                                    -- these two. Run 35213968572 is why they are
                                    -- here: the loader emitted end_before_start
                                    -- and this CHECK rejected the batch at row
                                    -- 13,500. It was right to — an unruled reason
                                    -- string is exactly what it exists to stop.
                                    -- test-ten225-load-line-summary.py now
                                    -- cross-checks this list against the reasons
                                    -- the loader can actually emit, so a third
                                    -- reason cannot repeat this.
                                    'end_before_start',
                                    'itf_uncorroborated_start'));

ALTER TABLE oddspapi_line_summary
  DROP CONSTRAINT IF EXISTS oddspapi_line_summary_conflict_ck;
ALTER TABLE oddspapi_line_summary
  ADD CONSTRAINT oddspapi_line_summary_conflict_ck
  CHECK (start_conflict = (conflict_minutes IS NOT NULL));

ALTER TABLE oddspapi_line_summary ENABLE ROW LEVEL SECURITY;

-- Parts 2-4 read this table one way: "give me the match-winner series for these
-- fixtures". Index that access path, nothing speculative.
CREATE INDEX IF NOT EXISTS oddspapi_line_summary_fixture_market_idx
  ON oddspapi_line_summary (fixture_id, market);
