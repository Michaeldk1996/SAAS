// tools/test-ten391-ten395.js — TEN-391 (ribbon = last 18 Form rows for every player) and TEN-395 (Last 52 surfaces =
// the season table for every player). Pinned inputs only: synthetic fixtures driven through the REAL pipeline
// functions, and tools/fixtures/ten395/last52-season.json (seven deployed players, rows 2025+, clock pinned to its asOf).
//
//   391-a  bsp-pipeline.js capRecentFormMatches keeps the current season + every row down to the 18th Form row, so a
//          Thompson-shaped player (5 matches this season, a Laver Cup tie inside the span) gets an 18-cell ribbon from
//          the REAL renderer (player-profile-v2.js buildCtx -> renderRibbon); the Laver Cup row is kept but not drawn.
//   391-b  fewer Form rows on record than 18 -> every one is kept (the ribbon says "last N").
//   391-c  the season drills keep their store: a season the longer list reaches only by its tail (outside the current
//          season and the 10 most recent matches) still reads the edition store — no partial form list replaces it.
//   395-a  playerMatchHistory's per-row `indoor` and buildAllTierYearly's Indoors are one join: summed per season and
//          tier, the flagged rows ARE the table's indoor record.
//   395-b  EVERY player in the pinned set (Alcaraz + six of the players whose Last 52 read fewer Indoors than the table
//          on 7 Oct): for every season-tier the window touches, the season's classified rows reproduce the table's
//          Indoors exactly and its other surfaces up to undated matches only; the window's rows of a season are a subset
//          of that season's; Last 52 Indoors = the window rows the table counts indoor, match by match.
//   395-c  control: the same players with the court flag stripped (shards built before TEN-395) disagree — the check
//          is not vacuous — and still never call MORE indoor than the table.
//
// The roster-wide form (every deployed player) is probe-only: tools/probe-ten384-figures-roster.js sweep S.
// Run: node tools/test-ten391-ten395.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const L = require('./ten384-figures-lib.js');
const P = require(path.join(L.ROOT, 'bsp-pipeline.js'));

const H = L.harness();
console.log('TEN-391 / TEN-395 — working tree');

// ── 391 · the ribbon list ───────────────────────────────────────────────────────
const KEY = '207';
let ek = 1000;
function fixture(date, won, tournament, opts) {
  opts = opts || {};
  return {
    event_key: ek++, event_date: date, event_status: 'Finished', event_type_type: opts.type || 'Atp Singles',
    first_player_key: KEY, second_player_key: String(5000 + ek), event_first_player: 'J. Thompson',
    event_second_player: 'O. Pponent' + ek, event_winner: won ? 'First Player' : 'Second Player',
    event_final_result: won ? '2 - 0' : '0 - 2', tournament_name: tournament, tournament_key: opts.tkey || '1',
    tournament_round: 'ATP ' + tournament + ' - 1/16-finals', event_qualification: 'False',
    scores: won ? [{ score_first: '6', score_second: '3', score_set: '1' }, { score_first: '6', score_second: '4', score_set: '2' }]
      : [{ score_first: '3', score_second: '6', score_set: '1' }, { score_first: '4', score_second: '6', score_set: '2' }]
  };
}
const day = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function thompsonFixtures(n2025) {
  const fx = [];
  for (let i = 0; i < 5; i++) fx.push(fixture(day(2026, 1, 10 + i), i % 2 === 0, 'Australian Open'));
  fx.push(fixture('2025-09-21', false, 'Laver Cup'));       // a Laver Cup tie inside the span: kept, never drawn
  for (let i = 0; i < n2025; i++) fx.push(fixture(day(2025, 8 - Math.floor(i / 25), 28 - (i % 25)), i % 3 !== 0, 'Cincinnati'));
  return fx;
}
const surfaceMap = new Map([['1', 'hard']]);
function loadPp2(players, extra, now) {
  return L.loadPp2({ players, now: now || '2026-10-07T12:00:00.000Z', extra: extra || {} }).I;
}
H.check('391-a · Thompson shape (5 matches this season, Laver Cup inside the span): 18 Form rows kept, the ribbon draws 18', () => {
  const all = P.recentFormFromFixtures(thompsonFixtures(40), KEY, surfaceMap).matches;
  const kept = P.capRecentFormMatches(all, 2026);
  const form = kept.filter(m => !P.FORM_NOT_ATP_RECORD.test(m.tournament));
  assert.strictEqual(form.length, 18, 'Form rows kept ' + form.length);
  assert.strictEqual(kept.length, 19, 'rows kept ' + kept.length + ' (18 Form + the Laver Cup tie)');
  assert.ok(kept.some(m => /laver/i.test(m.tournament)), 'the Laver Cup row (a record) was dropped');
  assert.strictEqual(P.PROFILE_FORM_WINDOW, 18);
  const p = { key: KEY, name: 'J. Thompson', recentForm: { pct: null, matches: kept } };
  const I = loadPp2({ [KEY]: p });
  const html = I.renderRibbon(I.build(p));
  const cells = (html.match(/pp2-strip-cell/g) || []).length;
  assert.strictEqual(cells, 18, 'ribbon cells ' + cells);
  assert.ok(/last 18 /.test(L.text(html)), 'eyebrow: ' + (L.text(html).match(/last \d+[^·]*/) || [''])[0]);
  // the old cap (current season + last 10 raw rows) drew 10 here — the founder's defect
  const old = all.filter((m, i) => i < 10 || m.date.slice(0, 4) === '2026');
  assert.strictEqual(old.filter(m => !P.FORM_NOT_ATP_RECORD.test(m.tournament)).length, 9, 'control: the old cap held 9 Form rows');
  return `${kept.length} rows kept (old cap ${old.length}), ribbon 18 cells`;
});
H.check('391-b · fewer Form matches on record than 18: every one is kept and the ribbon says so', () => {
  const all = P.recentFormFromFixtures(thompsonFixtures(7), KEY, surfaceMap).matches;
  const kept = P.capRecentFormMatches(all, 2026);
  assert.strictEqual(kept.length, all.length, 'rows dropped');
  const p = { key: KEY, name: 'J. Thompson', recentForm: { pct: null, matches: kept } };
  const I = loadPp2({ [KEY]: p });
  const html = I.renderRibbon(I.build(p));
  assert.strictEqual((html.match(/pp2-strip-cell/g) || []).length, 12);
  assert.ok(/last 12 /.test(L.text(html)), 'eyebrow');
  return '12 Form rows on record -> last 12';
});
H.check('391-c · a season the list reaches only by its tail keeps the edition store in the season drill (no partial list)', () => {
  // 5 this season + 5 of 2025 = the 10 most recent; 2024 is reached only because the list now runs to the 18th row.
  const fx = [];
  for (let i = 0; i < 5; i++) fx.push(fixture(day(2026, 1, 10 + i), true, 'Australian Open'));
  for (let i = 0; i < 5; i++) fx.push(fixture(day(2025, 8, 10 + i), true, 'Cincinnati'));
  for (let i = 0; i < 12; i++) fx.push(fixture(day(2024, 9, 1 + i), i % 2 === 0, 'Chengdu'));
  const kept = P.capRecentFormMatches(P.recentFormFromFixtures(fx, KEY, surfaceMap).matches, 2026);
  assert.strictEqual(kept.filter(m => m.date.startsWith('2024')).length, 8, '2024 rows in the list');
  const eds = [{ name: 'Chengdu', editions: [{ year: 2024, matches: [...Array(12)].map((_, i) => ({ opp: 'O. Pponent' + i, res: i % 2 ? 'L' : 'W', round: 'R32', score: '2-0' })) }] }];
  const p = { key: KEY, name: 'J. Thompson', recentForm: { pct: null, matches: kept }, tournamentHistory: eds };
  const I = loadPp2({ [KEY]: p });
  assert.strictEqual(I.drillSourceFor(p, '2024'), 'edition', '2024 drill source');
  assert.strictEqual(I.drillRows(p, null, '2024').length, 12, '2024 drill rows');
  assert.strictEqual(I.drillSourceFor(p, '2025'), 'form');
  assert.strictEqual(I.drillRows(p, null, '2025').length, 5);
  return '2024: 12 edition rows (not 8 of 12 form rows) · 2025: 5 form rows';
});

// ── 395 · Last 52 = the season table ────────────────────────────────────────────
H.check('395-a · playerMatchHistory\'s `indoor` and buildAllTierYearly\'s Indoors are one join (tournament_key -> courts)', () => {
  const courts = new Map([['1', 'outdoor'], ['2', 'indoor']]);
  const sm = new Map([['1', 'hard'], ['2', 'hard'], ['3', 'clay']]);
  const fx = [
    fixture('2026-02-10', true, 'Rotterdam', { tkey: '2' }), fixture('2026-02-11', false, 'Rotterdam', { tkey: '2' }),
    fixture('2026-03-10', true, 'Indian Wells', { tkey: '1' }), fixture('2026-04-10', true, 'Monte Carlo', { tkey: '3' }),
    fixture('2025-11-01', true, 'Bergamo', { tkey: '2', type: 'Challenger Men Singles' }),
    fixture('2025-11-02', true, 'Somewhere', { tkey: '9', type: 'Challenger Men Singles' })   // a key the map lacks
  ];
  const yrs = P.buildAllTierYearly(fx, KEY, {}, 2026, sm, courts);
  const rows = P.playerMatchHistory(fx, KEY, 2026, sm, courts);
  assert.ok(rows.every(r => typeof r.indoor === 'boolean'), 'a row without the flag');
  yrs.forEach((y) => ['atp', 'chitf'].forEach((t) => {
    const want = y[t] && y[t].indoor ? y[t].indoor.total : { won: 0, lost: 0 };
    const got = { won: 0, lost: 0 };
    rows.filter(r => r.year === y.year && r.level === t && r.indoor).forEach((r) => { got[r.won ? 'won' : 'lost']++; });
    assert.deepStrictEqual(got, { won: want.won, lost: want.lost }, `${y.year} ${t}`);
  }));
  assert.strictEqual(P.playerMatchHistory(fx, KEY, 2026, sm, new Map()).filter(r => 'indoor' in r).length, 0,
    'an empty court map (cache predating court capture) must not write a flag');
  return 'flags sum to the table on every season and tier; no flag without a court map';
});

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten395', 'last52-season.json'), 'utf8'));
// The generalised fx7/fx8 definition lives in ten384-figures-lib.js last52SeasonAudit (the roster probe runs the same one).
function audit(strip) {
  const players = {}, ch = {};
  Object.keys(FX.players).forEach((k) => {
    players[k] = JSON.parse(JSON.stringify(FX.players[k].profile));
    ch[k] = FX.players[k].careerHistory.map((r) => {
      const o = Object.assign({}, r);
      if (strip) delete o.indoor;
      return o;
    });
  });
  const I = L.loadPp2({ players, careerHistory: ch, now: FX.asOf }).I;
  return Object.keys(players).map(k => Object.assign({ name: players[k].name }, L.last52SeasonAudit(I, players[k])));
}
H.check('395-b · every pinned player (Alcaraz + six of the 7 Oct disagreements): Last 52 surfaces = the season table inside the window', () => {
  const o = audit(false);
  assert.strictEqual(o.length, 7);
  const seasons = o.reduce((s, x) => s + x.seasons, 0);
  assert.ok(seasons >= 14, 'season-tiers walked ' + seasons);
  assert.ok(o.every(x => x.l52), 'a player whose window rows do not all carry the court flag');
  const bad = [].concat(...o.map(x => x.bad));
  assert.deepStrictEqual(bad, [], bad.length + ' disagreements');
  return `${o.length} players · ${seasons} season-tiers · 0 disagreements · Last 52 Indoors ` + o.map(x => x.name + ' ' + x.l52.got).join(', ');
});
H.check('395-c · control: the same players without the court flag disagree (not vacuous), never with MORE indoor than the table', () => {
  const o = audit(true);
  const who = o.filter(x => x.bad.length).map(x => x.name);
  assert.ok(who.length >= 6, 'only ' + who.length + ' players disagree without the flag: ' + who.join(', '));
  const over = [].concat(...o.map(x => x.over));
  assert.deepStrictEqual(over, [], 'the fallback classifier called more indoor than the table');
  return `${who.length} of 7 disagree without the flag (${[].concat(...o.map(x => x.bad)).length} cells)`;
});

H.done();
