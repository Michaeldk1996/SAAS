// TEN-443 · sets api-tennis dropped (founder ruling 2026-10-17, comment b5b5ef00 item 1).
// api-tennis leaves out every set in which one player won no games (3,576 of 168,390 finished rows, 2021–2023 only,
// measured 2026-10-17): the result reads "2 - 1" and the set list holds two sets. `set-repairs.json` (built whole by
// tools/build-set-repairs.mjs on 17 Oct; since then only added to — new short rows, and a refresh-written flag upgraded
// to a repair — by tools/te-set-repairs-refresh.mjs in the store repo's weekly refresh, TEN-449) holds, per player key
// and api-tennis event key, the full set list where Tennis Explorer AND Sackmann agree on the full score, and a flag where they disagree or only one source has the match.
//
// applySetRepairs(rows, key, store) — no I/O; CommonJS like bsp-pipeline.js:
//   * a repair applies only while the row still holds exactly the short list it was built from (`short`), so a
//     feed that later fills the set itself, or a different row on the same event key, is never overwritten;
//   * the missing sets are INSERTED where the sources put them; every set already on the row keeps its own games
//     and tiebreak points;
//   * a repaired row says so (`setsFrom: 'te+sackmann'`); a flagged row keeps its short list and carries
//     `setsIncomplete` (the reason) — the Lines tab already keeps a short list out of the games lines (`partial`).
'use strict';

const games = (sets) => (sets || []).map((s) => `${s.p}-${s.o}`).join(' ');

function applySetRepairs(rows, key, store) {
  const diag = { repaired: 0, flagged: 0, stale: 0 };
  const rep = (store && store.repairs && store.repairs[String(key)]) || {};
  const flg = (store && store.flags && store.flags[String(key)]) || {};
  for (const r of rows || []) {
    if (!r || r.eventKey == null) continue;
    const ek = String(r.eventKey);
    const fix = rep[ek];
    if (fix) {
      if (games(r.sets) !== games(fix.short)) { diag.stale++; continue; }
      const out = []; let j = 0;
      for (const s of fix.sets) {
        if (j < r.sets.length && r.sets[j].p === s.p && r.sets[j].o === s.o) out.push(r.sets[j++]);
        else out.push({ p: s.p, o: s.o });
      }
      if (j !== r.sets.length) { diag.stale++; continue; }   // the stored sets are not an in-order part of the repair
      r.sets = out; r.setsFrom = 'te+sackmann'; diag.repaired++;
      continue;
    }
    const f = flg[ek];
    if (f && games(r.sets) === games(f.short)) { r.setsIncomplete = f.why; diag.flagged++; }
  }
  return diag;
}

module.exports = { applySetRepairs };
