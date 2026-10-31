// Today's Matches search — founder 2026-10-12: searching a player shows his completed AND upcoming matches together,
// whichever view (Upcoming / Completed) is active, so his stats are one search away. Supersedes TEN-95's "the
// upcoming/completed split still applies" (2026-08-28); the date already dropped under a search (TEN-95).
//
// getFiltered and isFinishedMatch are sliced out of the shipped page and run over a fixture board; everything else
// they call is stubbed off fields on the fixture. Mutations each check names are in tools/test-matches-search-mutants.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.MXSEARCH_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let d = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; }
  return html.slice(start, i + 1);
}
const api = new Function(`
  let matches = [];
  const state = { day: 'today', view: 'upcoming', surface: 'all', tournaments: new Set(), search: '', sort: 'time' };
  const matchDayBucket = m => m.__bucket;
  const cardStartMs = m => m.__t;
  const oddsGap = () => 0, upsetScore = () => 0, moveScore = () => 0, marketWrongScore = () => 0, closingScore = () => 0, moveNowScore = () => 0;
  ${slice('isFinishedMatch')}
  ${slice('crossDateSearch')}
  ${slice('mxTodayPreview')}
  const MX_QUAL_SUFFIX = ' · Qualifying';
  ${slice('mxIsQual')}
  ${slice('mxTourKey')}
  ${slice('getFiltered')}
  return { state, set board(v){ matches = v; }, getFiltered };
`)();

// Bublik: R32 yesterday, an older win 3 days ago, R16 today, a QF tomorrow with no start yet; Zverev: R32 yesterday,
// R16 tomorrow; Fils: in play now (a live match is upcoming, never completed); Medvedev: finished earlier today.
const M = (id, p1, p2, bucket, t, fin, extra) => Object.assign({ id, p1, p2, tour: 'ATP Shanghai', surface: 'hard', time: '', __bucket: bucket, __t: t,
  finalScore: fin ? { display: '6-4, 6-4', sets: [] } : null, live: false }, extra || {});
const BOARD = () => [
  M('b-r32', 'A. Bublik', 'B. Nakashima', 'yesterday', 100, true),
  M('b-old', 'T. Machac', 'A. Bublik', 'daymin3', 10, true),
  M('b-r16', 'A. Bublik', 'J. Lehecka', 'today', 300, false),
  M('b-qf', 'A. Bublik', 'C. Alcaraz', 'tomorrow', NaN, false),
  M('z-r32', 'A. Zverev', 'Q. Halys', 'yesterday', 120, true),
  M('z-r16', 'F. Tiafoe', 'A. Zverev', 'tomorrow', 400, false),
  M('f-live', 'A. Fils', 'G. Monfils', 'today', 200, false, { live: true }),
  M('f-old', 'A. Fils', 'T. Paul', 'yesterday', 90, true),
  M('t-done', 'D. Medvedev', 'D. Svrcina', 'today', 50, true),
];
const run = (view, search, extra) => { const S = api.state; Object.assign(S, { view, search, day: 'today', surface: 'all', tournaments: new Set() }, extra || {});
  api.board = BOARD(); return api.getFiltered().map(m => m.id); };

// Mutation: the Upcoming / Completed split kept under a search (the TEN-95 rule) → only one group shows.
test('Upcoming view: a search lists the player\'s upcoming matches (nearest first, no start last) then his completed ones (most recent first)', () => {
  assert.deepEqual(run('upcoming', 'bublik'), ['b-r16', 'b-qf', 'b-r32', 'b-old']);
});

// Mutation: the active view's group not put first (one fixed order in both views).
test('Completed view: the same search lists completed first (most recent), then upcoming (nearest)', () => {
  assert.deepEqual(run('completed', 'bublik'), ['b-r32', 'b-old', 'b-r16', 'b-qf']);
  assert.deepEqual(run('completed', 'zverev'), ['z-r32', 'z-r16']);
  assert.deepEqual(run('upcoming', 'Zverev'), ['z-r16', 'z-r32']);
});

test('both views list the same matches for any search; a live match counts as upcoming', () => {
  for (const q of ['bublik', 'Zverev', 'a. z', 'fils']) assert.deepEqual(run('upcoming', q).slice().sort(), run('completed', q).slice().sort(), q);
  assert.deepEqual(run('upcoming', 'fils'), ['f-live', 'f-old']);
  assert.deepEqual(run('completed', 'fils'), ['f-old', 'f-live']);
});

// Mutation: the split dropped for every list, not only under a search.
test('without a search the day and the Upcoming / Completed split still apply', () => {
  // founder 2026-10-30: Today under Upcoming previews the next local day below its divider (same cards as its own tab)
  assert.deepEqual(run('upcoming', '').sort(), ['b-qf', 'b-r16', 'f-live', 'z-r16']);
  assert.deepEqual(run('upcoming', '', { day: 'tomorrow' }).sort(), ['b-qf', 'z-r16'], 'the next day\'s own tab = the preview');
  assert.deepEqual(run('completed', '', { day: 'yesterday' }).sort(), ['b-r32', 'f-old', 'z-r32']);
  assert.deepEqual(run('completed', ''), ['t-done'], 'Completed on today = only today\'s finished match');
});

test('the tournament filter still applies to a search', () => {
  assert.deepEqual(run('upcoming', 'bublik', { tournaments: new Set(['ATP Tokyo']) }), []);
  assert.deepEqual(run('upcoming', 'bublik', { tournaments: new Set(['ATP Shanghai']) }), ['b-r16', 'b-qf', 'b-r32', 'b-old']);
});
