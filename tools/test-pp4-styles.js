// tools/test-pp4-styles.js — Player Profile v4 (handoff 2026-11-14, CHANGES §7): the Match-up record drawer.
//
// Pinned inputs: the committed fixture player (tools/fixtures/ten384-figures/player-2840.json) with a playing-styles
// map built here, so every check is identical in every checkout. Each check is red on the v3 drawer — the control:
// `PP4_BASE=2f9f6c80f node tools/test-pp4-styles.js` runs the same checks against that commit's module.
//
//   band     joined to the card on the card tone (joined-card), padding 20px 24px (§0.2)
//   summary  caps scope · record · "N% win rate" · matches · units "backing him" (founder 2026-11-14: units)
//   tiles    exactly Best match-up · Toughest (… outside the elite when All Court Elite is his worst); rated only;
//            hidden under 2 rated; no "Most played"
//   chart    a stem from his average to every dot; no "dot size = matches" caption (§0.4)
//   table    one header line "Record by archetype" … vs his avg (not sortable) · Yield; thin rows dash rate, gap, units and carry "under 5";
//            bars neutral unless selected (§0.1); W–L soft ink
//   box      Yield backing him tile; muted italic "ret." after a retired score; retirements out of deciding sets
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const L = require('./ten384-figures-lib.js');

const ROOT = L.ROOT;
const BASE = process.env.PP4_BASE || null;
function srcOf(rel) {
  if (!BASE) return path.join(ROOT, rel);
  const f = path.join(os.tmpdir(), 'pp4sty-control-' + BASE + '-' + rel.replace(/\//g, '_'));
  fs.writeFileSync(f, execFileSync('git', ['-C', ROOT, 'show', BASE + ':' + rel], { maxBuffer: 64 << 20 }));
  return f;
}
const PP2 = srcOf('player-profile-v2.js');
// eslint-disable-next-line import/no-dynamic-require
const TI = require(srcOf('tournament-identity.js'));
const H = L.harness();
const T = L.text;
console.log('Profile v4 · Match-up record — ' + (BASE ? 'CONTROL against ' + BASE : 'working tree'));

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten384-figures', 'player-2840.json'), 'utf8'));
const AXES = ['Big Server + First Strike', 'Attacking Baseliner', 'Solid Baseliner', 'Counterpuncher', 'Big Server + Complete Baseliner'];
// mode 'elite': every loss's opponent is All Court Elite where it never beat him (ACE = his worst rated archetype);
// mode 'one': every opponent is an Attacking Baseliner (one rated archetype → no tiles).
function stylesFor(mode) {
  const lostTo = {}, beat = {};
  FX.careerHistory.forEach(r => { if (!r.opponent) return; (r.won ? beat : lostTo)[r.opponent] = 1; });
  const players = []; let i = 0;
  Object.keys(Object.assign({}, lostTo, beat)).sort().forEach(o => {
    let a;
    if (mode === 'one') a = 'Attacking Baseliner';
    else if (lostTo[o] && !beat[o] && i % 3 === 0) a = 'All Court Elite';
    else a = AXES[i % AXES.length];
    i += 1;
    players.push({ name: o, archetype_label: a });
  });
  // one thin archetype: a single Solid Defender
  if (mode !== 'one') { const o = players.find(x => x.archetype_label === 'Counterpuncher'); if (o) o.archetype_label = 'Solid Defender'; }
  return { players };
}
function mod(mode) {
  const th = FX.tournamentHistory;
  const p = Object.assign({}, FX.profile, { tournamentHistory: TI.mergeHistory ? TI.mergeHistory(th) : th });
  const m = L.loadPp2({
    src: PP2, now: FX.asOf, players: { [FX.key]: p }, careerHistory: { [FX.key]: FX.careerHistory },
    marketEdge: { [FX.key]: FX.marketEdge }, bet365History: FX.bet365History,
    extra: { TournamentIdentity: TI, playingStyles: stylesFor(mode) }
  });
  return { I: m.I, p };
}
function render(I, p, patch) {
  const saved = Object.assign({}, I.state);
  Object.assign(I.state, { key: p.key }, patch || {});
  try { return I.renderStylesModal(p); } finally { Object.keys(I.state).forEach(k => delete I.state[k]); Object.assign(I.state, saved); }
}
const E = mod('elite');
const HTML = render(E.I, E.p);
const TXT = T(HTML);

// v5 (handoff 2026-11-19, CHANGES §6.1) · filter card + ONE card (dot chart over table); Best / Toughest marks, no tiles
H.check('final 2026-11-26 · filter bar = the site toolbar (pad 12/14, Window then Surface) and one card radius 16, chart over table', () => {
  assert(/data-pp2-stybar="1"[^>]*padding:12px 14px;margin-bottom:12px/.test(HTML), 'no site toolbar');
  const wins = (HTML.match(/data-pp2="sty-win" data-v="(\w+)"/g) || []).map(x => x.replace(/.*="(\w+)"/, '$1'));
  assert.deepStrictEqual(wins, ['l52', 'career'], 'the Window track');
  assert(HTML.indexOf('data-pp2="sty-win"') < HTML.indexOf('data-pp2="sty-surf"'), 'Window comes before Surface');
  assert(/data-pp2-sty="card"[^>]*border-radius:16px;margin-bottom:12px/.test(HTML), 'the one card');
  assert(!/data-pp2-sty="table"/.test(HTML), 'a second (table) card is back');
  assert(HTML.indexOf('pp2-stychart') < HTML.indexOf('pp2-styrow'), 'the chart is not over the table');
});
H.check('final 2026-11-26 · head = the title only (no record, win rate or yield); the scope sits in the "?" as a lifted chip', () => {
  assert(/font-size:18px;font-weight:800;[^>]*>Career</.test(HTML), 'no 18/800 title');
  assert(!/\d+% win rate/.test(TXT) && !/backing him/.test(TXT.replace(/Backing him: units/g, '')), 'the head still carries a record / win rate / yield');
  const open = render(E.I, E.p, { info: 'sty1' });
  assert(/background:var\(--pp-x-lifted\);box-shadow:inset 0 0 0 1px [^;]+;border-radius:8px;[^"]*">Career · \d+ matches · by the opponent/.test(open), 'no scope chip in the "?"');
});
H.check('v5 · Best / Toughest: blue dots with a badge in the chart, a word chip on the row, no summary tiles', () => {
  assert(!/class="pp2-stytile"/.test(HTML), 'summary tiles are back');
  assert(/>Best<\/span>/.test(HTML) && /title="Toughest outside the elite"/.test(HTML), 'no Best / Toughest (outside the elite) marks');
  const badges = (HTML.match(/translateY\(-?[\d.]+px\);display:inline-flex;align-items:baseline;gap:6px;background:var\(--pp-x-lifted\)/g) || []).length;
  assert.strictEqual(badges, 2, badges + ' badges in the chart');
  const best = HTML.split('class="pp2-styrow').find(r => />Best<\/span>/.test(r.slice(0, 1500)));
  assert(best && /background:var\(--pp-x-link\)/.test(best), 'the Best row bar is not full blue');
});
H.check('tiles · no marks with fewer than 2 rated archetypes', () => {
  const O = mod('one');
  const h = render(O.I, O.p);
  assert(/Attacking Baseliner/.test(T(h)), 'vacuous: no archetype row');
  assert(!/>Best<\/span>/.test(h), 'a Best mark with one rated archetype');
});
H.check('chart · a stem from his average to each dot; no "dot size = matches" caption (§0.4)', () => {
  const dots = (HTML.match(/class="pp2-stydot/g) || []).length;
  const stems = (HTML.match(/width:1px;background:(color-mix\(in srgb, var\(--link\) 40%, transparent\)|var\(--edge-10\));pointer-events:none;/g) || []).length;
  assert(dots >= 5, 'vacuous: ' + dots + ' dots');
  assert.strictEqual(stems, dots, stems + ' stems for ' + dots + ' dots');
  assert(!/dot size = matches/.test(TXT), 'the unit caption is still on the page');
});
H.check('table · heads Archetype … vs his avg (not sortable) · Backing in units (founder 2026-11-14)', () => {
  assert(/ARCHETYPE|Archetype/.test(TXT) && /vs his avg/.test(TXT) && /Backing/.test(TXT), 'heads');
  assert(!/data-pp2="sty-sort" data-v="[^"]*"[^>]*>\s*<span[^>]*>vs his avg/.test(HTML), 'vs his avg is sortable');
  assert(/data-pp2="sty-sort" data-v="u"/.test(HTML), 'Backing is not sortable');
});
H.check('table · a thin row (under the floor) dashes win %, the gap and the yield; rated rows carry a signed pp gap', () => {
  const row = HTML.split('class="pp2-styrow').find(s => /Solid Defender/.test(s.slice(0, 600)));
  assert(row, 'vacuous: no Solid Defender row');
  const t = T('<div ' + row);
  assert(/under 5/.test(t) && /class="pp2-stytag"/.test(row), 'no "under 5" tag on a thin row (founder 2026-11-14: follow design)');
  assert((t.match(/—/g) || []).length >= 3, 'thin row prints a rate: ' + t);
  assert(/[+−]\d+\.\dpp/.test(TXT), 'no vs his avg figure on a rated row');
});
H.check('table · bars neutral unless selected (§0.1); the selected archetype\'s bar is blue', () => {
  assert(/background:var\(--pp-x-bar-55\)/.test(HTML), 'no 55% blue resting bar (v5 §0.6)');
  assert(!/background:var\(--bar\)/.test(HTML), 'a value-blue bar');
  const sel = render(E.I, E.p, { fb: { box: 'styles', v: 'Attacking Baseliner' } });
  assert(/background:var\(--pp-x-link\)/.test(sel), 'the selected archetype keeps a neutral bar');
});
H.check('box · Backing him tile (units), card-ring tiles, retirements marked "ret." and out of deciding sets', () => {
  const name = 'Attacking Baseliner';
  E.I.state.key = E.p.key;
  const fb = E.I.FB_BUILD.styles(E.p, name);
  E.I.state.key = null;
  assert(fb, 'no box');
  assert.strictEqual(fb.tileRing, true, 'box tiles are not on the card ring');
  const labels = fb.tiles.map(t => t.label);
  assert.deepStrictEqual(labels, ['Win rate', 'Backing him', 'Favourite · underdog', 'Deciding sets'], labels.join(' | '));
  assert(/1 unit on him at closing price/.test(fb.tiles[1].tail), 'yield tile tail');
  const html = E.I.floatBoxHtml(fb);
  assert(/border:1\.25px solid var\(--edge-6\);border-radius:12px/.test(html), 'tile ring');
  assert(FX.careerHistory.some(r => r.retired), 'vacuous: the fixture holds no retirement');
  {
    // every retired match in the fixture, whichever archetype it falls to, prints the muted italic marker
    const all = ['Big Server + First Strike', 'Attacking Baseliner', 'Solid Baseliner', 'Solid Defender', 'Big Server + Complete Baseliner', 'All Court Elite', 'Counterpuncher']
      .map(n => { E.I.state.key = E.p.key; const b = E.I.FB_BUILD.styles(E.p, n); E.I.state.key = null; return b ? E.I.floatBoxHtml(b) : ''; }).join('');
    assert(/font-style:italic;[^"]*">ret\.<\/span>/.test(all), 'no muted italic "ret." on a retired row');
  }
});

H.done();
