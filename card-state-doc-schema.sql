-- Architecture program stage 3 (2026-11-03): card prices read from the DATABASE, not a committed file.
--
-- card_state_doc holds ONE row: the published card-state projection — byte for byte the document
-- ten225-publish-card-state.py writes as odds-card-state.json (same builder, same table state), built on the
-- always-on card worker (kibl-stream app, process group `cards`, every 10 min). The page reads `doc` with the public
-- key; the committed file stays as the fallback until the two have been shown identical on the deployed site.
--
-- READ POLICY, its own change, reviewed on its own merits (TEN-225 Part 2 said a member-visible read gets one): the
-- row carries exactly what the published odds-card-state.json already serves to every visitor, nothing more. Writes:
-- service role only (the worker). card_state_runs: one row per worker cycle (timings, counts, error) — not readable
-- by the page; the data-alarms watch reads it with the owner role.
-- Idempotent: if not exists / or replace; applied through ten232-schema-gate.py (only when this file changes).
create table if not exists public.card_state_doc (
  id           smallint primary key default 1 check (id = 1),
  generated_at timestamptz not null,            -- the doc's own generatedAt
  written_at   timestamptz not null default now(),
  doc          jsonb not null
);
alter table public.card_state_doc enable row level security;
revoke all on public.card_state_doc from anon, authenticated;
grant select on public.card_state_doc to anon, authenticated;
drop policy if exists card_state_doc_read on public.card_state_doc;
create policy card_state_doc_read on public.card_state_doc for select to anon, authenticated using (true);

create table if not exists public.card_state_runs (
  id          bigserial primary key,
  started_at  timestamptz not null,
  finished_at timestamptz not null default now(),
  ok          boolean not null,
  stage       text,                               -- where it stopped: sync | build | publish | write | done
  build_s     numeric,
  publish_s   numeric,
  matches     integer,
  error       text,
  host        text
);
alter table public.card_state_runs enable row level security;
revoke all on public.card_state_runs from anon, authenticated;
create index if not exists card_state_runs_started_idx on public.card_state_runs (started_at desc);
