// Draw matches store (founder 2026-10-21 round 3: keep finished draw matches openable all week).
// The board (matches.json) drops a finished match after 4 days; draw-matches.json keeps its board row + model entry so a
// draw card still opens its Match Analysis. Builder rules, the failure path, the Draw view's and the page's lookups, and
// the workflow wiring. Run: node tools/test-draw-matches-store.js
'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os');
const ROOT = path.resolve(__dirname, '..');
process.env.API_TENNIS_KEY = process.env.API_TENNIS_KEY || 'test';
const P = require(path.join(ROOT, 'bsp-pipeline.js'));
let pass = 0, fail = 0;
const check = (l, c, d) => { if (c) { pass++; console.log(`  ok   ${l}`); } else { fail++; console.log(`  FAIL ${l}${d ? `\n       ${d}` : ''}`); } };
console.log('Draw matches store — builder, failure path, lookups, wiring');

const NOW = '2026-10-24T12:00:00.000Z';
const row = (ek, date, extra) => Object.assign({ id: `past-${ek}`, date, p1: 'A. One', p2: 'B. Two', finalScore: { display: '6-4, 6-3' } }, extra || {});
const prog = { Almaty: { matches: [
  { eventKey: '1', winner: 1 },            // on the board this run
  { eventKey: '2', winner: 2 },            // dropped off the board (4-day window) — only the prior copy has it
  { eventKey: '3', winner: null },         // not finished
  { eventKey: '4', winner: 1 },            // finished, but the board row carries no finalScore
], qualifying: [{ eventKey: '9', winner: 1 }] } };
const board = [row('1', '2026-10-23'), { id: 'past-4', date: '2026-10-23' }, row('9', '2026-10-23')];
const model = { 'past-1': { ok: true, stage2: { totalDeltaP1: 0.02 } } };
const priorCache = { v: 1, savedAt: '2026-10-22T10:00:00Z', matches: {
  'past-2': { id: 'past-2', eventKey: '2', tour: 'Almaty', date: '2026-10-20', savedAt: '2026-10-22T10:00:00Z', match: row('2', '2026-10-20', { tag: 'cache' }), model: { ok: true, v: 'cache' } },
  'past-1': { id: 'past-1', eventKey: '1', tour: 'Almaty', date: '2026-10-23', savedAt: '2026-10-23T10:00:00Z', match: row('1', '2026-10-23', { tag: 'old' }), model: { ok: true, v: 'prior-model' } },
} };
const priorPublished = { v: 1, savedAt: '2026-10-22T11:00:00Z', matches: {
  'past-2': { id: 'past-2', eventKey: '2', tour: 'Almaty', date: '2026-10-20', savedAt: '2026-10-22T11:00:00Z', match: row('2', '2026-10-20', { tag: 'published' }), model: { ok: true, v: 'published' } },
  'past-7': { id: 'past-7', eventKey: '7', tour: 'Stockholm', date: '2026-10-12', savedAt: '2026-10-18T09:00:00Z', match: row('7', '2026-10-12'), model: null },   // tournament over, 12 days old
  'past-8': { id: 'past-8', eventKey: '8', tour: 'Stockholm', date: '2026-10-05', savedAt: '2026-10-12T09:00:00Z', match: row('8', '2026-10-05'), model: null },   // 19 days old
} };
const r = P.buildDrawMatchesStore({ files: [priorCache, priorPublished], board, model, progression: prog, nowIso: NOW });
const M = r.store.matches;
check('on the board → refreshed this run: the board row as published, this run\'s model entry, savedAt = now', M['past-1'] && M['past-1'].match === board[0] && M['past-1'].model === model['past-1'] && M['past-1'].savedAt === NOW && M['past-1'].tour === 'Almaty');
check('off the board → the newest prior copy, unchanged (published 11:00 beats cache 10:00)', M['past-2'] === priorPublished.matches['past-2'], JSON.stringify(M['past-2'] && M['past-2'].match.tag));
check('a match not finished gets no entry; a board row with no finalScore is never stored', !M['past-3'] && !M['past-4']);
check('main draw only — a qualifying match never enters the store (the board carries none to open)', !M['past-9']);
check('not in this run\'s progression: kept while ≤ 16 days old (12-day Stockholm match), aged out after (19 days)', !!M['past-7'] && !M['past-8'] && r.aged === 1);
check('counts said out loud: 1 fresh, 2 kept, 1 aged', r.fresh === 1 && r.kept === 2 && r.aged === 1, JSON.stringify({ fresh: r.fresh, kept: r.kept, aged: r.aged }));
const r2 = P.buildDrawMatchesStore({ files: [priorCache], board, model: {}, progression: prog, nowIso: NOW });
check('no model entry this run → the prior model entry is kept (never replaced by nothing)', r2.store.matches['past-1'].model === priorCache.matches['past-1'].model);
const r3 = P.buildDrawMatchesStore({ files: [null, undefined, { matches: { 'past-5': { id: 'past-5' } } }], board: [], model: {}, progression: {}, nowIso: NOW });
check('no prior sources, or entries with no match / savedAt → an empty store, no crash', Object.keys(r3.store.matches).length === 0 && r3.store.v === 1 && r3.store.keepDays === 16);
check('control: a prior entry\'s own date decides its age, not when it was saved', P.buildDrawMatchesStore({ files: [{ matches: { 'past-6': { id: 'past-6', date: '2026-10-01', savedAt: '2026-10-23T00:00:00Z', match: row('6', '2026-10-01') } } }], board: [], model: {}, progression: {}, nowIso: NOW }).aged === 1);

// ── failure path: the store is never published empty over a good copy ──
const src = fs.readFileSync(path.join(ROOT, 'bsp-pipeline.js'), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dms-'));
const cwd = process.cwd();
try {
  process.chdir(tmp);
  fs.writeFileSync('draw-matches.published.json', JSON.stringify(priorPublished));
  fs.writeFileSync('matches.json', JSON.stringify(board));
  const writeFn = new Function('fs', 'writeJsonAtomic', 'buildDrawMatchesStore', 'DRAW_MATCHES_PATH', 'DRAW_MATCHES_PUBLISHED_PATH', 'DRAW_MATCHES_KEEP_DAYS',
    src.slice(src.indexOf('function writeDrawMatchesStore('), src.indexOf('\n}\n', src.indexOf('function writeDrawMatchesStore(')) + 2) + '\nreturn writeDrawMatchesStore;');
  const wja = (f, d) => fs.writeFileSync(f, JSON.stringify(d));
  const boom = () => { throw new Error('boom'); };
  writeFn(fs, wja, boom, 'draw-matches.json', 'draw-matches.published.json', 16)(prog, model);
  const kept = JSON.parse(fs.readFileSync('draw-matches.json', 'utf8'));
  check('a builder failure publishes the newest previous copy unchanged — never an empty store over a good one', JSON.stringify(kept) === JSON.stringify(priorPublished));
  fs.unlinkSync('draw-matches.published.json'); fs.unlinkSync('draw-matches.json');
  writeFn(fs, wja, boom, 'draw-matches.json', 'draw-matches.published.json', 16)(prog, model);
  check('…and with no previous copy at all, an empty store (the file always exists, so the deploy copy never fails)', JSON.stringify(JSON.parse(fs.readFileSync('draw-matches.json', 'utf8')).matches) === '{}');
  writeFn(fs, wja, P.buildDrawMatchesStore, 'draw-matches.json', 'draw-matches.published.json', 16)(prog, model);
  check('the normal path reads the board from matches.json as published and writes the store', !!JSON.parse(fs.readFileSync('draw-matches.json', 'utf8')).matches['past-1']);
} finally { process.chdir(cwd); fs.rmSync(tmp, { recursive: true, force: true }); }
check('the store is built LAST in the run, after matches.json is final (the valueSnapshot patch)', /patched into matches\.json\.`\);[\s\S]{0,200}\n  \/\/ Draw matches store[^\n]*\n  writeDrawMatchesStore\(progressionTournaments, modelOut\);\n}\n/.test(src));

// ── the Draw view: a card is clickable from the board OR the store ──
const DV = require(path.join(ROOT, 'draw-view.js'));
const draws = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wue-sheet', 'draws-2026-10-20.json'), 'utf8'));
const entry = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'draw-view', 'almaty-progression.json'), 'utf8'));
global.window = {};
const el = { innerHTML: '' };
const store = { matches: { 'past-12171884': { match: row('12171884', '2026-10-19') }, 'past-12171885': { match: { id: 'past-12171885' } } } };
DV.mount(el, { draws, prog: { fetchedAt: '2026-10-24T11:00:00Z', tournaments: { Almaty: entry } }, board: [], drawStore: store, tz: 'UTC' });
check('off the board, in the store → the card opens its Match Analysis (12171884)', /data-dv-ev="12171884" onclick="DrawView\.openAnalysis\('past-12171884'\)"/.test(el.innerHTML));
check('a store entry with no finalScore opens nothing (12171885 not clickable); exactly 1 clickable', !/data-dv-ev="12171885"/.test(el.innerHTML) && (el.innerHTML.match(/role="button"/g) || []).length === 1);
DV.mount(el, { draws, prog: { fetchedAt: '2026-10-24T11:00:00Z', tournaments: { Almaty: entry } }, board: [], drawStore: null, tz: 'UTC' });
check('control: no store and no board row → nothing clickable', !/role="button"/.test(el.innerHTML));

// ── the page: one lookup (board first, then the store), the model fallback, the loader ──
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const fnSrc = (name) => { const i = html.indexOf(`function ${name}(`); if (i < 0) return null; let d = 0, j = html.indexOf('{', i); for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; } return html.slice(i, j + 1); };
const matchById = new Function('matches', '_drawMatchStore', fnSrc('matchById') + '\nreturn matchById;');
const brd = [{ id: 'past-1', tag: 'board', finalScore: {} }];
const st = { matches: { 'past-1': { match: { id: 'past-1', tag: 'store', finalScore: {} } }, 'past-2': { match: { id: 'past-2', tag: 'store', finalScore: {} } }, 'past-3': { match: { id: 'past-3' } } } };
const look = matchById(brd, st);
check('matchById: the board row wins (fresher); off the board → the store copy; unscored or unknown → null', look('past-1').tag === 'board' && look('past-2').tag === 'store' && look('past-3') === null && look('past-x') === null && matchById(brd, null)('past-2') === null);
check('openAnalysisModal and the back-navigation reopen both use matchById', /function openAnalysisModal\(matchId, tab\)\{\n  const m = matchById\(matchId\);/.test(html) && html.includes('reopenModal(s){ if (matchById(s.id)) openAnalysisModal(s.id, s.tab); }'));
check('the Key factors model card falls back to the store\'s model entry when model-output.json no longer holds the match', /const mo = \(typeof modelOutput[^\n]*modelOutput\.matches\[m\.id\] : null\) \|\| \(ds && ds\.model\) \|\| null;/.test(html));
check('the store is declared beside the board (no use-before-declaration), loaded with the draw, and passed to the Draw view',
  /let matches = \[\];\nlet _drawMatchStore = null, _drawMatchStoreLoad = null;/.test(html) && /fetch\('\.\/draw-matches\.json\?_=/.test(html) && /drawStore: _drawMatchStore,/.test(html));

// ── workflow: restored, published copy fetched, saved every run, deployed ──
const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pipeline.yml'), 'utf8');
check('workflow restores the store from its own cache (prefix draw-matches-v1-)', /- name: Restore the draw matches store\n\s+uses: actions\/cache\/restore@v4\n\s+with:\n\s+path: draw-matches\.json\n\s+key: draw-matches-v1-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}\n\s+restore-keys: \|\n\s+draw-matches-v1-\n/.test(yml));
check('workflow fetches the last published copy (fail-open, said in the log)', /-o draw-matches\.published\.json "https:\/\/michaeldk1996\.github\.io\/SAAS\/draw-matches\.json/.test(yml) && /no published draw-matches\.json/.test(yml));
check('workflow saves the store even when a later step fails', /- name: Save the draw matches store\n\s+if: \$\{\{ always\(\) && hashFiles\('draw-matches\.json'\) != '' \}\}\n\s+uses: actions\/cache\/save@v4/.test(yml));
check('the restore + fetch run BEFORE the pipeline, the save AFTER it', yml.indexOf('Restore the draw matches store') < yml.indexOf('- name: Run pipeline') && yml.indexOf('Fetch the published draw matches store') < yml.indexOf('- name: Run pipeline') && yml.indexOf('Save the draw matches store') > yml.indexOf('- name: Run pipeline'));
check('the store is deployed with the other pipeline data', yml.includes('cp matches.json tournament-profiles.json tournament-progression.json player-profiles.json draw-matches.json _site/'));
check('neither copy is ever committed (.gitignore)', /^draw-matches\.json$/m.test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')) && /^draw-matches\.published\.json$/m.test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
