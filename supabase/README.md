# Supabase — live proxy backend (TEN-107)

Home for the shared-poller live proxy. Backend decision is **locked**: Supabase
(Pro, Europe, spend cap on), proxy runtime = **Supabase Edge Function,
consolidated** (no Cloudflare split; a clean poll/serve seam is reserved).

Build spec of record: board doc **`proxy-build-spec`** on TEN-107. Shrink curve
for the rating layer: board doc **`shrink-curve`**.

## Tier 1 — Realtime push + 10s poll (founder-approved 2026-08-31)

Staged on branch `ten107-tier1-realtime`. Closes ~30–40s of the ~50–60s gap vs
Flashscore that was self-inflicted by two stacked 30s poll stages (see board doc
`live-latency-vs-flashscore`). Three coupled changes:

1. **Browser read → Supabase Realtime (WebSocket push).** `live-tab.js` gains a
   raw-WebSocket Phoenix subscription to `postgres_changes` on `live_snapshot`
   (the table is already in the `supabase_realtime` publication — see
   `…_live_snapshot.sql` §4). Gated behind a **new** flag `FEATURE_LIVE_REALTIME`,
   **default OFF** → unchanged 30s-poll behaviour until the flag is flipped. A push
   is treated as a **trigger, not a payload**: on each change the client does a
   one-shot PostgREST fetch of the row (which has no ~1MB Realtime record cap and
   is immune to record-shape drift). A failed `postgres_changes` binding (Realtime
   `system` error), connect throw, or exhausted reconnects all degrade back to the
   30s poll, so the feed never goes dark; a 25s backstop fetch runs even during
   reconnect backoff.
2. **Poller cadence 30s → 10s.** `…_schedule.sql`: job renamed `live-poller-10s`,
   interval `'10 seconds'`; the migration now unschedules the legacy 30s job too.
3. **Lease TTL 25s → 7s, upstream fetch timeout 12s → 6s** (`live-poller/index.ts`).
   Required by (2): the TTL lease must be **shorter than the cadence** (with ~3s
   margin for pg_cron's ~1s jitter, or a grazed tick self-skips → a 20s gap) or
   every tick self-skips and effective cadence stays pinned at the TTL; the fetch
   timeout must be **shorter than the TTL** so single-flight can't leak a duplicate
   upstream call.

**api-tennis rate cap:** confirmed empirically (2026-08-31) — 8 rapid
`get_livescore` calls (well above the 6/min a 10s cadence needs) returned HTTP
200 with no 429 and no rate-limit headers. 10s cadence (~8,640 calls/day) is
within the Ultra plan's headroom.

**Go-live (the confirm-before-live gate) = three flips, all reversible:**
- redeploy the Edge Function (`supabase functions deploy live-poller`) with the
  new TTL/timeout;
- apply `…_schedule.sql` (retires the 30s job, schedules the 10s job);
- set `window.FEATURE_LIVE_REALTIME = true` in the frontend build config.

**Not yet done here:** the Realtime push path needs one live verification — a real
`live_snapshot` UPDATE observed arriving over the socket during a live match
(headless can't prove push without triggering a prod write). Suggested as part of
the go-live co-check.

## Status of this directory

| Slice | What | State |
|---|---|---|
| 1 | `live_snapshot` + `poller_lock` + RLS (`migrations/…_live_snapshot.sql`) | **staged in this branch** |
| 2 | Poller: single-flight RPCs (`…_poller_rpc.sql`) + Edge Function (`functions/live-poller`) | **staged (not executed)** |
| 3 | Member read path (PostgREST/Realtime + stale/backoff/freeze-final, flag-gated) | **staged** (`live-overlay.js` + dashboard wiring: `data-ek`, CSS, script tag; flag OFF) |
| 4 | Rating overlay (layer-10 live window + shrink-to-baseline + DR) | not started |
| 5 | Clean-context review → confirm-before-live gate → deploy | not started |

**Nothing here is applied to the live project.** Applying the migration and
deploying the function are the confirm-before-live gate (Slice 5). The frontend
stays flag-OFF until then.

## Apply path (only after the confirm-before-live gate)

The migration is plain, idempotent SQL — it can be applied either way:

- **Supabase CLI:** `supabase db push` (once the CLI is linked to the project), or
- **SQL editor / CI:** paste `migrations/20260829021135_live_snapshot.sql` into
  the Supabase SQL editor, or run it from a GitHub Actions step against the
  Postgres connection string.

Re-running is safe: every statement is idempotent (`create … if not exists`,
`insert … on conflict do nothing`, `drop policy if exists`, publication guarded
by a `pg_publication_tables` check).

## Single-flight design note (SKIP-LOCKED → TTL lease)

The spec calls for a `FOR UPDATE SKIP LOCKED` lock row. A row lock releases when
its transaction ends, but the poller's expensive step — the external
`get_livescore` fetch — happens **between** PostgREST calls, so no single
transaction can hold the row across it. `begin_poll()` realises the *same
intent* (collapse overlapping ticks to one upstream call) with an **atomic TTL
lease**: a single `UPDATE … WHERE locked_at IS NULL OR locked_at < now()-ttl`.
Only one concurrent tick wins; a crashed holder self-heals after the TTL
(25s < 30s cadence). This is the correct realisation for a stateless function —
flagged for founder review, not a silent reinterpretation of the spec.

## Deploy & schedule (only after the confirm-before-live gate)

```bash
# Edge Function
supabase functions deploy live-poller --no-verify-jwt   # guarded by x-poller-secret instead
supabase secrets set API_TENNIS_KEY=…  POLLER_SECRET=…   # from repo .env / generated

# pg_cron → pg_net invocation (run in SQL editor; keep secrets in Vault, not here)
select cron.schedule(
  'live-poller-30s', '*/30 * * * * *',   -- pg_cron seconds syntax
  $$ select net.http_post(
       url    := '<project-url>/functions/v1/live-poller',
       headers:= jsonb_build_object('x-poller-secret', (select decrypted_secret from vault.decrypted_secrets where name='POLLER_SECRET')),
       timeout_milliseconds := 12000
     ); $$
);
```

## Security model (why the RLS is shaped this way)

- `live_snapshot` — RLS on, one `select` policy for `anon, authenticated`, plus a
  table-level `grant select`. The browser reads this row and nothing else.
- `poller_lock` — RLS on, **zero policies** → anon/authenticated are denied every
  row; table grants revoked. Only the service role (which bypasses RLS) touches
  it. The poller runs as the service role.
- The poller writes `live_snapshot` as the service role too (RLS-bypass), so no
  write policy is exposed to public roles.

## Secrets (Supabase-consolidated)

- `API_TENNIS_KEY` → Supabase secret store (`supabase secrets set …`); set at
  build time from the repo `.env`. This is what the poller calls the feed with.
- Service role (`sb_secret_…`) → auto-injected into Edge Functions; **remove from
  GitHub Actions** and re-add only to whatever runner writes to Postgres at the
  data stage.
- `sb_publishable_…` + project URL → frontend build (public by design — the
  browser reads the snapshot row).
