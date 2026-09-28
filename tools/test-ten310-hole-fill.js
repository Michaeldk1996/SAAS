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
];
const tml = (o) => Object.assign({ year: '2021', level: 'atp', surface: 'hard', result: '2 - 0', won: true }, o);
const T = {
  miami: tml({ date: '2021-03-22', tournament: 'Miami Masters', round: 'F', opponent: 'H. Hurkacz', won: false }),
  gor: tml({ date: '2021-02-01', tournament: 'Great Ocean Road Open', round: 'R32', opponent: 'A. Vukic' }),      // same match, other event name
  queens: tml({ date: '2021-06-12', tournament: "Queen's Club", round: 'R32', opponent: 'P. Carreno Busta', won: false }), // same match, hyphen + event name
  sameEd: tml({ date: '2021-06-12', tournament: 'London', round: 'R16', opponent: 'Z. Other', won: true }),        // edition present in the feed
  otherRes: tml({ date: '2021-02-01', tournament: 'Great Ocean Road Open', round: 'R32', opponent: 'A. Vukic', won: false }),
  y2020: tml({ year: '2020', date: '2020-03-02', tournament: 'Dubai', round: 'R32', opponent: 'Y. Z' }),
};

check('the hole year is 2021', () => assert.deepStrictEqual(FIXTURE_HOLE_YEARS, [2021]));
check('a match the feed does not have is kept (Sinner, Miami 2021 final)', () => assert.deepStrictEqual(fillFixtureHole(feed, [T.miami], 2021), [T.miami]));
check('guard 2: the same match under another event name is dropped', () => assert.deepStrictEqual(fillFixtureHole(feed, [T.gor], 2021), []));
check('guard 2: a hyphenated surname and another event name still match', () => assert.deepStrictEqual(fillFixtureHole(feed, [T.queens], 2021), []));
check('guard 1: an edition the feed has is never topped up from TML', () => assert.deepStrictEqual(fillFixtureHole(feed, [T.sameEd], 2021), []));
check('only the named year is filled', () => assert.deepStrictEqual(fillFixtureHole(feed, [T.y2020], 2021), []));
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
    await writeCareerHistoryShards(profiles, { archive, log: () => {} });
    const shard = JSON.parse(fs.readFileSync(path.join(tmp, 'career-history', '2072.json'), 'utf8'));
    const idx = JSON.parse(fs.readFileSync(path.join(tmp, 'career-history-index.json'), 'utf8'));
    check('writer: the 2021 TML row reaches the shard, tagged holeFill and src archive', () => {
      const r = shard.matches.find((m) => m.tournament === 'Miami Masters');
      assert.ok(r && r.holeFill === true && r.src === 'archive');
    });
    check('writer: the duplicates never reach the shard', () => {
      assert.ok(!shard.matches.some((m) => m.tournament === 'Great Ocean Road Open' || m.tournament === "Queen's Club" || (m.tournament === 'London' && m.src === 'archive')));
    });
    check('writer: pre-window TML rows are unchanged (2019, 2020 in; no holeFill tag)', () => {
      const pre = shard.matches.filter((m) => m.src === 'archive' && !m.holeFill).map((m) => m.year).sort();
      assert.deepStrictEqual(pre, ['2019', '2020']);
    });
    check('writer: the index publishes the fill (offered / kept / players)', () => assert.deepStrictEqual(idx.meta.holeFill['2021'], { offered: 4, kept: 1, players: 1 }));
  } finally { process.chdir(cwd); }
  console.log(`\nten310-hole-fill: ${pass} passed, ${fail} failed.`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
