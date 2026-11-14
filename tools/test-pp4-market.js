#!/usr/bin/env node
// Profile v4 (handoff 2026-11-14, CHANGES §8) · Market edge, both pages, on the shipped module and the pinned player
// fixture. Structure checks for the v4 layout + the no-placeholder / dash rules. Each check was red on the v3 build
// (2f9f6c80f): the v3 strip printed "vs tour … · flat 1u stake", tinted every bar by sign, had a Matches column and a
// table of lines; it drew no chip grid, no picked-line panel and no Price sensitivity role groups.
const fs = require('fs'), path = require('path'), assert = require('assert');
const L = require('./ten384-figures-lib.js');
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten384-figures', 'player-2840.json'), 'utf8'));
const H = L.harness();
const SRC = process.env.PP4_SRC || path.join(L.ROOT, 'player-profile-v2.js');   // PP4_SRC: run against another build (the pre-change control)
function load(src, extra) {
  const p = JSON.parse(JSON.stringify(FX.profile)); p.tournamentHistory = FX.tournamentHistory;
  const m = L.loadPp2(Object.assign({ src: src || SRC, now: FX.asOf, players: { [FX.key]: p }, careerHistory: { [FX.key]: FX.careerHistory },
    marketEdge: { [FX.key]: FX.marketEdge }, bet365History: FX.bet365History }, extra || {}));
  return { I: m.I, p, W: m.W };
}
const { I, p } = load();
const withState = (st, fn) => { const saved = Object.assign({}, I.state); Object.assign(I.state, st); try { return fn(); } finally { Object.keys(I.state).forEach((k) => delete I.state[k]); Object.assign(I.state, saved); } };
const T = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
const win = (st) => withState(Object.assign({ key: p.key, marketTab: 'winner' }, st || {}), () => I.renderMarketModal(p));
const lines = (st) => withState(Object.assign({ key: p.key, marketTab: 'lines' }, st || {}), () => I.renderMarketModal(p));
const cells = (h) => h.match(/<div data-pp2="mk-role"[\s\S]*?(?=<div data-pp2="mk-role"|<div data-mk-chart)/g) || [];

// ── §8.1 Match winner ──
H.check('8.1 role strip: three cells padded 20/24, meta "n matches", subline "tour …", no "vs tour" / "flat 1u" wording', () => {
  const h = win(), cs = cells(h);
  assert.strictEqual(cs.length, 3, 'cells ' + cs.length);
  cs.forEach((c, i) => {
    assert(/padding:20px (24px|48px) 20px 24px/.test(c), 'cell ' + i + ' padding');
    assert(/data-mk-meta[^>]*>(\d+ matches?|no matches)</.test(c), 'cell ' + i + ' meta');
    assert(/data-mk-sub[^>]*>(tour [+−]\d+\.\d\d%|tour —|nothing priced in this filter)</.test(c), 'cell ' + i + ' subline: ' + T(c));
  });
  assert(!/vs tour|flat 1u/.test(T(h)), 'v3 wording left: ' + (T(h).match(/.{20}(vs tour|flat 1u).{20}/) || [])[0]);
  return 'three cells';
});
H.check('8.1 / §0.1 the strip bar is neutral unless its role is selected, then blue; never by value', () => {
  ['all', 'fav', 'dog'].forEach((role) => {
    const cs = cells(win({ mkRole: role }));
    cs.forEach((c) => {
      const on = /data-v="(\w+)"/.exec(c)[1] === role, bar = /data-mk-bar[^>]*background:([^;"]+)/.exec(c);
      assert(bar, 'no bar');
      assert.strictEqual(bar[1], on ? 'var(--pp-x-link)' : 'var(--pp-x-bar-neutral)', role + ': bar ' + bar[1]);
    });
  });
  return 'selected = blue, rest neutral, in all three roles';
});
H.check('8.1 no placeholder tour figure: with no tour-baselines file the subline reads "tour —" and no gap prints; a real file prints its own figure', () => {
  cells(win()).forEach((c) => {
    if (/nothing priced/.test(c)) return;
    assert(/data-mk-sub[^>]*>tour \u2014</.test(c), 'subline ' + T(c));
    assert(/data-mk-gap[^>]*><\/span>/.test(c), 'a gap printed without a tour figure');
  });
  const B = load(null, { extra: { tourBaselines: { roles: { all: { yield: -0.0401 }, favourite: { yield: -0.0222 }, underdog: { yield: -0.0633 } } } } });
  const h = (() => { const st = B.I.state; Object.assign(st, { key: B.p.key, marketTab: 'winner' }); return B.I.renderMarketModal(B.p); })();
  assert(/>tour \u22124\.01%</.test(h) && />tour \u22122\.22%</.test(h) && />tour \u22126\.33%</.test(h), 'the file figures');
  assert(!/3\.79%|2\.14%|5\.44%/.test(h), 'the reference placeholder tour figure');
  return 'dashed without the file, the file\'s own figures with it';
});
H.check('8.1 chart: padding 24, one head line (caps title + n matches, total right), "break even" in sentence case, units (founder 2026-11-14)', () => {
  const h = win(), ch = /<div data-mk-chart[\s\S]*$/.exec(h)[0];
  assert(/data-mk-chart style="padding:24px 24px 20px;/.test(h), 'chart padding');
  assert(/>break even<\/span>/.test(ch) && !/text-transform:uppercase;[^"]*">break even/.test(ch), 'break even caps');
  assert(/data-mk-total[^>]*>([+−]\d+\.\du|—)</.test(ch), 'total in units');
  assert(!/RETURN · FLAT|Return · flat/i.test(T(ch)) && !/white-space:nowrap;">[+−]?[\d.]+%<\/span>/.test(ch), 'second caption or a % axis on the chart');
  return 'one head line';
});
H.check('8.1 Price sensitivity (LOCKED): one card 22/24/6, two role groups on All, one on a picked role, 58px rows on the locked grid, no Matches column, no total row', () => {
  const h = win(), ps = /<div data-mk-ps [\s\S]*$/.exec(h)[0];
  assert(/data-mk-ps style="[^"]*border-radius:16px;padding:22px 24px 6px;/.test(h), 'card');
  assert.deepStrictEqual((ps.match(/data-mk-psgroup="(\w+)"/g) || []).map((x) => x.slice(17, -1)), ['fav', 'dog']);
  // one 58px row per MK_BANDS entry (the band count is not pinned here: the ladder may grow, rows follow MK_BANDS)
  const ids = (ps.match(/data-mk-band="(\d+)"/g) || []).map((x) => +/(\d+)/.exec(x)[1]);
  assert(ids.length >= 8 && ids.every((v, i) => v === i), 'band rows not one per band in order: ' + ids.join(','));
  assert.strictEqual((ps.match(/min-height:58px/g) || []).length, ids.length, '58px band rows');
  assert((ps.match(/grid-template-columns:minmax\(120px,200px\) 64px 64px minmax\(0,1fr\) 68px;gap:0 20px;/g) || []).length === ids.length + 2, 'locked grid');
  const heads = (ps.match(/<span[^>]*>(Price|W–L|Win %|Yield vs break even|Yield)<\/span>/g) || []).length;
  assert.strictEqual(heads, 10, 'heads ' + heads);
  assert(!/>Matches</.test(ps) && !/>Total</.test(ps), 'a Matches column or a total row');
  assert(/margin:0 -24px;padding:26px 24px 0;border-top:1px solid var\(--edge-10\)/.test(ps), 'second group: full-bleed 10% hairline + 26px');
  const fav = win({ mkRole: 'fav' });
  assert.deepStrictEqual((fav.match(/data-mk-psgroup="(\w+)"/g) || []).map((x) => x.slice(17, -1)), ['fav'], 'a picked role draws one group');
  return 'locked layout';
});
H.check('8.1 Price sensitivity: one scale across the bands (max half-width 46%), bars green / red by sign, a thin band dashes', () => {
  const ps = /<div data-mk-ps [\s\S]*$/.exec(win())[0];
  const ws = (ps.match(/data-mk-psbar style="[^"]*width:([\d.]+)%/g) || []).map((x) => +/width:([\d.]+)%/.exec(x)[1]);
  assert(ws.length && Math.max.apply(null, ws) === 46, 'max half-width ' + Math.max.apply(null, ws));
  (ps.match(/data-mk-psbar style="[^"]*"/g) || []).forEach((b) => assert(/background:var\(--(pos|neg)\)/.test(b), 'bar colour ' + b));
  return ws.length + ' bars, widest 46%';
});
H.check('8.1 a role under 5 priced matches shows its count and a dash, never a yield', () => {
  let seen = 0;
  for (const surf of ['all', 'Hard', 'Clay', 'Grass', 'Indoors']) for (const w of ['l52', 'l24', 'career']) {
    const cs = cells(win({ mkSurf: surf, mkWin: w }));
    assert.strictEqual(cs.length, 3, 'role cells ' + cs.length);
    cs.forEach((c) => {
      const m = /data-mk-meta[^>]*>(\d+) match/.exec(c); if (!m || +m[1] >= 5) return;
      seen++;
      assert(/data-mk-yield[^>]*>—</.test(c), 'a yield on ' + m[1] + ' matches: ' + T(c));
    });
  }
  if (!seen) throw new Error('no role with 1–4 priced matches in any surface × window: nothing measured (a vacuous pass is not a pass)');
  return seen + ' thin cells dashed';
});

// ── §8.2 Derived lines ──
const chipsOf = (h) => (h.match(/<span [^>]*data-lc-chip="[^"]+"[^>]*>/g) || []);
H.check('8.2 every line is a 40px chip: best of 3 = 16 games handicap + 20 totals + 2 set handicap; best of 5 = 12 + 6 + 4', () => {
  const b3 = chipsOf(lines()), b5 = chipsOf(lines({ lcFmt: 'bo5' }));
  assert.strictEqual(b3.length, 38, 'bo3 ' + b3.length); assert.strictEqual(b5.length, 22, 'bo5 ' + b5.length);
  b3.concat(b5).forEach((c) => assert(/height:40px;border-radius:8px;/.test(c), 'chip geometry'));
  const h = lines();
  ['Minus', 'Plus', 'Over', 'Under'].forEach((l) => assert(new RegExp('>' + l + '</span>').test(h), 'row label ' + l));
  assert(/>Wins 2–0</.test(h) && />Wins a set</.test(h), 'best-of-3 set wording');
  const h5 = lines({ lcFmt: 'bo5' });
  ['Wins 3–0', 'Wins 3–0 or 3–1', 'Wins two sets', 'Wins a set'].forEach((w) => assert(h5.includes('>' + w + '<'), 'bo5 set wording ' + w));
  assert(!/>Vs field<|>Coverage by line/.test(h), 'the v3 table is back');
  return '38 + 22 chips';
});
H.check('8.2 grids: role strip minmax(0,1fr) minmax(0,1fr) 340px, body minmax(0,1fr) 340px, (?) at right:364px, no foot note', () => {
  const h = lines();
  assert(/grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\) 340px;/.test(h), 'strip grid');
  assert(/grid-template-columns:minmax\(0,1fr\) 340px;/.test(h), 'body grid');
  assert(/top:22px;right:364px;/.test(h), '(?) placement');
  assert(!/have no closing price|Retirements are left out of every line\./.test(T(h)), 'a foot note');
  return 'grids';
});
H.check('8.2 a favourite: plus games lines above +1.5 are outlined, faint chips with no figure and no click', () => {
  const cs = chipsOf(lines({ lcRole: 'fav' }));
  const off = cs.filter((c) => /data-lc-off/.test(c)).map((c) => /data-lc-chip="([^"]+)"/.exec(c)[1]);
  assert.deepStrictEqual(off, ['+2 games', '+2.5 games', '+3 games', '+3.5 games', '+4 games', '+4.5 games']);
  cs.filter((c) => /data-lc-off/.test(c)).forEach((c) => {
    assert(!/data-pp2="lc-pick"/.test(c) && /background:transparent/.test(c) && /inset 0 0 0 1px var\(--edge-6\)/.test(c) && /var\(--pp-x-bar-neutral\)/.test(c), 'off chip ' + c);
  });
  return off.length + ' not offered';
});
H.check('8.2 chip colour = HIS cover rate (green ≥ 50, red below, full at 35pp); grey under 5 matches', () => {
  const d = I.lineCoverage(p, 'bo3', 'all', {});
  const row = {}; d.groups.forEach((g) => g.rows.forEach((r) => { row[r.label] = r; }));
  let n = 0;
  const all = chipsOf(lines());
  assert.strictEqual(all.length, 38, 'chips ' + all.length);
  all.forEach((c) => {
    const lab = /data-lc-chip="([^"]+)"/.exec(c)[1], r = row[lab], rn = r.n - (r.voids || 0);
    if (rn < 5) { assert(/data-lc-thin/.test(c) && /var\(--text\) 4%/.test(c), lab + ': thin not grey'); return; }
    const a = 10 + 75 * Math.min(1, Math.abs(r.rate - 50) / 35);
    assert(c.includes('var(' + (r.rate >= 50 ? '--pos' : '--neg') + ') ' + a.toFixed(0) + '%'), lab + ': tint for ' + r.rate.toFixed(1));
    n++;
  });
  return n + ' chips tinted by his rate';
});
H.check('8.2 the panel: default pick = the rated line with the largest gap above the field (else his highest rate); a chip click only picks; the pick survives a filter change', () => {
  const h = lines(), m = I.lineCoverage(p, 'bo3', 'all', {});
  const picked = /data-lc-picked/.test(h) ? /data-lc-chip="([^"]+)"[^>]*data-lc-picked/.exec(h)[1] : null;
  const rated = []; m.groups.forEach((g) => g.rows.forEach((r) => { if (r.n - (r.voids || 0) >= 5 && r.rate != null) rated.push(r); }));
  const best = rated.reduce((b, r) => (r.rate > b.rate ? r : b));   // the fixture carries no field file: the rate fallback
  assert.strictEqual(picked, best.label, 'default pick ' + picked);
  assert(/data-lc-pickname[^>]*>/.test(h) && h.includes('data-box="lcline" data-v="' + picked + '"'), 'panel button → line box');
  assert(/See the \d+ matches ›/.test(T(h)), 'button wording');
  const h2 = lines({ lcPick: '+2.5 games', lcSurf: 'hard' });
  assert(/data-lc-chip="\+2\.5 games"[^>]*data-lc-picked/.test(h2), 'pick lost on a filter change');
  assert(!/data-pp2="fb-open"[^>]*data-lc-chip/.test(h), 'a chip opens the match box');
  return 'default ' + picked + ' · pick kept';
});
H.check('8.2 the panel: rate 36px, "Covers n in 10 · word" on the 8 / 6 / 4 cut-offs, Record · Last N · Longest run of misses · Against the field', () => {
  const h = lines({ lcPick: '+2.5 games' }), pan = /<div data-lc-panel[\s\S]*$/.exec(h)[0];
  assert(/data-lc-rate style="[^"]*font-size:36px/.test(pan), 'rate size');
  const w = /data-lc-word[^>]*>([^<]+)</.exec(pan)[1];
  const m = /^Covers (\d+) in 10 · (very reliable|reliable|coin flip|unreliable)$/.exec(w);
  assert(m, 'word ' + w);
  const k = +m[1], want = k >= 8 ? 'very reliable' : k >= 6 ? 'reliable' : k >= 4 ? 'coin flip' : 'unreliable';
  assert.strictEqual(m[2], want);
  ['Record', 'Longest run of misses', 'Against the field'].forEach((t) => assert(pan.includes('>' + t + '<'), t));
  assert(/>Last \d+</.test(pan), 'Last N');
  assert(/field covers \d+\.\d%|field —/.test(T(pan)), 'field line');
  return w;
});
H.check('8.2 no field file → Against the field is a dash and no chip carries the "above the field" dot (no placeholder field)', () => {
  const h = lines();
  assert(!/data-lc-dot/.test(h), 'a dot without a field figure');
  assert(/data-lc-pp[^>]*>—</.test(h) && /field —/.test(T(h)), 'Against the field not dashed');
  return 'dashed';
});
H.mustFail('a chip tinted by the gap to the field instead of his rate is caught', () => {
  const src = fs.readFileSync(SRC, 'utf8').replace("bg = off ? 'transparent' : thin ? 'color-mix(in srgb, var(--text) 4%, transparent)' : lcTint(x.row.rate);",
    "bg = off ? 'transparent' : thin ? 'color-mix(in srgb, var(--text) 4%, transparent)' : lcTint(50 + (x.gap || 0));");
  const tmp = path.join(require('os').tmpdir(), 'pp4-mkt-mut-' + process.pid + '.js'); fs.writeFileSync(tmp, src);
  try {
    const M = load(tmp), d = M.I.lineCoverage(M.p, 'bo3', 'all', {}), row = {};
    d.groups.forEach((g) => g.rows.forEach((r) => { row[r.label] = r; }));
    const h = (() => { const s = Object.assign({}, M.I.state); Object.assign(M.I.state, { key: M.p.key, marketTab: 'lines' }); try { return M.I.renderMarketModal(M.p); } finally { Object.assign(M.I.state, s); } })();
    chipsOf(h).forEach((c) => { const r = row[/data-lc-chip="([^"]+)"/.exec(c)[1]]; if (r.n - (r.voids || 0) < 5) return;
      const a = 10 + 75 * Math.min(1, Math.abs(r.rate - 50) / 35); assert(c.includes((r.rate >= 50 ? '--pos' : '--neg') + ') ' + a.toFixed(0) + '%')); });
  } finally { fs.unlinkSync(tmp); }
});
H.mustFail('a strip bar tinted by sign (the v3 rule) is caught', () => {
  const ORIG = fs.readFileSync(SRC, 'utf8'), anchor = "%;background:' + pp4Bar(on) + ';\"></span></span>' +";
  if (!ORIG.includes(anchor)) return;   // a missing anchor must not read as a caught mutant: falls through to "NOT caught"
  const src = ORIG.replace(anchor, "%;background:' + (c[0] === 'dog' ? 'var(--pos)' : pp4Bar(on)) + ';\"></span></span>' +");
  const tmp = path.join(require('os').tmpdir(), 'pp4-mkt-mut2-' + process.pid + '.js'); fs.writeFileSync(tmp, src);
  try {
    const M = load(tmp);
    const h = (() => { Object.assign(M.I.state, { key: M.p.key, marketTab: 'winner' }); return M.I.renderMarketModal(M.p); })();
    cells(h).forEach((c) => assert(/data-mk-bar[^>]*background:var\(--pp-x-(link|bar-neutral)\)/.test(c)));
  } finally { fs.unlinkSync(tmp); }
});
H.done ? H.done() : H.end();
