REF=$(printf '%s' "$SUPABASE_URL" | sed -E 's#https?://([^./]+)\.supabase\.co/?.*#\1#')
q() { jq -n --arg q "$1" '{query: $q}' | curl -sS -m 280 -X POST -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' --data @- "https://api.supabase.com/v1/projects/$REF/database/query" | jq -r 'if type=="array" then .[]|tostring else tostring end' 2>/dev/null || echo FAIL; echo ---; }
echo "== functions"
q "select n.nspname, p.proname, (pg_get_functiondef(p.oid) like '%load_ticks_live%') uses_live from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('ten280_bot','ten287_bot') and p.proname in ('tick','load_ticks_live')"
q "select * from ten280_bot.tick_cache_state"
echo "== 10-min buckets since 01:30"
q "select to_timestamp(floor(extract(epoch from d.start_time)/600)*600) b, j.jobname, count(*) n, round(avg(extract(epoch from d.end_time-d.start_time))::numeric,1) avg_s, sum((d.status<>'succeeded')::int) bad from cron.job_run_details d join cron.job j using(jobid) where d.start_time > '2026-11-06 01:30Z' and j.jobname in ('ten280-bet105-drop-bot','ten287-superbet-drop-bot','poly-drop-bot','kalshi-drop-bot') group by 1,2 order by 2,1"
echo "== alerts last 3h by bot"
q "select 'ten280' bot, date_trunc('hour',created_at) h, count(*) from ten280_bot.alerts where mode='live' and created_at>now()-interval '3 hours' group by 1,2 union all select 'ten287:'||book, date_trunc('hour',created_at), count(*) from ten287_bot.alerts where mode='live' and created_at>now()-interval '3 hours' group by 1,2 order by 1,2"
SNAP="select userid, dbid, queryid, calls, total_exec_time, shared_blks_read, temp_blks_read+temp_blks_written temp_blks, left(regexp_replace(query,'\s+',' ','g'),110) q from extensions.pg_stat_statements"
q "drop table if exists public._probe_pss; create table public._probe_pss as $SNAP"
sleep 240
echo "== 4-min deltas"
q "with n as ($SNAP) select n.q, n.calls-o.calls calls, round((n.total_exec_time-o.total_exec_time)::numeric/greatest(n.calls-o.calls,1)) ms_call, round(((n.shared_blks_read-o.shared_blks_read)*8/1024.0)::numeric,1) mb_read from n join public._probe_pss o using(userid,dbid,queryid) where n.calls>o.calls order by n.shared_blks_read-o.shared_blks_read desc limit 12"
q "with n as ($SNAP) select round(sum(n.shared_blks_read-o.shared_blks_read)*8/1024.0/240,2) mb_s_read from n join public._probe_pss o using(userid,dbid,queryid)"
q "drop table public._probe_pss"
