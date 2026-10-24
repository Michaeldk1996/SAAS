// Tournament quotes — the ONE speaker rule (founder rulings 2026-10-23/24; tools/quotes/quote-speaker.cjs), run by the
// importer (tools/quotes/build-tournament-quotes.mjs). A dated speaker resolves against THAT tournament-season's
// entrants, never the roster: exactly one entrant = an ID (or a matched entrant with no ID chain), else unresolved and
// not shipped. Undated rows are never resolved.
// The roster-growth case is run through the REAL importer on fixtures: a same-surname player who joins the roster but is
// not in the draw (Petros Tsitsipas, 2026-10-23) must not take a quote from the man who is (Stefanos). The control runs
// the pre-fix roster rule on the same fixture and must fail.
// Run: node tools/test-quote-speaker.js
'use strict';
const fs = require('fs'); const os = require('os'); const path = require('path'); const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const QS = require(path.join(ROOT, 'tools', 'quotes', 'quote-speaker.cjs'));
let pass = 0, fail = 0;
const check = (l, c, d) => { if (c) { pass++; console.log(`  ok   ${l}`); } else { fail++; console.log(`  FAIL ${l}${d ? `\n       ${d}` : ''}`); } };
console.log('Quote speakers — one rule, against that tournament-season\'s entrants');

// ── 1. the rule ─────────────────────────────────────────────────────────────────────────────────────────────────
const stores = {
  profiles: {
    Madrid: { allEditionMatches: [{ season: '2026', matches: [{ p1: 'F. Cerundolo', p1Key: 1104, p2: 'J. M. Cerundolo', p2Key: 388 }, { p1: 'C. Alcaraz', p1Key: 2382, p2: 'T. Daniel', p2Key: 2406 }] }] },
    'French Open': { allEditionMatches: [{ season: '2025', matches: [{ p1: 'J. Sinner', p1Key: 2072, p2: 'A. Zverev', p2Key: 1980 }] }] },
    'Roland Garros': null },
  entrants: {
    'Monte Carlo|2021': { main: [{ name: 'Daniel Evans', key: '2835' }, { name: 'Novak Djokovic', key: '1' }], qual: [{ name: 'Mackenzie Evans', key: null }] },
    'Madrid|2026': { qual: [{ name: 'Felipe Daniel', key: null }] },
    'Madrid|2023': { qual: [{ name: 'Daniel Rincon', key: null }] } } };
const R = (cell, ev, y) => QS.resolveSpeaker(cell, ev, y, stores);
check('a unique surname among that season\'s entrants -> its ID (T. Daniel, Madrid 2026 -> 2406)', R('T. Daniel', 'Madrid', 2026).key === '2406');
check('the initial separates same-surname entrants (F. Cerundolo -> 1104; J. M. Cerundolo -> 388)', R('F. Cerundolo', 'Madrid', 2026).key === '1104' && R('J. M. Cerundolo', 'Madrid', 2026).key === '388');
check('no initial with two same-surname entrants, or an initial that fits neither = ambiguous, no ID', R('Cerundolo', 'Madrid', 2026).status === 'ambiguous' && R('X. Cerundolo', 'Madrid', 2026).key === null);
check('case- and accent-insensitive (CERUNDOLO, f. cerúndolo)', R('f. cerúndolo', 'Madrid', 2026).key === '1104' && R('CERUNDOLO', 'Madrid', 2026).status === 'ambiguous');
check('no edition for that season = no-entrants; no entrant of that surname = unmatched', R('T. Daniel', 'Madrid', 2019).status === 'no-entrants' && R('D. Rincon', 'Madrid', 2026).status === 'unmatched');
check('Roland Garros reads the French Open profile (J. Sinner 2025 -> 2072)', R('J. Sinner', 'Roland Garros', 2025).key === '2072');
check('pre-2022: Sackmann\'s main draw; a same-surname qualifier is separated by the initial (D. Evans -> 2835; Evans -> ambiguous)',
  R('D. Evans', 'Monte Carlo', 2021).key === '2835' && R('Evans', 'Monte Carlo', 2021).status === 'ambiguous');
check('a unique qualifier with no ID chain resolves with key null (shown with the monogram, never a guessed ID)',
  R('D. Rincon', 'Madrid', 2023).status === 'entrant' && R('D. Rincon', 'Madrid', 2023).key === null);
check('a qualifier sharing a store entrant\'s surname: the initial keeps T. Daniel; "Daniel" alone is ambiguous',
  R('T. Daniel', 'Madrid', 2026).key === '2406' && R('Daniel', 'Madrid', 2026).status === 'ambiguous');
check('an undated quote is never resolved', R('T. Daniel', 'Madrid', null).status === 'undated');
// founder 2026-10-24: the sheet surname may be the entrant surname's LAST WHOLE WORD(S); the one-entrant guard stays
const tail = { profiles: { Hamburg: { allEditionMatches: [{ season: '2025', matches: [
  { p1: 'A. Davidovich Fokina', p1Key: 1906, p2: 'F. Auger-Aliassime', p2Key: 1100 },
  { p1: 'M. Garcia Fokina', p1Key: 77, p2: 'C. Ugo Carabelli', p2Key: 11 }] }, { season: '2024', matches: [
  { p1: 'A. Davidovich Fokina', p1Key: 1906, p2: 'F. Auger-Aliassime', p2Key: 1100 }] }] } }, entrants: {} };
const T2 = (cell, y) => QS.resolveSpeaker(cell, 'Hamburg', y, tail);
check('last part: "Fokina" = A. Davidovich Fokina and "Aliassime" = F. Auger-Aliassime (a hyphen splits words) when one entrant has it',
  T2('Fokina', 2024).key === '1906' && T2('Aliassime', 2024).key === '1100' && T2('Carabelli', 2025).key === '11');
check('last part shared by two entrants in the same draw (Davidovich Fokina, Garcia Fokina) = ambiguous, does not ship; the initial still separates',
  T2('Fokina', 2025).status === 'ambiguous' && T2('Fokina', 2025).key === null && T2('A. Fokina', 2025).key === '1906');
check('never part of a word: "Kina" and "Liassime" match nobody', T2('Kina', 2024).status === 'unmatched' && T2('Liassime', 2024).status === 'unmatched');

// ── 2. the roster-growth case, through the real importer ────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quote-speaker-'));
const W = (f, s) => { fs.writeFileSync(path.join(tmp, f), typeof s === 'string' ? s : JSON.stringify(s)); return path.join(tmp, f); };
// a group header opens an UNDATED run; a year in column 1 dates its row and the rows under it (the sheet's layout)
const csv = W('q.csv', 'TOURNAMENT,PLAYER,COMMENTARY\nMUTUA MADRID OPEN,Tsitsipas,"an undated note about the clay."\n' +
  '2023,Tsitsipas,"on the conditions in Madrid: altitude is a different scenario."\n2023,Rincon,"about the qualifying here: it was tough."\n');
// the roster now holds BOTH Tsitsipas brothers; only Stefanos is in Madrid 2023's draw
const roster = W('roster.json', { players: { 1906: { name: 'S. Tsitsipas' }, 1872: { name: 'Pe. Tsitsipas' }, 657: { name: 'D. Rincon' } } });
const profiles = W('profiles.json', { profiles: { Madrid: { allEditionMatches: [{ season: '2023', matches: [{ p1: 'S. Tsitsipas', p1Key: 1906, p2: 'A. Rublev', p2Key: 2847 }] }] } } });
const entrants = W('entrants.json', { events: { 'Madrid|2023': { qual: [{ name: 'Daniel Rincon', key: null }] } } });
const run = () => {
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'quotes', 'build-tournament-quotes.mjs'), '--csv', csv, '--out', path.join(tmp, 'out.json'),
    '--report', path.join(tmp, 'report.md'), '--roster', roster, '--profiles', profiles, '--entrants', entrants], { stdio: 'pipe' });
  return JSON.parse(fs.readFileSync(path.join(tmp, 'out.json'), 'utf8')).tournaments.Madrid;
};
const rows = run();
const ts = rows.find((q) => q.playerRaw === 'Tsitsipas' && q.year === 2023);
check('importer: a bare "Tsitsipas" in Madrid 2023 is Stefanos (1906) although Petros is in the roster — he is not in the draw',
  ts && ts.playerMatch === 'entrant' && ts.playerKey === '1906' && ts.player === 'S. Tsitsipas', JSON.stringify(ts));
const ri = rows.find((q) => q.playerRaw === 'Rincon');
check('importer: Rincon matches one qualifier with no ID chain — resolved, key null, the sheet\'s spelling kept', ri && ri.playerMatch === 'entrant' && ri.playerKey === null && ri.player === 'Rincon', JSON.stringify(ri));
const un = rows.find((q) => q.year === null);
check('importer: the undated row stays unresolved (playerMatch undated, no key)', un && un.playerMatch === 'undated' && un.playerKey === null, JSON.stringify(un));
const rep = fs.readFileSync(path.join(tmp, 'report.md'), 'utf8');
check('importer report: the speaker section names the one rule and counts resolved / unresolved / undated', /## Speakers \(one rule/.test(rep) && /resolved to exactly one entrant: \*\*2\*\*/.test(rep) && /Undated rows .*\*\*1\*\*/.test(rep));
// the CSV is the founder's sheet, word for word: the importer never writes it
check('the CSV is read, never written', fs.readFileSync(csv, 'utf8').includes('2023,Tsitsipas,'));

// ── 3. control: the pre-fix rule (the roster's surname index, as build-tournament-quotes.mjs had it) on the same fixture
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
function prefixResolve(cell, players) {
  const bySurname = new Map(); const full = new Set();
  for (const k of Object.keys(players)) { const name = players[k].name.trim(); full.add(name); const toks = name.split(/\s+/);
    for (let s = Math.max(1, toks.length - 3); s < toks.length; s++) { const key = norm(toks.slice(s).join('')); if (!bySurname.has(key)) bySurname.set(key, new Set()); bySurname.get(key).add(name); } }
  for (const f of full) if (norm(f) === norm(cell)) return { status: 'exact' };
  const c = bySurname.get(norm(cell.replace(/^[A-Z]\.\s*/, '').trim() || cell));
  return c && c.size === 1 ? { status: 'surname' } : c && c.size > 1 ? { status: 'ambiguous' } : { status: 'unmatched' };
}
check('control: the pre-fix roster rule calls the same "Tsitsipas" ambiguous (the quote vanished from the page)',
  prefixResolve('Tsitsipas', JSON.parse(fs.readFileSync(roster, 'utf8')).players).status === 'ambiguous');
// count alert: a second build that ships fewer quotes than the last one is FLAGGED, and the import still completes
const run2 = (entrantsFile) => { try {
  const o = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'quotes', 'build-tournament-quotes.mjs'), '--csv', csv, '--out', path.join(tmp, 'out.json'),
    '--report', path.join(tmp, 'report.md'), '--roster', roster, '--profiles', profiles, '--entrants', entrantsFile], { stdio: 'pipe', encoding: 'utf8' });
  return { code: 0, out: o }; } catch (e) { return { code: e.status, out: String(e.stderr || '') }; } };
const noQual = W('entrants-empty.json', { events: {} });
let r1 = run2(entrants);   // 2 shipped (Tsitsipas, Rincon) — the baseline
const r2 = (() => { const { spawnSync } = require('child_process');
  return spawnSync(process.execPath, [path.join(ROOT, 'tools', 'quotes', 'build-tournament-quotes.mjs'), '--csv', csv, '--out', path.join(tmp, 'out.json'),
    '--report', path.join(tmp, 'report.md'), '--roster', roster, '--profiles', profiles, '--entrants', noQual], { encoding: 'utf8' }); })();
const rep2 = fs.readFileSync(path.join(tmp, 'report.md'), 'utf8');
check('count alert: shipped 2 -> 1 is flagged (::warning:: on stderr, first report section) and the import still exits 0',
  r1.code === 0 && r2.status === 0 && /::warning::tournament quotes: SHIPPED QUOTES DROPPED 2 -> 1/.test(r2.stderr) && /## ⚠ SHIPPED QUOTES DROPPED: 2 → 1/.test(rep2),
  'exit ' + r2.status + ' ' + String(r2.stderr).slice(0, 200));
const r3 = run2(noQual);
check('control: an unchanged count raises no alert', r3.code === 0 && !/SHIPPED QUOTES DROPPED/.test(fs.readFileSync(path.join(tmp, 'report.md'), 'utf8')));
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
