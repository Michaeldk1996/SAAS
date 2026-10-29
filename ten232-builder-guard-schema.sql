-- Pinger task (founder 2026-10-29): the card-state builder guard's log.
-- One row per AUTOMATIC firing that reached the builder: 'ran' or 'skipped'
-- (the daily line-summary load was running, or its run state was unreadable).
-- The skip count is `select count(*) ... where decision = 'skipped'`.
-- Append-only: RLS on, no policy, browser roles have nothing; triggers refuse
-- UPDATE / DELETE / TRUNCATE. Idempotent; applied through ten232-schema-gate.py.
create table if not exists public.ten232_builder_guard_log (
  id                bigint generated always as identity primary key,
  at                timestamptz not null default now(),
  run_id            text,
  event             text,
  decision          text not null check (decision in ('ran', 'skipped')),
  reason            text not null,
  line_summary_run  text
);
alter table public.ten232_builder_guard_log enable row level security;
revoke all on public.ten232_builder_guard_log from anon, authenticated;
grant select, insert on public.ten232_builder_guard_log to service_role;

create or replace function public.ten232_builder_guard_log_forbid() returns trigger
language plpgsql as $$
begin
  raise exception 'ten232_builder_guard_log is append-only';
end $$;

drop trigger if exists ten232_builder_guard_log_no_change on public.ten232_builder_guard_log;
create trigger ten232_builder_guard_log_no_change
  before update or delete on public.ten232_builder_guard_log
  for each row execute function public.ten232_builder_guard_log_forbid();
drop trigger if exists ten232_builder_guard_log_no_truncate on public.ten232_builder_guard_log;
create trigger ten232_builder_guard_log_no_truncate
  before truncate on public.ten232_builder_guard_log
  for each statement execute function public.ten232_builder_guard_log_forbid();
