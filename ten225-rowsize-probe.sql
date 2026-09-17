-- TEN-225 step 1 of 3 — BUILD the scratch tables for the bytes/row measurement.
--
-- Michael's ruling (2026-09-17T07:33Z): "Before loading: project rows per
-- fixture and GB per year for this table. Stop and report only if it passes
-- 25% of the 8 GB database per year."
--
-- Rows/fixture and fixtures/yr are measured from the API by
-- ten225-summary-sizing.py. This supplies the third factor, bytes/row, and it
-- is MEASURED on this instance rather than carried over: TEN-216's 377.7 B/row
-- was measured on a different table shape (per-tick, fewer and narrower
-- columns) and a threshold does not transfer between measurements.
--
-- SAFETY — touches nothing that exists. Both relations are prefixed _ten225_,
-- are created by this file and dropped by ten225-rowsize-drop.sql, which the
-- workflow runs with `if: always()`. No existing table, policy, publication or
-- pg_cron job is modified. Run as three separate statements because the
-- Management API query endpoint returns one result set per request.
--
-- SCHEMA FINDING, reported not silently patched: Michael's grain is
-- "one row per fixture + book + market + side + line", but `line` is NULL on
-- match winner (oddspapi has no line field there — the line is encoded in the
-- marketId, so match winner simply has none). A Postgres PRIMARY KEY forces
-- NOT NULL on every column, so the grain cannot be a plain PK. Expressed here
-- as UNIQUE NULLS NOT DISTINCT, which treats two NULL lines as the same key —
-- the behaviour the grain intends. Needs Postgres >= 15; if the instance is
-- older the fallback is a NOT NULL line with a sentinel, which is uglier and
-- changes what a dash means. The measurement below covers the index either way.

DROP TABLE IF EXISTS _ten225_summary_v1;
DROP TABLE IF EXISTS _ten225_summary_v2;

-- ---------------------------------------------------------------------------
-- V1 — the schema exactly as ruled: readable text for book / market / side.
-- ---------------------------------------------------------------------------
CREATE TABLE _ten225_summary_v1 (
  fixture_id              text        not null,
  book                    text        not null,
  market                  text        not null,
  side                    text        not null,
  line                    numeric,
  open_price              numeric     not null,
  open_ts                 timestamptz not null,
  close_price             numeric,
  close_ts                timestamptz,
  close_lag_minutes       numeric,
  pre_start_tick_count    integer     not null,
  first_tick_ts           timestamptz not null,
  last_pre_start_tick_ts  timestamptz,
  source                  text        not null,
  close_reliable          boolean     not null,
  constraint _ten225_v1_grain
    unique nulls not distinct (fixture_id, book, market, side, line)
);

-- 400k rows. Postgres bills varlena text by content length and the unique
-- index bills the concatenated key, so the generators reproduce the real
-- shapes rather than filler: 18-char oddspapi fixture ids, the four family
-- names Michael listed, and correct-score side labels.
--
-- The family mix is weighted the way the payload measured out on TEN-225, NOT
-- flat: set betting (Correct Score) carries far more sides per fixture than
-- match winner (median 152 vs 86 pre-start series in the A.2 family split), so
-- a flat mix would size the wrong table. 40% set betting / 20% each for the
-- other three. If ten225-summary-sizing.py lands a materially different split,
-- this weighting is the thing to re-run.
INSERT INTO _ten225_summary_v1
SELECT
  'id12002591' || lpad((g / 400)::text, 8, '0'),
  'bet365',
  fam,
  CASE fam
    WHEN 'match winner'   THEN CASE g % 2 WHEN 0 THEN 'p1' ELSE 'p2' END
    WHEN 'games handicap' THEN CASE g % 2 WHEN 0 THEN 'p1' ELSE 'p2' END
    WHEN 'total games'    THEN CASE g % 2 WHEN 0 THEN 'over' ELSE 'under' END
    ELSE ((g / 7) % 7)::text || '-' || ((g / 3) % 7)::text
  END,
  CASE fam
    WHEN 'match winner' THEN NULL
    WHEN 'total games'  THEN (20.5 + ((g / 2) % 14))::numeric
    ELSE (-6.5 + ((g / 2) % 13))::numeric
  END,
  1.01 + ((g % 900)::numeric / 100),
  now() - (g % 4000) * interval '1 minute',
  CASE WHEN g % 5 = 0 THEN NULL ELSE 1.01 + ((g % 850)::numeric / 100) END,
  CASE WHEN g % 5 = 0 THEN NULL ELSE now() - (g % 90) * interval '1 minute' END,
  CASE WHEN g % 5 = 0 THEN NULL ELSE (g % 240)::numeric / 4 END,
  1 + (g % 180),
  now() - (g % 5000) * interval '1 minute',
  CASE WHEN g % 5 = 0 THEN NULL ELSE now() - (g % 90) * interval '1 minute' END,
  CASE WHEN g % 11 = 0 THEN 'bet365-history' ELSE 'oddspapi-raw' END,
  (g % 5) <> 0
FROM generate_series(1, 400000) AS g,
     LATERAL (SELECT CASE
       WHEN g % 10 < 2 THEN 'match winner'
       WHEN g % 10 < 4 THEN 'games handicap'
       WHEN g % 10 < 6 THEN 'total games'
       ELSE 'set betting' END AS fam) AS f
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- V2 — same grain, same information, narrow keys: book/market/side/source as
-- smallint codes ("books are config" is already Michael's locked definition,
-- so a code column costs no flexibility) and the 18-char fixture id as the
-- bigint embedded in it. Measured so the readable-vs-narrow choice is a
-- measured one and not a preference.
-- ---------------------------------------------------------------------------
CREATE TABLE _ten225_summary_v2 (
  fixture_id              bigint       not null,
  book_id                 smallint     not null,
  market_id               smallint     not null,
  side_id                 smallint     not null,
  line                    numeric(5,2),
  open_price              numeric(7,3) not null,
  open_ts                 timestamptz  not null,
  close_price             numeric(7,3),
  close_ts                timestamptz,
  close_lag_minutes       integer,
  pre_start_tick_count    integer      not null,
  first_tick_ts           timestamptz  not null,
  last_pre_start_tick_ts  timestamptz,
  source_id               smallint     not null,
  close_reliable          boolean      not null,
  constraint _ten225_v2_grain
    unique nulls not distinct (fixture_id, book_id, market_id, side_id, line)
);

INSERT INTO _ten225_summary_v2
SELECT
  1200259100000000::bigint + (g / 400),
  1::smallint,
  m,
  (g % 49)::smallint,
  CASE WHEN m = 1 THEN NULL ELSE (-6.5 + ((g / 2) % 13))::numeric(5,2) END,
  (1.01 + ((g % 900)::numeric / 100))::numeric(7,3),
  now() - (g % 4000) * interval '1 minute',
  CASE WHEN g % 5 = 0 THEN NULL
       ELSE (1.01 + ((g % 850)::numeric / 100))::numeric(7,3) END,
  CASE WHEN g % 5 = 0 THEN NULL ELSE now() - (g % 90) * interval '1 minute' END,
  CASE WHEN g % 5 = 0 THEN NULL ELSE (g % 60) END,
  1 + (g % 180),
  now() - (g % 5000) * interval '1 minute',
  CASE WHEN g % 5 = 0 THEN NULL ELSE now() - (g % 90) * interval '1 minute' END,
  CASE WHEN g % 11 = 0 THEN 2::smallint ELSE 1::smallint END,
  (g % 5) <> 0
FROM generate_series(1, 400000) AS g,
     LATERAL (SELECT CASE
       WHEN g % 10 < 2 THEN 1
       WHEN g % 10 < 4 THEN 2
       WHEN g % 10 < 6 THEN 3
       ELSE 4 END::smallint AS m) AS f
ON CONFLICT DO NOTHING;

ANALYZE _ten225_summary_v1;
ANALYZE _ten225_summary_v2;
