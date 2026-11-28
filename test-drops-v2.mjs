// Dropping Odds — final design (handoff design_handoff_dropping_odds_final_2026-11-27, LOCKED; founder rulings 2026-11-28)
// on the v2 model (sharp vs soft, founder 2026-11-23). The desktop page and the price history box are the design file's
// markup, compiled into drops-page.js (dc/compile.mjs: dcDesk / dcDrawer) and filled by the ported view logic
// (pageVals / drawerVals); the phone list keeps the v2 layout (the final days changed desktop only, README §7).
// Executed on a frozen slice of the real drops feed (tools/fixtures/drops-v2.json, captured 23 Nov 2026) plus one
// synthetic ATP selection with a board card and a Pinnacle chart. Rules: .claude/rules/drops.md.
// Mutants: tools/test-drops-v2-mutants.js (DROPSV2_SRC / DROPSV2_CSS swap in a mutated copy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const read = (f) => fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8');
const SRC = process.env.DROPSV2_SRC ? fs.readFileSync(process.env.DROPSV2_SRC, 'utf8') : read('drops-page.js');
const CSS = process.env.DROPSV2_CSS ? fs.readFileSync(process.env.DROPSV2_CSS, 'utf8') : read('drops-page.css');
const FIX = JSON.parse(read('tools/fixtures/drops-v2.json'));
const NOW = Date.parse(FIX.now);
const H = 3600e3;
const M = (() => { const mod = { exports: {} }; vm.runInNewContext(SRC, { module: mod, Intl, Date, Math, JSON, String, Number, Object, Array, isFinite, parseFloat, RegExp }); return mod.exports; })();

// the synthetic ATP selection: Alan Alpha v Bruno Beta, Pinnacle 2.12 -> 1.46 on the board card (README's own example)
const iso = (h) => new Date(NOW - h * H).toISOString();
const ATP_ROW = { id: 'syn-1', book: 'Bet105', line: 'Match Winner', tier: 'ATP', playerA: 'Alan Alpha', playerB: 'Bruno Beta', side: 'Alan Alpha',
  open: { at: iso(20), price: '2.15' }, latest: { at: iso(2), price: '1.47' }, detectedAt: iso(2), scheduledStart: iso(-6),
  match: { status: 'not_started', eventKey: '999' } };
const ATP_LINE = { key: 'alpha|beta|alpha', playerA: 'Alan Alpha', playerB: 'Bruno Beta', side: 'Alan Alpha', books: {
  Bet105: { side: [[iso(20), 2.15], [iso(6), 1.8], [iso(2), 1.47]], other: [[iso(20), 1.7], [iso(2), 2.7]], lastSeen: iso(0.1) },
  Superbet: { side: [[iso(30), 2.1], [iso(3), 1.5]], other: [], lastSeen: iso(0.1) } } };
const CARD = { id: 'upcoming-999', p1: 'A. Alpha', p2: 'B. Beta', p1Key: 11, p2Key: 22, date: new Date(NOW).toISOString().slice(0, 10), tour: 'ATP Testville', tournamentRound: 'Quarter-finals' };
const CHART = { books: { 'Pinnacle +30s': { p1: [[iso(22), 2.12], [iso(8), 1.9], [iso(4), 1.46]], p2: [[iso(22), 1.8], [iso(4), 2.85]] } },
  meta: { 'Pinnacle +30s': { source: 'Oddspapi', checkedAt: iso(0.2) } } };

function boot({ rows = FIX.rows.concat([ATP_ROW]), lines = FIX.lines.concat([ATP_LINE]), ageS = 10, reachable = true, tz = 'UTC', board = [CARD], width = 1440, archive = null } = {}) {
  const mk = () => { const o = { _h: '', _l: {}, addEventListener(t, f) { (o._l[t] = o._l[t] || []).push(f); }, contains: () => false, querySelectorAll: () => [], querySelector: () => null,
    closest: () => ({ classList: { contains: () => true } }) }; Object.defineProperty(o, 'innerHTML', { get: () => o._h, set: (v) => { o._h = v; } }); return o; };
  const root = mk(), ov = mk(); ov.remove = () => { mounted = false; };
  let mounted = false; const timers = []; const winL = {};
  const status = { generatedAt: new Date(NOW - ageS * 1000).toISOString(), serverNow: new Date(NOW).toISOString(), ageS };
  const res = (b) => ({ status: 200, ok: true, headers: { get: () => '"e"' }, json: async () => b });
  class FD extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } }
  const sb = {
    document: { readyState: 'complete', activeElement: null, querySelector: () => null, addEventListener() {}, head: { appendChild() {} },
      getElementById: (id) => (id === 'dropsRoot' ? root : id === 'do3Overlay' ? (mounted ? ov : null) : id === 'dropsTabBtn' ? { style: {} } : null),
      body: { appendChild: () => { mounted = true; } }, createElement: (t) => (t === 'style' ? {} : ov) },
    location: { search: '' }, URLSearchParams, Intl, Date: FD, Promise, JSON, Math, String, Number, Object, Array, isFinite, parseFloat, RegExp, Error,
    localStorage: { getItem: () => null }, newsTz: () => tz, matches: board, roundBadgeText: (r) => (r === 'Quarter-finals' ? 'QF' : r),
    cardStartMs: () => NOW + 6 * H, openAnalysisModal: (id) => { sb._opened = id; }, requestAnimationFrame: (f) => f(), innerWidth: width, scrollTo() {},
    newsPlayerName: (k, n) => ({ 11: 'A. Alpha-Profile', 22: 'B. Beta-Profile' }[k] || n), sfEventName: (raw) => (raw === 'ATP Testville' ? 'Testville Open' : raw),
    playerPhotoImg: (k, n) => '<img class="sf-ph" data-key="' + k + '" alt="' + n + '">',
    ensureOddsMovement: async (m) => { m._oddsLoaded = true; m.oddsMovement = { chart: CHART }; },
    fetch: async (u) => { if (!reachable) throw new Error('down'); if (String(u).endsWith('/archive.json')) { if (!archive) throw new Error('no archive'); return res(archive); }
      return res(String(u).endsWith('/status.json') ? status : { schema: 1, windowHours: 72, rows, lines }); },
    setTimeout: (f, ms) => { timers.push(ms); return timers.length; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    addEventListener: (t, f) => { winL[t] = f; },
  };
  sb.window = sb;
  vm.runInNewContext(SRC, sb);
  const D = sb.DropsPage, flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
  const act = async (a, v) => { const el = { getAttribute: (k) => (k === 'data-act' ? a : k === 'data-v' ? (v == null ? null : String(v)) : null) };
    root._l.click.forEach((f) => f({ target: { closest: () => el }, stopPropagation() {}, preventDefault() {} })); await flush(); };
  const ev = { stopPropagation() {}, preventDefault() {}, currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 1000 }) } };
  return { D, st: D._state, root, ov, timers, flush, act, sb, winL, ev,
    start: async () => { D.setActive(true); await flush(); D._state.metaSig = null; D.setActive(true); await flush(); return root.innerHTML; } };
}
const sel = (st, re) => st.sels.find((s) => re.test(s.side));
const kinds = (list, btype) => list.map((s) => { const c = M.calc(s.bk); return btype === 'soft' ? c.soft.r : c.sharp; });

test('readings: every %, implied and pts figure from the two prices shown (README rd)', () => {
  const a = M.rd(2.12, 1.46), b = M.rd(5.30, 3.65);
  assert.deepEqual([a.kind, a.d, a.io, a.inn, a.pts], ['drop', 31.1, 47.2, 68.5, 21.3]);
  assert.deepEqual([b.kind, b.d, b.io, b.inn, b.pts], ['drop', 31.1, 18.9, 27.4, 8.5]);
  assert.equal(M.rd(1.423, 1.33).d, M.rd(1.42, 1.33).d, 'computed on the 2 dp prices printed');
  assert.equal(M.rd(2.5, 2.5).kind, 'flat'); assert.equal(M.rd(2.4, 2.6).kind, 'up');
  assert.equal(M.rd(null, 1.58).kind, 'one'); assert.equal(M.rd(null, null).kind, 'none');
});

test('soft reading: the average of soft books with two prices, "n of m soft books down"; prediction markets are never soft', () => {
  const c = M.calc({ Superbet: { first: 4.05, now: 2.92 }, 'Napoleon Sports BE': { first: 4.10, now: 2.90 }, Bet105: { first: 4.0, now: 3.1 }, Polymarket: { first: 4.2, now: 3.3 } });
  assert.equal(c.soft.lead, 'avg'); assert.equal(c.soft.r.o, 4.08); assert.equal(c.soft.r.n, 2.91); assert.equal(c.soft.quotes, 2);
  assert.equal(M.softCount(c), '2 of 2 soft books down'); assert.equal(c.sharp.kind, 'none', 'never the soft figure in the sharp slot');
  assert.equal(c.best.book, 'Polymarket', 'best now across every quoting book and market (the file\'s allNames)');
  assert.equal(JSON.stringify(M.PRED_BOOKS.map((b) => b[0])), '["Polymarket","Kalshi"]');
});

test('selections: one per match side from the endpoint lines; the side\'s own line wins; roster books only; 24 h quoting; nothing at or after the cut', () => {
  const s = M.buildSelections(FIX.lines, FIX.rows, NOW);
  const ids = new Set(s.map((x) => x.id)); assert.equal(ids.size, s.length, 'one row per selection');
  const v = s.find((x) => /Villanueva/.test(x.side)), o = s.find((x) => /Alcala/.test(x.side));
  assert.ok(v && o, 'both sides of the match'); assert.notDeepEqual(v.bk.Superbet.series, o.bk.Superbet.series);
  assert.ok(s.every((x) => Object.keys(x.bk).every((b) => b === '_b105nm' || M.BOOK_NAMES3().includes(b))), 'only books the page has a source for');
  const old = { ...ATP_LINE, books: { Bet105: { ...ATP_LINE.books.Bet105, lastSeen: iso(25) } } };
  assert.equal(Object.keys(M.buildSelections([old], [ATP_ROW], NOW).find((x) => /Alpha/.test(x.side)).bk).length, 0, 'a book not seen for 24 h is not quoting');
  const cut = { ...ATP_ROW, match: { status: 'in_play', liveAt: iso(5) } };
  const c = M.buildSelections([ATP_LINE], [cut], NOW).find((x) => /Alpha/.test(x.side));
  assert.ok(c.bk.Bet105.series.every((p) => p.t < NOW - 5 * H), 'every price is before the live start');
  assert.equal(M.isUpcoming(c, NOW), false, 'a started match is not listed (upcoming only, drops.md r2)');
});

test('sort Biggest sharp drop (default): every sharp reading first, by its drop; then the rest by their soft drop', async () => {
  const p = boot(); await p.start();
  const v = M.view(p.st.sels, M.defaults(), NOW);
  assert.match(v.list[0].side, /Alpha/, 'the Pinnacle drop ranks first');
  const sh = kinds(v.list, 'all'), n = sh.filter((r) => r.d != null).length;
  assert.ok(sh.slice(0, n).every((r) => r.d != null), 'every selection with a sharp reading ranks first');
  assert.deepEqual(sh.slice(0, n).map((r) => r.d), sh.slice(0, n).map((r) => r.d).sort((a, b) => b - a));
});

test('sort Biggest soft drop (founder 2026-11-27): the biggest soft drops first, then no move, then soft rises, then no soft reading — never a rise on top', () => {
  const s = M.buildSelections(FIX.lines, FIX.rows, NOW);
  const S = { ...M.defaults(), sort: 'drop', btype: 'soft' }, list = M.view(s, S, NOW).list, r = kinds(list, 'soft');
  const ORDER = { drop: 0, flat: 1, up: 2, one: 3, none: 3 };
  assert.deepEqual(r.map((x) => ORDER[x.kind]), r.map((x) => ORDER[x.kind]).sort((a, b) => a - b), 'drops, then flat, then rises, then no soft reading: ' + r.map((x) => x.kind + (x.d ?? '')).join(' '));
  const d = r.filter((x) => x.kind === 'drop').map((x) => x.d);
  assert.deepEqual(d, d.slice().sort((a, b) => b - a), 'the drops largest first');
  assert.ok(r.some((x) => x.kind === 'up' && x.d < -1) && r.some((x) => x.kind === 'none'), 'the fixture holds rises over 1% and selections with no soft line (the measured case)');
  const up = r.filter((x) => x.kind === 'up').map((x) => x.d);
  assert.deepEqual(up, up.slice().sort((a, b) => b - a), 'rises: the smallest first');
  // Min drop reads the soft reading when the soft sort is on
  const S5 = { ...S, min: 5 }, kept = kinds(M.view(s, S5, NOW).list, 'soft');
  assert.ok(kept.length && kept.every((x) => x.kind === 'drop' && x.d >= 5), 'Min drop 5% under the soft sort keeps only soft drops of 5% or more');
  const sharpOnly = s.filter((x) => M.isUpcoming(x, NOW)).find((x) => { const c = M.calc(x.bk); return c.sharp.kind === 'drop' && c.sharp.d >= 5 && !(c.soft.r.d >= 5); });
  assert.ok(sharpOnly, 'a selection with a sharp drop of 5% or more and a smaller soft reading exists in the fixture');
  assert.ok(M.view(s, { ...M.defaults(), min: 5 }, NOW).list.includes(sharpOnly), 'control: under the sharp sort it passes');
  assert.ok(!M.view(s, S5, NOW).list.includes(sharpOnly), 'its sharp drop does not pass the soft filter');
});

test('Drops in = Pts implied: ranks by the implied shift and switching resets the sort to the drop', async () => {
  const s = M.buildSelections(FIX.lines, FIX.rows, NOW);
  const r = kinds(M.view(s, { ...M.defaults(), unit: 'pts', btype: 'soft' }, NOW).list, 'soft').filter((x) => x.pts != null && x.kind === 'drop').map((x) => x.pts);
  assert.deepEqual(r, r.slice().sort((a, b) => b - a));
  const p = boot(); await p.start();
  p.st.lastV.sortOpts[2].onClick(); assert.equal(p.st.S.sort, 'recent');
  p.st.lastV.unitOpts[1].onClick(); assert.equal(p.st.S.unit, 'pts'); assert.equal(p.st.S.sort, 'drop');
  assert.match(p.st.lastV.hdrBiggest, /^\+\d+\.\d pts$/, 'header Biggest in pts');
});

test('Meaningful only and the Sharp move chip (the file\'s isMean): Pinnacle, or Bet105 without its margin (founder 2026-11-28), moved 5 pts, or 2 pts with half the soft books following', () => {
  const mk = (sh, softDown) => ({ sharp: sh, soft: { quotes: 2, down: softDown } });
  assert.equal(M.isMean(mk(M.rd(2.12, 1.46), 0)), true, '21 pts');
  assert.equal(M.isMean(mk(M.rd(2.0, 1.9), 1)), true, '2.6 pts, 1 of 2 soft down');
  assert.equal(M.isMean(mk(M.rd(2.0, 1.9), 0)), false, '2.6 pts, no soft follows');
  assert.equal(M.isMean(mk(M.rd(2.0, 1.97), 2)), false, 'under 2 pts');
  const line = { key: 'k', playerA: 'Carl Gamma', playerB: 'Dan Delta', side: 'Carl Gamma', books: {
    Bet105: { side: [[iso(10), 2.10], [iso(6), 1.60]], other: [[iso(10.5), 1.80], [iso(3), 2.40]], lastSeen: iso(0.1) } } };
  const g = M.buildSelections([line], [{ ...ATP_ROW, playerA: 'Carl Gamma', playerB: 'Dan Delta', side: 'Carl Gamma', tier: 'Challenger' }], NOW)[0];
  const c = M.calc(g.bk); assert.equal(c.sharp.src, 'Bet105'); assert.equal(M.isMean(c), true, 'a Bet105 no-margin move counts');
  const t = M.timing(g, c, NOW); assert.equal(t.chipLbl, 'Strong sharp move'); assert.match(t.chipTitle, /^Bet105 moved this selection by 5 pts implied or more$/);
  const S = { ...M.defaults(), mean: true }, s = M.buildSelections(FIX.lines.concat([ATP_LINE]), FIX.rows.concat([ATP_ROW]), NOW);
  assert.ok(M.view(s, S, NOW).list.every((x) => M.isMean(M.calc(x.bk))));
});

test('header: the design card; the subtitle says first recorded (founder 2026-11-28); Updated = the read\'s generatedAt in the member zone', async () => {
  const p = boot({ tz: 'Asia/Jakarta' }); const html = await p.start();
  assert.match(html, />Prices that have shortened since we first recorded them\. Sharp and soft books are read separately\.</);
  assert.doesNotMatch(html, /since they opened/);
  const up = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(NOW - 10e3));
  assert.equal(p.st.lastV.updatedVal, up);
  const v = M.view(p.st.sels, M.defaults(), NOW);
  assert.equal(p.st.lastV.hdrDrops, String(v.drops)); assert.equal(p.st.lastV.hdrBiggest, v.biggest.toFixed(1) + '%');
  const q = boot({ reachable: false }); const h2 = await q.start();
  assert.equal(q.st.lastV.hdrDrops, '—'); assert.equal(q.st.lastV.updatedVal, '—');
  assert.doesNotMatch(h2, /data-docard/, 'never a card with nothing read');
  assert.doesNotMatch(html, /selections across/, 'the count line is removed (README §3)');
  assert.match(html, /data-doarchive[^>]*>Biggest moves of the past days ›</, 'the archive link (founder 2026-11-28)');
});

test('cards: one per selection, the design\'s card markup (5% edge at rest, 16% on hover), sharp label names its source', async () => {
  const p = boot(); const html = await p.start();
  const n = (html.match(/data-docard/g) || []).length;
  assert.equal(n, M.view(p.st.sels, M.defaults(), NOW).list.length);
  assert.match(html, /data-docard[^>]*border:1px solid var\(--do3-edge-5\)[^>]*class="dxh\d+"/);
  assert.match(SRC, /\.dxh\d+:hover\{border-color:var\(--do3-edge-16\) !important\}/);
  assert.match(html, /A\. Alpha-Profile to win/); assert.match(html, /vs B\. Beta-Profile · Testville Open</);
  assert.match(html, />Sharp · Pinnacle</); assert.match(html, />Sharp · Bet105 \(no margin\)</);
  assert.match(html, /data-dosharp/, 'a Sharp move chip where isMean holds');
  assert.match(html, />No sharp line</); assert.match(html, />Opened · biggest move</);
});

test('filters: Bookmaker menu (sharp · soft · prediction markets) keeps one on and clears with ×; Min drop, Window; Reset only when something is set; empty state', async () => {
  const p = boot(); await p.start();
  assert.doesNotMatch(p.root.innerHTML, />Reset filters</);
  p.st.lastV.tabMenus[0].onToggle(); assert.equal(p.st.menu, 'book');
  assert.match(p.root.innerHTML, />Prediction markets</); assert.match(p.root.innerHTML, />Kalshi</);
  for (const name of M.BOOK_NAMES3()) p.st.lastV.tabMenus[0].groups.flatMap((x) => x.opts).find((x) => x.label === name).onClick();
  assert.equal(p.st.S.books.length, 1, 'at least one stays on');
  assert.match(p.root.innerHTML, />Reset filters</);
  p.st.lastV.tabMenus[0].onClear(p.ev); assert.equal(p.st.S.books.length, M.BOOK_NAMES3().length);
  p.st.lastV.minOpts[4].onClick(); p.st.lastV.winOpts[1].onClick(); p.st.lastV.mvOpts[2].onClick();
  assert.match(p.root.innerHTML, />No selections match these filters</); assert.match(p.root.innerHTML, />Minimum drop 30% · last 12h</);
  p.st.lastV.resetFilters(); assert.equal(JSON.stringify(p.st.S), JSON.stringify(M.defaults()));
});

test('box: tiles with their Opening rows, the chart (sharp blue, compared white), legend switches, bookmaker tables; Match analysis only with a board card', async () => {
  const p = boot(); await p.start();
  p.st.lastV.rows.find((r) => /Alpha/.test(r.line)).onClick();
  const b = p.ov.innerHTML, dr = p.st.lastDr;
  assert.match(b, /Match winner · vs B\. Beta-Profile · Testville Open · QF/);
  assert.equal(dr.maD, 'flex'); dr.openMA(); assert.equal(p.sb._opened, 'upcoming-999'); assert.equal(p.st.drawer, null);
  p.st.lastV.rows.find((r) => /Alpha/.test(r.line)).onClick();
  const d = p.st.lastDr;
  assert.equal(d.shLbl, 'Sharp · Pinnacle'); assert.match(d.shOpening, /^2\.12 · \w{3} \d\d:\d\d$/); assert.equal(d.quoting, '3 of 6');
  assert.equal(d.summary, 'Down at 3 of 3 quoting this line (2 of 2 sharp, 1 of 1 soft, no prediction market quoting).');
  assert.equal(d.ch.legend.map((l) => l.name).join('|'), 'Pinnacle|Superbet', 'default compared = highest price outside Pinnacle');
  assert.equal(d.predNote, 'No prediction market quotes this selection, so the chart has no prediction market line.');
  assert.ok(d.ch.pinPoints && d.ch.points);
  d.ch.legend[0].onClick(); assert.equal(p.st.lastDr.ch.pinPoints, '', 'a legend pill hides its line');
  assert.equal(p.st.lastDr.ch.gridY[0].label, d.ch.gridY[0].label, 'the price scale does not rescale');
  p.st.lastDr.ch.legend[0].onClick();
  p.st.lastDr.colA[0].rows.find((r) => r.book === 'Bet105').onPick(); assert.equal(p.st.lastDr.selName, 'Bet105');
  const ch = sel(p.st, /Villanueva/); p.st.drawer = ch.id; p.D.setActive(true); await p.flush();
  assert.equal(p.st.lastDr.maD, 'none', 'no board card, no link');
  assert.equal(p.st.lastDr.pinNote, 'Pinnacle has no line on this selection, so the chart has no sharp overlay.');
});

test('chart (founder 2026-11-28): straight lines through the recorded prices, two dots per line (first recorded, now), the axis never under 1.00', async () => {
  const series = [{ t: NOW - 30 * H, v: 1.12 }, { t: NOW - 10 * H, v: 1.08 }, { t: NOW - 2 * H, v: 1.05 }];
  const s = M.shapeSeries(series, NOW - 24 * H, NOW);
  assert.equal(s.carried, true, 'a price recorded before the window enters at the left edge');
  assert.equal(s.pts.map((x) => x.v).join(' '), '1.11 1.08 1.05 1.05', 'the edge value lies on the straight line to the next price; the last price runs on to now');
  assert.equal(s.pts[s.pts.length - 1].fr, 1);
  const p = boot(); await p.start(); p.st.lastV.rows.find((r) => /Alpha/.test(r.line)).onClick();
  const d = p.st.lastDr, pin = d.ch.pinPoints.split(' ').map((x) => x.split(',').map(Number));
  assert.ok(pin.some((q, i) => i && q[0] !== pin[i - 1][0] && q[1] !== pin[i - 1][1]), 'a move is a slope, never a step');
  assert.equal(d.ch.dots.map((x) => x.s).join(' '), '6px 9px 9px', 'opening (6px) and now (9px) on Pinnacle; Superbet\'s first price is older than the window, so it enters at the edge with no opening dot');
  assert.ok(d.ch.gridY.every((g) => +g.label >= 1));
  const low = { key: 'k', playerA: 'Carl Gamma', playerB: 'Dan Delta', side: 'Carl Gamma', books: {
    Superbet: { side: [[iso(9), 1.06], [iso(4), 1.02]], other: [], lastSeen: iso(0.1) }, 'Napoleon Sports BE': { side: [[iso(8), 1.05], [iso(3), 1.03]], other: [], lastSeen: iso(0.1) } } };
  const q = boot({ rows: [{ ...ATP_ROW, playerA: 'Carl Gamma', playerB: 'Dan Delta', side: 'Carl Gamma' }], lines: [low], board: [] }); await q.start();
  q.st.lastV.rows[0].onClick();
  assert.equal(q.st.lastDr.ch.gridY[4].label, '1.00', 'prices near 1.01: the axis floor is 1.00, never under');
  d.ch.onMove({ currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 1000 }) }, clientX: 700 });
  assert.equal(p.st.lastDr.ch.hov.on, true); assert.equal(p.st.lastDr.ch.hov.rows.length, 2); assert.match(p.st.lastDr.ch.hov.tf, /-100%/, 'past 60% the readout flips left');
});

test('Escape closes an open box menu first, then the box', async () => {
  const p = boot(); await p.start();
  p.st.lastV.rows.find((r) => /Alpha/.test(r.line)).onClick(); p.st.lastDr.pickToggle();
  assert.ok(p.st.drPick);
  const esc = () => { const L = p.sb.sfEscLayers.filter((l) => l.isOpen()).sort((a, b) => b.z - a.z)[0]; if (L) L.close(); };
  esc(); assert.equal(p.st.drPick, false); assert.ok(p.st.drawer);
  esc(); assert.equal(p.st.drawer, null);
});

test('phone (under 820px): the v2 card list, Filters / Sort sheet; the box is the design\'s bottom sheet', async () => {
  const p = boot({ width: 390 }); const h = await p.start();
  assert.match(h, /<div class="do2-wrap do2-m"><div class="do2-mwrapper"><div class="do2-mtitle"><h1>Dropping Odds<\/h1><\/div>/);
  assert.match(h, /<div class="do2-mcard" role="button"/); assert.doesNotMatch(h, /ILLUSTRATIVE|LIVE ·/);
  await p.act('sheet'); assert.match(p.root.innerHTML, /TIER · MEN ONLY/);
  await p.act('sheetclose'); await p.act('row', sel(p.st, /Alpha/).id);
  assert.equal(p.st.lastDr.top, '64px'); assert.equal(p.st.lastDr.rad, '16px 16px 0 0'); assert.equal(p.st.lastDr.maD, 'none');
});

test('safety: feed strings escaped; polling stops when the page is left; no sample data ships', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const line = { ...ATP_LINE, playerA: evil, side: evil }, row = { ...ATP_ROW, playerA: evil, side: evil };
  const h = await boot({ rows: [row], lines: [line] }).start();
  assert.ok(!h.includes('<img src=x'), 'raw markup reached the page'); assert.match(h, /&lt;img/);
  const p = boot(); p.D.setActive(true); const n = p.timers.length; p.D.setActive(false); await p.flush();
  assert.equal(p.timers.slice(n).filter((ms) => ms === 30000).length, 0);
  for (const bad of ['Unibet', 'Betsson', 'bet365', 'randomuser', '09:19', 'Villanueva', 'Gorzny', 'ILLUSTRATIVE']) assert.ok(!SRC.includes(bad), bad);
});

test('colour: the design\'s colours read through tokens only; red only on drop figures', () => {
  assert.doesNotMatch(SRC, /#[0-9a-fA-F]{6}\b|rgba?\(\s*\d/, 'no raw colour in the page script');
  assert.ok((SRC.match(/var\(--do2-red\)/g) || []).length >= 1);
  assert.match(read('tokens.css'), /--do3-edge-5: rgba\(255, 255, 255, 0\.05\);/);
  assert.match(CSS, /\[data-page="drops"\] \.do3-wrap \*, \.do3-ov, \.do3-ov \* \{ box-sizing: content-box; \}/, 'the design is drawn on the browser\'s default box model');
});

test('wiring: published with tokens; the module loads in node; the Arbitrage view stays retired', () => {
  const req = createRequire(import.meta.url); assert.ok(req('./drops-page.js').buildSelections);
  assert.match(read('tools/site-code.sh'), /drops-page\.js drops-page\.css/);
  assert.ok(!fs.existsSync(new URL('./arb-page.js', import.meta.url))); assert.doesNotMatch(SRC, /ArbPage/);
});

// ─── the archive: "Biggest moves of the past days" (founder 2026-11-28) ───
const AR = (k, over) => ({ key: k, eventKey: 1, playerA: 'Alan Alpha', playerB: 'Bruno Beta', side: 'Alan Alpha', opp: 'Bruno Beta', tier: 'Challenger', event: 'Testville',
  round: 'R16', scheduledAt: iso(20), startAt: iso(20), won: true, status: 'Finished', score: '6-4  7-6', lagMin: 25,
  sharp: { o: 2.12, oAt: iso(30), c: 1.46, cAt: iso(20.1), n: 1.46, drop: 31.1, pts: 21.3, mv: { from: 2.0, to: 1.6, at: iso(25), fromAt: iso(26), pct: 20 }, line: [[iso(30), 2.12], [iso(26), 2.0], [iso(25), 1.6], [iso(20.1), 1.46]] },
  soft: { o: 2.10, oAt: iso(29), c: 1.50, cAt: iso(20.2), n: 1.5, drop: 28.6, pts: 19.1, mv: { from: 1.9, to: 1.6, at: iso(24.6), fromAt: iso(27), pct: 15.8 }, line: [[iso(29), 2.1], [iso(24.6), 1.6], [iso(20.2), 1.5]], book: 'avg' }, ...over });
const ARCH = { schema: 1, generatedAt: iso(0.1), rows: [AR('a'), AR('b', { won: false, sharp: { ...AR('x').sharp, drop: 12, o: 3.0, pts: 3.1 }, scheduledAt: iso(50) }),
  AR('c', { startAt: null, sharp: { ...AR('x').sharp, c: null, drop: 8, pts: 1.2 }, scheduledAt: iso(24 * 20) }), AR('d', { sharp: { ...AR('x').sharp, drop: -3, pts: -1 } })] };

test('archive: the link opens it; rows by day, drops only, biggest first; tiles count with denominators; no close without a verified start', async () => {
  const p = boot({ archive: ARCH }); await p.start();
  assert.match(p.root.innerHTML, /data-doarchive/, 'the link is drawn once the archive exists');
  p.st.lastV.openArchive(p.ev); await p.flush();
  const v = p.st.lastA;
  assert.equal(v.groups.length, 2, 'two days in the last 7 (the 20-day record and the rise are out)');
  assert.equal(v.tiles[0].val, '2'); assert.equal(v.tiles[2].val, '50%'); assert.equal(v.tiles[2].sub, '1 of 2 selections won');
  assert.equal(v.tiles[3].val, '—', 'under 5 moves: no yield');
  assert.match(v.countLine, /^2 moves on finished matches · sharp books \(Bet105 \(no margin\)\)$/);
  v.tracks[1].opts[1].onClick(); await p.flush();
  const w = p.st.lastA, rows = w.groups.flatMap((g) => g.rows);
  assert.equal(rows.length, 3); assert.ok(rows.some((r) => r.closePx === '—'), 'no verified start: the Closed cell is a dash, never a snapshot');
  assert.ok(!rows.some((r) => r.drop.startsWith('-')), 'a rise is not a move');
  assert.match(p.root.innerHTML, />Biggest moves · archive</);
});

test('archive box: the step strip, the recorded prices joined straight, the 1u result at the price after the biggest move; Escape closes it; back returns', async () => {
  const p = boot({ archive: ARCH }); await p.start(); p.st.lastV.openArchive(p.ev); await p.flush();
  p.st.lastA.groups[0].rows[0].onOpen(); await p.flush();
  const m = p.st.lastA.m;
  assert.equal(m.sharpName, 'Bet105 (no margin)'); assert.equal(m.sharp.mvFromTo, '2.00 → 1.60'); assert.equal(m.pl, '+0.60u'); assert.equal(m.backPx, '1.60');
  assert.equal(m.sharpLine.split(' ').length, 4, 'one point per recorded price in the line'); assert.equal(m.lead, 'soft books followed 25m later');
  assert.match(p.root.innerHTML, /data-amodal/);
  const esc = () => { const L = p.sb.sfEscLayers.filter((l) => l.isOpen()).sort((a, b) => b.z - a.z)[0]; if (L) L.close(); };
  esc(); assert.equal(p.st.A.open, null);
  p.st.lastA.back(); await p.flush(); assert.equal(p.st.archive, false); assert.match(p.root.innerHTML, /data-docard/);
});
