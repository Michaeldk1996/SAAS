#!/usr/bin/env node
// TEN-263 (founder ruling 2026-09-24, D-12): the Form rows' opponent Elo badge, "Opposition Elo"
// and "Elo change" use OVERALL Elo AT THE MATCH DATE: the latest weekly Tennis Abstract snapshot
// dated on or before the match, and only if it is no more than 7 days old. elo-ratings.json holds
// the latest snapshot only, so this keeps the dated history: elo-history.json, append-only.
//
//   node tools/build-elo-history.mjs --append           append elo-ratings.json if its ratings changed
//   node tools/build-elo-history.mjs --from-git <repo>  one-time backfill from <repo>'s git history
//
// A snapshot is { asOf, generatedAt, ratings: {eloKey: overall}, ambiguous: [eloKey] }.
//   asOf       the day these ratings were first published to us. A weekly scrape that returns the
//              SAME ratings as the week before is not a new snapshot (the report did not move), so
//              the older asOf stands and the 7-day age rule sees the true age of the numbers.
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
  basis: 'overall Elo; a Form row uses the latest snapshot with asOf <= match date, if no more than 7 days old',
  snapshots: [],
});
export function appendSnapshot(hist, store, asOf) {
  const ratings = store && store.ratings;
  if (!ratings || !Object.keys(ratings).length) throw new Error('elo-ratings.json has no ratings');
  const last = hist.snapshots[hist.snapshots.length - 1];
  if (last && sameRatings(last.ratings, ratings)) return false;            // the report did not move
  if (last && asOf < last.asOf) throw new Error(`snapshot ${asOf} is before ${last.asOf}: history is append-only`);
  const amb = Array.isArray(store.ambiguous) ? store.ambiguous : KNOWN_AMBIGUOUS_2026_09_24;
  const snap = { asOf, generatedAt: store.generatedAt || null, ratings, ambiguous: [...new Set(amb)].sort() };
  // A same-day re-scrape (e.g. a manual dispatch after a partial Monday report) replaces that day's
  // snapshot: it is the same week's report, corrected. Earlier weeks are never touched.
  if (last && asOf === last.asOf) hist.snapshots[hist.snapshots.length - 1] = snap; else hist.snapshots.push(snap);
  return true;
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
    if (appendSnapshot(hist, store, new Date(when).toISOString().slice(0, 10))) added++;
  }
  write(hist);
  console.log(`elo-history: backfilled ${added} distinct snapshots from ${log.length} commits (${hist.snapshots.map(s => s.asOf).join(', ')}).`);
} else if (args[0] === '--append') {
  const store = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const hist = load() || empty();
  const asOf = String(store.generatedAt || new Date().toISOString()).slice(0, 10);
  const added = appendSnapshot(hist, store, asOf);
  if (added) write(hist);
  console.log(added ? `elo-history: appended ${asOf} (${Object.keys(store.ratings).length} players, ${hist.snapshots.length} snapshots).`
                    : `elo-history: ratings unchanged since ${hist.snapshots[hist.snapshots.length - 1].asOf}; nothing appended.`);
} else if (args.length) {
  throw new Error('usage: --append | --from-git <repo>');
}
