// Reproducible 1400px render of auth.html (Login + OTP) from the CURRENT worktree.
// Zero installs: Node 24 global WebSocket + a spawned headless Chrome via CDP.
// Captures BOTH steps: email (default) and code (?step=code). No BSP stub needed;
// auth.html paints without a session. EXPLICIT CDP viewport (never --window-size).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const WT = process.argv[2];
const OUTDIR = process.argv[3] || WT;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const types = {'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.woff2':'font/woff2','.woff':'font/woff'};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  if (p === '/') p = '/auth.html';
  const fp = path.join(WT, p);
  if (!fp.startsWith(WT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, {'content-type': types[path.extname(fp)] || 'application/octet-stream'});
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = fs.mkdtempSync('/tmp/ch-auth-');
const dport = 9600 + Math.floor(port % 300);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'], {stdio:'ignore'});

async function cdpTarget(){
  for (let i=0;i<60;i++){ try { const l = await (await fetch(`http://127.0.0.1:${dport}/json`)).json(); const pg=l.find(t=>t.type==='page'); if(pg?.webSocketDebuggerUrl) return pg.webSocketDebuggerUrl; } catch {} await sleep(200); }
  throw new Error('no CDP target');
}
function client(ws){ const s=new WebSocket(ws); let id=0; const pend=new Map();
  const ready=new Promise((res,rej)=>{s.onopen=()=>res();s.onerror=rej;});
  s.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
  const send=(method,params={})=>new Promise(res=>{const mid=++id;pend.set(mid,res);s.send(JSON.stringify({id:mid,method,params}));});
  return {ready,send}; }

const c = client(await cdpTarget());
await c.ready;
await c.send('Page.enable'); await c.send('Runtime.enable');
const evaluate = async (expr) => { const r = await c.send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true}); if(r.result?.exceptionDetails) throw new Error('eval threw '+JSON.stringify(r.result.exceptionDetails)); return r.result?.result?.value; };

async function capture(stepUrl, outName, probeExpr){
  await c.send('Emulation.setDeviceMetricsOverride', {width:1400, height:1000, deviceScaleFactor:1, mobile:false});
  await c.send('Page.navigate', {url: stepUrl});
  await sleep(1400); // fonts + auth.js init
  const url = await evaluate('location.href');
  if (!/auth\.html/.test(url)) throw new Error('REDIRECTED away from auth.html to '+url);
  const probe = probeExpr ? await evaluate(probeExpr) : null;
  const dims = await evaluate(`({w:1400,h:Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 900)})`);
  await c.send('Emulation.setDeviceMetricsOverride', {width:1400, height:dims.h, deviceScaleFactor:1, mobile:false});
  await sleep(250);
  const shot = await c.send('Page.captureScreenshot', {format:'png', captureBeyondViewport:true, clip:{x:0,y:0,width:1400,height:dims.h,scale:1}});
  const out = path.join(OUTDIR, outName);
  fs.writeFileSync(out, Buffer.from(shot.result.data,'base64'));
  console.log('SHOT', out, 'height', dims.h, 'PROBE', JSON.stringify(probe));
}

// Email step
await capture(`${base}/auth.html?email=micha.dekegel@hotmail.com`, 'auth-1400-email.png', `(function(){
  var b=document.getElementById('continueBtn');
  return {
    step:'email',
    heading:(document.querySelector('#stepEmail .h1')||{}).textContent,
    sub:(document.querySelector('#stepEmail .sub')||{}).textContent,
    continueDisabled: b? b.disabled : null,
    continueBg: b? getComputedStyle(b).backgroundColor : null,
    continueOpacity: b? getComputedStyle(b).opacity : null,
    inputBorder: getComputedStyle(document.getElementById('email')).borderColor,
    hasStores: !!document.querySelector('.stores'),
    playerA: getComputedStyle(document.querySelector('.mc-a')).color,
    playerB: getComputedStyle(document.querySelector('.mc-b')).color,
    surface: getComputedStyle(document.querySelector('.mc-surface')).color,
    vizColor: getComputedStyle(document.querySelector('.viz-h')).color,
    oddsFont: getComputedStyle(document.querySelector('.mc-odds')).fontFamily
  };
})()`);

// Email step, EMPTY (disabled button reference)
await capture(`${base}/auth.html`, 'auth-1400-email-empty.png', `(function(){
  var b=document.getElementById('continueBtn'); return {disabled:b.disabled, opacity:getComputedStyle(b).opacity};
})()`);

// Code step
await capture(`${base}/auth.html?step=code&email=micha.dekegel@hotmail.com`, 'auth-1400-code.png', `(function(){
  // fill the boxes to mirror the reference (323123) for a faithful side-by-side
  var ins=document.querySelectorAll('#codes .code'); var v='323123';
  for(var i=0;i<ins.length;i++){ ins[i].value=v[i]; }
  return {
    step:'code',
    heading:(document.querySelector('#stepCode .h1')||{}).textContent,
    email:(document.getElementById('codeEmail')||{}).textContent,
    boxes: ins.length,
    verifyBg: getComputedStyle(document.getElementById('verifyBtn')).backgroundColor,
    codeFont: getComputedStyle(ins[0]).fontFamily
  };
})()`);

chrome.kill(); server.close();
process.exit(0);
