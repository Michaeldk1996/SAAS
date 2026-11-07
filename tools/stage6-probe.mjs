#!/usr/bin/env node
// Stage 6 (2026-11-07) — byte-identical gate for the player-profiles.json split.
//
// Renders every surface that reads a player profile, in two builds of the page, over ONE frozen copy of the
// deployed data, and diffs every visible text node and every clickable label. Run by hand before each land:
//
//   node tools/stage6-probe.mjs --old <tree> --new <tree> [--out dir] [--mirror dir] [--mutate]
//
//   <tree>    a checkout / `git archive` of the code to serve (old = origin/main, new = the step's commit)
//   --mirror  disk cache of the deployed site (default ~/.stennisfy/stage6-mirror); filled on first use
//   --mutate  CONTROL: the NEW side's profile-roster.json gets one player's name changed — the diff must show it
//
// How it stays deterministic: every off-site request is failed (Supabase, Firebase, fonts, Fly), the data is the
// mirror (same bytes for both sides), the clock is frozen at the mirror's build time (and advances from page load),
// the zone is Europe/Berlin, and auth.js gets a signed-in Pro user appended. profile-roster.json is generated from the
// mirror's own player-profiles.json with the pipeline's profileRoster(), so it always matches that store.
// Exit 0 = 0 differing nodes; 1 = differences (listed); 2 = a surface failed to render.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OLD = opt('--old'), NEW = opt('--new');
const OUT = path.resolve(opt('--out', path.join(os.tmpdir(), 'stage6-probe-out')));
const MIRROR = path.resolve(opt('--mirror', path.join(os.homedir(), '.stennisfy', 'stage6-mirror')));
const MUTATE = args.includes('--mutate');
const ONLY = opt('--only') ? new Set(opt('--only').split(',')) : null;
const LIVE = 'https://michaeldk1996.github.io/SAAS/';
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!OLD || !NEW) { console.error('usage: --old <tree> --new <tree>'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(MIRROR, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- the data mirror (one copy, shared by both sides)
const inflight = new Map();
async function mirrorGet(rel) {
  const file = path.join(MIRROR, rel);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  if (fs.existsSync(file + '.404')) return null;
  if (inflight.has(rel)) return inflight.get(rel);
  const p = (async () => {
    for (let a = 0; a < 3; a++) {
      try {
        const r = await fetch(LIVE + rel);
        if (r.status === 404) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.404', ''); return null; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const b = Buffer.from(await r.arrayBuffer());
        fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, b); return b;
      } catch (e) { await sleep(800); }
    }
    return null;
  })();
  inflight.set(rel, p); try { return await p; } finally { inflight.delete(rel); }
}

const req = createRequire(import.meta.url);
async function rosterFor(mutate) {
  const pp = await mirrorGet('player-profiles.json');
  const store = JSON.parse(pp.toString('utf8'));
  // the pipeline's own builder, from the NEW tree (it may not exist on the old one)
  const { profileRoster } = req(path.join(path.resolve(NEW), 'bsp-pipeline.js'));
  const r = profileRoster(store);
  if (mutate) { const k = Object.keys(r.players).find(x => r.players[x].name === 'C. Alcaraz') || Object.keys(r.players)[0]; r.players[k] = { ...r.players[k], name: r.players[k].name + ' MUTANT' }; }
  return Buffer.from(JSON.stringify(r));
}

const AUTH_TAIL = `
;(function(){ var U = { uid: 'probe', email: 'probe@example.test', name: 'Probe User', plan: 'pro', emailVerified: true, favouriteMatches: [] };
  var B = window.BSP; if (!B) return;
  B.ready = function(){ return Promise.resolve(); };
  B.whenAuthReady = function(){ return Promise.resolve(U); };
  B.requireAuth = function(){ return Promise.resolve(U); };
  B.requireVerified = function(){ return Promise.resolve(U); };
  B.currentUser = function(){ return U; };
  B.authResolved = function(){ return true; };
  B.onAuthChange = function(cb){ setTimeout(function(){ try { cb(U); } catch(e){} }, 0); return function(){}; };
  B.updateProfile = function(){ return Promise.resolve(U); };
})();`;

const CODE_EXT = /\.(html|js|mjs|css|png|svg|webp|woff2?|ico|jpg)$/i;
function serve(tree, side) {
  const root = path.resolve(tree), seen = [];
  const srv = http.createServer(async (rq, rs) => {
    let rel = decodeURIComponent(new URL(rq.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    if (rel === 'index.html') rel = 'bsp-consult-dashboard.html';
    seen.push(rel);
    let body = null;
    const local = path.join(root, rel);
    if (rel === 'profile-roster.json') body = await rosterFor(MUTATE && side === 'new');
    else if (CODE_EXT.test(rel) && fs.existsSync(local) && fs.statSync(local).isFile()) {
      body = fs.readFileSync(local);
      if (rel === 'auth.js') body = Buffer.concat([body, Buffer.from(AUTH_TAIL)]);
    } else body = await mirrorGet(rel);
    if (!body) { rs.writeHead(404); rs.end(); return; }
    const type = rel.endsWith('.html') ? 'text/html' : rel.endsWith('.js') || rel.endsWith('.mjs') ? 'text/javascript'
      : rel.endsWith('.json') ? 'application/json' : rel.endsWith('.css') ? 'text/css' : rel.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
    rs.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); rs.end(body);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port, seen })));
}

// ---------- minimal CDP client
async function launch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage6-chrome-'));
  const ch = spawn(CHROME, ['--headless=new', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1512,982', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((res, rej) => {
    let buf = ''; ch.stderr.on('data', d => { buf += d; const m = buf.match(/ws:\/\/[^\s]+/); if (m) res(m[0]); });
    setTimeout(() => rej(new Error('chrome did not start')), 20000);
  });
  return { ch, dir, port: new URL(wsUrl).port };
}
async function newTarget(port) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pend = new Map(), handlers = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method) handlers.forEach(h => h(m));
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  return { send, on: h => handlers.push(h), close: async () => { try { await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`); } catch (e) {} ws.close(); } };
}

const FROZEN = (() => { try { return Date.parse(JSON.parse(fs.readFileSync(path.join(MIRROR, 'build-info.json'), 'utf8')).data.builtAt); } catch (e) { return NaN; } })();
const PRELUDE = (frozen) => `(() => {
  const R = Date, t0 = R.now(), base = ${frozen};
  const now = () => base + (R.now() - t0);
  class D extends R { constructor(...a) { if (a.length) super(...a); else super(now()); } static now() { return now(); } }
  window.Date = D;
  window.__pf = 0; window.__mut = performance.now();
  const f = window.fetch; window.fetch = function(...a){ window.__pf++; return f.apply(this, a).finally(() => { window.__pf--; window.__mut = performance.now(); }); };
  new MutationObserver(() => { window.__mut = performance.now(); }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  try { localStorage.setItem('stennisfy-theme', 'night'); } catch (e) {}
})();`;

async function openPage(port, origin) {
  const p = await newTarget(port);
  await p.send('Page.enable'); await p.send('Runtime.enable');
  await p.send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Berlin' });
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1512, height: 982, deviceScaleFactor: 1, mobile: false });
  await p.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  p.on(m => {
    if (m.method !== 'Fetch.requestPaused') return;
    const u = m.params.request.url;
    if (u.startsWith(origin) || u.startsWith('data:')) p.send('Fetch.continueRequest', { requestId: m.params.requestId }).catch(() => {});
    else p.send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
  });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: PRELUDE(FROZEN) });
  return p;
}
async function evalJs(p, expr) {
  const r = await p.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r.result.value;
}
async function settle(p, maxMs = 25000) {
  const t = Date.now();
  while (Date.now() - t < maxMs) {
    const s = await evalJs(p, '({ pf: window.__pf, quiet: performance.now() - window.__mut })');
    if (s.pf === 0 && s.quiet > 1500) return true;
    await sleep(250);
  }
  return false;
}
const CAPTURE = (sel) => `(() => {
  const root = ${sel ? `document.querySelector(${JSON.stringify(sel)})` : 'document.body'};
  if (!root) return null;
  const vis = e => { const s = getComputedStyle(e); return e.getClientRects().length > 0 && s.visibility !== 'hidden'; };   // on screen: a hidden ancestor hides it too
  const text = root.innerText.split('\\n').map(x => x.trim()).filter(Boolean);
  const clicks = [...root.querySelectorAll('[onclick],a[href],[role=button]')].filter(vis).map(e => 'CLICK ' + e.textContent.replace(/\\s+/g, ' ').trim().slice(0, 80)).filter(x => x !== 'CLICK ');
  const figs = [...root.querySelectorAll('[data-aotip],[title]')].filter(vis).map(e => 'TIP ' + (e.getAttribute('data-aotip') || e.getAttribute('title') || '').replace(/\\s+/g, ' ').slice(0, 160));
  return text.concat(clicks, figs);
})()`;

// ---------- the surfaces
async function surfaces(origin, port) {
  const p0 = await openPage(port, origin);
  await p0.send('Page.navigate', { url: origin + '/' });
  await sleep(1500); await settle(p0, 40000);
  const meta = await evalJs(p0, `(() => {
    const ms = (typeof matches !== 'undefined' ? matches : []).filter(m => m && m.p1Key != null && m.p2Key != null);
    const up = ms.filter(m => !m.finalScore).slice(0, 4), done = ms.filter(m => m.finalScore).slice(0, 3);
    const roster = Object.keys((typeof playerProfiles !== 'undefined' && playerProfiles) || {});
    const idx = (typeof playerIndex !== 'undefined' ? playerIndex : []).filter(r => r.hasProfile).map(r => String(r.key));
    return { ids: up.concat(done).map(m => m.id), roster, idx, boardKeys: ms.flatMap(m => [String(m.p1Key), String(m.p2Key)]) };
  })()`);
  await p0.close();
  return meta;
}

function plan(meta) {
  const pinned = ['2382', '1980', '1905', '67'];
  const pick = (arr, n, skip) => arr.filter(k => !skip.has(k)).sort().filter((_, i, a) => i % Math.max(1, Math.floor(a.length / n)) === 0).slice(0, n);
  const roster = new Set(meta.roster);
  const eagerS = pick(meta.roster, 8, new Set(pinned));
  const nonEager = pick(meta.idx.filter(k => !roster.has(k)), 4, new Set());
  const players = [...new Set([...pinned, ...eagerS, ...nonEager])];
  const S = [];
  for (const tab of ['matches', 'results', 'players', 'news', 'styles', 'tournaments', 'database', 'drops', 'trading', 'series', 'edge', 'live', 'entry-lists'])
    S.push({ name: 'page-' + tab, js: `document.querySelector('[data-tab="${tab}"]') && document.querySelector('[data-tab="${tab}"]').click()` });
  S.push({ name: 'players-search-zve', js: `document.querySelector('[data-tab="players"]').click(); setTimeout(() => { const i = document.querySelector('#playerSearch, input[type=search]'); if (i) { i.value = 'zve'; i.dispatchEvent(new Event('input', { bubbles: true })); } }, 600)` });
  const ATABS = ['key', 'odds', 'overview', 'form', 'h2h', 'tournament', 'progression', 'style', 'marketedge', 'matchstats', 'news', 'weather'];
  for (const id of meta.ids) for (const t of ATABS)
    S.push({ name: `modal-${id}-${t}`, group: 'modal-' + id, sel: '#analysisModal', js: `openAnalysisModal(${JSON.stringify(id)}, ${JSON.stringify(t)})` });
  for (const k of players)
    S.push({ name: `profile-${k}`, js: `document.querySelector('[data-tab="players"]').click(); setTimeout(() => psOpenProfile(${JSON.stringify(k)}), 400)` });
  const pairs = [['2382', '1980'], ['1905', '67'], [meta.boardKeys[0], meta.boardKeys[1]], [eagerS[0], nonEager[0]], [nonEager[1], nonEager[2]]].filter(x => x[0] && x[1]);
  for (const [a, b] of pairs)
    S.push({ name: `h2hpage-${a}-${b}`, js: `document.querySelector('[data-tab="h2h"]').click(); setTimeout(() => { const d = H2HPage._debug(); d.state.aSel = ${JSON.stringify(a)}; d.state.bSel = ${JSON.stringify(b)}; H2HPage.render(); }, 1500)` });
  return ONLY ? S.filter(s => [...ONLY].some(o => s.name.startsWith(o))) : S;
}

async function runSide(tree, side, S, port) {
  const { srv, port: sp, seen } = await serve(tree, side);
  const origin = `http://127.0.0.1:${sp}`;
  const out = {}, nets = {};
  // surfaces sharing a `group` (one match's twelve tabs) share one page load; every other surface gets a fresh one
  let p = null, curGroup = null;
  for (const s of S) {
    try {
      if (!p || !s.group || s.group !== curGroup) {
        if (p) await p.close();
        p = await openPage(port, origin); curGroup = s.group || null;
        await p.send('Page.navigate', { url: origin + '/' });
        await sleep(1200); await settle(p, 40000);
      }
      const before = seen.length;
      await evalJs(p, s.js);
      await sleep(700); const ok = await settle(p, 60000);
      out[s.name] = (await evalJs(p, CAPTURE(s.sel))) || ['<<no root>>'];
      if (!ok) out[s.name].push('<<did not settle>>');
      nets[s.name] = seen.slice(before);
    } catch (e) { out[s.name] = ['<<error ' + e.message + '>>']; if (p) { await p.close(); p = null; } }
    if (!s.group && p) { await p.close(); p = null; }
    process.stdout.write('.');
  }
  if (p) await p.close();
  srv.close();
  return { out, nets };
}

(async () => {
  const { ch, dir, port } = await launch();
  try {
    await mirrorGet('build-info.json');
    if (!Number.isFinite(FROZEN)) console.log('note: no build-info.json data.builtAt in the mirror yet; re-run to freeze the clock');
    const meta = await surfaces(`http://127.0.0.1:${(await serve(OLD, 'old')).port}`, port).catch(async () => surfaces(`http://127.0.0.1:${(await serve(OLD, 'old')).port}`, port));
    const S = plan(meta);
    console.log(`surfaces: ${S.length} (roster ${meta.roster.length}, board matches ${meta.ids.length})`);
    const O = await runSide(OLD, 'old', S, port); console.log(' old done');
    const N = await runSide(NEW, 'new', S, port); console.log(' new done');
    let diffs = 0, broken = 0; const report = [];
    for (const s of S) {
      const a = O.out[s.name], b = N.out[s.name];
      if (a.some(x => /^<<(error|no root)/.test(x)) || b.some(x => /^<<(error|no root)/.test(x))) broken++;
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      diffs++;
      const sa = new Set(a), sb = new Set(b);
      report.push(`## ${s.name}\n- old only: ${a.filter(x => !sb.has(x)).slice(0, 12).join(' | ')}\n+ new only: ${b.filter(x => !sa.has(x)).slice(0, 12).join(' | ')}` +
        (a.length === b.length && a.filter(x => !sb.has(x)).length === 0 ? '\n(order only)' : ''));
    }
    const nodes = S.reduce((t, s) => t + O.out[s.name].length, 0);
    const ppNew = Object.entries(N.nets).filter(([, v]) => v.includes('player-profiles.json')).map(([k]) => k);
    const ppOld = Object.entries(O.nets).filter(([, v]) => v.includes('player-profiles.json')).length;
    fs.writeFileSync(path.join(OUT, 'old.json'), JSON.stringify(O, null, 1));
    fs.writeFileSync(path.join(OUT, 'new.json'), JSON.stringify(N, null, 1));
    fs.writeFileSync(path.join(OUT, 'report.md'), report.join('\n\n'));
    console.log(`\n${S.length} surfaces, ${nodes} captured nodes (old side); ${diffs} surface(s) differ; ${broken} broken`);
    console.log(`player-profiles.json requested: old ${ppOld}/${S.length} surfaces, new ${ppNew.length}/${S.length}`);
    if (diffs) console.log(report.slice(0, 6).join('\n\n'));
    console.log('report: ' + path.join(OUT, 'report.md'));
    process.exitCode = broken ? 2 : diffs ? 1 : 0;
  } finally { ch.kill(); setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }, 1500); }
})();
