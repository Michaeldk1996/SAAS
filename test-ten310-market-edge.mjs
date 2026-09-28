// TEN-310 — Match analysis → Market edge tab. Runs the page's own data layer and renderer (sliced out of
// bsp-consult-dashboard.html) and the real market-edge-core.js over committed snapshots of the deployed
// career-history + match-closes shards (Sinner 2072, Alcaraz 2382; tools/fixtures/ten310/). No gitignored
// store is read. Brief §6 checks 1–7, plus the §4 edge cases.
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildUI, HTML, CORE_PATH, slice, constSrc } from './tools/ten310-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FX = join(HERE, 'tools/fixtures/ten310');
const rd = (f) => JSON.parse(readFileSync(join(FX, f), 'utf8'));
// `--mutant-run` = the child the mutation test spawns: run checks 1–6 once, register no tests.
const MUTANT = process.argv.includes('--mutant-run');
const test = MUTANT ? () => {} : nodeTest;
const MINUS = '−';

// ---- rendered-HTML readers (text as the user sees it) ----
const texts = (html) => html.replace(/<[^>]*>/g, '\u0001').split('\u0001').map((s) => s.trim()).filter(Boolean);
function chunk(html, attr, key) {
  const at = html.indexOf(`${attr}="${key}"`);
  if (at < 0) return null;
  const i = html.lastIndexOf('<', at);          // from the row's own opening tag
  let j = html.indexOf(`${attr}="`, at + attr.length + key.length + 3); if (j >= 0) j = html.lastIndexOf('<', j);
  return html.slice(i, j < 0 ? html.length : j);
}
const unitsOf = (s) => (s === '—' ? null : (s.startsWith(MINUS) ? -1 : 1) * parseFloat(s.replace(/^[+−±]/, '')));
function bandRow(html, key) {
  const c = chunk(html, 'data-me-band', key); if (!c) return null;
  const t = texts(c.slice(c.indexOf('>') + 1)).filter((x) => x !== 'TODAY');
  const [w, l] = t[1].split('–').map(Number);
  return { label: t[0], today: c.includes('>TODAY<'), w, l, won: t[2], needs: t[3], u: unitsOf(t[4]), uTxt: t[4], clickable: /onclick="meSet\(\{meBand:/.test(c.slice(0, c.indexOf('>'))), raw: c };
}
function lineRow(html, key) {
  const c = chunk(html, 'data-me-line', key); if (!c) return null;
  const t = texts(c.slice(c.indexOf('>') + 1));
  const cell = (s) => { const m = /^(\d+)\/(\d+) · (\d+)%$/.exec(s); const d = /^— · n=(\d+)$/.exec(s); return m ? { c: +m[1], n: +m[2], pct: +m[3] } : d ? { c: null, n: +d[1], pct: null } : null; };
  return { label: t[0], all: cell(t[1]), band: cell(t[2]), diff: t[3] || '' };
}
function legend(html) {
  const out = [];
  const re = /(\d+) priced<\/span>(?:<span[^>]*>([^<]*)<\/span>)?/g; let m;
  while ((m = re.exec(html))) out.push({ n: +m[1], end: m[2] ? unitsOf(m[2]) : null });
  return out;
}
function series(html, k) {
  const m = new RegExp(`data-me-series="${k}" points="([^"]*)"`).exec(html);
  return m ? m[1].split(' ').map((p) => p.split(',').map(Number)) : null;
}
// y (viewBox 0..200) → units, from two rendered y-axis labels
function yToUnits(html) {
  const re = /top:([\d.]+)%; transform:translateY\(-50%\); font-family:'IBM Plex Mono',monospace; font-size:11.5px; font-weight:500;[^>]*>([^<]*)</g;
  const g = []; let m; while ((m = re.exec(html))) g.push({ y: +m[1] * 2, v: m[2] === '0' ? 0 : unitsOf(m[2].replace(/u$/, '')) });
  assert.ok(g.length >= 2, 'two y labels');
  const [a, b] = [g[0], g[g.length - 1]];
  return (y) => a.v + (y - a.y) * (b.v - a.v) / (b.y - a.y);
}
function stat(html, l) { const m = new RegExp(`data-me-stat="${l}"[^>]*>([^<]*)<`).exec(html); return m ? m[1] : null; }

// ---- the fixture match: Sinner (A, 1.54) v Alcaraz (B, 2.62) — the design's own demo prices ----
const M = { id: 'upcoming-x', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: 2072, p2Key: 2382, date: '2026-09-27',
  tour: 'ATP Beijing', tournamentRound: 'ATP Beijing - Final', tourBadge: 'ATP',
  bestOdds: { p1: { price: 1.54 }, p2: { price: 2.62 } } };
function load(ui) {
  return [['2072', 'J. Sinner'], ['2382', 'C. Alcaraz']].map(([k, n]) => ui.meRowsFor(rd(`career-history-${k}.json`).matches, ui.fhParseCloses(rd(`match-closes-${k}.json`)), k, n));
}
// Independent oracle for the mutation check: its own band edges and its own P&L, from the rows.
const EDGES = [1.01, 1.21, 1.41, 1.65, 2.0, 2.5, 3.5, 6.0, Infinity];
function oracle(rows, scope, refDay) {
  const pr = rows.filter((r) => r.day != null && r.day < refDay && (scope === 'career' || r.day >= refDay - 364)
    && !r.wo && r.book && r.price != null && r.oppPrice != null && r.price >= 1.01);   // TEN-312 ruling A: retirements settle
  const bands = EDGES.slice(0, -1).map(() => ({ w: 0, l: 0, cents: 0 }));
  pr.forEach((r) => { const p = Math.round(r.price * 1000) / 1000; const i = EDGES.findIndex((e, k) => p >= e && p < EDGES[k + 1]);
    const b = bands[i]; if (r.won) b.w++; else b.l++; b.cents += r.won ? Math.round(r.price * 100) - 100 : -100; });
  return { n: pr.length, bands };
}

// Checks 1–5 for one render, one player, one scope. Throws AssertionError on any mismatch.
function checkPlayer(ui, R, k, rows, scope) {
  const core = ui.core, refDay = Date.UTC(2026, 8, 27) / 86400000, i = k === 'a' ? 0 : 1;
  const bands = [0, 1, 2, 3, 4, 5, 6, 7].map((b) => bandRow(R.html, k + b));
  assert.ok(bands.every(Boolean), 'eight band rows');
  const O = oracle(rows, scope, refDay);
  // the oracle: every band's record and 1u stake
  bands.forEach((b, j) => {
    assert.equal(b.w, O.bands[j].w, `${k}${j} ${scope} wins`); assert.equal(b.l, O.bands[j].l, `${k}${j} ${scope} losses`);
    if (b.w + b.l) assert.equal(b.u, Number(meRound(O.bands[j].cents / 100)), `${k}${j} ${scope} 1u`);
  });
  const leg = legend(R.html)[i];
  // (2) Σ band n = legend "N priced"; Σ band 1u = legend end = chart end (0.1u)
  const sumN = bands.reduce((s, b) => s + b.w + b.l, 0);
  assert.equal(sumN, leg.n, 'Σ band n = N priced'); assert.equal(sumN, O.n, 'N priced = oracle');
  const sumU = O.bands.reduce((s, b) => s + b.cents, 0) / 100;
  if (sumN) {
    assert.ok(Math.abs(leg.end - sumU) <= 0.05 + 1e-9, `legend end ${leg.end} vs Σ ${sumU}`);
    assert.ok(Math.abs(bands.reduce((s, b) => s + (b.u || 0), 0) - sumU) <= 0.05 * 8 + 1e-9, 'Σ rendered band 1u ≈ Σ');
    const pts = series(R.html, k), y2u = yToUnits(R.html);
    assert.ok(Math.abs(y2u(pts[pts.length - 1][1]) - sumU) <= 0.1, `chart end ${y2u(pts[pts.length - 1][1])} vs ${sumU}`);
    // (6) points in date order on the shared axis
    for (let j = 1; j < pts.length; j++) assert.ok(pts[j][0] >= pts[j - 1][0], 'x never goes back in time');
  } else assert.equal(leg.end, null, 'no end value on 0 priced');
  // (1) Σ band W vs "Wins match" All numerator: band = every priced played match (Bo5 incl.), lines =
  //     completed Bo3 only. The documented difference = the wins among priced rows that are not Bo3-complete.
  const wins = lineRow(R.html, `${k}|0`);
  assert.equal(wins.label, 'Wins match');
  const priced = rows.filter((r) => core.inScope(r, scope, refDay) && core.inWinner(r));
  const notBo3 = priced.filter((r) => !core.inBo3(r));
  assert.equal(wins.all.n, sumN - notBo3.length, 'lines denominator = priced − not-Bo3');
  if (wins.all.c != null) assert.equal(bands.reduce((s, b) => s + b.w, 0) - wins.all.c, notBo3.filter((r) => r.won).length, 'Σ band W − Wins match = wins outside Bo3');
  // (3) band pop-up = its row; pop-up row count = band n
  bands.forEach((b, j) => {
    const n = b.w + b.l;
    if (!n) { assert.ok(!b.clickable, 'n = 0 band not clickable'); assert.equal(b.won, '—'); assert.equal(b.uTxt, '—'); return; }
    assert.ok(b.clickable, 'band with rows is clickable');
    const P = R.band(k + j);
    assert.equal(stat(P, 'Record'), `W${b.w}–L${b.l}`);
    assert.equal(stat(P, 'At 1u flat'), b.uTxt);
    assert.equal((P.match(/data-me-row="/g) || []).length, n, 'pop-up rows = band n');
    const y = stat(P, 'Yield');
    if (n < core.ME_THIN_FLOOR) assert.equal(y, '—'); else assert.ok(Math.abs(unitsOf(y.replace('%', '')) - b.u / n * 100) <= 5 / n + 0.051, `yield ${y} vs ${b.u}/${n}`);
    if (n < core.ME_THIN_FLOOR) assert.equal(b.won, '—', 'thin sample dashes Won'); else assert.equal(b.won, Math.round(b.w / n * 100) + '%');
  });
  // (4) line pop-up "Covered x of n" = the card's All / In band cell; (5) today's band = "In band = …"
  const today = bands.findIndex((b) => b.today);
  const lbl = [...R.html.matchAll(/In band = ([^<]*) · n=(\d+)/g)][i];
  assert.ok(today >= 0 && lbl, 'a TODAY band and an In band label');
  assert.equal(lbl[1], bands[today].label, 'today band = In band label');
  for (let li = 0; li < 6; li++) {
    const L = lineRow(R.html, `${k}|${li}`);
    const all = stat(R.line(`${k}|${li}`, 'all'), 'Covered'), band = stat(R.line(`${k}|${li}`, 'band'), 'Covered');
    assert.equal(all, `${L.all.c != null ? L.all.c : coveredOf(ui, R, k, li, 'all')} of ${L.all.n}`, `line ${k}|${li} all`);
    assert.equal(+band.split(' of ')[1], L.band.n, `line ${k}|${li} in-band n`);
    assert.equal(+band.split(' of ')[1], +lbl[2], 'In band n = pop-up n');
    if (L.band.c != null) assert.equal(band, `${L.band.c} of ${L.band.n}`);
  }
}
const meRound = (v) => ((v < 0 ? -1 : 1) * Math.round(Math.abs(v) * 10 + 1e-7) / 10).toFixed(1);
function coveredOf(ui, R, k, li, sc) { const M = R.MM[k === 'a' ? 0 : 1]; const L = M.lines; const list = sc === 'band' ? L.inBand : L.all; return list.filter(L.rows[li].fn).length; }

// TEN-312 retirement ruling A (founder 2026-09-28, TEN-325): an in-match retirement settles the match-winner bet at its
// listed close — a win at the winner's price, a loss at the retiree's — in the bands, legend and chart; it never enters the
// Derived lines (its unfinished set is not a completed set). Row 0: Tennis-Data says Retired, the feed missed it and the
// stored score looks complete, so only the settlement flag keeps it out of the lines. Row 1: his own retirement (feed flag).
function settlementChecks(ui) {
  const core = ui.core, day = (d) => Date.parse(d + 'T00:00:00Z') / 86400000;
  const ch = [
    { date: '2026-03-01', level: 'atp', tournament: 'Doha', round: 'R32', opponent: 'X. Alpha', result: '2 - 0', won: true, eventKey: 11, src: 'fixtures', sets: [{ p: 6, o: 4 }, { p: 6, o: 3 }] },
    { date: '2026-03-03', level: 'atp', tournament: 'Doha', round: 'R16', opponent: 'Y. Beta', result: '0 - 1', won: false, eventKey: 12, src: 'fixtures', retired: true, sets: [{ p: 4, o: 6 }, { p: 1, o: 2 }] },
    { date: '2026-03-05', level: 'atp', tournament: 'Doha', round: 'QF', opponent: 'Z. Gamma', result: '2 - 0', won: true, eventKey: 13, src: 'fixtures', sets: [{ p: 6, o: 2 }, { p: 6, o: 2 }] },
  ];
  const cl = ui.fhParseCloses({ rows: [['2026-03-01', 'Alpha X.', 1, 1.5, 2.6, null, null, 1, null], ['2026-03-03', 'Beta Y.', 0, 1.8, 2.1, null, null, 1, null],
    ['2026-03-05', 'Gamma Z.', 1, 1.4, 3.1, null, null, 0, null]], cap: [] });
  const rows = ui.meRowsFor(ch, cl, '9', 'A. Test');
  assert.deepEqual(rows.map((r) => r.retSettle), [true, true, false], 'settlement flag = Tennis-Data Retired or the feed flag');
  const M = core.playerModel(rows, { scope: 'career', refDay: day('2026-04-01') });
  assert.equal(M.priced.length, 3, 'ruling A: both retirements are priced matches');
  assert.equal(Math.round(M.units * 100), -10, 'settled at the close: +0.50 (retired win at 1.50) −1 (he retired) +0.40 = −0.10u');
  const b = M.bands[core.bandOf(1.5)];
  assert.deepEqual([b.n, b.plCents], [1, 50], 'a retired win at 1.50 adds 1 to its band and +0.50u');
  assert.deepEqual(M.bo3.map((r) => r.date), ['2026-03-05'], 'Derived lines: a retirement never counts, even with a complete-looking score');
  assert.equal(core.whyNotBo3(rows[0]), 'retired');
  // the Match winner view reads the profile rows: a profile row marked ret is settled and keeps its mark
  const win = ui.meWinnerRows({ matches: [{ date: '2026-03-01', event: 'Doha', surface: 'Hard', round: '1st Round', opp: 'Alpha X.', won: true, price: 1.5, oppPrice: 2.6,
    book: 'pinnacle', inBasis: true, ret: true }] }, rows, '9', 'A. Test');
  assert.equal(win[0].retSettle, true, 'the profile row keeps its retirement mark');
  assert.equal(core.playerModel(rows, { scope: 'career', refDay: day('2026-04-01'), winnerRows: win }).priced.length, 1, 'and is settled');
}

function runChecks(src) {
  const ui = buildUI(src ? { src } : {});
  settlementChecks(ui);
  const rows = load(ui);
  // the fixture holds priced retirements, so the oracle's settlement is exercised on real rows too
  assert.ok(rows[0].filter((r) => r.retSettle && ui.core.inWinner(r)).length >= 5, 'Sinner fixture: priced retirements present');
  for (const scope of ['career', 'l52']) {
    const R = ui.render(M, { meScope: scope, meView: 'winner' }, rows);
    const RL = ui.render(M, { meScope: scope, meView: 'lines' }, rows);
    const both = Object.assign({}, R, { html: R.html + RL.html });
    checkPlayer(ui, both, 'a', rows[0], scope);
    checkPlayer(ui, both, 'b', rows[1], scope);
  }
  return { ui, rows };
}

test('§6 checks 1–6: bands, legend, chart, pop-ups and lines agree — Sinner + Alcaraz, both scopes', () => {
  const { ui, rows } = runChecks();
  // the fixture is not empty: every check above ran on real rows
  const R = ui.render(M, { meScope: 'career', meView: 'winner' }, rows);
  const lg = legend(R.html);
  assert.ok(lg[0].n > 300 && lg[1].n > 300, `career priced ${lg[0].n} / ${lg[1].n}`);
  // (6) a player whose first priced match is later starts right of the left edge (Alcaraz 2020 v Sinner 2019)
  const a = series(R.html, 'a'), b = series(R.html, 'b');
  assert.equal(a[0][0], 0, 'Sinner starts at the left edge');
  assert.ok(b[0][0] > 50, `Alcaraz starts right of the edge (x=${b[0][0]})`);
  // scope switch recomputes the counts and the axis labels
  const R52 = ui.render(M, { meScope: 'l52', meView: 'winner' }, rows);
  assert.ok(legend(R52.html)[0].n < lg[0].n, 'l52 is a subset');
  const xl = (h) => { const i = h.indexOf('class="me-xlabels"'); return texts(h.slice(h.indexOf('>', i) + 1)).slice(0, 6); };
  assert.deepEqual(xl(R.html).map((s) => /^\d{4}$/.test(s)), [true, true, true, true, true, true], 'career labels are years');
  assert.ok(xl(R52.html).every((s) => /^[A-Z][a-z]{2}$/.test(s)), 'l52 labels are months');
  assert.equal(xl(R.html)[0], '2019', 'first label = first priced year');
});

test('§6 check 7: one-line mutants of the band bucketing / P&L make checks 1–3 fail', () => {
  const core = readFileSync(CORE_PATH, 'utf8');
  const MUT = [
    ['bucketing: closed upper edge', 'if (m >= BANDS[i].lo && m < BANDS[i].hi) return i;', 'if (m > BANDS[i].lo && m <= BANDS[i].hi) return i;'],
    ['bucketing: 1.01 band ends at 1.19', "lo: 1010, hi: 1210", "lo: 1010, hi: 1200"],
    ['P&L: win pays the price, not price − 1', 'return r.won ? Math.round(Number(r.price) * 100) - 100 : -100;', 'return r.won ? Math.round(Number(r.price) * 100) : -100;'],
    ['P&L: loss costs nothing', 'return r.won ? Math.round(Number(r.price) * 100) - 100 : -100;', 'return r.won ? Math.round(Number(r.price) * 100) - 100 : 0;'],
    ['record: wins counted as losses', 'rows.forEach((r) => { if (r.won) w++;', 'rows.forEach((r) => { if (!r.won) w++;'],
    // TEN-312 retirement ruling A (TEN-325): a retirement settles the match-winner bet, never the derived lines
    ['settlement: retirements unsettled again', "    if (bandOf(r.price) < 0) return 'unpriced';\n    return '';", "    if (r.retSettle) return 'retired';\n    if (bandOf(r.price) < 0) return 'unpriced';\n    return '';"],
    ['derived lines: retirements admitted', "    if (r.retSettle) return 'retired';\n    if (r.alt) return 'format';", "    if (r.alt) return 'format';"],
  ];
  const dir = mkdtempSync(join(tmpdir(), 'ten310-mut-'));
  // control: the unmutated core must pass the same child run, or a "caught" mutant proves nothing
  const ctl = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--mutant-run'], { encoding: 'utf8' });
  assert.equal(ctl.status, 0, `control run must pass: ${(ctl.stderr || '').slice(0, 300)}`);
  let caught = 0;
  for (const [name, from, to] of MUT) {
    assert.equal(core.split(from).length, 2, `mutant anchor present once: ${name}`);
    const p = join(dir, 'core.js'); writeFileSync(p, core.replace(from, to));
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--mutant-run'], { env: Object.assign({}, process.env, { TEN310_CORE: p }), encoding: 'utf8' });
    assert.equal(r.status, 3, `mutant "${name}" must fail an assertion (exit 3), got ${r.status}: ${(r.stderr || '').slice(0, 300)}`);
    caught++;
  }
  console.log(`# mutants: ${caught} caught, 0 survived`);
});

test('§4 edge cases: half-open bands, 2.00 is underdog, match-tiebreak is not a set, floors, dashes', () => {
  const ui = buildUI(), core = ui.core;
  assert.equal(core.bandOf(1.205), 0); assert.equal(core.bandOf(1.21), 1); assert.equal(core.bandOf(1.2), 0);
  assert.equal(core.bandOf(1.649), 2); assert.equal(core.bandOf(1.65), 3); assert.equal(core.bandOf(1.999), 3);
  assert.equal(core.bandOf(2.0), 4); assert.equal(core.isFavPrice(2.0), false); assert.equal(core.bandOf(6.0), 7);
  assert.equal(core.bandOf(1.0), -1); assert.equal(core.bandOf(null), -1);
  // career rows → rows: a 10-8 match-tiebreak decider is a non-standard format, never a tiebreak set
  const ch = [
    { date: '2026-03-01', level: 'atp', tournament: 'Doha', round: 'R32', opponent: 'X. Alpha', result: '2 - 1', won: true, eventKey: 1, src: 'fixtures', sets: [{ p: 6, o: 4 }, { p: 4, o: 6 }, { p: 10, o: 8 }] },
    { date: '2026-03-03', level: 'atp', tournament: 'Doha', round: 'R16', opponent: 'Y. Beta', result: '2 - 0', won: true, eventKey: 2, src: 'fixtures', sets: [{ p: 7, o: 6, pTb: 7, oTb: 5 }, { p: 6, o: 3 }] },
    { date: '2026-03-05', level: 'atp', tournament: 'Doha', round: 'QF', opponent: 'Z. Gamma', result: '2 - 0', won: true, eventKey: 3, src: 'fixtures', sets: [{ p: 6, o: 2 }] },
    { date: '2026-03-07', level: 'atp', tournament: 'Doha', round: 'SF', opponent: 'W. Delta', result: '-', won: true, eventKey: 4, src: 'fixtures', walkover: true },
  ];
  const cl = ui.fhParseCloses({ rows: [
    ['2026-03-01', 'Alpha X.', 1, 2.0, 1.8, null, null, 0, null], ['2026-03-03', 'Beta Y.', 1, 1.205, 4.5, null, null, 0, null],
    ['2026-03-05', 'Gamma Z.', 1, 1.5, 2.6, null, null, 0, null]], cap: [] });
  const rows = ui.meRowsFor(ch, cl, '9', 'A. Test');
  assert.equal(core.whyNotBo3(rows[0]), 'format', '10-8 decider');
  assert.equal(core.lineDefs(true, 'Test')[5][1](rows[1]), true, '7-6 is a tiebreak');
  assert.equal(core.whyNotBo3(rows[2]), 'set scores incomplete', '"2 - 0" with one stored set');
  assert.equal(core.whyNotPriced(rows[2]), '', 'its result still settles the match-winner bet');
  assert.equal(core.whyNotPriced(rows[3]), 'walkover');
  assert.equal(rows[0].price, 2.0); assert.equal(core.bandOf(rows[0].price), 4, '2.00 sits in the underdog ladder');
  // render: thin samples, n = 0 bands, one player with no priced matches, no header price
  const empty = Object.assign([], { notTour: 0 });
  const m = { id: 'x', p1: 'A. Test', p2: 'B. None', p1Key: 9, p2Key: 10, date: '2026-09-27', tour: 'ATP Chengdu', tourBadge: 'ATP', bestOdds: { p1: { price: 1.21 }, p2: { price: 4.4 } } };
  const R = ui.render(m, { meView: 'winner' }, [rows, empty]);
  const b1 = bandRow(R.html, 'a0');   // the 1.205 row: 1.01 – 1.20
  assert.deepEqual([b1.w, b1.l, b1.won], [1, 0, '—'], 'n < 5: W–L kept, Won dashed'); assert.equal(b1.uTxt, '+0.2u', '1u still shown (a sum)');
  assert.ok(bandRow(R.html, 'a1').today && bandRow(R.html, 'a1').w + bandRow(R.html, 'a1').l === 0, 'header 1.21 = TODAY on 1.21 – 1.40');
  const b0 = bandRow(R.html, 'b0');
  assert.deepEqual([b0.w, b0.l, b0.won, b0.uTxt, b0.clickable], [0, 0, '—', '—', false]);
  assert.ok(b0.raw.includes(`color:var(--ma-t2);">—<`), 'n = 0 1u dash in the muted colour (ME_C.m1, TEN-314 token)');
  const lg = legend(R.html);
  assert.equal(lg[1].n, 0); assert.equal(lg[1].end, null); assert.equal(series(R.html, 'b'), null, 'no line for 0 priced');
  const RL = ui.render(m, { meView: 'lines' }, [rows, empty]);
  assert.deepEqual(lineRow(RL.html, 'b|0').all, { c: null, n: 0, pct: null }, 'no data = dash, not 0%');
  // no price in the header: no TODAY anywhere, derived lines show the empty state, match winner still renders
  const done = Object.assign({}, m, { finalScore: { p1Sets: 2, p2Sets: 0 } });
  const RN = ui.render(done, { meView: 'lines' }, [rows, empty]);
  assert.ok(RN.html.includes('Derived lines need today’s price.')); assert.ok(!RN.html.includes('data-me-line='));
  const RW = ui.render(done, { meView: 'winner' }, [rows, empty]);
  assert.ok(!RW.html.includes('>TODAY<') && RW.html.includes('data-me-band="a0"'));
  // loading: frames + column headers + a muted Loading… row, at the loaded height
  const RLd = ui.render(m, { meView: 'winner' }, [null, null]);
  assert.ok(RLd.html.includes('Loading…') && RLd.html.includes('>1u stake<') && RLd.html.includes('min-height:282px'));
  // real figures never wear the sample-data pill; signed figures use U+2212 and ±0
  assert.ok(!/sample data/i.test(R.html + R.band('a0') + RL.html), 'no "sample data" anywhere');
  assert.ok(R.html.includes('>CLOSING ODDS<'));
  assert.equal(ui.render(m, {}, [rows, empty]).E && true, true);
});

test('wiring: Market edge is the last tab after Odds; today = the header price; lazy load; not in Download report', () => {
  const r0 = HTML.indexOf('<div class="asidenav" id="aTabs">'), rail = HTML.slice(r0, HTML.indexOf('asidenav-download', r0));
  const tabs = [...rail.matchAll(/data-atab="([a-z0-9]+)"/g)].map((x) => x[1]);
  assert.deepEqual(tabs.slice(-2), ['odds', 'marketedge']); assert.equal(tabs.length, 12);
  assert.ok(rail.includes('<path d="M4 16l4-5 3 3 5-7 4 5M4 20h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path></svg></span>Market edge</div>'));
  assert.equal((HTML.match(/data-atab="marketedge"/g) || []).length, 1, 'one entry');
  // the header pills and the tab read one function
  assert.ok(/const ho = aHeaderOdds\(m\);\s*p1Pill\.textContent = ho\.p1;\s*p2Pill\.textContent = ho\.p2;/.test(HTML));
  const ui = buildUI();
  assert.deepEqual(ui.aHeaderOdds(M), { p1: '1.54', p2: '2.62' });
  assert.deepEqual(ui.aHeaderOdds(Object.assign({}, M, { live: true, liveScore: [{ p1: 1, p2: 0 }] })), { p1: '', p2: '' });
  // loaded only when the tab opens, never at modal open; never the monolithic profiles file
  // TEN-314: every tab builds on its first open (A_TAB_BUILD); the modal open itself loads nothing of Market edge
  const open = slice('openAnalysisModal');
  assert.ok(!/meLoad\(|openMarketEdgeTab\(\)/.test(open), 'no load at modal open');
  assert.ok(HTML.includes('  marketedge(m){ openMarketEdgeTab(); },'));
  const block = HTML.slice(HTML.indexOf('TEN-310 · MATCH ANALYSIS → MARKET EDGE TAB'), HTML.indexOf('/* ---------- TOURNAMENT SUB-TAB'));
  // ruling B: the one fetch of its own is the per-player profile shard, market-edge/{key}.json, inside meLoadProfileShard
  const own = slice('meLoadProfileShard');
  assert.ok(!block.includes('player-profiles.json') && !/fetch\(/.test(block.replace(own, '')), 'the tab fetches only through the lazy loaders');
  assert.equal((own.match(/fetch\(/g) || []).length, 1); assert.ok(own.includes('fetch(`./market-edge/${encodeURIComponent(k)}.json`'), 'only the per-player profile shard');
  const print = HTML.slice(HTML.indexOf('.modal-analysis.printing .asection{'), HTML.indexOf('.modal-analysis.printing .asection{') + 400);
  assert.ok(print.includes('.modal-analysis.printing #aSectionMarketEdge, .modal-analysis.printing #mePop{ display:none !important; }'), 'kept out of Download report (static print CSS)');
  assert.ok(slice('aBuildForReport').includes("if (t === 'marketedge' || _aBuilt.has(t)) return;"), 'the report never builds Market edge');
  assert.ok(/<script src="market-edge-core\.js"><\/script>/.test(HTML));
});

if (process.argv.includes('--mutant-run')) {
  try { runChecks(); process.exit(0); } catch (e) { process.exit(e instanceof assert.AssertionError || e.code === 'ERR_ASSERTION' ? 3 : 4); }
}

test('pinned headline figures on the frozen fixtures (Career / Last 52 weeks, ref 2026-09-27)', () => {
  const ui = buildUI(), rows = load(ui), refDay = Date.UTC(2026, 8, 27) / 86400000;
  const pick = (M) => [M.priced.length, M.book.P, M.book.B, M.bo3.length, Math.round(M.units * 100), M.bands[0].w, M.bands[0].l];
  // [priced, Pinnacle, Bet365, Bo3, units×100, 1.01–1.20 W, L] — recomputed independently by the TEN-310 review.
  // TEN-312 retirement ruling A (TEN-325): the career-row path now settles its 11 / 11 / 1 / 0 priced retirements
  // (was Sinner 382 · +22.40u, Alcaraz 330 · +23.55u, Sinner L52 59 · +2.35u); Bo3 (Derived lines) is unchanged.
  assert.deepEqual(pick(ui.core.playerModel(rows[0], { scope: 'career', refDay })), [393, 341, 52, 269, 1608, 196, 11]);
  assert.deepEqual(pick(ui.core.playerModel(rows[1], { scope: 'career', refDay })), [341, 303, 38, 226, 2319, 166, 20]);
  assert.deepEqual(pick(ui.core.playerModel(rows[0], { scope: 'l52', refDay })).slice(0, 5), [60, 13, 47, 48, 135]);
  assert.deepEqual(pick(ui.core.playerModel(rows[1], { scope: 'l52', refDay })).slice(0, 5), [38, 8, 30, 27, -279]);
});

test('meLoad: a failed closes fetch or a missing player key is unknown history, never "0 priced"', async () => {
  const ui = buildUI();
  const run = async ({ key, closes, profile, wantWin }) => {
    const env = new Function('ui', 'cls', 'prof', `
      let _me = null; const _careerHistoryShards = {}, _fhCl = {}, _meShard = {};
      const loadCareerHistory = k => { _careerHistoryShards[String(k)] = []; return Promise.resolve([]); };
      const fhLoadCloses = k => { if (cls === 'ok') _fhCl[String(k)] = null; return Promise.resolve(null); };   // 'ok' = answered (404, no shard); else a failed fetch
      const meLoadProfileShard = k => { if (prof !== 'failed') _meShard[String(k)] = prof === '404' ? { matches: [], missing: true } : { matches: [] }; return Promise.resolve(prof === 'failed' ? null : _meShard[String(k)]); };
      const meRowsFor = ui.meRowsFor, meWinnerRows = ui.meWinnerRows, meRender = () => {};
      ${slice('meStateFor')}
      ${slice('meLoad')}
      return { go: m => { meLoad(m); return new Promise(r => setTimeout(() => r(_me.state.slice()), 20)); },
               win: () => _me.data.map(d => !!(d && Array.isArray(d.win))) };
    `)(ui, closes, profile);
    const st = await env.go({ id: 'x', p1: 'A', p2: 'B', p1Key: key, p2Key: 7, date: '2026-09-27' });
    return wantWin ? env.win() : st;
  };
  assert.deepEqual(await run({ key: 5, closes: 'failed' }), ['failed', 'failed']);
  assert.deepEqual(await run({ key: 5, closes: 'ok' }), ['ready', 'ready']);
  assert.deepEqual(await run({ key: 5, closes: 'ok', profile: 'failed' }), ['failed', 'failed'], 'a failed profile-shard fetch is a failure, never "0 priced"');
  assert.deepEqual(await run({ key: 5, closes: 'ok', profile: '404' }), ['none', 'none'], 'no profile Market edge → dashes, like the profile');
  assert.deepEqual(await run({ key: 5, closes: 'ok', wantWin: true }), [true, true], 'ruling B wiring: every ready player carries the profile rows');
  assert.deepEqual((await run({ key: null, closes: 'ok' }))[0], 'none');
  // and what the page shows for them
  const R = ui.render({ id: 'x', p1: 'A. One', p2: 'B. Two', p1Key: 5, p2Key: 7, date: '2026-09-27', bestOdds: { p1: { price: 1.5 }, p2: { price: 2.6 } } },
    { meView: 'winner' }, [null, null], ['failed', 'none']);
  assert.ok(!/\d+ priced/.test(R.html), 'no "N priced" for unknown history');
  assert.ok(R.html.includes('History unavailable') && R.html.includes('No history on file for this player.'));
});

test('R7: Derived lines only on a standard best-of-3 match — format from matches.json tour / tournamentRound / tourBadge', () => {
  const ui = buildUI(), rows = load(ui), fmt = ui.core.matchFormat;
  const base = { id: 'x', p1: 'J. Sinner', p2: 'C. Alcaraz', p1Key: 2072, p2Key: 2382, date: '2026-09-27', bestOdds: { p1: { price: 1.54 }, p2: { price: 2.62 } } };
  const CASES = [
    ['Slam R1', { tour: 'ATP US Open', tournamentRound: 'ATP US Open - 1/64-finals', tourBadge: 'ATP' }, false, 'best-of-5'],
    ['Laver Cup', { tour: 'ATP Laver Cup', tournamentRound: '', tourBadge: 'ATP' }, false, 'non-standard'],
    ['NextGen', { tour: 'ATP Next Gen Finals - Jeddah', tournamentRound: 'ATP Next Gen Finals - Jeddah - Group A', tourBadge: 'ATP' }, false, 'non-standard'],
    ['regular ATP 250', { tour: 'ATP Chengdu', tournamentRound: 'ATP Chengdu - Semi-finals', tourBadge: 'ATP' }, true, 'atp-tour'],
    ['unknown format (no tournament name)', { tour: '', tournamentRound: '', tourBadge: 'ATP' }, false, 'unknown'],
    ['unknown format (not badged ATP)', { tour: 'Chengdu', tournamentRound: '', tourBadge: '' }, false, 'unknown'],
    // the feed's real qualifying shape (US Open 2026, upcoming-12157210): round null → can't tell → not best-of-3
    ['Slam, round missing (feed qualifying shape)', { tour: 'ATP US Open', tournamentRound: null, tourBadge: 'ATP' }, false, 'unknown'],
    ['Slam R1, hyphenated name', { tour: 'ATP Roland-Garros', tournamentRound: 'ATP Roland-Garros - 1/64-finals', tourBadge: 'ATP' }, false, 'best-of-5'],
    ['Slam qualifying (best-of-3)', { tour: 'ATP US Open', tournamentRound: 'ATP US Open - Qualification - 1/16-finals', tourBadge: 'ATP' }, true, 'slam-qualifying'],
    ['Davis Cup', { tour: 'Davis Cup - World Group', tournamentRound: '', tourBadge: 'ATP' }, false, 'non-standard'],
    ['United Cup', { tour: 'ATP United Cup', tournamentRound: '', tourBadge: 'ATP' }, false, 'non-standard'],
  ];
  for (const [name, f, bo3, reason] of CASES) {
    const m = Object.assign({}, base, f);
    assert.deepEqual(fmt(m), { bo3, reason }, name);
    const RL = ui.render(m, { meView: 'lines' }, rows);          // the default view stays Derived lines
    assert.equal(RL.html.includes('Derived lines cover best-of-3 matches only.'), !bo3, `${name}: empty state`);
    assert.equal(RL.html.includes('data-me-line='), bo3, `${name}: line rows`);
    assert.ok(RL.html.includes('>Derived lines<'), `${name}: the view is not switched`);
    const RW = ui.render(m, { meView: 'winner' }, rows);          // Match winner is unchanged for every format
    assert.equal((RW.html.match(/data-me-band="/g) || []).length, 16, `${name}: bands render`);
    assert.ok(/\d+ priced/.test(RW.html), `${name}: chart legend renders`);
  }
  // the format gate outranks the price gate: a Slam with no header price still says best-of-3
  const noPx = ui.render(Object.assign({}, base, CASES[0][1], { bestOdds: null }), { meView: 'lines' }, rows).html;
  assert.ok(noPx.includes('Derived lines cover best-of-3 matches only.') && !noPx.includes('Derived lines need today'));
});

// ---- ruling B (founder, 2026-09-28): the Match winner view reads the player-profile Market edge rows ----
// Fixtures market-edge-{key}.json = the profile builder's own output (captured-Pinnacle-first order) over the
// deployed inputs of 2026-09-28. The tab must show, for every band, the profile's W–L and 1u; the legend = the
// profile headline. Control: the same render WITHOUT the profile rows (career rows) does not match.
test('ruling B: tab Match winner = the profile shard, band by band (Sinner, Alcaraz, Career)', () => {
  const ui = buildUI(), rows = load(ui);
  const prof = ['2072', '2382'].map((k) => rd(`market-edge-${k}.json`));
  rows.forEach((r, i) => { r.win = ui.meWinnerRows(prof[i], r, ['2072', '2382'][i], [M.p1, M.p2][i]); });
  const late = Object.assign({}, M, { date: '2026-12-31' });           // every profile row is before the match day
  const R = ui.render(late, { meView: 'winner', meScope: 'career' }, rows);
  const leg = legend(R.html);
  ['a', 'b'].forEach((k, i) => {
    const P = prof[i];
    assert.ok(P.headline.n > 300, 'fixture is not empty');
    assert.equal(leg[i].n, P.headline.n, `${k}: N priced = profile headline n`);
    assert.ok(Math.abs(leg[i].end - P.headline.units) <= 0.05 + 1e-9, `${k}: legend end ${leg[i].end} vs profile ${P.headline.units}`);
    const pb = P.bands.favourite.concat(P.bands.underdog);
    assert.equal(pb.length, 8);
    pb.forEach((b, j) => {
      const t = bandRow(R.html, k + j);
      assert.equal(t.w, b.wins, `${k}${j} wins`); assert.equal(t.l, b.losses, `${k}${j} losses`);
      if (b.n) assert.equal(t.u, Number(meRound(b.units)), `${k}${j} 1u`);
      if (b.n) assert.equal((R.band(k + j).match(/data-me-row=/g) || []).length, b.n, `${k}${j} pop-up rows = profile band n`);
    });
    // Derived lines stay on career-history: the "Wins match" denominator is the career Bo3 population
    const M2 = ui.core.playerModel(rows[i], { scope: 'career', refDay: Date.UTC(2026, 11, 31) / 86400000 });
    const R2 = ui.render(late, { meView: 'lines', meScope: 'career' }, rows);
    assert.equal(lineRow(R2.html, `${k}|0`).all.n, M2.bo3.length, `${k}: lines count career Bo3 rows`);
  });
  // control: without the profile rows the tab counts career rows and does NOT equal the profile
  const bare = load(ui), R0 = ui.render(late, { meView: 'winner', meScope: 'career' }, bare);
  assert.notEqual(legend(R0.html)[0].n, prof[0].headline.n, 'control: career rows ≠ profile rows for Sinner');
  // a profile row that joins a career row borrows its set scores and eventKey (clickable); a capture-only one does not
  const sin = rows[0].win, joined = sin.filter((r) => r.ek != null);
  assert.ok(joined.length > 200, `most profile rows join a career row (${joined.length}/${sin.length})`);
  // a capture-priced row (no Tennis-Data row) joins by opponent surname + result in the event window
  const bonzi = sin.find((r) => r.date === '2026-04-24');
  assert.ok(bonzi && bonzi.book === 'B' && bonzi.src === 'cap', 'Madrid v Bonzi is the captured Bet365 row');
  assert.ok(/Bonzi/.test(bonzi.opp) && bonzi.ek != null && bonzi.sets, 'it borrows the career row\'s eventKey and sets');
  // what the stats sheet reads (set counts) comes with the join — never "— – —" on a joined row
  assert.ok(joined.every((r) => r.pS != null && r.oS != null), 'joined rows carry the set counts');
  assert.ok(sin.every((r) => r.wo === false && r.profile), 'the profile settles its rows');
  // TEN-312 ruling A: the profile keeps Tennis-Data "Retired" rows, marked ret, and the tab carries the mark
  const sinRet = prof[0].matches.filter((x) => x.inBasis && x.ret);
  assert.equal(sinRet.length, 13, 'Sinner: 13 retirements settled on the profile (414 → 427, TEN-325)');
  assert.equal(sin.filter((r) => r.retSettle).length, sinRet.length, 'the tab marks the same 13 rows');
  // a profile row with no career counterpart keeps dashes and no eventKey (never a guessed join)
  const lone = ui.meWinnerRows({ matches: [{ date: '2026-05-02', event: 'X Open', surface: 'Clay', round: '1st Round', opp: 'Nobody Z.', won: true,
    price: 1.3, oppPrice: 3.4, book: 'bet365-capture', inBasis: true }] }, rows[0], '2072', M.p1)[0];
  assert.deepEqual([lone.ek, lone.sets, lone.round], [null, null, '—']);
});

// ---- TEN-322 (TEN-312 M5): the profit-chart footnote describes the shared DATE axis ----
// Under TEN-310 both lines sit on one real-date axis (chartModel's d0..d1 spans both players), so a later career
// starts further right. The design's copy ("each line spans that player's own matches") described a per-player
// index axis and is wrong here. Mutation that turns this red: restore that clause in meChartCard's footnote.
test('TEN-322: the profit-chart footnote says the axis is shared dates, never per-player spans', () => {
  const ui = buildUI(), rows = load(ui);
  for (const scope of ['career', 'l52']) {
    const html = ui.render(M, { meView: 'winner', meScope: scope }, rows).html;
    const card = html.slice(html.indexOf('class="me-card me-chart"'));
    const foot = texts(card).find((t) => t.startsWith('Cumulative units'));
    assert.ok(foot, `${scope}: chart footnote renders`);
    assert.ok(!/own matches|each line spans/i.test(foot), `${scope}: no per-player span claim: ${foot}`);
    assert.ok(foot.includes('one date axis shared by both players'), `${scope}: says the axis is shared dates: ${foot}`);
    // the copy is true of the render: Alcaraz's career starts later than Sinner's, so his line starts further right
    if (scope === 'career') assert.ok(series(html, 'b')[0][0] > series(html, 'a')[0][0], 'B starts right of A on the shared axis');
  }
});
