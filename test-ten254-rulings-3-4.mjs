// TEN-254 — founder rulings 3 and 4 (2026-09-23), locked against the RENDERER.
//
//   Ruling 3 · Vs pk renders with NO colour, at any value.
//   Ruling 4 · A player under the 10-match gate is hidden entirely — §5's greyed
//              5–9 band is NOT built on this board.
//
// Both OVERTURN the design bundle (README TAB 4 asks for a two-way -60 colour;
// §5 asks for a 5-9 greyed band). The rationale and the measurement are in
// .claude/rules/ratings.md. This file is the mechanism that stops the next reader
// "fixing" the code back toward the bundle.
//
// It SLICES the real functions out of the shipped page and RUNS them, because a
// regex over the source proved worthless on this exact surface: nine
// feature-killing mutations passed a grep-based lock (see
// test-ten254-mental-count.mjs). Every check here has a mutant that must break it.
//
// Run: node --test test-ten254-rulings-3-4.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const STORE = join(HERE, 'surface-ratings.json');
const HAVE_STORE = existsSync(STORE);

function fnSource(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('function ' + name + ' is gone — this lock points at nothing');
  const nl = src.indexOf('\n', i);
  const one = src.slice(i, nl < 0 ? src.length : nl);
  if ((one.match(/\{/g) || []).length === (one.match(/\}/g) || []).length && one.trimEnd().endsWith('}')) return one;
  let d = 0; const open = src.indexOf('{', i);
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces slicing ' + name);
}
function objSource(src, name) {
  const i = src.indexOf('var ' + name + '=');
  if (i < 0) throw new Error(name + ' is gone');
  let d = 0; const open = src.indexOf('{', i);
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1) + ';'; }
  }
  throw new Error('unbalanced braces slicing ' + name);
}
function makeDoc() {
  const mk = tag => ({
    tagName: tag, className: '', title: '', _text: '', _html: '', children: [], style: {},
    appendChild(c) { this.children.push(c); return c; },
    set textContent(v) { this._text = String(v); },
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); },
    set innerHTML(v) { this._html = String(v); this._text = String(v); },
    get innerHTML() { return this._html; },
    get firstChild() { return this.children[0] || null; },
    querySelectorAll(sel) {
      const cls = sel.replace(/^\./, ''); const out = [];
      const walk = e => { for (const c of e.children) {
        if ((c.className || '').split(/\s+/).includes(cls)) out.push(c); walk(c); } };
      walk(this); return out;
    },
  });
  return { createElement: mk };
}
// RAT_GATE must come from the SHIPPED SOURCE, not from a literal here. Injecting
// 10 made the sandbox immune to a mutation of `var RAT_GATE=10`, so the "gate is
// 10" assertion asserted this file's own constant — vacuous, and the mutant
// matrix caught it. Parse it instead.
function gateOf(src) {
  const m = /var\s+RAT_GATE\s*=\s*(\d+)\s*;/.exec(src);
  if (!m) throw new Error('RAT_GATE is gone from the source — this lock points at nothing');
  return Number(m[1]);
}
function build(src, store) {
  const need = ['el','esc','fmtInt','median','ratEloKey','ratLastTok','ratEloRec','ratNode',
    'ratMatches','ratVal','ratRating','ratN','ratBoardPool','ratPool','ratMedian','ratFmt',
    'ratSortRows','ratSortHead','ratSliceNote','ratInitials','ratAvatar','ratLeaderboard'];
  let code = objSource(src, 'RAT_BOARDS') + '\n';
  for (const f of need) code += fnSource(src, f) + '\n';
  const sandbox = {
    document: makeDoc(), RAT: store, ELO: null, RAT_GATE: gateOf(src), ELO_CAVEAT: '',
    POS: '#3dd68c', NEG: '#e0616f', MUT: '#8b96b5',
    state: { ratSurf: 'All', ratScope: 'career', ratBoard: 'mental',
             ratSortKey: 'rtg', ratSortDir: 'desc', ratSel: [], ratQ: '' },
    render() {}, ratOpenPlayer() {}, q() { return null; }, use() {}, console,
  };
  const fn = new Function(...Object.keys(sandbox),
    code + '\nreturn {ratLeaderboard, ratBoardPool, ratFmt, ratVal, state, RAT, RAT_GATE};');
  return fn(...Object.values(sandbox));
}
const loadStore = () => JSON.parse(readFileSync(STORE, 'utf8'));

// ── RULING 3 · Vs pk carries no colour ──────────────────────────────────────
// ratFmt is the one place a sign colour could be minted for this column, and the
// cell builder is the one place it could be applied. Check BOTH by execution.
test('ruling 3: ratFmt never returns colour markup for a signed value', () => {
  const api = build(SRC, { players: [] });
  for (const v of [-495, -200, -61, -60, -59, -1, 0, 1, 250]) {
    const out = api.ratFmt(v, 0, false, true);
    assert.equal(typeof out, 'string');
    assert.ok(!/#[0-9a-fA-F]{3,6}/.test(out),
      `ratFmt(${v}) emitted a colour: ${out} — ruling 3 says Vs pk has NO colour at any value`);
    assert.ok(!/<span|style=|class=/.test(out),
      `ratFmt(${v}) emitted markup that could carry a colour: ${out}`);
  }
  // and it is still a SIGNED figure — the ruling removes colour, not the sign
  assert.equal(api.ratFmt(-43, 0, false, true), '-43');
  assert.equal(api.ratFmt(0, 0, false, true), '0', 'a player AT his peak prints a bare 0, not +0');
  assert.equal(api.ratFmt(12, 0, false, true), '+12');
  assert.equal(api.ratFmt(null, 0, false, true), '—');
});

test('ruling 3: no rendered Vs pk cell carries a colour', (t) => {
  if (!HAVE_STORE) { t.skip('surface-ratings.json absent — skipping OUT LOUD, not passing'); return; }
  // The Elo board needs an ELO store; build a minimal real-shaped one so Vs pk
  // actually renders values rather than dashing out and passing vacuously.
  const store = loadStore();
  const api = build(SRC, store);
  const cells = renderVsPk(SRC, store);
  assert.ok(cells.length >= 3, `only ${cells.length} Vs pk cells rendered — the check would be vacuous`);
  const spread = new Set(cells.map(c => c.v));
  assert.ok(spread.size >= 3, 'Vs pk values are not varied enough to exercise a threshold');
  assert.ok(cells.some(c => c.v < -60) && cells.some(c => c.v >= -60),
    'the sample must straddle -60, or a threshold bug could not show');
  for (const c of cells) {
    assert.ok(!c.color, `Vs pk cell for value ${c.v} carries colour ${c.color} — ruling 3 forbids it`);
    assert.equal(c.weight, '400', `Vs pk cell for ${c.v} is weight ${c.weight}; it must match its neighbours at 400`);
  }
});

// Render the Elo board with a synthetic ELO store straddling -60.
function renderVsPk(src, store) {
  const names = store.players.slice(0, 8).map(p => p.name);
  const deltas = [-495, -207, -159, -77, -61, -60, -30, -3];
  const eloObj = { elo: {}, bySurnameElo: {} };
  names.forEach((nm, i) => {
    const m = /^([A-Z])\.\s*(.+)$/.exec(nm);
    const key = m ? m[2].toLowerCase().replace(/[^a-z ]/g, '').trim() + '|' + m[1].toLowerCase() : nm;
    const peak = 2000, cur = peak + deltas[i];
    eloObj.elo[key] = { all: { rating: cur }, hard: { rating: cur }, clay: { rating: cur },
                        grass: { rating: cur }, peak: { rating: peak, month: '2026-05' } };
  });
  const need = ['el','esc','fmtInt','median','ratEloKey','ratLastTok','ratEloRec','ratNode',
    'ratMatches','ratVal','ratRating','ratN','ratBoardPool','ratPool','ratMedian','ratFmt',
    'ratSortRows','ratSortHead','ratSliceNote','ratInitials','ratAvatar','ratLeaderboard'];
  let code = objSource(src, 'RAT_BOARDS') + '\n';
  for (const f of need) code += fnSource(src, f) + '\n';
  const sandbox = {
    document: makeDoc(), RAT: { players: store.players.filter(p => names.includes(p.name)) },
    ELO: eloObj, RAT_GATE: gateOf(src), ELO_CAVEAT: '',
    POS: '#3dd68c', NEG: '#e0616f', MUT: '#8b96b5',
    state: { ratSurf: 'All', ratScope: 'career', ratBoard: 'elo',
             ratSortKey: 'rtg', ratSortDir: 'desc', ratSel: [], ratQ: '' },
    render() {}, ratOpenPlayer() {}, q() { return null; }, use() {}, console,
  };
  const api = new Function(...Object.keys(sandbox),
    code + '\nreturn {ratLeaderboard, ratBoardPool};')(...Object.values(sandbox));
  const pool = api.ratBoardPool('elo');
  const wrap = api.ratLeaderboard(pool, 'elo');
  // walk the flat grid: heads then median row then data rows; Vs pk is the last column
  const grid = wrap.children[0].children[0];
  const heads = grid.querySelectorAll('db-rh').map(e => e.textContent.replace(/[^A-Za-z ]/g, '').trim());
  const n = grid.querySelectorAll('db-rhead').length;
  const idx = heads.findIndex(h => h === 'Vs pk');
  if (idx < 0) throw new Error('no Vs pk head found — heads were ' + JSON.stringify(heads));
  const out = [];
  for (let r = 2; r < grid.children.length / n; r++) {
    const cell = grid.children[r * n + idx]; if (!cell) continue;
    const f = cell.firstChild; if (!f) continue;
    const v = parseFloat(String(f.textContent).replace(/[^\-0-9.]/g, ''));
    if (Number.isNaN(v)) continue;
    out.push({ v, color: f.style.color || '', weight: f.style.fontWeight || '' });
  }
  return out;
}

// ── RULING 4 · under 10 matches, the whole player is hidden ──────────────────
test('ruling 4: a player with 9 matches is absent from the board entirely', (t) => {
  if (!HAVE_STORE) { t.skip('surface-ratings.json absent — skipping OUT LOUD'); return; }
  const store = loadStore();
  const donor = JSON.parse(JSON.stringify(store.players.find(p => p.surfaces?.All?.career?.mental)));
  const thin = JSON.parse(JSON.stringify(donor));
  thin.name = 'Z. ThinSample';
  // 9 matches at the slice — one under the gate. serve.svMatches is what the
  // serve board floors on; sample.matches is what the others floor on.
  thin.surfaces.All.career.sample.matches = 9;
  if (thin.surfaces.All.career.serve) thin.surfaces.All.career.serve.svMatches = 9;
  const api = build(SRC, { players: [donor, thin] });
  assert.equal(api.RAT_GATE, 10, 'RAT_GATE moved; ruling 4 and gate 94aed7f5 both pin it at 10');
  for (const board of ['mental', 'serve', 'return', 'up']) {
    const pool = api.ratBoardPool(board);
    assert.ok(!pool.some(p => p.name === 'Z. ThinSample'),
      `the 9-match player is on the ${board} board — ruling 4 says hide the whole player`);
    assert.ok(pool.some(p => p.name === donor.name),
      `the donor vanished from ${board} too — the check would be vacuous`);
    const grid = api.ratLeaderboard(pool, board);
    assert.ok(!/ThinSample/.test(grid.textContent),
      `the 9-match player painted a row on ${board}`);
  }
});

test('ruling 4: §5\'s greyed 5-9 band is NOT built on this board', (t) => {
  if (!HAVE_STORE) { t.skip('surface-ratings.json absent — skipping OUT LOUD'); return; }
  const store = loadStore();
  const donor = JSON.parse(JSON.stringify(store.players.find(p => p.surfaces?.All?.career?.mental)));
  for (const m of [5, 6, 7, 8, 9]) {
    const thin = JSON.parse(JSON.stringify(donor));
    thin.name = 'Z. Band' + m;
    thin.surfaces.All.career.sample.matches = m;
    if (thin.surfaces.All.career.serve) thin.surfaces.All.career.serve.svMatches = m;
    const api = build(SRC, { players: [donor, thin] });
    const grid = api.ratLeaderboard(api.ratBoardPool('mental'), 'mental');
    assert.ok(!/Band/.test(grid.textContent),
      `n=${m} rendered a row — that is §5's 5-9 band, which ruling 4 overturned`);
    assert.ok(!/small sample/i.test(grid.textContent),
      `n=${m} rendered a "small sample" note — §5's band is not built here`);
  }
});

// ── MUTANTS ─────────────────────────────────────────────────────────────────
const MUTANTS = [
  ['ruling 3: a -60 two-way colour added to ratFmt (the bundle text)', s =>
    s.replace("      if(v===0) return (0).toFixed(dec);",
              "      if(v===0) return (0).toFixed(dec);\n      if(dec===0) return '<span style=\"color:'+(v>=-60?'#8b96b5':'#e0616f')+'\">'+(v>0?'+':'')+v.toFixed(dec)+'</span>';")],
  ['ruling 3: a colour applied at the cell instead', s =>
    s.replace("        f.style.fontSize='13px'; f.style.fontWeight='400';",
              "        f.style.fontSize='13px'; f.style.fontWeight='400';\n        if(c.sgn&&v!=null){ f.style.color = v>=-60?'#8b96b5':'#e0616f'; f.style.fontWeight='700'; }")],
  ['ruling 4: the match gate dropped from ratBoardPool', s =>
    s.replace('      return m!=null && m>=RAT_GATE;', '      return true;')],
  ['ruling 4: the gate lowered to 5 (§5\'s band floor)', s =>
    s.replace('  var RAT_GATE=10;', '  var RAT_GATE=5;')],
];

test('CONTROL: every mutant is caught — a check no mutant breaks tests nothing', (t) => {
  if (!HAVE_STORE) { t.skip('surface-ratings.json absent — skipping OUT LOUD'); return; }
  const store = loadStore();
  const survivors = [];
  for (const [name, mutate] of MUTANTS) {
    const mutated = mutate(SRC);
    assert.notEqual(mutated, SRC, `mutant "${name}" did not apply — it proves nothing`);
    let caught = false;
    try {
      const api = build(mutated, { players: [] });
      // ruling 3, formatter
      for (const v of [-495, -61, -59, 0]) {
        const out = api.ratFmt(v, 0, false, true);
        if (/#[0-9a-fA-F]{3,6}/.test(out) || /<span|style=/.test(out)) { caught = true; break; }
      }
      // ruling 3, rendered cell
      if (!caught) {
        const cells = renderVsPk(mutated, store);
        if (cells.some(c => c.color || c.weight !== '400')) caught = true;
      }
      // ruling 4
      if (!caught) {
        const donor = JSON.parse(JSON.stringify(store.players.find(p => p.surfaces?.All?.career?.mental)));
        const thin = JSON.parse(JSON.stringify(donor));
        thin.name = 'Z. ThinSample';
        thin.surfaces.All.career.sample.matches = 9;
        if (thin.surfaces.All.career.serve) thin.surfaces.All.career.serve.svMatches = 9;
        const a2 = build(mutated, { players: [donor, thin] });
        if (a2.RAT_GATE !== 10) caught = true;
        if (!caught && a2.ratBoardPool('mental').some(p => p.name === 'Z. ThinSample')) caught = true;
      }
    } catch { caught = true; }
    if (!caught) survivors.push(name);
  }
  assert.deepEqual(survivors, [],
    `${survivors.length} of ${MUTANTS.length} mutants SURVIVED: ${survivors.join(' · ')}`);
  console.log(`  mutants: ${MUTANTS.length} caught, 0 survived`);
});
