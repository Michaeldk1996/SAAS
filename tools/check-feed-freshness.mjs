#!/usr/bin/env node
// tools/check-feed-freshness.mjs — ruling 1 (founder 2026-10-20). Feeds that can ONLY be built on the Mac fail this check
// visibly when their output stops updating; the site shows "Data paused" for them by the SAME rule (sfFeedPaused).
//   career-splits — Tennis Abstract's player-classic.cgi answers GitHub's runners 403 (probe run 39449494331, 2026-10-20;
//   160 of 160 on 2026-07-17), so it stays a Mac job; the Mac's GitHub token expires 2026-10-25 02:15Z.
// Usage: node tools/check-feed-freshness.mjs [--now ISO] [--root DIR]
import fs from 'node:fs';
import path from 'node:path';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const ROOT = arg('--root') || process.cwd();
const NOW = arg('--now') ? new Date(arg('--now')) : new Date();
export const PAUSE_DAYS = 2;   // = SF_FEED_PAUSE_DAYS on the page: a daily build, one missed run + margin
export function careerSplitsAge(tour, now) {
  const f = tour && tour.fetchedAt;
  if (!f || !/^\d{8}$/.test(String(f))) return null;
  const at = Date.UTC(+String(f).slice(0, 4), +String(f).slice(4, 6) - 1, +String(f).slice(6, 8));
  return { asOf: new Date(at).toISOString().slice(0, 10), ageDays: Math.floor((now.getTime() - at) / 86400000) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const file = path.join(ROOT, 'career-splits-tour.json');
  if (!fs.existsSync(file)) { console.log('::error title=Feed freshness::career-splits-tour.json missing'); process.exit(1); }
  const a = careerSplitsAge(JSON.parse(fs.readFileSync(file, 'utf8')), NOW);
  if (!a) { console.log('::error title=Feed freshness::career-splits-tour.json has no build date (fetchedAt) — cannot tell if it is current'); process.exit(1); }
  console.log(`career-splits: last built ${a.asOf} (${a.ageDays} day(s) ago; paused at >= ${PAUSE_DAYS})`);
  if (a.ageDays >= PAUSE_DAYS) {
    console.log(`::error title=Feed freshness::career-splits stopped updating — last built ${a.asOf}, ${a.ageDays} days ago. It can only be built on the Mac (Tennis Abstract blocks GitHub's servers); the site shows "Data paused" for it.`);
    process.exit(1);
  }
  console.log('ok: career-splits is current');
}
