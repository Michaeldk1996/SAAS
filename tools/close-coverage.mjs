#!/usr/bin/env node
// Close coverage (architecture program stage 1, 2026-11-01): how many of YESTERDAY's Completed cards carry a card-book
// close, and why each of the others is a dash. Runs the page's OWN functions in headless Chrome over a built site
// (nothing re-implemented): the card's close is exactly what the Completed card prints, `_mcCardCloseOf` — the card
// state's close for the card book, else matches.json's closingOdds only when it names the Open's book.
//
//   node tools/close-coverage.mjs --site _site --out _site/close-coverage.json [--day YYYY-MM-DD] [--base URL]
//
// Population (Y): every board card the page counts as finished (`isFinishedMatch`) whose `date` is the day (default:
// yesterday on the Europe/Berlin calendar — the board's own date, api-tennis wall clock). X: those with both legs of
// `_mcCardCloseOf`. Every other card is listed with ONE reason, from the same data the card reads. The data-alarms
// watch (tools/data-alarms.sql, row close_cover) reads the published file once a day and alerts below 90%.
// Exit 0 with the file written; 1 when the page could not be read (the file is then NOT written — a missing report is
// an alarm of its own, never a silent 0 of 0).
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync, mkdtempSync, renameSync } from 'node:fs';
import { join, resolve, normalize, extname, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const SITE = resolve(arg('--site', '_site')), OUT = arg('--out', null), LIVE = arg('--base', null);
const berlinDay = (offset) => { const d = new Date(Date.now() + offset * 864e5);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); };
const DAY = arg('--day', berlinDay(-1));
if (!OUT) { console.error('close-coverage: --out FILE required'); process.exit(2); }
const PAGE = LIVE || existsSync(join(SITE, 'bsp-consult-dashboard.html')) ? 'bsp-consult-dashboard.html' : 'index.html';
if (!LIVE && !existsSync(join(SITE, PAGE))) { console.error(`close-coverage: ${PAGE} missing from ${SITE}`); process.exit(1); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const p = normalize(join(SITE, u === '/' ? PAGE : u));
  if (!p.startsWith(SITE) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
});
if (!LIVE) await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = LIVE ? LIVE.replace(/\/?$/, '/') : `http://127.0.0.1:${server.address().port}/`;

const dir = mkdtempSync(join(tmpdir(), 'cc-'));
const ch = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--disable-gpu',
  '--no-sandbox', '--window-size=1512,1000', `--user-data-dir=${join(dir, 'u')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const fail = (msg) => { console.error('close-coverage: ' + msg + ' — no report written'); try { ch.kill('SIGKILL'); } catch (e) { /* gone */ }
  if (!LIVE) server.close(); process.exit(1); };
ch.on('error', e => fail('Chrome did not start (' + e.message + ')'));
const port = await new Promise((res, rej) => { let s = ''; const t = setTimeout(() => rej(new Error('no DevTools port')), 30000);
  ch.stderr.on('data', d => { s += d; const m = /ws:\/\/127\.0\.0\.1:(\d+)\//.exec(s); if (m) { clearTimeout(t); res(+m[1]); } }); }).catch(e => fail(e.message));
const tg = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page');
const ws = new WebSocket(tg.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
let id = 0; const wait = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
  else if (m.method === 'Fetch.requestPaused') send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'Aborted' }); });
const send = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const E = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result.result.value; };
await send('Page.enable'); await send('Runtime.enable');
// a signed-out visit is sent to auth.html: this read-only report stays on the page (nothing is signed in or written)
await send('Fetch.enable', { patterns: [{ urlPattern: '*auth.html*', resourceType: 'Document' }, { urlPattern: '*verify.html*', resourceType: 'Document' }] });
await send('Page.navigate', { url: BASE + PAGE });
const t0 = Date.now();
while (!(await E(`!!(typeof matchesLoadedOnce !== 'undefined' && matchesLoadedOnce && typeof OCS !== 'undefined' && OCS.loaded
                    && typeof _mcCardCloseOf === 'function' && typeof isFinishedMatch === 'function')`).catch(() => false))) {
  if (Date.now() - t0 > 120000) fail('the page never loaded its matches and card state');
  await new Promise(r => setTimeout(r, 500));
}

let report;
try {
  report = await E(`(() => {
    const DAY = ${JSON.stringify(DAY)};
    const cards = (matches || []).filter(m => isFinishedMatch(m) && m.date === DAY);
    const dashes = []; let x = 0;
    for (const m of cards) {
      const c1 = _mcCardCloseOf(m, 'p1'), c2 = _mcCardCloseOf(m, 'p2');
      if (c1 != null && c2 != null) { x++; continue; }
      const built = OCS.generatedAt ? Date.parse(OCS.generatedAt) : null, st = typeof cardStartMs === 'function' ? cardStartMs(m) : null;
      const o = _ocsOf(m), wo = /walk\\s*over|w\\/o/i.test(String(m.status || '') + ' ' + String((m.finalScore && m.finalScore.display) || ''));
      const book = o ? (mxBookLabel(o.book) || o.book) : (m.openingOdds && m.openingOdds.bookmaker) || null;
      let reason;
      if (wo) reason = 'walkover (no ball played)';
      else if (o && (c1 != null) !== (c2 != null)) reason = 'card state holds a close for one side only (' + book + ')';
      else if (o && built != null && st != null && built < st) reason = 'card state last built ' + new Date(built).toISOString().slice(0, 16) + 'Z, before this match started — its close was never computed';
      else if (o) reason = 'card state holds no close for ' + (book || 'the card book') + ' (no price seen before the start)';
      else if (m.closingOdds && m.openingOdds && m.closingOdds.bookmaker && m.openingOdds.bookmaker) reason = 'no card-state entry; matches.json close (' + m.closingOdds.bookmaker + ') is not the Open\\'s book (' + m.openingOdds.bookmaker + ')';
      else if (m.closingOdds) reason = 'no card-state entry; matches.json close incomplete or suspended';
      else reason = 'no card-state entry and no close in matches.json';
      dashes.push({ id: m.id, match: (m.p1 || '?') + ' v ' + (m.p2 || '?') + (m.tour ? ' · ' + (typeof mxEventName === 'function' ? mxEventName(m.tour) : m.tour) : ''), book, reason });
    }
    return { day: DAY, x, y: cards.length, pct: cards.length ? Math.round(1000 * x / cards.length) / 10 : null, dashes,
             cardStateGeneratedAt: OCS.generatedAt || null,
             population: 'board cards with a final result (isFinishedMatch) dated ' + DAY + ' (Europe/Berlin, the board date)' };
  })()`);
} catch (e) { fail('the page check threw: ' + e.message); }
ch.kill('SIGKILL'); if (!LIVE) server.close();
report.generatedAt = new Date().toISOString();
const tmp = OUT + '.tmp';
writeFileSync(tmp, JSON.stringify(report, null, 1)); renameSync(tmp, OUT);   // atomic: temp file + rename
console.log(`close-coverage ${report.day}: ${report.x} of ${report.y} Completed cards carry a card-book close` +
            (report.pct != null ? ` (${report.pct}%)` : '') + `; card state generated ${report.cardStateGeneratedAt || '—'}`);
for (const d of report.dashes) console.log(`  — ${d.match}: ${d.reason}`);
process.exit(0);
