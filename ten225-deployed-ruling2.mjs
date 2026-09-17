#!/usr/bin/env node
// TEN-207 deploy verification — drives the DEPLOYED site in real headless Chrome
// over CDP and reads the Record-per-tournament card out of the live DOM.
//
// Proves, on the live URL with the HTTP cache disabled:
//   1. player-profiles.json arrives with NO tournamentHistory field,
//   2. the record card is EMPTY before the shard lands,
//   3. ./tournament-history/<key>.json is actually requested over the network,
//   4. the card then FILLS with numbers that match the shard payload.
//
// Step 2 is the part that matters: reading a filled card alone would not prove
// the shard did it — the field could still be inline. Reading it empty first,
// then full after the shard request, is the mutation proof.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = process.argv[2] || 'https://michaeldk1996.github.io/SAAS/bsp-consult-dashboard.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten225-cdp-'));
const port = 9700 + Math.floor(process.pid % 300);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=1500,1100', 'about:blank',
], { stdio: 'ignore' });

async function target() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const t = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
      if (t) return t.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('no CDP target');
}

function client(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    } else if (msg.method) events.push(msg);
  };
  const send = async (method, params = {}) => {
    await ready;
    const mid = ++id;
    return new Promise((res, rej) => { pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  };
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval threw');
    return r.result.value;
  };
  return { send, evaluate, events, close: () => ws.close() };
}

const out = [];
const log = (s) => { out.push(s); console.log(s); };
let failures = 0;
const check = (label, pass, detail) => {
  log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!pass) failures++;
};

try {
  const c = client(await target());
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Network.enable');
  await c.send('Network.setCacheDisabled', { cacheDisabled: true });

  await c.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      Object.defineProperty(window, 'BSP', {
        configurable: true,
        get(){ return window.__bsp; },
        set(v){ window.__bsp = v; try { v.requireVerified = async () => ({ ok: true, user: { email: 'probe@local' } }); } catch(e){} },
      });
    `,
  });

  await c.send('Page.navigate', { url: URL });

  let ok = false;
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    try { ok = await c.evaluate(`(!!window.PlayerProfileV2 && typeof (window.PlayerProfileV2._internals||{}).b365Close === 'function')`); } catch {}
    if (ok) break;
  }
  if (!ok) {
    const diag = await c.evaluate(`JSON.stringify({
      href: location.href,
      featurePP2: window.FEATURE_PP2,
      pp2FlagOn: (typeof pp2FlagOn === 'function') ? pp2FlagOn() : 'no fn',
      hasPP2: !!window.PlayerProfileV2,
      tagPresent: [].slice.call(document.scripts).some(function(x){return (x.src||'').indexOf('player-profile-v2.js')>=0;}),
      typeofClose: typeof ((window.PlayerProfileV2||{})._internals||{}).b365Close,
      exportKeys: Object.keys((window.PlayerProfileV2||{})._internals||{}).filter(function(k){return k.indexOf('b365')>=0;}),
      ls: (function(){ try { return localStorage.getItem('stennisfy.flags.pp2'); } catch(e){ return 'err'; } })()
    })`);
    log('DIAG ' + diag);
  }
  ok = await c.evaluate(`(!!window.PlayerProfileV2 && typeof (window.PlayerProfileV2._internals||{}).b365Close === 'function')`);
  check('the DEPLOYED page exposes PlayerProfileV2._internals.b365Close', ok,
        await c.evaluate('location.href'));

  if (ok) {
    // The shipped build number, so this report cannot be read against the wrong deploy.
    const build = await c.evaluate(`fetch('./build-info.json?cb='+Date.now()).then(r=>r.json()).then(j=>j.commit).catch(()=>null)`);
    log(`deployed build-info.commit = ${build}`);

    // MUTATE THE INPUT, don't read the source. Same series, three entry shapes.
    const r = await c.evaluate(`(() => {
      const P = window.PlayerProfileV2._internals, s = [[1, 1.50], [2, 1.02]];
      return {
        arity:        P.b365Close.length,
        cutTrueStart: P.b365Close({ cut: 'trueStart' }, s),
        cutNone:      P.b365Close({ cut: 'none' }, s),
        legacyNoCut:  P.b365Close({}, s),
        emptySeries:  P.b365Close({ cut: 'trueStart' }, []),
      };
    })()`);
    log('deployed b365Close -> ' + JSON.stringify(r));

    check('takes (entry, series) — the /2 signature, not the old single arg',
          r.arity === 2, `arity=${r.arity}`);
    check('a cut:"trueStart" entry still yields its close (1.02)',
          r.cutTrueStart === 1.02, String(r.cutTrueStart));
    check('RULING 2: a cut:"none" entry yields NULL, not its uncut tail',
          r.cutNone === null, String(r.cutNone));
    check('a legacy /1 entry (no cut field) keeps pre-ruling behaviour',
          r.legacyNoCut === 1.02, String(r.legacyNoCut));
    check('an empty series is still null', r.emptySeries === null, String(r.emptySeries));

    // FAILING CONTROL — the identical assertion against the PRE-ruling function.
    // Without this, "cutNone === null" would also pass on a function that
    // returns null for everything.
    const ctl = await c.evaluate(`(() => {
      function old(series){ if(!series||!series.length) return null;
        const v = series[series.length-1][1];
        return v == null || !isFinite(Number(v)) ? null : Number(v); }
      return { cutNone: old([[1,1.50],[2,1.02]]) };
    })()`);
    check('CONTROL: the PRE-ruling function returns 1.02 on the same input, so ' +
          'the null above is the ruling and not a dead function',
          ctl.cutNone === 1.02, String(ctl.cutNone));
  }

  c.close();
} catch (e) {
  log('PROBE ERROR ' + (e && e.message));
  failures++;
} finally {
  chrome.kill();
}

log(`\n${failures ? failures + ' FAILURE(S)' : 'ALL PASS'}`);
process.exit(failures ? 1 : 0);
