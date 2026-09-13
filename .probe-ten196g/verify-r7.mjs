#!/usr/bin/env node
// TEN-196 round 7 — verify gate 41497cb8: `spec-ladder` + `footnote-tour-only`.
//
// Reads the painted DOM only. The expected axis values are recomputed from the
// two JSON artefacts by this file's own parser, which imports nothing from the
// page or the builder.
//
// Usage: node verify-r7.mjs            (serves this worktree on 8199)
//        PROBE_BASE=https://... node verify-r7.mjs   (deployed page)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new globalThis.URL(import.meta.url).pathname);
const PORT = 8199;
const BASE = process.env.PROBE_BASE || `http://127.0.0.1:${PORT}`;
const URL_ = `${BASE}/bsp-consult-dashboard.html`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0, skipped = 0;
const fails = [];
function ok(name, cond, got, want) {
  if (cond) { pass++; }
  else { fail++; fails.push(`${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); }
}
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), a, b);

// ── independent recomputation ───────────────────────────────────────────────────
const DATA = JSON.parse(fs.readFileSync(path.join(HERE, 'database-yield.json'), 'utf8'));
const NAMES = JSON.parse(fs.readFileSync(path.join(HERE, 'database-yield-players.json'), 'utf8'));
const rows = DATA.rows, nm = NAMES.names;
const SPEC_LADDER = [10, 25, 50, 100, 250, 500, 1000, 2500];

function fmtInt(v) { return (v < 0 ? '-' : '') + Math.abs(Math.round(v)).toLocaleString('en-US'); }
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
function playerAxis(rawHi, rawLo) {
  let dHi = rawHi, dLo = rawLo;
  if (dHi < 0) dHi = 0; if (dLo > 0) dLo = 0;
  let step, rnd, hi, lo;
  for (let i = 0; i < SPEC_LADDER.length; i++) {
    step = SPEC_LADDER[i];
    if (i < SPEC_LADDER.length - 1 && (dHi - dLo) / step > 10) continue;
    rnd = Math.max(1, step / 5);
    hi = Math.ceil(dHi / rnd) * rnd; lo = Math.floor(dLo / rnd) * rnd;
    if (hi === lo) hi = lo + rnd;
    if (Math.floor(hi / step) - Math.ceil(lo / step) + 1 <= 10) break;
  }
  return { step, hi, lo, labels: labelsFor(hi, lo, step, true) };
}
function tourAxis(pred, isTourn) {
  let cf = 0, cd = 0, rawHi = -Infinity, rawLo = Infinity;
  for (const r of rows) {
    if (pred && !pred(r)) continue;
    cf += r[7] ? (r[5] - 1) : -1;
    cd += r[7] ? -1 : (r[6] - 1);
    rawHi = Math.max(rawHi, cf, cd); rawLo = Math.min(rawLo, cf, cd);
  }
  const sp = rawHi - rawLo;
  let step, rnd, hi, lo;
  for (let i = 0; i < SPEC_LADDER.length; i++) {
    step = SPEC_LADDER[i];
    if (i < SPEC_LADDER.length - 1 && sp / step > 10) continue;
    rnd = Math.max(10, step / 10);
    hi = (isTourn && rawHi > 0) ? Math.ceil(rawHi / step) * step : Math.max(rnd, Math.ceil(rawHi / rnd) * rnd);
    lo = Math.floor(rawLo / rnd) * rnd;
    if (hi === lo) hi = lo + rnd;
    if (lo > 0) lo = 0;
    if (hi === lo) hi = lo + rnd;
    if (Math.floor(hi / step) - Math.ceil(lo / step) + 1 <= 10) break;
  }
  return { step, hi, lo, rawHi, rawLo, labels: labelsFor(hi, lo, step, false) };
}
const pidx = new Map();
for (let i = 0; i < rows.length; i++) {
  const r = rows[i], w = nm[i][0], l = nm[i][1], fw = r[7];
  const push = (n, rec) => { if (!n) return; if (!pidx.has(n)) pidx.set(n, []); pidx.get(n).push(rec); };
  push(w, { p: fw ? r[5] : r[6], w: 1, d: r[0], fav: fw === 1, b: r[8] });
  push(l, { p: fw ? r[6] : r[5], w: 0, d: r[0], fav: fw === 0, b: r[8] });
}
function playerExpect(name) {
  const recs = pidx.get(name);
  let all = [];
  for (const s of [recs, recs.filter(v => v.fav), recs.filter(v => !v.fav)]) {
    const ord = s.slice().sort((a, b) => a.d - b.d); let c = 0;
    for (const v of ord) { c += v.w ? (v.p - 1) : -1; all.push(c); }
  }
  const ax = playerAxis(Math.max(...all), Math.min(...all));
  const b365 = recs.filter(v => v.b === 1).length;
  return { ...ax, n: recs.length, b365, ps: recs.length - b365 };
}

// ── CDP plumbing ────────────────────────────────────────────────────────────────
function client(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pend = new Map(); const handlers = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method && handlers.has(m.method)) handlers.get(m.method)(m.params);
  };
  return { ready, on: (m, fn) => handlers.set(m, fn),
    send: (method, params = {}) => ready.then(() => new Promise((res, rej) => { const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); })),
    close: () => ws.close() };
}

let server = null;
if (!process.env.PROBE_BASE) {
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: HERE, stdio: ['ignore', 'ignore', 'ignore'] });
  await sleep(1200);
}
const udir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten196r7-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${udir}`, '--no-first-run', '--window-size=1680,1400', 'about:blank'],
  { stdio: ['ignore', 'pipe', 'pipe'] });
let dport = 0;
await new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error('chrome start timeout')), 20000);
  chrome.stderr.on('data', (d) => { const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(String(d)); if (m) { dport = +m[1]; clearTimeout(to); res(); } });
});
const list = await (await fetch(`http://127.0.0.1:${dport}/json`)).json();
const c = client(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await c.ready;
await c.send('Page.enable'); await c.send('Runtime.enable');
const consoleErrs = [];
c.on('Runtime.exceptionThrown', (p) => { const d = p.exceptionDetails || {}; consoleErrs.push(`${d.text || 'exception'} ${(d.exception && d.exception.description) || ''}`); });
c.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') consoleErrs.push((p.args || []).map((a) => a.value || a.description).join(' ')); });
await c.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(function(){var stub=new Proxy({},{get:function(t,k){
    if(k==='requireVerified'||k==='requireAuth') return function(){return Promise.resolve({ok:true,email:'probe@local'})};
    if(k==='onAuthChange') return function(){};
    return t[k]||function(){}; },set:function(t,k,v){t[k]=v;return true}});
    Object.defineProperty(window,'BSP',{value:stub,writable:false,configurable:false,enumerable:true});})();`,
});
await c.send('Page.navigate', { url: URL_ });
await sleep(2500);
const ev = async (expr) => {
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

const pick = async (tab, query, match) => {
  await ev(`document.querySelector('[data-page="database"] [data-dbview="${tab}"]').click()`); await sleep(1400);
  await ev(`(function(){var i=document.querySelector('[data-page="database"] .db-search input');var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(i,${JSON.stringify(query)});i.dispatchEvent(new Event('input',{bubbles:true}));})()`); await sleep(1100);
  await ev(`(function(){var r=[].slice.call(document.querySelectorAll('[data-page="database"] .db-prow')).filter(function(x){return ${match}.test(x.textContent)})[0]; if(r) r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));})()`); await sleep(2600);
};

// what the browser painted, per chart
const READ_TOUR_AXIS = `(function(){
  var root=document.querySelector('[data-page="database"]');
  var card=[].slice.call(root.querySelectorAll('.db-card')).filter(function(c){return c.querySelector('.db-plotarea svg')})[0];
  if(!card) return {error:'no chart'};
  return {
    labels:[].slice.call(card.querySelectorAll('.db-yaxis > div')).map(function(d){return d.textContent.trim()}),
    seamfoot: !!card.querySelector('.db-seamfoot'),
    seamfootText: card.querySelector('.db-seamfoot') ? card.querySelector('.db-seamfoot').textContent.trim() : null
  };
})()`;
const READ_PLAYER_AXIS = `(function(){
  var root=document.querySelector('[data-page="database"]');
  var cards=[].slice.call(root.querySelectorAll('.db-card')).filter(function(c){return c.querySelector('.db-pcarea svg')});
  var card=cards[0];
  if(!card) return {error:'no player chart'};
  var ax=[].slice.call(card.querySelectorAll('.db-pcaxis')).map(function(y){
    return [].slice.call(y.children).map(function(d){return d.textContent.trim()}); });
  return {
    axes:ax, panels:card.querySelectorAll('.db-pcarea svg').length,
    seamfoot: !!card.querySelector('.db-seamfoot'),
    amber: [].slice.call(card.querySelectorAll('*')).filter(function(e){
      var s=getComputedStyle(e); return /232,\\s*168,\\s*78/.test(s.borderLeftColor+'|'+s.color+'|'+s.backgroundColor); }).length,
    prose: [].slice.call(root.querySelectorAll('.db-split')).map(function(e){return e.textContent.trim()})
  };
})()`;

// ── 1 · Tour chart: the ladder is §8's and the 5000 is gone ─────────────────────
const T = await ev(READ_TOUR_AXIS);
const expT = tourAxis(null, false);
eq('T1 Tour y-axis labels', T.labels, expT.labels);
ok('T2 Tour step is on §8 ladder', SPEC_LADDER.includes(expT.step), expT.step, SPEC_LADDER);
ok('T3 Tour gridline count <=10', T.labels.length <= 10, T.labels.length, '<=10');
ok('T4 Tour chart carries the seam footnote', T.seamfoot === true, T.seamfoot, true);

// ── 2 · Tournaments chart ──────────────────────────────────────────────────────
// TWO subjects, because the seam footnote has a branch and one subject cannot
// exercise both sides of it. US Open holds 2,000 rows and NOT ONE is Bet365 — the
// archive stops at 2026-07-26, five weeks before the event — so it is immune to
// clause (2) and asserting the footnote there proves nothing. Wimbledon crosses:
// 126 Bet365 rows. Counts below are read off the artefact, not carried.
const TOURN = DATA.meta.tournaments;
const tIdx = (name) => TOURN.findIndex((t) => t === name);
for (const [name, query] of [['Wimbledon', 'Wimbledon'], ['US Open', 'US Open']]) {
  const ti = tIdx(name);
  const b365 = rows.filter((r) => r[4] === ti && r[8] === 1).length;
  const n = rows.filter((r) => r[4] === ti).length;
  await pick('tournaments', query, new RegExp('^' + name + '$', 'i').toString().replace(/^\/|\/i$/g, '') === name ? `/^${name}$/i` : `/${name}/i`);
  const TN = await ev(READ_TOUR_AXIS);
  const expTN = tourAxis((r) => r[4] === ti, true);
  eq(`TN·${name} y-axis labels`, TN.labels, expTN.labels);
  ok(`TN·${name} step ${expTN.step} is on §8 ladder`, SPEC_LADDER.includes(expTN.step), expTN.step, SPEC_LADDER);
  ok(`TN·${name} gridline count <=10`, TN.labels.length <= 10, TN.labels.length, '<=10');
  ok(`TN·${name} archive: ${b365} Bet365 of ${n}`, n > 0, [b365, n], 'n > 0');
  ok(`TN·${name} seam footnote ${b365 > 0 ? 'PRESENT' : 'ABSENT'}`, TN.seamfoot === (b365 > 0), TN.seamfoot, b365 > 0);
}

// ── 3 · Players: §8's ladder, on the subjects the ruling names ─────────────────
// Khachanov is the seam-crossing subject named in the gate: 31 Bet365 2026 matches
// against 506 Pinnacle. A pre-2026 retiree would be immune to clause (2) and score
// clean on a broken build, so the footnote assertion must run HERE.
// THIRD SUBJECT, and it is the one the first version of this probe was missing.
// Khachanov (5 gridlines) and Sinner (2) both sit in the well-behaved tail. The
// population this ruling actually creates is the 699 panels whose axis collapses
// to a bare "0", and nothing asserted on it — so an arithmetic defect that empties
// or mis-draws those axes scored clean. Michelsen A. is the largest such sample
// (n=150, raw -7.6..+6.9u). A clean-context review proved the gap: an off-by-one
// at the bottom of the label loop leaves 57 panels with a COMPLETELY EMPTY y axis
// and the two-subject probe scored 36 of 36 against it.
// Michelsen alone was NOT enough and the mutation run proved it: his axis is the
// bare "0", and 0 > lo, so the off-by-one leaves him untouched. The defect only
// shows on a panel whose BOTTOM gridline sits exactly on `lo`. Murray A. (n=667)
// is the largest: [+10u, 0, -10u, -20u, -30u] loses its -30u. 159 panels move,
// 58 are left with no axis at all.
for (const who of ['Khachanov', 'Sinner J', 'Michelsen A', 'Murray A']) {
  await pick('players', who, new RegExp(who.replace(/[.\s]/g, '.'), 'i').toString());
  await waitFor('[data-page="database"] .db-pcarea svg', 3);
  const P = await ev(READ_PLAYER_AXIS);
  const full = { Khachanov: 'Khachanov K.', 'Sinner J': 'Sinner J.', 'Michelsen A': 'Michelsen A.', 'Murray A': 'Murray A.' }[who];
  const e = playerExpect(full);
  ok(`P·${full} axis is never empty`, P.axes.every((a) => a.length >= 1), P.axes.map((a) => a.length), '>=1');
  if (who === 'Michelsen A') {
    ok(`P·${full} is in the only-"0" population (the ruling's real cost)`, JSON.stringify(e.labels) === '["0"]', e.labels, ['0']);
    eq(`P·${full} paints a bare "0" and nothing else`, P.axes[0], ['0']);
  }
  eq(`P·${full} main-panel labels`, P.axes[0], e.labels);
  ok(`P·${full} step ${e.step} is on §8 ladder`, SPEC_LADDER.includes(e.step), e.step, SPEC_LADDER);
  // Multiples of the CHOSEN STEP, not "of some rung on the ladder" — the weaker
  // form passes a chart on step 25 that paints +20u, because 20 % 10 === 0.
  ok(`P·${full} every label is a multiple of the chosen step ${e.step}`, P.axes.every(a => a.every(l => {
    const v = Number(String(l).replace(/[+u,]/g, '')); return v % e.step === 0;
  })), P.axes, `multiples of ${e.step}`);
  ok(`P·${full} all three panels share one ladder`, P.axes.every(a => JSON.stringify(a) === JSON.stringify(P.axes[0])), P.axes, 'identical');
  ok(`P·${full} gridline count <=10`, P.axes[0].length <= 10, P.axes[0].length, '<=10');
  ok(`P·${full} break-even 0 is on the axis`, P.axes[0].includes('0'), P.axes[0], 'contains 0');
  // clause (2): footnote-tour-only, asserted on a subject whose data DOES cross the seam
  if (who === 'Khachanov') {
    ok(`P·${full} crosses the seam (${e.b365} Bet365 / ${e.ps} Pinnacle)`, e.b365 > 0 && e.ps > 0, [e.b365, e.ps], 'both > 0');
    ok(`P·${full} renders NO seam footnote (footnote-tour-only)`, P.seamfoot === false, P.seamfoot, false);
    ok(`P·${full} renders NO amber element on the card`, P.amber === 0, P.amber, 0);
    ok(`P·${full} states the book split in prose instead`, P.prose.length >= 1, P.prose, '>=1');
  }
}

// ── 4 · source lock ────────────────────────────────────────────────────────────
// The DOM assertions above cannot see the 5000 that was removed: it was measured
// unreachable (widest span 2,316.1u against the 25,000u it needs), so a build that
// puts it back paints byte-identical charts and scores a clean 30. Locking it
// therefore has to be a SOURCE assertion, and it is the only honest place for it.
// Same for the retired Players ladder: a partial revert that only reinstates the
// constant without wiring it would also score clean above.
const src = await (await fetch(`${BASE}/bsp-consult-dashboard.html`)).text();
const ladderLits = [...src.matchAll(/var (STEP_LADDER|STEPS|PSTEPS)\s*=\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]);
eq('S1 STEP_LADDER is §8 verbatim', ladderLits.find((l) => l[0] === 'STEP_LADDER')?.[1], '[10,25,50,100,250,500,1000,2500]');
// EXACT, not a prefix match: `STEP_LADDER.concat([5e3])` satisfies /^STEP_LADDER\b/
// and reinstates the removed rung while every DOM assertion still passes. A review
// mutant did exactly that and survived 36/36.
eq('S2 STEPS is exactly the shared ladder', ladderLits.find((l) => l[0] === 'STEPS')?.[1].replace(/\s*\/\/.*$/, '').trim(), 'STEP_LADDER');
eq('S3 PSTEPS is exactly the shared ladder', ladderLits.find((l) => l[0] === 'PSTEPS')?.[1].replace(/\s*\/\/.*$/, '').trim(), 'STEP_LADDER');
// Any rung above 2500, however spelled — 5000, 5e3, 2500*2. Scans the whole
// ladder region, not just the three declarations.
const ladderRegion = src.slice(src.indexOf('var STEP_LADDER'), src.indexOf('var STEP_LADDER') + 200);
const nums = [...ladderRegion.matchAll(/\b(\d+(?:\.\d+)?(?:e\d+)?)\b/gi)].map((m) => Number(m[1])).filter((n) => Number.isFinite(n));
ok('S4 no ladder rung above 2500, however spelled', !nums.some((n) => n > 2500), nums.filter((n) => n > 2500), 'none');
ok('S4b STEPS/PSTEPS are not extended at the use site', !ladderLits.some((l) => /concat|push|\.\.\./.test(l[1])), ladderLits.map((l) => l[1]), 'no concat/push/spread');
// Scoped to an ASSIGNMENT, not a mention: the two prose references to the retired
// ladder are in the ruling comments that exist to stop it coming back, and a bare
// text scan fails on those. The defect shape is the literal being given to a name.
ok('S5 the retired Players ladder is never assigned', !/=\s*\[\s*1\s*,\s*2\s*,\s*5\s*,\s*10\s*,\s*20\s*,\s*25\s*,\s*50\s*,\s*100\s*\]/.test(src), 'found an assignment of [1,2,5,10,20,25,50,100]', 'absent');
ok('S6 exactly one ladder literal in the file', ladderLits.filter((l) => /^\[/.test(l[1])).length === 1, ladderLits.filter((l) => /^\[/.test(l[1])).length, 1);
// The two `rnd` formulas. NOT part of the founder's ruling — but the 699 bare-"0"
// axes are an artefact of the Players `rnd`, not of the ladder (with the Tour rnd
// the same ladder gives 0 of them), so whoever changes one of these is inverting
// the measured trade the ruling was taken on. Pinning them makes that deliberate.
const rnds = [...src.matchAll(/rnd\s*=\s*Math\.max\(([^)]*)\)/g)].map((m) => m[1].replace(/\s/g, ''));
eq('S7 the two rnd formulas are exactly the two ruled-on ones', rnds, ['10,step/10', '1,step/5']);

console.log(`\n${pass + fail} assertions, ${pass} pass, ${fail} fail, ${skipped} skipped`);
if (fails.length) console.log('\nFAILURES:\n' + fails.join('\n'));
console.log('\nconsole errors: ' + (consoleErrs.length ? consoleErrs.join(' | ') : '(none)'));
c.close(); chrome.kill(); if (server) server.kill();
process.exit(fail ? 1 : 0);
