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
function run(d, mode, opts = {}, now = '2026-10-19T05:00:00Z', extra = {}) {
  const log = path.join(d, 'requests.log');
  fs.writeFileSync(path.join(d, 'pages.json'), JSON.stringify(pages(opts)));
  let code = 0, out = '';
  try {
    out = execFileSync(process.execPath, ['--import', STUB, TOOL, '--root', d, '--mode', mode, ...(extra.args || [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, API_TENNIS_KEY: 'x', ...(extra.env || {}), TE_DELAY_MS: '0', TE_STUB_PAGES: path.join(d, 'pages.json'), TE_STUB_LOG: log, TE_ROSTER: path.join(d, 'roster.json'),
        TE_NOW: now, TE_CACHE: fs.mkdtempSync(path.join(os.tmpdir(), 'te-c-')) } });
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
{
  // the roster is EVERY profiled player (player-index.json `hasProfile`, ruling d6814167), not the eager store: an
  // index-shaped roster pulls the new profiled player and skips an index entry without a profile
  const d = repo();
  fs.writeFileSync(path.join(d, 'roster.json'), JSON.stringify({ players: [
    { key: '1', name: 'A. Alpha', country: 'Australia', hasProfile: true },
    { key: '2', name: 'N. Newman', country: 'Australia', hasProfile: true },
    { key: '3', name: 'Z. Noprofile', country: 'Australia', hasProfile: false }] }));
  const r = run(d, 'weekly');
  check('a store player who left the profiled set is still refreshed (one population that only grows)', () => {
    const d3 = repo();
    fs.writeFileSync(path.join(d3, 'roster.json'), JSON.stringify({ players: [{ key: '2', name: 'N. Newman', country: 'Australia', hasProfile: true }] }));
    const r3 = run(d3, 'weekly');
    assert.strictEqual(r3.code, 0, r3.out); assert.ok(r3.reqs.some((u) => /\/player\/alpha\//.test(u)), 'store player alpha not refreshed');
  });
  check('player-index roster: a profiled player new to the store gets his full history; no profile, no request', () => {
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.reqs.filter(te).filter((u) => /newman-1\/\?annual=/.test(u)).length, 3);
    assert.ok(!r.reqs.some((u) => /noprofile|player_key=3\b/i.test(u)), 'a player without a profile was looked up');
  });
}
{
  // TEN-449: no api-tennis key, or a failed birthday lookup, stops the run — never a silent "unmatched" for every new player
  const d = repo(); const before = snapshot(d);
  const r = run(d, 'weekly', {}, undefined, { env: { API_TENNIS_KEY: '' } });
  check('no API_TENNIS_KEY: exit 1 before any request; store byte-identical; says why', () => {
    assert.strictEqual(r.code, 1, r.out); assert.strictEqual(r.reqs.length, 0, r.reqs.join(' ')); assert.strictEqual(snapshot(d), before);
    assert.ok(/API_TENNIS_KEY is not set/.test(r.out), r.out);
  });
  const d2 = repo(); const before2 = snapshot(d2);
  const r2 = run(d2, 'weekly', {}, undefined, { env: { TE_STUB_API_STATUS: '500' } });
  check('api-tennis lookup fails (HTTP 500): the run stops non-zero; store byte-identical; the new player is not written unmatched', () => {
    assert.notStrictEqual(r2.code, 0, r2.out); assert.strictEqual(snapshot(d2), before2); assert.ok(/get_players for player 2: HTTP 500/.test(r2.out), r2.out);
  });
  // DOB-only joins: no birthday on api-tennis -> unmatched and listed, and TE is never searched for him by name/age
  const d3 = repo(); const r3 = run(d3, 'weekly', {}, undefined, { env: { TE_STUB_API_BDAY: '' } });
  check('no birthday on api-tennis: the new player stays unmatched (listed), no TE search, no age±1 join; run exits 0', () => {
    assert.strictEqual(r3.code, 0, r3.out);
    assert.ok(!r3.reqs.filter(te).some((u) => /list-players|newman/.test(u)), r3.reqs.join(' '));
    const rep = JSON.parse(fs.readFileSync(path.join(d3, 'te-refresh-report.json'), 'utf8'));
    assert.deepStrictEqual(rep.unmatched.map((u) => [u.key, u.why]), [['2', 'no date of birth on api-tennis']]);
    assert.ok(!JSON.parse(fs.readFileSync(path.join(d3, 'te-history-index.json'), 'utf8')).players[2]);
  });
  const d4 = repo(); const before4 = snapshot(d4); const r4 = run(d4, 'weekly', {}, undefined, { env: { TE_STUB_API_BDAY: '2000-04-03' } });
  check('a birthday not in dd.mm.yyyy stops the run; store byte-identical', () => {
    assert.notStrictEqual(r4.code, 0, r4.out); assert.strictEqual(snapshot(d4), before4); assert.ok(/is not dd\.mm\.yyyy/.test(r4.out), r4.out);
  });
  const d5 = repo(); const before5 = snapshot(d5); fs.writeFileSync(path.join(d5, 'roster.json'), JSON.stringify({ unexpected: [] }));
  const r5 = run(d5, 'weekly');
  check('a roster with no profiled player stops the run; store byte-identical', () => {
    assert.notStrictEqual(r5.code, 0, r5.out); assert.strictEqual(snapshot(d5), before5); assert.ok(/holds no profiled player/.test(r5.out), r5.out);
  });
}
{
  // TIME BUDGET (founder 2026-10-17, comment cd899856 item 3): a run that cannot fit is refused BEFORE fetching; a run
  // that overruns stops at the budget — either way exit 1, nothing written, and the message says to split
  const d = repo(); const before = snapshot(d);
  const r = run(d, 'weekly', {}, undefined, { env: { TE_SEC_PER_PAGE: '600', TE_BUDGET_MIN: '10' } });
  check('budget pre-flight: an estimate past the budget exits 1 before any request; store byte-identical; says split', () => {
    assert.strictEqual(r.code, 1, r.out); assert.strictEqual(r.reqs.filter(te).length, 0); assert.strictEqual(snapshot(d), before);
    assert.ok(/past the 10 min budget — split the run \(--part i\/n\)/.test(r.out), r.out);
  });
  const d2 = repo(); const before2 = snapshot(d2);
  const r2 = run(d2, 'weekly', {}, undefined, { env: { TE_SEC_PER_PAGE: '0', TE_BUDGET_MIN: '0.000001' } });
  check('budget in-run: hitting the budget stops the run — exit 1, the last good store unchanged', () => {
    assert.strictEqual(r2.code, 1, r2.out); assert.strictEqual(snapshot(d2), before2); assert.ok(/hit its .* min budget/.test(r2.out), r2.out);
  });
  // --part i/n: the parts are disjoint and together cover the roster
  const seen = [];
  for (const part of ['0/2', '1/2']) {
    const dp = repo(); const rp = run(dp, 'weekly', {}, undefined, { args: ['--part', part] });
    const rep = JSON.parse(fs.readFileSync(path.join(dp, 'te-refresh-report.json'), 'utf8'));
    seen.push({ part, code: rp.code, players: rep.estimate.players, alpha: rp.reqs.some((u) => /\/player\/alpha\//.test(u)), newman: rp.reqs.some((u) => /newman-1/.test(u)) });
  }
  // TEN-449: the freshness note ends only when every part of one week's run has completed — not on a part, not on a re-read
  const ix = (d) => JSON.parse(fs.readFileSync(path.join(d, 'te-history-index.json'), 'utf8'));
  const dw = repo();
  run(dw, 'reread', {}, '2026-10-19T03:30:00Z'); const afterReread = ix(dw).refreshedAt;
  run(dw, 'weekly', {}, '2026-10-19T05:00:00Z', { args: ['--part', '0/2'] }); const afterPart0 = ix(dw).refreshedAt;
  run(dw, 'weekly', {}, '2026-10-19T11:00:00Z', { args: ['--part', '1/2'] }); const afterPart1 = ix(dw).refreshedAt;
  const dx = repo();
  run(dx, 'weekly', {}, '2026-10-19T05:00:00Z', { args: ['--part', '0/2'] });
  run(dx, 'weekly', {}, '2026-10-27T11:00:00Z', { args: ['--part', '1/2'] }); const crossWeek = ix(dx).refreshedAt;
  check('TEN-449 · refreshedAt: not on a re-read, not on part 0/2 alone; set when 1/2 completes the same week', () => {
    assert.ok(!afterReread, `re-read set ${afterReread}`); assert.ok(!afterPart0, `part 0 alone set ${afterPart0}`);
    assert.strictEqual(afterPart1, '2026-10-19T11:00:00.000Z');
  });
  check('TEN-449 · refreshedAt: parts from two different weeks do not add up to a full refresh', () => assert.ok(!crossWeek, String(crossWeek)));
  check('--part 0/2 + 1/2: each player refreshed by exactly one part', () => {
    assert.ok(seen.every((x) => x.code === 0), JSON.stringify(seen));
    assert.strictEqual(seen.filter((x) => x.alpha).length, 1, JSON.stringify(seen)); assert.strictEqual(seen.filter((x) => x.newman).length, 1, JSON.stringify(seen));
    assert.strictEqual(seen[0].players + seen[1].players, 2);
  });
}
{
  // the workflow: two weekly parts cover the roster, and the tool's budget trips before the job timeout kills a run
  // TEN-449: the workflow runs in the PRIVATE store repo, never this public one — kept here as its template
  const y = fs.readFileSync(path.join(path.dirname(TOOL), 'te-store-repo', 'te-refresh.yml'), 'utf8');
  check('the refresh workflow is NOT in this public repo\'s .github/workflows (it would commit the store here)', () => {
    assert.ok(!fs.existsSync(path.join(path.dirname(TOOL), '..', '.github', 'workflows', 'te-refresh.yml')));
  });
  check('workflow: weekly crons 05:00 and 11:00 run parts 0/2 and 1/2; the re-read runs whole; budget < job timeout', () => {
    assert.ok(/cron: '0 5 \* \* 1'/.test(y) && /cron: '0 11 \* \* 1'/.test(y), 'two weekly crons');
    assert.ok(/'0 11 \* \* 1' && '1\/2'/.test(y) && /'30 3 \* \* \*' && '0\/1'/.test(y) && /\|\| '0\/2'\)/.test(y), 'part mapping');
    const budget = +(/TE_BUDGET_MIN: '(\d+)'/.exec(y) || [])[1], timeout = +(/timeout-minutes: (\d+)/.exec(y) || [])[1];
    assert.ok(budget > 0 && timeout > 0 && budget < timeout && timeout < 360, `budget ${budget} min, job timeout ${timeout} min, Actions limit 360`);
    assert.ok(/--part "\$TE_PART"/.test(y), 'the run passes its part');
  });
}
console.log(`\nte-refresh: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
