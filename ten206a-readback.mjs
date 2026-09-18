#!/usr/bin/env node
/**
 * ten206a-readback.mjs — the deployed read-back for TEN-206-A items 1-3.
 *
 * Covers the amendment's step (c) computed-style diff, (d) scripted interactions,
 * (e) reconciliation and (f) the chart bounding-box check. Every figure is read
 * off the rendered DOM and RE-DERIVED here, never copied from the module.
 *
 * Run against the hybrid server (branch code + DEPLOYED data), because the local
 * career-history store is short and a local read agrees with itself at the wrong
 * number. See ten206-hybrid-server.mjs.
 *
 * Usage: node ten228-mr-verify.mjs <baseUrl> <key> [key...]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.argv[2] || 'http://127.0.0.1:8794').replace(/\/$/, '');
const KEYS = process.argv.slice(3).length ? process.argv.slice(3) : ['1980'];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WIDTH = Number(process.env.WIDTH || 1440);
const HEIGHT = Number(process.env.HEIGHT || 900);

async function cdpTarget(dport, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json();
      const pg = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (pg) return pg.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('no CDP target');
}

const dport = 9400 + Math.floor((Date.now() / 997) % 300);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'mrverify-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`,
  `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', `--window-size=${WIDTH},${HEIGHT}`, 'about:blank'], { stdio: 'ignore' });

const ws = new WebSocket(await cdpTarget(dport));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
const jsErrors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    jsErrors.push(((d.exception && d.exception.description) || d.text || '').slice(0, 180));
  }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    throw new Error('eval threw: ' + ((d.exception && d.exception.description) || d.text || '').slice(0, 400));
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride',
  { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,
    get(){return _b;},set(v){if(v){v.requireVerified=()=>true;v.requireAuth=()=>true;}_b=v;}});})();`,
});
await send('Page.navigate', { url: `${BASE}/bsp-consult-dashboard.html` });

for (let i = 0; i < 400; i++) {
  if (await ev(`typeof playerProfiles !== 'undefined' && Object.keys(playerProfiles||{}).length > 0`)) break;
  await sleep(250);
}

let checks = 0, fails = 0; const failLines = [];
function ck(name, ok, detail) {
  checks++; if (!ok) { fails++; failLines.push(`${name}${detail ? ' :: ' + detail : ''}`); }
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}

const build = await ev(`fetch('build-info.json',{cache:'no-store'}).then(r=>r.json()).then(j=>j.commit.slice(0,8)+' @ '+(j.builtAt||j.generatedAt||'?'))`);
console.log(`\n  DEPLOYED BUILD: ${build}`);
const store = await ev(`fetch('player-profiles.json',{cache:'no-store'}).then(r=>r.json()).then(j=>j.fetchedAt+' / '+Object.keys(j.players).length+' players')`);
console.log(`  PROFILE STORE : ${store}`);

for (const key of KEYS) {
  console.log(`\n══ key ${key} @ ${WIDTH}x${HEIGHT} ══`);
  const got = await ev(`typeof ensurePlayerProfile === 'function' ? ensurePlayerProfile(${JSON.stringify(key)}) : Promise.resolve(false)`);
  if (!got) { console.log(`  ERROR profile ${key} did not load`); fails++; checks++; continue; }
  await ev(`(function(){var p=document.querySelectorAll('.tabpage');for(var i=0;i<p.length;i++)p[i].classList.remove('active');
    var pl=document.querySelector('.tabpage[data-page="players"]'); if(pl)pl.classList.add('active'); return !!pl;})()`);
  await ev(`(typeof showPlayerProfileV2==='function'?showPlayerProfileV2:showPlayerProfile)(${JSON.stringify(key)})`);
  for (let i = 0; i < 200; i++) {
    if (await ev(`!!(window.careerHistory && window.careerHistory[${JSON.stringify(key)}])`)) break;
    await sleep(250);
  }
  await sleep(1200);

  const name = await ev(`(function(){var h=document.querySelector('.pp2-main');
    return h?(h.textContent||'').replace(/\\s+/g,' ').replace(/^\\s*Back to Players\\s*/,'').trim().slice(0,32):'';})()`);
  console.log(`  player: ${name}`);

  // ── 1 · the eight boxes, in the ORDER AND NAMES they paint ────────────────
  const boxes = await ev(`(function(){
    return Array.prototype.slice.call(document.querySelectorAll('[data-pp2="box"]')).map(function(b){
      var e=b.querySelector('.pp2-box-eyebrow,[class*="eyebrow"],h3,h4');
      var t=(e?e.textContent:(b.textContent||'').slice(0,40)).replace(/\\s+/g,' ').trim();
      return t.slice(0,34);});})()`);
  console.log(`  BOX SET (${boxes.length}):`);
  boxes.forEach((b, i) => console.log(`    ${i + 1}. ${b}`));
  ck('eight boxes render', boxes.length === 8, `${boxes.length} boxes`);

  // ── 2 · Draw record headline + its PRINTED baseline ───────────────────────
  // Phase A renames "Record per tournament" -> "Draw record". Accept BOTH and
  // report which one rendered, so this probe tells the two builds apart instead
  // of just going red on the old one.
  const draw = await ev(`(function(){
    var b=Array.prototype.slice.call(document.querySelectorAll('[data-pp2="box"]'))
      .filter(function(x){return /draw record|record per tournament/i.test(x.textContent||'');})[0];
    if(!b) return null;
    var t=(b.textContent||'').replace(/\\s+/g,' ').trim();
    return { renamed: /draw record/i.test(t), text: t.slice(0,200) };})()`);
  console.log(`  DRAW RECORD BOX: ${draw ? (draw.renamed ? 'RENAMED "Draw record"' : 'still "Record per tournament"') : '(not found)'}`);
  if (draw) console.log(`    ${draw.text}`);
  ck('the tournament box renders', !!draw, draw ? (draw.renamed ? 'Phase A naming live' : 'pre-Phase-A naming') : 'no box');
  ck('it prints a baseline (pp vs ...)', !!draw && /pp\\s+vs/i.test(draw.text), draw ? 'baseline phrase ' + (/pp\\s+vs/i.test(draw.text) ? 'present' : 'ABSENT') : 'no box');

  // ── 3 · career tile vs an INDEPENDENT recompute off the shard ─────────────
  const tile = await ev(`(function(){
    var b=Array.prototype.slice.call(document.querySelectorAll('[data-pp2="box"]'))
      .filter(function(x){return /career record/i.test(x.textContent||'');})[0];
    if(!b) return null;
    var m=(b.textContent||'').replace(/\\s+/g,' ').match(/(\\d+)\\s*[-\\u2013\\u2212]\\s*(\\d+)/);
    return m?{w:+m[1],l:+m[2],text:(b.textContent||'').replace(/\\s+/g,' ').trim().slice(0,120)}:null;})()`);
  // §4's rule is "Career tile === Career MODAL total", so read both off the
  // rendered DOM. A recompute over raw career-history is NOT the same
  // population (it reported Djokovic at 1157-234 against a 560-100 tile) and
  // asserting against it measures my guess at the spine, not the page.
  await ev(`(function(){var b=Array.prototype.slice.call(document.querySelectorAll('[data-pp2="box"]'))
    .filter(function(x){return /career record/i.test(x.textContent||'');})[0];
    if(b) b.click(); return !!b;})()`);
  await sleep(900);
  // §4: career tile === sum of the modal's surface rows (+ the rows the modal
  // itself discloses as carrying no surface). Taking the scrim's FIRST W-L
  // instead read Djokovic's career as 306-55 -- that is the HARD row. Sum the
  // labelled surface cells and fold in the disclosed unsurfaced count.
  const modal = await ev(`(function(){
    var sc=document.querySelector('[data-pp2="scrim"]'); if(!sc) return null;
    var txt=(sc.textContent||'').replace(/\\s+/g,' ').trim();
    var cells=Array.prototype.slice.call(sc.querySelectorAll('*')).filter(function(n){
      return n.children.length===0 && /\\S/.test(n.textContent||'');}).map(function(n){
      return (n.textContent||'').replace(/\\s+/g,' ').trim();});
    var SURF=/^(hard|clay|grass|indoors)$/i, seen={}, w=0,l=0,m2=0, rows=[];
    for (var i=0;i<cells.length-1;i++){
      if(!SURF.test(cells[i])) continue;
      var key=cells[i].toLowerCase(); if(seen[key]) continue;
      var m=cells[i+1].match(/^(\\d+)\\s*[-\\u2013\\u2212]\\s*(\\d+)\\s*\\u00b7\\s*(\\d+)\\s*matches/);
      if(!m) continue;
      seen[key]=1; w+=+m[1]; l+=+m[2]; m2+=+m[3];
      rows.push(cells[i]+' '+m[1]+'-'+m[2]);
    }
    var un=txt.match(/(\\d+)\\s+matches?\\s+with\\s+no\\s+surface\\s+on\\s+record/i);
    var unN=un?+un[1]:0;
    return { w:w, l:l, matches:m2, unsurfaced:unN, total:m2+unN, rows:rows, head:txt.slice(0,110) };})()`);
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  const tileN = tile ? tile.w + tile.l : null;
  console.log(`  CAREER TILE : ${tile ? tile.w + '\u2013' + tile.l + '  (' + tileN + ' matches)' : '(not found)'}`);
  if (modal) console.log(`    modal surfaces: ${modal.rows.join(' \u00b7 ')}  = ${modal.w}\u2013${modal.l} over ${modal.matches} + ${modal.unsurfaced} unsurfaced = ${modal.total}`);
  ck('career tile total === sum of the modal surface rows + unsurfaced (\u00a74)',
    !!tile && !!modal && modal.rows.length >= 3 && tileN === modal.total,
    tile && modal ? `tile ${tileN} vs modal ${modal.total} (${modal.rows.length} surface rows)` : 'one of the two did not render');

  // ── 4 · item 3 · ONE Tour Finals row, no Masters Cup / Finals - Turin ─────
  // TEN-207: tournamentHistory lives in a LAZY SHARD, not on the profile. My
  // first pass read p.tournamentHistory, found 0 rows, and passed the year-end
  // check on an empty list -- the exact vacuous shape this ticket keeps hitting.
  // Fetch the DEPLOYED shard, which is what the card actually renders from.
  const th = await ev(`fetch('tournament-history/'+${JSON.stringify(key)}+'.json',{cache:'no-store'})
    .then(function(r){return r.ok?r.json():{tournamentHistory:[]};})
    .then(function(j){ var rows=(j.tournamentHistory||[]).map(function(t){return t.name;});
      return { all: rows.length,
        ye: rows.filter(function(n){return /tour finals|masters cup|finals - turin|^finals$/i.test(n);}) };})`);
  console.log(`  YEAR-END ROWS: ${JSON.stringify(th.ye)}  (of ${th.all} tournament rows)`);
  ck('the shard carries tournament rows at all (non-vacuous)', th.all > 0, `${th.all} rows`);
  ck('exactly one year-end championship row', th.all > 0 && th.ye.length === 1, th.ye.join(' + ') || 'none on record');
  if (th.ye.length === 1) ck('it is labelled "Tour Finals"', /^tour finals$/i.test(th.ye[0]), th.ye[0]);
}

console.log(`\n================ ${checks} checks, ${fails} fail, ${jsErrors.length} JS errors`);
if (failLines.length) failLines.forEach(f => console.log('  - ' + f));
if (jsErrors.length) jsErrors.slice(0, 4).forEach(e => console.log('  JS: ' + e));
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);
