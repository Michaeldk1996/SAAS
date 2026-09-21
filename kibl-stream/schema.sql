-- TEN-225 item 2(c) — the stream worker's heartbeat.
--
-- NOT APPLIED. The founder ruled "report the design and the monthly cost before
-- deploying the worker", and a table is part of the design.
--
-- WHY A NEW TABLE AT ALL, when 2(b) says "the SAME tables as the sweep — a new
-- writer, not a new schema". Because that ruling is about PRICES, and this is
-- not a price. The worker writes every observation into kibl_line_observations
-- exactly as the sweep does, on the same row_key and the same conflict target.
-- A heartbeat is operational state about the writer itself; putting it in the
-- price table would mean rows in the archive that are not observations, which
-- is a worse violation of the same rule.
--
-- SINGLETON, deliberately. `check (id = 1)` — the question this answers is "is
-- the worker alive RIGHT NOW", and a history of heartbeats is a different
-- (and much larger) thing that nothing has asked for. The same shape
-- live_snapshot already uses on this instance.
create table if not exists public.kibl_stream_heartbeat (
    id                            integer primary key default 1,
    beat_at                       timestamptz not null,
    connected                     boolean not null,

    -- SINCE THE LAST BEAT, not since boot. This is the founder's stated failure
    -- mode: "A connected worker receiving nothing looks exactly like a quiet
    -- market, and that is the failure that gets missed." A cumulative counter
    -- cannot answer it — it keeps climbing for as long as the process has ever
    -- worked. A per-beat count goes to zero the moment delivery stops.
    messages_since_last_beat      integer not null default 0,
    rows_written_since_last_beat  integer not null default 0,

    -- Climbing while messages stay flat is a SCHEMA CHANGE at the vendor, and
    -- it looks nothing like a quiet market. Separated for that reason.
    unreadable_since_last_beat    integer not null default 0,

    last_message_age_s            integer,
    reconnects_total              integer not null default 0,

    -- How long the worker was last blind. An alert that can say "you missed 4
    -- minutes" is worth more than one that says something is wrong, because on
    -- a feed with no history that number IS the loss.
    last_gap_seconds              integer,
    worker_version                text,

    constraint kibl_stream_heartbeat_singleton check (id = 1)
);

-- RLS on, zero policies, like every other table on this issue. Nothing in the
-- browser reads this; the liveness check runs server-side with the service key.
alter table public.kibl_stream_heartbeat enable row level security;
