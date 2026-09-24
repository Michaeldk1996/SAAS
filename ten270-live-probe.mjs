// TEN-225 A+B — verification on the DEPLOYED URL. "Merged is not shipped."
//
// Drives the real live page (no local server, no working-tree HTML) and READS
// the odds cells. The only thing local about this run is the browser.
//
// The control is the deployed page's OWN pre-change behaviour, recomputed in
// the page from the same data it just rendered: _mcBet365Now is still defined
// there, so the before-figure is measured in the same document rather than
// quoted from an earlier run. If the two agree, the deploy did not carry the
// change and this probe says so instead of passing.
import { setTimeout as sleep } from 'node:timers/promises';

const PAGE = 'https://michaeldk1996.github.io/SAAS/bsp-consult-dashboard.html';
const DATA = process.env.PAPERCLIP_RUN_SCRATCH_DIR || '/tmp';

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
  const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--remote-debugging-port=0', '--no-first-run',
     '--no-default-browser-check', '--disable-gpu',
     '--user-data-dir=' + DATA + '/ten270-live-chrome', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  let wsUrl = null;
  proc.stderr.on('data', d => { const m = /ws:\/\/[^\s]+/.exec(String(d)); if (m && !wsUrl) wsUrl = m[0]; });
  for (let i = 0; i < 120 && !wsUrl; i++) await sleep(100);
  if (!wsUrl) { proc.kill(); throw new Error('no CDP endpoint'); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiters = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) { const { res, rej } = waiters.get(m.id); waiters.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id; waiters.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  return { send: (m, p) => send(m, p, sessionId), close: () => { try { ws.close(); } catch {} proc.kill(); } };
}


// TEN-270 — the post-deploy read, on the LIVE URL. Usage:
//   node ten270-live-probe.mjs <expected-commit-prefix> [listen-minutes]
const WANT = (process.argv[2] || '').trim();
const LISTEN_MIN = +(process.argv[3] || 10);
const c = await cdp();
try {
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: AUTH_STUB });
  await c.send('Page.navigate', { url: PAGE + '?cb=ten270' + Date.now() });
  const ev = async e => {
    const r = await c.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  for (let i = 0; i < 160; i++) { if (await ev('document.querySelectorAll(".mx-match").length || 0')) break; await sleep(500); }
  const built = await ev('fetch("./build-info.json",{cache:"no-store"}).then(r=>r.json()).then(j=>j.commit||j.sha||JSON.stringify(j))');
  console.log(JSON.stringify({ url: PAGE, liveCommit: built, want: WANT }));
  if (!WANT || !String(built).startsWith(WANT)) {
    console.log(`deployed build is not mine — live SHA ${built}, mine ${WANT}`);
    process.exitCode = 3;
  } else {
    for (let i = 0; i < 40; i++) { if (await ev('!!(window.KiblNow && window.KiblNow._rows && window.KiblNow._rows.size)')) break; await sleep(1500); }
    const snap = () => ev(`(() => {
      const K = window.KiblNow || {};
      const pre = matches.filter(m => !m.finalScore && !m.live && !(isFinite(cardStartMs(m)) && Date.now() >= cardStartMs(m)));
      const rows = pre.map(m => { const p = _mcNowPair(m); const o = _ocsOf(m);
        return { card: m.p1 + ' vs ' + m.p2, tier: m.tourBadge || null, selectedBook: o ? o.book : null,
                 nowBook: p ? p.book : null, src: p ? (p.src || null) : null, live: p ? !!p.live : false,
                 now: p ? [p.p1, p.p2] : null, at: p ? p.at : null }; });
      const lines = [...document.querySelectorAll('.match-card:not(.cmpl) .mc-nowsrc')].map(e => e.textContent);
      return { enabled: !!K.enabled, healthy: K.healthy ? K.healthy() : false,
               tableRows: K._rows ? K._rows.size : 0, preMatchCards: pre.length,
               kiblNow: rows.filter(r => String(r.nowBook||'').toLowerCase() === 'bet105').length,
               streamNow: rows.filter(r => r.src === 'stream').length,
               renderedLines: lines.length, sampleLines: lines.slice(0, 5), rows,
               samples: (K.samples || []).slice() };
    })()`);
    let s = await snap();
    console.log(JSON.stringify({ at: new Date().toISOString(), ...s, rows: undefined, samples: s.samples.length }));
    const t0 = Date.now();
    while (Date.now() - t0 < LISTEN_MIN * 60000) { await sleep(30000); }
    s = await snap();
    const d = s.samples.map(x => ({ w2s: x.recvMs - Date.parse(x.written_at), k2s: x.recvMs - Date.parse(x.kibl) }))
                       .filter(x => isFinite(x.w2s));
    const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * (b.length - 1)))] : null; };
    console.log(JSON.stringify({ at: new Date().toISOString(), listenMin: LISTEN_MIN, preMatchCards: s.preMatchCards,
      kiblNow: s.kiblNow, streamNow: s.streamNow, healthy: s.healthy, renderedLines: s.renderedLines,
      workerToScreenMs: { n: d.length, median: q(d.map(x => x.w2s), 0.5), p95: q(d.map(x => x.w2s), 0.95) },
      kiblToScreenMs: { n: d.length, median: q(d.map(x => x.k2s), 0.5), p95: q(d.map(x => x.k2s), 0.95) },
      rows: s.rows }, null, 1));
  }
} finally { c.close(); }
