#!/usr/bin/env node
// TEN-225 — MUTATION proof for the Underway-chip removal.
//
// A plain read of the deployed board proves nothing today: it holds zero
// started-but-scoreless fixtures, so "0 chips" is what the OLD build returns
// too. So we manufacture the state the chip existed for — push one fixture's
// startTs into the past and re-render — and assert the chip still does not
// appear, while the same mutation on the old build DOES produce it.
//
//   node ten225-underway-mutation-probe.mjs <url>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const URL_ = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9701 + (process.pid % 200);
const profile = fs.mkdtempSync(os.tmpdir() + '/ten225-mut-');
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1400,1200',
], { stdio: 'ignore' });

async function target() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const t = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (t) return t;
    } catch {}
    await sleep(200);
  }
  throw new Error('no CDP target');
}

const t = await target();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(ex.exception?.description || JSON.stringify(ex));
  return r.result?.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const U = { uid:'probe', email:'probe@local', emailVerified:true, displayName:'Probe' };
    const STUB = { ready: Promise.resolve(U), currentUser: () => U, whenAuthReady: () => Promise.resolve(U),
      requireVerified: () => Promise.resolve(U), requireAuth: () => Promise.resolve(U),
      onAuthChange: (cb) => { try { cb && cb(U); } catch {} return () => {}; },
      isValidEmail: () => true, updateProfile: () => Promise.resolve(U), NOTIF: {} };
    Object.defineProperty(window, 'BSP', { value: STUB, writable: false, configurable: false });
  })()`,
});
await send('Page.navigate', { url: URL_ + '#Matches' });

const deadline = Date.now() + 45000;
let n = 0;
while (Date.now() < deadline) {
  n = await evalJs(`document.querySelectorAll('article.mx-match').length`) || 0;
  if (n > 0) break;
  await sleep(400);
}
if (!n) { console.error('FAIL: no cards painted'); process.exit(1); }
await sleep(800);

const before = await evalJs(`(() => {
  const cards=[...document.querySelectorAll('article.mx-match:not(.cmpl)')];
  return { cards: cards.length, chips: document.querySelectorAll('.mc-underway').length,
           heights: [...new Set(cards.map(c=>Math.round(c.getBoundingClientRect().height)))].sort((a,b)=>a-b) };
})()`);

// MUTATE: take the first painted upcoming card's fixture out of `matches`
// (let-scoped, so a bare identifier — it is NOT on window) and move its start
// one hour into the past, with no final score. That is exactly the predicate
// the removed chip fired on. Then re-render through the real renderer.
const mutated = await evalJs(`(() => {
  const card = document.querySelector('article.mx-match:not(.cmpl)');
  if (!card) return { ok:false, why:'no upcoming card' };
  const id = card.dataset.id;
  const m = matches.find(x => String(x.id) === String(id));
  if (!m) return { ok:false, why:'fixture not found in matches for id '+id };
  const past = new Date(Date.now() - 3600*1000).toISOString();
  m.startTs = past; delete m.finalScore; m.live = false; m.retired = false; m.walkover = false;
  renderMatches();
  return { ok:true, id, who:(m.p1||'?')+' v '+(m.p2||'?'), startTs: past };
})()`);
if (!mutated.ok) { console.error('FAIL: mutation could not be applied —', mutated.why); process.exit(1); }
await sleep(700);

const after = await evalJs(`(() => {
  const cards=[...document.querySelectorAll('article.mx-match:not(.cmpl)')];
  const tgt = document.querySelector('article.mx-match[data-id="${mutated.id}"]');
  const hs = cards.map(c=>Math.round(c.getBoundingClientRect().height));
  return {
    cards: cards.length,
    chips: document.querySelectorAll('.mc-underway').length,
    chipText: (document.querySelector('.mc-underway')||{}).textContent || null,
    scorelines: document.querySelectorAll('article.mx-match:not(.cmpl) .mc-scoreline').length,
    targetHeight: tgt ? Math.round(tgt.getBoundingClientRect().height) : null,
    targetHasScoreline: tgt ? !!tgt.querySelector('.mc-scoreline') : null,
    distinctHeights: [...new Set(hs)].sort((a,b)=>a-b),
  };
})()`);

console.log(JSON.stringify({ url: URL_, before, mutatedFixture: mutated, after }, null, 2));
ws.close(); chrome.kill();
process.exit(0);
