REF=$(printf '%s' "$SUPABASE_URL" | sed -E 's#https?://([^./]+)\.supabase\.co/?.*#\1#')
q() { jq -n --arg q "$1" '{query: $q}' | curl -sS -m 200 -X POST -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' --data @- "https://api.supabase.com/v1/projects/$REF/database/query" | jq -r 'if type=="array" then .[]|tostring else tostring end' 2>/dev/null || echo FAIL; echo ---; }
echo "== hourly cron durations, last 36h, jobs by name"
q "select date_trunc('hour', d.start_time) h, j.jobname, count(*) n, round(avg(extract(epoch from d.end_time-d.start_time))::numeric,1) avg_s, round(max(extract(epoch from d.end_time-d.start_time))::numeric,1) max_s, sum((d.status<>'succeeded')::int) bad from cron.job_run_details d join cron.job j using(jobid) where d.start_time > now()-interval '36 hours' and j.jobname ~ '(ten280|ten287|bet105|drop|tick)' group by 1,2 order by 2,1"
echo "== which functions the bot ticks call now"
q "select n.nspname, p.proname, (pg_get_functiondef(p.oid) like '%load_ticks_live%') uses_live from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('ten280_bot','ten287_bot') and p.proname in ('tick','load_ticks_live')"
