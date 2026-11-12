#!/usr/bin/env node
// News ticker live feed — storage rules, observed times, the pipeline build on a fixture board, the quote pipeline,
// the registry, the three alerts (each triggered once against a fake Telegram) and the workflow wiring. No network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);   // the fake Telegram lives in this process: a child that calls it must not block the loop
import { fileURLToPath } from 'node:url';
import { mergeItems, buildIndex, observedTimes, hashItem, dedupeQuotes, sameQuote, fileOf } from './news-ticker/ticker-core.mjs';
import { build } from './news-ticker/build-news-ticker.mjs';
import { pbpFacts } from './news-ticker/pbp-facts.mjs';
import { daysWithoutReports } from './news-ticker/ticker-alerts.mjs';
import { processTournament, dueAlerts, siteConfig, outletsFor, switchedOff, activeTournaments, SILENT_HOURS } from './news-ticker/collect-quotes.mjs';
import { speakerIn, speechOf, technicalBlock, paywalled, sectionLinks, readOutlet, candidatesFromOutletArticle, UA } from './news-ticker/outlet-reader.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('  ok  ' + name); };
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ---- storage ----
const A = { id: 'report-1', type: 'report', timestamp: '2026-11-10T10:00:00.000Z', text: 'x beat y.' };
await ok('merge: a new item is stamped; the same content on a later run leaves the stored object untouched', () => {
  const r1 = mergeItems([], [A], 'T1'); assert.equal(r1.added, 1); assert.equal(r1.items[0].publishedAt, 'T1');
  const r2 = mergeItems(r1.items, [{ ...A }], 'T2');
  assert.deepEqual([r2.added, r2.revised, r2.unchanged], [0, 0, 1]); assert.equal(JSON.stringify(r2.items), JSON.stringify(r1.items));
});
await ok('merge: changed source data rewrites the item, keeps publishedAt, stamps revisedAt + revision', () => {
  const r1 = mergeItems([], [A], 'T1'), r2 = mergeItems(r1.items, [{ ...A, text: 'x beat y 6-0.' }], 'T2');
  assert.equal(r2.revised, 1); assert.deepEqual([r2.items[0].publishedAt, r2.items[0].revisedAt, r2.items[0].revision], ['T1', 'T2', 1]);
});
await ok('merge: an item the run did not rebuild (match off the board) is kept for good', () => {
  const r1 = mergeItems([], [A], 'T1'), r2 = mergeItems(r1.items, [{ ...A, id: 'report-2' }], 'T2');
  assert.deepEqual(r2.items.map((x) => x.id).sort(), ['report-1', 'report-2']);
});
await ok('index: one line per tournament + the newest items only; unchanged items give a byte-identical index', () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ id: 'r' + i, type: 'report', timestamp: `2026-11-10T10:${String(i).padStart(2, '0')}:00.000Z`, publishedAt: 'T1', sourceHash: 'h' }));
  const i1 = buildIndex([{ key: '1681', season: '2026', name: 'Stockholm', items }]), i2 = buildIndex([{ key: '1681', season: '2026', name: 'Stockholm', items }]);
  assert.equal(JSON.stringify(i1), JSON.stringify(i2)); assert.equal(i1.latest.length, 40); assert.equal(i1.tournaments[0].items, 60);
  assert.equal(i1.tournaments[0].file, 'news-ticker/1681-2026.json'); assert.equal(i1.latest[0].id, 'r59');
});

// ---- observed times ----
const FLIP = { first_live_seen_at: '2026-11-11T12:00:00Z', play_seen_at: '2026-11-11T12:08:10Z' };
const END = { last_undecided_seen_at: '2026-11-11T13:19:00Z', decided_seen_at: '2026-11-11T13:19:10Z' };
await ok('duration: only when the start AND the end were observed', () => {
  assert.deepEqual(observedTimes(FLIP, END), { endedAt: '2026-11-11T13:19:10.000Z', startedAt: '2026-11-11T12:08:10.000Z', minutes: 71 });
  assert.equal(observedTimes(FLIP, { decided_seen_at: END.decided_seen_at, last_undecided_seen_at: null }), null, 'first seen already decided: no end');
  assert.equal(observedTimes(FLIP, { ...END, last_undecided_seen_at: '2026-11-11T13:10:00Z' }), null, 'a gap in the poller around the end');
  assert.equal(observedTimes(FLIP, null), null);
  const noStart = observedTimes({ first_live_seen_at: FLIP.play_seen_at, play_seen_at: FLIP.play_seen_at }, END);
  assert.deepEqual(noStart, { endedAt: '2026-11-11T13:19:10.000Z' }, 'play already on the board at first sight: end only, no duration');
  assert.deepEqual(observedTimes(null, END), { endedAt: '2026-11-11T13:19:10.000Z' });
});

// ---- the pipeline build on a fixture board ----
const stats = (aces, w, ue, bp) => ({ 'Service:Aces': aces, 'Points:Winners': w, 'Points:Unforced errors': ue, raw: bp ? { 'Service:Break Points Saved': bp } : {} });
const card = (o) => ({ tourBadge: 'ATP', tour: 'ATP Testville', tournamentKey: 77, date: '2026-11-10', time: '13:00', tournamentRound: 'ATP Testville - 1/8-finals', qualifying: false,
  retired: false, walkover: false, p1: 'A. One', p2: 'B. Two', p1Key: 1, p2Key: 2, finalScore: { sets: [{ p1: 6, p2: 0 }, { p1: 6, p2: 0 }], winner: 'p1' },
  matchStats: { p1: stats(2, 19, 7, null), p2: stats(0, 5, 20, { won: 4, total: 10 }) }, ...o });
const G = (g, server, winner, score) => ({ g, server, winner, score, points: (winner === 'p1' ? ['15 - 0', '30 - 0', '40 - 0'] : ['0 - 15', '0 - 30', '0 - 40']).map((s, i) => ({ n: i + 1, s })) });
const cleanSet = () => ({ games: [1, 2, 3, 4, 5, 6].map((i) => G(i, i % 2 ? 'p1' : 'p2', 'p1', `${i} - 0`)) });
function fixture(cards, extra = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ticker-'));
  fs.writeFileSync(path.join(d, 'matches.json'), JSON.stringify(Object.fromEntries(cards.map((c, i) => [i, c]))));
  fs.mkdirSync(path.join(d, 'pbp'));
  for (const [k, v] of Object.entries(extra.pbp || {})) fs.writeFileSync(path.join(d, 'pbp', k + '.json'), JSON.stringify(v));
  for (const [k, v] of Object.entries(extra.files || {})) { fs.mkdirSync(path.dirname(path.join(d, k)), { recursive: true }); fs.writeFileSync(path.join(d, k), JSON.stringify(v)); }
  return d;
}
const inDir = async (d, fn) => { const cwd = process.cwd(), argv = process.argv; process.chdir(d); try { return await fn(); } finally { process.chdir(cwd); process.argv = argv; } };
const runBuild = (d, now, times) => execFileSync('node', ['-e', `import(${JSON.stringify(path.join(ROOT, 'tools/news-ticker/build-news-ticker.mjs'))}).then(async (m) => { const t = ${times ? `new Map(${JSON.stringify([...times])})` : 'null'}; console.log(JSON.stringify(await m.build({ nowIso: ${JSON.stringify(now)}, times: t }))); })`, '--', '--dir', d], { cwd: d, encoding: 'utf8' });
const itemsOf = (d) => JSON.parse(fs.readFileSync(path.join(d, 'news-ticker', '77-2026.json'), 'utf8')).items;

await ok('build: one report per finished match; a walkover gets a status item and NO report (so it can never print "faced no break points")', () => {
  const d = fixture([card({ id: 'past-100' }), card({ id: 'past-101', walkover: true, matchStats: null, finalScore: { sets: [{ p1: 0, p2: 0 }], winner: 'p2' } }), card({ id: 'upcoming-102', finalScore: null })],
    { pbp: { 100: { sets: [cleanSet(), cleanSet()] } } });
  const s = JSON.parse(runBuild(d, '2026-11-10T15:00:00.000Z'));
  assert.equal(s.reports, 1); const it = itemsOf(d);
  assert.deepEqual(it.map((x) => x.id).sort(), ['report-100', 'status-wo-101']);
  assert.ok(!it.some((x) => /faced no break points/.test(x.text) && x.id !== 'report-100'));
  assert.match(it.find((x) => x.id === 'report-100').text, /A\. One faced no break points\. B\. Two saved 4 of 10 break points\.$/, 'what stood out, not the full stat line');
  assert.ok(!/break point/.test(it.find((x) => x.id === 'status-wo-101').text));
});
await ok('build: a missing or empty point log never prints "faced no break points" (blank box score stays blank)', () => {
  for (const pbp of [{}, { 100: { sets: [] } }, { 100: { sets: [{ games: [] }, { games: [] }] } }]) {
    const d = fixture([card({ id: 'past-100' })], { pbp });
    runBuild(d, '2026-11-10T15:00:00.000Z');
    const t = itemsOf(d)[0].text;
    assert.ok(!/faced no break points/.test(t), JSON.stringify(pbp) + ' -> ' + t); assert.ok(!/A\. One (faced|saved)/.test(t), 'no break-point claim for the player whose count is blank: ' + t);
  }
  assert.equal(pbpFacts({ sets: [] }, { sets: [{ p1: 6, p2: 0 }] }), null); assert.equal(pbpFacts({ sets: [{ games: [] }] }, { sets: [{ p1: 6, p2: 0 }] }), null);
});
await ok('build: timestamp is the observed end and the text carries the duration; without one, the scheduled start, labelled', () => {
  const d = fixture([card({ id: 'past-100' })]);
  runBuild(d, '2026-11-10T15:00:00.000Z');
  let it = itemsOf(d)[0]; assert.equal(it.timestampKind, 'scheduled'); assert.equal(it.timestamp, '2026-11-10T12:00:00.000Z'); assert.ok(!/minutes/.test(it.text));
  runBuild(d, '2026-11-10T15:15:00.000Z', new Map([['100', { endedAt: '2026-11-10T13:19:10.000Z', startedAt: '2026-11-10T12:08:10.000Z', minutes: 71 }]]));
  it = itemsOf(d)[0]; assert.equal(it.timestampKind, 'observed'); assert.equal(it.timestamp, '2026-11-10T13:19:10.000Z'); assert.match(it.text, /in the round of 16 in 71 minutes\./);
  assert.equal(it.revision, 1); assert.equal(it.publishedAt, '2026-11-10T15:00:00.000Z');
  // a later run whose times read failed keeps the observed end (never downgrades), and rewrites nothing
  const before = fs.readFileSync(path.join(d, 'news-ticker', '77-2026.json'), 'utf8');
  const s = JSON.parse(runBuild(d, '2026-11-10T15:30:00.000Z'));
  assert.deepEqual([s.added, s.revised], [0, 0]); assert.equal(fs.readFileSync(path.join(d, 'news-ticker', '77-2026.json'), 'utf8'), before);
  assert.deepEqual(s.filesWritten, [], 'nothing regenerated when nothing changed');
});
await ok('build: qualifying matches are in scope (report says so); doubles and non-ATP cards are not', () => {
  const d = fixture([card({ id: 'past-100', qualifying: true, tournamentRound: 'ATP Testville - Final' }), card({ id: 'past-103', p1: 'A. One / C. Three' }), card({ id: 'past-104', tourBadge: 'WTA' })]);
  runBuild(d, '2026-11-10T15:00:00.000Z');
  const it = itemsOf(d); assert.deepEqual(it.filter((x) => x.type === 'report').map((x) => x.id), ['report-100']);
  assert.match(it.find((x) => x.id === 'report-100').text, /in the final round of qualifying\./);
});
await ok('build: the collector\'s quotes are folded into the same tournament file', () => {
  const q = { id: 'quote-abc', type: 'quote', playerId: '1', tournament: 'Testville', tournamentKey: '77', season: '2026', timestamp: '2026-11-10T14:00:00.000Z', timestampKind: 'observed', category: 'Quotes', text: 'I played well.', language: 'en', translated: false, sourceName: 'S', sourceUrl: 'https://s/x' };
  const d = fixture([card({ id: 'past-100' })], { files: { 'news-quotes/77-2026.json': { items: [q] } } });
  runBuild(d, '2026-11-10T15:00:00.000Z');
  assert.ok(itemsOf(d).some((x) => x.id === 'quote-abc' && x.text === 'I played well.'));
  const idx = JSON.parse(fs.readFileSync(path.join(d, 'news-ticker.json'), 'utf8')); assert.deepEqual(idx.tournaments[0].byType, { report: 1, quote: 1 });
});

// ---- quotes ----
const T = { key: '77', season: '2026', name: 'Testville', cards: [card({ id: 'past-100' })] };
const cand = (o) => ({ id: 'a-1', speaker: 'One', spans: [o.text], sourceText: o.src || o.text, sourceName: 'Outlet A', sourceUrl: 'https://a/1', language: 'en', timestamp: '2026-11-10T14:00:00.000Z', timestampKind: 'observed', ...o });
await ok('quotes: not verbatim -> dropped; speaker not exactly one player of the field -> dropped; all counted', async () => {
  const r = await processTournament({ t: T, got: { candidates: [cand({ text: 'I played really well today, honestly.' }), cand({ text: 'I played really well today, honestly.', src: 'I played quite well today.' }),
    cand({ text: 'The crowd was great all night long.', speaker: 'Nobody' })] } });
  assert.equal(r.items.length, 1); assert.deepEqual([r.counts.droppedNotVerbatim, r.counts.droppedNoPlayer], [1, 1]);
});
await ok('quotes: a non-English quote is translated in the pipeline, keeps the original, and is marked translated', async () => {
  const sv = cand({ text: 'Det var en tuff match för mig.', language: 'sv' });
  const r = await processTournament({ t: T, got: { candidates: [sv] }, translate: async () => ({ status: 'ok', text: 'It was a tough match for me.', model: 'm', usage: { input: 50, output: 9 } }) });
  assert.deepEqual([r.items[0].translated, r.items[0].language, r.items[0].originalText, r.items[0].text], [true, 'sv', 'Det var en tuff match för mig.', 'It was a tough match for me.']);
  assert.deepEqual(r.counts.tokens, { input: 50, output: 9 });
  // the same quote on the next run is not translated again
  let calls = 0; const r2 = await processTournament({ t: T, got: { candidates: [sv] }, known: r.items, translate: async () => { calls++; return { status: 'ok', text: 'x' }; } });
  assert.equal(calls, 0); assert.equal(r2.items[0].text, 'It was a tough match for me.'); assert.equal(r2.items[0].id, r.items[0].id);
});
await ok('quotes: translation failing its check is dropped; a model error is counted and surfaced; the English one wins', async () => {
  const sv = cand({ text: 'Det är speciellt att komma tillbaka hit efter förra året.', language: 'sv', sourceName: 'Outlet B', sourceUrl: 'https://b/1' });
  const en = cand({ text: "It's special coming back here after last year." });
  let r = await processTournament({ t: T, got: { candidates: [sv] }, translate: async () => ({ status: 'failed-check', text: null, detail: 'sentence count' }) });
  assert.deepEqual([r.items.length, r.counts.droppedTranslationCheck], [0, 1]);
  r = await processTournament({ t: T, got: { candidates: [sv] }, translate: async () => ({ status: 'api-error', http: 400, text: null, detail: 'HTTP 400 credit balance is too low' }) });
  assert.deepEqual([r.items.length, r.counts.notTranslatedApiError, r.counts.modelError.http], [0, 1, 400]);
  r = await processTournament({ t: T, got: { candidates: [sv, en] }, translate: async () => ({ status: 'ok', text: "It's special to come back here after last year.", model: 'm' }) });
  assert.deepEqual([r.items.length, r.items[0].language, r.counts.droppedEnglishExists], [1, 'en', 1]);
});
await ok('quotes: the same quote from two outlets is one item (the second outlet is listed on it); different quotes stay apart', async () => {
  const a = cand({ text: 'I served really well and stayed calm in the big moments today.' });
  const b = cand({ text: 'I served really well and stayed calm in the big moments today.', sourceName: 'Outlet B', sourceUrl: 'https://b/2' });
  const c = cand({ text: 'My return was the key and I am happy with the level overall.' });
  const r = await processTournament({ t: T, got: { candidates: [a, b, c] } });
  assert.equal(r.items.length, 2); assert.equal(r.counts.mergedSameQuote, 1);
  assert.deepEqual(r.items[0].alsoReportedBy, [{ sourceName: 'Outlet B', sourceUrl: 'https://b/2', language: 'en' }]);
  assert.equal(sameQuote({ playerId: '1', text: a.text }, { playerId: '2', text: a.text }), false, 'another player saying the same words is another quote');
});

// ---- registry (Michael's ruling, 11 Nov 2026) ----
const REG = JSON.parse(read('data/news-outlets.json'));
await ok('registry: every outlet keeps its robots / terms record; a readable one records the ruling; a blocked one is a technical block', () => {
  assert.ok(REG.outlets.length >= 150); assert.match(REG.ruling, /allowed by Michael's ruling, 11 Nov 2026/);
  for (const o of REG.outlets) {
    assert.ok(['allowed', 'blocked', 'permission'].includes(o.status), o.outlet); assert.ok(o.country && o.language && o.reason && o.robots && o.terms && 'enabled' in o && o.statusBeforeRuling, o.outlet);
    if (o.status === 'allowed') { assert.equal(o.allowedBy, "allowed by Michael's ruling, 11 Nov 2026", o.outlet); assert.equal(o.probe.http, 200, o.outlet); }
    if (o.status === 'blocked') assert.equal(o.blockKind, 'technical', o.outlet);
  }
  assert.ok(REG.outlets.filter((o) => /atptour\.com/.test(o.sectionUrl)).every((o) => o.status === 'permission'), 'ATP stays on the permission route');
  assert.ok(!REG.outlets.some((o) => /tennisform/i.test(JSON.stringify(o))) && !/tennisform/i.test(JSON.stringify(REG.tournamentSites)), 'no entry points at the excluded site');
});
await ok('registry: only allowed + switched-on outlets are read, for the host country, the draw\'s home countries and the international group', () => {
  const reg = { outlets: [{ status: 'allowed', enabled: true, country: 'Sweden', outlet: 'A' }, { status: 'blocked', enabled: true, country: 'Sweden', outlet: 'B' },
    { status: 'allowed', enabled: false, country: 'Sweden', outlet: 'C' }, { status: 'allowed', enabled: true, country: 'Norway', outlet: 'D' }, { status: 'allowed', enabled: true, country: 'INT', iso2: 'INT', outlet: 'E' },
    { status: 'permission', enabled: true, country: 'INT', iso2: 'INT', outlet: 'ATP' }] };
  assert.deepEqual(outletsFor(reg, ['Denmark'], 'Sweden').map((o) => o.outlet), ['A', 'E']);
  assert.deepEqual([...switchedOff(reg)], ['C']);
});
await ok('technical blocks are never bypassed: 401/403/429, a CAPTCHA page, an empty page, a paywall all keep the page out', () => {
  for (const st of [401, 402, 403, 429, 451, 503]) assert.ok(technicalBlock(st, 'x'.repeat(2000)), String(st));
  assert.ok(technicalBlock(200, '<title>Just a moment...</title>' + 'x'.repeat(2000))); assert.ok(technicalBlock(200, 'short'));
  assert.equal(technicalBlock(200, '<html>' + 'article '.repeat(300) + '</html>'), null);
  assert.ok(paywalled('{"isAccessibleForFree":false}')); assert.ok(paywalled('<div class="article paywall">')); assert.equal(paywalled('<p>free text</p>'), false);
  assert.ok(/plain client/.test(UA) && !/Mozilla|Chrome|Safari/.test(UA), 'one honest user agent, never a browser disguise');
  for (const f of ['tools/news-ticker/outlet-reader.mjs', 'tools/news-ticker/collect-quotes.mjs', 'tools/news-ticker/quote-sources.mjs']) assert.ok(!/puppeteer|playwright|--headless|HttpsProxyAgent|socks/i.test(read(f)), f);
});
const PL = [{ key: '437', surname: 'rune', initial: 'h' }, { key: '1', surname: 'bergs', initial: 'z' }, { key: '2', surname: 'davidovich fokina', initial: 'a' }];
await ok('speaker: exactly one field player directly at a said-word; a relative, a coach or a second player is nobody', () => {
  const T2 = [['siger Aneke Rune', null, 'da'], ['siger Holger Rune', '437', 'da'], ['siger Rune', '437', 'da'], ['Rune said in his on-court interview.', '437', 'en'], ["Rune's coach said", null, 'en'],
    ['Aneke Rune said', null, 'en'], ['Rune, who lifted the trophy in 2022, said', '437', 'en'], ['said the 23-year-old', null, 'en'], ['dijo Davidovich Fokina', '2', 'es'],
    ['The coach of Rune said', null, 'en'], ['Bergs said Rune was too good', null, 'en'], ['sagde Runes mor', null, 'da'], ['said Rune', null, 'xx']];
  for (const [t, exp, lang] of T2) assert.equal(speakerIn(t, PL, lang), exp, t);
});
await ok('speech: quotation marks, guillemets and dash-led lines all yield only the quoted words', () => {
  assert.deepEqual(speechOf('– Det var en tuff match för mig i dag, säger Etcheverry.'), { spans: ['Det var en tuff match för mig i dag'], outside: 'säger Etcheverry' });
  assert.deepEqual(speechOf('«Estoy muy contento con mi nivel de hoy», dijo Rune.').spans, ['Estoy muy contento con mi nivel de hoy']);
  assert.deepEqual(speechOf('Rune called it "tough".').spans, []);
});
const ART = (body) => `<html><head><script type="application/ld+json">{"datePublished":"2026-11-10T20:00:00Z"}</script></head><body><article><p>Testville report.</p>${body}</article></body></html>`;
await ok('an article yields candidates that carry the quoted words only (never article text), each attributed and dated', () => {
  const g = candidatesFromOutletArticle({ url: 'https://o/x', outlet: 'Outlet', language: 'en', players: PL,
    html: ART('<p>“I served really well and stayed calm today,” said Rune.</p><p>“It was not my day at all, honestly,” said the Belgian.</p><p>The match lasted two hours.</p>') });
  assert.equal(g.candidates.length, 1); assert.equal(g.unnamed, 1);
  const c = g.candidates[0]; assert.equal(c.speakerKey, '437'); assert.equal(c.text, 'I served really well and stayed calm today,'); assert.equal(c.timestamp, '2026-11-10T20:00:00.000Z');
  assert.ok(!c.text.includes('The match lasted'));
});
await ok('polite rate: one section request per outlet per run; an article page is fetched once, ever; a blocked section is left alone', async () => {
  const log = [];
  const SECTION = '<html>' + 'x'.repeat(700) + '<a href="/tennis/rune-wins-in-testville-again">Rune wins in Testville</a><a href="/tennis/other-long-article-slug">Other news</a></html>';
  const fetchFn = async (url) => { log.push(url); return { status: 200, url, text: async () => (url.endsWith('/tennis/') ? SECTION : ART('<p>“I served really well and stayed calm today,” said Rune.</p>') + 'x'.repeat(700)) }; };
  const outlet = { outlet: 'Outlet', country: 'Sweden', language: 'en', status: 'allowed', enabled: true, sectionUrl: 'https://o.example/tennis/' };
  const cache = {}, memo = new Map(), base = { outlet, players: PL, tournamentName: 'Testville', cache, nowIso: '2026-11-10T21:00:00Z', since: Date.parse('2026-11-05'), fetchFn, sectionMemo: memo };
  const r1 = await readOutlet(base); assert.equal(r1.candidates.length, 1); assert.deepEqual([r1.stats.links, r1.stats.relevant, r1.stats.fetched], [2, 1, 1]);
  const r2 = await readOutlet(base); assert.deepEqual([r2.stats.fetched, r2.stats.alreadyFetched, r2.candidates.length], [0, 1, 0]);
  assert.deepEqual(log, ['https://o.example/tennis/', 'https://o.example/tennis/rune-wins-in-testville-again'], 'section once (memo), article once (cache)');
  const blocked = await readOutlet({ ...base, sectionMemo: new Map(), fetchFn: async (url) => ({ status: 403, url, text: async () => '' }) });
  assert.equal(blocked.stats.blocked, 'the site refuses a plain request'); assert.equal(blocked.candidates.length, 0);
  cache['https://o.example/tennis/rune-wins-in-testville-again'].retranslate = true; cache['https://o.example/tennis/rune-wins-in-testville-again'].tries = 2;   // its quote failed translation
  const r3 = await readOutlet(base); assert.deepEqual([r3.stats.fetched, r3.candidates.length], [1, 1], 'an article whose quote was not translated is read again');
  assert.deepEqual(cache['https://o.example/tennis/rune-wins-in-testville-again'].tries, 2); assert.ok(!cache['https://o.example/tennis/rune-wins-in-testville-again'].retranslate, 'and only once per failure');
  const offR = await readOutlet({ ...base, outlet: { ...outlet, enabled: false }, sectionMemo: new Map(), fetchFn: async () => { throw new Error('must not fetch'); } });
  assert.equal(offR.stats.blocked, 'not enabled');
});
// ---- reports in the founder's voice (founder 2026-11-12): every rewritten sentence checked against its own facts ----
await ok("voice: a rewrite passes only when every number, name and word is in that sentence's facts; a failing sentence keeps the template", async () => {
  const { checkSentence, mergeChecked, playerRef, humaniseReport, VOCAB } = await import('./news-ticker/humanise.mjs');
  const P = [playerRef('H. Rune', 'Holger Rune'), playerRef('M. Kecmanovic', 'Miomir Kecmanovic')];
  const T = ['H. Rune beat M. Kecmanovic for the 4th time in 5 meetings, 2-6, 6-1, 6-4 in the second round in 83 minutes.', 'H. Rune came from a set down.', 'H. Rune won 7 games in a row.',
    'H. Rune: 9 aces, 41 winners, 28 unforced errors, saved 0 of 3 break points.', 'M. Kecmanovic: 4 aces, 18 winners, 11 unforced errors, saved 1 of 5 break points.'];
  const R = ['Holger Rune beat Miomir Kecmanovic for the 4th time in 5 meetings, 2–6, 6–1, 6–4 in R2 in 83 minutes.', 'He came from a set down.', 'He won 7 games in a row along the way.',
    'Rune hit 9 aces and 41 winners, with 28 unforced errors, and saved 0 of 3 break points.', 'Kecmanovic hit 4 aces and 18 winners, made 11 unforced errors and saved 1 of 5 break points.'];
  const good = mergeChecked(T, R, P);
  assert.deepEqual([good.passed, good.total, good.failures], [5, 5, []]); assert.equal(good.text, R.join(' '));
  const bad = [
    [0, 'Holger Rune beat Miomir Kecmanovic for the 4th time in 5 meetings, 6–2, 6–1, 6–4 in R2 in 83 minutes.', /score/],          // a set score turned round
    [0, 'Miomir Kecmanovic lost to Holger Rune 2–6, 6–1, 6–4 in R2.', /swapped/],
    [0, 'Holger Rune beat Miomir Kecmanovic 2–6, 6–1, 6–4 in R3 in 83 minutes.', /round/],
    [1, 'Rune looked tired but came from a set down.', /looked/], [1, 'Rune felt good and came from a set down.', /felt/],
    [2, 'Kecmanovic won 7 games in a row.', /not in this fact/], [2, 'He won 8 games in a row.', /8 game/],
    [3, 'Rune hit 41 aces and 9 winners.', /41 ace/],                                                                              // right numbers, wrong stat
    [3, 'Rune was not clutch, saving 0 of 3 break points.', /not in the facts/], [3, 'Rune was solid with 9 aces.', /solid/],
    [3, 'H. Rune hit 9 aces.', /initial/], [4, 'He hit 4 aces and 18 winners.', /"he"/],                                           // "He" would read as Rune
    [3, 'Rune hit 9 aces and saved none of 3 break points.', /none/], [3, 'Rune hit 9 aces. He hit 41 winners.', /one sentence/],
    [3, 'Rune hit 41 winners, more than double.', /more/], [1, 'Rune came from a set down!', /exclamation/], [1, '', /empty/],
  ];
  for (const [i, t, why] of bad) { const r = checkSentence(T[i], t, { players: P, prevSubject: P[0] }); assert.equal(r.ok, false, t); assert.match(r.why, why, t); }
  for (const w of ['looked', 'felt', 'seemed', 'solid', 'clutch', 'shaky', 'deserved', 'lucky', 'only', 'just', 'none', 'all', 'twice', 'saved', 'converted', 'faced', 'not', 'no', 'more', 'than']) assert.ok(!VOCAB.has(w), `"${w}" must not be free vocabulary`);
  // one failing sentence -> that sentence only falls back; the count says so
  const mixed = mergeChecked(T, [R[0], 'Rune looked tired but came from a set down.', R[2], R[3], R[4]], P);
  assert.deepEqual([mixed.passed, mixed.total, mixed.failures.map((f) => f.i)], [4, 5, [1]]);
  assert.equal(mixed.text, [R[0], 'Rune came from a set down.', 'He won 7 games in a row along the way.', R[3], R[4]].join(' '), 'the stand-in is the template sentence, the card name as a surname');
  const allBad = mergeChecked(T, T.map(() => 'x'), P);
  assert.equal(allBad.text.split('. ')[0], 'Holger Rune beat Miomir Kecmanovic for the 4th time in 5 meetings, 2-6, 6-1, 6-4 in the second round in 83 minutes');
  assert.ok(!/H\. Rune|M\. Kecmanovic/.test(allBad.text) && allBad.passed === 0);
  // the report call: no key -> nothing rewritten; a model answer of the wrong length -> nothing rewritten
  const base = { sentences: T, winner: { card: 'H. Rune', full: 'Holger Rune' }, loser: { card: 'M. Kecmanovic', full: 'Miomir Kecmanovic' } };
  assert.equal((await humaniseReport(base, { apiKey: '' })).status, 'no-key');
  const short = await humaniseReport(base, { apiKey: 'k', fetchFn: async () => ({ ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '["one"]' }], usage: { input_tokens: 5, output_tokens: 2 } }) }) });
  assert.equal(short.status, 'bad-output');
  const full = await humaniseReport(base, { apiKey: 'k', fetchFn: async (u, o) => { const b = JSON.parse(o.body); assert.equal(b.model, 'claude-opus-5-5'); assert.deepEqual(JSON.parse(b.messages[0].content).names, { winner: 'Holger Rune', loser: 'Miomir Kecmanovic' });
    return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(R) }], usage: { input_tokens: 400, output_tokens: 120 } }) }; } });
  assert.equal(full.status, 'ok'); assert.deepEqual([full.voice.passed, full.voice.total], [5, 5]); assert.equal(full.text, R.join(' '));
  const w = read('.github/workflows/pipeline.yml');
  assert.match(w, /name: Build news ticker \(best-effort\)\n\s+env:\n\s+ANTHROPIC_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/, 'the key reaches the build from Actions secrets only');
  assert.ok(!/sk-ant-/.test(read('tools/news-ticker/humanise.mjs')));
});
// ---- what stood out (founder 2026-11-12: compare with the player's own baseline; don't repeat every statistic) ----
await ok('standouts: a rate is reported only when it is far from the player\'s own baseline on enough points; counts only when they say something', async () => {
  const { standoutUnits, baselineFor, MIN_BASE } = await import('./news-ticker/standouts.mjs');
  const node = (n, over = {}) => ({ sample: { matches: n }, serve: { firstInPct: 62.4, firstWonPct: 73.9, secondWonPct: 54.2, ...over }, return: { ret1stWonPct: 29, ret2ndWonPct: 49.6 } });
  const RT = { players: [{ key: '437', surfaces: { Hard: { last52: node(47), career: node(174) }, Clay: { last52: node(9), career: node(40, { firstWonPct: 70 }) }, All: { last52: node(60) } } },
    { key: '9', surfaces: { Hard: { last52: node(12), career: node(20) }, All: { last52: node(29) } } }] };
  assert.equal(MIN_BASE, 30);
  assert.deepEqual([baselineFor(RT, 437, 'hard').label, baselineFor(RT, 437, 'hard').matches], ['on hard over the last 52 weeks', 47]);
  assert.equal(baselineFor(RT, 437, 'clay').label, 'on clay in his career', 'a thin 52-week sample falls back to the career on that surface');
  assert.equal(baselineFor(RT, 437, 'carpet').label, 'on all surfaces over the last 52 weeks');
  assert.equal(baselineFor(RT, 9, 'hard'), null, 'under 30 matches everywhere: no comparison, never a guess');
  assert.equal(baselineFor(RT, 1, 'hard'), null); assert.equal(baselineFor(null, 437, 'hard'), null);
  const ms = (o, raw) => ({ p1: { ...o, raw } });
  const B = baselineFor(RT, 437, 'hard');
  const u = standoutUnits(ms({ 'Service:1st serve points won': 88.9, 'Service:2nd serve points won': 40, 'Service:1st serve percentage': 64, 'Service:Aces': 4 },
    { 'Service:1st serve points won': { won: 32, total: 36 }, 'Service:2nd serve points won': { won: 8, total: 20 } }), 'p1', 'H. Rune', B, { bp: { saved: 2, faced: 4 } });
  assert.deepEqual(u.map((x) => [x.text, x.tone]), [
    ['H. Rune won 89% of his first-serve points (32 of 36), above his 74% on hard over the last 52 weeks.', 'good'],
    ['H. Rune won 40% of his second-serve points (8 of 20), below his 54% on hard over the last 52 weeks.', 'bad']], 'first-in 64 v 62 and 2 of 4 break points and 4 aces are not news');
  assert.deepEqual(u[0].field, { metric: 'firstWon', value: 89, won: 32, total: 36, baseline: 74, scope: 'last52', surface: 'Hard', n: 47 });
  // close to the baseline, or too few points in the match: nothing
  assert.deepEqual(standoutUnits(ms({ 'Service:1st serve points won': 80 }, { 'Service:1st serve points won': { won: 28, total: 35 } }), 'p1', 'X', B), [], '80 v 74 is inside the 8-point gap');
  assert.deepEqual(standoutUnits(ms({ 'Service:1st serve points won': 100 }, { 'Service:1st serve points won': { won: 10, total: 10 } }), 'p1', 'X', B), [], '10 points is too few');
  // counts that say something by themselves, with or without a baseline
  const c = standoutUnits(ms({ 'Service:Aces': 13, 'Service:Double Faults': 6, 'Points:Winners': 50, 'Points:Unforced errors': 20 }, {}), 'p1', 'A. S', null, { bp: { saved: 0, faced: 3 } });
  assert.deepEqual(c.map((x) => [x.text, x.tone, x.kind]), [['A. S saved 0 of 3 break points.', 'bad', 'bp'], ['A. S hit 13 aces.', 'good', 'count'], ['A. S made 6 double faults.', 'bad', 'count']], 'at most 3 a player');
  assert.deepEqual(standoutUnits(ms({ 'Service:Aces': 9, 'Service:Double Faults': 4, 'Points:Winners': 29, 'Points:Unforced errors': 29 }, {}), 'p1', 'X', null, { bp: { saved: 3, faced: 7 } }), []);
  assert.deepEqual(standoutUnits(ms({}, {}), 'p1', 'X', null, { bp: { saved: 0, faced: 0 } }).map((x) => x.text), ['X faced no break points.']);
});
await ok('voice: an opinion word passes only in a sentence the code gave that tone, beside its number; "clutch" only for break points', async () => {
  const { checkSentence, playerRef } = await import('./news-ticker/humanise.mjs');
  const P = [playerRef('H. Rune', 'Holger Rune'), playerRef('M. Kecmanovic', 'Miomir Kecmanovic')];
  const S = 'H. Rune won 89% of his first-serve points (32 of 36), above his 74% on hard over the last 52 weeks.';
  const chk = (src, out, tone, kind) => checkSentence(src, out, { players: P, prevSubject: P[0], tone, kind }).ok;
  assert.ok(chk(S, 'Rune was strong on serve: he won 89% of his first-serve points (32 of 36), above his 74% on hard over the last 52 weeks.', 'good', 'rate'));
  assert.ok(!chk(S, 'Rune was strong on serve: he won 89% of his first-serve points (32 of 36), above his 74% on hard over the last 52 weeks.', null, 'rate'), 'no tone, no judgement');
  assert.ok(!chk(S, 'Rune was shaky: he won 89% of his first-serve points (32 of 36), above his 74% on hard over the last 52 weeks.', 'good', 'rate'), 'a bad word on a good number');
  assert.ok(!chk(S, 'Rune was clutch: he won 89% of his first-serve points (32 of 36), above his 74% on hard over the last 52 weeks.', 'good', 'rate'), 'clutch is for break points');
  assert.ok(!chk(S, 'Rune won 89% of his first-serve points (32 of 36), above his 71% on hard over the last 52 weeks.', 'good', 'rate'), 'the baseline changed');
  assert.ok(!chk(S, 'Rune won 89% of his first-serve points (32 of 36), below his 74% on hard over the last 52 weeks.', 'good', 'rate'), 'above turned into below');
  const Bp = 'H. Rune saved 0 of 3 break points.';
  assert.ok(chk(Bp, 'Rune was not clutch, he saved 0 of 3 break points.', 'bad', 'bp'));
  assert.ok(!chk(Bp, 'Rune was clutch, he saved 0 of 3 break points.', 'bad', 'bp'), 'a good word in a bad sentence needs "not"');
  assert.ok(!chk(Bp, 'Rune did not hold, he saved 0 of 3 break points.', 'bad', 'bp'));
  assert.ok(chk('H. Rune saved 4 of 4 break points.', 'Rune was clutch and saved 4 of 4 break points.', 'good', 'bp'));
});
// ---- tour-wide (founder 2026-11-12: press interviews and injuries for every ATP player, every day) ----
await ok('tour-wide: an article that names no tournament still yields its quote; each candidate carries the tournaments its article mentions', async () => {
  const SECTION = '<html>' + 'x'.repeat(700) + '<a href="/tennis/rune-on-his-long-road-back">Rune on his road back</a><a href="/tennis/other-long-article-slug">Other news</a></html>';
  const PAGE = (b) => `<html><head><script type="application/ld+json">{"datePublished":"2026-11-10T20:00:00Z"}</script></head><body><article><p>An interview.</p>${b}</article></body></html>` + 'x'.repeat(700);
  const body = { a: PAGE('<p>“My knee is finally pain free,” said Rune.</p>') };
  const fetchFn = async (url) => ({ status: 200, url, text: async () => (url.endsWith('/tennis/') ? SECTION : body.a) });
  const outlet = { outlet: 'Outlet', country: 'Denmark', language: 'en', status: 'allowed', enabled: true, sectionUrl: 'https://o.example/tennis/' };
  const base = { outlet, players: PL, nowIso: '2026-11-10T21:00:00Z', since: Date.parse('2026-10-20'), fetchFn };
  const narrow = await readOutlet({ ...base, tournamentName: 'Testville', cache: {}, sectionMemo: new Map() });
  assert.equal(narrow.candidates.length, 0, 'control: the tournament reader drops an article that does not name the tournament');
  const wide = await readOutlet({ ...base, tournamentNames: ['Testville'], cache: {}, sectionMemo: new Map() });
  assert.equal(wide.candidates.length, 1); assert.deepEqual(wide.candidates[0].mentions, []);
  body.a = PAGE('<p>Before Testville.</p><p>“My knee is finally pain free,” said Rune.</p>');
  const named = await readOutlet({ ...base, tournamentNames: ['Testville'], cache: {}, sectionMemo: new Map() });
  assert.deepEqual(named.candidates[0].mentions, ['testville']);
});
await ok('tour-wide: routing (field + article names the event -> that tournament; else a ranked player -> the tour file; else nowhere), field = top 200, tags', async () => {
  const { routeCandidate, tourPlayers, quoteCategory, TOUR_MAX_RANK } = await import('./news-ticker/collect-quotes.mjs');
  const now = '2026-11-10T21:00:00.000Z', T = [{ key: '77', folded: 'testville', since: Date.parse('2026-11-05'), fieldKeys: new Set(['1', '2']) }], tour = new Set(['1', '9']);
  const c = (o) => ({ speakerKey: '1', mentions: ['testville'], timestamp: '2026-11-10T10:00:00Z', ...o });
  assert.equal(routeCandidate(c({}), T, tour, now), '77');
  assert.equal(routeCandidate(c({ mentions: [] }), T, tour, now), 'tour', 'in the field but the article is not about the event');
  assert.equal(routeCandidate(c({ speakerKey: '9' }), T, tour, now), 'tour');
  assert.equal(routeCandidate(c({ speakerKey: '2', mentions: [] }), T, tour, now), null, 'not ranked and not about the event');
  assert.equal(routeCandidate(c({ speakerKey: '9', timestamp: '2026-11-06T10:00:00Z' }), T, tour, now), null, 'older than 3 days is not news');
  assert.equal(routeCandidate(c({ timestamp: '2026-11-01T10:00:00Z' }), T, tour, now), null, 'published before the edition');
  const P = tourPlayers({ players: [{ key: 1, name: 'Alexander Zverev', rank: 1 }, { key: 2, name: 'Old Timer', rank: TOUR_MAX_RANK + 1 }, { key: 3, name: 'No Rank', rank: null }, { key: 4, name: 'Juan Manuel Cerundolo', rank: 200 }, { key: 5, name: 'Alex De Minaur', rank: 7 }] });
  assert.deepEqual(P, [{ key: '1', name: 'A. Zverev' }, { key: '4', name: 'J. Cerundolo' }, { key: '5', name: 'A. De Minaur' }]);
  assert.equal(quoteCategory({ text: 'My knee is finally pain free.' }), 'Injuries');
  assert.equal(quoteCategory({ text: 'I feel good.', originalText: 'Jag har varit skadad länge.' }), 'Injuries', 'the original-language text counts');
  assert.equal(quoteCategory({ text: 'I served well.', eventKey: '5' }), 'Quotes');
  assert.equal(quoteCategory({ text: 'I want to come back stronger next year.' }), 'Interviews', '"back" alone is not an injury');
});
await ok('section links: RSS items and HTML anchors, same site only, article slugs only', () => {
  const rss = '<rss><channel><item><title>Rune wins</title><link>https://o.example/sport/rune-wins-in-stockholm</link><pubDate>Tue, 10 Nov 2026 20:00:00 GMT</pubDate></item><item><link>https://other.example/x-long-article-slug</link></item></channel></rss>';
  assert.deepEqual(sectionLinks(rss, 'https://o.example/feed'), [{ url: 'https://o.example/sport/rune-wins-in-stockholm', title: 'Rune wins', published: '2026-11-10T20:00:00.000Z' }]);
  assert.deepEqual(sectionLinks('<a href="/tennis/">Tennis</a><a href="/tennis/a-long-enough-article-slug">A</a>', 'https://o.example/').map((l) => l.url), ['https://o.example/tennis/a-long-enough-article-slug']);
});
await ok('off switch: an outlet set to "enabled": false loses its items from the feed on the next build; the others stay', () => {
  const q = (id, src) => ({ id, type: 'quote', playerId: '1', tournament: 'Testville', tournamentKey: '77', season: '2026', timestamp: '2026-11-10T14:00:00.000Z', timestampKind: 'observed', category: 'Quotes', text: 'I played well ' + id, language: 'en', translated: false, sourceName: src, sourceUrl: 'https://s/' + id });
  const files = { 'news-quotes/77-2026.json': { items: [q('quote-a', 'Outlet A'), q('quote-b', 'Outlet B')] }, 'data/news-outlets.json': { outlets: [{ outlet: 'Outlet A', enabled: true }, { outlet: 'Outlet B', enabled: true }] } };
  const d = fixture([card({ id: 'past-100' })], { files });
  runBuild(d, '2026-11-10T15:00:00.000Z'); assert.deepEqual(itemsOf(d).filter((x) => x.type === 'quote').map((x) => x.id).sort(), ['quote-a', 'quote-b']);
  fs.writeFileSync(path.join(d, 'data/news-outlets.json'), JSON.stringify({ outlets: [{ outlet: 'Outlet A', enabled: true }, { outlet: 'Outlet B', enabled: false }] }));
  const s2 = JSON.parse(runBuild(d, '2026-11-10T15:15:00.000Z')); assert.equal(s2.hiddenByOffSwitch, 1);
  assert.deepEqual(itemsOf(d).filter((x) => x.type === 'quote').map((x) => x.id), ['quote-a']);
});
await ok('collector scope: a tournament is active with a card today (UTC) or a match finished yesterday; older boards are idle', () => {
  const b = { 0: card({ id: 'past-1', date: '2026-11-10' }), 1: card({ id: 'u-2', date: '2026-11-12', finalScore: null }) };
  assert.equal(activeTournaments(b, '2026-11-11T08:00:00Z')[0].active, true);
  assert.equal(activeTournaments(b, '2026-11-14T08:00:00Z')[0].active, false);
});

// ---- the three alerts, each triggered once against a fake Telegram ----
const sent = [];
const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { sent.push(JSON.parse(b).text); res.writeHead(200); res.end('{}'); }); });
await new Promise((r) => srv.listen(0, r));
const TG = { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'pipeline-chat', TELEGRAM_API_URL: `http://127.0.0.1:${srv.address().port}` };
await ok('alert 1: a day with finished ATP matches and 0 reports -> one Telegram for that day, not repeated', async () => {
  const d = fixture([card({ id: 'past-100' }), card({ id: 'past-105', date: '2026-11-09' })]);
  fs.mkdirSync(path.join(d, 'news-ticker')); fs.writeFileSync(path.join(d, 'news-ticker', '77-2026.json'), JSON.stringify({ items: [{ type: 'report', eventKey: '105' }] }));
  assert.deepEqual(daysWithoutReports(JSON.parse(fs.readFileSync(path.join(d, 'matches.json'))), new Set(['105']), '2026-11-10'), [{ date: '2026-11-10', finished: 1, reports: 0 }]);
  const run = () => execFileP('node', [path.join(ROOT, 'tools/news-ticker/ticker-alerts.mjs'), '--dir', d, '--now', '2026-11-10T20:00:00Z'], { env: { ...process.env, ...TG }, encoding: 'utf8' });
  const before = sent.length; await run(); await run();
  assert.equal(sent.length, before + 1); assert.match(sent[sent.length - 1], /2026-11-10 has 1 finished ATP match and 0 reports written/);
});
await ok('alert 1 control: reports written for the day -> no message', () => {
  assert.deepEqual(daysWithoutReports({ 0: card({ id: 'past-100' }) }, new Set(['100']), '2026-11-10'), []);
  assert.deepEqual(daysWithoutReports({ 0: card({ id: 'past-100', walkover: true }) }, new Set(), '2026-11-10'), [], 'a day of walkovers only owes no report');
});
await ok(`alert 2: no new quote for ${SILENT_HOURS} hours while a tournament is on -> one message a day; a new quote resets it`, () => {
  let s = dueAlerts({}, { nowIso: '2026-11-10T08:00:00Z', anyActive: true, itemsHeldOrNew: { newItems: 0 }, modelError: null });
  assert.deepEqual(s.alerts, []);
  let s2 = dueAlerts(s.state, { nowIso: '2026-11-11T08:30:00Z', anyActive: true, itemsHeldOrNew: { newItems: 0 }, modelError: null });
  assert.equal(s2.alerts.length, 1); assert.match(s2.alerts[0], /no new quote for 24 hours/);
  assert.deepEqual(dueAlerts(s2.state, { nowIso: '2026-11-11T09:00:00Z', anyActive: true, itemsHeldOrNew: { newItems: 0 }, modelError: null }).alerts, [], 'not every 30 minutes');
  const s3 = dueAlerts(s.state, { nowIso: '2026-11-11T07:00:00Z', anyActive: true, itemsHeldOrNew: { newItems: 2 }, modelError: null });
  assert.deepEqual(dueAlerts(s3.state, { nowIso: '2026-11-11T08:30:00Z', anyActive: true, itemsHeldOrNew: { newItems: 0 }, modelError: null }).alerts, []);
  assert.deepEqual(dueAlerts(s.state, { nowIso: '2026-11-20T08:00:00Z', anyActive: false, itemsHeldOrNew: { newItems: 0 }, modelError: null }).alerts, [], 'no tournament on: silence is expected');
});
await ok('alert 3: a model call failing on credit or key -> a message on the FIRST failure, none while it keeps failing', () => {
  const e = { http: 400, detail: 'HTTP 400 Your credit balance is too low' };
  const a = dueAlerts({}, { nowIso: '2026-11-11T08:00:00Z', anyActive: true, itemsHeldOrNew: { newItems: 0 }, modelError: e });
  assert.equal(a.alerts.length, 1); assert.match(a.alerts[0], /translation model call failed \(HTTP 400 .*credit balance/);
  assert.deepEqual(dueAlerts(a.state, { nowIso: '2026-11-11T08:30:00Z', anyActive: true, itemsHeldOrNew: { newItems: 0 }, modelError: e }).alerts, []);
  const okRun = dueAlerts(a.state, { nowIso: '2026-11-11T09:00:00Z', anyActive: true, itemsHeldOrNew: { newItems: 1, translatedOk: true }, modelError: null });
  assert.equal(okRun.state.modelFailingSince, undefined);
  assert.equal(dueAlerts(okRun.state, { nowIso: '2026-11-11T09:30:00Z', anyActive: true, itemsHeldOrNew: { newItems: 0 }, modelError: e }).alerts.length, 1, 'a new streak alerts again');
});
await ok('alerts 2 and 3 reach Telegram: the workflow\'s test switch sends both marked messages', async () => {
  const before = sent.length;
  await execFileP('node', [path.join(ROOT, 'tools/news-ticker/collect-quotes.mjs'), '--test-alerts'], { env: { ...process.env, ...TG }, encoding: 'utf8' });
  assert.equal(sent.length, before + 2); assert.match(sent[before], /^TEST — News ticker alert 2 of 3/); assert.match(sent[before + 1], /^TEST — News ticker alert 3 of 3/);
});
srv.close();

// ---- wiring ----
await ok('wiring: the feed is built in the pipeline before the site is assembled, published, committed back; data paths declared', () => {
  const p = read('.github/workflows/pipeline.yml');
  const b = p.indexOf('- name: Build news ticker (best-effort)'), a = p.indexOf('- name: Assemble site'), al = p.indexOf('a day of finished matches with no reports'), c = p.indexOf('- name: Commit news ticker (only if changed)');
  assert.ok(b > 0 && b < a && al > b && al < a && c > a);
  assert.ok(/cp news-ticker\.json news-ticker-run\.json _site\//.test(p) && /cp news-ticker\/\*-\[0-9\]/.test(p));
  assert.ok(/node tools\/news-ticker\/ticker-alerts\.mjs/.test(p));
  const alertStep = p.slice(al, a); assert.ok(/TELEGRAM_PIPELINE_CHAT_ID/.test(alertStep) && /if: \$\{\{ always\(\) \}\}/.test(alertStep));
  const cs = p.slice(c, p.indexOf('- name:', c + 10)); assert.ok(/if: \$\{\{ !cancelled\(\) \}\}/.test(cs), 'items are committed even when a later check failed the run');
  const lane = read('tools/deploy-lane.mjs'); assert.ok(/DATA_DIRS\.push\('news-ticker\/', 'news-quotes\/'\)/.test(lane) && /DATA_FILES\.add\('news-ticker\.json'\)/.test(lane));
});
await ok('polite rate: the collector never collects twice inside 25 minutes', async () => {
  const { tooSoon, MIN_GAP_MIN } = await import('./news-ticker/collect-quotes.mjs');
  const now = '2026-11-11T12:00:00.000Z', ago = (m) => Date.parse(now) - m * 60000;
  assert.strictEqual(MIN_GAP_MIN, 25);
  assert.strictEqual(tooSoon(ago(10), now), true); assert.strictEqual(tooSoon(ago(24.9), now), true);
  assert.strictEqual(tooSoon(ago(25), now), false); assert.strictEqual(tooSoon(ago(31), now), false);
  assert.strictEqual(tooSoon(NaN, now), false, 'no earlier run on record');
  const src = read('tools/news-ticker/collect-quotes.mjs');
  assert.ok(/tooSoon\(lastRun, nowIso\)\) \{.*return; \}$/m.test(src) && src.indexOf('tooSoon(lastRun') < src.indexOf("getJson('matches.json')"), 'the gate sits before any request');
  assert.ok(/\n  state\.lastRunAt = nowIso;/.test(src), 'every run reads outlets (the tour-wide pass), so every run stamps the gate');
});
await ok('observed times: the database read is retried before the run gives up on it', () => {
  const src = read('tools/news-ticker/build-news-ticker.mjs');
  assert.ok(/for \(let t = 0; t < 3 && !rows; t\+\+\)/.test(src) && /AbortSignal\.timeout\(45000\)/.test(src));
});
await ok('wiring: the quote job runs every 30 minutes from main, the key only in Actions secrets, and alerts when it fails', () => {
  const w = read('.github/workflows/news-quotes.yml');
  assert.ok(/cron: '7,37 \* \* \* \*'/.test(w)); assert.ok(/ref: main/.test(w));
  assert.ok(/ANTHROPIC_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/.test(w)); assert.ok(/TELEGRAM_PIPELINE_CHAT_ID/.test(w));
  assert.ok(/^      - 'News ticker quotes'$/m.test(read('.github/workflows/job-fail-alert.yml')) && /^name: News ticker quotes$/m.test(w), 'the job-failure alert watches it');
  assert.ok(/\[skip ci\]/.test(w));
  // the cadence does not depend on GitHub's schedule: each run starts the next, 30 minutes after it began
  assert.ok(/actions: write/.test(w) && /STARTED \+ 1800/.test(w) && /gh workflow run news-quotes\.yml --ref main/.test(w) && /select\(\.id != \$GITHUB_RUN_ID\)/.test(w));
  const chain = w.slice(w.indexOf('- name: Start the next run')); assert.ok(/if: \$\{\{ !cancelled\(\) \}\}/.test(chain), 'a failed collection still starts the next run');
  for (const f of ['bsp-consult-dashboard.html', 'player-profile-v2.js']) assert.ok(!/api\.anthropic\.com|ANTHROPIC_API_KEY/.test(read(f)), f + ' must never call the model');
});
console.log(`news ticker live: ${n} checks passed`);
