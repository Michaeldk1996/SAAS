// TEN-401 founder follow-up f1 (2026-10-08), builder a — items 1, 3, 4, 5. Every behavioural assertion EXECUTES the
// page's own functions, sliced out of bsp-consult-dashboard.html; each ruling has a mutant control that must go red.
//
//   1. What players say: each note = the player's words only, in curly quotes — no city dateline ("WIMBLEDON:"), no
//      "said X" attribution, no lead-in outside the quote ("after beating Tien:"); the lead-in moves to the meta line
//      ("2026 · after beating Tien"); nothing invented (the cleaned words are a subsequence of the source's, the context a
//      substring of it); a note whose lead-in names its own speaker as the opponent is not traceable; the Overview card
//      shows one quote clamped to 3 lines. Run over EVERY traceable note in tournament-quotes.json.
//   3. Entry list date ranges: every week label (each weekStart in both shards + the four computed chips at several
//      clocks) carries U+2013 and no ASCII hyphen between the dates; the rendered chip and the empty-state copy set the
//      dash in IBM Plex Mono (.el-ndash) — Hanken's en dash is drawn 5.99px vs its 4.58px hyphen and reads as a hyphen.
//   4. Entry list country: a player with no country shows a grey "—" (Medvedev, Rublev, Khachanov, Safiullin on the
//      China Open list); a Bye stays blank.
//   5. Rail: after every Overview render the selected tile is scrolled into the on-screen part of the rail's own list
//      (nearest, instant), the page never scrolls; a tile in the last rows (Hamburg) gets the missing travel as a spacer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const QUOTES = JSON.parse(readFileSync(join(HERE, 'tournament-quotes.json'), 'utf8')).tournaments;

// Cut `function name(...)` out of a source by plain brace counting (the test-ten401-b slicer: the sliced functions carry
// regex literals with quote marks, which a string-aware slicer misreads; their braces are balanced).
function fnSource(src, sig, from = 0) {
  const i = src.indexOf(sig, from);
  if (i < 0) throw new Error('function not found: ' + sig);
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced braces in ' + sig);
}
const ENTRY_AT = (src) => src.indexOf('window.EntryListsTab = (function(){');
const inEntry = (src, name) => fnSource(src, 'function ' + name + '(', ENTRY_AT(src));

// ------------------------------------------------------------------ 1. quotes
// the Overview registry's event names (tourxConditionRegistry().map(t => t.name), read live at :8431 on 2026-10-08)
const REGISTRY = ['Australian Open', 'Roland Garros', 'Wimbledon', 'US Open', 'Indian Wells', 'Miami', 'Monte Carlo', 'Madrid', 'Rome', 'Montreal', 'Toronto',
  'Cincinnati', 'Shanghai', 'Paris', 'Turin', 'Rotterdam', 'Dubai', 'Acapulco', 'Rio de Janeiro', 'Barcelona', 'Halle', 'London', 'Hamburg', 'Washington',
  'Beijing', 'Tokyo', 'Vienna', 'Basel', 'Auckland', 'Adelaide', 'Brisbane', 'Hong Kong', 'Chengdu', 'Hangzhou', 'Doha', 'Marseille', 'Delray Beach', 'Dallas',
  'Montpellier', 'Cordoba', 'Buenos Aires', 'Santiago', 'Los Cabos', 'Marrakech', 'Munich', 'Bucharest', 'Estoril', 'Geneva', 'Lyon', 'Gstaad', 'Bastad',
  'Newport', 'Umag', 'Kitzbuhel', 'Winston-Salem', 'Almaty', 'Antwerp', 'Stockholm', 'Metz', 'Eastbourne', 'Hertogenbosch', 'Mallorca', 'Stuttgart', 'Houston'];
function quoteApi(src) {
  const exclude = src.slice(src.indexOf('const TOURX_QUOTE_EXCLUDE = {'), src.indexOf('let tourxQuoteEventNamesMemo'));
  const code = ['const TOURX_QUOTE_RULE = "traceable";', 'const tourxQuoteCleanCache = new WeakMap();', exclude, 'let tourxQuoteEventNamesMemo = null;',
    'function tourxConditionRegistry(){ return ' + JSON.stringify(REGISTRY.map(name => ({ name }))) + '; }',
    fnSource(src, 'function tourxQuoteEventNames(){'), fnSource(src, 'function tourxQuoteOtherEvent(q, ev){'),
    fnSource(src, 'function tourxQuoteSurname(player){'), fnSource(src, 'function tourxQuoteClean(qt){'),
    fnSource(src, 'function tourxQuoteTraceable(q, ev){'), fnSource(src, 'function tourxQuoteAttrib(qt){'),
    fnSource(src, 'function tourxQuoteText(qt){'), fnSource(src, 'function tourxEscHtml(s){'),
    'return { tourxQuoteClean, tourxQuoteTraceable, tourxQuoteAttrib, tourxQuoteText, tourxQuoteOtherEvent, TOURX_QUOTE_EXCLUDE };'].join('\n');
  return new Function(code)();
}
// founder 2026-10-24: traceable = the importer resolved the speaker to exactly one entrant of that tournament-season
const baseTraceable = q => !!(q && q.player && q.year && q.playerMatch === 'entrant');
// Independent detectors (not the cleaner's own patterns) — run on the raw sheet value and on the rendered words.
const DET = {
  dateline: t => /^[“"]?\s*[A-Z]{3,}(?:[ -][A-Z]{2,})*\b\s*(?:[,:]|\s[-–]\s|\s*["“])/.test(t),
  said: t => /\bsaid\s+(?:[A-Z](?:-[A-Z])?\.\s*)*[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\s*[.,]|\b[A-Z][a-z]+ said\b/.test(t),
  leadIn: t => /^(?:[A-Z][A-Z .'’-]+[,:]?[^"“”]*?)?["“”]?\s*(?:said\s+)?(?:[Oo]n|after|ahead|before|said)\b[^"“”]{0,160}[:,]\s*["“]/.test(t)
    || /["”]\s*On\s[^"“”:]{1,90}:\s*["“]/.test(t),
};
const letters = t => t.toLowerCase().replace(/[^a-z0-9]/g, '');
function isSubsequence(small, big) { let j = 0; for (let i = 0; i < big.length && j < small.length; i++) if (big[i] === small[j]) j++; return j === small.length; }

function checkQuotes(src) {
  const api = quoteApi(src);
  const notes = Object.entries(QUOTES).flatMap(([ev, list]) => list.filter(baseTraceable).map(q => ({ ev, q })));
  if (notes.length < 150) return 'vacuous: only ' + notes.length + ' traceable notes';
  const before = { dateline: 0, said: 0, leadIn: 0 }, after = { dateline: 0, said: 0, leadIn: 0 };
  for (const { ev, q } of notes) {
    for (const k of Object.keys(DET)) if (DET[k](q.text)) before[k]++;
    const c = api.tourxQuoteClean(q);
    const html = api.tourxQuoteText(q);
    if (!html.startsWith('“') || !html.endsWith('”')) return ev + ' / ' + q.player + ': not one pair of curly quotes';
    const words = c.text;
    if (/["“”]/.test(words)) return ev + ' / ' + q.player + ': a quote mark is left inside — narration survived: ' + words.slice(0, 80);
    if (c.unsafe.length) return ev + ' / ' + q.player + ': unsafe ' + c.unsafe.join('; ');
    if (DET.dateline(words)) after.dateline++;
    if (DET.said(words)) after.said++;
    if (/^(?:on|after|ahead of|before|said)\b[^.!?]{0,160}:/i.test(words)) after.leadIn++;
    // never invent: the words are the source's own, in order; the context is a piece of the source
    if (!isSubsequence(letters(words), letters(q.text))) return ev + ' / ' + q.player + ': the rendered words are not the source words';
    if (c.context && !q.text.toLowerCase().includes(c.context.toLowerCase())) return ev + ' / ' + q.player + ': context "' + c.context + '" is not in the note';
    const meta = api.tourxQuoteAttrib(q);
    if (meta !== [String(q.year), c.context].filter(Boolean).join(' · ')) return ev + ' / ' + q.player + ': meta ' + meta;
  }
  if (before.dateline < 50 || before.said < 50 || before.leadIn < 30) return 'vacuous detectors: ' + JSON.stringify(before);
  if (after.dateline || after.said || after.leadIn) return 'artefacts left after cleaning: ' + JSON.stringify(after);
  // named fixtures from the founder's list
  const find = (ev, player, re) => QUOTES[ev].find(q => q.player === player && re.test(q.text));
  const fx = [
    ['Wimbledon', 'M. Fucsovics', /^after beating Tien:/, '2026 · after beating Tien', /^“It was a tough match\./],
    ['Marrakech', 'I. Buse', /^MARRAKECH:/, '2026', /^“The conditions are quite fast, especially coming from the U\.S\. swing, but I’m really happy to be back on clay\.”$/],
    ['Kitzbuhel', 'I. Buse', /^KITZBUHEL:/, '2026', /^“The conditions here are similar to Hamburg, so I feel very comfortable\. I hope I can play/],
    ['Madrid', 'F. Cerundolo', /said F\. Cerundolo/, '2026', /^“The inside courts are a little bit slower\. They have more of a roof/],
    ['Wimbledon', 'J. Mensik', /^on the conditions:/, '2026 · on the conditions', /^“As it got darker/],
    ['Marrakech', 'M. Navone', /Navone said after beating Wawrinka/, '2024 · after beating Wawrinka', /adapt my game\.”$/],
    ['Wimbledon', 'A. Davidovich Fokina', /Misolic:/, '2025', /for example\.”$/],   // other speakers' segments cut
  ];
  for (const [ev, pl, re, meta, text] of fx) {
    const q = find(ev, pl, re);
    if (!q) return 'fixture gone: ' + ev + ' ' + pl;
    if (api.tourxQuoteAttrib(q) !== meta) return ev + ' ' + pl + ': meta "' + api.tourxQuoteAttrib(q) + '" ≠ "' + meta + '"';
    if (!text.test(api.tourxQuoteText(q))) return ev + ' ' + pl + ': text ' + api.tourxQuoteText(q).slice(0, 120);
  }
  // the speaker named as the opponent in the note's own lead-in: someone else's words — not traceable
  // (Houston "after his win over McDonald" is filed under "Mcdonald" — ambiguous in the committed build, resolved to
  // M. McDonald by the live importer run of 2026-10-08: both conflicting notes are covered.)
  const hou = QUOTES.Houston.find(q => /^after his win over McDonald:/.test(q.text));
  const mu = find('Bastad', 'L. Musetti', /defeating Musetti/);
  if (!hou || !mu) return 'conflict fixtures gone';
  const mc = { ...hou, player: 'M. McDonald', playerMatch: 'entrant', year: 2026 };
  if (api.tourxQuoteTraceable(mc) || api.tourxQuoteTraceable(mu)) return 'a note crediting the beaten opponent still ships';
  const dropped = notes.filter(n => !api.tourxQuoteTraceable(n.q));
  if (dropped.length < 1 || dropped.length > 2 || !dropped.some(n => n.q === mu)) return 'expected only the beaten-opponent notes dropped, dropped ' + dropped.map(n => n.ev + ' ' + n.q.player).join(', ');
  return null;
}
// Review fix 2 (2026-10-08): three founder-sheet notes would ship misattributed. Hand-reviewed exclusions (event|speaker|year,
// a reason each) + a generic guard: a lead-in naming another registry event and not its own marks the note not traceable.
function checkQuoteExclusions(src) {
  const api = quoteApi(src);
  const get = (ev, player, year) => QUOTES[ev].find(q => q.player === player && q.year === year);
  for (const [ev, pl, yr] of [['Wimbledon', 'M. Fucsovics', 2026], ['Marrakech', 'M. Bellucci', 2025], ['Bastad', 'J. De Jong', 2025]]) {
    const q = get(ev, pl, yr);
    if (!q) return 'fixture gone: ' + ev + ' ' + pl;
    if (api.tourxQuoteTraceable(q, ev)) return ev + ' ' + pl + ' ' + yr + ' still ships';
    if (!api.tourxQuoteTraceable(q)) return ev + ' ' + pl + ': dropped by the base rule, so the exclusion is untested';
  }
  for (const [k, why] of Object.entries(api.TOURX_QUOTE_EXCLUDE)) if (!/^[^|]+\|[^|]+\|\d{4}$/.test(k) || !why || why.length < 15) return 'exclusion without a key / reason: ' + k;
  // generic guard on its own (no list): De Jong's "after beating Poljicak in Umag" names Umag, not Bastad
  if (api.tourxQuoteOtherEvent(get('Bastad', 'J. De Jong', 2025), 'Bastad') !== 'Umag') return 'the other-event guard misses Umag';
  // a context that also names its own event stays ("on choosing Munich over Barcelona", "on Rome versus Madrid conditions")
  const fon = QUOTES.Munich.find(q => /^on choosing Munich over Barcelona/.test(q.text)), sin = QUOTES.Rome.find(q => /^on Rome versus Madrid/.test(q.text));
  if (!fon || !sin || !api.tourxQuoteTraceable(fon, 'Munich') || !api.tourxQuoteTraceable(sin, 'Rome')) return 'a note naming its own event plus another was dropped';
  // the shipped set: only the conflict / other-event / listed notes are dropped
  let n = 0, ship = 0; const dropped = [];
  for (const [ev, list] of Object.entries(QUOTES)) for (const q of list.filter(baseTraceable)) { n++; if (api.tourxQuoteTraceable(q, ev)) ship++; else dropped.push(ev + '|' + q.player + '|' + q.year); }
  const allowed = new Set(['Wimbledon|M. Fucsovics|2026', 'Marrakech|M. Bellucci|2025', 'Bastad|J. De Jong|2025', 'Bastad|L. Musetti|2022', 'Houston|M. McDonald|2026']);
  const odd = dropped.filter(d => !allowed.has(d));
  if (odd.length) return 'unexpected drops: ' + odd.join(', ');
  if (dropped.length < 4) return 'expected ≥ 4 drops (3 listed + Musetti), got ' + dropped.join(', ');
  return null;
}
// ------------------------------------------------------------------ review 3: the Database row lock's month branch
// The month filter drops 0 real rows today (every European Open clay row is in July), so a synthetic set proves it bites.
function checkRowLockMonths(src) {
  const at = src.indexOf('window.DatabaseTab = (function(){');
  const code = 'const M = { tournaments: ["European Open", "Other Open"] };\n' + fnSource(src, 'function rowLockFor(filter){', at) + '\n'
    + fnSource(src, 'function rowLockOk(lock, r){', at) + '\nreturn { rowLockFor, rowLockOk };';
  const { rowLockFor, rowLockOk } = new Function(code)();
  const lock = rowLockFor({ 'European Open': { years: [2022], surfaces: [0], months: [7] } });
  const row = (date, surf, t) => [date, 0, surf, 0, t];
  const cases = [
    [row(20220718, 0, 0), true, 'Hamburg July clay 2022'],
    [row(20221018, 0, 0), false, 'same season + surface in October (Antwerp\'s month)'],
    [row(20210718, 0, 0), false, 'wrong season'],
    [row(20220718, 1, 0), false, 'wrong surface'],
    [row(20221018, 1, 1), true, 'a row of another string is not locked'],
  ];
  for (const [r, want, what] of cases) if (rowLockOk(lock, r) !== want) return what + ': rowLockOk ' + !want;
  const noMonth = rowLockFor({ 'European Open': { years: [2022], surfaces: [0] } });
  if (!rowLockOk(noMonth, row(20221018, 0, 0))) return 'a filter without months must not filter by month';
  return null;
}

test('f1.1 quotes: the player\'s words only — no dateline / "said X" / lead-in; context in the meta; nothing invented', () => assert.equal(checkQuotes(SRC), null));
test('f1.1 review: hand-reviewed exclusions (Fucsovics, Bellucci, De Jong) + a lead-in naming another event is not traceable', () => assert.equal(checkQuoteExclusions(SRC), null));

test('review 3: the Database row lock filters by month (synthetic rows: European Open July vs October)', () => assert.equal(checkRowLockMonths(SRC), null));

// The old Entry list footnote test (founder 634ea470) is RETIRED: the export's footnote replaces it (founder 2026-11-15).

// Retired 2026-11-15 (founder "Design wins", tournaments tab rebuild): the Overview quote card's 3-line clamp and the rail's
// scroll-into-view (f1.5) belonged to the old renderer (renderTourxOverview / tourxQuotesCardHtml); the design draws neither.
// The new Overview is locked by tools/test-tt-overview.mjs.

test('CONTROL: each ruling goes red on its mutant', () => {
  const m = (a, b) => { assert.ok(SRC.split(a).length === 2, 'mutant anchor not found exactly once: ' + a.slice(0, 60)); return SRC.replace(a, b); };
  const red = (check, src) => { try { return check(src) !== null; } catch (e) { return true; } };
  // 1 — revert each clean-up step
  assert.ok(red(checkQuotes, m("  if (dl) { out.dateline = true; dlCtx = (dl[2] || '').trim(); s = s.slice(dl[0].length); }", "  if (dl) { out.dateline = true; dlCtx = (dl[2] || '').trim(); }")), '1 dateline kept');
  assert.ok(red(checkQuotes, m("      if (kind === 'said') q = q.replace(/,$/, '.');\n      if (q) parts.push(q);", "      if (q) parts.push(q);\n      if (kind === 'said') parts.push(nt);")), '1 said kept');
  assert.ok(red(checkQuotes, m("    out.text = parts.join(' ');", "    out.text = (n0 ? n0 + ': ' : '') + parts.join(' ');")), '1 lead-in kept in the text');
  assert.ok(red(checkQuotes, m("  if (ctx) bits.push(ctx);\n", "")), '1 context not in the meta');
  assert.ok(red(checkQuotes, m("  return `“${tourxEscHtml(tourxQuoteClean(qt).text)}”`;", "  const t = tourxEscHtml(qt.text);\n  return qt.selfQuoted ? t : `“${t}”`;")), '1 old verbatim render');
  assert.ok(red(checkQuotes, m("      if (kind === 'other') { out.trimmed = true; break; }", "")), '1 other speakers kept');
  assert.ok(red(checkQuotes, m(" && !tourxQuoteClean(q).conflict\n", "\n")), '1 beaten-opponent notes ship');
  // review fix 2: the hand-reviewed exclusions and the other-event guard
  assert.ok(red(checkQuoteExclusions, m("  'Wimbledon|M. Fucsovics|2026': ", "  'Wimbledon|M. Fucsovics|1999': ")), '1 Fucsovics (women\'s-match answers) ships');
  assert.ok(red(checkQuoteExclusions, m("  'Marrakech|M. Bellucci|2025': ", "  'Marrakech|M. Bellucci|1999': ")), '1 Bellucci (narration) ships');
  assert.ok(red(checkQuoteExclusions, m("  if (has(ev)) return null;", "  return null;")), '1 other-event guard off');
  assert.ok(red(checkQuoteExclusions, m("  if (has(ev)) return null;", "")), '1 other-event guard drops notes that also name their own event');
  assert.ok(red(checkQuoteExclusions, m("    && !(ev && (TOURX_QUOTE_EXCLUDE[ev + '|' + q.player + '|' + q.year] || tourxQuoteOtherEvent(q, ev)));", "    ;")), '1 event rules not applied');
  // review 3
  assert.ok(red(checkRowLockMonths, m("    if(f.months && !f.months.has(Math.floor(r[0]/100)%100)) return false;\n", "")), 'r3 month check deleted');
});
