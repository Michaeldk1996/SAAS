-- TEN-232 Part 1 — Kibl / Bet105 pre-match line archive.
--
-- WHY THIS TABLE EXISTS
-- Kibl has no history endpoint and no export endpoint — 71 paths, zero. It
-- serves the OPENING price and the CURRENT price per line and nothing between
-- them: measured, not assumed — `is_previous` never appears on a row and
-- `is_current` is ignored as a filter, so the documented three-state model is
-- two states in practice. A price we do not capture is not "harder to get
-- later", it is gone. This table is therefore append-only and first-write-wins:
-- we never overwrite an observation, because the earlier one is the one that
-- cannot be re-fetched.
--
-- SHAPE follows TEN-225: raw gzipped payloads in a private Supabase Storage
-- bucket (kibl-raw), summary rows here. The bucket is the source of truth; this
-- table is the queryable projection and can be rebuilt from the bucket.
--
-- RLS on with ZERO policies: the service key bypasses RLS, everything else is
-- denied. This is odds data under a partner grant, not public data.

create table if not exists public.kibl_line_observations (
    -- Dedupe key. Kibl puts a uuid on InfoMarketParticipant; when it is present
    -- it is the key, and when it is absent we hash the natural key instead so a
    -- missing uuid cannot silently collapse two distinct prices into one row.
    row_key            text primary key,

    -- When WE saw it. Kibl's only timestamp is inserted_on, which is Kibl's own
    -- row-write time and appears on static lookup tables too — so it is latency
    -- to Kibl, never latency to Bet105. Both are kept; neither is renamed into
    -- something it is not.
    observed_at        timestamptz not null,
    inserted_on        timestamptz,
    inserted_on_epoch  bigint,

    fixture_id         bigint not null,
    league_id          integer,
    feed_source_id     integer,

    market_type_id     integer,
    segment_id         integer,
    side_id            integer,
    participant_id     bigint,
    fixture_participant_id bigint,
    market_id          bigint,

    point              numeric,
    alt_id             integer,
    is_main            boolean,
    betting_type_id    integer,
    market_status_id   integer,

    -- opener | previous | current | unflagged. A CONVENIENCE LABEL with a lossy
    -- precedence: a line that has not moved is both the opener and the current
    -- price, and labels as 'opener' (30 of 108 rows, 28%, in the measured pull).
    -- Filtering state='current' would miss every one of them. Query the raw
    -- booleans below instead — they are the source of truth; `state` is a hint.
    state              text not null,
    is_opener          boolean,
    is_previous        boolean,
    is_current         boolean,
    is_live            boolean,

    price_american     integer,
    -- numeric, not float: a decimal price that round-trips through a float can
    -- come back 1.9619999 and compare unequal to itself on the next sweep.
    price_decimal      numeric,
    price_fraction     text,

    sweep_id           text,
    raw_object         text
);

-- `create table if not exists` does NOT add columns to a table that already
-- exists, so every column added after the first deploy needs its own idempotent
-- ALTER or the next insert fails with "column not found" — on a job whose whole
-- purpose is that a missed write is unrecoverable.
alter table public.kibl_line_observations
    add column if not exists is_opener   boolean,
    add column if not exists is_previous boolean,
    add column if not exists is_current  boolean,
    add column if not exists is_live     boolean;

create index if not exists kibl_lo_fixture_idx
    on public.kibl_line_observations (fixture_id, observed_at);
create index if not exists kibl_lo_observed_idx
    on public.kibl_line_observations (observed_at);
create index if not exists kibl_lo_league_state_idx
    on public.kibl_line_observations (league_id, state);
-- The movement query: every observation of one line in time order.
create index if not exists kibl_lo_line_idx
    on public.kibl_line_observations
       (fixture_id, market_type_id, segment_id, side_id, point, alt_id, observed_at);

alter table public.kibl_line_observations enable row level security;

-- One row per sweep. This is the job-reliability record and the 24h-gap alert's
-- source: a missing sweep row is a hole in the archive, and holes in an archive
-- of an unarchivable feed are permanent.
create table if not exists public.kibl_sweeps (
    sweep_id        text primary key,
    started_at      timestamptz not null,
    finished_at     timestamptz,
    leagues         text,
    fixtures_seen   integer,
    fixtures_priced integer,
    rows_seen       integer,
    rows_new        integer,
    api_calls       integer,
    bytes_down      bigint,
    raw_object      text,
    raw_bytes       integer,
    ok              boolean,
    note            text
);

alter table public.kibl_sweeps enable row level security;

-- ---------------------------------------------------------------------------
-- TEN-225 — kibl_fixtures.
--
-- Until now /info/fixtures was pulled on every sweep and written ONLY into the
-- raw blob. Nothing was lost (the blob is the source of truth and every sweep
-- carries its fixture list), but the card path cannot read a gzipped object per
-- fixture: it needs the player names to pair a Kibl fixture to our board, and it
-- needs a queryable start time. This is that projection.
--
-- ⚠️ `start_time` here IS KIBL'S SCHEDULED TIME. It is stored and it is NEVER a
-- Close cutoff — the TEN-225 start ladder (gated oddspapi trueStartTime, then
-- the api-tennis live flip, else dash) is the only thing allowed to cut a Close.
-- The column is named `scheduled_start` rather than `start_time` precisely so a
-- future reader cannot pick it up believing it is an actual start. The same
-- confusion already cost us a whole class of wrong Closes on bet365-history,
-- which collapses trueStartTime and startTime into one field.
--
-- FIRST SEEN WINS. `first_seen_at` is written once and never updated, because
-- "when did this fixture first appear to us" is the cadence measurement's
-- denominator. `last_seen_at`, `scheduled_start` and `name` DO move: a fixture
-- can be rescheduled and the newest statement is the true one.
create table if not exists public.kibl_fixtures (
    fixture_id        bigint primary key,
    league_id         integer,
    sport_id          integer,
    fixture_type_id   integer,
    feed_source_id    integer,

    -- Kibl's own scheduled time. NOT a start. NOT a Close cutoff. See above.
    scheduled_start   timestamptz,

    -- Raw, exactly as the feed writes it: "6112 Dhakshineswar Suresh vs Soonwoo
    -- Kwon" — a rotation number, then the two players. Kept verbatim so a
    -- parser change can be re-run over history instead of re-fetched (which for
    -- this feed is impossible past ~30 days).
    name              text,
    -- Parsed. NULL when the string did not split into exactly two singles
    -- players — a doubles fixture ("A/B vs C/D") or a shape we have not seen.
    -- NULL here means the fixture cannot be paired, so its card dashes. It never
    -- means "one player".
    player1_name      text,
    player2_name      text,
    -- The cross-feed join key: scheduled day + both surname keys, sorted. Same
    -- name_key() the oddspapi<->live-flip pairing uses, so the two cannot drift
    -- into disagreeing about who a player is.
    match_key         text,

    first_seen_at     timestamptz not null,
    last_seen_at      timestamptz not null,
    first_sweep_id    text,
    last_sweep_id     text
);

alter table public.kibl_fixtures
    add column if not exists match_key      text,
    add column if not exists player1_name   text,
    add column if not exists player2_name   text,
    add column if not exists first_sweep_id text,
    add column if not exists last_sweep_id  text;

create index if not exists kibl_fx_match_key_idx
    on public.kibl_fixtures (match_key);
create index if not exists kibl_fx_sched_idx
    on public.kibl_fixtures (scheduled_start);

alter table public.kibl_fixtures enable row level security;
