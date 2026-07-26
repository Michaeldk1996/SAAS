'use strict';
const path=require('path');
const HM=__dirname;
const { h2h, setDominance, winnerUE }=require(path.join(HM,'adjustments'));
const cfg=require(path.join(HM,'config'));
const MAG=cfg.adjustments.h2h.maxMagnitude; // 0.025
const NOW='2026-07-25';
// helper: build a ctx with meetings
function ctx(surface, meetings){ return { surface, match:{ date:NOW, h2h:{ matches:meetings } } }; }
function meet(yearsAgo, surface, p1Won, result){
  const d=new Date(Date.parse(NOW)-yearsAgo*365.25*864e5).toISOString().slice(0,10);
  return { date:d, surface, p1Won, result };
}
let pass=0, fail=0;
function ok(name, cond, got){ if(cond){pass++; console.log('  ✓',name);} else {fail++; console.log('  ✗',name,'| got:',got);} }
const near=(a,b,e=1e-6)=>Math.abs(a-b)<=e;

console.log('=== setDominance ===');
ok('2-0 straight=1.0', setDominance('2 - 0',cfg.adjustments.h2h.dominance)===1.0);
ok('3-0 straight=1.0', setDominance('3 - 0',cfg.adjustments.h2h.dominance)===1.0);
ok('2-1 competitive=0.6', setDominance('2 - 1',cfg.adjustments.h2h.dominance)===0.6);
ok('3-2 competitive=0.6', setDominance('3 - 2',cfg.adjustments.h2h.dominance)===0.6);
ok('unparseable=0.7', setDominance('W/O',cfg.adjustments.h2h.dominance)===0.7);
// Bo5 win-in-four: 3-1 is its own tier at 0.8, strictly between straight & deciding.
const _D=cfg.adjustments.h2h.dominance;
const _straight=setDominance('3 - 0',_D), _oneDrop=setDominance('3 - 1',_D), _decide=setDominance('3 - 2',_D);
ok('3-1 win-in-four=0.8', _oneDrop===0.8, _oneDrop);
ok('3-1 sits between straight(1.0) and deciding(0.6)', _straight>_oneDrop && _oneDrop>_decide, `${_straight} > ${_oneDrop} > ${_decide}`);

console.log('=== hide + balanced ===');
ok('0 meetings => hidden', h2h(ctx('Clay',[])).hidden===true);
const bal=h2h(ctx('Clay',[meet(1,'Clay',true,'2 - 0'),meet(1,'Clay',false,'2 - 0')]));
ok('balanced 1-1 straight => applied & signal 0', bal.applied===true && near(bal.signal,0), bal.signal);

console.log('=== Tier 1: 8 same-surface recent straight-set sweeps => full magnitude ===');
const t1meet=Array.from({length:8},()=>meet(1,'Clay',true,'2 - 0'));
const t1=h2h(ctx('Clay',t1meet));
ok('tier1 detail', /tier 1/.test(t1.detail), t1.detail);
ok('tier1 signal=1.0 (dominAvg1 * t1mult1)', near(t1.signal,1.0), t1.signal);
ok('tier1 deltaP1=+2.5pp (full mag)', near(t1.deltaP1,MAG), t1.deltaP1);
ok('tier1 conf=high', t1.confidence==='high');

console.log('=== Tier 1 dominance: straight vs deciding sweeps ===');
const t1dec=h2h(ctx('Clay',Array.from({length:8},()=>meet(1,'Clay',true,'2 - 1'))));
ok('all-deciding wins signal=0.6', near(t1dec.signal,0.6), t1dec.signal);
ok('deciding deltaP1=0.6*2.5=1.5pp', near(t1dec.deltaP1,0.6*MAG), t1dec.deltaP1);

console.log('=== Tier 1 dominance: 3-1 win-in-four sits between straight & deciding ===');
const t1odWin=h2h(ctx('Clay',Array.from({length:8},()=>meet(1,'Clay',true,'3 - 1'))));
ok('all 3-1 wins signal=0.8', near(t1odWin.signal,0.8), t1odWin.signal);
ok('3-1 deltaP1=0.8*2.5=2.0pp', near(t1odWin.deltaP1,0.8*MAG), t1odWin.deltaP1);
ok('3-1 signal between straight(1.0) & deciding(0.6)', t1.signal>t1odWin.signal && t1odWin.signal>t1dec.signal, `${t1.signal}>${t1odWin.signal}>${t1dec.signal}`);

console.log('=== Loss dominance ordering: 0-3 stronger negative than 1-3 than 2-3 ===');
const lStraight=h2h(ctx('Clay',Array.from({length:8},()=>meet(1,'Clay',false,'3 - 0')))).signal; // -1.0
const lOneDrop =h2h(ctx('Clay',Array.from({length:8},()=>meet(1,'Clay',false,'3 - 1')))).signal; // -0.8
const lDecide  =h2h(ctx('Clay',Array.from({length:8},()=>meet(1,'Clay',false,'3 - 2')))).signal; // -0.6
ok('1-3 loss=-0.8', near(lOneDrop,-0.8), lOneDrop);
ok('0-3 < 1-3 < 2-3 (more negative = stronger)', lStraight<lOneDrop && lOneDrop<lDecide, `${lStraight} < ${lOneDrop} < ${lDecide}`);

console.log('=== Tier 2: 4 same-surface recent straight wins (N_eff=4) => 45% mag ===');
const t2=h2h(ctx('Clay',Array.from({length:4},()=>meet(1,'Clay',true,'2 - 0'))));
ok('tier2 detail', /tier 2/.test(t2.detail), t2.detail);
ok('tier2 signal=0.45', near(t2.signal,0.45), t2.signal);
ok('tier2 deltaP1=0.45*2.5=1.125pp (round4)', near(t2.deltaP1,0.45*MAG,1e-4), t2.deltaP1);

console.log('=== Surface filter: 8 DIFFERENT-surface recent straight wins => N_eff=8*0.25=2 => Tier 3 ===');
const sf=h2h(ctx('Clay',Array.from({length:8},()=>meet(1,'Hard',true,'2 - 0'))));
ok('diff-surface drops to tier 3 (N_eff=2)', /tier 3/.test(sf.detail), sf.detail);

console.log('=== Recency filter: 8 same-surface OLD(>4y) straight wins => N_eff=8*0.2=1.6 => Tier 3 ===');
const rf=h2h(ctx('Clay',Array.from({length:8},()=>meet(6,'Clay',true,'2 - 0'))));
ok('old meetings drop to tier 3 (N_eff=1.6)', /tier 3/.test(rf.detail), rf.detail);

console.log('=== Loss sign: straight-set losses => negative signal toward p2 ===');
const loss=h2h(ctx('Clay',Array.from({length:8},()=>meet(1,'Clay',false,'2 - 0'))));
ok('straight losses signal=-1.0 dir p2', near(loss.signal,-1.0) && loss.direction==='p2', loss.signal+'/'+loss.direction);

// ---- Layer #8: archetype-relative W/UE (winnerUE) ------------------------
// Baseline (mcp-archetype-baseline.json): counter_puncher wuRatio 0.822,
// big_server 1.131. Signal = clamp((r1/base1 - r2/base2) / 0.30, -1, 1).
console.log('=== winnerUE (layer #8) ===');
const WMAG=cfg.adjustments.winnerUE.maxMagnitude; // 0.02
function wctx(p1,p2){ return { p1, p2 }; }
function player(primary, wue){ return { style: primary?{ primary }:null, profile: wue?{ wue }:null }; }
function wue(ratio, source='api-tennis', matches=5){ return { winnersRate:0.18, unforcedRate:ratio?0.18/ratio:0.18, ratio, matches, source }; }

// Self-hide: either player missing wue => un-applied, NOT gated (display filter drops it).
const noData=winnerUE(wctx(player('big_server',null), player('counter_puncher',wue(1.0))));
ok('missing wue => applied:false', noData.applied===false, noData.applied);
ok('missing wue => NOT gated (self-hide, not dimmed row)', noData.gated===false, noData.gated);
const bothMissing=winnerUE(wctx(player('big_server',null), player('counter_puncher',null)));
ok('both missing => applied:false', bothMissing.applied===false, bothMissing.applied);

// Same archetype, p1 has the higher raw ratio => signal toward p1.
const p1Better=winnerUE(wctx(player('solid_baseliner',wue(1.10)), player('solid_baseliner',wue(0.90))));
ok('same archetype, higher ratio => dir p1', p1Better.applied===true && p1Better.direction==='p1', p1Better.direction);
ok('signal magnitude within [-1,1]', p1Better.signal>0 && p1Better.signal<=1, p1Better.signal);
ok('deltaP1 = signal*0.02', near(p1Better.deltaP1, p1Better.signal*WMAG, 1e-4), p1Better.deltaP1);

// Archetype normalisation: a counter-puncher at ratio 1.0 (norm 0.822) is
// OVER-performing its style more than a big-server at 1.0 (norm 1.131), so the
// counter-puncher should read as the aggressive one relative to expectation.
const cp=winnerUE(wctx(player('counter_puncher',wue(1.0)), player('big_server',wue(1.0))));
ok('equal raw ratio but CP over-performs its archetype => dir p1', cp.direction==='p1', cp.direction+' sig '+cp.signal);
// Sanity: flip the archetypes, sign flips.
const cpFlip=winnerUE(wctx(player('big_server',wue(1.0)), player('counter_puncher',wue(1.0))));
ok('archetype swap flips the sign', near(cpFlip.signal,-cp.signal,1e-6), `${cp.signal} vs ${cpFlip.signal}`);

// Symmetric equal-relative players => signal 0 => self-hidden (applied:false).
const even=winnerUE(wctx(player('counter_puncher',wue(0.822)), player('big_server',wue(1.131))));
ok('both exactly at archetype norm => signal 0 => applied:false', even.applied===false && near(even.signal,0), even.signal);

// Unknown style falls back to tour ratio, still fires (no crash).
const noStyle=winnerUE(wctx(player(null,wue(1.2)), player(null,wue(0.8))));
ok('unknown archetype => tour-ratio fallback, still applies dir p1', noStyle.applied===true && noStyle.direction==='p1', noStyle.direction);

// Source note surfaces in detail (mixed sources shown honestly).
const mixed=winnerUE(wctx(player('big_server',wue(1.2,'api-tennis')), player('big_server',wue(0.9,'ATP_Entry_OCR'))));
ok('mixed sources noted in detail', /api-tennis\/ATP_Entry_OCR/.test(mixed.detail), mixed.detail);

// =========================================================================
// #9 in-tournament serve tier (TEN-29)
// =========================================================================
console.log('=== in-tournament serve tier (#9 top tier) ===');
const { inTournamentServeDelta, serveSharedRow } = require(path.join(HM,'adjustments'));
const SITC = cfg.adjustments.serve.inTournament;

// serveSharedRow sums the 3 observed serve components; null if any missing.
ok('serveSharedRow sums 3 comps', serveSharedRow({firstInPct:60,firstWonPct:72,secondWonPct:52})===184);
ok('serveSharedRow null when a comp missing', serveSharedRow({firstInPct:60,firstWonPct:72})===null);

// Synthetic splits: season blend of the 3 shared comps = last52*0.6 + career*0.4.
// last52 clay shared = 60+72+52=184, career clay shared = 55+70+50=175 => blend 180.4.
const splits = { last52:{ Clay:{firstInPct:60,firstWonPct:72,secondWonPct:52} },
                 career:{ Clay:{firstInPct:55,firstWonPct:70,secondWonPct:50} } };
// progression: player served BETTER this event (shared avg 60+80+60=200 over 1 round).
function progCtx(rounds){ return { match:{ tour:'ATP Estoril' },
  progression:{ tournaments:{ Estoril:{ players:[{ playerKey:'358', rounds }] } } } }; }
const pObj = { numericKey:'358' };
const hotRounds=[{round:'R1',metrics:{firstServePct:60,firstServeWonPct:80,secondServeWonPct:60}}];
const hot = inTournamentServeDelta(progCtx(hotRounds), pObj, splits, 'Clay', 'Best of 3');
ok('fires with a completed round', hot!==null && hot.n===1, hot);
ok('this-event avg = 200', hot && hot.itShared===200, hot && hot.itShared);
ok('season blend = 180.4', hot && Math.abs(hot.seasonShared-180.4)<1e-6, hot && hot.seasonShared);
ok('nudge = weight*(200-180.4)', hot && near(hot.nudge, SITC.weight*(200-180.4)), hot && hot.nudge);
ok('positive nudge when serving hot', hot && hot.nudge>0, hot && hot.nudge);

// Self-hide at R1 / off-progression: no rounds, no tournament, unknown player.
ok('self-hide when no completed rounds (R1)', inTournamentServeDelta(progCtx([]), pObj, splits, 'Clay','Best of 3')===null);
ok('self-hide off-progression tournament',
   inTournamentServeDelta({match:{tour:'ATP Washington'},progression:{tournaments:{Estoril:{players:[]}}}}, pObj, splits,'Clay','Best of 3')===null);
ok('self-hide when player absent from event',
   inTournamentServeDelta(progCtx(hotRounds), {numericKey:'999'}, splits,'Clay','Best of 3')===null);
ok('self-hide with no season baseline', inTournamentServeDelta(progCtx(hotRounds), pObj, {}, 'Clay','Best of 3')===null);

// Bound: an absurd hot round is capped at maxDeltaPP.
const insane=[{round:'R1',metrics:{firstServePct:100,firstServeWonPct:100,secondServeWonPct:100}}];
const capped=inTournamentServeDelta(progCtx(insane), pObj, splits,'Clay','Best of 3');
ok('nudge capped at maxDeltaPP', capped && Math.abs(capped.nudge)<=SITC.maxDeltaPP+1e-9, capped && capped.nudge);

// Cold event => negative nudge (favours the opponent).
const coldRounds=[{round:'R1',metrics:{firstServePct:40,firstServeWonPct:50,secondServeWonPct:40}}];
const cold=inTournamentServeDelta(progCtx(coldRounds), pObj, splits,'Clay','Best of 3');
ok('negative nudge when serving cold', cold && cold.nudge<0, cold && cold.nudge);

// Multi-round average.
const twoR=[{round:'R1',metrics:{firstServePct:60,firstServeWonPct:80,secondServeWonPct:60}},
            {round:'R2',metrics:{firstServePct:60,firstServeWonPct:60,secondServeWonPct:40}}];
const avg=inTournamentServeDelta(progCtx(twoR), pObj, splits,'Clay','Best of 3');
ok('averages across completed rounds (n=2, avg 180)', avg && avg.n===2 && avg.itShared===180, avg);

// =========================================================================
// #10 in-tournament RETURN tier (return analog of the serve tier)
// =========================================================================
console.log('=== in-tournament return tier (#10 top tier — 4 components) ===');
const { inTournamentReturnDelta, returnSharedRow } = require(path.join(HM,'adjustments'));
const RITC = cfg.adjustments.returnPressure.inTournament;

// returnSharedRow is the legacy single-component reader (still exported).
ok('returnSharedRow reads rpwPct', returnSharedRow({rpwPct:35})===35);
ok('returnSharedRow null when rpwPct missing', returnSharedRow({brkPct:20})===null);

// Synthetic 4-component return splits (Clay). Each season baseline blends
// last52*0.6 + career*0.4:
//   ret1  30*0.6+20*0.4 = 26   ret2 50*0.6+40*0.4 = 46
//   break 25*0.6+15*0.4 = 21   bpConv 40*0.6+30*0.4 = 36
const rsplits = {
  last52:{ Clay:{ ret1WonPct:30, ret2WonPct:50, brkPct:25, bpConvPct:40 } },
  career:{ Clay:{ ret1WonPct:20, ret2WonPct:40, brkPct:15, bpConvPct:30 } },
};
const rObj = { numericKey:'358' };
function retCtx(rounds){ return { match:{ tour:'ATP Estoril' },
  progression:{ tournaments:{ Estoril:{ players:[{ name:'Me', playerKey:'358', rounds }] } } } }; }

// All four components carry adequate denominators and event rates above baseline
// => every component fires, sign positive. (Raw deltas are large enough that the
// per-component + total clamps bind, so nudge saturates at maxDeltaPP.)
const allHot = [{ round:'R1', metrics:{
  ret1:{won:15,total:30},    // 50.0% (> 26), total 30 >= 20
  ret2:{won:12,total:20},    // 60.0% (> 46), total 20 >= 15
  retGames:{won:5,total:10}, // 50.0% (> 21), total 10 >= 8   (break%)
  bpConv:{won:6,total:10},   // 60.0% (> 36), total 10 >= 5
} }];
const rhot = inTournamentReturnDelta(retCtx(allHot), rObj, rsplits, 'Clay', 'Best of 3');
ok('fires with a completed round', rhot!==null && rhot.n===1, rhot);
ok('all 4 components fire', rhot && rhot.components===4 && rhot.used.length===4, rhot && rhot.used);
ok('break% fires from retGames raw', rhot && rhot.used.includes('break'), rhot && rhot.used);
// Rate provenance surfaced for admin: every return component is a native feed
// rate, so all fired components land in nativeUsed and derivedUsed stays empty
// (the explicit serve/return contrast — serve carries derived ace%/df%).
ok('all return components are native', rhot && rhot.nativeUsed.length===4 && rhot.derivedUsed.length===0, rhot && {n:rhot.nativeUsed,d:rhot.derivedUsed});
ok('no derived rates flagged in return detail', rhot && !/†/.test(rhot.detail), rhot && rhot.detail);
ok('nudge finite & positive when returning hot', rhot && Number.isFinite(rhot.nudge) && rhot.nudge>0, rhot && rhot.nudge);
ok('nudge within maxDeltaPP', rhot && Math.abs(rhot.nudge)<=RITC.maxDeltaPP+1e-9, rhot && rhot.nudge);
ok('round4 numeric sanity', rhot && rhot.nudge===Math.round(rhot.nudge*1e4)/1e4, rhot && rhot.nudge);

// ZERO FABRICATION: a round giving bpConv only 1/1 (< min-sample 5) drops that
// component — no NaN/Infinity — while the three well-sampled components still fire.
const bpThin = [{ round:'R1', metrics:{
  ret1:{won:15,total:30}, ret2:{won:12,total:20}, retGames:{won:5,total:10}, bpConv:{won:1,total:1} } }];
const rbp = inTournamentReturnDelta(retCtx(bpThin), rObj, rsplits,'Clay','Best of 3');
ok('bpConv self-hides below min-sample (no fabrication, no NaN)',
   rbp && rbp.components===3 && !rbp.used.includes('bpConv') && Number.isFinite(rbp.nudge), rbp);

// Denominators SUM across rounds: two rounds of bpConv 3/3 aggregate to 6 (>= 5)
// and fire, though either round alone (3) is below the floor.
const bpTwo = [ { round:'R1', metrics:{ bpConv:{won:3,total:3} } },
                { round:'R2', metrics:{ bpConv:{won:3,total:3} } } ];
const rbptwo = inTournamentReturnDelta(retCtx(bpTwo), rObj, rsplits,'Clay','Best of 3');
ok('sums denominators across rounds (bpConv 3+3 >= 5 fires, n=2)',
   rbptwo && rbptwo.n===2 && rbptwo.components===1 && rbptwo.used[0]==='bpConv', rbptwo);
// ...but a SINGLE sub-floor bpConv round self-hides entirely (its only component).
ok('single sub-min bpConv round self-hides entirely',
   inTournamentReturnDelta(retCtx([{round:'R1',metrics:{bpConv:{won:3,total:3}}}]), rObj, rsplits,'Clay','Best of 3')===null);

// OVER-CAP guard: perfect event on all four => each componentNudge saturates at
// perComponentCap (1.25), their sum (5) clamps to maxDeltaPP (4).
const rInsane = [{ round:'R1', metrics:{
  ret1:{won:30,total:30}, ret2:{won:20,total:20}, retGames:{won:10,total:10}, bpConv:{won:10,total:10} } }];
const rins = inTournamentReturnDelta(retCtx(rInsane), rObj, rsplits,'Clay','Best of 3');
ok('total nudge clamped to maxDeltaPP', rins && near(rins.nudge, RITC.maxDeltaPP) && Math.abs(rins.nudge)<=RITC.maxDeltaPP+1e-9, rins && rins.nudge);

// Per-component cap binds INDEPENDENTLY: only bpConv clears its floor (others 1/1),
// its raw delta (0.2*(100-36)=12.8) is clamped to perComponentCap, so the whole
// nudge = perComponentCap (well under maxDeltaPP).
const oneBig = [{ round:'R1', metrics:{
  ret1:{won:1,total:1}, ret2:{won:1,total:1}, retGames:{won:1,total:1}, bpConv:{won:10,total:10} } }];
const rone = inTournamentReturnDelta(retCtx(oneBig), rObj, rsplits,'Clay','Best of 3');
ok('per-component cap binds (single-comp nudge = perComponentCap)',
   rone && rone.components===1 && rone.used[0]==='bpConv' && near(rone.nudge, RITC.perComponentCap), rone && rone.nudge);

// Cold event on all four => negative nudge (favours the opponent).
const allCold = [{ round:'R1', metrics:{
  ret1:{won:3,total:30},    // 10.0% (< 26)
  ret2:{won:4,total:20},    // 20.0% (< 46)
  retGames:{won:1,total:10},// 10.0% (< 21)
  bpConv:{won:1,total:10},  // 10.0% (< 36)
} }];
const rcold = inTournamentReturnDelta(retCtx(allCold), rObj, rsplits,'Clay','Best of 3');
ok('negative nudge when returning cold', rcold && rcold.nudge<0, rcold && rcold.nudge);

// Self-hide branches.
ok('self-hide when no completed rounds (R1)',
   inTournamentReturnDelta(retCtx([]), rObj, rsplits,'Clay','Best of 3')===null);
ok('self-hide when rounds carry no return counts',
   inTournamentReturnDelta(retCtx([{round:'R1',metrics:{firstServePct:60}}]), rObj, rsplits,'Clay','Best of 3')===null);
ok('self-hide off-progression tournament',
   inTournamentReturnDelta({match:{tour:'ATP Washington'},progression:{tournaments:{Estoril:{players:[{name:'Me',playerKey:'358',rounds:allHot}]}}}}, rObj, rsplits,'Clay','Best of 3')===null);
ok('self-hide when player absent from event',
   inTournamentReturnDelta(retCtx(allHot), {numericKey:'999'}, rsplits,'Clay','Best of 3')===null);
ok('self-hide when splits missing all baselines',
   inTournamentReturnDelta(retCtx(allHot), rObj, {}, 'Clay','Best of 3')===null);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
