#!/usr/bin/env node
// TEN-225 — founder ruling 2026-09-18: remove the "Underway" chip from the
// Matches card, it breaks card symmetry with its neighbours.
//
// Reads the PAINTED DOM of the Matches board over CDP. Run against BOTH builds:
//   node ten225-underway-probe.mjs http://127.0.0.1:8842/_control-main.html      (control = origin/main)
//   node ten225-underway-probe.mjs http://127.0.0.1:8842/bsp-consult-dashboard.html (branch)
// The control MUST report chips > 0, otherwise a 0 on the branch proves nothing
// (a probe that cannot fail is not a probe — TEN-206 lesson).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const URL_ = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9333 + (Math.floor(process.hrtime()[1] / 1e5) % 400);
const profile = fs.mkdtempSync(os.tmpdir() + '/ten225-uw-');
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
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
// Neutralize ONLY the Firebase auth gate, before any page script runs. auth.js is
// non-strict and assigns `global.BSP = {...}`; a non-writable defineProperty makes
// that assignment a silent no-op, so requireVerified resolves instead of redirecting.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const U = { uid:'probe', email:'probe@local', emailVerified:true, displayName:'Probe' };
    const STUB = {
      ready: Promise.resolve(U), currentUser: () => U, whenAuthReady: () => Promise.resolve(U),
      requireVerified: () => Promise.resolve(U), requireAuth: () => Promise.resolve(U),
      onAuthChange: (cb) => { try { cb && cb(U); } catch {} return () => {}; },
      isValidEmail: () => true, updateProfile: () => Promise.resolve(U), NOTIF: {},
    };
    Object.defineProperty(window, 'BSP', { value: STUB, writable: false, configurable: false });
  })()`,
});
await send('Page.navigate', { url: URL_ + '#Matches' });

// wait for real cards, not just load
const deadline = Date.now() + 40000;
let n = 0;
while (Date.now() < deadline) {
  n = await evalJs(`document.querySelectorAll('article.mx-match').length`) || 0;
  if (n > 0) break;
  await sleep(400);
}
if (!n) { console.error('FAIL: no match cards painted'); process.exit(1); }
await sleep(900);

const out = await evalJs(`(() => {
  const cards = [...document.querySelectorAll('article.mx-match')];
  const chips = [...document.querySelectorAll('.mc-underway')];
  const rows = cards.map(c => ({
    id: c.dataset.id,
    txt: [...c.querySelectorAll('.mc-name')].map(x => x.textContent.trim()).join(' v '),
    h: Math.round(c.getBoundingClientRect().height),
    hasScoreline: !!c.querySelector('.mc-scoreline'),
    scorelineTxt: (c.querySelector('.mc-scoreline')||{}).textContent || null,
    hasUnderway: !!c.querySelector('.mc-underway'),
    cmpl: c.classList.contains('cmpl'),
  }));
  // CSS rule presence, read off the live stylesheet — proves the dead rule went too.
  let cssUnderway = 0, cssScorelineUnderway = 0;
  for (const s of document.styleSheets) {
    let rs; try { rs = s.cssRules; } catch { continue; }
    for (const r of rs || []) {
      const sel = r.selectorText || '';
      if (/\\.mc-underway\\b/.test(sel)) cssUnderway++;
      if (/\\.mc-scoreline\\.underway\\b/.test(sel)) cssScorelineUnderway++;
    }
  }
  const upcoming = rows.filter(r => !r.cmpl);
  const heights = {};
  upcoming.forEach(r => { heights[r.h] = (heights[r.h]||0)+1; });
  return {
    view: (document.querySelector('.mx-tab.active, [data-view].active')||{}).textContent || null,
    cards: rows.length,
    upcomingCards: upcoming.length,
    underwayChips: chips.length,
    underwayChipCards: rows.filter(r => r.hasUnderway).map(r => ({id:r.id, m:r.txt, h:r.h})),
    scorelineCards: rows.filter(r => r.hasScoreline).map(r => ({id:r.id, m:r.txt, h:r.h, txt:r.scorelineTxt.slice(0,60)})),
    upcomingHeightHistogram: heights,
    distinctUpcomingHeights: Object.keys(heights).length,
    cssRule_mcUnderway: cssUnderway,
    cssRule_scorelineUnderway: cssScorelineUnderway,
    allRows: rows,
  };
})()`);

console.log(JSON.stringify(out, null, 2));
ws.close(); chrome.kill();
process.exit(0);
