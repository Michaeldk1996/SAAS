#!/usr/bin/env node
// Founder ruling 2026-10-18 (phase 2): no backfill — fix the capture going forward. Every captured Pinnacle row records
// its event key, api-tennis's qualifying flag and the round, so a Challenger / qualifying close can join the master by key.
//   1. build-captured-pinnacle.js: a card carrying tournamentRound / qualifying / tour → the derived row carries round,
//      qualifying and event (mutant: the fold dropped → red);
//   2. bsp-pipeline.js: every board card built from an api-tennis fixture takes `qualifying` from event_qualification;
//   3. tools/pinarch.py: the archive close stores event_qualification with the round and event key (API_FIELDS).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m + (d ? ' — ' + d : '')); } };

function derive(builderSrc) {
  const p = path.join(ROOT, '.mutant-capture-fields.js');
  fs.writeFileSync(p, builderSrc);
  try {
    delete require.cache[require.resolve(p)];
    const B = require(p);
    const T = Date.parse('2026-10-15T10:00:00Z');
    const ev = {};
    B.absorb(ev, [{ id: 'past-12200001', date: '2026-10-15', p1: 'A. Tester', p2: 'B. Alpha', p1Key: 9001, p2Key: 9002, tour: 'Challenger Curitiba',
      tournamentRound: 'Qualification Final', qualifying: true,
      oddsMovement: { chart: { books: { 'Pinnacle +30s': { p1: [[new Date(T - 6e5).toISOString(), 1.5]], p2: [[new Date(T - 6e5).toISOString(), 2.6]] } } } } }]);
    return B.deriveRow('12200001', ev['12200001'], { ms: T, source: 'api-tennis-live' }, T + 864e5);
  } finally { fs.unlinkSync(p); }
}
const SRC = fs.readFileSync(path.join(ROOT, 'build-captured-pinnacle.js'), 'utf8');
const d = derive(SRC);
ok(d.row && d.row.eventKey === 12200001 && d.row.round === 'Qualification Final' && d.row.qualifying === true && d.row.event === 'Challenger Curitiba',
  'a captured Pinnacle row carries its event key, round, qualifying flag and event', JSON.stringify(d));
const anchor = "      if (typeof m.qualifying === 'boolean') o.qualifying = m.qualifying;";
ok(SRC.split(anchor).length === 2, 'the mutant anchor is found once');
const dm = derive(SRC.replace(anchor, ''));
ok(!(dm.row && dm.row.qualifying === true), 'MUTANT (the qualifying flag not folded from the card) turns the check red');
const card = { tournamentRound: '1/16-finals', p1: 'X', p2: 'Y' };
const d2 = (() => { const p = path.join(ROOT, '.mutant-capture-fields.js'); fs.writeFileSync(p, SRC); try { delete require.cache[require.resolve(p)]; const B = require(p); const ev = {};
  B.absorb(ev, [Object.assign({ id: 'past-1', date: '2026-10-15', p1Key: 1, p2Key: 2, oddsMovement: { chart: { books: { 'Pinnacle +30s': { p1: [['2026-10-15T09:00:00Z', 1.5]], p2: [['2026-10-15T09:00:00Z', 2.6]] } } } } }, card)]);
  return B.deriveRow('1', ev['1'], { ms: Date.parse('2026-10-15T10:00:00Z'), source: 'api-tennis-live' }, Date.parse('2026-10-16T10:00:00Z')); } finally { fs.unlinkSync(p); } })();
ok(d2.row && d2.row.qualifying === null && d2.row.round === '1/16-finals', 'a card with no qualifying flag (an older matches.json) records null, never a guessed false', JSON.stringify(d2));

const PIPE = fs.readFileSync(path.join(ROOT, 'bsp-pipeline.js'), 'utf8');
ok((PIPE.match(/qualifying: fixture\.event_qualification === 'True'/g) || []).length === 2 && /match\.qualifying = fixture\.event_qualification === 'True';/.test(PIPE),
  'bsp-pipeline.js: every fixture-built board card takes qualifying from api-tennis event_qualification');
const PA = fs.readFileSync(path.join(ROOT, 'tools/pinarch.py'), 'utf8');
const af = /API_FIELDS = \(([^)]*)\)/.exec(PA);
ok(af && /'event_qualification'/.test(af[1]) && /'tournament_round'/.test(af[1]), 'tools/pinarch.py: every archive close stores event_qualification and the round (API_FIELDS)');
console.log(`\ntest-capture-fields: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
