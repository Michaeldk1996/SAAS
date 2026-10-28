-- live sample: every live ATP/CH match on the board now, board-side play evidence vs live_pbp
with b as (select fix from live_snapshot s, jsonb_array_elements(s.board->'matches') fix
            where fix->>'event_live'='1'
              and (fix->>'event_type_type' ilike '%atp singles%' or fix->>'event_type_type' ilike '%challenger men singles%'))
select now()::time(0) t, fix->>'event_key' ek, left(fix->>'event_first_player',14)||'-'||left(fix->>'event_second_player',14) m,
       fix->>'event_status' st, fix->>'event_game_result' g, fix->>'event_serve' srv,
       (select string_agg(x->>'score_first'||':'||x->>'score_second',' ') from jsonb_array_elements(case when jsonb_typeof(fix->'scores')='array' then fix->'scores' else '[]' end) x) sc,
       match_played(fix) played_board,
       (select coalesce(sum(jsonb_array_length(case when jsonb_typeof(g2->'points')='array' then g2->'points' else '[]' end)),0)
          from live_pbp p, jsonb_array_elements(case when jsonb_typeof(p.pbp)='array' then p.pbp else '[]' end) g2 where p.event_key=fix->>'event_key') pbp_points,
       exists(select 1 from live_flip_pending q where q.event_key=fix->>'event_key') pending,
       exists(select 1 from live_flip_log l where l.event_key=fix->>'event_key') logged
  from b order by pending desc, ek;
