// TEN-225 rulings A + B — render probe for the card odds column.
//
// Drives the real page in headless Chrome and READS the odds cells. A count
// computed in Node proves nothing about what a member sees; only the DOM does.
//
// HYBRID SERVE (the recipe this repo already uses): the HTML comes from the
// WORKING TREE (the change under test) while matches.json and
// odds-card-state.json come from the DEPLOYED site. The data files are written
// by cron jobs, not by a push, so the committed copies are weeks stale — testing
// the new renderer against them would measure the wrong board.
//
// THE FAILING CONTROL. Every assertion below is also run against the renderer as
// it stands on origin/main, fetched into a second document. If the two agree,
// the probe is not measuring the change and says so. A probe on this codebase
// has already passed 0/0 on a known-broken build.
//
// Usage: node ten225-ab-probe.mjs
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DATA = process.env.PAPERCLIP_RUN_SCRATCH_DIR || '/tmp';
const TODAY = '2026-09-18';
// The deployed files, served in place of the committed ones.
const OVERRIDE = new Set(['/matches.json', '/odds-card-state.json']);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
                '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serve(htmlText) {
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/bsp-consult-dashboard.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(htmlText);
    }
    const file = OVERRIDE.has(url) ? path.join(DATA, path.basename(url))
                                   : path.join(HERE, url.replace(/^\/+/, ''));
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('nope'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

const AUTH_STUB = `
(function(){
  const user = { uid:'probe', email:'probe@example.com', emailVerified:true, displayName:'Probe' };
  const STUB = { ready: Promise.resolve(user), currentUser: () => user,
    whenAuthReady: () => Promise.resolve(user), requireVerified: () => Promise.resolve(user),
    requireAuth: () => Promise.resolve(user),
    onAuthChange: cb => { try { cb(user); } catch(e){} return () => {}; },
    isValidEmail: () => true, updateProfile: () => Promise.resolve(),
    NOTIF: { show(){}, hide(){} } };
  Object.defineProperty(window, 'BSP', { value: STUB, writable:false, configurable:false });
})();`;

async function cdp() {
  const { spawn } = await import('node:child_process');
  const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--no-first-run',
    '--no-default-browser-check', '--disable-gpu',
    '--user-data-dir=' + DATA + '/ten225-ab-chrome', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  let wsUrl = null;
  proc.stderr.on('data', d => { const m = /ws:\/\/[^\s]+/.exec(String(d)); if (m && !wsUrl) wsUrl = m[0]; });
  for (let i = 0; i < 120 && !wsUrl; i++) await sleep(100);
  if (!wsUrl) { proc.kill(); throw new Error('no CDP endpoint'); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiters = new Map();
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiters.has(msg.id)) {
      const { res, rej } = waiters.get(msg.id); waiters.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id; waiters.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  return { raw: send, close: () => { try { ws.close(); } catch {} proc.kill(); } };
}

async function readBoard(c, url) {
  const { targetId } = await c.raw('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await c.raw('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => c.raw(m, p, sessionId);
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: AUTH_STUB });
  await send('Page.navigate', { url });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  for (let i = 0; i < 160; i++) {
    const n = await ev('document.querySelectorAll(".mx-match").length || 0');
    if (n > 0) break;
    await sleep(500);
  }
  // Land on TODAY's upcoming board — the population both rulings are about.
  await ev(`(function(){
    if (typeof setMatchesView === 'function') setMatchesView('upcoming'); else state.view='upcoming';
    state.day = 'today'; state.sort = 'time'; renderMatches(); return true; })()`);
  await sleep(1200);
  // Read the rendered cells. .mc-odds is the price; a dash is the em dash the
  // standing rule requires, NOT a blank, so both are counted separately — a
  // blank cell would be the old Part-3d defect returning.
  return ev(`(function(){
    const out = [];
    document.querySelectorAll('.mx-match').forEach(card => {
      const names = [...card.querySelectorAll('.mc-name')].map(n => n.textContent.trim());
      const odds  = [...card.querySelectorAll('.mc-odds')].map(n => n.textContent.trim());
      out.push({ names, odds });
    });
    return { cards: out,
             ocsLoaded: typeof OCS !== 'undefined' && OCS.loaded === true,
             published: (typeof OCS !== 'undefined' && OCS.byKey) ? Object.keys(OCS.byKey).length : -1 };
  })()`);
}

const DASH = s => s === '—' || s === '-' || s === '–';
const priced = b => b.cards.filter(c => c.odds.length >= 2 && !DASH(c.odds[0]) && !DASH(c.odds[1])).length;
const blanks = b => b.cards.filter(c => c.odds.some(o => o === '')).length;

const FAIL = [];
const check = (name, cond, detail) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : '  ' + JSON.stringify(detail).slice(0, 400)}`);
  if (!cond) FAIL.push(name);
};

// ── the two documents: working tree, and origin/main as the failing control ──
const workingHtml = fs.readFileSync(path.join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const baseHtml = execFileSync('git', ['show', 'origin/main:bsp-consult-dashboard.html'],
  { cwd: HERE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const srvA = await serve(workingHtml);
const srvB = await serve(baseHtml);
const urlA = `http://127.0.0.1:${srvA.address().port}/bsp-consult-dashboard.html`;
const urlB = `http://127.0.0.1:${srvB.address().port}/bsp-consult-dashboard.html`;

const c = await cdp();
try {
  console.log(`TEN-225 A+B render probe — ${TODAY} upcoming board`);
  console.log(`  data: DEPLOYED matches.json + odds-card-state.json (${DATA})`);
  console.log('');
  const now = await readBoard(c, urlA);
  const before = await readBoard(c, urlB);

  check('odds-card-state.json loaded in BOTH documents', now.ocsLoaded && before.ocsLoaded,
        { now: now.ocsLoaded, before: before.ocsLoaded });
  check('the same board rendered in both (so the delta is the renderer, not the data)',
        now.cards.length === before.cards.length && now.cards.length > 0,
        { now: now.cards.length, before: before.cards.length });

  const pNow = priced(now), pBefore = priced(before);
  console.log('');
  console.log(`  cards on today's board            ${now.cards.length}`);
  console.log(`  BEFORE (origin/main, bet365 pin)  ${pBefore} priced / ${now.cards.length - pBefore} dashed`);
  console.log(`  AFTER  (rulings A + B)            ${pNow} priced / ${now.cards.length - pNow} dashed`);
  console.log('');

  // THE FAILING CONTROL. If these two are equal the probe is serving one build
  // twice, or the change did not reach the renderer — either way every other
  // assertion here is vacuous.
  check('CONTROL: the two builds DISAGREE, so this probe is measuring the change',
        pNow !== pBefore, { before: pBefore, after: pNow });
  check('every card that was priced before is still priced (rule B only ADDS)',
        pNow >= pBefore, { before: pBefore, after: pNow });
  check('no card renders a BLANK odds cell — missing is a dash, never blank',
        blanks(now) === 0, now.cards.filter(c => c.odds.some(o => o === '')).slice(0, 5));

  console.log('  cards that gained a price:');
  before.cards.forEach((b, i) => {
    const a = now.cards[i];
    const wasDash = !(b.odds.length >= 2 && !DASH(b.odds[0]) && !DASH(b.odds[1]));
    const isPriced = a && a.odds.length >= 2 && !DASH(a.odds[0]) && !DASH(a.odds[1]);
    if (wasDash && isPriced) console.log(`     ${a.names.join(' v ')}   ${a.odds.slice(0,2).join(' / ')}`);
  });
} finally {
  c.close(); srvA.close(); srvB.close();
}
console.log('');
if (FAIL.length) { console.log(`${FAIL.length} FAILED: ${JSON.stringify(FAIL)}`); process.exit(1); }
console.log('A+B render probe: all checks passed');
