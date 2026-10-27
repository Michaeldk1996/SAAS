-- False 0-0 starts (founder brief 2026-10-27, approved write: 3 rows, with reason). Supersedes the three live_flip_log
-- starts that were taken from a 0-0 live flag before any point was played. No live_flip_log row is edited or deleted.
--
-- A key is written only if its live_flip_log row is still the false start measured on 2026-10-26: first live sighting
-- within 12:18:31–12:18:32Z on 26 Oct. Any other row for these keys is left alone, and the counts printed say so.
-- ON CONFLICT DO NOTHING: re-running adds nothing. Evidence = what was measured; nothing in it is inferred.
with want(event_key, true_start, oddspapi_id) as (values
  ('12173975', '2026-10-26T12:35:29.147Z', 'id1200310375989928'),   -- Berrettini
  ('12174058', '2026-10-26T12:35:28.438Z', 'id1200261375991570'),   -- Vacherot
  ('12174272', '2026-10-26T12:24:19.152Z', 'id1201312576029688')    -- Echargui
), hit as (
  select w.*, f.first_live_seen_at, f.last_not_live_seen_at
    from want w join public.live_flip_log f on f.event_key = w.event_key
   where f.first_live_seen_at >= '2026-10-26T12:18:31Z' and f.first_live_seen_at < '2026-10-26T12:18:32Z'
), ins as (
  insert into public.live_flip_log_superseded (event_key, reason, evidence)
  select h.event_key,
         'false 0-0 start: the live flag was set before any point was played; the real start (oddspapi trueStart) is later',
         jsonb_build_object('first_live_seen_at', h.first_live_seen_at, 'last_not_live_seen_at', h.last_not_live_seen_at,
                            'oddspapi_fixture', h.oddspapi_id, 'oddspapi_true_start', h.true_start,
                            'brief', 'False 0-0 starts, founder approval 2026-10-27')
    from hit h
  on conflict (event_key) do nothing
  returning event_key
)
select (select count(*) from want) wanted,
       (select count(*) from hit) matched_false_start,
       (select count(*) from ins) inserted,
       (select count(*) from public.live_flip_log_superseded) superseded_before,   -- one statement = one snapshot:
       (select count(*) from public.live_flip_log) live_flip_log_rows;                -- the totals after are read below
select (select count(*) from public.live_flip_log_superseded) superseded_after,
       (select count(*) from public.live_flip_log) live_flip_log_rows,
       (select count(*) from public.live_flip_log_current) live_flip_log_current_rows;
