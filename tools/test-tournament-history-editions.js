#!/usr/bin/env node
// Record per tournament — founder 2026-11-15 ("fix the ATP Finals record"; "this problem can not be happening again").
//  A. fetchPlayerCareerHistory keeps a season-ending Finals' group-stage match that api-tennis sends with an EMPTY round
//     (as 'RR'); a team event's empty-round match stays out. Fritz's real Turin 2022 / 2024 fixtures (read 15 Nov 2026).
//  B. The archive merge files an edition that starts 24–31 December under the next season (Brisbane 31 Dec 2018 =
//     the 2019 edition, as api-tennis), so one match is never listed under two editions; the adjacent-season guard drops
//     an archive copy the api-tennis edition already holds; a genuine repeat meeting in January is kept.
'use strict';
const assert = require('assert');
process.env.API_TENNIS_KEY = process.env.API_TENNIS_KEY || 'test';
const P = require('../bsp-pipeline.js');
const B = require('../career-backfill.js');
let pass = 0, fail = 0;
async function check(name, fn) {
  try { const r = await fn(); pass++; console.log('  PASS  ' + name + (r ? '\n        ' + r : '')); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}
const fx = (date, name, round, p1, k1, p2, k2, winner, res) => ({ event_key: date + p1, event_date: date,
  tournament_name: name, tournament_key: 9999, tournament_round: round, tournament_season: date.slice(0, 4),
  event_status: 'Finished', event_qualification: null, event_first_player: p1, first_player_key: k1,
  event_second_player: p2, second_player_key: k2, event_winner: winner, event_final_result: res, event_type_type: 'Atp Singles' });
const FRITZ = [
  fx('2022-11-13', 'Finals - Turin', '', 'R. Nadal', 1, 'T. Fritz', 2832, 'Second Player', '0 - 2'),
  fx('2022-11-15', 'Finals - Turin', '', 'C. Ruud', 2, 'T. Fritz', 2832, 'First Player', '2 - 1'),
  fx('2022-11-17', 'Finals - Turin', '', 'F. Auger-Aliassime', 3, 'T. Fritz', 2832, 'Second Player', '1 - 2'),
  fx('2022-11-19', 'Finals - Turin', 'Finals - Turin - Semi-finals', 'N. Djokovic', 4, 'T. Fritz', 2832, 'First Player', '2 - 0'),
  fx('2024-11-10', 'ATP Finals - Turin', '', 'D. Medvedev', 5, 'T. Fritz', 2832, 'Second Player', '0 - 2'),
  fx('2024-11-12', 'ATP Finals - Turin', '', 'J. Sinner', 6, 'T. Fritz', 2832, 'First Player', '2 - 0'),
  fx('2024-11-14', 'ATP Finals - Turin', '', 'T. Fritz', 2832, 'A. De Minaur', 7, 'First Player', '2 - 1'),
  fx('2024-11-16', 'ATP Finals - Turin', 'ATP Finals - Turin - Semi-finals', 'A. Zverev', 8, 'T. Fritz', 2832, 'Second Player', '1 - 2'),
  fx('2024-11-17', 'ATP Finals - Turin', 'ATP Finals - Turin - Final', 'J. Sinner', 6, 'T. Fritz', 2832, 'First Player', '2 - 0'),
  fx('2022-09-16', 'Davis Cup - World Group', '', 'T. Fritz', 2832, 'C. Norrie', 9, 'Second Player', '1 - 2'),
];
async function history(rows) {
  const prev = global.fetch;
  global.fetch = async () => ({ json: async () => ({ success: 1, result: JSON.parse(JSON.stringify(rows)) }) });
  try { return await P.fetchPlayerCareerHistory(2832); } finally { global.fetch = prev; }
}
(async () => {
  console.log('Record per tournament — editions (founder 2026-11-15)');
  await check('A. the Turin 2022 and 2024 round robins are kept as RR: ATP Finals 5–4 over 9 matches (2022 2–2, 2024 3–2; with 2025 at 1–2 = 6–6)', async () => {
    const h = await history(FRITZ);
    const t = h.find((x) => /finals/i.test(x.name) && !/davis/i.test(x.name));
    assert(t, 'no Finals row: ' + h.map((x) => x.name).join(', '));
    assert.strictEqual(t.won + '-' + t.lost, '5-4', 'record ' + t.won + '-' + t.lost);
    const ed = (y) => t.editions.find((e) => e.year === y);
    assert.strictEqual(ed(2022).matches.filter((m) => m.round === 'RR').length, 3, '2022 RR rows');
    assert.strictEqual(ed(2024).matches.filter((m) => m.round === 'RR').length, 3, '2024 RR rows');
    assert.strictEqual(ed(2024).finish, 'Final', '2024 finish ' + ed(2024).finish);
    return t.name + ' ' + t.won + '–' + t.lost + ' · 2022 ' + ed(2022).finish + ' · 2024 ' + ed(2024).finish;
  });
  // 2026-11-16 (v10): a team event's tie with no round is its round robin too — 58 profiled players' only tour-level
  // matches are such Davis Cup ties, and they had no Record per tournament at all.
  await check('A. a team event\'s empty-round tie is kept as RR (Davis Cup: Fritz lost to Norrie, 2022)', async () => {
    const h = await history(FRITZ);
    const d = h.find((x) => /davis/i.test(x.name));
    assert(d, 'no Davis Cup row: ' + h.map((x) => x.name).join(', '));
    assert.strictEqual(d.won + '-' + d.lost, '0-1', 'record ' + d.won + '-' + d.lost);
    assert.deepStrictEqual(d.editions[0].matches.map((m) => m.round + ' ' + m.res + ' ' + m.opp), ['RR L C. Norrie']);
    return d.name + ' ' + d.won + '–' + d.lost;
  });
  await check('A. [control] a non-team event with no round still stays out', async () => {
    const h = await history([fx('2024-03-01', 'Acapulco', '', 'T. Fritz', 2832, 'X. Y', 10, 'First Player', '2 - 0')]);
    assert(!h || !h.length, 'kept: ' + JSON.stringify(h));
  });
  await check('A. [control] without the rule the round robins are dropped (old filter: SF / F only)', async () => {
    const h = await history(FRITZ.filter((f) => f.tournament_round));
    const t = h.find((x) => /finals/i.test(x.name));
    assert.strictEqual(t.won + t.lost, 3, 'control ' + (t.won + t.lost));
    return 'control 1–2 over 3 (the 2–4 the profile printed, less 2025)';
  });

  const api = [{ name: 'Brisbane', editions: [{ year: 2019, matches: [{ res: 'L', round: 'R32', opp: 'D. Kudla', oppKey: '2919', score: '1 - 2' }] }] }];
  const dec = { tourney: 'Brisbane', year: 2018, date: '2018-12-31', round: 'R32', oppName: 'D. Kudla', won: false, score: '2 - 1' };
  await check('B. a 31 December edition is the next season\'s: Brisbane listed once (2019), 0–1', () => {
    assert.strictEqual(B.tmlEditionYear(dec), 2019);
    assert.strictEqual(B.tmlEditionYear({ year: 2018, date: '2018-12-20' }), 2018);
    const t = B.mergePlayer(api, [dec]).history.find((x) => x.name === 'Brisbane');
    assert.deepStrictEqual(t.editions.map((e) => e.year), [2019]);
    assert.strictEqual(t.won + '-' + t.lost, '0-1');
    assert.deepStrictEqual(B.crossEditionDuplicates([t]), []);
    return 'editions [2019] · 0–1';
  });
  await check('B. the guard: api-tennis filed it under the OLD season — the archive copy is still not added', () => {
    const api2 = [{ name: 'Brisbane', editions: [{ year: 2018, matches: api[0].editions[0].matches }] }];
    const r = B.mergePlayer(api2, [dec]);
    assert.deepStrictEqual(r.history[0].editions.map((e) => e.year), [2018]);
    assert.strictEqual(r.droppedDuplicates, 1);
    return 'dropped 1';
  });
  await check('B. a genuine repeat meeting in January (another edition) is kept', () => {
    const jan = Object.assign({}, dec, { date: '2018-01-01' });
    const t = B.mergePlayer(api, [jan]).history.find((x) => x.name === 'Brisbane');
    assert.deepStrictEqual(t.editions.map((e) => e.year), [2019, 2018]);
    return 'editions [2019, 2018]';
  });
  await check('B. [control] the detector finds the pre-fix double listing (Brisbane 2018 + 2019)', () => {
    const before = [{ name: 'Brisbane', editions: [{ year: 2019, matches: api[0].editions[0].matches },
      { year: 2018, matches: [{ res: 'L', round: 'R32', opp: 'D. Kudla', oppKey: '', score: '1 - 2' }] }] }];
    assert.strictEqual(B.crossEditionDuplicates(before).length, 1);
    return '1 found';
  });
  // 2026-11-16: the archive's per-tie Davis Cup rows and api-tennis's group rows are the same rubbers under two names.
  const apiDc = [{ name: 'Davis Cup - Finals', editions: [{ year: 2025, matches: [{ res: 'W', round: 'RR', opp: 'F. Cerundolo', oppKey: '19', score: '2 - 0' }] }] }];
  const tmlDc = (opp, won, y) => ({ tourney: 'Davis Cup Finals QF: ARG vs GER', year: y || 2025, date: (y || 2025) + '-11-20', round: 'RR',
    oppName: opp, won, score: won ? '0 - 2' : '2 - 0' });
  await check('C. an archive Davis Cup rubber the api-tennis tie holds is listed once (Zverev d. F. Cerundolo, 2025)', () => {
    const r = B.mergePlayer(apiDc, [tmlDc('F. Cerundolo', true)]);
    const dc = r.history.filter((x) => /davis/i.test(x.name));
    assert.strictEqual(dc.reduce((n, t) => n + t.won + t.lost, 0), 1, dc.map((t) => t.name + ' ' + t.won + '-' + t.lost).join(', '));
    assert.strictEqual(r.droppedDuplicates, 1);
    assert.deepStrictEqual(dc.map((t) => t.name), ['Davis Cup - Finals'], 'an empty archive row is left behind');
    return dc.map((t) => t.name).join(', ');
  });
  await check('C. an archive rubber the API side does not hold is kept (other opponent; other season)', () => {
    const r = B.mergePlayer(apiDc, [tmlDc('J. Munar', true), tmlDc('F. Cerundolo', true, 2019)]);
    const n = r.history.filter((x) => /davis/i.test(x.name)).reduce((k, t) => k + t.won + t.lost, 0);
    assert.strictEqual(n, 3, 'davis matches ' + n);
    assert.strictEqual(r.droppedDuplicates, 0);
  });
  await check('C. [control] without the Davis Cup guard the rubber is listed twice', () => {
    const r = B.mergePlayer([], [tmlDc('F. Cerundolo', true)]);
    const n = apiDc[0].editions[0].matches.length + r.history.reduce((k, t) => k + t.won + t.lost, 0);
    assert.strictEqual(n, 2);
  });
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed, 0 skipped (a skip is never a pass)');
  process.exit(fail ? 1 : 0);
})();
