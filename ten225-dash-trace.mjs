// TEN-225 ruling 4 — WHY those fixtures dash. Traced through the page's own
// resolvers, one rung of the ladder at a time, so the answer names a function
// rather than a theory.
import { setTimeout as sleep } from 'node:timers/promises';

const PAGE = 'https://michaeldk1996.github.io/SAAS/bsp-consult-dashboard.html';
const DATA = process.env.PAPERCLIP_RUN_SCRATCH_DIR || '/tmp';
const AUTH_STUB = `
(function(){
  const user = { uid:'probe', email:'p@e.com', emailVerified:true, displayName:'P' };
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
  const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--remote-debugging-port=0', '--no-first-run',
     '--no-default-browser-check', '--disable-gpu',
     '--user-data-dir=' + DATA + '/ten225-trace-chrome', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  let wsUrl = null;
  proc.stderr.on('data', d => { const m = /ws:\/\/[^\s]+/.exec(String(d)); if (m && !wsUrl) wsUrl = m[0]; });
  for (let i = 0; i < 120 && !wsUrl; i++) await sleep(100);
  if (!wsUrl) { proc.kill(); throw new Error('no CDP endpoint'); }
  const port = new URL(wsUrl).port;
  let pageWs = null;
  for (let i = 0; i < 60 && !pageWs; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const pg = list.find(t => t.type === 'page');
      if (pg) pageWs = pg.webSocketDebuggerUrl;
    } catch (e) {}
    if (!pageWs) await sleep(200);
  }
  const ws = new WebSocket(pageWs);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiting = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  await sleep(400);
  return {
    send: (m, p = {}) => new Promise(res => { const i = ++id; waiting.set(i, x => res(x.result || {})); ws.send(JSON.stringify({ id: i, method: m, params: p })); }),
    close: () => { try { ws.close(); } catch (e) {} proc.kill(); },
  };
}

const c = await cdp();
try {
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Network.setCacheDisabled', { cacheDisabled: true });
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: AUTH_STUB });
  await c.send('Page.navigate', { url: PAGE + '?cb=trace' + Date.now() });
  const ev = async e => {
    const r = await c.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r && r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 900));
    return r && r.result ? r.result.value : undefined;
  };
  for (let i = 0; i < 240; i++) { if (await ev('document.querySelectorAll(".mx-match").length||0')) break; await sleep(500); }
  // Hunt the subjects across views and day tabs — a card the default view does
  // not paint is not a card that dashes, it is a card we did not look at.
  const seen = await ev(`(() => {
    const want = ['upcoming-12164261','upcoming-12164262','past-12163987','past-12164255','past-12164069'];
    const hit = {};
    const tabs = [...document.querySelectorAll('[data-view],[data-day],.mx-tab,.mx-daytab,button')];
    for (const t of tabs) {
      try { t.click(); } catch(e) { continue; }
      for (const w of want) if (document.querySelector('[data-id="' + w + '"]')) hit[w] = (t.textContent||'').trim().slice(0,24) || t.className;
    }
    return JSON.stringify(hit);
  })()`);
  console.log('subject reachable on tab: ' + seen + '\n');

  const out = await ev(`(async () => {
    const ms = await fetch('./matches.json?cb='+Date.now()).then(r=>r.json());
    const want = ['upcoming-12164261','upcoming-12164262','past-12163987','past-12164255','past-12164069'];
    const L = [];
    for (const id of want) {
      const m = ms.find(x => x.id === id); if (!m) { L.push({id, missing:true}); continue; }
      const t = { id, p1: m.p1, p2: m.p2, done: !!m.finalScore };
      const tryIt = (name, fn) => { try { t[name] = fn(); } catch (e) { t[name] = 'THREW: ' + e.message; } };
      tryIt('_ocsOf',        () => { const o = _ocsOf(m); return o ? JSON.parse(JSON.stringify(o)) : null; });
      tryIt('_mcBet365Now',  () => _mcBet365Now(m));
      tryIt('_mcAnyBookPair',() => _mcAnyBookPair(m));
      tryIt('nowP1',         () => _mcNowOf(m, 'p1'));
      tryIt('nowP2',         () => _mcNowOf(m, 'p2'));
      tryIt('openP1',        () => _openAnchorOf(m, 'p1'));
      tryIt('closeP1',       () => (typeof _mcCloseOf === 'function' ? _mcCloseOf(m, 'p1') : 'n/a'));
      tryIt('_mcNowPair',    () => { const r = _mcNowPair(m); return r ? JSON.parse(JSON.stringify(r)) : null; });
      // What a MEMBER actually sees: find the card in the DOM and read its cells.
      // Land on the tab that actually paints this card before reading it.
      if (!document.querySelector('[data-id="' + id + '"]')) {
        for (const tab of [...document.querySelectorAll('[data-view],[data-day],.mx-tab,.mx-daytab,button')]) {
          try { tab.click(); } catch (e) { continue; }
          if (document.querySelector('[data-id="' + id + '"]')) break;
        }
      }
      const card = document.querySelector('[data-id="' + id + '"]');
      t.onScreen = !!card;
      if (card) {
        t.cells = [...card.querySelectorAll('.mc-odds')].map(n => n.textContent.trim());
        t.titles = [...card.querySelectorAll('[title]')].map(n => n.getAttribute('title')).filter(x => x && x.indexOf('\u00b7') >= 0);
      }
      L.push(t);
    }
    return JSON.stringify(L, null, 1);
  })()`);
  console.log(out);
} finally { c.close(); }
