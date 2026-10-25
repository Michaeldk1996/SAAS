// One price per match (founder ruling 2026-10-17, item 1): a match shows the SAME price, source and label on every
// surface. Runs the page's OWN functions (nothing re-implemented) in headless Chrome over a built site and compares, per
// career match:
//   ref   = the Database join (H2HPage.priceJoin over the player's career) — what Head to Head, the Player Profile's
//           Record per tournament, Series and the Match analysis Tournament tab show;
//   tab   = meRowFromCareer (+ sfDbPxRows) — what Form, H2H, Market edge (derived lines), Overview and Progression show;
//   me    = the Market edge shard's row (build-market-edge.js) — the tab's Match winner view and the profile's Market edge;
//   (the Head to Head page's captured-Pinnacle step is removed, founder ruling 2026-10-17 ruling 5: nothing overrides the join)
// A match the Database holds (ref != null) that any surface shows differently FAILS the run (exit 1): the gate before
// pipeline.yml uploads the site. Founder ruling 2026-10-17 (ruling 3): every checked match is of a class the master holds
// (ATP tour level, not qualifying, not a walkover), so a surface that prices one the join does NOT hold has a price path
// of its own — that FAILS the run too ("no other price path").
// Scope: every ATP-level, played, main-draw career match of 2026 for every player with a career-history shard, plus
// every year for a fixed 1-in-10 sample of players (key % 10 === 0).
// Usage: node tools/price-consistency.mjs --site _site [--report out.json] [--sample 10] [--limit N]
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, statSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, resolve, normalize } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
// --base URL: read a DEPLOYED site instead of a local one (the live read-back); --only k1,k2: those players only;
// --show ek1,ek2: print every surface's price for those api-tennis event keys
const LIVE = arg('--base', null), ONLY = (arg('--only', '') || '').split(',').filter(Boolean), SHOW = (arg('--show', '') || '').split(',').filter(Boolean);
// --pick "key|date-prefix|opponent-substring;…": print every surface for those matches too (the live read-back of a match
// with no api-tennis event key — an archive row before 2021); every pick also runs the H2H tab check
const PICK = (arg('--pick', '') || '').split(';').filter(Boolean).map(x => x.split('|'));
const SITE = resolve(arg('--site', '_site')), REPORT = arg('--report', null), SAMPLE = +arg('--sample', 10), LIMIT = +arg('--limit', 0);
// --focus keys.json: a list of api-tennis event keys whose tab prices are reported before (the closes shard alone) and
// after (the Database join first) — the founder's "how many of the 420 changed" (a report, never a failure)
const FOCUS = arg('--focus', null) ? JSON.parse(readFileSync(arg('--focus'), 'utf8')).map(String) : [];
const H2H_EVERY = +arg('--h2h-every', 20);
// --quarantine-out FILE (founder ruling 2026-10-18, "one match problem must never stop the site"): a per-match difference no
// longer fails the run. Each affected match is written to FILE (the page's price-quarantine.json: the Database row to dash,
// the Market edge row to leave out, the page that tripped, the likely cause) and the run exits 0; only a check that could
// not run (no player, Market edge lagging the master, a page function that threw) still exits 1. Without it the guard fails
// on any difference, as before (its own test, and a read-back of a deployed site).
const QOUT = arg('--quarantine-out', null);
// --coverage-out FILE (founder ruling 2026-10-18, item 5): every played match of every player with a career-history shard,
// per level and year: priced, or its reason (walkover · one side only · no bookmaker priced it · no source found yet), the 20
// players with the most unpriced matches, and every "no source found yet" dash the master holds a fitting row for (a join
// miss). A report — tools/price-coverage-alert.mjs compares it with the published one and alerts.
const COV = arg('--coverage-out', null);
const PAGE = LIVE || existsSync(join(SITE, 'bsp-consult-dashboard.html')) ? 'bsp-consult-dashboard.html' : 'index.html';
if (!LIVE) for (const f of [PAGE, 'database-yield.json', 'database-yield-players.json', 'career-history-index.json']) {
  if (!existsSync(join(SITE, f))) { console.error(`price-consistency: ${f} missing from ${SITE} — nothing to check, failing closed`); process.exit(1); }
}
// Lag (founder ruling 2026-10-17, "one source of truth"): every surface's latest match = the master's. The join surfaces
// read the Database files themselves; Market edge is built from the master in the same run, so its index must name the
// master as its source and carry the same latest match (a committed floor shipped after a failed build lags, or names
// no source, and fails the upload).
const LAG = { checked: false };
if (!LIVE && existsSync(join(SITE, 'market-edge-index.json'))) {
  const b = JSON.parse(readFileSync(join(SITE, 'database-yield.json'), 'utf8'));
  let dbLast = 0; for (const k of ['rows', 'retRows', 'tieRows']) for (const r of b[k] || []) if (r[0] > dbLast) dbLast = r[0];
  const ds = String(dbLast), dbIso = `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)}`;
  const ix = JSON.parse(readFileSync(join(SITE, 'market-edge-index.json'), 'utf8'));
  Object.assign(LAG, { checked: true, database: dbIso, marketEdge: ix.latestMatch || null, marketEdgeSource: ix.source || null });
  if (ix.source !== 'database-yield-master.json' || ix.latestMatch !== dbIso) {
    console.error(`price-consistency: Market edge lags the master — its latest match ${ix.latestMatch || '(none)'} from ${ix.source || '(no source: a committed floor)'}, the Database ${dbIso}`);
    process.exit(1);
  }
} else if (!LIVE) console.log('price-consistency: lag check SKIPPED — no market-edge-index.json in the site (said out loud, not a pass)');
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
  const ONLY = new Set(${JSON.stringify(ONLY)}), SHOW = new Set(${JSON.stringify(SHOW)}), PICK = ${JSON.stringify(PICK)};
  const picked = (k, x) => PICK.some(([pk, pd, po]) => pk === k && String(x.date || '').startsWith(pd || '') && String(x.opponent || '').includes(po || ''));
  await sfDbJoinLoad();
  if (typeof loadPlayerProfiles === 'function' && !Object.keys(playerProfiles || {}).length) await loadPlayerProfiles().catch(() => null);
  const idx = await loadCareerHistoryIndex();
  const db = _sfDbJoin, J = window.H2HPage.priceJoin;
  const keys = Object.keys(idx || {}).sort((a, b) => +a - +b);
  const S = { shown: [], players: 0, playersChecked: 0, matches: 0, dbHeld: 0, notHeld: 0, byYear: {}, byLevel: {}, fail: { tab: 0, me: 0, cap: 0, form: 0, h2h: 0, threw: 0 },
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
  // ---- the quarantine (founder ruling 2026-10-18): one entry per affected match, with the page that tripped and the likely cause
  const Q = [];
  const nrm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[-']/g, ' ');
  const ourSur = n => nrm(n).replace(/^([a-z]{1,3}\\.\\s*)+/, '').trim().split(/\\s+/)[0] || '';
  const ourIni = n => { const m = /^\\s*([a-z])[a-z]{0,2}\\./.exec(nrm(n)); return m ? m[1] : null; };
  const tdSur = n => nrm(n).trim().split(/\\s+/)[0] || '';
  const tdIni = n => { const m = /\\s([a-z])[a-z]{0,2}\\.?(?:[a-z]\\.?)*\\s*$/.exec(nrm(n)); return m ? m[1] : null; };
  const dayOf = v => Date.UTC(Math.floor(v / 10000), Math.floor(v / 100) % 100 - 1, v % 100) / 864e5;
  const dn = s => Date.parse(String(s).slice(0, 10) + 'T00:00:00Z') / 864e5;
  const bySur = new Map();
  db.names.forEach((nm, i) => { if (nm) for (const x of nm) { const t = tdSur(x); if (!bySur.has(t)) bySur.set(t, []); bySur.get(t).push(i); } });
  const dbKeyOf = i => i == null ? null : db.rows[i][0] + '|' + db.names[i][0] + '|' + db.names[i][1];
  // why the join holds no row for a match some page priced: the Database row with the same two surnames near its date
  const causeNotHeld = (x, name) => {
    const me = ourSur(name), o = ourSur(x.opponent), d0 = dn(x.date);
    const near = (bySur.get(me) || []).filter(i => { const dd = dayOf(db.rows[i][0]) - d0; return dd >= -20 && dd <= 30; })
      .map(i => { const nm = db.names[i], mine = x.won ? nm[0] : nm[1], theirs = x.won ? nm[1] : nm[0]; return { i, mine, theirs }; })
      .filter(c => tdSur(c.mine) === me);
    const both = near.filter(c => tdSur(c.theirs) === o);
    if (both.length > 1) return 'two Database rows fit this match (the join never picks between them)';
    if (both.length === 1) {
      const c = both[0], rd = db.meta.rounds[db.rows[c.i][3]];
      if (ourIni(x.opponent) && tdIni(c.theirs) && ourIni(x.opponent) !== tdIni(c.theirs)) return \`name spelling ('\${c.theirs}' in the Database vs '\${x.opponent}')\`;
      if (ourIni(name) && tdIni(c.mine) && ourIni(name) !== tdIni(c.mine)) return \`name spelling ('\${c.mine}' in the Database vs '\${name}')\`;
      const off = Math.round(dayOf(db.rows[c.i][0]) - d0);
      if (off < -3 || off > 16) return \`date (the Database dates it \${off > 0 ? '+' : ''}\${off} days from the career row)\`;
      return \`round ('\${rd}' in the Database vs '\${x.round || 'none'}')\`;
    }
    if (near.length) return \`the opponent's name ('\${near.map(c => c.theirs).filter((v, j, a) => a.indexOf(v) === j).slice(0, 2).join("' / '")}' in the Database vs '\${x.opponent}')\`;
    return 'the Database holds no row for this match';
  };
  const qAdd = (x, k, name, page, kind, meId, dbKey, cause, shown) =>
    Q.push({ key: k, player: name, date: x.date, opp: x.opponent, event: x.tournament, round: x.round || null, page, kind, me: meId || null, db: dbKey || null, cause, shown: shown || null });
  const meIdOf = (k, tdKey, hit) => { if (tdKey) { const [date, opp, w] = tdKey.split('|'); return { key: k, date, opp, won: w === '1' }; }
    return hit && hit._id ? Object.assign({ key: k }, hit._id) : null; };
  // ---- coverage (founder ruling 2026-10-18, item 5)
  const COVON = ${!!COV};
  const CV = { byLevel: {}, byMonth2026: {}, players: {}, joinMiss: 0, joinMissEx: [], roundDisagree: 0, roundDisagreeEx: [] };
  const lvOf = x => x.level === 'atp' ? (x.qualifying || x._qual || /qualif/i.test(String(x.round || '') + ' ' + String(x.tournament || '')) ? 'ATP qualifying' : 'ATP main draw')
    : (/^(M|W)\\d{2,3}\\b|\\bITF\\b/.test(String(x.tournament || '')) ? 'ITF' : (x.qualifying || x._qual || /qualif/i.test(String(x.round || '') + ' ' + String(x.tournament || '')) ? 'Challenger qualifying' : 'Challenger main draw'));
  // founder brief 2026-10-19 (item 1): api-tennis files a qualifying draw under the main-draw event with its own word rounds
  // ("Semi-finals", "Final"); such a row is ATP qualifying, not main draw, when the player's own rows hold no main-draw round
  // ("1/N-finals") at that event on or before it (h2h-core's D1 rule, read from one player's rows) — the report counted
  // ~470 of them as ATP main draw (2021-22). A round-robin event (no rounds) and team events keep their level.
  const WORD_RD = /^(quarter|semi|final)/i, FRAC_RD = /^1[/][0-9]+-finals$/i;
  const ownQual = (x, career) => {
    if (x.level !== 'atp' || !WORD_RD.test(String(x.round || '')) || /davis|united cup|atp cup|laver|hopman|olympi/i.test(String(x.tournament || ''))) return false;
    const d0 = dn(x.date), at = career.filter(r => r && r.tournament === x.tournament && Math.abs(dn(r.date) - d0) <= 16);
    if (at.some(r => /^(rr|round robin|)$/i.test(String(r.round || '').trim()))) return false;   // the Finals: no qualifying draw
    return !at.some(r => FRAC_RD.test(String(r.round || '')) && dn(r.date) <= d0);
  };
  const coverOf = (k, name, career) => {
    const rows = career.filter(x => x && x.date);
    const vs = rows.map(x => ({ date: x.walkover ? null : x.date, won: !!x.won, round: x.round, opp: x.opponent }));
    J(vs, { full: name }, null, db, null, career);
    rows.forEach((x, i) => {
      // a row the join priced on a Tennis-Data row is main draw by evidence (Tennis-Data lists the main draw only): the own-rows
      // rule moves only rows no Tennis-Data row priced (measured 19 Oct: 11 priced word-round rows would otherwise move)
      const v = vs[i], tdPriced = v.price != null && (v.book === 'P' || v.book === 'B') && v.src === 'td';
      const lv = !tdPriced && ownQual(x, career) ? 'ATP qualifying' : lvOf(x), y = String(x.date).slice(0, 4);
      const nb = () => ({ n: 0, priced: 0, byBook: {}, walkover: 0, one: 0, nobook: 0, none: 0 });
      const cs = [((CV.byLevel[lv] = CV.byLevel[lv] || {})[y] = CV.byLevel[lv][y] || nb())];
      if (y === '2026') { const mo = String(x.date).slice(0, 7); cs.push(((CV.byMonth2026[lv] = CV.byMonth2026[lv] || {})[mo] = CV.byMonth2026[lv][mo] || nb())); }   // 2026 by month too
      const c = { inc(f, b) { cs.forEach(o => { if (b) o.byBook[b] = (o.byBook[b] || 0) + 1; else o[f]++; }); } };
      c.inc('n');
      if (x.walkover) { c.inc('walkover'); return; }
      if (v.price != null) { c.inc('priced'); c.inc(null, v.book === 'A' ? (v.src === 'od10' ? 'start-10' : v.src === 'te' ? 'Tennis Explorer approx' : v.src === 'early' ? 'early cut' : 'api-tennis approx') : v.book === 'B' ? (v.src === 'cap' ? 'Bet365 (approx.)' : v.src === 'atb' ? 'api-tennis Bet365 (approx.)' : 'Bet365') : 'real close'); return; }
      const why = sfDbNoPriceWhy(name, vs[i]);
      c.inc(why);
      const P = CV.players[k] = CV.players[k] || { name, unpriced: 0 }; P.unpriced++;
      if (why === 'none') {
        const me = ourSur(name), o = ourSur(x.opponent), d0 = dn(x.date);
        const fit = (bySur.get(me) || []).filter(j => { const dd = dayOf(db.rows[j][0]) - d0; if (dd < -1 || dd > 16) return false;
          const nm = db.names[j]; return tdSur(x.won ? nm[0] : nm[1]) === me && tdSur(x.won ? nm[1] : nm[0]) === o; });
        // a Database row of the same pair whose round contradicts this one is ANOTHER match (or a level the two sources
        // disagree on): the join refuses it on purpose, so it is reported as a round disagreement, never as a join miss
        if (fit.length) { const cause = causeNotHeld(x, name), e = { key: k, player: name, date: x.date, opp: x.opponent, event: x.tournament, level: lv, cause };
          if (/^round \\(/.test(cause)) { CV.roundDisagree++; if (CV.roundDisagreeEx.length < 100) CV.roundDisagreeEx.push(e); }
          else { CV.joinMiss++; if (CV.joinMissEx.length < 60) CV.joinMissEx.push(e); } }
      }
    });
  };
  let n = 0;
  for (const k of keys) {
    if (ONLY.size && !ONLY.has(k)) continue;
    const sample = +k % SAMPLE === 0 || ONLY.size > 0;
    const career = await careerOf(k);
    if (!Array.isArray(career) || !career.length) continue;
    S.players++;
    if (COVON) { const nm0 = nameOf(k); if (nm0) try { coverOf(k, nm0, career); } catch (e) { CV.threw = (CV.threw || 0) + 1; if (!CV.threwEx) CV.threwEx = { key: k, err: String(e && e.message || e) }; } }   // a report: never stops the publish
    const has2026 = career.some(x => x && String(x.date || '').slice(0, 4) === '2026');   // every level (founder 2026-10-18 item 3)
    if (!has2026 && !sample) continue;
    if (LIMIT && ++n > LIMIT) break;
    const name = nameOf(k);
    if (!name) continue;
    const [cl, ms] = await Promise.all([closesOf(k), meLoadProfileShard(k)]);
    S.playersChecked++;
    const meRows = meRowsFor(career, cl, k, name);
    const win = new Map();
    (ms && ms.matches ? meWinnerRows(ms, meRows, k, name) : []).forEach(r => { if (r.tdKey) win.set(r.tdKey, win.has(r.tdKey) ? null : r); });
    // a Market edge row with no Tennis-Data row behind it (our archive's matches after Tennis-Data's last day, the era
    // shard): paired with the career match on the same day (±1), the same result and the opponent's surname — one only
    const surn = n => String(n || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/^[a-z]{1,3}\\.?(-[a-z]\\.)?\\s+/, '').split(/[\\s,]+/)[0];
    const meBy = new Map();
    for (const m of (ms && ms.matches) || []) { if (m.price == null) continue; const kk = m.date + '|' + (m.won ? 1 : 0) + '|' + String(m.opp || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').split(/[\\s,]+/)[0]; meBy.set(kk, meBy.has(kk) ? null : m); }
    const meOf = x => { const d0 = Date.parse(x.date + 'T00:00:00Z'); let hit = null, n = 0;
      for (const dd of [0, -1, 1]) { const ds = new Date(d0 + dd * 864e5).toISOString().slice(0, 10), m = meBy.get(ds + '|' + (x.won ? 1 : 0) + '|' + surn(x.opponent)); if (m) { hit = m; n++; } }
      return n === 1 ? { price: hit.price, oppPrice: hit.oppPrice, book: hit.book === 'bet365-archive' ? 'B' : /approx|early/.test(hit.book) ? 'A' : 'P',
        src: hit.book === 'pinnacle-history' ? 'hist' : hit.book === 'pinnacle-capture' ? 'cap' : hit.book === 'pinnacle-approx-od10' ? 'od10' : hit.book === 'pinnacle-approx-te' ? 'te' : hit.book === 'pinnacle-early' ? 'early' : 'td',
        _id: { date: hit.date, opp: hit.opp, won: !!hit.won } } : null; };
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
      // founder ruling 2026-10-18 (item 3): ATP qualifying, Challenger and ITF are master classes too — every played match is checked
      if (!x || x.walkover) return;
      const lv = x.level !== 'atp' ? 'chitf' : x.qualifying || /^qualif/i.test(String(x.round || '')) ? 'atp-q' : 'atp';
      const y = String(x.date || '').slice(0, 4);
      if (!(y === '2026' || sample)) return;
      S.byLevel[lv] = S.byLevel[lv] || { matches: 0, held: 0 }; S.byLevel[lv].matches++;
      const tab = meRowFromCareer(x, cl, k, name, i);
      const js = [{ date: x.date, won: !!x.won, round: tab.round, opp: x.opponent }];
      J(js, { full: name }, null, db, null, career);
      const ref = js[0].price != null ? js[0] : null;
      S.matches++; S.byYear[y] = S.byYear[y] || { matches: 0, held: 0, failed: 0, reported: 0 }; S.byYear[y].matches++;
      const row = { key: k, player: name, date: x.date, opp: x.opponent, event: x.tournament, round: x.round || null, ref: pick(ref), tab: pick(tab) };
      const cap = null;   // the Head to Head page's captured step is gone (ruling 5): nothing to compare
      // the fallback pairing only for a keyed (match-dated) career row; an archive row is dated at its event's start
      const meRow = (tab.tdKey ? win.get(tab.tdKey) || null : null) || (x.eventKey != null && !tab.tdKey ? meOf(x) : null);
      const formRow = formAt.get(x.date + '|' + x.opponent + '|' + (x.won ? 1 : 0)) || null;
      const showIt = SHOW.has(String(x.eventKey)) || picked(k, x);
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
      if (okOf(x) != null && (x.eventKey != null || picked(k, x)) && (FOCUS.has(String(x.eventKey)) || showIt || +x.eventKey % H2H_EVERY === 0)) h2hJobs.push({ x, ref, row, dk: dbKeyOf(js[0].dbi) });
      if (ref) {
        S.dbHeld++; S.byYear[y].held++; S.byLevel[lv].held++;
        let bad = false;
        S.checked.tab++; if (meRow) S.checked.me++; if (cap) S.checked.cap++; if (formRow) S.checked.form++;
        const dk = dbKeyOf(js[0].dbi), mid = meRow ? meIdOf(k, tab.tdKey, meRow) : null;
        const diff = (pg, o) => qAdd(x, k, name, pg, 'different', mid, dk, \`a different price from the master (\${pick(o)} vs \${pick(ref)})\`, pick(o));
        if (pick(tab) !== pick(ref)) { S.fail.tab++; note('fail', 'tab ≠ Database', row); bad = true; diff('the Match analysis tabs', tab); }
        if (formRow && pick(formRow) !== pick(ref)) { S.fail.form++; note('fail', 'Form tab ≠ Database', Object.assign({}, row, { form: pick(formRow) })); bad = true; diff('the Form tab', formRow); }
        if (meRow && pick(meRow) !== pick(ref)) { S.fail.me++; note('fail', 'Market edge shard ≠ Database', Object.assign({}, row, { me: pick(meRow) })); bad = true; diff('Market edge', meRow); }
        if (cap && pick(cap) !== pick(ref)) { S.fail.cap++; note('fail', 'Head to Head captured step ≠ Database', Object.assign({}, row, { cap: pick(cap) })); bad = true; }
        if (bad) S.byYear[y].failed++;
      } else {
        S.notHeld++;
        // ruling 3: a master-class match the join does not hold is a dash on every surface — a price anywhere is a path of
        // its own and fails the run
        let bad = false;
        const nh = (pg, o) => qAdd(x, k, name, pg, 'not held', pg === 'Market edge' ? meIdOf(k, tab.tdKey, meRow) : null, null, causeNotHeld(x, name), pick(o));
        if (tab.price != null) { S.fail.tab++; note('fail', 'tab prices a match the master does not hold (own price path)', row); bad = true; nh('the Match analysis tabs', tab); }
        if (formRow && formRow.price != null) { S.fail.form++; note('fail', 'Form tab prices a match the master does not hold (own price path)', Object.assign({}, row, { form: pick(formRow) })); bad = true; nh('the Form tab', formRow); }
        if (meRow && meRow.price != null) { S.fail.me++; note('fail', 'Market edge prices a match the join does not hold (own price path)', Object.assign({}, row, { me: pick(meRow) })); bad = true; nh('Market edge', meRow); }
        if (bad) S.byYear[y].failed++;
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
      const hit = ms2.filter(r => (j.x.eventKey != null ? String(r.ek) === String(j.x.eventKey) : r.date === j.x.date && r.won === !!j.x.won));
      if (hit.length !== 1 || hit[0].wo) continue;
      j.row.h2h = pick(hit[0]);   // printed only for a shown / picked match
      if (j.ref) { S.checked.h2h++; if (pick(hit[0]) !== pick(j.ref)) { S.fail.h2h++; note('fail', 'H2H tab ≠ Database', Object.assign({}, j.row, { h2h: pick(hit[0]) }));
        qAdd(j.x, k, name, 'the H2H tab', 'different', null, j.dk, \`a different price from the master (\${pick(hit[0])} vs \${pick(j.ref)})\`, pick(hit[0])); } }
      else if (hit[0].price != null) { S.fail.h2h++; note('fail', 'H2H tab prices a match the master does not hold (own price path)', Object.assign({}, j.row, { h2h: pick(hit[0]) }));
        qAdd(j.x, k, name, 'the H2H tab', 'not held', null, null, causeNotHeld(j.x, name), pick(hit[0])); }
    }
  }
  S.focus.notFound = [...FOCUS].filter(k => !S.focus.seen[k]).map(k => Object.assign({ eventKey: k }, S.focus.rowOf[k] || { inNoCheckedCareer: true }));
  delete S.focus.rowOf;
  S.quarantine = Q;
  if (COVON) { const top = Object.entries(CV.players).sort((a, b) => b[1].unpriced - a[1].unpriced).slice(0, 20).map(([key, v]) => Object.assign({ key }, v)); CV.top20 = top; delete CV.players; S.coverage = CV; }
  return S;
})()`).catch(e => fail('the in-page check threw: ' + e.message));

ch.kill('SIGKILL'); if (!LIVE) server.close();
for (const r of result.shown || []) console.log('SHOW ' + JSON.stringify(r));
const failN = Object.values(result.fail).reduce((a, b) => a + b, 0);
console.log(`### price-consistency ${JSON.stringify({ lag: LAG, players: result.players, playersChecked: result.playersChecked, matches: result.matches, dbHeld: result.dbHeld,
  notHeld: result.notHeld, checked: result.checked, failures: result.fail, reported: result.report, byYear: result.byYear, byLevel: result.byLevel })}`);
if (FOCUS.length) { const f = Object.assign({}, result.focus); delete f.seen; console.log(`### focus ${JSON.stringify(f)}`); }
for (const r of result.ex.fail.slice(0, 40)) console.log('FAIL ' + JSON.stringify(r));
for (const r of result.ex.report.slice(0, 40)) console.log('REPORT ' + JSON.stringify(r));
if (REPORT) writeFileSync(REPORT, JSON.stringify(result, null, 1));
if (COV && result.coverage) {
  const C = result.coverage, tot = {};
  for (const [lv, ys] of Object.entries(C.byLevel)) { const t = tot[lv] = { n: 0, priced: 0, walkover: 0, one: 0, nobook: 0, none: 0 }; for (const c of Object.values(ys)) for (const f of Object.keys(t)) t[f] += c[f] || 0; }
  const tmp = COV + '.tmp';
  writeFileSync(tmp, JSON.stringify({ rule: 'every played match of every player with a career-history shard: priced, or its reason (founder 2026-10-18 item 5)', builtAt: new Date().toISOString(), totals: tot, ...C }));
  renameSync(tmp, COV);
  console.log(`### price-coverage ${JSON.stringify({ totals: tot, joinMiss: C.joinMiss, roundDisagree: C.roundDisagree || 0, threw: C.threw || 0, file: COV })}`);
}
if (!result.playersChecked || !result.matches) { console.error('price-consistency: checked 0 players / 0 matches — a check on an empty set is not a check'); process.exit(1); }
if (QOUT) {
  // one entry per match (both players' sides of it merged), the pages that tripped listed together
  const byMatch = new Map();
  for (const q of result.quarantine || []) {
    const sur = n => String(n || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^([a-z]{1,3}\.\s*)+/, '').trim();
    const id = q.date + '|' + [sur(q.player), sur(q.opp)].sort().join('|');
    const e = byMatch.get(id) || Object.assign({}, q, { pages: [], me: [], db: q.db || null });
    if (!e.pages.includes(q.page)) e.pages.push(q.page);
    if (q.me && !e.me.some(m => m.key === q.me.key && m.date === q.me.date && m.opp === q.me.opp)) e.me.push(q.me);
    if (q.db && !e.db) e.db = q.db;
    byMatch.set(id, e);
  }
  const entries = [...byMatch.values()].map(e => { delete e.page; return e; });
  const tmp = QOUT + '.tmp';
  writeFileSync(tmp, JSON.stringify({ rule: 'one match problem never stops the site: each match below is a dash on every page this build (founder 2026-10-18)',
    builtAt: new Date().toISOString(), failures: result.fail, entries }, null, 1));
  renameSync(tmp, QOUT);
  if (result.fail.threw) { console.error(`price-consistency: a page function threw (${result.fail.threw}) — the check did not run, failing closed`); process.exit(1); }
  console.log(`price-consistency: ${failN ? failN + ' difference(s) on ' + entries.length + ' match(es) → quarantined (a dash on every page), the run publishes' : 'OK — no difference'} (${QOUT})`);
  process.exit(0);
}
if (failN) { console.error(`price-consistency: ${failN} surface(s) show a different price, source or label than the Database for a match it holds`); process.exit(1); }
console.log(`price-consistency: OK — ${result.dbHeld} matches the Database holds show one price on every surface checked`);
process.exit(0);
