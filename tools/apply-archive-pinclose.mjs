#!/usr/bin/env node
// Round 2 item 1.2 (founder 2026-10-25): a finished board card's Pinnacle close (m.pinClose — the odds pop-up's
// "Pinnacle close" line and the Match analysis Odds tab's Closing row) is the ARCHIVE close when the protected archive
// holds one, else the captured close the pipeline derived (pinnacleCloseOf) stays — one price per match on every page.
//
// READ-ONLY toward the archive: this reads pinnacle-closes.json, the export `pinarch.py export` wrote earlier in this
// run (a SELECT of the archive). It writes nothing to the archive and creates no archive file; it rewrites only
// matches.json, atomically (temp file + rename).
//
// Rules: only a row labelled 'from Pinnacle history' (the archive's own close) replaces; a 'captured' row is the
// captured close the card already shows. The row joins the card by api-tennis event key (the card id's digits) and is
// oriented by the two player keys — a row whose keys are not exactly the card's two players is not applied (counted).
// Both prices must be >= 1.01 (the price floor), else not applied. The replaced captured pair is kept on the card as
// pinClose.captured for audit.
//
// Usage: node tools/apply-archive-pinclose.mjs [--closes pinnacle-closes.json] [--matches matches.json]
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

export const ARCHIVE_LABEL = 'from Pinnacle history';
export const ARCHIVE_SOURCE = 'Pinnacle close (archive)';

const eventKeyOf = m => { const d = /(\d+)$/.exec(String((m && m.id) || '')); return d ? d[1] : null; };

export function applyArchiveCloses(matches, exportRows) {
  const byKey = new Map();
  for (const r of exportRows || []) if (r && r.eventKey != null && r.label === ARCHIVE_LABEL) byKey.set(String(r.eventKey), r);
  const stats = { finished: 0, archive: 0, replaced: 0, unchanged: 0, keyMismatch: 0, belowFloor: 0, captured: 0 };
  for (const m of matches) {
    if (!m || !m.finalScore) continue;
    stats.finished++;
    const r = byKey.get(eventKeyOf(m));
    if (!r) { stats.captured++; continue; }                     // no archive close: the captured close stays
    stats.archive++;
    const k1 = String(m.p1Key), k2 = String(m.p2Key), r1 = String(r.p1Key), r2 = String(r.p2Key);
    const same = r1 === k1 && r2 === k2, swapped = r1 === k2 && r2 === k1;
    if (!same && !swapped) { stats.keyMismatch++; continue; }
    const p1 = same ? Number(r.p1) : Number(r.p2), p2 = same ? Number(r.p2) : Number(r.p1);
    if (!(p1 >= 1.01) || !(p2 >= 1.01)) { stats.belowFloor++; continue; }
    const prev = m.pinClose || null;
    if (prev && prev.source === ARCHIVE_SOURCE && prev.p1 === p1 && prev.p2 === p2) { stats.unchanged++; continue; }
    m.pinClose = {
      p1, p2, p1At: r.closeTs || null, p2At: r.closeTs || null, source: ARCHIVE_SOURCE,
      startTs: r.startTs || null, startBasis: r.startSource || 'archive', ageRefTs: r.startTs || null, archiveId: r.archiveId ?? null,
      captured: prev && prev.source !== ARCHIVE_SOURCE ? { p1: prev.p1, p2: prev.p2, source: prev.source || null } : (prev && prev.captured) || null,
    };
    stats.replaced++;
  }
  return stats;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const closesPath = arg('--closes', 'pinnacle-closes.json'), matchesPath = arg('--matches', 'matches.json');
  const ex = JSON.parse(readFileSync(closesPath, 'utf8'));
  const rows = Array.isArray(ex) ? ex : ex.rows;
  if (!Array.isArray(rows)) { console.error(`apply-archive-pinclose: ${closesPath} has no rows — nothing changed`); process.exit(1); }
  const matches = JSON.parse(readFileSync(matchesPath, 'utf8'));
  if (!Array.isArray(matches)) { console.error(`apply-archive-pinclose: ${matchesPath} is not a card array — nothing changed`); process.exit(1); }
  const stats = applyArchiveCloses(matches, rows);
  const tmp = matchesPath + '.tmp';
  writeFileSync(tmp, JSON.stringify(matches, null, 2));   // the pipeline's own format (writeJsonAtomic: committed, pretty)
  renameSync(tmp, matchesPath);
  console.log(`apply-archive-pinclose: ${stats.finished} finished card(s); ${stats.archive} with an archive close — ${stats.replaced} now show it, `
    + `${stats.unchanged} already did, ${stats.keyMismatch} not applied (player keys differ), ${stats.belowFloor} not applied (below 1.01); `
    + `${stats.captured} keep the captured close (no archive close yet).`);
}
