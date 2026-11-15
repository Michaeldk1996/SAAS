'use strict';
// The tournament page's surviving data rules (founder brief 2026-10-25, round 2). SLICES the real page functions out of the
// dashboard and runs them on fixtures; every check names the mutation that turns it red.
//   · every listed event: the court-speed registry + the listUnrated catalog rows (Brussels, Lyon (France) — no sheet row);
//   · a card resolves to its event by its own tournamentKey (Lyon 2026 → 'Lyon (France)', never the clay 'Lyon');
//   · the header counts the Overview's own list; the Stats tab stays gone.
// RETIRED 2026-11-15 (founder rulings 1 + 5, Tournaments tab rebuild): the Stats tab (How it plays, Favourites vs underdogs
// by round, Points to defend — tpStatsPanelHtml, tpHowItPlaysHtml, tpFavDogHtml, tpPointsDefendHtml, tpData, TP_SAMPLE_FLOOR)
// and the old Overview panel / rail (tourxConditionsPanelHtml, tourxOverviewListHtml) are deleted; their checks went with them.
// The builders keep their own suites (test-how-it-plays.js, test-favourites-by-round.js, test-points-to-defend.js); the new
// Overview is locked by tools/test-tt-overview.mjs.
// Run: node tools/test-tournament-page.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, got !== undefined ? '| got: ' + JSON.stringify(got).slice(0, 300) : ''); } };
const html = fs.readFileSync(path.join(__dirname, '..', 'bsp-consult-dashboard.html'), 'utf8');
function grab(name) {
  const i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing function ' + name);
  let d = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1); }
  throw new Error('unbalanced ' + name);
}
const constBlock = (name, end) => { const i = html.indexOf('const ' + name + ' = '); if (i < 0) throw new Error('missing ' + name); return html.slice(i, html.indexOf(end, i) + end.length); };
const catalogSrc = constBlock('TOURNAMENT_CATALOG', '\n];\n');

console.log('=== a card finds its event by its own key ===');
const box = { tourxEventName: n => n };
vm.createContext(box);
vm.runInContext(catalogSrc + '\n' + ['tpEventLabel', 'tpEventOfCard'].map(grab).join('\n') + '\nthis.T = { tpEventOfCard };', box);
// Mutation: resolve cards by venue city only → Lyon 2026 opens the clay Lyon → red.
ok('a Lyon 2026 card (tournamentKey 14763) resolves to Lyon (France); a keyless Lyon card to the city', box.T.tpEventOfCard({ tournamentKey: '14763', venue: { city: 'Lyon' } }) === 'Lyon (France)'
  && box.T.tpEventOfCard({ venue: { city: 'Lyon' } }) === 'Lyon' && box.T.tpEventOfCard({ tournamentKey: '3669', venue: { city: 'Brussels' } }) === 'Brussels');

console.log('=== the Overview list and the header ===');
{
  const b2 = { COURT_CONDITIONS: { Lyon: { abstractSpeed: 0.7, speed: 29, altitude: 230 }, Almaty: { abstractSpeed: 1.22, speed: 80, altitude: 800 } }, courtSpeedCategory: v => 'x' };
  vm.createContext(b2);
  vm.runInContext(catalogSrc + '\n' + ['tourxConditionRegistry', 'tourxOverviewEvents'].map(grab).join('\n') + '\nthis.E = tourxOverviewEvents();', b2);
  const en = b2.E.map(e => e.name), ly = b2.E.find(e => e.name === 'Lyon (France)');
  // Mutation: drop listUnrated from the catalog → Brussels / Lyon (France) leave the Overview → red.
  ok('Overview list: the rated events + Brussels and Lyon (France) with no speed (dash)', en.includes('Lyon') && en.includes('Almaty') && en.includes('Brussels') && en.includes('Lyon (France)')
    && ly.abstractSpeed === null && en.length === 4, en);
}
ok('the page header names court speed and counts the Overview\'s own list', /Court speed, conditions and market yields/.test(html)
  && /const listed = typeof tourxOverviewEvents === 'function' \? tourxOverviewEvents\(\) : reg;\n  return \{ events: listed\.length,/.test(grab('tourxHeadStatValues')));
// Mutation: the Stats tab back → red (founder 2026-11-15: "never bring it back").
ok('the Stats tab is gone (Overview · Entry list · Draw · Reports)', !/\['stats', 'Stats'\]/.test(grab('renderTournamentsTab')) && !/function tpStatsPanelHtml/.test(html));

console.log(`\ntest-tournament-page: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
