// TEN-225 item 2 — LIVE READ: does any member-visible surface name Bet105?
//
// Founder directive 2026-09-18T22:01Z: everything captured as sports411 keeps
// that label, "it is not Bet105, it carries no affiliate relationship, and
// nothing on any surface may imply otherwise."
//
// Reads the RENDERED DOM of the deployed page, not the repo. The book name is
// not a literal in the HTML — it is data, published into odds-card-state.json
// and rendered into the per-cell hover title. So grepping the source answers a
// different question than the one the founder asked, and only a render answers
// this one.
//
// ⚠️ THE FAILURE THIS FILE IS SHAPED AROUND. The first cut of this probe ran
// without the auth stub, rendered ZERO cards, and reported "bet105: 0" — a
// clean pass on an empty page. That is the third time on this issue that a
// probe has passed vacuously. So: the card count is asserted BEFORE any
// bet105 count is believed, and a zero-card board FAILS rather than passes.
//
// The auth stub is installed with addScriptToEvaluateOnNewDocument (i.e. before
// any page script runs), which is the part the first cut got wrong.
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
     '--user-data-dir=' + DATA + '/ten232-b105-chrome', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  let wsUrl = null;
  proc.stderr.on('data', d => { const m = /ws:\/\/[^\s]+/.exec(String(d)); if (m && !wsUrl) wsUrl = m[0]; });
  for (let i = 0; i < 120 && !wsUrl; i++) await sleep(100);
  if (!wsUrl) { proc.kill(); throw new Error('no CDP endpoint'); }
  // The endpoint Chrome prints on stderr is the BROWSER target, where
  // Runtime.evaluate does not exist ("'Runtime.evaluate' wasn't found").
  // Resolve the PAGE target over the devtools HTTP endpoint instead.
  const port = new URL(wsUrl).port;
  let pageWs = null;
  for (let i = 0; i < 60 && !pageWs; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const pg = list.find(t => t.type === 'page');
      if (pg) pageWs = pg.webSocketDebuggerUrl;
    } catch (e) { /* devtools http not up yet */ }
    if (!pageWs) await sleep(200);
  }
  if (!pageWs) { proc.kill(); throw new Error('no page target'); }
  const ws = new WebSocket(pageWs);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiting = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  await new Promise(r => setTimeout(r, 400));
  return {
    send: (method, params = {}) => new Promise(res => {
      const i = ++id; waiting.set(i, m => res(m.result || {}));
      ws.send(JSON.stringify({ id: i, method, params }));
    }),
    close: () => { try { ws.close(); } catch (e) {} proc.kill(); },
  };
}

const FAILED = [];
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
  if (!cond) FAILED.push(name);
};

const c = await cdp();
try {
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Network.setCacheDisabled', { cacheDisabled: true });
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: AUTH_STUB });
  await c.send('Page.navigate', { url: PAGE + '?cb=b105label' });
  const ev = async e => {
    const r = await c.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r && r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
    if (!r || !r.result) return undefined;   // page not ready yet; the caller polls
    return r.result.value;
  };
  let seen = 0;
  for (let i = 0; i < 180; i++) {
    seen = (await ev('document.querySelectorAll(".mx-match").length || 0')) || 0;
    if (seen) break;
    await sleep(500);
  }
  if (!seen) {
    const diag = await ev('JSON.stringify({url:location.href, ready:document.readyState, bodyLen:(document.body&&document.body.innerHTML||"").length, firstText:(document.body&&document.body.innerText||"").slice(0,300), selectors:{mx:document.querySelectorAll(".mx-match").length, mc:document.querySelectorAll("[class*=mc-]").length, any:document.querySelectorAll("div").length}})');
    console.log('DIAG ' + diag);
  }

  const build = (await ev('fetch("./build-info.json",{cache:"no-store"}).then(r=>r.json())')) || {};
  const cards = await ev('document.querySelectorAll(".mx-match").length');

  console.log('TEN-232 item 2 — LIVE READ, deployed board');
  console.log(`  url        ${PAGE}`);
  console.log(`  commit     ${build.commit}`);
  console.log(`  builtAt    ${build.builtAt}  run ${build.runNumber}`);
  console.log(`  cards      ${cards}`);
  console.log('');

  // THE GUARD. Everything below is a count of absences, and a count of
  // absences on an empty board is not evidence of anything.
  check('the board actually rendered — without this every zero below is vacuous',
        cards > 0, `${cards} .mx-match nodes`);
  if (!cards) throw new Error('zero cards rendered; refusing to report the bet105 counts');

  const r = await ev(`(() => {
    const text  = document.body.innerText || '';
    const html  = document.documentElement.outerHTML;
    const tips  = [...document.querySelectorAll('[title]')].map(e => e.getAttribute('title') || '');
    const books = {};
    for (const t of tips) { const m = /^([A-Za-z0-9]+)\\s*·/.exec(t); if (m) books[m[1]] = (books[m[1]] || 0) + 1; }
    return { visibleText: (text.match(/bet\\s*105/ig) || []).length,
             anyHtml:     (html.match(/bet\\s*105/ig) || []).length,
             tipsBet105:  tips.filter(t => /bet\\s*105/i.test(t)).length,
             s411Visible: (text.match(/sports411/ig) || []).length,
             tipCount:    tips.filter(Boolean).length,
             books };
  })()`);

  console.log(`  book names rendered in hover tooltips: ${JSON.stringify(r.books)}`);
  console.log(`  tooltipped nodes: ${r.tipCount}`);
  console.log('');
  check('tooltips exist to be checked — a board with no titles would also show 0 Bet105',
        r.tipCount > 0, `${r.tipCount}`);
  check('NO tooltip names Bet105', r.tipsBet105 === 0, `${r.tipsBet105}`);
  check('"Bet105" appears nowhere in the text a member reads', r.visibleText === 0, `${r.visibleText}`);
  check('"Bet105" appears nowhere in the served HTML at all, comments included',
        r.anyHtml === 0, `${r.anyHtml}`);
  check('the Kibl book is named on screen as sports411 and not as anything else',
        (r.books.sports411 || 0) > 0, `sports411 tooltips: ${r.books.sports411 || 0}`);

  const ocs = await ev('fetch("./odds-card-state.json",{cache:"no-store"}).then(r=>r.text())');
  const nB = (ocs.match(/bet105/ig) || []).length;
  const nS = (ocs.match(/sports411/ig) || []).length;
  console.log('');
  console.log(`  deployed odds-card-state.json — sports411 ${nS}, bet105 ${nB}`);
  check('the published data file carries no Bet105 label', nB === 0, `${nB}`);
  check('...and it is non-empty, so that zero was read rather than missed',
        nS > 0, `${nS} sports411 rows`);

  console.log('');
  console.log(FAILED.length ? `${FAILED.length} FAILED: ${JSON.stringify(FAILED)}`
                            : 'all checks passed');
  process.exitCode = FAILED.length ? 1 : 0;
} finally {
  c.close();
}
