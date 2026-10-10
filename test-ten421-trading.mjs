// TEN-421 step 13 (founder 2026-10-10): the Trading Report redesign. The SHIPPED page (trading-report.js) runs for
// real on the SHIPPED live-tab.js predicates and the dashboard's own Today's Matches / name / price / time helpers
// (sliced from bsp-consult-dashboard.html), fed a frozen copy of the live board taken on 10 Oct 2026 07:38Z
// (tools/fixtures/ten421-trading.json: matches.json, the live_snapshot ATP singles with one Interrupted match, the
// splits index meta and the slate's shards, the cards' Now pairs, build-info). The clock is frozen at the capture
// instant, so the day buckets never drift. Every check names the mutation that turns it red
// (tools/test-ten421-mutants.js). Rules: .claude/rules/trading-report.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN421_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const SRC = readFileSync(process.env.TEN421_SRC || join(HERE, 'trading-report.js'), 'utf8');
const LIVE_TAB = readFileSync(join(HERE, 'live-tab.js'), 'utf8');
const FIX = JSON.parse(readFileSync(join(HERE, 'tools/fixtures/ten421-trading.json'), 'utf8'));
const FIXED = Date.parse(FIX.capturedAt);
const TZ = 'America/New_York';   // the member zone (stennisfy.tz); not Berlin, so a raw api-tennis clock cannot pass

// A dashboard function, sliced whole (brace-matched; a one-line function is taken whole first).
function fn(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, 'function ' + name);
  const nl = html.indexOf('\n', at + 1), line = html.slice(at + 1, nl);
  if (/\}\s*$/.test(line) && (line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  let depth = 0, i = html.indexOf('{', at);
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(at + 1, i + 1);
}
const constLine = name => { const m = html.match(new RegExp('\\nconst ' + name + ' = [^\\n]*')); assert.ok(m, 'const ' + name); return m[0]; };
const constBlock = name => { const a = html.indexOf('\nconst ' + name + ' = {'); assert.ok(a >= 0, 'const ' + name); return html.slice(a, html.indexOf('\n};', a) + 3); };
const HELPERS = [constBlock('MX_BOOK_LABELS'), fn('mxBookLabel'), constLine('MC_BOOK_NAMES'), fn('mxOddsTxt'),
  fn('formIni'), fn('fhIni'), fn('newsTz'), fn('newsPlayerName'), fn('acctTzOffsetMin'), fn('cardStartMs'),
  fn('cardFmtStart'), fn('matchDayBucket'), fn('isFinishedMatch'), fn('getFiltered')].join('\n');
const TR_CSS = (() => { const a = html.indexOf('/* TEN-421 (founder step 13'); return html.slice(a, html.indexOf('/* ── TEN-107', a)); })();

const IOC = { Spain: 'ESP', Italy: 'ITA', France: 'FRA', 'United States': 'USA' };
function boot(opts = {}) {
  const fix = JSON.parse(JSON.stringify(FIX));
  if (opts.edit) opts.edit(fix);
  const store = { 'stennisfy.tz': TZ };
  const h = { click: null, input: null, doc: [] };
  const grid = { _html: '', get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; },
    addEventListener(t, f) { if (t === 'click') h.click = f; if (t === 'input') h.input = f; } };
  const document = {
    readyState: 'complete', hidden: false, activeElement: null,
    getElementById(id) { return id === 'tradingGrid' ? grid : (id === 'tradingTabBtn' ? { style: {} } : null); },
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener(t, f) { h.doc.push([t, f]); },
  };
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(FIXED); } static now() { return FIXED; } }
  const resp = (ok, body) => Promise.resolve({ ok, status: ok ? 200 : 404, json: async () => body });
  const fetch = (url) => {
    url = String(url);
    if (/live_snapshot/.test(url)) return resp(true, [{ board: { matches: fix.fixtures }, updated_at: fix.updated_at }]);
    if (/trading-splits-index\.json/.test(url)) return opts.noIndex ? resp(false, null) : resp(true, fix.index);
    const sm = url.match(/trading-splits\/(\d+)\.json/);
    if (sm) return fix.shards[sm[1]] ? resp(true, fix.shards[sm[1]]) : resp(false, null);
    if (/build-info\.json/.test(url)) return resp(true, { builtAt: fix.builtAt });
    if (/tournament-surfaces\.json/.test(url)) return resp(true, { surfaces: { 1667: 'hard' } });   // Shanghai
    return resp(false, null);
  };
  const window = { FEATURE_TRADING_REPORT: true, FEATURE_LIVE_PROXY: true, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k', __LV_SUBS: [] };
  const ctx = vm.createContext({ window, document, Date: FakeDate, Intl, fetch, console: { warn() {}, log() {}, error() {} },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem() {} },
    setTimeout: (f, ms) => (ms >= 1000 ? 0 : setTimeout(f, ms)), clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    WebSocket: function () {}, matches: fix.matches, playerProfiles: fix.profiles });
  ctx.globalThis = ctx;
  // Today's Matches board state = its defaults (Today · Upcoming · no filters · time sort).
  vm.runInContext(`var state = { day:'today', view:'upcoming', surface:'all', tournaments:new Set(), search:'', sort:'time' };
    function crossDateSearch(){ return false; }
    // The canonical event table is tested where it lives (TEN-402); here it is the one name this fixture needs.
    function sfEventName(raw){ return ({ 'ATP Shanghai':'Shanghai Masters', 'Shanghai':'Shanghai Masters' })[raw] || raw; }
    // The card's Now pair, as _mcNowPair returned it on the live board for each fixture (its ladder is tested with the card).
    const __PAIRS = ${JSON.stringify(fix.pairs)}; function _mcNowPair(m){ return __PAIRS[m.id] || null; }
    // The card book's close (the card's "last price before the off" once a match has started), as the card reads it.
    const __CLOSES = ${JSON.stringify(fix.closes || {})}; function _mcCloseOf(m, who){ return (__CLOSES[m.id] || {})[who] ?? null; }
    function ocsBookOf(m){ return (__PAIRS[m.id] || {}).book || (__CLOSES[m.id] || {}).book || null; }
    ${HELPERS}`, ctx);
  vm.runInContext(LIVE_TAB, ctx);
  vm.runInContext(SRC, ctx);
  const api = {
    ctx, fix, html: () => grid._html,
    async settle() { for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 2)); },
    click(a, v, o = {}) {
      const el = { getAttribute: n => (n === 'data-a' ? a : v) };
      const target = { closest(sel) {
        if (sel === '[data-a="funnel"]') return a === 'funnel' ? el : null;
        if (sel === '[data-stop]') return o.inMenu ? {} : null;
        if (sel.indexOf('[data-a="tier"]') === 0) return (a === 'tier' || a === 'surf' || a === 'tour') ? el : null;
        if (sel === '[data-a]') return el;
        return null;
      } };
      h.click({ target, stopPropagation() {} });
    },
    type(q) { h.input({ target: { id: 'trSearch', value: q } }); },
  };
  return api;
}
async function start(opts) { const b = boot(opts); b.ctx.window.TradingReport.setActive(true); await b.settle(); return b; }

// ── parse the rendered page ────────────────────────────────────────────────────────────────────────────────────────
function rowsOf(page) {
  const body = page.slice(page.indexOf('<div class="tr-rows">'));
  return body.split('<div class="tr-row ').slice(1).map(seg => ({
    name: (seg.match(/class="tr-name[^"]*"[^>]*>([^<]*)</) || [])[1],
    key: (seg.match(/data-a="profile" data-v="(\d+)"/) || [])[1] || null,
    cc: (seg.match(/class="tr-cc tr-caps">([^<]*)</) || [])[1],
    rank: (seg.match(/class="tr-rank">([^<]*)</) || [])[1],
    tag: (seg.match(/class="tr-tag">([^<]*)</) || [])[1] || null,
    ev: (seg.match(/class="tr-ev(?: vs)?">([^<]*)</) || [])[1],
    time: (seg.match(/class="tr-time">([^<]*)</) || [])[1] || null,
    pill: (seg.match(/class="tr-pill( live| int)?">([^<]*)</) || []).slice(1),
    rankNo: (seg.match(/class="tr-rankno">([^<]*)</) || [])[1] || null,
    price: (seg.match(/class="tr-price"[^>]*>([^<]*)</) || [])[1],
    book: (seg.match(/class="tr-book">([^<]*)</) || [])[1] || null,
    n: (seg.match(/class="tr-n"[^>]*>(?:<span[^>]*>)?([^<]*)</) || [])[1],
    ava: (seg.match(/class="tr-ava">([^<]*)</) || [])[1],
    cells: [...seg.matchAll(/<span class="tr-cell( tr-bandb)?"><span class="tr-pct( sm)?" style="color:([^"]+)">([^<]*)<\/span>(?:<span class="tr-sub" style="color:([^"]+)">([^<]*)<\/span>)?/g)]
      .map(m => ({ band: !!m[1], sm: !!m[2], color: m[3], pct: m[4], subColor: m[5] || null, sub: m[6] || null })),
  }));
}
const stat = (page, label) => { const m = page.match(new RegExp('<span class="sfh__l">' + label + '</span><span class="sfh__v([^"]*)"(?: style="color:([^"]+)")?>([^<]*)<')); return m ? { cls: m[1], color: m[2] || null, v: m[3] } : null; };
const heads = page => [...page.matchAll(/<span class="tr-hcell( on)?( tr-bandh)?( notip)?" data-a="sort" data-v="([a-z0-9]+)"><span class="tr-hlab">([^<]*)<\/span>[\s\S]*?class="tr-hfield">field ([^<]*)</g)]
  .map(m => ({ on: !!m[1], band: !!m[2], code: m[4], label: m[5], field: m[6] }));
const bands = page => [...page.matchAll(/<span class="tr-band" style="grid-column:span (\d+)"><span class="tr-caps">([^<]*)</g)].map(m => [m[2], +m[1]]);

// Independent expectations, computed from the fixture with the dashboard's own Today's Matches function.
function expectSlate(b) {
  const list = b.ctx.getFiltered();
  const under = new Set(b.fix.fixtures.filter(b.ctx.window.LiveFeed.isUnderway).map(f => [f.first_player_key, f.second_player_key].map(Number).sort((x, y) => x - y).join(':')));
  const pre = list.filter(m => !under.has([m.p1Key, m.p2Key].map(Number).sort((x, y) => x - y).join(':')));
  return { list, pre, under };
}
const nameOf = (b, key, fb) => (b.fix.profiles[key] && b.fix.profiles[key].name) || fb;
const shortRound = r => { r = String(r || ''); const i = r.lastIndexOf(' - '); return i >= 0 ? r.slice(i + 3) : r; };
function bucket(b, key, surf, win = 'tiers') {
  const t = b.fix.shards[key] && b.fix.shards[key][win]; if (!t) return null;
  // the tier with more matches on THIS surface; the all-surfaces count breaks a tie
  const ms = x => (t[x] && t[x][surf] && t[x][surf].m) || 0, ma = x => (t[x] && t[x].all && t[x].all.m) || 0;
  const tier = ms('tour') !== ms('chal') ? (ms('tour') > ms('chal') ? 'tour' : 'chal') : (ma('tour') >= ma('chal') ? 'tour' : 'chal');
  return (t[tier] && t[tier][surf]) || null;
}

// ── tests ──────────────────────────────────────────────────────────────────────────────────────────────────────────
test('Data 2: the Pre-match slate is Today\'s Matches → Upcoming (same set, same order, same count), minus what Live shows in play', async () => {
  // matches.json built before midnight still says day 'tomorrow' for a match the board files under Today (it buckets by date)
  const b = await start({ edit: fix => { fix.matches.filter(m => m.date === '2026-10-10' && !m.live)[1].day = 'tomorrow'; } });
  const { list, pre, under } = expectSlate(b);
  assert.ok(pre.length >= 5 && under.size >= 3, 'fixture guard: a slate, with matches in play on the Live feed');
  const page = b.html(), rows = rowsOf(page);
  const want = pre.flatMap(m => [nameOf(b, String(m.p1Key), m.p1), nameOf(b, String(m.p2Key), m.p2)]);
  assert.deepEqual(rows.map(r => r.name), want, 'rows = the board\'s Upcoming matches in its m.time order, both players');   // mutant: slate-day-field, slate-order, slate-keeps-live
  assert.equal(stat(page, 'Today').v, String(pre.length), 'R2: header Today = the pre-match matches (no overlap with Live)');
  // first player of each match carries the time + PRE pill; the time is the card's (cardFmtStart, member zone)
  const firsts = rows.filter(r => r.time);
  assert.equal(firsts.length, pre.length);
  assert.deepEqual(firsts.map(r => r.time), pre.map(m => b.ctx.cardFmtStart(m, false)), 'row time = the card time');       // mutant: time-raw
  assert.ok(firsts.every(r => r.pill[1] === 'PRE' && !r.pill[0]), 'pre-match pill = PRE on the inner tone');
  assert.notEqual(firsts[0].time, pre[0].time, 'guard: the member zone differs from the api-tennis clock');
});

test('Data 2: a match flips to LIVE when the Live feed shows it in play, before matches.json does', async () => {
  // The first Upcoming match goes underway on the feed; matches.json has not caught up (live still false).
  let m0;
  const b = await start({ edit: fix => {
    m0 = fix.matches.filter(m => m.date === '2026-10-10' && !m.live && !m.finalScore).sort((x, y) => String(x.time).localeCompare(String(y.time)))[0];
    fix.fixtures.push({ event_key: 99, event_date: m0.date, event_time: m0.time, event_first_player: m0.p1, event_second_player: m0.p2,
      first_player_key: m0.p1Key, second_player_key: m0.p2Key, event_status: 'Set 1', event_live: '1', event_winner: null,
      event_type_type: 'Atp Singles', tournament_name: 'Shanghai', tournament_key: 1, tournament_round: 'ATP Shanghai - 1/16-finals' });
  } });
  const page = b.html(), rows = rowsOf(page), { list, pre } = expectSlate(b);
  assert.ok(list.some(m => m.id === m0.id) && !pre.some(m => m.id === m0.id), 'guard: still on the board, in play on the feed');
  assert.ok(!rows.some(r => r.name === nameOf(b, String(m0.p1Key), m0.p1)), 'it leaves the Pre-match rows');                // mutant: slate-keeps-live
  assert.equal(stat(page, 'Today').v, String(list.length - 1), 'R2: Today drops it (it is a Live match now), so Today + Live never double-count');  // mutant: today-count-board
  assert.equal(stat(page, 'Live').v, '4', 'and counts In play');
  b.click('view', 'live'); await b.settle();
  assert.ok(rowsOf(b.html()).some(r => r.name === nameOf(b, String(m0.p1Key), m0.p1) && r.price !== undefined), 'it is a Live row');
});

test('Data 2 + header: Live = the Live page grid (Interrupted counts as live, amber); header Live = In play (rail badge)', async () => {
  const b = await start();
  b.click('view', 'live'); await b.settle();
  const page = b.html(), rows = rowsOf(page);
  const LF = b.ctx.window.LiveFeed;
  const grid = b.fix.fixtures.filter(LF.isAtpSingles).filter(LF.isUnderway).sort((x, y) => String(x.event_time).localeCompare(String(y.event_time)));
  const intr = grid.filter(LF.isInterrupted);
  assert.ok(grid.length === 4 && intr.length === 1, 'fixture guard: 4 underway, 1 interrupted');
  assert.deepEqual(rows.map(r => r.name), grid.flatMap(f => [nameOf(b, String(f.first_player_key), f.event_first_player), nameOf(b, String(f.second_player_key), f.event_second_player)]));
  assert.equal(stat(page, 'Live').v, String(grid.length - intr.length), 'header Live = In play (interrupted excluded)');  // mutant: live-counts-interrupted
  const pills = rows.filter(r => r.time).map(r => r.pill.join('|'));
  assert.equal(pills.filter(p => p === ' int|INT').length, 1, 'the interrupted match carries the amber INT pill');        // mutant: no-interrupted-pill
  assert.equal(pills.filter(p => p === ' live|LIVE').length, 3, 'the others read LIVE on the selected tone');
  assert.match(TR_CSS, /\.tr-pill\.int\{ color:var\(--amber\)/, 'Interrupted = amber, as on Live');
  // Live rows carry real figures: surface from the fixture's tournament (absent from matches.json), own tier and n
  const f0 = grid[0], k0 = String(f0.first_player_key), bk = bucket(b, k0, 'hard');
  assert.ok(bk && bk.spw, 'fixture guard: the live player has a hard bucket');
  assert.equal(rows[0].n, String(bk.m), 'live n from the hard bucket');                                                 // mutant: live-surface-dash
  assert.equal(rows[0].cells[1].sub, bk.spw[0] + '/' + bk.spw[1], 'live SPW from the shard');
  assert.match(TR_CSS, /\.tr-pill\.live\{ color:var\(--text\); background:var\(--selected\); \}/, 'LIVE = white on --selected, no edge');
});

test('Tomorrow: Live disabled, header Live 0, day switch resets Surface and the sort; empty slate says so', async () => {
  const b = await start();
  b.click('surf', 'hard'); b.click('sort', 'spw'); b.click('day', 'tomorrow'); await b.settle();
  const page = b.html();
  assert.match(page, /<span class="tr-segi dis" aria-disabled="true">Live<\/span>/, 'Live is disabled on Tomorrow');           // mutant: tomorrow-live-enabled
  assert.equal(stat(page, 'Tomorrow').v, String(b.ctx.getFiltered.call(null) && b.fix.matches.filter(m => b.ctx.matchDayBucket(m) === 'tomorrow' && !b.ctx.isFinishedMatch(m)).length));
  assert.equal(stat(page, 'Live').v, '0', 'Tomorrow has nothing in play');                                                 // mutant: tomorrow-live-count
  assert.match(page, /All surfaces<\/span><svg class="tr-chev"/, 'Surface reset to All surfaces');
  assert.match(page, /No ATP singles scheduled tomorrow yet\./);
});

test('Data 3: names = the shared formatter, country = 3-letter code (— unknown), event = canonical name + round words', async () => {
  const b = await start({ edit: fix => {   // a profile spelled differently from the card (as Y. Bu / B. Yunchaokete once was)
    const m = fix.matches.find(x => x.date === '2026-10-10' && !x.live); fix.profiles[String(m.p1Key)] = { name: 'Profile Spelling' };
  } });
  const { pre } = expectSlate(b);
  const rows = rowsOf(b.html());
  pre.forEach((m, i) => {
    [[m.p1Key, m.p1, m.p1Rank], [m.p2Key, m.p2, m.p2Rank]].forEach(([k, fb, rk], j) => {
      const r = rows[i * 2 + j];
      assert.equal(r.name, nameOf(b, String(k), fb));                                                                    // mutant: name-raw
      const c = (b.fix.index.meta[String(k)] || {}).country;
      assert.equal(r.cc, (c && b.ctx.window.SfCountryIoc.of(c)) || '—');
      assert.equal(r.rank, rk != null ? '#' + rk : '—');
      assert.equal(r.ev, 'Shanghai Masters', 'event = sfEventName only, no feed round (R1)');                                   // mutant: event-raw, event-round
    });
  });
  assert.ok(rows.some(r => r.name === 'Profile Spelling'), 'the profile spelling wins over the card');
});

test('Data 4 (override): initials avatars, no photos', async () => {
  const b = await start();
  const page = b.html(), rows = rowsOf(page);
  assert.ok(!/<img/.test(page), 'no <img> on the page');                                                                    // mutant: photo-back
  assert.ok(!/randomuser|photoCandidatesFor|resolveProfilePhotoUrl/.test(SRC), 'no photo resolver');
  rows.forEach(r => assert.equal(r.ava, b.ctx.fhIni(r.name), 'initials = fhIni(name)'));
  assert.match(TR_CSS, /\.tr-ava\{[^}]*background:var\(--inner\); border:1px solid var\(--edge-10\)/);
});

test('Data 5: price + book = the player\'s Today\'s Matches card (its Now pair, the card\'s book name, 2 dp; — without)', async () => {
  const b = await start();
  const { pre } = expectSlate(b);
  const rows = rowsOf(b.html());
  let priced = 0, dashed = 0;
  pre.forEach((m, i) => ['p1', 'p2'].forEach((w, j) => {
    const r = rows[i * 2 + j], pair = b.fix.pairs[m.id];
    if (pair && pair[w] != null) {
      priced++;
      assert.equal(r.price, Number(pair[w]).toFixed(2));                                                                // mutant: price-other
      assert.equal(r.book, vm.runInContext('MC_BOOK_NAMES', b.ctx)[String(pair.book).toLowerCase()] || b.ctx.mxBookLabel(pair.book));      // mutant: book-raw
    } else { dashed++; assert.equal(r.price, '—'); }
  }));
  assert.ok(priced >= 10, 'fixture guard: priced rows exist');
  assert.ok(rows.some(r => r.book === 'Bet105'), 'the cards\' book today is Bet105 (MC_BOOK_NAMES casing)');
});

test('R3: the price = the card face — a started match whose book went quiet shows — like its card; live rows take today\'s card only', async () => {
  let ma;
  const b = await start({ edit: fix => {
    ma = fix.matches.filter(m => m.date === '2026-10-10' && !m.live && !m.finalScore && fix.pairs[m.id])[0];
    ma.time = '08:00'; delete fix.pairs[ma.id];                                    // 08:00 Berlin = 06:00Z, before the 07:38Z capture: started, book quiet
    fix.closes = { [ma.id]: { p1: 2.29, p2: 1.676, book: 'bet105' } };           // a close exists, but the card face does not print it
  } });
  const ra = rowsOf(b.html()).find(r => r.key === String(ma.p1Key));
  assert.equal(ra.price, '—', 'card face prints — without a Now, so the column does too');                           // mutant: close-fallback-back
  assert.ok(!/Closing price/.test(b.html()));
  // a live fixture whose card exists takes the card's start time; one whose only card is another day's takes the feed's
  const b2 = await start({ edit: fix => {
    const m0 = fix.matches.find(m => m.date === '2026-10-10' && !m.live && !m.finalScore);
    const old = fix.matches.find(m => m.date === '2026-10-08' && m.p1Key && m.p2Key);
    const fx = (m, ek, t) => ({ event_key: ek, event_date: '2026-10-10', event_time: t, event_first_player: m.p1, event_second_player: m.p2,
      first_player_key: m.p1Key, second_player_key: m.p2Key, event_status: 'Set 1', event_live: '1', event_winner: null,
      event_type_type: 'Atp Singles', tournament_name: 'Shanghai', tournament_key: 1, tournament_round: 'ATP Shanghai - 1/16-finals' });
    fix.fixtures.push(fx(m0, 98, '23:55'), fx(old, 97, '23:50'));
    fix.__m0 = m0; fix.__old = old;
  } });
  b2.click('view', 'live'); await b2.settle();
  const lrs = rowsOf(b2.html());
  const lr = lrs.find(r => r.time && r.key === String(b2.fix.__m0.p1Key));
  assert.equal(lr.time, b2.ctx.cardFmtStart(b2.fix.__m0, false), 'live row time = today\'s card time');            // mutant: live-time-feed
  const lo = lrs.find(r => r.time && r.key === String(b2.fix.__old.p1Key));
  assert.equal(lo.time, b2.ctx.cardFmtStart({ date: '2026-10-10', time: '23:50' }, false), 'another day\'s card lends nothing: feed time');  // mutant: other-day-card
  assert.equal(lo.price, '—', 'and no price from another day\'s card');
});

test('Data 6: Updated = the split build (build-info builtAt) in the member zone; — when the splits did not load', async () => {
  const b = await start();
  const want = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(b.fix.builtAt));
  const u = stat(b.html(), 'Updated');
  assert.equal(u.v, want, 'Updated = builtAt HH:MM, stennisfy.tz');                                                         // mutant: updated-clock
  assert.match(u.cls, /sfh__v--soft/);
  const n = await start({ noIndex: true });
  assert.equal(stat(n.html(), 'Updated').v, '—', 'no index → —');                                                          // mutant: updated-without-index
});

test('Header: shared 35b component, title "Trading Report", one sentence, Today · Live · Window · Updated', async () => {
  const b = await start();
  const page = b.html();
  assert.match(page, /<div class="sfh tr-hdr"><div class="sfh__text"><h1 class="sfh__title">Trading Report<\/h1><p class="sfh__sub">One row per player on today’s ATP singles, with situational splits for the live read\. <span class="sfh__tail">Rows flip to LIVE as play starts\.<\/span><\/p><\/div>/);
  assert.deepEqual([...page.matchAll(/<span class="sfh__l">([^<]*)</g)].map(m => m[1]), ['Today', 'Live', 'Window', 'Updated']);
  assert.equal(stat(page, 'Window').v, '24m');
  assert.match(page, /<span class="tr-segi" data-a="win" data-v="52w">52 weeks<\/span><span class="tr-segi on" data-a="win" data-v="24m">24 months<\/span>/, 'reference order, 24 months selected');  // mutant: window-order
  b.click('win', '52w'); await b.settle();
  assert.equal(stat(b.html(), 'Window').v, '52w');
});

test('Columns: the seven tabs, groups, labels and highlights as in the design file (TAB_GROUPS, HIGHLIGHT)', async () => {
  const b = await start();
  const WANT = {
    key: [[['On serve', 3], ['On return', 3]], ['sh', 'spw', 'bps', 'rpw', 'bpw', 'oph'], []],
    laysetwinner: [[['After losing set 1', 3], ['After winning set 1', 3], ['All matches', 1]], ['ls1ws2', 'ls1b1s2', 'ls1o1s2', 'ws1w2', 'ws1wm', 'ws1b1s2', 'bpw'], ['ls1ws2', 'ws1w2']],
    scalping: [[['On serve', 3], ['Serving under pressure', 2]], ['sh', 'spw', 'bps', 'htws', 'htss'], ['bps', 'htws', 'htss']],
    laybreakup: [[['After breaking', 2], ['After being broken', 1], ['Start of set / match', 2]], ['babb', 'bbk', 'bbkb', 'gfb', 'bfsg'], ['babb', 'bbk']],
    settrading20: [[['All matches', 3], ['After winning set 1', 1], ['After losing set 1', 1]], ['wfs', 'ws2', 'gfb', 'ws1w2', 'ls1ws2'], ['ws1w2']],
    layserve: [[['Serving under pressure', 2], ['Start of set / match', 1], ['Break points', 2]], ['htws', 'htss', 'bofs', 'bps', 'bpw'], ['htws', 'bofs']],
    laysetbreak: [[['After losing set 1', 2], ['After winning set 1', 1], ['After breaking', 2], ['After being broken', 1]], ['ls1o1s2', 'ls1ws2', 'ws1w2', 'babb', 'bbk', 'bbkb'], ['ls1o1s2', 'ls1ws2', 'babb', 'ws1w2']],
  };
  const tabs = [...b.html().matchAll(/data-a="tab" data-v="([a-z0-9]+)">([^<]*)</g)].map(m => m[2]);
  assert.deepEqual(tabs, ['Key Stats', 'Lay Set Winner', 'Scalping', 'Lay Break Up', 'Set Trading 2–0', 'Lay Serve Set/Match', 'Lay Set &amp; Break']);  // mutant: tab-copy (HTML-escaped)
  for (const [tab, [bd, cols, hl]] of Object.entries(WANT)) {
    b.click('tab', tab); await b.settle();
    const page = b.html(), hs = heads(page);
    assert.deepEqual(bands(page), bd, tab + ' group bands');
    assert.deepEqual(hs.map(x => x.code), cols, tab + ' columns');                                                         // mutant: lsw-order
    assert.deepEqual(hs.filter(x => x.band).map(x => x.code).sort(), hl.slice().sort(), tab + ' highlighted');
    assert.match(page, new RegExp('<div class="tr-page" style="--tr-n:' + cols.length + '">'));
    rowsOf(page).forEach(r => { assert.equal(r.cells.length, cols.length); assert.deepEqual(r.cells.map(c => c.band), cols.map(c => hl.includes(c))); });
  }
  assert.match(TR_CSS, /\.tr-bandh::before,\[data-page="trading"\] \.tr-bandb::before\{[^}]*background:var\(--wash-5\)/, 'highlight = white 5% wash');
});

test('Splits: own surface, tier, n, the 52-week tree; Broke / Broken 1st S2 over every lost-set-1 match (R1: not a mirror pair)', async () => {
  const b = await start();
  b.click('tab', 'laysetwinner'); await b.settle();
  const { pre } = expectSlate(b);
  const rows = rowsOf(b.html());
  let checked = 0, gaps = 0;
  pre.forEach((m, i) => [m.p1Key, m.p2Key].forEach((k, j) => {
    const r = rows[i * 2 + j], bk = bucket(b, String(k), String(m.surface).toLowerCase());
    if (!bk) { assert.equal(r.n, '—'); return; }
    assert.equal(r.n, String(bk.m), 'n = matches in the window on this surface, primary tier');                              // mutant: n-all-bucket
    const b1 = bk.ls1b1s2, o1 = bk.ls1o1s2, ws = bk.ls1ws2;
    if (b1 && b1[1] >= 10) {
      checked++;
      assert.equal(r.cells[1].sub, b1[0] + '/' + b1[1], 'Broke 1st S2 = ls1b1s2');                                          // mutant: broke-col-old
      assert.equal(r.cells[2].sub, o1[0] + '/' + o1[1], 'Broken 1st S2 = ls1o1s2');                                         // mutant: broken-col-mirror
      assert.equal(b1[1], o1[1], 'one denominator: every lost-set-1 match with set 2 played');
      assert.ok(b1[0] + o1[0] <= b1[1] && ws[1] >= b1[1], 'a set 2 with no break counts in neither');
      if (b1[0] + o1[0] < b1[1]) gaps++;
    }
    const w1 = bk.ws1b1s2;
    if (w1 && w1[1] >= 10) {
      assert.equal(r.cells[5].sub, w1[0] + '/' + w1[1], 'after winning set 1: Broke 1st S2 = ws1b1s2 (every won-set-1 match)');  // mutant: card bafab40e
      assert.ok(bk.ws1w2 && bk.ws1w2[1] >= w1[1], 'same population as Won set 2 (less matches the pbp log misses)');
    }
  }));
  assert.ok(checked >= 6, 'fixture guard: real lost-set-1 cells');
  assert.ok(gaps >= 3, 'the two columns do not add to 100 (sets with no break)');
  assert.match(SRC, /var INVERTED = \{ oph: 1, bfsg: 1, babb: 1, bbk: 1, ls1o1s2: 1 \};/);
  // 52 weeks reads its own tree
  b.click('tab', 'key'); b.click('win', '52w'); await b.settle();
  const r52 = rowsOf(b.html()), m0 = pre[0], b52 = bucket(b, String(m0.p1Key), String(m0.surface).toLowerCase(), 'tiers52w');
  assert.equal(r52[0].n, b52 ? String(b52.m) : '—', '52w n from tiers52w');                                                // mutant: 52w-from-24m
  const tag = rows.find(r => r.tag); assert.ok(tag && /^(TOUR|CHAL)$/.test(tag.tag), 'one tag: the tier the row reads');
});

test('Cell rules (keep as built) and the field tiers, ±3 pts against the pooled field average', async () => {
  const b = await start({ edit: fix => {
    const k = String(fix.matches.find(m => m.date === '2026-10-10' && !m.live && m.p1Key && fix.shards[String(m.p1Key)]).p1Key);
    const s = fix.shards[k].tiers; const tier = Object.keys(s).find(t => s[t].hard) || 'tour';
    s[tier] = { all: { m: 400 }, hard: { m: 40, sh: [3, 4], spw: [6, 8], bps: [0, 0], rpw: [90, 100] } };
    fix.__k = k;
  } });
  const page = b.html(), rows = rowsOf(page), r = rows.find(x => x.key === b.fix.__k);
  assert.ok(r, 'the edited player renders');
  const [sh, spw, bps, rpw] = r.cells;
  assert.deepEqual([sh.pct, sh.sm, sh.sub], ['3/4', true, null], 'total < 5 → won/total, small grey, no %');               // mutant: under5
  assert.deepEqual([spw.pct, spw.sm, spw.sub], ['75%', true, '6/8 · small n'], 'total < 10 → % small grey + small n');     // mutant: under10
  assert.equal(bps.pct, '—', 'total 0 → —');
  assert.equal(r.cells[5].pct, '—', 'absent → —');
  // ≥ 10: tier colour against the pooled field average of the column
  const hs = heads(page), fieldRpw = hs.find(x => x.code === 'rpw').field;
  // R2: the field is pooled over the WHOLE day (pre-match + live), the same in both views
  const fracs = pg => rowsOf(pg).map(x => x.cells[3]).map(c => c.sub ? c.sub.replace(' · small n', '') : (c.sm && c.pct.includes('/') ? c.pct : null)).filter(Boolean).map(t => t.split('/').map(Number));
  b.click('view', 'live'); await b.settle();
  const livePage = b.html();
  const tot = [...fracs(page), ...fracs(livePage)].reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]);
  assert.equal(fieldRpw, Math.round(tot[0] / tot[1] * 100) + '%', 'field = pooled won / pooled total over the whole day');   // mutant: field-mean, field-view-only
  assert.deepEqual(heads(livePage).map(h => h.field), hs.map(h => h.field), 'R2: the field does not change with Pre-match / Live');
  b.click('view', 'today'); await b.settle();
  assert.equal(rpw.pct, '90%'); assert.equal(rpw.color, 'var(--pos)', '90% vs a ~37% field → green');                       // mutant: tier-colour
  // R1: the tier is the PRINTED gap — every coloured cell agrees with its printed % against the printed field
  for (const x of rowsOf(page)) x.cells.forEach((c, i) => {
    if (c.sm || !c.sub || c.color === 'var(--text-label)' || /small/.test(c.sub)) return;
    const h = hs[i]; if (!h || h.field === '—') return;
    let gap = parseInt(c.pct, 10) - parseInt(h.field, 10); if (h.code === 'oph') gap = -gap;
    const want = gap >= 4 ? 'var(--pos)' : gap <= -4 ? 'var(--neg)' : 'var(--amber)';
    assert.equal(c.color, want, `${x.name} ${h.code} ${c.pct} vs field ${h.field}`);                                       // mutant: tier-raw-gap
  });
  assert.ok(rows.some(x => x.cells.some(c => c.color === 'var(--amber)')) && rows.some(x => x.cells.some(c => c.color === 'var(--neg)')));
});

test('R2: for every column, in both views, the filter-menu counts equal the number of cells of each colour', async () => {
  const b = await start({ edit: fix => {   // one pre-match player under 10 matches with a full cell: greyed, so untiered
    const k = String(fix.matches.find(m => m.date === '2026-10-10' && !m.live && m.p2Key && fix.shards[String(m.p2Key)]).p2Key);
    const s = fix.shards[k].tiers; const tier = Object.keys(s).find(t => s[t].hard) || 'tour';
    s[tier] = { all: { m: 400 }, hard: { m: 6, sh: [90, 100], spw: [70, 100], bps: [60, 100], rpw: [40, 100], bpw: [45, 100], oph: [70, 100] } };
    fix.__k = k;
  } });
  let checked = 0, dimSeen = false;
  for (const view of ['today', 'live']) {
    b.click('view', view); await b.settle();
    const codes = heads(b.html()).map(h => h.code);
    for (let i = 0; i < codes.length; i++) {
      b.click('funnel', codes[i]); await b.settle();
      const page = b.html();
      const counts = [...page.matchAll(/<span class="tr-mcount">(\d+)</g)].map(m => +m[1]);
      const col = { 'var(--pos)': 0, 'var(--amber)': 0, 'var(--neg)': 0 };
      rowsOf(page).forEach(r => { const c = r.cells[i]; if (c && col[c.color] != null && !c.sm) col[c.color]++; if (r.key === b.fix.__k && c && c.color === 'var(--text-label)' && !c.sm && c.pct !== '—') dimSeen = true; });
      assert.deepEqual(counts, [col['var(--pos)'], col['var(--amber)'], col['var(--neg)']], `${view} ${codes[i]}: menu counts = cell colours`);  // mutant: dim-tiered
      checked++;
      b.click('funnel', codes[i]); await b.settle();
    }
  }
  assert.ok(checked >= 12 && dimSeen, 'guard: both views checked, and a greyed n < 10 player is on the page');
  // …and with a search active: the counts follow the rows on screen
  b.click('view', 'today'); await b.settle();
  const one = rowsOf(b.html())[0].name; b.type(one); await b.settle();
  b.click('funnel', 'sh'); await b.settle();
  const pg = b.html(), cs = [...pg.matchAll(/<span class="tr-mcount">(\d+)</g)].map(m => +m[1]);
  const colS = { 'var(--pos)': 0, 'var(--amber)': 0, 'var(--neg)': 0 };
  rowsOf(pg).forEach(r => { const c = r.cells[0]; if (c && colS[c.color] != null && !c.sm) colS[c.color]++; });
  assert.deepEqual(cs, [colS['var(--pos)'], colS['var(--amber)'], colS['var(--neg)']], 'search on: menu counts = the cells on screen');  // mutant: counts-before-search
  assert.ok(rowsOf(pg).length <= 2, 'guard: the search narrowed the rows');
});

test('R2 review: a Surface that exists only in the other view empties this one with the filters message + Clear', async () => {
  const b = await start({ edit: fix => { fix.matches.forEach(m => { if (m.date === '2026-10-10') m.surface = 'clay'; }); } });   // pre-match on clay, live (tournament map) on hard
  b.click('surf', 'hard'); await b.settle();
  const page = b.html();
  assert.equal(rowsOf(page).length, 0);
  assert.match(page, /No players match these filters\.<\/span><span class="tr-caps tr-link" data-a="clearall">Clear<\/span>/, 'not "No ATP singles left to play today"');  // mutant: empty-state-pool
  b.click('clearall'); await b.settle();
  assert.ok(rowsOf(b.html()).length > 0, 'Clear brings the rows back');
});

test('Behaviour (keep as built): sort cycle → ranked view with "v Opponent"; tab resets sort; filters per tab; search', async () => {
  const b = await start({ edit: fix => {   // one player without a shard: untiered on every column
    const m = fix.matches.find(x => x.date === '2026-10-10' && !x.live); delete fix.shards[String(m.p2Key)];
  } });
  b.click('sort', 'spw'); await b.settle();
  let rows = rowsOf(b.html());
  assert.ok(rows.every((r, i) => r.rankNo === String(i + 1)), 'ranked view numbers the rows');
  assert.ok(rows.every(r => /^v /.test(r.ev)), 'line 2 = v Opponent');                                                     // mutant: no-vs
  const rates = rows.map(r => r.cells[1].sub).filter(s => s && !/small/.test(s)).map(s => { const [a, c] = s.split('/').map(Number); return a / c; });
  assert.deepEqual(rates, rates.slice().sort((x, y) => y - x), 'best first');
  b.click('sort', 'spw'); await b.settle();
  const worst = rowsOf(b.html()).map(r => r.cells[1].sub).filter(s => s && !/small/.test(s)).map(s => { const [a, c] = s.split('/').map(Number); return a / c; });
  assert.deepEqual(worst, worst.slice().sort((x, y) => x - y), 'then worst first');
  b.click('sort', 'spw'); await b.settle();
  assert.ok(rowsOf(b.html())[0].time, 'third click → back to match pairs');
  b.click('sort', 'spw'); b.click('tab', 'scalping'); await b.settle();
  assert.ok(rowsOf(b.html())[0].time, 'switching tab resets the sort');
  // filters: the funnel's counts, then unchecking a tier hides those players and shows the notice
  b.click('tab', 'key'); b.click('funnel', 'spw'); await b.settle();
  const counts = [...b.html().matchAll(/<span class="tr-mlabel">([^<]*)<\/span><span class="tr-mcount">(\d+)</g)].map(m => [m[1], +m[2]]);
  assert.deepEqual(counts.map(c => c[0]), ['Above field', 'Within 3 pts', 'Below field']);
  b.click('tier', 'spw|below', { inMenu: true }); await b.settle();
  const total = rowsOf(b.html()).length, pool = expectSlate(b).pre.length * 2;
  assert.match(b.html(), new RegExp('Filtered · ' + (counts[0][1] + counts[1][1]) + ' of ' + pool + ' players'));            // mutant: filter-untiered-passes
  assert.equal(total, counts[0][1] + counts[1][1]);
  b.click('tab', 'scalping'); await b.settle();
  assert.ok(!/Filtered ·/.test(b.html()), 'filters are held per tab');
  b.click('tab', 'key'); b.type('ZZZ'); await b.settle();
  assert.match(b.html(), /No players match these filters\.<\/span><span class="tr-caps tr-link" data-a="clearall">Clear<\/span>/);
  b.click('clearall'); await b.settle();
  const first = rowsOf(b.html())[0].name; b.type(first.slice(-4).toUpperCase()); await b.settle();
  assert.ok(rowsOf(b.html()).length >= 1 && rowsOf(b.html()).every(r => r.name.toLowerCase().includes(first.slice(-4).toLowerCase())), 'search = case-insensitive substring');
});

test('Data 3: the Tournament drop-down lists the slate\'s events after "All tournaments" and filters the rows', async () => {
  const b = await start();
  b.click('tourtoggle'); await b.settle();
  const opts = [...b.html().matchAll(/class="tr-opt( sel)?" data-a="tour" data-v="([^"]*)"><span>([^<]*)</g)].map(m => m[3]);
  assert.deepEqual(opts, ['All tournaments', 'Shanghai Masters']);
  b.click('tour', 'Shanghai Masters'); await b.settle();
  assert.equal(rowsOf(b.html()).length, expectSlate(b).pre.length * 2);
  b.click('tour', 'Nowhere Open'); await b.settle();
  assert.equal(rowsOf(b.html()).length, expectSlate(b).pre.length * 2, 'an event not on the slate falls back to All');
  b.click('surftoggle'); await b.settle();
  assert.ok(!/tr-dot6/.test(b.html().slice(b.html().indexOf('tr-ctl'), b.html().indexOf('tr-ctl-tabs'))), 'Surface is text only (override)');  // mutant: surface-dot
});

test('Data 1 + copy: no placeholder data or wording; footnote names the field pool', async () => {
  const b = await start();
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/placeholder data|Placeholder/i.test(code.replace(/placeholder="Search player"/, '')), 'no placeholder wording');  // mutant: placeholder-footnote
  assert.ok(!/N52|ZERO_52|UNWIRED_52|seeded\(/.test(code), 'no 52-week overrides or seeded figures');
  const foot = (b.html().match(/<div class="tr-foot">([^<]*)</) || [])[1];
  assert.equal(foot, 'Splits cover the trailing 24 months on the surface of each player’s match. Figures are coloured against the field average for the column: green clearly above, amber within 3 points, red clearly below, inverted where lower is better. The field is every player on the selected day, pre-match and live (after Surface and Tournament, before Pre-match / Live, search and column filters), pooled over the same window. Click a column to rank the slate on it.');
});

test('Colour: no blue fills / rings / outlines; --link only on Clear; amber only on the tier and Interrupted; no surface colours', () => {
  assert.ok(!/--bar\b|--bar-2|--viz-hard|--viz-clay|--viz-grass|--hot-dot|--open-card/.test(TR_CSS + SRC), 'no blue or surface tokens');  // mutant: blue-funnel
  assert.deepEqual([...TR_CSS.matchAll(/([^\n{}]*)\{[^}]*var\(--link\)/g)].map(m => m[1].trim()), ['[data-page="trading"] .tr-link'], '--link only on links');
  assert.deepEqual([...TR_CSS.matchAll(/([^\n{}]*)\{[^}]*var\(--amber\)/g)].map(m => m[1].trim()), ['[data-page="trading"] .tr-pill.int'], 'amber in CSS = Interrupted only');
  assert.deepEqual([...SRC.matchAll(/var\(--amber\)/g)].length, 1, 'amber in JS = the within-3-pts tier only');
  assert.ok(!/outline:\s*[^n0]/.test(TR_CSS) && /\.tr-search input\{[^}]*outline:none/.test(TR_CSS), 'no focus ring');
  for (const card of ['.tr-ctl{', '.tr-head{', '.tr-rows{']) {
    const rule = TR_CSS.slice(TR_CSS.indexOf(card)); const body = rule.slice(0, rule.indexOf('}'));
    assert.match(body, /background:var\(--card\); box-shadow:var\(--top-light\)[^}]*border-radius:16px/, card + ' = card tone, no outline, radius 16');  // mutant: card-outline
    assert.ok(!/border:1px/.test(body), card + ' has no edge');
  }
});
