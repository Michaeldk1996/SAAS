-- TEN-225 ruling 6 — the shared oddspapi billable-unit ledger.
--
-- Michael's ruling (2026-09-17T23:15Z, TEN-225):
--   "6. ODDSPAPI BUDGET — control this now. The meter went 350 -> 698 in roughly
--    a day against a 5,000/month plan. [...] b. Hard daily cap: 150 billable
--    units across ALL jobs, shared, with a persisted counter. At the cap,
--    billable calls stop and the run reports; free /v4/historical-odds calls
--    continue. c. Any single run planning more than 50 billable units stops and
--    asks first."
--
-- WHY A LEDGER AND NOT A COUNTER
-- ------------------------------
-- A counter we increment ourselves drifts the moment a call bills and the
-- increment does not (measured 2026-09-18: `/v4/odds-by-tournaments` billed
-- 1 unit while returning HTTP 400 — a failed call still bills). So the counter
-- of record is oddspapi's own meter, `/v4/account -> request_count`, which is
-- free to read and cannot drift from what we are charged. What this table
-- persists is the one thing the meter cannot tell us: where the UTC day
-- boundary fell, and which job spent what.
--
-- spent_today = meter_now - baseline(today), where
--   baseline(today) = the last meter reading recorded on any EARLIER day,
--                     else the first reading recorded today,
--                     else meter_now (first ever run — day starts at zero spend).
-- If meter_now < baseline the billing period rolled over (the plan resets on
-- valid_until, 2026-10-10T00:37:53Z on the current subscription) and the
-- baseline becomes 0.
--
-- GRAIN: one row per (job, run_id, phase). `pre` is written before a run's
-- billable work and carries the decision; `post` is written after it, so the
-- difference is that run's measured spend and no job can under-report itself.
--
-- RLS ON, ZERO ANON POLICIES — same posture as oddspapi_line_summary. With RLS
-- enabled and no policy created at all, PostgREST's anon and authenticated
-- roles read nothing; the service key (which bypasses RLS) is the only way in.
-- Nothing in the browser reads this table.

create table if not exists public.oddspapi_budget_ledger (
  id          bigint generated always as identity primary key,
  day         date        not null,
  job         text        not null,
  run_id      text        not null,
  phase       text        not null check (phase in ('pre', 'post')),
  meter       integer     not null,
  limit_total integer,
  planned     integer,
  decision    text,
  reason      text,
  created_at  timestamptz not null default now()
);

-- One pre and one post per run. A re-run of the same job+run_id overwrites via
-- merge-duplicates rather than double-counting.
create unique index if not exists oddspapi_budget_ledger_run_phase
  on public.oddspapi_budget_ledger (job, run_id, phase);

-- The baseline lookup is "latest row strictly before today", so day DESC first.
create index if not exists oddspapi_budget_ledger_day
  on public.oddspapi_budget_ledger (day desc, created_at desc);

alter table public.oddspapi_budget_ledger enable row level security;
