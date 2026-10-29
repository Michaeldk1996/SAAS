/* bettracker-seed.js — DEV ONLY. `?seed=20261027` on the dashboard loads this file, and the Bet Tracker page then runs on
 * the LOCKED prototype's own demo ledger (design_handoff_bet_tracker/Bet Tracker Page.dc.html, `bets()` + `static R`,
 * copied verbatim below) in an in-memory store, with "today" pinned to the prototype's 27 Oct 2026 — so the build can
 * be screenshotted beside the reference on the same bets. Never persisted (memory storage only), never loaded without
 * the query parameter, never in the navigation.
 */
(function (root) {
  'use strict';
  function R0(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function protoBets(seed) {
    const R=R0(seed);
    const N=s=>{ const u=Math.max(R(),1e-9),v=R(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)*s; };
    const pick=a=>a[Math.floor(R()*a.length)];
    const T={4:[['Monte-Carlo','1000','Clay'],['Barcelona','500','Clay'],['Munich','500','Clay'],['Madrid','1000','Clay']],5:[['Madrid','1000','Clay'],['Rome','1000','Clay'],['Geneva','250','Clay'],['Roland Garros','Slam','Clay']],6:[['Roland Garros','Slam','Clay'],['Stuttgart','250','Grass'],['Halle','500','Grass'],["Queen's",'500','Grass'],['Wimbledon','Slam','Grass']],7:[['Wimbledon','Slam','Grass'],['Hamburg','500','Clay'],['Gstaad','250','Clay'],['Washington','500','Hard'],['Umag','250','Clay']],8:[['Toronto','1000','Hard'],['Cincinnati','1000','Hard'],['Winston-Salem','250','Hard'],['US Open','Slam','Hard']],9:[['US Open','Slam','Hard'],['Davis Cup','Cup','Indoor hard'],['Chengdu','250','Hard'],['Tokyo','500','Hard'],['Beijing','500','Hard']],10:[['Shanghai','1000','Hard'],['Almaty','250','Indoor hard'],['Stockholm','250','Indoor hard'],['Vienna','500','Indoor hard'],['Basel','500','Indoor hard'],['Brussels','250','Indoor hard']]};
    const CH=[['Challenger Barletta','Chall','Clay'],['Challenger Heilbronn','Chall','Clay'],['Challenger Ilkley','Chall','Grass'],['Challenger Lexington','Chall','Hard'],['Challenger Cassis','Chall','Hard'],['Challenger Brest','Chall','Hard']];
    const P=['J. Sinner','C. Alcaraz','A. Zverev','T. Fritz','N. Djokovic','J. Draper','A. de Minaur','L. Musetti','H. Rune','D. Medvedev','C. Ruud','A. Rublev','F. Auger-Aliassime','B. Shelton','T. Paul','F. Cerundolo','A. Bublik','J. Mensik','A. Fils','T. Machac','K. Khachanov','D. Shapovalov','J. Lehecka','U. Humbert','F. Tiafoe','G. Dimitrov','S. Tsitsipas','A. Popyrin','M. Berrettini','L. Tien','J. Fonseca','A. Davidovich Fokina'];
    const out=[]; let id=1;
    for(let d=new Date(2026,3,13); d<=new Date(2026,9,26); d.setDate(d.getDate()+1)){
      const r=R(); const cnt=r<.40?0:r<.70?1:r<.88?2:r<.96?3:4; let lossRun=0;
      for(let i=0;i<cnt;i++){
        const m=d.getMonth()+1; const t=R()<.14?pick(CH):pick(T[m]||T[10]);
        let a=pick(P),b=pick(P); while(b===a) b=pick(P);
        const mr=R(); const market=mr<.56?'Match winner':mr<.78?'Games handicap':'Total games';
        const br=R(); const book=br<.55?'bet105':br<.85?'Pinnacle':'bet365';
        const p = market==='Match winner'? .30+R()*.50 : .44+R()*.12;
        const fair=1/p; const odds=+(fair*(1+N(.035)+.065)).toFixed(2);
        const tilt = i>=2 && lossRun>=2;
        let e=0; if(t[2]==='Clay') e-=.06; if(odds>=2.6) e-=.08; if(market==='Total games') e+=.06; if(t[1]==='Chall') e-=.06; if(t[1]==='Slam') e+=.03; if(book==='bet105') e+=.02; if(book==='bet365') e-=.03; if(tilt) e-=.08;
        const pT=Math.min(.95,Math.max(.05,p*(1+e)));
        const close=+((1/pT)*(1+N(.03))).toFixed(2); const fairM=+((1/pT)*(1+N(.04))).toFixed(2);
        let stake = odds<1.8?1.5:1; if(tilt) stake*=2;
        const won=R()<pT; lossRun = won?0:lossRun+1;
        const sel=R()<.5?a:b, opp=sel===a?b:a; let line=null,text;
        if(market==='Match winner') text=sel+' to win';
        else if(market==='Games handicap'){ line=(p>.5?'−':'+')+(1+Math.floor(R()*4))+'.5'; text=sel+' '+line+' games'; }
        else { line=(R()<.5?'Over ':'Under ')+(20+Math.floor(R()*5))+'.5'; text=line+' games · '+sel+' v '+opp; }
        out.push({id:id++, date:new Date(d), tour:t[0], level:t[1], surface:t[2], market, book, odds, close, fair:fairM, stake, res:won?'won':'lost', tilt, text, line, pending:false, bank:t[1]==='Chall'?'chall':'main', timing:R()<.2?'live':'pre'});
      }
    }
    const today=new Date(2026,9,27);
    out.push({id:id++, date:today, tour:'Vienna', level:'500', surface:'Indoor hard', market:'Match winner', book:'bet105', odds:2.10, close:null, stake:1, res:null, tilt:false, text:'A. de Minaur to win', line:null, pending:true, bank:'main', timing:'pre'});
    out.push({id:id++, date:today, tour:'Basel', level:'500', surface:'Indoor hard', market:'Total games', book:'Pinnacle', odds:1.87, close:null, stake:1.5, res:null, tilt:false, text:'Over 22.5 games · B. Shelton v H. Rune', line:'Over 22.5', pending:true, bank:'main', timing:'live'});
    return out;
  }
  function dk(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  // The store document the page reads: two bankrolls as the prototype names them; settled demo bets locked (the
  // prototype's isLocked: settled and not posted this session), the two pending bets open.
  function doc(seed, V) {
    var bets = protoBets(seed).map(function (b) {
      return { id: b.id, date: dk(b.date), tour: b.tour, level: b.level, surface: b.surface, market: b.market, line: b.line, book: b.book,
        odds: b.odds, close: b.close, fair: b.fair == null ? null : b.fair, stake: b.stake, res: b.res, tilt: b.tilt, text: b.text, timing: b.timing,
        type: 'Single', legs: 1, bank: b.bank, pending: !b.res, createdAt: dk(b.date) + 'T12:00:00.000Z', lockedAt: b.res ? '2026-10-27T12:00:00.000Z' : null };
    });
    return { v: V, banks: [{ id: 'main', name: 'Tennis 2026', createdAt: '2026-04-13T00:00:00.000Z' }, { id: 'chall', name: 'Challenger lab', createdAt: '2026-04-13T00:00:00.000Z' }], bets: bets };
  }
  var api = { TODAY: [2026, 9, 27], protoBets: protoBets, doc: doc };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.BetTrackerSeed = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
