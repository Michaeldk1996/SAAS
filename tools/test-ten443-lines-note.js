// tools/test-ten443-lines-note.js — TEN-443 (founder ruling 2026-10-17, comment 549b93d3 item 2): the Lines tab note
// names the matches whose per-set list is short of the result ("K with a set missing in the feed" — api-tennis drops
// a set one player won no games in), and the clause goes away as those rows are repaired.
//
// On the pinned TEN-384 fixture (Korda) plus constructed rows, through the page's own lineCoverage + renderLinesTab:
//   * two short rows -> the note says "; 2 with a set missing in the feed", and they are among the matches that are
//     NOT in the games-lines X ("X of N");
//   * a row whose list is short because it is EMPTY of games (no list at all) is not counted as a missing set;
//   * the same rows repaired (full list) -> K falls back by 2 and X rises by 2; every short row repaired -> no clause;
//   * a list LONGER than the result (fx7 junk trim) is not a missing set.
// Run: node tools/test-ten443-lines-note.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const L = require('./ten384-figures-lib.js');
const TI = require(path.join(L.ROOT, 'tournament-identity.js'));
const H = L.harness();
const T = L.text;

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten384-figures', 'player-2840.json'), 'utf8'));
function mod(extraRows) {
  const p = Object.assign({}, FX.profile);
  delete p.tournamentHistory;
  p.tournamentHistory = TI.mergeHistory ? TI.mergeHistory(FX.tournamentHistory) : FX.tournamentHistory;
  const m = L.loadPp2({
    src: path.join(L.ROOT, 'player-profile-v2.js'), now: FX.asOf, players: { [FX.key]: p },
    careerHistory: { [FX.key]: FX.careerHistory.concat(extraRows || []) },
    marketEdge: { [FX.key]: FX.marketEdge }, bet365History: FX.bet365History, extra: { TournamentIdentity: TI }
  });
  return { I: m.I, p };
}
function note(I, p) {
  const saved = Object.assign({}, I.state);
  Object.assign(I.state, { key: p.key, marketTab: 'lines', lcFmt: 'bo3', lcRole: 'all' });
  try { const t = T(I.renderLinesTab(p)); return (t.match(/Lines are derived[\s\S]*$/) || [''])[0]; }
  finally { Object.keys(I.state).forEach(k => delete I.state[k]); Object.assign(I.state, saved); }
}
const row = (d, opp, sets, result) => ({ year: '2022', surface: 'hard', level: 'chitf', date: d, tournament: 'Challenger X', round: 'R32',
  opponent: opp, result: result || '2 - 1', won: true, bestOf: 3, src: 'fixtures', sets });
// two rows as api-tennis holds them (the 6-0 set dropped) and the same two repaired
const SHORT = [row('2022-03-01', 'B. Bravo', [{ p: 4, o: 6 }, { p: 6, o: 3 }]), row('2022-04-05', 'C. Charlie', [{ p: 6, o: 3 }, { p: 3, o: 6 }])];
const FULL = [row('2022-03-01', 'B. Bravo', [{ p: 4, o: 6 }, { p: 6, o: 3 }, { p: 6, o: 0 }]), row('2022-04-05', 'C. Charlie', [{ p: 6, o: 3 }, { p: 3, o: 6 }, { p: 6, o: 0 }])];
const NOLIST = [row('2022-05-10', 'D. Delta', [])];
const LONG = [row('2022-06-14', 'E. Echo', [{ p: 6, o: 4 }, { p: 3, o: 6 }, { p: 6, o: 3 }, { p: 1, o: 0 }], '2 - 1')];

function main() {
  const base = mod(), s = mod(SHORT), f = mod(FULL);
  const cb = base.I.lineCoverage(base.p, 'bo3', 'all'), cs = s.I.lineCoverage(s.p, 'bo3', 'all'), cf = f.I.lineCoverage(f.p, 'bo3', 'all');
  H.check('two short rows: the note names them, and they sit outside the games-lines X', () => {
    const t = note(s.I, s.p);
    const want = 'Games lines rest on the ' + cs.withGames + ' of ' + cs.n + ' with per-set games; ' + (cb.setMissing + 2) + ' with a set missing in the feed.';
    assert.ok(t.includes(want), 'note: ' + t.slice(-260));
    assert.strictEqual(cs.n, cb.n + 2); assert.strictEqual(cs.withGames, cb.withGames);
    return want;
  });
  H.check('the same rows repaired: K falls back to the fixture\'s own short rows and X rises by 2', () => {
    assert.ok(cb.setMissing > 0, 'the fixture should carry short rows of its own (Korda: 3 on 2026-10-17)');
    assert.strictEqual(cf.setMissing, cb.setMissing);
    assert.ok(note(f.I, f.p).includes('; ' + cb.setMissing + ' with a set missing in the feed.'));
    assert.strictEqual(cf.withGames, cs.withGames + 2);
    return 'K ' + cs.setMissing + ' -> ' + cf.setMissing + ', X ' + cs.withGames + ' -> ' + cf.withGames + ' of ' + cf.n;
  });
  H.check('every short row repaired: the clause drops out of the note', () => {
    const fixed = FX.careerHistory; const m = mod([]);
    // the page with K = 0: strip the fixture's short rows from the store
    const shortOf = r => { const x = String(r.result || '').match(/^(\d+)\s*-\s*(\d+)$/); const w = (r.sets || []).filter(q => q.p > q.o).length, l = (r.sets || []).filter(q => q.o > q.p).length; return x && (w || l) && +x[1] !== +x[2] && +x[1] + +x[2] > w + l; };
    const store = FX.careerHistory.filter(r => !shortOf(r));
    const m2 = L.loadPp2({ src: path.join(L.ROOT, 'player-profile-v2.js'), now: FX.asOf, players: { [FX.key]: m.p }, careerHistory: { [FX.key]: store },
      marketEdge: { [FX.key]: FX.marketEdge }, bet365History: FX.bet365History, extra: { TournamentIdentity: TI } });
    assert.strictEqual(m2.I.lineCoverage(m.p, 'bo3', 'all').setMissing + m2.I.lineCoverage(m.p, 'bo5', 'all').setMissing, 0);
    assert.ok(!/set missing in the feed/.test(note(m2.I, m.p)), 'note still names a missing set');
    return fixed.length - store.length + ' fixture rows removed';
  });
  H.check('a row with no per-set list, and a list LONGER than the result, are not "a set missing"', () => {
    const m = mod(NOLIST.concat(LONG)); const c = m.I.lineCoverage(m.p, 'bo3', 'all');
    assert.strictEqual(c.setMissing, cb.setMissing);
  });
  H.done();
}
main();
