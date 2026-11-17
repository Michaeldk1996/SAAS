// TEN-402 (step 8 · Head to Head, builder b) — the Head-to-head record: meetings, prices, the match-stats sheet, the card.
//
// Drives the REAL code sliced out of bsp-consult-dashboard.html (never a copy of a rule). One test per ruling the build
// applies, each with a control where a pass could be vacuous.
//
// Run: node --test test-ten402-b.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN402_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');

function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found in bsp-consult-dashboard.html`);
  let depth = 0, i = html.indexOf('{', start);
  const open = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  assert.ok(i > open, `${name} braces did not balance`);
  return html.slice(start, i + 1);
}
const constLine = name => {
  const m = new RegExp(`^\\s*const ${name} = [^\\n]*$`, 'm').exec(html);
  assert.ok(m, `const ${name} not found`);
  return m[0].replace(/\/\/[^'\n]*$/, '');
};

const h2hCardSrc = slice('h2hCard');

// ---------------------------------------------------------------- Data 1: the meetings
// TEN-437: the page's join is THE site-wide one, H2HCore.joinMeetings (h2h-core.js) — required here, never a copy.
const H2HCore = createRequire(import.meta.url)(join(HERE, 'h2h-core.js'));
const joinM = H2HCore.joinMeetings;
const A = { key: '1', short: 'J. Sinner', full: 'J. Sinner' }, B = { key: '2', short: 'C. Alcaraz', full: 'C. Alcaraz' };
const row = (o) => Object.assign({ level: 'atp', round: 'F', result: '2 - 0', sets: [{ p: 6, o: 4 }, { p: 6, o: 3 }] }, o);

test('Data 1: a meeting is the same match in both players\' files — by eventKey, else the same date with opposite results', () => {
  const chA = [row({ eventKey: 10, date: '2025-05-18', won: false, opponent: 'C. Alcaraz', tournament: 'Rome' }),
    row({ date: '2016-08-29', won: true, opponent: 'C. Alcaraz', tournament: 'US Open' }),            // archive row: no eventKey
    row({ eventKey: 11, date: '2025-06-01', won: true, opponent: 'T. Fritz', tournament: 'Paris' })]; // another opponent
  const chB = [row({ eventKey: 10, date: '2025-05-18', won: true, opponent: 'J. Sinner', tournament: 'Rome' }),
    row({ date: '2016-08-29', won: false, opponent: 'J. Sinner', tournament: 'US Open' })];
  const out =joinM(A, B, chA, chB, {}, []);
  assert.deepEqual(out.map(x => [x.date, x.won, x._how]), [['2016-08-29', true, 'both'], ['2025-05-18', false, 'both']], 'oldest first, both joined, the other opponent out');
  // two rows that disagree (same eventKey, the same result) count nowhere — neither side's copy
  const bad =joinM(A, B, [row({ eventKey: 7, date: '2025-01-01', won: true, opponent: 'C. Alcaraz' })], [row({ eventKey: 7, date: '2025-01-01', won: true, opponent: 'J. Sinner' })], {}, []);
  assert.equal(bad.length, 0);
});

test('Data 1 / TEN-263: a row only one side records counts only when its name is unique on the roster; a namesake is never credited', () => {
  const chA = [row({ date: '2019-03-01', won: true, opponent: 'Z. Zhang', tournament: 'Old Open' })];
  const Z = { key: '590', short: 'Z. Zhang', full: 'Z. Zhang' };
  assert.equal(joinM(A, Z, chA, [], { 'zhang|z': 2 }, []).length, 0, 'two roster players share "Z. Zhang": not credited');
  assert.equal(joinM(A, Z, chA, [], { 'zhang|z': 1 }, []).length, 1, 'control: a unique name counts');
  // B-only: flipped to A's side (result, winner, set games and tiebreak points)
  const chB = [row({ date: '2020-02-02', won: true, opponent: 'J. Sinner', result: '2 - 1', sets: [{ p: 6, o: 7, pTb: 5, oTb: 7 }, { p: 6, o: 3 }, { p: 6, o: 2 }] })];
  const f =joinM(A, B, [], chB, {}, [])[0];
  assert.equal(f.won, false); assert.equal(f.result, '1 - 2');
  assert.deepEqual(f.sets[0], { p: 7, o: 6, pTb: 7, oTb: 5 });
  assert.equal(f.opponent, 'C. Alcaraz');
});

// TEN-437 (founder 2026-10-14, replaces TEN-402 Data 1's "including exhibitions"): ATP's official H2H population — read off
// atptour.com's own H2H data: Laver Cup counted, exhibitions (Six Kings Slam) and Hopman Cup absent.
test('Data 1: ATP\'s record — Challenger / ITF and qualifying out; Laver Cup in, exhibitions and Hopman Cup out; own board match out', () => {
  const mk = (ek, o) => [row(Object.assign({ eventKey: ek, date: '2024-0' + (ek % 9 + 1) + '-01', won: true, opponent: 'C. Alcaraz' }, o)),
    row(Object.assign({ eventKey: ek, date: '2024-0' + (ek % 9 + 1) + '-01', won: false, opponent: 'J. Sinner' }, o))];
  const pairs = [mk(1, { tournament: 'ATP Laver Cup' }), mk(2, { tournament: 'Six Kings Slam' }), mk(3, { tournament: 'Bergamo', level: 'chitf' }),
    mk(4, { tournament: 'Wimbledon', round: 'Qualifying' }), mk(5, { tournament: 'Beijing', qualifying: true }), mk(6, { tournament: 'Today' }),
    mk(7, { tournament: 'ATP Hopman Cup' })];
  const out =joinM(A, B, pairs.map(p => p[0]), pairs.map(p => p[1]), {}, [6]);
  assert.deepEqual(out.map(x => x.eventKey).sort(), [1], 'Laver Cup kept; the exhibition, Hopman Cup, CH, qualifying ×2 and the own board match dropped');
  assert.deepEqual(H2HCore.H2H_LEVELS, ['atp']);
  assert.match(html, /const joined = H2HCore\.joinMeetings\(withId\(a\), withId\(b\), S\.chA, S\.chB, /, 'the page calls the one join');
});

test('Data 1: walkovers are not completed meetings; the record is counted by the A-side key file', () => {
  assert.match(h2hCardSrc, /const F = h\.F, n = F\.length, aw = F\.filter\(r => r\.won\)\.length, bw = n - aw;/, 'record = rows A won');
  assert.match(html, /S\.rows = S\.rows\.filter\(r => !r\.wo\);/, 'walkovers dropped before the record, lines and ledger');
  assert.match(html, /const r = fhRowFromForm\(Object\.assign\(\{\}, x, \{ tier: x\.level \}\), a\.key, a\.short, i\);/, 'rows normalised by the shared helper, oriented to A by key');
});

// ---------------------------------------------------------------- Data 2: the Database price join
const fhDayNum = new Function(`${slice('fhDayNum')}\nreturn fhDayNum;`)();
const JOIN_SRC = `const FH_DASHC = '—';\n${['H2H_PAGE_PRICE_WINDOW', 'H2H_PAGE_MATCH_WINDOW', 'H2H_PAGE_START_WINDOW', 'H2H_PAGE_ROW_WINDOW', 'H2H_TD_ROUND', 'H2H_PAGE_BEFORE_RANK'].map(constLine).join('\n')}
${['fhIsInitial', 'fhNameKey', 'psRoundAbbr', 'h2hRoundLabel', 'fhRoundCode', 'h2hTdIx', 'h2hTdKey', 'h2hTdSame', 'h2hTdRound', 'h2hTdEvent', 'h2hNearest', 'h2hPriceJoin'].map(slice).join('\n')}`;
const J = new Function('fhDayNum', `${JOIN_SRC}\nreturn { h2hPriceJoin, h2hTdKey, h2hTdSame, h2hTdRound, fhRoundCode };`)(fhDayNum);
const priceJoin = J.h2hPriceJoin;
// TEN-402 (founder ruling 2026-10-08): the join's rows = the Database rows + the retirements behind the store's flag
// (retRows / retNames) — the page's own DatabaseTab helper, sliced (never a copy of the merge).
const dbPriceJoinRows = new Function(`${slice('dbPriceJoinRows')}\nreturn dbPriceJoinRows;`)();
const readStore = () => [JSON.parse(readFileSync(join(HERE, 'database-yield.json'), 'utf8')), JSON.parse(readFileSync(join(HERE, 'database-yield-players.json'), 'utf8'))];
const dbOnly = () => { const [b, n] = readStore(); return { rows: b.rows, names: n.names, meta: b.meta }; };   // the Database page's rows alone

test('Data 2: Home = A\'s closing price, Away = B\'s, from the Database rows (book kept; the ledger marks no row, r1 fix 3)', () => {
  const db = { meta: { rounds: ['The Final', 'Semifinals'] },
    rows: [[20250518, 0, 0, 0, 0, 1.63, 2.43, 0, 0], [20260412, 0, 0, 0, 0, 1.80, 2.00, 1, 1]],   // [date, lvl, surf, rnd, tour, fav, dog, favWon, book]
    names: [['Alcaraz C.', 'Sinner J.'], ['Sinner J.', 'Alcaraz C.']] };
  const rows = [{ date: '2025-05-18', won: false, round: 'F' }, { date: '2026-04-12', won: true, round: 'F' }];
  assert.equal(priceJoin(rows, A, B, db), 2);
  // row 0: the favourite (1.63) lost, so the winner Alcaraz carries 2.43 and A (Sinner, the loser) 1.63
  assert.deepEqual([rows[0].price, rows[0].oppPrice, rows[0].book, rows[0].src], [1.63, 2.43, 'P', 'td']);
  // row 1: Bet365 (book 1), the favourite Sinner (A) won at 1.80
  assert.deepEqual([rows[1].price, rows[1].oppPrice, rows[1].book], [1.80, 2.00, 'B']);
  // the meetings row's B marker and its hover are executed in "TEN-437 item 4" below (the meetings box)
});

test('lower-level era rows never move a main-draw event (2026-11-01: pre-2021 qualifying filed under "Wimbledon")', () => {
  // [date, level, surface, round, tournament, fav, dog, favWon, book]; levels 0 = Grand Slam, 1 = ATP Qualifying
  const mk = (withQual) => { const db = { meta: { levels: ['Grand Slam', 'ATP Qualifying'], rounds: ['1st Round', '2nd Round', '3rd Round', '4th Round', ''], surfaces: [''], tournaments: ['Wimbledon'] }, rows: [], names: [] };
    const add = (d, lv, rd, w, l, f, g, fw) => { db.rows.push([d, lv, 0, rd, 0, f, g, fw, 0]); db.names.push([w, l]); };
    add(20170703, 0, 0, 'Ramos-Vinolas A.', 'Thompson J.', 1.78, 2.16, 1); add(20170705, 0, 1, 'Ramos-Vinolas A.', 'Kudla D.', 1.4, 3, 1);
    add(20170707, 0, 2, 'Ramos-Vinolas A.', 'Isner J.', 2, 1.8, 0); add(20170709, 0, 3, 'Federer R.', 'Dimitrov G.', 1.1, 7, 1);
    if (withQual) [20170626, 20170627, 20170628, 20170629, 20170630].forEach((d, j) => add(d, 1, 4, 'Qual' + j + ' A.', 'Qual' + j + ' B.', 1.6, 2.3, 1));   // the qualifying week
    return db; };
  // the career store dates a pre-2021 archive row at the event START (3 July), so the join compares event starts
  const career = [{ date: '2017-07-03', won: false, opponent: 'A. Ramos', round: 'R128', tournament: 'Wimbledon' }];
  const price = db => { const x = [{ date: '2017-07-03', won: false, round: 'R128' }]; priceJoin(x, { full: 'J. Thompson' }, { full: 'A. Ramos' }, db, null, career); return x[0].price; };
  assert.equal(price(mk(false)), 2.16, 'control: the main draw alone joins (R128 = 1st of 4 numbered rounds)');
  assert.equal(price(mk(true)), 2.16, 'a qualifying week under the same name (26-30 June, the main draw from 3 July) changes nothing');
});

test('Data 2: a meeting with no matching Database row is a dash — wrong winner, outside the window, a round that contradicts, or two equally close', () => {
  const db = { meta: { rounds: ['The Final', 'Semifinals', '2nd Round'] }, names: [], rows: [] };
  const add = (d, w, l, rnd) => { db.rows.push([d, 0, 0, rnd, 0, 1.5, 2.5, 1, 0]); db.names.push([w, l]); };
  add(20240310, 'Sinner J.', 'Alcaraz C.', 0);
  const one = r => { const x = Object.assign({ round: 'F' }, r); priceJoin([x], A, B, db); return x.price == null ? null : x.price; };
  assert.equal(one({ date: '2024-03-10', won: false }), null, 'the Database winner is Sinner: an A loss never takes it');
  assert.equal(one({ date: '2024-03-10', won: true }), 1.5, 'control: the same row, the right winner');
  assert.equal(one({ date: '2024-02-20', won: true }), null, '19 days before the Database date: outside the window');
  assert.equal(one({ date: '2024-02-24', won: true }), 1.5, 'a pre-2021 archive date is the event start: up to 16 days earlier still joins');
  assert.equal(one({ date: '2024-03-10', won: true, round: 'SF' }), null, 'a semi-final never takes a final\'s price');
  add(20240312, 'Sinner J.', 'Alcaraz C.', 2);   // a second row two days later
  add(20240308, 'Sinner J.', 'Alcaraz C.', 2);   // and one two days earlier: equally close
  assert.equal(one({ date: '2024-03-10', won: true, round: null }), 1.5, 'the exact date wins over ±2 days');
  assert.equal(one({ date: '2024-03-11', won: true, round: null }), null, 'two rows one day either side: never a guess');
  // review 2 (b): numbered rounds compare too — this event's last numbered round is the 2nd, so "2nd Round" = R16
  assert.equal(one({ date: '2024-03-12', won: true, round: 'R16' }), 1.5, 'R16 = the archive\'s 2nd Round of a two-round draw');
  assert.equal(one({ date: '2024-03-12', won: true, round: 'R32' }), null, 'an R32 never takes the 2nd Round (R16) of a 32 draw');
  const ns = { meta: { rounds: [] }, names: [['Sinner Ja.', 'Alcaraz C.']], rows: [[20240310, 0, 0, 0, 0, 1.5, 2.5, 1, 0]] };
  const x = { date: '2024-03-10', won: true, round: 'F' }; priceJoin([x], { full: 'M. Sinner' }, B, ns);
  assert.equal(x.price ?? null, null, 'another initial (M. v J.) is another player');
});

test('archive name table (founder brief 2026-10-15 item 2): an aliased archive name meets its player; control: without the table Barrios Vera misses', () => {
  const TB = { full: 'T. Barrios Vera' }, BER = { full: 'M. Berrettini' }, ZZ = { full: 'Z. Zhang' }, OP = { full: 'C. Wong' };
  const base = { meta: { rounds: ['1st Round'] }, rows: [[20260217, 0, 0, 0, 0, 1.30, 3.50, 1, 1], [20260924, 0, 0, 0, 0, 1.40, 2.80, 1, 0]],
    retRows: [] };
  // row 2 is a feed-added match (pinarch td_name spells Zhizhen Zhang "Zhang Z."): it must keep joining Z. Zhang
  const nm = { names: [['Berrettini M.', 'Barrios M.'], ['Wong C.', 'Zhang Z.']], retNames: [], aliases: { 'Barrios M.': 'T. Barrios Vera' } };
  const ledger = () => [{ date: '2026-02-17', won: false, round: null }];
  const zz = () => [{ date: '2026-09-24', won: false, round: null }];
  const db = dbPriceJoinRows(base, nm);
  const a = ledger(); priceJoin(a, TB, BER, db);
  assert.deepEqual([a[0].price, a[0].oppPrice], [3.50, 1.30], 'T. Barrios Vera meets "Barrios M." (Rio 2026, the loser at 3.50)');
  const z = zz(); priceJoin(z, ZZ, OP, db);
  assert.equal(z[0].price, 2.80, 'a feed row\'s "Zhang Z." still prices Z. Zhang (no name is blocked)');
  // the aliased player's OWN spelling still meets the row (G. Miguel's profile reads "L. A. Miguel", as the archive does)
  const mg = dbPriceJoinRows({ meta: { rounds: ['1st Round'] }, rows: [[20260218, 0, 0, 0, 0, 1.10, 7.00, 1, 1]], retRows: [] },
    { names: [['Gaubas V.', 'Miguel L.']], retNames: [], aliases: { 'Miguel L.': 'G. Miguel' } });
  const g1 = [{ date: '2026-02-18', won: true, round: null }]; priceJoin(g1, { full: 'V. Gaubas' }, { full: 'G. Miguel' }, mg);
  const g2 = [{ date: '2026-02-18', won: false, round: null }]; priceJoin(g2, { full: 'L. A. Miguel' }, { full: 'V. Gaubas' }, mg);
  assert.deepEqual([g1[0].price, g2[0].price], [1.10, 7.00], 'both sides meet "Miguel L.": Gaubas v G. Miguel and Miguel\'s own "L. A. Miguel"');
  // 17 Oct: 67442 gained a profile spelled "L. A. Miguel" (his newest fixture) while Gaubas's Rio row still says "G. Miguel".
  // The table carries BOTH spellings; every one meets the row. Control: the profile spelling alone unjoins Gaubas's row.
  const mgRows = { meta: { rounds: ['1st Round'] }, rows: [[20260218, 0, 0, 0, 0, 1.10, 7.00, 1, 1]], retRows: [] };
  const both = dbPriceJoinRows(mgRows, { names: [['Gaubas V.', 'Miguel L.']], retNames: [], aliases: { 'Miguel L.': ['L. A. Miguel', 'G. Miguel'] } });
  const h1 = [{ date: '2026-02-18', won: true, round: null }]; priceJoin(h1, { full: 'V. Gaubas' }, { full: 'G. Miguel' }, both);
  const h2 = [{ date: '2026-02-18', won: false, round: null }]; priceJoin(h2, { full: 'L. A. Miguel' }, { full: 'V. Gaubas' }, both);
  assert.deepEqual([h1[0].price, h2[0].price], [1.10, 7.00], 'a two-spelling alias: Gaubas v "G. Miguel" and Miguel\'s profile "L. A. Miguel" both price');
  const only = dbPriceJoinRows(mgRows, { names: [['Gaubas V.', 'Miguel L.']], retNames: [], aliases: { 'Miguel L.': 'L. A. Miguel' } });
  const h3 = [{ date: '2026-02-18', won: true, round: null }]; priceJoin(h3, { full: 'V. Gaubas' }, { full: 'G. Miguel' }, only);
  assert.equal(h3[0].price ?? null, null, 'control: the profile spelling alone misses Gaubas\'s "G. Miguel" row (the 17 Oct red pipeline)');
  const bsrc = readFileSync(join(HERE, 'build-database-yield.js'), 'utf8');
  assert.match(bsrc, /new Set\(\[prof\[k\] && prof\[k\]\.name, ARCHIVE_ALIAS_NAMES\[k\]\]\.filter\(Boolean\)\)/, 'the build carries the profile\'s AND the table\'s spelling');
  const ctl = dbPriceJoinRows(base, { names: nm.names, retNames: [] });
  const c1 = ledger(); priceJoin(c1, TB, BER, ctl);
  assert.equal(c1[0].price ?? null, null, 'control: no table, the initials differ and Barrios Vera misses');
  const OP_ = createRequire(import.meta.url)(join(HERE, 'build-odds-performance.js'));
  assert.equal(OP_.ARCHIVE_NAME_ALIASES['Miguel L.'], '67442', 'the archive\'s "Miguel L." (Rio 2026) is G. Miguel');
  assert.equal(OP_.ARCHIVE_NAME_ALIASES['Barrios M.'], '396');
  assert.equal(OP_.ARCHIVE_ALIAS_NAMES['67442'], 'G. Miguel', 'G. Miguel has no profile: the table carries his fixture spelling');
  const src = readFileSync(join(HERE, 'build-database-yield.js'), 'utf8');
  assert.match(src, /ARCHIVE_NAME_ALIASES, ARCHIVE_ALIAS_NAMES, ARCHIVE_PAGE_SPELLINGS \} = require\('\.\/build-odds-performance\.js'\)/);
  // founder ruling 2026-10-17 (ruling 1): the spellings that left career matches unjoined are in the table, each with
  // the spelling its career rows carry (Dolgopolov's own initial; Statham as his 2008-21 rows spell him)
  for (const [n, our] of [['Dolgopolov O.', 'A. Dolgopolov'], ['Zhang Ze', 'Z. Zhang'], ['Zhang Ze.', 'Z. Zhang'], ['Moroni G.M.', 'M. Moroni'], ['Moroni G.', 'M. Moroni'],
    ['Statham J.', 'R. Statham'], ['Madaras D.', 'N. Madaras'], ['Aragone JC', 'J. Aragone'], ['Aragone J.C.', 'J. Aragone'], ['Hernandez-Fernandez J', 'J. Hernandez-Fernandez'], ['Wu T.L.', 'Wu Tung-Lin']])
    assert.equal(OP_.ARCHIVE_PAGE_SPELLINGS[n], our, n);
  assert.equal(OP_.ARCHIVE_NAME_ALIASES['Monteiro J.'], '1074', 'the one "Monteiro J." row is T. Monteiro');
  // and the page join meets them: Djokovic v Ze Zhang, China Open 2015 (the archive's "Zhang Ze"); control without the table
  const zeDb = { meta: { rounds: ['2nd Round'] }, rows: [[20151008, 0, 0, 0, 0, 1.01, 21.0, 1, 0]], retRows: [] };
  const zeJ = dbPriceJoinRows(zeDb, { names: [['Djokovic N.', 'Zhang Ze']], retNames: [], aliases: { 'Zhang Ze': 'Z. Zhang' } });
  const zeR = [{ date: '2015-10-08', won: true, round: null }]; priceJoin(zeR, { full: 'N. Djokovic' }, { full: 'Z. Zhang' }, zeJ);
  assert.equal(zeR[0].price, 1.01, '"Zhang Ze" meets Z. Zhang');
  const zeC = [{ date: '2015-10-08', won: true, round: null }]; priceJoin(zeC, { full: 'N. Djokovic' }, { full: 'Z. Zhang' }, dbPriceJoinRows(zeDb, { names: [['Djokovic N.', 'Zhang Ze']], retNames: [] }));
  assert.equal(zeC[0].price ?? null, null, 'control: without the alias "Zhang Ze" misses');
  assert.doesNotMatch(src.split('const nameTable')[1].split('writeAtomic(OUT_NAMES')[0], /ARCHIVE_NAME_BLOCK/, 'the block list is not carried to the page join');
});

test('round tolerance (founder ruling 2026-10-17, ruling 2): ONE candidate with the same date, players, winner and event joins across a round difference; two never', () => {
  const TOL = new Function('fhDayNum', `${JOIN_SRC}
    function trSameEvent(t, names){ const a = String(t || '').toLowerCase(); return names.some(n => { const b = String(n || '').toLowerCase(); return !!b && (a.includes(b) || b.includes(a)); }); }
    return h2hPriceJoin;`)(fhDayNum);
  // Lyon 2022: Tennis-Data files Molcan v Coria as "2nd Round"; the feed (career-history) says QF
  const db = { meta: { rounds: ['2nd Round', 'Quarterfinals'], tournaments: ['Lyon Open', 'Geneva Open'] },
    rows: [[20220519, 0, 0, 0, 0, 1.70, 2.15, 1, 0]], names: [['Molcan A.', 'Coria F.']] };
  const career = [{ date: '2022-05-19', won: true, opponent: 'F. Coria', round: '1/4-finals', tournament: 'Lyon', eventKey: 1 }];
  // fresh copies per run: the join memoises its step 1 on the db object and the career array
  const fresh = d => JSON.parse(JSON.stringify(d));
  const run = (d, c) => { const rows = [{ date: '2022-05-19', won: true, round: 'QF' }]; TOL(rows, { full: 'A. Molcan' }, { full: 'F. Coria' }, fresh(d), null, fresh(c)); return rows[0].price ?? null; };
  // the strict join alone: a contradicting round is a dash (control: no trSameEvent → strict only)
  const strict = new Function('fhDayNum', `${JOIN_SRC}\nreturn h2hPriceJoin;`)(fhDayNum);
  const r0 = [{ date: '2022-05-19', won: true, round: 'QF' }]; strict(r0, { full: 'A. Molcan' }, { full: 'F. Coria' }, fresh(db), null, fresh(career));
  assert.equal(r0[0].price ?? null, null, 'control: without the tolerance the round clash is a dash');
  assert.equal(run(db, career), 1.70, 'one candidate, same date / players / winner / event: priced across the round difference');
  // two candidates (the same pair twice that week) → never a guess
  const two = { meta: db.meta, rows: db.rows.concat([[20220520, 0, 0, 0, 0, 1.80, 2.00, 1, 0]]), names: db.names.concat([['Molcan A.', 'Coria F.']]) };
  assert.equal(run(two, career), null, 'two candidates: a dash');
  // another event (Geneva) with the same date and players: no
  const other = { meta: db.meta, rows: [[20220519, 0, 0, 0, 1, 1.70, 2.15, 1, 0]], names: db.names };
  assert.equal(run(other, career), null, 'a different event never joins');
  // the wrong winner never joins
  assert.equal(run({ meta: db.meta, rows: [[20220519, 0, 0, 0, 0, 1.70, 2.15, 1, 0]], names: [['Coria F.', 'Molcan A.']] }, career), null, 'the other winner: a dash');
  // founder brief 2026-10-19 (item 1): Tennis-Data names the event by its sponsor ("Adelaide International 2"); the feed files
  // Kwon's lucky-loser run as "Qualifying" at "Adelaide 2". The Database page's own city map (DatabaseTab.tdCity) joins them.
  const kdb = { meta: { rounds: ['Quarterfinals'], tournaments: ['Adelaide International 2', 'Adelaide International 1'] },
    rows: [[20230112, 0, 0, 0, 0, 1.75, 2.21, 0, 0]], names: [['Kwon S.W.', 'Ymer M.']] };
  const kc = [{ date: '2023-01-12', won: true, opponent: 'M. Ymer', round: 'Qualifying', tournament: 'Adelaide 2', eventKey: 11806553 }];
  const kRun = (d, city) => { const g = globalThis.window; globalThis.window = { DatabaseTab: city ? { tdCity: city } : {} };
    try { const rows = [{ date: '2023-01-12', won: true, round: null }]; TOL(rows, { full: 'S. Kwon' }, { full: 'M. Ymer' }, fresh(d), null, fresh(kc)); return rows[0].price ?? null; }
    finally { globalThis.window = g; } };
  const CITY = n => ({ 'Adelaide International 2': 'Adelaide 2', 'Adelaide International 1': 'Adelaide 1' })[n] || null;
  assert.equal(kRun(kdb, CITY), 2.21, 'Kwon d. Ymer, Adelaide 2 2023 QF: the sponsor name meets the feed\'s "Adelaide 2" through the city map');
  assert.equal(kRun(kdb, null), null, 'control: without the city map the sponsor name never meets "Adelaide 2" (a dash, as before)');
  assert.equal(kRun({ meta: kdb.meta, rows: [[20230112, 0, 0, 0, 1, 1.75, 2.21, 0, 0]], names: kdb.names }, CITY), null, 'Adelaide 1 never takes an Adelaide 2 match');
});

test('one source of truth (founder 2026-10-17): the era shard (before 2010 + team events) joins on a COPY of the dictionaries; out of step never prices', () => {
  const base = { meta: { levels: ['Grand Slam'], surfaces: ['Hard'], rounds: ['The Final'], tournaments: ['Australian Open'] },
    rows: [[20250126, 0, 0, 0, 0, 1.40, 3.00, 1, 0]], retRows: [] };
  const nm = { names: [['Sinner J.', 'Zverev A.']], retNames: [] };
  const xs = { xRows: [[20080127, 'Grand Slam', 'Hard', 'The Final', 'Australian Open', 1.30, 3.60, 1, 0, 'p'],
    [20260912, null, 'Hard', '', 'Davis Cup World Group', 1.20, 4.50, 1, 1, 't']], xNames: [['Djokovic N.', 'Tsonga J.W.'], ['Sinner J.', 'Doe J.']] };
  const before = JSON.stringify(base.meta);
  const J0 = dbPriceJoinRows(base, nm, xs);
  assert.equal(JSON.stringify(base.meta), before, 'the Database page\'s own dictionaries gain no entry');
  assert.deepEqual([J0.rows.length, J0.nDb, J0.nX], [3, 1, 2]);
  assert.deepEqual(J0.rows[1], [20080127, 0, 0, 0, 0, 1.30, 3.60, 1, 0], 'a pre-2010 row reuses the strings the store already has');
  const t = J0.rows[2];
  assert.deepEqual([t[1], J0.meta.tournaments[t[4]], J0.meta.rounds[t[3]], t[8]], [-1, 'Davis Cup World Group', '', 1], 'a team row: no level, its own event, its book');
  const dj = [{ date: '2008-01-27', won: true, round: 'F' }];
  priceJoin(dj, { full: 'N. Djokovic' }, { full: 'J. W. Tsonga' }, J0);
  assert.deepEqual([dj[0].price, dj[0].oppPrice, dj[0].book], [1.30, 3.60, 'P'], 'Australian Open 2008 F prices from the era shard');
  const dc = [{ date: '2026-09-12', won: true, round: null }];
  priceJoin(dc, { full: 'J. Sinner' }, { full: 'J. Doe' }, J0);
  assert.deepEqual([dc[0].price, dc[0].oppPrice, dc[0].book], [1.20, 4.50, 'B'], 'a Davis Cup tie prices from the era shard');
  assert.throws(() => dbPriceJoinRows(base, nm, { xRows: xs.xRows, xNames: xs.xNames.slice(1) }), /xRows \/ xNames out of step/);
  // control: without the shard the same two meetings are dashes
  const J1 = dbPriceJoinRows(base, nm);
  const d1 = [{ date: '2008-01-27', won: true, round: 'F' }]; priceJoin(d1, { full: 'N. Djokovic' }, { full: 'J. W. Tsonga' }, J1);
  assert.equal(d1[0].price ?? null, null, 'control: no era shard, Australian Open 2008 F is a dash');
  assert.equal(J1.meta, base.meta, 'no shard: the meta is the store\'s own (no copy made)');
});

test('founder 2026-11-08: a team-event row joins a keyless archive career row match day to match day (every Davis Cup tie shares one event name, so its "start" is not the tie\'s)', () => {
  const base = { meta: { levels: ['Grand Slam'], surfaces: ['Hard'], rounds: [''], tournaments: ['Australian Open'] }, rows: [], retRows: [] };
  const nm = { names: [], retNames: [] };
  // Davis Cup Finals 2021: rubbers every day from 25 Nov, so the shared name "Davis Cup" runs from 25 Nov to 5 Dec
  const dcRow = (d, w, l, pw, pl) => [d, null, '', '', 'Davis Cup', pw, pl, 1, 8, 't'];
  const xs = { xRows: [dcRow(20211125, 0, 0, 1.5, 2.6), dcRow(20211128, 0, 0, 1.4, 2.9), dcRow(20211201, 0, 0, 1.3, 3.4), dcRow(20211205, 0, 0, 1.17, 5.92)],
    xNames: [['Gojo B.', 'Popyrin A.'], ['Doe J.', 'Roe R.'], ['Moe M.', 'Poe P.'], ['Rublev A.', 'Gojo B.']] };
  const career = [{ date: '2021-12-05', won: false, opponent: 'A. Rublev', round: 'RR', tournament: 'Davis Cup Finals F: RTF vs CRO', eventKey: null, level: 'atp' }];
  const J0 = dbPriceJoinRows(base, nm, xs);
  const rows = [{ date: '2021-12-05', won: false, round: 'RR' }];
  priceJoin(rows, { full: 'B. Gojo' }, null, J0, () => 'A. Rublev', JSON.parse(JSON.stringify(career)));
  assert.deepEqual([rows[0].price, rows[0].oppPrice], [5.92, 1.17], 'Gojo v Rublev, Davis Cup Finals 2021 F, takes its Tennis Explorer price');
  // control: read as a non-team row (the pre-fix join), the tie's "start" is 25 Nov and the 5 Dec match is refused
  const J1 = Object.assign({}, dbPriceJoinRows(base, nm, xs), { tIx: new Set() });
  const r1 = [{ date: '2021-12-05', won: false, round: 'RR' }];
  priceJoin(r1, { full: 'B. Gojo' }, null, J1, () => 'A. Rublev', JSON.parse(JSON.stringify(career)));
  assert.equal(r1[0].price ?? null, null, 'control: without the team rule the match is a dash (the bug)');
  // the other winner still never joins
  const r2 = [{ date: '2021-12-05', won: true, round: 'RR' }];
  priceJoin(r2, { full: 'B. Gojo' }, null, dbPriceJoinRows(base, nm, xs), () => 'A. Rublev', [Object.assign({}, career[0], { won: true })]);
  assert.equal(r2[0].price ?? null, null, 'the other winner: a dash');
});

test('founder 2026-11-11: a team-event row prices a team-event career match only, never a tour match beside it', () => {
  // Goffin, March 2016: the Davis Cup tie v Cilic (Sun 6 Mar, Tennis Explorer, flag t) and the Indian Wells QF v Cilic
  // (Tennis-Data 17 Mar); the career rows are archive rows, dated at their event's start (4 and 7 Mar)
  const base = { meta: { levels: ['Masters 1000'], surfaces: ['Hard'], rounds: ['Quarterfinals'], tournaments: ['BNP Paribas Open'] },
    rows: [[20160310, 0, 0, 0, 0, 1.50, 2.60, 1, 0], [20160314, 0, 0, 0, 0, 1.40, 2.90, 1, 0], [20160317, 0, 0, 0, 0, 1.70, 2.32, 0, 0]], retRows: [] };   // the event runs 10–17 Mar
  const nm = { names: [['Doe J.', 'Roe R.'], ['Moe M.', 'Poe P.'], ['Goffin D.', 'Cilic M.']], retNames: [] };
  const xs = { xRows: [[20160306, null, '', '', 'Davis Cup', 1.71, 2.24, 0, 8, 't']], xNames: [['Goffin D.', 'Cilic M.']] };
  const career = [
    { date: '2016-03-04', won: true, opponent: 'M. Cilic', round: 'RR', tournament: 'Davis Cup WG R1: CRO vs BEL', eventKey: null, level: 'atp' },
    { date: '2016-03-07', won: true, opponent: 'M. Cilic', round: 'QF', tournament: 'Indian Wells Masters', eventKey: null, level: 'atp' }];
  const go = J => { const rows = career.map(r => ({ date: r.date, won: r.won, round: r.round, opp: r.opponent, tournament: r.tournament }));
    priceJoin(rows, { full: 'D. Goffin' }, null, J, r => r.opp, JSON.parse(JSON.stringify(career))); return rows.map(r => [r.price ?? null, r.oppPrice ?? null]); };
  const got = go(dbPriceJoinRows(base, nm, xs));
  assert.deepEqual(got[1], [2.32, 1.70], 'Indian Wells QF keeps its own Pinnacle close (Goffin the underdog at 2.32)');
  assert.deepEqual(got[0], [2.24, 1.71], 'the Davis Cup tie takes the Tennis Explorer price');
  // control: with the tour row read as a team-event row, the Davis Cup price (a day from the event start) lands on Indian Wells
  const ctl = new Function('fhDayNum', JOIN_SRC.replace("if (c.team && !m.row && !m.team) return;", '') + '\nreturn h2hPriceJoin;')(fhDayNum);
  const rows = career.map(r => ({ date: r.date, won: r.won, round: r.round, opp: r.opponent }));
  ctl(rows, { full: 'D. Goffin' }, null, dbPriceJoinRows(base, nm, xs), r => r.opp, JSON.parse(JSON.stringify(career)));
  assert.deepEqual([rows[1].price, rows[1].oppPrice], [2.24, 1.71], 'control: without the rule Indian Wells shows the Davis Cup price (the bug)');
});

test('founder ruling 2026-10-18 (item 3): ATP qualifying, Challenger and ITF ride the era shard behind flag l and price through the ONE join, each with its source', () => {
  const base = { meta: { levels: ['Grand Slam'], surfaces: ['Hard'], rounds: ['The Final'], tournaments: ['Australian Open'] },
    rows: [[20250126, 0, 0, 0, 0, 1.40, 3.00, 1, 0]], retRows: [] };
  const nm = { names: [['Sinner J.', 'Zverev A.']], retNames: [] };
  const xs = { xRows: [[20260520, 'Challenger', '', '', 'Challenger Bordeaux', 1.62, 2.30, 1, 5, 'l'],
    [20260310, 'ITF', '', '', 'M25 Antalya', 1.75, 2.05, 0, 6, 'l'],
    [20261005, 'ATP Qualifying', '', '', 'ATP Shanghai - Qualification', 1.50, 2.60, 1, 3, 'l']],
    xNames: [['Bergs Z.', 'Herbert P.H.'], ['Doe J.', 'Roe R.'], ['Bergs Z.', 'Moe M.']] };
  globalThis.FH_SRC = globalThis.FH_SRC || { hist: 'from Pinnacle history', cap: 'captured' };   // the page's label table (this harness slices none)
  const J = dbPriceJoinRows(base, nm, xs);
  const one = (date, won, self, opp) => { const v = [{ date, won, round: null }]; priceJoin(v, { full: self }, { full: opp }, J); return [v[0].price, v[0].oppPrice, v[0].book, v[0].src]; };
  assert.deepEqual(one('2026-05-20', true, 'Z. Bergs', 'P. Herbert'), [1.62, 2.30, 'A', 'od10'], 'Challenger, start − 10 (book 5): Pinnacle (approx.)');
  assert.deepEqual(one('2026-03-10', true, 'J. Doe', 'R. Roe'), [2.05, 1.75, 'B', 'cap'], 'ITF, our captured Bet365 (book 6): Bet365 with source cap — hovers "Bet365 (approx.) · not a confirmed close"');
  assert.deepEqual(one('2026-10-05', true, 'Z. Bergs', 'M. Moe'), [1.50, 2.60, 'P', 'hist'], 'ATP qualifying from 17 Sep: our archive close (book 3)');
  // control: no shard → the same Challenger match is a dash, never another price
  assert.equal(one.call(null, '2026-05-20', true, 'Z. Bergs', 'P. Herbert') && (() => { const v = [{ date: '2026-05-20', won: true, round: null }]; priceJoin(v, { full: 'Z. Bergs' }, { full: 'P. Herbert' }, dbPriceJoinRows(base, nm)); return v[0].price ?? null; })(), null);
});

test('Data 2 on the real stores: every Sinner–Alcaraz price equals the odds archive (Pinnacle, else Bet365) — a retirement too, on the ATP result (ruling 2026-10-08)', () => {
  const db = dbPriceJoinRows(...readStore());
  const csv = [];
  for (const f of readdirSync(join(HERE, 'odds-archive')).filter(f => /^\d{4}\.csv$/.test(f))) {
    const [head, ...lines] = readFileSync(join(HERE, 'odds-archive', f), 'utf8').split(/\r?\n/);
    const c = head.split(','), ix = k => c.indexOf(k);
    for (const l of lines) {
      const v = l.split(',');
      const pair = [v[ix('winner')], v[ix('loser')]];
      if (pair.includes('Sinner J.') && pair.includes('Alcaraz C.')) csv.push({ date: v[ix('date')], aWon: v[ix('winner')] === 'Alcaraz C.', comment: v[ix('comment')],
        ps: [+v[ix('psw')], +v[ix('psl')]], b: [+v[ix('b365w')], +v[ix('b365l')]] });
    }
  }
  assert.ok(csv.length >= 17, 'the archive holds every meeting since Paris 2021 (17 on 2026-10-08)');
  const Alc = { full: 'C. Alcaraz' }, Sin = { full: 'J. Sinner' };
  // archive-like rows for player A = Alcaraz; one date one day late, as career-history carries IW 2023 (19.03 v 18.03)
  const rows = csv.map(m => ({ date: m.date === '2023-03-18' ? '2023-03-19' : m.date, won: m.aWon, round: null }));
  priceJoin(rows, Alc, Sin, db);
  assert.ok(csv.some(m => m.comment === 'Retired'), 'the archive holds the Cincinnati 2025 final (Sinner retired)');
  csv.forEach((m, i) => {
    const r = rows[i];
    const use = m.ps.every(p => p > 1) ? m.ps : m.b;
    const own = m.aWon ? use[0] : use[1], opp = m.aWon ? use[1] : use[0];
    assert.deepEqual([r.price, r.oppPrice], [own, opp], m.date);
    assert.equal(r.book, use === m.ps ? 'P' : 'B', m.date + ' book');
  });
  // Cincinnati 2025 F: Alcaraz won (Sinner retired) — priced at the Pinnacle close, Alcaraz 2.71 / Sinner 1.53
  const cin = rows[csv.findIndex(m => m.date === '2025-08-18')];
  assert.deepEqual([cin.won, cin.price, cin.oppPrice, cin.book], [true, 2.71, 1.53, 'P']);
  // control: the Database page's rows alone (the retirement voided) leave it a dash — the flag is what prices it
  const ctl = [{ date: '2025-08-18', won: true, round: null }];
  priceJoin(ctl, Alc, Sin, dbOnly());
  assert.equal(ctl[0].price ?? null, null);
});

test('ruling 2026-10-08: the store keeps retirements BEHIND A FLAG — retRows / retNames, never in rows / names (every Database figure unchanged)', () => {
  const [b, n] = readStore();
  assert.ok(Array.isArray(b.retRows) && b.retRows.length > 1000 && b.retRows.length === n.retNames.length, 'retRows / retNames parallel');
  assert.equal(b.meta.retired.priced, b.retRows.length);
  assert.equal(b.rows.length, b.meta.used, 'rows = the Database\'s used rows only');
  assert.ok(b.meta.exclusions.retired >= b.retRows.length, 'the Database still voids (and counts) every retirement');
  const J0 = dbPriceJoinRows(b, n);
  assert.equal(J0.rows.length, b.rows.length + b.retRows.length + (b.tieRows || []).length); assert.equal(J0.nDb, b.rows.length);
  assert.equal(J0.rows[0], b.rows[0], 'the Database rows first, untouched');
  assert.throws(() => dbPriceJoinRows(b, { names: n.names, retNames: n.retNames.slice(1) }), /out of step/, 'a names shard out of step never prices');
  // every Database row is a Completed archive match; every flagged row a Retired one (spot-checked on the archive)
  const isoOf = d => String(d).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  const arch = new Map();
  for (const f of readdirSync(join(HERE, 'odds-archive')).filter(f => /^20(2[2-5])\.csv$/.test(f))) {
    const [head, ...lines] = readFileSync(join(HERE, 'odds-archive', f), 'utf8').split(/\r?\n/); const c = head.split(','), ix = k => c.indexOf(k);
    for (const l of lines) { const v = l.split(','); if (v.length > 5) arch.set(v[ix('date')] + '|' + v[ix('winner')] + '|' + v[ix('loser')], v[ix('comment')]); }
  }
  let seen = 0;
  b.retRows.forEach((r, i) => { const k = isoOf(r[0]) + '|' + n.retNames[i][0] + '|' + n.retNames[i][1]; if (arch.has(k)) { seen++; assert.match(arch.get(k), /^(Retired|Rrtired)$/, k); } });
  assert.ok(seen > 100, 'spot check reached ' + seen + ' flagged rows');
  b.rows.forEach((r, i) => { const k = isoOf(r[0]) + '|' + n.names[i][0] + '|' + n.names[i][1]; if (arch.has(k)) assert.equal(arch.get(k), 'Completed', k); });
});

// Founder ruling 2026-10-16 (ruling 3): "Keep tied prices. Exclude them only from favourite/underdog figures."
test('ruling 2026-10-16: exact price ties ride BEHIND A FLAG — tieRows / tieNames, priced at the tie in the join, in no Database row', () => {
  const [b, n] = readStore();
  assert.ok(Array.isArray(b.tieRows) && b.tieRows.length > 150 && b.tieRows.length === n.tieNames.length, 'tieRows / tieNames parallel');
  assert.equal(b.meta.ties.kept, b.tieRows.length);
  assert.ok(b.tieRows.every(r => r[5] === r[6]), 'every kept row is an exact tie');
  assert.ok(!b.rows.some(r => r[5] === r[6]), 'control: no Database row is a tie (every favourite / underdog figure excludes them)');
  assert.ok(b.meta.exclusions.exactTie >= b.tieRows.length, 'the Database still counts every tie as excluded');
  const J = dbPriceJoinRows(b, n);
  assert.equal(J.rows.length, b.rows.length + b.retRows.length + b.tieRows.length, 'the join holds the ties');
  assert.equal(J.rows[J.rows.length - 1], b.tieRows[b.tieRows.length - 1], 'the ties last, after the retirements');
  assert.throws(() => dbPriceJoinRows(b, { names: n.names, retNames: n.retNames, tieNames: n.tieNames.slice(1) }), /tieRows \/ tieNames out of step/, 'a tie names shard out of step never prices');
  const J1 = dbPriceJoinRows({ rows: b.rows, retRows: b.retRows, meta: b.meta }, { names: n.names, retNames: n.retNames });
  assert.equal(J1.rows.length, b.rows.length + b.retRows.length, 'control: a store without tieRows joins as before');
  // Zverev v Ruud, Roland Garros 2023 SF (an exact 1.95 tie): priced in the join, never a Database row
  const zi = n.tieNames.findIndex(x => x[0] === 'Ruud C.' && x[1] === 'Zverev A.');
  assert.ok(zi >= 0 && b.tieRows[zi][0] === 20230609 && b.tieRows[zi][5] === 1.95, 'Ruud d. Zverev RG 2023 SF priced 1.95 / 1.95');
});

// ---------------------------------------------------------------- the match-stats sheet (shared with Match analysis)
// the site's lower-is-better list (MATCH_STAT_ORDER) + its reader, sliced with fhSheetBetter (review 2, item 6)
const LOWER_SRC = `${/\nconst MATCH_STAT_ORDER = \[[\s\S]*?\n\];/.exec(html)[0]}\n${slice('fhLowerIsBetter')}`;
const rowHtml = tone => new Function('FH_MONO', 'MA_GREY', 'FH_DASH', 'fhEsc', 'FH_BAR_CAP', 'fhSheetTone',
  `${LOWER_SRC}; ${slice('fhStatBarWidth')}; ${slice('fhSheetBetter')}; ${slice('fhSheetRowHtml')}; return fhSheetRowHtml;`)(
  "font-family:'IBM Plex Mono',monospace;", 'var(--text-label)', 'var(--text-label)', s => String(s), 90, () => tone);
const cell = (v, txt) => ({ v, txt: txt || String(v), sub: '', title: '' });
const figs = h => [...h.matchAll(/font-size:15px; font-weight:(\d+); color:([^;]+);">([^<]*)</g)].map(m => [m[3], +m[1], m[2]]);
const fills = h => [...h.matchAll(/class="fh-sbar" style="height:6px; width:[\d.]+%; background:([^;]+);"/g)].map(m => m[1]);
const H2H_A = 'var(--h2h-blue)', H2H_B = 'var(--h2h-text)';

// Founder 2026-11-16 (design_handoff_head_to_head, DF L470–476): the page's sheet is drawn BY PLAYER — player one blue,
// player two white, figures and bars, both figures 700, whoever leads (replaces the white-bars / better-figure rule of
// TEN-402 item 5 / item 8 and review 2 item 6 on this sheet). Every other host keeps its own rule (controls below).
test('the Head to Head sheet is drawn by player: A\'s figure and bar --h2h-blue, B\'s --h2h-text, both 700, whoever leads', () => {
  const R = rowHtml('h2h');
  for (const s of [{ label: 'Dominance ratio', kind: 'ratio', a: cell(1.15, '1.15'), b: cell(0.87, '0.87') },
    { label: 'Serve rating', kind: 'rating', k: 400, a: cell(266), b: cell(296) },
    { label: 'Double faults', kind: 'count', k: 15, a: cell(5), b: cell(2) },
    { label: 'Unforced errors / total points', kind: 'pct', a: cell(22, '0.22'), b: cell(27, '0.27') }]) {
    assert.deepEqual(figs(R(s)).map(f => [f[1], f[2]]), [[700, H2H_A], [700, H2H_B]], s.label + ': figures by player');
    if (s.kind !== 'ratio') assert.deepEqual(fills(R(s)), [H2H_A, H2H_B], s.label + ': bars by player, never by leader');
  }
  assert.deepEqual(figs(R({ label: 'Aces', kind: 'count', k: 30, a: cell(null, '—'), b: cell(4) })).map(f => f[2]), ['var(--text-label)', H2H_B], 'a dash stays grey');
  // controls: Match analysis keeps the longer-bar pair and both figures white 700; the profile keeps --link / --text
  assert.deepEqual(fills(rowHtml(null)({ label: 'Serve rating', kind: 'rating', k: 400, a: cell(296), b: cell(266) })), ['var(--bar)', 'var(--bar-2)']);
  assert.deepEqual(fills(rowHtml(null)({ label: 'Double faults', kind: 'count', k: 15, a: cell(5), b: cell(2) })), ['var(--bar)', 'var(--bar-2)'], 'Match analysis: the longer bar leads (founder Q3)');
  assert.deepEqual(figs(rowHtml(null)({ label: 'Dominance ratio', kind: 'ratio', a: cell(1.15, '1.15'), b: cell(0.87, '0.87') })).map(f => [f[1], f[2]]), [[700, 'var(--text)'], [700, 'var(--text)']]);
  assert.deepEqual(fills(rowHtml('pp2')({ label: 'Aces', kind: 'count', k: 30, a: cell(3), b: cell(9) })), ['var(--link)', 'var(--text)'], 'profile v2: by player in its own colours');
  // the site's lower-is-better list is unchanged (it still decides Match analysis' better figure elsewhere)
  const low = new Function(`${LOWER_SRC}; return fhLowerIsBetter;`)();
  assert.deepEqual(['Double faults', 'Unforced errors', 'Unforced errors / total points', 'Winners / unforced errors', 'Aces', 'Dominance ratio'].map(low), [true, true, true, false, false, false]);
});

test('the sheet\'s tone is set only for a sheet opened from this page; the page sheet = the design overlay + 9% edge, no set chips; closers registered', () => {
  assert.match(slice('fhSheetRender'), /_fhSheetToneNow = \(slot !== 'tab' && _fh && _fh\.m && _fh\.m\.h2hPage\) \? 'h2h'/);
  assert.match(slice('fhSheetRender'), /: \(slot !== 'tab' && _fh && _fh\.sheet && _fh\.sheet === _fhPp2Mid\) \? 'pp2' : null;/);
  assert.match(slice('fhSheetRender'), /host\.innerHTML = fhSheetSeg\(tabs\) \+ body;\n  _fhSheetToneNow = null;/, 'reset after the paint');
  const os = slice('fhOpenSheet');
  assert.match(os, /const h2hx = !!\(_fh\.m && _fh\.m\.h2hPage\);/);
  assert.match(os, /background:\$\{h2hx \? 'var\(--h2h-overlay\)' : 'var\(--backdrop\)'\};\$\{h2hx \? '' : ' backdrop-filter:blur\(3px\);'\}/, 'the design\'s overlay on this page only');
  assert.match(os, /inset:0 0 0 var\(--sf-side, 0px\); z-index:110;/, 'scrim over the content area only');
  assert.match(os, /fhSheetHeadHtml\(e, r, mid === _fhPp2Mid \|\| h2hx \? \{ noChips: true \} : undefined\)/, 'the profile and this page drop the set chips');
  assert.match(os, /host\.classList\.toggle\('h2hx', !!\(_fh\.m && _fh\.m\.h2hPage\)\);/, 'the host class scopes the design CSS (#fhSheet.h2hx)');
  assert.match(html, /pm: \{ h2hPage: true, p1: a\.short, p2: b\.short, p1Key: a\.key, p2Key: b\.key \}/, 'the page\'s pseudo match carries the flag');
  assert.match(html, /\(window\.sfOverlayClosers = window\.sfOverlayClosers \|\| \[\]\)\.push\(\(\) => \{ if \(typeof _fh !== 'undefined' && _fh && _fh\.m && _fh\.m\.h2hPage && _fh\.sheet\) fhCloseSheet\(\); \}\);/);
  const css = readFileSync(process.env.TEN402_CSS || join(HERE, 'h2h-page.css'), 'utf8');
  assert.match(css, /#h2hRoot, #fhSheet\.h2hx, \.h2hx-pop \{[^}]*--card: var\(--h2h-card\);/, 'the page tokens reach the sheet only through #fhSheet.h2hx');
  assert.doesNotMatch(css, /(^|[\s,}])#fhSheet(?!\.h2hx)[\s{.:]/m, 'no unscoped #fhSheet rule');
});

// The H2H-only branch of the shared sheet must leave Match analysis byte-identical. The outputs below were computed from
// origin/main BEFORE the rebuild (bsp-consult-dashboard.html at 7bd4e930c = the merge base 40b31f1f8, unchanged) on the
// same inputs: tone null (Match analysis, Match Stats tab) and 'pp2' (the profile) — sha256 prefix : length.
const MA_FROZEN = { 'row|null': '2d6497f50f495bb1:6423', 'seg|null': 'baad2201a13f5e45:2880', 'dr|null': '40f154e2dddb0589:717',
  'row|pp2': '6d0ff9a59d0c66c6:6424', 'seg|pp2': 'baad2201a13f5e45:2880', 'dr|pp2': '40f154e2dddb0589:717', head: '7ea58da2eeb468c1:13766', frame: '1db5b3ce03ec62eb:1494' };
function maOutputs(src) {
  const sl = name => { const start = src.indexOf(`function ${name}(`); assert.ok(start > 0, name); let d = 0, i = src.indexOf('{', start); for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) break; } return src.slice(start, i + 1); };
  const cst = name => { const a = src.indexOf(`\nconst ${name} = `) + 1; assert.ok(a > 0, name); let d = 0, i = a; for (; i < src.length; i++) { const c = src[i]; if ('{[('.includes(c)) d++; else if ('}])'.includes(c)) d--; else if (c === ';' && d === 0) break; } return src.slice(a, i + 1); };
  const env = new Function('tone', '_fh', `
    const FH_MONO = "font-family:'IBM Plex Mono',monospace;", MA_GREY = 'var(--text-label)', FH_DASH = 'var(--text-label)', FH_DASHC = '—', FH_BAR_CAP = 90;
    const fhEsc = s => String(s == null ? '' : s), escapeHtml = s => String(s == null ? '' : s);
    function fhSheetTone(){ return tone; } function fhSurname(n){ return String(n || '').split(/\\s+/).pop(); } function aAvatarHtml(n){ return '<i>' + n + '</i>'; }
    ${cst('FH_BOOK')}${cst('FH_SRC')}${cst('FH_B365_HOVER')}${cst('FH_B365_APPROX_HOVER')}
    ${/\nconst MATCH_STAT_ORDER = \[[\s\S]*?\n\];/.exec(src)[0]}
    ${cst('MA_SEG')}
    ${['fhLowerIsBetter', 'fhStatBarWidth', 'fhSheetBetter', 'fhSheetRowHtml', 'fhDDMM', 'fhB365Approx', 'fhPxMark', 'fhSrcTitle', 'fhB365Tag', 'fhB365Meta', 'fhSheetHeadHtml', 'maSeg'].map(sl).join('\n')}
    const fhSheetSectionHead = t => '<h4>' + t + '</h4>', maSheetNaNote = () => '', maSheetGateNote = () => '';
    function fhSheetModel(){ return { dr: [{ txt: '1.15', title: 'a' }, { txt: '0.87', title: 'b' }], sections: [], partial: false, gated: false }; }
    ${sl('fhSheetStatsHtml')}
    return { fhSheetRowHtml, fhSheetHeadHtml, maSeg, fhSheetStatsHtml };`);
  const stats = [{ label: 'Serve rating', kind: 'rating', k: 400, a: cell(296), b: cell(266) }, { label: 'Double faults', kind: 'count', k: 15, a: cell(5), b: cell(2) },
    { label: 'Aces', kind: 'count', k: 30, a: cell(null, '—'), b: cell(4) }, { label: '1st serve in', kind: 'pct', a: cell(62.5, '62.5%'), b: cell(58, '58.0%') },
    { label: 'Dominance ratio', kind: 'ratio', a: cell(1.15, '1.15'), b: cell(0.87, '0.87') }];
  const r = { tourn: 'Monte Carlo', surface: 'Clay', round: 'F', date: '2026-04-12', won: false, pS: 0, oS: 2, sets: [[6, 7], [3, 6]], price: 2.0, oppPrice: 1.8, book: 'B', src: 'td' };
  const e = { aName: 'C. Alcaraz', bName: 'J. Sinner', aKey: 1, bKey: 2 };
  const items = [{ label: 'Match', on: true, onclick: 'x()' }, { label: 'Set 1', onclick: 'y()' }, { label: 'Set 2', disabled: true, title: 'No per-set stats' }];
  const out = {};
  for (const tone of [null, 'pp2']) {
    const M = env(tone, { m: { p1: 'A' } });
    out['row|' + tone] = stats.map(M.fhSheetRowHtml).join('\n');
    out['seg|' + tone] = M.maSeg('sheet', items, { center: true }) + M.maSeg('pbp', items) + M.maSeg('readme', items);
    out['dr|' + tone] = M.fhSheetStatsHtml({ own: {}, opp: {} });
  }
  const M = env(null, { m: { p1: 'A' } });
  out.head = M.fhSheetHeadHtml(e, r) + M.fhSheetHeadHtml(e, Object.assign({}, r, { book: 'P', won: true })) + M.fhSheetHeadHtml(e, r, { inline: true }) + M.fhSheetHeadHtml(e, r, { noChips: true });
  out.frame = new Function(`
    let _fh = null, _fhPp2Mid = 'pp2mid';
    const host = { innerHTML: '', parentNode: null, id: '', classList: { add() {}, toggle() {} }, remove() {} };
    const document = { getElementById: id => (id === 'fhSheet' && host.parentNode ? host : null), querySelector: () => null, createElement: () => host,
      body: { appendChild: h => { h.parentNode = document.body; } } };
    function fhEnsureStyles() {} function fhMarkRow() {} function fhSheetInit() {}
    function fhSheetHeadHtml(e, r, o) { return '[head ' + JSON.stringify(o || null) + ']'; }
    ${sl('fhOpenSheet')}
    _fh = { m: { p1: 'A', p2: 'B' }, sheetMap: { x: { r: {}, aName: 'A', bName: 'B' }, pp2mid: { r: {}, aName: 'A', bName: 'B' } } };
    fhOpenSheet('x'); const a = host.innerHTML; fhOpenSheet('pp2mid'); return a + host.innerHTML;`)();
  return out;
}
const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 16) + ':' + s.length;
test('rule 4: Match analysis is unchanged by the H2H sheet branch — with the tone null (and the profile\'s pp2), the rows, the sheet head, maSeg(\'sheet\' | \'pbp\'), the Dominance card and the frame equal origin/main\'s', () => {
  const got = Object.fromEntries(Object.entries(maOutputs(html)).map(([k, v]) => [k, sha(v)]));
  assert.deepEqual(got, MA_FROZEN);
  // control: the same generator sees the H2H branch — with the tone on 'h2h' the rows differ from the frozen ones
  const h2hRows = new Function('fhSheetTone', `${LOWER_SRC}; const FH_MONO = '', MA_GREY = '', FH_DASH = '', FH_BAR_CAP = 90; const fhEsc = s => String(s); ${slice('fhStatBarWidth')}; ${slice('fhSheetBetter')}; ${slice('fhSheetRowHtml')}; return fhSheetRowHtml;`)(() => 'h2h');
  assert.notEqual(h2hRows({ label: 'Aces', kind: 'count', k: 30, a: cell(9), b: cell(3) }), new Function('fhSheetTone', `${LOWER_SRC}; const FH_MONO = '', MA_GREY = '', FH_DASH = '', FH_BAR_CAP = 90; const fhEsc = s => String(s); ${slice('fhStatBarWidth')}; ${slice('fhSheetBetter')}; ${slice('fhSheetRowHtml')}; return fhSheetRowHtml;`)(() => null)({ label: 'Aces', kind: 'count', k: 30, a: cell(9), b: cell(3) }));
});

// Review 2 item 2: the Player Profile's hand-off (window.pp2OpenMatchSheet) never reuses the Head to Head page's sheet
// state — its pseudo match carries h2hPage (the page's overlay and colours). Runs the REAL opener and the REAL fhStateFor /
// fhOpenSheet / fhCloseSheet with the DOM and the body painter stubbed; the tone is computed with fhSheetRender's own line.
test('review 2 item 2: an H2H sheet opened and closed, then a profile recent-form chip → the profile sheet has no H2H tone', () => {
  const at = html.indexOf('window.pp2OpenMatchSheet = function(x){');
  let d = 0, i = html.indexOf('{', at); for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; }
  const opener = html.slice(at, i + 1);
  const toneLine = /_fhSheetToneNow = (\([^\n]*?\)) \? 'h2h'/.exec(slice('fhSheetRender'))[1];
  const run = new Function(`
    let _fh = null, _fhSheetToneNow = null, painted = null, _fhPp2Mid = null;
    const host = { innerHTML: '', parentNode: null, classList: { add() {}, toggle() {} }, isConnected: true, remove() {} };
    const document = { getElementById: id => (id === 'fhSheet' && host.parentNode ? host : null), querySelector: () => null,
      createElement: () => host, body: { appendChild: h => { h.parentNode = document.body; } }, querySelectorAll: () => [] };
    const window = {}; function MutationObserver() { return { observe() {}, disconnect() {} }; }
    function fhEnsureStyles() {} function fhSheetHeadHtml() { return ''; } function fhMarkRow() {} function fhSafeId(x) { return x; }
    function fhRowFromForm(row) { return { won: true }; } function fhSurfName(x) { return x; }
    function fhSheetInit(e, r, slot) { _fhSheetToneNow = ${toneLine} ? 'h2h' : null; painted = { tone: _fhSheetToneNow, frame: host.innerHTML }; }
    ${slice('fhStateFor')}
    ${slice('fhOpenSheet')}
    ${slice('fhCloseSheet')}
    ${opener}
    return { h2h(pm) { fhStateFor(pm).sheetMap.m1 = { r: {}, aName: 'J. Sinner', bName: 'C. Alcaraz' }; fhOpenSheet('m1'); return painted; },
      close: fhCloseSheet, profile() { window.pp2OpenMatchSheet({ row: { opponentKey: 1905 }, subjectKey: '1980', subjectName: 'A. Zverev', oppName: 'N. Djokovic', id: 'x1', scored: true }); return painted; },
      modal(m) { fhStateFor(m); } };`);
  const P = run(), pm = { h2hPage: true, p1: 'J. Sinner', p2: 'C. Alcaraz' };
  const h = P.h2h(pm);
  assert.equal(h.tone, 'h2h', 'control: the H2H page\'s own sheet takes its tone');
  assert.match(h.frame, /background:var\(--h2h-overlay\)/);
  P.close();
  const p = P.profile();
  assert.equal(p.tone, null, 'the profile sheet: no H2H colours');
  assert.doesNotMatch(p.frame, /--h2h-overlay|--h2h-white/);
  const P2 = run(); P2.modal({ p1: 'A', p2: 'B' }); assert.equal(P2.profile().tone, null);
  assert.match(html, /const st = _fh && !\(_fh\.m && _fh\.m\.h2hPage\) \? _fh : fhStateFor\(\{ pp2: true, key: x\.subjectKey \}\);/);
});

// ---------------------------------------------------------------- the Head to head record card + the meetings box, executed
// tools/h2h-test-harness.js runs the shipped module; the meetings come through the REAL h2hPairFor → H2HCore.joinMeetings
// → fhRowFromForm → h2hPriceJoin path from two career-history shards (stubbed loaders), so the card draws real rows.
const HX = createRequire(import.meta.url)(join(HERE, 'tools/h2h-test-harness.js'));
const text = h => String(h).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const PA = { key: '1', short: 'J. Sinner', full: 'J. Sinner', mono: 'JS' }, PB = { key: '2', short: 'C. Alcaraz', full: 'C. Alcaraz', mono: 'CA' };
async function pairPage(meetings, o) {
  const opt = o || {};
  const ch = { 1: [], 2: [] };
  meetings.forEach((m, i) => {
    const sets = m.sets.map(s => ({ p: s[0], o: s[1] }));
    const pS = m.sets.filter(s => s[0] > s[1]).length, oS = m.sets.length - pS;
    const base = { date: m.date, tournament: m.t || 'Basel', round: m.round || 'F', level: 'atp', eventKey: 100 + i, surface: m.surface || 'hard' };
    const res = m.ret ? (m.won ? '1 - 0 ret.' : '0 - 1 ret.') : pS + ' - ' + oS;
    ch[1].push(Object.assign({}, base, { opponent: PB.short, oppKey: 2, won: m.won, sets, result: res, retired: !!m.ret }));
    ch[2].push(Object.assign({}, base, { opponent: PA.short, oppKey: 1, won: !m.won, sets: sets.map(s => ({ p: s.o, o: s.p })), result: m.ret ? (m.won ? '0 - 1 ret.' : '1 - 0 ret.') : oS + ' - ' + pS, retired: !!m.ret }));
  });
  const sheets = [];
  const h = HX.load({ html, globals: Object.assign({ loadCareerHistory: k => Promise.resolve(ch[k]), careerHistoryAnswered: () => true, fhLoadCloses: () => Promise.resolve(null),
    sfH2hNkCount: () => ({}), careerHistoryIdOf: () => null, _sfDbJoinSt: 'ready', _sfDbJoin: opt.db || { rows: [], names: [], meta: { rounds: [] } },
    loadSetStatsIndex: () => Promise.resolve(opt.statsIx || new Set()), loadSetStatsShard: ek => Promise.resolve((opt.shards || {})[ek] || null),
    matchStatsFromShard: (sh) => sh, fhStateFor: () => ({ sheetMap: {} }), fhOpenSheet: mid => sheets.push(mid) }, opt.globals || {}) });
  h.call(h.h2hPairFor, PA, PB);
  await new Promise(r => setTimeout(r, 5));
  h.call(h.h2hPairFor, PA, PB);   // the loads answered: the rows are built (joined, oriented, priced)
  if (opt.price) h.X.__eval('_h2hPairs')['1|2'].rows.forEach(opt.price);
  h.sheets = sheets;
  h.view = () => ({ a: PA, b: PB, h2h: h.call(h.h2hViewFor, PA, PB) });
  return h;
}
const runH = (h, hid) => h.X.handlers()[+hid]();
const hidOf = (htmlText, marker) => { const i = htmlText.indexOf(marker); const t = htmlText.lastIndexOf('<', i); return /data-hid="(\d+)"/.exec(htmlText.slice(t, htmlText.indexOf('>', i)))[1]; };
const M3 = [{ date: '2023-10-25', won: true, sets: [[6, 4], [6, 3]] }, { date: '2024-10-25', won: false, sets: [[4, 6], [7, 6], [3, 6]] }, { date: '2025-10-25', won: true, sets: [[7, 6], [6, 7], [6, 4]] }];

test('the Head to head record (DF §3): the design card, the overall score 42 mono 800, player one blue / player two white, surface tabs with counts (a surface with none is dead)', async () => {
  const h = await pairPage(M3);
  const c = h.call(h.h2hCard, h.view());
  assert.ok(c.startsWith('<div id="h2h-rec" class="x-sec" style="background:var(--h2h-card); border:1.25px solid color-mix(in srgb, var(--h2h-white) 6%, transparent); border-radius:14px; padding:24px 26px;'));
  assert.match(c, /<span style="font-family:'IBM Plex Mono',monospace; font-size:42px; font-weight:800; line-height:1; white-space:nowrap; color:var\(--h2h-text\);">2<span style="color:var\(--h2h-grey\);"> – <\/span>1<\/span>/);
  assert.match(text(c), /J\. Sinner 2 wins Overall 2 – 1 3 meetings C\. Alcaraz 1 win/);
  const rings = [...c.matchAll(/class="x-av"[^>]*box-shadow:0 0 0 2px ([^;]+);/g)].map(m => m[1]);
  assert.deepEqual(rings, [H2H_A, H2H_B], 'A ring blue, B ring white');
  // one dot per meeting, oldest → newest: A's wins blue, B's white; the run sentence
  const dots = [...c.matchAll(/<span title="[^"]* won" style="width:10px; height:10px; border-radius:50%; background:([^;]+);"><\/span>/g)].map(m => m[1]);
  assert.deepEqual(dots, [H2H_A, H2H_B, H2H_A]);
  assert.match(text(c), /Sinner won the last meeting All 3 meetings ›/);
  assert.ok(!/h2hTug|--viz-white-lead|--white-bar/.test(c), 'no white tug bar: the record bar is gone with the rebuild');
  // the surface tabs: counts from the meetings, a surface with no meeting drawn dead (no handler)
  assert.match(text(c), /All 3 Hard 3 Clay 0 Grass 0/);
  assert.match(c, /<span class="" style="display:flex; align-items:baseline; gap:6px; padding:5px 11px; border-radius:8px; font-size:12\.5px; font-weight:600; color:var\(--h2h-dead\);[^>]*><span>Clay<\/span>/);
  assert.match(c, /<span class="seg" data-hid="\d+" style="[^"]*font-weight:700; color:var\(--h2h-text\); background:var\(--h2h-raised\); border:1px solid color-mix\(in srgb, var\(--h2h-white\) 16%, transparent\);[^"]*"><span>All<\/span>/);
  // a scope: "On hard" and only its meetings
  h.state.h2hSurf = 'Hard';
  assert.match(text(h.call(h.h2hCard, h.view())), /Overall|On hard/);
  assert.match(text(h.call(h.h2hCard, h.view())), /On hard 2 – 1 3 meetings/);
});

test('TEN-437 (5): a history that did not load is "could not load" + Retry (H2HPage._h2hRetry), never "never met"; no meetings at all = the design\'s sentence', async () => {
  const h = await pairPage([]);
  const f = text(h.call(h.h2hCard, { a: PA, b: PB, h2h: { failed: true, names: ['C. Alcaraz'] } }));
  assert.match(f, /^Head to head record Meetings between the two players Head to head could not load: the match history for C\. Alcaraz did not load\. Retry$/);
  assert.match(h.call(h.h2hCard, { a: PA, b: PB, h2h: { failed: true, names: [] } }), /<span class="seg" onclick="H2HPage\._h2hRetry\(\)"[^>]*>Retry<\/span>/);
  assert.match(text(h.call(h.h2hCard, h.view())), /These two have never met on record\./);
  assert.match(text(h.call(h.h2hCard, { a: PA, b: PB, h2h: { loading: true } })), /Loading head to head…/);
});

// Founder ruling 3 (2026-11-16, "follow the design"): the Hot lines are ranked once the scope has H2H_HOT_MIN_MEETINGS = 3
// meetings (fewer → "Not enough meetings to rank lines (n=…)"); a line shows with H2H_HOT_MIN_LINE = 1 eligible meeting;
// H2H_HOT_MIN_RATE = null (no rate floor); the Rate keeps the thin rule (maGate: under 5 no %, 5–9 grey).
const hotRows = c => [...c.matchAll(/<div class="seg x-hl" data-hid="\d+" style="display:grid; grid-template-columns:([^;]+);[\s\S]*?(?=<div class="seg x-hl"|<\/div>\s*<div style="display:flex; align-items:center; justify-content:space-between)/g)].map(m => ({ cols: m[1], html: m[0], text: text(m[0]) }));
test('founder ruling 3: Hot lines ranked from 3 meetings (H2H_HOT_MIN_MEETINGS), a line from 1 eligible meeting, no rate floor; under 3 → "Not enough meetings to rank lines (n=2)"', async () => {
  const h = await pairPage(M3);
  assert.equal(h.consts.H2H_HOT_MIN_MEETINGS, 3); assert.equal(h.consts.H2H_HOT_MIN_LINE, 1); assert.equal(h.consts.H2H_HOT_MIN_RATE, null);
  const c = h.call(h.h2hCard, h.view());
  const rows = hotRows(c);
  // the shared scorer at the design's line floor (1 eligible meeting): one row per family that has a line
  const defs = h.call(() => h.run('fhH2hLineDefs'))('Sinner', 'Alcaraz'), F = h.view().h2h.F;
  const sc = h.call(() => h.run('fhScoreLines'))(F, defs, { min: 1 }).scored, famOf = h.call(() => h.run('fhFamOf'));
  const famsWant = h.call(() => h.run('FH_HOT_FAM')).filter(f => sc.some(x => famOf(x.L.g) === f[0])).map(f => f[1]);
  assert.ok(famsWant.length >= 2, 'the fixture has lines in two families or more');
  assert.equal(rows.length, famsWant.length, 'the best line of each family at n = 3');
  rows.forEach(r => assert.equal(r.cols, 'minmax(150px,0.8fr) 56px 72px minmax(234px,1.6fr) 10px', 'the design\'s hot-line grid'));
  const top = rows.filter(r => /Most covered/.test(r.text));
  assert.equal(top.length, 1, 'one line is marked "Most covered"');
  assert.ok(top[0].text.includes(sc.slice().sort(h.call(() => h.run('fhHotLineRank')))[0].name), 'the ranked first line');
  assert.match(top[0].html, /background:var\(--h2h-raised\); box-shadow:inset 0 0 0 1px color-mix\(in srgb, var\(--h2h-white\) 16%, transparent\);/);
  const fam = [...c.matchAll(/<span style="font-family:'Hanken Grotesk',sans-serif; font-size:10\.5px; font-weight:700; letter-spacing:0\.10em; text-transform:uppercase; color:var\(--h2h-grey\);">([^<]+)<\/span><span style="font-size:13\.5px; font-weight:700;">/g)].map(m => m[1].replace('&amp;', '&'));
  assert.deepEqual(fam, Array.from(famsWant));
  const N = +/Show all lines \((\d+)\)/.exec(c)[1];
  const elig = defs.filter(L => F.filter(r => h.call(() => h.run('fhEligible'))(r, L)).length >= 1).length;
  assert.ok(elig > rows.length, 'more lines than families: the toggle has something to show');
  assert.equal(N, elig, '"Show all lines (N)" counts every line with one eligible meeting (H2H_HOT_MIN_LINE = 1)');
  // two meetings: one sentence, no ranking
  const h2 = await pairPage(M3.slice(0, 2));
  const c2 = h2.call(h2.h2hCard, h2.view());
  assert.match(text(c2), /Not enough meetings to rank lines \(n=2\)/);
  assert.equal(hotRows(c2).length, 0);
  // the scope decides: three meetings on hard, one on clay → the clay scope is under 3
  const h3 = await pairPage(M3.concat([{ date: '2026-05-10', won: true, sets: [[6, 2], [6, 2]], surface: 'clay', t: 'Rome' }]));
  h3.state.h2hSurf = 'Clay';
  assert.match(text(h3.call(h3.h2hCard, h3.view())), /Not enough meetings to rank lines \(n=1\)/);
});
test('founder ruling 3: the Rate keeps the thin rule — under 5 eligible "—" (the count in the hover), 5–9 grey "small sample", 10+ white; every row, all lines', async () => {
  const mk = n => Array.from({ length: n }, (_, i) => ({ date: `20${10 + i}-10-25`, won: i % 3 !== 0, sets: i % 2 ? [[6, 4], [6, 4]] : [[4, 6], [6, 3], [6, 2]] }));
  const seen = new Set();
  for (const n of [4, 7, 12]) {
    const h = await pairPage(mk(n)); h.state.h2hAllLines = true;
    for (const r of hotRows(h.call(h.h2hCard, h.view()))) {
      const [, c, e] = /(\d+) of (\d+)/.exec(r.text).map(Number);
      const cellm = /<span title="([^"]*)" style="font-family:'IBM Plex Mono',monospace; font-size:15px; font-weight:700; color:([^;]+);">([^<]*)<\/span>/.exec(r.html);
      assert.ok(cellm, 'rate cell');
      const [, title, col, val] = cellm;
      if (e < 5) { assert.deepEqual([val, col, title], ['—', 'var(--h2h-grey)', e + ' eligible: too few for a rate']); seen.add('lt5'); }
      else if (e < 10) { assert.deepEqual([val, col, title], [Math.round(c / e * 100) + '%', 'var(--h2h-grey)', 'Small sample · n=' + e]); seen.add('5-9'); }
      else { assert.deepEqual([val, col, title], [Math.round(c / e * 100) + '%', H2H_B, c + ' of ' + e + ' eligible']); seen.add('10+'); }
    }
  }
  assert.deepEqual([...seen].sort(), ['10+', '5-9', 'lt5'], 'all three tiers exercised');
});
test('a hot line opens its meetings (newest first) with Covered / Last five / average tiles; a meeting row opens THE match sheet; ✕ closes', async () => {
  const h = await pairPage(M3);
  const c = h.call(h.h2hCard, h.view());
  runH(h, /data-hid="(\d+)"/.exec(hotRows(c)[0].html)[1]);
  const open = h.call(h.h2hCard, h.view());
  // founder 2026-11-17: under the rate floor (3 meetings) the Covered tile prints the count as its figure and names the
  // meetings it covered — Sinner −1.5 sets covered only the 2023 Swiss Indoors final
  assert.match(text(open), /Covered 1 of 3 At Swiss Indoors 2023 Last five 1 of 3 most recent meetings Average/);
  const det = [...open.matchAll(/<div class="seg x-row" data-hid="(\d+)" title="Open the match statistics" style="display:grid; grid-template-columns:62px minmax\(0,1\.3fr\) minmax\(0,1fr\) 96px 84px 8px;[^>]*>([\s\S]*?)<\/div>/g)];
  assert.ok(det.length >= 1);
  assert.match(text(det[0][2]), /^25\.10\.25 /, 'newest first');
  runH(h, det[0][1]);
  assert.equal(h.sheets.length, 1, 'the row opened the shared sheet (fhOpenSheet)');
  assert.equal(h.sheets[0], h.view().h2h.F[2].mid);
  runH(h, hidOf(open, 'class="seg x-close"'));
  assert.equal(h.state.hotOpen, null);
});

// ---------------------------------------------------------------- the meetings box (the Overall box opens it)
const boxRows = c => [...c.matchAll(/<div class="row seg x-row" data-hid="(\d+)" data-fh-mid="([^"]+)" style="display:grid; grid-template-columns:([^;]+);[^>]*>([\s\S]*?)<\/div>/g)].map(m => ({ hid: m[1], mid: m[2], cols: m[3], html: m[4], text: text(m[4]) }));
test('the meetings box: the design grid, newest first by year ("2025 1–0 · 1 meeting"), Sets "pS–oS", a retirement "—" + "5–0 ret.", scores never cut, a row opens THE sheet', async () => {
  const ms = M3.concat([{ date: '2025-08-07', won: true, sets: [[5, 0]], ret: true, t: 'Cincinnati' }]);
  const h = await pairPage(ms);
  const c0 = h.call(h.h2hCard, h.view());
  runH(h, hidOf(c0, 'class="seg x-ovbox"'));
  assert.equal(h.state.h2hBox, true, 'the Overall box opens the meetings');
  const box = h.call(h.h2hBoxHTML, h.view());
  const rows = boxRows(box);
  assert.equal(rows.length, 4);
  rows.forEach(r => assert.equal(r.cols, '48px 12px minmax(0,1.4fr) 36px 40px minmax(0,1.3fr) 46px 46px', 'the design meetings grid'));
  assert.deepEqual(rows.map(r => r.text.slice(0, 9)), ['25.10. Sw', '07.08. Ci', '25.10. Sw', '25.10. Sw'], 'newest first (2025-10, 2025-08, 2024, 2023)');
  assert.match(text(box), /2025 2–0 · 2 meetings/);
  assert.match(text(box), /2024 0–1 · 1 meeting/);
  const ret = rows.find(r => /ret\./.test(r.text));
  assert.match(ret.text, /^07\.08\. Cincinnati Open Hard F — 5–0 ret\. /, 'a retirement: sets "—", the score en-dashed with "ret."');
  assert.match(rows[0].text, / 2–1 7-6, 6-7, 6-4 /, 'Sets "pS–oS" (en dash, no spaces); set scores in the site\'s "7-6" form');
  assert.match(rows[3].text, /^25\.10\. Swiss Indoors Hard F 2–0 /, 'the 2023 win, under the event\'s one name');
  rows.forEach(r => { const s = /<span style="font-family:'IBM Plex Mono',monospace; font-size:11px; color:var\(--h2h-grey\);([^"]*)">[^<]*<\/span>\s*<span title=/.exec(r.html); assert.ok(s, 'score cell'); assert.match(s[1], /white-space:normal;/); assert.doesNotMatch(s[1], /ellipsis|nowrap|overflow:hidden/); });
  // the result square: A's win --h2h-up, a loss --h2h-down (from A's side)
  assert.match(rows[2].html, /border-radius:2px; background:var\(--h2h-down\);/, 'the 2024 loss');
  assert.match(rows[0].html, /border-radius:2px; background:var\(--h2h-up\);/);
  // a row opens the shared sheet and stays selected (raised + 16% ring) while the box is open
  runH(h, rows[2].hid);
  assert.deepEqual(h.sheets, [rows[2].mid]);
  assert.match(h.call(h.h2hBoxHTML, h.view()), new RegExp(`data-fh-mid="${rows[2].mid}" style="[^"]*background:var\\(--h2h-raised\\); box-shadow:inset 0 0 0 1px color-mix\\(in srgb, var\\(--h2h-white\\) 16%, transparent\\);`));
  // the price columns' heads are the two players' mini avatars (CHANGES 2026-11-17 §2: 22px, class "mini", no ring)
  const minis = [...box.matchAll(/<span title="([^"]+)'s closing price"[^>]*><span class="x-av mini"\s*style="([^"]*)"/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(minis.map(m => m[0]), ['J. Sinner', 'C. Alcaraz']);
  minis.forEach(m => { assert.match(m[1], /width:22px; height:22px;/); assert.doesNotMatch(m[1], /box-shadow/, 'no ring on a mini avatar'); });
  assert.match(text(box), /Meetings 4 on record · Sinner leads 3–1/, 'the record in the sentence: en dash');
});
test('TEN-437 item 4: a Bet365-priced meeting keeps its "B" marker and the hover "Bet365 closing odds, Pinnacle not available"; a Pinnacle meeting carries none', async () => {
  const h = await pairPage(M3, { price: (r, i) => Object.assign(r, i === 0 ? { price: 1.5, oppPrice: 2.7, book: 'B', src: 'td' } : i === 1 ? { price: 1.9, oppPrice: 1.95, book: 'P', src: 'td' } : { price: null, oppPrice: null, book: null }) });
  h.state.h2hBox = true;
  const rows = boxRows(h.call(h.h2hBoxHTML, h.view()));
  const b = rows.find(r => r.text.startsWith('25.10.') && /1\.50/.test(r.text)), p = rows.find(r => /1\.90/.test(r.text)), d = rows[0];
  assert.match(b.html, /<span title="Bet365 closing odds, Pinnacle not available" style="[^"]*">1\.50<sup style="font-size:8px; color:var\(--h2h-grey\);">B<\/sup><\/span>/);
  assert.match(b.html, /title="Bet365 closing odds, Pinnacle not available"[^>]*>2\.70</, 'the opponent\'s price carries the same hover');
  assert.doesNotMatch(p.html, /<sup/, 'a Pinnacle close: no marker');
  assert.match(p.html, /title="Pinnacle closing price · Database join \(Tennis-Data\)"/);
  assert.match(d.text, / — —$/, 'no price: dashes');
  assert.match(d.html, /title="No Pinnacle or Bet365 closing price for this meeting in the Database"/);
});
test('the meetings box tiles: Total points won from the box scores over k of n meetings; On <surface>; Went to a deciding set; Favourite won with exact ties counted out', async () => {
  const shard = (a, b) => ({ own: { raw: { 'Points:Total Points Won': { won: a, total: a + b } } }, opp: { raw: { 'Points:Total Points Won': { won: b, total: a + b } } } });
  const h = await pairPage(M3, { statsIx: new Set(['100', '101']), shards: { 100: shard(60, 40), 101: shard(55, 65) },
    price: (r, i) => Object.assign(r, i === 0 ? { price: 1.4, oppPrice: 3.0, book: 'P' } : i === 1 ? { price: 1.9, oppPrice: 1.9, book: 'P' } : { price: 2.2, oppPrice: 1.7, book: 'P' }) });
  h.state.h2hBox = true;
  assert.match(text(h.call(h.h2hBoxHTML, h.view())), /Total points won Loading the box scores…/, 'never a guess while the box scores load');
  await new Promise(r => setTimeout(r, 5));
  const t = text(h.call(h.h2hBoxHTML, h.view()));
  assert.match(t, /Total points won 52\.3% Sinner · Alcaraz 47\.7% · 2 of 3 meetings/, '115 of 220 points from the two box scores on file; the third meeting has none');
  assert.match(t, /On hard 2–1 Clay 0–0 · Grass 0–0/);
  assert.match(t, /Went to a deciding set 2 of 3 Sinner won 1 · Alcaraz won 1/);
  assert.match(t, /Favourite won 1 of 2 Sinner beat Alcaraz as the underdog · Swiss Indoors 2025 · 1 level-priced, not counted/, 'an exact tie is no favourite; the one underdog win is named (founder 2026-11-17)');
  // no box score at all → a dash and the reason, never estimated from games
  const h0 = await pairPage(M3); h0.state.h2hBox = true; h0.call(h0.h2hBoxHTML, h0.view()); await new Promise(r => setTimeout(r, 5));
  assert.match(text(h0.call(h0.h2hBoxHTML, h0.view())), /Total points won — No box score on record for these meetings/);
});

// Fix 2 · Data 2: ONE price join for the page — b = null prices each row against its own opponent.
test('Data 2 (fix 2): the page\'s one join prices a ledger of many opponents (b = null): own opponent, own date window, own round', () => {
  const db = { meta: { rounds: ['The Final', 'Semifinals', '2nd Round'] }, names: [], rows: [] };
  const add = (d, w, l, rnd, fav, dog, favWon, book) => { db.rows.push([d, 0, 0, rnd, 0, fav, dog, favWon, book]); db.names.push([w, l]); };
  add(20250818, 'Alcaraz C.', 'Sinner J.', 0, 1.53, 2.71, 0, 0);    // Cincinnati F (a neighbouring event: never the US Open's price)
  add(20250907, 'Alcaraz C.', 'Sinner J.', 0, 1.81, 2.12, 0, 0);    // US Open F: Sinner the favourite at 1.81, lost
  add(20250905, 'Sinner J.', 'Auger-Aliassime F.', 1, 1.10, 7.50, 1, 1);   // US Open SF, Bet365
  add(20250903, 'Sinner J.', 'Musetti L.', 1, 1.05, 11.0, 1, 0);   // a Database row named a semi-final
  const S = { full: 'J. Sinner' };
  // the style-meetings shard: an edition-start date, full first names, the feed's round words → codes
  const rows = [{ date: '2025-08-24', won: false, round: 'F', opp: 'Carlos Alcaraz' },
    { date: '2025-08-24', won: true, round: 'SF', opp: 'Felix Auger-Aliassime' },
    { date: '2025-08-24', won: true, round: 'QF', opp: 'Lorenzo Musetti' },
    { date: '2025-08-24', won: true, round: 'R16', opp: 'Alexander Bublik' }];
  assert.equal(priceJoin(rows, S, null, db), 2);
  assert.deepEqual([rows[0].price, rows[0].oppPrice, rows[0].book], [1.81, 2.12, 'P'], 'the US Open final 14 days after the edition start, not Cincinnati\'s 1.53 / 2.71');
  assert.deepEqual([rows[1].price, rows[1].oppPrice, rows[1].book], [1.10, 7.50, 'B'], 'its own opponent: Auger-Aliassime (hyphen), Bet365');
  assert.equal(rows[2].price ?? null, null, 'a quarter-final never takes a row the Database calls a semi-final');
  assert.equal(rows[3].price ?? null, null, 'no Database row v Bublik → a dash');
  // oppOf names the opponent when the row keeps it elsewhere
  const r2 = [{ date: '2025-09-07', won: false, round: 'F', opponent: 'Carlos Alcaraz' }];
  priceJoin(r2, S, null, db, r => r.opponent);
  assert.equal(r2[0].price, 1.81);
});
test('Data 2 (fix 2): a full-name opponent joins the archive\'s "Surname I." form; a namesake with another initial never does', () => {
  const db = { meta: { rounds: [] }, names: [['Sinner J.', 'Zverev A.'], ['Sinner J.', 'Del Potro J.M.']], rows: [[20240310, 0, 0, 0, 0, 1.4, 3.0, 1, 0], [20190310, 0, 0, 0, 0, 1.9, 1.9, 1, 0]] };
  const one = (opp, d) => { const x = [{ date: d, won: true, round: null, opp }]; priceJoin(x, { full: 'J. Sinner' }, null, db); return x[0].price ?? null; };
  assert.equal(one('Alexander Zverev', '2024-03-10'), 1.4);
  assert.equal(one('Mischa Zverev', '2024-03-10'), null, 'M. ≠ A.: another player');
  assert.equal(one('A. Zverev', '2024-03-10'), 1.4, 'the initial form still joins');
  assert.equal(one('Juan Martin Del Potro', '2019-03-10'), 1.9, 'a two-word given name: the archive surname is a tail of ours');
});

// ---------------------------------------------------------------- review 2 (TEN-402 lead, 2026-10-08): the join
// The REAL Database rows (database-yield.json) against synthetic career-history fixtures shaped like the deployed shards
// (career-history/{key}.json is deployed, not committed): each case is a meeting the review found priced from a
// neighbouring match. Each test carries the control that goes red when the career (the fix) is taken away.
const REAL = dbPriceJoinRows(...readStore());   // the page's join rows (Database rows + flagged retirements)
const REAL_DB = dbOnly();                        // the Database rows alone (controls from before the 2026-10-08 ruling)
const ch = (date, tournament, round, opponent, won, eventKey) => ({ date, tournament, round, opponent, won, eventKey, level: 'atp' });
const px = (full, career, rows, oppOf) => { const rs = rows.map(r => Object.assign({}, r)); priceJoin(rs, { full }, null, REAL, oppOf || null, career); return rs.map(r => (r.price == null ? '—' : r.price + ' / ' + r.oppPrice)); };

test('review 2 (a): a Database row nearer ANOTHER career match never prices this one — Sinner, Monte Carlo 2023 R32 v Schwartzman (retired) never takes Barcelona 2023\'s 1.09 / 9.13', () => {
  const career = [ch('2023-04-19', 'ATP Barcelona', '1/16-finals', 'D. Schwartzman', true, 11), ch('2023-04-12', 'ATP Monte Carlo', '1/16-finals', 'D. Schwartzman', true, 12)];
  const mc = [{ date: '2023-04-12', won: true, round: 'R32', opp: 'D. Schwartzman' }];          // the Tournament ledger at Monte Carlo
  // ruling 2026-10-08: the retirement is priced at its own close (Pinnacle 1.14 / 7.54), settled on the ATP result
  assert.deepEqual(px('J. Sinner', career, mc), ['1.14 / 7.54'], 'Monte Carlo = its own (flagged) retirement row');
  assert.deepEqual(px('J. Sinner', career, [{ date: '2023-04-19', won: true, round: 'R32', opp: 'D. Schwartzman' }]), ['1.09 / 9.13'], 'Barcelona keeps its own price');
  // the nearest-first rule on the Database rows alone (Monte Carlo's row absent): a dash, never Barcelona's price
  const px0 = (career0, rows) => { const rs = rows.map(r => Object.assign({}, r)); priceJoin(rs, { full: 'J. Sinner' }, null, REAL_DB, null, career0); return rs.map(r => (r.price == null ? '—' : r.price + ' / ' + r.oppPrice)); };
  assert.deepEqual(px0(career, mc), ['—'], 'no Monte Carlo row → a dash');
  assert.deepEqual(px0(null, mc), ['1.09 / 9.13'], 'control: without the career store the row alone takes Barcelona\'s price (the defect)');
});

test('review 2 (a, b): Djokovic v Zverev — the ATP Cup 2021 row is a dash and the AO 2021 QF keeps 1.68 / 2.33, whatever the row order (d)', () => {
  const career = [ch('2021-02-08', 'Australian Open', 'QF', 'A. Zverev', true), ch('2021-02-02', 'ATP Cup', 'R128', 'A. Zverev', true)];
  const rows = [{ date: '2021-02-02', won: true, round: 'R128', opp: 'A. Zverev' }, { date: '2021-02-08', won: true, round: 'QF', opp: 'A. Zverev' }];
  assert.deepEqual(px('N. Djokovic', career, rows), ['—', '1.68 / 2.33'], 'oldest first (the Head-to-head ledger)');
  assert.deepEqual(px('N. Djokovic', career, rows.slice().reverse()), ['1.68 / 2.33', '—'], 'newest first (the Playing styles ledger): the same prices');
  // (b) the round decides even without the career store: an R128 never takes a quarter-final's row
  assert.deepEqual(px('N. Djokovic', null, rows), ['—', '1.68 / 2.33']);
  // a ledger holding only the ATP Cup row (its Tournament ledger) with no round: the career store alone keeps it a dash
  const cup = [{ date: '2021-02-02', won: true, round: null, opp: 'A. Zverev' }];
  assert.deepEqual(px('N. Djokovic', career, cup), ['—']);
  assert.deepEqual(px('N. Djokovic', null, cup), ['1.68 / 2.33'], 'control: no round, no career → the ATP Cup row takes the QF\'s price (the defect)');
});

test('review 2 (b): numbered rounds compare too — the archive\'s "Nth Round" counted back from the event\'s last numbered round', () => {
  const at = (date, t, rd) => { const i = REAL.rows.findIndex(r => r[0] === date && REAL.meta.tournaments[r[4]] === t && REAL.meta.rounds[r[3]] === rd); assert.ok(i >= 0, t + ' ' + rd); return J.h2hTdRound(REAL, i); };
  assert.equal(at(20230705, 'Wimbledon', '2nd Round'), 'R64', 'a 128 draw: 2nd Round = R64');
  assert.equal(at(20230419, 'Barcelona Open', '2nd Round'), 'R32', 'a 48 draw: 2nd Round = R32');
  assert.equal(at(20230412, 'Monte Carlo Masters', '2nd Round'), 'R32', 'a 56 draw: 2nd Round = R32');
  assert.equal(J.fhRoundCode('1/16-finals'), 'R32', 'the feed\'s 1/16-finals = R32');
});

test('review 2 (c): the career-history date, not a shard\'s edition start — Djokovic v Vacherot, Shanghai 2025 SF (shard 24.09, archive 11.10) = 1.14 / 6.68', () => {
  const career = [ch('2025-10-11', 'Shanghai', 'Semi-finals', 'V. Vacherot', false, 12160001)];
  const row = [{ date: '2025-09-24', won: false, round: 'SF', opp: 'Valentin Vacherot' }];
  assert.deepEqual(px('N. Djokovic', career, row), ['1.14 / 6.68']);
  assert.deepEqual(px('N. Djokovic', null, row), ['—'], 'control: 17 days after the shard date is outside the window without the career row');
});

test('review 2: a start-dated career row (pre-2021) joins START to START — Djokovic\'s Madrid / Rome 2011 finals v Nadal are not swapped', () => {
  const career = [ch('2011-05-01', 'Madrid Masters', 'F', 'R. Nadal', true), ch('2011-05-08', 'Rome Masters', 'F', 'R. Nadal', true),
    ch('2011-03-10', 'Indian Wells Masters', 'F', 'R. Nadal', true), ch('2011-03-21', 'Miami Masters', 'F', 'R. Nadal', true)];
  const rows = career.map(c => ({ date: c.date, won: true, round: 'F', opp: 'R. Nadal' }));
  // archive: Madrid F 08.05 1.32 / 3.78 (Djokovic the dog), Rome F 15.05 1.47 / 2.96, IW F 20.03 1.74 / 2.25, Miami F 03.04 1.88 / 2.06
  assert.deepEqual(px('N. Djokovic', career, rows), ['3.78 / 1.32', '2.96 / 1.47', '1.74 / 2.25', '2.06 / 1.88']);
  assert.deepEqual(px('N. Djokovic', null, rows).slice(0, 2), ['2.96 / 1.47', '3.78 / 1.32'], 'control: by the match date alone Madrid and Rome swap (the defect)');
});

test('review 2 (3): the archive\'s short name still joins ("Mpetshi G." = G. Mpetshi Perricard) — and never crosses brothers or namesakes', () => {
  const career = [ch('2024-07-08', 'Wimbledon', '1/8-finals', 'L. Musetti', false, 11)];
  assert.deepEqual(px('G. Mpetshi Perricard', career, [{ date: '2024-07-08', won: false, round: 'R16', opp: 'L. Musetti' }]), ['2.02 / 1.88']);
  const k = J.h2hTdKey, same = (a, b) => J.h2hTdSame(k(a), k(b));
  assert.ok(same('G. Mpetshi Perricard', 'Mpetshi G.'), 'archive shorter: the head of ours');
  assert.ok(same('R. Bautista-Agut', 'Bautista R.'), 'archive shorter, hyphenated ours');
  assert.ok(same('Juan Martin Del Potro', 'Del Potro J.M.'), 'archive shorter: the tail of ours');
  assert.ok(same('A. Ramos', 'Ramos-Vinolas A.'), 'archive longer: it starts with ours');
  assert.ok(!same('A. Martin', 'Lopez San Martin A.'), 'archive longer and only ENDS with ours: another player');
  for (const [a, b] of [['A. Zverev', 'Zverev M.'], ['M. Zverev', 'Zverev A.'], ['F. Cerundolo', 'Cerundolo J.M.'], ['J.M. Cerundolo', 'Cerundolo F.'],
    ['S. Tsitsipas', 'Tsitsipas P.'], ['P. Tsitsipas', 'Tsitsipas S.'], ['T. Barrios Vera', 'Barrios M.'], ['T. Barrios Vera', 'Barrios Vera M.T.']]) assert.ok(!same(a, b), a + ' ≠ ' + b);
  for (const [a, b] of [['A. Zverev', 'Zverev A.'], ['J.M. Cerundolo', 'Cerundolo J.M.'], ['S. Tsitsipas', 'Tsitsipas S.']]) assert.ok(same(a, b), 'control: ' + a + ' = ' + b);
  // the whole Database: Mpetshi Perricard = every row naming "Mpetshi G." or "Mpetshi Perricard G." (99 on 2026-10-08, 98
  // short; counted, not pinned — the store grows); Mischa and Alexander split Zverev's rows
  const rowsOf = full => REAL.names.filter(n => n.some(x => same(full, x))).length;
  const short = REAL.names.filter(n => n.includes('Mpetshi G.')).length;
  assert.ok(short >= 98, 'the archive\'s short form');
  assert.equal(rowsOf('G. Mpetshi Perricard'), REAL.names.filter(n => n.includes('Mpetshi G.') || n.includes('Mpetshi Perricard G.')).length);
  assert.equal(rowsOf('M. Zverev'), REAL.names.filter(n => n.includes('Zverev M.')).length);
  assert.equal(rowsOf('A. Zverev'), REAL.names.filter(n => n.includes('Zverev A.')).length);
});

// Fix 6 · RD column: a season-finals group match prints RR; a truly unknown round stays a dash.
const h2hRoundOf = new Function(`const FH_DASHC = '—';\n${slice('h2hRoundOf')}\nreturn h2hRoundOf;`)();
test('fix 6: a blank round at the season finals is the round robin ("RR"); Davis Cup / Laver Cup blanks stay "—"', () => {
  for (const t of ['ATP Finals - Turin', 'Finals - Turin', 'Next Gen Finals - Milan']) assert.equal(h2hRoundOf('—', t), 'RR', t);
  for (const t of ['ATP Davis Cup - World Group', 'Davis Cup Finals QF: ITA vs CRO', 'ATP Laver Cup', 'ATP United Cup', 'Wimbledon']) assert.equal(h2hRoundOf('—', t), '—', t);
  assert.equal(h2hRoundOf('F', 'ATP Finals - Turin'), 'F', 'a named round is never overwritten');
  assert.equal(h2hRoundOf('SF', 'ATP Finals - Turin'), 'SF');
  // wired: every meeting row passes through it before the price join (whose round test then reads RR = 'Round Robin')
  const pf = slice('h2hPairFor');
  assert.match(pf, /r\.round = h2hRoundOf\(r\.round, x\.tournament\);/);
  assert.ok(pf.indexOf('h2hRoundOf(') < pf.indexOf('h2hPriceJoin('), 'the round is set before the price join');
});

// The Match / Set scopes' Dominance ratio card on the Head to Head sheet: by player too (DF L459–463) — A's figure the
// page blue, B's white, both 700 (replaces fix 5's better-figure emphasis). Every other host keeps both white 700.
const drHtml = (tone, dr) => new Function('fhSheetModel', 'fhSheetTone', 'fhSheetBetter',
  `const FH_MONO = "font-family:'IBM Plex Mono',monospace;", FH_DASH = 'var(--text-label)', FH_DASHC = '—';
   const fhEsc = s => String(s), fhSheetSectionHead = t => t, fhSheetRowHtml = () => '', maSheetNaNote = () => '', maSheetGateNote = () => '';
   ${slice('fhSheetStatsHtml')}; return fhSheetStatsHtml;`)(
  () => ({ dr, sections: [], partial: false, gated: false }), () => tone, new Function(`${LOWER_SRC}; ${slice('fhSheetBetter')}; return fhSheetBetter;`)())({ own: {}, opp: {} });
const drFigs = h => ['a', 'b'].map(s => { const m = new RegExp(`class="fh-dr-${s}"[^>]*font-size:24px; font-weight:(\\d+); color:([^;]+);[^>]*>([^<]*)<`).exec(h); return m && [m[3], +m[1], m[2]]; });
test('the sheet\'s Match / Set Dominance ratio card on Head to Head: A --h2h-blue, B --h2h-text, both 700, whoever is better; a dash stays grey', () => {
  const d = (a, b) => [{ txt: a, title: '' }, { txt: b, title: '' }];
  assert.deepEqual(drFigs(drHtml('h2h', d('1.15', '0.87'))), [['1.15', 700, H2H_A], ['0.87', 700, H2H_B]]);
  assert.deepEqual(drFigs(drHtml('h2h', d('0.92', '1.08'))), [['0.92', 700, H2H_A], ['1.08', 700, H2H_B]], 'B better: still by player');
  assert.deepEqual(drFigs(drHtml('h2h', d('—', '1.08'))), [['—', 700, 'var(--text-label)'], ['1.08', 700, H2H_B]], 'a dash stays grey');
  // control: every other host (Match analysis, Match Stats tab, profile) keeps both figures white 700
  assert.deepEqual(drFigs(drHtml(null, d('1.15', '0.87'))).map(f => [f[1], f[2]]), [[700, 'var(--text)'], [700, 'var(--text)']]);
  assert.deepEqual(drFigs(drHtml('pp2', d('1.15', '0.87'))).map(f => [f[1], f[2]]), [[700, 'var(--text)'], [700, 'var(--text)']]);
});

test('archive name table (2026-11-07): Tennis Explorer\'s spellings of Y. Bu, E. Moller, J. Barranco Cosano, Y. H. Hsu and G. Campana Lee meet their player; control: without the table each misses', () => {
  const OP_ = createRequire(import.meta.url)(join(HERE, 'build-odds-performance.js'));
  const cases = [['Yunchaokete B.', '796', 'Y. Bu'], ['Moeller E.', '39675', 'E. Moller'], ['Barranco C.J.', '1877', 'J. Barranco Cosano'],
    ['Hsu Yu H.', '867', 'Y. H. Hsu'], ['Lee G.C.', '10845', 'G. Campana Lee']];
  for (const [n, k, our] of cases) {
    assert.equal(OP_.ARCHIVE_NAME_ALIASES[n], k, `${n} is key ${k}`);
    assert.equal(OP_.ARCHIVE_ALIAS_NAMES[k], our, `key ${k} spells ${our}`);
    // the page join, as build-database-yield.js hands the table on (archive name -> our spelling)
    const base = { meta: { rounds: ['1st Round'] }, rows: [[20230305, 0, 0, 0, 0, 1.53, 2.44, 1, 8]], retRows: [] };
    const names = [['Butvilas E.', n]];
    const db = dbPriceJoinRows(base, { names, retNames: [], aliases: { [n]: our } });
    const x = [{ date: '2023-03-05', won: false, round: null }]; priceJoin(x, { full: our }, { full: 'E. Butvilas' }, db);
    assert.deepEqual([x[0].price, x[0].oppPrice], [2.44, 1.53], `${our} meets "${n}"`);
    const ctl = dbPriceJoinRows(base, { names, retNames: [] });
    const c = [{ date: '2023-03-05', won: false, round: null }]; priceJoin(c, { full: our }, { full: 'E. Butvilas' }, ctl);
    assert.equal(c[0].price ?? null, null, `control: without the table ${our} misses "${n}"`);
  }
});

test('one match listed twice (2026-11-07): the first copy takes the price, the copy keeps its dash — never two prices, never both dashed', () => {
  // J. Thompson v J. Sock, Davis Cup 2017: the archive lists the rubber twice (same day, opponent, result, round)
  const mk = () => ({ meta: { rounds: [''] }, rows: [[20170407, 0, 0, 0, 0, 1.22, 4.74, 1, 8]], names: [['Thompson J.', 'Sock J.']] });
  const row = () => ({ date: '2017-04-07', won: true, opponent: 'J. Sock', round: 'RR', tournament: 'Davis Cup WG QF: AUS vs USA' });
  const career = [row(), row()];
  const ledger = career.map(x => ({ date: x.date, won: x.won, round: x.round, opp: x.opponent }));
  priceJoin(ledger, { full: 'J. Thompson' }, null, mk(), null, career);
  assert.deepEqual(ledger.map(x => x.price ?? null), [1.22, null], 'the first copy is priced, the copy stays a dash');
  // a second match the same day against another player is another match (control: both priced)
  const db2 = { meta: { rounds: [''] }, rows: [[20170407, 0, 0, 0, 0, 1.22, 4.74, 1, 8], [20170409, 0, 0, 0, 0, 1.5, 2.6, 1, 8]], names: [['Thompson J.', 'Sock J.'], ['Thompson J.', 'Querrey S.']] };
  const c2 = [row(), Object.assign(row(), { date: '2017-04-09', opponent: 'S. Querrey' })];
  const l2 = c2.map(x => ({ date: x.date, won: x.won, round: x.round, opp: x.opponent }));
  priceJoin(l2, { full: 'J. Thompson' }, null, db2, null, c2);
  assert.deepEqual(l2.map(x => x.price ?? null), [1.22, 1.5], 'two different matches both price');
  // MUTANT: without the one-match rule the two copies tie and both dash (the 6 Nov live state)
  const MUT = JOIN_SRC.replace('if (x && !lCopy(ri)) meet.forEach', 'if (x) meet.forEach').replace('x && !lCopy(ri) && !R.doneL.has(ri)', 'x && !R.doneL.has(ri)');
  assert.notEqual(MUT, JOIN_SRC, 'the mutant changed the join');
  const JM = new Function('fhDayNum', `${MUT}\nreturn { h2hPriceJoin };`)(fhDayNum);
  const lm = career.map(x => ({ date: x.date, won: x.won, round: x.round, opp: x.opponent }));
  JM.h2hPriceJoin(lm, { full: 'J. Thompson' }, null, mk(), null, [row(), row()]);
  assert.deepEqual(lm.map(x => x.price ?? null), [null, null], 'MUTANT: both copies dash');
});
