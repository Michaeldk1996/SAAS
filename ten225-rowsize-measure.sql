-- TEN-225 step 2 of 3 — READ the measurement. One result set, no writes.
--
-- bytes_per_row is pg_total_relation_size (heap + indexes + any toast) divided
-- by the row count that actually landed, so an ON CONFLICT drop cannot inflate
-- it. db_size_bytes is carried on every row so the "25% of the 8 GB database"
-- line is checked against what the instance reports rather than assumed.
--
-- gb_per_year_* are filled in by the caller, not here: rows/yr comes from
-- ten225-summary-sizing.py. This file is only the row cost.

SELECT
  v.variant,
  v.rows,
  v.heap_bytes,
  v.index_bytes,
  v.total_bytes,
  round(v.total_bytes::numeric / nullif(v.rows, 0), 1) AS bytes_per_row,
  round(v.heap_bytes::numeric  / nullif(v.rows, 0), 1) AS heap_bytes_per_row,
  round(v.index_bytes::numeric / nullif(v.rows, 0), 1) AS index_bytes_per_row,
  pg_database_size(current_database())                 AS db_size_bytes,
  round(pg_database_size(current_database())::numeric / 1073741824, 3)
                                                       AS db_size_gib,
  current_setting('server_version')                    AS server_version
FROM (
  SELECT 'v1_text_as_ruled' AS variant,
         (SELECT count(*) FROM _ten225_summary_v1)  AS rows,
         pg_relation_size('_ten225_summary_v1')     AS heap_bytes,
         pg_indexes_size('_ten225_summary_v1')      AS index_bytes,
         pg_total_relation_size('_ten225_summary_v1') AS total_bytes
  UNION ALL
  SELECT 'v2_coded_narrow',
         (SELECT count(*) FROM _ten225_summary_v2),
         pg_relation_size('_ten225_summary_v2'),
         pg_indexes_size('_ten225_summary_v2'),
         pg_total_relation_size('_ten225_summary_v2')
) AS v
ORDER BY v.variant;
