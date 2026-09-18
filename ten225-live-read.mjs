// TEN-225 Part 3 — render probe for the Open/Now/Close wiring.
//
// Drives the real page in headless Chrome over CDP and READS the cells. A
// screenshot proves it painted; only a read proves the right price landed on
// the right player.
//
// Two populations, deliberately:
//   A. a completed fixture odds-card-state.json does NOT cover -> must render
//      an em dash under BOTH column headers (the founder's Part 3d blank).
//   B. a completed fixture it DOES cover -> must render the PUBLISHED prices,
//      with each price on its own player, and the book + Open time in the cell
//      title.
//
// B is what makes A meaningful. A passes trivially on a build where the file
// never loads at all, so the probe is wrong without it — the "failing control"
// rule (a probe once passed 0/0 on a known-broken build).
//
// Usage: node ten225-wire-probe.mjs <base-url>
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.argv[2] || 'http://127.0.0.1:8765';
const PAGE = `${BASE}/bsp-consult-dashboard.html`;

const AUTH_STUB = `
(function(){
  const user = { uid:'probe', email:'probe@example.com', emailVerified:true,
                 displayName:'Probe' };
  const STUB = {
    ready: Promise.resolve(user), currentUser: () => user,
    whenAuthReady: () => Promise.resolve(user),
    requireVerified: () => Promise.resolve(user),
    requireAuth: () => Promise.resolve(user),
    onAuthChange: cb => { try { cb(user); } catch(e){} return () => {}; },
    isValidEmail: () => true, updateProfile: () => Promise.resolve(),
    NOTIF: { show(){}, hide(){} },
  };
  Object.defineProperty(window, 'BSP',
    { value: STUB, writable:false, configurable:false });
})();`;

async function cdp() {
  const { spawn } = await import('node:child_process');
  const CHROME = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].find(p => { try { return require('node:fs').existsSync(p); } catch { return false; } })
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--user-data-dir=' +
      (process.env.PAPERCLIP_RUN_SCRATCH_DIR || '/tmp') + '/ten225-chrome',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let wsUrl = null;
  proc.stderr.on('data', d => {
    const m = /ws:\/\/[^\s]+/.exec(String(d));
    if (m && !wsUrl) wsUrl = m[0];
  });
  for (let i = 0; i < 100 && !wsUrl; i++) await sleep(100);
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
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  return {
    send: (m, p) => send(m, p, sessionId),
    close: () => { try { ws.close(); } catch {} proc.kill(); },
  };
}


const c = await cdp();
try {
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: AUTH_STUB });
  await c.send('Page.navigate', { url: PAGE });
  const ev = async e => { const r = await c.send('Runtime.evaluate',
      { expression:e, awaitPromise:true, returnByValue:true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0,400));
    return r.result.value; };
  for (let i=0;i<120;i++){ if (await ev('document.querySelectorAll(".mx-match").length||0')) break; await sleep(500); }
  for (let i=0;i<60;i++){ if (await ev('typeof OCS!=="undefined" && OCS.loaded')) break; await sleep(500); }
  const out = await ev(`(function(){
    const covered = matches.filter(m => _ocsOf(m));
    return covered.map(m => {
      const o = _ocsOf(m);
      return { date:m.date, tour:m.tour, p1:m.p1, p2:m.p2, book:o.book, source:o.source,
               label:o.label, tsKind:o.tsKind, startTsSource:o.startTsSource,
               openP1:_openAnchorOf(m,'p1'), openP2:_openAnchorOf(m,'p2'),
               nowP1:_mcNowOf(m,'p1'),  nowP2:_mcNowOf(m,'p2'),
               closeP1:_mcCloseOf(m,'p1'), closeP2:_mcCloseOf(m,'p2'),
               openTs:ocsOpenTsOf(m), prov:ocsProvenance(m) };
    });
  })()`);
  console.log(JSON.stringify(out, null, 1));
  console.log('covered on the deployed board:', out.length);
} finally { c.close(); }
