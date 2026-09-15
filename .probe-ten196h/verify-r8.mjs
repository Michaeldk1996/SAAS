#!/usr/bin/env node
// TEN-196 round 8 — verify gate b6f04a43 `keep-as-is` + gate 41497cb8 `footnote-tour-only`.
//
// Reads the painted DOM only. Expected axes are recomputed from the two JSON
// artefacts by this file's own parser, which imports nothing from the page.
//
// SUBJECT CHOICE IS THE WHOLE DESIGN HERE. The regression this guards against is a
// later run conforming the page to CHARTS.md §8. Swept over all 64,003 non-empty
// Tour/Tournament views, §8 changes NOT ONE axis label — those charts are immune and
// asserting the ladder on them is vacuous. 1,097 of 1,129 Players panels DO move, so
// every ladder assertion below is on a Players panel.
//
// Usage: node verify-r8.mjs                       (serves the worktree on 8198)
//        PROBE_BASE=https://… node verify-r8.mjs  (deployed page)
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const HERE = path.dirname(new globalThis.URL(import.meta.url).pathname);
const ROOT = path.join(HERE, '..');
const PORT = 8198;
const BASE = process.env.PROBE_BASE || `http://127.0.0.1:${PORT}`;
const URL_ = `${BASE}/bsp-consult-dashboard.html`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, got, want) {
  if (cond) pass++; else { fail++; fails.push(`${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`); }
}
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), a, b);

// ── independent recomputation ──────────────────────────────────────────────────
const DATA  = JSON.parse(fs.readFileSync(path.join(ROOT, 'database-yield.json'), 'utf8'));
const NAMES = JSON.parse(fs.readFileSync(path.join(ROOT, 'database-yield-players.json'), 'utf8'));
const rows = DATA.rows, nm = NAMES.names;

// The two ruled ladders, written out here so the probe fails if the page changes.
const TOUR_LADDER   = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const PLAYER_LADDER = [1, 2, 5, 10, 20, 25, 50, 100];
const SPEC8         = [10, 25, 50, 100, 250, 500, 1000, 2500];   // the rejected clause

const fmtInt = v => (v < 0 ? '-' : '') + Math.abs(Math.round(v)).toLocaleString('en-US');
function labelsFor(hi, lo, step, playerStyle) {
  const out = [];
  if (playerStyle) {
    for (let v = Math.floor(hi / step) * step; v >= lo; v -= step)
      out.push(v === 0 ? '0' : (v > 0 ? '+' + fmtInt(v) + 'u' : fmtInt(v) + 'u'));
  } else {
    for (let v = Math.floor(hi / step) * step; v > 0; v -= step) out.push('+' + fmtInt(v) + 'u');
    for (let v = 0; v >= lo; v -= step) out.push(v === 0 ? '0' : fmtInt(v) + 'u');
  }
  return out;
}
function playerAxis(rawHi, rawLo, LADDER = PLAYER_LADDER, rndFn = s => Math.max(1, s / 5)) {
  let dHi = rawHi, dLo = rawLo;
  if (dHi < 0) dHi = 0; if (dLo > 0) dLo = 0;
  let step, rnd, hi, lo;
  for (let i = 0; i < LADDER.length; i++) {
    step = LADDER[i];
    if (i < LADDER.length - 1 && (dHi - dLo) / step > 10) continue;
    rnd = rndFn(step);
    hi = Math.ceil(dHi / rnd) * rnd; lo = Math.floor(dLo / rnd) * rnd;
    if (hi === lo) hi = lo + rnd;
    if (Math.floor(hi / step) - Math.ceil(lo / step) + 1 <= 10) break;
  }
  return { step, hi, lo, labels: labelsFor(hi, lo, step, true) };
}
function tourAxis(pred, isTourn, LADDER = TOUR_LADDER) {
  let cf = 0, cd = 0, rawHi = -Infinity, rawLo = Infinity;
  for (const r of rows) {
    if (pred && !pred(r)) continue;
    cf += r[7] ? (r[5] - 1) : -1;
    cd += r[7] ? -1 : (r[6] - 1);
    rawHi = Math.max(rawHi, cf, cd); rawLo = Math.min(rawLo, cf, cd);
  }
  const sp = rawHi - rawLo;
  let step, rnd, hi, lo;
  for (let i = 0; i < LADDER.length; i++) {
    step = LADDER[i];
    if (i < LADDER.length - 1 && sp / step > 10) continue;
    rnd = Math.max(10, step / 10);
    hi = (isTourn && rawHi > 0) ? Math.ceil(rawHi / step) * step : Math.max(rnd, Math.ceil(rawHi / rnd) * rnd);
    lo = Math.floor(rawLo / rnd) * rnd;
    if (hi === lo) hi = lo + rnd;
    if (lo > 0) lo = 0;
    if (hi === lo) hi = lo + rnd;
    if (Math.floor(hi / step) - Math.ceil(lo / step) + 1 <= 10) break;
  }
  return { step, hi, lo, rawHi, rawLo, sp, labels: labelsFor(hi, lo, step, false) };
}
const pidx = new Map();
for (let i = 0; i < rows.length; i++) {
  const r = rows[i], w = nm[i][0], l = nm[i][1], fw = r[7];
  const push = (n, rec) => { if (!n) return; if (!pidx.has(n)) pidx.set(n, []); pidx.get(n).push(rec); };
  push(w, { p: fw ? r[5] : r[6], w: 1, d: r[0], fav: fw === 1, b: r[8] });
  push(l, { p: fw ? r[6] : r[5], w: 0, d: r[0], fav: fw === 0, b: r[8] });
}
function playerExpect(name) {
  const recs = pidx.get(name); let all = [];
  for (const s of [recs, recs.filter(v => v.fav), recs.filter(v => !v.fav)]) {
    const ord = s.slice().sort((a, b) => a.d - b.d); let c = 0;
    for (const v of ord) { c += v.w ? (v.p - 1) : -1; all.push(c); }
  }
  const rawHi = Math.max(...all), rawLo = Math.min(...all);
  const ax = playerAxis(rawHi, rawLo);
  const s8 = playerAxis(rawHi, rawLo, SPEC8);          // what the rejected option would paint
  const b365 = recs.filter(v => v.b === 1).length;
  return { ...ax, s8, n: recs.length, b365, ps: recs.length - b365 };
}

// ── CDP plumbing ───────────────────────────────────────────────────────────────
function client(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0;
  const pend = new Map(), handlers = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => { const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method && handlers.has(m.method)) handlers.get(m.method)(m.params); };
  return { ready, on: (m, fn) => handlers.set(m, fn),
    send: (method, params = {}) => ready.then(() => new Promise((res, rej) => { const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); })),
    close: () => ws.close() };
}
let server = null;
if (!process.env.PROBE_BASE) {
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(1400);
}
const udir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten196r8-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${udir}`, '--no-first-run', '--window-size=1680,1400', 'about:blank'],
  { stdio: ['ignore', 'pipe', 'pipe'] });
let dport = 0;
await new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error('chrome start timeout')), 20000);
  chrome.stderr.on('data', d => { const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(String(d)); if (m) { dport = +m[1]; clearTimeout(to); res(); } });
});
const list = await (await fetch(`http://127.0.0.1:${dport}/json`)).json();
const c = client(list.find(t => t.type === 'page').webSocketDebuggerUrl);
await c.ready; await c.send('Page.enable'); await c.send('Runtime.enable');
const consoleErrs = [];
c.on('Runtime.exceptionThrown', p => { const d = p.exceptionDetails || {}; consoleErrs.push(`${d.text || 'exception'} ${(d.exception && d.exception.description) || ''}`); });
c.on('Runtime.consoleAPICalled', p => { if (p.type === 'error') consoleErrs.push((p.args || []).map(a => a.value || a.description).join(' ')); });
await c.send('Page.addScriptToEvaluateOnNewDocument', { source:
  `(function(){var stub=new Proxy({},{get:function(t,k){
    if(k==='requireVerified'||k==='requireAuth') return function(){return Promise.resolve({ok:true,email:'probe@local'})};
    if(k==='onAuthChange') return function(){};
    return t[k]||function(){}; },set:function(t,k,v){t[k]=v;return true}});
    Object.defineProperty(window,'BSP',{value:stub,writable:false,configurable:false,enumerable:true});})();` });
await c.send('Page.navigate', { url: URL_ });
await sleep(2600);
const ev = async expr => {
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception || {}).description || ''));
  return r.result.value;
};
const waitFor = async (sel, n = 1, ms = 30000) => {
  const dl = Date.now() + ms;
  while (Date.now() < dl) { if (await ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`) >= n) return true; await sleep(400); }
  return false;
};
await ev(`(function(){var b=document.getElementById('databaseTabBtn'); if(b){b.style.display=''; b.click();}})()`);
await waitFor('[data-page="database"] .db-plotarea svg');

const pick = async (tab, query, matchRe) => {
  await ev(`document.querySelector('[data-page="database"] [data-dbview="${tab}"]').click()`); await sleep(1400);
  await ev(`(function(){var i=document.querySelector('[data-page="database"] .db-search input');var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(i,${JSON.stringify(query)});i.dispatchEvent(new Event('input',{bubbles:true}));})()`); await sleep(1100);
  await ev(`(function(){var r=[].slice.call(document.querySelectorAll('[data-page="database"] .db-prow')).filter(function(x){return ${matchRe}.test(x.textContent)})[0]; if(r) r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));})()`); await sleep(2600);
};
const READ_TOUR = `(function(){
  var root=document.querySelector('[data-page="database"]');
  var card=[].slice.call(root.querySelectorAll('.db-card')).filter(function(c){return c.querySelector('.db-plotarea svg')})[0];
  if(!card) return {error:'no chart'};
  return { labels:[].slice.call(card.querySelectorAll('.db-yaxis > div')).map(function(d){return d.textContent.trim()}),
           seamfoot: !!card.querySelector('.db-seamfoot') };})()`;
const READ_PLAYER = `(function(){
  var root=document.querySelector('[data-page="database"]');
  var card=[].slice.call(root.querySelectorAll('.db-card')).filter(function(c){return c.querySelector('.db-pcarea svg')})[0];
  if(!card) return {error:'no player chart'};
  return { axes:[].slice.call(card.querySelectorAll('.db-pcaxis')).map(function(y){
             return [].slice.call(y.children).map(function(d){return d.textContent.trim()}); }),
           panels:card.querySelectorAll('.db-pcarea svg').length,
           // SCOPED TO THE WHOLE DATABASE PAGE, NOT TO THE CARD. A card-scoped read
           // misses the likeliest undo of this ruling: appending the seam note to the
           // Players page body next to renderFootnote(). A clean-context review wrote
           // that mutant and it scored 59/59 against the card-scoped version.
           seamfoot: root.querySelectorAll('.db-seamfoot').length,
           amber: [].slice.call(root.querySelectorAll('*')).filter(function(e){
             var s=getComputedStyle(e); return /232,\\s*168,\\s*78/.test(s.borderLeftColor+'|'+s.color+'|'+s.backgroundColor); }).length,
           prose: [].slice.call(root.querySelectorAll('.db-split')).map(function(e){return e.textContent.trim()}) };})()`;

// ── 1 · Tour chart — asserted for CORRECTNESS, and explicitly NOT for the ladder ──
const T = await ev(READ_TOUR);
const expT = tourAxis(null, false);
ok('T0 Tour chart rendered at all', !T.error && Array.isArray(T.labels), T.error || T.labels, 'painted labels');
eq('T1 Tour y-axis labels match the independent recomputation', T.labels, expT.labels);
ok('T2 Tour gridline count <=10', T.labels.length <= 10, T.labels.length, '<=10');
ok('T3 Tour chart DOES carry the seam footnote (positive control for clause 2)', T.seamfoot === true, T.seamfoot, true);
// Stated, not asserted: the Tour chart is immune to the ladder ruling.
eq('T4 Tour paints the SAME labels under the rejected §8 ladder (immunity, stated in the lock)',
   tourAxis(null, false, SPEC8).labels, expT.labels);

// ── 2 · Tournaments — the two-sided footnote control ────────────────────────────
const TOURN = DATA.meta.tournaments;
for (const [name, query, re] of [['Wimbledon', 'Wimbledon', '/Wimbledon/i'], ['US Open', 'US Open', '/US Open/i']]) {
  const ti = TOURN.findIndex(t => t === name);
  const b365 = rows.filter(r => r[4] === ti && r[8] === 1).length;
  const n = rows.filter(r => r[4] === ti).length;
  await pick('tournaments', query, re);
  const TN = await ev(READ_TOUR);
  const expTN = tourAxis(r => r[4] === ti, true);
  ok(`TN·${name} chart rendered at all`, !TN.error && Array.isArray(TN.labels), TN.error || TN.labels, 'painted labels');
  if (TN.error || !Array.isArray(TN.labels)) continue;
  eq(`TN·${name} y-axis labels`, TN.labels, expTN.labels);
  ok(`TN·${name} gridline count <=10`, TN.labels.length <= 10, TN.labels.length, '<=10');
  ok(`TN·${name} archive holds ${b365} Bet365 of ${n} — the branch this subject exercises`, n > 0, [b365, n], 'n>0');
  ok(`TN·${name} seam footnote ${b365 > 0 ? 'PRESENT' : 'ABSENT'}`, TN.seamfoot === (b365 > 0), TN.seamfoot, b365 > 0);
}

// ── 3 · Players — where this ruling is actually observable ──────────────────────
// Michelsen A. is the sharpest single subject: §8 collapses his 8-line axis to a
// bare "0". Khachanov and Sinner are the two the founder was shown. The footnote
// clause runs on Khachanov AND Michelsen, both seam-crossers — never on a b365=0
// subject, which is immune and scores clean on a broken build.
const SUBJECTS = [
  ['Khachanov',   'Khachanov K.',  '/Khachanov/i',   true],
  ['Sinner J',    'Sinner J.',     '/Sinner.J/i',    false],
  ['Michelsen A', 'Michelsen A.',  '/Michelsen.A/i', true],
];
for (const [query, full, re, seamSubject] of SUBJECTS) {
  await pick('players', query, re);
  await waitFor('[data-page="database"] .db-pcarea svg', 3);
  const P = await ev(READ_PLAYER);
  const e = playerExpect(full);
  // A build that throws while rendering this card returns {error}, and every
  // assertion below would throw on undefined. Fail here instead: "the page did not
  // render" is a RESULT, and a probe that crashes lets a mutation harness score it
  // as a survivor. That misreport happened on this probe's first mutation run.
  ok(`P·${full} player card rendered at all`, !P.error && Array.isArray(P.axes) && P.axes.length > 0, P.error || P.axes, 'three painted axes');
  if (P.error || !Array.isArray(P.axes) || !P.axes.length) continue;
  ok(`P·${full} axis is never empty`, P.axes.every(a => a.length >= 1), P.axes.map(a => a.length), '>=1');
  eq(`P·${full} main-panel labels`, P.axes[0], e.labels);
  // Derived from what Chrome PAINTED, not from the probe's own recomputation. The
  // previous form asserted `PLAYER_LADDER.includes(e.step)` where `e.step` came from
  // this file's playerAxis(…, PLAYER_LADDER) — true by construction for any page.
  const painted = P.axes[0].map(l => Number(String(l).replace(/[+u,]/g, '')));
  const gaps = painted.slice(1).map((v, i) => painted[i] - v);
  const paintedStep = gaps.length ? gaps[0] : null;
  ok(`P·${full} painted gridlines are evenly spaced`, gaps.every(g => g === paintedStep), gaps, `all ${paintedStep}`);
  ok(`P·${full} the PAINTED step ${paintedStep} is on the Players ladder and equals the recomputed ${e.step}`,
     paintedStep !== null && PLAYER_LADDER.includes(paintedStep) && paintedStep === e.step, paintedStep, e.step);
  // The assertion that actually rejects §8: the painted axis must NOT be what §8 gives.
  ok(`P·${full} painted axis REJECTS the §8 ladder (§8 would give ${JSON.stringify(e.s8.labels)})`,
     JSON.stringify(P.axes[0]) !== JSON.stringify(e.s8.labels), P.axes[0], `anything but ${JSON.stringify(e.s8.labels)}`);
  // Multiples of the CHOSEN step, not of some rung: the weak form passes a step-25
  // chart painting +20u, because 20 % 10 === 0.
  ok(`P·${full} every label is a multiple of the chosen step ${e.step}`,
     P.axes.every(a => a.every(l => Number(String(l).replace(/[+u,]/g, '')) % e.step === 0)), P.axes, `multiples of ${e.step}`);
  ok(`P·${full} all three panels share one ladder`, P.axes.every(a => JSON.stringify(a) === JSON.stringify(P.axes[0])), P.axes, 'identical');
  ok(`P·${full} gridline count <=10`, P.axes[0].length <= 10, P.axes[0].length, '<=10');
  ok(`P·${full} break-even 0 is on the axis`, P.axes[0].includes('0'), P.axes[0], 'contains 0');
  if (full === 'Michelsen A.')
    eq(`P·${full} paints a real ladder where §8 gives a bare "0"`, P.axes[0], ['+6u','+4u','+2u','0','-2u','-4u','-6u','-8u']);
  if (seamSubject) {
    ok(`P·${full} crosses the seam (${e.b365} Bet365 / ${e.ps} Pinnacle) — not immune to clause 2`, e.b365 > 0 && e.ps > 0, [e.b365, e.ps], 'both >0');
    ok(`P·${full} the Players PAGE renders no seam footnote anywhere (footnote-tour-only)`, P.seamfoot === 0, P.seamfoot, 0);
    ok(`P·${full} the Players PAGE renders no amber element anywhere`, P.amber === 0, P.amber, 0);
    ok(`P·${full} states the book split in prose instead`, P.prose.length >= 1, P.prose, '>=1');
  }
}

// ── 4 · source lock ────────────────────────────────────────────────────────────
// The 5000 rung is measurably unreachable — widest span over all 64,003 non-empty
// views is 2,326.3u against the 25,000u it needs — so a build that DELETES it paints
// byte-identical charts everywhere and no DOM assertion above can see it go. Source
// is the only honest place for that one.
const src = await (await fetch(`${BASE}/bsp-consult-dashboard.html`)).text();
const lits = [...src.matchAll(/var (STEP_LADDER|STEPS|PSTEPS)\s*=\s*([^;]+);/g)].map(m => [m[1], m[2].replace(/\s*\/\/.*$/, '').replace(/\s/g, '')]);
// Parsed as NUMBERS, not matched as text. `5e3` is the same rung as `5000` and is not
// a defect; an exact-text pin flags it while S6 — written to tolerate exactly that —
// passes, which both cries wolf and leaves S6 unreachable.
const nums = name => { const t = lits.find(l => l[0] === name)?.[1]; if (!t || !/^\[/.test(t)) return t ?? null;
  return t.slice(1, -1).split(',').map(Number); };
eq('S1 STEPS is the Tour ladder, by value (README.md:273 / Database.dc.html:935)',
   nums('STEPS'), [10, 25, 50, 100, 250, 500, 1000, 2500, 5000]);
eq('S2 PSTEPS is the Players ladder, by value (README.md:343 / Database.dc.html:821)',
   nums('PSTEPS'), [1, 2, 5, 10, 20, 25, 50, 100]);
ok('S3 there is NO shared STEP_LADDER constant (that was the rejected §8 build)',
   !lits.some(l => l[0] === 'STEP_LADDER') && !/var\s+STEP_LADDER/.test(src), 'STEP_LADDER present', 'absent');
ok('S4 exactly two ladder literals in the file', lits.filter(l => /^\[/.test(l[1])).length === 2, lits.filter(l => /^\[/.test(l[1])).length, 2);
ok('S5a neither ladder is extended in its own declaration', !lits.some(l => /concat|push|\.\.\./.test(l[1])), lits.map(l => l[1]), 'no concat/push/spread');
// WHOLE-FILE, not just the declaration. Either ladder can be mutated after the fact
// from anywhere, and a post-hoc mutation is invisible to both the declaration read
// above and to every DOM assertion (the 5000 rung is unreachable by measurement).
const tamper = [...src.matchAll(/\b(STEPS|PSTEPS|STEP_LADDER)\s*(?:\.\s*(push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)\b|\[\s*\d+\s*\]\s*=|\.\s*length\s*=)/g)].map(m => m[0]);
ok('S5b neither ladder is mutated anywhere else in the file', tamper.length === 0, tamper, 'none');
// The two loops must read the two ladders BY NAME. Pointing `step=` at a third array
// leaves both declarations pristine and every source lock above green.
ok('S5c the Tour loop reads STEPS and the Players loop reads PSTEPS',
   /step\s*=\s*STEPS\s*\[/.test(src) && /step\s*=\s*PSTEPS\s*\[/.test(src),
   [/step\s*=\s*STEPS\s*\[/.test(src), /step\s*=\s*PSTEPS\s*\[/.test(src)], [true, true]);
// The 5000 rung, however spelled — 5000, 5e3, 2500*2 — inside the Tour declaration.
const tourDecl = /var STEPS\s*=\s*\[([^\]]*)\]/.exec(src)?.[1] ?? '';
ok('S6 the Tour ladder still carries a 5000 rung', /(^|,)\s*(5000|5e3)\s*(,|$)/.test(tourDecl), tourDecl, 'contains 5000');
// The two rnd formulas. Not part of the founder's ruling, but the 699 bare-"0" axes
// under §8 are an artefact of the Players rnd, not the ladder, so whoever changes one
// is inverting the measured trade the ruling was taken on. Pinning makes it deliberate.
const rnds = [...src.matchAll(/(?<![A-Za-z0-9_$])rnd\s*=\s*Math\.max\(([^)]*)\)/g)].map(m => m[1].replace(/\s/g, ''));
eq('S7 the two rnd formulas are exactly the two ruled-on ones', rnds, ['10,step/10', '1,step/5']);

// The probe's own auth stub collides with auth.js by design; anything else is the page.
const pageErrs = consoleErrs.filter(e => !/Cannot assign to read only property 'BSP'/.test(e));
ok('X1 no page console error beyond the probe\'s own auth stub', pageErrs.length === 0, pageErrs, []);

console.log(`\n${pass + fail} assertions, ${pass} pass, ${fail} fail`);
if (fails.length) console.log('\nFAILURES:\n' + fails.join('\n'));
console.log('\nconsole errors: ' + (consoleErrs.length ? consoleErrs.join(' | ') : '(none)'));
c.close(); chrome.kill(); if (server) server.kill();
process.exit(fail ? 1 : 0);
