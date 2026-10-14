#!/usr/bin/env node
// F2 (founder ruling 2026-10-14): Record per tournament set scores come from career-history for EVERY row, all years —
// not only from recentForm (this season + last 10). Synthetic Musetti fixture: Shanghai 2023-2026, recentForm empty.
// Control: with career-history rows carrying no `sets`, every row is a dash (the pre-F2 state on 2023-2025).
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
function load(chRows, rf) {
  const p = { key: '2849', name: 'L. Musetti', recentForm: { matches: rf || [] }, tournamentHistory: [{
    name: 'Shanghai', won: 2, lost: 4, editions: [
      { year: 2026, finish: 'Round of 64', matches: [{ res: 'L', round: 'R64', opp: 'Y. Zhou', oppKey: '39862', score: '1 - 2' }] },
      { year: 2025, finish: 'Round of 16', matches: [{ res: 'W', round: 'R64', opp: 'F. Comesana', score: '2 - 0' }, { res: 'W', round: 'R32', opp: 'L. Darderi', score: '2 - 0' }, { res: 'L', round: 'R16', opp: 'F. Auger-Aliassime', score: '0 - 2' }] },
      { year: 2024, finish: 'Round of 64', matches: [{ res: 'L', round: 'R64', opp: 'D. Goffin', score: '1 - 2' }] },
      { year: 2023, finish: 'Round of 64', matches: [{ res: 'L', round: 'R64', opp: 'Y. H. Hsu', score: '0 - 2' }] } ] }] };
  const sb = { FEATURE_PP2: true, playerProfiles: { players: { 2849: p } }, careerHistory: { 2849: chRows }, TournamentIdentity: require('../tournament-identity.js') };
  global.window = sb;
  new Function('window', fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8'))(sb);
  const I = sb.PlayerProfileV2._internals;
  const rows = {};
  I.tournViews(I.profileFor('2849')).forEach(t => t.editions.forEach(e => e.matches.forEach(m => { rows[e.year + ' ' + m.opp] = m; })));
  return rows;
}
const CH = [
  { year: 2026, date: '2026-10-09', tournament: 'Shanghai', round: '1/32-finals', opponent: 'Y. Zhou', won: false, eventKey: 12169254, sets: [{ p: 6, o: 7, pTb: 5, oTb: 7 }, { p: 6, o: 3 }, { p: 4, o: 6 }] },
  { year: 2025, date: '2025-10-08', tournament: 'Shanghai', round: '1/8-finals', opponent: 'F. Auger-Aliassime', won: false, sets: [{ p: 4, o: 6 }, { p: 2, o: 6 }] },
  { year: 2025, date: '2025-10-06', tournament: 'Shanghai', round: '1/16-finals', opponent: 'L. Darderi', won: true, sets: [{ p: 7, o: 5 }, { p: 7, o: 6, pTb: 7, oTb: 1 }] },
  { year: 2025, date: '2025-10-04', tournament: 'Shanghai', round: '1/32-finals', opponent: 'F. Comesana', won: true, sets: [{ p: 6, o: 4 }, { p: 6, o: 0 }] },
  { year: 2024, date: '2024-10-07', tournament: 'ATP Shanghai', round: '1/32-finals', opponent: 'D. Goffin', won: false, sets: [{ p: 6, o: 1 }, { p: 6, o: 7, pTb: 6, oTb: 8 }, { p: 2, o: 6 }] },
  { year: 2023, date: '2023-10-06', tournament: 'ATP Shanghai', round: '1/32-finals', opponent: 'Y. H. Hsu', won: false, sets: [{ p: 3, o: 6 }, { p: 4, o: 6 }] } ];
let pass = 0;
const r = load(CH);
const want = { '2026 Y. Zhou': '6-7(5), 6-3, 4-6', '2025 F. Auger-Aliassime': '4-6, 2-6', '2025 L. Darderi': '7-5, 7-6(1)', '2025 F. Comesana': '6-4, 6-0',
               '2024 D. Goffin': '6-1, 6-7(6), 2-6', '2023 Y. H. Hsu': '3-6, 4-6' };
for (const [k, v] of Object.entries(want)) { assert.strictEqual(r[k] && r[k].setScores, v, k); pass++; }
assert.strictEqual(r['2026 Y. Zhou'].date, '2026-10-09', 'the 2026 row is dated from career-history'); pass++;
// control: career rows without sets → dashes (null) on every row with no recentForm match
const r0 = load(CH.map(x => Object.assign({}, x, { sets: undefined })));
assert.ok(Object.values(r0).every(m => !m.setScores), 'control: no sets in career-history → no set scores'); pass++;
// mutant: the F2 line removed from the module must turn the main check red
const src = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
assert.ok(/if \(c\.sets && c\.sets\.length\) e\.setScores = setScoreText\(c, ', '\);/.test(src), 'F2 line present'); pass++;
console.log(`test-f2-set-scores: ${pass} checks passed`);
