#!/usr/bin/env node
// Founder ruling 2026-10-25 (post-deploy check): after every successful publish, load the DEPLOYED dashboard in headless
// Chrome and fail + Telegram if the page is broken. The case it exists for: 25 Oct 05:03–10:03Z, f255dca34 declared
// `const _tpLoad` in the dashboard's main inline script beside TEN-339's `let _tpLoad`; the whole script failed to compile
// ("Identifier '_tpLoad' has already been declared"), no page global existed, and members saw a dead page for five hours.
//
// HOW: the deployed bytes are fetched from --base (cache-busted) and served from 127.0.0.1 with ONE change: the sign-in
// redirect call (BSP.requireVerified / BSP.requireAuth) is removed, so nothing is signed in (the same strip as the preview
// proxy). A navigation to auth.html / verify.html is also refused through CDP, as tools/price-consistency.mjs does, in case
// the redirect ever moves. Chrome over CDP, the price guard's harness.
//
// THE CHECKS (`judge`, pure, unit-tested in tools/test-post-deploy-check.mjs):
//   1. no uncaught exception during load (Runtime.exceptionThrown, from navigation until the page is ready + SETTLE_MS);
//   2. <meta name="build-sha"> equals the deployed build-info.json `commit` (the page and its stamp are one build);
//   3. the main view rendered: the page globals the main script declares exist (renderTourxOverview, tpPageEvents,
//      H2HPage, sfDbPxRows — a script that failed to compile declares none of them) AND the default view's list
//      (#matchlist, empty in the HTML) holds an element: renderMatches ran, cards or its own empty-board message.
//      Waited for up to --timeout-ms (default 90 s); never ready by then = a failure.
// CDN LAG: with --expect-run <publish run id>, build-info.json is polled until its runId is that run (up to 10 min), so the
// check reads the build just published; a newer run there is fine (it superseded ours). A page/build-info sha mismatch is
// re-read up to 4 times 30 s apart before it counts: Pages can serve the new HTML and the old build-info for a minute.
// A check that cannot run (page not fetched, Chrome not started) fails the same way, saying so.
// Exit 1 on failure (the run goes red) after the Telegram message; an unsent message is an ::error:: too.
// Usage: node tools/post-deploy-check.mjs [--base URL] [--page FILE] [--expect-run ID] [--alert] [--timeout-ms N]
// Env: CHROME_BIN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_API_URL (tests), RUN_URL, GITHUB_STEP_SUMMARY,
//      POST_DEPLOY_RETRY_MS (tests: the 30 s re-read gap), POST_DEPLOY_SETTLE_MS.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { sendTelegram } from './price-alert-send.mjs';

export const GLOBALS = { renderTourxOverview: 'function', tpPageEvents: 'function', H2HPage: 'object', sfDbPxRows: 'function' };
export const VIEW_ROOT = '#matchlist';
// renderMatches' own text for an empty `matches` array: drawn once before the fixtures arrive, so it is not "rendered"
export const NO_DATA = /No data loaded yet/;
export const DEFAULT_BASE = 'https://michaeldk1996.github.io/SAAS';
export const DEFAULT_PAGE = 'bsp-consult-dashboard.html';
const SHA_RE = /<meta name="build-sha" content="([0-9a-f]{40})">/g;

// The only change made to the deployed bytes: the sign-in redirect call goes. Returns { html, stripped }.
export function stripAuth(html) {
  let n = 0;
  const out = html
    .replace(/BSP\.requireVerified\('auth\.html\?mode=signin', 'verify\.html'\);/g, () => { n++; return '/* post-deploy check: sign-in redirect removed */'; })
    .replace(/BSP\.requireAuth\('auth\.html\?mode=signin'\);/g, () => { n++; return '/* post-deploy check: sign-in redirect removed */'; });
  return { html: out, stripped: n };
}
export const metaShas = (html) => [...String(html).matchAll(SHA_RE)].map((m) => m[1]);

// obs: { pageOk, pageWhy, metaShas, info, infoWhy, errors: [{text, url, line}], ready, globals: {name: typeof}, view: {children, text} }
// → list of failures in plain words (empty = healthy)
export function judge(obs) {
  const f = [];
  if (!obs.pageOk) { f.push(`the page could not be loaded (${obs.pageWhy || 'unknown'})`); return f; }
  for (const e of obs.errors || []) f.push(`uncaught error on load: ${e.text}${e.url ? ` (${e.url.split('/').pop().split('?')[0]}${e.line != null ? ':' + (e.line + 1) : ''})` : ''}`);
  const commit = obs.info && obs.info.commit;
  if (!commit) f.push(`build-info.json has no commit (${obs.infoWhy || 'not read'})`);
  if ((obs.metaShas || []).length !== 1) f.push(`the page carries ${(obs.metaShas || []).length} build-sha meta tags, not 1`);
  else if (commit && obs.metaShas[0] !== commit) f.push(`page build-sha ${obs.metaShas[0].slice(0, 9)} ≠ build-info.json commit ${commit.slice(0, 9)}`);
  const missing = Object.entries(GLOBALS).filter(([k, t]) => (obs.globals || {})[k] !== t).map(([k]) => k);
  if (missing.length) f.push(`page globals missing: ${missing.join(', ')} (the main script did not run)`);
  if (!(obs.view && obs.view.children > 0)) f.push(`the default view (${VIEW_ROOT}) never rendered`);
  else if (NO_DATA.test(obs.view.text || '')) f.push(`the default view never loaded its fixtures ("${obs.view.text.slice(0, 80)}")`);
  return f;
}

export function message(failures, { info, base, runUrl, notes = [] } = {}) {
  const sha = info && info.commit ? info.commit.slice(0, 9) : 'unknown build';
  return [`Stennisfy post-deploy check FAILED: the live dashboard (${sha}${info && info.runNumber ? `, publish run ${info.runNumber}` : ''}) is broken.`,
    ...failures.slice(0, 6).map((x) => `- ${x}`), failures.length > 6 ? `- … and ${failures.length - 6} more` : '',
    ...notes.map((x) => `Note: ${x}`),
    'Members see this page until a fixed build is published.', base ? `Checked: ${base}` : '', runUrl || ''].filter(Boolean).join('\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, { timeoutMs = 60000 } = {}) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    if (r.status !== 200) return { ok: false, why: `HTTP ${r.status}` };
    return { ok: true, buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || '' };
  } catch (e) { return { ok: false, why: e.name === 'TimeoutError' ? 'timed out' : `network error (${e.name})` }; }
}
async function buildInfo(base, cb) {
  const r = await get(`${base}/build-info.json?cb=${cb}`, { timeoutMs: 20000 });
  if (!r.ok) return { info: null, why: r.why };
  try { return { info: JSON.parse(r.buf.toString('utf8')) }; } catch { return { info: null, why: 'not valid JSON' }; }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.gz': 'application/gzip' };

// Load the page in Chrome and observe. `html` is the page's deployed bytes (already fetched); every other path is fetched
// from `base` on demand and cached for this pass.
export async function observe({ base, page, html, chrome, timeoutMs = 90000, settleMs = 2000, log = () => {} }) {
  const cb = Date.now(), cache = new Map();
  const { html: served, stripped } = stripAuth(html);
  const server = createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || page;
    if (p === page) { res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' }); res.end(served); return; }
    if (!cache.has(p)) cache.set(p, get(`${base}/${p}?cb=${cb}`));
    const r = await cache.get(p);
    if (!r.ok) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || r.type || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(r.buf);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}/`;
  const dir = mkdtempSync(join(tmpdir(), 'pdc-'));
  const ch = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--disable-gpu', '--no-sandbox',
    '--window-size=1512,1000', `--user-data-dir=${join(dir, 'u')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const done = () => { try { ch.kill('SIGKILL'); } catch {} server.close(); try { rmSync(dir, { recursive: true, force: true }); } catch {} };
  const obs = { pageOk: true, stripped, errors: [], ready: false, globals: {}, view: { children: 0, text: '' }, blocked: [] };
  try {
    const port = await new Promise((res, rej) => {
      let s = ''; const t = setTimeout(() => rej(new Error('Chrome gave no DevTools port in 30 s')), 30000);
      ch.on('error', (e) => { clearTimeout(t); rej(new Error(`Chrome did not start (${e.message})`)); });
      ch.stderr.on('data', (d) => { s += d; const m = /ws:\/\/127\.0\.0\.1:(\d+)\//.exec(s); if (m) { clearTimeout(t); res(+m[1]); } });
    });
    const tg = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
    const ws = new WebSocket(tg.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
    let id = 0; const wait = new Map();
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
      else if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails || {};
        const text = String((d.exception && d.exception.description) || d.text || 'unknown').split('\n')[0];
        obs.errors.push({ text, url: d.url || (d.stackTrace && d.stackTrace.callFrames && d.stackTrace.callFrames[0] && d.stackTrace.callFrames[0].url) || '', line: d.lineNumber });
      } else if (m.method === 'Fetch.requestPaused') {
        obs.blocked.push(m.params.request.url.split('?')[0].split('/').pop());
        send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'Aborted' });
      }
    });
    const E = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text); return r.result.result.value; };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*auth.html*', resourceType: 'Document' }, { urlPattern: '*verify.html*', resourceType: 'Document' }] });
    await send('Page.navigate', { url: origin + page });
    const probe = `(() => { const g = {}; for (const k of ${JSON.stringify(Object.keys(GLOBALS))}) { try { g[k] = typeof window[k] !== 'undefined' ? typeof window[k] : eval('typeof ' + k); } catch (e) { g[k] = 'undefined'; } }
      const v = document.querySelector(${JSON.stringify(VIEW_ROOT)}); return { g, children: v ? v.childElementCount : 0, text: v ? v.textContent.trim().slice(0, 160) : '', cards: v ? v.querySelectorAll('[data-ek], .mc-card, .mx-card').length : 0 }; })()`;
    const t0 = Date.now();
    for (;;) {
      const p = await E(probe).catch(() => null);
      if (p) { obs.globals = p.g; obs.view = { children: p.children, text: p.text, cards: p.cards }; }
      const allG = p && Object.entries(GLOBALS).every(([k, t]) => p.g[k] === t);
      if (allG && p.children > 0 && !NO_DATA.test(p.text)) { obs.ready = true; break; }
      if (Date.now() - t0 > timeoutMs) break;
      await sleep(500);
    }
    obs.loadMs = Date.now() - t0;
    if (obs.ready) await sleep(settleMs);   // errors thrown just after the first render still count
    log(`post-deploy: ${obs.ready ? 'ready' : 'NOT ready'} after ${obs.loadMs} ms; ${obs.errors.length} uncaught error(s); view ${obs.view.children} element(s)`);
  } catch (e) {
    obs.pageOk = false; obs.pageWhy = e.message;
  } finally { done(); }
  return obs;
}

export async function run({ base = DEFAULT_BASE, page = DEFAULT_PAGE, expectRun = null, alert = false, timeoutMs = 90000, env = process.env, log = console.log } = {}) {
  base = base.replace(/\/$/, '');
  const retryMs = env.POST_DEPLOY_RETRY_MS !== undefined ? Number(env.POST_DEPLOY_RETRY_MS) : 30000;
  const settleMs = env.POST_DEPLOY_SETTLE_MS !== undefined ? Number(env.POST_DEPLOY_SETTLE_MS) : 2000;
  const chrome = env.CHROME_BIN || ['/usr/bin/google-chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync) || 'google-chrome';
  const notes = [];
  // 1. the build just published (CDN lag): build-info.json shows our run, or a newer one
  let bi = await buildInfo(base, Date.now());
  if (expectRun) {
    const until = Date.now() + 10 * 60000;
    while (!(bi.info && (String(bi.info.runId) === String(expectRun) || Number(bi.info.runId) > Number(expectRun))) && Date.now() < until) {
      await sleep(Math.min(retryMs, 30000)); bi = await buildInfo(base, Date.now());
    }
    if (!(bi.info && (String(bi.info.runId) === String(expectRun) || Number(bi.info.runId) > Number(expectRun))))
      notes.push(`build-info.json never showed publish run ${expectRun} within 10 min; checked what is live (run ${bi.info ? bi.info.runId : 'unknown'})`);
  }
  // 2. the page bytes, re-read while the page and build-info disagree (one stamp, two files, a CDN in between)
  let pg, shas = [];
  for (let i = 0; i < 5; i++) {
    pg = await get(`${base}/${page}?cb=${Date.now()}`);
    shas = pg.ok ? metaShas(pg.buf.toString('utf8')) : [];
    if (pg.ok && bi.info && shas.length === 1 && shas[0] === bi.info.commit) break;
    if (i < 4) { await sleep(retryMs); bi = await buildInfo(base, Date.now()); }
  }
  let obs;
  if (!pg.ok) obs = { pageOk: false, pageWhy: `${page}: ${pg.why}` };
  else obs = await observe({ base, page, html: pg.buf.toString('utf8'), chrome, timeoutMs, settleMs, log });
  Object.assign(obs, { metaShas: shas, info: bi.info, infoWhy: bi.why });
  if (obs.pageOk && !obs.stripped) notes.push('the sign-in redirect call was not found to remove (the CDP auth.html block covered it)');
  const failures = judge(obs);
  const summary = { ok: failures.length === 0, failures, notes, commit: bi.info && bi.info.commit, runId: bi.info && bi.info.runId,
    loadMs: obs.loadMs, errors: obs.errors, view: obs.view, globals: obs.globals, blocked: obs.blocked };
  log(`### post-deploy-check ${JSON.stringify(summary)}`);
  if (!failures.length) { log(`post-deploy: OK — ${base}/${page} build ${String(summary.commit).slice(0, 9)} rendered, no uncaught error`); return { ok: true, summary }; }
  const text = message(failures, { info: bi.info, base: `${base}/${page}`, runUrl: env.RUN_URL, notes });
  log(text);
  let sent = null;
  if (alert) {
    sent = await sendTelegram(text, env);
    if (sent.ok) log(`post-deploy: Telegram sent (${sent.why})`);
    else {
      log(`::error title=Post-deploy alert not sent::Telegram ${sent.why}`);
      if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### Post-deploy alert NOT sent (${sent.why})\n\n${text}\n`);
    }
  }
  return { ok: false, summary, text, sent };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const r = await run({ base: arg('--base', DEFAULT_BASE), page: arg('--page', DEFAULT_PAGE), expectRun: arg('--expect-run', null),
    alert: process.argv.includes('--alert'), timeoutMs: +arg('--timeout-ms', 90000) }).catch((e) => ({ ok: false, crash: e }));
  if (r.crash) {
    console.log(`::error title=Post-deploy check::crashed (${r.crash.message})`);
    if (process.argv.includes('--alert')) await sendTelegram(`Stennisfy post-deploy check could not run (${r.crash.message}): the live dashboard is UNCHECKED.\n${process.env.RUN_URL || ''}`.trim(), process.env);
  }
  else if (!r.ok) console.log(`::error title=Post-deploy check failed::${r.summary.failures.join(' · ')}`);
  process.exit(r.ok ? 0 : 1);
}
