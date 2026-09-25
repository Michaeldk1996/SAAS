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
  -- TEN-253 (founder 2026-09-23, ruling 2): the Close is the last real price
  -- seen before the actual start, SHOWN even when older than 60 minutes. This
  -- flag says whether it is within 60 minutes of the start (and, when cut at
  -- the live flip, within the 300 s gap limb). CLV, ROI, price movement and
  -- Biggest Market Move use a close ONLY when this is TRUE. NULL exactly when
  -- there is no close.
  close_within_60   boolean,

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
  --
  -- ⚠️ api-tennis is `>= 3`, NOT `= 3`, and that is the whole point. It is the
  -- one source that carries MORE THAN ONE BOOK: its bet365 rows at 3 and every
  -- other book (BetVictor, Betano, 1xBet, …) at 4. A `= 3` check rejected every
  -- one of those, which is why the card fill died mid-upsert on five
  -- consecutive nightly runs from 2026-09-18 (TEN-257) and left the table
  -- ~1,116 rows short.
  --
  -- The constraint's JOB is unchanged: a source may never claim a rank ABOVE
  -- its tier. `>= 3` still forbids api-tennis from claiming 1 or 2. Ordering
  -- WITHIN a tier is the loader's business, not the database's.
  CONSTRAINT odds_card_state_rank_ck
    CHECK ((source = 'kibl'       AND book_rank = 1)
        OR (source = 'oddspapi'   AND book_rank = 2)
        OR (source = 'api-tennis' AND book_rank >= 3)),
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
-- ⚠️ ORDER MATTERS. book_rank defaults to 99, so every pre-existing row has to
-- be backfilled to its ruled rank BEFORE the check is added or the ALTER fails
-- on legacy data. Any row whose source we do not recognise would still fail —
-- correctly: that is an unruled source.
--
-- ⚠️ AND THE api-tennis BACKFILL IS `= 99`, NOT `<> 3`. It used to be `<> 3`,
-- which flattened EVERY api-tennis row to rank 3 — including the rank-4
-- other-book rows the widened constraint now exists to admit. Left as `<> 3`
-- this statement would have silently undone the constraint fix on every single
-- schema apply, and the multi-book ordering would have collapsed back to one
-- tier while the constraint looked correct. Only the legacy DEFAULT is coerced.
UPDATE odds_card_state SET book_rank = 1 WHERE source = 'kibl'       AND book_rank <> 1;
UPDATE odds_card_state SET book_rank = 2 WHERE source = 'oddspapi'   AND book_rank <> 2;
UPDATE odds_card_state SET book_rank = 3 WHERE source = 'api-tennis' AND book_rank = 99;

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
      OR (source = 'api-tennis' AND book_rank >= 3));
ALTER TABLE odds_card_state DROP CONSTRAINT IF EXISTS odds_card_state_selected_ck;
ALTER TABLE odds_card_state ADD CONSTRAINT odds_card_state_selected_ck
  CHECK (NOT is_selected
         OR open_price IS NOT NULL
         OR now_price IS NOT NULL
         OR close_price IS NOT NULL);

-- TEN-253 ruling 2 — the within-60 flag. Every close stored before this column
-- existed passed the 60-minute rule (the old loaders NULLED any close that did
-- not), so the backfill to TRUE states a fact about those rows, not a guess.
-- It runs BEFORE the pairing CHECK below, which it is what makes satisfiable.
ALTER TABLE odds_card_state ADD COLUMN IF NOT EXISTS close_within_60 boolean;
UPDATE odds_card_state SET close_within_60 = TRUE
  WHERE close_price IS NOT NULL AND close_within_60 IS NULL;
UPDATE odds_card_state SET close_within_60 = NULL
  WHERE close_price IS NULL AND close_within_60 IS NOT NULL;
ALTER TABLE odds_card_state DROP CONSTRAINT IF EXISTS odds_card_state_close_w60_ck;
ALTER TABLE odds_card_state ADD CONSTRAINT odds_card_state_close_w60_ck
  CHECK ((close_price IS NULL) = (close_within_60 IS NULL));

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

-- ---------------------------------------------------------------------------
-- TEN-270 EGRESS — updated_at MEANS "last changed", ENFORCED HERE.
--
-- Until now updated_at was DEFAULT now() with no trigger, so it froze at insert
-- and no reader could ask "what changed since my last read". The Kibl card job
-- (ten225-kibl-card-state.py read_card_state) now reads only rows with
-- updated_at past its high-water mark and merges them onto a cached snapshot —
-- which is only equal to a full read if EVERY write moves this column. So the
-- database does it, not the writers: an INSERT always stamps now(); an UPDATE
-- stamps now() only when some OTHER column really changed (a no-op upsert
-- leaves the row, and the delta, alone). Covers every writer, including the
-- backfill UPDATEs in this file. Writers never send updated_at; if one did, the
-- INSERT trigger overrides it with the server clock, so a runner's clock can
-- never become the mark.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION odds_card_state_touch() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER odds_card_state_touch_ins
  BEFORE INSERT ON odds_card_state
  FOR EACH ROW EXECUTE FUNCTION odds_card_state_touch();

CREATE OR REPLACE TRIGGER odds_card_state_touch_upd
  BEFORE UPDATE ON odds_card_state
  FOR EACH ROW
  WHEN ((to_jsonb(OLD) - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at'))
  EXECUTE FUNCTION odds_card_state_touch();

-- The delta read's filter.
CREATE INDEX IF NOT EXISTS odds_card_state_updated_idx
  ON odds_card_state (updated_at);

-- ---------------------------------------------------------------------------
-- TEN-270 review finding 4 — THE CARD JOB ASKS WHETHER THE TRIGGERS EXIST.
--
-- Every cache in ten225-kibl-card-state.py is only equal to a full read if the
-- table's touch trigger is installed and enabled. odds_card_state's are above
-- and this file runs before every card run; oddspapi_fixtures' and
-- oddspapi_line_summary's live in ten225-line-summary-schema.sql, which only
-- ten225-line-summary.yml applies. So the job must not ASSUME them: it calls
-- this function (service key only) and falls back to a full read, and never
-- saves a snapshot, for any table whose two triggers are not both present,
-- enabled, and calling that table's own touch function. A missing function
-- (this file not applied yet) is a 404, which the job treats the same way.
-- Reads the catalog only; changes nothing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ten270_touch_triggers()
  RETURNS TABLE (tbl text, trg text, fn text, enabled boolean)
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT c.relname::text, t.tgname::text, p.proname::text,
         t.tgenabled IN ('O', 'A')
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
    AND c.relname IN ('odds_card_state', 'oddspapi_fixtures',
                      'oddspapi_line_summary')
  ORDER BY 1, 2
$$;

REVOKE EXECUTE ON FUNCTION ten270_touch_triggers() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION ten270_touch_triggers() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION ten270_touch_triggers() TO service_role;

-- ---------------------------------------------------------------------------
-- TEN-270 re-review item 1 — THE SELECTION WRITE-BACK IS ONE TRANSACTION.
--
-- The selection pass moves a card from one book to another by deselecting the
-- old row and selecting the new one. Sent as two requests, the gap between
-- them — and FOREVER if the second failed — left the card with no selected
-- book: price_history / bet365_history (granted to anon) went empty and a
-- publish showed "—". This function takes the run's whole change list,
-- applies every deselect and then every select inside the single transaction
-- PostgREST wraps an RPC call in, and RAISES unless each change matched
-- exactly one row. A raise rolls back the lot: all or nothing.
--
-- It writes is_selected and NOTHING else — no price column is named, so a
-- stale price from the job's snapshot cannot reach the table.
-- p = [{"fixture_id","book","market","side","line","is_selected"}, ...].
-- SECURITY DEFINER with a pinned search_path (every name below is qualified),
-- executable by service_role only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ten270_set_selected(p jsonb)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  e     jsonb;
  v     boolean;
  n     integer;
  total integer := 0;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'array' THEN
    RAISE EXCEPTION 'ten270_set_selected: expected a JSON array';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p) x
              WHERE jsonb_typeof(x->'is_selected') IS DISTINCT FROM 'boolean') THEN
    RAISE EXCEPTION 'ten270_set_selected: every change needs a boolean is_selected';
  END IF;
  -- Deselections first, so no moment inside the transaction has two books
  -- selected on one card (the partial unique indexes, if any, never see it).
  FOREACH v IN ARRAY ARRAY[false, true] LOOP
    FOR e IN SELECT x FROM jsonb_array_elements(p) x
              WHERE (x->>'is_selected')::boolean = v LOOP
      UPDATE public.odds_card_state c
         SET is_selected = v
       WHERE c.fixture_id = e->>'fixture_id'
         AND c.book       = e->>'book'
         AND c.market     = e->>'market'
         AND c.side       = e->>'side'
         AND c.line IS NOT DISTINCT FROM (e->>'line')::numeric;
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n <> 1 THEN
        RAISE EXCEPTION 'ten270_set_selected: % matched % rows (want 1)', e, n;
      END IF;
      total := total + n;
    END LOOP;
  END LOOP;
  RETURN total;
END $$;

REVOKE EXECUTE ON FUNCTION ten270_set_selected(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION ten270_set_selected(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION ten270_set_selected(jsonb) TO service_role;

-- A new function is invisible to PostgREST until its schema cache reloads.
NOTIFY pgrst, 'reload schema';
