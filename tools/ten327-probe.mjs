// TEN-327 probe — drives the REAL dashboard in headless Chrome and checks the one-formula ratings on
// every display surface against an independent recompute (the arithmetic re-done here from the raw
// counts, not by calling house-ratings.js). Usage:
//   node tools/ten327-probe.mjs [baseUrl]      default: the deployed site
// Only the Firebase auth gate is stubbed (window.BSP); every script and data file loads from baseUrl.
// Local pre-land runs: TEN327_TP=<file> answers the page's tournament-progression.json fetch with that
// file (the committed copy is stale and carries no box-score components, which would make the
// Tournament Report check vacuous).
// Probe only: writes nothing; nothing regenerates it.
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = (process.argv[2] || 'https://michaeldk1996.github.io/SAAS/').replace(/\/?$/, '/');
const FIX = JSON.parse(fs.readFileSync(new URL('./fixtures/ten327-boxscores.json', import.meta.url), 'utf8')).matches;
const ch = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=0', '--no-first-run',
  '--disable-gpu', '--window-size=1500,1100', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'ten327-')), 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
const port = await new Promise((res, rej) => { let b = ''; const t = setTimeout(() => rej(new Error('no port')), 20000);
  ch.stderr.on('data', (d) => { b += d; const m = /ws:\/\/127\.0\.0\.1:(\d+)\//.exec(b); if (m) { clearTimeout(t); res(+m[1]); } }); });
const tg = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
const ws = new WebSocket(tg.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const w = new Map(); const errors = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data);
  if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0] || m.params.exceptionDetails.text); });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; w.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'threw'); return r.result?.result?.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window,'BSP',{value:(function(){var u={emailVerified:true};return {currentUser:()=>u,onAuthChange:f=>{f(u);return()=>{}},ready:Promise.resolve(u),whenAuthReady:()=>Promise.resolve(u),requireAuth:()=>Promise.resolve(u),requireVerified:()=>Promise.resolve(u),isValidEmail:()=>true,updateProfile:()=>Promise.resolve(),NOTIF:{}};})(),writable:false,configurable:false});` });
if (process.env.TEN327_TP) {
  const tp = fs.readFileSync(process.env.TEN327_TP, 'utf8');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){var TP=${JSON.stringify(tp)};var f=window.fetch;window.fetch=function(u,o){if(/tournament-progression\.json/.test(String(u&&u.url||u)))return Promise.resolve(new Response(TP,{status:200,headers:{'content-type':'application/json'}}));return f.apply(this,arguments);};})();` });
}
await send('Page.navigate', { url: BASE + 'bsp-consult-dashboard.html' }); await new Promise((r) => setTimeout(r, 6000));

let pass = 0, fail = 0, skip = 0;
const check = async (n, f) => { try { const d = await f();
  if (/^SKIPPED/.test(d || '')) { console.log(`  SKIP  ${n}  — ${d}`); skip++; } else { console.log(`  ok    ${n}${d ? '  — ' + d : ''}`); pass++; } }
  catch (e) { console.log(`  FAIL  ${n}\n        ${e.message}`); fail++; } };
const must = (c, m) => { if (!c) throw new Error(m); };
// independent recompute of the house formulas from raw counts
const pc = (fr) => (fr && fr.total > 0 ? fr.won / fr.total * 100 : null);
function indep(side) {
  const r = side.raw || {}, f = r['Service:1st serve points won'], s = r['Service:2nd serve points won'];
  const sv = [f && s ? f.total / (f.total + s.total) * 100 : null, pc(f), pc(s), pc(r['Games:Service games won']), side['Service:Aces'], side['Service:Double Faults']];
  const rt = [pc(r['Return:1st return points won']), pc(r['Return:2nd return points won']), pc(r['Games:Return games won']), pc(r['Return:Break Points Converted'])];
  return { serve: sv.some((x) => x == null) ? null : sv[0] + sv[1] + sv[2] + sv[3] + sv[4] - sv[5], ret: rt.some((x) => x == null) ? null : rt.reduce((a, b) => a + b, 0) };
}
const bi = await ev(`fetch('build-info.json').then(r=>r.ok?r.json():null).catch(()=>null)`);
console.log(`\nTEN-327 probe — ${BASE}${bi ? ` · build ${String(bi.commit).slice(0, 8)} run ${bi.runNumber} ${bi.builtAt}` : ' (no build-info)'}\n`);

await check('the page loads the one helper (house-ratings.js)', async () => {
  must(await ev(`typeof window.HouseRatings==='object' && typeof HouseRatings.fromBoxSide==='function'`), 'window.HouseRatings missing');
  const code = await ev(`fetch('house-ratings.js').then(r=>r.status)`); must(code === 200, `house-ratings.js HTTP ${code}`);
  return 'HTTP 200';
});
for (const [ek, f] of Object.entries(FIX)) {
  const mine = String(f.p1Key) === String(f.subjectKey) ? 'p1' : 'p2', own = f.match[mine], opp = f.match[mine === 'p1' ? 'p2' : 'p1'];
  const want = indep(own);
  await check(`${f.subject}: Match stats sheet (fhSheetModel) = independent ${Math.round(want.serve)} / ${Math.round(want.ret)}`, async () => {
    const v = await ev(`(function(){var M=fhSheetModel({own:${JSON.stringify(own)},opp:${JSON.stringify(opp)}});return [M.sections[0].rows[0].a.txt,M.sections[1].rows[0].a.txt];})()`);
    must(v[0] === String(Math.round(want.serve)) && v[1] === String(Math.round(want.ret)), `sheet shows ${v.join(' / ')}`);
    return v.join(' / ');
  });
  await check(`${f.subject}: Player Profile sheet row = ${Math.round(want.serve)} / ${Math.round(want.ret)} (was a dash)`, async () => {
    const v = await ev(`(function(){var I=window.PlayerProfileV2&&PlayerProfileV2._internals; if(!I) return null;
      var rows=[].concat.apply([],I.SHEET_SECTIONS.map(function(s){return s.rows;}));
      var o=${JSON.stringify(own)}, p=${JSON.stringify(opp)};
      return [I.sheetValue(rows.find(function(r){return r.label==='Serve rating';}),o,p), I.sheetValue(rows.find(function(r){return r.label==='Return rating';}),o,p)];})()`);
    must(v, 'PlayerProfileV2._internals missing');
    must(Math.abs(v[0] - want.serve) < 1e-6 && Math.abs(v[1] - want.ret) < 1e-6, `profile ${v.join(' / ')}`);
    return `${v[0].toFixed(1)} / ${v[1].toFixed(1)}`;
  });
  await check(`${f.subject}: Live tab (LiveFeed) = ${Math.round(want.serve)} / ${Math.round(want.ret)}`, async () => {
    const v = await ev(`(function(){var lf=window.LiveFeed; if(!lf||!lf.indexStats) return 'nolive';
      var rows=[]; [[${f.subjectKey},${JSON.stringify(own)}],[1,${JSON.stringify(opp)}]].forEach(function(pr){ var o=pr[1];
        Object.keys(o).forEach(function(k){ if(k==='raw') return; var nm=k.split(':')[1], rw=(o.raw||{})[k];
          rows.push({player_key:pr[0],stat_period:'match',stat_name:nm,stat_value:/aces|double|winners|unforced/i.test(nm)?String(o[k]):o[k]+'%',stat_won:rw?rw.won:null,stat_total:rw?rw.total:null}); }); });
      var idx=lf.indexStats({statistics:rows}).idx; return [lf.serveRating(idx,${f.subjectKey},'match').rating, lf.returnRating(idx,${f.subjectKey},'match').rating];})()`);
    if (v === 'nolive') return 'SKIPPED — LiveFeed not initialised on this origin (needs the Supabase creds the deploy injects)';
    must(Math.abs(v[0] - want.serve) < 1e-6 && Math.abs(v[1] - want.ret) < 1e-6, `live ${v.join(' / ')}`);
    return `${v[0].toFixed(1)} / ${v[1].toFixed(1)}`;
  });
}
await check('Tournament Report: every served player-round = independent 6-part / 4-part, unrounded', async () => {
  const r = await ev(`fetch('tournament-progression.json').then(r=>r.json()).then(function(tp){
    var out=[]; Object.keys(tp.tournaments||{}).forEach(function(tn){ (tp.tournaments[tn].players||[]).forEach(function(p){ (p.rounds||[]).forEach(function(rd){
      if(!rd.metrics) return; var d=tourxDerivedMetrics(rd.metrics,null); out.push({t:tn,p:p.name,r:rd.round,m:rd.metrics,sv:d.serveRating,rt:d.returnRating}); }); }); }); return out; })`);
  let n = 0, nS = 0, nR = 0; const bad = [];
  for (const x of r) {
    const m = x.m, p = (fr) => (fr && fr.total > 0 ? fr.won / fr.total * 100 : null);
    const sv = [m.firstServePct, m.firstServeWonPct, m.secondServeWonPct, p(m.svHold), m.aces, m.dfs];
    const rt = [p(m.ret1), p(m.ret2), p(m.retGames), p(m.bpConv)];
    const eS = sv.some((v) => v == null) ? null : sv[0] + sv[1] + sv[2] + sv[3] + sv[4] - sv[5];
    const eR = rt.some((v) => v == null) ? null : rt.reduce((a, b) => a + b, 0);
    n++; if (eS != null) nS++; if (eR != null) nR++;
    const same = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 1e-9);
    if (!same(x.sv, eS) || !same(x.rt, eR)) bad.push(`${x.t} ${x.p} ${x.r}: page ${x.sv}/${x.rt} vs ${eS}/${eR}`);
  }
  must(nS > 0 && nR > 0, `${n} player-rounds served but ${nS} serve / ${nR} return rated — vacuous`);
  must(!bad.length, `${bad.length} differ: ${bad.slice(0, 3).join(' | ')}`);
  return `${n} player-rounds (${nS} serve, ${nR} return rated), 0 differ`;
});
await check('Tournament Report renders: no NaN on the report page', async () => {
  const tn = await ev(`fetch('tournament-progression.json').then(r=>r.json()).then(j=>Object.keys(j.tournaments||{})[0]||null)`);
  must(tn, 'no tournament served');
  await ev(`(function(){var b=document.querySelector('[data-tab="tournaments"]'); if(b) b.click(); return true;})()`); await new Promise((r) => setTimeout(r, 1500));
  await ev(`(function(){tourxOpenReport(${JSON.stringify(tn)});return true;})()`); await new Promise((r) => setTimeout(r, 2500));
  const t = await ev(`document.body.innerText`);
  must(/Serve Rating/.test(t), 'no "Serve Rating" on the report page');
  must(!/NaN/.test(t), 'NaN on the page');
  return tn;
});
await check('Database Return board: RGW% = return GAMES won (breakPct)', async () => {
  const html = await ev(`fetch('bsp-consult-dashboard.html').then(r=>r.text())`);
  must(/\{h:'RGW%', full:'% return games won', k:'return\.breakPct'/.test(html), 'the served page still maps RGW% to return points won');
  return 'served column def reads return.breakPct';
});
await check('no uncaught page exception mentions the rating code', async () => {
  const hit = errors.filter((e) => /HouseRatings|serveRating|returnRating|fhSheetModel|tourxDerived|sheetValue/.test(e));
  must(!hit.length, hit.join(' | '));
  return `${errors.length} uncaught exception(s) on the page in total, none from the rating code`;
});
console.log(`\n${pass} pass, ${fail} fail, ${skip} skipped`); ch.kill(); process.exit(fail ? 1 : 0);
