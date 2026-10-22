#!/usr/bin/env node
// Founder ruling 2026-10-21 (A2): should this pipeline run SAVE the bsp-caches entry?
//
// The old per-day key was immutable: the day's first save won, so every later run re-built the profiles that the
// morning's run had not seen (20 Oct after 11:19Z: 286–296 opponents rebuilt per run, profile phase median 5.1 min
// vs 0.7 min on 19 Oct). Now each run restores the newest entry and saves its own — but only when it is worth an
// entry, so the 10 GiB repo cache is not flooded the way the old run_id key once filled it (2026-09-16, 314 entries):
//   save  when no entry exists yet today (the day's first), or this run built >= MIN_BUILT opponent profiles;
//   skip  when today already holds MAX_PER_DAY entries (safety valve), or the run's stats file is missing/unreadable.
//
//   node tools/cache-save-decision.mjs --stats profile-build-stats.json --today <entries saved today>
// prints `save=true|false` and `reason=…` lines for $GITHUB_OUTPUT.
import fs from 'fs';

export const MIN_BUILT = 25;
export const MAX_PER_DAY = 6;

export function decide({ stats, todayCount, pbp = null }) {
  if (!Number.isInteger(todayCount) || todayCount < 0) return { save: false, reason: `today's entry count is unknown (${todayCount}) — not saving blind` };
  if (todayCount >= MAX_PER_DAY) return { save: false, reason: `safety valve: ${todayCount} entries already saved today (max ${MAX_PER_DAY})` };
  if (todayCount === 0) return { save: true, reason: 'first entry of the day' };
  // build-point-by-point.js replaced stored point logs with the provider's latest: unsaved, the next run restores the old ones
  if (pbp && Number.isInteger(pbp.replaced) && pbp.replaced > 0) return { save: true, reason: `replaced ${pbp.replaced} stored point log(s) with the provider's latest` };
  const built = stats && Number.isInteger(stats.opponentsBuilt) ? stats.opponentsBuilt : null;
  if (built == null) return { save: false, reason: 'no profile-build stats from this run' };
  return built >= MIN_BUILT
    ? { save: true, reason: `built ${built} opponent profiles (>= ${MIN_BUILT})` }
    : { save: false, reason: `built ${built} opponent profiles (< ${MIN_BUILT}); today's ${todayCount} entr${todayCount === 1 ? 'y' : 'ies'} already hold the rest` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  let stats = null;
  try { stats = JSON.parse(fs.readFileSync(arg('--stats'), 'utf8')); } catch (e) { stats = null; }
  const raw = arg('--today');
  let pbp = null;
  try { pbp = arg('--pbp-stats') ? JSON.parse(fs.readFileSync(arg('--pbp-stats'), 'utf8')) : null; } catch (e) { pbp = null; }
  const d = decide({ stats, pbp, todayCount: /^\d+$/.test(String(raw)) ? Number(raw) : NaN });
  console.log(`save=${d.save}`);
  console.log(`reason=${d.reason}`);
}
