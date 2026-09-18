// tools/audit-reconcile-nameset.js — before/after for the full-name-token-set
// reconciler tier (TEN-206-A, founder ruling 2026-09-18 item 1).
//
// WHAT IT COMPARES
//   BEFORE = career-backfill.js exactly as it stands on origin/main.
//   AFTER  = career-backfill.js in this worktree.
// Both are require()d as real modules — the "before" copy is checked out into
// the worktree so its `require('./tournament-identity')` resolves — so this is a
// comparison of two real builds, not of a flag inside one. No test seam is added
// to the production matcher.
//
// WHAT IT MEASURES, per the ruling: which players newly reconcile, how many
// SEASONS and how many match ROWS each gains, and the three largest movers with
// their old and new career totals.
//
// The profile store is the DEPLOYED one, with tournamentHistory re-attached from
// the TEN-207 shards. Reading the committed player-profiles.json here would
// measure July, which is the whole reason this ticket has a correction on it.
//
// Run: node tools/audit-reconcile-nameset.js [--json]

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEPLOYED = require('./deployed-store.js');

// ── the two builds ──────────────────────────────────────────────────────────
const BASE_REF = process.env.AUDIT_BASE_REF || 'origin/main';
const OLD_PATH = path.join(ROOT, '.audit-old-career-backfill.js');
function loadOldBuild() {
  const src = execFileSync('git', ['-C', ROOT, 'show', `${BASE_REF}:career-backfill.js`],
    { maxBuffer: 64 << 20 }).toString();
  fs.writeFileSync(OLD_PATH, src);
  try { return require(OLD_PATH); } finally { /* file removed at exit */ }
}
process.on('exit', () => { try { fs.unlinkSync(OLD_PATH); } catch (e) { /* already gone */ } });

const OLD = loadOldBuild();
const NEW = require('../career-backfill.js');

// ── stores ──────────────────────────────────────────────────────────────────
const STORE = DEPLOYED.playerProfiles();
if (STORE.source !== 'deployed') {
  console.error(`✗ deployed player-profiles.json unreachable (${STORE.drift.why}) — refusing to audit against the committed fossil.`);
  process.exit(1);
}
const PROFILES = STORE.players;
const TH = DEPLOYED.hydrateTournamentHistory(PROFILES);
if (TH.error || TH.attached < TH.indexed) {
  console.error(`✗ tournament-history hydrate short: ${TH.error || `${TH.attached}/${TH.indexed}`}`);
  process.exit(1);
}

const COUNTRY_TO_IOC = (() => {
  // The pipeline passes its own map; reconcile() falls back to its internal one
  // when handed an empty object, which is what we want here.
  return {};
})();

function careerTotals(history) {
  let w = 0, l = 0, rows = 0, eds = 0;
  const seasons = new Set();
  for (const t of (history || [])) {
    rows++;
    for (const ed of (t.editions || [])) {
      eds++;
      seasons.add(Number(ed.year));
      for (const m of (ed.matches || [])) { if (m.res === 'W') w++; else if (m.res === 'L') l++; }
    }
  }
  return { w, l, rows, editions: eds, seasons };
}

(async function main() {
  const t0 = Date.now();
  console.log(`profile store : DEPLOYED ${STORE.fetchedAt} — ${Object.keys(PROFILES).length} players`);
  console.log(`tournamentHistory: ${TH.attached}/${TH.indexed} hydrated, ${TH.tournamentRows} tournament rows`);
  console.log(`base ref      : ${BASE_REF}\n`);

  const index = await NEW._internal.buildTmlIndex((s) => console.log(s));
  const oldMap = OLD._internal.reconcile(PROFILES, index.identity, COUNTRY_TO_IOC, (s) => console.log('  OLD' + s));
  const newMap = NEW._internal.reconcile(PROFILES, index.identity, COUNTRY_TO_IOC, (s) => console.log('  NEW' + s));

  // ── guard: the new tier must be strictly ADDITIVE ──────────────────────────
  // If it ever moved an existing player to a different TML identity, it would be
  // grafting someone else's matches on — the exact corruption the uniqueness
  // guards exist to prevent. Assert it, don't assume it.
  const moved = [];
  for (const [k, v] of oldMap) {
    if (!newMap.has(k)) moved.push({ key: k, name: PROFILES[k] && PROFILES[k].name, from: v, to: null });
    else if (newMap.get(k) !== v) moved.push({ key: k, name: PROFILES[k] && PROFILES[k].name, from: v, to: newMap.get(k) });
  }

  const gained = [...newMap.keys()].filter((k) => !oldMap.has(k));

  // ── per newly-matched player: what the merge actually adds ────────────────
  const movers = [];
  let totalRows = 0, totalSeasons = 0, totalEditions = 0;
  for (const key of gained) {
    const p = PROFILES[key];
    if (!p) continue;
    const tmlMatches = index.byId.get(newMap.get(key)) || [];
    const before = careerTotals(p.tournamentHistory);
    const merged = NEW._internal.mergePlayer(p.tournamentHistory, tmlMatches);
    const after = careerTotals(merged.history);
    const newSeasons = [...after.seasons].filter((y) => !before.seasons.has(y)).sort();
    const rowsGained = (after.w + after.l) - (before.w + before.l);
    if (rowsGained <= 0 && !newSeasons.length && merged.addedEditions === 0) continue;
    totalRows += rowsGained;
    totalSeasons += newSeasons.length;
    totalEditions += merged.addedEditions;
    movers.push({
      key, name: p.name, country: p.country, tmlId: newMap.get(key),
      seasonsGained: newSeasons.length, newSeasons,
      rowsGained, addedEditions: merged.addedEditions,
      tournamentRowsBefore: before.rows, tournamentRowsAfter: after.rows,
      careerBefore: `${before.w}–${before.l}`, careerAfter: `${after.w}–${after.l}`,
    });
  }
  movers.sort((a, b) => b.rowsGained - a.rowsGained);

  // ── report ────────────────────────────────────────────────────────────────
  console.log('\n═══ BEFORE / AFTER ═══');
  console.log(`  reconciled  : ${oldMap.size} → ${newMap.size}  (+${newMap.size - oldMap.size})`);
  console.log(`  roster      : ${Object.keys(PROFILES).length} deployed profiles`);
  console.log(`  unmatched   : ${Object.keys(PROFILES).length - oldMap.size} → ${Object.keys(PROFILES).length - newMap.size}`);
  console.log(`  re-pointed  : ${moved.length} existing matches changed identity  ${moved.length ? '← MUST BE 0' : '(none — the tier is additive)'}`);
  if (moved.length) moved.slice(0, 10).forEach(m => console.log(`      ${m.key} ${m.name}: ${m.from} → ${m.to}`));
  console.log(`\n  players that actually gain data : ${movers.length} of ${gained.length} newly reconciled`);
  console.log(`  player-seasons gained           : ${totalSeasons}`);
  console.log(`  match rows gained               : ${totalRows}`);
  console.log(`  tournament editions gained      : ${totalEditions}`);

  console.log('\n═══ THREE LARGEST MOVERS ═══');
  movers.slice(0, 3).forEach((m, i) => {
    console.log(`  ${i + 1}. ${m.name} (key ${m.key}, ${m.country || '?'})`);
    console.log(`       career total  ${m.careerBefore}  →  ${m.careerAfter}   (+${m.rowsGained} matches)`);
    console.log(`       seasons       +${m.seasonsGained}  [${m.newSeasons.join(', ')}]`);
    console.log(`       editions      +${m.addedEditions};  tournament rows ${m.tournamentRowsBefore} → ${m.tournamentRowsAfter}`);
  });

  console.log('\n═══ ALL MOVERS ═══');
  console.log('  key    player                          seasons  rows  career before  →  after');
  movers.forEach((m) => {
    console.log(`  ${String(m.key).padEnd(6)} ${String(m.name).slice(0, 30).padEnd(30)} `
      + `${String('+' + m.seasonsGained).padStart(7)} ${String('+' + m.rowsGained).padStart(5)}  `
      + `${m.careerBefore.padStart(9)}  →  ${m.careerAfter}`);
  });

  if (process.argv.includes('--json')) {
    fs.writeFileSync(path.join(ROOT, 'ten206a-reconcile-audit.json'),
      JSON.stringify({ base: BASE_REF, store: STORE.fetchedAt, oldMatched: oldMap.size, newMatched: newMap.size,
        movedIdentities: moved, totals: { players: movers.length, seasons: totalSeasons, rows: totalRows, editions: totalEditions }, movers }, null, 2));
    console.log('\n  wrote ten206a-reconcile-audit.json');
  }
  console.log(`\n  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  process.exitCode = moved.length ? 1 : 0;
})();
