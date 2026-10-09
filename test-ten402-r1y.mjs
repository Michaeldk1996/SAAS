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

// ---------------------------------------------------------------- the Head-to-head card, executed
const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CARD = new Function('E', `
  const FH_DASHC = '—', FH_HOT_MIN_ELIGIBLE = 3; let _h2hDbSt = 'ready', _fh = null;
  const state = {}; const bindH = () => 0; const setState = () => {};
  function sectionHead(t) { return '<h3>' + t + '</h3>'; } function h2hSeg() { return ''; } function fhEnsureStyles() {}
  function fhScoreLines() { return { scored: [], covMap: {} }; } function fhH2hLineDefs() { return []; }
  function fhHotLinesTable() { return null; } function fhHotMoreHtml() { return ''; }
  ${constLine('MA_ROW_COLS')}${constLine('MA_ROW_GAP')}${constLine('MA_ROW_COLS_H2H')}${constLine('MA_ROW_GAP_H2H')}${constLine('H2H_HOT_FOOT')}${constLine('H2H_PX_NOTE')}
  ${['escapeHtml', 'maMatchRowsHtml', 'fhSetTxt', 'fhH2hSetScores', 'fhDDMM', 'fhOdd', 'h2hTug', 'h2hPriceTitle', 'h2hPxNote', 'h2hCard'].map(slice).join('\n')}
  return { h2hCard, maMatchRowsHtml };`)(E);
const meeting = (o) => Object.assign({ mid: 'm' + o.date, tourn: 'Monte Carlo', surface: 'Clay', round: 'F', won: false, pS: 0, oS: 2,
  sets: [[6, 7, 5], [3, 6]], price: 2.0, oppPrice: 1.8, book: 'P' }, o);
const viewOf = (rows, S) => ({ h2h: { S: Object.assign({ pm: {} }, S || {}), all: rows, F: rows, surf: 'all', aS: 'Alcaraz', bS: 'Sinner', aName: 'C. Alcaraz', bName: 'J. Sinner', bFull: 'J. Sinner' } });

test('fix 3: the Meetings ledger marks no row\'s book — one footnote "Closing price · Pinnacle, else Bet365" under it', () => {
  const rows = [meeting({ date: '2026-04-12', book: 'B' }), meeting({ date: '2025-11-16', tourn: 'Finals - Turin', surface: 'Hard', won: false, price: 2.8, oppPrice: 1.5, book: 'P' })];
  const h = CARD.h2hCard(viewOf(rows));
  assert.ok(!h.includes('ma-row-mark'), 'no B (the "°" the founder saw) after a Bet365 price');
  assert.match(text(h), / 2\.00 1\.80 /, 'the Bet365 row keeps its prices');
  assert.match(h, /title="Bet365 closing price · Database join \(Tennis-Data\) — no Pinnacle price for this match"/, 'the hover still names the book');
  const notes = h.match(/<div class="h2hp-pxnote"[^>]*>([^<]*)<\/div>/g) || [];
  assert.equal(notes.length, 1, 'one footnote under the ledger');
  assert.match(notes[0], />Closing price · Pinnacle, else Bet365<\/div>$/);
  assert.match(notes[0], /font-family:var\(--font-nums\); font-size:10\.5px; color:var\(--text-label\);/);
  assert.ok(h.indexOf('class="h2hp-ledger"') < h.indexOf('h2hp-pxnote'), 'under the ledger, not above it');
  // control: the shared renderer still draws a mark for a host that asks for one (Match analysis keeps its B)
  assert.match(CARD.maMatchRowsHtml([{ title: null, rows: [{ date: '1', opp: 'x', rd: 'F', sets: '2 - 0', scores: '', h: '2.00', a: '1.80', hMark: 'B' }] }], {}), /class="ma-row-mark"[^>]*>B</);
});

test('fix 3: the Playing styles and Tournament ledgers mark no row either; each carries the footnote; the old "B = Bet365" line is gone', () => {
  const sty = slice('cStyleLedger'), tp = slice('cTourPanel'), tc = slice('tourneyCard');
  assert.match(sty, /hTitle: h2hPriceTitle\(q\), aTitle: h2hPriceTitle\(q\), hMark: '' \};/);
  assert.match(sty, /\$\{maMatchRowsHtml\(groups, C_LED_OPTS\)\}\$\{more\}<\/div>\n\s*\$\{h2hPxNote\(\)\}/, 'under the Playing styles ledger');
  assert.match(tp, /Object\.assign\(trRowData\(r\), \{ hTitle: h2hPriceTitle\(r\), aTitle: h2hPriceTitle\(r\), hMark: '',/, 'trRowData\'s B is overridden on this page only');
  assert.match(tp, /\$\{rows \? h2hPxNote\('padding:4px 14px 14px;'\) : ''\}/, 'under each Tournament ledger (none when the panel has no rows)');
  assert.ok(!/trSrcLine\(/.test(tc), 'the Tournament card no longer prints "Closing odds · … · B = Bet365"');
  // control: Match analysis's Tournament rows keep their B (the founder scoped the change to this page's ledgers)
  assert.match(slice('trRowData'), /hMark: r\.price != null && r\.book === 'B' \? 'B' : '',/);
});

// The sheet header (fhSheetHeadHtml), executed: the Head to Head page's sheet vs any other host.
const HEAD = new Function('_fh', `
  const FH_DASH = 'var(--text-label)', FH_DASHC = '—';
  ${constLine('FH_MONO')}${constLine('FH_BOOK')}${constLine('FH_SRC')}
  function fhSurname(n) { return String(n || '').split(/\\s+/).pop(); } function aAvatarHtml() { return ''; }
  function fhEsc(s) { return String(s == null ? '' : s); }
  ${['fhDDMM', 'fhSrcTitle', 'fhB365Tag', 'fhB365Meta', 'fhSheetHeadHtml'].map(slice).join('\n')}
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
  assert.match(html, /<span class="h2h-ctry">\$\{E\(h2hIoc\(v\.a\.ctry\)\)\}<\/span>/);
  assert.match(html, /<span class="h2h-ctry">\$\{E\(h2hIoc\(v\.b\.ctry\)\)\}<\/span>/);
  assert.match(slice('pickerTag'), /const base = h2hIoc\(e\.ctry\) \+ ' · '/);
  assert.equal((html.match(/h2h-ctry">\$\{E\(v\.[ab]\.ctry\)\}/g) || []).length, 0, 'control: no tag prints the raw name');
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
  const rows = [meeting({ date: '2024-06-07', won: true }), meeting({ date: '2025-05-18', won: true }), meeting({ date: '2026-04-12', won: false })];
  const t = text(CARD.h2hCard(viewOf(rows)));
  assert.match(t, /3 on record · Alcaraz leads 2–1/);
  assert.ok(!/leads \d+-\d+/.test(t), 'no hyphen in the record');
  const defs = new Function(`const FH_H2H_SET1_MIRROR = false;\n${slice('fhH2hLineDefs')}\n${slice('fhFormLineDefs')}\nreturn { fhH2hLineDefs, fhFormLineDefs };`)();
  const names = defs.fhH2hLineDefs('Alcaraz', 'Sinner').concat(defs.fhFormLineDefs('Sinner')).map(d => d.name);
  assert.ok(names.includes('Sinner −2.5 games') && names.includes('Alcaraz −1.5 sets'));
  assert.deepEqual(names.filter(n => /-\d/.test(n)), [], 'no hyphen-minus before a number in any line name (Hot lines, Match analysis too)');
});

test('fix 7: the no-meetings card names the EARLIEST record the two loaded histories hold (Sinner 2019 v Vacherot 2021 → since 2019)', () => {
  const none = (fy) => text(CARD.h2hCard(viewOf([], { firstYear: fy })));
  assert.match(none([2019, 2021]), /Searched both players' match histories since 2019\./);
  assert.match(none([2021, 2019]), /since 2019\./, 'either side');
  assert.match(none([2022, null]), /since 2022\./, 'one history unread: the other still bounds the search');
  assert.match(none([null, null]), /Searched both players' match histories\.$/, 'nothing read → no year');
  assert.ok(!/since 2021/.test(none([2019, 2021])), 'control: never the later player\'s start');
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
  assert.match(slice('curveSVG'), /transform:\$\{t\.f <= 0 \? 'none' : t\.f >= 1 \? 'translateX\(-100%\)' : 'translateX\(-50%\)'\};/);
});
