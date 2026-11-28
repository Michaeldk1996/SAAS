-- the reader's read time with the CURRENT lines(), measured inside the guarded install's transaction, before the new
-- definition replaces it (tools/ten294-steps-lines.json): the guard compares the two
create temp table _lines_t0 on commit drop as select clock_timestamp() t;
select length(drops_api.snapshot(72)::text) > 0 as read_ok;
create temp table _lines_d0 on commit drop as select clock_timestamp() - (select t from _lines_t0) before_d;
