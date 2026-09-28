#!/usr/bin/env node
// TEN-310 (founder ruling 2026-09-27): career-history's 2021 hole is filled from TML, only where the
// api-tennis feed half has neither the edition nor the match. Drives the REAL function
// (career-backfill.js fillFixtureHole) and the REAL writer (bsp-pipeline.js writeCareerHistoryShards)
// over a controlled archive — no network, no store. Each guard has a control that must fail without it.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { fillFixtureHole, FIXTURE_HOLE_YEARS } = require('../career-backfill.js');

let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); } };

// The feed half for one player in 2021: the Great Ocean Road Open (feed spelling) and Queen's as "London".
const feed = [
  { year: '2021', date: '2021-02-03', tournament: 'Melbourne (Great Ocean Road Open)', round: '1/16-finals', opponent: 'A. Vukic', won: true },
  { year: '2021', date: '2021-06-15', tournament: 'London', round: '1/16-finals', opponent: 'P. Carreno-Busta', won: false },
  { year: '2020', date: '2020-02-03', tournament: 'Rotterdam', round: 'R32', opponent: 'X. Old', won: true },
  { year: '2021', date: '2021-07-25', tournament: 'Olympic Games', round: '1/32-finals', opponent: 'Y.H. Lu', won: true, sets: [{ p: 6, o: 1 }, { p: 6, o: 3 }] },
  { year: '2021', date: '2021-06-08', tournament: 'Lyon', round: 'Quarter-finals', opponent: 'C. Challenger', won: true },
];
const tml = (o) => Object.assign({ year: '2021', level: 'atp', surface: 'hard', result: '2 - 0', won: true }, o);
const T = {
  miami: tml({ date: '2021-03-22', tournament: 'Miami Masters', round: 'F', opponent: 'H. Hurkacz', won: false }),
  gor: tml({ date: '2021-02-01', tournament: 'Great Ocean Road Open', round: 'R32', opponent: 'A. Vukic' }),      // same match, other event name
  queens: tml({ date: '2021-06-12', tournament: "Queen's Club", round: 'R32', opponent: 'P. Carreno Busta', won: false }), // same match, hyphen + event name
  sameEd: tml({ date: '2021-06-12', tournament: 'London', round: 'R16', opponent: 'Z. Other', won: true }),        // edition present in the feed
  otherRes: tml({ date: '2021-02-01', tournament: 'Great Ocean Road Open', round: 'R32', opponent: 'A. Vukic', won: false }),
  y2020: tml({ year: '2020', date: '2020-03-02', tournament: 'Dubai', round: 'R32', opponent: 'Y. Z' }),
  // a 2-letter surname under another event name: only the identical set scores can match it
  lu: tml({ date: '2021-07-24', tournament: 'Tokyo Olympics', round: 'R64', opponent: 'Y. Lu', sets: [{ p: 6, o: 1 }, { p: 6, o: 3 }] }),
  // an ATP Lyon in May is not blocked by a Challenger "Lyon" edition in June
  lyonMay: tml({ date: '2021-05-17', tournament: 'Lyon', round: 'R32', opponent: 'K. Khachanov', won: false }),
};

check('the hole year is 2021', () => assert.deepStrictEqual(FIXTURE_HOLE_YEARS, [2021]));
check('a match the feed does not have is kept (Sinner, Miami 2021 final)', () => assert.deepStrictEqual(fillFixtureHole(feed, [T.miami], 2021), [T.miami]));
check('guard 2: the same match under another event name is dropped', () => assert.deepStrictEqual(fillFixtureHole(feed, [T.gor], 2021), []));
check('guard 2: a hyphenated surname and another event name still match', () => assert.deepStrictEqual(fillFixtureHole(feed, [T.queens], 2021), []));
check('guard 1: an edition the feed has is never topped up from TML', () => assert.deepStrictEqual(fillFixtureHole(feed, [T.sameEd], 2021), []));
check('only the named year is filled', () => assert.deepStrictEqual(fillFixtureHole(feed, [T.y2020], 2021), []));
check('guard 2: a 2-letter surname ("Y. Lu" / "Y.H. Lu") under another event name is caught', () => assert.deepStrictEqual(fillFixtureHole(feed, [T.lu], 2021), []));
check('control: identical set scores against a different opponent are NOT a match (6-2 6-2 is common)', () => {
  const other = Object.assign({}, T.lu, { opponent: 'J. Millman' });
  assert.deepStrictEqual(fillFixtureHole(feed, [other], 2021), [other]);
});
check('control: a shared name particle ("de") is not a shared surname', () => {
  const f2 = [{ year: '2021', date: '2021-03-24', tournament: 'Miami', round: 'R64', opponent: 'A. de Minaur', won: true }];
  const t2 = tml({ date: '2021-03-22', tournament: 'Miami Masters', round: 'R32', opponent: 'T. de Loore' });
  assert.deepStrictEqual(fillFixtureHole(f2, [t2], 2021), []);   // guard 1 (same Miami edition) still holds here…
  const t3 = Object.assign({}, t2, { tournament: 'Some Other Event' });
  assert.deepStrictEqual(fillFixtureHole(f2, [t3], 2021), [t3]); // …but the particle alone never matches
});
check('guard 1 is dated: a same-name edition in another month does not block the row', () => assert.deepStrictEqual(fillFixtureHole(feed, [T.lyonMay], 2021), [T.lyonMay]));
// controls: each guard alone is load-bearing
check('control: without guard 1 the London R16 row would be added', () => {
  const noEd = feed.map((r) => Object.assign({}, r, { tournament: 'Somewhere Else' }));
  assert.deepStrictEqual(fillFixtureHole(noEd, [T.sameEd], 2021), [T.sameEd]);
});
check('control: a different RESULT is a different match, so it is kept', () => assert.deepStrictEqual(fillFixtureHole(feed, [T.otherRes], 2021), [T.otherRes]));

// The REAL writer, over an injected archive, in a temp dir.
(async () => {
  const { writeCareerHistoryShards } = require('../bsp-pipeline.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten310-hole-'));
  const cwd = process.cwd();
  process.chdir(tmp);
  try {
    const profiles = { 2072: { name: 'J. Sinner', careerMatches: feed.map((r) => Object.assign({ src: 'fixtures', result: '2 - 0' }, r)) } };
    const archive = { 2072: [T.miami, T.gor, T.queens, T.sameEd, T.y2020, tml({ year: '2019', date: '2019-10-07', tournament: 'Shanghai Masters', round: 'R64', opponent: 'O. Ld' })] };
    profiles[2072].careerByYear = [{ year: 2021, allTier: true, total: { won: 1, lost: 1 }, hard: { won: 1, lost: 1 } }];
    await writeCareerHistoryShards(profiles, { archive, log: () => {}, currentYear: 2026 });
    const shard = JSON.parse(fs.readFileSync(path.join(tmp, 'career-history', '2072.json'), 'utf8'));
    const idx = JSON.parse(fs.readFileSync(path.join(tmp, 'career-history-index.json'), 'utf8'));
    check('writer (2026): the 2021 TML row reaches the shard, tagged holeFill and src archive', () => {
      const r = shard.matches.find((m) => m.tournament === 'Miami Masters');
      assert.ok(r && r.holeFill === true && r.src === 'archive');
    });
    check('writer (2026): the duplicates never reach the shard', () => {
      assert.ok(!shard.matches.some((m) => m.tournament === 'Great Ocean Road Open' || m.tournament === "Queen's Club" || (m.tournament === 'London' && m.src === 'archive')));
    });
    check('writer (2026): pre-window TML rows are unchanged (2019, 2020 in; no holeFill tag)', () => {
      const pre = shard.matches.filter((m) => m.src === 'archive' && !m.holeFill).map((m) => m.year).sort();
      assert.deepStrictEqual(pre, ['2019', '2020']);
    });
    check('writer (2026): the index publishes the fill (offered / kept / players)', () => assert.deepStrictEqual(idx.meta.holeFill['2021'], { offered: 4, kept: 1, players: 1 }));
    check('writer (2026): the 2021 Overview cell adopts the filled rows (the feed named 2, the rows name 5)', () => {
      const c = profiles[2072].careerByYear[0];
      assert.deepStrictEqual([c.rows, c.total.won + c.total.lost], [5, 5]);
    });
    // 2027: 2021 is an ordinary archive year — every TML 2021 row goes in as archive, no fill, no tag
    const p2 = { 2072: { name: 'J. Sinner', careerMatches: [] } };
    await writeCareerHistoryShards(p2, { archive, log: () => {}, currentYear: 2027 });
    const s2 = JSON.parse(fs.readFileSync(path.join(tmp, 'career-history', '2072.json'), 'utf8'));
    const i2 = JSON.parse(fs.readFileSync(path.join(tmp, 'career-history-index.json'), 'utf8'));
    check('writer (2027): 2021 is a normal archive year — no holeFill tag, no holeFill meta', () => {
      assert.ok(!s2.matches.some((m) => m.holeFill));
      assert.deepStrictEqual(i2.meta.holeFill, {});
      assert.deepStrictEqual(s2.matches.filter((m) => m.year === '2021').length, 4);
    });
  } finally { process.chdir(cwd); }
  console.log(`\nten310-hole-fill: ${pass} passed, ${fail} failed.`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
