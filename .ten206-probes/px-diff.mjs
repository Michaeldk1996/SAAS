import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.argv[2] || 'http://127.0.0.1:8776').replace(/\/$/, '');
const KEYS = process.argv.slice(3).length ? process.argv.slice(3) : ['1980', '379'];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const FAV_LABELS = ['1.01 – 1.20', '1.21 – 1.40', '1.41 – 1.64', '1.65 – 1.99'];
const DOG_LABELS = ['2.00 – 2.49', '2.50 – 3.49', '3.50 – 5.99', '6.00 +'];

async function cdpTarget(dport, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json();
      const pg = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (pg) return pg.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('no CDP target');
}

const dport = 9400 + Math.floor((Date.now() / 997) % 200);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'mktprobe-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`,
  `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

const ws = new WebSocket(await cdpTarget(dport));
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
const jsErrors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    jsErrors.push(((d.exception && d.exception.description) || d.text || '').slice(0, 180));
  }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    throw new Error('eval threw: ' + ((d.exception && d.exception.description) || d.text || '').slice(0, 400));
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}

const checks = [];
const ok = (name, pass, detail) => { checks.push({ name, pass, detail }); };

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,
    get(){return _b;},set(v){if(v){v.requireVerified=()=>true;v.requireAuth=()=>true;}_b=v;}});})();`,
});
await send('Page.navigate', { url: `${BASE}/bsp-consult-dashboard.html` });
for (let i = 0; i < 300; i++) {
  if (await ev(`typeof playerProfiles !== 'undefined' && Object.keys(playerProfiles||{}).length > 0`)) break;
  await sleep(250);
}
console.log(`BASE=${BASE}  keys=${KEYS.join(',')}`);


// ─────────────────────────────────────────────────────────────────────────────
// ITEM 8 · computed-style diff table, page top to bottom, against README v7.
// Every EXPECTED value below is quoted from a named README section; every
// ACTUAL is getComputedStyle off the rendered page. A row with no element
// found is reported MISSING, never silently skipped — that distinction is the
// whole point (an absent selector previously read as a clean pass).
// ─────────────────────────────────────────────────────────────────────────────
const SPEC = [
  // [section, element label, CSS selector-or-finder key, {prop: expected}]
  ['§1 frame',   'back link',   'backLink',    { display:'flex', /* README says inline-flex; the link is a flex ITEM of the profile root, and CSS blockifies a flex item's display -- inline-flex computes to flex. The DECLARED value is the README's verbatim. */ columnGap:'9px', fontSize:'13.5px', fontWeight:'600', color:'rgb(91, 104, 128)', alignSelf:'flex-start' }],
  ['§1 frame',   'back chevron','backIcon',    { width:'16px', height:'16px' }],
  ['§2 header',  'container',   'header',      { borderBottomWidth:'1px', borderBottomColor:'rgba(255, 255, 255, 0.08)', paddingBottom:'26px', display:'flex', alignItems:'flex-start', columnGap:'28px' }],
  ['§2 avatar',  'wrapper',     'avatarWrap',  { width:'118px', height:'118px', position:'relative', flexGrow:'0', flexShrink:'0' }],
  ['§2 avatar',  'disc',        'avatarDisc',  { borderRadius:'50%', borderTopWidth:'1px', borderTopColor:'rgba(91, 155, 255, 0.35)', fontSize:'34px', fontWeight:'700', color:'rgb(106, 174, 255)' }],
  ['§2 avatar',  'rank badge',  'rankBadge',   { position:'absolute', bottom:'-8px', backgroundColor:'rgb(91, 155, 255)', color:'rgb(255, 255, 255)', fontSize:'12px', fontWeight:'700', borderRadius:'999px', padding:'3px 11px', borderTopWidth:'2px', borderTopColor:'rgb(6, 7, 10)' }],
  ['§2 identity','name',        'pname',       { fontSize:'44px', fontWeight:'800', letterSpacing:'-0.88px', lineHeight:'44px', whiteSpace:'nowrap' }],
  ['§2 identity','ATP No. pill','atpPill',     { fontSize:'13px', fontWeight:'600', color:'rgb(91, 104, 128)', backgroundColor:'rgba(159, 178, 212, 0.1)', borderTopWidth:'1px', borderTopColor:'rgba(159, 178, 212, 0.32)', borderRadius:'8px', padding:'6px 12px', whiteSpace:'nowrap' }],
  ['§2 identity','archetype',   'archetype',   { fontSize:'18px', fontWeight:'700', color:'rgb(231, 233, 238)' }],
  ['§2 identity','country/age', 'ctryAge',     { fontSize:'14px', color:'rgb(91, 104, 128)', columnGap:'14px' }],
  ['§2 identity','age divider', 'ageRule',     { width:'1px', height:'13px', backgroundColor:'rgba(255, 255, 255, 0.16)' }],
  ['§2 identity','identity col','identity',    { flexGrow:'1', minWidth:'280px', flexDirection:'column', rowGap:'11px' }],
  ['§2 identity','name row',    'nameRow',     { display:'flex', alignItems:'center', columnGap:'16px', flexWrap:'wrap' }],
  ['§2 live',    'strip',       'liveState',   { flexGrow:'0', flexShrink:'0', display:'flex' }],
  ['§2 live',    'cell label',  'metaLabel',   { fontSize:'9.5px', fontWeight:'600', letterSpacing:'1.33px', textTransform:'uppercase', color:'rgb(91, 104, 128)', whiteSpace:'nowrap' }],
  ['§2 live',    'cell value',  'metaValue',   { fontSize:'15px', fontWeight:'700', whiteSpace:'nowrap' }],
  ['§2 live',    'cell sub',    'metaSub',     { fontSize:'12px', color:'rgb(91, 104, 128)', whiteSpace:'nowrap' }],
  ['§2 live',    'cell body',   'metaCell',    { flexDirection:'column', justifyContent:'flex-end', rowGap:'6px', padding:'0px 20px' }],
  ['§3 ribbon',  'card',        'ribbon',      { backgroundColor:'rgb(10, 13, 20)', borderTopWidth:'1px', borderTopColor:'rgba(255, 255, 255, 0.09)', borderRadius:'12px', padding:'16px 22px', display:'grid', columnGap:'22px', alignItems:'center' }],
  ['§3 ribbon',  'rate',        'ribRate',     { fontSize:'22px', fontWeight:'700', lineHeight:'22px', color:'rgb(91, 155, 255)' }],
  ['§3 ribbon',  'W/L cell',    'wlCell',      { height:'22px', borderRadius:'5px', fontSize:'10px', fontWeight:'700' }],
  ['§3 ribbon',  'col-3 rule',  'ribRule',     { width:'1px', height:'44px', backgroundColor:'rgba(255, 255, 255, 0.09)' }],
  ['§3 ribbon',  'chip',        'chip',        { columnGap:'8px', padding:'7px 10px', borderTopWidth:'1px', borderTopColor:'rgba(255, 255, 255, 0.08)', borderRadius:'8px', whiteSpace:'nowrap', cursor:'pointer' }],
  ['§3 ribbon',  'chip W/L tile','chipTile',   { width:'20px', height:'20px', borderRadius:'5px', fontSize:'10px', fontWeight:'700' }],
  ['§3 ribbon',  'ledger link', 'ledgerLink',  { fontSize:'12.5px', fontWeight:'700', color:'rgb(91, 155, 255)', textDecorationLine:'none', whiteSpace:'nowrap' }],
  ['§5 boxes',   'card',        'box',         { backgroundColor:'rgb(10, 13, 20)', borderTopWidth:'1px', borderTopColor:'rgba(255, 255, 255, 0.09)', borderRadius:'10px', padding:'18px 16px', minHeight:'140px', cursor:'pointer', rowGap:'7px' }],
  ['§5 boxes',   'grid',        'boxGrid',     { display:'grid', gap:'12px' }],
  ['§5 boxes',   'icon',        'boxIcon',     { position:'absolute', top:'14px', right:'14px', color:'rgba(91, 155, 255, 0.3)' }],
  ['§5 boxes',   'title',       'boxTitle',    { fontSize:'13.5px', fontWeight:'700' }],
  ['§5 boxes',   'support',     'boxSupport',  { fontSize:'10.5px', color:'rgb(75, 86, 114)', lineHeight:'14.7px' }],
  ['§6 insight', 'title block', 'insTitleH2',  { fontSize:'22px', fontWeight:'800', letterSpacing:'-0.33px', marginBottom:'16px' }],
  ['§6 insight', 'grid',        'insGrid',     { display:'grid', gap:'16px', alignItems:'stretch' }],
  ['§6 insight', 'card',        'insCard',     { backgroundColor:'rgb(10, 13, 20)', borderTopWidth:'1px', borderTopColor:'rgba(255, 255, 255, 0.09)', borderRadius:'12px', padding:'24px 24px 26px', rowGap:'16px' }],
  ['§6 insight', 'icon tile',   'insIcon',     { width:'36px', height:'36px', borderRadius:'13px' }],
  ['§6 insight', 'title',       'insTitle',    { fontSize:'18.5px', fontWeight:'800', letterSpacing:'-0.185px', lineHeight:'23.125px', color:'rgb(255, 255, 255)' }],
  ['§6 insight', 'body',        'insBody',     { fontSize:'13.5px', color:'rgb(91, 104, 128)', lineHeight:'22.95px' }],
];

const FINDERS = `{
  backLink:   function(){ return document.querySelector('[data-pp2="back"]'); },
  backIcon:   function(){ var b=this.backLink(); return b && b.querySelector('svg'); },
  header:     function(){ var g=document.querySelector('.pp2-grid'); if(!g) return null;
                var all=[].slice.call(document.querySelectorAll('div'));
                return all.filter(function(d){ var c=getComputedStyle(d);
                  return c.borderBottomStyle==='solid' && parseFloat(c.borderBottomWidth)>0 &&
                    /rgba\\(255, 255, 255, 0\\.0[6-9]/.test(c.borderBottomColor) &&
                    d.getBoundingClientRect().width>500; })[0]; },
  avatarWrap: function(){ var d=this.avatarDisc(); return d&&d.parentElement; },
  avatarDisc: function(){ return [].slice.call(document.querySelectorAll('div')).filter(function(d){
                return getComputedStyle(d).borderRadius==='50%' && d.getBoundingClientRect().width===118; })[0]; },
  rankBadge:  function(){ var w=this.avatarWrap(); return w && w.children[1]; },
  pname:      function(){ return [].slice.call(document.querySelectorAll('span,div')).filter(function(d){
                return getComputedStyle(d).fontSize==='44px'; })[0]; },
  atpPill:    function(){ var n=this.pname(); return n && n.parentElement &&
                [].slice.call(n.parentElement.children).filter(function(c){ return c!==n; })[0]; },
  identity:   function(){ var n=this.pname(); return n&&n.parentElement&&n.parentElement.parentElement; },
  nameRow:    function(){ var n=this.pname(); return n&&n.parentElement; },
  liveState:  function(){ var s=this.metaRuleSpan(); return s&&s.parentElement&&s.parentElement.parentElement; },
  archetype:  function(){ var id=this.identity(); return id && id.children[1]; },
  ctryAge:    function(){ var id=this.identity(); return id && id.children[2]; },
  ageRule:    function(){ var r=this.ctryAge(); if(!r) return null;
                return [].slice.call(r.children).filter(function(c){
                  return c.getBoundingClientRect().width<=2; })[0]; },
  metaCell:   function(){ var s=this.metaRuleSpan(); return s && s.nextElementSibling; },
  metaRuleSpan:function(){ return [].slice.call(document.querySelectorAll('span')).filter(function(s){
                var r=s.getBoundingClientRect(), c=getComputedStyle(s);
                return r.width>0&&r.width<=2&&r.height>20&&r.height<200&&
                  /rgba\\(255, 255, 255/.test(c.backgroundColor); })[0]; },
  metaLabel:  function(){ var c=this.metaCell(); return c && c.children[0]; },
  metaValue:  function(){ var c=this.metaCell(); return c && c.children[1]; },
  metaSub:    function(){ var c=this.metaCell(); return c && c.children[2]; },
  ribbon:     function(){ var c=document.querySelector('.pp2-chip');
                return c && c.parentElement && c.parentElement.parentElement; },
  ribRate:    function(){ var r=this.ribbon(); if(!r) return null;
                return r.querySelector('div > div > span'); },
  wlCell:     function(){ var r=this.ribbon(); if(!r) return null;
                return [].slice.call(r.querySelectorAll('div')).filter(function(d){
                  return getComputedStyle(d).height==='22px' && /^(W|L)$/.test(d.textContent); })[0]; },
  ribRule:    function(){ var r=this.ribbon(); if(!r) return null;
                return [].slice.call(r.children).filter(function(d){
                  return getComputedStyle(d).height==='44px'; })[0]; },
  chip:       function(){ return document.querySelector('.pp2-chip'); },
  chipTile:   function(){ var c=this.chip(); return c && c.children[0]; },
  ledgerLink: function(){ return document.querySelector('[data-pp2="ledger"]'); },
  box:        function(){ return document.querySelector('.pp2-box'); },
  boxGrid:    function(){ return document.querySelector('.pp2-grid'); },
  boxIcon:    function(){ var b=this.box(); return b && b.querySelector('svg'); },
  boxTitle:   function(){ var b=this.box(); return b && [].slice.call(b.children).filter(function(k){
                return k.tagName!=='svg'; })[1]; },
  boxSupport: function(){ var b=this.box(); return b && [].slice.call(b.children).filter(function(k){
                return k.tagName!=='svg'; })[2]; },
  insCard:    function(){ return document.querySelector('[data-insight]'); },
  insGrid:    function(){ var c=this.insCard(); return c && c.parentElement; },
  insTitleH2: function(){ var g=this.insGrid(); return g && g.previousElementSibling; },
  insIcon:    function(){ var c=this.insCard(); return c && c.children[0]; },
  insTitle:   function(){ var c=this.insCard(); return c && c.children[1]; },
  insBody:    function(){ var c=this.insCard(); return c && c.children[2]; }
}`;

for (const KEY of KEYS) {
  await ev(`document.querySelector('#mainNav button[data-tab="players"]').click()`);
  await sleep(300);
  await ev(`(async()=>{ if (typeof ensurePlayerProfile==='function') await ensurePlayerProfile(${JSON.stringify(KEY)});
             showPlayerProfileV2(${JSON.stringify(KEY)}); })()`);
  for (let i = 0; i < 80; i++) {
    if (await ev(`(function(){var b=[].slice.call(document.querySelectorAll('.pp2-box'));
      return b.length===8 && !b.some(function(x){return /not loaded|Loading/.test(x.textContent);});})()`)) break;
    await sleep(250);
  }
  const rows = await ev(`(function(){
    var F = ${FINDERS};
    var SPEC = ${JSON.stringify(SPEC)};
    return SPEC.map(function(s){
      var el = null; try { el = F[s[2]](); } catch (e) { el = null; }
      if (!el) return { sec:s[0], el:s[1], missing:true };
      var c = getComputedStyle(el), diffs = [], n = 0;
      Object.keys(s[3]).forEach(function(p){
        n++;
        var got = c[p];
        // padding/gap shorthands come back expanded; compare the shorthand the
        // README writes against the shorthand the engine reports.
        if (String(got) !== String(s[3][p])) diffs.push(p + ': spec ' + s[3][p] + ' | ours ' + got);
      });
      return { sec:s[0], el:s[1], n:n, diffs:diffs };
    });
  })()`);
  let tot = 0, bad = 0;
  console.log(`\n${'='.repeat(90)}\nITEM 8 · computed-style diff table — key ${KEY}\n${'='.repeat(90)}`);
  for (const r of rows) {
    if (r.missing) { console.log(`MISSING  ${r.sec.padEnd(12)} ${r.el}`); bad++; continue; }
    tot += r.n;
    if (!r.diffs.length) console.log(`match    ${r.sec.padEnd(12)} ${r.el.padEnd(14)} ${r.n} props`);
    else { bad += r.diffs.length;
      console.log(`DIFFER   ${r.sec.padEnd(12)} ${r.el.padEnd(14)} ${r.n} props`);
      r.diffs.forEach(function (d) { console.log(`           ${d}`); }); }
  }
  console.log(`\n${tot} properties compared, ${bad} differ.`);
}
console.log('\njsErrors:', jsErrors.length ? jsErrors : 'none');
ws.close(); chrome.kill(); process.exit(0);
