#!/usr/bin/env node
/**
 * ten206-hybrid-server.mjs — serve the BRANCH's code against the DEPLOYED data.
 *
 * WHY THIS EXISTS
 * ---------------
 * The §8 Court speed read-back was verified against a local checkout and reported
 * Zverev at 605 banded + 60 unbanded = 665. The founder pushed back: his career
 * spine is 775 on the live Calendar and Streaks cards. Both numbers were right.
 * `career-history/` is GITIGNORED — it is a pipeline artifact, never committed —
 * and this machine's copy is a truncated older build:
 *
 *     key    local   deployed
 *     1980     665        775
 *     1775     258        361
 *      370     273        405
 *
 * So the probe, the recompute AND the browser all read the same short store and
 * agreed with each other perfectly. Three mutually-confirming reads of the wrong
 * data. banded + unbanded = spine held exactly; it just held at 665.
 *
 * A local static server cannot catch that, because the failure is not in the code
 * it serves — it is in the data sitting next to it. So this server splits the two
 * by ORIGIN and makes the split structural:
 *
 *   CODE  (.html/.js/.css/.mjs)   -> the worktree. This is the diff under test.
 *   DATA IN THE DIFF              -> the worktree. Also the diff under test: this
 *                                   branch rewrites court-speed-map.json and the
 *                                   DEPLOYED copy is the previous schema (no
 *                                   `venues`, no `apiNames`, 18.5 KB vs 30.4 KB).
 *                                   Serving the live one would silently test the
 *                                   new renderer against the old dictionary and
 *                                   band nothing. The list is computed from
 *                                   `git diff --name-only <base>...HEAD`, so it
 *                                   cannot drift out of date by hand.
 *   DATA NOT IN THE DIFF          -> the DEPLOYED site, always. Local is the
 *                                   fallback only where live 404s.
 *
 * Every local data fallback is logged and counted. If a file you expected to come
 * from the deployed site appears in that list, the read is not trustworthy and the
 * summary line says so.
 *
 * Usage: node ten206-hybrid-server.mjs [port]
 *   PORT default 8732, LIVE default https://michaeldk1996.github.io/SAAS
 *   DIFF_BASE default origin/main
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8732);
const LIVE = (process.env.LIVE_BASE || 'https://michaeldk1996.github.io/SAAS').replace(/\/$/, '');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.csv': 'text/csv', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};
/** The diff under test. Served from the worktree, never from the deployed site. */
const CODE_EXT = new Set(['.html', '.js', '.mjs', '.css']);

/**
 * Data files this branch changed. Derived, not hand-listed — a hand-listed set is
 * exactly what goes stale and reintroduces the bug this server exists to prevent.
 */
const DIFF_BASE = process.env.DIFF_BASE || 'origin/main';
const diffData = new Set();
try {
  const base = execFileSync('git', ['merge-base', DIFF_BASE, 'HEAD'], { cwd: ROOT }).toString().trim();
  const names = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: ROOT })
    .toString().split('\n').map((s) => s.trim()).filter(Boolean);
  for (const n of names) if (!CODE_EXT.has(path.extname(n).toLowerCase())) diffData.add(n);
} catch (err) {
  console.warn(`[hybrid] WARNING: could not read the diff against ${DIFF_BASE} (${err.message}). `
    + 'Every data file will be served from the deployed site, so a data file this branch '
    + 'changed will be read in its OLD form. Do not trust a read taken in this state.');
}

const localFallbacks = new Map();   // path -> hits (live 404'd, worktree answered)
const diffServed = new Map();       // path -> hits (data file in the diff)
const liveHits = new Map();         // path -> hits
const misses = new Set();
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

function sendLocal(res, rel) {
  const full = path.join(ROOT, rel);
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return false;
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store',
  });
  res.end(fs.readFileSync(full));
  return true;
}

const server = http.createServer(async (req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  if (!rel) rel = 'bsp-consult-dashboard.html';
  const ext = path.extname(rel).toLowerCase();

  if (CODE_EXT.has(ext)) {
    if (sendLocal(res, rel)) return;
    // A code file absent from the worktree is a real 404, not a reason to reach
    // for the deployed copy — serving the live .js would silently test main.
    misses.add(rel);
    res.writeHead(404); res.end('not found (code, local only)');
    return;
  }

  if (diffData.has(rel)) {
    if (sendLocal(res, rel)) { bump(diffServed, rel); return; }
    misses.add(rel);
    res.writeHead(404); res.end('not found (data in diff, local only)');
    return;
  }

  try {
    const r = await fetch(`${LIVE}/${rel}`, { headers: { 'Cache-Control': 'no-cache' } });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      bump(liveHits, rel);
      res.writeHead(200, {
        'Content-Type': r.headers.get('content-type') || MIME[ext] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store',
      });
      res.end(buf);
      return;
    }
  } catch (err) { /* fall through to local */ }

  if (sendLocal(res, rel)) { bump(localFallbacks, rel); return; }
  misses.add(rel);
  res.writeHead(404); res.end('not found');
});

process.on('SIGTERM', () => report());
process.on('SIGINT', () => { report(); process.exit(0); });
function report() {
  const fb = [...localFallbacks.entries()].sort((a, b) => b[1] - a[1]);
  const df = [...diffServed.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\n[hybrid] live data reads: ${[...liveHits.values()].reduce((a, b) => a + b, 0)} `
    + `over ${liveHits.size} path(s)`);
  console.log(`[hybrid] data-in-diff served from worktree: ${df.length} path(s)`
    + (df.length ? ' — ' + df.map(([k, v]) => `${k}×${v}`).join(', ') : ' — none'));
  console.log(`[hybrid] LOCAL DATA FALLBACKS: ${fb.length} path(s)`
    + (fb.length ? ' — ' + fb.map(([k, v]) => `${k}×${v}`).join(', ') : ' — none'));
  if (misses.size) console.log(`[hybrid] 404s: ${[...misses].join(', ')}`);
  try { server.close(); } catch { /* already closing */ }
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[hybrid] code=${ROOT}`);
  console.log(`[hybrid] data=${LIVE}  (local fallback only on a live 404)`);
  console.log(`[hybrid] http://127.0.0.1:${PORT}/bsp-consult-dashboard.html`);
});
