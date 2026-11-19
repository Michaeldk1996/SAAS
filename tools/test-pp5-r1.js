#!/usr/bin/env node
// tools/test-pp5-r1.js — Player Profile v5, round 1 (founder 2026-11-19):
//   cal    Calendar record · Best / Worst swing (and month) = the highest / lowest WIN RATE among the swings with at least
//          PP4.CAL_PICK_MIN (20) matches played; never a yield gap, never a swing under 20 matches
//   sty    Match-up record · Window = Last 52 weeks · Last 24 months · Career; Last 24 months filters the rows to the
//          last two years; a dot turns blue on hover by CSS alone (thin dots too); no overlay catches the pointer
// Pinned input: tools/fixtures/ten384-figures/player-2840.json (module clock pinned to its asOf).
// CONTROL: the pre-ruling pick (largest / smallest yield gap, 5 priced) names a different worst swing on this fixture,
// so the cal check is not vacuous.
'use strict';
const fs = require('fs'), path = require('path');
const assert = require('assert');
const L = require('./ten384-figures-lib.js');
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten384-figures', 'player-2840.json'), 'utf8'));
const H = L.harness();
const KEY = FX.key, p = FX.profile, T = L.text;
const opps = [...new Set(FX.careerHistory.filter(r => r.level === 'atp').map(r => r.opponent))];
const styles = { players: opps.map((n, i) => ({ name: n, archetype_label: ['Big Server', 'Counterpuncher', 'Solid Baseliner'][i % 3] })) };
const { I } = L.loadPp2({ now: FX.asOf, players: { [KEY]: p }, careerHistory: { [KEY]: FX.careerHistory }, marketEdge: { [KEY]: FX.marketEdge },
  bet365History: FX.bet365History || {}, extra: { playingStyles: styles } });
const MIN = I.PP4.CAL_PICK_MIN;

function cal(view) {
  I.resetState(KEY);
  Object.assign(I.state, { key: KEY, modal: 'season', seasonTab: 'calendar', calWin: 'career', calSurf: 'all', calView: view });
  return T(I.renderSeasonModal(p));
}
// the season grid's Career row: one W–L per swing column, in head order (team last, left out of the picks)
function careerRow(t) {
  const m = /Career ((?:(?:\d+–\d+|—) ){12})/.exec(t);
  assert(m, 'no Career row in the season grid');
  return m[1].trim().split(' ').slice(0, 11).map(x => { const r = /(\d+)–(\d+)/.exec(x); return r ? { w: +r[1], l: +r[2], wl: x } : null; });
}
const tileWL = (t, cap) => { const m = new RegExp(cap + ' [^|]*?(\\d+)% Win rate (\\d+–\\d+)').exec(t); return m ? m[2] : null; };

H.check('cal · Best / Worst swing = highest / lowest win rate among swings with ' + MIN + '+ matches', () => {
  const t = cal('swing'), cols = careerRow(t).filter(Boolean);
  const rated = cols.filter(c => c.w + c.l >= MIN);
  assert(rated.length >= 2 && rated.length < cols.length, 'vacuous: the fixture needs swings both above and below ' + MIN);
  const pct = c => c.w / (c.w + c.l);
  const best = rated.slice().sort((a, b) => pct(b) - pct(a))[0], worst = rated.slice().sort((a, b) => pct(a) - pct(b))[0];
  assert.strictEqual(tileWL(t, 'Best swing'), best.wl, 'Best swing is not the highest win rate');
  assert.strictEqual(tileWL(t, 'Worst swing'), worst.wl, 'Worst swing is not the lowest win rate');
  // CONTROL: the old rule (yield gap) would name another worst swing here
  const y = /Yield ((?:(?:[+−]\d+\.\d%|—) ){11})/.exec(t.slice(t.indexOf('By swing')));
  assert(y, 'no By swing yield row');
  const ys = y[1].trim().split(' ').map(v => v === '—' ? null : parseFloat(v.replace('−', '-')));
  const all = careerRow(t), lowY = all.map((c, i) => ({ c, y: ys[i] })).filter(x => x.c && x.y != null).sort((a, b) => a.y - b.y)[0];
  assert.notStrictEqual(lowY.c.wl, worst.wl, 'CONTROL: the yield rule picks the same worst swing — this check measures nothing');
});
H.check('cal · Best / Worst month obey the same ' + MIN + '-match floor and win-rate rule', () => {
  const t = cal('month');
  // the month population is the Calendar's own rows (calRows, team events out), as the drawer counts them
  const by = {};
  I.calRows(p).filter(x => x.sw !== 'team' && x.r.mon != null).forEach(x => { const o = by[x.r.mon] || (by[x.r.mon] = { w: 0, l: 0 }); x.r.won ? o.w++ : o.l++; });
  const cells = Object.values(by).map(o => Object.assign(o, { wl: o.w + '–' + o.l }));
  const rated = cells.filter(c => c.w + c.l >= MIN);
  assert(rated.length < cells.length, 'vacuous: every month clears the floor');
  const pct = c => c.w / (c.w + c.l);
  if (rated.length) {
    assert.strictEqual(tileWL(t, 'Best month'), rated.slice().sort((a, b) => pct(b) - pct(a))[0].wl, 'Best month');
    assert.strictEqual(tileWL(t, 'Worst month'), rated.slice().sort((a, b) => pct(a) - pct(b))[0].wl, 'Worst month');
  } else assert(/no month with 20 matches/.test(t), 'no month at the floor, yet a month is named');
});
H.check('sty · Window = Last 52 weeks · Last 24 months · Career; Last 24 months keeps two years of rows', () => {
  I.resetState(KEY);
  Object.assign(I.state, { key: KEY, modal: 'styles' });
  const html = I.renderStylesModal(p);
  const wins = (html.match(/data-pp2="sty-win" data-v="(\w+)"/g) || []).map(x => x.replace(/.*data-v="(\w+)"/, '$1'));
  assert.deepStrictEqual(wins, ['l52', 'l24', 'career'], 'the Window options');
  const n = w => { I.state.styWin = w; return I.styData(p).data.reduce((s, d) => s + d.n, 0); };
  const a = n('l52'), b = n('l24'), c = n('career');
  assert(a < b && b < c, 'Last 24 months does not sit between Last 52 weeks and Career: ' + [a, b, c]);
  I.state.styWin = 'l24';
  assert(/LAST 24 MONTHS|Last 24 months/i.test(T(I.renderStylesModal(p))), 'the drawer does not name its window');
});
H.check('sty · hover: CSS turns any dot blue; gridlines, average label and brackets let the pointer through', () => {
  const src = fs.readFileSync(path.join(L.ROOT, 'player-profile-v2.js'), 'utf8');
  assert(/\.pp2-stydot\.pp2-hov,\.pp2-stydot:hover\{background:var\(--link\)!important/.test(src), 'no CSS :hover rule for the dots');
  assert(!/\.pp2-stydot-thin\.pp2-hov\{background:var\(--card\)/.test(src), 'a thin dot still keeps its grey look on hover');
  I.resetState(KEY);
  Object.assign(I.state, { key: KEY, modal: 'styles', styWin: 'career' });
  const html = I.renderStylesModal(p);
  const chart = html.slice(html.indexOf('pp2-stychart'));
  assert(/his average[\s\S]{0,10}/.test(chart), 'vacuous: no average label drawn');
  assert(/pointer-events:none;">his average/.test(chart), 'the average label catches the pointer');
  assert(!/;height:1px;background:var\(--line\);"/.test(chart), 'a gridline catches the pointer');
});
H.done();
