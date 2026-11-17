// TEN-402 round 1 (founder 2026-10-09), builder Y — fixes 3 (price mark), 4 (country codes), 7 (small copy) and the
// cheap nits (Career profit chart years). Night only.
//
// Drives the REAL code sliced out of bsp-consult-dashboard.html / trading-report.js (never a copy of a rule); each check
// that could pass vacuously carries a control. Mutants: tools/test-ten402-r1y-mutants.js.
//
// Run: node --test test-ten402-r1y.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN402_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const TR = readFileSync(process.env.TEN402_TR || join(HERE, 'trading-report.js'), 'utf8');
const PIPE = readFileSync(join(HERE, 'bsp-pipeline.js'), 'utf8');
const core = createRequire(import.meta.url)(join(HERE, 'market-edge-core.js'));

function sliceAt(src, start) {
  let depth = 0, i = src.indexOf('{', start);
  const open = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  assert.ok(i > open, 'braces did not balance');
  return src.slice(start, i + 1);
}
function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found in bsp-consult-dashboard.html`);
  assert.equal(html.indexOf(`function ${name}(`, start + 1), -1, `${name} defined twice`);
  return sliceAt(html, start);
}
const constLine = name => { const m = new RegExp(`\\n\\s*const ${name} = [^\\n]*\\n`).exec(html); assert.ok(m, `const ${name}`); return m[0]; };
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

// The site's one country table, evaluated from trading-report.js (the block above the report's feature-flag guard).
function countryTable(src) {
  const a = src.indexOf('window.SfCountryIoc = (function () {'), b = src.indexOf('})();', a);
  assert.ok(a >= 0 && b > a, 'window.SfCountryIoc not found in trading-report.js');
  const guard = src.indexOf('if (!window.FEATURE_TRADING_REPORT) return;');
  assert.ok(guard > b, 'the table sits ABOVE the feature-flag guard (the H2H page needs it with the report off)');
  const w = {}; new Function('window', src.slice(a, b + 5))(w); return w.SfCountryIoc;
}
const IOC = countryTable(TR);

// ---------------------------------------------------------------- the rebuilt ledgers, executed
// tools/h2h-test-harness.js runs the shipped window.H2HPage module and slices the page helpers it reaches.
const HX = createRequire(import.meta.url)(join(HERE, 'tools/h2h-test-harness.js'));
const page = g => HX.load({ html, globals: g || {} });
const PA = { key: '2382', short: 'C. Alcaraz', full: 'C. Alcaraz', mono: 'CA', ctry: 'Spain', rankTxt: '#1', eloTxt: '2250' };
const PB = { key: '2072', short: 'J. Sinner', full: 'J. Sinner', mono: 'JS', ctry: 'Italy', rankTxt: '#2', eloTxt: '2210' };
const meeting = (o) => Object.assign({ mid: 'm' + o.date, tourn: 'Monte Carlo', surface: 'Clay', round: 'F', won: false, pS: 0, oS: 2,
  sets: [[6, 7, 5], [3, 6]], price: 2.0, oppPrice: 1.8, book: 'P' }, o);
const boxOf = (h, rows) => { h.state.h2hBox = true; return h.call(h.h2hBoxHTML, { a: PA, b: PB, h2h: { all: rows, F: rows, surf: 'all', aS: 'Alcaraz', bS: 'Sinner', aName: 'C. Alcaraz', bName: 'J. Sinner', aKey: '2382', bKey: '2072' } }); };

// TEN-437 (founder 2026-10-16) supersedes fix 3's no-marker ledger: "show it on the H2H page meeting rows too, same as the tab".
// The rebuild (founder 2026-11-16) moved the "Closing price · Pinnacle, else Bet365" footnote onto the box's "?".
test('fix 3 + TEN-437: a Bet365 meeting row carries the tab\'s "B" marker and the hover names the book; the "?" states the rule', () => {
  const h = page({ loadSetStatsIndex: () => Promise.resolve(new Set()) });
  const rows = [meeting({ date: '2026-04-12', book: 'B' }), meeting({ date: '2025-11-16', tourn: 'ATP Finals', surface: 'Hard', won: false, price: 2.8, oppPrice: 1.5, book: 'P' })];
  const b = boxOf(h, rows);
  assert.equal((b.match(/<sup style="font-size:8px; color:var\(--h2h-grey\);">B<\/sup>/g) || []).length, 1, 'one B, on the Bet365 row only (the Pinnacle row carries none)');
  assert.match(text(b), /2\.00 B 1\.80/, 'the Bet365 row keeps its prices, B after A\'s price');
  assert.match(b, /<span title="Bet365 closing odds, Pinnacle not available" style="[^"]*">2\.00<sup/, 'A\'s price carries the hover naming the book (founder 2026-10-16, TEN-437)');
  assert.match(b, /<span title="Bet365 closing odds, Pinnacle not available" style="[^"]*">1\.80<\/span>/, 'and B\'s price');
  // the "?" states the rule the old ledger footnote carried (no footnotes on this page): the books, the B mark when a row carries it
  assert.match(b, /class="x-help" title="Newest first\. The result is shown from Alcaraz&#39;s side\. The two columns under the avatars are each player&#39;s closing price \(Pinnacle, else Bet365; a B marks a Bet365 price\)\. Hover a price for its source\. Click a meeting for its statistics\."/);
  // a Pinnacle (approx.) price is named with its count in the same "?" (the old h2hPxNote disclosure)
  const bA = boxOf(h, [meeting({ date: '2026-04-12', book: 'A', src: 'at' }), meeting({ date: '2025-11-16', book: 'P' })]);
  assert.match(bA, /Pinnacle \(approx\.\) on 1: a snapshot, not a confirmed close/);
  // control: the shared Match analysis renderer still draws a mark for a host that asks for one (Match analysis keeps its B)
  const mr = new Function(`${slice('escapeHtml')}\nconst MA_ROW_COLS = '1fr', MA_ROW_GAP = '0';\n${slice('maMatchRowsHtml')}\nreturn maMatchRowsHtml;`)();
  assert.match(mr([{ title: null, rows: [{ date: '1', opp: 'x', rd: 'F', sets: '2 - 0', scores: '', h: '2.00', a: '1.80', hMark: 'B' }] }], {}), /class="ma-row-mark"[^>]*>B</);
});

test('fix 3: the career-match and Tournament ledgers mark no row (the price, its hover names the book); their price column is the player\'s mini avatar titled "<name>’s closing price"', () => {
  const h = page({ _careerHistoryShards: { 2382: [{ date: '2025-04-12', tournament: 'Monte Carlo', round: 'Semi-finals', opponent: 'L. Musetti', won: true, eventKey: 5, level: 'atp' }] },
    _sfDbJoinSt: 'ready', _sfDbJoin: { meta: { rounds: ['Semifinals'] }, rows: [[20250412, 0, 1, 0, 0, 1.5, 2.6, 1, 1]], names: [['Alcaraz C.', 'Musetti L.']] } });
  const tr = o => Object.assign({ wo: false, ret: false, sets: [[6, 4], [6, 4]], pS: 2, oS: 0, surface: 'clay' }, o);
  const rows = [tr({ mid: 'x', date: '2025-04-12', won: true, round: 'SF', opp: 'L. Musetti', price: 1.5, oppPrice: 2.6, book: 'B', src: 'td' })];
  const agg = h.call(h.xTrAgg, [{ ev: { name: 'Monte Carlo', surface: 'Clay', speed: null }, P: { eds: [{ year: '2025', rows }] } }], null, false);
  const tc = h.call(h.tourneyCard, { a: PA, b: PB, tourney: { empty: false, query: '', listOpen: false, options: [], info: { name: 'Monte Carlo', initial: 'M', meta: [] }, grp: false, gLbl: 'courts', TW: 'career', filters: [],
    cols: [{ p: PA, agg, state: 'ready' }, { p: PB, agg: null, state: 'none' }] } });
  // one hover per price on this page: the Tournament ledger's price carries the page's own (h2hPriceTitle), as the meetings
  assert.match(tc, /<span title="Bet365 closing odds, Pinnacle not available" style="font-family:'IBM Plex Mono',monospace; font-size:11\.5px; color:var\(--h2h-text\); text-align:right;">1\.50<\/span>/, 'the Bet365 price, unmarked, its hover the book');
  assert.ok(!/<sup|ma-row-mark/.test(tc), 'no row mark on the Tournament ledger');
  assert.match(tc, /<span class="x-av mini" title="C\. Alcaraz’s closing price"/, 'the column head names whose price it is (a mini avatar, CHANGES 2026-11-17 §2)');
  assert.ok(!/B = Bet365|trSrcLine\(/.test(sliceAt(html, html.indexOf('  function tourneyCard('))), 'the old "Closing odds · … · B = Bet365" line is gone');
  // the career-match ledger: the row's own price from the one join, unmarked
  const sv = { a: PA, b: PB, styles: { sides: [{ p: PA, R: { state: 'ready', oppLab: 'Big Server', avg: 50, rows: [{ won: true, opponent: 'Lorenzo Musetti', surface: 'clay', tournament: 'Monte Carlo', result: '6-4 6-4', date: '2025-04-07', round: 'SF' }] } },
    { p: PB, R: { state: 'ready', oppLab: 'Big Server', avg: 50, rows: [] } }], arch: ['x', 'y'] } };
  const sc = h.call(h.stylesCard, sv);
  assert.match(sc, /<span title="Bet365 closing odds, Pinnacle not available" style="font-family:'IBM Plex Mono',monospace; font-size:11\.5px; color:var\(--h2h-text\); text-align:right;">1\.50<\/span>/, 'the career row priced on the join (Bet365), its hover the book');
  assert.ok(!/<sup|ma-row-mark/.test(sc), 'no row mark on the career-match ledger');
  // control: Match analysis's Tournament rows keep their B (the founder scoped the change to this page's ledgers)
  assert.match(slice('trRowData'), /hMark: fhPxMark\(r\),/);
});

// The sheet header (fhSheetHeadHtml), executed: the Head to Head page's sheet vs any other host.
const HEAD = new Function('_fh', `
  const FH_DASH = 'var(--text-label)', FH_DASHC = '—';
  ${constLine('FH_MONO')}${constLine('FH_BOOK')}${constLine('FH_SRC')}${constLine('FH_B365_HOVER')}${constLine('FH_B365_APPROX_HOVER')}
  function fhSurname(n) { return String(n || '').split(/\\s+/).pop(); } function aAvatarHtml() { return ''; }
  function fhEsc(s) { return String(s == null ? '' : s); }
  ${['fhDDMM', 'fhB365Approx', 'fhPxMark', 'fhSrcTitle', 'fhB365Tag', 'fhB365Meta', 'fhSheetHeadHtml'].map(slice).join('\n')}
  return fhSheetHeadHtml;`);
test('fix 3: the sheet\'s B365 stays, as grey mono in the header\'s meta line — on a sheet opened from Head to Head only', () => {
  const r = { tourn: 'Monte Carlo', surface: 'Clay', round: 'F', date: '2026-04-12', won: false, pS: 0, oS: 2, sets: [[6, 7], [3, 6]], price: 2.0, oppPrice: 1.8, book: 'B', src: 'td' };
  const e = { aName: 'C. Alcaraz', bName: 'J. Sinner' };
  const h2h = HEAD({ m: { h2hPage: true } })(e, r);
  const tag = /<span class="fh-b365"[^>]*style="([^"]*)">([^<]*)<\/span>/.exec(h2h);
  assert.ok(tag, 'the tag is drawn');
  assert.equal(tag[2], '· B365');
  assert.equal(tag[1], "font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:0.06em; color:var(--text-label);", 'the meta line\'s own face, size, spacing and grey');
  const meta = /class="fh-sheet-meta" style="([^"]*)"/.exec(h2h)[1];
  assert.equal(meta, tag[1], 'identical to the rest of the line');
  assert.ok(!/>B365</.test(h2h) && !/text-transform:uppercase/.test(tag[0]) && !/font-weight:700/.test(tag[0]), 'no caps chip, no bold');
  // controls: a Pinnacle row has no tag; Match analysis / profile sheets keep the caps chip (fhB365Tag)
  assert.ok(!HEAD({ m: { h2hPage: true } })(e, Object.assign({}, r, { book: 'P' })).includes('B365'));
  const other = HEAD({ m: { p1: 'A' } })(e, r);
  assert.match(other, />B365<\/span>/); assert.ok(!other.includes('fh-b365'));
  assert.ok(!HEAD({ m: { h2hPage: true } })(e, r, { inline: true }).includes('fh-b365'), 'the Match Stats tab\'s inline copy is not this page');
});

// ---------------------------------------------------------------- fix 4: country codes
const H2H = new Function('window', `${['monoOf', 'h2hIoc'].map(slice).join('\n')}\nreturn { monoOf, h2hIoc };`)({ SfCountryIoc: IOC });
test('fix 4: country tags are IOC codes — ESP, ITA, MON, NED; a country the table does not hold is "—"', () => {
  assert.deepEqual(['Spain', 'Italy', 'Monaco', 'Netherlands'].map(H2H.h2hIoc), ['ESP', 'ITA', 'MON', 'NED']);
  assert.deepEqual(['United Kingdom', 'USA', 'Czech Republic', 'Taiwan', 'South Korea'].map(H2H.h2hIoc), ['GBR', 'USA', 'CZE', 'TPE', 'KOR']);
  assert.equal(H2H.h2hIoc('World'), '—', 'a neutral athlete: no code, no guess');
  assert.equal(H2H.h2hIoc(null), '—'); assert.equal(H2H.h2hIoc('Atlantis'), '—');
  // every country on the player-profile roster (measured 9 Oct 2026, playerProfiles: 71 names) has a code, bar "World"
  const ROSTER = ['Australia', 'Brazil', 'Portugal', 'Austria', 'Kazakhstan', 'Moldova', 'Argentina', 'Hungary', 'Italy', 'France', 'Croatia',
    'Switzerland', 'Czech Republic', 'United Kingdom', 'Taiwan', 'Peru', 'Chile', 'Slovakia', 'Netherlands', 'USA', 'Georgia', 'Norway',
    'Canada', 'Spain', 'Denmark', 'Japan', 'Uzbekistan', 'Poland', 'China', 'Israel', 'Estonia', 'Greece', 'Finland', 'Tunisia', 'Sweden',
    'Belgium', 'Germany', 'India', 'Bosnia and Herzegovina', 'South Korea', 'Venezuela', 'Colombia', 'Monaco', 'Turkey', 'Lebanon', 'Ukraine',
    'Serbia', 'Paraguay', 'Hong Kong', 'Bulgaria', 'New Zealand', 'South Africa', 'Barbados', 'Bolivia', 'Luxembourg', 'Ecuador', 'Qatar',
    'United Arab Emirates', 'Mexico', 'Jordan', 'Lithuania', 'Romania', 'Morocco', 'Thailand', 'Namibia', 'Ireland', 'Cyprus', 'Montenegro',
    'Pakistan', 'El Salvador', 'Slovenia'];
  const miss = ROSTER.filter(c => !/^[A-Z]{3}$/.test(H2H.h2hIoc(c)));
  assert.deepEqual(miss, [], 'unmapped roster countries');
  // without the table (a page that never loaded it) the tag is a dash, never the full name
  const bare = new Function('window', `${slice('h2hIoc')}\nreturn h2hIoc;`)({});
  assert.equal(bare('Spain'), '—');
});
test('fix 4: the header tags and the picker rows print the code; the Trading report reads the same table', () => {
  const h = page({ SfCountryIoc: IOC });
  const bar = h.call(h.selectorBar, { aPicked: true, bPicked: true, a: PA, b: PB, hAChange: 1, hBChange: 2, hSwap: 3, ctxShow: false });
  assert.deepEqual([...bar.matchAll(/border-radius:5px; padding:1px 6px;">([^<]+)<\/span>/g)].map(m => m[1]), ['ESP', 'ITA'], 'both picked boxes print the IOC code');
  assert.match(slice('pickerTag'), /const base = h2hIoc\(e\.ctry\) \+ ' · '/);
  assert.ok(!/>Spain<|>Italy</.test(bar), 'control: no tag prints the raw name');
  assert.match(TR, /\n  var NAME2IOC = window\.SfCountryIoc\.NAME2IOC;\n  function iocOf\(country\)/, 'one table: the report\'s iocOf reads it');
  assert.equal((TR.match(/'Spain':'ESP'/g) || []).length, 1, 'no second copy');
});

// ---------------------------------------------------------------- fix 7: small copy
test('fix 7: avatar initials = first initial + the FIRST letter of the surname (BV, DM), not its last word', () => {
  const M = H2H.monoOf;
  const want = { 'B. Van De Zandschulp': 'BV', 'D. Merida Aguilar': 'DM', 'A. De Minaur': 'AD', 'F. Auger-Aliassime': 'FA', 'L. van Assche': 'LV',
    'G. Mpetshi Perricard': 'GM', 'R. Bautista-Agut': 'RB', 'P. Carreno-Busta': 'PC', 'A. Davidovich Fokina': 'AD', 'J. M. Cerundolo': 'JC',
    'T. A. Tirante': 'TT', 'J-L. Struff': 'JS', 'C. H. van Schalkwyk': 'CV', 'C. M. Aguilar J.': 'CA', 'C. Alcaraz': 'CA', 'J. Sinner': 'JS' };
  assert.deepEqual(Object.fromEntries(Object.keys(want).map(n => [n, M(n)])), want);
  // a name with no leading initial keeps first + last word (Wu Tung-Lin, a family-name-first name); one word / none
  assert.equal(M('Wu Tung-Lin'), 'WT'); assert.equal(M('Federer'), 'FE'); assert.equal(M(''), '—');
});

test('fix 7: records in sentences carry an en dash (U+2013), line names a true minus (U+2212) — executed', () => {
  const h = page({ loadSetStatsIndex: () => Promise.resolve(new Set()) });
  const rows = [meeting({ date: '2024-06-07', won: true }), meeting({ date: '2025-05-18', won: true }), meeting({ date: '2026-04-12', won: false })];
  const t = text(boxOf(h, rows));
  assert.match(t, /Meetings 3 on record · Alcaraz leads 2–1/);
  assert.match(t, /2024 1–0 · 1 meeting/);
  assert.ok(!/leads \d+-\d+/.test(t), 'no hyphen in the record');
  const defs = new Function(`const FH_H2H_SET1_MIRROR = false;\n${slice('fhH2hLineDefs')}\n${slice('fhFormLineDefs')}\nreturn { fhH2hLineDefs, fhFormLineDefs };`)();
  const names = defs.fhH2hLineDefs('Alcaraz', 'Sinner').concat(defs.fhFormLineDefs('Sinner')).map(d => d.name);
  assert.ok(names.includes('Sinner −2.5 games') && names.includes('Alcaraz −1.5 sets'));
  assert.deepEqual(names.filter(n => /-\d/.test(n)), [], 'no hyphen-minus before a number in any line name (Hot lines, Match analysis too)');
});

// OPEN QUESTION (reported, not decided here): founder r1 fix 7 (2026-10-09) had the no-meetings card name the earliest
// record searched ("Searched both players' match histories since 2019."); the rebuild draws the design's one sentence
// ("These two have never met on record. …", README §3 "Never met") and S.firstYear is computed but no longer printed.
// Kept as a todo so the open question shows on every run until the founder rules.
test('fix 7: the no-meetings card names the EARLIEST record the two loaded histories hold (Sinner 2019 v Vacherot 2021 → since 2019), after the design\'s sentence', () => {
  const h = page();
  const t = text(h.call(h.h2hCard, { a: PA, b: PB, h2h: { S: { firstYear: [2019, 2021] }, all: [], F: [], surf: 'all' } }));
  assert.match(t, /These two have never met on record\. .* Searched both players’ match histories since 2019\./);
});

test('fix 7: the Tournament card location = "City, Country" ("London, UK", "New York, USA"), the city from the pipeline\'s venue table', () => {
  const T = new Function(`${html.slice(html.indexOf('const TOURNAMENT_CATALOG = ['), html.indexOf('\n];\n', html.indexOf('const TOURNAMENT_CATALOG = [')) + 4)}
    ${constLine('TOURNAMENT_CITY')}${constLine('TOURNAMENT_COUNTRY_SHORT')}${slice('tournamentLocation')}
    return { TOURNAMENT_CATALOG, TOURNAMENT_CITY, tournamentLocation };`)();
  const loc = n => T.tournamentLocation(T.TOURNAMENT_CATALOG.find(t => t.name === n));
  assert.equal(loc('Wimbledon'), 'London, UK'); assert.equal(loc('US Open'), 'New York, USA');
  assert.equal(loc('Roland Garros'), 'Paris, France'); assert.equal(loc('Australian Open'), 'Melbourne, Australia');
  assert.equal(loc('Monte Carlo'), 'Monte Carlo, Monaco'); assert.equal(loc('Dubai'), 'Dubai, UAE'); assert.equal(loc('Shanghai'), 'Shanghai, China');
  assert.equal(loc('Hong Kong'), 'Hong Kong', 'a country named for its city prints once');
  assert.equal(T.tournamentLocation(null), null, 'not in the catalog → the card prints "—"');
  // the city is the pipeline's TOURNAMENT_VENUE_HINTS city for every catalog event, bar its geocoding stand-ins
  const a = PIPE.indexOf('const TOURNAMENT_VENUE_HINTS = {'), b = PIPE.indexOf('\n};', a);
  const HINTS = new Function(`return ${PIPE.slice(a + 'const TOURNAMENT_VENUE_HINTS = '.length, b + 2)};`)();
  const GEOCODE = { Wimbledon: 'Wimbledon', 'Monte Carlo': 'Monaco', Marrakech: 'Marrakesh' };   // hint = a weather geocoding name
  const drift = T.TOURNAMENT_CATALOG.filter(t => { const h = HINTS[t.name], city = T.TOURNAMENT_CITY[t.name] || t.name;
    return !h || h.country !== t.country || (GEOCODE[t.name] ? h.city !== GEOCODE[t.name] : h.city !== city); }).map(t => t.name);
  assert.deepEqual(drift, [], 'catalog city / country vs the pipeline');
  assert.match(slice('cTourInfo'), /const region = typeof tournamentLocation === 'function' \? tournamentLocation\(cat\) : null;/);
  assert.ok(!/DisplayNames/.test(slice('cTourInfo')), 'control: the country-only line is gone');
});

// ---------------------------------------------------------------- nit: Career profit chart years
test('nit: the Career profit chart labels every year (2019 … 2026), a short season nudged clear of its neighbour; Last 52 weeks unchanged', () => {
  const B0 = html.indexOf('  // ── TEN-402 c · shared bits'), B1 = html.indexOf('  function newsCard(v) {', B0);
  const blk = html.slice(B0, B1);
  const C = new Function(`${constLine('C_YEAR_GAP')}\n${sliceAt(blk, blk.indexOf('function cChartModel('))}\nreturn cChartModel;`)();
  const GAP = +/const C_YEAR_GAP = ([\d.]+);/.exec(html)[1];
  // Sinner-like: 3 priced matches in 2019, 30 in 2020, 60 a year after; break-even point first (the core's own shape)
  const day = iso => Math.floor(Date.parse(iso) / 86400000);
  const ser = [{ day: day('2019-04-01'), c: 0 }];
  const add = (y, n) => { for (let i = 0; i < n; i++) ser.push({ day: day(`${y}-01-15`) + Math.floor(i * 340 / n), c: (i % 7) * 10 - 20 }); };
  add(2019, 3); add(2020, 30); [2021, 2022, 2023, 2024, 2025].forEach(y => add(y, 60)); add(2026, 40);
  const small = [{ day: day('2021-02-01'), c: 0 }, { day: day('2021-03-01'), c: 50 }, { day: day('2026-03-01'), c: 80 }];
  const M = C(core, small, ser, 'career');
  assert.deepEqual(M.ticks.map(t => t.label), ['2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'], 'every year, none blank');
  M.ticks.forEach((t, i) => { if (i) assert.ok(t.f - M.ticks[i - 1].f >= GAP - 1e-9, t.label + ' clears ' + M.ticks[i - 1].label); });
  assert.ok(M.ticks.every(t => t.f > 0 && t.f < 1), 'inside the axis');
  // a year's label sits on its own run of matches (2022 = indices 94…153 of 394)
  const i22 = ser.findIndex(p => new Date(p.day * 86400000).getUTCFullYear() === 2022);
  assert.ok(Math.abs(M.ticks[3].f - (i22 + 29.5) / (ser.length - 1)) < 1e-9);
  // control: Last 52 weeks keeps six evenly spaced month ticks
  const l52 = C(core, small, ser.slice(-60), 'l52');
  assert.deepEqual(l52.ticks.map(t => t.f), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  // the labels align by position, not by index: first left, last right, the rest centred
  assert.match(slice('marketCard'), /transform:\$\{t\.f <= 0 \? 'none' : t\.f >= 1 \? 'translateX\(-100%\)' : 'translateX\(-50%\)'\};/);
});
