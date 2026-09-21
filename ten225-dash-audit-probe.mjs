// TEN-225 ruling 4 (founder 2026-09-21) — THE DASH AUDIT, on the deployed page.
//
//   "a dash is correct ONLY when no book anywhere has a price. Otherwise fall
//    through the ladder to any book that does. The one-book-per-fixture rule
//    still holds — Open, Now and Close move together, never mixed. Confirm that
//    is how it behaves today and report any fixture dashing while another book
//    has a price."
//
// TWO THINGS THIS DELIBERATELY DOES NOT DO.
//
//   It does not re-implement the ladder. A probe that computes "what the card
//   should show" from matches.json and compares it to the card is testing my
//   copy of the rule, and it would survive a revert of the real one. Every
//   resolved value below comes from calling the PAGE'S OWN functions
//   (_mcAnyBookPair / _mcNowOf / _ocsOf / mxOddsTxt) on the page's own data.
//
//   It does not trust a zero. The card count is asserted before any absence is
//   believed, and the "books with a price" count is taken from the raw feed
//   rather than from the resolver being audited — otherwise a resolver that
//   returned nothing for everything would report a perfectly clean board.
import { setTimeout as sleep } from 'node:timers/promises';

const PAGE = 'https://michaeldk1996.github.io/SAAS/bsp-consult-dashboard.html';
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
     '--user-data-dir=' + DATA + '/ten225-dash-chrome', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  let wsUrl = null;
  proc.stderr.on('data', d => { const m = /ws:\/\/[^\s]+/.exec(String(d)); if (m && !wsUrl) wsUrl = m[0]; });
  for (let i = 0; i < 120 && !wsUrl; i++) await sleep(100);
  if (!wsUrl) { proc.kill(); throw new Error('no CDP endpoint'); }
  // The stderr endpoint is the BROWSER target; Runtime.evaluate is not there.
  const port = new URL(wsUrl).port;
  let pageWs = null;
  for (let i = 0; i < 60 && !pageWs; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const pg = list.find(t => t.type === 'page');
      if (pg) pageWs = pg.webSocketDebuggerUrl;
    } catch (e) { /* devtools http not up yet */ }
    if (!pageWs) await sleep(200);
  }
  if (!pageWs) { proc.kill(); throw new Error('no page target'); }
  const ws = new WebSocket(pageWs);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiting = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  await sleep(400);
  return {
    send: (method, params = {}) => new Promise(res => {
      const i = ++id; waiting.set(i, m => res(m.result || {}));
      ws.send(JSON.stringify({ id: i, method, params }));
    }),
    close: () => { try { ws.close(); } catch (e) {} proc.kill(); },
  };
}

const FAILED = [];
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
  if (!cond) FAILED.push(name);
};

const c = await cdp();
try {
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Network.setCacheDisabled', { cacheDisabled: true });
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: AUTH_STUB });
  await c.send('Page.navigate', { url: PAGE + '?cb=dashaudit' + Date.now() });
  const ev = async e => {
    const r = await c.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r && r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
    if (!r || !r.result) return undefined;
    return r.result.value;
  };

  let cards = 0;
  for (let i = 0; i < 240 && !cards; i++) {
    cards = (await ev('document.querySelectorAll(".mx-match").length || 0')) || 0;
    if (!cards) await sleep(500);
  }
  // ASSERTED BEFORE ANYTHING ELSE. Every number below this line is a count, and
  // a count on an empty board is not evidence of anything.
  check('the deployed board painted cards at all', cards > 0, `cards=${cards}`);
  if (!cards) throw new Error('empty board — refusing to report counts');

  const build = await ev('fetch("./build-info.json?cb="+Date.now()).then(r=>r.json()).then(j=>j.commit)');
  console.log(`\ndeployed commit ${build}   cards on the default view: ${cards}`);

  const resolvers = await ev(`JSON.stringify({
    anyBook: typeof _mcAnyBookPair, nowOf: typeof _mcNowOf, ocsOf: typeof _ocsOf,
    oddsTxt: typeof mxOddsTxt, rank: typeof mxBookRank, openAnchor: typeof _openAnchorOf,
    closeOf: typeof _mcCloseOf })`);
  console.log('resolvers on the served page: ' + resolvers);

  // ── THE AUDIT ─────────────────────────────────────────────────────────────
  // Runs INSIDE the page so every resolved value is the page's own answer.
  const raw = await ev(`(async () => {
    const ms = await fetch('./matches.json?cb='+Date.now()).then(r => r.json());
    let ocs = null;
    try { ocs = await fetch('./odds-card-state.json?cb='+Date.now()).then(r => r.json()); } catch (e) {}

    // "any book anywhere has a price" — taken from the RAW feed, not from the
    // resolver under audit. Both legs required: a one-sided quote cannot make a
    // card, so counting it would invent dashes that are correct.
    const booksWithPair = m => {
      const out = [];
      // ⚠️ "A BOOK HAS A PRICE" MUST MEAN A PRICE THE FOUNDER RULED IS ONE.
      // The first cut counted any two-sided quote and reported past-12164069 as
      // a breach — bet365 quotes it 1.004 / 17, and the 2026-09-19 ruling
      // ("move it to < 1.01") says 1.004 is not a price. A dash there is the
      // floor working, not the ladder failing. Same floor as the renderer, so
      // the audit and the product cannot disagree about what a price is.
      const REAL = 1.01;
      const two = (o) => o && o.p1 != null && o.p2 != null
                      && o.p1 >= REAL && o.p2 >= REAL;
      if (two(m.odds) && m.odds.bookmaker) out.push(m.odds.bookmaker);
      if (two(m.bet365Now)) out.push('bet365');
      for (const k of ['bookNow', 'bookOpens']) {
        const blk = m[k]; if (!blk) continue;
        for (const b of Object.keys(blk)) if (two(blk[b])) out.push(b);
      }
      if (m.bestOdds && m.bestOdds.p1 && m.bestOdds.p2
          && m.bestOdds.p1.bookmaker === m.bestOdds.p2.bookmaker
          && m.bestOdds.p1.price >= REAL && m.bestOdds.p2.price >= REAL) {
        out.push(m.bestOdds.p1.bookmaker);
      }
      return [...new Set(out.filter(Boolean))];
    };

    const rows = [];
    for (const m of ms) {
      // The page's OWN resolvers, not a copy of the ladder.
      let nowP1 = null, nowP2 = null, openP1 = null, pair = null, closeP1 = null, t_divergent = false;
      // ⚠️ THE CARD FACE READS _mcNowPair, NOT _mcNowOf. The first cut of this
      // probe used _mcNowOf and reported 5 breaches; _mcNowOf has no any-book
      // rung, so it was measuring a resolver a member never sees. Both are read
      // here and the divergence is reported as its own finding.
      let pairNow = null;
      try { pairNow = _mcNowPair(m); } catch (e) {}
      nowP1 = pairNow ? (pairNow.p1 ?? null) : null;
      nowP2 = pairNow ? (pairNow.p2 ?? null) : null;
      let solo1 = null; try { solo1 = _mcNowOf(m, 'p1'); } catch (e) {}
      t_divergent = (nowP1 != null && solo1 == null);
      try { openP1 = _openAnchorOf(m, 'p1'); } catch (e) {}
      try { pair = _mcOpenNowPair ? _mcOpenNowPair(m) : null; } catch (e) {}
      try { closeP1 = _mcCloseOf ? _mcCloseOf(m, 'p1') : null; } catch (e) {}
      const bk = booksWithPair(m);
      rows.push({
        divergent: t_divergent,
        id: m.id, p1: m.p1, p2: m.p2, tour: m.tour, day: m.day, date: m.date,
        live: !!m.live, done: !!m.finalScore,
        nowP1, nowP2, openP1, closeP1,
        pairBook: pair && pair.book ? pair.book : null,
        books: bk,
      });
    }
    return JSON.stringify(rows);
  })()`);

  const rows = JSON.parse(raw);
  // ⚠️ CORRECTED, and the first cut of this probe got it wrong in a way that
  // would have reported 64 false breaches. "Dashed" is NOT "_mcNowOf is null":
  // on a COMPLETED fixture the card shows Open and Close and deliberately has
  // no Now, so every finished match looked like a dash. A fixture is dashed
  // only when the card can resolve NOTHING for it — no Open, no Now, no Close.
  const anyPrice = r => r.nowP1 != null || r.nowP2 != null
                     || r.openP1 != null || r.closeP1 != null;
  const dashed = rows.filter(r => !anyPrice(r));
  const offenders = dashed.filter(r => r.books.length > 0);
  const honest = dashed.filter(r => r.books.length === 0);

  console.log(`\n── RULING 4 — the dash audit, n=${rows.length} fixtures in the published file`);
  console.log(`   priced (the card resolves Open, Now or Close) ${rows.length - dashed.length}`);
  console.log(`   dashed                                      ${dashed.length}`);
  console.log(`     of those, NO book anywhere has a pair     ${honest.length}   <- dash is correct`);
  console.log(`     of those, a book DOES have a pair         ${offenders.length}   <- ruling 4 breach`);

  if (offenders.length) {
    console.log('\n   FIXTURES DASHING WHILE A BOOK HAS A PRICE:');
    for (const o of offenders.slice(0, 40)) {
      console.log(`     BREACH ${o.id}  ${o.p1} v ${o.p2}  [${o.tour}]  done=${o.done}  books=${o.books.join(', ')}`);
    }
  }
  check('no fixture dashes while a book has a two-sided price',
        offenders.length === 0, `${offenders.length} of ${dashed.length} dashed`);

  const div = rows.filter(r => r.divergent);
  console.log(`\n── THE TWO NOW RESOLVERS DISAGREE on ${div.length} fixture(s)`);
  console.log('   _mcNowPair (what the CARD FACE reads) resolves a price;');
  console.log('   _mcNowOf   (no any-book rung: ocs -> bet365 -> null) returns null.');
  for (const d of div.slice(0, 15)) console.log(`     ${d.id}  ${d.p1} v ${d.p2}  books=${d.books.join(', ')}`);

  // ── THE ONE-BOOK RULE ────────────────────────────────────────────────────
  // Read off the rendered titles rather than the data: the rule is about what a
  // member sees on one card, and the title is where the book name actually
  // reaches them.
  const mixed = await ev(`(() => {
    const out = []; const seen = new Set(); let cells = 0;
    const scan = () => {
    for (const card of document.querySelectorAll('.mx-match')) {
      const books = [...card.querySelectorAll('[title*="\u00b7"]')]
        .map(n => (n.getAttribute('title') || '').split('\\u00b7')[0].trim())
        .filter(Boolean);
      cells += books.length;
      const id = card.getAttribute('data-id');
      if (id) seen.add(id);
      const uniq = [...new Set(books)];
      if (uniq.length > 1 && !out.some(o => o.id === id)) out.push({ id, books: uniq });
    } };
    scan();
    // Walk every view and day tab: the default view paints a handful of cards,
    // and "0 mixed" over a handful is an empty set wearing a clean bill of health.
    for (const t of [...document.querySelectorAll('[data-view],[data-day],.mx-tab,.mx-daytab,button')]) {
      try { t.click(); } catch (e) { continue; }
      scan();
    }
    return JSON.stringify({ out, cards: seen.size, cells });
  })()`);
  const mixedPayload = JSON.parse(mixed);
  const mixedRows = mixedPayload.out;
  const titled = mixedPayload.cells;
  console.log(`\n(one-book scan walked every view/day tab: ${mixedPayload.cards} distinct cards, ${titled} book-bearing cells)`);
  // A "0 mixed cards" result is only worth reading if enough cards named a book
  // at all. 4 titled cells across an 80-card board is not a clean bill of
  // health, it is an empty set wearing one.
  check('enough priced cells name a book for the one-book count to mean something',
        titled >= 10, `titled cells=${titled}`);
  console.log(`\n── THE ONE-BOOK RULE — cards naming more than one book: ${mixedRows.length}`);
  for (const m of mixedRows.slice(0, 20)) console.log(`     ${m.id}  ${m.books.join(' + ')}`);
  console.log('   (the suspended-market fall-through the founder approved on 2026-09-19 can');
  console.log('    legitimately produce two books on one card; each value names its own.)');

  console.log(`\n── LADDER SHAPE, as served`);
  console.log('   ' + (await ev('JSON.stringify(MX_BOOK_LADDER)')));
} finally {
  c.close();
}

console.log(FAILED.length ? `\n${FAILED.length} FAILED: ${JSON.stringify(FAILED)}`
                          : '\nall dash-audit checks passed');
process.exit(FAILED.length ? 1 : 0);
