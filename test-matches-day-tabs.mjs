// Founder 2026-10-30 (matches-day-tabs-datebar-drift) — Today's Matches:
//  A. a day tab shows every match whose START falls on that local calendar day (member zone), the same rule the
//     Today page's divider uses; Today under Upcoming previews the next local day below that divider;
//  B. the date bar shows three days (Upcoming: Today · +1 · +2; Completed: −2 · −1 · Today), ‹ › page beyond;
//  C. the move view's card head is one line, with no start time.
// The page functions are SLICED from the shipped file and EXECUTED with a frozen clock and a member zone; every
// group ends with a mutant the assertions must catch.
//
// Run: node --test test-matches-day-tabs.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');

function slice(name, src) {
  const start = src.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(start + 1, i + 1);
}
function constLine(name, src) { const m = src.match(new RegExp('\\nconst ' + name + ' = [^\\n]*')); assert.ok(m, 'const ' + name); return m[0]; }

// now = 30 Oct 2026 14:00Z = 22:00 in Asia/Makassar (UTC+8); Berlin is CET (UTC+1) after 25 Oct
const NOW = Date.parse('2026-10-30T14:00:00Z');
function build(src = SRC, tz = 'Asia/Makassar') {
  const names = ['newsTz', 'acctTzOffsetMin', 'cardStartMs', 'apiStartMs', 'localDayKey', 'mxShiftDayKey', 'mxTodayKey',
    'matchLocalDayKey', 'matchDayBucket', 'isFinishedMatch', 'crossDateSearch', 'mxTodayPreview', 'getFiltered', 'mxRailWindow', 'mxHeaderSet'];
  return new Function('NOW', 'TZ', `
    const Date = class extends globalThis.Date { static now(){ return NOW; } };
    const localStorage = { getItem: k => (k === 'stennisfy.tz' ? TZ : null) };
    let matches = [];
    const state = { day: 'today', view: 'upcoming', surface: 'all', tournaments: new Set(), search: '', sort: 'time' };
    const oddsGap = () => 0, moveNowScore = () => 0, closingScore = () => 0;
    ${constLine('MX_RAIL_DAYS', src)}
    ${names.map(n => slice(n, src)).join('\n')}
    return { state, set board(v){ matches = v; }, getFiltered, matchDayBucket, mxRailWindow, mxHeaderSet };
  `)(NOW, tz);
}
const M = (id, date, time, extra) => Object.assign({ id, date, time, p1: id + '1', p2: id + '2', tour: 'ATP Paris' }, extra || {});
const BOARD = () => [
  M('t2200', '2026-10-30', '15:00'),                         // 22:00 local, 30 Oct
  M('n0030', '2026-10-30', '17:30'),                         // 00:30 local, 31 Oct — the case that must not land on 30 Oct
  M('n1000', '2026-10-31', '03:00'),                         // 02:00Z placeholder → no time, keeps its feed date (31 Oct)
  M('s1600', '2026-11-01', '09:00'),                         // 16:00 local, 1 Nov
  M('done', '2026-10-29', '18:00', { finalScore: { sets: [] } }),   // 01:00 local, 30 Oct — Completed: today, not yesterday
  M('y-done', '2026-10-29', '10:00', { finalScore: { sets: [] } }), // 17:00 local, 29 Oct
];
const run = (api, view, day) => { Object.assign(api.state, { view, day, search: '' }); api.board = BOARD(); return api.getFiltered().map(m => m.id); };

function checkA(api) {
  assert.equal(api.matchDayBucket(BOARD()[1]), 'tomorrow', 'a 00:30 local start (17:30 Berlin the day before) is on the NEXT day\'s tab');
  assert.equal(api.matchDayBucket(BOARD()[0]), 'today');
  assert.deepEqual(run(api, 'upcoming', 'tomorrow'), ['n0030', 'n1000'], 'Sat 31 = every match starting on 31 Oct local, nothing else');
  assert.deepEqual(run(api, 'upcoming', 'today'), ['t2200', 'n0030', 'n1000'], 'Today = today\'s cards, then the next day\'s (the divider\'s) — the same cards');
  assert.deepEqual(run(api, 'upcoming', 'day2'), ['s1600']);
  run(api, 'upcoming', 'today');
  assert.deepEqual(api.mxHeaderSet(api.getFiltered()).map(m => m.id), ['t2200'], 'the header counts today\'s cards only, never the preview');
  run(api, 'upcoming', 'tomorrow');
  assert.deepEqual(api.mxHeaderSet(api.getFiltered()).map(m => m.id), ['n0030', 'n1000'], 'on its own tab the next day counts in full');
  assert.deepEqual(run(api, 'completed', 'today'), ['done'], 'Completed keys on the start instant too');
  assert.deepEqual(run(api, 'completed', 'yesterday'), ['y-done']);
}
test('A: the local calendar day of the start instant decides the tab; Today previews the next day', () => { checkA(build()); });
test('A: the 02:00Z placeholder is no time — it keeps its feed date, never a guessed instant', () => {
  const ny = build(SRC, 'America/New_York');
  // 1 Nov 03:00 Berlin = 02:00Z = 31 Oct 22:00 New York; the placeholder keeps 1 Nov
  assert.equal(ny.matchDayBucket(M('p', '2026-11-01', '03:00')), 'day2');
  assert.equal(ny.matchDayBucket(M('r', '2026-11-01', '03:05')), 'tomorrow', 'a real 02:05Z start reads in the member zone');
});
test('A mutant: the feed date (Berlin wall date) as the tab rule → the 00:30 case lands on the previous day', () => {
  const mut = SRC.replace("return isFinite(ms) ? localDayKey(ms) : ((m && m.date) || '');", "return (m && m.date) || '';");
  assert.notEqual(mut, SRC);
  assert.throws(() => checkA(build(mut)));
});
test('A mutant: no next-day preview → Today shows only today', () => {
  const mut = SRC.replace("return state.view === 'upcoming' && state.day === 'today' && !crossDateSearch();", 'return false;');
  assert.notEqual(mut, SRC);
  assert.throws(() => checkA(build(mut)));
});

function checkB(api) {
  const win = (view, day) => { Object.assign(api.state, { view, day }); return api.mxRailWindow(); };
  assert.deepEqual(win('upcoming', 'today'), ['today', 'tomorrow', 'day2'], 'Upcoming: Today leftmost, the two days after');
  assert.deepEqual(win('completed', 'today'), ['daymin2', 'yesterday', 'today'], 'Completed: the two days before, Today rightmost');
  assert.deepEqual(win('upcoming', 'yesterday'), ['yesterday', 'today', 'tomorrow'], '‹ pages back past the window');
  assert.deepEqual(win('completed', 'tomorrow'), ['yesterday', 'today', 'tomorrow'], '› pages forward past the window');
}
test('B: the three-day date bar', () => { checkB(build()); });
test('B mutant: the old four-day Upcoming rail (yesterday · today · +1 · +2)', () => {
  const mut = SRC.replace("const def = state.view === 'completed' ? 1 : 3;", "const def = state.view === 'completed' ? 1 : 2;");
  assert.notEqual(mut, SRC);
  assert.throws(() => checkB(build(mut)));
});

function checkC(src) {
  assert.match(src, /: mxDriftView\(\)\n\s*\? \(m\.live \? `<span class="mc-status live">\$\{statusLabel\(m\)\}<\/span>` : ''\)/, 'the move view drops the start time from the head');
  assert.match(src, /\.match-card:not\(\.cmpl\) \.mc-head:has\(\.mc-colhead-drift\)\{ flex-wrap:nowrap;/, 'the move view head never wraps OPEN / NOW / MOVE onto a second line');
  assert.match(src, /: `<span class="mc-datetime">\$\{startWithDate\}<\/span>`;/, 'the default view keeps its start time');
}
test('C: the move view card head is one line with no start time; the default head is unchanged', () => { checkC(SRC); });
test('C mutant: the head wraps again', () => {
  const mut = SRC.replace('.mc-head:has(.mc-colhead-drift){ flex-wrap:nowrap;', '.mc-head:has(.mc-colhead-drift){ flex-wrap:wrap;');
  assert.notEqual(mut, SRC);
  assert.throws(() => checkC(mut));
});
test('A mutant: the header counts the next-day preview', () => {
  const mut = SRC.replace("return mxTodayPreview() ? arr.filter(m => matchDayBucket(m) !== 'tomorrow') : arr;", 'return arr;');
  assert.notEqual(mut, SRC);
  assert.throws(() => checkA(build(mut)));
});
