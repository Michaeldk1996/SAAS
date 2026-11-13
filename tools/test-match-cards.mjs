// The broadcast's Match Statistics card (tools/news-ticker/match-cards.mjs): the real Musetti v Humbert card of 12 Nov 2026.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parsePost, findMatch, verifyCard, shotSentences, readCard, MAX_POSTS, PCT_TOL } from './news-ticker/match-cards.mjs';
import { ratingLines, dominanceRatio } from './news-ticker/news-core.mjs';
let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('  ok  ' + name); };
const M = { id: 'past-12179396', date: '2026-11-12', p1: 'L. Musetti', p2: 'U. Humbert', finalScore: { winner: 'p1', sets: [{ p1: 7, p2: 6 }, { p1: 3, p2: 6 }, { p1: 6, p2: 4 }] },
  matchStats: { p1: { 'Service:1st serve percentage': 70, 'Service:1st serve points won': 73.9, 'Service:2nd serve points won': 48.3, raw: { 'Return:Break Points Converted': { won: 2, total: 4 } } },
    p2: { 'Service:1st serve percentage': 64.4, 'Service:1st serve points won': 69.2, 'Service:2nd serve points won': 55.6, raw: { 'Return:Break Points Converted': { won: 2, total: 5 } } } } };
const side = (name, o) => ({ name, performance: 8, serveQuality: 8, unreturnedPct: 30, secondSpeed: 160, returnQuality: 6, forcedErrors: 30, baselineWon: 40, under9Won: 90, ...o });
const CARD = { left: side('MUSETTI', { firstInPct: 70, firstWonPct: 74, secondWonPct: 48, bpWon: [2, 4], fhWinners: 9, bhWinners: 9, fhUnforced: 10, bhUnforced: 12, netWon: [4, 4], over9Won: 11 }),
  right: side('HUMBERT', { firstInPct: 63, firstWonPct: 70, secondWonPct: 54, bpWon: [2, 5], fhWinners: 11, bhWinners: 4, fhUnforced: 19, bhUnforced: 20, netWon: [18, 31], over9Won: 8 }), sets: [[7, 6], [3, 6], [6, 4]] };

await ok('post text: a result line gives winner, loser and sets; a walkover gives its reason; anything else is not a card', () => {
  assert.deepEqual(parsePost('Musetti 🇮🇹 76(5) 36 64 Humbert 🇫🇷 (C. Rask 🇩🇰) #StockholmOpen https://t.co/x'), { kind: 'match', winner: 'Musetti', loser: 'Humbert', sets: [[7, 6], [3, 6], [6, 4]] });
  assert.deepEqual(parsePost('Tirante 🇦🇷 W.O. (Left Calf) Etcheverry 🇦🇷 (J. Welte 🇨🇭) #StockholmOpen https://t.co/y'), { kind: 'walkover', winner: 'Tirante', loser: 'Etcheverry', reason: 'Left Calf' });
  assert.equal(parsePost('📊Performance Rating: QF - Stockholm 🇸🇪: #StockholmOpen https://t.co/z'), null);
  assert.equal(parsePost('Zhao 🇨🇳 4-0 Un-Nooh 🇹🇭 #ChampionOfChampions'), null, 'a snooker score is not a tennis card');
});
await ok('match: exactly one finished board match of those two players within two days, winner first', () => {
  const p = parsePost('Musetti 76(5) 36 64 Humbert (C. Rask) #StockholmOpen');
  assert.equal(findMatch(p, '2026-11-12T22:08:00Z', [M]).id, 'past-12179396');
  assert.equal(findMatch(p, '2026-11-20T22:08:00Z', [M]), null, 'too far from the match day');
  assert.equal(findMatch({ ...p, winner: 'Humbert', loser: 'Musetti' }, '2026-11-12T22:08:00Z', [M]), null, 'the post names the other player as winner');
  assert.equal(findMatch(p, '2026-11-12T22:08:00Z', [M, { ...M, id: 'past-2' }]), null, 'two candidates: nobody');
});
await ok('check against our own record: the real card passes; a wrong set, a wrong break-point count or serve figures that are off reject it', () => {
  const v = verifyCard(CARD, M);
  assert.deepEqual([v.ok, v.checked, v.close], [true, 6, 6]); assert.deepEqual(v.byPlayer.p2.netWon, [18, 31]); assert.equal(PCT_TOL, 3);
  assert.equal(verifyCard({ ...CARD, sets: [[7, 6], [6, 3], [6, 4]] }, M).ok, false);
  assert.equal(verifyCard({ ...CARD, left: { ...CARD.left, bpWon: [3, 4] } }, M).ok, false);
  assert.equal(verifyCard({ ...CARD, right: { ...CARD.right, firstInPct: 75 } }, M).ok, false);
  assert.equal(verifyCard({ ...CARD, left: { ...CARD.left, name: 'FRITZ' } }, M).ok, false, 'another match');
  const flipped = verifyCard({ left: CARD.right, right: CARD.left, sets: [[6, 7], [6, 3], [4, 6]] }, M);
  assert.ok(flipped.ok && flipped.byPlayer.p1.fhWinners === 9, 'the card may list the players the other way round');
  const bad = verifyCard({ ...CARD, left: { ...CARD.left, fhWinners: 'nine', netWon: [5, 4] } }, M);
  assert.ok(bad.ok && bad.byPlayer.p1.fhWinners === null && bad.byPlayer.p1.netWon === null, 'a value that is not a clean number is a blank, never a guess');
});
// founder 2026-11-13: "serve quality, unreturned serves, return quality, performance rating, and if there are high difference
// of over 9 shots won, and also from the baseline" — surnames only, the card never named, small gaps not mentioned
await ok('report sentences: serve quality, unreturned serves, return quality and a BIG baseline / long-rally gap; nothing else from the card', () => {
  const v = verifyCard(CARD, M), E = (p1, p2) => ({ p1: { ...v.byPlayer.p1, ...p1 }, p2: { ...v.byPlayer.p2, ...p2 } });
  assert.deepEqual(shotSentences(M, 'p1', 'p2', v.byPlayer), [], 'an 8.0 serve quality, 30% unreturned, a 6.0 return quality, 40–40 from the baseline and 11–8 in long rallies say nothing');
  // the real Fritz – Norrie card (11 Nov 2026)
  assert.deepEqual(shotSentences(M, 'p1', 'p2', E({ serveQuality: 8.8, unreturnedPct: 40, returnQuality: 8.4, baselineWon: 36, over9Won: 10 }, { serveQuality: 7.4, unreturnedPct: 20, returnQuality: 6.9, baselineWon: 22, over9Won: 4 })),
    ['Musetti ended with an 8.8 serve quality and 40% unreturned serves.', 'He also returned very well, with an 8.4 return quality.', 'Musetti was clearly the better player from the baseline (36–22).', 'Musetti won the long rallies 10–4.']);
  // the loser: one sentence at most; a strong serve with a weak return is one sentence (the real Sonego card: 9.0 and 5.8)
  assert.deepEqual(shotSentences(M, 'p1', 'p2', E({}, { serveQuality: 9, unreturnedPct: 31, returnQuality: 5.8 })), ['Humbert ended with a 9.0 serve quality and 31% unreturned serves, but it was not his best return performance, with a return quality of 5.8.']);
  assert.deepEqual(shotSentences(M, 'p1', 'p2', E({ returnQuality: 5.4 }, {})), ['It was not the best return performance of Musetti, with a return quality of 5.4.']);
  assert.deepEqual(shotSentences(M, 'p1', 'p2', E({ baselineWon: 39 }, { baselineWon: 31, over9Won: 6 })), [], 'gaps of 8 and 5 are small: not mentioned');
  assert.deepEqual(shotSentences(M, 'p1', 'p2', E({ serveQuality: null, unreturnedPct: 36 }, {})), ['Musetti ended with 36% unreturned serves.'], 'a blank number is left out, never printed');
  const all = shotSentences(M, 'p1', 'p2', E({ serveQuality: 9.1, unreturnedPct: 44, returnQuality: 8.2, baselineWon: 60, over9Won: 20 }, { serveQuality: 9.3, returnQuality: 5 })).join(' ');
  assert.ok(!/card|broadcast|statistics|[A-Z]\. [A-Z]|forehand|backhand|net/.test(all), 'no source named, no initials, no wing or net counts');
  assert.deepEqual(shotSentences(M, 'p1', 'p2', null), [], 'no card: no sentence');
});
await ok('closing line per player, winner first: the card\'s performance rating, OUR winners / unforced errors and OUR dominance ratio; a missing part is left out', () => {
  const st = (w, u, spw, rpw) => ({ 'Points:Winners': w, 'Points:Unforced errors': u, 'Points:Service Points Won': spw, 'Points:Return Points Won': rpw });
  const F = { p1: 'C. Norrie', p2: 'T. Fritz', matchStats: { p1: st(23, 16, 57.6, 30.2), p2: st(31, 17, 69.8, 42.4) } };   // the real box score of 11 Nov 2026
  const card = { p1: { performance: 7.9 }, p2: { performance: 8.8 } };
  assert.deepEqual(ratingLines(F, 'p2', 'p1', card), ['Fritz: performance rating 8.8 | W: 31 / UE: 17 | DR: 1.40', 'Norrie: performance rating 7.9 | W: 23 / UE: 16 | DR: 0.71']);
  assert.deepEqual(ratingLines(F, 'p2', 'p1', null), ['Fritz: W: 31 / UE: 17 | DR: 1.40', 'Norrie: W: 23 / UE: 16 | DR: 0.71'], 'no card: no rating, never a guess');
  assert.deepEqual(ratingLines({ ...F, matchStats: { p1: st(0, 0, 57.6, 30.2), p2: st(0, 0, 69.8, 42.4) } }, 'p2', 'p1', null), ['Fritz: DR: 1.40', 'Norrie: DR: 0.71'], 'winners and errors the feed did not track are not printed as 0');
  assert.deepEqual(ratingLines({ p1: 'A. De Minaur', p2: 'T. A. Tirante', matchStats: {} }, 'p1', 'p2', { p1: { performance: 8 }, p2: { performance: null } }), ['De Minaur: performance rating 8.0'], 'no box score: the rating alone; a player with nothing gets no line');
  assert.equal(dominanceRatio({ 'Points:Return Points Won': 40 }), null); assert.equal(dominanceRatio({ 'Points:Return Points Won': 40, 'Points:Service Points Won': 100 }), null);
});
await ok('winners and unforced errors: the card\'s wings are compared with our totals and the gap is recorded; it never drops a card', () => {
  const ms = { p1: { ...M.matchStats.p1, 'Points:Winners': 26, 'Points:Unforced errors': 23, 'Service:Aces': 8, 'Service:Double Faults': 1 }, p2: { ...M.matchStats.p2, 'Points:Winners': 28, 'Points:Unforced errors': 43, 'Service:Aces': 13, 'Service:Double Faults': 2 } };
  const v = verifyCard(CARD, { ...M, matchStats: ms });
  assert.deepEqual([v.ok, v.wue.compared, v.wue.maxDiff], [true, 4, 2], 'W = aces + forehand + backhand winners; UE = forehand + backhand unforced + double faults');
  assert.deepEqual(verifyCard(CARD, M).wue, { compared: 0, maxDiff: null }, 'no totals of ours: nothing compared');
  const off = verifyCard({ ...CARD, left: { ...CARD.left, fhWinners: 30 } }, { ...M, matchStats: ms });
  assert.ok(off.ok && off.wue.maxDiff === 21, 'a wing count far from ours is recorded, the card stays (the report prints our totals)');
});
await ok('reading: no key reads nothing; a picture that is not the graphic is not a card', async () => {
  assert.equal((await readCard('https://x/y.jpg', '')).status, 'no-key');
  const img = { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new ArrayBuffer(4) };
  const f = (text) => async (u) => (String(u).includes('anthropic') ? { ok: true, json: async () => ({ content: [{ type: 'text', text }] }) } : img);
  assert.equal((await readCard('https://x/y.jpg', 'k', f('{"notCard":true}'))).status, 'not-card');
  assert.equal((await readCard('https://x/y.jpg', 'k', f(JSON.stringify(CARD)))).card.left.name, 'MUSETTI');
});
await ok('wiring: only posts newer than the last one seen, one page, never a back-fill; reports read the verified file; the job is watched', () => {
  const src = fs.readFileSync(new URL('./news-ticker/match-cards.mjs', import.meta.url), 'utf8');
  assert.ok(/since_id: state\.lastSeenId/.test(src) && /refusing to read the whole timeline/.test(src) && MAX_POSTS === 100 && !/pagination_token|next_token/.test(src));
  const st = JSON.parse(fs.readFileSync(new URL('../news-quotes/match-cards-state.json', import.meta.url), 'utf8')); assert.match(String(st.lastSeenId), /^\d{15,}$/);
  const b = fs.readFileSync(new URL('./news-ticker/build-news-ticker.mjs', import.meta.url), 'utf8'); assert.match(b, /shotSentences\(m, w, l, cardsByMatch\[ek\(m\)\]\)/);
  const w = fs.readFileSync(new URL('../.github/workflows/match-cards.yml', import.meta.url), 'utf8');
  assert.ok(/secrets\.X_BEARER_TOKEN/.test(w) && /refs\/heads\/main/.test(w) && /user\.name='bsp-bot'/.test(w));
  assert.match(fs.readFileSync(new URL('../.github/workflows/job-fail-alert.yml', import.meta.url), 'utf8'), /News ticker match cards/);
});
console.log(`match cards: ${n} checks passed`);
