// Mutants for tools/test-early-cut-marker.mjs: each copies the files the chain runs on into a temp root, breaks ONE rule,
// and runs the suite there — it must go red. A mutant whose anchor is gone is a FAILED mutant (never a catch).
// Run: node tools/test-early-cut-marker-mutants.mjs
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const FILES = ['bsp-consult-dashboard.html', 'build-database-yield.js', 'settlement.js', 'td-identity.js', 'build-odds-performance.js', 'market-edge-core.js',
  'build-market-edge.js', 'tools/pinarch.py'];
const MUTANTS = [
  ['tools/pinarch.py', 'the export drops the cut', "            out[-1]['closeCut'] = fc\n", '            pass\n'],
  ['tools/pinarch.py', 'the feed label ignores the buffer', 'return f"{EARLY_CUT_LABEL} {e[\'bufferMin\']}"', "return e.get('label')"],
  ['build-database-yield.js', 'the builder reads "early cut" as an unknown label', '  if (!m) return undefined;\n  earlyMinutes.add(+m[1]);\n  return EARLY_BOOK;', '  return undefined;'],
  ['build-database-yield.js', 'book 9 counted as a Pinnacle close', 'const isPinIdx = i => i === 0 || i === 3 || i === 4;', 'const isPinIdx = i => i === 0 || i === 3 || i === 4 || i === 9;'],
  ['build-database-yield.js', 'two buffers accepted', 'if (earlyMinutes.size > 1) {', 'if (false) {'],
  ['build-database-yield.js', 'the tooltip text changed', "min before Oddspapi's recorded start. True closing price unavailable.`", 'min before the start`'],
  ['build-database-yield.js', 'no earlyCut meta on the master', "'Pinnacle early cut (not a close)' }, ...EARLY_META,", "'Pinnacle early cut (not a close)' },"],
  ['bsp-consult-dashboard.html', 'the join leaves book 9 as Bet365', "      if (bk === 9) { r.book = 'A'; r.src = 'early'; r.srcLabel = (db.meta && db.meta.earlyCut && db.meta.earlyCut.hover) || undefined; }\n", ''],
  ['bsp-consult-dashboard.html', 'the marker never draws E', "r.book === 'A' && r.src === 'early' ? 'E' : ''", "''"],
  ['bsp-consult-dashboard.html', 'the hover names the approx. snapshot instead', "r && r.book === 'A' && r.src === 'early' ? (r.srcLabel || sfEarlyHover()) : ", ''],
  ['bsp-consult-dashboard.html', 'a Market edge early row never reads the join (its own words)', "return (j && j.meta && j.meta.earlyCut && j.meta.earlyCut.hover) || SF_EARLY_HOVER_NO_X;", 'return SF_EARLY_HOVER_NO_X;'],
  ['bsp-consult-dashboard.html', 'the price cell draws only B', "const bm = mark && !dash ? fhPxMark(r) : '';", "const bm = mark && !dash && r && r.book === 'B' ? 'B' : '';"],
  ['bsp-consult-dashboard.html', 'one hMark site left on the B-only rule', 'hTitle: trPxTitle(r), aTitle: trPxTitle(r), hMark: fhPxMark(r),', "hTitle: trPxTitle(r), aTitle: trPxTitle(r), hMark: r.price != null && r.book === 'B' ? 'B' : '',"],
  ['build-market-edge.js', 'Market edge has no book 9', "  9: ['pinnacle-early', 'Pinnacle (early cut, not a close)'],\n", ''],
];
let caught = 0, bad = 0;
for (const [file, name, from, to] of MUTANTS) {
  const d = mkdtempSync(join(tmpdir(), 'earlym-'));
  mkdirSync(join(d, 'tools'));
  for (const f of FILES) copyFileSync(join(ROOT, f), join(d, f));
  copyFileSync(join(HERE, 'test-early-cut-marker.mjs'), join(d, 'tools', 'test-early-cut-marker.mjs'));
  const src = readFileSync(join(d, file), 'utf8');
  if (!src.includes(from)) { console.log(`  FAIL  mutant ${name}: anchor gone`); bad++; rmSync(d, { recursive: true, force: true }); continue; }
  writeFileSync(join(d, file), src.split(from).join(to));
  const r = spawnSync(process.execPath, [join(d, 'tools', 'test-early-cut-marker.mjs')], { encoding: 'utf8', env: { ...process.env, EARLY_ROOT: d } });
  const red = r.status !== 0;
  const first = (r.stdout.split('\n').find(l => l.includes('FAIL')) || '').trim();
  console.log(`  ${red ? 'PASS' : 'FAIL'}  mutant caught: ${name}${red ? '  (' + first.replace(/^FAIL\s+/, '') + ')' : ' — SURVIVED'}`);
  if (red) caught++; else bad++;
  rmSync(d, { recursive: true, force: true });
}
// control: the unmutated copy is green (so a red above is the mutant, not the harness)
{
  const d = mkdtempSync(join(tmpdir(), 'earlym-')); mkdirSync(join(d, 'tools'));
  for (const f of FILES) copyFileSync(join(ROOT, f), join(d, f));
  copyFileSync(join(HERE, 'test-early-cut-marker.mjs'), join(d, 'tools', 'test-early-cut-marker.mjs'));
  const r = spawnSync(process.execPath, [join(d, 'tools', 'test-early-cut-marker.mjs')], { encoding: 'utf8', env: { ...process.env, EARLY_ROOT: d } });
  console.log(`  ${r.status === 0 ? 'PASS' : 'FAIL'}  control: the unmutated copy is green`); if (r.status !== 0) { bad++; console.log(r.stdout.slice(-600)); }
  rmSync(d, { recursive: true, force: true });
}
console.log(`\ntest-early-cut-marker-mutants: ${caught}/${MUTANTS.length} caught, ${bad} failed`);
process.exit(bad ? 1 : 0);
