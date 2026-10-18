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
import { readFileSync, existsSync, writeFileSync, renameSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

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

// ---- the override (founder ruling 2026-10-18): a legitimate drop (a dedupe, a junior removal) is approved ahead of time,
// never by a hand edit. `node tools/archive-gate.mjs accept --key masterRows --expect 58000 --reason "…"` appends an entry
// to archive-gate-accept.json — key, expected count, reason, who, when, and a check over them — and the file is committed
// with the change that causes the drop (a reviewed code change, never a data-bot file). The gate takes an entry only when:
// its check matches (an edited number or reason is refused), the file is tracked in git (a file dropped on the runner by
// hand is refused), and this run's count is at or above the expected one. Every entry used is logged (the log, the step
// summary and the published counts file). An entry whose drop is already published (the last good count ≤ expected) is
// said to be no longer needed.
export const ACCEPT_FILE = 'archive-gate-accept.json';
export const entryCheck = e => createHash('sha256').update([e.key, e.expect, e.reason, e.by, e.at].join('|')).digest('hex').slice(0, 16);
export function readAccept(dir) {
  const p = join(dir, ACCEPT_FILE);
  if (!existsSync(p)) return { entries: [], errors: [] };
  let j; try { j = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { return { entries: [], errors: [`${ACCEPT_FILE} is not valid JSON — no override taken`] }; }
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', ACCEPT_FILE], { cwd: dir, encoding: 'utf8' }).status === 0;
  if (!tracked) return { entries: [], errors: [`${ACCEPT_FILE} is not committed — an override is a reviewed code change, never a file put on the runner; refused`] };
  const errors = [], entries = [];
  for (const e of Array.isArray(j.entries) ? j.entries : []) {
    if (!e || !COUNT_KEYS.includes(e.key) || !Number.isInteger(e.expect) || !e.reason || !e.by || !e.at) { errors.push(`${ACCEPT_FILE}: an entry lacks key / expect / reason / by / at — refused`); continue; }
    if (e.check !== entryCheck(e)) { errors.push(`${ACCEPT_FILE}: the ${e.key} entry was edited by hand (its check does not match) — refused; write overrides with "archive-gate.mjs accept"`); continue; }
    entries.push(e);
  }
  if (!Array.isArray(j.entries)) errors.push(`${ACCEPT_FILE} has no entries list (the old hand-written form is not accepted) — refused`);
  return { entries, errors };
}
export function applyAccept(floor, entries, log = () => {}) {
  const used = [];
  if (!floor) return used;
  for (const e of entries) {
    if (!(floor[e.key] > e.expect)) { log(`::notice::archive-gate: the ${e.key} override (expect ${e.expect}, "${e.reason}") is no longer needed — the last good count is ${floor[e.key]}`); continue; }
    log(`::notice::archive-gate: ${e.key} floor lowered ${floor[e.key]} → ${e.expect} by an approved override ("${e.reason}", ${e.by}, ${e.at})`);
    used.push({ key: e.key, from: floor[e.key], to: e.expect, reason: e.reason, by: e.by, at: e.at });
    floor[e.key] = e.expect;
  }
  return used;
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

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === 'accept') {
  const dir = resolve(arg('--dir', '.')), key = arg('--key', ''), expect = Number(arg('--expect', 'NaN')), reason = String(arg('--reason', '') || '').trim();
  if (!COUNT_KEYS.includes(key) || !Number.isInteger(expect) || expect < 0 || !reason) {
    console.error(`usage: archive-gate.mjs accept --key ${COUNT_KEYS.join('|')} --expect N --reason "why the count drops"`); process.exit(2);
  }
  const by = (spawnSync('git', ['config', 'user.name'], { cwd: dir, encoding: 'utf8' }).stdout || '').trim() || process.env.USER || 'unknown';
  const p = join(dir, ACCEPT_FILE);
  const j = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { note: 'Approved archive-gate drops (founder ruling 2026-10-18). Written by "node tools/archive-gate.mjs accept"; a hand edit is refused.', entries: [] };
  const e = { key, expect, reason, by, at: new Date().toISOString() };
  e.check = entryCheck(e);
  j.entries = (Array.isArray(j.entries) ? j.entries : []).filter(x => x.key !== key).concat(e);
  writeFileSync(p + '.tmp', JSON.stringify(j, null, 1) + '\n'); renameSync(p + '.tmp', p);
  console.log(`archive-gate: override written — ${key} may drop to ${expect} ("${reason}"). Commit ${ACCEPT_FILE} with the change that causes the drop.`);
  process.exit(0);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = resolve(arg('--dir', '.')), out = arg('--out', join(dir, 'database-yield-master-meta.json'));
  const cur = currentCounts(dir), base = await readBaseline();
  // a deliberate reduction lands as an approved override (archive-gate-accept.json, written by `archive-gate.mjs accept`)
  const acc = readAccept(dir);
  const floor = base.status === 'ok' ? Object.assign({}, base.counts) : null;
  const used = applyAccept(floor, acc.entries, console.log);
  const errors = acc.errors.concat(check(cur, floor));
  if (used.length && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, used.map(u => `- archive gate override: ${u.key} ${u.from} → ${u.to} — ${u.reason} (${u.by}, ${u.at})\n`).join(''));
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
  writeFileSync(tmp, JSON.stringify({ builtAt: new Date().toISOString(), counts: cur, overrides: used }));
  renameSync(tmp, out);
  console.log('archive-gate: OK — every archive count present and at or above the last good run');
}
