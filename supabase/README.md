# Supabase — live proxy backend (TEN-107)

Home for the shared-poller live proxy. Backend decision is **locked**: Supabase
(Pro, Europe, spend cap on), proxy runtime = **Supabase Edge Function,
consolidated** (no Cloudflare split; a clean poll/serve seam is reserved).

Build spec of record: board doc **`proxy-build-spec`** on TEN-107. Shrink curve
for the rating layer: board doc **`shrink-curve`**.

## Status of this directory

| Slice | What | State |
|---|---|---|
| 1 | `live_snapshot` + `poller_lock` + RLS (`migrations/…_live_snapshot.sql`) | **staged in this branch** |
| 2 | Poller Edge Function (`get_livescore` → snapshot write, SKIP-LOCKED) | not started |
| 3 | Member read path (PostgREST/Realtime + stale/backoff/freeze-final, flag-gated) | not started |
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
