// TEN-402 round 1, builder Y (founder 2026-10-09: fixes 3, 4, 7 + the Career chart nit) — every check that locks a fix
// in test-ten402-r1y.mjs must FAIL when that fix is reverted. Each mutant is applied to a copy of
// bsp-consult-dashboard.html (TEN402_HTML) or trading-report.js (TEN402_TR) and the suite runs against it; a mutant that
// leaves it green is a vacuous test and fails this runner. Anchors occur exactly once.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const FILES = { html: path.join(ROOT, 'bsp-consult-dashboard.html'), tr: path.join(ROOT, 'trading-report.js') };
const ENV = { html: 'TEN402_HTML', tr: 'TEN402_TR' };
const src = { html: fs.readFileSync(FILES.html, 'utf8'), tr: fs.readFileSync(FILES.tr, 'utf8') };
const MUTANTS = [
  // ---- fix 3: price mark
  ['fix 3: the Meetings ledger marks Bet365 rows again', 'html',
    "            hTitle: h2hPriceTitle(r), aTitle: h2hPriceTitle(r), hMark: '',",
    "            hTitle: h2hPriceTitle(r), aTitle: h2hPriceTitle(r), hMark: r.price != null && r.book === 'B' ? 'B' : '',"],
  ['fix 3: the Playing styles ledger marks Bet365 rows again', 'html',
    "          hTitle: h2hPriceTitle(q), aTitle: h2hPriceTitle(q), hMark: '' };",
    "          hTitle: h2hPriceTitle(q), aTitle: h2hPriceTitle(q), hMark: q.price != null && q.book === 'B' ? 'B' : '' };"],
  ['fix 3: the Tournament ledger keeps trRowData\'s B', 'html',
    "{ hTitle: h2hPriceTitle(r), aTitle: h2hPriceTitle(r), hMark: '', click: '', attrs: '', selected: false }",
    "{ hTitle: h2hPriceTitle(r), aTitle: h2hPriceTitle(r), click: '', attrs: '', selected: false }"],
  ['fix 3: no footnote under the Meetings ledger', 'html', "      </div>${h2hPxNote('margin-top:-8px;')}</div>`;", '      </div></div>`;'],
  ['fix 3: no footnote under the Playing styles ledger', 'html', '${maMatchRowsHtml(groups, C_LED_OPTS)}${more}</div>\n      ${h2hPxNote()}\n', '${maMatchRowsHtml(groups, C_LED_OPTS)}${more}</div>\n'],
  ['fix 3: no footnote under the Tournament ledgers', 'html', "      ${rows ? h2hPxNote('padding:4px 14px 14px;') : ''}\n", ''],
  ['fix 3: the footnote words drift', 'html', "  const H2H_PX_NOTE = 'Closing price · Pinnacle, else Bet365';", "  const H2H_PX_NOTE = 'Closing odds · Pinnacle';"],
  ['fix 3: the Tournament card prints the old "B = Bet365" line again', 'html',
    '${panels}</div>`; })()}', "${panels}</div>${typeof trSrcLine === 'function' ? trSrcLine(panels) : ''}`; })()}"],
  ['fix 3: the H2H sheet keeps the white caps B365 chip', 'html', '${!o.inline && _fh && _fh.m && _fh.m.h2hPage ? fhB365Meta(r) : fhB365Tag(r)}', '${fhB365Tag(r)}'],
  ['fix 3: every sheet gets the mono tag (the change leaks off this page)', 'html', '${!o.inline && _fh && _fh.m && _fh.m.h2hPage ? fhB365Meta(r) : fhB365Tag(r)}', '${fhB365Meta(r)}'],
  ['fix 3: the sheet tag in a bold caps face', 'html',
    'style="${FH_MONO} font-size:11px; letter-spacing:0.06em; color:var(--text-label);">· B365</span>',
    'style="${FH_MONO} font-size:11px; font-weight:700; letter-spacing:0.06em; color:var(--text);">· B365</span>'],
  // ---- fix 4: country codes
  ['fix 4: the tag prints the country name', 'html', "return (T && T.of(country)) || '—'; }", "return country || '—'; }"],
  ['fix 4: the header tag skips the code', 'html', '<span class="h2h-ctry">${E(h2hIoc(v.a.ctry))}</span>', '<span class="h2h-ctry">${E(v.a.ctry)}</span>'],
  ['fix 4: the picker row skips the code', 'html', "    const base = h2hIoc(e.ctry) + ' · '", "    const base = (e.ctry || '—') + ' · '"],
  ['fix 4: the table back inside the Trading report\'s flag guard', 'tr',
    "window.SfCountryIoc = (function () {", "(function () { if (!window.FEATURE_TRADING_REPORT) return; })();\nwindow.SfCountryIoc0 = (function () {"],
  ['fix 4: a roster country lost from the table (Namibia)', 'tr', "'Namibia':'NAM',", ''],
  // ---- fix 7: small copy
  ['fix 7: initials back to first + last word (BZ, DA)', 'html',
    '    return (p[0][0] + (i ? p[i] : p[p.length - 1])[0]).toUpperCase();', '    return (p[0][0] + p[p.length - 1][0]).toUpperCase();'],
  ['fix 7: "J. M." read as a surname (JM, not JC)', 'html',
    "    let i = 0; while (i < p.length - 1 && /^[A-Za-zÀ-ž](?:-[A-Za-zÀ-ž])?[.．]$/.test(p[i])) i++;", "    let i = 1;"],
  ['fix 7: the no-meetings year back on the later player\'s start', 'html',
    "      const since = yrs.length ? ' since ' + Math.min(...yrs) : '';", "      const since = yrs.length === 2 ? ' since ' + Math.max(...yrs) : '';"],
  ['fix 7: the record line in a hyphen', 'html',
    "    const rec = aw === bw ? 'level ' + aw + '–' + bw : (aw > bw ? h.aS : h.bS) + ' leads ' + Math.max(aw, bw) + '–' + Math.min(aw, bw);",
    "    const rec = aw === bw ? 'level ' + aw + '-' + bw : (aw > bw ? h.aS : h.bS) + ' leads ' + Math.max(aw, bw) + '-' + Math.min(aw, bw);"],
  ['fix 7: a Hot lines name in a hyphen-minus', 'html',
    "    { g: 'gh', name: bS + ' −2.5 games', need: 'games', bo3: true, cov: m => m.diff <= -3, basis: 'Bo3 completed' },",
    "    { g: 'gh', name: bS + ' -2.5 games', need: 'games', bo3: true, cov: m => m.diff <= -3, basis: 'Bo3 completed' },"],
  ['fix 7: the location back to the country alone', 'html',
    '    const region = typeof tournamentLocation === \'function\' ? tournamentLocation(cat) : null;',
    "    let region = null; try { region = cat && cat.country ? new Intl.DisplayNames(['en'], { type: 'region' }).of(cat.country) : null; } catch (x) { region = null; }"],
  ['fix 7: Wimbledon at its geocoding suburb', 'html', "'Wimbledon': 'London', ", ''],
  ['fix 7: the UK / USA long forms', 'html', "const TOURNAMENT_COUNTRY_SHORT = { GB: 'UK', US: 'USA', AE: 'UAE' };", 'const TOURNAMENT_COUNTRY_SHORT = {};'],
  // ---- nit: Career chart years
  ['nit: Career back on six even ticks (years blanked)', 'html', "    const ticks = scope !== 'l52' && L.length > 1 ? yearTicks()", '    const ticks = false ? yearTicks()'],
  ['nit: a short season is not nudged clear (2019 / 2020 overlap)', 'html',
    '      for (let i = 1; i < f.length; i++) f[i] = Math.max(f[i], f[i - 1] + C_YEAR_GAP);\n', ''],
];
const SUITES = ['test-ten402-r1y.mjs'];
const run = env => spawnSync(process.execPath, ['--test', ...SUITES.map(f => path.join(ROOT, f))], { env: Object.assign({}, process.env, env), encoding: 'utf8' });
// Control: the unmutated files must pass, or every "caught" below means nothing.
if (run({}).status !== 0) { console.error('✖ the suite is red on the unmutated files — mutants are meaningless'); process.exit(1); }
console.log('✔ control: the unmutated files pass');
let survived = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten402r1y-mut-'));
for (const [name, which, from, to] of MUTANTS) {
  if (src[which].split(from).length !== 2) { console.error(`✖ anchor not found exactly once: ${name}`); survived++; continue; }
  const file = path.join(dir, which === 'tr' ? 'm.js' : 'm.html');
  fs.writeFileSync(file, src[which].replace(from, to));
  if (run({ [ENV[which]]: file }).status === 0) { console.error(`✖ SURVIVED: ${name}`); survived++; } else console.log(`✔ caught: ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`mutants: ${MUTANTS.length - survived} caught, ${survived} survived`);
process.exit(survived ? 1 : 0);
