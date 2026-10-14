-- Permanent Pinnacle archive (founder brief 2026-10-14, item 1). ADDITIVE: creates three new tables and one read-only
-- function; touches no existing object. Rules: .claude/rules/pinnacle-archive.md.
--
--   oddspapi_archive_raw    every Oddspapi /v4/historical-odds payload we hold, byte for byte (gzip of the body as
--                           Oddspapi returned it), one row per distinct payload per fixture.
--   pinnacle_archive_close  every derived Pinnacle close, with source, label, timestamp and gap to the start. A
--                           correction is a NEW row whose `supersedes` names the old one; the old row stays.
--   pinnacle_archive_count  one row per archive job run: the row counts it saw. The publish guard reads the highest
--                           recorded count and refuses to deploy if the live count is ever lower.
--
-- Nothing can update or delete a row:
--   * grants: anon / authenticated / public get nothing; service_role (the pipeline's key) gets SELECT + INSERT only —
--     UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER are revoked;
--   * triggers: BEFORE UPDATE OR DELETE (each row) and BEFORE TRUNCATE (statement) raise, for every role including the
--     table owner (the Management API's `postgres`). Removing a trigger is a schema change, and the guard reports it;
--   * RLS on with no policy, so a role that is ever granted access by mistake still reads and writes nothing.
-- Idempotent: safe to re-run (IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS + CREATE).

create table if not exists public.oddspapi_archive_raw (
  id              bigint generated always as identity primary key,
  fixture_id      text        not null,
  source          text        not null,          -- e.g. 'oddspapi-raw bucket', 'oddspapi /v4/historical-odds'
  object_path     text,                          -- the bucket path it came from, when it came from the bucket
  pulled_at       timestamptz,                   -- when it was fetched from Oddspapi (bucket: the object's created_at)
  books           text[]      not null default '{}',
  payload_gz      bytea       not null,          -- gzip of the response body, exactly as stored / received
  payload_sha256  text        not null,          -- sha256 of the DECOMPRESSED body
  body_bytes      integer     not null,
  meta            jsonb       not null default '{}'::jsonb,
  supersedes      bigint      references public.oddspapi_archive_raw(id),
  inserted_at     timestamptz not null default now(),
  constraint oddspapi_archive_raw_once unique (fixture_id, payload_sha256)
);
create index if not exists oddspapi_archive_raw_fixture on public.oddspapi_archive_raw (fixture_id);

create table if not exists public.pinnacle_archive_close (
  id              bigint generated always as identity primary key,
  dedupe_key      text        not null unique,   -- source|label|eventKey|fixtureId|closeTs|p1|p2: a re-import adds nothing
  event_key       bigint,                        -- api-tennis event key (the site's match id)
  fixture_id      text,                          -- Oddspapi fixture id, when known
  match_date      date,
  p1_key          bigint,
  p2_key          bigint,
  p1_name         text,
  p2_name         text,
  p1              numeric     not null check (p1 >= 1.01),
  p2              numeric     not null check (p2 >= 1.01),
  book            text        not null,          -- 'Pinnacle +30s' (Oddspapi pinnacle+30), 'Pinnacle' (Oddspapi pinnacle)
  label           text        not null check (label in ('captured', 'from Pinnacle history')),
  source          text        not null,          -- where the close was derived from
  close_ts        timestamptz,                   -- the time of the price used (the later of the two sides)
  start_ts        timestamptz,                   -- the start the close was cut at
  start_source    text,
  gap_to_start_s  numeric,                       -- start_ts - close_ts, seconds (>= 0)
  raw_id          bigint      references public.oddspapi_archive_raw(id),
  supersedes      bigint      references public.pinnacle_archive_close(id),
  detail          jsonb       not null default '{}'::jsonb,
  inserted_at     timestamptz not null default now()
);
create index if not exists pinnacle_archive_close_event on public.pinnacle_archive_close (event_key);

create table if not exists public.pinnacle_archive_count (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  job         text        not null,
  raw_rows    bigint      not null,
  close_rows  bigint      not null,
  detail      jsonb       not null default '{}'::jsonb
);

create or replace function public.pinnacle_archive_forbid() returns trigger language plpgsql as $$
begin
  raise exception 'the Pinnacle archive is append-only: % on %.% is not allowed (add a new row with supersedes instead)',
    tg_op, tg_table_schema, tg_table_name using errcode = '42501';
end $$;

do $$
declare t text;
begin
  foreach t in array array['oddspapi_archive_raw', 'pinnacle_archive_close', 'pinnacle_archive_count'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select, insert on public.%I to service_role', t);
    execute format('drop trigger if exists %I on public.%I', t || '_no_change', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.pinnacle_archive_forbid()', t || '_no_change', t);
    execute format('drop trigger if exists %I on public.%I', t || '_no_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.pinnacle_archive_forbid()', t || '_no_truncate', t);
  end loop;
end $$;

-- Read-only guard state for the publish guard (callable with the site's publishable key: it returns counts and
-- booleans only, never a row). `ok` is true only when every protection is in place.
create or replace function public.pinnacle_archive_guard() returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  r jsonb := '{}'::jsonb; t text; trg_ok boolean; priv_bad text[] := '{}'; all_ok boolean := true; n bigint; mx jsonb;
begin
  foreach t in array array['oddspapi_archive_raw', 'pinnacle_archive_close', 'pinnacle_archive_count'] loop
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
  select jsonb_build_object('raw', coalesce(max(raw_rows), 0), 'close', coalesce(max(close_rows), 0)) into mx from public.pinnacle_archive_count;
  return r || jsonb_build_object('maxRecorded', mx, 'ok', all_ok, 'at', now());
end $$;
revoke all on function public.pinnacle_archive_guard() from public;
grant execute on function public.pinnacle_archive_guard() to anon, authenticated, service_role;
revoke all on function public.pinnacle_archive_forbid() from public, anon, authenticated;
