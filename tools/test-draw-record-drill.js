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
  Object.assign(m.I.state, { key: KEY, modal: 'splits', splitScope: 'career', splitTab: 'results', splView: 'results', fb: null, lcDrillRes: null, drawDrill: null, drawFilter: 'all', drawPage: 0 });
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

// ── B · the summary (profile v2, founder 2026-11-09: Level & round, the export's splitsData) ─────────────────────
// The four cards read the same per-match file the drills list, so every row's W–L IS its drill's; the rows that
// share a Tennis Abstract split must also equal that split (the figures the old Draw record printed).
const V2_TA = { 'By round|Quarter-finals': 'Quarter-finals', 'By round|Semi-finals': 'Semi-finals',
  'By round|Finals': 'Finals', 'Level|Grand Slams': 'Grand Slams', 'Level|Masters 1000': 'Masters', 'Opponent rank|vs Top 10': 'vs. Top 10',
  'Extra stats|vs Righties': 'vs. Righties', 'Extra stats|vs Lefties': 'vs. Lefties', 'Extra stats|Best of 5': 'Best of 5', 'Extra stats|Best of 3': 'Best of 3' };
function box(I, v, which) { const fb = I.FB_BUILD[which || 'spl'](P, v); assert(fb, 'no box for ' + v); return fb; }
H.check('B1 · the four cards; every row with matches opens its drill box; the rows shared with Tennis Abstract equal its splits (Career and Last 52)', () => {
  const { I } = load();
  ['career', 'last52'].forEach(scope => {
    I.state.splitScope = scope;
    const html = I.renderSplitsModal(P);
    ['BY ROUND', 'LEVEL', 'OPPONENT RANK', 'EXTRA STATS'].forEach(g => assert(T(html).toUpperCase().includes(g), 'card ' + g));
    Object.keys(V2_TA).forEach(v => {
      const a = FX.splits[scope][V2_TA[v]];
      if (!a || !(a.W + a.L)) return;
      assert(html.includes('data-pp2="fb-open" data-box="spl" data-v="' + v + '"'), scope + ' ' + v + ' not clickable');
      const fb = box(I, v);
      assert(fb.meta.startsWith(a.W + '–' + a.L + ' '), scope + ' ' + v + ': ' + fb.meta + ' vs TA ' + a.W + '–' + a.L);
    });
  });
  I.state.splitScope = 'career';
  assert(/>44–46</.test(I.renderSplitsModal(P)), 'Semi-finals W–L');
});
H.check('B1b · By round numbers rounds from the draw (founder 2026-11-10): Round 1–4 together = Tennis Abstract\'s Round of 16–128', () => {
  const { I } = load();
  ['career', 'last52'].forEach(scope => {
    I.state.splitScope = scope;
    const S = I.splModel(P), sc = FX.splits[scope];
    const early = S.groups['By round'].filter(x => /^Round [1-4]$/.test(x.label));
    assert.deepStrictEqual(S.groups['By round'].map(x => x.label),
      ['Round 1', 'Round 2', 'Round 3', 'Round 4', 'Quarter-finals', 'Semi-finals', 'Finals']);
    let W = 0, Lo = 0;
    ['Round of 16', 'Round of 32', 'Round of 64', 'Round of 128'].forEach(r => { if (sc[r]) { W += sc[r].W; Lo += sc[r].L; } });
    assert.strictEqual(early.reduce((a, x) => a + x.s.w, 0) + '–' + early.reduce((a, x) => a + x.s.l, 0), W + '–' + Lo, scope);
  });
  I.state.splitScope = 'career';
});
H.check('B1c · the draw\'s first round: a Slam R128, a 96-draw Masters R128, another Masters R64, a 250 R32 — a bye still counts', () => {
  const { I } = load();
  const rows = ms => ms.map(m => ({ m }));
  const key = I.splRoundKeyer(rows([]));
  assert.strictEqual(key({ t: 'Wimbledon', lv: 'G', rd: 'R128', d: '20250630' }), 1);
  assert.strictEqual(key({ t: 'Wimbledon', lv: 'G', rd: 'R16', d: '20250630' }), 4);
  assert.strictEqual(key({ t: 'Indian Wells Masters', lv: 'M', rd: 'R64', d: '20250306' }), 2, 'a 96-draw seed\'s first match');
  assert.strictEqual(key({ t: 'Monte Carlo Masters', lv: 'M', rd: 'R32', d: '20250406' }), 2, 'a 56-draw seed\'s first match');
  assert.strictEqual(key({ t: 'Rome Masters', lv: 'M', rd: 'R64', d: '20220509' }), 1, 'Rome was a 56 draw before 2023');
  assert.strictEqual(key({ t: 'Rome Masters', lv: 'M', rd: 'R64', d: '20240509' }), 2, 'Rome is a 96 draw from 2023');
  assert.strictEqual(key({ t: 'Stockholm', lv: 'A', rd: 'R16', d: '20251013' }), 2, 'a 28-draw seed\'s first match');
  assert.strictEqual(key({ t: 'Stockholm', lv: 'A', rd: 'QF', d: '20251013' }), 'QF');
  // his own earlier round at an event moves its first round back (a 48-draw 250 has an R64)
  const k2 = I.splRoundKeyer(rows([{ t: 'Winston-Salem', lv: 'A', rd: 'R64', d: '20190818' }]));
  assert.strictEqual(k2({ t: 'Winston-Salem', lv: 'A', rd: 'R32', d: '20210822' }), 2);
});
H.check('B2 · every view keeps the hooks; a row with no match (Challenger: not in this source) opens nothing', () => {
  const { I } = load();
  ['results', 'sets', 'service'].forEach(v => {
    I.state.splView = v;
    const h = I.renderSplitsModal(P);
    assert(/data-box="spl" data-v="By round\|Semi-finals"/.test(h), v);
    assert(!/data-v="Level\|Challenger"/.test(h), 'Challenger clickable in ' + v);
  });
  I.state.splView = 'results';
});
H.check('B3 · W–L cells never wrap (a 4-digit career record stays on one line)', () => {
  const { I } = load();
  const h = I.renderSplitsModal(P);
  const cell = />582–240<|>[0-9]+–[0-9]+</.exec(h);
  assert(cell, 'no W–L cell');
  const before = h.slice(0, cell.index);
  assert(/white-space:nowrap;[^"]*"\s*$/.test(before.slice(before.lastIndexOf('style="'))) || /white-space:nowrap/.test(before.slice(before.lastIndexOf('<span'))), 'W–L cell wraps');
});
H.check('B4 · Level and By round partition the counted matches (Team events / ATP Finals rows; round robin is the only round left out)', () => {
  const { I } = load();
  const S = I.splModel(P);
  const n = S.base.n, lv = S.groups.Level.reduce((a, x) => a + x.s.n, 0), rd = S.groups['By round'].reduce((a, x) => a + x.s.n, 0);
  const rr = S.rows.filter(r => !r.sc.wo && !/^(R128|R64|R32|R16|QF|SF|F)$/.test(r.m.rd)).length;
  assert.strictEqual(lv, n, 'Level sums to ' + lv + ' of ' + n);
  assert.strictEqual(rd + rr, n, 'By round + other rounds');
  return `${n} matches · Level ${lv} · By round ${rd} + ${rr} other`;
});

// ── C · the drill box ───────────────────────────────────────────────────────────────────────────────────────────
H.check('C1 · header: the row\'s name and group, its W–L and win % in the meta line', () => {
  const { I } = load();
  const fb = box(I, 'By round|Semi-finals');
  assert.strictEqual(fb.name, 'Semi-finals'); assert.strictEqual(fb.code, 'By round');
  assert(fb.meta.startsWith('44–46 · 48.9% · 90 matches'), fb.meta);
});
H.check('C2 · On the price = Σ flat 1u over the counted priced rows, with its priced denominator', () => {
  const { I } = load();
  const fb = box(I, 'By round|Semi-finals');
  const t = fb.tiles.find(x => x.label === 'On the price');
  const S = I.splModel(P), rows = S.groups['By round'].find(x => x.label === 'Semi-finals').rows.filter(r => !r.sc.wo);
  const pr = rows.filter(r => r.cents != null), sum = pr.reduce((a, r) => a + r.cents, 0);
  const want = (sum < 0 ? '−' : '+') + (Math.abs(sum) / 100).toFixed(2) + 'u';
  assert(t.sub.startsWith(want) && t.sub.includes('on ' + pr.length + ' of 90 priced'), t.sub + ' vs ' + want);
  return t.fig + ' · ' + t.sub;
});
H.check('C3 · prices pending → the tile and the price cells are blank (never 0, never —); failed → "prices unavailable"', () => {
  let I = load({ join: stubJoin('pending') }).I;
  let fb = box(I, 'By round|Semi-finals');
  const t = fb.tiles.find(x => x.label === 'On the price');
  assert(/data-pp2-pending="spl-pl"/.test(t.fig), 'pending fig');
  assert(fb.rows.filter(r => !/wo-row/.test(r.attr || '')).every(r => r.cells[6].html === '' && r.cells[8].html === ''), 'pending price cells not blank');
  I = load({ join: stubJoin('failed') }).I;
  fb = box(I, 'By round|Semi-finals');
  assert.strictEqual(fb.tiles.find(x => x.label === 'On the price').sub, 'prices unavailable');
});
H.check('C4 · newest first, every match of the row listed (no paging)', () => {
  const { I } = load();
  const fb = box(I, 'By round|Round 2');
  const S = I.splModel(P), n = S.groups['By round'].find(x => x.label === 'Round 2').rows.length;
  assert.strictEqual(fb.rows.length, n);
  const ds = fb.rows.map(r => r.cells[1].html);
  const iso = d => d.split('.').reverse().join('');
  for (let i = 1; i < ds.length; i++) assert(iso(ds[i - 1]) >= iso(ds[i]), 'order at ' + i);
});
H.check('C5 · Last 52: the box lists that window only (= the Last 52 row)', () => {
  const { I } = load();
  I.state.splitScope = 'last52';
  const S = I.splModel(P);
  assert(S.rows.every(r => r.m.d >= FX.file.cutoff52), 'a row before the cutoff');
  const a = FX.splits.last52['Best of 3'], fb = box(I, 'Extra stats|Best of 3');
  assert(fb.meta.startsWith(a.W + '–' + a.L + ' ') && /last 52 weeks$/.test(fb.meta), fb.meta);
});
H.check('C6 · a walkover is listed (no sheet hook, no price, no P&L) and is in no W–L', () => {
  const { I } = load();
  const fb = box(I, 'By round|Quarter-finals');
  const wo = fb.rows.filter(r => /data-pp2-wo-row="1"/.test(r.attr || ''));
  assert.strictEqual(wo.length, 2, 'Vienna 2025 v Griekspoor + Acapulco 2021 v Ruud');
  wo.forEach(r => { assert.strictEqual(r.hook, ''); assert.strictEqual(r.cells[5].html, 'WO'); assert.strictEqual(r.cells[8].html, '—'); });
  assert(fb.rows.filter(r => !/wo-row/.test(r.attr || '')).every(r => /data-pp2="draw-sheet"/.test(r.hook)), 'a played row without its sheet');
  const a = FX.splits.career['Quarter-finals'];
  assert(fb.meta.startsWith(a.W + '–' + a.L + ' '), fb.meta);
  assert.strictEqual(fb.rows.length, a.W + a.L + 2);
});
H.check('C7 · a loss reads from the player\'s side ("6-3 6-4" on a loss → "3-6 4-6"); tiebreaks and RET kept', () => {
  const { I } = load();
  assert.strictEqual(I.drawScore({ sc: '6-3 7-6(4)', wl: 'L' }).text, '3-6 6-7(4)');
  assert.strictEqual(I.drawScore({ sc: '6-3 7-6(4)', wl: 'W' }).text, '6-3 7-6(4)');
  const r = I.drawScore({ sc: '7-6(7) 1-0 RET', wl: 'W' });
  assert(r.ret && r.text === '7-6(7) 1-0' && r.setsW === 1 && r.setsL === 0, JSON.stringify(r));
  assert(I.drawScore({ sc: 'W/O', wl: 'L' }).wo);
  assert.strictEqual(I.drawScore({ sc: '6-7(5) 7-5 [10-5]', wl: 'L' }).text, '7-6(5) 5-7 [5-10]');
});
H.check('C8 · Esc closes the drill box first; the modal and Career / Last 52 stay', () => {
  const { I } = load();
  Object.assign(I.state, { splitScope: 'last52', fb: { box: 'spl', v: 'Level|Masters 1000' } });
  I.onKey({ key: 'Escape' });
  assert.strictEqual(I.state.fb, null, 'Esc closed the box');
  assert.strictEqual(I.state.modal, 'splits', 'the modal stays open');
  assert.strictEqual(I.state.splitScope, 'last52', 'scope kept');
});
H.check('C9 · an opponent with a profile is a link (data-pp2="draw-opp"); without one plain text', () => {
  const { I } = load({ join: (k, n, rows) => { rows.forEach(r => {
    if (/Alcaraz/.test(r.opp)) r.careerMatch = { opponent: 'C. Alcaraz', opponentKey: 2382 };
    if (/Sinner/.test(r.opp)) r.careerMatch = { opponent: 'J. Sinner', opponentKey: 2072 }; }); return 'ready'; } });
  const h = I.splModel(P).groups.Level.filter(x => x.s.n).map(x => box(I, 'Level|' + x.label).rows.map(r => r.cells[2].html).join('')).join('');
  assert(/data-pp2="draw-opp" data-v="2382"[^>]*>C\. Alcaraz</.test(h), 'Alcaraz linked');
  assert(h.includes('J. Sinner') && !/data-v="2072"/.test(h), 'Sinner listed, not linked');
  const links = h.match(/data-pp2="draw-opp" data-v="(\d+)"/g) || [];
  assert(links.length && links.every(x => /"2382"/.test(x)), 'a link without a profile: ' + links.join(' '));
});
H.check('C10 · loading / no file / failed states claim nothing about the player', () => {
  assert(/Loading his matches/.test(load({ file: { st: 'pending' } }).I.renderSplitsModal(P)));
  assert(/No match list on file for this player yet/.test(load({ file: { st: 'none' } }).I.renderSplitsModal(P)));
  assert(/did not load/.test(load({ file: { st: 'failed' } }).I.renderSplitsModal(P)));
});
H.check('C11 · the tiebreak box: every 7–6 set of the counted matches, Won / Lost pills filter it', () => {
  const { I } = load();
  const S = I.splModel(P);
  let n = 0; S.rows.forEach(r => { if (!r.sc.wo) (r.sc.sets || []).forEach(x => { if ((x.p === 7 && x.o === 6) || (x.p === 6 && x.o === 7)) n++; }); });
  let fb = box(I, '', 'spltb');
  assert.strictEqual(fb.rows.length, n, 'tiebreaks listed');
  assert(fb.meta.includes(n + ' tiebreaks'), fb.meta);
  I.state.lcDrillRes = 'lost';
  fb = box(I, '', 'spltb');
  assert(fb.rows.every(r => r.cells[8].html === 'Lost') && fb.rows.length < n, 'Lost filter');
  I.state.lcDrillRes = null;
  return n + ' tiebreaks';
});

// ── D · the sheet ───────────────────────────────────────────────────────────────────────────────────────────────
H.check('D1 · a joined row opens on its career match (event key, its prices)', () => {
  const { I } = load({ join: (k, n, rows) => { rows.forEach(r => { r.price = 1.4; r.oppPrice = 3.1; r.book = 'B';
    r.careerMatch = { date: '2026-08-30', opponent: 'K. Khachanov', opponentKey: 1, tournament: 'US Open', round: '1/2-finals',
      result: '3 - 0', won: true, sets: [{ p: 6, o: 3 }], eventKey: 999 }; }); return 'ready'; } });
  const fb = box(I, 'By round|Semi-finals');
  assert.strictEqual(fb.rows.filter(r => /data-pp2="draw-sheet"/.test(r.hook)).length, 90, 'every played row');
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
  assert(/function renderSplitsModalV2\(p\) \{\s*if \(typeof window\.pp2DrawNeed === 'function'\) window\.pp2DrawNeed\(p\.key\);/.test(src), 'opening Level & round asks for it');
});

H.done();
