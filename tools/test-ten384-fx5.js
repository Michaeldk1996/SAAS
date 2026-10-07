// tools/test-ten384-fx5.js — TEN-384 fix round 5 (fx5, 2026-10-07): the independent review of b0e62376.
//
// Every check runs on PINNED inputs (the committed fixture, sliced page code, constructed rows), so it is identical
// in every checkout, CI included. Each one fails on b0e62376 — the control: `FX5_BASE=b0e62376 node
// tools/test-ten384-fx5.js` runs the same checks against that commit's player-profile-v2.js,
// bsp-consult-dashboard.html, tournament-identity.js and career-backfill.js (read with `git show`).
//
//   1 · ledger price      while the market-edge shard loads, a PRICED H / A cell is blank too (the bet365 capture
//                         price is not the final join); it paints once, from the shard.
//   2 · tournament shard  while tournament-history/{key}.json loads, nothing that reads it claims the empty state:
//                         Record per tournament tile and modal, the season tile's titles count, a career drill.
//                         A settled, genuinely empty shard still says so.
//   3 · lone alias row    a lone "Rio Olympics" row reads "Olympic Games", as every merged group does.
//   4 · names             Court speed match list, Record per tournament drill and the header's Next match print
//                         the opponent through the drills' rule ("J.J. Wolf" -> "J. J. Wolf").
//   5 · builder           career-backfill mergePlayer re-years the Olympics (API "Olympic Games" 2020 ≡ TML
//                         "Tokyo Olympics" 2021): one edition, not 8–4 over [2021, 2020].
//   6 · pending height    the pending figure marker takes its parent's line height (the page's `.pp2-scrim *`
//                         rule resets nested elements to normal: 32px box against the painted 24px).
//   7 · host              a landing repaint error does not wipe the loaded standings; card and header rank share
//                         one precedence (live index → match-row rank → profile rank).
//
// Run: node tools/test-ten384-fx5.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const L = require('./ten384-figures-lib.js');

const ROOT = L.ROOT;
const BASE = process.env.FX5_BASE || null;
const CTRL_DIR = BASE ? fs.mkdtempSync(path.join(os.tmpdir(), 'fx5-control-' + BASE + '-')) : null;
function srcOf(rel) {
  if (!BASE) return path.join(ROOT, rel);
  // the control files keep their own names in one directory, so career-backfill.js's require('./tournament-identity')
  // reads the control copy too
  const f = path.join(CTRL_DIR, rel);
  if (!fs.existsSync(f)) fs.writeFileSync(f, execFileSync('git', ['-C', ROOT, 'show', BASE + ':' + rel], { maxBuffer: 64 << 20 }));
  return f;
}
const PP2 = srcOf('player-profile-v2.js');
const DASH_SRC = fs.readFileSync(srcOf('bsp-consult-dashboard.html'), 'utf8');
// eslint-disable-next-line import/no-dynamic-require
const TI = require(srcOf('tournament-identity.js'));
const H = L.harness();
console.log('TEN-384 fx5 — ' + (BASE ? 'CONTROL against ' + BASE : 'working tree'));

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten384-figures', 'player-2840.json'), 'utf8'));
/** opts.th === null → the profile carries NO tournamentHistory (the shard has not landed). */
function fxModule(opts) {
  opts = opts || {};
  const p = Object.assign({}, FX.profile, opts.profile || {});
  delete p.tournamentHistory;
  if (opts.th !== null) { const th = opts.th || FX.tournamentHistory; p.tournamentHistory = TI.mergeHistory ? TI.mergeHistory(th) : th; }
  const m = L.loadPp2({
    src: PP2, now: FX.asOf, players: { [FX.key]: p }, careerHistory: { [FX.key]: opts.ch || FX.careerHistory },
    marketEdge: opts.noShard ? {} : { [FX.key]: FX.marketEdge }, bet365History: FX.bet365History,
    extra: Object.assign({ TournamentIdentity: TI }, opts.extra || {})
  });
  return { I: m.I, W: m.W, p };
}
function withState(I, patch, fn) {
  const saved = Object.assign({}, I.state);
  Object.assign(I.state, patch);
  try { return fn(); } finally { Object.keys(I.state).forEach(k => delete I.state[k]); Object.assign(I.state, saved); }
}
const T = L.text;
function sliceFn(name, prefix) {
  const start = DASH_SRC.indexOf('\n' + (prefix || 'function ') + name + '(');
  if (start < 0) return '';
  let d = 0, i = DASH_SRC.indexOf('{', start);
  for (; i < DASH_SRC.length; i++) { if (DASH_SRC[i] === '{') d++; else if (DASH_SRC[i] === '}' && --d === 0) break; }
  return DASH_SRC.slice(start, i + 1);
}
function constLine(name) {
  const start = DASH_SRC.indexOf('\nconst ' + name + ' = ');
  return start < 0 ? '' : DASH_SRC.slice(start, DASH_SRC.indexOf('\n', start + 1));
}

async function main() {
// ════════════════════════════════════════════════════════════════════════════
// 1 · the ledger prints no price until the shard lands
// ════════════════════════════════════════════════════════════════════════════
const ROW = { date: '2026-01-05', opponent: 'B. Shelton', won: true, result: '2 - 0', tournament: 'Brisbane', round: 'R32' };
const haCells = h => h.split('<span').slice(-2).map(c => T('<span' + c).trim());
H.check('1 · Alcaraz v Shelton while the shard loads: the capture\'s 1.25 / 4.00 is NOT printed (blank, same cells); landed: the final join', () => {
  const { I, W, p } = fxModule({ noShard: true, extra: { marketEdgePending: { [FX.key]: true } } });
  I.state.key = p.key;
  try {
    const pend = haCells(I.ledgerRowHtml({ m: ROW, price: 1.25, oppPrice: 4.0 }));
    assert.deepStrictEqual(pend, ['', ''], 'the ledger printed ' + JSON.stringify(pend) + ' while the shard loads');
    // the shard lands: the cells paint the final join (here 1.29 / 3.97)
    W.marketEdge[FX.key] = FX.marketEdge; delete W.marketEdgePending[FX.key];
    const landed = haCells(I.ledgerRowHtml({ m: ROW, price: 1.29, oppPrice: 3.97 }));
    assert.deepStrictEqual(landed, ['1.29', '3.97']);
    // a settled shard that prices nothing still dashes
    assert.deepStrictEqual(haCells(I.ledgerRowHtml({ m: ROW, price: null, oppPrice: null })), ['—', '—']);
    return `pending ["",""] → landed ${JSON.stringify(landed)}`;
  } finally { I.state.key = null; }
});
H.check('1 · the blank cell keeps the column: the pending row has the same eight grid cells as the painted one', () => {
  const { I, W, p } = fxModule({ noShard: true, extra: { marketEdgePending: { [FX.key]: true } } });
  I.state.key = p.key;
  try {
    const a = I.ledgerRowHtml({ m: ROW, price: 1.25, oppPrice: 4.0 });
    W.marketEdge[FX.key] = FX.marketEdge; delete W.marketEdgePending[FX.key];
    const b = I.ledgerRowHtml({ m: ROW, price: 1.29, oppPrice: 3.97 });
    const cells = h => (h.match(/<span/g) || []).length;
    assert.strictEqual(cells(a), cells(b));
    assert(/&nbsp;<\/span>\s*<span[^>]*>&nbsp;<\/span>\s*<\/div>$/.test(a), 'the pending cells are not non-breaking spaces');
  } finally { I.state.key = null; }
});

// ════════════════════════════════════════════════════════════════════════════
// 2 · the tournament-history shard is loading: nothing claims the empty state
// ════════════════════════════════════════════════════════════════════════════
const TH_PENDING = () => ({ tourHistPending: { [FX.key]: true }, trProfileBacking: () => null });
H.check('2 · Record per tournament tile while the shard loads: pending (blank), never "no matches on record"', () => {
  const { I, p } = fxModule({ th: null, extra: TH_PENDING() });
  const v = I.buildBoxVals(p, { archetype: null }).tourn;
  assert(v.pending === true && v.support == null, 'tile: ' + JSON.stringify(v));
  const box = T(I.renderBoxes({ boxVals: { tourn: v } }));
  assert(!/no matches on record/.test(box), 'the tile prints "no matches on record" while the shard loads');
  return 'tile ' + JSON.stringify(v);
});
H.check('2 · a settled, genuinely empty shard still says "no matches on record"', () => {
  const { I, p } = fxModule({ th: [], extra: { trProfileBacking: () => null } });
  const v = I.buildBoxVals(p, { archetype: null }).tourn;
  assert.strictEqual(v.support, 'no matches on record', JSON.stringify(v));
  assert(!v.pending);
});
H.check('2 · the season tile\'s titles count while the shard loads: support blank, not "— titles" then a number', () => {
  const { I, p } = fxModule({ th: null, extra: TH_PENDING() });
  const v = I.buildBoxVals(p, { archetype: null });
  assert(v.season.headline != null, 'the season record is not held — the check would be vacuous');
  const h = I.renderBoxes({ boxVals: { season: v.season } });
  assert(!/titles/.test(T(h)), 'the season tile prints a titles clause while the shard loads: ' + T(h).slice(0, 200));
  assert(/data-pp2-pending="support"/.test(h), 'the support line is not marked pending');
  // landed: the titles clause paints
  const { I: I2, p: p2 } = fxModule();
  assert(/\d+ titles?$/.test(I2.buildBoxVals(p2, { archetype: null }).season.support));
});
H.check('2 · Record per tournament modal while the shard loads: no empty-state sentence; settled empty: "No tournaments on record."', () => {
  const { I, p } = fxModule({ th: null, extra: TH_PENDING() });
  const t = T(withState(I, { key: p.key, tournQuery: '', tournOpen: null }, () => I.renderTournModal(p)));
  assert(!/No tournament matches that search|No tournaments on record/.test(t), 'the modal claims an empty state while loading');
  const { I: I2, p: p2 } = fxModule({ th: [] });
  const t2 = T(withState(I2, { key: p2.key, tournQuery: '', tournOpen: null }, () => I2.renderTournModal(p2)));
  assert(/No tournaments on record\./.test(t2), 'settled empty: ' + t2.slice(-120));
  const t3 = T(withState(I2, { key: p2.key, tournQuery: 'zzz', tournOpen: null }, () => I2.renderTournModal(p2)));
  assert(/No tournament matches that search\./.test(t3));
});
H.check('2 · a career drill while the shard loads lists nothing and states nothing (no "no matches in the per-match store")', () => {
  const { I, p } = fxModule({ th: null, extra: TH_PENDING() });
  // a year the form store does not cover: its rows come from the edition store
  const h = I.renderDrill(p, { title: '2019', year: '2019', won: 12, lost: 8 });
  const note = (/data-pp2-drill-note="1"[^>]*>([^<]*)</.exec(h) || [])[1];
  assert.strictEqual(I.drillSourceFor(p, '2019'), 'edition', 'the fixture covers 2019 from the form store — vacuous');
  assert.strictEqual(note, '', 'the drill note reads "' + note + '" while the shard loads');
  // landed: the same drill states its note
  const { I: I2, p: p2 } = fxModule();
  const n2 = (/data-pp2-drill-note="1"[^>]*>([^<]*)</.exec(I2.renderDrill(p2, { title: '2019', year: '2019', won: 12, lost: 8 })) || [])[1];
  assert(n2, 'the landed drill has no note');
  return 'pending note "" → landed "' + n2 + '"';
});
await H.checkAsync('2 · the host marks the shard in flight BEFORE the first await and clears it when it settles (answer or failure)', async () => {
  const f = sliceFn('loadPp2TourHist', 'async function ');
  assert(f, 'loadPp2TourHist not found');
  const run = (shard) => {
    const window = {}; const repaints = [];
    // eslint-disable-next-line no-new-func
    const go = new Function('window', 'playerProfiles', 'loadTourHistShard', 'pp2RepaintIfOpen', f + '\nreturn loadPp2TourHist;')(
      window, { 2840: {} }, () => shard, k => repaints.push([k, !!(window.tourHistPending || {})[k]]));
    const pr = go('2840');
    return { window, repaints, pr };
  };
  let resolve; const a = run(new Promise(r => { resolve = r; }));
  assert(a.window.tourHistPending && a.window.tourHistPending['2840'] === true, 'no in-flight mark at call time');
  resolve([{ name: 'Rome', editions: [] }]); await a.pr;
  assert(!a.window.tourHistPending['2840'], 'the mark survives the answer');
  assert.deepStrictEqual(a.repaints, [['2840', false]], 'the repaint ran with the mark still up');
  const b = run(Promise.reject(new Error('net'))); await b.pr;
  assert(!b.window.tourHistPending['2840'], 'the mark survives a failed fetch');
});

// ════════════════════════════════════════════════════════════════════════════
// 3 · a lone aliased row takes the canonical name
// ════════════════════════════════════════════════════════════════════════════
H.check('3 · Thompson\'s lone "Rio Olympics" row reads "Olympic Games"; every alias group, whatever its size', () => {
  const ED = y => ({ year: y, finish: 'Round of 32', matches: [{ res: 'W', round: 'R64', opp: 'A. One', score: '2 - 0' }, { res: 'L', round: 'R32', opp: 'B. Two', score: '0 - 2' }] });
  const rows = TI.mergeHistory([
    { name: 'Rio Olympics', won: 1, lost: 1, editions: [ED(2016)] },
    { name: 'Roland Garros', won: 1, lost: 1, editions: [ED(2019)] },
    { name: 'Montreal', won: 1, lost: 1, editions: [ED(2017)] },
    { name: 'Rome', won: 1, lost: 1, editions: [ED(2018)] }]);
  assert.deepStrictEqual(rows.map(r => r.name), ['Olympic Games', 'French Open', 'Canada Masters', 'Rome']);
  // every alias spelling, alone, reads its canonical display
  Object.keys(TI.CANONICAL_ALIASES).forEach((k) => {
    const lone = TI.mergeHistory([{ name: k, won: 0, lost: 0, editions: [] }])[0];
    assert.strictEqual(lone.name, TI.CANONICAL_ALIASES[k], `lone "${k}" reads "${lone.name}"`);
  });
  // a row that is not an alias is the same object, untouched
  const rome = { name: 'Rome', editions: [ED(2018)] };
  assert.strictEqual(TI.mergeHistory([rome])[0], rome);
  // and the profile lists it under the canonical name
  const { I, p } = fxModule({ th: FX.tournamentHistory.concat([{ name: 'Rio Olympics', won: 1, lost: 1, editions: [ED(2016)] }]) });
  assert.deepStrictEqual(I.tournViews(p).filter(t => /olymp/i.test(t.name)).map(t => t.display), ['Olympic Games']);
  return 'Rio Olympics → Olympic Games · Roland Garros → French Open · Montreal → Canada Masters · Rome untouched';
});

// ════════════════════════════════════════════════════════════════════════════
// 4 · every opponent name goes through the drills' rule
// ════════════════════════════════════════════════════════════════════════════
H.check('4 · Record per tournament drill: "J.J. Wolf" reads "J. J. Wolf", "J-L. Struff" stays "J-L. Struff"', () => {
  const th = [{ name: 'Delray Beach', won: 1, lost: 1, editions: [{ year: 2023, finish: 'Round of 16',
    matches: [{ res: 'W', round: 'R32', opp: 'J.J. Wolf', score: '2 - 0' }, { res: 'L', round: 'R16', opp: 'J-L. Struff', score: '0 - 2' }] }] }];
  const { I, p } = fxModule({ th });
  const t = T(withState(I, { key: p.key, tournQuery: '', tournOpen: 'Delray Beach' }, () => I.renderTournModal(p)));
  assert(/J\. J\. Wolf/.test(t), 'the drill does not print "J. J. Wolf": ' + (/[^ ]*Wolf/.exec(t) || [''])[0]);
  assert(!/J\.J\. Wolf/.test(t), 'the drill prints the raw "J.J. Wolf"');
  assert(/J-L\. Struff/.test(t));
});
H.check('4 · Court speed match list: the opponent through the same rule ("J. J. Wolf")', () => {
  const ch = FX.careerHistory.map(r => Object.assign({}, r, { opponent: 'J.J. Wolf' }));
  const { I, p } = fxModule({ ch });
  const bands = withState(I, { speedSurf: 'all' }, () => I.speedBands(p));
  const open = bands.filter(b => b.won + b.lost >= 5)[0];
  assert(open, 'no band opens — vacuous');
  const t = T(withState(I, { key: p.key, speedSurf: 'all', speedBand: open.band.id }, () => I.renderSpeedModal(p)));
  assert(/J\. J\. Wolf/.test(t), 'the match list prints no "J. J. Wolf"');
  assert(!/J\.J\. Wolf/.test(t), 'the match list prints the raw "J.J. Wolf"');
});
H.check('4 · the header\'s Next match names the opponent through the rule ("vs J. J. Wolf")', () => {
  const { I, p } = fxModule();
  const ctx = I.build(p); ctx.nextMatch = { label: 'Today · Tokyo SF', opponent: 'J.J. Wolf' };
  const t = T(I.renderHeader(p, ctx));
  assert(/vs J\. J\. Wolf/.test(t), 'header: ' + (/vs [^ ]+ [^ ]+/.exec(t) || [''])[0]);
});
H.check('4 · no esc() call in the module prints a raw opponent field (every one goes through a name helper)', () => {
  const src = fs.readFileSync(PP2, 'utf8');
  const raw = [];
  src.split('\n').forEach((l, i) => {
    const re = /esc\(([^()]*(?:\([^()]*\))?[^()]*)\)/g; let m;
    while ((m = re.exec(l))) {
      if (/\b(?:opp|opponent|oppName)\b/i.test(m[1]) && !/initialSurname|surnameFirst|styleOppName|mkOppName/.test(m[1])) raw.push((i + 1) + ': ' + m[1]);
    }
  });
  assert.deepStrictEqual(raw, []);
});

// ════════════════════════════════════════════════════════════════════════════
// 5 · the builder re-years the Olympics as the page does
// ════════════════════════════════════════════════════════════════════════════
H.check('5 · mergePlayer: API "Olympic Games" 2020 + TML "Tokyo Olympics" 2021 = ONE 2021 edition, not 8–4 over [2021, 2020]', () => {
  // eslint-disable-next-line import/no-dynamic-require
  const { _internal } = require(srcOf('career-backfill.js'));
  const R = [['W', 'R64', 'A. One'], ['W', 'R32', 'B. Two'], ['W', 'R16', 'C. Three'], ['W', 'QF', 'D. Four'], ['L', 'SF', 'E. Five'], ['L', 'BR', 'F. Six']];
  const api = [{ name: 'Olympic Games', editions: [{ year: 2020, matches: R.map(r => ({ res: r[0], round: r[1], opp: r[2], oppKey: '', score: r[0] === 'W' ? '2 - 0' : '0 - 2' })) }] }];
  const tml = R.map(r => ({ year: 2021, tourney: 'Tokyo Olympics', round: r[1], won: r[0] === 'W', oppName: r[2], score: r[0] === 'W' ? '0 - 2' : '2 - 0' }))
    .concat([{ year: 2016, tourney: 'Rio Olympics', round: 'R64', won: false, oppName: 'G. Seven', score: '2 - 0' }]);
  const { history } = _internal.mergePlayer(api, tml);
  const rows = history.filter(t => /olymp/i.test(t.name));
  assert.strictEqual(rows.length, 1, rows.map(t => t.name).join(' + '));
  assert.deepStrictEqual(rows[0].editions.map(e => e.year), [2021, 2016], 'editions ' + JSON.stringify(rows[0].editions.map(e => e.year)));
  assert.deepStrictEqual([rows[0].won, rows[0].lost], [4, 3], `${rows[0].won}–${rows[0].lost}`);
  assert.strictEqual(rows[0].name, 'Olympic Games');
  return `${rows[0].name} ${rows[0].won}–${rows[0].lost} · editions ${rows[0].editions.map(e => e.year).join(', ')}`;
});
H.check('5 · mergePlayer: two stored rows holding one played season keep the LARGER edition, never both', () => {
  // eslint-disable-next-line import/no-dynamic-require
  const { _internal } = require(srcOf('career-backfill.js'));
  const m = (res, opp) => ({ res, round: 'R32', opp, oppKey: '', score: '2 - 0' });
  const api = [{ name: 'Tokyo Olympics', editions: [{ year: 2021, matches: [m('L', 'A. One')] }] },
    { name: 'Olympic Games', editions: [{ year: 2020, matches: [m('W', 'B. Two'), m('L', 'C. Three')] }] }];
  const { history } = _internal.mergePlayer(api, []);
  const rows = history.filter(t => /olymp/i.test(t.name));
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(rows[0].editions.map(e => e.year), [2021]);
  assert.deepStrictEqual([rows[0].won, rows[0].lost], [1, 1]);
});

// ════════════════════════════════════════════════════════════════════════════
// 6 · the pending figure keeps the painted line height
// ════════════════════════════════════════════════════════════════════════════
H.check('6 · Calendar tiles while the shard loads: the marker inherits the 24px figure line height (the page resets nested elements to normal)', () => {
  // the page rule that made a nested span a 32px line box
  const PP2_SRC = fs.readFileSync(PP2, 'utf8');
  assert(/\.pp2-scrim \*[^{]*\{[^}]*line-height:\s*normal/.test(PP2_SRC.slice(PP2_SRC.indexOf('.pp2-main,.pp2-main *'), PP2_SRC.indexOf('.pp2-main,.pp2-main *') + 400)),
    'the module no longer resets nested pp2 elements to line-height normal — re-measure');
  const { I, p } = fxModule({ noShard: true, extra: { marketEdgePending: { [FX.key]: true } } });
  const rows = withState(I, { calSurface: 'all' }, () => I.calSpineFiltered(p));
  const cells = I.calTiles(rows, p).slice(0, 3);
  cells.forEach((c) => {
    const fig = /<span style="([^"]*font-size:24px[^"]*)">(.*?)<\/span><span/.exec(c.html);
    assert(fig && /line-height:24px/.test(fig[1]), 'the figure box is not 24px line-height');
    assert(/data-pp2-pending="figure"/.test(fig[2]), 'no pending marker in the figure');
    const marker = /<span data-pp2-pending="figure"([^>]*)>/.exec(fig[2]);
    assert(/line-height:\s*inherit/.test(marker[1]), 'the pending marker does not inherit the figure line height: ' + marker[0]);
  });
  return 'three pending figures: marker line-height inherit inside the 24px figure box (measured live: 94px pending = 94px painted)';
});

// ════════════════════════════════════════════════════════════════════════════
// 7 · host: the standings survive a repaint error; one rank precedence
// ════════════════════════════════════════════════════════════════════════════
await H.checkAsync('7 · loadPlayerIndex: a throwing landing repaint does not wipe the standings that loaded', async () => {
  const i = DASH_SRC.indexOf('async function loadPlayerIndex(){');
  const f = DASH_SRC.slice(i, DASH_SRC.indexOf('\n}\n', i) + 2);
  const errs = [];
  // eslint-disable-next-line no-new-func
  const api = new Function('fetch', 'document', 'renderPlayers', 'pp2RepaintIfOpen', 'console', `
    let playerIndex = [];
    const ppState = { key: '2840' };
    ${f}
    return { load: loadPlayerIndex, get: () => playerIndex };`)(
    async () => ({ ok: true, json: async () => ({ players: [{ key: '2840', rank: 24 }] }) }),
    { getElementById: () => ({}) },
    () => { throw new Error('render boom'); },
    () => {},
    { error: (...a) => errs.push(a.join(' ')), warn() {}, log() {} });
  await api.load();
  assert.strictEqual(api.get().length, 1, 'the standings were wiped by a repaint error (' + errs.join(' | ') + ')');
});
H.check('7 · a player missing from the standings: card and header both read the match-row rank (#30), not header No. 17', () => {
  const key = FX.key;
  const profiles = { [key]: Object.assign({}, FX.profile, { rank: 17 }) };
  const els = { playerGroups: { innerHTML: '' }, pgHeaderStats: { innerHTML: '' } };
  const src = ['pesc', 'pgRankOf', 'pp2LiveRankOf', 'pgTierCode', 'pgInitials', 'pgRenderHeaderStats', 'getPlayersFromMatches', 'renderPlayers']
    .map(n => sliceFn(n)).join('\n') + '\n' + constLine('TOURX_TIER_CODE') + '\n' + constLine('PG_EXT_SVG');
  const match = { p1: FX.profile.name, p1Key: key, p1Rank: 30, p2: 'X. Other', p2Key: 99999, p2Rank: 40, tour: 'ATP Tokyo',
    surface: 'hard', live: false, finalScore: null, venue: { category: 'ATP 500' }, bestOdds: { p1: null, p2: null } };
  // eslint-disable-next-line no-new-func
  const api = new Function('els', 'matches', 'playerProfiles', 'playerIndex', `
    const document = { getElementById: id => els[id] || null };
    const tournamentProgression = { tournaments: {} };
    let pgLookupsLoaded = true;
    const cardStartMs = () => NaN; const photoCandidatesFor = () => []; const pgArchetypeFor = () => null;
    const pgEloFor = () => null; const loadPlayerCardLookups = () => {}; const mxOddsUpdatedAt = () => null;
    ${src}
    renderPlayers('');
    return { live: pp2LiveRankOf };`)(els, [match], profiles, [{ key: '1', rank: 1 }]);
  const card = /class="pc-rank">#(\d+)</.exec(els.playerGroups.innerHTML);
  assert(card, 'no card rank');
  const { I, p } = fxModule({ profile: { rank: 17 }, extra: { pp2LiveRank: api.live } });
  const hdr = /No\. (\d+)/.exec(T(I.renderHeader(p, I.build(p))));
  assert.strictEqual(card[1], '30', 'card #' + card[1]);
  assert.strictEqual(hdr && hdr[1], card[1], `card #${card[1]} vs header No. ${hdr && hdr[1]}`);
  // the precedence, in one function: live index first, then the match row, then the profile
  assert.strictEqual(api.live(key), 30);
  return `card #${card[1]} = header No. ${hdr[1]} (profile.rank 17 frozen, not in the standings)`;
});

H.done();
}
main().catch((e) => { console.error(e); process.exit(1); });
