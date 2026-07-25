'use strict';

/**
 * build-admin-log.js — append-only performance ledger for the admin dashboard
 * (TEN-27 Sections 2-4). Runs as a PIPELINE-END STEP (Option B) after
 * run-pipeline.js has rebuilt matches.json + model-output.json in the workspace.
 *
 * WHY PIPELINE-END (not a separate cron):
 *   - It reads the EXACT freshly-built local artifacts of this run
 *     (model-output.json for the priced set, matches.json for the frozen
 *     valueSnapshot + resolution), so it never depends on Pages having
 *     propagated and never races a second writer — one append per pipeline run.
 *   - It fires every pipeline run (~15 min), so a short-lived State-2 window is
 *     far less likely to be missed than the old 3-hourly capture.
 *
 * WHAT IT LOGS (Decision 2: ALL priced matches, not only value-flagged):
 *   Every match the model priced (model-output.json entry with ok===true) gets
 *   a row in admin-log.json `flags{}`, keyed by the stable event key (the id with
 *   its upcoming-/past-/finished- prefix stripped, so the row survives the
 *   status flip on completion). Value-flagged or not, it is logged — the full
 *   dataset for CLV analysis; the dashboard filters to flagged rows in its view.
 *
 * FREEZE SEMANTICS:
 *   - valueSnapshot (the model's State-2 entry edge, from matches.json) is
 *     written ONCE, the first run it is seen, and never overwritten.
 *   - modelFairEntry / model fair at first pricing is likewise frozen once.
 *   - status, finalScore, modelFairLast and lastSeen refresh every run as the
 *     match goes upcoming -> live -> finished, so a resolved row carries entry
 *     edge + last (closing) fair + final result for ROI/CLV.
 *
 * The pipeline commits admin-log.json back to main with [skip ci] (so it does
 * not re-trigger a deploy) and copies it into _site for the dashboard to fetch.
 *
 * NON-FATAL: any error exits 0 so a logging hiccup never blocks the Pages deploy
 * (invoked as `node build-admin-log.js || true`).
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const FILE = path.join(ROOT, 'admin-log.json');
const RUN = process.env.GITHUB_RUN_ID || process.env.RUN_ID || 'local';
const MAX_RUNS = 2000;

function readJson(p) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
}

// Stable event key: strip the status prefix so the row is the SAME row before
// and after the match finishes (upcoming-123 and past-123 -> "123").
function eventKey(id) {
  return String(id || '').replace(/^(upcoming|past|finished|live)-/, '') || String(id || '');
}

function statusOf(m) {
  if (!m) return 'unknown';
  if (m.finalScore) return 'finished';
  if (m.interrupted) return 'interrupted';
  if (m.live || m.liveStatus) return 'live';
  return 'upcoming';
}
function scoreOf(m) {
  if (!m) return null;
  const s = m.finalScore || m.partialScore || null;
  if (!s) return m.result || null;
  return (typeof s === 'object' ? s.display : s) || m.result || null;
}

function main() {
  let modelOut, matchesRaw;
  try {
    modelOut = readJson('model-output.json');
  } catch (e) {
    console.error(`admin-log: model-output.json unreadable (${e.message}) — nothing to log.`);
    return;
  }
  try {
    matchesRaw = readJson('matches.json');
  } catch (e) {
    console.error(`admin-log: matches.json unreadable (${e.message}) — nothing to log.`);
    return;
  }

  const priced = (modelOut && modelOut.matches) || {};
  const matchesArr = Array.isArray(matchesRaw) ? matchesRaw : (matchesRaw.matches || Object.values(matchesRaw));

  // Index the live board by stable event key for status/score + valueSnapshot.
  const boardByKey = {};
  for (const m of matchesArr) boardByKey[eventKey(m.id)] = m;

  // Load or initialise the ledger.
  let log = { schema: 1, updated: null, runs: [], flags: {} };
  if (fs.existsSync(FILE)) {
    try { log = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
    catch (e) { console.warn(`admin-log: existing ledger unreadable (${e.message}) — starting fresh.`); }
  }
  if (!log.flags) log.flags = {};
  if (!log.runs) log.runs = [];

  const nowTs = new Date().toISOString();
  let newlyLogged = 0, newlyFrozen = 0, refreshed = 0, flaggedTotal = 0;

  for (const id of Object.keys(priced)) {
    const entry = priced[id];
    if (!entry || !entry.ok) continue;              // Decision 2: only real prices, but ALL of them
    const key = eventKey(id);
    const board = boardByKey[key] || null;
    const meta = entry.match || {};
    const fair = entry.stage3 && entry.stage3.fair;
    const modelFair = fair && fair.p1 ? fair.p1.prob : null;
    const vs = board && board.valueSnapshot ? board.valueSnapshot : null;
    const status = statusOf(board) === 'unknown' ? 'upcoming' : statusOf(board);
    const finalScore = status === 'finished' || status === 'interrupted' ? scoreOf(board) : null;

    let row = log.flags[key];
    if (!row) {
      row = {
        key,
        date: meta.date || (board && board.date) || null,
        p1: meta.p1 || (board && board.p1) || null,
        p2: meta.p2 || (board && board.p2) || null,
        surface: meta.surface || (board && board.surface) || null,
        tour: meta.tour || (board && board.tour) || null,
        modelFairEntry: modelFair,       // frozen at first pricing
        valueSnapshot: vs,               // frozen at first State-2 sighting (may start null)
        firstSeen: nowTs,
        status,
        finalScore,
        modelFairLast: modelFair,        // refreshed each run (closing reference)
        lastSeen: nowTs,
      };
      log.flags[key] = row;
      newlyLogged++;
      if (vs) newlyFrozen++;
    } else {
      // Freeze valueSnapshot the FIRST run it appears; never overwrite thereafter.
      if (!row.valueSnapshot && vs) { row.valueSnapshot = vs; newlyFrozen++; }
      if (row.modelFairEntry == null && modelFair != null) row.modelFairEntry = modelFair;
      // Refresh the mutable resolution fields.
      row.status = status;
      if ((status === 'finished' || status === 'interrupted') && !row.finalScore) row.finalScore = finalScore;
      if (modelFair != null) row.modelFairLast = modelFair;
      row.lastSeen = nowTs;
      refreshed++;
    }
    if (row.valueSnapshot) flaggedTotal++;
  }

  // Section-2 time series (bounded).
  log.runs.push({
    ts: nowTs, run: RUN,
    priced: Object.keys(priced).filter(id => priced[id] && priced[id].ok).length,
    logged: Object.keys(log.flags).length,
    flagged: flaggedTotal,
    newlyLogged, newlyFrozen,
  });
  if (log.runs.length > MAX_RUNS) log.runs = log.runs.slice(-MAX_RUNS);
  log.updated = nowTs;

  fs.writeFileSync(FILE, JSON.stringify(log, null, 1) + '\n');
  console.log(`admin-log: ${newlyLogged} newly logged, ${newlyFrozen} newly frozen, ${refreshed} refreshed; ` +
              `${Object.keys(log.flags).length} total rows, ${flaggedTotal} value-flagged.`);
}

try { main(); } catch (e) {
  console.error(`admin-log: unexpected error — ${e && e.stack || e}`);
}
// Always succeed: a logging failure must never block the deploy.
process.exit(0);
