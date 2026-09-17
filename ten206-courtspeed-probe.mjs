#!/usr/bin/env node
// TEN-206 §8 · Court speed — real-browser read-back.
//
// Drives headless Chrome over CDP, opens a player profile, opens the Court speed
// modal and reads the PAINTED values out of the DOM: band cards, the CAREER row,
// the panel header, and the eight columns of the match grid. Then it recomputes
// the same figures independently from the raw shards and asserts they agree.
//
// A read proves correctness; a screenshot only proves it painted.
//
// Usage: node ten206-courtspeed-probe.mjs <baseUrl> <playerKey> [playerKey...]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = process.argv[2] || 'http://127.0.0.1:8732';
const KEYS = process.argv.slice(3).length ? process.argv.slice(3) : ['1980'];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function cdpTarget(dport, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const r = await fetch(`http://127.0.0.1:${dport}/json/list`);
      const list = await r.json();
      const pg = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (pg) return pg.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('no CDP target');
}

async function main() {
  const dport = 9400 + Math.floor((Date.now() / 1000) % 200);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ten206cs-'));
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--window-size=1512,982', 'about:blank',
  ], { stdio: 'ignore' });

  const wsUrl = await cdpTarget(dport);
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true,
    });
    if (r.result && r.result.exceptionDetails) {
      throw new Error('eval threw: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  const jsErrors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      jsErrors.push((m.params.exceptionDetails.exception || {}).description || 'exception');
    }
  });

  await send('Page.navigate', { url: `${BASE}/bsp-consult-dashboard.html` });
  // Wait for the module and the eager stores.
  for (let i = 0; i < 160; i++) {
    // `playerProfiles` is a let binding, so it is NOT on window — bare identifier.
    const ok = await evaluate('!!(window.PlayerProfileV2 && window.PlayerProfileV2.mount) && typeof playerProfiles !== "undefined" && Object.keys(playerProfiles||{}).length > 0');
    if (ok) break;
    await sleep(250);
  }

  const out = {};
  for (const key of KEYS) {
    await evaluate(`showPlayerProfileV2(${JSON.stringify(key)})`);
    // The spine, the market shard and the venue map all land lazily.
    for (let i = 0; i < 80; i++) {
      const ready = await evaluate(
        `!!(window.careerHistory && window.careerHistory[${JSON.stringify(key)}] ` +
        `&& window.courtSpeedMap && window.courtSpeedMap.venues)`);
      if (ready) break;
      await sleep(250);
    }
    await evaluate(`(function(){var b=document.querySelector('[data-pp2="box"][data-box="speed"]');` +
      `if(b) b.click(); else { var I=window.PlayerProfileV2._internals; I.state.modal='speed'; window.PlayerProfileV2.repaint(); }})()`);
    await sleep(700);

    const read = await evaluate(`(function(){
      var I = window.PlayerProfileV2._internals;
      var root = document.querySelector('.pp2-speed');
      if (!root) return { error: 'no .pp2-speed in DOM' };
      var left = root.children[0], panel = root.children[1];
      var cards = [].slice.call(left.children).filter(function(n){ return n.getAttribute('data-pp2')==='speed-band' || n.querySelector('span'); });
      function txt(n){ return n ? n.textContent.trim() : null; }
      // band cards = every direct child except the last (the CAREER row)
      var bandEls = [].slice.call(left.children).slice(0, -1);
      var careerEl = left.children[left.children.length - 1];
      var bands = bandEls.map(function(el){
        // card = <span units abs> <div wrapper><div name><div meta></div> <span pct>
        var wrap = el.querySelector(':scope > div');
        var divs = wrap ? [].slice.call(wrap.children) : [];
        return {
          name: txt(divs[0]), meta: txt(divs[1]),
          units: txt(el.querySelector('span[style*="position:absolute"]')),
          pct: txt(el.querySelector(':scope > span:last-child')),
          openable: el.getAttribute('data-pp2') === 'speed-band',
          selected: /rgba\\(91, 155, 255, 0\\.1\\)/.test(getComputedStyle(el).backgroundColor.replace(/\\s/g,' ')) ||
                    getComputedStyle(el).borderColor.indexOf('91, 155, 255') > -1,
          bg: getComputedStyle(el).backgroundColor,
          border: getComputedStyle(el).borderTopWidth + ' ' + getComputedStyle(el).borderTopColor,
          radius: getComputedStyle(el).borderTopLeftRadius,
          padding: getComputedStyle(el).padding,
          nameSize: getComputedStyle(divs[0]).fontSize + '/' + getComputedStyle(divs[0]).fontWeight,
          metaSize: getComputedStyle(divs[1]).fontSize,
          pctSize: (function(){var s=el.querySelector(':scope > span:last-child'); return s?getComputedStyle(s).fontSize+'/'+getComputedStyle(s).fontWeight:null;})()
        };
      });
      var careerDivs = careerEl.querySelectorAll('div');
      var head = panel.children[0], body = panel.children[1];
      var headSpans = [].slice.call(head.querySelectorAll('span')).map(txt);
      var grid = body.querySelector('div[style*="grid-template-columns"]');
      var gcs = grid ? getComputedStyle(grid).gridTemplateColumns : null;
      // walk the flat grid: group rows span 1/-1, match rows are 8 cells
      var rows = [], groups = [];
      if (grid) {
        var kids = [].slice.call(grid.children);
        for (var i = 0; i < kids.length; i++) {
          var k = kids[i];
          if (getComputedStyle(k).gridColumnStart === '1' && k.style.gridColumn) {
            groups.push({ title: txt(k.children[0]), meta: txt(k.children[1]) });
          }
        }
        var cells = kids.filter(function(k){ return !k.style.gridColumn; });
        for (var j = 0; j + 7 < cells.length && rows.length < 6; j += 8) {
          rows.push({
            date: txt(cells[j]),
            dot: { w: getComputedStyle(cells[j+1]).width, h: getComputedStyle(cells[j+1]).height,
                   r: getComputedStyle(cells[j+1]).borderTopLeftRadius, bg: getComputedStyle(cells[j+1]).backgroundColor },
            opp: txt(cells[j+2]), oppFont: getComputedStyle(cells[j+2]).fontFamily.split(',')[0],
            round: txt(cells[j+3]),
            sets: txt(cells[j+4]), setsColor: getComputedStyle(cells[j+4]).color,
            setScores: txt(cells[j+5]),
            h: txt(cells[j+6]), a: txt(cells[j+7])
          });
        }
      }
      return {
        bands: bands,
        career: { label: txt(careerDivs[1]), matches: txt(careerDivs[2]),
                  borderTop: getComputedStyle(careerEl).borderTopColor,
                  text: careerEl.textContent.replace(/\\s+/g,' ').trim() },
        panel: { head: headSpans, bg: getComputedStyle(panel).backgroundColor,
                 border: getComputedStyle(panel).borderTopColor,
                 radius: getComputedStyle(panel).borderTopLeftRadius,
                 bodyH: getComputedStyle(body).height, bodyOverflow: getComputedStyle(body).overflowY,
                 bodyPad: getComputedStyle(body).padding, headPad: getComputedStyle(head).padding },
        gridCols: gcs,
        groups: groups.slice(0, 4),
        rows: rows,
        note: (function(){ var n = root.parentElement.querySelectorAll('div');
          for (var i=n.length-1;i>=0;i--){ var t=n[i].textContent||''; if (t.indexOf('Units cover priced')>-1) return t.replace(/\\s+/g,' ').trim(); } return null; })(),
        internals: (function(){
          var p = window.playerProfiles[${JSON.stringify(key)}];
          p = Object.assign({ key: ${JSON.stringify(key)} }, p);
          I.state.speedSurf = 'all';
          var bs = I.speedBands(p);
          var best = I.speedBestBand(bs);
          return {
            spine: I.speedRows(p).length,
            banded: bs.reduce(function(s,b){return s+b.won+b.lost;},0),
            unbanded: bs.unbanded,
            priced: bs.reduce(function(s,b){return s+b.priced;},0),
            cents: bs.reduce(function(s,b){return s+b.cents;},0),
            best: best ? best.band.band.label : null,
            perBand: bs.map(function(b){return [b.band.label, b.won, b.lost, b.priced];})
          };
        })()
      };
    })()`);
    out[key] = read;

    // Interactions: pick a different openable band, then a surface chip.
    const other = await evaluate(`(function(){
      var els=[].slice.call(document.querySelectorAll('[data-pp2="speed-band"]'));
      var cur=els.filter(function(e){return getComputedStyle(e).borderTopColor.indexOf('91, 155, 255')>-1;})[0];
      var pick=els.filter(function(e){return e!==cur;})[0];
      if(!pick) return null; var v=pick.getAttribute('data-v'); pick.click(); return v;
    })()`);
    await sleep(500);
    out[key].afterBandClick = await evaluate(`(function(){
      var root=document.querySelector('.pp2-speed'); if(!root) return null;
      var head=root.children[1].children[0];
      return { clicked:${JSON.stringify(other)}, head:[].slice.call(head.querySelectorAll('span')).map(function(s){return s.textContent.trim();}) };
    })()`);

    const chip = await evaluate(`(function(){
      var c=[].slice.call(document.querySelectorAll('[data-pp2="speed-surf"]')).filter(function(b){return b.getAttribute('data-v')==='Clay';})[0];
      if(!c) return null; c.click(); return 'Clay';
    })()`);
    await sleep(500);
    out[key].afterClayChip = await evaluate(`(function(){
      var root=document.querySelector('.pp2-speed'); if(!root) return null;
      var left=root.children[0];
      var careerEl=left.children[left.children.length-1];
      return { chip:${JSON.stringify(chip)}, career: careerEl.textContent.replace(/\\s+/g,' ').trim(),
               head: [].slice.call(root.children[1].children[0].querySelectorAll('span')).map(function(s){return s.textContent.trim();}) };
    })()`);
    // reset
    await evaluate(`(function(){var c=[].slice.call(document.querySelectorAll('[data-pp2="speed-surf"]')).filter(function(b){return b.getAttribute('data-v')==='all';})[0]; if(c)c.click();})()`);
    await sleep(300);
  }

  out.__jsErrors = jsErrors;
  console.log(JSON.stringify(out, null, 1));
  ws.close(); chrome.kill();
}
main().catch((e) => { console.error('PROBE FAILED:', e.message); process.exit(1); });
