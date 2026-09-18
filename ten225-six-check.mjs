// TEN-225 — the founder's six confirmations, read off the DEPLOYED URL.
//
// "Merged is not shipped": nothing here reads a repo file. The page is the live
// one, the raw odds-card-state.json is fetched from the same origin, and every
// headline figure is recomputed from that RAW JSON independently of the page's
// own resolvers — so a resolver that is wrong in the same way twice cannot
// report itself as correct.
//
// Item 5 carries a MUTATION control: if the deployed file happens to carry no
// zero today, a zero is injected into OCS.byKey and the resolver re-run, so the
// guard is proven to bite rather than proven to be untested.
import { setTimeout as sleep } from 'node:timers/promises';

const PAGE = 'https://michaeldk1996.github.io/SAAS/bsp-consult-dashboard.html';
const ORIGIN = 'https://michaeldk1996.github.io/SAAS';
const DATA = process.env.PAPERCLIP_RUN_SCRATCH_DIR || '/tmp';

const AUTH_STUB = `
(function(){
  const user = { uid:'probe', email:'probe@example.com', emailVerified:true, displayName:'Probe' };
  const STUB = { ready: Promise.resolve(user), currentUser: () => user,
    whenAuthReady: () => Promise.resolve(user), requireVerified: () => Promise.resolve(user),
    requireAuth: () => Promise.resolve(user),
    onAuthChange: cb => { try { cb(user); } catch(e){} return () => {}; },
    isValidEmail: () => true, updateProfile: () => Promise.resolve(),
    NOTIF: { show(){}, hide(){} } };
  Object.defineProperty(window, 'BSP', { value: STUB, writable:false, configurable:false });
})();`;

async function cdp() {
  const { spawn } = await import('node:child_process');
  const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--remote-debugging-port=0', '--no-first-run',
     '--no-default-browser-check', '--disable-gpu',
     '--user-data-dir=' + DATA + '/ten225-six-chrome', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  let wsUrl = null;
  proc.stderr.on('data', d => { const m = /ws:\/\/[^\s]+/.exec(String(d)); if (m && !wsUrl) wsUrl = m[0]; });
  for (let i = 0; i < 120 && !wsUrl; i++) await sleep(100);
  if (!wsUrl) { proc.kill(); throw new Error('no CDP endpoint'); }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiters = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) { const { res, rej } = waiters.get(m.id); waiters.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id; waiters.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  return { send: (m, p) => send(m, p, sessionId), close: () => { try { ws.close(); } catch {} proc.kill(); } };
}

const FAIL = [];
const check = (n, ok, d) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${n}${ok || d === undefined ? '' : '  ' + JSON.stringify(d).slice(0, 500)}`);
  if (!ok) FAIL.push(n);
};

// ---- independent recompute, straight off the published JSON ----------------
const rawOcs = await (await fetch(`${ORIGIN}/odds-card-state.json?cb=${Date.now()}`)).json();
const rawBuild = await (await fetch(`${ORIGIN}/build-info.json?cb=${Date.now()}`)).json();
const PRICE_FIELDS = ['open', 'now', 'close'];
let rawZeroFields = 0;
const rawZeroKeys = [];
for (const [k, e] of Object.entries(rawOcs.byKey || {})) {
  for (const side of Object.values(e.sides || {})) {
    for (const f of PRICE_FIELDS) if (side[f] === 0) { rawZeroFields++; if (!rawZeroKeys.includes(k)) rawZeroKeys.push(k); }
  }
}
// The same score the shipped sort claims to compute, derived here from the raw
// file alone: max two-sided |now/open - 1|, both legs of both sides > 0.
function rawMoveScore(key) {
  const e = rawOcs.byKey?.[key];
  if (!e) return null;
  const [a, b] = Object.values(e.sides || {});
  if (!a || !b) return null;
  const ok = v => typeof v === 'number' && v > 0;
  if (!ok(a.open) || !ok(b.open) || !ok(a.now) || !ok(b.now)) return null;
  return Math.max(Math.abs(a.now / a.open - 1), Math.abs(b.now / b.open - 1));
}

const c = await cdp();
try {
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: AUTH_STUB });
  await c.send('Page.navigate', { url: PAGE + '?cb=ten225six' });
  const ev = async e => {
    const r = await c.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };
  for (let i = 0; i < 180; i++) { if (await ev('document.querySelectorAll(".mx-match").length || 0')) break; await sleep(500); }

  const pageCommit = await ev('fetch("./build-info.json",{cache:"no-store"}).then(r=>r.json()).then(j=>j.commit)');
  console.log('TEN-225 — SIX CONFIRMATIONS, READ ON THE DEPLOYED URL');
  console.log(`  url             ${PAGE}`);
  console.log('');
  console.log('1. DEPLOYED COMMIT');
  console.log(`   build-info.commit  ${pageCommit}`);
  console.log(`   builtAt            ${rawBuild.builtAt}   runNumber ${rawBuild.runNumber}`);
  console.log(`   odds-card-state    generatedAt ${rawOcs.generatedAt}  entries ${Object.keys(rawOcs.byKey || {}).length}`);
  check('the served bytes carry this morning\'s code (_ocsSanePx + moveNowScore)',
        await ev('typeof _ocsSanePx === "function" && typeof moveNowScore === "function" && typeof _mcOpenNowPair === "function"'));

  // Put the board where the founder is looking: Today, Upcoming, default sort.
  await ev(`(function(){ if (typeof setMatchesView==='function') setMatchesView('upcoming'); else state.view='upcoming';
                         state.day='today'; state.sort='time'; renderMatches(); return true; })()`);
  await sleep(1200);

  // ---- 2. countdown -------------------------------------------------------
  console.log('');
  console.log('2. COUNTDOWN IN THE CARD HEADER');
  const cd = await ev(`(function(){
    const heads = [...document.querySelectorAll('.mx-match .mc-head')];
    const RE = /\\bin\\s*\\d+\\s*(h|m|hr|hours?|min)\\b/i;
    const hits = heads.filter(h => RE.test(h.textContent));
    const hs = heads.map(h => Math.round(h.getBoundingClientRect().height));
    const tally = {}; hs.forEach(v => tally[v] = (tally[v]||0)+1);
    return { heads: heads.length, hits: hits.length,
             sample: hits.slice(0,5).map(h => h.textContent.trim().replace(/\\s+/g,' ')),
             heights: tally, wrapped: hs.filter(v => v > 50).length,
             relStartHtmlPresent: typeof relStartHtml !== 'undefined',
             firstHeaders: heads.slice(0,4).map(h => h.textContent.trim().replace(/\\s+/g,' ')) };
  })()`);
  console.log(`   headers scanned      ${cd.heads}`);
  console.log(`   "in Xh" nodes        ${cd.hits}`);
  console.log(`   header heights       ${JSON.stringify(cd.heights)}   wrapped(>50px) ${cd.wrapped}`);
  cd.firstHeaders.forEach(h => console.log(`     header: ${h}`));
  check('no countdown text in any card header', cd.hits === 0, cd.sample);
  check('no header wraps to two lines', cd.wrapped === 0, cd.heights);
  check('relStartHtml is deleted, not merely unreferenced', cd.relStartHtmlPresent === false);

  // ---- 3. drift sort ------------------------------------------------------
  console.log('');
  console.log('3. DRIFT SORT — computed score per card, DOM order');
  await ev(`(function(){ state.sort='drift'; renderMatches(); return true; })()`);
  await sleep(1500);
  const drift = await ev(`(function(){
    const byId = new Map(matches.map(m => [String(m.id), m]));
    const cards = [...document.querySelectorAll('.mx-match')];
    const rows = cards.map((card, i) => {
      const m = byId.get(card.getAttribute('data-id'));
      const odds = [...card.querySelectorAll('.mc-odds')].map(n => n.textContent.trim());
      const s = m ? moveNowScore(m) : null;
      const p = m ? _mcOpenNowPair(m) : null;
      return { i: i+1, id: card.getAttribute('data-id'),
               name: m ? (m.p1 + ' v ' + m.p2) : '(unmapped)',
               key: m ? ocsKeyOf(m) : null,
               score: s, odds: odds.slice(0,2),
               open: p ? [p.o1, p.o2] : null, now: p ? [p.n1, p.n2] : null,
               book: p ? p.book : null };
    });
    return { n: cards.length, rows, MOVE_NONE: typeof MOVE_NONE !== 'undefined' ? MOVE_NONE : null,
             MOVE_UNPRICED: typeof MOVE_UNPRICED !== 'undefined' ? MOVE_UNPRICED : null,
             sortState: state.sort };
  })()`);
  console.log(`   cards on the board   ${drift.n}   sort=${drift.sortState}   MOVE_NONE=${drift.MOVE_NONE} MOVE_UNPRICED=${drift.MOVE_UNPRICED}`);
  console.log('   #  score      open → now            book        match');
  drift.rows.slice(0, 10).forEach(r => {
    const sc = r.score === null ? 'null'
      : r.score === drift.MOVE_UNPRICED ? 'UNPRICED'
      : r.score === drift.MOVE_NONE ? 'no-move '
      : (r.score * 100).toFixed(1) + '%';
    const legs = r.open && r.now ? `${r.open[0]}/${r.open[1]} → ${r.now[0]}/${r.now[1]}` : '—';
    console.log(`   ${String(r.i).padStart(2)} ${sc.padEnd(10)} ${String(legs).padEnd(22)} ${String(r.book||'—').padEnd(11)} ${r.name}`);
  });
  const scores = drift.rows.map(r => r.score);
  const monotone = scores.every((v, i) => i === 0 || scores[i-1] >= v);
  check('DOM order is exactly descending by the computed score', monotone,
        scores.map((v,i)=>({i:i+1,v})).filter((_,i)=> i>0 && scores[i-1] < scores[i]).slice(0,5));
  const lastReal = scores.findIndex(v => v === drift.MOVE_UNPRICED);
  check('fully unpriced fixtures sit LAST, none hidden',
        lastReal === -1 || scores.slice(lastReal).every(v => v === drift.MOVE_UNPRICED),
        { firstUnpricedAt: lastReal + 1, n: drift.n });
  check('every card still on the board under Drift (nothing hidden)', drift.n === drift.rows.length);
  // independent recompute off the RAW published file
  const disagree = drift.rows.filter(r => {
    const raw = r.key ? rawMoveScore(r.key) : null;
    if (raw === null) return false;               // page may resolve via non-OCS paths
    return r.score === null || Math.abs(raw - r.score) > 1e-9;
  }).map(r => ({ name: r.name, page: r.score, raw: rawMoveScore(r.key) }));
  check('page score == score recomputed from the raw published JSON (independent)',
        disagree.length === 0, disagree.slice(0, 5));

  // ---- 4. tile vs board ---------------------------------------------------
  console.log('');
  console.log('4. TILE vs BOARD — same comparator, same book rule');
  const tile = await ev(`(function(){
    const el = [...document.querySelectorAll('.mc-story')].find(n => /Biggest market move/i.test(n.textContent));
    if (!el) return { found:false };
    const od = el.querySelector('.mc-story__od'), ctx = el.querySelector('.mc-story__ctx'),
          drift = el.querySelector('.mc-drift'), faint = el.querySelector('.mc-story__faint');
    const strong = ctx ? ctx.querySelector('strong') : null;
    return { found:true, od: od?od.textContent.trim():null, pct: drift?drift.textContent.trim():null,
             who: strong?strong.textContent.trim():null, ctx: ctx?ctx.textContent.trim().replace(/\\s+/g,' '):null,
             faint: faint?faint.textContent.trim():null,
             pressed: el.getAttribute('aria-pressed'), on: el.classList.contains('is-on') };
  })()`);
  console.log(`   tile             ${tile.od}  ${tile.pct}`);
  console.log(`   tile context     ${tile.ctx}`);
  console.log(`   tile provenance  ${tile.faint}`);
  console.log(`   tile selected    aria-pressed=${tile.pressed} is-on=${tile.on}`);
  const top = drift.rows[0];
  console.log(`   top card (#1)    ${top.name}   score ${(top.score*100).toFixed(1)}%   book ${top.book}`);
  check('the tile names a player from the card the sort puts FIRST',
        !!tile.who && (top.name.includes(tile.who) || top.name.toLowerCase().includes(String(tile.who).toLowerCase())),
        { tileWho: tile.who, topCard: top.name });
  const tileMag = (() => { const m = /(\d+(?:\.\d+)?)\s*→\s*(\d+(?:\.\d+)?)/.exec(tile.od || '');
    return m ? Math.abs(parseFloat(m[2]) / parseFloat(m[1]) - 1) : null; })();
  check('the tile\'s own move equals the top card\'s computed score (one comparator)',
        tileMag !== null && Math.abs(tileMag - top.score) < 0.005, { tileMag, topScore: top.score });
  check('the tile reads as selected while its sort is active', tile.on === true && tile.pressed === 'true');
  check('the tile\'s provenance line names the book that produced the figure',
        !!tile.faint && tile.faint.toLowerCase().includes(String(top.book || '').toLowerCase()),
        { faint: tile.faint, book: top.book });

  // The card's odds markup DIFFERS BY VIEW: the default board renders
  // `.mc-oddswrap > .mc-odds` with one title on the wrapper (the Now); the Drift
  // board renders `mcDriftCell` — `.mc-drifted__open` and `.mc-drifted__now`,
  // each with its OWN title. A probe that reads only `.mc-odds` after switching
  // to Drift finds nothing and passes on an empty set. Both views are read, and
  // a view returning zero cells is a FAILURE, not a pass.
  const readCells = async view => {
    await ev(`(function(){ state.sort=${JSON.stringify(view === 'drift' ? 'drift' : 'time')}; renderMatches(); return true; })()`);
    await sleep(1200);
    return ev(`(function(){
      const DASH = s => s === '\\u2014' || s === '-' || s === '\\u2013' || s === '';
      const byId = new Map(matches.map(m => [String(m.id), m]));
      const out = [];
      [...document.querySelectorAll('.mx-match')].forEach(card => {
        const m = byId.get(card.getAttribute('data-id'));
        const base = { match: m ? m.p1 + ' v ' + m.p2 : '?', key: m ? ocsKeyOf(m) : null };
        const grab = (sel, leg) => [...card.querySelectorAll(sel)].forEach((cell, idx) => {
          const wrapTitle = cell.closest('.mc-oddswrap');
          out.push(Object.assign({}, base, {
            leg, side: idx === 0 ? 'p1' : 'p2', px: cell.textContent.trim(),
            dash: DASH(cell.textContent.trim()),
            title: (cell.getAttribute('title') || (wrapTitle ? wrapTitle.getAttribute('title') : '') || '').trim() }));
        });
        grab('.mc-oddswrap .mc-odds', 'now');
        grab('.mc-drifted__open', 'open');
        grab('.mc-drifted__now', 'now');
      });
      return out;
    })()`);
  };

  // ---- 5. zero never reaches a price cell ---------------------------------
  console.log('');
  console.log('5. ZERO NEVER REACHES A PRICE CELL');
  console.log(`   published file carries ${rawZeroFields} zero price field(s)` +
              (rawZeroKeys.length ? ` on ${rawZeroKeys.length} fixture(s): ${rawZeroKeys.slice(0,4).join(', ')}` : ''));
  const zeroReach = await ev(`(function(){
    let reached = 0; const where = [];
    for (const [k, e] of Object.entries(OCS.byKey || {})) {
      for (const [side, s] of Object.entries(e.sides || {})) {
        for (const f of ['open','now','close']) {
          if (s[f] === 0) {
            const sane = _ocsSanePx(s);
            if (sane && sane[f] === 0) { reached++; where.push(k + '/' + side + '/' + f); }
          }
        }
      }
    }
    return { reached, where: where.slice(0,5) };
  })()`);
  console.log(`   zero fields reaching a resolver   ${zeroReach.reached}`);
  check('no zero reaches a resolver', zeroReach.reached === 0, zeroReach.where);
  const zeroPainted = {};
  for (const view of ['default', 'drift']) {
    const cells = await readCells(view);
    const zc = cells.filter(t => /^0(\.0+)?$/.test(t.px));
    zeroPainted[view] = { cells: cells.length, zero: zc.length };
    console.log(`   ${view.padEnd(8)} view: ${cells.length} odds cells rendered, printing 0.00: ${zc.length}`);
    check(`NON-VACUITY: the ${view} view actually rendered odds cells`, cells.length > 0);
    check(`no rendered odds cell prints 0.00 (${view} view)`, zc.length === 0, zc.slice(0,3));
  }
  // MUTATION CONTROL — prove the guard bites rather than that it was never asked.
  const mut = await ev(`(function(){
    const k = Object.keys(OCS.byKey || {})[0];
    if (!k) return { ran:false };
    const e = OCS.byKey[k], sk = Object.keys(e.sides)[0];
    const before = JSON.parse(JSON.stringify(e.sides[sk]));
    e.sides[sk] = Object.assign({}, before, { now: 0, nowTs: '2026-09-18T00:00:00+00:00' });
    const sane = _ocsSanePx(e.sides[sk]);
    const guarded = !sane || sane.now == null;
    // moveNowScore must refuse to score off the injected zero
    const m = matches.find(x => ocsKeyOf(x) === k);
    const score = m ? moveNowScore(m) : null;
    const scoredFabricated = score !== null && score > 0.9 && score !== 1;
    e.sides[sk] = before;             // restore; nothing persists
    const restored = JSON.stringify(OCS.byKey[k].sides[sk]) === JSON.stringify(before);
    return { ran:true, key:k, side:sk, guarded, score, scoredFabricated, restored };
  })()`);
  if (mut.ran) {
    console.log(`   MUTATION CONTROL — injected now:0 into ${mut.key}/${mut.side}`);
    console.log(`     _ocsSanePx suppressed it: ${mut.guarded}   moveNowScore after injection: ${mut.score}`);
    check('CONTROL: an injected zero is suppressed by _ocsSanePx (guard is not vacuous)', mut.guarded === true);
    check('CONTROL: an injected zero does not mint a ~-100% move', mut.scoredFabricated === false, mut.score);
    check('CONTROL: the page state was restored after the mutation', mut.restored === true);
  }

  // ---- 6. tooltip ---------------------------------------------------------
  console.log('');
  console.log('6. HOVER TOOLTIP — book + timestamp OF THE PRICE IT SITS OVER');
  // `ocsFmtTs` is the page's own formatter and is used ONLY to render a raw
  // timestamp into the string the cell would show. The assertion is about WHICH
  // raw field the cell used (openTs vs nowTs), which the formatter cannot fake:
  // where the two differ, naming the wrong one is exactly the stale-label defect.
  for (const view of ['default', 'drift']) {
    const tips = await readCells(view);
    const priced = tips.filter(t => !t.dash), dashed = tips.filter(t => t.dash);
    const titledPriced = priced.filter(t => t.title), titledDashed = dashed.filter(t => t.title);
    console.log(`   — ${view} view: ${tips.length} cells, ${priced.length} priced, ${dashed.length} dashed`);
    console.log(`     priced carrying a tooltip  ${titledPriced.length}/${priced.length}`);
    console.log(`     dashed carrying a tooltip  ${titledDashed.length}  (must be 0)`);
    titledPriced.slice(0, 4).forEach(t => console.log(`       ${t.leg.padEnd(5)} ${t.px.padEnd(6)} "${t.title}"   ${t.match}`));
    check(`NON-VACUITY: ${view} view rendered priced cells to test`, priced.length > 0);
    check(`every priced cell carries a tooltip (${view})`, titledPriced.length === priced.length,
          priced.filter(t => !t.title).slice(0, 4));
    check(`no dashed cell names a book (${view})`, titledDashed.length === 0, titledDashed.slice(0, 4));

    // Independent: book + timestamp must match the RAW published row for THAT leg.
    const wrongBook = [], wrongTs = [];
    for (const t of titledPriced) {
      const e = t.key ? rawOcs.byKey?.[t.key] : null;
      if (!e) continue;                       // resolved outside odds_card_state
      if (!String(t.title).toLowerCase().includes(String(e.book || '').toLowerCase()))
        wrongBook.push({ match: t.match, leg: t.leg, title: t.title, rawBook: e.book });
      const row = e.sides?.[Object.keys(e.sides)[t.side === 'p1' ? 0 : 1]];
      if (!row) continue;
      const mine = t.leg === 'open' ? row.openTs : row.nowTs;
      const other = t.leg === 'open' ? row.nowTs : row.openTs;
      if (!mine || !other || mine === other) continue;
      const fmt = await ev(`(function(){ return [ocsFmtTs(${JSON.stringify(mine)}), ocsFmtTs(${JSON.stringify(other)})]; })()`);
      if (fmt[0] && !t.title.includes(fmt[0]))
        wrongTs.push({ match: t.match, leg: t.leg, title: t.title, expect: fmt[0], otherLeg: fmt[1] });
      else if (fmt[1] && t.title.includes(fmt[1]) && fmt[0] !== fmt[1])
        wrongTs.push({ match: t.match, leg: t.leg, title: t.title, namedTheOtherLeg: fmt[1] });
    }
    check(`tooltip names the book of the raw row it sits over (${view})`, wrongBook.length === 0, wrongBook.slice(0, 4));
    check(`tooltip carries THAT leg's timestamp, not the other leg's (${view})`, wrongTs.length === 0, wrongTs.slice(0, 4));
  }
} finally { c.close(); }

console.log('');
if (FAIL.length) { console.log(`${FAIL.length} FAILED: ${JSON.stringify(FAIL)}`); process.exit(1); }
console.log('ALL SIX CONFIRMATIONS PASS on the deployed URL');
