#!/usr/bin/env node
// tools/test-pp4-speed.js — Player Profile v4 · Court speed record (handoff 2026-11-14, CHANGES §5, `modal.isSpeed`).
//
// Runs the shipped renderer on the pinned fixture (tools/fixtures/ten384-figures/player-2840.json, S. Korda, the module
// clock pinned to its asOf) plus one walkover row and a synthetic playing-styles store, and asserts the v4 rules:
//   1 · the shared filter bar: Window pills (Last 52 weeks | Career, Career by default) · divider · surface pills ·
//       Filters at the right; no Applied row while no hidden filter is on
//   2 · the Filters popover: 620px, Price role · Altitude (hint at PP4.ALT_CUT_M) · Opponent archetype as a drop-down of the
//       eight archetype names; every option's count = the rows the filter would keep
//   3 · a hidden filter on: "Filters · 1" in blue, an Applied chip + Clear all, "n of m matches" beside the title, and the
//       band gap reads "vs unfiltered"
//   4 · Vs tour is a dash (no tour figure held), never the export's placeholder 50%; the money figure is a yield %, never u
//   5 · the detail card: five tiles in the export's order, the match grid with no column gap, the group line's speed and
//       altitude, a result bullet on the walkover row
//   6 · a band under PP4.SPEED_FLOOR: a dash + "n matches · min 5", no rate, no click; all bands empty: "No matches for
//       these filters" + Clear all, no detail card
//   CONTROL · each check is re-run against the v3 output it replaces (surfaces-only band, units, four tiles, the 10px-gap
//       grid, the export's 50% placeholder) and MUST fail, so none is vacuous.
'use strict';
const fs = require('fs'), path = require('path');
const assert = require('assert');
const L = require('./ten384-figures-lib.js');
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten384-figures', 'player-2840.json'), 'utf8'));
const H = L.harness();
const KEY = FX.key;
const WO = { year: '2025', surface: 'hard', level: 'atp', date: '2025-08-22', tournament: 'Winston-Salem', round: 'Semi-finals',
  opponent: 'M. Fucsovics', result: '-', won: false, eventKey: 12064273, src: 'fixtures', indoor: false, walkover: true, incomplete: true };
const ch = FX.careerHistory.concat([WO]).sort((a, b) => String(b.date).localeCompare(String(a.date)));
// a synthetic styles store: two real opponents of the fixture carry an archetype (test-only), the rest stay unlabelled
const opps = [...new Set(FX.careerHistory.filter(r => r.level === 'atp').map(r => r.opponent))].slice(0, 6);
const styles = { players: opps.map((n, i) => ({ name: n, archetype_label: i % 2 ? 'Big Server' : 'Counterpuncher' })) };
const { I } = L.loadPp2({ src: process.env.PP4_SRC || undefined, now: FX.asOf, players: { [KEY]: FX.profile }, careerHistory: { [KEY]: ch }, marketEdge: { [KEY]: FX.marketEdge },
  bet365History: FX.bet365History || {}, extra: { playingStyles: styles } });
const p = FX.profile;
const T = L.text;
const render = (patch) => { I.resetState(KEY); Object.assign(I.state, { modal: 'speed' }, patch || {}); return I.renderSpeedModal(p); };
const PP4 = I.PP4 || { SPEED_FLOOR: 5, ALT_CUT_M: 500 };   // the pre-v4 module (control run) has no PP4 export
const FLOOR = PP4.SPEED_FLOOR;

const checks = {
  bar(html) {
    const band = html.slice(html.indexOf('data-pp2-band="standalone-card"'), html.indexOf('data-pp2-spd="summary"'));
    assert(band.length > 0, 'no standalone filter band');
    const wins = (band.match(/data-pp2="spd-win" data-v="(\w+)"/g) || []).map(x => x.replace(/.*data-v="(\w+)"/, '$1'));
    assert.deepStrictEqual(wins, ['l52', 'career'], 'the Window pills are not Last 52 weeks | Career');
    assert(/data-pp2="spd-win" data-v="career"[^>]*aria-pressed="true"/.test(band), 'Career is not the default window');
    const surfs = (band.match(/data-pp2="spd-surf" data-v="(\w+)"/g) || []).map(x => x.replace(/.*data-v="(\w+)"/, '$1'));
    assert.deepStrictEqual(surfs, ['all', 'Hard', 'Clay', 'Grass', 'Indoors'], 'the surface pills');
    assert(band.indexOf('spd-win') < band.indexOf('width:1px;height:18px') && band.indexOf('width:1px;height:18px') < band.indexOf('spd-surf'), 'no divider between Window and Surface');
    assert(/data-pp2="fm-toggle" data-v="spd"/.test(band) && /margin-left:auto/.test(band), 'no Filters trigger at the right');
  },
  popover(html, D) {
    assert(/width:620px/.test(html), 'the popover is not 620px');
    const t = T(html);
    assert(/PRICE ROLE|Price role/.test(t) && /Altitude/.test(t) && /Opponent archetype/.test(t), 'a group is missing');
    assert(t.includes('Altitude = venues at ' + PP4.ALT_CUT_M + ' m or higher.'), 'the altitude hint does not name PP4.ALT_CUT_M');
    const pool = I.spdPool(p), f = I.spdFilter(), cut = I.last52Cutoff();
    [['spdRole', 'role', ['all', 'fav', 'dog']], ['spdAlt', 'alt', ['all', 'sea', 'alt']]].forEach(([g, k, vs]) => vs.forEach(v => {
      const n = pool.filter(r => I.spdRowOk(r, Object.assign({}, f, { [k]: v }), cut)).length;
      const re = new RegExp('data-pp2="fm-set" data-g="' + g + '" data-v="' + v + '"[\\s\\S]*?font-weight:400;">(\\d+)<');
      const m = re.exec(html); assert(m, g + '=' + v + ' has no count');
      assert.strictEqual(+m[1], n, g + '=' + v + ': count ' + m[1] + ' is not the ' + n + ' rows it keeps');
    }));
  },
  archOpen(html) {
    const names = (html.match(/data-g="spdArch" data-v="([^"]+)"/g) || []).map(x => x.replace(/.*data-v="([^"]+)"/, '$1'));
    assert.deepStrictEqual(names, ['all', 'Big Server', 'Big Server + First Strike', 'Big Server + Complete Baseliner', 'Attacking Baseliner',
      'Solid Baseliner', 'Counterpuncher', 'Solid Defender', 'All Court Elite'], 'the archetype drop-down is not the eight names');
  },
  filterOn(html, title) {
    assert(/Filters<span[^>]*>· 1</.test(html), 'the trigger does not read "Filters · 1"');
    assert(/data-pp2="fm-toggle" data-v="spd"[^>]*background:color-mix\(in srgb, var\(--bar\) 12%/.test(html), 'the trigger is not blue with a hidden filter on');
    assert(/data-pp2-applied="spd"[\s\S]*As favourite[\s\S]*Clear all/.test(html), 'no Applied chip + Clear all');
    assert(/^\d+ of \d+ matches$/.test(title), 'the title sample is not "n of m matches": ' + title);
    assert(/vs unfiltered/.test(html), 'the gap does not compare with the unfiltered band');
  },
  money(html) {
    const t = T(html);
    assert(!/tour average 50%/.test(t) && !/Vs tour[^A-Z]*[+−]\d/.test(t), 'Vs tour shows a figure (the export\'s 50% is a placeholder)');
    assert(/VS TOUR|Vs tour/.test(t) && /no tour figure/.test(t), 'Vs tour is not a dash with "no tour figure"');
    assert(!/[+−]\d+\.\du\b/.test(t), 'a raw-units figure is printed (§0.5: yield %)');
    assert(/on the price/.test(t), 'no summary yield');
  },
  detail(html) {
    const labels = (html.match(/data-pp2-spd="detail"[\s\S]*?(?=<div style="max-height)/) || [''])[0];
    const got = (T(labels).match(/Win rate|Vs tour|On the price|As favourite|Deciding sets/g) || []);
    assert.deepStrictEqual(got, ['Win rate', 'Vs tour', 'On the price', 'As favourite', 'Deciding sets'], 'the five tiles');
    assert(/grid-template-columns:58px 22px minmax\(0,1\.1fr\) 46px 50px minmax\(0,1\.3fr\) 52px 52px;gap:0;/.test(html), 'the match grid');
    assert(/data-pp2-spdgroup="1"[\s\S]*?>speed<\/span>/.test(html), 'the group line has no speed');
  },
};
// ── the checks on the shipped renderer
H.check('1 · the shared filter bar (Window · Surface · Filters), no Applied row when no hidden filter is on', () => {
  const html = render();
  checks.bar(html);
  assert(!/data-pp2-applied=/.test(html), 'an Applied row with no hidden filter on');
  assert.strictEqual((I.MODAL_TITLE_COUNT || {}).speed(p), I.spdPool(p).length + ' matches', 'the unfiltered title sample');
});
H.check('2 · the Filters popover: 620px, three groups, every count = the rows it keeps; the archetype drop-down', () => {
  checks.popover(render({ fmOpen: 'spd' }));
  checks.archOpen(render({ fmOpen: 'spd', fmSel: 'spd|spdArch' }));
});
H.check('3 · a hidden filter on: "Filters · 1" blue, Applied chip, "n of m" title, gap vs unfiltered', () => {
  const html = render({ spdRole: 'fav' });
  checks.filterOn(html, (I.MODAL_TITLE_COUNT || {}).speed(p));
});
H.check('4 · Vs tour is a dash, never 50%; the money figure is a yield %', () => {
  checks.money(render());
  checks.money(render({ spdRole: 'fav' }));
  assert(/for these filters/.test(T(render({ spdRole: 'fav' }))), 'Vs tour does not say "for these filters" with Price role on');
});
H.check('5 · the detail card: five tiles, the grid, the group line; a walkover row carries a result bullet', () => {
  I.resetState(KEY);
  const D = I.spdData(p, I.spdFilter());
  const band = D.bands.find(b => b.listed.some(m => m.date === WO.date));
  assert(band, 'the walkover is banded');
  assert(!band.ms.some(m => m.date === WO.date), 'the walkover is counted');
  const html = render({ spdBand: band.key });
  checks.detail(html);
  const row = html.slice(html.indexOf('data-pp2-wo-row="1"'), html.indexOf('data-pp2-wo-row="1"') + 1200);
  assert(/title="Walkover against him · he withdrew"[^>]*background:var\(--neg\)/.test(row), 'the walkover row has no red result bullet');
  const alt = band.ms.concat(band.listed).map(I.spdAltOf).filter(v => v != null);
  if (alt.length) assert(/>altitude<\/span>/.test(html), 'a venue with an altitude on record prints none');
});
H.check('6 · a band under the floor is a dash + "n matches · min ' + FLOOR + '"; all bands empty = "No matches for these filters"', () => {
  let thin = 0, empty = 0;
  for (const win of ['career', 'l52']) for (const surf of ['all', 'Hard', 'Clay', 'Grass', 'Indoors']) for (const role of ['all', 'fav', 'dog']) for (const alt of ['all', 'sea', 'alt']) {
    const st = { spdWin: win, spdSurf: surf, spdRole: role, spdAlt: alt };
    I.resetState(KEY); Object.assign(I.state, st);
    const D = I.spdData(p, I.spdFilter()), html = render(st);
    D.bands.forEach(b => {
      if (!b.n || b.n >= FLOOR) return;
      thin++;
      assert(html.includes(b.n + (b.n === 1 ? ' match' : ' matches') + ' · min ' + FLOOR), 'thin ' + b.key + ' has no "n matches · min" line');
      assert(!html.includes('data-pp2="spd-band" data-v="' + b.key + '"'), 'thin ' + b.key + ' opens');
    });
    if (!D.tn) {
      empty++;
      assert(/No matches for these filters/.test(html) && /data-pp2="spd-clearall"/.test(html), 'the empty state');
      assert(!/data-pp2-spd="detail"/.test(html), 'a detail card under the empty state');
    }
  }
  assert(thin > 0, 'no thin band was manufactured — this check never ran');
  assert(empty > 0, 'no empty filter set was manufactured — this check never ran');
  console.log('        ' + thin + ' thin bands, ' + empty + ' empty filter sets');
});
H.check('7 · Clear all (empty state) resets Window and Surface too; Reset filters clears the hidden filters only', () => {
  const src = fs.readFileSync(process.env.PP4_SRC || path.join(L.ROOT, 'player-profile-v2.js'), 'utf8');
  assert(/kind === 'spd-clearall'\) \{ state\.spdRole = 'all'; state\.spdAlt = 'all'; state\.spdArch = 'all'; state\.spdWin = 'career'; state\.spdSurf = 'all';/.test(src), 'spd-clearall does not reset Window + Surface');
  render();
  assert.deepStrictEqual(I.FM_KEYS ? I.FM_KEYS.spd : ['spdRole', 'spdAlt', 'spdArch'], ['spdRole', 'spdAlt', 'spdArch']);
});
// ── CONTROL: the v3 drawer's markers, fed to the same checks, must go red (each check is not vacuous)
const V3 = '<div data-pp2-band="standalone" style="padding:10px 16px;"><span data-pp2="spd-surf" data-v="all">All</span></div>' +
  '<span>Faster courts</span><div data-pp2-spd="summary"></div><span>+1.7u</span><span>Favourite · underdog</span>' +
  '<div style="display:grid;grid-template-columns:48px 12px minmax(0,1.1fr) 36px 40px minmax(0,1.3fr) 46px 46px;gap:0 10px;">';
H.mustFail('CONTROL · the v3 band (surfaces only, no Window, no Filters) fails the bar check', () => checks.bar(V3));
H.mustFail('CONTROL · a raw-units figure fails the money check', () => checks.money(V3 + '<span>Vs tour</span><span>no tour figure</span><span>on the price</span>'));
H.mustFail('CONTROL · the export\'s 50% placeholder fails the money check', () => checks.money('<span>Vs tour</span><span>+22.0pp</span><span>tour average 50%</span><span>on the price</span>'));
H.mustFail('CONTROL · the v3 four tiles and 10px-gap grid fail the detail check', () => checks.detail('<div data-pp2-spd="detail"><span>Win rate</span><span>On the price</span><span>Favourite · underdog</span><span>Deciding sets</span></div><div style="max-height">' + V3));
H.mustFail('CONTROL · a grey trigger with no Applied row fails the filter-on check', () => checks.filterOn(render({ spdRole: 'all' }), '725 matches'));
H.done();
