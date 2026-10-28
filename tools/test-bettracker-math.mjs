#!/usr/bin/env node
// Bet Tracker T1 — every README §Formulas function in bettracker-math.js, the three discipline checks, the six staking
// plans, segment eligibility (minSample = 15) and the heat alpha.
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
  eq('Insights badge (discipline judged/bad)', M.discipline(list, 15).badge, READ.insBadge);
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
  const tiltB = (n, res) => Array.from({ length: n }, (_, i) => ({ id: i, date: d, odds: 2, close: null, stake: 1, res: typeof res === 'function' ? res(i) : res, tilt: true }));
  eq('third bet after two losses n=14 → EARLY · n=14', M.discipline(tiltB(14, 'lost'), 15).checks[2].verdict, 'EARLY · n=14');
  eq('n=15 all lost → TILT', M.discipline(tiltB(15, 'lost'), 15).checks[2].verdict, 'TILT');
  eq('n=15 all won → UNDER CONTROL', M.discipline(tiltB(15, 'won'), 15).checks[2].verdict, 'UNDER CONTROL');
  eq('no bets → nothing judged, no badge (never a fabricated verdict)', [M.discipline([], 15).judged, M.discipline([], 15).badge], [0, '']);

  // ── 6 · the six staking plans ──
  eq('six plans in the reference order', M.PLANS.map(p => p.name), ['Flat 1%', 'Flat 2%', 'Compounding 1%', 'To win 1%', '¼ Kelly on CLV', 'Double after a loss']);
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
  const HT = M.heroTiles(S), HC = M.heroCurve(list, today);
  eq('hero tile labels', HT.rows.map(r => r.label), ['ROI', 'Record', 'Win rate', 'Avg CLV', 'Max drawdown', 'Best run', 'Worst run']);
  eq('hero tile values', HT.rows.map(r => r.value), [READ.roi, READ.record, READ.winRate, READ.avgClv, READ.maxDrawdown, READ.bestRun, READ.worstRun]);
  eq('hero tile subs', HT.rows.map(r => r.sub), ['profit ÷ total staked', READ.recordSub, 'won ÷ (won + lost)', READ.beat, 'peak to trough, % of bankroll', 'consecutive wins', 'consecutive losses']);
  eq('hero profit + sub', [HT.profit, HT.profitSub], [READ.profit, READ.profitSub]);
  eq('curve meta (model)', HC.meta, READ.curveMeta);
  eq('curve drawdown note (model)', HC.ddNote, READ.ddNote);
  eq('curve: 170 points + the origin, M first', [HC.path.split(/[ML]/).length - 1, HC.path[0]], [171, 'M']);
  ok('curve: the zero tick is solid and present', HC.yTicks.some(t => t.zero));
  eq('curve: y step 5 on a ~30% span, labels signed', HC.yTicks.map(t => t.label), ['−10%', '−5%', '0%', '+5%', '+10%', '+15%']);
  eq('curve: one x label per month of the season', HC.xTicks.map(t => t.label), ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']);
  eq('curve: nothing settled → no line, meta dashes', [M.heroCurve([], today).path, M.heroCurve([], today).meta], ['', '0 bets · peak — · now —']);
  eq('Avg CLV tile with no closes: — over "no closing prices"', M.heroTiles(M.stats(V)).rows[3], { label: 'Avg CLV', sub: 'no closing prices', value: DASH, kind: 'lab' });
  const longYears = []; for (let y = 2022; y <= 2025; y++) for (let m = 0; m < 12; m++) longYears.push({ id: y * 100 + m, date: new Date(y, m, 5), odds: 2, stake: 1, res: 'won' });
  eq('curve: a multi-season ledger labels one tick a year', M.heroCurve(longYears, today).xTicks.map(t => t.label), ['2022', '2023', '2024', '2025']);
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

  // ── 10 · T3 calendar: heat grid, months table, month pop-up (READ off the reference's Results view) ──
  const HG = M.heatGrid(main, today);
  eq('heat meta (READ)', HG.meta, '103 betting days this season · 57 finished up · 46 down or flat');
  eq('heat: 26 weeks × 7 days', HG.cells.length, 182);
  eq('heat: first column = the Monday 25 weeks before this week (27 Oct → 26 Oct → 4 May)', [HG.cells[0].key, HG.cells[0].d], ['2026-05-04', 0]);
  eq('heat: the last column is this week, today is cell 25 × 7 + 1', [HG.cells[25 * 7 + 1].key, HG.cells[25 * 7].key, HG.cells[181].key], ['2026-10-27', '2026-10-26', '2026-11-01']);
  eq('heat: month labels at week × 32px', HG.months.map(m => m.label + '@' + m.left), ['May@0px', 'Jun@128px', 'Jul@288px', 'Aug@416px', 'Sep@576px', 'Oct@704px']);
  eq('heat: today holds only pending bets → blue "·"', [HG.cells[176].tone, HG.cells[176].fig], ['pend', '·']);
  eq('heat: days after today are future (transparent)', HG.cells.slice(177).map(c => c.tone), ['future', 'future', 'future', 'future', 'future']);
  const dayBets = main.filter(b => M.dayKey(b.date) === '2026-10-26'), dpl = dayBets.reduce((x, b) => x + M.pl(b), 0);
  eq('heat: a settled day = its P/L in € (×100), alpha = heatAlpha', [HG.cells[175].fig, HG.cells[175].alpha], [(Math.round(dpl * 100) > 0 ? '+' : '−') + Math.abs(Math.round(dpl * 100)), +M.heatAlpha(dpl).toFixed(2)]);
  eq('heat: the pop-up flips side after week 14', [HG.cells[14 * 7].flip, HG.cells[15 * 7].flip], [false, true]);
  const MT = M.monthsTable(main, today);
  eq('months table (READ: name · settled n · P/L)', MT.map(m => [m.name, m.n, m.pl]), [['October 2026', 16, '+3.6%'], ['September 2026', 36, '+9.9%'], ['August 2026', 32, '+3.0%'], ['July 2026', 23, '+6.4%'], ['June 2026', 30, '+1.7%'], ['May 2026', 27, '−3.9%'], ['April 2026', 6, '−4.4%']]);
  eq('ROI bar: +20% fills half its side, −60% clips at 50%', [M.roiBar(0.2), M.roiBar(-0.6)], [{ left: '50%', width: '25%', kind: 'pos' }, { left: '0%', width: '50%', kind: 'neg' }]);
  eq('ROI bar: no ROI, no bar', M.roiBar(null).width, '0%');
  const MP = M.monthPop(MT[0].key, MT[0].bets, today);
  eq('month pop-up title + tile labels', [MP.title, MP.stats.map(x => x.l)], ['October 2026', ['P/L', 'ROI', 'Win rate', 'Avg CLV']]);
  ok('month pop-up sub "16 settled bets · W–L · x% staked"', /^16 settled bets · \d+–\d+ · \d+\.\d% staked$/.test(MP.sub));
  eq('month pop-up: rows newest first, every one settled', [MP.rows.length, MP.rows[0].date], [16, '26 Oct']);
  eq('heat: last year\'s days are not this season', M.heatGrid([{ id: 1, date: new Date(2025, 11, 30), odds: 2, stake: 1, res: 'won' }], new Date(2026, 0, 5)).meta, '0 betting days this season · 0 finished up · 0 down or flat');

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
  // 3 · third bet after two losses: n < 15 EARLY · ROI < −5% TILT · else UNDER CONTROL
  const tiltB = (n, won) => mkb(n, i => ({ tilt: true, odds: 2, res: i < won ? 'won' : 'lost' })).concat(base);
  eq('tilt 15 bets ROI −6.7% → TILT · ROI 0% → UNDER CONTROL · 14 bets → EARLY · n=14', [M.discipline(tiltB(15, 7), 15).checks[2].verdict, M.discipline(tiltB(16, 8), 15).checks[2].verdict, M.discipline(tiltB(14, 0), 15).checks[2].verdict], ['TILT', 'UNDER CONTROL', 'EARLY · n=14']);
  eq('no data is never judged: closing line —, stake ratio —', [M.discipline([], 15).checks[0].verdict, M.discipline([], 15).checks[1].verdict, M.discipline([], 15).judged], [DASH, DASH, 0]);
  const dv = M.disciplineView(mkb(3, { close: null }), 15, 'Season');
  eq('discipline view with no closes: "0 of 0 priced bets beat the close · target 55%+", sum grey', [dv.checks[0].short, dv.sumKind], ['0 of 0 priced bets beat the close · target 55%+', 'lab']);
  eq('breakdown: a bet with no value for the cut is in no row (counted in left)', [M.breakdown(mkb(4, i => ({ level: i < 1 ? '' : '500' })), 'level').rows.map(r => [r.name, r.n]), M.breakdown(mkb(4, i => ({ level: i < 1 ? '' : '500' })), 'level').left], [[['ATP 500', 3]], 1]);
  }

  // ── 12 · T5 staking: every plan on a hand-computed 5-bet case (won 2.00 · lost 1.50 · won 1.15 · lost 3.00 no close · void 2.50) ──
  {
    const d5 = new Date(2026, 6, 1);
    const B5 = [{ id: 1, date: d5, odds: 2.00, stake: 1, res: 'won', close: 1.90 }, { id: 2, date: d5, odds: 1.50, stake: 2, res: 'lost', close: 1.60 },
      { id: 3, date: d5, odds: 1.15, stake: 1, res: 'won', close: 1.10 }, { id: 4, date: d5, odds: 3.00, stake: 0.5, res: 'lost', close: null }, { id: 5, date: d5, odds: 2.50, stake: 1, res: 'void', close: 2.40 }];
    const hand = {
      'Your stakes': { sts: [1, 2, 1, 0.5, 1], end: 1 - 2 + 0.15 - 0.5 },
      'Flat 1%': { sts: [1, 1, 1, 1, 1], end: 1 - 1 + 0.15 - 1, dd: 1.85 },
      'Flat 2%': { sts: [2, 2, 2, 2, 2], end: 2 - 2 + 0.3 - 2, dd: 3.7 },
      'Compounding 1%': { sts: [1, 1.01, 0.9999, 1.00139985, 0.9913858515], end: 1 - 1.01 + 0.9999 * 0.15 - 1.00139985 },
      'To win 1%': { sts: [1, 2, 5, 0.5, 1 / 1.5], end: 1 - 2 + 5 * 0.15 - 0.5 },   // 1 ÷ 0.15 = 6.67 → the 5% cap
      '¼ Kelly on CLV': { sts: [25 * (2 / 1.9 - 1), 0, 3, 0, 25 * (2.5 / 2.4 - 1) / 1.5], end: 25 * (2 / 1.9 - 1) + 3 * 0.15 },   // no close / CLV ≤ 0 → 0; 7.58 → the 3% cap
      'Double after a loss': { sts: [1, 1, 2, 1, 2], end: 1 - 1 + 2 * 0.15 - 1 }
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
    eq('plan stake hint: Flat 2% · To win 1% at 1.50 · Double after a loss after a loss', [M.planStake('Flat 2%', B5, 2), M.planStake('To win 1%', B5, 1.5), M.planStake('Double after a loss', B5.slice(0, 4), 2)], [2, 2, 1]);
  }

  // ── 7 · heat alpha ──
  near('heat alpha at 0', M.heatAlpha(0), 0.3); near('heat alpha at 1.5%', M.heatAlpha(-1.5), 0.65); near('heat alpha saturates at 3%', M.heatAlpha(3), 1); near('… and stays 1', M.heatAlpha(7), 1);

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
  eq('You post sentence', M.formCheck(form).hint, 'You post: single · A. de Minaur to win · Match winner @ 2.10 · bet105 · 1% of bankroll · pre-match · wins → +1.10% · loses → −1.00%. It lands as pending; settle it in the ledger, then lock it.');
  eq('invalid hint', M.formCheck(Object.assign({}, form, { stake: '11' })).hint, 'Every leg needs its text and odds (1.01 or more); a stake between 0.1 and 10%, a market and a bookmaker are required — type your own when the lists do not have them. Type and Pre-match / Live are stored with the bet.');
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
  ['no-bet plan prints zeros', "var none = !oL.sts.some(function (x) { return x > 0; });", 'var none = false;'],
  ['To win cap 4', 'return Math.min(5, 1 / (b.odds - 1)); },', 'return Math.min(4, 1 / (b.odds - 1)); },'],
  ['Kelly cap 4', 'return Math.min(3, 25 * c / (b.odds - 1)); },', 'return Math.min(4, 25 * c / (b.odds - 1)); },'],
  ['Kelly skips nothing', "if (c === null || c <= 0) return 0;", "if (c === null) return 0;"],
  ['double never resets', "prev.res === 'lost' ? Math.min(8, prev.st * 2) : 1; },", "prev.res === 'lost' ? Math.min(8, prev.st * 2) : prev.st; },"],
  ['blind spot floor 4', 'if (g.s.n < m && g.s.n >= MIN_FLOOR && g.name', 'if (g.s.n < m && g.s.n >= 4 && g.name'],
  ['strength ROI floor 0', 'return g.s.profit > 0 && g.s.roi > 0.03;', 'return g.s.profit > 0 && g.s.roi > 0;'],
  ['coin flip from 50', "beatPct >= 48 ? 'COIN FLIP'", "beatPct >= 50 ? 'COIN FLIP'"],
  ['chasing from ×1.10', "ratio > 1.15 ? 'CHASING'", "ratio > 1.10 ? 'CHASING'"],
  ['tilt from −10%', "st.roi < -0.05 ? 'TILT'", "st.roi < -0.10 ? 'TILT'"],
  ['blank key counted', 'var k = key(b, dim); if (k === null) return;', 'var k = key(b, dim);'],
  ['heat grid starts this week', 'start = addDays(mon, -25 * 7)', 'start = addDays(mon, -26 * 7)'],
  ['heat counts every year', 'return +k.slice(0, 4) === y;', 'return true;'],
  ['ROI bar unclipped', 'var w = Math.min(Math.abs(roi), 0.4) / 0.4 * 50;', 'var w = Math.abs(roi) / 0.4 * 50;'],
  ['filter count ignores the other groups', "var n = filterCount(perList, F, d[0], o);", "var n = perList.filter(function (b) { return key(b, d[0]) === o; }).length;"],
  ['Avg CLV sub says 0 of 0', "S.clvN ? 'beat the close ' + S.beat + ' of ' + S.clvN : 'no closing prices'", "'beat the close ' + S.beat + ' of ' + S.clvN"],
  ['curve labels every month on a long ledger', 'var byYear = Object.keys(months).length > 14,', 'var byYear = false,'],
  ['void stake re-enters the ROI denominator', 'roi: stakedWL ? profit / stakedWL : null', 'roi: staked ? profit / staked : null'],
  ['minSample default 14', 'var MIN_SAMPLE = 15', 'var MIN_SAMPLE = 14'],
  ['eligibility n > minSample', 'if (g.s.n >= m && g.name', 'if (g.s.n > m && g.name'],
  ['heat alpha base 0.25', '0.3 + Math.abs(plPct) / 3 * 0.7', '0.25 + Math.abs(plPct) / 3 * 0.7'],
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
