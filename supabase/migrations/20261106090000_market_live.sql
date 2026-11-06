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
  -- live-flip start reads the view). started_at = the poll before the flag (first sighting wins, never moved). A read
  -- taken AFTER that poll could be in play, and with no lower bound (play already on the board at the first sighting,
  -- ruling 2026-10-27) nothing proves any read was pre-match: either way the figure and prices are dropped (null), so
  -- the page falls back to the pipeline file — never an in-play read labelled pre-start. A bare flag
  -- (live_flip_pending) only pauses the writes below; a flag that leaves the live board before play resumes them.
  update public.market_live_current c
     set started_at = coalesce(l.last_not_live_seen_at, l.first_live_seen_at),
         liquidity  = case when l.last_not_live_seen_at is not null and c.read_at <= l.last_not_live_seen_at then c.liquidity end,
         outcomes   = case when l.last_not_live_seen_at is not null and c.read_at <= l.last_not_live_seen_at then c.outcomes end
    from public.live_flip_log_current l where l.event_key = c.event_key and c.started_at is null;
  get diagnostics f = row_count;

  with r as (
    select distinct on (x->>'event_key', x->>'venue')
           x->>'event_key' ek, x->>'venue' v, x->>'ref' ref,
           case when x->>'liquidity' ~ '^[0-9.]+$' then (x->>'liquidity')::numeric end liq,
           case when jsonb_typeof(x->'outcomes') = 'array' then x->'outcomes' end oc,
           x->>'status' st, (x->>'read_at')::timestamptz ra
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
     where coalesce(x->>'event_key', '') <> '' and x->>'venue' in ('kalshi', 'polymarket') and x->>'read_at' is not null
     order by x->>'event_key', x->>'venue', (x->>'read_at')::timestamptz desc
  )
  insert into public.market_live_current as c (event_key, venue, ref, liquidity, outcomes, status, read_at)
  select ek, v, ref, liq, oc, st, ra from r
   where not exists (select 1 from public.live_flip_log_current l where l.event_key = r.ek)
     and not exists (select 1 from public.live_flip_pending p where p.event_key = r.ek)
  on conflict (event_key, venue) do update
     set ref = excluded.ref, liquidity = excluded.liquidity, outcomes = excluded.outcomes,
         status = excluded.status, read_at = excluded.read_at
   where c.started_at is null and excluded.read_at > c.read_at;
  get diagnostics w = row_count;

  insert into public.market_live_beat (id, beat_at, note) values (1, now(), coalesce(p_note, '{}'::jsonb))
  on conflict (id) do update set beat_at = excluded.beat_at, note = excluded.note;
  delete from public.market_live_current where read_at < now() - interval '10 days';
  return jsonb_build_object('written', w, 'frozen', f);
end $$;
revoke all on function public.market_live_push(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.market_live_push(jsonb, jsonb) to service_role;
