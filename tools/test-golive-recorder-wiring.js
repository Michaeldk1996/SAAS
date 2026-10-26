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

function verdict(wfText) {
  const applied = [...wfText.matchAll(/^\s*apply\s+(\S+\.sql)\s*$/gm)].map(m => m[1]);
  const defines = f => /create\s+or\s+replace\s+function\s+public\.write_snapshot\s*\(/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  const writers = applied.filter(defines);
  if (!writers.length) return 'no applied file defines write_snapshot';
  const last = writers[writers.length - 1];
  if (!/record_live_flips\s*\(/.test(fs.readFileSync(path.join(ROOT, last), 'utf8'))) return `last write_snapshot (${last}) does not call record_live_flips`;
  const rec = applied.findIndex(f => /create\s+or\s+replace\s+function\s+public\.record_live_flips\s*\(/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  if (rec < 0 || rec > applied.lastIndexOf(last)) return 'record_live_flips is not applied before the write_snapshot that calls it';
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
