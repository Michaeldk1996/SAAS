// Historical odds archive (founder brief 2026-10-16, items 1-4): three guards, each checked against mutants.
//  1. No job writes the four tables except by adding rows (the Pinnacle archive's scan, for these tables).
//  2. The publish guard blocks on a lost protection or a shrunk table, and SKIPS (never passes) on no answer.
//  3. The private export and the archive's backups never reach the published site or this public repo.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verdict, snapVerdict } from './histarch-guard.mjs';
import { offenders, EXPORT_HEADER } from './no-odds-export-check.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { if (ok) { passed++; console.log('  PASS ', name); } else { failed++; console.log('  FAIL ', name, '\n       ', String(detail).slice(-300)); } };

const TABLES = ['historical_odds_file', 'historical_close', 'historical_odds_export', 'historical_archive_count', 'historical_snapshot_count', 'historical_snapshot'];
const T = TABLES.join('|');
const MIGRATIONS = new Set(['supabase/migrations/20261016090000_historical_odds_archive.sql', 'supabase/migrations/20261016150000_historical_snapshot.sql',
  'supabase/migrations/20261017090000_historical_snapshot_start10.sql',
  'supabase/migrations/20261019090000_historical_snapshot_bet365.sql',
  'supabase/migrations/20261020090000_historical_snapshot_te.sql']);
const ALLOWED = new Set([...MIGRATIONS, 'tools/tdarch.py', 'tools/histarch-guard.mjs', '.github/workflows/historical-archive.yml',
  'tools/test-histarch.mjs', 'tools/test-historical-archive-sql.py', 'tools/test-tdarch.py',
  'tools/archive_install.py', 'tools/test-archive-ledger.py',
  // founder 2026-10-26 audit: the fill probe READS the start − 10 snapshots (GET-only guard; scanned for write paths)
  'tools/archive-fill-probe.py', 'tools/test-archive-fill-probe.py']);   // the install's migration ledger (founder 2026-10-20, item 9): reads only
const isDoc = f => /^\.claude\/rules\/.*\.md$/.test(f) || f === 'CLAUDE.md';
export function faults(file, text) {
  const t = TABLES.find(n => text.includes(n));
  if (!t) return [];
  if (!ALLOWED.has(file) && !isDoc(file)) return [`${file} names ${t} but is not on the archive allow-list`];
  if (isDoc(file) || /^tools\/test-/.test(file)) return [];
  const body = MIGRATIONS.has(file)
    ? text.split('\n').filter(l => !/before update or delete|before truncate|drop trigger if exists|tg_op|has_table_privilege|revoke all on|-- /i.test(l)).join('\n')
    : text;
  const rx = [
    [new RegExp(`\\bupdate\\s+(public\\.)?(${T})\\b`, 'i'), 'an UPDATE statement'],
    [new RegExp(`\\bdelete\\s+from\\s+(public\\.)?(${T})\\b`, 'i'), 'a DELETE statement'],
    [new RegExp(`\\btruncate\\s+(table\\s+)?(public\\.)?(${T})\\b`, 'i'), 'a TRUNCATE statement'],
    [new RegExp(`\\bdrop\\s+table\\b[^;]*(${T})`, 'i'), 'a DROP TABLE'],
    [/\bdisable\s+trigger\b/i, 'a DISABLE TRIGGER'],
    [/merge-duplicates/i, 'an upsert (merge-duplicates)'],
    [/on\s+conflict[^;\n]*do\s+update/i, 'an upsert (ON CONFLICT DO UPDATE)'],
    [/\b(rest|request|fetch|urlopen)\s*\(\s*['"](PATCH|PUT|DELETE)['"]/, 'a PATCH / PUT / DELETE request'],
    [/method\s*[:=]\s*['"](PATCH|PUT|DELETE)['"]/i, 'a PATCH / PUT / DELETE request'],
    [/push[^\n]*(--force|\s-f\b|\+HEAD|\+main)/, 'a force-push'],
    [/\bgrant\s+(update|delete|truncate|all)\b/i, 'a write GRANT'],
  ];
  return rx.filter(([r]) => r.test(body)).map(([, w]) => `${file}: ${w}`);
}
const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const all = files.flatMap(f => { try { return faults(f, readFileSync(join(ROOT, f), 'utf8')); } catch { return []; } });
check('1. writers: no tracked file can change or remove a row of the four tables', all.length === 0, all.join('; '));
const real = readFileSync(join(ROOT, 'tools/tdarch.py'), 'utf8');
for (const [name, m] of [['an UPDATE', '\n# update public.historical_close set x=1\nx="update historical_close set p=1"'],
  ['a DELETE', '\nx = "delete from historical_odds_file"'], ['an upsert', "\nq = 'resolution=merge-duplicates'"],
  ['a PATCH', "\nP.rest('PATCH', '/rest/v1/historical_close?id=eq.1', {})"], ['a force-push', "\nP.git('push', '--force', 'origin', 'main')"]]) {
  check(`1. control: ${name} in the writer is caught`, faults('tools/tdarch.py', real + m).length > 0);
}
check('1. control: a stray file naming a table is caught', faults('build-x.js', 'historical_close').length === 1);
check('1. control: the real writer passes', faults('tools/tdarch.py', real).length === 0, faults('tools/tdarch.py', real));

const ok = Object.fromEntries(TABLES.map(t => [t, { rows: 10, triggers: true, rls: true, privilegeFaults: [] }]));
const G = (x = {}) => ({ ...ok, ...x, maxRecorded: { file: 10, close: 10, export: 10, ...(x.maxRecorded || {}) }, ok: x.ok ?? true });
check('2. guard: a healthy archive passes', verdict(G()).block === false && verdict(G()).skip === false);
check('2. guard: fewer close rows than recorded → block', verdict(G({ historical_close: { ...ok.historical_close, rows: 9 } })).block);
check('2. guard: fewer file rows than recorded → block', verdict(G({ historical_odds_file: { ...ok.historical_odds_file, rows: 9 } })).block);
check('2. guard: a dropped trigger → block', verdict(G({ historical_odds_export: { ...ok.historical_odds_export, triggers: false } })).block);
check('2. guard: a write privilege → block', verdict(G({ historical_close: { ...ok.historical_close, privilegeFaults: ['service_role DELETE'] } })).block);
check('2. guard: a missing table → block', verdict(G({ historical_odds_file: undefined })).block);
// Pinnacle (approx.) snapshots (founder ruling 2026-10-16): the same guard covers their own tables
const S = (o = {}) => ({ historical_snapshot: { rows: 750, triggers: true, rls: true, privilegeFaults: [] },
  historical_snapshot_count: { rows: 2, triggers: true, rls: true, privilegeFaults: [] }, maxRecorded: { snapshot: 750 }, ok: true, ...o });
check('2. snapshot guard: healthy → no block', !snapVerdict(S()).block && !snapVerdict(S()).skip);
check('2. snapshot guard: fewer snapshots than recorded → block', snapVerdict(S({ historical_snapshot: { rows: 700, triggers: true, rls: true, privilegeFaults: [] } })).block);
check('2. snapshot guard: a write privilege → block', snapVerdict(S({ historical_snapshot: { rows: 750, triggers: true, rls: true, privilegeFaults: ['service_role UPDATE'] } })).block);
check('2. snapshot guard: a dropped trigger → block', snapVerdict(S({ historical_snapshot_count: { rows: 2, triggers: false, rls: true, privilegeFaults: [] } })).block);
check('2. snapshot guard: no answer → SKIP, never a pass', snapVerdict(null).skip === true && snapVerdict(null).block === false);
check('2. guard: no answer → SKIP, never a pass', verdict(null).skip === true && verdict(null).block === false);

const site = { 'index.html': '<html>', 'database-yield.json': '{"rows":[]}', 'data/tournament-quotes.csv': 'event,speaker,year,quote\n',
  'odds/1.json': '{}' };
const read = f => site[f];
check('3. leak: the real site shape (pages, JSON data, a non-odds CSV) passes', offenders(Object.keys(site), read).length === 0, offenders(Object.keys(site), read));
for (const [name, f, body] of [['the export by name', 'pinnacle-closes-2010-2026_2026-10-16.csv', 'x'],
  ['a per-year export', 'x/pinnacle-closes-2024_2026-10-16.csv', 'x'], ['a renamed export (its header)', 'data/all.csv', EXPORT_HEADER + ',x\n'],
  ['a Tennis-Data CSV', 'odds-archive/2026.csv', 'date,tournament,series,court,surface,round,bestof,winner,loser,wrank,lrank,comment,b365w,b365l,psw,psl\n'],
  ['a backup folder', 'historical-archive/2026-10-16/manifest.json', '{}'], ['the export header inside JSON', 'x.json', '{"h":"' + EXPORT_HEADER + '"}']]) {
  check(`3. control: ${name} is caught`, offenders([...Object.keys(site), f], g => g === f ? body : read(g)).length === 1);
}
console.log(`\ntest-histarch: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
