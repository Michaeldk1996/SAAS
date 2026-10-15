-- Historical odds archive (founder brief 2026-10-16, items 1-4). ADDITIVE: creates four new tables and two functions;
-- touches no existing object (the Pinnacle archive tables of 20261014120000 are unchanged). Rules:
-- .claude/rules/historical-odds-archive.md.
--
--   historical_odds_file    every Tennis-Data file we hold, byte for byte (gzip of the original bytes), with its sha256:
--                           the repo's odds-archive/ CSVs, every earlier version of them in git history, the published
--                           mirror's original workbooks, and the founder's drop-in workbooks. Tennis-Data has stopped
--                           serving its files: each one is irreplaceable.
--   historical_close        every Tennis-Data closing price 2010 onwards, one row per match per book: Pinnacle and
--                           Bet365 are separate sources. A correction is a NEW row whose `supersedes` names the old one.
--   historical_odds_export  one row per private CSV export (file name, sha256, row counts): the CSV itself lives only in
--                           the private ops repo, never here and never on the site.
--   historical_archive_count one row per job run with the counts it saw: the publish guard refuses to deploy if a live
--                           count is ever lower than the highest recorded.
--
-- Same protections as the Pinnacle archive: SELECT + INSERT only for service_role, nothing for anon / authenticated /
-- public, RLS on with no policy, BEFORE UPDATE OR DELETE and BEFORE TRUNCATE triggers that raise for every role.
-- Idempotent: safe to re-run.

create table if not exists public.historical_odds_file (
  id            bigint generated always as identity primary key,
  sha256        text        not null unique,       -- sha256 of the ORIGINAL bytes
  name          text        not null,              -- e.g. odds-archive/2026.csv, 2026.xlsx
  source        text        not null,              -- 'repo odds-archive', 'git history', 'mirror nickdatak', 'drop-in workbook'
  kind          text        not null check (kind in ('normalized csv', 'workbook', 'log', 'corrections')),
  seasons       int[]       not null default '{}',
  row_count     integer,
  first_date    date,
  last_date     date,
  bytes         integer     not null,
  content_gz    bytea       not null,              -- gzip of the original bytes
  obtained_at   timestamptz,                       -- when we got it (commit time, drop-in time, fetch time)
  meta          jsonb       not null default '{}'::jsonb,
  inserted_at   timestamptz not null default now()
);

create table if not exists public.historical_close (
  id            bigint generated always as identity primary key,
  dedupe_key    text        not null unique,       -- source|date|tournament|round|winner|loser|pw|pl
  source        text        not null check (source in ('tennis-data Pinnacle', 'tennis-data Bet365')),
  book          text        not null check (book in ('Pinnacle', 'Bet365')),
  match_date    date        not null,
  tournament    text        not null,
  series        text,
  court         text,
  surface       text,
  round         text,
  best_of       smallint,
  winner        text        not null,
  loser         text        not null,
  comment       text,                              -- Completed / Retired / Walkover ...
  price_winner  numeric     not null check (price_winner >= 1.01),
  price_loser   numeric     not null check (price_loser >= 1.01),
  file_sha256   text        not null references public.historical_odds_file(sha256),
  supersedes    bigint      references public.historical_close(id),
  detail        jsonb       not null default '{}'::jsonb,
  inserted_at   timestamptz not null default now()
);
create index if not exists historical_close_date on public.historical_close (match_date);

create table if not exists public.historical_odds_export (
  id            bigint generated always as identity primary key,
  name          text        not null unique,       -- pinnacle-closes-2010-2026_YYYY-MM-DD.csv (in the private ops repo)
  sha256        text        not null,
  rows          integer     not null,
  per_year      jsonb       not null default '{}'::jsonb,
  location      text        not null,              -- the private repo path
  detail        jsonb       not null default '{}'::jsonb,
  inserted_at   timestamptz not null default now()
);

create table if not exists public.historical_archive_count (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  job           text        not null,
  file_rows     bigint      not null,
  close_rows    bigint      not null,
  export_rows   bigint      not null,
  detail        jsonb       not null default '{}'::jsonb
);

create or replace function public.historical_archive_forbid() returns trigger language plpgsql as $$
begin
  raise exception 'the historical odds archive is append-only: % on %.% is not allowed (add a new row with supersedes instead)',
    tg_op, tg_table_schema, tg_table_name using errcode = '42501';
end $$;

do $$
declare t text;
begin
  foreach t in array array['historical_odds_file', 'historical_close', 'historical_odds_export', 'historical_archive_count'] loop
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
create or replace function public.historical_archive_guard() returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  r jsonb := '{}'::jsonb; t text; trg_ok boolean; priv_bad text[] := '{}'; all_ok boolean := true; n bigint; mx jsonb;
begin
  foreach t in array array['historical_odds_file', 'historical_close', 'historical_odds_export', 'historical_archive_count'] loop
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
  select jsonb_build_object('file', coalesce(max(file_rows), 0), 'close', coalesce(max(close_rows), 0), 'export', coalesce(max(export_rows), 0))
    into mx from public.historical_archive_count;
  return r || jsonb_build_object('maxRecorded', mx, 'ok', all_ok, 'at', now());
end $$;
revoke all on function public.historical_archive_guard() from public;
grant execute on function public.historical_archive_guard() to anon, authenticated, service_role;
revoke all on function public.historical_archive_forbid() from public, anon, authenticated;
