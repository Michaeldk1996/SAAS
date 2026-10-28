select (select count(*) from live_flip_pending) pending_n, s.* from live_flip_stats s;
