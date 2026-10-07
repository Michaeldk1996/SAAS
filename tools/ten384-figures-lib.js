// tools/ten384-figures-lib.js — the shared reading + checking code behind the TEN-384 "figures agree" gate
// (tools/test-ten384-figures-agree.js, wired into npm test) and its roster-wide probe
// (tools/probe-ten384-figures-roster.js, run by hand, NOT wired into npm test).
//
// Every check renders TWO surfaces of the profile through player-profile-v2.js's own renderers and asserts
// they quote the same figure. The checks are relational (surface A = surface B), never a pinned value, so
// they hold on any store; WHICH store they run on is the caller's choice:
//   · the gate runs them on the pinned fixture tools/fixtures/ten384-figures/player-*.json with the module's
//     clock pinned to the fixture's `asOf` (loadPp2({ now })) — identical in every checkout, CI included;
//   · the live section of the gate and the probe run them on the deployed stores, and SKIP out loud when
//     those are absent.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');

// ── module loading ────────────────────────────────────────────────────────────
/** A Date whose no-argument form (and Date.now) is pinned to `iso`; every other form is the real Date. */
function pinnedDate(iso) {
  const T = Date.parse(iso);
  if (!isFinite(T)) throw new Error('pinnedDate: bad instant ' + iso);
  class PinnedDate extends Date {
    constructor(...a) { if (a.length === 0) super(T); else super(...a); }
    static now() { return T; }
  }
  return PinnedDate;
}
function speedScheme() {
  const src = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
  const i = src.indexOf('const COURT_CONDITIONS = {'), j = src.indexOf('\n};', i);
  const f = src.indexOf('function courtSpeedCategory(speed) {'), g = src.indexOf('\n}', f);
  // eslint-disable-next-line no-new-func
  return new Function(src.slice(i, j + 3) + '\n' + src.slice(f, g + 2) +
    '\nreturn { cc: COURT_CONDITIONS, cat: courtSpeedCategory };')();
}
/**
 * Loads player-profile-v2.js (or `src`) into a fresh sandbox window. `now` pins the MODULE's clock only
 * (its `Date` is shadowed; the harness keeps the real one).
 */
function loadPp2(opts) {
  const SPEED = speedScheme();
  const W = Object.assign({
    FEATURE_PP2: true,
    playerProfiles: { players: opts.players },
    courtSpeedMap: JSON.parse(fs.readFileSync(path.join(ROOT, 'court-speed-map.json'), 'utf8')),
    COURT_CONDITIONS: SPEED.cc, courtSpeedCategory: SPEED.cat,
    MarketEdgeCore: require(path.join(ROOT, 'market-edge-core.js')),
    TournamentIdentity: require(path.join(ROOT, 'tournament-identity.js')),
    marketEdge: opts.marketEdge || {}, careerHistory: opts.careerHistory || {}, bet365History: opts.bet365History || {}
  }, opts.extra || {});
  const src = fs.readFileSync(opts.src || path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  const prevWindow = global.window;
  global.window = W;
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', 'Date', src)(W, opts.now ? pinnedDate(opts.now) : Date);
  } finally {
    if (prevWindow === undefined) delete global.window; else global.window = prevWindow;
  }
  if (!W.PlayerProfileV2) throw new Error('module did not export PlayerProfileV2');
  return { W, I: W.PlayerProfileV2._internals };
}

// ── what each surface prints, read off its rendered HTML ────────────────────
const text = html => String(html).replace(/<[^>]+>/g, ' ').replace(/&#39;|&rsquo;/g, '’').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
const num = s => Number(String(s).replace(/,/g, ''));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmt1 = y => (y > 0 ? '+' : y < 0 ? '−' : '') + Math.abs(y).toFixed(1) + '%';

function readers(I) {
  function withState(patch, fn) {
    const saved = Object.assign({}, I.state);
    Object.assign(I.state, patch);
    try { return fn(); } finally { Object.keys(I.state).forEach(k => delete I.state[k]); Object.assign(I.state, saved); }
  }
  function careerModal(p, scope, tier) {
    return withState({ key: p.key, careerTab: 'record', careerScope: scope, careerTier: tier || 'all', careerDrill: null },
      () => text(I.renderCareerModal(p, {})));
  }
  function readCareer(p) {
    const m = /([\d,]+) matches Surface/i.exec(careerModal(p, 'career'));
    return { total: m ? num(m[1]) : null };
  }
  function readL52(p) {
    const t = careerModal(p, 'l52');
    const rec = /LAST 52 WEEKS · ALL TIERS (\d+)–(\d+)/i.exec(t);
    const und = /(\d[\d,]*) (?:matches carry no dated match row|match carries no dated match row|undated rows?)/.exec(t);
    return { won: rec ? +rec[1] : null, lost: rec ? +rec[2] : null, undated: und ? num(und[1]) : 0, t };
  }
  function readCal(p) {
    const h = withState({ key: p.key, calTab: 'calendar', calSurface: 'all', calCell: null }, () => I.renderSeasonModal(p));
    const t = text(h);
    const head = /Calendar form · career · all surfaces ([\d,]+) matches/i.exec(t);
    const und = /([\d,]+) (?:matches carry|match carries) no dated match row/.exec(t);
    const out = /([\d,]+) dated match(?:es)? falls? outside/.exec(t);
    // Footer rows, one cell per month, in the order the renderer writes them (Month · n · Yield · Vs others).
    const MROW = ' Month Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec ';
    const at = t.indexOf(MROW);
    const after = at < 0 ? [] : t.slice(at + MROW.length).split(' ');
    const row = (label) => {
      const i = after.indexOf(label.split(' ')[0]);
      return i < 0 ? [] : after.slice(i + label.split(' ').length, i + label.split(' ').length + 12);
    };
    const tile = (cap) => {
      const m = new RegExp(cap + ' (\\w+) ([+−]?[\\d.]+pp|—) (?:·|small sample ·) n=(\\d+)').exec(t);
      return m ? { month: m[1], value: m[2], n: +m[3] } : null;
    };
    return {
      html: h, t, total: head ? num(head[1]) : null, undated: und ? num(und[1]) : 0, outside: out ? num(out[1]) : 0,
      n: row('n'), vs: row('Vs others'), best: tile('Best month'), worst: tile('Worst month'),
      yieldTile: (/Career yield ([+−]?[\d.]+%|—) ([\d,]+) priced/i.exec(t) || []).slice(1)
    };
  }
  // The Calendar's own grid (calMonths/calGrid over the rows the tab draws), cut at the module's window.
  function calWindow(p) {
    const cutoff = I.last52Cutoff();
    const rows = withState({ calSurface: 'all' }, () => I.calSpineFiltered(p));
    const grid = I.calGrid(rows);
    const cy = cutoff.slice(0, 4), cm = +cutoff.slice(5, 7) - 1;
    let won = 0, lost = 0;
    grid.forEach((yr) => yr.cells.forEach((c, m) => {
      if (yr.year > cy || (yr.year === cy && m > cm)) { won += c.won; lost += c.lost; }
    }));
    // The cut-off month itself is part-window: its rows on or after the cut-off day.
    rows.filter(r => r.year === cy && r.mon === cm && r.date >= cutoff).forEach((r) => { if (r.won) won++; else lost++; });
    return { won, lost, cutoff };
  }
  function haMismatches(p) {
    const sp = {};
    I.speedRows(p).forEach((r) => { sp[r.date + '|' + r.opp] = r; });
    return I.ledgerRows(p).filter(x => x.price != null).filter((x) => {
      const r = sp[x.m.date + '|' + x.m.opponent];
      return r && (r.price !== x.price || r.oppPrice !== x.oppPrice);
    });
  }
  function readLedger(p) {
    const h = withState({ key: p.key, ledgerExpanded: false, surfaces: [], priceFilters: [] },
      () => text(I.renderLedger(p, Object.assign(I.build(p), { ledgerOpen: true }))));
    return { head: /full ledger .*? · (?:last (\d+) of )?(\d+) match(?:es)?/i.exec(h), more: /See all (\d+) results/.exec(h) };
  }
  function readRoles(p) {
    const t = withState({ key: p.key, marketTab: 'lines', lcFmt: 'bo3', lcRole: 'all' }, () => text(I.renderLinesTab(p)));
    return {
      all: /ALL MATCHES (\d+) best of 3/i.exec(t), fav: /AS FAVOURITE (\d+)/i.exec(t), dog: /AS UNDERDOG (\d+)/i.exec(t),
      un: /the other (\d+) carr(?:y|ies) no closing price/.exec(t)
    };
  }
  return { withState, careerModal, readCareer, readL52, readCal, calWindow, haMismatches, readLedger, readRoles };
}

// The box prints the shard headline (buildBoxVals: yield to 2 dp, "N priced"); the Calendar tile prints the
// same yield to 1 dp over the same N.
function boxYield(mk) {
  let c = 0, n = 0;
  (mk.matches || []).forEach((r) => { if (r.inBasis !== false && r.pl != null) { c += Math.round(r.pl * 100); n++; } });
  return { n, y: n ? c / n : null };
}

/**
 * The per-player checks. `p` is the profile, `mk` its market-edge shard (as the module reads it), `R` the
 * readers. Returns [{ name, fn }]; each fn throws on a disagreement and returns a one-line evidence string.
 */
function playerChecks(I, R, p, mk, label, opts) {
  const shardSelfCheck = !(opts && opts.shardSelfCheck === false);
  const L = label || p.name;
  const TIERS = ['all', 'atp', 'chitf'];
  return [
    { name: `1 · ${L}: Last 52 undated = Calendar undated`, fn() {
      const a = R.readL52(p), b = R.readCal(p);
      assert(b.undated > 0, 'the Calendar states no undated count — nothing to compare');
      assert.strictEqual(a.undated, b.undated, `Last 52 says ${a.undated} undated, the Calendar ${b.undated}`);
      return `${a.undated} undated on both`;
    } },
    { name: `R · ${L}: Career record total = Calendar total + undated − outside`, fn() {
      const c = R.readCareer(p), cal = R.readCal(p);
      assert(c.total && cal.total, `unreadable totals (career ${c.total}, calendar ${cal.total})`);
      assert.strictEqual(c.total, cal.total + cal.undated - cal.outside,
        `career ${c.total} ≠ calendar ${cal.total} + undated ${cal.undated} − outside ${cal.outside}`);
      return `${c.total} = ${cal.total} + ${cal.undated} − ${cal.outside}`;
    } },
    { name: `R · ${L}: Last 52 = the Calendar months inside the window`, fn() {
      const a = R.readL52(p), w = R.calWindow(p);
      assert(a.won != null, 'Last 52 record unreadable');
      assert(w.won + w.lost > 0, 'the window holds no Calendar row — nothing to compare');
      assert.deepStrictEqual([a.won, a.lost], [w.won, w.lost], `Last 52 ${a.won}–${a.lost}, Calendar window ${w.won}–${w.lost}`);
      return `Last 52 ${a.won}–${a.lost} = Calendar window ${w.won}–${w.lost} (cut ${w.cutoff})`;
    } },
    // fx2 item 8 · undatedFor is no longer clamped: a negative count (more dated rows than the record
    // holds, for a tier) is a reconciliation failure and fails here instead of printing as "0 undated".
    { name: `R · ${L}: the undated count is never negative, on any tier (no silent clamp)`, fn() {
      const got = TIERS.map(t => [t, I.undatedFor(p, t)]);
      got.forEach(([t, u]) => assert(typeof u === 'number' && u >= 0,
        `${t}: undated ${u} — the dated store holds more of this tier's rows than the Career record counts`));
      assert.strictEqual(I.undatedFor(p, 'all'), I.calResidual(p).undated, 'Last 52 and the Calendar read two undated figures');
      return got.map(([t, u]) => t + ' ' + u).join(' · ');
    } },
    { name: `3 · ${L}: Best / Worst month tiles = footer VS OTHERS and N`, fn() {
      const c = R.readCal(p);
      ['best', 'worst'].forEach((w) => {
        const tl = c[w];
        assert(tl, `${w} month tile unreadable`);
        const m = MONTHS.indexOf(tl.month);
        assert(m >= 0, `${w} month "${tl.month}"`);
        assert.strictEqual(tl.value, c.vs[m], `${w} ${tl.month}: tile ${tl.value}, footer ${c.vs[m]}`);
        assert.strictEqual(String(tl.n), c.n[m], `${w} ${tl.month}: tile n=${tl.n}, footer N ${c.n[m]}`);
      });
      const sumN = c.n.reduce((a, x) => a + num(x), 0);
      const head = /([\d,]+) of ([\d,]+) matches · flat 1u/.exec(c.t);
      assert(head && num(head[1]) === sumN, `Σ N ${sumN} ≠ the panel head's priced ${head && head[1]}`);
      return `best ${c.best.month} ${c.best.value} n=${c.best.n} · worst ${c.worst.month} ${c.worst.value} n=${c.worst.n} · Σ N ${sumN}`;
    } },
    { name: `4 · ${L}: ledger head counts the window "See all N results" counts`, fn() {
      const { head, more } = R.readLedger(p);
      assert(head, 'ledger head unreadable');
      if (more) assert.strictEqual(+head[2], +more[1], `head ${head[0]} vs "See all ${more[1]} results"`);
      else assert(!head[1], 'the head names a slice but no "See all" is offered');
      return `"${head[0].replace(/^.*full ledger /i, '')}"${more ? ` · "See all ${more[1]} results"` : ''}`;
    } },
    { name: `5 · ${L}: As favourite + As underdog + unpriced = All matches, stated`, fn() {
      const { all, fav, dog, un } = R.readRoles(p);
      assert(all && fav && dog, 'role tiles unreadable');
      const unN = un ? +un[1] : 0;
      assert.strictEqual(+fav[1] + +dog[1] + unN, +all[1], `${fav[1]} + ${dog[1]} + ${unN} ≠ ${all[1]}`);
      assert(un || +fav[1] + +dog[1] === +all[1], 'unpriced matches exist but the note does not state them');
      return `${fav[1]} + ${dog[1]} + ${unN} unpriced = ${all[1]}`;
    } },
    { name: `6 · ${L}: Court speed H / A = the ledger's H / A on every priced ledger row`, fn() {
      const bad = R.haMismatches(p);
      const priced = I.ledgerRows(p).filter(x => x.price != null).length;
      assert(priced > 0, 'the ledger prices nothing — vacuous');
      assert.deepStrictEqual(bad.map(x => x.m.date + ' ' + x.m.opponent), [], `${bad.length} of ${priced} rows differ`);
      return `${priced} priced ledger rows, Court speed shows the same H / A`;
    } },
    { name: `Y · ${L}: Calendar Career yield = Market edge box (same matches, same basis)`, fn() {
      const c = R.readCal(p), H = mk && mk.headline;
      assert(H && H.n, 'no Market edge headline');
      assert.strictEqual(num(c.yieldTile[1]), H.n, `Calendar ${c.yieldTile[1]} priced, Market edge box ${H.n}`);
      assert.strictEqual(c.yieldTile[0], fmt1(H.yield), `Calendar ${c.yieldTile[0]}, Market edge box ${H.yield}%`);
      const sumN = c.n.reduce((a, x) => a + num(x), 0);
      const un = /; (\d+) of them carr(?:y|ies) no dated career row/.exec(c.t);
      assert.strictEqual(sumN + (un ? +un[1] : 0), H.n, `months rest on ${sumN}, ${un ? un[1] : 0} stated unplaced, box ${H.n}`);
      // The shard's headline against its own rows (a builder check, not a page disagreement — both surfaces
      // print the headline). On for the gate's players; the roster probe reports it separately.
      if (shardSelfCheck) assert.strictEqual(fmt1(boxYield(mk).y), fmt1(H.yield), 'the shard headline does not match its own rows');
      return `Career yield ${c.yieldTile[0]} on ${c.yieldTile[1]} = Market edge ${H.yield.toFixed(2)}% on ${H.n} · months on ${sumN}`;
    } },
    { name: `J · ${L}: every Calendar row the join prices agrees with its Market edge row on the result`, fn() {
      const a = joinAudit(I, p);
      assert(a.joined > 0, 'the join priced no row — vacuous');
      assert.deepStrictEqual(a.bad.slice(0, 5), [], `${a.bad.length} joined rows disagree on the result`);
      return `${a.joined} joined · 0 mispaired · ${a.ret} retirements settled differently · ${a.conflict.length} same-day conflicts`;
    } }
  ];
}

// The Market edge row carries its own result (mkWon). A wrong pairing shows as a result that disagrees with
// career-history's `won`. The one legitimate disagreement is a RETIREMENT (settled on the official ATP
// result); a same-day opposite result is a data conflict between the stores, reported, never a pairing.
function joinAudit(I, p) {
  let joined = 0, ret = 0; const bad = [], conflict = [];
  I.calSpine(p).forEach((r) => {
    if (r.cents == null) return;
    joined++;
    if (r.mkWon === !!r.won) return;
    if (r.mkRet || r.retired || r.wo) { ret++; return; }
    const gap = Math.abs(Date.parse(r.mkDate) - Date.parse(r.date)) / 864e5;
    if (gap <= 1 && r.dateKind === 'match') { conflict.push(p.key + ' ' + r.date + ' ' + r.opp); return; }
    bad.push(p.key + ' ' + r.date + ' ' + r.opp + ' (price dated ' + r.mkDate + ')');
  });
  return { joined, ret, bad, conflict };
}

function harness() {
  let pass = 0, fail = 0, skip = 0;
  const failures = [];
  return {
    check(name, fn) {
      try { const ev = fn(); pass++; console.log('  PASS  ' + name); if (ev) console.log('        ' + ev); }
      catch (e) { fail++; failures.push(name + ' :: ' + e.message.split('\n')[0]); console.log('  FAIL  ' + name + ' :: ' + e.message.split('\n')[0]); }
    },
    async checkAsync(name, fn) {
      try { const ev = await fn(); pass++; console.log('  PASS  ' + name); if (ev) console.log('        ' + ev); }
      catch (e) { fail++; failures.push(name + ' :: ' + e.message.split('\n')[0]); console.log('  FAIL  ' + name + ' :: ' + e.message.split('\n')[0]); }
    },
    mustFail(name, fn) {
      let threw = false;
      try { fn(); } catch (e) { threw = true; }
      if (threw) { pass++; console.log('  PASS  [neg] ' + name + ' (correctly rejected)'); }
      else { fail++; failures.push('[neg] ' + name); console.log('  FAIL  [neg] ' + name + ' :: corruption NOT caught — check is vacuous'); }
    },
    skip(name, why) { skip++; console.log('  SKIP  ' + name + ' :: ' + why); },
    done() {
      console.log(`\n  ${pass} passed, ${fail} failed, ${skip} skipped (a skip is never a pass)`);
      if (fail) { failures.forEach(f => console.log('   - ' + f)); process.exit(1); }
    }
  };
}

module.exports = { ROOT, pinnedDate, loadPp2, readers, playerChecks, joinAudit, boxYield, harness, text, num, fmt1, MONTHS };
