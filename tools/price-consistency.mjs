// One price per match (founder ruling 2026-10-17, item 1): a match shows the SAME price, source and label on every
// surface. Runs the page's OWN functions (nothing re-implemented) in headless Chrome over a built site and compares, per
// career match:
//   ref   = the Database join (H2HPage.priceJoin over the player's career) — what Head to Head, the Player Profile's
//           Record per tournament, Series and the Match analysis Tournament tab show;
//   tab   = meRowFromCareer (+ sfDbPxRows) — what Form, H2H, Market edge (derived lines), Overview and Progression show;
//   me    = the Market edge shard's row (build-market-edge.js) — the tab's Match winner view and the profile's Market edge;
//   cap   = the Head to Head page's captured-Pinnacle step (h2hCapPinnacle) — it overrides the join on that page.
// A match the Database holds (ref != null) that any surface shows differently FAILS the run (exit 1): the gate before
// pipeline.yml uploads the site. A match the Database does not hold but a surface prices is REPORTED (exit 0) — that
// class waits on a founder ruling ("report those, but don't fix them yet").
// Scope: every ATP-level, played, main-draw career match of 2026 for every player with a career-history shard, plus
// every year for a fixed 1-in-10 sample of players (key % 10 === 0).
// Usage: node tools/price-consistency.mjs --site _site [--report out.json] [--sample 10] [--limit N]
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, resolve, normalize } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
// --base URL: read a DEPLOYED site instead of a local one (the live read-back); --only k1,k2: those players only;
// --show ek1,ek2: print every surface's price for those api-tennis event keys
const LIVE = arg('--base', null), ONLY = (arg('--only', '') || '').split(',').filter(Boolean), SHOW = (arg('--show', '') || '').split(',').filter(Boolean);
const SITE = resolve(arg('--site', '_site')), REPORT = arg('--report', null), SAMPLE = +arg('--sample', 10), LIMIT = +arg('--limit', 0);
// --focus keys.json: a list of api-tennis event keys whose tab prices are reported before (the closes shard alone) and
// after (the Database join first) — the founder's "how many of the 420 changed" (a report, never a failure)
const FOCUS = arg('--focus', null) ? JSON.parse(readFileSync(arg('--focus'), 'utf8')).map(String) : [];
const H2H_EVERY = +arg('--h2h-every', 20);
const PAGE = LIVE || existsSync(join(SITE, 'bsp-consult-dashboard.html')) ? 'bsp-consult-dashboard.html' : 'index.html';
if (!LIVE) for (const f of [PAGE, 'database-yield.json', 'database-yield-players.json', 'career-history-index.json']) {
  if (!existsSync(join(SITE, f))) { console.error(`price-consistency: ${f} missing from ${SITE} — nothing to check, failing closed`); process.exit(1); }
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const p = normalize(join(SITE, u === '/' ? PAGE : u));
  if (!p.startsWith(SITE) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
if (!LIVE) await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = LIVE ? LIVE.replace(/\/?$/, '/') : `http://127.0.0.1:${server.address().port}/`;

const dir = mkdtempSync(join(tmpdir(), 'pc-'));
const ch = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--disable-gpu',
  '--no-sandbox', '--window-size=1512,1000', `--user-data-dir=${join(dir, 'u')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const fail = (msg) => { console.error('price-consistency: ' + msg); try { ch.kill('SIGKILL'); } catch (e) { /* gone */ } if (!LIVE) server.close(); process.exit(1); };
ch.on('error', e => fail('Chrome did not start (' + e.message + ') — failing closed'));
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
// a signed-out visit is sent to auth.html: this read-only check stays on the page (nothing is signed in or written)
await send('Fetch.enable', { patterns: [{ urlPattern: '*auth.html*', resourceType: 'Document' }, { urlPattern: '*verify.html*', resourceType: 'Document' }] });
await send('Page.navigate', { url: BASE + PAGE });
const t0 = Date.now();
while (!(await E(`!!(window.H2HPage && window.H2HPage.priceJoin && window.DatabaseTab && typeof sfDbPxRows === 'function' && typeof meRowFromCareer === 'function')`).catch(() => false))) {
  if (Date.now() - t0 > 120000) fail('the page never exposed its price functions');
  await new Promise(r => setTimeout(r, 500));
}

const result = await E(`(async () => {
  const SAMPLE = ${SAMPLE}, LIMIT = ${LIMIT}, H2H_EVERY = ${H2H_EVERY}, FOCUS = new Set(${JSON.stringify(FOCUS)});
  const ONLY = new Set(${JSON.stringify(ONLY)}), SHOW = new Set(${JSON.stringify(SHOW)});
  await sfDbJoinLoad();
  if (typeof loadPlayerProfiles === 'function' && !Object.keys(playerProfiles || {}).length) await loadPlayerProfiles().catch(() => null);
  const idx = await loadCareerHistoryIndex();
  const db = _sfDbJoin, J = window.H2HPage.priceJoin;
  const keys = Object.keys(idx || {}).sort((a, b) => +a - +b);
  const S = { shown: [], players: 0, playersChecked: 0, matches: 0, dbHeld: 0, notHeld: 0, byYear: {}, fail: { tab: 0, me: 0, cap: 0, form: 0, h2h: 0, threw: 0 },
    checked: { tab: 0, me: 0, cap: 0, form: 0, h2h: 0 }, report: {}, ex: { fail: [], report: [] },
    focus: { keys: FOCUS.size, found: 0, rowOf: {}, seen: {}, changed: { tab: 0, me: 0 }, unchanged: { tab: 0, me: 0 }, byBook: {}, ex: [] } };
  const ccache = new Map(), clcache = new Map();
  const okOf = x => (x.oppKey != null && x.oppKey !== '' ? x.oppKey : x.opponentKey != null && x.opponentKey !== '' ? x.opponentKey : null);   // career rows carry oppKey
  const careerOf = async k => { if (!ccache.has(k)) ccache.set(k, await loadCareerHistory(k).catch(() => null)); return ccache.get(k); };
  const closesOf = async k => { if (!clcache.has(k)) clcache.set(k, await fhLoadCloses(k).catch(() => null)); return clcache.get(k); };
  const oldShard = async k => { try { const r = await fetch('market-edge-old/' + k + '.json'); return r.ok ? await r.json() : null; } catch (e) { return null; } };
  // price, the other side's price, and the hover every surface prints for it (fhSrcTitle: the one source title)
  const pick = o => (o && o.price != null ? [o.price, o.oppPrice, fhSrcTitle(o)].join(' | ') : null);
  const note = (bucket, cls, row) => { const t = S[bucket === 'fail' ? 'fail' : 'report']; t[cls] = (t[cls] || 0) + 1; if (S.ex[bucket].length < 80) S.ex[bucket].push(Object.assign({ cls }, row)); };
  const nameOf = k => (playerProfiles && playerProfiles[k] && playerProfiles[k].name) || (idx[k] && (idx[k].name || idx[k].n)) || '';
  let n = 0;
  for (const k of keys) {
    if (ONLY.size && !ONLY.has(k)) continue;
    const sample = +k % SAMPLE === 0 || ONLY.size > 0;
    const career = await careerOf(k);
    if (!Array.isArray(career) || !career.length) continue;
    S.players++;
    const has2026 = career.some(x => x && String(x.date || '').slice(0, 4) === '2026' && x.level === 'atp');
    if (!has2026 && !sample) continue;
    if (LIMIT && ++n > LIMIT) break;
    const name = nameOf(k);
    if (!name) continue;
    const [cl, ms] = await Promise.all([closesOf(k), meLoadProfileShard(k)]);
    S.playersChecked++;
    const capOnly = cl && Array.isArray(cl.cap) && cl.cap.length ? { rows: [], cap: cl.cap } : null;
    const meRows = meRowsFor(career, cl, k, name);
    const win = new Map();
    (ms && ms.matches ? meWinnerRows(ms, meRows, k, name) : []).forEach(r => { if (r.tdKey) win.set(r.tdKey, win.has(r.tdKey) ? null : r); });
    // the Form tab, called as the tab calls it, on this player's career rows (every window, every surface)
    const formAt = new Map();
    try {
      const fmM = { p1: name, p1Key: k, p2: '', p2Key: null, date: '2099-12-31', _fhFormRows: [career, []], _fhCloses: [cl, null] };
      const fst = Object.assign(fhStateFor(fmM).form, { surf: 'all', role: 'all', wmode: 'days', days: 1e7 });   // the tab's own state, every window
      const fm = fhFormPlayer(fmM, 0, fst);
      (fm.shown || []).forEach(r => { const fk = r.date + '|' + r.opp + '|' + (r.won ? 1 : 0); formAt.set(fk, formAt.has(fk) ? null : r); });
    } catch (e) { S.fail.threw++; note('fail', 'Form tab threw', { key: k, player: name, err: String(e && e.message || e) }); }
    let oldWin = null;
    const hasFocus = FOCUS.size && career.some(x => x && FOCUS.has(String(x.eventKey)));
    if (hasFocus) { const os = await oldShard(k); oldWin = new Map(); if (os && os.matches) meWinnerRows(os, meRows, k, name).forEach(r => { if (r.tdKey) oldWin.set(r.tdKey, oldWin.has(r.tdKey) ? null : r); }); }
    const h2hJobs = [];
    career.forEach((x, i) => {
      if (x && FOCUS.has(String(x.eventKey)) && !S.focus.rowOf[x.eventKey]) S.focus.rowOf[x.eventKey] = { level: x.level, qualifying: !!x.qualifying, walkover: !!x.walkover, round: x.round || null, event: x.tournament, date: x.date, player: name };
      if (!x || x.level !== 'atp' || x.walkover || x.qualifying || /^qualif/i.test(String(x.round || ''))) return;
      const y = String(x.date || '').slice(0, 4);
      if (!(y === '2026' || sample)) return;
      const tab = meRowFromCareer(x, cl, k, name, i);
      const js = [{ date: x.date, won: !!x.won, round: tab.round, opp: x.opponent }];
      J(js, { full: name }, null, db, null, career);
      const ref = js[0].price != null ? js[0] : null;
      S.matches++; S.byYear[y] = S.byYear[y] || { matches: 0, held: 0, failed: 0, reported: 0 }; S.byYear[y].matches++;
      const row = { key: k, player: name, date: x.date, opp: x.opponent, event: x.tournament, round: x.round || null, ref: pick(ref), tab: pick(tab) };
      // the Head to Head page's captured-Pinnacle step (keyed meetings, retirements excluded — h2hCapPinnacle)
      let cap = null;
      if (capOnly && x.eventKey != null && !x.retired) { const c = fhCloseFor(capOnly, x.date, x.opponent, !!x.won, okOf(x), x.eventKey);
        if (c && c.book === 'P' && c.src === 'cap') cap = c; }
      const meRow = tab.tdKey ? win.get(tab.tdKey) || null : null;
      const formRow = formAt.get(x.date + '|' + x.opponent + '|' + (x.won ? 1 : 0)) || null;
      const showIt = SHOW.has(String(x.eventKey));
      if (FOCUS.has(String(x.eventKey)) && !S.focus.seen[x.eventKey]) {
        S.focus.seen[x.eventKey] = 1; S.focus.found++;
        const keep = sfDbPxRows; let old;
        try { sfDbPxRows = () => [null]; old = meRowFromCareer(x, cl, k, name, i); } finally { sfDbPxRows = keep; }
        const oMe = oldWin && tab.tdKey ? oldWin.get(tab.tdKey) || null : null;
        const ch = pick(old) !== pick(tab), chMe = pick(oMe) !== pick(meRow);
        S.focus[ch ? 'changed' : 'unchanged'].tab++; S.focus[chMe ? 'changed' : 'unchanged'].me++;
        const bk = (o => o && o.price != null ? fhSrcTitle(o) : '—');
        const t = bk(old) + ' → ' + bk(tab); S.focus.byBook[t] = (S.focus.byBook[t] || 0) + 1;
        if (S.focus.ex.length < 30) S.focus.ex.push({ eventKey: x.eventKey, player: name, date: x.date, opp: x.opponent, before: pick(old), after: pick(tab), meBefore: pick(oMe), meAfter: pick(meRow) });
      }
      if (showIt) { row.form = pick(formRow); row.me = pick(meRow); row.cap = pick(cap); S.shown.push(row); }
      if (okOf(x) != null && x.eventKey != null && (FOCUS.has(String(x.eventKey)) || showIt || +x.eventKey % H2H_EVERY === 0)) h2hJobs.push({ x, ref, row });
      if (ref) {
        S.dbHeld++; S.byYear[y].held++;
        let bad = false;
        S.checked.tab++; if (meRow) S.checked.me++; if (cap) S.checked.cap++; if (formRow) S.checked.form++;
        if (pick(tab) !== pick(ref)) { S.fail.tab++; note('fail', 'tab ≠ Database', row); bad = true; }
        if (formRow && pick(formRow) !== pick(ref)) { S.fail.form++; note('fail', 'Form tab ≠ Database', Object.assign({}, row, { form: pick(formRow) })); bad = true; }
        if (meRow && pick(meRow) !== pick(ref)) { S.fail.me++; note('fail', 'Market edge shard ≠ Database', Object.assign({}, row, { me: pick(meRow) })); bad = true; }
        if (cap && pick(cap) !== pick(ref)) { S.fail.cap++; note('fail', 'Head to Head captured step ≠ Database', Object.assign({}, row, { cap: pick(cap) })); bad = true; }
        if (bad) S.byYear[y].failed++;
      } else {
        S.notHeld++;
        const why = +y < 2010 ? 'before the Database window (2010)' : 'no Database row for the match';
        let rep = false;
        if (tab.price != null) { note('report', 'tab prices a match the Database does not hold · ' + why, row); rep = true; }
        if (meRow && meRow.price != null) { note('report', 'Market edge prices a match the Database does not hold · ' + why, Object.assign({}, row, { me: pick(meRow) })); rep = true; }
        if (cap) { note('report', 'Head to Head captured step prices a match the Database does not hold · ' + why, Object.assign({}, row, { cap: pick(cap) })); rep = true; }
        if (rep) S.byYear[y].reported++;
      }
    });
    // the H2H tab, called as the tab calls it, for a fixed 1-in-H2H_EVERY sample of keyed meetings (+ every focus match)
    for (const j of h2hJobs) {
      const ok = String(okOf(j.x));
      const [oc, ocl] = await Promise.all([careerOf(ok), closesOf(ok)]);
      if (!Array.isArray(oc) || !oc.length) continue;
      let ms2;
      try { ms2 = fhMeetings({ p1: name, p1Key: k, p2: nameOf(ok) || j.x.opponent, p2Key: ok, _fhCh: [career, oc], _fhCloses: [cl, ocl] }); }
      catch (e) { S.fail.threw++; note('fail', 'H2H tab threw', { key: k, player: name, opp: ok, err: String(e && e.message || e) }); continue; }
      const hit = ms2.filter(r => String(r.ek) === String(j.x.eventKey));
      if (hit.length !== 1 || hit[0].wo) continue;
      if (SHOW.has(String(j.x.eventKey))) j.row.h2h = pick(hit[0]);
      if (j.ref) { S.checked.h2h++; if (pick(hit[0]) !== pick(j.ref)) { S.fail.h2h++; note('fail', 'H2H tab ≠ Database', Object.assign({}, j.row, { h2h: pick(hit[0]) })); } }
      else if (hit[0].price != null) note('report', 'H2H tab prices a match the Database does not hold', Object.assign({}, j.row, { h2h: pick(hit[0]) }));
    }
  }
  S.focus.notFound = [...FOCUS].filter(k => !S.focus.seen[k]).map(k => Object.assign({ eventKey: k }, S.focus.rowOf[k] || { inNoCheckedCareer: true }));
  delete S.focus.rowOf;
  return S;
})()`).catch(e => fail('the in-page check threw: ' + e.message));

ch.kill('SIGKILL'); if (!LIVE) server.close();
for (const r of result.shown || []) console.log('SHOW ' + JSON.stringify(r));
const failN = Object.values(result.fail).reduce((a, b) => a + b, 0);
console.log(`### price-consistency ${JSON.stringify({ players: result.players, playersChecked: result.playersChecked, matches: result.matches, dbHeld: result.dbHeld,
  notHeld: result.notHeld, checked: result.checked, failures: result.fail, reported: result.report, byYear: result.byYear })}`);
if (FOCUS.length) { const f = Object.assign({}, result.focus); delete f.seen; console.log(`### focus ${JSON.stringify(f)}`); }
for (const r of result.ex.fail.slice(0, 40)) console.log('FAIL ' + JSON.stringify(r));
for (const r of result.ex.report.slice(0, 40)) console.log('REPORT ' + JSON.stringify(r));
if (REPORT) writeFileSync(REPORT, JSON.stringify(result, null, 1));
if (!result.playersChecked || !result.matches) { console.error('price-consistency: checked 0 players / 0 matches — a check on an empty set is not a check'); process.exit(1); }
if (failN) { console.error(`price-consistency: ${failN} surface(s) show a different price, source or label than the Database for a match it holds`); process.exit(1); }
console.log(`price-consistency: OK — ${result.dbHeld} matches the Database holds show one price on every surface checked`);
process.exit(0);
