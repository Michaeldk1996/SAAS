#!/usr/bin/env node
// tools/test-walkover-rows.js — founder rulings 2026-10-22: a walkover (explicit flag) and an unconfirmed Tennis Explorer
// empty score are LISTED in every match list and counted in no W–L or stat-based figure.
//
// On the pinned fixture tools/fixtures/ten384-figures/player-2840.json (S. Korda, the module's clock pinned to its asOf;
// identical in every checkout, CI included) plus his four real api-tennis walkovers (2023–2025: Winston-Salem SF given ×2,
// Montreal R16 and Adelaide QF received) and one unconfirmed record row:
//   A · RECORD: every profile W–L / stat figure (Career, Last 52, Calendar, Court speed bands on every surface chip,
//       Playing styles, the Last 52 grid, the residual, the ledger head) is identical with and without those rows;
//   B · RENDER: each list paints them — the record drill, Court speed, the Calendar month drill and the Full ledger;
//   C · CONTROL: the same check on a mutant module that lets the rows into the played spine MUST go red (not vacuous).
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const assert = require('assert');
const L = require('./ten384-figures-lib.js');
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten384-figures', 'player-2840.json'), 'utf8'));
const H = L.harness();
const KEY = FX.key;
// the four walkovers, as playerMatchHistory writes them (api-tennis event keys 11892157, 11973716, 12006659, 12064273)
const wo = (date, tournament, round, opponent, won, ek) => ({ year: date.slice(0, 4), surface: 'hard', level: 'atp', date, tournament, round,
  opponent, result: '-', won, eventKey: ek, src: 'fixtures', indoor: false, walkover: true, incomplete: true });
const WO = [
  wo('2023-08-25', 'ATP Winston-Salem', 'Semi-finals', 'J. Lehecka', false, 11892157),
  wo('2024-08-10', 'Montreal', '1/8-finals', 'C. Ruud', true, 11973716),
  wo('2025-01-09', 'ATP Adelaide', 'Quarter-finals', 'T. Kokkinakis', true, 12006659),
  wo('2025-08-22', 'Winston-Salem', 'Semi-finals', 'M. Fucsovics', false, 12064273),
];
// an unconfirmed TE empty score (ruling 6), carried by the record overlay's TE-only rows
const UNCONF = { year: '2025', surface: 'hard', level: 'chitf', date: '2025-03-03', tournament: 'Futures 2025', round: 'Q-1R',
  opponent: 'Z. Unconfirmed', result: '-', won: false, src: 'te', incomplete: true, unconfirmed: true, indoor: false };
const byDate = (a, b) => String(b.date).localeCompare(String(a.date));
const plain = FX.careerHistory.slice();
const withRows = FX.careerHistory.concat(WO).sort(byDate);
const profile = (walkovers) => {
  const p = JSON.parse(JSON.stringify(FX.profile));
  // the ledger lists recentForm (2026-01-05 … 2026-03-24 in the fixture): a SYNTHETIC walkover inside that span, test-only
  if (walkovers) p.recentForm = Object.assign({}, p.recentForm, { walkovers: [{ opponent: 'X. Walkover', date: '2026-02-10', tournament: 'Test Open',
    round: 'Test Open - 1/8-finals', surface: 'hard', result: '-', won: true, sets: [], retired: false, walkover: true, qualifying: false, tier: 'atp', eventKey: null }] });
  return p;
};
function load(src, ch, withOverlay, walkovers) {
  const p = profile(walkovers);
  // both sides carry the record overlay (its presence alone changes the record's code path); only the unconfirmed row differs
  const extra = { careerRecord: { [KEY]: { v: 1, over: [], out: [], add: withOverlay ? [UNCONF] : [] } } };
  const { I } = L.loadPp2({ src, now: FX.asOf, players: { [KEY]: p }, careerHistory: { [KEY]: ch }, marketEdge: { [KEY]: FX.marketEdge },
    bet365History: FX.bet365History || {}, extra });
  return { I, p };
}
function figures(I, p) {
  const R = L.readers(I), f = {};
  f.career = R.readCareer(p).total;
  const l = R.readL52(p); f.l52 = [l.won, l.lost, l.undated];
  const c = R.readCal(p); f.cal = [c.total, c.undated, c.outside, c.n.join(',')];
  f.calWin = R.calWindow(p);
  for (const s of ['all', 'Indoors', 'Hard', 'Clay', 'Grass']) {
    I.state.speedSurf = s;
    const b = I.speedBands(p); f['speed:' + s] = b.map((x) => [x.band.id, x.won, x.lost, x.cents, x.priced].join('/')).join(' ') + ' u' + b.unbanded + ' s' + b.scoped;
  }
  I.state.speedSurf = 'all';
  f.style = I.styleRows(p).map((r) => [r.axis.label, r.won, r.lost, r.cents, r.priced].join('/')).join(' ');
  const g = I.last52GridCells(p, 'all'); f.l52grid = g ? JSON.stringify([g.total, g.undated]) : null;
  f.resid = JSON.stringify(I.calResidual(p));
  f.ledger = JSON.stringify(R.readLedger(p).head);
  f.careerByYear = JSON.stringify(p.careerByYear);
  return f;
}
const SRC = path.join(L.ROOT, 'player-profile-v2.js');
const base = figures(...Object.values(load(SRC, plain, false, false)));
const B = load(SRC, withRows, true, true);
const after = figures(B.I, B.p);

H.check('A · a walkover or unconfirmed row moves no profile W–L or stat figure (Career, Last 52, Calendar, Court speed, styles, ledger)', () => {
  assert.deepStrictEqual(after, base);
  return `${Object.keys(base).length} figures identical with ${WO.length} walkover rows and 1 unconfirmed row added`;
});
H.check('A · the played spine holds none of them; calSpineAll lists all four walkovers', () => {
  assert.ok(!B.I.calSpine(B.p).some((r) => r.wo || r.unconf), 'a listed row reached the played spine');
  assert.deepStrictEqual(B.I.calSpineAll(B.p).filter((r) => r.wo).map((r) => r.date).sort(), WO.map((w) => w.date).sort());
});
H.check('B · RENDER: the 2025 record drill paints both 2025 walkovers (WO under the date) and the unconfirmed row; its W–L counts only matches', () => {
  const I = B.I; I.resetState(); I.state.key = KEY; I.state.careerTab = 'record'; I.state.careerScope = 'career'; I.state.careerTier = 'all';
  I.state.careerDrill = { kind: 'cell', year: '2025', surf: '' };
  const html = I.renderCareerModal(B.p);
  assert.strictEqual((html.match(/data-pp2-drill-row="WO"/g) || []).length, 2, 'two walkover rows');
  assert.strictEqual((html.match(/data-pp2-drill-row="U"/g) || []).length, 1, 'one unconfirmed row');
  assert.ok(/data-pp2-wo="1"[^>]*>WO</.test(html) && html.includes('Kokkinakis') && html.includes('Fucsovics'));
  assert.ok(html.includes('unconfirmed, not counted'));
  const y = B.p.careerByYear.find((r) => String(r.year) === '2025');
  assert.strictEqual((html.match(/data-pp2-drill-row="[WL]"/g) || []).length, y.total.won + y.total.lost, 'the list counts the cell');
});
H.check('B · RENDER: Court speed lists the walkover in its band and counts it nowhere', () => {
  const I = B.I; I.resetState(); I.state.key = KEY; I.state.speedSurf = 'all';
  const band = I.speedBands(B.p).find((b) => (b.listed || []).some((m) => m.date === '2025-08-22'));
  assert.ok(band, 'the 2025 Winston-Salem walkover is banded');
  I.state.speedBand = band.band.id;
  const html = I.renderSpeedModal(B.p);
  assert.ok(/data-pp2-wo-row="1"/.test(html) && html.includes('Fucsovics'), 'painted in the band list');
  assert.ok(/walkovers?, not counted/.test(L.text(html)), 'the header says it is not counted');
});
H.check('B · RENDER: the Calendar month drill (Aug 2025) lists the walkover', () => {
  const I = B.I; I.resetState(); I.state.key = KEY; I.state.calTab = 'calendar'; I.state.calSurface = 'all'; I.state.calCell = '2025|7';
  const html = I.renderSeasonModal(B.p);
  assert.ok(/data-pp2-cal-drill="1"/.test(html), 'the month drill opened');
  assert.ok(/data-pp2-wo-row="1"/.test(html) && html.includes('Fucsovics'));
});
H.check('B · RENDER: the Full ledger lists the walkover inside the span it shows', () => {
  const I = B.I; I.resetState(); I.state.key = KEY; I.state.ledgerOpen = true; I.state.ledgerExpanded = true;
  const html = I.renderLedger(B.p, Object.assign(I.build(B.p), { ledgerOpen: true }));
  assert.ok(/data-pp2-wo-row="1"/.test(html) && html.includes('Walkover'), 'the walkover row is painted');
});
// C · the control: a module whose played spine lets the rows in must be caught by check A
const mutSrc = fs.readFileSync(SRC, 'utf8').replace("var rows = dated.filter(function (r) { return !r.walkover && !r.unconfirmed; });", 'var rows = dated;');
const mutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wo-mut-')), 'pp2.js');
fs.writeFileSync(mutFile, mutSrc);
H.mustFail('C · CONTROL: a played spine that counts walkovers moves the figures', () => {
  assert.notStrictEqual(mutSrc, fs.readFileSync(SRC, 'utf8'), 'the mutation did not apply');
  const M = load(mutFile, withRows, true, true);
  assert.deepStrictEqual(figures(M.I, M.p), base);
});
fs.rmSync(path.dirname(mutFile), { recursive: true, force: true });
H.done();
