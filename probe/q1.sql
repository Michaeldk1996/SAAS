-- per day, ATP/Challenger singles, since 22 Oct
select (first_live_seen_at at time zone 'UTC')::date as day,
       case when event_type_type ilike '%challenger%' then 'CH' else 'ATP' end as lvl,
       count(*) n,
       count(*) filter (where last_not_live_seen_at is null) no_lb,
       count(*) filter (where play_seen_at is null) no_play_seen,
       count(*) filter (where play_seen_at = first_live_seen_at) same_tick,
       round(percentile_cont(0.5) within group (order by extract(epoch from play_seen_at-first_live_seen_at))::numeric,0) p50,
       round(percentile_cont(0.9) within group (order by extract(epoch from play_seen_at-first_live_seen_at))::numeric,0) p90,
       round(min(extract(epoch from play_seen_at-first_live_seen_at))::numeric,0) mn,
       round(max(extract(epoch from play_seen_at-first_live_seen_at))::numeric,0) mx
  from live_flip_log
 where first_live_seen_at >= '2026-10-22'
   and (event_type_type ilike '%atp singles%' or event_type_type ilike '%challenger men singles%')
 group by 1,2 order by 1,2;
