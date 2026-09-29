// TEN-331 — every check in test-ten331-h2h.mjs must FAIL when the behaviour it locks is reverted. Each mutant is
// applied to a copy of bsp-consult-dashboard.html and the suite is run against it (TEN331_HTML); a mutant that leaves
// the suite green is a vacuous test and fails this runner. Anchors must occur exactly once in the page.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
  ["N1: H2H opens on today's surface", "      h2h: { surf: 'all', allLines: false, stat: null },", "      h2h: { surf: fhSurfName(m.surface) || 'all', allLines: false, stat: null },"],
  ['tug: the split bar back (a share, not a pull from the centre)', "  const tug = s => (side === s && n ? (Math.abs(a - b) / n * 50) + '%' : '0%');", "  const tug = s => (n ? ((s === 'a' ? a : b) / n * 100) + '%' : '0%');"],
  ['tug: not drawn under the gate (n < 5)', "  const tug = s => (side === s && n ? (Math.abs(a - b) / n * 50) + '%' : '0%');", "  const tug = s => (side === s && n >= 5 ? (Math.abs(a - b) / n * 50) + '%' : '0%');"],
  ['tug: a % printed beside the bar', "  const tugTxt = !n ? '' : side === 'level' ? 'Level' : '+' + Math.abs(a - b) + ' ' + (side === 'a' ? aS : bS);", "  const tugTxt = !n ? '' : side === 'level' ? 'Level' : Math.round(Math.max(a, b) / n * 100) + '% ' + (side === 'a' ? aS : bS);"],
  ['record: label ignores the filter', "fhH2hRecCard(SURF === 'all' ? 'Overall' : 'On ' + SURF.toLowerCase(), F,", "fhH2hRecCard('Overall', E,"],
  ['chip: back to n === 2 only', "white-space:nowrap;\">Meetings ↓</span>${maSmallChip(n)}</div>", "white-space:nowrap;\">Meetings ↓</span>${n === 2 ? maSmallChip(n) : ''}</div>"],
  ['N2: a walkover counted as a meeting', "  const played = E.filter(r => !r.wo);", "  const played = E;"],
  ['N2: a walkover in the filtered counts', "FL = E.filter(r => SURF === 'all' || r.surface === SURF), F = FL.filter(r => !r.wo);", "FL = E.filter(r => SURF === 'all' || r.surface === SURF), F = FL;"],
  ['N2: an all-walkover H2H lists nothing', "  if (!FL.length){\n    return wrap(", "  if (!F.length){\n    return wrap("],
  ['N2: a w/o-only surface greyed out', "on: SURF === t[0], off: !listed, onclick:", "on: SURF === t[0], off: n === 0, onclick:"],
  ['price: header counts a today price it does not draw', "fhPriceRangeSource(PR, nP > 1 ? today : null)", "fhPriceRangeSource(PR, today)"],
  ['hot lines: a line with fewer than 3 eligible meetings appears', "  }).filter(x => x.n >= FH_HOT_MIN_ELIGIBLE).sort(fhHotLineRank);", "  }).filter(x => x.n > 0).sort(fhHotLineRank);"],
  ['hot lines: bar ignores the gate', "(bar => `<span data-ma-gate=\"${bar.mode}\"", "(bar => (bar = { w: x.c / x.n * 100, color: 'var(--fh-fill)', mode: 'full' }, `<span data-ma-gate=\"${bar.mode}\""],
  ['hot lines: column dots coloured by surface', "border-radius:50%; background:${FH_SURF[r.surface] || 'var(--fh-muted)'};", "border-radius:50%; background:${r.surface === 'Clay' ? 'var(--ma-amber)' : 'var(--ma-link)'};"],
  ['price: n=2 loses its count', "${nP > 1 && nP < FH_PRICE_THIN ? chip('n=' + nP)", "${false ? chip('n=' + nP)"],
  ['price: the pop-up back on a tab-local tooltip', "inner += maTipHtml(figs, `<span style=\"display:flex; flex-direction:column;\">${body}</span>`, { tag: 'div', cls: 'fh-prtip', style: grid,", "inner += maTipHtml(figs, `<span style=\"display:flex; flex-direction:column;\">${body}</span>`, { tag: 'div', cls: 'fh-prtip fh-elotip', style: grid,"],
  ['price: header names one book over mixed data', "<span style=\"font-size:12px; color:${t2};\">· Closing odds${PR.length ? ' · ' + fhPriceRangeSource(PR, nP > 1 ? today : null) : ''}</span>", "<span style=\"font-size:12px; color:${t2};\">· Closing odds${PR.length ? ' · Pinnacle' : ''}</span>"],
  ['price: no TEN-325 note', "      ${nP && globalThis.MarketEdgeCore ? `<span data-ret-note=\"h2h\"", "      ${false ? `<span data-ret-note=\"h2h\""],
  ['DoD 8: an H2H-local row renderer again', "function fhH2hSetScores(r){", "function fhH2hRowHtml(r){ return ''; }\nfunction fhH2hSetScores(r){"],
  ['rows: group meta loses the level', "meta: [surfLbl, r.level].filter(Boolean).join(' · '),", "meta: surfLbl,"],
  ['rows: a row stops opening the sheet', "    cls: 'fh-h2row', attrs: ` data-fh-mid=\"${fhEsc(r.mid)}\"`, click: ` onclick=\"fhOpenSheet('${fhEsc(r.mid)}')\"`,", "    cls: 'fh-h2row', attrs: ` data-fh-mid=\"${fhEsc(r.mid)}\"`, click: '',"],
  ['rows: " ret." dropped', "  return r.sets.map(fhSetTxt).join(', ') + (r.ret ? ' ret.' : '');", "  return r.sets.map(fhSetTxt).join(', ');"],
  ['drawer: an empty drawer opens nothing', "  const statPanel = !S.stat ? '' :", "  const statPanel = !S.stat || !statRows.length ? '' :"],
  ['drawer: sets rows lose " ret."', "r.sets ? r.sets.map(fhSetTxt).join('  ') + (r.ret ? '  ret.' : '') : 'set scores not on record'", "r.sets ? r.sets.map(fhSetTxt).join('  ') : 'set scores not on record'"],
  ['"Meetings ↓" resets the filter', "  setTimeout(() => { const el = document.getElementById('fhH2hList');", "  fhH2h({ surf: 'all' }); setTimeout(() => { const el = document.getElementById('fhH2hList');"],
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
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
