#!/usr/bin/env node
// Black-box CDP harness — drives a REAL headless Chrome over the DevTools
// Protocol using Node's global WebSocket (Node >= 22). ZERO installs: no
// Playwright, no npm deps. This is the same scaffold our verify-*.mjs probes
// use (the one that caught the Key Factors load-order race).
//
// Usage:
//   node cdp_probe.mjs <url> [options]
//
// Flags execute in a FIXED order regardless of how you list them:
//   navigate -> wait(selector|load) -> click -> eval(s) -> shot.
// For anything that needs interleaved action+probe (open modal, read, switch
// tab, read again), write a dedicated probe .mjs that imports this scaffold
// instead of chaining CLI flags (see verify-modal.mjs in the frontend repo).
//
// Options:
//   --wait-selector <css>   Poll until this selector exists (up to --timeout).
//   --wait-ms <n>           Extra settle delay after load/selector (default 400).
//   --eval <expr>           JS expression to evaluate in the page; result is
//                           printed as JSON to stdout. Repeatable.
//   --click <css>           Click the first match of this selector, then settle.
//   --shot <path>           Write a full-page PNG screenshot to <path>.
//   --width <n> --height <n> Viewport (default 1400x1000).
//   --timeout <ms>          Max wait for target/selector (default 15000).
//   --chrome <path>         Chrome binary (default: macOS Google Chrome).
//   --keep-open             Leave Chrome running (for interactive follow-up).
//
// Exit code is 0 on success, 1 on any failure (so it can gate a pipeline).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const a = { evals: [], waitMs: 400, width: 1400, height: 1000, timeout: 15000,
    chrome: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' };
  a.url = argv[0];
  for (let i = 1; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--eval') a.evals.push(argv[++i]);
    else if (k === '--wait-selector') a.waitSelector = argv[++i];
    else if (k === '--wait-ms') a.waitMs = +argv[++i];
    else if (k === '--click') a.click = argv[++i];
    else if (k === '--shot') a.shot = argv[++i];
    else if (k === '--width') a.width = +argv[++i];
    else if (k === '--height') a.height = +argv[++i];
    else if (k === '--timeout') a.timeout = +argv[++i];
    else if (k === '--chrome') a.chrome = argv[++i];
    else if (k === '--keep-open') a.keepOpen = true;
  }
  return a;
}

async function cdpTarget(dport, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${dport}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('no CDP page target within timeout');
}

function client(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = () => res(); ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  return { ready, send, close: () => ws.close() };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.url) { console.error('Usage: node cdp_probe.mjs <url> [options] (see header)'); process.exit(1); }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-probe-'));
  const dport = 9700 + Math.floor(Math.random() * 200);
  const chrome = spawn(a.chrome, ['--headless=new', `--remote-debugging-port=${dport}`,
    `--user-data-dir=${profile}`, '--remote-allow-origins=*', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars', '--force-device-scale-factor=1',
    'about:blank'], { stdio: 'ignore' });

  let code = 0;
  let c;
  try {
    c = client(await cdpTarget(dport, a.timeout));
    await c.ready;
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride',
      { width: a.width, height: a.height, deviceScaleFactor: 1, mobile: false });

    const evaluate = async (expr) => {
      const r = await c.send('Runtime.evaluate',
        { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails || r.exceptionDetails)
        throw new Error('eval threw: ' + JSON.stringify(r.result?.exceptionDetails || r.exceptionDetails));
      return r.result?.result?.value;
    };

    await c.send('Page.navigate', { url: a.url });
    // Recon-then-action: wait for readiness BEFORE probing (the networkidle
    // equivalent). Poll for the selector if given, else a short settle.
    if (a.waitSelector) {
      const deadline = Date.now() + a.timeout;
      let found = false;
      while (Date.now() < deadline) {
        const n = await evaluate(`document.querySelectorAll(${JSON.stringify(a.waitSelector)}).length`).catch(() => 0);
        if (n > 0) { found = true; break; }
        await sleep(150);
      }
      if (!found) throw new Error(`selector not found: ${a.waitSelector}`);
    } else {
      await evaluate(`new Promise(r=>{if(document.readyState==='complete')r();else addEventListener('load',()=>r())})`).catch(() => {});
    }
    await sleep(a.waitMs);

    if (a.click) {
      await evaluate(`(function(){var e=document.querySelector(${JSON.stringify(a.click)}); if(!e) throw new Error('click target missing'); e.click();})()`);
      await sleep(a.waitMs);
    }

    for (const expr of a.evals) {
      const v = await evaluate(expr);
      console.log(JSON.stringify(v));
    }

    if (a.shot) {
      const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(a.shot, Buffer.from(r.result.data, 'base64'));
      console.error(`screenshot -> ${a.shot}`);
    }
  } catch (err) {
    console.error('FAIL:', err.message);
    code = 1;
  } finally {
    if (!a.keepOpen) {
      try { c?.close(); } catch {}
      try { chrome.kill(); } catch {}
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
    } else {
      console.error(`Chrome left running on CDP port ${dport} (pid ${chrome.pid}).`);
    }
  }
  process.exit(code);
}

main();
