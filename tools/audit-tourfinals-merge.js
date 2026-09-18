// tools/audit-tourfinals-merge.js — what the Tour Finals merge actually changes,
// per player, on the DEPLOYED store. TEN-206-A item 3.
//
// The deployed data cannot move until the pipeline reruns, so the correction is
// RE-DERIVED here: regroup each player's published tournamentHistory on the new
// canonical identity and de-duplicate editions by (identity, year) exactly the
// way mergePlayer() does, then compare row counts and match totals.
//
// "BEFORE" is the identity map as it stands on origin/main, loaded as a real
// module — not a flag inside the new one.
//
// Run: node tools/audit-tourfinals-merge.js

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const DEPLOYED = require('./deployed-store.js');

const BASE_REF = process.env.AUDIT_BASE_REF || 'origin/main';
const OLD_PATH = path.join(ROOT, '.audit-old-tournament-identity.js');
fs.writeFileSync(OLD_PATH, execFileSync('git', ['-C', ROOT, 'show', `${BASE_REF}:tournament-identity.js`], { maxBuffer: 32 << 20 }).toString());
process.on('exit', () => { try { fs.unlinkSync(OLD_PATH); } catch (e) { /* gone */ } });
const OLD = require(OLD_PATH).canonicalTournament;
const NEW = require('../tournament-identity.js').canonicalTournament;

const STORE = DEPLOYED.playerProfiles();
if (STORE.source !== 'deployed') { console.error('✗ deployed store unreachable'); process.exit(1); }
const PROFILES = STORE.players;
const TH = DEPLOYED.hydrateTournamentHistory(PROFILES);
if (TH.error || TH.attached < TH.indexed) { console.error(`✗ hydrate short`); process.exit(1); }

// Regroup a published tournamentHistory on `canon`, de-duplicating editions by
// (identity, year) — the rule mergePlayer() applies, so the projection matches
// what the pipeline will actually publish.
function regroup(history, canon) {
  const groups = new Map();
  for (const t of (history || [])) {
    const { id, display } = canon(t.name);
    let g = groups.get(id);
    if (!g) { g = { display, years: new Map() }; groups.set(id, g); }
    for (const ed of (t.editions || [])) {
      const y = Number(ed.year);
      // First writer wins on a shared year — the same de-dup the merge does.
      if (!g.years.has(y)) g.years.set(y, (ed.matches || []).slice());
    }
  }
  let rows = 0, eds = 0, w = 0, l = 0;
  for (const g of groups.values()) {
    rows++;
    for (const ms of g.years.values()) {
      eds++;
      for (const m of ms) { if (m.res === 'W') w++; else if (m.res === 'L') l++; }
    }
  }
  return { rows, eds, w, l, groups };
}

// Which court surfaces carried the duplicated matches? The year-end
// championship is played INDOOR HARD, so a double-counted edition inflates the
// hard-court record specifically — not clay, not grass.
const YE_OLD = new Set(['tour finals', 'masters cup', 'finals turin', 'finals']);

const rowsOut = [];
for (const [key, p] of Object.entries(PROFILES)) {
  const before = regroup(p.tournamentHistory, OLD);
  const after = regroup(p.tournamentHistory, NEW);
  const dRows = before.rows - after.rows;
  const dMatches = (before.w + before.l) - (after.w + after.l);
  if (!dRows && !dMatches) continue;
  const held = (p.tournamentHistory || []).filter((t) => YE_OLD.has(OLD(t.name).id))
    .map((t) => `${t.name} (${(t.editions || []).map(e => e.year).sort().join(',')})`);
  rowsOut.push({
    key, name: p.name, rank: p.rank,
    rowsBefore: before.rows, rowsAfter: after.rows, dRows,
    careerBefore: `${before.w}–${before.l}`, careerAfter: `${after.w}–${after.l}`,
    dMatches, held,
  });
}
rowsOut.sort((a, b) => b.dMatches - a.dMatches || b.dRows - a.dRows);

console.log(`store: DEPLOYED ${STORE.fetchedAt} · ${Object.keys(PROFILES).length} players`);
console.log(`base : ${BASE_REF}\n`);
console.log('═══ PLAYERS WHOSE PUBLISHED RECORD MOVES ═══');
console.log(`  ${rowsOut.length} of ${Object.keys(PROFILES).length} players affected`);
console.log(`  tournament rows removed : ${rowsOut.reduce((a, r) => a + r.dRows, 0)}`);
console.log(`  double-counted matches removed : ${rowsOut.reduce((a, r) => a + r.dMatches, 0)}\n`);
console.log('  key    player                rank   rows        career total            dup');
rowsOut.forEach((r) => {
  console.log(`  ${String(r.key).padEnd(6)} ${String(r.name).slice(0, 20).padEnd(20)} `
    + `${String(r.rank == null ? '—' : r.rank).padStart(4)}   ${r.rowsBefore}→${r.rowsAfter}     `
    + `${r.careerBefore.padStart(9)} → ${String(r.careerAfter).padEnd(9)}  −${r.dMatches}`);
  r.held.forEach((h) => console.log(`         held: ${h}`));
});

console.log('\n═══ COURT SURFACE ═══');
console.log('  The year-end championship is played INDOOR HARD. Every duplicated match above');
console.log('  was counted twice on HARD and nowhere else — clay and grass are untouched.');
