#!/usr/bin/env node
// Founder ruling 2026-10-17 (odds master close-out, item 3): when the protected archive is unreachable or answers short,
// the run fails, nothing empty or partial publishes, the site keeps the last good master and pre-2010 file, and a
// Telegram alert goes out. Tests tools/archive-gate.mjs (archive unreachable; fewer rows than the last good master; the
// first publish) and the pipeline.yml wiring (fail-closed steps, the gate before the upload, the alert on failure).
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { check, currentCounts } from './archive-gate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };

const good = { masterRows: 59000, exportEvents: 1363, feedRows: 300, approxRows: 3230, xRows: 16551 };
function site(over) {
  const d = mkdtempSync(join(tmpdir(), 'agate-'));
  const c = Object.assign({}, good, over);
  if (c.exportEvents != null) writeFileSync(join(d, 'pinnacle-closes.json'), JSON.stringify({ rows: Array.from({ length: c.exportEvents }, (_, i) => ({ eventKey: i })) }));
  if (c.masterRows != null) writeFileSync(join(d, 'database-yield-master.json'), JSON.stringify({ meta: {}, rows: Array.from({ length: c.masterRows }, () => []) }));
  if (c.xRows != null) writeFileSync(join(d, 'database-yield-x.json'), JSON.stringify({ meta: {}, xRows: Array.from({ length: c.xRows }, () => []), xNames: [] }));
  const csv = (f, n) => { if (n != null) writeFileSync(join(d, f), ['h'].concat(Array.from({ length: n }, () => 'r')).join('\n') + '\n'); };
  csv('pinnacle-archive-td.csv', c.feedRows); csv('pinnacle-approx.csv', c.approxRows);
  return d;
}
const run = (d, base) => {
  const args = ['tools/archive-gate.mjs', '--dir', d];
  if (base !== undefined) { const bf = join(d, 'baseline.json'); if (base) writeFileSync(bf, JSON.stringify({ counts: base })); args.push('--baseline-file', bf); }
  return spawnSync('node', args, { cwd: ROOT, encoding: 'utf8' });
};

// unit
ok(check(good, good).length === 0, 'every count present and equal to the last good run → pass');
ok(check(Object.assign({}, good, { exportEvents: null }), good).length > 0, 'the archive export missing → fail');
ok(check(Object.assign({}, good, { approxRows: 0 }), good).length > 0, 'the snapshot export empty → fail');
ok(check(Object.assign({}, good, { masterRows: 58999 }), good).length > 0, 'one master row fewer than the last good master → fail');
ok(check(Object.assign({}, good, { masterRows: 59100 }), good).length === 0, 'more master rows than the last good run → pass');
ok(check(good, null).length === 0, 'the first publish (no baseline) → emptiness checked, pass');

// the tool, end to end
let d = site({}); let r = run(d, good);
ok(r.status === 0 && existsSync(join(d, 'database-yield-master-meta.json')), 'a full run passes and writes database-yield-master-meta.json');
ok(JSON.parse(readFileSync(join(d, 'database-yield-master-meta.json'), 'utf8')).counts.masterRows === 59000, 'the published counts are this run\'s');
rmSync(d, { recursive: true, force: true });

d = site({ exportEvents: null, feedRows: null }); r = run(d, good);
ok(r.status === 1, 'ARCHIVE UNREACHABLE (no export, no feed) → the run fails');
ok(existsSync(join(d, '.archive-failed')), 'it leaves the marker the Telegram alert step reads');
ok(!existsSync(join(d, 'database-yield-master-meta.json')), 'and publishes no counts file');
rmSync(d, { recursive: true, force: true });

d = site({ masterRows: 41000, xRows: 0 }); r = run(d, good);
ok(r.status === 1, 'ARCHIVE SHORT (fewer master rows than the last good master) → the run fails');
ok(/masterRows: 41000 < 59000/.test(r.stdout), 'the error names the count and the last good count');
rmSync(d, { recursive: true, force: true });

// the override (founder ruling 2026-10-18): written by the tool, committed, checked; a hand edit or a file put on the runner
// is refused; an unapproved drop still fails
const git = (d, ...a) => spawnSync('git', ['-c', 'user.name=Test Author', '-c', 'user.email=t@x', ...a], { cwd: d, encoding: 'utf8' });
const commitAccept = d => { git(d, 'init', '-q'); git(d, 'add', 'archive-gate-accept.json'); git(d, 'commit', '-qm', 'override'); };
const accept = (d, expect, reason) => spawnSync('node', ['tools/archive-gate.mjs', 'accept', '--dir', d, '--key', 'masterRows', '--expect', String(expect), '--reason', reason], { cwd: ROOT, encoding: 'utf8' });
d = site({ masterRows: 58000 });
let a = accept(d, 58000, 'test: junior rows removed');
ok(a.status === 0 && existsSync(join(d, 'archive-gate-accept.json')), 'the accept command writes the override (key, expected count, reason)');
const ent = JSON.parse(readFileSync(join(d, 'archive-gate-accept.json'), 'utf8')).entries[0];
ok(ent && ent.key === 'masterRows' && ent.expect === 58000 && ent.reason === 'test: junior rows removed' && ent.by && ent.at && ent.check, 'the entry records who, when and a check', JSON.stringify(ent));
r = run(d, good);
ok(r.status === 1 && /not committed/.test(r.stdout), 'an override file not committed (put on the runner by hand) is refused → the run fails');
rmSync(join(d, '.archive-failed'), { force: true });
commitAccept(d); r = run(d, good);
ok(r.status === 0 && /masterRows floor lowered 59000 → 58000 by an approved override \("test: junior rows removed"/.test(r.stdout), 'a committed, tool-written override lets the approved drop through, said out loud');
ok(JSON.parse(readFileSync(join(d, 'database-yield-master-meta.json'), 'utf8')).overrides[0].to === 58000, 'the override used is logged in the published counts file');
rmSync(d, { recursive: true, force: true });
d = site({ masterRows: 57000 }); accept(d, 58000, 'test'); commitAccept(d); r = run(d, good);
ok(r.status === 1, 'a drop below the approved count still fails');
rmSync(d, { recursive: true, force: true });
d = site({ masterRows: 58000 }); accept(d, 58000, 'test');
const f = join(d, 'archive-gate-accept.json'), jj = JSON.parse(readFileSync(f, 'utf8')); jj.entries[0].expect = 50000; writeFileSync(f, JSON.stringify(jj));
commitAccept(d); r = run(d, good);
ok(r.status === 1 && /edited by hand/.test(r.stdout), 'a hand-edited override (the number changed) is refused → the run fails');
rmSync(d, { recursive: true, force: true });
d = site({ masterRows: 58000 }); writeFileSync(join(d, 'archive-gate-accept.json'), JSON.stringify({ masterRows: { atMost: 58000, reason: 'old form' } })); commitAccept(d); r = run(d, good);
ok(r.status === 1, 'the old hand-written form is refused');
rmSync(d, { recursive: true, force: true });
d = site({ masterRows: 58000 }); r = run(d, good);
ok(r.status === 1 && /masterRows: 58000 < 59000/.test(r.stdout), 'CONTROL: the same drop with no approved override fails');
rmSync(d, { recursive: true, force: true });
d = site({ masterRows: 58000 }); accept(d, 58000, 'test'); commitAccept(d); r = run(d, Object.assign({}, good, { masterRows: 58000 }));
ok(r.status === 0 && /no longer needed/.test(r.stdout), 'once the lower count is published the override says it is no longer needed');
rmSync(d, { recursive: true, force: true });

d = site({}); r = run(d, null);
ok(r.status === 0 && /no published counts yet/.test(r.stdout), 'the first publish (no baseline file) passes, said out loud');
rmSync(d, { recursive: true, force: true });

d = site({}); r = spawnSync('node', ['tools/archive-gate.mjs', '--dir', d, '--baseline-url', 'http://127.0.0.1:9/none.json'], { cwd: ROOT, encoding: 'utf8' });
ok(r.status === 1, 'the last good counts unreadable (not a 404) → the run fails, never a silent pass');
rmSync(d, { recursive: true, force: true });

// the pipeline wiring
const y = readFileSync(join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');
const step = name => { const i = y.indexOf(`- name: ${name}`); if (i < 0) return ''; const j = y.indexOf('\n      - name:', i + 1); return y.slice(i, j < 0 ? undefined : j); };
const ex = step("Export the archive's Pinnacle closes (fail-closed)"), ap = step('Export the Pinnacle (approx.) snapshots (fail-closed)'),
  fd = step("Feed the archive's Pinnacle closes into the Database (fail-closed)"), al = step('Alert — the Pinnacle archive gate failed (Telegram)');
ok(ex && ap && fd && al, 'the four steps exist');
ok(![ex, ap, fd].some(s => /\|\| true|\|\| rc=\$\?|step-check\.mjs/.test(s)), 'none of the archive steps tolerates a failure (no || true, no || rc=$?, no best-effort step-check)');
ok(/pinarch\.py export[^\n]*exit 1/.test(ex) && /approx-feed[^\n]*exit 1/.test(ap) && /td-feed[^\n]*exit 1/.test(fd) && /build-database-yield\.js[^\n]*exit 1/.test(fd), 'export, snapshot export, feed and build each exit 1 on failure');
ok(/node tools\/archive-gate\.mjs --dir \. --baseline-url https:\/\/michaeldk1996\.github\.io\/SAAS\/database-yield-master-meta\.json/.test(fd), 'the gate runs after the build against the published counts');
ok(/if: failure\(\) && hashFiles\('\.archive-failed'\) != ''/.test(al) && /api\.telegram\.org/.test(al) && /TELEGRAM_BOT_TOKEN/.test(al), 'a failure sends the Telegram alert');
const up = y.indexOf('name: site-data');
ok(up < 0 || y.indexOf("- name: Feed the archive's Pinnacle closes") < up, 'the gate runs before the site-data upload');
ok(/cp database-yield-x\.json database-yield-master-meta\.json _site\//.test(y) && !/database-yield-x\.json not built this run/.test(y), 'the era shard and the counts are copied with no missing-file fallback');

console.log(`\ntest-archive-gate: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
