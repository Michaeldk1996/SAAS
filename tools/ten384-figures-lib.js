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
    // profile v2 (2026-11-09): the window / residual notes live in Record by season's (?) cr2 — opened here so they print
    return withState({ key: p.key, careerTab: 'record', careerScope: scope, careerTier: tier || 'all', careerDrill: null, info: 'cr2' },
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
    // profile v2 (2026-11-09): the swing-grid Calendar, its (?) notes opened so the residual and priced clauses print
    const st = { key: p.key, seasonTab: 'calendar', calWin: 'career', calSurf: 'all', calCellV2: null, calSpeed: 'all', calFmt: 'all', calBand: 'all', calArch: 'all', calCtry: 'all' };
    const h = withState(Object.assign({ info: 'cal1' }, st), () => I.renderSeasonModal(p)) + withState(Object.assign({ info: 'cal2' }, st), () => I.renderSeasonModal(p));
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
      priced: (/([\d,]+) of [\d,]+ matches · flat 1u/.exec(t) || [])[1], mkn: (/Market edge prices ([\d,]+) matches; ([\d,]+) of them/.exec(t) || []).slice(1),
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
    // profile v2 (2026-11-09): the Best / Worst SWING tiles = a recompute of every swing's yield against the other swings
    // (priced rows only, team events out, n >= 5 priced), done here from the module's own rows.
    { name: `3 · ${L}: Best / Worst swing tiles = each swing's yield minus the other swings', recomputed`, fn() {
      const c = R.readCal(p);
      const rows = R.withState({ key: p.key, calWin: 'career', calSurf: 'all' }, () => I.calRows(p));
      const by = {};
      rows.forEach((x) => { if (x.sw === 'team' || x.r.cents == null) return; (by[x.sw] = by[x.sw] || []).push(x.r.cents); });
      const tot = Object.values(by).reduce((a, v) => a.concat(v), []);
      const sum = v => v.reduce((a, x) => a + x, 0);
      const pp = Object.keys(by).filter(k => by[k].length >= 5).map((k) => {
        const rest = tot.length - by[k].length;
        return { k, n: by[k].length, pp: sum(by[k]) / by[k].length - (sum(tot) - sum(by[k])) / rest };
      });
      assert(pp.length, 'no swing clears five priced — vacuous');
      const best = pp.slice().sort((a, b) => b.pp - a.pp)[0], worst = pp.slice().sort((a, b) => a.pp - b.pp)[0];
      // v3 D2 (2026-11-12): the tile prints the picked swing's own yield over "N priced" (the pick is still the gap to the
      // other swings); read each tile's own slice of the strip
      const yld = k => { const y = sum(by[k]) / by[k].length, r = Math.round(y * 10) / 10; return (r < 0 ? '−' : '+') + Math.abs(r).toFixed(1) + '%'; };
      // each tile is found after the previous one (the opened (?) also names "Swing opener" ahead of the strip)
      const t = c.t.replace(/\s+/g, ' '), at = (re, from) => { const k = t.slice(from).search(re); return k < 0 ? -1 : from + k; };
      const bi = at(/BEST SWING/i, 0), wi = at(/WORST SWING/i, bi), oi = at(/SWING OPENER/i, wi);
      assert(bi >= 0 && wi > bi && oi > wi, 'the swing tiles are not in order');
      const bs = t.slice(bi, wi), ws = t.slice(wi, oi);
      assert(bs.includes(yld(best.k) + ' Yield ' + best.n + ' priced'), `Best swing tile is not ${best.k} ${yld(best.k)} over ${best.n} priced: ${bs}`);
      assert(ws.includes(yld(worst.k) + ' Yield ' + worst.n + ' priced'), `Worst swing tile is not ${worst.k} ${yld(worst.k)} over ${worst.n} priced: ${ws}`);
      return `best ${best.k} ${yld(best.k)} n=${best.n} · worst ${worst.k} ${yld(worst.k)} n=${worst.n}`;
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
    { name: `Y · ${L}: the Calendar's priced count + the stated unplaced = the Market edge box (same matches, same basis)`, fn() {
      const c = R.readCal(p), H = mk && mk.headline;
      assert(H && H.n, 'no Market edge headline');
      assert(c.priced != null, 'the Calendar states no priced count');
      const placed = num(c.priced), gap = c.mkn.length ? num(c.mkn[1]) : 0;
      assert.strictEqual(placed + gap, H.n, `Calendar ${placed} priced + ${gap} stated unplaced ≠ Market edge box ${H.n}`);
      if (gap) assert.strictEqual(num(c.mkn[0]), H.n, 'the note names another total');
      if (shardSelfCheck) assert.strictEqual(fmt1(boxYield(mk).y), fmt1(H.yield), 'the shard headline does not match its own rows');
      return `${placed} placed + ${gap} unplaced = Market edge ${H.n}`;
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

// TEN-395 · "Last 52 surface rows = the season table's surfaces inside the window", for ONE player. A window that opens
// mid-season cannot be compared month for month (fx7/fx8), so every season-tier the window touches is compared WHOLE:
// the season's classified dated rows (I.seasonCourts) must hold the table's Indoors exactly (I.tierGridCells) and its
// Hard / Clay / Grass up to the season's undated matches only, and the window's rows of the season (I.drillRows with the
// cut-off) must be a subset of the season's. Also: Last 52 Indoors = the window rows the table counts indoor, match by
// match (career-history's `indoor` flag) — checked only where every window row of a split season carries the flag.
// Returns { seasons, bad: [line], over: [line] (window season calls MORE indoor than the table), flagged, l52 }.
function last52SeasonAudit(I, p) {
  const z = () => ({ won: 0, lost: 0 });
  const wl = c => (c ? (c.won || 0) + '–' + (c.lost || 0) : '—');
  const tally = (a, r) => { a[r.won ? 'won' : 'lost']++; };
  const cut = I.last52Cutoff();
  const sp = I.calSpine(p), courts = I.seasonCourts(p);
  const out = { seasons: 0, bad: [], over: [], flagged: sp.some(r => r.seasonIndoor === true || r.seasonIndoor === false), l52: null };
  (p.careerByYear || []).filter(y => y && y.total && +y.year >= 2021).forEach((y) => {
    const yr = String(y.year);
    ['all', 'atp', 'chitf'].forEach((tier) => {
      const raw = tier === 'all' ? y : y[tier];
      if (!raw) return;
      const inT = r => tier === 'all' || r.tier === tier;
      if (!sp.some(r => r.year === yr && inT(r) && r.date >= cut)) return;
      out.seasons++;
      const table = I.tierGridCells(y, tier);
      const ti = (raw.indoor && raw.indoor.total) || z();
      const season = { hard: z(), clay: z(), grass: z(), indoors: z() }, dated = { hard: z(), clay: z(), grass: z() };
      sp.forEach((r, i) => {
        if (r.year !== yr || !inT(r)) return;
        if (dated[r.surface]) tally(dated[r.surface], r);
        const s = courts[i] === 'Indoor' ? 'indoors' : r.surface;
        if (season[s]) tally(season[s], r);
      });
      const tag = `${p.name} (${p.key}) ${yr} [${tier}]`;
      if (season.indoors.won !== ti.won || season.indoors.lost !== ti.lost) {
        out.bad.push(`${tag} Indoors: table ${wl(raw.indoor ? ti : null)}, season rows ${wl(season.indoors)}`);
      }
      if (season.indoors.won > ti.won || season.indoors.lost > ti.lost) out.over.push(tag);
      ['hard', 'clay', 'grass'].forEach((s) => {
        const t = table[s] || z(), r0 = raw[s] || z();
        if ((t.won || 0) - season[s].won !== (r0.won || 0) - dated[s].won || (t.lost || 0) - season[s].lost !== (r0.lost || 0) - dated[s].lost) {
          out.bad.push(`${tag} ${s}: table ${wl(t)}, season rows ${wl(season[s])} beyond its undated matches`);
        }
        const win = z();
        I.drillRows(p, s, yr, cut).filter(inT).forEach(r => tally(win, r));
        if (win.won > season[s].won || win.lost > season[s].lost) out.bad.push(`${tag} ${s}: window ${wl(win)} exceeds the season's ${wl(season[s])}`);
      });
    });
  });
  const split = {};
  (p.careerByYear || []).forEach((y) => { if (y && y.indoor) split[String(y.year)] = true; });
  const win = sp.filter(r => r.date >= cut && split[r.year]);
  if (win.length && win.every(r => r.seasonIndoor === true || r.seasonIndoor === false)) {
    const want = z();
    win.forEach((r) => { if (r.seasonIndoor) tally(want, r); });
    const g = I.last52GridCells(p, 'all');
    out.l52 = { got: wl(g && g.cells.indoors), want: want.won + want.lost ? wl(want) : '—' };
    if (out.l52.got !== out.l52.want) out.bad.push(`${p.name} (${p.key}) Last 52 Indoors ${out.l52.got}, the window rows the table counts indoor ${out.l52.want}`);
  }
  return out;
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

module.exports = { ROOT, pinnedDate, loadPp2, readers, playerChecks, joinAudit, last52SeasonAudit, boxYield, harness, text, num, fmt1, MONTHS };
