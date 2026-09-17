#!/usr/bin/env node
/**
 * ten228-mr-overlay.mjs — §5.6 Matchup record, the amendment's step (b).
 *
 * The prototype-vs-staged overlays at 50% opacity, at the amendment's own two
 * viewports (1512x982 DPR 2 and 1440x900), in its four states:
 *   1. modal closed-state    chart + rows, nothing selected
 *   2. an archetype selected with its match detail open
 *   3. a player whose win rate leaves the design's 40-80 band (axis extension)
 *   4. an under-minimum row  — the click must land and change nothing
 *
 * State 2 is the founder's own rejected screenshot reproduced on the rebuild:
 * "J. Sinner, Attacking Baseliner selected with its match detail open".
 *
 * PROTOTYPE  Player Stat Boxes.dc.html — self-boots React via support.js.
 * STAGED     the branch renderer served by ten206-hybrid-server.mjs: BRANCH
 *            code, DEPLOYED data. Never a plain local server — this machine's
 *            career-history/ is short and three agreeing reads of it already
 *            cost one run.
 *
 * Infrastructure (CDP, the .tabpage trap, the clip-or-refuse rule, the
 * composite) is lifted verbatim from ten228-cs-overlay.mjs, which is the
 * harness that earned those comments. Only the modal being driven is new.
 *
 * A screenshot only proves it painted; ten228-mr-verify.mjs is the measurable
 * evidence. This exists because geometry drift shows up in a composite before
 * it shows up in a property list, and because the founder named the overlays as
 * the remaining step.
 *
 * Usage: node ten228-mr-overlay.mjs <stagedBase> <protoBase> <outDir> [key]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STAGED = process.argv[2] || 'http://127.0.0.1:8792';
const PROTO = process.argv[3] || 'http://127.0.0.1:8811';
const OUT = process.argv[4] || '/tmp/ten228-mr-overlays';
/** 2072 = J. Sinner — the subject of the screenshot the founder rejected. */
const KEY = process.argv[5] || '2072';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/** The prototype's modal card — the only element carrying the modalIn animation. */
const PROTO_CARD = 'div[style*="modalIn"]';
/** The drill the founder's screenshot has open, if the subject has the row. */
const WANT_ROW = 'Attacking Baseliner';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The amendment's step (a) viewports, verbatim. */
const VIEWPORTS = [
  { name: '1512x982dpr2', width: 1512, height: 982, dpr: 2 },
  { name: '1440x900dpr1', width: 1440, height: 900, dpr: 1 },
];
/** Step (a) state 3 — a player whose win rate leaves the design's 40-80 band.
 *  438 = Mannarino: a genuine 0% All Court Elite row pushes his axis to 0-80. */
const AXIS_KEY = '438';

fs.mkdirSync(OUT, { recursive: true });
const fails = [];
const notes = [];

async function cdpTarget(dport, timeout = 25000) {
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

async function openChrome(vp) {
  const dport = 9700 + Math.floor(Math.random() * 250);
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'ten228mr-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dport}`,
    `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--hide-scrollbars',
    `--window-size=${vp.width},${vp.height}`, 'about:blank'], { stdio: 'ignore' });
  const ws = new WebSocket(await cdpTarget(dport));
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error('eval threw: ' + ((d.exception && d.exception.description) || d.text || JSON.stringify(d)).slice(0, 500));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', {
    width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: false,
  });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){var _b;Object.defineProperty(window,'BSP',{configurable:true,
      get(){return _b;},set(v){if(v){v.requireVerified=()=>true;v.requireAuth=()=>true;}_b=v;}});})();`,
  });
  /**
   * Screenshot, optionally CLIPPED to an element. The clip is not a nicety: the
   * dashboard has no router, so revealing the profile does not hide the matches
   * view and a plain viewport capture photographs "Today's Matches" while every
   * DOM read passes. Refuse on a degenerate box rather than write blank pixels.
   */
  const shot = async (file, clipSel) => {
    const params = { format: 'png', captureBeyondViewport: !!clipSel };
    let box = null;
    if (clipSel) {
      box = await ev(`(function(){
        var e = document.querySelector(${JSON.stringify(clipSel)});
        if(!e) return null;
        var r = e.getBoundingClientRect();
        var cs = getComputedStyle(e);
        return { x: r.x + window.scrollX, y: r.y + window.scrollY,
                 width: Math.round(r.width), height: Math.round(r.height),
                 display: cs.display, visibility: cs.visibility };
      })()`);
      if (!box) throw new Error(`clip target ${clipSel} is not in the DOM`);
      if (!(box.width > 1 && box.height > 1)) {
        throw new Error(`clip target ${clipSel} has a degenerate box `
          + `(${box.width}x${box.height}, display=${box.display}, visibility=${box.visibility}) `
          + '— the shot would be blank');
      }
      params.clip = { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 };
    }
    const r = await send('Page.captureScreenshot', params);
    const data = r.result && r.result.data;
    if (!data) throw new Error('no screenshot data');
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return box;
  };
  return { send, ev, shot, close: () => { try { ws.close(); } catch { /* closing */ } proc.kill(); } };
}

/** Click through the real DOM by selector, and report whether it landed. */
const CLICK = `window.__click = function(sel, text){
  var els = [].slice.call(document.querySelectorAll(sel));
  if (text != null) els = els.filter(function(e){ return (e.innerText||'').trim().indexOf(text) === 0; });
  if (!els.length) return { ok:false, why:'no element for ' + sel + (text?' text='+text:'') };
  var e = els[0]; e.scrollIntoView({block:'center'});
  e.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
  return { ok:true, tag:e.tagName, hook:e.getAttribute('data-pp2') };
};`;

/* ---------------------------------------------------------------- prototype */
async function protoSide(vp) {
  const b = await openChrome(vp);
  await b.send('Page.navigate', { url: `${PROTO}/Player%20Stat%20Boxes.dc.html` });
  // NOT `document.querySelector('x-dc')`: the runtime CONSUMES the raw template
  // at mount, so the tag is gone precisely when boot has succeeded.
  let booted = false;
  for (let i = 0; i < 200; i++) {
    booted = await b.ev(`!!(window.__dcRootName && window.__dcRootName()
      && document.body.innerText.length > 50)`);
    if (booted) break;
    await sleep(250);
  }
  if (!booted) throw new Error('prototype did not boot (React CDN unreachable?)');
  await b.ev(CLICK);
  // The author's DCLogic instance is NOT the React stateNode — the runtime
  // mounts a host class component and hangs the logic off it as `.logic`
  // (support.js `__makeLogic`). `styleMatches` is §5.6's own generator, so it is
  // the right probe for "this is the instance that owns the Matchup record".
  const found = await b.ev(`(function(){
    function host(node){
      var k = Object.keys(node).find(function(k){return k.indexOf('__reactFiber$')===0;});
      if(!k) return null;
      var f = node[k];
      while(f){
        var sn = f.stateNode;
        if (sn && sn.logic && typeof sn.logic.styleMatches === 'function') return sn;
        f = f.return;
      }
      return null;
    }
    var all = document.querySelectorAll('*');
    for (var i=0;i<all.length;i++){
      var h = host(all[i]);
      if(h){ window.__protoHost = h; window.__proto = h.logic; return true; }
    }
    return false;
  })()`);
  if (!found) throw new Error('could not reach the prototype component instance');
  return b;
}

async function protoSet(b, row) {
  await b.ev(`window.__protoHost.__setLogicState({ open: 'styles',
    styleOpen: ${row === null ? 'null' : JSON.stringify(row)} })`);
  await sleep(700);
  // Read the prototype back rather than trusting the write: a silently-ignored
  // key would otherwise photograph the default state twice and call it two states.
  //
  // Read it off `logic.state`, NOT `host.state`. The host's own React state is
  // only `{__v, __err}` — the DCLogic state is a separate object hanging off
  // `.logic`. Reading the host reported `open: undefined` on a prototype that
  // was correctly showing the styles modal, i.e. a correct build read as broken.
  return b.ev(`(function(){
    var t = document.body.innerText, s = window.__proto.state || {};
    return { open: s.open, styleOpen: s.styleOpen,
             hasChart: /BUBBLE SIZE IS MATCH COUNT/i.test(t), len: t.length };
  })()`);
}

/* ------------------------------------------------------------------- staged */
/**
 * Open a player and WAIT FOR THE STORE TO SETTLE WITH ROWS. Waiting only for
 * `careerHistory[key]` to be truthy once produced eight "overlays" of an empty
 * modal: the probe could not fail, so it reported success over nothing.
 */
async function openPlayer(b, key) {
  // Go through the real nav FIRST. `.tabpage` is `display:none` unless it
  // carries `.active`, and showPlayerProfileV2 does not switch tabs — skipping
  // this leaves the whole profile subtree measuring 0x0 while `display` and
  // `visibility` on the card read perfectly normal.
  const nav = await b.ev(`(function(){
    var b = document.querySelector('#mainNav button[data-tab="players"]');
    if (!b) return { ok:false, why:'no #mainNav players button' };
    b.click();
    var pg = document.querySelector('.tabpage[data-page="players"]');
    return { ok: !!(pg && pg.classList.contains('active')),
             why: pg ? 'players tabpage active=' + pg.classList.contains('active') : 'no players tabpage' };
  })()`);
  if (!nav.ok) throw new Error('could not reach the Players tab: ' + nav.why);
  const got = await b.ev(`ensurePlayerProfile(${JSON.stringify(key)})`);
  if (!got) throw new Error(`profiles/${key}.json did not load`);
  await b.ev(`showPlayerProfileV2(${JSON.stringify(key)})`);
  let rows = 0;
  for (let i = 0; i < 240; i++) {
    if (i && i % 32 === 0) await b.ev(`showPlayerProfileV2(${JSON.stringify(key)})`);
    const s = await b.ev(`(function(){
      var ch = window.careerHistory || {};
      var settled = Object.prototype.hasOwnProperty.call(ch, ${JSON.stringify(key)});
      return { settled: settled, rows: settled ? (ch[${JSON.stringify(key)}]||[]).length : -1 };
    })()`);
    rows = s.rows;
    if (s.settled && s.rows > 0) break;
    await sleep(250);
  }
  if (!(rows > 0)) throw new Error(`career-history for ${key} never landed with rows (rows=${rows}) `
    + '— every archetype would read n=0 and the overlays would picture an empty modal');
  return { rows };
}

async function stagedSide(vp) {
  const b = await openChrome(vp);
  await b.send('Page.navigate', { url: `${STAGED}/bsp-consult-dashboard.html` });
  for (let i = 0; i < 240; i++) {
    if (await b.ev(`!!(window.PlayerProfileV2 && window.PlayerProfileV2._internals)
      && typeof playerProfiles !== 'undefined' && Object.keys(playerProfiles || {}).length > 0`)) break;
    await sleep(250);
  }
  await b.ev(CLICK);
  const st = await openPlayer(b, KEY);
  const opened = await b.ev(`window.__click('[data-pp2="box"][data-box="styles"]')`);
  if (!opened || !opened.ok) throw new Error('could not click the Matchup record box: ' + (opened && opened.why));
  await sleep(700);
  const shown = await b.ev(`(function(){
    var I = window.PlayerProfileV2._internals;
    return { modal: I.state.modal, hasModal: !!document.querySelector('[data-pp2="scrim"]') };
  })()`);
  if (shown.modal !== 'styles') throw new Error('the box click did not open the Matchup record modal: ' + JSON.stringify(shown));
  return { b, spineRows: st.rows };
}

/**
 * Every openable archetype row on the page, with its n.
 *
 * `[data-pp2="style-row"]` is carried by THREE things per archetype: the bubble
 * disc, the x-axis label and the list row. The first two are empty SPANs, so
 * taking the first hit per `data-v` read every n as null and concluded no row
 * cleared the five-match minimum — on a Sinner whose Counterpuncher row plainly
 * says "50-1 · 51 matches". Take the node that actually carries the record.
 */
async function stagedRows(b) {
  return b.ev(`(function(){
    var out = {};
    [].slice.call(document.querySelectorAll('[data-pp2="style-row"]')).forEach(function(e){
      var v = e.getAttribute('data-v');
      if (!v) return;
      var txt = (e.innerText||'').replace(/\\s+/g,' ');
      var m = txt.match(/(\\d+) matches/);
      if (!m) return;
      if (!out[v] || +m[1] > out[v].n) out[v] = { label: v, n: +m[1], tag: e.tagName };
    });
    return Object.keys(out).map(function(k){ return out[k]; });
  })()`);
}

/**
 * The list row for one archetype, by the text it carries. Three elements share
 * `[data-pp2="style-row"][data-v=…]` — bubble, axis label, list row — and only
 * the row carries the record, so "the one whose text says N matches" is the
 * selector. Used for the click, and before/after for the drill assertion.
 */
const rowTextExpr = (label) => `(function(){
  var els = [].slice.call(document.querySelectorAll('[data-pp2="style-row"][data-v="' + ${JSON.stringify(label)} + '"]'))
    .filter(function(e){ return /\\d+ matches/.test(e.innerText || ''); });
  if (els.length !== 1) return { ok:false, why:'expected 1 list row, found ' + els.length, chars:0, sample:'' };
  // barRow emits the drill as a SIBLING of the hooked row (player-profile-v2.js
  // :1921 — "'</div>' + (opts.detail || '')"), so the row's OWN innerText is the
  // same 50 chars open or closed. Measuring the row reported a correctly-drilled
  // Attacking Baseliner as painting no detail while the modal card grew
  // 1252px -> 4492px around it. Measure the sibling.
  var sib = els[0].nextElementSibling;
  var t = (sib ? (sib.innerText || '') : '').replace(/\\s+/g,' ');
  return { ok:true, why:null, chars: t.length, sample: t.slice(0, 140) };
})()`;

/**
 * Make the open modal capturable, and put it back afterwards.
 *
 * The scrim is `position:fixed` and scrolls internally, and the renderer scrolls
 * the drilled row into view — so on a tall drill the card's top sits ABOVE the
 * viewport (measured: -638px at scrollY 0). The clip adds `window.scrollY` to a
 * viewport-relative rect, which for a fixed subtree is simply the wrong origin:
 * the capture started above the modal and photographed the profile page's "Back
 * to Players" link as if it were modal content.
 *
 * Flattening the scrim into normal document flow makes the card's rect + scrollY
 * a real document coordinate again, which is what captureBeyondViewport needs.
 */
async function flattenScrim(b) {
  return b.ev(`(function(){
    var s = document.querySelector('[data-pp2="scrim"]');
    if (!s) return { ok:false, why:'no scrim' };
    window.__scrimPrev = s.getAttribute('style') || '';
    s.style.position = 'absolute';
    s.style.top = '0'; s.style.left = '0'; s.style.right = 'auto'; s.style.bottom = 'auto';
    s.style.width = '100%'; s.style.height = 'auto';
    s.style.overflow = 'visible'; s.style.display = 'block';
    window.scrollTo(0, 0);
    var c = document.querySelector('.pp2-card');
    var r = c.getBoundingClientRect();
    return { ok:true, top: Math.round(r.top), height: Math.round(r.height), scrollY: window.scrollY };
  })()`);
}
async function restoreScrim(b) {
  return b.ev(`(function(){
    var s = document.querySelector('[data-pp2="scrim"]');
    if (s && typeof window.__scrimPrev === 'string') s.setAttribute('style', window.__scrimPrev);
    return true;
  })()`);
}

/* ---------------------------------------------------------------- composite */
async function composite(vp, stateId, protoPng, livePng) {
  const b = await openChrome({ ...vp, dpr: 1 });
  const p = fs.readFileSync(protoPng).toString('base64');
  const l = fs.readFileSync(livePng).toString('base64');
  const html = `<!doctype html><html><body style="margin:0;background:#06070a">
    <div id="c" style="position:relative;display:inline-block;line-height:0">
      <img src="data:image/png;base64,${p}" style="display:block">
      <img src="data:image/png;base64,${l}" style="position:absolute;left:0;top:0;opacity:.5">
    </div></body></html>`;
  // file://, not a data: URL. At DPR 2 the two PNGs are ~400 KB and the base64
  // data URL (~550 KB) never finished navigating — the composite came back empty
  // at the exact viewport the amendment names first.
  const htmlPath = path.join(OUT, `.composite-${stateId}-${vp.name}.html`);
  fs.writeFileSync(htmlPath, html);
  await b.send('Page.navigate', { url: 'file://' + htmlPath });
  // Poll, don't sleep. At DPR 2 the two PNGs are ~400 KB, the data URL is ~550 KB
  // and a fixed 1s wait raced the decode — "clip target #c is not in the DOM" is
  // a probe that gave up early, not a missing composite.
  let ready = false;
  for (let i = 0; i < 120; i++) {
    ready = await b.ev(`(function(){
      var c = document.getElementById('c');
      if (!c) return false;
      var im = c.querySelectorAll('img');
      return im.length === 2 && im[0].complete && im[1].complete && im[0].naturalWidth > 0;
    })()`);
    if (ready) break;
    await sleep(250);
  }
  if (!ready) throw new Error('composite images never decoded');
  await b.send('Emulation.setDeviceMetricsOverride', {
    width: vp.width, height: 4000, deviceScaleFactor: 1, mobile: false,
  });
  await sleep(300);
  const out = path.join(OUT, `overlay-${stateId}-${vp.name}.png`);
  await b.shot(out, '#c');
  b.close();
  return out;
}

/* ------------------------------------------------------------------- driver */
const results = [];
for (const vp of VIEWPORTS) {
  console.log(`\n=== viewport ${vp.name} ===`);
  let proto = null, live = null;
  try {
    proto = await protoSide(vp);
    const staged = await stagedSide(vp);
    live = staged.b;

    const rows = await stagedRows(live);
    console.log(`  spine ${staged.spineRows} rows · live archetypes: `
      + rows.map((r) => `${r.label} n=${r.n}`).join(' · '));
    // Prefer the founder's own screenshot subject; fall back to the biggest row
    // and SAY SO, rather than photographing a state the subject does not have.
    let drill = rows.find((r) => r.label === WANT_ROW && r.n >= 5);
    if (!drill) {
      drill = rows.filter((r) => r.n >= 5).sort((a, z) => z.n - a.n)[0];
      if (drill) {
        notes.push(`${vp.name}: key ${KEY} has no openable "${WANT_ROW}" row, so state 2 `
          + `is taken on "${drill.label}" (n=${drill.n}).`);
      }
    }
    if (!drill) { fails.push(`${vp.name}: no archetype row clears the five-match minimum — state 2 cannot be photographed`); }

    // Step (a)'s four states. 3 and 4 are the ones a probe is tempted to skip
    // because they need a different population; both are photographed on a named
    // player and the note says which.
    // The under-minimum row is NOT in `rows`: barRow withholds the click hook
    // from a thin row (`clickable = !!opts.hook && !thin`), so it carries no
    // `data-pp2` at all and the hook query cannot see it. That absence IS the
    // gate, and it is what state 4 has to photograph — so find it by its copy.
    const under = await live.ev(`(function(){
      // Match the barRow CARD by its own grid signature, not by "a div whose
      // text contains the phrase" — three nested divs contain it (card, label
      // column, meta leaf) and the count check rejected all three.
      var hit = [].slice.call(document.querySelectorAll('div[style*="grid-template-columns:minmax(0,1fr) 300px 58px"]'))
        .filter(function(e){ return /below the five-match minimum/.test(e.innerText||''); });
      if (!hit.length) return null;
      var e = hit[hit.length-1];
      var t = (e.innerText||'').replace(/\\s+/g,' ');
      var m = t.match(/(\\d+) matches/);
      return { label: t.split(' ')[0], text: t.slice(0,90), n: m ? +m[1] : null,
               hook: e.getAttribute('data-pp2') };
    })()`);
    if (under && under.hook) {
      fails.push(`${vp.name}: the under-minimum row carries a click hook (${under.hook}) — the five-match gate is not holding`);
    }
    const STATES = [
      { id: '1-modal-default', click: null, key: KEY, why: 'modal default, chart + rows' },
      { id: '2-row-open', click: drill && drill.label, key: KEY, why: 'an archetype selected, detail open' },
      { id: '3-axis-extension', click: null, key: AXIS_KEY, why: 'a player outside the design 40-80 band' },
      { id: '4-under-minimum', click: null, key: KEY, inert: true,
        why: 'an under-minimum row — the click must NOT open it' },
    ];
    if (!under) {
      fails.push(`${vp.name}: key ${KEY} has no row under the five-match minimum — state 4 cannot be photographed`);
    } else {
      notes.push(`${vp.name}: state 4 clicks "${under.text}" (n=${under.n}) on key ${KEY}.`);
    }

    let onKey = KEY;
    for (const st of STATES) {
      // Reset to the default state by clicking any open row off.
      await live.ev(`(function(){
        var I = window.PlayerProfileV2._internals;
        var cur = I.state.styleRow;
        if (cur) window.__click('[data-pp2="style-row"][data-v="' + cur + '"]');
      })()`);
      await sleep(400);

      // State 3 needs a different player; re-open the modal on him, and come
      // back afterwards rather than photographing later states on his data.
      if (st.key !== onKey) {
        await openPlayer(live, st.key);
        const re = await live.ev(`window.__click('[data-pp2="box"][data-box="styles"]')`);
        if (!re || !re.ok) { fails.push(`${vp.name} ${st.id}: could not reopen the box on key ${st.key}`); }
        await sleep(800);
        onKey = st.key;
      }

      let clickResult = { ok: null, why: 'no click for this state' };
      let after = null, closedChars = null;
      if (st.click) {
        const before = await live.ev(rowTextExpr(st.click));
        closedChars = before.chars;
        // Click the LIST ROW, not the bubble. Both carry the hook and both are
        // real user affordances, but the founder's screenshot is of the row
        // selected in the list, and the bubble is an empty 38px disc whose
        // scrollIntoView leaves the list off-frame.
        clickResult = await live.ev(`(function(){
          var els = [].slice.call(document.querySelectorAll('[data-pp2="style-row"][data-v="' + ${JSON.stringify(st.click)} + '"]'))
            .filter(function(e){ return /\\d+ matches/.test(e.innerText || ''); });
          if (els.length !== 1) return { ok:false, why:'expected exactly 1 list row, found ' + els.length };
          var e = els[0]; e.scrollIntoView({block:'center'});
          e.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
          return { ok:true, tag:e.tagName, hook:e.getAttribute('data-pp2') };
        })()`);
        await sleep(700);
        after = await live.ev(`window.PlayerProfileV2._internals.state.styleRow`);
        if (after !== st.click) {
          fails.push(`${vp.name} ${st.id}: clicking "${st.click}" did not open it (styleRow=${JSON.stringify(after)})`);
        }
        // The drill must actually PAINT a detail, not just flip a state flag.
        // Measured as GROWTH of the row's own subtree, not as an absolute char
        // count on `querySelector(...)` — that selector returns the bubble span,
        // and `closest('div')` off it walked up to the plot and read the axis
        // ("EVEN 90% 74% …"), reporting a correctly-drilled row as empty.
        const after2 = await live.ev(rowTextExpr(st.click));
        const detail = {
          ok: after2.ok && after2.chars > closedChars + 60,
          chars: after2.chars, closed: closedChars, sample: after2.sample, why: after2.why,
        };
        if (!detail.ok) fails.push(`${vp.name} ${st.id}: the row opened but painted no detail (${JSON.stringify(detail)})`);
      }

      // State 4's assertion IS the click: the under-minimum card must take a real
      // click and change nothing. A state write would bypass exactly that.
      if (st.inert && under) {
        const before = await live.ev(`window.PlayerProfileV2._internals.state.styleRow`);
        const hit = await live.ev(`(function(){
          var hit = [].slice.call(document.querySelectorAll('div[style*="grid-template-columns:minmax(0,1fr) 300px 58px"]'))
            .filter(function(e){ return /below the five-match minimum/.test(e.innerText||''); });
          if (hit.length !== 1) return { ok:false, why:'expected 1 under-minimum card, found ' + hit.length };
          var e = hit[0];
          if (e.getAttribute('data-pp2')) return { ok:false, why:'it carries a click hook — the gate is not holding' };
          e.scrollIntoView({block:'center'});
          e.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
          return { ok:true, text:(e.innerText||'').replace(/\\s+/g,' ').slice(0,80) };
        })()`);
        await sleep(700);
        const post = await live.ev(`window.PlayerProfileV2._internals.state.styleRow`);
        if (!hit.ok) fails.push(`${vp.name} ${st.id}: ${hit.why}`);
        else if (post !== before) {
          fails.push(`${vp.name} ${st.id}: clicking the under-minimum row changed styleRow `
            + `${JSON.stringify(before)} -> ${JSON.stringify(post)} — it opened`);
        } else {
          console.log(`    inert control · clicked "${hit.text}": styleRow stayed ${JSON.stringify(post)} OK`);
        }
        clickResult = hit;
      }

      const pInfo = await protoSet(proto, st.click ? WANT_ROW : null);
      if (pInfo.open !== 'styles') {
        fails.push(`${vp.name} ${st.id}: the prototype is not on the styles modal (${JSON.stringify(pInfo)})`);
      }
      const pPng = path.join(OUT, `proto-${st.id}-${vp.name}.png`);
      const pBox = await proto.shot(pPng, PROTO_CARD);

      // NEVER photograph a page that wandered off. One loose click already
      // produced a "state 4" screenshot of the Matches board in the §5.5 run,
      // and a screenshot cannot tell you that about itself.
      const where = await live.ev(`(function(){
        var I = window.PlayerProfileV2._internals;
        var view = document.getElementById('playerProfileView');
        return { modal: I.state.modal, key: I.state.key,
                 profileVisible: !!(view && view.style.display !== 'none'),
                 rows: document.querySelectorAll('[data-pp2="style-row"]').length };
      })()`);
      if (where.modal !== 'styles' || !where.profileVisible || String(where.key) !== String(st.key)) {
        fails.push(`${vp.name} ${st.id}: refusing to photograph — expected the Matchup record modal `
          + `on key ${st.key}, found ${JSON.stringify(where)}`);
      }
      const flat = await flattenScrim(live);
      if (!flat.ok) fails.push(`${vp.name} ${st.id}: could not flatten the scrim for capture (${flat.why})`);
      // A flattened card must start at or below the document origin, or the clip
      // is still pointing above the modal.
      if (flat.ok && flat.top < -1) {
        fails.push(`${vp.name} ${st.id}: card top is still ${flat.top}px after flattening — refusing to photograph`);
      }
      const lPng = path.join(OUT, `live-${st.id}-${vp.name}.png`);
      const lBox = await live.shot(lPng, '.pp2-card');
      await restoreScrim(live);
      const ov = await composite(vp, st.id, pPng, lPng);
      const sz = (f) => fs.statSync(f).size;
      console.log(`  ${st.id.padEnd(17)} ${st.why}`);
      console.log(`    proto ${pBox.width}x${pBox.height} ${sz(pPng)} B (styleOpen=${JSON.stringify(pInfo.styleOpen)}) `
        + `· live ${lBox.width}x${lBox.height} ${sz(lPng)} B (styleRow=${JSON.stringify(after)}) · overlay ${sz(ov)} B`);
      results.push({ vp: vp.name, state: st.id, proto: pPng, live: lPng, overlay: ov,
        click: clickResult, styleRowAfter: after, protoState: pInfo,
        protoBox: pBox, liveBox: lBox });
    }
  } catch (err) {
    fails.push(`${vp.name}: ${err.message}`);
    console.log(`  ERROR ${err.message}`);
  } finally {
    if (proto) proto.close();
    if (live) live.close();
  }
}

fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ results, fails, notes }, null, 2));
console.log(`\n${results.length} overlay set(s) written to ${OUT}`);
for (const n of notes) console.log(`NOTE ${n}`);
if (fails.length) { console.log('\nFAILURES:'); for (const f of fails) console.log('  ' + f); }
console.log(fails.length ? `\n${fails.length} check(s) FAILED` : '\nall checks OK');
process.exit(fails.length ? 1 : 0);
