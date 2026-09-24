#!/usr/bin/env node
// TEN-263 (founder ruling 2026-09-24, D-12): the Form rows' opponent Elo badge, "Opposition Elo"
// and "Elo change" use OVERALL Elo AT THE MATCH DATE: the latest weekly Tennis Abstract snapshot
// dated strictly before the match, and only if it is no more than 7 days old. elo-ratings.json holds
// the latest snapshot only, so this keeps the dated history: elo-history.json, append-only.
//
//   node tools/build-elo-history.mjs --append           append elo-ratings.json if its ratings changed
//   node tools/build-elo-history.mjs --from-git <repo>  one-time backfill from <repo>'s git history
//   node tools/build-elo-history.mjs --should-fetch     elo.yml: fetch today? (Monday, or a retry day)
//   node tools/build-elo-history.mjs --check-stale      elo.yml: warn when no new report for > 8 days
//
// A snapshot is { asOf, generatedAt, ratings: {eloKey: overall}, ambiguous: [eloKey],
//                 taLastUpdate, source, players }.
//   asOf       the day WE fetched this report (never TA's printed label). A scrape that returns the
//              SAME report as the last stored one is not a new snapshot (the report did not move), so
//              the older asOf stands and the 7-day age rule sees the true age of the numbers.
//   taLastUpdate  TA's printed "Last update: YYYY-MM-DD" (fetch-elo.js), stored beside asOf. When
//              both sides carry it, it decides whether a report is new; otherwise the ratings do.
//   source     'live' (elo.yml), 'git' (backfilled from elo-ratings.json history) or 'wayback'
//              (tools/backfill-elo-wayback.mjs, asOf = the capture day).
//
// RETRY (founder ruling 2026-09-24): the job runs on Monday. If TA's report has not moved, it
// retries the next day, and daily after that, until a new report is stored; then it stops until
// the next Monday. shouldFetch() is that rule; a day with no new report appends nothing.
//   ambiguous  keys two Tennis Abstract players share (surname + first initial). The scrape keeps
//              one of them, so neither is safe to show. fetch-elo.js records them from 2026-09-24;
//              earlier reports were not stored, so backfilled snapshots carry the collisions
//              measured on the 2026-09-24 report (blanch|d, martin|a) — never fewer.
// Snapshots are never removed and earlier weeks are never rewritten; only a same-day re-scrape
// replaces that day's snapshot. Run from the repo root.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'elo-history.json');
const SRC = path.join(ROOT, 'elo-ratings.json');
const KNOWN_AMBIGUOUS_2026_09_24 = ['blanch|d', 'martin|a'];
// Days since the newest stored report (by asOf) before the job warns / goes red. The red
// threshold is Michael's call and not ruled yet (2026-09-24): null = red is off.
export const ELO_STALE_WARN_DAYS = 8;
export const ELO_STALE_RED_DAYS = null;

const sameRatings = (a, b) => {
  const ka = Object.keys(a || {}), kb = Object.keys(b || {});
  return ka.length === kb.length && ka.every(k => a[k] === b[k]);
};
const load = () => {
  try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return null; }
};
const empty = () => ({
  schema: 'elo-history/1',
  source: 'tennisabstract.com/reports/atp_elo_ratings.html (weekly, via fetch-elo.js)',
  basis: 'overall Elo; a Form row uses the latest snapshot with asOf < match date, if no more than 7 days old',
  snapshots: [],
});
// Is `store` a different report from the last stored snapshot? TA's printed label decides when
// both carry one; a snapshot without a label (git backfill) falls back to comparing the ratings.
export function isNewReport(last, store) {
  if (!last) return true;
  // Only a LATER label is a new report: an older one (a stale cached page) never is.
  if (last.taLastUpdate && store.taLastUpdate) return store.taLastUpdate > last.taLastUpdate;
  return !sameRatings(last.ratings, store.ratings);
}
export function appendSnapshot(hist, store, asOf, source = 'live') {
  const ratings = store && store.ratings;
  if (!ratings || !Object.keys(ratings).length) throw new Error('elo-ratings.json has no ratings');
  const last = hist.snapshots[hist.snapshots.length - 1];
  if (!isNewReport(last, store)) return false;                              // the report did not move
  if (last && asOf < last.asOf) throw new Error(`snapshot ${asOf} is before ${last.asOf}: history is append-only`);
  const amb = Array.isArray(store.ambiguous) ? store.ambiguous : KNOWN_AMBIGUOUS_2026_09_24;
  const snap = { asOf, generatedAt: store.generatedAt || null, ratings, ambiguous: [...new Set(amb)].sort(),
    taLastUpdate: store.taLastUpdate || null, source, players: Object.keys(ratings).length };
  // A new report fetched on the same day as the last stored one (possible only for unlabelled
  // snapshots) replaces that day's snapshot. Earlier days are never touched. A report TA corrects
  // under an unchanged label is NOT a new report (ruling 2026-09-24: the label decides); --append
  // logs a warning and the correction waits for TA's next label.
  if (last && asOf === last.asOf) hist.snapshots[hist.snapshots.length - 1] = snap; else hist.snapshots.push(snap);
  return true;
}
const DAY = 86400000;
const dayNum = (iso) => Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z') / DAY;
const isoOf = (n) => new Date(n * DAY).toISOString().slice(0, 10);
// The Monday on or before `todayISO` (UTC).
export function mondayOnOrBefore(todayISO) {
  const n = dayNum(todayISO), dow = new Date(n * DAY).getUTCDay();
  return isoOf(n - ((dow + 6) % 7));
}
// Fetch today? Always on Monday. On any other day only while no new report has been stored since
// this week's Monday (the Monday run found TA's report unchanged, and every retry since did too).
export function shouldFetch(todayISO, hist) {
  const today = String(todayISO).slice(0, 10), mon = mondayOnOrBefore(today);
  const last = hist && hist.snapshots && hist.snapshots[hist.snapshots.length - 1];
  if (today === mon) return { fetch: true, why: `Monday run (${today})` };
  if (!last || last.asOf < mon) return { fetch: true, why: `retry: no new Tennis Abstract report stored since Monday ${mon} (newest ${last ? last.asOf : 'none'})` };
  return { fetch: false, why: `new report stored ${last.asOf}, on or after Monday ${mon}: retries stopped until next Monday` };
}
// Age of the newest stored report, in days, against the two thresholds.
export function eloStaleness(todayISO, hist, warnDays = ELO_STALE_WARN_DAYS, redDays = ELO_STALE_RED_DAYS) {
  const last = hist && hist.snapshots && hist.snapshots[hist.snapshots.length - 1];
  if (!last) return { level: redDays == null ? 'warn' : 'red', days: null, asOf: null };
  const days = dayNum(todayISO) - dayNum(last.asOf);
  // "Warn at 8 days" (ruling 2026-09-24): 8 days old or more warns.
  const level = redDays != null && days >= redDays ? 'red' : days >= warnDays ? 'warn' : 'ok';
  return { level, days, asOf: last.asOf, taLastUpdate: last.taLastUpdate || null };
}
const write = (hist) => {
  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(hist));
  fs.renameSync(tmp, OUT);
};

const args = process.argv.slice(2);
if (args[0] === '--from-git') {
  const repo = args[1];
  if (!repo) throw new Error('usage: --from-git <repo>');
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { maxBuffer: 1 << 30 }).toString();
  const log = git('log', '--format=%H %cI', 'origin/main', '--', 'elo-ratings.json').trim().split('\n').reverse();
  const hist = empty();
  let added = 0;
  for (const line of log) {
    const [sha, when] = line.split(' ');
    const store = JSON.parse(git('show', `${sha}:elo-ratings.json`));
    if (appendSnapshot(hist, store, new Date(when).toISOString().slice(0, 10), 'git')) added++;
  }
  write(hist);
  console.log(`elo-history: backfilled ${added} distinct snapshots from ${log.length} commits (${hist.snapshots.map(s => s.asOf).join(', ')}).`);
} else if (args[0] === '--append') {
  const store = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const hist = load() || empty();
  const asOf = String(store.generatedAt || new Date().toISOString()).slice(0, 10);
  const last = hist.snapshots[hist.snapshots.length - 1];
  const added = appendSnapshot(hist, store, asOf);
  if (added) write(hist);
  if (!added && last && last.taLastUpdate && last.taLastUpdate === store.taLastUpdate && !sameRatings(last.ratings, store.ratings))
    console.log(`::warning::Tennis Abstract changed ratings under the same label ${store.taLastUpdate}; not a new report, nothing appended.`);
  console.log(added ? `elo-history: appended ${asOf} (TA label ${store.taLastUpdate || 'none'}, ${Object.keys(store.ratings).length} players, ${hist.snapshots.length} snapshots).`
                    : `elo-history: no new report (TA label ${store.taLastUpdate || 'none'}; newest stored ${last.asOf}, label ${last.taLastUpdate || 'none'}); nothing appended.`);
} else if (args[0] === '--should-fetch') {
  const today = args[1] || new Date().toISOString().slice(0, 10);
  const r = shouldFetch(today, load() || empty());
  console.log(`elo: ${r.fetch ? 'fetch' : 'skip'}: ${r.why}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `fetch=${r.fetch}\n`);
} else if (args[0] === '--check-stale') {
  const today = args[1] || new Date().toISOString().slice(0, 10);
  const r = eloStaleness(today, load() || empty());
  const msg = r.asOf == null ? 'Elo history is empty'
    : `newest Tennis Abstract report stored ${r.asOf} (TA label ${r.taLastUpdate || 'none'}), ${r.days} days old`;
  if (r.level === 'red') { console.log(`::error::Elo stale: ${msg} (red at ${ELO_STALE_RED_DAYS})`); process.exit(1); }
  if (r.level === 'warn') console.log(`::warning::Elo stale: ${msg} (warns at ${ELO_STALE_WARN_DAYS}; red is off until ruled)`);
  else console.log(`Elo fresh: ${msg}.`);
} else if (args.length) {
  throw new Error('usage: --append | --from-git <repo> | --should-fetch [day] | --check-stale [day]');
}
