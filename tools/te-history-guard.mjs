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
import { execFileSync } from 'node:child_process';

export const STORE_DIR = 'te-history';
export const INDEX = 'te-history-index.json';
const BUILDER = 'tools/te-build-history.mjs';

// `prev` = the index as last committed (git HEAD^ in CI): the store may never shrink against it, so rewriting the
// index smaller (its own high-water mark included) cannot pass
export function prevIndex(root) {
  for (const ref of ['HEAD^', 'origin/main']) {
    try { return JSON.parse(execFileSync('git', ['-C', root, 'show', `${ref}:${INDEX}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch (e) { /* not committed there */ }
  }
  return null;
}
export function checkStore(root, opts = {}) {
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
  const prev = opts.prev;
  if (prev) {
    const pp = Object.keys(prev.players || {}).length;
    const pr = Math.max(prev.totalRows || 0, (prev.highWater || {}).totalRows || 0);
    if (nPlayers < Math.max(pp, (prev.highWater || {}).players || 0)) why.push(`index lists ${nPlayers} players, the committed index listed ${pp}`);
    if (total < pr) why.push(`store holds ${total} rows, the committed store held ${pr}`);
    for (const [key, p] of Object.entries(prev.players || {})) if (!players[key]) why.push(`player ${key} dropped from the index`);
  }
  return { ok: why.length === 0, why, players: nPlayers, rows: total };
}

// Nothing but the builder may write the store. Scans repo scripts (.js .mjs .cjs .sh .py), workflows and composite
// actions for a write, move or delete that names it — directly, or through a constant holding its path.
const WRITE_FN = /\b(writeFileSync|writeFile|writeJsonAtomic|writeJson|renameSync|rename|rmSync|rm|rmdirSync|unlinkSync|unlink|copyFileSync|copyFile|cpSync|createWriteStream|appendFileSync|truncateSync)\s*\(/;
const SHELL_WRITE = /\b(rm|mv|cp|rsync|truncate|tee)\b[^\n]*te-history|te-history[^\n]*\b(rm|mv|cp|rsync)\b|>>?\s*te-history|git (rm|mv|checkout --|restore)[^\n]*te-history|open\([^)]*te-history[^)]*['"][wa]/;
export function checkWriters(root) {
  const why = [];
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
    const rel = path.join(d, e.name);
    if (e.isDirectory()) { if (!['node_modules', '.git', STORE_DIR, 'career-history', 'tournament-history'].includes(e.name) && (!e.name.startsWith('.') || e.name === '.github')) walk(rel); }
    else if (/\.(m?js|cjs|ya?ml|sh|py)$/.test(e.name)) files.push(rel);
  } };
  walk('.');
  for (const rel of files) {
    const r = rel.replace(/^\.\//, '');
    // the builder writes it; the guard and tests only build throw-away copies in temp dirs
    if (r === BUILDER || r === 'tools/te-history-guard.mjs' || /^tools\/test-/.test(r)) continue;
    const src = fs.readFileSync(path.join(root, r), 'utf8');
    if (!src.includes('te-history')) continue;
    // constants that hold the store's path: `const TE_HISTORY_DIR = 'te-history'` …
    const consts = [...src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[`'"][^`'"\n]*te-history/g)].map((m) => m[1]);
    const constRe = consts.length ? new RegExp(`\\b(${consts.join('|')})\\b`) : null;
    src.split('\n').forEach((line, i) => {
      const write = (WRITE_FN.test(line) && (/te-history/.test(line) || (constRe && constRe.test(line)))) || SHELL_WRITE.test(line);
      if (write) why.push(`${r}:${i + 1} writes te-history — only ${BUILDER} may`);
    });
  }
  return { ok: why.length === 0, why };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), '..');
  const s = checkStore(root, { prev: prevIndex(root) }), w = checkWriters(root);
  const why = [...s.why, ...w.why];
  if (why.length) { console.log(`::error::te-history guard FAILED — ${why.join('; ')}`); process.exit(1); }
  console.log(`te-history guard ok · ${s.players} players · ${s.rows} rows · no writer outside ${BUILDER}`);
}
