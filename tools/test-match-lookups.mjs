// Founder 2026-11-24. Two page functions, executed from bsp-consult-dashboard.html:
//  · drawStoreFresh — a finished match read from the draw store takes its court figures from the page's court table, not
//    the frozen copy (Paris Masters 55 · Medium against today's 100 · Fast). Control: the pre-fix matchById returns the copy.
//  · sfFinishedMatchId — Tournaments → Reports finds the match a bar opens by both players' keys, the event and the round;
//    a group round (RR1…) is any round-robin match of the pair; two candidates → none.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(process.env.LOOKUPS_HTML || new URL('../bsp-consult-dashboard.html', import.meta.url), 'utf8');
const sl = n => { const s = html.indexOf(`function ${n}(`); assert.ok(s > 0, n); let d = 0, i = html.indexOf('{', s); for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; } return html.slice(s, i + 1); };
const has = n => html.includes(`function ${n}(`);
const cst = n => { const a = html.indexOf(`\nconst ${n} = `) + 1; assert.ok(a > 0, n); return html.slice(a, html.indexOf(';\n', a) + 1); };
const env = new Function('matches', '_drawMatchStore', `
  const COURT_CONDITIONS = { Paris: { speed: 100, abstractSpeed: 1.44 }, Turin: { speed: 94 } }, TOURNAMENT_CATALOG = [], tourxMarketData = null;
  ${cst('PG_RDS')}
  ${['courtSpeedCategory', 'trKeyOf', 'ppCleanTournamentName', 'fhTournClean', 'psNormTour', 'psRoundAbbr', 'h2hRoundLabel', 'pgTourName'].map(sl).join('\n')}
  ${has('pgSameEvent') ? sl('pgSameEvent') : ''}
  ${has('drawStoreFresh') ? sl('drawStoreFresh') : ''}
  ${has('sfFinishedMatchId') ? sl('sfFinishedMatchId') : 'const sfFinishedMatchId = null;'}
  ${sl('matchById')}
  return { matchById, sfFinishedMatchId };`);
const frozen = { id: 'past-1', tour: 'ATP Paris', finalScore: { display: '6-4, 6-4' }, courtSpeed: { speed: 55, category: 'Medium' } };
const L = env([], { matches: { 'past-1': { match: frozen } } });
const m = L.matchById('past-1');
assert.equal(m.courtSpeed.speed, 100, 'court figures read from the page table, not the frozen copy');
assert.equal(m.courtSpeed.category, 'Fast');
let ok = 2;
// Reports finder on the ATP Finals: Zverev (1980) met Alcaraz (2382) in the group AND the final
const fin = (id, rd, tour) => ({ id, tour, tournamentRound: rd, p1Key: 1980, p2Key: 2382, finalScore: { display: '' } });
const F = env([fin('past-9', 'ATP Finals - Turin - Final', 'ATP Finals')],
  { matches: { 'past-8': { match: fin('past-8', '', 'ATP Finals - Turin') }, 'past-7': { match: Object.assign(fin('past-7', '', 'ATP Finals - Turin'), { p2Key: 9 }) } } });
assert.equal(F.sfFinishedMatchId('2382', '1980', 'Finals', 'F'), 'past-9', 'the final, keys in either order');
assert.equal(F.sfFinishedMatchId('1980', '2382', 'Finals', 'RR2'), 'past-8', 'a group round = their group match');
assert.equal(F.sfFinishedMatchId('1980', '2382', 'Finals', 'SF'), null, 'no such match → nothing opens');
assert.equal(F.sfFinishedMatchId('1980', '2382', 'Paris', 'F'), null, 'another event → nothing');
const two = env([fin('past-5', '', 'ATP Finals - Turin'), fin('past-6', '', 'ATP Finals - Turin')], null);
assert.equal(two.sfFinishedMatchId('1980', '2382', 'Finals', 'RR1'), null, 'two candidates → none');
ok += 5;
console.log(`test-match-lookups: ${ok} passed`);
