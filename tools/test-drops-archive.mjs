// Dropping Odds archive (founder 2026-11-28): the endpoint's reader (stennisfy-drops/archive.mjs), the /archive.json
// route and the SQL's rules (tools/drops-archive.sql). The SQL itself runs in the database (installed by
// ten294-drops.yml); here its text is checked for the rules a regex can see. Rules: .claude/rules/drops.md.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { summarise, noMargin, pts, scoreOf, bigStep, createArchiveService } from '../stennisfy-drops/archive.mjs';
import { createDropsService } from '../stennisfy-drops/server.mjs';

const req = createRequire(import.meta.url);
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let passed = 0, failed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); } };
const H = 3600e3, T0 = Date.parse('2026-11-27T12:00:00Z'), at = (h) => new Date(T0 + h * H).toISOString();
const REC = {
  key: '1|alpha', event_key: 1, player_a: 'Alan Alpha', player_b: 'Bruno Beta', side: 'Alan Alpha', side_first: true, winner_first: true,
  status: 'Finished', event_type: 'Challenger Men Singles', tournament: 'Testville', round: 'R16', scheduled_at: at(10), start_at: at(10),
  books: {
    Bet105: { side: [[at(0), 2.10], [at(3), 1.60]], other: [[at(-0.5), 1.80], [at(6), 2.40]] },
    Superbet: { side: [[at(1), 2.10], [at(4), 1.90], [at(7), 1.70]], other: [] },
    'Napoleon Sports BE': { side: [[at(1), 2.20], [at(5), 1.80]], other: [] },
  },
};

await t('Bet105 without its margin = the live page\'s rule, point for point (drops-page.js)', () => {
  const page = req('../drops-page.js');
  const line = { key: 'k', playerA: 'Alan Alpha', playerB: 'Bruno Beta', side: 'Alan Alpha', books: { Bet105: { ...REC.books.Bet105, lastSeen: at(9) } } };
  const row = { id: 'x', book: 'Bet105', tier: 'Challenger', playerA: 'Alan Alpha', playerB: 'Bruno Beta', side: 'Alan Alpha', detectedAt: at(3), scheduledStart: at(10), match: { status: 'not_started' } };
  const sel = page.buildSelections([line], [row], T0 + 9 * H).find((s) => /Alpha/.test(s.side));
  const ours = noMargin(pts(REC.books.Bet105.side), pts(REC.books.Bet105.other));
  assert.equal(JSON.stringify(ours.map((p) => +p.v.toFixed(4))), JSON.stringify(sel.bk._b105nm.series.map((p) => +p.v.toFixed(4))));
});

await t('a record: sharp (Bet105 no margin) and soft (the average of the soft books with two prices), drop / pts on the 2 dp prices, the soft delay', () => {
  const r = summarise(REC, { event_status: 'Finished', scores: [{ score_first: '6', score_second: '4' }, { score_first: '7.7', score_second: '6.5' }] });
  assert.equal(r.sharp.o, 2.17); assert.equal(r.sharp.c, 1.67); assert.equal(r.sharp.drop, 23); assert.equal(r.sharp.pts, 13.8);
  assert.equal(JSON.stringify(r.sharp.mv), JSON.stringify({ from: 2.17, to: 1.89, at: at(3), pct: 12.9 }), 'the largest single step');
  assert.equal(r.soft.o, 2.15); assert.equal(r.soft.c, 1.75); assert.equal(r.soft.book, 'avg');
  assert.equal(r.soft.mv.from, 2.2); assert.equal(r.soft.mv.to, 1.8, 'the largest step at any soft book');
  assert.equal(r.lagMin, 120, 'the soft books\' biggest step came 2 h after the sharp one');
  assert.equal(r.won, true); assert.equal(r.score, '6-4  7-6'); assert.equal(r.tier, 'Challenger'); assert.equal(r.opp, 'Bruno Beta');
});

await t('no verified start: no close (never a snapshot called a close); the drop still reads to the last recorded price', () => {
  const r = summarise({ ...REC, start_at: null }, null);
  assert.equal(r.sharp.c, null); assert.equal(r.soft.c, null); assert.equal(r.score, null, 'no fixture: no score, never a guess');
  assert.equal(r.sharp.drop, 23);
});

await t('orientation: the score and the result follow the side; a retirement is marked', () => {
  const f = { event_status: 'Retired', scores: [{ score_first: '6', score_second: '3' }, { score_first: '2', score_second: '1' }] };
  assert.equal(scoreOf(f, false), '3-6  1-2 ret.');
  const r = summarise({ ...REC, side: 'Bruno Beta', side_first: false, winner_first: true }, f);
  assert.equal(r.won, false); assert.equal(r.opp, 'Alan Alpha');
  assert.equal(scoreOf({ scores: [{ score_first: '', score_second: '4' }] }, true), null, 'a set without games is no score');
});

await t('one soft book with two prices names itself; a book with one price is no reading', () => {
  const r = summarise({ ...REC, books: { ...REC.books, 'Napoleon Sports BE': { side: [[at(1), 2.2]], other: [] } } }, null);
  assert.equal(r.soft.book, 'Superbet'); assert.equal(r.soft.o, 2.1);
  assert.equal(bigStep(pts([[at(1), 2], [at(2), 2.1]])), null, 'a rise is no step down');
});

await t('/archive.json: 503 before the first read, the body after, gzip and ETag; a failed read keeps the last good body', async () => {
  let fail = false, calls = 0;
  const a = createArchiveService({ readArchive: async () => { if (fail) throw new Error('x'); return [REC]; }, fetchFixture: async () => { calls++; return null; }, now: () => T0 });
  const svc = createDropsService({ readSnapshot: async () => ({ rows: [], sources: [] }), origins: ['https://app.stennisfy.com'], archive: a });
  const call = (h = {}) => new Promise((ok) => { const res = { writeHead(c, hd) { this.c = c; this.h = hd; }, end(b) { ok({ code: this.c, h: this.h, body: b }); } };
    svc.handle({ url: '/archive.json', method: 'GET', headers: { origin: 'https://app.stennisfy.com', ...h } }, res); });
  assert.equal((await call()).code, 503);
  await a.readOnce(); const r = await call();
  assert.equal(r.code, 200); assert.equal(JSON.parse(r.body).rows[0].key, '1|alpha'); assert.equal(r.h['Access-Control-Allow-Origin'], 'https://app.stennisfy.com');
  assert.equal((await call({ 'if-none-match': r.h.ETag })).code, 304);
  await a.readOnce(); assert.equal(calls, 2, 'a match api-tennis had nothing for is asked again on the next read');
  fail = true; await a.readOnce(); assert.equal((await call()).code, 200, 'the last good body stays');
});

await t('the SQL: insert-only, decided matches only (no walkover), one api-tennis match per selection, cut at the verified start, 90 days, reader-only grant', () => {
  const sql = read('tools/drops-archive.sql').replace(/--.*$/gm, '');
  assert.match(sql, /on conflict \(key\) do nothing/); assert.doesNotMatch(sql, /\bupdate drops_archive\.records\b/);
  assert.match(sql, /event_status in \('Finished', 'Retired'\) and event_winner in \('First Player', 'Second Player'\)/);
  assert.match(sql, /\(select count\(\*\) from fx y where y\.pa = fx\.pa and y\.pb = fx\.pb and y\.sp = fx\.sp\) = 1/);
  assert.match(sql, /left join public\.live_flip_log_current lf on lf\.event_key = o\.event_key::text/);
  assert.match(sql, /\(e->>0\)::timestamptz < p_cut/, 'nothing at or after the start');
  assert.match(sql, /interval '90 days'/);
  assert.match(sql, /grant execute on function drops_archive\.read\(integer\) to drops_reader/);
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated)/);
  const steps = JSON.parse(read('tools/ten294-steps-install.json')).map((s) => s.name);
  assert.ok(steps.indexOf('install_archive') > steps.indexOf('install'), 'installed after drops_api (it reads lines())');
  assert.match(read('stennisfy-drops/Dockerfile'), /COPY server\.mjs status\.mjs archive\.mjs/);
});

console.log(`test-drops-archive: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
