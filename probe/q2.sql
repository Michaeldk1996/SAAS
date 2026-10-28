select event_key, first_player||' v '||second_player m, tournament_name t,
       to_char(first_live_seen_at,'MM-DD HH24:MI:SS') flag, to_char(play_seen_at,'HH24:MI:SS') play,
       round(extract(epoch from play_seen_at-first_live_seen_at)) lag_s, last_not_live_seen_at is not null lb
  from live_flip_log
 where first_live_seen_at >= '2026-10-27 03:30'
   and (event_type_type ilike '%atp singles%' or event_type_type ilike '%challenger men singles%')
 order by first_live_seen_at;
