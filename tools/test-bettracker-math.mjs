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
