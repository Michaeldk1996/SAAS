// Point-by-point carry-over (founder brief 2026-10-23): the provider's own log for a match that has just left the live
// board. Pure (no imports, fetch passed in), so tools/test-live-poller-finals.mjs runs it in Node.
//
// The poller asks live_pbp_due_finals() which ended matches are due (ended within FINALS_WINDOW_MIN, last fetched
// FINALS_EVERY_S ago or never), fetches each with get_fixtures&match_key, and writes the log + a summary with
// write_live_pbp_final(). Only inside the tick's own lease: a re-ask starts only while FINALS_START_BEFORE_MS of the
// lease remains, and its timeout ends before the lease does, so the single-flight guarantee for get_livescore holds.

export const FINALS_WINDOW_MIN = 120;   // the provider kept revising for up to +57 min (stats) / +16 min (log), measured 2026-10-22
export const FINALS_EVERY_S = 60;
export const FINALS_MAX_PER_TICK = 2;
export const FINALS_START_BEFORE_MS = 3_000;

// What the page needs to show a just-ended match as finished, all from the provider's fixture (never derived).
export function summarize(fix: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!fix || typeof fix !== "object") return null;
  const keep = ["event_key", "event_status", "event_final_result", "event_winner", "scores", "event_first_player",
    "first_player_key", "event_second_player", "second_player_key", "event_date", "event_time", "tournament_name",
    "tournament_round", "event_type_type"];
  const out: Record<string, unknown> = {};
  for (const k of keep) if (k in fix) out[k] = (fix as Record<string, unknown>)[k];
  return out;
}

type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

// Fetch the due matches one by one inside the lease. Returns what to write; a failed or empty fetch is simply skipped
// (the row keeps what it has, and the match is asked again on a later tick).
export async function fetchFinals(due: string[], opts: { apiKey: string; fetchFn: FetchFn; startedAt: number;
  leaseMs: number; now?: () => number; apiBase?: string }): Promise<Array<{ ek: string; pbp: unknown[]; final: Record<string, unknown> | null; fetchedAt: string }>> {
  const now = opts.now ?? Date.now;
  const base = opts.apiBase ?? "https://api.api-tennis.com/tennis/";
  const out: Array<{ ek: string; pbp: unknown[]; final: Record<string, unknown> | null; fetchedAt: string }> = [];
  for (const ek of due.slice(0, FINALS_MAX_PER_TICK)) {
    const left = opts.leaseMs - (now() - opts.startedAt);
    if (left < FINALS_START_BEFORE_MS) break;
    try {
      const res = await opts.fetchFn(`${base}?method=get_fixtures&APIkey=${opts.apiKey}&match_key=${encodeURIComponent(ek)}`,
        { signal: AbortSignal.timeout(left - 500) });
      if (!res.ok) continue;
      const body = await res.json() as { result?: unknown };
      const fix = Array.isArray(body?.result) ? (body.result[0] as Record<string, unknown>) : null;
      if (!fix || String(fix.event_key) !== String(ek)) continue;
      const pbp = Array.isArray(fix.pointbypoint) ? fix.pointbypoint as unknown[] : [];
      out.push({ ek, pbp, final: summarize(fix), fetchedAt: new Date(now()).toISOString() });
    } catch (_) { /* timeout / network: asked again next tick */ }
  }
  return out;
}
