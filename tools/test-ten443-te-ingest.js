#!/usr/bin/env node
// TEN-443 step 2 — the Tennis Explorer ingest, as a WIRING test: a cached profile (careerByYear + careerMatches, as
// the pipeline holds it) and a te-history store go through the REAL bsp-pipeline.js writeCareerHistoryShards, and the
// shard plus the rebuilt season table are read back. One case per cause on the founder's moved-cell list:
//   juniors removed · Stuttgart to grass · pre-2021 aggregate replaced by the row count · TE matches added ·
//   indoor overrides · edition-year season moves · seasons appearing before 2015
// plus: exhibitions and walkovers stay out, a duplicate of ours is dropped (one match = one row), every disagreement
// is kept on the row, TE rows carry src 'te', cells equal the rows listed, TE_INGEST off changes nothing, and with it
// on a missing store stops the run.
// TEN-449 (founder 2026-10-19): the record is its own population — `matches` is byte-identical with TE_INGEST on and
// off and the record is the shard's `record` overlay (read back here the way the page does, recordOf); a DOB-joined
// player's row TE lacks is listed, marked and not counted (the no-DOB exception keeps counting it); the multi-sport
// and play-off "Other" classes count, the pro series do not; the "Surface not known" column lists TE's Not-set rows.
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('  ok   ' + n); } catch (e) { fail++; console.log('  FAIL ' + n + ' :: ' + e.message); } };

function load(on) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(ROOT) && !k.includes('node_modules')) delete require.cache[k];
  if (on) process.env.TE_INGEST = '1'; else delete process.env.TE_INGEST;
  return require('../bsp-pipeline.js');
}
const KEY = '9001';
// the cached profile: 2024 from fixtures (our tally), 2016 from the provider aggregate (pre-2021, no rows behind it)
function profile() {
  const careerMatches = [
    { year: '2024', surface: 'hard', level: 'atp', date: '2024-02-12', tournament: 'Rotterdam', round: 'R32', opponent: 'A. Alpha', result: '2 - 0', won: true, src: 'fixtures', indoor: false, sets: [{ p: 6, o: 3 }, { p: 6, o: 4 }] },
    { year: '2024', surface: 'clay', level: 'atp', date: '2024-06-12', tournament: 'Stuttgart', round: 'R16', opponent: 'B. Beta', result: '2 - 1', won: true, src: 'fixtures', indoor: false, sets: [{ p: 6, o: 3 }, { p: 3, o: 6 }, { p: 6, o: 4 }] },
    { year: '2024', surface: 'clay', level: 'chitf', date: '2024-06-02', tournament: 'French Open', round: 'Qualifying', opponent: 'J. Junior', result: '2 - 0', won: true, src: 'fixtures', indoor: false },
    { year: '2024', surface: 'hard', level: 'atp', date: '2024-12-30', tournament: 'United Cup', round: '—', opponent: 'C. Gamma', result: '2 - 0', won: true, src: 'fixtures', indoor: false, sets: [{ p: 6, o: 2 }, { p: 6, o: 2 }] },
    { year: '2024', surface: 'hard', level: 'atp', date: '2024-03-08', tournament: 'Indian Wells', round: 'R64', opponent: 'D. Delta', result: '0 - 2', won: false, src: 'fixtures', indoor: false, sets: [{ p: 4, o: 6 }, { p: 4, o: 6 }] },
    // a row TE files as an exhibition: paired, then dropped (founder ruling: exhibitions are not counted)
    { year: '2024', surface: 'grass', level: 'atp', date: '2024-06-28', tournament: 'Boodles Tennis Challenge', round: '—', opponent: 'Z. Zeta', result: '2 - 0', won: true, src: 'fixtures', indoor: false },
    // TEN-449: a row of ours TE does not list (DOB-joined player): listed, marked, not counted
    { year: '2024', surface: 'hard', level: 'chitf', date: '2024-08-05', tournament: 'Lexington Challenger', round: 'R32', opponent: 'Q. Quux', result: '2 - 0', won: true, src: 'fixtures', indoor: false, sets: [{ p: 6, o: 1 }, { p: 6, o: 2 }] },
  ];
  const cell = (w, l) => ({ won: w, lost: l });
  return {
    name: 'P. Test',
    careerMatches,
    careerByYear: [
      { year: '2024', allTier: true, total: cell(4, 1), hard: cell(2, 1), clay: cell(2, 0), grass: null, indoor: null, atp: { total: cell(3, 1) }, chitf: { total: cell(1, 0) } },
      { year: '2016', allTier: false, total: cell(3, 2), hard: cell(3, 2), clay: null, grass: null },
    ],
  };
}
const R = (season, date, event, cat, round, surface, court, opp, won, score, extra) => [season, date, event, cat, round, surface, court, opp, opp.toLowerCase(), won ? 1 : 0, score, extra && extra.wo ? 1 : 0, 0, null, 0];
const COLS = ['season', 'date', 'event', 'cat', 'round', 'surface', 'court', 'opp', 'oppSlug', 'won', 'score', 'wo', 'ret', 'teMatchId', 'dateAmbiguous'];
function teStore(dir) {
  const rows = [
    R(2024, '2024-02-12', 'Rotterdam', 'ATP', '1R', null, 'indoor', 'Alpha A.', true, '6-3, 6-4'),                 // pair · court override
    R(2024, '2024-06-12', 'Stuttgart', 'ATP', 'R16', 'grass', 'outdoor', 'Beta B.', true, '6-3, 3-6, 6-4'),        // pair · TE grass
    R(2025, '2024-12-30', 'United Cup', 'United Cup', '', 'hard', 'outdoor', 'Gamma C.', true, '6-2, 6-2'),        // pair · edition year 2025
    R(2024, '2024-03-08', 'Indian Wells', 'ATP', '1R', 'hard', 'outdoor', 'Delta D.', false, '6-4, 7-5'),          // pair · score conflict
    R(2024, '2024-06-20', 'Halle', 'ATP qual', 'Q-1R', 'grass', 'outdoor', 'Eps E.', true, '7-6(4), 6-3'),        // TE only · added
    R(2024, '2024-06-28', 'Boodles Tennis Challenge', 'Exhibition', '', 'grass', 'outdoor', 'Zeta Z.', true, '6-1, 6-1'),  // skipped
    R(2024, '2024-07-02', 'Wimbledon', 'ATP', '1R', 'grass', 'outdoor', 'Eta E.', true, '', { wo: true }),          // walkover · skipped
    R(2016, '2016-03-01', 'Futures 2016', 'ITF', '1R', 'hard', 'outdoor', 'Theta T.', true, '6-2, 6-2'),
    R(2016, '2016-03-02', 'Futures 2016', 'ITF', 'R16', 'hard', 'outdoor', 'Iota I.', false, '6-2, 6-2'),
    R(2016, '2016-10-03', 'Futures 2016', 'ITF', '1R', null, 'indoor', 'Kappa K.', true, '6-4, 6-4'),
    R(2014, '2014-05-05', 'Futures 2014', 'ITF qual', 'Q-1R', 'clay', 'outdoor', 'Lambda L.', false, '6-0, 6-1'),  // season before 2015
    R(2016, '2016-02-12', 'Rotterdam', 'ATP', '1R', null, 'indoor', 'Nu N.', true, '6-3, 6-4'),         // pairs the WEEK-dated archive row (+4 days)
    R(2016, '2016-03-04', 'Davis Cup', 'Davis Cup', '', null, null, 'Mu M.', true, '6-1, 6-1, 6-1'),    // our archive holds it twice
    R(2021, '2021-02-10', 'Rotterdam', 'ATP', '1R', null, 'indoor', 'Omicron O.', true, '6-3, 6-4'),    // the 2021 hole-fill row, indoor
    R(2024, '2024-06-25', 'Halle', 'ATP', 'R16', 'grass', 'outdoor', 'Pi P.', true, '6-3, 2-1'),         // TE only · won by the opponent's retirement
    R(2023, '2023-10-25', 'Pan American Games', 'Other', '1R', 'hard', 'outdoor', 'Rho R.', true, '6-2, 6-2'),   // TEN-449: counted class
    R(2023, '2023-05-01', 'UK Pro Series', 'Other', '1R', 'hard', 'outdoor', 'Sigma S.', true, '6-2, 6-2'),        // TEN-449: not counted
    R(2023, '2023-09-15', 'Davis Cup', 'Davis Cup', '', null, null, 'Tau T.', false, '4-6, 4-6'),                  // TE "Not set": Surface not known
  ];
  fs.mkdirSync(path.join(dir, 'te-history'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'te-history', `${KEY}.json`), JSON.stringify({ key: KEY, slug: 'test', dob: '19990101', src: 'te', format: 'te-history/1', cols: COLS, balance: {}, rows }));
  fs.writeFileSync(path.join(dir, 'te-history-index.json'), JSON.stringify({ players: { [KEY]: { rows: rows.length } }, totalRows: rows.length, highWater: { totalRows: rows.length, players: 1 } }));
}
// the TML archive as buildArchiveHistories hands it over: tournament-WEEK dates, a Davis Cup rubber listed twice, and a
// 2021 row the hole-fill takes in, which TML calls outdoor and TE calls indoor (TE's court class wins)
const archive = () => ({ [KEY]: [
  { year: '2016', surface: 'hard', level: 'atp', date: '2016-02-08', tournament: 'Rotterdam', round: 'R32', opponent: 'N. Nu', result: '2 - 0', won: true },
  { year: '2016', surface: 'clay', level: 'atp', date: '2016-03-04', tournament: 'Davis Cup G1: X vs Y', round: 'RR', opponent: 'M. Mu', result: '3 - 0', won: true },
  { year: '2016', surface: 'clay', level: 'atp', date: '2016-03-04', tournament: 'Davis Cup G1: X vs Y', round: 'RR', opponent: 'M. Mu', result: '3 - 0', won: true },
  { year: '2021', surface: 'hard', level: 'atp', date: '2021-02-08', tournament: 'Rotterdam', round: 'R32', opponent: 'O. Omicron', result: '2 - 0', won: true },   // TML: outdoor; TE: indoor
] });
async function run(on, withStore, edit) {
  const P = load(on);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten443-'));
  if (withStore) teStore(tmp);
  if (edit) edit(tmp);
  const cwd = process.cwd(); process.chdir(tmp);
  const profiles = { [KEY]: profile() };
  const teYearly = new Map();
  try {
    await P.writeCareerHistoryShards(profiles, { archive: archive(), log: () => {}, currentYear: 2026, teYearly });
    const shard = JSON.parse(fs.readFileSync(path.join(tmp, 'career-history', `${KEY}.json`), 'utf8'));
    const index = JSON.parse(fs.readFileSync(path.join(tmp, 'career-history-index.json'), 'utf8'));
    return { P, p: profiles[KEY], shard, matches: shard.matches, rows: recordOf(shard), index, teYearly };
  } finally { process.chdir(cwd); }
}
// the record's rows as the page reads them (player-profile-v2.js recordRowsOf): matches + the `record` overlay
function recordOf(shard) {
  const L = shard.record; if (!L) return shard.matches;
  const over = new Map(L.over), out = new Map(L.out), rows = [];
  shard.matches.forEach((r, i) => {
    const why = out.get(i); if (why && why !== 'not-in-te') return;
    rows.push(Object.assign({}, r, over.get(i) || {}, why ? { notCounted: why } : {}));
  });
  return rows.concat(L.add);
}
const counted = (rows) => rows.filter((r) => !r.notCounted);
const carved = (y, s) => { const v = y[s], i = y.indoor && y.indoor[s]; if (!v) return '–'; const w = v.won - (i ? i.won : 0), l = v.lost - (i ? i.lost : 0); return w + l ? `${w}-${l}` : '–'; };
const wl = (c) => (c ? `${c.won}-${c.lost}` : '–');
const yr = (p, y) => p.careerByYear.find((r) => String(r.year) === y);

(async () => {
  const off = await run(false, true);
  const on = await run(true, true);
  // TEN-449: the same store with no DOB on the TE record (the Svajda exception)
  const nodob = await run(true, true, (d) => { const f = path.join(d, 'te-history', `${KEY}.json`); const j = JSON.parse(fs.readFileSync(f, 'utf8')); delete j.dob; fs.writeFileSync(f, JSON.stringify(j)); });
  check('TE_INGEST off: the store is not read — season table and rows exactly as before', () => {
    assert.ok(!off.rows.some((r) => r.src === 'te' || r.te || r.conflicts), 'TE fields on an off run');
    assert.ok(!('record' in off.shard), 'no record overlay on an off run');
    assert.strictEqual(wl(yr(off.p, '2016').total), '3-2', 'the pre-2021 aggregate kept');
    assert.strictEqual(off.index.meta.te, null);
  });
  check('TEN-449 · the record is its own population: matches are byte-identical with TE_INGEST on and off', () => {
    const { record, ...rest } = on.shard;
    assert.ok(record && record.v === 1, 'the record overlay ships');
    assert.strictEqual(JSON.stringify(rest), JSON.stringify(off.shard), 'everything but `record` equals the off shard');
  });
  check('juniors removed: the cached junior row is gone from rows and count', () => {
    assert.ok(!on.rows.some((r) => r.opponent === 'J. Junior'));
  });
  check('Stuttgart to grass: the June Stuttgart row and its cell are grass', () => {
    const r = on.rows.find((x) => x.tournament === 'Stuttgart'); assert.strictEqual(r.surface, 'grass');
    assert.strictEqual(wl(yr(on.p, '2024').clay), '–');
  });
  check('indoor override: TE says Rotterdam is indoor — the row and the Indoors cell follow TE', () => {
    const r = on.rows.find((x) => x.tournament === 'Rotterdam'); assert.strictEqual(r.indoor, true);
    assert.ok(r.conflicts && r.conflicts.some((c) => c.kind === 'court'), 'the court disagreement is kept on the row');
    assert.strictEqual(wl(yr(on.p, '2024').indoor.total), '1-0');
  });
  check('edition-year move: the 30 Dec 2024 United Cup tie counts in 2025', () => {
    const r = on.rows.find((x) => x.tournament === 'United Cup'); assert.strictEqual(r.year, '2025');
    assert.strictEqual(wl(yr(on.p, '2025').total), '1-0');
  });
  check('TE match added: the Halle qualifying win is a src te row and counts; exhibition and walkover stay out', () => {
    const r = on.rows.find((x) => x.tournament === 'Halle'); assert.ok(r && r.src === 'te' && r.won && r.level === 'atp');
    assert.ok(!on.rows.some((x) => /Boodles/.test(x.tournament) || x.opponent === 'E. Eta'));
    assert.strictEqual(wl(yr(on.p, '2024').total), '4-1');    // Rotterdam W, Stuttgart W, Halle Q W, Halle R16 W, Indian Wells L
  });
  check('TEN-449 · a DOB-joined player\'s row TE lacks is listed, marked "not-in-te", and in no count', () => {
    const r = on.rows.find((x) => x.opponent === 'Q. Quux');
    assert.ok(r && r.notCounted === 'not-in-te', JSON.stringify(r));
    assert.strictEqual(yr(on.p, '2024').chitf, null);   // Lexington was 2024's only Challenger/ITF row
  });
  check('TEN-449 · the no-DOB exception: a player joined without a DOB keeps counting the rows TE lacks', () => {
    assert.ok(nodob.rows.some((x) => x.opponent === 'Q. Quux' && !x.notCounted));
    assert.strictEqual(wl(yr(nodob.p, '2024').total), '5-1');
  });
  check('TEN-449 · "Other": the Pan American Games count, the UK Pro Series does not', () => {
    assert.ok(on.rows.some((x) => x.tournament === 'Pan American Games' && x.level === 'chitf'));
    assert.ok(!on.rows.some((x) => x.tournament === 'UK Pro Series'));
    assert.strictEqual(wl(yr(on.p, '2023').total), '1-1');   // Pan Am W + Davis Cup L
  });
  check('a row TE files as an exhibition is paired, then dropped from rows and count', () => {
    assert.ok(!on.rows.some((x) => /Boodles/.test(x.tournament || '')));
  });
  check("a TE-only win by the opponent's retirement is flagged retired (unfinished last set)", () => {
    const r = on.rows.find((x) => x.opponent === 'P. Pi'); assert.ok(r && r.retired === true, JSON.stringify(r));
  });
  check('a WEEK-dated archive row pairs with TE four days later — one row, not a TE-only duplicate', () => {
    const rs = on.rows.filter((x) => /Nu/.test(x.opponent || '')); assert.strictEqual(rs.length, 1); assert.strictEqual(rs[0].src, 'archive', 'paired: our row, not a TE-only one');
  });
  check('one match = one row: the archive listing a Davis Cup rubber twice yields one row', () => {
    assert.strictEqual(on.rows.filter((x) => /Mu$/.test(x.opponent || '')).length, 1);
  });
  check('2021 hole-fill: the paired row keeps TE indoor and Indoors counts it ONCE (no holeIndoor on top)', () => {
    const r = on.rows.find((x) => x.opponent === 'O. Omicron'); assert.strictEqual(r.indoor, true);
    const y = yr(on.p, '2021'); assert.strictEqual(wl(y.total), '1-0'); assert.strictEqual(wl(y.indoor.total), '1-0');
  });
  check('pre-2021 aggregate replaced by the row count, with an indoor split', () => {
    // Futures W/L/W (Kappa indoor), Rotterdam W (TE indoor), Davis Cup W once (Not set on TE: our clay kept, Option A)
    const y = yr(on.p, '2016'); assert.strictEqual(wl(y.total), '4-1'); assert.strictEqual(y.allTier, true);
    assert.strictEqual(wl(y.indoor.total), '2-0'); assert.strictEqual(carved(y, 'hard'), '1-1'); assert.strictEqual(wl(y.clay), '1-0');
  });
  check('a season before 2015 appears', () => assert.strictEqual(wl(yr(on.p, '2014').total), '0-1'));
  check('score disagreement is flagged on the row, never resolved silently', () => {
    const r = on.rows.find((x) => x.tournament === 'Indian Wells'); assert.ok(r.conflicts.some((c) => c.kind === 'score'));
  });
  check('cells and lists are one set: every season total equals the shard rows of that season', () => {
    for (const y of on.p.careerByYear) {
      const n = counted(on.rows).filter((r) => String(r.year) === String(y.year)).length;
      assert.strictEqual((y.total.won + y.total.lost), n, `${y.year}: cell ${wl(y.total)} vs ${n} rows`);
    }
  });
  check('the index meta reports the ingest', () => {
    const t = on.index.meta.te; assert.ok(t && t.players === 1 && t.added === 8 && t.duplicatesDropped === 1 && t.juniorsDropped === 1 && t.indoorOverrides === 1 && t.seasonMoves === 1 && t.otherCounted === 1 && t.otherSkipped === 1 && t.notInTeNotCounted === 1, JSON.stringify(t));
  });
  check('the drill marks the disagreeing row: the 2024 Total drill paints a ≠ on Indian Wells and on no agreeing row', () => {
    const sb = { FEATURE_PP2: true, playerProfiles: { players: { [KEY]: on.p } }, careerHistory: { [KEY]: on.matches },
      careerRecord: { [KEY]: on.shard.record }, TournamentIdentity: require('../tournament-identity.js') };
    global.window = sb;
    new Function('window', fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8'))(sb);
    const I = sb.PlayerProfileV2._internals;
    I.resetState(); I.state.careerTab = 'record'; I.state.careerScope = 'career'; I.state.careerTier = 'all';
    I.state.careerDrill = { kind: 'cell', year: '2024', surf: '' };
    const html = I.renderCareerModal(Object.assign({ key: KEY }, on.p));
    const marks = html.match(/data-pp2-conflict="([^"]*)"/g) || [];
    assert.strictEqual(marks.length, 2, `marks ${marks.length}`);   // Indian Wells (score) + Rotterdam (court)
    assert.ok(/title="Sources disagree — score[^"]*Tennis Explorer 4-6 5-7 · api-tennis 4-6 4-6/.test(html), 'the score tooltip names both values');
    // TEN-449: the row TE lacks is listed and says so; the note keeps it out of the count (5 counted + 1 not)
    assert.strictEqual((html.match(/data-pp2-notcounted="1"/g) || []).length, 1, 'one not-counted mark');
    assert.ok(/not in Tennis Explorer, not counted/.test(html));
    // TEN-449 · "Surface not known": the 2023 Davis Cup tie TE leaves Not set is the column's, and its drill lists it
    const g = I.tierGridCells(yr(on.p, '2023'), 'all');
    assert.strictEqual(wl(g.unknown), '0-1');
    const sc = I.drillScope(Object.assign({ key: KEY }, on.p), '2023', null, 'all').filter((r) => r.cell === 'unknown');
    assert.deepStrictEqual(sc.map((r) => r.event || r.tournament), ['Davis Cup']);
    I.state.careerDrill = null;
    const head = I.renderCareerModal(Object.assign({ key: KEY }, on.p));
    assert.ok(/>Surface not known</.test(head) && /repeat\(6,minmax\(0,1fr\)\)/.test(head), 'the sixth column paints');
  });
  check("the match modal's season table is the profile's rebuilt table (one count, TEN-313)", () => {
    const m = { p1Key: KEY, p1Yearly: [{ year: '2024', total: { won: 9, lost: 9 } }], p2Key: '1', p2Yearly: [] };
    on.P.reconcileMatchesYearly([m], new Map(), on.teYearly);
    assert.deepStrictEqual(m.p1Yearly, on.p.careerByYear);
  });
  let missing = null;
  try { await run(true, true, (d) => fs.rmSync(path.join(d, 'te-history', `${KEY}.json`))); } catch (e) { missing = e; }
  check('TE_INGEST on and a player the index lists has no file: the run stops', () => assert.ok(missing && /listed in te-history-index\.json but missing/.test(missing.message), String(missing)));
  let threw = null;
  try { await run(true, false); } catch (e) { threw = e; }
  check('TE_INGEST on with no store: the run stops (fail-closed)', () => assert.ok(threw && /te-history-index\.json is missing/.test(threw.message), String(threw)));
  // TEN-449 review: a retirement api-tennis dates 6 days after TE (Kursumlijska Banja 2024) is ONE match, not two;
  // the second pass takes leftovers only (same opponent, same result, ≤ 10 days) and never steals a first-pass pair
  {
    const TJ = require('../te-join.js');
    const te = [{ date: '2024-09-17', opp: 'Fiorentini A.', event: 'Futures 2024', won: false }, { date: '2024-09-10', opp: 'Fiorentini A.', event: 'Futures 2024', won: false }];
    const ours = [{ date: '2024-09-23', opponent: 'A. Fiorentini', tournament: 'M15 Kursumlijska Banja 18', won: false, src: 'fixtures' },
      { date: '2024-09-11', opponent: 'A. Fiorentini', tournament: 'M15 Kursumlijska Banja 17', won: false, src: 'fixtures' }];
    const p = TJ.pairRows(te, ours);
    check('pairing: a row 6 days from TE with the same opponent and result pairs (one match = one row)', () => {
      assert.strictEqual(p.pairs.length, 2); assert.strictEqual(p.teOnly.length, 0); assert.strictEqual(p.oursOnly.length, 0);
      assert.strictEqual(p.pairs.find((x) => x.ours.date === '2024-09-11').te.date, '2024-09-10', 'the first-pass pair is kept');
    });
    check('pairing: 22 days apart, or a different result, does not pair', () => {
      assert.strictEqual(TJ.pairRows([{ date: '2024-09-01', opp: 'Fiorentini A.', event: 'Futures 2024', won: false }], [ours[0]]).pairs.length, 0);
      assert.strictEqual(TJ.pairRows([{ ...te[0], won: true }], [ours[0]]).pairs.length, 0);
    });
    check('pairing: the second pass needs the exact surname — "Martinez P." 6 days from "A. Martin" stays apart', () => {
      const x = TJ.pairRows([{ date: '2024-03-10', opp: 'Martinez P.', event: 'Futures 2024', won: true }],
        [{ date: '2024-03-04', opponent: 'A. Martin', tournament: 'Santiago Challenger', won: true, src: 'fixtures' }]);
      assert.strictEqual(x.pairs.length, 0);
    });
  }
  load(false);
  console.log(`\nTEN-443 TE ingest: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
