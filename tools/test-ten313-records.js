#!/usr/bin/env node
// TEN-313 (founder rulings 2026-09-28 on TEN-312, .claude/rules/modal-analysis.md):
//   N3 — every careerByYear / p?Yearly year row reconciles: atp + chitf = total (the 2021
//        hole-fill rebuilds the tier split, indoor included), and a pre-2021 row carries an
//        ATP split only when it holds tour-level matches only.
//   N2 — a walkover, GIVEN or RECEIVED, is neither a win nor a loss anywhere (founder
//        2026-09-28, hold released: one spine, profile included): out of the form rows,
//        careerByYear, the career-history rows, the live Tournament history and every
//        tournament-history W-L. An in-match retirement still counts.
// Drives the REAL functions (bsp-pipeline.js, career-backfill.js, and the dashboard's
// Overview year table sliced out of the shipped HTML) — no network, no store.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const P = require('../bsp-pipeline.js');

let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); } };
const wl = (won, lost) => ({ won, lost });
const size = (c) => (c ? c.won + c.lost : 0);
const tiersSum = (r) => wl((r.atp && r.atp.total ? r.atp.total.won : 0) + (r.chitf && r.chitf.total ? r.chitf.total.won : 0),
  (r.atp && r.atp.total ? r.atp.total.lost : 0) + (r.chitf && r.chitf.total ? r.chitf.total.lost : 0));

// ── N3 · reconcileYearRows over a controlled 2021 hole year ──────────────────────────
// Pristine buildAllTierYearly row for 2021: the feed half only (2 ATP, 1 Challenger; 1 ATP indoor).
const pristine2021 = () => ({
  year: '2021', allTier: true, total: wl(2, 1), clay: null, hard: wl(2, 1), grass: null,
  indoor: { total: wl(1, 0), clay: null, hard: wl(1, 0), grass: null },
  atp: { total: wl(1, 1), clay: null, hard: wl(1, 1), grass: null, indoor: { total: wl(1, 0), clay: null, hard: wl(1, 0), grass: null } },
  chitf: { total: wl(1, 0), clay: null, hard: wl(1, 0), grass: null, indoor: null },
});
const rows2021 = [
  { year: '2021', surface: 'hard', level: 'atp', won: true, src: 'fixtures' },
  { year: '2021', surface: 'hard', level: 'atp', won: false, src: 'fixtures' },
  { year: '2021', surface: 'hard', level: 'chitf', won: true, src: 'fixtures' },
  // TML hole-fill rows: Miami (outdoor) final lost, Rotterdam (indoor) win, a clay win
  { year: '2021', surface: 'hard', level: 'atp', won: false, src: 'archive', holeFill: true },
  { year: '2021', surface: 'hard', level: 'atp', won: true, src: 'archive', holeFill: true, _indoor: true },
  { year: '2021', surface: 'clay', level: 'atp', won: true, src: 'archive', holeFill: true },
];
{
  const row = pristine2021();
  const adopted = P.reconcileYearRows([row], P.tallyCareerYears(rows2021));
  check('N3 2021: the hole year adopts the row tally (6 rows, 4-2)', () => { assert.ok(adopted.has(row)); assert.deepStrictEqual(row.total, wl(4, 2)); });
  // Mutation: drop `row.atp = atp;` in reconcileYearRows → atp stays 1-1 and this goes red.
  check('N3 2021: atp + chitf = total after the fill (atp 3-2, chitf 1-0)', () => {
    assert.deepStrictEqual(tiersSum(row), row.total);
    assert.deepStrictEqual([row.atp.total, row.chitf.total], [wl(3, 2), wl(1, 0)]);
  });
  check('N3 2021: the tier surface split is rebuilt too (atp clay 1-0, hard 2-2)', () => assert.deepStrictEqual([row.atp.clay, row.atp.hard], [wl(1, 0), wl(2, 2)]));
  // Mutation: drop the holeIndoor term (addIndoor(row[t].indoor, …) → row[t].indoor) → indoor stays 1-0.
  check('N3 2021: indoor = feed indoor + TML-indoor hole rows (2-0), on the tier and the row', () => {
    assert.deepStrictEqual(row.atp.indoor.total, wl(2, 0));
    assert.deepStrictEqual(row.indoor.total, wl(2, 0));
    assert.strictEqual(row.chitf.indoor, null);
  });
  check('control: a 2021 row with NO hole rows is left exactly as built', () => {
    const r = pristine2021(); const before = JSON.stringify(r);
    const a = P.reconcileYearRows([r], P.tallyCareerYears(rows2021.filter((x) => !x.holeFill)));
    assert.strictEqual(a.size, 0); assert.strictEqual(JSON.stringify(r), before);
  });
}

// ── N3 · pre-window rows ──────────────────────────────────────────────────────────────
{
  // What the OLD builder shipped (and a profile cached by it still carries): the all-tier
  // aggregate copied into `atp`. Giustino-shaped: 30 matches, 2 tour-level rows held.
  const oldShape = () => ({ year: '2018', allTier: false, total: wl(18, 12), clay: wl(10, 5), hard: wl(8, 7), grass: null, indoor: null,
    atp: { total: wl(18, 12), clay: wl(10, 5), hard: wl(8, 7), grass: null, indoor: null }, chitf: null });
  const tour2 = [{ year: '2018', surface: 'hard', level: 'atp', won: true, src: 'archive' }, { year: '2018', surface: 'hard', level: 'atp', won: false, src: 'archive' }];
  const r = oldShape();
  P.reconcileYearRows([r], P.tallyCareerYears(tour2));
  // Mutation: delete the `else if (row.allTier === false)` branch → atp stays 18-12 and this goes red.
  check('N3 pre-window: an aggregate the rows cannot name loses its ATP split (atp null), total kept', () => {
    assert.strictEqual(r.atp, null); assert.strictEqual(r.chitf, null); assert.deepStrictEqual(r.total, wl(18, 12));
  });
  check('N3 pre-window: the same holds for a player with no career-history rows at all', () => {
    const r2 = oldShape(); P.reconcileYearRows([r2], {}); assert.strictEqual(r2.atp, null);
  });
  // An aggregate the tour-level archive fully names adopts it: labelled ATP, and exact.
  const tour3 = [0, 1, 2].map((i) => ({ year: '2017', surface: 'clay', level: 'atp', won: i > 0, src: 'archive' }));
  const r3 = { year: '2017', allTier: false, total: wl(2, 1), clay: wl(2, 1), hard: null, grass: null, indoor: null, atp: null, chitf: null };
  P.reconcileYearRows([r3], P.tallyCareerYears(tour3));
  check('N3 pre-window: a fully named season is ATP = its tour-level rows, and atp + chitf = total', () => {
    assert.deepStrictEqual(r3.atp.total, wl(2, 1)); assert.strictEqual(r3.chitf, null);
    assert.deepStrictEqual(tiersSum(r3), r3.total); assert.strictEqual(r3.indoor, null);
  });
  // Mutation: restore `atp: { total: r.total, … }` in buildAllTierYearly's preRows → red.
  const stats = { stats: [{ type: 'singles', season: '2018', matches_won: '18', matches_lost: '12', clay_won: '10', clay_lost: '5', hard_won: '8', hard_lost: '7', grass_won: '', grass_lost: '' }] };
  const built = P.buildAllTierYearly([], '1', stats, new Date().getFullYear(), new Map(), new Map());
  check('N3 builder: buildAllTierYearly ships a pre-window aggregate with no tier split', () => {
    const b = built.find((x) => x.year === '2018');
    assert.ok(b && b.allTier === false); assert.strictEqual(b.atp, null); assert.strictEqual(b.chitf, null);
  });
}

// ── N2 · form rows ────────────────────────────────────────────────────────────────────
const fx = (o) => Object.assign({ event_type_type: 'Atp Singles', first_player_key: '1', second_player_key: '2', event_first_player: 'C. Alcaraz',
  event_second_player: 'T. Machac', tournament_key: '10', tournament_name: 'Barcelona', tournament_round: 'ATP Barcelona - 1/8-finals', event_qualification: 'False', scores: [] }, o);
const FORM = [
  fx({ event_key: 1, event_date: '2026-04-16', event_status: 'Walk Over', event_winner: 'Second Player', event_final_result: '0 - 0' }),   // W/O GIVEN by 1
  fx({ event_key: 2, event_date: '2026-04-15', event_status: 'Walk Over', event_winner: 'First Player', event_final_result: '0 - 0' }),    // W/O RECEIVED by 1
  fx({ event_key: 3, event_date: '2026-04-14', event_status: 'Retired', event_winner: 'Second Player', event_final_result: '0 - 1' }),     // 1 retired: a loss
  fx({ event_key: 4, event_date: '2026-04-13', event_status: 'Finished', event_winner: 'First Player', event_final_result: '2 - 0' }),
];
{
  const f = P.recentFormFromFixtures(FORM, '1', new Map([['10', 'clay']]));
  // Mutation: delete the `.filter(f => !isWalkover(f))` line → both walkovers return (W-L 2-2).
  check('N2 form: no walkover, given or received, becomes a form row', () => assert.ok(!f.matches.some((m) => m.eventKey === 1 || m.eventKey === 2)));
  check('N2 form: the retirement stays and is a loss; W-L = 1-1, pct 50', () => {
    const r = f.matches.find((m) => m.eventKey === 3); assert.ok(r && r.retired && r.won === false);
    assert.deepStrictEqual([f.matches.filter((m) => m.won).length, f.matches.filter((m) => !m.won).length, f.pct], [1, 1, 50]);
  });
  check('N2 form: the same holds from the OTHER side (his W/O received is not a win)', () => {
    const g = P.recentFormFromFixtures(FORM, '2', new Map());
    assert.ok(!g.matches.some((m) => m.walkover)); assert.strictEqual(g.matches.length, 2);
  });
  // Founder 2026-10-22: the walkovers are LISTED, in their own array (no form count reads it).
  // Mutation: return `walkovers: []` from recentFormFromFixtures → both rows vanish from the Form list.
  check('2026-10-22 form: both walkovers ride in `walkovers`, flagged, given = L and received = W', () => {
    assert.deepStrictEqual(f.walkovers.map((m) => [m.eventKey, m.walkover, m.won]), [[1, true, false], [2, true, true]]);
  });
}

// ── N2 · careerByYear and its row twin, built fresh (buildAllTierYearly / playerMatchHistory) ──
{
  const yr = String(new Date().getFullYear() - 1);
  const F = FORM.map((f) => ({ ...f, event_date: yr + f.event_date.slice(4), tournament_season: yr }));
  // Mutation: drop `if (isWalkover(f)) continue;` in buildAllTierYearly → the W/O received counts (2-1).
  check('N2 careerByYear: neither walkover counts; the retirement does (1-1)', () => {
    const rows = P.buildAllTierYearly(F, '1', { stats: [] }, new Date().getFullYear(), new Map([['10', 'clay']]), new Map());
    const r = rows.find((x) => x.year === yr);
    assert.deepStrictEqual([r.total, r.atp.total], [wl(1, 1), wl(1, 1)]);
  });
  // Founder 2026-10-22: the row twin LISTS both walkovers, flagged; its counted rows are still the 1-1 above.
  // Mutation: re-add `if (isWalkover(f)) continue;` in playerMatchHistory → 2 rows, no walkover row listed.
  check('2026-10-22 career-history rows: both walkovers are rows, flagged; the counted rows are the 1-1 above', () => {
    const rows = P.playerMatchHistory(F, '1', new Date().getFullYear(), new Map([['10', 'clay']]));
    assert.deepStrictEqual(rows.filter((m) => m.walkover).map((m) => [m.eventKey, m.won]).sort(), [[1, false], [2, true]]);
    const played = rows.filter((m) => !m.walkover);
    assert.deepStrictEqual([played.filter((m) => m.won).length, played.filter((m) => !m.won).length], [1, 1]);
  });
}

// ── N2 · the season / surface / court-speed records (same fixtures, same rule) ─────────
{
  const sf = (o) => Object.assign({ event_type_type: 'Atp Singles', first_player_key: '1', second_player_key: '2', tournament_key: '10',
    tournament_name: 'Barcelona', event_qualification: 'False', event_date: '2026-04-10' }, o);
  const S = [sf({ event_status: 'Walk Over', event_winner: 'First Player' }), sf({ event_status: 'Walk Over', event_winner: 'Second Player' }),
    sf({ event_status: 'Retired', event_winner: 'Second Player' }), sf({ event_status: 'Finished', event_winner: 'First Player' })];
  const sm = new Map([['10', 'clay']]);
  // Mutation: restore `isWalkoverGiven(f, won)` (received counts) in each builder → 2-1 instead of 1-1.
  check('N2 season row: 1-1 (retirement counted, both walkovers not)', () => assert.deepStrictEqual(P.seasonRowFromFixtures(S, '1', '2026', sm).total, wl(1, 1)));
  check('N2 season surface by tier: clay 1-1', () => {
    const c = P.seasonSurfaceByTier(S, '1', '2026', sm).atp.clay; assert.deepStrictEqual([c.won, c.lost, c.matches.length], [1, 1, 2]);
  });
  check('N2 court-speed record: 1-1 at Barcelona\'s category', () => {
    const r = P.courtSpeedRecordFromFixtures(S, '1', 'Slow'); assert.deepStrictEqual([r.wins, r.losses], [1, 1]);
  });
  // Mutation: drop the `walkover` carry / 'WD' in career-backfill mergePlayer → the pre-2021 walkovers count.
  check('N2 profile tournament history, pre-2021 (mergePlayer): a TML walkover carries its flag and is not counted', () => {
    const { _internal } = require('../career-backfill.js');
    const { history: hist } = _internal.mergePlayer([], [
      { tourney: 'Roland Garros', year: 2011, round: 'QF', oppName: 'N. Djokovic', won: false, walkover: true, score: 'W/O' },
      { tourney: 'Roland Garros', year: 2011, round: 'R16', oppName: 'A. Montanes', won: true, score: '4-6 6-4 3-6 6-3 11-9' }]);
    const t = hist.find((x) => /roland|french/i.test(x.name));
    const qf = t.editions[0].matches.find((m) => m.round === 'QF');
    assert.deepStrictEqual([qf.res, !!qf.walkover, t.won, t.lost], ['WD', true, 1, 0]);
  });
}

// ── N2 · live Tournament history (buildTournamentHistory) ─────────────────────────────
const tm = (o) => Object.assign({ p1: 'C. Alcaraz', p1Key: '1', p2: 'X', p2Key: '9', result: '2 - 0' }, o);
{
  const h = P.buildTournamentHistory([
    tm({ date: '2026-04-14', season: '2026', winner: 'First Player', round: 'ATP Barcelona - 1/16-finals' }),
    tm({ date: '2026-04-16', season: '2026', winner: 'Second Player', round: 'ATP Barcelona - 1/8-finals', walkover: true, result: '0 - 0' }),
    tm({ date: '2027-04-15', season: '2027', winner: 'Second Player', round: 'ATP Barcelona - 1/16-finals', walkover: true, result: '0 - 0' }),  // W/O given only, at the span's edge
    tm({ date: '2024-04-15', season: '2024', winner: 'Second Player', round: 'ATP Barcelona - 1/16-finals', result: '0 - 1' }),   // retired in-match
    tm({ date: '2023-04-15', season: '2023', winner: 'First Player', round: 'ATP Barcelona - Final', walkover: true, result: '0 - 0' }),  // W/O received
  ], '1');
  const y = (yr) => h.years.find((x) => x.year === yr);
  // Mutation: drop the `continue` in the `if (m.walkover) {…}` branch → 2026 reads 1-1 and totals 2-2.
  check('N2 tournament: a W/O given is not a loss (2026 1-0, reached R16 where he withdrew)', () => {
    assert.deepStrictEqual([y('2026').won, y('2026').lost, y('2026').matchCount], [1, 0, 1]);
    assert.strictEqual(y('2026').roundReached, '1/8-finals');
    // founder 2026-10-22: the W/O given is LISTED, flagged, with no score. Mutation: drop `.concat(woRows)` → not listed.
    assert.deepStrictEqual(y('2026').matches.filter((m) => m.round === '1/8-finals').map((m) => [m.walkover, m.won, m.result]), [[true, false, null]]);
  });
  // Founder 2026-10-22 (N6 reversed): an edition left only by a W/O given IS listed — 0-0, the round reached, its row.
  // Mutation: restore `|| woOnlyGiven[season]` → the 2027 edition vanishes (Vienna 2025 = QF would not show).
  check('2026-10-22 N6 reversed: an edition left by a W/O given is listed, 0-0, round reached, its walkover row', () => {
    assert.deepStrictEqual([y('2027').won, y('2027').lost, y('2027').matchCount, y('2027').roundReached], [0, 0, 0, '1/16-finals']);
    assert.deepStrictEqual(y('2027').matches.map((m) => [m.walkover, m.won]), [[true, false]]);
    assert.ok(!h.years.some((x) => x.withdrew));
  });
  check('N2 tournament: totals count the retirement as a loss and NOT the W/O received — 1-1', () => {
    assert.deepStrictEqual([h.totalWon, h.totalLost], [1, 1]);
  });
  check('N2 tournament: an edition of only a W/O received is 0-0, reached, not a Withdrawal', () => {
    assert.deepStrictEqual([y('2023').won, y('2023').lost, y('2023').roundReached, !!y('2023').withdrew], [0, 0, 'Final', false]);
  });
}

// ── N2 · tournament-history records (profile), recounted every run ─────────────────
{
  // A history cached under the old rule: header 3-1 counts the R16 W/O received as a win.
  const prof = { tournamentHistory: [{ name: 'Barcelona', won: 3, lost: 1, editions: [
    { year: 2026, matches: [{ res: 'W', round: 'R32' }, { res: 'W', round: 'R16', walkover: true }, { res: 'W', round: 'QF', ret: true }, { res: 'L', round: 'SF' }] },
    { year: 2025, matches: [{ res: 'WD', round: 'R32', walkover: true }] }] }] };
  // Mutation: drop `if (m.walkover) continue;` in recountTournamentRecords → header stays 3-1.
  check('N2 tournament-history: the header is recounted without walkovers (3-1 → 2-1), retirement counted', () => {
    assert.strictEqual(P.recountTournamentRecords(prof), 1);
    assert.deepStrictEqual([prof.tournamentHistory[0].won, prof.tournamentHistory[0].lost], [2, 1]);
    assert.strictEqual(P.recountTournamentRecords(prof), 0);   // idempotent: a second run moves nothing
  });
  // Mutation: drop `if (m.walkover) continue;` in career-backfill finalizeTournament → 2-0.
  check('N2 tournament-history (TML half): finalizeTournament skips a walkover received, keeps the walkover title', () => {
    const { _internal } = require('../career-backfill.js');
    const t = _internal.finalizeTournament('Rome', { 2019: [{ res: 'W', round: 'SF', opp: 'A' }, { res: 'W', round: 'F', opp: 'B', walkover: true }] });
    assert.deepStrictEqual([t.won, t.lost, t.titles], [1, 0, 1]);
  });
  // Mutation: count walkover rows in buildEmbeddedHistory → 2019 reads 2-1.
  // Mutation: re-add the only-given `continue` → the 2017 edition vanishes (N6 reversed 2026-10-22).
  check('N2 board tournament history (TML backfill): walkovers leave the W-L; an only-given edition is listed', () => {
    const { _internal } = require('../career-backfill.js');
    const { history } = _internal.buildEmbeddedHistory(null, [
      { year: 2019, round: 'R32', oppName: 'A', won: true, score: '6-3 6-4' },
      { year: 2019, round: 'R16', oppName: 'B', won: true, walkover: true, score: 'W/O' },
      { year: 2019, round: 'QF', oppName: 'C', won: false, score: '6-3 6-4' },
      { year: 2017, round: 'R32', oppName: 'D', won: false, walkover: true, score: 'W/O' }]);
    const y19 = history.years.find((y) => y.year === '2019'), y17 = history.years.find((y) => y.year === '2017');
    assert.deepStrictEqual([y19.won, y19.lost, y19.matchCount], [1, 1, 2]);
    assert.deepStrictEqual(y19.matches.filter((m) => m.walkover).map((m) => [m.opponent, m.won, m.result]), [['B', true, null]]);
    assert.deepStrictEqual([y17.won, y17.lost, y17.matchCount, y17.matches.map((m) => m.walkover)], [0, 0, 0, [true]]);
  });
  // Mutation: drop `.filter(m => !isWalkover(m))` from fetchH2H's officialH2H → a walkover is a meeting again.
  check('N2 H2H: fetchH2H keeps walkovers out of the meeting list (source)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'bsp-pipeline.js'), 'utf8');
    assert.ok(/filter\(h2hCountsInAtpRecord\)\.filter\(m => !isWalkover\(m\)\)/.test(src));
    assert.ok(/h2hCountsInAtpRecord\(m\) && !isWalkover\(m\)\)/.test(src));
    assert.strictEqual(P.isWalkover({ event_status: 'Walk Over' }), true);
    assert.strictEqual(P.isWalkover({ event_status: 'Retired' }), false);
  });
}

// ── N2 + N3 · the REAL writer: archive W/O given dropped, _indoor never shipped, tallies published ──
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ten313-'));
  const cwd = process.cwd();
  process.chdir(tmp);
  try {
    const tml = (o) => Object.assign({ level: 'atp', surface: 'hard', result: '2 - 0', round: 'R32' }, o);
    const archive = { 7: [
      tml({ year: '2019', date: '2019-05-01', tournament: 'Madrid Masters', opponent: 'A. B', won: false, walkover: true, result: '0 - 0' }), // W/O given
      tml({ year: '2019', date: '2019-04-01', tournament: 'Monte Carlo Masters', opponent: 'C. D', won: true, walkover: true, result: '0 - 0' }), // W/O received
      tml({ year: '2019', date: '2019-03-01', tournament: 'Miami Masters', opponent: 'E. F', won: true }),
      tml({ year: '2021', date: '2021-02-08', tournament: 'Rotterdam', opponent: 'G. H', won: true, _indoor: true }),
      tml({ year: '2021', date: '2021-03-22', tournament: 'Miami Masters', opponent: 'I. J', won: false, walkover: true, result: '0 - 0' }),      // W/O given in the hole
    ] };
    // careerMatches as a fresh (v16) profile carries it: a 2022 W/O received in the rows, flagged, and its
    // careerByYear NOT counting it (buildAllTierYearly skips it): 2022 is 1-1.
    const profiles = { 7: { name: 'P. Seven', careerMatches: [
        { year: '2021', surface: 'clay', level: 'chitf', date: '2021-06-01', tournament: 'Lyon Challenger', opponent: 'K. L', result: '2 - 0', won: true, src: 'fixtures' },
        { year: '2022', surface: 'hard', level: 'atp', date: '2022-03-10', tournament: 'Indian Wells', opponent: 'M. N', result: '0 - 0', won: true, walkover: true, src: 'fixtures' },
        { year: '2022', surface: 'hard', level: 'atp', date: '2022-03-12', tournament: 'Indian Wells', opponent: 'O. P', result: '2 - 1', won: true, src: 'fixtures' },
        { year: '2022', surface: 'clay', level: 'chitf', date: '2022-05-01', tournament: 'Rome Challenger', opponent: 'Q. R', result: '0 - 2', won: false, src: 'fixtures' },
      ],
      careerByYear: [
        { year: '2022', allTier: true, total: wl(1, 1), clay: wl(0, 1), hard: wl(1, 0), grass: null, indoor: { total: wl(1, 0), clay: null, hard: wl(1, 0), grass: null },
          atp: { total: wl(1, 0), clay: null, hard: wl(1, 0), grass: null, indoor: { total: wl(1, 0), clay: null, hard: wl(1, 0), grass: null } }, chitf: { total: wl(0, 1), clay: wl(0, 1), hard: null, grass: null, indoor: null } },
        { year: '2021', allTier: true, total: wl(1, 0), clay: wl(1, 0), hard: null, grass: null, indoor: null, atp: null, chitf: { total: wl(1, 0), clay: wl(1, 0), hard: null, grass: null, indoor: null } },
        { year: '2019', allTier: false, total: wl(1, 0), clay: null, hard: wl(1, 0), grass: null, indoor: null, atp: null, chitf: null },
      ] } };
    const tallies = new Map();
    await P.writeCareerHistoryShards(profiles, { archive, log: () => {}, currentYear: 2026, yearTallies: tallies });
    const shard = JSON.parse(fs.readFileSync(path.join(tmp, 'career-history', '7.json'), 'utf8'));
    // Founder 2026-10-22: both halves ship their flagged walkovers as rows, stamped incomplete. The 2021 hole's
    // W/O given is NOT offered to the fill (a walkover proves no edition was played) and the feed half has its own.
    // Mutation: filter walkovers out of tmlAll again → the two 2019 archive rows vanish.
    check('2026-10-22 writer: the flagged walkovers of both halves are shard rows, incomplete', () => {
      const wo = shard.matches.filter((m) => m.walkover);
      assert.deepStrictEqual(wo.map((m) => [m.tournament, m.src, m.incomplete]).sort(),
        [['Indian Wells', 'fixtures', true], ['Madrid Masters', 'archive', true], ['Monte Carlo Masters', 'archive', true]]);
    });
    // Mutation: drop `if (r.walkover) continue;` in tallyCareerYears → 2022 rows 3 (a walkover counted as a match).
    check('2026-10-22 writer: no year row counts a walkover row (2022 stays 1-1, rows 2; tiers sum)', () => {
      const r22 = profiles[7].careerByYear[0];
      assert.deepStrictEqual([r22.total, r22.hard, r22.atp.total, r22.chitf.total, r22.rows], [wl(1, 1), wl(1, 0), wl(1, 0), wl(0, 1), 2]);
      assert.deepStrictEqual(tiersSum(r22), r22.total);
      const t22 = tallies.get('7')['2022'];
      assert.deepStrictEqual([t22.rows, t22.total], [2, wl(1, 1)]);
    });
    check('N3 writer: _indoor is a build-time carrier, never written to a shard', () => assert.ok(!shard.matches.some((m) => '_indoor' in m)));
    // TEN-442 · Mutation: drop `if (r.holeFill) r.indoor = !!r._indoor;` → the Rotterdam hole row ships no court flag and
    // the 2021 Indoors drill cannot place the match the season row counts (atp indoor 1-0 below).
    check('TEN-442 writer: a 2021 hole-fill row ships the court flag the season row counted it on', () => {
      const hole = shard.matches.filter((m) => m.holeFill);
      assert.deepStrictEqual(hole.map((m) => [m.tournament, m.indoor]), [['Rotterdam', true]]);
    });
    const [, r21, r19] = profiles[7].careerByYear;
    check('N3 writer: 2021 adopts feed + fill, atp + chitf = total (atp 1-0 indoor 1-0, chitf 1-0)', () => {
      assert.deepStrictEqual(r21.total, wl(2, 0)); assert.deepStrictEqual(tiersSum(r21), r21.total);
      assert.deepStrictEqual(r21.atp.indoor.total, wl(1, 0)); assert.strictEqual(r21.rows, 2);
    });
    check('N3 writer: 2019 (1 named tour-level win, both walkovers gone) is ATP 1-0, atpOnly false', () => {
      assert.deepStrictEqual([r19.total, r19.atp.total, r19.atpOnly], [wl(1, 0), wl(1, 0), false]);
    });
    // Mutation: drop `if (opts.yearTallies) opts.yearTallies.set(...)` → the matches.json re-apply has nothing to read.
    check('N3 writer: the per-year tallies are published for the p1Yearly/p2Yearly re-apply', () => {
      const t = tallies.get('7'); assert.ok(t && t['2021'] && t['2021'].holeRows === 1);
      const modal = [JSON.parse(JSON.stringify({ ...r21, total: wl(1, 0), clay: wl(1, 0), hard: null, atp: null,
        chitf: { total: wl(1, 0), clay: wl(1, 0), hard: null, grass: null, indoor: null }, indoor: null }))];
      delete modal[0].rows; delete modal[0].atpOnly;
      P.reconcileYearRows(modal, t);
      assert.deepStrictEqual([modal[0].total, modal[0].atp.total, modal[0].chitf.total], [r21.total, r21.atp.total, r21.chitf.total]);
    });
    // Mutation: empty reconcileMatchesYearly's loop body → the modal copy keeps the feed's 1-0 and its null ATP split.
    check('N3 matches.json: reconcileMatchesYearly brings the modal copy to the profile row, and counts the sides', () => {
      const m = { p1Key: 7, p2Key: 99, p1Yearly: [{ year: '2021', allTier: true, total: wl(1, 0), clay: wl(1, 0), hard: null, grass: null, indoor: null, atp: null,
        chitf: { total: wl(1, 0), clay: wl(1, 0), hard: null, grass: null, indoor: null } }],
        p2Yearly: [{ year: '2018', allTier: false, total: wl(5, 5), clay: null, hard: wl(5, 5), grass: null, indoor: null, atp: { total: wl(5, 5) }, chitf: null }] };
      assert.strictEqual(P.reconcileMatchesYearly([m], tallies), 2);
      assert.deepStrictEqual([m.p1Yearly[0].total, m.p1Yearly[0].atp.total], [r21.total, r21.atp.total]);
      assert.strictEqual(m.p2Yearly[0].atp, null);   // no shard: the aggregate's false ATP split is still cleared
    });
  } finally { process.chdir(cwd); }

  // The run-order wiring is a source fact (runPipeline needs the network): the re-apply must
  // run after the career-history writer that fills the tallies, and must trigger the re-write.
  // Mutation: delete the reconcileMatchesYearly call, or drop `|| yearlySidesPatched > 0` → red.
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'bsp-pipeline.js'), 'utf8');
    check('N3 wiring: runPipeline re-applies to matches after the writer and re-writes matches.json', () => {
      // TEN-443: the writer also hands back the TE-merged tables (teYearly), and the re-apply copies them to the modal
      const w = src.indexOf('await writeCareerHistoryShards(allProfiles, { log: (m) => console.log(m), yearTallies: careerYearTallies, teYearly });');
      const c = src.indexOf('const yearlySidesPatched = reconcileMatchesYearly(matches, careerYearTallies, teYearly);');
      const r = src.indexOf('if (matchBf.patched > 0 || yearlySidesPatched > 0) {');
      assert.ok(w > 0 && c > w && r > c, `writer ${w}, re-apply ${c}, re-write ${r}`);
    });
  }

  // ── N3 · TML's own court type reaches the archive rows (the input of the 2021 indoor rebuild) ──
  {
    const { _internal } = require('../career-backfill.js');
    const hdr = 'tourney_id,tourney_name,surface,draw_size,tourney_level,indoor,tourney_date,match_num,winner_id,winner_seed,winner_entry,winner_name,winner_hand,winner_ht,winner_ioc,winner_age,winner_rank,winner_rank_points,loser_id,loser_seed,loser_entry,loser_name,loser_hand,loser_ht,loser_ioc,loser_age,loser_rank,loser_rank_points,score,best_of,round';
    const line = (id, indoor, w, l) => `2021-${id},Tourney ${id},Hard,32,A,${indoor},20210208,1,${w},,,W ${w},R,,ITA,,,,${l},,,L ${l},R,,ESP,,,,6-3 6-4,3,R32`;
    const idx = await _internal.buildTmlIndex(null, { csvByYear: { 2021: [hdr, line('a', 'I', 'w1', 'l1'), line('b', 'O', 'w2', 'l2'), line('c', '', 'w3', 'l3')].join('\n') } });
    const first = (id) => (idx.byId.get(id) || [])[0] || {};
    // Mutation: drop the `indoor:` key from buildTmlIndex's meta → every row reads undefined.
    check('N3 TML: indoor I → true, O → false, blank → null (unknown, never guessed)', () => {
      assert.deepStrictEqual([first('w1').indoor, first('l1').indoor, first('w2').indoor, first('w3').indoor], [true, true, false, null]);
    });
  }

  // ── N2 · the Head to Head page's meetings skip a walkover (source) ──
  // TEN-402: the page's meetings now come from both players' career-history shards (the tournament-history path is gone);
  // the walkover rule is one filter there, executed by test-ten402-b.mjs. Mutation: delete the filter → red.
  check('N2 dashboard H2H (career-history path): a walkover is not a meeting (source)', () => {
    const h = fs.readFileSync(path.join(__dirname, '..', 'bsp-consult-dashboard.html'), 'utf8');
    assert.ok(/S\.woN = S\.rows\.filter\(r => r\.wo\)\.length;[^\n]*\n\s*S\.rows = S\.rows\.filter\(r => !r\.wo\);/.test(h));
  });

  // ── N3 · the modal's "ATP" badge, sliced from the shipped dashboard and EXECUTED ──
  const html = fs.readFileSync(path.join(__dirname, '..', 'bsp-consult-dashboard.html'), 'utf8');
  const fnSource = (name) => {
    const m = new RegExp('\\nfunction ' + name + '\\s*\\(').exec(html);
    assert.ok(m, 'function ' + name + ' not found');
    let k = html.indexOf('{', m.index), d = 0, s = null, esc = false, c = null;
    for (; k < html.length; k++) {
      const ch = html[k];
      if (c) { if (c === '//' && ch === '\n') c = null; else if (c === '/*' && ch === '*' && html[k + 1] === '/') { c = null; k++; } }
      else if (s) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === s) s = null; }
      else if (ch === '"' || ch === "'" || ch === '`') s = ch;
      else if (ch === '/' && (html[k + 1] === '/' || html[k + 1] === '*')) { c = html[k + 1] === '/' ? '//' : '/*'; k++; }
      else if (ch === '{') d++;
      else if (ch === '}') { d--; if (d === 0) break; }
    }
    return html.slice(m.index + 1, k + 1);
  };
  // TEN-334: the Overview's real builder, sliced and run (tools/ten334-overview-vm.mjs); rows go in through playerProfiles.
  const { overviewVM } = await import('./ten334-overview-vm.mjs');
  const agg = { year: '2018', allTier: false, total: wl(18, 12), clay: null, hard: wl(18, 12), grass: null, indoor: null, atp: null, chitf: null };
  const tour = { year: '2017', allTier: false, total: wl(2, 1), clay: null, hard: wl(2, 1), grass: null, indoor: null, atp: { total: wl(2, 1), clay: null, hard: wl(2, 1), grass: null, indoor: null }, chitf: null };
  const out = (rows) => overviewVM(html, { profiles: { 7: { careerByYear: rows } } }).buildYearlyTables({ p1: 'A', p2: 'B', p1Key: 7, p2Key: null });
  const yearRow = (h, y) => { const i = h.indexOf(`data-ov-year="${y}"`); assert.ok(i >= 0, 'year row ' + y); return h.slice(i, h.indexOf('</span>', i)); };
  // Mutation: revert the badge condition to `r.allTier === false` → the aggregate row is badged ATP again.
  check('N3 modal: an all-tier aggregate year is NOT badged "ATP"', () => {
    assert.ok(!/class="ov-atp"/.test(yearRow(out([agg]), '2018')));
  });
  check('control: a tour-level-only pre-window year IS badged "ATP"', () => {
    assert.ok(/class="ov-atp"/.test(yearRow(out([tour]), '2017')));
  });

  console.log(`\nten313-records: ${pass} passed, ${fail} failed.`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
