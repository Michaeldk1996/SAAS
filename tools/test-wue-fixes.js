// Founder brief 2026-10-20 (A + B) — W/UE bar gating, Lyon label, in-play cards, entry-lists freshness + commits.
//
//   A5   the W/UE bar is disabled BEFORE the click when a tournament has no sheet rows ("Available after the next
//        data update."), lists the rounds that are in when it has, and never prints a raw error after a click.
//   A6   tourLabelOf: a null-round fixture of "Lyon (France) - Qualification" labels as ATP Lyon (no duplicate event).
//   B8   an in-play fixture is cardable and carries its live state (dropped since the Odds API retirement 2026-10-16);
//        a decided fixture whose live flag lags is never live (Guard A).
//   B9   the Entry list tooltip shows when the draw CONTENT last changed (sourcePublished), not our fetch time.
//   B10  entry_lists.json is committed on a CONTENT change only (generatedAt ignored), checked on real commits.
//
// Run: node tools/test-wue-fixes.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`); }
}
console.log('W/UE + board fixes (brief 2026-10-20)');

const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
// Brace-matched source of a top-level `function name(` in the page.
function fnSrc(name) {
  const i = html.indexOf(`function ${name}(`);
  if (i < 0) return null;
  let d = 0, j = html.indexOf('{', i);
  for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; }
  return html.slice(i, j + 1);
}

// ── A5 · W/UE bar ──
const W = require(path.join(ROOT, 'wue-sheet.js'));
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wue-sheet', 'almaty-2026-r1.json'), 'utf8'));
const parts = ['tourxWueBarHtml', 'tourxWueDisabledSeg', 'tourxSegItem', 'tourxCapsLbl', 'tourxEsc', 'tourxRpEsc'].map(fnSrc);
check('bar functions present in the page', parts.every(Boolean), parts.map((p, i) => p ? '' : i).join(' '));
function bar(entry) {
  const box = { window: { WueSheet: W }, tournamentProgression: { tournaments: { T: entry } } };
  vm.createContext(box);
  vm.runInContext(parts.join('\n') + '\nthis.__out = tourxWueBarHtml("T");', box);
  return box.__out;
}
if (parts.every(Boolean)) {
  const none = bar({ rounds: ['R1'], players: [] });
  check('no sheet rows → Download is disabled before the click (no handler)', /aria-disabled="true"[^>]*>Download \.xlsx</.test(none) && !/onclick="tourxWueDownload/.test(none), none);
  check('no sheet rows → plain "Available after the next data update."', none.includes('>Available after the next data update.<'));
  check('no sheet rows → no Copy buttons', !/Copy round/.test(none));
  const some = bar(FX);
  check('rows in → Download is live', /onclick="tourxWueDownload\('T'\)"/.test(some));
  check('rows in → one Copy per round with rows', (some.match(/onclick="tourxWueCopy/g) || []).length === 1);
  check('rows in → the status lists every started round (ruling 6): "R32: 9 of —" without a draw', some.includes('>R32: 9 of —<'), some.slice(some.indexOf('role="status"'), some.indexOf('role="status"') + 160));
}
const dl = fnSrc('tourxWueDownload') || '', cp = fnSrc('tourxWueCopy') || '';
check('a failed click never prints the raw error text', !/e\.message/.test(dl + cp) && /try again/.test(dl) && /try again/.test(cp));

// ── A6 · tourLabelOf ──
process.env.API_TENNIS_KEY = process.env.API_TENNIS_KEY || 'test';
const P = require(path.join(ROOT, 'bsp-pipeline.js'));
check('null-round Lyon fixture labels as ATP Lyon', P.tourLabelOf({ tournament_name: 'Lyon (France) - Qualification', tournament_round: null }) === 'ATP Lyon',
  P.tourLabelOf({ tournament_name: 'Lyon (France) - Qualification', tournament_round: null }));
check('a Lyon fixture WITH a round is unchanged (ATP Lyon)', P.tourLabelOf({ tournament_name: 'Lyon (France) - Qualification', tournament_round: 'ATP Lyon - 1/8-finals' }) === 'ATP Lyon');
check('Davis Cup keeps its stage name', P.tourLabelOf({ tournament_name: 'ATP Davis Cup - World Group II', tournament_round: null }) === 'ATP Davis Cup - World Group II');

// ── B8 · in-play cards ──
const fx = (o) => Object.assign({ event_key: 1, event_status: '', event_live: '0', event_qualification: 'False', event_winner: null,
  first_player_key: 10, second_player_key: 20 }, o);
check('exports isCardableFixture + fixtureLiveState', typeof P.isCardableFixture === 'function' && typeof P.fixtureLiveState === 'function');
if (typeof P.isCardableFixture === 'function') {
  check('an in-play fixture is cardable (was dropped)', P.isCardableFixture(fx({ event_live: '1', event_status: 'Set 2' })) === true);
  check('a scheduled fixture is cardable', P.isCardableFixture(fx({})) === true);
  check('a Finished fixture with a lagging live flag is not (the past builder takes it)', P.isCardableFixture(fx({ event_live: '1', event_status: 'Finished', event_winner: 'First Player' })) === false);
  check('qualifying is not', P.isCardableFixture(fx({ event_qualification: 'True' })) === false);
  check('a TBD slot is not', P.isCardableFixture(fx({ second_player_key: null })) === false);
  const ls = P.fixtureLiveState(fx({ event_live: '1', event_status: 'Set 2', event_game_result: '30 - 15', event_serve: 'Second Player',
    scores: [{ score_set: '1', score_first: '6', score_second: '4' }, { score_set: '2', score_first: '2', score_second: '3' }] }));
  check('live state: live, status, set scores, game score, server', ls.live === true && ls.liveStatus === 'Set 2' && ls.liveGameScore === '30 - 15' && ls.liveServer === 'p2'
    && JSON.stringify(ls.liveScore) === '[{"set":1,"p1":6,"p2":4},{"set":2,"p1":2,"p2":3}]', JSON.stringify(ls));
  const g = P.fixtureLiveState(fx({ event_live: '1', event_status: 'Finished' }));
  check('Guard A: decided + lagging live flag → not live, no live fields', g.live === false && g.liveStatus === null && g.liveScore === null && g.liveServer === null);
}
const pipe = fs.readFileSync(path.join(ROOT, 'bsp-pipeline.js'), 'utf8');
check('the upcoming filter no longer skips in-play fixtures', !pipe.includes("    if (f.event_live === '1') return false;") && pipe.includes('if (!isCardableFixture(f)) return false;'));
check('the upcoming card takes the fixture live state', pipe.includes('...fixtureLiveState(fixture),'));

// ── B9 · tooltip ──
check('tooltip shows content last changed (sourcePublished)', html.includes("content last changed: ' + fmtDateTime(drawMeta.sourcePublished)"));
check('tooltip no longer shows our fetch time as the draw time', !html.includes("last fetched by us: ' + fmtDateTime(drawMeta.generatedAt)"));

// ── B10 · content-only commits, on REAL committed shards ──
const H = path.join(ROOT, 'tools', 'entry-lists', 'content-hash.py');
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'el-'));
const same = (a, b) => { try { execFileSync('python3', [H, a, b]); return true; } catch (e) { if (e.status === 1) return false; throw e; } };
const show = (c) => { const f = path.join(tmp, c + '.json'); try { fs.writeFileSync(f, execFileSync('git', ['show', `${c}:entry_lists.json`], { cwd: ROOT })); return f; } catch { return null; } };
// 19 → 20 Oct: generatedAt only. 6 → 7 Oct: Beijing re-released (real change). Commits are on main's history.
const a = show('a7038806e'), b = show('f84382947'), c = show('31992cccf'), d = show('bb7733da9');
if (a && b && c && d) {
  check('control: the 19/20 Oct shards differ byte-wise', !fs.readFileSync(a).equals(fs.readFileSync(b)));
  check('19 → 20 Oct (generatedAt only) = same content → no commit', same(a, b) === true);
  check('6 → 7 Oct (Beijing re-released) = different content → commit', same(c, d) === false);
} else {
  console.log('  skip real-commit checks: history not in this clone (shallow) — the synthetic pair below still runs');
}
const s1 = path.join(tmp, 's1.json'), s2 = path.join(tmp, 's2.json'), s3 = path.join(tmp, 's3.json');
fs.writeFileSync(s1, JSON.stringify({ generatedAt: '2026-10-19T00:00:00Z', tournaments: [{ name: 'X' }] }));
fs.writeFileSync(s2, JSON.stringify({ generatedAt: '2026-10-20T00:00:00Z', tournaments: [{ name: 'X' }] }));
fs.writeFileSync(s3, JSON.stringify({ generatedAt: '2026-10-20T00:00:00Z', tournaments: [{ name: 'Y' }] }));
check('synthetic: timestamp-only = same', same(s1, s2) === true);
check('synthetic: content change = different', same(s2, s3) === false);
const sh = fs.readFileSync(path.join(ROOT, 'tools', 'refresh-entry-lists.sh'), 'utf8');
check('refresh script gates on content vs HEAD and vs origin/main', sh.includes('if same_content_as HEAD; then') && sh.includes('if same_content_as origin/main; then'));
check('refresh script no longer gates on a raw byte diff', !/git diff --quiet -- entry_lists\.json/.test(sh));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
