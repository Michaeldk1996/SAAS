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
import { factSheet, checkComposed, composeReport, assemble, setStory, tiebreakScores, pathLines, physicalParagraph, matchQuotes, roundCode, noCommaBefore, COMPOSE_VERSION } from './news-ticker/compose.mjs';

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
await ok('the sheet carries the result, the breaks in playing order, both box scores, the per-set numbers, the shot numbers and the way to the final', () => {
  const t = SHEET.text;
  for (const s of ['Fritz beat Musetti 6–4, 6–2 in the SF.', 'First set: Fritz won it 6–4.', 'Fritz broke for 2–1.', 'Fritz broke for 2–1 (he needed 2 break points in that game).', 'Fritz broke for 4–1.',
    'Fritz in the second set: 2 aces, 0 double faults, first serve in 83%', 'Fritz: serve quality 9.4, 41% unreturned serves, return quality 7.3', 'Next for Fritz: Tirante in the final.',
    'Fritz earlier this week, in order: beat Norrie in straight sets (the round of 16); walkover from Rune, no match played (the QF).', 'Fritz has not dropped a set this week.', 'Tirante this week, in order: beat Tabilo in straight sets (the SF).', 'Fritz: 13 forehand winners, 6 backhand winners.', 'Musetti: 7 forehand winners, 2 backhand winners.']) yes(t.includes(s), `missing: ${s}`);
  yes(!/dominance ratio|performance rating/.test(t), 'the closing-line figures are not sheet facts');
  yes(/(best shot of Fritz|Fritz did most of his damage with the forehand|forehand of Fritz made the difference|winners of Fritz came from the forehand|forehand was the big weapon of Fritz)/.test(t), 'the forehand of Fritz is named (13 to 6), in one of the wordings');
  yes(!/(of|with the) Musetti|Musetti (did|missed|played)|backhand of|errors of Fritz|all or nothing/.test(t.split('## SHOT NUMBERS')[1].split('##')[0].replace(/^Musetti: .*$/gm, '')), 'no best shot under 10 winners, no weak side under 12 errors');
  eq(check(GOOD.replace('and that was enough to take it', 'and his forehand did the damage with 13 forehand winners')).failures, [], 'the forehand may be named when the sheet names it');
});
await ok('a point log that does not add up to the final score gives no playing-order lines (never half a story)', () => {
  const bad = JSON.parse(JSON.stringify(FX.pbp)); bad.sets[0].games.pop();
  eq(setStory(bad, M), []);
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
  refuses(GOOD.replace('Fritz beat Musetti 6–4, 6–2 in the SF to reach the final.', 'Fritz beat Musetti in straight sets to reach the final.'), /first sentence does not give the score/);
  refuses(GOOD.replace('Fritz won it with his serve.', 'Fritz served well. Musetti did not. That was it.'), /very short sentences in a row/);
  refuses(GOOD.replace('He ended with a 9.4 serve quality', 'He had 71% of first serves in, won 81% and 77% behind first and second serve, had 41% unreturned serves and a 9.4 serve quality'), /percentages and quality figures/);
});
await ok('the week of a player is told without scores, in order; a walkover that was not his last round does not make him fresh', () => {
  const t = pathLines(FX.cards.find((c) => c.id === 'past-12179750'), 'p2', FX.cards, rc, false).join('\n');
  yes(t.includes('Next for Tirante: Fritz in the final.') && t.includes('Fritz this week, in order: beat Norrie in straight sets (the round of 16); walkover from Rune, no match played (the QF); beat Musetti in straight sets (the SF).'), t);
  yes(t.includes('The walkover of Fritz was not his last round: he played after it, so it does not make him fresher.') && t.includes('Fritz has not dropped a set this week.'), t);
  yes(!/\d–\d/.test(t), 'no score in the week lines');
  const cards = FX.cards.filter((c) => c.id !== 'past-12179838');   // without his semi-final, the walkover IS his last round
  yes(pathLines(FX.cards.find((c) => c.id === 'past-12179750'), 'p2', cards, rc, false).join(' ').includes('The last round of Fritz was the walkover: he did not play that day.'));
});
await ok('the physical paragraph: where in the set, the pattern across rounds, a changing opener, never a reason we do not have', () => {
  const T = FX.cards.find((c) => c.id === 'past-12179750');
  const row = (g) => [{ calledAt: '2026-11-13T14:10:19+00:00', player: 'Thiago Agustin Tirante', playerSide: 1, games: g, retired: false }];
  const one = physicalParagraph(T, row([[7, 1], [5, 2]]), { winner: 'p2' });
  yes(one.sentences.join(' ').includes('He called the physio early in the second set.') && one.sentences.includes('We do not know the reason yet.'), one.sentences.join(' '));
  const two = physicalParagraph(T, row([[7, 1], [5, 2]]), { winner: 'p2', earlier: { p2: [{ rows: [] }, { rows: row([[7, 2], [6, 3]]) }] } });
  yes(two.sentences.join(' ').includes('He called the physio early in the second set, his second medical timeout in two matches.'), two.sentences.join(' '));
  yes(two.facts[0].includes('his second medical timeout in two matches') && two.facts[0].includes('nothing confirms a physical problem') && two.facts[0].includes('already his second medical timeout this week') && one.facts[0].includes('mention the medical timeout in a few words') && !one.facts[0].includes('already'), two.facts[0]);
  // founder 2026-11-14: a timeout is something to follow, never "he did not look 100%" unless it is confirmed
  for (let i = 0; i < 40; i++) yes(!/100%|worry|question mark/.test(physicalParagraph({ ...T, id: 'past-' + i }, row([[7, 1], [5, 2]]), {}).sentences.join(' ')), 'no assumption in the opener');
  const said = physicalParagraph(T, row([[7, 1], [5, 2]]), { winner: 'p2', seen: 'Tirante was struggling with his back and needed treatment in the second set.' });
  eq(said.sentences[0], 'Tirante did not look 100%.'); yes(!said.facts[0].includes('nothing confirms'));
  yes(!/100%/.test(physicalParagraph(T, row([[7, 1], [5, 2]]), { seen: 'Tabilo needed treatment on his back.' }).sentences.join(' ')), 'what was seen about the OTHER player confirms nothing');
  yes(!physicalParagraph(T, row([[7, 1], [5, 2]]), { winner: 'p2', earlier: { p2: [{ rows: row([[7, 2], [6, 3]]) }, { rows: [] }] } }).sentences.join(' ').includes('in two matches'), 'a match without a timeout in between ends the pattern');
  eq(physicalParagraph(T, [], {}).sentences, []);
  const openers = new Set(); for (let i = 0; i < 40; i++) openers.add(physicalParagraph({ ...T, id: 'past-' + i }, row([[7, 1], [5, 2]]), {}).sentences[0]);
  yes(openers.size >= 3, `the opener changes from report to report (${openers.size})`);
  yes(/late in the first set/.test(physicalParagraph(T, row([[5], [6]]), {}).sentences.join(' ')) && /in the middle of the first set/.test(physicalParagraph(T, row([[3], [2]]), {}).sentences.join(' ')));
});
await ok('refuses first person, a named source, an initial, a question, markdown and a missing "All in all"', () => {
  refuses(GOOD.replace('The second set was a different Fritz:', 'I think the second set was a different Fritz:'), /first person/);
  refuses(GOOD.replace('He ended with', 'According to the data he ended with'), /names a source/);
  refuses(GOOD.replace('Fritz beat Musetti', 'Fritz beat L. Musetti'), /initial/);
  refuses(GOOD.replace('Fritz won it with his serve.', 'Did Fritz win it with his serve?'), /question mark/);
  refuses(GOOD.replace('The first set was', '**The first set** was'), /markdown/);
  refuses(GOOD.replace('All in all, a', 'In short, a'), /All in all/);
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
  const writer = async (sheet) => { calls++; const mine = sheet.text.includes('Fritz beat Musetti'); return { status: 'ok', model: 'test', text: mine ? (${JSON.stringify(mode)} === 'bad' ? ${JSON.stringify(GOOD.replace('9.4', '9.6'))} : ${JSON.stringify(GOOD)}) : 'x' }; };
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
await ok('new facts (a later quote) write the report again, but never after the fresh window', () => {
  const d = mk(); run(d, '2026-11-13T19:00:00.000Z', 'good');
  const q = { ...FX.quotes[0], id: 'quote-new', text: 'This is a new sentence he said about the match afterwards, long enough to count.' };
  fs.writeFileSync(path.join(d, 'news-quotes', '1681-2026.json'), JSON.stringify({ items: FX.quotes.concat(q) }));
  yes(run(d, '2026-11-13T20:00:00.000Z', 'good').calls >= 1, 'inside the window: written again');
  eq(item(d, '12179838').composed.runs, 2);
  fs.writeFileSync(path.join(d, 'news-quotes', '1681-2026.json'), JSON.stringify({ items: FX.quotes.concat(q, { ...q, id: 'quote-newer', text: 'And yet another sentence that arrived days later, also long enough to count here.' }) }));
  const late = run(d, '2026-11-16T20:00:00.000Z', 'good');
  eq(item(d, '12179838').composed.runs, 2, 'after 36 hours the text is frozen');
});

await ok('a run writes at most NEWS_COMPOSE_MAX_CALLS reports and keeps 2 of them for fresh matches (the rest wait for the next run)', () => {
  const d = mk();
  eq(run(d, '2026-11-13T19:00:00.000Z', 'good', '1').calls, 1, 'three finished matches, one slot');
  const e = mk();   // five days later every match is old: with 2 slots, both are kept for fresh matches
  eq(run(e, '2026-11-18T19:00:00.000Z', 'good', '2').calls, 0);
});

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
