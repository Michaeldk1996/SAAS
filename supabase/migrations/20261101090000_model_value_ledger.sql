-- Model value ledger (founder brief 2026-11-01, "Model value ledger — forward archive with value tiers").
--
-- Every model price shown before a match, saved with the market prices at that moment (snapshots), the two key
-- snapshots per match-side (marks), and what happened (settlements: the Pinnacle close, CLV, the result, flat-1u profit
-- at the bet105 price). Written only by tools/value-ledger.mjs, INSERT … ON CONFLICT DO NOTHING. The value tier is NOT
-- stored: it is computed at export time from the stored edge (value-ledger-config.js), so a threshold change re-tests the
-- same rows.
--
-- Protection = the Pinnacle archive's (supabase/migrations/20261014120000_pinnacle_archive.sql):
--   * rows are only ever added — service_role gets SELECT + INSERT only; triggers refuse UPDATE, DELETE and TRUNCATE for
--     every role, the owner included; a correction is a NEW settlement row whose `supersedes` names the old one;
--   * RLS on, no policy: anon / authenticated read and write nothing.
-- Additive and idempotent.

create table if not exists public.value_ledger_snapshot (
  id                bigint generated always as identity primary key,
  run_id            text        not null,          -- the pipeline run that wrote it (GITHUB_RUN_ID[-attempt])
  snapshot_ts       timestamptz not null,          -- the model run's time (model-output.json computedAt)
  event_key         bigint      not null,          -- api-tennis event key (the site's match id)
  side              text        not null check (side in ('p1', 'p2')),
  player_key        text,
  player            text,
  opponent_key      text,
  opponent          text,
  tournament        text,
  tier              text check (tier in ('main draw', 'qualifying', 'challenger')),   -- null = not known
  surface           text,
  round             text,
  best_of           smallint,
  scheduled_start   timestamptz,                   -- api-tennis date + time (Europe/Berlin wall clock), never a start
  model_prob        numeric     not null check (model_prob > 0 and model_prob < 1),
  model_fair_odds   numeric,
  base_state        smallint    check (base_state in (1, 2, 3)),
  price_kind        text        not null check (price_kind in ('full', 'alt-anchor', 'elo-only')),
  shown_on_page     boolean     not null,          -- the Model page's display gate (state 2, 0–30 h before the start)
  layers_active     smallint,
  layers_total      smallint,
  pin_anchor_price  numeric     check (pin_anchor_price >= 1.01),   -- the model's frozen Pinnacle anchor (stage 1)
  pin_anchor_ts     timestamptz,
  pin_now_price     numeric     check (pin_now_price >= 1.01),      -- api-tennis Pinnacle (Pncl), latest pipeline read
  pin_now_read_at   timestamptz,
  b105_price        numeric     check (b105_price >= 1.01),         -- bet105 match winner, live at the run (Kibl)
  b105_opp_price    numeric     check (b105_opp_price >= 1.01),
  b105_price_at     timestamptz,                   -- Kibl insert time of that price (never book-post time)
  b105_status       text        not null,          -- 'ok' or why there is no price
  edge_b105         numeric,                       -- model_prob × b105_price − 1
  edge_pin          numeric,                       -- model_prob × pin_now_price − 1
  detail            jsonb       not null default '{}'::jsonb,
  inserted_at       timestamptz not null default now(),
  constraint value_ledger_snapshot_once unique (run_id, event_key, side)
);
create index if not exists value_ledger_snapshot_match on public.value_ledger_snapshot (event_key, side, snapshot_ts);

create table if not exists public.value_ledger_mark (
  id            bigint generated always as identity primary key,
  event_key     bigint      not null,
  side          text        not null check (side in ('p1', 'p2')),
  kind          text        not null check (kind in ('first_edge', 'last_pre_start')),
  snapshot_id   bigint      not null references public.value_ledger_snapshot(id),
  start_ts      timestamptz,                       -- last_pre_start: the verified start it was cut at
  start_source  text,
  detail        jsonb       not null default '{}'::jsonb,
  inserted_at   timestamptz not null default now(),
  constraint value_ledger_mark_once unique (event_key, side, kind)
);

create table if not exists public.value_ledger_settlement (
  id               bigint generated always as identity primary key,
  event_key        bigint      not null,
  side             text        not null check (side in ('p1', 'p2')),
  mark_kind        text        not null check (mark_kind in ('first_edge', 'last_pre_start')),
  snapshot_id      bigint      not null references public.value_ledger_snapshot(id),
  b105_price       numeric     check (b105_price >= 1.01),   -- the key snapshot's bet105 price (null = none)
  close_price      numeric     check (close_price >= 1.01),  -- Pinnacle close, this side (null = no close: CLV is a dash)
  close_opp_price  numeric     check (close_opp_price >= 1.01),
  close_ts         timestamptz,
  close_label      text,                                     -- the archive's label ('from Pinnacle history' | 'captured')
  close_start_ts   timestamptz,
  close_gap_s      numeric,                                  -- close_start_ts − close_ts
  clv              numeric,                                  -- b105_price × no-vig close prob − 1 (null = a dash)
  result           text        check (result in ('won', 'lost', 'void')),
  bet_rule         text,                                     -- settlement.js settleBet: null | 'stands' | 'void' | 'no-sets'
  profit           numeric,                                  -- flat 1u at b105_price; null = no bet105 price (no profit)
  no_profit_reason text,
  detail           jsonb       not null default '{}'::jsonb,
  supersedes       bigint      references public.value_ledger_settlement(id),
  inserted_at      timestamptz not null default now(),
  constraint value_ledger_settlement_once unique nulls not distinct (event_key, side, mark_kind, supersedes)
);

create or replace function public.value_ledger_forbid() returns trigger language plpgsql as $$
begin
  raise exception 'the model value ledger is append-only: % on %.% is not allowed (add a new row with supersedes instead)',
    tg_op, tg_table_schema, tg_table_name using errcode = '42501';
end $$;
revoke all on function public.value_ledger_forbid() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['value_ledger_snapshot', 'value_ledger_mark', 'value_ledger_settlement'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select, insert on public.%I to service_role', t);
    execute format('drop trigger if exists %I on public.%I', t || '_no_change', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.value_ledger_forbid()', t || '_no_change', t);
    execute format('drop trigger if exists %I on public.%I', t || '_no_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.value_ledger_forbid()', t || '_no_truncate', t);
  end loop;
end $$;

-- Read-only guard state (counts and booleans only, never a row). `ok` is true only when every protection is in place.
create or replace function public.value_ledger_guard() returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  r jsonb := '{}'::jsonb; t text; trg_ok boolean; priv_bad text[]; all_ok boolean := true; n bigint;
begin
  foreach t in array array['value_ledger_snapshot', 'value_ledger_mark', 'value_ledger_settlement'] loop
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
  return r || jsonb_build_object('ok', all_ok, 'at', now());
end $$;
revoke all on function public.value_ledger_guard() from public;
grant execute on function public.value_ledger_guard() to service_role;
