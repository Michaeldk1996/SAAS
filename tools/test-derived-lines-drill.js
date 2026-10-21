// tools/test-derived-lines-drill.js — founder brief 2026-10-21 (Market edge → Derived lines: population, ±3.5 / ±3
// with voids, Window + Tier filters, a drill-down on every line).
//
// GATE, on the pinned TEN-384 fixture (Korda, player-2840.json, clock pinned to its instant) plus constructed rows
// that manufacture every state the checks exist for — a ±3 void each way, Challenger & ITF rows inside both rolling
// windows, a walkover, a retirement, a NextGen match, a match-tiebreak decider — through the page's own lineCoverage
// and renderLinesTab:
//
//   D · DRILL = RECORD. For every format × role × Window × Tier and every line with a match behind it, the opened
//       drill's Covered / Not covered / Void counts equal the row's record exactly, and the list each filter shows
//       holds exactly that many matches (the drill note's "All N"), every row tagged with that result.
//   H · the handicap identities: ±3.5 and the half lines cover + not covered = n; ±3 covered + void + not covered =
//       n; +3.5 covered = +3 covered + +3 void; −3.5 covered = −3 covered; −2.5 covered = −3 covered + −3 void.
//   T · ATP + Challenger & ITF = All for every line, every format, every window.
//   P · population: the Career record's figure for the window and tier = this format + the other format + every
//       match out, by reason (and the note prints that sum).
//   W · the windows count back from the pinned day: Last 52 weeks = the Career record's own 364-day cutoff.
//   S · (founder 2026-10-22) the title is fixed, the Window order is Last 52 weeks / Last 24 months / Career with Career
//       the default, and every control button reserves its selected width, in every state.
//
// WHAT BREAKS IT: the drill listing matches from anywhere but the row's own tally — re-filtering the pool under a
// different rule (voids read as covered or not covered, the role or a filter dropped, a different population) moves
// a chip or a list off the row's record and D fails. The [neg] cases below make those exact changes to the module
// source and must be rejected.
//
// Run: node tools/test-derived-lines-drill.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const L = require('./ten384-figures-lib.js');

const SRC = process.env.PP2_SRC ? path.resolve(process.env.PP2_SRC) : path.join(L.ROOT, 'player-profile-v2.js');
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten384-figures', 'player-2840.json'), 'utf8'));
const H = L.harness();
const T = L.text;

// Constructed rows (career-history shape). Dates sit inside both rolling windows of the pinned day (2026-10-07).
const row = (date, level, tournament, opp, result, won, sets, extra) => Object.assign({ year: date.slice(0, 4), surface: 'hard',
  level, date, tournament, round: 'R32', opponent: opp, result, won, src: 'fixtures', sets }, extra || {});
const S = (a) => a.map(([p, o]) => ({ p, o }));
const EXTRA = [
  // ±3 voids: won by exactly 3 (−3 void, +3 cover) and lost by exactly 3 (+3 void, −3 miss), on both tiers
  row('2026-08-04', 'chitf', 'Challenger Alpha', 'A. Void', '2 - 0', true, S([[6, 4], [6, 5]])),          // won 12-9  → +3
  row('2026-07-14', 'chitf', 'Challenger Bravo', 'B. Void', '0 - 2', false, S([[4, 6], [5, 6]])),         // lost 9-12 → −3
  row('2025-03-10', 'chitf', 'Challenger Charlie', 'C. Cover', '2 - 1', true, S([[6, 1], [3, 6], [6, 2]])),
  row('2025-11-20', 'chitf', 'Challenger Delta', 'D. Miss', '1 - 2', false, S([[7, 6], [0, 6], [2, 6]])),
  row('2025-06-01', 'atp', 'ATP Echo', 'E. Void', '2 - 1', true, S([[6, 7], [6, 3], [6, 4]])),           // won 18-14 → +4 ... cover
  row('2026-02-02', 'atp', 'ATP Foxtrot', 'F. Void', '2 - 1', true, S([[3, 6], [6, 3], [6, 3]])),         // won 15-12 → +3
  // out, by reason
  row('2026-05-05', 'chitf', 'Challenger Golf', 'G. Walkover', ' - ', true, []),
  row('2026-05-06', 'chitf', 'Challenger Hotel', 'H. Retired', '1 - 0', true, S([[6, 2], [2, 1]]), { retired: true }),
  row('2025-12-15', 'atp', 'Next Gen Finals - Jeddah', 'I. Short', '3 - 1', true, S([[4, 2], [3, 4], [4, 1], [4, 2]])),
  row('2025-09-20', 'atp', 'ATP Laver Cup', 'J. Tiebreak', '2 - 1', true, S([[6, 3], [4, 6], [10, 8]]))
];

// Two shapes of the same player. FEED: the fixture as pinned (no Tennis Explorer join): seasons before 2021 hold the
// season total only, so under ATP / Challenger & ITF they are out of the Career scope, as the record's Tier control
// dashes them — the constructed rows are added to their seasons' totals and tier splits, as the feed would count
// them. TE: the record a Tennis Explorer join builds (te-join.js): the walkover is out of the record (recordLayer
// `out`), and the season table is careerByYearFromRows over the record's rows, every season split by tier.
const TJ = require(path.join(L.ROOT, 'te-join.js'));
function mod(src, shape) {
  const p = JSON.parse(JSON.stringify(FX.profile));
  p.tournamentHistory = FX.tournamentHistory;
  const ch = FX.careerHistory.concat(EXTRA);
  const extra = {};
  if (shape === 'te') {
    const wo = ch.findIndex((r) => !/\d/.test(r.result));
    extra.careerRecord = { [FX.key]: { v: 1, over: [], out: [[wo, 'walkover']], add: [] } };
    p.careerByYear = TJ.careerByYearFromRows(ch.filter((r, i) => i !== wo));
  } else {
    const byYear = {};
    (p.careerByYear || []).forEach((y) => { byYear[String(y.year)] = y; });
    EXTRA.forEach((r) => {
      const y = byYear[r.year], k = r.won ? 'won' : 'lost';
      y.total[k]++;
      if (!y[r.level]) y[r.level] = { total: { won: 0, lost: 0 } };
      y[r.level].total[k]++;
    });
  }
  const m = L.loadPp2({
    src: src || SRC, now: FX.asOf, players: { [FX.key]: p }, careerHistory: { [FX.key]: ch },
    marketEdge: { [FX.key]: FX.marketEdge }, bet365History: FX.bet365History, extra
  });
  return { I: m.I, p };
}
function withState(I, st, fn) {
  const saved = Object.assign({}, I.state);
  Object.assign(I.state, st);
  try { return fn(); } finally { Object.keys(I.state).forEach((k) => delete I.state[k]); Object.assign(I.state, saved); }
}
const FMTS = ['bo3', 'bo5'], ROLES = ['all', 'fav', 'dog'], WINS = ['career', 'l24', 'l52'], TIERS = ['all', 'atp', 'chitf'];
const each = (fn) => FMTS.forEach((f) => ROLES.forEach((role) => WINS.forEach((win) => TIERS.forEach((tier) => fn(f, role, win, tier)))));
const rowsOf = (c) => [].concat.apply([], c.groups.map((g) => g.rows));
const byLabel = (c, label) => rowsOf(c).find((r) => r.label === label);

/** Open one line's drill under one filter and read what the page shows: the chip counts, the listed count, the tags. */
function readDrill(I, p, st, label, res) {
  const html = withState(I, Object.assign({ key: p.key, marketTab: 'lines' }, st, { lcDrill: label, lcDrillRes: res }), () => I.renderLinesTab(p));
  const i = html.indexOf('data-pp2-lc-drill="');
  assert(i >= 0, 'no drill rendered for ' + label);
  const drill = html.slice(i);
  const t = T(drill);
  const chip = (w) => { const m = new RegExp(w + ' (\\d+)').exec(t); return m ? +m[1] : null; };
  const listed = (/All (\d+) match(?:es)?|Showing \d+ of (\d+)/.exec(t) || []).slice(1).find((x) => x != null);
  const tags = (drill.match(/data-pp2-lc-res="([a-z]+)"/g) || []).map((x) => x.replace(/.*="|"/g, ''));
  return { cover: chip('Covered'), miss: chip('Not covered'), void: chip('Void'), listed: listed == null ? null : +listed, tags };
}

function drillEqualsRecord(I, p) {
  let lines = 0, opened = 0;
  each((f, role, win, tier) => {
    const st = { lcFmt: f, lcRole: role, lcWin: win, lcTier: tier };
    const c = I.lineCoverage(p, f, role, { win, tier });
    rowsOf(c).forEach((r) => {
      lines++;
      if (!r.n) return;
      const ctx = [f, role, win, tier, r.label].join(' / ');
      assert.strictEqual(r.hit + r.miss + r.voids, r.n, ctx + ': record does not add to n');
      ['cover', 'miss'].concat(r.voidable ? ['void'] : []).forEach((res) => {
        const want = res === 'cover' ? r.hit : res === 'miss' ? r.miss : r.voids;
        // a filter with nothing behind it lists nothing; only one with matches is opened and counted
        const d = readDrill(I, p, st, r.label, res);
        assert.strictEqual(d.cover, r.hit, ctx + ': Covered chip ' + d.cover + ' ≠ record ' + r.hit);
        assert.strictEqual(d.miss, r.miss, ctx + ': Not covered chip ' + d.miss + ' ≠ record ' + r.miss);
        assert.strictEqual(d.void, r.voidable ? r.voids : null, ctx + ': Void chip ' + d.void + ' (voidable ' + r.voidable + ')');
        assert.strictEqual(d.listed, want, ctx + ' [' + res + ']: list holds ' + d.listed + ', record says ' + want);
        assert(d.tags.length === Math.min(want, 150) && d.tags.every((x) => x === res), ctx + ' [' + res + ']: painted rows ' +
          d.tags.length + ' tagged ' + Array.from(new Set(d.tags)).join(','));
        opened++;
      });
    });
  });
  return { lines, opened };
}

function main() {
  const TE = mod(null, 'te');
  console.log('FEED shape (no Tennis Explorer join; pre-2021 seasons hold no tier split)');
  shapeChecks(mod(), 'feed');
  console.log('TE shape (the record a Tennis Explorer join builds; every season split by tier)');
  shapeChecks(TE, 'te');
  mutants();
  H.done();
}
function shapeChecks(A, shape) {
  const { I, p } = A;
  const base = I.lineCoverage(p, 'bo3', 'all', { win: 'l52', tier: 'chitf' });
  const tag = (n) => n + ' [' + shape + ']';

  H.check(tag('the fixture + constructed rows carry every case (voids each way, both tiers in the windows, every out reason)'), () => {
    const c = I.lineCoverage(p, 'bo3', 'all');
    const m3 = byLabel(c, '−3 games'), p3 = byLabel(c, '+3 games');
    assert(m3.voids > 0 && p3.voids > 0, 'no ±3 void');
    assert(base.n > 0, 'no Challenger & ITF row in Last 52 weeks');
    assert(I.lineCoverage(p, 'bo3', 'all', { win: 'l24', tier: 'atp' }).n > 0, 'no ATP row in Last 24 months');
    // a TE record holds no walkover (recordLayer leaves it out), so "no score" is a feed-shape case
    (shape === 'feed' ? ['noScore', 'retired', 'format'] : ['retired', 'format']).forEach((k) => assert(c.why[k] > 0, 'no "' + k + '" exclusion'));
    if (shape === 'te') assert.strictEqual(c.why.noScore, 0, 'the walkover the record leaves out was counted');
    return `bo3 ${c.n} · −3 ${m3.record} · +3 ${p3.record} · out ${JSON.stringify(c.why)} · L52 CH ${base.n}`;
  });

  H.check(tag('D · every line\'s drill counts equal its row record, under every format × role × Window × Tier'), () => {
    const r = drillEqualsRecord(I, p);
    assert(r.opened > 100, 'only ' + r.opened + ' drills opened');
    return r.lines + ' lines, ' + r.opened + ' drill filters opened and reconciled';
  });

  H.check(tag('H · ±3.5 / ±3 / ±2.5 identities, every format × role × Window × Tier'), () => {
    let k = 0;
    each((f, role, win, tier) => {
      if (f !== 'bo3') return;
      const c = I.lineCoverage(p, f, role, { win, tier }), g = (l) => byLabel(c, l);
      const ctx = [role, win, tier].join('/');
      ['−4.5 games', '−3.5 games', '−2.5 games', '+2.5 games', '+3.5 games', '+4.5 games'].forEach((l) => {
        assert.strictEqual(g(l).hit + g(l).miss, g(l).n, ctx + ' ' + l); assert.strictEqual(g(l).voids, 0, ctx + ' ' + l + ' voids');
      });
      ['−3 games', '+3 games'].forEach((l) => assert.strictEqual(g(l).hit + g(l).voids + g(l).miss, g(l).n, ctx + ' ' + l));
      assert.strictEqual(g('+3.5 games').hit, g('+3 games').hit + g('+3 games').voids, ctx + ' +3.5 = +3 W + V');
      assert.strictEqual(g('−3.5 games').hit, g('−3 games').hit, ctx + ' −3.5 = −3 W');
      assert.strictEqual(g('−2.5 games').hit, g('−3 games').hit + g('−3 games').voids, ctx + ' −2.5 = −3 W + V');
      assert.strictEqual(g('+3 games').n, c.withGames, ctx + ' ±3 n = the games-lines matches');
      // the ±3 rate leaves voids out
      const r3 = g('+3 games');
      if (r3.rate != null) assert(Math.abs(r3.rate - 100 * r3.hit / (r3.hit + r3.miss)) < 1e-9, ctx + ' +3 rate');
      k++;
    });
    return k + ' tables';
  });

  H.check(tag('T · ATP + Challenger & ITF = All, every line, every format and window' +
    (shape === 'feed' ? ' (rolling windows; Career below)' : '')), () => {
    let k = 0;
    FMTS.forEach((f) => ROLES.forEach((role) => WINS.forEach((win) => {
      if (shape === 'feed' && win === 'career') return;
      const a = I.lineCoverage(p, f, role, { win, tier: 'all' }), t1 = I.lineCoverage(p, f, role, { win, tier: 'atp' }),
        t2 = I.lineCoverage(p, f, role, { win, tier: 'chitf' });
      assert.strictEqual(t1.n + t2.n, a.n, [f, role, win].join('/') + ' n');
      rowsOf(a).forEach((r) => {
        const x = byLabel(t1, r.label), y = byLabel(t2, r.label);
        ['n', 'hit', 'voids', 'miss'].forEach((q) => assert.strictEqual(x[q] + y[q], r[q], [f, role, win, r.label, q].join('/')));
        k++;
      });
    })));
    return k + ' lines';
  });

  if (shape === 'feed') {
    H.check(tag('T · Career on a feed record: All − ATP − Challenger & ITF = the matches in seasons with no tier split, and the note counts them'), () => {
      const a = I.lineCoverage(p, 'bo3', 'all', { tier: 'all' }), x = I.lineCoverage(p, 'bo3', 'all', { tier: 'atp' }),
        y = I.lineCoverage(p, 'bo3', 'all', { tier: 'chitf' });
      assert(x.noSplit + y.noSplit > 0, 'the feed fixture should hold pre-2021 rows with no tier split');
      // the scope gap is exactly the no-split rows; the Bo3 table's gap is the part of them that is Bo3 and in
      assert.strictEqual(a.scopeN - x.scopeN - y.scopeN, x.noSplit + y.noSplit, 'scope gap');
      assert(a.n - x.n - y.n >= 0 && a.n - x.n - y.n <= x.noSplit + y.noSplit, 'table gap ' + (a.n - x.n - y.n));
      const t = withState(I, { key: p.key, marketTab: 'lines', lcFmt: 'bo3', lcRole: 'all', lcTier: 'atp' }, () => T(I.renderLinesTab(p)));
      assert(t.includes(x.noSplit + ' ATP matches sit in seasons the Career record holds without a tier split'), t.slice(-500));
      return `All ${a.n} = ATP ${x.n} + CH ${y.n} + ${a.n - x.n - y.n} Bo3 matches of the ${x.noSplit + y.noSplit} no-split rows`;
    });
  }

  H.check(tag('P · Career record = this format + the other format + every match out, by reason (and the note says so)'), () => {
    let k = 0;
    WINS.forEach((win) => TIERS.forEach((tier) => {
      const b3 = I.lineCoverage(p, 'bo3', 'all', { win, tier }), b5 = I.lineCoverage(p, 'bo5', 'all', { win, tier });
      const w = b3.why;
      assert.strictEqual(b3.why.otherFmt, b5.all, win + '/' + tier + ': Bo3 other = Bo5');
      assert.strictEqual(b3.recordN, b3.all + w.otherFmt + w.noScore + w.retired + w.format + w.unshaped + b3.undated, win + '/' + tier);
      assert(b3.undated >= 0, win + '/' + tier + ' undated ' + b3.undated);
      const note = withState(I, { key: p.key, marketTab: 'lines', lcFmt: 'bo3', lcRole: 'all', lcWin: win, lcTier: tier }, () => T(I.renderLinesTab(p)));
      assert(note.includes(': ' + b3.recordN.toLocaleString('en-US') + ' matches = ' + b3.all + ' best of 3 + ' + w.otherFmt + ' best of 5'),
        win + '/' + tier + ' note: ' + note.slice(-400));
      k++;
    }));
    const c = I.lineCoverage(p, 'bo3', 'all');
    const careerTot = I.careerTierCells(p, 'all').total;
    assert.strictEqual(c.recordN, careerTot.won + careerTot.lost, 'Career = the record\'s own total');
    return k + ' scopes · Career ' + c.recordN + ' = ' + c.all + ' + ' + c.why.otherFmt + ' + out ' + JSON.stringify(c.why) + ' + undated ' + c.undated;
  });

  if (shape === 'feed') H.check(tag('S · the title and every control are the same in every state (founder 2026-10-22)'), () => {
    // Fixed title; Window order Last 52 weeks / Last 24 months / Career (Career pressed by default); every control
    // button carries its 700-weight label as a hidden width reserve, so selecting it cannot change its width.
    // Positions themselves are measured in a browser (54 states × 4 widths), not here.
    const seen = new Set();
    let n = 0;
    WINS.forEach((win) => TIERS.forEach((tier) => FMTS.forEach((f) => ROLES.forEach((role) => {
      const h = withState(I, { key: p.key, marketTab: 'lines', lcFmt: f, lcRole: role, lcWin: win, lcTier: tier, lcDrill: null }, () => I.renderLinesTab(p));
      const title = /data-lc="title"[^>]*>([^<]*)</.exec(h);
      assert(title && title[1] === 'Coverage by line', win + '/' + tier + '/' + f + '/' + role + ' title: ' + (title && title[1]));
      const btns = h.match(/<button[^>]*data-pp2="lc-(?:win|tier|fmt)"[\s\S]*?<\/button>/g) || [];
      assert.strictEqual(btns.length, 8, 'controls ' + btns.length);
      btns.forEach((b) => assert(/visibility:hidden;">[^<]+<\/span><\/span><\/button>$/.test(b) && /font-weight:700;visibility:hidden/.test(b), 'no width reserve: ' + b.slice(0, 120)));
      // the label text and order, stripped of state: one signature in every state
      seen.add(btns.map((b) => /data-v="(\w+)"/.exec(b)[1]).join(','));
      n++;
    }))));
    assert.deepStrictEqual([...seen], ['l52,l24,career,all,atp,chitf,bo3,bo5']);
    const def = withState(I, { key: p.key, marketTab: 'lines', lcWin: undefined }, () => I.renderLinesTab(p));
    assert(/data-pp2="lc-win" data-v="career" aria-pressed="true"/.test(def), 'Career is not the default');
    return n + ' states · one title · order ' + [...seen][0];
  });

  H.check(tag('W · Last 52 weeks is the Career record\'s cutoff; Last 24 months is two years back from the pinned day'), () => {
    const c52 = I.lineCoverage(p, 'bo3', 'all', { win: 'l52' }), c24 = I.lineCoverage(p, 'bo3', 'all', { win: 'l24' });
    assert.strictEqual(c52.since, I.last52Cutoff ? I.last52Cutoff() : c52.since);
    assert.strictEqual(c24.since, '2024-10-07', 'l24 cutoff ' + c24.since);
    assert(c24.n >= c52.n && I.lineCoverage(p, 'bo3', 'all').n >= c24.n, 'windows do not nest');
    return `Career ${I.lineCoverage(p, 'bo3', 'all').n} ⊇ 24m ${c24.n} (since ${c24.since}) ⊇ 52w ${c52.n} (since ${c52.since})`;
  });

}
function mutants() {
  // ── [neg] the drill must not be able to drift from the record ──
  const SRC_TEXT = fs.readFileSync(SRC, 'utf8');
  function mutant(from, to) {
    assert(SRC_TEXT.includes(from), 'mutation anchor missing: ' + from);
    const f = path.join(require('os').tmpdir(), 'pp2-derived-mutant-' + process.pid + '.js');
    fs.writeFileSync(f, SRC_TEXT.replace(from, to));
    try { return mod(f, 'te'); } finally { fs.unlinkSync(f); }
  }
  H.mustFail('a tally that reads a void as covered (the list still says Void) is caught', () => {
    const m = mutant("if (h === 'cover') t.hit++; else if (h === 'void') t.voids++;", "if (h === 'cover' || h === 'void') t.hit++;");
    drillEqualsRecord(m.I, m.p);
  });
  H.mustFail('a drill listing the role\'s whole pool (role filter dropped) is caught', () => {
    const m = mutant('t.members.push({ m: sub[j], res: h });', 't.members.push({ m: sub[j], res: h }); if (j === 0 && sub !== pool) pool.forEach(function (q) { var hh = lineResult(q, kind, arg, dir); if (hh !== null && sub.indexOf(q) < 0) t.members.push({ m: q, res: hh }); });');
    drillEqualsRecord(m.I, m.p);
  });
  H.mustFail('a Tier filter that drops Challenger & ITF rows from the drill scope (tier ignored) breaks ATP + CH = All', () => {
    const m = mutant('var scope = drillScope(p, null, since, tier)', 'var scope = drillScope(p, null, since, null)');
    const a = m.I.lineCoverage(m.p, 'bo3', 'all', { win: 'l52', tier: 'all' }), x = m.I.lineCoverage(m.p, 'bo3', 'all', { win: 'l52', tier: 'atp' }),
      y = m.I.lineCoverage(m.p, 'bo3', 'all', { win: 'l52', tier: 'chitf' });
    assert.strictEqual(x.n + y.n, a.n);
  });
}
main();
