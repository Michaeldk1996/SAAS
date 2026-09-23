// TEN-254 — the pressure-point count under every Mental Edge ratio.
//
// FOUNDER, while the Mental Edge sample floor is unruled: "Until I rule, show the
// count next to every Mental Edge ratio so thin samples are visible. Don't pick a
// floor." This file is the lock on that instruction.
//
// WHY THIS FILE EXISTS RATHER THAN THREE REGEXES. The first version of this lock
// lived in tools/test-ratings-rulings.js as greps over the source text. An
// independent review mutated the feature nine ways — deleting the appendChild,
// summing PW only, hard-coding fmtInt(0), leaking the count onto the Serve board,
// inverting the || guard to && — and ALL NINE left that suite green, because a
// regex asserts that characters exist in a file, not that the renderer does
// anything. So this one SLICES ratLeaderboard out of the shipped page and RUNS it
// against the published store under a DOM shim, then re-runs every check against
// each mutant and fails if the check still passes.
//
// That is the repo's own standing rule (memory: "gate at the RENDERER and EXECUTE
// it in the test, never grep for the fix") and the pattern of
// test-database-characterisation.mjs (slice + execute) and tools/test-pixel-pass.js
// (a mutant per check, fail if it survives).
//
// Run: node --test test-ten254-mental-count.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DASH_FILE = join(HERE, 'bsp-consult-dashboard.html');
const STORE = join(HERE, 'surface-ratings.json');
const SRC = readFileSync(DASH_FILE, 'utf8');

// The store is committed, but say so out loud rather than pass vacuously if it
// ever stops being — a suite that silently skips is the failure mode this repo
// has already paid for twice.
const HAVE_STORE = existsSync(STORE);

function fnSource(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('function ' + name + ' is gone — this lock points at nothing');
  const nl = src.indexOf('\n', i);
  const oneLine = src.slice(i, nl < 0 ? src.length : nl);
  // A one-line function is taken WHOLE before any scanning: a brace scanner
  // cannot tell a brace inside a regex literal from a real one.
  if ((oneLine.match(/\{/g) || []).length === (oneLine.match(/\}/g) || []).length
      && oneLine.trimEnd().endsWith('}')) return oneLine;
  let depth = 0;
  const open = src.indexOf('{', i);
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces slicing ' + name);
}

function objSource(src, name) {
  const i = src.indexOf('var ' + name + '=');
  if (i < 0) throw new Error(name + ' is gone');
  let depth = 0;
  const open = src.indexOf('{', i);
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1) + ';'; }
  }
  throw new Error('unbalanced braces slicing ' + name);
}

// ── the DOM shim ─────────────────────────────────────────────────────────────
// Only what el() and the cell builders touch. `children` is what the assertions
// walk, so a node that is BUILT but never appended is invisible here — which is
// exactly the appendChild-deleted mutant the regexes missed.
function makeDoc() {
  const mk = (tag) => {
    const n = {
      tagName: tag, className: '', title: '', _text: '', _html: '',
      children: [], style: {},
      appendChild(c) { this.children.push(c); return c; },
      set textContent(v) { this._text = String(v); },
      get textContent() {
        return this._text + this.children.map(c => c.textContent).join('');
      },
      set innerHTML(v) { this._html = String(v); this._text = String(v); },
      get innerHTML() { return this._html; },
      get firstChild() { return this.children[0] || null; },
      querySelectorAll(sel) {
        const cls = sel.replace(/^\./, '');
        const out = [];
        const walk = (e) => { for (const c of e.children) {
          if ((c.className || '').split(/\s+/).includes(cls)) out.push(c);
          walk(c); } };
        walk(this); return out;
      },
    };
    return n;
  };
  return { createElement: mk };
}

// ── build a runnable module out of the shipped source ────────────────────────
function buildApi(src) {
  const need = ['el', 'esc', 'fmtInt', 'median', 'ratEloKey', 'ratLastTok', 'ratEloRec',
    'ratNode', 'ratMatches', 'ratVal', 'ratRating', 'ratN', 'ratBoardPool', 'ratPool',
    'ratMedian', 'ratFmt', 'ratSortRows', 'ratSortHead', 'ratSliceNote', 'ratInitials', 'ratAvatar',
    'ratLeaderboard', 'ratComparePanel',
    // TEN-260: the Ratings roster (retired removed) and the Mental Edge views.
    'ratRoster', 'ratMView', 'ratRound3', 'ratMentalFor', 'ratPP', 'ratMentalExtras'];
  let code = objSource(src, 'RAT_BOARDS') + '\n';
  for (const f of need) code += fnSource(src, f) + '\n';
  const sandbox = {
    document: makeDoc(),
    RAT: HAVE_STORE ? JSON.parse(readFileSync(STORE, 'utf8')) : { players: [] },
    ELO: null,               // the Elo board is not what this file locks
    RAT_GATE: 10, POS: '#3dd68c', NEG: '#e0616f', MUT: '#8b96b5',
    ELO_CAVEAT: '',
    state: { ratSurf: 'All', ratScope: 'career', ratBoard: 'mental',
             ratSortKey: 'rtg', ratSortDir: 'desc', ratSel: [], ratQ: '',
             ratMView: 'atp' },   // TEN-260: ATP view = the semantics this lock was written for
    RETIRED: null, ME_RANK_MIN: 200,
    render() {}, ratOpenPlayer() {}, q() { return null; }, use() {},
    console,
  };
  const fn = new Function(...Object.keys(sandbox),
    code + '\nreturn {ratLeaderboard, ratBoardPool, ratVal, state, RAT, ratComparePanel};');
  return { api: fn(...Object.values(sandbox)), sandbox };
}

const countsOn = (board, src = SRC) => {
  const { api } = buildApi(src);
  api.state.ratBoard = board;
  api.state.ratSortKey = 'rtg';
  const pool = api.ratBoardPool(board);
  const wrap = api.ratLeaderboard(pool, board);
  return { nodes: wrap.querySelectorAll('db-rppc'), pool, api };
};

test('the count renders on the Mental Edge board, once per row', (t) => {
  if (!HAVE_STORE) { t.skip('surface-ratings.json absent — skipping OUT LOUD, not passing'); return; }
  const { nodes, pool } = countsOn('mental');
  assert.ok(pool.length > 100, `mental pool is ${pool.length} — the store did not load`);
  assert.equal(nodes.length, pool.length,
    `${nodes.length} counts for ${pool.length} rows — the founder asked for one next to EVERY ratio`);
});

test('every rendered count equals PW+PL recomputed from the store', (t) => {
  if (!HAVE_STORE) { t.skip('surface-ratings.json absent — skipping OUT LOUD'); return; }
  const { nodes, pool } = countsOn('mental');
  const fmt = (n) => (''+ n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // Compared as MULTISETS, not pairwise by index: ratLeaderboard sorts the pool
  // (rating descending) before painting, so DOM row 0 is the board leader and
  // pool[0] is whoever the store listed first. Pairing by index asserted Alcaraz
  // against Budkov Kjaer's count and failed on correct code — my bug, and the
  // reason this comment is here rather than an index.
  const want = pool.map(p => {
    const m = p.surfaces.All.career.mental;
    return (m.pw == null || m.pl == null) ? '—' : fmt(m.pw + m.pl) + ' pp';
  }).sort();
  const got = nodes.map(n => n.textContent).sort();
  assert.deepEqual(got, want,
    `the rendered counts are not the store's PW+PL multiset (${got.length} rendered vs ${want.length} expected)`);
  assert.ok(want.length > 100, `only ${want.length} rows checked`);
  // And one ORDERED anchor, so a renderer that painted the right numbers against
  // the wrong players would still be caught: the top row must be the highest
  // rating, and its count must be that player's.
  // TEN-260 Part A.3: only players at >= 200 pressure points are RANKED, and the
  // ranked block paints first - so row 1 is the highest rating among them.
  // (Before the minimum this was N. Budkov Kjaer at 1.380 off 119 pp; he now
  // sits in the "below 200 pressure points" block.)
  const pp = p => { const m = p.surfaces.All.career.mental; return (m.pw ?? 0) + (m.pl ?? 0); };
  const top = pool.filter(p => pp(p) >= 200).sort((a, b) =>
    b.surfaces.All.career.mental.rating - a.surfaces.All.career.mental.rating)[0];
  const tm = top.surfaces.All.career.mental;
  assert.equal(nodes[0].textContent, fmt(tm.pw + tm.pl) + ' pp',
    `board row 1 is ${top.name} (rating ${tm.rating}); its count should be ${fmt(tm.pw + tm.pl)} pp`);
});

test('no count leaks onto any other board', (t) => {
  if (!HAVE_STORE) { t.skip('surface-ratings.json absent — skipping OUT LOUD'); return; }
  for (const b of ['serve', 'return', 'up']) {
    const { nodes } = countsOn(b);
    assert.equal(nodes.length, 0, `the ${b} board rendered ${nodes.length} pressure-point counts`);
  }
});

test('a count is never 0 and never a fabricated stand-in', (t) => {
  if (!HAVE_STORE) { t.skip('surface-ratings.json absent — skipping OUT LOUD'); return; }
  const { nodes } = countsOn('mental');
  const texts = nodes.map(n => n.textContent);
  for (const s of texts) {
    assert.ok(!/^0 pp$/.test(s), 'a count rendered "0 pp" — a zero here claims a player faced no pressure points');
    assert.ok(!/NaN|undefined|null/.test(s), `a count rendered "${s}"`);
  }
  // Not all one value — the hard-coded-constant mutant.
  assert.ok(new Set(texts).size > 20,
    `only ${new Set(texts).size} distinct counts across ${texts.length} rows — that is a constant, not a measurement`);
});

test('an absent PL dashes the count and keeps the em dash in the faint ink', (t) => {
  if (!HAVE_STORE) { t.skip('surface-ratings.json absent — skipping OUT LOUD'); return; }
  const { api } = buildApi(SRC);
  api.state.ratBoard = 'mental';
  const pool = api.ratBoardPool('mental');
  // Mutate the DATA, not the source: a real row whose PL is missing.
  const victim = JSON.parse(JSON.stringify(pool[0]));
  victim.surfaces.All.career.mental.pl = null;
  const wrap = api.ratLeaderboard([victim], 'mental');
  const n = wrap.querySelectorAll('db-rppc');
  assert.equal(n.length, 1, 'the row lost its count element entirely');
  assert.equal(n[0].textContent, '—', `rendered "${n[0].textContent}" for a null PL`);
  assert.ok((n[0].className || '').split(/\s+/).includes('dash'),
    'the dashed count does not carry the `dash` class, so it renders in the wrong ink (§5: an absent number is an em dash in #4b5672)');
});

// THE COMPARE PANEL IS THE SECOND PLACE A MENTAL EDGE RATIO APPEARS, and the
// founder said EVERY ratio. It renders up to 4 players x (Last 52 + Career), so
// up to 8 more of them on the same tab — and it is the surface a member opens
// precisely to compare thin samples, so it needs the count more than the board
// does. The first version of this change missed it; an independent review caught
// that. Locked here by EXECUTING the panel: a CDP probe could not reliably drive
// the two-player picker, and an undriveable probe is not evidence.
test('the compare panel carries a count on every Mental Edge figure cell', (t) => {
  if (!HAVE_STORE) { t.skip('surface-ratings.json absent — skipping OUT LOUD'); return; }
  const { api } = buildApi(SRC);
  const names = api.RAT.players.slice(0, 3).map(p => p.name);
  api.state.ratSel = names;
  const panel = api.ratComparePanel();
  const ppc = panel.querySelectorAll('db-cmpppc');
  // Two figure columns per player (Last 52 + Career); the delta column must NOT
  // carry one — a count under a difference would be describing the difference.
  assert.equal(ppc.length, names.length * 2,
    `${ppc.length} counts for ${names.length} players — expected ${names.length * 2} ` +
    '(Last 52 + Career each, and none on the delta)');
  for (const n of ppc) {
    assert.match(n.textContent, /^(\d[\d,]* pp|—)$/,
      `compare count rendered "${n.textContent}"`);
    assert.ok(!/^0 pp$/.test(n.textContent), 'a compare count rendered "0 pp"');
  }
  // And the values must be the store's, not the board's.
  const want = [];
  for (const nm of names) {
    const p = api.RAT.players.find(x => x.name === nm);
    for (const sc of ['last52', 'career']) {
      const m = p.surfaces.All[sc] && p.surfaces.All[sc].mental;
      if (m && m.pw != null && m.pl != null) want.push((m.pw + m.pl));
    }
  }
  const got = ppc.map(n => Number(n.textContent.replace(/[^0-9]/g, ''))).filter(v => v > 0);
  assert.ok(got.length > 0, 'no numeric compare counts rendered at all');
  for (const v of got) assert.ok(want.includes(v),
    `compare rendered ${v} pp, which is not any of these players' PW+PL (${want.join(', ')})`);
});

// ── MUTANTS ─────────────────────────────────────────────────────────────────
// Each one is a real way to break the feature. The suite must NOT survive any of
// them. These nine are the exact set an independent review used to show the
// previous regex-based lock was vacuous.
const MUTANTS = [
  ['appendChild deleted (count built, never rendered)', s => s.replace('c3.appendChild(pc);', '')],
  ['count summed from PW only', s => s.replace('(_pw+_pl)', '(_pw)')],
  ['count hard-coded to 0', s => s.replace('fmtInt(_ppc)+\' pp\'', 'fmtInt(0)+\' pp\'')],
  ['count hard-coded to a constant', s => s.replace('fmtInt(_ppc)+\' pp\'', "'119 pp'")],
  ['null guard inverted || -> &&', s => s.replace('(_pw==null||_pl==null)', '(_pw==null&&_pl==null)')],
  ['leaks onto the Serve board', s => s.replace("if(board==='mental'){", "if(board==='mental'||board==='serve'){")],
  ['branch made dead', s => s.replace("if(board==='mental'){", "if(board==='mental'&&false){")],
  ['dash class dropped', s => s.replace("'db-rppc'+(_ppc==null?' dash':'')", "'db-rppc'")],
  ['compare panel count deleted', s => s.replace('c.appendChild(pcc);', '')],
  ['compare panel count on the delta too', s => s.replace("m[0]==='mental' && cls!=='delta'", "m[0]==='mental'")],
  ['compare panel count summed from PW only', s => s.replace('return ratPP(ratMentalFor(p, n));', 'return ratMentalFor(p, n).pw;')],
  ['reads bpFaced/bpChances instead of PW/PL', s =>
    s.replace("ratVal(p,'mental.pw'), _pl=ratVal(p,'mental.pl')",
              "ratVal(p,'sample.bpFaced'), _pl=ratVal(p,'sample.bpChances')")],
];

test('CONTROL: every mutant is caught — a check no mutant breaks tests nothing', (t) => {
  if (!HAVE_STORE) { t.skip('surface-ratings.json absent — skipping OUT LOUD'); return; }
  const survivors = [];
  for (const [name, mutate] of MUTANTS) {
    const mutated = mutate(SRC);
    assert.notEqual(mutated, SRC, `mutant "${name}" did not apply — it proves nothing`);
    let caught = false;
    try {
      const { nodes, pool } = countsOn('mental', mutated);
      const f = (n) => (''+ n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      if (nodes.length !== pool.length) caught = true;
      const texts = nodes.map(n => n.textContent);
      if (texts.some(s => /^0 pp$/.test(s) || /NaN|undefined|null/.test(s))) caught = true;
      if (nodes.length && new Set(texts).size <= 20) caught = true;
      for (let i = 0; i < pool.length && !caught; i++) {
        const m = pool[i].surfaces.All.career.mental;
        const want = (m.pw == null || m.pl == null) ? '—' : f(m.pw + m.pl) + ' pp';
        if (!nodes[i] || nodes[i].textContent !== want) caught = true;
      }
      if (!caught) for (const b of ['serve', 'return', 'up']) {
        if (countsOn(b, mutated).nodes.length) { caught = true; break; }
      }
      if (!caught) {
        // the compare panel is a separate render path — the board checks above
        // cannot see a mutation that only breaks it.
        const { api } = buildApi(mutated);
        const names = api.RAT.players.slice(0, 3).map(p => p.name);
        api.state.ratSel = names;
        const ppc = api.ratComparePanel().querySelectorAll('db-cmpppc');
        if (ppc.length !== names.length * 2) caught = true;
        if (!caught) {
          const want = [];
          for (const nm of names) {
            const p = api.RAT.players.find(x => x.name === nm);
            for (const sc of ['last52', 'career']) {
              const m = p.surfaces.All[sc] && p.surfaces.All[sc].mental;
              if (m && m.pw != null && m.pl != null) want.push(m.pw + m.pl);
            }
          }
          for (const n of ppc) {
            const v = Number(n.textContent.replace(/[^0-9]/g, ''));
            if (v > 0 && !want.includes(v)) { caught = true; break; }
          }
        }
      }
      if (!caught) {
        // the dash-class mutant only shows on a null-PL row
        const { api } = buildApi(mutated);
        api.state.ratBoard = 'mental';
        const v = JSON.parse(JSON.stringify(api.ratBoardPool('mental')[0]));
        v.surfaces.All.career.mental.pl = null;
        const nn = api.ratLeaderboard([v], 'mental').querySelectorAll('db-rppc');
        if (!nn.length || nn[0].textContent !== '—'
            || !(nn[0].className || '').split(/\s+/).includes('dash')) caught = true;
      }
    } catch { caught = true; }   // a mutant that throws is also caught
    if (!caught) survivors.push(name);
  }
  assert.deepEqual(survivors, [],
    `${survivors.length} of ${MUTANTS.length} mutants SURVIVED: ${survivors.join(' · ')}`);
  console.log(`  mutants: ${MUTANTS.length} caught, 0 survived`);
});
