#!/usr/bin/env node
// News ticker — the full match report written from the fact sheet (tools/news-ticker/compose.mjs).
// The fixture is a real match frozen from the live site (Stockholm 2026 SF, Fritz d. Musetti). The model is replaced by
// a writer function, so the tests measure OUR part: what goes on the fact sheet, and what the check lets through.
// Every "refuses" test is a mutant of a text that passes: the check must turn red on exactly that change.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { styleEarned, occasionLines, factSheet, checkComposed, composeReport, assemble, setStory, tiebreakScores, pathLines, physicalParagraph, matchQuotes, roundCode, noCommaBefore, COMPOSE_VERSION } from './news-ticker/compose.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/news-compose/stockholm-sf.json'), 'utf8'));
let pass = 0, failed = 0;
const ok = async (name, fn) => { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e && e.message || e).split('\n').join('\n       ')); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'not equal'}\n got  ${JSON.stringify(a)}\n want ${JSON.stringify(b)}`); };
const yes = (c, m) => { if (!c) throw new Error(m || 'expected true'); };

const M = FX.cards.find((c) => c.id === 'past-12179838'), w = 'p1', l = 'p2';
const rc = (c) => roundCode(String(c.tournamentRound).split(' - ').pop().trim().toLowerCase().replace('1/8-finals', 'round of 16'));
const QUOTES = matchQuotes(M, '12179838', FX.quotes);
const SHEET = factSheet({ m: M, w, l, rep: null, shard: FX.pbp, round: 'semi-finals', card: FX.card, quotes: QUOTES, path: pathLines(M, w, FX.cards, rc, false) });
const SUR = new Set(['sinner', 'alcaraz', 'fritz', 'musetti', 'tirante']);
const GOOD = `Fritz beat Musetti 6–4, 6–2 in the SF to reach the final. It was a very convincing win in straight sets.

The first set was decided by one break. Fritz broke for 2–1 and that was enough to take it. The second set was a different Fritz: he broke for 2–1 and again for 4–1 and made only 1 unforced error in the whole set (!!!). He explained it himself: "I just lost to Lorenzo in a final not too long ago, so I knew I had to change a lot of things and play a certain type of way. I executed what I wanted to do really well."

Fritz won it with his serve. He ended with a 9.4 serve quality and Musetti could do almost nothing on return.

All in all, a very dominant performance from Fritz. Next is Tirante in the final, who has dropped 1 set this week.`;
const check = (t) => checkComposed(t, SHEET, { surnames: SUR });
const refuses = (t, re) => { const c = check(t); yes(!c.ok, 'the text passed'); yes(c.failures.some((f) => re.test(f)), `no failure matching ${re}: ${c.failures.join(' | ')}`); };

console.log('fact sheet');
await ok('the sheet carries the result, the breaks in playing order, both box scores, the shot numbers, the conditions and the next opponent; no per-set numbers, no week recap, no head to head', () => {
  const t = SHEET.text;
  for (const s of ['Fritz beat Musetti 6–4, 6–2 in the SF.', 'First set: Fritz won it 6–4.', 'Fritz broke for 2–1.', 'Fritz broke for 2–1 (he needed 2 break points in that game).', 'Fritz broke for 4–1.',
    'Fritz: serve quality 9.4, 41% unreturned serves, return quality 7.3', 'Next for Fritz: Tirante in the final.',
    'Fritz: 13 forehand winners, 6 backhand winners.', 'Musetti: 7 forehand winners, 2 backhand winners.']) yes(t.includes(s), `missing: ${s}`);
  yes(!/Performance rating of Musetti/.test(t), 'only the winner\'s rating, and only when it stands out (9.0 or more)');
  // founder 2026-11-15: a dominance ratio may be used when it really stands out (2.10 here)
  yes(/## SUMMARY FIGURES THAT STAND OUT[^\n]*\nDominance ratio: Fritz 2\.10, Musetti 0\.48[^\n]*\nPerformance rating of Fritz: 9\.4 out of 10/.test(t), 'a standout dominance ratio and performance rating are on the sheet');
  // founder 2026-11-15: "use it once in a while": asked for in about half of the reports that have one
  { const n = [...Array(40).keys()].filter((i) => /use the (performance rating|dominance ratio) from the SUMMARY FIGURES/.test(factSheet({ m: { ...M, id: 'past-d' + i }, w, l, rep: null, card: FX.card }).text)).length; yes(n >= 10 && n <= 30, `asked for in ${n} of 40`); }
  // founder 2026-11-15: what was not good in the winner's match is said
  { const bad = factSheet({ m: { ...M, matchStats: { p1: { ...M.matchStats.p1, 'Points:Unforced errors': 54, 'Points:Winners': 47, 'Service:Double Faults': 7 }, p2: M.matchStats.p2 } }, w, l, rep: null }).text;
    yes(/## NOT GOOD IN THE WINNER'S MATCH[^\n]*\nFritz made 54 unforced errors against 47 winners\.\nFritz made 7 double faults\./.test(bad), bad.split('## BOX')[0].slice(-300)); yes(!/NOT GOOD IN THE WINNER/.test(t), 'a clean match has no such section'); }
  yes(!/SUMMARY FIGURES/.test(factSheet({ m: { ...M, matchStats: { p1: { ...M.matchStats.p1, 'Points:Return Points Won': 38, 'Points:Service Points Won': 66 }, p2: M.matchStats.p2 } }, w, l, rep: null }).text), 'an ordinary one is not');
  // founder 2026-11-15: never a figure per set, no recap of the week, head to head only in a big rivalry
  yes(!/in the (first|second) set: \d+ aces/.test(t) && !/this week/.test(t) && !/[Hh]ead.to.head|first meeting/.test(t), 'per-set numbers, a week recap or a head to head is on the sheet');
  yes(/## CONDITIONS\n/.test(t), 'every sheet says what the conditions are');
  yes(/(best shot of Fritz|Fritz did most of his damage with the forehand|forehand of Fritz made the difference|winners of Fritz came from the forehand|forehand was the big weapon of Fritz)/.test(t), 'the forehand of Fritz is named (13 to 6), in one of the wordings');
  yes(!/(of|with the) Musetti|Musetti (did|missed|played)|backhand of|errors of Fritz|all or nothing/.test(t.split('## SHOT NUMBERS')[1].split('##')[0].replace(/^Musetti: .*$/gm, '')), 'no best shot under 10 winners, no weak side under 12 errors');
  eq(check(GOOD.replace('and that was enough to take it', 'and his forehand did the damage with 13 forehand winners')).failures, [], 'the forehand may be named when the sheet names it');
});
await ok('a run of games is told inside its set, never across two sets; the style is on the sheet only when the numbers of the match show it', () => {
  // founder 2026-11-15: "talk about the set, he won 5 games in a row to win 6–1"
  yes(SHEET.text.includes('Fritz won 5 games in a row in this set.'), SHEET.text.split('## WHAT')[0]);
  yes(!/games in a row from|\d games in a row in the match/.test(SHEET.text), 'no run counted across sets');
  // founder 2026-11-15: "don't always give the archetype, just do it once it's needed and the stats really show it"
  const st = (o) => ({ 'Service:1st serve points won': 70, 'Service:Aces': 5, 'Points:Winners': 20, 'Points:Unforced errors': 25, 'Points:Return Points Won': 38, ...o });
  // "really confirmed": two things in the numbers, not one
  yes(styleEarned('big server', st({ 'Service:1st serve points won': 85, 'Service:Aces': 12 }), st({})) && !styleEarned('big server', st({ 'Service:1st serve points won': 85 }), st({})) && !styleEarned('big server', st({}), st({})), 'big server: a high first-serve figure AND aces');
  yes(styleEarned('attacking baseliner', st({ 'Points:Winners': 40 }), st({})) && !styleEarned('attacking baseliner', st({ 'Points:Winners': 28 }), st({})), 'attacking baseliner: only with clearly more winners than errors');
  yes(styleEarned('counterpuncher', st({ 'Points:Unforced errors': 12, 'Points:Return Points Won': 42 }), st({ 'Points:Unforced errors': 30 })) && !styleEarned('counterpuncher', st({ 'Points:Unforced errors': 76, 'Points:Return Points Won': 45 }), st({ 'Points:Unforced errors': 69 })), 'counterpuncher: never with more errors than the opponent');
  const withStyle = (ms, id) => factSheet({ m: { ...M, id, matchStats: ms }, w, l, rep: null, shard: FX.pbp, round: 'semi-finals', styles: { p1: 'big server + complete baseliner', p2: 'all court elite' } }).text;
  const big = { p1: st({ 'Service:1st serve points won': 85, 'Service:Aces': 12, 'Points:Winners': 30 }), p2: st({}) };
  const named = [...Array(40).keys()].map((i) => withStyle(big, 'past-s' + i)).filter((t) => /Playing style of Fritz: big server \+ complete baseliner/.test(t));
  // named in a part of the reports that earn it: only when the ending of that report is built on it
  yes(named.length >= 2 && named.length <= 25, `the style is on ${named.length} of 40 sheets that earn it`);
  yes(named.every((t) => /build it on his style of play/.test(t)) && !/Playing style of Musetti/.test(named.join(' ')), 'only with an ending built on it, never the loser\'s');
  yes([...Array(20).keys()].every((i) => !/Playing style|style of play/.test(withStyle({ p1: st({}), p2: st({}) }, 'past-n' + i))), 'an ordinary day: no style on the sheet and no ending built on it');
  yes(SHEET.text.includes('The next opponent: ') && SHEET.text.includes('The quote is introduced through '), 'the next-opponent clause and the quote lead-in vary too');
});
await ok('context and variety (founder 2026-11-15): where the match stands after each set, the match time only when it is the story, R4, a shape per report', () => {
  yes(SHEET.text.includes('  After this set: Fritz leads by a set and is one set away from winning the match.') && SHEET.text.includes('  After this set: Fritz wins the match.'), SHEET.text.split('## WHAT')[0]);
  const sheet = (o) => factSheet({ m: M, w, l, rep: null, shard: FX.pbp, round: 'semi-finals', quotes: QUOTES, ...o });
  yes(!/Match time/.test(sheet({ duration: 95 }).text), 'an ordinary 1h35 is not told');
  yes(/Match time: 63 minutes \(63 minutes; it is part of the story/.test(sheet({ duration: 63 }).text) && /Match time: 3 hours 05/.test(sheet({ duration: 185 }).text), 'a very short or a very long match is');
  yes(!/Match time/.test(sheet({}).text) && !/\[time\]/.test(sheet({}).text), 'no time on file: no line, and no opening shape that needs one');
  yes(!sheet({}).long && !/LONG REPORT/.test(sheet({}).text), 'straight sets: the normal length');
  const five = { ...M, finalScore: { ...M.finalScore, sets: [{ p1: 6, p2: 7 }, { p1: 6, p2: 1 }, { p1: 6, p2: 3 }, { p1: 1, p2: 6 }, { p1: 7, p2: 6 }], display: '6-7(5), 6-1, 6-3, 1-6, 7-6(7)' } };
  const f5 = factSheet({ m: five, w, l, rep: null, round: 'round of 16', bestOf: 5 });
  yes(f5.long && /LONG REPORT/.test(f5.text) && f5.text.includes('in R4.'), f5.text.slice(0, 300));
  yes(/in the round of 16\./.test(factSheet({ m: M, w, l, rep: null, round: 'round of 16' }).text), 'R4 is a Grand Slam word only');
  // the shape changes from match to match and never asks for a fact the sheet lacks
  const shapes = new Set(); for (let i = 0; i < 30; i++) { const t = factSheet({ m: { ...M, id: 'past-' + i }, w, l, rep: null, shard: FX.pbp, round: 'semi-finals' }).text.split('## SHAPE OF THIS REPORT')[1].split('##')[0]; shapes.add(t); yes(!/WHAT IT MEANS|style of play|doubt that stays|own words/.test(t), 'a shape that needs a missing fact: ' + t); }
  yes(shapes.size >= 10, `only ${shapes.size} different shapes in 30 matches`);
  yes(/What it means|WHAT IT MEANS/.test([...Array(40).keys()].map((i) => factSheet({ m: { ...M, id: 'past-m' + i }, w, l, rep: null, round: 'semi-finals', milestones: ['Fritz reaches his first tour-level final in our records.'] }).text.split('## SHAPE')[1]).join(' ')), 'a milestone on the sheet is offered as an opening or an ending');
});
await ok('a point log with one set that does not add up: that set gets its score only, the sets that add up are still told', () => {
  const bad = JSON.parse(JSON.stringify(FX.pbp)); bad.sets[0].games.pop();
  const t = setStory(bad, M);
  eq(t[0], 'First set: Fritz won it 6–4.'); eq(t[1], '  After this set: Fritz leads by a set and is one set away from winning the match.'); yes(t[2].startsWith('Second set:'), 'nothing is told about the broken set but its score and where the match stands');
  yes(t.some((x) => x.includes('Fritz broke for 4–1')), 'the complete set keeps its story');
  eq(setStory({ ...bad, sets: bad.sets.slice(0, 1) }, M), [], 'a log with the wrong number of sets gives nothing');
  yes(setStory(FX.pbp, M).length >= 5);
});
await ok('set points and serving for a set come from the point scores (synthetic set: the server is broken at 5–3 after 3 set points)', () => {
  const g = (n, server, winner, score, pts) => ({ g: n, server, winner, score, points: pts.map((s, i) => ({ n: i + 1, s })) });
  const hold = ['15 - 0', '30 - 0', '40 - 0'], holdB = ['0 - 15', '0 - 30', '0 - 40'];
  const games = [g(1, 'p1', 'p1', '1 - 0', hold), g(2, 'p2', 'p2', '1 - 1', holdB), g(3, 'p1', 'p1', '2 - 1', hold), g(4, 'p2', 'p2', '2 - 2', holdB), g(5, 'p1', 'p1', '3 - 2', hold), g(6, 'p2', 'p1', '4 - 2', ['15 - 0', '30 - 0', '40 - 0']),
    g(7, 'p1', 'p1', '5 - 2', hold), g(8, 'p2', 'p2', '5 - 3', holdB), g(9, 'p1', 'p2', '5 - 4', ['15 - 0', '30 - 0', '40 - 0', '40 - 15', '40 - 30', '40 - 40', '40 - A']), g(10, 'p2', 'p2', '5 - 5', holdB),
    g(11, 'p1', 'p1', '6 - 5', hold), g(12, 'p2', 'p1', '7 - 5', ['15 - 0', '30 - 0', '40 - 0'])];
  const m = { p1: 'A. Alpha', p2: 'B. Beta', finalScore: { display: '7-5', sets: [{ p1: 7, p2: 5 }], winner: 'p1' } };
  const s = setStory({ sets: [{ games }] }, m).join('\n');
  yes(s.includes('Beta saved 3 set points with Alpha leading 5–3 (Alpha serving).'), s);
  yes(s.includes('Beta broke for 4–5 (Alpha was serving for the set).'), s);
  yes(s.includes('Alpha broke for 7–5 (that game won him the set).'), s);
  // founder 2026-11-15: a point saved in a game he then lost anyway is not told
  const lost = games.slice(0, 11).concat(g(12, 'p2', 'p1', '7 - 5', ['15 - 0', '30 - 0', '40 - 0', '40 - 15', '40 - 30', '40 - 40', 'A - 40']));
  const told = setStory({ sets: [{ games: lost }] }, m).join('\n');
  yes(!/leading 6–5/.test(told) && told.includes('Beta saved 3 set points with Alpha leading 5–3'), told);
});
await ok('tiebreak scores are read from the final score, from the set winner\'s side', () => eq(tiebreakScores({ display: '7-6(2), 6-7(7), 7-5', sets: [{ p1: 7, p2: 6 }, { p1: 6, p2: 7 }, { p1: 7, p2: 5 }] }), ['7–2', '9–7', null]));
await ok('quotes: only this match, only its two players, the longest version of a quote once', () => {
  yes(QUOTES.length >= 1 && QUOTES.every((q) => q.speaker === 'Fritz'));
  yes(!QUOTES.some((q) => q.text === 'I just lost to Lorenzo in a final not too long ago,'), 'the short copy of a longer quote is dropped');
  eq(matchQuotes(M, '999', FX.quotes), []);
});

console.log('the check');
await ok('a report with only sheet facts passes', () => { const c = check(GOOD); eq(c.failures, []); });
await ok('a possessive is the same name ("Musetti\'s second serve")', () => eq(check(GOOD.replace('Musetti could do almost nothing on return', "Musetti's return did almost nothing")).failures, []));
await ok('refuses a number that is not on the sheet', () => refuses(GOOD.replace('9.4 serve quality', '9.6 serve quality'), /number "9\.6"/));
await ok('refuses a score that is not on the sheet (the same score from the other side passes)', () => { refuses(GOOD.replace('again for 4–1', 'again for 5–1'), /score "5-1"/); eq(check(GOOD.replace('again for 4–1', 'again to lead 4–1 with Musetti at 1–4')).failures, []); });
await ok('refuses a count written as a word when the sheet does not have it (a count the sheet has may be a word)', () => {
  const tiny = { text: 'Alpha beat Beta 6–4 in R1.\nAlpha: 3 aces.', quotes: [], winner: 'Alpha', loser: 'Beta' };
  const f = (t) => checkComposed(t, tiny).failures.filter((x) => /is not on the sheet/.test(x));
  eq(f('Alpha beat Beta. He hit three aces.'), []);
  eq(f('Alpha beat Beta. He hit nine aces.').length, 1);
  eq(f('Alpha beat Beta. He saved two break points.').length, 1);
  eq(check(GOOD.replace('only 1 unforced error', 'only one unforced error')).failures, []);
});
await ok('refuses a player who is not on the sheet, inside a sentence and at its start', () => { refuses(GOOD.replace('Next is Tirante', 'Next is Sinner'), /"Sinner"/); refuses(GOOD.replace('Next is Tirante in the final', 'Alcaraz is waiting for him now. Next is Tirante in the final'), /"Alcaraz"/); });
await ok('a sentence that starts after a closing quotation mark is a sentence start, not an unknown name (measured 2026-11-15: "Nobody" cost a paid retry)', () => {
  const tiny = { text: 'Alpha beat Beta 6–4 in R1.', quotes: [], winner: 'Alpha', loser: 'Beta' };
  const f = (t) => checkComposed(t, tiny).failures.filter((x) => /is not on the sheet/.test(x));
  eq(f('Alpha beat Beta. He said it was "a hard day." Nobody broke after that.'), []);
  eq(f('Alpha beat Beta. He said it was "a hard day." Then Gamma arrived.').length, 1);
});
await ok('refuses a quotation that is not word for word, one cut mid-sentence, and one without its speaker', () => {
  refuses(GOOD.replace('play a certain type of way.', 'play differently.'), /not on the sheet word for word/);
  refuses(GOOD.replace(' so I knew I had to change a lot of things and play a certain type of way. I executed what I wanted to do really well."', ' so I knew I had to change"'), /cut in the middle/);
  refuses(GOOD.replace('He explained it himself: "I just lost to Lorenzo in a final not too long ago, so I knew I had to change a lot of things and play a certain type of way. I executed what I wanted to do really well."', '').replace('Musetti could do almost nothing on return.', 'Musetti could do almost nothing on return.\n\nHe explained it himself: "I executed what I wanted to do really well."'), /speaker/);
});
await ok('refuses a shot, the body or a title that no line of the sheet carries — a quote does not count', () => {
  refuses(GOOD.replace('and that was enough to take it', 'and he hit a great volley to take it'), /"volley"/);
  refuses(GOOD.replace('The second set was a different Fritz:', 'Musetti looked tired in the second set and it was a different Fritz:'), /"tired"/);
  refuses(GOOD.replace('Next is Tirante', 'It would be his first title of the year for sure. Next is Tirante'), /"title"|"year"/);
});
await ok('refuses a comma before "but" or "and" (founder 2026-11-14) — outside a quotation only', () => {
  refuses(GOOD.replace('and that was enough to take it', ', but that was enough to take it'), /comma before "but"/);
  refuses(GOOD.replace('he broke for 2–1 and again for 4–1', 'he broke for 2–1, and again for 4–1'), /comma before "and"/);
});
await ok('a wing with most of the winners AND most of the errors is "all or nothing" / "high risk and high reward", and the wording changes from match to match', () => {
  const card = JSON.parse(JSON.stringify(FX.card)); card.p1.fhWinners = 20; card.p1.bhWinners = 8; card.p1.fhUnforced = 18; card.p1.bhUnforced = 9;
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    const t = factSheet({ m: { ...M, id: 'past-' + i }, w, l, rep: null, card, quotes: [] }).text;
    const line = t.split('\n').find((x) => /all or nothing on the forehand of Fritz|Fritz played high risk and high reward on the forehand/.test(x));
    yes(line, 'the all-or-nothing line'); yes(!/best shot of Fritz|damage with/.test(t), 'not also a plain best-shot line'); seen.add(line.slice(0, 20));
  }
  yes(seen.size === 2, 'both wordings appear across matches');
  const plain = new Set();
  for (let i = 0; i < 30; i++) plain.add(factSheet({ m: { ...M, id: 'past-' + i }, w, l, rep: null, card: FX.card, quotes: [] }).text.split('\n').find((x) => /forehand/.test(x) && /Fritz/.test(x) && !/^Fritz: /.test(x)));
  yes(plain.size >= 4, `the best-shot line has several wordings (${plain.size})`);
});
await ok('the first sentence gives the score; no chain of very short sentences; few stat numbers (founder 2026-11-14)', () => {
  refuses(GOOD.replace('Fritz beat Musetti 6–4, 6–2 in the SF to reach the final.', 'Fritz beat Musetti easily to reach the final.'), /neither the score/);
  // founder 2026-11-15: "you can also say beat him in 5 sets, important to alternate sentences"
  eq(check(GOOD.replace('Fritz beat Musetti 6–4, 6–2 in the SF to reach the final.', 'Fritz beat Musetti in straight sets in the SF to reach the final.')).failures, []);
  refuses(GOOD.replace('Fritz won it with his serve.', 'Fritz served well. Musetti did not. That was it.'), /very short sentences in a row/);
  refuses(GOOD.replace('He ended with a 9.4 serve quality', 'He had 71% of first serves in, won 81% and 77% behind first and second serve, had 41% unreturned serves and a 9.4 serve quality'), /percentages and quality figures/);
});
await ok('the way on is one line: the next opponent, or the title; nobody\'s week is told again', () => {
  const t = pathLines(FX.cards.find((c) => c.id === 'past-12179750'), 'p2', FX.cards, rc, false);
  eq(t, ['Next for Tirante: Fritz in the final.']);
  eq(pathLines(FX.cards.find((c) => c.id === 'past-12179750'), 'p2', FX.cards, rc, true), ['This was the final: Tirante wins the title.']);
});
await ok('physical facts: where in the set, the pattern across rounds, the follow-up of a flagged player, never a reason; no paragraph is added by code', () => {
  const T = FX.cards.find((c) => c.id === 'past-12179750');
  const row = (g) => [{ calledAt: '2026-11-13T14:10:19+00:00', player: 'Thiago Agustin Tirante', playerSide: 1, games: g, retired: false }];
  const one = physicalParagraph(T, row([[7, 1], [5, 2]]), { winner: 'p2' });
  eq(one.sentences, [], 'the writer tells it in one sentence: nothing is added by code');
  yes(one.facts[0].startsWith('Tirante called the physio early in the second set.') && one.facts[0].includes('Never write anything about the reason') && one.facts[0].includes('the doubt before his next match'), one.facts[0]);
  const two = physicalParagraph(T, row([[7, 1], [5, 2]]), { winner: 'p2', earlier: { p2: [{ rows: [] }, { rows: row([[7, 2], [6, 3]]) }] } });
  yes(two.facts[0].startsWith('Tirante called the physio early in the second set, his second medical timeout in two matches.') && two.facts[0].includes('Nothing confirms a physical problem'), two.facts[0]);
  // founder 2026-11-15: "never write the reason is not known"
  for (const f of [...one.facts, ...two.facts]) yes(!/not known|do not know/i.test(f), f);
  const said = physicalParagraph(T, row([[7, 1], [5, 2]]), { winner: 'p2', seen: 'Tirante was struggling with his back and needed treatment in the second set.' });
  yes(!said.facts[0].includes('Nothing confirms'));
  yes(physicalParagraph(T, row([[7, 1], [5, 2]]), { seen: 'Tabilo needed treatment on his back.' }).facts[0].includes('Nothing confirms'), 'what was seen about the OTHER player confirms nothing');
  yes(!physicalParagraph(T, row([[7, 1], [5, 2]]), { winner: 'p2', earlier: { p2: [{ rows: row([[7, 2], [6, 3]]) }, { rows: [] }] } }).facts[0].includes('in two matches'), 'a match without a timeout in between ends the pattern');
  eq(physicalParagraph(T, [], {}).facts, []);
  yes(/late in the first set/.test(physicalParagraph(T, row([[5], [6]]), {}).facts[0]) && /in the middle of the first set/.test(physicalParagraph(T, row([[3], [2]]), {}).facts[0]));
  // the follow-up (founder 2026-11-15): flagged in his previous match here, no timeout now -> one fact saying exactly that
  const f = physicalParagraph(T, [], { winner: 'p2', earlier: { p2: [{ rows: row([[7, 2], [6, 3]]), round: 'the QF' }] } }).facts;
  eq(f.length, 1); yes(f[0].startsWith('Tirante called the physio (a medical timeout) in his previous match here (the QF) and did not call for one in this match.'), f[0]);
  eq(physicalParagraph(T, [], { earlier: { p2: [{ rows: row([[7, 2], [6, 3]]) }, { rows: [] }] } }).facts, [], 'only his PREVIOUS match counts');
});
await ok('how he felt may set up his own quotation; without a quotation it still needs a sheet line', () => {
  eq(check(GOOD.replace('He explained it himself:', 'He was angry at himself and said why:')).failures, []);
  const noQuote = GOOD.replace(/ He explained it himself: "[^"]*"/, ' He was angry at himself.');
  yes(noQuote !== GOOD); refuses(noQuote, /"angry"/);
});
await ok('founder corrections 2026-11-17: the verdict follows the numbers, the occasion is on the sheet, break points are told from where they were saved, a quote may stop at its own ellipsis', () => {
  // a clean dominant win (straight sets, DR 2.10, rating 9.4): called that, with its numbers; never "not perfect"
  const t = factSheet({ m: M, w, l, rep: null, shard: FX.pbp, round: 'semi-finals', card: FX.card }).text;
  yes(/## VERDICT FROM THE NUMBERS\nA clean, dominant win\. [^\n]*a 9\.4 performance rating, a dominance ratio of 2\.10, just 12 unforced errors\./.test(t), t.split('## VERDICT')[1] || 'no verdict');
  yes(!/It was not perfect|what he still has to do better/.test(t), 'no reservation is offered when no number shows a weakness');
  const messy = factSheet({ m: { ...M, matchStats: { p1: { ...M.matchStats.p1, 'Points:Unforced errors': 54, 'Points:Winners': 47 }, p2: M.matchStats.p2 } }, w, l, rep: null }).text;
  yes(!/VERDICT FROM THE NUMBERS/.test(messy) && /NOT GOOD IN THE WINNER/.test(messy), 'a weak point: no "dominant", the weak point is said');
  const ok2 = factSheet({ m: { ...M, matchStats: { p1: { ...M.matchStats.p1, 'Points:Return Points Won': 38, 'Points:Service Points Won': 66 }, p2: M.matchStats.p2 } }, w, l, rep: null }).text;
  yes(/No number shows a weakness in the match of Fritz\. Do not write "it was not perfect"/.test(ok2), 'an ordinary win without a weakness: no "but" either');
  // the occasion: at home, first appearance at a big event, the defending champion
  const mm = { ...M, tour: 'ATP Finals - Turin', venue: { city: 'Turin', country: 'IT' } }, row = (y, round, won) => ({ eventKey: y === 2026 ? 99 : y, tournament: 'Finals - Turin', year: String(y), round, won });
  const occ = occasionLines({ m: mm, w, l, eventKey: 99, countryOf: (k) => (String(k) === String(M.p2Key) ? 'Italy' : 'USA'), hist: { p1: [row(2025, 'Final', true), row(2026, '', true)], p2: [row(2026, '', false)] } });
  eq(occ, ['Fritz is the defending champion here.', 'Musetti was playing at home (Turin is in his own country).', 'It was the first appearance of Musetti at this event in our records.']);
  eq(occasionLines({ m: mm, w, l, eventKey: 99, hist: { p1: [], p2: [] } }), [], 'no profile country and no history: nothing is claimed');
  eq(occasionLines({ m: M, w, l, eventKey: 99, countryOf: () => 'Sweden', hist: { p1: [{ eventKey: 99, tournament: 'Stockholm', year: '2026' }], p2: [] } }).filter((x) => /first appearance/.test(x)), [], 'a debut is told only at a Grand Slam or the Finals');
  // where the break points were saved from
  const g = (n, server, winner, score, pts) => ({ g: n, server, winner, score, points: pts.map((x, i) => ({ n: i + 1, s: x })) });
  const hold = ['15 - 0', '30 - 0', '40 - 0'], holdB = ['0 - 15', '0 - 30', '0 - 40'];
  const games = [g(1, 'p1', 'p1', '1 - 0', hold), g(2, 'p2', 'p2', '1 - 1', ['15 - 0', '30 - 0', '40 - 0', '40 - 15', '40 - 30', '40 - 40', '40 - A']), g(3, 'p1', 'p1', '2 - 1', hold), g(4, 'p2', 'p2', '2 - 2', holdB), g(5, 'p1', 'p1', '3 - 2', hold), g(6, 'p2', 'p2', '3 - 3', holdB), g(7, 'p1', 'p1', '4 - 3', hold), g(8, 'p2', 'p1', '5 - 3', ['15 - 0', '30 - 0', '40 - 0']), g(9, 'p1', 'p1', '6 - 3', hold)];
  const story = setStory({ sets: [{ games }] }, { p1: 'A. Alpha', p2: 'B. Beta', finalScore: { display: '6-3', sets: [{ p1: 6, p2: 3 }], winner: 'p1' } }).join('\n');
  yes(story.includes('Beta saved 3 break points from 0–40 and held for 1–1.'), story);
  // a quote may stop where it has its own ellipsis, and two parts of one quote may be used apart
  const q2 = [{ id: 'q1', speaker: 'Fritz', topic: null, text: 'The knee is fine, I am taking care of it … Today I felt like everything was working for me' }];
  const sh = factSheet({ m: M, w, l, rep: null, shard: FX.pbp, round: 'semi-finals', card: FX.card, quotes: q2, path: pathLines(M, w, FX.cards, rc, false) });
  const two = GOOD.replace(/He explained it himself: "[^"]*"/, 'Fritz afterwards: "Today I felt like everything was working for me"').replace('\n\nAll in all,', '\n\nOn his knee, Fritz said: "The knee is fine, I am taking care of it" Something to follow up.\n\nAll in all,');
  eq(checkComposed(two, sh, { surnames: SUR }).failures, [], 'two parts of one quote, the first stopping at the ellipsis, and "knee" from his own words');
  yes(checkComposed(two.replace('I am taking care of it"', 'I am taking care"'), sh, { surnames: SUR }).failures.some((f) => /cut in the middle|word for word/.test(f)), 'a cut inside a sentence is still refused');
  yes(checkComposed(GOOD.replace('All in all, a', 'His knee looked sore. All in all, a'), SHEET, { surnames: SUR }).failures.some((f) => /"knee"/.test(f)), 'the body in our own words still needs a sheet line');
});
await ok('our read of the match (founder 2026-11-17): how the points compare with the score, serves that did not come back, holds to love, the second serve, the rallies — from our own numbers only', () => {
  const read = (t) => (t.split('## OUR READ OF THE MATCH')[1] || '').split('##')[0];
  const base = read(SHEET.text.replace('', '')), withCard = read(factSheet({ m: M, w, l, rep: null, shard: FX.pbp, round: 'semi-finals', card: FX.card }).text);
  yes(withCard.includes('Fritz held to love 3 times.') && withCard.includes('Fritz did not face a single break point.') && withCard.includes('Fritz won more points than Musetti in the short rallies and in the long ones.'), withCard);
  void base;
  // two 6–4 sets with a dominance ratio of 2.10: the points were more one-sided than the score
  const tight = { ...M, finalScore: { ...M.finalScore, display: '6-4, 6-4', sets: [{ p1: 6, p2: 4 }, { p1: 6, p2: 4 }] } };
  yes(/more one-sided than the score: Fritz won 60% of all points \(dominance ratio 2\.10\)\. You may say the score flattered Musetti\./.test(read(factSheet({ m: tight, w, l, rep: null }).text)), read(factSheet({ m: tight, w, l, rep: null }).text));
  yes(!/more one-sided/.test(read(factSheet({ m: M, w, l, rep: null }).text)), 'a 6–4, 6–2 score already says it');
  // every point against the second serve; a high unreturned figure; the loser kept alive by saved break points
  const ms = JSON.parse(JSON.stringify(M.matchStats)); ms.p1.raw['Return:2nd return points won'] = { won: 12, total: 12 }; ms.p2.raw['Service:Break Points Saved'] = { won: 5, total: 7 };
  const r2 = read(factSheet({ m: { ...M, matchStats: ms }, w, l, rep: null, card: { p1: { ...FX.card.p1, unreturnedPct: 54 }, p2: FX.card.p2 } }).text);
  yes(r2.includes('Fritz won every single point against the second serve of Musetti (12 of 12).') && r2.includes('54% of the serves of Fritz did not come back.') && r2.includes('Musetti kept the score close by saving 5 of 7 break points.'), r2);
  yes(!/did not come back/.test(withCard), '41% unreturned is not a standout');
});
await ok('refuses first person, a named source, an initial, a question, markdown and a missing "All in all"', () => {
  refuses(GOOD.replace('The second set was a different Fritz:', 'I think the second set was a different Fritz:'), /first person/);
  refuses(GOOD.replace('He ended with', 'According to the data he ended with'), /names a source/);
  refuses(GOOD.replace('Fritz beat Musetti', 'Fritz beat L. Musetti'), /initial/);
  refuses(GOOD.replace('Fritz won it with his serve.', 'Did Fritz win it with his serve?'), /question mark/);
  refuses(GOOD.replace('The first set was', '**The first set** was'), /markdown/);
  // founder 2026-11-15: the ending is not always "All in all"
  eq(check(GOOD.replace('All in all, a', 'In the end, a')).failures, []);
});

console.log('the writer loop');
await ok('a text that fails is sent back once with the reasons; a second failure is "failed-check" and nothing is published', async () => {
  const calls = [];
  const r1 = await composeReport(SHEET, { surnames: SUR, writer: async (s, f) => { calls.push(f); return { status: 'ok', text: f ? GOOD : GOOD.replace('9.4', '9.6') }; } });
  eq([r1.status, r1.tries, calls.length], ['ok', 2, 2]); yes(calls[1].some((x) => /9\.6/.test(x)), 'the reasons are sent back');
  const r2 = await composeReport(SHEET, { surnames: SUR, writer: async () => ({ status: 'ok', text: GOOD.replace('9.4', '9.6') }) });
  eq([r2.status, r2.tries, r2.text], ['failed-check', 2, undefined]);
  eq((await composeReport(SHEET, { apiKey: null })).status, 'no-key');
});
await ok('a comma before "but" / "and" is removed by code, never inside a quotation, and the report is then published', async () => {
  eq(noCommaBefore('He broke, but lost. A, B, and C. He said: "yes, and no, but maybe" and left, and won.'), 'He broke but lost. A, B and C. He said: "yes, and no, but maybe" and left and won.');
  const r = await composeReport(SHEET, { surnames: SUR, writer: async () => ({ status: 'ok', text: GOOD.replace('and that was enough to take it', ', but that was enough to take it').replace(' , but', ', but') }) });
  eq([r.status, r.tries], ['ok', 1]); yes(!/, but /.test(r.text.replace(/"[^"]*"/g, '')));
});
await ok('assemble: the physical paragraph goes before the verdict, the closing lines last', () => {
  eq(assemble('A.\n\nB.\n\nAll in all, C.', ['Physically, it is something to follow.', 'X took a medical timeout.'], ['R1', 'R2']), 'A.\n\nB.\n\nPhysically, it is something to follow. X took a medical timeout.\n\nAll in all, C.\n\nR1\n\nR2');
});

console.log('the builder');
const mk = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-'));
  fs.writeFileSync(path.join(d, 'matches.json'), JSON.stringify(Object.fromEntries(FX.cards.map((c, i) => [i, c]))));
  fs.mkdirSync(path.join(d, 'pbp')); fs.writeFileSync(path.join(d, 'pbp', '12179838.json'), JSON.stringify(FX.pbp));
  fs.mkdirSync(path.join(d, 'news-quotes'));
  fs.writeFileSync(path.join(d, 'news-quotes', '1681-2026.json'), JSON.stringify({ items: FX.quotes }));
  fs.writeFileSync(path.join(d, 'news-quotes', 'match-cards.json'), JSON.stringify({ byMatch: { 12179838: FX.card } }));
  fs.writeFileSync(path.join(d, 'player-index.json'), JSON.stringify({ players: [{ name: 'Jannik Sinner' }] }));
  return d;
};
// the writer of the test: GOOD for the fixture match (or BAD when told), an unusable text for every other match
const run = (d, now, mode, max = '6') => JSON.parse(execFileSync('node', ['-e', `import(${JSON.stringify(path.join(ROOT, 'tools/news-ticker/build-news-ticker.mjs'))}).then(async (m) => {
  const fs = require('node:fs'); let calls = 0;
  const writer = async (sheet) => { calls++; const mine = sheet.text.includes('Fritz beat Musetti'); return { status: 'ok', model: 'test', text: mine ? (${JSON.stringify(mode)} === 'bad' ? ${JSON.stringify(GOOD.replace('9.4', '9.6'))} : (sheet.quotes.length ? ${JSON.stringify(GOOD)} : ${JSON.stringify(GOOD.replace(/ He explained it himself: "[^"]*"/, ''))})) : 'x' }; };
  const s = await m.build({ nowIso: ${JSON.stringify(now)}, times: null, apiKey: null, writer: ${JSON.stringify(mode)} === 'off' ? null : writer });
  console.log(JSON.stringify({ calls, composed: s.composed || 0, failed: s.composeFailed || 0, reportsComposed: s.reportsComposed || 0, revised: s.revised, added: s.added }));
})`, '--', '--dir', d], { cwd: d, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: '', NEWS_COMPOSE_MAX_CALLS: max } }).trim().split('\n').pop());
const item = (d, ek) => JSON.parse(fs.readFileSync(path.join(d, 'news-ticker', '1681-2026.json'), 'utf8')).items.find((x) => x.id === 'report-' + ek);

await ok('a report that passes the check is published: the written text, then the closing lines; it is written once', () => {
  const d = mk(), a = run(d, '2026-11-13T19:00:00.000Z', 'good'), it = item(d, '12179838');
  yes(it.text.startsWith('Fritz beat Musetti 6–4, 6–2 in the SF to reach the final.'), it.text.slice(0, 80));
  yes(/\n\nFritz: performance rating 9\.4 \| W: 26 \/ UE: 12 \| DR: 2\.10\n\nMusetti: performance rating 7\.8/.test(it.text), 'closing lines last');
  eq([it.composed.status, it.composed.version, it.composed.runs], ['ok', COMPOSE_VERSION, 1]);
  const b = run(d, '2026-11-13T19:10:00.000Z', 'good');
  eq([b.calls, b.revised, b.added], [0, 0, 0], 'same facts: no second call, nothing revised');
  yes(a.calls >= 2);
});
await ok('a report that fails the check keeps the older report text, and the same facts are not sent again', () => {
  const d = mk(); run(d, '2026-11-13T19:00:00.000Z', 'bad');
  const it = item(d, '12179838');
  yes(it.text.startsWith('Fritz beat Musetti'), it.text.slice(0, 80)); yes(!it.text.includes('9.6'));
  eq(it.composed.status, 'failed-check'); yes(it.composed.failures.some((f) => /9\.6/.test(f)));
  eq(run(d, '2026-11-13T19:10:00.000Z', 'bad').calls, 0);
  const off = mk(); run(off, '2026-11-13T19:00:00.000Z', 'off');
  eq(item(off, '12179838').text, it.text, 'the fallback is exactly the report built with no writer at all');
});
await ok('a report is written ONCE: a later quote never writes it again (founder 2026-11-15)', () => {
  const d = mk(); run(d, '2026-11-13T19:00:00.000Z', 'good');
  const q = { ...FX.quotes[0], id: 'quote-new', text: 'This is a new sentence he said about the match afterwards, long enough to count.' };
  fs.writeFileSync(path.join(d, 'news-quotes', '1681-2026.json'), JSON.stringify({ items: FX.quotes.concat(q) }));
  eq(run(d, '2026-11-13T20:00:00.000Z', 'good').calls, 0, 'a new quote one hour later: no call');
  eq(item(d, '12179838').composed.runs, 1);
});
await ok('before the report is written the item is the result line and the closing lines, with no paid call; at 75 minutes it is written', () => {
  const d = mk();
  const start = Date.parse(`${M.date}T${M.time}:00+01:00`);   // the card's Berlin start (CET in November)
  const early = run(d, new Date(start + 20 * 60000).toISOString(), 'good');
  const it = item(d, '12179838');
  if (it) { yes(!it.composed, 'no report yet'); yes(it.text.split('\n\n').length <= 3 && /performance rating/.test(it.text), it.text); }
  const mineEarly = early.calls;
  const later = run(d, new Date(start + 76 * 60000).toISOString(), 'good');
  yes(later.calls >= 1 && item(d, '12179838').composed && item(d, '12179838').composed.runs === 1, `written at 76 minutes (calls ${mineEarly} then ${later.calls})`);
});
await ok('a report waits for the player\'s words: no quote on file = not written before 300 minutes; written without one, it is written again ONCE when a quote arrives (founder 2026-11-17)', () => {
  const d = mk(), qf = path.join(d, 'news-quotes', '1681-2026.json'), start = Date.parse(`${M.date}T${M.time}:00+01:00`), at = (min) => new Date(start + min * 60000).toISOString();
  fs.writeFileSync(qf, JSON.stringify({ items: FX.quotes.filter((q) => String(q.eventKey) !== '12179838') }));
  run(d, at(120), 'good');
  yes(!item(d, '12179838').composed, 'two hours after the start and no quote: still the result line');
  run(d, at(120 + 300), 'good');
  const first = item(d, '12179838');
  yes(first.composed && first.composed.runs === 1 && !/"/.test(first.composed.body), 'after 300 minutes it is written without a quote');
  eq(run(d, at(120 + 330), 'good').calls, 0, 'nothing new: not written again');
  fs.writeFileSync(qf, JSON.stringify({ items: FX.quotes }));
  run(d, at(120 + 360), 'good');
  const second = item(d, '12179838');
  yes(second.composed.runs === 2 && /"/.test(second.composed.body), 'the quote arrived: written again, now with it');
  fs.writeFileSync(qf, JSON.stringify({ items: FX.quotes.concat({ ...FX.quotes[0], id: 'quote-late', text: 'One more sentence he said about this match a little later, long enough to count.' }) }));
  run(d, at(120 + 420), 'good');
  eq(item(d, '12179838').composed.runs, 2, 'a report that has its quote is never written again');
});
await ok('a report of the older version is written again once while its match is recent, and keeps its published text when it is not', () => {
  const d = mk(); run(d, '2026-11-13T19:00:00.000Z', 'good');
  const f = path.join(d, 'news-ticker', '1681-2026.json'), age = (v, txt) => { const j = JSON.parse(fs.readFileSync(f, 'utf8')); for (const x of j.items) if (x.composed) { x.composed.version = v; if (txt && x.id === 'report-12179838') { x.text = txt; x.baseText = txt; x.composed.body = txt; x.sourceHash = 'old'; } } fs.writeFileSync(f, JSON.stringify(j)); };
  age(COMPOSE_VERSION - 1, 'OLD TEXT as published');
  yes(run(d, '2026-11-14T19:00:00.000Z', 'good').calls >= 1, 'one day later: written again under the new version');
  eq(item(d, '12179838').composed.version, COMPOSE_VERSION); yes(item(d, '12179838').text.startsWith('Fritz beat Musetti'));
  age(COMPOSE_VERSION - 1, 'OLD TEXT as published');
  eq(run(d, '2026-11-20T19:00:00.000Z', 'good').calls, 0, 'a week later: nothing is written, not this report and not the ones that failed before');
  eq(item(d, '12179838').text, 'OLD TEXT as published', 'and the published text stays');
});
await ok('a run writes at most NEWS_COMPOSE_MAX_CALLS reports and keeps 2 of them for fresh matches (the rest wait for the next run)', () => {
  const d = mk();
  eq(run(d, '2026-11-13T19:00:00.000Z', 'good', '1').calls, 1, 'three finished matches, one slot');
  const e = mk();   // five days later every match is old: with 2 slots, both are kept for fresh matches
  eq(run(e, '2026-11-18T19:00:00.000Z', 'good', '2').calls, 0);
});

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
