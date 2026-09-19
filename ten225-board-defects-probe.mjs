// TEN-225 items 1 / 2 / 4 — THE LIVE READ, on the deployed URL.
//
// Founder 2026-09-19, the three things he can see on the board:
//   1. the Underway chip is back — remove it, and add an assertion
//   2. an underway card must render OPEN and NOW, never an empty CLOSE
//   4. a leg at or below 1.01 is not a price
//
// EVERY ONE OF THESE NEEDS MANUFACTURED STATE (standing rule E, founder
// 2026-09-18: "a check that passes on an empty set is not a check. Manufacture
// the state and run the pre-fix build as a control"). On an ordinary board
// there is usually no started-but-scoreless fixture and no suspended market, so
// looking would report a clean pass on nothing — which is exactly how the chip
// survived a "verified live" claim once already.
//
// So the probe drives the DEPLOYED page's own renderer over mutated fixtures,
// reads the painted DOM, and restores the page afterwards. The card count is
// asserted BEFORE anything else, so no zero below can be vacuous.
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
     '--user-data-dir=' + DATA + '/ten225-defects-chrome', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  let wsUrl = null;
  proc.stderr.on('data', d => { const m = /ws:\/\/[^\s]+/.exec(String(d)); if (m && !wsUrl) wsUrl = m[0]; });
  for (let i = 0; i < 150 && !wsUrl; i++) await sleep(100);
  if (!wsUrl) { proc.kill(); throw new Error('no CDP endpoint'); }
  // The stderr endpoint is the BROWSER target, where Runtime.evaluate does not
  // exist — every eval returns undefined and reads as a clean zero. Resolve the
  // PAGE target over the devtools HTTP endpoint.
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
  await sleep(400);
  const send = (method, params = {}) => new Promise(res => {
    const i = ++id; waiting.set(i, m => res(m.result || {}));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evalIn = async expr => {
    const r = await send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval threw');
    return r.result?.value;
  };
  return { send, evalIn, kill: () => proc.kill() };
}

let FAILED = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '   ' + detail : ''}`);
  if (!ok) FAILED++;
};

const b = await cdp();
try {
  const info = await (await fetch('https://michaeldk1996.github.io/SAAS/build-info.json',
    { cache: 'no-store' })).json();
  console.log(`deployed ${info.commit}  built ${info.builtAt}  run #${info.runNumber}\n`);

  await b.send('Page.enable');
  await b.send('Network.enable');
  await b.send('Network.setCacheDisabled', { cacheDisabled: true });
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: AUTH_STUB });
  await b.send('Page.navigate', { url: PAGE });
  for (let i = 0; i < 90; i++) {
    const n = await b.evalIn(`document.querySelectorAll('.mx-match').length`);
    if (n > 0) break;
    await sleep(1000);
  }

  const cards = await b.evalIn(`document.querySelectorAll('.mx-match').length`);
  // EVERY assertion below is conditioned on this. A zero-card board makes all
  // of them pass on nothing, which is the failure mode this probe exists for.
  check('the board rendered at all — nothing below can be a vacuous zero', cards > 0, `cards=${cards}`);
  if (!cards) throw new Error('zero cards: refusing to report any absence');

  // ─────────────────────── ITEM 1 — the chip, with manufactured state ──────
  console.log('\nITEM 1 — the Underway chip');
  const chipNow = await b.evalIn(`document.querySelectorAll('.mc-underway').length`);
  check('no .mc-underway node on the board as it stands', chipNow === 0, `n=${chipNow}`);

  const item1 = await b.evalIn(`(() => {
    // Manufacture the exact state the chip fired on: a fixture whose start has
    // passed, with no final score. Then re-render through the page's own
    // renderer, not a reimplementation of it.
    const list = (typeof getFiltered === 'function') ? getFiltered() : [];
    const m = list.find(x => !x.finalScore && !x.live);
    if (!m) return { staged: null };
    const keep = { startTs: m.startTs, date: m.date, time: m.time, finalScore: m.finalScore };
    m.startTs = new Date(Date.now() - 3600000).toISOString();
    m.finalScore = null;
    renderMatches();
    const chips = document.querySelectorAll('.mc-underway').length;
    const scorelines = document.querySelectorAll('.mx-match .mc-scoreline').length;
    const heights = [...document.querySelectorAll('.mx-match')]
      .map(c => Math.round(c.getBoundingClientRect().height));
    const distinct = [...new Set(heights)].sort((a,b)=>a-b);
    Object.assign(m, keep); renderMatches();
    return { staged: m.id, chips, scorelines, distinct,
              restored: document.querySelectorAll('.mc-underway').length };
  })()`);
  if (!item1.staged) {
    check('MANUFACTURED a started-but-scoreless fixture', false, 'no candidate on the board');
  } else {
    check('MANUFACTURED a started-but-scoreless fixture', true, item1.staged);
    check('...and the chip still does NOT render', item1.chips === 0, `n=${item1.chips}`);
    check('...and the grid stays one height (card symmetry)',
          item1.distinct.length === 1, `heights=${JSON.stringify(item1.distinct)}`);
    check('page restored', item1.restored === 0);
  }
  const cssRule = await b.evalIn(`(() => {
    let n = 0;
    for (const s of document.styleSheets) {
      let rules; try { rules = s.cssRules; } catch (e) { continue; }
      for (const r of rules || []) if (r.selectorText && /\\.mc-underway\\b/.test(r.selectorText)) n++;
    }
    return n;
  })()`);
  check('the dead .mc-underway CSS rule is gone from the served stylesheet', cssRule === 0, `n=${cssRule}`);

  // ───────────────────────── ITEM 2 — the three card states ───────────────
  console.log('\nITEM 2 — card state census, and which columns each renders');
  const item2 = await b.evalIn(`(() => {
    const list = (typeof getFiltered === 'function') ? getFiltered() : [];
    const started = m => { const t = cardStartMs(m); return isFinite(t) && Date.now() >= t; };
    const state = m => (m.finalScore && !m.live) ? 'COMPLETED' : (started(m) ? 'UNDERWAY' : 'UPCOMING');
    const out = { UPCOMING: 0, UNDERWAY: 0, COMPLETED: 0 };
    for (const m of list) out[state(m)]++;
    // Which columns each state renders, read off the painted header of its card.
    const heads = {};
    for (const el of document.querySelectorAll('.mx-match')) {
      const d = el.querySelector('.mc-colhead-drift');
      const c = el.querySelector('.mc-cmpl-head__odds');
      const i = el.querySelector('.mc-colhead-inline');
      const txt = d ? [...d.children].map(s => s.textContent.trim()).filter(Boolean).join(' / ')
                : c ? [...c.children].map(s => s.textContent.trim()).filter(Boolean).join(' / ')
                : i ? [...i.children].map(s => s.textContent.trim()).filter(Boolean).join(' / ')
                : '(none)';
      heads[txt] = (heads[txt] || 0) + 1;
    }
    return { census: out, total: list.length, heads, drift: typeof mxDriftView === 'function' ? mxDriftView() : null };
  })()`);
  console.log(`  census (n=${item2.total}): ` + JSON.stringify(item2.census));
  console.log(`  painted column headers: ` + JSON.stringify(item2.heads));
  check('no non-completed card heads a CLOSE column',
        !Object.keys(item2.heads).some(k => /Close/.test(k) && !/Open \/ Close$/.test(k)),
        JSON.stringify(Object.keys(item2.heads)));

  // The drift view is where Open/Now actually paint, so switch to it and stage
  // an underway fixture there — that is the surface the founder was reading.
  const item2b = await b.evalIn(`(() => {
    const list = (typeof getFiltered === 'function') ? getFiltered() : [];
    const m = list.find(x => !x.finalScore && !x.live);
    if (!m) return { staged: null };
    const keep = { startTs: m.startTs, finalScore: m.finalScore };
    m.startTs = new Date(Date.now() - 3600000).toISOString();
    if (typeof setMatchSort === 'function') setMatchSort('drift');
    else { state.sort = 'drift'; renderMatches(); }
    const card = [...document.querySelectorAll('.mx-match')]
      .find(c => (c.id && c.id.includes(String(m.id))) || c.dataset?.id === m.id)
      || document.querySelector('.mx-match');
    const head = card && card.querySelector('.mc-colhead-drift');
    const headTxt = head ? [...head.children].map(s => s.textContent.trim()).filter(Boolean).join(' / ') : null;
    const cells = card ? [...card.querySelectorAll('.mc-drifted__now')].map(n => n.textContent.trim()) : [];
    const titles = card ? [...card.querySelectorAll('.mc-drifted__now')].map(n => n.getAttribute('title')) : [];
    Object.assign(m, keep);
    state.sort = 'time'; renderMatches();
    return { staged: m.id, headTxt, cells, titles };
  })()`);
  if (item2b.staged) {
    check('an UNDERWAY card heads its right column NOW, not CLOSE',
          item2b.headTxt === 'Open / Now', `"${item2b.headTxt}"`);
    console.log(`    staged ${item2b.staged}  now cells ${JSON.stringify(item2b.cells)}`);
    console.log(`    now titles ${JSON.stringify(item2b.titles)}`);
  } else {
    check('an UNDERWAY card heads its right column NOW, not CLOSE', false, 'nothing to stage');
  }

  // ───────────────────────── ITEM 4 — the impossible leg ──────────────────
  console.log('\nITEM 4 — a leg at or below 1.01');
  const item4 = await b.evalIn(`(() => {
    const list = (typeof getFiltered === 'function') ? getFiltered() : [];
    // Pick a fixture the ladder can still price from a SECOND book, so the test
    // is about fall-through and not about dashing.
    const m = list.find(x => x.bet365Now && x.bet365Now.p1 > 0 && x.odds &&
                             String(x.odds.bookmaker || '').toLowerCase() !== 'bet365' &&
                             x.odds.p1 > 0 && x.odds.p2 > 0);
    if (!m) return { staged: null };
    const before = _mcNowPair(m);
    const keep = JSON.parse(JSON.stringify(m.bet365Now));
    m.bet365Now = { ...m.bet365Now, p1: 1.004, p2: 17 };
    if (typeof OCS === 'object' && OCS) OCS.gen = (OCS.gen || 0) + 1;
    m.__ocsGen = -1;
    const after = _mcNowPair(m);
    const logged = [...MX_SUPPRESSED.values()].filter(r => r.reason === 'unbettable-leg').length;
    m.bet365Now = keep;
    if (typeof OCS === 'object' && OCS) OCS.gen = (OCS.gen || 0) + 1;
    m.__ocsGen = -1;
    const restored = _mcNowPair(m);
    return { staged: m.id, before, after, logged, restored };
  })()`);
  if (!item4.staged) {
    check('MANUFACTURED an impossible leg on a fixture a second book prices', false, 'no candidate');
  } else {
    check('MANUFACTURED an impossible leg (bet365 1.004 / 17.00, overround 5.5%)', true, item4.staged);
    check('CONTROL: before the injection the card resolved to bet365',
          item4.before && String(item4.before.book).toLowerCase() === 'bet365',
          item4.before ? `${item4.before.book} ${item4.before.p1}/${item4.before.p2}` : 'null');
    check('...after it, the card did NOT dash — it fell through the ladder',
          !!item4.after, item4.after ? `${item4.after.book} ${item4.after.p1}/${item4.after.p2}` : 'DASH');
    check('...to a DIFFERENT book, so the impossible leg is not what renders',
          item4.after && String(item4.after.book).toLowerCase() !== 'bet365',
          item4.after ? item4.after.book : '-');
    check('...and the suppression is logged with its own reason',
          item4.logged >= 1, `unbettable-leg records=${item4.logged}`);
    check('page restored',
          item4.restored && String(item4.restored.book).toLowerCase() === 'bet365',
          item4.restored ? `${item4.restored.book} ${item4.restored.p1}` : 'null');
  }
  const painted = await b.evalIn(`(() => {
    const bad = [];
    for (const n of document.querySelectorAll('.mc-drifted__now, .mc-drifted__open, .mc-odds')) {
      const v = parseFloat((n.textContent || '').trim());
      if (Number.isFinite(v) && v > 0 && v <= 1.01) bad.push(n.textContent.trim());
    }
    return bad;
  })()`);
  check('no cell on the live board paints a price at or below 1.01',
        painted.length === 0, `n=${painted.length}${painted.length ? ' ' + JSON.stringify(painted) : ''}`);

  // ── ITEM 4b — OPEN present, NOW dashed: which book, and why ─────────────
  console.log('\nITEM 4b — Open with a dashed Now, read off the painted drift view');
  const item4b = await b.evalIn(`(() => {
    state.sort = 'drift'; renderMatches();
    const rows = [];
    for (const card of document.querySelectorAll('.mx-match')) {
      const opens = [...card.querySelectorAll('.mc-drifted__open')];
      const nows  = [...card.querySelectorAll('.mc-drifted__now')];
      for (let i = 0; i < Math.min(opens.length, nows.length); i++) {
        const o = opens[i].textContent.trim(), n = nows[i].textContent.trim();
        const dashed = n === '\\u2014' || n === '-';
        if (o && o !== '\\u2014' && dashed) {
          rows.push({ open: o,
                      openTitle: opens[i].getAttribute('title') || null,
                      who: (card.querySelector('.mc-name')||{}).textContent || null });
        }
      }
    }
    const all = document.querySelectorAll('.mc-drifted__now').length;
    state.sort = 'time'; renderMatches();
    return { rows, allNowCells: all };
  })()`);
  check('the drift view painted Now cells at all — otherwise the count below is vacuous',
        item4b.allNowCells > 0, `now cells=${item4b.allNowCells}`);
  console.log(`  Open-with-dashed-Now legs: ${item4b.rows.length}` +
              (item4b.rows.length < 30 ? '   (n<30)' : ''));
  for (const r of item4b.rows.slice(0, 12))
    console.log(`    open ${r.open}  book/title: ${JSON.stringify(r.openTitle)}`);

  console.log(`\n${FAILED ? FAILED + ' FAILED' : 'all checks passed'}`);
} finally {
  b.kill();
}
process.exit(FAILED ? 1 : 0);
