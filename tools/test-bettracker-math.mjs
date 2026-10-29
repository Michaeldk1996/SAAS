#!/usr/bin/env node
// Bet Tracker T1 — every README §Formulas function in bettracker-math.js, the three discipline checks, the six staking
// plans, segment eligibility (minSample = 15), the calendar's three tint steps and week net €.
//
// The seed: the LOCKED reference's demo generator (`design_handoff_bet_tracker/Bet Tracker Page.dc.html`, class Component
// R() + bets(), seed 20261027) is copied verbatim below. It lives in this test only — production never ships demo bets.
// EXPECTED values were READ off the running prototype (served locally, headless Chrome, 2026-10-28: bankroll
// "Tennis 2026", period Season, today 27 Oct 2026) — never derived from bettracker-math.js. The seed has no void bet,
// so its ROI equals the reference's; the void-denominator ruling (T1 change 2) is pinned by its own case below.
//
// Then a mutant pass: each mutant bends one rule in a copy of bettracker-math.js; the suite must go red on every one.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'bettracker-math.js'), 'utf8');
const MINUS = '−', EN = '–', DASH = '—';

function load(src) {
  const sandbox = { module: { exports: {} }, Date, Math, JSON, String, Number, Object, Array, isFinite, isNaN, parseFloat };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(src, sandbox, { filename: 'bettracker-math.js' });
  return sandbox.module.exports;
}

// ── the reference's seed generator, verbatim (Component.R + bets(); only `this`/`Component.` scoping adapted) ────────
function R(seed){ let s=seed>>>0; return ()=>{ s=(s+0x6D2B79F5)>>>0; let t=s; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; }; }
function seedBets(){
    const R_=R(20261027);
    const N=s=>{ const u=Math.max(R_(),1e-9),v=R_(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)*s; };
    const pick=a=>a[Math.floor(R_()*a.length)];
    const T={4:[['Monte-Carlo','1000','Clay'],['Barcelona','500','Clay'],['Munich','500','Clay'],['Madrid','1000','Clay']],5:[['Madrid','1000','Clay'],['Rome','1000','Clay'],['Geneva','250','Clay'],['Roland Garros','Slam','Clay']],6:[['Roland Garros','Slam','Clay'],['Stuttgart','250','Grass'],['Halle','500','Grass'],["Queen's",'500','Grass'],['Wimbledon','Slam','Grass']],7:[['Wimbledon','Slam','Grass'],['Hamburg','500','Clay'],['Gstaad','250','Clay'],['Washington','500','Hard'],['Umag','250','Clay']],8:[['Toronto','1000','Hard'],['Cincinnati','1000','Hard'],['Winston-Salem','250','Hard'],['US Open','Slam','Hard']],9:[['US Open','Slam','Hard'],['Davis Cup','Cup','Indoor hard'],['Chengdu','250','Hard'],['Tokyo','500','Hard'],['Beijing','500','Hard']],10:[['Shanghai','1000','Hard'],['Almaty','250','Indoor hard'],['Stockholm','250','Indoor hard'],['Vienna','500','Indoor hard'],['Basel','500','Indoor hard'],['Brussels','250','Indoor hard']]};
    const CH=[['Challenger Barletta','Chall','Clay'],['Challenger Heilbronn','Chall','Clay'],['Challenger Ilkley','Chall','Grass'],['Challenger Lexington','Chall','Hard'],['Challenger Cassis','Chall','Hard'],['Challenger Brest','Chall','Hard']];
    const P=['J. Sinner','C. Alcaraz','A. Zverev','T. Fritz','N. Djokovic','J. Draper','A. de Minaur','L. Musetti','H. Rune','D. Medvedev','C. Ruud','A. Rublev','F. Auger-Aliassime','B. Shelton','T. Paul','F. Cerundolo','A. Bublik','J. Mensik','A. Fils','T. Machac','K. Khachanov','D. Shapovalov','J. Lehecka','U. Humbert','F. Tiafoe','G. Dimitrov','S. Tsitsipas','A. Popyrin','M. Berrettini','L. Tien','J. Fonseca','A. Davidovich Fokina'];
    const out=[]; let id=1;
    for(let d=new Date(2026,3,13); d<=new Date(2026,9,26); d.setDate(d.getDate()+1)){
      const r=R_(); const cnt=r<.40?0:r<.70?1:r<.88?2:r<.96?3:4; let lossRun=0;
      for(let i=0;i<cnt;i++){
        const m=d.getMonth()+1; const t=R_()<.14?pick(CH):pick(T[m]||T[10]);
        let a=pick(P),b=pick(P); while(b===a) b=pick(P);
        const mr=R_(); const market=mr<.56?'Match winner':mr<.78?'Games handicap':'Total games';
        const br=R_(); const book=br<.55?'bet105':br<.85?'Pinnacle':'bet365';
        const p = market==='Match winner'? .30+R_()*.50 : .44+R_()*.12;
        const fair=1/p; const odds=+(fair*(1+N(.035)+.065)).toFixed(2);
        const tilt = i>=2 && lossRun>=2;
        let e=0; if(t[2]==='Clay') e-=.06; if(odds>=2.6) e-=.08; if(market==='Total games') e+=.06; if(t[1]==='Chall') e-=.06; if(t[1]==='Slam') e+=.03; if(book==='bet105') e+=.02; if(book==='bet365') e-=.03; if(tilt) e-=.08;
        const pT=Math.min(.95,Math.max(.05,p*(1+e)));
        const close=+((1/pT)*(1+N(.03))).toFixed(2);
        let stake = odds<1.8?1.5:1; if(tilt) stake*=2;
        const won=R_()<pT; lossRun = won?0:lossRun+1;
        const sel=R_()<.5?a:b, opp=sel===a?b:a; let line=null,text;
        if(market==='Match winner') text=sel+' to win';
        else if(market==='Games handicap'){ line=(p>.5?'−':'+')+(1+Math.floor(R_()*4))+'.5'; text=sel+' '+line+' games'; }
        else { line=(R_()<.5?'Over ':'Under ')+(20+Math.floor(R_()*5))+'.5'; text=line+' games · '+sel+' v '+opp; }
        out.push({id:id++, date:new Date(d), tour:t[0], level:t[1], surface:t[2], market, book, odds, close, stake, res:won?'won':'lost', tilt, text, line, pending:false, bank:t[1]==='Chall'?'chall':'main', timing:R_()<.2?'live':'pre'});
      }
    }
    const today=new Date(2026,9,27);
    out.push({id:id++, date:today, tour:'Vienna', level:'500', surface:'Indoor hard', market:'Match winner', book:'bet105', odds:2.10, close:null, stake:1, res:null, tilt:false, text:'A. de Minaur to win', line:null, pending:true, bank:'main', timing:'pre'});
    out.push({id:id++, date:today, tour:'Basel', level:'500', surface:'Indoor hard', market:'Total games', book:'Pinnacle', odds:1.87, close:null, stake:1.5, res:null, tilt:false, text:'Over 22.5 games · B. Shelton v H. Rune', line:'Over 22.5', pending:true, bank:'main', timing:'live'});
    return out;
}

// ── EXPECTED: read off the running prototype (see header) ────────────────────────────────────────────────────────
const READ = {
  profit: '+16.3%', profitSub: '170 settled · 197.0% staked in total', roi: '+8.3%', record: '94–76', recordSub: '170 settled · 0 void',
  winRate: '55%', avgClv: '+5.7%', beat: 'beat the close 128 of 170', maxDrawdown: '−10.9%', bestRun: '8 won', worstRun: '5 lost',
  curveMeta: '170 bets · peak +19.2% · now +16.3%', ddNote: 'deepest drawdown −10.9% on 5 Jun', insBadge: '0/2',
  cert: 'Certified · 170 of 170 results locked', head: '170 settled since 13 Apr · 2 pending · stakes in % of bankroll · whole season shown',
  ledgerMeta: '172 of 172 bets in the period · pending first · settle a bet and every figure above recomputes',
  months: [['All', 172, '+16.3%'], ['Oct', 18, '+3.6%'], ['Sep', 36, '+9.9%'], ['Aug', 32, '+3.0%'], ['Jul', 23, '+6.4%'], ['Jun', 30, '+1.7%'], ['May', 27, '−3.9%'], ['Apr', 6, '−4.4%']],
  bankMain: { meta: '170 settled', roi: '+8.3%', profit: '+16.3%' }, bankChall: { meta: '30 settled', roi: '+9.3%', profit: '+3.1%' },
  firstRows: ['Over 22.5 games · B. Shelton v H. Rune', 'A. de Minaur to win', 'J. Fonseca +3.5 games', 'A. Popyrin +1.5 games']
};

function run(M) {
  const fails = [];
  const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
  const ok = (name, cond) => { if (!cond) fails.push(name); };
  const near = (name, got, want, tol = 1e-9) => { if (!(typeof got === 'number' && Math.abs(got - want) <= tol)) fails.push(`${name}: got ${got} want ${want}`); };

  // ── 1 · the prototype's hero figures, seed 20261027 · Tennis 2026 · Season ──
  const bets = seedBets(), today = new Date(2026, 9, 27);
  const main = bets.filter(b => b.bank === 'main');
  const win = M.periodWindow('season', { from: '2026-04-13', to: '2026-10-27' }, today);
  const perList = M.inPeriod(main, win), list = M.applyFilters(perList, { level: [], odds: [], surface: [], market: [] });
  const S = M.stats(list), H = M.heroFigures(S), cur = M.cumulative(list);
  eq('hero profit', H.profit, READ.profit);
  eq('hero profit sub', `${S.n} settled · ${S.staked.toFixed(1)}% staked in total`, READ.profitSub);
  eq('ROI', H.roi, READ.roi);
  eq('record', H.record, READ.record);
  eq('record sub', `${S.n} settled · ${S.v} void`, READ.recordSub);
  eq('win rate', H.winRate, READ.winRate);
  eq('avg CLV', H.avgClv, READ.avgClv);
  eq('beat the close', `beat the close ${H.beat} of ${H.clvN}`, READ.beat);
  eq('max drawdown', H.maxDrawdown, READ.maxDrawdown);
  eq('best run', H.bestRun, READ.bestRun);
  eq('worst run', H.worstRun, READ.worstRun);
  eq('curve meta', `${cur.n} bets · peak ${M.sgn(cur.peak)} · now ${M.sgn(cur.now)}`, READ.curveMeta);
  const settled = list.filter(M.isSettled);
  eq('deepest drawdown note', `deepest drawdown −${S.dd.toFixed(1)}% on ${M.fmtD(settled[S.ddIdx].date)}`, READ.ddNote);
  { // v26: three judged checks — recomputed here (closing line, stake after a loss, stake consistency)
    const sl = list.filter(M.isSettled), pr = sl.filter(b => b.close), bt = pr.filter(b => b.odds / b.close - 1 > 0).length;
    const aL = [], aW = []; sl.forEach((b, i) => { if (!i) return; if (sl[i - 1].res === 'lost') aL.push(b.stake); else if (sl[i - 1].res === 'won') aW.push(b.stake); });
    const av = a => a.reduce((x, y) => x + y, 0) / a.length, ratio = av(aL) / av(aW), st = sl.map(b => b.stake), spread = Math.max(...st) / av(st);
    const bad = [!(bt / pr.length * 100 >= 55), !(ratio >= 0.85 && ratio <= 1.15), !(spread <= 1.5)].filter(Boolean).length;
    eq('Insights badge = bad of judged over the three v26 checks', M.discipline(list, 15).badge, bad + '/3'); }
  // historical results are locked (the store stamps lockedAt on load); the reference's header reads 170 of 170
  eq('certified text', M.certText(main.map(b => Object.assign({}, b, { lockedAt: b.res ? '2026-10-27T00:00:00Z' : null }))), READ.cert);
  eq('header meta', M.headMeta(main, list, perList, 'season', win, {}, 0, today), READ.head);
  const sorted = M.sortLedger(list), shown = M.ledgerFilter(sorted, 'all', null);
  eq('ledger meta', M.ledgerMeta(shown.length, list.length), READ.ledgerMeta);
  eq('ledger order (pending first, date desc, id desc)', shown.slice(0, 4).map(b => b.text), READ.firstRows);
  eq('month chips', M.ledgerMonths(list).map(c => [c.label, c.n, c.pl]), READ.months);
  const bm = M.bankCard(main), bc = M.bankCard(bets.filter(b => b.bank === 'chall'));
  eq('bankroll card Tennis 2026', { meta: bm.meta, roi: bm.roi, profit: bm.profit }, READ.bankMain);
  eq('bankroll card Challenger lab', { meta: bc.meta, roi: bc.roi, profit: bc.profit }, READ.bankChall);
  eq('ledger footer at 172 rows', M.ledgerFoot(172), 'Showing 14 of 172 · a result you settle here can be undone until you lock it · a locked result (blue tick) is frozen for good');

  // ── 2 · ROI = profit ÷ (won + lost stakes): a void stake never re-enters the denominator (T1 change 2) ──
  const d = new Date(2026, 4, 1);
  const V = [{ id: 1, date: d, odds: 2.0, stake: 1, res: 'won' }, { id: 2, date: d, odds: 1.9, stake: 1, res: 'lost' }, { id: 3, date: d, odds: 1.5, stake: 2, res: 'won' }, { id: 4, date: d, odds: 2.2, stake: 5, res: 'void' }];
  const sv = M.stats(V);
  near('void: profit', sv.profit, 1); near('void: ROI = 1 ÷ 4 (void stake 5 excluded)', sv.roi, 0.25);
  eq('void: ROI text', M.sgn(sv.roi * 100), '+25.0%'); eq('void: record', [sv.w, sv.l, sv.v], [2, 1, 1]);
  near('void: staked in total still counts the void', sv.staked, 9); near('void: P/L of a void', M.pl(V[3]), 0);
  eq('all void → ROI is a dash, not 0', M.sgn(M.stats([V[3]]).roi), DASH);
  eq('nothing settled → hero dashes', M.heroFigures(M.stats([])), { profit: DASH, roi: DASH, record: '0–0', voids: 0, winRate: DASH, avgClv: DASH, beat: 0, clvN: 0, maxDrawdown: DASH, bestRun: DASH, worstRun: DASH });

  // ── 3 · per bet ──
  near('P/L won', M.pl({ res: 'won', stake: 1.5, odds: 2.1 }), 1.65); near('P/L lost', M.pl({ res: 'lost', stake: 1.5, odds: 2.1 }), -1.5);
  near('P/L pending', M.pl({ res: null, stake: 1, odds: 2 }), 0);
  near('CLV = odds ÷ close − 1', M.clv({ odds: 2.10, close: 2.00 }), 0.05, 1e-12); eq('CLV without a close', M.clv({ odds: 2, close: null }), null);
  eq('sgn negative uses the true minus', M.sgn(-1.25), MINUS + '1.3%'); eq('sgn zero', M.sgn(0), '0.0%');
  eq('kind', [M.kind(1), M.kind(-1), M.kind(0), M.kind(null)], ['pos', 'neg', 'zero', 'lab']);

  // ── 4 · segment eligibility, minSample = 15 (floor 5) ──
  eq('minN default 15', M.minN(undefined), 15); eq('minN floor 5', M.minN(2), 5); eq('minN 40', M.minN(40), 40);
  const mk = (n, res, extra) => Array.from({ length: n }, (_, i) => Object.assign({ id: i, date: new Date(2026, 5, 1 + (i % 28)), odds: 2.0, close: 2.1, stake: 1, res: typeof res === 'function' ? res(i) : res, market: 'Total games', surface: 'Clay', level: '500', timing: 'pre', tilt: false, book: 'bet105' }, extra));
  const fifteenWins = mk(15, 'won'), fourteenWins = mk(14, 'won');
  ok('15 settled bets in a segment are eligible (n ≥ 15)', M.segments(fifteenWins, 15).strengths.some(g => g.dim === 'market' && g.name === 'Total games'));
  ok('14 settled bets are not (n < 15)', !M.segments(fourteenWins, 15).strengths.length);
  ok('Normal rhythm is never a segment', !M.segments(fifteenWins, 15).strengths.some(g => g.name === 'Normal rhythm'));
  ok('Bookmaker is never a strength cut', !M.segments(fifteenWins, 15).strengths.some(g => g.dim === 'book'));
  eq('strengths are top 3 by profit', M.segments(fifteenWins, 15).strengths.length, 3);
  const thinLoss = mk(6, 'lost', { market: 'Set winner' }).concat(mk(20, 'won'));
  const seg = M.segments(thinLoss, 15);
  eq('blind spot: 5 ≤ n < 15 and ROI < 0', seg.blind && [seg.blind.name, seg.blind.s.n], ['Set winner', 6]);
  ok('a losing segment of 4 is below the blind-spot floor', !M.segments(mk(4, 'lost', { market: 'Set winner' }).concat(mk(20, 'won')), 15).blind);
  const leaky = mk(16, 'lost', { surface: 'Grass', market: 'Match winner' }).concat(mk(16, 'won'));
  ok('leaks: profit < 0, n ≥ 15', M.segments(leaky, 15).leaks.some(g => g.dim === 'surface' && g.name === 'Grass'));
  eq('odds bands', [1.35, 1.36, 1.6, 1.61, 2.2, 2.21, 3.2, 3.21].map(M.band), ['1.10 – 1.35', '1.36 – 1.60', '1.36 – 1.60', '1.61 – 1.90', '1.91 – 2.20', '2.21 – 2.60', '2.61 – 3.20', '3.21 and up']);

  // ── 5 · discipline ──
  const D = M.discipline(list, 15);
  eq('closing line verdict on the seed', [D.checks[0].fig, D.checks[0].verdict], ['75%', 'REAL EDGE']);
  const beat = (n, k) => Array.from({ length: n }, (_, i) => ({ id: i, date: d, odds: 2, close: i < k ? 1.9 : 2.1, stake: 1, res: 'won', tilt: false }));
  eq('closing line 55% → REAL EDGE', M.discipline(beat(100, 55), 15).checks[0].verdict, 'REAL EDGE');
  eq('closing line 54% → COIN FLIP', M.discipline(beat(100, 54), 15).checks[0].verdict, 'COIN FLIP');
  eq('closing line 48% → COIN FLIP', M.discipline(beat(100, 48), 15).checks[0].verdict, 'COIN FLIP');
  eq('closing line 47% → PAYING TOO MUCH', M.discipline(beat(100, 47), 15).checks[0].verdict, 'PAYING TOO MUCH');
  const seq = (pairs) => pairs.map(([res, stake], i) => ({ id: i, date: d, odds: 2, close: null, stake, res, tilt: false }));
  eq('stake after a loss ×1.50 → CHASING', [M.discipline(seq([['lost', 1], ['won', 1.5], ['won', 1]]), 15).checks[1].fig, M.discipline(seq([['lost', 1], ['won', 1.5], ['won', 1]]), 15).checks[1].verdict], ['×1.50', 'CHASING']);
  near('drawdown is peak to trough, not from 0', M.stats(seq([['won', 1], ['lost', 1], ['lost', 1]]).map(b => Object.assign(b, { odds: 3 }))).dd, 2);
  eq('stake after a loss ×1.20 → CHASING', M.discipline(seq([['lost', 1], ['won', 1.2], ['won', 1]]), 15).checks[1].verdict, 'CHASING');
  eq('stake after a loss ×0.50 → SHRINKING', M.discipline(seq([['lost', 1], ['won', 0.5], ['won', 1]]), 15).checks[1].verdict, 'SHRINKING');
  eq('stake after a loss ×1.00 → STEADY', M.discipline(seq([['lost', 1], ['won', 1], ['won', 1]]), 15).checks[1].verdict, 'STEADY');
  // 3 · stake consistency (v26): largest ÷ average — EVEN ≤ ×1.5 · UNEVEN ≤ ×2 · WENT BIG above; each with its flip case
  const stk = a => a.map((x, i) => ({ id: i, date: d, odds: 2, close: null, stake: x, res: 'won' }));
  const sc = a => M.disciplineView(stk(a), 15, 'Season').checks[2];
  eq('stake consistency ×1.50 → EVEN · ×1.60 → UNEVEN (flip)', [sc([1, 3]).verdict, sc([1, 3]).fig, sc([1, 1, 1, 2.01]).verdict], ['EVEN', '×1.50', 'UNEVEN']);
  eq('stake consistency ×2.00 → UNEVEN · ×2.02 → WENT BIG (flip)', [sc([1, 1, 4]).verdict, sc([1, 1, 4]).fig, sc([1, 1, 4.1]).verdict], ['UNEVEN', '×2.00', 'WENT BIG']);
  eq('stake consistency short line, exact', sc([1, 1, 4]).short, 'Largest 4.0% vs average 2.00% · 1 of 3 bets over 1.5× · target ≤ ×1.5');
  eq('stake consistency label + judged: EVEN ok, UNEVEN / WENT BIG need work', [sc([1, 1]).label, sc([1, 1]).ok, sc([1, 1, 4]).ok, sc([1, 1, 4.1]).ok], ['Stake consistency', true, false, false]);
  eq('stake consistency with no bets: — and not judged', [M.discipline([], 15).checks[2].verdict, M.discipline([], 15).checks[2].ok], [DASH, null]);
  ok('no "Third bet after two losses" check is left', !M.discipline(stk([1, 2]), 15).checks.some(c => /Third bet/.test(c.label)));
  eq('no bets → nothing judged, no badge (never a fabricated verdict)', [M.discipline([], 15).judged, M.discipline([], 15).badge], [0, '']);

  // ── 6 · the six staking plans ──
  eq('v26 plans in the reference order', M.PLANS.map(p => p.name), ['Flat 1%', 'Flat 2%', 'Compounding 1%', 'To win 1%', '¼ Kelly on CLV', '½ Kelly on model', 'Odds-banded', 'Confidence tiers', 'Double after a loss']);
  eq('Odds-banded edges: 1.59 → 1.5 · 1.60 → 1 · 2.20 → 1 · 2.21 → 0.5', [1.59, 1.60, 2.20, 2.21].map(o => M.plan('Odds-banded').f({ odds: o })), [1.5, 1, 1, 0.5]);
  eq('shown plans: Confidence tiers is off until a Confidence field exists (Michael\'s ruling)', [M.CONFIDENCE_TIERS, M.shownPlans().map(p => p.name)], [false, ['Flat 1%', 'Flat 2%', 'Compounding 1%', 'To win 1%', '¼ Kelly on CLV', '½ Kelly on model', 'Odds-banded', 'Double after a loss']]);
  const b2 = { odds: 2.0, close: 1.9 }, b125 = { odds: 1.25, close: 1.3 };
  near('Flat 1%', M.plan('Flat 1%').f(b2, 0, null), 1); near('Flat 2%', M.plan('Flat 2%').f(b2, 0, null), 2);
  near('Compounding 1% at +20%', M.plan('Compounding 1%').f(b2, 20, null), 1.2); near('Compounding 1% floors at 0', M.plan('Compounding 1%').f(b2, -150, null), 0);
  near('To win 1% at 2.00', M.plan('To win 1%').f(b2, 0, null), 1); near('To win 1% caps at 5', M.plan('To win 1%').f({ odds: 1.1 }, 0, null), 5);
  near('¼ Kelly on CLV = 25 × clv ÷ (odds − 1)', M.plan('¼ Kelly on CLV').f(b2, 0, null), 25 * (2 / 1.9 - 1), 1e-12);
  near('¼ Kelly: no stake when the close went against', M.plan('¼ Kelly on CLV').f(b125, 0, null), 0);
  near('¼ Kelly caps at 3', M.plan('¼ Kelly on CLV').f({ odds: 1.5, close: 1.2 }, 0, null), 3);
  near('Double after a loss: first bet 1', M.plan('Double after a loss').f(b2, 0, null), 1);
  near('Double after a loss: ×2 after a loss', M.plan('Double after a loss').f(b2, 0, { res: 'lost', st: 2 }), 4);
  near('Double after a loss: cap 8', M.plan('Double after a loss').f(b2, 0, { res: 'lost', st: 8 }), 8);
  near('Double after a loss: back to 1 on a win', M.plan('Double after a loss').f(b2, 0, { res: 'won', st: 4 }), 1);
  const sim = M.simulate(seq([['lost', 1], ['lost', 1], ['won', 1]]), 'Double after a loss');
  eq('Double after a loss replay: stakes 1, 2, 4', sim.sts, [1, 2, 4]); near('… ends +1%', sim.end, 1); near('… drawdown 3%', sim.dd, 3);
  near('Your stakes replay = the logged P/L', M.simulate(list.filter(M.isSettled), 'Your stakes').end, S.profit, 1e-9);
  eq('planStake: To win 1% needs the odds first', M.planStake('To win 1%', [], NaN), null);

  // ── 9 · T2 hero: tiles, curve, the Filters menu (cross-adjusted, against an independent recount) ──
  const HT = M.heroTiles(S, list), HC = M.heroCurve(list, today);
  eq('hero tile labels', HT.rows.map(r => r.label), ['ROI', 'Record', 'Win rate', 'Avg CLV', 'Max drawdown', 'Best run', 'Worst run']);
  eq('hero tile values', HT.rows.map(r => r.value), [READ.roi, READ.record, READ.winRate, READ.avgClv, READ.maxDrawdown, READ.bestRun, READ.worstRun]);
  { // v26 subs: break-even at the average price, and the average run — recounted here from the bets, not from stats()
    const sl = list.filter(M.isSettled), avgO = sl.reduce((a, b) => a + b.odds, 0) / sl.length, wR = [], lR = []; let w = 0, l = 0, bestEnd = null, worstEnd = null, best = 0, worst = 0;
    sl.forEach(b => { if (b.res === 'won') { if (l) lR.push(l); l = 0; w++; if (w > best) { best = w; bestEnd = b.date; } } else if (b.res === 'lost') { if (w) wR.push(w); w = 0; l++; if (l > worst) { worst = l; worstEnd = b.date; } } });
    if (w) wR.push(w); if (l) lR.push(l); const av = a => a.reduce((x, y) => x + y, 0) / a.length;
    eq('hero tile subs (v26)', HT.rows.map(r => r.sub), ['profit ÷ total staked', READ.recordSub, 'break-even ' + (100 / avgO).toFixed(0) + '% at avg ' + avgO.toFixed(2), READ.beat, 'peak to trough, % of bankroll',
      'avg winning run ' + av(wR).toFixed(1) + ' · ' + wR.length + ' runs', 'avg losing run ' + av(lR).toFixed(1) + ' · ' + lR.length + ' runs']);
    const MY = d => ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + ' ' + d.getFullYear();
    eq('hero tile "when": the month the record run ended, on Best / Worst run only', HT.rows.map(r => r.when), ['', '', '', '', '', MY(bestEnd), MY(worstEnd)]);
    const wrK = S.winRate > 1 / avgO ? 'pos' : S.winRate < 1 / avgO ? 'neg' : 'zero';
    eq('hero tile colours (v26): Record + Win rate vs break-even, runs green / red', HT.rows.map(r => r.kind), [M.kind(S.roi), wrK, wrK, M.kind(S.clv), 'neg', 'pos', 'neg']);
    const be = M.heroTiles(M.stats(seq([['won', 1], ['lost', 1]])), seq([['won', 1], ['lost', 1]]));
    eq('break-even flip: 1–1 at avg 2.00 = 50% = break-even → neutral', [be.rows[1].kind, be.rows[2].kind, be.rows[2].sub], ['zero', 'zero', 'break-even 50% at avg 2.00']);
    const be2 = M.heroTiles(M.stats(seq([['won', 1], ['won', 1], ['lost', 1]])), seq([['won', 1], ['won', 1], ['lost', 1]]));
    eq('break-even flip: 2–1 at avg 2.00 → above → green', [be2.rows[1].kind, be2.rows[2].kind], ['pos', 'pos']);
  }
  eq('hero profit + sub', [HT.profit, HT.profitSub], [READ.profit, READ.profitSub]);
  eq('curve meta (model)', HC.meta, READ.curveMeta);
  eq('curve drawdown note (model)', HC.ddNote, READ.ddNote);
  eq('curve: 170 points + the origin, M first', [HC.path.split(/[ML]/).length - 1, HC.path[0]], [171, 'M']);
  ok('curve: the zero tick is solid and present', HC.yTicks.some(t => t.zero));
  eq('curve: y step 5 on a ~30% span, labels signed', HC.yTicks.map(t => t.label), ['−10%', '−5%', '0%', '+5%', '+10%', '+15%']);
  eq('curve: the season\'s month labels, May dropped (44px after Apr, under the 70px rule)', HC.xTicks.map(t => t.label), ['Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']);
  eq('curve: nothing settled → no line, meta dashes', [M.heroCurve([], today).path, M.heroCurve([], today).meta], ['', '0 bets · peak — · now —']);
  eq('Avg CLV tile with no closes: — over "no closing prices"', M.heroTiles(M.stats(V)).rows[3], { label: 'Avg CLV', sub: 'no closing prices', value: DASH, kind: 'lab', when: '' });
  const longYears = []; for (let y = 2022; y <= 2025; y++) for (let m = 0; m < 12; m++) longYears.push({ id: y * 100 + m, date: new Date(y, m, 5), odds: 2, stake: 1, res: 'won' });
  { // T9 (Michael 2026-10-29): a 48-month ledger — labels at least CURVE_LABEL_GAP apart, January with its year, ≤ 8 y ticks
    const HL = M.heroCurve(longYears, today), xs = HL.xTicks.map(t => parseFloat(t.left) / 100 * 1286);   // px on the 1286px label strip
    ok('T9: the 48-month ledger draws some labels but not all 48', HL.xTicks.length > 4 && HL.xTicks.length < 48, String(HL.xTicks.length));
    ok('T9: every drawn label sits ≥ 70px right of the one before', xs.every((x, i) => !i || x - xs[i - 1] >= M.CURVE_LABEL_GAP - 1e-6), JSON.stringify(xs.map(x => x.toFixed(1))));
    eq('T9: the gap is 70 at the 1340 column', M.CURVE_LABEL_GAP, 70);
    ok('T9: January labels carry their year, other months stay three letters', HL.xTicks.every(t => /^Jan 20\d\d$/.test(t.label) || /^(Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/.test(t.label)), JSON.stringify(HL.xTicks.map(t => t.label)));
    eq('T9: the labels are the first bet of each month, greedily spaced', HL.xTicks.map(t => t.label).slice(0, 5), ['Jan 2022', 'Apr', 'Jul', 'Oct', 'Jan 2023']);
    ok('T9: the 48-month ledger has at most 8 y ticks, zero among them', HL.yTicks.length <= 8 && HL.yTicks.some(t => t.zero), JSON.stringify(HL.yTicks.map(t => t.label)));
    eq('T9: +48% climbs on step 10', HL.yTicks.map(t => t.label), ['0%', '+10%', '+20%', '+30%', '+40%']);
    const swing = []; for (let i = 0; i < 48; i++) swing.push({ id: i, date: new Date(2022 + Math.floor(i / 12), i % 12, 5), odds: 2, stake: 6, res: i < 20 ? 'lost' : 'won' });
    const SW = M.heroCurve(swing, today).yTicks.map(t => t.label);   // −120 … +48: step 10 would be 18 ticks
    ok('T9: a −120 → +48 span steps up to ≤ 8 ticks', SW.length <= 8 && SW.includes('0%'), JSON.stringify(SW));
    eq('T9: … on step 50 (20 still gives 9)', SW, ['−100%', '−50%', '0%', '+50%']);
    ok('T9: the 70px rule holds on the short seed season too, bare labels', HC.xTicks.every((t, i, a) => !i || (parseFloat(t.left) - parseFloat(a[i - 1].left)) / 100 * 1286 >= 70 - 1e-6) && HC.xTicks.every(t => t.label.length === 3), JSON.stringify(HC.xTicks));
    const edge = []; for (let i = 0; i < 71; i++) edge.push({ id: i, date: new Date(2022, Math.floor(i / 2), 5), odds: 2, stake: 1, res: 'won' });   // months 70.08 viewBox units apart in pairs
    const ex = M.heroCurve(edge, today).xTicks.map(t => parseFloat(t.left) / 100 * 1286);
    ok('T9: the 70px is read on the 1286px strip, not in viewBox units', ex.every((x, i) => !i || x - ex[i - 1] >= 70 - 1e-6), JSON.stringify(ex.map(x => x.toFixed(2))));
    const crowd = HL.xTicks.length, all48 = longYears.length;
    ok('T9: the 48-month candidates do NOT all fit — thinning engaged', crowd < all48, crowd + ' of ' + all48);
  }
  { // F2: the y range spans min(0, low) → max(0, high), and each side the curve reaches has a tick
    const up = seq([['lost', 15], ['lost', 15], ['lost', 15], ['won', 48]]);   // −45 … ends +3 (odds 2): step 10, the positive side under one step
    const labs = M.heroCurve(up, today).yTicks.map(t => t.label);
    ok('F2: a curve that ends above zero below one step still shows a positive tick', labs.some(l => l.startsWith('+')), JSON.stringify(labs));
    ok('F2: … and its negative ticks', labs.some(l => l.startsWith('−')), JSON.stringify(labs));
    const onlyUp = M.heroCurve(seq([['won', 1], ['won', 1]]), today).yTicks.map(t => t.label);
    ok('F2: a curve that never goes below zero gets no negative tick', !onlyUp.some(l => l.startsWith('−')), JSON.stringify(onlyUp));
  }
  const F2 = { level: ['ATP 500', 'Masters 1000'], odds: ['1.61 – 1.90'], surface: [], market: ['Match winner'] };
  const menu = M.filterMenu(main, perList, F2);
  const pass = (b, except) => (except === 'level' || !F2.level.length || F2.level.includes(M.LEVEL[b.level])) && (except === 'odds' || !F2.odds.length || F2.odds.includes(M.band(b.odds)))
    && (except === 'surface' || !F2.surface.length || F2.surface.includes(b.surface)) && (except === 'market' || !F2.market.length || F2.market.includes(b.market));
  const want = g => g.opts.map(o => perList.filter(b => pass(b, g.key) && (g.key === 'level' ? M.LEVEL[b.level] : g.key === 'odds' ? M.band(b.odds) : b[g.key]) === o.label).length);
  eq('filter menu: groups', menu.map(g => g.label), ['Level', 'Odds band', 'Surface', 'Market']);
  eq('filter menu: every count = the bets that row would leave given the other groups', menu.map(g => g.opts.map(o => o.n)), menu.map(want));
  ok('filter menu: a selected row is on, a zero row is grey', menu[0].opts.find(o => o.label === 'ATP 500').on && menu.every(g => g.opts.every(o => o.zero === (o.n === 0))));
  eq('filters label: two + "+N"', M.filtersLabel(F2), 'Filters · ATP 500 · Masters 1000 · +2');
  eq('filters label: none', M.filtersLabel({ level: [], odds: [], surface: [], market: [] }), 'Filters');
  eq('filters foot', M.filtersFoot(M.applyFilters(perList, F2), perList), M.applyFilters(perList, F2).length + ' of 172 bets in the period · a count is what that row would leave given the others');
  eq('Last 30 days over the seed = the bets dated 27 Sep → 27 Oct', M.inPeriod(main, M.periodWindow('30d', {}, today)).length, main.filter(b => b.date >= new Date(2026, 8, 27)).length);
  eq('Last 90 days over the seed = the bets dated 29 Jul → 27 Oct', M.inPeriod(main, M.periodWindow('90d', {}, today)).length, main.filter(b => b.date >= new Date(2026, 6, 29)).length);
  eq('header meta with a custom range across years', M.headMeta(main, list, perList, 'custom', M.periodWindow('custom', { from: '2025-11-01', to: '2026-06-30' }, today), { from: '2025-11-01', to: '2026-06-30' }, 2, today).split(' · ').slice(-2).join(' · '),
    '1 Nov 2025 → 30 Jun shown · 2 filters on, ' + list.length + ' of ' + perList.length + ' bets');

  // ── 10 · T7 calendar (v26 month cards): tiles, open-month planner, week net €, stats, the month pop-up ──
  { const CV = M.calendarView(main, today, M.ym(today), null);
    const byM = {}; main.forEach(b => { const k = b.date.getFullYear() * 12 + b.date.getMonth(); (byM[k] = byM[k] || []).push(b); });
    eq('cards: one per month with bets, ascending', CV.cards.map(c => c.key), Object.keys(byM).map(Number).sort((x, y) => x - y));
    eq('cards: name "October 2026", P/L = the month\'s settled P/L', [CV.cards[CV.cards.length - 1].name, CV.cards[CV.cards.length - 1].pl], ['October 2026', M.sgn(byM[M.ym(today)].reduce((x, b) => x + M.pl(b), 0))]);
    eq('cards: six rows of seven mini cells', CV.cards.map(c => [c.rows.length, c.rows[0].length]).every(x => x[0] === 6 && x[1] === 7), true);
    const O = CV.open, days = {}; byM[M.ym(today)].filter(M.isSettled).forEach(b => { const k = M.dayKey(b.date); days[k] = (days[k] || 0) + M.pl(b); });
    // week net €: recount each planner row's settled P/L from the bets, independently of calendarView
    const first = new Date(today.getFullYear(), today.getMonth(), 1), fd = (first.getDay() + 6) % 7;
    const want = O.rows.map((r, ri) => { let s = 0, any = false; for (let c = 0; c < 7; c++) { const d = new Date(today.getFullYear(), today.getMonth(), 1 + ri * 7 + c - fd); if (d.getMonth() !== today.getMonth()) continue; const k = M.dayKey(d); if (k in days) { s += days[k]; any = true; } } return any ? M.eur(s) : '—'; });
    eq('week net € = each week\'s settled P/L × 100, recounted', O.rows.map(r => r.pl), want);
    eq('Best week = the largest week net €', O.stats[6].v, (() => { const v = O.rows.filter(r => r.any).map(r => r.wpl); return M.eur(Math.max(...v)) + ' €'; })());
    const dvals = Object.values(days);
    eq('Up days "x of y" over the betting days', O.stats[7].v, dvals.filter(v => v > 0).length + ' of ' + dvals.length);
    eq('Best day / Worst day carry their € and "Dow d Mon"', [O.stats[4].v, O.stats[5].v, /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}$/.test(O.stats[4].s)], [M.eur(Math.max(...dvals)) + ' €', M.eur(Math.min(...dvals)) + ' €', true]);
    eq('stat labels', O.stats.map(x => x.l), ['P/L', 'ROI', 'Win rate', 'Avg CLV', 'Best day', 'Worst day', 'Best week', 'Up days']);
    ok('the open panel starts on Monday: row 0 holds the 1st at its weekday', O.rows[0].cells[fd].dt === '1' && O.rows[0].cells.slice(0, fd).every(c => c.bg === 'out'));
  }
  // the three tint steps (|P/L| in %: < 1.2 → 0.30, < 2.8 → 0.55, else 0.90) and the flat day
  { const vd = [{ id: 1, date: new Date(2026, 9, 2), odds: 2, stake: 1, res: 'won' }, { id: 2, date: new Date(2026, 9, 2), odds: 2, stake: 1, res: 'lost' }, { id: 3, date: new Date(2026, 9, 2), odds: 2, stake: 1, res: 'void' }];
    const day = M.calendarView(vd, today, 2026 * 12 + 9, null).open.rows.flatMap(r => r.cells).find(c => c.dt === '2' && c.has);
    eq('a void is neither won nor lost in a day\'s W–L ("1–1", not the reference\'s 1–2)', [day.short, day.sub], ['1–1', '3 settled · 1–1']); }
  eq('tint: 1.19% → 0.30, 1.2% → 0.55, 2.79% → 0.55, 2.8% → 0.90', [M.tint(1.19).alpha, M.tint(1.2).alpha, M.tint(2.79).alpha, M.tint(2.8).alpha], [0.3, 0.55, 0.55, 0.9]);
  eq('tint: sign → tone, zero → flat', [M.tint(-2).tone, M.tint(2).tone, M.tint(0).tone, M.tint(-2).alpha], ['neg', 'pos', 'flat', 0.55]);
  eq('€ on a 10,000 € bankroll: ×100, true minus, thousands comma', [M.eur(1.234), M.eur(-12.3456), M.eur(25.5), M.eur(0)], ['+123', '−1,235', '+2,550', '0']);
  { const two = [{ id: 1, date: new Date(2025, 9, 3), odds: 2, stake: 1, res: 'won' }, { id: 2, date: new Date(2026, 9, 3), odds: 2, stake: 1, res: 'lost' }];
    eq('multi-year: October 2025 and October 2026 are two tiles', M.calendarView(two, today, null, null).cards.map(c => [c.name, c.pl]), [['October 2025', '+1.0%'], ['October 2026', '−1.0%']]); }
  eq('ROI bar: +20% fills half its side, −60% clips at 50%', [M.roiBar(0.2), M.roiBar(-0.6)], [{ left: '50%', width: '25%', kind: 'pos' }, { left: '0%', width: '50%', kind: 'neg' }]);
  eq('ROI bar: no ROI, no bar', M.roiBar(null).width, '0%');
  { const oct = main.filter(b => M.isSettled(b) && M.ym(b.date) === M.ym(today)), MP = M.monthPop(M.ym(today), oct, today);
    eq('month pop-up title + tile labels', [MP.title, MP.stats.map(x => x.l)], ['October 2026', ['P/L', 'ROI', 'Win rate', 'Avg CLV']]);
    ok('month pop-up sub "N settled bets · W–L · x% staked"', new RegExp('^' + oct.length + ' settled bets · \\d+–\\d+ · \\d+\\.\\d% staked$').test(MP.sub), MP.sub);
    eq('month pop-up: rows newest first, every one settled', MP.rows.length, oct.length); }
  // F5: the ledger meta joins the parts that are there
  eq('F5: a blank tournament starts at the level', M.betMeta({ tour: '', level: '500', surface: 'Hard' }), 'ATP 500 · Hard');
  eq('F5: a stored "—" tournament is not printed', M.betMeta({ tour: '—', level: '250', surface: '' }), 'ATP 250');
  eq('F5: nothing there → nothing', M.betMeta({ tour: '', level: null, surface: null }), '');
  { const C = M.heroCurve([{ id: 1, date: new Date(2026, 9, 2), tour: '', level: null, odds: 1.82, stake: 1, res: 'lost', text: 'x' }], today);
    eq('F5: the curve hover meta has no leading separator when tournament and level are blank', M.curveHover(C, C.X(1), today).bet.meta, '@ 1.82'); }
  eq('F5: the month pop-up meta joins only what is there', M.monthPop(1, [{ id: 1, date: new Date(2026, 9, 2), tour: '', level: '500', surface: 'Hard', market: 'Match winner', odds: 2, close: null, stake: 1, res: 'won', text: 'x' }], today).rows[0].meta, 'ATP 500 · Hard');

  {
  // ── 11 · T4 verdicts: segment eligibility, blind-spot selection, the three discipline thresholds (each flips) ──
  let nid = 1000;
  const mkb = (n, o) => Array.from({ length: n }, (_, i) => Object.assign({ id: nid++, date: new Date(2026, 5, 1 + (i % 28)), odds: 2, stake: 1, res: 'won', market: 'Match winner', surface: 'Hard', level: '500', timing: 'pre', tilt: false, book: 'bet105', close: null }, typeof o === 'function' ? o(i) : o));
  // a Clay segment of 15: 10 won, 5 lost at 2.00 → +5 profit, ROI +33% → an edge; at 14 it is not eligible
  const clay15 = mkb(15, i => ({ surface: 'Clay', market: 'Total sets', res: i < 10 ? 'won' : 'lost' })), base = mkb(20, i => ({ res: i % 2 ? 'won' : 'lost', odds: 1.9 }));
  eq('eligibility: 15 bets on Clay is an edge', M.segments(clay15.concat(base), 15).strengths.map(g => g.name).includes('Clay'), true);
  eq('eligibility: 14 is not (flips)', M.segments(clay15.slice(1).concat(base), 15).strengths.map(g => g.name).includes('Clay'), false);
  const thin = mkb(15, i => ({ surface: 'Grass', market: 'Total sets', odds: 1.5, res: i < 11 ? 'won' : 'lost' }));   // +5.5 −4 = +1.5 → ROI 10%
  const lean = mkb(100, i => ({ surface: 'Grass', market: 'Total sets', odds: 2, res: i < 51 ? 'won' : 'lost' }));   // +2 profit, ROI 2% → under the 3% floor
  eq('eligibility: profit > 0 and ROI > 3% (Grass +10%) …', M.segments(thin.concat(base), 15).strengths.some(g => g.name === 'Grass'), true);
  eq('… flips at ROI 2% (profit still > 0)', M.segments(lean.concat(base), 15).strengths.some(g => g.name === 'Grass'), false);
  eq('"Normal rhythm" is never a segment', M.segments(base, 15).strengths.concat(M.segments(base, 15).leaks).some(g => g.name === 'Normal rhythm'), false);
  eq('Bookmaker is never an edge or a leak', M.segments(mkb(30, { book: 'Pinnacle', res: 'won' }), 15).strengths.some(g => g.dim === 'book'), false);
  // blind spot: the worst P/L segment with 5 ≤ n < 15 and ROI < 0
  const bs = base.concat(mkb(6, { surface: 'Grass', odds: 1.9, res: 'lost' }), mkb(8, i => ({ surface: 'Clay', odds: 1.9, res: i < 3 ? 'won' : 'lost' })));
  eq('blind spot: the worst-P/L thin losing segment (Grass −6 beats Clay −2)', [M.segments(bs, 15).blind.name, M.segments(bs, 15).blind.s.n], ['Grass', 6]);
  eq('blind spot: 4 bets is under the floor of 5 (flips to Clay)', M.segments(base.concat(mkb(4, { surface: 'Grass', odds: 1.9, res: 'lost' }), mkb(8, i => ({ surface: 'Clay', odds: 1.9, res: i < 3 ? 'won' : 'lost' }))), 15).blind.name, 'Clay');
  eq('blind spot: a weekday is never one', M.segments(mkb(6, { res: 'lost', date: new Date(2026, 5, 6) }).concat(mkb(30, { res: 'won', date: new Date(2026, 5, 2) })), 15).blind === null || M.segments(mkb(6, { res: 'lost', date: new Date(2026, 5, 6) }).concat(mkb(30, { res: 'won', date: new Date(2026, 5, 2) })), 15).blind.dim !== 'dow', true);
  // 1 · closing line: ≥55% REAL EDGE · 48–54 COIN FLIP · else PAYING TOO MUCH
  const beat = k => mkb(100, i => ({ close: i < k ? 1.9 : 2.1 }));
  eq('closing line 55% → REAL EDGE; 54% → COIN FLIP; 48% → COIN FLIP; 47% → PAYING TOO MUCH', [55, 54, 48, 47].map(k => M.discipline(beat(k), 15).checks[0].verdict), ['REAL EDGE', 'COIN FLIP', 'COIN FLIP', 'PAYING TOO MUCH']);
  // 2 · stake after a loss ÷ after a win: > 1.15 CHASING · < 0.85 SHRINKING · else STEADY
  const alt = r => mkb(40, i => ({ res: i % 2 ? 'lost' : 'won', stake: i % 2 ? 1 : (i === 0 ? 1 : r) }));   // a win follows every loss: stake r; a loss follows every win: stake 1
  eq('stake ratio ×1.16 CHASING · ×1.14 STEADY · ×0.86 STEADY · ×0.84 SHRINKING', [1.16, 1.14, 0.86, 0.84].map(r => M.discipline(alt(r), 15).checks[1].verdict), ['CHASING', 'STEADY', 'STEADY', 'SHRINKING']);
  eq('no data is never judged: closing line —, stake ratio —', [M.discipline([], 15).checks[0].verdict, M.discipline([], 15).checks[1].verdict, M.discipline([], 15).judged], [DASH, DASH, 0]);
  const dv = M.disciplineView(mkb(3, { close: null }), 15, 'Season');
  eq('discipline view with no closes: "0 of 0 priced bets beat the close · target 55%+", the dial not judged', [dv.checks[0].short, dv.checks[0].fig, dv.checks[0].ok], ['0 of 0 priced bets beat the close · target 55%+', DASH, null]);
  eq('breakdown: a bet with no value for the cut is in no row (counted in left)', [M.breakdown(mkb(4, i => ({ level: i < 1 ? '' : '500' })), 'level').rows.map(r => [r.name, r.n]), M.breakdown(mkb(4, i => ({ level: i < 1 ? '' : '500' })), 'level').left], [[['ATP 500', 3]], 1]);
  }

  // ── 11b · T8 verdict pair card + the Market pop-up ──
  { const mk = (n, odds, won, extra) => Array.from({ length: n }, (_, i) => Object.assign({ id: odds * 1000 + i, date: new Date(2026, 5, 1 + (i % 25)), odds, close: odds, stake: 1, res: i < won ? 'won' : 'lost', market: 'Match winner', level: '500', surface: 'Hard', book: 'bet105', timing: 'pre', text: 't' }, extra || {}));
    const two = mk(15, 1.50, 12).concat(mk(15, 2.50, 3));   // 1.36 – 1.60: 12×0.5 − 3 = +3.0, ROI +20% · 2.21 – 2.60: 3×1.5 − 12 = −7.5, ROI −50%
    const V = M.verdicts(two, 15)[2];
    eq('price card: best v worst band, gap in pp, the pair rows', [V.kind, V.seg, V.pl, V.title, V.rows.map(r => [r.band, r.n, r.rec, r.roi, r.dash])],
      ['Your price range', 'best v worst odds band', '+70.0 pp', 'You earn most at 1.36 – 1.60 and lose at 2.21 – 2.60.', [['1.36 – 1.60', 'n=15', '12–3', '+20.0%', 'solid'], ['2.21 – 2.60', 'n=15', '3–12', '−50.0%', 'dashed']]]);
    eq('price card: one band with 15+ → the empty sentence', [M.verdicts(mk(15, 1.50, 12).concat(mk(14, 2.50, 3)), 15)[2].pl, M.verdicts(mk(15, 1.50, 12), 15)[2].title], [DASH, 'Two odds bands with 15+ bets are needed to compare prices.']);
    eq('price card: both bands up → "and least at" (+20% v +16.7%)', M.verdicts(mk(15, 1.50, 12).concat(mk(15, 2.50, 7)), 15)[2].title, 'You earn most at 1.36 – 1.60 and least at 2.21 – 2.60.');
    const X = M.marketDetail(mk(4, 1.40, 3).concat(mk(3, 2.80, 1)), 'Match winner', 'Season');
    eq('market pop-up (Match winner): split by price, six tiles', [X.subHead, X.lines.map(l => [l.name, l.n, l.wl]), X.stats.map(x => x.l), X.stats[0].v, X.stats[4].v],
      ['Price band', [['Under 1.50', 4, '3–1'], ['2.60 and up', 3, '1–2']], ['Win rate', 'Avg odds', 'Avg CLV', 'Avg stake', 'Favourites v dogs', 'Best price band'], '57%', '4 · 3']);
    const G = M.marketDetail(mk(2, 2, 1, { market: 'Games handicap', line: '−3.5' }).concat(mk(2, 2, 2, { market: 'Games handicap', line: '+2.5' })), 'Games handicap', 'Season');
    eq('market pop-up (Games handicap): lines, giving v taking', [G.subHead, G.lines.map(l => l.name), G.stats[4].l, G.stats[4].v, G.stats[5].v], ['Line', ['−3.5', '+2.5'], 'Giving v taking', '2 · 2', '+2.5']);
  }
  // ── 12 · T5 staking: every plan on a hand-computed 5-bet case (won 2.00 · lost 1.50 · won 1.15 · lost 3.00 no close · void 2.50) ──
  {
    const d5 = new Date(2026, 6, 1);
    const B5 = [{ id: 1, date: d5, odds: 2.00, stake: 1, res: 'won', close: 1.90 }, { id: 2, date: d5, odds: 1.50, stake: 2, res: 'lost', close: 1.60 },
      { id: 3, date: d5, odds: 1.15, stake: 1, res: 'won', close: 1.10 }, { id: 4, date: d5, odds: 3.00, stake: 0.5, res: 'lost', close: null }, { id: 5, date: d5, odds: 2.50, stake: 1, res: 'void', close: 2.40 }];
    // the Stennisfy fair price at posting (v26 ½ Kelly on model): 1.80 · 1.60 · 1.10 · none · 2.45
    [1.80, 1.60, 1.10, null, 2.45].forEach((f, i) => { B5[i].fair = f; });
    const hand = {
      'Your stakes': { sts: [1, 2, 1, 0.5, 1], end: 1 - 2 + 0.15 - 0.5 },
      'Flat 1%': { sts: [1, 1, 1, 1, 1], end: 1 - 1 + 0.15 - 1, dd: 1.85 },
      'Flat 2%': { sts: [2, 2, 2, 2, 2], end: 2 - 2 + 0.3 - 2, dd: 3.7 },
      'Compounding 1%': { sts: [1, 1.01, 0.9999, 1.00139985, 0.9913858515], end: 1 - 1.01 + 0.9999 * 0.15 - 1.00139985 },
      'To win 1%': { sts: [1, 2, 5, 0.5, 1 / 1.5], end: 1 - 2 + 5 * 0.15 - 0.5 },   // 1 ÷ 0.15 = 6.67 → the 5% cap
      '¼ Kelly on CLV': { sts: [25 * (2 / 1.9 - 1), 0, 3, 0, 25 * (2.5 / 2.4 - 1) / 1.5], end: 25 * (2 / 1.9 - 1) + 3 * 0.15 },   // no close / CLV ≤ 0 → 0; 7.58 → the 3% cap
      'Double after a loss': { sts: [1, 1, 2, 1, 2], end: 1 - 1 + 2 * 0.15 - 1 },
      // ½ Kelly on model: p = 1/fair, k = odds − 1, f = (p·k − (1−p))/k → 50·f, cap 3, f ≤ 0 or no fair → 0
      //   2.00 @ 1.80: f = 0.1111 → 5.56 → 3 · 1.50 @ 1.60: f < 0 → 0 · 1.15 @ 1.10: f = 0.3030 → 3 · no fair → 0 · 2.50 @ 2.45: f = 0.013605 → 0.6803
      '½ Kelly on model': { sts: [3, 0, 3, 0, 50 * ((1 / 2.45) * 1.5 - (1 - 1 / 2.45)) / 1.5], end: 3 + 3 * 0.15 },
      // Odds-banded: 1.5 under 1.60 · 1 to 2.20 · 0.5 above
      'Odds-banded': { sts: [1, 1.5, 1.5, 0.5, 0.5], end: 1 - 1.5 + 1.5 * 0.15 - 0.5 },
      // Confidence tiers (off on the page, kept in the maths): logged stake ≤ 1 → 0.5 · ≤ 1.5 → 1 · else 1.5
      'Confidence tiers': { sts: [0.5, 1.5, 0.5, 0.5, 0.5], end: 0.5 - 1.5 + 0.5 * 0.15 - 0.5 }
    };
    for (const [name, h] of Object.entries(hand)) {
      const r = M.simulate(B5, name);
      ok(`${name}: stakes ${h.sts.map(x => x.toFixed(4)).join(', ')}`, r.sts.length === 5 && r.sts.every((x, i) => Math.abs(x - h.sts[i]) < 1e-9));
      near(`${name}: end ${h.end.toFixed(4)}%`, r.end, h.end, 1e-9);
      if (h.dd !== undefined) near(`${name}: drawdown ${h.dd}%`, r.dd, h.dd, 1e-9);
    }
    ok('¼ Kelly: the explainer says how many bets it skipped (no close or CLV ≤ 0)', M.stakingView(B5, '¼ Kelly on CLV').diffTxt.includes('skipping 2 of 5 bets'));
    ok('¼ Kelly with no closes at all: the plan stakes nothing, skips every bet, average "—"', /the plan —\. .*|, skipping 5 of 5 bets/.test(M.stakingView(B5.map(b => Object.assign({}, b, { close: null })), '¼ Kelly on CLV').diffTxt)
      && M.stakingView(B5.map(b => Object.assign({}, b, { close: null })), '¼ Kelly on CLV').diffTxt.includes('the plan —, skipping 5 of 5 bets'));
    { const Z = M.stakingView(B5.map(b => Object.assign({}, b, { close: null })), '¼ Kelly on CLV');
      eq('¼ Kelly that places no bet: every plan figure and delta is a dash, never 0.0%', Z.deltas.map(d => [d.b, d.d, d.kind]), [['—', '—', 'lab'], ['—', '—', 'lab'], ['—', '—', 'lab'], ['—', '—', 'lab']]);
      ok('¼ Kelly that places no bet: no plan line, no gap area, gap and result text are dashes', Z.otherPath === '' && Z.area === '' && Z.gapTxt === 'plan ahead by up to —, behind by up to —' && Z.diffTxt.endsWith('Same results: — at the end, drawdown —.'));
      ok('a plan that stakes: real figures still print', M.stakingView(B5, 'Flat 1%').deltas.every(d => d.b !== '—') && M.stakingView(B5, 'Flat 1%').otherPath !== ''); }
    eq('staking view defaults to Compounding 1%', M.stakingView(B5, 'nonsense').other, 'Compounding 1%');
    { const Z = M.stakingView(B5.map(b => Object.assign({}, b, { fair: null })), '½ Kelly on model');
      ok('½ Kelly on model with no fair price (every imported bet): skips every bet, reads —', Z.diffTxt.includes('the plan —, skipping 5 of 5 bets') && Z.deltas.every(d => d.b === DASH) && Z.otherPath === ''); }
    eq('the chips show the shown plans only', M.stakingView(B5, 'Flat 1%').plans.map(p => p.name).includes('Confidence tiers'), false);
    eq('a posted bet carries fair: null (nothing writes it yet)', M.newBet({ type: 'Single', timing: 'pre', legs: [{ text: 'x', odds: '2' }], tour: 'Paris', level: '1000', surface: 'Hard', market: 'Match winner', marketOther: '', book: 'bet105', bookOther: '', stake: '1' }, 'b1', d5, 9).fair, null);
    eq('plan stake hint: Flat 2% · To win 1% at 1.50 · Double after a loss after a loss', [M.planStake('Flat 2%', B5, 2), M.planStake('To win 1%', B5, 1.5), M.planStake('Double after a loss', B5.slice(0, 4), 2)], [2, 2, 1]);
  }


  // ── 8 · period windows + filters (AND across groups, OR within, cross-adjusted counts) ──
  eq('Last 30 days from 27 Oct', M.fmtD(M.periodWindow('30d', {}, today).from), '27 Sep');
  eq('Last 90 days from 27 Oct', M.fmtD(M.periodWindow('90d', {}, today).from), '29 Jul');
  eq('Season from 1 Jan', M.fmtD(M.periodWindow('season', {}, today).from), '1 Jan');
  const cw = M.periodWindow('custom', { from: '2026-06-01', to: '2026-06-30' }, today);
  ok('Custom is inclusive of its last day', new Date(2026, 5, 30, 23, 0) <= cw.to && new Date(2026, 6, 1) > cw.to);
  const F = { level: ['ATP 500'], odds: [], surface: ['Clay', 'Grass'], market: [] };
  ok('filters: AND across groups, OR within', M.applyFilters(perList, F).every(b => M.LEVEL[b.level] === 'ATP 500' && ['Clay', 'Grass'].includes(b.surface)));
  eq('filter count is cross-adjusted (ignores its own group)', M.filterCount(perList, F, 'surface', 'Hard'), perList.filter(b => M.LEVEL[b.level] === 'ATP 500' && b.surface === 'Hard').length);

  // ── 9 · Log a bet: combined odds, validation, the "You post" sentence (README §3, verbatim) ──
  const legs = (...o) => o.map((x, i) => ({ text: 'Leg ' + i, odds: String(x) }));
  near('combined odds = product, 2 dp', M.combinedOdds(legs(1.3, 1.2)), 1.56); near('combined odds rounds to 2 dp (1.33 × 1.21 = 1.6093)', M.combinedOdds(legs(1.33, 1.21)), 1.61); near('3-leg parlay', M.combinedOdds(legs(1.5, 1.4, 1.3)), 2.73);
  ok('combined odds dash until every leg is valid', isNaN(M.combinedOdds([{ text: 'a', odds: '1.5' }, { text: '', odds: '1.2' }])));
  ok('a leg below 1.01 is invalid', !M.legsOk(legs(1.009)) && M.legsOk(legs(1.01)));
  const form = { type: 'Single', timing: 'pre', legs: [{ text: 'A. de Minaur to win', odds: '2.10' }], tour: 'Vienna', level: '500', surface: 'Indoor hard', market: 'Match winner', marketOther: '', book: 'bet105', bookOther: '', stake: '1' };
  eq('ready hint (v26)', M.formCheck(form).hint, 'Ready — the ticket on the right is what gets posted.');
  eq('Ticket (v26): selection · context · type · market · book · odds · stake · wins · loses', (t => [t.sel, t.ctx, t.type, t.market, t.book, t.odds, t.stake, t.win, t.lose])(M.ticket(form)),
    ['A. de Minaur to win', 'Vienna · ATP 500 · Indoor hard', 'Single · pre-match', 'Match winner', 'bet105', '2.10', '1.00% of bankroll', '+1.10%', '−1.00%']);
  eq('Ticket before input: placeholder + dashes', (t => [t.sel, t.hasSel, t.ctx, t.odds, t.stake, t.win, t.lose])(M.ticket(Object.assign({}, form, { legs: [{ text: '', odds: '' }], tour: '', stake: '' }))),
    ['Your selection', false, 'Tournament · ATP 500 · Indoor hard', '—', '—', '—', '—']);
  eq('invalid hint (v26)', M.formCheck(Object.assign({}, form, { stake: '11' })).hint, 'Every leg needs text and odds (1.01+) · stake 0.1 – 10% · a market and a bookmaker.');
  ok('stake 0.1 and 10 are valid, 0.09 and 10.01 are not', M.formCheck(Object.assign({}, form, { stake: '0.1' })).valid && M.formCheck(Object.assign({}, form, { stake: '10' })).valid && !M.formCheck(Object.assign({}, form, { stake: '0.09' })).valid && !M.formCheck(Object.assign({}, form, { stake: '10.01' })).valid);
  ok('Other market needs its typed name', !M.formCheck(Object.assign({}, form, { market: 'Other', marketOther: ' ' })).valid && M.formCheck(Object.assign({}, form, { market: 'Other', marketOther: 'Most aces' })).market === 'Most aces');
  eq('legs note · Single', M.legsNote(form), 'One selection, one price.');
  eq('legs note · Combination, empty', M.legsNote({ type: 'Combination', legs: [{ text: '', odds: '' }, { text: '', odds: '' }] }), 'Two legs, one ticket — the odds multiply (e.g. 1.30 × 1.20 = 1.56). All legs must win.');
  eq('legs note · Parlay', M.legsNote({ type: 'Parlay', legs: legs(1.5, 1.4, 1.3) }), 'Any number of legs, one ticket — the odds multiply: 1.50 × 1.40 × 1.30 = 2.73. All legs must win.');
  eq('fitLegs Single/Combination/Parlay', [M.fitLegs([], 'Single').length, M.fitLegs([], 'Combination').length, M.fitLegs(legs(1, 2, 3), 'Parlay').length, M.fitLegs([], 'Parlay').length], [1, 2, 3, 2]);
  const nb = M.newBet(Object.assign({}, form, { type: 'Parlay', legs: legs(1.5, 1.4, 1.3) }), 'b1', today, 7);
  eq('posted parlay', [nb.odds, nb.legs, nb.type, nb.res, nb.close, nb.pending, nb.text], [2.73, 3, 'Parlay', null, null, true, 'Leg 0 + Leg 1 + Leg 2']);
  eq('parlay ledger meta', M.betMeta(nb), 'Vienna · ATP 500 · Indoor hard · Parlay · 3 legs');
  eq('invalid form posts nothing', M.newBet(Object.assign({}, form, { stake: '' }), 'b1', today, 8), null);

  // ── 10 · empty bankroll (a new member) ──
  eq('empty cert', M.certText([]), 'Certified ledger · nothing settled yet');
  eq('empty ledger meta', M.ledgerMeta(0, 0), '0 of 0 bets in the period · pending first · settle a bet and every figure above recomputes');
  eq('empty bank card', (({ meta, roi, profit }) => ({ meta, roi, profit }))(M.bankCard([])), { meta: 'no bets yet', roi: DASH, profit: DASH });
  return fails;
}

const fails = run(load(SRC));
for (const f of fails) console.log('  FAIL ', f);
console.log(fails.length ? `bettracker-math: ${fails.length} failure(s)` : 'bettracker-math: all checks pass');

// ── mutants: every one must turn the suite red ──
const MUTANTS = [
  ['T9: label gap 69', 'CURVE_LABEL_GAP = 70,', 'CURVE_LABEL_GAP = 69,'],
  ['T9: never thin', "if ((c.x - lastX) * CURVE_PX < CURVE_LABEL_GAP) return;", "if (false) return;"],
  ['T9: no year on January', "MON[m] + (multiYear && m === 0 ? ' ' + b.date.getFullYear() : '')", "MON[m]"],
  ['T9: gap read in viewBox units', 'CURVE_PX = 1286 / 1292,', 'CURVE_PX = 1,'],
  ['T9: tick cap 9', 'CURVE_MAX_TICKS = 8,', 'CURVE_MAX_TICKS = 9,'],
  ['T9: no step-up past 10', 'if (curveTickCount(a, b, step) <= CURVE_MAX_TICKS) return step;', 'return step;'],
  ['F5: hover meta leading separator', ".filter(present).concat('@ ' + hb.odds.toFixed(2)).join(' · '),", ".filter(present).join(' · ') + ' · @ ' + hb.odds.toFixed(2),"],
  ['day W–L reads a void as a loss', "' · ' + v2.w + EN + v2.l :", "' · ' + v2.w + EN + (v2.n - v2.w) :"],
  ['tint: the 1.2 step inclusive', 'alpha: a < 1.2 ? 0.3 : a < 2.8 ? 0.55 : 0.9', 'alpha: a <= 1.2 ? 0.3 : a < 2.8 ? 0.55 : 0.9'],
  ['tint: the 2.8 step moved', 'alpha: a < 1.2 ? 0.3 : a < 2.8 ? 0.55 : 0.9', 'alpha: a < 1.2 ? 0.3 : a < 3 ? 0.55 : 0.9'],
  ['week net counts bets, not P/L', 'wpl += v2.pl; wn += v2.n;', 'wpl += v2.n; wn += v2.n;'],
  ['calendar keys by month only', 'var m = ym(b.date); (byM[m]', 'var m = b.date.getMonth(); (byM[m]'],
  ['F5: dash for a blank tournament', 'return [b.tour, LEVEL[b.level], b.surface].filter(present)', 'return [b.tour || DASH, LEVEL[b.level], b.surface].filter(Boolean)'],
  ['F5: month pop-up meta prints a dash', "meta: [b.tour, LEVEL[b.level], b.surface].filter(present).join(' · '),", "meta: [b.tour || DASH, LEVEL[b.level], b.surface].join(' · '),"],
  ['no-bet plan prints zeros', "var none = !oL.sts.some(function (x) { return x > 0; });", 'var none = false;'],
  ['To win cap 4', 'return Math.min(5, 1 / (b.odds - 1)); },', 'return Math.min(4, 1 / (b.odds - 1)); },'],
  ['Kelly cap 4', 'return Math.min(3, 25 * c / (b.odds - 1)); },', 'return Math.min(4, 25 * c / (b.odds - 1)); },'],
  ['Kelly skips nothing', "if (c === null || c <= 0) return 0;", "if (c === null) return 0;"],
  ['double never resets', "prev.res === 'lost' ? Math.min(8, prev.st * 2) : 1; },", "prev.res === 'lost' ? Math.min(8, prev.st * 2) : prev.st; },"],
  ['blind spot floor 4', 'if (g.s.n < m && g.s.n >= MIN_FLOOR && g.name', 'if (g.s.n < m && g.s.n >= 4 && g.name'],
  ['strength ROI floor 0', 'return g.s.profit > 0 && g.s.roi > 0.03;', 'return g.s.profit > 0 && g.s.roi > 0;'],
  ['coin flip from 50', "beatPct >= 48 ? 'COIN FLIP'", "beatPct >= 50 ? 'COIN FLIP'"],
  ['chasing from ×1.10', "ratio > 1.15 ? 'CHASING'", "ratio > 1.10 ? 'CHASING'"],
  ['stake consistency: ×1.5 is UNEVEN', "spread > 1.5 ? 'UNEVEN'", "spread >= 1.5 ? 'UNEVEN'"],
  ['stake consistency: WENT BIG from ×2.5', "spread > 2 ? 'WENT BIG'", "spread > 2.5 ? 'WENT BIG'"],
  ['½ Kelly: half becomes full', 'return fs <= 0 ? 0 : Math.min(3, 50 * fs);', 'return fs <= 0 ? 0 : Math.min(3, 100 * fs);'],
  ['Odds-banded: 2.20 in the long band', 'b.odds <= 2.20 ? 1 : 0.5', 'b.odds < 2.20 ? 1 : 0.5'],
  ['Confidence tiers shown', 'CONFIDENCE_TIERS = false', 'CONFIDENCE_TIERS = true'],
  ['price card: worst band first', 'best = bands[0], worst = bands[bands.length - 1]', 'best = bands[bands.length - 1], worst = bands[0]'],
  ['blank key counted', 'var k = key(b, dim); if (k === null) return;', 'var k = key(b, dim);'],
  ['ROI bar unclipped', 'var w = Math.min(Math.abs(roi), 0.4) / 0.4 * 50;', 'var w = Math.abs(roi) / 0.4 * 50;'],
  ['filter count ignores the other groups', "var n = filterCount(perList, F, d[0], o);", "var n = perList.filter(function (b) { return key(b, d[0]) === o; }).length;"],
  ['Avg CLV sub says 0 of 0', "S.clvN ? 'beat the close ' + S.beat + ' of ' + S.clvN : 'no closing prices'", "'beat the close ' + S.beat + ' of ' + S.clvN"],
  ['F2 off: a short positive side keeps no tick', 'if (mx > 0 && mx < step) mx = step;', ''],
  ['tile when: no run end date', 'when: monYear(S.bestEnd) },', "when: '' },"],
  ['void stake re-enters the ROI denominator', 'roi: stakedWL ? profit / stakedWL : null', 'roi: staked ? profit / staked : null'],
  ['minSample default 14', 'var MIN_SAMPLE = 15', 'var MIN_SAMPLE = 14'],
  ['eligibility n > minSample', 'if (g.s.n >= m && g.name', 'if (g.s.n > m && g.name'],
  ['combined odds not rounded', 'return a * o; }, 1).toFixed(2)', 'return a * o; }, 1).toFixed(3)'],
  ['closing line threshold 50', 'beatPct >= 55 ? \'REAL EDGE\'', 'beatPct >= 50 ? \'REAL EDGE\''],
  ['chasing threshold 1.25', 'ratio > 1.15 ? \'CHASING\'', 'ratio > 1.25 ? \'CHASING\''],
  ['Double after a loss uncapped', 'Math.min(8, prev.st * 2)', 'prev.st * 2'],
  ['ledger sort settled first', '(isSettled(b) ? 0 : 1) - (isSettled(a) ? 0 : 1)', '(isSettled(a) ? 0 : 1) - (isSettled(b) ? 0 : 1)'],
  ['empty ROI reads 0', 'roi: stakedWL ? profit / stakedWL : null', 'roi: stakedWL ? profit / stakedWL : 0'],
  ['stake max 15', 'stake <= 10 &&', 'stake <= 15 &&'],
  ['drawdown measured from 0', 'if (peak - cum > dd)', 'if (0 - cum > dd)']
];
let survived = 0;
for (const [name, from, to] of MUTANTS) {
  if (!SRC.includes(from)) { console.log('  FAIL  mutant anchor missing:', name); survived++; continue; }
  let red;
  try { red = run(load(SRC.replace(from, to))).length > 0; } catch (e) { red = true; }
  if (!red) { console.log('  FAIL  mutant survived:', name); survived++; }
}
console.log(`mutants: ${MUTANTS.length - survived} of ${MUTANTS.length} killed`);
process.exit(fails.length || survived ? 1 : 0);
