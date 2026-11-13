// Tennis TV on-court interviews, automatic (tools/news-ticker/ttv-interviews.mjs + .github/workflows/interviews.yml).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveHighlights, pickHighlights, commentaryOk, summariseCommentary, MAX_HIGHLIGHTS, parseTitle, resolveClip, pickClips, correct, checkAnswer, splitInterview, rowsFor, mergeInbox, parseWorkerLog, MAX_TRIES, CLIP_DAYS } from './news-ticker/ttv-interviews.mjs';
let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('  ok  ' + name); };
const cards = [{ tour: 'ATP Stockholm', p1: 'T. A. Tirante', p1Key: 366, p2: 'A. Shevchenko', p2Key: 566 }, { tour: 'ATP Stockholm', p1: 'H. Rune', p1Key: 437, p2: 'T. Fritz', p2Key: 2832 },
  { tour: 'ATP Stockholm', p1: 'J. M. Cerundolo', p1Key: 388, p2: 'F. Cerundolo', p2Key: 9999 }, { tour: 'ATP Metz', p1: 'A. Rune', p1Key: 1, p2: 'B. Other', p2Key: 2 }];
const clip = (id, title, date, tags = ['video-type:interviews', 'match-type:singles']) => ({ id, title, date, titleUrlSegment: title.toLowerCase().replace(/\s+/g, '-'), tags: tags.map((label) => ({ label })) });
const T = 'So Alex looking good up there today. How are you feeling? Yeah, feeling good I played two very very good matches in a row. I feel like I have been serving super well I only got broken once last two matches. Was it making too many arrows early? Yes at the start.';

await ok('title: tournament, year, round and player are read; anything else is not a clip we take', () => {
  assert.deepEqual(parseTitle('Stockholm 2026 QF Thiago Agustin Tirante Interview'), { tournament: 'Stockholm', year: '2026', round: 'QF', player: 'Thiago Agustin Tirante' });
  assert.equal(parseTitle('Best shots of the week'), null);
});
await ok('player: exactly one player of that tournament on our board, by surname (and initial when the title has a first name)', () => {
  assert.equal(resolveClip({ title: 'Stockholm 2026 QF Thiago Agustin Tirante Interview' }, cards).speakerKey, '366');
  assert.equal(resolveClip({ title: 'Stockholm 2026 R2 Rune interview' }, cards).speakerKey, '437', 'the Metz player of the same surname is another tournament');
  assert.equal(resolveClip({ title: 'Stockholm 2026 R1 Cerundolo Interview' }, cards), null, 'two Cerundolos in the field and no first name: nobody');
  assert.equal(resolveClip({ title: 'Stockholm 2026 R1 Juan Manuel Cerundolo Interview' }, cards).speakerKey, '388');
  assert.equal(resolveClip({ title: 'Stockholm 2026 R1 Someone Else Interview' }, cards), null);
});
await ok('new clips: singles only, the last 3 days, never one already done or out of tries', () => {
  const now = '2026-11-13T00:00:00.000Z';
  const feed = { content: [clip(1, 'Stockholm 2026 QF Thiago Agustin Tirante Interview', '2026-11-12T17:28:00Z'), clip(2, 'Stockholm 2026 R2 Rune interview', '2026-11-11T21:16:00Z'),
    clip(3, 'Stockholm 2026 R1 Holger Rune interview', '2026-11-08T10:00:00Z'), clip(4, 'Stockholm 2026 QF Rune Interview', '2026-11-12T20:00:00Z', ['video-type:interviews', 'match-type:doubles']),
    clip(5, 'Stockholm 2026 QF Fritz Interview', '2026-11-12T21:00:00Z')] };
  const state = { clips: { 2: { status: 'done' }, 5: { status: 'failed', tries: MAX_TRIES } } };
  const r = pickClips(feed, state, cards, now);
  assert.deepEqual(r.clips.map((c) => c.id), ['1']); assert.deepEqual(r.skipped, { old: 1, done: 1, doubles: 1, noPlayer: 0, tries: 1 });
  assert.equal(r.clips[0].url, 'https://www.tennistv.com/videos/1/stockholm-2026-qf-thiago-agustin-tirante-interview'); assert.equal(CLIP_DAYS, 3);
  assert.equal(pickClips(feed, { clips: {} }, cards, now).clips.length, 3, 'control: with an empty state the done and failed clips come back');
});
await ok('word check: an answer is published only when every word is in the transcript, in order; a question never is', () => {
  const good = checkAnswer({ topic: 'On his serve', spans: ['I feel like I have been serving super well.', 'I only got broken once last two matches.'] }, T);
  assert.deepEqual(good, { topic: 'On his serve', text: 'I feel like I have been serving super well. … I only got broken once last two matches.' });
  assert.equal(checkAnswer({ topic: 'On his serve', spans: ['I feel like I have been serving really well.'] }, T), null, 'one replaced word');
  assert.equal(checkAnswer({ topic: 'On his serve', spans: ['I only got broken once last two matches.', 'I played two very very good matches in a row.'] }, T), null, 'reordered');
  assert.equal(checkAnswer({ topic: 'On his form', spans: ['How are you feeling?'] }, T), null, 'a question');
  assert.equal(checkAnswer({ topic: 'His serve', spans: ['I only got broken once last two matches.'] }, T), null, 'a topic that is not "On …"');
  assert.equal(checkAnswer({ topic: 'On the start', spans: ['Yes at the start.'] }, T), null, 'too short');
});
await ok('corrections: only the listed tennis mis-hearings are changed', () => {
  assert.equal(correct('making too many arrows in the tie wreck'), 'making too many errors in the tiebreak');
  assert.equal(correct('he shot arrows'), 'he shot arrows');
});
await ok('model step: checked answers only; a failing one is dropped and counted; no key or an API error publishes nothing', async () => {
  const reply = (arr) => async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(arr) }] }) });
  const r = await splitInterview(T, 'A. Michelsen', 'k', reply([{ topic: 'On his week', spans: ['I played two very very good matches in a row.'] }, { topic: 'On his serve', spans: ['I have been serving brilliantly.'] }]));
  assert.deepEqual([r.status, r.answers.length, r.dropped], ['ok', 1, 1]);
  assert.equal((await splitInterview(T, 'x', '')).status, 'no-key');
  assert.equal((await splitInterview(T, 'x', 'k', async () => ({ ok: false, status: 400, text: async () => 'credit' }))).status, 'api-error');
  assert.equal((await splitInterview(T, 'x', 'k', async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'Here you go' }] }) }))).status, 'bad-json');
});
await ok('inbox rows: one per answer, the clip as the source, held once, gone after 14 days', () => {
  const c = { id: '1', url: 'https://www.tennistv.com/videos/1/x', date: '2026-11-12T17:28:00.000Z', speakerKey: '366', tournament: 'Stockholm' };
  const rows = rowsFor(c, [{ topic: 'On the match', text: 'Very tough.' }], '2026-11-12T18:00:00.000Z');
  assert.deepEqual([rows[0].id, rows[0].speakerKey, rows[0].topic, rows[0].mentions[0], rows[0].day], ['ttv|1|1', '366', 'On the match', 'stockholm', '2026-11-12']);
  const m = mergeInbox(mergeInbox(null, rows, '2026-11-12T18:00:00.000Z'), rows, '2026-11-12T18:05:00.000Z');
  assert.equal(m.candidates.length, 1); assert.equal(mergeInbox(m, [], '2026-11-27T19:00:00.000Z').candidates.length, 0);
});
await ok('worker log: the results line is read through the Fly log prefix; no markers, no result', () => {
  const log = '2026-11-12T10:00:00Z app[1] ord [info]===RESULTS_JSON_START===\n2026-11-12T10:00:00Z app[1] ord [info]{"model":"small.en","count":1,"ok":1,"results":[{"url":"u","ok":true,"transcript":"hi"}]}\n2026-11-12T10:00:00Z app[1] ord [info]===RESULTS_JSON_END===\n';
  assert.equal(parseWorkerLog(log).results[0].transcript, 'hi'); assert.equal(parseWorkerLog('nothing here'), null);
});
await ok('wiring: every 5 minutes from main, keys only from Actions secrets, answers committed as the news data bot, a failed clip alerts', () => {
  const w = fs.readFileSync(new URL('../.github/workflows/interviews.yml', import.meta.url), 'utf8');
  assert.match(w, /cron: '2-59\/5 \* \* \* \*'/); assert.match(w, /github\.ref == 'refs\/heads\/main'/);
  assert.match(w, /secrets\.ANTHROPIC_API_KEY/); assert.match(w, /secrets\.TENNISTV_PASSWORD/); assert.match(w, /user\.name='bsp-bot'/); assert.match(w, /\[skip ci\]/);
  assert.match(w, /--vm-cpu-kind performance/); assert.match(w, /--restart no/); assert.match(w, /sendTelegram/);
  const src = fs.readFileSync(new URL('./news-ticker/ttv-interviews.mjs', import.meta.url), 'utf8');
  assert.ok(!/TENNISTV_|sk-ant/.test(src), 'no credential in the script');
  const wk = fs.readFileSync(new URL('../interviews-worker/worker.mjs', import.meta.url), 'utf8');
  assert.ok(/playback did not finish/.test(wk) && /sign-in attempt/.test(wk), 'the worker keeps only a clip that played to its end, and retries the sign-in');
});
// ---- commentary (founder 2026-11-13: "find what commentators say of a game and summarise it simply") ----
const HT = 'So welcome back everyone. Still got that little bit of strapping underneath the right knee. Absolutely remarkable defending from Lorenzo Musetti. He had 4 break points he could not take them. Still has not faced a break point. Great set of tennis from Humbert.';
await ok('highlights: the clip is tied to the one finished match of those two players; a walkover or an unfinished match is not a match', () => {
  const cs = [{ id: 'past-12179396', tour: 'ATP Stockholm', p1: 'L. Musetti', p2: 'U. Humbert', finalScore: { winner: 'p1' } }, { id: 'past-12179560', tour: 'ATP Stockholm', p1: 'T. Fritz', p2: 'H. Rune', walkover: true, finalScore: { winner: 'p1' } },
    { id: 'upcoming-1', tour: 'ATP Stockholm', p1: 'L. Musetti', p2: 'T. Fritz' }];
  assert.deepEqual(resolveHighlights({ title: 'Stockholm 2026 QF Musetti Humbert Highlights' }, cs), { eventKey: '12179396', p1: 'L. Musetti', p2: 'U. Humbert', tournament: 'Stockholm', round: 'QF' });
  assert.equal(resolveHighlights({ title: 'Stockholm 2026 QF Fritz Rune Highlights' }, cs), null);
  assert.equal(resolveHighlights({ title: 'Stockholm 2026 SF Musetti Fritz Highlights' }, cs), null);
  const feed = { content: [1, 2, 3].map((i) => ({ id: i, title: 'Stockholm 2026 QF Musetti Humbert Highlights', date: '2026-11-12T22:1' + i + ':00Z', titleUrlSegment: 'x' + i, tags: [{ label: 'video-type:match-highlights' }, { label: 'match-type:singles' }] })) };
  const got = pickHighlights(feed, { clips: { hl1: { status: 'done' } } }, cs, '2026-11-13T00:00:00.000Z');
  assert.deepEqual(got.map((c) => c.id), ['hl2', 'hl3']); assert.equal(MAX_HIGHLIGHTS, 2); assert.equal(got[0].kind, 'highlights');
});
await ok('commentary: a summary is kept only when its numbers and names are in the transcript; never a quotation; nothing to say = nothing', async () => {
  const P = ['L.', 'Musetti', 'U.', 'Humbert'];
  assert.ok(commentaryOk('Musetti defended very well and played with strapping under his right knee. Humbert had 4 break points he could not take.', HT, P));
  assert.ok(!commentaryOk('Musetti saved 7 break points and defended very well all match long in this one.', HT, P), 'a number that was never said');
  assert.ok(!commentaryOk('The defending of Musetti was like Djokovic at his best in this match today.', HT, P), 'a name that was never said');
  // founder 2026-11-13: our own observation — the source is never named, never first person
  for (const t of ['The commentators praised the defending of Musetti and noted the strapping under his right knee.', 'According to the commentary, Musetti defended very well in the first set.', 'I thought Musetti defended very well and Humbert missed his chances.', 'We saw Musetti defend very well and Humbert miss his chances today.']) assert.ok(!commentaryOk(t, HT, P), t);
  assert.ok(!commentaryOk('They called it "absolutely remarkable defending" from Musetti in the first set of this match.', HT, P), 'a quotation');
  const reply = (text) => async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text }] }) });
  const good = await summariseCommentary(HT, ['L. Musetti', 'U. Humbert'], 'k', reply('Musetti defended very well and played with strapping under his right knee.'));
  assert.equal(good.status, 'ok');
  assert.equal((await summariseCommentary(HT, ['L. Musetti', 'U. Humbert'], 'k', reply('NONE'))).status, 'nothing');
  assert.equal((await summariseCommentary(HT, ['L. Musetti', 'U. Humbert'], 'k', reply('Musetti hit 40 winners and defended very well in this long match.'))).status, 'failed-check');
  assert.equal((await summariseCommentary(HT, ['a', 'b'], '')).status, 'no-key');
  const b = fs.readFileSync(new URL('./news-ticker/build-news-ticker.mjs', import.meta.url), 'utf8');
  assert.ok(!/From the commentary|commentators/.test(b.replace(/\/\/.*$/gm, '')) && /cm && cm\.text \? cm\.text : null/.test(b), 'its own paragraph in the report, with no source named');
});
console.log(`ttv interviews: ${n} checks passed`);
