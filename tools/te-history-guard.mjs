#!/usr/bin/env node
// TEN-443 · clobber guard for the Tennis Explorer store (te-history/<key>.json + te-history-index.json, repo root).
// The store is written ONLY by tools/te-build-history.mjs on this Mac; the pipeline reads it. This guard fails
// (exit 1) when:
//   * te-history-index.json is missing or unreadable;
//   * a player the index lists has no file, an unreadable file, or FEWER rows than the index records;
//   * the index's total rows or player count is below its high-water mark (the store shrank);
//   * any workflow or pipeline script outside the builder writes, moves or deletes either path.
// Run in npm test (every push) and before the publish upload. A red result is a question: read `why` first.
import fs from 'node:fs';
import path from 'node:path';

export const STORE_DIR = 'te-history';
export const INDEX = 'te-history-index.json';
const BUILDER = 'tools/te-build-history.mjs';

export function checkStore(root) {
  const why = [];
  const idxF = path.join(root, INDEX);
  let idx;
  try { idx = JSON.parse(fs.readFileSync(idxF, 'utf8')); } catch (e) { return { ok: false, why: [`${INDEX} missing or unreadable (${e.code || e.message})`] }; }
  const players = idx.players || {};
  let total = 0;
  for (const [key, p] of Object.entries(players)) {
    const f = path.join(root, STORE_DIR, `${key}.json`);
    let rec;
    try { rec = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { why.push(`${STORE_DIR}/${key}.json missing or unreadable`); continue; }
    const n = Array.isArray(rec.rows) ? rec.rows.length : 0;
    total += n;
    if (n < (p.rows || 0)) why.push(`${STORE_DIR}/${key}.json holds ${n} rows, the index records ${p.rows}`);
    if (rec.src !== 'te' || (rec.rows || []).some((r) => !Array.isArray(r) && r.src !== 'te')) why.push(`${STORE_DIR}/${key}.json is not tagged src 'te'`);
  }
  const hw = idx.highWater || {};
  const nPlayers = Object.keys(players).length;
  if (nPlayers < (hw.players || 0)) why.push(`index lists ${nPlayers} players, high-water ${hw.players}`);
  if (total < (hw.totalRows || 0)) why.push(`store holds ${total} rows, high-water ${hw.totalRows}`);
  return { ok: why.length === 0, why, players: nPlayers, rows: total };
}

// Nothing but the builder may write the store. Scans workflows and repo scripts for a write, move or delete of it.
export function checkWriters(root) {
  const why = [];
  const write = /(writeFileSync|writeFile|renameSync|rmSync|unlinkSync|copyFileSync|createWriteStream)\s*\([^)]*te-history|te-history[^\n]*\b(?:rm|mv|cp|rsync)\b|\b(?:rm|mv|cp|rsync)\b[^\n]*te-history|>\s*te-history|git (?:rm|mv|checkout --)[^\n]*te-history/;
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
    const rel = path.join(d, e.name);
    if (e.isDirectory()) { if (!['node_modules', '.git', STORE_DIR, 'career-history', 'tournament-history'].includes(e.name) && !e.name.startsWith('.') ) walk(rel); }
    else if (/\.(m?js|ya?ml|sh)$/.test(e.name)) files.push(rel);
  } };
  walk('.');
  const wf = path.join(root, '.github', 'workflows');
  if (fs.existsSync(wf)) for (const f of fs.readdirSync(wf)) files.push(path.join('.github', 'workflows', f));
  for (const rel of files) {
    const r = rel.replace(/^\.\//, '');
    if (r === BUILDER || r === 'tools/te-history-guard.mjs' || /^tools\/test-te-history/.test(r)) continue;
    const src = fs.readFileSync(path.join(root, r), 'utf8');
    if (!src.includes('te-history')) continue;
    src.split('\n').forEach((line, i) => { if (write.test(line)) why.push(`${r}:${i + 1} writes te-history — only ${BUILDER} may`); });
  }
  return { ok: why.length === 0, why };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), '..');
  const s = checkStore(root), w = checkWriters(root);
  const why = [...s.why, ...w.why];
  if (why.length) { console.log(`::error::te-history guard FAILED — ${why.join('; ')}`); process.exit(1); }
  console.log(`te-history guard ok · ${s.players} players · ${s.rows} rows · no writer outside ${BUILDER}`);
}
