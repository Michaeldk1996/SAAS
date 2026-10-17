#!/usr/bin/env node
// Founder ruling 2026-10-17 (odds master close-out, item 3): nothing empty or partial publishes. When the protected
// archive is unreachable, or answers short, the run FAILS: no site-data is uploaded, so the site keeps the last good master
// and pre-2010 file (publish.yml lays the newest SUCCESSFUL run's data), and a Telegram alert goes out (pipeline.yml's
// failure step reads the marker this writes). No tolerant step, no silent fallback.
//
// Checks, after build-database-yield.js (each one fails the run):
//   1. the archive's exports are there and not empty — pinnacle-closes.json (rows > 0), the Database feed
//      pinnacle-archive-td.csv (rows > 0), the snapshot feed pinnacle-approx.csv (rows > 0) — and the master and the era
//      shard were written;
//   2. no count is below the last good run's (the published database-yield-master-meta.json: master rows, export events,
//      feed rows, snapshot rows, era-shard rows). A 404 there is the first run that publishes it (said out loud, no
//      comparison); any other failure to read it fails the run (a check that cannot compare is not a pass).
// Writes database-yield-master-meta.json (this run's counts) for the site.
// Usage: node tools/archive-gate.mjs [--dir .] [--baseline-url URL | --baseline-file PATH] [--out database-yield-master-meta.json]
import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
export const COUNT_KEYS = ['masterRows', 'exportEvents', 'feedRows', 'approxRows', 'xRows'];

// this run's counts from the files in `dir`; a missing or unreadable file counts as null
export function currentCounts(dir) {
  const json = f => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch (e) { return null; } };
  const csvRows = f => { try { return readFileSync(join(dir, f), 'utf8').split(/\r?\n/).filter(Boolean).length - 1; } catch (e) { return null; } };
  const ex = json('pinnacle-closes.json'), ma = json('database-yield-master.json'), x = json('database-yield-x.json');
  return {
    masterRows: ma && Array.isArray(ma.rows) ? ma.rows.length : null,
    exportEvents: ex && Array.isArray(ex.rows) ? ex.rows.length : null,
    feedRows: existsSync(join(dir, 'pinnacle-archive-td.csv')) ? csvRows('pinnacle-archive-td.csv') : null,
    approxRows: existsSync(join(dir, 'pinnacle-approx.csv')) ? csvRows('pinnacle-approx.csv') : null,
    xRows: x && Array.isArray(x.xRows) ? x.xRows.length : null,
  };
}

// errors (empty = pass). `baseline` = the last good counts, or null on the first publish (status 'bootstrap').
export function check(cur, baseline) {
  const errors = [];
  for (const k of COUNT_KEYS) if (!(cur[k] > 0)) errors.push(`${k}: ${cur[k] == null ? 'missing' : cur[k]} — the archive was unreachable or answered empty`);
  if (baseline) for (const k of COUNT_KEYS) {
    if (baseline[k] > 0 && cur[k] != null && cur[k] < baseline[k]) errors.push(`${k}: ${cur[k]} < ${baseline[k]} in the last good run — the archive answered short`);
  }
  return errors;
}

async function readBaseline() {
  const file = arg('--baseline-file', null), url = arg('--baseline-url', null);
  if (file) return existsSync(file) ? { status: 'ok', counts: JSON.parse(readFileSync(file, 'utf8')).counts } : { status: 'bootstrap' };
  if (!url) return { status: 'error', why: 'no --baseline-url or --baseline-file given' };
  let last = '';
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { signal: AbortSignal.timeout(15000) });
      if (r.status === 404) return { status: 'bootstrap' };
      if (!r.ok) { last = `HTTP ${r.status}`; continue; }
      const j = await r.json();
      if (!j || !j.counts) return { status: 'error', why: 'the published counts file has no counts' };
      return { status: 'ok', counts: j.counts };
    } catch (e) { last = String(e && e.message || e); }
    await new Promise(res => setTimeout(res, 3000));
  }
  return { status: 'error', why: `the last good counts could not be read (${last})` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = resolve(arg('--dir', '.')), out = arg('--out', join(dir, 'database-yield-master-meta.json'));
  const cur = currentCounts(dir), base = await readBaseline();
  // a deliberate reduction (a founder ruling that holds rows back) lands as a reviewed code change: archive-gate-accept.json
  // { "masterRows": { "atMost": N, "reason": "…" } } lowers that key's floor to N for runs whose count is N or more. Never a
  // data-bot file; without it no drop is accepted.
  const accept = (() => { try { return JSON.parse(readFileSync(join(dir, 'archive-gate-accept.json'), 'utf8')); } catch (e) { return {}; } })();
  const floor = base.status === 'ok' ? Object.assign({}, base.counts) : null;
  if (floor) for (const [k, v] of Object.entries(accept)) if (v && Number.isFinite(v.atMost) && floor[k] > v.atMost) {
    console.log(`::notice::archive-gate: ${k} floor lowered ${floor[k]} → ${v.atMost} (archive-gate-accept.json: ${v.reason || 'no reason given'})`);
    floor[k] = v.atMost;
  }
  const errors = check(cur, floor);
  if (base.status === 'error') errors.push(base.why);
  console.log(`### archive-gate ${JSON.stringify({ current: cur, baseline: base.status === 'ok' ? base.counts : base.status })}`);
  if (base.status === 'bootstrap') console.log('::notice::archive-gate: no published counts yet (the first run that publishes them) — emptiness checked, no comparison');
  if (errors.length) {
    for (const e of errors) console.log(`::error title=Pinnacle archive gate::${e}`);
    writeFileSync(join(dir, '.archive-failed'), errors.join('\n') + '\n');
    console.error(`archive-gate: FAILED — nothing from this run publishes; the site keeps the last good data (${errors.length} problem(s))`);
    process.exit(1);
  }
  const tmp = out + '.tmp';
  writeFileSync(tmp, JSON.stringify({ builtAt: new Date().toISOString(), counts: cur }));
  renameSync(tmp, out);
  console.log('archive-gate: OK — every archive count present and at or above the last good run');
}
