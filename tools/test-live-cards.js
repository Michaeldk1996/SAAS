// Ruling 4 (founder 2026-10-20): the run fails when api-tennis shows main-draw matches in play but matches.json has 0
// live cards. liveCardCheck (bsp-pipeline.js) + tools/check-live-cards.mjs + the pipeline.yml step order.
// Run: node tools/test-live-cards.js
'use strict';
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
process.env.API_TENNIS_KEY = process.env.API_TENNIS_KEY || 'test';
const { liveCardCheck } = require(path.join(ROOT, 'bsp-pipeline.js'));
let pass = 0, fail = 0;
const check = (l, c, d) => { if (c) { pass++; console.log(`  ok   ${l}`); } else { fail++; console.log(`  FAIL ${l}${d ? `\n       ${d}` : ''}`); } };
console.log('Live-card check');
const fx = (o) => Object.assign({ event_key: 1, event_live: '1', event_status: 'Set 2', event_qualification: 'False', event_first_player: 'A. One', event_second_player: 'B. Two', tournament_name: 'Lyon' }, o);
// the 20 Oct 13:4xZ state (B8): 3 in play, 0 live cards
const gap = liveCardCheck([fx({ event_key: 1 }), fx({ event_key: 2 }), fx({ event_key: 3 })], [{ live: false }, { live: false }]);
check('B8 state (3 in play, 0 live cards) → not ok', gap.ok === false && gap.apiLiveCount === 3 && gap.cardsLive === 0);
check('carded → ok', liveCardCheck([fx({})], [{ live: true }]).ok === true);
check('nothing in play → ok (nothing to compare)', liveCardCheck([fx({ event_live: '0' })], []).ok === true);
check('decided with a lagging live flag is not "in play"', liveCardCheck([fx({ event_status: 'Finished' })], []).apiLiveCount === 0);
check('qualifying in play does not count (never carded)', liveCardCheck([fx({ event_qualification: 'True' })], []).apiLiveCount === 0);
check('interrupted does not count (built by the completed-match path)', liveCardCheck([fx({ event_status: 'Interrupted' })], []).apiLiveCount === 0);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-'));
const run = (obj) => { const f = path.join(tmp, 'lc.json'); if (obj) fs.writeFileSync(f, JSON.stringify(obj)); else if (fs.existsSync(f)) fs.unlinkSync(f);
  return spawnSync(process.execPath, [path.join(ROOT, 'tools', 'check-live-cards.mjs'), f], { encoding: 'utf8' }); };
let r = run({ checkedAt: 'x', ...gap });
check('checker exits 1 with a ::error on the gap', r.status === 1 && /::error title=Live-card check::api-tennis shows 3/.test(r.stdout), r.stdout);
r = run({ checkedAt: 'x', ...liveCardCheck([fx({})], [{ live: true }]) });
check('checker exits 0 when in-play matches are carded', r.status === 0);
r = run(null);
check('checker exits 1 when live-check.json is missing (the pipeline did not report)', r.status === 1);
const y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pipeline.yml'), 'utf8');
const iRun = y.indexOf('run: node run-pipeline.js github-actions'), iChk = y.indexOf('run: node tools/check-live-cards.mjs'), iUp = y.indexOf('name: site-data');
check('pipeline.yml runs the check right after the pipeline and before site-data is uploaded', iRun > 0 && iChk > iRun && (iUp < 0 || iChk < iUp), `${iRun} ${iChk} ${iUp}`);
const src = fs.readFileSync(path.join(ROOT, 'bsp-pipeline.js'), 'utf8');
check('the pipeline writes live-check.json from the same fetch it builds the cards from', /liveCardCheck\(apiTennisFixtures, matches\)/.test(src));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
