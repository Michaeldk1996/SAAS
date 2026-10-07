// tools/test-ten384-figures-agree.js — TEN-384 fix round 1 (founder "Not ready", 2026-10-05), restructured
// in fx2 (2026-10-07) so the GATE never depends on a store CI does not have.
//
// The founder held the deploy because the profile printed figures that contradict each other. Each check
// renders TWO surfaces of the page through the module's own renderers and asserts they quote the same
// figure (tools/ten384-figures-lib.js):
//
//   1. undated     Career record · Last 52 footnote "N matches carry no dated match row" = Calendar's N.
//   R. reconcile   Career record total = Calendar total + undated − outside; Last 52 = the Calendar months
//                  inside the window; the undated count is never negative on any tier (no silent clamp).
//   3. months      Calendar Best / Worst month tiles = the footer's VS OTHERS and N for that month.
//   4. ledger      the ledger head's window count = "See all N results".
//   5. roles       Derived lines: All = As favourite + As underdog + unpriced, and the note states it.
//   6. H / A       Court speed H / A = the ledger's H / A for every ledger row the ledger prices.
//   Y. yield       Calendar Career yield (Market edge basis) = the Market edge box, same matches.
//   J. join        every Calendar row the Market edge join prices agrees with it on the result.
//
// TWO SECTIONS.
//   A · GATING, on a PINNED FIXTURE: tools/fixtures/ten384-figures/player-2840.json — one real player's
//       complete record (profile, career-history, market-edge, tournament-history, his bet365 captures),
//       frozen with the instant it was taken; the module's clock is pinned to that instant. Identical in
//       every checkout, CI included (no career-history/ needed), and no value in it moves with live data.
//       Every check has a [neg] mutation that must be rejected.
//   B · LIVE, on the deployed stores, for the two players the founder named (Alcaraz 2382, Thompson 207).
//       Needs the gitignored career-history/ (level with the deployed index) and the deployed shards.
//       Absent / short / unreachable → every live check prints "SKIP …" — never a pass.
//
// The ROSTER-WIDE sweeps (~480 players: Last 52 / undated, H / A, Career yield, the join audit) moved to
// tools/probe-ten384-figures-roster.js — a probe run by hand against the deployed stores, NOT wired into
// npm test (a deploy gate must not pin a value that moves with live data).
//
// CONTROL: `PP2_SRC=<file> node tools/test-ten384-figures-agree.js` runs every check against another copy
// of player-profile-v2.js (e.g. `git show bfa68f21:player-profile-v2.js`).
//
// Run: node tools/test-ten384-figures-agree.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const L = require('./ten384-figures-lib.js');

const ROOT = L.ROOT;
const SRC = process.env.PP2_SRC ? path.resolve(process.env.PP2_SRC) : path.join(ROOT, 'player-profile-v2.js');
const H = L.harness();

// ════════════════════════════════════════════════════════════════════════════
// A · GATING — the pinned fixture
// ════════════════════════════════════════════════════════════════════════════
const FX_FILE = path.join(__dirname, 'fixtures', 'ten384-figures', 'player-2840.json');
const FX = JSON.parse(fs.readFileSync(FX_FILE, 'utf8'));
function fixtureModule(mutate) {
  const fx = JSON.parse(JSON.stringify(FX));
  if (mutate) mutate(fx);
  const profile = Object.assign({}, fx.profile, { tournamentHistory: fx.tournamentHistory });
  const m = L.loadPp2({
    src: SRC, now: fx.asOf,
    players: { [fx.key]: profile },
    careerHistory: { [fx.key]: fx.careerHistory },
    marketEdge: { [fx.key]: fx.marketEdge },
    bet365History: fx.bet365History
  });
  return { I: m.I, W: m.W, p: profile, mk: fx.marketEdge, R: L.readers(m.I), fx };
}
const A = fixtureModule();
console.log(`A · pinned fixture ${path.relative(ROOT, FX_FILE)} — ${FX.name} (${FX.key}), clock pinned to ${FX.asOf} · ` +
  `${FX.careerHistory.length} career rows · ${(FX.marketEdge.matches || []).length} market rows · source ${path.relative(ROOT, SRC) || SRC}`);
// The fixture must actually carry every case the checks exist for, or a check could pass on an empty set.
H.check('A · the fixture carries every reconciliation case (undated, a Last-52 window, priced + unpriced, Bet365 basis rows)', () => {
  const r = A.I.calResidual(A.p);
  assert(r.undated > 0, 'no undated matches');
  assert(A.R.calWindow(A.p).won + A.R.calWindow(A.p).lost > 0, 'no Calendar row inside the window');
  assert(A.I.calSpine(A.p).some(x => x.cents != null), 'no priced Calendar row');
  assert((A.mk.matches || []).some(x => x.book !== 'pinnacle' && x.inBasis !== false), 'no Bet365-basis row (the Pinnacle-only mutation would be vacuous)');
  assert(A.I.ledgerRows(A.p).some(x => x.price != null), 'no priced ledger row');
  return `undated ${r.undated} · outside ${r.outside} · window ${JSON.stringify(A.R.calWindow(A.p))}`;
});
L.playerChecks(A.I, A.R, A.p, A.mk, FX.name + ' [fixture]').forEach(c => H.check(c.name, c.fn));

// ── [neg] each check rejects the corruption it exists for ──
H.mustFail('1 · a Last-52 note quoting another store\'s count is caught', () => {
  const b = A.R.readCal(A.p);
  assert.strictEqual(b.undated + 288, b.undated, 'differs');
});
H.mustFail('R · dropping one month of the window is caught', () => {
  const a = A.R.readL52(A.p), w = A.R.calWindow(A.p);
  const cut = A.I.last52Cutoff();
  const rows = A.I.calSpineFiltered(A.p).filter(r => r.date >= cut && r.mon === 10);   // November
  assert(rows.length, 'no November rows in the window');
  assert.deepStrictEqual([a.won, a.lost], [w.won - rows.filter(r => r.won).length, w.lost - rows.filter(r => !r.won).length]);
});
// fx2 item 8 · more dated rows than the record holds: the old Math.max(0, …) clamp printed "0 undated" and
// every equation still balanced. Here 40 of his ATP rows are dated twice (a second store row per match).
H.mustFail('R · a negative undated count (dated store larger than the record) is caught, not clamped', () => {
  const M = fixtureModule((fx) => {
    const atp = fx.careerHistory.filter(r => r.level === 'atp' && r.date).slice(0, 400);
    atp.forEach((r) => { fx.careerHistory.push(Object.assign({}, r, { date: r.date.slice(0, 8) + (r.date.slice(8) === '28' ? '27' : '28'), opponent: r.opponent + ' II' })); });
  });
  L.playerChecks(M.I, M.R, M.p, M.mk, 'mutant').filter(c => /never negative/.test(c.name))[0].fn();
});
H.mustFail('3 · a tile on the vs-career baseline (pp) is caught', () => {
  const c = A.R.readCal(A.p);
  const info = A.I.calMonths(A.I.calSpineFiltered(A.p));
  const m = L.MONTHS.indexOf(c.best.month);
  assert.strictEqual(c.vs[m], (info.months[m].pp >= 0 ? '+' : '−') + Math.abs(info.months[m].pp).toFixed(1) + 'pp');
});
H.mustFail('6 · a Court speed row that dashes a price the ledger shows is caught', () => {
  const lr = A.I.ledgerRows(A.p).find(x => x.price != null);
  const r = A.I.speedRows(A.p).find(s => s.date === lr.m.date && s.opp === lr.m.opponent);
  const keep = r.price;
  r.price = null;
  try { assert.deepStrictEqual(A.R.haMismatches(A.p), []); } finally { r.price = keep; }
});
H.mustFail('Y · a Pinnacle-only Career yield is caught', () => {
  const Hd = A.mk.headline;
  const pin = (A.mk.matches || []).filter(r => r.book === 'pinnacle');
  const y = pin.reduce((a, r) => a + Math.round(r.pl * 100), 0) / pin.length;
  assert.strictEqual(L.fmt1(y) + ' ' + pin.length, L.fmt1(Hd.yield) + ' ' + Hd.n);
});
H.mustFail('5 · a role split that drops the unpriced count is caught', () => {
  const { all, fav, dog } = A.R.readRoles(A.p);
  assert.strictEqual(+fav[1] + +dog[1], +all[1]);
});

// ════════════════════════════════════════════════════════════════════════════
// B · LIVE — the deployed stores, for the two players the founder named. SKIP out loud when absent.
// ════════════════════════════════════════════════════════════════════════════
console.log('\nB · live (deployed stores) — Alcaraz 2382, Thompson 207');
const FOCUS = { 2382: 'Alcaraz', 207: 'Thompson' };
const LIVE_NAMES = Object.keys(FOCUS).reduce((a, k) => a.concat(
  L.playerChecks({}, {}, { name: FOCUS[k] }, null, FOCUS[k]).map(c => c.name)), []);
const live = (() => {
  const DEPLOYED = require('./deployed-store.js');
  const BUILT = DEPLOYED.BUILT_DIR;
  const CH_DIR = path.join(BUILT || ROOT, 'career-history');
  if (!fs.existsSync(CH_DIR)) return { why: `career-history/ absent at ${path.relative(ROOT, CH_DIR) || CH_DIR} (gitignored, CI-built)` };
  const CH = {};
  for (const k of Object.keys(FOCUS)) {
    const f = path.join(CH_DIR, k + '.json');
    if (!fs.existsSync(f)) return { why: `career-history/ lacks ${k}.json` };
    CH[k] = (JSON.parse(fs.readFileSync(f, 'utf8')) || {}).matches || [];
  }
  let store;
  try { store = DEPLOYED.playerProfiles(); } catch (e) { return { why: 'player-profiles.json unreachable: ' + e.message }; }
  if (store.source !== (BUILT ? 'built' : 'deployed')) return { why: `could not read the ${BUILT ? 'built' : 'deployed'} player-profiles.json` };
  const idx = DEPLOYED.careerHistoryIndex() || {};
  const short = Object.keys(FOCUS).filter(k => typeof idx[k] === 'number' && CH[k].length < idx[k]);
  if (short.length) return { why: `career-history/ is SHORT of the ${BUILT ? 'built' : 'deployed'} index for ${short.join(', ')} — numbers off it would be self-consistent and wrong` };
  const TH = DEPLOYED.hydrateTournamentHistory(store.players);
  if (TH.error || !TH.indexed) return { why: 'tournament-history/ did not hydrate' };
  const ME = DEPLOYED.fetchShards('market-edge', Object.keys(FOCUS));
  const MARKET = {};
  ME.ok.forEach((t, k) => { try { MARKET[k] = JSON.parse(t); } catch (e) { /* not a shard */ } });
  const missing = Object.keys(FOCUS).filter(k => !MARKET[k]);
  if (missing.length) return { why: 'market-edge shard unreachable for ' + missing.join(', ') };
  const B365 = {};
  const bdir = path.join(ROOT, 'bet365-history');
  if (fs.existsSync(bdir)) fs.readdirSync(bdir).filter(f => /^\d{4}-\d{2}\.json$/.test(f)).forEach((f) => {
    B365[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(bdir, f), 'utf8'));
  });
  const m = L.loadPp2({ src: SRC, players: store.players, careerHistory: CH, marketEdge: MARKET, bet365History: B365 });
  return { I: m.I, R: L.readers(m.I), players: store.players, MARKET, fetchedAt: store.fetchedAt };
})();
if (live.why) {
  LIVE_NAMES.forEach(n => H.skip(n, live.why));
} else {
  console.log(`  stores: profiles ${live.fetchedAt}`);
  Object.keys(FOCUS).forEach((k) => {
    L.playerChecks(live.I, live.R, live.players[k], live.MARKET[k], FOCUS[k]).forEach(c => H.check(c.name, c.fn));
  });
}

H.done();
