// TEN-242 — does the EMBEDDED Database actually render inside the Tournaments
// ROI overlay, on the deployed bytes?
//
// The selectors lining up and the panel looking right are different claims, and
// only one of them is a grep. `954a9b8e` widened `#dbBody` to `#dbBody,
// [data-db="body"]` and gave the overlay root its own `data-page="database"` so
// the `--db-*` custom properties resolve. This reads the COMPUTED styles and the
// rendered rows to check that actually happened.
//
// A custom property that fails to resolve does not throw and does not log — the
// declaration is simply dropped and the element falls back to the page default.
// So "no page errors" proves nothing here; the only evidence is the computed
// value, which is why this probe reads colours rather than counting exceptions.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

// Defaults to the DEPLOYED site, because that is the claim worth making. Set
// PROBE_LOCAL=1 to serve the worktree instead — needed to verify a change
// BEFORE it deploys, which is otherwise a gap: without it the only way to check
// an edit is to push it and read the result, and a probe you cannot run before
// pushing is a probe that only ever confirms what already shipped.
const LOCAL = process.env.PROBE_LOCAL === '1';
let srv = null, BASE;
if (LOCAL) {
  const http = await import('node:http');
  const path = await import('node:path');
  const ROOT = process.cwd();
  const TYPES = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.css':'text/css' };
  srv = http.default.createServer((req, res) => {
    const f = path.default.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.default.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${srv.address().port}`;
} else {
  BASE = (process.env.PROBE_BASE_URL || 'https://michaeldk1996.github.io/SAAS').replace(/\/+$/, '');
}
const URL = `${BASE}/bsp-consult-dashboard.html`;
const CHROME_BIN = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const ch = spawn(CHROME_BIN,
  ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--disable-gpu',
   '--window-size=1440,1800', '--user-data-dir=' + fs.mkdtempSync('/tmp/roiprobe-'), 'about:blank'],
  { stdio: ['ignore', 'pipe', 'pipe'] });
const port = await new Promise((res, rej) => {
  let b = ''; const t = setTimeout(() => rej(new Error('no devtools port')), 20000);
  ch.stderr.on('data', d => { b += d; const m = /ws:\/\/127\.0\.0\.1:(\d+)\//.exec(b); if (m) { clearTimeout(t); res(+m[1]); } });
});
const tg = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page');
const ws = new WebSocket(tg.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
let id = 0; const w = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
const send = (m, p = {}) => new Promise(res => { const i = ++id; w.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async x => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'threw');
  return r.result?.result?.value;
};
await send('Page.enable'); await send('Runtime.enable');
const errors = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push((m.params?.exceptionDetails?.exception?.description || '').slice(0, 160)); });
// A SETTER, never a frozen value: auth.js does `global.BSP = BSP` and a
// non-writable stub makes the page throw its own TypeError, which this probe
// would then report as a page error it manufactured itself.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){var v;var u={emailVerified:true,email:'p@l',uid:'p'};
  Object.defineProperty(window,'BSP',{configurable:true,get:function(){return v;},
    set:function(o){ if(o&&typeof o==='object'){ o.requireVerified=function(){return Promise.resolve(u);}; o.requireAuth=function(){return Promise.resolve(u);}; } v=o; }});
  window.BSP={currentUser:function(){return u;},onAuthChange:function(f){f(u);return function(){};},ready:Promise.resolve(u),whenAuthReady:function(){return Promise.resolve(u);},requireAuth:function(){return Promise.resolve(u);},requireVerified:function(){return Promise.resolve(u);},isValidEmail:function(){return true;},updateProfile:function(){return Promise.resolve();},NOTIF:{}};
})();` });
await send('Page.navigate', { url: URL });

const wait = async (x, label, ms = 45000) => {
  const t0 = Date.now();
  for (;;) { let v; try { v = await ev(x); } catch { v = null; }
    if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout: ' + label);
    await new Promise(r => setTimeout(r, 300)); }
};
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log(`  ok    ${n}${d ? '  — ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${n}  — ${d}`); } };

console.log(`\nTEN-242 · embedded Database inside the ROI overlay — deployed bytes\n${URL}\n`);

await wait(`!!document.querySelector('[data-tab]')`, 'boot');
await ev(`document.querySelector('[data-tab="tournaments"]').click()`);
// WAIT FOR THE CARD ITSELF, not for the page to have some text. The ROI cards
// render after the market data resolves, and a length check on the page passes
// well before they exist — the first cut of this probe clicked into that gap and
// reported "no ROI card on screen" against a page that had two. Sixth time this
// surface has caught me asserting on a proxy for the thing instead of the thing.
await wait(`document.querySelectorAll('[onclick*="tourxOpenRoi"]').length > 0`, 'ROI cards to render');

// Open the ROI overlay the way a member does — through the card, not by calling
// the function. A direct tourxOpenRoi() call would skip whatever the card does.
const opened = await ev(`(function(){
  var els=[].slice.call(document.querySelectorAll('[onclick*="tourxOpenRoi"]'));
  if(!els.length) return 'no ROI card on screen';
  els[0].click(); return 'clicked';
})()`);
ok('an ROI card is on the Tournaments page and is clickable', opened === 'clicked', opened);

let mounted = false;
try { await wait(`!!document.querySelector('[data-db-root="roi"] [data-db="body"]')`, 'overlay mount', 25000); mounted = true; }
catch (e) { /* reported below */ }
ok('the overlay mounts the Database body', mounted, mounted ? 'found [data-db-root="roi"] [data-db="body"]' : 'never appeared');

if (mounted) {
  // THE STYLING CLAIM. An unresolved custom property is silently dropped, so read
  // the computed value: --db-surface is #0a0d14 = rgb(10, 13, 20).
  const css = await ev(`(function(){
    var root=document.querySelector('[data-db-root="roi"]');
    var cs=getComputedStyle(root);
    var card=root.querySelector('.db-headcard, .db-bandpanel, .db-rgrid');
    return { surface: (cs.getPropertyValue('--db-surface')||'').trim(),
             mono: (cs.getPropertyValue('--db-mono')||'').trim(),
             pageAttr: root.getAttribute('data-page'),
             cardBg: card ? getComputedStyle(card).backgroundColor : null,
             cardTag: card ? card.className : null };
  })()`);
  ok('--db-surface RESOLVES on the overlay root', css.surface === '#0a0d14', `"${css.surface}"`);
  ok('--db-mono resolves too', /IBM Plex Mono/.test(css.mono), `"${css.mono}"`);
  ok('...because the overlay root carries data-page="database" itself', css.pageAttr === 'database', `data-page="${css.pageAttr}"`);
  ok('a real panel paints that surface colour rather than falling back',
    css.cardBg === 'rgb(10, 13, 20)', `${css.cardTag} -> ${css.cardBg}`);

  // WAIT FOR THE ARCHIVE, then read. The embedded body fetches database-yield.json
  // (1.3 MB) after mount and shows "Loading archive…" meanwhile — 16 characters,
  // which an immediate read scores as "rendered nothing". Styling resolves before
  // the data arrives, so the two claims need two waits.
  let loaded = false;
  try {
    await wait(`(function(){var b=document.querySelector('[data-db-root="roi"] [data-db="body"]');
      if(!b) return false; var t=(b.innerText||'');
      return /Loading archive/.test(t) ? false : (t.trim().length>200 || /No matches|Archive unavailable/i.test(t));})()`,
      'archive to load into the overlay', 40000);
    loaded = true;
  } catch (e) { /* reported by the assertions below */ }
  ok('the embedded body finishes loading the archive', loaded,
    loaded ? 'left the "Loading archive…" state' : 'still showing "Loading archive…" after 40s');

  // The body node the widened selector has to reach. #dbBody is an ID and the
  // overlay's node cannot carry it, so this only works if `[data-db="body"]` is
  // in the selector list.
  const flex = await ev(`(function(){
    var b=document.querySelector('[data-db-root="roi"] [data-db="body"]');
    var cs=getComputedStyle(b);
    return { display: cs.display, dir: cs.flexDirection, id: b.id || '(no id)', chars: (b.innerText||'').trim().length };
  })()`);
  ok('the body node gets the flex layout through [data-db="body"], not #dbBody',
    flex.display === 'flex' && flex.dir === 'column', `display:${flex.display} direction:${flex.dir} id=${flex.id}`);
  ok('...and it has actually rendered content, not an empty shell',
    flex.chars > 200, `${flex.chars} chars of text`);

  // It renders the right EVENT, which is the defect that made 69 of 73 show an
  // empty panel: a display name resolved back against archive strings.
  const body = await ev(`document.querySelector('[data-db-root="roi"]').innerText`);
  ok('the panel is not the empty-filter state', !/No matches for this filter/i.test(body),
    (body.match(/No matches[^\\n]*/i) || ['none'])[0]);
  const n = await ev(`document.querySelectorAll('[data-db-root="roi"] .db-rgrid, [data-db-root="roi"] .db-bandpanel').length`);
  ok('...and it drew at least one grid or band panel', n > 0, `${n} panel(s)`);
}

// THE EMBEDDED MOUNT MUST NOT RENDER AN h1 (founder ruling 2026-09-21).
// Checked on the real DOM rather than the source, because the demotion happens
// at mount time and the only thing that proves it is the node that exists.
// Note this passes even though hideHeader has display:none'd the card — the tag
// is what is asserted, not its visibility, so the control still fires for a
// future caller who omits hideHeader and actually shows the thing.
if (mounted) {
  const hdr = await ev(`(function(){
    var root=document.querySelector('[data-db-root="roi"]');
    var head=root.querySelector('[data-db="head"]');
    return { h1: root.querySelectorAll('h1').length,
             h2: head ? head.querySelectorAll('h2').length : 0,
             title: head && head.querySelector('h2') ? head.querySelector('h2').textContent.trim() : null,
             pageH1: [].slice.call(document.querySelectorAll('h1')).filter(function(h){
               var r=h.getBoundingClientRect(); var cs=getComputedStyle(h);
               return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none'; }).length };
  })()`);
  ok('the embedded mount renders NO h1', hdr.h1 === 0, `${hdr.h1} h1 inside [data-db-root="roi"]`);
  ok('...it renders the title as an h2 instead', hdr.h2 === 1 && hdr.title === 'Database', `h2 x${hdr.h2} "${hdr.title}"`);
  ok('...so the page still has exactly one visible h1', hdr.pageH1 === 1, `${hdr.pageH1} visible`);
}

ok('no uncaught page errors', errors.length === 0, errors.join(' | ') || 'none');
console.log(`\n  ${pass} passed, ${fail} failed\n`);
ws.close(); ch.kill(); if (srv) srv.close(); process.exit(fail ? 1 : 0);
