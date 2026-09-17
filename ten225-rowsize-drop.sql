-- TEN-225 step 3 of 3 — remove the scratch tables. Runs with `if: always()`
-- so a failure in step 1 or 2 still leaves the instance exactly as it was.
DROP TABLE IF EXISTS _ten225_summary_v1;
DROP TABLE IF EXISTS _ten225_summary_v2;
