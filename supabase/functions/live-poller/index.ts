// TEN-107 · Slice 2 — shared live poller (Supabase Edge Function, Deno)
//
// One shared poller, invoked on a ~10s pg_cron timer (see supabase/README.md;
// Tier 1, founder-approved 2026-08-31: cadence 30s → 10s).
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
import { fetchFinals, FINALS_EVERY_S, FINALS_MAX_PER_TICK, FINALS_WINDOW_MIN } from "./finals.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// Prefer the platform-injected legacy service_role JWT; fall back to the new
// sb_secret_ key (injected by go-live as SB_SERVICE_KEY) if a project on the
// new API-key system doesn't expose SUPABASE_SERVICE_ROLE_KEY. Both bypass RLS.
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SB_SERVICE_KEY")!;
const API_TENNIS_KEY = Deno.env.get("API_TENNIS_KEY")!;
// Shared secret so only pg_cron (which sends it) can trigger the poller.
const POLLER_SECRET = Deno.env.get("POLLER_SECRET") ?? "";

const API_BASE = "https://api.api-tennis.com/tennis/";
// Tier 1: cadence is 10s (schedule.sql). Two invariants, with margin for pg_cron's
// ~1s sub-minute jitter so neither edge is grazed:
//   (a) TTL < cadence — else the previous tick's lease is still valid when the next
//       fires and every tick self-skips, pinning the effective rate to the TTL (was
//       25s, which at a 10s cadence would have held us at ~25s). TTL 7s leaves ~3s
//       below the 10s cadence, so a gap that jitters down toward ~9s still clears.
//   (b) fetch timeout < TTL — so a tick always finishes/aborts inside its own lease
//       window and a slow fetch can't leak a duplicate upstream call. 6s < 7s, and
//       6s comfortably exceeds observed get_livescore latency (sub-second–~2s).
const LEASE_TTL_SECONDS = 7;
const FETCH_TIMEOUT_MS = 6_000; // < LEASE_TTL_SECONDS so single-flight holds

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
  const startedAt = Date.now();   // the lease clock: the finals re-asks below must end inside it

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
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return json({ error: "upstream_http", status: res.status }, 502);
    payload = await res.json();
  } catch (e) {
    // Leave the previous snapshot intact; the read path shows a stale badge.
    return json({ error: "upstream_fetch", detail: String(e) }, 502);
  }

  // api-tennis returns { success: 1, result: [ ...fixtures ] }. On a quiet
  // board result may be [] or absent — write an empty board, not an error.
  const rawBoard = Array.isArray(payload?.result) ? payload!.result : [];
  const matchCount = (rawBoard as unknown[]).length;

  // TEN-107 detail panel (founder-approved 2026-08-31): split the heavy point log
  // off the pushed snapshot row. `pointbypoint` (~43% of a fixture) is dropped from
  // the board that Realtime ships to every viewer and instead written to live_pbp,
  // keyed by event_key, which the detail panel reads on demand. The board keeps
  // `statistics` + `scores` (the box score / Stats+Ratings tabs read the pushed row).
  const pbpByEk: Record<string, unknown> = {};
  const board = (rawBoard as Array<Record<string, unknown>>).map((fix) => {
    const ek = fix?.event_key;
    if (ek != null && Array.isArray(fix?.pointbypoint) && (fix.pointbypoint as unknown[]).length) {
      pbpByEk[String(ek)] = fix.pointbypoint;
    }
    // Shallow clone minus pointbypoint — leaves the original untouched.
    const { pointbypoint: _drop, ...rest } = fix;
    return rest;
  });

  // 3. Persist the snapshot. Browsers read this row via PostgREST/Realtime.
  const { error: writeErr } = await db.rpc("write_snapshot", {
    _board: { matches: board },
    _match_count: matchCount,
    _source_ts: null,
  });
  if (writeErr) return json({ error: "write_failed", detail: writeErr.message }, 500);

  // 4. Persist the point logs to the non-Realtime store (on-demand read path).
  //    A failure here must NOT fail the tick — the board (Stats/Ratings) is already
  //    written; only the Points tab degrades. Log and continue.
  //    `_live` = every key on the board, so a match that is still on it without a log yet is never taken as ended.
  const liveKeys = board.map((f) => f?.event_key).filter((k) => k != null).map(String);
  const { error: pbpErr } = await db.rpc("write_live_pbp", { _pbp: pbpByEk, _live: liveKeys });
  if (pbpErr) console.warn("write_live_pbp failed:", pbpErr.message);

  // 5. Point-by-point carry-over (founder brief 2026-10-23): a match that has just left the board keeps its row
  //    (write_live_pbp stamps ended_at) and, for FINALS_WINDOW_MIN minutes, is re-asked from the provider at most once a
  //    minute, so the finished-match view shows the provider's latest log before the next pipeline publish. Inside this
  //    tick's lease only (finals.ts); a failure never fails the tick.
  let finals = 0;
  const { data: due, error: dueErr } = await db.rpc("live_pbp_due_finals",
    { _window_min: FINALS_WINDOW_MIN, _every_s: FINALS_EVERY_S, _max: FINALS_MAX_PER_TICK });
  if (dueErr) console.warn("live_pbp_due_finals failed:", dueErr.message);
  else if (Array.isArray(due) && due.length) {
    // a setof-text RPC may arrive as plain strings or as { live_pbp_due_finals: "<ek>" } rows: accept both
    const keys = due.map((x: unknown) => (x && typeof x === "object") ? String(Object.values(x as Record<string, unknown>)[0]) : String(x));
    const got = await fetchFinals(keys, { apiKey: API_TENNIS_KEY, fetchFn: fetch, startedAt, leaseMs: LEASE_TTL_SECONDS * 1000 });
    for (const f of got) {
      const { error } = await db.rpc("write_live_pbp_final", { _event_key: f.ek, _pbp: f.pbp, _final: f.final, _fetched_at: f.fetchedAt });
      if (error) console.warn("write_live_pbp_final failed:", f.ek, error.message); else finals++;
    }
  }

  return json({ ok: true, matches: matchCount, pbp: Object.keys(pbpByEk).length, finals });
});
