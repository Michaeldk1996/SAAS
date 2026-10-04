// TEN-331 — every check in test-ten331-h2h.mjs must FAIL when the behaviour it locks is reverted. Each mutant is
// applied to a copy of bsp-consult-dashboard.html and the suite is run against it (TEN331_HTML); a mutant that leaves
// the suite green is a vacuous test and fails this runner. Anchors must occur exactly once in the page.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const MUTANTS = [
  ["ruling 8: the tug's B side back at the reference 70%", "width:${tug('b')}; background:var(--white-bar); border-radius:0 4px 4px 0;", "width:${tug('b')}; background:color-mix(in srgb, var(--white-bar) 70%, transparent); border-radius:0 4px 4px 0;"],
  ['Q4: the design\'s "have not played"', "have no meeting on record. Closest guide:", "have not played. Closest guide:"],
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
  ['today: the dash loses its reason', '<span class="fh-today-dash" title="${FH_TODAY_NONE}"', '<span class="fh-today-dash"'],
  ['text: the section loses its foundation ink (inherits the page)', "  #aSectionH2H{ color:var(--text); }", ""],
  ['hot lines: a line with fewer than 3 eligible meetings appears', "  }).filter(x => x.n >= FH_HOT_MIN_ELIGIBLE).sort(fhHotLineRank);", "  }).filter(x => x.n > 0).sort(fhHotLineRank);"],
  ['hot lines: Rate ignores the gate (a % on n 3)', "if (maGate(n).mode === 'nopct') return `<span class=\"fh-hl-rate\" data-ma-gate=\"nopct\"", "if (false) return `<span class=\"fh-hl-rate\" data-ma-gate=\"nopct\""],
  ['hot lines: column dots coloured by surface', "background:${r.surface && r.surface === opts.today ? 'var(--text)' : 'color-mix(in srgb, var(--text) 22%, transparent)'};", "background:${r.surface === 'Clay' ? 'var(--viz-clay)' : 'var(--viz-hard)'};"],
  ['hot lines: the surface map coloured again', "const FH_SURF = { Hard: 'var(--text-soft)', Clay: 'var(--text-soft)', Grass: 'var(--text-soft)' };", "const FH_SURF = { Hard: 'var(--text-soft)', Clay: 'var(--amber)', Grass: 'var(--text-soft)' };"],
  ['price: n=2 loses its count', "${nP > 1 && nP < FH_PRICE_THIN ? chip('n=' + nP)", "${false ? chip('n=' + nP)"],
  ['price: the pop-up back on a tab-local tooltip', "inner += maTipHtml(figs, `<span style=\"display:flex; flex-direction:column;\">${body}</span>`, { tag: 'div', cls: 'fh-prtip', style: grid,", "inner += maTipHtml(figs, `<span style=\"display:flex; flex-direction:column;\">${body}</span>`, { tag: 'div', cls: 'fh-prtip fh-elotip', style: grid,"],
  ['price: header names one book over mixed data', "'Closing odds' + (PR.length ? ' · ' + fhEsc(fhPriceRangeSource(PR, nP > 1 ? today : null)) : '')", "'Closing odds' + (PR.length ? ' · Pinnacle' : '')"],
  ['price: no TEN-325 note', "      ${nP && globalThis.MarketEdgeCore ? `<span data-ret-note=\"h2h\"", "      ${false ? `<span data-ret-note=\"h2h\""],
  ['DoD 8: an H2H-local row renderer again', "function fhH2hSetScores(r){", "function fhH2hRowHtml(r){ return ''; }\nfunction fhH2hSetScores(r){"],
  ['rows: the event tag loses the level', "oppTag: [surfLbl, r.level].filter(Boolean).join(' · '),", "oppTag: [surfLbl].filter(Boolean).join(' · '),"],
  ['review F2: the Elo word back in the event tag', "oppTag: [surfLbl, r.level].filter(Boolean).join(' · '),", "oppTag: [surfLbl, r.level, 'Elo'].filter(Boolean).join(' · '),"],
  // TEN-380 (README §6, decisions §1)
  ['tug: back on the player colours and the --inner track', "<div style=\"position:relative; width:100%; height:8px; background:var(--line); border-radius:4px;\"><span style=\"position:absolute; right:50%; top:0; bottom:0; width:${tug('a')}; background:var(--white-bar);", "<div style=\"position:relative; width:100%; height:8px; background:var(--inner); border-radius:4px;\"><span style=\"position:absolute; right:50%; top:0; bottom:0; width:${tug('a')}; background:var(--fh-pa);"],
  ['tug: the tick back to --text-soft', "margin-left:-0.75px; background:var(--viz-tick);\"></span></div>", "margin-left:-0.75px; background:var(--text-soft);\"></span></div>"],
  ['Breakdown toggle back to --link', "<span class=\"fh-h2bd\" style=\"font-size:10.5px; font-weight:600; color:var(--text);", "<span class=\"fh-h2bd\" style=\"font-size:10.5px; font-weight:600; color:var(--link);"],
  ['open tile back on the blue outline', "border:1px solid ${on ? 'var(--edge-24)' : hair}; border-radius:14px;", "border:1px solid ${on ? 'color-mix(in srgb, var(--bar) 50%, transparent)' : hair}; border-radius:14px;"],
  ['drawer back on the blue outline', "<div class=\"fh-h2drawer\" style=\"background:${card}; border:1px solid ${hair};", "<div class=\"fh-h2drawer\" style=\"background:${card}; border:1px solid var(--open-card);"],
  ['surface track: selected back on --selected + --open-card', "const bg = off || !on ? 'transparent' : s.bg, bd = off || !on ? 'transparent' : s.bd;", "const bg = off || !on ? 'transparent' : shades ? 'var(--selected)' : s.bg, bd = off || !on ? 'transparent' : shades ? 'var(--open-card)' : s.bd;"],
  ['meetings: one group per meeting again', "if (!years.length || years[years.length - 1].y !== y) years.push({ y, rs: [] });", "years.push({ y, rs: [] });"],
  ['section titles back inside the cards', "  const priceHtml = secHead('Price range',", "  const priceHtml = '' + ('Price range',"],
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
