#!/usr/bin/env node
// Bet Tracker T2–T5 parity: the LOCKED prototype's own logic class (`design_handoff_bet_tracker/Bet Tracker Page.dc.html`
// lines 419–760) runs here on its own demo seed, beside bettracker-math.js on the same bets, and every figure the
// template binds must agree — the hero and its tiles, the curve, the Filters menu counts, the calendar, the months table
// and pop-up, the verdict cards, all eight Breakdown cuts, the Discipline strip, and the staking replay for every plan —
// over several states (period, custom range, filters, the second bankroll, every cut, every plan).
// Allowed differences, each a ruling: a true minus (−) where the prototype prints an ASCII hyphen in a tick label or the
// day pop-up's € figure; "This season" counts 1 January of today's year (the prototype counts every bet it holds — the
// same set on its one-season seed). The seed has no voids and no missing data, so the dash rulings do not fire here.
// v26 (2026-10-29) rulings: F1 — the header meta sentence is not printed (not compared); F2 — the curve's y range is
// stretched to a tick on each side it reaches, so the curve is compared on a copy of the maths with that stretch off
// (the stretch itself is tested in test-bettracker-math.mjs). SECTIONS lists what is ported; the rest skips out loud.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(ROOT, 'design_handoff_bet_tracker/Bet Tracker Page.dc.html'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'bettracker-math.js'), 'utf8');

function loadMath(src) {
  const sb = { module: { exports: {} }, Date, Math, JSON, String, Number, Object, Array, isFinite, isNaN, parseFloat };
  sb.globalThis = sb; vm.runInNewContext(src, sb, { filename: 'bettracker-math.js' }); return sb.module.exports;
}
class DCLogic { constructor() { this.props = {}; this.state = {}; } setState(u) { this.state = Object.assign({}, this.state, typeof u === 'function' ? u(this.state) : u); } }
const Component = new Function('DCLogic', HTML.slice(HTML.indexOf('class Component extends DCLogic'), HTML.lastIndexOf('</script>')) + '; return Component;')(DCLogic);
function ref(state) { const c = new Component(); c.props = { minSample: 15 }; c.setState(state); return { c, v: c.renderVals() }; }

const minus = s => String(s).replace(/(^|[\s(=])-(?=\d)/g, '$1−');
const SECTIONS = new Set(['hero', 'filters', 'hover']);   // T7 adds 'calendar', T8 'insights' + 'staking'
const noF2 = src => src.replace('if (mx > 0 && mx < step) mx = step;', '').replace('if (mn < 0 && mn > -step) mn = -step;', '');
function run(M, MC) {
  const fails = [];
  const eq = (n, g, w) => { if (JSON.stringify(g) !== JSON.stringify(w)) fails.push(`${n}:\n      got  ${JSON.stringify(g).slice(0, 400)}\n      want ${JSON.stringify(w).slice(0, 400)}`); };
  const today = new Date(2026, 9, 27);
  const F0 = { level: [], odds: [], surface: [], market: [] };
  const STATES = [
    ['season', {}],
    ['last 30 days', { period: '30d' }],
    ['last 90 days', { period: '90d' }],
    ['custom 1 Jun → 31 Aug', { period: 'custom', range: { from: '2026-06-01', to: '2026-08-31' } }],
    ['filters ATP 500 + Clay/Grass', { filters: { level: ['ATP 500'], odds: [], surface: ['Clay', 'Grass'], market: [] } }],
    ['filters odds + market', { filters: { level: [], odds: ['1.61 – 1.90', '1.91 – 2.20'], surface: [], market: ['Match winner'] } }],
    ['Challenger lab bankroll', { bank: 'chall' }]
  ];
  for (const [name, st] of STATES) {
    const { c, v } = ref(st), bets = c.allBets().filter(b => b.bank === (st.bank || 'main'));
    const per = st.period || 'season', range = st.range || { from: '2026-04-13', to: '2026-10-27' }, F = st.filters || F0;
    const win = M.periodWindow(per, range, today), perList = M.inPeriod(bets, win), list = M.applyFilters(perList, F);
    const HT = M.heroTiles(M.stats(list), list), HC = MC.heroCurve(list, today);
    const KC = { pos: '#5CCB84', neg: '#E06266', zero: '#E7E9EE', lab: '#A3AABE', ink: '#FFFFFF' };
    eq(`${name} · hero profit + sub`, [HT.profit, HT.profitSub], [v.hero.profit, v.hero.profitSub]);
    eq(`${name} · hero tiles (label · value · when · sub · colour)`, HT.rows.map(r => [r.label, r.value, r.when, r.sub, KC[r.kind]]), v.hero.rows.map(r => [r.label, r.value, r.when || '', r.sub, r.color]));
    if (SECTIONS.has('hover')) for (const hi of [0, 1, Math.floor(HC.pts.length / 2), HC.pts.length - 1]) {
      const rv = ref(Object.assign({}, st, { hovI: hi })).v.curve, H = MC.curveHover(HC, HC.X(hi), today);
      eq(`${name} · curve hover #${hi}`, [H.left, H.top, H.flip, H.date, H.idx, H.cum, KC[H.cumKind], !!H.bet, H.bet && H.bet.text, H.bet && H.bet.meta, H.bet && H.bet.stake, H.bet && H.bet.pl, H.bet && KC[H.bet.plKind], H.bet && KC[H.bet.resKind]],
        [rv.hovLeft, rv.hovTop, rv.tipShift !== 'translateX(14px)', rv.hovDate, rv.hovIdx, rv.hovCum, rv.hovCumC, rv.hovHasBet, rv.hovHasBet ? rv.hovBet : null, rv.hovHasBet ? rv.hovMeta : null, rv.hovHasBet ? rv.hovStake : null, rv.hovHasBet ? rv.hovPl : null, rv.hovHasBet ? rv.hovPlC : null, rv.hovHasBet ? rv.hovResC : null]);
    }
    eq(`${name} · curve meta + drawdown note`, [HC.meta, HC.ddNote], [v.curve.meta, v.curve.ddNote]);
    eq(`${name} · curve path + area`, [HC.path, HC.area], [v.curve.path, v.curve.area]);
    eq(`${name} · curve ticks`, HC.yTicks.map(t => [t.y, t.top, t.label]), v.curve.yTicks.map(t => [t.y, t.top, minus(t.label)]));
    eq(`${name} · curve x labels`, HC.xTicks.map(t => [t.left, t.label]), v.curve.xTicks.map(t => [t.left, t.label]));
    eq(`${name} · curve points`, [HC.lastX, HC.lastY, HC.ddX, HC.ddY], [v.curve.lastX, v.curve.lastY, v.curve.ddX, v.curve.ddY]);
    eq(`${name} · Filters menu rows + counts`, M.filterMenu(bets, perList, F).map(g => [g.label, g.opts.map(o => [o.label, String(o.n), o.on])]),
      v.filters.map(g => [g.label, g.opts.map(o => [o.label, o.n, o.tick === '✓'])]));
    eq(`${name} · filters label + foot`, [M.filtersLabel(F), M.filtersFoot(list, perList)], [v.filtersLabel, v.menuFoot]);
    if (SECTIONS.has('insights')) {
    const V = M.verdicts(list, 15);
    eq(`${name} · verdict cards`, V.map(x => [x.kind, x.seg, x.pl, x.title, x.figs.map(f => [f.l, f.v]), x.path, x.area]),
      v.verdicts.map(x => [x.kind, x.seg, x.pl, x.title, x.figs.map(f => [f.l, f.v]), x.path, x.area]));
    for (const d of M.DIMS.map(x => x[0])) {
      const rv = d === 'market' ? v : ref(Object.assign({}, st, { dim: d })).v, B = M.breakdown(list, d);
      eq(`${name} · breakdown ${d} rows`, B.rows.map(r => [r.name, r.n, r.wl, r.roi, r.clv, r.pl, r.bar.left, r.bar.width]), rv.bdRows.map(r => [r.name, r.n, r.wl, r.roi, r.clv, r.pl, r.barL, r.barW]));
      eq(`${name} · breakdown ${d} total + meta + head`, [B.totLabel, String(B.tot.n), B.tot.wl, B.tot.roi, B.tot.clv, B.tot.pl, B.meta, B.head, B.foot],
        [rv.bdTotLabel, rv.bdTotN, rv.bdTotWL, rv.bdTotRoi, rv.bdTotClv, rv.bdTotPl, rv.bdMeta, rv.bdHead, rv.bdFoot]);
      eq(`${name} · breakdown ${d} menu counts`, B.menu.map(m => [m.label, String(m.count), m.on]), rv.dims.map(m => [m.label, m.count, m.tick === '✓']));
    }
    const D = M.disciplineView(list, 15, M.PERIODS[per]);
    eq(`${name} · discipline dials`, D.checks.map(k => [k.label, k.verdict, k.fig, k.short, k.body, k.arc, k.zone]), v.disc.map(k => [k.label, k.verdict, k.fig, k.short, k.body, k.arc, k.zone]));
    eq(`${name} · discipline head`, [D.head, D.sum, D.sumTxt, D.badge], ['Discipline · ' + v.discPeriod, v.discSum, v.discSumTxt, v.insBadge]);
    }
    if (SECTIONS.has('staking')) {
    for (const p of M.PLANS.map(x => x.name)) {
      const sv = p === 'Compounding 1%' ? v.sim : ref(Object.assign({}, st, { vsPlan: p })).v.sim, Z = M.stakingView(list, p);
      eq(`${name} · staking ${p}`, [Z.meta, Z.gapTxt, Z.diffTxt, Z.note, Z.yourPath, Z.otherPath, Z.area, Z.otherSub, Z.otherHow, Z.otherWhen, Z.yourHow],
        [sv.meta, sv.gapTxt, minus(sv.diffTxt), sv.note, sv.yourPath, sv.otherPath, sv.area, sv.otherSub, sv.otherHow, sv.otherWhen, sv.yourHow]);
      eq(`${name} · staking ${p} deltas`, Z.deltas.map(d => [d.l, d.a, d.b, d.d, d.kind]), sv.deltas.map(d => [d.l, d.a, d.b, d.d, d.c === '#5CCB84' ? 'pos' : d.c === '#E06266' ? 'neg' : 'lab']));
      eq(`${name} · staking ${p} ticks`, Z.yTicks.map(t => [t.y, t.top, t.label]), sv.yTicks.map(t => [t.y, t.top, minus(t.label)]));
      eq(`${name} · staking ${p} fill`, Z.areaKind, sv.areaFill.includes('92,203,132') ? 'pos' : 'neg');
    }
    eq(`${name} · plan chips`, M.stakingView(list, 'Flat 2%').plans.map(p => [p.name, p.how, p.on]), ref(Object.assign({}, st, { vsPlan: 'Flat 2%' })).v.sim.plans.map(p => [p.name, p.how, p.bg === '#1B2031']));
    }
    if (SECTIONS.has('calendar')) {
    const H = M.heatGrid(bets, today);
    eq(`${name} · heat cells (figure + tone)`, H.cells.map(x => [x.fig, x.tone, x.alpha]), v.heat.cells.map(x => {
      const m = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(x.bg);
      return [x.n, x.bg === 'transparent' ? 'future' : x.bg === 'rgba(106,154,248,0.35)' ? 'pend' : x.bg === 'rgba(255,255,255,0.12)' ? 'flat' : x.bg === 'rgba(255,255,255,0.04)' ? 'none' : m && m[1] === '92' ? 'pos' : 'neg',
        m && (m[1] === '92' || m[1] === '224') ? +m[4] : null];
    }));
    eq(`${name} · heat pop-up subs + rows`, H.cells.map(x => [x.title, x.sub, x.rows.map(r => [r.text, r.meta, r.res, r.pl])]),
      v.heat.cells.map(x => [x.title, minus(x.sub), x.rows.map(r => [r.text, r.meta, r.res, r.pl])]));
    eq(`${name} · heat months + meta`, [H.months, H.meta], [v.heat.months, v.heat.meta]);
    const MT = M.monthsTable(bets, today);
    eq(`${name} · months table`, MT.map(m => [m.name, m.n, m.pl, m.bar.left, m.bar.width]), v.months.map(m => [m.name, m.n, m.pl, m.barL, m.barW]));
    const k = MT[1] ? MT[1] : MT[0];
    if (k) {
      const rp = ref(Object.assign({}, st, { openMonth: k.key % 12 })).v.monthPop, P = M.monthPop(k.key, k.bets, today);
      eq(`${name} · month pop-up`, [P.title, P.sub, P.stats.map(x => [x.l, x.v]), P.rows.map(r => [r.date, r.text, r.meta, r.market, r.odds, r.close, r.clv, r.stake, r.res, r.pl])],
        [rp.title, rp.sub, rp.stats.map(x => [x.l, x.v]), rp.rows.map(r => [r.date, r.text, r.meta, r.market, r.odds, r.close, r.clv, r.stake, r.res, r.pl])]);
    }
    }
  }
  return fails;
}

for (const sk of ['calendar', 'insights', 'staking']) if (!SECTIONS.has(sk)) console.log(`  SKIP  ${sk}: not ported to v26 yet — compared once its task lands (said out loud, not a pass)`);
const fails = run(loadMath(SRC), loadMath(noF2(SRC)));
for (const f of fails) console.log('  FAIL ', f);
console.log(fails.length ? `bettracker-parity: ${fails.length} difference(s) from the locked prototype` : `bettracker-parity: every figure matches the locked v26 prototype (7 states · ${[...SECTIONS].join(' · ')})`);
// control: a deliberately broken copy must differ (a tile's "when" a month early, and the hover's bet meta without the level)
const bad = SRC.replace("function monYear(d) { return d ? MON[d.getMonth()]", "function monYear(d) { return d ? MON[(d.getMonth() + 11) % 12]").replace("[hb.tour, LEVEL[hb.level] || hb.level].filter(present)", "[hb.tour].filter(present)");
const ctl = bad !== SRC && run(loadMath(bad), loadMath(noF2(bad))).length > 0;
console.log(ctl ? 'control: a broken tile date and hover meta are caught' : '  FAIL  control: a broken copy went unnoticed');
process.exit(fails.length || !ctl ? 1 : 0);
