-- Prediction-market liquidity, read every minute (founder 2026-11-06: "Build this" — the per-minute Kalshi / Polymarket
-- reads for the Today's Matches Market Signal drawer, frozen at the REAL start, not the scheduled one).
--
-- Writer: tools/market-live-recorder.mjs (market-live.yml, always on, from main), through public.market_live_push with
-- the service role. Reader: the page, SELECT only with the publishable key (the line-prices pattern).
--
-- One row per (card event key, venue). The FREEZE lives here, not in the recorder: a row whose event key our live
-- poller has flagged live (public.live_flip_pending = the flag, public.live_flip_log_current = play seen, superseded
-- false starts excluded) is not written, and once play is seen its started_at is stamped from the poll before the flag
-- and it is never written again. So the value on the card is the last read taken before our own live sighting (at most
-- one minute before it); a read after that poll is dropped, never shown as pre-start.
-- Idempotent: if not exists / create or replace. Additive: no existing object is touched.

create table if not exists public.market_live_current (
  event_key   text        not null,                 -- the board card's api-tennis event key
  venue       text        not null check (venue in ('kalshi', 'polymarket')),
  ref         text,                                 -- Kalshi event ticker / Polymarket event slug
  liquidity   numeric     check (liquidity is null or liquidity >= 0),   -- dollars; the same figure kalshi.json / polymarket.json carry
  outcomes    jsonb,                                -- [{name, bid, ask, mid}] per player, the venue's own prices (0..1)
  status      text,                                 -- 'open' | 'closed' (venue's own flag)
  read_at     timestamptz not null,                 -- when the recorder read the venue
  started_at  timestamptz,                          -- our live flip's lower bound once seen; the row is frozen from then on
  primary key (event_key, venue)
);
-- Traded money (founder 2026-11-07): {byName: {player: dollars}, trades, at} summed over every trade on the match-winner
-- market up to `at`. Sent every minute with the last good sum; a minute without one keeps the stored sum.
alter table public.market_live_current add column if not exists flow jsonb;
-- The last reads before the current one (founder 2026-11-12: "make sure it's always there"): newest first, at most
-- 30 entries of {read_at, liquidity, outcomes, flow}. The live flag reaches us seconds to minutes after the
-- real start, so the newest read is often taken after it; the freeze then takes the newest read from BEFORE our live
-- sighting out of this list, instead of dropping the whole row (measured 12 Nov: 24 of 34 frozen rows of 9–11 Nov empty).
alter table public.market_live_current add column if not exists recent jsonb;
-- Set only by market_live_backfill: {source, at} — the row's prices and traded money were rebuilt after the match from
-- the venue's own history at or before the start (tools/market-live-backfill.mjs), not read live by the recorder.
alter table public.market_live_current add column if not exists backfill jsonb;
-- Which instant froze the row (founder 2026-11-12): 'poll before the flag' (our live sighting's lower bound — a verified
-- start) or 'first live sighting' (no lower bound: play was seen more than 5 min after the flag, or was already on the
-- board at the first sighting — the start is not verified, so the read kept is the last one taken before the match was
-- first listed live). Null on a row frozen before this column existed.
alter table public.market_live_current add column if not exists cut text;
create table if not exists public.market_live_beat (
  id       int         primary key default 1 check (id = 1),
  beat_at  timestamptz not null,
  note     jsonb
);

alter table public.market_live_current enable row level security;
alter table public.market_live_beat    enable row level security;
revoke all on public.market_live_current from anon, authenticated;
revoke all on public.market_live_beat    from anon, authenticated;
grant select on public.market_live_current to anon, authenticated;
grant select on public.market_live_beat    to anon, authenticated;
drop policy if exists market_live_current_read on public.market_live_current;
create policy market_live_current_read on public.market_live_current for select to anon, authenticated using (true);
drop policy if exists market_live_beat_read on public.market_live_beat;
create policy market_live_beat_read on public.market_live_beat for select to anon, authenticated using (true);

-- The recorder's one write. p_rows = [{event_key, venue, ref, liquidity, outcomes, status, read_at}], p_note = counts.
-- Returns {written, frozen}.
create or replace function public.market_live_push(p_rows jsonb, p_note jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare w int := 0; f int := 0;
begin
  -- Freeze once play is seen (live_flip_log_current: the log minus the superseded false starts — every reader of a
  -- live-flip start reads the view). started_at = the poll before the flag (first sighting wins, never moved). The frozen
  -- value is the newest read taken at or before that poll: the current read, else the newest of `recent` (founder
  -- 2026-11-12); read_at becomes that read's time. A read taken AFTER that poll could be in play and is never kept; with
  -- no read before it, or no lower bound (play already on the board at the first sighting, ruling 2026-10-27), nothing
  -- proves a pre-match read: the figure and prices are dropped (null) — never an in-play read labelled pre-start. A bare flag
  -- (live_flip_pending) only pauses the writes below; a flag that leaves the live board before play resumes them.
  -- No lower bound (founder 2026-11-12, measured 12 Nov: all 3 matches frozen that day had play seen 13–21 min after
  -- the flag): the cut is our FIRST live sighting — the recorder never writes after the flag, so a read at or before it
  -- was taken while the match was not listed live; the row says so (cut = 'first live sighting').
  with pick as (
    select c.event_key, c.venue, coalesce(l.last_not_live_seen_at, l.first_live_seen_at) st,
           coalesce(l.last_not_live_seen_at, l.first_live_seen_at) lb,
           case when l.last_not_live_seen_at is null then 'first live sighting' else 'poll before the flag' end ck,
           case when coalesce(l.last_not_live_seen_at, l.first_live_seen_at) is null then null
                when c.read_at <= coalesce(l.last_not_live_seen_at, l.first_live_seen_at)
                  then jsonb_build_object('read_at', c.read_at, 'liquidity', c.liquidity, 'outcomes', c.outcomes, 'flow', c.flow)
                else (select e from jsonb_array_elements(case when jsonb_typeof(c.recent) = 'array' then c.recent else '[]'::jsonb end) e
                       where (e->>'read_at')::timestamptz <= coalesce(l.last_not_live_seen_at, l.first_live_seen_at)
                       order by (e->>'read_at')::timestamptz desc limit 1) end snap
      from public.market_live_current c join public.live_flip_log_current l on l.event_key = c.event_key
     where c.started_at is null
  )
  update public.market_live_current c
     set started_at = p.st,
         liquidity  = (p.snap->>'liquidity')::numeric,
         outcomes   = case when jsonb_typeof(p.snap->'outcomes') = 'array' then p.snap->'outcomes' end,
         flow       = case when jsonb_typeof(p.snap->'flow') = 'object' and (p.snap->'flow'->>'at')::timestamptz <= p.lb then p.snap->'flow' end,
         read_at    = coalesce((p.snap->>'read_at')::timestamptz, c.read_at),
         cut        = p.ck
    from pick p where p.event_key = c.event_key and p.venue = c.venue and c.started_at is null;
  get diagnostics f = row_count;
  -- Rows frozen before the column existed: name their cut from the same log (idempotent; never touches a named cut).
  update public.market_live_current c
     set cut = case when l.last_not_live_seen_at is null then 'first live sighting' else 'poll before the flag' end
    from public.live_flip_log_current l
   where l.event_key = c.event_key and c.started_at is not null and c.cut is null;

  with r as (
    select distinct on (x->>'event_key', x->>'venue')
           x->>'event_key' ek, x->>'venue' v, x->>'ref' ref,
           case when x->>'liquidity' ~ '^[0-9.]+$' then (x->>'liquidity')::numeric end liq,
           case when jsonb_typeof(x->'outcomes') = 'array' then x->'outcomes' end oc,
           case when jsonb_typeof(x->'flow') = 'object' and jsonb_typeof(x->'flow'->'byName') = 'object'
                 and x->'flow'->>'at' ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d'
                then case when (x->'flow'->>'at')::timestamptz <= (x->>'read_at')::timestamptz then x->'flow' end end fl,   -- nested: the cast runs only on a valid stamp
           x->>'status' st, (x->>'read_at')::timestamptz ra
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
     where coalesce(x->>'event_key', '') <> '' and x->>'venue' in ('kalshi', 'polymarket') and x->>'read_at' is not null
     order by x->>'event_key', x->>'venue', (x->>'read_at')::timestamptz desc
  )
  insert into public.market_live_current as c (event_key, venue, ref, liquidity, outcomes, flow, status, read_at)
  select ek, v, ref, liq, oc, fl, st, ra from r
   where not exists (select 1 from public.live_flip_log_current l where l.event_key = r.ek)
     and not exists (select 1 from public.live_flip_pending p where p.event_key = r.ek)
  on conflict (event_key, venue) do update
     set ref = excluded.ref, liquidity = excluded.liquidity, outcomes = excluded.outcomes, flow = coalesce(excluded.flow, c.flow),
         status = excluded.status, read_at = excluded.read_at,
         recent = (select jsonb_agg(e order by i) from jsonb_array_elements(
                     jsonb_build_array(jsonb_build_object('read_at', c.read_at, 'liquidity', c.liquidity, 'outcomes', c.outcomes, 'flow', c.flow))
                     || case when jsonb_typeof(c.recent) = 'array' then c.recent else '[]'::jsonb end) with ordinality t(e, i)
                    where i <= 30)
   where c.started_at is null and excluded.read_at > c.read_at;
  get diagnostics w = row_count;

  insert into public.market_live_beat (id, beat_at, note) values (1, now(), coalesce(p_note, '{}'::jsonb))
  on conflict (id) do update set beat_at = excluded.beat_at, note = excluded.note;
  delete from public.market_live_current where read_at < now() - interval '10 days';
  return jsonb_build_object('written', w, 'frozen', f);
end $$;
revoke all on function public.market_live_push(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.market_live_push(jsonb, jsonb) to service_role;

-- Backfill (founder 2026-11-12, "Yes, backfill"): fills ONLY a frozen row the old freeze emptied (started_at set, no
-- prices, no traded money) with figures rebuilt from the venue's own history. A price whose read_at is after the start
-- is refused (the prices stay null), and so is a traded sum stamped after it. A row the recorder froze with its own
-- read is never touched. p_rows = [{event_key, venue, outcomes, read_at, flow}]. Returns {filled}.
create or replace function public.market_live_backfill(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n int := 0;
begin
  with x as (
    select distinct on (e->>'event_key', e->>'venue') e->>'event_key' ek, e->>'venue' v,
           case when jsonb_typeof(e->'outcomes') = 'array' then e->'outcomes' end oc,
           case when e->>'read_at' ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d' then (e->>'read_at')::timestamptz end ra,
           case when jsonb_typeof(e->'flow') = 'object' and jsonb_typeof(e->'flow'->'byName') = 'object'
                 and e->'flow'->>'at' ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d' then e->'flow' end fl
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) e
  )
  update public.market_live_current c
     set outcomes = case when x.oc is not null and x.ra is not null and x.ra <= c.started_at then x.oc end,
         read_at  = case when x.oc is not null and x.ra is not null and x.ra <= c.started_at then x.ra else c.read_at end,
         flow     = case when x.fl is not null and (x.fl->>'at')::timestamptz <= c.started_at then x.fl end,
         backfill = jsonb_build_object('source', 'venue history at or before the start', 'at', now())
    from x
   where c.event_key = x.ek and c.venue = x.v and c.started_at is not null and c.outcomes is null and c.flow is null
     and ((x.oc is not null and x.ra is not null and x.ra <= c.started_at) or (x.fl is not null and (x.fl->>'at')::timestamptz <= c.started_at));
  get diagnostics n = row_count;
  return jsonb_build_object('filled', n);
end $$;
revoke all on function public.market_live_backfill(jsonb) from public, anon, authenticated;
grant execute on function public.market_live_backfill(jsonb) to service_role;
-- PostgREST caches the schema: without this a changed signature or column 404s (PGRST202) until its next reload.
notify pgrst, 'reload schema';
