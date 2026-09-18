-- TEN-225 PART 2 — odds_card_state.
--
-- Michael's spec, verbatim:
--   "New table `odds_card_state`: one row per fixture + book + market + side
--    (+ line): open_price, open_ts, open_limit, now_price, now_ts, close_price,
--    close_ts, start_ts_source (oddspapi | api-tennis-live | none), source
--    (oddspapi | api-tennis), label. Filled for match winner from the archive,
--    api-tennis fallback where Oddspapi has nothing."
--
-- WHY THIS IS A SEPARATE TABLE FROM oddspapi_line_summary
-- ---------------------------------------------------------------------------
-- line_summary is the BUILD-TIME index over one source (the oddspapi archive):
-- one row per series, every market family, keyed to oddspapi's own fixture ids.
-- odds_card_state is the READ-TIME answer to "what does this card show": one
-- row per thing a surface renders, already resolved across BOTH sources, keyed
-- so a page can find it. Collapsing them would mean either polluting the
-- archive index with api-tennis rows or making every card read re-run the
-- source-preference logic. They are different grains with different lifetimes.
--
-- RLS ON, ZERO POLICIES — same posture as Part 1, and for now the same reason:
-- nothing member-visible reads this until Michael says go after the Part 4
-- report. When it IS wired, it gets an explicit read policy in its own change,
-- reviewed on its own merits. A table that starts readable never gets that
-- review.
--
-- MISSING IS NULL, NEVER ZERO (standing rule). Every price column is nullable
-- and a NULL means "we do not have it" — the surface renders a dash. There is
-- no sentinel value anywhere in this table, because 0.0 is a price-shaped
-- number and would reach a card looking like data.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS odds_card_state (
  -- Identity. fixture_id is the OODSPAPI id where oddspapi has the fixture, and
  -- the api-tennis event_key where it does not — which is why id_space is here
  -- and not inferred. Inferring it from the string shape (oddspapi ids start
  -- 'id'/'pn') would be a guess that breaks the first time a feed changes its
  -- id format, silently, on the read path.
  fixture_id        text        NOT NULL,
  id_space          text        NOT NULL,   -- oddspapi | api-tennis | kibl
  book              text        NOT NULL,   -- sports411 | bet365; books are config
  market            text        NOT NULL,   -- 'match winner' in this step
  side              text        NOT NULL,   -- '1' | '2' (outcome name)
  line              numeric,                -- NULL on match winner

  -- BOOK PRIORITY (founder ruling 2026-09-18T00:18Z). Three sources now price
  -- the same match under three different id spaces, so "one book per fixture"
  -- cannot be enforced on fixture_id — the three rows for one match do not share
  -- one. match_key is what makes them one match: scheduled day + both surname
  -- keys, sorted, from ten225_names.match_key(). NULL means the row could not be
  -- paired to anything, which is also the reason its card dashes.
  match_key         text,
  -- 1 kibl/Sports411, 2 bet365 via oddspapi, 3 api-tennis. Lower wins.
  book_rank         smallint    NOT NULL DEFAULT 99,
  -- The one source a surface may render for this match+market+side. Set by the
  -- selection pass, never by a filler: a filler only knows its own source, and
  -- "am I the best source" is not a question it can answer. Default FALSE so a
  -- row that no selection pass has judged renders nothing rather than renders
  -- unconditionally — the safe direction when the two disagree.
  is_selected       boolean     NOT NULL DEFAULT false,
  -- What our timestamps MEAN, per source. Founder, 2026-09-18: "Every Kibl
  -- timestamp is vendor-insert time, not book-post time. Label it that way in
  -- the data." A column, not a convention, because the distinction survives
  -- into the report and into anything that later compares two books' openers.
  ts_kind           text,                   -- vendor-insert | book-tick | sighting

  -- Open. Michael: "first recorded Oddspapi tick for fixture + book + side
  -- (createdAt), with timestamp and stake limit."
  open_price        numeric,
  open_ts           timestamptz,
  open_limit        numeric,

  -- Now. Michael: "freshest Oddspapi price already available to us, with its
  -- timestamp. No new polling in this step."
  now_price         numeric,
  now_ts            timestamptz,

  -- ── OUR OBSERVATION CLOCK, SEPARATE FROM THE PRICE'S OWN CLOCK ────────────
  -- Founder ruling 2026-09-18 09:33Z, items 1 + 3.
  --
  -- `open_ts`/`now_ts` are the PRICE's time: a bet365 tick, or Kibl's
  -- vendor-insert instant. `*_observed_at` is OUR time — when the sweep that
  -- holds this value actually looked. They answer different questions and this
  -- table could not previously tell them apart, which cost two real defects:
  --
  --   1. THE TOOLTIP printed the price's clock under a label a member reads as
  --      "how fresh is this". Measured on the deployed board, n=32 fixtures
  --      carrying both clocks: median gap 109 min, max 486 min. The hover was
  --      systematically wrong about its own freshness.
  --   2. THE FLAT 0%. A Kibl price re-seen unchanged by a LATER sweep is an
  --      evidenced flat market. A Kibl price seen exactly ONCE is not evidence
  --      of anything. Both wrote one row into open_* and now_*, so downstream
  --      could only guess from timestamp equality.
  --
  -- ⚠️ WHAT THIS COLUMN DOES *NOT* YET FIX, ON THE KIBL PATH. MEASURED, not
  -- assumed: kibl_client.observation_key() hashes inserted_on + price + the
  -- three state flags and DOES NOT include observed_at, and archive-kibl.py
  -- inserts ON CONFLICT (row_key) with resolution=ignore-duplicates. So a sweep
  -- that re-sees an unchanged, still-current price writes NO NEW ROW and the
  -- stored observed_at never advances past the FIRST sweep that saw it. On this
  -- source now_observed_at > open_observed_at is therefore true exactly when
  -- now_ts <> open_ts — the same test the renderer already had. On the deployed
  -- file (32 complete Kibl sides) the two rules agree on all 32: 4 flat with
  -- equal stamps, 3 flat with different stamps. ZERO behaviour change.
  --
  -- So on Kibl this is INSTRUMENTED, not fixed. The column is real and correct
  -- where the fact exists (it is the genuine first-sighting stamp, and on the
  -- api-tennis fallback it is a true sighting clock), but a Kibl re-sighting
  -- cannot be evidenced until the ARCHIVE records one — a last_seen_at on
  -- kibl_line_observations bumped every sweep, which is a Part 1 change to an
  -- append-only store and the founder's call, not this file's.
  --
  -- NULLABLE AND OFTEN NULL, DELIBERATELY. The oddspapi path has no observation
  -- clock to give: oddspapi_line_summary summarises book ticks and has never
  -- carried a fetch time. NULL means "we do not hold our own clock for this
  -- value", and every reader falls back to the price's own clock rather than
  -- inventing one. NOT backfilled — a sighting time not recorded is not
  -- recoverable, the same rule "first sighting wins forever" already encodes.
  open_observed_at  timestamptz,
  now_observed_at   timestamptz,

  -- Close. Michael: "last Oddspapi tick before the match start, with timestamp."
  -- NULL whenever the start could not be established or the close failed the
  -- reliability rule — the Open survives either way.
  close_price       numeric,
  close_ts          timestamptz,

  -- Provenance. start_ts_source says WHICH start the close was cut at;
  -- start_reject_reason says why there is no start at all. Part 4 item 2 has to
  -- list every dashed match "with the reason", and a dash with no reason on the
  -- row cannot be distinguished from a fixture we simply never archived.
  start_ts          timestamptz,
  start_ts_source   text        NOT NULL DEFAULT 'none',
  start_reject_reason text,
  source            text        NOT NULL,   -- oddspapi | api-tennis
  label             text,                   -- 'last seen' on the fallback

  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- Same grain and same NULLS NOT DISTINCT reasoning as line_summary: `line` is
  -- NULL on match winner and Postgres forces NOT NULL on PRIMARY KEY columns,
  -- so the ruled grain cannot be a plain PK. Requires PG >= 15 (this instance
  -- is 17.6).
  CONSTRAINT odds_card_state_grain
    UNIQUE NULLS NOT DISTINCT (fixture_id, book, market, side, line),
  CONSTRAINT odds_card_state_id_space_ck
    CHECK (id_space IN ('oddspapi', 'api-tennis', 'kibl')),
  CONSTRAINT odds_card_state_source_ck
    CHECK (source IN ('oddspapi', 'api-tennis', 'kibl')),
  CONSTRAINT odds_card_state_ts_kind_ck
    CHECK (ts_kind IS NULL
           OR ts_kind IN ('vendor-insert', 'book-tick', 'sighting')),
  -- The ruled rank, pinned to the source so a filler cannot promote itself.
  CONSTRAINT odds_card_state_rank_ck
    CHECK ((source = 'kibl'       AND book_rank = 1)
        OR (source = 'oddspapi'   AND book_rank = 2)
        OR (source = 'api-tennis' AND book_rank = 3)),
  -- "Open, Now and Close always from the SAME book" is structural here: one row
  -- carries all three and one row has one book. What the constraint CAN catch is
  -- a row selected for rendering that has nothing to render.
  CONSTRAINT odds_card_state_selected_ck
    CHECK (NOT is_selected
           OR open_price IS NOT NULL
           OR now_price IS NOT NULL
           OR close_price IS NOT NULL),
  CONSTRAINT odds_card_state_start_src_ck
    CHECK (start_ts_source IN ('oddspapi', 'api-tennis-live', 'none')),
  -- Michael: the fallback is "shown with label 'last seen'". Make the pairing
  -- structural rather than a convention the filler is trusted to follow.
  CONSTRAINT odds_card_state_label_ck
    CHECK (source <> 'api-tennis' OR label = 'last seen'),
  -- A price without its timestamp is unrenderable: the design shows Open and
  -- Now WITH their times. Reject the half-populated state at write time.
  CONSTRAINT odds_card_state_open_ck
    CHECK ((open_price IS NULL) = (open_ts IS NULL)),
  CONSTRAINT odds_card_state_now_ck
    CHECK ((now_price IS NULL) = (now_ts IS NULL)),
  CONSTRAINT odds_card_state_close_ck
    CHECK ((close_price IS NULL) = (close_ts IS NULL)),
  -- A close cut at a start we do not have is a contradiction.
  CONSTRAINT odds_card_state_close_needs_start_ck
    CHECK (close_price IS NULL OR start_ts IS NOT NULL),
  -- A reason must be one we ruled. Same enumeration as the line summary, and
  -- kept in step with it by test-ten225-load-line-summary.py, which reads BOTH
  -- files and the loader and fails if the three disagree.
  CONSTRAINT odds_card_state_reject_ck
    CHECK (start_reject_reason IS NULL
           OR start_reject_reason IN ('implausible_duration',
                                      'implausible_early_start',
                                      'end_before_start',
                                      'itf_uncorroborated_start'))
);

-- Idempotent migration for any instance that predates a column above.
ALTER TABLE odds_card_state
  ADD COLUMN IF NOT EXISTS start_reject_reason text,
  ADD COLUMN IF NOT EXISTS start_ts            timestamptz,
  ADD COLUMN IF NOT EXISTS id_space            text,
  ADD COLUMN IF NOT EXISTS match_key           text,
  ADD COLUMN IF NOT EXISTS book_rank           smallint NOT NULL DEFAULT 99,
  ADD COLUMN IF NOT EXISTS is_selected         boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ts_kind             text,
  ADD COLUMN IF NOT EXISTS open_observed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS now_observed_at     timestamptz;

ALTER TABLE odds_card_state
  DROP CONSTRAINT IF EXISTS odds_card_state_reject_ck;
ALTER TABLE odds_card_state
  ADD CONSTRAINT odds_card_state_reject_ck
  CHECK (start_reject_reason IS NULL
         OR start_reject_reason IN ('implausible_duration',
                                    'implausible_early_start',
                                    'end_before_start',
                                    'itf_uncorroborated_start'));

-- The constraints added with the book-priority columns, applied idempotently to
-- an instance that already carries the table. Each is dropped first so a rerun
-- after a rule change replaces the old rule rather than failing on the name.
--
-- ⚠️ ORDER MATTERS. book_rank defaults to 99 and the rank check permits only
-- 1/2/3, so every pre-existing row has to be backfilled to its ruled rank BEFORE
-- the check is added or the ALTER fails on legacy data. Any row whose source we
-- do not recognise would still fail — correctly: that is an unruled source.
UPDATE odds_card_state SET book_rank = 1 WHERE source = 'kibl'       AND book_rank <> 1;
UPDATE odds_card_state SET book_rank = 2 WHERE source = 'oddspapi'   AND book_rank <> 2;
UPDATE odds_card_state SET book_rank = 3 WHERE source = 'api-tennis' AND book_rank <> 3;

-- ---------------------------------------------------------------------------
-- THE GRAIN CONSTRAINT MUST BE `NULLS NOT DISTINCT`, AND ON A PRE-EXISTING
-- TABLE IT MIGHT NOT BE.
--
-- `line` is NULL on every match-winner row. Under a PLAIN unique constraint,
-- NULL <> NULL, so no two of those rows ever collide: every upsert takes the
-- INSERT branch of ON CONFLICT and the table grows a duplicate set per run
-- instead of updating. Nothing errors. Nothing logs. The row count doubles.
--
-- `CREATE TABLE IF NOT EXISTS` above cannot fix a table that already exists, so
-- the property is checked and repaired here. The DELETE only ever runs on an
-- instance that HAS the wrong index — which is an instance that necessarily
-- already holds duplicates — and it keeps the newest row of each grain. This
-- table is a projection: everything in it is rebuildable from the archives.
DO $$
DECLARE nnd boolean;
BEGIN
  SELECT i.indnullsnotdistinct INTO nnd
    FROM pg_constraint c JOIN pg_index i ON i.indexrelid = c.conindid
   WHERE c.conrelid = 'odds_card_state'::regclass
     AND c.conname  = 'odds_card_state_grain';

  IF nnd IS DISTINCT FROM true THEN
    RAISE WARNING 'odds_card_state_grain is not NULLS NOT DISTINCT (%) — repairing', nnd;
    ALTER TABLE odds_card_state DROP CONSTRAINT IF EXISTS odds_card_state_grain;
    DELETE FROM odds_card_state a
     USING odds_card_state b
     WHERE a.ctid < b.ctid
       AND a.fixture_id IS NOT DISTINCT FROM b.fixture_id
       AND a.book       IS NOT DISTINCT FROM b.book
       AND a.market     IS NOT DISTINCT FROM b.market
       AND a.side       IS NOT DISTINCT FROM b.side
       AND a.line       IS NOT DISTINCT FROM b.line;
    ALTER TABLE odds_card_state
      ADD CONSTRAINT odds_card_state_grain
      UNIQUE NULLS NOT DISTINCT (fixture_id, book, market, side, line);
  END IF;
END $$;

ALTER TABLE odds_card_state DROP CONSTRAINT IF EXISTS odds_card_state_id_space_ck;
ALTER TABLE odds_card_state ADD CONSTRAINT odds_card_state_id_space_ck
  CHECK (id_space IN ('oddspapi', 'api-tennis', 'kibl'));
ALTER TABLE odds_card_state DROP CONSTRAINT IF EXISTS odds_card_state_source_ck;
ALTER TABLE odds_card_state ADD CONSTRAINT odds_card_state_source_ck
  CHECK (source IN ('oddspapi', 'api-tennis', 'kibl'));
ALTER TABLE odds_card_state DROP CONSTRAINT IF EXISTS odds_card_state_ts_kind_ck;
ALTER TABLE odds_card_state ADD CONSTRAINT odds_card_state_ts_kind_ck
  CHECK (ts_kind IS NULL OR ts_kind IN ('vendor-insert', 'book-tick', 'sighting'));
ALTER TABLE odds_card_state DROP CONSTRAINT IF EXISTS odds_card_state_rank_ck;
ALTER TABLE odds_card_state ADD CONSTRAINT odds_card_state_rank_ck
  CHECK ((source = 'kibl'       AND book_rank = 1)
      OR (source = 'oddspapi'   AND book_rank = 2)
      OR (source = 'api-tennis' AND book_rank = 3));
ALTER TABLE odds_card_state DROP CONSTRAINT IF EXISTS odds_card_state_selected_ck;
ALTER TABLE odds_card_state ADD CONSTRAINT odds_card_state_selected_ck
  CHECK (NOT is_selected
         OR open_price IS NOT NULL
         OR now_price IS NOT NULL
         OR close_price IS NOT NULL);

ALTER TABLE odds_card_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON odds_card_state FROM anon, authenticated;

-- The three surfaces read this table two ways: "the match-winner rows for these
-- fixtures" (Results, Today's Matches) and "today's biggest open->now move"
-- (Biggest Market Move). Index those two paths and nothing speculative.
CREATE INDEX IF NOT EXISTS odds_card_state_fixture_market_idx
  ON odds_card_state (fixture_id, market);
CREATE INDEX IF NOT EXISTS odds_card_state_move_idx
  ON odds_card_state (market, now_ts)
  WHERE open_price IS NOT NULL AND now_price IS NOT NULL;
-- The selection pass's own query: every source row for one match, in rank order.
CREATE INDEX IF NOT EXISTS odds_card_state_select_idx
  ON odds_card_state (match_key, market, side, line, book_rank);
