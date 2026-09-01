-- TEN-107 · Detail panel — on-demand point-by-point store
--
-- The match-detail panel (Stats / Points / Ratings) reads the same live_snapshot
-- row the board already polls for the box score (`statistics`) and score line.
-- The point-by-point log is the heavy part of a fixture (~12 KB/match, ~43% of
-- the row). Keeping it in live_snapshot means Supabase Realtime ships it over the
-- socket to every viewer on every 10s push, even though the board never renders
-- it — the egress axis flagged in doc `detail-view-cost` (~27 GB/hr at a 25-match
-- Slam × 100 viewers).
--
-- Founder-approved refinement (2026-08-31): keep the point log OFF the pushed row
-- and fetch it on demand via PostgREST only when a member opens the detail panel.
-- This table holds one row per live match, keyed by event_key. It is deliberately
-- NOT added to the supabase_realtime publication, so it costs zero push egress;
-- the Points/Ratings tabs read a single match's row with `?event_key=eq.<ek>`.
--
-- STAGED ONLY. Applied at the confirm-before-live gate alongside the poller
-- redeploy that starts writing it (doc `detail-panel-staging`). Idempotent.

-- ---------------------------------------------------------------------------
-- 1. Per-match point-by-point store. One row per live event_key.
-- ---------------------------------------------------------------------------
create table if not exists public.live_pbp (
  event_key   text         primary key,           -- api-tennis fixture key
  pbp         jsonb        not null default '[]'::jsonb,  -- pointbypoint games array
  updated_at  timestamptz  not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. RLS — public read (same posture as live_snapshot); writes are service-role
--    only (RLS-bypass). No write policy → anon/authenticated cannot mutate.
-- ---------------------------------------------------------------------------
alter table public.live_pbp enable row level security;

drop policy if exists "public read live_pbp" on public.live_pbp;
create policy "public read live_pbp"
  on public.live_pbp
  for select
  to anon, authenticated
  using (true);

grant select on public.live_pbp to anon, authenticated;

-- Deliberately NOT added to the supabase_realtime publication: this store is
-- read on demand, never pushed. That is the whole point of the split.
