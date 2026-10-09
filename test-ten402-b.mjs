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
const joinM = new Function(`${constLine('H2H_PAGE_LEVELS')}\n${constLine('H2H_PAGE_NOT_COUNTED')}\n${slice('h2hNameKey')}\n${slice('h2hJoinMeetings')}\nreturn h2hJoinMeetings;`)();
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

test('Data 1: ATP main draw only — Challenger / ITF and qualifying out; Laver Cup and exhibitions in (ticket); own board match out', () => {
  const mk = (ek, o) => [row(Object.assign({ eventKey: ek, date: '2024-0' + (ek % 9 + 1) + '-01', won: true, opponent: 'C. Alcaraz' }, o)),
    row(Object.assign({ eventKey: ek, date: '2024-0' + (ek % 9 + 1) + '-01', won: false, opponent: 'J. Sinner' }, o))];
  const pairs = [mk(1, { tournament: 'ATP Laver Cup' }), mk(2, { tournament: 'Six Kings Slam' }), mk(3, { tournament: 'Bergamo', level: 'chitf' }),
    mk(4, { tournament: 'Wimbledon', round: 'Qualifying' }), mk(5, { tournament: 'Beijing', qualifying: true }), mk(6, { tournament: 'Today' })];
  const out =joinM(A, B, pairs.map(p => p[0]), pairs.map(p => p[1]), {}, [6]);
  assert.deepEqual(out.map(x => x.eventKey).sort(), [1, 2], 'Laver Cup + an exhibition kept; CH, qualifying ×2 and the own board match dropped');
  assert.match(html, /const H2H_PAGE_LEVELS = \['atp'\];/);
  assert.match(html, /const H2H_PAGE_NOT_COUNTED = null;/, 'ticket Data 1: "including Laver Cup and exhibitions"');
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
  // founder r1 fix 3 (2026-10-09): no per-row Bet365 mark; one footnote under the ledger (executed in test-ten402-r1y.mjs)
  assert.match(h2hCardSrc, /hTitle: h2hPriceTitle\(r\), aTitle: h2hPriceTitle\(r\), hMark: '',/, 'the ledger row carries no B marker');
  assert.match(h2hCardSrc, /\$\{h2hPxNote\('margin-top:-8px;'\)\}/, 'one footnote under the Meetings ledger');
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
  assert.equal(J0.rows.length, b.rows.length + b.retRows.length); assert.equal(J0.nDb, b.rows.length);
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

// ---------------------------------------------------------------- item 8: the match-stats sheet
// the site's lower-is-better list (MATCH_STAT_ORDER) + its reader, sliced with fhSheetBetter (review 2, item 6)
const LOWER_SRC = `${/\nconst MATCH_STAT_ORDER = \[[\s\S]*?\n\];/.exec(html)[0]}\n${slice('fhLowerIsBetter')}`;
const rowHtml = tone => new Function('FH_MONO', 'MA_GREY', 'FH_DASH', 'fhEsc', 'FH_BAR_CAP', 'fhSheetTone',
  `${LOWER_SRC}; ${slice('fhStatBarWidth')}; ${slice('fhSheetBetter')}; ${slice('fhSheetRowHtml')}; return fhSheetRowHtml;`)(
  "font-family:'IBM Plex Mono',monospace;", 'var(--text-label)', 'var(--text-label)', s => String(s), 90, () => tone);
const cell = (v, txt) => ({ v, txt: txt || String(v), sub: '', title: '' });
const figs = h => [...h.matchAll(/font-size:15px; font-weight:(\d+); color:([^;]+);">([^<]*)</g)].map(m => [m[3], +m[1], m[2]]);
const fills = h => [...h.matchAll(/class="fh-sbar" style="height:6px; width:[\d.]+%; background:([^;]+);"/g)].map(m => m[1]);

test('item 8: on the Head to Head sheet the better figure is white 700, the other grey 500; both white on a tie (no blue A)', () => {
  const R = rowHtml('h2h');
  assert.deepEqual(figs(R({ label: 'Dominance ratio', kind: 'ratio', a: cell(1.15, '1.15'), b: cell(0.87, '0.87') })),
    [['1.15', 700, 'var(--text)'], ['0.87', 500, 'var(--text-label)']]);
  assert.deepEqual(figs(R({ label: 'Unforced errors / total points', kind: 'pct', a: cell(12, '0.12'), b: cell(14, '0.14') })).map(f => f[1]), [700, 500], 'lower is better for errors');
  assert.deepEqual(figs(R({ label: 'Double faults', kind: 'count', k: 15, a: cell(5), b: cell(2) })).map(f => f[1]), [500, 700]);
  assert.deepEqual(figs(R({ label: 'Serve rating', kind: 'rating', k: 400, a: cell(296), b: cell(296) })).map(f => f[1]), [700, 700], 'a tie marks neither');
  assert.deepEqual(figs(R({ label: 'Aces', kind: 'count', k: 30, a: cell(null, '—'), b: cell(4) })).map(f => f[1]), [700, 700], 'a dash marks neither');
  // control: every other sheet (Match analysis, Match Stats tab, profile) is unchanged — both figures white 700
  assert.deepEqual(figs(rowHtml(null)({ label: 'Dominance ratio', kind: 'ratio', a: cell(1.15, '1.15'), b: cell(0.87, '0.87') })).map(f => [f[1], f[2]]), [[700, 'var(--text)'], [700, 'var(--text)']]);
});

test('item 5 on the sheet: bars are white — the leader --viz-white-lead, the trailer 70%; elsewhere the blue pair stays', () => {
  const s = { label: 'Serve rating', kind: 'rating', k: 400, a: cell(296), b: cell(266) };
  assert.deepEqual(fills(rowHtml('h2h')(s)), ['var(--viz-white-lead)', 'color-mix(in srgb, var(--viz-white-lead) 70%, transparent)']);
  assert.deepEqual(fills(rowHtml(null)(s)), ['var(--bar)', 'var(--bar-2)'], 'control: Match analysis keeps --bar / --bar-2');
});

test('item 8: the tone is set only for a pop-up opened from this page; the frame adds --shadow-modal there; closers registered', () => {
  assert.match(slice('fhSheetRender'), /_fhSheetToneNow = \(slot !== 'tab' && _fh && _fh\.m && _fh\.m\.h2hPage\) \? 'h2h' : null;/);
  assert.match(slice('fhSheetRender'), /host\.innerHTML = fhSheetSeg\(tabs\) \+ body;\n  _fhSheetToneNow = null;/, 'reset after the paint');
  assert.match(slice('fhOpenSheet'), /\$\{_fh\.m && _fh\.m\.h2hPage \? ' box-shadow:var\(--shadow-modal\);' : ''\}/);
  assert.match(slice('fhOpenSheet'), /inset:0 0 0 var\(--sf-side, 0px\); z-index:110; background:var\(--backdrop\); backdrop-filter:blur\(3px\)/, 'scrim over the content area only');
  assert.match(html, /pm: \{ h2hPage: true, p1: a\.short, p2: b\.short, p1Key: a\.key, p2Key: b\.key \}/, 'the page\'s pseudo match carries the flag');
  assert.match(html, /\(window\.sfOverlayClosers = window\.sfOverlayClosers \|\| \[\]\)\.push\(\(\) => \{ if \(typeof _fh !== 'undefined' && _fh && _fh\.m && _fh\.m\.h2hPage && _fh\.sheet\) fhCloseSheet\(\); \}\);/);
  assert.match(slice('fhMarkRow'), /#h2hRoot \.h2hp-row/, 'the open meeting\'s row keeps the selected wash');
  // every row and every hot-line dot opens the sheet through the page's opener (registers the entry, then fhOpenSheet)
  assert.match(h2hCardSrc, /click: ` onclick="H2HPage\._open\('\$\{E\(r\.mid\)\}'\)"`/);
  assert.match(h2hCardSrc, /const toSheet = s => s\.replace\(\/fhOpenSheet\\\(\/g, 'H2HPage\._open\('\);/);
});

// ---------------------------------------------------------------- items 2–5, 10: the card
test('items 2–5: a top-level card with no outline; panels --card + --edge-6; chips on the darker track; white tug bar (H8)', () => {
  assert.match(h2hCardSrc, /background:var\(--card\); box-shadow:var\(--top-light\); border:1px solid transparent; border-radius:16px; padding:20px 22px;/);
  assert.match(h2hCardSrc, /const panel = 'background:var\(--card\); border:1px solid var\(--edge-6\); border-radius:14px;';/);
  assert.match(h2hCardSrc, /h2hSeg\(\[\['all', 'All'\], \['Hard', 'Hard'\], \['Clay', 'Clay'\], \['Grass', 'Grass'\]\]/, 'the page\'s darker-track control (builder a\'s h2hSeg = sfSegHtml: track --card + --edge-6, selected --inner + --edge-10)');
  assert.match(h2hCardSrc, /\}\), 'chip', 'Head-to-head scope'\)/, 'the chip size');
  assert.match(h2hCardSrc, /const head = sectionHead\('Head-to-head record', chips \? \{ html: chips \} : ''\);/, 'chips at the right end of the shared section head');
  assert.doesNotMatch(h2hCardSrc, /maSeg\(/, 'control: no second segmented control on the card');
  assert.match(h2hCardSrc, /background:var\(--viz-track\); border-radius:4px;/, 'tug track = the 6% white viz track');
  assert.match(h2hCardSrc, /class="h2hp-tug-a"[^>]*width:\$\{tug\('a'\)\}; background:\$\{tugTone\('a'\)\};/, 'A\'s bar: h2hTug\'s width and tone');
  assert.match(h2hCardSrc, /class="h2hp-tug-b"[^>]*width:\$\{tug\('b'\)\}; background:\$\{tugTone\('b'\)\};/, 'B\'s bar: h2hTug\'s width and tone');
  assert.match(h2hCardSrc, /const T = h2hTug\(aw, bw\), side = T\.side, tug = s => T\[s\]\.w, tugTone = s => T\[s\]\.tone;/);
  assert.doesNotMatch(h2hCardSrc, /var\(--bar\)|var\(--bar-2\)|var\(--link\)|var\(--hot-dot\)|var\(--amber\)/, 'no blue (or amber) of its own: the only blue is the hot-line dots inside the shared table');
});

test('items 3 + 10: Hot lines = the shared table; the ledger = the shared rows on the H2H grid, grouped by year; toggles white', () => {
  assert.match(h2hCardSrc, /fhHotLinesTable\(F, sc, \{ colMin: '26px', colHead: 'year', fixedCols: 9,/);
  assert.match(h2hCardSrc, /fhHotMoreHtml\(!!state\.h2hAllLines, sc\.scored\.length, 'H2HPage\._h2hAllLines\(\)'\)/, '"Show all lines (N)" (--text, the shared toggle)');
  assert.match(h2hCardSrc, /class="seg h2hp-tolist"[^>]*color:var\(--text\);[^>]*>Meetings ↓</, '"Meetings ↓" is white');
  assert.match(h2hCardSrc, /labels: \['Date', '', 'Event', 'Rd', 'Sets', 'Set scores', 'Home', 'Away'\], rowCols: MA_ROW_COLS_H2H, rowGap: MA_ROW_GAP_H2H, groupMono: true, headPad: '8px 14px 7px', groupPad: '11px 14px 5px', inset: 8/);
  assert.match(h2hCardSrc, /meta: w \+ '–' \+ \(Y\.rs\.length - w\) \+ ' · ' \+ Y\.rs\.length \+ \(Y\.rs\.length === 1 \? ' meeting' : ' meetings'\)/, 'year header "2024 1–2 · 3 meetings" (en dash)');
  assert.match(html, /#h2hRoot \.h2hp-row:hover\{ background:var\(--inner\) !important; \}/, 'rows hover on the inner tone');
  assert.match(html, /function priceRows\(\)\{ return loadBase\(\)\.then\(function\(\)\{ return loadNames\(\); \}\)/, 'the Database tab exposes its own join; the ledger never builds a second one');
});

// ---------------------------------------------------------------- review fixes (TEN-402 lead, 2026-10-08)
// Fix 1 · item 5: the record bar's tone follows the LEADER, never the side.
const h2hTug = new Function(`${slice('h2hTug')}\nreturn h2hTug;`)();
const SOLID = 'var(--viz-white-lead)', SEVENTY = 'color-mix(in srgb, var(--viz-white-lead) 70%, transparent)';
test('item 5 (fix 1): the leader\'s record bar is solid --viz-white-lead, a trailing segment 70% — B leading draws B solid', () => {
  const bLeads = h2hTug(1, 3);   // e.g. the Clay scope: B 3–1 up
  assert.equal(bLeads.side, 'b');
  assert.deepEqual([bLeads.b.w, bLeads.b.tone], ['25.00%', SOLID], 'B leads: B\'s (only) bar is the solid lead bar');
  assert.deepEqual([bLeads.a.w, bLeads.a.tone], ['0%', SEVENTY], 'A trails: no segment, and were there one it would be 70%');
  const aLeads = h2hTug(10, 7);
  assert.deepEqual([aLeads.a.w, aLeads.a.tone, aLeads.b.tone], ['8.82%', SOLID, SEVENTY]);
  const lvl = h2hTug(2, 2);
  assert.deepEqual([lvl.side, lvl.a.w, lvl.b.w], ['level', '0%', '0%']);
  // the drawn bar is never a dimmed lone bar: whichever side has width carries the solid tone
  for (const [x, y] of [[1, 3], [3, 1], [0, 5], [7, 0], [9, 8]]) { const t = h2hTug(x, y); const lead = t.a.w !== '0%' ? t.a : t.b; assert.equal(lead.tone, SOLID, x + '–' + y); }
});

// Review 2 item 6 (checked live: Monte Carlo 2026 F, Alcaraz 5 v Sinner 2 double faults — Sinner's 2 was white 700 but
// Alcaraz's 5 carried the bright bar). On the Head to Head sheet the bright bar is the better figure's, on the site's own
// lower-is-better list (MATCH_STAT_ORDER: Double Faults, Unforced Errors).
test('review 2 item 6: lower-is-better rows light the SHORTER bar on the Head to Head sheet (double faults 5 v 2); other hosts unchanged', () => {
  const df = { label: 'Double faults', kind: 'count', k: 15, a: cell(5), b: cell(2) };
  assert.deepEqual(fills(rowHtml('h2h')(df)), [SEVENTY, SOLID], 'B (2) is better: B\'s bar solid, A\'s (5) 70%');
  assert.deepEqual(figs(rowHtml('h2h')(df)).map(f => f[1]), [500, 700], 'and the figures agree');
  const ue = { label: 'Unforced errors / total points', kind: 'pct', a: cell(22, '0.22'), b: cell(27, '0.27') };
  assert.deepEqual(fills(rowHtml('h2h')(ue)), [SOLID, SEVENTY], 'A\'s 0.22 is better');
  const aces = { label: 'Aces', kind: 'count', k: 30, a: cell(9), b: cell(3) };
  assert.deepEqual(fills(rowHtml('h2h')(aces)), [SOLID, SEVENTY], 'higher is better: the longer bar, as before');
  assert.deepEqual(fills(rowHtml(null)(df)), ['var(--bar)', 'var(--bar-2)'], 'control: Match analysis keeps the longer-bar rule (founder Q3)');
  // the list is the site's: MATCH_STAT_ORDER's lowerBetter flag, read by fhLowerIsBetter
  const low = new Function(`${LOWER_SRC}; return fhLowerIsBetter;`)();
  assert.deepEqual(['Double faults', 'Unforced errors', 'Unforced errors / total points', 'Winners / unforced errors', 'Aces', 'Dominance ratio'].map(low), [true, true, true, false, false, false]);
});

// Review 2 item 2: the Player Profile's hand-off (window.pp2OpenMatchSheet) never reuses the Head to Head page's sheet
// state — its pseudo match carries h2hPage (white bars, Dominance emphasis, --shadow-modal). Runs the REAL opener and the
// REAL fhStateFor / fhOpenSheet / fhCloseSheet with the DOM and the body painter stubbed; the tone is computed with
// fhSheetRender's own line.
test('review 2 item 2: an H2H sheet opened and closed, then a profile recent-form chip → the profile sheet has no H2H tone', () => {
  const at = html.indexOf('window.pp2OpenMatchSheet = function(x){');
  let d = 0, i = html.indexOf('{', at); for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; }
  const opener = html.slice(at, i + 1);
  const toneLine = /_fhSheetToneNow = (\([^\n]*?\)) \? 'h2h' : null;/.exec(slice('fhSheetRender'))[1];
  const run = new Function(`
    let _fh = null, _fhSheetToneNow = null, painted = null;
    const host = { innerHTML: '', parentNode: null, classList: { add() {} }, isConnected: true, remove() {} };
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
  assert.match(h.frame, /box-shadow:var\(--shadow-modal\)/);
  P.close();
  const p = P.profile();
  assert.equal(p.tone, null, 'the profile sheet: no white bars, no Dominance emphasis');
  assert.doesNotMatch(p.frame, /--shadow-modal/);
  // an open Match analysis modal's state is still shared with the profile (unchanged behaviour)
  const P2 = run(); P2.modal({ p1: 'A', p2: 'B' }); assert.equal(P2.profile().tone, null);
  assert.match(html, /const st = _fh && !\(_fh\.m && _fh\.m\.h2hPage\) \? _fh : fhStateFor\(\{ pp2: true, key: x\.subjectKey \}\);/);
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

// Fix 5 · item 8: the Match / Set scopes' Dominance ratio card on the Head to Head sheet.
const drHtml = (tone, dr) => new Function('fhSheetModel', 'fhSheetTone', 'fhSheetBetter',
  `const FH_MONO = "font-family:'IBM Plex Mono',monospace;", FH_DASH = 'var(--text-label)', FH_DASHC = '—';
   const fhEsc = s => String(s), fhSheetSectionHead = t => t, fhSheetRowHtml = () => '', maSheetNaNote = () => '', maSheetGateNote = () => '';
   ${slice('fhSheetStatsHtml')}; return fhSheetStatsHtml;`)(
  () => ({ dr, sections: [], partial: false, gated: false }), () => tone, new Function(`${LOWER_SRC}; ${slice('fhSheetBetter')}; return fhSheetBetter;`)())({ own: {}, opp: {} });
const drFigs = h => ['a', 'b'].map(s => { const m = new RegExp(`class="fh-dr-${s}"[^>]*font-size:24px; font-weight:(\\d+); color:([^;]+);[^>]*>([^<]*)<`).exec(h); return m && [m[3], +m[1], m[2]]; });
test('item 8 (fix 5): the sheet\'s Match / Set Dominance ratio card — the better figure white 700, the other --text-label 500 (Head to Head only)', () => {
  const d = (a, b) => [{ txt: a, title: '' }, { txt: b, title: '' }];
  assert.deepEqual(drFigs(drHtml('h2h', d('1.15', '0.87'))), [['1.15', 700, 'var(--text)'], ['0.87', 500, 'var(--text-label)']]);
  assert.deepEqual(drFigs(drHtml('h2h', d('0.92', '1.08'))), [['0.92', 500, 'var(--text-label)'], ['1.08', 700, 'var(--text)']], 'B better');
  assert.deepEqual(drFigs(drHtml('h2h', d('1.00', '1.00'))).map(f => f[1]), [700, 700], 'a tie marks neither');
  assert.deepEqual(drFigs(drHtml('h2h', d('—', '1.08'))), [['—', 700, 'var(--text-label)'], ['1.08', 700, 'var(--text)']], 'a dash marks neither');
  // control: every other host (Match analysis, Match Stats tab, profile) keeps both figures white 700
  assert.deepEqual(drFigs(drHtml(null, d('1.15', '0.87'))).map(f => [f[1], f[2]]), [[700, 'var(--text)'], [700, 'var(--text)']]);
});
