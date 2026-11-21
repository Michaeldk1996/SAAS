#!/usr/bin/env node
// Tournaments → Draw (tournaments-draw.js, handoff 2026-11-20): executes the SHIPPED renderer on real data
// (tools/fixtures/tt-draw/: the posted Paris + Lyon sheets of draws.json, Paris's published results, How it plays,
// favourites-by-round, the Database rows of those events, tour-baselines, points-to-defend.json's Paris event — copies of
// deployed / committed files) through the shipped draw-view.js and settlement.js, and checks structure, the dash rules
// (chances: founder 2026-11-20, Stennisfy probabilities; opening ranges and warnings stay dashes) and every data source. The player-index
// standings with ranking points and the per-match serve metrics are SYNTHETIC test inputs (built here, never shipped).
// Each check names the mutant that must turn it red; the mutants run at the end.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'tools/fixtures/tt-draw');
const SRC = fs.readFileSync(path.join(ROOT, 'tournaments-draw.js'), 'utf8');
const fx = f => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));
const DASH = '—';

// synthetic standings: the Paris rows' own ranks, ranking points 10000 − 60 × rank; Medvedev (1093) has none
const PTD = fx('points-to-defend.json'), PEV = PTD.events['paris-2026'];
function standings() {
  const seen = new Map();
  PEV.rows.concat(PEV.zeroRows).forEach(r => { if (!seen.has(r.playerKey)) seen.set(r.playerKey, r); });
  return [...seen.values()].filter(r => r.rank != null).sort((a, b) => a.rank - b.rank)
    .map(r => ({ key: r.playerKey, name: r.name, rank: r.rank, points: r.playerKey === '1093' ? null : 10000 - 60 * r.rank }));
}
const PT_TOTAL = PEV.rows.reduce((a, r) => a + (r.points || 0), 0);

function boot(src) {
  const files = { 'draws.json': fx('draws.json'), 'how-it-plays.json': fx('how-it-plays.json'), 'favourites-by-round.json': fx('favourites-by-round.json'),
    'tour-baselines.json': fx('tour-baselines.json'), 'tournament-market.json': fx('tournament-market.json'), 'database-yield.json': fx('database-yield.json'),
    'draws-archive.json': null, 'database-yield-players.json': null, 'points-to-defend.json': PTD, 'tournament-logos/index.json': { logos: { Paris: 'paris-352.webp?v=1' } } };
  const win = {};
  const ctx = { window: win, console, Date, Math, JSON, Map, Set, Promise, setTimeout, sessionStorage: { setItem() {} },
    tournamentProgression: { fetchedAt: '2026-11-15T08:30:45Z', tournaments: {} }, matches: [], playerIndex: standings(),
    playerPhotoImg: (k, n) => `<img class="sf-ph" data-k="${k}" alt="${n}">` };
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
  const html = (state) => { T.reset(); Object.assign(T.S, { key: null, kind: 'main', view: 'draw', from: null, outTab: 't', ptSort: 'pts', dl: null }, state || {}); win.TTDraw.render(root); return root.innerHTML; };
  html({});
  // fire the handler of the first element carrying data-tt="<id>"
  const fire = (raw, id) => { const m = raw.match(new RegExp(`data-tt="${id}"[^>]*?onclick="TTDraw\\._h\\((\\d+),event\\)"`)); if (!m) throw new Error('no handler for ' + id); win.TTDraw._h(+m[1], {}); };
  return { T, win, html, root, ctx, fire };
}

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const ok = (c, msg) => { if (!c) throw new Error(msg); };
const PARIS = 'd:352', LYON = 'd:496';
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const withResults = (ctx, fn) => { ctx.tournamentProgression.drawResults = fx('paris-results.json'); try { return fn(); } finally { delete ctx.tournamentProgression.drawResults; } };

check('card structure: Draws + count, picker row, download, open-draw head, toolbar (mutant: From offers the final)', ({ html }) => {
  const raw = html({ key: PARIS }), h = text(raw);
  ok(/Draws 0 this week · 2 finished · 0 in the archive/.test(h), 'title + count: ' + (h.match(/Draws [^·]+·[^·]+·[^A-Z]+/) || [])[0]);
  ok(/This week No draw in play Finished/.test(h), 'picker row: This week (none) · Finished');
  ok(/Download W\/UE sheet/.test(h), 'download in the picker row');
  ok(/Matches played 0 of 55/.test(h) && /Compare two routes/.test(h), 'head: Matches played + Compare two routes');
  ok(/tournament-logos\/paris-352\.webp/.test(raw), 'logo tile reads tournament-logos/index.json');
  ok(new RegExp(`Draw 0 of 55 Statistics Outright chances Points to defend ${PT_TOTAL}`).test(h), 'four views, Points to defend = total of the Paris rows: ' + (h.match(/Draw 0 of 55.{0,80}/) || [])[0]);
  ok(/From R64 R32 R16 QF SF/.test(h) && !/From R64 R32 R16 QF SF F /.test(h), 'From pills = every round but the final');
  ok(h.includes('Round of 64') && h.includes('Quarter-finals') && h.includes('Final'), 'long round names');
});
check('no explanatory text on the page; the round "?" opens its fixed box with all of it (mutant: foot note back / help box empty)', ({ html, fire, root }) => {
  const raw = html({ key: PARIS }), h = text(raw);
  ok(!/Grey figures on unplayed matches/.test(h) && !/The white tick/.test(h), 'no foot note on the page');
  fire(raw, 'help');
  const b = text(root.innerHTML);
  ok(/How to read this page/.test(b) && /Points to defend Points he won here last year/.test(b) && /W\/O A walkover/.test(b), 'help entries');
  ok(/position:fixed; z-index:30/.test(root.innerHTML), 'fixed layer');
});
check('bracket rows start with the player photo, no country box, Bye inset 30 (mutant: country code box back)', ({ html }) => {
  const raw = html({ key: PARIS });
  ok((raw.match(/data-k="1980"/g) || []).length >= 1 && (raw.match(/class="tt-draw-av"/g) || []).length >= 55, 'avatars with the photo resolver: ' + (raw.match(/class="tt-draw-av"/g) || []).length);
  ok(/class="tt-draw-av" title="GER"/.test(raw), 'country only in the avatar hover');
  ok(!/border-radius:5px; padding:2px 4px;">[A-Z]{3}</.test(raw), 'no boxed country code');
  ok(/margin-left:30px; font-size:12.5px; color:var\(--tt-muted\);">Bye</.test(raw), 'Bye inset 30');
  const h = text(raw);
  ok(h.includes('A. Zverev') && h.includes('C. Alcaraz'), 'players from draws.json');
});
check('no Elo file → every chance is a dash with its reason (mutant: a chance figure without a source)', ({ html }) => {
  const sel = text(html({ key: PARIS, sel: '1980' }));
  ok(/Win his quarter — Title chance —/.test(sel), 'route panel head figures are dashes');
  ok(/Next: the round of 32/.test(sel), 'Zverev: a bye in R64, next = R32 with an undecided opponent');
  ok(!/\d+(\.\d+)?% likely/.test(sel), 'no "x% likely" without chances');
  const out = html({ key: PARIS, view: 'out' }), o = text(out);
  ok(/Most likely winner — —/.test(o), 'leader card: name and chance are dashes');
  ok(!/\d%/.test(o), 'no percentage on the outright view: ' + (o.match(/[^ ]*\d%[^ ]*/) || [])[0]);
  ok(/title="Loading the Elo ratings"/.test(out), 'the dash says why');
  const q = text(html({ key: PARIS, view: 'out', outTab: 'q' }));
  ok((q.match(/Quarter \d/g) || []).length === 4, 'four quarter cards');
});

// ── chances (founder 2026-11-20): exact bracket DP over Stennisfy pairwise probabilities ──
const require = createRequire(import.meta.url);
const ELO = require(path.join(ROOT, 'h2h-model/elo.js'));
// a synthetic 8-player draw run through the shipped DrawView model and chancesFor
const SYN = [['ALPHA, Ann', 2100], ['BETA, Bob', 1900], ['GAMMA, Gus', 2000], ['DELTA, Dan', 1700], ['EPSILON, Eve', 1950], ['ZETA, Zed', 1850], ['ETA, Ed', 2050], ['THETA, Tom', 1600]];
function synEnv(T, win, opts) {
  const o = opts || {};
  const slots = SYN.map(([name], i) => ({ pos: i + 1, name, playerKey: 'x' + (i + 1) }));
  const elo = {};
  SYN.forEach(([name, r], i) => { if (!(o.noElo || []).includes('x' + (i + 1))) { const [sur, giv] = name.split(', '); elo[T.eloKeyOf(giv + ' ' + sur)] = { all: { rating: r }, hard: { rating: r - 40 * (i % 3) } }; } });
  T.FILES['elo-ratings.json'] = { elo, ambiguous: [] };
  const draw = { main: { status: 'posted', size: 8, slots }, sheetHeader: { surface: 'Hard' }, category: 'ATP 250' };
  const res = (o.played || []).map(([a, b, w]) => ({ p1: { playerKey: a, name: a }, p2: { playerKey: b, name: b }, winner: w, score: [[6, 3], [6, 4]], status: 'finished' }));
  const ev = { draw, board: [], city: 'Synthetic', entry: { matches: res } };
  const M = win.DrawView.model({ draw, entry: ev.entry, upcoming: [], kind: 'main' }), F = T.facts(M, ev);
  return T.chancesFor(ev, M, F);
}
const near = (a, b) => Math.abs(a - b) < 1e-9;
check('chance DP on a synthetic 8-player draw: titles sum to 100%, each quarter to 100% (mutants: quarter over the wrong half / 50% fallback)', ({ T, win }) => {
  const CH = synEnv(T, win), keys = SYN.map((_, i) => 'x' + (i + 1));
  const t = keys.map(k => CH.title(k)), q = keys.map(k => CH.quarter(k));
  ok(t.every(v => v > 0 && v < 1), 'every title chance a figure: ' + t.join());
  ok(near(t.reduce((a, b) => a + b, 0), 1), 'title chances sum to 1: ' + t.reduce((a, b) => a + b, 0));
  for (let g = 0; g < 4; g++) ok(near(q[2 * g] + q[2 * g + 1], 1), `quarter ${g + 1} sums to 1: ${q[2 * g] + q[2 * g + 1]}`);
  // by hand: x1 v x2 on hard is the model's Stage-1 base
  const e = n => ({ elo: T.FILES['elo-ratings.json'].elo[T.eloKeyOf(n.split(', ')[1] + ' ' + n.split(', ')[0])] });
  ok(near(q[0], ELO.baseProbability(e(SYN[0][0]), e(SYN[1][0]), 'Hard').baseP1), 'R1 chance = baseProbability');
  ok(t.indexOf(Math.max(...t)) === 0, 'the highest rated player has the highest title chance');
});
check('a played match fixes its winner; a walkover too (mutant: played results ignored)', ({ T, win }) => {
  const CH = synEnv(T, win, { played: [['x1', 'x2', 2]] });
  ok(CH.quarter('x2') === 1 && CH.quarter('x1') === 0 && CH.title('x1') === 0, 'x2 beat x1: quarter 100%, x1 out');
  const t = SYN.map((_, i) => CH.title('x' + (i + 1)));
  ok(near(t.reduce((a, b) => a + b, 0), 1), 'still sums to 1');
});
check('a missing Elo dashes exactly the chances that depend on him, never 50% (mutant: equal 50% fallback)', ({ T, win }) => {
  const CH = synEnv(T, win, { noElo: ['x8'] });
  ok(CH.quarter('x7') == null && CH.quarter('x8') == null, 'his quarter is unknown');
  ok(CH.quarter('x1') != null && near(CH.quarter('x1') + CH.quarter('x2'), 1), 'other quarters stand');
  ok(SYN.every((_, i) => CH.title('x' + (i + 1)) == null), 'every title chance depends on him → dash');
  const CH2 = synEnv(T, win, { noElo: ['x8'], played: [['x7', 'x8', 1]] });
  ok(CH2.title('x8') === 0 && near(SYN.reduce((a, _, i) => a + CH2.title('x' + (i + 1)), 0), 1), 'once he is out, every title chance is back');
});
check('formula parity: the page Elo base = h2h-model/elo.js baseProbability (mutant: weights drift)', ({ T }) => {
  const recs = [{ all: { rating: 2100 }, hard: { rating: 2050 }, clay: { rating: 1900 }, grass: { rating: 1980 } }, { all: { rating: 1830 }, clay: { rating: 1950 } },
    { all: { rating: 1990 }, hard: { rating: 2010 }, grass: { rating: 1700 } }, { all: { rating: 1500 } }];
  let n = 0;
  for (const a of recs) for (const b of recs) for (const sf of ['Hard', 'Clay', 'Grass', 'Carpet', null, 'Hard (Indoor)']) {
    const want = ELO.baseProbability({ elo: a }, { elo: b }, sf).baseP1, got = T.eloBaseP(a, b, sf); n++;
    ok(Math.abs(want - got) < 1e-9, `${JSON.stringify(a)} v ${JSON.stringify(b)} on ${sf}: ${got} v ${want}`);
  }
  ok(T.eloBaseP({ all: { rating: 2000 } }, null, 'Hard') === null && ELO.baseProbability({ elo: { all: { rating: 2000 } } }, { elo: null }, 'Hard').baseP1 === null, 'no Elo → null on both');
  ok(n === 96, 'pairs run: ' + n);
});
// Paris with a synthetic Elo store: every player rated by his seed, the unseeded at 1700 − position
function parisElo(T, skip) {
  const elo = {};
  fx('draws.json').tournaments['352'].main.slots.filter(s => !s.bye).forEach(s => { if (String(s.playerKey) === skip) return;
    const [sur, giv] = s.name.split(/,\s*/); const k = T.eloKeyOf(giv + ' ' + sur); if (k && !/…/.test(s.name)) elo[k] = { all: { rating: s.seed ? 2300 - 30 * s.seed : 1700 - s.pos }, hard: { rating: s.seed ? 2280 - 30 * s.seed : 1690 - s.pos } }; });
  return { elo, ambiguous: [] };
}
check('Paris: real chances on every view — route panel, outright, quarters, compare, opponents box; fair odds = 1 / chance', ({ T, html, root, win, ctx }) => {
  T.FILES['elo-ratings.json'] = parisElo(T);
  const ev = T.events().all.find(e => e.key === PARIS), M = T.modelOf(ev, 'main'), F = T.facts(M, ev);
  const trunc = F.slots.filter(s => /…/.test(s.name)).map(s => String(s.playerKey));
  ok(trunc.length >= 1, 'the fixture holds a sheet name cut short (no Elo by the sheet name)');
  const qOf = k => Math.ceil(F.byKey.get(k).pos / 16);
  let CH = T.chancesFor(ev, M, F);
  ok(F.slots.every(s => CH.title(String(s.playerKey)) == null), 'an unrated player leaves every title chance a dash');
  const clean = [1, 2, 3, 4].find(q => !trunc.some(k => qOf(k) === q)), dirty = qOf(trunc[0]);
  ok(clean, 'a quarter with every player rated');
  const inQ = q => F.slots.filter(s => Math.ceil(s.pos / 16) === q).map(s => String(s.playerKey));
  ok(near(inQ(clean).reduce((a, k) => a + CH.quarter(k), 0), 1) && inQ(dirty).every(k => CH.quarter(k) == null), 'quarters: the rated one sums to 1, the unrated one dashes');
  // the profile name resolves the cut sheet names (the model's own key rule on the profile spelling)
  const st = T.FILES['elo-ratings.json'];
  trunc.forEach((k, i) => { st.elo[T.eloKeyOf('Test Player' + 'abcdefgh'[i])] = { all: { rating: 1650 + i } }; });
  ctx.newsPlayerName = (k, fb) => (trunc.includes(String(k)) ? 'Test Player' + 'abcdefgh'[trunc.indexOf(String(k))] : fb);
  try {
    CH = T.chancesFor(ev, M, F);
    const t = F.slots.map(s => CH.title(String(s.playerKey)));
    ok(t.every(v => v != null) && near(t.reduce((a, b) => a + b, 0), 1), 'Paris title chances sum to 1');
    const qz = CH.quarter('1980'), tz = CH.title('1980');
    const sel = text(html({ key: PARIS, sel: '1980' }));
    ok(sel.includes(`Win his quarter fair odds ${(1 / qz).toFixed(2)} ${T.pctS(qz)}`) && sel.includes(`Title chance fair odds ${(1 / tz).toFixed(2)} ${T.pctS(tz)}`), 'route panel: chance + fair odds: ' + (sel.match(/Win his quarter.{0,80}/) || [])[0]);
    ok(sel.includes(`${T.pctS(CH.at(1, "1980"))} to reach the Round of 16`), "per-round chance in the rail: " + (sel.match(/Round of 32.{0,120}/) || [])[0]);
    const sorted = F.slots.map(s => [String(s.playerKey), CH.title(String(s.playerKey))]).sort((a, b) => b[1] - a[1]), nm = k => win.DrawView.shortName(F.byKey.get(k).name);
    const o = text(html({ key: PARIS, view: 'out' }));
    ok(/Most likely winner ›/.test(o) && o.includes(`${nm(sorted[0][0])} Favourite ${T.pctS(sorted[0][1])} Fair odds ${(1 / sorted[0][1]).toFixed(2)} Bookmakers — Ahead of the next ${Math.round((sorted[0][1] - sorted[1][1]) * 100)} points`), 'leader card: ' + (o.match(/Most likely winner.{0,120}/) || [])[0]);
    ok(new RegExp(`Also favoured Chance Fair odds Bookmakers [A-Z]{2} ${nm(sorted[1][0]).replace('.', '\\.')}`).test(o) && new RegExp(`Three underdogs Chance Fair odds Bookmakers [A-Z]{2} ${nm(sorted[4][0]).replace('.', '\\.')}`).test(o), 'groups: 2nd–3rd, then 5th / 7th / 9th: ' + (o.match(/Also favoured.{0,80}/) || [])[0]);
    const q = html({ key: PARIS, view: 'out', outTab: 'q' }), cards = q.split('>Quarter ').slice(1);
    const q1 = inQ(1).map(k => [k, CH.quarter(k)]).sort((a, b) => b[1] - a[1]);
    ok(near(q1.reduce((a, x) => a + x[1], 0), 1), 'quarter 1 sums to 1');
    ok(text(cards[0]).includes(`${nm(q1[0][0])} ${T.pctS(q1[0][1])} ${(1 / q1[0][1]).toFixed(2)} `) && text(cards[0]).indexOf(nm(q1[0][0])) < text(cards[0]).indexOf(nm(q1[1][0])), 'quarter rows by chance, single fair price: ' + text(cards[0]).slice(0, 120));
    html({ key: PARIS, sel: '1980', cmp: true, b: '2382' });
    ok(text(root.innerHTML).includes(`${T.pctS(CH.title('2382'))}`) && /title="Title chance · Stennisfy: the model’s Elo base/.test(root.innerHTML), 'compare: title chance with its basis');
    T.S.opp = { who: 'a', r: 1 }; win.TTDraw.render(root);
    const ob = text(root.innerHTML), c1 = T.pathOf(M, F, '1980').cells[1], o1 = String(c1.cands[0].playerKey);
    ok(ob.includes(`${T.pctS(CH.pw('1980', o1))} — to win this match`), 'opponents box: chance v his most likely opponent: ' + (ob.match(/who he could play.{0,140}/) || [])[0]);
    ok(ob.includes(`${T.pctS(CH.reach(1, o1))} likely`), '"x% likely" from the DP');
    ok(c1.cands.every((x, i, a) => !i || CH.reach(1, String(a[i - 1].playerKey)) >= CH.reach(1, String(x.playerKey))), 'candidates by chance of being there');
  } finally { delete ctx.newsPlayerName; T.FILES['elo-ratings.json'] = undefined; }
});
check('a board match the Stennisfy Model priced uses the model price; every other pairing the Elo base (mutant: model price ignored)', ({ T, ctx }) => {
  T.FILES['elo-ratings.json'] = parisElo(T);
  const ev0 = T.events().all.find(e => e.key === PARIS), M = T.modelOf(ev0, 'main'), F = T.facts(M, ev0);
  const c = M.rounds[0].cells.find(x => x.sides[0] && x.sides[1] && x.sides[0].playerKey && x.sides[1].playerKey && !/…/.test(x.sides[0].name + x.sides[1].name));
  const a = String(c.sides[0].playerKey), b = String(c.sides[1].playerKey);
  const ev = Object.assign({}, ev0, { board: [{ id: 'upcoming-1', p1Key: +b, p2Key: +a }] });
  ctx.modelOutput = { matches: { 'upcoming-1': { ok: true, players: { p1: { key: +b }, p2: { key: +a } }, stage3: { fair: { p1: { prob: 0.37 }, p2: { prob: 0.63 } } } } } };
  try {
    const CH = T.chancesFor(ev, M, F);
    ok(near(CH.pw(a, b), 0.63) && near(CH.pw(b, a), 0.37), 'model price, oriented to the player: ' + CH.pw(a, b));
    const ea = T.eloRecOf(T.FILES['elo-ratings.json'], a, c.sides[0].name), eb = T.eloRecOf(T.FILES['elo-ratings.json'], b, c.sides[1].name);
    ok(near(CH.at(0, a), 0.63), "R1 chance = the model price");
    const c2 = M.rounds[0].cells.find(x => x !== c && x.sides[0] && x.sides[1] && !/…/.test(x.sides[0].name + x.sides[1].name));
    ok(near(CH.pw(String(c2.sides[0].playerKey), String(c2.sides[1].playerKey)), T.eloBaseP(T.eloRecOf(T.FILES['elo-ratings.json'], String(c2.sides[0].playerKey), c2.sides[0].name), T.eloRecOf(T.FILES['elo-ratings.json'], String(c2.sides[1].playerKey), c2.sides[1].name), 'Hard')), 'other pairs: the Elo base');
    ok(ea && eb, 'both rated');
  } finally { delete ctx.modelOutput; T.FILES['elo-ratings.json'] = undefined; }
});
check('round robin (ATP Finals) is not modelled', ({ T }) => {
  const ev = T.events().all.find(e => e.key === PARIS), M = T.modelOf(ev, 'main'), F = T.facts(M, ev);
  ok(T.chancesFor(Object.assign({}, ev, { city: 'ATP Finals - Turin' }), M, F) === null, 'Finals → null (dash, hover: the group stage is not modelled)');
});
// Bookmakers (founder 2026-11-21): the same DP on the card book's no-vig price; a suspended pair or no card = the Elo base
check('Bookmakers chance: a priced card = its no-vig price, a suspended pair or no card = the Elo base, none priced = dash (mutant: book price ignored)', ({ T, ctx, html }) => {
  T.FILES['elo-ratings.json'] = parisElo(T);
  const ev0 = T.events().all.find(e => e.key === PARIS), M = T.modelOf(ev0, 'main'), F = T.facts(M, ev0);
  const cs = M.rounds[0].cells.filter(x => x.sides[0] && x.sides[1] && x.sides[0].playerKey && x.sides[1].playerKey && !x.match && !/…/.test(x.sides[0].name + x.sides[1].name));
  const [c, d] = cs, a = String(c.sides[0].playerKey), b = String(c.sides[1].playerKey), da = String(d.sides[0].playerKey), db = String(d.sides[1].playerKey);
  const prices = { 'upcoming-1': { p1: 2.6, p2: 1.55, book: 'bet105' }, 'upcoming-2': { p1: 1.2, p2: 1.5, book: 'bet105' } };
  const ev = Object.assign({}, ev0, { board: [{ id: 'upcoming-1', p1Key: +b, p2Key: +a }, { id: 'upcoming-2', p1Key: +da, p2Key: +db }] });
  ctx._mcNowPair = m => prices[m.id] || null; ctx.MC_BOOK_NAMES = { bet105: 'Bet105' };
  // the sheet names cut short get an Elo through their profile name (as in the Paris check), so every chance is a figure
  const trunc = F.slots.filter(s => /…/.test(s.name)).map(s => String(s.playerKey));
  trunc.forEach((k, i) => { T.FILES['elo-ratings.json'].elo[T.eloKeyOf('Test Player' + 'abcdefgh'[i])] = { all: { rating: 1650 + i } }; });
  ctx.newsPlayerName = (k, fb) => (trunc.includes(String(k)) ? 'Test Player' + 'abcdefgh'[trunc.indexOf(String(k))] : fb);
  try {
    const B = T.chancesFor(ev, M, F, T.bookPairP), want = (1 / 1.55) / (1 / 2.6 + 1 / 1.55);
    ok(near(B.pw(a, b), want) && near(B.pw(b, a), 1 - want) && near(B.at(0, a), want), 'R1 = the no-vig price, oriented: ' + B.pw(a, b));
    ok(B.hasModel() && [...B.books].join() === 'Bet105', 'the book is named: ' + [...B.books]);
    const el = (k, s) => T.eloRecOf(T.FILES['elo-ratings.json'], k, s.name);
    ok(near(B.pw(da, db), T.eloBaseP(el(da, d.sides[0]), el(db, d.sides[1]), 'Hard')), 'overround over 20% (1.20 / 1.50) = suspended → the Elo base');
    const N = T.chancesFor(Object.assign({}, ev0, { board: [] }), M, F, T.bookPairP);
    ok(N && !N.hasModel(), 'no priced card → no pair used a price');
    const o = text(html({ key: PARIS, view: 'out' }));
    ok(/Bookmakers —/.test(o) && /No match in this draw has a bookmaker price on Today’s Matches yet/.test(html({ key: PARIS, view: 'out' })), 'outright view: Bookmakers dash with the reason');
    ctx.matches = [{ id: 'upcoming-1', tour: 'ATP Paris', p1Key: +b, p2Key: +a }];
    const ph = html({ key: PARIS, view: 'out', outTab: 'q' }), qp = Math.ceil(F.byKey.get(a).pos / 16);
    const top = F.slots.filter(s => Math.ceil(s.pos / 16) === qp).map(s => String(s.playerKey)).sort((x, y) => T.CH.quarter(y) - T.CH.quarter(x))[0], qa = T.CHB.quarter(top);
    ok(qa != null && /Bookmakers: no-vig Bet105 price for matches on Today’s Matches, Elo base for later rounds/.test(ph) && ph.includes('>' + T.pctS(qa) + '<'), 'a priced board card → quarter Bookmakers figures with the book named: ' + T.pctS(qa));
    const pt = text(html({ key: PARIS, view: 'out' })), lead = T.CHB.title([...F.slots].map(s => String(s.playerKey)).sort((x, y) => T.CH.title(y) - T.CH.title(x))[0]);
    ok(pt.includes('Bookmakers ' + T.pctS(lead) + ' Ahead of the next'), 'leader card: the Bookmakers title chance beside the Stennisfy one: ' + (pt.match(/Fair odds.{0,40}Ahead/) || [])[0]);
  } finally { ctx.matches = []; delete ctx.newsPlayerName; delete ctx._mcNowPair; delete ctx.MC_BOOK_NAMES; T.FILES['elo-ratings.json'] = undefined; }
});
check('quarters come from draw positions (mutant: quarter by list index)', ({ html }) => {
  const q = html({ key: PARIS, view: 'out', outTab: 'q' });
  const cards = q.split('>Quarter ').slice(1);
  ok(cards[0].includes('A. Zverev') && !cards[0].includes('C. Alcaraz'), 'Q1 holds Zverev');
  ok(cards[3].includes('C. Alcaraz'), 'Q4 holds Alcaraz');
});
check('compare = ONE table, meeting round from positions, a round opens the opponents box (mutant: meet round off)', ({ html, T, root, win }) => {
  const raw = html({ key: PARIS, sel: '1980', cmp: true, b: '2382' }), h = text(raw);
  ok(h.includes('Could meet in the final'), 'Zverev (pos 1) v Alcaraz (pos 64) meet in the final');
  ok(/Player R64 R32 R16 QF SF F Title/.test(h), 'one table head');
  ok((raw.match(/box-shadow:inset 0 0 0 1\.5px var\(--tt-white\)/g) || []).length === 2, 'the meeting round is ringed on both rows');
  ok(!/Likely opening price/.test(h) && !/Route, round by round/.test(h), 'the old meeting card and route cards are gone');
  T.S.opp = { who: 'a', r: 1 }; win.TTDraw.render(root);
  const o = text(root.innerHTML);
  ok(/A\. Zverev Round of 32 · who he could play/.test(o) && /Opening price —/.test(o), 'opponents box, opening price a dash');
});
check('qualifying: its own rounds, no From pills (mutant: From on qualifying)', ({ html }) => {
  const h = text(html({ key: PARIS, kind: 'qual' }));
  ok(h.includes('Qualifying round 1') && !/From [RQ]/.test(h), 'qualifying columns, no From');
});
check('progress bar only while a draw is in play (mutant: progress bar always)', ({ html, ctx }) => {
  ok(/Results /.test(text(html({ key: PARIS }))), 'no result yet → draw out: the bar row shows');
  withResults(ctx, () => {
    const h = text(html({ key: PARIS }));
    ok(/Finished/.test(h) && !/Results (\d|just|—)/.test(h), 'finished Paris: no progress row');
    ok(/Champion C\. Alcaraz/.test(h), 'head: the champion');
  });
});
check('statistics: How it plays + Database rows through settlement.js (mutant: retirements not settled)', ({ html, T, win }) => {
  const h = html({ key: PARIS, view: 'stats' }), t = text(h);
  ok(t.includes('Backing underdogs') && t.includes('Won from a set down'), 'Favourites and underdogs tiles');
  // Paris has no How it plays current edition → ONE dashed note card naming the five measures, not five tiles of dashes
  ok(/No serve statistics for this edition yet/.test(t) && /Aces per match Sets with a tiebreak 1st serve points won 2nd serve points won Service games held/.test(t), 'speed empty state');
  const D = fx('database-yield.json'), ix = D.meta.tournaments.indexOf('BNP Paribas Masters');
  let n = 0, fp = 0;
  D.rows.forEach(r => { if (r[4] === ix && Math.floor(r[0] / 1e4) === 2025) { n++; fp += r[7] ? r[5] - 1 : -1; } });
  D.retRows.forEach((r, i) => { if (r[4] === ix && Math.floor(r[0] / 1e4) === 2025 && win.Settlement.betCounts({ comment: D.retComment[i], fs: D.retFs[i] })) { n++; fp += r[7] ? r[5] - 1 : -1; } });
  const y = 100 * fp / n, want = (y > 0 ? '+' : y < 0 ? '−' : '') + Math.abs(y).toFixed(1) + '%';
  ok(t.includes('Backing favourites ' + want), `favourite yield 2025 = ${want} over ${n} (got ${(t.match(/Backing favourites [^ ]+/) || [])[0]})`);
  ok(/Matches going to a decider —/.test(t), 'deciders: no results → dash');
  const ev = T.events().all.find(e => e.key === PARIS), sf = T.seasonFigs(T.dbRowsOf(ev));
  const by = {};
  const add = (r, bet) => { const y = Math.floor(r[0] / 1e4), o = by[y] || (by[y] = { n: 0, fp: 0 }); if (bet) { o.n++; o.fp += r[7] ? r[5] - 1 : -1; } };
  D.rows.forEach(r => { if (r[4] === ix) add(r, true); });
  D.retRows.forEach((r, i) => { if (r[4] === ix) add(r, win.Settlement.betCounts({ comment: D.retComment[i], fs: D.retFs[i] })); });
  for (const y of Object.keys(by)) ok(sf[y] && sf[y].betN === by[y].n && Math.abs(sf[y].favY - 100 * by[y].fp / by[y].n) < 1e-9, `season ${y}: ${sf[y] && sf[y].betN} bets v ${by[y].n}`);
  ok(/Backing favourites [^ ]+ vs tour [^ ]+ vs 2024 [^ ]+ vs past five [+−]\d/.test(t), 'Paris holds five past editions → vs past five is a figure');
});
check('"All statistics ›" opens the Reports tab (mutant: link dropped)', ({ html, fire, ctx }) => {
  let to = null; ctx.tourxSetSection = v => { to = v; };
  try { fire(html({ key: PARIS, view: 'stats' }), 'allstats'); ok(to === 'reports', 'tourxSetSection("reports"): ' + to); }
  finally { delete ctx.tourxSetSection; }
});
check('Lyon (October) is the new indoor event, never the clay Lyon Open (mutant: name map removed)', ({ html }) => {
  const raw = html({ key: LYON, view: 'stats' }), t = text(raw);
  ok(!/title="20(1\d|2[0-5]) · [+−]?\d/.test(raw), 'a past-edition bar on Lyon (France): ' + (raw.match(/title="20\d\d · [^"]+"/) || [])[0]);
  const st = t.match(/Backing favourites ([^ ]+)/)[1];
  ok(st === DASH, 'Lyon (France) has no 2025 edition → dash: ' + st);
  ok(/Backing favourites [^ ]+ vs tour [^ ]+ vs 2024 — vs past five —/.test(t), 'no Lyon Open (clay) edition leaks into Lyon (France)');
});
check('no raw colour, scoped CSS, no demo draw or leftovers (mutant: a hex colour)', ({ src }) => {
  ok(!/#[0-9a-fA-F]{6}\b|rgba?\(\s*\d/.test(src), 'raw colour in the module');
  ok(src.includes(".tabpage[data-page=\"tournaments\"] .tt-draw"), 'scoped selector');
  ok(!/metz|DT_OLD|showSheet|sheetNote|legMeet/i.test(src.replace('No METZ demo, no DT_OLD, no leftovers', '')), 'no Metz demo / leftovers');
});
check('a finished match opens Match Analysis from the draw result; qualifying never (mutant: no click)', ({ win, html, ctx }) => withResults(ctx, () => {
  const raw = html({ key: PARIS });
  const n = (raw.match(/class="tt-draw-score"/g) || []).length;
  const wo = ctx.tournamentProgression.drawResults.Paris.matches.filter(m => m.status === 'walkover').length;
  ok(n === 2 * (55 - wo), `every played Paris match has a clickable score on both rows (walkovers carry none): ${n} of ${2 * (55 - wo)}`);
  ok(/W\/O/.test(text(raw)), 'a walkover shows grey "W/O"');
  const fin = ctx.tournamentProgression.drawResults.Paris.matches.find(m => m.roundCode === 'F');
  const r = win.TTDraw.rowById('past-' + fin.eventKey);
  ok(r && r.finalScore && r.finalScore.sets.length === fin.score.length, 'the final has a row with its set scores');
  ok(r.p1 === fin.p1.name && r.p2 === fin.p2.name && r.p1Key === +fin.p1.playerKey && r.p2Key === +fin.p2.playerKey, 'players and keys are the feed result');
  ok(r.finalScore.winner === (fin.winner === 1 ? 'p1' : 'p2') && r.tour === 'ATP Paris' && /1\/|Final/.test(r.tournamentRound), 'winner, event, round');
  ok(r.date === fin.date && !r.odds && !r.h2h && r.fromDrawResult === true, 'nothing filled in beyond the result');
  const q = html({ key: PARIS, kind: 'qual' });
  ok(/Qualifying round 1/.test(text(q)) && (q.match(/font-weight:700; color:[^;]+;">\d<\/span>/g) || []).length >= 10, 'the qualifying view draws its results (not an empty set)');
  ok(!/tt-draw-score/.test(q), 'a qualifying match is clickable');
}));
check('Download W/UE sheet calls the one sheet export for the open draw, archived draws too (mutant: download not wired)', ({ T, win, html, fire }) => {
  T.FILES['draws-archive.json'] = fx('draws-archive.json');
  const seen = [];
  win.WueSheet = { sheetRounds: e => (e && Array.isArray(e.matches) && e.matches.length ? [{ round: 'R32' }] : []), download: name => { seen.push(name); return Promise.resolve(1); } };
  try {
    const raw = html({ key: 'a:7485' });
    ok((raw.match(/class="tt-draw-score"/g) || []).length === 2 * 26, 'archived Brussels: every played result clickable: ' + (raw.match(/class="tt-draw-score"/g) || []).length);
    fire(raw, 'dl');
    ok(seen.length === 1 && seen[0] === 'Brussels', 'WueSheet.download("Brussels"): ' + JSON.stringify(seen));
    ok(T.S.dl === 'busy', 'the button says it is working');
    const none = html({ key: PARIS });
    ok(/data-tt="dl" onclick=""/.test(none) && /available after the next data update/.test(none), 'no result rows → the button is inert and says why');
  } finally { T.FILES['draws-archive.json'] = null; delete win.WueSheet; }
});
check('player box: nine measures v the field from real scores + box-score metrics, a dash for what we lack (mutant: field not the mean / BP saved invented)', ({ html, ctx, root }) => withResults(ctx, () => {
  const R = ctx.tournamentProgression.drawResults.Paris;
  const met = (aces, f1, s2, hw, ht, rw, rt, bw, bt) => ({ aces, firstServeWonPct: f1, secondServeWonPct: s2, svHold: { won: hw, total: ht }, retGames: { won: rw, total: rt }, bpConv: null,
    bpSaved: bt == null ? null : { won: bw, total: bt } });
  R.players = [{ playerKey: '2382', rounds: [{ metrics: met(6, 80, 60, 10, 10, 4, 10, 3, 4) }, { metrics: met(8, 70, 50, 9, 10, 2, 10, 2, 2) }] },
    { playerKey: '2973', rounds: [{ metrics: met(10, 75, 55, 8, 10, 1, 10, 1, 2) }] },
    { playerKey: '430', rounds: [{ metrics: met(2, 65, 45, 6, 10, 3, 10) }] }];
  try {
    html({ key: PARIS, pop: { key: '2382', x: 10, y: 10, bot: null, side: 'r', ct: 30 } });
    const h = text(root.innerHTML);
    let sw = 0, sl = 0, gw = 0, gl = 0;   // Alcaraz's sets / games from the draw's own scores, computed here
    R.matches.filter(m => m.status !== 'walkover' && (m.p1.playerKey === '2382' || m.p2.playerKey === '2382')).forEach(m => { const me = m.p1.playerKey === '2382' ? 0 : 1;
      m.score.forEach(s => { const a = s[me], b = s[1 - me]; gw += a; gl += b; if ((Math.max(a, b) >= 6 && Math.abs(a - b) >= 2) || (Math.max(a, b) === 7 && Math.min(a, b) >= 5)) { if (a > b) sw++; else sl++; } }); });
    ok(h.includes(`Sets won ${Math.round(100 * sw / (sw + sl))}%`), `sets won ${sw}/${sw + sl}: ` + (h.match(/Sets won [^ ]+/) || [])[0]);
    ok(h.includes(`Games won ${Math.round(100 * gw / (gw + gl))}%`), 'games won');
    ok(/Aces per match 7\.0 \+0\.7 6\.3 2nd/.test(h), 'aces: 7.0 v the field mean of 7.0 / 10.0 / 2.0: ' + (h.match(/Aces per match [^A-Z]+/) || [])[0]);
    ok(/Service games held 95% \+17 78% 1st/.test(h), 'hold: 19/20 v the field mean of 95 / 80 / 60: ' + (h.match(/Service games held [^A-Z]+/) || [])[0]);
    ok(/Break points saved 83% \+16 67% 1st/.test(h), 'BP saved: 5/6 v the field mean of 83 / 50 (founder 2026-11-20: the feed carries it): ' + (h.match(/Break points saved [^A-Z]+/) || [])[0]);
    ok(/Break points converted — — —/.test(h), 'BP converted: no counts → a dash row');
    ok(/Champion/.test(h) && /Route ›/.test(h), 'status chip + Route');
    ok(/position:fixed; z-index:20/.test(root.innerHTML), 'fixed layer');
  } finally { delete R.players; }
}));
check('points to defend: rows, Would be from ranking points, sort tiles (mutant: would-be off by the defended points / sort ignored)', ({ T, html, root, fire }) => {
  const raw = html({ key: PARIS, view: 'pts' }), h = text(raw);
  ok(/Points to defend Points won here in 2025/.test(h) && new RegExp(`Points across ${PEV.rows.length} players ${PT_TOTAL}`).test(h), 'head: ' + (h.match(/Points across [^A-Z]+/) || [])[0]);
  const idx = standings(), sin = idx.find(r => r.key === '2072'), want = 1 + idx.filter(o => o.key !== '2072' && o.points != null && o.points > sin.points - 1000).length;
  ok(new RegExp(`J\\. Sinner Champion 1000 No\\. 2 → No\\. ${want} −${want - 2}`).test(h), `Sinner would be No. ${want}: ` + (h.match(/J\. Sinner .{0,60}/) || [])[0]);
  ok(/D\. Medvedev \[4\] Quarter-final 200 No\. 5 → — —/.test(h), 'Medvedev has no ranking points → dash: ' + (h.match(/D\. Medvedev .{0,50}/) || [])[0]);
  ok(/Nothing to defend/.test(h), 'zero rows as chips');
  fire(raw, 'pt-drop');
  ok(T.S.ptSort === 'drop', 'the tile sorts');
  const ev = T.events().all.find(e => e.key === PARIS), pm = T.ptsModel(ev, T.facts(T.modelOf(ev, 'main'), ev));
  const nd = r => (r.drop == null ? -1 : r.drop);
  const byDrop = pm.rows.slice().sort((a, b) => nd(b) - nd(a) || (b.pts || 0) - (a.pts || 0)).slice(0, 6).map(r => r.n);
  const byPts = pm.rows.slice().sort((a, b) => (b.pts || 0) - (a.pts || 0) || nd(b) - nd(a)).slice(0, 6).map(r => r.n);
  ok(byDrop.join() !== byPts.join(), 'the two orders differ on this data (else the check is vacuous)');
  const shown = [...root.innerHTML.split('Would be')[1].matchAll(/font-size:13\.5px; font-weight:600; color:var\(--tt-white\); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">([^<]+)</g)].slice(0, 6).map(m => m[1]);
  ok(shown.join() === byDrop.join(), `drop sort: ${byDrop.join(', ')} — got ${shown.join(', ')}`);
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
  ['a chance figure without a source', "const qFig = A.qWon ? 'Won' : A.q > 0 ? pctS(A.q) : DASH", "const qFig = A.qWon ? 'Won' : '42%'"],
  ['quarter over the wrong half', "const qi = M.rounds.findIndex(r => r.name === 'QF');\n  const at =", "const qi = M.rounds.findIndex(r => r.name === 'SF');\n  const at ="],
  ['equal 50% fallback', "    if (p != null) src.set(id, 'elo');\n    return p;", "    if (p != null) src.set(id, 'elo');\n    return p == null ? 0.5 : p;"],
  ['played results ignored', "const w = decided(r, lo / span);", "const w = null;"],
  ['weights drift', "const ELO_BLEND = { raw: 0.30, surface: 0.40, blend: 0.30 }", "const ELO_BLEND = { raw: 0.40, surface: 0.30, blend: 0.30 }"],
  ['model price ignored', "  pairP = pairP || modelPairP;", "  pairP = pairP || (() => null);"],
  ['book price ignored', "  if (!(a >= 1.01 && b >= 1.01) || 1 / a + 1 / b - 1 > 0.20) return null;", "  return null;"],
  ['quarter by list index', 'Math.ceil(s.pos / per) === q + 1);', 'Math.floor(F.slots.indexOf(s) / 8) === q);'],
  ['meet round off', 'r = DV().meetRound(pa, Bp.me.pos)', 'r = Math.max(0, DV().meetRound(pa, Bp.me.pos) - 1)'],
  ['retirements not settled', "bet: !!(Sm && Sm.betCounts({ comment: cm, fs }))", 'bet: true'],
  ['Lyon name map removed', "return c === 'Lyon' &&", 'return false &&'],
  ['From on qualifying', "const showFrom = S.kind !== 'qual' && view === 'draw' && !!M;", "const showFrom = view === 'draw' && !!M;"],
  ['a hex colour', "text: 'var(--tt-text)'", "text: '#E7E9EE'"],
  ['no click', "const aid = dec && !wo ? analysisId(ev, m) : null;", "const aid = null;"],
  ['foot note back', "if (S.help) h += helpHtml(finished);", "if (S.help) h += helpHtml(finished); h += '<p>Grey figures on unplayed matches are the current match-winner prices.</p>';"],
  ['help box empty', "<div style=\"margin-top:10px;\">${L.map(", "<div style=\"margin-top:10px;\">${[].map("],
  ['country code box back', "+ avatar(key, s.name ? nameOf(s) : '', 22, W(10), 8.5, country)", "+ `<span style=\"border-radius:5px; padding:2px 4px;\">${esc(s.ioc || 'NEU')}</span>`"],
  ['progress bar always', "if (!finished && Mm) h += ", "if (Mm) h += "],
  ['link dropped', "if (typeof tourxSetSection === 'function') tourxSetSection('reports');", ''],
  ['download not wired', "p = Promise.resolve(window.WueSheet.download(name));", "p = Promise.resolve();"],
  ['field not the mean', "const avg = all.length ? rd(all.reduce((a, x) => a + x, 0) / all.length) : null;", "const avg = all.length ? rd(Math.max.apply(null, all)) : null;"],
  ['BP saved dropped', "['Serve', 'Break points saved', '%', 'bpSaved']", "['Serve', 'Break points saved', '%', null]"],
  ['would-be off by the defended points', 'const left = mine - pts;', 'const left = mine;'],
  ['sort ignored', "const byD = S.ptSort === 'drop';", 'const byD = false;'],
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
