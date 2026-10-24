#!/usr/bin/env node
'use strict';
// Defect brief 2026-10-24 item 5 — the feed's qualifying flag for the box-score archive weeks written before
// tier-page-sweep.js stored it.
//
// boxscore-archive/ is write-once (see tools/tier-page-sweep.js), so its ATP files are NOT rewritten. This tool asks the
// same tier page again (`get_fixtures&date_start&date_stop&event_type_key=265`, one request per archived ATP week) and
// keeps only each fixture's `event_qualification`, for the event keys that week's archive file holds. Output:
// boxscore-qualifying.json — { weeks: { "<file>": n }, q: { "<event_key>": 1 | 0 } } (1 = qualifying). build-event-hold.js
// reads `q` for an entry that carries no `q` of its own. A key the feed no longer answers for stays out of `q` (unknown).
//
// Re-runnable: a week already listed in `weeks` is never asked again. Written atomically (temp file + rename).
//
// Usage: node tools/backfill-qualifying-flags.js [--max-requests=200] [--dir=boxscore-archive] [--out=boxscore-qualifying.json]
const fs = require('fs');
const path = require('path');
try { require('dotenv').config({ quiet: true }); } catch (_) { /* dotenv optional */ }
const ROOT = path.join(__dirname, '..');
const sweep = require('./tier-page-sweep.js');

const ATP = 265;
const PACE_MS = 300;

function readOut(file) {
  try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (d && d.weeks && d.q) return d; } catch (_) { /* fresh */ }
  return { v: 1, source: 'api-tennis get_fixtures event_qualification, ATP tier (265)', weeks: {}, q: {} };
}

// One archived week's flags: the archive's own keys only; a fixture's flag "True" → 1, "False" → 0, anything else unknown.
function flagsForWeek(archiveKeys, fixtures) {
  const want = new Set(archiveKeys.map(String)), out = {};
  for (const f of fixtures) {
    const k = String(f.event_key);
    if (!want.has(k)) continue;
    if (f.event_qualification === 'True') out[k] = 1;
    else if (f.event_qualification === 'False') out[k] = 0;
  }
  return out;
}

async function main() {
  const arg = (n, d) => { const h = process.argv.find(a => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
  const dir = path.resolve(ROOT, arg('dir', 'boxscore-archive'));
  const outFile = path.resolve(ROOT, arg('out', 'boxscore-qualifying.json'));
  const maxRequests = Number(arg('max-requests', '200'));
  const key = process.env.API_TENNIS_KEY;
  if (!key) { console.error('qualifying-backfill: API_TENNIS_KEY not set.'); process.exit(1); }
  const out = readOut(outFile);
  const files = sweep.listWeeks(dir).filter(f => f.startsWith(`${ATP}-`) && !(f in out.weeks));
  console.log(`qualifying-backfill: ${files.length} ATP archive week(s) to ask (budget ${maxRequests}).`);
  let requests = 0, failed = 0;
  for (const f of files) {
    if (requests >= maxRequests) { console.log('qualifying-backfill: budget reached — rerun for the rest.'); break; }
    const start = f.match(sweep.FILE_RE)[2];
    const stop = new Date(Date.parse(`${start}T00:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10);
    const keys = Object.keys(sweep.readWeek(path.join(dir, f)));
    requests++;
    let fixtures;
    try { fixtures = await sweep.fetchPage(key, ATP, { start, stop }); }
    catch (e) { failed++; console.error(`qualifying-backfill ${f} FAILED — ${e.message}`); continue; }
    finally { await new Promise(r => setTimeout(r, PACE_MS)); }
    const flags = flagsForWeek(keys, fixtures);
    Object.assign(out.q, flags);
    out.weeks[f] = Object.keys(flags).length;
    const nq = Object.values(flags).filter(x => x === 1).length;
    console.log(`qualifying-backfill ${f}  archived=${String(keys.length).padStart(4)}  flagged=${String(Object.keys(flags).length).padStart(4)}  qualifying=${String(nq).padStart(4)}`);
    const tmp = `${outFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, outFile);
  }
  console.log(`qualifying-backfill: ${requests} request(s), ${failed} failed; ${Object.keys(out.q).length} keys flagged over ${Object.keys(out.weeks).length} weeks.`);
}

module.exports = { flagsForWeek, readOut };
if (require.main === module) main().catch(e => { console.error('qualifying-backfill: unexpected error —', e); process.exit(1); });
