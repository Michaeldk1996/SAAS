#!/usr/bin/env node
// tools/test-pp6.js — Player Profile v6 (founder 2026-11-26). Each check runs the shipped renderer on the pinned fixture
// (tools/fixtures/ten384-figures/player-2840.json, module clock pinned to its asOf) and has a control that goes red
// without the ruling, so no check passes on an empty set.
//   streaks  the Calendar record is Calendar only: no Streaks tab, no switch, no run code
//   tiles    Best / Worst swing never dash while the window holds a match: the 20-match floor is Career's only; any
//            filter still fills all four tiles
//   bars     By swing bars = his win rate vs the other swings (not yield), scaled to the largest bar drawn (≤ 100%)
//   cols     a swing he never played in the selection has no column
//   drill    a calendar record opens centred on the screen
//   hover    the Recent form W/L squares and the ledger rows carry a hover outline
//   tourn    Record per tournament opens on ATP
//   sit      Record by situation: point-by-point rows fill on Last 52 weeks from situational.json's w52 node
'use strict';
const fs = require('fs'), path = require('path');
const assert = require('assert');
const L = require('./ten384-figures-lib.js');
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten384-figures', 'player-2840.json'), 'utf8'));
const H = L.harness();
const KEY = FX.key, p = FX.profile, T = L.text;
const SRC = fs.readFileSync(process.env.PP6_SRC || path.join(__dirname, '..', 'player-profile-v2.js'), 'utf8');
const { W, I } = L.loadPp2({ now: FX.asOf, players: { [KEY]: p }, careerHistory: { [KEY]: FX.careerHistory }, marketEdge: { [KEY]: FX.marketEdge },
  bet365History: FX.bet365History || {} });

function cal(o) {
  I.resetState(KEY);
  Object.assign(I.state, { key: KEY, modal: 'season', calWin: 'career', calSurf: 'all', calView: 'swing' }, o || {});
  return I.renderSeasonModal(p);
}
const tileNames = html => {
  const m = /data-pp2-caltiles="1"[\s\S]*?(?=<div data-pp2-calsc="a")/.exec(html);
  assert(m, 'no tiles');
  return [...m[0].matchAll(/font-size:16px;font-weight:700;line-height:1\.1;color:var\(--(text|text-label)\)[^>]*>([^<]*)</g)].map(x => x[2]);
};
const l52Swings = () => {
  I.resetState(KEY); Object.assign(I.state, { key: KEY, calWin: 'l52' });
  const cut = I.mkCut('l52');
  return I.CAL_SW.filter(s => !s.team).map(s => I.calRows(p).filter(x => x.sw === s.k && String(x.r.date) >= cut).length).filter(n => n > 0);
};

// ── streaks ─────────────────────────────────────────────────────────────────────────────────────────────────
const streaksGone = (src, html) => {
  assert(!/renderStreaksV2|streakSeq|streakRuns|STK_MINP/.test(src), 'Streaks code is still in the module');
  assert(!/data-v="streaks"|>Streaks</.test(html), 'a Streaks tab is painted');
  assert(!/data-pp2-pgsw="season"/.test(html), 'the Calendar record still carries a page switch');
};
H.check('streaks · the Calendar record is Calendar only: no Streaks tab, switch or run code', () => {
  I.resetState(KEY); Object.assign(I.state, { key: KEY, modal: 'season' });
  streaksGone(SRC, I.renderModal ? I.renderModal(p) : cal());
});
H.mustFail('CONTROL · a Streaks tab fails the check', () => streaksGone(SRC, '<span data-pp2="cal-tab" data-v="streaks">Streaks</span>'));

// ── tiles ───────────────────────────────────────────────────────────────────────────────────────────────────
const fullTiles = (html, why) => {
  const n = tileNames(html);
  assert.strictEqual(n.length, 4, why + ': not four tiles');
  n.forEach((x, i) => assert(x && x !== '—', why + ': tile ' + (i + 1) + ' is a dash'));
  assert(!/no swing with/.test(T(html)), why + ': "no swing with N matches" printed');
};
H.check('tiles · Last 52 weeks fills all four tiles (the 20-match floor is Career only)', () => {
  const ns = l52Swings();
  assert(ns.length >= 2 && ns.every(n => n < I.PP4.CAL_PICK_MIN), 'vacuous: the fixture needs l52 swings all under ' + I.PP4.CAL_PICK_MIN + ' (got ' + ns + ')');
  fullTiles(cal({ calWin: 'l52' }), 'l52');
});
H.check('tiles · a filter (his price band) still fills all four tiles, Career and Last 52 weeks', () => {
  I.resetState(KEY); Object.assign(I.state, { key: KEY, calWin: 'l52' });
  const cut = I.mkCut('l52'), rows = I.calRows(p).filter(x => x.band >= 0 && String(x.r.date) >= cut);
  assert(rows.length, 'no priced row in the last 52 weeks');
  const band = String(rows[0].band);
  fullTiles(cal({ calBand: band }), 'career + band ' + band);
  fullTiles(cal({ calWin: 'l52', calBand: band }), 'l52 + band ' + band);
});
H.mustFail('CONTROL · the pre-ruling l52 picks (20-match floor everywhere) dash Best swing', () => {
  const mut = SRC.replace("var pickFloors = calWinOf() === 'career' ? [CAL_PICK_MIN, CAL_MIN, 1] : [CAL_MIN, 1];", 'var pickFloors = [CAL_PICK_MIN];');
  assert.notStrictEqual(mut, SRC, 'mutation not applied');
  const M = L.loadPp2({ src: mut, now: FX.asOf, players: { [KEY]: p }, careerHistory: { [KEY]: FX.careerHistory }, marketEdge: { [KEY]: FX.marketEdge } }).I;
  M.resetState(KEY); Object.assign(M.state, { key: KEY, modal: 'season', calWin: 'l52', calSurf: 'all', calView: 'swing' });
  fullTiles(M.renderSeasonModal(p), 'mutant');
});

// ── bars ────────────────────────────────────────────────────────────────────────────────────────────────────
const barsOk = (html, why) => {
  const plot = /height:96px;border-bottom[\s\S]*?(?=<span style="font-family:var\(--font-words\)[^"]*grid-column:1;padding:10px 8px 10px 0;align-self:stretch)/.exec(html);
  assert(plot, why + ': no bar plot');
  const hs = [...plot[0].matchAll(/width:12px;height:([\d.]+)%;background:([^;]+);/g)].map(x => ({ h: +x[1], c: x[2] }));
  const drawn = hs.filter(b => b.h > 0);
  assert(drawn.length >= 2, why + ': fewer than two bars drawn');
  drawn.forEach(b => assert(b.h <= 100, why + ': a bar runs ' + b.h + '% of its half — it leaves the plot'));
  return drawn;
};
H.check('bars · Last 52 weeks: every bar stays inside its 96px plot (scale = the largest bar drawn)', () => { barsOk(cal({ calWin: 'l52' }), 'l52'); });
H.check('bars · a bar is his WIN RATE vs the other swings: green where he wins more often than elsewhere', () => {
  const html = cal(), t = T(html);
  // per swing shown: win rate vs the rest, from the grid's Career row (team out)
  I.resetState(KEY); Object.assign(I.state, { key: KEY });
  const rows = I.calRows(p), shown = I.CAL_SW.filter(s => rows.some(x => x.sw === s.k));
  const stat = f => { const r = rows.filter(f); return { w: r.filter(x => x.r.won).length, n: r.length }; };
  const signs = shown.filter(s => !s.team).map(s => {
    const a = stat(x => x.sw === s.k), o = stat(x => x.sw !== s.k && x.sw !== 'team');
    return a.n >= I.PP4.CAL_MIN ? Math.sign(Math.round((100 * a.w / a.n - 100 * o.w / o.n) * 10) / 10) : null;
  });
  const plot = /height:96px;border-bottom[\s\S]*?(?=<span style="font-family:var\(--font-words\))/.exec(html)[0];
  const cols = plot.split('<span style="position:relative;display:flex;flex-direction:column;align-items:center;height:100%;">').slice(1);
  assert.strictEqual(cols.length, shown.length, 'one bar column per shown swing');
  let checked = 0;
  cols.forEach((c, i) => {
    if (signs[i] == null || signs[i] === 0) return;
    const up = /flex-end;justify-content:center;"><span style="width:12px;height:([\d.]+)%;background:var\(--(pos|neg)\)/.exec(c);
    assert(up, shown[i].name + ': no coloured bar');
    assert.strictEqual(up[2], signs[i] > 0 ? 'pos' : 'neg', shown[i].name + ': bar colour does not follow his win-rate gap');
    checked++;
  });
  assert(checked >= 3, 'vacuous: fewer than three bars checked');
  assert(/Win rate/.test(t), 'no win-rate row');
});
H.mustFail('CONTROL · the pre-ruling bar scale (yield gap over the 20-match picks) runs a bar out of the plot on Last 52 weeks', () => {
  const mut = SRC.replace('var maxPP = Math.max.apply(null, [1].concat(rowsT.filter(barOk).map(function (r) { return Math.abs(r.x.wp); })));', 'var maxPP = 1;')
    .replace('var up = wp > 0 ? Math.min(100, wp / maxPP * 100) : 0, dn = wp < 0 ? Math.min(100, -wp / maxPP * 100) : 0;', 'var up = wp > 0 ? wp / maxPP * 100 : 0, dn = wp < 0 ? -wp / maxPP * 100 : 0;');
  assert.notStrictEqual(mut, SRC, 'mutation not applied');
  const M = L.loadPp2({ src: mut, now: FX.asOf, players: { [KEY]: p }, careerHistory: { [KEY]: FX.careerHistory }, marketEdge: { [KEY]: FX.marketEdge } }).I;
  M.resetState(KEY); Object.assign(M.state, { key: KEY, modal: 'season', calWin: 'l52', calSurf: 'all', calView: 'swing' });
  barsOk(M.renderSeasonModal(p), 'mutant');
});

// ── cols ────────────────────────────────────────────────────────────────────────────────────────────────────
H.check('cols · a swing with no match in the selection has no column; one he played does', () => {
  const html = cal({ calWin: 'l52' });
  const heads = [...(/data-pp2-calsc="a"[\s\S]*?(?=data-pp2-calsc="b")/.exec(html) || [''])[0].matchAll(/<span title="([^"]*)" style="align-self:end;display:flex/g)].map(x => x[1]);
  I.resetState(KEY); Object.assign(I.state, { key: KEY, calWin: 'l52' });
  const cut = I.mkCut('l52'), rows = I.calRows(p).filter(x => String(x.r.date) >= cut);
  const played = I.CAL_SW.filter(s => rows.some(x => x.sw === s.k)), missing = I.CAL_SW.filter(s => !rows.some(x => x.sw === s.k));
  assert(missing.length > 0, 'vacuous: he played every swing in the window');
  assert.strictEqual(heads.length, played.length, 'columns ' + heads.length + ' vs swings played ' + played.length);
});

// ── drill ───────────────────────────────────────────────────────────────────────────────────────────────────
H.check('drill · a calendar record opens in the middle of the screen', () => {
  const html0 = cal();
  const key = (/data-pp2="cal-cell2" data-v="([^"]+)"/.exec(html0) || [])[1];
  assert(key, 'no clickable calendar cell');
  const html = cal({ calCellV2: key });
  const box = /<div class="pp2-drillbox" data-pp2-drawer="cal"[^>]*>/.exec(html);
  assert(box, 'no calendar drill box');
  assert(/align-items:safe center;justify-content:center;/.test(box[0]) && !/align-items:flex-start/.test(box[0]), 'the drill box is not centred');
});

// ── hover ───────────────────────────────────────────────────────────────────────────────────────────────────
const hoverOk = css => {
  assert(/\.pp2-strip-cell\[data-pp2\]:hover\{box-shadow:inset 0 0 0 1px /.test(css), 'the W/L squares have no hover outline');
  assert(/\.pp2-ledger-row\[data-pp2\]:hover\{box-shadow:inset 0 0 0 1px /.test(css), 'the ledger rows have no hover outline');
};
H.check('hover · the Recent form W/L squares and the ledger rows carry a hover outline', () => hoverOk(SRC));
H.mustFail('CONTROL · the module without the rules fails', () => hoverOk(SRC.replace(/'\.pp2-strip-cell\[data-pp2\]:hover[^']*' \+/, "''+")));

// ── tourn ───────────────────────────────────────────────────────────────────────────────────────────────────
H.check('tourn · Record per tournament opens on the ATP level', () => {
  I.resetState(KEY); Object.assign(I.state, { key: KEY, modal: 'tourn' });
  assert.strictEqual(I.state.tourLevel, 'ATP', 'default level is ' + I.state.tourLevel);
  const html = I.renderTournModal(p);
  assert(/data-pp2="tourn-level" data-v="ATP"[^>]*aria-pressed="true"/.test(html) || /aria-pressed="true"[^>]*data-pp2="tourn-level" data-v="ATP"/.test(html), 'the ATP pill is not the selected one');
});

// ── sit ─────────────────────────────────────────────────────────────────────────────────────────────────────
const ROWS = ['brokenFirstSvc', 'firstBreak', 'brokenBack', 'breakBack', 'lostS1FirstBreakS2', 'holdWinSet', 'holdStaySet', 'breakOppServing'];
const recs = (w, l) => Object.fromEntries(ROWS.map(id => [id, { w, l }]));
const sitHeld = (store, win) => {
  W.situational = store;
  I.resetState(KEY); Object.assign(I.state, { key: KEY, ltWin: win, ltSurf: 'all' });
  const M = I.ltModel(p);
  const pbpRows = [].concat(...M.groups.map(g => g.rows)).filter(r => r.src === 'pbp');
  assert(pbpRows.length === ROWS.length, 'not all eight pbp rows listed (' + pbpRows.length + ')');
  return pbpRows;
};
H.check('sit · Last 52 weeks reads the w52 node: every point-by-point row has a record and a rate', () => {
  const rows = sitHeld({ meta: { players: 1 }, tour: {}, tour52: Object.fromEntries(ROWS.map(id => [id, { pct: 40 }])),
    players: { [KEY]: { matches: 60, rows: recs(30, 30), w52: { matches: 25, rows: recs(12, 13) } } } }, 'w52');
  rows.forEach(r => { assert(r.held, r.id + ' is not held on Last 52 weeks'); assert.strictEqual(r.rec, '12 of 25', r.id + ' reads ' + r.rec + ', not the w52 node'); });
  assert(rows.some(r => r.T && r.T.base === '40%'), 'Vs tour does not read tour52');
});
H.check('sit · a file without the w52 node dashes Last 52 weeks with the reason; Last 24 months is unchanged', () => {
  const store = { meta: { players: 1 }, tour: {}, players: { [KEY]: { matches: 60, rows: recs(30, 30) } } };
  sitHeld(store, 'w52').forEach(r => { assert(!r.held && r.rec === '—', r.id + ' is not dashed'); assert(/52 weeks/.test(r.why || ''), r.id + ' gives no reason'); });
  sitHeld(store, 'm24').forEach(r => assert.strictEqual(r.rec, '30 of 60', r.id + ' on Last 24 months'));
});
H.mustFail('CONTROL · the pre-ruling model (pbp rows on Last 24 months only) dashes Last 52 weeks', () => {
  const mut = SRC.replace("var pbp = !pbpRec ? null : S.win === 'w52' ? (pbpRec.w52 && pbpRec.w52.rows ? pbpRec.w52 : null) : S.win === 'm24' ? pbpRec : null;",
    "var pbp = S.win === 'm24' ? pbpRec : null;");
  assert.notStrictEqual(mut, SRC, 'mutation not applied');
  const M = L.loadPp2({ src: mut, now: FX.asOf, players: { [KEY]: p }, careerHistory: { [KEY]: FX.careerHistory }, marketEdge: { [KEY]: FX.marketEdge },
    extra: { situational: { meta: {}, tour: {}, players: { [KEY]: { matches: 60, rows: recs(30, 30), w52: { matches: 25, rows: recs(12, 13) } } } } } }).I;
  M.resetState(KEY); Object.assign(M.state, { key: KEY, ltWin: 'w52', ltSurf: 'all' });
  [].concat(...M.ltModel(p).groups.map(g => g.rows)).filter(r => r.src === 'pbp').forEach(r => assert(r.held, r.id + ' dashed'));
});
H.done();
