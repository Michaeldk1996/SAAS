// TEN-260 Part A — the Ratings board rulings (TEN-254, founder, 2026-09-23):
//   1. players in retired-players.json leave the board entirely; the denominator drops
//   2. Mental Edge has three views - ATP only / Challenger only / ATP + Challenger -
//      default ATP + Challenger as a SIMPLE SUM of counts
//   3. ranking minimum 200 pressure points, per view; below it: ratio + count, no rank,
//      labelled, placed below the ranked block
//   4. challResolved:false -> Challenger view dashes with the reason; combined view
//      marks the player "ATP data only" and keeps him out of the combined ranking
//   5. "ranked X of Y" on every view
//
// Same method as test-ten254-mental-count.mjs: SLICE the shipped renderer out of the
// page, EXECUTE it against the published store under a DOM shim, read what it painted,
// and re-run every check against a mutant per check. A mutant that survives fails.
//
// Run: node --test test-ten260-ratings.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const STORE = join(HERE, 'surface-ratings.json');
const RETIRED_FILE = join(HERE, 'retired-players.json');
const HAVE = existsSync(STORE) && existsSync(RETIRED_FILE);

function fnSource(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('function ' + name + ' is gone — this lock points at nothing');
  const nl = src.indexOf('\n', i);
  const oneLine = src.slice(i, nl < 0 ? src.length : nl);
  if ((oneLine.match(/\{/g) || []).length === (oneLine.match(/\}/g) || []).length
      && oneLine.trimEnd().endsWith('}')) return oneLine;
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces slicing ' + name);
}
function objSource(src, name) {
  const i = src.indexOf('var ' + name + '=');
  if (i < 0) throw new Error(name + ' is gone');
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1) + ';'; }
  }
  throw new Error('unbalanced braces slicing ' + name);
}
function constOf(src, name) {
  const m = new RegExp('var\\s+' + name + '\\s*=\\s*(\\d+)\\s*;').exec(src);
  if (!m) throw new Error(name + ' is gone from the source');
  return Number(m[1]);
}
function makeDoc() {
  const mk = (tag) => ({
    tagName: tag, className: '', title: '', _text: '', _html: '', children: [], style: {},
    get classList() { const n = this; return { add(c) { n.className += ' ' + c; }, toggle() {} }; },
    appendChild(c) { this.children.push(c); return c; },
    set textContent(v) { this._text = String(v); this.children = []; },
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); },
    set innerHTML(v) { this._html = String(v); this._text = String(v).replace(/<[^>]*>/g, ''); },
    get innerHTML() { return this._html; },
    get firstChild() { return this.children[0] || null; },
    querySelectorAll(sel) {
      const cls = sel.replace(/^\./, ''); const out = [];
      const walk = (e) => { for (const c of e.children) {
        if ((c.className || '').split(/\s+/).includes(cls)) out.push(c); walk(c); } };
      walk(this); return out;
    },
  });
  return { createElement: mk };
}

const NEED = ['el', 'esc', 'fmtInt', 'median', 'ratEloKey', 'ratLastTok', 'ratEloRec', 'ratNode',
  'ratMatches', 'ratVal', 'ratRating', 'ratN', 'ratBoardPool', 'ratPool', 'ratMedian', 'ratFmt',
  'ratSortRows', 'ratSortHead', 'ratSliceNote', 'ratInitials', 'ratAvatar', 'ratLeaderboard',
  'ratRetiredSet', 'ratRoster', 'ratRetiredOnStore', 'ratMView', 'ratRound3', 'ratMentalFor',
  'ratPP', 'ratMentalExtras', 'ratMentalExtrasAll', 'ratMViewPills', 'ratRetiredNote',
  'ratComparePanel', 'ratBoardTabs', 'ratOverview', 'pillGroup', 'renderRatings'];

function build(src, { retired = 'file', view = 'both', patch = null } = {}) {
  let code = objSource(src, 'RAT_BOARDS') + '\n';
  for (const f of NEED) code += fnSource(src, f) + '\n';
  const RAT = JSON.parse(readFileSync(STORE, 'utf8'));
  if (patch) patch(RAT);
  const retiredJson = JSON.parse(readFileSync(RETIRED_FILE, 'utf8'));
  const sandbox = {
    document: makeDoc(), RAT, ELO: null, RETIRED: null,
    RAT_GATE: constOf(src, 'RAT_GATE'), ME_RANK_MIN: constOf(src, 'ME_RANK_MIN'),
    ELO_CAVEAT: '', POS: '#3dd68c', NEG: '#e0616f', MUT: '#8b96b5', I: {},
    state: { ratSurf: 'All', ratScope: 'career', ratBoard: 'mental', ratSortKey: 'rtg',
             ratSortDir: 'desc', ratSel: [], ratQ: '', ratMView: view, view: 'ratings' },
    render() {}, ratOpenPlayer() {}, q() { return null; }, use() {}, loadRatings() {}, console,
  };
  const keys = [...Object.keys(sandbox), 'ARG_RETIRED'];
  const f2 = new Function(...keys, code +
    '\nRETIRED = ARG_RETIRED;' +
    '\nreturn {ratLeaderboard, ratBoardPool, ratPool, ratMentalFor, ratMentalExtras, renderRatings, ratNode, state, RAT, get RETIRED(){return RETIRED;}};');
  const retiredSet = retired === 'file'
    ? Object.fromEntries(retiredJson.retired.map(r => [r.name, true]))
    : retired;
  return { api: f2(...Object.values(sandbox), retiredSet), retiredJson };
}

// Paint the Mental Edge board and read it back: every data row's rank cell, name,
// rating text and pressure-point count, and which block it sits in.
function paint(src, opts) {
  const { api, retiredJson } = build(src, opts);
  if (opts && opts.surf) { api.state.ratSurf = opts.surf; api.state.ratScope = opts.scope; }
  const pool = api.ratBoardPool('mental');
  const wrap = api.ratLeaderboard(pool, 'mental');
  const grid = wrap.children[0].children[0];
  const rows = []; let block = 'ranked';
  const cells = grid.children;
  let i = 0;
  // header (4 + component columns) + median (same count) come first
  const ncol = grid.querySelectorAll('db-rhead').length;
  i = ncol * 2;
  while (i < cells.length) {
    const c = cells[i];
    if ((c.className || '').includes('db-rblock')) { block = c.textContent; i++; continue; }
    const row = cells.slice(i, i + ncol);
    rows.push({
      block,
      rank: row[0].textContent,
      name: row[1].querySelectorAll('db-rname')[0]?.textContent,
      n: row[2].textContent,
      rating: row[3].children[0].textContent,
      pp: row[3].querySelectorAll('db-rppc')[0]?.textContent,
      tag: row[3].querySelectorAll('db-rtag')[0]?.textContent || '',
    });
    i += ncol;
  }
  return { rows, api, retiredJson, pool };
}

// Independent recomputation from the raw sample fields (rule 10: recompute the
// headline figure from the inputs, do not read it back off the renderer).
function expected(p, view) {
  const n = p.surfaces.All.career; if (!n) return null;
  const s = n.sample, m = n.mental;
  const cpw = s.challBpSaved + s.challBpConverted;
  const cpl = (s.challBpFaced - s.challBpSaved) + (s.challBpChances - s.challBpConverted);
  if (view === 'atp') return { pw: m.pw, pl: m.pl, matches: s.matches };
  if (view === 'chall') return p.challResolved === true ? { pw: cpw, pl: cpl, matches: s.challMatches } : null;
  return p.challResolved === true ? { pw: m.pw + cpw, pl: m.pl + cpl, matches: s.matches + s.challMatches } : null;
}
const fmt = (n) => ('' + n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const CHECKS = {
  // Review findings (TEN-260 clean-context pass), on REAL off-default slices:
  //  · a resolved player with no tour break points (store `mental: null`) must
  //    still be on the combined view when the Challenger view ranks him;
  //  · a negative count (corrupt source) must never reach a ranked figure.
  edges(src) {
    const { rows: ch } = paint(src, { view: 'chall', surf: 'Clay', scope: 'last52' });
    const { rows: both } = paint(src, { view: 'both', surf: 'Clay', scope: 'last52' });
    const chRanked = ch.filter(r => /^\d+$/.test(r.rank)).map(r => r.name);
    const bothNames = new Set(both.map(r => r.name));
    const missing = chRanked.filter(n => !bothNames.has(n));
    if (!chRanked.includes('J. Choinski')) return 'fixture moved: J. Choinski is no longer ranked on Clay/Last 52 Challenger — pick another zero-tour player';
    if (missing.length) return `combined view is narrower than the Challenger view: ${missing.join(', ')}`;
    for (const r of both) if (/-/.test(r.pp || '')) return `a negative count reached the board: ${r.name} ${r.pp}`;
    const { rows: k } = paint(src, { view: 'both', surf: 'All', scope: 'last52' });
    const kwon = k.find(r => r.name === 'S. Kwon');
    if (kwon && /^\d+$/.test(kwon.rank)) return `S. Kwon (stored PL −3 at All/Last 52) is RANKED on the combined view at ${kwon.rating}`;
    return null;
  },
  // The 200 line itself: no real player sits on it, so put one there.
  boundary(src) {
    const patch = (RAT) => {
      const p = RAT.players.find(x => x.name === 'J. Sinner');
      const n = p.surfaces.All.career;
      n.mental = { pw: 110, pl: 90, rating: 1.222 };
      Object.assign(n.sample, { bpFaced: 100, bpChances: 100, bpSaved: 60, bpConverted: 50 });
    };
    const { rows } = paint(src, { view: 'atp', patch });
    const r = rows.find(x => x.name === 'J. Sinner');
    if (!r) return 'the 200-pp fixture row is missing';
    if (!/^\d+$/.test(r.rank)) return `a player at exactly 200 pressure points is not ranked (rank "${r.rank}")`;
    return null;
  },
  retired(src) {
    const { rows, retiredJson, api } = paint(src, { view: 'atp' });
    const gone = retiredJson.retired.map(r => r.name);
    const onStore = gone.filter(nm => api.RAT.players.some(p => p.name === nm));
    if (onStore.length !== gone.length) return `retired names not on the store: ${gone.filter(g => !onStore.includes(g))}`;
    for (const nm of gone) if (rows.some(r => r.name === nm)) return `${nm} is still on the Mental Edge board`;
    for (const b of ['serve', 'return', 'up', 'elo'])
      for (const nm of gone) if (api.ratBoardPool(b).some(p => p.name === nm)) return `${nm} is still in the ${b} pool`;
    if (api.ratPool().some(p => gone.includes(p.name))) return 'a retired player is still in the Overview pool';
    // the denominator drops by exactly the retired players that would otherwise be in it
    const { api: noList } = build(src, { view: 'atp', retired: {} });
    const before = noList.ratPool().length, after = api.ratPool().length;
    const expectDrop = noList.ratPool().filter(p => gone.includes(p.name)).length;
    if (expectDrop < 1) return 'no retired player was in the unfiltered pool — the check is vacuous';
    if (before - after !== expectDrop) return `Overview denominator dropped ${before - after}, expected ${expectDrop}`;
    return null;
  },
  views(src) {
    for (const view of ['atp', 'chall', 'both']) {
      const { rows, api } = paint(src, { view });
      const byName = Object.fromEntries(api.RAT.players.map(p => [p.name, p]));
      let checked = 0;
      for (const r of rows) {
        const p = byName[r.name]; const e = expected(p, view);
        if (!e) continue;
        const pp = e.pw + e.pl;
        if (r.pp !== fmt(pp) + ' pp') return `${view}: ${r.name} count ${r.pp}, expected ${fmt(pp)} pp`;
        const ratio = e.pl ? (Math.round(e.pw / e.pl * 1000) / 1000).toFixed(3) : '—';
        if (r.rating !== ratio) return `${view}: ${r.name} ratio ${r.rating}, expected ${ratio}`;
        if (r.n !== fmt(e.matches)) return `${view}: ${r.name} n ${r.n}, expected ${fmt(e.matches)}`;
        checked++;
      }
      if (checked < 100) return `${view}: only ${checked} rows checked`;
    }
    // the default view IS the combined one
    const { api } = build(src, {});
    api.state.ratMView = undefined;
    const p = api.RAT.players.find(x => x.challResolved === true && x.surfaces.All.career.sample.challMatches > 0);
    const m = api.ratMentalFor(p, p.surfaces.All.career);
    const e = expected(p, 'both');
    if (m.pw !== e.pw || m.pl !== e.pl) return 'the default view is not ATP + Challenger';
    return null;
  },
  minimum(src) {
    for (const view of ['atp', 'chall', 'both']) {
      const { rows } = paint(src, { view });
      const ranked = rows.filter(r => /^\d+$/.test(r.rank));
      const below = rows.filter(r => /below 200 pressure points/i.test(r.block));
      if (ranked.length < 50) return `${view}: only ${ranked.length} ranked rows`;
      if (!below.length) return `${view}: no "below 200 pressure points" block`;
      for (const r of ranked) if (Number(r.pp.replace(/\D/g, '')) < 200) return `${view}: ${r.name} ranked on ${r.pp}`;
      for (const r of below) {
        if (r.rank !== '—') return `${view}: ${r.name} below the minimum but carries rank ${r.rank}`;
        if (!(Number(r.pp.replace(/\D/g, '')) < 200)) return `${view}: ${r.name} in the below block on ${r.pp}`;
        if (!/^\d/.test(r.rating)) return `${view}: ${r.name} below the minimum lost his ratio`;
      }
      // below the ranked block, never interleaved
      const lastRanked = rows.lastIndexOf(ranked[ranked.length - 1]);
      if (rows.findIndex(r => below.includes(r)) < lastRanked) return `${view}: an unranked row sits inside the ranked block`;
      // rank numbers are 1..N contiguous
      if (ranked.some((r, i) => Number(r.rank) !== i + 1)) return `${view}: ranks are not 1..${ranked.length}`;
    }
    return null;
  },
  unresolved(src) {
    // Give every unresolved player NON-ZERO Challenger counts first. Their real
    // counts are 0, and PL = 0 already yields no ratio - so on the real store a
    // renderer that IGNORED challResolved would still dash them, for the wrong
    // reason, and this check would pass vacuously. With counts present, only the
    // marker can produce the dash.
    const patch = (RAT) => RAT.players.forEach(p => {
      if (p.challResolved === true) return;
      const s = p.surfaces.All.career?.sample; if (!s) return;
      Object.assign(s, { challBpSaved: 50, challBpConverted: 60, challBpFaced: 90, challBpChances: 160, challMatches: 40 });
    });
    const { rows: ch, api } = paint(src, { view: 'chall', patch });
    const unresolved = api.RAT.players.filter(p => p.challResolved !== true).map(p => p.name);
    const retired = Object.keys(api.RETIRED || {});
    const live = unresolved.filter(n => !retired.includes(n) && api.RAT.players.find(p => p.name === n).surfaces.All.career?.sample.matches >= 10);
    if (live.length < 1) return 'no unresolved player to check — vacuous';
    for (const nm of live) {
      const r = ch.find(x => x.name === nm);
      if (!r) return `Challenger view: ${nm} (challResolved false) is missing — it must show a dash with the reason`;
      if (r.rating !== '—') return `Challenger view: ${nm} shows ${r.rating}, a zero-lookup is not a real zero`;
      if (!/did not resolve/.test(r.block)) return `Challenger view: ${nm} has no reason label`;
      if (r.rank !== '—') return `Challenger view: ${nm} carries a rank`;
    }
    const { rows: both } = paint(src, { view: 'both', patch });
    for (const nm of live) {
      const r = both.find(x => x.name === nm);
      if (!r) return `combined view: ${nm} is missing — he should show on ATP data`;
      if (r.rank !== '—') return `combined view: ${nm} is ranked on ATP-only data`;
      if (!/ATP only/i.test(r.tag) || !/ATP data only/.test(r.block)) return `combined view: ${nm} is not marked ATP data only`;
      const e = expected(api.RAT.players.find(p => p.name === nm), 'atp');
      if (r.pp !== fmt(e.pw + e.pl) + ' pp') return `combined view: ${nm} shows ${r.pp}, not his ATP count`;
    }
    return null;
  },
  rankedOf(src) {
    for (const view of ['atp', 'chall', 'both']) {
      const { api, rows } = paint(src, { view });
      const body = makeDoc().createElement('div');
      api.renderRatings(body);
      const count = body.querySelectorAll('db-rcount')[0];
      if (!count) return `${view}: no count line`;
      const m = /ranked\s+([\d,]+)\s+of\s+([\d,]+)/.exec(count.textContent);
      if (!m) return `${view}: the count line does not say "ranked X of Y": "${count.textContent}"`;
      const x = rows.filter(r => /^\d+$/.test(r.rank)).length, y = rows.length;
      if (Number(m[1].replace(/,/g, '')) !== x || Number(m[2].replace(/,/g, '')) !== y)
        return `${view}: count line says ranked ${m[1]} of ${m[2]}, the board paints ${x} of ${y}`;
    }
    return null;
  },
};

for (const [name, check] of Object.entries(CHECKS)) {
  test('TEN-260 Part A · ' + name, (t) => {
    if (!HAVE) { t.skip('store or retired list absent — skipping OUT LOUD, not passing'); return; }
    const err = check(SRC);
    assert.equal(err, null, err);
  });
}

// ── MUTANTS ─────────────────────────────────────────────────────────────────
const MUTANTS = [
  ['retired filter bypassed', 'retired', s => s.replace('if(!RETIRED) return RAT.players;', 'return RAT.players;')],
  ['overview pool reads RAT.players', 'retired', s => s.replace("    return ratRoster().filter(function(p){\n      var n=ratNode(p); if(!n || !n.sample) return false;", "    return RAT.players.filter(function(p){\n      var n=ratNode(p); if(!n || !n.sample) return false;")],
  ['challenger PL drops the missed break points', 'views', s => s.replace('(cf-cs)+(ch-cc)', '(cf-cs)')],
  ['combined view averages instead of summing', 'views', s => s.replace('out.pw = (apw==null||cpw==null) ? null : apw+cpw;', 'out.pw = (apw==null||cpw==null) ? null : (apw+cpw)/2;')],
  ['default view is ATP', 'views', s => s.replace("return (state && state.ratMView) || 'both';", "return (state && state.ratMView) || 'atp';")],
  ['matches ignore the view', 'views', s => s.replace('if(board===\'mental\') return ratMentalFor(p, n).matches;', "if(board==='mental') return tour;")],
  ['minimum lowered to 100', 'minimum', s => s.replace('var ME_RANK_MIN=200;', 'var ME_RANK_MIN=100;')],
  ['below-minimum block not split off', 'minimum', s => s.replace('(pp!=null && pp>=ME_RANK_MIN ? ranked : below).push(p);', 'ranked.push(p);')],
  ['unranked rows keep a rank number', 'minimum', s => s.replace("blk.ranked ? String(i+1) : '—'", 'String(i+1)')],
  ['unresolved read as a real zero', 'unresolved', s => s.replace("if(!resolved){ out.unresolved=true; return out; }", "if(false){ out.unresolved=true; return out; }")],
  ['unresolved dropped from the combined view', 'unresolved', s => s.replace('if(ex.length) blocks.push', 'if(false) blocks.push')],
  ['combined view ranks ATP-only players', 'unresolved', s => s.replace('      return out;                        // ratio stays null', '      out.ratio=aRatio; return out;                        // ratio stays null')],
  ['count line counts the picks field wrong', 'rankedOf', s => s.replace('var tot=shown.length + ', 'var tot=shown.length + 1 + ')],
  ['zero tour break points dropped from combined', 'edges', s => s.replace("if(apw==null && apl==null && (sm.bpFaced||0)+(sm.bpChances||0)===0 && typeof sm.matches==='number'){ apw=0; apl=0; }", '')],
  ['negative counts summed', 'edges', s => s.replace("if((apw!=null && apw<0) || (apl!=null && apl<0)){ apw=null; apl=null; aRatio=null; }", '')],
  ['minimum is strictly greater than 200', 'boundary', s => s.replace('(pp!=null && pp>=ME_RANK_MIN ? ranked : below)', '(pp!=null && pp>ME_RANK_MIN ? ranked : below)')],
  ['count line drops "ranked"', 'rankedOf', s => s.replace("players · ranked <b>", "players · <b>")],
];

test('CONTROL: every TEN-260 Part A mutant is caught', (t) => {
  if (!HAVE) { t.skip('store absent — skipping OUT LOUD'); return; }
  const survivors = [];
  for (const [name, which, mutate] of MUTANTS) {
    const m = mutate(SRC);
    assert.notEqual(m, SRC, `mutant "${name}" did not apply — it proves nothing`);
    let caught;
    try { caught = CHECKS[which](m) !== null; } catch { caught = true; }
    if (!caught) survivors.push(name);
  }
  assert.deepEqual(survivors, [], `${survivors.length} of ${MUTANTS.length} mutants SURVIVED: ${survivors.join(' · ')}`);
  console.log(`  mutants: ${MUTANTS.length} caught, 0 survived`);
});
