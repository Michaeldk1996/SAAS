// TEN-270 C — a Cancelled fixture (withdrawal / lucky-loser swap) is never an
// upcoming card. Drives the REAL predicate exported by bsp-pipeline.js and the
// REAL filter source, so removing either the predicate or its call turns this red.
'use strict';
const fs = require('fs');
const path = require('path');
const { isCancelledFixture } = require('../bsp-pipeline.js');
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n); } };

ok(isCancelledFixture({ event_status: 'Cancelled' }) === true,
   "api-tennis 'Cancelled' (e.g. N. Borges vs C. Ugo Carabelli, event 12164720) is cancelled");
for (const s of ['', 'Finished', 'Retired', 'Walk Over', 'Set 1', 'Interrupted', undefined])
  ok(isCancelledFixture({ event_status: s }) === false, `status ${JSON.stringify(s)} is not cancelled`);

// The predicate must actually be applied where upcoming cards are chosen.
const src = fs.readFileSync(path.join(__dirname, '..', 'bsp-pipeline.js'), 'utf8');
const start = src.indexOf('const upcomingFixtures = apiTennisFixtures.filter(');
const body = start >= 0 ? src.slice(start, src.indexOf('});', start)) : '';
ok(start >= 0, 'the upcoming-fixture filter exists');
ok(/if \(isCancelledFixture\(f\)\) return false;/.test(body),
   'the upcoming-fixture filter drops Cancelled fixtures');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
