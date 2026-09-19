#!/usr/bin/env node
// TEN-243 — verify the three board-ruled spec overrides on the real rendered page.
// Gate `2ebfa608` (2026-09-19): `season-axis`, `hardgate`, `no-force-zero`.
//
// Serves THIS worktree over http (the page needs relative fetches for
// database-yield*.json) and drives it with headless Chrome over raw CDP.
//
// Two traps this probe is written against, both of which make a WORKING build look
// broken (see memory: cdp-probe-readiness-and-port-squat):
//   - wait on the SYMBOL under test, not on a painted node;
//   - a stale http.server squatting the port 404s everything, so bind explicitly and
//     fail loudly if the bind did not take.
// And one that makes a BROKEN build look fine: every browser-driven block must assert
// it actually ran, and a swallowed error is a failure, not a skip.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const PORT = 8243, CDP = 9243;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let PASS = 0; const FAILS = [];
const ok = (cond, name, detail) => {
  if (cond) { PASS++; console.log(`  ok   ${name}${detail ? ' — ' + detail : ''}`); }
  else { FAILS.push(name); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- auth stub (disposable; restored in finally) ---------------------------
const AUTH = path.join(ROOT, 'auth.js');
const AUTH_BAK = AUTH + '.ten243bak';
function stubAuth() {
  fs.copyFileSync(AUTH, AUTH_BAK);
  fs.writeFileSync(AUTH, `
（function(g){ var U={emailVerified:true,email:'probe@local',uid:'probe'};
  g.BSP={ currentUser:function(){return U;}, onAuthChange:function(cb){cb(U);return function(){};},
    ready:Promise.resolve(U), whenAuthReady:function(){return Promise.resolve(U);},
    requireAuth:function(){return Promise.resolve(U);}, requireVerified:function(){return Promise.resolve(U);} };
})(window);`.replace('（', '('));
}
function restoreAuth() { if (fs.existsSync(AUTH_BAK)) { fs.copyFileSync(AUTH_BAK, AUTH); fs.unlinkSync(AUTH_BAK); } }

// ---- minimal CDP client ----------------------------------------------------
let ws, msgId = 0, pending = new Map(), sessionId = null;
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  });
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval threw');
  return r.result?.value;
}

async function main() {
  // 1. serve
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(ROOT, u === '/' ? 'bsp-consult-dashboard.html' : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    const ext = path.extname(f);
    res.writeHead(200, { 'content-type': ext === '.json' ? 'application/json' : ext === '.js' ? 'text/javascript' : ext === '.html' ? 'text/html' : 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r, j) => { srv.once('error', j); srv.listen(PORT, '127.0.0.1', r); });
  console.log(`served ${ROOT} on :${PORT}`);

  // 2. chrome
  const prof = fs.mkdtempSync('/tmp/ten243-prof-');
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP}`, '--headless=new', '--disable-gpu', '--no-first-run',
    `--user-data-dir=${prof}`, '--window-size=1600,1200', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try {
      const list = await new Promise((res, rej) => {
        http.get(`http://127.0.0.1:${CDP}/json/list`, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(JSON.parse(b))); }).on('error', rej);
      });
      target = list.find(t => t.type === 'page');
    } catch { /* not up yet */ }
  }
  if (!target) throw new Error('chrome never exposed a page target');

  // Node's built-in WebSocket (stable since 22) — no `ws` dependency in this repo.
  if (typeof WebSocket !== 'function') throw new Error('no global WebSocket; node >= 22 required');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  ws.addEventListener('message', e => {
    const m = JSON.parse(typeof e.data === 'string' ? e.data : String(e.data));
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  });
  await send('Runtime.enable'); await send('Page.enable');

  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/bsp-consult-dashboard.html` });

  // 3. wait on the SYMBOL, not on a node
  let ready = false;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    try { if (await ev('typeof window.DatabaseTab === "object" && !!document.getElementById("databaseTabBtn")')) { ready = true; break; } } catch { }
  }
  ok(ready, 'page + DatabaseTab global loaded');
  if (!ready) return;

  // 4. open the Database tab through the real nav button
  await ev(`document.getElementById('databaseTabBtn').click()`);
  let drew = false;
  for (let i = 0; i < 60; i++) {
    await sleep(400);
    if (await ev(`!!document.querySelector('.db-xcap') && !!document.querySelector('.db-plotarea svg polyline')`)) { drew = true; break; }
  }
  ok(drew, 'Tour tab rendered a curve card');
  if (!drew) return;

  // ================= A · season-axis =================
  console.log('\nA · season-axis (gate 2ebfa608)');
  const cap = await ev(`document.querySelector('.db-xcap').textContent.trim()`);
  ok(/^season$/i.test(cap), 'x caption is "Season"', JSON.stringify(cap));
  ok(!/match index/i.test(cap), 'x caption no longer says "Match index"');

  const aria = await ev(`document.querySelector('.db-plotarea svg').getAttribute('aria-label')`);
  ok(/by season/i.test(aria) && !/match index/i.test(aria), 'svg aria-label names the season axis', aria);

  const ticks = await ev(`JSON.stringify([...document.querySelectorAll('.db-xaxis > div')].map(d=>({t:d.textContent.trim(),l:parseFloat(d.style.left)})))`).then(JSON.parse);
  ok(ticks.length >= 3, 'x axis has >= 3 season ticks', `${ticks.length} ticks`);
  ok(ticks.every(t => /^\d{4}$/.test(t.t)), 'every tick label is a 4-digit season');
  ok(ticks.every((t, i, a) => i === 0 || a[i - 1].l < t.l), 'ticks ascend left to right');
  ok(Math.abs(ticks[0].l) < 0.01, 'first season tick sits at x=0 (domain anchored on 1 Jan)', `left=${ticks[0].l}%`);

  // A season axis must be LINEAR IN TIME: equal year gaps => equal pixel gaps. This is
  // the assertion an index axis cannot pass, so it is the one that proves the change.
  const gaps = [];
  for (let i = 1; i < ticks.length; i++) gaps.push({ years: +ticks[i].t - +ticks[i - 1].t, px: ticks[i].l - ticks[i - 1].l });
  const perYear = gaps.map(g => g.px / g.years);
  const spread = Math.max(...perYear) - Math.min(...perYear);
  ok(spread < 0.05, 'tick spacing is linear in time (equal years => equal width)', `max-min %/yr = ${spread.toFixed(4)}`);

  // ================= B · the sampler is not starved =================
  console.log('\nB · index-bucketed sampler (the half that made a calendar axis unreadable)');
  // Drive to a single one-week-a-year event — the exact subject that exposed the
  // starvation (Australian Open, 42 of 2,130 vertices painted on the old calendar axis).
  const picked = await ev(`(function(){
    var t=[...document.querySelectorAll('.db-seg button')].find(function(b){ return /^Tournaments$/.test((b.textContent||'').trim()); });
    if(!t) return 'no-tab'; t.click(); return 'clicked';
  })()`);
  ok(picked === 'clicked', 'Tournaments tab reachable', picked);
  await sleep(600);
  // ⚠️ The page carries FIVE inputs and THREE of them say "Search tournaments" —
  // two belong to other features and are display:none. Scope to .db-search AND
  // require offsetParent, or the probe types into a hidden box and reports no results
  // on a working picker.
  const chose = await ev(`(function(){
    var inp=[...document.querySelectorAll('.db-search input')].find(function(x){ return x.offsetParent!==null; });
    if(!inp) return 'no-input';
    var set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    set.call(inp,'Australian Open');
    inp.dispatchEvent(new Event('input',{bubbles:true}));
    return 'typed';
  })()`);
  await sleep(600);
  // .db-prow binds onmousedown, NOT onclick — .click() is silently inert.
  const opened = await ev(`(function(){
    var r=[...document.querySelectorAll('.db-prow')].find(function(x){ return /Australian Open/i.test(x.textContent); });
    if(!r) return 'no-row';
    r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
    return 'picked';
  })()`);
  ok(chose === 'typed' && opened === 'picked', 'Australian Open selected', `${chose}/${opened}`);
  await sleep(900);

  const paint = await ev(`(function(){
    var pl=document.querySelector('.db-plotarea svg polyline');
    if(!pl) return null;
    var pts=pl.getAttribute('points').trim().split(' ').map(function(p){ return parseFloat(p.split(',')[0]); });
    var cols={}, maxGap=0;
    for(var i=0;i<pts.length;i++){ cols[Math.round(pts[i])]=1; if(i) maxGap=Math.max(maxGap, pts[i]-pts[i-1]); }
    return { vertices: pts.length, columns: Object.keys(cols).length, maxGap: maxGap };
  })()`);
  ok(paint && paint.vertices > 0, 'AO curve painted', JSON.stringify(paint));
  // The old calendar axis painted 42 vertices for this exact curve. The budget is 240.
  ok(paint.vertices >= 200, 'sampler spends its vertex budget on a one-week-a-year event', `${paint.vertices} vertices (old calendar axis: 42, budget 240)`);
  // The largest gap on a calendar axis is NOT a starvation symptom — it is the real
  // 11 months between one edition and the next, and removing it would be a lie about
  // time. What must hold is that no gap EXCEEDS one season's width: a bigger one would
  // mean the sampler dropped an edition. One season = 1000/spanYears viewBox units.
  const seasonW = 1000 / ((+ticks[ticks.length - 1].t - +ticks[0].t) || 1) * ((ticks[1].t - ticks[0].t) ? 1 : 1);
  const yearsSpanned = (+ticks[ticks.length - 1].t - +ticks[0].t) + 1;
  const oneSeason = 1000 / yearsSpanned;
  ok(paint.maxGap <= oneSeason * 1.35, 'no gap exceeds one season — every edition survived the sampler',
    `max gap ${paint.maxGap.toFixed(1)} vs one season ${oneSeason.toFixed(1)} of 1000`);

  // ================= C · hardgate / softgate =================
  console.log('\nC · hardgate + softgate (C8 overturned)');
  await ev(`[...document.querySelectorAll('.db-seg button')].find(function(b){return /^Tour$/.test((b.textContent||'').trim());}).click()`);
  await sleep(700);
  // SUBJECT CHOSEN FROM THE DATA, NOT FROM HOPE. Counted off database-yield.json
  // before writing this: Surface=Grass + Round=The Final gives 111 rows => terciles of
  // 37 (SOFT, 30<=n<100) with an All row of 111 (FULL) — one view that exercises two
  // of the three states at once and can tell them apart.
  // (The obvious subject, Level=Finals, does NOT exist: Finals is folded out of every
  // Level picker by the TEN-196 round-3 ruling. A probe that picks it reports
  // "no-option" and looks like a broken menu.)
  async function pickMulti(trigRe, optRe) {
    const opened = await ev(`(function(){
      var t=[...document.querySelectorAll('.db-trig')].find(function(b){ return ${trigRe}.test(b.textContent); });
      if(!t) return 'no-trigger'; t.click(); return 'open';
    })()`);
    await sleep(450);
    const hit = await ev(`(function(){
      var o=[...document.querySelectorAll('.db-mrow')].find(function(x){ return ${optRe}.test(x.textContent.trim()); });
      if(!o) return 'no-option'; o.click(); return 'picked';
    })()`);
    await sleep(700);
    return `${opened}/${hit}`;
  }
  const gRes = await pickMulti('/surface/i', '/^Grass$/');
  ok(gRes === 'open/picked', 'Surface = Grass applied', gRes);
  const fRes = await pickMulti('/round/i', '/^The Final$/');
  ok(fRes === 'open/picked', 'Round = The Final applied', fRes);

  const soft = await ev(`(function(){
    var out=[];
    document.querySelectorAll('.db-yieldcell').forEach(function(c){
      out.push({ cls:c.className, txt:c.textContent.trim(), w:getComputedStyle(c).fontWeight, size:getComputedStyle(c).fontSize });
    });
    return JSON.stringify(out);
  })()`).then(JSON.parse);
  const softCells = soft.filter(c => /\bsoft\b/.test(c.cls));
  const hardCells = soft.filter(c => /\bhard\b/.test(c.cls));
  const fullCells = soft.filter(c => !/\bsoft\b|\bhard\b/.test(c.cls));
  ok(soft.length > 0, 'yield cells rendered at Grass x The Final', `${soft.length} cells`);
  ok(softCells.length > 0, 'soft-gated cells exist (band n=37)', `${softCells.length} soft, ${hardCells.length} hard, ${fullCells.length} full`);
  ok(fullCells.length > 0, 'full cells coexist in the same table (All row n=111)', `${fullCells.length} full`);
  if (softCells.length) {
    ok(softCells.every(c => c.txt.includes('%')), 'a soft-gated cell still prints its yield');
    ok(softCells.every(c => c.w === '500'), 'soft-gated cells are weight 500', softCells[0].w);
    ok(softCells.every(c => c.size === '14px'), 'soft-gated cells keep 14px', softCells[0].size);
    ok(fullCells.every(c => c.w === '700'), 'full cells stay weight 700 — the states are distinguishable', fullCells[0].w);
  }

  // Narrow to ONE season => n collapses to a handful => HARD gate.
  const yset = await ev(`(function(){
    var sels=[...document.querySelectorAll('.db-yrend select')];
    if(sels.length<2) return 'no-selects';
    var set=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set;
    set.call(sels[0],'2015'); sels[0].dispatchEvent(new Event('change',{bubbles:true}));
    return 'set';
  })()`);
  await sleep(500);
  await ev(`(function(){
    var sels=[...document.querySelectorAll('.db-yrend select')];
    var set=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set;
    set.call(sels[1],'2015'); sels[1].dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await sleep(900);
  ok(yset === 'set', 'year range narrowed to a single season');

  const gated = await ev(`(function(){
    var out=[];
    document.querySelectorAll('.db-yieldcell').forEach(function(c){
      out.push({ cls:c.className, txt:c.textContent.trim(), size:getComputedStyle(c).fontSize, w:getComputedStyle(c).fontWeight });
    });
    return JSON.stringify(out);
  })()`).then(JSON.parse);
  const hard2 = gated.filter(c => /\bhard\b/.test(c.cls));
  // Grass + The Final + 2015 alone = 6 rows => terciles of 2, All of 6: every cell
  // is under the hard gate. Counted off database-yield.json, not guessed.
  ok(hard2.length === gated.length && gated.length > 0, 'EVERY cell is hard-gated at Grass x The Final x 2015', `${hard2.length} of ${gated.length}`);
  if (hard2.length) {
    ok(hard2.every(c => /^n=[\d,]+ — too few matches for a yield$/.test(c.txt)), 'hard-gated cell prints the count sentence', JSON.stringify(hard2[0].txt));
    ok(hard2.every(c => !c.txt.includes('%')), 'hard-gated cell prints NO yield at all — C8 is overturned');
    ok(hard2.every(c => c.size === '11px'), 'hard-gated cell is 11px', hard2[0].size);
  }
  // The failing control: the OLD behaviour would have left a percentage plus a
  // ".db-thin" flag. Both must now be absent on the band tables.
  const thinLeft = await ev(`document.querySelectorAll('.db-bandpanel .db-thin').length`);
  ok(thinLeft === 0, 'no band cell still carries the old thin-flag markup', `${thinLeft} found`);

  // ================= D · no-force-zero =================
  console.log('\nD · no-force-zero (e8453243 overturned)');
  const src = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
  ok(/var PLAYER_ZERO_IN_DOMAIN=false;/.test(src), 'PLAYER_ZERO_IN_DOMAIN is false in source');

  // Reading the flag is not evidence. Drive a real player whose curve never crosses
  // zero and assert ON THE PAINTED DOM that the break-even line is gone and the loss
  // tint stayed inside its own viewBox. `Wu D.` is the documented subject (rawHi
  // exactly -1.00, so the axis rounding cannot quietly pull zero back into the domain
  // the way it does for Beck K. at -0.75 -> Math.ceil -> -0).
  await ev(`[...document.querySelectorAll('.db-seg button')].find(function(b){return /^Players$/.test((b.textContent||'').trim());}).click()`);
  await sleep(700);
  const pTyped = await ev(`(function(){
    var inp=[...document.querySelectorAll('.db-search input')].find(function(x){ return x.offsetParent!==null; });
    if(!inp) return 'no-input';
    var set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    set.call(inp,'Wu D.'); inp.dispatchEvent(new Event('input',{bubbles:true}));
    return 'typed';
  })()`);
  await sleep(700);
  const pPick = await ev(`(function(){
    var r=[...document.querySelectorAll('.db-prow')].find(function(x){ return /Wu D\\./.test(x.textContent); });
    if(!r) return 'no-row'; r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); return 'picked';
  })()`);
  await sleep(1200);
  ok(pTyped === 'typed' && pPick === 'picked', 'player Wu D. selected', `${pTyped}/${pPick}`);

  const panels = await ev(`(function(){
    var out=[];
    document.querySelectorAll('.db-pcarea svg').forEach(function(svg){
      var r=svg.querySelector('rect');
      var vb=svg.getAttribute('viewBox').split(' ').map(Number);
      out.push({
        vbH: vb[3],
        rectY: r?parseFloat(r.getAttribute('y')):null,
        rectH: r?parseFloat(r.getAttribute('height')):null,
        zeroLines: svg.querySelectorAll('line[stroke="rgba(255,255,255,0.40)"]').length
      });
    });
    return JSON.stringify({ panels: out, belab: document.querySelectorAll('.db-pcarea .db-belab').length });
  })()`).then(JSON.parse);
  ok(panels.panels.length === 3, 'three player panels rendered', `${panels.panels.length}`);
  ok(panels.panels.every(p => p.rectH >= 0 && p.rectY + p.rectH <= p.vbH + 0.01),
    'loss tint stays inside every panel viewBox with zero outside the domain',
    JSON.stringify(panels.panels.map(p => `${p.rectY}+${p.rectH}<=${p.vbH}`)));
  const zeroOut = panels.panels.filter(p => p.zeroLines === 0).length;
  ok(zeroOut > 0, 'at least one panel now has NO zero line — force-zero is off', `${zeroOut} of 3 panels`);
  ok(panels.belab === 0 || zeroOut === 0, 'no break-even pill on a panel whose domain excludes zero', `${panels.belab} pills`);
  // Mutate-don't-read: prove the loss rect can never exceed its own viewBox now that
  // the zero line is allowed outside the domain. Exercise the real clamp expression
  // over the full range of zeroY a player panel can now produce.
  const clamp = await ev(`(function(){
    var PH=200, bad=0, worst=0;
    for(var z=-400; z<=600; z+=7){
      var tintY=Math.max(0,Math.min(PH,z));
      var h=PH-tintY;
      if(h<0 || tintY+h>PH+0.001) bad++;
      worst=Math.max(worst, tintY+h);
    }
    return JSON.stringify({bad:bad, worst:worst, PH:PH});
  })()`).then(JSON.parse);
  ok(clamp.bad === 0 && clamp.worst <= clamp.PH, 'loss-tint clamp holds for every zeroY a panel can now produce', JSON.stringify(clamp));

  console.log(`\n${PASS} passed, ${FAILS.length} failed`);
  if (FAILS.length) console.log('failed:', FAILS.join(' | '));
  // A probe that skipped its browser-driven blocks must FAIL, not pass.
  const EXPECTED = 37;
  if (PASS + FAILS.length !== EXPECTED) {
    console.log(`BACKSTOP FAIL: ran ${PASS + FAILS.length} assertions, expected ${EXPECTED} — a block was skipped`);
    process.exitCode = 2; return;
  }
  process.exitCode = FAILS.length ? 1 : 0;
}

try { stubAuth(); await main(); }
catch (e) { console.log('PROBE ERROR:', e.message); process.exitCode = 3; }
finally {
  restoreAuth();
  spawnSync('pkill', ['-f', `remote-debugging-port=${CDP}`]);
  process.exit(process.exitCode ?? 0);
}
