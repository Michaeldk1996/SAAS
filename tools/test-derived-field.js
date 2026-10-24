// tools/test-derived-field.js — founder approval 2026-10-23: the Derived lines FIELD (derived-field.json).
//
//   F · ONE DEFINITION: built over a database of one player (the pinned TEN-384 fixture, Korda), every cell of the field
//       equals that player's own line tally from the page (lineCoverage) under the same Window × Tier × format × card ×
//       Surface × Court speed — covered, not covered, void — so the builder adds the page's lines up and defines none.
//   R · RENDER: the header reads "Field" with the note "Field = tracked players under the same filters"; Field = the cell's rate; vs Field = the player's rate minus it, in points;
//       Challenger & ITF on a favourite / underdog card is blank (no prices there); a field of n < 10 is dimmed; neither
//       Field column is ever green or red (a comparison with other players); no field file = a dash, never a number.
//   [neg] a builder that counts retirements, or a page that shows a Challenger & ITF favourite field, is caught.
//
// Run: node tools/test-derived-field.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const L = require('./ten384-figures-lib.js');
const H = L.harness();
const T = L.text;

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten384-figures', 'player-2840.json'), 'utf8'));
const KEY = String(FX.key);
const BUILDER = path.join(__dirname, 'build-derived-field.js');

function stores(dir) {
  fs.mkdirSync(path.join(dir, 'career-history'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'profiles'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'market-edge'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'career-history-index.json'), JSON.stringify({ v: 1, players: { [KEY]: FX.careerHistory.length } }));
  fs.writeFileSync(path.join(dir, 'career-history', KEY + '.json'), JSON.stringify({ v: 1, key: KEY, matches: FX.careerHistory }));
  fs.writeFileSync(path.join(dir, 'profiles', KEY + '.json'), JSON.stringify({ key: KEY, profile: Object.assign({}, FX.profile, { tournamentHistory: FX.tournamentHistory }) }));
  fs.writeFileSync(path.join(dir, 'market-edge', KEY + '.json'), JSON.stringify(FX.marketEdge));
}
function build(builder) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'derived-field-'));
  try {
    stores(dir);
    execFileSync(process.execPath, [builder || BUILDER, '--dir', dir, '--out', path.join(dir, 'derived-field.json')], { stdio: 'pipe' });
    return JSON.parse(fs.readFileSync(path.join(dir, 'derived-field.json'), 'utf8'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function page(field) {
  const p = Object.assign({}, FX.profile, { tournamentHistory: FX.tournamentHistory });
  const m = L.loadPp2({ players: { [KEY]: p }, careerHistory: { [KEY]: FX.careerHistory }, marketEdge: { [KEY]: FX.marketEdge }, bet365History: FX.bet365History });
  m.W.pp2Field = () => (field ? { st: 'ready', d: field } : { st: 'none', d: null });
  m.W.pp2FieldNeed = () => {};
  return { I: m.I, p };
}
const rowsOf = (c) => [].concat.apply([], c.groups.map((g) => g.rows));
const WINS = ['career', 'l24', 'l52'], TIERS = ['all', 'atp', 'chitf'], FMTS = ['bo3', 'bo5'], ROLES = ['all', 'fav', 'dog'];
const SURFS = ['all', 'hard', 'indoors', 'clay', 'grass'], SPEEDS = ['all', 'slow', 'med', 'fast', 'unrated'];

function oneDefinition(field) {
  const { I, p } = page(null);
  let cells = 0, lines = 0;
  for (const win of WINS) for (const tier of TIERS) for (const fmt of FMTS) for (const role of ROLES) for (const surf of SURFS) for (const speed of SPEEDS) {
    // the player's table on the All card holds every line; a card's own table shows its bettable side only
    const c = I.lineCoverage(p, fmt, role, { win, tier, surf, speed });
    const all = rowsOf(I.lineCoverage(p, fmt, 'all', { win, tier, surf, speed }));
    const cell = field.cells[[win, tier, fmt, role, surf, speed].join('|')];
    const sumN = rowsOf(c).reduce((a, r) => a + r.n, 0);
    if (!cell) { assert.strictEqual(sumN, 0, [win, tier, fmt, role, surf, speed].join('|') + ': the page has matches the field lacks'); continue; }
    cells++;
    all.forEach((r) => {
      const i = field.lines[fmt].indexOf(r.label);
      const mine = rowsOf(c).find((x) => x.label === r.label) || I.lineCoverage(p, fmt, role, { win, tier, surf, speed }).groups && null;
      // the field holds every line on every card; compare with the page's own tally of that card (all lines)
      const ref = role === 'all' ? r : (mine || tallyOnCard(I, p, fmt, role, { win, tier, surf, speed }, r.label));
      assert.deepStrictEqual(cell[i].slice(0, 3), [ref.hit, ref.miss, ref.voids], [win, tier, fmt, role, surf, speed, r.label].join('|'));
      lines++;
    });
  }
  return { cells, lines };
}
// a hidden line on a card (the bettable side): the page's tally of that line on that card, read off the All card's members
function tallyOnCard(I, p, fmt, role, o, label) {
  const r = rowsOf(I.lineCoverage(p, fmt, 'all', o)).find((x) => x.label === label);
  const t = { hit: 0, miss: 0, voids: 0 };
  r.members.forEach((x) => { if (x.m.role !== role) return; if (x.res === 'cover') t.hit++; else if (x.res === 'miss') t.miss++; else if (x.res === 'void') t.voids++; });
  return t;
}

function main() {
  const field = build();
  H.check('F · built over one player, every field cell is that player\'s own line tally from the page (all filters, every card)', () => {
    assert.strictEqual(field.players, 1);
    const r = oneDefinition(field);
    assert(r.cells > 100, 'only ' + r.cells + ' cells');
    return r.cells + ' cells · ' + r.lines + ' line tallies equal the page\'s';
  });

  H.check('R · the Field columns render the cell, name the tier, blank Challenger & ITF favourite / underdog, dim a thin field, stay neutral', () => {
    const { I, p } = page(field);
    let k = 0;
    for (const tier of TIERS) for (const role of ROLES) {
      const html = (() => { Object.assign(I.state, { key: p.key, marketTab: 'lines', lcFmt: 'bo3', lcRole: role, lcWin: 'career', lcTier: tier, lcSurf: 'all', lcSpeed: 'all', lcDrill: null }); return I.renderLinesTab(p); })();
      const c = I.lineCoverage(p, 'bo3', role, { tier });
      // Challenger & ITF has no favourite / underdog (no closing prices): those cards draw no table at all
      if (tier === 'chitf' && role !== 'all') {
        assert(!/data-lc-field=/.test(html) && /no favourite or underdog at this tier/.test(T(html)), tier + '/' + role + ': a table under no prices');
        continue;
      }
      if (!c.n) continue;
      assert(/>Field</.test(html) && T(html).includes('Field = tracked players under the same filters') && !/Field \(/.test(T(html)), tier + ': header and note');
      const cell = field.cells[['career', tier, 'bo3', role, 'all', 'all'].join('|')];
      rowsOf(c).forEach((r) => {
        const seg = html.slice(html.indexOf('data-lc-line="' + r.label + '"'));
        const fSpan = /data-lc-field="([^"]*)"[^>]*style="([^"]*)">([^<]*)</.exec(seg), vSpan = /data-lc-vsfield="([^"]*)"[^>]*style="([^"]*)">([^<]*)</.exec(seg);
        const t = cell ? cell[field.lines.bo3.indexOf(r.label)] : null, n = t ? t[0] + t[1] : 0;
        assert(!/var\(--pos\)|var\(--neg\)/.test(fSpan[2] + vSpan[2]), tier + '/' + role + '/' + r.label + ': a Field column is coloured');
        if ((tier === 'chitf' && role !== 'all') || !n) {
          assert.strictEqual(fSpan[3], '—', tier + '/' + role + '/' + r.label + ': expected a blank field'); assert.strictEqual(vSpan[3], '—');
        } else {
          const rate = 100 * t[0] / n;
          assert.strictEqual(fSpan[3], rate.toFixed(1) + '%', tier + '/' + role + '/' + r.label);
          assert.strictEqual(/text-label/.test(fSpan[2]), n < 10, tier + '/' + role + '/' + r.label + ': thin field dim');
          if (r.rate != null) assert.strictEqual((+vSpan[1]).toFixed(1), (Math.round((r.rate - rate) * 10) / 10).toFixed(1), tier + '/' + role + '/' + r.label + ': vs Field');   // text: a one-player field gives 0 and -0
        }
        k++;
      });
    }
    return k + ' rows';
  });

  H.check('R · no field file: every Field and vs Field cell is a dash, never a number', () => {
    const { I, p } = page(null);
    Object.assign(I.state, { key: p.key, marketTab: 'lines', lcFmt: 'bo3', lcRole: 'all', lcWin: 'career', lcTier: 'all', lcSurf: 'all', lcSpeed: 'all', lcDrill: null });
    const html = I.renderLinesTab(p);
    const vals = (html.match(/data-lc-(?:vs)?field="[^"]*"[^>]*>[^<]*</g) || []).map((x) => x.replace(/^.*>/, '').replace(/<$/, ''));
    assert(vals.length > 10 && vals.every((v) => v === '—'), vals.slice(0, 5).join(' '));
    return vals.length + ' cells dashed';
  });

  // ── [neg] ──
  H.mustFail('a builder that counts retirements as covered is caught', () => {
    const src = fs.readFileSync(BUILDER, 'utf8').replace("if (x.res === 'retired') return;", "if (x.res === 'retired') x = Object.assign({}, x, { res: 'cover' });");
    const f = path.join(os.tmpdir(), 'build-derived-field-mutant-' + process.pid + '.js');
    fs.writeFileSync(f, src.replace("require('./ten384-figures-lib.js')", 'require(' + JSON.stringify(path.join(__dirname, 'ten384-figures-lib.js')) + ')'));
    try { oneDefinition(build(f)); } finally { fs.unlinkSync(f); }
  });
  H.mustFail('a page that shows a Challenger & ITF favourite field is caught', () => {
    const SRC = fs.readFileSync(path.join(L.ROOT, 'player-profile-v2.js'), 'utf8');
    const f = path.join(os.tmpdir(), 'pp2-field-mutant-' + process.pid + '.js');
    fs.writeFileSync(f, SRC.replace("if (d.tier === 'chitf' && d.role !== 'all') return null;", ''));
    try {
      const p = Object.assign({}, FX.profile, { tournamentHistory: FX.tournamentHistory });
      const m = L.loadPp2({ src: f, players: { [KEY]: p }, careerHistory: { [KEY]: FX.careerHistory }, marketEdge: { [KEY]: FX.marketEdge }, bet365History: FX.bet365History });
      // a synthetic field with a Challenger & ITF favourite cell: the page must still leave it blank
      const fld = JSON.parse(JSON.stringify(field));
      fld.cells['career|chitf|bo3|fav|all|all'] = fld.lines.bo3.map(() => [7, 3, 0, 2]);
      m.W.pp2Field = () => ({ st: 'ready', d: fld }); m.W.pp2FieldNeed = () => {};
      // the lookup itself (the page never draws this card's table: Challenger & ITF rows carry no price, so its card is empty)
      const got = m.I.lcFieldOf({ win: 'career', tier: 'chitf', role: 'fav', surf: 'all', speed: 'all' }, 'bo3', fld.lines.bo3[0]);
      assert.strictEqual(got, null, 'a Challenger & ITF favourite field shows: ' + JSON.stringify(got));
    } finally { fs.unlinkSync(f); }
  });
  H.done();
}
main();
