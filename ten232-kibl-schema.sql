-- TEN-232 Part 1 — Kibl / Bet105 pre-match line archive.
--
-- WHY THIS TABLE EXISTS
-- Kibl has no history endpoint and no export endpoint — 71 paths, zero. It
-- keeps three states per line (opener / previous / current) and nothing else.
-- A price we do not capture is not "harder to get later", it is gone. This
-- table is therefore append-only and first-write-wins: we never overwrite an
-- observation, because the earlier one is the one that cannot be re-fetched.
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

    -- opener | previous | current | unflagged. 'unflagged' is a real value, not
    -- a null: a row carrying none of the three flags is a fact about the feed
    -- and gets recorded as one rather than being dropped.
    state              text not null,

    price_american     integer,
    -- numeric, not float: a decimal price that round-trips through a float can
    -- come back 1.9619999 and compare unequal to itself on the next sweep.
    price_decimal      numeric,
    price_fraction     text,

    sweep_id           text,
    raw_object         text
);

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
