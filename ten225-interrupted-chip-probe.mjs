// TEN-225 board fixes 2026-09-21 — LIVE READ of BOTH fixes on the deployed page.
//
// FOUNDER, on the interrupted chip: "Confirm with a manufactured interrupted
// fixture and a pre-fix control, since most boards carry none."
//
// He is right that a board usually carries none: today's deployed board carries
// exactly ONE (past-12164693, J. Fuentes Vasquez v H. Rocha, "4-6, 2-2"), and
// one that will resolve or roll off. A probe whose only subject can vanish is a
// probe that will one day pass because there was nothing to look at — the same
// empty-set pass that has bitten this issue three times. So this file
// MANUFACTURES its subjects and refuses to report if the manufacture failed.
//
// HOW the manufacture works: window.fetch is wrapped BEFORE any page script
// runs (addScriptToEvaluateOnNewDocument) and the response to ./matches.json is
// rewritten in flight. Nothing on the server changes, no state is written, and
// the real board is untouched — this is a read that supplies its own subject.
// The dashboard's globals are not on window, so driving the renderer directly
// is not available; the network layer is the only seam.
//
//   --mode=control  expects the chip PRESENT   (run against the PRE-fix build)
//   --mode=fixed    expects the chip ABSENT    (run against the POST-fix build)
//
// The control is not decoration. Every assertion in `fixed` is a count of
// absences, and the control is the only thing proving those absences were
// caused by the fix rather than by a fixture that never rendered.
import { setTimeout as sleep } from 'node:timers/promises';

const PAGE = 'https://michaeldk1996.github.io/SAAS/bsp-consult-dashboard.html';
const DATA = process.env.PAPERCLIP_RUN_SCRATCH_DIR || '/tmp';
const MODE = (process.argv.find(a => a.startsWith('--mode=')) || '--mode=fixed').slice(7);
if (!['control', 'fixed'].includes(MODE)) throw new Error('--mode=control|fixed');

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

// The four subjects. Names are deliberately unmistakable so a card can be found
// by text without matching a real player.
//
//  ZZINT1  interrupted, liveStatus "Interrupted"  — the plain case
//  ZZINT2  interrupted, liveStatus "Suspended"    — the OTHER string the removed
//                                                   branch could return, since it
//                                                   returned `m.liveStatus || ...`
//  ZZINT3  interrupted, liveStatus null           — falls back to the literal
//  ZZLIVE  genuinely LIVE, not interrupted        — the KEEP control: the LIVE
//                                                   chip must survive both builds,
//                                                   or I removed too much.
const MANUFACTURE = `
(function(){
  const PART = { display: '4-6, 2-2',
                 sets: [{p1:4,p2:6},{p1:2,p2:2}], p1Sets: 0, p2Sets: 1, winner: null };
  const orig = window.fetch;
  window.fetch = function(u, o){
    const url = String((u && u.url) || u || '');
    if (!/matches\\.json/.test(url)) return orig.apply(this, arguments);
    return orig.apply(this, arguments).then(async res => {
      let rows;
      try { rows = JSON.parse(await res.clone().text()); } catch (e) { return res; }
      if (!Array.isArray(rows) || !rows.length) return res;
      // CLONE A ROW THAT IS ALREADY ON SCREEN. The first cut cloned a completed
      // match and forced day:'today'; all four manufactured rows were filtered
      // out by the day-tab (which keys on the date, not the day bucket) and the
      // probe reported 0/4. Inheriting date AND day from a row the default view
      // already renders is what puts the subject in front of the assertion.
      // (No backticks in this comment: the whole block is a template literal.)
      const base = rows.find(r => r.interrupted)
                || rows.find(r => r.day === 'today')
                || rows.find(r => r.finalScore) || rows[0];
      const mk = (id, p1, p2, patch) => Object.assign(
        JSON.parse(JSON.stringify(base)),
        { id, p1, p2, finalScore: null, partialScore: null, live: false,
          interrupted: false, liveStatus: null }, patch);
      rows.push(mk('zz-int-1','ZZINT1 Alpha','ZZINT1 Beta',
                   {interrupted:true, liveStatus:'Interrupted', partialScore:PART}));
      rows.push(mk('zz-int-2','ZZINT2 Alpha','ZZINT2 Beta',
                   {interrupted:true, liveStatus:'Suspended',   partialScore:PART}));
      rows.push(mk('zz-int-3','ZZINT3 Alpha','ZZINT3 Beta',
                   {interrupted:true, liveStatus:null,          partialScore:PART}));
      rows.push(mk('zz-live-1','ZZLIVE Alpha','ZZLIVE Beta',
                   {live:true, liveStatus:'Set 2', partialScore:PART}));
      window.__ZZ_INJECTED = 4;
      return new Response(JSON.stringify(rows),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
  };
})();`;

async function cdp() {
  const { spawn } = await import('node:child_process');
  const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--remote-debugging-port=0', '--no-first-run',
     '--no-default-browser-check', '--disable-gpu',
     '--user-data-dir=' + DATA + '/ten225-int-chrome-' + MODE, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  let wsUrl = null;
  proc.stderr.on('data', d => { const m = /ws:\/\/[^\s]+/.exec(String(d)); if (m && !wsUrl) wsUrl = m[0]; });
  for (let i = 0; i < 120 && !wsUrl; i++) await sleep(100);
  if (!wsUrl) { proc.kill(); throw new Error('no CDP endpoint'); }
  // ⚠️ The endpoint Chrome prints on stderr is the BROWSER target, where
  // Runtime.evaluate does not exist. Resolve the PAGE target over HTTP.
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
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: MANUFACTURE });
  await c.send('Page.navigate', { url: PAGE + '?cb=intchip' + Date.now() });
  const ev = async e => {
    const r = await c.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r && r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
    if (!r || !r.result) return undefined;
    return r.result.value;
  };

  let cards = 0;
  for (let i = 0; i < 180 && !cards; i++) {
    cards = (await ev('document.querySelectorAll(".mx-match").length || 0')) || 0;
    if (!cards) await sleep(500);
  }
  // The manufactured rows arrive with the SECOND paint in some code paths
  // (matches.json lands, cards repaint). Wait for the subject, not just a card.
  // ⚠️ THE THREE INTERRUPTED SUBJECTS AND THE LIVE ONE DO NOT SHARE A BOARD.
  // `dayOf()` buckets an interrupted fixture to 'today' and a LIVE one to
  // 'past', so the default view can only ever show three of the four. Asserting
  // 4 here made the probe refuse on a manufacture that had in fact worked.
  let subjects = 0;
  for (let i = 0; i < 60 && subjects < 3; i++) {
    subjects = (await ev(`[...document.querySelectorAll('.mx-match')]
      .filter(e => /ZZINT/.test(e.innerText || '')).length`)) || 0;
    if (subjects < 3) await sleep(500);
  }

  const build = (await ev('fetch("./build-info.json",{cache:"no-store"}).then(r=>r.json())')) || {};
  console.log(`TEN-225 interrupted chip — LIVE READ, mode=${MODE}`);
  console.log(`  url        ${PAGE}`);
  console.log(`  commit     ${build.commit}`);
  console.log(`  builtAt    ${build.builtAt}  run ${build.runNumber}`);
  console.log(`  cards      ${cards}   manufactured subjects on the board: ${subjects}`);
  console.log('');

  // ── THE GUARDS. Nothing below is believed until the subject exists. ───────
  check('the board rendered at all', cards > 0, `${cards} .mx-match nodes`);
  check('all 3 manufactured INTERRUPTED fixtures reached the DOM — without this ' +
        'every absence below is an empty set, not a fix', subjects === 3, `${subjects}/3`);
  if (cards === 0 || subjects !== 3) {
    console.log('\nREFUSING to report chip counts: the subject did not render.');
    console.log('DIAG ' + await ev(`JSON.stringify({
      injected: window.__ZZ_INJECTED || 0, ready: document.readyState,
      zzliveInHtml: (document.documentElement.outerHTML.match(/ZZLIVE/g) || []).length,
      zzliveInText: ((document.body || {}).innerText || '').match(/ZZLIVE/g)?.length || 0,
      seg: [...document.querySelectorAll('.mx-viewseg *')].map(e => (e.className || '') + '=' + (e.innerText || '').trim()).slice(0, 8)
    })`));
    throw new Error('manufacture failed');
  }

  const r = await ev(`(() => {
    const out = { subjects: {}, realInterrupted: 0, liveChipsTotal: 0, threeDpZero: [] };
    for (const card of document.querySelectorAll('.mx-match')) {
      const t = card.innerText || '';
      const m = /ZZ(?:INT|LIVE)\\d?\\s\\w+/.exec(t);
      const key = m ? m[0].split(' ')[0] : null;
      const chip = card.querySelector('.mc-status');
      if (chip) out.liveChipsTotal++;
      if (key && !out.subjects[key]) out.subjects[key] = {
        chip: chip ? (chip.className + '|' + (chip.innerText || '').trim()) : null,
        scoreLine: /at interruption · match suspended/.test(t),
        scoreShown: /4-6, 2-2/.test(t),
        headerLines: (card.querySelector('.mc-head') || {}).clientHeight || null,
      };
    }
    // The one REAL interrupted fixture the board happens to carry today.
    for (const card of document.querySelectorAll('.mx-match')) {
      const t = card.innerText || '';
      if (/Fuentes Vasquez/.test(t) && /at interruption/.test(t)) out.realInterrupted++;
    }
    // Fix 1, same page: any rendered odds cell still showing a trailing zero.
    for (const e of document.querySelectorAll('.mc-odds, .fo-v, .mc-journey__open, .mc-journey__close, .mc-drifted__open, .mc-story__od, .mc-story__tod, .mc-story__upprice')) {
      const s = (e.textContent || '').trim();
      for (const tok of s.split(/[^0-9.]+/)) if (/^1\\.\\d\\d0$/.test(tok)) out.threeDpZero.push(tok);
    }
    return out;
  })()`);

  console.log('  manufactured subjects, as rendered:');
  for (const k of ['ZZINT1', 'ZZINT2', 'ZZINT3', 'ZZLIVE'])
    console.log(`    ${k}  chip=${JSON.stringify(r.subjects[k]?.chip)}  scoreLine=${r.subjects[k]?.scoreLine}  score="4-6, 2-2" shown=${r.subjects[k]?.scoreShown}`);
  console.log(`  real interrupted fixtures on the board today: ${r.realInterrupted}`);
  console.log(`  rendered odds cells still showing a trailing zero: ${r.threeDpZero.length}` +
              (r.threeDpZero.length ? `  e.g. ${[...new Set(r.threeDpZero)].slice(0, 8).join(', ')}` : ''));
  console.log('');

  const intChips = ['ZZINT1', 'ZZINT2', 'ZZINT3'].filter(k => r.subjects[k]?.chip);
  if (MODE === 'control') {
    // PRE-FIX: the defect must REPRODUCE, or the "fixed" run proves nothing.
    check('CONTROL: the interrupted chip is present on all three manufactured fixtures',
          intChips.length === 3, `${intChips.length}/3  ${JSON.stringify(intChips)}`);
    check('CONTROL: it renders the feed word, including the "Suspended" variant',
          /Suspended/i.test(r.subjects.ZZINT2?.chip || ''), r.subjects.ZZINT2?.chip || '—');
    check('CONTROL: fix 1 also reproduces — trailing zeros are on screen',
          r.threeDpZero.length > 0, `${r.threeDpZero.length} cells`);
  } else {
    check('the interrupted chip is gone from all three manufactured fixtures',
          intChips.length === 0, `${intChips.length}/3 still chipped  ${JSON.stringify(intChips)}`);
    check('...and no odds cell renders a trailing zero any more',
          r.threeDpZero.length === 0, `${r.threeDpZero.length} cells`);
  }

  // TRUE IN BOTH MODES. These are what the ruling did NOT touch, and the reason
  // removing the chip costs no information.
  check('the score line still carries the fact, worded as the founder quoted it',
        ['ZZINT1', 'ZZINT2', 'ZZINT3'].every(k => r.subjects[k]?.scoreLine),
        JSON.stringify(['ZZINT1', 'ZZINT2', 'ZZINT3'].map(k => !!r.subjects[k]?.scoreLine)));
  check('...including the partial score itself, "4-6, 2-2"',
        ['ZZINT1', 'ZZINT2', 'ZZINT3'].every(k => r.subjects[k]?.scoreShown));
  // THE KEEP CONTROL, on whichever board holds it. A LIVE fixture is bucketed
  // to a different day than an interrupted one, so it has to be hunted: every
  // view segment × every day tab, clicked, until the card appears. If the hunt
  // comes up empty the probe SKIPS OUT LOUD rather than passing — an absence I
  // could not locate is not evidence that the LIVE chip survived.
  const live = await ev(`(async () => {
    const segs = [...document.querySelectorAll('.mx-viewseg *')].filter(e => e.innerText.trim());
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    for (const s of segs) {
      s.click(); await sleep(400);
      const tabs = [...document.querySelectorAll('.mx-daytabs *')].filter(e => e.innerText.trim());
      for (const t of [null, ...tabs]) {
        if (t) { t.click(); await sleep(400); }
        for (const card of document.querySelectorAll('.mx-match')) {
          if (!/ZZLIVE/.test(card.innerText || '')) continue;
          const chip = card.querySelector('.mc-status');
          return { found: true, where: s.innerText.trim() + ' / ' + (t ? t.innerText.trim() : '(default day)'),
                   chip: chip ? (chip.className + '|' + (chip.innerText || '').trim()) : null };
        }
      }
    }
    return { found: false };
  })()`);

  if (!live.found) {
    console.log('  SKIP  the manufactured LIVE fixture was not reachable on any ' +
                'view/day tab, so the "LIVE chip survives" control has nothing to ' +
                'measure. The suite assertion on statusLabel covers it in source.');
  } else {
    console.log(`  ZZLIVE found on: ${live.where}`);
    check('a genuinely LIVE fixture KEEPS its LIVE chip — the removal was narrow',
          /live/.test(live.chip || ''), live.chip || '—');
  }

  console.log('');
  console.log(FAILED.length ? `${FAILED.length} FAILED: ${JSON.stringify(FAILED)}`
                            : 'all checks passed');
  process.exitCode = FAILED.length ? 1 : 0;
} finally {
  c.close();
}
