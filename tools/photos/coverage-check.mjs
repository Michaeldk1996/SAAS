#!/usr/bin/env node
// Stored-photo coverage alert (founder 2026-10-24; same style as the quote-count alert): when the share of aliased
// players with a stored photo DROPS versus the published site, print a GitHub ::warning:: annotation. Never blocks:
// always exits 0. Run by pipeline.yml before the site is published.
//   node tools/photos/coverage-check.mjs [--index player-photos/index.json] [--prev <url or path>]
import fs from 'node:fs';
import { coverageDropped } from './photo-index.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const INDEX = arg('index', 'player-photos/index.json');
const PREV = arg('prev', 'https://michaeldk1996.github.io/SAAS/player-photos/index.json');
const read = async (src) => {
  if (/^https?:/.test(src)) { const r = await fetch(src + (src.includes('?') ? '&' : '?') + 'cb=' + Date.now(), { signal: AbortSignal.timeout(20000) }); return r.ok ? r.json() : null; }
  return JSON.parse(fs.readFileSync(src, 'utf8'));
};
try {
  const next = await read(INDEX);
  let prev = null; try { prev = await read(PREV); } catch { prev = null; }
  const n = next && next.coverage, p = prev && prev.coverage;
  console.log(`player photos: ${n ? n.stored : 0} of ${n ? n.aliases : 0} aliased players have a stored photo` +
    (p ? ` (published: ${p.stored} of ${p.aliases})` : ' (no published index to compare)'));
  if (!n || !n.aliases || !n.stored) console.log('::warning::player photos: NO STORED PHOTOS — every avatar will show initials');
  else if (coverageDropped(p, n)) console.log(`::warning::player photos: STORED-PHOTO COVERAGE DROPPED ${p.stored}/${p.aliases} -> ${n.stored}/${n.aliases} versus the published site — see the Mac photo refresh log (~/.bsp-photos-cron)`);
} catch (e) {
  console.log(`::warning::player photos: coverage check could not read the index (${String(e.message || e).slice(0, 120)})`);
}
process.exit(0);
