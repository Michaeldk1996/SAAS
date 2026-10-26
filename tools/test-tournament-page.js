'use strict';
// Round 2 (founder brief 2026-10-25) — the tournament page (Tournaments → Overview, one event). SLICES the real page
// functions out of the dashboard and runs them on fixtures; every check names the mutation that turns it red.
//   · founder 2026-10-26: the Overview is the pre-round-2 build again (court speed back); the blocks are on the Stats tab;
//   · every catalog event is listed (Brussels and Lyon (France) have no court-conditions row);
//   · a card resolves to its event by its own tournamentKey (Lyon 2026 → 'Lyon (France)', never the clay 'Lyon');
//   · How it plays (2.1), Favourites by round (2.2), Points to defend (2.3) blocks: n, floor, dashes, no verdict words.
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
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const catalogSrc = constBlock('TOURNAMENT_CATALOG', '\n];\n');
const box = { COURT_CONDITIONS: { Lyon: { abstractSpeed: 0.7, speed: 29, altitude: 230 }, Almaty: { abstractSpeed: 1.22, speed: 80, altitude: 800 } },
  tourxEventName: n => n, tourxRpEsc: s => String(s), tourxEsc: s => String(s), tourxState: {}, tournamentProgression: null, matches: [], document: { getElementById: () => null },
  window: { SfCountryIoc: { of: n => ({ 'Russia': 'RUS', 'Japan': 'JPN', 'France': 'FRA' })[n] || null } } };
vm.createContext(box);
vm.runInContext(catalogSrc + '\n' + constBlock('TP_SAMPLE_FLOOR', "'—');\n") + constBlock('TP_HIP_METRICS', '\n];\n') + constBlock('TP_PTS_SHOW', ';') + '\nconst _tpFileData = {}, _tpFileLoad = {};\n'
  + ['tpPageEvents', 'tpEventLabel', 'tpEventOfCard', 'tpData', 'tpHipEventOf', 'tpHowItPlaysHtml', 'tpFavDogHtml', 'tpPointsKey', 'tpPointsDefendHtml'].map(grab).join('\n')
  + '\nthis.T = { tpPageEvents, tpEventOfCard, tpHowItPlaysHtml, tpFavDogHtml, tpPointsDefendHtml, data: _tpFileData, cat: TOURNAMENT_CATALOG };', box);
const T = box.T;

console.log('=== the page lists every calendar event; a card finds its event by its own key ===');
const names = T.tpPageEvents().map(e => e.name);
// Mutation: list only events with a court-conditions row (the old registry) → Brussels / Lyon (France) missing → red.
ok('Brussels and Lyon (France) are listed though neither has a court-conditions row', names.includes('Brussels') && names.includes('Lyon (France)'));
ok('the clay Lyon keeps its own entry (its data stays), separate from Lyon (France)', names.filter(n => n === 'Lyon').length === 1);
// Mutation: resolve cards by venue city only → Lyon 2026 opens the clay Lyon → red.
ok('a Lyon 2026 card (tournamentKey 14763) resolves to Lyon (France); a keyless Lyon card to the city', T.tpEventOfCard({ tournamentKey: '14763', venue: { city: 'Lyon' } }) === 'Lyon (France)'
  && T.tpEventOfCard({ venue: { city: 'Lyon' } }) === 'Lyon' && T.tpEventOfCard({ tournamentKey: '3669', venue: { city: 'Brussels' } }) === 'Brussels');
ok('the floor is one named constant, 15 (founder default)', /^const TP_SAMPLE_FLOOR = 15;/m.test(html));

console.log('=== Overview restored as before round 2 (founder 2026-10-26); the round-2 blocks live on the Stats tab ===');
const panel = grab('tourxConditionsPanelHtml'), rail = grab('tourxOverviewListHtml'), stats = grab('tpStatsPanelHtml');
// Mutation: drop the hero / slider / rank / prose / trend again → red.
ok('the Overview panel prints the court-speed hero, knob, rank line, Conditions read and speed trend',
  /abstract court speed/.test(panel) && /tourxKnobPct\(as,/.test(panel) && /tourxRankLineHtml\(as\)/.test(panel) && /tourxConditionsProse\(/.test(panel)
  && /\$\{title\}\$\{hero\}\$\{tiles\}\$\{read\}\$\{tourxQuotesCardHtml\(c\)\}\$\{tourxSpeedSeriesHtml\(c\)\}\$\{tourxRoiPairHtml\(c\)\}\$\{tourxReliabilityHtml\(c\)\}\$\{tourxReportCtaHtml\(c\)\}/.test(panel));
// Mutation: drop the Tennis Abstract credit → red.
ok('the "abstract court speed" label credits Tennis Abstract on hover', /class="tourx-as-label"[^>]*title="\$\{asTip\}"/.test(panel) && /Tennis Abstract's court-speed rating \(tennisabstract\.com\)/.test(panel));
// Mutation: an event with no reading prints a number / prose → red (the dash paths must exist).
ok('no reading → a dash in the hero, no knob, no rank line, a dash for the Conditions read', /as == null \? '—' : as\.toFixed\(2\)/.test(panel)
  && /knob == null \? ''/.test(panel) && /as == null \? '' : tourxRankLineHtml\(as\)/.test(panel) && /as == null \? '—' : tourxConditionsProse/.test(panel));
ok('the Altitude / 1st serve point won / Service hold tiles are back', /tile\('Altitude'/.test(panel) && /tile\('1st serve point won'/.test(panel) && /tile\('Service hold'/.test(panel));
ok('the Overview panel no longer carries the round-2 blocks', !/tpPointsDefendHtml|tpHowItPlaysHtml|tpFavDogHtml/.test(panel));
// Mutation: list by tpPageEvents (every catalog event) or sort by name → red.
ok('the rail lists the court-speed registry + listUnrated events, fastest first, speed figure or a dash', /const reg = tourxOverviewEvents\(\);/.test(rail) && /\.sort\(bySpeed\)/.test(rail)
  && /t\.abstractSpeed == null \? '—' : t\.abstractSpeed\.toFixed\(2\)/.test(rail));
ok('the Stats tab carries the three blocks: how it plays, favourites by round, points to defend', /\$\{title\}\$\{tpHowItPlaysHtml\(c\)\}\$\{tpFavDogHtml\(c\)\}\$\{tpPointsDefendHtml\(c\)\}/.test(stats)
  && /\['stats', 'Stats'\]/.test(grab('renderTournamentsTab')) && /tourxState\.section === 'stats' \? tpStatsPanelHtml\(\) : tourxConditionsPanelHtml\(\)/.test(grab('renderTourxOverview')));
ok('the page header names court speed again and counts the Overview\'s own list', /Court speed, conditions and market yields/.test(html)
  && /const listed = typeof tourxOverviewEvents === 'function' \? tourxOverviewEvents\(\) : reg;\n  return \{ events: listed\.length,/.test(grab('tourxHeadStatValues')));
{
  const b2 = { COURT_CONDITIONS: box.COURT_CONDITIONS, courtSpeedCategory: v => 'x' };
  vm.createContext(b2);
  vm.runInContext(catalogSrc + '\n' + ['tourxConditionRegistry', 'tourxOverviewEvents'].map(grab).join('\n') + '\nthis.E = tourxOverviewEvents();', b2);
  const en = b2.E.map(e => e.name), ly = b2.E.find(e => e.name === 'Lyon (France)');
  // Mutation: drop listUnrated from the catalog → Brussels / Lyon (France) leave the Overview → red.
  ok('Overview list: the rated events + Brussels and Lyon (France) with no speed (dash)', en.includes('Lyon') && en.includes('Almaty') && en.includes('Brussels') && en.includes('Lyon (France)')
    && ly.abstractSpeed === null && en.length === 4, en);
}
ok('the B footnote is true for every year (not "Jan–Apr 2026" only)', /B = priced on the Bet365 close where Pinnacle has none/.test(grab('tpFavDogHtml')) && !/B = the Bet365 close \(Jan–Apr 2026\)/.test(html));

console.log('=== How it plays (2.1) ===');
const sl = (n, metrics, years) => ({ n, years, excludedPartial: 1, metrics });
const met = (value, n, num, den) => ({ value, n, num, den });
T.data['how-it-plays.json'] = { floor: 15, baseline: { indoorHard: sl(3725, { hold: met(0.811, 3725, 70148, 86507), firstServeWon: met(0.731, 3725, 1, 1), secondServeWon: met(0.509, 3725, 1, 1), acesPerMatch: met(13.36, 3725, 49766, 3725), tiebreaksPerSet: met(0.213, 3725, 1869, 8791) }, [2016, 2025]) },
  events: { 11851: { name: 'Almaty', surface: 'hard', indoor: true, baseline: 'indoorHard', past: sl(53, { hold: met(0.833, 53, 1015, 1219), firstServeWon: met(0.732, 53, 1, 1), secondServeWon: met(0.513, 53, 1, 1), acesPerMatch: met(13.66, 53, 724, 53), tiebreaksPerSet: met(0.264, 53, 32, 121) }, [2024, 2025]),
      current: sl(12, { hold: met(0.858, 12, 495, 577) }, [2026]) },
    3669: { name: 'Brussels', surface: 'hard', indoor: true, baseline: 'indoorHard', past: sl(25, { hold: met(0.887, 14, 544, 613) }, [2025]), current: null },
    14763: { name: 'Lyon (France) - Qualification', surface: 'hard', indoor: true, baseline: 'indoorHard', past: null, current: sl(24, { hold: met(0.865, 24, 517, 598) }, [2026]) } } };
const cat = n => T.cat.find(t => t.name === n);
const hipA = T.tpHowItPlaysHtml(cat('Almaty')), tA = text(hipA);
// Mutation: drop the plain-words header, or the court / best-of-three words → red.
ok('header: "Main draw, 2024–2025, 53 matches · compared with ATP indoor hard, best-of-three"', /Main draw, 2024–2025, 53 matches · compared with ATP indoor hard, best-of-three/.test(tA), tA.slice(0, 160));
ok('Almaty past hold 83.3% vs tour 81.1%; n and num / den in the tooltip', /83\.3%/.test(tA) && /81\.1%/.test(tA) && /2024–2025 editions: 83\.3% \(1015 \/ 1219 service games; 53 matches\)/.test(hipA));
// Mutation: show a figure below the floor → the 12-match current hold 85.8% prints → red.
ok('this year so far below the floor (12 < 15) is a dash with its count', /2026 so far · n 12/.test(tA) && !/85\.8%/.test(tA));
const tB = text(T.tpHowItPlaysHtml(cat('Brussels')));
ok('Brussels: a metric with n 14 < 15 is a dash with "n 14"', /2025 edition · n 14/.test(tB) && !/88\.7%/.test(tB));
// Mutation: map Lyon (France) to the clay Lyon or print a past edition → red.
const tL = text(T.tpHowItPlaysHtml(cat('Lyon (France)')));
ok('Lyon (France): "First edition — no past edition", its 2026 figure shown at n 24', /First edition — no past edition/.test(tL) && /86\.5%/.test(tL), tL.slice(0, 200));
ok('no verdict words (more / fewer / in line with …)', !/more tiebreaks|fewer|in line with|than usual|upsets/i.test(tA + tB + tL));
ok('no court-speed tile', !/court speed|abstract/i.test(tA));

console.log('=== Favourites vs underdogs by round (2.2) ===');
const row = (label, through, n, fav, dog, extra) => Object.assign({ label, through, n, fav, dog, ties: 0, noClose: 0, b365: 0, retirements: 0 }, extra || {});
T.data['favourites-by-round.json'] = { floor: 15, baseline: { Indoor: { court: 'Indoor', years: [2016, 2025], rows: [row('R1', '1st Round', 9000, 6200, 2800), row('R1–R2', '2nd Round', 14000, 9600, 4400)] } },
  events: { Almaty: { court: 'Indoor', current: { year: 2026, walkovers: 1, rows: [row('R1', '1st Round', 12, 8, 4, { noClose: 1 }), row('R1–R2', '2nd Round', 19, 12, 7, { noClose: 1, retirements: 1 })] },
    past: { years: [2024, 2025], walkovers: 0, rows: [row('R1', '1st Round', 23, 16, 7, { b365: 2 }), row('R1–R2', '2nd Round', 37, 26, 11, { b365: 2 })] } } } };
const fd = T.tpFavDogHtml(cat('Almaty')), tf = text(fd);
// Mutation: print % below the floor → "67%" for 8 of 12 → red.
ok('R1 2026: counts shown, % dashed below 15 (Fav 8 · —, of 12)', /Fav 8 · — Dog 4 · — of 12/.test(tf), tf.slice(0, 400));
ok('R1–R2 2026 at n 19: Fav 12 · 63%, Dog 7 · 37%', /Fav 12 · 63% Dog 7 · 37% of 19/.test(tf));
ok('past editions column + its years; baseline column names court / best-of-three / years', /2024–2025/.test(tf) && /indoor hard · best of 3 · 2016–2025/.test(tf) && /Fav 6200 · 69%/.test(tf));
// Mutation: drop the no-close / walkover / tie footnote → red.
ok('footnote counts no-close, ties and walkovers; the B marker shows', /No Pinnacle close \(dash, not counted above\): 2026 1 · past 0\./.test(tf) && /Exact closing ties/.test(tf) && /Walkovers excluded: 2026 1/.test(tf) && /of 23 · B/.test(tf));
ok('tone only: no --pos / --neg / green / red in the block', !/--pos|--neg|#3dd68c|#e0616f/.test(fd));

console.log('=== Points to defend (2.3) ===');
const pr = (order, name, country, rank, badge, points, o) => Object.assign({ order, name, country, rank, result: badge.split(' ')[0], resultBadge: badge, points, mainPoints: points, qualifyingPoints: 0, ll: false, status: 'Playing', statusInferred: false }, o || {});
const almRows = [pr(1, 'Daniil Medvedev', 'Russia', 5, 'Won', 250), pr(2, 'Rinky Hijikata', 'Australia', 86, 'R16', 25, { ll: true, qualifyingPoints: null, pointsComplete: false }),
  pr(3, 'Shintaro Mochizuki', 'Japan', 129, 'QF', 50, { status: 'Withdrew', statusInferred: true })].concat(Array.from({ length: 17 }, (_, i) => pr(4 + i, 'P' + i, null, null, 'Q', 7, { status: 'Not entered', mainPoints: null, qualifyingPoints: 7, qualRound: 'Q2' })));
T.data['points-to-defend.json'] = { asOf: '2026-10-25', index: { 'almaty-2026': 'almaty-2026', 'lyon-2026': 'lyon-2026' }, events: {
  'almaty-2026': { state: 'ok', dropDate: '2026-10-19', rows: almRows, prior: { season: '2025' } },
  'lyon-2026': { state: 'first-edition', firstEdition: true, rows: [] } } };
const pa = T.tpPointsDefendHtml(cat('Almaty')), ta = text(pa);
ok('header "Last year\'s points here" + "Points dropped 19 Oct"', /Last year's points here Points dropped 19 Oct/.test(ta), ta.slice(0, 120));
ok('row: order, IOC, player, live rank, badge, status, points (Medvedev RUS #5 Won Playing 250)', /1 RUS Daniil Medvedev #5 Playing Won 250/.test(ta), ta.slice(0, 300));
// Mutation: give the lucky loser his qualifying points / drop the LL badge → red.
ok('a lucky loser shows main-draw points only, an LL badge, qualifying — in the tooltip', /Rinky Hijikata #86 Playing R16 LL 25/.test(ta) && /Main draw 25 · qualifying — \(lucky loser/.test(pa));
// Mutation: present an inferred withdrawal as confirmed (no tooltip) → red.
ok('an inferred withdrawal reads "Withdrew" with the tooltip "On the entry list, not in the draw"', /title="On the entry list, not in the draw" [^>]*>Withdrew</.test(pa));
ok('an unknown country is "—" (P0 has none), never a guess', /4 — P0/.test(ta));
ok('8 rows then "Show all 20" (a visible control, which reads "Show fewer" when open)', (pa.match(/<span style="position:relative;font-family:'IBM Plex Mono'[^>]*>\d+<\/span>/g) || []).length === 8 && /Show all 20/.test(pa));
ok('bar length = points (Medvedev 250 = the full bar)', /width:100%;background:color-mix\(in srgb, var\(--bar\) 18%/.test(pa));
// Mutation: read the clay Lyon as the October event (or print rows for it) → red.
ok('Lyon (France): "First edition — no points to defend here."; the clay Lyon has no block', /First edition — no points to defend here\./.test(text(T.tpPointsDefendHtml(cat('Lyon (France)')))) && T.tpPointsDefendHtml(cat('Lyon')) === '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
