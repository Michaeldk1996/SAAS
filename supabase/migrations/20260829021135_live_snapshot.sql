-- TEN-107 · Slice 1 — shared-poller snapshot architecture
--
-- One shared poller writes the full live board into a single snapshot row;
-- browsers read that row directly via PostgREST/Realtime (always-warm, no
-- Edge Function cold start on the member path). A single-flight lock row
-- collapses overlapping poller ticks to one upstream get_livescore call.
--
-- STAGED ONLY. This migration is not applied to the live Supabase project
-- until the confirm-before-live gate (spec: doc `proxy-build-spec`, Slice 5).
-- Re-runnable: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- 1. Snapshot table — one singleton row holds the whole live board as jsonb.
-- ---------------------------------------------------------------------------
create table if not exists public.live_snapshot (
  id          smallint     primary key default 1,
  board       jsonb        not null default '{}'::jsonb,   -- full live board
  match_count integer      not null default 0,             -- cheap freshness/telemetry
  source_ts   timestamptz,                                 -- vendor emit time if present
  updated_at  timestamptz  not null default now(),         -- our write time (staleness)
  constraint live_snapshot_singleton check (id = 1)
);

-- Seed the singleton so readers always find a row (empty board until first poll).
insert into public.live_snapshot (id) values (1)
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Single-flight lock row — poller claims it FOR UPDATE SKIP LOCKED so
--    overlapping ticks collapse to one upstream call (replaces Cloudflare's
--    native request coalescing). Service-role only; never read by browsers.
-- ---------------------------------------------------------------------------
create table if not exists public.poller_lock (
  id        smallint    primary key default 1,
  locked_by text,                                          -- run/instance id of holder
  locked_at timestamptz,
  constraint poller_lock_singleton check (id = 1)
);

insert into public.poller_lock (id) values (1)
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. RLS — browser gets public read on the snapshot ONLY. The poller writes
--    with the service role, which bypasses RLS.
-- ---------------------------------------------------------------------------
alter table public.live_snapshot enable row level security;
alter table public.poller_lock   enable row level security;

-- Public (anon + authenticated) may read the single snapshot row.
drop policy if exists "public read live_snapshot" on public.live_snapshot;
create policy "public read live_snapshot"
  on public.live_snapshot
  for select
  to anon, authenticated
  using (true);

-- No policy on poller_lock → with RLS on and zero policies, anon/authenticated
-- are denied every row; only the service role (RLS-bypass) touches it.

-- Table-level grants: RLS gates *rows*, GRANT gates *table access*. Give the
-- read path an explicit SELECT on the snapshot; strip everything on the lock.
grant select on public.live_snapshot to anon, authenticated;
revoke all   on public.poller_lock   from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Realtime — publish snapshot changes so the member read path can subscribe
--    instead of polling. Guarded so re-running the migration never errors.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'live_snapshot'
  ) then
    execute 'alter publication supabase_realtime add table public.live_snapshot';
  end if;
end
$$;
