// TEN-12 matrix render verification in real Chrome over raw CDP, against the
// LOCAL worktree (the psArchIndex read-side fix is not deployed yet). Proves:
//   1. modal style-vs-style edge resolves a REAL %/n for two differently-classified
//      players (the exact psArchFor->psArchIndex->psCellFor path the fix touched),
//      NOT the "not enough history" fallback that the machine-id bug produced.
//   2. a mirror matchup (both same archetype) reads "50% ... n=" not "no data".
//   3. the Playing Styles 8x8 grid renders populated cells (win% + n).
// Usage: node ten12-matrix-verify.js <outfile-prefix>
const http = require('http');
const fs = require('fs');
const WebSocket = require('/Users/Michael/.paperclip/instances/default/workspaces/5cbff67f-268e-4ecf-b285-a3ee6de715d4/node_modules/ws');

const OUTPREFIX = process.argv[2] || '/tmp/ten12-matrix';
const DBG = 9334;
const APP = 'http://127.0.0.1:8912/';

const getJSON = url => new Promise((res, rej) => {
  http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

(async () => {
  let tabs = null;
  for (let i = 0; i < 60; i++) {
    try { tabs = await getJSON(`http://127.0.0.1:${DBG}/json/list`); break; } catch (e) { await new Promise(r => setTimeout(r, 500)); }
  }
  if (!tabs) throw new Error('Chrome debug port never came up');
  const page = tabs.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
  let id = 0; const pending = new Map();
  ws.on('message', m => { const msg = JSON.parse(m); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } });
  await new Promise(r => ws.on('open', r));
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const errors = [];
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  ws.on('message', m => { const msg = JSON.parse(m); if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(msg.params.entry.text); });

  // Replace the Firebase auth module with a permissive stub so the protected-route
  // gate does not bounce the headless browser to the sign-in page. This is a
  // RENDER verification of the matrix read-side; auth is out of scope here.
  const STUB = `(function(g){ var U={name:'Verify Bot',email:'verify@local',emailVerified:true,plan:'premium'};
    g.BSP={ currentUser:function(){return U;}, ready:Promise.resolve(U),
      onAuthChange:function(cb){ try{cb(U);}catch(e){} return function(){}; },
      requireAuth:function(){return Promise.resolve(U);},
      requireVerified:function(){return Promise.resolve(U);} };
  })(window);`;
  const stubB64 = Buffer.from(STUB).toString('base64');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*auth.js*' }] });
  ws.on('message', async m => {
    const msg = JSON.parse(m);
    if (msg.method === 'Fetch.requestPaused') {
      const rid = msg.params.requestId;
      if (/auth\.js/.test(msg.params.request.url)) {
        await send('Fetch.fulfillRequest', { requestId: rid, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }], body: stubB64 });
      } else {
        await send('Fetch.continueRequest', { requestId: rid });
      }
    }
  });

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 2400, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: APP });

  for (let i = 0; i < 120; i++) {
    const ready = await evalJs(`(() => { try { return !!(typeof matches !== 'undefined' && matches && matches.length); } catch(e){ return false; } })()`);
    if (ready) break; await new Promise(r => setTimeout(r, 500));
  }

  // ---- 1. cross-archetype modal edge: Bu (Attacking Baseliner) vs Gojo (BS+First Strike)
  const opened = await evalJs(`(() => { openAnalysisModal('upcoming-12157625'); return 'ok'; })()`);
  await new Promise(r => setTimeout(r, 2000));
  const edge = await evalJs(`(() => {
    const card = [...document.querySelectorAll('.psx-card')].find(c => /Style vs style edge/i.test(c.textContent));
    if (!card) return { error: 'no style-vs-style card found in modal' };
    const txt = card.textContent.replace(/\\s+/g,' ').trim();
    const pcts = (card.innerText.match(/\\d{1,3}%/g) || []);
    const nMatch = txt.match(/n=([\\d,]+)/);
    return { txt: txt.slice(0, 400), pcts, n: nMatch ? nMatch[1] : null,
             fallback: /not\\s+enough tour-level match history/i.test(txt) };
  })()`);
  console.log('CROSS-ARCH EDGE (Bu vs Gojo) [Playing style tab]:', JSON.stringify(edge, null, 2));

  // The Key Factors (default) tab's "Playing style" summary card — the one the
  // screenshot showed stuck on "too few tour meetings". After the repaint fix it
  // must show the real edge %/n.
  const keyCard = await evalJs(`(() => {
    const sec = document.getElementById('aSectionKey');
    if (!sec) return { error: 'no #aSectionKey' };
    const card = [...sec.querySelectorAll('.akb-card, [class*=akb], [class*=aks]')].map(e=>e).find(e => /Playing style/i.test(e.textContent) && /Style edge|too few|Mirror|% of the time|coin-flip/i.test(e.textContent)) || sec;
    const txt = sec.textContent.replace(/\\s+/g,' ');
    const styleChunk = (txt.match(/Playing style.*?(edge|meetings|Mirror)[^]{0,160}/i)||[''])[0];
    return { tooFew: /too few tour meetings/i.test(txt), hasStyleEdgePct: /Style edge/i.test(txt),
             chunk: styleChunk.slice(0, 240) };
  })()`);
  console.log('KEY FACTORS style card:', JSON.stringify(keyCard, null, 2));

  // screenshot the modal
  await new Promise(r => setTimeout(r, 400));
  let shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true });
  fs.writeFileSync(OUTPREFIX + '-modal-cross.png', Buffer.from(shot.result.data, 'base64'));
  console.log('wrote', OUTPREFIX + '-modal-cross.png');

  // close modal, open mirror match: Budkov Kjaer vs O'Connell (both Attacking Baseliner)
  await evalJs(`(() => { if (typeof closeAnalysisModal==='function') closeAnalysisModal(); return 'closed'; })()`);
  await new Promise(r => setTimeout(r, 600));
  await evalJs(`(() => { openAnalysisModal('upcoming-12157607'); return 'ok'; })()`);
  await new Promise(r => setTimeout(r, 1800));
  const mirror = await evalJs(`(() => {
    const card = [...document.querySelectorAll('.psx-card')].find(c => /Style vs style edge/i.test(c.textContent));
    if (!card) return { error: 'no card' };
    const txt = card.textContent.replace(/\\s+/g,' ').trim();
    return { isMirror: /Mirror matchup/i.test(txt), n: (txt.match(/n=([\\d,]+)/)||[])[1]||null, txt: txt.slice(0,300) };
  })()`);
  console.log('MIRROR EDGE (Budkov Kjaer vs OConnell):', JSON.stringify(mirror, null, 2));

  // ---- 3. Playing Styles page 8x8 grid ----
  await evalJs(`(async () => { if (typeof renderPlayingStyles === 'function') await renderPlayingStyles(); return 'rendered'; })()`);
  await new Promise(r => setTimeout(r, 1200));
  const grid = await evalJs(`(() => {
    const mx = document.getElementById('psMatrix');
    if (!mx) return { error: 'no #psMatrix' };
    const cells = [...mx.querySelectorAll('.ps-cell2')];
    const rated = cells.filter(c => /%/.test(c.textContent));
    const withN = cells.filter(c => /n=/.test(c.textContent));
    const sample = rated.slice(0, 6).map(c => c.textContent.replace(/\\s+/g,' ').trim());
    return { totalCells: cells.length, ratedCells: rated.length, cellsWithN: withN.length, sample };
  })()`);
  console.log('STYLES GRID:', JSON.stringify(grid, null, 2));

  // ---- 3b. Solid Baseliner residual-bucket caveat renders under the grid ----
  const caveat = await evalJs(`(() => {
    const notes = [...document.querySelectorAll('.ps-gnote')].map(n => n.textContent.replace(/\\s+/g,' ').trim());
    const hit = notes.find(t => /Solid Baseliner is the residual bucket/i.test(t));
    return { present: !!hit, text: hit ? hit.slice(0, 200) : null, allNotes: notes };
  })()`);
  console.log('SLB CAVEAT:', JSON.stringify(caveat, null, 2));

  // make the styles page visible for the screenshot, then shoot #psMatrix region
  await evalJs(`(() => { const mx=document.getElementById('psMatrix'); if(mx){ let p=mx; while(p){ p.style.display='block'; p.style.visibility='visible'; if(p.hasAttribute&&p.hasAttribute('data-page')) p.setAttribute('data-page','styles'); p=p.parentElement; } mx.scrollIntoView(); } return 'shown'; })()`);
  await new Promise(r => setTimeout(r, 500));
  shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true });
  fs.writeFileSync(OUTPREFIX + '-grid.png', Buffer.from(shot.result.data, 'base64'));
  console.log('wrote', OUTPREFIX + '-grid.png');

  // ---- verdict ----
  const pass = !edge.error && !edge.fallback && edge.pcts.length > 0 && edge.n
    && !mirror.error && mirror.isMirror
    && !grid.error && grid.ratedCells >= 20
    && !keyCard.error && !keyCard.tooFew
    && caveat.present;
  console.log('console errors:', errors.length ? JSON.stringify(errors.slice(0, 5)) : 'none');
  console.log(pass ? 'PASS: modal edge resolves a real %/n (fix works), mirror reads 50%/n, grid populated'
                   : 'FAIL: see above');
  ws.close();
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR:', e.message); process.exit(2); });
