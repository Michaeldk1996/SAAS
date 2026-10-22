// tools/test-draw-record-drill.js — the Draw record drill-in (founder 2026-10-13).
//
// Every Results row (Level · Format · By round · Opponent) of the player profile's Draw record opens the matches
// behind its W–L inside the modal. What this locks:
//   A · reconciliation   for EVERY player in the committed store and every row, Career and Last 52, the list the
//                        drill shows has exactly the row's W–L (relational: holds on any build, so the daily refresh
//                        cannot make it stale) — plus the pinned Zverev fixture with exact counts
//   B · the summary      rows clickable (hook, chevron, hover class) on Results only; figures unchanged
//   C · the drill        breadcrumb + big W–L / Win % = the row; P&L with its priced denominator (pending blank,
//                        failed dash, never a total without its count); All / Wins / Losses counts; newest first;
//                        100 a page; Last 52 lists only that window; a walkover carries no price; a loss's score
//                        turned to the player's side; Esc / back return with the scope kept
//   D · the sheet        every row opens the step-3 sheet: on the career match the join met (event key), else its own
//   E · the host bridge  pp2DrawJoin prices through the real h2hPriceJoin and hands back the career match
//
// Run: node tools/test-draw-record-drill.js     (DRAW_SRC / DRAW_HTML point at a mutated copy — see the mutants)
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const L = require('./ten384-figures-lib.js');

const ROOT = path.join(__dirname, '..');
const SRC = process.env.DRAW_SRC || path.join(ROOT, 'player-profile-v2.js');
const HTML = fs.readFileSync(process.env.DRAW_HTML || path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const H = L.harness();
const T = s => L.text(s).replace(/&amp;/g, '&');
console.log('Draw record drill-in (founder 2026-10-13)');

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'draw-drill', 'zverev-1980.json'), 'utf8'));
const KEY = '1980', P = { key: KEY, name: 'A. Zverev' };

// A stub join for the module tests: every 7th row unpriced, the rest priced 1.50 / 2.60 on Pinnacle; one row (the
// Vienna 2025 walkover) is handed a price on purpose so the walkover rule is exercised.
function stubJoin(st) {
  return (k, n, rows) => {
    if (st !== 'ready') return st;
    rows.forEach((r, i) => { if (i % 7 || /W\/O/.test(r.m.sc)) { r.price = 1.5; r.oppPrice = 2.6; r.book = 'P'; } });
    return 'ready';
  };
}
function load(opts) {
  opts = opts || {};
  const extra = {
    careerSplits: { [KEY]: opts.splits || FX.splits },
    pp2DrawMatches: () => (opts.file === undefined ? { st: 'ready', d: FX.file } : opts.file),
    pp2DrawJoin: opts.join || stubJoin('ready'),
    pp2HasProfile: k => k === '2382',
    MarketEdgeCore: require(path.join(ROOT, 'market-edge-core.js'))
  };
  const m = L.loadPp2({ players: { [KEY]: P }, src: SRC, extra });
  Object.assign(m.I.state, { key: KEY, modal: 'splits', splitScope: 'career', splitTab: 'results', drawDrill: null, drawFilter: 'all', drawPage: 0 });
  return m;
}
const ROWS = ['Grand Slams', 'Masters', 'Other Tours', 'Best of 5', 'Best of 3', 'Finals', 'Semi-finals', 'Quarter-finals',
  'Early rounds', 'vs. Righties', 'vs. Lefties', 'vs. Top 10'];
function aggOf(sc, k) {
  if (k !== 'Early rounds') return sc[k] || null;
  let W = 0, Lo = 0, any = false;
  ['Round of 16', 'Round of 32', 'Round of 64', 'Round of 128'].forEach(r => { if (sc[r]) { any = true; W += sc[r].W; Lo += sc[r].L; } });
  return any ? { W, L: Lo } : null;
}

// ── A · reconciliation ──────────────────────────────────────────────────────────────────────────────────────────
H.check('A1 · pinned Zverev: every row, Career and Last 52, lists exactly its W–L', () => {
  const { I } = load();
  const out = [];
  ['career', 'last52'].forEach(scope => ROWS.forEach(k => {
    I.state.drawDrill = k;
    const a = aggOf(FX.splits[scope], k) || { W: 0, L: 0 };
    const M = I.drawDrillModel(P, FX.splits[scope], scope);
    // founder 2026-10-22: the walkover rows are listed beside the matches and counted in no W–L
    assert.strictEqual(M.rows.length - (M.wo || 0), a.W + a.L, `${scope} ${k}: ${M.rows.length - (M.wo || 0)} matches listed v ${a.W + a.L}`);
    assert.strictEqual(M.w, a.W, `${scope} ${k}: wins ${M.w} v ${a.W}`);
    assert.strictEqual(M.l, a.L, `${scope} ${k}: losses ${M.l} v ${a.L}`);
    if (scope === 'career' && /Semi|Early|Righties|Lefties/.test(k)) out.push(`${k} ${a.W}–${a.L}`);
  }));
  return out.join(' · ');
});
H.check('A2 · pinned Zverev exact: Semi-finals 44–46, Early rounds 491, vs Righties + Lefties = 815 of 816 (Jodar, no hand)', () => {
  const { I } = load();
  const n = k => { I.state.drawDrill = k; return I.drawDrillModel(P, FX.splits.career, 'career').rows; };
  const sf = n('Semi-finals'); assert.strictEqual(sf.filter(r => r.won).length + '–' + sf.filter(r => !r.won).length, '44–46');
  assert.strictEqual(n('Early rounds').length, 491);
  assert.strictEqual(n('vs. Righties').length + n('vs. Lefties').length, 815);
  assert.strictEqual(FX.file.matches.length, 816);
});
H.check('A3 · every player in the committed store (career-splits/ + splits-matches/): every row lists its W–L', () => {
  const dir = path.join(ROOT, 'career-splits'), mdir = path.join(ROOT, 'splits-matches');
  if (!fs.existsSync(dir) || !fs.existsSync(mdir)) throw new Error('committed splits store missing');
  const keys = fs.readdirSync(dir).filter(f => /^\d+\.json$/.test(f)).map(f => f.slice(0, -5))
    .filter(k => fs.existsSync(path.join(mdir, k + '.json')));
  assert(keys.length >= 100, 'only ' + keys.length + ' players — the store is not the one built');
  let rows = 0;
  // one module, the stores swapped per player (the module reads them off window at call time)
  const m = L.loadPp2({ players: {}, src: SRC, extra: { pp2DrawJoin: () => 'pending' } });
  const I = m.I;
  keys.forEach(k => {
    const splits = JSON.parse(fs.readFileSync(path.join(dir, k + '.json'), 'utf8'));
    const file = JSON.parse(fs.readFileSync(path.join(mdir, k + '.json'), 'utf8'));
    const p = { key: k, name: splits.fullName || k };
    m.W.careerSplits = { [k]: splits };
    m.W.pp2DrawMatches = () => ({ st: 'ready', d: file });
    Object.assign(I.state, { key: k, modal: 'splits' });
    ['career', 'last52'].forEach(scope => {
      const sc = splits[scope] || {};
      ROWS.forEach(r => {
        const a = aggOf(sc, r);
        if (!a) return;
        I.state.drawDrill = r;
        const M = I.drawDrillModel(p, sc, scope);
        rows++;
        assert.strictEqual((M.rows.length - (M.wo || 0)) + ':' + M.w, (a.W + a.L) + ':' + a.W, `${k} ${splits.fullName} ${scope} ${r}`);
      });
    });
  });
  return `${keys.length} players, ${rows} rows, 0 mismatches`;
});

// ── B · the summary ─────────────────────────────────────────────────────────────────────────────────────────────
H.check('B1 · Results: every row with matches is a draw-row with a chevron and the hover class; figures unchanged', () => {
  const { I } = load();
  const html = I.renderSplitsModal(P);
  const hooks = html.match(/class="pp2-drow" data-pp2="draw-row" data-v="[^"]+"/g) || [];
  assert.strictEqual(hooks.length, 12, 'clickable rows ' + hooks.length);
  assert((html.match(/<path d="M3\.5 1\.5L7 5l-3\.5 3\.5"/g) || []).length === 12, 'a chevron per row');
  assert(/\.pp2-drow:hover>\*\{background:var\(--tile-hover\)/.test(require('fs').readFileSync(SRC, 'utf8')), 'no row hover rule');
  assert(/>44–46<\/span>/.test(html), 'Semi-finals W–L');
});
H.check('B2 · Sets & Games and Service tabs are not clickable (Results only)', () => {
  const { I } = load();
  ['sets', 'service'].forEach(t => { I.state.splitTab = t; assert(!/draw-row/.test(I.renderSplitsModal(P)), t); });
});

// ── C · the drill ───────────────────────────────────────────────────────────────────────────────────────────────
function drill(I, k, patch) { Object.assign(I.state, { drawDrill: k }, patch || {}); return I.renderSplitsModal(P); }
H.check('C1 · header: back arrow + "Draw record › Semi-finals", the row\'s W–L and Win % big', () => {
  const { I } = load();
  const html = drill(I, 'Semi-finals');
  assert(/data-pp2="draw-back"[^>]*aria-label="Back to the Draw record"/.test(html), 'back arrow');
  assert(/Draw record<\/span><span[^>]*>›<\/span><span data-pp2-draw-crumb="1"[^>]*>Semi-finals</.test(html), 'breadcrumb');
  assert(/data-pp2-draw-wl="1"[^>]*>44–46</.test(html), 'big W–L');
  assert(/data-pp2-draw-rate="1"[^>]*>48\.9%</.test(html), 'big Win %');
});
H.check('C2 · summary strip: record · win % · "P&L ±x.xxu over N of M priced matches" (sum of the rows printed)', () => {
  const { I } = load();
  const html = drill(I, 'Semi-finals');
  const M = I.drawDrillModel(P, FX.splits.career, 'career');
  const strip = T(/data-pp2-draw="summary"[\s\S]*?<\/div>/.exec(html)[0]);
  const want = 'P&L ' + (M.cents < 0 ? '−' : '+') + (Math.abs(M.cents) / 100).toFixed(2) + 'u over ' + M.priced + ' of 90 priced matches';
  assert(strip.includes('44–46') && strip.includes('48.9%') && strip.includes(want), strip);
  const sum = M.rows.reduce((a, r) => a + (r.price != null && !/W\/O/.test(r.m.sc) ? (r.won ? Math.round(r.price * 100) - 100 : -100) : 0), 0);
  assert.strictEqual(M.cents, sum, 'P&L = Σ rows');
  return strip.trim();
});
H.check('C3 · prices pending → the P&L slot is blank (never 0, never —); failed → "— · prices unavailable"', () => {
  let h = drill(load({ join: stubJoin('pending') }).I, 'Semi-finals');
  assert(/data-pp2-pending="draw-pl">&nbsp;</.test(h), 'pending blank');
  assert(!/over 0 of/.test(h) && !/P&amp;L —/.test(h), 'pending claims nothing');
  h = drill(load({ join: stubJoin('failed') }).I, 'Semi-finals');
  assert(/P&amp;L — · prices unavailable/.test(h), 'failed');
});
H.check('C4 · chips All / Wins / Losses carry their counts and filter the list', () => {
  const { I } = load();
  let h = drill(I, 'Semi-finals');
  assert(/>All 90</.test(h) && />Wins 44</.test(h) && />Losses 46</.test(h), 'chip counts');
  h = drill(I, 'Semi-finals', { drawFilter: 'L' });
  const sq = h.slice(h.indexOf('data-pp2-draw="list"')).match(/title="(Won|Lost)"/g) || [];
  assert.strictEqual(sq.length, 46); assert(sq.every(x => x === 'title="Lost"'), 'only losses');
});
H.check('C5 · newest first; 100 a page; Early rounds (491) pages 1–100 … 401–491', () => {
  const { I } = load();
  const M = (I.state.drawDrill = 'Early rounds', I.drawDrillModel(P, FX.splits.career, 'career'));
  for (let i = 1; i < M.rows.length; i++) assert(M.rows[i - 1].m.d >= M.rows[i].m.d, 'order at ' + i);
  let h = drill(I, 'Early rounds');
  assert.strictEqual((h.match(/data-pp2="draw-sheet"[^>]*style="[^"]*display:flex/g) || []).length, 100, 'page 1 rows');
  assert(/1–100 of 491/.test(T(h)), 'pager 1');
  h = drill(I, 'Early rounds', { drawPage: 4 });
  assert(/401–491 of 491/.test(T(h)), 'pager 5');
  assert.strictEqual((h.match(/data-pp2="draw-sheet"[^>]*style="[^"]*display:flex/g) || []).length, 91);
});
H.check('C6 · opened from Last 52, the list is that window only (= the Last 52 row)', () => {
  const { I } = load();
  I.state.drawDrill = 'Best of 3';
  const M = I.drawDrillModel(P, FX.splits.last52, 'last52');
  const a = FX.splits.last52['Best of 3'];
  assert.strictEqual(M.rows.length - (M.wo || 0), a.W + a.L);   // the Vienna 2025 walkover is listed, not counted
  assert(M.rows.every(r => r.m.d >= FX.file.cutoff52), 'a row before the cutoff');
  assert(/Last 52/.test(T(drill(I, 'Best of 3', { splitScope: 'last52' }))), 'scope named');
});
// Founder 2026-10-22 (ruling 1 closes the TEN-391 open question): listed, never a win or a loss.
H.check('C7 · a walkover is listed (WO under the date) with no price and no P&L, and is in no W–L', () => {
  const { I } = load();
  I.state.drawDrill = 'Quarter-finals';
  const M = I.drawDrillModel(P, FX.splits.career, 'career');
  const wo = M.rows.filter(r => r.sc.wo);
  assert.strictEqual(wo.length, 2, 'Vienna 2025 v Griekspoor + Acapulco 2021 v Ruud');
  wo.forEach(r => { assert.strictEqual(r.price, null); assert.strictEqual(r.cents, null); });
  assert.strictEqual(M.w + M.l, M.rows.length - 2, 'the two walkovers are in no W–L');
  const a = FX.splits.career['Quarter-finals']; assert.strictEqual(M.w + '–' + M.l, a.W + '–' + a.L, 'the row\'s own W–L');
  const h = drill(I, 'Quarter-finals');
  assert.strictEqual((h.match(/data-pp2-wo-row="1"/g) || []).length, 2, 'both painted, WO under the date');
  assert(/title="Walkover: not a match played, no price"/.test(h), 'reason on hover');
});
H.check('C8 · a loss reads from the player\'s side ("6-3 6-4" on a loss → "3-6 4-6"); tiebreaks and RET kept', () => {
  const { I } = load();
  assert.strictEqual(I.drawScore({ sc: '6-3 7-6(4)', wl: 'L' }).text, '3-6 6-7(4)');
  assert.strictEqual(I.drawScore({ sc: '6-3 7-6(4)', wl: 'W' }).text, '6-3 7-6(4)');
  const r = I.drawScore({ sc: '7-6(7) 1-0 RET', wl: 'W' });
  assert(r.ret && r.text === '7-6(7) 1-0' && r.setsW === 1 && r.setsL === 0, JSON.stringify(r));
  assert(I.drawScore({ sc: 'W/O', wl: 'L' }).wo);
  assert.strictEqual(I.drawScore({ sc: '6-7(5) 7-5 [10-5]', wl: 'L' }).text, '7-6(5) 5-7 [5-10]');
});
H.check('C9 · back arrow and Esc return to the summary; Career / Last 52 kept', () => {
  const m = load();
  const I = m.I;
  drill(I, 'Masters', { splitScope: 'last52' });
  // Esc through the module's own key handler
  const doc = { listeners: {} };
  assert(typeof I.onKey === 'function', 'onKey exported');
  I.onKey({ key: 'Escape' });
  assert.strictEqual(I.state.drawDrill, null, 'Esc closed the drill');
  assert.strictEqual(I.state.modal, 'splits', 'the modal stays open');
  assert.strictEqual(I.state.splitScope, 'last52', 'scope kept');
  assert(!/data-pp2-draw="drill"/.test(I.renderSplitsModal(P)), 'summary back');
  void doc;
});
H.check('C10 · an opponent with a profile is a link (data-pp2="draw-opp"); without one plain text', () => {
  // Alcaraz (2382) has a profile; Sinner (2072) is joined with a key but has none; the rest carry no key at all
  const { I } = load({ join: (k, n, rows) => { rows.forEach(r => {
    if (/Alcaraz/.test(r.opp)) r.careerMatch = { opponent: 'C. Alcaraz', opponentKey: 2382 };
    if (/Sinner/.test(r.opp)) r.careerMatch = { opponent: 'J. Sinner', opponentKey: 2072 }; }); return 'ready'; } });
  const h = drill(I, 'vs. Top 10');
  assert(/data-pp2="draw-opp" data-v="2382"[^>]*>C\. Alcaraz</.test(h), 'Alcaraz linked');
  assert(/>J\. Sinner</.test(h), 'Sinner listed');
  const links = h.match(/data-pp2="draw-opp" data-v="(\d+)"/g) || [];
  assert(links.length && links.every(x => /"2382"/.test(x)), 'a link without a profile: ' + links.join(' '));
});
H.check('C11 · a list that ever disagrees with its row says so (never trimmed or padded)', () => {
  const sp = JSON.parse(JSON.stringify(FX.splits)); sp.career.Finals = { W: 30, L: 14, M: 44 };
  const h = drill(load({ splits: sp }).I, 'Finals');
  assert(/data-pp2-draw="mismatch"/.test(h) && /holds 45 matches/.test(T(h)), T(h).slice(0, 300));
});
H.check('C12 · loading / none / failed states claim nothing about the player', () => {
  assert(/Loading the matches…/.test(drill(load({ file: { st: 'pending' } }).I, 'Masters')));
  assert(/No match list built for this player yet/.test(drill(load({ file: { st: 'none' } }).I, 'Masters')));
  assert(/could not be loaded/.test(drill(load({ file: { st: 'failed' } }).I, 'Masters')));
});

// ── D · the sheet ───────────────────────────────────────────────────────────────────────────────────────────────
H.check('D1 · every listed row carries the sheet hook; a joined row opens on its career match (event key, its prices)', () => {
  const { I } = load({ join: (k, n, rows) => { rows.forEach(r => { r.price = 1.4; r.oppPrice = 3.1; r.book = 'B';
    r.careerMatch = { date: '2026-08-30', opponent: 'K. Khachanov', opponentKey: 1, tournament: 'US Open', round: '1/2-finals',
      result: '3 - 0', won: true, sets: [{ p: 6, o: 3 }], eventKey: 999 }; }); return 'ready'; } });
  const h = drill(I, 'Semi-finals');
  assert.strictEqual((h.match(/data-pp2="draw-sheet"/g) || []).length, 90 * 9, 'every cell of every row');
  I.state.drawDrill = 'Semi-finals';
  const M = I.drawDrillModel(P, FX.splits.career, 'career');
  const x = I.drawSheetPayload(P, M.rows[0]);
  assert.strictEqual(x.row.eventKey, 999); assert.strictEqual(x.book, 'B'); assert.strictEqual(x.src, 'td'); assert.strictEqual(x.price, 1.4);
});
H.check('D2 · an unjoined row opens the sheet on its own date, score and event (no event key, no price invented)', () => {
  const { I } = load({ join: stubJoin('pending') });
  I.state.drawDrill = 'Semi-finals';
  const M = I.drawDrillModel(P, FX.splits.career, 'career');
  const loss = M.rows.find(r => !r.won && !r.sc.ret);
  const x = I.drawSheetPayload(P, loss);
  assert.strictEqual(x.row.eventKey, null); assert.strictEqual(x.price, null); assert.strictEqual(x.book, null);
  assert(/^0 - [23]$|^1 - [23]$/.test(x.row.result), x.row.result);
  assert(x.scored && x.row.sets.every(s => s.p != null && s.o != null));
});

// ── E · the host bridge ─────────────────────────────────────────────────────────────────────────────────────────
function slice(src, name, from) {
  const s = src.indexOf('function ' + name + '(', from || 0);
  assert(s >= 0, name + ' not found');
  let d = 0, i = src.indexOf('{', s);
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) break; }
  return src.slice(s, i + 1);
}
H.check('E1 · pp2DrawJoin prices a row through the real h2hPriceJoin and hands back the career match it met', () => {
  const h0 = HTML.indexOf('function h2hTdSame(');
  const before = h0 - 8000;
  const bridge = HTML.slice(HTML.indexOf('window.pp2DrawJoin = function'), HTML.indexOf('// An opponent\'s profile, when one exists'));
  const api = new Function('window', `
    const H2H_PAGE_PRICE_WINDOW=[-3,16],H2H_PAGE_MATCH_WINDOW=[-1,1],H2H_PAGE_START_WINDOW=[-3,4],H2H_PAGE_ROW_WINDOW=[-3,24];
    const H2H_TD_ROUND={'The Final':'F','Semifinals':'SF','Quarterfinals':'QF','Round Robin':'RR'};const H2H_PAGE_BEFORE_RANK=1000;
    ${HTML.match(/function fhDayNum[^\n]*/)[0]}
    ${HTML.match(/function fhIsInitial[^\n]*/)[0]}
    ${slice(HTML, 'fhNameKey')}
    const fhRoundCode = r => r || null;
    ${slice(HTML, 'h2hTdKey', before)}${slice(HTML, 'h2hTdIx', before)}${slice(HTML, 'h2hTdSame', h0)}${slice(HTML, 'h2hTdRound', h0)}
    ${slice(HTML, 'h2hTdEvent', h0)}${slice(HTML, 'h2hNearest', h0)}${slice(HTML, 'h2hPriceJoin', h0)}
    const _trProfileFail = new Set(); let _sfDbJoinSt = 'ready';
    const _careerHistoryShards = { '1980': [
      { date: '2025-10-24', opponent: 'L. Musetti', opponentKey: 7, won: true, round: 'SF', eventKey: 4242, tournament: 'Vienna' },
      { date: '2025-10-26', opponent: 'J. Sinner', opponentKey: 9, won: false, round: 'F', eventKey: 4243, tournament: 'Vienna' } ] };
    const _sfDbJoin = { meta: { rounds: ['Semifinals', 'The Final'] }, rows: [[20251026, 2, 0, 1, 7, 1.10, 7.00, 1, 0]], names: [['Sinner J.', 'Zverev A.']] };
    window.H2HPage = { priceJoin: h2hPriceJoin };
    ${bridge}
    return { join: window.pp2DrawJoin, setSt: v => { _sfDbJoinSt = v; } };`)({});
  const rows = [
    { date: '2025-10-20', won: false, round: 'F', opp: 'Jannik Sinner' },
    { date: '2025-10-20', won: true, round: 'SF', opp: 'Lorenzo Musetti' }];
  assert.strictEqual(api.join('1980', 'A. Zverev', rows), 'ready');
  assert.strictEqual(rows[0].price, 7.00); assert.strictEqual(rows[0].oppPrice, 1.10); assert.strictEqual(rows[0].book, 'P');
  assert.strictEqual(rows[0].careerMatch.eventKey, 4243, 'F → its career match');
  assert.strictEqual(rows[1].price, undefined, 'SF has no Database row: unpriced');
  assert.strictEqual(rows[1].careerMatch.eventKey, 4242, 'SF still met its career match (the sheet opens on it)');
  api.setSt('loading'); assert.strictEqual(api.join('1980', 'A. Zverev', [{ date: '2025-10-20', won: true, opp: 'X Y' }]), 'pending');
  api.setSt('failed'); assert.strictEqual(api.join('1980', 'A. Zverev', []), 'failed');
});
H.check('E2 · the match file loads lazily: requested by opening a row (pp2DrawNeed), never at profile open', () => {
  const need = HTML.indexOf('function pp2DrawNeed(');
  assert(need > 0, 'pp2DrawNeed');
  assert((HTML.match(/pp2DrawNeed\(/g) || []).length === 1, 'the page itself never calls it');
  const src = fs.readFileSync(SRC, 'utf8');
  assert(/kind === 'draw-row'[\s\S]{0,200}window\.pp2DrawNeed\(state\.key\)/.test(src), 'a row click asks for it');
});

H.done();
