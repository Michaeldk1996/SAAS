#!/usr/bin/env node
// TEN-443 · tools/te-build-history.mjs — the parse that turns a cached Tennis Explorer page into store rows.
//   * the calendar date: TE prints "dd.mm." and lists newest first, so a December row BELOW a Jan–Nov row was played
//     the year before the page (a United Cup tie on 30.12 on the 2024 page is 2023-12-30, season 2024); a December row
//     at the TOP is that December; a page of December rows only is flagged dateAmbiguous
//   * an opponent with no TE player link is kept with his printed name, never dropped
//   * the category allowlist: ATP only for a catalogued event; Futures groups (2- and 4-digit years) are ITF; club and
//     exhibition events are 'Exhibition'; an event no catalogue names is 'Other' (never counted on a guess)
//   * the self-reconcile: rows minus walkovers against TE's own table, per column
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// a throw-away catalogue: the builder must classify from it, not from a name pattern
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'te-build-'));
fs.writeFileSync(path.join(cache, 'apitennis-tournaments.json'), JSON.stringify({ result: [
  { tournament_name: 'United Cup', event_type_type: 'Atp Singles' }, { tournament_name: 'Kitzbuhel', event_type_type: 'Atp Singles' },
  { tournament_name: 'St. Petersburg', event_type_type: 'Atp Singles' }, { tournament_name: 'Brisbane', event_type_type: 'Atp Singles' }] }));
process.env.TE_CACHE = cache;
process.env.TML_CACHE = path.join(cache, 'no-tml');
process.argv.push('--cache', cache);
const B = await import('./te-build-history.mjs');

let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('  ok   ' + n); } catch (e) { fail++; console.log('  FAIL ' + n + ' :: ' + e.message); } };
const head = (name, href) => `<tr class="head flags"><td class="t-name" colspan="3">${href ? `<a href="${href}">` : '<span>'}${name}${href ? '</a>' : '</span>'}</td></tr>`;
const row = (dm, surf, a, b, round, score) => `<tr class="one"><td class="first time">${dm}</td><td class="s-color">${surf ? `<span title="${surf}">&nbsp;</span>` : '&nbsp;'}</td>` +
  `<td class="t-name">${a} - ${b}</td><td class="round">${round}</td><td class="tl"><a href="/match-detail/?id=1">${score}</a></td></tr>`;
const me = '<a href="/player/me/" class="notU"><strong>Me M.</strong></a>';
const opp = (s) => `<a href="/player/${s}/">${s} X.</a>`;
const page = (season, body) => `<div id="matches-${season}-1-data"><table class="result balance">${body}</table></div>`;

check('a December row below January rows is the year before the page; season stays the page year', () => {
  const html = page(2024, head('Brisbane', '/brisbane/2024/atp-men/') + row('02.01.', 'hard', me, opp('a'), '1R', '6-3, 6-4') +
    head('United Cup', '/united-cup/2024/atp-men/') + row('30.12.', 'hard', me, opp('b'), '', '6-4, 6-4'));
  const r = B.parseSeason(html, 'me', 2024);
  assert.deepStrictEqual(r.map((x) => [x.date, x.season]), [['2024-01-02', 2024], ['2023-12-30', 2024]]);
});
check('a December row at the top of the page is that December', () => {
  const html = page(2024, head('Futures 2024', null) + row('20.12.', 'clay', me, opp('c'), '1R', '6-1, 6-1') + row('14.11.', 'clay', me, opp('d'), '1R', '6-1, 6-1'));
  assert.deepStrictEqual(B.parseSeason(html, 'me', 2024).map((x) => x.date), ['2024-12-20', '2024-11-14']);
});
check('a page of December rows only is flagged dateAmbiguous', () => {
  const r = B.parseSeason(page(2024, head('Futures 2024', null) + row('28.12.', 'hard', me, opp('e'), '1R', '6-1, 6-1')), 'me', 2024);
  assert.strictEqual(r[0].dateAmbiguous, true);
});
check('an opponent with no TE player link is kept with his printed name (won and lost)', () => {
  const html = page(2016, head('Maui challenger', '/maui/2016/atp-men/') + row('23.01.', 'hard', me, 'Ellen K.', 'Q-1R', '6-0, 6-0') + row('22.01.', 'hard', 'Plain P.', me, 'Q-1R', '6-0, 6-0'));
  const r = B.parseSeason(html, 'me', 2016);
  assert.strictEqual(r.length, 2); assert.deepStrictEqual(r.map((x) => [x.opp, x.oppSlug, x.won]), [['Ellen K.', null, true], ['Plain P.', null, false]]);
});
check('walkover = blank result; the winner is the first name', () => {
  const r = B.parseSeason(page(2025, head('Brisbane', '/b/') + row('03.01.', 'hard', opp('f'), me, 'R16', '')), 'me', 2025)[0];
  assert.strictEqual(r.wo, true); assert.strictEqual(r.won, false);
});
check('categories: Futures 09 and Futures 2021 are ITF (+ qual); Challenger Tour Finals counts', () => {
  assert.strictEqual(B.categoryOf('Futures 09', '1R'), 'ITF'); assert.strictEqual(B.categoryOf('Futures 2021', 'Q-1R'), 'ITF qual');
  assert.strictEqual(B.categoryOf('Oeiras 6 challenger', 'F'), 'Challenger'); assert.strictEqual(B.categoryOf('Challenger Tour Finals', 'F'), 'Challenger');
});
check('categories: a catalogued ATP event in TE spelling is ATP (Kitzbühel, Saint Petersburg)', () => {
  assert.strictEqual(B.categoryOf('Kitzbühel', '1R'), 'ATP'); assert.strictEqual(B.categoryOf('Saint Petersburg', 'Q-1R'), 'ATP qual');
});
check('categories: club and exhibition events are Exhibition; an uncatalogued event is Other, never ATP', () => {
  for (const e of ['Czech league', 'Swiss Nationalliga A', 'Italian Team Championship', 'Kooyong - exh.', 'Bundesliga - men', 'France - Championship', 'Adelaide - World Tennis Chall.', 'UTR Pro Tennis Series 3'])
    assert.strictEqual(B.categoryOf(e, ''), 'Exhibition', e);
  for (const e of ['Pan American Games', 'AO Wildcard Playoff - Australia', 'Rome - pre-qualification', 'European Pro Tennis Series'])
    assert.strictEqual(B.categoryOf(e, ''), 'Other', e);
  assert.strictEqual(B.categoryOf('Davis Cup', ''), 'Davis Cup'); assert.strictEqual(B.categoryOf('Hopman Cup', ''), 'Hopman Cup');
});
check('self-reconcile: rows minus walkovers equal TE\'s table, per column; a difference is reported', () => {
  const rows = [{ season: 2024, won: true, surface: 'hard', court: 'outdoor' }, { season: 2024, won: false, surface: null, court: 'indoor' },
    { season: 2024, won: true, surface: 'clay', court: 'outdoor', wo: true }];
  const bal = { 2024: { total: [1, 1], clay: null, hard: [1, 0], indoors: [0, 1], grass: null, notset: null } };
  assert.deepStrictEqual(B.reconcileBalance(rows, bal), []);
  assert.strictEqual(B.reconcileBalance(rows, { 2024: { ...bal[2024], hard: [2, 0] } }).length, 1);
});
check('store round-trip: rows are written one per line and read back with src te', () => {
  const rec = { key: 'k', rows: [{ season: 2024, date: '2024-01-02', event: 'Brisbane', cat: 'ATP', round: '1R', surface: 'hard', court: 'outdoor', opp: 'A X.', oppSlug: 'a', won: true, score: '6-3, 6-4', wo: false }] };
  const txt = B.serialise(rec); assert.ok(txt.split('\n').length >= 3);
  const back = B.rowsOf(JSON.parse(txt)); assert.strictEqual(back[0].src, 'te'); assert.strictEqual(back[0].won, true); assert.deepStrictEqual(back[0].sets, [{ w: 6, l: 3 }, { w: 6, l: 4 }]);
});
// TEN-449 provisional: the builder writes each player's readAt = the later of the cache's fetch times (mtime) of his
// latest season page and his profile page; none when the profile shows a newer season than any cached page; and never
// earlier than the readAt already in the store
{
  const { execFileSync } = await import('node:child_process');
  const c2 = fs.mkdtempSync(path.join(os.tmpdir(), 'te-build-ra-')), out = fs.mkdtempSync(path.join(os.tmpdir(), 'te-build-out-'));
  fs.mkdirSync(path.join(c2, 'html'));
  const cf = (rel) => path.join(c2, 'html', rel.replace(/^\/+/, '').replace(/[^A-Za-z0-9._-]+/g, '_') + '.html');
  const balRow = (y) => `<tr><td>${y}</td><td>1/0</td><td>-</td><td>1/0</td><td>-</td><td>-</td><td>-</td></tr>`;
  const bal = (ys) => `<div id="balMenu-1-data"><table>${ys.map(balRow).join('')}</table></div>`;
  const put = (rel, html, iso) => { fs.writeFileSync(cf(rel), html); const t = new Date(iso); fs.utimesSync(cf(rel), t, t); };
  // [key, slug, season, season page read, profile read, seasons the profile shows]
  const P = [['1', 'me', 2026, '2026-10-18T07:43:00Z', '2026-10-17T10:00:00Z', [2026]],     // season page later: its time
    ['2', 'jan', 2025, '2025-12-20T09:00:00Z', '2026-01-08T10:00:00Z', [2025]],              // January: profile later, no 2026 -> profile
    ['3', 'nw', 2025, '2026-10-18T09:00:00Z', '2026-10-18T10:00:00Z', [2026]],                // profile shows 2026, no page -> no readAt
    ['4', 'kept', 2026, '2026-10-18T07:00:00Z', '2026-10-18T06:00:00Z', [2026]]];             // the store already holds a later read
  const players = {};
  for (const [key, slug, y, seasonAt, profAt, shows] of P) {
    const who = `<a href="/player/${slug}/" class="notU"><strong>Me M.</strong></a>`;
    put(`/player/${slug}/`, bal(shows.includes(y) ? shows : [...shows, y]).replace(balRow(2026), shows.includes(2026) && y !== 2026 ? '<tr><td>2026</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td></tr>' : balRow(2026)), profAt);
    put(`/player/${slug}/?annual=${y}`, page(y, head('Brisbane', '/brisbane/') + row('05.01.', 'hard', who, opp('aa'), '1R', '6-1, 6-1')), seasonAt);
    players[key] = { slug, years: [y], dob: '19920101', name: slug, how: 'dob' };
  }
  fs.writeFileSync(path.join(c2, 'players.json'), JSON.stringify(players));
  // our DOB for each key (the builder refuses a join with no DOB of ours on record, TEN-449 Bucket D)
  fs.writeFileSync(path.join(c2, 'roster.json'), JSON.stringify(P.map(([key]) => ({ key, dob: '19920101' }))));
  fs.writeFileSync(path.join(out, 'te-atp-events.json'), JSON.stringify({ names: ['brisbane'] }));
  fs.mkdirSync(path.join(out, 'te-history'));
  fs.writeFileSync(path.join(out, 'te-history', '4.json'), JSON.stringify({ key: '4', readAt: '2026-10-19T05:00:00.000Z', rows: [] }));
  let err = null;
  try { execFileSync(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), 'te-build-history.mjs'), '--cache', c2, '--out', out], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TE_CACHE: c2 } }); } catch (e) { err = String(e.stderr || e.message); }
  const idx = err ? null : JSON.parse(fs.readFileSync(path.join(out, 'te-history-index.json'), 'utf8'));
  const rec = (k) => JSON.parse(fs.readFileSync(path.join(out, 'te-history', `${k}.json`), 'utf8'));
  const both = (k, want) => { assert.strictEqual(err, null, err); assert.strictEqual(rec(k).readAt, want, `file ${k}`); assert.strictEqual(idx.players[k] && idx.players[k].readAt, want, `index ${k}`); };
  check('TEN-449 · readAt: the season page read after the profile -> the season page\'s time', () => both('1', '2026-10-18T07:43:00.000Z'));
  check('TEN-449 · readAt: January — the profile read later, showing no newer season -> the profile\'s time', () => both('2', '2026-01-08T10:00:00.000Z'));
  check('TEN-449 · readAt: the profile shows a season newer than any cached page -> no readAt (no provisional rows)', () => {
    assert.strictEqual(err, null, err); assert.ok(idx.players['3'], 'the player is written (else this proves nothing)');
    assert.strictEqual(idx.players['3'].readAt, undefined); assert.strictEqual(rec('3').readAt, undefined);
  });
  check('TEN-449 · readAt: never moved backwards against the record already in the store', () => both('4', '2026-10-19T05:00:00.000Z'));
}
console.log(`\nte-build-history: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
