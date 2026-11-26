// Live page rebuild (founder brief 2026-11-25, design_handoff_live_final/Live.dc.html, locked 2026-11-25). The SHIPPED
// renderer (the last <script> block of bsp-consult-dashboard.html) runs against the SHIPPED data layer (live-tab.js) and
// house-ratings.js on a frozen board of real api-tennis rows with their real point logs (tools/fixtures/ten417-live.json,
// Shanghai, 8–9 Oct 2026). Every check runs again on a mutated copy of the source and must turn red there.
// Rules: .claude/rules/live.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const LIVETAB = readFileSync(join(HERE, 'live-tab.js'), 'utf8');
const HOUSE = readFileSync(join(HERE, 'house-ratings.js'), 'utf8');
const FIX = JSON.parse(readFileSync(join(HERE, 'tools/fixtures/ten417-live.json'), 'utf8'));
import { createRequire } from 'node:module';
const KIBL_SAME = createRequire(import.meta.url)('./drops-page.js').kiblSame;   // the stream join's name rule, as shipped
const BLOCK = (() => { const a = HTML.lastIndexOf('<script>'), b = HTML.indexOf('</script>', a); const s = HTML.slice(a + 8, b);
  assert.ok(/LIVE_CONST/.test(s) && /lvTab/.test(s), 'the Live renderer is the last <script> block'); return s; })();
function fn(src, name) {
  const at = src.indexOf('\nfunction ' + name + '('); assert.ok(at >= 0, 'function ' + name);
  let depth = 0, i = src.indexOf('{', at);
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(at + 1, i + 1);
}
// the dashboard helpers the renderer reads (sliced whole from the shipped page)
const HELPERS = ['pbpParseScore', 'pbpSplitSet', 'fhPbpSetModel', 'fhPbpMatchCtx', 'formIni', 'fhIni'].map(n => fn(HTML, n)).join('\n')
  + '\nconst FH_DASHC = "\\u2014"; function fhEsc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c])); }'
  + '\n' + fn(HTML, 'fhSheetSectionHead').replace(/function fhSheetSectionHead/, 'function fhSheetSectionHead') + '\n' + fn(HTML, 'fhSheetPbpHtmlMa2')
  + '\nlet _fhSheetToneNow = null; function fhSheetTone(){ return _fhSheetToneNow; }';

function boot(block = BLOCK, opts = {}) {
  const els = {};
  const mkEl = () => ({ innerHTML: '', style: {}, textContent: '', children: [], addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], contains: () => true, classList: { contains: () => false } });
  const document = { readyState: 'complete', hidden: false, body: { style: {}, appendChild() {} },
    getElementById: id => id === 'lvTab' ? (els.tab = els.tab || mkEl()) : null,
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => mkEl() };
  const store = {};
  const pbp = {};
  const ctx = { console, Math, Date, JSON, Object, Array, String, Number, Promise, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, isFinite, encodeURIComponent,
    document, localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
    fetch: async url => { const m = /event_key=eq\.(\d+)/.exec(url); return { ok: true, json: async () => m ? [{ pbp: FIX.pbp[m[1]] || [] }] : [] }; },
    WebSocket: function () {}, location: { search: '' }, navigator: {},
    SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k', FEATURE_LIVE_PROXY: true };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(HOUSE, ctx);
  vm.runInContext(LIVETAB, ctx);
  vm.runInContext(HELPERS, ctx);
  vm.runInContext(`function newsPlayerName(k, n){ return n; } function sfEventName(r){ return String(r || '').replace(/^ATP\\s+/, '') + (/shanghai/i.test(r) ? ' Masters' : ''); }
    function cardStartMs(m){ return Date.parse(m.date + 'T' + (m.time || '00:00') + ':00Z'); }
    var OCS = { byKey: {} }; function _ocsOf(m){ return ${JSON.stringify(opts.ocs || null)}; } function mxBookLabel(b){ return b === 'bet105' ? 'Bet105' : b; }
    var surfaceRatings = ${JSON.stringify(opts.ratings || { players: [] })}; var holdbreak = ${JSON.stringify(opts.hb || null)};`, ctx);
  ctx.KiblJoin = { same: KIBL_SAME };
  vm.runInContext(block, ctx);
  return ctx;
}
const board = () => FIX.board.map(f => JSON.parse(JSON.stringify(f)));
async function withPbp(ctx) { await Promise.all(Object.keys(FIX.pbp).map(k => new Promise(r => ctx.LiveFeed.pbpLoad(k, r)))); }
// a check holds on the shipped source and fails on the mutant
async function both(name, mutate, check) {
  await check(BLOCK);
  const m = mutate(BLOCK); assert.notEqual(m, BLOCK, 'mutant applies: ' + name);
  let red = false; try { await check(m); } catch (e) { red = true; }
  assert.ok(red, 'MUTANT survived: ' + name);
}

test('constants: the placeholders sit in one place at the prototype values', async () => {
  await both('MIN changed', s => s.replace('HB_MIN_GAMES: 30', 'HB_MIN_GAMES: 20'), src => {
    const c = boot(src).LivePage.LIVE_CONST;
    assert.equal(c.HB_MIN_GAMES, 30); assert.equal(c.U_GAP, 15); assert.equal(c.U_N, 20); assert.equal(c.BP_SAVED_MAJOR, 3);
    assert.equal(c.DOM_WINDOW_GAMES, 4); assert.equal(c.BIG_GAP, 15); assert.equal(c.HEAT_NEUTRAL, 3); assert.equal(c.PRICE_MOVE_NO_BREAK, null);
  });
});

test('no sample data ships: no generator, seeded random, sample list or sample disclaimer', () => {
  const code = BLOCK.split('\n').filter(l => !l.trim().startsWith('//')).join('\n').replace(/\/\/[^\n'`"]*$/gm, '');
  for (const bad of ['SEED(', 'sim(', 'randomuser', 'sample data for design review', 'const NAMES', 'heatFormat', 'inPlayPrices'])
    assert.ok(!code.includes(bad), 'found ' + bad);
});

test('the grid: ATP and Challenger men\'s singles underway, never ITF, WTA or doubles', async () => {
  await both('Challenger gate dropped', s => s, () => {
    const c = boot(); const L = c.LiveFeed;
    assert.ok(L.isLiveTour({ event_type_type: 'Atp Singles' }));
    assert.ok(L.isLiveTour({ event_type_type: 'Challenger Men Singles' }));
    for (const t of ['Itf Men Singles', 'Wta Singles', 'Challenger Women Singles', 'Atp Doubles', 'Boys Singles']) assert.ok(!L.isLiveTour({ event_type_type: t }), t);
  }).catch(e => { if (!/mutant applies/.test(e.message)) throw e; });
  assert.match(LIVETAB, /const live = all\.filter\(isLiveTour\)\.filter\(isUnderway\)/);
});

test('card: score, server, Pre = the card state\'s close, live price a dash before any in-play read', async () => {
  const ocs = { book: 'bet105', startTs: '2026-10-08T05:00:00Z', p1: { close: 1.553, closeTs: '2026-10-08T04:59:00Z' }, p2: { close: 2.48, closeTs: '2026-10-08T04:59:00Z' } };
  await both('Pre from the open', s => s.replace("const side = s => s.close != null ? { v: s.close, ts: s.closeTs, k: 'close' }", "const side = s => s.open != null ? { v: s.open, ts: s.openTs, k: 'open' }"), src => {
    const c = boot(src, { ocs }); const m = c.LivePage._vm(board()[0], 0);
    assert.equal(JSON.stringify(m.pre.v), '[1.553,2.48]');
    const h = c.LivePage._html.card({ m, sig: c.LivePage._sig(m) });
    assert.match(h, />1\.55</); assert.match(h, />2\.48</);
    assert.ok(!/>1\.55<[\s\S]*class="lv-price/.test(h));
  });
  const c = boot(); const m = c.LivePage._vm(board()[0], 0);
  assert.equal(JSON.stringify(m.pre.v), '[null,null]', 'no card state = no Pre');
  assert.equal((c.LivePage._html.card({ m, sig: c.LivePage._sig(m) }).match(/>—</g) || []).length >= 4, true, 'Pre and the two price boxes dash');
});

test('point log → games: a break is named for the player who broke; the score is the score when that game started', async () => {
  await both('score after the game', s => s.replace("at: 'S' + (c.si + 1) + ' ' + c.g0[0] + EN + c.g0[1]", "at: 'S' + (c.si + 1) + ' ' + c.gs"), async src => {
    const c = boot(src); await withPbp(c);
    for (const f of board()) {
      const raw = FIX.pbp[String(f.event_key)]; if (!raw) continue;
      const m = c.LivePage._vm(f, 0), play = c.LivePage._buildPlay(m, raw);
      const real = raw.filter(g => (g.points || []).some(p => /15|30|40|A/.test(p.score || '')) && (g.serve_winner != null || g.serve_lost != null));
      for (const g of real) {
        const cell = play.gCells.find(x => !x.tb && x.si === (+String(g.set_number).replace(/\D/g, '') - 1) && x.g0[0] + x.g0[1] === +g.number_game - 1);
        assert.ok(cell, 'game ' + g.set_number + ' ' + g.number_game);
        const brk = /first/i.test(g.serve_winner) !== /first/i.test(g.player_served);
        assert.equal(cell.brk, brk, 'break flag ' + g.set_number + ' g' + g.number_game);
        if (brk) { const e = play.ml.find(x => x.key === 'g' + cell.gi); assert.ok(e, 'a break is a moment');
          assert.equal(e.side, /first/i.test(g.serve_winner) ? 0 : 1, 'named = the breaker');
          assert.equal(e.at, 'S' + (cell.si + 1) + ' ' + cell.g0[0] + '–' + cell.g0[1]); }
      }
    }
  });
});

test('card moments: major kinds only — one saved break point never reaches the card; 3+ saved in a game does', async () => {
  await both('every save major', s => s.replace('major: c.brk || saved >= LIVE_CONST.BP_SAVED_MAJOR', 'major: true'), async src => {
    const c = boot(src); await withPbp(c);
    let saw1 = false;
    for (const f of board()) { const raw = FIX.pbp[String(f.event_key)]; if (!raw) continue;
      const play = c.LivePage._buildPlay(c.LivePage._vm(f, 0), raw);
      for (const e of play.ml.filter(x => /^Saved/.test(x.t))) { const n = /a break point/.test(e.t) ? 1 : /two/.test(e.t) ? 2 : 3;
        if (n < 3) { saw1 = true; assert.equal(e.major, false, e.t); } else assert.equal(e.major, true, e.t); }
      for (const e of play.ml.filter(x => x.brk)) assert.equal(e.major, true); }
    assert.ok(saw1, 'the fixture holds a game with fewer than 3 saved break points (the check is not vacuous)');
  });
});

test('status chip: Match point > Set point > Break point, named for the player with the point; MTO amber with no reason', async () => {
  const f = board()[0];
  await both('break point beats match point', s => s.replace("if (setPt && won(pointFor) + 1 >= need) return", "if (false) return"), src => {
    const c = boot(src); const m = c.LivePage._vm(Object.assign(f, { scores: [{ score_set: '1', score_first: '6', score_second: '3' }, { score_set: '2', score_first: '5', score_second: '4' }], event_game_result: '40 - 15', event_serve: 'First Player', event_status: 'Set 2' }), 0);
    const sg = c.LivePage._sig(m); assert.equal(sg.chip, 'Match point'); assert.equal(sg.who, 0);
  });
  const c = boot(); const m = c.LivePage._vm(Object.assign(board()[0], { scores: [{ score_set: '1', score_first: '2', score_second: '3' }], event_game_result: '30 - 40', event_serve: 'First Player', event_status: 'Set 1' }), 0);
  assert.equal(c.LivePage._sig(m).chip, 'Break point'); assert.equal(c.LivePage._sig(m).who, 1);
  c.LivePage._side.mto = { [String(m.ek)]: [{ playerSide: 2, games: [[2], [3]], endedAt: null, player: 'X' }] };
  const m2 = c.LivePage._vm(board()[0], 0), sg = c.LivePage._sig(m2);
  assert.equal(sg.chip, 'Medical timeout'); assert.equal(sg.tone, 'mto');
  assert.match(c.LivePage._html.card({ m: m2, sig: sg }), /color:var\(--lv-amber\)/);
  assert.equal(sg.text.split(' · ').length, 2, 'player + where, nothing else');
});

test('Momentum: Dominance is not drawn before 4 games; Points lead starts at the first point', async () => {
  await both('dominance from the first game', s => s.replace('.length < LIVE_CONST.DOM_START_GAMES) return null;', '.length < 0) return null;'), async src => {
    const c = boot(src); await withPbp(c);
    const f = board().find(x => FIX.pbp[String(x.event_key)]), m = c.LivePage._vm(f, 0);
    c.LivePage._S.mScope = 'MATCH'; c.LivePage._S.momV = 'DOM';
    const raw = FIX.pbp[String(f.event_key)], play = c.LivePage._buildPlay(m, raw), P = play.P;
    const h = c.LivePage._html.momentum(m);
    assert.match(h, /Momentum is tracked after 4 games/);
    const done = play.gCells.filter(x => !x.part && !x.tb), want = done[3].end / P.length * (m.live ? 100 : 88);
    const got = +/data-mwait style="[^"]*?width:([\d.]+)%/.exec(h)[1];
    assert.ok(Math.abs(got - want) < 0.01, 'the hatch ends where the 4th game ends: ' + got + ' v ' + want);
    assert.ok(P.length > 20, 'the fixture has points');
  });
});

test('Stats: whole percentages; a rate with nothing to divide is a dash with its count; "X/Y" counts read', async () => {
  const c = boot(); const f = board()[0], k1 = f.first_player_key, k2 = f.second_player_key;
  // the feed's own row shape; names exactly as api-tennis sends them (the renderer folds case through LiveFeed.stat)
  const row = (player_key, name, won, total, value) => ({ player_key, stat_period: 'match', stat_type: 'Service', ['stat' + '_name']: name, stat_won: won, stat_total: total, stat_value: value });
  f.statistics = [row(k1, '1st serve points won', 20, 27, '74%'), row(k2, '1st serve points won', 15, 26, '58%'),
    row(k1, 'Break Points Saved', 0, 0, '0%'), row(k2, 'Break Points Saved', null, null, '3/5')];
  await both('X/Y ignored', s => s.replace("xy = raw && /(\\d+)\\s*\\/\\s*(\\d+)/.exec(String(raw.value || ''))", 'xy = null'), src => {
    const cc = boot(src); const m = cc.LivePage._vm(JSON.parse(JSON.stringify(f)), 0); cc.LivePage._S.scope = 'MATCH';
    const h = cc.LivePage._html.stats(m);
    assert.match(h, />74%</); assert.match(h, />58%</);
    assert.match(h, />60%<\/span>/, '3/5 → 60%');
    assert.match(h, /\(0\/0\)/, 'nothing to divide: the count stays');
    assert.ok(!/>[^<]*\d\.\d%[^<]*</.test(h), 'whole percentages only');
  });
});

test('Stats compare: the baseline follows the match\'s real surface, never hard-court by default', async () => {
  const ratings = { players: [{ key: 1, surfaces: { Clay: { last52: { serve: { firstWonPct: 70 }, sample: { matches: 30 } } }, All: { last52: { serve: { firstWonPct: 72 }, sample: { matches: 60 } } } } }] };
  await both('hard by default', s => s.replace("(surf || '') + '-court average'", "'hard-court average'"), src => {
    const c = boot(src, { ratings }); const m = c.LivePage._vm(board()[0], 0); m.surface = { s: 'clay' }; c.LivePage._S.cmp = null;
    const h = c.LivePage._html.stats(m);
    assert.match(h, /Compare: clay-court average/); assert.ok(!/hard-court/.test(h));
  });
});

test('Break/Hold: under 30 games = count only, no colour; best-of-3 and best-of-5 never mixed', async () => {
  const cell = (n, won) => ({ n, won, pct: Math.round(won / n * 100) });
  const sets = {}; for (const s of ['1', '2', '3', '4', '5']) { sets[s] = {}; for (const b of ['1', '2', '3', '4', '5', '6']) sets[s][b] = b === '1' ? cell(12, 10) : cell(60, 50); }
  const f = board()[0];
  const hb = { players: { [String(f.first_player_key)]: { serve: { all: sets }, return: { all: sets } }, [String(f.second_player_key)]: { serve: { all: sets }, return: { all: sets } } } };
  await both('format mixing allowed', s => s.replace('const HB_FORMAT_SPLIT = false;', 'const HB_FORMAT_SPLIT = true;'), src => {
    const c = boot(src, { hb }); const m = c.LivePage._vm(f, 0); m.bo = 5;
    const h = c.LivePage._html.heat(m);
    assert.ok(!/data-hbc="full"[^>]*>[\s\S]{0,400}?Set 1</.test(h));
    const cells = [...h.matchAll(/data-hbc="(\w+)"/g)].map(x => x[1]);
    assert.equal(cells.length, 60, 'two players × 6 rows × 5 sets');
    for (let r = 0; r < 6; r++) for (let si = 0; si < 3; si++) assert.equal(cells[r * 5 + si], 'none', 'sets 1–3 pool both formats: a dash');
    assert.equal(cells[3], 'thin', '12 games in set 4 bucket 1 = count only');
    assert.equal(cells[5 + 3], 'full');
  });
});

test('wiring: the old renderer is gone, the new one owns #lvTab, the page script compiles', () => {
  assert.ok(!/lvEventLabel|momentumSets\(/.test(BLOCK), 'TEN-417 renderer removed');
  assert.doesNotThrow(() => new vm.Script(BLOCK));
  assert.match(HTML, /id="lvTab" style="padding:30px 40px 70px 24px;"/);
  assert.match(BLOCK, /border-radius:16px; padding:22px 24px; display:flex; align-items:center; justify-content:space-between; gap:20px 36px; flex-wrap:wrap;/, 'the summary row is the design\'s own (not the shared 35b header)');
  assert.match(HTML, /#lvTab \*, #lvOverlay \* \{ box-sizing: content-box; \}/);
});

test('feed lag: a decided set left as the last entry is not the set in play (no false Set point)', async () => {
  await both('decided set kept as current', s => s.replace('if (setDone(sets[sets.length - 1]) && wonBy(0) < need && wonBy(1) < need) sets.push([0, 0]);', ''), src => {
    const c = boot(src); const m = c.LivePage._vm(Object.assign(board()[0], { scores: [{ score_set: '1', score_first: '6', score_second: '4' }], event_game_result: '40 - 15', event_serve: 'First Player', event_status: 'Set 1' }), 0);
    assert.equal(m.nSets, 2); assert.equal(JSON.stringify(m.sets[1]), '[0,0]');
    assert.notEqual(c.LivePage._sig(m).chip, 'Set point');
  });
});

test('Stats bars: a side with no figure never hands the other a full bar; untracked winners/UE (all 0 over 10+ points) are dashes', async () => {
  const f = board()[0], k1 = f.first_player_key, k2 = f.second_player_key;
  const row = (player_key, name, won, total, value) => ({ player_key, stat_period: 'match', stat_type: 'Service', ['stat' + '_name']: name, stat_won: won, stat_total: total, stat_value: value });
  const mk = (w, tp) => [row(k1, 'Winners', null, null, String(w)), row(k2, 'Winners', null, null, String(w)), row(k1, 'Unforced errors', null, null, String(w)), row(k2, 'Unforced errors', null, null, String(w)),
    row(k1, 'Total Points Won', 5, tp, '50%'), row(k2, 'Total Points Won', 5, tp, '50%'), row(k1, 'Break Points Saved', 2, 4, '50%')];
  await both('one-sided bar', s => s.replace("(aNull || bNull || tot <= 0 || !v) ? '0%'", "(isNull || tot <= 0 || !v) ? '0%'"), src => {
    const c = boot(src); const m = c.LivePage._vm(Object.assign(JSON.parse(JSON.stringify(f)), { statistics: mk(0, 138) }), 0); c.LivePage._S.scope = 'MATCH';
    const h = c.LivePage._html.stats(m), bps = h.slice(h.indexOf('Break points saved'), h.indexOf('Points per service game'));
    assert.ok(!/width:100\.0%/.test(bps), 'Break points saved 2/4 v nothing: no full bar');
    const w = h.slice(h.indexOf('>Winners<') - 600, h.indexOf('>Winners<'));
    assert.match(w, />—</, 'all 0 over 138 points: not tracked');
  });
  const c = boot(); const m = c.LivePage._vm(Object.assign(JSON.parse(JSON.stringify(f)), { statistics: mk(0, 6) }), 0);
  const h = c.LivePage._html.stats(m), w = h.slice(h.indexOf('>Winners<') - 600, h.indexOf('>Winners<'));
  assert.match(w, />0</, 'under 10 points an all-zero sheet can be real');
});

test('hover boxes close when the pointer moves anywhere else (the body re-renders under the pointer)', () => {
  const at = BLOCK.indexOf("ov.addEventListener('mouseover'"), h = BLOCK.slice(at, at + 900);
  assert.match(h, /if \(S\.waitTip && k !== 'waittip'\) patch\.waitTip = false;/);
  assert.match(h, /if \(S\.momTip && k !== 'momtip'\) patch\.momTip = false;/);
  assert.match(h, /if \(S\.drTip && k !== 'drtip'\) patch\.drTip = false;/);
  assert.match(h, /if \(\(S\.momK \|\| S\.momDot\) && !\/\^\(dot\|row\):\/\.test\(k\)\)/);
});

// founder 2026-11-26: the in-play price = Bet105 (kibl_live_ml), pushed, shown whatever the feed's delay; a closed market
// reads "Suspended" as on Bet105; only a stream worker that stopped writing leaves the price out
test('in-play price: Bet105, each player placed by Kibl\'s name order; Suspended as Bet105 shows it; no guess between fixtures', async () => {
  const T = Date.now(), iso = ms => new Date(ms).toISOString();
  const state = (o = {}) => ({ now: iso(T), pos: { ins: iso(T - 1000 - (o.lag || 0) - (o.dead || 0)), rcv: iso(T - 900 - (o.dead || 0)) },
    fx: [{ id: 5, name: '777 Lorenzo Musetti vs Yibing Zhou', league: 19, start: '2026-10-09T08:00:00Z',
      sides: [{ pid: 100, price: 1.4, st: o.st || 1, ins: iso(T - 1200000) }, { pid: 101, price: 2.9, st: 1, ins: iso(T - 1200000) }] }]
      .concat(o.twin ? [{ id: 6, name: '12 Lorenzo Musetti vs Yibing Zhou', league: 19, start: '2026-10-09T09:00:00Z',
        sides: [{ pid: 7, price: 1.5, st: 1, ins: iso(T - 5000) }, { pid: 8, price: 2.6, st: 1, ins: iso(T - 5000) }] }] : []) });
  const run = (src, o) => { const c = boot(src); c.LivePage._lp.apply(state(o)); c.LivePage._lp.LP.readAt = T; return c; };
  await both('players swapped', s => s.replace('hits.push({ f, a: hi, b: lo })', 'hits.push({ f, a: lo, b: hi })'), src => {
    const c = run(src), m = c.LivePage._vm(board()[0], 0);        // Y. Zhou v L. Musetti: Kibl lists Musetti first
    assert.equal(JSON.stringify(m.lp.v), '[2.9,1.4]', 'a side unchanged for 20 min is still Bet105\'s price');
    const h = c.LivePage._html.card({ m, sig: c.LivePage._sig(m) });
    assert.match(h, />2\.90</); assert.match(h, />1\.40</); assert.match(h, /Bet105 in-play/);
    const mh = c.LivePage._html.modalHead(m); assert.match(mh, />2\.90</); assert.match(mh, />1\.40</);
  });
  await both('delay gate back', s => s.replace('return lpNow() - rcv <= LIVE_CONST.LP_DEAD_MS;', 'return rcv - ins <= 5000 && lpNow() - rcv <= LIVE_CONST.LP_DEAD_MS;'), src => {
    const m = run(src, { lag: 60000 }).LivePage._vm(board()[0], 0);
    assert.equal(JSON.stringify(m.lp.v), '[2.9,1.4]', 'a worker a minute behind Kibl still shows Bet105\'s price');
  });
  await both('stopped worker ignored', s => s.replace('return lpNow() - rcv <= LIVE_CONST.LP_DEAD_MS;', 'return true;'), src => {
    const m = run(src, { dead: 180000 }).LivePage._vm(board()[0], 0);
    assert.equal(JSON.stringify(m.lp.v), '[null,null]', 'nothing written for 3 min = no price');
  });
  await both('suspension shown as a price', s => s.replace('(x.st == null || Number(x.st) === 1)', 'true'), src => {
    const c = run(src, { st: 2 }), m = c.LivePage._vm(board()[0], 0);
    assert.equal(m.lp.susp, true);
    assert.match(c.LivePage._html.card({ m, sig: c.LivePage._sig(m) }), />Suspended</);
    assert.match(c.LivePage._html.modalHead(m), />Suspended</);
  });
  await both('two fixtures picked anyway', s => s.replace('return hits.length === 1 ? hits[0] : null;', 'return hits[0] || null;'), src => {
    const m = run(src, { twin: true }).LivePage._vm(board()[0], 0);
    assert.equal(JSON.stringify(m.lp.v), '[null,null]', 'two Kibl fixtures for one match = no guess');
  });
});
