// TEN-8 News export-beside-build — end-to-end render check. Serves the dashboard
// with an auth stub + a synthesized news-feed.json (today + yesterday, player-
// attributed), drives #/news, and asserts the export rebuild: no ATP MEN'S pill,
// clean subtitle, "Live feed · updated" order, row1 = All-tournaments + 4 chips,
// row2 = search + Reading/Compact tabs + Last 7 days, Reading cards by default,
// date group headers, Compact wire rows that expand, no amber category badge,
// single footer. Screenshots both modes. Zero installs: Node WebSocket + Chrome.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const WT = process.argv[2] || process.cwd();
const OUTDIR = process.argv[3] || WT;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const src = fs.readFileSync(path.join(WT, 'bsp-consult-dashboard.html'), 'utf8');
const stub = `<script>window.BSP={ready:Promise.resolve(),_u:{uid:"preview",name:"Alex Morgan",displayName:"Alex Morgan",email:"alex.morgan@stennisfy.local",emailVerified:true},currentUser:function(){return this._u;},requireVerified:function(){return Promise.resolve(this._u);},requireAuth:function(){return Promise.resolve(this._u);},onAuthChange:function(cb){try{cb(this._u);}catch(e){}return function(){};},signOut:function(){return Promise.resolve();}};</script>`;
const marker = '<script src="./auth.js"></script>';
if (!src.includes(marker)) throw new Error('auth.js marker not found');
const previewName = '_render-news.html';
fs.writeFileSync(path.join(WT, previewName), src.replace(marker, marker + '\n' + stub));

// Synthetic feed: today (2 items) + yesterday (1), all player-attributed, with a
// long body to exercise the Reading "Read more" clamp.
const longBody = Array.from({length: 7}, (_, i) => `Paragraph ${i+1}. Sinner controlled the baseline exchanges and served with authority throughout the contest, dictating play from the first game.`).join('\n\n');
const feed = { generatedAt: '2026-07-31T14:10:00.000Z', articles: [
  { title: 'Sinner powers into the semi-finals', content: longBody, published_at: '2026-07-31 14:05:00.000', sources: ['ATP Tour'], player_key: 101, player_name: 'J. Sinner' },
  { title: 'Zverev withdraws citing a shoulder injury', content: 'Alexander Zverev has pulled out ahead of his quarter-final.\n\nThe German cited a recurring shoulder problem.', published_at: '2026-07-31 13:35:00.000', sources: ['Reuters'], player_key: 102, player_name: 'A. Zverev' },
  { title: 'Alcaraz eases through in straight sets', content: 'Carlos Alcaraz needed just 84 minutes to advance.', published_at: '2026-07-30 16:05:00.000', sources: ['Tennis Majors'], player_key: 103, player_name: 'C. Alcaraz' },
]};

const types = {'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.woff':'font/woff'};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/' + previewName;
  if (p === '/news-feed.json') { res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify(feed)); }
  const fp = path.join(WT, p);
  if (!fp.startsWith(WT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, {'content-type': types[path.extname(fp)] || 'application/octet-stream'});
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = fs.mkdtempSync('/tmp/ch-news-');
const dport = 9300 + Math.floor(port % 300);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${profile}`,
  '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'], {stdio:'ignore'});

async function cdpTarget() {
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
await c.send('Emulation.setDeviceMetricsOverride', {width:1280, height:1000, deviceScaleFactor:1, mobile:false});
const evaluate = async (expr) => { const r = await c.send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true}); if(r.result?.exceptionDetails) throw new Error('eval threw '+JSON.stringify(r.result.exceptionDetails)); return r.result?.result?.value; };

// capture console errors
const errors = [];
c.send('Runtime.enable');
const rawmsg = (m)=>{};
await c.send('Page.navigate', {url: `${base}/${previewName}`});
// Wait for the app shell, then click the News nav button (tabs switch on click,
// there is no hash route). loadNews() fires from that click handler.
for (let i=0;i<100;i++){ const has = await evaluate(`!!document.querySelector('#mainNav button[data-tab="news"]')`).catch(()=>false); if (has) break; await sleep(150); }
// Activate the News tabpage (the click handler can be undone by the async boot),
// then drive loadNews() directly and await it so the feed actually renders.
await evaluate(`document.querySelector('#mainNav button[data-tab="news"]').click()`);
await sleep(200);
await evaluate(`(function(){document.querySelectorAll('.tabpage').forEach(function(p){p.classList.toggle('active', p.dataset.page==='news');});})()`);
await evaluate(`loadNews()`);
for (let i=0;i<120;i++){ const ready = await evaluate(`(function(){var l=document.getElementById('newsList'); return !!(l && (l.querySelector('.news-card')||l.querySelector('.news-row')||l.querySelector('.news-empty')));})()`).catch(()=>false); if (ready) break; await sleep(150); }

const DIAG = await evaluate(`(function(){
  var nav=document.querySelector('#mainNav button[data-tab="news"]');
  var page=document.querySelector('.tabpage[data-page="news"]');
  var l=document.getElementById('newsList');
  return {
    navFound:!!nav, navText: nav?nav.textContent.trim():null,
    pageActive: page?page.classList.contains('active'):null,
    typeofLoadNews: typeof window.loadNews,
    newsDataType: typeof window._newsData,
    newsDataArticles: (window._newsData&&window._newsData.articles)?window._newsData.articles.length:null,
    listHTMLhead: l? l.innerHTML.slice(0,200) : null,
  };
})()`).catch(e=>({diagErr:String(e)}));
console.log('DIAG', JSON.stringify(DIAG, null, 2));

const READING = await evaluate(`(function(){
  var q=function(s){return document.querySelector(s);};
  var qa=function(s){return [...document.querySelectorAll(s)];};
  var wrap=document.getElementById('newsWrap');
  return {
    hasPill: !!q('[data-page="news"] .news-tourpill'),
    h1: (q('[data-page="news"] .news-head h1')||{}).textContent||'',
    subtitle: (q('[data-page="news"] .news-head p')||{}).textContent||'',
    live: (q('[data-page="news"] .news-live')||{}).textContent||'',
    tourDD: !!q('#newsTourFilter'), tourFirstOpt: (q('#newsTourFilter option')||{}).textContent||'',
    chips: qa('#newsChips .news-chip').map(function(b){return b.textContent;}),
    searchW: q('.news-search') ? Math.round(q('.news-searchwrap').getBoundingClientRect().width) : null,
    tabs: qa('.news-tab').map(function(t){return {t:t.textContent, active:t.classList.contains('active')};}),
    postIntel: !!q('.news-postintel'),
    rangeVal: (q('#newsRange')||{}).value, rangeSelText: (function(){var s=q('#newsRange'); return s? s.options[s.selectedIndex].text:'';})(),
    viewCompact: wrap ? wrap.classList.contains('compact') : null,
    cards: qa('.news-card').length,
    dateHeaders: qa('.news-daterow .news-datelabel').map(function(d){return d.textContent;}),
    amber: qa('[data-page="news"] *').some(function(e){var c=getComputedStyle(e).color; return /232, *168/.test(c) || /245, *158/.test(c);}),
    firstCardTitle: (q('.news-cardtitle')||{}).textContent||'',
    firstCardPlayer: (q('.news-cardplayer')||{}).textContent||'',
    firstCardTime: (q('.news-cardtime')||{}).textContent||'',
    catBadge: (q('.news-cat')||{}).textContent||'',
    readMore: !!q('.news-more'),
    footers: qa('.news-footnote').length,
    footText: (q('#newsFootnote')||{}).textContent||'',
  };
})()`);
console.log('READING', JSON.stringify(READING, null, 2));

// screenshot reading
async function shot(name){
  const dims = await evaluate(`({h:Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)})`);
  await c.send('Emulation.setDeviceMetricsOverride', {width:1280, height:Math.min(2200,dims.h), deviceScaleFactor:1, mobile:false});
  await sleep(150);
  const s = await c.send('Page.captureScreenshot', {format:'png', captureBeyondViewport:true, clip:{x:0,y:0,width:1280,height:Math.min(2200,dims.h),scale:1}});
  const png = path.join(OUTDIR, name); fs.writeFileSync(png, Buffer.from(s.result.data,'base64'));
  await c.send('Emulation.setDeviceMetricsOverride', {width:1280, height:1000, deviceScaleFactor:1, mobile:false});
  console.log('SHOT', png);
}
await shot('news-reading.png');

// switch to Compact
await evaluate(`newsSetView('compact')`);
await sleep(200);
const COMPACT = await evaluate(`(function(){
  var qa=function(s){return [...document.querySelectorAll(s)];};
  var rows=qa('.news-row');
  var first=rows[0];
  var head=first?first.querySelector('.news-rowhead'):null;
  return {
    viewCompact: document.getElementById('newsWrap').classList.contains('compact'),
    rows: rows.length,
    grid: head? getComputedStyle(head).gridTemplateColumns : null,
    time: first? (first.querySelector('.news-rtime')||{}).textContent : null,
    player: first? (first.querySelector('.news-rplayer')||{}).textContent : null,
    headline: first? (first.querySelector('.news-rhead')||{}).textContent : null,
    caret: first? (first.querySelector('.news-rcaret')||{}).textContent : null,
    bodyHiddenBefore: first? getComputedStyle(first.querySelector('.news-rbody')).display : null,
    dateHeaders: qa('.news-daterow .news-datelabel').map(function(d){return d.textContent;}),
    catChipInRow: !!first && !!first.querySelector('.news-cat'),
  };
})()`);
// expand first row
await evaluate(`(function(){var h=document.querySelector('.news-row .news-rowhead'); if(h) h.click();})()`);
await sleep(150);
const EXP = await evaluate(`(function(){var r=document.querySelector('.news-row.open'); return {open:!!r, bodyDisplay: r? getComputedStyle(r.querySelector('.news-rbody')).display : null, paras: r? r.querySelectorAll('.news-rbody p').length : 0, src: r? (r.querySelector('.news-rsrc')||{}).textContent : null };})()`);
console.log('COMPACT', JSON.stringify(COMPACT, null, 2));
console.log('EXPANDED', JSON.stringify(EXP, null, 2));
await shot('news-compact.png');

// admin composer check (force admin)
await evaluate(`window.isBspAdmin=function(){return true;}; _composerOpen=false; newsRenderComposer();`);
const ADMIN1 = await evaluate(`(function(){var b=document.querySelector('.news-postintel'); return {postBtn: b?b.textContent:null};})()`);
await evaluate(`newsToggleComposer()`);
await sleep(100);
const ADMIN2 = await evaluate(`(function(){var p=document.querySelector('.news-composer'); var pub=document.querySelector('.cmp-pub'); return {panel:!!p, label:(document.querySelector('.cmp-label')||{}).textContent, pubText: pub?pub.textContent:null, pubSolid: pub? getComputedStyle(pub).backgroundColor : null };})()`);
console.log('ADMIN', JSON.stringify({...ADMIN1, ...ADMIN2}, null, 2));

// verdict
const ok =
  READING.hasPill===false &&
  READING.h1.trim()==='Tennis News' &&
  READING.subtitle.trim()==='Latest market and tour information' &&
  /Live feed · updated/.test(READING.live) &&
  READING.tourDD===true && /All tournaments/.test(READING.tourFirstOpt) &&
  READING.chips.length===4 &&
  READING.searchW>=340 && READING.searchW<=380 &&
  READING.tabs.length===2 && READING.tabs[0].t==='Reading' && READING.tabs[0].active===true &&
  READING.rangeSelText==='Last 7 days' &&
  READING.viewCompact===false && READING.cards>=3 &&
  READING.dateHeaders.length>=2 &&
  READING.amber===false &&
  READING.readMore===true &&
  READING.footers===1 &&
  COMPACT.viewCompact===true && COMPACT.rows>=3 && COMPACT.catChipInRow===false &&
  COMPACT.bodyHiddenBefore==='none' &&
  EXP.open===true && EXP.bodyDisplay!=='none' && EXP.paras>=1 &&
  ADMIN2.panel===true && /Publish/.test(ADMIN2.pubText||'') &&
  /rgba\(0, 0, 0, 0\)|transparent/.test(ADMIN2.pubSolid||'');
console.log('NEWS_REBUILD_OK', ok);

chrome.kill(); server.close();
try { fs.unlinkSync(path.join(WT, previewName)); } catch {}
process.exit(ok ? 0 : 2);
