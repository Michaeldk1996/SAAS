// TEN-244 follow-up — the best-of-five test must resolve the tournament NAME
// before it decides the ladder.
//
// THE DEFECT THIS LOCKS. career-history holds two vocabularies for one event:
// the archive half writes "Wimbledon", the fixtures half writes "ATP Wimbledon".
// Measured on the deployed store, 285 of 1,177 Slam rows carry the "ATP "
// prefix. `GRAND_SLAM_NAMES.has(r.tournament)` missed every one, so isBo5 was
// false and careerRowIsComplete tested `won === 2` on a best-of-five match.
// Because that test is a strict equality, the casualty was not the truncated
// match it was written to catch — it was the COMPLETED one: 3-0, 3-1 and 1-3
// all fail `won === 2` and were stamped `incomplete`. Measured: 175 of 842 Slam
// main-draw rows (20.8%) wrongly excluded, all on the fixtures half.
//
// Direction matters, so this asserts BOTH: a completed Slam match is kept, and
// a truncated one is still dropped. A fix that simply made isBo5 always true
// would pass the first and fail the second.

const assert = require('assert');
const { careerRowIsComplete } = require('../bsp-pipeline.js');
const { canonicalTournament } = require('../tournament-identity');

const GRAND_SLAM_NAMES = new Set(['Australian Open', 'French Open', 'Roland Garros', 'Wimbledon', 'US Open']);

// The production rule, lifted verbatim from writeCareerHistoryShards.
const isBo5 = r => GRAND_SLAM_NAMES.has(canonicalTournament(r.tournament).display)
  && !/qualif/i.test(String(r.round || ''));
// The rule as it was, kept as the FAILING CONTROL.
const isBo5Raw = r => GRAND_SLAM_NAMES.has(String(r.tournament || '').trim())
  && !/qualif/i.test(String(r.round || ''));

const complete = r => !r.retired && !r.walkover && careerRowIsComplete(r.result, isBo5(r));

let pass = 0; const fails = [];
function t(name, fn) {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fails.push(name); console.log(`  FAIL ${name}\n       ${e.message}`); }
}

// Every Slam string the deployed store actually carries.
const SLAM_NAMES = [
  'Wimbledon', 'US Open', 'Australian Open', 'French Open', 'Roland Garros',
  'ATP Wimbledon', 'ATP US Open', 'ATP Australian Open', 'ATP French Open', 'ATP Roland Garros',
];

t('every Slam name the store carries resolves to the best-of-five ladder', () => {
  for (const n of SLAM_NAMES) {
    assert.strictEqual(isBo5({ tournament: n, round: 'R32' }), true, `${n} must be Bo5`);
  }
});

t('CONTROL: the raw-string rule missed the "ATP " half entirely', () => {
  const missed = SLAM_NAMES.filter(n => !isBo5Raw({ tournament: n, round: 'R32' }));
  assert.deepStrictEqual(missed,
    ['ATP Wimbledon', 'ATP US Open', 'ATP Australian Open', 'ATP French Open', 'ATP Roland Garros'],
    'if this list is empty the control is broken and the test below proves nothing');
});

t('a COMPLETED best-of-five is kept under either vocabulary', () => {
  for (const n of SLAM_NAMES) {
    for (const [result, won] of [['3 - 0', true], ['3 - 1', true], ['3 - 2', true], ['0 - 3', false], ['1 - 3', false], ['2 - 3', false]]) {
      assert.strictEqual(complete({ tournament: n, round: 'R32', result, won }), true,
        `${n} ${result} is a completed Slam match and must NOT be excluded`);
    }
  }
});

t('...and THAT is what the raw-string rule got wrong', () => {
  // The regression, stated as the bug: a real completed Slam match, excluded.
  const row = { tournament: 'ATP French Open', round: 'R32', result: '1 - 3', won: false };
  assert.strictEqual(careerRowIsComplete(row.result, isBo5Raw(row)), false,
    'CONTROL BROKEN: the old rule must mis-judge this row');
  assert.strictEqual(careerRowIsComplete(row.result, isBo5(row)), true);
});

t('a TRUNCATED best-of-five is still dropped — the fix did not just widen', () => {
  for (const n of SLAM_NAMES) {
    for (const [result, won] of [['2 - 0', true], ['2 - 1', true], ['0 - 2', false], ['1 - 1', true], ['0 - 0', false]]) {
      assert.strictEqual(careerRowIsComplete(result, isBo5({ tournament: n, round: 'R32' })), false,
        `${n} ${result} never reached three sets and must be excluded`);
    }
  }
});

t('Slam QUALIFYING stays best-of-three under both vocabularies', () => {
  for (const n of ['Wimbledon', 'ATP Wimbledon']) {
    const r = { tournament: n, round: 'Qualifying', result: '2 - 0', won: true };
    assert.strictEqual(isBo5(r), false);
    assert.strictEqual(complete(r), true, 'a 2-0 qualifying win IS complete');
  }
});

t('a non-Slam event is untouched by the canonicalisation', () => {
  for (const n of ['Indian Wells', 'ATP Indian Wells', 'Canada Masters', 'ATP Canadian Open', 'Tour Finals']) {
    assert.strictEqual(isBo5({ tournament: n, round: 'R32' }), false, `${n} must stay Bo3`);
    assert.strictEqual(complete({ tournament: n, round: 'R32', result: '2 - 1', won: true }), true);
    assert.strictEqual(complete({ tournament: n, round: 'R32', result: '3 - 1', won: true }), false,
      'three sets won at a Bo3 event is not a shape this ladder can produce');
  }
});

t('the flags still exclude a retirement that reached a legal set count', () => {
  assert.strictEqual(complete({ tournament: 'Indian Wells', round: 'R32', result: '2 - 0', won: true, retired: true }), false);
  assert.strictEqual(complete({ tournament: 'ATP Wimbledon', round: 'R32', result: '3 - 1', won: true, retired: true }), false);
});

// ── The gate: drive the REAL writer, not a copy of the rule ──────────────────
// Everything above re-implements `isBo5` locally, so on its own it would still
// pass if bsp-pipeline.js were reverted — it tests the rule, not the code path.
// This drives writeCareerHistoryShards itself and reads the shard it writes.
// (Against pristine main this produces `incomplete: true` on the "ATP French
// Open" row and `false` on the identical "Wimbledon" one — the bug, in two
// lines of output.)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeCareerHistoryShards } = require('../bsp-pipeline.js');

const KEY = 888001;
const row = (tournament, result, won, date) => ({
  year: '2024', surface: 'clay', level: 'atp', date, tournament, round: 'R32',
  opponent: 'X. Opponent', result, won, src: 'fixtures',
});

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten244b-'));
  const cwd = process.cwd();
  process.chdir(tmp);
  let shard;
  try {
    // `archive: {}` keeps this offline. tml-cache/ is gitignored and fetched on
    // demand, so without the seam this test would either hit the TML upstream
    // from CI or pass against whatever the local box had cached — the class of
    // failure where a green suite means "my checkout had something CI doesn't".
    await writeCareerHistoryShards({
      [KEY]: {
        key: KEY,
        careerByYear: [],
        careerMatches: [
          row('ATP French Open', '1 - 3', false, '2024-05-30'),   // completed Bo5 loss
          row('Wimbledon', '3 - 1', true, '2024-07-05'),          // completed Bo5 win
          row('ATP Wimbledon', '2 - 0', true, '2024-07-06'),      // TRUNCATED Bo5
          row('ATP Indian Wells', '2 - 1', true, '2024-03-10'),   // completed Bo3
        ],
      },
    }, { log: () => {}, archive: {} });
    shard = JSON.parse(fs.readFileSync(`career-history/${KEY}.json`, 'utf8'));
  } finally {
    process.chdir(cwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const by = {};
  for (const m of shard.matches) by[m.tournament] = !!m.incomplete;

  t('REAL WRITER: a completed Slam match is kept under BOTH vocabularies', () => {
    assert.strictEqual(by['Wimbledon'], false, '"Wimbledon" 3 - 1 must be complete');
    assert.strictEqual(by['ATP French Open'], false,
      '"ATP French Open" 1 - 3 is the SAME shape as the row above and must also ' +
      'be complete — if this is true, the "ATP " prefix is defeating isBo5 again');
  });

  t('REAL WRITER: a truncated Slam match is still excluded', () => {
    assert.strictEqual(by['ATP Wimbledon'], true, '2 - 0 never reached three sets');
  });

  t('REAL WRITER: a completed best-of-three is kept', () => {
    assert.strictEqual(by['ATP Indian Wells'], false);
  });

  t('REAL WRITER: the shard\'s own excluded count agrees with its rows', () => {
    assert.strictEqual(shard.incomplete, shard.matches.filter(m => m.incomplete).length);
    assert.strictEqual(shard.incomplete, 1);
  });

  console.log(`\nten244 Slam Bo5 naming: ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`  - ${f}`)); process.exit(1); }
})();
