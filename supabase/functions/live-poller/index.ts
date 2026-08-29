// TEN-107 · Slice 2 — shared live poller (Supabase Edge Function, Deno)
//
// One shared poller, invoked on a ~30s pg_cron timer (see supabase/README.md).
// Per tick:
//   1. begin_poll() — atomic TTL-lease single-flight; overlapping ticks that
//      lose the lease exit immediately, so only ONE upstream get_livescore
//      call happens per window (replaces Cloudflare's native coalescing).
//   2. get_livescore — one bulk call returns the whole live board (Ultra plan
//      carries full in-play stats; call shape matches api-tennis-integration.js).
//   3. write_snapshot() — upsert the singleton live_snapshot row as jsonb.
//
// Runs as the service role (auto-injected). Nothing here is deployed until the
// confirm-before-live gate. STAGED / not yet executed against Supabase runtime.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_TENNIS_KEY = Deno.env.get("API_TENNIS_KEY")!;
// Shared secret so only pg_cron (which sends it) can trigger the poller.
const POLLER_SECRET = Deno.env.get("POLLER_SECRET") ?? "";

const API_BASE = "https://api.api-tennis.com/tennis/";
const LEASE_TTL_SECONDS = 25; // < cron cadence (30s) so a dead tick self-heals

const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  // Only the scheduler may invoke this.
  if (POLLER_SECRET && req.headers.get("x-poller-secret") !== POLLER_SECRET) {
    return json({ error: "forbidden" }, 403);
  }

  const instance = crypto.randomUUID();

  // 1. Single-flight: claim the lease. Lost the race → another tick owns it.
  const { data: acquired, error: lockErr } = await db.rpc("begin_poll", {
    _instance: instance,
    _ttl_seconds: LEASE_TTL_SECONDS,
  });
  if (lockErr) return json({ error: "lock_failed", detail: lockErr.message }, 500);
  if (acquired !== true) return json({ skipped: "another tick holds the lease" }, 200);

  // 2. One bulk upstream call for the whole live board.
  const url = `${API_BASE}?method=get_livescore&APIkey=${API_TENNIS_KEY}`;
  let payload: { success?: number; result?: unknown };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return json({ error: "upstream_http", status: res.status }, 502);
    payload = await res.json();
  } catch (e) {
    // Leave the previous snapshot intact; the read path shows a stale badge.
    return json({ error: "upstream_fetch", detail: String(e) }, 502);
  }

  // api-tennis returns { success: 1, result: [ ...fixtures ] }. On a quiet
  // board result may be [] or absent — write an empty board, not an error.
  const board = Array.isArray(payload?.result) ? payload!.result : [];
  const matchCount = (board as unknown[]).length;

  // 3. Persist the snapshot. Browsers read this row via PostgREST/Realtime.
  const { error: writeErr } = await db.rpc("write_snapshot", {
    _board: { matches: board },
    _match_count: matchCount,
    _source_ts: null,
  });
  if (writeErr) return json({ error: "write_failed", detail: writeErr.message }, 500);

  return json({ ok: true, matches: matchCount });
});
