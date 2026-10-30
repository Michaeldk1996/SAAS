// TEN-427 step 14 (founder 2026-10-10), Part A · Series. The SHIPPED page (series.js) runs for real on the dashboard's
// own Today's Matches / name / time helpers (sliced from bsp-consult-dashboard.html), fed a frozen copy of the live
// inputs taken on 10 Oct 2026 14:52Z (tools/fixtures/ten427-series.json: series.json, the Today's Matches board, the
// profile names, the canonical event names, and the answer of the site's one Database price join — the real
// trDbJoinPx over DatabaseTab.priceRows() — for every streak row). The clock is frozen at the capture instant and the
// process runs in Europe/Brussels, so the day buckets never drift. The generator half executes build-series.js's own
// recordFor / loadStyleMap. Every check names the mutation that turns it red (tools/test-ten427-series-mutants.js).
// Rules: .claude/rules/series.md.
process.env.TZ = 'Europe/Brussels';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { isDeepStrictEqual } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const html = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const SRC = readFileSync(process.env.TEN427S_SRC || join(HERE, 'series.js'), 'utf8');
const CSS = readFileSync(process.env.TEN427S_CSS || join(HERE, 'series.css'), 'utf8');
const ENGINE = process.env.TEN427S_ENGINE || join(HERE, 'build-series.js');
const FIX = JSON.parse(readFileSync(join(HERE, 'tools/fixtures/ten427-series.json'), 'utf8'));
const FIXED = Date.parse(FIX.capturedAt);
const TZ = 'America/New_York';   // the member zone (stennisfy.tz): not Berlin and not the process zone

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
const HELPERS = [fn('formIni'), fn('fhIni'), fn('newsTz'), fn('newsPlayerName'), fn('acctTzOffsetMin'), fn('cardStartMs'),
  fn('cardFmtStart'), fn('localDayKey'), fn('apiStartMs'), fn('mxShiftDayKey'), fn('mxTodayKey'), fn('matchLocalDayKey'), fn('matchDayBucket'), fn('isFinishedMatch'), fn('trDbEnd'), fn('trDayWords'), fn('trPxAfterTitle'),
  fn('trPxAfterOf')].join('\n');

// A grid element that records the page's own listeners, so a test clicks exactly what a member clicks.
// opts.nextPx: the Next line box width in px, text measured at opts.charPx per character (a deterministic layout model
// for the page's measure-based fit: scrollWidth = the line's current text × charPx, clientWidth = nextPx).
function fakeRoot(opts = {}) {
  const root = {
    _html: '', h: { seg: {}, tab: {}, toggle: null, box: null, clear: null, click: null },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; this.h.seg = {}; this.h.tab = {}; this.h.toggle = null; this.h.clear = null; },
    querySelectorAll(sel) {
      if (sel === '.sr-seg') return [...this._html.matchAll(/data-seg="(\w+)"/g)].map(m => ({ getAttribute: () => m[1], addEventListener: (t, f) => { root.h.seg[m[1]] = f; } }));
      if (sel === '.sr-tab') return [...this._html.matchAll(/data-type="([\w-]+)"/g)].map(m => ({ getAttribute: () => m[1], addEventListener: (t, f) => { root.h.tab[m[1]] = f; } }));
      if (sel === '.sr-next') return root.lines();
      if (sel.indexOf('.sr-toggle') === 0) { const box = { checked: /data-toggle="showPlayed" checked/.test(this._html), getAttribute: () => 'showPlayed', addEventListener: (t, f) => { root.h.toggle = f; } }; root.h.box = box; return [box]; }
      return [];
    },
    querySelector(sel) { return sel === '.sr-clear' && /sr-clear/.test(this._html) ? { addEventListener: (t, f) => { root.h.clear = f; } } : null; },
    lines() {
      if (!opts.nextPx) return [];
      const at = n => { let i = -1; for (let k = 0; k <= n; k++) i = root._html.indexOf('<span class="sr-next" ', i + 1); return i; };
      const seg = n => { const i = at(n); return root._html.slice(i, root._html.indexOf('</span></span></div>', i)); };
      const count = (root._html.match(/<span class="sr-next" /g) || []).length;
      return Array.from({ length: count }, (_, n) => ({
        get scrollWidth() { return nextText(seg(n).replace(/^<span[^>]*>/, '')).length * opts.charPx; },
        clientWidth: opts.nextPx,
        querySelector(sel) {
          if (sel !== '.sr-next-ev') return null;
          const i = at(n), j = root._html.indexOf('<span class="sr-next-ev">', i), end = root._html.indexOf('</span></span></div>', i);
          if (j < 0 || j > end) return null;
          return { remove() { const k = root._html.indexOf('</span>', j) + 7; root._html = root._html.slice(0, j) + root._html.slice(k); } };
        },
      }));
    },
    addEventListener(t, f) { if (t === 'click') root.h.click = f; },
    contains: () => true,
  };
  return root;
}

function boot(opts = {}) {
  const fix = JSON.parse(JSON.stringify(FIX));
  if (opts.edit) opts.edit(fix);
  const store = { 'stennisfy.tz': TZ };
  const grid = fakeRoot(opts);
  const body = { classList: { add() {}, remove() {} }, appendChild() {} };
  const document = {
    readyState: 'complete', body,
    getElementById(id) { return id === 'seriesGrid' ? grid : (id === 'seriesTabBtn' ? { style: {} } : null); },
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    createElement() { return { setAttribute() {}, removeAttribute() {}, hasAttribute: () => true, addEventListener() {}, querySelector: () => null, style: {} }; },
  };
  const clock = { t: FIXED }, timers = [], fetched = { series: 0 };
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(clock.t); } static now() { return clock.t; } }
  const resp = (ok, b) => Promise.resolve({ ok, status: ok ? 200 : 404, json: async () => b });
  const fetch = (url) => /series\.json/.test(String(url)) ? (fetched.series++, opts.noData ? resp(false, null) : resp(true, JSON.parse(JSON.stringify(fix.series)))) : resp(false, null);
  // the page's long timers (the 5-minute slot tick) are recorded, never left to hold the process open; a test fires them
  const pageSetTimeout = (f, ms) => { if (ms > 1000) { const t = { f, ms, live: true }; timers.push(t); return t; } return setTimeout(f, ms); };
  const pageClearTimeout = t => { if (t && t.f) t.live = false; else clearTimeout(t); };
  // The Database join's answer per player, as the real trDbJoinPx returned it on the live page (the join itself is
  // tested where it lives: test-ten402-b.mjs "Data 2"). It prices the rows it is handed in place, by date + opponent + result.
  const answers = fix.join;
  const ctx = vm.createContext({
    window: { FEATURE_SERIES: true }, document, Date: FakeDate, Intl, fetch, console: { warn() {}, log() {}, error() {} },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem() {} },
    setTimeout: pageSetTimeout, clearTimeout: pageClearTimeout, WeakMap, matches: fix.board, playerProfiles: fix.profiles,
    // founder 2026-10-22: the host's one photo resolver; here every even player ID has a photo
    playerPhotoImg: (k, n) => (/^\d*[02468]$/.test(String(k)) ? `<img class="sf-ph" data-k="${k}" alt="${n}">` : ''), 
    _sfDbJoin: { meta: { dateRange: ['2010-01-04', fix.dbEnd] } },
    sfDbJoinLoad: () => (opts.joinFails ? Promise.reject(new Error('down')) : Promise.resolve({})),
    loadCareerHistory: () => Promise.resolve([]),
    __answers: answers, __joinCalls: [],
  });
  ctx.globalThis = ctx;
  vm.runInContext(`
    function sfEventName(raw){ const E = ${JSON.stringify(fix.events)}; return E[raw] || raw; }
    function trDbJoinPx(name, ch){ return function (rows) {
      __joinCalls.push(name);
      const key = Object.keys(__answers).find(k => __names[k] === name);
      const A = (key && __answers[key]) || [];
      rows.forEach(r => { const a = A.find(x => x[0] === r.date && x[1] === r.opp && !!x[2] === !!r.won);
        r.price = a ? a[3] : null; r.oppPrice = a ? a[4] : null; r.book = a ? a[5] : null; });
    }; }
    ${HELPERS}
    window.trPxAfterOf = trPxAfterOf;`, ctx);
  // the join is asked by the player's shared display name: map it back to the key the answers were captured under
  ctx.__names = Object.fromEntries(fix.series.players.map(p => [String(p.key), vm.runInContext('newsPlayerName', ctx)(p.key, p.name)]));
  vm.runInContext(SRC, ctx);
  const api = {
    ctx, fix, grid, opts, clock, timers, fetched, html: () => grid._html,
    async show() { ctx.window.SeriesPage.setActive(false); ctx.window.SeriesPage.setActive(true); await this.settle(); },
    async tick() { const t = timers.filter(x => x.live && x.ms === 5 * 60000); assert.equal(t.length, 1, 'one live 5-minute slot tick'); t[0].live = false; t[0].f(); await this.settle(); },
    async settle() { for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 1)); },
    seg(key, val) { grid.h.seg[key]({ target: { closest: () => ({ getAttribute: () => val }) } }); },
    tab(t) { grid.h.tab[t](); },
    played(on) { grid.h.box.checked = on; grid.h.toggle(); },
    clear() { grid.h.clear(); },
    view() { return ctx.window.SeriesPage._view(); },
    popup(i) { return ctx.window.SeriesPage._popupHtml(i); },
  };
  return api;
}
async function start(opts) { const b = boot(opts); b.ctx.window.SeriesPage.setActive(true); await b.settle(); return b; }

// ── parse the rendered page ──────────────────────────────────────────────────────────────────────────────────────
const stat = (page, label) => { const m = page.match(new RegExp('<span class="sfh__l">' + label + '</span><span class="sfh__v([^"]*)">([^<]*)<')); return m ? { cls: m[1], v: m[2] } : null; };
function cardsOf(page) {
  return page.split('<article class="sr-card').slice(1).map(seg => ({
    name: (seg.match(/class="sr-pname">([^<]*)</) || [])[1],
    rank: (seg.match(/class="sr-prank">([^<]*)</) || [])[1],
    ava: (seg.match(/class="sr-ava">([^<]*)</) || [])[1],
    next: (seg.match(/<span class="sr-next" title="[^"]*">([\s\S]*?)<\/span><\/span><\/div>/) || [])[1],
    nextTitle: (seg.match(/<span class="sr-next" title="([^"]*)">/) || [])[1],
    count: (seg.match(/class="sr-tile-n">([^<]*)</) || [])[1],
    claim: (seg.match(/class="sr-claim">([^<]*)</) || [])[1],
    sub: (seg.match(/class="sr-claimsub">([^<]*)</) || [])[1],
    rows: [...seg.matchAll(/<span class="sr-row-k">([^<]*)<\/span><span class="sr-row-v[^"]*">(.*?)<\/span><\/div>/g)].map(m => [m[1], m[2].replace(/<[^>]+>/g, '')]),
    raw: seg,
  }));
}
const nextText = s => String(s || '').replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function ledgerOf(pop) {
  return pop.split('<div class="sr-mrow">').slice(1).map(seg0 => {
    const seg = seg0.slice(0, seg0.indexOf('</div>'));
    const cell = c => (seg.match(new RegExp('<span class="' + c + '"[^>]*>(.*?)</span>(?=<span class="sr-m|$)')) || [])[1];
    const strip = s => String(s == null ? '' : s).replace(/<[^>]+>/g, '');
    return { res: strip((seg.match(/^<span class="sr-mres[^"]*">(.*?)<\/span>/) || [])[1]), date: strip(cell('sr-mdate')), score: strip(cell('sr-mscore')),
      home: strip(cell('sr-mp1')), away: strip(cell('sr-mp2')), pl: strip((seg.match(/<span class="sr-mpl">(.*)<\/span>$/) || [])[1]),
      plCls: (seg.match(/<span class="sr-mpl"><span class="(sr-w|sr-l)">/) || [])[1] || null };
  });
}
const cents = x => Math.round(x * 100);

// ── Data 2 · the slate: Today's Matches day rule, the card's own strings ─────────────────────────────────────────
test('Data 2: every card is on the Today / Tomorrow slate; the Next line is the Today\'s Matches card (time · event · vs Opponent)', async () => {
  const b = await start();
  const view = b.view();
  assert.ok(view.length >= 5, 'the frozen board must paint cards: ' + view.length);
  const bucket = vm.runInContext('matchDayBucket', b.ctx), fmt = vm.runInContext('cardFmtStart', b.ctx), nm = vm.runInContext('newsPlayerName', b.ctx);
  let onBoard = 0, off = 0;
  view.forEach(c => assert.ok(['today', 'tomorrow'].includes(c.slot.day), 'a card off the Today / Tomorrow slate: ' + c.player.name));
  const cards = cardsOf(b.html());
  view.forEach((c, i) => {
    const u = c.player.upcoming, ek = String(u.eventKey);
    const bm = b.fix.board.find(m => String(m.id).replace(/^\D+-/, '') === ek);
    const src = bm || { date: u.date, time: u.time };
    const day = bucket({ date: src.date });
    const isP1 = bm && String(bm.p1Key) === String(c.player.key);
    const opp = bm ? nm(isP1 ? bm.p2Key : bm.p1Key, isP1 ? bm.p2 : bm.p1) : nm(u.opponentKey, u.opponentName);
    const ev = b.fix.events[bm ? bm.tour : u.tournament] || (bm ? bm.tour : u.tournament);
    const want = 'Next ' + (day === 'today' ? 'Today' : 'Tomorrow') + ' ' + fmt(src, false) + ' · ' + ev + ' · vs ' + opp;
    assert.equal(nextText(cards[i].next), want, 'Next line of ' + c.player.name);
    // the full line is the title tooltip (round 3 item 2: "vs", the reference's word)
    assert.equal(nextText(cards[i].nextTitle), want, 'the Next title tooltip carries the full line for ' + c.player.name);
    assert.match(cards[i].next, /<span class="sr-next-ev"> · [^<]+<\/span><span class="sr-next-opp"> · vs /, 'the event span carries its own separator, so it drops whole');
    assert.match(cards[i].next, /^<span class="sr-next-k">Next <\/span><span class="sr-next-t">/, 'the space after "Next" must sit inside its span (a white-space-only run between flex items is dropped)');
    if (bm) onBoard++; else off++;
  });
  assert.ok(onBoard > 0 && off > 0, `both kinds must be exercised (board ${onBoard}, Challenger fixtures ${off})`);
  // a player whose next match is not on Today / Tomorrow has no card
  const k = String(view[0].player.key);
  const b2 = await start({ edit: f => { const p = f.series.players.find(x => String(x.key) === k); p.upcoming.eventKey = 'x'; p.upcoming.date = '2026-10-14'; } });
  assert.ok(!b2.view().some(c => String(c.player.key) === k), 'a player scheduled outside Today / Tomorrow still has a card');
});

// ── round 3 item 2 · the event is shown whole or dropped, never cut ───────────────────────────────────────────────
test('Round 3 item 2: a Next line that does not fit drops its event whole ("Next <day> <time> · vs <opponent>"); one that fits keeps it; the tooltip keeps the full line', async () => {
  const CW = 6.5;
  const full = cardsOf((await start()).html()).map(c => nextText(c.nextTitle));
  const lens = full.map(t => t.length).sort((a, b) => a - b);
  const W = lens[Math.floor(lens.length / 2)] * CW;   // the median line just fits: the longer half must drop
  const b = await start({ nextPx: W, charPx: CW });
  let dropped = 0, kept = 0;
  cardsOf(b.html()).forEach((c, i) => {
    const title = nextText(c.nextTitle), shown = nextText(c.next);
    assert.equal(title, full[i], 'the tooltip keeps the full line');
    assert.ok(!/…|\.\.\./.test(c.next), 'an ellipsis inside the Next line: ' + shown);
    const parts = title.split(' · ');   // Next <day> <time> · <event> · vs <opponent>
    if (title.length * CW > W) {
      dropped++;
      assert.equal(shown, parts[0] + ' · ' + parts[parts.length - 1], 'the event must be dropped whole: ' + shown);
      assert.ok(!/sr-next-ev/.test(c.next), 'the event span is still there');
    } else {
      kept++;
      assert.equal(shown, title, 'a line that fits must keep its event');
    }
  });
  assert.ok(dropped > 0 && kept > 0, `both cases exercised (dropped ${dropped}, kept ${kept})`);
});

// ── Data 3 · Level, Day, Show already-played, Soonest ─────────────────────────────────────────────────────────────
test('Data 3: Level = the tour tag (ATP / Challenger), Day = the scheduled date, Show already-played INCLUDES started / finished, Soonest = the start instant', async () => {
  const b = await start();
  b.seg('minLen', '3');
  const all = b.view().slice();
  b.seg('level', 'tour');
  assert.ok(b.view().length > 0 && b.view().every(c => c.player.tier === 'tour'), 'Level ATP must keep tour cards only');
  b.seg('level', 'chal');
  assert.ok(b.view().length > 0 && b.view().every(c => c.player.tier === 'chal'), 'Level Challenger must keep Challenger cards only');
  assert.equal(b.view().length + all.filter(c => c.player.tier === 'tour').length, all.length, 'ATP + Challenger = All');
  b.seg('level', 'all');
  b.seg('day', 'today');
  const today = b.view().length;
  assert.ok(b.view().every(c => c.slot.day === 'today'));
  b.seg('day', 'tomorrow');
  assert.ok(b.view().every(c => c.slot.day === 'tomorrow'));
  assert.equal(today + b.view().length, all.length, 'Today + Tomorrow = All');
  b.seg('day', 'all');
  // Soonest = the real start instant (cardStartMs), unknown last; Longest = count
  b.seg('sort', 'soonest');
  const st = vm.runInContext('cardStartMs', b.ctx);
  const ms = b.view().map(c => { const u = c.player.upcoming; const bm = b.fix.board.find(m => String(m.id).replace(/^\D+-/, '') === String(u.eventKey)); return st(bm || { date: u.date, time: u.time }); });
  for (let i = 1; i < ms.length; i++) assert.ok(ms[i - 1] <= ms[i], 'Soonest is not in start order at ' + i);
  assert.ok(new Set(ms).size > 2, 'the start instants must vary or the order check is vacuous');
  b.seg('sort', 'longest');
  const counts = b.view().map(c => c.streak.count);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i - 1] >= counts[i], 'Longest is not count order');
  // Show already-played: a board match that has started (live) leaves by default and comes back, with the rest, when checked
  const target = b.view().find(c => b.fix.board.some(m => String(m.id).replace(/^\D+-/, '') === String(c.player.upcoming.eventKey)));
  assert.ok(target, 'a board card is needed');
  const ek = String(target.player.upcoming.eventKey);
  const b3 = await start({ edit: f => { f.board.find(m => String(m.id).replace(/^\D+-/, '') === ek).live = true; } });
  b3.seg('minLen', '3');
  const hidden = b3.view();
  assert.ok(!hidden.some(c => String(c.player.upcoming.eventKey) === ek), 'a started match stays on the default view');
  b3.played(true);
  const shown = b3.view();
  assert.ok(shown.some(c => String(c.player.upcoming.eventKey) === ek), 'Show already-played does not bring the started match back');
  assert.ok(shown.length > hidden.length && hidden.every(c => shown.includes(c)), 'Show already-played must INCLUDE the unplayed cards, not replace them');
  // finished on the board counts too
  const b4 = await start({ edit: f => { f.board.find(m => String(m.id).replace(/^\D+-/, '') === ek).finalScore = '2-0'; } });
  b4.seg('minLen', '3');
  assert.ok(!b4.view().some(c => String(c.player.upcoming.eventKey) === ek), 'a finished match stays on the default view');
});

// ── round 2 fix 1 · Show already-played: the streak as it stood at the start of the next match ─────────────────────
test('Fix 1: a card whose next match has started / finished shows the run as it stood at that start (count, Started, Last, pool, claim, Avg price, ledger)', async () => {
  const b = await start();
  b.seg('minLen', '3'); b.played(true);
  const view = b.view(), cards = cardsOf(b.html());
  const at = (name, type) => view.findIndex(c => c.player.name === name && c.streak.type === type);
  // Medvedev: next = Shanghai 10 Oct 06:10 v Struff (finished); the run held that match → 7, Last 4 Oct
  const md = at('D. Medvedev', 'all');
  assert.ok(md >= 0, 'Medvedev all-comps card');
  assert.equal(view[md].base.count, 8);
  assert.equal(cards[md].count, '7');
  assert.equal(cards[md].claim, 'Won 7 straight');
  const d0 = view[md].base.matches[0].date.split('-');
  const started = (+d0[2]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+d0[1] - 1] + ' ' + d0[0];
  assert.deepEqual(cards[md].rows.slice(0, 2), [['Started', started], ['Last', '4 Oct']], 'Started stays the run\'s first match, Last moves back');
  const pop = b.popup(md);
  assert.equal(ledgerOf(pop).length, 7, 'the ledger stops at the start too');
  assert.ok(!ledgerOf(pop).some(r => r.date === '10 Oct 2026'), 'the next match is in the ledger');
  assert.match(pop, new RegExp('<span class="sr-ov-sub">#5 · 7 of ' + (view[md].base.pool - 1) + ' matches'), 'the pool loses the cut row');
  assert.match(pop, /<span class="sr-ov-line">Won 7 straight across all competitions<\/span>/);
  // Baez and Vacherot played each other 10 Oct 14:50: both stop before it
  const bz = at('S. Baez', 'total'), vc = at('V. Vacherot', 'setpat');
  assert.ok(bz >= 0 && vc >= 0, 'Baez / Vacherot cards');
  assert.deepEqual([cards[bz].count, cards[bz].rows[1][1]], ['7', '8 Oct']);
  assert.deepEqual([cards[vc].count, cards[vc].rows[1][1]], ['6', '5 Oct']);
  // every card: no row on / after its next match's start; an unstarted next match cuts nothing
  let cut = 0;
  view.forEach(c => {
    const u = c.player.upcoming;
    assert.ok(!c.streak.matches.some(m => String(m.eventKey) === String(u.eventKey)), 'the next match is inside the run of ' + c.player.name);
    if (c.slot.played) assert.ok(c.streak.matches.every(m => m.date < u.date), 'a row on / after the start of ' + c.player.name);
    if (c.streak !== c.base) { cut++; assert.equal(c.streak.count, c.streak.matches.length); assert.equal(c.streak.lastDate, c.streak.matches[c.streak.matches.length - 1].date); }
    if (!c.slot.played) assert.equal(c.streak, c.base, 'an unstarted next match must cut nothing: ' + c.player.name);
  });
  assert.ok(cut >= 3, 'cut cards: ' + cut);
  // the run carries no key for the match: once it has started, the rows dated on its day go; before it, a same-day row stays
  const b2 = await start({ edit: f => { f.series.players.find(p => p.name === 'V. Vacherot').streaks[0].matches.slice(-1)[0].eventKey = null; } });
  b2.seg('minLen', '3'); b2.played(true);
  assert.equal(b2.view().find(c => c.player.name === 'V. Vacherot').streak.count, 6, 'the date rule must cut a started match without its key');
  let kept;
  const b3 = await start({ edit: f => {
    const p = f.series.players.find(x => x.name === 'A. Zverev'); const ms = p.streaks[0].matches; kept = p.streaks[0].count;
    ms[ms.length - 1].date = p.upcoming.date; ms[ms.length - 1].eventKey = 'other';
  } });
  b3.seg('minLen', '3');
  const zv = b3.view().find(c => c.player.name === 'A. Zverev' && c.streak === c.base);
  assert.ok(zv && zv.streak.count === kept && !zv.slot.played, 'a same-day row before an unstarted match must stay');
  // under the floor after the cut: no card (min length 3; pool 8 for every family but all comps)
  // (the engine floor read from rules: at minLen 4 the vs-style 4 → 3 falls under it although the page's 3+ chip would show it)
  const b4 = await start({ edit: f => { f.series.rules.minLen = 4; } });
  b4.seg('minLen', '3'); b4.played(true);
  assert.ok(!b4.view().some(c => c.player.name === 'D. Medvedev' && c.streak.type === 'style'), 'a run under the engine\'s min length after the cut must not show');
  const b5 = await start({ edit: f => { f.series.players.find(p => p.name === 'D. Medvedev').streaks.find(x => x.type === 'style').pool = 8; } });
  b5.seg('minLen', '3'); b5.played(true);
  assert.ok(!b5.view().some(c => c.player.name === 'D. Medvedev' && c.streak.type === 'style'), 'a pool of 7 after the cut must not show');
  const b6 = await start();
  b6.seg('minLen', '3'); b6.played(true);
  assert.ok(b6.view().some(c => c.player.name === 'D. Medvedev' && c.streak.type === 'style' && c.streak.count === 3 && c.streak.pool === 39), 'Medvedev vs style 4 → 3 of 39 stays');
});

// ── round 2 fix 1 at the source · the generator's as-of-start set (players[].asOfStart, rules.asOfStart) ─────────
// The frozen capture predates the field (the test above = the page fallback). Here the capture is given the field the
// way build-series.js now writes it: J. Pinnington Jones won 6, 8, 9 Oct and lost 10 Oct 12:00 to Glinka (that match
// BROKE his all-comps run, so the post-match file has no all-comps card for him); measured with the generator's own
// asOfStartStreaks on his real history (11 Oct): all comps 3 of 94, Last 9 Oct, surface clay 3 of 10 over the same rows.
function withAsOfStart(f, opts = {}) {
  f.series.rules.asOfStart = 'players[].asOfStart';
  const pj = f.series.players.find(p => p.name === 'J. Pinnington Jones');
  const rows = pj.streaks[0].matches.slice(0, 3);
  const mk = (type, subtype, pool) => ({ count: 3, pool, lastDate: '2026-10-09', ageDays: 1, slamExempt: false, lastTournament: 'Villena', gapCut: null,
    matches: JSON.parse(JSON.stringify(rows)), type, family: type, subtype, direction: 'win', reference: null });
  pj.asOfStart = [mk('all', null, 94), mk('surface', 'clay', 10)];
  if (opts.medvedev) f.series.players.find(p => p.name === 'D. Medvedev').asOfStart = opts.medvedev;
  // Zverev's next match (11 Oct 12:00) has not started on the page's clock; give him a set as if the build had judged it started
  const zv = f.series.players.find(p => p.name === 'A. Zverev');
  zv.asOfStart = [Object.assign(JSON.parse(JSON.stringify(zv.streaks[0])), { count: 16, matches: zv.streaks[0].matches.slice(0, -1) })];
}
test('Fix 1 (source): Show already-played shows the generator\'s as-of-start set — a run the next match BROKE has its card at the pre-match count', async () => {
  const b = await start({ edit: f => withAsOfStart(f) });
  b.seg('minLen', '3');
  assert.ok(!b.view().some(c => c.player.name === 'J. Pinnington Jones'), 'an as-of-start card must wait for Show already-played');
  b.played(true);
  const view = b.view(), cards = cardsOf(b.html());
  const pj = view.map((c, i) => [c, i]).filter(([c]) => c.player.name === 'J. Pinnington Jones');
  assert.equal(pj.length, 1, 'one Pinnington Jones card: the post-match runs are replaced, and clay over the same rows is the narrower');
  const [c, i] = pj[0];
  assert.deepEqual([c.set, c.streak.type, cards[i].count, cards[i].claim], ['start', 'all', '3', 'Won 3 straight']);
  assert.deepEqual(cards[i].rows.slice(0, 2), [['Started', '6 Oct 2026'], ['Last', '9 Oct']]);
  assert.match(cards[i].nextTitle, /Glinka/, 'Next = the 10 Oct match v Glinka');
  const pop = b.popup(i);
  assert.deepEqual(ledgerOf(pop).map(r => r.date), ['9 Oct 2026', '8 Oct 2026', '6 Oct 2026'], 'the ledger = the as-of-start rows');
  assert.ok(pop.indexOf('3 of 94 matches') >= 0, 'pop-up: 3 of 94 matches');
  // a build with the field: a player without asOfStart was built before his match started → his runs show as built
  const md = view.find(x => x.player.name === 'D. Medvedev' && x.streak.type === 'all');
  assert.ok(md && md.streak === md.base && md.streak.count === 8, 'a series.json with the field must not be trimmed on the page');
  // a next match that has not started on the page: the as-of-start set waits, the runs show as built
  const zv = view.filter(x => x.player.name === 'A. Zverev');
  assert.equal(JSON.stringify(zv.map(x => [x.set, x.streak.count])), '[["now",17]]', 'before its start a player shows his runs, never his as-of-start set');
  // an empty as-of-start set = no card for that player once his match has started
  const b2 = await start({ edit: f => withAsOfStart(f, { medvedev: [] }) });
  b2.seg('minLen', '3'); b2.played(true);
  assert.ok(!b2.view().some(x => x.player.name === 'D. Medvedev'), 'an empty as-of-start set must show no card');
});

test('Fix 1 (fallback trim): recency re-measured at the match start (Slams exempt); a same-day row whose board start is earlier stays', async () => {
  // Vacherot's first-set run with every row before 10 Oct moved to July: the remaining Last is 87 days before the start
  const july = (f, tour) => { const st = f.series.players.find(p => p.name === 'V. Vacherot').streaks[0];
    st.matches.slice(0, -1).forEach((m, i) => { m.date = '2026-07-' + String(10 + i).padStart(2, '0'); if (tour) m.tournament = tour; }); };
  const b = await start({ edit: f => july(f) });
  b.seg('minLen', '3'); b.played(true);
  assert.ok(!b.view().some(c => c.player.name === 'V. Vacherot'), 'a trimmed run older than 45 days at the start must not show');
  const b1 = await start({ edit: f => july(f, 'Wimbledon') });
  b1.seg('minLen', '3'); b1.played(true);
  const vc = b1.view().find(c => c.player.name === 'V. Vacherot');
  assert.ok(vc && vc.streak.count === 6 && vc.streak.ageDays === 87 && vc.streak.slamExempt === true, 'a Grand Slam last match is exempt');
  // the run's last row re-keyed to a board match of the same day: 09:30 (Bu v Ruud) is before Vacherot's 14:50 → stays;
  // 12:40 (Darderi v Tsitsipas) is after Medvedev's 06:10 → cut
  const b2 = await start({ edit: f => {
    f.series.players.find(p => p.name === 'V. Vacherot').streaks[0].matches.slice(-1)[0].eventKey = '12169534';
    f.series.players.find(p => p.name === 'D. Medvedev').streaks[0].matches.slice(-1)[0].eventKey = '12169478';
  } });
  b2.seg('minLen', '3'); b2.played(true);
  assert.equal(b2.view().find(c => c.player.name === 'V. Vacherot').streak.count, 7, 'an earlier same-day match must never be cut');
  assert.equal(b2.view().find(c => c.player.name === 'D. Medvedev' && c.streak.type === 'all').streak.count, 7, 'a later same-day match is cut');
});

test('Generator (fix 1): asOfStartStreaks = the runs from the history strictly before the slate match, recency at its start', () => {
  delete require.cache[require.resolve(ENGINE)];
  const E = require(ENGINE);
  const set = (n, a, b) => ({ score_set: String(n), score_first: String(a), score_second: String(b) });
  let k = 100;
  // player '1' always Home; won → 6-3 6-4, lost → 3-6 4-6 (hard, non-Slam ATP). Dates in the past: never a time bomb.
  const fx = (date, time, won) => ({ event_type_type: 'Atp Singles', event_status: 'Finished', first_player_key: '1', second_player_key: String(k + 1000),
    event_first_player: 'A. One', event_second_player: 'Opp ' + k, event_winner: won ? 'First Player' : 'Second Player', event_date: date, event_time: time,
    event_key: String(k++), tournament_key: '7', tournament_name: 'Test Open', scores: won ? [set(1, 6, 3), set(2, 6, 4)] : [set(1, 3, 6), set(2, 4, 6)] });
  const SURF = { 7: 'hard' };
  const ctxOf = f => ({ date: f.event_date, time: f.event_time, eventKey: f.event_key, surface: 'hard', bestOf: 3, opponentArch: null, played: true });
  const all = list => list.find(s => s.type === 'all');
  const run = (list, slate) => E.asOfStartStreaks(list, '1', 'tour', ctxOf(slate), SURF, new Map());
  // BROKE: five losses, W W W, the slate match LOST, then a later win (after the start). Eight matches: every family's pool floor
  const hist = ['2025-12-20', '2025-12-22', '2025-12-24', '2025-12-27', '2025-12-30'].map(d => fx(d, '12:00', false))
    .concat([fx('2026-01-05', '12:00', true), fx('2026-01-07', '12:00', true), fx('2026-01-09', '12:00', true)]);
  const slateL = fx('2026-01-12', '15:00', false), later = fx('2026-01-13', '10:00', true);
  const broke = run([...hist, slateL, later], slateL);
  assert.ok(all(broke), 'a run the slate match broke must have its as-of-start card');
  assert.deepEqual([all(broke).count, all(broke).direction, all(broke).lastDate, all(broke).pool], [3, 'win', '2026-01-09', 8], 'count, Last and pool stop at the start');
  assert.ok(!all(broke).matches.some(m => m.eventKey === slateL.event_key || m.date >= '2026-01-12'), 'no row at / after the start');
  // the post-match runs (what series.json carries) have no 3-match winning run for this player
  const post = E.streaksFor(E.orderedRecords([...hist, slateL, later], '1', 'tour', SURF, new Map(), true), 'tour');
  assert.notEqual((all(post) || {}).count, 3);
  // EXTENDED: the slate match won → the count excludes it
  const slateW = fx('2026-01-12', '15:00', true);
  assert.equal(all(run([...hist, slateW], slateW)).count, 3, 'the slate match must not count');
  // SAME DAY: an earlier same-day match (both timed) stays; a later same-day one goes
  const early = fx('2026-01-12', '10:00', true), late = fx('2026-01-12', '19:00', true);
  assert.equal(all(run([...hist, early, slateW, late], slateW)).count, 4, 'an earlier same-day match must stay, a later one go');
  // RECENCY at the start: Last 9 Jan is 3 days before a 12 Jan start (and far more than 45 days before the build)
  assert.equal(all(broke).ageDays, 3, 'ageDays measured at the start');
  // … and 50 days before the start → no card
  const far = fx('2026-02-28', '15:00', false);
  assert.equal(all(run([...hist, far], far)), undefined, '45-day recency at the start');
  // the same relevance gate and one card per family as the live set
  assert.equal(broke.find(s => s.type === 'surface').subtype, 'hard');
  const clay = E.asOfStartStreaks([...hist, slateL], '1', 'tour', Object.assign(ctxOf(slateL), { surface: 'clay' }), SURF, new Map());
  assert.ok(!clay.some(s => s.type === 'surface'), 'a hard-court run must not reach a clay match');
  const fams = broke.map(s => s.family);
  assert.equal(new Set(fams).size, fams.length, 'one card per family: ' + fams.join(','));
  // the same engine floors: two wins = under the min length
  const two = [fx('2026-01-02', '12:00', false), fx('2026-01-05', '12:00', true), fx('2026-01-07', '12:00', true)];
  assert.equal(all(run([...two, slateL], slateL)), undefined, 'under the min length');
  // started at the build: finished, or its start instant passed; a future start is not (12 Jan 15:00 Berlin = 14:00Z)
  assert.equal(E.startedAtBuild({ date: '2026-01-12', time: '15:00', played: false }, Date.parse('2026-01-12T14:30:00Z')), true);
  assert.equal(E.startedAtBuild({ date: '2026-01-12', time: '15:00', played: false }, Date.parse('2026-01-12T13:30:00Z')), false);
  assert.equal(E.startedAtBuild({ date: '2026-01-12', time: '15:00', played: true }, Date.parse('2026-01-11T00:00:00Z')), true);
});

// ── Series outcomes ledger (founder card 011f0d2d, 11 Oct): judged on the run AS IT STOOD AT THE START ─────────────
// "A run that match broke is recorded as broken." The old rule judged series.json's post-match runs (the match already
// inside them), reproduced below from the engine's own exported pieces exactly as the old main() composed them, so the
// test shows the same ledger key flipping held → broken. Real case (rebuild sample, 11 Oct): D. Medvedev beat Struff
// 4–6 6–3 6–4 on 10 Oct after 7 straight-set wins — Set outcome read "won the 2nd set 6, held", now "won the opening
// set 7, broken"; J. Pinnington Jones (W 6, 8, 9 Oct, L 10 Oct) had no all-comps row, now "won 3, broken".
test('Outcomes ledger (founder 011f0d2d): a run the next match breaks reads broken now, held (or absent) under the post-match rule', () => {
  delete require.cache[require.resolve(ENGINE)];
  const E = require(ENGINE);
  const set = (n, a, b) => ({ score_set: String(n), score_first: String(a), score_second: String(b) });
  let k = 500;
  const fx = (date, sets, won) => ({ event_type_type: 'Atp Singles', event_status: 'Finished', first_player_key: '1', second_player_key: String(k + 1000),
    event_first_player: 'A. One', event_second_player: 'Opp ' + k, event_winner: won ? 'First Player' : 'Second Player', event_date: date, event_time: '12:00',
    event_key: String(k++), event_final_result: won ? '2 - 0' : '0 - 2', tournament_key: '7', tournament_name: 'Test Open', scores: sets.map((s, i) => set(i + 1, s[0], s[1])) });
  const SURF = { 7: 'hard' }, NONE = new Map();
  // dates count back from TODAY: the post-match rule ran right after the match, so its 45-day recency must hold too
  // (a fixed date would age out of it and make the "held before" half vacuous)
  const ago = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const ctxOf = (f, side = 'first') => E.slateCtx(f, side, null, SURF, NONE);
  const judge = (list, f, side = 'first') => E.judgeAtStart(list, side === 'first' ? '1' : f.second_player_key, 'tour', ctxOf(f, side),
    E.recordFor(f, side === 'first' ? '1' : f.second_player_key, 'tour', SURF, NONE, true), SURF, NONE, null);
  // the rule this ruling replaces: series.json's runs (built AFTER the match) judged on that match
  const judgePost = (list, f) => {
    const ctx = ctxOf(f), pr = E.recordFor(f, '1', 'tour', SURF, NONE, true), out = {};
    for (const st of E.collapseByFamily(E.streaksFor(E.orderedRecords(list, '1', 'tour', SURF, NONE, true), 'tour').filter(s => E.isRelevant(s, ctx)))) {
      out[ctx.eventKey + '|1|' + (st.family || st.type)] = { held: E.conditionHeld(st, pr), subtype: st.subtype, line: st.line, streakCount: st.count };
    }
    return out;
  };
  // A · W W W, then the next match LOST (eight matches: every pool floor met)
  const lead = [40, 38, 36, 34, 32].map(n => fx(ago(n), [[3, 6], [4, 6]], false));
  const www = [8, 6, 4].map(n => fx(ago(n), [[6, 3], [6, 4]], true));
  const lost = fx(ago(2), [[3, 6], [4, 6]], false);
  const a = judge([...lead, ...www, lost], lost), keyA = lost.event_key + '|1|all';
  assert.ok(a[keyA], 'the 3-match winning run must be judged at the start of the match that broke it');
  assert.deepEqual([a[keyA].held, a[keyA].direction, a[keyA].streakCount, a[keyA].won, a[keyA].opponent], [false, 'win', 3, false, lost.event_second_player], 'reads BROKEN, on the run of 3 as it stood');
  assert.equal(judgePost([...lead, ...www, lost], lost)[keyA], undefined, 'under the post-match rule the broken run was never written');
  assert.ok(Object.keys(a).every(x => x.startsWith(lost.event_key + '|1|')), 'rows are keyed (event|player|family)');
  // B · the same KEY flips held → broken: 7 straight-set wins (won the opening set, by more than 3.5), then won 4–6 6–3 6–4
  const seven = [20, 18, 16, 14, 12, 10, 8].map(n => fx(ago(n), [[6, 2], [6, 3]], true));
  const struff = fx(ago(2), [[4, 6], [6, 3], [6, 4]], true);
  const list = [...lead, ...seven, struff];
  const now = judge(list, struff), was = judgePost(list, struff);
  const kSet = struff.event_key + '|1|setout', kHc = struff.event_key + '|1|handicap', kAll = struff.event_key + '|1|all';
  assert.deepEqual([now[kSet].held, now[kSet].subtype, now[kSet].streakCount], [false, 'won-first-set', 7], 'Set outcome: the opening-set run of 7 it broke');
  assert.equal(was[kSet].held, true, 'the post-match rule read the same key HELD (a different, longer run that contains the match)');
  assert.deepEqual([now[kHc].held, now[kHc].line, now[kHc].streakCount], [false, 3.5, 7], 'Handicap: won by 3 games breaks the −3.5 run of 7');
  assert.equal(was[kHc].held, true, 'the post-match rule read Handicap HELD (on the −1.5 run that survived)');
  assert.deepEqual([now[kAll].held, now[kAll].streakCount], [true, 7], 'All comps: a win extends the run of 7 — held, counted as it stood (7, not 8)');
  // C · not evaluable stays null: an awarded / walkover match is no countable record
  const wo = Object.assign(fx(ago(2), [], true), { event_status: 'Walk Over' });
  const n = judge([...lead, ...seven, wo], wo);
  assert.ok(Object.keys(n).length && Object.values(n).every(r => r.held === null && r.won === null), 'a walkover is judged null (not evaluable), never held / broken');
});

// The pipeline commit-back owns series-outcomes.json (it appends every few ticks), so the rebuild ships as a SEED file;
// loadLedger migrates: an old-rule ledger is discarded whole for the seed, a marked ledger is kept and the seed ignored.
const SEED = join(HERE, 'series-outcomes.rebuild.json');
test('Outcomes ledger: the committed seed series-outcomes.rebuild.json is the as-of-start rebuild (not the post-match ledger patched)', () => {
  delete require.cache[require.resolve(ENGINE)];
  const E = require(ENGINE);
  const j = JSON.parse(readFileSync(SEED, 'utf8'));
  assert.equal(j.rule, E.LEDGER_RULE, 'the seed must carry the as-of-start rule marker the generator writes');
  const rows = Object.values(j.records || {});
  assert.equal(rows.length, 4663, 'the rebuild 7 Sep - 10 Oct is 4,663 rows');
  assert.ok(rows.every(r => 'won' in r && 'opponent' in r), 'every row is a rebuilt one (old post-match rows carry no won / opponent)');
  assert.ok(rows.filter(r => r.held === false).length > 100, 'broken runs are recorded');
});

test('Outcomes ledger migration: an old-rule series-outcomes.json is replaced whole by the seed; a marked one keeps its rows and ignores the seed; no seed throws', () => {
  delete require.cache[require.resolve(ENGINE)];
  const E = require(ENGINE);
  const dir = mkdtempSync(join(tmpdir(), 'ten427-ledger-'));
  try {
    const seed = JSON.parse(readFileSync(SEED, 'utf8'));
    const oldRow = { date: '2026-10-11', tier: 'tour', type: 'all', family: 'all', direction: 'win', held: true, streakCount: 4, player: 'B. Shelton' };
    const put = (name, v) => { const f = join(dir, name); writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v)); return f; };
    // (b) old rule: main's shape (records, no marker), an array, an unreadable file, a missing file -> exactly the seed's rows
    for (const f of [put('old.json', { records: { '999|1|all': oldRow } }), put('arr.json', [oldRow]), put('bad.json', '{"records":'), join(dir, 'none.json')]) {
      const l = E.loadLedger(f, SEED);
      assert.equal(l.rule, E.LEDGER_RULE, f);
      // isDeepStrictEqual, not assert.deepEqual: a failing deepEqual on the 4,663-row seed builds a diff of two huge
      // objects (~1.7 GB, ~15 s per mutant), which ran the pipeline's gate runner out of memory (11 Oct freeze).
      assert.ok(isDeepStrictEqual(l.records, seed.records), 'an old-rule ledger loads the seed whole: ' + f + ' (' + Object.keys(l.records || {}).length + ' rows)');
      assert.equal(l.records['999|1|all'], undefined, 'no old-rule row survives the migration');
    }
    // (c) marked: the file's own rows, the seed never read (even a missing seed does not matter)
    const mine = { '777|2|all': Object.assign({}, oldRow, { won: true, opponent: 'X. Y' }) };
    const marked = put('marked.json', { rule: E.LEDGER_RULE, records: mine });
    const kept = E.loadLedger(marked, SEED).records;
    assert.ok(isDeepStrictEqual(kept, mine), 'a marked ledger keeps its rows and ignores the seed (' + Object.keys(kept || {}).length + ' rows)');
    assert.ok(isDeepStrictEqual(E.loadLedger(marked, join(dir, 'no-seed.json')).records, mine), 'a marked ledger needs no seed');
    // (d) old rule + missing / invalid seed -> throws, never an empty or partial ledger
    assert.throws(() => E.loadLedger(join(dir, 'old.json'), join(dir, 'no-seed.json')), /seed/);
    assert.throws(() => E.loadLedger(join(dir, 'old.json'), put('oldseed.json', { records: { '999|1|all': oldRow } })), /seed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── round 2 fix 2 · the reference's claim templates ("N straight") ───────────────────────────────────────────────
test('Fix 2: claims read the reference\'s templates — "Won 8 straight", "Won 6 straight on Clay", "Lost 4 straight vs …", the line / set sentences', async () => {
  const b = await start({ edit: f => { const st = f.series.players.find(p => p.name === 'T. J. Fancutt').streaks.find(x => x.type === 'handicap'); st.count = 3; } });
  b.seg('minLen', '3'); b.played(true);
  const view = b.view(), cards = cardsOf(b.html());
  const seen = new Set();
  const SET = { 'won-first-set': 'Won the opening set', 'lost-first-set': 'Lost the opening set', 'won-2nd-set': 'Won the 2nd set', 'lost-2nd-set': 'Lost the 2nd set',
    'straight-sets-win': 'Won in straight sets', 'straight-sets-loss': 'Lost in straight sets', 'went-the-distance': 'Went the distance (reached the deciding set)', 'no-set-won': 'Failed to win a set' };
  view.forEach((c, i) => {
    const st = c.streak, v = st.direction === 'win' ? 'Won' : 'Lost', claim = cards[i].claim.replace(/&amp;/g, '&');
    let want;
    if (st.type === 'all') want = v + ' ' + st.count + ' straight';
    else if (st.type === 'surface') want = v + ' ' + st.count + ' straight on ' + st.subtype[0].toUpperCase() + st.subtype.slice(1);
    else if (st.type === 'style') want = v + ' ' + st.count + ' straight vs ' + st.subtype;
    else if (st.type === 'total') want = (st.over ? 'Over ' : 'Under ') + st.line + ' total games (best-of-' + st.bestOf + ')';
    else if (st.type === 'handicap') want = (st.cover ? 'Won by more than ' + st.line + ' games — covered −' : 'Lost by more than ' + st.line + ' games — failed to cover +') + st.line;   // no "(best-of-N)" on the card: ruling handicap-bestof (a)
    else if (st.firstSet) want = 'First set ' + (st.over ? 'over ' : 'under ') + st.line + ' games';
    else want = SET[st.subtype];
    assert.equal(claim, want, 'claim of ' + c.player.name + ' (' + st.type + ')');
    seen.add(st.type === 'setpat' && st.firstSet ? 'setgames' : st.type);
  });
  for (const t of ['all', 'surface', 'style', 'total', 'handicap', 'setpat', 'setgames']) assert.ok(seen.has(t), 'no ' + t + ' card exercised');
  assert.ok(cards.some(c => /^(Won|Lost) \d+ straight vs Big Server \+ /.test(c.claim)), 'a "N straight vs Big Server + …" claim');
});

// ── round 2 fix 6 · Level is ATP / Challenger only ──────────────────────────────────────────────────────────────
test('Fix 6: only ATP / Challenger fixtures reach Series — an ITF fixture is never a card (engine tierOf, page tier guard)', async () => {
  delete require.cache[require.resolve(ENGINE)];
  const E = require(ENGINE);
  assert.equal(E.tierOf({ event_type_type: 'Atp Singles' }), 'tour');
  assert.equal(E.tierOf({ event_type_type: 'Challenger Men Singles' }), 'chal');
  for (const t of ['Itf Men Singles', 'Itf Women Singles', 'Wta Singles', 'Atp Doubles', '']) assert.equal(E.tierOf({ event_type_type: t }), null, t + ' must not reach the slate');
  const b = await start({ edit: f => { f.series.players.find(p => p.name === 'A. Kachmazov').tier = 'itf'; } });
  b.seg('minLen', '3'); b.played(true);
  assert.ok(b.view().length > 0 && !b.view().some(c => c.player.name === 'A. Kachmazov'), 'a non-ATP / Challenger tier must not paint a card');
  // Wuning 3 (Kachmazov v Hara Friend) is a Challenger (event_type_type "Challenger Men Singles"): its card stays, named by sfEventName
  const b2 = await start();
  b2.seg('minLen', '3');
  const k = b2.view().find(c => c.player.name === 'A. Kachmazov');
  assert.ok(k && k.player.tier === 'chal' && k.slot.event === 'Wuning 3', 'the Challenger card keeps its canonical / cleaned event');
});

// ── Header ────────────────────────────────────────────────────────────────────────────────────────────────────────
test('Header: shared .sfh, the ticket sentence, Streaks · Players · Longest run (white) · Updated = generatedAt HH:MM in stennisfy.tz', async () => {
  const b = await start();
  const page = b.html(), view = b.view();
  assert.match(page, /<div class="sfh sr-head"><div class="sfh__text"><h1 class="sfh__title">Series<\/h1><p class="sfh__sub">Current streaks for players scheduled today and tomorrow, each with the pool it was drawn from and the date of its latest match\.<\/p>/);
  assert.equal(stat(page, 'Streaks').v, String(view.length));
  assert.equal(stat(page, 'Players').v, String(new Set(view.map(c => String(c.player.key))).size));
  const lr = stat(page, 'Longest run');
  assert.equal(lr.v, String(Math.max(...view.map(c => c.streak.count))));
  assert.equal(lr.cls, '', 'Longest run must be the white value, not a grey / blue class');
  const want = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(b.fix.series.generatedAt));
  assert.equal(stat(page, 'Updated').v, want, 'Updated is not generatedAt in the member zone');
  assert.notEqual(want, new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(b.fix.series.generatedAt)), 'the zone must matter here');
  // stats follow the filters; an empty view reads a grey dash for Longest run
  b.seg('minLen', '8'); b.seg('dir', 'loss'); b.tab('handicap');
  const p2 = b.html();
  assert.equal(stat(p2, 'Streaks').v, '0');
  assert.deepEqual(stat(p2, 'Longest run'), { cls: ' sfh__v--none', v: '—' });
  // Updated is never the clock: an artifact with no generatedAt reads a dash
  const b5 = await start({ edit: f => { delete f.series.generatedAt; } });
  assert.deepEqual(stat(b5.html(), 'Updated'), { cls: ' sfh__v--none', v: '—' });
});

// ── Filters 1c: the Type tab row counts, segmented controls ──────────────────────────────────────────────────────
test('Filters: the Type tab counts follow every other filter, ignore Type, and All = the sum', async () => {
  const b = await start();
  b.seg('minLen', '3');
  const counts = () => Object.fromEntries([...b.html().matchAll(/data-type="([\w-]+)">[^<]*<span class="sr-tab-n">(\d+)</g)].map(m => [m[1], +m[2]]));
  const c = counts();
  assert.equal(c.all, b.view().length, 'All = the cards in view');
  assert.equal(['all-comp', 'surface', 'style', 'total', 'handicap', 'setout', 'setgames'].reduce((s, k) => s + c[k], 0), c.all, 'the families sum to All');
  b.tab('style');
  assert.equal(b.view().length, c.style, 'the Vs style tab shows its count');
  assert.deepEqual(counts(), c, 'counts must not change with the Type tab');
  b.tab('all');
  b.seg('level', 'chal');
  assert.equal(counts().style, 0, 'counts follow Level: no Challenger vs-style runs exist (tour only)');
  assert.match(b.html(), /<button type="button" class="sr-tab active" role="tab" aria-selected="true" data-type="all">All<span class="sr-tab-n">/);
  assert.match(b.html(), /class="sr-segbtn active" aria-pressed="true" data-val="chal">Challenger</);
});

// ── card 2b ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('Card 2b: the photo by player ID over the initials, name + mono rank, count tile, claim + "type · direction", Started / Last / Avg price; no colour', async () => {
  const b = await start();
  const page = b.html();
  assert.ok(!/randomuser|photoCandidatesFor|resolveProfilePhotoUrl|avatarChainNext|photoOverrideFor/.test(page + SRC), 'a retired photo source is back');
  const avas = [...page.matchAll(/<span class="sr-ava">([^<]*)(<img [^>]*>)?<\/span>/g)];
  assert.ok(avas.length > 0 && avas.some(a => a[2]) && avas.every(a => !a[2] || /^<img class="sf-ph" data-k="\d*[02468]"/.test(a[2])), 'the photo by player ID over the initials');   // mutant: photo gone
  assert.equal((page.match(/<img /g) || []).length, avas.filter(a => a[2]).length, 'every <img> is an avatar photo');
  const fhIni = vm.runInContext('fhIni', b.ctx), nm = vm.runInContext('newsPlayerName', b.ctx);
  const cards = cardsOf(page), view = b.view();
  const DIR = { win: 'Winning run', loss: 'Losing run', neutral: 'Neutral' };
  cards.forEach((c, i) => {
    const v = view[i], name = nm(v.player.key, v.player.name);
    assert.equal(c.name, name.replace(/'/g, '&#39;'));
    assert.equal(c.ava, fhIni(name));
    assert.equal(c.rank, v.player.rank != null ? '#' + v.player.rank : '—');
    assert.equal(c.count, String(v.streak.count));
    assert.deepEqual(c.rows.map(r => r[0]), ['Started', 'Last', 'Avg price']);
    const ms = v.streak.matches, first = ms[0].date.split('-'), last = v.streak.lastDate.split('-');
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    assert.equal(c.rows[0][1], (+first[2]) + ' ' + MON[+first[1] - 1] + ' ' + first[0], 'Started carries its year');
    assert.equal(c.rows[1][1], (+last[2]) + ' ' + MON[+last[1] - 1], 'Last is day + month');
    assert.match(c.sub, /^(All comps|Surface|Vs style|Total games|Handicap|Set outcome|Set games) · (Winning run|Losing run|Neutral)$/);
    const val = v.streak.type === 'total' || v.streak.type === 'handicap' || (v.streak.type === 'setpat' && (v.streak.firstSet || v.streak.subtype === 'went-the-distance')) ? 'neutral' : v.streak.direction;
    assert.ok(c.sub.endsWith(DIR[val]), 'direction word wrong on ' + c.name);
    assert.ok(!/\bsr-w\b|\bsr-l\b|--pos|--neg/.test(c.raw), 'green / red on a card');
    assert.ok(!/History/.test(c.raw), 'the History link is back');
    assert.match(c.raw, /^ sr-has-detail" data-count="\d+" role="button" tabindex="0" aria-haspopup="dialog"/, 'the whole card opens the pop-up');
  });
});

// ── Data 5 · prices: the one Database join; single source ────────────────────────────────────────────────────────
test('Data 5: Home / Away = the Database join (Pinnacle closing, else Bet365); the card Avg price and the ledger read the same rows', async () => {
  const b = await start();
  b.seg('minLen', '3');
  b.played(true);   // every card on the slate, started / finished included
  const view = b.view(), cards = cardsOf(b.html());
  let sawLoss = false;
  let priced = 0, unpricedRows = 0, sawMixed = false, sawLine = false;
  view.forEach((v, i) => {
    const pop = b.popup(i), L = ledgerOf(pop);
    assert.equal(L.length, v.streak.count, 'ledger row count = the count');
    const homes = L.map(r => r.home).filter(x => x !== '—');
    const ap = cards[i].rows[2][1];
    if (homes.length) {
      const want = (Math.round(homes.reduce((s, x) => s + cents(+x), 0) / homes.length) / 100).toFixed(2);
      assert.equal(ap, want, 'Avg price is not the mean of the ledger Home prices for ' + v.player.name);
      priced++;
    } else assert.equal(ap, '—', 'an unpriced card must read a dash');
    unpricedRows += L.length - homes.length;
    if (homes.length && homes.length < L.length) sawMixed = true;
    assert.match(pop, new RegExp('<span class="sr-ov-total-k">' + homes.length + ' priced</span>'), '"{n} priced" label');
    // every printed price is the join's answer for that row, 2 dp; Away beside it; no join answer → dash
    const A = b.fix.join[v.player.key] || [];
    v.streak.matches.slice().reverse().forEach((m, j) => {
      const a = A.find(x => x[0] === m.date && x[1] === (m.opponent || '') && !!x[2] === !!m.won);
      assert.equal(L[j].home, a ? a[3].toFixed(2) : '—', 'Home price row ' + j + ' of ' + v.player.name);
      assert.equal(L[j].away, a ? a[4].toFixed(2) : '—', 'Away price row ' + j);
      assert.equal(L[j].score, (m.score || '—').replace(/(\d)-(\d)/g, '$1–$2'), 'score with en dashes');
    });
    const isResult = ['all', 'surface', 'style'].includes(v.streak.type);
    if (!isResult) { sawLine = true; L.forEach(r => assert.equal(r.pl, '', 'a line / set family must leave P&L blank')); return; }
    // ledger: win = price − 1 rounded, loss = −1.00; total = sum of the rounded rows; yield = total ÷ priced
    let tc = 0, n = 0;
    L.forEach(r => {
      if (r.home === '—') { assert.equal(r.pl, '—'); return; }
      n++;
      const u = r.res === 'W' ? cents(+r.home) - 100 : -100;
      tc += u;
      assert.equal(r.pl, (u > 0 ? '+' : u < 0 ? '−' : '') + Math.abs(u / 100).toFixed(2), 'row P&L (true minus, 2 dp)');
      assert.equal(r.plCls, u >= 0 ? 'sr-w' : 'sr-l', 'P&L colour');
      if (u < 0) sawLoss = true;
    });
    if (n) {
      const tot = (tc > 0 ? '+' : tc < 0 ? '−' : '') + Math.abs(tc / 100).toFixed(2) + 'u';
      const y10 = 10 * tc / n, y = (y10 < 0 ? -Math.round(-y10) : Math.round(y10)) / 10;   // half away from zero
      assert.match(pop, new RegExp('<span class="sr-ov-total-v (sr-w|sr-l|)">' + tot.replace('+', '\\+') + '</span><span class="sr-ov-total-y [^"]*">' + ((y > 0 ? '\\+' : y < 0 ? '−' : '') + Math.abs(y).toFixed(1)) + '%</span>'), 'total / yield of ' + v.player.name);
    }
  });
  assert.ok(priced > 0 && sawMixed && sawLine && sawLoss, `the fixture must exercise priced, partly priced, line and losing ledger rows (${priced}, ${sawMixed}, ${sawLine}, ${sawLoss})`);
  assert.ok(unpricedRows > 0, 'unpriced rows must exist');
  // the books: what the join hands back is named in house style
  const books = new Set(Object.values(b.fix.join).flat().map(x => x[5]));
  assert.ok([...books].every(x => x === 'P' || x === 'B'), 'the join answers in its own letters');
  // a failed join: dashes stay honest and the total says so
  const bf = await start({ joinFails: true });
  assert.match(bf.popup(0), /Prices unavailable/);
  assert.ok(cardsOf(bf.html()).every(c => c.rows[2][1] === '—'));
});

test('Data 5: a failed join says "Prices unavailable" on the card too, and is retried on the next show after 2 min', async () => {
  const b = await start({ joinFails: true });
  const cards = cardsOf(b.html());
  assert.ok(cards.length > 0 && cards.every(c => /<span class="sr-dash" title="Prices unavailable">—<\/span>/.test(c.raw)), 'the card\'s Avg price must say what the pop-up says');
  b.opts.joinFails = false;
  b.clock.t += 60000;
  await b.show();
  assert.equal(b.ctx.window.SeriesPage._pxState(), 'failed', 'no retry inside 2 min');
  b.clock.t += 90000;
  await b.show();
  assert.equal(b.ctx.window.SeriesPage._pxState(), 'ready', 'a failed join must be tried again on the next show after 2 min');
  assert.ok(b.ctx.__joinCalls.length > 0 && cardsOf(b.html()).some(c => /^\d+\.\d\d$/.test(c.rows[2][1])), 'the retried join prices the cards');
  assert.ok(!/title="Prices unavailable"/.test(b.html()), 'no "unavailable" once priced');
});

test('Data 5: a negative yield rounds half away from zero (−72.75% prints −72.8%)', async () => {
  const b0 = await start();
  b0.seg('minLen', '3'); b0.played(true);
  const v = b0.view().find(x => ['all', 'surface', 'style'].includes(x.streak.type) && x.streak.matches.length >= 4);
  assert.ok(v, 'a match-result card with 4+ rows');
  const pk = v.player.key, si = v.player.streaks.findIndex(s => s.type === v.streak.type && s.subtype === v.streak.subtype && s.count === v.streak.count && s.lastDate === v.streak.lastDate);
  const b = await start({ edit: fix => {
    const st = fix.series.players.find(p => p.key === pk).streaks[si];
    const ms = st.matches.slice(0, 4);
    ms.forEach((m, i) => { m.won = i === 0; });
    // one win at 1.09 and three losses: (9 − 300) cents over 4 priced rows = −72.75%
    fix.join[pk] = ms.map((m, i) => [m.date, m.opponent || '', i === 0, i === 0 ? 1.09 : 2.5, i === 0 ? 8 : 1.5, 'P']);
  } });
  b.seg('minLen', '3'); b.played(true);
  const i = b.view().findIndex(x => x.player.key === pk && x.streak.type === v.streak.type && x.streak.count === v.streak.count && x.streak.lastDate === v.streak.lastDate);
  assert.ok(i >= 0);
  assert.match(b.popup(i), /<span class="sr-ov-total-y [^"]*">−72\.8%<\/span>/, 'a negative yield must round half away from zero');
});

test('Slate: slots are recomputed on every page show and on the 5-minute tick; series.json is refetched once older than 15 min', async () => {
  const b = await start();
  const fetches = b.fetched.series;
  assert.equal(fetches, 1);
  // a board match goes live while the page is open: the next show takes the card off the default (not-played) view
  const v = b.view().find(x => x.slot.board && !x.slot.played);
  assert.ok(v, 'a not-yet-started board card');
  const ek = String(v.player.upcoming.eventKey);
  const bm = b.fix.board.find(m => String(m.id || '').replace(/^\D+-/, '') === ek);
  bm.live = true;
  b.clock.t += 60000;
  await b.show();
  assert.ok(!b.view().some(x => x.player.key === v.player.key && x.slot.board && String(x.player.upcoming.eventKey) === ek), 'a page show must recompute already-played');
  assert.equal(b.fetched.series, fetches, 'no refetch inside 15 min');
  // the day turns while the page stays shown: the 5-minute tick moves every card off the slate
  b.clock.t += 3 * 86400000;
  await b.tick();
  assert.equal(b.view().length, 0, 'the 5-minute tick must recompute the day word / slate');
  assert.match(b.html(), /No streaks match these filters\./);
  // a show once the loaded copy is older than 15 min refetches series.json (Updated stays its generatedAt)
  await b.show();
  assert.equal(b.fetched.series, fetches + 1, 'series.json must be refetched past 15 min');
  const upd = (b.html().match(/<span class="sfh__l">Updated<\/span><span class="sfh__v[^"]*">([^<]*)</) || [])[1];
  const want = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.parse(b.fix.series.generatedAt)));
  assert.equal(upd, want, 'Updated = generatedAt, never the clock');
});

test('Data 5: an unpriced row after the archive\'s last date carries the shared reason on hover', async () => {
  const b = await start();
  const i = b.view().findIndex(v => v.streak.matches.some(m => m.date > b.fix.dbEnd));
  const pop = b.popup(i);
  assert.match(pop, /title="After the Database archive’s last match \(13 Sep 2026\): no closing price on record yet"><span class="sr-dash">—<\/span>/);
});

// ── pop-up header (Count tile) ─────────────────────────────────────────────────────────────────────────────────────
test('Pop-up: Count tile header (count, "in a row"), name + claim, rank · {count} of {pool} matches; the site close button', async () => {
  const b = await start();
  const v = b.view()[0], pop = b.popup(0);
  assert.match(pop, new RegExp('^<div class="sr-ov-head"><span class="sr-ov-tile"><span class="sr-ov-tile-n">' + v.streak.count + '</span><span class="sr-ov-tile-k">in a row</span></span>'));
  assert.match(pop, new RegExp('<span class="sr-ov-sub">#' + v.player.rank + ' · ' + v.streak.count + ' of ' + v.streak.pool + ' matches'));
  assert.match(pop, /<button class="sr-ov-close" type="button" aria-label="Close">✕<\/button>/);
  assert.match(pop, /<div class="sr-mhead"><span class="sr-mres"><\/span><span class="sr-mdate">Date<\/span><span class="sr-mtour">Event<\/span><span class="sr-mopp">Opponent<\/span><span class="sr-mscore">Score<\/span><span class="sr-mp1">Home<\/span><span class="sr-mp2">Away<\/span><span class="sr-mpl">P&amp;L<\/span><\/div>/);
});

// ── copy: footnote + empty state ─────────────────────────────────────────────────────────────────────────────────
test('Copy: the footnote = the reference form (tag-row sentence; the engine rules line, mono, with the data date); the empty state + Clear resets every filter', async () => {
  const b = await start();
  // round 3 item 1 (SUPERSEDES round 2's "no data stamp" sentence form): line 1 = the reference sentence + prices;
  // line 2 = the engine's real values from series.json rules, `·` separated, ending with the build date
  const FOOT = /<div class="sr-footnote"><p>Direction shows as a word in the tag row — <span class="sr-fn-w">Winning run<\/span>, <span class="sr-fn-w">Losing run<\/span>, <span class="sr-fn-w">Neutral<\/span>\. Betting lines \(over\/under, handicap\) and set-shape volatility are a direction, not good or bad\.<br>Prices are closing prices, flat 1 unit per match\.<\/p><p class="sr-fn-rules">runs 3\+ · one card per player per family · recency cap 45d \(Grand Slams exempt\) · a gap over 75d ends a run · pool floor 8 for surface, style, set and line runs · data 2026-10-10<\/p><\/div>$/;
  assert.match(b.html(), FOOT);
  // the rules line is the engine's values once, the same in every filter state (no filter state)
  const foot = () => b.html().slice(b.html().indexOf('<div class="sr-footnote">'));
  const f0 = foot();
  b.seg('minLen', '8'); assert.equal(foot(), f0, 'the rules line follows the Min length chip');
  b.seg('minLen', '3'); b.seg('level', 'chal'); b.played(true); assert.equal(foot(), f0, 'the rules line follows a filter');
  b.seg('minLen', '6'); b.seg('level', 'all'); b.played(false);
  const b9 = await start({ edit: f => { Object.assign(f.series.rules, { maxAgeDays: 44, minPoolConditional: 9, minLen: 4, maxGapDays: 70, onePerFamily: false, slamAgeExempt: false }); f.series.generatedAt = '2026-10-11T02:00:00Z'; } });
  assert.match(b9.html(), /<p class="sr-fn-rules">runs 4\+ · recency cap 44d · a gap over 70d ends a run · pool floor 9 for surface, style, set and line runs · data 2026-10-10<\/p>/, 'the values are read from series.json rules; the date is generatedAt in stennisfy.tz (02:00Z = 10 Oct in New York)');
  const b0 = await start({ edit: f => { delete f.series.generatedAt; } });
  assert.match(b0.html(), / · data —<\/p><\/div>$/, 'no generatedAt: the date is a dash, never the clock');
  assert.ok(!/How to read|Every family counts/.test(b.html()), 'the old footer or the round 2 sentence form is back');
  const before = b.view().length;
  b.seg('minLen', '8'); b.seg('dir', 'loss'); b.tab('handicap');
  assert.equal(b.view().length, 0);
  assert.match(b.html(), /<div class="sr-empty"><span>No streaks match these filters\.<\/span><button type="button" class="sr-clear" data-clear="1">Clear<\/button><\/div>/);
  b.clear();
  assert.equal(b.view().length, before, 'Clear must restore the default view');
});

// ── colour (CSS) ──────────────────────────────────────────────────────────────────────────────────────────────────
test('Colour: no blue fills / rings; links #6A9AF8 only on Clear; green / red only on the pop-up marks, P&L and total; card tone, no outline, radius 16', () => {
  const rule = sel => { const i = CSS.indexOf(sel + ' {'); assert.ok(i >= 0, sel); return CSS.slice(i, CSS.indexOf('}', i)); };
  assert.ok(!/--bar\b|--viz-lead|--hot-dot|--open-card|--pro\b/.test(CSS), 'a blue token is used');
  const links = [...CSS.matchAll(/([^{}]+)\{[^}]*var\(--link\)/g)].map(m => m[1].trim());
  assert.deepEqual(links, ['[data-page="series"] .sr-clear'], 'links: ' + JSON.stringify(links));
  const signed = [...CSS.matchAll(/([^{}]+)\{[^}]*var\(--(pos|neg)\)/g)].map(m => m[1].trim());
  assert.ok(signed.length >= 2 && signed.every(s => /^\.sr-ov/.test(s) && /sr-w|sr-l/.test(s)), 'green / red outside the pop-up marks / P&L / total: ' + JSON.stringify(signed));
  const card = rule('[data-page="series"] .sr-card');
  assert.match(card, /background: var\(--card\)/); assert.match(card, /border: 1px solid transparent/); assert.match(card, /border-radius: 16px/);
  assert.match(rule('[data-page="series"] .sr-card.sr-has-detail:hover'), /border-color: var\(--edge-16\)/);
  assert.match(rule('[data-page="series"] .sr-row'), /border-top: 1px solid var\(--edge-6\)/);
  assert.match(rule('[data-page="series"] .sr-seg'), /background: var\(--inner\); border-radius: 10px; padding: 3px/);
  assert.match(rule('[data-page="series"] .sr-segbtn.active'), /background: var\(--selected\); border-color: var\(--edge-16\); color: var\(--text\); font-weight: 700/);
  assert.match(rule('[data-page="series"] .sr-tab.active'), /color: var\(--text\); font-weight: 700; border-bottom-color: var\(--text\)/);
  assert.match(rule('[data-page="series"] .sr-toggle input:checked + .sr-box'), /background: var\(--text\)/);
  assert.match(rule('[data-page="series"] .sr-box'), /border: 1px solid color-mix\(in srgb, var\(--text\) 18%, transparent\)/);
  assert.match(rule('[data-page="series"] .sr-tile'), /background: var\(--inner\)/);
  // round 3 item 2: the Next line = the reference's (one line, Hanken 12.5 soft grey); the time in the line's own face —
  // no mono / white rule of its own; the event never carries an ellipsis (it is dropped whole); cards equal height
  assert.match(rule('[data-page="series"] .sr-next'), /display: block; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12.5px; color: var\(--text-soft\);/);
  assert.ok(!/\.sr-next-t\b|\.sr-next-ev\b/.test(CSS), 'the time or the event has a face / overflow rule of its own');
  // round 3 item 1: the footnote = the reference's (12.5 grey sentence, soft direction words, mono 11.5 rules line)
  assert.match(rule('[data-page="series"] .sr-footnote'), /gap: 10px; padding-top: 18px; border-top: 1px solid var\(--line\);/);
  assert.match(rule('[data-page="series"] .sr-footnote p'), /max-width: 1130px; font-size: 12\.5px; line-height: 1\.6; color: var\(--text-label\);/);
  assert.match(rule('[data-page="series"] .sr-footnote .sr-fn-w'), /color: var\(--text-soft\);/);
  assert.match(rule('[data-page="series"] .sr-footnote .sr-fn-rules'), /font-family: var\(--font-nums\); font-size: 11\.5px; line-height: 1\.7;/);
  assert.match(rule('[data-page="series"] .sr-cards'), /align-items: stretch;/);
  assert.match(rule('[data-page="series"] .sr-rows'), /margin-top: auto;/);
  const ov = rule('.sr-ov');
  assert.match(ov, /border: 1px solid var\(--edge-10\); border-radius: 16px/);
  assert.match(ov, /box-shadow: 0 30px 80px /);
  assert.match(rule('.sr-ov-back'), /background: color-mix\(in srgb, var\(--page\) 62%, transparent\)/);
});

// ── Data 1 / 8: nothing seeded ────────────────────────────────────────────────────────────────────────────────────
test('Data 1: no demo data on the page (CARDS / DATES / EVENTS / OPPS / SCORES / seeded prices / randomuser)', () => {
  assert.ok(!/\bCARDS\b|\bDATES\b|\bOPPS\b|SCORES_W|SCORES_L|\bSEED\(|randomuser|seriesRows\(/.test(SRC + CSS), 'design-file demo data reached the page');
});

// ── generator · retirements count, walkovers don't; vs style = the step 9 classifier store ─────────────────────────
test('Generator: a retirement counts (won by the player the feed credits), a walkover never; Vs style = playing-styles.json archetype_label', () => {
  delete require.cache[require.resolve(ENGINE)];
  const E = require(ENGINE);
  const fx = (status, winner, scores) => ({ event_type_type: 'Atp Singles', event_status: status, first_player_key: '1', second_player_key: '2',
    event_first_player: 'A. One', event_second_player: 'B. Two', event_winner: winner, event_date: '2026-09-01', event_key: '9',
    tournament_key: '0', tournament_name: 'Test Open', scores });
  const set = (n, a, b) => ({ score_set: String(n), score_first: String(a), score_second: String(b) });
  const ret = E.recordFor(fx('Retired', 'First Player', [set(1, 6, 4), set(2, 2, 1)]), '1', 'tour', {}, new Map(), true);
  assert.ok(ret && ret.won === true, 'a retirement win must count as a win');
  assert.equal(ret.totalGames, null, 'a retirement stays out of the games lines');
  assert.equal(E.recordFor(fx('Retired', 'First Player', [set(1, 6, 4), set(2, 2, 1)]), '2', 'tour', {}, new Map(), true).won, false, 'the retiree loses');
  assert.equal(E.recordFor(fx('Walk Over', 'First Player', []), '1', 'tour', {}, new Map(), true), null, 'a walkover must never count');
  assert.equal(E.recordFor(fx('Retired', 'First Player', []), '1', 'tour', {}, new Map(), true), null, 'a retirement before a game is not a match');
  assert.ok(E.recordFor(fx('Finished', 'Second Player', [set(1, 4, 6), set(2, 3, 6)]), '1', 'tour', {}, new Map(), true), 'a finished match counts');
  // a Slam retirement at a set break (best of 5): the winner's set count must not type it best-of-3
  const slam = (scores) => Object.assign(fx('Retired', 'First Player', scores), { tournament_name: 'US Open' });
  for (const [label, scores] of [['6-3 6-2 ret', [set(1, 6, 3), set(2, 6, 2)]], ['6-3 3-6 6-4 ret', [set(1, 6, 3), set(2, 3, 6), set(3, 6, 4)]]]) {
    for (const pk of ['1', '2']) {
      const r = E.recordFor(slam(scores), pk, 'tour', {}, new Map(), true);
      assert.ok(r && r.won === (pk === '1'), label + ': the retirement counts as won / lost');
      assert.equal(r.complete, false, label + ': a retirement is never complete');
      assert.equal(r.bestOf, null, label + ': a retirement carries no best-of (else it enters the bo3 pools and calibration)');
      for (const k of ['totalGames', 'gameMargin', 'straightResult', 'wentDistance', 'wonASet']) assert.equal(r[k], null, label + ': ' + k + ' must stay out');
      assert.equal(r.lostSet1, pk !== '1', label + ': the completed opening set still counts');
    }
  }
  const fin = E.recordFor(Object.assign(fx('Finished', 'First Player', [set(1, 6, 3), set(2, 6, 2), set(3, 6, 1)]), { tournament_name: 'US Open' }), '1', 'tour', {}, new Map(), true);
  assert.ok(fin.complete === true && fin.bestOf === 5 && fin.straightResult === true && fin.totalGames === 24, 'a finished Slam match is typed best-of-5');
  // vs style: the step 9 classifier's own store (playing-styles.json archetype_label), the label Playing Styles prints
  const styles = JSON.parse(readFileSync(join(HERE, 'playing-styles.json'), 'utf8')).players;
  const m = E.loadStyleMap();
  const p = styles.find(x => x && x.name && x.archetype_label);
  assert.equal(m.get(p.name.toLowerCase().replace(/\s+/g, ' ').trim()), p.archetype_label);
  const EIGHT = ['Big Server', 'Big Server + First Strike', 'Big Server + Complete Baseliner', 'Attacking Baseliner', 'Solid Baseliner', 'Counterpuncher', 'Solid Defender', 'All Court Elite'];
  assert.ok([...m.values()].every(l => EIGHT.includes(l)), 'a vs-style label outside the classifier\'s eight');
  // the board's vs-style cards print those labels
  const live = FIX.series.players.flatMap(x => x.streaks).filter(s => s.type === 'style');
  assert.ok(live.length > 0 && live.every(s => EIGHT.includes(s.subtype)), 'a vs-style card label outside the eight');
});
