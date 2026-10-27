-- False 0-0 starts (founder brief 2026-10-27): a live_flip_log row proven false is SUPERSEDED, never edited or deleted.
--
-- live_flip_log_superseded — one row per false start: the event key, why it is false, and the evidence. Append-only:
--   service_role may SELECT and INSERT; UPDATE / DELETE / TRUNCATE are revoked and refused by triggers (the owner too).
-- live_flip_log_current — live_flip_log minus the superseded keys. EVERY reader of a live-flip start reads this view,
--   never the table (tools/test-live-flip-superseded.py locks each reader). security_invoker, so live_flip_log's RLS
--   still applies to the caller; each role that can read live_flip_log today is granted the view and the sidecar.
--
-- Idempotent (if not exists / or replace), so the go-live re-applying it is harmless. Nothing here drops or alters
-- live_flip_log; the rows that mark the 3 false starts are data (tools/false-starts-supersede.sql), not this file.
begin;

create table if not exists public.live_flip_log_superseded (
  event_key     text        primary key,             -- live_flip_log.event_key; a key is superseded once, for good
  reason        text        not null check (length(reason) > 0),
  evidence      jsonb       not null default '{}'::jsonb,
  superseded_at timestamptz not null default now()
);

alter table public.live_flip_log_superseded enable row level security;
revoke all on public.live_flip_log_superseded from public, anon, authenticated, service_role;
grant select, insert on public.live_flip_log_superseded to service_role;

create or replace function public.live_flip_superseded_forbid() returns trigger
language plpgsql as $$
begin
  raise exception 'live_flip_log_superseded is append-only (% refused)', tg_op;
end $$;
revoke all on function public.live_flip_superseded_forbid() from public, anon, authenticated;

drop trigger if exists live_flip_log_superseded_no_change on public.live_flip_log_superseded;
create trigger live_flip_log_superseded_no_change before update or delete on public.live_flip_log_superseded
  for each row execute function public.live_flip_superseded_forbid();
drop trigger if exists live_flip_log_superseded_no_truncate on public.live_flip_log_superseded;
create trigger live_flip_log_superseded_no_truncate before truncate on public.live_flip_log_superseded
  for each statement execute function public.live_flip_superseded_forbid();

create or replace view public.live_flip_log_current with (security_invoker = true) as
  select f.*
    from public.live_flip_log f
   where not exists (select 1 from public.live_flip_log_superseded s where s.event_key = f.event_key);

revoke all on public.live_flip_log_current from public, anon, authenticated;
grant select on public.live_flip_log_current to service_role;

-- every other role that reads live_flip_log today (the drop bots' roles, if any) keeps reading through the view
do $$
declare r text;
begin
  for r in select distinct grantee from information_schema.role_table_grants
            where table_schema = 'public' and table_name = 'live_flip_log' and privilege_type = 'SELECT'
              and grantee not in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  loop
    execute format('grant select on public.live_flip_log_current to %I', r);
    execute format('grant select on public.live_flip_log_superseded to %I', r);
  end loop;
end $$;

commit;
