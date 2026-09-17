-- TEN-225 item 2a (Michael, 2026-09-17T09:11Z) — record the live flip from the
-- EXISTING ~10-second live poller, not from a 5-minute odds collector.
--
--   "Record the flip from the existing ~10-second live poller, not from a
--    5-minute odds collector: append-only table (fixture, first_live_seen_at,
--    last_not_live_seen_at, poller, gap_seconds). Report the median gap after
--    48h."
--
-- WHERE THE FLIP IS OBSERVED, AND WHY IT IS HERE AND NOT IN THE EDGE FUNCTION
-- ---------------------------------------------------------------------------
-- The poller (supabase/functions/live-poller/index.ts, pg_cron job
-- 'live-poller-10s', interval '10 seconds') makes ONE bulk get_livescore call
-- per tick and hands the whole live board to write_snapshot(). That board is
-- the complete set of fixtures that are live at that instant.
--
-- So the flip is already fully determined by two consecutive boards, and both
-- are visible inside write_snapshot: a fixture present in THIS board and absent
-- from the PREVIOUS one flipped to live somewhere in between. Recording it here
-- means:
--   * no Edge Function redeploy (the function is unchanged by this migration),
--   * no second upstream call and no extra api-tennis quota,
--   * the lower bound is exact, because live_snapshot.updated_at is the moment
--     we last saw a complete board that did NOT contain the fixture.
--
-- THE LOWER-BOUND DESIGN, AS APPROVED
-- ---------------------------------------------------------------------------
--   last_not_live_seen_at = the previous snapshot's updated_at. At that instant
--     we held a complete live board and this fixture was not in it, so it was
--     provably not yet live.
--   first_live_seen_at    = now(). The first tick that saw it live.
--   gap_seconds           = the width of the interval the true flip lies in.
-- The real flip is somewhere inside [last_not_live_seen_at, first_live_seen_at].
-- Both bounds are stored, as ruled, so a later consumer can cut the Close at
-- the lower bound and still know how wide the uncertainty was.
--
-- Michael's close_reliable rule for fallback Closes (2026-09-17T09:11Z):
--   gap_seconds <= 300 AND close_lag <= 60 min. Larger gap -> Close = dash,
--   Open kept. This migration stores gap_seconds; it does not itself decide
--   anything about a Close. Nothing member-visible changes.
--
-- FIRST SIGHTING WINS FOREVER (TEN-216 ruling, restated on this issue)
-- ---------------------------------------------------------------------------
-- event_key is the primary key and the insert is ON CONFLICT DO NOTHING, so a
-- fixture that leaves the live board and returns (suspension, rain, a feed
-- blip) can never overwrite its first sighting. The table is append-only in the
-- strict sense: one row per fixture, written once, never updated.
--
-- COLD START AND OUTAGES ARE NOT SPECIAL-CASED ON PURPOSE
-- ---------------------------------------------------------------------------
-- On the first tick after this is applied, every fixture that is ALREADY live
-- is new to us, so it is recorded with last_not_live_seen_at = the previous
-- snapshot's updated_at. If the poller had been down, that bound is old and
-- gap_seconds is large -- which is exactly right: we genuinely do not know when
-- those matches started, and the <=300s rule rejects them on their own numbers.
-- Inventing a cold-start flag would hide that in a column nobody checks; the
-- gap already says it. Same for a mid-life outage.
--
-- SAFETY: this migration must not be able to break the live board.
-- ---------------------------------------------------------------------------
-- write_snapshot() is on the member read path: every Live-tab viewer sees what
-- it writes. The flip recording is therefore wrapped in its own exception
-- block. If ANYTHING in it raises, the snapshot update still happens and the
-- board is unaffected; the failure is recorded as a counter in
-- live_flip_stats.last_error rather than propagated.
--
-- Idempotent: create table if not exists, create or replace function.

-- ---------------------------------------------------------------------------
-- 1. The append-only flip log.
--
--    Michael's five columns are the first five. The identity columns after them
--    exist because the flip has to be PAIRED to an oddspapi fixture later (Part
--    2 fills odds_card_state), and re-querying api-tennis for the identity of a
--    fixture that has since finished is both a quota cost and, for the name
--    fields, lossy. Capturing them at flip time costs nothing -- they are
--    already in the board row in front of us.
-- ---------------------------------------------------------------------------
create table if not exists public.live_flip_log (
  event_key             text        primary key,
  first_live_seen_at    timestamptz not null,
  last_not_live_seen_at timestamptz,                 -- null only if we have never
                                                     -- written a snapshot before
  poller                text        not null,
  gap_seconds           numeric,                     -- first_live - last_not_live

  -- identity, captured at flip time for later oddspapi pairing
  event_date            text,
  event_time            text,                        -- SCHEDULED. Recorded for
                                                     -- provenance only. Michael's
                                                     -- ruling 1 (2026-09-17): never
                                                     -- used as a start time,
                                                     -- anywhere, at any level, even
                                                     -- labelled. Nothing reads this
                                                     -- column as a time.
  first_player          text,
  second_player         text,
  tournament_name       text,
  event_type_type       text,                        -- level: Atp Singles, etc.
  recorded_at           timestamptz not null default now()
);

create index if not exists live_flip_log_first_live_idx
  on public.live_flip_log (first_live_seen_at desc);

-- ---------------------------------------------------------------------------
-- 2. A singleton diagnostic row.
--
--    Without this, "zero flips recorded" is ambiguous: it could mean the board
--    was quiet, or that the live filter matches nothing and the recorder is
--    silently dead. These counters separate the two on sight.
-- ---------------------------------------------------------------------------
create table if not exists public.live_flip_stats (
  id                smallint primary key default 1,
  last_tick_at      timestamptz,
  last_board_count  integer,      -- fixtures in the board the poller handed us
  last_live_count   integer,      -- of those, how many passed the live filter
  last_new_count    integer,      -- of those, how many were first sightings
  total_flips       bigint not null default 0,
  last_error        text,         -- set only if the recorder itself raised
  constraint live_flip_stats_singleton check (id = 1)
);

insert into public.live_flip_stats (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. RLS on, zero policies — same posture as the TEN-225 tables. No browser
--    role can read either table; only the service role (RLS-bypass) writes.
-- ---------------------------------------------------------------------------
alter table public.live_flip_log   enable row level security;
alter table public.live_flip_stats enable row level security;
revoke all on public.live_flip_log   from anon, authenticated;
revoke all on public.live_flip_stats from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. record_live_flips — the whole flip decision, as a standalone function.
--
--    This is deliberately NOT inlined into write_snapshot. write_snapshot is on
--    the member read path (every Live-tab viewer sees what it writes), and there
--    is no local Postgres to rehearse against, so the logic that is actually
--    worth testing is separated from the function that is risky to change. This
--    one takes both boards as plain arguments, touches neither live_snapshot nor
--    the poller, and can therefore be exercised with synthetic boards inside a
--    transaction that is rolled back -- which is exactly what
--    test-live-flip-log.sql does before write_snapshot is ever replaced.
--
--    Returns the number of first sightings recorded.
-- ---------------------------------------------------------------------------
create or replace function public.record_live_flips(
  _board      jsonb,
  _prev_board jsonb,
  _prev_ts    timestamptz,
  _now        timestamptz,
  _poller     text default 'live-poller-10s'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  _board_n int := 0;
  _live_n  int := 0;
  _new_n   int := 0;
begin
    select count(*)
      into _board_n
      from jsonb_array_elements(coalesce(_board -> 'matches', '[]'::jsonb)) as fix;

    -- Only fixtures the feed itself marks live. get_livescore is expected to
    -- return the live board and nothing else, but a payload that also carried
    -- just-finished or about-to-start fixtures would otherwise mint false
    -- first-live sightings, and a false sighting can never be corrected --
    -- first sighting wins forever. The filter is cheap; the mistake is not.
    select count(*)
      into _live_n
      from jsonb_array_elements(coalesce(_board -> 'matches', '[]'::jsonb)) as fix
     where fix ->> 'event_live' = '1'
       and coalesce(fix ->> 'event_key', '') <> '';

    insert into public.live_flip_log (
      event_key, first_live_seen_at, last_not_live_seen_at, poller, gap_seconds,
      event_date, event_time, first_player, second_player,
      tournament_name, event_type_type
    )
    -- DISTINCT ON guards against the same event_key appearing twice in one
    -- board: two rows for one key inside a single INSERT would be a duplicate
    -- the conflict clause should not have to arbitrate.
    select distinct on (fix ->> 'event_key')
           fix ->> 'event_key',
           _now,
           _prev_ts,
           _poller,
           case when _prev_ts is null then null
                else extract(epoch from (_now - _prev_ts)) end,
           fix ->> 'event_date',
           fix ->> 'event_time',
           fix ->> 'event_first_player',
           fix ->> 'event_second_player',
           fix ->> 'tournament_name',
           fix ->> 'event_type_type'
      from jsonb_array_elements(coalesce(_board -> 'matches', '[]'::jsonb)) as fix
     where fix ->> 'event_live' = '1'
       and coalesce(fix ->> 'event_key', '') <> ''
       -- absent from the PREVIOUS board = it flipped somewhere between that
       -- board's timestamp and this one's
       and not exists (
             select 1
               from jsonb_array_elements(
                      coalesce(_prev_board -> 'matches', '[]'::jsonb)) as p
              where p ->> 'event_live' = '1'
                and p ->> 'event_key' = fix ->> 'event_key')
    -- First sighting wins forever: a fixture that left the board and came
    -- back is a normal change, not a new first_seen.
    on conflict (event_key) do nothing;

    get diagnostics _new_n = row_count;

    update public.live_flip_stats
       set last_tick_at     = _now,
           last_board_count = _board_n,
           last_live_count  = _live_n,
           last_new_count   = _new_n,
           total_flips      = total_flips + _new_n,
           last_error       = null
     where id = 1;

    return _new_n;
end;
$$;

revoke execute on function public.record_live_flips(jsonb, jsonb, timestamptz, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.record_live_flips(jsonb, jsonb, timestamptz, timestamptz, text)
  to service_role;
