-- TEN-295 Wave 2 (founder rulings 2026-09-26: TEN-295 comment d5bf3dda, cards 78ec4dd2 +
-- 31e4beef) — the api-tennis books on the Odds-tab chart. STAGED: installed only after the
-- founder approves the 27 Sep 04:15Z reliability report.
--
-- 1. public.ten216_test_polls — ONE row per collector poll (tools/ten216-supabase-collector.mjs).
--    The change log writes a row only when a price moves, and api-tennis re-prices about every
--    30 min, so ~5 of every 6 polls leave no trace there (measured 26 Sep 03:55-09:13Z: 64
--    polls, 13 with change rows). Without this table "when did we last look" cannot be proved.
-- 2. public.chart_apitennis_series(p_keys, p_since) — the match-winner (Home/Away) change rows
--    of the given board cards (card id = api-tennis event key; no name matching), plus the
--    poll evidence build-chart-books.py needs:
--      last_ok_poll_at  latest successful poll (heartbeat), else the latest change row
--                       (a true lower bound: a row exists only because a poll succeeded);
--      down             [[from, to], ...] — gaps of > 15 min between consecutive successful
--                       polls since the heartbeat began: the collector was not looking, so no
--                       line is drawn across them.
--    SECURITY DEFINER, service_role only (both tables are RLS-on with zero policies).
begin;

create table if not exists public.ten216_test_polls (
  poll_id      text primary key,
  observed_at  timestamptz not null,
  ok           boolean not null,
  matches      integer,
  quotes       integer,
  rows_written integer
);
alter table public.ten216_test_polls enable row level security;
revoke all on public.ten216_test_polls from anon, authenticated;
create index if not exists ten216_test_polls_observed on public.ten216_test_polls (observed_at);

create or replace function public.chart_apitennis_series(p_keys text[], p_since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with hb as (
    select observed_at from public.ten216_test_polls
    where ok and observed_at >= p_since
  ), gaps as (
    select prev_at, observed_at
    from (select observed_at, lag(observed_at) over (order by observed_at) prev_at from hb) x
    where prev_at is not null and observed_at - prev_at > interval '15 minutes'
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_array(c.match_key, c.bookmaker, c.observed_at, c.selection,
                                         c.price, c.change_kind, c.event_live)
                       order by c.match_key, c.bookmaker, c.observed_at, c.id)
      from public.ten216_test_odds_changes c
      where c.market = 'Home/Away'
        and c.match_key = any(p_keys)
        and c.observed_at >= p_since), '[]'::jsonb),
    'last_ok_poll_at', coalesce((select max(observed_at) from hb),
                                (select max(observed_at) from public.ten216_test_odds_changes)),
    'heartbeat_since', (select min(observed_at) from hb),
    'down', coalesce((select jsonb_agg(jsonb_build_array(prev_at, observed_at) order by prev_at)
                      from gaps), '[]'::jsonb)
  );
$$;

revoke all on function public.chart_apitennis_series(text[], timestamptz) from public, anon, authenticated;
grant execute on function public.chart_apitennis_series(text[], timestamptz) to service_role;

commit;
