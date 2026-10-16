-- Pinnacle (approx.) snapshots (founder ruling 2026-10-16, ruling 1). ADDITIVE: two new tables and one function; touches
-- no existing object (the historical archive of 20261016090000 and the Pinnacle archive of 20261014120000 are unchanged).
-- Rules: .claude/rules/historical-odds-archive.md "Pinnacle (approx.)".
--
--   historical_snapshot        api-tennis's stored Pinnacle price (book `Pncl`) for an ATP main-draw match of 13 Jan -
--                              12 Apr 2026 that Tennis-Data has no Pinnacle close for. api-tennis carries no timestamp, so
--                              this is a SNAPSHOT, never a close: its own source ('api-tennis Pinnacle') and label
--                              ('Pinnacle (approx.)'), its own table. It never overrides a Tennis-Data or Oddspapi close;
--                              Bet365 stays the fallback where api-tennis has no pair.
--   historical_snapshot_count  one row per job run with the count it saw: the publish guard's baseline.
--
-- Same protections as the archive: SELECT + INSERT only for service_role, nothing for anon / authenticated / public, RLS
-- on with no policy, BEFORE UPDATE OR DELETE and BEFORE TRUNCATE triggers that raise for every role. Idempotent.

create table if not exists public.historical_snapshot (
  id            bigint generated always as identity primary key,
  dedupe_key    text        not null unique,       -- source|date|tournament|winner|loser|event_key|pw|pl
  source        text        not null check (source = 'api-tennis Pinnacle'),
  label         text        not null check (label = 'Pinnacle (approx.)'),
  match_date    date        not null,              -- the Tennis-Data row's date
  tournament    text        not null,              -- the Tennis-Data row's words
  round         text,
  winner        text        not null,
  loser         text        not null,
  event_key     bigint      not null,              -- the api-tennis fixture it was read from
  price_winner  numeric     not null check (price_winner >= 1.01),
  price_loser   numeric     not null check (price_loser >= 1.01),
  fetched_at    timestamptz not null,              -- when WE read it (api-tennis gives no time for the price)
  supersedes    bigint      references public.historical_snapshot(id),
  detail        jsonb       not null default '{}'::jsonb,
  inserted_at   timestamptz not null default now()
);
create index if not exists historical_snapshot_date on public.historical_snapshot (match_date);

create table if not exists public.historical_snapshot_count (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  job           text        not null,
  snapshot_rows bigint      not null,
  detail        jsonb       not null default '{}'::jsonb
);

do $$
declare t text;
begin
  foreach t in array array['historical_snapshot', 'historical_snapshot_count'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select, insert on public.%I to service_role', t);
    execute format('drop trigger if exists %I on public.%I', t || '_no_change', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.historical_archive_forbid()', t || '_no_change', t);
    execute format('drop trigger if exists %I on public.%I', t || '_no_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.historical_archive_forbid()', t || '_no_truncate', t);
  end loop;
end $$;

-- Read-only guard state for the publish guard (counts and booleans only, never a row).
create or replace function public.historical_snapshot_guard() returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  r jsonb := '{}'::jsonb; t text; trg_ok boolean; priv_bad text[] := '{}'; all_ok boolean := true; n bigint; mx bigint;
begin
  foreach t in array array['historical_snapshot', 'historical_snapshot_count'] loop
    execute format('select count(*) from public.%I', t) into n;
    select count(*) = 2 into trg_ok from pg_trigger
      where tgrelid = ('public.' || t)::regclass and not tgisinternal and tgenabled = 'O'
        and tgname in (t || '_no_change', t || '_no_truncate');
    priv_bad := '{}';
    if has_table_privilege('service_role', 'public.' || t, 'UPDATE') then priv_bad := array_append(priv_bad, 'service_role UPDATE'); end if;
    if has_table_privilege('service_role', 'public.' || t, 'DELETE') then priv_bad := array_append(priv_bad, 'service_role DELETE'); end if;
    if has_table_privilege('service_role', 'public.' || t, 'TRUNCATE') then priv_bad := array_append(priv_bad, 'service_role TRUNCATE'); end if;
    if has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE') then priv_bad := array_append(priv_bad, 'anon access'); end if;
    if has_table_privilege('authenticated', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE') then priv_bad := array_append(priv_bad, 'authenticated access'); end if;
    r := r || jsonb_build_object(t, jsonb_build_object('rows', n, 'triggers', trg_ok,
      'rls', (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), 'privilegeFaults', to_jsonb(priv_bad)));
    all_ok := all_ok and trg_ok and cardinality(priv_bad) = 0;
  end loop;
  select coalesce(max(snapshot_rows), 0) into mx from public.historical_snapshot_count;
  return r || jsonb_build_object('maxRecorded', jsonb_build_object('snapshot', mx), 'ok', all_ok, 'at', now());
end $$;
revoke all on function public.historical_snapshot_guard() from public;
grant execute on function public.historical_snapshot_guard() to anon, authenticated, service_role;
