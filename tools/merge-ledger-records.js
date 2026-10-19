#!/usr/bin/env node
'use strict';
// Fold one ledger's records into another, by key (commit-back re-merge, founder 2026-10-19).
//   node tools/merge-ledger-records.js <file: main's copy, rewritten> <ours: this run's copy>
// Both are { rule, records: { key: row } } (series-outcomes.json). This run's row wins on a shared key
// (the build's own rule: the same match re-judged overwrites). A file with another rule marker than
// ours is refused (exit 2): a migration is never merged row by row. Written tmp + rename.
const fs = require('fs');
const [file, oursFile] = process.argv.slice(2);
if (!file || !oursFile) { console.error('usage: merge-ledger-records.js <file> <ours>'); process.exit(2); }
const ours = JSON.parse(fs.readFileSync(oursFile, 'utf8'));
let main = null;
try { main = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
if (!ours || typeof ours.records !== 'object' || Array.isArray(ours.records)) { console.error('merge-ledger-records: ours has no records object'); process.exit(2); }
if (main && (typeof main.records !== 'object' || Array.isArray(main.records) || main.rule !== ours.rule)) {
  console.error(`merge-ledger-records: main's ${file} carries rule ${JSON.stringify(main && main.rule)}, ours ${JSON.stringify(ours.rule)} - refusing`); process.exit(2);
}
const out = Object.assign({}, main || {}, ours, { records: Object.assign({}, main ? main.records : {}, ours.records) });
const added = Object.keys(out.records).length - (main ? Object.keys(main.records).length : 0);
fs.writeFileSync(file + '.tmp', JSON.stringify(out));
fs.renameSync(file + '.tmp', file);
console.log(`merge-ledger-records: ${file} ${Object.keys(out.records).length} records (+${added} from this run)`);
