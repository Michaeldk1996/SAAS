// Dropping Odds v2 (handoff design_handoff_dropping_odds_v2, founder brief 2026-11-23): the rebuilt page and price move
// box, executed on a frozen slice of the real drops feed (tools/fixtures/drops-v2.json, captured 23 Nov 2026) plus one
// synthetic ATP selection with a board card and a Pinnacle chart (the live feed had none that day). Rules:
// .claude/rules/drops.md. Mutants: tools/test-drops-v2-mutants.js (DROPSV2_SRC / DROPSV2_CSS swap in a mutated copy).
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

function boot({ rows = FIX.rows.concat([ATP_ROW]), lines = FIX.lines.concat([ATP_LINE]), ageS = 10, reachable = true, tz = 'UTC', board = [CARD] } = {}) {
  const root = { innerHTML: '', _l: {}, addEventListener(t, f) { root._l[t] = f; }, closest: () => ({ classList: { contains: () => true } }), querySelector: () => null };
  const ov = { id: '', _h: '', remove() { mounted = false; }, querySelector: () => null, addEventListener(t, f) { ov._l = f; } };
  Object.defineProperty(ov, 'innerHTML', { get: () => ov._h, set: (v) => { ov._h = v; } });
  let mounted = false; const timers = []; const winL = {};
  const status = { generatedAt: new Date(NOW - ageS * 1000).toISOString(), serverNow: new Date(NOW).toISOString(), ageS };
  const res = (b) => ({ status: 200, ok: true, headers: { get: () => '"e"' }, json: async () => b });
  class FD extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } }
  const sb = {
    document: { readyState: 'complete', activeElement: null, querySelector: () => null, addEventListener() {},
      getElementById: (id) => (id === 'dropsRoot' ? root : id === 'do2Overlay' ? (mounted ? ov : null) : id === 'dropsTabBtn' ? { style: {} } : null),
      body: { appendChild: () => { mounted = true; } }, createElement: () => ov },
    location: { search: '' }, URLSearchParams, Intl, Date: FD, Promise, JSON, Math, String, Number, Object, Array, isFinite, parseFloat, RegExp, Error,
    localStorage: { getItem: () => null }, newsTz: () => tz, matches: board, roundBadgeText: (r) => (r === 'Quarter-finals' ? 'QF' : r),
    cardStartMs: () => NOW + 6 * H, openAnalysisModal: (id) => { sb._opened = id; },
    newsPlayerName: (k, n) => ({ 11: 'A. Alpha-Profile', 22: 'B. Beta-Profile' }[k] || n), sfEventName: (raw) => (raw === 'ATP Testville' ? 'Testville Open' : raw),
    playerPhotoImg: (k, n) => '<img class="sf-ph" data-key="' + k + '" alt="' + n + '">',
    ensureOddsMovement: async (m) => { m._oddsLoaded = true; m.oddsMovement = { chart: CHART }; },
    fetch: async (u) => { if (!reachable) throw new Error('down'); return res(String(u).endsWith('/status.json') ? status : { schema: 1, windowHours: 72, rows, lines }); },
    setTimeout: (f, ms) => { timers.push(ms); return timers.length; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    addEventListener: (t, f) => { winL[t] = f; },
  };
  sb.window = sb;
  vm.runInNewContext(SRC, sb);
  const D = sb.DropsPage, flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
  const act = async (a, v, tgt) => { const el = { getAttribute: (k) => (k === 'data-act' ? a : k === 'data-v' ? (v == null ? null : String(v)) : null) };
    (tgt === 'ov' ? ov._l : root._l.click)({ target: { closest: () => el }, stopPropagation() {}, preventDefault() {} }); await flush(); };
  return { D, st: D._state, root, ov, timers, flush, act, sb, winL,
    start: async () => { D.setActive(true); await flush(); D._state.metaSig = null; D.setActive(true); await flush(); return root.innerHTML; } };
}
const sel = (st, re) => st.sels.find((s) => re.test(s.side));

test('readings: every %, implied and pts figure from the two prices shown (README rd)', () => {
  const a = M.rd(2.12, 1.46), b = M.rd(5.30, 3.65);
  assert.deepEqual([a.kind, a.d, a.io, a.inn, a.pts], ['drop', 31.1, 47.2, 68.5, 21.3]);
  assert.deepEqual([b.kind, b.d, b.io, b.inn, b.pts], ['drop', 31.1, 18.9, 27.4, 8.5]);
  assert.equal(M.rd(1.423, 1.33).d, M.rd(1.42, 1.33).d, 'computed on the 2 dp prices printed');
  assert.equal(M.rd(2.5, 2.5).kind, 'flat'); assert.equal(M.rd(2.4, 2.6).kind, 'up');
  assert.equal(M.rd(null, 1.58).kind, 'one'); assert.equal(M.rd(null, null).kind, 'none');
});

test('soft reading: the average of soft books with two prices, "n of m soft books down", one book names itself', () => {
  const c = M.calc({ Superbet: { first: 4.05, now: 2.92 }, 'Napoleon Sports BE': { first: 4.10, now: 2.90 }, Bet105: { first: 4.0, now: 3.1 } });
  assert.equal(c.soft.lead, 'avg'); assert.equal(c.soft.r.o, 4.08); assert.equal(c.soft.r.n, 2.91);
  assert.equal(M.softCount(c), '2 of 2 soft books down'); assert.equal(c.sharp.kind, 'none', 'never the soft figure in the sharp slot');
  assert.equal(M.bestSub(c), 'Best · Bet105');
  const one = M.calc({ Superbet: { first: 3, now: 2.5 } });
  assert.equal(one.soft.lead, 'Superbet'); assert.equal(M.bestSub(one), 'Superbet only');
  assert.equal(M.softLabel(one), 'Soft books · Superbet');
});

test('selections: one per match side from the endpoint lines; the side\'s own line wins; roster books only; 24 h quoting; nothing at or after the cut', () => {
  const s = M.buildSelections(FIX.lines, FIX.rows, NOW);
  const ids = new Set(s.map((x) => x.id)); assert.equal(ids.size, s.length, 'one row per selection');
  const v = s.find((x) => /Villanueva/.test(x.side)), o = s.find((x) => /Alcala/.test(x.side));
  assert.ok(v && o, 'both sides of the match'); assert.notDeepEqual(v.bk.Superbet.series, o.bk.Superbet.series);
  assert.ok(s.every((x) => Object.keys(x.bk).every((b) => M.BOOKS.some((r) => r[0] === b))), 'only books the page has a source for');
  const old = { ...ATP_LINE, books: { Bet105: { ...ATP_LINE.books.Bet105, lastSeen: iso(25) } } };
  assert.equal(Object.keys(M.buildSelections([old], [ATP_ROW], NOW).find((x) => /Alpha/.test(x.side)).bk).length, 0, 'a book not seen for 24 h is not quoting');
  const cut = { ...ATP_ROW, match: { status: 'in_play', liveAt: iso(5) } };
  const c = M.buildSelections([ATP_LINE], [cut], NOW).find((x) => /Alpha/.test(x.side));
  assert.ok(c.bk.Bet105.series.every((p) => p.t < NOW - 5 * H), 'every price is before the live start');
  assert.equal(M.isUpcoming(c, NOW), false, 'a started match is not listed (upcoming only, drops.md r2)');
});

test('list: default sort = biggest sharp drop, no-sharp selections after by their soft drop; Movement counts follow the other filters', async () => {
  const p = boot(); const html = await p.start();
  const v = M.view(p.st.sels, M.defaults(), NOW);
  assert.match(v.list[0].side, /Alpha/, 'the Pinnacle drop ranks first');
  const withSharp = v.list.filter((s) => M.calc(s.bk).sharp.kind !== 'none').length;
  assert.ok(v.list.slice(0, withSharp).every((s) => M.calc(s.bk).sharp.kind !== 'none'), 'every selection with a sharp line ranks first');
  const soft = v.list.slice(withSharp).map((s) => M.calc(s.bk).soft.r.d ?? -1);
  assert.deepEqual(soft, soft.slice().sort((a, b) => b - a), 'then by soft drop');
  assert.equal(v.mvN.all, v.mvN.both + v.mvN.sharp + v.mvN.soft + v.mvN.nosharp + v.list.filter((s) => M.mvOf(M.calc(s.bk)) === 'none').length);
  assert.match(html, /All<span class="do2-optn">\d+<\/span>/);
  assert.match(html, new RegExp(v.list.length + ' selections across ' + v.nMatches + ' matches'));
});

test('row: the Pinnacle reading red with its meter, the soft average white, open struck; no sharp line reads "—" + "No sharp line"', async () => {
  const p = boot(); const html = await p.start();
  assert.match(html, /<span class="do2-sh-fig drop" style="font-size:23px">31\.1<span class="do2-pct">%<\/span><\/span><span class="do2-impl">\+21\.3 pts implied<\/span>/);
  assert.match(html, /<span class="do2-open strike">2\.12<\/span><span class="do2-arr">→<\/span><span class="do2-now">1\.46<\/span>/);
  assert.match(html, /<span class="do2-sh-fig dim" style="font-size:23px">—<span class="do2-pct"><\/span><\/span><span class="do2-impl"><\/span><\/span><span class="do2-note">No sharp line<\/span>/);
  assert.match(html, /A\. Alpha-Profile to win/);
  assert.match(html, /1 soft book quoting, 1 price recorded|soft books quoting, 1 price recorded each/, 'one price: the reason, not a zero');
  assert.match(html, /<span class="do2-so-fig flat" style="font-size:11px">No move/, 'no move: smaller, text2');
});

test('header: Drops · Biggest · Updated; Updated = the read\'s generatedAt in the member zone; dashes before the first read', async () => {
  const p = boot({ tz: 'Asia/Jakarta' }); const html = await p.start();
  const up = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(NOW - 10e3));
  assert.match(html, new RegExp('Updated</span><span class="do2-stat-v">' + up + '<'));
  assert.match(html, /Drops<\/span><span class="do2-stat-v">1</); assert.match(html, /Biggest<\/span><span class="do2-stat-v">31\.1%</);
  const q = boot({ reachable: false }); const h2 = await q.start();
  assert.match(h2, /Drops<\/span><span class="do2-stat-v dim">—</); assert.match(h2, /Updated<\/span><span class="do2-stat-v dim">—</);
  assert.doesNotMatch(h2, /selections across/, 'never a count claim with nothing read');
});

test('banner: past 5 min (or unreachable) "Feed disconnected" as drawn, rows dimmed; fresh = no banner', async () => {
  assert.doesNotMatch(await boot({ ageS: 60 }).start(), /Feed disconnected/);
  const h = await boot({ ageS: 400 }).start();
  assert.match(h, /<span class="do2-banner-k">Feed disconnected<\/span><span class="do2-banner-t">Showing prices as of <span class="do2-mono do2-banner-v">\d\d:\d\d<\/span>\. New moves appear once the feed reconnects\.<\/span>/);
  assert.match(h, /data-act="reconnect">Reconnect</); assert.match(h, /do2-list stale/);
});

test('explainer: the four blocks word for word, without "tends to move first" (held for the founder)', async () => {
  const h = await boot().start();
  for (const t of ['How far the price has fallen since we first recorded it.', 'The bookmaker margin is still in the figure.', 'The same drop can mean very different things.',
    'Sharp is Pinnacle. Soft is the average of the other bookmakers. The first recorded price is not necessarily the opening line.']) assert.ok(h.includes(t), t);
  assert.ok(!/tends to move first/.test(SRC), 'the claim is not shipped');
});

test('filters: Bookmaker menu keeps one on and clears with ×; Min drop, Window, search; Reset only when something is set; empty state', async () => {
  const p = boot(); await p.start();
  assert.doesNotMatch(p.root.innerHTML, /data-act="reset">Reset filters/);
  await p.act('menu', 'book'); for (const b of ['Pinnacle', 'Bet105', 'Superbet']) await p.act('book', b);
  await p.act('book', 'Napoleon Sports BE');
  assert.equal(JSON.stringify(p.st.S.books), '["Napoleon Sports BE"]', 'at least one stays on');
  assert.match(p.root.innerHTML, /do2-mbtn-v set">Napoleon Sports BE</); assert.match(p.root.innerHTML, /Reset filters/);
  await p.act('clear', 'book'); assert.equal(p.st.S.books.length, 4);
  await p.act('min', '30'); await p.act('win', '12h'); await p.act('mv', 'sharp');
  assert.match(p.root.innerHTML, /No selections match these filters<\/span><span class="do2-empty-d">Minimum drop 30% · last 12h</);
  await p.act('reset'); assert.equal(JSON.stringify(p.st.S), JSON.stringify(M.defaults()));
  p.st.S.q = 'kountour'; p.D.setActive(true); await p.flush();
  assert.match(p.root.innerHTML, /2 selections across 1 match/, 'search matches the match: both players\' selections');
});

test('box: three tiles, Pinnacle chart + compared book, bookmaker groups; the summary counts with denominators; Match analysis only with a board card', async () => {
  const p = boot(); await p.start();
  const id = sel(p.st, /Alpha/).id; await p.act('row', id);
  const b = p.ov.innerHTML;
  assert.match(b, /Match winner · vs B\. Beta-Profile · Testville Open · QF/);
  assert.match(b, /data-act="analysis" data-v="upcoming-999">Match analysis</);
  assert.match(b, /Sharp · Pinnacle<\/span><span class="do2-tile-top"><span class="do2-tfig28 drop">31\.1%/);
  assert.match(b, /Last move<\/span><span class="do2-kv-v">4h ago</);
  assert.match(b, /Quoting<\/span><span class="do2-kv-v">3 of 4</);
  assert.match(b, /Down at 3 of 3 quoting this line \(2 of 2 sharp, 1 of 1 soft\)\./);
  assert.match(b, /class="do2-ln pin"/); assert.match(b, /Compare with Pinnacle<\/span><span class="do2-mbtn-v set">Superbet</, 'default compared = highest price outside Pinnacle');
  assert.doesNotMatch(b, /Polymarket|Kalshi|Prediction market/, 'no prediction market without a source');
  await p.act('drbook', 'Bet105', 'ov');
  assert.match(p.ov.innerHTML, /do2-mbtn-v set">Bet105</); assert.match(p.ov.innerHTML, /do2-brow on q" role="button" tabindex="0" data-act="drbook" data-v="Bet105"/);
  const ch = sel(p.st, /Villanueva/); await p.act('row', ch.id);
  assert.doesNotMatch(p.ov.innerHTML, /Match analysis/, 'no board card, no link');
  assert.match(p.ov.innerHTML, /Pinnacle has no line on this selection, so the chart has no sharp overlay\./);
  assert.match(p.ov.innerHTML, /Each drop compares a book's own first recorded price with its own current price\./);
});

test('chart (TEN-301 step line): every segment flat or vertical, a dot per recorded price in the window, the axis never under 1.00', () => {
  const series = [{ t: NOW - 30 * H, v: 1.12 }, { t: NOW - 10 * H, v: 1.08 }, { t: NOW - 2 * H, v: 1.05 }];
  const ch = M.chartModel([{ role: 'sel', series }], NOW);
  const pts = ch.lines[0].points.split(' ').map((x) => x.split(',').map(Number));
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i][0] === pts[i - 1][0] || pts[i][1] === pts[i - 1][1], 'no diagonal between two prices');
  assert.equal(ch.lines[0].dots.length, 2, 'the price recorded before the window is carried in, not dotted');
  assert.equal(pts[pts.length - 1][0], 1000, 'the last price runs on to now');
  assert.ok(+ch.gridY[4].label >= 1, 'decimal odds never under 1.00');
});

test('Escape closes an open box menu first, then the box; the box rebuilds only when what it shows changes', async () => {
  const p = boot(); await p.start();
  await p.act('row', sel(p.st, /Alpha/).id); await p.act('drpick', null, 'ov');
  assert.ok(p.st.drPick);
  // esc-nav.js presses the open layer with the highest z
  const esc = () => { const L = p.sb.sfEscLayers.filter((l) => l.isOpen()).sort((a, b) => b.z - a.z)[0]; if (L) L.close(); };
  esc(); assert.equal(p.st.drPick, false); assert.ok(p.st.drawer);
  const before = p.ov.innerHTML; p.D.setActive(true); await p.flush(); assert.equal(p.ov.innerHTML, before);
  esc(); assert.equal(p.st.drawer, null);
});

test('shared strings (carried from TEN-427 Data 5): names through newsPlayerName on the board key, events through sfEventName, the photo by ID over the initials', async () => {
  const p = boot(); const h = await p.start();
  assert.match(h, /A\. Alpha-Profile to win/); assert.match(h, /vs B\. Beta-Profile · Testville Open · moved/);
  assert.match(h, /<span class="do2-av" aria-hidden="true">AA<img class="sf-ph" data-key="11"/);
  assert.match(h, /<span class="do2-av" aria-hidden="true">GV<\/span>/, 'no board card (Challenger): initials only, never a name-matched photo');
});

test('safety: feed strings escaped; polling stops when the page is left; no placeholder ships', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const line = { ...ATP_LINE, playerA: evil, side: evil }, row = { ...ATP_ROW, playerA: evil, side: evil };
  const h = await boot({ rows: [row], lines: [line] }).start();
  assert.ok(!h.includes('<img src=x'), 'raw markup reached the page'); assert.match(h, /&lt;img/);
  const p = boot(); p.D.setActive(true); const n = p.timers.length; p.D.setActive(false); await p.flush();   // left while the first read is in flight
  assert.equal(p.timers.slice(n).filter((ms) => ms === 30000).length, 0);
  for (const bad of ['Unibet', 'Betsson', 'bet365', 'randomuser', 'Kalshi', 'Polymarket', '09:19', 'Villanueva']) assert.ok(!SRC.includes(bad), bad);
});

test('colour: red only on drop figures, meters, the strike and the banner; blue only on the Pinnacle line; names never ellipsised', () => {
  const rules = CSS.split('}').map((r) => r.trim()).filter(Boolean);
  const red = rules.filter((r) => /var\(--do2-(red|meter)\)/.test(r)).map((r) => r.split('{')[0]);
  assert.ok(red.every((s) => /\.drop|do2-meter|banner/.test(s)), red.join(' | '));
  const blue = rules.filter((r) => /var\(--do2-blue\)/.test(r)).map((r) => r.split('{')[0]);
  assert.ok(blue.every((s) => /\.pin/.test(s)), blue.join(' | '));
  assert.ok(!/text-overflow:\s*ellipsis/.test(CSS), 'player names wrap, never an ellipsis');
  assert.match(CSS, /grid-template-columns: 252px minmax\(0, 1\.3fr\) minmax\(204px, 0\.8fr\) 112px 104px 10px; gap: 18px;/);
  assert.match(CSS, /@media \(max-width: 1239px\)[^}]*196px minmax\(0, 1fr\) 156px 104px 10px; gap: 14px;/);
});

test('wiring: published with tokens; the module loads in node', () => {
  const req = createRequire(import.meta.url); assert.ok(req('./drops-page.js').buildSelections);
  assert.match(read('tools/site-code.sh'), /drops-page\.js drops-page\.css/);
  assert.match(read('tokens.css'), /--do2-card:\s+#0E1019;/);
});
