// Founder brief 2026-10-16, item 4: the private odds export (and the archive's backups) never reach a place a visitor
// can read. Two modes, each a hard failure:
//   node tools/no-odds-export-check.mjs --site _site   (publish.yml, before the Pages upload): the published site holds
//       no CSV with odds columns, no file named like the export, no file carrying the export's header, no backup folder.
//   node tools/no-odds-export-check.mjs --repo          (npm test): no tracked file in this PUBLIC repo is an export or
//       a backup copy. The Tennis-Data season CSVs in odds-archive/ are already public here; they are listed by name
//       (REPO_KNOWN) pending the founder's ruling on moving them private — any OTHER odds CSV fails.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const EXPORT_NAME = /pinnacle-closes-\d{4}(-\d{4})?_\d{4}-\d{2}-\d{2}\.csv$/i;
export const EXPORT_HEADER = 'date,tournament,round,surface,tour,player1,player2,winner,score,pinnacle_p1,pinnacle_p2';
export const PRIVATE_DIRS = /(^|\/)(closes-export|historical-archive|pinnacle-archive|tennis-data\/originals)\//;
const ODDS_COLS = /(^|,)(psw|psl|b365w|b365l|bfew|bfel|maxw|avgw|pinnacle_p1|bet365_p1)(,|$)/i;
export const REPO_KNOWN = /^odds-archive\/\d{4}\.csv$/;

export function offenders(files, read) {
  const bad = [];
  for (const f of files) {
    const rel = f.replace(/\\/g, '/');
    if (EXPORT_NAME.test(rel)) { bad.push(`${rel}: named like the private export`); continue; }
    if (PRIVATE_DIRS.test(rel)) { bad.push(`${rel}: inside a private archive folder`); continue; }
    if (!/\.(csv|txt|json|tsv|gz)$/i.test(rel)) continue;
    let head = '';
    try { head = read(f).slice(0, 4096); } catch { continue; }
    if (head.includes(EXPORT_HEADER)) { bad.push(`${rel}: carries the export header`); continue; }
    if (/\.csv$/i.test(rel) && ODDS_COLS.test(head.split('\n')[0] || '')) bad.push(`${rel}: an odds CSV`);
  }
  return bad;
}

function walk(dir, out = [], base = dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, base); else out.push(path.relative(base, p));
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  let bad = [];
  if (a[0] === '--site') {
    const site = a[1];
    bad = offenders(walk(site), f => fs.readFileSync(path.join(site, f), 'utf8'));
  } else if (a[0] === '--repo') {
    const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    const known = files.filter(f => REPO_KNOWN.test(f));
    bad = offenders(files.filter(f => !REPO_KNOWN.test(f)), f => fs.readFileSync(f, 'utf8'));
    console.log(`note: ${known.length} Tennis-Data season CSVs (odds-archive/) are tracked in this public repo — listed pending the founder's ruling`);
  } else { console.error('usage: --site DIR | --repo'); process.exit(2); }
  if (bad.length) { console.log(`::error::odds export check FAILED — ${bad.length} file(s) a visitor could read:\n  ` + bad.slice(0, 30).join('\n  ')); process.exit(1); }
  console.log(`odds export check ok (${a[0]})`);
}
