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

// ── TEN-449 · the template against the store repo's REAL layout (plan §2) ──────────────────────────────────────────
// The store repo's root holds only data — te-history/, te-history-index.json, te-atp-events.json, set-repairs.json —
// and no tools/ (the first template ran `node tools/te-refresh.mjs` there and would have failed on its first step).
// The tools come from a second checkout of the public SAAS repo into saas/.
const TPL_DIR = path.join(HERE, 'te-store-repo');
const tpl = fs.readFileSync(path.join(TPL_DIR, 'te-refresh.yml'), 'utf8');
const STORE_LAYOUT = ['te-history', 'te-history-index.json', 'te-atp-events.json', 'set-repairs.json'];
// a step's `run:` text by its name (a one-line run, or a `run: |` block)
function stepRun(y, name) {
  const lines = y.split('\n'); const i = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  if (i < 0) throw new Error(`no step "${name}"`);
  for (let j = i + 1; j < lines.length && !/^\s*- (name|uses):/.test(lines[j]); j++) {
    const m = /^(\s*)run: (.*)$/.exec(lines[j]); if (!m) continue;
    if (m[2] !== '|') return m[2];
    const body = []; for (let k = j + 1; k < lines.length && (lines[k].trim() === '' || lines[k].search(/\S/) > m[1].length); k++) body.push(lines[k]);
    const ind = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/))); return body.map((l) => l.slice(ind)).join('\n');
  }
  throw new Error(`step "${name}" has no run`);
}
const runs = [...tpl.matchAll(/^\s*run: (.*)$/gm)].map((m) => m[1]).join('\n') + '\n' + ['Commit the refreshed store', 'Fetch Sackmann at the pinned commit', 'Commit the set repairs', 'Alert on failure'].map((n) => stepRun(tpl, n)).join('\n');
check('TEN-449 template: every tool it runs is saas/tools/<file> and the file exists in this repo; no bare tools/ path', () => {
  const used = [...runs.matchAll(/(\S*)tools\/([\w.-]+)/g)];
  assert.ok(used.length >= 4, `only ${used.length} tool references`);
  for (const [, pre, f] of used) {
    assert.strictEqual(pre, 'saas/', `"${pre}tools/${f}" — the store repo has no tools/; the tools are under saas/`);
    assert.ok(fs.existsSync(path.join(HERE, f)), `saas/tools/${f} does not exist in SAAS`);
  }
  assert.ok(!/commitback-push/.test(tpl), 'commitback-push.sh lives in SAAS tools/, and one writer needs no rebase loop');
});
check('TEN-449 template: SAAS checked out into saas/ (public repo, main, no token); store checked out at the root; Node 22', () => {
  assert.ok(/repository: michaeldk1996\/SAAS\n\s+ref: main\n\s+path: saas\n\s+persist-credentials: false/.test(tpl), 'the SAAS checkout');
  assert.ok(!/^\s*token:/m.test(tpl), 'no token on any checkout');
  assert.strictEqual((tpl.match(/uses: actions\/checkout@v4/g) || []).length, 2);
  assert.ok(/node-version: '22'/.test(tpl) && !/node-version: '20'/.test(tpl));
  assert.ok(/node saas\/tools\/te-refresh\.mjs --root \. --mode "\$TE_MODE" --part "\$TE_PART"/.test(tpl), 'the refresh runs against the store root');
  assert.ok(/node saas\/tools\/te-history-guard\.mjs \. --prev-ref HEAD/.test(tpl), 'the guard runs against the store root');
  assert.ok(/concurrency:\n\s+group: te-refresh\b[^\n]*\n\s+cancel-in-progress: false/.test(tpl), 'one writer');
  assert.ok(/if: github\.ref == 'refs\/heads\/main'/.test(tpl), 'pushes to main only from main');
});
check('TEN-449 template: the commit steps add only store-layout files (plus the logs the tools write there)', () => {
  const added = ['Commit the refreshed store', 'Commit the set repairs'].flatMap((n) => [...stepRun(tpl, n).matchAll(/git add -- ([^;\n]+)/g)].flatMap((m) => m[1].trim().split(/\s+/)));
  assert.ok(added.length >= 4, added.join(' '));
  for (const f of added) assert.ok(STORE_LAYOUT.includes(f) || /^(te-refresh|set-repairs)-log\.jsonl$/.test(f), `adds ${f}`);
  assert.ok(!/git add (-A|--all|\.)/.test(tpl), 'never adds the whole tree (saas/ is in it)');
});
check('TEN-449 template: set repairs run only after a complete week, from Sackmann at the pinned commit 5b6263dc48, and stop on a wrong commit', () => {
  assert.ok(/SACKMANN_COMMIT: 5b6263dc48/.test(tpl));
  const gated = ['Fetch Sackmann at the pinned commit', 'Set repairs for new short rows (existing repairs and flags frozen)', 'Commit the set repairs'];
  for (const n of gated) assert.ok(new RegExp(`- name: ${n.replace(/[()]/g, '\\$&')}\\n\\s+if: steps\\.week\\.outputs\\.complete == 'true'`).test(tpl), n);
  assert.ok(/id: week\n\s+if: env\.TE_MODE == 'weekly'\n\s+run: node saas\/tools\/te-set-repairs-refresh\.mjs --store \. --week-complete/.test(tpl));
  assert.ok(/"\$SACKMANN_COMMIT"\*\) echo[\s\S]*?\*\) echo "::error::[\s\S]*?exit 1/.test(stepRun(tpl, 'Fetch Sackmann at the pinned commit')));
});
check('TEN-449 template: dispatch inputs cover weekly 0/2 and 1/2, the re-read slice and the smoke 0/28', () => {
  assert.ok(/options: \[weekly, reread\]/.test(tpl)); assert.ok(/options: \['0\/2', '1\/2', '0\/1', '0\/28'\]/.test(tpl));
});
check('TEN-449 template: the failure alert posts the run link to Telegram from secrets, never printing a secret', () => {
  const a = stepRun(tpl, 'Alert on failure');
  assert.ok(/- name: Alert on failure\n\s+if: failure\(\)/.test(tpl));
  assert.ok(/TELEGRAM_BOT_TOKEN: \$\{\{ secrets\.TELEGRAM_BOT_TOKEN \}\}/.test(tpl) && /TELEGRAM_CHAT_ID: \$\{\{ secrets\.TELEGRAM_CHAT_ID \}\}/.test(tpl));
  assert.ok(/actions\/runs\/\$\{\{ github\.run_id \}\}/.test(a), 'run link');
  assert.ok(!/(echo|printf)[^\n]*\$\{?TELEGRAM_(BOT_TOKEN|CHAT_ID)/.test(a) && !/set -x/.test(tpl), 'a secret is echoed');
  assert.ok(!/(echo|printf)[^\n]*\$\{?API_TENNIS_KEY/.test(tpl));
});
check('TEN-449 rollout: te-refresh.dispatch-only.yml is the template minus its SCHEDULE block — and has no schedule', () => {
  const d = fs.readFileSync(path.join(TPL_DIR, 'te-refresh.dispatch-only.yml'), 'utf8');
  const block = /^  # >>> SCHEDULE[^\n]*\n[\s\S]*?^  # <<< SCHEDULE\n/m;
  assert.ok(block.test(tpl) && /schedule:\n(\s+- cron: [^\n]+\n){3}/.test(block.exec(tpl)[0]), 'the template holds the three crons inside the markers');
  assert.strictEqual(d, tpl.replace(block, ''), 'the dispatch-only variant drifted from the template — regenerate it');
  assert.ok(!/schedule:|cron:/.test(d.replace(/github\.event\.schedule/g, '')));
});
{
  // EXECUTED: the template's own refresh, guard and commit commands, run in a workspace laid out like the store repo
  // (a git repo whose root is the data, origin a bare repo) with saas/ = this repository
  const ws = repo(); fs.rmSync(path.join(ws, 'roster.json'));
  fs.writeFileSync(path.join(ws, 'set-repairs.json'), JSON.stringify({ v: 1, repairs: {}, flags: {} }));
  const roster = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'te-ws-r-')), 'roster.json');
  fs.writeFileSync(roster, JSON.stringify({ players: { 1: { name: 'A. Alpha', country: 'Australia', age: 30, careerByYear: [{}] }, 2: { name: 'N. Newman', country: 'Australia', age: 26, careerByYear: [{}] } } }));
  const origin = fs.mkdtempSync(path.join(os.tmpdir(), 'te-ws-o-'));
  const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const sh = (cmd, env = {}) => { try { return { code: 0, out: execFileSync('bash', ['-ec', cmd], { cwd: ws, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...gitEnv, ...env } }) }; } catch (e) { return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; } };
  sh(`git init -q --bare "${origin}" && git init -q -b main && git add -- ${STORE_LAYOUT.join(' ')} && git commit -q -m store && git remote add origin "${origin}" && git push -q origin HEAD:refs/heads/main`);
  // saas/ as actions/checkout leaves it: a real directory holding its own git repository (not a symlink — a tool's
  // `import.meta.url === argv[1]` main check would not fire through one, and the guard would pass vacuously)
  fs.mkdirSync(path.join(ws, 'saas', 'tools'), { recursive: true });
  for (const f of fs.readdirSync(HERE).filter((x) => x.endsWith('.mjs'))) fs.copyFileSync(path.join(HERE, f), path.join(ws, 'saas', 'tools', f));
  fs.copyFileSync(path.join(HERE, '..', 'te-join.js'), path.join(ws, 'saas', 'te-join.js'));
  execFileSync('git', ['init', '-q', path.join(ws, 'saas')], { env: gitEnv });
  sh(stepRun(tpl, "Keep the tools checkout and the run report out of the store's commits"));
  const aux = fs.mkdtempSync(path.join(os.tmpdir(), 'te-ws-a-'));   // the stub's pages and request log, outside the store
  fs.writeFileSync(path.join(aux, 'pages.json'), JSON.stringify(pages()));
  const env = { TE_MODE: 'weekly', TE_PART: '0/1', API_TENNIS_KEY: 'x', TE_DELAY_MS: '0', TE_STUB_PAGES: path.join(aux, 'pages.json'), TE_STUB_LOG: path.join(aux, 'requests.log'),
    TE_ROSTER: roster, TE_NOW: '2026-10-19T05:00:00Z', TE_CACHE: fs.mkdtempSync(path.join(os.tmpdir(), 'te-c-')), TE_BUDGET_MIN: '270' };
  const refreshCmd = stepRun(tpl, 'Refresh the Tennis Explorer store').replace(/^node /, `node --import ${STUB} `);
  const rr = sh(refreshCmd, env);
  const gr = sh(stepRun(tpl, 'Guard the refreshed store against the committed one'));
  const cr = sh(stepRun(tpl, 'Commit the refreshed store'), env);
  const pushed = execFileSync('git', ['--git-dir', origin, 'ls-tree', '-r', '--name-only', 'main'], { encoding: 'utf8', env: gitEnv }).trim().split('\n');
  check('TEN-449 EXECUTED: the template\'s refresh command runs against the store-shaped root (exit 0, new player written)', () => {
    assert.strictEqual(rr.code, 0, rr.out); assert.ok(fs.existsSync(path.join(ws, 'te-history', '2.json')));
  });
  check('TEN-449 EXECUTED: the template\'s guard runs and passes on the store root with the saas/ checkout beside it', () => {
    assert.strictEqual(gr.code, 0, gr.out); assert.ok(/te-history guard ok · 2 players · 5 rows/.test(gr.out), gr.out);
  });
  check('TEN-449 EXECUTED: the commit step pushes the refreshed store — and nothing of saas/ or the run report', () => {
    assert.strictEqual(cr.code, 0, cr.out);
    assert.ok(pushed.includes('te-history/2.json') && pushed.includes('te-refresh-log.jsonl'), pushed.join(' '));
    assert.ok(!pushed.some((f) => /^saas|te-refresh-report/.test(f)), pushed.join(' '));
  });
  const wk = sh(stepRun(tpl, 'Has every weekly part of this week completed?'), { GITHUB_OUTPUT: path.join(ws, '.gh-out') });
  check('TEN-449 EXECUTED: the week gate step runs from saas/ and says "complete=true" after a whole-week (0/1) weekly run', () => {
    assert.strictEqual(wk.code, 0, wk.out); assert.ok(/complete=true/.test(fs.readFileSync(path.join(ws, '.gh-out'), 'utf8')), wk.out);
  });
}

// ── TEN-449 · API_TENNIS_KEY is trimmed (the stored secret carries a trailing newline) ─────────────────────────────
{
  const d = repo(); const r = run(d, 'weekly', {}, undefined, { env: { API_TENNIS_KEY: 'x \n' } });
  check('API_TENNIS_KEY "x \\n" is trimmed: the lookup asks for APIkey=x (untrimmed it sends "x \\n")', () => {
    assert.strictEqual(r.code, 0, r.out);
    const api = r.reqs.filter((u) => /get_players/.test(u)); assert.ok(api.length >= 1, r.reqs.join(' '));
    assert.ok(api.every((u) => /[?&]APIkey=x&/.test(u)), api.join(' '));
  });
  const d2 = repo(); const before2 = snapshot(d2); const r2 = run(d2, 'weekly', {}, undefined, { env: { API_TENNIS_KEY: ' \n' } });
  check('an all-whitespace API_TENNIS_KEY is no key: exit 1 before any request, store byte-identical', () => {
    assert.strictEqual(r2.code, 1, r2.out); assert.strictEqual(r2.reqs.length, 0); assert.strictEqual(snapshot(d2), before2);
  });
}

// ── TEN-449 · source rule (.claude/rules/pipeline-records.md): no workflow in THIS public repo runs the TE tools ───────
// TE pages are read only by te-scrape.mjs (the Mac) and te-refresh.mjs (the private store repo's Actions) — never from
// the public SAAS repo, its CI or the nightly pipeline.
const TE_TOOLS = /\b(te-scrape|te-refresh|te-set-repairs-refresh)\.mjs\b/;
function saasWorkflowsCallingTe(root) {
  const hits = []; const gh = path.join(root, '.github');
  const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(ya?ml|sh|m?js|py)$/.test(e.name) && TE_TOOLS.test(fs.readFileSync(f, 'utf8'))) hits.push(path.relative(root, f)); } };
  walk(gh); return hits;
}
check('TEN-449 source rule: no workflow, action or script under this repo\'s .github/ calls te-scrape.mjs or te-refresh.mjs', () => {
  const hits = saasWorkflowsCallingTe(path.join(HERE, '..')); assert.deepStrictEqual(hits, [], hits.join(', '));
});
check('TEN-449 source rule, control: a .github workflow that runs te-refresh.mjs or te-scrape.mjs is caught', () => {
  for (const tool of ['te-refresh.mjs', 'te-scrape.mjs']) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'te-src-')); fs.mkdirSync(path.join(d, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(d, '.github', 'workflows', 'x.yml'), `steps:\n  - run: node tools/${tool} --mode weekly\n`);
    assert.deepStrictEqual(saasWorkflowsCallingTe(d), ['.github/workflows/x.yml']);
  }
});
console.log(`\nte-refresh: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
