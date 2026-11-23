// TEN-331 — every check in test-ten331-h2h.mjs must FAIL when the behaviour it locks is reverted. Each mutant is
// applied to a copy of bsp-consult-dashboard.html and the suite is run against it (TEN331_HTML); a mutant that leaves
// the suite green is a vacuous test and fails this runner. Anchors must occur exactly once in the page.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
  ["N1: H2H opens on today's surface", "      h2h: { surf: 'all', allLines: false, stat: null },", "      h2h: { surf: fhSurfName(m.surface) || 'all', allLines: false, stat: null },"],
  ['hot lines: a line with fewer than 3 eligible meetings appears', "  }).filter(x => x.n >= min);", "  }).filter(x => x.n > 0);"],
  ['hot: results mode off', "  const results = N < FH_HOT_MIN_ELIGIBLE;", "  const results = false;"],
  ['hot: format lock off', "  if (def.bo && def.need !== 'set1' && r.bo !== def.bo) return false;", "  if (false) return false;"],
  ['hot: set-1 lines format-locked', "  if (def.bo && def.need !== 'set1' && r.bo !== def.bo) return false;", "  if (def.bo && r.bo !== def.bo) return false;"],
  ['hot lines: the surface map coloured again', "const FH_SURF = { Hard: 'var(--text-soft)', Clay: 'var(--text-soft)', Grass: 'var(--text-soft)' };", "const FH_SURF = { Hard: 'var(--text-soft)', Clay: 'var(--amber)', Grass: 'var(--text-soft)' };"],
  ['DoD 8: an H2H-local row renderer again', "function fhH2hSetScores(r){", "function fhH2hRowHtml(r){ return ''; }\nfunction fhH2hSetScores(r){"],
  ['rows: " ret." dropped', "  return r.sets.map(fhSetTxt).join(', ') + (r.ret ? ' ret.' : '');", "  return r.sets.map(fhSetTxt).join(', ');"],
  ['"Meetings ↓" resets the filter', "  setTimeout(() => { const el = document.getElementById('fhH2hList');", "  fhH2h({ surf: 'all' }); setTimeout(() => { const el = document.getElementById('fhH2hList');"],
];
// Match analysis rebuild (2026-11-23): the H2H tab is drawn by match-analysis-v2.js (maH2HV2, h2Price, h2Hot, h2List);
// these mutants are applied to a copy of it (TEN331_MA2). The tug-bar, section-title and Breakdown-toggle mutants are gone
// with the structures the 2026-11-23 design replaced.
const ma2 = fs.readFileSync(path.join(ROOT, 'match-analysis-v2.js'), 'utf8');
const MA2_MUTANTS = [
  ['Q4: the design\'s "have not played"', "have no meeting on record. The closest guide", "have not played. The closest guide"],
  ['record: label ignores the filter', "(SURF === 'all' ? 'Overall' : 'On ' + SURF.toLowerCase())", "'Overall'"],
  ['record: a % printed beside the record', "(side === 'a' ? aS : bS) + ' leads')", "(side === 'a' ? aS : bS) + ' leads ' + Math.round(Math.max(ra, rb) / F.length * 100) + '%')"],
  ['chip: back to n === 2 only', "const small = F.length && maGate(F.length).mode !== 'full' ?", "const small = F.length === 2 ?"],
  ['N2: a walkover counted as a meeting', "const played = E.filter(r => !r.wo), SURF", "const played = E, SURF"],
  ['N2: a walkover in the filtered counts', "FL = E.filter(r => SURF === 'all' || r.surface === SURF), F = FL.filter(r => !r.wo);", "FL = E.filter(r => SURF === 'all' || r.surface === SURF), F = FL;"],
  ['N2: an all-walkover H2H lists nothing', "if (!F.length) return wrap(recCard + (FL.length ? h2List(m, FL, F, S, aS, bS) : ''));", "if (!F.length) return wrap(recCard);"],
  ['N2: a w/o-only surface greyed out', "off = !E.some(r => t[0] === 'all' || r.surface === t[0])", "off = n === 0"],
  ['price: header counts a today price it does not draw', "fhPriceRangeSource(PR, nP > 1 ? today : null)", "fhPriceRangeSource(PR, today)"],
  ['price: header names one book over mixed data', "Closing odds' + (nP ? ' · ' + esc(fhPriceRangeSource(PR, nP > 1 ? today : null)) : '')", "Closing odds' + (nP ? ' · Pinnacle' : '')"],
  ['price: n=2 loses its count', "const thin = nP < FH_PRICE_THIN ?", "const thin = false ?"],
  ['price: no TEN-325 note', "'<span' + (nP && ret ? ' title=\"' + esc(ret) + '\"' : '') + ' style=", "'<span' + ' style="],
  ['price: the every-close pop-up dropped', "gap:10px; align-items:start;\">' + pop", "gap:10px; align-items:start;\">'"],
  ['today: the dash loses its reason', "<span' + (tv == null ? ' title=\"' + esc(FH_TODAY_NONE) + '\"' : '') + ' style=", "<span' + ' style="],
  ['text: the section loses its design ink (inherits the page)', "container-type:inline-size; font-size:14px; line-height:normal; color:var(--ma2-text);\">' + inner", "container-type:inline-size; font-size:14px; line-height:normal;\">' + inner"],
  ['hot lines: Rate ignores the gate (a % on n 3)', "const pct = results || g === 'nopct' ? DASH : Math.round(rate) + '%';", "const pct = results ? DASH : Math.round(rate) + '%';"],
  ['hot lines: column dots coloured by surface', "(r.surface && r.surface === today ? 'var(--ma2-text)' : W(22)) + ';\"></span><span style=\"' + MONO + ' font-size:9px; color:var(--ma2-grey); white-space:nowrap;\">' + esc(fhTournCode(r.tournRaw || r.tourn)) + '</span><span style=\"' + MONO + ' font-size:9px; color:var(--ma2-grey);\">", "(r.surface === 'Clay' ? 'var(--viz-clay)' : 'var(--viz-hard)') + ';\"></span><span style=\"' + MONO + ' font-size:9px; color:var(--ma2-grey); white-space:nowrap;\">' + esc(fhTournCode(r.tournRaw || r.tourn)) + '</span><span style=\"' + MONO + ' font-size:9px; color:var(--ma2-grey);\">"],
  ['rows: the event tag loses the level', "esc([surf, r.level].filter(Boolean).join(' · '))", "esc([surf].filter(Boolean).join(' · '))"],
  ['review F2: the Elo word back in the event tag', "esc([surf, r.level].filter(Boolean).join(' · '))", "esc([surf, r.level, 'Elo'].filter(Boolean).join(' · '))"],
  ['open tile back on a blue outline', "border:1px solid ' + W(on ? 22 : 6) + '; border-radius:11px;", "border:1px solid ' + (on ? 'var(--ma2-blue)' : W(6)) + '; border-radius:11px;"],
  ['surface track: selected on a blue edge', "background:' + (on ? 'var(--ma2-lifted)' : 'transparent') + '; border:1px solid ' + (on ? W(14) : 'transparent') + '; cursor:' + (off ?", "background:' + (on ? 'var(--ma2-blue)' : 'transparent') + '; border:1px solid ' + (on ? 'var(--ma2-blue)' : 'transparent') + '; cursor:' + (off ?"],
  ['meetings: one group per meeting again', "if (!years.length || years[years.length - 1].y !== y) years.push({ y, rs: [] });", "years.push({ y, rs: [] });"],
  ['rows: a row stops opening the sheet', "(r.wo ? '' : ' onclick=\"fhOpenSheet(\\'' + esc(r.mid) + '\\')\" title=\"Open the match stats\"')", "''"],
  ['drawer: an empty panel opens nothing', "if (S.stat && F.length) {", "if (S.stat && F.length && rowsP.length) {"],
  ['drawer: sets rows lose " ret."', "r.sets ? r.sets.map(fhSetTxt).join(', ') + (r.ret ? ' ret.' : '') : 'Set scores not on record'", "r.sets ? r.sets.map(fhSetTxt).join(', ') : 'Set scores not on record'"],
];
const SUITES = ['test-ten331-h2h.mjs'];
// Control: the unmutated page must pass, or every "caught" below means nothing.
{ const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('✖ the suite is red on the unmutated page — mutants are meaningless'); process.exit(1); }
  console.log('✔ control: the unmutated page passes'); }
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten331-mut-'));
for (const [name, from, to] of MUTANTS) {
  if (html.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'm.html');
  fs.writeFileSync(file, html.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, { TEN331_HTML: file }), encoding: 'utf8' });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
for (const [name, from, to] of MA2_MUTANTS) {
  if (ma2.split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, 'ma2.js');
  fs.writeFileSync(file, ma2.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, { TEN331_MA2: file }), encoding: 'utf8' });
  if (r.status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length + MA2_MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
