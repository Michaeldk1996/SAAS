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
  // TEN-437 (founder 2026-10-16) reverses fix 3 for the Meetings ledger: its Bet365 rows carry the B; the mutant drops it.
  ['fix 3: the H2H sheet keeps the white caps B365 chip', 'html', '${!o.inline && _fh && _fh.m && _fh.m.h2hPage ? fhB365Meta(r) : fhB365Tag(r)}', '${fhB365Tag(r)}'],
  ['fix 3: every sheet gets the mono tag (the change leaks off this page)', 'html', '${!o.inline && _fh && _fh.m && _fh.m.h2hPage ? fhB365Meta(r) : fhB365Tag(r)}', '${fhB365Meta(r)}'],
  ['fix 3: the sheet tag in a bold caps face', 'html',
    'style="${FH_MONO} font-size:11px; letter-spacing:0.06em; color:var(--text-label);">· B365</span>',
    'style="${FH_MONO} font-size:11px; font-weight:700; letter-spacing:0.06em; color:var(--text);">· B365</span>'],
  // ---- the design rebuild (founder 2026-11-16): the meetings box, the ledgers, the picked box
  ["TEN-437: the meetings box drops the Bet365 B again", 'html',
    "${r.price != null && typeof fhPxMark === 'function' && fhPxMark(r) ? `<sup style=\"font-size:8px; color:${X_G};\">${E(fhPxMark(r))}</sup>` : ''}",
    ""],
  ["TEN-437: the meetings box loses the price hover", 'html',
    "<span title=\"${E(h2hPriceTitle(r))}\" style=\"font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--h2h-soft); text-align:right;\">",
    "<span style=\"font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--h2h-soft); text-align:right;\">"],
  ["fix 3: the career-match ledger marks Bet365 rows again", 'html',
    "text-align:right;\">${E(q.price == null ? '—' : fhOdd(q.price))}</span>",
    "text-align:right;\">${E(q.price == null ? '—' : fhOdd(q.price))}${q.book === 'B' ? '<sup>B</sup>' : ''}</span>"],
  ["fix 3: the Tournament ledger prints trRowData's B", 'html',
    "text-align:right;\">${E(d.h)}</span>",
    "text-align:right;\">${E(d.h)}${d.hMark ? '<sup>' + d.hMark + '</sup>' : ''}</span>"],
  ["fix 3: the meetings box's \"?\" drops the price rule", 'html',
    "The two columns under the avatars are each player's closing price (Pinnacle, else Bet365\"",
    "The two columns are the prices (\""],
  ["the meetings box's \"?\" drops the Pinnacle (approx.) count", 'html',
    "(na ? '; Pinnacle (approx.) on ' + na + ': a snapshot, not a confirmed close' : '')",
    "''"],
  ["the Tournament ledger's price back on the Match analysis tab's hover", 'html',
    "<span title=\"${E(d.h === '' ? (d.hTitle || '') : h2hPriceTitle(r))}\"",
    "<span title=\"${E(d.hTitle || '')}\""],
  ["fix 7: the never-met card loses its searched-since line", 'html',
    "(yrs.length ? ' Searched both players’ match histories since ' + Math.min(...yrs) + '.' : '')",
    "''"],
  ["fix 3: the Tournament column head names no player", 'html',
    "${xAv(p, sd, 20, { title: nm + '’s closing price' })}",
    "${xAv(p, sd, 20)}"],
  ["fix 4: the picked box prints the country name", 'html',
    "padding:1px 6px;\">${E(h2hIoc(p.ctry))}</span>",
    "padding:1px 6px;\">${E(p.ctry)}</span>"],
  ["fix 7: the record sentence in a hyphen", 'html',
    "' · ' + (aw > bw ? h.aS : h.bS) + ' leads ' + Math.max(aw, bw) + '–' + Math.min(aw, bw)",
    "' · ' + (aw > bw ? h.aS : h.bS) + ' leads ' + Math.max(aw, bw) + '-' + Math.min(aw, bw)"],
  ["fix 7: the year header in a hyphen", 'html',
    "${Y.w}–${Y.rows.length - Y.w} · ${Y.rows.length}",
    "${Y.w}-${Y.rows.length - Y.w} · ${Y.rows.length}"],
  ["nit: the axis labels all centred (first / last overflow)", 'html',
    "transform:${t.f <= 0 ? 'none' : t.f >= 1 ? 'translateX(-100%)' : 'translateX(-50%)'};",
    "transform:translateX(-50%);"],
  // ---- fix 4: country codes
  ['fix 4: the tag prints the country name', 'html', "return (T && T.of(country)) || '—'; }", "return country || '—'; }"],
  ['fix 4: the picker row skips the code', 'html', "    const base = h2hIoc(e.ctry) + ' · '", "    const base = (e.ctry || '—') + ' · '"],
  ['fix 4: the table back inside the Trading report\'s flag guard', 'tr',
    "window.SfCountryIoc = (function () {", "(function () { if (!window.FEATURE_TRADING_REPORT) return; })();\nwindow.SfCountryIoc0 = (function () {"],
  ['fix 4: a roster country lost from the table (Namibia)', 'tr', "'Namibia':'NAM',", ''],
  // ---- fix 7: small copy
  ['fix 7: initials back to first + last word (BZ, DA)', 'html',
    '    return (p[0][0] + (i ? p[i] : p[p.length - 1])[0]).toUpperCase();', '    return (p[0][0] + p[p.length - 1][0]).toUpperCase();'],
  ['fix 7: "J. M." read as a surname (JM, not JC)', 'html',
    "    let i = 0; while (i < p.length - 1 && /^[A-Za-zÀ-ž](?:-[A-Za-zÀ-ž])?[.．]$/.test(p[i])) i++;", "    let i = 1;"],
  ['fix 7: a Hot lines name in a hyphen-minus', 'html',
    "    { g: 'gh', name: bS + ' −2.5 games', need: 'games', bo3: true, cov: m => m.diff <= -3, basis: 'Bo3 completed', px: { mk: 'gh', who: 'B', line: -2.5 } },",
    "    { g: 'gh', name: bS + ' -2.5 games', need: 'games', bo3: true, cov: m => m.diff <= -3, basis: 'Bo3 completed', px: { mk: 'gh', who: 'B', line: -2.5 } },"],
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
