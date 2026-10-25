-- The archive's migration ledger (founder 2026-10-20, item 9): the historical-archive install applies each migration file
-- ONCE and records it here in the same transaction; a file whose bytes changed after it was applied stops the install
-- ("add a new migration instead"). Append-only like the archive: SELECT + INSERT for service_role, nothing for anon /
-- authenticated, triggers refuse UPDATE, DELETE and TRUNCATE for every role. Idempotent: safe to run on every install.
create table if not exists public.archive_migrations (
  name        text        primary key,
  sha256      text        not null check (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at  timestamptz not null default now(),
  how         text        not null default 'applied' check (how in ('applied', 'recorded at bootstrap'))
);
alter table public.archive_migrations enable row level security;
revoke all on public.archive_migrations from public, anon, authenticated, service_role;
grant select, insert on public.archive_migrations to service_role;
create or replace function public.archive_migrations_forbid() returns trigger language plpgsql as $$
begin
  raise exception 'archive_migrations is append-only (% refused)', tg_op;
end $$;
revoke all on function public.archive_migrations_forbid() from public, anon, authenticated;
drop trigger if exists archive_migrations_no_change on public.archive_migrations;
create trigger archive_migrations_no_change before update or delete on public.archive_migrations for each row execute function public.archive_migrations_forbid();
drop trigger if exists archive_migrations_no_truncate on public.archive_migrations;
create trigger archive_migrations_no_truncate before truncate on public.archive_migrations for each statement execute function public.archive_migrations_forbid();
