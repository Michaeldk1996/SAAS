#!/usr/bin/env node
// Tournaments → Draw (tournaments-draw.js, handoff 2026-11-15): executes the SHIPPED renderer on real data
// (tools/fixtures/tt-draw/: the posted Paris + Lyon sheets of draws.json, How it plays, favourites-by-round, the Database
// rows of those events, tour-baselines — copies of the deployed files of 15 Nov 2026) through the shipped draw-view.js
// and settlement.js, and checks structure, the dash rules (founder ruling 3: no chance / fair-odds / opening-range /
// warning figure) and the data sources. Each check names the mutant that must turn it red; the mutants run at the end.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'tools/fixtures/tt-draw');
const SRC = fs.readFileSync(path.join(ROOT, 'tournaments-draw.js'), 'utf8');
const fx = f => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));
const DASH = '—';

function boot(src) {
  const files = { 'draws.json': fx('draws.json'), 'how-it-plays.json': fx('how-it-plays.json'), 'favourites-by-round.json': fx('favourites-by-round.json'),
    'tour-baselines.json': fx('tour-baselines.json'), 'tournament-market.json': fx('tournament-market.json'), 'database-yield.json': fx('database-yield.json'),
    'draws-archive.json': null, 'database-yield-players.json': null };
  const win = {};
  const ctx = { window: win, console, Date, Math, JSON, Map, Set, Promise, setTimeout, sessionStorage: { setItem() {} },
    tournamentProgression: { fetchedAt: '2026-11-15T08:30:45Z', tournaments: {} }, matches: [] };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'settlement.js'), 'utf8'), ctx);
  win.Settlement = ctx.window.Settlement || ctx.Settlement;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'draw-view.js'), 'utf8'), ctx);
  vm.runInContext(src, ctx);
  const T = win.TTDraw._test;
  Object.assign(T.FILES, files);   // the module's loader cache: every file "already loaded"
  if (!win.Settlement) throw new Error('settlement.js did not load');
  const root = { innerHTML: '', style: {}, isConnected: true, querySelector: () => null, contains: () => false };
  const html = (state) => { T.reset(); Object.assign(T.S, { key: null, kind: 'main', view: 'draw', from: null, outTab: 't' }, state || {}); win.TTDraw.render(root); return root.innerHTML; };
  // first render picks the default event; then select Paris explicitly
  html({});
  return { T, win, html, root, ctx };
}

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const ok = (c, msg) => { if (!c) throw new Error(msg); };
const PARIS = 'd:352', LYON = 'd:496';
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

check('draw view: the official sheet, From pills, counts (mutant: From offers the final)', ({ html }) => {
  const h = text(html({ key: PARIS }));
  ok(/Draws/.test(h) && /this week · \d+ finished/.test(h), 'title row');
  ok(h.includes('Round of 64') && h.includes('Quarter-finals') && h.includes('Final'), 'long round names');
  ok(/Draw 0 of 55/.test(h), 'Draw pill = played of total (55 matches, 9 byes out): ' + (h.match(/Draw [^ ]+ of \d+/) || [])[0]);
  ok(/From R64 R32 R16 QF SF/.test(h) && !/From R64 R32 R16 QF SF F /.test(h), 'From pills = every round but the final');
  ok(h.includes('A. Zverev') && h.includes('C. Alcaraz') && h.includes('Bye'), 'players + byes from draws.json');
});
check('chances are dashes everywhere (mutant: a chance figure in the route card / outright)', ({ html }) => {
  const sel = text(html({ key: PARIS, sel: '1980' }));
  ok(/Win his quarter — Title chance —/.test(sel), 'route card head figures are dashes');
  ok(/Next: the round of 32/.test(sel), 'Zverev: a bye in R64, next = R32 with an undecided opponent (no "likely X")');
  ok(!/\d+(\.\d+)?% likely/.test(sel) && !/likely [A-Z]\./.test(sel), 'no "x% likely" / "likely X"');
  const out = text(html({ key: PARIS, view: 'out' }));
  ok(/Most likely winner — —/.test(out), 'leader card: name and chance are dashes');
  ok(!/\d%/.test(out.replace('50% · even', '')), 'no percentage on the outright view: ' + (out.match(/[^ ]*\d%[^ ]*/) || [])[0]);
  const q = text(html({ key: PARIS, view: 'out', outTab: 'q' }));
  ok((q.match(/Quarter \d/g) || []).length === 4, 'four quarter cards');
});
check('quarters come from draw positions (mutant: quarter by list index)', ({ html, T }) => {
  const q = html({ key: PARIS, view: 'out', outTab: 'q' });
  // Q1 of the 64-draw = positions 1–16: Zverev [1] (pos 1) leads it; Alcaraz [2] (pos 64) leads Q4
  const cards = q.split('>Quarter ').slice(1);
  ok(cards[0].includes('A. Zverev') && !cards[0].includes('C. Alcaraz'), 'Q1 holds Zverev');
  ok(cards[3].includes('C. Alcaraz'), 'Q4 holds Alcaraz');
});
check('compare: where they meet from positions, opening prices dashed (mutant: meet round off)', ({ html }) => {
  const h = text(html({ key: PARIS, sel: '1980', cmp: true, b: '2382' }));
  ok(h.includes('Could meet in the final'), 'Zverev (pos 1) v Alcaraz (pos 64) meet in the final');
  ok(h.includes('— both get there'), 'both-get-there is a dash');
  ok((h.match(/Likely opening price —/g) || []).length === 2, 'two dashed opening-price strips');
  ok(h.includes('Route, round by round'), 'route rails');
});
check('qualifying: its own rounds, no From pills (mutant: From on qualifying)', ({ html }) => {
  const h = text(html({ key: PARIS, kind: 'qual' }));
  ok(h.includes('Qualifying round 1') && !/From [RQ]/.test(h), 'qualifying columns, no From');
});
check('statistics: How it plays + Database rows through settlement.js (mutant: retirements not settled / floor off)', ({ html, T, win }) => {
  const h = html({ key: PARIS, view: 'stats' }), t = text(h);
  ok(t.includes('Aces per match') && t.includes('Backing underdogs') && t.includes('Won from a set down'), 'ten tiles');
  ok(!t.includes('All statistics'), '"All statistics ›" dropped');
  // Paris has no How it plays current edition → Speed figures are dashes; the tour average is the indoor-hard baseline
  ok(/Aces per match \u203a \u2014 vs tour \u2014/.test(t), 'speed figure is a dash without a current edition');
  // the edition is not live (no results on file) → the 2025 edition from the Database rows, recomputed here
  const D = fx('database-yield.json'), ix = D.meta.tournaments.indexOf('BNP Paribas Masters');
  let n = 0, fp = 0;
  D.rows.forEach(r => { if (r[4] === ix && Math.floor(r[0] / 1e4) === 2025) { n++; fp += r[7] ? r[5] - 1 : -1; } });
  D.retRows.forEach((r, i) => { if (r[4] === ix && Math.floor(r[0] / 1e4) === 2025 && win.Settlement.betCounts({ comment: D.retComment[i], fs: D.retFs[i] })) { n++; fp += r[7] ? r[5] - 1 : -1; } });
  const y = 100 * fp / n, want = (y > 0 ? '+' : y < 0 ? '−' : '') + Math.abs(y).toFixed(1) + '%';
  ok(t.includes('Backing favourites ' + want), `favourite yield 2025 = ${want} over ${n} (got ${(t.match(/Backing favourites [^ ]+/) || [])[0]})`);
  ok(/Matches going to a decider —/.test(t), 'deciders: no results → dash');
  // every season of the event: the module's per-season yields = an independent settlement of the same rows
  const ev = T.events().all.find(e => e.key === PARIS), sf = T.seasonFigs(T.dbRowsOf(ev));
  const by = {};
  const add = (r, bet) => { const y = Math.floor(r[0] / 1e4), o = by[y] || (by[y] = { n: 0, fp: 0 }); if (bet) { o.n++; o.fp += r[7] ? r[5] - 1 : -1; } };
  D.rows.forEach(r => { if (r[4] === ix) add(r, true); });
  D.retRows.forEach((r, i) => { if (r[4] === ix) add(r, win.Settlement.betCounts({ comment: D.retComment[i], fs: D.retFs[i] })); });
  for (const y of Object.keys(by)) ok(sf[y] && sf[y].betN === by[y].n && Math.abs(sf[y].favY - 100 * by[y].fp / by[y].n) < 1e-9, `season ${y}: ${sf[y] && sf[y].betN} bets v ${by[y].n}`);
  ok(/Backing favourites [^ ]+ vs tour [^ ]+ vs 2024 [^ ]+ vs past five [+\u2212]\d/.test(t), 'Paris holds five past editions → vs past five is a figure');
});
check('Lyon (October) is the new indoor event, never the clay Lyon Open (mutant: name map removed)', ({ html }) => {
  const raw = html({ key: LYON, view: 'stats' }), t = text(raw);
  ok(!/title="20(1\d|2[0-5]) \u00b7 [+\u2212]?\d/.test(raw), 'a past-edition bar on Lyon (France): ' + (raw.match(/title="20\d\d \u00b7 [^"]+"/) || [])[0]);
  const st = t.match(/Backing favourites ([^ ]+)/)[1];
  ok(st === DASH, 'Lyon (France) has no 2025 edition → dash: ' + st);
  ok(/Backing favourites [^ ]+ vs tour [^ ]+ vs 2024 \u2014 vs past five \u2014/.test(t), 'no Lyon Open (clay) edition leaks into Lyon (France)');
});
check('no raw colour, scoped CSS (mutant: a hex colour)', ({ src }) => {
  ok(!/#[0-9a-fA-F]{6}\b|rgba?\(\s*\d/.test(src), 'raw colour in the module');
  ok(src.includes(".tabpage[data-page=\"tournaments\"] .tt-draw"), 'scoped selector');
});

// Founder 2026-11-16: "clicking a match does nothing" + "archived draws have no W/UE sheet". Paris = its real published
// results (tournament-progression drawResults, 16 Nov); Brussels = its real archive entry (draws-archive.json, 16 Nov).
check('a finished match opens Match Analysis from the draw result; qualifying never (mutant: no click)', ({ T, win, html, ctx }) => {
  ctx.tournamentProgression.drawResults = fx('paris-results.json');
  try {
    const raw = html({ key: PARIS });
    const n = (raw.match(/class="tt-draw-score"/g) || []).length;
    ok(n === 2 * 55, `every finished Paris match has a clickable score on both rows: ${n} of ${2 * 55}`);
    const fin = ctx.tournamentProgression.drawResults.Paris.matches.find(m => m.roundCode === 'F');
    const r = win.TTDraw.rowById('past-' + fin.eventKey);
    ok(r && r.finalScore && r.finalScore.sets.length === fin.score.length, 'the final has a row with its set scores');
    ok(r.p1 === fin.p1.name && r.p2 === fin.p2.name && r.p1Key === +fin.p1.playerKey && r.p2Key === +fin.p2.playerKey, 'players and keys are the feed result');
    ok(r.finalScore.winner === (fin.winner === 1 ? 'p1' : 'p2') && r.tour === 'ATP Paris' && /1\/|Final/.test(r.tournamentRound), 'winner, event, round');
    ok(r.date === fin.date && !r.odds && !r.h2h && r.fromDrawResult === true, 'nothing filled in beyond the result');
    const q = html({ key: PARIS, kind: 'qual' });
    ok(/Qualifying round 1/.test(text(q)) && (q.match(/font-weight:700; color:[^;]+;">\d<\/span>/g) || []).length >= 10, 'the qualifying view draws its results (not an empty set)');
    ok(!/tt-draw-score/.test(q), 'a qualifying match is clickable');
  } finally { delete ctx.tournamentProgression.drawResults; }
});
check('an archived draw shows its W/UE sheet bar (mutant: archived draws skip the bar)', ({ T, win, html, ctx }) => {
  T.FILES['draws-archive.json'] = fx('draws-archive.json');
  const seen = [];
  ctx.tourxWueBarHtml = name => { seen.push(name); return '<span>W/UE BAR ' + name + '</span>'; };
  try {
    const raw = html({ key: 'a:7485' });
    ok(seen.includes('Brussels') && raw.includes('W/UE BAR Brussels'), 'the archived Brussels draw renders the W/UE bar for "Brussels": ' + JSON.stringify(seen));
    ok((raw.match(/class="tt-draw-score"/g) || []).length === 2 * 27, 'archived Brussels: every result (26 played + 1 walkover) clickable: ' + (raw.match(/class="tt-draw-score"/g) || []).length);
  } finally { T.FILES['draws-archive.json'] = null; delete ctx.tourxWueBarHtml; }
});

function run(src, quiet) {
  let env; try { env = boot(src); } catch (e) { if (!quiet) console.log('boot failed: ' + e.message); return checks.map(c => ({ name: c.name, err: 'boot: ' + e.message })); }
  env.src = src;
  return checks.map(c => { try { c.fn(env); return { name: c.name }; } catch (e) { return { name: c.name, err: e.message }; } });
}
if (process.env.TT_DEBUG) { const e = boot(SRC); console.log(text(e.html(JSON.parse(process.env.TT_DEBUG)))); process.exit(0); }
const res = run(SRC);
let fail = 0;
for (const r of res) { console.log((r.err ? 'FAIL ' : 'ok   ') + r.name + (r.err ? '\n     ' + r.err : '')); if (r.err) fail++; }

// mutants: each must turn at least one check red
const MUT = [
  ['From offers the final', "names.slice(0, Math.max(1, names.length - 1))", 'names.slice(0)'],
  ['a chance in the route card', "const qFig = A.qWon ? 'Won' : DASH", "const qFig = A.qWon ? 'Won' : '42%'"],
  ['a chance in the outright leader', "${ck ? '100%' : DASH}</span>", "${ck ? '100%' : '27%'}</span>"],
  ['quarter by list index', 'Math.ceil(s.pos / per) === q + 1);', 'Math.floor(F.slots.indexOf(s) / 8) === q);'],
  ['meet round off', 'r = DV().meetRound(pa, Bp.me.pos)', 'r = Math.max(0, DV().meetRound(pa, Bp.me.pos) - 1)'],
  ['retirements not settled', "bet: !!(Sm && Sm.betCounts({ comment: cm, fs }))", 'bet: true'],
  ['Lyon name map removed', "return c === 'Lyon' &&", 'return false &&'],
  ['From on qualifying', "const showFrom = S.kind !== 'qual' && view === 'draw' && !!M;", "const showFrom = view === 'draw' && !!M;"],
  ['a hex colour', "text: 'var(--tt-text)'", "text: '#E7E9EE'"],
  ['no click', "const aid = dec ? analysisId(ev, m) : null;", "const aid = null;"],
  ['archived draws skip the bar', "const wueName = ev.entryName || (ev.arch ? cityOf(ev.draw) : null);", "const wueName = ev.entryName;"],
];
let survived = 0;
for (const [name, a, b] of MUT) {
  if (!SRC.includes(a)) { console.log('MUTANT ANCHOR MISSING: ' + name); survived++; continue; }
  const r = run(SRC.replace(a, b), true);
  const red = r.some(x => x.err);
  console.log((red ? 'killed   ' : 'SURVIVED ') + 'mutant: ' + name);
  if (!red) survived++;
}
if (fail || survived) { console.log(`\n${fail} check(s) failed, ${survived} mutant(s) survived`); process.exit(1); }
console.log(`\nall ${res.length} checks pass; ${MUT.length} mutants killed`);
