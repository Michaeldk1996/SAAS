// TEN-402 round 1 (founder 2026-10-09), builder X — fixes 1 (Tournament "Last played") and 2 (one tournament name per
// event, site-wide). Fix 6 (Suggested matchups = this week's events) lives in test-ten402-a.mjs next to the rule it
// changes. Every check EXECUTES the shipped code: the functions and tables are sliced out of bsp-consult-dashboard.html
// (TEN402_HTML overrides it for tools/test-ten402-fix-mutants.js) and TournamentIdentity is the real tournament-identity.js.
// Each ruling carries a control so a pass cannot be vacuous.
//
// Run: node --test test-ten402-r1x.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN402_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const TI = createRequire(import.meta.url)(join(HERE, 'tournament-identity.js'));

function sliceFrom(start, label) {
  assert.ok(start >= 0, `${label} not found`);
  let depth = 0, i = html.indexOf('{', start);
  const open = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  assert.ok(i > open, `${label} braces did not balance`);
  return html.slice(start, i + 1);
}
const fnSrc = name => sliceFrom(html.indexOf(`\nfunction ${name}(`) + 1, name);
const objSrc = name => sliceFrom(html.indexOf(`\nconst ${name} = {`) + 1, name) + ';';
const arrSrc = name => { const a = html.indexOf(`\nconst ${name} = [`) + 1; assert.ok(a > 0, name); return html.slice(a, html.indexOf('\n];', a) + 3); };

// ── fix 1 · "Last played" = the player's OWN last row in the event's ledger ──────────────────────────────────────────
const trLastPlayed = new Function(fnSrc('trLastPlayed') + '\nreturn trLastPlayed;')();
const row = (round, won, opp) => ({ round, won, opp });
const ed = (year, rows) => ({ year: String(year), rows });

test('fix 1: Last played = the newest edition WITH a row, and that edition\'s own top row', () => {
  // Sinner, US Open: the ledger ends at 2025 (lost F v Alcaraz); an empty 2026 edition (withdrew / walkover) holds no row
  const P = { eds: [ed(2026, []), ed(2025, [row('F', false, 'C. Alcaraz'), row('SF', true, 'F. Auger-Aliassime')]), ed(2024, [row('F', true, 'T. Fritz')])] };
  P.played = P.eds.filter(e => e.rows.length);
  assert.deepEqual(trLastPlayed(P), { year: '2025', row: P.eds[1].rows[0] });
  // the editions in any order: the year decides, never the list position
  const Q = { eds: [ed(2024, [row('F', true, 'T. Fritz')]), ed(2025, [row('F', false, 'C. Alcaraz')]), ed(2023, [row('R16', false, 'A. Zverev')])] };
  Q.played = Q.eds;
  const lp = trLastPlayed(Q);
  assert.equal(lp.year, '2025');
  assert.equal(lp.row.opp, 'C. Alcaraz', 'the year and the row come from the SAME edition');
  // control: the retired read (first edition in the list, its first row) names 2024 here — the rule is what differs
  assert.equal(Q.played[0].year, '2024');
  assert.equal(trLastPlayed({ eds: [ed(2026, [])] }), null, 'no row → no tile value (a dash)');
  assert.equal(trLastPlayed(null), null);
});
test('fix 1: both Last played tiles read trLastPlayed (Head to Head Tournament card + Match analysis Tournament tab)', () => {
  const panel = sliceFrom(html.indexOf('function cTourPanel('), 'cTourPanel');
  assert.match(panel, /const lp = trLastPlayed\(P\), lr = lp \? lp\.row : null;/);
  assert.match(panel, /cTourTile\('Last played', lp \? lp\.year : '—'/);
  assert.doesNotMatch(panel, /P\.played\[0\]/, 'the panel never reads the list position');
  const tiles = fnSrc('trTilesHtml');
  assert.match(tiles, /const lp = trLastPlayed\(P\);/);
  assert.doesNotMatch(tiles, /P\.played\[0\]/);
});

// ── fix 2 · ONE tournament name per event (sfEventKey / sfEventName) ─────────────────────────────────────────────────
const NAMES = new Function('window', [arrSrc('TOURNAMENT_CATALOG'), objSrc('SF_EVENT_NAMES'), objSrc('SF_EVENT_ALIAS'),
  'let _sfEventIx = null;', fnSrc('ppCleanTournamentName'), fnSrc('fhTournClean'), fnSrc('sfEventKey'), fnSrc('sfEventName'),
  'return { sfEventKey, sfEventName, TOURNAMENT_CATALOG, SF_EVENT_NAMES };'].join('\n'))({ TournamentIdentity: TI });

test('fix 2: every vocabulary of an event prints the one name (the founder\'s list + the feed / archive / shard spellings)', () => {
  const want = {
    'ATP Finals': ['Finals - Turin', 'ATP Finals - Turin', 'ATP Finals', 'Tour Finals', 'Masters Cup', 'Finals', 'Nitto ATP Finals'],
    'Cincinnati Open': ['Cincinnati', 'ATP Cincinnati', 'Cincinnati Masters'],
    'China Open': ['Beijing', 'ATP Beijing'],
    'Roland Garros': ['French Open', 'ATP French Open', 'Roland Garros'],
    'Monte-Carlo Masters': ['Monte Carlo', 'ATP Monte Carlo', 'Monte Carlo Masters', 'Monte-Carlo Masters'],
    'Canadian Open': ['Montreal', 'Toronto', 'ATP Toronto', 'Canada Masters', 'Canadian Open', 'Rogers Cup', 'National Bank Open'],
    "Queen's Club Championships": ['London', 'ATP London', "Queen's Club"],
    'Italian Open': ['Rome', 'Rome Masters', 'ATP Rome'],
    'Indian Wells Masters': ['Indian Wells', 'Indian Wells Masters'],
    'Paris Masters': ['Paris', 'Paris Masters', 'ATP Paris'],
  };
  for (const [name, spellings] of Object.entries(want)) for (const s of spellings) assert.equal(NAMES.sfEventName(s), name, s);
  // a registry event with no event name of its own (an ATP 250) prints the registry's name
  assert.equal(NAMES.sfEventName('ATP Umag'), 'Umag');
  assert.equal(NAMES.sfEventName("'s-Hertogenbosch"), 'Hertogenbosch');
});
test('fix 2: a name the Tournaments registry does not hold keeps its own (cleaned) name — never a guess', () => {
  for (const [raw, out] of [['Laver Cup', 'Laver Cup'], ['ATP Laver Cup', 'Laver Cup'], ['Adelaide 2', 'Adelaide 2'], ['Paris Olympics', 'Paris Olympics'],
    ['Davis Cup Finals QF: ITA vs ARG', 'Davis Cup Finals QF: ITA vs ARG'], ['Great Ocean Road Open', 'Great Ocean Road Open']]) {
    assert.equal(NAMES.sfEventName(raw), out, raw);
  }
  // "Paris Olympics" is not the Paris Masters, "Beijing Olympics" is not the China Open, "London Olympics" not Queen's
  for (const raw of ['Paris Olympics', 'Beijing Olympics', 'London Olympics', 'Tokyo Olympics']) assert.equal(NAMES.sfEventKey(raw), null, raw);
});
test('fix 2: the name table is keyed by the Tournaments registry, and every printed name reads back to its event', () => {
  const reg = new Set(NAMES.TOURNAMENT_CATALOG.map(t => t.name));
  for (const k of Object.keys(NAMES.SF_EVENT_NAMES)) {
    assert.ok(reg.has(k), `${k} is not a Tournaments registry name`);
    assert.equal(NAMES.sfEventName(NAMES.SF_EVENT_NAMES[k]), NAMES.SF_EVENT_NAMES[k], `${k}: the printed name is stable`);
  }
  // control: a name outside the table and the registry resolves to nothing
  assert.equal(NAMES.sfEventKey('Nowhere Open'), null);
});
test('fix 2: the shared rows / sheet / group headers print the one name; meta + hot-line codes still resolve', () => {
  // every normalised row builder (Form, Head to Head, Market edge, career rows → the match-stats sheet header)
  const builders = ['fhRowFromForm', 'meRowFromCareer'].map(fnSrc).join('\n');
  assert.equal((builders.match(/tourn: \(typeof sfEventName === 'function' \? sfEventName : fhTournClean\)\(x\.tournament\)/g) || []).length, 2);
  assert.match(html, /date: x\.date, tourn: \(typeof sfEventName === 'function' \? sfEventName : fhTournClean\)\(x\.tournament\), tournRaw: x\.tournament,   \/\/ r1 fix 2/,
    'the Match analysis Head to Head rows');
  // Playing styles ledger group headers (psGroupMeetings), executed
  const ps = new Function('sfEventName', fnSrc('psGroupMeetings') + '\nreturn psGroupMeetings;')(NAMES.sfEventName);
  const g = ps([{ date: '2025-11-16', tournament: 'ATP Finals' }, { date: '2025-08-18', tournament: 'Cincinnati Masters' }, { date: '2025-08-17', tournament: 'ATP Cincinnati' }]);
  assert.deepEqual(g.map(x => x.tournament + ' ' + x.rows.length), ['ATP Finals 1', 'Cincinnati Open 2']);
  // control: without the one-name function the same rows split into three headers in two vocabularies
  const raw = new Function('sfEventName', fnSrc('psGroupMeetings').replace(/typeof sfEventName === 'function'/, 'false') + '\nreturn psGroupMeetings;')(null);
  assert.equal(raw([{ date: '2025-08-18', tournament: 'Cincinnati Masters' }, { date: '2025-08-17', tournament: 'ATP Cincinnati' }]).length, 2);
  // the group meta (tier) and the hot-line column code still find a printed name
  const metaSrc = ['const PS_TOUR_META = ' + sliceFrom(html.indexOf('const PS_TOUR_META = (() =>') + 'const PS_TOUR_META = '.length, 'PS_TOUR_META') + ')();',
    fnSrc('psNormTour'), fnSrc('psTourMeta'), objSrc('FH_TCODE'), "const FH_DASHC = '—';", fnSrc('fhTournCode')].join('\n');
  const M = new Function('sfEventKey', 'fhTournClean', metaSrc + '\nreturn { psTourMeta, fhTournCode };')(NAMES.sfEventKey, s => s);
  assert.equal(M.psTourMeta('Cincinnati Open').tier, 'Masters 1000');
  assert.equal(M.psTourMeta('Italian Open').tier, 'Masters 1000');
  assert.equal(M.fhTournCode('Monte-Carlo Masters'), 'MC');
  assert.equal(M.fhTournCode('ATP Finals'), 'FIN');
  assert.equal(M.fhTournCode('China Open'), 'BEI');
  // control: with no registry key the printed name has no meta and a made-up code
  const M0 = new Function('sfEventKey', 'fhTournClean', metaSrc + '\nreturn { psTourMeta, fhTournCode };')(() => null, s => s);
  assert.equal(M0.psTourMeta('Cincinnati Open'), null);
  assert.equal(M0.fhTournCode('Monte-Carlo Masters'), 'MON');
});
test('fix 2: the Head to Head Tournament picker and info box print the one name; the selection key stays the raw name', () => {
  const tv = sliceFrom(html.indexOf('function tourneyVals('), 'tourneyVals');
  assert.match(tv, /options: hits\.map\(t2 => \(\{ name: t2\.name, label: evName\(t2\.name\),/);
  assert.match(tv, /info: Object\.assign\(cTourInfo\(selName, surfVote\), \{ name: evName\(selName\)/);
  assert.match(sliceFrom(html.indexOf('function tourneyCard('), 'tourneyCard'), /\$\{E\(o\.label \|\| o\.name\)\}/);
});
