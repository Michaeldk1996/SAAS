#!/usr/bin/env node
// tools/test-pp7.js — Player Profile final export parity (design_handoff_player_profile_final_2026-11-26, locked by the
// founder 2026-11-26). Each check runs the shipped renderer on the pinned fixture (player-2840, clock pinned to its asOf)
// and has a CONTROL that applies the pre-ruling code and must go red, so no check passes on an empty set.
//   splits    Level & round: 1300px drawer, 1170 content, equal value columns per view, every head + value centred,
//             short heads with the full name on hover, cards paired by length
//   matchup   Match-up record: head = the title only; the site toolbar (Window then Surface, 12.5 pills, 16% edge);
//             grid minmax(290px,2.6fr); list heads not caps; the Best / Toughest badge directly after the name
//   styles    Playing styles tab: label column 176, rows 54, opened-card list head not caps, average edge mono 24
//   live      Record by situation: ONE grid 190px · situation · 4 × 88px, heads Group … vs tour, the four figure columns
//             centred; spot box third tile "Favourite · underdog" = the real split by closing price
//   results   every results list: avatar + "Opp" heads (never H / A / Price), the Speed chip after a tournament header's
//             text (no altitude), the WO chip after the opponent's name (never under the date)
//   drill     As favourite / As underdog tiles filter the list; a second click shows every match
//   calendar  no Country filter; the swing / month box = four tiles · list head · one list box per tournament · Sets pill
//   ratings   Serve · Return · Under pressure tiles = list box #0C0E16 + 6% edge, pad 14/8/13, value 21 + gap 12.5
//   toolbar   Court speed / Record per tournament: pad 12/14, 12.5 pills, 34px controls; Calendar pad 10/12 loose pills;
//             Record per tournament count "N tournaments · W–L" and the empty-state reset
'use strict';
const fs = require('fs'), path = require('path');
const assert = require('assert');
const L = require('./ten384-figures-lib.js');
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten384-figures', 'player-2840.json'), 'utf8'));
const H = L.harness();
const KEY = FX.key, p = FX.profile, T = L.text;
const SRC = fs.readFileSync(path.join(__dirname, '..', 'player-profile-v2.js'), 'utf8');
const load = src => L.loadPp2({ src, now: FX.asOf, players: { [KEY]: p }, careerHistory: { [KEY]: FX.careerHistory }, marketEdge: { [KEY]: FX.marketEdge },
  bet365History: FX.bet365History || {} });
const { I } = load();
const tmp = path.join(require('os').tmpdir(), 'pp7-mut-' + process.pid + '.js');
function mutant(pairs) {
  let m = SRC;
  pairs.forEach(([a, b]) => { const n = m.replace(a, b); assert.notStrictEqual(n, m, 'mutation not applied: ' + String(a).slice(0, 60)); m = n; });
  fs.writeFileSync(tmp, m);
  try { return load(tmp).I; } finally { fs.unlinkSync(tmp); }
}
const reset = (X, o) => { X.resetState(KEY); Object.assign(X.state, { key: KEY }, o || {}); };

// ── splits (the draw-record fixture: Zverev's per-match splits, as tools/test-draw-record-drill.js loads it) ──────
const DFX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'draw-drill', 'zverev-1980.json'), 'utf8'));
const DP = { key: '1980', name: 'A. Zverev' };
function loadSplits(src) {
  const m = L.loadPp2({ players: { '1980': DP }, src, extra: { careerSplits: { '1980': DFX.splits }, pp2DrawMatches: () => ({ st: 'ready', d: DFX.file }),
    pp2DrawJoin: () => 'ready', MarketEdgeCore: require(path.join(__dirname, '..', 'market-edge-core.js')) } });
  return m.I;
}
function splitsMutant(pairs) {
  let m = SRC; pairs.forEach(([a, b]) => { const n = m.replace(a, b); assert.notStrictEqual(n, m, 'mutation not applied'); m = n; });
  fs.writeFileSync(tmp, m); try { return loadSplits(tmp); } finally { fs.unlinkSync(tmp); }
}
const splitsOk = X => {
  assert.strictEqual(X.MODAL_WIDTH.splits, 1300, 'drawer width');
  const want = { results: ['W–L', 'Win %', 'vs avg', 'vs tour'], sets: ['TB won', 'TB / m', 'Games', 'Sets', 'vs avg', 'vs tour'], service: ['Aces', 'DF', 'Hold', 'Break', 'vs avg', 'vs tour'] };
  const cols = { results: 'repeat(4,81px)', sets: 'repeat(6,70px)', service: 'repeat(6,68px)' };
  const order = { results: ['By round', 'Extra stats', 'Level', 'Opponent rank'], sets: ['By round', 'Level', 'Opponent rank', 'Extra stats'] };
  Object.keys(want).forEach(v => {
    X.resetState('1980'); Object.assign(X.state, { key: '1980', modal: 'splits', splitScope: 'career', splView: v, fb: null });
    const h = X.renderSplitsModal(DP);
    assert(/min-width:1170px/.test(h), v + ': content min-width');
    const heads = [...h.matchAll(/data-pp2-splhead title="([^"]*)" style="text-align:center;[^"]*font-size:11\.5px;[^>]*>([^<]*)</g)];
    assert(heads.length >= want[v].length, v + ': no centred 11.5 heads');
    assert.deepStrictEqual(heads.slice(0, want[v].length).map(x => x[2]), want[v], v + ': short heads');
    assert(heads.some(x => x[1] !== x[2]), v + ': no full name on hover');
    assert(h.includes('grid-template-columns:minmax(1') && h.includes(cols[v] + ' 18px'), v + ': equal value columns');
    assert(!/class="pp2-splrow[^"]*"[^>]*>[\s\S]{0,400}?text-align:right;white-space:nowrap;">[^<]*%/.test(h.split('data-pp2-splrow')[1] || ''), v + ': a right-aligned value');
    const secs = [...h.matchAll(/data-pp2-splsec="([^"]+)"/g)].map(x => x[1]);
    assert.deepStrictEqual(secs, order[v === 'service' ? 'sets' : v], v + ': card pairing');
  });
};
H.check('splits · 1300 / 1170, equal centred columns, short heads with hover names, cards paired by length', () => splitsOk(loadSplits(path.join(__dirname, '..', 'player-profile-v2.js'))));
H.mustFail('CONTROL · the pre-ruling Level & round (1180, right-aligned long heads) fails', () => splitsOk(splitsMutant([
  ["splits: 1300, market", "splits: 1180, market"],
  ["results: [['W' + ENDASH + 'L'], ['Win %'], ['vs avg', 0, 'Win rate vs his average']", "results: [['W' + ENDASH + 'L'], ['Win %'], ['vs his avg', 0, 'Win rate vs his average']"]])));
H.mustFail('CONTROL · the old pairing (By round, Level, Opponent rank, Extra stats in every view) fails', () => splitsOk(splitsMutant([
  ["(view === 'results' ? ['By round', 'Extra stats', 'Level', 'Opponent rank'] : ['By round', 'Level', 'Opponent rank', 'Extra stats'])", "['By round', 'Level', 'Opponent rank', 'Extra stats']"]])));

// ── matchup ─────────────────────────────────────────────────────────────────────────────────────────────────
const matchupOk = X => {
  reset(X, { modal: 'styles', styTab: 'record' });
  const h = X.renderStylesModal(p), t = T(h);
  const bar = /data-pp2-stybar="1" style="([^"]*)"/.exec(h);
  assert(bar && /padding:12px 14px;margin-bottom:12px/.test(bar[1]), 'the filter bar is not the site toolbar');
  assert(h.indexOf('data-pp2="sty-win"') < h.indexOf('data-pp2="sty-surf"'), 'Window does not come first');
  assert(!/data-v="l24"/.test(h), 'a Last 24 months pill');
  assert(/data-pp2="sty-win"[^>]*aria-pressed="true"[^>]*style="[^"]*font-size:12\.5px;[^"]*border:1px solid var\(--edge-16\)/.test(h), 'the picked pill has no 16% edge');
  assert(!/% win rate/.test(t) && !/>backing him</.test(h), 'record / win rate / yield are back in the head');
  assert(/grid-template-columns:minmax\(290px,2\.6fr\) minmax\(48px,1fr\)/.test(h), 'table grid');
  assert(!/data-pp2="sty-sort"[^>]*style="[^"]*text-transform:uppercase/.test(h), 'caps list heads');
  // the badge sits in the name's own inline-flex (gap 8), never pushed right (the fixture has no archetype file: read the source)
  assert(/\(mk \? '<span data-pp2-stymark title="' \+ esc\(mk\.tip\) \+ '" style="flex:none;align-self:center;'/.test(X.__src || SRC), 'the badge is not directly after the name');
};
H.check('matchup · title-only head, site toolbar Window then Surface, 290px name column, badge after the name', () => matchupOk(I));
H.mustFail('CONTROL · the pre-ruling head (record + win rate + backing) fails', () => matchupOk(mutant([
  ["'<span style=\"font-size:18px;font-weight:800;letter-spacing:-0.01em;color:var(--text);\">' + esc(title) + '</span></div>' +   // final 2026-11-26: the title only",
    "'<span style=\"font-size:18px;font-weight:800;letter-spacing:-0.01em;color:var(--text);\">' + esc(title) + '</span><span>50% win rate</span></div>' +"]])));
H.mustFail('CONTROL · Surface before Window fails', () => matchupOk(mutant([
  ["stySwitch('sty-win', [['l52', 'Last 52 weeks'], ['career', 'Career']], win, 'Window') + stySwitch('sty-surf', STY_SURFS, surf, 'Surface')",
    "stySwitch('sty-surf', STY_SURFS, surf, 'Surface') + stySwitch('sty-win', [['l52', 'Last 52 weeks'], ['career', 'Career']], win, 'Window')"]])));

// ── styles (grid tab; the page's psStylesModel is not in this harness, so the source is read) ────────────────
const stylesOk = src => {
  assert(/var GRID = 'display:grid;grid-template-columns:176px repeat\(/.test(src), 'label column 176');
  assert(/return '<div style="' \+ GRID \+ 'align-items:center;min-height:54px;/.test(src), 'rows 54');
  assert(/listHead\('Against ' \+ MIDDOT \+ ' best to worst'\)/.test(src), 'list head caps');
  assert(/' \+ M \+ 'font-size:24px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;color:' \+ ec/.test(src), 'average edge mono 24');
  assert(/\.pp2-psarch:hover\{border-color:var\(--edge-16\)/.test(src), 'card hover 16%');
};
H.check('styles · grid label 176 / rows 54, opened list head Hanken not caps, average edge 24, hover 16%', () => stylesOk(SRC));
H.mustFail('CONTROL · the pre-ruling caps list head fails', () => stylesOk(SRC.replace("listHead('Against ' + MIDDOT + ' best to worst')", "recCaps('Against ' + MIDDOT + ' best to worst')")));

// ── live ────────────────────────────────────────────────────────────────────────────────────────────────────
const liveOk = X => {
  reset(X, { modal: 'profile', ltWin: 'career', ltSurf: 'all' });
  const M = X.ltModel(p), h = X.ltCardHtml(p, M);
  const head = /data-lt-head="1" style="([^"]*)">([\s\S]*?)<\/div>/.exec(h);
  assert(head && /grid-template-columns:190px minmax\(0,1fr\) repeat\(4,88px\);gap:0 16px/.test(head[1]), 'head grid');
  const hs = [...head[2].matchAll(/text-align:(\w+);">([^<]*)</g)].map(x => [x[2], x[1]]);
  assert.deepStrictEqual(hs, [['Group', 'left'], ['Situation', 'left'], ['Record', 'center'], ['Rate', 'center'], ['vs his norm', 'center'], ['vs tour', 'center']], 'heads');
  const row = /data-lt-row="[^"]+" style="display:grid;grid-template-columns:minmax\(0,1fr\) repeat\(4,88px\);gap:0 16px;[^"]*height:50px/.exec(h);
  assert(row, 'value rows do not share the grid');
  assert(!/data-lt-row[\s\S]*?text-align:right/.test(h.slice(h.indexOf('data-lt-row'), h.indexOf('data-lt-row') + 1200)), 'a right-aligned value');
};
H.check('live · Record by situation: one grid 190 · situation · 4 × 88, heads Group … vs tour, figures centred', () => liveOk(I));
H.mustFail('CONTROL · the pre-ruling right-aligned grid fails', () => liveOk(mutant([["var LT_COLS = 'minmax(0,1fr) repeat(4,88px)';", "var LT_COLS = 'minmax(0,1fr) 92px 72px 92px 92px';"]])));
const spotOk = X => {
  reset(X, { modal: 'profile', ltWin: 'career', ltSurf: 'all' });
  const M = X.ltModel(p);
  const r = [].concat(...M.groups.map(g => g.rows)).find(x => x.src === 'set' && x.held && x.n >= 10);
  assert(r, 'vacuous: no set row held');
  const fd = X.ltSpotRoles(M, r);
  const f = fd.c.fav, d = fd.c.dog;
  assert(f[1] + d[1] > 0 && f[1] + d[1] <= r.n && f[0] + d[0] <= r.w, 'the split does not sit inside the spot record');
  assert(f[1] && d[1], 'vacuous: the fixture needs both roles');
  const pc = x => x[1] >= 5 ? Math.round(100 * x[0] / x[1]) + '%' : '—';
  assert.strictEqual(fd.value, pc(f) + ' · ' + pc(d));
  assert.strictEqual(fd.sub, f[0] + ' of ' + f[1] + ' · ' + d[0] + ' of ' + d[1]);
  X.state.ltBox = r.id;
  const box = X.ltSpotBoxHtml(p, M), t = T(box);
  assert(/Favourite · underdog/.test(t) && !/Vs his norm/i.test(t), 'tile caption');
  const pbp = [].concat(...M.groups.map(g => g.rows)).find(x => x.src === 'pbp');
  if (pbp) assert.strictEqual(X.ltSpotRoles(M, pbp).value, '— · —', 'a point-by-point row claims a split');
};
H.check('live · spot box third tile = Favourite · underdog, the real split by closing price (5 floor), no Vs his norm tile', () => spotOk(I));
H.mustFail('CONTROL · the pre-ruling Vs his norm tile fails', () => spotOk(mutant([["tile('Favourite ' + MIDDOT + ' underdog', FD.value, FD.sub) +", "tile('Vs his norm', r.N.txt, '') +"]])));

// ── results ─────────────────────────────────────────────────────────────────────────────────────────────────
const resultsOk = X => {
  assert(/data-pp2-subjav="1"/.test(X.hdTxt('H')) && X.hdTxt('A') === 'Opp' && /data-pp2-subjav/.test(X.hdTxt('Price')), 'H / A / Price not replaced');
  const chip = X.evSpeedChip(-0.237);
  assert(/data-evsp="1"/.test(chip) && /Speed<\/span><span[^>]*>−0\.24</.test(chip), 'speed chip: signed, 2 decimals, true minus');
  assert(/>—</.test(X.evSpeedChip(null)), 'a missing speed is not a dash');
  reset(X, { modal: 'career', careerScope: 'career' });
  const h = X.renderDrill(p, { surf: 'hard', year: null, span: true, tier: 'all', box: true, title: 'Hard', won: 1, lost: 1 });
  assert(/data-pp2-subjav="1"/.test(h) && />Opp</.test(h) && !/>H<\/div>|>A<\/div>/.test(h), 'drill heads');
  assert(/data-evsp="1"/.test(h), 'no speed chip on a tournament header');
  assert(!/H \/ A =/.test(h), 'the foot still says H / A');
  assert(!/altitude/.test(h), 'altitude on a header');
};
H.check('results · avatar + Opp heads, the Speed chip after a tournament header, no H / A, no altitude', () => resultsOk(I));
H.mustFail('CONTROL · the pre-ruling H / A heads fail', () => resultsOk(mutant([["function hdTxt(t) { return t === 'H' || t === 'Price' ? subjAvatarHtml() : t === 'A' ? 'Opp' : esc(t); }", "function hdTxt(t) { return esc(t); }"]])));
const woOk = src => {
  assert(/function woDateHtml\(m, text\) \{ return esc\(text\); \}/.test(src), 'WO still under the date');
  ['esc(r.opp ? initialSurname(r.opp) : DASH) + \'</span>\' +\n             (r.wo ? woChipHtml(', "(m.walkover || m.wo ? woChipHtml() : '')", "(r.wo ? woChipHtml() : '')", "(wo ? woChipHtml() : '')"]
    .forEach(s => assert(src.includes(s), 'no WO chip after the name: ' + s.slice(0, 40)));
};
H.check('results · a walkover = the WO chip right of the opponent\'s name in every list, never under the date', () => {
  woOk(SRC);
  const chip = I.woChipHtml();
  assert(/>WO<\/span>$/.test(chip) && /font-size:10px;font-weight:700/.test(chip) && /border-radius:5px/.test(chip), 'chip look');
});
H.mustFail('CONTROL · WO under the date fails', () => woOk(SRC.replace('function woDateHtml(m, text) { return esc(text); }', 'function woDateHtml(m, text) { return esc(text) + "WO"; }')));

// ── drill ───────────────────────────────────────────────────────────────────────────────────────────────────
const drillOk = X => {
  const opts = { surf: '', year: null, span: true, tier: 'all', box: true, title: 'Career', won: 1, lost: 1 };
  reset(X, { modal: 'career' });
  const all = X.renderDrill(p, opts);
  const n = h => (h.match(/data-pp2-drill-row="[WL]"/g) || []).length;
  const tile = /data-pp2="drill-role" data-v="dog" data-k="([^"]*)"/.exec(all);
  assert(tile, 'the As underdog tile is not clickable');
  X.state.drillRole = { key: tile[1], role: 'dog' };
  const fav = X.renderDrill(p, opts);
  assert(n(fav) > 0 && n(fav) < n(all), 'the underdog filter does not filter (' + n(fav) + ' of ' + n(all) + ')');
  assert(/aria-pressed="true"/.test(fav), 'the picked tile is not marked');
  assert(new RegExp('^' + n(fav) + ' matches as underdog · click the tile again for all matches').test((/data-pp2-drill-note="1">([^<]*)/.exec(fav) || [])[1] || ''), 'foot note');
  assert(!/data-pp2-wo-row/.test(fav), 'a walkover in the favourite list');
  const tilesAll = /data-pp2-drilltiles="1"[\s\S]*?<\/div><\/div>/.exec(all)[0].replace(/aria-pressed="\w+"|title="[^"]*"|background:[^;]*;|border:1px solid [^;]*;/g, '');
  const tilesFav = /data-pp2-drilltiles="1"[\s\S]*?<\/div><\/div>/.exec(fav)[0].replace(/aria-pressed="\w+"|title="[^"]*"|background:[^;]*;|border:1px solid [^;]*;/g, '');
  assert.strictEqual(T(tilesFav), T(tilesAll), 'the tile figures moved with the filter');
};
H.check('drill · As underdog filters the list (walkovers out), tile figures stay on the full list, foot says so', () => drillOk(I));
H.mustFail('CONTROL · tiles that do not filter fail', () => drillOk(mutant([["if (role !== 'all' && !chPend) {", "if (false) {"]])));

// ── calendar ────────────────────────────────────────────────────────────────────────────────────────────────
const calOk = X => {
  reset(X, { modal: 'season', calWin: 'career', calSurf: 'all', calView: 'swing', fmOpen: 'cal' });
  const h = X.renderSeasonModalV2(p);
  assert(!/Country|calCtry|Type a country/.test(h), 'a Country filter');
  const key = (/data-pp2="cal-cell2" data-v="([^"]+)"/.exec(h) || [])[1];
  assert(key, 'no calendar cell');
  X.state.fmOpen = null; X.state.calCellV2 = key;
  const b = X.renderSeasonModalV2(p), t = T(b);
  assert(/max-width:680px/.test(b), 'box width');
  ['Record', 'Win rate', 'Yield', 'Profit at 1u flat'].forEach(w => assert(t.includes(w), 'tile ' + w));
  assert(/data-pp2-calhead="1"[\s\S]*Opponent[\s\S]*Rd[\s\S]*Score[\s\S]*Sets[\s\S]*Opp\.[\s\S]*P&amp;L/.test(b), 'list head');
  assert(/data-pp2-calgrp="1"/.test(b) && /data-evsp="1"/.test(b), 'tournament list boxes with the speed chip');
  assert(/data-pp2-calsets="1"/.test(b), 'no Sets pill');
};
H.check('calendar · no Country filter; the swing box = 680px, four tiles, the list head, one box per tournament, Sets pill', () => calOk(I));
H.mustFail('CONTROL · the pre-ruling Country group fails', () => calOk(mutant([["{ key: 'calOpp', title: 'Opponent level', cur: state.calOpp || 'all', options: OPP_LEVELS, count: cnt('calOpp', 'lvl') }\n    ];",
  "{ key: 'calOpp', title: 'Opponent level', cur: state.calOpp || 'all', options: OPP_LEVELS, count: cnt('calOpp', 'lvl') },\n      { key: 'calCtry', title: 'Country', cur: 'all', options: [['all', 'All countries']], count: function () { return 0; } }\n    ];"]])));

// ── ratings ─────────────────────────────────────────────────────────────────────────────────────────────────
const ratingsOk = X => {
  const h = X.dnaBoxHtml({ f: 'x', label: '1st serve return points won', dp: 1, unit: '%' }, 30.1, 28.0);
  assert(/background:var\(--pp-x-inner\);border:1px solid var\(--edge-6\);border-radius:11px;padding:14px 8px 13px;/.test(h), 'tile box');
  assert(/font-size:21px;[^"]*">30\.1%/.test(h) && /font-size:12\.5px;font-weight:700;/.test(h), 'value 21 + gap 12.5');
  assert(/font-size:12px;font-weight:600;[^"]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">1st serve return points won/.test(h), 'label one line');
};
H.check('ratings · tiles = list box 6% edge pad 14/8/13, value 21 + gap 12.5 on one line, label 12/600 one line', () => ratingsOk(I));
H.mustFail('CONTROL · the pre-ruling gap 15 fails', () => ratingsOk(mutant([["'font-size:12.5px;font-weight:700;font-variant-numeric:tabular-nums;color:' + d.col", "'font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;color:' + d.col"]])));

// ── toolbar ─────────────────────────────────────────────────────────────────────────────────────────────────
const toolbarOk = X => {
  reset(X, { modal: 'speed' });
  const s = X.renderSpeedModalV2(p);
  assert(/data-pp2-spdbar="1" style="[^"]*margin-bottom:12px;padding:12px 14px;/.test(s), 'court speed bar');
  assert(/class="pp2-v5fm" style="[^"]*height:34px;/.test(s), 'Filters 34px');
  assert(/data-pp2="spd-win"[^>]*style="[^"]*padding:5px 11px;[^"]*font-size:12\.5px;/.test(s), 'court speed pills');
  reset(X, { modal: 'tourn' });
  const t = X.renderTournModal(p);
  assert(/data-pp2-tournbar="1" style="[^"]*padding:12px 14px 12px 18px;/.test(t), 'tournament bar');
  assert(/width:210px;height:34px;/.test(t), 'search 34px');
  assert(/data-pp2-tournshown="1"/.test(t), 'no count after the "?"');
  assert.strictEqual(X.tournShownText([{ won: 10, lost: 2 }, { won: 4, lost: 3 }]), '2 tournaments · 14–5');
  assert.strictEqual(X.tournShownText([{ won: 1, lost: 0 }]), '1 tournament · 1–0');
  reset(X, { modal: 'tourn', tourLevel: 'ITF', tourSurf: 'Grass', tournQuery: 'zzzz' });
  const e = T(X.renderTournModal(p));
  assert(/No tournaments match these filters/.test(e) && /Back to ATP · all surfaces/.test(e), 'the empty state');
  reset(X, { modal: 'season' });
  const c = X.calHeadRow(p, '');
  assert(/data-pp2-calbar="1" style="[^"]*padding:10px 12px;[^"]*border-radius:12px;/.test(c) && /padding:6px 13px;border-radius:8px;font-size:12px;/.test(c), 'calendar bar');
  const cr = X.careerTabsHtml();
  assert(/padding:6px 13px;border-radius:8px;font-size:11\.5px;/.test(cr) && /padding:20px 24px;gap:8px;/.test(cr), 'career band');
};
H.check('toolbar · compact bars (Court speed, Record per tournament, Calendar, Career record), the count and the reset', () => toolbarOk(I));
H.mustFail('CONTROL · the pre-ruling tall Court speed bar fails', () => toolbarOk(mutant([["data-pp2-spdbar=\"1\" style=\"display:flex;align-items:center;gap:12px 10px;flex-wrap:wrap;margin-bottom:12px;padding:12px 14px;",
  "data-pp2-spdbar=\"1\" style=\"display:flex;align-items:center;gap:12px 10px;flex-wrap:wrap;margin-bottom:16px;padding:22px 24px;"]])));
H.done();
