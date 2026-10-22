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
//   B · (founder 2026-10-23) bettable side per card; N · no sample text, thin rates dimmed; O · a drill opens on its first
//       non-empty tab, an empty tab says "No matches"; V · no provisional source label on a line drill row.
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
  row('2025-09-20', 'atp', 'ATP Laver Cup', 'J. Tiebreak', '2 - 1', true, S([[6, 3], [4, 6], [10, 8]])),
  // an indoor hard court (the record's cell is Indoors, its raw surface Hard): the Surface filter must read the cell
  row('2025-10-21', 'atp', 'ATP Kilo Indoors', 'K. Indoor', '2 - 0', true, S([[6, 4], [7, 5]]), { indoor: true })
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
    const prov = ch.findIndex((r) => r.opponent === 'A. Void');   // a counted Bo3 row, provisional in the record
    extra.careerRecord = { [FX.key]: { v: 1, over: [[prov, { provisional: '2026-08-05' }]], out: [[wo, 'walkover']], add: [] } };
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
  // the tab chips are the drill's segmented control: read them off its own buttons
  const chips = {};
  (drill.match(/data-pp2="lc-drill-res" data-v="(\w+)"[\s\S]*?<\/button>/g) || []).forEach((b) => {
    const m = /data-v="(\w+)"[\s\S]*?>([^<>]*?) (\d+)</.exec(b); if (m) chips[m[1]] = +m[3];
  });
  const listed = /data-pp2-lc-listed="(\d+)"/.exec(drill);
  const tags = (drill.match(/data-pp2-lc-res="([a-z]+)"/g) || []).map((x) => x.replace(/.*="|"/g, ''));
  // the drill panel alone (up to the next ledger row): its colour, the header's text
  const panel = drill.slice(0, drill.search(/<div data-pp2="lc-line"|<div data-lc-line=|data-lc="note"/) > 0 ? drill.search(/<div data-pp2="lc-line"|<div data-lc-line=|data-lc="note"/) : drill.length);
  const head = T(panel.slice(panel.indexOf('>') + 1, panel.indexOf('data-pp2-seg="lc-drill-res"')));   // the visible header, not its tag
  return { cover: chips.cover == null ? null : chips.cover, miss: chips.miss == null ? null : chips.miss, void: chips.void == null ? null : chips.void,
    retired: chips.retired == null ? null : chips.retired, listed: listed ? +listed[1] : null, tags, panel, head };
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
      // a retirement is never in the record: the row's retired count is the table's, and every one of them is tagged
      assert.strictEqual(r.retired, c.retiredHere, ctx + ': retired ' + r.retired + ' ≠ the table\'s ' + c.retiredHere);
      assert(r.members.filter((x) => x.res === 'retired').every((x) => x.m.r.retired), ctx + ': a non-retired match on the Retired tab');
      assert(r.members.filter((x) => x.res !== 'retired').every((x) => !x.m.r.retired), ctx + ': a retired match in the record');
      let headText = null;
      ['cover', 'miss', 'retired'].concat(r.voidable ? ['void'] : []).forEach((res) => {
        const want = res === 'cover' ? r.hit : res === 'miss' ? r.miss : res === 'void' ? r.voids : r.retired;
        const d = readDrill(I, p, st, r.label, res);
        assert.strictEqual(d.cover, r.hit, ctx + ': Covered chip ' + d.cover + ' ≠ record ' + r.hit);
        assert.strictEqual(d.miss, r.miss, ctx + ': Not covered chip ' + d.miss + ' ≠ record ' + r.miss);
        assert.strictEqual(d.void, r.voidable ? r.voids : null, ctx + ': Void chip ' + d.void + ' (voidable ' + r.voidable + ')');
        assert.strictEqual(d.retired, r.retired, ctx + ': Retired chip ' + d.retired + ' ≠ ' + r.retired);
        // the tabs add to the line's matches plus its retirements
        assert.strictEqual(d.cover + d.miss + (d.void || 0) + d.retired, r.n + r.retired, ctx + ': tabs do not add to n + retired');
        assert.strictEqual(d.listed, want, ctx + ' [' + res + ']: list holds ' + d.listed + ', the tab says ' + want);
        assert(d.tags.length === Math.min(want, 150) && d.tags.every((x) => x === res), ctx + ' [' + res + ']: painted rows ' +
          d.tags.length + ' tagged ' + Array.from(new Set(d.tags)).join(','));
        // the badge is the row's only colour: no green / red anywhere in the panel outside a LINE badge
        const bare = d.panel.replace(/<span data-pp2-lc-badge="[^"]*"[^>]*>[^<]*<\/span>/g, '');
        assert(!/var\(--pos\)|var\(--neg\)/.test(bare), ctx + ' [' + res + ']: green or red outside the LINE badge');
        assert(d.tags.length === (d.panel.match(/data-pp2-lc-badge="/g) || []).length, ctx + ': a row without its badge');
        // one header on every tab: the record and its matches (and its retirements), no tab or paging text
        if (headText == null) headText = d.head; else assert.strictEqual(d.head, headText, ctx + ': the header changes with the tab: ' + JSON.stringify([headText.slice(0,300), d.head.slice(0,300)]));
        assert(d.head.includes(r.record + ' · ' + r.n + ' matches') && !/All \d+ match|Showing/.test(d.head), ctx + ': header ' + d.head);
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
    (shape === 'feed' ? ['noScore', 'retired', 'nextgen', 'mtb'] : ['retired', 'nextgen', 'mtb']).forEach((k) => assert(c.why[k] > 0, 'no "' + k + '" exclusion'));
    assert(c.retiredHere > 0, 'no retirement in the Bo3 table');
    if (shape === 'te') assert.strictEqual(c.why.noScore, 0, 'the walkover the record leaves out was counted');
    return `bo3 ${c.n} · −3 ${m3.record} · +3 ${p3.record} · out ${JSON.stringify(c.why)} · L52 CH ${base.n}`;
  });

  H.check(tag('D · every line\'s drill counts equal its row record, under every format × role × Window × Tier'), () => {
    const r = drillEqualsRecord(I, p);
    assert(r.opened > 100, 'only ' + r.opened + ' drills opened');
    return r.lines + ' lines, ' + r.opened + ' drill filters opened and reconciled';
  });

  H.check(tag('X · NextGen and match-tiebreak matches are in no line, no tab, under any filter (founder 2026-10-22)'), () => {
    let k = 0;
    each((f, role, win, tier) => {
      rowsOf(I.lineCoverage(p, f, role, { win, tier })).forEach((r) => r.members.forEach((x) => {
        const t = String(x.m.r.tournament || '') + ' ' + String(x.m.r.event || '');
        assert(!/next ?gen|laver cup/i.test(t), [f, role, win, tier, r.label].join('/') + ': ' + t + ' listed');
        k++;
      }));
    });
    return k + ' line memberships checked';
  });

  H.check(tag('U · Surface: Hard + Indoors + Clay + Grass + surface not known = All, every line and result, every format × role × Window × Tier (founder 2026-10-23)'), () => {
    const SURF = ['hard', 'indoors', 'clay', 'grass'];
    let k = 0;
    each((f, role, win, tier) => {
      const all = I.lineCoverage(p, f, role, { win, tier });
      const by = {}; SURF.forEach((x) => { by[x] = I.lineCoverage(p, f, role, { win, tier, surf: x }); });
      rowsOf(all).forEach((r) => {
        // each surface's table holds exactly All's members whose career-record cell is that surface
        const want = {}; SURF.concat(['none']).forEach((x) => { want[x] = { cover: 0, miss: 0, void: 0, retired: 0 }; });
        r.members.forEach((m) => { want[SURF.indexOf(m.m.r.cell) >= 0 ? m.m.r.cell : 'none'][m.res]++; });
        SURF.forEach((x) => {
          const q = rowsOf(by[x]).find((y) => y.label === r.label);
          const got = { cover: q.hit, miss: q.miss, void: q.voids, retired: q.retired };
          assert.deepStrictEqual(got, want[x], [f, role, win, tier, x, r.label].join('/'));
        });
        k++;
      });
    });
    return k + ' lines partitioned by surface';
  });

  H.check(tag('B · the bettable side: As favourite shows only − handicaps, As underdog only +, All every line (founder 2026-10-23)'), () => {
    let k = 0;
    each((f, role, win, tier) => {
      const c = I.lineCoverage(p, f, role, { win, tier });
      const all = I.lineCoverage(p, f, 'all', { win, tier });
      ['Games handicap', 'Set handicap'].forEach((fam) => {
        const labels = c.groups.find((g) => g.title === fam).rows.map((r) => r.label);
        const allLabels = all.groups.find((g) => g.title === fam).rows.map((r) => r.label);
        const ctx = [f, role, win, tier, fam].join('/');
        if (role === 'fav') assert(labels.length && labels.every((l) => l[0] === '−'), ctx + ': ' + labels.join(' '));
        else if (role === 'dog') assert(labels.length && labels.every((l) => l[0] === '+'), ctx + ': ' + labels.join(' '));
        else assert(labels.some((l) => l[0] === '−') && labels.some((l) => l[0] === '+'), ctx + ': All lost a side');
        // the shown side is exactly All's lines of that sign, in All's order
        if (role !== 'all') assert.deepStrictEqual(labels, allLabels.filter((l) => l[0] === (role === 'fav' ? '−' : '+')), ctx);
      });
      ['Total games', 'Match shape'].forEach((fam) => assert.deepStrictEqual(
        c.groups.find((g) => g.title === fam).rows.map((r) => r.label), all.groups.find((g) => g.title === fam).rows.map((r) => r.label)));
      // a hidden line is gone from the page, not dashed
      const html = withState(I, { key: p.key, marketTab: 'lines', lcFmt: f, lcRole: role, lcWin: win, lcTier: tier, lcDrill: null }, () => I.renderLinesTab(p));
      const shown = (html.match(/data-lc-line="([^"]+)"/g) || []).map((x) => x.slice(14, -1));
      assert.deepStrictEqual(shown, c.n ? rowsOf(c).map((r) => r.label) : [], [f, role, win, tier].join('/') + ' rendered lines');   // no match: the empty-state box, no table
      k++;
    });
    return k + ' tables';
  });

  H.check(tag('N · no sample text anywhere; a thin line shows its real rate, dimmed; zero matches is a dash (founder 2026-10-23)'), () => {
    let thin = 0, zero = 0;
    each((f, role, win, tier) => {
      const c = I.lineCoverage(p, f, role, { win, tier });
      const html = withState(I, { key: p.key, marketTab: 'lines', lcFmt: f, lcRole: role, lcWin: win, lcTier: tier, lcDrill: null }, () => I.renderLinesTab(p));
      assert(!/small sample|n\s*[<=]\s*\d|data-pp2-small=|data-pp2-ratemark=/i.test(T(html) + html), [f, role, win, tier].join('/') + ': sample text on the page');
      rowsOf(c).forEach((r) => {
        const ctx = [f, role, win, tier, r.label].join('/');
        const rn = r.hit + r.miss;
        if (!rn) { assert.strictEqual(r.rate, null, ctx + ': zero matches must dash'); zero++; return; }
        assert(Math.abs(r.rate - 100 * r.hit / rn) < 1e-9, ctx + ': rate');
        assert.strictEqual(r.thin, rn < 10, ctx + ': thin flag');
        if (r.thin) {
          thin++;
          const row = html.slice(html.indexOf('data-lc-line="' + r.label + '"'));
          const cell = row.slice(0, row.indexOf('</div>'));
          assert(cell.includes(r.rate.toFixed(1) + '%') && /opacity:0\.4/.test(cell) && !/var\(--pos\)|var\(--neg\)/.test(cell), ctx + ': thin row not dimmed');
        }
      });
    });
    assert(thin > 0 && zero >= 0, 'no thin line in the fixture');
    return thin + ' thin lines dimmed · ' + zero + ' zero-match lines dashed';
  });

  H.check(tag('O · a line opens on the first tab that holds a match; an empty tab says "No matches" (founder 2026-10-23)'), () => {
    let k = 0, empties = 0;
    each((f, role, win, tier) => {
      rowsOf(I.lineCoverage(p, f, role, { win, tier })).forEach((r) => {
        if (!r.n) return;
        const st = { key: p.key, marketTab: 'lines', lcFmt: f, lcRole: role, lcWin: win, lcTier: tier, lcDrill: r.label, lcDrillRes: null };
        const html = withState(I, st, () => I.renderLinesTab(p));
        const on = /data-pp2="lc-drill-res" data-v="(\w+)" aria-pressed="true"/.exec(html)[1];
        const count = { cover: r.hit, miss: r.miss, void: r.voids, retired: r.retired };
        const order = ['cover', 'miss'].concat(r.voidable ? ['void'] : []).concat(['retired']);
        const want = order.find((x) => count[x] > 0);
        assert.strictEqual(on, want, [f, role, win, tier, r.label].join('/') + ': opened on ' + on + ' (' + JSON.stringify(count) + ')');
        // a picked empty tab: one muted line, not a blank panel
        order.filter((x) => count[x] === 0).forEach((x) => {
          const h = withState(I, Object.assign({}, st, { lcDrillRes: x }), () => I.renderLinesTab(p));
          assert(/data-pp2-lc-empty="1"[^>]*>No matches</.test(h), [f, role, win, tier, r.label, x].join('/') + ': empty tab is blank');
          empties++;
        });
        k++;
      });
    });
    return k + ' lines opened · ' + empties + ' empty tabs say "No matches"';
  });

  if (shape === 'te') H.check(tag('V · no provisional source label on a line drill row (the field stays on the row)'), () => {
    const c = I.lineCoverage(p, 'bo3', 'all');
    const row = byLabel(c, '+3 games');
    const m = row.members.find((x) => x.m.r.opp === 'A. Void' || x.m.r.opponent === 'A. Void');
    assert(m && m.m.r.provisional, 'the fixture\'s provisional row is not on the line');
    const html = withState(I, { key: p.key, marketTab: 'lines', lcFmt: 'bo3', lcRole: 'all', lcDrill: '+3 games', lcDrillRes: m.res }, () => I.renderLinesTab(p));
    assert(html.includes('A. Void'), 'the provisional row is not listed');
    assert(!/data-pp2-provisional|provisional ·|not yet in Tennis Explorer/.test(html), 'the provisional label shows on a line drill');
    return 'A. Void (provisional ' + m.m.r.provisional + ') listed on +3 ' + m.res + ' with no source label';
  });

  H.check(tag('H · ±3.5 / ±3 / ±2.5 identities, every format × role × Window × Tier'), () => {
    let k = 0;
    each((f, role, win, tier) => {
      if (f !== 'bo3' || role !== 'all') return;   // the identities read both sides: the All card shows every line
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
      assert.strictEqual(b3.recordN, b3.all + w.otherFmt + w.noScore + w.retired + w.nextgen + w.mtb + w.format + w.unshaped + b3.undated, win + '/' + tier);
      // every retirement sits in exactly one format's table
      assert.strictEqual(b3.retiredHere + b5.retiredHere, w.retired, win + '/' + tier + ': retirements split across the tables');
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
    // the three cards hold a hidden widest-case subtitle in the same cell (their height never follows the numbers)
    const card = withState(I, { key: p.key, marketTab: 'lines', lcWin: 'l52', lcTier: 'chitf', lcFmt: 'bo5' }, () => I.renderLinesTab(p));
    const cards = card.match(/data-pp2="lc-role"[\s\S]*?<\/span><\/span><\/div>/g) || [];
    assert.strictEqual(cards.length, 3, 'cards ' + cards.length);
    cards.forEach((c) => assert(/aria-hidden="true" style="grid-area:1 \/ 1;visibility:hidden;">(?:best of|100% of 9,999)/.test(c), 'a card without its height reserve'));
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
  H.mustFail('a Surface filter that reads the raw feed surface instead of the record\'s cell is caught', () => {
    const m = mutant("return !r.notCounted && (surf === 'all' || r.cell === surf);", "return !r.notCounted && (surf === 'all' || r.surface === surf);");
    const c = m.I.lineCoverage(m.p, 'bo3', 'all');
    ['hard', 'indoors', 'clay', 'grass'].forEach((sf) => {
      const x = m.I.lineCoverage(m.p, 'bo3', 'all', { surf: sf });
      const want = c.groups[0].rows[0].members.filter((y) => y.m.r.cell === sf).length;
      assert.strictEqual(x.groups[0].rows[0].members.length, want, sf);
    });
  });
  H.mustFail('a + line under As favourite (the bettable-side filter removed) is caught', () => {
    const m = mutant("return sel === 'fav' ? spec[3] < 0 : spec[3] > 0;", "return true;");
    const c = m.I.lineCoverage(m.p, 'bo3', 'fav');
    assert(c.groups[0].rows.every((r) => r.label[0] === '−'));
  });
  H.mustFail('sample text under a thin rate (rateOverMark back) is caught', () => {
    const m = mutant("var softRow = false;", "var softRow = r.gate === 'soft';");
    each((f, role, win, tier) => {
      const html = withState(m.I, { key: m.p.key, marketTab: 'lines', lcFmt: f, lcRole: role, lcWin: win, lcTier: tier, lcDrill: null }, () => m.I.renderLinesTab(m.p));
      assert(!/small sample/i.test(T(html)));
    });
  });
  H.mustFail('a drill opening on Covered when Covered is empty is caught', () => {
    const m = mutant("var res = order.indexOf(want) >= 0 ? want : (order.filter(function (k) { return count[k] > 0; })[0] || 'cover');",
      "var res = order.indexOf(want) >= 0 ? want : 'cover';");
    each((f, role, win, tier) => rowsOf(m.I.lineCoverage(m.p, f, role, { win, tier })).forEach((r) => {
      if (!r.n || r.hit) return;
      const html = withState(m.I, { key: m.p.key, marketTab: 'lines', lcFmt: f, lcRole: role, lcWin: win, lcTier: tier, lcDrill: r.label, lcDrillRes: null }, () => m.I.renderLinesTab(m.p));
      assert(!/data-v="cover" aria-pressed="true"/.test(html.slice(html.indexOf('lc-drill-res'))));
    }));
  });
  H.mustFail('the provisional label back on a line drill row is caught', () => {
    const m = mutant("(pg.neutral ? '' : provisionalMark(r))", "provisionalMark(r)");
    const html = withState(m.I, { key: m.p.key, marketTab: 'lines', lcFmt: 'bo3', lcRole: 'all', lcWin: 'career', lcTier: 'all', lcDrill: '+3 games', lcDrillRes: 'cover' }, () => m.I.renderLinesTab(m.p));
    const html2 = withState(m.I, { key: m.p.key, marketTab: 'lines', lcFmt: 'bo3', lcRole: 'all', lcWin: 'career', lcTier: 'all', lcDrill: '+3 games', lcDrillRes: 'void' }, () => m.I.renderLinesTab(m.p));
    assert(!/data-pp2-provisional/.test(html + html2));
  });
  H.mustFail('a tally that reads a void as covered (the list still says Void) is caught', () => {
    const m = mutant("if (h === 'cover') t.hit++; else if (h === 'void') t.voids++;", "if (h === 'cover' || h === 'void') t.hit++;");
    drillEqualsRecord(m.I, m.p);
  });
  H.mustFail('a drill listing the role\'s whole pool (role filter dropped) is caught', () => {
    const m = mutant('t.members.push({ m: sub[j], res: h });', 't.members.push({ m: sub[j], res: h }); if (j === 0 && sub !== pool) pool.forEach(function (q) { var hh = lineResult(q, kind, arg, dir); if (hh !== null && sub.indexOf(q) < 0) t.members.push({ m: q, res: hh }); });');
    drillEqualsRecord(m.I, m.p);
  });
  H.mustFail('a retirement counted in the record (the old exclusion path removed) is caught', () => {
    const m = mutant("        if (lineRetiredFormat(r, sc) === fmt) retPool.push({ sc: sc, g: null, role: roleOf(r), r: r });\n        continue;",
      "        if (lineRetiredFormat(r, sc) === fmt) retPool.push({ sc: sc, g: null, role: roleOf(r), r: r });\n        if (!sc) continue;");
    drillEqualsRecord(m.I, m.p);
  });
  H.mustFail('a drill that paints the match result green / red again is caught', () => {
    const m = mutant("(pg.neutral ? '' : cell(", "(pg.neutral ? cell('background:' + wl + ';', '') : cell(");
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
