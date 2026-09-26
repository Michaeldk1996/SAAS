-- TEN-295 (TEN-287 Wave 1, founder 2026-09-26 card 89e3671d) — chart_book_series().
--
-- The odds-api.io books the recorder holds in the PRIVATE schema ten287_rec, as the
-- odds-movement chart needs them: per event, per book, the pre-match BACK-price
-- changes with the vendor's own `updatedAt`. build-chart-books.py calls it with the
-- service-role key every 15 min and writes the series into m.oddsMovement.chart.
--
-- Tests (test-ten295-chart-books.py reads this file):
--   * books come from ten287_rec.config.books — a slot swap (e.g. to Bet365) needs no
--     code change here;
--   * pre-match only: a tick counts only while the vendor says `pending` AND before the
--     event's first non-pending sighting on ANY book (the vendor flips live -> pending
--     mid-match, measured 2026-09-26, so a later `pending` is not pre-match);
--   * same-price re-stamps collapse: a row is returned only when (back_home, back_away)
--     differs from the previous row of that event and book;
--   * polled_ok_at[book] = the recorder's last processed HTTP 200 poll for that book —
--     the writer never claims a check newer than the recorder's own;
--   * service_role only. anon / authenticated cannot execute it; the members read the
--     published shard, never this function.
create or replace function public.chart_book_series(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  with cfg as (
    select c.books from ten287_rec.config c where c.id
  ),
  ev as (
    select e.event_id, e.home, e.away, e.start_at, e.tier
    from ten287_rec.events e
    where e.tier is not null                      -- ATP | Challenger | ITF Men; NULL = other / doubles
      and e.start_at >= p_from and e.start_at < p_to
    order by e.start_at
    limit 3000
  ),
  live_from as (
    select t.event_id, min(least(coalesce(t.book_updated_at, t.seen_at), t.seen_at)) as at
    from ten287_rec.ticks t join ev using (event_id)
    where t.event_status is distinct from 'pending'
    group by t.event_id
  ),
  tk as (
    select t.id, t.event_id, t.book, t.book_updated_at as at, t.back_home, t.back_away,
           lag(t.back_home) over w as prev_home, lag(t.back_away) over w as prev_away
    from ten287_rec.ticks t
    join ev using (event_id)
    left join live_from lf using (event_id)
    where t.market = 'ML'
      and exists (select 1 from cfg where t.book = any (cfg.books))
      and t.event_status = 'pending'
      and t.book_updated_at is not null
      and (lf.at is null or t.book_updated_at < lf.at)
    window w as (partition by t.event_id, t.book order by t.book_updated_at, t.id)
  ),
  ch as (
    select id, event_id, book, at, back_home, back_away,
           row_number() over (partition by event_id, book order by at desc, id desc) as rn_desc
    from tk
    where prev_home is distinct from back_home or prev_away is distinct from back_away
  ),
  per_book as (
    select event_id, book,
           jsonb_agg(jsonb_build_array(at, back_home, back_away) order by at, id) as rows
    from ch
    where rn_desc <= 3000
    group by event_id, book
  ),
  per_event as (
    select ev.event_id, ev.home, ev.away, ev.start_at, ev.tier, lf.at as live_from,
           jsonb_object_agg(pb.book, pb.rows) as books
    from ev
    join per_book pb using (event_id)
    left join live_from lf using (event_id)
    group by ev.event_id, ev.home, ev.away, ev.start_at, ev.tier, lf.at
  )
  select jsonb_build_object(
    'generated_at', now(),
    'books', coalesce((select to_jsonb(cfg.books) from cfg), '[]'::jsonb),
    'polled_ok_at', coalesce((
        select jsonb_object_agg(b.book, (select max(q.processed_at) from ten287_rec.requests q
                                          where q.kind = 'updated' and q.book = b.book
                                            and q.status_code = 200))
        from cfg, unnest(cfg.books) as b(book)), '{}'::jsonb),
    'kibl_sweep_ok_at', (select max(s.started_at) from public.kibl_sweeps s where s.ok),
    'events', coalesce((select jsonb_agg(to_jsonb(pe) order by pe.start_at, pe.event_id)
                        from per_event pe), '[]'::jsonb)
  );
$fn$;
revoke all on function public.chart_book_series(timestamptz, timestamptz) from public;
revoke all on function public.chart_book_series(timestamptz, timestamptz) from anon, authenticated;
grant execute on function public.chart_book_series(timestamptz, timestamptz) to service_role;
