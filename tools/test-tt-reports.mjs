// Tournaments → Reports rebuild (tournaments-reports.js, founder rulings 2026-11-15). Executes the SHIPPED module on a
// real-data fixture (tools/fixtures/tt-reports/stockholm-2026.json: the deployed tournament-progression.json entry, the
// page's own tourxBuildTournament output for it, and the dna-apitennis-ratings.json rows of its players, captured
// 15 Nov 2026) and checks structure, the dash rules and the data sources. Each mutant must turn a check red.
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
  const box = { console };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(src, box);
  return box.TTReports._internals;
}
const surname = n => { const w = n.trim().split(/\s+/); let i = 0; while (i < w.length - 1 && /\.$/.test(w[i])) i++; return i ? w.slice(i).join(' ') : w[w.length - 1]; };
const strip = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

function run(src) {
  const fails = [], ok = (name, cond, got) => { if (!cond) fails.push(name + (got !== undefined ? ' | got ' + JSON.stringify(got).slice(0, 200) : '')); };
  let I;
  try { I = load(src); } catch (e) { return ['module failed to load: ' + e.message]; }
  const env = q => ({ T: JSON.parse(JSON.stringify(FX.T)), raw: FX.raw, quarterOf: q, setsToWin: FX.setsToWin, year: FX.year, surface: 'hard',
    roundOutcome: pageBox.o, playerScore: pageBox.s });
  const html = (M, st) => { I.reset(); Object.assign(I.state, { view: 'round' }, st || {}); I.setModel(M); return I.viewHtml(M, ['Stockholm']); };

  // ---------- no draw posted (the real state of Stockholm: draws.json holds no sheet for it) ----------
  const M0 = I.build(env(() => null));
  const rc0 = html(M0);
  const rows = [...rc0.matchAll(/class="tt-rp-flabel">([^<]+)</g)].map(m => m[1]);
  ok('RC filter rows: Tournament · Report · Quarter · Round · Players · Metrics', rows.join('|') === 'Tournament|Report|Quarter|Round|Players|Metrics', rows);
  ok('the "?" sits at the end of the Tournament row with the Round comparison help', /data-v="Stockholm">Stockholm <span class="tt-rp-pfig">2026<\/span><\/span><span class="tt-rp-help" title="Players are ranked inside each quarter\. The blue bar/.test(rc0));
  ok('no title / helper sentence between the filter card and the cards', !/ranked by metric|winners only|Quarters appear once/.test(rc0));
  ok('no draw → every group is "Quarter —", never a guessed quarter', [...rc0.matchAll(/tt-rp-qhead">([^<]+)</g)].every(m => m[1] === 'Quarter —') && /tt-rp-qhead/.test(rc0));
  ok('no draw → quarter pills carry a dash, chips "Q—"', (rc0.match(/Quarter [1-4] <span class="tt-rp-pfig">—</g) || []).length === 4 && /tt-rp-chipq">Q—</.test(rc0));
  // default round = QF; every player with a QF box score, winners AND losers
  const qfIdx = FX.T.roundLabels.indexOf('QF');
  const qfPlayers = FX.T.players.filter(p => Object.values(p.data).some(a => a[qfIdx] != null)).map(p => p.name);
  const qfLosers = FX.T.matches.filter(m => m.round === FX.T.rounds[qfIdx] && m.hasStats).map(m => (m.winner === 1 ? m.p2 : m.p1).name);
  ok('RC default round is QF', /data-act="rcrnd" data-v="2"/.test(rc0) && /tt-rp-rpill on" data-act="rcrnd" data-v="2"/.test(rc0));
  ok('QF lists every player with a QF box score, losers included', new RegExp(`${qfPlayers.length} of ${qfPlayers.length} players shown`).test(rc0) && qfLosers.every(n => rc0.includes('title="' + n + '"')), { qfPlayers, qfLosers });
  // Round avg = mean of the rows shown
  const card = k => (rc0.split('data-metric="' + k + '"')[1] || '').split('class="tt-rp-mcard"')[0];
  const sr = FX.T.players.map(p => p.data.serveRating[qfIdx]).filter(v => v != null);
  ok('Round avg = mean of the rows shown (Serve rating)', card('serveRating').includes('Round avg <b>' + Math.round(sr.reduce((a, b) => a + b, 0) / sr.length) + '</b>'), card('serveRating').slice(0, 300));
  // per-point figures, never %
  const wc = card('winnersPct');
  ok('Winners are per point (0.xx), never %', /tt-rp-rval[^>]*>0\.\d\d</.test(wc) && !/tt-rp-rval[^>]*>[^<]*%</.test(wc));
  // exact Dominance from the match counts
  const m0 = FX.T.matches.find(m => m.round === FX.T.rounds[qfIdx] && m.hasStats);
  const s1 = m0.p1, dom = (s1.returnPoints.won / s1.returnPoints.total) / (1 - s1.servicePoints.won / s1.servicePoints.total);
  const P1 = M0.players.find(p => p.key === String(s1.playerKey));
  ok('Dominance is exact from the match point counts', Math.abs(P1.vals.dominanceRatio[qfIdx] - dom) < 1e-9, [P1.vals.dominanceRatio[qfIdx], dom]);
  // dash rules: a zero-break-point match → Pressure and Return rating dashes, never 0
  const zero = M0.players.find(p => p.vals.pressurePct.some((v, i) => v == null && p.played[i]));
  ok('a 0-break-point match: Pressure points is a dash (no figure)', !!zero);
  const anyZeroPrinted = /tt-rp-rval[^>]*>(NaN|undefined|null)/.test(rc0);
  ok('no NaN / undefined printed', !anyZeroPrinted && !/NaN/.test(rc0));
  ok('pct figures carry one decimal', /tt-rp-rval[^>]*>\d+\.\d%</.test(card('firstServePct')));
  // blue = best of round only, one per card
  ok('exactly one blue (best of round) bar per RC card', [...rc0.matchAll(/class="tt-rp-mcard"/g)].length === 10 && rc0.split('class="tt-rp-mcard"').slice(1).every(c => (c.match(/background:var\(--tt-blue\)/g) || []).length === 1));

  // ---------- with a posted draw (test-only quarters by playerKey, never shown on the site) ----------
  const keys = FX.T.players.map(p => String(p.playerKey));
  const QF = FX.T.matches.filter(m => m.round === FX.T.rounds[qfIdx]);
  const qmap = {}; QF.forEach((m, i) => { qmap[m.p1.playerKey] = i + 1; qmap[m.p2.playerKey] = i + 1; });
  const M1 = I.build(env(k => qmap[k] || null));
  const rc1 = html(M1);
  const heads = [...rc1.split('data-metric="serveRating"')[1].split('class="tt-rp-mcard"')[0].matchAll(/tt-rp-qhead">([^<]+)</g)].map(m => m[1]);
  ok('quarters run 1 → 4 inside each card', heads.join('|') === ['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4'].filter((_, i) => QF[i] && QF[i].hasStats).concat(heads.includes('Quarter —') ? ['Quarter —'] : []).join('|') || heads[0] === 'Quarter 1', heads);
  ok('the rank restarts at 1 in every quarter', (rc1.split('data-metric="serveRating"')[1].split('class="tt-rp-mcard"')[0].match(/tt-rp-rrank">1</g) || []).length === heads.length);
  const w1 = QF[0].winner === 1 ? QF[0].p1 : QF[0].p2;
  ok('Quarter 1 pill = the player who won his quarter-final', rc1.includes('Quarter 1 <span class="tt-rp-pfig">' + surname(w1.name) + '<'), surname(w1.name));
  const env2 = env(k => qmap[k] || null); env2.T.matches = env2.T.matches.map(m => (m === undefined ? m : (m.round === FX.T.rounds[qfIdx] && String(m.p1.playerKey) === String(QF[0].p1.playerKey) ? Object.assign({}, m, { winner: null, status: 'scheduled' }) : m)));
  const M2 = I.build(env2);
  ok('an unplayed quarter-final → the Quarter pill is a dash', html(M2).includes('Quarter 1 <span class="tt-rp-pfig">—<'));
  const rcQ = html(M1, { qSel: 2 });
  ok('Quarter 2 filter → only Quarter 2 groups', [...rcQ.matchAll(/tt-rp-qhead">([^<]+)</g)].every(m => m[1] === 'Quarter 2'));

  // ---------- Player progression ----------
  const pp = html(M0, { view: 'player' });
  ok('PP filter rows add Reached and "Rounds through"', [...pp.matchAll(/class="tt-rp-flabel">([^<]+)</g)].map(m => m[1]).join('|') === 'Tournament|Report|Quarter|Reached|Rounds through|Players|Metrics');
  ok('PP default = every player, rounds through F ("Every round played")', (pp.match(/class="tt-rp-chip( focus)?"/g) || []).length === M0.players.length && /Every round played/.test(pp));
  const reachedRow = pp.split('>Reached</span>')[1].split('class="tt-rp-frow')[0];
  ok('Reached pills: Any round + the last three rounds', [...reachedRow.matchAll(/data-act="ppmin" data-v="\d+">([^<]+)</g)].map(m => m[1]).join('|') === 'Any round|QF|SF|F', reachedRow.slice(0, 200));
  ok('heat Avg never prints "(n)"', !/\(\d+\)<\/span><\/div>/.test(pp) && !/tt-rp-havg[^>]*>[^<]*\(/.test(pp));
  ok('% heat cells drop the "%", the Avg keeps it', /tt-rp-hcell live[^>]*>\d+\.\d</.test(pp.split('data-metric="firstServePct"')[1]) && /tt-rp-havg[^>]*><span>\d+\.\d%</.test(pp.split('data-metric="firstServePct"')[1]));
  const ppSF = html(M0, { view: 'player', ppMin: FX.T.roundLabels.indexOf('SF') });
  const sfReached = M0.players.filter(p => p.reachedIdx >= FX.T.roundLabels.indexOf('SF')).length;
  ok('Reached SF keeps only players who reached the SF', (ppSF.match(/class="tt-rp-chip( focus)?"/g) || []).length === sfReached, sfReached);
  const ppQF = html(M0, { view: 'player', ppRound: qfIdx });
  ok('Rounds through QF drops the SF / F columns', !/tt-rp-hround">SF</.test(ppQF) && /Up to the QF/.test(ppQF));
  ok('Field avg row present', /Field avg/.test(pp));

  // ---------- Head-to-head ----------
  const dnaByKey = FX.dna;
  I.reset(); Object.assign(I.state, { view: 'h2h', dna: { byKey: dnaByKey } }); I.setModel(M0);
  const h2 = I.viewHtml(M0, ['Stockholm']);
  ok('H2H filter rows: Tournament · Report · Players (no Quarter)', [...h2.matchAll(/class="tt-rp-flabel">([^<]+)</g)].map(m => m[1]).join('|') === 'Tournament|Report|Players');
  const champ = FX.T.matches.find(m => m.round === FX.T.rounds[FX.T.rounds.length - 1]);
  const champName = (champ.winner === 1 ? champ.p1 : champ.p2).name;
  ok('H2H default pair = the champion first, picker reads "Champion"', h2.includes('tt-rp-pname">' + champName + '<') && h2.includes('tt-rp-preach">Champion<'));
  const titles = [...h2.matchAll(/class="tt-rp-hhfig[^"]*" title="([^"]*)"/g)].map(m => m[1]);
  ok('ten stat rows', titles.length === 20, titles.length);
  const NOSRC = [6, 7, 8, 9];
  ok('52 wk hover: six stats from DNA, a dash for Pressure, Winners, UE, W/UE', titles.every((t, i) => NOSRC.includes(Math.floor(i / 2)) ? t.startsWith('His last 52 weeks: —') : /^His last 52 weeks: [\d.]+%? \([+−]?[\d.]+ here\) · \d+ matches/.test(t)), titles.filter((t, i) => i % 2 === 0));
  ok('the hover states n for the tournament figure too', titles.every(t => / here: mean of \d+ match/.test(t)));
  ok('footer + button carry both api-tennis keys', /These figures cover Stockholm 2026 only/.test(h2) && /data-act="full-h2h" data-a="\d+" data-b="\d+">Open the full head to head ›/.test(h2));
  ok('no visible 52-week line in the card', !/52 wk/.test(strip(h2)));

  // ---------- match sheet ----------
  const p0 = M0.players.find(p => p.played[qfIdx]);
  I.reset(); Object.assign(I.state, { view: 'round', sheet: { player: p0.name, i: qfIdx } }); I.setModel(M0);
  const sh = I.viewHtml(M0, ['Stockholm']);
  ok('sheet: "Player v Opp", meta "Stockholm 2026 · QF · hard · …", ten rows, no demo footer',
    sh.includes('tt-rp-stitle">' + p0.name) && /tt-rp-smeta">Stockholm 2026 · QF · hard · /.test(sh) && (sh.match(/tt-rp-srow/g) || []).length === 10 && !/Demo data/.test(sh));

  // ---------- sources + colour ----------
  ok('quarters come only from WueSheet.playerQuarter (no QMAP / finishing-order rule)', /WS\.playerQuarter\(draw, k\)/.test(src) && !/QMAP|hash\(/.test(src));
  ok('no raw colour in the module', !/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(src.replace(/\/\/[^\n]*/g, '')));
  ok('the 52 wk path has no source for Pressure / Winners / UE / W/UE', !/pressurePct:\s*\[|winnersPct:\s*\[|unforcedErrorsPct:\s*\[|winnersUnforcedRatio:\s*\[/.test(src.split('const DNA_PATH')[1].split(';')[0]));
  return fails;
}

const MUTANTS = [
  ['winners-only round pool (the retired 2026-10-24 rule)', 'p.played[rIdx] && (S.qSel', 'p.played[rIdx] && p.outcome(rIdx) === true && (S.qSel'],
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
