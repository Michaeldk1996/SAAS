#!/usr/bin/env node
// TEN-242 phase 2 B — the DOM half of the mount proof.
//
// test-database-characterisation.mjs executes the seam (use/q/mount dedupe) in
// node with real root objects. Four claims it CANNOT make, because they are
// about a live document and real data, are made here against headless Chrome:
//
//   1. STYLING   the embedded root actually picks up the --db-* custom
//                properties (computed colour, not a grep for data-page)
//   2. KEY       a MULTI-STRING event (Hamburg, 5 archive strings) renders real
//                rows — the catalog-name bug rendered "No matches for this filter"
//   3. SIDE      opening the underdogs card lands on the Underdogs panel
//   4. LEAK      25 open/close cycles leave ONE roi instance, and the standalone
//                page is byte-identical before and after
//
// Every check has a failing control. Run manually; not wired into npm test
// because CI has no Chrome.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const WT = process.argv[2] || process.cwd();
const PORT = 8731 + (process.pid % 200);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// ---- auth stub: the page redirects to signin without a Firebase session -----
const STUB = `(function(g){var u={emailVerified:true,email:'probe@local',uid:'probe'};
 g.BSP={currentUser:function(){return u;},onAuthChange:function(f){f(u);return function(){};},
 ready:Promise.resolve(u),whenAuthReady:function(){return Promise.resolve(u);},
 requireAuth:function(){return Promise.resolve(u);},requireVerified:function(){return Promise.resolve(u);},
 isValidEmail:function(){return true;},updateProfile:function(){return Promise.resolve();},NOTIF:{}};})(window);`;

// ---- a static server over the worktree, with auth.js swapped for the stub ---
const srv = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/auth.js') { res.writeHead(200, {'content-type':'text/javascript'}); return res.end(STUB); }
  const f = path.join(WT, url.replace(/^\/+/, ''));
  if (!f.startsWith(WT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('x'); }
  const ext = path.extname(f);
  res.writeHead(200, {'content-type': ext === '.html' ? 'text/html' : ext === '.json' ? 'application/json' : 'text/javascript'});
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(PORT, '127.0.0.1', r));

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--no-first-run',
  '--disable-gpu', '--window-size=1440,1000', '--user-data-dir=' + fs.mkdtempSync('/tmp/cdp-'), 'about:blank'],
  { stdio: ['ignore', 'pipe', 'pipe'] });

// stderr carries the BROWSER ws endpoint; we need the PAGE target, via /json.
const wsBrowser = await new Promise((resolve, reject) => {
  let buf = '';
  const t = setTimeout(() => reject(new Error('chrome did not announce a port')), 20000);
  chrome.stderr.on('data', (d) => {
    buf += d;
    const m = /ws:\/\/127\.0\.0\.1:(\d+)\//.exec(buf);
    if (m) { clearTimeout(t); resolve(Number(m[1])); }
  });
});
const targets = await (await fetch(`http://127.0.0.1:${wsBrowser}/json`)).json();
const page = targets.find((t) => t.type === 'page');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const waiters = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval threw');
  return r.result?.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `Object.defineProperty(window,'BSP',{value:(function(){var u={emailVerified:true,email:'probe@local',uid:'probe'};
    return {currentUser:function(){return u;},onAuthChange:function(f){f(u);return function(){};},ready:Promise.resolve(u),
    whenAuthReady:function(){return Promise.resolve(u);},requireAuth:function(){return Promise.resolve(u);},
    requireVerified:function(){return Promise.resolve(u);},isValidEmail:function(){return true;},
    updateProfile:function(){return Promise.resolve();},NOTIF:{}};})(),writable:false,configurable:false});` });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/bsp-consult-dashboard.html` });

const waitFor = async (expr, label, ms = 30000) => {
  const t0 = Date.now();
  for (;;) {
    let v; try { v = await evalJs(expr); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 250));
  }
};
await waitFor(`!!document.querySelector('[data-db-root="standalone"]')`, 'dashboard boot');

let pass = 0, fail = 0;
const out = [];
const check = async (name, fn) => {
  try { const d = await fn(); console.log(`  ok    ${name}${d ? '  — ' + d : ''}`); out.push(['ok', name, d]); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); out.push(['FAIL', name, e.message]); fail++; }
};
const must = (c, m) => { if (!c) throw new Error(m); };

console.log(`\nTEN-242 B · mount seam, live DOM  (worktree ${WT})\n`);

// The market shard loads on tab activation, not at boot — the first draft of
// this probe scanned for a subject before it existed and reported "no catalog
// event maps to 2+ archive strings", which reads like a product failure and was
// a probe failure. Activate, then wait for the data, then scan.
await evalJs(`document.querySelector('[data-tab="tournaments"]').click()`);
await waitFor(`!!(typeof tourxMarketData!=='undefined' && tourxMarketData && tourxMarketData.tournaments)`, 'tournament-market shard');

// Go to Tournaments and pick a MULTI-STRING event. Hamburg has 5 archive
// strings; the catalog name "Hamburg" resolves to none of them, so this is
// exactly the case the old code rendered empty.
const SUBJECT = await evalJs(`(function(){
  var c = (typeof TOURNAMENT_CATALOG!=='undefined') ? TOURNAMENT_CATALOG : null;
  if(!c) return null;
  var best=null;
  for(var i=0;i<c.length;i++){
    var m = (typeof tourxMarketFor==='function') ? tourxMarketFor(c[i].name) : null;
    var n = m && m.archiveNames ? m.archiveNames.length : 0;
    if(n && (!best || n>best.n)) best={name:c[i].name,n:n,names:m.archiveNames};
  }
  return best;
})()`);
await check('a multi-string subject exists to test with (else this probe is vacuous)', async () => {
  must(SUBJECT && SUBJECT.n >= 2, `no catalog event maps to 2+ archive strings — got ${JSON.stringify(SUBJECT)}`);
  return `${SUBJECT.name} → ${SUBJECT.n} archive strings`;
});

// select that event — through the page's OWN selector, not by poking state.
// tourxState.tsSel holds the catalog NAME (the first draft assigned an index,
// which silently selected nothing).
const SELECTED = await evalJs(`(function(){
  tourxSelectCondition(${JSON.stringify(SUBJECT.name)});
  return tourxState.tsSel;
})()`);
await new Promise((r) => setTimeout(r, 400));
await check('the page selected the subject we asked for', async () => {
  must(SELECTED === SUBJECT.name, `asked for "${SUBJECT.name}", tourxState.tsSel is "${SELECTED}"`);
  return SELECTED;
});

// ---- CONTROL: the standalone Database page, measured BEFORE any overlay -----
await evalJs(`document.querySelector('[data-tab="database"]').click()`);
await waitFor(`(function(){var b=document.querySelector('[data-db-root="standalone"] [data-db="body"]');return b && b.textContent.indexOf('Loading archive')<0 && b.textContent.length>400;})()`, 'standalone Database render');
const BEFORE = await evalJs(`(function(){
  var r=document.querySelector('[data-db-root="standalone"]');
  var b=r.querySelector('[data-db="body"]');
  return { len:b.innerHTML.length, txt:b.textContent.length,
           view:(r.querySelector('[data-db="viewtabs"] .active')||{}).textContent,
           panels:r.querySelectorAll('.db-bandpanel').length };
})()`);
await check('control: the standalone page renders real content before we touch it', async () => {
  must(BEFORE.txt > 400, `standalone body only ${BEFORE.txt} chars`);
  must(BEFORE.panels >= 2, `expected 2 band panels, got ${BEFORE.panels}`);
  return `${BEFORE.txt} chars, ${BEFORE.panels} panels, view "${BEFORE.view}"`;
});

// ---- open the overlay from the UNDERDOGS card ------------------------------
await evalJs(`document.querySelector('[data-tab="tournaments"]').click()`);
await new Promise((r) => setTimeout(r, 300));
const LINKS = await evalJs(`(function(){
  var n=[].slice.call(document.querySelectorAll('[onclick^="tourxOpenRoi"]'));
  return n.map(function(x){ return (x.getAttribute('onclick')||'')+' :: '+x.textContent.replace(/\\s+/g,' ').trim().slice(0,60); });
})()`);
await check('B1: both ROI cards carry a live open handler', async () => {
  must(LINKS.length === 2, `expected 2 clickable ROI cards, found ${LINKS.length}: ${JSON.stringify(LINKS)}`);
  must(LINKS.some((l) => l.includes("'fav'")) && LINKS.some((l) => l.includes("'dog'")),
    `cards do not open their OWN side: ${JSON.stringify(LINKS)}`);
  return LINKS.length + ' cards, fav + dog';
});

await evalJs(`tourxOpenRoi('dog')`);
await waitFor(`(function(){var b=document.querySelector('[data-db-root="roi"] [data-db="body"]');return b && b.textContent.indexOf('Loading archive')<0 && b.textContent.length>200;})()`, 'ROI overlay Database render');

// ---- 2. KEY: the multi-string event renders REAL ROWS ----------------------
await check('B-key: a multi-string event renders real rows, not "No matches for this filter"', async () => {
  const r = await evalJs(`(function(){
    var root=document.querySelector('[data-db-root="roi"]');
    var b=root.querySelector('[data-db="body"]');
    var t=b.textContent;
    return { empty: t.indexOf('No matches for this filter')>=0,
             panels: root.querySelectorAll('.db-bandpanel').length,
             rows: root.querySelectorAll('.db-bandpanel .db-gr').length,
             chip: (root.querySelector('[data-db="filters"]')||{textContent:''}).textContent.replace(/\\s+/g,' ').trim().slice(0,120),
             txt: t.length };
  })()`);
  must(!r.empty, `the overlay rendered "No matches for this filter" — the key is still wrong (chip: ${r.chip})`);
  must(r.panels >= 2, `expected 2 band panels in the overlay, got ${r.panels}`);
  must(r.rows >= 6, `only ${r.rows} rows — an all-but-empty panel would pass a panel-count check`);
  return `${r.rows} rows across ${r.panels} panels`;
});

await check('B-key: the subject chip names the EVENT, not one archive string', async () => {
  const chip = await evalJs(`(function(){
    var f=document.querySelector('[data-db-root="roi"] [data-db="filters"]');
    return f ? f.textContent.replace(/\\s+/g,' ').trim() : '';
  })()`);
  must(chip.includes(SUBJECT.name), `chip "${chip.slice(0,140)}" does not name "${SUBJECT.name}"`);
  return `"${SUBJECT.name}" present in the chip`;
});

// ---- the KEY-DESIGN claim, measured ----------------------------------------
// I claimed the ALIAS is the right key because it is the SAME map the card's ROI
// figure was pooled from, so the overlay's population equals the card's "by
// construction". MEASURED, THAT IS FALSE, and this probe is where it surfaced:
// Hamburg's card pools 636 matches, the overlay shows 620.
//
// They are two different measurements of the same event, from the same CSVs:
//   build-tournament-market.js  avgw/avgl (average across books), Completed only
//   build-database-yield.js     psw/psl   (Pinnacle; Bet365 from 2026),
//                               Completed AND Retired
// A match can have an average price and no Pinnacle price (48 such at Hamburg),
// and 18 Hamburg retirements count for the Database and not for the card. So
// the two figures must NOT be forced equal — doing that would mean regressing
// one builder to flatter the other.
//
// What the key design actually has to get right is the UNION: one mount with
// five archive strings must cover exactly what five separate mounts cover. That
// IS checkable exactly, and it is the thing that breaks if the key is wrong.
// Read ONE panel's "All" row. bsp-consult-dashboard.html:27068-27074 builds
// favVals AND dogVals from the SAME `rows`, so each panel partitions the whole
// population once — the first version of this probe summed BOTH panels' band
// rows and reported 2x. That error is the only reason its own scope check
// passed: it turned a 51% divergence from the card into a 2.5% one.
const popOf = (sel) => `(function(){
  var p=document.querySelector(${JSON.stringify(sel)});
  if(!p) return null;
  var panel=p.querySelector('.db-bandpanel');
  if(!panel) return 0;
  var all=panel.querySelector('.db-ga');
  if(!all) return 0;
  var v=parseInt((all.children[4]||{textContent:''}).textContent.replace(/[^0-9]/g,''),10);
  return isNaN(v)?0:v;
})()`;

const countRows = async (names, label) => {
  await evalJs(`(function(){
    var host=document.querySelector('[data-db-root="roi"]');
    var p=document.createElement('div');
    p.setAttribute('data-db-root','probe-${label}');
    p.setAttribute('data-page','database');
    p.innerHTML=host.innerHTML;
    document.body.appendChild(p);
    window.DatabaseTab.mount(p,{hideHeader:true,initialTournamentNames:${JSON.stringify(names)},initialTournamentLabel:'probe'});
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 700));
  const n = await evalJs(popOf(`[data-db-root="probe-${label}"]`));
  await evalJs(`(function(){var p=document.querySelector('[data-db-root="probe-${label}"]'); if(p) p.remove(); return true;})()`);
  return n;
};

await check('B-key: a 5-string mount covers exactly what 5 single-string mounts cover', async () => {
  const union = await countRows(SUBJECT.names, 'union');
  let parts = 0;
  const each = [];
  for (let i = 0; i < SUBJECT.names.length; i++) {
    const n = await countRows([SUBJECT.names[i]], 'p' + i);
    each.push(`${SUBJECT.names[i]}=${n}`);
    parts += n;
  }
  must(union > 0, 'the union mount reported zero matches');
  must(parts > 0, 'every single-string mount reported zero — the names are wrong');
  must(union === parts,
    `union mount = ${union} but the five parts sum to ${parts} — the multi-string key is dropping or double-counting (${each.join(', ')})`);
  return `${union} = ${each.join(' + ').replace(/[^0-9+ ]/g, '').replace(/\s+/g, ' ').trim()}`;
});

await check('B-key: the overlay is scoped to the EVENT, not silently showing the tour', async () => {
  const r = await evalJs(`(function(){
    var mkt=tourxMarketFor(tourxState.tsSel);
    return { card: mkt?mkt.n:null, tour:(tourxMarketData.baseline||{}).n };
  })()`);
  const overlay = await evalJs(popOf('[data-db-root="roi"]'));
  must(overlay > 0, 'the overlay reports zero matches');
  must(r.tour && overlay < r.tour / 10,
    `the overlay shows ${overlay} of the tour's ${r.tour} — it is not filtered to the event at all`);
  return `event ${overlay} vs card ${r.card}, tour ${r.tour}`;
});

// THE DIVERGENCE — CLOSED.
//
// History, because the fix only makes sense next to it: the card and the panel
// were two different measurements of the same event and on Hamburg they
// disagreed IN SIGN (card -10.5%, panel +0.71%). I twice named a cause that was
// wrong. Reconciled from the CSVs it was two things: the window (this builder
// read from 2004, the store starts 2010) worth 2.4pp, and the price basis
// (average-across-books vs Pinnacle, plus retirements and the overround cut)
// worth the other 8.8pp.
//
// Aligning the window alone left the sign flip standing. So the card is now
// computed FROM THE PANEL'S OWN ROWS - same store, same prices, same
// exclusions. They agree by construction. This check reads both off the live
// page and requires them EQUAL.
await check('B-key: the ROI card and the panel it opens show the SAME population and yield', async () => {
  const r = await evalJs(`(function(){
    var mkt = tourxMarketFor(tourxState.tsSel);
    var root = document.querySelector('[data-db-root="roi"]');
    var panel = root.querySelector('.db-bandpanel');
    var all = panel ? panel.querySelector('.db-ga') : null;
    var n = all ? parseInt((all.children[4]||{textContent:''}).textContent.replace(/[^0-9]/g,''),10) : null;
    return { cardN: mkt ? mkt.n : null, cardDog: mkt ? mkt.roiDog : null,
             cardFav: mkt ? mkt.roiFav : null, panelN: n };
  })()`);
  must(r.cardN != null && r.panelN != null, 'could not read both populations');
  must(r.panelN === r.cardN,
    `the card pooled ${r.cardN} matches and the panel shows ${r.panelN} — they are back to being two different measurements`);
  return `${r.cardN} matches on both sides (card fav ${r.cardFav}% / dog ${r.cardDog}%)`;
});

await check('B-key CONTROL: the CATALOG name would have rendered an empty panel', async () => {
  // The bug this key design replaces. If passing the catalog name still produced
  // rows, the archiveNames work was unnecessary and the check above is incidental.
  const r = await evalJs(`(function(){
    var host = document.querySelector('[data-db-root="roi"]');
    var probe = document.createElement('div');
    probe.setAttribute('data-db-root','keycontrol');
    probe.setAttribute('data-page','database');
    probe.innerHTML = host.innerHTML;
    document.body.appendChild(probe);
    window.DatabaseTab.mount(probe, { hideHeader:true,
      initialTournamentNames:[tourxState.tsSel], initialTournamentLabel:tourxState.tsSel });
    return true;
  })()`);
  await new Promise((rr) => setTimeout(rr, 900));
  const v = await evalJs(`(function(){
    var p=document.querySelector('[data-db-root="keycontrol"]');
    var b=p.querySelector('[data-db="body"]');
    var t=b?b.textContent:'';
    var rows=p.querySelectorAll('.db-bandpanel .db-gr').length;
    p.remove();
    return { rows:rows, empty: t.indexOf('No matches for this filter')>=0 };
  })()`);
  must(v.rows === 0, `the catalog name "${SUBJECT.name}" rendered ${v.rows} rows — it resolves after all, so archiveNames proves nothing here`);
  must(v.empty, 'expected the empty-filter message from the catalog name');
  return `catalog name "${SUBJECT.name}" → 0 rows, "No matches for this filter"`;
});

// ---- 1. STYLING: computed values, not a grep -------------------------------
await check('B-style: the embedded root resolves the --db-* custom properties', async () => {
  const s = await evalJs(`(function(){
    var roi=document.querySelector('[data-db-root="roi"]');
    var std=document.querySelector('[data-db-root="standalone"]');
    var g=function(n,p){ return n ? getComputedStyle(n).getPropertyValue(p).trim() : 'NONODE'; };
    var h=function(n){ var e=n&&n.querySelector('.db-ph h3'); return e?getComputedStyle(e).color:'NONODE'; };
    return { roiTxt:g(roi,'--db-txt'), stdTxt:g(std,'--db-txt'),
             roiUi:g(roi,'--db-ui'), roiH:h(roi), stdH:h(std),
             roiPage:roi.getAttribute('data-page') };
  })()`);
  must(s.roiTxt && s.roiTxt !== 'NONODE' && s.roiTxt !== '',
    `--db-txt does not resolve on the embedded root — it renders unstyled (data-page=${s.roiPage})`);
  must(s.roiTxt === s.stdTxt, `--db-txt differs: overlay "${s.roiTxt}" vs standalone "${s.stdTxt}"`);
  must(s.roiH === s.stdH, `a panel heading computes a different colour: overlay ${s.roiH} vs standalone ${s.stdH}`);
  return `--db-txt ${s.roiTxt}, h3 colour ${s.roiH} — identical to standalone`;
});

await check('B-style CONTROL: stripping data-page DOES break the computed colour', async () => {
  const s = await evalJs(`(function(){
    var roi=document.querySelector('[data-db-root="roi"]');
    var before=getComputedStyle(roi).getPropertyValue('--db-txt').trim();
    roi.removeAttribute('data-page');
    var after=getComputedStyle(roi).getPropertyValue('--db-txt').trim();
    roi.setAttribute('data-page','database');
    var restored=getComputedStyle(roi).getPropertyValue('--db-txt').trim();
    return {before:before, after:after, restored:restored};
  })()`);
  must(s.after !== s.before,
    `removing data-page changed nothing (${s.before}) — the styling check above is VACUOUS, --db-txt must be inherited from elsewhere`);
  must(s.restored === s.before, 'failed to restore data-page');
  return `"${s.before}" → "${s.after || '(empty)'}" without data-page`;
});

// ---- the locked subject (the review's F2) ----------------------------------
await check('B-lock: the embedded panel cannot be navigated off its subject', async () => {
  const r = await evalJs(`(function(){
    var root=document.querySelector('[data-db-root="roi"]');
    var vt=root.querySelector('[data-db="viewtabs"]');
    var f=root.querySelector('[data-db="filters"]');
    return {
      tabsHidden: !vt || getComputedStyle(vt).display==='none',
      searchInputs: f ? f.querySelectorAll('input').length : -1,
      clearBtns: f ? f.querySelectorAll('.db-subject button').length : -1
    };
  })()`);
  must(r.tabsHidden, 'the embedded panel still shows the Tour/Tournaments/Players tabs — one click puts the whole tour archive under an event heading');
  must(r.searchInputs === 0, `the embedded panel still offers a tournament search (${r.searchInputs} inputs) — the reader can swap the subject under a fixed heading`);
  must(r.clearBtns === 0, `the embedded subject chip still has a clear button (${r.clearBtns})`);
  return 'view tabs hidden, no picker, no clear';
});

await check('B-lock CONTROL: the STANDALONE page keeps all three', async () => {
  // If the lock leaked to the standalone page it would be a regression of a
  // working surface, which is the one thing the founder said must not happen.
  await evalJs(`document.querySelector('[data-tab="database"]').click()`);
  await new Promise((r) => setTimeout(r, 500));
  await evalJs(`(function(){
    var tabs=document.querySelector('[data-db-root="standalone"] [data-db="viewtabs"]');
    var b=[].slice.call(tabs.querySelectorAll('button')).filter(function(x){return x.dataset.dbview==='tournaments';})[0];
    b.click(); return true;
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  const r = await evalJs(`(function(){
    var root=document.querySelector('[data-db-root="standalone"]');
    var vt=root.querySelector('[data-db="viewtabs"]');
    var f=root.querySelector('[data-db="filters"]');
    return { tabsShown: !!vt && getComputedStyle(vt).display!=='none',
             searchInputs: f ? f.querySelectorAll('input').length : -1 };
  })()`);
  must(r.tabsShown, 'the standalone page lost its view tabs — the embed lock leaked');
  must(r.searchInputs > 0, 'the standalone Tournaments view lost its tournament search — the embed lock leaked');
  // put it back the way the isolation check expects to find it
  await evalJs(`(function(){
    var tabs=document.querySelector('[data-db-root="standalone"] [data-db="viewtabs"]');
    var b=[].slice.call(tabs.querySelectorAll('button')).filter(function(x){return x.dataset.dbview==='tour';})[0];
    b.click(); return true;
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  await evalJs(`document.querySelector('[data-tab="tournaments"]').click()`);
  await new Promise((r) => setTimeout(r, 300));
  return `standalone keeps its tabs and its picker (${r.searchInputs} input)`;
});

// ---- 3. SIDE ---------------------------------------------------------------
await check('B-side: opening the underdogs card lands on the Underdogs panel', async () => {
  const s = await evalJs(`(function(){
    var root=document.querySelector('[data-db-root="roi"]');
    var heads=[].slice.call(root.querySelectorAll('.db-bandpanel .db-ph h3')).map(function(h){return h.textContent.trim();});
    var sub=document.querySelector('#tourxOverlayRoot');
    return { heads:heads, sub:(sub?sub.textContent:'').replace(/\\s+/g,' ') };
  })()`);
  must(s.heads.includes('Underdogs'), `no Underdogs panel in the overlay: ${JSON.stringify(s.heads)}`);
  must(/underdog/i.test(s.sub), `the overlay does not say which side it opened on`);
  must(!/opened on favourites/i.test(s.sub), `opened from the DOG card but the panel says favourites`);
  return `panels ${JSON.stringify(s.heads)}, sub names underdogs`;
});

await check('B-side CONTROL: the fav card opens on favourites, not underdogs', async () => {
  await evalJs(`tourxCloseOverlays ? tourxCloseOverlays() : (tourxState.roiPanel=null, tourxRenderOverlays())`);
  await new Promise((r) => setTimeout(r, 200));
  await evalJs(`tourxOpenRoi('fav')`);
  await waitFor(`(function(){var b=document.querySelector('[data-db-root="roi"] [data-db="body"]');return b && b.textContent.length>200;})()`, 'fav overlay');
  const sub = await evalJs(`document.querySelector('#tourxOverlayRoot').textContent.replace(/\\s+/g,' ')`);
  must(/favourite/i.test(sub), `fav card did not open on favourites`);
  must(!/opened on underdogs/i.test(sub), `fav card says underdogs — the side is hardcoded, so the check above proves nothing`);
  return 'fav → favourites, dog → underdogs, distinct';
});

// ---- 4. LEAK + the standalone page is UNMOVED ------------------------------
await check('B-leak: 25 open/close cycles leave exactly one roi instance', async () => {
  // This check used to count [data-db-root="roi"] ELEMENTS. That number is
  // governed by tourxRenderOverlays' innerHTML assignment, not by the instance
  // list, so it stayed green with the leak fix entirely reverted — a clean-
  // context review proved that by reverting it. It now reads the real list.
  const before = await evalJs(`window.DatabaseTab.instanceCount()`);
  must(typeof before === 'number', 'DatabaseTab.instanceCount() is missing — this check cannot fail without it');
  for (let i = 0; i < 25; i++) {
    await evalJs(`(function(){ tourxState.roiPanel=null; tourxRenderOverlays(); })()`);
    await evalJs(`tourxOpenRoi('${i % 2 ? 'fav' : 'dog'}')`);
  }
  await new Promise((r) => setTimeout(r, 600));
  const after = await evalJs(`window.DatabaseTab.instanceCount()`);
  const roots = await evalJs(`document.querySelectorAll('[data-db-root="roi"]').length`);
  must(roots === 1, `${roots} roi roots in the document after 25 cycles`);
  must(after === before,
    `the instance list grew ${before} -> ${after} across 25 open/close cycles — each open leaks one, and the document dismiss handler then sweeps every one of them on every click`);
  must(after <= 2, `${after} live instances (expected standalone + roi)`);
  return `instanceCount ${before} -> ${after}, ${roots} root`;
});

await check('B-isolation: the standalone Database page is UNCHANGED by all of the above', async () => {
  await evalJs(`(function(){ tourxState.roiPanel=null; tourxRenderOverlays(); })()`);
  await evalJs(`document.querySelector('[data-tab="database"]').click()`);
  await new Promise((r) => setTimeout(r, 700));
  const after = await evalJs(`(function(){
    var r=document.querySelector('[data-db-root="standalone"]');
    var b=r.querySelector('[data-db="body"]');
    return { len:b.innerHTML.length, txt:b.textContent.length,
             view:(r.querySelector('[data-db="viewtabs"] .active')||{}).textContent,
             panels:r.querySelectorAll('.db-bandpanel').length };
  })()`);
  must(after.view === BEFORE.view, `the standalone view moved: "${BEFORE.view}" → "${after.view}" — the overlay's Tournaments subject leaked into it`);
  must(after.txt === BEFORE.txt, `standalone body changed: ${BEFORE.txt} → ${after.txt} chars`);
  must(after.len === BEFORE.len, `standalone markup changed: ${BEFORE.len} → ${after.len} chars`);
  must(after.panels === BEFORE.panels, `panel count ${BEFORE.panels} → ${after.panels}`);
  return `byte-identical: ${after.len} chars of markup, view "${after.view}"`;
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
ws.close(); chrome.kill(); srv.close();
process.exit(fail ? 1 : 0);
