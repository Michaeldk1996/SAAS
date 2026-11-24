// Tournaments → Reports rebuild (tournaments-reports.js, founder rulings 2026-11-15). Executes the SHIPPED module on a
// real-data fixture (tools/fixtures/tt-reports/stockholm-2026.json: the deployed tournament-progression.json entry, the
// page's own tourxBuildTournament output for it, and the dna-apitennis-ratings.json rows of its players, captured
// 15 Nov 2026) and checks structure, the dash rules and the data sources, to the 2026-11-20 handoff (leader strip, gap
// chip, Player Profile bar pair, avatars by key, no Quarter row without quarters, the season finals' RR rounds). Each
// mutant must turn a check red.
// Run: node tools/test-tt-reports.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'tournaments-reports.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/tt-reports/stockholm-2026.json'), 'utf8'));

function grab(name) {
  const i = HTML.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0;
  for (let k = HTML.indexOf('{', i); k < HTML.length; k++) { if (HTML[k] === '{') d++; else if (HTML[k] === '}' && --d === 0) return HTML.slice(i, k + 1); }
  throw new Error('unbalanced ' + name);
}
// The page's own fallbacks (used only when a round has no match row): sliced, not re-implemented.
const pageBox = {};
vm.createContext(pageBox);
vm.runInContext(grab('tourxRoundOutcome') + '\n' + grab('tourxPlayerScore') + '\nthis.o = tourxRoundOutcome; this.s = tourxPlayerScore;', pageBox);

function load(src) {
  // playerPhotoImg stub: the page's one resolver, by player KEY (the test reads the key back off the <img>).
  const box = { console, playerPhotoImg: (k, n) => `<img class="sf-ph" data-k="${k}" alt="${n}">` };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(src, box);
  const I = box.TTReports._internals; I.box = box; return I;
}
const surname = n => { const w = n.trim().split(/\s+/); let i = 0; while (i < w.length - 1 && /\.$/.test(w[i])) i++; return i ? w.slice(i).join(' ') : w[w.length - 1]; };
const strip = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const AV = [{ key: 'Stockholm', display: 'Stockholm', year: '2026' }];
const cardOf = (h, k, cls) => (h.split('data-metric="' + k + '"')[1] || '').split('class="' + cls + '"')[0];
const flabels = h => [...h.matchAll(/class="tt-rp-flabel">([^<]+)</g)].map(m => m[1]).join('|');

// Season finals (synthetic, the pipeline's 2026-11-20 shape): group rounds RR1–RR3 then SF, F; a group loss is no exit.
function finalsT() {
  const met = v => ({ serveRating: v, firstServePct: v / 4, firstServeWonPct: 70, secondServeWonPct: 50, returnRating: 100, dominanceRatio: 1, pressurePct: null, winnersPct: 18, unforcedErrorsPct: 15, winnersUnforcedRatio: 1.2 });
  const rounds = ['RR1', 'RR2', 'RR3', 'SF', 'F'];
  const pl = (name, key, per) => ({ name, playerKey: key, eliminated: false, eliminatedKnown: true, maxWonIdx: 2, drawDepth: per.filter(Boolean).length,
    data: Object.fromEntries(Object.keys(met(0)).map(k => [k, per.map(x => x ? met(x[1])[k] : null)])), opponents: per.map(x => x ? x[0] : null), results: per.map(() => null) });
  const players = [
    pl('J. Sinner', '1', [['A. Zverev', 300], ['T. Fritz', 310], ['L. Musetti', 290], ['B. Shelton', 305], null]),
    pl('A. Zverev', '2', [['J. Sinner', 280], ['L. Musetti', 285], ['T. Fritz', 270], null, null]),
    pl('T. Fritz', '3', [null, ['J. Sinner', 260], ['A. Zverev', 275], null, null]),
    pl('L. Musetti', '4', [['X. Nobody', 250], ['A. Zverev', 255], ['J. Sinner', 240], null, null]),
  ];
  const mt = (round, a, ka, b, kb, winner) => ({ round, winner, status: 'finished', hasStats: true, score: [[6, 4], [6, 4]], p1: { name: a, playerKey: ka }, p2: { name: b, playerKey: kb } });
  // Zverev beats Sinner in RR1 (a group LOSS for Sinner, who goes on); T. Fritz's RR1 has no row.
  const matches = [mt('RR1', 'A. Zverev', '2', 'J. Sinner', '1', 1), mt('RR2', 'J. Sinner', '1', 'T. Fritz', '3', 1), mt('RR3', 'J. Sinner', '1', 'L. Musetti', '4', 1),
    mt('RR2', 'L. Musetti', '4', 'A. Zverev', '2', 2), mt('RR3', 'A. Zverev', '2', 'T. Fritz', '3', 2), mt('SF', 'J. Sinner', '1', 'B. Shelton', '9', 1)];
  return { name: 'Turin', rounds, roundLabels: rounds.slice(), players, matches };
}

function run(src) {
  const fails = [], ok = (name, cond, got) => { if (!cond) fails.push(name + (got !== undefined ? ' | got ' + JSON.stringify(got).slice(0, 200) : '')); };
  let I;
  try { I = load(src); } catch (e) { return ['module failed to load: ' + e.message]; }
  const env = q => ({ T: JSON.parse(JSON.stringify(FX.T)), raw: FX.raw, quarterOf: q, setsToWin: FX.setsToWin, year: FX.year, surface: 'hard',
    roundOutcome: pageBox.o, playerScore: pageBox.s });
  const html = (M, st, av) => { I.reset(); Object.assign(I.state, { view: 'round' }, st || {}); I.setModel(M); return I.viewHtml(M, av || AV); };

  // ---------- no draw posted (the real state of Stockholm: draws.json holds no sheet for it) ----------
  const M0 = I.build(env(() => null));
  const rc0 = html(M0);
  ok('no quarters → no Quarter row: Tournament · Report · Round · Players · Metrics', flabels(rc0) === 'Tournament|Report|Round|Players|Metrics', flabels(rc0));
  ok('the "?" (16px round) sits at the end of the Tournament row with the Round comparison help', /data-v="Stockholm">Stockholm <span class="tt-rp-pfig">2026<\/span><\/span><span class="tt-rp-help" title="Players are ranked inside each quarter\. The blue bar/.test(rc0));
  ok('tournament pills: printed name + year, every event offered, the open one picked',
    (() => { const h = html(M0, null, [{ key: 'Paris', display: 'Paris', year: '2026' }, { key: 'Stockholm', display: 'Stockholm', year: '2026' }]);
      return /tt-rp-pill tour" data-act="tour" data-v="Paris">Paris <span class="tt-rp-pfig">2026</.test(h) && /tt-rp-pill tour on" data-act="tour" data-v="Stockholm"/.test(h); })());
  ok('no title / helper sentence between the filter card and the cards', !/ranked by metric|winners only|Quarters appear once/.test(rc0));
  ok('no quarters → no "Quarter —" heads and no Q tags', !/tt-rp-qhead/.test(rc0) && !/tt-rp-qtag/.test(rc0));
  const qfIdx = FX.T.roundLabels.indexOf('QF');
  const qfPlayers = FX.T.players.filter(p => Object.values(p.data).some(a => a[qfIdx] != null)).map(p => p.name);
  const qfLosers = FX.T.matches.filter(m => m.round === FX.T.rounds[qfIdx] && m.hasStats).map(m => (m.winner === 1 ? m.p2 : m.p1).name);
  ok('RC default round is QF', /tt-rp-rpill on" data-act="rcrnd" data-v="2"/.test(rc0));
  ok('QF lists every player with a QF box score, losers included', new RegExp(`${qfPlayers.length} of ${qfPlayers.length} players shown`).test(rc0) && qfLosers.every(n => rc0.includes('title="' + n + '"')), { qfPlayers, qfLosers });
  const sr = FX.T.players.map(p => p.data.serveRating[qfIdx]).filter(v => v != null);
  ok('Round avg = mean of the rows shown (Serve rating)', cardOf(rc0, 'serveRating', 'tt-rp-mcard').includes('Round avg <b>' + Math.round(sr.reduce((a, b) => a + b, 0) / sr.length) + '</b>'));
  const wc = cardOf(rc0, 'winnersPct', 'tt-rp-mcard');
  ok('Winners are per point (0.xx), never %', /tt-rp-rval[^>]*>0\.\d\d</.test(wc) && !/tt-rp-rval[^>]*>[^<]*%</.test(wc));
  const m0 = FX.T.matches.find(m => m.round === FX.T.rounds[qfIdx] && m.hasStats);
  const s1 = m0.p1, dom = (s1.returnPoints.won / s1.returnPoints.total) / (1 - s1.servicePoints.won / s1.servicePoints.total);
  const P1 = M0.players.find(p => p.key === String(s1.playerKey));
  ok('Dominance is exact from the match point counts', Math.abs(P1.vals.dominanceRatio[qfIdx] - dom) < 1e-9, [P1.vals.dominanceRatio[qfIdx], dom]);
  ok('a 0-break-point match: Pressure points is a dash (no figure)', !!M0.players.find(p => p.vals.pressurePct.some((v, i) => v == null && p.played[i])));
  ok('no NaN / undefined printed', !/tt-rp-rval[^>]*>(NaN|undefined|null)/.test(rc0) && !/NaN/.test(rc0));
  ok('pct figures carry one decimal', /tt-rp-rval[^>]*>\d+\.\d%</.test(cardOf(rc0, 'firstServePct', 'tt-rp-mcard')));
  const cards0 = rc0.split('class="tt-rp-mcard"').slice(1);
  ok('bars: the leader full blue (one per group), every other bar the quiet past grey, no 55% blue',
    cards0.length === 10 && cards0.every(c => (c.match(/tt-rp-rbar" style="[^"]*background:var\(--tt-blue\)/g) || []).length === 1 && (c.match(/background:var\(--tt-past\)/g) || []).length >= 1) && !/--tt-blue\) 55%/.test(rc0));
  const rowAv = [...cardOf(rc0, 'serveRating', 'tt-rp-mcard').matchAll(/tt-rp-av" style="width:22px;[^"]*">[A-Z]*<img class="sf-ph" data-k="([^"]+)"[^>]*><\/span><a class="tt-rp-plink tt-rp-rname" href="#" data-act="profile" data-key="([^"]+)"/g)];
  ok('every chart row: a 22px avatar whose photo is resolved by the row\'s own player key', rowAv.length === qfPlayers.length && rowAv.every(m => m[1] === m[2]), rowAv.length);

  // ---------- with a posted draw (test-only quarters by playerKey, never shown on the site) ----------
  const QF = FX.T.matches.filter(m => m.round === FX.T.rounds[qfIdx]);
  const qmap = {}; QF.forEach((m, i) => { qmap[m.p1.playerKey] = i + 1; qmap[m.p2.playerKey] = i + 1; });
  const M1 = I.build(env(k => qmap[k] || null));
  const rc1 = html(M1);
  ok('a draw with quarters → the Quarter row is back', flabels(rc1) === 'Tournament|Report|Quarter|Round|Players|Metrics', flabels(rc1));
  const sr1 = cardOf(rc1, 'serveRating', 'tt-rp-mcard');
  const heads = [...sr1.matchAll(/tt-rp-qhead">([^<]+)</g)].map(m => m[1]);
  ok('quarters run 1 → 4 inside each card', heads[0] === 'Quarter 1' && heads.every((h, i) => !i || h > heads[i - 1] || h === 'Quarter —'), heads);
  ok('the rank restarts at 1 in every quarter', (sr1.match(/tt-rp-rrank">1</g) || []).length === heads.length);
  ok('each quarter\'s leader is full blue', (sr1.match(/tt-rp-rbar" style="[^"]*background:var\(--tt-blue\)/g) || []).length === heads.length);
  ok('chips carry the Q tag', /tt-rp-qtag">Q[1-4]</.test(rc1));
  const w1 = QF[0].winner === 1 ? QF[0].p1 : QF[0].p2;
  ok('Quarter 1 pill = the player who won his quarter-final', rc1.includes('Quarter 1 <span class="tt-rp-pfig">' + surname(w1.name) + '<'), surname(w1.name));
  const env2 = env(k => qmap[k] || null); env2.T.matches = env2.T.matches.map(m => (m.round === FX.T.rounds[qfIdx] && String(m.p1.playerKey) === String(QF[0].p1.playerKey) ? Object.assign({}, m, { winner: null, status: 'scheduled' }) : m));
  ok('an unplayed quarter-final → the Quarter pill is a dash', html(I.build(env2)).includes('Quarter 1 <span class="tt-rp-pfig">—<'));
  const rcQ = html(M1, { qSel: 2 });
  ok('Quarter 2 filter → only Quarter 2 groups', [...rcQ.matchAll(/tt-rp-qhead">([^<]+)</g)].every(m => m[1] === 'Quarter 2'));

  // ---------- Player progression ----------
  const pp = html(M0, { view: 'player' });
  ok('PP filter rows add Reached and "Rounds through"', flabels(pp) === 'Tournament|Report|Reached|Rounds through|Players|Metrics', flabels(pp));
  ok('PP default = every player, rounds through F ("Showing every round played.")', (pp.match(/class="tt-rp-chip( focus)?"/g) || []).length === M0.players.length && /Showing every round played\./.test(pp));
  const reachedRow = pp.split('>Reached</span>')[1].split('class="tt-rp-frow')[0];
  ok('Reached pills: Any round + the last three rounds', [...reachedRow.matchAll(/data-act="ppmin" data-v="\d+">([^<]+)</g)].map(m => m[1]).join('|') === 'Any round|QF|SF|F');
  ok('heat Avg never prints "(n)"', !/tt-rp-havg[^>]*><span>[^<]*\(/.test(pp));
  const fsp = pp.split('data-metric="firstServePct"')[1];
  ok('% heat cells drop the "%", the Avg keeps it', /tt-rp-hcell live[^>]*>\d+\.\d</.test(fsp) && /tt-rp-havg[^>]*><span>\d+\.\d%</.test(fsp));
  ok('heat rows: rank, a 20px avatar by key, the name', /tt-rp-hrank">1<\/span><span class="tt-rp-av" style="width:20px;[^"]*">[A-Z]*<img class="sf-ph" data-k="\d+"/.test(pp));
  const sfI = FX.T.roundLabels.indexOf('SF');
  ok('Reached SF keeps only players who reached the SF', (html(M0, { view: 'player', ppMin: sfI }).match(/class="tt-rp-chip( focus)?"/g) || []).length === M0.players.filter(p => p.reachedIdx >= sfI).length);
  const ppQF = html(M0, { view: 'player', ppRound: qfIdx });
  ok('Rounds through QF drops the SF / F columns', !/tt-rp-hround">SF</.test(ppQF) && /Showing rounds up to QF\./.test(ppQF));
  ok('Field avg row present', /Field avg/.test(pp));
  // leader strip: best average over the shown rounds among players with ≥ LEAD_MIN matches carrying the measure
  const ldName = h => ((h.match(/tt-rp-leadname"[^>]*>([^<]+)</) || [])[1]);
  const srCard = cardOf(pp, 'serveRating', 'tt-rp-ppcard');
  const want = M0.players.map(p => { const vs = p.vals.serveRating.filter(v => v != null); return { p, n: vs.length, a: vs.length ? vs.reduce((x, y) => x + y, 0) / vs.length : null }; })
    .filter(e => e.n >= 2).sort((x, y) => y.a - x.a || y.n - x.n)[0];
  ok('Serve rating leader = the best average among players with 2+ matches', ldName(srCard) === want.p.name, [ldName(srCard), want.p.name]);
  ok('the leader strip says "Best over the week", its guard in the hover, "n matches", a signed gap vs field',
    /tt-rp-leadcap" title="[^"]*at least 2 matches with this measure[^"]*">Best over the week</.test(srCard) && /· \d+ matches</.test(srCard) && /<b style="color:var\(--tt-(green|red|muted)\);">[+−]\d+<\/b> vs field/.test(srCard));
  ok('unforced errors: "Lowest over the week"', /Lowest over the week</.test(cardOf(pp, 'unforcedErrorsPct', 'tt-rp-ppcard')));
  // a one-match player with the best figure never owns the box
  const Mx = JSON.parse(JSON.stringify(M0)); Object.assign(Mx, { reachedLabel: M0.reachedLabel, qWinner: M0.qWinner });
  Mx.players = M0.players.map(p => Object.assign({}, p, { vals: JSON.parse(JSON.stringify(p.vals)) }));
  const one = Mx.players.find(p => p.vals.serveRating.filter(v => v != null).length === 1);
  one.vals.serveRating = one.vals.serveRating.map(v => v == null ? null : 999);
  ok('a one-match player with the top figure does not own the leader strip', !!one && ldName(cardOf(html(Mx, { view: 'player' }), 'serveRating', 'tt-rp-ppcard')) !== one.name, one && one.name);

  // ---------- Head-to-head ----------
  I.reset(); Object.assign(I.state, { view: 'h2h', dna: { byKey: FX.dna } }); I.setModel(M0);
  const h2 = I.viewHtml(M0, AV);
  ok('H2H filter rows: Tournament · Report · Players (no Quarter)', flabels(h2) === 'Tournament|Report|Players');
  const champ = FX.T.matches.find(m => m.round === FX.T.rounds[FX.T.rounds.length - 1]);
  const champName = (champ.winner === 1 ? champ.p1 : champ.p2).name;
  ok('H2H default pair = the champion first, picker reads "Champion"', h2.includes('tt-rp-pname">' + champName + '<') && h2.includes('tt-rp-preach">Champion<'));
  ok('pickers carry a 22px avatar, Swap is a lifted button', /tt-rp-dot[^>]*><\/span><span class="tt-rp-av" style="width:22px;/.test(h2) && /class="tt-rp-swap" data-act="swap"[^>]*>Swap</.test(h2));
  const titles = [...h2.matchAll(/class="tt-rp-hhfig[^"]*" title="([^"]*)"/g)].map(m => m[1]);
  ok('ten stat rows', titles.length === 20, titles.length);
  const NOSRC = [6, 7, 8, 9];
  ok('52 wk hover: six stats from DNA, a dash for Pressure, Winners, UE, W/UE', titles.every((t, i) => NOSRC.includes(Math.floor(i / 2)) ? t.startsWith('His last 52 weeks: —') : /^His last 52 weeks: [\d.]+%? \([+−]?[\d.]+ here\) · \d+ matches/.test(t)), titles.filter((t, i) => i % 2 === 0));
  ok('the hover states n for the tournament figure too', titles.every(t => / here: mean of \d+ match/.test(t)));
  // gap chip = player one minus player two on the printed figures, signed; tally = measures led
  const rows = [...h2.matchAll(/tt-rp-hhrow" data-metric="([^"]+)"><span class="tt-rp-hhfig" title="[^"]*" style="font-weight:(\d+);[^"]*">([^<]+)<\/span>.*?tt-rp-gap"[^>]*>([^<]+)<\/span>.*?tt-rp-hhfig r" title="[^"]*" style="font-weight:(\d+);[^"]*">([^<]+)</g)];
  ok('ten gap chips', rows.length === 10, rows.length);
  const decOf = k => (I.METRICS.find(m => m.key === k).kind === 'rating' ? 0 : I.METRICS.find(m => m.key === k).kind === 'pct' ? 1 : 2);
  const bad = rows.filter(r => { if (r[3] === '—' || r[6] === '—') return r[4] !== '—'; const d = Number((parseFloat(r[3]) - parseFloat(r[6])).toFixed(decOf(r[1]))); return r[4] !== (d === 0 ? 'Level' : (d > 0 ? '+' : '−') + Math.abs(d).toFixed(decOf(r[1]))); });
  ok('every gap chip = A − B on the printed figures, signed, "Level" when equal', !bad.length, bad.map(r => r.slice(1, 7)));
  const la = rows.filter(r => r[2] === '700').length, lb = rows.filter(r => r[5] === '700').length;
  ok('"Measures led" tally = the rows each player leads', new RegExp(`tt-rp-tallyfig"><span[^>]*>${la}</span><span class="tt-rp-tallydash">–</span><span[^>]*>${lb}<`).test(h2), [la, lb]);
  ok('card head: 44px avatars, "round reached · n matches"', (h2.match(/tt-rp-av" style="width:44px;/g) || []).length === 2 && /tt-rp-h2hmeta">Champion · \d+ matches</.test(h2));
  ok('footer + lifted button carry both api-tennis keys', /These figures cover Stockholm 2026 only/.test(h2) && /data-act="full-h2h" data-a="\d+" data-b="\d+">Open the full head to head <span class="tt-rp-arr">›<\/span>/.test(h2));
  ok('no visible 52-week line in the card', !/52 wk/.test(strip(h2)));

  // ---------- a match opens the one Match analysis on Match Stats (founder 2026-11-24): no sheet of its own ----------
  const asked = [];
  I.box.sfFinishedMatchId = (a, b, ev, rd) => { asked.push([a, b, ev, rd]); return 'past-1'; };
  I.reset(); Object.assign(I.state, { view: 'round', rcRound: qfIdx }); I.setModel(M0);
  const sh = I.viewHtml(M0, AV);
  ok('a played bar opens Match analysis on its match (both keys, the event, the round code); no Reports sheet',
    /data-act="ma" data-id="past-1"/.test(sh) && !/tt-rp-s(heet|row|title)/.test(sh) && asked.some(c => c[0] && c[1] && c[2] === M0.name && c[3] === M0.rounds[qfIdx]), asked.slice(0, 2));
  I.box.sfFinishedMatchId = () => null;
  ok('no match on file → the bar opens nothing', !/data-act="ma"/.test(I.viewHtml(M0, AV)));
  delete I.box.sfFinishedMatchId;

  // ---------- season finals: RR1–RR3, no quarters, W/L per match ----------
  const MF = I.build({ T: finalsT(), raw: {}, quarterOf: () => null, setsToWin: 2, year: '2026', surface: 'hard', display: 'Turin', roundOutcome: pageBox.o, playerScore: pageBox.s });
  const fr = html(MF, null, [{ key: 'Turin', display: 'Turin', year: '2026' }]);
  ok('finals: no Quarter row', flabels(fr) === 'Tournament|Report|Round|Players|Metrics', flabels(fr));
  ok('finals: round chips RR1 · RR2 · RR3 · SF · F', [...fr.matchAll(/data-act="rcrnd" data-v="\d">([^<]+)</g)].map(m => m[1]).join('|') === 'RR1|RR2|RR3|SF|F');
  ok('finals: opens on the latest round with a box score (SF), no QF to fall back on', /tt-rp-rpill on" data-act="rcrnd" data-v="3"/.test(fr));
  const fr1 = html(MF, { rcRound: 0 });
  ok('finals: Sinner LOST his RR1 match (the match row), Zverev won it', /J\. Sinner vs A\. Zverev · RR1 · lost 0–2/.test(fr1) && /A\. Zverev vs J\. Sinner · RR1 · won 2–0/.test(fr1), strip(fr1).slice(0, 300));
  const sin = MF.players.find(p => p.name === 'J. Sinner'), fri = MF.players.find(p => p.name === 'T. Fritz');
  ok('finals: a group loss is no exit — Sinner reached the final, a group round with no match row has no outcome', sin.outcome(0) === false && sin.outcome(1) === true && MF.reachedLabel(fri) === 'Group stage' && fri.outcome(0) === null);
  ok('finals: Reached pills = Any round · RR3 · SF · F', [...html(MF, { view: 'player' }).split('>Reached</span>')[1].split('class="tt-rp-frow')[0].matchAll(/data-act="ppmin" data-v="\d+">([^<]+)</g)].map(m => m[1]).join('|') === 'Any round|RR3|SF|F');
  I.reset(); Object.assign(I.state, { view: 'h2h' }); I.setModel(MF);
  ok('finals: H2H footer names the event', /These figures cover Turin 2026 only/.test(I.viewHtml(MF, AV)));

  // ---------- sources + colour ----------
  ok('quarters come only from WueSheet.playerQuarter (no QMAP / finishing-order rule)', /WS\.playerQuarter\(draw, k\)/.test(src) && !/QMAP|hash\(/.test(src));
  ok('no raw colour in the module', !/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(src.replace(/\/\/[^\n]*/g, '')));
  ok('no caps labels in the module (small labels 11.5/600 grey, never caps)', !/text-transform:\s*uppercase/.test(src));
  ok('the 52 wk path has no source for Pressure / Winners / UE / W/UE', !/pressurePct:\s*\[|winnersPct:\s*\[|unforcedErrorsPct:\s*\[|winnersUnforcedRatio:\s*\[/.test(src.split('const DNA_PATH')[1].split(';')[0]));
  ok('Reports lists every event through the page\'s tourxReportEntries (tournaments + drawResults)', /tourxReportEntries\(\)/.test(src));
  return fails;
}

const MUTANTS = [
  ['winners-only round pool (the retired 2026-10-24 rule)', 'p.played[rIdx] && (q == null', 'p.played[rIdx] && p.outcome(rIdx) === true && (q == null'],
  ['a guessed quarter for a player not in the draw', "q: env.quarterOf ? env.quarterOf(key) : null", "q: (env.quarterOf && env.quarterOf(key)) || 1 + (p.name.length % 4)"],
  ['quarter winner = most wins (prototype placeholder)', 'if (w && w.playerKey != null && env.quarterOf(String(w.playerKey)) === q) return surname(w.name);', 'return surname(w.name);'],
  ['Round avg over the whole round, not the rows shown', 'const sorted = withV.concat(noV), vals = withV.map(e => e.v), avg = mean(vals);', 'const sorted = withV.concat(noV), vals = withV.map(e => e.v), avg = mean(M.players.map(p => p.vals[k][rIdx]).filter(v => v != null).concat([0]));'],
  ['winners per point printed as %', "return Number(v).toFixed(2);                                   // ratio", "return kind === 'pp' ? (v * 100).toFixed(1) + '%' : Number(v).toFixed(2); // ratio"],
  ['Dominance blended from rounded rates', "vals.dominanceRatio[i] = lost > 0", "vals.dominanceRatio[i] = false"],
  ['Pressure as 0 on a 0-break-point match', "} else vals.pressurePct[i] = null;", "} else vals.pressurePct[i] = 0;"],
  ['52 wk approximation for Pressure', "secondServeWonPct: ['serve', 'secondWonPct'],", "secondServeWonPct: ['serve', 'secondWonPct'], pressurePct: ['underPressure', 'bpSavedPct'],"],
  ['the "(n)" back on the Avg column', '`<span>${fmtAvg(r.avg, m.kind, many)}</span>`', '`<span>${fmtAvg(r.avg, m.kind, many)} (${r.vals.filter(v => v != null).length})</span>`'],
  ['a helper sentence above the cards', "return `<div class=\"tt-rp-wrap\"><div class=\"tt-rp-filter\">${filter}</div>${body}", "return `<div class=\"tt-rp-wrap\"><div class=\"tt-rp-filter\">${filter}</div><p>QF · winners ranked by metric</p>${body}"],
  ['Reached filter ignored', 'p.reachedIdx >= min', 'p.reachedIdx >= 0'],
  ['H2H Quarter row kept', "if (view !== 'h2h') {", "if (true) {"],
  ['the Quarter row on an event without quarters', 'if (M.hasQ) {', 'if (true) {'],
  ['the others back on 55% blue', "r.lead ? 'var(--tt-blue)' : 'var(--tt-past)'", "r.lead ? 'var(--tt-blue)' : 'color-mix(in srgb, var(--tt-blue) 55%, transparent)'"],
  ['a one-match leader', 'const LEAD_MIN = 2;', 'const LEAD_MIN = 1;'],
  ['an unsigned gap chip', "(gd > 0 ? '+' : '−') + Math.abs(gd).toFixed(dec)", "Math.abs(gd).toFixed(dec)"],
  ['a group loss read through the draw fallback', "env.roundOutcome && !/^RR\\d/.test(labels[i])", "env.roundOutcome"],
  ['the photo looked up by name', "playerPhotoImg(String(p.key), p.name)", "playerPhotoImg(String(p.name), p.name)"],
  ['the full-H2H button loses the keys', 'data-a="${esc(pa.key || \'\')}"', 'data-a=""'],
  ['raw colour', "background:var(--tt-blue);`", "background:#5b9bff;`"],
];

const real = run(SRC);
let failed = 0;
if (real.length) { failed++; console.log('FAIL on the shipped module:\n  ' + real.join('\n  ')); }
else console.log('ok   shipped module: every check passes');
for (const [name, from, to] of MUTANTS) {
  if (!SRC.includes(from)) { failed++; console.log('FAIL mutant anchor missing: ' + name); continue; }
  const f = run(SRC.replace(from, to));
  if (!f.length) { failed++; console.log('FAIL mutant survived: ' + name); } else console.log('ok   mutant caught: ' + name + ' (' + f[0].split(' | ')[0] + ')');
}
console.log(`\ntest-tt-reports: ${failed ? failed + ' failed' : 'all passed'} (${MUTANTS.length} mutants)`);
process.exit(failed ? 1 : 0);
