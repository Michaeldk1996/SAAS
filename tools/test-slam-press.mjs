#!/usr/bin/env node
// Grand Slam press conferences (tools/news-ticker/slam-press.mjs). The pages below are written for this test in the
// transcript site's own layout (no real transcript is stored in the repo). Every "refuses" check is a mutant of a
// page that passes.
import { parseDayPage, parseInterview, pressAnswers, slamPressCandidates, slamTitle, PRESS_MAX_CHARS, PRESS_SOURCE } from './news-ticker/slam-press.mjs';
let pass = 0, failed = 0;
const ok = async (name, fn) => { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e && e.message || e)); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'not equal'}\n got  ${JSON.stringify(a)}\n want ${JSON.stringify(b)}`); };
const yes = (c, m) => { if (!c) throw new Error(m || 'expected true'); };

const DAY = `<td><b><a href="http://www.asapsports.com/show_interview.php?id=11">Ivan Tester</a></b></td><td><a href="http://www.asapsports.com/show_interview.php?id=12">Paul Other</a></td><a href="http://www.asapsports.com/show_interview.php?id=11">Ivan Tester</a>`;
const LONG = 'I served well in the fifth set and that kept me in the match. ' + 'It was a long match and I had to stay calm on the big points today. '.repeat(8);
const page = (head, heading = 'Press Conference') => `<h1>US OPEN</h1><h3><a href="x">Ivan Tester</a></h3><br /><h3>${heading}</h3><p>${head}<br />
THE MODERATOR:&nbsp;&nbsp; Questions, please.<br /><br />
Q.&nbsp; How did you win the fifth set today?<br /><br />
IVAN TESTER:&nbsp;&nbsp; I stayed calm and my serve helped me a lot in the tiebreak.<br />I am really happy with the win over Paul today.<br /><br />
Q.&nbsp; What will you eat tonight?<br /><br />
IVAN TESTER:&nbsp;&nbsp; Pasta, I think. Nothing special, to be honest with you, just pasta.<br /><br />
Q.&nbsp; Talk about the match.<br /><br />
IVAN TESTER:&nbsp;&nbsp; ${LONG}<br /><br />
Q.&nbsp; And you?<br /><br />
PAUL OTHER:&nbsp;&nbsp; I lost the match in the fifth set today and he served better than me.<br /></p><p></p><strong>FastScripts Transcript by ASAP Sports</strong>`;
const HEAD = 'I. TESTER/P. Other<br />6-4, 3-6, 7-6';

await ok('the day page lists each interview once, by id and name', () => {
  eq(parseDayPage(DAY), [{ id: '11', name: 'Ivan Tester' }, { id: '12', name: 'Paul Other' }]);
});
await ok('a transcript is read from its last heading, whatever it is called ("Press Conference", "Quick Quotes")', () => {
  for (const hd of ['Press Conference', 'Quick Quotes']) {
    const iv = parseInterview(page(HEAD, hd));
    eq(iv.header, ['I. TESTER/P. Other', '6-4, 3-6, 7-6']);
    eq(iv.turns.map((t) => t.who), ['THE MODERATOR', 'Q', 'IVAN TESTER', 'Q', 'IVAN TESTER', 'Q', 'IVAN TESTER', 'Q', 'PAUL OTHER']);
  }
  eq(parseInterview('<h3>Press Conference</h3><p>no closing line</p>'), null);
});
await ok('answers: the player\'s own, word for word, about the match; a long answer is cut at the end of a sentence', () => {
  const a = pressAnswers(parseInterview(page(HEAD)), 'Ivan Tester', 'Other', 'Tester');
  eq(a[0], { text: 'I stayed calm and my serve helped me a lot in the tiebreak. I am really happy with the win over Paul today.', question: 'How did you win the fifth set today?' });
  yes(!a.some((x) => /Pasta/.test(x.text)), 'an answer that is not about the match is left out');
  yes(!a.some((x) => /he served better than me/.test(x.text)), 'the other player\'s answer is never his');
  const long = a.find((x) => x.text.startsWith('I served well in the fifth set'));
  yes(long && long.text.length <= PRESS_MAX_CHARS && /\.$/.test(long.text) && LONG.replace(/\s+/g, ' ').startsWith(long.text), 'cut at a sentence end, still word for word');
});
await ok('a transcript whose header does not name both players of the match is not used (another round, doubles)', () => {
  eq(pressAnswers(parseInterview(page('I. TESTER/S. Somebody<br />6-1, 6-1')), 'Ivan Tester', 'Other', 'Tester'), []);
  eq(pressAnswers(parseInterview(page('')), 'Ivan Tester', 'Other', 'Tester'), [], 'no match line at all (a pre-tournament press conference)');
});
await ok('our tournament names map to the site\'s event titles; anything else is not a Slam', () => {
  eq(['US Open', 'French Open', 'Roland Garros', 'Wimbledon', 'Australian Open', 'Stockholm'].map(slamTitle), ['US OPEN', 'ROLAND GARROS', 'ROLAND GARROS', 'THE CHAMPIONSHIPS', 'AUSTRALIAN OPEN', null]);
});
await ok('candidates: both days are read, each interview once, in the quotes job\'s shape; nothing outside the transcript site', async () => {
  const calls = [], pages = { 'date=2026-9-9': '', 'date=2026-9-10': DAY, 'id=11': page(HEAD), 'id=12': page(HEAD).replace(/IVAN TESTER/g, 'X').replace(/PAUL OTHER/g, 'IVAN TESTER').replace(/X:/g, 'PAUL OTHER:') };
  const fetchFn = async (u) => { calls.push(u); const k = Object.keys(pages).find((x) => u.includes(x)); return { ok: k !== undefined, status: k !== undefined ? 200 : 404, arrayBuffer: async () => new TextEncoder().encode(pages[k]).buffer }; };
  const match = { id: 'past-77', date: '2026-09-09', p1: 'I. Tester', p2: 'P. Other', p1Key: 1, p2Key: 2, finalScore: { winner: 'p1' } };
  const cache = {}, opts = { tournament: 'US Open', match, fullName: (k) => ({ 1: 'Ivan Tester', 2: 'Paul Other' })[k], surnameOf: (c) => c.split(' ').pop(), cache, fetchFn, sleep: async () => {} };
  const c = await slamPressCandidates(opts);
  yes(c.length >= 3 && c.every((x) => x.preVerified && x.interview === 'press' && x.sourceName === PRESS_SOURCE && x.matchId === 'past-77' && x.language === 'en'), JSON.stringify(c).slice(0, 300));
  eq([c[0].speakerKey, c[0].won, c[0].context, c[0].topic], ['1', true, 'after beating P. Other', 'Asked: How did you win the fifth set today?']);
  yes(c.some((x) => x.speakerKey === '2' && x.won === false && x.context === 'after losing to I. Tester'), 'the loser\'s press conference too');
  yes(calls.every((u) => u.startsWith('https://www.asapsports.com/')) && calls.length === 4, calls.join(' '));
  const again = await slamPressCandidates({ ...opts, fetchFn: async (u) => { if (/show_interview/.test(u)) throw new Error('an interview was read twice'); return fetchFn(u); } });
  eq(again, [], 'a transcript already read is never fetched again');
  eq(await slamPressCandidates({ ...opts, tournament: 'Stockholm', cache: {} }), [], 'not a Slam: nothing is fetched');
});
console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
