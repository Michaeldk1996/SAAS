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
const PREV = arg('--prev', null);   // the published close-coverage.json (URL or file): each day's first-seen status, for "recovered"
let prev = null;
if (PREV) {
  try { prev = /^https?:/.test(PREV) ? await (await fetch(PREV + (PREV.includes('?') ? '&' : '?') + 'cb=' + Date.now())).json().catch(() => null)
                                     : JSON.parse(readFileSync(PREV, 'utf8')); }
  catch (e) { prev = null; }
}
const DAYS = [0, 1, 2].map(k => { const t = Date.parse(DAY + 'T12:00:00Z') - k * 864e5; return new Date(t).toISOString().slice(0, 10); });
try {
  report = await E(`(() => {
    const DAYS = ${JSON.stringify(DAYS)};
    const MAXLAG = 300e3, APPROX_LAG = 1800e3;
    const ms = v => { const t = Date.parse(v); return isNaN(t) ? null : t; };
    function judge(m) {
      // REAL close (founder ruling 2026-11-01): both sides of the card book, a verified start, each side's close sighting
      // within 300 s before it. The card face shows _mcCardCloseOf; a shown close that is older is not a real close here.
      const o = _ocsOf(m), c1 = _mcCardCloseOf(m, 'p1'), c2 = _mcCardCloseOf(m, 'p2');
      const wo = /walk\\s*over|w\\/o/i.test(String(m.status || '') + ' ' + String((m.finalScore && m.finalScore.display) || ''));
      const book = o ? (mxBookLabel(o.book) || o.book) : (m.openingOdds && m.openingOdds.bookmaker) || null;
      const built = OCS.generatedAt ? ms(OCS.generatedAt) : null, sched = typeof cardStartMs === 'function' ? cardStartMs(m) : null;
      if (wo) return { real: false, bucket: 'other', reason: 'walkover (no ball played)', book };
      if (!o) return { real: false, bucket: 'other', reason: m.closingOdds ? 'no card-state entry; matches.json close not the card book' : 'no card-state entry and no close in matches.json', book };
      // the card state publishes startTs only beside a close, so a verified start is read from its SOURCE
      const verified = !!(o.startTsSource && o.startTsSource !== 'none');
      if (!verified) {
        if (built != null && sched != null && built < sched) return { real: false, bucket: 'other', reason: 'card state last built ' + new Date(built).toISOString().slice(0, 16) + 'Z, before this match started', book };
        return { real: false, bucket: 'no verified start', reason: 'no verified start (our live flip and Oddspapi\\'s recorded start both missing or rejected)', book };
      }
      if ((c1 != null) !== (c2 != null)) return { real: false, bucket: 'other', reason: 'a close for one side only (' + book + ')', book };
      if (c1 == null) return { real: false, bucket: 'book quiet before start', reason: 'verified start, but no ' + (book || 'card-book') + ' price seen before it', book };
      const st = ms(o.startTs), lags = [o.p1 && o.p1.closeTs, o.p2 && o.p2.closeTs].map(t => (st != null && ms(t) != null ? st - ms(t) : null));
      if (lags.some(l => l == null)) return { real: false, bucket: 'other', reason: 'close without a sighting time', book };
      const lag = Math.max(...lags);
      if (lag <= MAXLAG) return { real: true, book, lagS: Math.round(lag / 1000) };
      if (lag <= APPROX_LAG) return { real: false, bucket: 'last sighting 300 s–30 min', reason: (book || 'card book') + ' last seen ' + Math.round(lag / 60000) + ' min before the verified start', book, lagS: Math.round(lag / 1000) };
      return { real: false, bucket: 'book quiet before start', reason: (book || 'card book') + ' last seen ' + Math.round(lag / 60000) + ' min before the verified start', book, lagS: Math.round(lag / 1000) };
    }
    const days = DAYS.map(day => {
      const cards = (matches || []).filter(m => isFinishedMatch(m) && m.date === day);
      const rows = cards.map(m => Object.assign({ id: m.id, match: (m.p1 || '?') + ' v ' + (m.p2 || '?') + (m.tour ? ' · ' + (typeof mxEventName === 'function' ? mxEventName(m.tour) : m.tour) : '') }, judge(m)));
      const x = rows.filter(r => r.real).length, buckets = {};
      for (const r of rows) if (!r.real) buckets[r.bucket] = (buckets[r.bucket] || 0) + 1;
      return { day, x, y: rows.length, pct: rows.length ? Math.round(1000 * x / rows.length) / 10 : null, buckets,
               cards: rows.map(r => ({ id: r.id, real: r.real })),
               dashes: rows.filter(r => !r.real).map(r => ({ id: r.id, match: r.match, book: r.book, bucket: r.bucket, reason: r.reason, lagS: r.lagS })) };
    });
    return { days, cardStateGeneratedAt: OCS.generatedAt || null,
             rule: 'real close = both sides of the card book, a verified start, each close sighting within 300 s before it (founder 2026-11-01)',
             population: 'board cards with a final result (isFinishedMatch) dated on the day (Europe/Berlin, the board date)' };
  })()`);
} catch (e) { fail('the page check threw: ' + e.message); }
// "recovered by re-verification": a card that was a dash in the FIRST report of its day and carries a real close now.
// Each day keeps its first-seen status from the previous published report (never rewritten once set).
const prevDays = Object.fromEntries(((prev && prev.days) || []).map(d => [d.day, d]));
for (const d of report.days) {
  const p0 = prevDays[d.day];
  const first = (p0 && p0.first) || Object.fromEntries(d.cards.map(c => [c.id, c.real]));
  for (const c of d.cards) if (!(c.id in first)) first[c.id] = c.real;
  d.first = first;
  d.recovered = d.cards.filter(c => c.real && first[c.id] === false).length;
  d.approx = null;   // the approximate tier (ADD PRICES, founder 2026-11-01) is not built yet: shown as —, never counted here
}
// the top level = yesterday, for the data-alarms watch (its daily line)
Object.assign(report, { day: report.days[0].day, x: report.days[0].x, y: report.days[0].y, pct: report.days[0].pct,
                        dashes: report.days[0].dashes, buckets: report.days[0].buckets, recovered: report.days[0].recovered,
                        approx: report.days[0].approx, earlier: report.days.slice(1).map(d => ({ day: d.day, x: d.x, y: d.y, recovered: d.recovered })) });
ch.kill('SIGKILL'); if (!LIVE) server.close();
report.generatedAt = new Date().toISOString();
const tmp = OUT + '.tmp';
writeFileSync(tmp, JSON.stringify(report, null, 1)); renameSync(tmp, OUT);   // atomic: temp file + rename
for (const d of report.days) {
  console.log(`close-coverage ${d.day}: ${d.x} of ${d.y} Completed cards carry a REAL close` + (d.pct != null ? ` (${d.pct}%)` : '') +
              `; recovered by re-verification ${d.recovered}; dashes ${JSON.stringify(d.buckets)}`);
}
console.log(`card state generated ${report.cardStateGeneratedAt || '—'}`);
for (const d of report.dashes) console.log(`  — ${d.match}: [${d.bucket}] ${d.reason}`);
process.exit(0);
