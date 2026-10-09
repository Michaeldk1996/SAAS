// TEN-338 — every check in test-ten338-match-stats.mjs must FAIL when the behaviour it locks is reverted. Each mutant is
// applied to a copy of bsp-consult-dashboard.html and the suite is run against it (TEN338_HTML); a mutant that leaves
// the suite green is a vacuous test and fails this runner. Anchors must occur exactly once in the page.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
  ['uncompleted: back to the old coming-soon line', "  return maMsNotPlayedHtml(!!m.live);   // upcoming / live: no finished box score to show", "  return `<div class=\"acomingsoon\">Box score isn't available until the match finishes.</div>`;"],
  ['live: titled "not played yet"', "      <div style=\"font-size:17px; font-weight:700;\">${live ? MA_MS_IN_PLAY : MA_MS_NOT_PLAYED}</div>", "      <div style=\"font-size:17px; font-weight:700;\">${MA_MS_NOT_PLAYED}</div>"],
  ['not played: not centred in the pane', "  .modal-analysis #aSectionMatchStats:has(> .ma-ms-notplayed){ height:100%; }", ''],
  ['Points won: the W/UE row removed', "      row('Winners / unforced errors', wue, 'ratio'), row('Net points won', net, 'pct'),", "      row('Net points won', net, 'pct'),"],
  ['W/UE: 0 errors read as a ratio', "    return (w.v == null || u.v == null || !u.v) ? { v: null, txt: FH_DASHC,", "    return (w.v == null || u.v == null) ? { v: null, txt: FH_DASHC,"],
  ['Key stats: its own W/UE copy', "    row('Winners / unforced errors', M.wue[0], M.wue[1], 'ratio'),", "    row('Winners / unforced errors', M.wue[1], M.wue[0], 'ratio'),"],
  ['D2: the sheet rates ungated', "  const row = (label, cells, kind, k) => ({ label, a: kind === 'pct' ? fhGateCell(cells[0]) : cells[0], b: kind === 'pct' ? fhGateCell(cells[1]) : cells[1], kind, k });", "  const row = (label, cells, kind, k) => ({ label, a: cells[0], b: cells[1], kind, k });"],
  ['D2: n 1–4 keeps its %', "  if (m === 'nopct') return Object.assign({}, c, { v: null, txt: c.won + '/' + c.total, sub: '', gate: m,", "  if (m === 'nopct') return Object.assign({}, c, { gate: m,"],
  ['D2: no footnote', "  return dr + secs + note + (M.gated ? maSheetGateNote() : '');", "  return dr + secs + note;"],
  ['pbp: SP back to the old target rule', "      const sp = !over && p.a !== p.b && hi >= T - 1 && hi + 1 - lo >= 2;", "      const tgt = Math.max(T, Math.max(lastTb.a, lastTb.b)); const sp = !over && hi > lo && hi >= tgt - 1 && hi < tgt;"],
  ['pbp: 10-point tiebreak not detected', "i < tbPts.length - 1 && Math.max(p.a, p.b) >= 7 && Math.abs(p.a - p.b) >= 2)) ? 10 : 7;", "false)) ? 10 : 7;"],
  ['pbp: caption loses the set score', "  return { set: st.set, label: 'SET ' + st.set + (setSc ? ' · ' + setSc[0] + '-' + setSc[1] : ''), games, tb, won };", "  return { set: st.set, label: 'SET ' + st.set, games, tb, won };"],
  ['pbp: lost serve read off the winner only', "aLost: p.server === 'p1' && w === 'p2', bLost: p.server === 'p2' && w === 'p1',", "aLost: w === 'p2', bLost: w === 'p1',"],
  ['pbp: the old renderer back in the sheet', "        + (st ? fhSheetPbpHtml(fhPbpSetModel(st, fhPbpMatchCtx(sh, S.bo)[st.set])) : '') + `</div>`;", "        + `<div class=\"fh-pbp\">${buildPointByPointHtml({ p1: sh.p1, p2: sh.p2 }, sh, cur)}</div></div>`;"],
  ['pbp: caption guesses 7-6 for any tiebreak', "  const setSc = !lastTb ? fin : !real.length ? [lastTb.a, lastTb.b] : !tbDone || !fin ? fin :", "  const setSc = !lastTb ? fin : true ? (lastTb.a > lastTb.b ? [7, 6] : [6, 7]) :"],
  ['pbp: a match tiebreak read as 7 points', "  const T = !lastTb ? 7 : (!real.length || (c.need", "  const T = !lastTb ? 7 : ((c.need"],
  ['pbp: the feed-order note dropped (G16)', "      const order = fhPbpAIsFirst(S.pbp, S) === null ? `<span class=\"ma-pbp-order\"", "      const order = false ? `<span class=\"ma-pbp-order\""],
  // TEN-349 (ruling Q6): MP on every match point
  ['MP: no sets-needed check (every set point MP)', "if (n + 1 < 2) return false; return c.need ? n + 1 >= c.need : null; };", "return true; };"],
  ['MP: sets won read off the wrong side', "const isMp = side => { const n = side === 'p1' ? c.a : c.b;", "const isMp = side => { const n = side === 'p1' ? c.b : c.a;"],
  ['MP: a Bo5 read as Bo3 (need fixed at 2)', "  const need = (sets.length >= 4 || n1 >= 3 || n2 >= 3) ? 3 : bo === 5 ? 3 : bo === 3 ? 2 : null;", "  const need = 2;"],
  ['MP: an unknown format guessed as Bo3', " : bo === 5 ? 3 : bo === 3 ? 2 : null;", " : bo === 5 ? 3 : 2;"],
  ['MP: a set with no winner still counted', "    if (a != null && won[i] === 'p1') a++; else if (a != null && won[i] === 'p2') b++; else a = b = null; });", "    if (won[i] === 'p1') a++; else if (won[i] === 'p2') b++; });"],
  ['MP: normal games never tagged', "bp: !!p.bp, mp: !!s && setPt(s) && isMp(s) === true };", "bp: !!p.bp, mp: false };"],
  ['MP: a game\'s set point without two clear', "return own >= 6 && own - oth >= 2; };", "return own >= 6; };"],
  ['MP: the tiebreak MP drawn as SP', "${p.spA ? sp : p.mpA ? mp : ''}", "${p.spA || p.mpA ? sp : ''}"],
  ['MP: the game chip not drawn', "${p.bp ? bp : ''}${p.mp ? mp : ''}</span>", "${p.bp ? bp : ''}</span>"],
  ['MP: the sheet drops the format', "setScores: r.sets || null, bo: r.bo || fhBestOf(r),", "setScores: r.sets || null,"],
  ['MP: a Bo5 fifth-set tiebreak read as 7 points', " || (c.need === 3 && Number(st.set) === 5) || ", " || "],
  ['MP: the set winner read off T (a repeated point loses the set)', "  const won = lastTb ? (Math.max(lastTb.a, lastTb.b) >= 7 && Math.abs(lastTb.a - lastTb.b) >= 2 ?", "  const won = lastTb ? (tbDone ?"],
  ['header: raw surface', "      tourn: m.tour, surface: fhSurfName(m.surface), round:", "      tourn: m.tour, surface: m.surface, round:"],
  ['header: a missing round dropped', " r.surface || FH_DASHC, r.round || FH_DASHC, dateTxt]", " r.surface || FH_DASHC, r.round, dateTxt]"],
  ['DoD 8: the old stat sheet back', "function maMsNotPlayedHtml(live){", "function buildMatchStatsSheet(m, setNo){ return ''; }\nfunction maMsNotPlayedHtml(live){"],
];
MUTANTS.push(
  ['Q3: bars by identity (A solid, B 45%) instead of leader / trailer', "${fill(aW, aCol, s.a)}</span>", "${fill(aW, 'var(--bar)', s.a)}</span>"],
);
const SUITES = ['test-ten338-match-stats.mjs'];
// Control: the unmutated page must pass, or every "caught" below means nothing.
{ const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('✖ the suite is red on the unmutated page — mutants are meaningless'); process.exit(1); }
  console.log('✔ control: the unmutated page passes'); }
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten338-mut-'));
for (const [name, from, to] of MUTANTS) {
  if (html.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, html.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, { TEN338_HTML: file }), encoding: 'utf8' });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
