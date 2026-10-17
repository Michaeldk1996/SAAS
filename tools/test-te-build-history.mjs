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
console.log(`\nte-build-history: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
