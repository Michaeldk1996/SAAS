// TEN-169 — regression lock for the tournament-history cache freshness rule.
// Root cause fixed here: an ACTIVE player (in today's fixtures = a "seed" player)
// was served his career history from the 7-day TTL cache, so a mid-tournament
// snapshot froze both his round-by-round record AND the five Grand-Slam boxes
// derived from it. Tien's US Open '26 R32 win over Mensik (2026-09-06) never
// appeared until the TTL aged out. The invariant this test protects:
//   * seed players use a SHORT (1-hour) TTL — a cache older than that must refetch,
//     so a completed match surfaces within the hour instead of freezing for days
//   * opponents keep the 7-day TTL (the throttle that bounds API load)
// Scope: this locks the pure freshness DECISION (historyCacheFresh). Widening the
// seed TTL, dropping the seed branch inside historyCacheFresh, or weakening the
// schema/timestamp guards all fail here. It does NOT exercise the loop plumbing
// that passes isSeed in (bsp-pipeline.js buildPlayerProfiles) — that stays a code
// review concern. Pure logic, no network. Run: node tools/test-history-freshness.js
const { historyCacheFresh, TOURNAMENT_HISTORY_SCHEMA_VERSION: SCHEMA } = require('../bsp-pipeline.js');

let pass = 0, fail = 0;
function eq(label, got, want) {
  if (got === want) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${got}\n       want ${want}`); }
}

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const now = Date.parse('2026-09-07T00:00:00Z');
// A schema-current cache entry built 1 day ago: fresh for an opponent (< 7d),
// but STALE for a seed (> 1h) — this is exactly the Tien mid-tournament case.
const recent = { builtAt: new Date(now - 1 * DAY).toISOString(), v: SCHEMA, history: [{}] };
// Built 8 days ago (past both TTLs).
const stale = { builtAt: new Date(now - 8 * DAY).toISOString(), v: SCHEMA, history: [{}] };
// Fresh timestamp but an old schema version (must be treated as not-fresh).
const wrongSchema = { builtAt: new Date(now - 30 * 60 * 1000).toISOString(), v: SCHEMA - 1, history: [{}] };
// Built 10 minutes ago: still fresh even for a seed's 1-hour window.
const veryRecent = { builtAt: new Date(now - 10 * 60 * 1000).toISOString(), v: SCHEMA, history: [{}] };

// THE bug this issue was about: an active player whose cache is a day old. Must refetch.
eq('seed + 1-day cache   → refetch (past 1h TTL)', historyCacheFresh(recent, now, true), false);
eq('seed + 10-min cache  → reuse  (within 1h TTL)', historyCacheFresh(veryRecent, now, true), true);
eq('seed + exactly 1h    → refetch (strict <)', historyCacheFresh({ builtAt: new Date(now - HOUR).toISOString(), v: SCHEMA, history: [{}] }, now, true), false);
eq('seed + no cache      → refetch', historyCacheFresh(undefined, now, true), false);

// Opponent pool: TTL + schema behave as before (the throttle that keeps API load down).
eq('opponent + 1-day cache        → reuse (within 7d)', historyCacheFresh(recent, now, false), true);
eq('opponent + stale cache        → refetch', historyCacheFresh(stale, now, false), false);
eq('opponent + wrong schema       → refetch', historyCacheFresh(wrongSchema, now, false), false);
eq('opponent + no cache           → refetch', historyCacheFresh(undefined, now, false), false);
// Exactly at the 7-day boundary is not fresh (strict <).
const atEdge = { builtAt: new Date(now - 7 * DAY).toISOString(), v: SCHEMA, history: [{}] };
eq('opponent + exactly 7d old     → refetch', historyCacheFresh(atEdge, now, false), false);

console.log(`\n${fail ? 'FAIL' : 'PASS'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
