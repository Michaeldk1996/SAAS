#!/usr/bin/env node
// Founder ruling 2026-10-18 ("one match problem must never stop the site from updating"): the publish run's price check,
// end to end. One player's spelling change once blocked every publish for 6 hours; now:
//   1. tools/price-consistency.mjs runs over the built site with --quarantine-out: every match a page prices while the
//      master's join does not hold it — or prices differently — is written to price-quarantine.json, and the run goes on;
//   2. that match becomes a dash on EVERY page: build-market-edge.js is re-run with the quarantine (its master row leaves
//      every Market edge shard) and the shards are copied into the site; the page reads _site/price-quarantine.json, and
//      the join prices no quarantined Database row (h2hPriceJoin);
//   3. the check runs again on the site as it will publish (the confirm pass); a match a page still prices is named in
//      the alert as NOT cleared — the run still publishes;
//   4. one Telegram message for the whole run (written to --alert-out, sent by pipeline.yml after the upload): which
//      match, which page tripped, the likely cause. No message when nothing was quarantined.
// Next run, a match that joins cleanly is not quarantined, so it comes back by itself — no manual step.
// Only a check that could not run (no player to check, Market edge lagging the master, a page function that threw)
// exits non-zero: the archive gate (tools/archive-gate.mjs) is the one data gate that stops a publish.
// Usage: node tools/price-guard-run.mjs --site _site [--root .] [--alert-out .price-alert.txt] [--run-label "run 8175"]
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, cpSync, copyFileSync, renameSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SITE = resolve(arg('--site', '_site')), ROOT = resolve(arg('--root', '.'));
const ALERT = resolve(arg('--alert-out', join(ROOT, '.price-alert.txt'))), LABEL = arg('--run-label', '');
const GUARD = join(HERE, 'price-consistency.mjs'), BUILDER = arg('--builder', join(ROOT, 'build-market-edge.js'));
const extra = (arg('--guard-args', '') || '').split(' ').filter(Boolean);

function guard(qout) {
  const r = spawnSync(process.execPath, [GUARD, '--site', SITE, '--quarantine-out', qout, ...extra], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
  if (r.status !== 0) { console.error(`price-guard-run: the price check could not run (exit ${r.status}) — failing closed`); process.exit(r.status || 1); }
  return JSON.parse(readFileSync(qout, 'utf8'));
}
const writeAtomic = (p, s) => { writeFileSync(p + '.tmp', s); renameSync(p + '.tmp', p); };
const surname = n => String(n || '').replace(/^([A-Za-z]{1,3}\.\s*)+/, '').trim();
const title = e => `${surname(e.player)} v ${surname(e.opp)}, ${e.event || 'unknown event'} ${String(e.date || '').slice(0, 4)}`;
const what = e => e.kind === 'not held' ? `${e.pages.join(', ')} priced it, the master didn't` : `${e.pages.join(', ')} showed ${e.shown || 'a price'}, the master another`;

const q1Path = join(ROOT, 'price-quarantine.json');
const q1 = guard(q1Path);
const entries = q1.entries || [];
// the site always carries the file (an empty quarantine is a quarantine of nothing), so the page never reads a stale one
copyFileSync(q1Path, join(SITE, 'price-quarantine.json'));
if (!entries.length) {
  if (existsSync(ALERT)) writeAtomic(ALERT, '');
  console.log('price-guard-run: every match shows one price on every page — nothing quarantined, no alert');
  process.exit(0);
}

// 2 · the dash: Market edge rebuilt without the quarantined matches, copied into the site as it will publish
const b = spawnSync(process.execPath, [BUILDER, '--quiet'], { cwd: dirname(BUILDER), encoding: 'utf8', env: Object.assign({}, process.env, { PRICE_QUARANTINE: q1Path }) });
process.stdout.write(b.stdout || ''); process.stderr.write(b.stderr || '');
const rebuilt = b.status === 0;
if (rebuilt) {
  cpSync(join(dirname(BUILDER), 'market-edge'), join(SITE, 'market-edge'), { recursive: true });
  copyFileSync(join(dirname(BUILDER), 'market-edge-index.json'), join(SITE, 'market-edge-index.json'));
} else console.log(`::error::price-guard-run: build-market-edge.js exited ${b.status} — Market edge could not be rebuilt without the quarantined matches`);

// 3 · the confirm pass on the site as it will publish
const q2 = guard(join(ROOT, 'price-quarantine.confirm.json'));
const left = new Set((q2.entries || []).map(e => e.date + '|' + e.player + '|' + e.opp));

// 4 · one message for the run
const lines = entries.map(e => `• ${title(e)}: ${what(e)}. Likely cause: ${e.cause}.${left.has(e.date + '|' + e.player + '|' + e.opp) ? ' NOT CLEARED: a page still prices it after the dash.' : ''}`);
for (const e of q2.entries || []) if (!entries.some(x => x.date === e.date && x.player === e.player && x.opp === e.opp))
  lines.push(`• ${title(e)}: ${what(e)} (seen only after the dash). Likely cause: ${e.cause}. NOT CLEARED.`);
const msg = [`Stennisfy price check${LABEL ? ' · ' + LABEL : ''}: ${entries.length} match${entries.length === 1 ? '' : 'es'} dashed on every page; the site published.`,
  ...lines, rebuilt ? 'Each comes back by itself once it joins cleanly.' : 'Market edge could NOT be rebuilt: it may still price these matches.'].join('\n');
writeAtomic(ALERT, msg + '\n');
console.log('### price-quarantine ' + JSON.stringify({ quarantined: entries.length, notCleared: (q2.entries || []).length, rebuilt }));
console.log(msg);
for (const e of q2.entries || []) console.log(`::error title=Price check::not cleared after the dash: ${title(e)} — ${what(e)}`);
process.exit(0);
