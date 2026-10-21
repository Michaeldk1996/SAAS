// Item 5 (founder ruling 2026-10-20): a failed fetch chunk must never publish half a tournament as complete.
// On 20 Oct (run 39439766487) the 05..12 Oct chunk "fetch failed" and Shanghai published 15 of its 95 matches as if whole.
// Now: each 7-day chunk is retried twice; a chunk that still fails marks every tournament built from that fetch
// `partial: {failedRanges}`, and the Reports tab + the W/UE status say so in plain words.
// Run: node tools/test-partial-fetch.js
'use strict';
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
process.env.API_TENNIS_KEY = process.env.API_TENNIS_KEY || 'test';
process.env.PROGRESSION_CHUNK_RETRY_MS = '[0,0,0]';           // same three tries, no waiting
let pass = 0, fail = 0;
const check = (l, c, d) => { if (c) { pass++; console.log(`  ok   ${l}`); } else { fail++; console.log(`  FAIL ${l}${d ? `\n       ${d}` : ''}`); } };
console.log('Partial progression fetch → marked partial, never published as complete');
const fx = (k, date, round, w = 'First Player') => ({ event_key: k, event_date: date, event_time: '10:00', event_status: 'Finished', event_winner: w, event_qualification: 'False',
  tournament_name: 'Shanghai', tournament_round: `ATP Shanghai - ${round}`, first_player_key: 1000 + k, second_player_key: 2000 + k,
  event_first_player: `A. P${k}`, event_second_player: `B. Q${k}`, event_final_result: '2 - 0',
  statistics: [1000 + k, 2000 + k].map(pk => ({ stat_period: 'match', player_key: pk, stat_type: 'Points', stat_name: 'Total Points Won'.toUpperCase(), stat_won: '50', stat_total: '100' })) });
const early = [fx(1, '2026-10-07', '1/64-finals'), fx(2, '2026-10-09', '1/32-finals'), fx(3, '2026-10-11', '1/16-finals')];
const late = [fx(4, '2026-10-13', '1/8-finals'), fx(5, '2026-10-15', 'Quarter-finals'), fx(6, '2026-10-17', 'Semi-finals'), fx(7, '2026-10-18', 'Final')];
function harness(failEarly) {   // failEarly: how many times the first chunk fails before answering
  let earlyCalls = 0; const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    const start = /date_start=([\d-]+)/.exec(url)[1];
    if (start < '2026-10-13') { earlyCalls++; if (earlyCalls <= failEarly) throw new Error('fetch failed', { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) }); return { json: async () => ({ success: 1, result: JSON.parse(JSON.stringify(early)) }) }; }
    return { json: async () => ({ success: 1, result: JSON.parse(JSON.stringify(late)) }) };
  };
  delete require.cache[require.resolve(path.join(ROOT, 'bsp-pipeline.js'))];
  return { P: require(path.join(ROOT, 'bsp-pipeline.js')), calls, earlyCalls: () => earlyCalls };
}
(async () => {
  const RD = Date; global.Date = class extends RD { constructor(...a) { super(...(a.length ? a : ['2026-10-20T14:00:00Z'])); } static now() { return new RD('2026-10-20T14:00:00Z').getTime(); } };
  let h = harness(99);
  let t = await h.P.buildTournamentProgression('ATP Shanghai');
  check('the 20 Oct failure (chunk 1 never answers): the first chunk is tried 3 times', h.earlyCalls() === 3, h.earlyCalls());
  check('…the tournament is published PARTIAL with the failed range and reason', t && t.partial && t.partial.failedRanges.length === 1 && t.partial.failedRanges[0].from === '2026-10-05' && /fetch failed/.test(t.partial.failedRanges[0].reason), JSON.stringify(t && t.partial));
  check('…the reason carries undici\'s real error (err.cause), not just the bare "fetch failed"', t && t.partial && /UND_ERR_SOCKET other side closed/.test(t.partial.failedRanges[0].reason), JSON.stringify(t && t.partial));
  check('…and it holds only what arrived (4 of 7 here) — the partial flag, not a guess, tells the reader', t.matches.length === 4);
  h = harness(1);
  t = await h.P.buildTournamentProgression('ATP Shanghai');
  check('a transient failure is recovered by the retry: all 7 matches, NOT partial', t && t.matches.length === 7 && !('partial' in t), JSON.stringify(t && t.partial));
  h = harness(0);
  t = await h.P.buildTournamentProgression('ATP Shanghai');
  check('a clean fetch: no partial key at all (the published shape is unchanged)', t && t.matches.length === 7 && !('partial' in t));
  global.Date = RD;
  // ── on screen ──
  const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
  const fn = n => { const i = html.indexOf(`function ${n}(`); let d = 0, j = html.indexOf('{', i); for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; } return html.slice(i, j + 1); };
  const box = { tournamentProgression: { tournaments: { Shanghai: { partial: { failedRanges: [{ from: '2026-10-05', to: '2026-10-12', reason: 'failed: fetch failed' }] } }, Almaty: {} } } };
  vm.createContext(box); vm.runInContext(fn('tourxPartialText') + '\nthis.a = tourxPartialText("Shanghai"); this.b = tourxPartialText("Almaty");', box);
  check('Reports + W/UE say it in plain words: "Partial data: the score feed did not answer for 5 Oct–12 Oct — …"', box.a === 'Partial data: the score feed did not answer for 5 Oct–12 Oct — matches played on those days are missing here', box.a);
  check('a complete tournament says nothing', box.b === '');
  check('the Reports card renders the partial line; the W/UE status is prefixed by it', html.includes('${filterBar}${partialLine}') && html.includes("const note = (partial ? partial + ' · ' : '')"));
  const src = fs.readFileSync(path.join(ROOT, 'bsp-pipeline.js'), 'utf8');
  check('pipeline: retries per chunk (0 / 5 s / 15 s) and records failedRanges on the result', /\[0, 5000, 15000\]/.test(src) && /merged\.failedRanges = failedRanges/.test(src));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
