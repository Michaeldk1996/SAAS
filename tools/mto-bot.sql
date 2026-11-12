-- MTO (medical timeout) detector + Telegram alert + permanent archive (founder brief 2026-11-11; rules: .claude/rules/mto.md).
-- Source: Live Tennis API (livetennisapi.com, PRO key in Vault `livetennisapi_key`): GET /events?type=medical_timeout_start,
--   medical_timeout_end — rows its match scorer / chair umpire STATED. Never inferred from a pause: the feed's own
--   `pause_*` rows (basis "inferred") and bare suspensions are not asked for and never become an MTO.
-- Measured 11 Nov 2026 on four real ATP MTOs (Paris SF 7 Nov, Stockholm 8-9 Nov): 4 of 4 present, right player, score and
--   server; each row recorded 3-5 s after the scorer's own instant.
-- Detector (mto_rec, pg_cron every 10 s): ingest finished answers, fetch an unknown match once, file the MTO, send, fire
--   the next call (every tick while an ATP singles match is live on our board, else once a minute).
-- Scope: ATP main draw + ATP qualifying singles only = the drop bots' rule (drops_scope.verdict: exactly one api-tennis
--   fixture of type 'Atp Singles'). Anything else is never posted and never archived.
-- One post per MTO: the feed's event id is unique in mto.archive; a second row for the same match, player and score
--   inside 15 min is a duplicate and is not posted; a later MTO in the same match is a new post.
-- The player is the feed's `player` (1 / 2) or nothing: a row without one is posted with no MEDICAL tag and stored with
--   an empty player. Never guessed.
-- Telegram: the MTO chat only (Vault `mto_telegram_chat_id`; the drop bot's token, its sendMessage call). No chat secret =
--   'unsent: no vault secret' — never the drops chat. Failure alerts go to the pipeline chat only.
-- Idempotent; safe to re-run. Schedules NOTHING: the pg_cron jobs are an explicit step of mto-bot.yml.
create schema if not exists mto_rec;
create schema if not exists mto;
revoke all on schema mto_rec from public;
revoke all on schema mto from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema mto_rec from anon, authenticated';
    execute 'revoke all on schema mto from anon, authenticated';
  end if;
end $$;

create table if not exists mto_rec.config (
    id            boolean primary key default true check (id),
    base          text not null default 'https://api.livetennisapi.com/api/public/v1',
    types         text not null default 'medical_timeout_start,medical_timeout_end',
    idle_seconds  integer not null default 60,      -- poll cadence with no ATP singles match live on our board
    post_max_age  interval not null default interval '10 minutes'   -- an MTO seen later than this is archived, never posted
);
alter table mto_rec.config add column if not exists resend_max_age interval not null default interval '2 minutes';   -- a failed send is tried again only this long after the call
insert into mto_rec.config (id) values (true) on conflict (id) do nothing;

create table if not exists mto_rec.state (
    id          boolean primary key default true check (id),
    started_at  timestamptz not null default now(),   -- the first call asks for rows since this instant - 2 min
    cursor_id   bigint,                               -- the highest feed event id ingested
    last_ok_at  timestamptz,                          -- our last HTTP 200 from /events
    last_status integer,
    watermark   timestamptz                           -- the feed's own data clock (meta.watermark)
);
insert into mto_rec.state (id) values (true) on conflict (id) do nothing;

create table if not exists mto_rec.requests (
    id            bigint primary key,
    kind          text not null,                      -- events | match | result
    match_id      bigint,
    fired_at      timestamptz not null default now(),
    processed_at  timestamptz,
    status_code   integer,
    n_items       integer,
    note          text
);
create index if not exists mrequests_open_idx on mto_rec.requests (processed_at) where processed_at is null;

-- the feed's rows, held only until they are filed (out-of-scope rows are dropped at once)
create table if not exists mto_rec.events (
    id                bigint primary key,             -- the feed's event id
    match_id          bigint not null,
    type              text not null,
    player            integer,
    at                timestamptz,
    detected_at       timestamptz,
    reason            text,
    score             jsonb,
    duration_seconds  integer,
    seen_at           timestamptz not null default now(),
    handled_at        timestamptz
);
create index if not exists mevents_open_idx on mto_rec.events (id) where handled_at is null;

-- one row per feed match we had to look up; the descriptive columns are kept for ATP singles only
create table if not exists mto_rec.matches (
    match_id        bigint primary key,
    tour            text,
    is_doubles      boolean,
    is_qualifying   boolean,
    tier            text,
    tournament      text,
    round           text,
    surface         text,
    indoor          boolean,
    scheduled_time  timestamptz,
    p1_name         text,
    p1_country      text,
    p2_name         text,
    p2_country      text,
    status          text,
    outcome         text,
    winner          integer,
    final_games     jsonb,
    fetched_at      timestamptz not null default now()
);

-- tournament -> level, from the site's own tournament table (tools/mto-levels.sql, generated; a name it lacks = no badge)
create table if not exists mto.tournament_level (
    name_key  text primary key,
    level     text not null
);
alter table mto.tournament_level add column if not exists country text;   -- ISO-2 of the host country, from the same table

-- THE ARCHIVE: one row per medical timeout, kept for good.
create table if not exists mto.archive (
    id               bigserial primary key,
    source           text not null default 'Live Tennis API',
    source_event_id  bigint not null unique,
    source_match_id  bigint not null,
    event_key        bigint,                    -- our api-tennis match id
    tournament       text,
    level            text,
    round            text,
    qualifying       boolean,
    surface          text,
    indoor           boolean,
    called_at        timestamptz,               -- the scorer's instant (UTC)
    source_seen_at   timestamptz,               -- when the source recorded it
    seen_at          timestamptz not null default now(),   -- when we read it
    player_side      integer check (player_side in (1, 2)),
    player           text,                      -- who called it; NULL when the source does not say
    opponent         text,
    p1               text not null,
    p2               text not null,
    p1_country       text,
    p2_country       text,
    sets_won         jsonb,                     -- [p1, p2] at the call
    games            jsonb,                     -- [[p1 per set], [p2 per set]] at the call
    points           jsonb,                     -- [p1, p2] game score at the call
    server_side      integer check (server_side in (1, 2)),
    server           text,
    ended_at         timestamptz,
    duration_seconds integer,
    end_reason       text,
    final_result     text,                      -- filled after the match
    winner           text,
    outcome          text,
    retired          boolean,
    apitennis_status text,
    result_tries     integer not null default 0,
    result_asked_at  timestamptz,
    settled_at       timestamptz,
    dup_of           bigint,
    scope            text not null,             -- the drops_scope verdict that decided
    delivery         text not null,
    net_request_id   bigint,
    message          text,
    sent_at          timestamptz,
    delay_s          numeric                    -- sent_at - called_at
);
alter table mto.archive add column if not exists send_tries integer not null default 0;   -- Telegram sends tried
create index if not exists marchive_match_idx on mto.archive (source_match_id, called_at);
create index if not exists marchive_ek_idx on mto.archive (event_key);
create index if not exists marchive_player_idx on mto.archive (player);

create table if not exists mto.watch (
    id          boolean primary key default true check (id),
    open_since  timestamptz,
    problem     text,
    last_sent   timestamptz
);
insert into mto.watch (id) values (true) on conflict (id) do nothing;
create table if not exists mto.watch_log (
    id              bigserial primary key,
    at              timestamptz not null default now(),
    kind            text not null,              -- alert | recovered | startup
    text            text,
    net_request_id  bigint,
    delivery        text not null
);

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema mto_rec from anon, authenticated';
    execute 'revoke all on all tables in schema mto from anon, authenticated';
  end if;
end $$;

-- ── small helpers ────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function mto.ts(p text) returns timestamptz language plpgsql immutable as $$
begin return nullif(btrim(p), '')::timestamptz; exception when others then return null; end $$;

create or replace function mto.int(p text) returns integer language plpgsql immutable as $$
begin return nullif(btrim(p), '')::integer; exception when others then return null; end $$;

create or replace function mto.esc(p text) returns text language sql immutable as $$
  select replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') $$;

-- IOC country code -> flag emoji; a code the table lacks = no flag (never a guessed one)
create or replace function mto.flag(p_ioc text) returns text language plpgsql immutable as $$
declare iso text;
begin
  iso := ('{"arg":"AR","aus":"AU","aut":"AT","bel":"BE","bih":"BA","bol":"BO","bra":"BR","bul":"BG","can":"CA","chi":"CL",
            "chn":"CN","col":"CO","cro":"HR","cyp":"CY","cze":"CZ","den":"DK","dom":"DO","ecu":"EC","egy":"EG","esp":"ES",
            "est":"EE","fin":"FI","fra":"FR","gbr":"GB","geo":"GE","ger":"DE","gre":"GR","hkg":"HK","hun":"HU","ind":"IN",
            "irl":"IE","isr":"IL","ita":"IT","jor":"JO","jpn":"JP","kaz":"KZ","kor":"KR","lat":"LV","lbn":"LB","ltu":"LT",
            "lux":"LU","mda":"MD","mex":"MX","mon":"MC","mar":"MA","ned":"NL","nor":"NO","nzl":"NZ","par":"PY","per":"PE",
            "phi":"PH","pol":"PL","por":"PT","rou":"RO","rsa":"ZA","srb":"RS","sui":"CH","svk":"SK","slo":"SI","swe":"SE",
            "tha":"TH","tpe":"TW","tun":"TN","tur":"TR","ukr":"UA","uru":"UY","usa":"US","uzb":"UZ","ven":"VE","zim":"ZW",
            "mne":"ME","mkd":"MK","alg":"DZ","arm":"AM","aze":"AZ","bar":"BB","cmr":"CM","crc":"CR","esa":"SV","gua":"GT",
            "ina":"ID","iri":"IR","jam":"JM","ken":"KE","kuw":"KW","mas":"MY","ngr":"NG","pak":"PK","pur":"PR","qat":"QA",
            "ksa":"SA","sgp":"SG","sri":"LK","uae":"AE","vie":"VN","civ":"CI","sen":"SN","tog":"TG","ben":"BJ","gha":"GH",
            "hai":"HT","isl":"IS","alb":"AL","kos":"XK","lie":"LI","mlt":"MT","smr":"SM","and":"AD"}'::jsonb)->>lower(btrim(coalesce(p_ioc, '')));
  if iso is null then return ''; end if;
  return chr(127462 + ascii(substr(iso, 1, 1)) - 65) || chr(127462 + ascii(substr(iso, 2, 1)) - 65);
end $$;

-- an ISO-2 country -> its flag; anything else -> ''
create or replace function mto.flag_iso(p_iso text) returns text language sql immutable as $$
  select case when upper(btrim(coalesce(p_iso, ''))) ~ '^[A-Z]{2}$'
              then chr(127462 + ascii(substr(upper(btrim(p_iso)), 1, 1)) - 65) || chr(127462 + ascii(substr(upper(btrim(p_iso)), 2, 1)) - 65)
              else '' end $$;

-- the round as the site prints it (maRoundName): 1/16-finals -> R32, 1/8 -> R16, 1/4 -> Quarter-finals, 1/2 -> Semi-finals
create or replace function mto.round_short(p text) returns text language sql immutable as $$
  select case lower(btrim(coalesce(p, ''))) when '1/16-finals' then 'R32' when '1/8-finals' then 'R16'
              when '1/4-finals' then 'Quarter-finals' when '1/2-finals' then 'Semi-finals' else nullif(btrim(p), '') end $$;

-- one player's score at the call: his games per set ("6 0"), and his points in the current game in brackets once a point
-- has been played in it ("6 0 (30)"); unreadable games -> —
create or replace function mto.side_score(p_games jsonb, p_points jsonb, p_side integer) returns text language plpgsql immutable as $$
declare g text; pt text;
begin
  if jsonb_typeof(p_games) = 'array' and jsonb_array_length(p_games) = 2 and jsonb_typeof(p_games->(p_side - 1)) = 'array'
     and jsonb_array_length(p_games->(p_side - 1)) > 0 then
    select string_agg(x, ' ' order by o) into g from jsonb_array_elements_text(p_games->(p_side - 1)) with ordinality t(x, o);
  end if;
  if jsonb_typeof(p_points) = 'array' and jsonb_array_length(p_points) = 2
     and not (coalesce(p_points->>0, '0') = '0' and coalesce(p_points->>1, '0') = '0') then
    pt := p_points->>(p_side - 1);
  end if;
  return coalesce(g, '—') || coalesce(' (' || pt || ')', '');
end $$;

-- the level badge: the site's tournament table first, else the feed's own tier, else none
create or replace function mto.level(p_tournament text, p_tier text) returns text language sql stable as $$
  select coalesce(
    (select l.level from mto.tournament_level l where l.name_key = lower(btrim(coalesce(p_tournament, '')))),
    case lower(coalesce(p_tier, ''))
      when 'grand_slam' then 'Grand Slam' when 'atp_1000' then 'ATP 1000' when 'atp_500' then 'ATP 500'
      when 'atp_250' then 'ATP 250' when 'atp_finals' then 'ATP Finals' when 'davis_cup' then 'Davis Cup'
      when 'laver_cup' then 'Laver Cup' when 'united_cup' then 'United Cup' when 'olympics' then 'Olympics' end) $$;

-- "ATP Stockholm - Final" -> "Final"
create or replace function mto.round_words(p text) returns text language sql immutable as $$
  select nullif(btrim(regexp_replace(coalesce(p, ''), '^.* - ', '')), '') $$;

-- [[5,0],[7,0]] -> "5–7, 0–0" (player 1 first); nothing readable -> NULL
create or replace function mto.sets_text(p_games jsonb) returns text language plpgsql immutable as $$
declare n integer; i integer; out text[] := '{}'; a text; b text;
begin
  if p_games is null or jsonb_typeof(p_games) <> 'array' or jsonb_array_length(p_games) <> 2 then return null; end if;
  if jsonb_typeof(p_games->0) <> 'array' or jsonb_typeof(p_games->1) <> 'array' then return null; end if;
  n := least(jsonb_array_length(p_games->0), jsonb_array_length(p_games->1));
  if n = 0 then return null; end if;
  for i in 0 .. n - 1 loop
    a := p_games->0->>i; b := p_games->1->>i;
    if a is null or b is null then return null; end if;
    out := out || (a || '–' || b);
  end loop;
  return array_to_string(out, ', ');
end $$;

-- is an ATP singles match in play on our own live board right now? (api-tennis, the 10-second poller)
create or replace function mto.atp_live() returns boolean language plpgsql stable as $$
declare ok boolean;
begin
  select exists (
    select 1 from public.live_snapshot s, jsonb_array_elements(coalesce(s.board->'matches', '[]'::jsonb)) f
     where s.updated_at > now() - interval '2 minutes'
       and f->>'event_type_type' = 'Atp Singles' and f->>'event_live' = '1'
       and coalesce(btrim(f->>'event_winner'), '') = ''
       and coalesce(f->>'event_status', '') !~* 'finished|retired|walk|cancel|abandon|interrupt|suspend') into ok;
  return coalesce(ok, false);
exception when others then
  return false;
end $$;

-- ── recorder ─────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function mto_rec.get(p_path text) returns bigint language plpgsql as $$
declare k text; cfg mto_rec.config;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'livetennisapi_key' limit 1;
  if k is null or btrim(k) = '' then return null; end if;
  select * into cfg from mto_rec.config;
  return net.http_get(url := cfg.base || p_path, headers := jsonb_build_object('X-API-Key', btrim(k)),
                      timeout_milliseconds := 8000);
end $$;

-- one /events answer: the rows, the cursor, the feed's clock. Returns the rows written.
create or replace function mto_rec.ingest_events(p_body jsonb, p_seen timestamptz) returns integer language plpgsql as $$
declare e jsonb; n integer := 0; k integer; mx bigint;
begin
  for e in select * from jsonb_array_elements(coalesce(p_body->'data', '[]'::jsonb)) loop
    continue when mto.int(e->>'id') is null or mto.int(e->>'match_id') is null or coalesce(e->>'type', '') = '';
    mx := greatest(coalesce(mx, 0), (e->>'id')::bigint);
    continue when e->>'type' not in ('medical_timeout_start', 'medical_timeout_end');
    continue when coalesce(e->>'basis', 'observed') <> 'observed';      -- a stated row only, never an inferred one
    insert into mto_rec.events (id, match_id, type, player, at, detected_at, reason, score, duration_seconds, seen_at)
    values ((e->>'id')::bigint, (e->>'match_id')::bigint, e->>'type',
            case when e->>'player' in ('1', '2') then (e->>'player')::integer end,
            mto.ts(e->>'at'), mto.ts(e->>'detected_at'), e->>'reason',
            case when jsonb_typeof(e->'score') = 'object' then e->'score' end, mto.int(e->>'duration_seconds'), p_seen)
    on conflict (id) do nothing;
    get diagnostics k = row_count; n := n + k;
  end loop;
  update mto_rec.state set cursor_id = greatest(coalesce(cursor_id, 0), coalesce(mx, 0)),
         watermark = coalesce(mto.ts(p_body->'meta'->>'watermark'), watermark)
   where mx is not null or p_body->'meta' ? 'watermark';
  update mto_rec.state set cursor_id = null where cursor_id = 0;
  return n;
end $$;

-- one /matches/{id} answer
create or replace function mto_rec.ingest_match(p_body jsonb, p_match_id bigint) returns integer language plpgsql as $$
declare m jsonb := case when jsonb_typeof(p_body->'data') = 'object' then p_body->'data' else p_body end; atp boolean;
begin
  if mto.int(m->>'id') is distinct from p_match_id::integer then return 0; end if;
  atp := lower(coalesce(m->>'tour', '')) = 'atp' and coalesce(m->>'is_doubles', '') = 'false';
  insert into mto_rec.matches (match_id, tour, is_doubles, is_qualifying, tier, tournament, round, surface, indoor,
                               scheduled_time, p1_name, p1_country, p2_name, p2_country, status, outcome, winner, final_games, fetched_at)
  values (p_match_id, m->>'tour', case m->>'is_doubles' when 'true' then true when 'false' then false end,
          case when atp then case m->>'is_qualifying' when 'true' then true when 'false' then false end end,
          case when atp then m->>'tier' end, case when atp then m->>'tournament' end, case when atp then m->>'round' end,
          case when atp then m->>'surface' end, case when atp then case m->>'indoor' when 'true' then true when 'false' then false end end,
          case when atp then mto.ts(m->>'scheduled_time') end,
          case when atp then nullif(m->'players'->'p1'->>'name', '') end, case when atp then m->'players'->'p1'->>'country' end,
          case when atp then nullif(m->'players'->'p2'->>'name', '') end, case when atp then m->'players'->'p2'->>'country' end,
          m->>'status', m->>'outcome', case when m->>'winner' in ('1', '2') then (m->>'winner')::integer end,
          case when atp and jsonb_typeof(m->'score'->'games') = 'array' then m->'score'->'games' end, now())
  on conflict (match_id) do update set tour = excluded.tour, is_doubles = excluded.is_doubles,
         is_qualifying = excluded.is_qualifying, tier = excluded.tier, tournament = excluded.tournament, round = excluded.round,
         surface = excluded.surface, indoor = excluded.indoor, scheduled_time = excluded.scheduled_time,
         p1_name = excluded.p1_name, p1_country = excluded.p1_country, p2_name = excluded.p2_name, p2_country = excluded.p2_country,
         status = excluded.status, outcome = excluded.outcome, winner = excluded.winner, final_games = excluded.final_games,
         fetched_at = excluded.fetched_at;
  return 1;
end $$;

-- ── the archive row and its message ──────────────────────────────────────────────────────────────────────────────
create or replace function mto.render(a mto.archive) returns text language plpgsql stable as $$
declare head text; tf text; l1 text; l2 text;
begin
  -- The founder's layout (2026-11-12). Line 1 is what a phone notification shows. No source is named.
  select mto.flag_iso(l.country) into tf from mto.tournament_level l where l.name_key = lower(btrim(coalesce(a.tournament, '')));
  head := btrim(coalesce(tf, '') || ' ' || mto.esc(concat_ws(' · ', a.level, a.tournament, case when a.qualifying then 'Qualifying' end, mto.round_short(a.round))));
  l1 := btrim(mto.flag(a.p1_country) || ' ' || mto.esc(a.p1)) || '  ' || mto.side_score(a.games, a.points, 1)
        || coalesce('  ' || nullif(concat_ws(' · ', case when a.server_side = 1 then '● serving' end, case when a.player_side = 1 then '🩺 <b>MEDICAL</b>' end), ''), '');
  l2 := btrim(mto.flag(a.p2_country) || ' ' || mto.esc(a.p2)) || '  ' || mto.side_score(a.games, a.points, 2)
        || coalesce('  ' || nullif(concat_ws(' · ', case when a.server_side = 2 then '● serving' end, case when a.player_side = 2 then '🩺 <b>MEDICAL</b>' end), ''), '');
  return concat_ws(chr(10),
    '🚨 <b>' || concat_ws(' · ', 'LIVE', 'MTO', nullif(mto.esc(a.player), '')) || '</b>',
    nullif(head, ''),
    '',
    l1, l2,
    '',
    case when a.player_side is null then 'Player not stated.' end,
    '⏱ ' || coalesce(to_char(a.called_at at time zone 'UTC', 'HH24:MI:SS') || ' UTC', '—'));
end $$;

-- file one stated medical_timeout_start (the match row is known and ATP singles). Returns the archive id, or NULL.
create or replace function mto.file(e mto_rec.events, m mto_rec.matches) returns bigint language plpgsql as $$
declare v record; f drops_scope.fixture; dup bigint; rid bigint; side integer := e.player; srv integer; ek bigint;
        g jsonb := e.score->'games'; p jsonb := e.score->'points'; scope text; del text;
begin
  if m.p1_name is null or m.p2_name is null then return null; end if;
  begin
    select * into v from drops_scope.verdict(m.p1_name, m.p2_name, m.scheduled_time, coalesce(e.at, e.seen_at));
    scope := v.verdict; ek := v.event_key;
  exception when others then scope := 'held: scope check failed'; ek := null;
  end;
  if scope = 'post' then
    select * into f from drops_scope.fixture where event_key = ek;
  end if;
  if scope like 'held: not ATP%' then return null; end if;          -- our own fixture says it is not ATP: out of scope
  srv := case when e.score->>'server' in ('1', '2') then (e.score->>'server')::integer end;
  select a.id into dup from mto.archive a
   where a.source_match_id = e.match_id and a.player_side is not distinct from side and a.dup_of is null
     and a.games is not distinct from g and a.points is not distinct from p
     and a.called_at > coalesce(e.at, e.seen_at) - interval '15 minutes'
     and a.called_at <= coalesce(e.at, e.seen_at) + interval '15 minutes'
   order by a.id limit 1;
  del := case when dup is not null then 'duplicate' when scope = 'post' then 'unsent' else scope end;
  insert into mto.archive (source_event_id, source_match_id, event_key, tournament, level, round, qualifying, surface, indoor,
                           called_at, source_seen_at, seen_at, player_side, player, opponent, p1, p2, p1_country, p2_country,
                           sets_won, games, points, server_side, server, dup_of, scope, delivery)
  values (e.id, e.match_id, ek, coalesce(f.tournament_name, m.tournament),
          mto.level(coalesce(f.tournament_name, m.tournament), m.tier),
          mto.round_words(coalesce(f.tournament_round, m.round)),
          case when f.event_qualification is not null then lower(f.event_qualification) = 'true' else m.is_qualifying end,
          m.surface, m.indoor, e.at, e.detected_at, e.seen_at, side,
          case side when 1 then m.p1_name when 2 then m.p2_name end,
          case side when 1 then m.p2_name when 2 then m.p1_name end,
          m.p1_name, m.p2_name, m.p1_country, m.p2_country,
          case when jsonb_typeof(e.score->'sets') = 'array' then e.score->'sets' end,
          case when jsonb_typeof(g) = 'array' then g end, case when jsonb_typeof(p) = 'array' then p end,
          srv, case srv when 1 then m.p1_name when 2 then m.p2_name end, dup, coalesce(scope, 'held: scope check failed'), del)
  on conflict (source_event_id) do nothing
  returning id into rid;
  return rid;
end $$;

-- every unhandled feed row whose match we know: out of scope -> dropped; start -> filed; end -> closes its timeout
create or replace function mto.process() returns integer language plpgsql as $$
declare e mto_rec.events; m mto_rec.matches; n integer := 0; rid bigint;
begin
  for e in select * from mto_rec.events where handled_at is null order by id loop
    select * into m from mto_rec.matches where match_id = e.match_id;
    continue when not found;
    if lower(coalesce(m.tour, '')) <> 'atp' or m.is_doubles is distinct from false then
      delete from mto_rec.events where id = e.id;                  -- not ATP singles: nothing is kept
      continue;
    end if;
    if e.type = 'medical_timeout_start' then
      rid := mto.file(e, m);
      if rid is not null then n := n + 1; end if;
    elsif e.type = 'medical_timeout_end' then
      update mto.archive a set ended_at = e.at, duration_seconds = e.duration_seconds, end_reason = e.reason
       where a.id = (select b.id from mto.archive b
                      where b.source_match_id = e.match_id and b.player_side is not distinct from e.player
                        and b.ended_at is null and b.called_at <= coalesce(e.at, e.seen_at)
                      order by b.called_at desc limit 1);
    end if;
    update mto_rec.events set handled_at = now() where id = e.id;
  end loop;
  return n;
end $$;

create or replace function mto.send(p_text text, p_chat_secret text) returns bigint language plpgsql as $$
declare tok text; chat text;
begin
  select decrypted_secret into tok  from vault.decrypted_secrets where name = 'ten287_telegram_bot_token' limit 1;
  select decrypted_secret into chat from vault.decrypted_secrets where name = p_chat_secret limit 1;
  if tok is null or chat is null or btrim(chat) = '' then return null; end if;
  return net.http_post(
    url     := 'https://api.telegram.org/bot' || btrim(tok) || '/sendMessage',
    body    := jsonb_build_object('chat_id', btrim(chat), 'text', p_text, 'parse_mode', 'HTML', 'disable_web_page_preview', true),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 5000);     -- 5 s: a send Telegram does not answer is given up fast and sent again on the next tick
end $$;

create or replace function mto.settle() returns void language plpgsql as $$
begin
  -- a send Telegram never answered (a timeout, a network error), or answered 429 / 5xx, is tried again on the next tick
  -- (about every 10 s), up to 10 sends, only while the call is under 2 min old (config.resend_max_age; founder 2026-11-12). (11 Nov 2026: Ruud's 17:53Z MTO was archived and never posted,
  -- its one send timed out in the TLS handshake.) An HTTP 4xx is our own fault and is not retried.
  update mto.archive a set delivery = case when r.status_code between 200 and 299 then 'sent'
                                           when (r.status_code is null or r.status_code = 429 or r.status_code >= 500) and a.send_tries < 10
                                                and coalesce(a.called_at, a.seen_at) > now() - (select resend_max_age from mto_rec.config) then 'unsent'
                                           else 'failed: ' || coalesce('HTTP ' || r.status_code, r.error_msg, 'no response') end
    from net._http_response r where a.delivery = 'queued' and r.id = a.net_request_id;
  update mto.watch_log w set delivery = case when r.status_code between 200 and 299 then 'sent'
                                             else 'failed: ' || coalesce('HTTP ' || r.status_code, r.error_msg, 'no response') end
    from net._http_response r where w.delivery = 'queued' and r.id = w.net_request_id;
  update mto.archive set delivery = 'failed: no response'
   where delivery = 'queued' and sent_at < now() - interval '10 minutes';
end $$;

-- a row held for want of an api-tennis fixture is re-checked for 30 min (the drop bots' rule)
create or replace function mto.recheck() returns integer language plpgsql as $$
declare a mto.archive; m mto_rec.matches; v record; n integer := 0; f drops_scope.fixture;
begin
  for a in select * from mto.archive where seen_at > now() - interval '30 minutes' and dup_of is null
              and delivery in ('held: no api-tennis fixture', 'held: no api-tennis fixture (fixture list stale)', 'held: scope check failed') loop
    select * into m from mto_rec.matches where match_id = a.source_match_id;
    begin
      select * into v from drops_scope.verdict(a.p1, a.p2, m.scheduled_time, coalesce(a.called_at, a.seen_at));
    exception when others then continue;
    end;
    continue when v.verdict = a.delivery;
    if v.verdict = 'post' then
      select * into f from drops_scope.fixture where event_key = v.event_key;
      update mto.archive set scope = 'post', delivery = 'unsent', event_key = v.event_key,
             tournament = coalesce(f.tournament_name, tournament), level = mto.level(coalesce(f.tournament_name, tournament), m.tier),
             round = coalesce(mto.round_words(f.tournament_round), round),
             qualifying = case when f.event_qualification is not null then lower(f.event_qualification) = 'true' else qualifying end
       where id = a.id;
      n := n + 1;
    else
      update mto.archive set scope = v.verdict, delivery = v.verdict where id = a.id;
    end if;
  end loop;
  return n;
end $$;

-- after the match: the final score, the winner and whether it ended in a retirement
create or replace function mto.result_apply(p_match_id bigint) returns integer language plpgsql as $$
declare m mto_rec.matches; n integer;
begin
  select * into m from mto_rec.matches where match_id = p_match_id;
  if not found or lower(coalesce(m.status, '')) not in ('completed', 'cancelled') then return 0; end if;
  update mto.archive a set
         final_result = mto.sets_text(m.final_games),
         winner = case m.winner when 1 then a.p1 when 2 then a.p2 end,
         outcome = m.outcome,
         retired = case when m.outcome is null then null else lower(m.outcome) = 'retired' end,
         apitennis_status = (select f.event_status from drops_scope.fixture f where f.event_key = a.event_key),
         settled_at = now()
   where a.source_match_id = p_match_id and a.settled_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- ── the 10-second tick ───────────────────────────────────────────────────────────────────────────────────────────
create or replace function mto_rec.tick() returns integer language plpgsql as $$
declare r record; n integer := 0; k integer; rid bigint; st mto_rec.state; cfg mto_rec.config; a mto.archive;
        msg text; v_at timestamptz; due boolean; path text; mid bigint;
begin
  if not pg_try_advisory_xact_lock(288311) then return 0; end if;
  select * into cfg from mto_rec.config;
  -- 1. finished answers
  for r in select q.id, q.kind, q.match_id, h.status_code, h.content, h.error_msg, h.created from mto_rec.requests q
             join net._http_response h on h.id = q.id where q.processed_at is null order by q.id loop
    k := null;
    if r.status_code = 200 then
      begin
        if r.kind = 'events' then k := mto_rec.ingest_events(r.content::jsonb, coalesce(r.created, now()));
        else k := mto_rec.ingest_match(r.content::jsonb, r.match_id);
        end if;
      exception when others then k := null;
      end;
    end if;
    if r.kind = 'events' then
      update mto_rec.state set last_status = r.status_code,
             last_ok_at = case when r.status_code = 200 and k is not null then now() else last_ok_at end;
    elsif r.status_code = 404 then
      insert into mto_rec.matches (match_id, tour) values (r.match_id, 'unknown') on conflict (match_id) do nothing;
    end if;
    if r.kind = 'result' and k = 1 then perform mto.result_apply(r.match_id); end if;
    update mto_rec.requests set processed_at = now(), status_code = r.status_code, n_items = k,
           note = case when r.status_code = 200 and k is null then 'unreadable body'
                       when r.status_code is distinct from 200 then left(coalesce(r.error_msg, 'HTTP ' || r.status_code), 300) end
     where id = r.id;
  end loop;
  update mto_rec.requests set processed_at = now(), note = 'no response'
   where processed_at is null and fired_at < now() - interval '60 seconds';
  delete from mto_rec.requests where fired_at < now() - interval '2 days';
  delete from mto_rec.events where handled_at < now() - interval '7 days';
  delete from mto_rec.events where handled_at is null and seen_at < now() - interval '2 hours';   -- its match never resolved

  -- 2. file, re-check, send
  n := mto.process();
  perform mto.settle();
  perform mto.recheck();
  for a in select * from mto.archive where delivery = 'unsent' order by id limit 10 loop
    v_at := clock_timestamp();
    if coalesce(a.called_at, a.seen_at) < v_at - cfg.post_max_age then
      update mto.archive set delivery = 'not sent: seen ' || round(extract(epoch from (v_at - coalesce(a.called_at, a.seen_at))) / 60) || ' min after the call'
       where id = a.id;
      continue;
    end if;
    msg := mto.render(a);
    rid := mto.send(msg, 'mto_telegram_chat_id');
    update mto.archive set net_request_id = rid, message = msg, sent_at = case when rid is not null then v_at end,
           delay_s = case when rid is not null and a.called_at is not null then round(extract(epoch from (v_at - a.called_at))::numeric, 3) end,
           send_tries = send_tries + case when rid is null then 0 else 1 end,
           delivery = case when rid is null then 'unsent: no vault secret' else 'queued' end
     where id = a.id;
  end loop;

  -- 3. look up a match we do not know yet (at most 5 a tick, one call per match)
  for mid in select distinct e.match_id from mto_rec.events e
              where e.handled_at is null and not exists (select 1 from mto_rec.matches m where m.match_id = e.match_id)
                and not exists (select 1 from mto_rec.requests q where q.match_id = e.match_id and q.kind = 'match'
                                   and (q.processed_at is null or q.fired_at > now() - interval '60 seconds'))
              limit 5 loop
    rid := mto_rec.get('/matches/' || mid);
    exit when rid is null;
    insert into mto_rec.requests (id, kind, match_id) values (rid, 'match', mid);
  end loop;

  -- 4. after the match: ask for the result (20 min after the call, then every 20 min, for 3 days)
  for mid in select distinct a2.source_match_id from mto.archive a2
              where a2.settled_at is null and a2.dup_of is null and a2.seen_at > now() - interval '3 days'
                and coalesce(a2.called_at, a2.seen_at) < now() - interval '20 minutes'
                and (a2.result_asked_at is null or a2.result_asked_at < now() - interval '20 minutes')
              limit 2 loop
    rid := mto_rec.get('/matches/' || mid);
    exit when rid is null;
    insert into mto_rec.requests (id, kind, match_id) values (rid, 'result', mid);
    update mto.archive set result_asked_at = now(), result_tries = result_tries + 1 where source_match_id = mid and settled_at is null;
  end loop;

  -- 5. the next /events call: every tick with ATP singles live on our board or rows still coming, else once a minute
  select * into st from mto_rec.state;
  if not exists (select 1 from mto_rec.requests where kind = 'events' and processed_at is null) then
    due := mto.atp_live()
        or not exists (select 1 from mto_rec.requests where kind = 'events' and fired_at > now() - make_interval(secs => cfg.idle_seconds))
        or exists (select 1 from mto_rec.requests q where q.kind = 'events' and q.n_items >= 200 and q.fired_at > now() - interval '30 seconds');
    if due then
      path := '/events?type=' || cfg.types || '&limit=200' ||
              case when st.cursor_id is not null then '&after_id=' || st.cursor_id
                   else '&since=' || to_char((st.started_at - interval '2 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end;
      rid := mto_rec.get(path);
      if rid is not null then insert into mto_rec.requests (id, kind) values (rid, 'events'); end if;
    end if;
  end if;
  return n;
end $$;

-- ── failure alert (pg_cron every minute): to the pipeline chat, only while ATP singles is live ───────────────────────
create or replace function mto.problem() returns text language plpgsql stable as $$
declare st mto_rec.state;
begin
  select * into st from mto_rec.state;
  if not exists (select 1 from vault.decrypted_secrets where name = 'livetennisapi_key' and btrim(decrypted_secret) <> '') then
    return 'no API key in Vault: the detector cannot read its source';
  end if;
  if st.last_ok_at is null or st.last_ok_at < now() - interval '3 minutes' then
    return 'no successful read of the source for ' ||
           coalesce(round(extract(epoch from (now() - st.last_ok_at)) / 60)::text || ' min', 'any time yet') ||
           coalesce(' (last answer HTTP ' || st.last_status || ')', '');
  end if;
  if st.watermark is not null and st.watermark < now() - interval '5 minutes' then
    return 'the source has gone silent: its own data clock is ' || round(extract(epoch from (now() - st.watermark)) / 60) || ' min old';
  end if;
  -- a post that failed after every retry: the founder must know (2026-11-12: "we can not afford losing those")
  if exists (select 1 from mto.archive where delivery like 'failed:%' and sent_at > now() - interval '15 minutes') then
    return (select 'a medical timeout was NOT posted to Telegram after ' || a.send_tries || ' tries: ' || a.p1 || ' v ' || a.p2 || ' (' || left(a.delivery, 80) || ')'
              from mto.archive a where a.delivery like 'failed:%' and a.sent_at > now() - interval '15 minutes' order by a.id desc limit 1);
  end if;
  return null;
end $$;

create or replace function mto.watch_tick() returns text language plpgsql as $$
declare w mto.watch; p text := mto.problem(); live boolean := mto.atp_live(); msg text; rid bigint;
begin
  if not pg_try_advisory_xact_lock(288312) then return null; end if;
  perform mto.settle();
  select * into w from mto.watch;
  if p is not null and live and (w.open_since is null or w.last_sent is null or w.last_sent < now() - interval '3 hours') then
    msg := concat_ws(chr(10), '🩺 MTO bot — NOT WORKING',
                     mto.esc(p) || '.',
                     'ATP singles is in play, so a medical timeout would not be posted or archived.',
                     case when w.open_since is not null then 'Open since ' || to_char(w.open_since at time zone 'UTC', 'DD Mon HH24:MI') || ' UTC.' end);
    rid := mto.send(msg, 'pipeline_telegram_chat_id');
    insert into mto.watch_log (kind, text, net_request_id, delivery)
    values ('alert', msg, rid, case when rid is null then 'unsent: no vault secret' else 'queued' end);
    update mto.watch set open_since = coalesce(open_since, now()), problem = p, last_sent = now();
    return 'alert';
  elsif p is null and w.open_since is not null then
    msg := concat_ws(chr(10), '🩺 MTO bot — RECOVERED',
                     'Reading its source again. Was: ' || mto.esc(w.problem) || '.',
                     'Down from ' || to_char(w.open_since at time zone 'UTC', 'DD Mon HH24:MI') || ' UTC.');
    rid := mto.send(msg, 'pipeline_telegram_chat_id');
    insert into mto.watch_log (kind, text, net_request_id, delivery)
    values ('recovered', msg, rid, case when rid is null then 'unsent: no vault secret' else 'queued' end);
    update mto.watch set open_since = null, problem = null, last_sent = null;
    return 'recovered';
  end if;
  return null;
end $$;

-- THE WEEKLY REPORT (founder 2026-11-12): how many alerts failed to send. Population = every in-scope medical timeout
-- called in the p_days before p_to (duplicates of one timeout out). Every count carries that denominator.
create or replace function mto.weekly_text(p_to timestamptz default now(), p_days integer default 7) returns text language plpgsql stable as $$
declare a timestamptz := p_to - make_interval(days => p_days); n integer; sent integer; first_try integer; resent integer;
        failed integer; late integer; held integer; nochat integer; open_ integer; med numeric; lines text;
begin
  select count(*), count(*) filter (where delivery = 'sent'), count(*) filter (where delivery = 'sent' and send_tries <= 1),
         count(*) filter (where delivery = 'sent' and send_tries > 1), count(*) filter (where delivery like 'failed:%'),
         count(*) filter (where delivery like 'not sent:%'), count(*) filter (where delivery like 'held:%'),
         count(*) filter (where delivery like 'unsent: no vault%'), count(*) filter (where delivery in ('unsent', 'queued')),
         percentile_cont(0.5) within group (order by delay_s) filter (where delivery = 'sent' and delay_s is not null)
    into n, sent, first_try, resent, failed, late, held, nochat, open_, med
    from mto.archive where dup_of is null and coalesce(called_at, seen_at) >= a and coalesce(called_at, seen_at) < p_to;
  select string_agg('• ' || to_char(coalesce(x.called_at, x.seen_at) at time zone 'UTC', 'DD Mon HH24:MI') || ' UTC · ' || mto.esc(x.p1) || ' v ' || mto.esc(x.p2)
                    || ' · ' || mto.esc(left(x.delivery, 70)), chr(10) order by coalesce(x.called_at, x.seen_at))
    into lines
    from (select * from mto.archive where dup_of is null and coalesce(called_at, seen_at) >= a and coalesce(called_at, seen_at) < p_to
             and delivery <> 'sent' and delivery not in ('unsent', 'queued') order by coalesce(called_at, seen_at) limit 25) x;
  return concat_ws(chr(10),
    '🩺 <b>MTO alerts — weekly report</b>',
    to_char(a at time zone 'UTC', 'DD Mon') || ' – ' || to_char(p_to at time zone 'UTC', 'DD Mon HH24:MI') || ' UTC · ATP main draw + qualifying',
    '',
    'Medical timeouts detected: <b>' || n || '</b>',
    'Posted: <b>' || sent || ' of ' || n || '</b>' || case when sent > 0 then ' (first try ' || first_try || ', after a resend ' || resent || ')' else '' end,
    'FAILED to send: <b>' || failed || ' of ' || n || '</b>',
    case when late > 0 then 'Seen too late to post: ' || late || ' of ' || n end,
    case when held > 0 then 'Held (no single match on our board): ' || held || ' of ' || n end,
    case when nochat > 0 then 'No chat configured: ' || nochat || ' of ' || n end,
    case when open_ > 0 then 'Still sending: ' || open_ || ' of ' || n end,
    'Median call → post: ' || coalesce(round(med)::text || ' s (n=' || sent || ')', '—'),
    case when lines is not null then chr(10) || 'Not posted:' || chr(10) || lines end);
end $$;

-- sends it to the pipeline chat, at most once per 6 days (so a re-install or a double cron fire never repeats it)
create or replace function mto.weekly_send() returns text language plpgsql as $$
declare msg text; rid bigint;
begin
  perform pg_advisory_xact_lock(288312);
  perform mto.settle();
  if exists (select 1 from mto.watch_log where kind = 'weekly' and at > now() - interval '6 days' and delivery not like 'failed:%'
               and delivery <> 'unsent: no vault secret') then return 'already sent'; end if;
  msg := mto.weekly_text();
  rid := mto.send(msg, 'pipeline_telegram_chat_id');
  insert into mto.watch_log (kind, text, net_request_id, delivery)
  values ('weekly', msg, rid, case when rid is null then 'unsent: no vault secret' else 'queued' end);
  return case when rid is null then 'unsent' else 'queued' end;
end $$;

-- one startup message to the MTO chat, once
create or replace function mto.startup() returns bigint language plpgsql as $$
declare rid bigint; msg text;
begin
  perform pg_advisory_xact_lock(288311);
  if exists (select 1 from mto.watch_log where kind = 'startup' and delivery <> 'unsent: no vault secret') then return null; end if;
  msg := concat_ws(chr(10),
    '🩺 <b>MEDICAL TIMEOUT alerts — live (startup test)</b>',
    '',
    'One post each time a medical timeout is called in an ATP main-draw or ATP qualifying singles match.',
    'Each post: tournament, round, both players, who called it, the set and game score at that moment, who is serving.',
    'Only timeouts the source states — never guessed from a pause in play.');
  rid := mto.send(msg, 'mto_telegram_chat_id');
  insert into mto.watch_log (kind, text, net_request_id, delivery)
  values ('startup', msg, rid, case when rid is null then 'unsent: no vault secret' else 'queued' end);
  return rid;
end $$;

-- ── read side ────────────────────────────────────────────────────────────────────────────────────────────────────
-- the match record for the site: every posted-scope MTO by our api-tennis match id (a match with none is absent)
create or replace function public.mto_export() returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(jsonb_object_agg(x.event_key::text, x.rows), '{}'::jsonb) from (
    select a.event_key, jsonb_agg(jsonb_build_object(
             'calledAt', a.called_at, 'player', a.player, 'opponent', a.opponent, 'p1', a.p1, 'p2', a.p2,
             'games', a.games, 'points', a.points, 'server', a.server, 'endedAt', a.ended_at,
             'durationSeconds', a.duration_seconds, 'playerSide', a.player_side, 'serverSide', a.server_side,
             'finalResult', a.final_result, 'retired', a.retired) order by a.called_at, a.id) as rows
      from mto.archive a
     where a.event_key is not null and a.scope = 'post' and a.dup_of is null
     group by a.event_key) x $$;
revoke all on function public.mto_export() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.mto_export() from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.mto_export() to service_role';
  end if;
end $$;

create or replace function mto.report(p_hours integer default 24) returns jsonb language plpgsql stable as $$
declare st mto_rec.state; out jsonb;
begin
  select * into st from mto_rec.state;
  out := jsonb_build_object(
    'state', jsonb_build_object('startedAt', st.started_at, 'cursor', st.cursor_id, 'lastOkAt', st.last_ok_at,
                                'lastStatus', st.last_status, 'watermark', st.watermark),
    'problem', mto.problem(), 'atpLive', mto.atp_live(),
    'key', exists (select 1 from vault.decrypted_secrets where name = 'livetennisapi_key'),
    'chat', exists (select 1 from vault.decrypted_secrets where name = 'mto_telegram_chat_id'),
    'requests', (select jsonb_build_object('n', count(*), 'ok', count(*) filter (where status_code = 200),
                        'byKind', (select jsonb_object_agg(k, c) from (select kind k, count(*) c from mto_rec.requests
                                    where fired_at > now() - make_interval(hours => p_hours) group by kind) z))
                   from mto_rec.requests where fired_at > now() - make_interval(hours => p_hours)),
    'archive', (select jsonb_build_object('rows', count(*), 'withPlayer', count(*) filter (where player is not null),
                        'inWindow', count(*) filter (where seen_at > now() - make_interval(hours => p_hours)),
                        'settled', count(*) filter (where settled_at is not null)) from mto.archive),
    'delivery', (select coalesce(jsonb_object_agg(d, c), '{}'::jsonb) from (select split_part(delivery, ':', 1) d, count(*) c
                   from mto.archive where seen_at > now() - make_interval(hours => p_hours) group by 1) z),
    'startup', (select delivery from mto.watch_log where kind = 'startup' order by id desc limit 1),
    'watch', (select jsonb_build_object('openSince', open_since, 'problem', problem) from mto.watch));
  begin
    out := out || jsonb_build_object('cron', (select coalesce(jsonb_agg(jsonb_build_object('job', jobname, 'schedule', schedule, 'active', active)), '[]'::jsonb)
                                               from cron.job where jobname in ('mto-detector', 'mto-watch', 'mto-weekly')));
  exception when others then out := out || jsonb_build_object('cron', null);
  end;
  return out;
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all functions in schema mto_rec from public, anon, authenticated';
    execute 'revoke all on all functions in schema mto from public, anon, authenticated';
  end if;
end $$;
