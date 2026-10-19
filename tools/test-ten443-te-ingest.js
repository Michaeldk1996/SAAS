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

function load(on, setRepair) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(ROOT) && !k.includes('node_modules')) delete require.cache[k];
  if (on) process.env.TE_INGEST = '1'; else delete process.env.TE_INGEST;
  if (setRepair) process.env.SET_REPAIR = '1'; else delete process.env.SET_REPAIR;
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
    R(2023, '2023-09-22', 'Laver Cup', 'Laver Cup', '', 'hard', 'indoor', 'Upsilon U.', true, '6-4, 6-4'),       // TEN-449: ATP tier
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
async function run(on, withStore, edit, setRepair) {
  const P = load(on, setRepair);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten443-'));
  if (withStore) teStore(tmp);
  if (edit) edit(tmp);
  const cwd = process.cwd(); process.chdir(tmp);
  const profiles = { [KEY]: profile() };
  const teYearly = new Map();
  try {
    await P.writeCareerHistoryShards(profiles, { archive: archive(), log: () => {}, currentYear: 2026, teYearly });
    const shardBytes = fs.readFileSync(path.join(tmp, 'career-history', `${KEY}.json`), 'utf8');
    const shard = JSON.parse(shardBytes);
    const index = JSON.parse(fs.readFileSync(path.join(tmp, 'career-history-index.json'), 'utf8'));
    // TEN-449 payload B: the record's own file and its index, written only with TE_INGEST on
    const recF = path.join(tmp, 'career-record', `${KEY}.json`), recIdxF = path.join(tmp, 'career-record-index.json');
    const recFile = fs.existsSync(recF) ? JSON.parse(fs.readFileSync(recF, 'utf8')) : null;
    const recIndex = fs.existsSync(recIdxF) ? JSON.parse(fs.readFileSync(recIdxF, 'utf8')) : null;
    return { P, p: profiles[KEY], shard, shardBytes, recFile, recIndex, matches: shard.matches, rows: recordOf(shard, recFile), index, teYearly, tmp };
  } finally { process.chdir(cwd); }
}
// the record's rows as the page reads them (player-profile-v2.js recordRowsOf): matches + the record file's overlay
function recordOf(shard, recFile) {
  const L = recFile && recFile.record; if (!L) return shard.matches;
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
  // the named exception is by the record's player key (te-join.js NO_DOB_EXCEPTION: Svajda, 2986)
  const noDob = (asKey) => (d) => { const f = path.join(d, 'te-history', `${KEY}.json`); const j = JSON.parse(fs.readFileSync(f, 'utf8')); delete j.dob; j.key = asKey; if (asKey === '2986') j.slug = 'svajda'; fs.writeFileSync(f, JSON.stringify(j)); };
  const nodob = await run(true, true, noDob('2986'));
  let noDobThrew = null;
  try { await run(true, true, noDob(KEY)); } catch (e) { noDobThrew = e; }
  // TEN-449: the store's freshness fields reach the record index
  const stamp = (fields) => (d) => { const f = path.join(d, 'te-history-index.json'); fs.writeFileSync(f, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(f, 'utf8')), fields))); };
  const fresh = await run(true, true, stamp({ asOf: '2026-10-18', refreshedAt: null }));
  const refreshed = await run(true, true, stamp({ asOf: '2026-10-18', refreshedAt: '2026-10-26T05:00:00.000Z' }));
  // TEN-449 golden guard, mutation control: a merge that writes onto a shared row must stop the run
  let guardThrew = null;
  {
    // patched AFTER load() (it clears the require cache), on the very te-join instance the pipeline holds
    const mutant = () => { const TJ = require('../te-join.js'), orig = TJ.applyTeHistory;
      TJ.applyTeHistory = (rows, rec) => { const m = orig(rows, rec); if (rows[0]) rows[0].surface = 'grass-mutant'; return m; }; };
    try { await run(true, true, mutant); } catch (e) { guardThrew = e; }
  }
  // TEN-449 (founder 2026-10-19): the two switches are independent — each runs on its own input alone
  const repairsOnly = await run(false, false, (d) => fs.writeFileSync(path.join(d, 'set-repairs.json'), JSON.stringify({ builtAt: '2026-10-18T00:00:00Z', repairs: {}, flags: {} })), true);
  let repairsMissing = null;
  try { await run(true, true, null, true); } catch (e) { repairsMissing = e; }
  // TEN-449: the store read in place from the private checkout (TE_STORE_DIR), as pipeline.yml runs it
  process.env.TE_STORE_DIR = '.te-store';
  const inPlace = await run(true, false, (d) => { teStore(path.join(d, '.te-store')); fs.writeFileSync(path.join(d, '.te-store', 'set-repairs.json'), JSON.stringify({ builtAt: 'x', repairs: {}, flags: {} })); }, true);
  delete process.env.TE_STORE_DIR;
  // TEN-449: a TE-joined player whose profile carries no feed rows at all (and no archive rows)
  const norows = await (async () => {
    const P = load(true); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten443-')); teStore(tmp);
    const cwd = process.cwd(); process.chdir(tmp);
    try {
      const pr = profile(); pr.careerMatches = [];
      await P.writeCareerHistoryShards({ [KEY]: pr }, { archive: {}, log: () => {}, currentYear: 2026, teYearly: new Map() });
      const recF = path.join(tmp, 'career-record', `${KEY}.json`);
      return { tmp, recFile: fs.existsSync(recF) ? JSON.parse(fs.readFileSync(recF, 'utf8')) : null };
    } finally { process.chdir(cwd); }
  })();
  check('TE_INGEST off: the store is not read — season table and rows exactly as before', () => {
    assert.ok(!off.rows.some((r) => r.src === 'te' || r.te || r.conflicts), 'TE fields on an off run');
    assert.ok(!('record' in off.shard), 'no record overlay on an off run');
    assert.strictEqual(off.recFile, null, 'no career-record file on an off run');
    assert.strictEqual(off.recIndex, null, 'no career-record-index.json on an off run');
    assert.strictEqual(wl(yr(off.p, '2016').total), '3-2', 'the pre-2021 aggregate kept');
    assert.strictEqual(off.index.meta.te, null);
  });
  check('TEN-449 payload B · the shared match file is BYTE-identical with TE_INGEST on and off', () => {
    assert.strictEqual(on.shardBytes, off.shardBytes, 'career-history/<key>.json differs between on and off');
    assert.ok(!('record' in on.shard), 'the record must not ride the shared match file');
  });
  check('TEN-449 payload B · the record ships in its own file, indexed, `n` = the rows it indexes', () => {
    assert.ok(on.recFile && on.recFile.record && on.recFile.record.v === 1, 'career-record/<key>.json with the overlay');
    assert.strictEqual(on.recFile.n, on.matches.length, 'n is the length of the matches it indexes');
    assert.ok(on.recIndex && on.recIndex.players[KEY], 'career-record-index.json lists the player');
    assert.strictEqual(on.recIndex.meta.players, 1);
  });
  check('TEN-449 · freshness: the record index carries the store\'s asOf, and refreshedAt null until a refresh runs', () => {
    assert.strictEqual(on.recIndex.meta.asOf, null, 'this fixture store has no asOf');
    assert.strictEqual(on.recIndex.meta.refreshedAt, null);
    assert.strictEqual(fresh.recIndex.meta.asOf, '2026-10-18');
    assert.strictEqual(refreshed.recIndex.meta.refreshedAt, '2026-10-26T05:00:00.000Z');
  });
  // ── GOLDEN CHECK (founder 2026-10-19): turning the career-record layer on moves no H2H pair, no Lines input and no
  // model output. They read the shared match files (byte-identical, above); these run the readers themselves.
  check('GOLDEN · H2H: the production join (h2h-core.js) over the shared rows is identical on and off', () => {
    const H = require('../h2h-core.js');
    const me = { key: KEY, full: 'Test Player', short: 'T. Player' };
    const opps = [...new Set(off.matches.map((r) => r.opponent).filter(Boolean))];
    const nk = H.nameCounts([me.full, ...opps]);
    let n = 0;
    for (const o of opps) {
      const B = { key: 'opp-' + o, full: o, short: o };
      const x = H.record(H.joinMeetings(me, B, off.matches, [], nk, [])), y = H.record(H.joinMeetings(me, B, on.matches, [], nk, []));
      assert.deepStrictEqual(y, x, `H2H vs ${o} moved`); n++;
    }
    assert.ok(n > 0, 'no opponent was joined — the check proved nothing');
  });
  check('GOLDEN · Lines: the shared rows the Lines tab reads (sets, games, completeness flags) are identical on and off', () => {
    const lines = (ms) => JSON.stringify(ms.map((r) => [r.date, r.opponent, r.result, r.sets || null, !!r.incomplete, r.altFormat || null, r.won]));
    assert.strictEqual(lines(on.matches), lines(off.matches));
    assert.strictEqual(on.index.meta.perSetGames.rows, off.index.meta.perSetGames.rows);
    assert.deepStrictEqual(on.index.meta.exclusions, off.index.meta.exclusions);
  });
  check('GOLDEN · model: runModel on the same match with the on and off season tables gives the same output', () => {
    const { runModel } = require('../h2h-model/model');
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten449-model-match.json'), 'utf8'));
    const withYearly = (y) => Object.assign({}, fx, { p1Yearly: y, p2Yearly: y });
    const run1 = (y) => { const r = runModel(withYearly(y)); if (r.meta) delete r.meta.generatedAt; return r; };   // the clock is not an output
    const a = run1(off.p.careerByYear), b = run1(on.p.careerByYear);
    assert.ok(a.ok, 'the fixture match must price, or this proves nothing');
    assert.notDeepStrictEqual(on.p.careerByYear, off.p.careerByYear, 'the season tables must differ, or this proves nothing');
    assert.strictEqual(JSON.stringify(b), JSON.stringify(a), 'the model output moved with the season table');
  });
  check('GOLDEN · the run-time guard: a merge that touches a shared row stops the run (mutation control)', () => {
    assert.ok(guardThrew && /changed .*shared career-history rows/.test(guardThrew.message), String(guardThrew));
  });
  check('TEN-449 · TE_STORE_DIR: the store and set-repairs.json are read in place, nothing copied into the checkout', () => {
    assert.strictEqual(inPlace.shardBytes, on.shardBytes, 'same shared file as the store at the root');
    assert.deepStrictEqual(inPlace.recFile, on.recFile, 'same record file');
    assert.ok(inPlace.index.meta.setRepairs, 'set-repairs.json read from the store dir');
    assert.ok(!fs.existsSync(path.join(inPlace.tmp, 'te-history')) && !fs.existsSync(path.join(inPlace.tmp, 'set-repairs.json')));
  });
  check('TEN-449 · switches independent: SET_REPAIR alone runs with no Tennis Explorer store, and ships no record', () => {
    assert.strictEqual(repairsOnly.index.meta.te, null);
    assert.ok(repairsOnly.index.meta.setRepairs && repairsOnly.index.meta.setRepairs.builtAt === '2026-10-18T00:00:00Z');
    assert.strictEqual(repairsOnly.recFile, null); assert.strictEqual(repairsOnly.recIndex, null);
  });
  check('TEN-449 · switches independent: TE_INGEST alone needs no set-repairs.json; SET_REPAIR on without it stops', () => {
    assert.ok(on.index.meta.te && on.index.meta.setRepairs === null, 'TE on, repairs off');
    assert.ok(repairsMissing && /set-repairs\.json/.test(repairsMissing.message), String(repairsMissing));
  });
  check('TEN-449 · switches independent in the workflow: two repository variables, each placing only its own input', () => {
    const y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pipeline.yml'), 'utf8');
    assert.ok(/TE_INGEST: \$\{\{ vars\.TE_INGEST == '1' && '1' \|\| '0' \}\}/.test(y), 'TE_INGEST from its own variable');
    assert.ok(/SET_REPAIR: \$\{\{ vars\.SET_REPAIR == '1' && '1' \|\| '0' \}\}/.test(y), 'SET_REPAIR from its own variable');
    assert.ok(/if \[ "\$TE_INGEST" = "1" \]; then[\s\S]*?te-history[\s\S]*?fi/.test(y) && /if \[ "\$SET_REPAIR" = "1" \]; then[\s\S]*?set-repairs\.json[\s\S]*?fi/.test(y), 'each input checked under its own switch');
    assert.ok(/TE_STORE_DIR: \.te-store/.test(y), 'the pipeline reads the store in place from the private checkout');
    assert.ok(/repository: michaeldk1996\/stennisfy-te-store/.test(y) && /persist-credentials: false/.test(y), 'the private store, token not persisted');
  });
  check('TEN-449 · a TE-joined player with no feed rows: no shared file (as with the switch off), his record file ships', () => {
    assert.ok(!fs.existsSync(path.join(norows.tmp, 'career-history', `${KEY}.json`)), 'a shared file appeared that the off run would not write');
    assert.ok(norows.recFile && norows.recFile.n === 0 && norows.recFile.record.add.length > 0, 'his record is TE\'s own rows');
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
    assert.strictEqual(wl(yr(on.p, '2023').total), '2-1');   // Pan Am W + Laver Cup W + Davis Cup L
    assert.strictEqual(wl(yr(on.p, '2023').chitf.total), '1-0', 'the counted Other row is Challenger/ITF tier');
  });
  check('TEN-449 · Laver Cup stays in the ATP tier', () => {
    assert.ok(on.rows.some((x) => x.tournament === 'Laver Cup' && x.level === 'atp'));
    assert.strictEqual(wl(yr(on.p, '2023').atp.total), '1-1');   // Laver Cup W + Davis Cup L
  });
  check('TEN-449 · a TE record with no DOB that is not a named exception stops the run', () => {
    assert.ok(noDobThrew && /not a named exception/.test(noDobThrew.message), String(noDobThrew));
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
    const t = on.index.meta.te; assert.ok(t && t.players === 1 && t.added === 9 && t.duplicatesDropped === 1 && t.juniorsDropped === 1 && t.indoorOverrides === 1 && t.seasonMoves === 1 && t.otherCounted === 1 && t.otherSkipped === 1 && t.notInTeNotCounted === 1, JSON.stringify(t));
  });
  check('the drill marks the disagreeing row: the 2024 Total drill paints a ≠ on Indian Wells and on no agreeing row', () => {
    const sb = { FEATURE_PP2: true, playerProfiles: { players: { [KEY]: on.p } }, careerHistory: { [KEY]: on.matches },
      careerRecord: { [KEY]: on.recFile.record }, TournamentIdentity: require('../tournament-identity.js') };
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
    // TEN-449 · Record by season's hover: the counting rule, + "as of" until the first refresh, only on a TE record
    const NOTE = 'Counted as Tennis Explorer counts, minus exhibitions, club matches, national championships and pro series.';
    sb.careerRecordMeta = { asOf: '2026-10-18', refreshedAt: null };
    assert.strictEqual(I.recordSourceNote({ key: KEY }), NOTE + ' Tennis Explorer data as of 18 Oct.');
    assert.ok(I.renderCareerModal(Object.assign({ key: KEY }, on.p)).includes('title="' + NOTE + ' Tennis Explorer data as of 18 Oct."'), 'the hover is on Record by season');
    sb.careerRecordMeta = { asOf: '2026-10-18', refreshedAt: '2026-10-26T05:00:00.000Z' };
    assert.strictEqual(I.recordSourceNote({ key: KEY }), NOTE, 'the freshness clause goes once the refresh has run');
    sb.careerRecord[KEY] = null;
    assert.strictEqual(I.recordSourceNote({ key: KEY }), '', 'a player whose record is not TE\'s carries no TE claim');
    assert.ok(!I.renderCareerModal(Object.assign({ key: KEY }, on.p)).includes(NOTE));
    sb.careerRecord[KEY] = on.recFile.record;
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
  // TEN-449 Bucket D (founder 2026-10-19, report `bucket-d`): eight players joined on a NEAR-MISS DOB, by key
  // (te-join.js NEAR_MISS_DOB). Each is a DOB-joined player — only TE's rows count (ruling 2A), never Svajda's
  // no-DOB behaviour; the list cannot widen to a ninth key, in the pipeline or in the store builder.
  {
    const TJ = require('../te-join.js');
    const BUCKET_D = { 702: ['tkemaladze', '20000604'], 12972: ['rocha-a46b1', '19991004'], 19461: ['munoz-1a9fc', '2005'],
      52682: ['balshaw', '20060605'], 54221: ['bennaton', '2005'], 70760: ['ceban', '2009'], 78231: ['al-sulaiti-a86c2', '2007'], 78628: ['snoussi', '2007'] };
    const rec = (key, slug, dob, rows) => ({ key, slug, dob, src: 'te', format: 'te-history/1', cols: COLS, balance: {}, rows });
    const ours = (date, tournament, opponent, won, extra) => Object.assign({ year: date.slice(0, 4), surface: 'hard', level: 'chitf', date, tournament, round: 'R32', opponent, result: won ? '2 - 0' : '0 - 2', won, src: 'fixtures', indoor: false }, extra || {});
    // one row both list, one only we list, one only TE lists
    const shared = () => [ours('2025-05-05', 'M15 Antalya', 'A. Alpha', true), ours('2025-06-02', 'M15 Monastir', 'Q. Quux', true)];
    const teRows = [R(2025, '2025-05-05', 'Futures 2025', 'ITF', '1R', 'hard', 'outdoor', 'Alpha A.', true, '6-1, 6-1'),
      R(2025, '2025-07-07', 'Futures 2025', 'ITF qual', 'Q-1R', 'hard', 'outdoor', 'Beta B.', false, '6-3, 6-3')];
    check('TEN-449 Bucket D · the list is exactly the eight keys the founder approved, each pinned to one TE page and DOB', () => {
      assert.deepStrictEqual([...TJ.NEAR_MISS_DOB.keys()].sort(), Object.keys(BUCKET_D).sort());
      for (const [k, [slug, dob]] of Object.entries(BUCKET_D)) assert.deepStrictEqual([TJ.NEAR_MISS_DOB.get(k).slug, TJ.NEAR_MISS_DOB.get(k).te], [slug, dob], k);
      assert.ok(!TJ.NEAR_MISS_DOB.has('2986') && !TJ.NO_DOB_EXCEPTION.has('702'), 'the two exceptions stay apart');
    });
    for (const [k, [slug, dob]] of Object.entries(BUCKET_D)) {
      check(`TEN-449 Bucket D · ${k} ${slug} (TE DOB ${dob}) joins and counts only TE's rows`, () => {
        const rows = shared(), before = JSON.stringify(rows);
        const m = TJ.applyTeHistory(rows, rec(k, slug, dob, teRows));
        assert.strictEqual(JSON.stringify(rows), before, 'the shared rows moved');
        assert.strictEqual(m.out.get(rows[1]), 'not-in-te', 'our row TE lacks must be listed, not counted (not Svajda\'s rule)');
        assert.strictEqual(m.added.length, 1, 'the TE-only row is added');
        assert.strictEqual(wl(TJ.careerByYearFromRows(m.rows)[0].total), '1-1', 'counted = TE\'s two rows');
        const L = TJ.recordLayer(rows, m); assert.deepStrictEqual(L.out, [[1, 'not-in-te']]);
      });
    }
    check('TEN-449 Bucket D · a ninth near-miss key is refused: year-only, short, impossible or missing DOB records, and a near-miss join in the cache', () => {
      assert.throws(() => TJ.applyTeHistory(shared(), rec('9002', 'someone', '2004', teRows)), /not a valid full yyyymmdd/);
      assert.throws(() => TJ.applyTeHistory(shared(), rec('9002', 'someone', '200406', teRows)), /not a valid full yyyymmdd/);
      for (const bad of ['00000000', '20041301', '20040000', '20040132', '20040231'])
        assert.throws(() => TJ.applyTeHistory(shared(), rec('9002', 'someone', bad, teRows)), /not a valid full yyyymmdd/, bad);
      assert.throws(() => TJ.applyTeHistory(shared(), rec('9002', 'someone', null, teRows)), /not a named exception/);
      assert.match(TJ.teIdentityRefusal({ key: '9002', slug: 'someone', dob: '20040506', how: 'near-miss-dob' }), /not a named exception for this key/);
      assert.match(TJ.teIdentityRefusal({ key: '9002', slug: 'someone', dob: null, how: 'founder-exception' }), /not a named exception for this key/);
      assert.match(TJ.teIdentityRefusal({ key: '9002', slug: 'someone', dob: '20040506', how: 'hand-edit' }), /not a DOB join/);
      assert.strictEqual(TJ.teIdentityRefusal({ key: '9002', slug: 'someone', dob: '20040506', how: 'dob' }), null, 'an ordinary DOB join passes');
    });
    check('TEN-449 Bucket D · with our DOB on hand (the store builder), a ninth key whose full TE DOB is swapped or near ours is refused', () => {
      assert.match(TJ.teIdentityRefusal({ key: '9002', slug: 'someone', dob: '20040605', how: 'dob', ourDob: '20040506' }), /is not our DOB 20040506/);
      assert.match(TJ.teIdentityRefusal({ key: '9002', slug: 'someone', dob: '20040516', how: 'dob', ourDob: '20040506' }), /is not our DOB/);
      assert.match(TJ.teIdentityRefusal({ key: '9002', slug: 'someone', dob: '20040506', how: 'dob', ourDob: null }), /no DOB of ours on record/);
      assert.strictEqual(TJ.teIdentityRefusal({ key: '9002', slug: 'someone', dob: '20040506', how: 'dob', ourDob: '20040506' }), null, 'equal DOBs pass');
      assert.strictEqual(TJ.teIdentityRefusal({ key: '702', slug: 'tkemaladze', dob: '20000604', how: 'near-miss-dob', ourDob: '20000406' }), null, 'a named key with the DOB the ruling was made on passes');
      assert.match(TJ.teIdentityRefusal({ key: '702', slug: 'tkemaladze', dob: '20000604', how: 'near-miss-dob', ourDob: '20000407' }), /not the 20000406 the near-miss ruling/);
    });
    check('TEN-449 · the no-DOB exception is pinned to Svajda\'s page: key 2986 on any other slug is refused', () => {
      assert.strictEqual(TJ.teIdentityRefusal({ key: '2986', slug: 'svajda', dob: null }), null);
      assert.match(TJ.teIdentityRefusal({ key: '2986', slug: 'svajda-2', dob: null }), /NO_DOB_EXCEPTION/);
      assert.throws(() => TJ.applyTeHistory(shared(), rec('2986', 'someone', null, teRows)), /NO_DOB_EXCEPTION/);
      assert.strictEqual(TJ.teIdentityRefusal({ key: '2986', slug: 'svajda', dob: null, how: 'founder-exception', ourDob: '20021129' }), null, 'his entry in the cache passes the builder');
    });
    check('TEN-449 Bucket D · a named key joins only its own page and DOB (another page, or our DOB in place of TE\'s, stops)', () => {
      assert.throws(() => TJ.applyTeHistory(shared(), rec('19461', 'munoz-021d4', '2005', teRows)), /NEAR_MISS_DOB/);
      assert.throws(() => TJ.applyTeHistory(shared(), rec('19461', 'munoz-1a9fc', '20050122', teRows)), /NEAR_MISS_DOB/);
      assert.throws(() => TJ.applyTeHistory(shared(), rec('19461', 'munoz-1a9fc', null, teRows)), /NEAR_MISS_DOB/);
      assert.strictEqual(TJ.teIdentityRefusal({ key: '19461', slug: 'munoz-1a9fc', dob: '2005', how: 'near-miss-dob' }), null);
      assert.match(TJ.teIdentityRefusal({ key: '19461', slug: 'munoz-1a9fc', dob: '2005', how: 'founder-exception' }), /not a named exception for this key/);
    });
    check('TEN-449 Bucket D · Ceban (70760): his 16 junior Grand Slam rows stay out; the senior row pairs', () => {
      const slams = ['Australian Open', 'French Open', 'Wimbledon', 'US Open'];
      const rows = [ours('2025-06-23', 'Wimbledon', 'S. Senior', false, { level: 'atp', surface: 'grass', round: 'Qualifying' })];
      for (let i = 0; i < 16; i++) rows.push(ours(`2025-0${1 + (i % 8)}-1${i % 10}`, slams[i % 4], `J. Junior${i}`, i % 2 === 0));
      const m = TJ.applyTeHistory(rows, rec('70760', 'ceban', '2009', [R(2025, '2025-06-23', 'Wimbledon', 'ATP qual', 'Q-1R', 'grass', 'outdoor', 'Senior S.', false, '6-4, 6-4')]));
      assert.strictEqual([...m.out.values()].filter((v) => v === 'junior').length, 16);
      assert.strictEqual(m.diag.paired, 1);
      assert.strictEqual(wl(TJ.careerByYearFromRows(m.rows)[0].total), '0-1', 'only the senior row counts');
    });
    check('TEN-449 Bucket D · Tkemaladze (702): the Lo Chien match (27 Oct 2022) counts once — TE\'s copy, ours listed not counted', () => {
      const rows = [ours('2022-10-27', 'M15 Sharm ElSheikh 15', 'H. Lo Chien', false, { round: '1/8-finals', result: '1 - 2', sets: [{ p: 6, o: 1 }, { p: 2, o: 6 }, { p: 6, o: 7 }] })];
      const m = TJ.applyTeHistory(rows, rec('702', 'tkemaladze', '20000604', [R(2022, '2022-10-27', 'Futures 2022', 'ITF', 'R16', 'hard', 'outdoor', 'Lo C.', false, '1-6, 6-2, 7-6(4)')]));
      assert.strictEqual(m.out.get(rows[0]), 'not-in-te');
      const counted22 = m.rows.filter((r) => r.date === '2022-10-27');
      assert.strictEqual(counted22.length, 1, 'one counted row on the day'); assert.strictEqual(counted22[0].src, 'te');
      assert.strictEqual(wl(TJ.careerByYearFromRows(m.rows).find((y) => y.year === '2022').total), '0-1');
    });
    check('TEN-449 Bucket D · the store builder stops (exit 1, nothing written) on any refused cache join, and builds a named key', () => {
      const { spawnSync } = require('child_process');
      const build = (players, roster) => {
        const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'ten449-bd-cache-')), out = fs.mkdtempSync(path.join(os.tmpdir(), 'ten449-bd-out-'));
        fs.mkdirSync(path.join(cache, 'html'));
        fs.writeFileSync(path.join(out, 'te-atp-events.json'), JSON.stringify({ names: ['rotterdam'] }));
        fs.writeFileSync(path.join(cache, 'players.json'), JSON.stringify(players));
        fs.writeFileSync(path.join(cache, 'roster.json'), JSON.stringify(roster));
        const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'te-build-history.mjs'), '--cache', cache, '--out', out], { encoding: 'utf8' });
        return { r, out, rep: JSON.parse(r.stdout) };
      };
      const tk = { slug: 'tkemaladze', how: 'near-miss-dob', dob: '20000604', years: [] };
      const bad = build({ 702: tk,
        9002: { slug: 'someone', how: 'near-miss-dob', dob: '20040506', years: [] },
        9003: { slug: 'other', how: 'dob', dob: '2004', years: [] },
        9004: { slug: 'swapped', how: 'dob', dob: '20040605', years: [] },
        9005: { slug: 'unknown', how: 'dob', dob: '20040506', years: [] } },
      [{ key: '702', dob: '20000406' }, { key: '9004', dob: '20040506' }]);
      assert.strictEqual(bad.r.status, 1, 'a refused join must stop the build');
      assert.deepStrictEqual(bad.rep.refusedJoin.map((x) => x.key).sort(), ['9002', '9003', '9004', '9005']);
      assert.ok(!fs.existsSync(path.join(bad.out, 'te-history')) && !fs.existsSync(path.join(bad.out, 'te-history-index.json')), 'nothing written');
      const good = build({ 702: tk }, [{ key: '702', dob: '20000406' }]);
      assert.strictEqual(good.r.status, 0, good.r.stderr);
      assert.deepStrictEqual(good.rep.refusedJoin, []);
      assert.deepStrictEqual(good.rep.missingPages, ['702 profile'], 'the named key passes the gate (then needs its pages)');
    });
  }
  // TEN-449 Bucket D, through the real pipeline: a year-only DOB on an unnamed key stops the run
  let yearOnlyThrew = null;
  try { await run(true, true, (d) => { const f = path.join(d, 'te-history', `${KEY}.json`); const j = JSON.parse(fs.readFileSync(f, 'utf8')); j.dob = '1999'; fs.writeFileSync(f, JSON.stringify(j)); }); } catch (e) { yearOnlyThrew = e; }
  check('TEN-449 Bucket D · writeCareerHistoryShards stops on a year-only TE DOB for a key not named in NEAR_MISS_DOB', () => assert.ok(yearOnlyThrew && /not a valid full yyyymmdd/.test(yearOnlyThrew.message), String(yearOnlyThrew)));
  load(false);
  console.log(`\nTEN-443 TE ingest: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
