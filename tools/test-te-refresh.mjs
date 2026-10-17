#!/usr/bin/env node
// TEN-443 · tools/te-refresh.mjs, the GitHub Actions refresh of the Tennis Explorer store (founder 2026-10-17, item 1).
// The real tool runs as a child process with fetch stubbed (tools/fixtures/te-refresh-stub.mjs serves generated TE
// pages and an api-tennis birthday, and logs every request), against a throw-away repo root:
//   * weekly: an existing player costs his profile + current season only — 2 pages;
//   * a player new to the roster gets his FULL history on his first refresh (the fixture player "Newman"), joined on
//     the api-tennis birthday;
//   * a TE correction to a past season (its table changed) is re-read, and the changed row is reported old -> new;
//   * reread: the day's 1/28 slice re-reads every season of its players, and nobody else is fetched;
//   * a blocked page (429) or a player whose rows refuse to reconcile: exit non-zero, the store is byte-identical;
//   * the refresh never builds a store from nothing (index missing -> exit 1).
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

let pass = 0, fail = 0;
const check = (n, fn) => { try { fn(); pass++; console.log('  ok   ' + n); } catch (e) { fail++; console.log('  FAIL ' + n + ' :: ' + e.message); } };
const HERE = path.dirname(new URL(import.meta.url).pathname);
const TOOL = path.join(HERE, 'te-refresh.mjs');
const STUB = path.join(HERE, 'fixtures', 'te-refresh-stub.mjs');

// ── generated TE pages ────────────────────────────────────────────────────────────────────────────────────────────
const row = (dm, me, opp, won, score) => `<tr class="one"><td class="first time">${dm}</td><td class="s-color"><span title="hard">&nbsp;</span></td>` +
  `<td class="t-name">${won ? `<a href="/player/${me}/" class="notU"><strong>Me M.</strong></a> - <a href="/player/${opp}/">${opp} X.</a>` : `<a href="/player/${opp}/">${opp} X.</a> - <a href="/player/${me}/" class="notU"><strong>Me M.</strong></a>`}</td>` +
  `<td class="round">1R</td><td class="tl"><a href="/match-detail/?id=1">${score}</a></td></tr>`;
const season = (y, slug, matches) => `<div id="matches-${y}-1-data"><table class="result balance"><tr class="head flags"><td class="t-name" colspan="3"><a href="/brisbane/${y}/atp-men/">Brisbane</a></td></tr>` +
  matches.map(([dm, opp, won, sc]) => row(dm, slug, opp, won, sc)).join('') + '</table></div>';
const balRow = (y, w, l) => `<tr><td>${y}</td><td>${w}/${l}</td><td>-</td><td>${w}/${l}</td><td>-</td><td>-</td><td>-</td></tr>`;
const profile = (slug, dob, seasons) => `<table class="plDetail"><tr><td>Me M. Country: Australia Age: 30 (${dob}) Current</td></tr></table>` +
  `<div id="balMenu-1-data"><table class="result balance">${seasons.map(([y, w, l]) => balRow(y, w, l)).join('')}</table></div>` +
  seasons.map(([y]) => `<a href="/player/${slug}/?annual=${y}">${y}</a>`).join(' ') + '<div>' + 'x'.repeat(6000) + '</div>';
const pad = (h) => h + '<div>' + 'x'.repeat(6000) + '</div>';
function pages(opts = {}) {
  const old2025 = opts.corrected ? [['10.03.', 'bb', false, '6-4, 6-4']] : [['10.03.', 'bb', true, '6-4, 6-4']];
  return {
    '/player/alpha/': profile('alpha', '1. 2. 1996', [[2026, 1, 0], [2025, ...(opts.corrected ? [0, 1] : [1, 0])]]),
    '/player/alpha/?annual=2026': pad(season(2026, 'alpha', [['05.01.', 'aa', true, '6-1, 6-1']])),
    '/player/alpha/?annual=2025': pad(season(2025, 'alpha', old2025)),
    '/list-players/?search-text-pl=Newman': pad('<table><tr class="one"><td class="first rank">1.</td><td class="t-name"><span class="fl" title="Australia">&nbsp;</span>&nbsp;<a href="/player/newman-1/">Newman, Nate</a></td></tr></table>'),
    '/player/newman-1/': profile('newman-1', '3. 4. 2000', [[2026, 1, 0], [2024, 0, 1], [2023, 1, 0]]),
    '/player/newman-1/?annual=2026': pad(season(2026, 'newman-1', [['06.02.', 'cc', true, '6-2, 6-2']])),
    '/player/newman-1/?annual=2024': pad(season(2024, 'newman-1', [['07.03.', 'dd', false, '6-3, 6-3']])),
    '/player/newman-1/?annual=2023': pad(season(2023, 'newman-1', [['08.04.', 'ee', true, '7-5, 7-5']])),
    ...(opts.block ? { '/player/alpha/?annual=2026': 429 } : {}),
    ...(opts.refuse ? { '/player/alpha/?annual=2026': pad(season(2026, 'alpha', [['05.01.', 'aa', true, '6-1, 6-1'], ['06.01.', 'zz', true, '6-1, 6-1'], ['07.01.', 'yy', true, '6-1, 6-1'], ['08.01.', 'ww', true, '6-1, 6-1']])) } : {}),
  };
}

// ── a throw-away repo root holding the committed store ─────────────────────────────────────────────────────────────
const COLS = ['season', 'date', 'event', 'cat', 'round', 'surface', 'court', 'opp', 'oppSlug', 'won', 'score', 'wo', 'ret', 'teMatchId', 'dateAmbiguous'];
function repo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'te-refresh-'));
  fs.mkdirSync(path.join(d, 'te-history'));
  const rows = [[2026, '2026-01-05', 'Brisbane', 'ATP', '1R', 'hard', 'outdoor', 'aa X.', 'aa', 1, '6-1, 6-1', 0, 0, '1', 0],
    [2025, '2025-03-10', 'Brisbane', 'ATP', '1R', 'hard', 'outdoor', 'bb X.', 'bb', 1, '6-4, 6-4', 0, 0, '1', 0]];
  const bal = { 2026: { total: [1, 0], clay: null, hard: [1, 0], indoors: null, grass: null, notset: null }, 2025: { total: [1, 0], clay: null, hard: [1, 0], indoors: null, grass: null, notset: null } };
  fs.writeFileSync(path.join(d, 'te-history', '1.json'), JSON.stringify({ key: '1', slug: 'alpha', dob: '19960201', name: 'A. Alpha', src: 'te', format: 'te-history/1', cols: COLS, balance: bal, rows }));
  fs.writeFileSync(path.join(d, 'te-history-index.json'), JSON.stringify({ players: { 1: { slug: 'alpha', dob: '19960201', rows: 2, seasons: 2 } }, totalRows: 2, highWater: { totalRows: 2, players: 1 } }));
  fs.writeFileSync(path.join(d, 'te-atp-events.json'), JSON.stringify({ names: ['brisbane'] }));
  fs.writeFileSync(path.join(d, 'roster.json'), JSON.stringify({ players: { 1: { name: 'A. Alpha', country: 'Australia', age: 30, careerByYear: [{}] }, 2: { name: 'N. Newman', country: 'Australia', age: 26, careerByYear: [{}] } } }));
  return d;
}
function run(d, mode, opts = {}, now = '2026-10-19T05:00:00Z') {
  const log = path.join(d, 'requests.log');
  fs.writeFileSync(path.join(d, 'pages.json'), JSON.stringify(pages(opts)));
  let code = 0, out = '';
  try {
    out = execFileSync(process.execPath, ['--import', STUB, TOOL, '--root', d, '--mode', mode], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TE_DELAY_MS: '0', TE_STUB_PAGES: path.join(d, 'pages.json'), TE_STUB_LOG: log, TE_ROSTER: path.join(d, 'roster.json'),
        API_TENNIS_KEY: 'x', TE_NOW: now, TE_CACHE: fs.mkdtempSync(path.join(os.tmpdir(), 'te-c-')) } });
  } catch (e) { code = e.status; out = String(e.stdout || '') + String(e.stderr || ''); }
  const reqs = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  return { code, out, reqs };
}
const snapshot = (d) => JSON.stringify(['te-history-index.json', ...fs.readdirSync(path.join(d, 'te-history')).map((f) => 'te-history/' + f)].map((f) => [f, fs.readFileSync(path.join(d, f), 'utf8')]));
const te = (url) => url.includes('tennisexplorer');

{
  const d = repo(); const r = run(d, 'weekly');
  const teReqs = r.reqs.filter(te);
  check('weekly: exit 0', () => assert.strictEqual(r.code, 0, r.out));
  check('weekly: the existing player costs 2 pages (profile + current season), not his past seasons', () => {
    const a = teReqs.filter((u) => /\/player\/alpha\//.test(u));
    assert.deepStrictEqual(a.map((u) => u.replace(/^.*tennisexplorer\.com/, '')).sort(), ['/player/alpha/', '/player/alpha/?annual=2026']);
  });
  check('weekly: a player new to the roster gets his FULL history, joined on the api-tennis birthday', () => {
    const n = teReqs.filter((u) => /newman-1\/\?annual=/.test(u)); assert.strictEqual(n.length, 3);
    assert.ok(r.reqs.some((u) => /get_players/.test(u)), 'birthday read from api-tennis');
    const idx = JSON.parse(fs.readFileSync(path.join(d, 'te-history-index.json'), 'utf8'));
    assert.strictEqual(idx.players[2].slug, 'newman-1'); assert.strictEqual(idx.players[2].dob, '20000403');
    const rec = JSON.parse(fs.readFileSync(path.join(d, 'te-history', '2.json'), 'utf8')); assert.strictEqual(rec.rows.length, 3);
    const rep = JSON.parse(fs.readFileSync(path.join(d, 'te-refresh-report.json'), 'utf8')); assert.strictEqual(rep.newPlayers[0].key, '2');
  });
  check('weekly: the store grows and passes the guard (high-water raised)', () => {
    const idx = JSON.parse(fs.readFileSync(path.join(d, 'te-history-index.json'), 'utf8')); assert.strictEqual(idx.totalRows, 5); assert.strictEqual(idx.highWater.totalRows, 5);
  });
}
{
  const d = repo(); const r = run(d, 'weekly', { corrected: true });
  check('a TE correction to a past season is re-read and reported old -> new', () => {
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(r.reqs.some((u) => /alpha\/\?annual=2025/.test(u)), 'the changed season was re-read');
    const rep = JSON.parse(fs.readFileSync(path.join(d, 'te-refresh-report.json'), 'utf8'));
    const ch = rep.changes['1'].changes; assert.ok(ch.some((c) => c.change === 'changed' && c.fields.won && c.fields.won.old === true && c.fields.won.new === false), JSON.stringify(ch));
  });
}
{
  const d = repo(); const before = snapshot(d); const r = run(d, 'weekly', { block: true });
  check('a blocked page (429): exit non-zero, the store is byte-identical, BLOCKED written', () => {
    assert.notStrictEqual(r.code, 0); assert.strictEqual(snapshot(d), before); assert.ok(/STOP status=429/.test(r.out), r.out);
  });
}
{
  const d = repo(); const before = snapshot(d); const r = run(d, 'weekly', { refuse: true });
  check("a player whose rows refuse TE's table: exit 1, the store is byte-identical", () => {
    assert.strictEqual(r.code, 1, r.out); assert.strictEqual(snapshot(d), before); assert.ok(/refused to write/.test(r.out), r.out);
  });
}
{
  const d = repo(); fs.rmSync(path.join(d, 'te-history-index.json')); const r = run(d, 'weekly');
  check('no index: the refresh never builds a store from nothing (exit 1, nothing fetched)', () => { assert.strictEqual(r.code, 1); assert.strictEqual(r.reqs.filter(te).length, 0); });
}
{
  // day of year chosen so key "1" falls in the slice: sum of char codes "1" = 49; 49 % 28 = 21 -> day 21 = 22 Jan
  const d = repo(); const r = run(d, 'reread', {}, '2026-01-22T03:30:00Z');
  check('reread: the slice re-reads EVERY season of its player', () => {
    assert.strictEqual(r.code, 0, r.out);
    const a = r.reqs.filter(te).filter((u) => /alpha\/\?annual=/.test(u)).map((u) => u.slice(-4)).sort(); assert.deepStrictEqual(a, ['2025', '2026']);
  });
  const d2 = repo(); fs.writeFileSync(path.join(d2, 'roster.json'), JSON.stringify({ players: { 1: { name: 'A. Alpha', country: 'Australia', age: 30, careerByYear: [{}] } } }));
  const r2 = run(d2, 'reread', {}, '2026-01-23T03:30:00Z');
  check('reread: a player outside the day\'s slice is not fetched at all', () => { assert.strictEqual(r2.code, 0, r2.out); assert.strictEqual(r2.reqs.filter(te).length, 0); });
}
console.log(`\nte-refresh: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
