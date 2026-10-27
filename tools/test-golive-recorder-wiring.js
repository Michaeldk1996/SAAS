// The live-flip recorder survives a go-live (2026-10-26). supabase-live-golive.yml re-applies poller_rpc.sql, which
// re-creates write_snapshot WITHOUT the record_live_flips call; the 2026-10-24 06:47:50Z go-live did exactly that and
// live_flip_log got no rows for two days. Lock: of the files the go-live applies, the LAST one that defines
// write_snapshot must be the one that calls the recorder, and the recorder's own migration must be applied before it.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const WF = '.github/workflows/supabase-live-golive.yml';

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

function verdict(wfText) {
  const applied = [...wfText.matchAll(/^\s*apply\s+(\S+\.sql)\s*$/gm)].map(m => m[1]);
  const defines = f => /create\s+or\s+replace\s+function\s+public\.write_snapshot\s*\(/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  const writers = applied.filter(defines);
  if (!writers.length) return 'no applied file defines write_snapshot';
  const last = writers[writers.length - 1];
  if (!/record_live_flips\s*\(/.test(fs.readFileSync(path.join(ROOT, last), 'utf8'))) return `last write_snapshot (${last}) does not call record_live_flips`;
  const rec = applied.findIndex(f => /create\s+or\s+replace\s+function\s+public\.record_live_flips\s*\(/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  if (rec < 0 || rec > applied.lastIndexOf(last)) return 'record_live_flips is not applied before the write_snapshot that calls it';
  // played-start-recorder (founder 2026-10-26): the LAST record_live_flips body applied must hand ticks to the played
  // recorder, whose own migration is applied before it — else a re-run brings back "a live flag is a start".
  const recs = applied.filter(f => /create\s+or\s+replace\s+function\s+public\.record_live_flips\s*\(/i.test(read(f)));
  const lastRec = recs[recs.length - 1];
  if (!/public\.record_live_flips_played\s*\(/.test(read(lastRec))) return `last record_live_flips (${lastRec}) does not use the played recorder`;
  const played = applied.findIndex(f => /create\s+or\s+replace\s+function\s+public\.record_live_flips_played\s*\(/i.test(read(f)));
  if (played < 0 || played > applied.lastIndexOf(lastRec)) return 'record_live_flips_played is not applied before the record_live_flips that calls it';
  return null;
}

const wf = fs.readFileSync(path.join(ROOT, WF), 'utf8');
assert.strictEqual(verdict(wf), null, `${WF}: ${verdict(wf)}`);
console.log('  ok  the go-live leaves write_snapshot calling the recorder');

// Failing control: the pre-fix go-live (recorder lines removed) must be refused, or the check above is vacuous.
const preFix = wf.replace(/^\s*apply supabase\/migrations\/20260917100[01]00_[a-z_]+\.sql\s*\n/gm, '');
assert.notStrictEqual(preFix, wf, 'control could not remove the recorder lines');
assert.match(String(verdict(preFix)), /does not call record_live_flips/);
console.log('  ok  control: the pre-fix go-live is refused');
// and a reordering (recorder before poller_rpc) is refused too
const reordered = wf.replace(/(^\s*apply supabase\/migrations\/20260829021600_poller_rpc\.sql\s*\n)((?:.*\n)*?)(^\s*apply supabase\/migrations\/20260917100100_write_snapshot_flip\.sql\s*\n)/m, '$3$2$1');
assert.notStrictEqual(reordered, wf, 'control could not reorder');
assert.ok(verdict(reordered), 'a go-live that re-applies poller_rpc after the recorder wiring must be refused');
console.log('  ok  control: poller_rpc after the recorder wiring is refused');

// played-start controls: dropping the switch, or re-applying the old recorder after it, must be refused
const noSwitch = wf.replace(/^\s*apply supabase\/migrations\/20261027090100_record_live_flips_played\.sql\s*\n/m, '');
assert.notStrictEqual(noSwitch, wf, 'control could not remove the played switch');
assert.match(String(verdict(noSwitch)), /does not use the played recorder/);
console.log('  ok  control: a go-live without the played switch is refused');
const oldLast = wf.replace(/^(\s*apply supabase\/migrations\/20261027090100_record_live_flips_played\.sql\s*\n)/m, '$1          apply supabase/migrations/20260917100000_live_flip_log.sql\n');
assert.notStrictEqual(oldLast, wf, 'control could not append the old recorder');
assert.ok(verdict(oldLast), 'the old recorder re-applied after the played switch must be refused');
console.log('  ok  control: the old recorder re-applied after the switch is refused');

// the install path: the played harness runs before the switch, and the switch comes after the additive migration
const inst = fs.readFileSync(path.join(ROOT, '.github/workflows/ten225-live-flip.yml'), 'utf8');
const at = s2 => inst.indexOf(s2);
assert.ok(at('20261027090000_live_flip_played.sql') > 0 && at('test-live-flip-played.sql') > at('20261027090000_live_flip_played.sql')
  && at('20261027090100_record_live_flips_played.sql') > at('test-live-flip-played.sql'),
  'ten225-live-flip.yml install: additive migration, then the played harness, then the switch');
console.log('  ok  install order: additive -> played harness -> switch');
// the harness keeps every named mutant (a removed mutant is a retired test)
const h = fs.readFileSync(path.join(ROOT, 'test-live-flip-played.sql'), 'utf8');
for (const m of ['T_IGNORED', 'CUT_AT_PLAY_SEEN', 'FLAG_IS_START', 'PENDING_KEPT_ON_DROP', 'NO_PLAY_SEEN_AT', 'SAME_TICK_KEEPS_BOUND'])
  assert.ok(new RegExp("\\('" + m + "',").test(h), 'harness mutant ' + m + ' is missing');
assert.match(h, /MUTANT % SURVIVED/);
assert.match(h, /^rollback;\s*$/m, 'the harness must always roll back');
console.log('  ok  harness: six named mutants, survivors raise, always rolled back');

// False 0-0 starts (founder 2026-10-27): the go-live can neither drop nor re-create the superseded-start sidecar or the
// live_flip_log_current view, nor drop live_flip_log columns, nor apply an old reader. Lock: no file it applies does any
// of that (the sidecar migration itself excepted for its own create-or-replace view); the sidecar migration is applied
// after every file that creates live_flip_log; and none of the 7 start readers is among the files it applies.
const SUP = 'supabase/migrations/20261027120000_live_flip_superseded.sql';
const READERS = ['ten225-kibl-card-state.py', 'tools/pinarch.py', 'ten225-load-line-summary.py', 'tools/ten294-drops-api.sql',
  'tools/ten299-live-cut.sql', 'tools/tdarch.py', 'tools/archive-fill-probe.py'];
function supVerdict(wfText, readFile = read) {
  const applied = [...wfText.matchAll(/^\s*apply\s+(\S+\.sql)\s*$/gm)].map(m => m[1]);
  const bad = [];
  for (const f of applied) {
    const t = readFile(f);
    if (/\b(drop|truncate)\s+(table|view)?\s*(if\s+exists\s+)?(public\.)?live_flip_log(_superseded|_current)?\b/i.test(t)) bad.push(`${f} drops/truncates a live-flip object`);
    if (/\btruncate\s+(table\s+)?(public\.)?live_flip_log/i.test(t)) bad.push(`${f} truncates live_flip_log`);
    if (/alter\s+table\s+(if\s+exists\s+)?(public\.)?live_flip_log(_superseded)?\s+drop\b/i.test(t)) bad.push(`${f} drops a live-flip column`);
    if (/delete\s+from\s+(public\.)?live_flip_log(_superseded)?\b/i.test(t)) bad.push(`${f} deletes live-flip rows`);
    if (f !== SUP && /create\s+(or\s+replace\s+)?view\s+(public\.)?live_flip_log_current\b/i.test(t)) bad.push(`${f} re-creates live_flip_log_current`);
    if (f !== SUP && /create\s+table[^;]*live_flip_log_superseded/i.test(t)) bad.push(`${f} creates live_flip_log_superseded`);
  }
  if (bad.length) return bad.join('; ');
  const at = applied.indexOf(SUP);
  if (at < 0) return 'the go-live does not apply the superseded-start migration';
  const creators = applied.map((f, i) => [f, i]).filter(([f]) => /create\s+table\s+if\s+not\s+exists\s+public\.live_flip_log\s*\(/i.test(readFile(f)));
  if (creators.some(([, i]) => i > at)) return 'a file that creates live_flip_log is applied after the superseded-start migration';
  const old = applied.filter(f => READERS.includes(f));
  if (old.length) return `the go-live applies a start reader (${old.join(', ')})`;
  return null;
}
assert.strictEqual(supVerdict(wf), null, `${WF}: ${supVerdict(wf)}`);
console.log('  ok  the go-live keeps the superseded-start sidecar, its view and the readers');
// controls: each way the go-live could undo it is refused
const noSup = wf.replace(/^\s*apply supabase\/migrations\/20261027120000_live_flip_superseded\.sql\s*\n/m, '');
assert.notStrictEqual(noSup, wf, 'control could not remove the sidecar migration');
assert.match(String(supVerdict(noSup)), /does not apply the superseded-start migration/);
const recreatedAfter = wf.replace(/^(\s*apply supabase\/migrations\/20261027120000_live_flip_superseded\.sql\s*\n)/m, '$1          apply supabase/migrations/20260917100000_live_flip_log.sql\n');
assert.match(String(supVerdict(recreatedAfter)), /applied after the superseded-start migration/);
const withReader = wf.replace(/^(\s*apply supabase\/migrations\/20261027120000_live_flip_superseded\.sql\s*\n)/m, '$1          apply tools/ten299-live-cut.sql\n');
assert.match(String(supVerdict(withReader)), /applies a start reader/);
const dropper = f => (f === 'supabase/migrations/20260917100000_live_flip_log.sql' ? read(f) + '\ndrop view if exists public.live_flip_log_current;\n' : read(f));
assert.match(String(supVerdict(wf, dropper)), /drops\/truncates a live-flip object/);
const colDrop = f => (f === 'supabase/migrations/20261027090000_live_flip_played.sql' ? read(f) + '\nalter table public.live_flip_log drop column play_seen_at;\n' : read(f));
assert.match(String(supVerdict(wf, colDrop)), /drops a live-flip column/);
const sideDel = f => (f === 'supabase/migrations/20261027090000_live_flip_played.sql' ? read(f) + '\ndelete from public.live_flip_log_superseded;\n' : read(f));
assert.match(String(supVerdict(wf, sideDel)), /deletes live-flip rows/);
console.log('  ok  controls: no sidecar / live_flip_log re-created after it / a reader applied / a drop / a column drop / a delete — each refused');
