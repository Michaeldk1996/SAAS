// No job writes to the Pinnacle archive except by adding rows (founder brief 2026-10-14, item 1 guard).
// Scans every tracked file for the archive's three tables and fails on any path that could change or remove a row:
// an UPDATE / DELETE / TRUNCATE / DROP / ALTER … DISABLE TRIGGER statement, an upsert (merge-duplicates, ON CONFLICT DO
// UPDATE), a PATCH / PUT / DELETE request on the table's REST path, or the table named in a file outside the allow-list.
// The scanner is checked against mutants (each one must be caught), so a clean pass is not a vacuous one.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TABLES = ['oddspapi_archive_raw', 'pinnacle_archive_close', 'pinnacle_archive_count'];
const MIGRATION = 'supabase/migrations/20261014120000_pinnacle_archive.sql';
// Files that may NAME the tables. Code among them is scanned for write paths below; docs and tests only name them.
const ALLOWED = new Set([MIGRATION, 'tools/pinarch.py', 'tools/pinarch-guard.mjs', '.github/workflows/pinnacle-archive.yml',
  'tools/test-pinnacle-archive-guard.mjs', 'tools/test-pinnacle-archive-sql.py', 'tools/test-pinarch-roundtrip.py',
  'tools/test-pinarch-guard-check.mjs', 'tools/test-pinarch-close.py',
  // round 2 item 1.4: the READ-ONLY fill probe (GET-only guard) — scanned for write paths like the rest
  'tools/archive-fill-probe.py', '.github/workflows/archive-fill-probe.yml', 'tools/test-archive-fill-probe.py',
  // name the table in comments only (they read the export file, never the table): scanned for write paths like the rest
  'build-match-closes.js', '.github/workflows/pipeline.yml']);
const isDoc = f => /^\.claude\/rules\/.*\.md$/.test(f) || f === 'CLAUDE.md';

export function faults(file, text) {
  const out = [];
  const t = TABLES.find(n => text.includes(n));
  if (!t) return out;
  if (!ALLOWED.has(file) && !isDoc(file)) return [`${file} names ${t} but is not on the archive allow-list (only tools/pinarch.py writes it)`];
  if (isDoc(file) || /^tools\/test-/.test(file)) return out;
  const body = file === MIGRATION
    // the migration's own trigger + guard definitions name UPDATE / DELETE / TRUNCATE on purpose: drop those lines
    ? text.split('\n').filter(l => !/before update or delete|before truncate|drop trigger if exists|tg_op|has_table_privilege|revoke all on|revoke all on function|-- /i.test(l)).join('\n')
    : text;
  const rx = [
    [/\bupdate\s+(public\.)?(oddspapi_archive_raw|pinnacle_archive_close|pinnacle_archive_count)\b/i, 'an UPDATE statement'],
    [/\bdelete\s+from\s+(public\.)?(oddspapi_archive_raw|pinnacle_archive_close|pinnacle_archive_count)\b/i, 'a DELETE statement'],
    [/\btruncate\s+(table\s+)?(public\.)?(oddspapi_archive_raw|pinnacle_archive_close|pinnacle_archive_count)\b/i, 'a TRUNCATE statement'],
    [/\bdrop\s+table\b[^;]*(oddspapi_archive_raw|pinnacle_archive_close|pinnacle_archive_count)/i, 'a DROP TABLE'],
    [/\bdisable\s+trigger\b/i, 'a DISABLE TRIGGER'],
    [/merge-duplicates/i, 'an upsert (merge-duplicates)'],
    [/on\s+conflict[^;\n]*do\s+update/i, 'an upsert (ON CONFLICT DO UPDATE)'],
    [/\b(rest|request|fetch|urlopen)\s*\(\s*['"](PATCH|PUT|DELETE)['"]/, 'a PATCH / PUT / DELETE request'],
    [/method\s*[:=]\s*['"](PATCH|PUT|DELETE)['"]/i, 'a PATCH / PUT / DELETE request'],
    [/\bgrant\s+(all|update|delete|truncate)\b[^;]*\bto\b/i, 'a GRANT of a write privilege'],
    [/push\s+[^\n]*--force|push\s+-f\b/, 'a force-push (rewrites the backup history)'],
  ];
  for (const [r, why] of rx) if (r.test(body)) out.push(`${file}: ${why}`);
  if (file === 'tools/pinarch.py') {
    // every insert goes through insert(), which sends ignore-duplicates; no other Prefer resolution exists
    const prefers = [...text.matchAll(/resolution=([a-z-]+)/g)].map(m => m[1]);
    if (!prefers.length || prefers.some(p => p !== 'ignore-duplicates')) out.push(`${file}: an insert without resolution=ignore-duplicates`);
  }
  return out;
}

const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
  .filter(f => !/\.(png|jpg|gz|pdf|woff2?|ico|xlsx|zip)$/i.test(f));
let pass = 0, fail = 0; const bad = [];
for (const f of files) {
  let text; try { text = readFileSync(join(ROOT, f), 'utf8'); } catch { continue; }
  if (text.length > 30e6) continue;
  bad.push(...faults(f, text));
}
const check = (name, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (d ? '\n        ' + d : '')); } };
check(`no tracked file can change or remove an archive row (${files.length} files scanned)`, bad.length === 0, bad.join('\n        '));
const named = files.filter(f => { try { return TABLES.some(t => readFileSync(join(ROOT, f), 'utf8').includes(t)); } catch { return false; } });
check('the archive is named by its migration and its one writer (the scan is not vacuous)', named.includes(MIGRATION) && named.includes('tools/pinarch.py'), named.join(', '));
// mutants: each must be caught
const MUT = [
  ['tools/pinarch.py', "rest('PATCH', '/rest/v1/pinnacle_archive_close?id=eq.1', body={})  # resolution=ignore-duplicates"],
  ['tools/pinarch.py', "x = 'delete from public.oddspapi_archive_raw where id = 1'  # resolution=ignore-duplicates"],
  ['tools/pinarch.py', "headers={'Prefer': 'resolution=merge-duplicates'}  # pinnacle_archive_close"],
  ['tools/pinarch.py', "headers={'Prefer': 'resolution=ignore-duplicates'} ; rest('POST', '/rest/v1/pinnacle_archive_close')"].map((s, i) => i ? s.replace('ignore', 'merge') : s),
  ['.github/workflows/pinnacle-archive.yml', 'run: psql -c "truncate public.pinnacle_archive_count"'],
  ['.github/workflows/pinnacle-archive.yml', 'run: git push --force origin main  # pinnacle_archive_close backup'],
  [MIGRATION, 'grant update on public.oddspapi_archive_raw to service_role;'],
  [MIGRATION, 'alter table public.pinnacle_archive_close disable trigger pinnacle_archive_close_no_change;'],
  [MIGRATION, 'insert into public.pinnacle_archive_close (dedupe_key) values (1) on conflict (dedupe_key) do update set p1 = 2;'],
  ['bsp-pipeline.js', "fetch(url + '/rest/v1/pinnacle_archive_close', { method: 'POST' })"],
  ['tools/some-job.py', "sb_request('GET', '/rest/v1/oddspapi_archive_raw')"],
];
for (const [f, t] of MUT) check(`mutant caught: ${f}: ${t.slice(0, 70)}`, faults(f, t).length > 0);
check('control: the real writer passes', faults('tools/pinarch.py', readFileSync(join(ROOT, 'tools/pinarch.py'), 'utf8')).length === 0,
  faults('tools/pinarch.py', readFileSync(join(ROOT, 'tools/pinarch.py'), 'utf8')).join('; '));
console.log(`\ntest-pinnacle-archive-guard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
