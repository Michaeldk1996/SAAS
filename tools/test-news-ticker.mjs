#!/usr/bin/env node
// News ticker sample — the content rules, on fixtures (no network). Each rule is re-run against a mutant that breaks it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportText, statusItems, verbatimIn, resolvePlayer, winnerScore, roundWords, quotedSpans } from './news-ticker/news-core.mjs';
import { candidatesFromArticle, robotsDisallows, speakerOf } from './news-ticker/quote-sources.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

const card = (o = {}) => Object.assign({ id: 'past-1', p1: 'A. One', p2: 'B. Two', p1Key: 1, p2Key: 2, tournamentRound: 'ATP X - 1/8-finals', qualifying: false,
  retired: false, walkover: false, finalScore: { sets: [{ p1: 6, p2: 1 }, { p1: 6, p2: 4 }], winner: 'p1' },
  matchStats: { p1: { 'Service:Aces': 2, 'Points:Winners': 19, 'Points:Unforced errors': 7, raw: {} },
    p2: { 'Service:Aces': 0, 'Points:Winners': 15, 'Points:Unforced errors': 22, raw: { 'Service:Break Points Saved': { won: 4, total: 7 } } } } }, o);

ok('report: every number is a stored field, in the fixed template', () => {
  const r = reportText(card(), 'p1', 'p2', { a: 1, b: 0, n: 1 });
  assert.equal(r.text, 'A. One beat B. Two 6-1, 6-4 in the round of 16. A. One: 2 aces, 19 winners, 7 unforced errors. B. Two: 0 aces, 15 winners, 22 unforced errors, saved 4 of 7 break points. It was their first meeting.');
});
ok('report: a missing stat is left out, never 0 (no box score, no H2H)', () => {
  const r = reportText(card({ matchStats: null }), 'p1', 'p2', null);
  assert.equal(r.text, 'A. One beat B. Two 6-1, 6-4 in the round of 16.');
  assert.ok(!/\b0\b|—/.test(r.text));
});
ok('report: a genuine 0 aces prints 0; a null aces prints nothing', () => {
  const c = card(); c.matchStats.p1['Service:Aces'] = null;
  const r = reportText(c, 'p1', 'p2', null);
  assert.ok(/A\. One: 19 winners/.test(r.text) && /B\. Two: 0 aces/.test(r.text));
});
ok('report: winners / unforced errors all zero = not tracked, left out', () => {
  const c = card(); for (const k of ['p1', 'p2']) { c.matchStats[k]['Points:Winners'] = 0; c.matchStats[k]['Points:Unforced errors'] = 0; }
  const r = reportText(c, 'p1', 'p2', null);
  assert.ok(!/winners|unforced/.test(r.text)); assert.equal(r.used.wue, false);
});
ok('report: no break-point clause without a count (null is not "faced none")', () => {
  assert.ok(!/A\. One:[^.]*break/.test(reportText(card(), 'p1', 'p2', null).text));
});
ok('report: head-to-head wording follows the counts; loser ahead is named', () => {
  assert.ok(/B\. Two leads their head-to-head 3–2\./.test(reportText(card(), 'p1', 'p2', { a: 2, b: 3, n: 5 }).text));
  assert.ok(/level at 1–1/.test(reportText(card(), 'p1', 'p2', { a: 1, b: 1, n: 2 }).text));
});
ok('report: no rating, commentary or duration words in any output', () => {
  const t = reportText(card(), 'p1', 'p2', { a: 2, b: 0, n: 2 }).text;
  assert.ok(!/rating|looked|felt|confiden|minutes|hr\b|dominant|comfortabl/i.test(t));
});
ok('score and round helpers', () => {
  assert.equal(winnerScore(card({ finalScore: { sets: [{ p1: 3, p2: 6 }, { p1: 6, p2: 7 }], winner: 'p2' } }), 'p2'), '6-3, 7-6');
  assert.equal(roundWords('ATP Stockholm - 1/16-finals'), 'round of 32'); assert.equal(roundWords('ATP X - Odd Round'), 'Odd Round');
});

ok('status: walkover, retirement, qualifier and lucky loser from the board alone', () => {
  const cards = [
    card({ id: 'past-10', walkover: true, finalScore: { sets: [{ p1: 0, p2: 0 }], winner: 'p2' } }),
    card({ id: 'past-11', retired: true, finalScore: { sets: [{ p1: 6, p2: 3 }, { p1: 2, p2: 0 }], winner: 'p1' } }),
    card({ id: 'past-12', qualifying: true, tournamentRound: 'ATP X - Final', p1: 'C. Three', p1Key: 3, p2: 'B. Two', p2Key: 2 }),
    card({ id: 'past-13' }),
  ];
  const s = statusItems(cards, { ek: (m) => m.id.split('-')[1], startIso: () => null, tournament: 'X', base: 'https://x' });
  const ids = s.map((x) => x.id).sort();
  assert.deepEqual(ids, ['status-ll-12', 'status-q-12', 'status-ret-11', 'status-wo-10']);
  assert.equal(s.find((x) => x.id === 'status-wo-10').playerId, '1');
  assert.ok(/retired against A\. One at 6-3, 2-0/.test(s.find((x) => x.id === 'status-ret-11').text));
  assert.ok(/derived/.test(s.find((x) => x.id === 'status-ll-12').basis));
  assert.ok(s.every((x) => x.sourceUrl && x.basis));
});
ok('status: a main-draw final is not a qualifying final; no lucky loser without a main-draw card', () => {
  const s = statusItems([card({ id: 'past-20', tournamentRound: 'ATP X - Final' }), card({ id: 'past-21', qualifying: true, tournamentRound: 'ATP X - Final', p1Key: 8, p2Key: 9 })],
    { ek: (m) => m.id.split('-')[1], startIso: () => null, tournament: 'X', base: 'https://x' });
  assert.deepEqual(s.map((x) => x.id), ['status-q-21']);
});

const SRC = 'Rune won. “It’s special coming back to Stockholm after last year,” said Rune. “It’s such a nice court.”';
ok('verbatim: the exact words pass; typography alone may differ', () => {
  assert.ok(verbatimIn("It's special coming back to Stockholm after last year,", SRC));
});
ok('verbatim: one changed, dropped or added word fails (never repaired)', () => {
  assert.ok(!verbatimIn("It's special to come back to Stockholm after last year,", SRC));
  assert.ok(!verbatimIn("It's special coming back to Stockholm", '“It’s special coming back here”'));
  assert.ok(!verbatimIn("It is special coming back to Stockholm after last year,", SRC));
  assert.ok(!verbatimIn('nice court', SRC), 'a fragment under 12 characters is not a quote');
});
ok('verbatim: two spans must each be found; a paraphrase joining them fails as one string', () => {
  assert.ok(!verbatimIn("It's special coming back to Stockholm after last year, It's such a nice court.", SRC));
});

const ENT = new Map([['437', 'H. Rune'], ['388', 'J. M. Cerundolo'], ['9', 'F. Cerundolo'], ['1', 'A. Davidovich Fokina']]);
ok('player match: surname or full name -> exactly one entrant; namesakes need the initial', () => {
  assert.deepEqual(resolvePlayer('Rune', ENT), { status: 'one', key: '437' });
  assert.deepEqual(resolvePlayer('Holger Rune', ENT), { status: 'one', key: '437' });
  assert.equal(resolvePlayer('Cerundolo', ENT).status, 'several');
  assert.equal(resolvePlayer('Francisco Cerundolo', ENT).key, '9');
  assert.equal(resolvePlayer('Alejandro Davidovich Fokina', ENT).key, '1');
  assert.equal(resolvePlayer('Fokina', ENT).status, 'none', 'part of a compound surname is not that player');
  assert.equal(resolvePlayer('Borg', ENT).status, 'none');
});

const HTML = `<article><span>10 November 2026</span><p>Rune beat Bergs.</p>
<p>“It’s special coming back to Stockholm after last year,” said Rune, who won in 2022. “It’s such a nice court, such a nice event.”</p>
<p>“Very good, I have had a year to work on it,” said the 23-year-old.</p>
<p>“I was really happy to enjoy the match,” Norrie said in his on-court interview. “Going in, I wasn’t feeling my best.</p>
<p>“I probably had one of my best serving days of the year, so we take that.”</p></article>`;
ok('quotes: a named speaker in the paragraph, or an open quote carried on; "the 23-year-old" names nobody', () => {
  const g = candidatesFromArticle({ url: 'https://x/a', html: HTML, sourceName: 'X' });
  assert.equal(g.unnamed, 1); assert.equal(g.day, '2026-11-10');
  assert.deepEqual(g.candidates.map((c) => c.speaker), ['Rune', 'Norrie', 'Norrie']);
  for (const c of g.candidates) for (const s of c.spans) assert.ok(verbatimIn(s, c.sourceText), s);
  assert.ok(g.candidates.every((c) => c.sourceUrl === 'https://x/a'));
});
ok('quotes: speakerOf never reads a name from inside the quotation', () => {
  assert.equal(speakerOf('“Musetti said he was fine and I agree with that view,” the coach told reporters.'), null);
});
ok('quotedSpans ignores short fragments', () => { assert.deepEqual(quotedSpans('He called it "tough" and "a really long and difficult day for me".'), ['a really long and difficult day for me']); });
ok('robots: a disallowed path is skipped, others are not', () => {
  const R = 'User-agent: *\nDisallow: /sitecore/\nDisallow: */ajax/*\n\nUser-agent: Other\nDisallow: /';
  assert.ok(robotsDisallows(R, '/sitecore/x')); assert.ok(robotsDisallows(R, '/en/ajax/y')); assert.ok(!robotsDisallows(R, '/en/tournament/nyheter/a'));
});

ok('the committed sample: every item has the brief\'s fields and a source URL; no quote text unless verified', () => {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'news-sample.json'), 'utf8'));
  assert.ok(d.items.length > 0 && d.sample === true);
  for (const x of d.items) {
    for (const k of ['id', 'type', 'playerId', 'tournament', 'category', 'text', 'sourceName', 'sourceUrl', 'language']) assert.ok(x[k], `${x.id}: ${k}`);
    assert.ok(['quote', 'report', 'status'].includes(x.type)); assert.equal(typeof x.translated, 'boolean'); assert.ok('opponentId' in x && 'timestamp' in x);
    if (x.type === 'quote') assert.equal(x.verbatimCheck, 'passed');
    if (x.type === 'report') assert.ok(!/rating|commentary|\bNaN\b|undefined|null/i.test(x.text), x.text);
  }
  assert.equal(new Set(d.items.map((x) => x.id)).size, d.items.length);
  assert.equal(d.counts.reports, d.counts.played, 'one report per played main-draw match');
});
console.log(`news ticker sample: ${n} checks passed`);
