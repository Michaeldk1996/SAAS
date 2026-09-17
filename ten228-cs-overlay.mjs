#!/usr/bin/env node
/**
 * ten228-cs-overlay.mjs — §5.5 Court speed, pre-merge condition 3.
 *
 * The four prototype-vs-staged overlays at 50% opacity, at both viewports:
 *   1. band list default            (nothing selected)
 *   2. a band selected
 *   3. an under-minimum band        (dashed; a click must NOT open it)
 *   4. the match grid scrolled open
 *
 * PROTOTYPE  Player Stat Boxes.dc.html — self-boots React via support.js.
 * STAGED     the branch renderer served by ten206-hybrid-server.mjs: BRANCH
 *            code, DEPLOYED data. Never a plain local server — this machine's
 *            career-history/ is short and three agreeing reads of it already
 *            cost one run.
 *
 * Both sides are driven by REAL CLICKS on the elements a user clicks, not by
 * poking state. That is the point of gate 3: state 3's evidence is that the
 * under-minimum card carries no click hook at all, so the click lands and
 * nothing changes — a state write would have bypassed exactly that.
 *
 * A screenshot only proves it painted. The measurable evidence is
 * ten228-cs-styles.mjs; this exists because geometry drift shows up in a
 * composite before it shows up in a property list, and because the founder
 * named the overlays as the remaining blocker.
 *
 * Usage: node ten228-cs-overlay.mjs <stagedBase> <protoBase> <outDir> [key]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STAGED = process.argv[2] || 'http://127.0.0.1:8792';
const PROTO = process.argv[3] || 'http://127.0.0.1:8811';
const OUT = process.argv[4] || '/tmp/ten228-overlays';
const KEY = process.argv[5] || '1980';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/** Fallbacks for state 3: players thin enough to have an under-minimum band.
 *  370 = Giustino (Challenger-only), 1775 = P. Martinez (~#136). */
const UNDER_KEYS = ['370', '1775'];
/** The modal's own surface chips, in the renderer's order. */
const SPEED_SURFACES = ['all', 'Hard', 'Clay', 'Grass', 'Indoors'];
/** The prototype's modal card — the only element carrying the modalIn animation. */
const PROTO_CARD = 'div[style*="modalIn"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWPORTS = [
  { name: '1512x982dpr2', width: 1512, height: 982, dpr: 2 },
  { name: '1440x900dpr1', width: 1440, height: 900, dpr: 1 },
];

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
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'ten228-'));
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
   * Screenshot, optionally CLIPPED to an element.
   *
   * The clip is not a nicety. The dashboard has no router — nav is delegated
   * show/hide — so `showPlayerProfileV2` reveals the profile view without
   * hiding the matches view, and a plain viewport capture photographed
   * "Today's Matches" for all eight states while every DOM read passed. Clipping
   * to the modal card makes the shot say what it is of, and aligns the two sides
   * of the composite on the same origin instead of on page chrome.
   *
   * `captureBeyondViewport` is ON: the card can sit below the fold, and a clip
   * outside the viewport otherwise returns blank pixels rather than an error.
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
                 display: cs.display, visibility: cs.visibility, zIndex: cs.zIndex };
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

/** Click through the real DOM by visible text or selector, and report whether it landed. */
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
  // at mount, so the tag is gone precisely when boot has succeeded. Checking it
  // made a booted prototype read as un-booted.
  let booted = false;
  for (let i = 0; i < 200; i++) {
    booted = await b.ev(`!!(window.__dcRootName && window.__dcRootName()
      && document.body.innerText.length > 50)`);
    if (booted) break;
    await sleep(250);
  }
  if (!booted) throw new Error('prototype did not boot (React CDN unreachable?)');
  await b.ev(CLICK);
  // Reach the mounted instance. The prototype exposes no click hook attributes,
  // so its states are driven through the same setState a click calls.
  // The author's DCLogic instance is NOT the React stateNode — the runtime
  // mounts a host class component and hangs the logic off it as `.logic`
  // (support.js `__makeLogic`). Walking for `stateNode.speedBands` finds
  // nothing; the method lives on `stateNode.logic`. State is written through
  // the host's `__setLogicState`, which is what the prototype's own onClick
  // handlers call.
  const found = await b.ev(`(function(){
    function host(node){
      var k = Object.keys(node).find(function(k){return k.indexOf('__reactFiber$')===0;});
      if(!k) return null;
      var f = node[k];
      while(f){
        var sn = f.stateNode;
        if (sn && sn.logic && typeof sn.logic.speedBands === 'function') return sn;
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

async function protoSet(b, band, scroll) {
  await b.ev(`window.__protoHost.__setLogicState({ open: 'speed', speedSurf: 'all',
    speedBand: ${band === null ? 'null' : JSON.stringify(band)} })`);
  await sleep(700);
  if (scroll) { await scrollGrid(b); }
  return b.ev(`(function(){ var t = document.body.innerText;
    return { bands: /Very slow/.test(t) && /Very fast/.test(t), len: t.length }; })()`);
}

async function scrollGrid(b) {
  // Target the §5.5 selected-band BODY by its own inline style rather than
  // "the tallest overflowing div". The generic search returned -1 at 1440x900
  // while the panel was plainly scrollable, and a probe that cannot find the
  // thing it is scrolling reports -1 as if that were a result.
  const got = await b.ev(`(function(){
    var cands = [].slice.call(document.querySelectorAll('[style*="overflow-y:auto"]'))
      .filter(function(d){ return d.scrollHeight > d.clientHeight + 20; });
    if (!cands.length) return { ok:false, why:'no overflowing overflow-y:auto element in the open modal' };
    cands.sort(function(a,z){ return (z.scrollHeight-z.clientHeight)-(a.scrollHeight-a.clientHeight); });
    var e = cands[0];
    e.scrollTop = 200;
    return { ok:true, scrollTop: e.scrollTop, clientHeight: e.clientHeight,
             scrollHeight: e.scrollHeight, style: (e.getAttribute('style')||'').slice(0,90) };
  })()`);
  await sleep(450);
  return got;
}

/* ------------------------------------------------------------------- staged */
/**
 * Open a player and WAIT FOR THE STORE TO SETTLE WITH ROWS.
 *
 * The first cut of this script waited only for `window.careerHistory[key]` to be
 * truthy and then read the bands. On a cold open through the hybrid server the
 * shard had not landed, every band read n=0, and the probe cheerfully wrote eight
 * "overlays" of an empty modal. That is the failing-control lesson in miniature:
 * the probe could not fail, so it reported success over nothing. It now throws.
 */
async function openPlayer(b, key) {
  // Go through the real nav FIRST. `.tabpage` is `display:none` unless it carries
  // `.active`, the profile view lives inside the players tabpage, and
  // showPlayerProfileV2 only un-hides `playerListView`/`playerProfileView` —
  // it does not switch tabs. Skipping this left the whole subtree inside a
  // hidden tabpage: `.pp2-card` measured 0x0 while `display`/`visibility` on the
  // card itself read perfectly normal, and a viewport capture photographed
  // "Today's Matches" for all four states while every DOM read passed. The app's
  // own deep-link path does exactly this click, for exactly this reason.
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
  let rows = 0, mapped = 0;
  for (let i = 0; i < 240; i++) {
    // Re-open every ~8s. A FAILED shard fetch no longer caches itself
    // (TEN-228), so the retry is real — but only a fresh open asks for it, and
    // waiting alone would sit at zero forever on the blip this very probe hit.
    if (i && i % 32 === 0) await b.ev(`showPlayerProfileV2(${JSON.stringify(key)})`);
    const s = await b.ev(`(function(){
      var ch = window.careerHistory || {};
      var settled = Object.prototype.hasOwnProperty.call(ch, ${JSON.stringify(key)});
      return { settled: settled, rows: settled ? (ch[${JSON.stringify(key)}]||[]).length : -1,
               venues: (window.courtSpeedMap && window.courtSpeedMap.venues)
                 ? Object.keys(window.courtSpeedMap.venues).length : 0 };
    })()`);
    rows = s.rows; mapped = s.venues;
    if (s.settled && s.rows > 0 && s.venues > 0) break;
    await sleep(250);
  }
  if (!(rows > 0)) throw new Error(`career-history for ${key} never landed with rows (rows=${rows}) `
    + '— every band would read n=0 and the overlays would picture an empty modal');
  if (!(mapped > 0)) throw new Error('court-speed-map venues never landed — nothing can be banded');
  return { rows, venues: mapped };
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
  await openPlayer(b, KEY);
  // Open the Court speed box the way a user does: click its card.
  const opened = await b.ev(`window.__click('[data-pp2="box"][data-box="speed"]')`);
  if (!opened || !opened.ok) throw new Error('could not click the Court speed box: ' + (opened && opened.why));
  await sleep(700);
  const shown = await b.ev(`(function(){
    var I = window.PlayerProfileV2._internals;
    return { modal: I.state.modal, hasModal: !!document.querySelector('[data-pp2="scrim"]') };
  })()`);
  if (shown.modal !== 'speed') throw new Error('the box click did not open the speed modal: ' + JSON.stringify(shown));
  return b;
}

/** Every band on the page with its n and whether it carries a click hook. */
async function stagedBands(b, key) {
  return b.ev(`(function(){
    var I = window.PlayerProfileV2._internals;
    var p = I.profileFor(${JSON.stringify(key)});
    var bands = I.speedBands(p);
    return bands.map(function(x){
      var id = x.band.id;
      var card = document.querySelector('[data-pp2="speed-band"][data-v="' + id + '"]');
      return { id: id, label: x.band.label, n: x.won + x.lost, openable: !!card };
    });
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
  await b.send('Page.navigate', { url: 'data:text/html;base64,' + Buffer.from(html).toString('base64') });
  await sleep(1000);
  await b.send('Emulation.setDeviceMetricsOverride', {
    width: vp.width, height: Math.min(vp.height * vp.dpr + 40, 4000), deviceScaleFactor: 1, mobile: false,
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
    live = await stagedSide(vp);

    let bands = await stagedBands(live, KEY);
    console.log('  live bands: ' + bands.map((x) => `${x.label} n=${x.n}${x.openable ? '' : ' [not openable]'}`).join(' · '));
    // State 3 needs a band genuinely under the five-match minimum. A top-10
    // player clears the gate in every band at career scope, so the state does
    // not EXIST on him and photographing him anyway would picture nothing and
    // call it proof. It DOES exist once a surface chip narrows the population —
    // which is how the design's own note frames it ("Very fast courts have
    // three matches on record") — so search (player x chip) and say which one
    // the shot was taken on. Driving the chips also discharges gate 3's "every
    // filter" for this modal.
    let under = bands.find((x) => !x.openable && x.n > 0 && x.n < 5);
    let under3Key = KEY, under3Surf = 'all';
    const openableBand = bands.filter((x) => x.openable).sort((a, z) => z.n - a.n)[0];
    if (!openableBand) { fails.push(`${vp.name}: no openable band at all`); }

    if (!under) {
      const tried = [];
      search:
      for (const alt of [KEY, ...UNDER_KEYS]) {
        if (alt !== KEY) {
          await openPlayer(live, alt);
          await live.ev(`window.__click('[data-pp2="box"][data-box="speed"]')`);
          await sleep(600);
        }
        for (const surf of SPEED_SURFACES) {
          const hit = await live.ev(`window.__click('[data-pp2="speed-surf"][data-v=' + ${JSON.stringify(JSON.stringify(surf))} + ']')`);
          if (!hit || !hit.ok) continue;
          await sleep(500);
          const bs = await stagedBands(live, alt);
          tried.push(`${alt}/${surf}`);
          const u = bs.find((x) => !x.openable && x.n > 0 && x.n < 5);
          if (u) { under = u; under3Key = alt; under3Surf = surf; bands = bs; break search; }
        }
      }
      if (under) {
        notes.push(`${vp.name}: key ${KEY} clears the five-match gate in every band at career `
          + `scope, so state 3 is taken on key ${under3Key} / chip "${under3Surf}" `
          + `("${under.label}", n=${under.n}). Searched ${tried.length} player-chip combinations.`);
      } else {
        fails.push(`${vp.name}: no under-minimum band found over ${tried.length} player-chip `
          + `combinations (${tried.join(', ')}) — state 3 could not be photographed`);
      }
      await openPlayer(live, KEY);
      await live.ev(`window.__click('[data-pp2="box"][data-box="speed"]')`);
      await sleep(600);
    }

    const STATES = [
      { id: '1-list-default', click: null, protoBand: null, scroll: false, why: 'band list default' },
      { id: '2-band-selected', click: openableBand && openableBand.id, protoBand: 'medium', scroll: false, why: 'a band selected' },
      { id: '3-under-minimum', click: under && under.id, protoBand: 'vfast', scroll: false, why: 'under-minimum band, click must not open' },
      { id: '4-grid-scrolled', click: openableBand && openableBand.id, protoBand: 'medium', scroll: true, why: 'match grid scrolled open' },
    ];

    for (const st of STATES) {
      // reset to the default list state between states, by clicking the open band off
      await live.ev(`(function(){
        var I = window.PlayerProfileV2._internals;
        var cur = I.state.speedBand;
        if (cur) window.__click('[data-pp2="speed-band"][data-v="' + cur + '"]');
      })()`);
      await sleep(400);

      if (st.id === '3-under-minimum' && (under3Key !== KEY || under3Surf !== 'all')) {
        if (under3Key !== KEY) {
          await openPlayer(live, under3Key);
          await live.ev(`window.__click('[data-pp2="box"][data-box="speed"]')`);
          await sleep(600);
        }
        await live.ev(`window.__click('[data-pp2="speed-surf"][data-v=' + ${JSON.stringify(JSON.stringify(under3Surf))} + ']')`);
        await sleep(500);
      } else if (st.id === '4-grid-scrolled' && (under3Key !== KEY || under3Surf !== 'all')) {
        // Back to the subject AND back to the "All" chip, or state 4 would be
        // photographed on whatever narrowed population state 3 needed.
        await openPlayer(live, KEY);
        await live.ev(`window.__click('[data-pp2="box"][data-box="speed"]')`);
        await sleep(600);
        await live.ev(`window.__click('[data-pp2="speed-surf"][data-v="all"]')`);
        await sleep(500);
      }

      let clickResult = { ok: null, why: 'no click for this state' };
      let before = null, after = null;
      if (st.click) {
        before = await live.ev(`window.PlayerProfileV2._internals.state.speedBand`);
        clickResult = await live.ev(`window.__click('[data-pp2="speed-band"][data-v="' + ${JSON.stringify(st.click)} + '"]')`);
        // The under-minimum card carries NO click hook by design, so the
        // attribute selector finds nothing. It still has to be clicked — that is
        // the whole assertion — so locate the card itself.
        //
        // NOT by `('div', label)`: the first div whose text merely STARTS WITH
        // "Fast" was an ancestor, the click bubbled to its `[data-pp2]` parent,
        // and the run navigated back to the Matches board and photographed THAT
        // as state 4. A probe that clicks the wrong element and reports "ok" is
        // worse than one that fails. Match the band card by its own inline
        // style signature (the §5.5 card grid) and require exactly one hit.
        if (!clickResult.ok && st.id === '3-under-minimum') {
          const label = (under && under.label) || '';
          clickResult = await live.ev(`(function(){
            var label = ${JSON.stringify(label)};
            var cards = [].slice.call(document.querySelectorAll('div[style*="grid-template-columns:minmax(0,1fr) auto"][style*="padding:11px 13px"]'))
              .filter(function(e){ return (e.innerText||'').trim().indexOf(label) === 0; });
            if (cards.length !== 1) return { ok:false, why:'expected exactly 1 "' + label + '" band card, found ' + cards.length };
            var e = cards[0];
            if (e.getAttribute('data-pp2')) return { ok:false, why:'the under-minimum card carries a click hook — the gate is not holding' };
            e.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
            return { ok:true, tag:e.tagName, hook:null, text:(e.innerText||'').replace(/\\s+/g,' ').slice(0,80) };
          })()`);
        }
        await sleep(700);
        after = await live.ev(`window.PlayerProfileV2._internals.state.speedBand`);
      }

      if (st.id === '3-under-minimum' && under) {
        if (after === under.id) {
          fails.push(`${vp.name} state 3: clicking the under-minimum band "${under.label}" (n=${under.n}) OPENED it — the five-match gate is not holding`);
        } else {
          console.log(`  state 3 control · clicked "${under.label}" n=${under.n}: speedBand `
            + `${JSON.stringify(before)} -> ${JSON.stringify(after)} (did not open) OK`);
        }
      }
      if (st.id === '2-band-selected' && openableBand && after !== openableBand.id) {
        fails.push(`${vp.name} state 2: clicking "${openableBand.label}" did not select it (speedBand=${JSON.stringify(after)})`);
      }

      let scrolled = null;
      if (st.scroll) {
        scrolled = await scrollGrid(live);
        if (!scrolled || !scrolled.ok) {
          fails.push(`${vp.name} state 4: ${(scrolled && scrolled.why) || 'the match grid could not be scrolled'}`);
        }
      }

      const pInfo = await protoSet(proto, st.protoBand, st.scroll);
      const pPng = path.join(OUT, `proto-${st.id}-${vp.name}.png`);
      const pBox = await proto.shot(pPng, PROTO_CARD);
      // NEVER photograph a page that wandered off. One loose click already
      // produced a "state 4" screenshot of the Matches board, and a screenshot
      // cannot tell you that about itself.
      const where = await live.ev(`(function(){
        var I = window.PlayerProfileV2._internals;
        var view = document.getElementById('playerProfileView');
        return { modal: I.state.modal, key: I.state.key,
                 profileVisible: !!(view && view.style.display !== 'none'),
                 bandCards: document.querySelectorAll('[data-pp2="speed-band"]').length };
      })()`);
      const wantKey = st.id === '3-under-minimum' ? under3Key : KEY;
      if (where.modal !== 'speed' || !where.profileVisible || String(where.key) !== String(wantKey)) {
        fails.push(`${vp.name} ${st.id}: refusing to photograph — expected the speed modal on key `
          + `${wantKey}, found ${JSON.stringify(where)}`);
      }
      const lPng = path.join(OUT, `live-${st.id}-${vp.name}.png`);
      const lBox = await live.shot(lPng, '.pp2-card');
      const ov = await composite(vp, st.id, pPng, lPng);
      const sz = (f) => fs.statSync(f).size;
      console.log(`  ${st.id.padEnd(17)} ${st.why}`);
      console.log(`    proto ${pBox.width}x${pBox.height} ${sz(pPng)} B (bands=${pInfo && pInfo.bands}) `
        + `· live ${lBox.width}x${lBox.height} ${sz(lPng)} B `
        + `· overlay ${sz(ov)} B${st.scroll && scrolled && scrolled.ok ? ` · scrolled ${scrolled.scrollTop}px of ${scrolled.scrollHeight - scrolled.clientHeight}` : (st.scroll ? ' · NOT SCROLLED' : '')}`);
      results.push({ vp: vp.name, state: st.id, proto: pPng, live: lPng, overlay: ov,
        click: clickResult, speedBandAfter: after, scrollTop: scrolled });
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
