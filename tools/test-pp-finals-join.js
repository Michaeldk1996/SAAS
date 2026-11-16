#!/usr/bin/env node
// Record per tournament: an event spelled differently in tournamentHistory ("Tour Finals") and career-history
// ("ATP Finals - Turin") still joins on the strong key through tournament-identity.js, so an opponent met twice in a
// season keeps his set scores and date (founder 2026-11-16: Zverev, ATP Finals 2024 — Ruud, Alcaraz, Fritz were
// dashes). Round-robin rows read newest first once every row of the round is dated.
// Control: the same fixture through the module without the identity lookup loses those rows (the pre-fix state).
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const TH = [{ name: 'Tour Finals', won: 3, lost: 1, editions: [{ year: 2024, finish: 'Semi-final', matches: [
  { res: 'W', round: 'RR', opp: 'C. Alcaraz', oppKey: '2382', score: '2 - 0' },
  { res: 'W', round: 'RR', opp: 'C. Ruud', oppKey: '2843', score: '2 - 0' },
  { res: 'W', round: 'RR', opp: 'A. Rublev', oppKey: '1903', score: '2 - 0' },
  { res: 'L', round: 'SF', opp: 'T. Fritz', oppKey: '2832', score: '1 - 2' }] }] },
  { name: 'Rome', won: 1, lost: 0, editions: [{ year: 2024, finish: 'Round of 32', matches: [{ res: 'W', round: 'R32', opp: 'C. Ruud', score: '2 - 0' }] }] },
  { name: 'Madrid', won: 1, lost: 0, editions: [{ year: 2024, finish: 'Round of 32', matches: [{ res: 'W', round: 'R32', opp: 'C. Alcaraz', score: '2 - 0' }] }] },
  { name: 'US Open', won: 1, lost: 0, editions: [{ year: 2024, finish: 'Round of 32', matches: [{ res: 'W', round: 'R32', opp: 'T. Fritz', score: '3 - 0' }] }] }];
const CH = [
  { date: '2024-11-16', tournament: 'ATP Finals - Turin', round: 'Semi-finals', opponent: 'T. Fritz', won: false, sets: [{ p: 6, o: 7, pTb: 5, oTb: 7 }, { p: 6, o: 3 }, { p: 6, o: 7, pTb: 3, oTb: 7 }] },
  { date: '2024-11-15', tournament: 'ATP Finals - Turin', round: '', opponent: 'C. Alcaraz', won: true, sets: [{ p: 7, o: 6, pTb: 7, oTb: 5 }, { p: 6, o: 4 }] },
  { date: '2024-11-13', tournament: 'ATP Finals - Turin', round: '', opponent: 'C. Ruud', won: true, sets: [{ p: 7, o: 6, pTb: 7, oTb: 3 }, { p: 6, o: 3 }] },
  { date: '2024-11-11', tournament: 'ATP Finals - Turin', round: '', opponent: 'A. Rublev', won: true, sets: [{ p: 6, o: 4 }, { p: 6, o: 4 }] },
  { date: '2024-05-14', tournament: 'Rome', round: '1/16-finals', opponent: 'C. Ruud', won: true, sets: [{ p: 6, o: 2 }, { p: 6, o: 4 }] },
  { date: '2024-04-30', tournament: 'Madrid', round: '1/16-finals', opponent: 'C. Alcaraz', won: true, sets: [{ p: 6, o: 1 }, { p: 6, o: 3 }] },
  { date: '2024-08-30', tournament: 'US Open', round: '1/16-finals', opponent: 'T. Fritz', won: true, sets: [{ p: 6, o: 2 }, { p: 6, o: 2 }, { p: 6, o: 2 }] }];
function finals(src) {
  const p = { key: '1980', name: 'A. Zverev', recentForm: { matches: [] }, tournamentHistory: JSON.parse(JSON.stringify(TH)) };
  const sb = { FEATURE_PP2: true, playerProfiles: { players: { 1980: p } }, careerHistory: { 1980: CH }, TournamentIdentity: require('../tournament-identity.js') };
  global.window = sb; new Function('window', src)(sb);
  const I = sb.PlayerProfileV2._internals;
  return I.tournViews(I.profileFor('1980')).find(t => t.name === 'Tour Finals').editions[0].matches;
}
const SRC = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
let pass = 0;
const ms = finals(SRC);
const want = { 'T. Fritz': ['6-7(5), 6-3, 6-7(3)', '2024-11-16'], 'C. Alcaraz': ['7-6(5), 6-4', '2024-11-15'], 'C. Ruud': ['7-6(3), 6-3', '2024-11-13'], 'A. Rublev': ['6-4, 6-4', '2024-11-11'] };
for (const m of ms) { assert.deepStrictEqual([m.setScores, m.date], want[m.opp], m.opp); pass++; }
assert.deepStrictEqual(ms.map(m => m.opp), ['T. Fritz', 'C. Alcaraz', 'C. Ruud', 'A. Rublev'], 'SF first, then the round robin newest first'); pass++;
// a partly dated round keeps the feed order (never half sorted)
const CH0 = CH.slice(); CH.splice(CH.findIndex(r => r.opponent === 'A. Rublev'), 1);
const part = finals(SRC).filter(m => m.round === 'RR').map(m => m.opp);
assert.deepStrictEqual(part, ['A. Rublev', 'C. Ruud', 'C. Alcaraz'], 'an undated RR row keeps the feed order'); pass++;
CH.length = 0; CH0.forEach(r => CH.push(r));
// control: without the identity lookup (the pre-fix evKeyOf) the twice-met opponents are dashes
const ctl = SRC.replace(/if \(TI && TI\.CANONICAL_ALIASES && TI\.CANONICAL_ALIASES\[TI\.identityKey\(s\)\]\) s = TI\.canonicalTournament\(s\)\.display;/, '');
assert.notStrictEqual(ctl, SRC, 'control: the identity line is present'); pass++;
const c = finals(ctl);
assert.ok(['C. Ruud', 'C. Alcaraz', 'T. Fritz'].every(o => !c.find(m => m.opp === o).setScores), 'control: pre-fix join leaves them dashed'); pass++;
console.log(`test-pp-finals-join: ${pass} checks passed`);
