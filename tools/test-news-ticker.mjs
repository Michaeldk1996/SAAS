#!/usr/bin/env node
// News ticker sample — the content rules, on fixtures (no network). Each rule is re-run against a mutant that breaks it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportText, statusItems, verbatimIn, resolvePlayer, winnerScore, roundWords, quotedSpans, breakPoints } from './news-ticker/news-core.mjs';
import { translationOk, translateQuote, sentenceCount } from './news-ticker/translate.mjs';
import { pbpFacts, scoreFacts, strictGame } from './news-ticker/pbp-facts.mjs';
import { candidatesFromArticle, robotsDisallows, speakerOf } from './news-ticker/quote-sources.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('  ok  ' + name); };

const card = (o = {}) => Object.assign({ id: 'past-1', p1: 'A. One', p2: 'B. Two', p1Key: 1, p2Key: 2, tournamentRound: 'ATP X - 1/8-finals', qualifying: false,
  retired: false, walkover: false, finalScore: { sets: [{ p1: 6, p2: 1 }, { p1: 6, p2: 4 }], winner: 'p1' },
  matchStats: { p1: { 'Service:Aces': 2, 'Points:Winners': 19, 'Points:Unforced errors': 7, raw: {} },
    p2: { 'Service:Aces': 0, 'Points:Winners': 15, 'Points:Unforced errors': 22, raw: { 'Service:Break Points Saved': { won: 4, total: 7 } } } } }, o);

await ok('report: every number is a stored field, in the fixed template', () => {
  const r = reportText(card(), 'p1', 'p2', { h2h: { a: 1, b: 0, n: 1 }, round: 'second round' });
  assert.equal(r.text, 'A. One beat B. Two in their first meeting, 6-1, 6-4 in the second round. A. One: 2 aces, 19 winners, 7 unforced errors. B. Two: 0 aces, 15 winners, 22 unforced errors, saved 4 of 7 break points.');
});
await ok('report: a missing stat is left out, never 0 (no box score, no H2H, no point log)', () => {
  const r = reportText(card({ matchStats: null }), 'p1', 'p2', {});
  assert.equal(r.text, 'A. One beat B. Two 6-1, 6-4 in the round of 16.');
  assert.ok(!/\b0\b|—/.test(r.text));
});
await ok('report: a genuine 0 aces prints 0; a null aces prints nothing', () => {
  const c = card(); c.matchStats.p1['Service:Aces'] = null;
  const r = reportText(c, 'p1', 'p2', {});
  assert.ok(/A\. One: 19 winners/.test(r.text) && /B\. Two: 0 aces/.test(r.text));
});
await ok('report: winners / unforced errors all zero = not tracked, left out', () => {
  const c = card(); for (const k of ['p1', 'p2']) { c.matchStats[k]['Points:Winners'] = 0; c.matchStats[k]['Points:Unforced errors'] = 0; }
  const r = reportText(c, 'p1', 'p2', {});
  assert.ok(!/winners|unforced/.test(r.text)); assert.equal(r.used.wue, false);
});
await ok('break points: box score first; blank box score -> the point-by-point count; zero faced = "faced no break points"; neither = no clause', () => {
  const pbp = { bp: { p1: { faced: 0, saved: 0 }, p2: { faced: 9, saved: 9 } }, brokenForMatch: { p1: 0, p2: 0 }, brokenForSet: { p1: 0, p2: 0 }, brokenFrom400: { p1: 0, p2: 0 }, opening: null, longestRun: { side: null, n: 2 } };
  const t = reportText(card(), 'p1', 'p2', { pbp }).text;
  assert.ok(/A\. One: [^.]*faced no break points\./.test(t), t);
  assert.ok(/B\. Two: [^.]*saved 4 of 7 break points\./.test(t), 'the box score count wins over the point log');
  assert.ok(!/A\. One:[^.]*break/.test(reportText(card(), 'p1', 'p2', {}).text), 'a blank with no point log is not "faced none"');
  assert.deepEqual(breakPoints(card().matchStats, 'p1', { bp: { p1: null } }), null);
});
await ok('report: head-to-head reads "for the Nth time in M meetings" from the counts', () => {
  assert.ok(/^A\. One beat B\. Two for the 2nd time in 5 meetings, 6-1, 6-4 /.test(reportText(card(), 'p1', 'p2', { h2h: { a: 2, b: 3, n: 5 } }).text));
  assert.ok(/for the 11th time in 23 meetings/.test(reportText(card(), 'p1', 'p2', { h2h: { a: 11, b: 12, n: 23 } }).text));
  assert.ok(/for the 3rd time in 3 meetings/.test(reportText(card(), 'p1', 'p2', { h2h: { a: 3, b: 0, n: 3 } }).text));
});
await ok('report: duration prints only when handed one (both ends observed)', () => {
  assert.ok(!/minutes/.test(reportText(card(), 'p1', 'p2', { duration: null }).text));
  // founder 2026-11-12: printed only when it is news (a straight-sets win inside 60 minutes, or 180+); always stored
  assert.ok(/in the round of 16 in just 58 minutes\./.test(reportText(card(), 'p1', 'p2', { duration: 58 }).text));
  const d71 = reportText(card(), 'p1', 'p2', { duration: 71 }); assert.ok(!/minutes/.test(d71.text)); assert.equal(d71.fields.durationMinutes, 71);
});
await ok('report: no rating or opinion words in any output', () => {
  const t = reportText(card(), 'p1', 'p2', { h2h: { a: 2, b: 0, n: 2 } }).text;
  assert.ok(!/rating|looked|felt|confiden|dominant|comfortabl|impressive|clinical/i.test(t));
});

// ---- point-by-point facts ----
const G = (g, server, winner, score, pts) => ({ g, server, winner, score, points: pts.map((s, i) => ({ n: i + 1, s })) });
const HOLD1 = ['15 - 0', '30 - 0', '40 - 0'], HOLD2 = ['0 - 15', '0 - 30', '0 - 40'];
function setOf(rows) { return { set: 1, games: rows }; }
await ok('pbp: break points are counted off the score, never 40-40; saved = faced minus service games lost', () => {
  // p1 serves: 0-15 15-15 15-30 15-40(BP) 30-40(BP) 40-40 40-A(BP) 40-40 A-40 -> hold: faced 3, saved 3
  const g1 = G(1, 'p1', 'p1', '1 - 0', ['0 - 15', '15 - 15', '15 - 30', '15 - 40', '30 - 40', '40 - 40', '40 - A', '40 - 40', 'A - 40']);
  // p2 serves and is broken at the first break point: 15-0 30-0 40-0 (p1-first, so p1 the receiver leads)
  const g2 = G(2, 'p2', 'p1', '2 - 0', HOLD1);
  const rows = [g1, g2, G(3, 'p1', 'p1', '3 - 0', HOLD1), G(4, 'p2', 'p1', '4 - 0', HOLD1), G(5, 'p1', 'p1', '5 - 0', HOLD1), G(6, 'p2', 'p1', '6 - 0', HOLD1)];
  const f = pbpFacts({ sets: [setOf(rows)] }, { sets: [{ p1: 6, p2: 0 }] });
  assert.deepEqual(f.bp.p1, { faced: 3, saved: 3 }); assert.deepEqual(f.bp.p2, { faced: 3, saved: 0 });
  assert.deepEqual(f.opening, { side: 'p1', saved: 3 }); assert.deepEqual(f.longestRun, { side: 'p1', n: 6, set: 1, from: { me: 0, opp: 0 }, afterBeingBroken: false, toTheEnd: true });
});
await ok('pbp: a garbled or gapped game gives that side no count (never a guess); the other side keeps its own', () => {
  const bad = G(1, 'p1', 'p1', '1 - 0', ['15 - 0', '40 - 0']);   // a missing point
  const rows = [bad, G(2, 'p2', 'p2', '1 - 1', HOLD2), G(3, 'p1', 'p1', '2 - 1', HOLD1), G(4, 'p2', 'p2', '2 - 2', HOLD2), G(5, 'p1', 'p1', '3 - 2', HOLD1),
    G(6, 'p2', 'p2', '3 - 3', HOLD2), G(7, 'p1', 'p1', '4 - 3', HOLD1), G(8, 'p2', 'p2', '4 - 4', HOLD2), G(9, 'p1', 'p1', '5 - 4', HOLD1), G(10, 'p2', 'p1', '6 - 4', HOLD1)];
  const f = pbpFacts({ sets: [setOf(rows)] }, { sets: [{ p1: 6, p2: 4 }] });
  assert.equal(f.bp.p1, null); assert.deepEqual(f.bp.p2, { faced: 1, saved: 0 }); assert.equal(f.brokenFrom400.p1, null);
});
await ok('pbp: games that do not add up to the set score give no facts at all', () => {
  assert.equal(pbpFacts({ sets: [setOf([G(1, 'p1', 'p1', '1 - 0', HOLD1)])] }, { sets: [{ p1: 6, p2: 0 }] }), null);
  assert.equal(pbpFacts({ sets: [setOf([G(1, 'p1', 'p1', '2 - 0', HOLD1)])] }, { sets: [{ p1: 2, p2: 0 }] }), null, 'a header that jumps a game');
});
await ok('pbp: broken serving for the set / for the match, broken from 40-0 up', () => {
  // set 1: p1 leads 5-4 and serves for the set; reaches 40-0, is broken; p2 then takes it 7-5
  const lost400 = ['15 - 0', '30 - 0', '40 - 0', '40 - 15', '40 - 30', '40 - 40', '40 - A'];
  const s1 = [G(1, 'p1', 'p1', '1 - 0', HOLD1), G(2, 'p2', 'p2', '1 - 1', HOLD2), G(3, 'p1', 'p1', '2 - 1', HOLD1), G(4, 'p2', 'p2', '2 - 2', HOLD2),
    G(5, 'p1', 'p1', '3 - 2', HOLD1), G(6, 'p2', 'p2', '3 - 3', HOLD2), G(7, 'p1', 'p1', '4 - 3', HOLD1), G(8, 'p2', 'p2', '4 - 4', HOLD2), G(9, 'p1', 'p1', '5 - 4', HOLD1),
    G(10, 'p2', 'p2', '5 - 5', HOLD2), G(11, 'p1', 'p2', '5 - 6', ['0 - 15', '0 - 30', '0 - 40']), G(12, 'p2', 'p2', '5 - 7', HOLD2)];
  s1[8] = G(9, 'p1', 'p1', '5 - 4', HOLD1); s1[9] = G(10, 'p2', 'p2', '5 - 5', HOLD2);
  // set 2: p2 (a set up) serves for the MATCH at 5-4 and is broken from 40-0; p1 wins 7-5; set 3 p1 6-0
  const s2 = [G(1, 'p1', 'p1', '1 - 0', HOLD1), G(2, 'p2', 'p2', '1 - 1', HOLD2), G(3, 'p1', 'p1', '2 - 1', HOLD1), G(4, 'p2', 'p2', '2 - 2', HOLD2),
    G(5, 'p1', 'p1', '3 - 2', HOLD1), G(6, 'p2', 'p2', '3 - 3', HOLD2), G(7, 'p1', 'p1', '4 - 3', HOLD1), G(8, 'p2', 'p2', '4 - 4', HOLD2),
    G(9, 'p1', 'p2', '4 - 5', HOLD2), G(10, 'p2', 'p1', '5 - 5', ['0 - 15', '0 - 30', '0 - 40', '15 - 40', '30 - 40', '40 - 40', 'A - 40']),
    G(11, 'p1', 'p1', '6 - 5', HOLD1), G(12, 'p2', 'p1', '7 - 5', HOLD1)];
  const s3 = [1, 2, 3, 4, 5, 6].map((i) => G(i, i % 2 ? 'p1' : 'p2', 'p1', `${i} - 0`, HOLD1));
  const fin = { sets: [{ p1: 5, p2: 7 }, { p1: 7, p2: 5 }, { p1: 6, p2: 0 }], winner: 'p1' };
  const f = pbpFacts({ sets: [{ games: s1 }, { games: s2 }, { games: s3 }] }, fin);
  assert.deepEqual(f.brokenForMatch, { p1: 0, p2: 1 }); assert.deepEqual(f.brokenForSet, { p1: 0, p2: 0 });
  assert.deepEqual(f.brokenFrom400, { p1: 0, p2: 1 });
  assert.deepEqual(scoreFacts(fin, 'p1'), { fromSetDown: true, tiebreakSets: [] });
  const t = reportText(card({ finalScore: fin }), 'p1', 'p2', { pbp: f, score: scoreFacts(fin, 'p1') }).text;
  assert.ok(/A\. One came from a set down\./.test(t) && /B\. Two was broken when serving for the match\./.test(t) && /B\. Two was broken from 40-0 up\./.test(t), t);
  assert.ok(!/serving for a set/.test(t), 'no clause for what did not happen');
});
await ok('pbp: tiebreak sets from the final score; a tied longest run names nobody; a run under 4 is not printed', () => {
  assert.deepEqual(scoreFacts({ sets: [{ p1: 7, p2: 6 }, { p1: 6, p2: 7 }, { p1: 6, p2: 3 }] }, 'p1').tiebreakSets, [{ set: 1, winner: 'p1' }, { set: 2, winner: 'p2' }]);
  const base = { bp: { p1: null, p2: null }, brokenForMatch: { p1: 0, p2: 0 }, brokenForSet: { p1: 0, p2: 0 }, brokenFrom400: { p1: 0, p2: 0 }, opening: null };
  assert.ok(!/in a row/.test(reportText(card(), 'p1', 'p2', { pbp: { ...base, longestRun: { side: null, n: 5 } } }).text));
  assert.ok(!/in a row/.test(reportText(card(), 'p1', 'p2', { pbp: { ...base, longestRun: { side: 'p1', n: 3 } } }).text));
  // founder 2026-11-12: a run is printed only with its turning point (from behind, after being broken, the end of the match) or at 7+
  assert.ok(!/in a row/.test(reportText(card(), 'p1', 'p2', { pbp: { ...base, longestRun: { side: 'p1', n: 4 } } }).text));
  assert.ok(/A\. One won 4 games in a row from 1-3 down in the first set\./.test(reportText(card(), 'p1', 'p2', { pbp: { ...base, longestRun: { side: 'p1', n: 4, set: 1, from: { me: 1, opp: 3 } } } }).text));
  assert.ok(/A\. One won 7 games in a row\./.test(reportText(card(), 'p1', 'p2', { pbp: { ...base, longestRun: { side: 'p1', n: 7 } } }).text));
});
await ok('strictGame: deuce cycles pass; a list not ending on the winner\'s game point fails', () => {
  assert.equal(strictGame(G(1, 'p1', 'p1', '1 - 0', ['15 - 0', '30 - 0', '40 - 0'])).ok, true);
  assert.equal(strictGame(G(1, 'p1', 'p2', '0 - 1', ['15 - 0', '30 - 0', '40 - 0'])).ok, false);
  assert.equal(strictGame(G(1, 'p1', 'p1', '1 - 0', ['15 - 0', '30 - 0', '40 - 0', '30 - 0', '40 - 0'])).ok, false, 'the feed\'s replayed tail');
});
await ok('score and round helpers', () => {
  assert.equal(winnerScore(card({ finalScore: { sets: [{ p1: 3, p2: 6 }, { p1: 6, p2: 7 }], winner: 'p2' } }), 'p2'), '6-3, 7-6');
  assert.equal(roundWords('ATP Stockholm - 1/16-finals'), 'round of 32'); assert.equal(roundWords('ATP X - Odd Round'), 'Odd Round');
});

await ok('status: walkover, retirement, qualifier and lucky loser from the board alone', () => {
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
await ok('status: a main-draw final is not a qualifying final; no lucky loser without a main-draw card', () => {
  const s = statusItems([card({ id: 'past-20', tournamentRound: 'ATP X - Final' }), card({ id: 'past-21', qualifying: true, tournamentRound: 'ATP X - Final', p1Key: 8, p2Key: 9 })],
    { ek: (m) => m.id.split('-')[1], startIso: () => null, tournament: 'X', base: 'https://x' });
  assert.deepEqual(s.map((x) => x.id), ['status-q-21']);
});

const SRC = 'Rune won. “It’s special coming back to Stockholm after last year,” said Rune. “It’s such a nice court.”';
await ok('verbatim: the exact words pass; typography alone may differ', () => {
  assert.ok(verbatimIn("It's special coming back to Stockholm after last year,", SRC));
});
await ok('verbatim: one changed, dropped or added word fails (never repaired)', () => {
  assert.ok(!verbatimIn("It's special to come back to Stockholm after last year,", SRC));
  assert.ok(!verbatimIn("It's special coming back to Stockholm", '“It’s special coming back here”'));
  assert.ok(!verbatimIn("It is special coming back to Stockholm after last year,", SRC));
  assert.ok(!verbatimIn('nice court', SRC), 'a fragment under 12 characters is not a quote');
});
await ok('verbatim: two spans must each be found; a paraphrase joining them fails as one string', () => {
  assert.ok(!verbatimIn("It's special coming back to Stockholm after last year, It's such a nice court.", SRC));
});

await ok('translation check: same sentence count, every name and number must exist in the original', () => {
  const it = 'Sono molto contento di essere a Stoccolma. Ho giocato bene contro Samuel, soprattutto nel secondo set.';
  assert.equal(translationOk(it, "I'm very happy to be here. I played well against Samuel, especially in the second set.").ok, true);
  assert.match(translationOk(it, 'I am very happy. I played well. Especially in the second set against Samuel.').reason, /sentence count 2 -> 3/);
  assert.match(translationOk(it, 'I am very happy to be here. I played well against Bergs, especially in the second set.').reason, /name "Bergs"/);
  assert.match(translationOk(it, 'I am very happy to be here. I played well against Samuel, winning 6 games in a row.').reason, /number "6"/);
  assert.equal(translationOk(it, '').ok, false);
  assert.equal(sentenceCount('Uno. Due! Tre?'), 3);
});
await ok('translation: no key means no call and no text (never a browser-side or guessed translation)', async () => {
  let called = 0;
  const r = await translateQuote('Hola.', 'es', '', async () => { called++; return { ok: true, json: async () => ({}) }; });
  assert.deepEqual(r, { status: 'no-key', text: null }); assert.equal(called, 0);
});
await ok('translation: a model answer that fails the check is dropped, not repaired', async () => {
  const fake = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'I beat Federer 6-0.' }] }) });
  const r = await translateQuote('He jugado bien.', 'es', 'k', fake);
  assert.equal(r.status, 'failed-check'); assert.equal(r.text, null);
});

const ENT = new Map([['437', 'H. Rune'], ['388', 'J. M. Cerundolo'], ['9', 'F. Cerundolo'], ['1', 'A. Davidovich Fokina']]);
await ok('player match: surname or full name -> exactly one entrant; namesakes need the initial', () => {
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
await ok('quotes: a named speaker in the paragraph, or an open quote carried on; "the 23-year-old" names nobody', () => {
  const g = candidatesFromArticle({ url: 'https://x/a', html: HTML, sourceName: 'X' });
  assert.equal(g.unnamed, 1); assert.equal(g.day, '2026-11-10');
  assert.deepEqual(g.candidates.map((c) => c.speaker), ['Rune', 'Norrie', 'Norrie']);
  for (const c of g.candidates) for (const s of c.spans) assert.ok(verbatimIn(s, c.sourceText), s);
  assert.ok(g.candidates.every((c) => c.sourceUrl === 'https://x/a'));
});
await ok('quotes: speakerOf never reads a name from inside the quotation', () => {
  assert.equal(speakerOf('“Musetti said he was fine and I agree with that view,” the coach told reporters.'), null);
});
await ok('quotedSpans ignores short fragments', () => { assert.deepEqual(quotedSpans('He called it "tough" and "a really long and difficult day for me".'), ['a really long and difficult day for me']); });
await ok('robots: a disallowed path is skipped, others are not', () => {
  const R = 'User-agent: *\nDisallow: /sitecore/\nDisallow: */ajax/*\n\nUser-agent: Other\nDisallow: /';
  assert.ok(robotsDisallows(R, '/sitecore/x')); assert.ok(robotsDisallows(R, '/en/ajax/y')); assert.ok(!robotsDisallows(R, '/en/tournament/nyheter/a'));
});

await ok('the committed sample: every item has the brief\'s fields and a source URL; no quote text unless verified', () => {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'news-sample.json'), 'utf8'));
  assert.ok(d.items.length > 0 && d.sample === true);
  for (const x of d.items) {
    for (const k of ['id', 'type', 'playerId', 'tournament', 'category', 'text', 'sourceName', 'sourceUrl', 'language']) assert.ok(x[k], `${x.id}: ${k}`);
    assert.ok(['quote', 'report', 'status', 'commentary'].includes(x.type)); assert.equal(typeof x.translated, 'boolean'); assert.ok('opponentId' in x && 'timestamp' in x);
    if (x.type === 'quote') assert.equal(x.verbatimCheck, 'passed');
    assert.ok(['scheduled', 'observed', 'article date'].some((k) => String(x.timestampKind).startsWith(k)), `${x.id}: timestamp label`);
    if (x.type === 'report') assert.ok(!/rating|commentary|\bNaN\b|undefined|null/i.test(x.text), x.text);
  }
  assert.equal(new Set(d.items.map((x) => x.id)).size, d.items.length);
  assert.equal(d.counts.reports, d.counts.played, 'one report per played main-draw match');
});
console.log(`news ticker sample: ${n} checks passed`);
